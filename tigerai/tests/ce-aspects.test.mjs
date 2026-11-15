// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Community edition 1.1.0: aspect tiers (每日摘要 / 工作週報), the slide report, 訊息分析 (window + @AI):
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-aspects.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-ce-asp-"));
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
const aiRun = await import("../workorders/ai-run.ts");
const sched = await import("../wizards/scheduler.ts");
const adh = await import("../wizards/adhoc.ts");
const par = await import("../wizards/adhoc-parse.ts");
const rep = await import("../wizards/report.ts");
const slides = await import("../slides/store.ts");
const web = await import("../web/settings.ts");
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

const runDaily = async (r, who = lin) => { const x = await eng.runNow(A(who), r.id, "daily"); if (x.outcome === "queued") await settled(x.run.id); return st.getRun(x.run.id); };
const privateOf = (u, r) => st.privateOpenFor(A(u)).filter((i) => !r || i.roomId === r.id);
const cards = (r, u) => st.roomCards(A(u), r.id);


const on = (r, who = lin, kinds = ["daily"]) => set.saveSettings(A(who), r.id, Object.fromEntries(kinds.map((k) => [k, { enabled: true }])));
const runKind = async (r, kind, who = lin) => { const x = await eng.runNow(A(who), r.id, kind); if (x.outcome === "queued") await settled(x.run.id); return st.getRun(x.run.id); };
const lastPost = (r) => getDb().prepare("SELECT text FROM room_messages WHERE room_id=? AND kind='wizard' ORDER BY seq DESC").get(r.id)?.text ?? "";
const aiSaid = (r) => getDb().prepare("SELECT text FROM room_messages WHERE room_id=? AND kind='ai' ORDER BY seq").all(r.id).map((x) => x.text);
const mkOrder = (id, title, assignee, daysFromToday, status = "accepted", session = "sess-asp") => getDb().prepare("INSERT INTO assignments (id,title,applicant_id,assignee_id,due_date,session_id,created_at,updated_at,status) VALUES (?,?,?,?,?,?,?,?,?)")
  .run(id, title, wang.id, assignee.id, Date.parse(`${T.addDays(T.dayKey(Date.now()), daysFromToday)}T12:00:00Z`), session, Date.now(), Date.now(), status);

test("defaults: the daily summary ticks 記錄 + 提醒, the weekly report all five, and each keeps all five switches", () => {
  const r = room();
  const d = set.getSettings(r.id);
  assert.deepEqual(d.aspects.daily, { record: true, suggest: false, supervise: false, audit: false, remind: true });
  assert.deepEqual(d.aspects.weekly, { record: true, suggest: true, supervise: true, audit: true, remind: true });
  assert.deepEqual(set.ASPECT_DEFAULTS.daily, d.aspects.daily, "the 建議預設 shown in the window is the same table");
  // the creator ticks 監督 for the daily one only
  set.saveSettings(A(lin), r.id, { aspects: { daily: { supervise: true }, weekly: { audit: false } } });
  const x = set.getSettings(r.id);
  assert.equal(x.aspects.daily.supervise, true); assert.equal(x.aspects.weekly.supervise, true); assert.equal(x.aspects.weekly.audit, false); assert.equal(x.aspects.daily.audit, false);
  // a plain member cannot
  assert.throws(() => set.saveSettings(A(chen), r.id, { aspects: { daily: { audit: true } } }), (e) => e.status === 403);
  assert.throws(() => set.saveSettings(A(lin), r.id, { aspects: { daily: { bogus: true } } }), (e) => e.code === "bad_settings");
  // 回到建議預設
  set.saveSettings(A(wang), r.id, { reset: ["daily"] });
  assert.deepEqual(set.getSettings(r.id).aspects.daily, set.ASPECT_DEFAULTS.daily);
  assert.equal(set.getSettings(r.id).aspects.weekly.audit, false, "resetting the daily one leaves the weekly one alone");
  set.saveSettings(A(lin), r.id, { reset: ["weekly"] });
  assert.deepEqual(set.getSettings(r.id).aspects.weekly, set.ASPECT_DEFAULTS.weekly);
  assert.throws(() => set.saveSettings(A(lin), r.id, { reset: ["skill"] }), (e) => e.code === "bad_settings");
  // the old flat form (a client from before 1.1.0) still works, for both wizards
  set.saveSettings(A(lin), r.id, { aspects: { suggest: true } });
  assert.equal(set.getSettings(r.id).aspects.daily.suggest, true); assert.equal(set.getSettings(r.id).aspects.weekly.suggest, true);
  assert.equal(set.WIZARD_ZH.weekly, "工作週報"); assert.equal(set.WIZARD_ZH.adhoc, "訊息分析"); assert.equal(set.WIZARD_ZH.daily, "每日摘要");
});

