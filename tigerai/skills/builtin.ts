// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ServiceError } from "../accounts/service";
import { skillsDir } from "../wizards/skill-writer";
import { clearSkillCache } from "../wizards/skill-cache";
import { ensurePersonalDir, personalDir } from "../workspace";
import { BUILTIN_SKILLS, BUILTIN_SLUGS, skillFileText } from "./builtin-data";

/**
 * Built-in skills (內建技能). The originals live in the agent's skills folder and are rewritten on every start, so they cannot drift or
 * be broken by hand. A person edits a COPY: <their folder>/my-skills/my-<slug>/SKILL.md. The SDK would ignore a project skill folder (.agents/skills) as untrusted, so
 * the folder is delivered to that person's conversations through resources_discover (adapter/prompt-library.ts) and listed by mySkills(). A restart never touches a copy (its name is never a built-in slug). Skills only add words; every tool they
 * name checks permissions at call time.
 */
/** The folder of one person's own skills (copies of built-ins, and skills they made). */
export const mySkillsDir = (userId: string): string => join(personalDir(userId), "my-skills");

const field = (text: string, key: string): string => (new RegExp(`^${key}:\\s*(.*)$`, "m").exec(text)?.[1] ?? "").trim().replace(/^"(.*)"$/, "$1");
/** Names and descriptions of a person's own skills, for the 可用技能 list. */
export function mySkills(userId: string): { name: string; description: string; title?: string; builtin: false }[] {
  const root = mySkillsDir(userId);
  const out: { name: string; description: string; title?: string; builtin: false }[] = [];
  try {
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      try {
        const head = readFileSync(join(root, d.name, "SKILL.md"), "utf8").split(/\n---\s*\n/)[0];
        out.push({ name: field(head, "name") || d.name, description: field(head, "description"), title: field(head, "title") || undefined, builtin: false });
      } catch { /* a folder without a SKILL.md is not a skill */ }
    }
  } catch { /* no folder yet */ }
  return out;
}

export const isBuiltinSkill = (name: string): boolean => BUILTIN_SLUGS.has(name);

export function installBuiltinSkills(): number {
  let n = 0;
  for (const s of BUILTIN_SKILLS) {
    const dir = join(skillsDir(), s.slug);
    const file = join(dir, "SKILL.md");
    const text = skillFileText(s);
    try {
      if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, text, { mode: 0o644 });
      n++;
    } catch (e) { console.error(`[tigerai] built-in skill ${s.slug} not installed:`, e instanceof Error ? e.message : e); }
  }
  if (n) clearSkillCache();
  return n;
}

/** 複製成我的: a built-in only; returns the new skill's name. Never overwrites anything. */
export function copyBuiltinSkill(userId: string, name: string): { name: string } {
  const s = BUILTIN_SKILLS.find((x) => x.slug === name);
  if (!s) throw new ServiceError("not_builtin", "Only a built-in skill can be copied", 404);
  ensurePersonalDir(userId);
  const root = mySkillsDir(userId);
  let copy = `my-${s.slug}`;
  for (let i = 2; existsSync(join(root, copy)); i++) copy = `my-${s.slug}-${i}`;
  mkdirSync(join(root, copy), { recursive: true });
  writeFileSync(join(root, copy, "SKILL.md"), skillFileText(s, { name: copy, copyOf: s.slug }), { mode: 0o644 });
  clearSkillCache();
  return { name: copy };
}
