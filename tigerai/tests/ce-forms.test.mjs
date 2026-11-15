// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 填表工具: field-map checks, "ask, never guess" validation, the PDF drawn only when nothing is missing or contradictory, scoped downloads.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-forms.test.mjs
// Needs a font with Chinese glyphs for the drawing tests: TIGERAI_TEST_FONT, a TrueType .ttf with Latin and Chinese glyphs (the tests that draw are skipped without one; Droid Sans Fallback has no Latin).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";

const dir = mkdtempSync(join(tmpdir(), "tg-forms-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
delete process.env.TIGERAI_FORM_FONT;
const FONT = [process.env.TIGERAI_TEST_FONT].find((f) => f && existsSync(f));

const V = await import("../forms/validate.ts");
const S = await import("../forms/service.ts");
const { createFormsExtension } = await import("../forms/extension.ts");
const acc = await import("../accounts/service.ts");
const { handle } = await import("../api/router.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const { getDb } = await import("../db/store.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const teacher = mk("teacher@example.com", "王老師");
const teacher2 = mk("teacher2@example.com", "李老師");
const stu = mk("stu@example.com", "學生甲");
const stu2 = mk("stu2@example.com", "學生乙");
const outsider = mk("out@example.com", "外人");
const g1 = acc.createGroup(admin.id, { name: "甲班" });
const g2 = acc.createGroup(admin.id, { name: "乙班" });
acc.setMembership(admin.id, g1.id, teacher.id, true, true); acc.setMembership(admin.id, g1.id, stu.id, true);
acc.setMembership(admin.id, g2.id, teacher2.id, true, true); acc.setMembership(admin.id, g2.id, stu2.id, true);
const P = (u) => ({ id: u.id, role: u.role });
const call = async (u, method, path, body) => {
  const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": u.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/"));
  return { status: res.status, json: res.headers.get("content-type")?.includes("json") ? await res.json() : null, res };
};

// A small made-up form: a blank PDF with a few printed labels (no real form, so no copyright question).
async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]); doc.addPage([400, 300]);
  return Buffer.from(await doc.save()).toString("base64");
}
const slot = (x0, x1, top, extra = {}) => ({ x0, x1, top, ...extra });
const DEF = {
  version: 1, ageFrom: "birthday", leftBlank: ["簽名(本人親簽)"], notes: ["範例表單"],
  fields: [
    { key: "kind", label: "類型", type: "choice", required: true, options: { general: { label: "一般", check: { x: 20, y: 20 } }, family: { label: "家庭", check: { x: 20, y: 40 } } } },
    { key: "cross", label: "跨縣市", type: "multi", options: { a: { label: "甲市", check: { x: 100, y: 20 } }, b: { label: "乙市", check: { x: 100, y: 40 } } } },
    { key: "name", label: "姓名", type: "text", required: true, pattern: "^[一-鿿A-Za-z·]{2,20}$", patternHint: "2-20 個中英文字", slot: slot(150, 230, 40, { size: 12 }) },
    { key: "id_number", label: "身分證字號", type: "text", required: true, validator: "tw-id", slot: slot(240, 380, 40) },
    { key: "era", label: "紀年", type: "choice", options: { ad: { label: "西元", circle: { x0: 20, x1: 40, y0: 60, y1: 72 } }, roc: { label: "民國", circle: { x0: 45, x1: 65, y0: 60, y1: 72 } } } },
    { key: "birthday", label: "出生日期", type: "date", required: true, eraField: "era", notFuture: true, parts: { year: slot(70, 110, 70), month: slot(120, 140, 70), day: slot(150, 170, 70) } },
    { key: "age", label: "年齡", type: "text", pattern: "^\\d{1,3}$", slot: slot(180, 210, 70) },
    { key: "tel", label: "電話", type: "text", pattern: "^0\\d{1,2}-\\d{6,8}$", patternHint: "區碼-號碼", splitOn: "-", slots: [slot(220, 240, 70), slot(245, 330, 70, { align: "left" })] },
    { key: "address", label: "地址", type: "group", fields: [
      { key: "city", label: "縣市", type: "text", required: true, stripSuffix: "縣市", slot: slot(20, 60, 100) },
      { key: "district", label: "區", type: "text", required: true, stripSuffix: "市鄉鎮區", slot: slot(80, 130, 100) },
      { key: "number", label: "號", type: "text", required: true, slot: slot(150, 190, 100, { minSize: 6 }) },
    ] },
    { key: "household_no", label: "戶號", type: "text", slot: slot(20, 100, 130) },
    { key: "same", label: "戶籍同上", type: "bool", check: { x: 200, y: 120 } },
    { key: "perm", label: "戶籍地址", type: "group", fields: [{ key: "city", label: "縣市", type: "text", slot: slot(20, 60, 160) }] },
    { key: "consent", label: "已閱讀同意書", type: "bool", required: true, mustBeTrue: true },
    { key: "date", label: "填表日期", type: "date", rocYear: true, parts: { year: slot(300, 320, 280), month: slot(330, 345, 280), day: slot(350, 365, 280) } },
  ],
  rules: [
    { type: "requires", if: { field: "kind", eq: "family" }, fields: ["household_no"] },
    { type: "forbids", if: { field: "kind", ne: "family" }, fields: ["household_no"], message: "只有家庭類型才有戶號,但類型不是家庭,互相矛盾" },
    { type: "conflict", when: [{ field: "kind", eq: "family" }, { field: "cross", present: true }], message: "家庭類型不能同時申請跨縣市" },
    { type: "exactlyOne", fields: ["same", "perm"], message: "戶籍同上與另填戶籍地址同時出現,互相矛盾;請擇一" },
    { type: "conflict", when: [{ field: "$age", lt: 18 }], severity: "warning", message: "未滿 18 歲({age}):需要法定代理人簽名" },
    { type: "age-matches", ageField: "age" },
  ],
};
const GOOD = () => ({
  kind: "general", name: "陳測試", id_number: "A123456789", era: "roc", birthday: "1995-03-08", age: 31, tel: "02-12345678",
  address: { city: "新北市", district: "板橋區", number: "88" }, same: true, consent: true, date: "2026-11-15",
});
const TODAY = V.parseDate("2026-11-15");

