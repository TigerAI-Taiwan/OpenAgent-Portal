// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { getRoom, roomDir, roomIsOpen } from "./service";
import { registerOwner } from "./ownership";
import { clearRoomSpeaker, setRoomSpeaker } from "./speaker";
import { getRpcSession, startRpcSession } from "../../lib/rpc-manager";
import { resolveSessionPath } from "../../lib/session-reader";
import { getAgent } from "../agents/service";
import { forgetPendingRole, registerPendingRole } from "../agents/runtime";

/**
 * "@AI" in a room. The room has one conversation of its own (folder
 * rooms/<id>/), driven through pi-web's normal AgentSession (prompt), so
 * model choice, credentials and tools all come from the same place as any
 * other conversation. No model call is made here.
 *
 * - One request at a time per room; later @AI messages wait in a queue.
 * - The conversation is shared, so it always runs with the read-only member
 *   toolset and the file fence (H08), whoever asked. See SDD "AI in rooms".
 * - A failure becomes one short AI-marked message; nothing is retried.
 */

export const AI_AUTHOR = "ai";
const MENTION = /(^|[^\w@])@ai(?![\w-])/i;
const CONTEXT_MESSAGES = 8;
const RUN_TIMEOUT_MS = 5 * 60_000;

export function mentionsAi(text: string): boolean {
  return MENTION.test(text);
}

interface Job { roomId: string; requesterId: string; seq: number; text: string; agentId: string | null }
const KEY = Symbol.for("tigerai:room-ai");
type State = { chains: Map<string, Promise<void>>; pending: Map<string, number>; running: Set<string> };
function state(): State {
  const g = globalThis as unknown as Record<symbol, State | undefined>;
  return (g[KEY] ??= { chains: new Map(), pending: new Map(), running: new Set() });
}

export function aiStatus(roomId: string): { busy: boolean; queued: number } {
  const s = state();
  const queued = s.pending.get(roomId) ?? 0;
  return { busy: s.running.has(roomId), queued: Math.max(0, queued - (s.running.has(roomId) ? 1 : 0)) };
}

/** The reply is signed by whoever answered: "ai" for the plain model, "agent:<id>" for a role. */
export function postAi(roomId: string, agentId: string | null, text: string): void {
  getDb().prepare("INSERT INTO room_messages (room_id,author_id,text,mentions,ts,kind) VALUES (?,?,?,?,?,'ai')")
    .run(roomId, agentId ? `agent:${agentId}` : AI_AUTHOR, text.slice(0, 8000), "[]", Date.now());
}

/**
 * Queue a request. Returns at once; the reply arrives later as a room message.
 * One AI request at a time per room, and also one at a time overall: the gateway behind the model has machines with a single slot each, and a second
 * concurrent request to the same machine would only wait or fail.
 */
export function enqueueAi(roomId: string, requesterId: string, seq: number, text: string, agentId: string | null = null): void {
  const s = state();
  s.pending.set(roomId, (s.pending.get(roomId) ?? 0) + 1);
  const job: Job = { roomId, requesterId, seq, text, agentId };
  const prev = s.chains.get("*") ?? Promise.resolve();
  const next = prev.then(() => runJob(job)).catch(() => undefined).finally(() => {
    const left = (s.pending.get(roomId) ?? 1) - 1;
    if (left <= 0) s.pending.delete(roomId); else s.pending.set(roomId, left);
  });
  s.chains.set("*", next);
}


/** Send one prompt to a session and wait for its answer. Throws with the model service's reason when it fails. */
export async function promptAndWait(wrapper: NonNullable<ReturnType<typeof getRpcSession>>, prompt: string): Promise<string> {
  let modelError = "";
  let off = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finished = new Promise<void>((resolve, reject) => {
    off = wrapper.onEvent((event) => {
      const type = (event as { type?: string }).type;
      // The SDK reports a failed model call as an assistant message that ends in error: keep its reason.
      const msg = (event as { message?: { role?: string; stopReason?: string; errorMessage?: string } }).message;
      if ((type === "message_end" || type === "agent_end") && msg?.role === "assistant" && msg.stopReason === "error" && msg.errorMessage) modelError = msg.errorMessage;
      if (type === "prompt_done") resolve();
      if (type === "session_ended" || type === "session_closed") reject(new Error("the conversation ended"));
    });
    timer = setTimeout(() => { void wrapper.send({ type: "abort" }).catch(() => undefined); reject(new Error("timed out")); }, RUN_TIMEOUT_MS);
  });
  try {
    await wrapper.send({ type: "prompt", message: prompt });
    await finished;
  } finally {
    off();
    if (timer) clearTimeout(timer);
  }
  const last = await wrapper.send({ type: "get_last_assistant_text" }) as { text?: string };
  const reply = (last?.text ?? "").trim();
  if (!reply) throw new Error(modelError ? `the model service answered: ${modelError}` : "the model returned no answer");
  return reply;
}

/** Run a task in the process-wide AI queue (one model request at a time). */
export function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
  const s = state();
  const prev = s.chains.get("*") ?? Promise.resolve();
  const result = prev.then(task);
  s.chains.set("*", result.then(() => undefined, () => undefined));
  return result;
}

