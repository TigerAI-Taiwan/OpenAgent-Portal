// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: archive a class at the end of a term. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-archive.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-arch-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const reg = await import("../register/service.ts");
const rooms = await import("../rooms/service.ts");
const { getDb } = await import("../db/store.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("t@x.example", "老師", "admin");
const amy = mk("amy@x.example", "Amy"), ben = mk("ben@x.example", "Ben"), cy = mk("cy@x.example", "Cy");
const gA = acc.createGroup(admin.id, { name: "甲班" }), gB = acc.createGroup(admin.id, { name: "乙班" });
acc.setMembership(admin.id, gA.id, amy.id, true); acc.setMembership(admin.id, gA.id, ben.id, true); acc.setMembership(admin.id, gB.id, cy.id, true);
const A = { id: admin.id, role: "admin" };
reg.setRegistration(admin.id, { open: true }); reg.setPhrase(A, gA.id, "class alpha 2026");
const own = rooms.createRoom({ id: amy.id, role: "member" }, "甲班討論", [ben.id]);
const shared = rooms.createRoom({ id: amy.id, role: "member" }, "甲乙共同", [ben.id, cy.id]);
rooms.setRoomUnit(A, own.id, gA.id); rooms.setRoomUnit(A, shared.id, gB.id); // the org branch's channel -> unit link decides which channels an archive closes
const call = async (u, method, path, body) => { const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": u.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/")); return { status: res.status, json: JSON.parse(await res.text()) }; };
const reg1 = (n, code) => handle(new Request("http://x/api/tg/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n, email: `${n}@r.example`, password: "Student-Pass-1", code }) }), ["register"]);

test("only an administrator archives; members stay, nothing is deleted", async () => {
  assert.equal((await call(amy, "POST", `admin/groups/${gA.id}/archive`, {})).status, 403);
  const r = await call(admin, "POST", `admin/groups/${gA.id}/archive`, {});
  assert.equal(r.status, 200); assert.equal(r.json.rooms, 2, "the class's own automatic channel and the one filed under it; not the shared one");
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM memberships WHERE group_id=?").get(gA.id).n, 2, "members stay");
  assert.equal(acc.userById(amy.id).status, "active");
  assert.equal(rooms.getRoom(own.id).deleted_at ?? null, null);
  assert.ok(rooms.getRoom(own.id).closed_at, "the channel is closed (read-only), kept");
  assert.equal(rooms.getRoom(shared.id).closed_at ?? null, null, "a channel filed under another unit keeps running");
  assert.equal((await call(admin, "POST", `admin/groups/${gA.id}/archive`, {})).status, 409);
  assert.ok((await call(admin, "GET", "admin/groups")).json.groups.find((g) => g.id === gA.id).archivedAt > 0);
});

test("an archived class's passphrase no longer registers anyone, and cannot be switched back on", async () => {
  reg.resetRegisterThrottle();
  assert.equal((await reg1("late", "class alpha 2026")).status, 403);
  assert.throws(() => reg.setPhrase(A, gA.id, "new phrase 2027"), (e) => e.code === "archived");
  assert.throws(() => reg.rotateCode(A, gA.id), (e) => e.code === "archived");
});

test("administrators still see the class's records (user log)", async () => {
  const ul = await import("../userlog/service.ts");
  const rows = await ul.listMembers(A, { catalog: async () => new Map(), messages: async () => null });
  assert.ok(rows.some((r) => r.id === amy.id) && rows.some((r) => r.id === ben.id));
});

test("unarchive restores exactly what the archive changed", async () => {
  assert.equal((await call(admin, "POST", `admin/groups/${gA.id}/archive`, { archived: false })).status, 200);
  assert.equal(rooms.getRoom(own.id).closed_at ?? null, null, "the channel is open again");
  reg.resetRegisterThrottle();
  assert.equal((await reg1("back", "class alpha 2026")).status, 200, "the passphrase works again");
  assert.equal((await call(admin, "POST", `admin/groups/${gA.id}/archive`, { archived: false })).status, 409);
});