test("field-map check at import: duplicate keys, coordinates off the page, a rule that names no field and an option that draws nothing are refused", async () => {
  const sizes = [{ width: 400, height: 300 }, { width: 400, height: 300 }];
  assert.equal(V.checkDef(DEF, sizes).ok, true);
  const bad = (mut) => { const d = structuredClone(DEF); mut(d); return V.checkDef(d, sizes); };
  assert.match(bad((d) => d.fields.push({ ...d.fields[2] })).errors.join("\n"), /重複/);
  assert.match(bad((d) => { d.fields[2].slot.x1 = 9999; }).errors.join("\n"), /超出頁面/);
  assert.match(bad((d) => { d.fields[2].slot.page = 5; }).errors.join("\n"), /沒有第 6 頁/);
  assert.match(bad((d) => d.rules.push({ type: "requires", if: { field: "nope", eq: 1 }, fields: ["name"] })).errors.join("\n"), /不存在的欄位 nope/);
  assert.match(bad((d) => { delete d.fields[0].options.general.check; }).errors.join("\n"), /沒有 check 也沒有 circle/);
  assert.match(bad((d) => { d.fields[2].pattern = "("; }).errors.join("\n"), /正規表示式/);
  assert.equal(V.checkDef({ version: 2 }, sizes).ok, false);
});

test("complete data passes; a warning (minor) does not stop it", () => {
  const p = V.validate(DEF, GOOD(), TODAY);
  assert.deepEqual([p.missing, p.errors, p.warnings], [[], [], []]);
  const minor = V.validate(DEF, { ...GOOD(), birthday: "2012-05-01", age: 14 }, TODAY);
  assert.deepEqual([minor.missing, minor.errors], [[], []]);
  assert.match(minor.warnings.join(""), /未滿 18 歲\(14\)/);
});

test("missing values are listed, never filled in: required, bool that must be true, a group's required parts, rule-required", () => {
  const p = V.validate(DEF, { kind: "family", name: "陳測試", id_number: "A123456789", birthday: "1995-03-08", address: { city: "新北市" } }, TODAY);
  assert.deepEqual(p.missing.map((m) => m.key).sort(), ["address.district", "address.number", "consent", "household_no", "perm", "same"].sort());
  assert.equal(p.missing.find((m) => m.key === "consent").label, "已閱讀同意書");
  assert.deepEqual(V.validate(DEF, { ...GOOD(), consent: false }, TODAY).missing.map((m) => m.key), ["consent"], "false is not consent");
});

