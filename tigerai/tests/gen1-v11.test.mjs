// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Batch v11 (交辦 two tabs, 交辦給 AI, background run, notification to the applicant):
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-v11.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
// A database made by v10: the old assignments table, one finished and one open row. The migration must keep both as 'user'.
mkdirSync(process.env.TIGERAI_DATA_DIR, { recursive: true });
{
  const old = new DatabaseSync(join(process.env.TIGERAI_DATA_DIR, "tigerai.db"));
  old.exec(`CREATE TABLE assignments (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', applicant_id TEXT NOT NULL, assignee_id TEXT NOT NULL,
    due_date INTEGER, session_id TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','done','returned')), return_reason TEXT, done_note TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, accepted_at INTEGER, finished_at INTEGER, source TEXT NOT NULL DEFAULT 'person')`);
  old.exec("INSERT INTO assignments (id,title,applicant_id,assignee_id,status,created_at,updated_at) VALUES ('old1','舊單','u1','u2','open',1,1),('old2','舊單2','u1','u2','done',1,1)");
  old.close();
}

const acc = await import("../accounts/service.ts");
const ag = await import("../agents/service.ts");
const asg = await import("../workorders/assignments.ts");
const run = await import("../workorders/ai-run.ts");
const push = await import("../push/index.ts");
const bul = await import("../bulletin/service.ts");
const bstore = await import("../ui/bulletin-store.ts").catch(() => null);
const { getDb } = await import("../db/store.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const lin = mk("lin@example.com", "林小華");
const wang = mk("wang@example.com", "王小明");
const chen = mk("chen@example.com", "陳大文");
const A = (u) => ({ id: u.id, role: u.role });
const audit = (action) => getDb().prepare("SELECT extra FROM audit WHERE action=?").all(action).map((r) => JSON.parse(r.extra ?? "{}"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await sleep(20); } throw new Error("condition not reached"); };

// A fake runtime: the test decides what the "AI" answers and when.
let calls = [];
let behave = async () => ({ text: "- 結論 A\n- 出處 B" });
run.setAiDriver({ async run(req) { calls.push({ prompt: req.prompt, sessionId: req.sessionId, applicant: req.applicant.id, agent: req.agent?.id ?? null });
  const sid = req.sessionId ?? `sess-${calls.length}`; req.onSession(sid); const r = await behave(req); return { sessionId: sid, text: r.text ?? "", error: r.error }; } });
const pushes = [];
push.setPushSender(async (t, payload) => { pushes.push({ endpoint: t.endpoint, payload }); });
const sub = (userId, n) => push.saveSubscription(userId, { endpoint: `https://push.example/${n}`, keys: { p256dh: "p", auth: "a" } });

test("migration keeps old rows as 'user' and the old CHECK still holds", () => {
  const rows = getDb().prepare("SELECT id, assignee_kind AS k, run_state AS r FROM assignments WHERE id IN ('old1','old2') ORDER BY id").all();
  assert.deepEqual(rows.map((x) => [x.id, x.k, x.r]), [["old1", "user", null], ["old2", "user", null]]);
  const o = asg.getAssignment("old1");
  assert.equal(o.assigneeKind, "user"); assert.equal(o.runState, null);
});

test("tabs: 交辦我 shows everything handed to me with its source; 我交辦 filters 人 / AI", async () => {
  const p = asg.createAssignment(A(wang), { title: "王給林", assigneeId: lin.id });
  const ai = asg.createAssignment(A(lin), { title: "林給AI", assigneeKind: "ai" });
  behave = async () => ({ text: "x" });
  run.startAiRun(ai.id);
  await until(() => asg.getAssignment(ai.id).runState === "review");
  const flow = asg.createAssignment(A(wang), { title: "流程給林", assigneeId: lin.id }, "n8n");
  const toMe = asg.listAssignments(A(lin), "assigned").map((x) => [x.title, x.source]);
  assert.deepEqual(toMe.sort(), [["流程給林", "n8n"], ["王給林", "person"]].sort(), "my own AI order is not in 交辦我");
  assert.ok(!asg.listAssignments(A(lin), "assigned").some((x) => x.id === ai.id));
  assert.deepEqual(asg.listAssignments(A(wang), "mine", undefined, undefined, "user").map((x) => x.title).sort(), ["流程給林", "王給林"].sort());
  assert.deepEqual(asg.listAssignments(A(lin), "mine", undefined, undefined, "ai").map((x) => x.title), ["林給AI"]);
  assert.deepEqual(asg.listAssignments(A(lin), "mine").map((x) => x.title), ["林給AI"]);
  assert.throws(() => asg.listAssignments(A(lin), "mine", undefined, undefined, "robot"), (e) => e.code === "bad_kind");
  assert.ok(p.id && flow.id);
  asg.completeAssignment(A(lin), p.id); // a person's order still works as before
});

test("role permission: only a role the applicant may start; flows and keys can never hand work to an AI", () => {
  const closed = ag.createAgent(admin.id, { name: "財務專用", system_prompt: "p", group_ids: ["nope-group"] });
  const open = ag.createAgent(admin.id, { name: "通用研究", system_prompt: "p", group_ids: [] });
  assert.throws(() => asg.createAssignment(A(lin), { title: "t", assigneeKind: "ai", agentId: closed.id }), (e) => e.code === "bad_agent" && e.status === 403);
  assert.throws(() => asg.createAssignment(A(lin), { title: "t", assigneeKind: "ai", agentId: "no-such" }), (e) => e.code === "bad_agent");
  assert.throws(() => asg.createAssignment(A(lin), { title: "t", assigneeKind: "ai" }, "n8n"), (e) => e.code === "bad_assignee");
  assert.throws(() => asg.createAssignment(A(lin), { title: "t", assigneeKind: "robot" }), (e) => e.code === "bad_assignee");
  const ok = asg.createAssignment(A(lin), { title: "用角色", assigneeKind: "ai", agentId: open.id });
  assert.equal(ok.agentId, open.id); assert.equal(ok.agentName, "通用研究"); assert.equal(ok.assigneeKind, "ai");
  // the router passes the body of POST /assignments only; the inbound hook strips these fields
  assert.match(readFileSync(new URL("../n8n/inbound.ts", import.meta.url), "utf8"), /assigneeKind: undefined, agentId: undefined/);
});

test("background run: the prompt is title + description + the closing request, in the applicant's name, with the role", async () => {
  calls = []; behave = async () => ({ text: "結果文字" });
  const role = ag.createAgent(admin.id, { name: "研究員", system_prompt: "p", group_ids: [] });
  const a = asg.createAssignment(A(lin), { title: "整理月結檢查項目", description: "三個就好", assigneeKind: "ai", agentId: role.id });
  assert.equal(a.runState, "running"); assert.equal(a.status, "accepted");
  run.startAiRun(a.id);
  await until(() => asg.getAssignment(a.id).runState === "review");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, `整理月結檢查項目\n\n三個就好\n\n${run.PROMPT_SUFFIX}`);
  assert.equal(calls[0].applicant, lin.id); assert.equal(calls[0].agent, role.id);
  const done = asg.getAssignment(a.id);
  assert.equal(done.aiResult, "結果文字"); assert.equal(done.aiNote, null); assert.ok(done.sessionId, "conversation is linked");
  assert.equal(done.status, "accepted", "the AI never completes the order");
  assert.ok(audit("assignment.ai_start").some((x) => x.assignmentId === a.id));
  assert.ok(audit("assignment.ai_finish").some((x) => x.assignmentId === a.id && x.outcome === "ok"));
});

