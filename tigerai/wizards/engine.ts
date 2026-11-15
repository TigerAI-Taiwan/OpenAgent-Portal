// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb, inTransaction } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, userById, type Role } from "../accounts/service";
import { getRoom, roomIsOpen } from "../rooms/service";
import { aiSlotsFree, withAiSlot } from "../workorders/ai-run";
import { clearSkillCache } from "./skill-cache";
import { SCHEDULED, WIZARD_ZH, getSettings, requireManager, type Wizard } from "./settings";
import { dueNow, dayKey, parseHm, weekKey } from "./time";
import { collapseStops } from "./format";
import { dedupeKey, getItem, getRun, insertItem, insertRun, isDuplicate, periodHandled, roomCards, runningRun, viewRun } from "./store";
import { routeSupervision } from "./supervise-route";
import { channelFileNode, writeChannelFile, writePersonItem, writePersonItems } from "./files";
import { finishOrderOf, makeConfirmOrder } from "./confirm-order";
import { writeSkill } from "./skill-writer";
import { engineState, registerWizard, type WizardModel } from "./kind-store";
import { daily } from "./kinds/daily";
import { weekly } from "./kinds/weekly";
import { skill } from "./kinds/skill";
import { adhoc } from "./kinds/adhoc";
import { WizardFailure, type Audience, type RunContext, type RunRow, type RunView, type WizardKind, type WizardResult } from "./types";

/**
 * The wizard engine: everything a wizard kind does not decide for itself.
 *
 *   startWizardRun(...)  -> a run row (status running) -> prepare (no model, may skip) -> the shared AI slot -> the model call
 *                        -> kind.finish (validates the reply) -> deliver (channel message + items per recipient) -> run row done
 *   any failure          -> run row failed + a visible "這次整理沒有完成" card in the channel (with 重跑 for people who may); never silent
 *   confirmRun / decideItem -> the only ways a draft or a proposal becomes "real"; both need a person (the cookie), never a key or the AI
 *
 * The slot is the one 交辦給 AI uses (tigerai/workorders/ai-run.ts), so background AI work as a whole stays within
 * TIGERAI_AI_RUN_CONCURRENCY. Add a kind with registerWizard(); see tigerai/docs/API-wizards.md.
 */

type Actor = { id: string; role: Role };

// ---------------------------------------------------------------- registry and model seam

const state = engineState;
export type { WizardModel };
/** Tests (and any other host) install their own; production loads the pi runtime on first use. */
export function setWizardModel(m: WizardModel | null): void { state().model = m; }
async function model(): Promise<WizardModel> {
  const s = state();
  if (!s.model) { const { runtimeModel } = await import("./model"); s.model = runtimeModel; }
  return s.model;
}

export { registerWizard };
export function getWizard(id: string): WizardKind | undefined { return state().kinds.get(id); }
for (const k of [daily, weekly, skill, adhoc]) if (!state().kinds.has(k.id)) registerWizard(k);

export const NOTE_RESTART = "伺服器重新啟動,這次整理中斷了";

const clean = (e: unknown): string => {
  if (e instanceof WizardFailure) return e.message.slice(0, 200);
  const raw = e instanceof Error ? e.message : String(e);
  return raw.split(/ See:/)[0].replace(/\S*\/\S*/g, "").replace(/\s+/g, " ").trim().slice(0, 160) || "未知的錯誤";
};

// ---------------------------------------------------------------- starting a run

export interface StartOptions {
  kind: string; roomId: string | null; runnerId: string;
  requestedBy: string | null; trigger: RunRow["trigger"]; period?: string | null; params?: Record<string, unknown>;
}
export type Outcome = "queued" | "skipped" | "failed";

/**
 * Create the run and begin it in the background. `prepared` settles when the cheap first phase is over: "skipped" (nothing to do),
 * "failed", or "queued" (the model call is waiting for or holding an AI slot). `done` settles when the whole run is over.
 */
