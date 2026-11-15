// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 離職與交接: the one leave action, the successor's read-only access, key retention (decisions 5, 7, 11, 12, 13).
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-org-p1c.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "tg-orgp1c-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const ul = await import("../userlog/service.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const keys = await import("../provider/leaver-keys.ts");
const ho = await import("../org/handover.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const lin = mk("lin@example.com", "Lin");        // the leaver (林小華)
const chen = mk("chen@example.com", "Chen");     // the successor (陳大明)
const wang = mk("wang@example.com", "Wang");
const eve = mk("eve@example.com", "Eve");
const fin = acc.createGroup(admin.id, { name: "Finance" });
acc.setMembership(admin.id, fin.id, lin.id, true);
acc.setMembership(admin.id, fin.id, wang.id, true);

async function call(user, method, path, body) {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  const req = new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await handle(req, segs);
  return { status: res.status, json: await res.json() };
}
const audits = (a) => getDb().prepare("SELECT * FROM audit WHERE action=?").all(a);

// what Lin owns
const room1 = (await call(lin, "POST", "rooms", { name: "月結專案", memberIds: [wang.id] })).json.room.id;
const room2 = (await call(lin, "POST", "rooms", { name: "週會", memberIds: [wang.id] })).json.room.id;
getDb().prepare("INSERT INTO wizard_settings (room_id,key,enabled,at_time,weekday,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)").run(room1, "daily", 1, "09:00", null, lin.id, Date.now());
getDb().prepare("INSERT INTO personal_agents (id,owner_id,name,description,system_prompt,shared,enabled,created_at) VALUES ('pa1',?,'帳務助手','','x',0,1,?)").run(lin.id, Date.now());
const a1 = (await call(wang, "POST", "assignments", { title: "請 Lin 做對帳", assigneeId: lin.id })).json.assignment.id; // Lin is the assignee
const a2 = (await call(lin, "POST", "assignments", { title: "Lin 開給 Wang", assigneeId: wang.id })).json.assignment.id; // Lin is the applicant
const keyDir = join(process.env.TIGERAI_DATA_DIR, "personal-models", lin.id);
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, "connections.json"), JSON.stringify({ connections: [{ id: "tgp-1", name: "mine", baseUrl: "http://x/v1", models: ["m"], enabled: true }] }));
writeFileSync(join(keyDir, "key-tgp-1"), "SECRET-KEY-VALUE");
registerOwner("s-lin-1", lin.id, null, "chat", null);
const metas = new Map([["s-lin-1", { id: "s-lin-1", title: "Lin 的對話", modified: 1000 }]]);
const deps = { catalog: async () => metas, messages: async () => [{ role: "user", content: "hi", timestamp: 1 }] };

test("owning things requires a successor; the inventory lists what there is", async () => {
  assert.equal((await call(wang, "GET", `admin/users/${lin.id}/inventory`)).status, 403);
  const inv = (await call(admin, "GET", `admin/users/${lin.id}/inventory`)).json.inventory;
  assert.equal(inv.channels.length, 2); assert.equal(inv.channels.find((c) => c.id === room1).schedules, 1);
  assert.equal(inv.agents.length, 1); assert.equal(inv.assignments.length, 2); assert.equal(inv.conversations, 1);
  const r = await call(admin, "POST", `admin/users/${lin.id}/leave`, {});
  assert.equal(r.status, 409); assert.equal(r.json.code, "successor_required");
  assert.equal(acc.userById(lin.id).status, "active", "nothing happened");
  assert.equal((await call(admin, "POST", `admin/users/${lin.id}/leave`, { successorId: lin.id })).status, 400);
  assert.equal((await call(wang, "POST", `admin/users/${lin.id}/leave`, { successorId: chen.id })).status, 403);
});

