// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { PRIMARY_ID, connKey, connKeyEnv, effectiveInput, effectiveLimits, listConnections, type Connection } from "./settings";
import { homedir } from "node:os";
import { join } from "node:path";
import { isEmbeddingModel } from "./model-kind";

/**
 * Models come from ONE place: an OpenAI-compatible /v1 endpoint the operator
 * provides (the on-prem gateway). Configuration by environment:
 *   TIGERAI_V1_BASE_URL       e.g. http://gateway.example.com:5000/v1
 *   TIGERAI_V1_API_KEY_FILE   path of a file holding the key (its value is never logged or returned)
 *   TIGERAI_V1_MODELS         optional comma list of model ids; otherwise GET {base}/models
 *   TIGERAI_V1_EXCLUDE        optional comma list of ids to hide (known-broken ones on the gateway)
 *   TIGERAI_V1_DEFAULT_MODEL  model new conversations start with (default: "tigerai-fast" if offered, else the first)
 *   TIGERAI_V1_CONTEXT_WINDOW / TIGERAI_V1_MAX_TOKENS  fallbacks (32768 / 32768, output capped at half the context) used only for a
 *                             model the gateway reports no size for. Per model the runtime uses: the administrator's override,
 *                             else the gateway's reported value, else these (see effectiveLimits in settings.ts). The old rule
 *                             (32768 / 4096 for everything) ignored the gateway and cut a 130k model to 32k.
 * We use pi's own mechanism for it: a provider in models.json (api
 * "openai-completions"), with the key passed as an environment reference so it is
 * never written to disk by us. No subscription logins (OAuth / device code) are offered.
 */

export const PROVIDER_ID = PRIMARY_ID;

/** True once at least one connection exists (by the administrator's saved list, the old single settings, or the environment). */
export function v1Locked(): boolean {
  return listConnections().some((c) => !!c.baseUrl);
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export interface ConnStatus { id: string; ok: boolean; models: string[]; source: "env" | "endpoint" | "none"; error?: string }
export interface V1Status { configured: boolean; baseUrl?: string; models: string[]; source: "env" | "endpoint" | "none"; error?: string; /** per connection (enabled ones) */ connections?: ConnStatus[] }

export interface GatewayModel { id: string; contextWindow: number | null; maxTokens: number | null; /** the gateway's input list when it gives an array, else null */ input: string[] | null }
const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);

/** GET {base}/models with whatever size hints the gateway publishes (used to prefill and to cap the admin's overrides). */
export async function discoverDetailed(base: string, key: string | null): Promise<GatewayModel[]> {
  const res = await fetch(`${base.replace(/\/+$/, "")}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GET /models answered ${res.status}`);
  const json = await res.json() as { data?: Record<string, unknown>[] };
  return (json.data ?? []).filter((m) => typeof m.id === "string" && (m.id as string).length > 0).map((m) => ({
    id: m.id as string,
    contextWindow: pos(m.context_length) ?? pos(m.context_window) ?? pos(m.max_model_len) ?? pos(m.max_context_length),
    maxTokens: pos(m.max_output_tokens) ?? pos(m.max_completion_tokens) ?? pos(m.max_tokens),
    input: Array.isArray(m.input) ? (m.input as unknown[]).filter((x): x is string => typeof x === "string") : null,
  }));
}


// Kept on globalThis: start-up (instrumentation) and the API routes are separate module graphs in one process.
const STATUS = Symbol.for("tigerai:v1-status");
const holder = globalThis as unknown as Record<symbol, V1Status | undefined>;
export function v1Status(): V1Status {
  return holder[STATUS] ?? { configured: v1Locked(), baseUrl: listConnections().find((c) => c.enabled)?.baseUrl, models: [], source: "none" };
}

