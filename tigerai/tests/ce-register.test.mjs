// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 自行註冊 + 核准: switch off refuses, passphrase scoping, 待核准 cannot sign in, notifications, approval scope, auto-approve switch, no escalation, rate limit, audit.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-register.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-register-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_REGISTER_PER_HOUR = "5";
const acc = await import("../accounts/service.ts");
const reg = await import("../register/service.ts");
const { handle } = await import("../api/router.ts");
const { listAudit } = await import("../accounts/audit.ts");
const { gate } = await import("../adapter/gate.ts");
const { NextRequest } = await import("next/server");
const ses = await import("../accounts/session.ts");

const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: "Test-Pass-12345!", mustChange: false }).user;
const admin = mk("a@example.com", "Admin", "admin");
const head = mk("h@example.com", "Teacher");
const head2 = mk("h2@example.com", "Teacher2");
const plain = mk("p@example.com", "Plain");
const classA = acc.createGroup(admin.id, { name: "ClassA" });
const classB = acc.createGroup(admin.id, { name: "ClassB" });
acc.setMembership(admin.id, classA.id, head.id, true, true);
acc.setMembership(admin.id, classB.id, head2.id, true, true);
const A = { id: admin.id, role: "admin" }, H = { id: head.id, role: "member" }, P = { id: plain.id, role: "member" };

