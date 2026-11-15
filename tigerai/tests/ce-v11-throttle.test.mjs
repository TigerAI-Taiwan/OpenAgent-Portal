// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: throttles per account / per class, global ceilings far above a class. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-throttle.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-thr-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_REGISTER_PER_HOUR = "30";
process.env.TIGERAI_LOGIN_GLOBAL_FAILS = "8";
process.env.TIGERAI_REGISTER_WRONG_GLOBAL = "6";
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const reg = await import("../register/service.ts");
const T = await import("../accounts/throttle.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("t@x.example", "老師", "admin");
const students = Array.from({ length: 12 }, (_, i) => mk(`s${i}@x.example`, `S${i}`));
const login = (email, password) => handle(new Request("http://x/api/tg/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), ["login"]);
const post = (path, data) => handle(new Request(`http://x/api/tg/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), path.split("/"));

test("sign-in: one student's typos make only that account wait; the others in the class sign in at once", async () => {
  T.resetThrottles();
  assert.equal((await login("s0@x.example", "wrong-pass-1")).status, 401);
  assert.equal((await login("s0@x.example", PW)).status, 429, "the same account waits (even with the right password: no oracle)");
  assert.equal((await login("s1@x.example", PW)).status, 200, "a classmate is not blocked");
  assert.equal((await login("s2@x.example", PW)).status, 200);
});

test("sign-in: the global ceiling (rotating accounts) is far above one class and does stop a spray", async () => {
  T.resetThrottles();
  for (let i = 0; i < 5; i++) assert.equal((await login(`s${i}@x.example`, "wrong-pass-1")).status, 401, "five different people mistyping is fine");
  assert.equal((await login("s5@x.example", PW)).status, 200);
  for (let i = 5; i < 8; i++) await login(`nobody${i}@x.example`, "x");
  assert.equal((await login("s6@x.example", PW)).status, 429, "8 failures over the whole server: everybody waits");
});

test("registration: a wrong passphrase waits per account, not per class or server; the per-class hourly cap is per class", async () => {
  T.resetThrottles();
  reg.setRegistration(admin.id, { open: true });
  const a = acc.createGroup(admin.id, { name: "甲" }), b = acc.createGroup(admin.id, { name: "乙" });
  const A = { id: admin.id, role: "admin" };
  const ca = reg.setPhrase(A, a.id, "course alpha 2026"), cb = reg.setPhrase(A, b.id, "course beta 2026");
  const form = (n, code) => ({ name: n, email: `${n}@r.example`, password: "Student-Pass-1", code });
  assert.equal((await post("register", form("x1", "nope nope"))).status, 403);
  assert.equal((await post("register", form("x1", "course alpha 2026"))).status, 429, "x1 waits");
  assert.equal((await post("register", form("x2", "course alpha 2026"))).status, 200, "x2 in the same class registers at once");
  assert.equal((await post("register", form("x3", "course beta 2026"))).status, 200);
  for (const w of ["a1", "a2", "a3", "a4"]) assert.equal((await post("register", form(w, "wrong wrong"))).status, 403);
  assert.equal((await post("register", form("a5", "wrong wrong"))).status, 403);
  assert.equal((await post("register", form("a6", "wrong wrong"))).status, 429, "6 wrong passphrases over the server: the global ceiling");
  void ca; void cb;
});

test("the primitives: keys are independent, waiting doubles to a cap, a window forgets", () => {
  const k = new T.KeyedThrottle();
  k.fail("a", 0); k.fail("a", 1); assert.throws(() => k.check("a", 2), (e) => e instanceof T.Blocked && e.retryAfter >= 2);
  assert.doesNotThrow(() => k.check("b", 2)); assert.doesNotThrow(() => k.check("a", 400_000));
  const w = new T.WindowCeiling(1000); w.add(0); w.add(10); assert.throws(() => w.check(2, 20)); assert.doesNotThrow(() => w.check(2, 1100));
});
