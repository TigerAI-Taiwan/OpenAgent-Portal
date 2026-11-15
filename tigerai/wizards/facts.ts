// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { DAY_MS, addDays, calendarDays, dayKey, isoWeekdayOf, localParts, weekStartDay, wizardZone } from "./time";

/**
 * Facts the program works out itself (dates, days, "nobody answered"): the model is handed the result and never computes it.
 * Every fact carries its sources (the messages or the work order it comes from), so what is reported can be clicked back to.
 * The rules are deliberately plain: they miss things (a question without a question mark, a promise without a date) and they
 * do not invent things. Every reported fact quotes the original text and the number the program counted.
 */

export interface Msg { seq: number; authorId: string; author: string; ts: number; text: string }
/** `x` is a quoted line of a document that is not a channel message (a meeting transcript line): shown as text, not a link. */
export type Source = { t: "m"; seq: number } | { t: "a"; id: string } | { t: "x"; label: string; quote: string };
export const sourceKey = (s: Source): string => (s.t === "m" ? `m${s.seq}` : s.t === "a" ? `a${s.id}` : `x${s.label}`);

export const UNANSWERED_AFTER_MS = 2 * DAY_MS;
export const SOON_DAYS = 2;

const PROMISE = /我(?:會|來|去|負責|處理|可以|將|要|先)|我(?=今天|今日|明天|明日|後天|大後天|下週|下周|本週|這週|這周|週[一二三四五六日天]|周[一二三四五六日天]|星期|禮拜|\d+\s*月|\d+\s*\/)|交給我|前(?:給|交|完成|寄|送|回|補)|之前(?:給|交|完成)|\bi'?ll\b|\bi will\b/i;
const DONE = /完成|好了|已交|已給|已寄|已送|已提供|搞定|交了|寄出|\bdone\b|\bfinished\b|\bsent\b|\bdelivered\b|\bsubmitted\b/i;
const QUESTION = /[?？]/;
const ZH_DAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const two = (n: number) => String(n).padStart(2, "0");

/** The calendar day a message names: "2026-11-20", "11/20", "11月20日", "明天", "下週三", "週五", "月底". Relative words count from the day the message was sent. */
export function dueDateIn(text: string, sentAt: number, zone = wizardZone()): string | null {
  const sent = localParts(sentAt, zone);
  let hit = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  let y: number | null = null; let m: number | null = null; let d: number | null = null;
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
  else if ((hit = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日號号]/.exec(text))) { m = +hit[1]; d = +hit[2]; }
  else if ((hit = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(text))) { m = +hit[1]; d = +hit[2]; }
  if (m !== null && d !== null) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    if (y === null) {
      y = sent.y;
      // "12/1" said in November is this year; "1/5" said in late December is next year.
      if (calendarDays(`${y}-${two(m)}-${two(d)}`, sent.day) > 31) y += 1;
    }
    return `${y}-${two(m)}-${two(d)}`;
  }
  const rel: [RegExp, number][] = [[/大後天/, 3], [/後天/, 2], [/明天|明日/, 1], [/今天|今日/, 0]];
  for (const [re, n] of rel) if (re.test(text)) return addDays(sent.day, n);
  const next = /下(?:週|周|禮拜|星期)([一二三四五六日天])/.exec(text);
  if (next) return addDays(weekStartDay(sent.day), 7 + ZH_DAY[next[1]] - 1);
  const here = /(?:本|這|这)(?:週|周|禮拜|星期)([一二三四五六日天])/.exec(text);
  if (here) return addDays(weekStartDay(sent.day), ZH_DAY[here[1]] - 1);
  const bare = /(?:週|周|禮拜|星期)([一二三四五六日天])/.exec(text);
  if (bare) {
    const want = ZH_DAY[bare[1]];
    return addDays(sent.day, want >= sent.isoWeekday ? want - sent.isoWeekday : 7 - sent.isoWeekday + want);
  }
  if (/月底/.test(text)) {
    const nextMonth = sent.m === 12 ? `${sent.y + 1}-01-01` : `${sent.y}-${two(sent.m + 1)}-01`;
    return addDays(nextMonth, -1);
  }
  return null;
}

const excerpt = (t: string, n = 60) => { const s = t.replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };

export interface Fact {
  kind: "promise_overdue" | "promise_soon" | "unanswered" | "assignment_overdue" | "assignment_soon";
  /** Who owes it / who asked. For a reminder this person (and nobody else) receives it. */
  ownerId: string | null; ownerName: string;
  sources: Source[];
  /** The sentence for 監督 (about a person, for the heads) and for 提醒 (to the person: "你…"); null = not reported to that audience. */
  supervise: string | null; remind: string | null;
  /** The number the program counted (days over, days left, days unanswered). */
  days: number;
}

