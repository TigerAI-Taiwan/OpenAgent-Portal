// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Security review H1: a stored key only travels to the address it was stored for, and the maintenance account is read-only on
// models / web / asr / connectors.   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-h1-secret-dest.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-sec-h1-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_VENDOR_EMAIL = "vendor@tiger.example";
process.env.TIGERAI_VENDOR_PASSWORD = "Vendor-Pass-12345!";
process.env.TIGERAI_VENDOR_MUST_CHANGE = "0";
delete process.env.TIGERAI_LICENSE_FILE; delete process.env.TIGERAI_ADDON_DIR;
const acc = await import("../accounts/service.ts");
const { handle } = await import("../api/router.ts");
const { getDb } = await import("../db/store.ts");
const { bootstrapVendor } = await import("../accounts/vendor.ts");
const { vendorAllows } = await import("../accounts/vendor-policy.ts");
const models = await import("../provider/admin.ts");
const web = await import("../web/settings.ts");
const webSvc = await import("../web/service.ts");
const asr = await import("../wizards/meeting/asr-settings.ts");
const mcp = await import("../n8nmcp/service.ts");
acc.bootstrapAdmin(); bootstrapVendor();
const admin = acc.createUser(null, { email: "a@x.example", name: "Admin", role: "admin", password: "Test-Pass-12345!", mustChange: false }).user;
const vendor = getDb().prepare("SELECT * FROM users WHERE email='vendor@tiger.example'").get();

// Two listeners: GOOD is where the secrets were stored for; EVIL is any other address. Both record the Authorization header.
const seen = { good: [], evil: [] };
const mk = (name) => new Promise((res) => { const s = createServer((req, r) => { req.resume(); req.on("end", () => { seen[name].push(String(req.headers.authorization ?? "")); r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ data: [{ id: "m1" }], result: {} })); }); }).listen(0, "127.0.0.1", () => res(s)); });
const good = await mk("good"), evil = await mk("evil");
const GOOD = `http://127.0.0.1:${good.address().port}`, EVIL = `http://127.0.0.1:${evil.address().port}`;
test.after(() => { good.close(); evil.close(); });
const KEY = "sk-stored-secret-key-1111";
const leaked = () => seen.evil.some((h) => h.includes(KEY));

test("model connection: test with another address never sends the stored key; same address does; typed key does", async () => {
  await models.addConnection(admin.id, { name: "main", baseUrl: GOOD, apiKey: KEY });
  const id = (models.viewConnections().connections[0]).id;
  const r1 = await models.testConnection({ id, baseUrl: EVIL });
  assert.equal(r1.ok, false); assert.equal(r1.code, "key_required");
  assert.equal(leaked(), false);
  const r1b = await models.testConnection({ baseUrl: EVIL }); // legacy: first connection
  assert.equal(r1b.code, "key_required");
  assert.equal(leaked(), false);
  assert.equal((await models.testConnection({ id, baseUrl: GOOD })).ok, true);
  assert.equal((await models.testConnection({ id })).ok, true);
  assert.ok(seen.good.some((h) => h === `Bearer ${KEY}`));
  assert.equal((await models.testConnection({ id, baseUrl: EVIL, apiKey: "typed-new-key-2222" })).ok, true);
  assert.ok(seen.evil.includes("Bearer typed-new-key-2222")); // what was typed is the caller's own
});

test("model connection: saving another address without the key typed again is refused, key and address unchanged", async () => {
  const id = models.viewConnections().connections[0].id;
  await assert.rejects(() => models.updateConnection(admin.id, id, { baseUrl: EVIL }), /key/i);
  await assert.rejects(() => models.saveModelSettings(admin.id, { baseUrl: EVIL }), /key/i);
  assert.equal(models.viewConnections().connections[0].baseUrl, GOOD);
  assert.equal(leaked(), false);
  await models.updateConnection(admin.id, id, { baseUrl: EVIL, apiKey: "typed-new-key-3333" }); // typed: allowed
  assert.equal(models.viewConnections().connections[0].baseUrl, EVIL);
  await models.updateConnection(admin.id, id, { baseUrl: GOOD, apiKey: KEY });
});

