// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { isVendor } from "../accounts/vendor";
import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, userById } from "../accounts/service";

/**
 * 換部門 (decision 4, and the old product's "the person's unit list is replaced as a whole"). Moving 王小明 from 財務部 to 生產部:
 *   - his personal folder is NOT touched: only the links in `memberships` change (units he keeps stay as they were, head flag included);
 *   - the default channel of a unit he leaves is taken away from him, the default channel of a unit he joins is given to him
 *     (a unit has at most one: rooms.is_unit_default);
 *   - the other (專案) channels filed under a unit he leaves are KEPT; each becomes a pending item for that unit's head to keep or
 *     remove (default: kept, until someone decides);
 *   - open 交辦單 on his name can be handed over per row, and the audit says what was done.
 * Nothing here moves a file, a conversation or a message.
 */

type Actor = { id: string; role: string };

export interface UnitChangePreview {
  user: { id: string; name: string; status: string };
  from: { id: string; name: string; isManager: boolean }[];
  to: { id: string; name: string }[];
  removed: { id: string; name: string }[];
  added: { id: string; name: string }[];
  leaveDefaultChannels: { id: string; name: string; unitName: string; owner: boolean }[];
  joinDefaultChannels: { id: string; name: string; unitName: string }[];
  projectChannels: { id: string; name: string; unitId: string; unitName: string }[];
  assignments: { id: string; title: string; role: "assignee" | "applicant"; status: string }[];
}

const q = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).all(...(a as never[])) as unknown as T[];
const one = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).get(...(a as never[])) as unknown as T | undefined;

function cleanUnitIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw new ServiceError("bad_units", "unitIds must be a list");
  const out = [...new Set(ids.filter((x): x is string => typeof x === "string" && x !== ""))];
  for (const id of out) if (!one("SELECT 1 FROM groups WHERE id=?", id)) throw new ServiceError("bad_units", "No such unit", 400);
  return out;
}

export function previewUnitChange(userId: string, unitIdsIn: unknown): UnitChangePreview {
  const user = userById(userId);
  if (!user) throw new ServiceError("not_found", "No such user", 404);
  const unitIds = cleanUnitIds(unitIdsIn);
  const nameOf = (id: string) => one<{ name: string }>("SELECT name FROM groups WHERE id=?", id)?.name ?? id;
  const from = q<{ id: string; name: string; is_manager: number }>("SELECT g.id,g.name,m.is_manager FROM memberships m JOIN groups g ON g.id=m.group_id WHERE m.user_id=? ORDER BY g.name", userId).map((g) => ({ id: g.id, name: g.name, isManager: g.is_manager === 1 }));
  const fromIds = new Set(from.map((g) => g.id));
  const removed = from.filter((g) => !unitIds.includes(g.id)).map((g) => ({ id: g.id, name: g.name }));
  const added = unitIds.filter((id) => !fromIds.has(id)).map((id) => ({ id, name: nameOf(id) }));
  const live = "r.deleted_at IS NULL";
  const leaveDefaultChannels = removed.flatMap((u) => q<{ id: string; name: string; owner_id: string }>(
    `SELECT r.id,r.name,r.owner_id FROM rooms r JOIN room_members m ON m.room_id=r.id AND m.user_id=? WHERE r.unit_id=? AND r.is_unit_default=1 AND ${live}`, userId, u.id,
  ).map((r) => ({ id: r.id, name: r.name, unitName: u.name, owner: r.owner_id === userId })));
  const joinDefaultChannels = added.flatMap((u) => q<{ id: string; name: string }>(
    `SELECT r.id,r.name FROM rooms r WHERE r.unit_id=? AND r.is_unit_default=1 AND ${live} AND NOT EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.user_id=?)`, u.id, userId,
  ).map((r) => ({ id: r.id, name: r.name, unitName: u.name })));
  const projectChannels = removed.flatMap((u) => q<{ id: string; name: string }>(
    `SELECT r.id,r.name FROM rooms r JOIN room_members m ON m.room_id=r.id AND m.user_id=? WHERE r.unit_id=? AND r.is_unit_default=0 AND ${live}`, userId, u.id,
  ).map((r) => ({ id: r.id, name: r.name, unitId: u.id, unitName: u.name })));
  const open = "status IN ('open','accepted')";
  const assignments = [
    ...q<{ id: string; title: string; status: string }>(`SELECT id,title,status FROM assignments WHERE assignee_id=? AND assignee_kind='user' AND ${open}`, userId).map((a) => ({ ...a, role: "assignee" as const })),
    ...q<{ id: string; title: string; status: string }>(`SELECT id,title,status FROM assignments WHERE applicant_id=? AND ${open}`, userId).map((a) => ({ ...a, role: "applicant" as const })),
  ];
  return { user: { id: user.id, name: user.name, status: user.status }, from, to: unitIds.map((id) => ({ id, name: nameOf(id) })), removed, added, leaveDefaultChannels, joinDefaultChannels, projectChannels, assignments };
}

