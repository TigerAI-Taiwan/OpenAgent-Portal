// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, listGroups } from "../accounts/service";
import { groupsOf } from "../n8n/service";
import { headGroups } from "../knowledge/access";
import { ensureFormTables } from "./db";
import { checkDef, validate, allKeys, withDefaults } from "./validate";
import { pageSizesOf, renderForm } from "./render";
import type { FormDef, Problems } from "./types";

/**
 * 填表工具 (form filling). A form package = the blank PDF + a field map (types.ts). Who may do what, all checked here:
 *   admin            import / change / delete any form; fill any enabled form; download any filled PDF;
 *   department head  import / change / delete forms whose every department is one they head; fill forms of departments they are in;
 *                    download the PDFs of people who are DIRECT members of a department they head (the teacher scope);
 *   member           fill a form that is open to one of their departments, download only their own PDFs.
 * The AI never guesses: fillForm returns the missing / contradictory fields and writes nothing until there are none.
 */
type Actor = { id: string; role: "admin" | "member" };
export interface FormRow { id: string; name: string; description: string; group_ids: string[]; enabled: boolean; created_by: string; created_at: number; updated_at: number; def: FormDef }
interface Raw { id: string; name: string; description: string; group_ids: string; def: string; enabled: number; created_by: string; created_at: number; updated_at: number }
const parse = (r: Raw): FormRow => ({ ...r, group_ids: JSON.parse(r.group_ids) as string[], enabled: r.enabled === 1, def: JSON.parse(r.def) as FormDef });

const MAX_PDF = 10 * 1024 * 1024;
const MAX_DEF = 256 * 1024;

