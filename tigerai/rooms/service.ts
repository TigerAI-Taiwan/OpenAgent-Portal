// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getDb, inTransaction } from "../db/store";
import { workspaceRoot } from "../config";
import { writeAudit } from "../accounts/audit";
import { ServiceError, type Role } from "../accounts/service";
import { isRoomMember } from "./ownership";

type Actor = { id: string; role: Role };

export interface RoomRow {
  id: string; name: string; owner_id: string; bound_session_id: string | null; created_at: number;
  closed_at: number | null; closed_by: string | null; deleted_at: number | null; deleted_by: string | null;
}
export const PURGE_AFTER_MS = 30 * 24 * 3600_000;
const HEAD_VIEW_AUDIT_MS = 3600_000;
export interface MessageRow { seq: number; room_id: string; author_id: string; text: string; mentions: string; ts: number; kind: string }

export function roomDir(roomId: string): string {
  return join(workspaceRoot(), "rooms", roomId);
}

export function getRoom(id: string): RoomRow | null {
  return (getDb().prepare("SELECT * FROM rooms WHERE id=?").get(id) as unknown as RoomRow) ?? null;
}

/** Heads: group managers of a group that any current member of the room belongs to. */
export function isHeadOfRoom(userId: string, roomId: string): boolean {
  return !!getDb().prepare(
    `SELECT 1 FROM memberships h JOIN memberships m ON m.group_id=h.group_id JOIN room_members rm ON rm.user_id=m.user_id
     WHERE h.user_id=? AND h.is_manager=1 AND rm.room_id=? LIMIT 1`,
  ).get(userId, roomId);
}

export type MyRole = "admin" | "head" | "head-viewer" | "manager" | "member" | "viewer";
export function roleIn(actor: Actor, room: RoomRow): MyRole {
  if (actor.role === "admin") return "admin";
  const member = isRoomMember(room.id, actor.id);
  if (isHeadOfRoom(actor.id, room.id)) return member ? "head" : "head-viewer";
  if (room.owner_id === actor.id) return "manager";
  return member ? "member" : "viewer";
}

const isModerator = (r: MyRole) => r === "admin" || r === "head" || r === "head-viewer";

function auditHeadView(actor: Actor, roomId: string): void {
  const since = Date.now() - HEAD_VIEW_AUDIT_MS;
  const seen = getDb().prepare("SELECT 1 FROM audit WHERE action='room.head_view' AND actor_id=? AND extra LIKE ? AND ts>? LIMIT 1").get(actor.id, `%"${roomId}"%`, since);
  if (!seen) writeAudit("room.head_view", actor.id, { roomId });
}

/**
 * Throws 404 (not 403) for someone who may not see the room, so its existence is not revealed.
 * Deleted rooms do not exist for anybody (the admin deleted-list and restore use getRoom directly).
 * A head who is not a member may read; each read is audited (at most once an hour per head and room).
 */
export function requireRoom(actor: Actor, roomId: string, opts: { allowDeleted?: boolean } = {}): RoomRow {
  purgeExpired();
  const room = getRoom(roomId);
  if (!room || (room.deleted_at && !(opts.allowDeleted && actor.role === "admin"))) throw new ServiceError("not_found", "No such room", 404);
  if (actor.role === "admin" || isRoomMember(roomId, actor.id)) return room;
  if (isHeadOfRoom(actor.id, roomId)) { auditHeadView(actor, roomId); return room; }
  throw new ServiceError("not_found", "No such room", 404);
}

function requireOpen(room: RoomRow): void {
  if (room.closed_at) throw new ServiceError("room_closed", "This room is closed", 409);
}

function requireManager(actor: Actor, room: RoomRow): void {
  if (actor.role !== "admin" && room.owner_id !== actor.id) throw new ServiceError("forbidden", "Only the room owner or an administrator can do this", 403);
}

