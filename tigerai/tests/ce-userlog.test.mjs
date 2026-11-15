// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 使用者紀錄: scope, switch, audit, read-only, last-online throttle.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-userlog.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-userlog-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const acc = await import("../accounts/service.ts");
const ul = await import("../userlog/service.ts");
const { listAudit } = await import("../accounts/audit.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const { getDb } = await import("../db/store.ts");
const { relativeZh } = await import("../userlog/format.ts");

const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: "Test-Pass-12345!", mustChange: false }).user;
const admin = mk("a@example.com", "Admin", "admin");
const admin2 = mk("a2@example.com", "Admin2", "admin");
const head = mk("h@example.com", "Head");
const head2 = mk("h2@example.com", "Headtwo");
const stu = mk("s@example.com", "Student");
const subStu = mk("s2@example.com", "SubStudent");
const other = mk("o@example.com", "OtherDept");
const loner = mk("l@example.com", "Loner");
const dept = acc.createGroup(admin.id, { name: "DeptA" });
const sub = acc.createGroup(admin.id, { name: "DeptA-sub", parentId: dept.id });
const dept2 = acc.createGroup(admin.id, { name: "DeptB" });
acc.setMembership(admin.id, dept.id, head.id, true, true);
acc.setMembership(admin.id, dept.id, stu.id, true);
acc.setMembership(admin.id, sub.id, subStu.id, true);
acc.setMembership(admin.id, dept2.id, head2.id, true, true);
acc.setMembership(admin.id, dept2.id, other.id, true);
acc.setMembership(admin.id, dept.id, head2.id, true); // head2 is also in DeptA but heads another dept: still a head

const metas = new Map();
const sessions = new Map();
function conv(user, id, title, modified, kind = "chat", room = null) {
  registerOwner(id, user.id, null, kind, room);
  metas.set(id, { id, title, modified });
  sessions.set(id, [{ role: "user", content: "hi", timestamp: modified }, { role: "assistant", content: [{ type: "text", text: "yo" }], timestamp: modified + 1 }]);
}
conv(stu, "s-1", "作業一", 1_000);
conv(stu, "s-2", "作業二", 5_000);
conv(stu, "s-room", "channel", 9_000, "chat", "room1"); // a channel's conversation: never listed
conv(stu, "s-hook", "hook", 9_000, "hook"); // not a personal chat
conv(head, "h-1", "head private", 3_000);
conv(other, "o-1", "other dept", 4_000);
conv(subStu, "ss-1", "sub dept", 2_000);
conv(admin2, "ad-1", "admin2", 2_000);
const deps = { catalog: async () => metas, messages: async (id) => sessions.get(id) ?? null };
const V = (u) => ({ id: u.id, role: u.role });
const names = async (u) => (await ul.listMembers(V(u), deps)).map((m) => m.name).sort();
const refused = (p, code) => assert.rejects(p, (e) => e.status === 403 && (!code || e.code === code));

test("admin sees every non-admin (members and heads), never an administrator", async () => {
  assert.deepEqual(await names(admin), ["Head", "Headtwo", "Loner", "OtherDept", "Student", "SubStudent"]);
});

test("head sees only direct members of the department they head: not sub-departments, other heads, other departments, administrators", async () => {
  assert.deepEqual(await names(head), ["Student"]);
  assert.deepEqual(await names(head2), ["OtherDept"]);
  await refused(ul.listConversations(V(head), subStu.id, deps));
  await refused(ul.listConversations(V(head), other.id, deps));
  await refused(ul.listConversations(V(head), head2.id, deps));
  await refused(ul.listConversations(V(head), admin.id, deps));
  await refused(ul.readConversation(V(head), subStu.id, "ss-1", deps));
  await refused(ul.readConversation(V(head), head2.id, "h-1", deps));
});

test("a plain member (and a consultant-pack account, which is a plain member) is refused everywhere", async () => {
  for (const u of [stu, loner]) {
    await refused(ul.listMembers(V(u), deps), "forbidden");
    await refused(ul.listConversations(V(u), stu.id, deps));
    await refused(ul.readConversation(V(u), stu.id, "s-1", deps));
    assert.equal(ul.mayUse(V(u)), false);
  }
});

test("rows: department, conversation count (own non-channel chats only), latest time", async () => {
  const row = (await ul.listMembers(V(head), deps))[0];
  assert.deepEqual(row.departments, ["DeptA"]);
  assert.equal(row.conversations, 2);
  assert.equal(row.latestConversation, 5_000);
  const list = await ul.listConversations(V(head), stu.id, deps);
  assert.deepEqual(list.conversations.map((c) => c.id), ["s-2", "s-1"]);
});

test("a conversation must belong to that person and be a personal chat", async () => {
  await refused(ul.readConversation(V(head), stu.id, "h-1", deps)); // someone else's
  await refused(ul.readConversation(V(head), stu.id, "s-room", deps)); // a channel's
  await refused(ul.readConversation(V(head), stu.id, "s-hook", deps));
  await assert.rejects(ul.readConversation(V(admin), stu.id, "nope", deps), (e) => e.status === 403);
  const r = await ul.readConversation(V(head), stu.id, "s-1", deps);
  assert.equal(r.title, "作業一");
  assert.equal(r.messages.length, 2);
  assert.ok(r.messages.every((m) => typeof m.timestamp === "number"), "every message carries its time");
});

