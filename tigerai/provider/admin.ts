// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { ServiceError } from "../accounts/service";
import { writeAudit } from "../accounts/audit";
import { isEmbeddingModel } from "./model-kind";
import { discoverDetailed, provisionV1, v1Status, type GatewayModel } from "./v1";
import {
  PRIMARY_ID, connKey, connKeyLast4, connKeyFile, connectionsMigrated, defaultLimits, effectiveInput, effectiveLimits, effectiveBaseUrl, effectiveDefaultModel, effectiveKey, effectiveOffered, keyLast4,
  listConnections, writeConnKey, writeConnections,
  type Connection, type ModelOverride,
} from "./settings";
import { existsSync, unlinkSync } from "node:fs";
import { KEY_REQUIRED, mayUseStoredSecret, sameDest, typedSecret } from "../accounts/secret-dest";

/** Admin model settings (the routes check the role; every write is audited, the key never is). */

export function normalizeBaseUrl(v: unknown): string {
  const raw = String(v ?? "").trim().replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(raw); } catch { throw new ServiceError("bad_url", "Base URL is not a valid address"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ServiceError("bad_url", "Base URL must start with http:// or https://");
  if (u.username || u.password) throw new ServiceError("bad_url", "Do not put credentials in the URL; use the API key field");
  return raw;
}

/** What the Models page shows for one connection. The key is never in it, only whether one exists and its last 4 characters. */
export function viewConnection(c: Connection, status = v1Status()) {
  const st = status.connections?.find((x) => x.id === c.id);
  return {
    id: c.id, name: c.name, baseUrl: c.baseUrl, enabled: c.enabled,
    hasKey: !!connKey(c.id), keyLast4: connKeyLast4(c.id),
    offered: c.offered ?? null, defaultModel: c.defaultModel ?? null, overrides: c.overrides ?? {},
    // enabled connections only: a disabled one is not in models.json and has no status
    status: st ? { ok: st.ok, models: st.models.length, ...(st.error ? { error: st.error } : {}) } : null,
  };
}
export function viewConnections() { return { connections: listConnections().map((c) => viewConnection(c)), migrated: connectionsMigrated(), defaults: defaultLimits() }; }

/** The legacy single-connection view (= the first connection) plus the whole list. */
export function viewModelSettings() {
  const base = effectiveBaseUrl();
  const first = listConnections()[0];
  return {
    baseUrl: base.url, baseUrlSource: base.source,
    hasKey: !!effectiveKey(), keyLast4: keyLast4(),
    offered: effectiveOffered(), defaultModel: first?.defaultModel ?? (process.env.TIGERAI_V1_DEFAULT_MODEL || null),
    effectiveDefaultModel: effectiveDefaultModel(),
    overrides: first?.overrides ?? {}, defaults: defaultLimits(),
    ...v1Status(),
    connections: viewConnections().connections, migrated: connectionsMigrated(),
  };
}

function cleanOverrides(v: unknown, gateway: Map<string, GatewayModel> | null): Record<string, ModelOverride> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ServiceError("bad_overrides", "overrides must be an object");
  const out: Record<string, ModelOverride> = {};
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const o: ModelOverride = {};
    for (const [field, hint] of [["contextWindow", "contextWindow"], ["maxTokens", "maxTokens"]] as const) {
      const n = (raw as Record<string, unknown>)[field];
      if (n === undefined || n === null || n === "") continue;
      if (typeof n !== "number" || !Number.isInteger(n) || n < (field === "maxTokens" ? 400 : 1024) || n > 10_000_000) throw new ServiceError("bad_override", `${field} of ${id} is not a valid size`);
      const cap = gateway?.get(id)?.[hint];
      if (cap && n > cap) throw new ServiceError("override_too_high", `${field} of ${id} is above what the gateway reports (${cap})`);
      o[field] = n;
    }
    const images = (raw as Record<string, unknown>).images;
    if (images !== undefined && images !== null) {
      if (typeof images !== "boolean") throw new ServiceError("bad_override", `images of ${id} must be true or false`);
      o.images = images;
    }
    if (o.contextWindow !== undefined || o.maxTokens !== undefined || o.images !== undefined) out[id] = o;
  }
  return out;
}

function cleanName(v: unknown): string {
  const name = String(v ?? "").trim();
  if (!name || name.length > 60) throw new ServiceError("bad_name", "The connection needs a name of 1 to 60 characters");
  return name;
}

