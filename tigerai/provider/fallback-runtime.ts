// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { writeAudit } from "../accounts/audit";
import {
  FALLBACK_ENTRY_TYPE, classifyFailure, downMark, markDown, markUp, rankCandidates, sameModel,
  type Conn, type FailureReason, type FallbackRecord, type ModelRef,
} from "./fallback-logic";
import { listConnections } from "./settings";

/**
 * Wires the connection fallback into one conversation.
 *
 * Where it hooks (and why there): the SDK retries the SAME model itself first; only when those retries are used up does the turn end
 * in an error message and `agent_before_settle` fire. There we return a `context_edit` that drops the failed assistant entry from the
 * model's context (the raw log keeps it), a `custom` entry that records who took over, and `continue: true`, so the same turn simply
 * goes on with the next connection. Not "re-send after prompt() resolved" (agent_settled would already have fired: the page would
 * show the turn as finished and then start again) and never a `custom_message` (pi replays those to the model as a user turn).
 * Before a new turn (`before_agent_start`) the memory of recent failures is consulted: a connection that failed in the last few
 * minutes is not tried first, and once it is due again the conversation goes back to it.
 *
 * Nothing in here throws into the SDK: a failure of the fallback leaves the turn ending exactly as it would without it.
 */

export interface Host {
  current(): ModelRef | undefined;
  contextWindowOf(ref: ModelRef): number | undefined;
  /** Switch this conversation's model (not the global default). */
  switchTo(ref: ModelRef): Promise<boolean>;
  /** Enabled connections in the administrator's order, with the models this conversation's registry knows for each. */
  connections(): Conn[];
  record(r: FallbackRecord): void;
  sessionId(): string;
  now?(): number;
}

type AssistantError = { role: "assistant"; stopReason?: string; errorMessage?: string; provider: string; model: string };
const isAssistantError = (m: unknown): m is AssistantError => {
  const x = m as Partial<AssistantError> | null;
  return !!x && x.role === "assistant" && x.stopReason === "error" && typeof x.provider === "string" && typeof x.model === "string";
};

/** The run ends in an assistant error message: that entry is the one to replace (earlier tries were already omitted by the SDK's retry). */
export function findFailedAssistant(context: { contextEntries?: { sourceEntry: { id: string }; messages: unknown[] }[] } | undefined): { entryId: string; message: AssistantError } | null {
  const entries = context?.contextEntries;
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (!e?.messages?.length) continue;
    const last = e.messages[e.messages.length - 1];
    return isAssistantError(last) ? { entryId: e.sourceEntry.id, message: last } : null;
  }
  return null;
}

const trunc = (t: string | undefined) => (t && t.length > 300 ? `${t.slice(0, 300)}…` : t);

export class FallbackController {
  private preferred: ModelRef | null = null;
  private tried = new Set<string>();
  private runSettled = true;
  private switching = false;
  constructor(private readonly host: Host) {}
  private now() { return this.host.now?.() ?? Date.now(); }

  /** Re-read who this conversation should go back to from its own log (the in-memory copy dies with the idle wrapper). */
  restoreFromEntries(entries: readonly unknown[]): void {
    let lastChange = -1; let lastRec = -1; let rec: Partial<FallbackRecord> | null = null;
    entries.forEach((raw, i) => {
      const e = raw as { type?: string; customType?: string; data?: unknown };
      if (e?.type === "model_change") lastChange = i;
      if (e?.type === "custom" && e.customType === FALLBACK_ENTRY_TYPE) { lastRec = i; rec = e.data as Partial<FallbackRecord>; }
    });
    const r = rec as Partial<FallbackRecord> | null;
    // A later model_change that is not ours means a person chose a model since: do not pull them back.
    if (!r || lastRec < lastChange || r.kind === "restore" || r.kind === "none") return;
    const p = r.preferred;
    if (p && typeof p.provider === "string" && typeof p.modelId === "string") this.preferred = { provider: p.provider, modelId: p.modelId };
  }

  /** A person picked a model (model_select fires for our own switch too, which is not that). */
  onExplicitModelChange(): void { if (!this.switching) this.preferred = null; }

  private async doSwitch(ref: ModelRef): Promise<boolean> {
    this.switching = true;
    try { return await this.host.switchTo(ref); } finally { this.switching = false; }
  }