test("status machine: only the applicant confirms or returns; return needs a reason and runs again in the same conversation", async () => {
  calls = []; let n = 0; behave = async () => ({ text: `第${++n}輪` });
  const a = asg.createAssignment(A(lin), { title: "退回測試", description: "d", assigneeKind: "ai" });
  run.startAiRun(a.id);
  await until(() => asg.getAssignment(a.id).runState === "review");
  const sid = asg.getAssignment(a.id).sessionId;
  // not while running / not by someone else / admin is read-only
  assert.throws(() => run.confirmAiAssignment(A(wang), a.id), (e) => e.status === 404, "another member cannot even see it");
  assert.throws(() => run.confirmAiAssignment(A(admin), a.id), (e) => e.status === 403, "admin reads only");
  assert.throws(() => run.returnAiAssignment(A(lin), a.id, "  "), (e) => e.code === "reason_required");
  assert.throws(() => asg.completeAssignment(A(lin), a.id), (e) => e.status === 403, "the person-flow functions do not act on an AI order");
  assert.ok(asg.requireVisible(A(admin), a.id), "admin can read");
  const back = run.returnAiAssignment(A(lin), a.id, "請補上第三項");
  assert.equal(back.runState, "running"); assert.equal(back.returnReason, "請補上第三項");
  assert.throws(() => run.confirmAiAssignment(A(lin), a.id), (e) => e.code === undefined || e.status === 409, "cannot confirm while the AI works");
  await until(() => asg.getAssignment(a.id).runState === "review" && asg.getAssignment(a.id).aiResult === "第2輪");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].prompt, "請補上第三項"); assert.equal(calls[1].sessionId, sid, "same conversation");
  assert.equal(asg.getAssignment(a.id).runCount, 1);
  const fin = run.confirmAiAssignment(A(lin), a.id, "ok");
  assert.equal(fin.status, "done"); assert.equal(fin.runState, null);
  assert.throws(() => run.returnAiAssignment(A(lin), a.id, "again"), (e) => e.status === 409 || /final/.test(String(e.message)));
  for (const act of ["assignment.create", "assignment.return", "assignment.complete"]) assert.ok(audit(act).some((x) => x.assignmentId === a.id), act);
});