test("handover: channels, roles, schedules (kept off), per-row orders; units kept; keys off at once", async () => {
  const r = await call(admin, "POST", `admin/users/${lin.id}/leave`, { successorId: chen.id, channels: { [room2]: "admin" }, assignments: { [a2]: "keep" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const db = getDb();
  assert.equal(acc.userById(lin.id).status, "disabled");
  assert.equal(db.prepare("SELECT owner_id FROM rooms WHERE id=?").get(room1).owner_id, chen.id);
  assert.equal(db.prepare("SELECT owner_id FROM rooms WHERE id=?").get(room2).owner_id, admin.id, "nobody decided: the administrator (decision 13)");
  const members = db.prepare("SELECT user_id FROM room_members WHERE room_id=?").all(room1).map((x) => x.user_id).sort();
  assert.deepEqual(members, [chen.id, lin.id, wang.id].sort(), "members unchanged; the new owner is added only because an owner must be able to open it");
  assert.equal(db.prepare("SELECT enabled FROM wizard_settings WHERE room_id=?").get(room1).enabled, 0, "schedules come along but stay off");
  assert.equal(db.prepare("SELECT owner_id FROM personal_agents WHERE id='pa1'").get().owner_id, chen.id);
  assert.equal(db.prepare("SELECT assignee_id FROM assignments WHERE id=?").get(a1).assignee_id, chen.id);
  assert.equal(db.prepare("SELECT applicant_id FROM assignments WHERE id=?").get(a2).applicant_id, lin.id, "kept row stays");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id=?").get(lin.id).n, 1, "unit links stay");
  assert.equal(db.prepare("SELECT left_at FROM users WHERE id=?").get(lin.id).left_at > 0, true);
  const doc = JSON.parse(readFileSync(join(keyDir, "connections.json"), "utf8"));
  assert.equal(doc.connections[0].enabled, false, "personal keys disabled immediately");
  assert.equal(existsSync(join(keyDir, "key-tgp-1")), true, "the key file is still there for 30 days");
  const a = audits("member.handover"); assert.equal(a.length, 1);
  assert.equal(audits("member.handover_room").some((x) => x.extra.includes("admin_fallback")), true);
  assert.equal(JSON.stringify(db.prepare("SELECT extra FROM audit").all()).includes("SECRET-KEY-VALUE"), false, "no secret in the audit");
  assert.equal((await call(admin, "POST", `admin/users/${lin.id}/leave`, { successorId: chen.id })).status, 409, "already left");
});

test("the successor reads the leaver's conversations read-only and every view is audited; nobody else gets in", async () => {
  const V = (u) => ({ id: u.id, role: u.role });
  assert.deepEqual((await ul.listMembers(V(chen), deps)).map((m) => m.name), ["Lin"]);
  assert.equal(ul.mayUse(V(chen)), true);
  const list = await ul.listConversations(V(chen), lin.id, deps);
  assert.equal(list.conversations.length, 1);
  const msgs = await ul.readConversation(V(chen), lin.id, "s-lin-1", deps);
  assert.equal(msgs.messages.length, 1);
  assert.equal(audits("userlog.view").some((x) => x.actor_id === chen.id && x.extra.includes("handover")), true);
  assert.equal(audits("userlog.list").some((x) => x.actor_id === chen.id && x.extra.includes("handover")), true);
  await assert.rejects(ul.listConversations(V(eve), lin.id, deps), (e) => e.status === 403);
  await assert.rejects(ul.listConversations(V(chen), wang.id, deps), (e) => e.status === 403, "only the person they took over from");
  // read-only: there is no route that writes or deletes
  assert.equal((await call(chen, "POST", `userlog/member/${lin.id}/s-lin-1`, { text: "x" })).status, 404);
  assert.equal((await call(chen, "DELETE", `userlog/member/${lin.id}/s-lin-1`)).status, 404);
  assert.equal(ul.viewReason(V(chen), lin.id), "handover");
});

test("30 days later the key files go; nothing else; re-enabling inside 30 days restores the keys and ends the successor's access", async () => {
  assert.deepEqual(keys.purgeDueKeys(Date.now() + 29 * 86400_000), []);
  assert.equal(existsSync(join(keyDir, "key-tgp-1")), true, "day 29: still there");
  // a second leaver to test the restore path
  const pat = mk("pat@example.com", "Pat");
  const pk = join(process.env.TIGERAI_DATA_DIR, "personal-models", pat.id);
  mkdirSync(pk, { recursive: true });
  writeFileSync(join(pk, "connections.json"), JSON.stringify({ connections: [{ id: "tgp-2", name: "p", baseUrl: "http://x/v1", models: ["m"], enabled: true }] }));
  writeFileSync(join(pk, "key-tgp-2"), "PAT-KEY");
  assert.equal((await call(admin, "POST", `admin/users/${pat.id}/leave`, { successorId: chen.id })).status, 200);
  assert.equal(JSON.parse(readFileSync(join(pk, "connections.json"), "utf8")).connections[0].enabled, false);
  assert.equal((await call(admin, "PATCH", `admin/users/${pat.id}`, { status: "active" })).status, 200);
  assert.equal(JSON.parse(readFileSync(join(pk, "connections.json"), "utf8")).connections[0].enabled, true, "re-enable restores");
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM handover_reads WHERE leaver_id=?").get(pat.id).n, 0, "the successor's read access ends when the person is back");
  assert.equal(ho.sweepLeaverKeys(Date.now() + 31 * 86400_000).includes(lin.id), true);
  assert.equal(existsSync(join(keyDir, "key-tgp-1")), false, "day 31: key file deleted");
  assert.equal(existsSync(join(keyDir, "connections.json")), true, "everything else is kept");
  assert.equal(audits("member.keys_purged").length, 1);
  assert.equal(ho.sweepLeaverKeys(Date.now() + 40 * 86400_000).length, 0, "once only");
  // the person comes back after the keys are gone: connections stay off, the audit says the keys are gone
  assert.equal((await call(admin, "PATCH", `admin/users/${lin.id}`, { status: "active" })).status, 200);
  assert.equal(JSON.parse(readFileSync(join(keyDir, "connections.json"), "utf8")).connections[0].enabled, false);
  assert.equal(audits("member.rejoin").some((x) => x.extra.includes("keys_gone")), true);
});

test("a person who owns nothing leaves without a successor; units stay", async () => {
  const solo = mk("solo@example.com", "Solo");
  acc.setMembership(admin.id, fin.id, solo.id, true);
  const r = await call(admin, "POST", `admin/users/${solo.id}/leave`, {});
  assert.equal(r.status, 200);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id=?").get(solo.id).n, 1);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM handover_reads WHERE leaver_id=?").get(solo.id).n, 0);
  // the last administrator cannot leave, and nothing moves
  const gone = await call(admin, "POST", `admin/users/${admin.id}/leave`, {});
  assert.equal(gone.status, 409);
  assert.equal(acc.userById(admin.id).status, "active");
  // someone who left cannot be newly placed in a unit
  const other = acc.createGroup(admin.id, { name: "Other" });
  assert.throws(() => acc.setMembership(admin.id, other.id, solo.id, true), (e) => e.code === "left_user");
});
