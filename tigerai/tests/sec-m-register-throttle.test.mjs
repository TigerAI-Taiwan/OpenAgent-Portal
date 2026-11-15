// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Security review M1/M2: the registration throttle is keyed by account AND client, one person cannot lock out a class that has the right
// passphrase, and the account + its request are created in one transaction.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-m-register-throttle.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-sec-reg-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_REGISTER_WRONG_GLOBAL = "5";
const acc = await import("../accounts/service.ts");
const reg = await import("../register/service.ts");
const { handle } = await import("../api/router.ts");
const { getDb } = await import("../db/store.ts");
const admin = acc.createUser(null, { email: "a@example.com", name: "Admin", role: "admin", password: "Test-Pass-12345!", mustChange: false }).user;
const klass = acc.createGroup(admin.id, { name: "ClassA" });
reg.setRegistration(admin.id, { open: true });
const phrase = reg.setPhrase({ id: admin.id, role: "admin" }, klass.id, "AI Agent 甲班 2026秋").code;
const post = (data, xff) => handle(new Request("http://x/api/tg/register", { method: "POST", headers: { "content-type": "application/json", ...(xff ? { "x-forwarded-for": xff, "user-agent": "t" } : {}) }, body: JSON.stringify(data) }), ["register"]);
const form = (n, code) => ({ name: n, email: `${n}@example.com`, password: "Student-Pass-1", code });

test("the same client changing its e-mail on every guess still waits (client key); another client does not", async () => {
  reg.resetRegisterThrottle();
  assert.equal((await post(form("g1", "wrong one"), "203.0.113.5")).status, 403);
  const r = await post(form("g2", "wrong two"), "203.0.113.5"); // new e-mail, same client
  assert.equal(r.status, 429, "the second guess from the same client is refused");
  assert.equal((await post(form("g3", "wrong three"), "203.0.113.6")).status, 403, "another client is not slowed");
});

test("flooding wrong passphrases (global ceiling) never stops a person who has the right one", async () => {
  reg.resetRegisterThrottle();
  for (let i = 0; i < 12; i++) await post(form(`flood${i}`, `nope ${i}`), `198.51.100.${i}`);
  assert.equal((await post(form("late", "another wrong"), "198.51.100.99")).status, 429, "wrong passphrases are refused once the ceiling is reached");
  const ok = await post(form("student1", phrase), "192.0.2.1");
  assert.equal(ok.status, 200, "the right passphrase still works");
});

test("account + request + disabled state are one transaction: a failure leaves no account behind, and no active account without a request ever exists", async () => {
  reg.resetRegisterThrottle();
  const db = getDb();
  // make the request insert fail (after createUser has already run)
  db.exec("CREATE TRIGGER sec_fail_req BEFORE INSERT ON registration_requests BEGIN SELECT RAISE(ABORT, 'disk error'); END");
  const before = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const r = await post(form("halfway", phrase));
  assert.ok(r.status >= 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, before, "the user row was rolled back");
  assert.equal(db.prepare("SELECT 1 FROM users WHERE email='halfway@example.com'").get(), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM room_members rm JOIN users u ON u.id=rm.user_id WHERE u.email='halfway@example.com'").get().n, 0);
  db.exec("DROP TRIGGER sec_fail_req");
  assert.equal((await post(form("halfway", phrase))).status, 200, "and the same person can register afterwards");
  const u = db.prepare("SELECT status FROM users WHERE email='halfway@example.com'").get();
  assert.equal(u.status, "disabled", "waiting for approval");
  assert.ok(db.prepare("SELECT 1 FROM registration_requests r JOIN users u ON u.id=r.user_id WHERE u.email='halfway@example.com' AND r.status='pending'").get());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users u WHERE u.role='member' AND u.status='active' AND NOT EXISTS (SELECT 1 FROM registration_requests r WHERE r.user_id=u.id) AND u.email LIKE '%@example.com' AND u.email<>'a@example.com'").get().n, 0, "no active self-registered account without a request");
});

test("passphrase minimum is 8 characters (a CJK character counts as 1) for new or changed ones; existing ones keep working", () => {
  const A = { id: admin.id, role: "admin" };
  const k2 = acc.createGroup(admin.id, { name: "ClassB" });
  for (const bad of ["abcdefg", "甲班二〇二六秋", "ab cd ef g"]) assert.throws(() => reg.setPhrase(A, k2.id, bad), (e) => e.code === "bad_phrase", bad);
  assert.equal(reg.setPhrase(A, k2.id, "甲班二〇二六秋季").code.length >= 8, true);
  assert.ok(reg.setPhrase(A, k2.id, "abcdefgh"));
  // a phrase saved before the rule (4 characters) still signs people up
  getDb().prepare("UPDATE group_join_codes SET code='old1' WHERE group_id=?").run(k2.id);
  reg.resetRegisterThrottle();
  return post(form("legacy1", "old1"), "198.51.100.200").then((r) => assert.equal(r.status, 200));
});

test("a pending account is not in the company channel; approval adds it; a refused one never joins", async () => {
  const { ensureCompanyChannel } = await import("../rooms/unit-channel.ts");
  const db = getDb(); const ch = ensureCompanyChannel();
  const A = { id: admin.id, role: "admin" };
  const k = acc.createGroup(admin.id, { name: "ClassC" });
  const ph = reg.setPhrase(A, k.id, "ClassC workshop 2026").code;
  reg.resetRegisterThrottle();
  assert.equal((await post(form("pend1", ph), "198.51.100.210")).status, 200);
  assert.equal((await post(form("pend2", ph), "198.51.100.211")).status, 200);
  const id = (e) => db.prepare("SELECT id FROM users WHERE email=?").get(`${e}@example.com`).id;
  const inCh = (e) => !!db.prepare("SELECT 1 FROM room_members WHERE room_id=? AND user_id=?").get(ch, id(e));
  assert.equal(inCh("pend1"), false); assert.equal(inCh("pend2"), false);
  reg.approveRequest(A, id("pend1")); reg.rejectRequest(A, id("pend2"));
  assert.equal(inCh("pend1"), true); assert.equal(inCh("pend2"), false);
});