export interface UnitChangePlan { unitIds: string[]; assignments?: Record<string, "transfer" | "keep">; assignTo?: string | null }
export interface UnitChangeResult { removed: number; added: number; leftChannels: number; joinedChannels: number; pendingProject: number; assignments: number; unchanged: boolean }

export function applyUnitChange(actor: Actor, userId: string, plan: UnitChangePlan): UnitChangeResult {
  const user = userById(userId);
  if (!user) throw new ServiceError("not_found", "No such user", 404);
  if (user.left_at) throw new ServiceError("left_user", "This person has left; re-enable the account first", 409);
  const pv = previewUnitChange(userId, plan.unitIds);
  const res: UnitChangeResult = { removed: pv.removed.length, added: pv.added.length, leftChannels: 0, joinedChannels: 0, pendingProject: 0, assignments: 0, unchanged: pv.removed.length === 0 && pv.added.length === 0 };
  if (res.unchanged) return res;
  const to = plan.assignTo ? userById(plan.assignTo) : null;
  if (plan.assignTo && (!to || to.status !== "active" || to.id === userId || isVendor(to.id))) throw new ServiceError("bad_successor", "The new owner must be another active account", 400);
  inTransaction(() => {
    const db = getDb();
    for (const u of pv.removed) db.prepare("DELETE FROM memberships WHERE user_id=? AND group_id=?").run(userId, u.id);
    for (const u of pv.added) db.prepare("INSERT OR IGNORE INTO memberships (user_id,group_id,is_manager) VALUES (?,?,0)").run(userId, u.id);
    for (const c of pv.leaveDefaultChannels) {
      if (c.owner) continue; // an owner stays: the channel needs an owner, and that is a handover, not a 換部門
      db.prepare("DELETE FROM room_members WHERE room_id=? AND user_id=?").run(c.id, userId);
      res.leftChannels += 1;
      writeAudit("room.member_remove", actor.id, { roomId: c.id, userId, scope: "unit_change" });
    }
    for (const c of pv.joinDefaultChannels) {
      db.prepare("INSERT OR IGNORE INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(c.id, userId, actor.id, Date.now());
      res.joinedChannels += 1;
      writeAudit("room.member_add", actor.id, { roomId: c.id, userId, scope: "unit_change" });
    }
    for (const c of pv.projectChannels) {
      if (db.prepare("SELECT 1 FROM unit_change_items WHERE user_id=? AND room_id=? AND status='pending'").get(userId, c.id)) continue;
      db.prepare("INSERT INTO unit_change_items (id,user_id,unit_id,room_id,status,created_by,created_at) VALUES (?,?,?,?, 'pending', ?, ?)")
        .run(`c${randomUUID().replace(/-/g, "").slice(0, 12)}`, userId, c.unitId, c.id, actor.id, Date.now());
      res.pendingProject += 1;
    }
    if (to) {
      for (const a of pv.assignments) {
        if ((plan.assignments?.[a.id] ?? "keep") !== "transfer") continue;
        const col = a.role === "assignee" ? "assignee_id" : "applicant_id";
        res.assignments += db.prepare(`UPDATE assignments SET ${col}=?, updated_at=? WHERE id=? AND ${col}=?`).run(to.id, Date.now(), a.id, userId).changes as number;
      }
    }
  });
  writeAudit("member.unit_change", actor.id, {
    userId, from: pv.from.map((g) => g.name).join("、") || "-", to: pv.to.map((g) => g.name).join("、") || "-",
    items: res.leftChannels + res.joinedChannels + res.pendingProject + res.assignments,
    scope: `離開部門頻道 ${res.leftChannels}、加入部門頻道 ${res.joinedChannels}、專案頻道待決定 ${res.pendingProject}、交辦單轉出 ${res.assignments}`,
  });
  return res;
}

// ------------------------------------------------------------------ the old head's list

export interface UnitChangeItem { id: string; userId: string; userName: string; unitId: string; unitName: string; roomId: string; roomName: string; status: string; createdAt: number; mayDecide: boolean }

/** Pending (and decided) project-channel questions: administrators see all, a head sees those of the units they head. */
export function listUnitChangeItems(viewer: { id: string; role: string }, includeDecided = false): UnitChangeItem[] {
  const rows = q<{ id: string; user_id: string; unit_id: string; room_id: string; status: string; created_at: number; uname: string; gname: string; rname: string }>(
    `SELECT i.id,i.user_id,i.unit_id,i.room_id,i.status,i.created_at,
            (SELECT name FROM users WHERE id=i.user_id) AS uname, COALESCE((SELECT name FROM groups WHERE id=i.unit_id),'?') AS gname, COALESCE((SELECT name FROM rooms WHERE id=i.room_id),'?') AS rname
       FROM unit_change_items i ${includeDecided ? "" : "WHERE i.status='pending'"} ORDER BY i.created_at DESC LIMIT 300`);
  const heads = new Set(q<{ group_id: string }>("SELECT group_id FROM memberships WHERE user_id=? AND is_manager=1", viewer.id).map((r) => r.group_id));
  return rows.filter((r) => viewer.role === "admin" || heads.has(r.unit_id))
    .map((r) => ({ id: r.id, userId: r.user_id, userName: r.uname, unitId: r.unit_id, unitName: r.gname, roomId: r.room_id, roomName: r.rname, status: r.status, createdAt: r.created_at, mayDecide: r.status === "pending" }));
}

export function decideUnitChangeItem(viewer: { id: string; role: string }, itemId: string, decision: "keep" | "remove"): void {
  const db = getDb();
  const it = one<{ id: string; user_id: string; unit_id: string; room_id: string; status: string }>("SELECT id,user_id,unit_id,room_id,status FROM unit_change_items WHERE id=?", itemId);
  if (!it) throw new ServiceError("not_found", "No such item", 404);
  const isHead = !!one("SELECT 1 FROM memberships WHERE user_id=? AND group_id=? AND is_manager=1", viewer.id, it.unit_id);
  if (viewer.role !== "admin" && !isHead) throw new ServiceError("forbidden", "Only the head of the old unit or an administrator decides", 403);
  if (it.status !== "pending") throw new ServiceError("decided", "Already decided", 409);
  if (decision !== "keep" && decision !== "remove") throw new ServiceError("bad_decision", "keep or remove");
  if (decision === "remove") {
    const room = one<{ owner_id: string }>("SELECT owner_id FROM rooms WHERE id=?", it.room_id);
    if (room?.owner_id === it.user_id) throw new ServiceError("owner", "The person owns this channel: hand it over first", 409);
    db.prepare("DELETE FROM room_members WHERE room_id=? AND user_id=?").run(it.room_id, it.user_id);
  }
  db.prepare("UPDATE unit_change_items SET status=?, decided_by=?, decided_at=? WHERE id=?").run(decision === "keep" ? "kept" : "removed", viewer.id, Date.now(), itemId);
  writeAudit("member.unit_room", viewer.id, { userId: it.user_id, roomId: it.room_id, scope: decision === "keep" ? "kept" : "removed" });
}
