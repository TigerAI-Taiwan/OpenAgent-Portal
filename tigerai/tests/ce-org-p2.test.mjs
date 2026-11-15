// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 目錄對應、目錄樹權限、換部門、單位改名/改上層/刪中間層.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-org-p2.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "tg-orgp2-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const map = await import("../directory/map.ts");
const tree = await import("../directory/tree.ts");
const exp = await import("../directory/export.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const wang = mk("wang@example.com", "Wang");     // 王小明: Finance -> Production
const head = mk("head@example.com", "FinHead");  // head of Finance
const phead = mk("phead@example.com", "ProdHead");
const sub = mk("sub@example.com", "SubStudent"); // in a sub-unit of Finance
const eve = mk("eve@example.com", "Eve");
const fin = acc.createGroup(admin.id, { name: "財務部" });
const prod = acc.createGroup(admin.id, { name: "生產部" });
const subU = acc.createGroup(admin.id, { name: "財務一組", parentId: fin.id });
for (const [u, g, h] of [[wang, fin, false], [head, fin, true], [phead, prod, true], [sub, subU, false]]) acc.setMembership(admin.id, g.id, u.id, true, h);

// 部門當作頻道 now makes a channel per unit by itself; this file tests hand-made channels, so set the automatic ones aside.
getDb().prepare("UPDATE rooms SET deleted_at=1 WHERE name LIKE '%頻道'").run();

async function call(user, method, path, body) {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  const req = new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await handle(req, segs);
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, headers: res.headers, json: ct.includes("json") ? await res.json() : null, buf: ct.includes("json") ? null : Buffer.from(await res.arrayBuffer()) };
}
const V = (u) => ({ id: u.id, role: u.role });
const audits = (a) => getDb().prepare("SELECT * FROM audit WHERE action=?").all(a);
const names = (d) => d.entries.map((e) => e.name);

// channels: Finance default channel, a project channel and a cross-unit one
const finCh = (await call(admin, "POST", "rooms", { name: "財務內部群", memberIds: [wang.id, head.id], unitId: fin.id })).json.room.id;
await call(admin, "PATCH", `rooms/${finCh}`, { unitId: fin.id, isDefault: true });
const proj = (await call(head, "POST", "rooms", { name: "月結專案", memberIds: [wang.id], unitId: fin.id })).json.room.id;
const prodCh = (await call(admin, "POST", "rooms", { name: "生產部頻道", memberIds: [phead.id] })).json.room.id;
await call(admin, "PATCH", `rooms/${prodCh}`, { unitId: prod.id, isDefault: true });
const cross = (await call(admin, "POST", "rooms", { name: "全員公告討論", memberIds: [wang.id, eve.id] })).json.room.id;

test("mapping: folders are named by internal id and never move; sub-folders are created on demand", () => {
  const cf = map.channelFolder(proj, "每日摘要");
  assert.ok(cf.endsWith(join("rooms", proj, "每日摘要")) && existsSync(cf));
  const pf = map.personFolder(wang.id, "我的產出");
  assert.ok(pf.endsWith(join("users", wang.dir_name, "我的產出")));
  assert.throws(() => map.channelFolder(proj, "../x"), (e) => e.code === "bad_folder");
  assert.equal(getDb().prepare("SELECT folder FROM dir_map WHERE kind='channel' AND id=?").get(proj).folder, join("rooms", proj));
  acc.updateGroup(admin.id, fin.id, { name: "財務與會計部" });
  assert.equal(map.unitFolder(fin.id).endsWith(join("groups", fin.dir_name)), true, "a rename moves no folder");
  assert.deepEqual(map.displayPath("channel", proj), ["全公司", "部門", "財務與會計部", "頻道", "月結專案"]);
  assert.deepEqual(map.displayPath("channel", cross), ["全公司", "跨部門頻道", "全員公告討論"]);
  acc.updateGroup(admin.id, fin.id, { name: "財務部" });
});

