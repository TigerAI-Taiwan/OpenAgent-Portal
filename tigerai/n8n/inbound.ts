// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { tgEnabled, workspaceRoot } from "../config";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { getAgent } from "../agents/service";
import { forgetPendingRole, registerPendingRole } from "../agents/runtime";
import { registerOwner } from "../rooms/ownership";
import { roomIsOpen } from "../rooms/service";
import { enqueueTask, postAi, promptAndWait } from "../rooms/ai";
import { startRpcSession } from "../../lib/rpc-manager";
import { findHookKey, touchHookKey } from "./service";
import { createAssignment } from "../workorders/assignments";
import { ServiceError, userById } from "../accounts/service";

/**
 * POST /api/tigerai/hooks/agent: n8n (or any caller) asks the AI one question.
 *   Authorization: Bearer <key>   (one key per caller, stored hashed, shown once at creation)
 *   body { "message": "...", "timeout": 90 }
 *   header Idempotency-Key: <opaque>  (a retry of the same call returns the same answer instead of asking again)
 * The key decides who answers (plain model or an AI role) and whether the exchange is also posted
 * into a room. Each call runs in a fresh read-only conversation under workspace/hooks/<key id>/,
 * through the same one-request-at-a-time queue as room AI. Nothing here trusts the body about identity.
 * Every request is audited (key, outcome, duration, message length; never the text).
 */

const MAX_MESSAGE = 8000;
const DEFAULT_WAIT_S = 90;
const MAX_WAIT_S = 280;
const KEY = Symbol.for("tigerai:hook-rate");
type Rate = { byKey: Map<string, number[]>; bad: number[] };
const rate = (): Rate => ((globalThis as unknown as Record<symbol, Rate | undefined>)[KEY] ??= { byKey: new Map(), bad: [] });

const reply = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function presentedKey(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  return m ? m[1] : (req.headers.get("x-api-key") ?? "").trim();
}