export function formsDir(): string { const d = join(dataDir(), "forms"); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; }
const blankPath = (id: string) => join(formsDir(), id, "blank.pdf");
const outDir = () => { const d = join(formsDir(), "out"); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
const outPath = (id: string) => join(outDir(), `${id}.pdf`);

/** The font file the admin supplied: TIGERAI_FORM_FONT, else the first .ttf / .otf in <data>/forms/fonts. Not shipped (see README). */
export function fontPath(): string | null {
  const env = process.env.TIGERAI_FORM_FONT;
  if (env) return existsSync(env) ? env : null;
  const d = join(formsDir(), "fonts");
  try { const f = readdirSync(d).filter((n) => /\.(ttf|otf)$/i.test(n)).sort()[0]; return f ? join(d, f) : null; } catch { return null; }
}
/**
 * Usable only when it is a TrueType (glyf) font file. OpenType-CFF (.otf, magic "OTTO") and collections (.ttc) are refused on purpose: fontkit
 * embeds a CFF subset that pdf-lib accepts but poppler (and so many viewers) reports as an invalid embedded font, which cannot be told apart from
 * a working file without opening it elsewhere. Found live with Noto Sans CJK; the same face saved as .ttf rendered correctly.
 */
export function fontStatus(): { ok: true; path: string } | { ok: false; reason: "missing" | "not_truetype" } {
  const p = fontPath();
  if (!p) return { ok: false, reason: "missing" };
  try {
    const head = readFileSync(p).subarray(0, 4).toString("latin1");
    if (head === "OTTO" || head === "ttcf") return { ok: false, reason: "not_truetype" };
  } catch { return { ok: false, reason: "missing" }; }
  return { ok: true, path: p };
}
export const fontReady = (): boolean => fontStatus().ok;

const retentionDays = () => { const n = Number(process.env.TIGERAI_FORM_RETENTION_DAYS); return Number.isFinite(n) && n >= 0 ? n : 30; };
/** Filled PDFs hold personal data: remove the ones past retention (0 = keep). Runs on every list / fill, cheap. */
export function purgeOutputs(now = Date.now()): number {
  ensureFormTables();
  const days = retentionDays();
  if (days === 0) return 0;
  const old = getDb().prepare("SELECT id FROM tg_form_outputs WHERE deleted_at IS NULL AND created_at<?").all(now - days * 86_400_000) as unknown as { id: string }[];
  for (const o of old) { try { rmSync(outPath(o.id), { force: true }); } catch { /* gone */ } getDb().prepare("UPDATE tg_form_outputs SET deleted_at=? WHERE id=?").run(now, o.id); }
  return old.length;
}

// ---------------------------------------------------------------- who

const isMember = (actor: Actor, groupIds: string[]): boolean => actor.role === "admin" || groupIds.some((g) => groupsOf(actor.id).includes(g));
function canManage(actor: Actor, f: Pick<FormRow, "group_ids">): boolean {
  if (actor.role === "admin") return true;
  const mine = new Set(headGroups(actor.id));
  return f.group_ids.length > 0 && f.group_ids.every((g) => mine.has(g));
}
export function mayManage(actor: Actor): boolean { return actor.role === "admin" || headGroups(actor.id).length > 0; }
function requireManager(actor: Actor): void { if (!mayManage(actor)) throw new ServiceError("forbidden", "Only administrators and department heads can manage forms", 403); }
export function departmentsFor(actor: Actor): { id: string; name: string }[] {
  const mine = actor.role === "admin" ? null : new Set(headGroups(actor.id));
  return listGroups().filter((g) => !mine || mine.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
}

// ---------------------------------------------------------------- listing

export function getForm(id: string): FormRow | null {
  ensureFormTables();
  const r = getDb().prepare("SELECT * FROM tg_forms WHERE id=?").get(id) as unknown as Raw | undefined;
  return r ? parse(r) : null;
}
/** Forms this person may fill (enabled, open to one of their departments; an administrator sees all). */
export function formsFor(actor: Actor): FormRow[] {
  ensureFormTables();
  return (getDb().prepare("SELECT * FROM tg_forms WHERE enabled=1 ORDER BY name").all() as unknown as Raw[]).map(parse).filter((f) => isMember(actor, f.group_ids));
}
export function managedForms(actor: Actor): (Omit<FormRow, "def"> & { fieldCount: number })[] {
  requireManager(actor);
  ensureFormTables();
  return (getDb().prepare("SELECT * FROM tg_forms ORDER BY name").all() as unknown as Raw[]).map(parse).filter((f) => canManage(actor, f))
    .map(({ def, ...rest }) => ({ ...rest, fieldCount: allKeys(def).size }));
}

/** What the AI reads: which fields, what each takes, which are required. No coordinates. */
export function specOf(f: FormRow) {
  return {
    form_id: f.id, name: f.name, description: f.description, notes: f.def.notes ?? [], left_blank: f.def.leftBlank ?? [],
    fields: f.def.fields.map((x) => ({
      key: x.key, label: x.label, type: x.type, required: x.required === true || (x.type === "bool" && x.mustBeTrue === true), ...(x.hint ? { hint: x.hint } : {}),
      ...(x.ask === true ? { ask: true } : {}),
      ...("options" in x ? { options: Object.fromEntries(Object.entries(x.options).map(([k, o]) => [k, o.label])) } : {}),
      ...(x.type === "group" ? { fields: x.fields.map((s) => ({ key: s.key, label: s.label, required: s.required === true, ...(s.hint ? { hint: s.hint } : {}) })) } : {}),
      ...(x.type === "date" ? { format: "YYYY-MM-DD(西元)" } : {}),
    })),
    rules_note: "欄位互相矛盾或缺漏時,fill_form 會列出問題而不會輸出;請向使用者確認,不要自己猜。",
  };
}

// ---------------------------------------------------------------- manage

function cleanGroups(actor: Actor, v: unknown): string[] {
  const ids = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : [];
  const all = new Set(listGroups().map((g) => g.id));
  if (ids.some((g) => !all.has(g))) throw new ServiceError("bad_groups", "Unknown department");
  if (actor.role !== "admin") {
    const mine = new Set(headGroups(actor.id));
    if (ids.length === 0 || ids.some((g) => !mine.has(g))) throw new ServiceError("forbidden", "Choose departments you head", 403);
  }
  return ids;
}

async function readPackage(pdfB64: unknown, defInput: unknown): Promise<{ pdf: Buffer; def: FormDef }> {
  if (typeof pdfB64 !== "string" || !pdfB64) throw new ServiceError("no_pdf", "The blank PDF is required");
  const pdf = Buffer.from(pdfB64, "base64");
  if (pdf.length === 0 || pdf.length > MAX_PDF || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ServiceError("bad_pdf", "The blank form must be a PDF of at most 10 MB");
  let raw: unknown = defInput;
  if (typeof raw === "string") { if (raw.length > MAX_DEF) throw new ServiceError("bad_def", "The field map is too large"); try { raw = JSON.parse(raw); } catch { throw new ServiceError("bad_def", "The field map is not valid JSON"); } }
  if (JSON.stringify(raw ?? null).length > MAX_DEF) throw new ServiceError("bad_def", "The field map is too large");
  let sizes: { width: number; height: number }[];
  try { sizes = await pageSizesOf(pdf); } catch { throw new ServiceError("bad_pdf", "The PDF cannot be read (encrypted or damaged?)"); }
  const checked = checkDef(raw, sizes);
  if (!checked.ok) throw new ServiceError("bad_def", `The field map has problems:\n- ${checked.errors.slice(0, 20).join("\n- ")}`);
  return { pdf, def: checked.def };
}

export async function importForm(actor: Actor, input: Record<string, unknown>): Promise<{ id: string }> {
  requireManager(actor);
  ensureFormTables();
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 80) throw new ServiceError("bad_name", "Name is required (max 80 characters)");
  const groups = cleanGroups(actor, input.group_ids);
  const { pdf, def } = await readPackage(input.pdf_base64, input.def);
  const id = `f${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const dir = join(formsDir(), id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(blankPath(id), pdf, { mode: 0o600 });
  const now = Date.now();
  getDb().prepare("INSERT INTO tg_forms (id,name,description,group_ids,def,enabled,created_by,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?)")
    .run(id, name, String(input.description ?? "").trim().slice(0, 300), JSON.stringify(groups), JSON.stringify(def), actor.id, now, now);
  writeAudit("form.import", actor.id, { formId: id, name, groups: groups.length, fields: allKeys(def).size });
  return { id };
}

export async function updateForm(actor: Actor, id: string, input: Record<string, unknown>): Promise<void> {
  requireManager(actor);
  const cur = getForm(id);
  if (!cur || !canManage(actor, cur)) throw new ServiceError("not_found", "No such form", 404);
  const name = input.name !== undefined ? String(input.name).trim() : cur.name;
  if (!name || name.length > 80) throw new ServiceError("bad_name", "Name is required (max 80 characters)");
  const groups = input.group_ids !== undefined ? cleanGroups(actor, input.group_ids) : cur.group_ids;
  let def = cur.def;
  if (input.def !== undefined || input.pdf_base64 !== undefined) {
    const blank = input.pdf_base64 !== undefined ? input.pdf_base64 : readFileSync(blankPath(id)).toString("base64");
    const pkg = await readPackage(blank, input.def !== undefined ? input.def : cur.def);
    def = pkg.def;
    if (input.pdf_base64 !== undefined) writeFileSync(blankPath(id), pkg.pdf, { mode: 0o600 });
  }
  const enabled = input.enabled === undefined ? cur.enabled : input.enabled !== false;
  getDb().prepare("UPDATE tg_forms SET name=?,description=?,group_ids=?,def=?,enabled=?,updated_at=? WHERE id=?")
    .run(name, input.description !== undefined ? String(input.description).trim().slice(0, 300) : cur.description, JSON.stringify(groups), JSON.stringify(def), enabled ? 1 : 0, Date.now(), id);
  writeAudit("form.update", actor.id, { formId: id, name, enabled, groups: groups.length });
}

export function deleteForm(actor: Actor, id: string): void {
  requireManager(actor);
  const cur = getForm(id);
  if (!cur || !canManage(actor, cur)) throw new ServiceError("not_found", "No such form", 404);
  getDb().prepare("DELETE FROM tg_forms WHERE id=?").run(id);
  try { rmSync(join(formsDir(), id), { recursive: true, force: true }); } catch { /* best effort */ }
  writeAudit("form.delete", actor.id, { formId: id, name: cur.name });
}

/** Teacher check of a field map: validate sample data without drawing or storing anything. */
export function dryRun(actor: Actor, id: string, data: unknown): Problems {
  requireManager(actor);
  const f = getForm(id);
  if (!f || !canManage(actor, f)) throw new ServiceError("not_found", "No such form", 404);
  const { age, ...p } = validate(f.def, withDefaults(f.def, data)); void age;
  return p;
}

// ---------------------------------------------------------------- fill

export type FillResult =
  | { status: "refused"; missing: Problems["missing"]; errors: string[]; warnings: string[] }
  /** Nothing missing or wrong, but fields marked `ask` are still empty: nothing is written until the person answers or says to leave them blank. */
  | { status: "ask"; ask: NonNullable<Problems["ask"]>; message: string; warnings: string[] }
  | { status: "filled"; output_id: string; download_url: string; warnings: string[]; left_blank: string[]; notes: string[]; expires_days: number };

export async function fillForm(actor: Actor, formId: string, data: unknown, leaveBlank: string[] = []): Promise<FillResult> {
  ensureFormTables();
  purgeOutputs();
  const f = getForm(formId);
  // Unknown, disabled and not-yours are the same answer: a student cannot probe which forms exist.
  if (!f || !f.enabled || !isMember(actor, f.group_ids)) throw new ServiceError("not_found", "No such form", 404);
  const given = withDefaults(f.def, data);
  const { age, ...problems } = validate(f.def, given); void age;
  const log = (outcome: string, extra: Record<string, unknown> = {}) => writeAudit("form.fill", actor.id, { formId, outcome, missing: problems.missing.length, errors: problems.errors.length, ...extra });
  if (problems.missing.length || problems.errors.length) { log("refused"); return { status: "refused", missing: problems.missing, errors: problems.errors, warnings: problems.warnings }; }
  // Recommended-but-optional fields still empty: ask first. The person may decline one by one (the AI passes only keys the person said to leave blank).
  const declined = new Set(leaveBlank);
  const toAsk = (problems.ask ?? []).filter((a) => !declined.has(a.key));
  if (toAsk.length) {
    log("ask", { ask: toAsk.length });
    return { status: "ask", ask: toAsk, warnings: problems.warnings, message: "這些欄位不是必填,但建議填寫,而且目前是空的:請逐項問使用者要填什麼。使用者明說「不填」才把該欄位代號放進 leave_blank 再呼叫 fill_form;不要自己決定留白。" };
  }
  const font = fontStatus();
  if (!font.ok) { log("no_font", { reason: font.reason }); throw new ServiceError("no_font", font.reason === "not_truetype" ? "The form font must be a TrueType .ttf file (not .otf or .ttc); ask the administrator (docs/FORMS.md)" : "The server has no Chinese font for forms yet; ask the administrator (docs/FORMS.md)", 503); }
  const rendered = await renderForm(readFileSync(blankPath(f.id)), f.def, given as Record<string, unknown>, readFileSync(font.path));
  if (!rendered.ok) { log("refused", { render: true }); return { status: "refused", missing: [], errors: rendered.problems, warnings: problems.warnings }; }
  const id = `o${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  writeFileSync(outPath(id), rendered.out.bytes, { mode: 0o600 });
  try { chmodSync(outPath(id), 0o600); } catch { /* best effort */ }
  getDb().prepare("INSERT INTO tg_form_outputs (id,form_id,form_name,owner_id,created_at,bytes) VALUES (?,?,?,?,?,?)").run(id, f.id, f.name, actor.id, Date.now(), rendered.out.bytes.length);
  log("filled", { outputId: id });
  return { status: "filled", output_id: id, download_url: `/api/tg/forms/outputs/${id}/download`, warnings: problems.warnings, left_blank: f.def.leftBlank ?? [], notes: f.def.notes ?? [], expires_days: retentionDays() };
}

// ---------------------------------------------------------------- download

interface OutRaw { id: string; form_id: string; form_name: string; owner_id: string; created_at: number; bytes: number; deleted_at: number | null }
/** The owner; a department head of a department the owner is a direct member of; an administrator. Everyone else gets 404 (existence is not revealed). */
export function outputFor(actor: Actor, id: string): { path: string; filename: string } {
  ensureFormTables();
  const r = getDb().prepare("SELECT * FROM tg_form_outputs WHERE id=?").get(id) as unknown as OutRaw | undefined;
  const none = () => new ServiceError("not_found", "No such file", 404);
  if (!r || r.deleted_at !== null) throw none();
  let ok = actor.role === "admin" || r.owner_id === actor.id;
  if (!ok) {
    const heads = new Set(headGroups(actor.id));
    ok = heads.size > 0 && groupsOf(r.owner_id).some((g) => heads.has(g));
  }
  if (!ok || !existsSync(outPath(id))) throw none();
  writeAudit("form.download", actor.id, { outputId: id, owner: r.owner_id, own: r.owner_id === actor.id });
  const day = new Date(r.created_at).toISOString().slice(0, 10);
  return { path: outPath(id), filename: `${r.form_name}-${day}.pdf` };
}
export function myOutputs(actor: Actor): { id: string; form_name: string; created_at: number; download_url: string }[] {
  ensureFormTables();
  purgeOutputs();
  return (getDb().prepare("SELECT id,form_name,created_at FROM tg_form_outputs WHERE owner_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50").all(actor.id) as unknown as { id: string; form_name: string; created_at: number }[])
    .map((o) => ({ ...o, download_url: `/api/tg/forms/outputs/${o.id}/download` }));
}
