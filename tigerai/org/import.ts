// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHash } from "node:crypto";
import { EMAIL } from "../accounts/email";
import { getDb, transaction } from "../db/store";
import { writeAudit } from "../accounts/audit";
import {
  ServiceError, isReservedName, createGroup, createUser, setEmployeeId, setMembership, updateGroup, updateUser, userById, type Role, type UserRow,
} from "../accounts/service";
import { readXlsx, XlsxError, type Sheet } from "./xlsx";
import { withKeysDryRun } from "../provider/leaver-keys";
import { applyUnitChange } from "./transfer";
import { inventoryOf, leaveUser, ownsThings } from "./handover";

/**
 * org.xlsx: one file, three sheets, the old Agent Portal's rules.
 *   units   : name | parent | description | managers | confirmers (reserved, must stay empty)
 *   members : action | email | employeeId | name | role | status (shown by the export, ignored on import) | units
 *   lists   : what each column accepts; the drop-downs read it. Never imported.
 * Rules (each one is a defect the old product paid for, see DECISIONS.md):
 *   - an EMPTY cell means "do not change"; a single "-" means "clear it";
 *   - `units` replaces the person's whole set ("財務部;新品導入"); empty = unchanged;
 *   - action hire = create / re-enable (a repeat on an active person is a warning, not an error); leave = disable, unit links STAY;
 *     empty = only update the fields (the person must already exist: nothing is created by accident);
 *   - people and units that are not in the file are never touched ("the file is the truth, everyone else is disabled" took a whole
 *     company down once), so a leaver must be written down as `leave`;
 *   - the same rules as every other way of changing an account: this file calls the account / unit / handover functions themselves
 *     instead of re-implementing them, and a PREVIEW is the real run inside a transaction that is rolled back, so the two cannot drift;
 *   - preview first, then apply with the preview's digest; if anything changed since (the file or the data) the apply answers 409;
 *   - all or nothing: any error rolls everything back.
 * Never in the file: passwords, allowed models, capability switches (this edition has none). Spreadsheet formulas are refused.
 */

export interface OrgIssue { sheet: string; row: number; col: string; message: string; code?: string }
export interface OrgChange { kind: string; sheet: string; row: number; target: string; fields: { field: string; from: string; to: string }[] }
export interface OrgPlan {
  errors: OrgIssue[];
  warnings: OrgIssue[];
  changes: OrgChange[];
  summary: { unitsCreate: number; unitsUpdate: number; hire: number; rejoin: number; update: number; leave: number; unchanged: number };
  /** Binds the file AND the resulting change list: apply recomputes it and refuses (409) when it differs. */
  digest: string;
  sha256: string;
}
export interface OrgResult { plan: OrgPlan; initialPasswordsCsv: string }

const UNIT_COLS = ["name", "parent", "description", "managers", "confirmers"];
const MEMBER_COLS = ["action", "email", "employeeid", "name", "role", "status", "units"];
const CLEAR = "-";
const formulaLike = (v: string) => v !== CLEAR && /^[=+\-@\t\r]/.test(v);

type Cells = Record<string, string>;
interface Row { row: number; cells: Cells; sheet: string }

function find(sheets: Sheet[], name: string): Sheet | undefined { return sheets.find((s) => s.name.toLowerCase() === name); }

/** header cell text -> canonical lower-case column name -> spreadsheet column letter */
function readRows(sheet: Sheet, allowed: string[], required: string[], errors: OrgIssue[]): Row[] | null {
  const first = sheet.rows[0];
  if (!first) { errors.push({ sheet: sheet.name, row: 1, col: "A", message: "The sheet is empty (the first row must hold the column names)" }); return null; }
  const colOf: Record<string, string> = {};
  let bad = false;
  for (const [letter, text] of Object.entries(first.cells)) {
    const key = text.trim().toLowerCase();
    if (!allowed.includes(key)) { errors.push({ sheet: sheet.name, row: first.row, col: letter, message: `Unknown column "${text}". Allowed: ${allowed.join(", ")}`, code: "unknown_column" }); bad = true; continue; }
    if (colOf[key]) { errors.push({ sheet: sheet.name, row: first.row, col: letter, message: `Column "${text}" appears twice`, code: "duplicate_column" }); bad = true; continue; }
    colOf[key] = letter;
  }
  for (const r of required) if (!colOf[r]) { errors.push({ sheet: sheet.name, row: first.row, col: "A", message: `Missing column: ${r}`, code: "missing_column" }); bad = true; }
  if (bad) return null;
  const out: Row[] = [];
  for (const r of sheet.rows.slice(1)) {
    const cells: Cells = {};
    for (const [key, letter] of Object.entries(colOf)) {
      const v = (r.cells[letter] ?? "").trim();
      if (v && formulaLike(v)) errors.push({ sheet: sheet.name, row: r.row, col: letter, message: "Text may not start with = + - @ (formula injection); a single - clears a cell", code: "formula_like" });
      cells[key] = v;
    }
    if (Object.values(cells).some((v) => v !== "")) out.push({ row: r.row, cells, sheet: sheet.name });
  }
  return out;
}