  onSessionEvent(ev: { type: string; message?: unknown }): void {
    if (ev.type === "agent_settled") { this.runSettled = true; return; }
    if (ev.type !== "message_end") return;
    const m = ev.message as Partial<AssistantError> | undefined;
    if (!m || m.role !== "assistant" || m.stopReason === "error" || m.stopReason === "aborted" || typeof m.provider !== "string") return;
    markUp(m.provider); // it just answered: no need to wait out the cooldown
  }

  async onBeforeSettle(event: { entries?: unknown[]; context?: Parameters<typeof findFailedAssistant>[0] }): Promise<{ entries: unknown[]; continue?: boolean } | undefined> {
    try {
      if (this.runSettled) { this.tried = new Set(); this.runSettled = false; }
      const target = findFailedAssistant(event.context);
      if (!target) return undefined;
      const from: ModelRef = { provider: target.message.provider, modelId: target.message.model };
      const reason = classifyFailure(target.message, this.host.contextWindowOf(from));
      if (!reason) return undefined;
      markDown(from.provider, reason, this.now());
      this.tried.add(from.provider);
      const prior = Array.isArray(event.entries) ? event.entries : [];
      const preferred = this.preferred ?? from;
      for (const cand of rankCandidates({ from, connections: this.host.connections(), tried: this.tried, now: this.now() })) {
        this.tried.add(cand.provider);
        let ok = false;
        try { ok = await this.doSwitch(cand); } catch (e) { console.error("[tigerai] fallback: switching to", cand.provider, "failed:", e instanceof Error ? e.message : e); }
        if (!ok) continue;
        this.preferred = sameModel(preferred, cand) ? null : preferred;
        const rec: FallbackRecord = { kind: "fallback", from, to: cand, reason, detail: trunc(target.message.errorMessage), preferred: this.preferred, at: new Date(this.now()).toISOString() };
        this.host.record(rec);
        return {
          entries: [...prior, { type: "context_edit", targetId: target.entryId, replacement: null }, { type: "custom", customType: FALLBACK_ENTRY_TYPE, data: rec }],
          continue: true,
        };
      }
      const none: FallbackRecord = { kind: "none", from, to: null, reason, detail: trunc(target.message.errorMessage), preferred: this.preferred, at: new Date(this.now()).toISOString() };
      this.host.record(none);
      return { entries: [...prior, { type: "custom", customType: FALLBACK_ENTRY_TYPE, data: none }] };
    } catch (e) {
      console.error("[tigerai] fallback failed (the turn ends as it would have):", e instanceof Error ? e.message : e);
      return undefined;
    }
  }

  /** Before a new turn: go back to the preferred connection once it is due again, or step off one that failed minutes ago. Never blocks the send. */
  async beforePrompt(appendEntry: (customType: string, data: unknown) => void): Promise<void> {
    this.tried = new Set(); this.runSettled = false;
    try {
      const cur = this.host.current();
      if (!cur) return;
      const conns = this.host.connections();
      const stamp = () => new Date(this.now()).toISOString();
      if (this.preferred && sameModel(this.preferred, cur)) this.preferred = null;
      if (this.preferred) {
        const pref = this.preferred;
        const conn = conns.find((c) => c.id === pref.provider);
        if (!conn || !conn.models.includes(pref.modelId)) this.preferred = null; // it is gone: the substitute becomes this conversation's model
        else if (!downMark(pref.provider, this.now())) {
          if (await this.doSwitch(pref)) {
            this.preferred = null;
            const rec: FallbackRecord = { kind: "restore", from: cur, to: pref, reason: "restore", preferred: null, at: stamp() };
            this.host.record(rec); appendEntry(FALLBACK_ENTRY_TYPE, rec);
            return;
          }
        } else {
          // Still within its cooldown: stay on the substitute, and say so for this turn too.
          const mark = downMark(pref.provider, this.now())!;
          const rec: FallbackRecord = { kind: "skip-unhealthy", from: pref, to: cur, reason: mark.reason, preferred: pref, at: stamp() };
          this.host.record(rec); appendEntry(FALLBACK_ENTRY_TYPE, rec);
          return;
        }
      }
      const mark = downMark(cur.provider, this.now());
      if (!mark) return;
      const cand = rankCandidates({ from: cur, connections: conns, tried: new Set([cur.provider]), now: this.now() })[0];
      const keep = this.preferred ?? cur;
      if (!cand || !(await this.doSwitch(cand))) return; // nobody to take over: send as it is, the SDK may find it back
      this.preferred = keep;
      const rec: FallbackRecord = { kind: "skip-unhealthy", from: cur, to: cand, reason: mark.reason, preferred: this.preferred, at: stamp() };
      this.host.record(rec); appendEntry(FALLBACK_ENTRY_TYPE, rec);
    } catch (e) {
      console.error("[tigerai] fallback (before send) failed, sending as is:", e instanceof Error ? e.message : e);
    }
  }
}