test("units: rename and re-parent are checked; deleting a middle unit re-attaches children and channels to the grandparent", () => {
  assert.throws(() => acc.updateGroup(admin.id, fin.id, { parentId: subU.id }), (e) => e.code === "bad_parent", "no loop");
  assert.throws(() => acc.updateGroup(admin.id, fin.id, { parentId: fin.id }), (e) => e.code === "bad_parent");
  assert.throws(() => acc.updateGroup(admin.id, subU.id, { name: "生產部" }), (e) => e.code === "exists");
  const top = acc.createGroup(admin.id, { name: "營運處" });
  const mid = acc.createGroup(admin.id, { name: "業務部", parentId: top.id });
  const leaf = acc.createGroup(admin.id, { name: "北區", parentId: mid.id });
  const ch = getDb().prepare("INSERT INTO rooms (id,name,owner_id,created_at,unit_id) VALUES ('rmid','中層頻道',?,?,?)").run(admin.id, Date.now(), mid.id);
  void ch;
  acc.deleteGroup(admin.id, mid.id);
  assert.equal(getDb().prepare("SELECT parent_id FROM groups WHERE id=?").get(leaf.id).parent_id, top.id, "grandparent, not the top by accident");
  assert.equal(getDb().prepare("SELECT unit_id FROM rooms WHERE id='rmid'").get().unit_id, top.id);
  acc.deleteGroup(admin.id, top.id);
  assert.equal(getDb().prepare("SELECT parent_id FROM groups WHERE id=?").get(leaf.id).parent_id, null);
  assert.equal(getDb().prepare("SELECT unit_id FROM rooms WHERE id='rmid'").get().unit_id, null, "a root unit's channels become 跨部門頻道");
});

test("tree: who sees which folder", () => {
  writeFileSync(join(map.personFolder(wang.id, "我的產出"), "報告.md"), "# 週報\n\n- 完成對帳 [來源](https://example.com/a)\n");
  writeFileSync(join(map.personFolder(wang.id, "給我的提醒"), "r.md"), "private reminder");
  writeFileSync(join(map.personFolder(wang.id, "給我的監督與稽核"), "s.md"), "supervision");
  writeFileSync(join(map.channelFolder(proj, "工作週報"), "w46.md"), "# 第46週\n\n- A\n- B\n");
  // self
  assert.deepEqual(names(tree.describe(V(wang), "person:" + wang.id)), ["給我的提醒", "給我的監督與稽核", "我的產出", "我的檔案"]);
  // the head of a DIRECT unit: outputs and files only (no reminders, no supervision), read only, audited
  const before = audits("dir.person_view").length;
  assert.deepEqual(names(tree.describe(V(head), "person:" + wang.id)), ["我的產出", "我的檔案"]);
  assert.equal(tree.describe(V(head), `person:${wang.id}/我的產出/報告.md`).kind, "file");
  assert.throws(() => tree.describe(V(head), `person:${wang.id}/給我的提醒`), (e) => e.status === 404);
  assert.ok(audits("dir.person_view").length >= before + 2, "every view of someone else's folder is written down");
  // a head of another unit, a stranger, and a head of the parent unit (no inheritance) see nothing
  for (const u of [phead, eve]) assert.throws(() => tree.describe(V(u), "person:" + wang.id), (e) => e.status === 404);
  assert.throws(() => tree.describe(V(head), "person:" + sub.id), (e) => e.status === 404, "the head of Finance does not see the sub-unit's students");
  // admin: outputs, files and supervision, never reminders
  assert.deepEqual(names(tree.describe(V(admin), "person:" + wang.id)), ["給我的監督與稽核", "我的產出", "我的檔案"]);
  // channels
  assert.equal(tree.describe(V(wang), `chan:${proj}/工作週報/w46.md`).kind, "file");
  assert.throws(() => tree.describe(V(eve), `chan:${proj}`), (e) => e.status === 404);
  assert.throws(() => tree.describe(V(eve), `chan:${proj}/工作週報`), (e) => e.status === 404);
  assert.equal(tree.describe(V(head), `chan:${proj}`).kind, "folder"); // heads see channels of their unit's people
  // listings
  assert.deepEqual(names(tree.describe(V(wang), "units")), ["財務部"]);
  assert.deepEqual(names(tree.describe(V(wang), `unit:${fin.id}/chans`)).sort(), ["財務內部群", "月結專案"].sort());
  assert.deepEqual(names(tree.describe(V(admin), `unit:${fin.id}/chans`)).sort(), ["財務內部群", "月結專案", "財務部頻道"].sort());
  assert.throws(() => tree.describe(V(eve), `unit:${fin.id}`), (e) => e.status === 404);
  assert.deepEqual(names(tree.describe(V(eve), "cross")), ["全員公告討論"]);
  assert.deepEqual(names(tree.describe(V(admin), "cross")).filter((n) => !["全公司頻道", "業務部頻道", "營運處頻道"].includes(n)).sort(), ["中層頻道", "全員公告討論"]);
  assert.ok(names(tree.describe(V(admin), `unit:${fin.id}`)).includes("子單位"), "administrators see the real tree");
  assert.ok(!names(tree.describe(V(head), `unit:${fin.id}`)).includes("子單位"));
  const members = tree.describe(V(head), `unit:${fin.id}/members`);
  assert.equal(members.entries.find((e) => e.name === "Wang").kind, "link");
  assert.equal(tree.describe(V(wang), `unit:${fin.id}/members`).entries.find((e) => e.name === "FinHead").disabled, true, "a colleague is listed but not openable");
  // people root
  assert.deepEqual(names(tree.describe(V(eve), "people")), ["Eve"]);
  assert.ok(names(tree.describe(V(head), "people")).includes("Wang"));
  assert.ok(!names(tree.describe(V(head), "people")).includes("SubStudent"));
});

