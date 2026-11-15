// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";

/**
 * Browser push for the one thing that must not wait for someone to look: an AI order that reached 待確認.
 *
 * Upstream's own push (app/api/push/*) stores subscriptions with no owner and sends "session complete" to every one of them, which
 * in a multi-person portal would tell everybody about everybody's conversations. So we keep our own table, bound to the person, and
 * send only to the applicant's own subscriptions. What we share with upstream is the VAPID key pair (lib/web-push, same key file) and
 * the browser side (service worker, `push` + `notificationclick` handlers in public/sw.js). The payload is a title and a link only.
 * Everything is best effort: no key, no subscription, a dead endpoint, or no network all end silently (the toast and the bell remain).
 */

export interface PushPayload { title: string; body: string; url: string; tag: string }
export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<void>;

const KEY = Symbol.for("tigerai:push-sender");
const holder = (): { send: PushSender | null } => ((globalThis as unknown as Record<symbol, { send: PushSender | null } | undefined>)[KEY] ??= { send: null });
/** Tests install a recorder. */
export function setPushSender(s: PushSender | null): void { holder().send = s; }

async function realSend(t: PushTarget, payload: PushPayload): Promise<void> {
  const [{ default: webpush }, store, reader] = await Promise.all([import("web-push"), import("../../lib/web-push"), import("../../lib/session-reader")]);
  await store.getVapidPublicKey(); // creates the key file on first use
  const file = join(reader.getAgentDir(), "web-push.json");
  if (!existsSync(file)) throw new Error("no VAPID keys");
  const keys = (JSON.parse(readFileSync(file, "utf8")) as { vapidKeys: { publicKey: string; privateKey: string } }).vapidKeys;
  await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), {
    vapidDetails: { subject: store.vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
    TTL: store.PUSH_OPTIONS.TTL, urgency: store.PUSH_OPTIONS.urgency,
  });
}

export function saveSubscription(userId: string, sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }): void {
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub.keys?.auth === "string" ? sub.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || !p256dh || !auth) throw Object.assign(new Error("Invalid push subscription"), { status: 400 });
  // One browser endpoint belongs to one person: signing in as someone else on the same browser moves it.
  getDb().prepare("INSERT INTO push_subs (endpoint,user_id,p256dh,auth,created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at")
    .run(endpoint, userId, p256dh, auth, Date.now());
  writeAudit("push.subscribe", userId, {});
}

export function subscriptionCount(userId: string): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?").get(userId) as { n: number }).n;
}

/** Sends to this person's own subscriptions only. Returns how many sends were attempted. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  const rows = getDb().prepare("SELECT endpoint,p256dh,auth FROM push_subs WHERE user_id=?").all(userId) as unknown as (PushTarget)[];
  const send = holder().send ?? realSend;
  let tried = 0;
  for (const r of rows) {
    tried++;
    try { await send(r, payload); } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) getDb().prepare("DELETE FROM push_subs WHERE endpoint=?").run(r.endpoint);
    }
  }
  return tried;
}

// ---------------------------------------------------------------- upstream's "session complete" push, owner only

/**
 * Upstream's /api/push/subscribe stores browser subscriptions with no owner and sends "session complete" for EVERY conversation
 * to ALL of them. Here a subscription is always bound to the signed-in person (the gate answers that route itself, see
 * adapter/gate.ts), so upstream's list stays empty and its broadcast reaches nobody. The completion push is sent by
 * `createCompletionPushExtension` to the conversation's owner only.
 */
export function subscribeBody(userId: string, body: unknown): void {
  const b = (body ?? {}) as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } };
  saveSubscription(userId, b.subscription ?? {});
}

/** Whose device is told that this conversation finished: its owner, for an ordinary conversation only. Null = nobody. */
export function completionRecipient(sessionId: string): string | null {
  const db = getDb();
  const owner = db.prepare("SELECT user_id, kind FROM session_owner WHERE session_id=?").get(sessionId) as { user_id: string; kind: string } | undefined;
  // Channel AI replies, n8n hook runs and AI orders have their own signal (the channel, the answer, 「AI 做完了」): no second push.
  if (!owner || (owner.kind !== "chat" && owner.kind !== "fork")) return null;
  const order = db.prepare("SELECT 1 AS x FROM assignments WHERE session_id=? LIMIT 1").get(sessionId);
  return order ? null : owner.user_id;
}

export async function pushSessionComplete(sessionId: string, sessionName: string | undefined): Promise<number> {
  const to = completionRecipient(sessionId);
  if (!to) return 0;
  return pushToUser(to, { title: sessionName?.trim() || "對話完成", body: "這段對話的 AI 已經做完了。", url: `/?session=${encodeURIComponent(sessionId)}`, tag: `pi-session-complete:${sessionId}` });
}

/** Subscriptions upstream stored before accounts existed belong to nobody: drop them so the broadcast can not reach them. Keys are kept. */
export function dropOwnerlessUpstreamSubscriptions(agentDir: string): number {
  const file = join(agentDir, "web-push.json");
  if (!existsSync(file)) return 0;
  try {
    const state = JSON.parse(readFileSync(file, "utf8")) as { vapidKeys?: unknown; subscriptions?: unknown[] };
    const n = Array.isArray(state.subscriptions) ? state.subscriptions.length : 0;
    if (!n) return 0;
    writeFileSync(file, JSON.stringify({ ...state, subscriptions: [] }), { mode: 0o600 });
    return n;
  } catch { return 0; }
}
