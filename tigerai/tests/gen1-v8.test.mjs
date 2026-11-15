// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Batch v8 (公佈欄 + 提醒泡泡): node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-v8.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v8-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");

const acc = await import("../accounts/service.ts");
const b = await import("../bulletin/service.ts");
const asg = await import("../workorders/assignments.ts");
const wo = await import("../workorders/service.ts");
const { getDb } = await import("../db/store.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const admin2 = mk("admin2@example.com", "Admin2", "admin");
const wang = mk("wang@example.com", "王小明");
const lin = mk("lin@example.com", "林小華");
const tester = mk("tester@example.com", "測試員");
const finance = acc.createGroup(null, { name: "財務部" });
const sales = acc.createGroup(null, { name: "業務部" });
acc.setMembership(null, finance.id, wang.id, true, true);   // head
acc.setMembership(null, finance.id, lin.id, true, false);
acc.setMembership(null, sales.id, tester.id, true, false);
const A = (u) => ({ id: u.id, role: u.role });
const DAYMS = 86_400_000;
const isoDay = (offset) => new Date(Date.now() + offset * DAYMS).toISOString().slice(0, 10);

test("who may post: member no, head only own groups, admin anywhere", () => {
  assert.throws(() => b.createAnnouncement(A(lin), { title: "x", body: "y", audience: [finance.id] }), (e) => e.status === 403);
  assert.throws(() => b.createAnnouncement(A(tester), { title: "x", body: "y", audience: "all" }), (e) => e.status === 403);
  // head: not the whole company, not a group they do not head
  assert.throws(() => b.createAnnouncement(A(wang), { title: "x", body: "y", audience: "all" }), (e) => e.code === "audience_forbidden");
  assert.throws(() => b.createAnnouncement(A(wang), { title: "x", body: "y", audience: [sales.id] }), (e) => e.code === "audience_forbidden");
  assert.throws(() => b.createAnnouncement(A(wang), { title: "x", body: "y", audience: [finance.id, sales.id] }), (e) => e.code === "audience_forbidden");
  const ok = b.createAnnouncement(A(wang), { title: "財務部月結", body: "請於週五前完成", audience: [finance.id] });
  assert.equal(ok.authorId, wang.id);
  assert.ok(b.createAnnouncement(A(admin), { title: "全公司", body: "**放假**", audience: "all" }).id);
  assert.ok(b.createAnnouncement(A(admin), { title: "業務", body: "x", audience: [sales.id] }).id);
  assert.throws(() => b.createAnnouncement(A(admin), { title: "", body: "x", audience: "all" }), (e) => e.code === "bad_title");
  assert.throws(() => b.createAnnouncement(A(admin), { title: "t", body: "x", audience: [] }), (e) => e.code === "bad_audience");
});

test("who sees what: audience only, the poster and admin always", () => {
  const titles = (u) => b.listAnnouncements(A(u), "active").map((a) => a.title);
  assert.ok(titles(lin).includes("財務部月結") && titles(lin).includes("全公司"));
  assert.ok(!titles(tester).includes("財務部月結"), "no group: does not see the finance announcement");
  assert.ok(titles(tester).includes("業務"));
  assert.ok(!titles(lin).includes("業務"));
  assert.ok(titles(wang).includes("財務部月結") && titles(admin).includes("業務"));
  const fin = b.listAnnouncements(A(admin), "active").find((a) => a.title === "財務部月結");
  assert.throws(() => b.announcementDetail(A(tester), fin.id), (e) => e.status === 404);
  assert.throws(() => b.markRead(A(tester), fin.id), (e) => e.status === 404);
});

test("read tracking: N/M and who has not read; 需要確認 needs the click", () => {
  const n = b.createAnnouncement(A(wang), { title: "資安須知", body: "請閱讀", audience: [finance.id], requireAck: true, pinned: true });
  let d = b.announcementDetail(A(wang), n.id).announcement;
  assert.deepEqual([d.stats.total, d.stats.read, d.stats.acked], [1, 0, 0]);   // the poster is not counted
  assert.deepEqual(d.stats.notRead, ["林小華"]);
  assert.deepEqual(d.stats.notAcked, ["林小華"]);
  assert.equal(b.announcementDetail(A(lin), n.id).announcement.stats, undefined, "a reader never sees who else read");
  b.markRead(A(lin), n.id);
  d = b.announcementDetail(A(wang), n.id).announcement;
  assert.deepEqual([d.stats.read, d.stats.acked, d.stats.notAcked], [1, 0, ["林小華"]]);   // read is not confirmed
  b.acknowledge(A(lin), n.id);
  d = b.announcementDetail(A(wang), n.id).announcement;
  assert.deepEqual([d.stats.read, d.stats.acked, d.stats.notAcked], [1, 1, []]);
  // not asking for it -> 409; not for me -> 404
  const plain = b.listAnnouncements(A(admin), "active").find((a) => a.title === "全公司");
  assert.throws(() => b.acknowledge(A(lin), plain.id), (e) => e.status === 409);
  assert.throws(() => b.acknowledge(A(tester), n.id), (e) => e.status === 404);
});

test("the bubble counts only what I must act on", () => {
  // lin: no assignment, one 需要確認 (全公司 is plain) -> after ack in the previous test: 0
  assert.equal(b.bulletinSummary(A(lin)).count, 0);
  const ack = b.createAnnouncement(A(admin), { title: "請確認新規定", body: "x", audience: "all", requireAck: true });
  const plain = b.createAnnouncement(A(admin), { title: "只是通知", body: "x", audience: "all" });
  const s0 = b.bulletinSummary(A(lin));
  assert.equal(s0.count, 1, "plain announcements do not count");
  assert.equal(s0.parts.acks, 1);
  assert.equal(s0.overdue, false);
  assert.ok(s0.unread.count >= 2);
  // the poster is not asked to confirm their own; an admin is asked only for what was addressed to them (company-wide = yes)
  assert.equal(b.bulletinSummary(A(admin)).parts.acks, 0);
  assert.equal(b.bulletinSummary(A(admin2)).parts.acks, 1);
  // an assignment to lin, due yesterday -> counts and the bubble is red
  const as = asg.createAssignment(A(admin), { title: "整理報表", description: "", assigneeId: lin.id, dueDate: isoDay(-1) });
  const s1 = b.bulletinSummary(A(lin), Date.now(), 0);
  assert.equal(s1.count, 2); assert.equal(s1.overdue, true);
  assert.equal(s1.urgent[0].id, as.id, "most urgent first (the overdue order)");
  // a finished one drops out, and so does the confirmed announcement
  asg.completeAssignment(A(lin), as.id, "ok");
  b.acknowledge(A(lin), ack.id);
  const s2 = b.bulletinSummary(A(lin));
  assert.equal(s2.count, 0); assert.equal(s2.overdue, false);
  // my own created orders do not count for me, only assignments TO me
  asg.createAssignment(A(lin), { title: "請財務查", description: "", assigneeId: wang.id });
  assert.equal(b.bulletinSummary(A(lin)).count, 0);
  assert.equal(b.bulletinSummary(A(wang)).parts.assignments, 1);
  void plain;
});

test("approvals waiting: admin only, never my own", () => {
  const before = b.bulletinSummary(A(admin)).parts.approvals;
  wo.createOrder("prompt-share", lin.id, { name: "weekly", body: "text" });
  assert.equal(b.bulletinSummary(A(admin)).parts.approvals, before + 1);
  assert.equal(b.bulletinSummary(A(admin2)).parts.approvals, before + 1);
  assert.equal(b.bulletinSummary(A(lin)).parts.approvals, 0);
  assert.equal(b.bulletinSummary(A(wang)).parts.approvals, 0);
  const item = b.personalItems(A(admin)).find((i) => i.kind === "approval");
  assert.equal(item.approval.applicantName, "林小華");
  // the admin's own request is not theirs to approve
  wo.createOrder("prompt-share", admin.id, { name: "mine", body: "t" });
  assert.equal(b.bulletinSummary(A(admin)).parts.approvals, before + 1);
});

test("expiry: expired moves to 已過期, the caller's own day decides, no longer asks for ack", () => {
  const e = b.createAnnouncement(A(admin), { title: "限時", body: "x", audience: "all", requireAck: true, expiresAt: isoDay(-1) });
  assert.ok(!b.listAnnouncements(A(lin), "active").some((a) => a.id === e.id));
  assert.ok(b.listAnnouncements(A(lin), "expired").some((a) => a.id === e.id));
  assert.ok(!b.personalItems(A(lin)).some((i) => i.id === e.id), "an expired 需要確認 is not asked any more");
  const today = b.createAnnouncement(A(admin), { title: "今天到期", body: "x", audience: "all", expiresAt: isoDay(0) });
  assert.ok(b.listAnnouncements(A(lin), "active", Date.now(), 0).some((a) => a.id === today.id), "still valid on its last day");
  // a viewer far ahead of UTC (tzo -840) is already on tomorrow: expired for them
  const tomorrowForThem = Date.UTC(2026, 10, 14, 23, 0);   // 23:00 UTC; at UTC+14 (tzo -840) it is already the 15th
  const lastDay = b.createAnnouncement(A(admin), { title: "11/14到期", body: "x", audience: "all", expiresAt: "2026-11-14" });
  assert.ok(b.listAnnouncements(A(lin), "active", tomorrowForThem, 0).some((a) => a.id === lastDay.id));
  assert.ok(b.listAnnouncements(A(lin), "expired", tomorrowForThem, -840).some((a) => a.id === lastDay.id));
  // editing the expiry back to the future revives it
  b.updateAnnouncement(A(admin), e.id, { expiresAt: isoDay(5) });
  assert.ok(b.listAnnouncements(A(lin), "active").some((a) => a.id === e.id));
});

test("pinned first; edit keeps history (who, when, old text); only poster or admin edit; delete is soft", () => {
  const n = b.createAnnouncement(A(wang), { title: "初稿", body: "舊內文", audience: [finance.id] });
  assert.throws(() => b.updateAnnouncement(A(lin), n.id, { title: "改" }), (e) => e.status === 403);
  assert.throws(() => b.deleteAnnouncement(A(lin), n.id), (e) => e.status === 403);
  assert.throws(() => b.updateAnnouncement(A(wang), n.id, { audience: [sales.id] }), (e) => e.code === "audience_forbidden");
  assert.throws(() => b.updateAnnouncement(A(wang), n.id, { audience: "all" }), (e) => e.code === "audience_forbidden");
  b.updateAnnouncement(A(wang), n.id, { title: "二稿", body: "新內文", pinned: true });
  b.updateAnnouncement(A(admin), n.id, { body: "管理員改過" });
  const d = b.announcementDetail(A(wang), n.id);
  assert.equal(d.announcement.title, "二稿"); assert.equal(d.announcement.edited, true);
  assert.equal(d.history.length, 2);
  assert.deepEqual([d.history[1].oldTitle, d.history[1].oldBody, d.history[1].editorName], ["初稿", "舊內文", "王小明"]);
  assert.deepEqual([d.history[0].oldBody, d.history[0].editorName], ["新內文", "Admin"]);
  assert.equal(b.announcementDetail(A(lin), n.id).history.length, 0, "history is for the poster and admin");
  assert.equal(b.listAnnouncements(A(lin), "active")[0].pinned, true, "pinned announcements come first");
  assert.throws(() => getDb().prepare("UPDATE announcement_edits SET old_body='x'").run());
  assert.throws(() => getDb().prepare("DELETE FROM announcement_edits").run());
  b.deleteAnnouncement(A(wang), n.id);
  assert.ok(!b.listAnnouncements(A(admin), "active").some((a) => a.id === n.id), "nobody sees a deleted one");
  assert.throws(() => b.announcementDetail(A(admin), n.id), (e) => e.status === 404);
  const row = getDb().prepare("SELECT deleted_by FROM announcements WHERE id=?").get(n.id);
  assert.equal(row.deleted_by, wang.id, "the row is kept with who deleted it");
  assert.throws(() => getDb().prepare("DELETE FROM announcements WHERE id=?").run(n.id));
});

test("audit: publish, edit, delete, acknowledge", () => {
  const actions = new Set(getDb().prepare("SELECT action FROM audit").all().map((r) => r.action));
  for (const a of ["announcement.publish", "announcement.edit", "announcement.delete", "announcement.ack"]) assert.ok(actions.has(a), a);
});

test("AI draft: head/admin only, calls the gateway with tigerai-fast, stores nothing", async () => {
  process.env.TIGERAI_V1_BASE_URL = "http://gateway.test/v1";
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think>```json\n{"title":"月結提醒","body":"- 週五前完成\\n- 附憑證"}\n```' } }] }), { status: 200 });
  };
  try {
    await assert.rejects(b.draftAnnouncement(A(lin), { topic: "x" }), (e) => e.status === 403);
    const before = getDb().prepare("SELECT COUNT(*) AS n FROM announcements").get().n;
    const d = await b.draftAnnouncement(A(wang), { topic: "提醒月結週五截止", audience: "財務部" });
    assert.equal(d.title, "月結提醒"); assert.match(d.body, /週五前完成/);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "http://gateway.test/v1/chat/completions"); assert.equal(calls[0].body.model, "tigerai-fast");
    assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM announcements").get().n, before, "a draft is never published");
  } finally { globalThis.fetch = orig; delete process.env.TIGERAI_V1_BASE_URL; }
  assert.deepEqual(b.parseDraft("標題一行\n\n內文第二段"), { title: "標題一行", body: "內文第二段" });
  assert.equal(b.parseDraft("   "), null);
});

test("posting scope drives the form: head sees only own groups, no 全公司", () => {
  assert.equal(b.postingScope(A(wang)).all, false);
  assert.deepEqual(b.postingScope(A(wang)).groups.map((g) => g.name), ["財務部"]);
  assert.equal(b.postingScope(A(admin)).all, true);
  assert.equal(b.postingScope(A(lin)).groups.length, 0);
  assert.equal(b.bulletinSummary(A(lin)).canPost, false);
  assert.equal(b.bulletinSummary(A(wang)).canPost, true);
});
