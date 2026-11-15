// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHash } from "node:crypto";
import { getDb, inTransaction } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { createUser, ServiceError } from "../accounts/service";
import { readXlsx, XlsxError, type Sheet } from "./xlsx";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { workspaceRoot } from "../config";

/**
 * Organisation sheet import (xlsx, three sheets).
 *   units   : unit | parent | description
 *   members : email | name | action | unit | manager
 *   lists   : the allowed values behind the drop-downs (action, manager)
 * action: hire = create the account (if new) and place it in the unit;
 *         leave = disable the account and take it out of every unit;
 *         keep = nothing (row kept for reference).
 * People and units that are not in the file are never touched. Units form a
 * tree for display; permissions do not inherit down it. Preview first: nothing
 * is written until the same file is applied, and then all or nothing.
 */

export interface OrgIssue { sheet: string; row: number; col: string; message: string }
export interface OrgPlan {
  errors: OrgIssue[];
  summary: { unitsCreate: number; unitsExisting: number; hire: number; alreadyHired: number; leave: number; alreadyLeft: number; keep: number };
  steps: { units: { name: string; parent: string | null; description: string }[]; hires: { email: string; name: string; unit: string; manager: boolean; exists: boolean }[]; leaves: { email: string }[] };
  sha256: string;
}

