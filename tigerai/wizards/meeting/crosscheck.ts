// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: pure functions shared by the server and the tests.
//
// 對照模型 (1.1.2-ce): the same recording goes to a second speech-to-text model; the MAIN transcript is kept exactly as the main model
// wrote it (the source of truth, quoted by line number) and this module only decides which lines to mark 「待確認」:
//   - disagree: the second model heard something noticeably different at the same place (an aligned edit distance, never a vote);
//   - glossary: a company term (治具, 八D …) is not written as listed, either because the second model wrote the listed term where the main
//     model wrote something else, or because the line holds a same-length near miss of a term (one character off).
// Nothing is corrected and nothing is decided: a mark means "a person listens to this part again".

export interface CrossFlag {
  /** 1-based line of the MAIN transcript */
  line: number;
  kinds: ("disagree" | "glossary")[];
  /** what the second model wrote at the same place (normalised: no spaces or punctuation), clipped */
  other?: string;
  /** the company term involved */
  term?: string;
}
export interface CrossResult { flags: CrossFlag[]; /** average closeness of the two transcripts, 0..1 (only when a second transcript exists) */ agreement: number | null }

/** Letters, digits and CJK only, lower case: spaces and punctuation are where two ASR models differ for no reason. */
export const norm = (s: string): string => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Edit distance of `a` against the best-fitting part of `b` (free start and free end in b). Returns the distance and where that part ends. */
export function bestFit(a: string, b: string): { dist: number; start: number; end: number } {
  const n = a.length, m = b.length;
  if (n === 0) return { dist: 0, start: 0, end: 0 };
  let prev = new Array<number>(m + 1).fill(0); let prevStart = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1); const curStart = new Array<number>(m + 1);
    cur[0] = i; curStart[0] = 0;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), del = prev[j] + 1, ins = cur[j - 1] + 1;
      if (sub <= del && sub <= ins) { cur[j] = sub; curStart[j] = prevStart[j - 1]; }
      else if (del <= ins) { cur[j] = del; curStart[j] = prevStart[j]; }
      else { cur[j] = ins; curStart[j] = curStart[j - 1]; }
    }
    prev = cur; prevStart = curStart;
  }
  let best = 0;
  for (let j = 1; j <= m; j++) if (prev[j] < prev[best]) best = j;
  return { dist: prev[best], start: prevStart[best], end: best };
}

/** A window of `term.length` characters in `line` that is one character away from the term (same length, all but one position equal). Terms of 3+ characters only. */
export function nearMiss(line: string, term: string): string | null {
  const t = norm(term); const l = norm(line);
  if (t.length < 3 || l.includes(t)) return null;
  for (let i = 0; i + t.length <= l.length; i++) {
    let diff = 0;
    for (let k = 0; k < t.length && diff < 2; k++) if (l[i + k] !== t[k]) diff++;
    if (diff === 1) return l.slice(i, i + t.length);
  }
  return null;
}

/**
 * "Noticeably different": two or more edits and at least 6% of the line (a one-character wobble over a long line is noise), or ANY difference in the digits
 * of the two readings (a number is the thing most worth listening to again).
 */
export const DISAGREE_RATIO = 0.06;
const digitString = (s: string): string => (s.match(/\d+/g) ?? []).join(",");