test("contradictions are errors: family + cross, household on a non-family form, same-as-above + another address, age vs birthday, bad checksum, not a choice, future date", () => {
  const e = (over) => V.validate(DEF, { ...GOOD(), ...over }, TODAY).errors.join("\n");
  assert.match(e({ kind: "family", household_no: "H1", cross: ["a"] }), /家庭類型不能同時申請跨縣市/);
  assert.match(e({ household_no: "H1" }), /互相矛盾/);
  assert.match(e({ perm: { city: "高雄" } }), /戶籍同上與另填戶籍地址同時出現/);
  assert.match(e({ age: 25 }), /生日算出來是 31 歲,但 age 寫 25/);
  assert.match(e({ id_number: "A123456788" }), /檢查碼不正確/);
  assert.match(e({ kind: "other" }), /必須是 \["general","family"\] 之一/);
  assert.match(e({ birthday: "2027-01-01", age: undefined }), /在未來/);
  assert.match(e({ birthday: "1995/03/08" }), /YYYY-MM-DD/);
  assert.match(e({ tel: "0212345678" }), /格式不合/);
  assert.match(e({ name: "A" }), /格式不合/);
});

test("a key the form does not have is refused, not ignored or guessed; _note is allowed", () => {
  const p = V.validate(DEF, { ...GOOD(), hobby: "閱讀", address: { city: "新北市", district: "板橋區", number: "1", street: "x" }, _note: "ok" }, TODAY);
  assert.match(p.errors.join("\n"), /未知欄位 hobby/);
  assert.match(p.errors.join("\n"), /address\.street 不是表單上有的欄位/);
  assert.ok(!p.errors.join("").includes("_note"));
  assert.match(V.validate(DEF, "x", TODAY).errors[0], /JSON 物件/);
});

test("Taiwan ID checksum", () => {
  assert.equal(V.twIdOk("A123456789"), true);
  assert.equal(V.twIdOk("A123456788"), false);
  assert.equal(V.twIdOk("a123456789"), false);
});

// ---- the server side ----
const f = {};
test("import: members cannot; a teacher only for departments they head; the package is checked before anything is stored", async () => {
  const pdf = await blankPdf();
  const body = { name: "測試表單", description: "教學用", group_ids: [g1.id], pdf_base64: pdf, def: DEF };
  assert.equal((await call(stu, "POST", "forms/manage", body)).status, 403, "a student cannot import");
  assert.equal((await call(stu, "GET", "forms/manage")).status, 403);
  assert.equal((await call(teacher, "POST", "forms/manage", { ...body, group_ids: [g2.id] })).status, 403, "not their department");
  assert.equal((await call(teacher, "POST", "forms/manage", { ...body, group_ids: [] })).status, 403, "a teacher must name a department");
  assert.equal((await call(teacher, "POST", "forms/manage", { ...body, pdf_base64: Buffer.from("not a pdf").toString("base64") })).status, 400);
  const broken = structuredClone(DEF); broken.fields[2].slot.x1 = 9999;
  const r = await call(teacher, "POST", "forms/manage", { ...body, def: broken });
  assert.equal(r.status, 400); assert.match(r.json.error, /超出頁面/);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM tg_forms").get().n, 0, "nothing stored for a broken package");
  const ok = await call(teacher, "POST", "forms/manage", body);
  assert.equal(ok.status, 201);
  f.id = ok.json.id;
  assert.equal((statSync(join(dir, "data", "forms", f.id, "blank.pdf")).mode & 0o777).toString(8), "600");
  assert.deepEqual((await call(teacher, "GET", "forms/manage")).json.forms.map((x) => x.id), [f.id]);
  assert.deepEqual((await call(teacher2, "GET", "forms/manage")).json.forms, [], "another department's teacher does not see it");
  assert.equal((await call(teacher2, "PATCH", `forms/manage/${f.id}`, { enabled: false })).status, 404);
  assert.equal((await call(teacher2, "DELETE", `forms/manage/${f.id}`)).status, 404);
  assert.equal((await call(admin, "GET", "forms/manage")).json.forms.length, 1, "an administrator sees every form");
});

test("who can use it: the department's members and administrators; nobody else, and a disabled form is gone for students", async () => {
  assert.deepEqual((await call(stu, "GET", "forms")).json.forms.map((x) => x.form_id), [f.id]);
  assert.deepEqual((await call(stu2, "GET", "forms")).json.forms, [], "another class");
  assert.deepEqual((await call(outsider, "GET", "forms")).json.forms, []);
  const spec = (await call(stu, "GET", "forms")).json.forms[0];
  assert.ok(!JSON.stringify(spec).includes("x0") && !JSON.stringify(spec).includes("slot"), "the AI gets no coordinates");
  assert.equal(spec.fields.find((x) => x.key === "consent").required, true);
  assert.deepEqual(spec.fields.find((x) => x.key === "kind").options, { general: "一般", family: "家庭" });
  const check = await call(teacher, "POST", `forms/manage/${f.id}/check`, { data: { name: "陳測試" } });
  assert.ok(check.json.missing.length > 3 && check.status === 200, "the teacher can try the map with sample data; nothing is drawn or stored");
});