export function startWizardRun(opts: StartOptions): { run: RunRow; prepared: Promise<Outcome>; done: Promise<void> } {
  const kind = getWizard(opts.kind);
  if (!kind) throw new ServiceError("unknown_wizard", "No such wizard", 404);
  const room = opts.roomId ? getRoom(opts.roomId) : null;
  if (opts.roomId && !room) throw new ServiceError("not_found", "No such room", 404);
  if (room && !roomIsOpen(room.id)) throw new ServiceError("room_closed", "This room is closed", 409);
  if (opts.roomId && runningRun(opts.roomId, opts.kind) && state().active.has(runningRun(opts.roomId, opts.kind)!.id)) throw new ServiceError("already_running", "This wizard is already running in this channel", 409);
  const run = insertRun({ kind: opts.kind, roomId: opts.roomId, runnerId: opts.runnerId, requestedBy: opts.requestedBy, trigger: opts.trigger, period: opts.period ?? null, params: opts.params });
  const s = state();
  s.active.add(run.id);
  let settle!: (o: Outcome) => void;
  const prepared = new Promise<Outcome>((resolve) => { settle = resolve; });
  const done = execute(run.id, kind, settle).catch((e) => { fail(run.id, clean(e)); settle("failed"); }).finally(() => s.active.delete(run.id));
  return { run, prepared, done };
}

async function execute(runId: string, kind: WizardKind, settle: (o: Outcome) => void): Promise<void> {
  const run = getRun(runId)!;
  const runner = userById(run.runner_id);
  if (!runner || runner.status !== "active") { fail(runId, "頻道建立者的帳號已停用"); settle("failed"); return; }
  const room = run.room_id ? getRoom(run.room_id) : null;
  const ctx: RunContext = { run, room, runner, now: Date.now(), params: JSON.parse(run.input ?? "{}") as Record<string, unknown> };
  const prepared = await kind.prepare(ctx);
  if ("skip" in prepared) { skip(runId, prepared.skip); settle("skipped"); return; }
  settle("queued");
  const reply = prepared.noModel ? "" : await withAiSlot(async () => {
    getDb().prepare("UPDATE wizard_runs SET started_at=?, from_seq=?, to_seq=? WHERE id=?").run(Date.now(), prepared.fromSeq ?? null, prepared.toSeq ?? null, runId);
    if (room && !roomIsOpen(room.id)) throw new WizardFailure("頻道已關閉");
    return (await model())({ roomId: run.room_id, runnerId: run.runner_id, prompt: prepared.prompt, kind: kind.id });
  });
  if (room && !roomIsOpen(room.id)) throw new WizardFailure("頻道已關閉");
  const result = await kind.finish({ ...ctx, now: Date.now() }, prepared, reply);
  complete(run, result, prepared.fromSeq ?? null, prepared.toSeq ?? null);
}

// ---------------------------------------------------------------- finishing a run

function skip(runId: string, reason: string): void {
  const run = getRun(runId)!;
  getDb().prepare("UPDATE wizard_runs SET status='skipped', error=?, finished_at=? WHERE id=? AND status='running'").run(reason, Date.now(), runId);
  writeAudit("wizard.run", run.requested_by, { runId, kind: run.kind, roomId: run.room_id, trigger: run.trigger, outcome: "skipped", reason });
}

/** A failed run is shown where people look: a card in the channel with the reason (and 重跑 for those who may). */
function fail(runId: string, reason: string): void {
  const run = getRun(runId);
  if (!run || run.status !== "running") return;
  const now = Date.now();
  inTransaction(() => {
    getDb().prepare("UPDATE wizard_runs SET status='failed', error=?, finished_at=? WHERE id=? AND status='running'").run(reason, now, runId);
    if (run.room_id && roomIsOpen(run.room_id)) {
      const label = WIZARD_ZH[run.kind as keyof typeof WIZARD_ZH] ?? run.kind;
      const seq = post(run.room_id, runId, `**${label}**　這次整理沒有完成:${reason}`);
      getDb().prepare("UPDATE wizard_runs SET post_seq=? WHERE id=?").run(seq, runId);
    }
  });
  writeAudit("wizard.run", run.requested_by, { runId, kind: run.kind, roomId: run.room_id, trigger: run.trigger, outcome: "failed", reason });
}

function post(roomId: string, runId: string, text: string): number {
  const res = getDb().prepare("INSERT INTO room_messages (room_id,author_id,text,mentions,ts,kind) VALUES (?,?,?,?,?,'wizard')").run(roomId, `wizard:${runId}`, text.slice(0, 8000), "[]", Date.now());
  return Number(res.lastInsertRowid);
}

