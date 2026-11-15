// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUILTIN_SLUGS } from "../skills/builtin-data";

/**
 * Writes an approved skill proposal as a real skill: <agent dir>/skills/<slug>/SKILL.md, the folder every conversation's
 * skill list already reads (the 技能 page, 「可用技能」). Only an administrator's 採用 reaches this (engine.ts decideItem).
 */

export const skillsDir = (): string => join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "skills");

/** A skill's folder name: lowercase ASCII words from the title, or a short hash when the title has none (a Chinese title). */
const asciiWords = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
/**
 * A skill's folder name must be lowercase ASCII. A Chinese title has none, so the readable part is taken from the first
 * ASCII words anywhere in the suggestion (title, when, steps: tool and product names usually survive), plus a short hash of
 * the title so two different Chinese titles never collide and the same suggestion always gets the same name (duplicate check).
 * A suggestion with no ASCII at all stays `skill-<hash>`; its Chinese title is the heading and the start of the description.
 */
export function skillSlug(name: string, ...more: string[]): string {
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  const own = asciiWords(name);
  if (own.length >= 3) return own;
  const hint = more.map(asciiWords).find((w) => w.length >= 3);
  return hint ? `${hint.slice(0, 30).replace(/-+$/, "")}-${hash.slice(0, 4)}` : `skill-${hash}`;
}
export function installedSkillNames(): string[] {
  try { return readdirSync(skillsDir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
}
const oneLine = (s: string): string => s.replace(/\s+/g, " ").replace(/"/g, "'").trim();

export interface SkillDraft { name: string; when: string; steps: string[]; slug: string; roomName?: string }
export function writeSkill(d: SkillDraft, approver: string, sourceCount: number, now = new Date()): { slug: string; path: string } {
  let slug = /^[a-z0-9][a-z0-9-]{1,63}$/.test(d.slug) ? d.slug : skillSlug(d.name);
  const root = skillsDir();
  // A built-in's name is never reused (it is rewritten at every start), and an existing folder is never overwritten.
  for (let n = 2; existsSync(join(root, slug)) || BUILTIN_SLUGS.has(slug); n++) slug = `${d.slug}-${n}`;
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  const body = [
    "---",
    `name: ${slug}`,
    `description: "${oneLine(`${d.name}:${d.when}`).slice(0, 300)}"`,
    "---",
    "",
    `# ${oneLine(d.name)}`,
    "",
    "## 什麼時候用",
    oneLine(d.when),
    "",
    "## 步驟",
    ...d.steps.map((s, i) => `${i + 1}. ${oneLine(s)}`),
    "",
    "## 原則",
    "- 照步驟準備草稿；每一步只用手上有出處的資料。",
    "- 沒有依據的內容(成本、價格、交貨條件、承諾)一律標「待確認」，不要自己補、不要編造，交給主管決定。",
    "- AI 只寫草稿；對客戶承諾與核准，永遠是人。",
    "",
    "## 來源",
    `由「SKILL 建議」精靈從頻道${d.roomName ? `「${oneLine(d.roomName)}」` : ""}的 ${sourceCount} 則訊息整理,${approver} 於 ${now.toISOString().slice(0, 10)} 核准採用。`,
    "",
  ].join("\n");
  const path = join(dir, "SKILL.md");
  writeFileSync(path, body, { mode: 0o644 });
  return { slug, path };
}