test("only a TrueType .ttf is a usable font: an OpenType-CFF .otf or a .ttc collection is refused with the reason (poppler cannot open the PDF it would make)", async () => {
  const { writeFileSync } = await import("node:fs");
  for (const [name, head] of [["a.otf", "OTTO"], ["b.ttc", "ttcf"]]) {
    const p = join(dir, name); writeFileSync(p, `${head}\0\0\0\0`);
    process.env.TIGERAI_FORM_FONT = p;
    assert.deepEqual(S.fontStatus(), { ok: false, reason: "not_truetype" }, name);
    await assert.rejects(S.fillForm(P(stu), f.id, GOOD()), (e) => e.code === "no_font" && /TrueType/.test(e.message), name);
  }
  process.env.TIGERAI_FORM_FONT = join(dir, "missing.ttf");
  assert.deepEqual(S.fontStatus(), { ok: false, reason: "missing" });
  assert.equal((await call(teacher, "GET", "forms/manage")).json.fontReady, false, "the settings page is told");
  delete process.env.TIGERAI_FORM_FONT;
});

const fontTest = FONT ? test : test.skip;
fontTest("without a font the fill refuses clearly (validation still works); with one it draws", async () => {
  await assert.rejects(S.fillForm(P(stu), f.id, GOOD()), (e) => e.code === "no_font");
  mkdirSync(join(dir, "data", "forms", "fonts"), { recursive: true });
  process.env.TIGERAI_FORM_FONT = FONT;
  const r = await S.fillForm(P(stu), f.id, GOOD());
  assert.equal(r.status, "filled", JSON.stringify(r));
  assert.deepEqual(r.left_blank, ["簽名(本人親簽)"]);
  assert.match(r.download_url, /^\/api\/tg\/forms\/outputs\/o[0-9a-f]{14}\/download$/);
  f.out = r.output_id;
  const bytes = readFileSync(join(dir, "data", "forms", "out", `${f.out}.pdf`));
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal((statSync(join(dir, "data", "forms", "out", `${f.out}.pdf`)).mode & 0o777).toString(8), "600");
});

fontTest("refused fills write nothing: no PDF file, no output row", async () => {
  const before = readdirSync(join(dir, "data", "forms", "out")).length;
  const rows = getDb().prepare("SELECT COUNT(*) AS n FROM tg_form_outputs").get().n;
  const r = await S.fillForm(P(stu), f.id, { ...GOOD(), age: 25, address: { city: "新北市" } });
  assert.equal(r.status, "refused");
  assert.deepEqual(r.missing.map((m) => m.key).sort(), ["address.district", "address.number"]);
  assert.ok(r.errors.some((x) => /生日算出來是 31 歲/.test(x)));
  assert.equal(readdirSync(join(dir, "data", "forms", "out")).length, before);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM tg_form_outputs").get().n, rows);
  // text that does not fit and a character the font lacks are refusals too, not a squeezed or empty box
  const long = await S.fillForm(P(stu), f.id, { ...GOOD(), address: { city: "新北市", district: "板橋區", number: "8".repeat(40) } });
  assert.equal(long.status, "refused"); assert.match(long.errors.join(""), /放不進欄位/);
  const rare = await S.fillForm(P(stu), f.id, { ...GOOD(), name: "陳\u{20000}測試" });
  assert.equal(rare.status, "refused"); assert.match(rare.errors.join(""), /字型沒有這些字|格式不合/);
});

fontTest("a form of another department is the same 404 as a form that does not exist", async () => {
  await assert.rejects(S.fillForm(P(stu2), f.id, GOOD()), (e) => e.status === 404);
  await assert.rejects(S.fillForm(P(stu), "fnope", GOOD()), (e) => e.status === 404);
});