function requireModerator(actor: Actor, room: RoomRow): void {
  if (!isModerator(roleIn(actor, room))) throw new ServiceError("forbidden", "Only a department head or an administrator can do this", 403);
}

/** Closing and reopening (not deleting): moderators, and the person who created the room. Deleting stays administrator only. */
function requireCloser(actor: Actor, room: RoomRow): void {
  if (!isModerator(roleIn(actor, room)) && room.owner_id !== actor.id) throw new ServiceError("forbidden", "Only the room owner, a department head or an administrator can do this", 403);
}

/** What the client may show; the server re-checks every action regardless. */
export function accessFlags(actor: Actor, room: RoomRow) {
  const myRole = roleIn(actor, room);
  const isMember = isRoomMember(room.id, actor.id);
  const closed = !!room.closed_at;
  const deleted = !!room.deleted_at;
  const closer = isModerator(myRole) || room.owner_id === actor.id;
  return {
    isMember, closed, deleted, myRole,
    canPost: isMember && !closed && !deleted,
    canJoin: !isMember && !closed && !deleted && (actor.role === "admin" || isHeadOfRoom(actor.id, room.id)),
    can: {
      warn: isModerator(myRole) && !deleted,
      close: closer && !closed && !deleted,
      reopen: closer && closed && !deleted,
      delete: actor.role === "admin" && !deleted,
      manageMembers: (actor.role === "admin" || room.owner_id === actor.id) && !closed && !deleted,
    },
  };
}

function systemMessage(roomId: string, authorId: string, kind: "warning" | "system", text: string): void {
  getDb().prepare("INSERT INTO room_messages (room_id,author_id,text,mentions,ts,kind) VALUES (?,?,?,?,?,?)").run(roomId, authorId, text, "[]", Date.now(), kind);
}

export function warnRoom(actor: Actor, roomId: string, text: string): void {
  const room = requireRoom(actor, roomId);
  requireModerator(actor, room);
  const clean = String(text ?? "").trim();
  if (!clean) throw new ServiceError("empty", "Warning text is required");
  if (clean.length > 500) throw new ServiceError("too_long", "Warning is too long (max 500 characters)");
  systemMessage(roomId, actor.id, "warning", clean);
  writeAudit("room.warn", actor.id, { roomId });
}

export function closeRoom(actor: Actor, roomId: string): void {
  const room = requireRoom(actor, roomId);
  requireCloser(actor, room);
  if (room.closed_at) throw new ServiceError("room_closed", "Already closed", 409);
  getDb().prepare("UPDATE rooms SET closed_at=?, closed_by=? WHERE id=?").run(Date.now(), actor.id, roomId);
  systemMessage(roomId, actor.id, "system", `頻道已由 ${nameOf(actor.id)} 關閉`);
  writeAudit("room.close", actor.id, { roomId, byCreator: room.owner_id === actor.id });
}

export function reopenRoom(actor: Actor, roomId: string): void {
  const room = requireRoom(actor, roomId);
  requireCloser(actor, room);
  if (!room.closed_at) throw new ServiceError("not_closed", "The room is not closed", 409);
  getDb().prepare("UPDATE rooms SET closed_at=NULL, closed_by=NULL WHERE id=?").run(roomId);
  systemMessage(roomId, actor.id, "system", `頻道已由 ${nameOf(actor.id)} 重新開啟`);
  writeAudit("room.reopen", actor.id, { roomId, byCreator: room.owner_id === actor.id });
}

const nameOf = (id: string): string => (getDb().prepare("SELECT name FROM users WHERE id=?").get(id) as { name: string } | undefined)?.name ?? "?";

/** Admin only. Soft delete: hidden from everybody, restorable for 30 days. */
export function deleteRoom(actor: Actor, roomId: string): void {
  if (actor.role !== "admin") throw new ServiceError("forbidden", "Administrator only", 403);
  const room = requireRoom(actor, roomId);
  getDb().prepare("UPDATE rooms SET deleted_at=?, deleted_by=? WHERE id=?").run(Date.now(), actor.id, roomId);
  writeAudit("room.delete", actor.id, { roomId, name: room.name });
}