test("每日摘要 by default: the model is asked for 記錄 only, 提醒 is computed by the program and goes privately to who owes it", async () => {
  const r = room(); on(r);
  getDb().prepare("UPDATE rooms SET bound_session_id='sess-asp' WHERE id=?").run(r.id);
  mkOrder("aAs1", "對帳表", chen, -3);            // overdue, chen owes
  mkOrder("aAs2", "月結報告", wang, 1);           // due soon, wang owes
  mkOrder("aAs3", "很久以後的事", lin, 20);        // not near: no reminder
  say(r, lin, "我明天交對帳表", Date.now() - 3 * D);              // promised for the next day, not done
  const m1 = say(r, wang, "今天討論了月結流程");
  say(r, chen, "誰知道上個月的匯率是多少?", Date.now() - 3 * D);   // the last word in the channel, older than 2 days: a reminder for who asked
  calls = [];
  write = ({ prompt }) => `記錄｜討論月結流程｜#${m1}\n建議｜下一步｜寫成清單｜#${m1}\n監督｜沒人負責｜#${m1}\n稽核｜少了紀錄｜#${m1}`;
  const run = await runKind(r, "daily");
  assert.equal(run.status, "done", run.error ?? "");
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /記錄｜/); assert.ok(!/建議｜|監督｜|稽核｜/.test(calls[0].prompt.split("規則:")[0]), "the format section asks for 記錄 only");
  assert.ok(!/對帳表.*逾期|月結報告.*到期/.test(calls[0].prompt.replace(/^.*訊息:/s, "").split("程式已經算出")[0]), "reminders are not for the model to write");
  // what the model wrote beyond 記錄 is thrown away
  assert.deepEqual(cards(r, chen).items.map((i) => i.aspect), ["record"]);
  assert.equal(privateOf(wang, r).filter((i) => i.aspect === "supervise" || i.aspect === "audit").length, 0, "no 監督/稽核 unless the channel ticked them");
  const mine = (u) => privateOf(u, r).filter((i) => i.aspect === "remind").map((i) => i.text);
  assert.ok(mine(chen).some((t) => /對帳表.*已逾期 3 天/.test(t)), "work order overdue, counted by the program: " + mine(chen));
  assert.ok(mine(chen).some((t) => /匯率.*超過 3 天沒有人回覆/.test(t)), "the unanswered question goes to who asked");
  assert.ok(mine(wang).some((t) => /月結報告.*1 天後到期/.test(t)));
  assert.ok(mine(lin).some((t) => /我明天交對帳表.*已過 2 天/.test(t) || /我明天交對帳表/.test(t)), "a promise not kept");
  assert.ok(!mine(lin).some((t) => /很久以後/.test(t)));
  assert.ok(!mine(wang).some((t) => /對帳表/.test(t)), "nobody gets somebody else's reminder");
  assert.match(lastPost(r), /提醒已私下送給/); assert.ok(!/逾期/.test(lastPost(r)), "no reminder text in the channel");
  for (const i of privateOf(chen, r).filter((x) => x.aspect === "remind")) assert.ok(i.sources.length > 0, "no source, no item");
});

