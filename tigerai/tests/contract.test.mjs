// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Contract tests against a running dev server with TIGERAI_ENABLED=1 (see tigerai/README.md).
// Needs: E2E_BASE_URL, ADMIN_EMAIL/PASSWORD, MEMBER_A_*/MEMBER_B_* and TIGERAI_DATA_DIR. Skips when absent.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { Client } from "../tools/client.mjs";
import { buildXlsx, sampleOrgSheets } from "../tools/xlsx-writer.mjs";
import { writeFixtureSession } from "../tools/fixture-session.mjs";

const e = process.env;
const ready = e.E2E_BASE_URL && e.ADMIN_PASSWORD && e.MEMBER_A_PASSWORD && e.MEMBER_B_PASSWORD && e.TIGERAI_DATA_DIR;
const T = (name, fn) => test(name, { skip: !ready && "set the E2E_* variables" }, fn);
const base = e.E2E_BASE_URL;

async function signedIn(email, password) { const c = new Client(base); await c.login(email, password); return c; }
const newSession = (c, cwd) => c.post("/api/agent/new", { cwd, type: "ensure_session" });
const state = {};

T("setup: three signed-in clients", async () => {
  state.admin = await signedIn(e.ADMIN_EMAIL, e.ADMIN_PASSWORD);
  state.a = await signedIn(e.MEMBER_A_EMAIL, e.MEMBER_A_PASSWORD);
  state.b = await signedIn(e.MEMBER_B_EMAIL, e.MEMBER_B_PASSWORD);
  state.aMe = (await state.a.get("/api/tg/me")).json;
  state.bMe = (await state.b.get("/api/tg/me")).json;
  state.aHome = (await state.a.get("/api/home")).json.home;
  state.bHome = (await state.b.get("/api/home")).json.home;
  assert.notEqual(state.aHome, state.bHome);
  assert.ok(state.aHome.includes(state.aMe.id));
});

// ---------------------------------------------------------------- S1
T("S1: anonymous requests are refused or sent to the login page", async () => {
  const anon = new Client(base);
  assert.equal((await anon.get("/api/sessions")).status, 401);
  const root = await anon.get("/");
  assert.equal(root.status, 307);
  assert.match(root.headers.get("location"), /\/tg\/login/);
  assert.match((await anon.get("/login")).headers.get("location"), /\/tg\/login/);
  assert.equal((await anon.get("/tg/login")).status, 200);
});

T("S1: a forged x-tg-uid header is ignored", async () => {
  const anon = new Client(base);
  assert.equal((await anon.get("/api/tg/me", { "x-tg-uid": state.aMe.id })).status, 401);
  const adminMe = (await state.admin.get("/api/tg/me")).json;
  // A member claiming to be the administrator through the header is still the member.
  const me = await state.a.get("/api/tg/me", { "x-tg-uid": adminMe.id });
  assert.equal(me.json.id, state.aMe.id);
  assert.equal((await state.a.get("/api/tg/admin/users", { "x-tg-uid": adminMe.id })).status, 403);
});

T("S1: wrong password is refused, admin API is admin-only", async () => {
  const anon = new Client(base);
  assert.equal((await anon.post("/api/tg/login", { email: e.ADMIN_EMAIL, password: "definitely-wrong-password" })).status, 401);
  // The throttle is global: for the next second even the right password is refused.
  assert.equal((await anon.post("/api/tg/login", { email: e.ADMIN_EMAIL, password: e.ADMIN_PASSWORD })).status, 429);
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal((await state.a.get("/api/tg/admin/users")).status, 403);
  assert.equal((await state.a.post("/api/tg/admin/users", { email: "x@example.com", name: "x" })).status, 403);
  assert.equal((await state.admin.get("/api/tg/admin/users")).status, 200);
});

T("S1: forced password change confines the user; disabling kills the cookie at once", async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const made = await state.admin.post("/api/tg/admin/users", { email: `t${tag}@example.com`, name: `t${tag}`, role: "member" });
  assert.equal(made.status, 201);
  const c = new Client(base);
  assert.equal((await c.login(`t${tag}@example.com`, made.json.initialPassword)).mustChangePassword, true);
  const blocked = await c.get("/api/sessions");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, "password_change_required");
  const redirected = await c.get("/");
  assert.match(redirected.headers.get("location"), /\/tg\/account/);
  const ch = await c.post("/api/tg/account/password", { current: made.json.initialPassword, next: `${tag}-new-Secret-1` });
  assert.equal(ch.status, 200);
  assert.equal((await c.get("/api/sessions")).status, 200);
  // disable: the very next request with the same cookie fails
  const off = await state.admin.req("PATCH", `/api/tg/admin/users/${made.json.user.id}`, { status: "disabled" });
  assert.equal(off.status, 200);
  assert.equal((await c.get("/api/sessions")).status, 401);
  assert.equal((await new Client(base).post("/api/tg/login", { email: `t${tag}@example.com`, password: `${tag}-new-Secret-1` })).status, 401);
});