function complete(run: RunRow, result: WizardResult, fromSeq: number | null, toSeq: number | null): void {
  const day = dayKey(Date.now());
  let delivered = 0; let duplicates = 0; let wasLive = false;
  inTransaction(() => {
    const live = getDb().prepare("UPDATE wizard_runs SET status='done', finished_at=?, from_seq=?, to_seq=?, draft=? WHERE id=? AND status='running'").run(Date.now(), fromSeq, toSeq, result.post?.text ?? null, run.id);
    if (live.changes === 0) return;
    wasLive = true;
    for (const item of result.items) {
      // 監督 about a named person: a 交辦單 for the head(s) of that person's own department(s) + a 提醒 for them (wizards/supervise-route.ts).
      if (item.aspect === "supervise" && routeSupervision(run, item, day)) { delivered++; continue; }
      for (const to of recipients(item.to)) {
        const private_ = to !== null;
        const dedupe = private_ ? dedupeKey(item.aspect, to, item.sources) : null;
        if (dedupe && isDuplicate(dedupe)) { duplicates++; continue; }
        insertItem({ runId: run.id, roomId: run.room_id, aspect: item.aspect, category: item.category ?? null, text: collapseStops(item.text), sources: item.sources, recipientId: to, extra: item.extra ?? null, dedupe, day });
        delivered++;
      }
    }
    if (result.post && run.room_id) {
      const seq = post(run.room_id, run.id, result.post.text);
      getDb().prepare("UPDATE wizard_runs SET post_seq=?, confirm_state=? WHERE id=?").run(seq, result.post.confirmable ? "draft" : null, run.id);
    }
  });
  if (wasLive) { // the same results as Markdown files in the directory (wizards/files.ts); never fails the run
    const roomName = run.room_id ? getRoom(run.room_id)?.name ?? null : null;
    const file = writeChannelFile(run, roomName ?? "", result);
    if (result.post?.confirmable && run.room_id) { const room = getRoom(run.room_id); if (room) makeConfirmOrder(run, room, file ? channelFileNode(run, file) : null); }
    writePersonItems(run, roomName, result);
  }
  writeAudit("wizard.run", run.requested_by, { runId: run.id, kind: run.kind, roomId: run.room_id, trigger: run.trigger, outcome: "ok", items: delivered, duplicates, ...(result.note ?? {}) });
}
/** `null` = the channel / the administrators' queue (one row, no recipient); otherwise one private row per person. */
function recipients(to: Audience): (string | null)[] {
  if (to === "channel" || to === "admins") return [null];
  return [...new Set(to.users)];
}

/** Runs still "running" with no live process behind them (the server restarted): failed with a visible note, once per process start. */
export function sweepStaleRuns(): number {
  const s = state();
  if (s.swept) return 0;
  s.swept = true;
  const rows = getDb().prepare("SELECT id FROM wizard_runs WHERE status='running'").all() as unknown as { id: string }[];
  let n = 0;
  for (const r of rows) if (!s.active.has(r.id)) { fail(r.id, NOTE_RESTART); n++; }
  return n;
}
export function resetSweepForTests(): void { state().swept = false; }
export const isWizardRunActive = (id: string): boolean => state().active.has(id);

// ---------------------------------------------------------------- manual run

export async function runNow(actor: Actor, roomId: string, kindId: string): Promise<{ run: RunView; outcome: Outcome }> {
  const room = requireManager(actor, roomId);
  if (!SCHEDULED.includes(kindId as Wizard)) throw new ServiceError("unknown_wizard", "No such wizard", 404);
  if (room.closed_at) throw new ServiceError("room_closed", "This room is closed", 409);
  sweepStaleRuns();
  const now = Date.now();
  const { run, prepared } = startWizardRun({ kind: kindId, roomId, runnerId: room.owner_id, requestedBy: actor.id, trigger: "manual", period: kindId === "daily" ? dayKey(now) : weekKey(now) });
  const outcome = await prepared;
  return { run: viewRun(getRun(run.id)!), outcome };
}

// ---------------------------------------------------------------- 確認 / 採用 / 不需要

/** 確認: a draft becomes the record. Only the channel's creator, a head or an administrator, and only a person at the page. */
export function confirmRun(actor: Actor, runId: string): RunView {
  const run = getRun(runId);
  if (!run || !run.room_id) throw new ServiceError("not_found", "No such record", 404);
  requireManager(actor, run.room_id);
  if (run.confirm_state !== "draft") throw new ServiceError("bad_state", run.confirm_state === "confirmed" ? "Already confirmed" : "This result needs no confirmation", 409);
  const res = getDb().prepare("UPDATE wizard_runs SET confirm_state='confirmed', confirmed_by=?, confirmed_at=? WHERE id=? AND confirm_state='draft'").run(actor.id, Date.now(), runId);
  if (res.changes === 0) throw new ServiceError("bad_state", "The state changed; reload", 409);
  writeAudit("wizard.confirm", actor.id, { runId, kind: run.kind, roomId: run.room_id });
  finishOrderOf(runId, actor.id);
  return viewRun(getRun(runId)!);
}

