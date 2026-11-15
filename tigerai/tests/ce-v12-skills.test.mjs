// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.2-ce: 新增技能 (own skills from scratch), 送審, and the administrator's sharing.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v12-sk-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const acc = await import("../accounts/service.ts");
const { handle } = await import("../api/router.ts");
const M = await import("../skills/mine.ts");
const B = await import("../skills/builtin.ts");
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: "Test-Pass-12345!", mustChange: false }).user;
const admin = mk("a@example.com", "Admin", "admin");
const amy = mk("amy@example.com", "Amy");
const ben = mk("ben@example.com", "Ben");
const call = async (u, method, path, body) => {
  const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": u.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/"));
  return { status: res.status, json: await res.json().catch(() => null) };
};
const DRAFT = { title: "出貨前檢查", description: "出貨前核對單據時使用", steps: "1. 先列出單據\n2. 逐項核對\n3. 有疑問就問我" };

test("a member writes a skill from scratch, edits it, and only they can read or delete it", async () => {
  const c = await call(amy, "POST", "skills/mine", DRAFT);
  assert.equal(c.status, 201); assert.match(c.json.name, /^my-skill-[0-9a-f]{6}$/);
  const text = readFileSync(join(B.mySkillsDir(amy.id), c.json.name, "SKILL.md"), "utf8");
  assert.match(text, /^---\nname: my-skill-/); assert.match(text, /title: "出貨前檢查"/); assert.ok(text.includes("2. 逐項核對"));
  const list = (await call(amy, "GET", "skills")).json.skills.find((s) => s.name === c.json.name);
  assert.ok(list && list.builtin === false && list.title === "出貨前檢查");
  assert.equal((await call(ben, "GET", "skills")).json.skills.some((s) => s.name === c.json.name), false);
  assert.equal((await call(ben, "GET", `skills/mine/${c.json.name}`)).status, 404, "Ben cannot read Amy's");
  assert.equal((await call(ben, "PUT", `skills/mine/${c.json.name}`, DRAFT)).status, 404);
  assert.equal((await call(ben, "DELETE", `skills/mine/${c.json.name}`)).status, 404);
  assert.equal((await call(amy, "PUT", `skills/mine/${c.json.name}`, { ...DRAFT, steps: "1. 改過" })).status, 200);
  assert.equal((await call(amy, "GET", `skills/mine/${c.json.name}`)).json.skill.steps, "1. 改過");
  assert.equal((await call(amy, "DELETE", `skills/mine/${c.json.name}`)).status, 200);
  assert.equal(existsSync(join(B.mySkillsDir(amy.id), c.json.name)), false);
});

test("bad input and path tricks are refused; an English title becomes a readable folder name; a built-in name is never taken", async () => {
  for (const bad of [{ ...DRAFT, title: "" }, { ...DRAFT, description: "" }, { ...DRAFT, steps: "" }, { ...DRAFT, steps: "x".repeat(20_001) }]) assert.equal((await call(amy, "POST", "skills/mine", bad)).status, 400);
  const en = await call(amy, "POST", "skills/mine", { ...DRAFT, title: "Fill Form" });
  assert.equal(en.json.name, "my-fill-form");
  assert.equal((await call(amy, "POST", "skills/mine", { ...DRAFT, title: "Fill Form" })).json.name, "my-fill-form-2");
  for (const n of ["fill-form", "..%2F..%2Fx", "my-..%2Fx"]) assert.equal((await call(amy, "GET", `skills/mine/${n}`)).status, 404);
});

test("送審 then the administrator shares to the company or one unit; members cannot share; nothing is overwritten; edits pull it back from the queue", async () => {
  const c = (await call(amy, "POST", "skills/mine", { ...DRAFT, title: "Shipping check" })).json.name;
  assert.equal((await call(amy, "GET", "admin/skills/submitted")).status, 403);
  assert.equal((await call(amy, "POST", "admin/skills/share", { userId: amy.id, name: c, scope: "company" })).status, 403);
  assert.equal((await call(amy, "POST", `skills/mine/${c}/submit`, {})).status, 200);
  const q = (await call(admin, "GET", "admin/skills/submitted")).json;
  assert.equal(q.skills.length, 1); assert.ok(q.skills[0].steps.includes("逐項核對"), "the administrator reads the whole text");
  await call(amy, "PUT", `skills/mine/${c}`, DRAFT);
  assert.equal((await call(admin, "GET", "admin/skills/submitted")).json.skills.length, 0, "an edited skill must be submitted again");
  await call(amy, "POST", `skills/mine/${c}/submit`, {});
  const sh = await call(admin, "POST", "admin/skills/share", { userId: amy.id, name: c, scope: "company" });
  assert.equal(sh.status, 200); assert.equal(sh.json.name, "shipping-check");
  assert.ok(existsSync(join(process.env.PI_CODING_AGENT_DIR, "skills", "shipping-check", "SKILL.md")));
  assert.equal((await call(admin, "GET", "admin/skills/submitted")).json.skills.length, 0);
  assert.equal(M.shareSkill(admin.id, { userId: amy.id, name: c, scope: "company" }).name, "shipping-check-2", "never overwrites");
  // a unit
  const g = acc.createGroup(admin.id, { name: "生管" });
  acc.setMembership(admin.id, g.id, ben.id, true);
  assert.equal((await call(admin, "POST", "admin/skills/share", { userId: amy.id, name: c, scope: "unit", unitId: "nope" })).status, 400);
  const u = await call(admin, "POST", "admin/skills/share", { userId: amy.id, name: c, scope: "unit", unitId: g.id });
  assert.equal(u.status, 200);
  const benSees = (await call(ben, "GET", "skills")).json.skills.some((s) => s.name === u.json.name);
  assert.equal(benSees, true, "a member of the unit sees it");
  assert.equal(M.unitSkills(amy.id).length, 0, "someone outside the unit does not");
  assert.equal(M.unitSkills(ben.id).length, 1);
});

test("a shared or own skill grants no permission: it is plain text with no tool or rights field", () => {
  const t = readFileSync(join(process.env.PI_CODING_AGENT_DIR, "skills", "shipping-check", "SKILL.md"), "utf8");
  assert.ok(!/allowed-tools|permissions|role:/.test(t));
});
