// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, userById, type UserRow } from "../accounts/service";
import { aiRunConcurrency } from "../config";
import { getAgent, type AgentRow } from "../agents/service";
import { pushToUser } from "../push";
import { getAssignment, requireVisible, type AssignmentRow } from "./assignments";

/**
 * 交辦給 AI: an order whose assignee is an AI role runs in the background, in a conversation owned by the applicant.
 *
 *   進行中 (run_state 'running')  --AI stops-->  待確認 ('review')  --applicant 完成-->  done (final)
 *                ^                                     |
 *                +------ applicant 退回 + reason ------+   (the reason is a follow-up prompt in the same conversation)
 *
 * Rules this file keeps (each one has a test):
 *  - The AI never completes an order. The only code that sets status 'done' for an AI order is `confirmAiAssignment`, which needs the applicant.
 *  - Nothing stays 進行中 silently: a model error, an abort, the time limit and a server restart all end in 待確認 with a note.
 *  - The run is never wider than the applicant: it is an ordinary conversation of the applicant (their personal folder, so the member
 *    tool set and file fence apply) and the role only adds its prompt and model. The driver below is the only place that touches the runtime.
 */

export const NOTE_RESTART = "伺服器重新啟動,工作中斷";
export const NOTE_EMPTY = "AI 沒有產生內容";
export const NOTE_ERROR_PREFIX = "執行失敗:";
export const PROMPT_SUFFIX = "完成後請用條列寫出結論與出處。";

export interface RunRequest {
  assignment: AssignmentRow; applicant: UserRow; agent: AgentRow | null;
  /** Existing background conversation (a returned order), or null for the first run. */
  sessionId: string | null; prompt: string;
  /** There is deliberately no time limit and no manual stop: a run ends when the AI is done, fails, or the server restarts. */
  /** Called as soon as the conversation exists so the applicant can open it while it works. */
  onSession: (sessionId: string) => void;
}
export interface RunResult { sessionId: string; text: string; error?: string }
export interface AiDriver { run(req: RunRequest): Promise<RunResult> }

const KEY = Symbol.for("tigerai:ai-runs");
type State = { driver: AiDriver | null; active: Set<string>; waiting: (() => void)[]; running: number; swept: boolean };
const state = (): State => ((globalThis as unknown as Record<symbol, State | undefined>)[KEY] ??= { driver: null, active: new Set(), waiting: [], running: 0, swept: false });

/** Tests install a fake; production loads the real runtime driver on first use. */
export function setAiDriver(d: AiDriver | null): void { state().driver = d; }
async function driver(): Promise<AiDriver> {
  const s = state();
  if (!s.driver) s.driver = (await import("./ai-driver")).runtimeDriver;
  return s.driver;
}

export const isAiRunActive = (id: string): boolean => state().active.has(id);

/**
 * The one process-wide limit on background AI work (TIGERAI_AI_RUN_CONCURRENCY, default 2). 交辦給 AI and the 精靈 (tigerai/wizards)
 * share it: the model gateway has few slots, and two kinds of background work must not each take them all.
 */
export function withAiSlot<T>(task: () => Promise<T>): Promise<T> { return slot(task); }
/** How many more background AI jobs could start right now without waiting. */
export function aiSlotsFree(): number { const s = state(); return Math.max(0, aiRunConcurrency() - s.running - s.waiting.length); }

async function slot<T>(task: () => Promise<T>): Promise<T> {
  const s = state();
  if (s.running >= aiRunConcurrency()) await new Promise<void>((resolve) => s.waiting.push(resolve));
  s.running++;
  try { return await task(); } finally { s.running--; s.waiting.shift()?.(); }
}

export function firstPrompt(a: Pick<AssignmentRow, "title" | "description">): string {
  return [a.title.trim(), a.description.trim(), PROMPT_SUFFIX].filter(Boolean).join("\n\n");
}

