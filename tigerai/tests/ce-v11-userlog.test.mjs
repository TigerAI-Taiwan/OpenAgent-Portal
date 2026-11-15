// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: one 使用者紀錄 page (no 到勤與使用): time online, CSV. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-userlog.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-ul-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_TZ = "Asia/Taipei";
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const ul = await import("../userlog/service.ts");
const { stayZh } = await import("../userlog/format.ts");
const { getDb } = await import("../db/store.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("a@x.example", "老師", "admin");
const amy = mk("amy@x.example", "B119-資工二-陳小明");
const g = acc.createGroup(admin.id, { name: "資工二" }); acc.setMembership(admin.id, g.id, amy.id, true);
const deps = { catalog: async () => new Map(), messages: async () => null };
const now = Date.parse("2026-11-12T15:00:00+08:00"); // a Thursday
const at = (iso) => Date.parse(`${iso}+08:00`);
const mark = (iso) => getDb().prepare("INSERT OR IGNORE INTO activity_log (user_id, ts) VALUES (?,?)").run(amy.id, at(iso));
// Monday: one stretch 09:00-09:05 (6 marks: 5 min + the first minute = 6), Thursday: 10:00-10:03 then a 30-minute gap, 10:33-10:34
for (const m of ["09:00", "09:01", "09:02", "09:03", "09:04", "09:05"]) mark(`2026-11-09T${m}:00`);
for (const m of ["10:00", "10:01", "10:02", "10:03", "10:33", "10:34"]) mark(`2026-11-12T${m}:00`);
mark("2026-11-08T23:00:00"); // last Sunday: not this week

test("stay time: gaps over 10 minutes are not counted; today and this week (Monday start) are separate", async () => {
  const row = (await ul.listMembers({ id: admin.id, role: "admin" }, deps, now)).find((r) => r.id === amy.id);
  assert.equal(row.stayTodayMs / 60_000, 6, "10:00-10:03 (4 min) + 10:33-10:34 (2 min); the 30-minute gap between them is not counted");
  assert.equal(row.stayWeekMs / 60_000, 12, "plus Monday's 09:00-09:05 (6 min); last Sunday is not this week");
  assert.equal(stayZh(6 * 60_000), "6 分"); assert.equal(stayZh(75 * 60_000), "1 小時 15 分"); assert.equal(stayZh(120 * 60_000), "2 小時");
});

test("the CSV is the same table: UTF-8 BOM, the same columns, formula-safe, same people, audited", async () => {
  getDb().prepare("UPDATE users SET name=? WHERE id=?").run("=cmd|evil", acc.createUser(null, { email: "z@x.example", name: "tmp", password: PW }).user.id);
  const { csv, filename } = await ul.exportCsv({ id: admin.id, role: "admin" }, deps, now);
  assert.ok(csv.startsWith("\uFEFF姓名,班級/部門,最後上線,今天停留(分),本週停留(分),對話數,最近對話\r\n"));
  assert.match(csv, /B119-資工二-陳小明,資工二,,6,12,0,/);
  assert.ok(!/(^|\n)=cmd/.test(csv) && csv.includes("'=cmd|evil"), "a name cannot run as a formula");
  assert.match(filename, /^userlog-2026-11-12\.csv$/);
  assert.ok(getDb().prepare("SELECT 1 FROM audit WHERE action='userlog.export'").get());
});

test("a member cannot export; over HTTP the file is text/csv with a download name", async () => {
  const call = async (u, path) => handle(new Request(`http://x/api/tg/${path}`, { headers: { "x-tg-uid": u.id } }), path.split("/"));
  assert.equal((await call(amy, "userlog/export")).status, 403);
  const ok = await call(admin, "userlog/export");
  assert.equal(ok.status, 200); assert.match(ok.headers.get("content-type"), /text\/csv/); assert.match(ok.headers.get("content-disposition"), /attachment; filename="userlog-/);
});

test("到勤與使用 is gone: no tab, no route, no module, no class time slots", async () => {
  const root = new URL("../", import.meta.url);
  assert.equal(existsSync(new URL("usagereport", root)), false); assert.equal(existsSync(new URL("api/usage.ts", root)), false);
  const { SETTINGS_TABS } = await import("../ui/layout.ts");
  assert.ok(!SETTINGS_TABS.some((t) => t.id === "usage"));
  const call = async (u, path) => handle(new Request(`http://x/api/tg/${path}`, { method: "POST", headers: { "x-tg-uid": u.id, "content-type": "application/json" }, body: "{}" }), path.split("/"));
  assert.equal((await call(admin, "usage/csv")).status, 404);
});
