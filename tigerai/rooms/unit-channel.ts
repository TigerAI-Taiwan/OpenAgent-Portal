// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 部門當作頻道: every unit owns one channel from the day it exists, and 全公司頻道 holds everyone.
// Raw SQL on purpose: accounts/service calls this, and rooms/service imports accounts/service (no import cycle wanted).
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/store";
import { workspaceRoot } from "../config";
import { writeAudit } from "../accounts/audit";

export const COMPANY_ROOM_NAME = "全公司頻道";
const COMPANY_KEY = "company_room_id";

function newRoom(ownerId: string, name: string, unitId: string | null, isDefault: boolean): string | null {
  const db = getDb();
  // A channel with this name already exists (a hand-made one): do not guess, the admin can file it by hand.
  if (db.prepare("SELECT 1 FROM rooms WHERE deleted_at IS NULL AND lower(name)=lower(?)").get(name)) return null;
  const id = `r${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = Date.now();
  db.prepare("INSERT INTO rooms (id,name,owner_id,created_at,unit_id,is_unit_default) VALUES (?,?,?,?,?,?)").run(id, name, ownerId, now, unitId, isDefault ? 1 : 0);
  db.prepare("INSERT INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(id, ownerId, ownerId, now);
  mkdirSync(join(workspaceRoot(), "rooms", id), { recursive: true, mode: 0o700 });
  writeAudit("room.create", ownerId, { roomId: id, name, scope: "auto" });
  return id;
}

/** The unit's own channel (created now when the unit has none). Members of the unit are added; the actor owns it. */
export function ensureUnitChannel(actorId: string | null, unitId: string): string | null {
  const db = getDb();
  const g = db.prepare("SELECT name FROM groups WHERE id=?").get(unitId) as { name: string } | undefined;
  if (!g) return null;
  const have = db.prepare("SELECT id FROM rooms WHERE unit_id=? AND is_unit_default=1 AND deleted_at IS NULL").get(unitId) as { id: string } | undefined;
  if (have) return have.id;
  const owner = actorId && db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND status='active'").get(actorId) ? actorId : oldestAdmin();
  if (!owner) return null;
  const id = newRoom(owner, `${g.name}頻道`, unitId, true);
  if (!id) return null;
  for (const m of db.prepare("SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND u.status='active'").all(unitId) as { user_id: string }[]) {
    db.prepare("INSERT OR IGNORE INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(id, m.user_id, owner, Date.now());
  }
  return id;
}

/** A person joins or leaves a unit: the unit's own channel follows (the owner stays: that is a handover, not a move). */
export function followMembership(actorId: string | null, unitId: string, userId: string, present: boolean): void {
  const db = getDb();
  const room = db.prepare("SELECT id, owner_id FROM rooms WHERE unit_id=? AND is_unit_default=1 AND deleted_at IS NULL AND closed_at IS NULL").get(unitId) as { id: string; owner_id: string } | undefined;
  if (!room) return;
  if (present) {
    db.prepare("INSERT OR IGNORE INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(room.id, userId, actorId ?? userId, Date.now());
  } else if (room.owner_id !== userId) {
    db.prepare("DELETE FROM room_members WHERE room_id=? AND user_id=?").run(room.id, userId);
  }
}

export function oldestAdmin(): string | null {
  const r = getDb().prepare("SELECT id FROM users WHERE role='admin' AND status='active' AND is_vendor=0 ORDER BY created_at, id LIMIT 1").get() as { id: string } | undefined;
  return r?.id ?? null;
}

/** 全公司頻道: made once (by the oldest administrator), every active account is a member. Returns its id, or null before any admin exists. */
export function ensureCompanyChannel(): string | null {
  const db = getDb();
  const cur = db.prepare("SELECT value FROM tg_settings WHERE key=?").get(COMPANY_KEY) as { value: string } | undefined;
  if (cur && db.prepare("SELECT 1 FROM rooms WHERE id=? AND deleted_at IS NULL").get(cur.value)) return cur.value;
  const owner = oldestAdmin();
  if (!owner) return null;
  const id = newRoom(owner, COMPANY_ROOM_NAME, null, false);
  if (!id) return null;
  db.prepare("INSERT INTO tg_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(COMPANY_KEY, id, Date.now());
  for (const u of db.prepare("SELECT id FROM users WHERE status='active'").all() as { id: string }[]) {
    db.prepare("INSERT OR IGNORE INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(id, u.id, owner, Date.now());
  }
  return id;
}

/** A new active account joins 全公司頻道. */
export function joinCompanyChannel(userId: string): void {
  const id = ensureCompanyChannel();
  if (!id) return;
  getDb().prepare("INSERT OR IGNORE INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(id, userId, userId, Date.now());
}

/** A self-registered account that still waits for approval is not in 全公司頻道 (it would read the history the moment it is approved, and a refused one would stay a member). */
export function leaveCompanyChannel(userId: string): void {
  const cur = getDb().prepare("SELECT value FROM tg_settings WHERE key=?").get(COMPANY_KEY) as { value: string } | undefined;
  if (cur) getDb().prepare("DELETE FROM room_members WHERE room_id=? AND user_id=?").run(cur.value, userId);
}