const listOf = (v: string): string[] => v.split(/[;；]/).map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- snapshots (for the change list)

const q = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).all(...(a as never[])) as unknown as T[];
const one = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).get(...(a as never[])) as unknown as T | undefined;

function snapUser(email: string): Record<string, string> | null {
  const u = one<UserRow>("SELECT id,email,name,role,status,employee_id FROM users WHERE email=?", email);
  if (!u) return null;
  const units = q<{ name: string }>("SELECT g.name FROM memberships m JOIN groups g ON g.id=m.group_id WHERE m.user_id=? ORDER BY g.name", u.id).map((x) => x.name).join(";");
  return { name: u.name, role: u.role, status: u.status, employeeId: u.employee_id ?? "", units };
}
function snapUnit(name: string): Record<string, string> | null {
  const g = one<{ id: string; name: string; parent_id: string | null; description: string }>("SELECT id,name,parent_id,description FROM groups WHERE name=?", name);
  if (!g) return null;
  const parent = g.parent_id ? one<{ name: string }>("SELECT name FROM groups WHERE id=?", g.parent_id)?.name ?? "" : "";
  const managers = q<{ email: string }>("SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND m.is_manager=1 ORDER BY u.email", g.id).map((x) => x.email).join(";");
  return { parent, description: g.description, managers };
}

// ---------------------------------------------------------------- the run

function colForCode(code: string, sheet: "units" | "members"): string {
  const map: Record<string, string> = {
    employee_id_taken: "employeeId", bad_employee_id: "employeeId", bad_name: "name", exists: "name", bad_role: "role", bad_email: "email",
    bad_parent: "parent", left_user: "units", bad_units: "units", last_admin: "action", self_lockout: "role", leave_self: "action",
  };
  return map[code] ?? (sheet === "units" ? "name" : "email");
}