export function crossCheck(mainLines: string[], otherText: string | null, glossary: string[]): CrossResult {
  const other = otherText ? norm(otherText) : "";
  const terms = [...new Set(glossary.map((g) => g.trim()).filter((g) => norm(g).length >= 2))];
  const flags: CrossFlag[] = [];
  let ptr = 0; let sum = 0; let counted = 0;
  mainLines.forEach((raw, idx) => {
    const m = norm(raw);
    if (!m) return;
    const kinds = new Set<"disagree" | "glossary">(); let otherSeg: string | undefined; let term: string | undefined;
    if (other) {
      // Only a window around where the previous line ended is searched: the two transcripts run in the same order.
      const from = Math.max(0, ptr - 40), to = Math.min(other.length, ptr + m.length * 2 + 60);
      const fit = bestFit(m, other.slice(from, to));
      const ratio = fit.dist / m.length;
      if (ratio <= 0.6) ptr = from + fit.end; else ptr = Math.min(other.length, ptr + m.length);
      sum += Math.max(0, 1 - ratio); counted++;
      otherSeg = other.slice(from + fit.start, from + fit.end).slice(0, 120);
      if ((fit.dist >= 2 && ratio >= DISAGREE_RATIO) || digitString(m) !== digitString(otherSeg)) kinds.add("disagree");
    }
    for (const t of terms) {
      const nt = norm(t);
      if (m.includes(nt)) continue;
      if (otherSeg && otherSeg.includes(nt)) { kinds.add("glossary"); term ??= t; continue; } // the second model wrote the listed term, the main model did not
      if (nearMiss(raw, t)) { kinds.add("glossary"); term ??= t; }
    }
    if (kinds.size) flags.push({ line: idx + 1, kinds: [...kinds], ...(otherSeg && kinds.has("disagree") ? { other: otherSeg } : {}), ...(term ? { term } : {}) });
  });
  return { flags, agreement: counted ? Math.round((sum / counted) * 1000) / 1000 : null };
}

// ---------------------------------------------------------------- summary self-check

export interface SelfCheck {
  /** items in the summary (decisions + actions + suggestions) and how many cite at least one existing line (the parser already drops the rest) */
  items: number; withSource: number;
  /** the parser's drops: items with no usable source line */
  dropped: number;
  actionsNoOwner: number; actionsNoDue: number;
  /** items whose cited lines include a 待確認 line (their wording may be built on a mis-heard line) */
  uncertain: number;
  /** items that quote a number the cited lines do not contain */
  numberMismatch: number;
  /** nothing to flag: every item has a source, an owner and a date where it is an action, and nothing rests on a doubtful line */
  clean: boolean;
}
const CJK_NUM = /[零〇一二兩两三四五六七八九十百千萬万]/;
const digitsOf = (s: string): string[] => (s.replace(/(\d),(?=\d{3})/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []);

/** Program check of a parsed summary against the transcript; the model is not asked to grade its own work. */
export function selfCheck(
  s: { decisions: { text: string; lines: number[] }[]; actions: { task: string; owner: string | null; due: string | null; lines: number[] }[]; suggestions: { text: string; lines: number[] }[]; dropped: number },
  lines: string[], flagged: ReadonlySet<number> = new Set(),
): { check: SelfCheck; uncertainOf: (cited: number[]) => boolean; mismatchOf: (text: string, cited: number[]) => boolean } {
  const uncertainOf = (cited: number[]) => cited.some((n) => flagged.has(n));
  const mismatchOf = (text: string, cited: number[]) => {
    const src = cited.map((n) => lines[n - 1] ?? "").join(" ").replace(/(\d),(?=\d{3})/g, "$1");
    if (CJK_NUM.test(src)) return false; // the transcript spells numbers in Chinese: a digit in the summary cannot be compared
    return digitsOf(text).some((d) => d.length >= 2 && !src.includes(d));
  };
  const all = [...s.decisions.map((x) => ({ text: x.text, lines: x.lines })), ...s.actions.map((x) => ({ text: x.task, lines: x.lines })), ...s.suggestions.map((x) => ({ text: x.text, lines: x.lines }))];
  const withSource = all.filter((x) => x.lines.length > 0 && x.lines.every((n) => n >= 1 && n <= lines.length && (lines[n - 1] ?? "").trim() !== "")).length;
  const check: SelfCheck = {
    items: all.length, withSource, dropped: s.dropped,
    actionsNoOwner: s.actions.filter((a) => a.owner === null).length, actionsNoDue: s.actions.filter((a) => a.due === null).length,
    uncertain: all.filter((x) => uncertainOf(x.lines)).length, numberMismatch: all.filter((x) => mismatchOf(x.text, x.lines)).length, clean: false,
  };
  check.clean = check.withSource === check.items && check.dropped === 0 && check.actionsNoOwner === 0 && check.actionsNoDue === 0 && check.uncertain === 0 && check.numberMismatch === 0;
  return { check, uncertainOf, mismatchOf };
}