test("tree: path tricks, links and downloads", async () => {
  for (const bad of [`chan:${proj}/工作週報/../../x`, `chan:${proj}/..`, "chan:../x", "unit:a b", `person:${wang.id}/我的產出/..%2f`, "co/ann/../../x", "etc/passwd", ""]) {
    assert.throws(() => tree.describe(V(admin), bad === "" ? "" : bad), (e) => e.status === 404, bad);
  }
  assert.throws(() => tree.describe(V(admin), `chan:${proj}/設定`), (e) => e.status === 404, "only the known folders");
  // a symbolic link planted inside a folder is neither listed nor followed
  const sd = map.personFolder(wang.id, "我的檔案");
  writeFileSync(join(dir, "outside.md"), "OUTSIDE");
  symlinkSync(join(dir, "outside.md"), join(sd, "link.md"));
  symlinkSync(dir, join(sd, "dirlink"));
  assert.ok(!names(tree.describe(V(wang), `person:${wang.id}/我的檔案`)).includes("link.md"));
  assert.throws(() => tree.describe(V(wang), `person:${wang.id}/我的檔案/link.md`), (e) => e.status === 404);
  assert.throws(() => tree.describe(V(wang), `person:${wang.id}/我的檔案/dirlink/outside.md`), (e) => e.status === 404);
  // HTTP: only GET; download is nosniff + sandboxed
  assert.equal((await call(wang, "POST", "dir?node=root", {})).status, 404);
  const file = await call(wang, "GET", `dir/file?node=${encodeURIComponent(`person:${wang.id}/我的產出/報告.md`)}`);
  assert.equal(file.status, 200); assert.equal(file.headers.get("x-content-type-options"), "nosniff"); assert.match(file.headers.get("content-security-policy"), /sandbox/);
  assert.match(file.buf.toString(), /完成對帳/);
  assert.equal((await call(eve, "GET", `dir/file?node=${encodeURIComponent(`person:${wang.id}/我的產出/報告.md`)}`)).status, 404);
  const reader = await call(wang, "GET", `dir?node=${encodeURIComponent(`person:${wang.id}/我的產出/報告.md`)}`);
  assert.equal(reader.json.kind, "file"); assert.equal(reader.json.file.markdown, true);
  assert.deepEqual(reader.json.crumbs.map((c) => c.name), ["目錄", "個人", "Wang", "我的產出", "報告.md"]);
});

