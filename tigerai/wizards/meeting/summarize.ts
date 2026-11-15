// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: pure functions shared by the server and the tests. The model only writes sentences; everything that can be
// decided by a program (line numbers, who is unowned, what is overdue, whether a source exists) is decided here.

export const MAX_LINES = 5000;
export const MAX_TRANSCRIPT_CHARS = 80_000;

/** One numbered line per source row. Line n of the stored transcript is exactly line n quoted as a source. */
export function segmentTranscript(raw: string): string[] {
  const out: string[] = [];
  for (const row of String(raw ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = row.replace(/[ \t　]+/g, " ").trim();
    if (!line) continue;
    if (line.length <= 140) { out.push(line); continue; }
    // Long block (ASR output is often one paragraph): cut after sentence ends, then merge short pieces up to ~140 characters.
    const sentences = line.split(/(?<=[。！？!?；;])\s*|(?<=[.])\s+/).filter(Boolean);
    let cur = "";
    for (let s of sentences) {
      while (s.length > 200) { if (cur) { out.push(cur); cur = ""; } out.push(s.slice(0, 200)); s = s.slice(200); }
      if (cur && cur.length + s.length > 140) { out.push(cur); cur = ""; }
      cur += (cur && /[A-Za-z0-9]$/.test(cur) && /^[A-Za-z0-9]/.test(s) ? " " : "") + s;
      if (cur.length >= 60) { out.push(cur); cur = ""; }
    }
    if (cur) out.push(cur);
  }
  return out.slice(0, MAX_LINES);
}

export interface Person { id: string; name: string }
export interface Decision { text: string; lines: number[] }
export interface Suggestion { text: string; lines: number[] }
export interface ActionItem {
  idx: number; task: string; owner: string | null; ownerId: string | null; due: string | null; lines: number[];
  /** Program-derived, never from the model. */
  unowned: boolean; noDue: boolean; overdue: boolean;
}
export interface Summary { decisions: Decision[]; actions: ActionItem[]; suggestions: Suggestion[]; dropped: number }

export const SYSTEM_PROMPT = [
  "你是公司內部會議記錄的整理助理。你只做整理,不做決定,也不替任何人答應事情。",
  "輸入是一份逐字稿,每一行開頭是行號,例如 [12]。請只輸出一個 JSON 物件,不要輸出 JSON 以外的任何文字:",
  '{"decisions":[{"text":"會議中明確做出的決議","lines":[行號]}],',
  ' "actions":[{"task":"要做的事","owner":"負責人姓名,逐字稿沒說就填 null","due":"YYYY-MM-DD,逐字稿沒說清楚就填 null","lines":[行號]}],',
  ' "suggestions":[{"text":"建議的後續追蹤","lines":[行號]}]}',
  "規則:1) 每一項都必須有 lines,列出支持它的逐字稿行號;沒有逐字稿依據的內容不要寫。",
  "2) 負責人只能用逐字稿裡出現的名字;沒有人說要負責就填 null,不要猜。逐字稿提到「沒人接、還沒找到人」的待辦也要列進 actions,owner 填 null。3) 日期只在逐字稿有明確日期或明確的相對日期(例如「下週五」)時才填,並依提供的今天日期換算成 YYYY-MM-DD;其餘填 null。",
  "4) 全部用繁體中文,每項一句話,不要編造數字或日期。5) 沒有的類別給空陣列。",
].join("\n");

export function buildUserPrompt(lines: string[], ctx: { title: string; today: string; people: Person[] }): string {
  const numbered = lines.map((l, i) => `[${i + 1}] ${l}`).join("\n");
  return [
    `今天日期:${ctx.today}。會議名稱:${ctx.title}。`,
    ctx.people.length ? `可能的與會者(姓名):${ctx.people.map((p) => p.name).join("、")}` : "",
    "逐字稿:", numbered,
  ].filter(Boolean).join("\n");
}

const NONE = new Set(["", "null", "none", "n/a", "無", "沒有", "未定", "待定", "不明", "未指定", "不詳", "無人", "tbd"]);

function cleanJsonText(raw: string): string {
  return String(raw ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
}

function toLines(v: unknown, max: number): number[] {
  if (!Array.isArray(v)) return [];
  const set = new Set<number>();
  for (const x of v) { const n = typeof x === "string" && /^\d+$/.test(x.trim()) ? Number(x) : x; if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max) set.add(n); }
  return [...set].sort((a, b) => a - b).slice(0, 8);
}
const textOf = (v: unknown, max = 300): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function resolveOwner(name: string, people: Person[]): string | null {
  const exact = people.filter((p) => p.name === name);
  if (exact.length === 1) return exact[0].id;
  if (name.length < 2) return null;
  const loose = people.filter((p) => name.includes(p.name) || p.name.includes(name));
  return loose.length === 1 ? loose[0].id : null;
}

/** Validate the model's answer against the transcript. Items without a real source are dropped and counted; the result is only what passes. */
export function parseSummary(raw: string, ctx: { lineCount: number; today: string; people: Person[] }): Summary | null {
  const cleaned = cleanJsonText(raw);
  const a = cleaned.indexOf("{"); const b = cleaned.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(cleaned.slice(a, b + 1)) as Record<string, unknown>; } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  let dropped = 0;
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
  const decisions: Decision[] = []; const suggestions: Suggestion[] = []; const actions: ActionItem[] = [];
  for (const d of list(obj.decisions)) {
    const text = textOf(d.text); const lines = toLines(d.lines, ctx.lineCount);
    if (!text || lines.length === 0) { dropped += 1; continue; }
    decisions.push({ text, lines });
  }
  for (const s of list(obj.suggestions)) {
    const text = textOf(s.text); const lines = toLines(s.lines, ctx.lineCount);
    if (!text || lines.length === 0) { dropped += 1; continue; }
    suggestions.push({ text, lines });
  }
  for (const x of list(obj.actions)) {
    const task = textOf(x.task); const lines = toLines(x.lines, ctx.lineCount);
    if (!task || lines.length === 0) { dropped += 1; continue; }
    const ownerRaw = textOf(x.owner, 40);
    const owner = NONE.has(ownerRaw.toLowerCase()) ? null : ownerRaw;
    const dueRaw = typeof x.due === "string" ? x.due.trim() : "";
    const due = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) && !Number.isNaN(Date.parse(`${dueRaw}T12:00:00Z`)) && new Date(`${dueRaw}T12:00:00Z`).toISOString().startsWith(dueRaw) ? dueRaw : null;
    actions.push({
      idx: actions.length, task, owner, ownerId: owner ? resolveOwner(owner, ctx.people) : null, due, lines,
      unowned: owner === null, noDue: due === null, overdue: due !== null && due < ctx.today,
    });
  }
  return { decisions, actions, suggestions, dropped };
}