/** One CSV cell: quoted when it holds a comma, quote or line break (a name with a comma used to shift the columns). */
const csvCell = (v: string | null): string => { const t = v ?? ""; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
interface Ctx { actor: { id: string; role: string }; errors: OrgIssue[]; warnings: OrgIssue[]; csv: string[]; touchedUsers: Map<string, { sheet: string; row: number; kind: string; before: Record<string, string> | null }>; touchedUnits: Map<string, { row: number; kind: string; before: Record<string, string> | null }>; counts: OrgPlan["summary"]; leavers: string[] }

function guarded(ctx: Ctx, sheet: "units" | "members", row: number, col: string, fn: () => void): boolean {
  // each row in its own savepoint: a row that fails leaves nothing half done behind, and the other rows still get checked
  try { transaction(() => ({ value: fn(), commit: true })); return true; } catch (e) {
    if (e instanceof ServiceError) { ctx.errors.push({ sheet, row, col: col || colForCode(e.code, sheet), message: e.message, code: e.code }); return false; }
    throw e;
  }
}

const unitByName = (name: string) => one<{ id: string; name: string; parent_id: string | null }>("SELECT id,name,parent_id FROM groups WHERE name=?", name);
const userByEmail = (email: string) => one<UserRow>("SELECT id,email,name,role,status,must_change_pw,token_version,dir_name,created_at,employee_id,left_at FROM users WHERE email=?", email);

function applyUnits(ctx: Ctx, rows: Row[]): void {
  // parents before children: keep going while a pass makes progress
  let pending = rows.filter((r) => r.cells.name);
  for (const r of rows) if (!r.cells.name) ctx.errors.push({ sheet: r.sheet, row: r.row, col: "A", message: "Unit name is empty", code: "bad_name" });
  const seen = new Set<string>();
  for (const r of pending) {
    const key = r.cells.name.toLowerCase();
    if (seen.has(key)) ctx.errors.push({ sheet: r.sheet, row: r.row, col: "A", message: `Unit "${r.cells.name}" appears twice`, code: "duplicate" });
    seen.add(key);
  }
  let progress = true;
  const failed = new Set<Row>();
  while (pending.length && progress) {
    progress = false;
    for (const r of [...pending]) {
      const parentName = r.cells.parent;
      if (parentName && parentName !== CLEAR && !unitByName(parentName)) {
        // the parent may be created by a later row of this file
        if (pending.some((p) => p !== r && p.cells.name.toLowerCase() === parentName.toLowerCase())) continue;
        ctx.errors.push({ sheet: r.sheet, row: r.row, col: "B", message: `Parent "${parentName}" is not in the file or the system`, code: "bad_parent" });
        pending = pending.filter((p) => p !== r); failed.add(r); progress = true; continue;
      }
      const name = r.cells.name;
      const existing = unitByName(name);
      if (!ctx.touchedUnits.has(name.toLowerCase())) ctx.touchedUnits.set(name.toLowerCase(), { row: r.row, kind: existing ? "unit.update" : "unit.create", before: snapUnit(name) });
      guarded(ctx, "units", r.row, "", () => {
        const parentId = parentName === CLEAR ? null : parentName ? unitByName(parentName)!.id : undefined;
        const description = r.cells.description === CLEAR ? "" : r.cells.description || undefined;
        if (!existing) createGroup(ctx.actor.id, { name, description: description ?? "", parentId: parentId ?? null });
        else updateGroup(ctx.actor.id, existing.id, { description, parentId });
      });
      pending = pending.filter((p) => p !== r); progress = true;
    }
  }
  for (const r of pending) ctx.errors.push({ sheet: r.sheet, row: r.row, col: "B", message: `"${r.cells.name}" is part of a loop of parents`, code: "bad_parent" });
}

/** A display name: spaces are fine (「王董 David」, same as the sign-up form and 設定); only @ (it is the @mention marker), control characters and the reserved "AI" are not. Runs of spaces collapse to one. */
export function cleanName(v: string): string {
  const name = v.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80 || /[@\u0000-\u001f\u007f]/.test(name) || isReservedName(name)) throw new ServiceError("bad_name", "A name needs 1 to 80 characters without @ (spaces are fine, and it is not \"AI\")");
  return name;
}