export function restoreRoom(actor: Actor, roomId: string): void {
  if (actor.role !== "admin") throw new ServiceError("forbidden", "Administrator only", 403);
  purgeExpired();
  const room = getRoom(roomId);
  if (!room || !room.deleted_at) throw new ServiceError("not_found", "No such deleted room", 404);
  getDb().prepare("UPDATE rooms SET deleted_at=NULL, deleted_by=NULL WHERE id=?").run(roomId);
  writeAudit("room.restore", actor.id, { roomId, name: room.name });
}

export function listDeletedRooms(actor: Actor) {
  if (actor.role !== "admin") throw new ServiceError("forbidden", "Administrator only", 403);
  purgeExpired();
  const rows = getDb().prepare("SELECT r.id, r.name, r.deleted_at AS deletedAt, COALESCE(u.name,'?') AS deletedByName FROM rooms r LEFT JOIN users u ON u.id=r.deleted_by WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC").all() as unknown as { id: string; name: string; deletedAt: number; deletedByName: string }[];
  return rows.map((r) => ({ ...r, daysLeft: Math.max(0, Math.ceil((r.deletedAt + PURGE_AFTER_MS - Date.now()) / 86400_000)) }));
}

/**
 * Lazy purge: runs when rooms are read. Messages are append-only by trigger, so the purge drops that
 * trigger inside its own transaction and puts it back before committing.
 */
export function purgeExpired(now = Date.now()): number {
  const db = getDb();
  const old = db.prepare("SELECT id, name FROM rooms WHERE deleted_at IS NOT NULL AND deleted_at<=?").all(now - PURGE_AFTER_MS) as unknown as { id: string; name: string }[];
  for (const r of old) {
    inTransaction(() => {
      db.exec("DROP TRIGGER IF EXISTS rm_no_delete");
      try {
        db.prepare("DELETE FROM room_messages WHERE room_id=?").run(r.id);
      } finally {
        db.exec("CREATE TRIGGER IF NOT EXISTS rm_no_delete BEFORE DELETE ON room_messages BEGIN SELECT RAISE(ABORT, 'room messages are append-only'); END");
      }
      for (const t of ["room_members", "room_reads", "room_assistants"]) db.prepare(`DELETE FROM ${t} WHERE room_id=?`).run(r.id);
      db.prepare("DELETE FROM rooms WHERE id=?").run(r.id);
    });
    if (/^r[0-9a-f]{12}$/.test(r.id)) { try { rmSync(roomDir(r.id), { recursive: true, force: true }); } catch { /* best effort */ } }
    writeAudit("room.purge", null, { roomId: r.id, name: r.name });
  }
  return old.length;
}

