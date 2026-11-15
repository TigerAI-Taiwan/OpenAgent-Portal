// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { isContextOverflow, isRetryableAssistantError } from "@earendil-works/pi-ai";

/**
 * Model connection fallback: the pure part (what counts as "the connection is down", who is next, who was down recently).
 * The wiring into a conversation is fallback-runtime.ts. Written for this portal from the idea of the older pi-web fork's
 * lib/model-fallback.ts (agent_before_settle + context_edit + continue), with the unit being a CONNECTION, not a model.
 */

export interface ModelRef { provider: string; modelId: string }
export type FailureReason = "unreachable" | "timeout" | "overloaded" | "server-error" | "model-unavailable" | "transient";

/** Shown when a person's own connection failed and nothing else may take over (the public models are closed to the fallback by default). */
export const PERSONAL_DOWN_NOTICE = "你的模型連線沒有回應，請檢查金鑰或額度";
export const FALLBACK_ENTRY_TYPE = "tigerai:model-fallback";
export type FallbackKind = "fallback" | "skip-unhealthy" | "restore" | "none";
export interface FallbackRecord {
  kind: FallbackKind;
  from: ModelRef;
  to: ModelRef | null;
  reason: FailureReason | "restore";
  detail?: string;
  /** The model this conversation should go back to when the primary connection is healthy again. null = already there. */
  preferred: ModelRef | null;
  at: string;
}

const MODEL_UNAVAILABLE = new RegExp([
  "model[_ .-]?not[_ .-]?found", "no such model", "unknown model",
  "model\\b[^\\n]{0,120}\\b(does not exist|not found|is not available|not available|unavailable|not loaded|is not loaded|not served|offline)",
  "\\b404\\b[^\\n]{0,160}\\bmodel\\b", "\\bmodel\\b[^\\n]{0,160}\\b404\\b",
].join("|"), "i");
const UNREACHABLE = /connection.?refused|econnrefused|connection.?reset|econnreset|fetch failed|getaddrinfo|enotfound|eai_again|socket hang up|other side closed|socket connection was closed|upstream.?connect|reset before headers|network.?error|connection.?error|connection.?lost/i;
const TIMEOUT = /timed? ?out|timeout|etimedout|\b524\b/i;
const OVERLOADED = /\b429\b|rate.?limit|too many requests|overloaded|high demand|resourceexhausted/i;
const SERVER_ERROR = /\b50[0-4]\b|\b520\b|service.?unavailable|server.?error|internal.?error|provider.?returned.?error/i;

/**
 * Is this assistant message an error because the CONNECTION or model cannot be used (unreachable, timeout, 5xx, 429, model missing)?
 * Not: a bad answer, an empty one, a cut-off one, a context overflow (that is compaction's job), quota/billing (an admin matter), a user stop.
 */
export function classifyFailure(message: { stopReason?: string; errorMessage?: string }, contextWindow?: number): FailureReason | null {
  if (message.stopReason !== "error" || !message.errorMessage) return null;
  const typed = message as Parameters<typeof isRetryableAssistantError>[0];
  if (isContextOverflow(typed as Parameters<typeof isContextOverflow>[0], contextWindow ?? 0)) return null;
  const text = message.errorMessage;
  const missing = MODEL_UNAVAILABLE.test(text); const unreachable = UNREACHABLE.test(text); const timedOut = TIMEOUT.test(text);
  // A refused/reset connection is not on the SDK's retry list in its Node-native spelling, but for us it is exactly "the machine is not there".
  if (!isRetryableAssistantError(typed) && !missing && !unreachable && !timedOut) return null;
  if (missing) return "model-unavailable";
  if (unreachable) return "unreachable";
  if (timedOut) return "timeout";
  if (OVERLOADED.test(text)) return "overloaded";
  if (SERVER_ERROR.test(text)) return "server-error";
  return "transient";
}

export const sameModel = (a: ModelRef | null | undefined, b: ModelRef | null | undefined) => !!a && !!b && a.provider === b.provider && a.modelId === b.modelId;

// ---------------------------------------------------------------- health memory (per connection, per process)

/** How long a connection that just failed is not tried first. Default 10 minutes; TIGERAI_FALLBACK_COOLDOWN_SECONDS overrides. */
export function cooldownMs(): number {
  const n = Number(process.env.TIGERAI_FALLBACK_COOLDOWN_SECONDS);
  return (Number.isFinite(n) && n >= 0 ? n : 600) * 1000;
}
type Mark = { until: number; reason: FailureReason };
const HEALTH = Symbol.for("tigerai:connection-health");
function health(): Map<string, Mark> { return ((globalThis as unknown as Record<symbol, Map<string, Mark> | undefined>)[HEALTH] ??= new Map()); }
export function markDown(provider: string, reason: FailureReason, now = Date.now(), windowMs = cooldownMs()): void { health().set(provider, { until: now + windowMs, reason }); }
export function markUp(provider: string): void { health().delete(provider); }
export function downMark(provider: string, now = Date.now()): Mark | null {
  const m = health().get(provider);
  if (!m) return null;
  if (m.until <= now) { health().delete(provider); return null; }
  return m;
}
export function resetHealth(): void { health().clear(); }

// ---------------------------------------------------------------- who is next

/** One enabled connection as the ranking sees it: its models as the session's registry knows them. */
export interface Conn { id: string; name: string; models: string[]; defaultModel: string | null }

/** The model a connection answers with for a request that asked for `wanted`: the same name, else its own default, else its first model. */
export function pickModel(c: Conn, wanted: string): string | null {
  if (c.models.includes(wanted)) return wanted;
  if (c.defaultModel && c.models.includes(c.defaultModel)) return c.defaultModel;
  if (c.models.includes("tigerai-fast")) return "tigerai-fast";
  return c.models[0] ?? null;
}

/**
 * Candidates in the administrator's order: every enabled connection other than the failed one, the ones not marked down and not
 * already tried this turn, each with the same-named model or else its default. `connections` is already in order (enabled only).
 */
export function rankCandidates(a: { from: ModelRef; connections: Conn[]; tried: ReadonlySet<string>; now?: number }): ModelRef[] {
  const out: ModelRef[] = [];
  for (const c of a.connections) {
    if (c.id === a.from.provider || a.tried.has(c.id) || downMark(c.id, a.now)) continue;
    const m = pickModel(c, a.from.modelId);
    if (m) out.push({ provider: c.id, modelId: m });
  }
  return out;
}

/** The one-line notice, built from what the record holds; names come from the current connection list (falling back to the ids). */
export function noticeText(r: Pick<FallbackRecord, "kind" | "from" | "to">, nameOf: (provider: string) => string, firstId: string | null): string {
  const label = (p: string) => (p === firstId ? "主要連線" : `連線「${nameOf(p)}」`);
  if (r.kind === "restore" && r.to) return `${label(r.to.provider)}已恢復,這次回到「${nameOf(r.to.provider)}」的 ${r.to.modelId}。`;
  const was = label(r.from.provider);
  if ((r.kind === "none" || !r.to) && r.from.provider.startsWith("tgp-")) return PERSONAL_DOWN_NOTICE;
  if (r.kind === "none" || !r.to) return `${was}沒有回應,而且沒有可以改用的連線。`;
  return `${was}沒有回應,這次改用「${nameOf(r.to.provider)}」的 ${r.to.modelId}。`;
}
