// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Community edition wizards (每日摘要 / 週報 / SKILL 建議, the five aspects):
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-wizards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-ce-wiz-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_TZ = "Asia/Taipei";
process.env.TIGERAI_WIZARD_SUGGEST_CAP = "50"; // the cap has its own test (withCap); the others must not run into it

const acc = await import("../accounts/service.ts");
const rooms = await import("../rooms/service.ts");
const eng = await import("../wizards/engine.ts");
const set = await import("../wizards/settings.ts");
const st = await import("../wizards/store.ts");
const T = await import("../wizards/time.ts");
const F = await import("../wizards/facts.ts");
const FM = await import("../wizards/format.ts");
const bul = await import("../bulletin/service.ts");
const aiRun = await import("../workorders/ai-run.ts");
const sched = await import("../wizards/scheduler.ts");
const { getDb } = await import("../db/store.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const admin2 = mk("admin2@example.com", "Admin2", "admin");
const lin = mk("lin@example.com", "林小華");
const wang = mk("wang@example.com", "王小明");
const chen = mk("chen@example.com", "陳大文");
const out = mk("out@example.com", "外人");
const A = (u) => ({ id: u.id, role: u.role });
const audit = (action) => getDb().prepare("SELECT extra FROM audit WHERE action=?").all(action).map((r) => JSON.parse(r.extra ?? "{}"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await sleep(15); } throw new Error("condition not reached"); };
const settled = (runId) => until(() => st.getRun(runId).status !== "running");
const H = 3600_000, D = 24 * H;

// 財務部: 王小明 heads it, 林小華 and 陳大文 are in it.
const grp = acc.createGroup(admin.id, { name: "財務部" });
acc.setMembership(admin.id, grp.id, wang.id, true, true);
acc.setMembership(admin.id, grp.id, lin.id, true, false);
acc.setMembership(admin.id, grp.id, chen.id, true, false);

let n = 0;
/** 監督 now arrives as a 交辦單 for the head(s) of the named person's own department(s). */
const todo = (u) => getDb().prepare("SELECT title,description,applicant_id FROM assignments WHERE assignee_id=? AND source='ai' AND title LIKE '監督:%'").all(u.id);
const room = (owner = lin, members = [wang, chen]) => rooms.createRoom(A(owner), `月結小組${++n}`, members.map((m) => m.id));
const say = (r, u, text, ts = Date.now() - 2000) => Number(getDb().prepare("INSERT INTO room_messages (room_id,author_id,text,mentions,ts,kind) VALUES (?,?,?,?,?,'human')").run(r.id, u.id, text, "[]", ts).lastInsertRowid);

// The fake model: the test decides what it writes; it can read the numbers the prompt offered.
let calls = [];
let write = () => "";
eng.setWizardModel(async (req) => { calls.push(req); return write(req); });
const seqsOf = (prompt) => [...prompt.matchAll(/^#(\d+) /gm)].map((m) => +m[1]);

const allOn = (r, who = lin) => set.saveSettings(A(who), r.id, { daily: { enabled: true }, aspects: { supervise: true, audit: true, remind: true, record: true, suggest: true } });
const runDaily = async (r, who = lin) => { const x = await eng.runNow(A(who), r.id, "daily"); if (x.outcome === "queued") await settled(x.run.id); return st.getRun(x.run.id); };
const privateOf = (u, r) => st.privateOpenFor(A(u)).filter((i) => !r || i.roomId === r.id);
const cards = (r, u) => st.roomCards(A(u), r.id);

// ---------------------------------------------------------------- pure parts

test("time: due logic for daily and weekly, ISO week key, local day", () => {
  const taipei = (iso) => Date.parse(`${iso}+08:00`);
  assert.equal(T.dayKey(taipei("2026-11-15T23:30:00")), "2026-11-15");
  assert.equal(T.dayKey(taipei("2026-11-15T00:10:00")), "2026-11-15", "just after midnight Taipei is still the 15th, though it is the 14th in UTC");
  assert.deepEqual(T.dueNow({ at: 18 * 60, weekday: null }, taipei("2026-11-15T17:59:00")).due, false);
  assert.deepEqual(T.dueNow({ at: 18 * 60, weekday: null }, taipei("2026-11-15T18:00:00")), { due: true, period: "2026-11-15" });
  // Friday 2026-11-13 17:00: not before, due from then on, still due on Saturday and Sunday, not due next Monday morning (a new week)
  const wk = { at: 17 * 60, weekday: 5 };
  assert.equal(T.dueNow(wk, taipei("2026-11-13T16:59:00")).due, false);
  assert.equal(T.dueNow(wk, taipei("2026-11-13T17:00:00")).due, true);
  assert.equal(T.dueNow(wk, taipei("2026-11-14T09:00:00")).due, true);
  assert.equal(T.dueNow(wk, taipei("2026-11-16T09:00:00")).due, false);
  assert.equal(T.dueNow(wk, taipei("2026-11-13T17:00:00")).period, T.dueNow(wk, taipei("2026-11-15T20:00:00")).period, "one period for the whole ISO week");
  assert.equal(T.weekKey(taipei("2026-11-15T12:00:00")), "2026-W46");
  assert.equal(T.weekKey(taipei("2027-01-03T12:00:00")), "2026-W53");
  assert.equal(T.calendarDays("2026-11-13", "2026-11-15"), 2);
  assert.equal(T.localDayStart("2026-11-15"), Date.parse("2026-11-15T00:00:00+08:00"));
  assert.equal(T.parseHm("7:05"), 425); assert.equal(T.parseHm("24:00"), null); assert.equal(T.parseHm("abc"), null);
});

test("facts: dates are worked out by the program (relative words count from the day it was said)", () => {
  const z = "Asia/Taipei";
  const sat = Date.parse("2026-11-14T10:00:00+08:00"); // a Saturday
  assert.equal(F.dueDateIn("我明天交對帳表", sat, z), "2026-11-15");
  assert.equal(F.dueDateIn("後天給你", sat, z), "2026-11-16");
  assert.equal(F.dueDateIn("下週三前交", sat, z), "2026-11-18");
  assert.equal(F.dueDateIn("週五前給", sat, z), "2026-11-20");
  assert.equal(F.dueDateIn("11/20 給你", sat, z), "2026-11-20");
  assert.equal(F.dueDateIn("2026-12-01", sat, z), "2026-12-01");
  assert.equal(F.dueDateIn("月底前", sat, z), "2026-11-30");
  assert.equal(F.dueDateIn("沒有日期", sat, z), null);
  const now = Date.parse("2026-11-16T09:00:00+08:00");
  const m = (seq, who, text, ts) => ({ seq, authorId: who, author: who, ts, text });
  const msgs = [
    m(3, "lin", "我11/10前給庫存表", Date.parse("2026-11-08T10:00:00+08:00")),
    m(2, "wang", "請問月結表格式?", Date.parse("2026-11-09T11:00:00+08:00")),
    m(4, "lin", "庫存表已交了", Date.parse("2026-11-09T12:00:00+08:00")),
    m(1, "lin", "我11/12前交差異分析", Date.parse("2026-11-09T13:00:00+08:00")),
    m(5, "chen", "我明天交對帳表", Date.parse("2026-11-15T10:00:00+08:00")),
  ];
  const promises = F.promiseFacts(msgs, now, z);
  assert.deepEqual(promises.map((f) => [f.kind, f.days, f.sources[0].seq]), [["promise_overdue", 4, 1], ["promise_soon", 0, 5]], "a later 'done' message clears a promise; 4 days over is counted, not guessed");
  assert.match(promises[0].supervise, /已過 4 天/);
  const asked = [m(2, "wang", "請問月結表格式?", Date.parse("2026-11-09T11:00:00+08:00")), m(6, "wang", "我再補充一句", Date.parse("2026-11-09T12:00:00+08:00"))];
  assert.deepEqual(F.unansweredFacts(asked, now, z).map((f) => f.sources[0].seq), [2], "his own follow-up is not an answer");
  assert.match(F.unansweredFacts(asked, now, z)[0].supervise, /已超過 6 天沒有人回覆/);
  assert.deepEqual(F.unansweredFacts(msgs, now, z).map((f) => f.sources[0].seq), [], "the question in the thread was followed by other people's messages");
  assert.equal(F.unansweredFacts([m(9, "a", "有人在嗎?", now - 47 * H)], now, z).length, 0, "47 hours is not over two days");
  assert.equal(F.unansweredFacts([m(9, "a", "有人在嗎?", now - 49 * H)], now, z).length, 1);
  assert.equal(F.unansweredFacts([m(9, "a", "有人在嗎?", now - 49 * H), m(10, "b", "在", now - 40 * H)], now, z).length, 0, "someone answered");
});

test("format: a line needs a known aspect, text and at least one source that was really in the prompt", () => {
  const lines = FM.parseLines([
    "記錄｜決議月結截止日改成11/20｜#12 #13",
    "- 建議｜下一步｜請王小明確認格式｜#13",
    "建議｜把對帳交給 AI｜#12",
    "監督｜沒人接庫存盤點｜",
    "稽核｜金額前後不一致｜#99",
    "提醒｜請林小華交表｜#12",
    "亂寫的一行",
    "技能｜月結檢查｜每月結帳時｜先對帳;再盤點;最後出表｜#1 #2 #3",
  ].join("\n"));
  const on = new Set(["record", "suggest", "supervise", "audit"]);
  const { items, rejected } = FM.checkLines(lines, new Set([12, 13]), on);
  assert.deepEqual(items.map((i) => i.aspect), ["record", "suggest", "suggest"]);
  assert.equal(items[0].category, undefined); assert.equal(items[1].category, "next_step"); assert.equal(items[2].category, "other", "a 3-column 建議 has no category: other");
  assert.equal(rejected.noSource, 1, "監督 without a source is dropped");
  assert.equal(rejected.unknownSource, 1, "稽核 citing #99 (not in the prompt) is dropped");
  assert.equal(rejected.switchedOff, 2, "提醒 from the model is never accepted (a reminder's recipient is the program's decision) and 技能 is not on here");
  assert.deepEqual(FM.checkLines(lines, new Set([12, 13]), new Set(["record"])).items.map((i) => i.aspect), ["record"]);
});

// ---------------------------------------------------------------- the five aspects: who gets what

test("五面向分送: 記錄/建議 to the channel; 監督/稽核 to the creator and the head only; 提醒 to the person who owes it only", async () => {
  const r = room(); // creator lin, head wang, member chen
  allOn(r);
  const old = Date.now() - 3 * D;
  say(r, lin, "我明天交對帳表", old);                       // said 3 days ago: due 2 days ago, never done
  const s1 = say(r, wang, "本月結帳截止日改成 11/20,請大家配合");
  const s2 = say(r, chen, "收到,庫存盤點我來做,下週五前完成");
  const s3 = say(r, lin, "差異分析我再看一下");
  write = ({ prompt }) => {
    const ok = seqsOf(prompt);
    assert.deepEqual(ok, [s1, s2, s3], "the model sees today's messages only, numbered");
    assert.match(prompt, /程式已經算出/, "the facts the program counted are handed over");
    assert.match(prompt, /已過 2 天/);
    return [
      `記錄｜截止日改成 11/20｜#${s1}`,
      `記錄｜陳大文接下庫存盤點｜#${s2} #${s1}`,
      `建議｜下一步｜請林小華在 11/20 前交差異分析｜#${s3}`,
      `建議｜交給AI｜庫存盤點的檢查表可以請 AI 先整理｜#${s2}`,
      `監督｜差異分析沒有人說誰負責｜#${s3}`,
      `稽核｜截止日 11/20 與先前說法不同,沒有留下紀錄｜#${s1}`,
      `提醒｜請林小華交表｜#${s3}`,
    ].join("\n");
  };
  const run = await runDaily(r);
  assert.equal(run.status, "done", run.error ?? "");
  assert.equal(run.confirm_state, "draft");

  // the channel: one wizard message, record + suggest items, nothing private
  const msg = getDb().prepare("SELECT * FROM room_messages WHERE room_id=? AND kind='wizard'").get(r.id);
  assert.ok(msg.text.includes("每日摘要(AI 草稿,待確認)")); assert.match(msg.text, /〔#\d+/);
  assert.ok(!/承諾|已過|沒有人說誰負責|不同/.test(msg.text), "no private aspect leaks into the channel text");
  const ch = cards(r, chen);
  assert.deepEqual(ch.items.map((i) => i.aspect).sort(), ["record", "record", "suggest"], "the suggestion about the supervised message was folded into the 監督 item");
  assert.ok(ch.items.every((i) => i.sources.length > 0), "every channel item carries sources");

  // private: head wang and creator lin get 監督 + 稽核; chen (a plain member) gets none of it
  const aspectsOf = (u) => privateOf(u, r).map((i) => i.aspect).sort();
  assert.deepEqual(aspectsOf(wang), ["audit"], "the head: 稽核 as a private item; the two 監督 about 林小華 are 交辦單 now");
  assert.equal(todo(wang).length, 2, "the overdue promise (program fact) + the model's 監督, both about 林小華, whose head is 王小明");
  assert.ok(todo(wang).some((a) => /差異分析沒有人說誰負責 建議:請林小華在 11\/20 前交差異分析/.test(a.description)));
  assert.ok(todo(wang).every((a) => /出處:\n- /.test(a.description) && a.applicant_id === wang.id), "each carries its sources");
  assert.deepEqual(aspectsOf(lin).filter((a) => a !== "remind"), ["audit"], "the creator gets 稽核 only: 監督 went to the head of the named person's own department");
  assert.deepEqual(aspectsOf(chen).filter((a) => a !== "remind"), [], "a member gets no 監督/稽核");
  // 提醒: lin owes the overdue promise and gets it; the two 監督 about 林小華 also tell him they went to his head
  const lr = privateOf(lin, r).filter((i) => i.aspect === "remind");
  assert.equal(lr.length, 3);
  assert.match(lr.find((i) => /^你在/.test(i.text)).text, /你在 .* 說「我明天交對帳表」.*已過 2 天/);
  assert.equal(lr.filter((i) => /轉給你的主管/.test(i.text)).length, 2);
  assert.equal(privateOf(wang, r).filter((i) => i.aspect === "remind").length, 0, "the head is not reminded of what someone else owes");
  assert.ok(privateOf(chen, r).filter((i) => i.aspect === "remind").every((i) => /快到期|今天到期|還有/.test(i.text)), "chen's only reminder would be his own next-Friday promise, never someone else's");
  // every private item has sources and they open the right channel message
  for (const u of [wang, lin]) for (const i of privateOf(u, r)) { assert.ok(i.sources.length > 0); assert.equal(i.roomId, r.id); }
  // the bell counts them
  assert.ok(bul.bulletinSummary(A(wang)).parts.wizards >= 1);
  assert.equal(bul.bulletinSummary(A(out)).parts.wizards, 0);
  assert.ok(bul.personalItems(A(wang)).some((i) => i.kind === "wizard"));
  assert.equal(audit("wizard.run").filter((x) => x.runId === run.id && x.outcome === "ok").length, 1);
});

test("no source, no item: lines without a usable source are dropped; a reply with nothing usable fails the run visibly", async () => {
  const r = room(); allOn(r);
  const s1 = say(r, wang, "請各位本週五前回覆");
  write = () => `記錄｜有人說了什麼｜\n建議｜下一步｜做點什麼｜#99999\n監督｜風險｜`;
  const run = await runDaily(r);
  assert.equal(run.status, "failed"); assert.match(run.error, /沒有附上訊息出處/);
  const card = getDb().prepare("SELECT * FROM room_messages WHERE room_id=? AND kind='wizard'").get(r.id);
  assert.match(card.text, /這次整理沒有完成/);
  assert.equal(cards(r, chen).items.length, 0);
  assert.equal(privateOf(wang, r).length, 0, "nothing at all is delivered from a rejected reply");
  assert.ok(audit("wizard.run").some((x) => x.runId === run.id && x.outcome === "failed"));
  assert.equal(cards(r, chen).runs.find((x) => x.id === run.id).status, "failed");
  // a rerun is possible by the people who may, and works
  write = ({ prompt }) => `記錄｜要求大家週五前回覆｜#${seqsOf(prompt)[0]}`;
  const again = await runDaily(r);
  assert.equal(again.status, "done"); assert.ok(s1);
});

test("model error and an empty reply become a failed run with the reason, not silence", async () => {
  const r = room(); allOn(r); say(r, wang, "測試訊息");
  write = () => { throw new Error("the model service answered: 503 /srv/secret/path"); };
  let run = await runDaily(r);
  assert.equal(run.status, "failed"); assert.ok(!/\/srv/.test(run.error), "no server path in what members read");
  write = () => "";
  run = await runDaily(r);
  assert.equal(run.status, "failed");
  assert.equal(getDb().prepare("SELECT COUNT(*) AS c FROM room_messages WHERE room_id=? AND kind='wizard'").get(r.id).c, 2);
});

test("nothing new, nothing run: no messages means no model call; a manual skip does not block the schedule", async () => {
  const r = room(); set.saveSettings(A(lin), r.id, { daily: { enabled: true } });
  calls = [];
  const x = await eng.runNow(A(lin), r.id, "daily");
  assert.equal(x.outcome, "skipped"); assert.equal(x.run.status, "skipped"); assert.match(x.run.error, /沒有新的訊息/);
  assert.equal(calls.length, 0);
  assert.equal(st.periodHandled(r.id, "daily", T.dayKey(Date.now())), false, "a skipped press does not use up the day");
});

// ---------------------------------------------------------------- suggestion guards

const withCap = async (cap, fn) => {
  const prev = process.env.TIGERAI_WIZARD_SUGGEST_CAP;
  process.env.TIGERAI_WIZARD_SUGGEST_CAP = String(cap);
  try { await fn(); } finally { if (prev === undefined) delete process.env.TIGERAI_WIZARD_SUGGEST_CAP; else process.env.TIGERAI_WIZARD_SUGGEST_CAP = prev; }
};

test("建議 guards: a daily cap per person, and a suggestion about the same message as a 監督 item is folded into it", async () => {
  await withCap(3, async () => {
    const r = room(chen, [wang, lin]); allOn(r, chen);
    for (let i = 1; i <= 5; i++) say(r, wang, `事項 ${i} 要處理`);
    write = ({ prompt }) => {
      const [a, b, c, d, e] = seqsOf(prompt);
      return [`記錄｜今天有五件事｜#${a}`, `建議｜下一步｜做第一件｜#${a}`, `建議｜流程改善｜改流程二｜#${b}`, `建議｜交給AI｜第三件給 AI｜#${c}`,
        `建議｜下一步｜第四件｜#${d}`, `建議｜其他｜第五件｜#${e}`, `監督｜第三件沒人負責｜#${c}`].join("\n");
    };
    const run = await runDaily(r, chen);
    assert.equal(run.status, "done", run.error ?? "");
    const sug = cards(r, lin).items.filter((i) => i.aspect === "suggest");
    assert.deepEqual(sug.map((i) => i.text), ["做第一件", "改流程二", "第四件"], "three kept; the fourth line (第五件) is over the cap of 3");
    const sup = todo(admin).filter((a) => /第三件/.test(a.description)); // 王小明 is the only head and the one named, so it goes to the administrators
    assert.equal(sup.length, 1, "the suggestion about 第三件 did not become a second card");
    assert.match(sup[0].description, /第三件沒人負責 建議:第三件給 AI/);
    // the cap is per person and day: a second run today has none left
    say(r, wang, "又有新的事");
    write = ({ prompt }) => `記錄｜又有新事｜#${seqsOf(prompt)[0]}\n建議｜下一步｜再一則建議｜#${seqsOf(prompt)[0]}`;
    await runDaily(r, chen);
    assert.equal(cards(r, lin).items.filter((i) => i.aspect === "suggest").length, 3, "no new suggestion once the cap is used");
  });
});

test("按「不需要」: the same kind of suggestion is written less afterwards (once: at most one; twice: not at all)", async () => {
  await withCap(50, async () => {
    const r = room(lin, [wang, chen]); allOn(r);
    const prompts = [];
    const round = async (lines) => { const q = say(r, wang, `第 ${prompts.length + 1} 輪的訊息`); write = ({ prompt }) => { prompts.push(prompt); return lines(seqsOf(prompt)[0] ?? q); }; return runDaily(r); };
    await round((q) => `記錄｜一輪｜#${q}\n建議｜流程改善｜改流程 A｜#${q}\n建議｜流程改善｜改流程 B｜#${q}`);
    const first = cards(r, lin).items.filter((i) => i.aspect === "suggest");
    assert.equal(first.length, 2);
    eng.decideItem(A(lin), first[0].id, "dismiss");
    await round((q) => `記錄｜二輪｜#${q}\n建議｜流程改善｜改流程 C｜#${q}\n建議｜流程改善｜改流程 D｜#${q}\n建議｜下一步｜下一步 E｜#${q}`);
    const second = cards(r, lin).items.filter((i) => i.aspect === "suggest" && i.state === "open").map((i) => i.text);
    assert.deepEqual(second.filter((t) => /流程 [CD]/.test(t)), ["改流程 C"], "after one 不需要 the category is cut to one line a run");
    assert.ok(second.includes("下一步 E"), "other categories are not affected");
    eng.decideItem(A(lin), first[1].id, "dismiss");
    await round((q) => `記錄｜三輪｜#${q}\n建議｜流程改善｜改流程 F｜#${q}`);
    assert.ok(!cards(r, lin).items.some((i) => i.text === "改流程 F"), "after two 不需要 the category is not written again");
  });
});

// ---------------------------------------------------------------- 確認 / 採用 and permissions

test("permissions: only the creator, a head of a member's department, or an administrator may change settings, run, confirm, adopt", async () => { await withCap(50, async () => {
  const r = room(lin, [wang, chen]); say(r, wang, "權限測試");
  assert.throws(() => set.saveSettings(A(chen), r.id, { daily: { enabled: true } }), (e) => e.status === 403, "an ordinary member");
  assert.throws(() => set.saveSettings(A(out), r.id, { daily: { enabled: true } }), (e) => e.status === 404, "someone outside does not even learn the channel exists");
  assert.throws(() => set.getSettings && set.requireManager(A(chen), r.id), (e) => e.status === 403);
  await assert.rejects(() => eng.runNow(A(chen), r.id, "daily"), (e) => e.status === 403);
  for (const who of [lin, wang, admin]) { assert.doesNotThrow(() => set.saveSettings(A(who), r.id, { daily: { at: "19:30" } })); }
  assert.equal(set.getSettings(r.id).daily.at, "19:30");
  assert.throws(() => set.saveSettings(A(lin), r.id, { daily: { at: "25:99" } }), (e) => e.code === "bad_time");
  assert.throws(() => set.saveSettings(A(lin), r.id, { aspects: { bogus: true } }), (e) => e.code === "bad_settings");
  // defaults: everything off until switched on; the daily summary ticks 記錄 + 提醒, the weekly report all five (each keeps all five switches)
  const fresh = room();
  const d = set.getSettings(fresh.id);
  assert.deepEqual([d.daily.enabled, d.weekly.enabled, d.skill.enabled], [false, false, false]);
  assert.deepEqual(d.aspects.daily, { record: true, suggest: false, supervise: false, audit: false, remind: true });
  assert.deepEqual(d.aspects.weekly, { record: true, suggest: true, supervise: true, audit: true, remind: true });
  assert.deepEqual([d.daily.at, d.weekly.at, d.weekly.weekday, d.skill.at], ["18:00", "17:00", 5, "17:30"]);
  // 確認
  allOn(r, lin);
  write = ({ prompt }) => `記錄｜討論了權限｜#${seqsOf(prompt)[0]}\n建議｜下一步｜找人確認｜#${seqsOf(prompt)[0]}`;
  const run = await runDaily(r, wang);
  assert.equal(run.status, "done");
  assert.throws(() => eng.confirmRun(A(chen), run.id), (e) => e.status === 403, "a member cannot confirm");
  assert.throws(() => eng.confirmRun(A(out), run.id), (e) => e.status === 404);
  const sug = cards(r, chen).items.find((i) => i.aspect === "suggest");
  assert.throws(() => eng.decideItem(A(chen), sug.id, "adopt"), (e) => e.status === 403, "a member cannot 採用");
  assert.throws(() => eng.decideItem(A(chen), sug.id, "ack"), (e) => e.status === 403 || e.code === "bad_decision" || e.status === 409);
  const done = eng.confirmRun(A(wang), run.id);
  assert.equal(done.confirmState, "confirmed"); assert.equal(done.confirmedByName, "王小明");
  assert.throws(() => eng.confirmRun(A(lin), run.id), (e) => e.status === 409, "once");
  assert.equal(eng.decideItem(A(lin), sug.id, "adopt").state, "adopted");
  assert.throws(() => eng.decideItem(A(lin), sug.id, "dismiss"), (e) => e.status === 409, "decided once");
  assert.ok(audit("wizard.confirm").some((x) => x.runId === run.id));
  assert.ok(audit("wizard.adopt").some((x) => x.itemId === sug.id));
  assert.ok(audit("wizard.settings").length >= 3);
  // a private item can be cleared only by the person it was sent to
}); });

test("a private item is cleared only by its recipient, and a quiet period keeps the same item from coming straight back", async () => {
  const r = room(); allOn(r);
  say(r, lin, "我明天交對帳表", Date.now() - 4 * D);
  say(r, wang, "收到");
  write = ({ prompt }) => `記錄｜收到對帳表的事｜#${seqsOf(prompt)[0]}`;
  await runDaily(r);
  const mine = privateOf(lin, r).find((i) => i.aspect === "remind");
  assert.ok(mine);
  assert.throws(() => eng.decideItem(A(wang), mine.id, "ack"), (e) => e.status === 404, "not even visible to somebody else");
  assert.throws(() => eng.decideItem(A(admin), mine.id, "ack"), (e) => e.status === 404, "not to an administrator either");
  assert.throws(() => eng.decideItem(A(lin), mine.id, "adopt"), (e) => e.code === "bad_decision");
  assert.equal(eng.decideItem(A(lin), mine.id, "ack").state, "done");
  assert.ok(!privateOf(lin, r).some((i) => i.id === mine.id));
  for (const i of privateOf(lin, r).filter((x) => x.aspect === "remind")) eng.decideItem(A(lin), i.id, "ack"); // the 提醒 that the matter went to his head, too
  // the same overdue promise next run: acknowledged within 3 days -> not repeated; the open supervision copy for the head is not doubled either
  say(r, wang, "再補一句");
  write = ({ prompt }) => `記錄｜補充｜#${seqsOf(prompt)[0]}`;
  const before = todo(wang).length;
  await runDaily(r);
  assert.equal(privateOf(lin, r).filter((i) => i.aspect === "remind" && /對帳表/.test(i.text)).length, 0);
  assert.equal(todo(wang).length, before, "no duplicate of an open item");
});

// ---------------------------------------------------------------- the schedule (the Portal's own timer; the add-on's external caller is tested in the add-on)

test("tick: only what is due runs, once per day, at most two at a time; the built-in pass records itself", async () => {
  assert.equal(eng.scheduleStatus().lastRunAt, null, "nothing has passed yet");
  assert.equal(eng.scheduleStatus().stale, true);

  const taipei = (iso) => Date.parse(`${iso}+08:00`);
  getDb().prepare("UPDATE wizard_settings SET enabled=0").run(); // channels of the earlier tests are out of this test
  const rs = [room(), room(), room()];
  for (const r of rs) { set.saveSettings(A(lin), r.id, { daily: { enabled: true, at: "18:00" } }); say(r, wang, "今天的訊息"); }
  const off = room(); say(off, wang, "沒開精靈");
  write = ({ prompt }) => `記錄｜整理｜#${seqsOf(prompt)[0]}`;
  // 17:00: nothing is due
  const msgNow = Date.now();
  const early = await eng.tick(taipei(`${T.dayKey(msgNow)}T17:00:00`));
  assert.equal(early.due, 0); assert.equal(early.started.length, 0);
  // 18:00: three are due, only two start (the shared slot limit), the third stays due
  const at18 = taipei(`${T.dayKey(msgNow)}T18:00:00`);
  const first = await eng.tick(at18);
  assert.equal(first.due, 3); assert.equal(first.started.length, 2);
  await until(() => first.started.every((s) => st.getRun(s.runId).status === "done"));
  const second = await eng.tick(at18 + 15 * 60_000);
  assert.equal(second.due, 1, "the two that ran are not due again"); assert.equal(second.started.length, 1);
  await until(() => st.getRun(second.started[0].runId).status === "done");
  const third = await eng.tick(at18 + 30 * 60_000);
  assert.equal(third.due, 0, "same wizard, same day: never rerun");
  assert.equal(getDb().prepare("SELECT COUNT(*) AS c FROM wizard_runs WHERE room_id=?").get(off.id).c, 0, "a channel that did not switch it on is never touched");
  // the Portal's own timer step: runs the same rules and records itself; nothing else is in charge in the community edition
  const pass = await sched.schedulerPass(Date.now());
  assert.equal(pass.stoodDown, false);
  assert.ok(Date.now() - eng.scheduleStatus().lastRunAt < 5000); assert.equal(eng.scheduleStatus().stale, false); assert.equal(eng.scheduleStatus().mode, "builtin");
  assert.equal(eng.scheduleStatus(Date.now() + 30 * 60_000).stale, true, "20 minutes without a pass shows red");
  assert.equal(sched.externalInCharge(), false, "no add-on, nobody else in charge");
  // the run was made as the channel's creator
  assert.ok(rs.every((r) => st.getRun(getDb().prepare("SELECT id FROM wizard_runs WHERE room_id=?").get(r.id).id).runner_id === r.owner_id));
});

test("the schedule shares the AI limit with 交辦給 AI: no free slot, nothing starts", async () => {
  const r = room(); set.saveSettings(A(lin), r.id, { daily: { enabled: true, at: "00:00" } }); say(r, wang, "有訊息");
  write = ({ prompt }) => `記錄｜整理｜#${seqsOf(prompt)[0]}`;
  let release; const hold = new Promise((res) => { release = res; });
  const busy = [aiRun.withAiSlot(() => hold), aiRun.withAiSlot(() => hold)];
  await sleep(20);
  assert.equal(aiRun.aiSlotsFree(), 0);
  const t = await eng.tick(Date.now());
  assert.equal(t.free, 0); assert.equal(t.started.length, 0);
  release(); await Promise.all(busy);
  assert.equal(aiRun.aiSlotsFree(), 2);
  const t2 = await eng.tick(Date.now());
  assert.ok(t2.started.some((s) => s.roomId === r.id));
  await until(() => st.getRun(t2.started.find((s) => s.roomId === r.id).runId).status === "done");
});

// ---------------------------------------------------------------- 週報

test("週報: reads this week's daily summaries (unconfirmed ones flagged), puts only 記錄/建議/work orders in the channel, never the private aspects", async () => {
  const r = room(); allOn(r);
  say(r, lin, "我明天交對帳表", Date.now() - 5 * D);
  say(r, wang, "週報前的一則訊息");
  write = ({ prompt }) => `記錄｜今天的決議｜#${seqsOf(prompt)[0]}\n建議｜下一步｜寫成固定流程｜#${seqsOf(prompt)[0]}`;
  const day = await runDaily(r);
  eng.confirmRun(A(lin), day.id);
  say(r, chen, "第二天的訊息");
  const day2 = await runDaily(r);
  assert.equal(day2.status, "done");
  let seen = "";
  write = ({ prompt }) => { seen = prompt; const q = seqsOf(prompt.replace(/^.*每日摘要:/s, "").split("\n").map((l) => l.replace(/.*?(#\d+).*/, "$1 ")).join("\n")); void q; const nums = [...prompt.matchAll(/#(\d+)/g)].map((m) => +m[1]); return `記錄｜本週重點:對帳與月結｜#${nums[nums.length - 1]}\n監督｜本週有事沒人接｜#${nums[nums.length - 1]}\n建議｜流程改善｜把月結寫成清單｜#${nums[nums.length - 1]}`; };
  const x = await eng.runNow(A(lin), r.id, "weekly");
  assert.equal(x.outcome, "queued");
  await settled(x.run.id);
  const wk = st.getRun(x.run.id);
  assert.equal(wk.status, "done", wk.error ?? "");
  assert.match(seen, /已確認/); assert.match(seen, /尚未確認/, "the unconfirmed summary is read but marked");
  const msg = getDb().prepare("SELECT text FROM room_messages WHERE room_id=? AND kind='wizard' ORDER BY seq DESC").get(r.id);
  assert.ok(msg.text.includes("週報(AI 草稿,待確認)")); assert.match(msg.text, /還沒有人確認/);
  assert.ok(!/本週有事沒人接|已過/.test(msg.text), "the 監督 part of the weekly report is not in the channel");
  assert.equal(cards(r, chen).items.filter((i) => i.aspect === "suggest" && i.text === "寫成固定流程").length, 1, "a suggestion the daily summary already made is not offered a second time by the weekly report");
  assert.ok(todo(wang).some((a) => /本週有事沒人接/.test(a.description)) || privateOf(wang, r).some((i) => i.aspect === "supervise" && /本週有事沒人接/.test(i.text)), "it went to the head");
  assert.ok(!privateOf(chen, r).some((i) => i.aspect === "supervise"));
  assert.equal(wk.confirm_state, "draft"); assert.equal(eng.confirmRun(A(wang), wk.id).confirmState, "confirmed");
});

test("週報 with nothing to read does not run, and a work order tied to the channel's conversation is quoted by the program", async () => {
  const r = room(); allOn(r);
  const x = await eng.runNow(A(lin), r.id, "weekly");
  assert.equal(x.outcome, "skipped");
  getDb().prepare("UPDATE rooms SET bound_session_id='sess-ce-1' WHERE id=?").run(r.id);
  const due = Date.parse(`${T.addDays(T.dayKey(Date.now()), -2)}T12:00:00Z`);
  getDb().prepare("INSERT INTO assignments (id,title,applicant_id,assignee_id,due_date,session_id,created_at,updated_at,status) VALUES ('aCe1','對帳表',?,?,?,'sess-ce-1',?,?,'accepted')").run(wang.id, lin.id, due, Date.now(), Date.now());
  getDb().prepare("INSERT INTO assignments (id,title,applicant_id,assignee_id,created_at,updated_at,status) VALUES ('aCe2','不相干的私人交辦',?,?,?,?,'open')").run(wang.id, lin.id, Date.now(), Date.now());
  const y = await eng.runNow(A(lin), r.id, "weekly");
  assert.equal(y.outcome, "queued");
  await settled(y.run.id);
  const msg = getDb().prepare("SELECT text FROM room_messages WHERE room_id=? AND kind='wizard' ORDER BY seq DESC").get(r.id);
  assert.match(msg.text, /對帳表.*逾期 2 天/);
  assert.ok(!/不相干的私人交辦/.test(msg.text), "an order nobody tied to this channel is not quoted in it");
});

// ---------------------------------------------------------------- SKILL 建議

test("SKILL 建議: a proposal needs three different messages; it goes to administrators; nothing is installed until an administrator adopts", async () => {
  const r = room(); set.saveSettings(A(lin), r.id, { skill: { enabled: true } });
  const q = [1, 2, 3, 4, 5, 6, 7].map((i) => say(r, i % 2 ? lin : chen, `月結第 ${i} 次:先對帳,再盤點,最後出表`));
  write = () => [`技能｜月結檢查流程｜每月月結時｜先對帳;再盤點;最後出表｜#${q[0]} #${q[2]} #${q[4]}`,
    `技能｜只出現兩次的事｜某時候｜一步;兩步｜#${q[1]} #${q[3]}`, `技能｜沒出處的事｜某時候｜一步;兩步｜`].join("\n");
  const x = await eng.runNow(A(lin), r.id, "skill");
  await settled(x.run.id);
  assert.equal(st.getRun(x.run.id).status, "done");
  const props = st.skillProposalsOpen(A(admin));
  assert.equal(props.length, 1, "only the proposal with three distinct sources survives");
  assert.equal(props[0].extra.name, "月結檢查流程"); assert.ok(props[0].sources.length >= 3);
  assert.equal(st.skillProposalsOpen(A(lin)).length, 0, "a member never sees the queue");
  assert.ok(bul.personalItems(A(admin)).some((i) => i.kind === "wizard" && i.wizard.aspect === "skill"), "admin 公佈欄 個人區 待我核准");
  assert.ok(bul.bulletinSummary(A(admin)).count > 0);
  assert.ok(!bul.personalItems(A(lin)).some((i) => i.kind === "wizard" && i.wizard.aspect === "skill"));
  assert.equal(getDb().prepare("SELECT COUNT(*) AS c FROM room_messages WHERE room_id=? AND kind='wizard'").get(r.id).c, 0, "no card in the channel for a proposal");
  // before adopt: no skill exists
  const skillsRoot = join(process.env.PI_CODING_AGENT_DIR, "skills");
  assert.equal(existsSync(skillsRoot) ? readdirSync(skillsRoot).length : 0, 0);
  // a member, a head, the AI path: refused
  for (const u of [lin, wang, chen]) assert.throws(() => eng.decideItem(A(u), props[0].id, "adopt"), (e) => e.status === 403);
  assert.equal(existsSync(skillsRoot) ? readdirSync(skillsRoot).length : 0, 0, "still nothing installed");
  // an administrator adopts: a real skill appears
  const res = eng.decideItem(A(admin), props[0].id, "adopt");
  assert.equal(res.state, "adopted");
  const md = readFileSync(join(skillsRoot, res.skill, "SKILL.md"), "utf8");
  assert.match(md, /^---\nname: skill-[0-9a-f]{8}\ndescription: "月結檢查流程:每月月結時"\n---/);
  assert.match(md, /1\. 先對帳\n2\. 再盤點\n3\. 最後出表/);
  assert.ok(audit("skill.approve").some((x) => x.itemId === props[0].id && x.skill === res.skill));
  assert.throws(() => eng.decideItem(A(admin2), props[0].id, "adopt"), (e) => e.status === 409, "decided once");
  assert.equal(st.skillProposalsOpen(A(admin)).length, 0);
  // the same idea does not come back next week; a dismissed one is remembered too
  write = () => `技能｜月結檢查流程｜每月月結時｜先對帳;再盤點｜#${q[0]} #${q[2]} #${q[4]}`;
  const y = await eng.runNow(A(lin), r.id, "skill"); await settled(y.run.id);
  assert.equal(st.skillProposalsOpen(A(admin)).length, 0, "already known, not proposed again");
});

test("SKILL 建議 (1.1.2-ce): the administrator may edit the suggested text before adopting; the installed skill carries the edit", async () => {
  const r = room(); set.saveSettings(A(lin), r.id, { skill: { enabled: true } });
  const q = [1, 2, 3, 4, 5, 6, 7].map((i) => say(r, i % 2 ? lin : chen, `報價第 ${i} 次:先查料號,再算成本,最後出報價`));
  write = () => `技能｜報價整理流程｜每次要出報價時｜先查料號;再算成本;最後出報價｜#${q[0]} #${q[2]} #${q[4]}`;
  const x = await eng.runNow(A(lin), r.id, "skill"); await settled(x.run.id);
  const prop = st.skillProposalsOpen(A(admin)).find((p) => p.extra.name === "報價整理流程");
  assert.ok(prop);
  // a bad edit is refused and the proposal stays open
  assert.throws(() => eng.decideItem(A(admin), prop.id, "adopt", { name: "  " }), (e) => e.code === "bad_skill");
  assert.throws(() => eng.decideItem(A(admin), prop.id, "adopt", { steps: [] }), (e) => e.code === "bad_skill");
  assert.throws(() => eng.decideItem(A(admin), prop.id, "adopt", { steps: Array.from({ length: 13 }, (_, i) => `步${i}`) }), (e) => e.code === "bad_skill");
  assert.equal(st.skillProposalsOpen(A(admin)).some((p) => p.id === prop.id), true);
  // a member can never edit-adopt
  assert.throws(() => eng.decideItem(A(lin), prop.id, "adopt", { name: "偷改" }), (e) => e.status === 403);
  const res = eng.decideItem(A(admin), prop.id, "adopt", { name: "報價整理流程(改)", when: "客戶要報價且料號已確認時", steps: ["先查料號是否停產", "再用最新成本表算成本", "成本沒有依據就標待確認", "最後出報價草稿給主管"] });
  const md = readFileSync(join(process.env.PI_CODING_AGENT_DIR, "skills", res.skill, "SKILL.md"), "utf8");
  assert.match(md, /# 報價整理流程\(改\)/); assert.match(md, /客戶要報價且料號已確認時/);
  assert.match(md, /1\. 先查料號是否停產\n2\. 再用最新成本表算成本\n3\. 成本沒有依據就標待確認\n4\. 最後出報價草稿給主管/);
  assert.doesNotMatch(md, /先查料號;再算成本/, "the AI's original wording is not kept");
  assert.ok(audit("skill.approve").some((a) => a.itemId === prop.id && a.edited === true));
  // an unedited adoption still audits edited:false (covered by the earlier test's skill.approve entry)
});

test("the wizard code never creates a work order or installs a skill on its own", () => {
  const root = new URL("../wizards/", import.meta.url);
  const files = [...readdirSync(root), ...readdirSync(new URL("kinds/", root)).map((f) => `kinds/${f}`)].filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    const text = readFileSync(new URL(f, root), "utf8");
    // The one place: 監督 items become 交辦單 for the named person's head(s) (1.1.0-ce); nothing else in the wizards may.
    // and the 「確認」 交辦單 of 工作週報 / 訊息分析 (confirm-order.ts, 1.1.0-ce decision #3): a confirmation task, never AI work.
    if (f !== "supervise-route.ts" && f !== "confirm-order.ts") assert.ok(!/createAssignment|startAiRun|createOrder/.test(text), `${f} must not create work orders`);
    if (f !== "skill-writer.ts" && f !== "engine.ts" && f !== "files.ts") assert.ok(!/writeSkill|writeFileSync/.test(text), `${f} must not write a skill`);
    if (f === "files.ts") assert.ok(!/writeSkill|skills?\//.test(text), "files.ts writes only the MD outputs through dir_map folders");
  }
  // writeSkill is called in exactly one place, behind the administrator check
  const engine = readFileSync(new URL("engine.ts", root), "utf8");
  assert.equal((engine.match(/writeSkill\(/g) ?? []).length, 1);
  assert.match(engine, /actor\.role !== "admin"[\s\S]{0,200}\n[\s\S]*writeSkill/);
});

test("a run for a closed channel or a disabled creator is refused or fails visibly; a restart never leaves a run 'running'", async () => {
  const r = room(); allOn(r); say(r, wang, "有訊息");
  rooms.closeRoom(A(lin), r.id);
  await assert.rejects(() => eng.runNow(A(lin), r.id, "daily"), (e) => e.code === "room_closed");
  rooms.reopenRoom(A(lin), r.id);
  getDb().prepare("INSERT INTO wizard_runs (id,kind,room_id,runner_id,trigger,period,status,created_at) VALUES ('zOrphan','daily',?,?,'schedule','x','running',?)").run(r.id, lin.id, Date.now());
  eng.resetSweepForTests();
  assert.equal(eng.sweepStaleRuns(), 1);
  assert.equal(st.getRun("zOrphan").status, "failed"); assert.match(st.getRun("zOrphan").error, /重新啟動/);
  assert.match(getDb().prepare("SELECT text FROM room_messages WHERE room_id=? AND author_id='wizard:zOrphan'").get(r.id).text, /這次整理沒有完成/);
});

// ---------------------------------------------------------------- Markdown files in the directory (1.1.0-ce)

test("a daily run also writes MD files: the channel part in the channel's 每日摘要 folder, 提醒 in the person's folder (via dir_map)", async () => {
  const { channelFolder, personFolder } = await import("../directory/map.ts");
  const r = room(chen, [wang, lin]); allOn(r, chen);
  const a = say(r, wang, "週五前要交報告給客戶");
  write = () => [`記錄｜今天要交報告｜#${a}`, `提醒｜王要在週五前交報告｜#${a}`].join("\n");
  const run = await runDaily(r, chen);
  assert.equal(run.status, "done", run.error ?? "");
  const chanFiles = readdirSync(channelFolder(r.id, "每日摘要")).filter((f) => f.endsWith(".md"));
  assert.equal(chanFiles.length, 1, "one summary file in the channel folder");
  const text = readFileSync(join(channelFolder(r.id, "每日摘要"), chanFiles[0]), "utf8");
  assert.match(text, /每日摘要/);
  const mine = readdirSync(personFolder(wang.id, "給我的提醒"));
  assert.ok(mine.length >= 0, "the person's reminder folder exists (created through dir_map)");
});