test("MCP connector: test with another URL is refused (no token sent); save of another URL needs the token typed again", async () => {
  const { id } = mcp.saveMcpServer(admin.id, { name: "n8n", url: GOOD + "/mcp", token: KEY, allow_tools: ["*"] });
  await assert.rejects(() => mcp.testMcpConnection(admin.id, { id, url: EVIL + "/mcp" }), (e) => e.code === "key_required");
  assert.equal(leaked(), false);
  assert.throws(() => mcp.saveMcpServer(admin.id, { url: EVIL + "/mcp" }, id), (e) => e.code === "key_required");
  const r = await mcp.testMcpConnection(admin.id, { id }); assert.ok(r); // stored address: allowed
  mcp.saveMcpServer(admin.id, { url: EVIL + "/mcp", token: "typed-mcp-4444" }, id); // typed: allowed
  mcp.saveMcpServer(admin.id, { url: GOOD + "/mcp", token: KEY }, id);
});

test("web search key: another provider needs the key typed again (test and save)", async () => {
  web.saveWebSettings(admin.id, { provider: "searxng", searxUrl: GOOD, apiKey: "brave-stored-key-5555" });
  const t = await webSvc.testSearch(admin.id, { provider: "brave" });
  assert.equal(t.ok, false); assert.equal(t.code, "key_required");
  assert.throws(() => web.saveWebSettings(admin.id, { provider: "tavily" }), (e) => e.code === "key_required");
  web.saveWebSettings(admin.id, { provider: "searxng", searxUrl: EVIL }); // searxng never sends the key
  assert.equal(leaked(), false);
});

test("ASR key: test and save with another address need the key typed again", async () => {
  asr.saveAsr(admin.id, { url: GOOD + "/v1/audio/transcriptions", apiKey: KEY });
  const t = await asr.testAsr({ url: EVIL + "/v1/audio/transcriptions" });
  assert.equal(t.ok, false); assert.equal(t.code, "key_required");
  assert.throws(() => asr.saveAsr(admin.id, { url: EVIL + "/v1/audio/transcriptions" }), (e) => e.code === "key_required");
  assert.equal(leaked(), false);
  assert.equal((await asr.testAsr({})).ok, true); // stored address
  assert.ok(seen.good.includes(`Bearer ${KEY}`));
});

test("maintenance account is read-only on models/web/asr/connectors (no save, no test, no connection changes) and GET still works", async () => {
  for (const p of ["models", "models/connections", "web", "asr", "connectors", "system"]) assert.equal(vendorAllows("GET", `/api/tg/admin/${p}`), true, p);
  for (const [m, p] of [["PUT", "models"], ["POST", "models/test"], ["POST", "models/connections"], ["PATCH", "models/connections/x"], ["DELETE", "models/connections/x"], ["POST", "models/refresh"], ["PUT", "web"], ["POST", "web/test"], ["POST", "web/test-converter"], ["PUT", "asr"], ["POST", "asr/test"], ["POST", "connectors"], ["POST", "connectors/test"], ["POST", "connectors/m1/test"], ["PATCH", "connectors/m1"], ["DELETE", "connectors/m1"]]) assert.equal(vendorAllows(m, `/api/tg/admin/${p}`), false, `${m} ${p}`);
  const call = async (method, path, body) => { const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": vendor.id, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), path.split("/")); return res.status; };
  assert.equal(await call("POST", "admin/models/test", { id: "x", baseUrl: EVIL }), 403);
  assert.equal(await call("POST", "admin/connectors/test", { url: EVIL }), 403);
  assert.equal(await call("PUT", "admin/asr", { url: EVIL }), 403);
  assert.equal(await call("PUT", "admin/web", { searxUrl: EVIL }), 403);
  assert.equal(await call("GET", "admin/models"), 200);
  assert.equal(await call("GET", "admin/web"), 200);
  assert.equal(leaked(), false);
});
