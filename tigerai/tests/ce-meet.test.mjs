// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 會議摘要 (community edition 2.4):
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-meet.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const dir = mkdtempSync(join(tmpdir(), "tg-meet-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
delete process.env.TIGERAI_ASR_URL;

const acc = await import("../accounts/service.ts");
const rooms = await import("../rooms/service.ts");
const sum = await import("../wizards/meeting/summarize.ts");
const asr = await import("../wizards/meeting/asr-settings.ts");
const svc = await import("../wizards/meeting/service.ts");
const host = await import("../wizards/meeting/host.ts");
const routes = await import("../wizards/meeting/routes.ts");
const { getDb } = await import("../db/store.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const lin = mk("lin@example.com", "林小華");
const wang = mk("wang@example.com", "王小明");
const out = mk("out@example.com", "外人");
const A = (u) => ({ id: u.id, role: u.role });
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error("condition not reached"); };
const auditOf = (action) => getDb().prepare("SELECT extra FROM audit WHERE action=?").all(action).map((r) => JSON.parse(r.extra ?? "{}"));
const wait = (id) => until(() => ["done", "failed"].includes(svc.getView(A(lin), id).status));

const TRANSCRIPT = ["王小明:這個月結對帳表由林小華負責,下週五交。", "林小華:好,我下週五前交。", "王小明:另外供應商對帳單目前沒人接,先放著。", "王小明:決議:月結日改成每月 5 號。"].join("\n");
const goodAnswer = JSON.stringify({
  decisions: [{ text: "月結日改成每月 5 號", lines: [4] }, { text: "沒有出處的決議", lines: [] }, { text: "亂寫行號", lines: [99] }],
  actions: [
    { task: "交對帳表", owner: "林小華", due: "2099-01-15", lines: [1, 2] },
    { task: "供應商對帳單", owner: null, due: null, lines: [3] },
    { task: "過期的事", owner: "王小明", due: "2000-01-01", lines: [1] },
    { task: "日期壞掉", owner: "未定", due: "2026-13-45", lines: [3] },
  ],
  suggestions: [{ text: "把月結日寫進 SOP", lines: [4] }],
});
let modelCalls = [];
let answer = goodAnswer;
svc.setModelCall(async (system, user) => { modelCalls.push({ system, user }); if (answer instanceof Error) throw answer; return "```json\n" + answer + "\n```"; });

test("segmentTranscript: one numbered line per row, long blocks cut after sentences", () => {
  assert.deepEqual(sum.segmentTranscript("a\r\n\r\n b \n"), ["a", "b"]);
  const block = "今天開會討論月結。".repeat(60);
  const lines = sum.segmentTranscript(block);
  assert.ok(lines.length > 3 && lines.every((l) => l.length <= 200), "cut into short lines");
  assert.equal(lines.join(""), block, "nothing lost");
});

test("parseSummary: a source is required, owner/due are checked by the program, unowned is derived", () => {
  const people = [{ id: "u1", name: "林小華" }, { id: "u2", name: "王小明" }];
  const s = sum.parseSummary(goodAnswer, { lineCount: 4, today: "2026-11-15", people });
  assert.equal(s.decisions.length, 1, "no source / line out of range dropped");
  assert.equal(s.dropped, 2);
  assert.equal(s.actions.length, 4);
  const [a, b, c, d] = s.actions;
  assert.equal(a.ownerId, "u1"); assert.equal(a.due, "2099-01-15"); assert.equal(a.unowned, false); assert.equal(a.overdue, false);
  assert.equal(b.unowned, true); assert.equal(b.noDue, true);
  assert.equal(c.overdue, true);
  assert.equal(d.owner, null, "「未定」 is nobody"); assert.equal(d.due, null, "an impossible date is no date"); assert.equal(d.unowned, true);
  assert.equal(sum.parseSummary("not json at all", { lineCount: 4, today: "2026-11-15", people }), null);
  const only = sum.parseSummary('{"decisions":[{"text":"x"}]}', { lineCount: 4, today: "2026-11-15", people });
  assert.equal(only.decisions.length, 0); assert.equal(only.dropped, 1);
});

test("renderSummary: the room draft only counts the unowned items; the personal view lists them", () => {
  const people = [{ id: "u1", name: "林小華" }];
  const s = sum.parseSummary(goodAnswer, { lineCount: 4, today: "2026-11-15", people });
  const lines = sum.segmentTranscript(TRANSCRIPT);
  const room = sum.renderSummary({ title: "月結會", date: "2026-11-15" }, s, lines, "room");
  assert.match(room, /AI 草稿,待確認/); assert.match(room, /第 4 行/); assert.match(room, /出處對照/);
  assert.doesNotMatch(room, /監督:沒人負責的事/, "no 監督 list in the room");
  assert.match(room, /有 \d 件事沒有人負責/);
  const mine = sum.renderSummary({ title: "月結會", date: "2026-11-15" }, s, lines, "personal");
  assert.match(mine, /監督:沒人負責的事/);
  const p = sum.assignmentPrefill({ title: "月結會", date: "2026-11-15" }, s.actions[0], lines);
  assert.equal(p.assigneeId, "u1"); assert.equal(p.dueDate, "2099-01-15"); assert.match(p.description, /第 1 行/);
});

test("ASR settings: url normalised, key file mode 600, last four only, test connection with a fake service", async () => {
  assert.equal(asr.normalizeAsrUrl("http://x:1/v1/"), "http://x:1/v1/audio/transcriptions");
  assert.equal(asr.normalizeAsrUrl("http://x:1/v1/audio/transcriptions"), "http://x:1/v1/audio/transcriptions");
  assert.throws(() => asr.normalizeAsrUrl("ftp://x"), /http/);
  assert.throws(() => asr.normalizeAsrUrl("http://u:p@x/v1"), /credentials/);
  assert.equal(asr.viewAsr().configured, false);
  const { createServer } = await import("node:http");
  const seen = [];
  const srv = createServer((req, res) => { seen.push({ auth: req.headers.authorization, ct: req.headers["content-type"] }); req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: TRANSCRIPT })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/v1`;
  const v = asr.saveAsr(admin.id, { url, apiKey: "sk-secret-abcd1234", model: "m1" });
  assert.equal(v.configured, true); assert.equal(v.keyLast4, "1234"); assert.equal(JSON.stringify(v).includes("secret"), false);
  assert.equal(statSync(asr.asrKeyFile()).mode & 0o777, 0o600);
  const t = await asr.testAsr({});
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(seen[0].auth, "Bearer sk-secret-abcd1234"); assert.match(seen[0].ct, /multipart\/form-data/);
  assert.equal((await asr.testAsr({ url: "http://127.0.0.1:1/v1" })).ok, false);
  assert.equal(JSON.stringify(auditOf("asr.update")).includes("secret"), false);
  globalThis.__fakeAsr = srv; globalThis.__asrUrl = url;
});

test("paste a transcript in a room: AI draft in the room, 提醒 to the owner, 監督 to the supervisors only", async () => {
  const room = rooms.createRoom(A(wang), "月結小組", [lin.id]);
  const m = svc.createFromText(A(wang), { title: "月結會", transcript: TRANSCRIPT, roomId: room.id });
  await until(() => ["done", "failed"].includes(svc.getView(A(wang), m.id).status));
  const v = svc.getView(A(wang), m.id);
  assert.equal(v.status, "done", v.error);
  assert.ok(modelCalls.at(-1).user.includes("[4] 王小明:決議"), "the model got numbered lines");
  const posted = getDb().prepare("SELECT text, kind FROM room_messages WHERE room_id=? AND kind='wizard'").all(room.id);
  assert.equal(posted.length, 1); assert.match(posted[0].text, /會議摘要\(AI 草稿,待確認\)/);
  const mine = (u) => getDb().prepare("SELECT aspect AS kind, text AS title, sources FROM wizard_items WHERE recipient_id=? AND state='open'").all(u.id).map((x) => ({ ...x, sources: JSON.parse(x.sources) }));
  assert.ok(mine(lin).some((x) => x.kind === "remind" && x.title.includes("交對帳表") && x.sources.length > 0), "owner reminded");
  assert.equal(mine(lin).some((x) => x.kind === "supervise"), false, "a plain member gets no 監督");
  assert.ok(mine(wang).some((x) => x.kind === "supervise" && x.sources.length > 0), "room creator supervises");
  assert.equal(v.prefills.length, 4); assert.equal(v.mine, true);
  assert.equal(host.wizardHost(), host.defaultHost);
  // Through the engine: a confirmable card in the room, the bell and 公佈欄 個人區 see the items, the failure/limit paths share the one slot.
  const run = getDb().prepare("SELECT * FROM wizard_runs WHERE kind='meeting' AND input=?").get(JSON.stringify({ ref: m.id }));
  assert.equal(run.status, "done"); assert.equal(run.confirm_state, "draft"); assert.ok(run.post_seq > 0);
  const store = await import("../wizards/store.ts");
  assert.ok(store.privateOpenFor(A(lin)).some((x) => x.aspect === "remind" && x.sources[0]?.t === "x" && x.sources[0].quote.length > 0), "in lin's 個人區");
  assert.equal(store.privateOpenFor(A(out)).length, 0);
  const eng = await import("../wizards/engine.ts");
  assert.equal(eng.confirmRun(A(wang), run.id).confirmState, "confirmed");
  assert.throws(() => eng.confirmRun(A(lin), run.id), /No such room|forbidden|Only|bad_state|already|Already/i);
  assert.equal(getDb().prepare("SELECT name FROM sqlite_master WHERE name='wizard_private_items'").get(), undefined, "the temporary table is gone");
});

test("rows an early build left in wizard_private_items move into the engine and the table goes away", async () => {
  const eng = await import("../wizards/engine.ts");
  const store = await import("../wizards/store.ts");
  const mstore = await import("../wizards/meeting/store.ts");
  const room = rooms.createRoom(A(wang), "舊資料", [lin.id]);
  mstore.ensureTables();
  const db = getDb();
  db.exec("CREATE TABLE wizard_private_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, wizard TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]', ref_id TEXT, created_at INTEGER NOT NULL, read_at INTEGER)");
  db.prepare("INSERT INTO meetings (id,owner_id,room_id,title,source,status,created_at,updated_at) VALUES ('mold',?,?,'舊會','text','done',1,1)").run(wang.id, room.id);
  db.prepare("INSERT INTO wizard_private_items VALUES ('p1',?,'meeting','remind','會議待辦:舊事','期限未定。',?,'mold',1,NULL)").run(lin.id, JSON.stringify([{ label: "會議「舊會」第 1 行", quote: "舊事" }]));
  db.prepare("INSERT INTO wizard_private_items VALUES ('p2',?,'meeting','remind','沒出處','x','[]','mold',1,NULL)").run(lin.id);
  delete globalThis[Symbol.for("tigerai:meeting-tables")];
  mstore.ensureTables();
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='wizard_private_items'").get(), undefined);
  const mine = store.privateOpenFor(A(lin)).filter((x) => x.text.includes("舊事"));
  assert.equal(mine.length, 1, "the sourced row moved, the unsourced one did not");
  void eng;
});

test("nobody outside the room sees the meeting; only the starter retries; AI never opens an assignment by itself", async () => {
  const room = getDb().prepare("SELECT room_id FROM meetings ORDER BY created_at DESC LIMIT 1").get().room_id;
  const id = getDb().prepare("SELECT id FROM meetings WHERE room_id=?").get(room).id;
  assert.throws(() => svc.getView(A(out), id), /No such meeting/);
  assert.ok(svc.getView(A(lin), id).summary, "a room member reads it");
  assert.equal(svc.getView(A(lin), id).prefills.length, 0, "prefills only for the starter");
  assert.throws(() => svc.retry(A(lin), id), /not failed|Only/);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM assignments").get().n, 0, "no assignment was created by the AI");
  assert.throws(() => svc.createFromText(A(out), { transcript: "x", roomId: room }), /No such room/);
});

test("model failure is shown, retried by the owner; a summary with no sourced item is refused", async () => {
  answer = new Error("The model service answered 502");
  const m = svc.createFromText(A(lin), { title: "失敗", transcript: TRANSCRIPT });
  await wait(m.id);
  let v = svc.getView(A(lin), m.id);
  assert.equal(v.status, "failed"); assert.equal(v.failedStage, "summary"); assert.match(v.error, /沒有完成/);
  answer = JSON.stringify({ decisions: [{ text: "沒出處" }], actions: [], suggestions: [] });
  svc.retry(A(lin), m.id); await wait(m.id);
  v = svc.getView(A(lin), m.id);
  assert.equal(v.status, "failed"); assert.match(v.error, /沒有附上逐字稿出處/);
  answer = goodAnswer;
  svc.retry(A(lin), m.id); await wait(m.id);
  assert.equal(svc.getView(A(lin), m.id).status, "done");
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM wizard_items i JOIN wizard_runs r ON r.id=i.run_id WHERE r.input=?").get(JSON.stringify({ ref: m.id })).n, 0, "no room, nothing delivered to others");
});

test("upload: chunks go to disk, offsets are enforced, type and size are checked, ASR runs, asr.transcribe is audited", async () => {
  assert.throws(() => svc.startUpload(A(lin), { name: "x.exe", size: 10 }), /mp3, m4a, wav or webm/);
  assert.throws(() => svc.startUpload(A(lin), { name: "x.mp3", size: 201 * 1024 * 1024 }), /larger than 200 MB/);
  const { uploadId } = svc.startUpload(A(lin), { name: "週會.mp3", size: 10, title: "週會" });
  const body = (b) => Readable.toWeb(Readable.from([Buffer.from(b)]));
  await assert.rejects(svc.appendChunk(A(lin), uploadId, 5, body("abc")), /Expected offset 0/);
  await assert.rejects(svc.appendChunk(A(wang), uploadId, 0, body("abc")), /No such upload/);
  assert.equal((await svc.appendChunk(A(lin), uploadId, 0, body("abcde"))).received, 5);
  await assert.rejects(svc.appendChunk(A(lin), uploadId, 5, body("0123456789")), /larger than allowed/);
  assert.equal(statSync(join(process.env.TIGERAI_DATA_DIR, "meetings", "_uploads", `${uploadId}.part`)).size, 5, "a refused chunk leaves nothing behind");
  assert.throws(() => svc.finishUpload(A(lin), uploadId), /Received 5 of 10/);
  await svc.appendChunk(A(lin), uploadId, 5, body("fghij"));
  svc.setTranscriber(null); // the real client, against the fake service
  const m = svc.finishUpload(A(lin), uploadId);
  assert.equal(m.status, "transcribing");
  await wait(m.id);
  const v = svc.getView(A(lin), m.id);
  assert.equal(v.status, "done", v.error); assert.equal(v.lines.length, 4); assert.equal(v.source, "audio");
  const ev = auditOf("asr.transcribe").at(-1);
  assert.equal(ev.outcome, "ok"); assert.equal(ev.bytes, 10);
  assert.ok(existsSync(svc.transcriptFile(A(lin), m.id).path));
  assert.equal(readFileSync(svc.transcriptFile(A(lin), m.id).path, "utf8").trim().split("\n").length, 4);
});

test("an ASR failure is kept as a failed transcribe step and can be retried", async () => {
  const { uploadId } = svc.startUpload(A(lin), { name: "a.wav", size: 3 });
  await svc.appendChunk(A(lin), uploadId, 0, Readable.toWeb(Readable.from([Buffer.from("abc")])));
  let n = 0;
  svc.setTranscriber(async () => { if (n++ === 0) throw new Error("The speech service answered 500"); return TRANSCRIPT; });
  const m = svc.finishUpload(A(lin), uploadId);
  await wait(m.id);
  assert.equal(svc.getView(A(lin), m.id).failedStage, "transcribe");
  assert.equal(auditOf("asr.transcribe").at(-1).outcome, "failed");
  svc.retry(A(lin), m.id); await wait(m.id);
  assert.equal(svc.getView(A(lin), m.id).status, "done");
});

test("ASR not configured: upload is refused with a clear code, pasting still works", async () => {
  globalThis.__fakeAsr.close();
  asr.saveAsr(admin.id, { url: null, apiKey: null });
  assert.equal(svc.capabilities().asrConfigured, false);
  assert.throws(() => svc.startUpload(A(lin), { name: "a.mp3", size: 5 }), (e) => e.code === "asr_not_configured");
  const m = svc.createFromText(A(lin), { transcript: TRANSCRIPT });
  await wait(m.id);
  assert.equal(svc.getView(A(lin), m.id).status, "done");
});

test("routes: members cannot reach the ASR settings; the admin can; a member sees capabilities", async () => {
  const req = (method, body) => new Request("http://x/api/tg/admin/asr", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  await assert.rejects(routes.asrAdminRoutes(req("GET"), "GET", A(lin), undefined), /Administrator only/);
  const r = await routes.asrAdminRoutes(req("GET"), "GET", A(admin), undefined);
  const j = await r.json();
  assert.equal(j.configured, false); assert.equal("apiKey" in j, false);
  const c = await (await routes.meetingRoutes(new Request("http://x/api/tg/meeting/capabilities"), "GET", A(lin), ["capabilities"])).json();
  assert.equal(c.asrConfigured, false); assert.equal(c.maxAudioBytes, 200 * 1024 * 1024);
});

test("linking an action to an assignment needs an assignment the starter created", async () => {
  const asg = await import("../workorders/assignments.ts");
  const id = getDb().prepare("SELECT id FROM meetings WHERE owner_id=? AND status='done' ORDER BY created_at DESC LIMIT 1").get(lin.id).id;
  const mine = asg.createAssignment(A(lin), { title: "交對帳表", assigneeId: wang.id });
  const theirs = asg.createAssignment(A(wang), { title: "別人的", assigneeId: lin.id });
  svc.linkAction(A(lin), id, 0, mine.id);
  assert.equal(svc.getView(A(lin), id).links.length, 1);
  assert.throws(() => svc.linkAction(A(lin), id, 0, theirs.id), /not yours/);
  assert.throws(() => svc.linkAction(A(lin), id, 99, mine.id), /No such action/);
  assert.throws(() => svc.linkAction(A(wang), id, 0, mine.id), /No such meeting|Only/);
});