T("S1: the last administrator cannot be disabled", async () => {
  const users = (await state.admin.get("/api/tg/admin/users")).json.users;
  const admins = users.filter((u) => u.role === "admin" && u.status === "active");
  if (admins.length === 1) {
    const r = await state.admin.req("PATCH", `/api/tg/admin/users/${admins[0].id}`, { status: "disabled" });
    assert.equal(r.status, 409);
  }
});

T("S1: groups: create, add member, list", async () => {
  const name = `g${Math.random().toString(36).slice(2, 7)}`;
  const g = await state.admin.post("/api/tg/admin/groups", { name });
  assert.equal(g.status, 201);
  const put = await state.admin.req("PUT", `/api/tg/admin/groups/${g.json.group.id}/members`, { userId: state.aMe.id, present: true });
  assert.equal(put.status, 200);
  const groups = (await state.admin.get("/api/tg/admin/groups")).json.groups;
  assert.ok(groups.find((x) => x.id === g.json.group.id).members.some((m) => m.user_id === state.aMe.id));
});

T("S1: audit records actions, never passwords, and the table is append-only", async () => {
  const rows = (await state.admin.get("/api/tg/admin/audit?limit=500")).json.rows;
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ["auth.login", "user.create", "group.create"]) assert.ok(actions.has(a), a);
  assert.ok(!JSON.stringify(rows).match(/initialPassword|Secret-1/));
  const db = new DatabaseSync(join(e.TIGERAI_DATA_DIR, "tigerai.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  assert.throws(() => db.exec("UPDATE audit SET action='x' WHERE id=1"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM audit WHERE id=1"), /append-only/);
  db.close();
});

// ---------------------------------------------------------------- S2
T("S2: member A's conversation is invisible and inaccessible to member B", async () => {
  const created = await newSession(state.a, state.aHome);
  assert.equal(created.status, 200, created.text);
  state.aSession = created.json.sessionId;
  const id = state.aSession;
  const listA = (await state.a.get("/api/sessions")).json;
  assert.ok(listA.sessions.some((s) => s.id === id) || listA.runningSessionIds !== undefined);
  const listB = (await state.b.get("/api/sessions")).json;
  assert.ok(!listB.sessions.some((s) => s.id === id));
  for (const path of [`/api/sessions/${id}`, `/api/sessions/${id}/export`, `/api/sessions/${id}/context`, `/api/sessions/${id}/state`, `/api/agent/${id}`, `/api/agent/${id}/events`, `/api/agent/${id}/lease`]) {
    const r = await state.b.get(path);
    assert.equal(r.status, 403, `${path} -> ${r.status}`);
  }
  assert.equal((await state.b.post(`/api/sessions/${id}/fork`, {})).status, 403);
  assert.equal((await state.b.post("/api/sessions/stats", { ids: [id] })).status, 200);
  assert.equal(Object.keys((await state.b.post("/api/sessions/stats", { ids: [id] })).json.stats).length, 0);
  assert.ok(!JSON.stringify((await state.b.get("/api/agent/running")).json).includes(id));
  assert.ok(!JSON.stringify((await state.b.get("/api/sessions/ui-state")).json).includes(id));
  assert.equal((await state.b.get(`/api/sessions/search?q=${encodeURIComponent("anything")}`)).status, 200);
  // the owner and the administrator can
  assert.equal((await state.a.get(`/api/agent/${id}`)).status, 200);
  assert.equal((await state.admin.get(`/api/agent/${id}`)).status, 200);
});

T("S2: search and the session list show a finished conversation only to its owner (and the administrator)", async () => {
  const word = `zebrafish${Math.random().toString(36).slice(2, 7)}`;
  const id = writeFixtureSession({ agentDir: e.PI_CODING_AGENT_DIR, tigerDir: e.TIGERAI_DATA_DIR, userId: state.aMe.id, cwd: state.aHome, name: `fixture ${word}`, question: `Tell me about ${word}`, answer: `${word} is a small fish.` });
  const find = async (c) => (await c.get(`/api/sessions/search?q=${word}`)).text.includes(id) || (await c.get("/api/sessions?force=1")).text.includes(id);
  assert.equal(await find(state.a), true, "owner finds it");
  assert.equal(await find(state.admin), true, "administrator finds it");
  assert.equal(await find(state.b), false, "another member neither finds nor lists it");
  const searchB = (await state.b.get(`/api/sessions/search?q=${word}`)).text;
  assert.ok(!searchB.includes(word) && !searchB.includes(id));
  assert.equal((await state.b.get(`/api/sessions/${id}`)).status, 403);
  assert.equal((await state.a.get(`/api/sessions/${id}`)).status, 200);
  assert.equal(Object.keys((await state.b.post("/api/sessions/stats", { ids: [id] })).json.stats).length, 0);
  assert.equal(Object.keys((await state.a.post("/api/sessions/stats", { ids: [id] })).json.stats).length, 1);
  // a copy made by B of A's conversation is refused; A's own fork is registered to A
  assert.equal((await state.b.post(`/api/sessions/${id}/fork`, {})).status, 403);
  const fork = await state.a.post(`/api/sessions/${id}/fork`, {});
  assert.equal(fork.status, 200, fork.text);
  assert.equal((await state.a.get(`/api/sessions/${fork.json.sessionId}`)).status, 200);
  assert.equal((await state.b.get(`/api/sessions/${fork.json.sessionId}`)).status, 403);
  state.fixtureId = id;
});

