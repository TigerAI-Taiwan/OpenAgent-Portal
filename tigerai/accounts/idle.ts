// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { writeAudit } from "./audit";
import { ServiceError } from "./service";

/**
 * 閒置自動登出 (1.1.0-ce): default ON, 30 minutes without USER activity. Two halves that agree:
 *  - the page reports real input (mouse, keys, touch, scroll) at most once a minute (POST /api/tg/activity) and signs itself out when
 *    it has seen none for the configured minutes;
 *  - the server remembers the last reported input per person (user_activity.last_input) and refuses a request after the same time,
 *    bumping token_version so the cookie dies everywhere ("logs out the server-side session too"). The page's own polling (bell,
 *    running list) never counts as activity, otherwise an open tab would keep itself alive forever.
 * 0 = off (administrator's choice in 設定 → 管理).
 */
const KEY = "idle.minutes";
export const DEFAULT_IDLE_MINUTES = 30;
export const MAX_IDLE_MINUTES = 24 * 60;

export function idleMinutes(): number {
  const row = getDb().prepare("SELECT value FROM tg_settings WHERE key=?").get(KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_IDLE_MINUTES;
  const n = Number(row.value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_IDLE_MINUTES ? n : DEFAULT_IDLE_MINUTES;
}
export function setIdleMinutes(actorId: string, minutes: unknown): number {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n < 0 || n > MAX_IDLE_MINUTES) throw new ServiceError("bad_minutes", "Minutes: 0 (off) or 1 to 1440");
  getDb().prepare("INSERT INTO tg_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(KEY, String(n), Date.now());
  writeAudit("auth.idle_setting", actorId, { to: n === 0 ? "off" : `${n} min` });
  return n;
}

/** The page says: a person just did something. */
export function recordInput(userId: string, now = Date.now()): void {
  getDb().prepare("INSERT INTO user_activity (user_id,last_seen,last_input) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_input=excluded.last_input").run(userId, now, now);
}

/**
 * Called by the gate on every signed-in request. true = the session has been idle too long: it was ended here (token_version bumped,
 * audited). A person with no recorded input yet (cookie older than this feature, or just signed in) starts their window now.
 */
export function expireIfIdle(userId: string, now = Date.now()): boolean {
  const minutes = idleMinutes();
  if (minutes === 0) return false;
  const db = getDb();
  const row = db.prepare("SELECT last_input FROM user_activity WHERE user_id=?").get(userId) as { last_input: number | null } | undefined;
  if (!row || row.last_input === null || row.last_input === undefined) { recordInput(userId, now); return false; }
  if (now - row.last_input <= minutes * 60_000) return false;
  db.prepare("UPDATE users SET token_version=token_version+1 WHERE id=?").run(userId);
  db.prepare("UPDATE user_activity SET last_input=NULL WHERE user_id=?").run(userId);
  try { writeAudit("auth.idle_logout", userId, { to: `${minutes} min` }); } catch { /* best effort */ }
  return true;
}
