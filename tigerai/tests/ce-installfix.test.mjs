// Install/first-run fixes: single-label email, doubled 。, readable skill names.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-installfix.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-instfix-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");

const { EMAIL } = await import("../accounts/email.ts");
const acc = await import("../accounts/service.ts");
const { stripEnd, collapseStops } = await import("../wizards/format.ts");
const { skillSlug } = await import("../wizards/skill-writer.ts");

test("email: adm@local is a valid first administrator, garbage is not", () => {
  for (const ok of ["adm@local", "a@example.com", "li.wang@example.com", "x@intranet"]) assert.ok(EMAIL.test(ok), ok);
  for (const bad of ["", "adm", "adm@", "@local", "a b@local", "a@@local", "a@lo cal", "a@.local", "a@local.", "a@lo\u002e\u002ecal"]) assert.ok(!EMAIL.test(bad), bad);
});

test("bootstrap creates adm@local and forces a password change when asked", () => {
  process.env.TIGERAI_ADMIN_EMAIL = "adm@local";
  process.env.TIGERAI_ADMIN_PASSWORD = "A-long-first-password-1";
  process.env.TIGERAI_ADMIN_MUST_CHANGE = "1";
  acc.bootstrapAdmin();
  const u = acc.listUsers().find((x) => x.email === "adm@local");
  assert.ok(u);
  assert.equal(u.role, "admin");
  assert.equal(u.must_change_pw, 1);
});

test("a template 。 after text that already ends with one does not double", () => {
  assert.equal(`${stripEnd("會議待辦:寄報價單。")}。後面`, "會議待辦:寄報價單。後面");
  assert.equal(collapseStops("你說了。。還有。"), "你說了。還有。");
  assert.equal(collapseStops("正常。"), "正常。");
});

test("skill slug: ASCII words from the suggestion when there are any, stable hash otherwise", () => {
  assert.equal(skillSlug("Monthly Close Check"), "monthly-close-check");
  const s = skillSlug("月結檢查流程", "每月用 ERP 月結", "先對帳");
  assert.match(s, /^erp-[0-9a-f]{4}$/);
  assert.equal(s, skillSlug("月結檢查流程", "每月用 ERP 月結", "先對帳"));
  assert.match(skillSlug("月結檢查流程", "每月", "先對帳"), /^skill-[0-9a-f]{8}$/);
});
