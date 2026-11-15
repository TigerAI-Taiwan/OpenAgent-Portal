// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, userById } from "../accounts/service";
import { canAccessSession, isRoomMember } from "../rooms/ownership";
import { getAgent } from "../agents/service";
import { startable } from "../agents/personal";

/**
 * 交辦單: one person hands a task to another. No approval chain, no reminders.
 * open -> accepted -> done, or open/accepted -> returned (with a reason). Done and
 * returned are final (a trigger enforces it). It has its own table because the
 * approval work_orders table has a different life cycle (pending/approved/rejected,
 * approver != applicant) and forcing both into one would weaken both.
 */

type Actor = { id: string; role: "admin" | "member" };

export interface AssignmentRow {
  id: string; title: string; description: string; applicantId: string; applicantName: string;
  assigneeId: string; assigneeName: string; dueDate: number | null; sessionId: string | null;
  status: "open" | "accepted" | "done" | "returned"; returnReason: string | null; doneNote: string | null;
  createdAt: number; updatedAt: number; acceptedAt: number | null; finishedAt: number | null;
  source: AssignmentSource;
  /** 'user': a person acts on it. 'ai': an AI role works on it in the background and the applicant confirms (v11). */
  assigneeKind: "user" | "ai"; agentId: string | null; agentName: string | null;
  /** AI orders only: 'running' (進行中) or 'review' (待確認: the AI stopped, the applicant decides). The status column stays 'accepted' for both. */
  runState: "running" | "review" | null; runStartedAt: number | null; aiResult: string | null; aiNote: string | null; runCount: number;
  /** AI orders only: the channel the order was made from. The AI is handed that channel's recent messages (read-only, workorders/channel-context.ts). */
  roomId: string | null;
}
/** Who made it: a person, an AI role, or an n8n flow. Only server code sets anything but 'person' (never the request body). */
export type AssignmentSource = "person" | "ai" | "n8n";

/**
 * What the API calls the state. The status column of an AI order stays 'accepted' while the AI works AND while it waits for the applicant
 * (run_state tells the two apart), so the raw value made the API say "accepted" for an order the page shows as 待確認. Outside this
 * module an AI order that has a run state reads 'running' (進行中) or 'review' (待確認); everything else is the column as it is.
 */
export type ApiStatus = AssignmentRow["status"] | "running" | "review";
export function apiStatus(a: Pick<AssignmentRow, "status" | "assigneeKind" | "runState">): ApiStatus {
  return a.assigneeKind === "ai" && a.status === "accepted" && a.runState ? a.runState : a.status;
}
export function apiAssignment<T extends Pick<AssignmentRow, "status" | "assigneeKind" | "runState">>(a: T): Omit<T, "status"> & { status: ApiStatus } { return { ...a, status: apiStatus(a) }; }

export const ASSIGNMENT_SELECT = `SELECT a.id, a.title, a.description, a.applicant_id AS applicantId, COALESCE(ua.name,'?') AS applicantName,
  a.assignee_id AS assigneeId, COALESCE(us.name,'?') AS assigneeName, a.due_date AS dueDate, a.session_id AS sessionId,
  a.status, a.return_reason AS returnReason, a.done_note AS doneNote, a.created_at AS createdAt, a.updated_at AS updatedAt,
  a.accepted_at AS acceptedAt, a.finished_at AS finishedAt, a.source AS source,
  a.assignee_kind AS assigneeKind, a.agent_id AS agentId,
  COALESCE((SELECT name FROM agents WHERE id=a.agent_id),(SELECT name FROM personal_agents WHERE id=a.agent_id)) AS agentName,
  a.run_state AS runState, a.run_started_at AS runStartedAt, a.ai_result AS aiResult, a.ai_note AS aiNote, a.run_count AS runCount, a.room_id AS roomId
  FROM assignments a LEFT JOIN users ua ON ua.id=a.applicant_id LEFT JOIN users us ON us.id=a.assignee_id`;

/** A due DAY is stored as noon UTC of that calendar day: in every time zone from UTC-11 to UTC+11 it still reads as the same
 *  day, and the pages show its UTC date parts, so no zone can move it (23:59:59 UTC showed as the next morning in Taipei). */
