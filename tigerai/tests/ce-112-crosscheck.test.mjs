// 1.1.2-ce item 11: 對照模型 (second ASR) + glossary marks + the summary self-check.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
const dir = mkdtempSync(join(tmpdir(), "tg-112-cc-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
delete process.env.TIGERAI_ASR_URL;
const acc = await import("../accounts/service.ts");
const cc = await import("../wizards/meeting/crosscheck.ts");
const sum = await import("../wizards/meeting/summarize.ts");
const asr = await import("../wizards/meeting/asr-settings.ts");
const svc = await import("../wizards/meeting/service.ts");
const { getDb } = await import("../db/store.ts");
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: "Test-Pass-12345!", mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const lin = mk("lin@example.com", "林小華");
const A = (u) => ({ id: u.id, role: u.role });
const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error("condition not reached"); };

const MAIN = ["林小華:這批治具的首件要在十一月二十日前交給品保。", "王小明:製具的模具費由客戶負擔,報價單有效三十天。", "林小華:供應商對帳單目前沒人接,先放著。", "王小明:下次開會討論八D報告的追蹤。"];
const OTHER = "林小華,這批治具的首件要在十一月二十日前交給品保。王小明,治具的模具費由客戶負擔,報價單有效三十天。林小華,供應商對帳單目前沒人接先放著。王小明,下次開會討論八D報告的追蹤。";

test("crossCheck: identical text is not flagged; a differing line is flagged with what the other model heard; the main lines are untouched", () => {
  const same = cc.crossCheck(MAIN, OTHER, []);
  assert.deepEqual(same.flags, []);
  assert.ok(same.agreement > 0.9, String(same.agreement));
  const diff = OTHER.replace("治具的模具費由客戶負擔", "支距的墓具費由客戶負單");
  const r = cc.crossCheck(MAIN, diff, []);
  assert.deepEqual(r.flags.map((f) => f.line), [2]);
  assert.deepEqual(r.flags[0].kinds, ["disagree"]);
  assert.match(r.flags[0].other, /支距的墓具費/);
  assert.equal(MAIN[1], "王小明:製具的模具費由客戶負擔,報價單有效三十天。", "the main transcript is never rewritten");
  assert.ok(r.agreement < same.agreement);
});
test("glossary: the second model wrote the listed term where the main model wrote something else; a one-character near miss is marked even without a second model", () => {
  const withOther = cc.crossCheck(MAIN, OTHER, ["治具", "首件", "八D"]);
  const g = withOther.flags.find((f) => f.line === 2);
  assert.ok(g && g.kinds.includes("glossary") && g.term === "治具", JSON.stringify(withOther.flags));
  assert.equal(withOther.flags.some((f) => f.line === 1), false, "a line that has the term as listed is fine");
  const alone = cc.crossCheck([...MAIN.slice(0, 3), "王小明:下次開會討論八B報告的追蹤。"], null, ["治具", "八D報告"]);
  assert.deepEqual(alone.flags.map((f) => [f.line, f.term]), [[4, "八D報告"]], "八B報告 is one character off 八D報告; 製具 vs 治具 is only judged with a second model (2-character terms)");
  // a digit that differs is always worth a second listen
  const num = cc.crossCheck(["報價有效三十天,數量 500 件"], "報價有效三十天數量 800 件", []);
  assert.deepEqual(num.flags.map((f) => f.kinds), [["disagree"]]);
});
test("nearMiss: same length, exactly one character different, 3+ characters", () => {
  assert.equal(cc.nearMiss("這個首建很重要", "首件"), null, "2-character terms need the second model");
  assert.equal(cc.nearMiss("請看八D報告", "八D報告"), null, "exact");
  assert.ok(cc.nearMiss("請看八B報告", "八D報告"));
  assert.equal(cc.nearMiss("請看九B告", "八D報告"), null, "two off");
});
test("selfCheck: missing owner / deadline are counted, a doubtful source line and an unsupported number are marked, a clean summary says so", () => {
  const lines = ["王小明:報價有效三十天,數量 500 件。", "林小華:我負責,下週五交。", "沒人接的對帳單"];
  const answer = JSON.stringify({
    decisions: [{ text: "報價有效 90 天", lines: [1] }, { text: "數量 500 件", lines: [1] }],
    actions: [{ task: "交對帳表", owner: "林小華", due: "2099-01-15", lines: [2] }, { task: "對帳單", owner: null, due: null, lines: [3] }],
    suggestions: [],
  });
  const s = sum.parseSummary(answer, { lineCount: 3, today: "2026-11-15", people: [{ id: "u1", name: "林小華" }], lines, flagged: new Set([3]) });
  assert.ok(s.check);
  assert.equal(s.check.items, 4); assert.equal(s.check.withSource, 4);
  assert.equal(s.check.actionsNoOwner, 1); assert.equal(s.check.actionsNoDue, 1);
  assert.equal(s.check.uncertain, 1); assert.equal(s.actions[1].uncertain, true);
  assert.equal(s.check.numberMismatch, 0, "the transcript spells 三十 in Chinese, so the digit 90 cannot be compared: no false alarm");
  assert.equal(s.check.clean, false);
  const lines2 = ["王小明:報價有效 30 天。"];
  const s2 = sum.parseSummary(JSON.stringify({ decisions: [{ text: "報價有效 90 天", lines: [1] }, { text: "報價有效 30 天", lines: [1] }], actions: [], suggestions: [] }), { lineCount: 1, today: "2026-11-15", people: [], lines: lines2 });
  assert.equal(s2.decisions[0].numberCheck, true); assert.equal(s2.decisions[1].numberCheck, undefined);
  assert.equal(s2.check.numberMismatch, 1);
  const md = sum.renderSummary({ title: "t", date: "2026-11-15" }, s2, lines2, "room");
  assert.match(md, /數字待核對/); assert.match(md, /自我檢查/);
  const s3 = sum.parseSummary(JSON.stringify({ decisions: [{ text: "報價有效 30 天", lines: [1] }], actions: [{ task: "x", owner: "林小華", due: "2099-01-01", lines: [1] }], suggestions: [] }), { lineCount: 1, today: "2026-11-15", people: [{ id: "u1", name: "林小華" }], lines: lines2 });
  assert.equal(s3.check.clean, true);
  assert.match(sum.renderSummary({ title: "t", date: "2026-11-15" }, s3, lines2, "room"), /都有逐字稿出處/);
  assert.match(sum.buildUserPrompt(lines, { title: "t", today: "2026-11-15", people: [], flagged: new Set([3]) }), /\[3\] 沒人接的對帳單 〔此行待確認〕/);
});

test("settings: the 對照模型 has its own address, model and key (mode 600, last four only), the key follows its address, nothing without a main service", async () => {
  assert.equal(asr.effectiveCompare(), null);
  const { createServer } = await import("node:http");
  const seen = [];
  const srv = createServer((req, res) => { seen.push(req.headers.authorization); req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: "ok" })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  asr.saveAsr(admin.id, { compareUrl: base, compareModel: "cmp-1", compareApiKey: "cmp-secret-9876" });
  assert.equal(asr.effectiveCompare(), null, "a second model alone does nothing: the main service decides");
  const v = asr.saveAsr(admin.id, { url: `${base}`, apiKey: "main-secret-1111", model: "main-1" });
  assert.equal(v.compareKeyLast4, "9876"); assert.equal(v.hasCompareKey, true); assert.equal(JSON.stringify(v).includes("secret"), false);
  assert.equal(statSync(asr.compareKeyFile()).mode & 0o777, 0o600);
  assert.equal(asr.effectiveCompare().model, "cmp-1");
  const t = await asr.testAsr({ target: "compare" });
  assert.equal(t.ok, true, JSON.stringify(t)); assert.equal(seen.at(-1), "Bearer cmp-secret-9876", "the compare test uses the compare key, not the main one");
  assert.throws(() => asr.saveAsr(admin.id, { compareUrl: "http://127.0.0.1:9/v1" }), (e) => e.code === "key_required", "the saved key is not sent to another address");
  asr.saveAsr(admin.id, { compareUrl: "http://127.0.0.1:9/v1", compareApiKey: "another-key-0000" });
  assert.equal(asr.viewAsr().compareKeyLast4, "0000");
  asr.saveAsr(admin.id, { compareUrl: "" });
  assert.equal(asr.effectiveCompare(), null); assert.equal(asr.viewAsr().hasCompareKey, false, "no address, no key left behind");
  srv.close();
});

test("pipeline: both services get the file, the main transcript is kept as is, flags and times are stored, a failing second model does not fail the meeting", async () => {
  asr.saveAsr(admin.id, { url: "http://127.0.0.1:9/v1", apiKey: "main-key-2222", model: "main-1", compareUrl: "http://127.0.0.1:9/v1", compareModel: "cmp-1", compareApiKey: "cmp-key-3333", glossary: "治具\n首件\n八D" });
  const modelAnswer = JSON.stringify({ decisions: [{ text: "模具費由客戶負擔", lines: [2] }], actions: [{ task: "對帳單", owner: null, due: null, lines: [3] }], suggestions: [] });
  svc.setModelCall(async () => "```json\n" + modelAnswer + "\n```");
  const wait = (id) => until(() => ["done", "failed"].includes(svc.getView(A(lin), id).status));
  const body = (b) => Readable.toWeb(Readable.from([Buffer.from(b)]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = async (name) => { const u = svc.startUpload(A(lin), { name, size: 3 }); await svc.appendChunk(A(lin), u.uploadId, 0, body("abc")); return svc.finishUpload(A(lin), u.uploadId); };

  let mainCalls = 0, cmpCalls = 0;
  svc.setTranscriber(async () => { mainCalls++; await sleep(300); return MAIN.join("\n"); });
  svc.setComparer(async () => { cmpCalls++; await sleep(500); return OTHER.replace("治具的模具費", "支距的墓具費"); });
  const m = await run("週會.mp3"); await wait(m.id);
  const v = svc.getView(A(lin), m.id, true);
  assert.equal(v.status, "done", v.error);
  assert.equal(mainCalls, 1); assert.equal(cmpCalls, 1);
  assert.deepEqual(v.lines, MAIN, "the transcript is the main model's, line for line");
  assert.ok(v.crosscheck.enabled && v.crosscheck.flags.some((f) => f.line === 2 && f.kinds.includes("disagree")), JSON.stringify(v.crosscheck));
  assert.ok(v.crosscheck.mainMs >= 250 && v.crosscheck.compareMs >= 450, `times ${v.crosscheck.mainMs}/${v.crosscheck.compareMs}`);
  assert.ok(v.crosscheck.wallMs < v.crosscheck.mainMs + v.crosscheck.compareMs - 100, `sent together: wall ${v.crosscheck.wallMs} < sum ${v.crosscheck.mainMs + v.crosscheck.compareMs}`);
  assert.ok(v.summary.check && v.summary.check.actionsNoOwner === 1);
  assert.equal(v.summary.decisions[0].uncertain, true, "the decision rests on line 2, which is marked");
  assert.match(v.markdown, /出處行待確認/);
  const ev = getDb().prepare("SELECT extra FROM audit WHERE action='asr.transcribe' ORDER BY id DESC LIMIT 1").get();
  const x = JSON.parse(ev.extra); assert.ok(x.compareMs >= 450 && x.wallMs > 0 && x.flagged >= 1);
  const file = JSON.parse(readFileSync(join(process.env.TIGERAI_DATA_DIR, "meetings", m.id, "crosscheck.json"), "utf8"));
  assert.equal(file.version, 1);

  // a failing second model: the meeting still completes on the main transcript, with a note and no marks
  svc.setComparer(async () => { throw new Error("The speech service answered 503"); });
  const m2 = await run("週會2.mp3"); await wait(m2.id);
  const v2 = svc.getView(A(lin), m2.id, true);
  assert.equal(v2.status, "done", v2.error); assert.match(v2.crosscheck.error, /對照模型沒有回應/); assert.equal(v2.crosscheck.compareMs, null);
  assert.equal(v2.crosscheck.flags.some((f) => f.kinds.includes("disagree")), false);

  // without a second model configured: no second call at all, and only the glossary marks
  asr.saveAsr(admin.id, { compareUrl: "" });
  cmpCalls = 0;
  const m3 = await run("週會3.mp3"); await wait(m3.id);
  assert.equal(cmpCalls, 0); assert.equal(svc.getView(A(lin), m3.id, true).crosscheck.enabled, false);
  // a pasted transcript gets the glossary pass once
  const p = svc.createFromText(A(lin), { title: "貼上", transcript: MAIN.join("\n") }); await wait(p.id);
  const pv = svc.getView(A(lin), p.id, true);
  assert.deepEqual(pv.crosscheck.flags.map((f) => f.line), [], "2-character terms need a second model to be judged; nothing is guessed");
  svc.setTranscriber(null); svc.setComparer(null); svc.setModelCall(null);
});
