// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * Who is speaking to a shared room conversation right now.
 *
 * A room assistant session belongs to the room, not to a person, so by itself it has no identity and gets no
 * n8n access (identity.ts returns null for it). Actions are bound to the person who spoke: while one room job
 * runs, that job's requester is registered here for the job's session, and the n8n extension reads it on every
 * prompt and every tool call. It is never the union of the room's members and never the room creator.
 *
 * Safe because the process runs one room AI job at a time (enqueueTask), and the entry is removed in a finally
 * block, so the next speaker never sees the previous one's tools. With nobody registered the session has no
 * identity and therefore no n8n access (fail closed).
 */
import { userById } from "../accounts/service";

const KEY = Symbol.for("tigerai:room-speaker");
function table(): Map<string, string> {
  const g = globalThis as unknown as Record<symbol, Map<string, string> | undefined>;
  return (g[KEY] ??= new Map());
}

export function setRoomSpeaker(sessionId: string, userId: string): void { table().set(sessionId, userId); }
export function clearRoomSpeaker(sessionId: string): void { table().delete(sessionId); }

/** The active person who is speaking to this room session now, or null. */
export function roomSpeaker(sessionId: string | undefined): { id: string; role: "admin" | "member" } | null {
  if (!sessionId) return null;
  const uid = table().get(sessionId);
  const u = uid ? userById(uid) : null;
  return u && u.status === "active" ? { id: u.id, role: u.role } : null;
}
