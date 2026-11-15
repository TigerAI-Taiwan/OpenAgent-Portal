// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { Source } from "./facts";

/** Strips end punctuation from model text so a template can add its own 。 without producing 「。。」. */
export const stripEnd = (s: string): string => s.trim().replace(/[。.]+$/u, "");
/** Collapses a doubled full stop (a template 。 after text that already ended with one). */
export const collapseStops = (s: string): string => s.replace(/。{2,}/g, "。");

/**
 * The strict line format a wizard asks the model for, and the server-side check of what comes back.
 * A local model is weak: it is asked for one line per finding (not JSON, not Markdown), and the server throws away every
 * line that is malformed, belongs to an aspect that is switched off, or cites no message that was really in the prompt.
 * "No source, no item" is enforced here, not in the prompt.
 */

export type Aspect = "record" | "suggest" | "supervise" | "audit" | "remind";
export const ASPECTS: Aspect[] = ["record", "supervise", "audit", "remind", "suggest"];
export const ASPECT_ZH: Record<Aspect | "skill", string> = { record: "記錄", suggest: "建議", supervise: "監督", audit: "稽核", remind: "提醒", skill: "技能" };
const FROM_ZH: Record<string, Aspect | "skill"> = { 記錄: "record", 建議: "suggest", 監督: "supervise", 稽核: "audit", 提醒: "remind", 技能: "skill" };

export const CATEGORIES = ["next_step", "delegate_ai", "process", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_ZH: Record<Category, string> = { next_step: "下一步", delegate_ai: "交給AI", process: "流程改善", other: "其他" };
const catFrom = (v: string): Category => {
  const s = v.replace(/\s+/g, "");
  return (CATEGORIES.find((c) => CATEGORY_ZH[c] === s) ?? (s.includes("AI") || s.includes("ai") ? "delegate_ai" : s.includes("流程") ? "process" : s.includes("下一步") ? "next_step" : "other")) as Category;
};

export interface ParsedLine {
  aspect: Aspect | "skill"; text: string; category?: Category; seqs: number[];
  skill?: { name: string; when: string; steps: string[] };
}

/** Drops reasoning blocks and code fences some models wrap around the answer. */
export function cleanReply(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?/gi, "").trim();
}

const seqsIn = (s: string): number[] => [...new Set([...s.matchAll(/#(\d{1,9})/g)].map((m) => +m[1]))];

export function parseLines(raw: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of cleanReply(raw).split(/\r?\n/)) {
    const t = line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "").replace(/^\*\*(.+?)\*\*/, "$1").trim();
    const cols = t.split(/[｜|]/).map((c) => c.trim());
    const aspect = FROM_ZH[cols[0]?.replace(/[:：\s]/g, "")];
    if (!aspect || cols.length < 3) continue;
    if (aspect === "skill") {
      if (cols.length < 5) continue;
      const steps = cols[3].split(/[;；]/).map((x) => x.replace(/^\s*\d+[.)、]\s*/, "").trim()).filter(Boolean);
      out.push({ aspect, text: cols[1], seqs: seqsIn(cols[4]), skill: { name: cols[1], when: cols[2], steps } });
    } else if (aspect === "suggest") {
      // 建議｜類別｜文字｜出處 (a model that leaves the category out writes 3 columns)
      if (cols.length >= 4) out.push({ aspect, category: catFrom(cols[1]), text: cols[2], seqs: seqsIn(cols.slice(3).join(" ")) });
      else out.push({ aspect, category: "other", text: cols[1], seqs: seqsIn(cols[2]) });
    } else {
      out.push({ aspect, text: cols[1], seqs: seqsIn(cols.slice(2).join(" ")) });
    }
  }
  return out;
}

export interface Checked { aspect: Aspect | "skill"; text: string; category?: Category; sources: Source[]; skill?: ParsedLine["skill"] }
export interface Rejections { noSource: number; unknownSource: number; switchedOff: number; tooLong: number; unusable: number }

/**
 * Keeps a line only when its aspect is on, it has text, and at least one cited message was really in the prompt.
 * Cited numbers that were not in the prompt are dropped from the line (the rest stays).
 */
export function checkLines(lines: ParsedLine[], allowed: ReadonlySet<number>, on: ReadonlySet<Aspect | "skill">): { items: Checked[]; rejected: Rejections } {
  const rejected: Rejections = { noSource: 0, unknownSource: 0, switchedOff: 0, tooLong: 0, unusable: 0 };
  const items: Checked[] = [];
  for (const l of lines) {
    if (!on.has(l.aspect)) { rejected.switchedOff++; continue; }
    const text = l.text.replace(/\s+/g, " ").trim();
    if (!text || (l.aspect === "skill" && (!l.skill || l.skill.steps.length < 2 || !l.skill.when))) { rejected.unusable++; continue; }
    if (text.length > 400) { rejected.tooLong++; continue; }
    if (l.seqs.length === 0) { rejected.noSource++; continue; }
    const good = l.seqs.filter((n) => allowed.has(n));
    if (good.length === 0) { rejected.unknownSource++; continue; }
    items.push({ aspect: l.aspect, text, category: l.category, sources: good.map((seq) => ({ t: "m" as const, seq })), skill: l.skill });
  }
  return { items, rejected };
}

/** What a chat line looks like inside a prompt: "#12 11/14 09:30 林小華:text". */
export function messageLine(m: { seq: number; ts: number; author: string; text: string }, label: string, max = 300): string {
  const body = m.text.replace(/\s+/g, " ").trim();
  return `#${m.seq} ${label} ${m.author}:${body.length > max ? `${body.slice(0, max)}…` : body}`;
}

/** The format section of a prompt, only for the aspects that are on. */
export function formatRules(on: ReadonlySet<Aspect>): string {
  const rows: string[] = [];
  if (on.has("record")) rows.push("記錄｜<發生了什麼事,或做了什麼決定>｜#編號 #編號");
  if (on.has("suggest")) rows.push("建議｜<類別>｜<下一步怎麼做,或哪裡可以交給 AI>｜#編號   (類別只能是:下一步、交給AI、流程改善、其他)");
  if (on.has("supervise")) rows.push("監督｜<事情沒人負責,或該核可卻沒看到核可>｜#編號");
  if (on.has("audit")) rows.push("稽核｜<該留紀錄卻沒有,或數字、日期前後不一致>｜#編號");
  return rows.join("\n");
}
export const COMMON_RULES = [
  "只輸出上面格式的行,一行一則;不要前言、結語、標題或 Markdown。",
  "每一行最後一欄必須寫你依據的訊息編號(只能用下面出現過的 #編號)。沒有依據就不要寫那一行。",
  "只寫事實與草稿,不做決定,不下結論,不點名指責,不要編造訊息裡沒有的人名、數字、日期。",
  "不要自己算日期或天數。程式已經算出的事(逾期、問了沒人回)列在最後,不用重複。",
  "沒有值得寫的就少寫,不要硬湊。使用繁體中文。",
].map((x, i) => `${i + 1}. ${x}`).join("\n");
