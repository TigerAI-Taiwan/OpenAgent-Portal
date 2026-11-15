// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Community edition: MCP is open for n8n only (as the MCP demonstration); n8n's write tools need an approved work order.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-n8nmcp.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-n8nmcp-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
delete process.env.TIGERAI_LICENSE_FILE; delete process.env.TIGERAI_ADDON_DIR;

const T = await import("../n8nmcp/templates.ts");
const RT = await import("../n8nmcp/runtime-templates.ts");
const svc = await import("../n8nmcp/service.ts");
await import("../n8nmcp/grants.ts");
const { createMcpExtension } = await import("../n8nmcp/extension.ts");
const { testMcp } = await import("../n8nmcp/mcp-client.ts");
const acc = await import("../accounts/service.ts");
const { handle } = await import("../api/router.ts");
const { listOrders } = await import("../workorders/service.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const { getDb } = await import("../db/store.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const admin2 = mk("admin2@example.com", "Admin2", "admin");
const lin = mk("lin@example.com", "林小華");
const wang = mk("wang@example.com", "王小明");
const call = async (u, method, path, body) => {
  const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": u.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/"));
  return { status: res.status, json: await res.json().catch(() => null) };
};
const audit = (action) => getDb().prepare("SELECT actor_id, extra FROM audit WHERE action=?").all(action).map((r) => ({ actor: r.actor_id, ...JSON.parse(r.extra ?? "{}") }));

