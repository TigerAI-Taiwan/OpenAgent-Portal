// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { ServiceError, type Role } from "../accounts/service";

/**
 * Who may open a pi session. Ownership is a side table (session id -> user),
 * never a change to pi's .jsonl files. No row means "nobody owns it": only an
 * administrator may open it, so sessions that predate this module never leak.
 */

export interface OwnerRow { session_id: string; user_id: string; cwd: string | null; kind: string; room_id: string | null }

export function getOwner(sessionId: string): OwnerRow | null {
  return (getDb().prepare("SELECT session_id,user_id,cwd,kind,room_id FROM session_owner WHERE session_id=?").get(sessionId) as unknown as OwnerRow) ?? null;
}

export function registerOwner(sessionId: string, userId: string, cwd: string | null, kind = "chat", roomId: string | null = null): void {
  // INSERT OR IGNORE: the first registration wins, a later call can never take a session over.
  getDb().prepare("INSERT OR IGNORE INTO session_owner (session_id,user_id,cwd,kind,room_id,created_at) VALUES (?,?,?,?,?,?)")
    .run(sessionId, userId, cwd, kind, roomId, Date.now());
}

export function isRoomMember(roomId: string, userId: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM room_members WHERE room_id=? AND user_id=?").get(roomId, userId);
}

export function canAccessSession(user: { id: string; role: Role }, sessionId: string): boolean {
  if (user.role === "admin") return true;
  const owner = getOwner(sessionId);
  if (!owner) return false;
  // A room's conversation belongs to the room: whoever started it loses it once removed from the room.
  if (owner.room_id !== null) return isRoomMember(owner.room_id, user.id);
  return owner.user_id === user.id;
}

export function filterAccessible<T extends string>(user: { id: string; role: Role }, ids: readonly T[]): T[] {
  return ids.filter((id) => canAccessSession(user, id));
}

/** True when a session must run with read-only tools whoever owns it. */
export function sessionIsRestricted(sessionId: string): boolean {
  const owner = getOwner(sessionId);
  if (!owner) return true; // unowned: fail closed
  if (owner.room_id) return true; // room-bound sessions are shared, so they stay read-only
  const row = getDb().prepare("SELECT role FROM users WHERE id=?").get(owner.user_id) as { role: string } | undefined;
  return !row || row.role !== "admin";
}

export { ServiceError };

/** Ids (of those given) that are a channel's shared AI conversation: they belong in the channel, not in any sidebar. */
export function roomBoundIds(ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  const q = getDb().prepare("SELECT 1 FROM session_owner WHERE session_id=? AND room_id IS NOT NULL");
  for (const id of ids) if (q.get(id)) out.add(id);
  return out;
}