test("failure ends in 待確認 with the reason, never stuck in 進行中; no time limit exists", async () => {
  behave = async () => ({ text: "", error: "模型服務回應:503" });
  const a = asg.createAssignment(A(lin), { title: "會失敗", assigneeKind: "ai" });
  run.startAiRun(a.id);
  await until(() => asg.getAssignment(a.id).runState === "review");
  assert.match(asg.getAssignment(a.id).aiNote, /^執行失敗:/);
  behave = async () => { throw new Error("boom"); };
  const b = asg.createAssignment(A(lin), { title: "會丟例外", assigneeKind: "ai" });
  run.startAiRun(b.id);
  await until(() => asg.getAssignment(b.id).runState === "review");
  assert.match(asg.getAssignment(b.id).aiNote, /boom/);
  behave = async () => ({ text: "  " });
  const c = asg.createAssignment(A(lin), { title: "空的", assigneeKind: "ai" });
  run.startAiRun(c.id);
  await until(() => asg.getAssignment(c.id).runState === "review");
  assert.equal(asg.getAssignment(c.id).aiNote, run.NOTE_EMPTY);
  const src = readFileSync(new URL("../workorders/ai-run.ts", import.meta.url), "utf8") + readFileSync(new URL("../workorders/ai-driver.ts", import.meta.url), "utf8");
  assert.ok(!/setTimeout\([^)]*abort|timeoutMs|TIMEOUT/.test(src.replace(/setTimeout\(\(\) => startAiRun/, "")), "no run timer in the AI run code");
});

test("server restart: runs that were 進行中 become 待確認 with the note; runs of this process are left alone", async () => {
  let release;
  behave = () => new Promise((r) => { release = r; });
  const live = asg.createAssignment(A(lin), { title: "還在跑", assigneeKind: "ai" });
  run.startAiRun(live.id);
  await until(() => !!release);
  // a leftover from a previous process: running in the table, nothing in memory
  const orphan = asg.createAssignment(A(wang), { title: "上次沒做完", assigneeKind: "ai" });
  assert.ok(run.sweepInterruptedRuns() >= 1, "orphans (this test's and earlier tests' un-started ones) are handed back");
  assert.equal(run.sweepInterruptedRuns(), 0, "once per process");
  assert.equal(asg.getAssignment(orphan.id).runState, "review");
  assert.equal(asg.getAssignment(orphan.id).aiNote, run.NOTE_RESTART);
  assert.equal(asg.getAssignment(live.id).runState, "running");
  release({ text: "好了" });
  await until(() => asg.getAssignment(live.id).runState === "review");
});

test("notification: once per transition into 待確認, to the applicant's own devices only, title only", async () => {
  pushes.length = 0; behave = async () => ({ text: "秘密內容不能出現在通知裡" });
  sub(lin.id, "lin-phone"); sub(lin.id, "lin-pc"); sub(wang.id, "wang-phone");
  const before = audit("assignment.ai_notify").length;
  const a = asg.createAssignment(A(lin), { title: "要通知的單", assigneeKind: "ai" });
  run.startAiRun(a.id);
  await until(() => asg.getAssignment(a.id).runState === "review");
  await until(() => pushes.length >= 2);
  await sleep(100);
  assert.deepEqual(pushes.map((p) => p.endpoint).sort(), ["https://push.example/lin-pc", "https://push.example/lin-phone"], "never wang's device");
  assert.match(pushes[0].payload.title, /^AI 做完了:要通知的單$/);
  assert.ok(!JSON.stringify(pushes[0].payload).includes("秘密"), "no result text in the notification");
  assert.equal(pushes[0].payload.url, `/?assignment=${a.id}`);
  assert.equal(audit("assignment.ai_notify").length, before + 1, "audited once");
  // reading the order again, polling or sweeping must not notify again
  asg.getAssignment(a.id); run.resetSweepForTests(); run.sweepInterruptedRuns();
  await sleep(100);
  assert.equal(pushes.length, 2);
  // a return and a new finish is a new transition: notified again
  run.returnAiAssignment(A(lin), a.id, "再做一次");
  await until(() => asg.getAssignment(a.id).runState === "review" && pushes.length >= 4);
  assert.equal(audit("assignment.ai_notify").length, before + 2);
  // error and restart carry their own wording
  pushes.length = 0;
  behave = async () => ({ text: "", error: "x" });
  const e = asg.createAssignment(A(lin), { title: "壞單", assigneeKind: "ai" });
  run.startAiRun(e.id);
  await until(() => pushes.length >= 2);
  assert.match(pushes[0].payload.title, /^AI 做的時候出了問題:壞單$/);
  // a subscription of another person on the same browser moves; saving junk is refused
  assert.throws(() => push.saveSubscription(lin.id, { endpoint: "http://insecure", keys: { p256dh: "p", auth: "a" } }), (x) => x.status === 400);
  push.saveSubscription(wang.id, { endpoint: "https://push.example/lin-pc", keys: { p256dh: "p", auth: "a" } });
  assert.equal(push.subscriptionCount(lin.id), 1);
  push.setPushSender(async () => { const err = new Error("gone"); err.statusCode = 410; throw err; });
  await push.pushToUser(lin.id, { title: "t", body: "b", url: "/", tag: "x" });
  assert.equal(push.subscriptionCount(lin.id), 0, "a dead endpoint is dropped");
  push.setPushSender(async () => { throw new Error("network"); });
  await assert.doesNotReject(push.pushToUser(wang.id, { title: "t", body: "b", url: "/", tag: "x" }));
});

test("bell and home: AI orders waiting for me count and are listed; only for the applicant", async () => {
  behave = async () => ({ text: "ok" });
  const a = asg.createAssignment(A(chen), { title: "王的AI單", assigneeKind: "ai" });
  const s0 = bul.bulletinSummary(A(chen));
  assert.equal(s0.aiRunning, 1); assert.equal(s0.aiReview.length, 0);
  run.startAiRun(a.id);
  await until(() => asg.getAssignment(a.id).runState === "review");
  const s = bul.bulletinSummary(A(chen));
  assert.equal(s.aiRunning, 0);
  assert.deepEqual(s.aiReview.map((x) => x.id), [a.id]);
  assert.ok(s.count >= 1 && s.parts.assignments >= 1, "counts in the bell");
  assert.equal(asg.pendingCount(A(chen)).aiReview, 1);
  assert.ok(!bul.bulletinSummary(A(lin)).aiReview.some((x) => x.id === a.id), "not in someone else's summary");
  assert.ok(!bul.bulletinSummary(A(admin)).aiReview.some((x) => x.id === a.id), "nor the admin's");
  run.confirmAiAssignment(A(chen), a.id);
  assert.equal(bul.bulletinSummary(A(chen)).aiReview.length, 0);
});

test("toast detection: the first look only records; a new 待確認 toasts once; a returned-then-finished order toasts again", () => {
  if (!bstore) return; // the UI module needs a browser-ish import chain; covered live
  const o = (id, note = null) => ({ id, title: `T${id}`, note });
  let r = bstore.toastsFor([o("1")], null);
  assert.equal(r.fresh.length, 0);
  r = bstore.toastsFor([o("1"), o("2")], r.seen);
  assert.deepEqual(r.fresh.map((t) => t.id), ["2"]);
  r = bstore.toastsFor([o("1"), o("2")], r.seen);
  assert.equal(r.fresh.length, 0, "no repeat");
  r = bstore.toastsFor([o("1")], r.seen);
  r = bstore.toastsFor([o("1"), o("2", "執行失敗:x")], r.seen);
  assert.match(r.fresh[0].text, /出了問題/);
});

// ---------------------------------------------------------------- `#` prompts
const pick = await import("../prompts/pick.ts");
const ps = await import("../prompts/service.ts");

test("# query: only at the start or after whitespace; C#, issue#42 and a bare #3 in text do not open it", () => {
  const q = pick.extractPromptQuery;
  assert.deepEqual(q("#"), { start: 0, query: "" });
  assert.deepEqual(q("請幫我 #客訴"), { start: 4, query: "客訴" });
  assert.deepEqual(q("a\n#x"), { start: 2, query: "x" });
  for (const t of ["C#", "issue#42", "abc#d", "#a b", "##", "好 #a#"]) assert.equal(q(t), null, t);
  // `#3` does match as a query "3": the popup then shows only when something matches (the component's rule), so typing is not hijacked
  const items = [{ id: "1", name: "客訴回覆", description: "" }];
  assert.equal(pick.filterPrompts(items, "3").length, 0);
});

test("# matching: name prefix first, then contains, then description; empty query lists all", () => {
  const items = [
    { id: "a", name: "月結檢查", description: "" }, { id: "b", name: "客訴回覆", description: "" },
    { id: "c", name: "會議紀錄", description: "客訴後的會議" }, { id: "d", name: "回覆客訴範本", description: "" },
  ];
  assert.deepEqual(pick.filterPrompts(items, "客訴").map((x) => x.id), ["b", "d", "c"]);
  assert.equal(pick.filterPrompts(items, "").length, 4);
  assert.deepEqual(pick.filterPrompts(items, "ＺＺ"), []);
  assert.deepEqual(pick.replaceQuery("請 #客訴 然後", { start: 2, query: "客訴" }, 5, "內容"), { text: "請 內容 然後", caret: 4 });
});

test("# render: system variables fill themselves, asked ones need a value, one render function", () => {
  const body = "日期 {{CURRENT_DATE}},{{USER_NAME}}({{USER_EMAIL}}) 客戶 {{客戶名}} 語氣 {{tone | 禮貌}} 再次 {{客戶名}} {{不存在}}";
  const v = pick.variablesOf(body);
  assert.deepEqual(v.map((x) => [x.name, x.system]), [["CURRENT_DATE", true], ["USER_NAME", true], ["USER_EMAIL", true], ["客戶名", false], ["tone", false], ["不存在", false]]);
  assert.deepEqual(pick.missingRequired(body, { 客戶名: "王" }), ["不存在"], "tone has a default, 客戶名 is filled");
  assert.deepEqual(pick.missingRequired(body, {}), ["客戶名", "不存在"]);
  const out = pick.renderPrompt(body, { 客戶名: "王先生", 不存在: "x" }, { userName: "林小華", userEmail: "lin@example.com", now: new Date(2026, 10, 15, 9, 5) });
  assert.equal(out, "日期 2026/11/15,林小華(lin@example.com) 客戶 王先生 語氣 禮貌 再次 王先生 x");
  assert.equal(pick.renderPrompt("{{沒填}}", {}), "{{沒填}}", "an unknown variable stays visible");
  assert.deepEqual(pick.variablesOf("沒有變數"), []);
});

test("# visibility: a member sees their own and what is published to their groups, never someone else's private prompt", () => {
  const g = acc.createGroup(admin.id, { name: "財務部" });
  acc.setMembership(admin.id, g.id, lin.id, true);
  const mineP = ps.createMine(A(lin), { name: "我的月結", body: "月結 {{月份}}" });
  const wangP = ps.createMine(A(wang), { name: "王的私房", body: "secret" });
  const lib = ps.publish(A(admin), { name: "公司客訴", body: "客訴 {{USER_NAME}}" });
  const other = ps.publish(A(admin), { name: "別部門的", body: "x" });
  ps.setTick(A(admin), lib.id, g.id, true);
  const names = (u) => ps.pickablePrompts(u).map((p) => p.name).sort();
  assert.deepEqual(names(lin), ["公司客訴", "我的月結"].sort());
  assert.ok(ps.pickablePrompts(lin).find((p) => p.name === "我的月結").mine);
  assert.ok(!ps.pickablePrompts(lin).find((p) => p.name === "公司客訴").mine);
  assert.deepEqual(names(wang), ["王的私房"], "wang is in no group: nothing from the library, and not lin's");
  assert.ok(!names(lin).includes(wangP.name) && !names(lin).includes(other.name));
  assert.ok(mineP.id);
});
