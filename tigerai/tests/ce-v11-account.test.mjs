// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: own-account edit, repeatable names. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-account.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-acct-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const { parseMentions } = await import("../rooms/service.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("t@school.example", "老師", "admin");
const amy = mk("amy@x.example", "B119-資工二-陳小明");
const amy2 = mk("amy2@x.example", "B119-資工二-陳小明"); // the same name again is fine
async function call(user, path, body) {
  const res = await handle(new Request(`http://x/api/tg/${path}`, { method: "POST", headers: { "x-tg-uid": user.id, "content-type": "application/json" }, body: JSON.stringify(body) }), path.split("/"));
  return { status: res.status, json: JSON.parse(await res.text()) };
}

test("names may repeat and contain spaces; the e-mail stays the unique login", () => {
  assert.equal(amy.name, amy2.name);
  assert.ok(acc.createUser(null, { email: "sp@x.example", name: "Amy Lin", password: PW }).user);
  assert.throws(() => acc.createUser(null, { email: "AMY@x.example", name: "Other", password: PW }), (e) => e.code === "exists");
  assert.throws(() => acc.createUser(null, { email: "z@x.example", name: "a@b", password: PW }), (e) => e.code === "bad_name");
});

test("@mentions find a name with spaces and reach both people who share a name", () => {
  const members = [{ id: "1", name: "Amy Lin" }, { id: "2", name: "Amy" }, { id: "3", name: "A-1-X" }, { id: "4", name: "A-1-X" }];
  assert.deepEqual(parseMentions("hi @Amy Lin, ok?", members).sort(), ["1", "2"]); // "@Amy" followed by a space also reaches Amy: ambiguity is mentioned, never missed
  assert.deepEqual(parseMentions("cc ＠A-1-X 看一下", members).sort(), ["3", "4"]);
  assert.deepEqual(parseMentions("mail me at amy@x.example", members), []);
});

test("anyone edits their own name; the admin too", async () => {
  const r = await call(admin, "account/profile", { name: "王老師" });
  assert.equal(r.status, 200);
  assert.equal(getDb().prepare("SELECT name FROM users WHERE id=?").get(admin.id).name, "王老師");
  assert.equal((await call(amy, "account/profile", { name: "   " })).status, 400);
});

test("changing the e-mail needs the current password and a free address, and is audited", async () => {
  assert.equal((await call(amy, "account/profile", { email: "new@x.example" })).json.code, "bad_current");
  assert.equal((await call(amy, "account/profile", { email: "new@x.example", current: "wrong-wrong-1" })).status, 403);
  assert.equal((await call(amy, "account/profile", { email: "amy2@x.example", current: PW })).status, 409);
  assert.equal((await call(amy, "account/profile", { email: "nope", current: PW })).status, 400);
  const ok = await call(amy, "account/profile", { email: "New@X.example", current: PW });
  assert.equal(ok.status, 200); assert.equal(ok.json.email, "new@x.example");
  assert.ok(acc.authenticate("new@x.example", PW)); assert.equal(acc.authenticate("amy@x.example", PW), null);
  assert.ok(getDb().prepare("SELECT 1 FROM audit WHERE action='account.profile' AND actor_id=?").get(amy.id));
});

test("@AI follows the old Portal: @AI / ＠AI / @助理 / @agent call the model; an e-mail or a plain @name does not; a sentence about analysis stays plain Q&A", async () => {
  const { mentionsAi } = await import("../rooms/ai.ts");
  for (const t of ["@AI 你好", "請問 ＠ai 幾點", "@助理 幫我整理", "x @agent", "@AI用監督看最近三天"]) assert.equal(mentionsAi(t), true, t);
  for (const t of ["mail me at x@ai.example", "@Amy 看一下", "@AIX", "no mention"]) assert.equal(mentionsAi(t), false, t);
  const src = (await import("node:fs")).readFileSync(new URL("../api/router.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("handleAdhocMention"), "the router no longer turns a chat sentence into a 訊息分析 run");
});
