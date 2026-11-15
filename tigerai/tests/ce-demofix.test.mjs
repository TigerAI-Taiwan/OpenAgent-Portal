// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Fixes found in the school-course demo run (one section per fix).
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-demofix.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-ce-demofix-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_PERSONAL_ALLOW_PRIVATE = "1";
for (const k of ["TIGERAI_V1_BASE_URL", "TIGERAI_V1_API_KEY_FILE", "TIGERAI_V1_MODELS", "TIGERAI_V1_DEFAULT_MODEL"]) delete process.env[k];
mkdirSync(process.env.TIGERAI_DATA_DIR, { recursive: true });

const acc = await import("../accounts/service.ts");
const pe = await import("../provider/personal.ts");
const pr = await import("../provider/personal-runtime.ts");
const st = await import("../provider/settings.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const alice = mk("alice@example.com", "Alice");

// ---- 1. personal connection limits
test("#1 a personal connection defaults to 16384 output tokens / 128k context and is configurable, capped at 65536", async () => {
  const v = await pe.addPersonal(alice.id, { name: "A", baseUrl: "http://127.0.0.1:9/v1", models: "m1" });
  const c = v.connections[0];
  assert.equal(c.maxTokens, 16384); assert.equal(c.contextWindow, 128000); assert.equal(c.reasoning, false);
  const cfg = pr.providerConfig(alice.id, pe.listPersonal(alice.id)[0]);
  assert.equal(cfg.models[0].maxTokens, 16384); assert.equal(cfg.models[0].contextWindow, 128000); assert.equal(cfg.models[0].reasoning, false);
  const v2 = await pe.updatePersonal(alice.id, c.id, { maxTokens: 40000, contextWindow: 200000, reasoning: true });
  assert.equal(v2.connections[0].maxTokens, 40000);
  const cfg2 = pr.providerConfig(alice.id, pe.listPersonal(alice.id)[0]);
  assert.equal(cfg2.models[0].maxTokens, 40000); assert.equal(cfg2.models[0].reasoning, true); assert.equal(cfg2.models[0].contextWindow, 200000);
  await assert.rejects(pe.updatePersonal(alice.id, c.id, { maxTokens: 65537 }), /maxTokens/);
  await assert.rejects(pe.updatePersonal(alice.id, c.id, { maxTokens: 12.5 }), /maxTokens/);
  await assert.rejects(pe.updatePersonal(alice.id, c.id, { reasoning: "yes" }), /reasoning/);
  // the answer budget never exceeds half of a small context
  assert.equal(pe.connLimits({ maxTokens: 65536, contextWindow: 8192 }).maxTokens, 4096);
  // an old connection saved without the fields still gets the new defaults
  assert.equal(pe.connLimits({}).maxTokens, 16384);
});
test("#1 admin model connections do not share the 4096 cap", () => {
  const l = st.effectiveLimits(undefined, undefined);
  assert.ok(l.maxTokens >= 8192, `admin default ${l.maxTokens}`);
});

// ---- 2. loop guard
const lg = await import("../agents/loop-guard.ts");
const { getDb } = await import("../db/store.ts");
test("#2 five consecutive empty tool calls trip the guard; a real call resets the streak", () => {
  const g = new lg.LoopGuard({ emptyLimit: 5, errorLimit: 8, callLimit: 200 });
  for (let i = 0; i < 4; i++) assert.equal(g.onCall({}), null);
  assert.equal(g.onCall({ path: "a" }), null, "a call with content resets");
  for (let i = 0; i < 4; i++) assert.equal(g.onCall({ x: "" }), null);
  assert.deepEqual(g.onCall(undefined), { reason: "empty", n: 5 });
  assert.equal(g.onCall({ path: "a" })?.reason, "empty", "once tripped, every later call in the run is refused");
  g.reset(); assert.equal(g.onCall({ path: "a" }), null);
});
test("#2 consecutive errors and the per-run call cap trip too", () => {
  const g = new lg.LoopGuard({ emptyLimit: 5, errorLimit: 3, callLimit: 4 });
  assert.equal(g.onResult(true), null); assert.equal(g.onResult(false), null); assert.equal(g.onResult(true), null); assert.equal(g.onResult(true), null);
  assert.deepEqual(g.onResult(true), { reason: "error", n: 3 });
  const h = new lg.LoopGuard({ emptyLimit: 5, errorLimit: 3, callLimit: 4 });
  for (let i = 0; i < 4; i++) assert.equal(h.onCall({ i: i + 1 }), null);
  assert.equal(h.onCall({ i: 9 })?.reason, "calls");
  assert.ok(/卡住/.test(lg.loopMessage("empty", 5)) && /5/.test(lg.loopMessage("empty", 5)));
});
test("#2 the extension blocks, aborts, writes one zh-TW message and one audit row", () => {
  const handlers = {}; const sent = []; let aborted = 0;
  const pi = { on: (n, f) => { handlers[n] = f; }, sendMessage: (m) => sent.push(m) };
  lg.createLoopGuardExtension({ sessionId: "s-loop", actorId: alice.id }).factory(pi);
  const ctx = { abort: () => { aborted++; }, sessionManager: { getSessionId: () => "s-loop" } };
  handlers.before_agent_start({}, ctx);
  let res;
  for (let i = 0; i < 6; i++) res = handlers.tool_call({ toolName: "read", input: {} }, ctx);
  assert.equal(res.block, true); assert.equal(res.terminate, true);
  assert.equal(aborted, 1); assert.equal(sent.length, 1, "announced once");
  assert.equal(sent[0].display, true); assert.ok(/AI 好像卡住了/.test(sent[0].content));
  const rows = getDb().prepare("SELECT * FROM audit WHERE action = 'agent.loop_guard'").all();
  assert.equal(rows.length, 1); assert.ok(rows[0].extra.includes("empty") && rows[0].extra.includes("s-loop"));
  handlers.agent_settled({}); // next run is clean
  assert.equal(handlers.tool_call({ toolName: "read", input: { path: "x" } }, ctx), undefined);
});

// ---- 3. meeting summary tolerance + one repair retry
const sum = await import("../wizards/meeting/summarize.ts");
const svc = await import("../wizards/meeting/service.ts");
const pctx = { lineCount: 4, today: "2026-11-15", people: [] };
test("#3 parseSummary reads fenced, thinking, trailing-comma, single-quote, smart-quote, wrapped and cut-off answers", () => {
  const body = '{"decisions":[{"text":"月結日改 5 號","lines":[4]}],"actions":[],"suggestions":[]}';
  const cases = {
    think: `<think>讓我想想 {not json}</think>\n${body}`,
    unclosedThink: `<think>想很久...\n${body}`,
    fence: "```JSON\n" + body + "\n```\n以上。",
    trailing: '{"decisions":[{"text":"月結日改 5 號","lines":[4],},],"actions":[],"suggestions":[],}',
    single: "{'decisions':[{'text':'月結日改 5 號','lines':[4]}],'actions':[],'suggestions':[]}",
    smart: '{“decisions”:[{“text”:“月結日改 5 號”,“lines”:[4]}],“actions”:[],“suggestions”:[]}',
    unquotedKeys: '{decisions:[{text:"月結日改 5 號",lines:[4]}],actions:[],suggestions:[]}',
    wrapped: `{"summary":${body}}`,
    strLines: '{"decisions":[{"text":"月結日改 5 號","lines":["[4]"]}],"actions":[],"suggestions":[]}',
    cutOff: '{"decisions":[{"text":"月結日改 5 號","lines":[4]}],"actions":[{"task":"交對帳表","owner":"林小華","due":null,"lines":[1',
  };
  for (const [k, raw] of Object.entries(cases)) {
    const s = sum.parseSummary(raw, pctx);
    assert.ok(s, `${k} parsed`);
    assert.equal(s.decisions[0]?.text, "月結日改 5 號", k);
  }
  assert.equal(sum.parseSummary("sorry, I cannot do that", pctx), null);
});
test("#3 an unreadable first answer is repaired by one stricter second ask; two bad answers still fail", async () => {
  const calls = [];
  let mode = "bad-then-good";
  svc.setModelCall(async (system, user) => {
    calls.push(user);
    if (mode === "bad-then-good" && calls.length === 1) return "好的,以下是摘要:決議一、決議二";
    if (mode === "bad-then-good") return '{"decisions":[{"text":"月結日改 5 號","lines":[4]}],"actions":[],"suggestions":[]}';
    return "still not json";
  });
  const T = "a\nb\nc\n決議:月結日改 5 號";
  const until = async (fn) => { const t = Date.now(); while (Date.now() - t < 4000) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error("timeout"); };
  const A = { id: alice.id, role: alice.role };
  const m = svc.createFromText(A, { title: "修復", transcript: T });
  await until(() => ["done", "failed"].includes(svc.getView(A, m.id).status));
  assert.equal(svc.getView(A, m.id).status, "done");
  assert.equal(calls.length, 2); assert.ok(calls[1].includes("上一次的回答無法被程式讀取") && calls[1].includes("決議一"), "the repair prompt shows the unreadable answer");
  calls.length = 0; mode = "always-bad";
  const m2 = svc.createFromText(A, { title: "壞", transcript: T });
  await until(() => ["done", "failed"].includes(svc.getView(A, m2.id).status));
  assert.equal(svc.getView(A, m2.id).status, "failed"); assert.equal(calls.length, 2, "exactly one retry");
  assert.match(svc.getView(A, m2.id).error, /格式不對/);
  svc.setModelCall(null);
});

// ---- 4. the person's personal model survives a role / app start
test("#4 a role or app start keeps the person's personal model; a role's own model and a public pick win", async () => {
  const adapter = await import("../adapter/index.ts");
  const agents = await import("../agents/service.ts");
  const mc = await import("../api/personal.ts");
  const conn = pe.listPersonal(alice.id)[0];
  const mine = { provider: conn.id, modelId: "m1" };
  const plain = agents.createAgent(admin.id, { name: "Plain" });
  const pinned = agents.createAgent(admin.id, { name: "Pinned", model: { provider: "tigerai", modelId: "m-big" } });
  const req = (role) => new Request("http://x/api/agent/new", { method: "POST", headers: { "x-tg-uid": alice.id, ...(role ? { "x-agent-role": role } : {}) } });
  assert.equal(await adapter.pendingRoleFor(req(), "__new__a"), undefined, "nothing picked yet: upstream behaviour");
  assert.deepEqual(await adapter.pendingRoleFor(req(plain.id), "__new__b"), {}, "nothing picked: role without model has none");
  pe.rememberPick(alice.id, mine.provider, mine.modelId);
  assert.deepEqual(await adapter.pendingRoleFor(req(plain.id), "__new__c"), { initialModel: mine }, "role without a model keeps the personal pick");
  assert.deepEqual(await adapter.pendingRoleFor(req(), "__new__d"), { initialModel: mine }, "an app / plain start keeps it too");
  assert.deepEqual(await adapter.pendingRoleFor(req(pinned.id), "__new__e"), { initialModel: { provider: "tigerai", modelId: "m-big" } }, "a role that sets a model wins");
  assert.deepEqual(mc.mergeModelList({ models: {}, modelList: [], defaultModel: { provider: "tigerai", modelId: "x" }, thinkingLevels: {} }, { id: alice.id, role: "member" }).defaultModel, mine, "the composer shows the same default");
  assert.equal(pe.lastPick(admin.id), null, "someone else's pick is not shared");
  pe.rememberPick(alice.id, "tigerai", "public-model");
  assert.equal(pe.lastPick(alice.id), null, "a public pick clears it");
  pe.rememberPick(alice.id, mine.provider, "not-listed");
  assert.equal(pe.lastPick(alice.id), null, "a model the connection does not list is not remembered");
  pe.rememberPick(alice.id, mine.provider, mine.modelId);
  await pe.updatePersonal(alice.id, conn.id, { enabled: false });
  assert.equal(pe.lastPick(alice.id), null, "a switched-off connection is no longer kept");
  await pe.updatePersonal(alice.id, conn.id, { enabled: true });
});
test("#4 the gate records a model the person names (new conversation or set_model) and channels never read it", async () => {
  const { readFileSync } = await import("node:fs");
  const gate = readFileSync(new URL("../adapter/gate.ts", import.meta.url), "utf8");
  assert.match(gate, /rememberPickFromRequest\(user\.id, body, sid === null\)/);
  const conn = pe.listPersonal(alice.id)[0];
  pe.clearPick(alice.id);
  pe.rememberPickFromRequest(alice.id, { type: "prompt", provider: conn.id, modelId: "m1" }, false);
  assert.equal(pe.lastPick(alice.id), null, "a prompt on a running conversation is not a pick");
  pe.rememberPickFromRequest(alice.id, { type: "set_model", provider: conn.id, modelId: "m1" }, false);
  assert.equal(pe.lastPick(alice.id)?.modelId, "m1");
  pe.clearPick(alice.id);
  pe.rememberPickFromRequest(alice.id, { type: "prompt", provider: conn.id, modelId: "m1" }, true);
  assert.equal(pe.lastPick(alice.id)?.modelId, "m1", "a new conversation naming a model is a pick");
  pe.clearPick(alice.id);
  for (const f of ["../rooms/service.ts", "../rooms/assistant.ts"]) { try { assert.ok(!/lastPick/.test(readFileSync(new URL(f, import.meta.url), "utf8")), f); } catch (e) { if (e.code !== "ENOENT") throw e; } }
});

// ---- 6. API status of an AI order
test("#6 an AI order reads running / review through the API, never 'accepted'; the filter and counts agree", async () => {
  const as = await import("../workorders/assignments.ts");
  const { handle } = await import("../api/router.ts");
  const { getDb } = await import("../db/store.ts");
  assert.equal(as.apiStatus({ status: "accepted", assigneeKind: "ai", runState: "review" }), "review");
  assert.equal(as.apiStatus({ status: "accepted", assigneeKind: "ai", runState: "running" }), "running");
  assert.equal(as.apiStatus({ status: "accepted", assigneeKind: "user", runState: null }), "accepted", "a person's accepted order is unchanged");
  assert.equal(as.apiStatus({ status: "done", assigneeKind: "ai", runState: null }), "done");
  const now = Date.now();
  const ins = getDb().prepare("INSERT INTO assignments (id,title,description,applicant_id,assignee_id,created_at,updated_at,source,assignee_kind,status,run_state,accepted_at) VALUES (?,?,?,?,?,?,?,'ai','ai','accepted',?,?)");
  ins.run("aiRev", "AI 完成待確認", "", alice.id, "ai:general", now, now, "review", now);
  ins.run("aiRun", "AI 進行中", "", alice.id, "ai:general", now, now, "running", now);
  const call = async (path) => { const r = await handle(new Request(`http://x/api/tg/${path}`, { headers: { "x-tg-uid": alice.id } }), path.split("?")[0].split("/")); return r.json(); };
  assert.equal((await call("assignments/aiRev")).assignment.status, "review");
  const all = (await call("assignments?scope=mine")).assignments;
  assert.equal(all.find((a) => a.id === "aiRev").status, "review"); assert.equal(all.find((a) => a.id === "aiRun").status, "running");
  assert.deepEqual((await call("assignments?scope=mine&status=review")).assignments.map((a) => a.id), ["aiRev"]);
  assert.deepEqual((await call("assignments?scope=mine&status=running")).assignments.map((a) => a.id), ["aiRun"]);
  const items = (await call("bulletin/personal")).items.filter((i) => i.kind === "assignment");
  assert.ok(items.length > 0 && items.every((i) => i.assignment.status === "review"), "the personal list shows the same words");
  assert.equal((await call("assignments/count")).aiReview, 1);
});

// ---- 7. join-code member count = students only
test("#7 the join-code member count leaves out the teacher (admin), class heads and disabled accounts", async () => {
  const reg = await import("../register/service.ts");
  const g = acc.createGroup(admin.id, { name: "三年一班" });
  const head = mk("head7@example.com", "班長");
  const s1 = mk("s1@example.com", "學生一"); const s2 = mk("s2@example.com", "學生二"); const off = mk("off@example.com", "停用");
  acc.setMembership(admin.id, g.id, admin.id, true, false);
  acc.setMembership(admin.id, g.id, head.id, true, true);
  for (const u of [s1, s2, off]) acc.setMembership(admin.id, g.id, u.id, true, false);
  acc.setUserStatus?.(admin.id, off.id, "disabled");
  if (!acc.setUserStatus) (await import("../db/store.ts")).getDb().prepare("UPDATE users SET status='disabled' WHERE id=?").run(off.id);
  const v = reg.listCodes({ id: admin.id, role: "admin" }).find((c) => c.groupId === g.id);
  assert.equal(v.members, 2);
  const zh = (await import("../pages/i18n-school.ts"));
  const src = (await import("node:fs")).readFileSync(new URL("../pages/i18n-school.ts", import.meta.url), "utf8");
  assert.ok(src.includes('jcMembers: "學生 {n} 人"'));
  assert.ok(zh);
});
test("#4 a plain new conversation (the menu's 新對話) clears the kept model", async () => {
  const { handle } = await import("../api/router.ts");
  const conn = pe.listPersonal(alice.id)[0];
  pe.rememberPick(alice.id, conn.id, "m1");
  assert.ok(pe.lastPick(alice.id));
  const r = await handle(new Request("http://x/api/tg/personal-models/pick", { method: "DELETE", headers: { "x-tg-uid": alice.id } }), ["personal-models", "pick"]);
  assert.equal(r.status, 200); assert.equal(pe.lastPick(alice.id), null);
});