export type Decision = "adopt" | "dismiss" | "ack";
/** What an administrator may change in a skill proposal before adopting it (the human-confirmation step): the words, never the folder name. */
export interface SkillEdit { name?: unknown; when?: unknown; steps?: unknown }
const SKILL_LIMITS = { name: 80, when: 300, step: 300, steps: 12 };
function cleanSkillEdit(edit: SkillEdit, cur: { name: string; when: string; steps: string[] }): { name: string; when: string; steps: string[]; changed: boolean } {
  const text = (v: unknown, field: string, max: number): string => {
    const t = String(v ?? "").replace(/\s+/g, " ").trim();
    if (!t) throw new ServiceError("bad_skill", `${field} cannot be empty`);
    if (t.length > max) throw new ServiceError("bad_skill", `${field} is too long (max ${max} characters)`);
    return t;
  };
  const name = edit.name === undefined ? cur.name : text(edit.name, "name", SKILL_LIMITS.name);
  const when = edit.when === undefined ? cur.when : text(edit.when, "when", SKILL_LIMITS.when);
  let steps = cur.steps;
  if (edit.steps !== undefined) {
    if (!Array.isArray(edit.steps)) throw new ServiceError("bad_skill", "steps must be a list");
    steps = edit.steps.map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (steps.length === 0 || steps.length > SKILL_LIMITS.steps || steps.some((x) => x.length > SKILL_LIMITS.step)) throw new ServiceError("bad_skill", `1 to ${SKILL_LIMITS.steps} steps, each at most ${SKILL_LIMITS.step} characters`);
  }
  return { name, when, steps, changed: name !== cur.name || when !== cur.when || steps.join("\n") !== cur.steps.join("\n") };
}

export function decideItem(actor: Actor, itemId: string, decision: Decision, edit?: SkillEdit): { state: string; skill?: string } {
  const it = getItem(itemId);
  if (!it) throw new ServiceError("not_found", "No such item", 404);
  const now = Date.now();
  const set = (st: string): void => {
    const res = getDb().prepare("UPDATE wizard_items SET state=?, decided_by=?, decided_at=? WHERE id=? AND state='open'").run(st, actor.id, now, itemId);
    if (res.changes === 0) throw new ServiceError("bad_state", "The state changed; reload", 409);
  };
  if (it.aspect === "skill") {
    // A proposal for a company-wide skill: administrators only. The AI wrote the draft; this is the person who publishes it.
    if (actor.role !== "admin") throw new ServiceError("forbidden", "Only an administrator can approve a skill", 403);
    if (it.state !== "open") throw new ServiceError("bad_state", "Already decided", 409);
    if (decision === "dismiss") { set("dismissed"); writeAudit("wizard.dismiss", actor.id, { itemId, aspect: "skill", roomId: it.room_id }); return { state: "dismissed" }; }
    if (decision !== "adopt") throw new ServiceError("bad_decision", "Choose 採用 or 不需要");
    const x = JSON.parse(it.extra ?? "{}") as { name: string; when: string; steps: string[]; slug: string; roomName?: string };
    // 1.1.2-ce: the administrator may correct the AI's wording first; what gets installed is what they saw and pressed 採用 on.
    const edited = edit ? cleanSkillEdit(edit, x) : null;
    const draft = edited ? { ...x, name: edited.name, when: edited.when, steps: edited.steps } : x;
    const written = writeSkill(draft, userById(actor.id)?.name ?? actor.id, (JSON.parse(it.sources) as unknown[]).length);
    set("adopted");
    if (edited?.changed) getDb().prepare("UPDATE wizard_items SET extra=? WHERE id=?").run(JSON.stringify({ ...x, name: edited.name, when: edited.when, steps: edited.steps, edited: true, aiName: x.name }), itemId);
    clearSkillCache();
    writeAudit("skill.approve", actor.id, { itemId, skill: written.slug, roomId: it.room_id, edited: edited?.changed === true });
    return { state: "adopted", skill: written.slug };
  }
  if (it.recipient_id !== null) {
    // Private (監督 / 稽核 / 提醒): only the person it was sent to can clear it.
    if (it.recipient_id !== actor.id) throw new ServiceError("not_found", "No such item", 404);
    if (decision !== "ack") throw new ServiceError("bad_decision", "Press 我知道了");
    set("done");
    writeAudit("wizard.ack", actor.id, { itemId, aspect: it.aspect, roomId: it.room_id });
    return { state: "done" };
  }
  // A channel suggestion.
  if (!it.room_id || it.aspect !== "suggest") throw new ServiceError("bad_decision", "This item has nothing to decide", 409);
  requireManager(actor, it.room_id);
  if (decision === "ack") throw new ServiceError("bad_decision", "Choose 採用 or 不需要");
  set(decision === "adopt" ? "adopted" : "dismissed");
  writeAudit(decision === "adopt" ? "wizard.adopt" : "wizard.dismiss", actor.id, { itemId, roomId: it.room_id, category: it.category });
  return { state: decision === "adopt" ? "adopted" : "dismissed" };
}

