// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 部門當作頻道: a unit gets its own channel, members follow, 全公司頻道 holds everyone.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-unit-channel.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "tg-unitch-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const a = mk("a@example.com", "Ann");
const b = mk("b@example.com", "Bob");
const members = (rid) => getDb().prepare("SELECT user_id FROM room_members WHERE room_id=?").all(rid).map((r) => r.user_id);
const unitRoom = (gid) => getDb().prepare("SELECT * FROM rooms WHERE unit_id=? AND is_unit_default=1").get(gid);

test("a new unit gets its own default channel, filed under it", () => {
  const g = acc.createGroup(admin.id, { name: "生管部" });
  const r = unitRoom(g.id);
  assert.ok(r); assert.equal(r.name, "生管部頻道"); assert.equal(r.owner_id, admin.id);
});
test("members join and leave with the unit; the owner stays", () => {
  const g = acc.createGroup(admin.id, { name: "業務部" });
  acc.setMembership(admin.id, g.id, a.id, true, true);
  const r = unitRoom(g.id);
  assert.ok(members(r.id).includes(a.id));
  acc.setMembership(admin.id, g.id, a.id, false);
  assert.ok(!members(r.id).includes(a.id));
  assert.ok(members(r.id).includes(admin.id));
});
test("全公司頻道 exists once and every account is in it, including later ones", () => {
  const rooms = getDb().prepare("SELECT id FROM rooms WHERE name='全公司頻道'").all();
  assert.equal(rooms.length, 1);
  const late = mk("late@example.com", "Late");
  for (const u of [admin, a, b, late]) assert.ok(members(rooms[0].id).includes(u.id));
  assert.equal(getDb().prepare("SELECT unit_id FROM rooms WHERE id=?").get(rooms[0].id).unit_id, null);
});
test("a name clash with a hand-made channel does not break creating the unit", () => {
  getDb().prepare("INSERT INTO rooms (id,name,owner_id,created_at) VALUES ('rhand00000001','品保部頻道',?,?)").run(admin.id, Date.now());
  const g = acc.createGroup(admin.id, { name: "品保部" });
  assert.ok(g.id); assert.equal(unitRoom(g.id), undefined);
});
