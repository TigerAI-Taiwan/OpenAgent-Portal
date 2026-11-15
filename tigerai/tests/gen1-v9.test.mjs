// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Batch v9 (creator closes own room, personal 精靈 menu, assignment source):
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-v9.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v9-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");

const acc = await import("../accounts/service.ts");
const rooms = await import("../rooms/service.ts");
const ag = await import("../agents/service.ts");
const pa = await import("../agents/personal.ts");
const asg = await import("../workorders/assignments.ts");
const { getDb } = await import("../db/store.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const lin = mk("lin@example.com", "林小華");
const wang = mk("wang@example.com", "王小明");
const chen = mk("chen@example.com", "陳大文");
const A = (u) => ({ id: u.id, role: u.role });
const audit = (action) => getDb().prepare("SELECT extra FROM audit WHERE action=?").all(action).map((r) => JSON.parse(r.extra ?? "{}"));

test("room creator closes and reopens their own room; others and delete stay refused", () => {
  const room = rooms.createRoom(A(lin), "v9驗證-頻道", [wang.id]);
  assert.equal(rooms.accessFlags(A(lin), room).can.close, true, "creator is offered close");
  assert.equal(rooms.accessFlags(A(lin), room).can.delete, false, "delete stays admin only");
  assert.equal(rooms.accessFlags(A(wang), room).can.close, false, "another member is not offered close");
  assert.throws(() => rooms.closeRoom(A(wang), room.id), (e) => e.status === 403);
  rooms.closeRoom(A(lin), room.id);
  assert.ok(rooms.getRoom(room.id).closed_at);
  assert.equal(rooms.accessFlags(A(lin), rooms.getRoom(room.id)).can.reopen, true);
  assert.throws(() => rooms.reopenRoom(A(wang), room.id), (e) => e.status === 403);
  rooms.reopenRoom(A(lin), room.id);
  assert.equal(rooms.getRoom(room.id).closed_at, null);
  assert.throws(() => rooms.deleteRoom(A(lin), room.id), (e) => e.status === 403);
  assert.ok(audit("room.close").some((x) => x.roomId === room.id && x.byCreator === true), "close is audited");
  assert.ok(audit("room.reopen").some((x) => x.roomId === room.id && x.byCreator === true), "reopen is audited");
  // a person who is not in the room cannot even see it (404), so cannot close it
  assert.throws(() => rooms.closeRoom(A(chen), room.id), (e) => e.status === 404);
});

test("精靈 menu: first read is the company roles I may call, then my own choices", () => {
  const r1 = ag.createAgent(admin.id, { name: "客服", description: "客服回覆", system_prompt: "你是客服" });
  const r2 = ag.createAgent(admin.id, { name: "週報", description: "寫週報", system_prompt: "你寫週報" });
  assert.deepEqual(pa.menuFor(A(lin)).map((m) => m.name), ["客服", "週報"]);
  assert.ok(pa.menuFor(A(lin)).every((m) => m.kind === "company"));
  const r3 = ag.createAgent(admin.id, { name: "新角色", description: "", system_prompt: "x" });
  assert.ok(!pa.menuFor(A(lin)).some((m) => m.id === r3.id), "a role created later is not forced into an existing menu");
  assert.ok(pa.browse(A(lin)).some((m) => m.id === r3.id && !m.inMenu));
  pa.addToMenu(A(lin), r3.id);
  assert.deepEqual(pa.menuFor(A(lin)).map((m) => m.name), ["客服", "週報", "新角色"]);
  pa.reorderMenu(A(lin), [r3.id, r1.id]);
  assert.deepEqual(pa.menuFor(A(lin)).map((m) => m.name), ["新角色", "客服", "週報"], "order is stored per person on the server");
  assert.deepEqual(pa.menuFor(A(wang)).map((m) => m.name), ["客服", "新角色", "週報"], "someone else's menu is untouched (seeded after the new role existed)");
  pa.removeFromMenu(A(lin), r2.id);
  assert.ok(!pa.menuFor(A(lin)).some((m) => m.id === r2.id));
  assert.ok(pa.menuFor(A(wang)).some((m) => m.id === r2.id));
  // a role limited to a group is not even addable by an outsider
  const g = acc.createGroup(null, { name: "財務部" });
  const hidden = ag.createAgent(admin.id, { name: "財務專用", description: "", system_prompt: "x", group_ids: [g.id] });
  assert.throws(() => pa.addToMenu(A(lin), hidden.id), (e) => e.status === 404);
  assert.equal(pa.startable(A(lin), hidden.id), false);
});

test("my own agent: build, share, pick (use theirs), copy (make it mine); only the owner edits or deletes", () => {
  const mine = pa.createMine(A(lin), { name: "我的客訴", description: "客訴草稿", system_prompt: "請用客氣的語氣", shared: false });
  assert.equal(mine.kind, "mine");
  assert.ok(pa.menuFor(A(lin)).some((m) => m.id === mine.id), "a new agent lands in my menu");
  assert.equal(pa.startable(A(wang), mine.id), false, "private: nobody else can start it");
  assert.throws(() => pa.addToMenu(A(wang), mine.id), (e) => e.status === 404);
  assert.throws(() => pa.updateMine(A(wang), mine.id, { name: "偷改" }), (e) => e.status === 404);
  pa.updateMine(A(lin), mine.id, { shared: true });
  assert.equal(pa.startable(A(wang), mine.id), true);
  const seen = pa.browse(A(wang)).find((m) => m.id === mine.id);
  assert.equal(seen.kind, "shared"); assert.equal(seen.ownerName, "林小華");
  pa.addToMenu(A(wang), mine.id);
  assert.equal(pa.menuFor(A(wang)).find((m) => m.id === mine.id).kind, "shared");
  // cannot edit or delete someone else's, even when shared
  assert.throws(() => pa.updateMine(A(wang), mine.id, { system_prompt: "改掉" }), (e) => e.status === 403);
  assert.throws(() => pa.deleteMine(A(wang), mine.id), (e) => e.status === 403);
  assert.throws(() => pa.deleteMine(A(admin), mine.id), (e) => e.status === 403, "not even an administrator edits a member's agent");
  assert.throws(() => pa.mineDetail(A(wang), mine.id), (e) => e.status === 403);
  // copy = independent: changing the original does not change the copy; the copy is editable by the new owner
  const copy = pa.copyToMine(A(wang), mine.id);
  assert.equal(copy.kind, "mine"); assert.notEqual(copy.id, mine.id);
  pa.updateMine(A(lin), mine.id, { system_prompt: "原版改了" });
  assert.equal(pa.mineDetail(A(wang), copy.id).system_prompt, "請用客氣的語氣");
  pa.updateMine(A(wang), copy.id, { name: "王的客訴" });
  assert.equal(ag.getAgent(mine.id).name, "我的客訴");
  // the copy of a company role carries only text, nothing that grants tools
  const company = ag.listAllAgents().find((a) => a.name === "客服");
  const c2 = pa.copyToMine(A(chen), company.id);
  const row = ag.getAgent(c2.id);
  assert.equal(row.tool_names, null); assert.deepEqual(row.skills, []); assert.equal(row.knowledge_dir, null); assert.equal(row.model, null);
  // delete = leaves every menu; conversations already started keep reading the prompt
  pa.deleteMine(A(lin), mine.id);
  assert.ok(!pa.menuFor(A(wang)).some((m) => m.id === mine.id));
  assert.equal(ag.getAgent(mine.id).enabled, false);
  assert.equal(pa.startable(A(wang), mine.id), false);
  assert.ok(!ag.agentsFor(A(admin)).some((a) => a.id === copy.id), "personal agents are never @-able in a room");
});

test("my agent's name and size rules", () => {
  assert.throws(() => pa.createMine(A(chen), { name: "", system_prompt: "x" }), (e) => e.code === "bad_name");
  assert.throws(() => pa.createMine(A(chen), { name: "ok", system_prompt: "x".repeat(8001) }), (e) => e.code === "too_long");
  pa.createMine(A(chen), { name: "重複", system_prompt: "x" });
  assert.throws(() => pa.createMine(A(chen), { name: "重複", system_prompt: "y" }), (e) => e.status === 409);
  pa.createMine(A(lin), { name: "重複", system_prompt: "y" });   // another person may use the same name
});

test("assignment source: default person, server-set ai/n8n, tabs never overlap", () => {
  const person = asg.createAssignment(A(lin), { title: "v9驗證-人交辦", assigneeId: wang.id });
  assert.equal(person.source, "person");
  const viaFlow = asg.createAssignment(A(admin), { title: "v9驗證-n8n", assigneeId: wang.id }, "n8n");
  const viaAi = asg.createAssignment(A(admin), { title: "v9驗證-AI", assigneeId: wang.id }, "ai");
  assert.equal(viaFlow.source, "n8n"); assert.equal(viaAi.source, "ai");
  const titles = (rows) => rows.map((r) => r.title).sort();
  assert.deepEqual(titles(asg.listAssignments(A(wang), "assigned", undefined, "person")), ["v9驗證-人交辦"]);
  assert.deepEqual(titles(asg.listAssignments(A(wang), "ai")), ["v9驗證-AI", "v9驗證-n8n"]);
  assert.deepEqual(titles(asg.listAssignments(A(lin), "mine", undefined, "person")), ["v9驗證-人交辦"]);
  assert.deepEqual(asg.listAssignments(A(lin), "ai"), [], "someone not involved sees nothing");
  assert.deepEqual(titles(asg.listAssignments(A(admin), "ai")), ["v9驗證-AI", "v9驗證-n8n"], "the flow's owner sees them too");
  assert.equal(asg.listAssignments(A(wang), "assigned").length, 3, "without a source filter nothing changed (公佈欄 keeps the wider view)");
  assert.throws(() => asg.listAssignments(A(wang), "assigned", undefined, "robot"), (e) => e.code === "bad_source");
  // the assignee acts on them like any other
  const done = asg.completeAssignment(A(wang), viaAi.id, "ok");
  assert.equal(done.status, "done"); assert.equal(done.source, "ai");
});

test("an HTTP body cannot choose the source", async () => {
  const { readFileSync } = await import("node:fs");
  const router = readFileSync(new URL("../api/router.ts", import.meta.url), "utf8");
  const create = router.split("async function assignments")[1].split("\n")[2];
  assert.match(create, /createAssignment\(actor, await body\(req\)\)/);
  assert.doesNotMatch(create, /source/);
});

test("item 8: effective model limits = override, else gateway, else default (output capped at half the context)", async () => {
  const { effectiveLimits, defaultLimits } = await import("../provider/settings.ts");
  assert.equal(defaultLimits().maxTokens, 32768, "v10: default raised from 16384");
  assert.deepEqual(effectiveLimits({ contextWindow: 130048, maxTokens: null }), { contextWindow: 130048, maxTokens: 32768 }, "gateway context is used, no override needed");
  assert.deepEqual(effectiveLimits({ contextWindow: 130048, maxTokens: null }, { contextWindow: 65536, maxTokens: 8000 }), { contextWindow: 65536, maxTokens: 8000 }, "override wins");
  assert.deepEqual(effectiveLimits({ contextWindow: 130048, maxTokens: 4000 }), { contextWindow: 130048, maxTokens: 4000 }, "a reported output size is kept");
  assert.deepEqual(effectiveLimits({ contextWindow: null, maxTokens: null }), { contextWindow: 32768, maxTokens: 16384 }, "gateway silent: 32768 context, half of it as output");
  assert.deepEqual(effectiveLimits(undefined, undefined), { contextWindow: 32768, maxTokens: 16384 });
  assert.deepEqual(effectiveLimits({ contextWindow: 8192, maxTokens: null }), { contextWindow: 8192, maxTokens: 4096 }, "default output never above half the context");
  assert.equal(effectiveLimits({ contextWindow: 1024, maxTokens: null }).maxTokens, 512);
});

test("item 8: provisioning writes the effective limits into models.json", async () => {
  const { createServer } = await import("node:http");
  const { readFileSync } = await import("node:fs");
  const srv = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "big", context_length: 130048 }, { id: "quiet" }, { id: "tiny", max_model_len: 8192 }, { id: "set" , context_length: 100000 }] })); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  process.env.TIGERAI_V1_BASE_URL = `http://127.0.0.1:${srv.address().port}/v1`;
  const settings = await import("../provider/settings.ts");
  settings.writeSettings({ ...settings.readSettings(), overrides: { set: { contextWindow: 50000 } } });
  const { provisionV1 } = await import("../provider/v1.ts");
  await provisionV1();
  srv.close();
  const m = Object.fromEntries(JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), "utf8")).providers.tigerai.models.map((x) => [x.id, x]));
  assert.deepEqual([m.big.contextWindow, m.big.maxTokens], [130048, 32768]);
  assert.deepEqual([m.quiet.contextWindow, m.quiet.maxTokens], [32768, 16384]);
  assert.deepEqual([m.tiny.contextWindow, m.tiny.maxTokens], [8192, 4096]);
  assert.deepEqual([m.set.contextWindow, m.set.maxTokens], [50000, 25000], "override wins for the field it sets, the rest follows the default");
});

test("item 9: models are written as reasoning models with the qwen chat-template thinking format; default level medium", async () => {
  const { readFileSync } = await import("node:fs");
  const cfg = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), "utf8")).providers.tigerai;
  assert.ok(cfg.models.length > 0 && cfg.models.every((m) => m.reasoning === true));
  assert.equal(cfg.compat.thinkingFormat, "qwen-chat-template");
  assert.equal(cfg.compat.supportsDeveloperRole, false);
  assert.equal(JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), "utf8")).defaultThinkingLevel, "medium");
});
