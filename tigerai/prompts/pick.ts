// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * `#` in the input calls up prompts (ported from the old Portal's lib/prompt-mentions.ts and lib/prompts/render.ts).
 *
 * Why `#`: 「/ 會做事、@ 指檔案或人、# 寫字」. A slash command acts (switches model, compacts, runs a skill); a prompt only pastes text
 * into the box. Mixing them in one list would make them look the same although only one of them changes anything. `@` already
 * means a file or a person, and `#` is free (and familiar from Open WebUI).
 *
 * Pure functions only (no React, no database), so the popup, the variables dialog and the tests use ONE set of rules: what the
 * preview shows is what gets inserted.
 */

export interface PromptQueryMatch { start: number; query: string }

/**
 * Is the person typing `#query` right before the caret? Only a `#` at the start or after whitespace counts: `C#`, `issue#42`,
 * a heading `#標題` glued to a word, and a bare `#3` in the middle of text must not open a menu. The query runs to the next whitespace.
 */
export function extractPromptQuery(textBeforeCaret: string): PromptQueryMatch | null {
  const m = /(?:^|\s)#([^\s#]*)$/.exec(textBeforeCaret);
  return m ? { start: textBeforeCaret.length - (m[1].length + 1), query: m[1] } : null;
}

export interface Pickable { id: string; name: string; description: string }

/** Name prefix first, then name contains, then description contains; ties by name. Empty query lists everything. */
export function filterPrompts<T extends Pickable>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const scored: { item: T; rank: number }[] = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : (item.description ?? "").toLowerCase().includes(q) ? 2 : -1;
    if (rank >= 0) scored.push({ item, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name, "zh-TW")).map((s) => s.item);
}

/** Replace the `#query` (from match.start up to the caret) with text; returns the new value and where the caret goes. */
export function replaceQuery(text: string, match: PromptQueryMatch, caret: number, replacement: string): { text: string; caret: number } {
  const before = text.slice(0, match.start);
  return { text: before + replacement + text.slice(caret), caret: before.length + replacement.length };
}

// ---------------------------------------------------------------- variables

/** `{{NAME}}` or `{{NAME | default}}`. Names may be in any script (Chinese field names are normal). */
const TOKEN = /\{\{\s*([^{}|\n]+?)\s*(?:\|\s*([^{}\n]*?)\s*)?\}\}/g;

export const SYSTEM_VARIABLES = ["CURRENT_DATE", "CURRENT_TIME", "CURRENT_DATETIME", "USER_NAME", "USER_EMAIL"] as const;
export interface PromptVariable { name: string; defaultValue: string; system: boolean }

/** Distinct variables in order of first use. System ones are filled automatically and never asked. */
export function variablesOf(body: string): PromptVariable[] {
  const seen = new Map<string, PromptVariable>();
  for (const m of body.matchAll(TOKEN)) {
    const name = m[1].trim();
    const prior = seen.get(name);
    if (prior) { if (!prior.defaultValue && m[2]) prior.defaultValue = m[2]; continue; }
    seen.set(name, { name, defaultValue: m[2] ?? "", system: (SYSTEM_VARIABLES as readonly string[]).includes(name) });
  }
  return [...seen.values()];
}

export interface RenderContext { userName?: string; userEmail?: string; now?: Date }

function systemValues(ctx: RenderContext): Record<string, string> {
  const now = ctx.now ?? new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())}`;
  const time = `${p(now.getHours())}:${p(now.getMinutes())}`;
  return { CURRENT_DATE: date, CURRENT_TIME: time, CURRENT_DATETIME: `${date} ${time}`, USER_NAME: ctx.userName ?? "", USER_EMAIL: ctx.userEmail ?? "" };
}

/**
 * The one render function (dialog preview, insert, tests): the person's value, else the default written in the prompt, else the
 * system value. An unknown variable is left as `{{name}}` on purpose so a gap is visible instead of becoming a plausible sentence.
 */
export function renderPrompt(body: string, values: Record<string, string> = {}, ctx: RenderContext = {}): string {
  const system = systemValues(ctx);
  return body.replace(TOKEN, (whole, rawName: string, def: string | undefined) => {
    const name = rawName.trim();
    const filled = values[name];
    if (filled !== undefined && filled !== "") return filled;
    if (def) return def;
    return name in system ? system[name] : whole;
  });
}

/** Names of the asked (non-system) variables that are still empty. All asked variables are required. */
export function missingRequired(body: string, values: Record<string, string>): string[] {
  return variablesOf(body).filter((v) => !v.system && !(values[v.name] ?? v.defaultValue ?? "").trim()).map((v) => v.name);
}
