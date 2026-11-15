// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import { workspaceRoot } from "../config";
import { skillsDir } from "../wizards/skill-writer";
import { clearSkillCache } from "../wizards/skill-cache";
import { ensurePersonalDir } from "../workspace";
import { BUILTIN_SLUGS } from "./builtin-data";
import { mySkillsDir } from "./builtin";

/**
 * 我的技能 (1.1.2-ce): a member writes a skill from scratch (title, description, steps) into their own my-skills folder, and edits or
 * deletes it there. SHARING is the administrator's: a member 送審s, the administrator reads the full text and publishes it to the whole
 * company (the agent skills folder) or to one unit (<workspace>/unit-skills/<unit>/, delivered to that unit's members). A skill is only
 * words for the model: it grants no permission and every tool still checks its own gate at call time.
 */
const LIMITS = { title: 60, description: 300, body: 20_000 };
const SUBMIT_KEY = "skills.submitted";

const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
const ascii = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36).replace(/-+$/, "");
const NAME_OK = /^my-[a-z0-9][a-z0-9-]{0,62}$/;

export interface MineSkill { name: string; title: string; description: string; steps: string; submitted: boolean }

export function unitSkillsDir(unitId: string): string { return join(workspaceRoot(), "unit-skills", unitId.replace(/[^A-Za-z0-9_-]/g, "_")); }

function render(name: string, title: string, description: string, steps: string): string {
  return ["---", `name: ${name}`, `title: "${title}"`, `description: "${description}"`, "---", "", steps.replace(/\s+$/, ""), ""].join("\n");
}
function parse(text: string): { head: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  return m ? { head: m[1], body: m[2].replace(/^\r?\n/, "") } : { head: "", body: text };
}
const field = (head: string, key: string): string => (new RegExp(`^${key}:\\s*(.*)$`, "m").exec(head)?.[1] ?? "").trim().replace(/^"(.*)"$/, "$1");

function clean(input: Record<string, unknown>): { title: string; description: string; steps: string } {
  const title = oneLine(input.title).slice(0, LIMITS.title + 1);
  const description = oneLine(input.description);
  const steps = String(input.steps ?? "").replace(/\r\n/g, "\n").trim();
  if (!title || title.length > LIMITS.title) throw new ServiceError("bad_name", `Skill name is required (max ${LIMITS.title} characters)`);
  if (!description || description.length > LIMITS.description) throw new ServiceError("bad_description", `Description is required (max ${LIMITS.description} characters)`);
  if (!steps || steps.length > LIMITS.body) throw new ServiceError("bad_steps", `Steps are required (max ${LIMITS.body} characters)`);
  return { title, description, steps };
}
function folderOf(userId: string, name: string): string {
  if (!NAME_OK.test(name) || BUILTIN_SLUGS.has(name)) throw new ServiceError("not_found", "Not found", 404);
  const dir = join(mySkillsDir(userId), name);
  if (!existsSync(join(dir, "SKILL.md"))) throw new ServiceError("not_found", "Not found", 404);
  return dir;
}

export function createMine(userId: string, input: Record<string, unknown>): { name: string } {
  const c = clean(input);
  ensurePersonalDir(userId);
  const root = mySkillsDir(userId);
  const base = ascii(c.title) || `skill-${createHash("sha256").update(c.title).digest("hex").slice(0, 6)}`;
  let name = `my-${base}`;
  for (let i = 2; existsSync(join(root, name)); i++) name = `my-${base}-${i}`;
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), render(name, c.title, c.description, c.steps), { mode: 0o644 });
  clearSkillCache();
  writeAudit("skill.create", userId, { skill: name });
  return { name };
}
export function readMine(userId: string, name: string): MineSkill {
  const dir = folderOf(userId, name);
  const { head, body } = parse(readFileSync(join(dir, "SKILL.md"), "utf8"));
  return { name, title: field(head, "title") || name, description: field(head, "description"), steps: body.trim(), submitted: isSubmitted(userId, name) };
}
export function updateMine(userId: string, name: string, input: Record<string, unknown>): { name: string } {
  const dir = folderOf(userId, name);
  const c = clean(input);
  const old = parse(readFileSync(join(dir, "SKILL.md"), "utf8")).head;
  const extra = old.split("\n").filter((l) => /^copy-of:/.test(l));
  const text = render(name, c.title, c.description, c.steps);
  writeFileSync(join(dir, "SKILL.md"), extra.length ? text.replace(/\n---\n/, `\n${extra.join("\n")}\n---\n`) : text, { mode: 0o644 });
  clearSkillCache();
  dropSubmitted(userId, name); // an edited skill must be looked at again before anyone shares it
  writeAudit("skill.update", userId, { skill: name });
  return { name };
}
export function deleteMine(userId: string, name: string): void {
  const dir = folderOf(userId, name);
  rmSync(dir, { recursive: true, force: true });
  dropSubmitted(userId, name);
  clearSkillCache();
  writeAudit("skill.delete", userId, { skill: name });
}