test("export: a Markdown file becomes a deck; sources become hyperlinks; permission is the reading right", async () => {
  const deck = exp.markdownToDeck("# 週報\n\n## 本週\n\n- 完成對帳 [來源](https://example.com/a)\n- 下週排程\n\n## 風險\n\n一段說明\n", "x");
  assert.equal(deck.title, "週報"); assert.equal(deck.slides.length, 2);
  assert.deepEqual(deck.slides[0].sources, [{ title: "來源", url: "https://example.com/a" }]);
  const r = await call(wang, "GET", `dir/export?format=pptx&node=${encodeURIComponent(`person:${wang.id}/我的產出/報告.md`)}`);
  assert.equal(r.status, 200); assert.equal(r.buf.subarray(0, 2).toString(), "PK");
  assert.equal(audits("dir.export").length, 1);
  assert.equal((await call(eve, "GET", `dir/export?format=pptx&node=${encodeURIComponent(`person:${wang.id}/我的產出/報告.md`)}`)).status, 404);
  const pdf = await call(wang, "GET", `dir/export?format=pdf&node=${encodeURIComponent(`person:${wang.id}/我的產出/報告.md`)}`);
  assert.equal(pdf.status, 409, "no converter configured: a clear refusal, not a broken file");
});

test("換部門: personal folder untouched, links replaced, default channel switched, project channels pending, assignments per row", async () => {
  const a1 = (await call(head, "POST", "assignments", { title: "月結對帳", assigneeId: wang.id })).json.assignment.id;
  const pvw = (await call(admin, "GET", `admin/users/${wang.id}/unit-change?units=${prod.id}`)).json.preview;
  assert.deepEqual(pvw.removed.map((x) => x.name), ["財務部"]); assert.deepEqual(pvw.added.map((x) => x.name), ["生產部"]);
  assert.deepEqual(pvw.leaveDefaultChannels.map((c) => c.name), ["財務內部群"]);
  assert.deepEqual(pvw.joinDefaultChannels.map((c) => c.name), ["生產部頻道"]);
  assert.deepEqual(pvw.projectChannels.map((c) => c.name), ["月結專案"]);
  assert.equal(pvw.assignments.length, 1);
  assert.equal((await call(eve, "PUT", `admin/users/${wang.id}/units`, { unitIds: [prod.id] })).status, 403);
  const marker = join(map.personRoot(wang.id), "我的產出", "報告.md");
  const r = await call(admin, "PUT", `admin/users/${wang.id}/units`, { unitIds: [prod.id], assignments: { [a1]: "transfer" }, assignTo: head.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const db = getDb();
  assert.deepEqual(db.prepare("SELECT group_id FROM memberships WHERE user_id=?").all(wang.id).map((x) => x.group_id), [prod.id]);
  assert.equal(existsSync(marker), true, "the personal folder is not touched");
  const inRoom = (room) => !!db.prepare("SELECT 1 FROM room_members WHERE room_id=? AND user_id=?").get(room, wang.id);
  assert.equal(inRoom(finCh), false, "old unit's own channel: removed"); assert.equal(inRoom(prodCh), true, "new unit's own channel: added");
  assert.equal(inRoom(proj), true, "project channel is kept");
  assert.equal(inRoom(cross), true, "a cross-unit channel is never touched");
  assert.equal(db.prepare("SELECT assignee_id FROM assignments WHERE id=?").get(a1).assignee_id, head.id);
  assert.equal(audits("member.unit_change").length, 1);
  // the old head decides; the new head cannot
  const items = (await call(head, "GET", "unit-changes")).json.items;
  assert.equal(items.length, 1); assert.equal(items[0].roomName, "月結專案");
  assert.equal((await call(phead, "GET", "unit-changes")).json.items.length, 0);
  assert.equal((await call(phead, "POST", `unit-changes/${items[0].id}`, { decision: "remove" })).status, 403);
  assert.equal((await call(head, "POST", `unit-changes/${items[0].id}`, { decision: "remove" })).status, 200);
  assert.equal(inRoom(proj), false);
  assert.equal((await call(head, "POST", `unit-changes/${items[0].id}`, { decision: "keep" })).status, 409, "decided once");
  assert.ok(audits("member.unit_room").length === 1);
  // the same list again changes nothing
  const again = await call(admin, "PUT", `admin/users/${wang.id}/units`, { unitIds: [prod.id] });
  assert.equal(again.json.result.unchanged, true);
  // someone who left cannot be moved
  const gone = mk("gone@example.com", "Gone");
  await call(admin, "POST", `admin/users/${gone.id}/leave`, {});
  assert.equal((await call(admin, "PUT", `admin/users/${gone.id}/units`, { unitIds: [prod.id] })).status, 409);
});
