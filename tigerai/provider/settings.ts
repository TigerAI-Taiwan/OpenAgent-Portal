// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";

/**
 * Admin-editable model settings. Two files in the data directory, both mode 600:
 *   models-settings.json  everything except the key
 *   v1-api-key            the key alone (never in the JSON, never logged, only its last 4 characters are ever shown)
 * Environment variables (TIGERAI_V1_*) are the initial defaults: a saved value wins.
 */

export interface ModelOverride { contextWindow?: number; maxTokens?: number; /** true = the model accepts pictures, false = text only; absent = what the gateway reports (null → pictures allowed). */ images?: boolean }
/**
 * One model connection (a /v1 endpoint). The id doubles as the provider id in models.json ("tigerai" for the first one ever,
 * then "tigerai-2", ...) and never changes, so an AI role that names a model keeps working when connections are reordered.
 * The order of the array is the order of use: the first enabled one is the primary, the rest are fallbacks.
 */
export interface Connection {
  id: string; name: string; baseUrl: string; enabled: boolean;
  offered?: string[] | null; defaultModel?: string | null; overrides?: Record<string, ModelOverride>;
}
export interface ModelSettings {
  /** The list. Absent = not migrated yet: the legacy single-connection fields below (and the TIGERAI_V1_* environment) stand for connection #1. */
  connections?: Connection[];
  baseUrl?: string;
  /** undefined / null = every model the gateway lists. */
  offered?: string[] | null;
  defaultModel?: string | null;
  overrides?: Record<string, ModelOverride>;
}

const settingsFile = () => join(dataDir(), "models-settings.json");
export const keyFile = () => join(dataDir(), "v1-api-key");
export const PRIMARY_ID = "tigerai";
/** Connection #1 keeps the original key file (so an upgrade needs no move); later ones get their own, all mode 600. */
export const connKeyFile = (id: string) => (id === PRIMARY_ID ? keyFile() : join(dataDir(), `v1-key-${id.replace(/[^a-z0-9-]/gi, "_")}`));
export const connKeyEnv = (id: string) => (id === PRIMARY_ID ? "TIGERAI_V1_RUNTIME_KEY" : `TIGERAI_V1_RUNTIME_KEY_${id.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`);

const CACHE = Symbol.for("tigerai:model-settings");
type Cache = { mtime: number; size: number; value: ModelSettings } | undefined;

export function readSettings(): ModelSettings {
  const g = globalThis as unknown as Record<symbol, Cache>;
  try {
    const st = statSync(settingsFile());
    const c = g[CACHE];
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.value;
    const v = JSON.parse(readFileSync(settingsFile(), "utf8")) as ModelSettings;
    g[CACHE] = { mtime: st.mtimeMs, size: st.size, value: v && typeof v === "object" ? v : {} };
    return g[CACHE]!.value;
  } catch {
    g[CACHE] = undefined;
    return {};
  }
}

function atomicWrite(file: string, text: string): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

export function writeSettings(next: ModelSettings): void {
  atomicWrite(settingsFile(), JSON.stringify(next, null, 2) + "\n");
  (globalThis as unknown as Record<symbol, Cache>)[CACHE] = undefined;
}

export function writeKey(key: string | null): void {
  if (key === null) { try { unlinkSync(keyFile()); } catch { /* none */ } return; }
  atomicWrite(keyFile(), key.trim() + "\n");
}

/** What the legacy single-connection fields and the environment say, as connection #1 (null = nothing configured). */
function legacyConnection(s: ModelSettings): Connection | null {
  const url = s.baseUrl || process.env.TIGERAI_V1_BASE_URL;
  if (!url) return null;
  const env = envList(process.env.TIGERAI_V1_MODELS);
  return {
    id: PRIMARY_ID, name: "主要連線", baseUrl: url, enabled: true,
    offered: s.offered !== undefined ? s.offered : (env.length ? env : null),
    defaultModel: s.defaultModel || process.env.TIGERAI_V1_DEFAULT_MODEL || null,
    overrides: s.overrides ?? {},
  };
}

/** The connection list in order. A portal that has never saved a list gets its old single configuration as #1 (no reset on upgrade). */
export function listConnections(): Connection[] {
  const s = readSettings();
  if (Array.isArray(s.connections)) return s.connections.map((c) => ({ ...c, enabled: c.enabled !== false }));
  const legacy = legacyConnection(s);
  return legacy ? [legacy] : [];
}