fontTest("downloads are scoped: the owner, the head of a department the owner belongs to, an administrator; nobody else", async () => {
  const path = `forms/outputs/${f.out}/download`;
  for (const [who, status] of [[stu, 200], [teacher, 200], [admin, 200], [stu2, 404], [teacher2, 404], [outsider, 404]]) {
    assert.equal((await call(who, "GET", path)).status, status, who.name);
  }
  const ok = await call(stu, "GET", path);
  assert.equal(ok.res.headers.get("content-type"), "application/pdf");
  assert.match(ok.res.headers.get("content-disposition"), /attachment; .*filename\*=UTF-8''%E6%B8%AC%E8%A9%A6%E8%A1%A8%E5%96%AE-/);
  assert.equal(ok.res.headers.get("cache-control"), "no-store");
  assert.equal((await call(stu, "GET", "forms/outputs/onope/download")).status, 404);
  assert.deepEqual((await call(stu, "GET", "forms")).json.outputs.map((o) => o.id), [f.out]);
  assert.deepEqual((await call(stu2, "GET", "forms")).json.outputs, [], "someone else's list is empty");
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM audit WHERE action='form.download'").get().n >= 3, true);
});

fontTest("the values the student gave are not kept anywhere except the PDF: not in the database, not in the audit", () => {
  const dump = JSON.stringify([getDb().prepare("SELECT * FROM tg_form_outputs").all(), getDb().prepare("SELECT * FROM audit").all()]);
  for (const secret of ["A123456789", "陳測試", "0212345678", "12345678"]) assert.ok(!dump.includes(secret), `${secret} must not be stored`);
});

fontTest("the AI's tools: list_forms and fill_form work for the owner; a room conversation gets nothing; fill_form relays problems", async () => {
  const sid = "s-forms-1";
  registerOwner(sid, stu.id, join(dir, "data", "workspace", "users", stu.id), "chat", null);
  let tools = {}; let before;
  createFormsExtension().factory({ on: (e, h) => { if (e === "before_agent_start") before = h; }, registerTool: (t) => { tools[t.name] = t; } });
  const ctx = { sessionManager: { getSessionId: () => sid }, cwd: join(dir, "data", "workspace", "users", stu.id) };
  const prompt = before({ systemPrompt: "BASE" }, ctx);
  assert.match(prompt.systemPrompt, /絕對不要自己編造/);
  const listed = JSON.parse((await tools.list_forms.execute("1", {}, undefined, undefined, ctx)).content[0].text);
  assert.equal(listed[0].form_id, f.id);
  const refused = JSON.parse((await tools.fill_form.execute("2", { form_id: f.id, data: { name: "陳測試" } }, undefined, undefined, ctx)).content[0].text);
  assert.equal(refused.status, "refused"); assert.ok(refused.missing.length > 0);
  const filled = JSON.parse((await tools.fill_form.execute("3", { form_id: f.id, data: GOOD() }, undefined, undefined, ctx)).content[0].text);
  assert.equal(filled.status, "filled");
  const sid2 = "s-forms-2";
  registerOwner(sid2, stu2.id, join(dir, "data", "workspace", "users", stu2.id), "chat", null);
  const ctx2 = { sessionManager: { getSessionId: () => sid2 }, cwd: join(dir, "data", "workspace", "users", stu2.id) };
  assert.equal(before({ systemPrompt: "BASE" }, ctx2), undefined, "no form for this person: the prompt is not touched");
  assert.match((await tools.fill_form.execute("4", { form_id: f.id, data: GOOD() }, undefined, undefined, ctx2)).content[0].text, /not_found/);
});

