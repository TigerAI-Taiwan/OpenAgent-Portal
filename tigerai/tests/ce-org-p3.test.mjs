// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// org.xlsx: three sheets, empty = unchanged, "-" = clear, units replaced as a whole, hire / leave, preview + digest, all or nothing.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-org-p3.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "tg-orgp3-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const { writeXlsx } = await import("../org/xlsx-write.ts");
const { runOrg } = await import("../org/import.ts");
const { exportOrg } = await import("../org/export.ts");
const { readXlsx } = await import("../org/xlsx.ts");
const { buildXlsx } = await import("../tools/xlsx-writer.mjs");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const admin2 = mk("admin2@example.com", "Admin2", "admin");
const outsider = mk("outsider@example.com", "Outsider"); // never in a file
const outG = acc.createGroup(admin.id, { name: "NotInFile" });
acc.setMembership(admin.id, outG.id, outsider.id, true, true);

const UH = ["name", "parent", "description", "managers", "confirmers"];
const MH = ["action", "email", "employeeId", "name", "role", "status", "units"];
const file = (units, members) => writeXlsx([{ name: "units", rows: [UH, ...units] }, { name: "members", rows: [MH, ...members] }]);
async function call(user, method, path, body, raw) {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  const req = new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": raw ? "application/octet-stream" : "application/json" }, ...(raw ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await handle(req, segs);
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, json: ct.includes("json") ? await res.json() : null, buf: ct.includes("json") ? null : Buffer.from(await res.arrayBuffer()) };
}
const counts = () => ({ users: getDb().prepare("SELECT COUNT(*) AS n FROM users").get().n, groups: getDb().prepare("SELECT COUNT(*) AS n FROM groups").get().n, mem: getDb().prepare("SELECT COUNT(*) AS n FROM memberships").get().n, audit: getDb().prepare("SELECT COUNT(*) AS n FROM audit").get().n });
const unitsOf = (email) => getDb().prepare("SELECT g.name FROM memberships m JOIN groups g ON g.id=m.group_id JOIN users u ON u.id=m.user_id WHERE u.email=? ORDER BY g.name").all(email).map((r) => r.name);
const user = (email) => getDb().prepare("SELECT * FROM users WHERE email=?").get(email);
const preview = async (buf) => (await call(admin, "POST", "admin/org/preview", undefined, buf));
const apply = async (buf, digest) => call(admin, "POST", `admin/org/apply${digest === undefined ? "" : `?digest=${digest}`}`, undefined, buf);

test("preview writes nothing; apply needs the digest; a good file creates the tree, the people and the heads", async () => {
  const f = await file(
    [["營運處", "", "總部", "", ""], ["財務部", "營運處", "", "boss@example.com", ""], ["生產部", "營運處", "", "", ""]],
    [["hire", "boss@example.com", "E001", "Boss", "member", "", "財務部"], ["hire", "wang@example.com", "00123", "Wang", "", "", "財務部"], ["hire", "lin@example.com", "", "Lin", "", "", "生產部;財務部"]],
  );
  const before = counts();
  const p = await preview(f);
  assert.equal(p.status, 200); assert.deepEqual(p.json.errors, []);
  assert.deepEqual(p.json.summary, { unitsCreate: 3, unitsUpdate: 0, hire: 3, rejoin: 0, update: 0, leave: 0, unchanged: 0 });
  assert.deepEqual(counts(), before, "a preview changes nothing, not even an audit row");
  assert.equal(p.json.changes.length, 6);
  assert.equal((await apply(f)).status, 400, "no digest: refused");
  assert.equal((await apply(f, "deadbeef")).status, 409, "a digest that does not match: refused, nothing written");
  assert.deepEqual(counts(), before);
  const a = await apply(f, p.json.digest);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.match(a.json.initialPasswordsCsv, /boss@example.com,Boss,.+\n/);
  assert.deepEqual(unitsOf("lin@example.com"), ["生產部", "財務部"], "兼屬多單位, no main unit");
  assert.equal(user("wang@example.com").employee_id, "00123", "leading zeros survive");
  assert.equal(getDb().prepare("SELECT m.is_manager FROM memberships m JOIN users u ON u.id=m.user_id JOIN groups g ON g.id=m.group_id WHERE u.email='boss@example.com' AND g.name='財務部'").get().is_manager, 1);
  assert.equal(getDb().prepare("SELECT p.name FROM groups g JOIN groups p ON p.id=g.parent_id WHERE g.name='財務部'").get().name, "營運處");
  assert.equal(user("wang@example.com").must_change_pw, 1);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM audit WHERE action='org.import'").get().n, 1);
  assert.ok(getDb().prepare("SELECT COUNT(*) AS n FROM audit WHERE action='org.import_item'").get().n >= 6);
  assert.equal(JSON.stringify(getDb().prepare("SELECT extra FROM audit").all()).includes(a.json.initialPasswordsCsv.split("\n")[1].split(",")[2]), false, "no password in the audit");
  // the same file again: nothing to do (hire on an active person is a warning)
  const again = await preview(f);
  assert.deepEqual(again.json.errors, []); assert.equal(again.json.changes.length, 0);
  assert.equal(again.json.warnings.filter((w) => w.code === "already_active").length, 3);
});