function applyMembers(ctx: Ctx, rows: Row[]): void {
  const seen = new Set<string>();
  const employeeIds = new Map<string, string>();
  for (const r of rows) {
    const c = r.cells;
    const email = (c.email ?? "").toLowerCase();
    if (!EMAIL.test(email)) { ctx.errors.push({ sheet: r.sheet, row: r.row, col: "B", message: `"${c.email}" is not an email address`, code: "bad_email" }); continue; }
    if (seen.has(email)) { ctx.errors.push({ sheet: r.sheet, row: r.row, col: "B", message: `${email} appears twice`, code: "duplicate" }); continue; }
    seen.add(email);
    const action = (c.action ?? "").toLowerCase();
    if (action && action !== "hire" && action !== "leave") { ctx.errors.push({ sheet: r.sheet, row: r.row, col: "A", message: `Action must be hire, leave or empty (got "${c.action}")`, code: "bad_action" }); continue; }
    if (c.role && c.role !== CLEAR && c.role.toLowerCase() !== "admin" && c.role.toLowerCase() !== "member") { ctx.errors.push({ sheet: r.sheet, row: r.row, col: "E", message: `Role must be admin or member (got "${c.role}")`, code: "bad_role" }); continue; }
    if (c.role === CLEAR || c.name === CLEAR) { ctx.errors.push({ sheet: r.sheet, row: r.row, col: c.role === CLEAR ? "E" : "D", message: "This column cannot be cleared", code: "cannot_clear" }); continue; }
    if (c.employeeid && c.employeeid !== CLEAR) {
      const prev = employeeIds.get(c.employeeid.toLowerCase());
      if (prev && prev !== email) { ctx.errors.push({ sheet: r.sheet, row: r.row, col: "C", message: `Employee number ${c.employeeid} is used by ${prev} too`, code: "employee_id_taken" }); continue; }
      employeeIds.set(c.employeeid.toLowerCase(), email);
    }
    if (action === "leave") { ctx.leavers.push(email); if (!ctx.touchedUsers.has(email)) ctx.touchedUsers.set(email, { sheet: r.sheet, row: r.row, kind: "member.leave", before: snapUser(email) }); continue; }
    const acct = userByEmail(email);
    if (!acct && action !== "hire") { ctx.errors.push({ sheet: r.sheet, row: r.row, col: "B", message: `${email} has no account; write hire in the action column to create it`, code: "no_account" }); continue; }
    ctx.touchedUsers.set(email, { sheet: r.sheet, row: r.row, kind: !acct ? "member.create" : acct.status === "disabled" && action === "hire" ? "member.rejoin" : "member.update", before: snapUser(email) });
    guarded(ctx, "members", r.row, "", () => {
      let id = acct?.id;
      if (!acct) {
        const { user, initialPassword } = createUser(ctx.actor.id, { email, name: cleanName(c.name), role: (c.role.toLowerCase() === "admin" ? "admin" : "member") as Role, employeeId: c.employeeid && c.employeeid !== CLEAR ? c.employeeid : null });
        id = user.id; ctx.counts.hire += 1;
        ctx.csv.push([email, user.name, initialPassword].map(csvCell).join(","));
      } else {
        if (action === "hire" && acct.status === "disabled") {
          if (acct.left_at === null && one("SELECT 1 FROM registration_requests WHERE user_id=? AND status='pending'", acct.id)) throw new ServiceError("pending_registration", "This account waits for approval under Accounts; approve or reject it there", 409);
          updateUser(ctx.actor.id, acct.id, { status: "active" }); ctx.counts.rejoin += 1;
        } else if (action === "hire") ctx.warnings.push({ sheet: r.sheet, row: r.row, col: "B", message: `${email} is already active (nothing to hire)`, code: "already_active" });
        if (c.name && acct.name !== cleanName(c.name)) renameUser(ctx.actor.id, acct.id, cleanName(c.name));
        if (c.role && c.role.toLowerCase() !== acct.role) updateUser(ctx.actor.id, acct.id, { role: c.role.toLowerCase() });
        if (c.employeeid) setEmployeeId(ctx.actor.id, acct.id, c.employeeid === CLEAR ? "" : c.employeeid);
      }
      if (c.units) {
        const names = c.units === CLEAR ? [] : listOf(c.units);
        const ids = names.map((n) => { const u = unitByName(n); if (!u) throw new ServiceError("bad_units", `Unit "${n}" is not in the file or the system`); return u.id; });
        const cur = q<{ group_id: string }>("SELECT group_id FROM memberships WHERE user_id=?", id!).map((m) => m.group_id).sort().join(",");
        if (cur !== [...new Set(ids)].sort().join(",")) applyUnitChange(ctx.actor, id!, { unitIds: ids }); // same set = no change, and a leaver's unchanged row is fine
      }
    });
  }
}

function renameUser(actorId: string, userId: string, name: string): void {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE lower(name)=lower(?) AND id<>?").get(name, userId)) throw new ServiceError("exists", "Name already in use", 409);
  db.prepare("UPDATE users SET name=? WHERE id=?").run(name, userId);
  writeAudit("user.rename", actorId, { userId, to: name });
}