/** Human messages only (not AI, system lines, warnings or wizard posts). */
export function promiseFacts(messages: readonly Msg[], now: number, zone = wizardZone()): Fact[] {
  const today = dayKey(now, zone);
  const out: Fact[] = [];
  messages.forEach((m, i) => {
    if (!PROMISE.test(m.text)) return;
    const due = dueDateIn(m.text, m.ts, zone);
    if (!due) return;
    if (messages.slice(i + 1).some((x) => x.authorId === m.authorId && DONE.test(x.text))) return;
    const left = calendarDays(today, due);
    const said = dayKey(m.ts, zone);
    const quote = excerpt(m.text);
    if (left < 0) {
      out.push({
        kind: "promise_overdue", ownerId: m.authorId, ownerName: m.author, sources: [{ t: "m", seq: m.seq }], days: -left,
        supervise: `${m.author}在 ${said} 說「${quote}」,承諾 ${due} 前完成,已過 ${-left} 天,之後沒有看到完成的訊息。`,
        remind: `你在 ${said} 說「${quote}」,承諾 ${due} 前完成,已過 ${-left} 天。`,
      });
    } else if (left <= SOON_DAYS) {
      out.push({
        kind: "promise_soon", ownerId: m.authorId, ownerName: m.author, sources: [{ t: "m", seq: m.seq }], days: left,
        supervise: null,
        remind: `你在 ${said} 說「${quote}」,承諾 ${due} 前完成,${left === 0 ? "今天到期" : `還有 ${left} 天`}。`,
      });
    }
  });
  return out;
}

/** A question (？) with no later message from anybody else, older than two days. */
export function unansweredFacts(messages: readonly Msg[], now: number, zone = wizardZone()): Fact[] {
  const out: Fact[] = [];
  messages.forEach((m, i) => {
    if (!QUESTION.test(m.text)) return;
    if (now - m.ts <= UNANSWERED_AFTER_MS) return;
    if (messages.slice(i + 1).some((x) => x.authorId !== m.authorId)) return;
    const days = Math.floor((now - m.ts) / DAY_MS);
    out.push({
      kind: "unanswered", ownerId: m.authorId, ownerName: m.author, sources: [{ t: "m", seq: m.seq }], days,
      // A reminder to whoever asked (the program cannot know who should answer): the question is still open, chase it or name someone.
      remind: `你在 ${dayKey(m.ts, zone)} 問「${excerpt(m.text)}」,已超過 ${days} 天沒有人回覆,可以再問一次或指定一個人。`,
      supervise: `${m.author}在 ${dayKey(m.ts, zone)} 問「${excerpt(m.text)}」,已超過 ${days} 天沒有人回覆。`,
    });
  });
  return out;
}

export interface OrderRow { id: string; title: string; assigneeId: string; assigneeName: string; /** noon-UTC of the due day */ dueDate: number | null }
/** Open work orders handed to people in the channel that are late or due within two days; a reminder for the assignee only. */
export function assignmentFacts(orders: readonly OrderRow[], now: number, zone = wizardZone()): Fact[] {
  const today = dayKey(now, zone);
  const out: Fact[] = [];
  for (const o of orders) {
    if (o.dueDate === null) continue;
    const due = new Date(o.dueDate).toISOString().slice(0, 10);
    const left = calendarDays(today, due);
    if (left > SOON_DAYS) continue;
    const when = left < 0 ? `已逾期 ${-left} 天` : left === 0 ? "今天到期" : `${left} 天後到期`;
    out.push({ kind: left < 0 ? "assignment_overdue" : "assignment_soon", ownerId: o.assigneeId, ownerName: o.assigneeName, sources: [{ t: "a", id: o.id }], days: Math.abs(left),
      // A work order that is late is the plainest "答應了、沒做到": the head of the assignee hears about it too (監督), not only the assignee (提醒).
      supervise: left < 0 ? `${o.assigneeName}的交辦單「${o.title}」期限是 ${due},已逾期 ${-left} 天,還沒有完成。` : null,
      remind: `交辦單「${o.title}」${when}。` });
  }
  return out;
}

/** The line the model sees for a fact, so it does not repeat it. */
export const factLine = (f: Fact): string => `- ${f.supervise ?? f.remind ?? ""}`;
export { isoWeekdayOf };
