// 1.1.2-ce items 8 + 9: neutral registration wording; display names may contain spaces everywhere (sign-up, 設定, org import).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "tg-112-names-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const acc = await import("../accounts/service.ts");
const reg = await import("../register/service.ts");
const prof = await import("../accounts/profile.ts");
const imp = await import("../org/import.ts");
const admin = acc.createUser(null, { email: "a@example.com", name: "Admin", role: "admin", password: "Test-Pass-12345!", mustChange: false }).user;
const g = acc.createGroup(admin.id, { name: "業務部" });

test("a display name with spaces works: admin-created, self-registered, renamed in 設定", () => {
  const u = acc.createUser(admin.id, { email: "wang@example.com", name: "王董 David", role: "member", password: "Test-Pass-12345!", mustChange: false }).user;
  assert.equal(u.name, "王董 David");
  reg.setRegistration(admin.id, { open: true });
  const code = reg.setPhrase({ id: admin.id, role: "admin" }, g.id, "業務部 2026 秋季").code;
  reg.registerStudent({ name: "Amy Lin 林", email: "amy@example.com", password: "Student-Pass-1", code });
  assert.equal(acc.listUsers().find((x) => x.email === "amy@example.com").name, "Amy Lin 林");
  assert.equal(prof.updateOwnProfile(u.id, { name: "王董  David Wang" }).name, "王董  David Wang".trim());
  assert.throws(() => prof.updateOwnProfile(u.id, { name: "a@b" }), (e) => e.code === "bad_name", "@ stays refused: it is the mention marker");
});
test("the org import accepts spaces too (collapsed to one), and still refuses @, empty, AI and control characters", () => {
  assert.equal(imp.cleanName("王董 David"), "王董 David");
  assert.equal(imp.cleanName("  Amy   Lin "), "Amy Lin");
  for (const bad of ["", "   ", "a@b", "AI", "x\u0000y", "x".repeat(81)]) assert.throws(() => imp.cleanName(bad), (e) => e.code === "bad_name", JSON.stringify(bad));
});
test("the registration page wording is neutral: no school-only phrases in the form labels or intro", () => {
  const files = ["../pages/i18n-school.ts", "../pages/i18n-v11.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  const pick = (k) => [...files.matchAll(new RegExp(`\\b${k}: "((?:[^"\\\\]|\\\\.)*)"`, "g"))].map((m) => m[1]);
  for (const k of ["regName", "regNameV", "regNameHint", "regIntro", "regCode", "regCodeOptional", "regCodeHint"]) assert.ok(pick(k).length >= 2, `${k} in both languages`);
  for (const t of [...pick("regName"), ...pick("regNameV")]) assert.doesNotMatch(t, /學號-班級-姓名|student ID-class-name/, `label ${t}`);
  for (const t of pick("regCode")) assert.match(t, /學校|school/i), assert.match(t, /公司|company/i);
  for (const t of pick("regIntro")) assert.match(t, /學校.*公司|school.*company/is);
  for (const t of pick("regIntro")) assert.doesNotMatch(t, /^[^]*\(course and class\)/);
});
