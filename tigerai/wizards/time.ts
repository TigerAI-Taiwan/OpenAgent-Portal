// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * Calendar maths for the wizards. Everything a wizard says about a date or a number of days comes from here, never from
 * the model: a weak local model computes dates wrongly and wrongly in a way that looks right ("overdue 3 days" that was 5).
 * "Today" is the company's day (TIGERAI_TZ, default Asia/Taipei), not the server's or the browser's.
 */

export const DAY_MS = 86_400_000;
export function wizardZone(): string { return process.env.TIGERAI_TZ || "Asia/Taipei"; }

export interface Local { y: number; m: number; d: number; hh: number; mm: number; /** 1 = Monday .. 7 = Sunday */ isoWeekday: number; day: string }
const two = (n: number) => String(n).padStart(2, "0");

export function localParts(ms: number, zone = wizardZone()): Local {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const y = +p.year, m = +p.month, d = +p.day;
  const iso = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[p.weekday] ?? 1;
  return { y, m, d, hh: +p.hour % 24, mm: +p.minute, isoWeekday: iso, day: `${y}-${two(m)}-${two(d)}` };
}

export const dayKey = (ms: number, zone = wizardZone()): string => localParts(ms, zone).day;

const dayNum = (day: string): number => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / DAY_MS;
/** Whole calendar days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function calendarDays(from: string, to: string): number { return Math.round(dayNum(to) - dayNum(from)); }
export function addDays(day: string, n: number): string {
  const t = new Date((dayNum(day) + n) * DAY_MS);
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`;
}
export const isoWeekdayOf = (day: string): number => ((new Date(dayNum(day) * DAY_MS).getUTCDay() + 6) % 7) + 1;
/** Monday of the week that contains `day`. */
export const weekStartDay = (day: string): string => addDays(day, -(isoWeekdayOf(day) - 1));

/** ISO week label such as "2026-W46" (the week that contains the local day). */
export function weekKey(ms: number, zone = wizardZone()): string {
  const day = dayKey(ms, zone);
  const thursday = addDays(day, 4 - isoWeekdayOf(day));
  const year = +thursday.slice(0, 4);
  const jan1 = `${year}-01-01`;
  const week = Math.floor(calendarDays(jan1, thursday) / 7) + 1;
  return `${year}-W${two(week)}`;
}

/** The instant a local calendar day starts, in ms (handles zones with a DST step by one correction pass). */
export function localDayStart(day: string, zone = wizardZone()): number {
  const guess = dayNum(day) * DAY_MS;
  const p = localParts(guess, zone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  const start = guess - (asUtc - guess);
  const q = localParts(start, zone);
  return q.day === day ? start - (q.hh * 60 + q.mm) * 60_000 : start;
}

/** "18:00" -> minutes since midnight; null when it is not a time. */
export function parseHm(v: unknown): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(v ?? "").trim());
  return m ? +m[1] * 60 + +m[2] : null;
}
export const fmtHm = (minutes: number): string => `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;

export type Schedule = { at: number; weekday: number | null };
/**
 * Is a scheduled wizard due now, and for which period?
 *   daily: from the set time on, today.
 *   weekly (weekday set): on that weekday from the set time on, and every later day of the same week until a run exists
 *   (a server that was down on Friday evening still gets its report on Saturday, once).
 * The caller decides "already ran" by looking for a run with the same period key; this only says whether the time has come.
 */
export function dueNow(s: Schedule, now: number, zone = wizardZone()): { due: boolean; period: string } {
  const p = localParts(now, zone);
  const minutes = p.hh * 60 + p.mm;
  if (s.weekday === null) return { due: minutes >= s.at, period: p.day };
  const due = p.isoWeekday > s.weekday || (p.isoWeekday === s.weekday && minutes >= s.at);
  return { due, period: weekKey(now, zone) };
}