/** Applies the editable fields of `input` onto a copy of `c`. Returns what changed (names only, never values of secrets). */
async function patchConnection(c: Connection, input: Record<string, unknown>): Promise<{ next: Connection; changed: string[]; key: { set?: string; remove?: boolean } }> {
  const next: Connection = { ...c };
  const changed: string[] = [];
  const key: { set?: string; remove?: boolean } = {};
  if ("name" in input) { next.name = cleanName(input.name); changed.push("name"); }
  if ("baseUrl" in input) {
    next.baseUrl = normalizeBaseUrl(input.baseUrl);
    // The saved key is for the saved address. Moving the connection elsewhere needs the key typed again (or removed).
    if (c.baseUrl && !sameDest(c.baseUrl, next.baseUrl) && connKey(c.id) && !typedSecret(input.apiKey) && input.apiKey !== null) throw new ServiceError("key_required", KEY_REQUIRED);
    changed.push("baseUrl");
  }
  if ("enabled" in input) {
    if (typeof input.enabled !== "boolean") throw new ServiceError("bad_enabled", "enabled must be true or false");
    next.enabled = input.enabled; changed.push("enabled");
  }
  if ("offered" in input) {
    if (input.offered !== null && (!Array.isArray(input.offered) || input.offered.some((x) => typeof x !== "string"))) throw new ServiceError("bad_offered", "offered must be a list of model ids or null");
    next.offered = input.offered === null ? null : [...new Set(input.offered as string[])];
    changed.push("offered");
  }
  if ("defaultModel" in input) {
    if (input.defaultModel !== null && typeof input.defaultModel !== "string") throw new ServiceError("bad_default", "defaultModel must be a model id or null");
    next.defaultModel = (input.defaultModel as string | null) || null;
    changed.push("defaultModel");
  }
  if ("overrides" in input) {
    // The gateway's own sizes are the ceiling; if it cannot be reached, only the sanity limits apply.
    let gw: Map<string, GatewayModel> | null = null;
    const base = next.baseUrl;
    const k = "apiKey" in input && typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : connKey(c.id);
    if (base) { try { gw = new Map((await discoverDetailed(base, k)).map((m) => [m.id, m])); } catch { gw = null; } }
    next.overrides = cleanOverrides(input.overrides, gw);
    changed.push("overrides");
  }
  if (next.defaultModel && next.offered && !next.offered.includes(next.defaultModel)) throw new ServiceError("bad_default", "The default model must be one of the offered models");
  if ("apiKey" in input) {
    if (input.apiKey === null) key.remove = true;
    else if (typeof input.apiKey === "string" && input.apiKey.trim()) key.set = input.apiKey;
    else throw new ServiceError("bad_key", "apiKey must be a non-empty string, or null to remove it");
    changed.push("apiKey");
  }
  return { next, changed, key };
}