T("S2: sessions without an owner are for administrators only", async () => {
  // A session created before accounts were switched on has no owner row: simulate with a made-up id.
  assert.equal((await state.a.get("/api/sessions/00000000-0000-4000-8000-000000000000")).status, 403);
  assert.notEqual((await state.admin.get("/api/sessions/00000000-0000-4000-8000-000000000000")).status, 403);
});

T("S2: folders: members stay in their own folder", async () => {
  assert.equal((await newSession(state.b, "/etc")).status, 403);
  assert.equal((await newSession(state.b, state.aHome)).status, 403);
  assert.equal((await newSession(state.b, `${state.bHome}/../${state.aMe.id}`)).status, 403);
  assert.equal((await state.b.post("/api/cwd/validate", { cwd: state.aHome })).status, 403);
  assert.equal((await state.b.get(`/api/cwd/browse?path=${encodeURIComponent("/etc")}`)).status, 403);
  assert.equal((await state.b.post("/api/cwd/validate", { cwd: state.bHome })).status, 200);
  const enc = (p) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  assert.equal((await state.b.get(`/api/files/${enc(state.aHome)}?type=list`)).status, 403);
  assert.equal((await state.b.get(`/api/files/etc/hostname?type=read`)).status, 403);
  assert.equal((await state.b.get(`/api/files/${enc(state.bHome)}?type=list`)).status, 200);
  assert.equal((await state.b.get(`/api/files/${enc(state.bHome)}/..%2F${state.aMe.id}?type=list`)).status, 403);
});

T("S2: members cannot run shell commands or change their tools", async () => {
  assert.equal((await state.b.post("/api/agent/new", { cwd: state.bHome, type: "bash", command: "id" })).status, 403);
  assert.equal((await state.a.post(`/api/agent/${state.aSession}`, { type: "bash", command: "id" })).status, 403);
  assert.equal((await state.a.post(`/api/agent/${state.aSession}`, { type: "set_tools", toolNames: ["bash"] })).status, 403);
  assert.equal((await state.a.post(`/api/agent/${state.aSession}`, { type: "fork" })).status, 403);
  const tools = await state.a.post(`/api/agent/${state.aSession}`, { type: "get_tools" });
  assert.equal(tools.status, 200, tools.text);
  const names = tools.json.data.map((t) => t.name);
  assert.ok(names.includes("read"), "read tool should remain");
  for (const banned of ["bash", "edit", "write", "powershell", "codemode"]) assert.ok(!names.includes(banned), `${banned} must not exist for a member`);
});

T("S2: a member's /reload does not bring the shell tools back", async () => {
  const r = await state.a.post(`/api/agent/${state.aSession}`, { type: "reload" });
  assert.ok(r.status === 200 || r.status === 500, `reload -> ${r.status}`);
  const names = (await state.a.post(`/api/agent/${state.aSession}`, { type: "get_tools" })).json.data.map((t) => t.name);
  assert.ok(!names.includes("bash") && !names.includes("write") && !names.includes("edit"));
});

T("S2: admin-only upstream routes are closed to members", async () => {
  for (const [m, p] of [["GET", "/api/models-config"], ["GET", "/api/plugins"], ["POST", "/api/sessions/delete"], ["GET", "/api/mcp"], ["GET", "/api/auth/providers"], ["GET", "/api/worktrees"], ["GET", "/api/git/status"], ["GET", "/api/agent/debug"], ["GET", "/api/terminal"]]) {
    assert.equal((await state.a.req(m, p, m === "POST" ? {} : undefined)).status, 403, `${m} ${p}`);
  }
});

T("S2: an administrator's own session keeps full tools", async () => {
  const created = await newSession(state.admin, "/home");
  assert.equal(created.status, 200, created.text);
  const tools = await state.admin.post(`/api/agent/${created.json.sessionId}`, { type: "get_tools" });
  const adminTools = tools.json.data.filter((t) => t.active).map((t) => t.name);
  assert.ok(adminTools.includes("bash") && adminTools.includes("edit"));
  assert.equal((await state.a.get(`/api/agent/${created.json.sessionId}`)).status, 403);
});

