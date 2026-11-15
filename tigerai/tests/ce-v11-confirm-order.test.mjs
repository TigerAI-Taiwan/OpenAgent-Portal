// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce decision #3: 工作週報 / 訊息分析 hand a 「確認」 交辦單 that links the Markdown file; 確認 and the 交辦單 stay in step. 每日摘要 stays bell-only.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-confirm-order.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-co-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_TZ = "Asia/Taipei";
const acc = await import("../accounts/service.ts");
const rooms = await import("../rooms/service.ts");
const eng = await import("../wizards/engine.ts");
const st = await import("../wizards/store.ts");
const A = await import("../workorders/assignments.ts");
const WO = await import("../workorders/service.ts");
const tree = await import("../directory/tree.ts");
const { getDb } = await import("../db/store.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("a@x.example", "老師", "admin");
const lin = mk("lin@x.example", "B11901234-資工二-林小華");
const wang = mk("wang@x.example", "王小明");
const grp = acc.createGroup(admin.id, { name: "資工二" });
acc.setMembership(admin.id, grp.id, wang.id, true, true); // 王小明 is the teacher (head) of the class
acc.setMembership(admin.id, grp.id, lin.id, true, false); // 林小華 is a student
const as = (u) => ({ id: u.id, role: u.role });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settled = async (id) => { for (let i = 0; i < 300 && st.getRun(id).status === "running"; i++) await sleep(15); };
const room = rooms.createRoom(as(lin), "專題小組", [wang.id]);
const say = (u, text) => Number(getDb().prepare("INSERT INTO room_messages (room_id,author_id,text,mentions,ts,kind) VALUES (?,?,?,?,?,'human')").run(room.id, u.id, text, "[]", Date.now() - 2000).lastInsertRowid);
say(wang, "我明天交報告");
eng.setWizardModel(async ({ prompt }) => `記錄｜這週的重點｜#${[...prompt.matchAll(/#(\d+)/g)][0][1]}`);
const confirmOrders = (u) => getDb().prepare("SELECT * FROM assignments WHERE assignee_id=? AND title LIKE '確認:%' ORDER BY created_at").all(u.id);
const runWeekly = async () => { const x = await eng.runNow(as(lin), room.id, "weekly"); await settled(x.run.id); return st.getRun(x.run.id); };

test("工作週報 hands the head of the creator's class a 確認 交辦單 that links the MD file; the file is readable in the 目錄", async () => {
  const run = await runWeekly();
  assert.equal(run.status, "done", run.error ?? "");
  const [o] = confirmOrders(wang);
  assert.ok(o, "an order for the teacher (a student made the channel)"); assert.equal(confirmOrders(lin).length, 0); assert.match(o.title, /^確認:專題小組 工作週報/);
  assert.equal(o.source, "ai"); assert.equal(run.confirm_assignment_id, o.id);
  const m = /node=([^\s()]+)/.exec(o.description); assert.ok(m, "the order links the file");
  const node = decodeURIComponent(m[1]);
  assert.match(node, new RegExp(`^chan:${room.id}/工作週報/.+\\.md$`));
  const d = tree.describe({ id: wang.id, role: "member" }, node); // the teacher reads it through the channel it belongs to
  assert.equal(d.kind, "file"); assert.match(d.file.text, /工作週報/);
});

test("finishing the 交辦單 confirms the draft; pressing 確認 finishes the 交辦單", async () => {
  const [first] = confirmOrders(wang);
  const run = getDb().prepare("SELECT * FROM wizard_runs WHERE confirm_assignment_id=?").get(first.id);
  assert.equal(run.confirm_state, "draft");
  A.completeAssignment(as(wang), first.id, "看過了");
  const after = getDb().prepare("SELECT confirm_state, confirmed_by FROM wizard_runs WHERE id=?").get(run.id);
  assert.equal(after.confirm_state, "confirmed"); assert.equal(after.confirmed_by, wang.id);

  const run2 = await runWeekly();
  const o2 = getDb().prepare("SELECT * FROM assignments WHERE id=?").get(run2.confirm_assignment_id);
  assert.equal(o2.status, "open");
  eng.confirmRun(as(admin), run2.id);
  assert.equal(getDb().prepare("SELECT status FROM assignments WHERE id=?").get(o2.id).status, "done", "確認 in the channel finishes the order");
});

test("每日摘要 makes no 確認 交辦單; who confirms: the creator if a head or admin, else their class head, else an administrator", async () => {
  const before = getDb().prepare("SELECT COUNT(*) AS n FROM assignments WHERE title LIKE '確認:%'").get().n;
  const x = await eng.runNow(as(lin), room.id, "daily"); await settled(x.run.id);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM assignments WHERE title LIKE '確認:%'").get().n, before);
  const CO = await import("../wizards/confirm-order.ts");
  assert.deepEqual(Object.keys(CO.CONFIRM_KINDS).sort(), ["adhoc", "weekly"], "訊息分析 too, not 每日摘要");
  assert.equal(CO.confirmerOf(room), wang.id, "a student creator: their class head");
  const own = rooms.createRoom(as(wang), "老師的頻道", [lin.id]);
  assert.equal(CO.confirmerOf(own), wang.id, "a head who made the channel confirms it themself");
  const loner = mk("solo@x.example", "無班級");
  assert.equal(CO.confirmerOf(rooms.createRoom(as(loner), "獨自", [])), admin.id, "no class, no head: the administrator");
});

test("the 上架 核可單 list shows the applicant's display name, not the id", () => {
  const o = WO.createOrder("n8n_publish", lin.id, { name: "x", body: "y" });
  const row = WO.listOrders(as(admin)).find((r) => r.id === o.id);
  assert.equal(row.applicant_name, lin.name); assert.equal(row.applicant_id, lin.id);
  assert.equal(WO.listOrders(as(lin)).find((r) => r.id === o.id).applicant_name, lin.name);
});

test("the order text ends with the link alone (the page swaps it for 「在目錄打開檔案」), nothing trailing", async () => {
  const run = await runWeekly();
  const d = getDb().prepare("SELECT description FROM assignments WHERE id=?").get(run.confirm_assignment_id).description;
  assert.match(d, /檔案:\/\?settings=dir&node=[^\s()（）]+$/);
});