/** Persist the list; the legacy single-connection fields are dropped because the list now owns them. */
export function writeConnections(list: Connection[]): void {
  const { baseUrl: _b, offered: _o, defaultModel: _d, overrides: _v, ...rest } = readSettings();
  void _b; void _o; void _d; void _v;
  writeSettings({ ...rest, connections: list });
}

/** True while the list still comes from the legacy fields / environment. */
export function connectionsMigrated(): boolean { return Array.isArray(readSettings().connections); }

/** The primary: the first enabled connection (what the bulletin's AI draft and "the" model address mean). */
export function primaryConnection(): Connection | null { return listConnections().find((c) => c.enabled && c.baseUrl) ?? null; }

export function connKey(id: string): string | null {
  const files = id === PRIMARY_ID ? [keyFile(), process.env.TIGERAI_V1_API_KEY_FILE] : [connKeyFile(id)];
  for (const f of files) {
    if (!f || !existsSync(f)) continue;
    try { const k = readFileSync(f, "utf8").trim(); if (k) return k; } catch { /* next */ }
  }
  return null;
}
export function writeConnKey(id: string, key: string | null): void {
  if (id === PRIMARY_ID) return writeKey(key);
  if (key === null) { try { unlinkSync(connKeyFile(id)); } catch { /* none */ } return; }
  atomicWrite(connKeyFile(id), key.trim() + "\n");
}
export const connKeyLast4 = (id: string): string | null => { const k = connKey(id); return k ? k.slice(-4) : null; };

/** The key of the primary connection. Never returned to a client. */
export function effectiveKey(): string | null { const p = primaryConnection(); return p ? connKey(p.id) : null; }

export const keyLast4 = (): string | null => { const k = effectiveKey(); return k ? k.slice(-4) : null; };

export function effectiveBaseUrl(): { url: string | null; source: "settings" | "env" | "none" } {
  const p = primaryConnection();
  if (!p) return { url: null, source: "none" };
  return { url: p.baseUrl, source: connectionsMigrated() || readSettings().baseUrl ? "settings" : "env" };
}

const envList = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function effectiveOffered(): string[] | null { return primaryConnection()?.offered ?? null; }

export function effectiveDefaultModel(): string {
  return primaryConnection()?.defaultModel || process.env.TIGERAI_V1_DEFAULT_MODEL || "tigerai-fast";
}

export function defaultLimits(): { contextWindow: number; maxTokens: number } {
  return {
    // Only used when the gateway publishes no size at all (and no override exists).
    contextWindow: Number(process.env.TIGERAI_V1_CONTEXT_WINDOW) || 32768,
    // Reasoning models spend part of max_tokens thinking (16384 was cut off mid-thought in practice): the default is 32768,
    // never more than half the context (effectiveLimits). Keep it well above a few hundred or the answer comes back empty.
    maxTokens: Math.max(400, Number(process.env.TIGERAI_V1_MAX_TOKENS) || 32768),
  };
}

/**
 * What the runtime uses for one model: the administrator's override, else what the gateway reports, else the default.
 * A default output size never exceeds half the context window (a small model cannot be asked for more than it can hold).
 */
export function effectiveLimits(gw: { contextWindow?: number | null; maxTokens?: number | null } | undefined, override?: ModelOverride): { contextWindow: number; maxTokens: number } {
  const d = defaultLimits();
  const contextWindow = override?.contextWindow ?? gw?.contextWindow ?? d.contextWindow;
  const maxTokens = override?.maxTokens ?? gw?.maxTokens ?? Math.max(400, Math.min(d.maxTokens, Math.floor(contextWindow / 2)));
  return { contextWindow, maxTokens };
}

/**
 * What a model accepts as input. The administrator's switch wins; else the gateway's own list when it gives an array;
 * else (it reports nothing) pictures are allowed: the gateway forwards them and the models answered a test image, while
 * pi treats a model without `input` as text only and strips the picture before the request leaves.
 */
export function effectiveInput(gw: { input?: string[] | null } | undefined, override?: ModelOverride): ("text" | "image")[] {
  if (override?.images === true) return ["text", "image"];
  if (override?.images === false) return ["text"];
  if (Array.isArray(gw?.input)) return gw.input.includes("image") ? ["text", "image"] : ["text"];
  return ["text", "image"];
}
