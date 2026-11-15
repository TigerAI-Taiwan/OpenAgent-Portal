// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";

/**
 * n8n webhooks, community scope (the simple n8n demo): no n8n API and no n8n key held for API calls.
 *  Webhooks: Portal -> n8n (registered URLs the AI calls with the n8n_webhook tool) and
 *  n8n -> Portal (an inbound endpoint with one key per caller, stored hashed).
 *  The MCP integration (系統連接) is NOT here: it belongs to the consultant pack (tigerai/docs/ADDON.md).
 * "Which groups" here means: empty = nobody except administrators (an n8n instance is full-power,
 * so the safe default is closed, unlike prompts).
 */

export const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const list = (v: unknown): string[] => { try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; } };
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function secretsDir(): string {
  const dir = join(dataDir(), "secrets");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export function writeSecret(file: string, value: string): void {
  const p = join(secretsDir(), file);
  writeFileSync(p, value, { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* best effort */ }
}
export function readSecret(file: string): string | null {
  try { return readFileSync(join(secretsDir(), file), "utf8").trim() || null; } catch { return null; }
}

export function checkUrl(raw: unknown, what: string): string {
  let u: URL;
  try { u = new URL(String(raw)); } catch { throw new ServiceError("bad_url", `${what} is not a valid URL`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ServiceError("bad_url", `${what} must be http or https`);
  if (u.username || u.password) throw new ServiceError("bad_url", `${what} may not contain a user name or password`);
  return u.toString();
}
/** What an admin list shows: enough to recognise it, not the secret path of a webhook URL. */
export function maskUrl(raw: string): string {
  try { const u = new URL(raw); return `${u.origin}${u.pathname.length > 1 ? "/…" : ""}`; } catch { return "…"; }
}

export type Person = { id: string; role: "admin" | "member" };
export function groupsOf(userId: string): string[] {
  return (getDb().prepare("SELECT group_id FROM memberships WHERE user_id=?").all(userId) as unknown as { group_id: string }[]).map((r) => r.group_id);
}
export function allowed(person: Person, groupIds: string[]): boolean {
  if (person.role === "admin") return true;
  const mine = new Set(groupsOf(person.id));
  return groupIds.some((g) => mine.has(g));
}

// ---- outbound webhooks ---------------------------------------------------------
export interface Webhook { id: string; name: string; display_name: string; url: string; description: string; group_ids: string[]; enabled: boolean; hasHeader?: boolean }
interface HookRaw { id: string; name: string; display_name?: string; url: string; description: string; group_ids: string; enabled: number }
const hook = (r: HookRaw): Webhook => ({ id: r.id, name: r.name, display_name: r.display_name ?? "", url: r.url, description: r.description, group_ids: list(r.group_ids), enabled: r.enabled === 1 });

export function listWebhooks(): Webhook[] {
  return (getDb().prepare("SELECT * FROM n8n_webhooks ORDER BY name").all() as unknown as HookRaw[]).map(hook).map((w) => ({ ...w, url: maskUrl(w.url), hasHeader: readSecret(`n8n-hook-${w.id}.header`) !== null }));
}
export function saveWebhook(actorId: string, input: Record<string, unknown>, id?: string): { id: string } {
  const db = getDb();
  const cur = id ? (db.prepare("SELECT * FROM n8n_webhooks WHERE id=?").get(id) as unknown as HookRaw | undefined) : undefined;
  if (id && !cur) throw new ServiceError("not_found", "No such webhook", 404);
  const name = String(input.name ?? cur?.name ?? "").trim().toLowerCase();
  if (!NAME.test(name)) throw new ServiceError("bad_name", "Name: lowercase letters, digits, - and _");
  const url = input.url ? checkUrl(input.url, "The webhook URL") : cur?.url;
  if (!url) throw new ServiceError("bad_url", "The webhook URL is required");
  const groups = input.group_ids !== undefined ? strs(input.group_ids) : list(cur?.group_ids ?? "[]");
  const enabled = input.enabled === undefined ? (cur ? cur.enabled === 1 : true) : input.enabled !== false;
  const description = String(input.description ?? cur?.description ?? "").slice(0, 300);
  const displayName = String(input.display_name ?? cur?.display_name ?? "").trim().slice(0, 40);
  const dup = db.prepare("SELECT id FROM n8n_webhooks WHERE name=? AND id<>?").get(name, id ?? "");
  if (dup) throw new ServiceError("exists", "A webhook with this name exists", 409);
  const rowId = id ?? `h${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  if (cur) db.prepare("UPDATE n8n_webhooks SET name=?,display_name=?,url=?,description=?,group_ids=?,enabled=? WHERE id=?").run(name, displayName, url, description, JSON.stringify(groups), enabled ? 1 : 0, rowId);
  else db.prepare("INSERT INTO n8n_webhooks (id,name,display_name,url,description,group_ids,enabled,created_at) VALUES (?,?,?,?,?,?,?,?)").run(rowId, name, displayName, url, description, JSON.stringify(groups), enabled ? 1 : 0, Date.now());
  // An optional secret header such as "X-Portal-Test-Key: value", kept in a private file and never returned.
  if (typeof input.header === "string" && input.header.trim()) {
    if (!/^[A-Za-z0-9-]{1,64}:\s*\S.*$/.test(input.header.trim())) throw new ServiceError("bad_header", 'The header must look like "Name: value"');
    writeSecret(`n8n-hook-${rowId}.header`, input.header.trim());
  }
  writeAudit(cur ? "n8n.webhook_update" : "n8n.webhook_create", actorId, { webhookId: rowId, name, groups: groups.length, headerChanged: typeof input.header === "string" && !!input.header.trim() });
  return { id: rowId };
}
export function deleteWebhook(actorId: string, id: string): void {
  if (getDb().prepare("DELETE FROM n8n_webhooks WHERE id=?").run(id).changes === 0) throw new ServiceError("not_found", "No such webhook", 404);
  writeAudit("n8n.webhook_delete", actorId, { webhookId: id });
}
/** The secret header of a webhook as [name, value], read at call time only. */
export function webhookHeader(id: string): [string, string] | null {
  const raw = readSecret(`n8n-hook-${id}.header`);
  const m = raw ? /^([A-Za-z0-9-]+):\s*(.+)$/.exec(raw) : null;
  return m ? [m[1], m[2]] : null;
}
export function webhooksFor(person: Person): Webhook[] {
  return (getDb().prepare("SELECT * FROM n8n_webhooks WHERE enabled=1").all() as unknown as HookRaw[]).map(hook).filter((w) => allowed(person, w.group_ids));
}

// ---- inbound keys ----------------------------------------------------------------
export interface HookKey { id: string; name: string; prefix: string; agent_id: string | null; room_id: string | null; created_at: number; revoked_at: number | null; last_used: number | null }
const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

export function listHookKeys(): HookKey[] {
  return getDb().prepare("SELECT id,name,prefix,agent_id,room_id,created_at,revoked_at,last_used FROM hook_keys ORDER BY created_at DESC").all() as unknown as HookKey[];
}
/** The plaintext is returned once, here, and only its hash is kept. */
export function createHookKey(actorId: string, input: Record<string, unknown>): { key: HookKey; plaintext: string } {
  const name = String(input.name ?? "").trim().toLowerCase();
  if (!NAME.test(name)) throw new ServiceError("bad_name", "Name: lowercase letters, digits, - and _");
  const db = getDb();
  const agentId = typeof input.agent_id === "string" && input.agent_id ? input.agent_id : null;
  if (agentId && !db.prepare("SELECT 1 FROM agents WHERE id=? AND enabled=1").get(agentId)) throw new ServiceError("bad_agent", "No such AI role");
  const roomId = typeof input.room_id === "string" && input.room_id ? input.room_id : null;
  if (roomId && !db.prepare("SELECT 1 FROM rooms WHERE id=?").get(roomId)) throw new ServiceError("bad_room", "No such room");
  if (db.prepare("SELECT 1 FROM hook_keys WHERE name=?").get(name)) throw new ServiceError("exists", "A key with this name exists", 409);
  const plaintext = `tgk_${randomBytes(24).toString("base64url")}`;
  const id = `k${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  db.prepare("INSERT INTO hook_keys (id,name,key_hash,prefix,agent_id,room_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, name, hashKey(plaintext), plaintext.slice(0, 8), agentId, roomId, actorId, Date.now());
  writeAudit("n8n.hookkey_create", actorId, { keyId: id, name, agentId, roomId });
  return { key: listHookKeys().find((k) => k.id === id)!, plaintext };
}
export function revokeHookKey(actorId: string, id: string): void {
  if (getDb().prepare("UPDATE hook_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(Date.now(), id).changes === 0) throw new ServiceError("not_found", "No such active key", 404);
  writeAudit("n8n.hookkey_revoke", actorId, { keyId: id });
}
export function findHookKey(presented: string): (HookKey & { created_by: string }) | null {
  if (!presented || presented.length > 200) return null;
  const row = getDb().prepare("SELECT id,name,prefix,agent_id,room_id,created_at,revoked_at,last_used,created_by FROM hook_keys WHERE key_hash=? AND revoked_at IS NULL").get(hashKey(presented)) as unknown as (HookKey & { created_by: string }) | undefined;
  return row ?? null;
}
export function touchHookKey(id: string): void { getDb().prepare("UPDATE hook_keys SET last_used=? WHERE id=?").run(Date.now(), id); }

/** What the 功能 menu lists for this person: names and one-line descriptions only, never a URL or a token. */
export function appsFor(person: Person): { id: string; kind: "webhook"; name: string; label: string; description: string }[] {
  return webhooksFor(person).map((w) => ({ id: w.id, kind: "webhook" as const, name: w.name, label: w.display_name || w.name, description: w.description || "呼叫一個 n8n 流程" }));
}