test("every view is audited: who, whose, which conversation; failures are not", async () => {
  const rows = listAudit({ action: "userlog.", limit: 50 });
  const v = rows.find((r) => r.action === "userlog.view" && JSON.parse(r.extra).sessionId === "s-1");
  assert.ok(v, "view audited");
  assert.equal(v.actor_id, head.id);
  assert.equal(JSON.parse(v.extra).userId, stu.id);
  assert.ok(v.ts > 0);
  assert.ok(rows.some((r) => r.action === "userlog.list" && r.actor_id === head.id));
  assert.equal(rows.filter((r) => r.action === "userlog.view").length, 1, "refused reads write nothing");
});

test("switch off: heads refused (list, view, tab), administrators unaffected; switching is audited", async () => {
  assert.equal(ul.headsCanView(), true, "default on");
  assert.equal(ul.mayUse(V(head)), true);
  ul.setHeadsCanView(admin.id, false);
  assert.equal(ul.mayUse(V(head)), false);
  await refused(ul.listMembers(V(head), deps), "userlog_off");
  await refused(ul.readConversation(V(head), stu.id, "s-1", deps), "userlog_off");
  assert.equal((await ul.listMembers(V(admin), deps)).length, 6);
  assert.ok(listAudit({ action: "userlog.setting" }).some((r) => r.actor_id === admin.id));
  ul.setHeadsCanView(admin.id, true);
  assert.deepEqual(await names(head), ["Student"]);
});

test("last online: written at most once a minute per person", () => {
  const t0 = 10_000_000;
  ul.touchActive(stu.id, t0);
  assert.equal(ul.lastSeen(stu.id), t0);
  ul.touchActive(stu.id, t0 + 30_000);
  assert.equal(ul.lastSeen(stu.id), t0, "within a minute: no write");
  ul.touchActive(stu.id, t0 + 61_000);
  assert.equal(ul.lastSeen(stu.id), t0 + 61_000);
  assert.equal(ul.lastSeen(loner.id), null);
});

test("read-only by construction: the router answers 404 to every non-GET on userlog (except the admin switch), the page passes no edit handlers", async () => {
  const router = readFileSync(new URL("../api/router.ts", import.meta.url), "utf8");
  const block = router.slice(router.indexOf('if (a === "userlog")'), router.indexOf('if (a === "admin")'));
  assert.ok(router.indexOf('if (a === "userlog")') < router.indexOf('if (a === "admin")'), "heads are members: the route must sit before the admin-only branch");
  assert.ok(!/method === "(POST|DELETE|PATCH)"/.test(block));
  assert.equal((block.match(/method === "PUT"/g) ?? []).length, 1, "only the switch writes");
  assert.ok(block.includes('actor.role !== "admin"'), "the switch is admin only");
  const page = readFileSync(new URL("../ui/UserLog.tsx", import.meta.url), "utf8");
  assert.ok(!/onFork|onEditContent|ChatInput|<textarea/.test(page));
});

test("the personal-connection secret never appears: the feature reads no key store", () => {
  for (const f of ["../userlog/service.ts", "../userlog/reader.ts"]) assert.ok(!/api[-_ ]?key|personal-conn/i.test(readFileSync(new URL(f, import.meta.url), "utf8")), f);
});

test("relative time wording", () => {
  const now = new Date(2026, 10, 15, 15, 0).getTime();
  assert.equal(relativeZh(null, now), "從未上線");
  assert.equal(relativeZh(now - 20_000, now), "剛剛");
  assert.equal(relativeZh(now - 3 * 60_000, now), "3 分鐘前");
  assert.equal(relativeZh(new Date(2026, 10, 15, 12, 0).getTime(), now), "3 小時前");
  assert.equal(relativeZh(new Date(2026, 10, 14, 9, 5).getTime(), now), "昨天 09:05");
  assert.equal(relativeZh(new Date(2026, 10, 12, 14, 5).getTime(), now), "11/12 14:05");
  assert.equal(relativeZh(new Date(2025, 10, 12, 14, 5).getTime(), now), "2025/11/12 14:05");
});

test("the proxy gate records the last online time of a signed-in request (and not of an anonymous one)", async () => {
  const { NextRequest } = await import("next/server");
  const ses = await import("../accounts/session.ts");
  const { gate } = await import("../adapter/gate.ts");
  const u = mk("g@example.com", "Gatey");
  const get = (cookie) => gate(new NextRequest("http://127.0.0.1:30161/api/tg/me", { headers: cookie ? { cookie } : {} }), false);
  assert.equal((await get(null)).status, 401);
  assert.equal(ul.lastSeen(u.id), null);
  const r = await get(`${ses.SESSION_COOKIE}=${ses.createSessionCookie(u.id, u.token_version)}`);
  assert.equal(r.status, 200);
  assert.ok(Date.now() - ul.lastSeen(u.id) < 5_000);
});