/** Enabled connections, in order, each with the models this registry offers and its configured default. */
export function connectionsFor(models: { provider: string; id: string }[], list = listConnections()): Conn[] {
  return list.filter((c) => c.enabled && c.baseUrl).map((c) => ({ id: c.id, name: c.name, defaultModel: c.defaultModel ?? null, models: models.filter((m) => m.provider === c.id).map((m) => m.id) }))
    .filter((c) => c.models.length > 0);
}

export function connectionName(id: string, list = listConnections()): string { return list.find((c) => c.id === id)?.name ?? id; }

/** Audit row: which conversation, from which connection to which. Names are stored (a renamed connection still reads right later). */
export function auditFallback(sessionId: string, r: FallbackRecord): void {
  if (r.kind === "restore") return;
  try {
    writeAudit("model.fallback", null, {
      sessionId, kind: r.kind, reason: r.reason,
      fromConnection: connectionName(r.from.provider), toConnection: r.to ? connectionName(r.to.provider) : "",
      model: r.to?.modelId ?? r.from.modelId,
    });
  } catch { /* the audit must not break a turn */ }
}

export function createFallbackExtension(ctxInfo: { sessionId: string }): InlineExtension {
  return {
    name: "tigerai-model-fallback",
    hidden: true,
    factory: (pi) => {
      let ctxRef: { model?: { provider: string; id: string; contextWindow?: number }; modelRegistry: { getAll(): { provider: string; id: string }[]; find(p: string, id: string): unknown }; sessionManager: { getEntries(): unknown[]; getSessionId?(): string } } | null = null;
      // The key given at start is temporary for a brand-new conversation; the log and the audit want the real id.
      const realId = () => { try { return ctxRef?.sessionManager.getSessionId?.() || ctxInfo.sessionId; } catch { return ctxInfo.sessionId; } };
      const host: Host = {
        current: () => (ctxRef?.model ? { provider: ctxRef.model.provider, modelId: ctxRef.model.id } : undefined),
        contextWindowOf: (ref) => (ctxRef?.model && ctxRef.model.provider === ref.provider && ctxRef.model.id === ref.modelId ? ctxRef.model.contextWindow : undefined),
        switchTo: async (ref) => {
          const model = ctxRef?.modelRegistry.find(ref.provider, ref.modelId);
          return model ? pi.setModel(model as Parameters<typeof pi.setModel>[0]) : false;
        },
        connections: () => connectionsFor(ctxRef?.modelRegistry.getAll() ?? []),
        record: (r) => auditFallback(realId(), r),
        sessionId: () => realId(),
      };
      const ctl = new FallbackController(host);
      let restored = false;
      const take = (ctx: unknown) => {
        ctxRef = ctx as typeof ctxRef;
        if (!restored && ctxRef) { restored = true; try { ctl.restoreFromEntries(ctxRef.sessionManager.getEntries()); } catch { /* fresh conversation */ } }
      };
      pi.on("model_select", (event) => { if ((event as { source?: string }).source === "set") ctl.onExplicitModelChange(); });
      pi.on("before_agent_start", async (_event, ctx) => { take(ctx); await ctl.beforePrompt((t, d) => pi.appendEntry(t, d)); });
      pi.on("message_end", (event, ctx) => { take(ctx); ctl.onSessionEvent(event as { type: string; message?: unknown }); });
      pi.on("agent_settled", () => ctl.onSessionEvent({ type: "agent_settled" }));
      pi.on("agent_before_settle", async (event, ctx) => {
        take(ctx);
        return (await ctl.onBeforeSettle(event as Parameters<FallbackController["onBeforeSettle"]>[0])) as never;
      });
    },
  };
}

export type { FailureReason };