const ACTIONS = new Set(["hire", "leave", "keep"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function find(sheets: Sheet[], name: string): Sheet | undefined { return sheets.find((s) => s.name.toLowerCase() === name); }

function header(sheet: Sheet, wanted: string[], errors: OrgIssue[]): Record<string, string> | null {
  const first = sheet.rows[0];
  const map: Record<string, string> = {};
  if (first) for (const [col, v] of Object.entries(first.cells)) map[v.toLowerCase()] = col;
  const missing = wanted.filter((w) => !(w in map));
  if (missing.length) { errors.push({ sheet: sheet.name, row: first?.row ?? 1, col: "A", message: `Missing column(s): ${missing.join(", ")}` }); return null; }
  return map;
}

/** Text that a spreadsheet would run as a formula when re-opened. */
const formulaLike = (v: string) => /^[=+\-@\t\r]/.test(v);

export async function planOrgImport(buffer: Buffer): Promise<OrgPlan> {
  const errors: OrgIssue[] = [];
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const empty: OrgPlan = { errors, sha256, summary: { unitsCreate: 0, unitsExisting: 0, hire: 0, alreadyHired: 0, leave: 0, alreadyLeft: 0, keep: 0 }, steps: { units: [], hires: [], leaves: [] } };
  let sheets: Sheet[];
  try { sheets = await readXlsx(buffer); } catch (e) {
    if (e instanceof XlsxError) { errors.push({ sheet: "-", row: 0, col: "-", message: e.message }); return empty; }
    throw e;
  }
  const unitsSheet = find(sheets, "units");
  const membersSheet = find(sheets, "members");
  if (!unitsSheet || !membersSheet) { errors.push({ sheet: "-", row: 0, col: "-", message: 'Sheets "units" and "members" are required' }); return empty; }

  const db = getDb();
  const existingGroups = new Map((db.prepare("SELECT id,name FROM groups").all() as unknown as { id: string; name: string }[]).map((g) => [g.name.toLowerCase(), g.id]));

  // ---- units
  const uh = header(unitsSheet, ["unit", "parent"], errors);
  const units: { name: string; parent: string | null; description: string; row: number }[] = [];
  if (uh) {
    const seen = new Set<string>();
    for (const r of unitsSheet.rows.slice(1)) {
      const name = r.cells[uh.unit] ?? "";
      const parent = r.cells[uh.parent] ?? null;
      const description = uh.description ? (r.cells[uh.description] ?? "") : "";
      if (!name) { errors.push({ sheet: unitsSheet.name, row: r.row, col: uh.unit, message: "Unit name is empty" }); continue; }
      for (const [col, v] of [[uh.unit, name], [uh.parent, parent ?? ""], [uh.description ?? "", description]] as const) {
        if (v && formulaLike(v)) errors.push({ sheet: unitsSheet.name, row: r.row, col, message: "Text may not start with = + - @ (formula injection)" });
      }
      if (name.length > 80) errors.push({ sheet: unitsSheet.name, row: r.row, col: uh.unit, message: "Unit name is longer than 80 characters" });
      if (seen.has(name.toLowerCase())) errors.push({ sheet: unitsSheet.name, row: r.row, col: uh.unit, message: `Duplicate unit "${name}"` });
      seen.add(name.toLowerCase());
      units.push({ name, parent, description, row: r.row });
    }
    const known = new Set(units.map((u) => u.name.toLowerCase()));
    for (const u of units) {
      if (u.parent && !known.has(u.parent.toLowerCase()) && !existingGroups.has(u.parent.toLowerCase())) errors.push({ sheet: unitsSheet.name, row: u.row, col: uh.parent, message: `Parent "${u.parent}" does not exist` });
    }
    // cycles among the units named in the file
    const parentOf = new Map(units.map((u) => [u.name.toLowerCase(), u.parent?.toLowerCase() ?? null]));
    for (const u of units) {
      const path = new Set<string>();
      let cur: string | null = u.name.toLowerCase();
      while (cur && parentOf.has(cur)) {
        if (path.has(cur)) { errors.push({ sheet: unitsSheet.name, row: u.row, col: uh.parent, message: `"${u.name}" is part of a loop of parents` }); break; }
        path.add(cur); cur = parentOf.get(cur) ?? null;
      }
    }
  }

  // ---- members
  const mh = header(membersSheet, ["email", "action"], errors);
  const hires: OrgPlan["steps"]["hires"] = [];
  const leaves: { email: string }[] = [];
  let keep = 0, alreadyHired = 0, alreadyLeft = 0;
  if (mh) {
    const unitNames = new Set([...units.map((u) => u.name.toLowerCase()), ...existingGroups.keys()]);
    const emails = new Set<string>();
    for (const r of membersSheet.rows.slice(1)) {
      const email = (r.cells[mh.email] ?? "").toLowerCase();
      const action = (r.cells[mh.action] ?? "").toLowerCase();
      const name = mh.name ? (r.cells[mh.name] ?? "") : "";
      const unit = mh.unit ? (r.cells[mh.unit] ?? "") : "";
      const manager = mh.manager ? /^(yes|y|true|1)$/i.test(r.cells[mh.manager] ?? "") : false;
      for (const [col, v] of [[mh.email, email], [mh.name ?? "", name], [mh.unit ?? "", unit]] as const) {
        if (v && formulaLike(v)) errors.push({ sheet: membersSheet.name, row: r.row, col, message: "Text may not start with = + - @ (formula injection)" });
      }
      if (!EMAIL.test(email)) { errors.push({ sheet: membersSheet.name, row: r.row, col: mh.email, message: `"${email}" is not an email address` }); continue; }
      if (emails.has(email)) errors.push({ sheet: membersSheet.name, row: r.row, col: mh.email, message: `${email} appears twice` });
      emails.add(email);
      if (!ACTIONS.has(action)) { errors.push({ sheet: membersSheet.name, row: r.row, col: mh.action, message: `Action must be hire, leave or keep (got "${action}")` }); continue; }
      const account = db.prepare("SELECT id,role,status FROM users WHERE email=?").get(email) as { id: string; role: string; status: string } | undefined;
      if (action === "keep") { keep += 1; continue; }
      if (account?.role === "admin") { errors.push({ sheet: membersSheet.name, row: r.row, col: mh.email, message: "Administrators are managed under Accounts, not here" }); continue; }
      if (action === "leave") {
        if (!account) { errors.push({ sheet: membersSheet.name, row: r.row, col: mh.email, message: `${email} has no account` }); continue; }
        if (account.status === "disabled" && !db.prepare("SELECT 1 FROM memberships WHERE user_id=?").get(account.id)) alreadyLeft += 1;
        else leaves.push({ email });
        continue;
      }
      // hire
      if (!unit || !unitNames.has(unit.toLowerCase())) { errors.push({ sheet: membersSheet.name, row: r.row, col: mh.unit ?? "?", message: `Unit "${unit}" is not in the units sheet or the system` }); continue; }
      if (!account) {
        if (!name || /[\s@]/.test(name) || name.toLowerCase() === "ai") { errors.push({ sheet: membersSheet.name, row: r.row, col: mh.name ?? "?", message: "A new account needs a name without spaces or @ (and not \"AI\")" }); continue; }
        if (db.prepare("SELECT 1 FROM users WHERE lower(name)=lower(?)").get(name)) { errors.push({ sheet: membersSheet.name, row: r.row, col: mh.name ?? "?", message: `The name "${name}" is already taken` }); continue; }
        hires.push({ email, name, unit, manager, exists: false });
        continue;
      }
      // existing account: fine only when it is already placed in this unit, otherwise ask for a clean file
      const gid = existingGroups.get(unit.toLowerCase());
      const placed = gid && db.prepare("SELECT 1 FROM memberships WHERE user_id=? AND group_id=?").get(account.id, gid);
      if (account.status === "active" && placed) alreadyHired += 1;
      else if (account.status === "active") hires.push({ email, name: name || email, unit, manager, exists: true });
      else errors.push({ sheet: membersSheet.name, row: r.row, col: mh.email, message: `${email} exists but is disabled; enable it under Accounts first` });
    }
  }
  const newUnits = units.filter((u) => !existingGroups.has(u.name.toLowerCase()));
  return {
    errors, sha256,
    summary: { unitsCreate: newUnits.length, unitsExisting: units.length - newUnits.length, hire: hires.length, alreadyHired, leave: leaves.length, alreadyLeft, keep },
    steps: { units: newUnits.map(({ name, parent, description }) => ({ name, parent, description })), hires, leaves },
  };
}

export interface OrgResult { summary: OrgPlan["summary"]; initialPasswordsCsv: string }

/** All or nothing. Returns the one-time passwords of newly created accounts (not stored anywhere). */
export async function applyOrgImport(actorId: string, buffer: Buffer): Promise<OrgResult> {
  const plan = await planOrgImport(buffer);
  if (plan.errors.length) throw new ServiceError("invalid_file", `The file has ${plan.errors.length} problem(s); run the preview`, 422);
  const lines: string[] = ["email,name,initial_password"];
  inTransaction(() => {
    const db = getDb();
    const idOf = (name: string): string => (db.prepare("SELECT id FROM groups WHERE name=?").get(name) as { id: string }).id;
    // parents first so a child can point at a unit created in the same file
    const pending = [...plan.steps.units];
    let guard = pending.length + 1;
    while (pending.length && guard-- > 0) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const u = pending[i];
        const parentRow = u.parent ? (db.prepare("SELECT id FROM groups WHERE name=?").get(u.parent) as { id: string } | undefined) : undefined;
        if (u.parent && !parentRow) continue;
        const id = `g${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
        db.prepare("INSERT INTO groups (id,name,parent_id,dir_name,description) VALUES (?,?,?,?,?)").run(id, u.name, parentRow?.id ?? null, id, u.description.slice(0, 500));
        mkdirSync(join(workspaceRoot(), "groups", id), { recursive: true, mode: 0o700 });
        pending.splice(i, 1);
      }
    }
    for (const h of plan.steps.hires) {
      let userId: string;
      if (h.exists) userId = (db.prepare("SELECT id FROM users WHERE email=?").get(h.email) as { id: string }).id;
      else {
        const { user, initialPassword } = createUser(actorId, { email: h.email, name: h.name, role: "member" });
        userId = user.id;
        lines.push(`${h.email},${h.name},${initialPassword}`);
      }
      db.prepare("INSERT INTO memberships (user_id,group_id,is_manager) VALUES (?,?,?) ON CONFLICT(user_id,group_id) DO UPDATE SET is_manager=excluded.is_manager").run(userId, idOf(h.unit), h.manager ? 1 : 0);
    }
    for (const l of plan.steps.leaves) {
      const u = db.prepare("SELECT id FROM users WHERE email=?").get(l.email) as { id: string };
      db.prepare("DELETE FROM memberships WHERE user_id=?").run(u.id);
      db.prepare("UPDATE users SET status='disabled', token_version=token_version+1 WHERE id=?").run(u.id);
    }
  });
  writeAudit("org.import", actorId, { sha256: plan.sha256, ...plan.summary });
  return { summary: plan.summary, initialPasswordsCsv: lines.join("\n") + "\n" };
}
