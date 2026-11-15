// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { registerOwner } from "../rooms/ownership";
import { ensurePersonalDir } from "../workspace";
import { forgetPendingRole, registerPendingRole } from "../agents/runtime";
import { registerPendingOwner } from "../provider/personal-runtime";
import { getRpcSession, startRpcSession } from "../../lib/rpc-manager";
import { resolveSessionPath } from "../../lib/session-reader";
import type { AiDriver, RunRequest, RunResult } from "./ai-run";

/**
 * The only place a background AI order touches the pi runtime. It starts an ordinary conversation, exactly like the page does:
 * the applicant's own personal folder (so the member tool set and the file fence of the adapter apply: never wider than the person),
 * owned by the applicant, wearing the role through the same pending-role path as POST /api/agent/new. There is no time limit.
 * A running prompt is never reaped by the session idle timer (`resetIdleTimer` re-arms while `isRunning()`).
 */

type Wrapper = NonNullable<ReturnType<typeof getRpcSession>>;

async function openSession(req: RunRequest): Promise<{ wrapper: Wrapper; sessionId: string }> {
  if (req.sessionId) {
    const live = getRpcSession(req.sessionId);
    if (live?.isAlive()) return { wrapper: live, sessionId: req.sessionId };
    const file = await resolveSessionPath(req.sessionId);
    if (file) return { wrapper: (await startRpcSession(req.sessionId, file, undefined, {})).session, sessionId: req.sessionId };
    // The conversation file is gone: start a fresh one below (the prompt then carries the order text again).
  }
  const dir = ensurePersonalDir(req.applicant.id);
  const tempKey = `__new__${randomUUID()}`;
  if (req.agent) registerPendingRole(tempKey, req.agent.id);
  // The person's own AI work may use their own model connections (a channel's AI never does: rooms/ai.ts does not register an owner).
  registerPendingOwner(tempKey, req.applicant.id);
  try {
    const { session, realSessionId } = await startRpcSession(tempKey, "", dir, req.agent?.model ? { initialModel: req.agent.model } : {});
    registerOwner(realSessionId, req.applicant.id, dir, "chat", null);
    if (req.agent) {
      getDb().prepare("INSERT OR IGNORE INTO session_roles (session_id,agent_id,user_id,created_at) VALUES (?,?,?,?)").run(realSessionId, req.agent.id, req.applicant.id, Date.now());
      writeAudit("role.session_start", req.applicant.id, { sessionId: realSessionId, agentId: req.agent.id, assignmentId: req.assignment.id });
    }
    req.onSession(realSessionId);
    return { wrapper: session, sessionId: realSessionId };
  } finally {
    if (req.agent) forgetPendingRole(tempKey);
  }
}

async function lastText(wrapper: Wrapper): Promise<string> {
  try { return (String(((await wrapper.send({ type: "get_last_assistant_text" })) as { text?: string })?.text ?? "")).trim(); } catch { return ""; }
}

export const runtimeDriver: AiDriver = {
  async run(req: RunRequest): Promise<RunResult> {
    const { wrapper, sessionId } = await openSession(req);
    let modelError = "";
    let off = () => {};
    const finished = new Promise<void>((resolve, reject) => {
      off = wrapper.onEvent((event) => {
        const type = (event as { type?: string }).type;
        const msg = (event as { message?: { role?: string; stopReason?: string; errorMessage?: string } }).message;
        if ((type === "message_end" || type === "agent_end") && msg?.role === "assistant" && msg.stopReason === "error" && msg.errorMessage) modelError = msg.errorMessage;
        else if (type === "message_end" && msg?.role === "assistant" && msg.stopReason !== "error") modelError = "";
        if (type === "prompt_done") resolve();
        if (type === "session_ended" || type === "session_closed") reject(new Error("the conversation ended"));
      });
    });
    try {
      await wrapper.send({ type: "prompt", message: req.prompt });
      await finished;
    } catch (e) {
      return { sessionId, text: await lastText(wrapper), error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
    } finally {
      off();
    }
    const text = await lastText(wrapper);
    if (modelError) return { sessionId, text, error: `模型服務回應:${modelError.slice(0, 150)}` };
    return { sessionId, text };
  },
};