/** An admin or a head joins a room they are not in (speaking notifies real people, so it is an explicit step). */
export function joinRoom(actor: Actor, roomId: string): void {
  const room = requireRoom(actor, roomId);
  if (!(actor.role === "admin" || isHeadOfRoom(actor.id, roomId))) throw new ServiceError("forbidden", "Ask the room owner to add you", 403);
  requireOpen(room);
  getDb().prepare("INSERT OR IGNORE INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(roomId, actor.id, actor.id, Date.now());
  writeAudit("room.join", actor.id, { roomId });
}

/** True when nothing may be posted or answered (closed or deleted or gone). */
export function roomIsOpen(roomId: string): boolean {
  const r = getRoom(roomId);
  return !!r && !r.closed_at && !r.deleted_at;
}

export function createRoom(actor: Actor, name: string, memberIds: string[] = []): RoomRow {
  const clean = String(name ?? "").trim();
  if (!clean || clean.length > 80) throw new ServiceError("bad_name", "Room name is required (max 80 characters)");
  const id = `r${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  inTransaction(() => {
    const db = getDb();
    // Two rooms with one name in the same list cannot be told apart (seen in the first walk-through: the script ran twice).
    // The check shares the transaction with the insert, so a double submit cannot slip a second one in.
    const same = db.prepare("SELECT 1 FROM rooms r WHERE r.deleted_at IS NULL AND lower(r.name)=lower(?) AND (?=1 OR EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.user_id=?))").get(clean, actor.role === "admin" ? 1 : 0, actor.id);
    if (same) throw new ServiceError("exists", "A room with this name already exists", 409);
    db.prepare("INSERT INTO rooms (id,name,owner_id,created_at) VALUES (?,?,?,?)").run(id, clean, actor.id, Date.now());
    db.prepare("INSERT INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(id, actor.id, actor.id, Date.now());
  });
  mkdirSync(roomDir(id), { recursive: true, mode: 0o700 });
  writeAudit("room.create", actor.id, { roomId: id, name: clean });
  for (const uid of memberIds) if (uid !== actor.id) addMember(actor, id, uid);
  return getRoom(id)!;
}

export function addMember(actor: Actor, roomId: string, userId: string): void {
  const room = requireRoom(actor, roomId);
  requireManager(actor, room);
  requireOpen(room);
  const db = getDb();
  const u = db.prepare("SELECT status FROM users WHERE id=?").get(userId) as { status: string } | undefined;
  if (!u || u.status !== "active") throw new ServiceError("not_found", "No such user", 404);
  db.prepare("INSERT OR IGNORE INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(roomId, userId, actor.id, Date.now());
  writeAudit("room.member_add", actor.id, { roomId, userId });
}

export function removeMember(actor: Actor, roomId: string, userId: string): void {
  const room = requireRoom(actor, roomId);
  requireManager(actor, room);
  requireOpen(room);
  if (userId === room.owner_id) throw new ServiceError("owner", "The room owner cannot be removed", 409);
  getDb().prepare("DELETE FROM room_members WHERE room_id=? AND user_id=?").run(roomId, userId);
  writeAudit("room.member_remove", actor.id, { roomId, userId });
}

export function listMembers(roomId: string): { id: string; name: string }[] {
  return getDb().prepare("SELECT u.id, u.name FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=? ORDER BY u.name").all(roomId) as unknown as { id: string; name: string }[];
}

export function listRooms(actor: Actor): (RoomRow & { unread: number; mentioned: number; isMember: boolean; closed: boolean; myRole: MyRole })[] {
  purgeExpired();
  const db = getDb();
  const rooms = (actor.role === "admin"
    ? db.prepare("SELECT * FROM rooms WHERE deleted_at IS NULL ORDER BY created_at DESC").all()
    // Rooms I am in, plus rooms a member of one of my groups is in when I am that group's head (shown as view-only rows).
    : db.prepare(`SELECT r.* FROM rooms r WHERE r.deleted_at IS NULL AND (
        EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.user_id=?)
        OR EXISTS (SELECT 1 FROM memberships h JOIN memberships m2 ON m2.group_id=h.group_id JOIN room_members rm ON rm.user_id=m2.user_id
                   WHERE h.user_id=? AND h.is_manager=1 AND rm.room_id=r.id)
      ) ORDER BY r.created_at DESC`).all(actor.id, actor.id)) as unknown as RoomRow[];
  return rooms.map((r) => {
    const isMember = isRoomMember(r.id, actor.id);
    const last = (db.prepare("SELECT last_seq FROM room_reads WHERE room_id=? AND user_id=?").get(r.id, actor.id) as { last_seq: number } | undefined)?.last_seq ?? 0;
    // Only rooms you are in have an unread count; a system line (closed/reopened) is not news.
    const msgs = isMember ? db.prepare("SELECT mentions FROM room_messages WHERE room_id=? AND seq>? AND author_id<>? AND kind<>'system'").all(r.id, last, actor.id) as unknown as { mentions: string }[] : [];
    const mentioned = msgs.filter((m) => { try { return (JSON.parse(m.mentions) as string[]).includes(actor.id); } catch { return false; } }).length;
    return { ...r, unread: msgs.length, mentioned, isMember, closed: !!r.closed_at, myRole: roleIn(actor, r) };
  });
}

/** `@name` (no spaces: user names cannot contain them) resolved against the room's members only. */
export function parseMentions(text: string, members: { id: string; name: string }[]): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/@([^\s@]+)/g)) {
    const hit = members.find((u) => u.name.toLowerCase() === m[1].toLowerCase());
    if (hit) found.add(hit.id);
  }
  return [...found];
}

export function postMessage(actor: Actor, roomId: string, text: string): MessageRow {
  const room = requireRoom(actor, roomId);
  // An admin or head outside the room may read it but speaks only after joining: speaking notifies real people.
  if (!isRoomMember(roomId, actor.id)) throw new ServiceError("forbidden", "Join the room to post", 403);
  requireOpen(room);
  const body = String(text ?? "").trim();
  if (!body) throw new ServiceError("empty", "Message is empty");
  if (body.length > 4000) throw new ServiceError("too_long", "Message is too long (max 4000 characters)");
  const mentions = parseMentions(body, listMembers(roomId));
  const db = getDb();
  const res = db.prepare("INSERT INTO room_messages (room_id,author_id,text,mentions,ts) VALUES (?,?,?,?,?)")
    .run(roomId, actor.id, body, JSON.stringify(mentions), Date.now());
  const seq = Number(res.lastInsertRowid);
  // Your own message counts as read.
  markRead(actor, roomId, seq);
  return db.prepare("SELECT * FROM room_messages WHERE seq=?").get(seq) as unknown as MessageRow;
}

export function readMessages(actor: Actor, roomId: string, afterSeq = 0, limit = 200, allowDeleted = false): (MessageRow & { author: string })[] {
  requireRoom(actor, roomId, { allowDeleted });
  return getDb().prepare(
    "SELECT m.*, COALESCE(u.name, (SELECT a.name FROM agents a WHERE 'agent:' || a.id = m.author_id), (SELECT 'n8n:' || h.name FROM hook_keys h WHERE 'hook:' || h.id = m.author_id), 'AI') AS author FROM room_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.room_id=? AND m.seq>? ORDER BY m.seq LIMIT ?",
  ).all(roomId, afterSeq, Math.min(limit, 500)) as unknown as (MessageRow & { author: string })[];
}

/** The cursor only moves forward (a trigger enforces it too). */
export function markRead(actor: Actor, roomId: string, seq: number): void {
  if (!isRoomMember(roomId, actor.id)) return;
  getDb().prepare(
    "INSERT INTO room_reads (room_id,user_id,last_seq) VALUES (?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET last_seq=MAX(last_seq, excluded.last_seq)",
  ).run(roomId, actor.id, Math.max(0, Math.floor(seq)));
}

/** Move the pointer to the newest message (seq 0 / omitted from the API). Returns the new pointer. */
export function markReadLatest(actor: Actor, roomId: string): number {
  const latest = (getDb().prepare("SELECT COALESCE(MAX(seq),0) AS s FROM room_messages WHERE room_id=?").get(roomId) as { s: number }).s;
  markRead(actor, roomId, latest);
  return latest;
}

export function bindSession(actor: Actor, roomId: string, sessionId: string): void {
  const room = requireRoom(actor, roomId);
  if (room.bound_session_id) throw new ServiceError("bound", "This room already has an AI conversation", 409);
  getDb().prepare("UPDATE rooms SET bound_session_id=? WHERE id=? AND bound_session_id IS NULL").run(sessionId, roomId);
  writeAudit("room.bind_session", actor.id, { roomId, sessionId });
}