export async function POST(req: Request): Promise<Response> {
  if (!tgEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const started = Date.now();
  const r = rate();
  const now = Date.now();
  r.bad = r.bad.filter((t) => now - t < 60_000);
  if (r.bad.length >= 20) return reply(429, { error: "Too many failed attempts" }, { "Retry-After": "60" });

  const key = findHookKey(presentedKey(req));
  if (!key) {
    r.bad.push(now);
    try { writeAudit("hook.denied", null, { reason: "unknown or revoked key" }); } catch { /* */ }
    return reply(401, { error: "Invalid key" });
  }
  const hits = (r.byKey.get(key.id) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 30) return reply(429, { error: "Rate limit: 30 requests per minute per key" }, { "Retry-After": "30" });
  hits.push(now); r.byKey.set(key.id, hits);
  // A key bound to a room that is closed or deleted is read-only like everyone else.
  if (key.room_id && !roomIsOpen(key.room_id)) return reply(409, { error: "The room is closed", code: "room_closed" });

  let input: { message?: unknown; timeout?: unknown; assignment?: unknown };
  try { input = await req.json() as typeof input; } catch { return reply(400, { error: "Expected a JSON body" }); }
  // A flow may also hand a task to a person: body { "assignment": { title, description?, assigneeId | assigneeEmail, dueDate? } }.
  // It is recorded as made by the key's owner with source 'n8n' (or 'ai' when the key carries an AI role); no AI call is made.
  if (input.assignment && typeof input.assignment === "object") {
    const a = input.assignment as Record<string, unknown>;
    const owner = userById(key.created_by);
    if (!owner || owner.status !== "active") return reply(403, { error: "The owner of this key is not active" });
    try {
      const byEmail = typeof a.assigneeEmail === "string" && a.assigneeEmail
        ? (getDb().prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(a.assigneeEmail.trim()) as { id: string } | undefined)?.id
        : undefined;
      const made = createAssignment({ id: owner.id, role: owner.role }, { ...a, assigneeId: byEmail ?? a.assigneeId, sessionId: undefined, assigneeKind: undefined, agentId: undefined }, key.agent_id ? "ai" : "n8n");
      try { writeAudit("hook.request", null, { keyId: key.id, key: key.name, outcome: "assignment", ms: Date.now() - started }); } catch { /* */ }
      return reply(201, { ok: true, assignmentId: made.id, source: made.source });
    } catch (error) {
      if (error instanceof ServiceError) return reply(error.status, { error: error.message, code: error.code });
      throw error;
    }
  }
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) return reply(400, { error: "message is required" });
  if (message.length > MAX_MESSAGE) return reply(413, { error: `message is longer than ${MAX_MESSAGE} characters` });
  const waitS = Math.min(Math.max(Number(input.timeout) || DEFAULT_WAIT_S, 5), MAX_WAIT_S);
  const idem = (req.headers.get("idempotency-key") ?? "").slice(0, 100);
  const db = getDb();
  touchHookKey(key.id);

  const audit = (outcome: string, extra: Record<string, unknown> = {}) => {
    try { writeAudit("hook.request", null, { keyId: key.id, key: key.name, outcome, ms: Date.now() - started, chars: message.length, ...extra }); } catch { /* */ }
  };

  if (idem) {
    const prior = db.prepare("SELECT status, answer FROM hook_calls WHERE key_id=? AND idem=?").get(key.id, idem) as { status: string; answer: string | null } | undefined;
    if (prior?.status === "done") { audit("replayed"); return reply(200, { ok: true, answer: prior.answer, replayed: true }); }
    if (prior?.status === "pending") { audit("in_progress"); return reply(409, { error: "This call is still running; retry later with the same Idempotency-Key", status: "pending" }); }
    if (prior?.status === "failed") db.prepare("DELETE FROM hook_calls WHERE key_id=? AND idem=?").run(key.id, idem);
    db.prepare("INSERT OR IGNORE INTO hook_calls (key_id,idem,status,created_at) VALUES (?,?,'pending',?)").run(key.id, idem, Date.now());
  }

  const job = enqueueTask(async () => {
    const agent = key.agent_id ? getAgent(key.agent_id) : null;
    if (key.agent_id && (!agent || !agent.enabled)) throw new Error("the AI role of this key is not available");
    const dir = join(workspaceRoot(), "hooks", key.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tempKey = `__new__${randomUUID()}`;
    if (agent) registerPendingRole(tempKey, agent.id);
    try {
      const { session, realSessionId } = await startRpcSession(tempKey, "", dir, agent?.model ? { initialModel: agent.model } : {});
      registerOwner(realSessionId, key.created_by, dir, "hook", null);
      return await promptAndWait(session, `${message}\n\n(This request comes from an automated workflow. Answer briefly and plainly; do not browse files.)`);
    } finally {
      if (agent) forgetPendingRole(tempKey);
    }
  });
  // The job keeps running if the caller stops waiting; the idempotency record then holds its result.
  const settle = job.then(
    (answer) => { if (idem) db.prepare("UPDATE hook_calls SET status='done', answer=? WHERE key_id=? AND idem=?").run(answer, key.id, idem); return { answer }; },
    (error: unknown) => { if (idem) db.prepare("UPDATE hook_calls SET status='failed' WHERE key_id=? AND idem=?").run(key.id, idem); return { error: error instanceof Error ? error.message : String(error) }; },
  );
  const winner = await Promise.race([settle, new Promise<"late">((resolve) => setTimeout(() => resolve("late"), waitS * 1000))]);
  if (winner === "late") { audit("timeout_waiting"); return reply(504, { error: "Still working; retry with the same Idempotency-Key to collect the answer", status: "pending" }); }
  if ("error" in winner) {
    const why = winner.error.split(/ See:/)[0].replace(/\S*\/\S*/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
    audit("failed", { reason: why });
    return reply(502, { ok: false, error: `AI could not reply (${why})` });
  }
  if (key.room_id) {
    // The exchange also lands in the room the key is bound to: the question as the workflow's, the answer as the AI's.
    db.prepare("INSERT INTO room_messages (room_id,author_id,text,mentions,ts,kind) VALUES (?,?,?,?,?,'hook')").run(key.room_id, `hook:${key.id}`, message.slice(0, 4000), "[]", Date.now());
    postAi(key.room_id, key.agent_id, winner.answer);
  }
  audit("ok", { room: key.room_id ?? undefined });
  return reply(200, { ok: true, answer: winner.answer });
}
