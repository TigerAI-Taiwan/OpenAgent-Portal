// 1.1.2-ce item 3: an n8n app whose Webhook node listens on GET works end to end (stored method, query string, self-correction).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const dir = mkdtempSync(join(tmpdir(), "tg-112-wh-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
mkdirSync(process.env.TIGERAI_DATA_DIR, { recursive: true });
const acc = await import("../accounts/service.ts");
const svc = await import("../n8n/service.ts");
const call = await import("../n8n/call.ts");
const { createN8nExtension } = await import("../n8n/extension.ts");
const { handle } = await import("../api/router.ts");
const pub = await import("../n8n/publish.ts");

const PORT = 30000 + 20000 + Math.floor(Math.random() * 5000);
writeFileSync(join(dir, "tok"), "tok\n");
const mock = spawn(process.execPath, [new URL("../dev/mock-n8n.mjs", import.meta.url).pathname, String(PORT), join(dir, "tok")], { stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/__stats`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
test.after(() => mock.kill());
const stats = async () => (await fetch(`http://127.0.0.1:${PORT}/__stats`)).json();

const PW = "Test-Pass-12345!";
const admin = acc.createUser(null, { email: "admin@example.com", name: "Admin", role: "admin", password: PW, mustChange: false }).user;
const lin = acc.createUser(null, { email: "lin@example.com", name: "Lin", role: "member", password: PW, mustChange: false }).user;
const URL_GET = `http://127.0.0.1:${PORT}/webhook/portal-get/lookup`;

test("buildRequest: GET puts scalars and JSON text in the query, POST a JSON body", () => {
  const g = call.buildRequest("http://x/w?a=1", "GET", { co_id: "2308", n: 3, obj: { k: 1 } }, ["X-K", "v"]);
  assert.equal(g.init.method, "GET"); assert.equal(g.init.body, undefined);
  const u = new URL(g.url); assert.equal(u.searchParams.get("a"), "1"); assert.equal(u.searchParams.get("co_id"), "2308"); assert.equal(u.searchParams.get("n"), "3"); assert.equal(u.searchParams.get("obj"), '{"k":1}');
  assert.equal(g.init.headers["X-K"], "v");
  const p = call.buildRequest("http://x/w", "POST", { co_id: "1" }, null);
  assert.equal(p.init.method, "POST"); assert.equal(p.init.body, '{"co_id":"1"}');
});
test("a GET webhook stored with the app is called with GET and answers", async () => {
  const { id } = svc.saveWebhook(admin.id, { name: "lookup", display_name: "查營收", url: URL_GET, method: "GET", description: "co_id", group_ids: ["*"] });
  assert.equal(svc.listWebhooks().find((w) => w.id === id).method, "GET");
  const hook = svc.webhooksFor({ id: lin.id, role: "member" })[0];
  assert.equal(hook.method, "GET");
  const r = await call.callWebhook(hook, { co_id: "2308" }, AbortSignal.timeout(5000));
  assert.equal(r.status, 200); assert.equal(r.corrected, false);
  assert.match(r.body, /Delta Electronics/);
  assert.deepEqual((await stats()).get.at(-1), { co_id: "2308" });
});
test("end to end through the AI tool, as a member, with the 功能 menu entry listing the app", async () => {
  const apps = svc.appsFor({ id: lin.id, role: "member" });
  assert.equal(apps.length, 1);
  assert.equal(apps[0].name, "lookup");
});
test("an app registered with the wrong method heals itself once, and the right method is stored", async () => {
  const { id } = svc.saveWebhook(admin.id, { name: "wrong", url: URL_GET, method: "POST", description: "x", group_ids: ["*"] });
  const hook = svc.webhooksFor({ id: lin.id, role: "member" }).find((w) => w.id === id);
  assert.equal(hook.method, "POST");
  const before = (await stats()).get.length;
  const r = await call.callWebhook(hook, { co_id: "2308" }, AbortSignal.timeout(5000));
  assert.equal(r.status, 200); assert.equal(r.corrected, true); assert.equal(r.method, "GET");
  assert.equal((await stats()).get.length, before + 1);
  assert.equal(svc.listWebhooks().find((w) => w.id === id).method, "GET", "remembered");
});
test("a POST webhook still works as before; a bad method is refused", async () => {
  const { id } = svc.saveWebhook(admin.id, { name: "rev", url: `http://127.0.0.1:${PORT}/webhook/monthly-revenue`, description: "x", group_ids: ["*"] });
  const hook = svc.webhooksFor({ id: lin.id, role: "member" }).find((w) => w.id === id);
  assert.equal(hook.method, "POST");
  const r = await call.callWebhook(hook, { co_id: "2308" }, AbortSignal.timeout(5000));
  assert.equal(r.status, 200); assert.equal(r.corrected, false);
  assert.throws(() => svc.saveWebhook(admin.id, { name: "bad", url: URL_GET, method: "PUT", group_ids: [] }), /GET or POST/);
});
test("publishing keeps the method (administrator publishes directly)", () => {
  const r = pub.publish({ id: admin.id, role: "admin" }, { name: "pubget", label: "查", description: "co_id", url: URL_GET, method: "GET", groupIds: ["*"] });
  assert.equal(r.published, true);
  assert.equal(svc.listWebhooks().find((w) => w.name === "pubget").method, "GET");
});
test("the n8n_webhook tool calls a GET app end to end (room assistant acting as the speaker)", async () => {
  const { registerOwner } = await import("../rooms/ownership.ts");
  const { setRoomSpeaker } = await import("../rooms/speaker.ts");
  registerOwner("room-s1", lin.id, join(dir, "rooms/r1"), "room-role", "r1");
  setRoomSpeaker("room-s1", lin.id);
  const tools = new Map();
  createN8nExtension().factory({ on() {}, registerTool: (t) => tools.set(t.name, t) });
  const ctx = { sessionManager: { getSessionId: () => "room-s1" }, cwd: join(dir, "rooms/r1") };
  const before = (await stats()).get.length;
  const out = (await tools.get("n8n_webhook").execute("c", { name: "查營收", payload: { co_id: "2308" } }, undefined, undefined, ctx)).content[0].text;
  assert.match(out, /Delta Electronics/);
  assert.equal((await stats()).get.length, before + 1, "the mock saw a GET with the payload as query");
});
