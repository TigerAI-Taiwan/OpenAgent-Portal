// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { isVendor } from "../accounts/vendor";
import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, updateUser, userById } from "../accounts/service";
import { leaverKeyState, purgeDueKeys } from "../provider/leaver-keys";
import { listPersonal } from "../provider/personal";

/**
 * 離職與交接 (decisions 5, 7, 11, 12, 13). One action does both halves that the old product kept in two steps:
 *   1. the person's account is disabled, their unit links STAY (the old rule), keys are switched off now and deleted 30 days later;
 *   2. what they owned goes to a successor the administrator names, row by row where a row can reasonably differ:
 *        channels            owner moves to the successor; the member list does not change (the successor is added only when
 *                            not yet a member, because an owner who cannot open the channel is no owner); its wizard schedules
 *                            come along but stay OFF until the new owner looks at them
 *        personal AI roles   owner moves to the successor
 *        open 交辦單          per row: 轉給接手人 or 保留 (a finished one is never touched)
 *        pending 分享申請     per row, same
 *      and the successor may READ the leaver's personal conversations and folder, never write them (userlog/service.ts reads the
 *      grant; no write route exists). Every view is audited there.
 * A successor is required only when the person owns something (decision 12). A channel nobody decides about goes to the
 * administrator who is doing this, and the audit says so (decision 13).
 * Everything happens in one transaction: an error (say, the last administrator) leaves nothing half moved.
 */

export interface Inventory {
  channels: { id: string; name: string; archived: boolean; members: number; schedules: number }[];
  agents: { id: string; name: string }[];
  assignments: { id: string; title: string; role: "assignee" | "applicant"; status: string }[];
  orders: { id: string; kind: string }[];
  conversations: number;
  keys: number;
  units: { id: string; name: string; isManager: boolean }[];
}

export function inventoryOf(userId: string): Inventory {
  const db = getDb();
  const all = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as never[])) as unknown as T[];
  const channels = all<{ id: string; name: string; deleted_at: number | null; members: number; schedules: number }>(
    `SELECT r.id, r.name, r.deleted_at,
            (SELECT COUNT(*) FROM room_members m WHERE m.room_id=r.id) AS members,
            (SELECT COUNT(*) FROM wizard_settings w WHERE w.room_id=r.id AND w.enabled=1) AS schedules
       FROM rooms r WHERE r.owner_id=? ORDER BY r.created_at`, userId,
  ).map((r) => ({ id: r.id, name: r.name, archived: !!r.deleted_at, members: r.members, schedules: r.schedules }));
  const agents = all<{ id: string; name: string }>("SELECT id, name FROM personal_agents WHERE owner_id=? ORDER BY name", userId);
  const open = "status IN ('open','accepted')";
  const assignments = [
    ...all<{ id: string; title: string; status: string }>(`SELECT id,title,status FROM assignments WHERE assignee_id=? AND assignee_kind='user' AND ${open}`, userId).map((a) => ({ ...a, role: "assignee" as const })),
    ...all<{ id: string; title: string; status: string }>(`SELECT id,title,status FROM assignments WHERE applicant_id=? AND ${open}`, userId).map((a) => ({ ...a, role: "applicant" as const })),
  ];
  const orders = all<{ id: string; kind: string }>("SELECT id, kind FROM work_orders WHERE applicant_id=? AND status='pending'", userId);
  const conversations = (db.prepare("SELECT COUNT(*) AS n FROM session_owner WHERE user_id=? AND kind='chat' AND room_id IS NULL").get(userId) as { n: number }).n;
  let keys = 0;
  try { keys = listPersonal(userId).length; } catch { /* no personal folder yet */ }
  const units = all<{ id: string; name: string; is_manager: number }>("SELECT g.id, g.name, m.is_manager FROM memberships m JOIN groups g ON g.id=m.group_id WHERE m.user_id=? ORDER BY g.name", userId)
    .map((u) => ({ id: u.id, name: u.name, isManager: u.is_manager === 1 }));
  return { channels, agents, assignments, orders, conversations, keys, units };
}

/** Something that has to be handed to a person (conversations and keys are not: they are kept as they are). */
export function ownsThings(inv: Inventory): boolean {
  return inv.channels.length + inv.agents.length + inv.assignments.length + inv.orders.length > 0;
}

export interface LeavePlan {
  successorId?: string | null;
  /** per channel id: "transfer" (to the successor) or "admin" (to the administrator). Missing = transfer when a successor is named, else admin. */
  channels?: Record<string, "transfer" | "admin">;
  /** per 交辦單 id: "transfer" or "keep". Missing = transfer when a successor is named, else keep. */
  assignments?: Record<string, "transfer" | "keep">;
  orders?: Record<string, "transfer" | "keep">;
  agents?: "transfer" | "keep";
}
export interface LeaveResult {
  channels: number; channelsToAdmin: number; schedulesOff: number; agents: number; assignments: number; orders: number; successorId: string | null; keysDisabled: boolean;
}

type Actor = { id: string; role: string };