const post = (path, data, uid) => handle(new Request(`http://x/api/tg/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(uid ? { "x-tg-uid": uid } : {}) }, body: JSON.stringify(data) }), path.split("/"));
const getR = (path) => handle(new Request(`http://x/api/tg/${path}`), path.split("/"));
const form = (n, code) => ({ name: n, email: `${n}@example.com`, password: "Student-Pass-1", code });

test("the switch is off by default: the API answers 404 and nothing is created", async () => {
  assert.equal(reg.registrationOpen(), false);
  const code = reg.rotateCode(H, classA.id).code;
  const res = await post("register", form("stu1", code));
  assert.equal(res.status, 404);
  assert.equal(acc.listUsers().some((u) => u.email === "stu1@example.com"), false);
  const st = await (await getR("register/status")).json();
  assert.equal(st.open, false);
});

test("the gate answers 404 for the register page and API while the switch is off, and lets them through when on", async () => {
  for (const p of ["/tg/register", "/api/tg/register"]) assert.equal((await gate(new NextRequest(`http://x${p}`, { method: p.startsWith("/api") ? "POST" : "GET" }), false)).status, 404, p);
  reg.setRegistration(admin.id, { open: true });
  for (const p of ["/tg/register", "/api/tg/register"]) assert.notEqual((await gate(new NextRequest(`http://x${p}`, { method: p.startsWith("/api") ? "POST" : "GET" }), false)).status, 404, p);
  reg.setRegistration(admin.id, { open: false });
  assert.equal((await gate(new NextRequest("http://x/api/tg/register/status"), false)).status, 200);
});

const bell = await import("../bulletin/service.ts");
const registerItems = (u) => bell.personalItems(u).filter((i) => i.kind === "register");
const A_ = A, HB = { id: head2.id, role: "member" };

test("on: registering makes a 待核准 account: no cookie, cannot sign in, no membership yet, audited", async () => {
  reg.resetRegisterThrottle();
  reg.setRegistration(admin.id, { open: true });
  const pass = reg.setPhrase(H, classA.id, "AI Agent 實作 甲班 2026秋").code;
  assert.equal(pass, "AI Agent 實作 甲班 2026秋");
  const res = await post("register", { ...form("stu1", " ai-agent 實作甲班 2026 秋 "), note: "S1234 資工系" }); // case, spaces, punctuation do not matter
  assert.equal(res.status, 200);
  assert.equal((await res.json()).pending, true);
  assert.equal(res.headers.get("set-cookie"), null);
  const u = acc.listUsers().find((x) => x.email === "stu1@example.com");
  assert.equal(u.role, "member"); assert.equal(u.status, "disabled"); assert.deepEqual(u.groups, []);
  assert.equal(acc.authenticate("stu1@example.com", "Student-Pass-1"), null, "cannot sign in");
  const login = await post("login", { email: "stu1@example.com", password: "Student-Pass-1" });
  assert.equal(login.status, 403); const lb = await login.json(); assert.equal(lb.code, "pending_approval"); assert.match(lb.error, /等待管理員核准/);
  assert.equal((await post("login", { email: "stu1@example.com", password: "Wrong-Pass-1" })).status, 401, "a wrong password learns nothing");
  assert.ok(listAudit({ action: "account.self_register" }).find((r) => r.actor_id === u.id && JSON.parse(r.extra).result === "pending"));
});

test("notifications: every administrator and that class's head get the item; another class's head and a plain member do not", () => {
  const forAdmin = registerItems(A);
  assert.equal(forAdmin.length, 1); assert.equal(forAdmin[0].register.groupId, classA.id); assert.equal(forAdmin[0].register.count, 1);
  assert.match(forAdmin[0].title, /有 1 位新註冊等待核准/); assert.match(forAdmin[0].title, /申請加入『ClassA』/);
  assert.equal(registerItems(H).length, 1);
  assert.equal(registerItems(HB).length, 0);
  assert.equal(registerItems(P).length, 0);
  assert.equal(bell.bulletinSummary(A).parts.registers, 1);
});

test("the approval list shows name, email, the passphrase typed and the class it matched, grouped by class", () => {
  const g = reg.pendingRequests(H);
  assert.equal(g.length, 1); assert.equal(g[0].groupName, "ClassA");
  const r = g[0].applicants[0];
  assert.equal(r.email, "stu1@example.com"); assert.equal(r.phrase, " ai-agent 實作甲班 2026 秋 ".trim()); assert.equal(r.note, ""); /* v1.1: the 備註 box is gone */ assert.ok(r.createdAt > 0);
  assert.deepEqual(reg.pendingRequests(P), []);
});

test("approving: the head approves their own class (one click for the whole class); a head of another class cannot; the student then signs in", async () => {
  reg.resetRegisterThrottle();
  const pB = reg.setPhrase(HB, classB.id, "ClassB 2026 workshop").code;
  await post("register", form("inb1", pB));
  const inb = acc.listUsers().find((x) => x.email === "inb1@example.com");
  assert.throws(() => reg.approveRequest(H, inb.id), (e) => e.status === 404, "head A cannot approve class B");
  assert.throws(() => reg.rejectRequest(H, inb.id), (e) => e.status === 404);
  assert.equal(reg.approveGroup(H, classB.id), 0, "nor the whole of class B");
  assert.equal(acc.userById(inb.id).status, "disabled");
  const r = await post("regrequests/group", { action: "approve_group", groupId: classA.id }, head.id);
  assert.equal((await r.json()).approved, 1);
  const u = acc.listUsers().find((x) => x.email === "stu1@example.com");
  assert.equal(u.status, "active"); assert.deepEqual(u.groups, [classA.id]);
  assert.equal(acc.listGroups().find((g) => g.id === classA.id).members.find((m) => m.user_id === u.id).is_manager, 0);
  assert.ok(acc.authenticate("stu1@example.com", "Student-Pass-1"));
  assert.ok(listAudit({ action: "account.approve" }).find((x) => x.actor_id === head.id));
  assert.equal(registerItems(H).length, 0, "the notice goes away once decided");
  assert.equal(registerItems(A).length, 1, "class B is still waiting for the administrator");
  assert.equal(reg.approveGroup(A, "all"), 1);
  assert.deepEqual(acc.userById(inb.id).status, "active");
});

test("reject: the account stays (disabled, nothing deleted), cannot sign in, audited; a rejected account is not listed again", async () => {
  reg.resetRegisterThrottle();
  await post("register", form("stranger", reg.listCodes(H)[0].code));
  const u = acc.listUsers().find((x) => x.email === "stranger@example.com");
  reg.rejectRequest(H, u.id);
  const after = acc.userById(u.id);
  assert.equal(after.status, "disabled"); assert.equal(acc.authenticate("stranger@example.com", "Student-Pass-1"), null);
  assert.deepEqual(reg.pendingRequests(A), []);
  assert.ok(listAudit({ action: "account.reject" }).find((x) => x.actor_id === head.id));
  assert.equal((await (await post("login", { email: "stranger@example.com", password: "Student-Pass-1" })).json()).code === "pending_approval", false);
});

test("no passphrase (open workshop): the applicant has no class, only an administrator sees and approves it", async () => {
  reg.resetRegisterThrottle();
  reg.setRegistration(admin.id, { requireCode: false });
  await post("register", { name: "walkin", email: "walkin@example.com", password: "Student-Pass-1" });
  const u = acc.listUsers().find((x) => x.email === "walkin@example.com");
  assert.equal(reg.pendingRequests(H).length, 0);
  assert.throws(() => reg.approveRequest(H, u.id), (e) => e.status === 404);
  assert.equal(registerItems(A).filter((i) => i.register.groupId === null).length, 1);
  reg.approveRequest(A, u.id);
  assert.deepEqual(acc.userById(u.id).status, "active"); assert.deepEqual(acc.listUsers().find((x) => x.id === u.id).groups, []);
  reg.setRegistration(admin.id, { requireCode: true });
});

test("auto-approve switch (default off): a right passphrase signs in at once with a cookie and joins the class; a wrong one is still refused", async () => {
  reg.resetRegisterThrottle();
  assert.equal(reg.autoApprove(), false);
  reg.setRegistration(admin.id, { autoApprove: true });
  const res = await post("register", form("auto1", reg.listCodes(H)[0].code));
  assert.equal(res.status, 200); assert.match(res.headers.get("set-cookie"), /tigerai_session=/);
  const u = acc.listUsers().find((x) => x.email === "auto1@example.com");
  assert.equal(u.status, "active"); assert.deepEqual(u.groups, [classA.id]);
  reg.resetRegisterThrottle();
  assert.equal((await post("register", form("auto2", "no such phrase"))).status, 403);
  reg.setRegistration(admin.id, { autoApprove: false });
  assert.equal(reg.autoApprove(), false);
});

test("no privilege escalation: role, isManager, group and admin fields in the body are ignored", async () => {
  reg.resetRegisterThrottle();
  const code = reg.listCodes(H).find((c) => c.groupId === classA.id).code;
  const res = await post("register", { ...form("sneaky", code), role: "admin", isManager: true, groupId: classB.id, groups: [classB.id], status: "active" });
  assert.equal(res.status, 200);
  const u = acc.listUsers().find((x) => x.email === "sneaky@example.com");
  assert.equal(u.role, "member"); assert.equal(u.status, "disabled");
  reg.approveRequest(H, u.id);
  assert.deepEqual(acc.listUsers().find((x) => x.id === u.id).groups, [classA.id]);
  assert.equal(acc.listGroups().flatMap((g) => g.members).find((m) => m.user_id === u.id).is_manager, 0);
});

test("a passphrase must be 8+ characters and unique across classes", () => {
  assert.throws(() => reg.setPhrase(H, classA.id, "ab"), (e) => e.code === "bad_phrase");
  assert.throws(() => reg.setPhrase(HB, classB.id, "ai agent 實作 甲班 2026 秋"), (e) => e.code === "phrase_taken");
});

test("a wrong, disabled, rotated or missing code is refused and nothing is created; the code of one class never joins another", async () => {
  reg.resetRegisterThrottle();
  const before = acc.listUsers().length;
  for (const code of ["", "NOPE-NOPE", "AAAA-AAAA", "x", "ClassB"]) { reg.resetRegisterThrottle(); assert.equal((await post("register", form("x1", code))).status, 403, `code ${code}`); }
  assert.equal(acc.listUsers().length, before);
  reg.resetRegisterThrottle();
  const old = reg.listCodes(H)[0].code;
  const fresh = reg.rotateCode(H, classA.id).code;
  assert.notEqual(old, fresh);
  reg.resetRegisterThrottle();
  assert.equal((await post("register", form("x2", old))).status, 403, "the old code stopped working");
  reg.disableCode(H, classA.id);
  reg.resetRegisterThrottle();
  assert.equal((await post("register", form("x3", fresh))).status, 403, "a disabled code does nothing");
  const codeB = reg.rotateCode({ id: head2.id, role: "member" }, classB.id).code;
  reg.resetRegisterThrottle();
  assert.equal((await post("register", form("inb", codeB))).status, 200);
  assert.equal(reg.pendingRequests(HB)[0].applicants.some((a) => a.email === "inb@example.com"), true);
  assert.equal(reg.pendingRequests(H).some((g) => g.applicants.some((a) => a.email === "inb@example.com")), false);
});

test("a stranger without a valid code cannot probe which emails exist", async () => {
  reg.resetRegisterThrottle();
  const res = await post("register", { name: "probe", email: "a@example.com", password: "Student-Pass-1", code: "" });
  assert.equal(res.status, 403); // not 409 "already in use"
});

test("who may see and change a join code: the department's head and administrators only", () => {
  assert.deepEqual(reg.listCodes(H).map((c) => c.groupId), [classA.id]);
  assert.deepEqual(reg.listCodes(P), []);
  assert.deepEqual(reg.listCodes(A).map((c) => c.groupId).sort(), [classA.id, classB.id].sort());
  assert.throws(() => reg.rotateCode(H, classB.id), (e) => e.status === 403);
  assert.throws(() => reg.rotateCode(P, classA.id), (e) => e.status === 403);
  assert.throws(() => reg.disableCode(P, classA.id), (e) => e.status === 403);
});

test("the switch itself is administrator only; the join-code API refuses a member with no department", async () => {
  const cookie = (u) => u.id; // the gate sets x-tg-uid from the verified cookie; the handler trusts only that header
  const { registerAdmin } = await import("../api/register.ts");
  await assert.rejects(registerAdmin(new Request("http://x", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" }), "PUT", P), (e) => e.status === 403);
  const res = await post("joincodes/" + classA.id, { action: "rotate" }, cookie(plain));
  assert.equal(res.status, 403);
});

test("rate limit: a wrong code makes THAT account wait (doubling) and nobody else, and the per-class hourly cap stops a flood of real registrations", async () => {
  reg.resetRegisterThrottle();
  reg.setRegistration(admin.id, { open: true });
  assert.equal((await post("register", form("r1", "AAAAAAAA"))).status, 403);
  const blocked = await post("register", form("r1", "AAAAAAAA"));
  assert.equal(blocked.status, 429, "the same account must wait");
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
  assert.equal((await post("register", form("r2", "AAAAAAAA"))).status, 403, "another student is not slowed down by r1's typo (it is a wrong code, not a 429)");
  reg.resetRegisterThrottle();
  const code = reg.rotateCode(H, classA.id).code;
  let ok = 0, limited = 0;
  for (let i = 0; i < 8; i++) { const r = await post("register", form(`bulk${i}`, code)); if (r.status === 200) ok++; if (r.status === 429) limited++; }
  assert.equal(ok, 5); assert.equal(limited, 3); // TIGERAI_REGISTER_PER_HOUR=5 per class
});

test("form typos do not count against the class", async () => {
  reg.resetRegisterThrottle();
  const code = reg.listCodes(H)[0].code;
  assert.equal((await post("register", { ...form("typo", code), password: "short" })).status, 400);
  assert.equal((await post("register", { ...form("typo", code), password: "short" })).status, 400); // not 429
});

test("an administrator can still disable a self-registered account and its cookie stops working", async () => {
  const u = acc.listUsers().find((x) => x.email === "stu1@example.com");
  assert.equal(u.status, "active");
  const cookie = `${ses.SESSION_COOKIE}=${ses.createSessionCookie(u.id, u.token_version)}`;
  assert.equal((await gate(new NextRequest("http://x/api/tg/me", { headers: { cookie } }), false)).status, 200);
  acc.updateUser(admin.id, u.id, { status: "disabled" });
  assert.equal((await gate(new NextRequest("http://x/api/tg/me", { headers: { cookie } }), false)).status, 401);
});