function nextConnectionId(list: Connection[]): string {
  if (!list.some((c) => c.id === PRIMARY_ID)) return PRIMARY_ID;
  let n = 2;
  for (const c of list) { const m = /^tigerai-(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return `tigerai-${n}`;
}

async function applyAndProvision(): Promise<void> { await provisionV1().catch(() => undefined); } // a gateway error shows in the status

export async function addConnection(actorId: string, input: Record<string, unknown>) {
  const list = listConnections();
  if (list.length >= 8) throw new ServiceError("too_many", "At most 8 connections", 409);
  const id = nextConnectionId(list);
  const base: Connection = { id, name: cleanName(input.name), baseUrl: normalizeBaseUrl(input.baseUrl), enabled: input.enabled !== false };
  const { next, key } = await patchConnection(base, { ...input, name: base.name, baseUrl: base.baseUrl });
  if (key.set) writeConnKey(id, key.set);
  writeConnections([...list, next]);
  writeAudit("model.connection.add", actorId, { connection: id, name: next.name });
  await applyAndProvision();
  return viewModelSettings();
}

export async function updateConnection(actorId: string, id: string, input: Record<string, unknown>) {
  const list = listConnections();
  const at = list.findIndex((c) => c.id === id);
  if (at < 0) throw new ServiceError("not_found", "No such connection", 404);
  const { next, changed, key } = await patchConnection(list[at], input);
  if (key.set) writeConnKey(id, key.set); else if (key.remove) writeConnKey(id, null);
  const out = [...list]; out[at] = next;
  writeConnections(out);
  writeAudit("model.connection.update", actorId, { connection: id, name: next.name, changed: changed.join(",") });
  await applyAndProvision();
  return viewModelSettings();
}

export async function deleteConnection(actorId: string, id: string) {
  const list = listConnections();
  const c = list.find((x) => x.id === id);
  if (!c) throw new ServiceError("not_found", "No such connection", 404);
  writeConnections(list.filter((x) => x.id !== id));
  if (id !== PRIMARY_ID) { try { if (existsSync(connKeyFile(id))) unlinkSync(connKeyFile(id)); } catch { /* best effort */ } }
  writeAudit("model.connection.delete", actorId, { connection: id, name: c.name });
  await applyAndProvision();
  return viewModelSettings();
}

export async function reorderConnections(actorId: string, ids: unknown) {
  const list = listConnections();
  if (!Array.isArray(ids) || ids.length !== list.length || new Set(ids).size !== ids.length || ids.some((x) => !list.some((c) => c.id === x))) throw new ServiceError("bad_order", "The order must list every connection once");
  const byId = new Map(list.map((c) => [c.id, c]));
  writeConnections((ids as string[]).map((x) => byId.get(x)!));
  writeAudit("model.connection.reorder", actorId, { order: (ids as string[]).join(">") });
  await applyAndProvision();
  return viewModelSettings();
}

/** Legacy single-connection save (the old page and existing callers): edits connection #1, creating it when none exists. */
export async function saveModelSettings(actorId: string, input: Record<string, unknown>) {
  const list = listConnections();
  if (!list.length) {
    if (!("baseUrl" in input)) throw new ServiceError("not_configured", "No base URL is configured", 409);
    const { next, key } = await patchConnection({ id: PRIMARY_ID, name: "主要連線", baseUrl: normalizeBaseUrl(input.baseUrl), enabled: true }, input);
    if (key.set) writeConnKey(PRIMARY_ID, key.set);
    writeConnections([next]);
    writeAudit("models.update", actorId, { changed: Object.keys(input).join(",") });
    await applyAndProvision();
    return viewModelSettings();
  }
  const first = list[0];
  const { next, changed, key } = await patchConnection(first, input);
  if (key.set) writeConnKey(first.id, key.set); else if (key.remove) writeConnKey(first.id, null);
  writeConnections([next, ...list.slice(1)]);
  writeAudit("models.update", actorId, { changed: changed.join(",") });
  await applyAndProvision();
  return viewModelSettings();
}

/** Test with the given (or saved) address and key. Always resolves; failure is in the result. */
export async function testConnection(input: { id?: unknown; baseUrl?: unknown; apiKey?: unknown }) {
  const started = Date.now();
  try {
    const conn = typeof input.id === "string" ? listConnections().find((c) => c.id === input.id) : listConnections()[0];
    const base = input.baseUrl ? normalizeBaseUrl(input.baseUrl) : conn?.baseUrl ?? null;
    if (!base) return { ok: false, ms: 0, code: "not_configured", error: "No base URL is configured" };
    const typed = typedSecret(input.apiKey);
    const stored = conn ? connKey(conn.id) : null;
    // A stored key is only sent to the stored address (H1): a different address needs the key typed again.
    if (!mayUseStoredSecret({ hasStored: !!stored, storedDest: conn?.baseUrl, targetDest: base, typedNew: typed })) return { ok: false, ms: 0, code: "key_required", error: KEY_REQUIRED };
    const key = typed ? String(input.apiKey).trim() : stored;
    const models = await discoverDetailed(base, key);
    return { ok: true, models: models.length, ms: Date.now() - started };
  } catch (e) {
    // The message names a status or a network error, never the key.
    return { ok: false, ms: Date.now() - started, code: "gateway", error: e instanceof Error ? e.message.slice(0, 200) : "failed" };
  }
}

export async function gatewayModels(id?: string) {
  const conn = id ? listConnections().find((c) => c.id === id) : listConnections()[0];
  if (id && !conn) throw new ServiceError("not_found", "No such connection", 404);
  if (!conn?.baseUrl) throw new ServiceError("not_configured", "No base URL is configured", 409);
  try {
    const list = await discoverDetailed(conn.baseUrl, connKey(conn.id));
    const offered = conn.offered ?? null;
    // maxTokens / contextWindow stay what the gateway reported (null when it says nothing); the *Default fields are what the
    // portal applies then, so the page can show the real value instead of an empty box.
    return list.map((m) => {
      const embedding = isEmbeddingModel(m.id);
      return { ...m, embedding, offered: !embedding && (!offered || offered.includes(m.id)), contextDefault: effectiveLimits(m).contextWindow, maxTokensDefault: effectiveLimits(m).maxTokens, imagesDefault: effectiveInput(m).includes("image") };
    });
  } catch (e) {
    throw new ServiceError("gateway", `Gateway unreachable: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`, 502);
  }
}
