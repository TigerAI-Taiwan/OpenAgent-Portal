// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: 監督 becomes a 交辦單 for the head(s) of the named person's own department(s). node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-supervise.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-sup-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_VENDOR_EMAIL = "v@tiger.example"; process.env.TIGERAI_VENDOR_PASSWORD = "Vendor-Pass-12345!";
const acc = await import("../accounts/service.ts");
const { bootstrapVendor } = await import("../accounts/vendor.ts");
const R = await import("../wizards/supervise-route.ts");
const { getDb } = await import("../db/store.ts");
const rooms = await import("../rooms/service.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("a@x.example", "老師", "admin");
bootstrapVendor();
const vendor = getDb().prepare("SELECT id FROM users WHERE is_vendor=1").get();
const [hA, hB, hC, amy, solo] = [mk("ha@x", "甲班導師"), mk("hb@x", "乙班導師"), mk("hc@x", "丙班導師"), mk("amy@x", "Amy"), mk("solo@x", "無班級")];
const gA = acc.createGroup(admin.id, { name: "甲班" }), gB = acc.createGroup(admin.id, { name: "乙班" }), gC = acc.createGroup(admin.id, { name: "丙班" });
acc.setMembership(admin.id, gA.id, hA.id, true, true); acc.setMembership(admin.id, gB.id, hB.id, true, true); acc.setMembership(admin.id, gC.id, hC.id, true, true);
acc.setMembership(admin.id, gA.id, amy.id, true); acc.setMembership(admin.id, gB.id, amy.id, true); // Amy is in two classes
const room = rooms.createRoom({ id: hC.id, role: "member" }, "跨班專案", [amy.id, hA.id, hB.id, solo.id]); // created by the head of a THIRD class
const say = (u, text) => Number(getDb().prepare("INSERT INTO room_messages (room_id,author_id,text,mentions,ts,kind) VALUES (?,?,?,?,?,'human')").run(room.id, u.id, text, "[]", Date.now()).lastInsertRowid);
const run = { id: "wrun1", room_id: room.id, requested_by: null };
getDb().prepare("INSERT INTO wizard_runs (id,kind,room_id,runner_id,trigger,status,created_at) VALUES ('wrun1','daily',?,?,'manual','running',?)").run(room.id, hC.id, Date.now());
const todo = (u) => getDb().prepare("SELECT title,description,applicant_id,source,assignee_id FROM assignments WHERE assignee_id=? AND title LIKE '監督:%'").all(u.id);

test("the named person's own department heads get the 交辦單 — not the channel creator's, not another class's head", () => {
  const m = say(amy, "我下週一前交報告");
  const item = { aspect: "supervise", text: "Amy 說下週一前交報告,之後沒看到完成", sources: [{ t: "m", seq: m }], to: { users: [hC.id] } };
  assert.equal(R.routeSupervision(run, item), true);
  assert.equal(todo(hA).length, 1); assert.equal(todo(hB).length, 1, "both of Amy's classes");
  assert.equal(todo(hC).length, 0, "the channel creator (head of a third class) gets nothing");
  assert.equal(todo(admin).length, 0, "an administrator is not routed to when a head exists");
  assert.match(todo(hA)[0].description, /出處:\n- 頻道訊息 #\d+\(Amy\):我下週一前交報告/);
  assert.equal(todo(hA)[0].assignee_id, hA.id); assert.equal(todo(hA)[0].applicant_id, hA.id, "handed to themself: nobody outside the department is made the applicant");
  const bell = getDb().prepare("SELECT * FROM wizard_items WHERE recipient_id=? AND aspect='remind'").all(amy.id);
  assert.equal(bell.length, 1); assert.match(bell[0].text, /轉給你的主管/);
  assert.equal(R.routeSupervision(run, item), true); assert.equal(todo(hA).length, 1, "the same matter is not handed over twice");
});

test("no head (or no department) sends it to the customer's administrators, never the maintenance account", () => {
  const m = say(solo, "預算我來處理");
  assert.equal(R.routeSupervision(run, { aspect: "supervise", text: "預算沒進度", sources: [{ t: "m", seq: m }], to: "channel" }), true);
  assert.equal(todo(admin).length, 1); assert.equal(todo({ id: vendor.id }).length, 0);
});

test("a head who is the one named is not handed their own item; with no other head it goes to the administrators", () => {
  const m = say(hA, "我會處理");
  R.routeSupervision(run, { aspect: "supervise", text: "導師沒回報", sources: [{ t: "m", seq: m }], to: "channel" });
  assert.equal(todo(hA).length, 1, "still only the earlier one");
  assert.equal(todo(admin).length, 2);
});

test("an item that names nobody (a finished report deck) is not routed here", () => {
  assert.equal(R.routeSupervision(run, { aspect: "supervise", text: "報告已做好", sources: [{ t: "x", label: "週報", quote: "q" }], to: { users: [hC.id] } }), false);
  assert.equal(R.routeSupervision(run, { aspect: "audit", text: "x", sources: [{ t: "m", seq: 1 }], to: "channel" }), false, "稽核 routing is unchanged");
});

test("a late 交辦單 becomes a 監督 fact about its assignee; a department head with no head above sends it to the administrators", async () => {
  const { assignmentFacts } = await import("../wizards/facts.ts");
  const { factItems } = await import("../wizards/shared.ts");
  const now = Date.now();
  const due = new Date(now - 2 * 86_400_000); due.setUTCHours(12, 0, 0, 0);
  const facts = assignmentFacts([{ id: "as1", title: "估工時", assigneeId: hA.id, assigneeName: hA.name, dueDate: due.getTime() }], now);
  assert.match(facts[0].supervise, /已逾期 [23] 天/);
  const items = factItems({ id: room.id, owner_id: hC.id }, facts, { aspects: { record: true, suggest: true, supervise: true, remind: true, audit: true } });
  const sup = items.find((i) => i.aspect === "supervise");
  assert.equal(sup.extra.subjectId, hA.id);
  const before = todo(admin).length;
  assert.equal(R.routeSupervision(run, sup), true);
  assert.equal(todo(admin).length, before + 1, "hA is head of 甲班 and nobody else heads it: the administrators get it");
  assert.match(todo(admin).at(-1).description, /出處:\n- 交辦單:/);
  assert.equal(assignmentFacts([{ id: "as2", title: "x", assigneeId: hA.id, assigneeName: "A", dueDate: now + 5 * 86_400_000 }], now).length, 0);
});