const refText = (lines: number[]) => `〔第 ${lines.join("、")} 行〕`;

/** Quote of every cited line (first 40 characters), so a reader can check a source without opening anything. */
function quotes(summary: Summary, lines: string[]): string {
  const cited = new Set<number>();
  for (const x of [...summary.decisions, ...summary.actions, ...summary.suggestions]) for (const n of x.lines) cited.add(n);
  const rows = [...cited].sort((a, b) => a - b).slice(0, 24).map((n) => `- 第 ${n} 行:「${(lines[n - 1] ?? "").slice(0, 40)}${(lines[n - 1] ?? "").length > 40 ? "…" : ""}」`);
  return rows.length ? `\n**出處對照**\n${rows.join("\n")}` : "";
}

export interface RenderMeta { title: string; date: string }

/** The draft that is posted: in a room it carries 記錄 / 提醒 / 建議 and only the COUNT of unowned items (監督 goes to the supervisors privately). */
export function renderSummary(meta: RenderMeta, s: Summary, lines: string[], audience: "room" | "personal"): string {
  const out: string[] = [`**會議摘要(AI 草稿,待確認)** · ${meta.title} · ${meta.date}`, "> 這是 AI 依逐字稿整理的草稿,每一項都附逐字稿行號作為出處;要不要採用、要不要開交辦單,由人決定。", ""];
  out.push("**記錄:決議**");
  out.push(...(s.decisions.length ? s.decisions.map((d, i) => `${i + 1}. ${d.text} ${refText(d.lines)}`) : ["- 這場會議沒有整理出明確的決議。"]));
  out.push("", "**提醒:待辦與期限**");
  out.push(...(s.actions.length ? s.actions.map((a) => `- ${a.task} — 負責:${a.owner ?? "(沒人負責)"};期限:${a.due ?? "(未定)"}${a.overdue ? "(已過期)" : ""} ${refText(a.lines)}`) : ["- 沒有整理出待辦。"]));
  const unowned = s.actions.filter((a) => a.unowned);
  if (audience === "personal") {
    out.push("", "**監督:沒人負責的事**");
    out.push(...(unowned.length ? unowned.map((a) => `- ${a.task} ${refText(a.lines)}`) : ["- 每件待辦都有人負責。"]));
  } else if (unowned.length) {
    out.push("", `**監督:**有 ${unowned.length} 件事沒有人負責,已另外通知頻道建立者與主管。`);
  }
  out.push("", "**建議:後續追蹤**");
  out.push(...(s.suggestions.length ? s.suggestions.map((g, i) => `${i + 1}. ${g.text} ${refText(g.lines)}`) : ["- 沒有額外建議。"]));
  if (s.dropped > 0) out.push("", `_有 ${s.dropped} 項因為找不到逐字稿出處,已被系統擋下,沒有列出。_`);
  out.push(quotes(s, lines));
  return out.join("\n").trim();
}

/** Prefill for the 交辦單 form of one action (the person still reads, edits and presses 建立). */
export function assignmentPrefill(meta: RenderMeta, a: ActionItem, lines: string[]): { title: string; description: string; assigneeId: string; dueDate: string } {
  const src = a.lines.map((n) => `第 ${n} 行:「${(lines[n - 1] ?? "").slice(0, 80)}」`).join("\n");
  return {
    title: a.task.slice(0, 120),
    description: `來源:會議「${meta.title}」(${meta.date})\n${a.owner ? `會議中提到的負責人:${a.owner}\n` : ""}逐字稿出處\n${src}`.slice(0, 4000),
    assigneeId: a.ownerId ?? "", dueDate: a.due ?? "",
  };
}

export function todayOf(now = Date.now(), tzoMinutes = -480): string {
  return new Date(now - tzoMinutes * 60_000).toISOString().slice(0, 10);
}