test("empty = unchanged, '-' = clear, units replaced as a whole (換部門), rows not in the file untouched", async () => {
  const f = await file(
    [["財務部", "", "-", "", ""]],           // parent empty: unchanged; description "-": clear
    [["", "wang@example.com", "-", "", "", "", "生產部"],      // employeeId cleared; units replaced: 財務部 -> 生產部
     ["", "lin@example.com", "", "", "", "", ""]],             // nothing: unchanged
  );
  const p = await preview(f);
  assert.deepEqual(p.json.errors, []);
  const a = await apply(f, p.json.digest);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(user("wang@example.com").employee_id, null);
  assert.deepEqual(unitsOf("wang@example.com"), ["生產部"]);
  assert.deepEqual(unitsOf("lin@example.com"), ["生產部", "財務部"], "empty units cell: untouched");
  assert.equal(getDb().prepare("SELECT p.name FROM groups g JOIN groups p ON p.id=g.parent_id WHERE g.name='財務部'").get().name, "營運處", "empty parent: unchanged");
  assert.deepEqual(unitsOf("outsider@example.com"), ["NotInFile"], "people and units outside the file are not touched");
  assert.equal(user("admin2@example.com").status, "active");
  // '-' on units clears them all
  const clear = await file([], [["", "lin@example.com", "", "", "", "", "-"]]);
  const pc = await preview(clear);
  assert.equal((await apply(clear, pc.json.digest)).status, 200);
  assert.deepEqual(unitsOf("lin@example.com"), []);
});