function applyManagers(ctx: Ctx, rows: Row[]): void {
  for (const r of rows) {
    if (r.cells.confirmers) ctx.warnings.push({ sheet: r.sheet, row: r.row, col: "E", message: "The confirmers column is reserved in this edition and is ignored", code: "confirmers_ignored" });
    const cell = r.cells.managers;
    if (!cell) continue;
    const unit = unitByName(r.cells.name);
    if (!unit) continue; // the unit row itself failed; its error is already listed
    guarded(ctx, "units", r.row, "D", () => {
      const wanted = cell === CLEAR ? [] : listOf(cell).map((e) => e.toLowerCase());
      const ids: string[] = [];
      for (const email of wanted) {
        const u = userByEmail(email);
        if (!u) throw new ServiceError("no_account", `Manager ${email} has no account (add the person on the members sheet with hire)`);
        const already = one("SELECT 1 FROM memberships WHERE user_id=? AND group_id=? AND is_manager=1", u.id, unit.id);
        if (u.status !== "active" && !already && !ctx.leavers.includes(email)) throw new ServiceError("left_user", `${email} has left and cannot be named a head`, 409);
        if (ctx.leavers.includes(email) && !already) throw new ServiceError("left_user", `${email} leaves in this file and cannot be named a head`, 409);
        ids.push(u.id);
      }
      for (const old of q<{ user_id: string }>("SELECT user_id FROM memberships WHERE group_id=? AND is_manager=1", unit.id)) {
        if (!ids.includes(old.user_id)) setMembership(ctx.actor.id, unit.id, old.user_id, true, false);
      }
      for (const id of ids) {
        const was = one("SELECT is_manager FROM memberships WHERE user_id=? AND group_id=?", id, unit.id) as { is_manager: number } | undefined;
        if (!was || was.is_manager !== 1) {
          const u = userById(id)!;
          if (!ctx.touchedUsers.has(u.email)) ctx.touchedUsers.set(u.email, { sheet: r.sheet, row: r.row, kind: "member.update", before: snapUser(u.email) });
          setMembership(ctx.actor.id, unit.id, id, true, true);
        }
      }
    });
  }
}

function applyLeaves(ctx: Ctx, rows: Row[]): void {
  for (const r of rows) {
    const email = (r.cells.email ?? "").toLowerCase();
    if ((r.cells.action ?? "").toLowerCase() !== "leave" || !ctx.leavers.includes(email) || !EMAIL.test(email)) continue;
    const acct = userByEmail(email);
    if (!acct) { ctx.errors.push({ sheet: r.sheet, row: r.row, col: "B", message: `${email} has no account`, code: "no_account" }); continue; }
    if (acct.id === ctx.actor.id) { ctx.errors.push({ sheet: r.sheet, row: r.row, col: "A", message: "You cannot make your own account leave", code: "leave_self" }); continue; }
    if (acct.status === "disabled") { ctx.warnings.push({ sheet: r.sheet, row: r.row, col: "A", message: `${email} has already left`, code: "already_left" }); continue; }
    guarded(ctx, "members", r.row, "A", () => {
      const inv = inventoryOf(acct.id);
      leaveUser(ctx.actor, acct.id, {}, { allowNoSuccessor: true });
      ctx.counts.leave += 1;
      if (ownsThings(inv)) {
        ctx.warnings.push({ sheet: r.sheet, row: r.row, col: "B", code: "leave_owns", message: `${email} owned ${inv.channels.length} channel(s), ${inv.agents.length} AI role(s) and ${inv.assignments.length + inv.orders.length} open order(s): the channels now belong to you (the administrator); the roles and orders stay as they were until you hand them over in Settings > Members` });
      }
    });
  }
}

