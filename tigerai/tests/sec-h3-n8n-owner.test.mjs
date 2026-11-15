// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Security review H3 (best effort): n8n write tools only on workflows the person created through the Portal; none after web content in the same turn.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-h3-n8n-owner.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-sec-h3-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
delete process.env.TIGERAI_LICENSE_FILE; delete process.env.TIGERAI_ADDON_DIR;
const svc = await import("../n8nmcp/service.ts");
await import("../n8nmcp/grants.ts");
const own = await import("../n8nmcp/ownership.ts");
const { createMcpExtension } = await import("../n8nmcp/extension.ts");
const { createWebExtension } = await import("../web/extension.ts");
const acc = await import("../accounts/service.ts");
const { handle } = await import("../api/router.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const { getDb } = await import("../db/store.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const lin = mk("lin@example.com", "林小華");
const wang = mk("wang@example.com", "王小明");
const g = acc.createGroup(admin.id, { name: "班" });
for (const u of [lin, wang]) acc.setMembership(admin.id, g.id, u.id, true);
const { id: serverId } = svc.saveMcpServer(admin.id, { name: "prod", url: "http://127.0.0.1:9/mcp", token: "t-1234", group_ids: [g.id], allow_tools: ["*"] });
const call = async (u, method, path, body) => { const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": u.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/")); return { status: res.status, json: await res.json().catch(() => null) }; };

function boot(user) {
  const sid = `s-${Math.random().toString(36).slice(2)}`;
  const cwd = join(dir, "data", "workspace", "users", user.id);
  registerOwner(sid, user.id, cwd, "chat", null);
  const h = {}; const web = {};
  createMcpExtension().factory({ on: (e, f) => { h[e] = f; }, registerMcpServer: () => {}, unregisterMcpServer: () => {}, getAllTools: () => [] });
  createWebExtension().factory({ on: (e, f) => { web[e] = f; }, registerTool: () => {} });
  const ctx = { sessionManager: { getSessionId: () => sid }, cwd };
  let n = 0;
  const run = (tool, input, result) => {
    const id = `c${++n}`;
    const r = h.tool_call({ toolName: `mcp__n8n_prod__${tool}`, toolCallId: id, input }, ctx);
    if (!r?.block) h.tool_result({ toolCallId: id, isError: false, content: result ?? [{ type: "text", text: "{}" }] });
    return r;
  };
  const webRead = () => web.tool_result({ toolName: "web_fetch", toolCallId: `w${++n}` }, ctx);
  const newTurn = async () => { await h.before_agent_start({}, ctx); };
  return { run, webRead, newTurn };
}
const made = (id) => [{ type: "text", text: JSON.stringify({ workflowId: id, name: "x" }) }];

test("a member's created workflow is theirs: they can update/execute/delete it; someone else cannot, and neither can an unknown one", () => {
  const a = boot(lin), b = boot(wang);
  assert.equal(a.run("create_workflow_from_code", { code: "..." }, made("wfLIN0000000001")), undefined, "creating is free");
  assert.equal(own.ownerOf(serverId, "wfLIN0000000001"), lin.id);
  for (const t of ["update_workflow", "execute_workflow", "archive_workflow", "publish_workflow"]) assert.equal(a.run(t, { workflowId: "wfLIN0000000001" }), undefined, `owner ${t}`);
  for (const t of ["update_workflow", "execute_workflow", "archive_workflow", "publish_workflow"]) assert.equal(b.run(t, { workflowId: "wfLIN0000000001" }).block, true, `other ${t}`);
  assert.equal(b.run("update_workflow", { workflowId: "wfUNKNOWN000001" }).block, true, "no record: refused");
  assert.equal(b.run("update_workflow", {}).block, true, "names no workflow: refused");
  assert.equal(b.run("search_workflows", {}), undefined, "reads stay free");
  assert.equal(b.run("create_workflow_from_code", { code: "x" }, made("wfWANG0000000001")), undefined);
  assert.equal(own.ownerOf(serverId, "wfWANG0000000001"), wang.id);
});

test("an administrator may act on everything; an administrator can share a workflow for running only, or assign an owner", async () => {
  const a = boot(admin), b = boot(wang);
  assert.equal(a.run("update_workflow", { workflowId: "wfLIN0000000001" }), undefined);
  assert.equal(b.run("execute_workflow", { workflowId: "wfLIN0000000001" }).block, true);
  assert.equal((await call(admin, "POST", `admin/connectors/${serverId}/workflows`, { workflowId: "wfLIN0000000001", shared: true })).status, 200);
  assert.equal(b.run("execute_workflow", { workflowId: "wfLIN0000000001" }), undefined, "shared: may run");
  assert.equal(b.run("update_workflow", { workflowId: "wfLIN0000000001" }).block, true, "shared is execute only");
  assert.equal((await call(admin, "POST", `admin/connectors/${serverId}/workflows`, { workflowId: "wfOLD", ownerId: wang.id })).status, 200);
  assert.equal(b.run("update_workflow", { workflowId: "wfOLD" }), undefined, "assigned by the administrator");
  assert.equal((await call(wang, "POST", `admin/connectors/${serverId}/workflows`, { workflowId: "wfOLD", ownerId: wang.id })).status, 403, "members cannot assign");
});

test("a block is audited, and a create whose answer has no id is audited as owner_unknown", () => {
  const b = boot(wang);
  b.run("update_workflow", { workflowId: "wfLIN0000000001" });
  assert.ok(getDb().prepare("SELECT 1 FROM audit WHERE action='mcp.tool_call' AND extra LIKE '%not_owner%'").get());
  b.run("create_workflow_from_code", {}, [{ type: "text", text: "created" }]);
  assert.ok(getDb().prepare("SELECT 1 FROM audit WHERE action='mcp.owner_unknown'").get());
});

test("prompt-injection guard: after web content in a turn, n8n changes are refused until the user speaks again", async () => {
  const a = boot(lin);
  assert.equal(a.run("execute_workflow", { workflowId: "wfLIN0000000001" }), undefined);
  a.webRead();
  const r = a.run("execute_workflow", { workflowId: "wfLIN0000000001" });
  assert.equal(r.block, true); assert.match(r.reason, /confirmation/);
  assert.equal(a.run("update_workflow", { workflowId: "wfLIN0000000001" }).block, true);
  assert.equal(a.run("create_workflow_from_code", {}).block, true, "creating is also a change");
  assert.equal(a.run("get_workflow_details", { workflowId: "wfLIN0000000001" }), undefined, "reading is still fine");
  await a.newTurn(); // the user answered: a new turn
  assert.equal(a.run("execute_workflow", { workflowId: "wfLIN0000000001" }), undefined);
});