test("leave: account disabled, unit links stay, the leaver's channels go to the administrator with a warning", async () => {
  const wang = user("wang@example.com");
  getDb().prepare("INSERT INTO rooms (id,name,owner_id,created_at) VALUES ('rw1','王的頻道',?,?)").run(wang.id, Date.now());
  getDb().prepare("INSERT INTO room_members (room_id,user_id,added_by,added_at) VALUES ('rw1',?,?,?)").run(wang.id, wang.id, Date.now());
  const kd = join(process.env.TIGERAI_DATA_DIR, "personal-models", wang.id); mkdirSync(kd, { recursive: true });
  writeFileSync(join(kd, "connections.json"), JSON.stringify({ connections: [{ id: "c1", name: "n", baseUrl: "http://x/v1", models: ["m"], enabled: true }] })); writeFileSync(join(kd, "key-c1"), "K");
  const f = await file([], [["leave", "wang@example.com", "", "", "", "", ""]]);
  const p = await preview(f);
  assert.deepEqual(p.json.errors, []);
  assert.ok(p.json.warnings.some((w) => w.code === "leave_owns"));
  assert.equal(JSON.parse(readFileSync(join(kd, "connections.json"), "utf8")).connections[0].enabled, true, "a preview touches no key file");
  assert.equal(user("wang@example.com").status, "active");
  const a = await apply(f, p.json.digest);
  assert.equal(a.status, 200);
  assert.equal(user("wang@example.com").status, "disabled");
  assert.deepEqual(unitsOf("wang@example.com"), ["生產部"], "unit links stay");
  assert.equal(getDb().prepare("SELECT owner_id FROM rooms WHERE id='rw1'").get().owner_id, admin.id, "nobody decided: the administrator, audited");
  assert.equal(JSON.parse(readFileSync(join(kd, "connections.json"), "utf8")).connections[0].enabled, false, "keys off at once");
  assert.equal((await preview(f)).json.warnings.some((w) => w.code === "already_left"), true, "repeating changes nothing");
  // hire brings him back, keys and all
  const back = await file([], [["hire", "wang@example.com", "", "", "", "", ""]]);
  const pb = await preview(back);
  assert.equal(pb.json.summary.rejoin, 1);
  assert.equal((await apply(back, pb.json.digest)).status, 200);
  assert.equal(user("wang@example.com").status, "active");
  assert.equal(JSON.parse(readFileSync(join(kd, "connections.json"), "utf8")).connections[0].enabled, true);
  assert.deepEqual(unitsOf("wang@example.com"), ["生產部"]);
  // a leaver still named head of a unit: warned (it is allowed to stay)
  const lf = await file([["生產部", "", "", "lin@example.com", ""]], [["hire", "lin@example.com", "", "", "", "", "生產部"]]);
  assert.equal((await apply(lf, (await preview(lf)).json.digest)).status, 200);
  const lv = await file([], [["leave", "lin@example.com", "", "", "", "", ""]]);
  assert.equal((await apply(lv, (await preview(lv)).json.digest)).status, 200);
  assert.ok((await preview(await file([["生產部", "", "x", "", ""]], []))).json.warnings.some((w) => w.code === "leaver_still_listed"));
});

test("errors: every bad row is listed with sheet, row and column; one bad row stops the whole file", async () => {
  const cases = {
    "an unknown column": [UH.concat(["bogus"]), [["X1", "", "", "", "", ""]], MH, []],
    "a loop of parents": [UH, [["A1", "B1", "", "", ""], ["B1", "A1", "", "", ""]], MH, []],
    "an unknown parent": [UH, [["C1", "Nowhere", "", "", ""]], MH, []],
    "an unknown unit": [UH, [], MH, [["hire", "x1@example.com", "", "X1", "", "", "Missing"]]],
    "a bad action": [UH, [], MH, [["fire", "x2@example.com", "", "X2", "", "", ""]]],
    "formula-looking text": [UH, [], MH, [["hire", "x3@example.com", "", "=HYPERLINK(1)", "", "", ""]]],
    "no account without hire": [UH, [], MH, [["", "ghost@example.com", "", "", "", "", ""]]],
    "a duplicate email": [UH, [], MH, [["hire", "x4@example.com", "", "X4", "", "", ""], ["hire", "x4@example.com", "", "X4b", "", "", ""]]],
    "a duplicate employee number": [UH, [], MH, [["hire", "x5@example.com", "E9", "X5", "", "", ""], ["hire", "x6@example.com", "E9", "X6", "", "", ""]]],
    "an employee number already used": [UH, [], MH, [["hire", "x7@example.com", "E001", "X7", "", "", ""]]],
    "a name with an @ (spaces are allowed since 1.1.2-ce)": [UH, [], MH, [["hire", "x8@example.com", "", "Mr@X", "", "", ""]]],
    "a bad role": [UH, [], MH, [["hire", "x9@example.com", "", "X9", "boss", "", ""]]],
    "the administrator leaving themself": [UH, [], MH, [["leave", "admin@example.com", "", "", "", "", ""]]],
    "a head who has no account": [UH, [["生產部", "", "", "nobody@example.com", ""]], MH, []],
  };
  for (const [label, [uh, urows, mh, mrows]] of Object.entries(cases)) {
    const f = await writeXlsx([{ name: "units", rows: [uh, ...urows] }, { name: "members", rows: [mh, ...mrows] }]);
    const before = counts();
    const p = await preview(f);
    assert.ok(p.json.errors.length > 0, `${label}: expected an error`);
    assert.ok(p.json.errors.every((e) => e.sheet && typeof e.row === "number" && e.col), `${label}: errors carry sheet, row and column`);
    const a = await apply(f, p.json.digest || "x");
    assert.ok([409, 422].includes(a.status), `${label}: apply refused (${a.status})`);
    assert.deepEqual(counts(), before, `${label}: nothing written`);
  }
  // one good row plus one bad row: the good one is not applied either
  const mixed = await file([["好單位", "", "", "", ""]], [["hire", "good@example.com", "", "Good", "", "", "好單位"], ["fire", "bad@example.com", "", "Bad", "", "", ""]]);
  const before = counts();
  assert.equal((await apply(mixed, "x")).status, 422);
  assert.deepEqual(counts(), before); assert.equal(user("good@example.com"), undefined);
  // the last administrator cannot be demoted or made to leave through a file
  const demote = await file([], [["", "admin2@example.com", "", "", "member", "", ""], ["", "admin@example.com", "", "", "member", "", ""]]);
  const pd = await preview(demote);
  assert.ok(pd.json.errors.length >= 1);
  // formulas in a cell, a csv, a huge file
  const withFormula = await buildXlsx([{ name: "units", rows: [["name"], ["J1"]], formulaCell: true }, { name: "members", rows: [["email"]] }]);
  assert.ok((await preview(withFormula)).json.errors[0].message.includes("formulas"));
  assert.ok((await preview(Buffer.from("name,email\nx,y\n"))).json.errors.length > 0);
  assert.ok((await preview(Buffer.concat([Buffer.from("PK"), Buffer.alloc(3 * 1024 * 1024)]))).json.errors.length > 0, "over 2 MB: refused");
});

