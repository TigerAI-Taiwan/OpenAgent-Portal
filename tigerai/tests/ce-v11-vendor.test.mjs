// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: the maintenance (虎智) account. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-vendor.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-vendor-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_VENDOR_EMAIL = "vendor@tiger.example";
process.env.TIGERAI_VENDOR_PASSWORD = "Vendor-Pass-12345!";
process.env.TIGERAI_ADMIN_EMAIL = "teacher@school.example";
process.env.TIGERAI_ADMIN_PASSWORD = "Teacher-Pass-12345!";
process.env.TIGERAI_ADMIN_MUST_CHANGE = "1";
process.env.TIGERAI_VENDOR_MUST_CHANGE = "0";
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const { vendorAllows } = await import("../accounts/vendor-policy.ts");
const { bootstrapVendor, isVendor } = await import("../accounts/vendor.ts");
acc.bootstrapAdmin();
bootstrapVendor();
const admin = getDb().prepare("SELECT * FROM users WHERE email='teacher@school.example'").get();
const vendor = getDb().prepare("SELECT * FROM users WHERE email='vendor@tiger.example'").get();
const stu = acc.createUser(null, { email: "s@x.example", name: "B1-資工二-陳小明", password: "Test-Pass-12345!", mustChange: false }).user;

async function call(user, method, path, body) {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), segs);
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) };
}

test("install config: the school admin comes from TIGERAI_ADMIN_EMAIL and must change the password; the vendor is a separate flagged account", () => {
  assert.equal(admin.must_change_pw, 1);
  assert.equal(admin.is_vendor, 0);
  assert.equal(isVendor(vendor.id), true);
  assert.equal(vendor.role, "admin");
  assert.equal(vendor.must_change_pw, 0); // password given by the installer in the env
  bootstrapVendor(); // idempotent
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE is_vendor=1").get().n, 1);
});

test("the allow-list is default deny: system pages yes; conversations, user log, accounts, keys, audit, org, channels no", () => {
  for (const p of ["/api/tg/me", "/api/tg/admin/system", "/api/tg/admin/models/connections", "/api/tg/admin/web/settings", "/api/tg/admin/connectors"]) assert.equal(vendorAllows("GET", p), true, p);
  for (const p of ["/api/tg/userlog", "/api/tg/userlog/member/u1/s1", "/api/tg/admin/users", "/api/tg/admin/users/u1/reset", "/api/tg/admin/audit", "/api/tg/admin/n8n/keys", "/api/tg/admin/org/import", "/api/tg/rooms", "/api/tg/admin/workorders/x/decide", "/api/sessions", "/api/sessions/abc", "/api/agent/abc", "/api/files/home/x", "/api/tg/knowledge", "/api/tg/personal-models"]) assert.equal(vendorAllows("GET", p), false, p);
});

test("the maintenance account cannot read conversations, the user log, accounts, or mint keys through the API; the denial is not a 500", async () => {
  for (const [m, p, b] of [["GET", "userlog"], ["GET", `userlog/member/${stu.id}`], ["GET", "admin/users"], ["POST", "admin/n8n/keys", { name: "k" }], ["GET", "admin/audit"], ["PATCH", `admin/users/${vendor.id}`, { role: "admin" }], ["GET", "rooms"], ["GET", "admin/org/export"]]) {
    const r = await call(vendor, m, p, b);
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  assert.equal((await call(vendor, "GET", "admin/system")).status, 200);
  const sys = await call(vendor, "GET", "admin/system");
  assert.ok(sys.json.version && sys.json.counts, "status shows version and counts");
  assert.ok(!JSON.stringify(sys.json).includes("s@x.example"), "status names nobody");
});

test("the customer admin can disable and enable it, nothing else; it is hidden from pickers and does not count as an administrator", async () => {
  const list = await call(admin, "GET", "admin/users");
  assert.equal(list.json.users.find((u) => u.id === vendor.id).isVendor, true);
  assert.equal((await call(admin, "GET", "users")).json.users.some((u) => u.id === vendor.id), false);
  assert.equal((await call(admin, "POST", `admin/users/${vendor.id}/reset`, {})).status, 403);
  assert.equal((await call(admin, "PATCH", `admin/users/${vendor.id}`, { role: "member" })).status, 403);
  assert.equal((await call(admin, "PATCH", `admin/users/${vendor.id}`, { status: "disabled" })).status, 200);
  assert.equal(acc.authenticate("vendor@tiger.example", "Vendor-Pass-12345!"), null);
  assert.equal((await call(admin, "PATCH", `admin/users/${vendor.id}`, { status: "active" })).status, 200);
  assert.ok(acc.authenticate("vendor@tiger.example", "Vendor-Pass-12345!"));
  // the customer's own last administrator cannot be disabled just because a vendor exists
  await assert.rejects(async () => acc.updateUser(admin.id, admin.id, { status: "disabled" }), (e) => e.code === "last_admin");
});

test("the vendor cannot promote itself or others, and its sign-in details are its own", async () => {
  assert.equal((await call(vendor, "PATCH", `admin/users/${stu.id}`, { role: "admin" })).status, 403);
  assert.equal((await call(vendor, "POST", "account/password", { current: "Vendor-Pass-12345!", next: "Another-Pass-12345!" })).status, 200);
});

test("the vendor's refused attempts and its changes are in the audit trail", () => {
  const rows = getDb().prepare("SELECT action FROM audit").all().map((r) => r.action);
  assert.ok(rows.includes("vendor.create"));
  assert.ok(rows.includes("user.password_change"));
});
