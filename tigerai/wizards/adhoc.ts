// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { ServiceError, type Role } from "../accounts/service";
import { requireRoom } from "../rooms/service";
import { isRoomMember } from "../rooms/ownership";
import { postAi } from "../rooms/ai";
import { startWizardRun, type Outcome } from "./engine";
import { ASPECTS, ASPECT_ZH, type Aspect } from "./format";
import { MAX_ADHOC_DAYS, parseAdhoc, type RangeSpec } from "./adhoc-parse";
import { canManageWizards } from "./settings";
import { getRun, viewRun } from "./store";
import { DAY_MS, addDays, calendarDays, dayKey, localDayStart, weekStartDay } from "./time";
import type { RunView } from "./types";

/**
 * Starting a 訊息分析 (kinds/adhoc.ts): from the channel window (POST wizards/rooms/:room/adhoc) or from `@AI 用監督和提醒看最近三天`.
 * Any member of the channel may ask; what each aspect delivers and to whom is decided by the engine, not by who asked (a plain member
 * ticking 監督 or 稽核 gets nothing about others: those items go to the heads). One run per channel every 5 minutes, and the model call
 * waits for the same AI slot as every other background AI job.
 */

type Actor = { id: string; role: Role };
export const ADHOC_COOLDOWN_MS = 5 * 60_000;

export function resolveRange(spec: RangeSpec, now = Date.now()): { sinceTs: number; untilTs: number; label: string } {
  const today = dayKey(now);
  if (spec.type === "today") return { sinceTs: localDayStart(today), untilTs: now + 1, label: "今天" };
  if (spec.type === "days") {
    if (!Number.isInteger(spec.n) || spec.n < 1 || spec.n > MAX_ADHOC_DAYS) throw new ServiceError("bad_range", `天數要在 1 到 ${MAX_ADHOC_DAYS} 之間`);
    return { sinceTs: localDayStart(addDays(today, -(spec.n - 1))), untilTs: now + 1, label: `最近 ${spec.n} 天` };
  }
  if (spec.type === "week") return { sinceTs: localDayStart(weekStartDay(today)), untilTs: now + 1, label: "本週" };
  const ok = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  if (!ok(spec.from) || !ok(spec.to) || spec.from > spec.to) throw new ServiceError("bad_range", "自訂的日期要像 2026-11-10,而且起日不能晚於迄日");
  if (calendarDays(spec.from, spec.to) + 1 > MAX_ADHOC_DAYS) throw new ServiceError("bad_range", `一次最多分析 ${MAX_ADHOC_DAYS} 天`);
  return { sinceTs: localDayStart(spec.from), untilTs: Math.min(localDayStart(addDays(spec.to, 1)), now + 1), label: spec.from === spec.to ? spec.from : `${spec.from} ~ ${spec.to}` };
}

export function rangeFromInput(v: unknown): RangeSpec {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  switch (o.type) {
    case "today": return { type: "today" };
    case "week": return { type: "week" };
    case "days": return { type: "days", n: Number(o.n) };
    case "custom": return { type: "custom", from: String(o.from ?? ""), to: String(o.to ?? "") };
    default: throw new ServiceError("bad_range", "請選時間範圍");
  }
}

/** Seconds a channel still has to wait for its next ad-hoc run (0 = may start). A run that found nothing to read does not count. */
export function adhocWaitMs(roomId: string, now = Date.now()): number {
  const r = getDb().prepare("SELECT MAX(created_at) AS t FROM wizard_runs WHERE room_id=? AND kind='adhoc' AND NOT (status='skipped')").get(roomId) as { t: number | null };
  return r.t ? Math.max(0, r.t + ADHOC_COOLDOWN_MS - now) : 0;
}

export interface AdhocRequestIn { aspects: unknown; range: unknown; slides?: unknown }
export async function requestAdhoc(actor: Actor, roomId: string, input: AdhocRequestIn): Promise<{ run: RunView; outcome: Outcome; routing: { toHeadsOnly: Aspect[]; private: Aspect[] } }> {
  const room = requireRoom(actor, roomId);
  if (room.deleted_at) throw new ServiceError("not_found", "No such room", 404);
  const manager = canManageWizards(actor, room);
  if (!manager && !isRoomMember(roomId, actor.id)) throw new ServiceError("forbidden", "Only a member of this channel can ask for an analysis", 403);
  if (room.closed_at) throw new ServiceError("room_closed", "This room is closed", 409);
  const aspects = [...new Set((Array.isArray(input.aspects) ? input.aspects : []).filter((a): a is Aspect => ASPECTS.includes(a as Aspect)))];
  if (aspects.length === 0) throw new ServiceError("bad_aspects", "請至少選一個面向");
  const range = resolveRange(rangeFromInput(input.range));
  const wait = adhocWaitMs(roomId);
  if (wait > 0) throw new ServiceError("rate_limited", `這個頻道剛做過訊息分析,請 ${Math.ceil(wait / 60_000)} 分鐘後再試`, 429);
  const who = getDb().prepare("SELECT name FROM users WHERE id=?").get(actor.id) as { name: string } | undefined;
  const { run, prepared } = startWizardRun({
    kind: "adhoc", roomId, runnerId: room.owner_id, requestedBy: actor.id, trigger: "manual-adhoc", period: null,
    params: { aspects, sinceTs: range.sinceTs, untilTs: range.untilTs, rangeLabel: range.label, slides: input.slides === true, requesterId: actor.id, requesterName: who?.name ?? "?", alsoTo: manager ? [actor.id] : [] },
  });
  const outcome = await prepared;
  return { run: viewRun(getRun(run.id)!), outcome, routing: { toHeadsOnly: aspects.filter((a) => a === "supervise" || a === "audit") as Aspect[], private: aspects.filter((a) => a === "remind") as Aspect[] } };
}

/**
 * `@AI …` in a channel. Returns true when the line was an analysis request (and was answered here), false to let the plain @AI answer it.
 * Unclear (no days named) is asked back, in words the program wrote.
 */
export async function handleAdhocMention(actor: Actor, roomId: string, text: string): Promise<boolean> {
  const req = parseAdhoc(text);
  if (!req) return false;
  if (!req.range) {
    postAi(roomId, null, `要分析哪一段時間?請再說一次,例如:「@AI 用${req.aspects.map((a) => ASPECT_ZH[a]).join("和")}看最近三天」(可以說今天、最近幾天、本週)。`);
    return true;
  }
  try {
    const r = await requestAdhoc(actor, roomId, { aspects: req.aspects, range: req.range, slides: req.slides });
    const parts = [`好,開始用「${req.aspects.map((a) => ASPECT_ZH[a]).join("、")}」看${resolveRange(req.range).label}的訊息,結果會貼在頻道。`];
    if (req.defaultedAspects) parts.push("你沒有說要看哪些面向,先用「記錄、建議」。");
    if (r.routing.toHeadsOnly.length) parts.push(`${r.routing.toHeadsOnly.map((a) => ASPECT_ZH[a]).join("、")}只會送給主管,不會貼在頻道。`);
    if (r.outcome === "skipped") postAi(roomId, null, `這段時間沒有訊息可以分析。`);
    else postAi(roomId, null, parts.join(""));
  } catch (e) {
    postAi(roomId, null, e instanceof ServiceError ? e.message : "訊息分析沒有開始");
  }
  return true;
}
void DAY_MS;