/** Which models of one connection are offered: the gateway's list narrowed by the admin's ticks (or TIGERAI_V1_MODELS), minus known-bad and embedding ones. */
async function provisionOne(c: Connection, previous: string[]): Promise<{ models: string[]; reported: Map<string, GatewayModel>; status: ConnStatus }> {
  const key = connKey(c.id);
  // The key stays in this process's environment; models.json only refers to it.
  if (key) process.env[connKeyEnv(c.id)] = key; else delete process.env[connKeyEnv(c.id)];
  const offered = c.offered ?? null;
  let models: string[] = [];
  const reported = new Map<string, GatewayModel>();
  let source: ConnStatus["source"] = "none";
  let error: string | undefined;
  try { const found = await discoverDetailed(c.baseUrl, key); for (const m of found) reported.set(m.id, m); models = found.map((m) => m.id); source = "endpoint"; } catch (e) { error = e instanceof Error ? e.message : String(e); }
  // An explicit offered set limits what the gateway lists; when the list cannot be fetched it is trusted as is.
  if (offered) {
    if (models.length) { const on = new Set(offered); models = models.filter((id) => on.has(id)); }
    else { models = [...offered]; source = "env"; } // trusted as is, but the status still says the address did not answer
  }
  if (!models.length && error && previous.length) { models = previous; source = "none"; }
  const excluded = new Set((process.env.TIGERAI_V1_EXCLUDE ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  models = models.filter((id) => !excluded.has(id) && !isEmbeddingModel(id));
  return { models, reported, status: { id: c.id, ok: !error, models, source, ...(error ? { error } : {}) } };
}

/** Write models.json: one provider per ENABLED connection, in the connection order. Called at start-up and on every admin change. */
export async function provisionV1(): Promise<V1Status> {
  const all = listConnections().filter((c) => c.baseUrl);
  const active = all.filter((c) => c.enabled);
  if (!active.length) {
    if (all.length) { writeModelsFile({}); } // everything disabled: no provider at all, but the lock stays (see v1Locked)
    return (holder[STATUS] = { configured: all.length > 0, models: [], source: "none", connections: [] });
  }
  const providers: Record<string, unknown> = {};
  const statuses: ConnStatus[] = [];
  const previousByProvider = previousModels();
  for (const c of active) {
    const one = await provisionOne(c, previousByProvider[c.id] ?? []);
    statuses.push(one.status);
    const overrides = c.overrides ?? {};
    providers[c.id] = {
      name: c.id === PRIMARY_ID ? "TigerAI Models" : c.name,
      baseUrl: c.baseUrl.replace(/\/+$/, ""),
      api: "openai-completions",
      apiKey: "$" + connKeyEnv(c.id),
      // reasoning:true lets pi offer and apply a thinking level (without it the composer says "off" while the model thinks anyway).
      // qwen-chat-template sends chat_template_kwargs.enable_thinking; TIGERAI_V1_THINKING_FORMAT overrides (e.g. "chat-template").
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, thinkingFormat: process.env.TIGERAI_V1_THINKING_FORMAT || "qwen-chat-template" },
      models: one.models.map((id) => ({ id, reasoning: true, input: effectiveInput(one.reported.get(id), overrides[id]), ...effectiveLimits(one.reported.get(id), overrides[id]) })),
    };
  }
  if (statuses.some((s) => s.error && !s.models.length)) scheduleRetry();
  const dir = writeModelsFile(providers);
  // New conversations start on the primary's default (the first enabled connection that has any model).
  const lead = active.find((c) => (statuses.find((s) => s.id === c.id)?.models.length ?? 0) > 0);
  if (lead) setDefaultModel(dir, lead.id, statuses.find((s) => s.id === lead.id)!.models, lead.defaultModel || process.env.TIGERAI_V1_DEFAULT_MODEL || "tigerai-fast");
  const first = statuses[0];
  const last: V1Status = { configured: true, baseUrl: active[0].baseUrl, models: first.models, source: first.source, ...(first.error ? { error: first.error } : {}), connections: statuses };
  holder[STATUS] = last;
  // Sessions and the model picker read from a cache; drop it so the next message sees the new list.
  try { (await import("../../lib/models-cache")).invalidateModelsCache(); } catch { /* not available (tests) */ }
  for (const s of statuses) {
    if (s.error) console.error(`[tigerai] model list not fetched from connection ${s.id}: ${s.error}`);
    else console.log(`[tigerai] models provisioned from ${s.source} (${s.id}): ${s.models.length} model(s)`);
  }
  return last;
}

function writeModelsFile(providers: Record<string, unknown>): string {
  const dir = agentDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "models.json");
  const backup = join(dir, "models.json.before-tigerai");
  if (existsSync(file) && !existsSync(backup)) { try { copyFileSync(file, backup); } catch { /* best effort */ } }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ providers }, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
  return dir;
}

/** What models.json lists now, per provider: a failed fetch must not wipe a working list. */
function previousModels(): Record<string, string[]> {
  try {
    const d = JSON.parse(readFileSync(join(agentDir(), "models.json"), "utf8")) as { providers?: Record<string, { models?: { id?: string }[] }> };
    return Object.fromEntries(Object.entries(d.providers ?? {}).map(([id, p]) => [id, (p.models ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string")]));
  } catch { return {}; }
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = undefined; void provisionV1().catch(() => undefined); }, 30_000);
  retryTimer.unref?.();
}

/** New conversations start with the configured default (merged into settings.json; other settings are kept). */
function setDefaultModel(dir: string, provider: string, models: string[], wanted: string): void {
  const pick = models.includes(wanted) ? wanted : models[0];
  if (!pick) return;
  const file = join(dir, "settings.json");
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* none yet */ }
  // New conversations think at "medium" unless an administrator already chose a level.
  const level = current.defaultThinkingLevel ?? "medium";
  if (current.defaultProvider === provider && current.defaultModel === pick && current.defaultThinkingLevel === level) return;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...current, defaultProvider: provider, defaultModel: pick, defaultThinkingLevel: level }, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
}