// ---------------------------------------------------------------- review queue (the owner asks, an administrator decides)
type Sub = { userId: string; name: string; at: number };
function subs(): Sub[] {
  try { const v = JSON.parse((getDb().prepare("SELECT value FROM tg_settings WHERE key=?").get(SUBMIT_KEY) as { value: string } | undefined)?.value ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveSubs(list: Sub[]): void {
  getDb().prepare("INSERT INTO tg_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(SUBMIT_KEY, JSON.stringify(list), Date.now());
}
const isSubmitted = (u: string, n: string) => subs().some((s) => s.userId === u && s.name === n);
function dropSubmitted(u: string, n: string): void { const l = subs(); const k = l.filter((s) => !(s.userId === u && s.name === n)); if (k.length !== l.length) saveSubs(k); }

export function submitMine(userId: string, name: string): void {
  folderOf(userId, name);
  if (!isSubmitted(userId, name)) saveSubs([...subs(), { userId, name, at: Date.now() }]);
  writeAudit("skill.submit", userId, { skill: name });
}
export function listSubmitted(): { userId: string; name: string; title: string; description: string; steps: string; at: number }[] {
  const rows: ReturnType<typeof listSubmitted> = [];
  for (const s of subs()) {
    try { const m = readMine(s.userId, s.name); rows.push({ userId: s.userId, name: s.name, title: m.title, description: m.description, steps: m.steps, at: s.at }); } catch { /* deleted since */ }
  }
  return rows;
}
export function rejectSubmitted(actorId: string, userId: string, name: string): void { dropSubmitted(userId, name); writeAudit("skill.reject", actorId, { skill: name, userId }); }

/** Administrator: publish a reviewed skill. scope "company" = the agent's skills folder (every conversation); "unit" = that unit's members only. Never overwrites, never takes a built-in's name. */
export function shareSkill(actorId: string, input: { userId: string; name: string; scope: string; unitId?: string }): { name: string; scope: string } {
  const m = readMine(input.userId, input.name);
  let root: string;
  if (input.scope === "company") root = skillsDir();
  else if (input.scope === "unit") {
    if (!input.unitId || !getDb().prepare("SELECT 1 FROM groups WHERE id=?").get(input.unitId)) throw new ServiceError("bad_unit", "No such unit", 400);
    root = unitSkillsDir(input.unitId);
  } else throw new ServiceError("bad_scope", "Scope: company or unit", 400);
  const base = input.name.replace(/^my-/, "") || "skill";
  let slug = base;
  for (let i = 2; existsSync(join(root, slug)) || BUILTIN_SLUGS.has(slug) || slug.startsWith("my-"); i++) slug = `${base}-${i}`;
  mkdirSync(join(root, slug), { recursive: true });
  writeFileSync(join(root, slug, "SKILL.md"), render(slug, oneLine(m.title), oneLine(m.description), m.steps), { mode: 0o644 });
  clearSkillCache();
  dropSubmitted(input.userId, input.name);
  writeAudit("skill.share", actorId, { skill: slug, scope: input.scope, userId: input.userId, ...(input.unitId ? { groupId: input.unitId } : {}) });
  return { name: slug, scope: input.scope };
}

/** Skills shared with the units this person belongs to: names for the list, folders for resources_discover. */
export function unitSkillDirs(userId: string): string[] {
  const ids = (getDb().prepare("SELECT group_id FROM memberships WHERE user_id=?").all(userId) as { group_id: string }[]).map((r) => r.group_id);
  return ids.map(unitSkillsDir).filter((d) => existsSync(d));
}
export function unitSkills(userId: string): { name: string; description: string; title?: string; builtin: false }[] {
  const out: { name: string; description: string; title?: string; builtin: false }[] = [];
  for (const d of unitSkillDirs(userId)) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        try { const h = parse(readFileSync(join(d, e.name, "SKILL.md"), "utf8")).head; out.push({ name: field(h, "name") || e.name, description: field(h, "description"), title: field(h, "title") || undefined, builtin: false }); } catch { /* not a skill */ }
      }
    } catch { /* gone */ }
  }
  return out;
}
