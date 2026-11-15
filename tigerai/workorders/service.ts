// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";

/**
 * Minimal work orders: a pending-approval list. Applicant, payload, status
 * pending/approved/rejected, an approver who is never the applicant (a
 * database trigger enforces it, not only this code), and an audit record for
 * every step. It lives in its own module so it can grow into a general
 * work-order system; what an approval DOES is registered per kind.
 */

export interface OrderRow {
  id: string; kind: string; applicant_id: string; payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected"; approver_id: string | null; decided_at: number | null; note: string | null;
  result_ref: string | null; created_at: number;
}
interface Raw extends Omit<OrderRow, "payload"> { payload: string }
const parse = (r: Raw): OrderRow => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> });

type Handler = (order: OrderRow, approverId: string) => string | null;
const handlers = new Map<string, Handler>();
/** Each kind says what approval does and returns a reference to the result. */
export function registerOrderKind(kind: string, onApprove: Handler): void { handlers.set(kind, onApprove); }

export function createOrder(kind: string, applicantId: string, payload: Record<string, unknown>): OrderRow {
  const id = `w${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  getDb().prepare("INSERT INTO work_orders (id,kind,applicant_id,payload,created_at) VALUES (?,?,?,?,?)").run(id, kind, applicantId, JSON.stringify(payload), Date.now());
  writeAudit("workorder.create", applicantId, { orderId: id, kind });
  return getOrder(id)!;
}

export function getOrder(id: string): OrderRow | null {
  const r = getDb().prepare("SELECT * FROM work_orders WHERE id=?").get(id) as unknown as Raw | undefined;
  return r ? parse(r) : null;
}

export function listOrders(actor: { id: string; role: string }, status?: string): OrderRow[] {
  const rows = (actor.role === "admin"
    ? getDb().prepare("SELECT * FROM work_orders ORDER BY created_at DESC LIMIT 500").all()
    : getDb().prepare("SELECT * FROM work_orders WHERE applicant_id=? ORDER BY created_at DESC LIMIT 200").all(actor.id)) as unknown as Raw[];
  return rows.map(parse).filter((o) => !status || o.status === status);
}

export function decideOrder(actor: { id: string; role: string }, id: string, approve: boolean, note = ""): OrderRow {
  if (actor.role !== "admin") throw new ServiceError("forbidden", "Only an administrator can decide a work order", 403);
  const order = getOrder(id);
  if (!order) throw new ServiceError("not_found", "No such work order", 404);
  if (order.status !== "pending") throw new ServiceError("decided", "This work order was already decided", 409);
  if (order.applicant_id === actor.id) throw new ServiceError("self_approval", "You cannot decide your own work order; another administrator must", 403);
  const handler = handlers.get(order.kind);
  if (approve && !handler) throw new ServiceError("unknown_kind", "Nothing is registered to carry out this kind of order", 409);
  const db = getDb();
  let ref: string | null = null;
  db.exec("BEGIN IMMEDIATE");
  try {
    ref = approve ? handler!(order, actor.id) : null;
    db.prepare("UPDATE work_orders SET status=?, approver_id=?, decided_at=?, note=?, result_ref=? WHERE id=? AND status='pending'")
      .run(approve ? "approved" : "rejected", actor.id, Date.now(), note.slice(0, 500), ref, id);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already */ }
    throw error;
  }
  writeAudit(approve ? "workorder.approve" : "workorder.reject", actor.id, { orderId: id, kind: order.kind, applicant: order.applicant_id });
  return getOrder(id)!;
}
