// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb, inTransaction } from "../db/store";
import { ServiceError } from "./service";
import { writeAudit } from "./audit";
import { closeRoom, reopenRoom } from "../rooms/service";
import { isVendor } from "./vendor";

/**
 * 封存班級／部門 (1.1.0-ce): at the end of a term an administrator archives a class. Nothing is deleted:
 *  - members stay in it and every record stays visible to administrators (and heads, as before);
 *  - its registration passphrase stops working (a new student cannot join an archived class);
 *  - the channels filed under the class (rooms.unit_id) are CLOSED (read-only, kept); channels filed under another unit or none keep running.
 *    (v11 first guessed "class channels" from who was a member; the org branch's explicit channel -> unit link replaced that guess.)
 * 取消封存 puts back exactly what the archive changed: the passphrase switch as it was, and the channels it closed (if still closed).
 */
type Actor = { id: string; role: "admin" | "member" };
const KEY = (groupId: string) => `archive.${groupId}`;
interface State { codeWasEnabled: boolean; rooms: string[] }

function requireAdmin(actor: Actor): void {
  if (actor.role !== "admin" || isVendor(actor.id)) throw new ServiceError("forbidden", "Administrator only", 403);
}
const row = (groupId: string) => getDb().prepare("SELECT id,name,archived_at FROM groups WHERE id=?").get(groupId) as { id: string; name: string; archived_at: number | null } | undefined;

/** Open channels filed under this class (rooms.unit_id, the org branch's channel -> unit link). Channels filed elsewhere or under no unit (跨部門頻道) keep running. */
export function classOnlyRooms(groupId: string): string[] {
  return (getDb().prepare("SELECT id FROM rooms WHERE unit_id=? AND deleted_at IS NULL AND closed_at IS NULL").all(groupId) as unknown as { id: string }[]).map((r) => r.id);
}

export function archiveClass(actor: Actor, groupId: string): { rooms: number } {
  requireAdmin(actor);
  const g = row(groupId);
  if (!g) throw new ServiceError("not_found", "No such group", 404);
  if (g.archived_at) throw new ServiceError("already_archived", "Already archived", 409);
  const db = getDb();
  const code = db.prepare("SELECT enabled FROM group_join_codes WHERE group_id=?").get(groupId) as { enabled: number } | undefined;
  const rooms = classOnlyRooms(groupId);
  inTransaction(() => {
    db.prepare("UPDATE groups SET archived_at=? WHERE id=?").run(Date.now(), groupId);
    if (code) db.prepare("UPDATE group_join_codes SET enabled=0, updated_at=? WHERE group_id=?").run(Date.now(), groupId);
    for (const id of rooms) closeRoom(actor, id);
    const state: State = { codeWasEnabled: code?.enabled === 1, rooms };
    db.prepare("INSERT INTO tg_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(KEY(groupId), JSON.stringify(state), Date.now());
  });
  writeAudit("class.archive", actor.id, { groupId, items: rooms.length });
  return { rooms: rooms.length };
}

export function unarchiveClass(actor: Actor, groupId: string): { rooms: number } {
  requireAdmin(actor);
  const g = row(groupId);
  if (!g) throw new ServiceError("not_found", "No such group", 404);
  if (!g.archived_at) throw new ServiceError("not_archived", "Not archived", 409);
  const db = getDb();
  let state: State = { codeWasEnabled: false, rooms: [] };
  try { state = JSON.parse((db.prepare("SELECT value FROM tg_settings WHERE key=?").get(KEY(groupId)) as { value: string } | undefined)?.value ?? "") as State; } catch { /* nothing remembered */ }
  let reopened = 0;
  inTransaction(() => {
    db.prepare("UPDATE groups SET archived_at=NULL WHERE id=?").run(groupId);
    if (state.codeWasEnabled) db.prepare("UPDATE group_join_codes SET enabled=1, updated_at=? WHERE group_id=?").run(Date.now(), groupId);
    for (const id of state.rooms) {
      const r = db.prepare("SELECT closed_at, deleted_at FROM rooms WHERE id=?").get(id) as { closed_at: number | null; deleted_at: number | null } | undefined;
      if (r && r.closed_at && !r.deleted_at) { reopenRoom(actor, id); reopened++; }
    }
    db.prepare("DELETE FROM tg_settings WHERE key=?").run(KEY(groupId));
  });
  writeAudit("class.unarchive", actor.id, { groupId, items: reopened });
  return { rooms: reopened };
}

export function archivedMap(): Map<string, number> {
  return new Map((getDb().prepare("SELECT id, archived_at FROM groups WHERE archived_at IS NOT NULL").all() as unknown as { id: string; archived_at: number }[]).map((r) => [r.id, r.archived_at]));
}