// ---------------------------------------------------------------- S3
T("S3: rooms: visibility, mentions, unread, immutability", async () => {
  const tag = Math.random().toString(36).slice(2, 7);
  const carolMade = await state.admin.post("/api/tg/admin/users", { email: `c${tag}@example.com`, name: `carol${tag}` });
  const carol = new Client(base);
  await carol.login(`c${tag}@example.com`, carolMade.json.initialPassword);
  await carol.post("/api/tg/account/password", { current: carolMade.json.initialPassword, next: `${tag}-Carol-Pass-1` });

  const room = (await state.a.post("/api/tg/rooms", { name: `room-${tag}` })).json.room;
  assert.equal((await state.a.post(`/api/tg/rooms/${room.id}/members`, { userId: state.bMe.id })).status, 200);
  assert.equal((await carol.get(`/api/tg/rooms/${room.id}`)).status, 404);
  assert.ok(!(await carol.get("/api/tg/rooms")).json.rooms.some((r) => r.id === room.id));
  // only the room owner (or an admin) may add people
  assert.equal((await state.b.post(`/api/tg/rooms/${room.id}/members`, { userId: carolMade.json.user.id })).status, 403);

  const post = await state.a.post(`/api/tg/rooms/${room.id}/messages`, { text: `hello @${state.bMe.name} and @nobody` });
  assert.equal(post.status, 201);
  assert.deepEqual(JSON.parse(post.json.message.mentions), [state.bMe.id]);
  const mine = (await state.a.get("/api/tg/rooms")).json.rooms.find((r) => r.id === room.id);
  assert.equal(mine.unread, 0, "own messages count as read");
  const list = (await state.b.get("/api/tg/rooms")).json.rooms.find((r) => r.id === room.id);
  assert.equal(list.unread, 1);
  assert.equal(list.mentioned, 1);
  const seen = (await state.b.get(`/api/tg/rooms/${room.id}`)).json.messages;
  assert.equal(seen.length, 1);
  await state.b.post(`/api/tg/rooms/${room.id}/read`, { seq: seen[0].seq });
  assert.equal((await state.b.get("/api/tg/rooms")).json.rooms.find((r) => r.id === room.id).unread, 0);
  await state.b.post(`/api/tg/rooms/${room.id}/read`, { seq: 0 }); // the cursor never moves back
  assert.equal((await state.b.get("/api/tg/rooms")).json.rooms.find((r) => r.id === room.id).unread, 0);

  const db = new DatabaseSync(join(e.TIGERAI_DATA_DIR, "tigerai.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  assert.throws(() => db.exec("UPDATE room_messages SET text='x'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM room_messages"), /append-only/);
  assert.throws(() => db.exec(`UPDATE room_reads SET last_seq=0 WHERE room_id='${room.id}' AND user_id='${state.bMe.id}'`), /forward/);
  db.close();
  state.room = room; state.carol = carol;
});

T("S3: the AI conversation of a room: members share it read-only, outsiders and removed members do not", async () => {
  const { room, carol } = state;
  const info = (await state.b.get(`/api/tg/rooms/${room.id}`)).json;
  const made = await newSession(state.b, info.dir);
  assert.equal(made.status, 200, made.text);
  const sid = made.json.sessionId;
  assert.equal((await state.b.post(`/api/tg/rooms/${room.id}/bind`, { sessionId: sid })).status, 200);
  assert.equal((await state.a.get(`/api/agent/${sid}`)).status, 200, "room member A can open it");
  assert.equal((await carol.get(`/api/agent/${sid}`)).status, 403, "outsider cannot");
  // the shared conversation is read-only whoever made it
  const roomTools = (await state.a.post(`/api/agent/${sid}`, { type: "get_tools" })).json.data.map((t) => t.name);
  assert.ok(!roomTools.includes("bash") && !roomTools.includes("write"));
  // an outsider cannot bind someone else's conversation
  const stray = await newSession(state.a, state.aHome);
  assert.equal((await state.a.post(`/api/tg/rooms/${room.id}/bind`, { sessionId: stray.json.sessionId })).status, 403);
  // removing B closes the room and the conversation at once
  assert.equal((await state.a.req("DELETE", `/api/tg/rooms/${room.id}/members/${state.bMe.id}`)).status, 200);
  assert.equal((await state.b.get(`/api/tg/rooms/${room.id}`)).status, 404);
  assert.equal((await state.b.get(`/api/agent/${sid}`)).status, 403, "the creator, once removed from the room, loses the room conversation too");
});

// ---------------------------------------------------------------- S3b: @AI
T("S3: @AI in a room reaches the room's own conversation; a failure is reported once, in the room, and the queue drains", async () => {
  const room = (await state.a.post("/api/tg/rooms", { name: `ai-${Math.random().toString(36).slice(2, 6)}` })).json.room;
  await state.a.post(`/api/tg/rooms/${room.id}/members`, { userId: state.bMe.id });
  await state.a.post(`/api/tg/rooms/${room.id}/messages`, { text: "context line before the question" });
  assert.equal((await state.a.post(`/api/tg/rooms/${room.id}/messages`, { text: "@AI what is in this folder?" })).status, 201);
  assert.equal((await state.b.post(`/api/tg/rooms/${room.id}/messages`, { text: "hey @ai and again" })).status, 201);
  // a message that merely contains the letters is not a request
  await state.b.post(`/api/tg/rooms/${room.id}/messages`, { text: "mail@aiwa.example is not a mention" });
  let aiMessages = [];
  for (let i = 0; i < 150 && aiMessages.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const msgs = (await state.a.get(`/api/tg/rooms/${room.id}`)).json.messages;
    aiMessages = msgs.filter((m) => m.kind === "ai");
  }
  assert.equal(aiMessages.length, 2, "exactly one reply (or one failure notice) per @AI request");
  for (const m of aiMessages) assert.ok(m.text.length > 0 && m.author === "AI");
  // without model credentials in the isolated agent folder the reply is the failure notice
  if (process.env.EXPECT_NO_MODEL === "1") for (const m of aiMessages) assert.match(m.text, /^AI could not reply/);
  if (process.env.MOCK_V1_STATS) for (const m of aiMessages) assert.match(m.text, /^MOCK-REPLY/, "answered by the mock /v1 endpoint");
  const info = (await state.a.get(`/api/tg/rooms/${room.id}`)).json;
  assert.ok(info.room.bound_session_id, "the room's conversation exists");
  assert.equal(info.ai.busy, false);
  // that conversation is the room's: members open it, outsiders cannot, and it is read-only and fenced
  const sid = info.room.bound_session_id;
  assert.equal((await state.b.get(`/api/agent/${sid}`)).status, 200);
  // the channel's conversation is read in the channel: it is in nobody's sidebar (it used to show the channel id as a project name)
  for (const who of [state.a, state.b, state.admin]) assert.ok(!(await who.get("/api/sessions")).json.sessions.some((x) => x.id === sid), "room conversation is not listed in a sidebar");
  assert.equal((await state.carol.get(`/api/agent/${sid}`)).status, 403);
  const names = (await state.a.post(`/api/agent/${sid}`, { type: "get_tools" })).json.data.map((t) => t.name);
  assert.ok(!names.includes("bash") && !names.includes("write") && !names.includes("edit"));
  assert.equal((await state.a.post("/api/tg/rooms/rdoesnotexist/messages", { text: "@AI hi" })).status, 404);
  assert.equal((await state.carol.post(`/api/tg/rooms/${room.id}/messages`, { text: "@AI hi" })).status, 404);
});

T("S3: an AI role (@role): visibility by group, one conversation per (room, role), reply signed by the role", async () => {
  const tag = Math.random().toString(36).slice(2, 6);
  const open = (await state.admin.post("/api/tg/admin/agents", { name: `helper${tag}`, description: "test", system_prompt: "You are a test helper." })).json.agent;
  const grp = (await state.admin.post("/api/tg/admin/groups", { name: `only${tag}` })).json.group;
  await state.admin.req("PUT", `/api/tg/admin/groups/${grp.id}/members`, { userId: state.aMe.id, present: true });
  const secret = (await state.admin.post("/api/tg/admin/agents", { name: `secret${tag}`, group_ids: [grp.id] })).json.agent;
  assert.ok(open.id && secret.id);
  assert.equal((await state.admin.post("/api/tg/admin/agents", { name: "AI" })).status, 400, "AI is reserved for the plain model");
  assert.equal((await state.a.get("/api/tg/admin/agents")).status, 403);
  const seenByA = (await state.a.get("/api/tg/agents")).json.agents.map((x) => x.name);
  const seenByB = (await state.b.get("/api/tg/agents")).json.agents.map((x) => x.name);
  assert.ok(seenByA.includes(`helper${tag}`) && seenByA.includes(`secret${tag}`));
  assert.ok(seenByB.includes(`helper${tag}`) && !seenByB.includes(`secret${tag}`), "a role outside B's groups cannot even be listed");

  const room = (await state.a.post("/api/tg/rooms", { name: `roles-${tag}` })).json.room;
  await state.a.post(`/api/tg/rooms/${room.id}/members`, { userId: state.bMe.id });
  await state.a.post(`/api/tg/rooms/${room.id}/messages`, { text: `@helper${tag} first question` });
  await state.b.post(`/api/tg/rooms/${room.id}/messages`, { text: `@secret${tag} should be ignored for B` });
  await state.b.post(`/api/tg/rooms/${room.id}/messages`, { text: `@helper${tag} second question` });
  let ai = [];
  for (let i = 0; i < 150 && ai.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    ai = (await state.a.get(`/api/tg/rooms/${room.id}`)).json.messages.filter((m) => m.kind === "ai");
  }
  assert.equal(ai.length, 2);
  assert.ok(ai.every((m) => m.author === `helper${tag}`), "signed by the role");
  if (process.env.MOCK_V1_STATS) {
    assert.ok(ai.every((m) => /^MOCK-REPLY/.test(m.text)));
    const seen = await (await fetch(process.env.MOCK_V1_STATS)).json();
    assert.match(seen.lastSystemText, /You are "helper/, "the role text reached the model");
    assert.match(seen.lastSystemText, /You are a test helper/);
  }
  assert.ok(!ai.some((m) => m.author === `secret${tag}`));
  assert.ok(!ai.some((m) => m.text.includes("/home/")), "no server path in the notice");
  const db = new DatabaseSync(join(e.TIGERAI_DATA_DIR, "tigerai.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  const rows = db.prepare("SELECT session_id FROM room_assistants WHERE room_id=?").all(room.id);
  assert.equal(rows.length, 1, "both questions went to the same (room, role) conversation");
  db.close();
  assert.equal((await state.b.get(`/api/agent/${rows[0].session_id}`)).status, 200);
  assert.equal((await state.carol.get(`/api/agent/${rows[0].session_id}`)).status, 403);
});

// ---------------------------------------------------------------- S5
const commandsOf = async (c, home) => {
  const sid = (await newSession(c, home)).json.sessionId;
  return (await c.post(`/api/agent/${sid}`, { type: "get_commands" })).json.data.commands.filter((x) => x.source === "prompt").map((x) => x.name);
};

T("S5: personal prompts are private; the '/' menu of a new conversation shows only own + ticked", async () => {
  const tag = Math.random().toString(36).slice(2, 6);
  const mine = await state.b.post("/api/tg/prompts", { name: `mine-${tag}`, description: "private", body: "Summarise: $ARGUMENTS" });
  assert.equal(mine.status, 201);
  assert.ok(!(await state.a.get("/api/tg/prompts")).json.prompts.some((p) => p.name === `mine-${tag}`));
  assert.ok((await state.b.get("/api/tg/prompts")).json.prompts.some((p) => p.name === `mine-${tag}`));
  assert.ok((await commandsOf(state.b, state.bHome)).includes(`mine-${tag}`));
  assert.ok(!(await commandsOf(state.a, state.aHome)).includes(`mine-${tag}`));
  assert.equal((await state.a.req("DELETE", `/api/tg/prompts/${mine.json.prompt.id}`)).status, 404, "nobody else can delete it");
  assert.equal((await state.a.req("PATCH", `/api/tg/prompts/${mine.json.prompt.id}`, { body: "x" })).status, 404);
  state.tag = tag; state.minePrompt = mine.json.prompt;
});

T("S5: sharing goes through a work order; approver is another administrator; a copy lands in the library; not visible until a head ticks", async () => {
  const { tag, minePrompt } = state;
  const sub = await state.b.post(`/api/tg/prompts/${minePrompt.id}/share`, {});
  assert.equal(sub.status, 201);
  assert.equal((await state.b.post(`/api/tg/prompts/${minePrompt.id}/share`, {})).status, 409, "one pending request per template");
  assert.equal((await state.b.post(`/api/tg/workorders/${sub.json.orderId}/decide`, { approve: true })).status, 404);
  assert.equal((await state.b.post(`/api/tg/admin/workorders/${sub.json.orderId}/decide`, { approve: true })).status, 403, "a member cannot approve");
  const mineList = (await state.b.get("/api/tg/prompts/mine")).json.prompts.find((p) => p.id === minePrompt.id);
  assert.equal(mineList.shareStatus, "pending");
  // an administrator cannot approve their own order
  const own = (await state.admin.post("/api/tg/prompts", { name: `adm-${tag}`, body: "x" })).json.prompt;
  const ownOrder = await state.admin.post(`/api/tg/prompts/${own.id}/share`, {});
  const self = await state.admin.post(`/api/tg/admin/workorders/${ownOrder.json.orderId}/decide`, { approve: true });
  assert.equal(self.status, 403);
  const approve = await state.admin.post(`/api/tg/admin/workorders/${sub.json.orderId}/decide`, { approve: true });
  assert.equal(approve.status, 200, approve.text);
  assert.equal(approve.json.order.status, "approved");
  assert.equal((await state.admin.post(`/api/tg/admin/workorders/${sub.json.orderId}/decide`, { approve: false })).status, 409, "a decision is final");
  const lib = (await state.admin.get("/api/tg/admin/prompts")).json.prompts;
  const copy = lib.find((p) => p.id === approve.json.order.result_ref);
  assert.ok(copy && copy.source_id === minePrompt.id && copy.owner_id === null, "a copy, with a pointer to the original");
  assert.equal((await state.b.get("/api/tg/prompts/mine")).json.prompts.find((p) => p.id === minePrompt.id).shareStatus, "approved");
  assert.ok((await state.b.get("/api/tg/prompts/mine")).json.prompts.some((p) => p.id === minePrompt.id), "the original stays with its owner");
  // rejected order publishes nothing
  const rej = await state.admin.post(`/api/tg/admin/workorders/${(await state.b.post(`/api/tg/prompts/${(await state.b.post("/api/tg/prompts", { name: `rej-${tag}`, body: "z" })).json.prompt.id}/share`, {})).json.orderId}/decide`, { approve: false, note: "no" });
  assert.equal(rej.json.order.status, "rejected");
  assert.ok(!(await state.admin.get("/api/tg/admin/prompts")).json.prompts.some((p) => p.name === `rej-${tag}`));
  // audit trail
  const actions = new Set((await state.admin.get("/api/tg/admin/audit?limit=500")).json.rows.map((r) => r.action));
  for (const a of ["workorder.create", "workorder.approve", "workorder.reject"]) assert.ok(actions.has(a), a);
  // in the library but ticked by nobody: still not in anyone's menu, an administrator who is also a member included
  assert.ok(!(await state.a.get("/api/tg/prompts")).json.prompts.some((p) => p.id === copy.id));
  // the owner can rename the original without touching the published copy
  assert.equal((await state.b.req("PATCH", `/api/tg/prompts/${minePrompt.id}`, { name: `orig-${tag}` })).status, 200);
  state.copy = copy;
});

T("S5: department heads tick for their own groups only; library alone shows nothing", async () => {
  const { tag, copy } = state;
  const g = (await state.admin.post("/api/tg/admin/groups", { name: `dept${tag}` })).json.group;
  const other = (await state.admin.post("/api/tg/admin/groups", { name: `other${tag}` })).json.group;
  const headless = (await state.admin.post("/api/tg/admin/groups", { name: `headless${tag}` })).json.group;
  await state.admin.req("PUT", `/api/tg/admin/groups/${g.id}/members`, { userId: state.aMe.id, present: true, isManager: true });
  await state.admin.req("PUT", `/api/tg/admin/groups/${g.id}/members`, { userId: state.bMe.id, present: true });
  await state.admin.req("PUT", `/api/tg/admin/groups/${other.id}/members`, { userId: state.bMe.id, present: true });
  // B is a plain member of two groups: no library access, cannot tick
  assert.equal((await state.b.get("/api/tg/prompts/library")).status, 403);
  assert.equal((await state.b.post(`/api/tg/prompts/${copy.id}/ticks`, { groupId: g.id })).status, 403);
  // A heads one group only
  const view = (await state.a.get("/api/tg/prompts/library")).json;
  assert.ok(view.groups.some((x) => x.id === g.id) && !view.groups.some((x) => x.id === other.id || x.id === headless.id), "only the groups A heads");
  assert.ok(view.library.some((p) => p.id === copy.id));
  assert.equal((await state.a.post(`/api/tg/prompts/${copy.id}/ticks`, { groupId: other.id })).status, 403, "not their department");
  assert.ok(!(await commandsOf(state.b, state.bHome)).includes(copy.name), "in the library, not yet ticked");
  assert.equal((await state.a.post(`/api/tg/prompts/${copy.id}/ticks`, { groupId: g.id })).status, 200);
  assert.ok((await commandsOf(state.b, state.bHome)).includes(copy.name), "ticked by the head: B sees it");
  assert.ok((await commandsOf(state.a, state.aHome)).includes(copy.name), "the head is a member of the group too");
  assert.ok(!(await commandsOf(state.carol, (await state.carol.get("/api/home")).json.home)).includes(copy.name), "outside the department");
  // untick removes it from new conversations
  assert.equal((await state.a.post(`/api/tg/prompts/${copy.id}/ticks`, { groupId: g.id, on: false })).status, 200);
  assert.ok(!(await commandsOf(state.b, state.bHome)).includes(copy.name));
  // a group without a head: only an administrator can tick
  assert.equal((await state.a.post(`/api/tg/prompts/${copy.id}/ticks`, { groupId: headless.id })).status, 403);
  assert.equal((await state.admin.post(`/api/tg/prompts/${copy.id}/ticks`, { groupId: headless.id })).status, 200);
  // the head keeps a prompt of their own department directly
  const gp = await state.a.post(`/api/tg/prompts/group/${g.id}`, { name: `team-${tag}`, body: "team only" });
  assert.equal(gp.status, 201);
  assert.ok((await commandsOf(state.b, state.bHome)).includes(`team-${tag}`));
  assert.ok(!(await commandsOf(state.carol, (await state.carol.get("/api/home")).json.home)).includes(`team-${tag}`));
  assert.equal((await state.a.post(`/api/tg/prompts/group/${other.id}`, { name: `x-${tag}`, body: "no" })).status, 403);
  // an administrator publishes directly
  const pub = await state.admin.post("/api/tg/admin/prompts", { name: `pub-${tag}`, body: "published" });
  assert.equal(pub.status, 201);
  assert.equal((await state.a.post("/api/tg/admin/prompts", { name: "x", body: "y" })).status, 403);
  assert.ok(!(await state.a.get("/api/tg/prompts")).json.prompts.some((p) => p.name === `pub-${tag}`), "published but not ticked");
});

// ---------------------------------------------------------------- S4 (org.xlsx: units / members / lists; the full rules are in tests/ce-org-p3.test.mjs)
async function orgPost(c, kind, buffer, digest) {
  const res = await fetch(`${base}/api/tg/admin/org/${kind}${digest ? `?digest=${digest}` : ""}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", Cookie: c.cookie }, body: buffer });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const userCount = async () => (await state.admin.get("/api/tg/admin/users")).json.users.length;
const UH = ["name", "parent", "description", "managers", "confirmers"];
const MH = ["action", "email", "employeeId", "name", "role", "status", "units"];

T("S4: org sheet: preview, apply with the digest, a stale or missing digest is refused", async () => {
  const tag = `T${Math.random().toString(36).slice(2, 6)}`;
  const em = (n) => `${tag.toLowerCase()}${n}@example.com`;
  const file = await buildXlsx([
    { name: "units", rows: [UH, [`${tag}Acme`, "", "Whole company", "", ""], [`${tag}Sales`, `${tag}Acme`, "", em("sam"), ""]] },
    { name: "members", rows: [MH, ["hire", em("sam"), "", `${tag}Sam`, "", "", `${tag}Sales`], ["hire", em("pat"), "", `${tag}Pat`, "", "", `${tag}Sales`]] },
  ]);
  const before = await userCount();
  assert.equal((await orgPost(state.a, "preview", file)).status, 403);
  const preview = await orgPost(state.admin, "preview", file);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.json.errors, []);
  assert.equal(preview.json.summary.hire, 2);
  assert.equal(await userCount(), before, "a preview writes nothing");
  assert.equal((await orgPost(state.admin, "apply", file)).status, 400, "apply without a digest");
  assert.equal((await orgPost(state.admin, "apply", file, "stale")).status, 409);
  const applied = await orgPost(state.admin, "apply", file, preview.json.digest);
  assert.equal(applied.status, 200, applied.text);
  assert.equal(applied.json.initialPasswordsCsv.trim().split("\n").length, 3, "header + two accounts");
  assert.equal(await userCount(), before + 2);
  const groups = (await state.admin.get("/api/tg/admin/groups")).json.groups;
  const sales = groups.find((g) => g.name === `${tag}Sales`);
  assert.equal(sales.parent_id, groups.find((g) => g.name === `${tag}Acme`).id, "the tree is kept");
  const sam = (await state.admin.get("/api/tg/admin/users")).json.users.find((u) => u.email === em("sam"));
  assert.ok(sales.members.some((m) => m.user_id === sam.id && m.is_manager === 1));
  const pw = applied.json.initialPasswordsCsv.split("\n").find((l) => l.startsWith(sam.email)).split(",")[2];
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await new Client(base).login(sam.email, pw)).mustChangePassword, true);
  const rows = (await state.admin.get("/api/tg/admin/audit?action=org.import")).json.rows;
  assert.ok(rows.length >= 1 && /"sha256":"[0-9a-f]{64}"/.test(rows[0].extra));
  assert.ok(!rows.some((r) => r.extra.includes(pw)));
  state.org = { tag, em };
});

T("S4: org sheet: leave disables and keeps the unit; bad files are stopped at the preview", async () => {
  const { tag, em } = state.org;
  const leave = await buildXlsx([{ name: "units", rows: [UH] }, { name: "members", rows: [MH, ["leave", em("pat"), "", "", "", "", ""]] }]);
  const p = await orgPost(state.admin, "preview", leave);
  const first = await orgPost(state.admin, "apply", leave, p.json.digest);
  assert.equal(first.status, 200, first.text);
  const pat = (await state.admin.get("/api/tg/admin/users")).json.users.find((u) => u.email === em("pat"));
  assert.equal(pat.status, "disabled");
  assert.ok(pat.groups.length > 0, "the unit link stays");
  const bad = await buildXlsx([{ name: "units", rows: [UH, [`${tag}X`, "Nowhere", "", "", ""]] }, { name: "members", rows: [MH, ["fire", "x@example.com", "", "X", "", "", ""]] }]);
  const pb = await orgPost(state.admin, "preview", bad);
  assert.ok(pb.json.errors.length >= 2 && pb.json.errors.every((x) => x.sheet && typeof x.row === "number" && x.col));
  assert.equal((await orgPost(state.admin, "apply", bad, "x")).status, 422);
});

// ---------------------------------------------------------------- models: one /v1 endpoint
const modelsTest = (name, fn) => test(name, { skip: !(ready && process.env.TIGERAI_V1_BASE_URL) && "needs TIGERAI_V1_BASE_URL (same value as the server)" }, fn);

modelsTest("models: only the provisioned /v1 provider is offered, and nothing about models can be changed", async () => {
  for (const c of [state.admin, state.a]) {
    const list = (await c.get("/api/models")).json;
    const ids = list.modelList.map((m) => `${m.provider}/${m.id}`);
    assert.ok(ids.length > 0, "the /v1 model list is offered");
    assert.ok(ids.every((i) => i.startsWith("tigerai/")), "no other provider is listed: " + ids.join(","));
  }
  const providers = (await state.admin.get("/api/auth/providers")).json;
  assert.deepEqual([providers.oauthProviders, providers.apiKeyProviders], [[], []], "no OAuth / device-code / key sign-in offered");
  for (const c of [state.admin, state.a]) {
    assert.equal((await c.post("/api/auth/api-key/anthropic", { key: "x" })).status, 403);
    assert.equal((await c.get("/api/auth/login/github-copilot")).status, 403);
    assert.equal((await c.req("PUT", "/api/models-config", { providers: {} })).status, 403);
    assert.equal((await c.post("/api/models/refresh", {})).status, 403);
  }
  assert.equal((await state.a.get("/api/tg/admin/models")).status, 403);
  const status = (await state.admin.get("/api/tg/admin/models")).json;
  assert.equal(status.configured, true);
  assert.ok(status.models.length > 0);
  const keyValue = process.env.TIGERAI_V1_API_KEY_FILE ? (await import("node:fs")).readFileSync(process.env.TIGERAI_V1_API_KEY_FILE, "utf8").trim() : "";
  if (keyValue) assert.ok(!JSON.stringify(status).includes(keyValue) && !(await state.admin.get("/api/models")).text.includes(keyValue), "the key is never returned");
  assert.equal((await state.admin.post("/api/tg/admin/models/refresh", {})).status, 200);
});