/** What the channel page shows under its wizard messages (runs, their channel items). Everyone who can read the channel sees it. */
export function roomWizardState(actor: Actor, roomId: string) { return roomCards(actor, roomId); }

// ---------------------------------------------------------------- the schedule

const TICK_KEY = "last_tick";       // a call from OUTSIDE (an add-on's schedule endpoint)
const BUILTIN_KEY = "last_builtin"; // a pass of the Portal's own timer (wizards/scheduler.ts)
const setMeta = (key: string, now: number): void => { getDb().prepare("INSERT INTO wizard_meta (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, String(now), now); };
const getMeta = (key: string): number | null => { const r = getDb().prepare("SELECT value FROM wizard_meta WHERE key=?").get(key) as { value: string } | undefined; return r ? Number(r.value) : null; };
/** An external scheduler (the consultant add-on's schedule endpoint) calls this when it received a call; the Portal's own timer then stands down while these keep coming. */
export function recordTick(now = Date.now()): void { setMeta(TICK_KEY, now); }
export function recordBuiltinPass(now = Date.now()): void { setMeta(BUILTIN_KEY, now); }
export const EXTERNAL_TICK_FRESH_MS = 3600_000;
/** When the last external schedule call arrived (null = never). */
export const lastExternalTick = (): number | null => getMeta(TICK_KEY);
const anyWizardEnabled = (): boolean => !!getDb().prepare("SELECT 1 FROM wizard_settings WHERE enabled=1 AND key IN ('daily','weekly','skill') LIMIT 1").get();
/** For the administrator's page: who is driving the schedule and whether it is alive. `external` says whether an add-on drives it right now. */
export function scheduleStatus(now = Date.now(), external = false): { mode: "builtin" | "external"; lastRunAt: number | null; stale: boolean; anyEnabled: boolean } {
  const last = external ? getMeta(TICK_KEY) : getMeta(BUILTIN_KEY);
  // The Portal's own timer passes every 5 minutes; 20 minutes without one means it is off or stuck. An external caller sends one about every 15 minutes: over an hour is late.
  const limit = external ? EXTERNAL_TICK_FRESH_MS : 20 * 60_000;
  return { mode: external ? "external" : "builtin", lastRunAt: last, stale: last === null || now - last > limit, anyEnabled: anyWizardEnabled() };
}

export interface TickResult { started: { roomId: string; kind: string; runId: string }[]; skipped: number; due: number; free: number }
/**
 * Called by the Portal's own timer every 5 minutes (wizards/scheduler.ts), or by an external schedule endpoint of an add-on. The Portal decides what is due: for every open channel with a wizard switched on, whose time
 * has come, that has no run yet for this day (week), start it. At most as many as there are free AI slots (and never more than two)
 * start at once; the rest are still due and go on the next call. A wizard with nothing to read is recorded as skipped so it is not
 * looked at again the same day.
 */
export async function tick(now = Date.now(), max = 2): Promise<TickResult> {
  sweepStaleRuns();
  const rows = getDb().prepare(
    `SELECT s.room_id AS roomId, s.key AS kind, s.at_time AS at, s.weekday FROM wizard_settings s JOIN rooms r ON r.id=s.room_id
     WHERE s.enabled=1 AND s.key IN ('daily','weekly','skill') AND r.deleted_at IS NULL AND r.closed_at IS NULL ORDER BY s.key='daily' DESC, s.room_id`,
  ).all() as unknown as { roomId: string; kind: Wizard; at: string | null; weekday: number | null }[];
  const due: { roomId: string; kind: Wizard; period: string }[] = [];
  for (const r of rows) {
    const set = getSettings(r.roomId)[r.kind];
    const at = parseHm(set.at) ?? 18 * 60;
    const d = dueNow({ at, weekday: set.weekday }, now);
    if (d.due && !periodHandled(r.roomId, r.kind, d.period) && !runningRun(r.roomId, r.kind)) due.push({ roomId: r.roomId, kind: r.kind, period: d.period });
  }
  const out: TickResult = { started: [], skipped: 0, due: due.length, free: aiSlotsFree() };
  let budget = Math.min(max, out.free);
  for (const c of due) {
    if (budget <= 0) break;
    const room = getRoom(c.roomId)!;
    let started;
    try { started = startWizardRun({ kind: c.kind, roomId: c.roomId, runnerId: room.owner_id, requestedBy: null, trigger: "schedule", period: c.period }); } catch { continue; }
    const outcome = await started.prepared;
    if (outcome === "skipped") out.skipped++;
    else { out.started.push({ roomId: c.roomId, kind: c.kind, runId: started.run.id }); budget--; }
  }
  if (out.started.length || out.skipped) writeAudit("wizard.tick", null, { due: out.due, started: out.started.length, skipped: out.skipped });
  return out;
}

// ---------------------------------------------------------------- results made outside startWizardRun (会議摘要)

/**
 * A wizard whose own job already ran (the meeting summary has its own upload/transcribe/summarise steps) still leaves the same
 * footprint as an engine run: a finished run row (so the channel card, 確認 and the audit entry exist) and items for the 公佈欄 個人區.
 * One run per (kind, ref); calling again with the same ref returns it, and a draft is posted into the channel at most once.
 */
export function recordExternalRun(o: { kind: string; roomId: string; runnerId: string; requestedBy: string | null; ref: string; post?: { text: string; confirmable: boolean } }): RunRow {
  const input = JSON.stringify({ ref: o.ref });
  let run = (getDb().prepare("SELECT * FROM wizard_runs WHERE kind=? AND input=?").get(o.kind, input) as unknown as RunRow | undefined) ?? null;
  if (!run) {
    run = insertRun({ kind: o.kind, roomId: o.roomId, runnerId: o.runnerId, requestedBy: o.requestedBy, trigger: "manual", period: null, params: { ref: o.ref } });
    getDb().prepare("UPDATE wizard_runs SET status='done', finished_at=? WHERE id=?").run(Date.now(), run.id);
    writeAudit("wizard.run", o.requestedBy, { runId: run.id, kind: o.kind, roomId: o.roomId, trigger: "manual", outcome: "ok", ref: o.ref });
  }
  if (o.post && run.post_seq === null && roomIsOpen(o.roomId)) {
    inTransaction(() => {
      const seq = post(o.roomId, run!.id, o.post!.text);
      getDb().prepare("UPDATE wizard_runs SET post_seq=?, draft=?, confirm_state=? WHERE id=?").run(seq, o.post!.text, o.post!.confirmable ? "draft" : null, run!.id);
    });
  }
  return getRun(run.id)!;
}

/** One private item (提醒 / 監督 / 稽核) for one person, with the same duplicate rule as every other wizard. Returns false for a duplicate or an item with no source. */
export function deliverExternalItem(run: RunRow, i: { aspect: "remind" | "supervise" | "audit"; text: string; sources: import("./facts").Source[]; userId: string }): boolean {
  if (i.sources.length === 0) return false; // no source, no item
  const dedupe = dedupeKey(i.aspect, i.userId, i.sources) + `|${i.text.slice(0, 60)}`;
  if (isDuplicate(dedupe)) return false;
  insertItem({ runId: run.id, roomId: run.room_id, aspect: i.aspect, category: null, text: collapseStops(i.text).slice(0, 1200), sources: i.sources, recipientId: i.userId, extra: null, dedupe, day: dayKey(Date.now()) });
  writePersonItem(i.userId, i.aspect, i.text, run.room_id ? getRoom(run.room_id)?.name ?? null : null);
  return true;
}