fontTest("fill_form with an empty ask field answers 'ask' and writes nothing; leave_blank (the person said so) lets it through", async () => {
  const r = await call(teacher, "POST", "forms/manage", { name: "有建議欄位", description: "x", group_ids: [g1.id], pdf_base64: await blankPdf(), def: withAsk("tel") });
  assert.equal(r.status, 201);
  const id = r.json.id;
  const noTel = (() => { const g = GOOD(); delete g.tel; return g; })();
  const before = getDb().prepare("SELECT COUNT(*) AS n FROM tg_form_outputs").get().n;
  const asked = await S.fillForm(P(stu), id, noTel);
  assert.equal(asked.status, "ask"); assert.deepEqual(asked.ask.map((a) => a.key), ["tel"]); assert.match(asked.message, /leave_blank/);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM tg_form_outputs").get().n, before, "nothing written");
  const wrong = await S.fillForm(P(stu), id, noTel, ["something_else"]);
  assert.equal(wrong.status, "ask", "declining an unrelated key does not skip it");
  const done = await S.fillForm(P(stu), id, noTel, ["tel"]);
  assert.equal(done.status, "filled");
  assert.equal((await S.fillForm(P(stu), id, GOOD())).status, "filled", "answered: no question");
  // through the AI tool, and the instructions say what to do
  const sid = "s-forms-ask";
  registerOwner(sid, stu.id, join(dir, "data", "workspace", "users", stu.id), "chat", null);
  let tools = {}; let before2;
  createFormsExtension().factory({ on: (e, h) => { if (e === "before_agent_start") before2 = h; }, registerTool: (t) => { tools[t.name] = t; } });
  const ctx = { sessionManager: { getSessionId: () => sid }, cwd: join(dir, "data", "workspace", "users", stu.id) };
  assert.match(before2({ systemPrompt: "B" }, ctx).systemPrompt, /ask 時/);
  const viaTool = JSON.parse((await tools.fill_form.execute("1", { form_id: id, data: noTel }, undefined, undefined, ctx)).content[0].text);
  assert.equal(viaTool.status, "ask");
  const listed = JSON.parse((await tools.list_forms.execute("2", {}, undefined, undefined, ctx)).content[0].text);
  assert.equal(listed.find((x) => x.form_id === id).fields.find((x) => x.key === "tel").ask, true);
  const viaTool2 = JSON.parse((await tools.fill_form.execute("3", { form_id: id, data: noTel, leave_blank: ["tel"] }, undefined, undefined, ctx)).content[0].text);
  assert.equal(viaTool2.status, "filled");
  assert.equal((await call(teacher, "DELETE", `forms/manage/${id}`)).status, 200, "tidy up: the later tests expect only the first form");
});

fontTest("filled PDFs past the retention are removed; disabled forms disappear for students; delete removes the package", async () => {
  getDb().prepare("UPDATE tg_form_outputs SET created_at=? WHERE id=?").run(Date.now() - 40 * 86_400_000, f.out);
  assert.equal(S.purgeOutputs() >= 1, true);
  assert.equal(existsSync(join(dir, "data", "forms", "out", `${f.out}.pdf`)), false);
  assert.equal((await call(stu, "GET", `forms/outputs/${f.out}/download`)).status, 404);
  assert.equal((await call(teacher, "PATCH", `forms/manage/${f.id}`, { enabled: false })).status, 200);
  assert.deepEqual((await call(stu, "GET", "forms")).json.forms, []);
  assert.equal((await call(teacher, "DELETE", `forms/manage/${f.id}`)).status, 200);
  assert.equal(existsSync(join(dir, "data", "forms", f.id)), false);
});

test("a font up to WHOLE_FONT_MAX is embedded whole (fontkit's subsetter drops glyphs from Google's CJK fonts)", async () => {
  const R = await import("../forms/render.ts");
  assert.equal(R.WHOLE_FONT_MAX, 8 * 1024 * 1024);
  assert.ok(readFileSync(join(process.cwd(), "tigerai/forms/render.ts"), "utf8").includes("subset: fontBytes.length > WHOLE_FONT_MAX"));
});

// ---- 1.1.2-ce item 10: `ask` = recommended, not required: the AI must ask before leaving it blank
const withAsk = (key) => { const d = JSON.parse(JSON.stringify(DEF)); d.fields.find((x) => x.key === key).ask = true; return d; };
test("ask fields: listed to ask about, never 'missing'; answered clears it; the definition check refuses a bad flag", () => {
  const askDef = withAsk("tel");
  const noTel = (() => { const g = GOOD(); delete g.tel; return g; })();
  const p = V.validate(askDef, noTel, TODAY);
  assert.deepEqual(p.missing.map((m) => m.key), [], "not required: never 'missing'");
  assert.deepEqual(p.ask.map((a) => a.key), ["tel"], "but listed to ask about");
  assert.deepEqual(V.validate(askDef, GOOD(), TODAY).ask, [], "answered");
  assert.deepEqual(V.validate(DEF, noTel, TODAY).ask, [], "a form without ask fields is unchanged");
  const sizes = [{ width: 400, height: 300 }, { width: 400, height: 300 }];
  const bad = JSON.parse(JSON.stringify(DEF)); bad.fields[0].ask = "yes";
  assert.equal(V.checkDef(bad, sizes).ok, false);
  const reqAsk = JSON.parse(JSON.stringify(DEF)); reqAsk.fields.find((x) => x.required).ask = true;
  assert.equal(V.checkDef(reqAsk, sizes).ok, false, "required + ask makes no sense");
  assert.equal(V.checkDef(askDef, sizes).ok, true);
});
