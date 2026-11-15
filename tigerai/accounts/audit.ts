// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";

const SECRET_KEY = /pass|secret|token|cookie|key/i;

/** Drop anything that looks like a credential before it reaches the log. */
export function maskExtra(extra: Record<string, unknown> | undefined): string | null {
  if (!extra) return null;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) clean[k] = SECRET_KEY.test(k) ? "[masked]" : v;
  return JSON.stringify(clean);
}

export function writeAudit(action: string, actorId: string | null, extra?: Record<string, unknown>): void {
  getDb().prepare("INSERT INTO audit (ts, action, actor_id, extra) VALUES (?, ?, ?, ?)")
    .run(Date.now(), action, actorId, maskExtra(extra));
}

export interface AuditRow { id: number; ts: number; action: string; actor_id: string | null; extra: string | null }

export function listAudit(opts: { action?: string; actor?: string; limit?: number } = {}): AuditRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.action) { where.push("action LIKE ?"); args.push(`${opts.action}%`); }
  if (opts.actor) { where.push("actor_id = ?"); args.push(opts.actor); }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  return getDb().prepare(
    `SELECT id, ts, action, actor_id, extra FROM audit ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${limit}`,
  ).all(...args) as unknown as AuditRow[];
}
