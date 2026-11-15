// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: 上架 of n8n workflows is the only reviewed n8n step. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-publish.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-pub-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const N = await import("../n8n/service.ts");
const { getDb } = await import("../db/store.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("a@x.example", "老師", "admin");
const amy = mk("amy@x.example", "Amy");
const ben = mk("ben@x.example", "Ben");
const g1 = acc.createGroup(admin.id, { name: "甲班" }); const g2 = acc.createGroup(admin.id, { name: "乙班" });
acc.setMembership(admin.id, g1.id, amy.id, true); acc.setMembership(admin.id, g2.id, ben.id, true);
async function call(user, method, path, body) {
  const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/"));
  return { status: res.status, json: JSON.parse(await res.text()) };
}
const draft = { name: "weekly", label: "週報整理", description: "把本週重點整理成週報,輸入 text", url: "http://127.0.0.1:5999/webhook/abc" };

test("a member's publish is a work order, not an app yet; review is always on and nobody sees it before approval", async () => {
  const r = await call(amy, "POST", "n8n/publish", draft);
  assert.equal(r.status, 201); assert.equal(r.json.published, false);
  assert.equal(N.appsFor({ id: ben.id, role: "member" }).length, 0);
  assert.equal(N.appsFor({ id: amy.id, role: "member" }).length, 0);
  assert.equal((await call(amy, "POST", "n8n/publish", draft)).status, 409, "no duplicate request");
  const order = getDb().prepare("SELECT * FROM work_orders WHERE kind='n8n_publish'").get();
  assert.equal(order.applicant_id, amy.id);
  assert.equal((await call(amy, "POST", `admin/workorders/${order.id}/decide`, { approve: true })).status, 403, "a member never decides");
  assert.equal((await call(admin, "POST", `admin/workorders/${order.id}/decide`, { approve: true })).status, 200);
  assert.deepEqual(N.appsFor({ id: ben.id, role: "member" }).map((a) => a.name), ["weekly"], "default 上架後誰看得到 = 全公司");
});

test("the administrator's own publish passes directly and is audited", async () => {
  const r = await call(admin, "POST", "n8n/publish", { ...draft, name: "adminhook", groupIds: ["*"] });
  assert.equal(r.status, 201); assert.equal(r.json.published, true);
  assert.ok(getDb().prepare("SELECT 1 FROM audit WHERE action='n8n.publish' AND actor_id=?").get(admin.id));
});

test("誰可以上架: 只有管理員 refuses a member; 指定部門 allows only those departments", async () => {
  assert.equal((await call(admin, "PUT", "admin/n8n/publish-policy", { who: "admin" })).status, 200);
  assert.equal((await call(amy, "POST", "n8n/publish", { ...draft, name: "x1" })).status, 403);
  await call(admin, "PUT", "admin/n8n/publish-policy", { who: "groups", whoGroupIds: [g2.id] });
  assert.equal((await call(amy, "POST", "n8n/publish", { ...draft, name: "x2" })).status, 403);
  assert.equal((await call(ben, "POST", "n8n/publish", { ...draft, name: "x3" })).status, 201);
});

test("上架後誰看得到: 上架者的部門 ignores what the page sends; 自己勾 needs a choice", async () => {
  await call(admin, "PUT", "admin/n8n/publish-policy", { who: "all", visibility: "own" });
  const o = await call(amy, "POST", "n8n/publish", { ...draft, name: "ownonly", groupIds: ["*"] });
  assert.equal(o.status, 201);
  const order = getDb().prepare("SELECT * FROM work_orders WHERE kind='n8n_publish' AND payload LIKE '%ownonly%'").get();
  assert.deepEqual(JSON.parse(order.payload).groupIds, [g1.id]);
  await call(admin, "PUT", "admin/n8n/publish-policy", { visibility: "choose" });
  assert.equal((await call(amy, "POST", "n8n/publish", { ...draft, name: "nochoice" })).json.code, "no_groups");
});

test("a member cannot change the policy or read the admin routes; the review switch does not exist", async () => {
  assert.equal((await call(amy, "PUT", "admin/n8n/publish-policy", { who: "all" })).status, 403);
  const p = (await call(admin, "GET", "admin/n8n/publish-policy")).json.policy;
  assert.deepEqual(Object.keys(p).sort(), ["visibility", "who", "whoGroupIds"]);
});
