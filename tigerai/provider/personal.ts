// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { dataDir } from "../config";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import { isEmbeddingModel } from "./model-kind";
import { readSettings, writeSettings } from "./settings";

/**
 * Personal model connections (community edition, feature A): every person may add their own OpenAI-compatible endpoint + key.
 *
 * Where things live (all under the data directory, never in the global models.json that everyone's picker reads):
 *   personal-models/<userId>/connections.json   name, address, model ids, order, on/off (NO key)
 *   personal-models/<userId>/key-<id>           the key alone, mode 600 (directory mode 700)
 * A connection's id doubles as the pi provider id of its owner's conversations: `tgp-<owner>-<random>`, where <owner> is a hash of the
 * user id. The prefix alone says "personal"; ownership is decided by looking the id up in the caller's OWN list, never by the prefix.
 * Two admin switches (kept in models-settings.json): `allow` (default on) and `publicWithoutKey` (default on).
 *
 * The key is never returned (last 4 characters only), never put into an audit row, a log line, an error text or a conversation entry.
 */

export const PERSONAL_PREFIX = "tgp-";
/** The process-environment variable that carries one connection's key to pi (a reference, never the literal). */
export const personalKeyEnvName = (id: string): string => `TIGERAI_PKEY_${id.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
export const MAX_PERSONAL = 5;
export const MAX_PERSONAL_MODELS = 20;

export interface PersonalConn { id: string; name: string; baseUrl: string; models: string[]; enabled: boolean; /** most tokens one answer may use (default 16384, at most 65536) */ maxTokens?: number; /** the model's context size (default 128000) */ contextWindow?: number; /** the models think before answering: the answer budget has to leave room for it */ reasoning?: boolean }
export const DEFAULT_MAX_TOKENS = 16384;
/** A thinking model spends the same budget thinking: its default answer budget is larger (still capped by MAX_MAX_TOKENS and half the context). */
export const DEFAULT_MAX_TOKENS_THINKING = 40000;
export const defaultMaxTokens = (reasoning: boolean | undefined): number => (reasoning === true ? DEFAULT_MAX_TOKENS_THINKING : DEFAULT_MAX_TOKENS);
export const MAX_MAX_TOKENS = 65536;
export const DEFAULT_CONTEXT_WINDOW = 128_000;
/** An integer within [min, max]; empty / absent gives the default; anything else is refused (never silently clamped). */
export function cleanSize(v: unknown, field: string, def: number, min: number, max: number): number {
  if (v === undefined || v === null || v === "") return def;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new ServiceError("bad_limits", `${field} must be a whole number from ${min} to ${max}`);
  return n;
}
/** What a connection really sends to pi: the output budget never exceeds half the context; a thinking model gets the budget on top of its own thinking. */
export function connLimits(c: Pick<PersonalConn, "maxTokens" | "contextWindow" | "reasoning">): { contextWindow: number; maxTokens: number; reasoning: boolean } {
  const contextWindow = c.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const maxTokens = Math.min(c.maxTokens ?? defaultMaxTokens(c.reasoning), Math.max(1024, Math.floor(contextWindow / 2)));
  return { contextWindow, maxTokens, reasoning: c.reasoning === true };
}
interface Doc { connections: PersonalConn[] }

export interface PersonalSwitches { /** members (and admins) may add their own connections */ allow: boolean; /** a person with no usable personal connection may use the public models */ publicWithoutKey: boolean; /** 互相備援 (default ON): in a person's own conversations a failed personal connection falls back to the public models and a failed public one (after the public chain) to their personal connection. OFF: each side stands alone and a failed personal connection only produces a notice */ mutualFallback: boolean }

const root = () => join(dataDir(), "personal-models");
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
function userDir(userId: string): string {
  if (!SAFE_ID.test(userId)) throw new ServiceError("bad_user", "Invalid user");
  return join(root(), userId);
}
const ownerKey = (userId: string) => createHash("sha256").update(`tgp:${userId}`).digest("hex").slice(0, 8);
export const isPersonalProvider = (id: unknown): id is string => typeof id === "string" && id.startsWith(PERSONAL_PREFIX);
/** Provider ids written like ours inside any text (used to scan a request body). */
export const PERSONAL_ID_PATTERN = /tgp-[0-9a-f]{8}-[0-9a-f]{6,}/g;
const keyFile = (userId: string, id: string) => join(userDir(userId), `key-${id.replace(/[^A-Za-z0-9-]/g, "_")}`);

function atomicWrite(file: string, text: string): void {
  const dir = join(file, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* best effort */ }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

// ---------------------------------------------------------------- admin switches

export function personalSwitches(): PersonalSwitches {
  const p = readSettings().personal ?? {};
  return { allow: p.allow !== false, publicWithoutKey: p.publicWithoutKey !== false, mutualFallback: p.mutualFallback !== false };
}
export function setPersonalSwitches(actorId: string, input: Record<string, unknown>): PersonalSwitches {
  const cur = personalSwitches();
  const next = { ...cur };
  for (const k of ["allow", "publicWithoutKey", "mutualFallback"] as const) {
    if (k in input) { if (typeof input[k] !== "boolean") throw new ServiceError("bad_enabled", `${k} must be true or false`); next[k] = input[k] as boolean; }
  }
  writeSettings({ ...readSettings(), personal: next });
  writeAudit("model.personal.switches", actorId, { allow: next.allow, publicWithoutKey: next.publicWithoutKey, mutualFallback: next.mutualFallback });
  return next;
}

// ---------------------------------------------------------------- storage

function readDoc(userId: string): Doc {
  try {
    const d = JSON.parse(readFileSync(join(userDir(userId), "connections.json"), "utf8")) as Doc;
    return { connections: Array.isArray(d.connections) ? d.connections.filter((c) => c && typeof c.id === "string" && typeof c.baseUrl === "string") : [] };
  } catch { return { connections: [] }; }
}
function writeDoc(userId: string, doc: Doc): void { atomicWrite(join(userDir(userId), "connections.json"), JSON.stringify(doc, null, 2) + "\n"); }

export function listPersonal(userId: string): PersonalConn[] { return readDoc(userId).connections.map((c) => ({ ...c, enabled: c.enabled !== false, models: Array.isArray(c.models) ? c.models : [] })); }
export function personalKey(userId: string, id: string): string | null {
  try { const k = readFileSync(keyFile(userId, id), "utf8").trim(); return k || null; } catch { return null; }
}

/** The caller's usable connections, in their order: the switch is on, the connection is enabled and has at least one model. */
export function usablePersonal(userId: string): PersonalConn[] {
  if (!personalSwitches().allow) return [];
  return listPersonal(userId).filter((c) => c.enabled && c.models.length > 0);
}
/** Does this person own this provider id (and may they use it right now)? Nobody else ever may, whatever their role. */
export function userOwnsProvider(userId: string, provider: string): boolean {
  if (!isPersonalProvider(provider) || !provider.startsWith(`${PERSONAL_PREFIX}${ownerKey(userId)}-`)) return false;
  return usablePersonal(userId).some((c) => c.id === provider);
}

/** A member who has no usable personal connection while the administrator requires one: the public models are closed to them. */
export function personalRequired(user: { id: string; role: string }): boolean {
  if (user.role === "admin") return false;
  const sw = personalSwitches();
  return sw.allow && !sw.publicWithoutKey;
}
/** True when this person must not be served by a public model (they are on "own key only"). */
export function publicClosedFor(user: { id: string; role: string }): boolean { return personalRequired(user); }

// ---------------------------------------------------------------- the person's chosen model

/**
 * What the person picked last, kept so a conversation started from an AI role or an n8n app (a fresh composer that has forgotten the
 * pick) does not fall back to the public default. Only a personal model is remembered (a public pick clears it): the public default
 * stays the administrator's. A role that names its own model still wins; channels never read this.
 */
const pickFile = (userId: string) => join(userDir(userId), "last-pick.json");
export function rememberPick(userId: string, provider: unknown, modelId: unknown): void {
  try {
    if (typeof provider !== "string" || typeof modelId !== "string" || !modelId) return;
    if (userOwnsProvider(userId, provider) && usablePersonal(userId).some((c) => c.id === provider && c.models.includes(modelId))) atomicWrite(pickFile(userId), JSON.stringify({ provider, modelId }) + "\n");
    else unlinkSync(pickFile(userId));
  } catch { /* none to clear, or storage trouble: the pick is a convenience */ }
}
/** A request that names a model: a new conversation (`isNew`) or a `set_model` on an existing one. Anything else (a prompt on a running conversation) is not a pick. */
export function rememberPickFromRequest(userId: string, body: { type?: unknown; provider?: unknown; modelId?: unknown }, isNew: boolean): void {
  if (body.provider !== undefined && body.modelId !== undefined && (isNew || body.type === "set_model")) rememberPick(userId, body.provider, body.modelId);
}
/** 「新對話」 on the plain menu: back to the default model for what comes next. */
export function clearPick(userId: string): void { try { unlinkSync(pickFile(userId)); } catch { /* none */ } }
/** The remembered personal model, only while that connection is still usable and still lists the model. */
export function lastPick(userId: string): { provider: string; modelId: string } | null {
  try {
    const d = JSON.parse(readFileSync(pickFile(userId), "utf8")) as { provider?: unknown; modelId?: unknown };
    if (typeof d.provider !== "string" || typeof d.modelId !== "string") return null;
    return usablePersonal(userId).some((c) => c.id === d.provider && c.models.includes(d.modelId as string)) ? { provider: d.provider, modelId: d.modelId } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- validation

export function cleanName(v: unknown): string {
  const name = String(v ?? "").trim();
  if (!name || name.length > 40) throw new ServiceError("bad_name", "The connection needs a name of 1 to 40 characters");
  return name;
}
export function cleanBaseUrl(v: unknown): string {
  const raw = String(v ?? "").trim().replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(raw); } catch { throw new ServiceError("bad_url", "Base URL is not a valid address"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ServiceError("bad_url", "Base URL must start with http:// or https://");
  if (u.username || u.password) throw new ServiceError("bad_url", "Do not put credentials in the URL; use the API key field");
  if (u.search || u.hash) throw new ServiceError("bad_url", "The address must not carry a query or fragment");
  return raw;
}
/** One line, printable ASCII, no spaces. A leading `!` or `$` is refused as well: pi would read those as a shell command or an environment name. */
export function cleanKey(v: unknown): string {
  const k = String(v ?? "").trim();
  if (!k || k.length > 512 || !/^[\x21-\x7e]+$/.test(k) || k.startsWith("!") || k.startsWith("$")) throw new ServiceError("bad_key", "The API key is not valid (one line, no spaces, up to 512 characters)");
  return k;
}
export function cleanModels(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : [];
  const out: string[] = [];
  for (const raw of list) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (id.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._:/@+ -]*$/.test(id)) throw new ServiceError("bad_models", `Model name "${id.slice(0, 40)}" is not valid`);
    if (isEmbeddingModel(id)) throw new ServiceError("bad_models", "Embedding models cannot chat");
    if (!out.includes(id)) out.push(id);
  }
  if (!out.length) throw new ServiceError("bad_models", "Give at least one model name");
  if (out.length > MAX_PERSONAL_MODELS) throw new ServiceError("bad_models", `At most ${MAX_PERSONAL_MODELS} models per connection`);
  return out;
}

// ---------------------------------------------------------------- where a request may go

/** 169.254/16 (cloud metadata), loopback, unspecified, and (unless TIGERAI_PERSONAL_ALLOW_PRIVATE=1) private ranges. */
export function addressBlocked(ip: string): boolean {
  const allowPrivate = process.env.TIGERAI_PERSONAL_ALLOW_PRIVATE === "1";
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (allowPrivate) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(v) === 6) {
    if (v === "::" || v.startsWith("fe80:")) return true; // unspecified, link-local
    if (allowPrivate) return false;
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd");
  }
  return true;
}
const HOST_CACHE = new Map<string, { at: number; ok: boolean }>();
/** Resolves the host of a personal address and refuses internal targets. Cached for a minute. A DNS answer can still change later (open gap). */
export async function hostAllowed(baseUrl: string): Promise<boolean> {
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  const hit = HOST_CACHE.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  let ok = false;
  try {
    if (isIP(host)) ok = !addressBlocked(host);
    else if (host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".localhost")) ok = !addressBlocked("127.0.0.1");
    else { const all = await lookup(host, { all: true }); ok = all.length > 0 && all.every((a) => !addressBlocked(a.address)); }
  } catch { ok = false; }
  HOST_CACHE.set(host, { at: Date.now(), ok });
  return ok;
}
export function resetHostCache(): void { HOST_CACHE.clear(); }

// ---------------------------------------------------------------- views and writes

export function viewPersonal(userId: string) {
  return {
    switches: personalSwitches(),
    max: MAX_PERSONAL,
    connections: listPersonal(userId).map((c) => {
      const k = personalKey(userId, c.id);
      return { id: c.id, name: c.name, baseUrl: c.baseUrl, models: c.models, enabled: c.enabled, ...connLimits(c), hasKey: !!k, keyLast4: k ? k.slice(-4) : null };
    }),
  };
}

function requireAllowed(): void { if (!personalSwitches().allow) throw new ServiceError("personal_off", "The administrator has turned personal model connections off", 403); }
const newId = (userId: string) => `${PERSONAL_PREFIX}${ownerKey(userId)}-${randomBytes(4).toString("hex")}`;

export async function addPersonal(userId: string, input: Record<string, unknown>) {
  requireAllowed();
  const doc = readDoc(userId);
  if (doc.connections.length >= MAX_PERSONAL) throw new ServiceError("personal_too_many", `At most ${MAX_PERSONAL} personal connections`, 409);
  const conn: PersonalConn = { id: newId(userId), name: cleanName(input.name), baseUrl: cleanBaseUrl(input.baseUrl), models: cleanModels(input.models), enabled: input.enabled !== false,
    maxTokens: cleanSize(input.maxTokens, "maxTokens", defaultMaxTokens(input.reasoning === true), 1024, MAX_MAX_TOKENS), contextWindow: cleanSize(input.contextWindow, "contextWindow", DEFAULT_CONTEXT_WINDOW, 4096, 2_000_000), reasoning: input.reasoning === true };
  const key = "apiKey" in input && input.apiKey !== null && input.apiKey !== "" ? cleanKey(input.apiKey) : null;
  if (!(await hostAllowed(conn.baseUrl))) throw new ServiceError("bad_host", "That address is not allowed (internal or unresolvable)");
  if (key) atomicWrite(keyFile(userId, conn.id), key + "\n");
  writeDoc(userId, { connections: [...doc.connections, conn] });
  writeAudit("model.personal.add", userId, { connection: conn.id, name: conn.name });
  return viewPersonal(userId);
}

export async function updatePersonal(userId: string, id: string, input: Record<string, unknown>) {
  requireAllowed();
  const doc = readDoc(userId);
  const at = doc.connections.findIndex((c) => c.id === id);
  if (at < 0) throw new ServiceError("not_found", "No such connection", 404);
  const next: PersonalConn = { ...doc.connections[at], enabled: doc.connections[at].enabled !== false };
  const changed: string[] = [];
  if ("name" in input) { next.name = cleanName(input.name); changed.push("name"); }
  if ("baseUrl" in input) { next.baseUrl = cleanBaseUrl(input.baseUrl); changed.push("baseUrl"); if (!(await hostAllowed(next.baseUrl))) throw new ServiceError("bad_host", "That address is not allowed (internal or unresolvable)"); }
  if ("models" in input) { next.models = cleanModels(input.models); changed.push("models"); }
  if ("maxTokens" in input) { next.maxTokens = cleanSize(input.maxTokens, "maxTokens", defaultMaxTokens(input.reasoning === true || (!("reasoning" in input) && next.reasoning === true)), 1024, MAX_MAX_TOKENS); changed.push("maxTokens"); }
  if ("contextWindow" in input) { next.contextWindow = cleanSize(input.contextWindow, "contextWindow", DEFAULT_CONTEXT_WINDOW, 4096, 2_000_000); changed.push("contextWindow"); }
  if ("reasoning" in input) { if (typeof input.reasoning !== "boolean") throw new ServiceError("bad_enabled", "reasoning must be true or false"); next.reasoning = input.reasoning; changed.push("reasoning");
    // Marking a connection as thinking while the budget is still the plain default: give it room to think (an explicit size is never touched).
    if (input.reasoning === true && !("maxTokens" in input) && (next.maxTokens === undefined || next.maxTokens === DEFAULT_MAX_TOKENS)) { next.maxTokens = DEFAULT_MAX_TOKENS_THINKING; changed.push("maxTokens"); } }
  if ("enabled" in input) { if (typeof input.enabled !== "boolean") throw new ServiceError("bad_enabled", "enabled must be true or false"); next.enabled = input.enabled; changed.push("enabled"); }
  if ("apiKey" in input) {
    if (input.apiKey === null) { try { unlinkSync(keyFile(userId, id)); } catch { /* none */ } }
    else atomicWrite(keyFile(userId, id), cleanKey(input.apiKey) + "\n");
    changed.push("apiKey");
  }
  const list = [...doc.connections]; list[at] = next;
  writeDoc(userId, { connections: list });
  writeAudit("model.personal.update", userId, { connection: id, name: next.name, changed: changed.join(",") });
  return viewPersonal(userId);
}

export function deletePersonal(userId: string, id: string) {
  const doc = readDoc(userId);
  const c = doc.connections.find((x) => x.id === id);
  if (!c) throw new ServiceError("not_found", "No such connection", 404);
  writeDoc(userId, { connections: doc.connections.filter((x) => x.id !== id) });
  try { unlinkSync(keyFile(userId, id)); } catch { /* none */ }
  writeAudit("model.personal.delete", userId, { connection: id, name: c.name });
  return viewPersonal(userId);
}

export function reorderPersonal(userId: string, ids: unknown) {
  const doc = readDoc(userId);
  if (!Array.isArray(ids) || ids.length !== doc.connections.length || new Set(ids).size !== ids.length || ids.some((x) => !doc.connections.some((c) => c.id === x))) throw new ServiceError("bad_order", "The order must list every connection once");
  const by = new Map(doc.connections.map((c) => [c.id, c]));
  writeDoc(userId, { connections: (ids as string[]).map((x) => by.get(x)!) });
  writeAudit("model.personal.update", userId, { connection: "order", changed: "order" });
  return viewPersonal(userId);
}

/** Admin's view: how many connections each person has. Never an address, a name or a key. */
export function personalSummary(): { userId: string; count: number }[] {
  const out: { userId: string; count: number }[] = [];
  try {
    for (const e of readdirSync(root(), { withFileTypes: true })) {
      if (!e.isDirectory() || !SAFE_ID.test(e.name)) continue;
      const n = listPersonal(e.name).length;
      if (n > 0) out.push({ userId: e.name, count: n });
    }
  } catch { /* none yet */ }
  return out;
}

/** Test with the given (or saved) address and key. Always resolves; the text names a status or a network error, never the key. */
export async function testPersonal(userId: string, input: { id?: unknown; baseUrl?: unknown; apiKey?: unknown }) {
  const started = Date.now();
  try {
    requireAllowed();
    const saved = typeof input.id === "string" ? listPersonal(userId).find((c) => c.id === input.id) : undefined;
    if (typeof input.id === "string" && !saved) return { ok: false, ms: 0, code: "not_found", error: "No such connection" };
    const base = input.baseUrl ? cleanBaseUrl(input.baseUrl) : saved?.baseUrl;
    if (!base) return { ok: false, ms: 0, code: "bad_url", error: "No base URL" };
    if (!(await hostAllowed(base))) return { ok: false, ms: 0, code: "bad_host", error: "That address is not allowed (internal or unresolvable)" };
    const key = typeof input.apiKey === "string" && input.apiKey.trim() ? cleanKey(input.apiKey) : saved ? personalKey(userId, saved.id) : null;
    const res = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(10_000), redirect: "manual" });
    if (!res.ok) return { ok: false, ms: Date.now() - started, code: "gateway", error: `GET /models answered ${res.status}` };
    const json = await res.json().catch(() => ({})) as { data?: { id?: unknown }[] };
    const ids = (json.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string").slice(0, 100);
    return { ok: true, ms: Date.now() - started, models: ids.length, ids };
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, ms: 0, code: e.code, error: e.message };
    return { ok: false, ms: Date.now() - started, code: "gateway", error: e instanceof Error ? e.message.slice(0, 120).replace(/(Bearer\s+)\S+/gi, "$1…") : "failed" };
  }
}

