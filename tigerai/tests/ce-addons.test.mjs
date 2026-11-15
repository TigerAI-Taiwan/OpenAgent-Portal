// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Add-on mount point in the community edition: licence checks, nothing loads, add-on routes and hooks answer 404.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-addons.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-addon-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
delete process.env.TIGERAI_LICENSE_FILE; delete process.env.TIGERAI_ADDON_DIR;

const lic = await import("../addons/license.ts");
const reg = await import("../addons/registry.ts");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const hookTick = await import("../addons/hook-wizards-tick.ts");
const sched = await import("../wizards/scheduler.ts");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" });
const issue = (over = {}, key = privateKey) => {
  const payload = { org: "測試公司", edition: "consultant", features: ["consultant"], issuedAt: "2026-11-01", expires: "2099-12-31", ...over };
  const signature = sign(null, Buffer.from(lic.canonicalPayload(payload)), key).toString("base64");
  return JSON.stringify({ payload, signature });
};

test("licence: a signed file is accepted until the end of its expiry day; tampering, another key, bad shape and expiry are refused", () => {
  assert.equal(lic.checkLicenseText(issue(), Date.now(), PUB).ok, true);
  const day = Date.parse("2027-06-30T12:00:00Z");
  assert.equal(lic.checkLicenseText(issue({ expires: "2027-06-30" }), day, PUB).ok, true, "the last day still counts");
  const late = lic.checkLicenseText(issue({ expires: "2027-06-30" }), Date.parse("2027-07-01T00:00:01Z"), PUB);
  assert.equal(late.ok, false); assert.equal(late.reason, "expired");
  const doc = JSON.parse(issue()); doc.payload.features = ["consultant", "everything"];
  assert.equal(lic.checkLicenseText(JSON.stringify(doc), Date.now(), PUB).reason, "bad_signature", "a changed payload breaks the signature");
  const other = generateKeyPairSync("ed25519").privateKey;
  assert.equal(lic.checkLicenseText(issue({}, other), Date.now(), PUB).reason, "bad_signature");
  assert.equal(lic.checkLicenseText("not json", Date.now(), PUB).reason, "unreadable");
  assert.equal(lic.checkLicenseText(JSON.stringify({ payload: { org: "x" }, signature: "AA" }), Date.now(), PUB).reason, "bad_payload");
  // a licence signed by someone else with the real embedded key is not accepted either (the embedded key is not the test key)
  assert.equal(lic.checkLicenseText(issue()).ok, false);
});

test("the licence file lives in TIGERAI_ADDON_DIR (default: data dir / addons); missing is reported, not thrown", () => {
  assert.equal(lic.licensePath(), join(dir, "data", "addons", "license.json"));
  assert.equal(lic.readLicense().reason, "missing");
  process.env.TIGERAI_ADDON_DIR = join(dir, "elsewhere");
  assert.equal(lic.licensePath(), join(dir, "elsewhere", "license.json"));
  delete process.env.TIGERAI_ADDON_DIR;
  writeFileSync(join(dir, "junk.json"), "{}");
  process.env.TIGERAI_LICENSE_FILE = join(dir, "junk.json");
  assert.equal(lic.readLicense().ok, false);
  delete process.env.TIGERAI_LICENSE_FILE;
});

test("community build: no package is compiled in, nothing is active, the 顧問包 page has nothing to show but 未安裝", () => {
  assert.equal(reg.hasAnyAddon(), false);
  assert.deepEqual(reg.activeAddons(), []);
  assert.deepEqual(reg.addonViews(), []);
  assert.equal(reg.isAddonActive("consultant"), false);
  assert.deepEqual(reg.addonSessionExtensions({ sessionId: "s", cwd: "/x" }), []);
  assert.equal(reg.addonAllowsMcpServer("n8n_x"), false, "no add-on allows an MCP server in the community edition (the n8n connector is the community edition's own)");
});

test("add-on routes and hooks do not exist: 404 for the old n8n MCP route and the schedule endpoint; webhooks and hook keys stay", async () => {
  const admin = acc.createUser(null, { email: "a@example.com", name: "Admin", role: "admin", password: "Test-Pass-12345!", mustChange: false }).user;
  const member = acc.createUser(null, { email: "m@example.com", name: "Member", role: "member", password: "Test-Pass-12345!", mustChange: false }).user;
  const call = async (u, method, path) => {
    const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": u.id, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) }), path.split("/"));
    return res.status;
  };
  assert.equal(await call(member, "GET", "n8n/apps"), 200, "n8n webhook apps are a community feature");
  assert.equal(await call(member, "GET", "connectors"), 200, "the n8n MCP connection is a community feature (the demo of MCP); see ce-n8nmcp.test.mjs");
  assert.equal(await call(admin, "GET", "admin/connectors"), 200);
  for (const p of ["admin/n8n/mcp", "admin/n8n/schedule", "admin/n8n/schedule-template"]) assert.equal(await call(admin, "GET", p), 404, p);
  for (const p of ["admin/n8n/webhooks", "admin/n8n/keys"]) assert.equal(await call(admin, "GET", p), 200, `${p} stays in the community edition`);
  const res = await handle(new Request("http://x/api/tg/addons", { headers: { "x-tg-uid": member.id } }), ["addons"]);
  assert.deepEqual((await res.json()).addons, []);
    assert.equal((await hookTick.POST(new Request("http://x/api/tigerai/hooks/wizards/tick", { method: "POST", body: "{}" }))).status, 404);
});