// A stub n8n MCP server.
const KEY = "n8n-token-abcd1234";
const stub = createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401); return res.end(); }
    const body = raw ? JSON.parse(raw) : {};
    if (body.method === "initialize") { res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "n8n-stub" } } })); }
    if (body.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (body.method === "tools/list") {
      const tools = ["search_workflows", "get_workflow_details", "execute_workflow", "create_workflow_from_code", "update_workflow"].map((name) => ({ name, description: name }));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } }));
    }
    res.writeHead(200); res.end("{}");
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${stub.address().port}/mcp-server/http`;
test.after(() => stub.close());

const NOTICE = "社群版只開放 n8n 的 MCP，當作 MCP 示範；其他系統的 MCP 請洽顧問或虎智科技（tiger.ai.tw@gmail.com）。";

test("the community edition offers the n8n template only, and the Founder's wording is the refusal", async () => {
  assert.equal(T.CE_MCP_NOTICE, NOTICE);
  assert.deepEqual(RT.connectorTemplates().map((t) => t.id), ["n8n"]);
  for (const template of ["gitea", "zabbix", "custom", "bogus"]) {
    const r = await call(admin, "POST", "admin/connectors", { name: "x", template, url: URL_ });
    assert.equal(r.status, 403, template);
    assert.equal(r.json.error, NOTICE, "the API says it in the Founder's words");
  }
  assert.deepEqual(svc.listMcpServers(), [], "nothing was written");
  const tpls = (await call(admin, "GET", "admin/connectors")).json.templates;
  assert.deepEqual(tpls.map((t) => t.id), ["n8n"]);
  assert.equal((await call(lin, "GET", "admin/connectors")).status, 403, "members never reach the admin routes");
});

test("the default tool list is the reads plus three authoring tools; every tool outside the read list counts as a write (fail closed)", () => {
  for (const t of T.DEFAULT_MCP_ALLOW) assert.ok(T.N8N_READ_TOOLS.includes(t) || ["create_workflow_from_code", "update_workflow", "execute_workflow", "publish_workflow", "unpublish_workflow"].includes(t));
  for (const w of ["execute_workflow", "create_workflow_from_code", "update_workflow", "publish_workflow", "archive_workflow", "some_new_tool"]) assert.ok(T.isN8nWriteTool(w), w);
});

test("add an n8n connection: key file 600, last 4 only, test lists the tools, audit holds no key and no address", async () => {
  const made = await call(admin, "POST", "admin/connectors", { name: "prod", url: URL_, token: KEY, description: "教學用 n8n" });
  assert.equal(made.status, 201);
  const id = made.json.id;
  assert.equal((statSync(join(dir, "data", "secrets", `n8n-mcp-${id}.token`)).mode & 0o777).toString(8), "600");
  const row = svc.listMcpServers().find((s) => s.id === id);
  assert.deepEqual([row.template, row.tokenLast4, row.allow_tools], ["n8n", "1234", T.DEFAULT_MCP_ALLOW]);
  assert.ok(!JSON.stringify(row).includes(KEY) && !row.url.includes("mcp-server"), "no key, no full address in the list");
  const ok = await testMcp(URL_, KEY);
  assert.equal(ok.ok, true); assert.equal(ok.tools.length, 5);
  assert.equal((await testMcp(URL_, "wrong")).code, "unauthorized");
  const tested = await call(admin, "POST", `admin/connectors/${id}/test`, {});
  assert.equal(tested.json.ok, true);
  assert.equal(svc.listMcpServers().find((s) => s.id === id).tools.length, 5);
  const lines = [...audit("mcp.connection.add"), ...audit("mcp.connection.test")];
  assert.equal(lines.length, 2);
  assert.ok(!JSON.stringify(lines).includes(KEY) && !JSON.stringify(lines).includes("127.0.0.1"));
  // allow the write tools too (the admin's own fence); the approval requirement stays on top.
  const g = acc.createGroup(admin.id, { name: "教師" });
  acc.setMembership(admin.id, g.id, lin.id, true);
  assert.equal((await call(admin, "PATCH", `admin/connectors/${id}`, { group_ids: [g.id], allow_tools: [...T.DEFAULT_MCP_ALLOW, "execute_workflow", "create_workflow_from_code"] })).status, 200);
  state.id = id;
});
const state = {};

test("a database row of another template (left by the consultant pack) is invisible and unusable here, not deleted", async () => {
  getDb().prepare("INSERT INTO n8n_mcp_servers (id,name,url,group_ids,enabled,created_at,allow_tools,template) VALUES ('mg','code','http://x/mcp','[]',1,1,'[\"repo_read\"]','gitea')").run();
  assert.equal(svc.listMcpServers().some((s) => s.id === "mg"), false);
  assert.equal(svc.mcpServersFor({ id: admin.id, role: "admin" }).some((s) => s.id === "mg"), false);
  assert.equal((await call(admin, "PATCH", "admin/connectors/mg", { enabled: false })).status, 404);
  assert.equal((await call(admin, "DELETE", "admin/connectors/mg")).status, 404);
  assert.ok(getDb().prepare("SELECT 1 FROM n8n_mcp_servers WHERE id='mg'").get(), "the row is still in the database");
});

// ---- the conversation side: a fake pi to capture handlers and the tool ----
function boot(userId) {
  const sid = `s-${Math.random().toString(36).slice(2)}`;
  registerOwner(sid, userId, join(dir, "data", "workspace", "users", userId), "chat", null);
  const handlers = {}; let tool; const registered = [];
  createMcpExtension().factory({
    on: (e, h) => { handlers[e] = h; }, registerTool: (t) => { tool = t; }, registerMcpServer: (n) => registered.push(n), unregisterMcpServer: () => {},
  });
  const ctx = { sessionManager: { getSessionId: () => sid }, cwd: join(dir, "data", "workspace", "users", userId) };
  return { ctx, handlers, tool, registered };
}
const toolCall = (b, name, tool, n = 1, input = {}) => b.handlers.tool_call({ toolName: `mcp__n8n_prod__${tool}`, toolCallId: `${name}${n}`, input }, b.ctx);

test("members in the connector's group register it; others get nothing", () => {
  const a = boot(lin.id); a.handlers.session_start({}, a.ctx);
  assert.deepEqual(a.registered, ["n8n_prod"]);
  const b = boot(wang.id); b.handlers.session_start({}, b.ctx);
  assert.deepEqual(b.registered, [], "wang is outside the group");
  assert.equal(toolCall(b, "w", "search_workflows").block, true, "a call from outside the group is blocked at call time too");
});

test("1.1.0-ce: read AND write tools run without approval (the tool list is the administrator's), and a write is audited as a write", () => {
  const b = boot(lin.id);
  assert.equal(toolCall(b, "r", "search_workflows"), undefined, "a read tool needs no approval");
  // Since the ownership rule (security review H3) a write on an existing workflow needs the person to own it: they made it through the Portal.
  assert.equal(toolCall(b, "c", "create_workflow_from_code"), undefined, "creating needs no approval");
  b.handlers.tool_result({ toolCallId: "c1", isError: false, content: [{ type: "text", text: '{"workflowId":"wfOWN000000001"}' }] });
  assert.equal(toolCall(b, "w", "execute_workflow", 1, { workflowId: "wfOWN000000001" }), undefined, "a write tool on your own workflow needs no approval");
  b.handlers.tool_result({ toolCallId: "w1", isError: false });
  assert.equal(audit("mcp.tool_call").some((l) => l.tool === "execute_workflow" && l.outcome === "ok" && l.write === true), true, "the write is in the audit trail");
  assert.equal(b.tool, undefined, "there is no n8n_request_write tool any more");
  // a tool the administrator did not tick stays refused: that is the administrator's switch, not an approval
  assert.equal(toolCall(b, "n", "archive_workflow").block, true);
  assert.equal(audit("mcp.write_request").length, 0);
});

test("a legacy pending 「n8n 修改申請」 can still be closed by an administrator, and changes nothing", async () => {
  const { createOrder } = await import("../workorders/service.ts");
  const old = createOrder("n8n_mcp_write", lin.id, { name: "n8n 修改申請:prod", title: "x", body: "x" });
  assert.equal((await call(admin, "POST", `admin/workorders/${old.id}/decide`, { approve: true })).status, 200);
  assert.equal(state.b, undefined);
});

test("the member path guard lets n8n connector tools through and still blocks every other MCP tool", async () => {
  const { createPathGuard } = await import("../adapter/path-guard.ts");
  let handler;
  createPathGuard(dir).factory({ on: (_e, h) => { handler = h; } });
  assert.equal(handler({ toolName: "mcp__n8n_prod__search_workflows", input: {} }), undefined);
  for (const tool of ["mcp__filesystem__read_file", "mcp__gitea_code__repo_read", "mcp__zabbix_mon__problem_get", "mcp__custom_x__anything"]) assert.equal(handler({ toolName: tool, input: {} }).block, true, tool);
});