/** The room's own conversation, created on first use inside rooms/<id>/. */
export async function ensureRoomSession(roomId: string): Promise<string> {
  const room = getRoom(roomId);
  if (!room) throw new Error("no such room");
  if (room.bound_session_id) return room.bound_session_id;
  const dir = roomDir(roomId);
  // "__new__" + a folder under rooms/ is what the tool policy (H08) reads as "shared, read-only".
  const { realSessionId } = await startRpcSession(`__new__${randomUUID()}`, "", dir, {});
  registerOwner(realSessionId, room.owner_id, dir, "room-ai", roomId);
  const res = getDb().prepare("UPDATE rooms SET bound_session_id=? WHERE id=? AND bound_session_id IS NULL").run(realSessionId, roomId);
  if (res.changes === 0) return getRoom(roomId)!.bound_session_id!; // lost a race: use the winner
  writeAudit("room.ai_session", null, { roomId, sessionId: realSessionId });
  return realSessionId;
}

/**
 * One role = one conversation of its own, keyed by (room, role), shared by the
 * whole room. Not one shared agent wearing several hats (it would not know who
 * it is, and roles would read each other's work), and not one per person (three
 * people would talk to "different" assistants that look like the same one).
 */
export async function ensureRoleSession(roomId: string, agentId: string): Promise<string> {
  const db = getDb();
  const found = db.prepare("SELECT session_id FROM room_assistants WHERE room_id=? AND agent_id=?").get(roomId, agentId) as { session_id: string } | undefined;
  if (found) return found.session_id;
  const room = getRoom(roomId);
  const agent = getAgent(agentId);
  if (!room || !agent) throw new Error("no such room or role");
  const dir = roomDir(roomId);
  const tempKey = `__new__${randomUUID()}`;
  registerPendingRole(tempKey, agentId);
  try {
    const { realSessionId } = await startRpcSession(tempKey, "", dir, agent.model ? { initialModel: agent.model } : {});
    registerOwner(realSessionId, room.owner_id, dir, "room-role", roomId);
    const res = db.prepare("INSERT OR IGNORE INTO room_assistants (room_id,agent_id,session_id) VALUES (?,?,?)").run(roomId, agentId, realSessionId);
    if (res.changes === 0) return (db.prepare("SELECT session_id FROM room_assistants WHERE room_id=? AND agent_id=?").get(roomId, agentId) as { session_id: string }).session_id;
    writeAudit("room.role_session", null, { roomId, agentId, sessionId: realSessionId });
    return realSessionId;
  } finally {
    forgetPendingRole(tempKey);
  }
}

function recentContext(roomId: string, beforeSeq: number): string {
  const rows = getDb().prepare(
    `SELECT m.text, m.kind, COALESCE(u.name, 'AI') AS author FROM room_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.room_id=? AND m.seq<? ORDER BY m.seq DESC LIMIT ${CONTEXT_MESSAGES}`,
  ).all(roomId, beforeSeq) as unknown as { text: string; kind: string; author: string }[];
  return rows.reverse().map((r) => `${r.kind === "ai" ? "AI" : r.author}: ${r.text}`).join("\n");
}

async function runJob(job: Job): Promise<void> {
  const s = state();
  // A closed or deleted room is read-only: a job queued before it was closed is dropped, and so is a late answer.
  if (!roomIsOpen(job.roomId)) return;
  s.running.add(job.roomId);
  try {
    const requester = getDb().prepare("SELECT name FROM users WHERE id=?").get(job.requesterId) as { name: string } | undefined;
    const agent = job.agentId ? getAgent(job.agentId) : null;
    if (job.agentId && (!agent || !agent.enabled)) throw new Error("that AI role is not available");
    const sessionId = agent ? await ensureRoleSession(job.roomId, agent.id) : await ensureRoomSession(job.roomId);
    let wrapper = getRpcSession(sessionId);
    if (!wrapper?.isAlive()) {
      const file = await resolveSessionPath(sessionId);
      if (!file) throw new Error("the room conversation file is missing");
      wrapper = (await startRpcSession(sessionId, file, undefined, {})).session;
    }
    const ask = job.text.replace(/(^|[^\w@])@ai(?![\w-])/gi, "$1").trim() || "(no text)";
    const context = recentContext(job.roomId, job.seq);
    // Question first, discussion after: pi titles a conversation with the start of its first message.
    const prompt = [
      `${requester?.name ?? "A member"} asks in a team chat room: ${ask}`,
      "Answer briefly and plainly from the messages below; your answer is posted back to the whole room. Do not browse files unless the question is about a file; you can only read files inside this room's folder.",
      context ? `Recent messages in the room:\n${context}` : "",
    ].filter(Boolean).join("\n\n");

    // Tools are the speaker's, checked again for every message: set for this one run, removed in finally.
    setRoomSpeaker(sessionId, job.requesterId);
    let reply: string;
    try { reply = await promptAndWait(wrapper, prompt); } finally { clearRoomSpeaker(sessionId); }
    if (!roomIsOpen(job.roomId)) return;
    postAi(job.roomId, job.agentId, reply);
    writeAudit("room.ai_reply", job.requesterId, { roomId: job.roomId, agentId: job.agentId });
  } catch (error) {
    // Short and free of server paths: the text lands in a room that many people read.
    const why = (error instanceof Error ? error.message : String(error)).split(/ See:/)[0].replace(/\S*\/\S*/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
    console.error(`[tigerai] room AI failed (${job.roomId}):`, why);
    postAi(job.roomId, job.agentId, `AI could not reply (${why}).`);
    writeAudit("room.ai_failed", job.requesterId, { roomId: job.roomId, reason: why });
  } finally {
    s.running.delete(job.roomId);
  }
}