test("upstream's MCP settings API is closed in the community edition (404 for everyone signed in), open once a package is active", async () => {
  const { gate, mcpSettingsPath } = await import("../adapter/gate.ts");
  const { NextRequest } = await import("next/server");
  const { createSessionCookie, SESSION_COOKIE } = await import("../accounts/session.ts");
  const admin = acc.listUsers().find((u) => u.role === "admin");
  const cookie = `${SESSION_COOKIE}=${createSessionCookie(admin.id, acc.userById(admin.id).token_version)}`;
  assert.ok(mcpSettingsPath("/api/mcp") && mcpSettingsPath("/api/mcp/test") && mcpSettingsPath("/api/mcp/sign-in/x") && !mcpSettingsPath("/api/mcpx"));
  for (const p of ["/api/mcp", "/api/mcp/test", "/api/mcp/sign-in"]) {
    const res = await gate(new NextRequest(`http://x${p}`, { method: p === "/api/mcp" ? "GET" : "POST", headers: { cookie } }), false);
    assert.equal(res.status, 404, p);
  }
  const other = await gate(new NextRequest("http://x/api/sessions", { headers: { cookie } }), false);
  assert.notEqual(other.status, 404, "other upstream routes are untouched");
});

test("scheduler: the community edition always runs its own pass; TIGERAI_WIZARD_SCHEDULER_MS tunes or switches it off", () => {
  assert.equal(sched.schedulerStepMs(), 5 * 60_000);
  process.env.TIGERAI_WIZARD_SCHEDULER_MS = "0"; assert.equal(sched.schedulerStepMs(), 0);
  process.env.TIGERAI_WIZARD_SCHEDULER_MS = "1000"; assert.equal(sched.schedulerStepMs(), 1000);
  process.env.TIGERAI_WIZARD_SCHEDULER_MS = "junk"; assert.equal(sched.schedulerStepMs(), 5 * 60_000);
  delete process.env.TIGERAI_WIZARD_SCHEDULER_MS;
  assert.equal(sched.externalInCharge(), false);
});

// ---------------------------------------------------------------- a minimal example package (test only, never shipped)

test("a minimal package: nothing of it exists until a valid licence names it; then its route, hook, menu and wizard kind do; when the licence lapses they vanish again", async () => {
  const { ADDONS } = await import("../addons/index.ts");
  const eng = await import("../wizards/engine.ts");
  lic.setTestLicenseKey(PUB);
  let inited = 0;
  const example = {
    id: "example", name: "範例包", version: "0.0.1", requires: ["example"], adds: ["only for the test"],
    init: () => { inited++; },
    menus: { settingsTabs: [{ id: "ex", icon: "plug", labelKey: "tabAddon", roles: ["admin"], group: "admin", action: { kind: "settings", tab: "ex" } }] },
    routes: ({ seg, out }) => (seg[0] === "example" ? out({ hello: true }) : null),
    adminRoutes: ({ seg, out }) => (seg[0] === "example-admin" ? out({ hello: "admin" }) : null),
    hooks: { "example": async () => new Response("{}", { status: 200 }) },
    wizardKinds: [{ id: "example-kind", label: "範例", prepare: () => ({ skip: "x" }), finish: () => ({ items: [] }) }],
    allowsMcpServer: (n) => n === "example_srv",
    sessionExtensions: () => [{ name: "example-ext", hidden: true, factory: () => {} }],
  };
  ADDONS.push(example);
  try {
    const admin = acc.listUsers().find((u) => u.role === "admin");
    const member = acc.listUsers().find((u) => u.role === "member");
    const call = async (u, path) => handle(new Request(`http://x/api/tg/${path}`, { headers: { "x-tg-uid": u.id } }), path.split("/")).then((r) => r.status);
    // no licence file
    assert.equal(reg.addonViews()[0].active, false); assert.equal(reg.addonViews()[0].reason, "missing");
    assert.equal(await call(member, "example"), 404); assert.equal(inited, 0, "init never runs without a licence");
    assert.equal(eng.getWizard("example-kind"), undefined);
    // a licence for another feature
    const file = join(dir, "lic.json"); process.env.TIGERAI_LICENSE_FILE = file;
    writeFileSync(file, issue({ features: ["something-else"] }));
    assert.equal(reg.addonViews()[0].reason, "feature_missing"); assert.equal(await call(member, "example"), 404);
    // the right licence
    writeFileSync(file, issue({ features: ["example"] }));
    assert.equal(await call(member, "example"), 200); assert.equal(await call(admin, "admin/example-admin"), 200); assert.equal(await call(member, "admin/example-admin"), 403);
    assert.equal(inited, 1); await call(member, "example"); assert.equal(inited, 1, "init runs once");
    assert.ok(eng.getWizard("example-kind"));
    assert.equal((await reg.addonHook("example", new Request("http://x"))).status, 200);
    assert.equal(reg.addonAllowsMcpServer("example_srv"), true); assert.equal(reg.addonSessionExtensions({ sessionId: "s", cwd: "/" }).length, 1);
    assert.deepEqual(reg.addonViews()[0].menus.settingsTabs.map((t) => t.id), ["ex"]);
    // expired
    writeFileSync(file, issue({ features: ["example"], expires: "2020-01-01" }));
    assert.equal(reg.addonViews()[0].reason, "expired"); assert.equal(await call(member, "example"), 404);
    assert.equal((await reg.addonHook("example", new Request("http://x"))).status, 404);
    assert.deepEqual(reg.addonViews()[0].menus, {});
  } finally { ADDONS.splice(ADDONS.indexOf(example), 1); lic.setTestLicenseKey(null); delete process.env.TIGERAI_LICENSE_FILE; }
});
