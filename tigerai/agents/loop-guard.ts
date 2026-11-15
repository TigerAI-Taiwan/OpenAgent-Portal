// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { writeAudit } from "../accounts/audit";

/**
 * Loop guard: a model that keeps calling tools with nothing in them (or that keeps failing the same way) must not hold the shared model
 * for half an hour (the demo run saw ~150 empty calls over 33 minutes). Three independent limits, per run:
 *   - EMPTY_LIMIT   consecutive tool calls whose arguments are empty
 *   - ERROR_LIMIT   consecutive tool results that are errors (invalid arguments, unknown tool, ...)
 *   - CALL_LIMIT    tool calls in one run, whatever they are
 * Any call with real arguments resets the empty streak; any successful result resets the error streak. The call that crosses a limit is
 * blocked, the run is aborted, one plain message is written into the conversation and one audit row records it. Counters reset when a
 * new run starts and when the agent settles. Not wired into the SDK's own retry: this only ever ends a run, never retries one.
 */
export const LOOP_GUARD_DEFAULTS = { emptyLimit: 5, errorLimit: 8, callLimit: 200 } as const;
export type LoopReason = "empty" | "error" | "calls";

const envInt = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isInteger(n) && n > 0 ? n : def; };
export const loopLimits = () => ({
  emptyLimit: envInt("TIGERAI_LOOP_EMPTY_LIMIT", LOOP_GUARD_DEFAULTS.emptyLimit),
  errorLimit: envInt("TIGERAI_LOOP_ERROR_LIMIT", LOOP_GUARD_DEFAULTS.errorLimit),
  callLimit: envInt("TIGERAI_LOOP_CALL_LIMIT", LOOP_GUARD_DEFAULTS.callLimit),
});

/** True when the arguments carry nothing: not an object, no keys, or every value blank / null / empty. */
export function isEmptyInput(input: unknown): boolean {
  if (input === null || input === undefined) return true;
  if (typeof input === "string") return input.trim() === "";
  if (typeof input !== "object") return false;
  if (Array.isArray(input)) return input.every(isEmptyInput);
  const vals = Object.values(input as Record<string, unknown>);
  return vals.length === 0 || vals.every(isEmptyInput);
}

export function loopMessage(reason: LoopReason, n: number): string {
  const why = reason === "empty" ? `連續 ${n} 次呼叫工具但沒有帶任何內容`
    : reason === "error" ? `連續 ${n} 次呼叫工具都失敗`
    : `這一輪已呼叫工具 ${n} 次`;
  return `AI 好像卡住了(${why}),系統已停止這一輪,避免一直占用模型。請換個方式再問一次,或換一個模型試試。`;
}

/** The counting alone, so it can be tested without the SDK. */
export class LoopGuard {
  private empty = 0; private errors = 0; private calls = 0; private tripped: LoopReason | null = null;
  constructor(private readonly limits = loopLimits()) {}
  reset(): void { this.empty = 0; this.errors = 0; this.calls = 0; this.tripped = null; }
  /** A tool is about to run. Returns the reason when this call must not run (and every later one in this run). */
  onCall(input: unknown): { reason: LoopReason; n: number } | null {
    if (this.tripped) return { reason: this.tripped, n: this.count(this.tripped) };
    this.calls += 1;
    this.empty = isEmptyInput(input) ? this.empty + 1 : 0;
    if (this.empty >= this.limits.emptyLimit) return this.trip("empty");
    if (this.calls > this.limits.callLimit) return this.trip("calls");
    return null;
  }
  onResult(isError: boolean): { reason: LoopReason; n: number } | null {
    this.errors = isError ? this.errors + 1 : 0;
    if (!this.tripped && this.errors >= this.limits.errorLimit) return this.trip("error");
    return null;
  }
  wasTripped(): boolean { return this.tripped !== null; }
  private count(r: LoopReason): number { return r === "empty" ? this.empty : r === "error" ? this.errors : this.calls; }
  private trip(r: LoopReason) { this.tripped = r; return { reason: r, n: this.count(r) }; }
}

export function createLoopGuardExtension(info: { sessionId: string; actorId?: string | null }): InlineExtension {
  return {
    name: "tigerai-loop-guard",
    hidden: true,
    factory: (pi) => {
      const guard = new LoopGuard();
      let announced = false;
      const stop = (hit: { reason: LoopReason; n: number }, ctx: { abort(): void; sessionManager?: { getSessionId?(): string } }) => {
        if (announced) return;
        announced = true;
        try { writeAudit("agent.loop_guard", info.actorId ?? null, { sessionId: ctx.sessionManager?.getSessionId?.() || info.sessionId, reason: hit.reason, count: hit.n }); } catch { /* the audit must not break a turn */ }
        try { pi.sendMessage({ customType: "tigerai:loop-guard", content: loopMessage(hit.reason, hit.n), display: true, details: { reason: hit.reason, count: hit.n } }); } catch { /* the message is a courtesy */ }
        try { ctx.abort(); } catch { /* already stopping */ }
      };
      const fresh = () => { guard.reset(); announced = false; };
      pi.on("before_agent_start", () => { fresh(); return undefined; });
      pi.on("agent_settled", () => { fresh(); });
      pi.on("tool_call", (event, ctx) => {
        const hit = guard.onCall((event as { input?: unknown }).input);
        if (!hit) return undefined;
        stop(hit, ctx as never);
        return { block: true, terminate: true, reason: "Stopped: too many empty or failing tool calls in one run." };
      });
      pi.on("tool_result", (event, ctx) => {
        const hit = guard.onResult((event as { isError?: boolean }).isError === true);
        if (hit) stop(hit, ctx as never);
        return undefined;
      });
    },
  };
}