test("a preview goes stale when the data changes before apply; members cannot use any of it", async () => {
  const f = await file([["新單位", "", "", "", ""]], [["hire", "stale@example.com", "", "Stale", "", "", "新單位"]]);
  const p = await preview(f);
  acc.createGroup(admin.id, { name: "新單位" }); // somebody made the unit meanwhile: the plan is different now
  const a = await apply(f, p.json.digest);
  assert.equal(a.status, 409); assert.equal(a.json.code, "stale_preview");
  assert.equal(user("stale@example.com"), undefined);
  const fresh = await preview(f);
  assert.equal((await apply(f, fresh.json.digest)).status, 200);
  const m = user("outsider@example.com");
  for (const path of ["admin/org/preview", "admin/org/apply?digest=x"]) assert.equal((await call(m, "POST", path, undefined, f)).status, 403);
  assert.equal((await call(m, "GET", "admin/org/export")).status, 403);
});

test("export: a workbook with three sheets and drop-downs; exporting then importing changes nothing", async () => {
  const r = await call(admin, "GET", "admin/org/export");
  assert.equal(r.status, 200); assert.equal(r.buf.subarray(0, 2).toString(), "PK");
  const sheets = await readXlsx(r.buf);
  assert.deepEqual(sheets.map((s) => s.name), ["units", "members", "lists"]);
  assert.deepEqual(Object.values(sheets[0].rows[0].cells), ["name", "parent", "description", "managers", "confirmers"]);
  assert.deepEqual(Object.values(sheets[1].rows[0].cells), ["action", "email", "employeeId", "name", "role", "status", "units"]);
  const JSZip = (await import("jszip")).default;
  const z = await JSZip.loadAsync(r.buf);
  const mx = await z.file("xl/worksheets/sheet2.xml").async("string");
  assert.match(mx, /<dataValidation type="list"[^>]*sqref="A2:A5000"/); assert.match(mx, /lists!\$A\$2:\$A\$3/); assert.match(mx, /lists!\$B\$2:\$B\$3/);
  assert.match(await z.file("xl/worksheets/sheet1.xml").async("string"), /units!\$A\$2:\$A\$500/);
  const p = await preview(r.buf);
  assert.deepEqual(p.json.errors, [], JSON.stringify(p.json.errors));
  assert.equal(p.json.changes.length, 0, "round trip: zero difference");
  assert.ok(sheets[1].rows.some((row) => Object.values(row.cells).includes("00123") || Object.values(row.cells).includes("E001")));
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM audit WHERE action='org.export'").get().n >= 1, true);
  void exportOrg; void runOrg; void existsSync;
});