test("每日摘要: a channel can tick extra aspects (監督 for an urgent project); 回到建議預設 puts it back", async () => {
  const r = room(); on(r);
  set.saveSettings(A(lin), r.id, { aspects: { daily: { supervise: true } } });
  const m = say(r, chen, "這個專案很急");
  write = () => `記錄｜很急的專案｜#${m}\n監督｜沒人負責這個急件｜#${m}`;
  const run = await runKind(r, "daily");
  assert.equal(run.status, "done", run.error ?? "");
  assert.ok(todo(wang).some((a) => /沒人負責這個急件/.test(a.description)), "a 交辦單 for the head of chen's department");
  assert.ok(!privateOf(chen, r).some((i) => i.aspect === "supervise"), "not to a member");
  assert.ok(privateOf(chen, r).some((i) => i.aspect === "remind" && /轉給你的主管/.test(i.text)), "the named person is told it went to their head");
  set.saveSettings(A(wang), r.id, { reset: ["daily"] });
  assert.equal(set.getSettings(r.id).aspects.daily.supervise, false);
});

test("每日摘要: no new messages but a reminder is due: no model call, the reminder is still sent; nothing at all is skipped", async () => {
  const own = mk("own@example.com", "老闆"), sam = mk("sam@example.com", "小山");
  const r = room(own, [sam]); on(r, own);
  assert.equal((await eng.runNow(A(own), r.id, "daily")).outcome, "skipped");
  mkOrder("aAs4", "寄出報價單", sam, -1, "accepted", "sess-asp2");
  calls = [];
  const run = await runKind(r, "daily", own);
  assert.equal(run.status, "done", run.error ?? ""); assert.equal(calls.length, 0, "the program alone had everything to say");
  assert.ok(privateOf(sam, r).some((i) => i.aspect === "remind" && /寄出報價單/.test(i.text)));
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM room_messages WHERE room_id=? AND kind='wizard' AND text NOT LIKE '%沒有完成%'").get(r.id).n, 0, "nothing for the channel to read");
});

test("工作週報: all five aspects by default, routed as before, and a report (channel deck + a private deck for the head) is made", async () => {
  const r = room();
  on(r, lin, ["weekly"]);
  getDb().prepare("UPDATE rooms SET bound_session_id='sess-asp3' WHERE id=?").run(r.id);
  mkOrder("aAs5", "週報用的對帳表", chen, -2, "accepted", "sess-asp3");
  const m = say(r, chen, "月結資料還沒對完");
  write = ({ prompt }) => {
    assert.ok(/監督｜/.test(prompt) && /稽核｜/.test(prompt) && /建議｜/.test(prompt) && /記錄｜/.test(prompt), "the weekly prompt asks for all four model aspects");
    return `記錄｜本週月結進度落後｜#${m}\n建議｜流程改善｜把月結寫成清單｜#${m}\n監督｜月結資料沒人負責收尾｜#${m}\n稽核｜對帳數字沒有留紀錄｜#${m}`;
  };
  const run = await runKind(r, "weekly");
  assert.equal(run.status, "done", run.error ?? "");
  const text = lastPost(r);
  assert.match(text, /工作週報\(AI 草稿,待確認\)/); assert.match(text, /報告投影片/); assert.match(text, /\/api\/tg\/slides\/r[0-9a-f]{12}-[0-9a-f]{12}\?format=pptx/);
  assert.ok(!/月結資料沒人負責收尾|對帳數字沒有留紀錄/.test(text), "監督/稽核 are not in the channel post");
  // 監督 / 稽核 / 提醒 routing
  const kinds = (u) => privateOf(u, r).map((i) => i.aspect);
  assert.ok(kinds(wang).includes("supervise") && kinds(wang).includes("audit"));
  assert.ok(!kinds(chen).includes("supervise") && !kinds(chen).includes("audit"));
  assert.ok(privateOf(chen, r).some((i) => i.aspect === "remind" && /週報用的對帳表/.test(i.text)));
  // the channel deck: every member opens it; it holds only 記錄 / 建議 / 交辦單
  const chanId = /slides\/(r[0-9a-f]{12}-[0-9a-f]{12})/.exec(text)[1];
  assert.ok(slides.openDeck(A(chen), chanId, "pptx").file.length > 1000);
  assert.throws(() => slides.openDeck(A(out), chanId, "pptx"), (e) => e.status === 404, "a stranger gets nothing");
  const ch = JSON.parse(readFileSync(join(rooms.roomDir(chanId.split("-")[0]), "slides", chanId, "meta.json"), "utf8"));
  assert.equal(ch.hasPdf, false, "no 文件轉檔服務: the .pptx is still delivered");
  // the private deck: one per head, only that head opens it
  const mineWang = privateOf(wang, r).find((i) => i.extra?.deck);
  assert.ok(mineWang && /主管版報告/.test(mineWang.text) && mineWang.sources.length > 0);
  assert.ok(slides.openDeck(A(wang), mineWang.extra.deck, "pptx").file.length > 1000);
  assert.throws(() => slides.openDeck(A(chen), mineWang.extra.deck, "pptx"), (e) => e.status === 404, "a member cannot open the heads' deck");
  assert.throws(() => slides.openDeck(A(lin), mineWang.extra.deck, "pptx"), (e) => e.status === 404, "not even the other head: personal decks are personal");
  assert.ok(privateOf(lin, r).some((i) => i.extra?.deck), "the creator got her own copy");
  assert.ok(!privateOf(chen, r).some((i) => i.extra?.deck));
});