export function leaveUser(actor: Actor, userId: string, plan: LeavePlan = {}, opts: { allowNoSuccessor?: boolean } = {}): LeaveResult {
  const user = userById(userId);
  if (!user) throw new ServiceError("not_found", "No such user", 404);
  if (isVendor(userId)) throw new ServiceError("vendor_fixed", "The maintenance account cannot be handed over or disabled this way", 403);
  if (user.status !== "active") throw new ServiceError("already_left", "This account is already disabled", 409);
  const inv = inventoryOf(userId);
  const successorId = plan.successorId || null;
  if (successorId) {
    const s = userById(successorId);
    if (!s || s.status !== "active" || s.id === userId || isVendor(s.id)) throw new ServiceError("bad_successor", "The successor must be another active account", 400);
  } else if (ownsThings(inv) && !opts.allowNoSuccessor) {
    throw new ServiceError("successor_required", "This person owns channels, AI roles or open orders: choose who takes over", 409);
  }
  const res: LeaveResult = { channels: 0, channelsToAdmin: 0, schedulesOff: 0, agents: 0, assignments: 0, orders: 0, successorId, keysDisabled: false };
  inTransaction(() => {
    const db = getDb();
    for (const ch of inv.channels) {
      const choice = plan.channels?.[ch.id] ?? (successorId ? "transfer" : "admin");
      const to = choice === "transfer" && successorId ? successorId : actor.id;
      if (to === userId) continue;
      db.prepare("UPDATE rooms SET owner_id=? WHERE id=?").run(to, ch.id);
      db.prepare("INSERT OR IGNORE INTO room_members (room_id,user_id,added_by,added_at) VALUES (?,?,?,?)").run(ch.id, to, actor.id, Date.now());
      res.schedulesOff += db.prepare("UPDATE wizard_settings SET enabled=0, updated_by=?, updated_at=? WHERE room_id=? AND enabled=1").run(actor.id, Date.now(), ch.id).changes as number;
      if (to === successorId) res.channels += 1; else res.channelsToAdmin += 1;
      writeAudit("member.handover_room", actor.id, { userId, roomId: ch.id, successorId: to, scope: to === actor.id && choice !== "transfer" ? "admin_fallback" : "successor" });
    }
    if (successorId && (plan.agents ?? "transfer") === "transfer") {
      res.agents = db.prepare("UPDATE personal_agents SET owner_id=? WHERE owner_id=?").run(successorId, userId).changes as number;
    }
    for (const a of inv.assignments) {
      if (!successorId || (plan.assignments?.[a.id] ?? "transfer") !== "transfer") continue;
      const col = a.role === "assignee" ? "assignee_id" : "applicant_id";
      res.assignments += db.prepare(`UPDATE assignments SET ${col}=?, updated_at=? WHERE id=? AND ${col}=?`).run(successorId, Date.now(), a.id, userId).changes as number;
    }
    for (const o of inv.orders) {
      if (!successorId || (plan.orders?.[o.id] ?? "transfer") !== "transfer") continue;
      res.orders += db.prepare("UPDATE work_orders SET applicant_id=? WHERE id=? AND applicant_id=? AND status='pending'").run(successorId, o.id, userId).changes as number;
    }
    if (successorId) {
      // Read-only access for the successor (decision 11). Re-enabling the person ends it (accounts/service.ts updateUser).
      db.prepare("INSERT OR REPLACE INTO handover_reads (leaver_id,successor_id,granted_by,granted_at) VALUES (?,?,?,?)").run(userId, successorId, actor.id, Date.now());
    }
    updateUser(actor.id, userId, { status: "disabled" }); // last administrator / self-lockout rules, token bump, keys off, left_at
    db.prepare("INSERT INTO handovers (id,leaver_id,successor_id,actor_id,at,summary) VALUES (?,?,?,?,?,?)")
      .run(`h${randomUUID().replace(/-/g, "").slice(0, 12)}`, userId, successorId, actor.id, Date.now(), JSON.stringify(res));
  });
  res.keysDisabled = leaverKeyState(userId) !== null;
  writeAudit("member.handover", actor.id, {
    userId, successorId: successorId ?? "", items: res.channels + res.channelsToAdmin + res.agents + res.assignments + res.orders,
    scope: `頻道 ${res.channels}(接手人)+${res.channelsToAdmin}(管理員)、AI 角色 ${res.agents}、交辦單 ${res.assignments}、分享申請 ${res.orders}、排程停用 ${res.schedulesOff}`,
  });
  return res;
}

/** Who may read this person's conversations and folder because of a handover (decision 11). */
export function successorsOf(leaverId: string): string[] {
  return (getDb().prepare("SELECT successor_id FROM handover_reads WHERE leaver_id=?").all(leaverId) as unknown as { successor_id: string }[]).map((r) => r.successor_id);
}
export function leaversOf(successorId: string): string[] {
  return (getDb().prepare("SELECT leaver_id FROM handover_reads WHERE successor_id=?").all(successorId) as unknown as { leaver_id: string }[]).map((r) => r.leaver_id);
}

/** Housekeeping: delete the key files of people who left 30+ days ago, one audit row each. Idempotent, called from the scheduler and the admin pages. */
export function sweepLeaverKeys(now = Date.now()): string[] {
  const done = purgeDueKeys(now);
  for (const id of done) writeAudit("member.keys_purged", null, { userId: id });
  return done;
}