export function parseDue(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === "string") {
    const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T12:00:00Z`) : Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  throw new ServiceError("bad_due", "Due date is not valid");
}

export function getAssignment(id: string): AssignmentRow | null {
  return (getDb().prepare(`${ASSIGNMENT_SELECT} WHERE a.id=?`).get(id) as unknown as AssignmentRow) ?? null;
}

/** Applicant, assignee and admin only; everyone else gets 404 (existence is not revealed). */
export function requireVisible(actor: Actor, id: string): AssignmentRow {
  const a = getAssignment(id);
  if (!a || (actor.role !== "admin" && a.applicantId !== actor.id && a.assigneeId !== actor.id)) throw new ServiceError("not_found", "No such work order", 404);
  return a;
}

export function createAssignment(actor: Actor, input: { title?: unknown; description?: unknown; assigneeId?: unknown; dueDate?: unknown; sessionId?: unknown; assigneeKind?: unknown; agentId?: unknown; roomId?: unknown }, source: AssignmentSource = "person"): AssignmentRow {
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  if (!title || title.length > 120) throw new ServiceError("bad_title", "Title is required (max 120 characters)");
  if (description.length > 4000) throw new ServiceError("bad_description", "Description is too long (max 4000 characters)");
  // Only a person at the page can hand work to an AI; a flow or key (source n8n / ai) never can, whatever its body says.
  const toAi = input.assigneeKind === "ai";
  if (toAi && source !== "person") throw new ServiceError("bad_assignee", "A flow cannot hand a task to an AI");
  if (input.assigneeKind !== undefined && input.assigneeKind !== "user" && input.assigneeKind !== "ai") throw new ServiceError("bad_assignee", "Unknown assignee kind");
  let assigneeId: string;
  let agentId: string | null = null;
  let roomId: string | null = null;
  if (toAi) {
    const wanted = typeof input.agentId === "string" ? input.agentId.trim() : "";
    if (wanted && wanted !== "general") {
      // The same list as the 精靈 menu: a role this person may start. Unknown, disabled and not-yours are all the same refusal.
      const agent = getAgent(wanted);
      if (!agent || !agent.enabled || !startable(actor, wanted)) throw new ServiceError("bad_agent", "That AI role is not available to you", 403);
      agentId = wanted;
    }
    assigneeId = `ai:${agentId ?? "general"}`;
    // Made from a channel: only a member may hand a channel's messages to the AI (an administrator who is not a member may not either).
    if (typeof input.roomId === "string" && input.roomId.trim()) {
      const rid = input.roomId.trim();
      const room = getDb().prepare("SELECT deleted_at FROM rooms WHERE id=?").get(rid) as { deleted_at: number | null } | undefined;
      if (!room || room.deleted_at || !isRoomMember(rid, actor.id)) throw new ServiceError("bad_room", "That channel is not available to you", 403);
      roomId = rid;
    }
  } else {
    const assignee = typeof input.assigneeId === "string" ? userById(input.assigneeId) : null;
    if (!assignee || assignee.status !== "active") throw new ServiceError("bad_assignee", "Choose an active user to hand this to");
    assigneeId = assignee.id;
  }
  const due = parseDue(input.dueDate);
  let sessionId: string | null = null;
  // An AI order owns its session (the background run creates it); a conversation to link only applies to people.
  if (!toAi && typeof input.sessionId === "string" && input.sessionId) {
    if (!canAccessSession(actor, input.sessionId)) throw new ServiceError("bad_session", "That conversation is not available to you", 403);
    sessionId = input.sessionId;
  }
  const id = `a${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = Date.now();
  if (toAi) {
    getDb().prepare("INSERT INTO assignments (id,title,description,applicant_id,assignee_id,due_date,session_id,created_at,updated_at,source,assignee_kind,agent_id,status,run_state,accepted_at,room_id) VALUES (?,?,?,?,?,?,?,?,?,?,'ai',?,'accepted','running',?,?)")
      .run(id, title, description, actor.id, assigneeId, due, null, now, now, source, agentId, now, roomId);
    writeAudit("assignment.create", actor.id, { assignmentId: id, assigneeKind: "ai", agentId: agentId ?? "general", ...(roomId ? { roomId } : {}) });
  } else {
    getDb().prepare("INSERT INTO assignments (id,title,description,applicant_id,assignee_id,due_date,session_id,created_at,updated_at,source) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, title, description, actor.id, assigneeId, due, sessionId, now, now, source);
    writeAudit("assignment.create", actor.id, { assignmentId: id, assignee: assigneeId, ...(source !== "person" ? { source } : {}) });
  }
  return getAssignment(id)!;
}

/**
 * scope: mine (I handed out) | assigned (handed to me) | all (admin) | ai (made by an AI role or n8n flow, and I am the assignee or the
 * flow's owner). `source` narrows mine/assigned/all to one origin; the 交辦 modal asks for "person" so the three tabs never overlap.
 */
export function listAssignments(actor: Actor, scope: string, status?: string, source?: string, kind?: string): AssignmentRow[] {
  let where: string; const args: string[] = [];
  if (scope === "all") {
    if (actor.role !== "admin") throw new ServiceError("forbidden", "Administrator only", 403);
    where = "1=1";
  } else if (scope === "ai") { where = "(a.assignee_id=? OR a.applicant_id=?) AND a.source IN ('ai','n8n')"; args.push(actor.id, actor.id); }
  else if (scope === "assigned") { where = "a.assignee_id=?"; args.push(actor.id); }
  else { where = "a.applicant_id=?"; args.push(actor.id); }
  if (status === "running" || status === "review") { where += " AND a.assignee_kind='ai' AND a.status='accepted' AND a.run_state=?"; args.push(status); }
  else if (status === "accepted") where += " AND a.status='accepted' AND a.run_state IS NULL";
  else if (status) { where += " AND a.status=?"; args.push(status); }
  if (source && scope !== "ai") {
    if (!["person", "ai", "n8n"].includes(source)) throw new ServiceError("bad_source", "Unknown source");
    where += " AND a.source=?"; args.push(source);
  }
  if (kind) {
    if (kind !== "user" && kind !== "ai") throw new ServiceError("bad_kind", "Unknown kind");
    where += " AND a.assignee_kind=?"; args.push(kind);
  }
  return getDb().prepare(`${ASSIGNMENT_SELECT} WHERE ${where} ORDER BY a.created_at DESC LIMIT 500`).all(...args) as unknown as AssignmentRow[];
}

/** AI orders I handed out that the AI has stopped on: they wait for me to confirm or send back (待確認). */
export function aiReviewFor(actor: Actor): AssignmentRow[] {
  return getDb().prepare(`${ASSIGNMENT_SELECT} WHERE a.applicant_id=? AND a.assignee_kind='ai' AND a.run_state='review' AND a.status='accepted' ORDER BY a.updated_at`).all(actor.id) as unknown as AssignmentRow[];
}

export function aiRunningCount(actor: Actor): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM assignments WHERE applicant_id=? AND assignee_kind='ai' AND run_state='running'").get(actor.id) as { n: number }).n;
}

/** 待我處理: my assignments that still need me, AI orders waiting for my confirmation, plus (admin) approval work orders waiting. */
export function pendingCount(actor: Actor): { assigned: number; aiReview: number; approvals: number; total: number } {
  const db = getDb();
  const assigned = (db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE assignee_id=? AND status IN ('open','accepted')").get(actor.id) as { n: number }).n;
  const aiReview = (db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE applicant_id=? AND assignee_kind='ai' AND run_state='review' AND status='accepted'").get(actor.id) as { n: number }).n;
  const approvals = actor.role === "admin"
    ? (db.prepare("SELECT COUNT(*) AS n FROM work_orders WHERE status='pending' AND applicant_id<>?").get(actor.id) as { n: number }).n
    : 0;
  return { assigned, aiReview, approvals, total: assigned + aiReview + approvals };
}

function step(actor: Actor, id: string, from: string[], to: AssignmentRow["status"], audit: string, set: Record<string, unknown> = {}): AssignmentRow {
  const a = requireVisible(actor, id);
  // Only the person it was handed to acts on it; an admin may read everything but is not the assignee.
  if (a.assigneeId !== actor.id) throw new ServiceError("forbidden", "Only the assignee can do this", 403);
  if (!from.includes(a.status)) throw new ServiceError("bad_state", `Cannot do this to a work order that is ${a.status}`, 409);
  const now = Date.now();
  const cols = Object.keys(set);
  const res = getDb().prepare(`UPDATE assignments SET status=?, updated_at=?${cols.map((c) => `, ${c}=?`).join("")} WHERE id=? AND status IN (${from.map(() => "?").join(",")})`)
    .run(to, now, ...cols.map((c) => set[c] as string | number | null), id, ...from);
  if (res.changes === 0) throw new ServiceError("bad_state", "The state changed; reload", 409);
  writeAudit(audit, actor.id, { assignmentId: id, applicant: a.applicantId });
  return getAssignment(id)!;
}

export const acceptAssignment = (actor: Actor, id: string) => step(actor, id, ["open"], "accepted", "assignment.accept", { accepted_at: Date.now() });
export function completeAssignment(actor: Actor, id: string, note = ""): AssignmentRow {
  const a = step(actor, id, ["open", "accepted"], "done", "assignment.complete", { finished_at: Date.now(), done_note: String(note ?? "").trim().slice(0, 500) || null });
  // A 「確認」 交辦單 (wizards/confirm-order.ts) is the same act as 確認 on the channel card: finishing it confirms the draft. Inline SQL: wizards import this module.
  const run = getDb().prepare("SELECT id, kind, room_id FROM wizard_runs WHERE confirm_assignment_id=? AND confirm_state='draft'").get(id) as { id: string; kind: string; room_id: string | null } | undefined;
  if (run && getDb().prepare("UPDATE wizard_runs SET confirm_state='confirmed', confirmed_by=?, confirmed_at=? WHERE id=? AND confirm_state='draft'").run(actor.id, Date.now(), run.id).changes) {
    writeAudit("wizard.confirm", actor.id, { runId: run.id, kind: run.kind, roomId: run.room_id, via: "assignment" });
  }
  return a;
}
export function returnAssignment(actor: Actor, id: string, reason: unknown): AssignmentRow {
  const r = String(reason ?? "").trim();
  if (!r) throw new ServiceError("reason_required", "A reason is required when returning a work order");
  return step(actor, id, ["open", "accepted"], "returned", "assignment.return", { finished_at: Date.now(), return_reason: r.slice(0, 500) });
}
