// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: idle sign-out. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-idle.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-idle-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const idle = await import("../accounts/idle.ts");
const { getDb } = await import("../db/store.ts");
const PW = "Test-Pass-12345!";
const admin = acc.createUser(null, { email: "a@x.example", name: "老師", role: "admin", password: PW, mustChange: false }).user;
const amy = acc.createUser(null, { email: "amy@x.example", name: "Amy", password: PW, mustChange: false }).user;
async function call(user, method, path, body) {
  const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/"));
  return { status: res.status, json: JSON.parse(await res.text()) };
}

test("default is ON at 30 minutes; me tells the page", async () => {
  assert.equal(idle.idleMinutes(), 30);
  assert.equal((await call(amy, "GET", "me")).json.idleMinutes, 30);
});

test("a person's first request starts their window; input inside the window keeps it; silence past it ends the session server-side", () => {
  const t0 = 1_000_000;
  assert.equal(idle.expireIfIdle(amy.id, t0), false);
  assert.equal(idle.expireIfIdle(amy.id, t0 + 29 * 60_000), false);
  idle.recordInput(amy.id, t0 + 29 * 60_000);
  assert.equal(idle.expireIfIdle(amy.id, t0 + 58 * 60_000), false, "input at minute 29 renewed the window");
  const before = acc.userById(amy.id).token_version;
  assert.equal(idle.expireIfIdle(amy.id, t0 + 29 * 60_000 + 31 * 60_000), true);
  assert.equal(acc.userById(amy.id).token_version, before + 1, "the cookie is dead everywhere");
  assert.ok(getDb().prepare("SELECT 1 FROM audit WHERE action='auth.idle_logout' AND actor_id=?").get(amy.id));
  assert.equal(idle.expireIfIdle(amy.id, t0 + 200 * 60_000), false, "a new sign-in starts a new window (no stale last_input)");
});

test("the administrator sets the minutes or turns it off; a member cannot; bad values are refused", async () => {
  assert.equal((await call(amy, "PUT", "admin/idle", { minutes: 5 })).status, 403);
  assert.equal((await call(admin, "PUT", "admin/idle", { minutes: 1 })).json.minutes, 1);
  idle.recordInput(amy.id, 50_000_000);
  assert.equal(idle.expireIfIdle(amy.id, 50_000_000), false);
  assert.equal(idle.expireIfIdle(amy.id, 50_000_000 + 61_000), true, "one minute is enough when the administrator says so");
  assert.equal((await call(admin, "PUT", "admin/idle", { minutes: -3 })).status, 400);
  assert.equal((await call(admin, "PUT", "admin/idle", { minutes: 0 })).json.minutes, 0);
  idle.recordInput(amy.id, 1);
  assert.equal(idle.expireIfIdle(amy.id, 99_000_000_000), false, "off means off");
});

test("the activity route records input for the caller only", async () => {
  assert.equal((await call(amy, "POST", "activity", {})).status, 200);
  assert.ok(getDb().prepare("SELECT last_input FROM user_activity WHERE user_id=?").get(amy.id).last_input > 0);
});
