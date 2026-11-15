// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { type Role } from "../accounts/service";
import { getDb } from "../db/store";
import { confirmRun, decideItem, runNow, scheduleStatus, type Decision } from "../wizards/engine";
import { externalInCharge } from "../wizards/scheduler";
import { requestAdhoc } from "../wizards/adhoc";
import { ASPECT_DEFAULTS, SCHEDULED, getSettings, requireManager, saveSettings } from "../wizards/settings";
import { viewRun, privateOpenFor, skillProposalsOpen } from "../wizards/store";
import type { RunRow } from "../wizards/types";

/**
 * /api/tg/wizards/* and /api/tg/admin/wizards/* (called from router.ts). Every check is repeated here on the server: what the page hides is
 * only what these routes would refuse.
 *
 *   GET   wizards/rooms/:room/settings        settings + the latest runs (creator / head / admin)
 *   PATCH wizards/rooms/:room/settings        { daily?, weekly?, skill?: {enabled?, at?, weekday?}, aspects?: {record?, ...} }
 *   POST  wizards/rooms/:room/run             { kind: "daily" | "weekly" | "skill" }  立即執行 / 重跑
 *   POST  wizards/rooms/:room/adhoc           { aspects: ["record",...], range: {type: today|days|week|custom, n?, from?, to?}, slides?: bool }  訊息分析 (any member; 1 per 5 min per channel)
 *   POST  wizards/runs/:run/confirm           確認 a draft (creator / head / admin)
 *   POST  wizards/items/:item/:decision       adopt | dismiss (channel suggestion: creator / head / admin; skill proposal: administrator) | ack (private item: its recipient)
 *   GET   wizards/mine                        what is waiting for me (also part of bulletin/personal)
 *   GET   admin/wizards/status                who drives the schedule (the built-in timer, or an add-on's external caller), when it last ran, stale flag
 */

type Actor = { id: string; role: Role };
const out = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return {};
  try { const v = await req.json(); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; }
}

export async function wizardRoutes(req: Request, method: string, actor: Actor, seg: (string | undefined)[], admin: boolean): Promise<Response | null> {
  const [a, b, c, d] = seg;
  if (admin) {
    if (a === "status" && method === "GET") return out(scheduleStatus(Date.now(), externalInCharge()));
    return null;
  }
  if (a === "rooms" && b) {
    if (c === "settings" && method === "GET") {
      requireManager(actor, b);
      const runs = getDb().prepare("SELECT * FROM wizard_runs WHERE room_id=? ORDER BY created_at DESC LIMIT 12").all(b) as unknown as RunRow[];
      return out({ settings: getSettings(b), defaults: ASPECT_DEFAULTS, runs: runs.map(viewRun), kinds: SCHEDULED, ...(actor.role === "admin" ? { tick: scheduleStatus(Date.now(), externalInCharge()) } : {}) });
    }
    if (c === "settings" && (method === "PATCH" || method === "PUT")) return out({ settings: saveSettings(actor, b, await jsonBody(req)) });
    if (c === "adhoc" && method === "POST") {
      const i = await jsonBody(req);
      return out(await requestAdhoc(actor, b, { aspects: i.aspects, range: i.range, slides: i.slides }));
    }
    if (c === "run" && method === "POST") {
      const i = await jsonBody(req);
      return out(await runNow(actor, b, String(i.kind ?? "")));
    }
  }
  if (a === "runs" && b && c === "confirm" && method === "POST") return out({ run: confirmRun(actor, b) });
  if (a === "items" && b && (c === "adopt" || c === "dismiss" || c === "ack") && method === "POST") {
    // Only a skill proposal takes an edit (administrator, checked in decideItem); the body is optional for every other decision.
    const edit = c === "adopt" ? ((await jsonBody(req).catch(() => ({}))) as { edit?: Record<string, unknown> }).edit : undefined;
    return out(decideItem(actor, b, c as Decision, edit && typeof edit === "object" ? edit : undefined));
  }
  if (a === "mine" && method === "GET") return out({ items: privateOpenFor(actor), proposals: skillProposalsOpen(actor) });
  void d;
  return null;
}