/** Hand the order to the AI: runs without a browser, returns at once. Errors end up on the order, never thrown to the caller. */
export function startAiRun(id: string, followUp?: string): void {
  const s = state();
  // The previous round may still be in its last microtasks (a very fast 退回): try again shortly instead of dropping the request.
  if (s.active.has(id)) { setTimeout(() => startAiRun(id, followUp), 50).unref?.(); return; }
  s.active.add(id);
  void slot(() => execute(id, followUp)).catch((e) => finish(id, "", null, NOTE_ERROR_PREFIX + clean(e))).finally(() => s.active.delete(id));
}

/** After a create: an order handed to an AI starts its background run at once (returns immediately). */
export function startIfAi(a: AssignmentRow): AssignmentRow { if (a.assigneeKind === "ai") startAiRun(a.id); return a; }

const clean = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split(/ See:/)[0].replace(/\S*\/\S*/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || "unknown";

async function execute(id: string, followUp?: string): Promise<void> {
  const a = getAssignment(id);
  if (!a || a.assigneeKind !== "ai" || a.runState !== "running" || a.status !== "accepted") return;
  const applicant = userById(a.applicantId);
  if (!applicant || applicant.status !== "active") { finish(id, "", a.sessionId, NOTE_ERROR_PREFIX + "申請人帳號已停用"); return; }
  const agent = a.agentId ? getAgent(a.agentId) : null;
  if (a.agentId && (!agent || !agent.enabled)) { finish(id, "", a.sessionId, NOTE_ERROR_PREFIX + "這個 AI 角色目前無法使用"); return; }
  getDb().prepare("UPDATE assignments SET run_started_at=?, updated_at=? WHERE id=? AND run_state='running'").run(Date.now(), Date.now(), id);
  writeAudit("assignment.ai_start", a.applicantId, { assignmentId: id, agentId: a.agentId ?? "general", round: a.runCount + 1 });
  // A returned order continues in the same conversation with the reason; a first run (or one that never got a conversation) starts from the order text.
  const prompt = a.sessionId && followUp ? followUp : followUp ? `${firstPrompt(a)}\n\n${followUp}` : firstPrompt(a);
  let sessionId = a.sessionId;
  try {
    const d = await driver();
    const r = await d.run({
      assignment: a, applicant, agent, sessionId: a.sessionId, prompt,
      onSession: (sid) => { sessionId = sid; getDb().prepare("UPDATE assignments SET session_id=? WHERE id=? AND session_id IS NULL").run(sid, id); },
    });
    sessionId = r.sessionId || sessionId;
    if (r.error) finish(id, r.text, sessionId, NOTE_ERROR_PREFIX + clean(r.error));
    else if (!r.text.trim()) finish(id, "", sessionId, NOTE_EMPTY);
    else finish(id, r.text, sessionId, null);
  } catch (e) {
    finish(id, "", sessionId, NOTE_ERROR_PREFIX + clean(e));
  }
}

/** The AI stopped (finished, failed or the server restarted): 待確認. Never 'done'. Only moves an order that is still 進行中. */
function finish(id: string, text: string, sessionId: string | null, note: string | null): void {
  const db = getDb();
  const res = db.prepare("UPDATE assignments SET run_state='review', ai_result=?, ai_note=?, session_id=COALESCE(session_id,?), updated_at=? WHERE id=? AND assignee_kind='ai' AND run_state='running' AND status='accepted'")
    .run(text ? text.slice(0, 200_000) : null, note, sessionId, Date.now(), id);
  if (res.changes === 0) return;
  const a = getAssignment(id);
  const outcome = note === null ? "ok" : note.startsWith(NOTE_ERROR_PREFIX) || note === NOTE_EMPTY ? "error" : "interrupted";
  writeAudit("assignment.ai_finish", a?.applicantId ?? null, { assignmentId: id, outcome, chars: text.length });
  if (a) notifyApplicant(a, outcome);
}

/** Once per transition into 待確認 (finish() only gets here for the row it just moved), to the applicant only. Title only, no result text. */
function notifyApplicant(a: AssignmentRow, outcome: "ok" | "error" | "interrupted"): void {
  const head = outcome === "ok" ? "AI 做完了" : outcome === "error" ? "AI 做的時候出了問題" : "伺服器重新啟動,工作中斷";
  const payload = { title: `${head}:${a.title}`.slice(0, 120), body: "請開啟交辦確認", url: `/?assignment=${encodeURIComponent(a.id)}`, tag: `tg-assignment-${a.id}` };
  // The audit entry says how many of the applicant's own devices a push was attempted to (0 = toast / bell / home list only).
  void pushToUser(a.applicantId, payload).catch(() => 0).then((devices) => writeAudit("assignment.ai_notify", a.applicantId, { assignmentId: a.id, outcome, devices }));
}

function requireOwnAi(actor: { id: string; role: "admin" | "member" }, id: string): AssignmentRow {
  const a = requireVisible(actor, id);
  if (a.assigneeKind !== "ai") throw new ServiceError("bad_state", "This order is not handed to an AI", 409);
  // An administrator may read it (requireVisible) but only the applicant confirms or sends back.
  if (a.applicantId !== actor.id) throw new ServiceError("forbidden", "Only the person who handed this over can do this", 403);
  return a;
}

/** 完成: the applicant accepts the result. The one place an AI order becomes done. */
export function confirmAiAssignment(actor: { id: string; role: "admin" | "member" }, id: string, note = ""): AssignmentRow {
  const a = requireOwnAi(actor, id);
  if (a.runState !== "review" || a.status !== "accepted") throw new ServiceError("bad_state", a.runState === "running" ? "The AI is still working" : `Cannot do this to a work order that is ${a.status}`, 409);
  const now = Date.now();
  const res = getDb().prepare("UPDATE assignments SET status='done', run_state=NULL, finished_at=?, updated_at=?, done_note=? WHERE id=? AND run_state='review' AND status='accepted'")
    .run(now, now, String(note ?? "").trim().slice(0, 500) || null, id);
  if (res.changes === 0) throw new ServiceError("bad_state", "The state changed; reload", 409);
  writeAudit("assignment.complete", actor.id, { assignmentId: id, applicant: a.applicantId, assigneeKind: "ai" });
  return getAssignment(id)!;
}

/** 退回: needs a reason; it goes to the AI as a follow-up in the same conversation, the order is 進行中 again. */
export function returnAiAssignment(actor: { id: string; role: "admin" | "member" }, id: string, reason: unknown): AssignmentRow {
  const a = requireOwnAi(actor, id);
  const r = String(reason ?? "").trim();
  if (!r) throw new ServiceError("reason_required", "A reason is required when returning a work order");
  if (a.runState !== "review" || a.status !== "accepted") throw new ServiceError("bad_state", a.runState === "running" ? "The AI is still working" : `Cannot do this to a work order that is ${a.status}`, 409);
  const res = getDb().prepare("UPDATE assignments SET run_state='running', return_reason=?, ai_note=NULL, run_count=run_count+1, updated_at=? WHERE id=? AND run_state='review' AND status='accepted'")
    .run(r.slice(0, 500), Date.now(), id);
  if (res.changes === 0) throw new ServiceError("bad_state", "The state changed; reload", 409);
  writeAudit("assignment.return", actor.id, { assignmentId: id, applicant: a.applicantId, assigneeKind: "ai" });
  startAiRun(id, r.slice(0, 500));
  return getAssignment(id)!;
}

/**
 * Process start: runs that were 進行中 when the server stopped are handed back as 待確認 with a note (no automatic restart: the
 * person decides). Skips runs this very process is working on, and runs only once per process even if several bundles call it.
 */
export function sweepInterruptedRuns(): number {
  const s = state();
  if (s.swept) return 0;
  s.swept = true;
  const rows = getDb().prepare("SELECT id FROM assignments WHERE assignee_kind='ai' AND run_state='running'").all() as unknown as { id: string }[];
  let n = 0;
  for (const r of rows) {
    if (s.active.has(r.id)) continue;
    finish(r.id, "", null, NOTE_RESTART);
    n++;
  }
  return n;
}
/** Tests only: allow a second sweep in the same process. */
export function resetSweepForTests(): void { state().swept = false; }
