// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import { NAME, allowed, checkUrl, list, maskUrl, readSecret, strs, writeSecret, type Person } from "../n8n/service";
import { ensureMcpTables } from "./db";
import { CE_MCP_NOTICE } from "./templates";
import { connectorTemplates, isTemplateId, serverKey, templateOf } from "./runtime-templates";
import { KEY_REQUIRED, mayUseStoredSecret, sameDest } from "../accounts/secret-dest";
import { testMcp, type McpTestResult, type McpTool } from "./mcp-client";

/**
 * 系統連接 (MCP servers). Community edition: n8n only. One row per linked system; `template` decides the default tool list.
 * The allow list is a fence for tools (empty = no tool; "*" must be written out), and n8n's write tools sit behind an approved
 * work order on top of it (grants.ts). The key lives in a mode-600 file; only its last 4 characters ever leave the server.
 */
export interface McpServer { id: string; name: string; template: string; description: string; url: string; group_ids: string[]; enabled: boolean; allow_tools: string[] }
interface McpRaw { id: string; name: string; url: string; group_ids: string; enabled: number; allow_tools: string; template?: string; description?: string; last_tools?: string; tested_at?: number | null }
const mcp = (r: McpRaw): McpServer => ({ id: r.id, name: r.name, template: r.template || "n8n", description: r.description ?? "", url: r.url, group_ids: list(r.group_ids), enabled: r.enabled === 1, allow_tools: list(r.allow_tools) });
const tokenFile = (id: string) => `n8n-mcp-${id}.token`;
function tokenLast4(id: string): string | null { const t = readSecret(tokenFile(id)); return t ? t.slice(-4) : null; }
function lastTools(r: McpRaw): McpTool[] { try { const a = JSON.parse(r.last_tools || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }
/** Rows of a template that is not available in this edition stay in the database untouched and are invisible and unusable. */
const usable = (r: McpRaw) => isTemplateId(r.template || "n8n");
const rows = (sql: string, ...args: (string | number)[]) => { ensureMcpTables(); return (getDb().prepare(sql).all(...args) as unknown as McpRaw[]).filter(usable); };

export function listMcpServers() {
  return rows("SELECT * FROM n8n_mcp_servers ORDER BY name")
    .map((r) => ({ ...mcp(r), url: maskUrl(r.url), hasToken: tokenLast4(r.id) !== null, tokenLast4: tokenLast4(r.id), tools: lastTools(r), testedAt: r.tested_at ?? null }));
}
export function saveMcpServer(actorId: string, input: Record<string, unknown>, id?: string): { id: string } {
  ensureMcpTables();
  const db = getDb();
  const cur = id ? (db.prepare("SELECT * FROM n8n_mcp_servers WHERE id=?").get(id) as unknown as McpRaw | undefined) : undefined;
  if (id && (!cur || !usable(cur))) throw new ServiceError("not_found", "No such server", 404);
  const template = cur ? (cur.template || "n8n") : (input.template === undefined ? "n8n" : String(input.template));
  // The server-side edition fence: the page only offers n8n, and a hand-made request for another template is refused here too.
  if (!isTemplateId(template)) throw new ServiceError("edition", CE_MCP_NOTICE, 403);
  const name = String(input.name ?? cur?.name ?? "").trim().toLowerCase();
  if (!NAME.test(name)) throw new ServiceError("bad_name", "Name: lowercase letters, digits, - and _ (it becomes part of the tool names)");
  const url = input.url ? checkUrl(input.url, "The MCP URL") : cur?.url;
  if (!url) throw new ServiceError("bad_url", "The MCP URL is required");
  const tokenTyped = typeof input.token === "string" && !!input.token.trim();
  // The saved key belongs to the saved address: moving the connector elsewhere needs the key typed again (or cleared).
  if (cur && !sameDest(cur.url, url) && readSecret(tokenFile(cur.id)) && !tokenTyped && input.clear_token !== true) throw new ServiceError("key_required", KEY_REQUIRED);
  const groups = input.group_ids !== undefined ? strs(input.group_ids) : list(cur?.group_ids ?? "[]");
  const enabled = input.enabled === undefined ? (cur ? cur.enabled === 1 : true) : input.enabled !== false;
  const description = input.description !== undefined ? String(input.description).trim().slice(0, 200) : (cur?.description ?? "");
  const dup = db.prepare("SELECT id FROM n8n_mcp_servers WHERE name=? AND id<>?").get(name, id ?? "");
  if (dup) throw new ServiceError("exists", "A connector with this name exists", 409);
  const allow = input.allow_tools !== undefined ? strs(input.allow_tools).map((x) => x.trim()).filter(Boolean) : (cur ? list(cur.allow_tools) : [...templateOf(template)!.defaultAllow]);
  const rowId = id ?? `m${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  if (cur) db.prepare("UPDATE n8n_mcp_servers SET name=?,url=?,group_ids=?,enabled=?,allow_tools=?,description=? WHERE id=?").run(name, url, JSON.stringify(groups), enabled ? 1 : 0, JSON.stringify(allow), description, rowId);
  else db.prepare("INSERT INTO n8n_mcp_servers (id,name,url,group_ids,enabled,allow_tools,template,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(rowId, name, url, JSON.stringify(groups), enabled ? 1 : 0, JSON.stringify(allow), template, description, Date.now());
  const tokenChanged = typeof input.token === "string" && !!input.token.trim();
  if (tokenChanged) writeSecret(tokenFile(rowId), String(input.token).trim());
  if (input.clear_token === true && !tokenChanged) { try { writeSecret(tokenFile(rowId), ""); } catch { /* none */ } }
  // Audit: what changed, never the key or the URL's secret path.
  writeAudit(cur ? "mcp.connection.update" : "mcp.connection.add", actorId, { serverId: rowId, name, template, groups: groups.length, enabled, allow, tokenChanged });
  return { id: rowId };
}
export function deleteMcpServer(actorId: string, id: string): void {
  ensureMcpTables();
  const cur = getDb().prepare("SELECT name,template FROM n8n_mcp_servers WHERE id=?").get(id) as unknown as { name: string; template: string } | undefined;
  if (!cur || !isTemplateId(cur.template || "n8n")) throw new ServiceError("not_found", "No such server", 404);
  getDb().prepare("DELETE FROM n8n_mcp_servers WHERE id=?").run(id);
  getDb().prepare("DELETE FROM n8n_mcp_grants WHERE server_id=?").run(id);
  writeAudit("mcp.connection.delete", actorId, { serverId: id, name: cur.name, template: cur.template });
}
/**
 * 測試連線: list the tools the other system really offers. With `id`, the stored URL and key are used unless the form
 * brings new ones, and the list is kept for the admin screen (so the allow list can be ticked from real names).
 */
export async function testMcpConnection(actorId: string, input: Record<string, unknown>): Promise<McpTestResult> {
  ensureMcpTables();
  const id = typeof input.id === "string" && input.id ? input.id : undefined;
  const cur = id ? (getDb().prepare("SELECT * FROM n8n_mcp_servers WHERE id=?").get(id) as unknown as McpRaw | undefined) : undefined;
  if (id && (!cur || !usable(cur))) throw new ServiceError("not_found", "No such server", 404);
  const url = input.url ? checkUrl(input.url, "The MCP URL") : cur?.url;
  if (!url) throw new ServiceError("bad_url", "The MCP URL is required");
  const typed = typeof input.token === "string" && !!input.token.trim();
  const stored = id ? readSecret(tokenFile(id)) : null;
  if (!mayUseStoredSecret({ hasStored: !!stored, storedDest: cur?.url, targetDest: url, typedNew: typed })) {
    writeAudit("mcp.connection.test", actorId, { serverId: id ?? null, ok: false, code: "key_required" });
    throw new ServiceError("key_required", KEY_REQUIRED);
  }
  const token = typed ? String(input.token).trim() : stored;
  const result = await testMcp(url, token);
  if (cur) getDb().prepare("UPDATE n8n_mcp_servers SET last_tools=?,tested_at=? WHERE id=?").run(result.ok ? JSON.stringify(result.tools) : cur.last_tools ?? "[]", Date.now(), cur.id);
  writeAudit("mcp.connection.test", actorId, { serverId: id ?? null, ok: result.ok, tools: result.ok ? result.tools.length : 0, code: result.ok ? null : result.code });
  return result;
}
/** The servers this person's conversation may connect to, with the key resolved (in memory only). `key` is the MCP server name the AI runtime sees. */
export function mcpServersFor(person: Person): { id: string; key: string; name: string; template: string; url: string; token: string | null; allow: string[] }[] {
  return rows("SELECT * FROM n8n_mcp_servers WHERE enabled=1").map(mcp)
    .filter((s) => allowed(person, s.group_ids))
    .map((s) => ({ id: s.id, key: serverKey(s.template, s.name), name: s.name, template: s.template, url: s.url, token: readSecret(tokenFile(s.id)), allow: s.allow_tools }));
}
/** Names, templates and one line each; never a URL, a key or a tool list. */
export function connectorsFor(person: Person): { id: string; template: string; templateLabel: string; name: string; description: string }[] {
  return rows("SELECT * FROM n8n_mcp_servers WHERE enabled=1 ORDER BY name").map(mcp)
    .filter((s) => allowed(person, s.group_ids))
    .map((s) => ({ id: s.id, template: s.template, templateLabel: templateOf(s.template)?.label ?? s.template, name: s.name, description: s.description || templateOf(s.template)?.description || "" }));
}
export { connectorTemplates };