export async function runOrg(actor: { id: string; role: string }, buffer: Buffer, mode: "preview" | "apply", expectedDigest?: string): Promise<OrgResult> {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const errors: OrgIssue[] = [];
  const warnings: OrgIssue[] = [];
  const emptySummary = { unitsCreate: 0, unitsUpdate: 0, hire: 0, rejoin: 0, update: 0, leave: 0, unchanged: 0 };
  const early = (): OrgResult => ({ plan: { errors, warnings, changes: [], summary: emptySummary, digest: "", sha256 }, initialPasswordsCsv: "" });
  let sheets: Sheet[];
  try { sheets = await readXlsx(buffer); } catch (e) {
    if (e instanceof XlsxError) { errors.push({ sheet: "-", row: 0, col: "-", message: e.message }); return early(); }
    throw e;
  }
  const us = find(sheets, "units");
  const ms = find(sheets, "members");
  if (!us && !ms) { errors.push({ sheet: "-", row: 0, col: "-", message: 'The file needs a "units" and/or a "members" sheet (download the current org.xlsx and edit it)' }); return early(); }
  const unitRows = us ? readRows(us, UNIT_COLS, ["name"], errors) : [];
  const memberRows = ms ? readRows(ms, MEMBER_COLS, ["email"], errors) : [];
  if (!unitRows || !memberRows) return early();
  if (errors.length) return early();

  const ctx: Ctx = { actor, errors, warnings, csv: ["email,name,initial_password"], touchedUsers: new Map(), touchedUnits: new Map(), counts: { ...emptySummary }, leavers: [] };
  const run = () => transaction<OrgResult>(() => {
    applyUnits(ctx, unitRows);
    applyMembers(ctx, memberRows);
    applyManagers(ctx, unitRows);
    applyLeaves(ctx, memberRows);
    // leavers (this file or before) who still head a unit: allowed to stay, but somebody should look
    for (const l of q<{ email: string; name: string }>("SELECT DISTINCT u.email, g.name FROM memberships m JOIN users u ON u.id=m.user_id JOIN groups g ON g.id=m.group_id WHERE m.is_manager=1 AND u.status='disabled' AND u.left_at IS NOT NULL")) {
      if (ctx.touchedUsers.has(l.email) || ctx.touchedUnits.has(l.name.toLowerCase())) ctx.warnings.push({ sheet: "units", row: ctx.touchedUnits.get(l.name.toLowerCase())?.row ?? 0, col: "D", message: `${l.email} has left but is still listed as head of ${l.name}`, code: "leaver_still_listed" });
    }
    // the change list: what each touched unit / person looked like before and after
    const changes: OrgChange[] = [];
    for (const [key, t] of ctx.touchedUnits) {
      const name = unitByName(key) ? unitByName(key)!.name : key;
      const after = snapUnit(name);
      const fields = diff(t.before, after);
      if (fields.length || !t.before) changes.push({ kind: t.before ? "unit.update" : "unit.create", sheet: "units", row: t.row, target: name, fields });
    }
    for (const [email, t] of ctx.touchedUsers) {
      const after = snapUser(email);
      const fields = diff(t.before, after);
      if (fields.length || !t.before) changes.push({ kind: !t.before ? "member.create" : t.kind === "member.leave" ? "member.leave" : t.before.status === "disabled" && after?.status === "active" ? "member.rejoin" : "member.update", sheet: t.sheet, row: t.row, target: email, fields });
    }
    changes.sort((a, b) => a.sheet.localeCompare(b.sheet) || a.row - b.row || a.target.localeCompare(b.target));
    const touched = ctx.touchedUsers.size + ctx.touchedUnits.size;
    const summary: OrgPlan["summary"] = {
      unitsCreate: changes.filter((c) => c.kind === "unit.create").length, unitsUpdate: changes.filter((c) => c.kind === "unit.update").length,
      hire: changes.filter((c) => c.kind === "member.create").length, rejoin: changes.filter((c) => c.kind === "member.rejoin").length,
      update: changes.filter((c) => c.kind === "member.update").length, leave: changes.filter((c) => c.kind === "member.leave").length,
      unchanged: Math.max(0, touched - changes.length),
    };
    const digest = createHash("sha256").update(JSON.stringify({ sha256, changes, errors: errors.length })).digest("hex");
    const plan: OrgPlan = { errors, warnings, changes, summary, digest, sha256 };
    const clean = errors.length === 0;
    if (mode === "apply") {
      if (!clean) return { value: { plan, initialPasswordsCsv: "" }, commit: false };
      if (expectedDigest !== digest) return { value: { plan: { ...plan, errors: [{ sheet: "-", row: 0, col: "-", message: "The preview is out of date: the file or the data changed since you looked. Preview again.", code: "stale_preview" }, ...errors] }, initialPasswordsCsv: "" }, commit: false };
      writeAudit("org.import", actor.id, { sha256, items: changes.length, scope: JSON.stringify(summary) });
      for (const c of changes) writeAudit("org.import_item", actor.id, { scope: c.kind, name: c.target, items: c.fields.length, changed: c.fields.map((f) => f.field).join(",") });
      return { value: { plan, initialPasswordsCsv: ctx.csv.length > 1 ? ctx.csv.join("\n") + "\n" : "" }, commit: true };
    }
    return { value: { plan, initialPasswordsCsv: "" }, commit: false };
  });
  return mode === "apply" ? run() : withKeysDryRun(run);
}

function diff(before: Record<string, string> | null, after: Record<string, string> | null): { field: string; from: string; to: string }[] {
  const out: { field: string; from: string; to: string }[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const a = before?.[k] ?? "", b = after?.[k] ?? "";
    if (a !== b) out.push({ field: k, from: a, to: b });
  }
  return out;
}

export const planOrgImport = (actor: { id: string; role: string }, buffer: Buffer) => runOrg(actor, buffer, "preview").then((r) => r.plan);
export const applyOrgImport = (actor: { id: string; role: string }, buffer: Buffer, digest: string) => runOrg(actor, buffer, "apply", digest);