test("report decks: the channel deck has no 監督 / 稽核 slide, the private one has no 記錄 / 建議, every slide cites its sources", () => {
  const item = (aspect, text, seq, extra = {}) => ({ aspect, text, sources: [{ t: "m", seq }], to: "channel", ...extra });
  const d = rep.reportDecks({ roomId: "r1", roomName: "x", ownerId: "u1", title: "T", subtitle: "s", supervisors: [],
    items: [item("record", "做了A", 1), item("suggest", "做B", 2, { category: "next_step" }), item("supervise", "沒人管C", 3), item("audit", "少了D", 4)],
    orders: [{ title: "對帳表", assignee: "陳", status: "進行中", due: "2026/11/10", late: 3 }] });
  const titles = (x) => x.slides.map((s) => s.title);
  assert.deepEqual(titles(d.channel), ["本週重點", "記錄", "交辦單狀態", "下週建議"]);
  assert.deepEqual(titles(d.private), ["監督", "稽核"]);
  const flat = (x) => JSON.stringify(x);
  assert.ok(!/沒人管C|少了D/.test(flat(d.channel))); assert.ok(!/做了A|做B/.test(flat(d.private)));
  for (const s of [...d.channel.slides, ...d.private.slides]) assert.ok((s.points ?? []).some((p) => /〔#\d+|交辦單/.test(p)), `slide ${s.title} carries a source`);
  assert.equal(rep.reportDecks({ roomId: "r1", roomName: "x", ownerId: "u", title: "T", subtitle: "", supervisors: [], items: [], orders: [] }).channel, null);
});

test("report: with a conversion service the PDF link is there too; a service that fails still delivers the .pptx with the reason", async () => {
  const real = globalThis.fetch;
  const pdf = Buffer.from("%PDF-1.4 fake");
  try {
    web.saveWebSettings(admin.id, { converterUrl: "http://converter.invalid:3000" });
    globalThis.fetch = async () => new Response(pdf, { status: 200 });
    const r = room(); on(r, lin, ["weekly"]);
    const m = say(r, chen, "本週有進度");
    write = () => `記錄｜有進度｜#${m}`;
    await runKind(r, "weekly");
    assert.match(lastPost(r), /\[PDF\]\(\/api\/tg\/slides\/r[0-9a-f]{12}-[0-9a-f]{12}\?format=pdf\)/);
    globalThis.fetch = async () => new Response("no", { status: 500 });
    const r2 = room(); on(r2, lin, ["weekly"]);
    const m2 = say(r2, chen, "本週有進度");
    write = () => `記錄｜有進度｜#${m2}`;
    const run = await runKind(r2, "weekly");
    assert.equal(run.status, "done", run.error ?? "");
    assert.ok(!/\[PDF\]/.test(lastPost(r2)) && /PowerPoint/.test(lastPost(r2)) && /PDF 沒有做成/.test(lastPost(r2)));
  } finally { globalThis.fetch = real; web.saveWebSettings(admin.id, { converterUrl: "" }); }
});

// ---------------------------------------------------------------- 訊息分析

test("NL parser: aspects and range come from keywords, not from the model; ordinary sentences are left to the plain @AI", () => {
  const p = par.parseAdhoc;
  assert.deepEqual(p("@AI 用監督和提醒看最近三天"), { aspects: ["supervise", "remind"], range: { type: "days", n: 3 }, slides: false, defaultedAspects: false });
  assert.deepEqual(p("@ai 用稽核、記錄分析今天").aspects, ["record", "audit"]);
  assert.deepEqual(p("@AI 分析本週").range, { type: "week" }); assert.deepEqual(p("@AI 分析本週").aspects, ["record", "suggest"]);
  assert.equal(p("@AI 分析本週").defaultedAspects, true);
  assert.deepEqual(p("@AI 用建議看最近 5 天").range, { type: "days", n: 5 });
  assert.deepEqual(p("@AI 用監督看近兩天").range, { type: "days", n: 2 });
  assert.equal(p("@AI 用監督看這週,做成投影片").slides, true);
  assert.equal(p("@AI 用監督看這週").slides, false);
  assert.equal(p("@AI 用監督和提醒看一下").range, null, "no days named: the caller asks back");
  assert.equal(p("@AI 訊息分析").range, null);
  assert.equal(p("@AI 提醒我明天開會"), null, "an ordinary sentence with an aspect word is not an analysis");
  assert.equal(p("@AI 今天天氣如何"), null);
  assert.equal(p("@AI 請幫我寫一封信"), null);
  assert.equal(par.parseRange("最近 99 天"), null, "more than a month is not understood (asked back)");
  assert.deepEqual(par.parseAspects("監督 稽核 提醒 記錄 建議"), ["record", "supervise", "audit", "remind", "suggest"]);
});

test("訊息分析 (the window's API): ticked aspects only, routed like the scheduled ones; a plain member's 監督/稽核 go to the heads only", async () => {
  const r = room();
  const m = say(r, wang, "請王大明本週五前回報預算,目前沒有人負責");
  const m2 = say(r, lin, "預算數字和上週不一致");
  write = ({ prompt }) => `記錄｜討論預算｜#${m}\n建議｜下一步｜指定負責人｜#${m}\n監督｜預算沒人負責｜#${m}\n稽核｜預算數字前後不一致｜#${m2}`;
  calls = [];
  const x = await adh.requestAdhoc(A(chen), r.id, { aspects: ["record", "supervise", "audit"], range: { type: "today" } });
  assert.equal(x.outcome, "queued"); assert.deepEqual(x.routing.toHeadsOnly, ["supervise", "audit"]);
  assert.equal(x.run.trigger, "manual-adhoc"); assert.equal(x.run.kindZh, "訊息分析");
  await settled(x.run.id);
  const run = st.getRun(x.run.id);
  assert.equal(run.status, "done", run.error ?? ""); assert.equal(run.requested_by, chen.id);
  assert.ok(!/建議｜/.test(calls[0].prompt.split("規則:")[0]), "建議 was not ticked, so it was not asked for");
  assert.deepEqual(cards(r, wang).items.filter((i) => i.runId === run.id).map((i) => i.aspect), ["record"], "the channel gets 記錄 only");
  assert.match(lastPost(r), /訊息分析\(AI 草稿,待確認\)/); assert.match(lastPost(r), /陳大文 要求/);
  assert.ok(!/預算沒人負責|不一致/.test(lastPost(r)), "監督/稽核 are not in the channel");
  const k = (u) => privateOf(u, r).map((i) => i.aspect).sort();
  // 監督 is about 王小明 (who said it). He heads the only department, so there is no other head: it goes to the administrators.
  assert.deepEqual(k(wang), ["audit", "remind"], "the named person gets a 提醒, and the 稽核 as before");
  assert.deepEqual(k(lin), ["audit"], "the creator gets 稽核 but no longer the 監督");
  assert.deepEqual(k(chen), [], "the member who asked sees nothing about others");
  // the program's own fact (an overdue promise) and the model's 監督 cite the same message, so they are ONE 交辦單 (dedupe by person + sources)
  const budget = (u) => todo(u).filter((a) => /請王大明本週五前回報預算/.test(a.description));
  assert.equal(budget(admin).length, 1); assert.equal(budget(admin2).length, 1); assert.equal(budget(lin).length + budget(chen).length + budget(wang).length, 0);
  assert.match(budget(admin)[0].description, /出處:\n- 頻道訊息 #\d+(?:\(王小明\))?/, "the 交辦單 carries its source");
});

test("訊息分析: an administrator or head who asks also gets the 監督/稽核 result; custom range, validation, closed and outsiders", async () => {
  const r = room();
  const m = say(r, chen, "沒有人負責這件事");
  write = () => `監督｜這件事沒人負責｜#${m}`;
  const x = await adh.requestAdhoc(A(admin), r.id, { aspects: ["supervise"], range: { type: "custom", from: T.addDays(T.dayKey(Date.now()), -1), to: T.dayKey(Date.now()) } });
  await settled(x.run.id);
  assert.ok(todo(wang).some((a) => /沒人負責/.test(a.description)), "the head of 陳大文's department gets the 交辦單");
  assert.equal(todo(admin).filter((a) => /沒人負責這件事/.test(a.description)).length, 0, "an administrator is not a head of 陳大文's department, so nothing is routed to them just because they asked");
  const r2 = room();
  await assert.rejects(adh.requestAdhoc(A(chen), r2.id, { aspects: [], range: { type: "today" } }), (e) => e.code === "bad_aspects");
  await assert.rejects(adh.requestAdhoc(A(chen), r2.id, { aspects: ["record"], range: { type: "days", n: 99 } }), (e) => e.code === "bad_range");
  await assert.rejects(adh.requestAdhoc(A(chen), r2.id, { aspects: ["record"], range: { type: "custom", from: "2026-11-10", to: "2026-09-01" } }), (e) => e.code === "bad_range");
  await assert.rejects(adh.requestAdhoc(A(chen), r2.id, { aspects: ["record"], range: { type: "custom", from: "2026-01-01", to: "2026-11-01" } }), (e) => e.code === "bad_range");
  await assert.rejects(adh.requestAdhoc(A(chen), r2.id, { aspects: ["record"], range: "today" }), (e) => e.code === "bad_range");
  await assert.rejects(adh.requestAdhoc(A(out), r2.id, { aspects: ["record"], range: { type: "today" } }), (e) => e.status === 404 || e.status === 403, "outsiders cannot");
  await assert.rejects(adh.requestAdhoc(A(chen), "r000000000000", { aspects: ["record"], range: { type: "today" } }), (e) => e.status === 404);
  rooms.closeRoom?.(A(lin), r2.id);
  const range = adh.resolveRange({ type: "days", n: 3 }, Date.parse("2026-11-15T10:00:00+08:00"));
  assert.equal(range.sinceTs, Date.parse("2026-11-13T00:00:00+08:00")); assert.equal(range.label, "最近 3 天");
  assert.equal(adh.resolveRange({ type: "week" }, Date.parse("2026-11-15T10:00:00+08:00")).sinceTs, Date.parse("2026-11-09T00:00:00+08:00"));
});

test("訊息分析: only the messages inside the range are read; nothing in range means skipped (and no cooldown is used)", async () => {
  const r = room();
  say(r, wang, "很久以前的事", Date.now() - 10 * D);
  const none = await adh.requestAdhoc(A(chen), r.id, { aspects: ["record"], range: { type: "days", n: 3 } });
  assert.equal(none.outcome, "skipped"); assert.match(none.run.error, /沒有訊息/);
  const m = say(r, wang, "兩天前的事", Date.now() - 2 * D);
  calls = []; write = () => `記錄｜兩天前的事｜#${m}`;
  const x = await adh.requestAdhoc(A(chen), r.id, { aspects: ["record"], range: { type: "days", n: 3 } });
  assert.equal(x.outcome, "queued", "a skipped run did not start the cooldown");
  await settled(x.run.id);
  assert.ok(/兩天前的事/.test(calls[0].prompt) && !/很久以前/.test(calls[0].prompt));
});

test("訊息分析: one run per channel every 5 minutes, one at a time, and the model call uses the shared AI slot", async () => {
  const r = room(); const m = say(r, wang, "有訊息");
  let release; const gate = new Promise((res) => { release = res; });
  eng.setWizardModel(async (req) => { calls.push(req); await gate; return `記錄｜有訊息｜#${m}`; });
  calls = [];
  const x = await adh.requestAdhoc(A(chen), r.id, { aspects: ["record"], range: { type: "today" } });
  assert.equal(x.outcome, "queued");
  await assert.rejects(adh.requestAdhoc(A(wang), r.id, { aspects: ["record"], range: { type: "today" } }), (e) => e.status === 429 && e.code === "rate_limited", "a second ask in the same channel is refused with the wait");
  assert.ok(adh.adhocWaitMs(r.id) > 4 * 60_000);
  assert.ok(aiRun.aiSlotsFree() < aiRun.aiSlotsFree() + 1 && aiRun.aiSlotsFree() >= 0);
  release(); await settled(x.run.id);
  assert.equal(st.getRun(x.run.id).status, "done");
  // 5 minutes later it may run again
  getDb().prepare("UPDATE wizard_runs SET created_at=created_at-? WHERE id=?").run(6 * 60_000, x.run.id);
  assert.equal(adh.adhocWaitMs(r.id), 0);
  eng.setWizardModel(async (req) => { calls.push(req); return write(req); });
  // another channel is not held up by this one
  const r2 = room(); say(r2, wang, "另一個頻道"); write = ({ prompt }) => `記錄｜另一個｜#${seqsOf(prompt)[0]}`;
  const y = await adh.requestAdhoc(A(chen), r2.id, { aspects: ["record"], range: { type: "today" } });
  await settled(y.run.id);
  assert.equal(st.getRun(y.run.id).status, "done");
  // the scheduled wizards are not counted
  assert.ok(audit("wizard.run").some((a) => a.runId === x.run.id && a.trigger === "manual-adhoc"));
});

test("訊息分析 with 「做成報告投影片」: a channel deck for everyone, the heads' deck only for the heads", async () => {
  const r = room(); const m = say(r, wang, "這個月預算超支,沒人負責");
  write = () => `記錄｜預算超支｜#${m}\n監督｜預算超支沒人負責｜#${m}`;
  const x = await adh.requestAdhoc(A(lin), r.id, { aspects: ["record", "supervise"], range: { type: "today" }, slides: true });
  await settled(x.run.id);
  assert.equal(st.getRun(x.run.id).status, "done", st.getRun(x.run.id).error ?? "");
  assert.match(lastPost(r), /報告投影片/);
  assert.ok(privateOf(wang, r).some((i) => i.extra?.deck));
  assert.ok(!privateOf(chen, r).some((i) => i.extra?.deck));
  const noSlides = await (async () => { const r2 = room(); const m2 = say(r2, wang, "x"); write = () => `記錄｜x｜#${m2}`; const y = await adh.requestAdhoc(A(lin), r2.id, { aspects: ["record"], range: { type: "today" } }); await settled(y.run.id); return lastPost(r2); })();
  assert.ok(!/報告投影片/.test(noSlides), "no deck unless asked for");
});

test("@AI 用監督和提醒看最近三天: handled by the wizard engine (no plain @AI), unclear is asked back, errors are said in the channel", async () => {
  const r = room(); const m = say(r, wang, "沒人負責這件事");
  write = () => `監督｜沒人負責這件事｜#${m}`;
  assert.equal(await adh.handleAdhocMention(A(chen), r.id, "@AI 今天天氣如何"), false, "an ordinary question is left to the plain @AI");
  assert.equal(await adh.handleAdhocMention(A(chen), r.id, "@AI 提醒我明天開會"), false);
  // unclear: no days named
  assert.equal(await adh.handleAdhocMention(A(chen), r.id, "@AI 用監督和提醒看一下"), true);
  assert.match(aiSaid(r).at(-1), /要分析哪一段時間/); assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM wizard_runs WHERE room_id=? AND kind='adhoc'").get(r.id).n, 0, "nothing started");
  assert.equal(await adh.handleAdhocMention(A(chen), r.id, "@AI 用監督和提醒看最近三天"), true);
  const run = getDb().prepare("SELECT * FROM wizard_runs WHERE room_id=? AND kind='adhoc'").get(r.id);
  assert.ok(run); assert.equal(run.trigger, "manual-adhoc");
  assert.deepEqual(JSON.parse(run.input).aspects, ["supervise", "remind"]);
  assert.match(aiSaid(r).at(-1), /監督只會送給主管/);
  await settled(run.id);
  assert.ok(todo(admin).length > 0, "王小明 is the only head, so his own 監督 goes to the administrators");
  assert.ok(!privateOf(chen, r).some((i) => i.aspect === "supervise"));
  // a second one right away: the rate limit is said in the channel
  assert.equal(await adh.handleAdhocMention(A(chen), r.id, "@AI 用監督看今天"), true);
  assert.match(aiSaid(r).at(-1), /分鐘後再試/);
  // an outsider's line is refused
  assert.equal(await adh.handleAdhocMention(A(out), r.id, "@AI 用監督看今天"), true);
  assert.ok(!/開始/.test(aiSaid(r).at(-1)));
});

test("UI source: the private item and the channel card turn the program's deck links into links (and only that shape)", () => {
  const src = readFileSync(new URL("../ui/Wizards.tsx", import.meta.url), "utf8");
  assert.match(src, /<LinkedText text=\{item\.text\} \/>/, "WizardPersonal shows the item text through LinkedText");
  assert.match(src, /data-tg-report/);
  const re = new RegExp(/const DECK_LINK = \/(.+)\/g;/.exec(src)[1], "g");
  const links = rep.deckLinks({ id: "uabdc8732a42b-90501ba44816", pdf: true, title: "t" });
  assert.equal([...links.matchAll(re)].length, 2, "PDF and PowerPoint");
  assert.equal([...`[x](/api/tg/slides/../../etc/passwd) [PDF](https://evil.example/a)`.matchAll(re)].length, 0, "no other shape becomes a link");
  for (const k of ["wizAnalysisTitle", "wizAspReset", "wizAspRecommended", "wizAnalysisPrivateMember", "wizTrig_manual_adhoc"]) assert.ok(readFileSync(new URL("../pages/i18n-wizard.ts", import.meta.url), "utf8").includes(`${k}:`), `${k} has a text`);
});
