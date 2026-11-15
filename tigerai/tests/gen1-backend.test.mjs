// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Server rules of the gen1 UI batch, against a throw-away database (no server, no pi runtime):
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-backend.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-be-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
for (const k of ["TIGERAI_V1_BASE_URL", "TIGERAI_V1_API_KEY_FILE", "TIGERAI_V1_MODELS"]) delete process.env[k];

const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const rooms = await import("../rooms/service.ts");
const ai = await import("../rooms/ai.ts");
const agents = await import("../agents/service.ts");
const adapter = await import("../adapter/index.ts");
const cmds = await import("../adapter/member-commands.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const alice = mk("alice@example.com", "Alice");   // creator of rooms
const bob = mk("bob@example.com", "Bob");         // member of the rooms
const carol = mk("carol@example.com", "Carol");   // head of Bob's group
const dave = mk("dave@example.com", "Dave");      // head of an unrelated group
const eve = mk("eve@example.com", "Eve");         // outsider
const gSales = acc.createGroup(null, { name: "Sales" });
const gOther = acc.createGroup(null, { name: "Other" });
acc.setMembership(null, gSales.id, bob.id, true);
acc.setMembership(null, gSales.id, carol.id, true, true);
acc.setMembership(null, gOther.id, dave.id, true, true);

async function call(user, method, path, body, headers = {}) {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  const req = new Request(`http://x/api/tg/${path}`, {
    method, headers: { "x-tg-uid": user.id, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const res = await handle(req, segs);
  return { status: res.status, json: await res.json() };
}
const audits = (action) => getDb().prepare("SELECT * FROM audit WHERE action=?").all(action);

// ---------------------------------------------------------------- 11 assignments
test("assignments: create, visibility, accept / complete / return rules", async () => {
  const bad = await call(alice, "POST", "assignments", { title: "x", assigneeId: "nope" });
  assert.equal(bad.status, 400);
  const empty = await call(alice, "POST", "assignments", { title: " ", assigneeId: bob.id });
  assert.equal(empty.status, 400);
  const c = await call(alice, "POST", "assignments", { title: "Send the quote", description: "by Friday", assigneeId: bob.id, dueDate: "2026-12-01" });
  assert.equal(c.status, 201);
  const id = c.json.assignment.id;
  assert.equal(c.json.assignment.status, "open");
  assert.equal(c.json.assignment.assigneeName, "Bob");
  assert.ok(c.json.assignment.dueDate > Date.now());
  // visibility: applicant, assignee, admin yes; others 404
  for (const u of [alice, bob, admin]) assert.equal((await call(u, "GET", `assignments/${id}`)).status, 200);
  assert.equal((await call(eve, "GET", `assignments/${id}`)).status, 404);
  // lists
  assert.equal((await call(alice, "GET", "assignments?scope=mine")).json.assignments.length, 1);
  assert.equal((await call(bob, "GET", "assignments?scope=assigned")).json.assignments.length, 1);
  assert.equal((await call(bob, "GET", "assignments?scope=mine")).json.assignments.length, 0);
  assert.equal((await call(bob, "GET", "assignments?scope=all")).status, 403);
  assert.equal((await call(admin, "GET", "assignments?scope=all")).status, 200);
  // count 待我處理
  assert.equal((await call(bob, "GET", "assignments/count")).json.assigned, 1);
  assert.equal((await call(alice, "GET", "assignments/count")).json.assigned, 0);
  // only the assignee acts (applicant, admin, outsider are refused)
  for (const u of [alice, admin]) assert.equal((await call(u, "POST", `assignments/${id}/accept`)).status, 403);
  assert.equal((await call(eve, "POST", `assignments/${id}/accept`)).status, 404);
  assert.equal((await call(bob, "POST", `assignments/${id}/accept`)).json.assignment.status, "accepted");
  assert.equal((await call(bob, "POST", `assignments/${id}/accept`)).status, 409);
  // return needs a reason
  assert.equal((await call(bob, "POST", `assignments/${id}/return`, { reason: " " })).status, 400);
  const done = await call(bob, "POST", `assignments/${id}/complete`, { note: "sent" });
  assert.equal(done.json.assignment.status, "done");
  assert.equal((await call(bob, "POST", `assignments/${id}/return`, { reason: "late" })).status, 409, "final");
  assert.equal((await call(bob, "GET", "assignments/count")).json.assigned, 0);
  const c2 = await call(alice, "POST", "assignments", { title: "Second", assigneeId: bob.id });
  const r = await call(bob, "POST", `assignments/${c2.json.assignment.id}/return`, { reason: "not mine" });
  assert.equal(r.json.assignment.status, "returned");
  assert.equal(r.json.assignment.returnReason, "not mine");
  for (const a of ["assignment.create", "assignment.accept", "assignment.complete", "assignment.return"]) assert.ok(audits(a).length >= 1, a);
});

test("assignments: a linked conversation must be one the creator may open", async () => {
  const res = await call(alice, "POST", "assignments", { title: "t", assigneeId: bob.id, sessionId: "someone-elses-session" });
  assert.equal(res.status, 403);
});

test("assignments: admin count includes approval work orders waiting (not the admin's own)", async () => {
  const { createOrder } = await import("../workorders/service.ts");
  createOrder("x", alice.id, {});
  assert.equal((await call(admin, "GET", "assignments/count")).json.approvals, 1);
  assert.equal((await call(bob, "GET", "assignments/count")).json.approvals, 0);
});

// ---------------------------------------------------------------- 12 room permissions
let room;
test("rooms: anyone creates; creator is manager; only creator/admin manage members", async () => {
  const c = await call(alice, "POST", "rooms", { name: "Quote team", memberIds: [bob.id] });
  assert.equal(c.status, 201);
  room = c.json.room.id;
  const view = (await call(alice, "GET", `rooms/${room}`)).json;
  assert.equal(view.myRole, "manager");
  assert.equal(view.canPost, true);
  assert.equal((await call(bob, "GET", `rooms/${room}`)).json.myRole, "member");
  assert.equal((await call(bob, "POST", `rooms/${room}/members`, { userId: eve.id })).status, 403, "plain member cannot add");
  assert.equal((await call(eve, "POST", `rooms/${room}/members`, { userId: eve.id })).status, 404);
  assert.equal((await call(alice, "POST", `rooms/${room}/members`, { userId: eve.id })).status, 200);
  assert.equal((await call(bob, "DELETE", `rooms/${room}/members/${eve.id}`)).status, 403);
  assert.equal((await call(alice, "DELETE", `rooms/${room}/members/${eve.id}`)).status, 200);
});

test("rooms: warn / close / reopen allowed for head and admin only; refused for member, manager, outsider and unrelated head", async () => {
  for (const [u, status] of [[bob, 403], [alice, 403], [eve, 404], [dave, 404]]) {
    assert.equal((await call(u, "POST", `rooms/${room}/warn`, { text: "stop" })).status, status, `warn ${u.name}`);
  }
  // v9: the creator (alice) may close and reopen their own room, a plain member and outsiders still may not
  for (const [u, status] of [[bob, 403], [eve, 404], [dave, 404]]) assert.equal((await call(u, "POST", `rooms/${room}/close`)).status, status, `close ${u.name}`);
  assert.equal((await call(carol, "POST", `rooms/${room}/warn`, { text: "" })).status, 400);
  assert.equal((await call(carol, "POST", `rooms/${room}/warn`, { text: "Final warning: keep it civil" })).status, 201);
  const msgs = (await call(bob, "GET", `rooms/${room}`)).json.messages;
  assert.ok(msgs.some((m) => m.kind === "warning" && m.text.includes("Final warning")), "warning is stored in the room");
  assert.equal((await call(carol, "POST", `rooms/${room}/close`)).status, 200);
  assert.equal((await call(carol, "POST", `rooms/${room}/close`)).status, 409);
  const closed = (await call(bob, "GET", `rooms/${room}`)).json;
  assert.equal(closed.closed, true);
  assert.equal(closed.canPost, false);
  assert.equal((await call(bob, "POST", `rooms/${room}/reopen`)).status, 403);
  assert.equal((await call(alice, "POST", `rooms/${room}/reopen`)).status, 200, "the creator reopens their own room");
  assert.equal((await call(alice, "POST", `rooms/${room}/close`)).status, 200, "and closes it again");
  // closed: posting refused for members, member changes refused, @AI does not answer
  assert.equal((await call(bob, "POST", `rooms/${room}/messages`, { text: "hello" })).status, 409);
  assert.equal((await call(alice, "POST", `rooms/${room}/messages`, { text: "@AI hi" })).status, 409);
  assert.equal((await call(alice, "POST", `rooms/${room}/members`, { userId: eve.id })).status, 409);
  assert.equal((await call(bob, "POST", `rooms/${room}/ai`)).status, 409);
  ai.enqueueAi(room, bob.id, 1, "@AI queued before close");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM room_messages WHERE room_id=? AND kind='ai'").get(room).n, 0, "queued AI job is dropped in a closed room");
  // a warning still works in a closed room
  assert.equal((await call(admin, "POST", `rooms/${room}/warn`, { text: "closed by head" })).status, 201);
  assert.equal((await call(admin, "POST", `rooms/${room}/reopen`)).status, 200);
  assert.equal((await call(bob, "POST", `rooms/${room}/messages`, { text: "back again" })).status, 201);
  for (const a of ["room.warn", "room.close", "room.reopen"]) assert.ok(audits(a).length >= 1, a);
});

test("rooms: a head reads as head-viewer (audited once per hour), cannot post until joining; admin joins; plain outsider cannot", async () => {
  const v = (await call(carol, "GET", `rooms/${room}`)).json;
  // carol is in the same group as bob; she is head but not a member of the room
  assert.equal(v.myRole, "head-viewer");
  assert.equal(v.isMember, false);
  assert.equal(v.canPost, false);
  assert.equal(v.canJoin, true);
  assert.equal(v.can.warn, true);
  assert.equal((await call(carol, "POST", `rooms/${room}/messages`, { text: "hi" })).status, 403);
  await call(carol, "GET", `rooms/${room}`);
  await call(carol, "GET", `rooms/${room}`);
  assert.equal(audits("room.head_view").filter((a) => a.actor_id === carol.id).length, 1, "one audit per head per room per hour");
  assert.equal((await call(eve, "POST", `rooms/${room}/join`)).status, 404);
  assert.equal((await call(dave, "POST", `rooms/${room}/join`)).status, 404);
  const a = (await call(admin, "GET", `rooms/${room}`)).json;
  assert.equal(a.myRole, "admin");
  assert.equal(a.canPost, false);
  assert.equal(a.canJoin, true);
  assert.equal((await call(admin, "POST", `rooms/${room}/join`)).status, 200);
  assert.equal((await call(admin, "GET", `rooms/${room}`)).json.canPost, true);
  assert.equal((await call(carol, "POST", `rooms/${room}/join`)).status, 200);
  assert.equal((await call(carol, "GET", `rooms/${room}`)).json.myRole, "head");
});

test("rooms: delete is admin only; soft; hidden from all; restore; 30-day purge", async () => {
  const r = (await call(alice, "POST", "rooms", { name: "Doomed", memberIds: [bob.id] })).json.room.id;
  await call(bob, "POST", `rooms/${r}/messages`, { text: "keep?" });
  for (const u of [bob, alice, carol, eve]) assert.ok([403, 404].includes((await call(u, "DELETE", `rooms/${r}`)).status), `delete ${u.name}`);
  assert.equal((await call(alice, "GET", `rooms/${r}`)).status, 200, "still there");
  assert.equal((await call(admin, "DELETE", `rooms/${r}`)).status, 200);
  assert.equal(audits("room.delete").length, 1);
  for (const u of [bob, alice, carol]) {
    assert.equal((await call(u, "GET", `rooms/${r}`)).status, 404);
    assert.ok(!(await call(u, "GET", "rooms")).json.rooms.some((x) => x.id === r));
  }
  assert.ok(!(await call(admin, "GET", "rooms")).json.rooms.some((x) => x.id === r), "not in the admin list either");
  const dv = (await call(admin, "GET", `rooms/${r}`)).json;
  assert.equal(dv.deleted, true); assert.equal(dv.canPost, false);
  assert.equal((await call(bob, "POST", `rooms/${r}/messages`, { text: "x" })).status, 404);
  // deleted list / restore are admin only
  assert.equal((await call(bob, "GET", "admin/rooms/deleted")).status, 403);
  assert.equal((await call(bob, "POST", `admin/rooms/${r}/restore`)).status, 403);
  const list = (await call(admin, "GET", "admin/rooms/deleted")).json.rooms;
  assert.equal(list.length, 1); assert.equal(list[0].daysLeft, 30); assert.equal(list[0].deletedByName, "Admin");
  assert.equal((await call(admin, "POST", `admin/rooms/${r}/restore`)).status, 200);
  assert.equal((await call(bob, "GET", `rooms/${r}`)).status, 200);
  assert.ok(audits("room.restore").length === 1);
  // delete again, age it past 30 days: purged on the next read; restore then fails
  await call(admin, "DELETE", `rooms/${r}`);
  getDb().prepare("UPDATE rooms SET deleted_at=? WHERE id=?").run(Date.now() - 31 * 86400_000, r);
  assert.equal((await call(admin, "GET", "admin/rooms/deleted")).json.rooms.length, 0);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM rooms WHERE id=?").get(r).n, 0);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM room_messages WHERE room_id=?").get(r).n, 0, "messages are purged too");
  assert.equal((await call(admin, "POST", `admin/rooms/${r}/restore`)).status, 404);
  assert.equal(audits("room.purge").length, 1);
  // the append-only guard is back in place after a purge
  assert.throws(() => getDb().prepare("DELETE FROM room_messages WHERE room_id=?").run(room));
  // 29 days is still restorable
  const r2 = (await call(alice, "POST", "rooms", { name: "Almost" })).json.room.id;
  await call(admin, "DELETE", `rooms/${r2}`);
  getDb().prepare("UPDATE rooms SET deleted_at=? WHERE id=?").run(Date.now() - 29 * 86400_000, r2);
  assert.equal((await call(admin, "POST", `admin/rooms/${r2}/restore`)).status, 200);
});

test("rooms: members reach the closed/deleted flags in the list, system lines are not unread", async () => {
  const list = (await call(bob, "GET", "rooms")).json.rooms.find((x) => x.id === room);
  assert.equal(list.isMember, true);
  assert.equal(typeof list.closed, "boolean");
});

// ---------------------------------------------------------------- 7 read pointer
test("read: unread counts, ?read=1 and POST /read move the pointer forward only; non-members get no unread", async () => {
  const r = (await call(alice, "POST", "rooms", { name: "Read me", memberIds: [bob.id] })).json.room.id;
  await call(alice, "POST", `rooms/${r}/messages`, { text: "one" });
  await call(alice, "POST", `rooms/${r}/messages`, { text: "two" });
  const unread = async (u) => (await call(u, "GET", "rooms")).json.rooms.find((x) => x.id === r)?.unread;
  assert.equal(await unread(bob), 2);
  assert.equal(await unread(alice), 0, "own messages are read");
  assert.equal(await unread(admin), 0, "an admin who is not a member has no unread");
  // opening with read=1 marks it read; later messages seen while viewing keep it at 0
  await call(bob, "GET", `rooms/${r}?read=1`);
  assert.equal(await unread(bob), 0);
  await call(alice, "POST", `rooms/${r}/messages`, { text: "three" });
  assert.equal(await unread(bob), 1);
  const seen = await call(bob, "GET", `rooms/${r}?after=0&read=1`);
  assert.equal(seen.status, 200);
  assert.equal(await unread(bob), 0);
  await call(alice, "POST", `rooms/${r}/messages`, { text: "four" });
  assert.deepEqual((await call(bob, "POST", `rooms/${r}/read`, {})).json, { ok: true, unread: 0 });
  assert.equal(await unread(bob), 0);
  // an old seq never moves the pointer back
  await call(bob, "POST", `rooms/${r}/read`, { seq: 1 });
  assert.equal(await unread(bob), 0);
  // an outsider's read call changes nothing and reveals nothing
  assert.equal((await call(eve, "POST", `rooms/${r}/read`, {})).status, 404);
});

// ---------------------------------------------------------------- 13 roomOnly
test("sessions/:id/info: roomOnly for a channel's own conversation, not for a personal one", async () => {
  const r = (await call(alice, "POST", "rooms", { name: "Has AI", memberIds: [bob.id] })).json.room.id;
  const { registerOwner } = await import("../rooms/ownership.ts");
  registerOwner("s-room", alice.id, "/x", "room-ai", r);
  registerOwner("s-mine", bob.id, "/y", "chat", null);
  assert.deepEqual((await call(bob, "GET", "sessions/s-room/info")).json, { roomOnly: true, roomId: r });
  assert.deepEqual((await call(bob, "GET", "sessions/s-mine/info")).json, { roomOnly: false, roomId: null });
  assert.equal((await call(eve, "GET", "sessions/s-room/info")).status, 404);
  assert.equal((await call(eve, "GET", "sessions/s-mine/info")).status, 404);
});

// ---------------------------------------------------------------- /me, n8n apps
test("me carries isHead; n8n apps follow the group ticks", async () => {
  assert.equal((await call(carol, "GET", "me")).json.isHead, true);
  assert.equal((await call(bob, "GET", "me")).json.isHead, false);
  assert.equal((await call(bob, "GET", "me")).json.canCreateRoom, true);
  const svc = await import("../n8n/service.ts");
  svc.saveWebhook(admin.id, { name: "quote", url: "http://n8n.local/webhook/q", description: "做報價", group_ids: [gSales.id] });
  const names = async (u) => (await call(u, "GET", "n8n/apps")).json.apps.map((a) => a.name);
  assert.deepEqual(await names(bob), ["quote"]);
  assert.deepEqual(await names(eve), []);
  assert.deepEqual(await names(admin), ["quote"]);
  const app = (await call(bob, "GET", "n8n/apps")).json.apps[0];
  assert.deepEqual(Object.keys(app).sort(), ["description", "id", "kind", "label", "name"], "no url or secret leaves the server");
});

// ---------------------------------------------------------------- 15 model settings
test("models: admin only; key goes to a mode-600 file and only its last 4 come back; test, gateway list, overrides", async () => {
  const gw = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer sk-secret-ABCD1234") { res.statusCode = 401; return res.end("{}"); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "m-fast", context_length: 16000 }, { id: "m-big", context_length: 64000, max_output_tokens: 8000 }, { id: "m-old" }] }));
  });
  await new Promise((r) => gw.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${gw.address().port}/v1`;
  try {
    for (const [m, p, b] of [["GET", "admin/models"], ["PUT", "admin/models", {}], ["POST", "admin/models/test", {}], ["GET", "admin/models/gateway"]])
      assert.equal((await call(bob, m, p, b)).status, 403, `${m} ${p}`);
    assert.equal((await call(admin, "PUT", "admin/models", { baseUrl: "ftp://x" })).json.code, "bad_url");
    assert.equal((await call(admin, "PUT", "admin/models", { baseUrl: "http://u:p@x/v1" })).json.code, "bad_url");
    // wrong key: the test reports failure in the body
    await call(admin, "PUT", "admin/models", { baseUrl: base, apiKey: "sk-wrong-0000" });
    assert.equal((await call(admin, "POST", "admin/models/test", {})).json.ok, false);
    const saved = await call(admin, "PUT", "admin/models", { apiKey: "sk-secret-ABCD1234" });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.keyLast4, "1234");
    assert.equal(saved.json.hasKey, true);
    assert.ok(!JSON.stringify(saved.json).includes("sk-secret"), "the key is never returned");
    const keyPath = join(process.env.TIGERAI_DATA_DIR, "v1-api-key");
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(process.env.TIGERAI_DATA_DIR, "models-settings.json")).mode & 0o777, 0o600);
    assert.ok(!readFileSync(join(process.env.TIGERAI_DATA_DIR, "models-settings.json"), "utf8").includes("sk-secret"));
    const t = (await call(admin, "POST", "admin/models/test", {})).json;
    assert.equal(t.ok, true); assert.equal(t.models, 3);
    assert.ok(!JSON.stringify(t).includes("sk-secret"));
    const g = (await call(admin, "GET", "admin/models/gateway")).json.models;
    assert.deepEqual(g.map((m) => m.id), ["m-fast", "m-big", "m-old"]);
    assert.equal(g[1].contextWindow, 64000); assert.equal(g[1].maxTokens, 8000); assert.equal(g[2].contextWindow, null);
    // overrides may lower, never exceed the gateway
    assert.equal((await call(admin, "PUT", "admin/models", { overrides: { "m-fast": { contextWindow: 32000 } } })).json.code, "override_too_high");
    // offered set + default + overrides, applied at once to models.json (read by the next message, no restart)
    const upd = await call(admin, "PUT", "admin/models", { offered: ["m-fast", "m-big"], defaultModel: "m-big", overrides: { "m-big": { contextWindow: 48000, maxTokens: 2000 } } });
    assert.equal(upd.status, 200);
    assert.equal((await call(admin, "PUT", "admin/models", { defaultModel: "m-old" })).json.code, "bad_default", "default must be offered");
    const cfg = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), "utf8")).providers.tigerai;
    assert.deepEqual(cfg.models.map((m) => m.id), ["m-fast", "m-big"]);
    assert.equal(cfg.models[1].contextWindow, 48000);
    assert.equal(cfg.models[1].maxTokens, 2000);
    assert.equal(cfg.models[0].contextWindow, 16000, "no override: what the gateway reports (v9)"); assert.equal(cfg.models[0].maxTokens, 8000, "default output capped at half the context");
    assert.equal(JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), "utf8")).defaultModel, "m-big");
    assert.ok(!readFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), "utf8").includes("sk-secret"), "models.json refers to the key by name only");
    // removing the key
    const gone = (await call(admin, "PUT", "admin/models", { apiKey: null })).json;
    assert.equal(gone.hasKey, false);
    assert.equal(existsSync(join(process.env.TIGERAI_DATA_DIR, "v1-api-key")), false);
    assert.ok(audits("models.update").length >= 4);
    assert.ok(!audits("models.update").some((a) => String(a.extra).includes("sk-")));
  } finally { gw.close(); }
});

// ---------------------------------------------------------------- members cannot change models
test("member commands: every model / thinking command is refused, upstream list cross-checked", () => {
  const upstream = readFileSync(new URL("../../lib/rpc-manager.ts", import.meta.url), "utf8");
  const cases = [...upstream.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
  const modelish = cases.filter((c) => /model|thinking/.test(c));
  assert.ok(modelish.includes("set_model") && modelish.includes("set_thinking_level"), "found the upstream model commands");
  for (const c of modelish) assert.ok(cmds.MODEL_COMMANDS.includes(c), `upstream command ${c} must be on the model list`);
  for (const c of ["set_model", "cycle_model", "set_thinking_level", "cycle_thinking_level", "set_scoped_models"]) {
    assert.ok(cmds.memberCommandDenied({ type: c }, cmds.MEMBER_COMMANDS)?.startsWith("model_locked"), c);
    assert.ok(cmds.memberCommandDenied({ type: c }, cmds.MEMBER_NEW_COMMANDS)?.startsWith("model_locked"), `${c} on new`);
    assert.ok(!cmds.MEMBER_COMMANDS.has(c));
  }
  for (const c of ["prompt", "abort", "get_state", "compact"]) assert.equal(cmds.memberCommandDenied({ type: c }, cmds.MEMBER_COMMANDS), null, c);
  for (const c of ["bash", "set_tools", "fork", "clone"]) assert.ok(cmds.memberCommandDenied({ type: c }, cmds.MEMBER_COMMANDS)?.startsWith("Command not available"), c);
});

test("member commands: model fields on a prompt or a new conversation are refused; without them it passes", () => {
  for (const extra of [{ provider: "p", modelId: "m" }, { modelId: "m" }, { thinkingLevel: "high" }, { model: "x" }])
    for (const set of [cmds.MEMBER_NEW_COMMANDS, cmds.MEMBER_COMMANDS])
      assert.ok(cmds.memberCommandDenied({ type: "prompt", message: "hi", ...extra }, set)?.startsWith("model_locked"), JSON.stringify(extra));
  assert.equal(cmds.memberCommandDenied({ type: "prompt", message: "hi", cwd: "/x" }, cmds.MEMBER_NEW_COMMANDS), null);
  assert.ok(cmds.memberCommandDenied(null, cmds.MEMBER_NEW_COMMANDS));
  const gate = readFileSync(new URL("../adapter/gate.ts", import.meta.url), "utf8");
  assert.match(gate, /memberCommandDenied\(await req\.clone\(\)\.json\(\), allowed\)/);
  assert.ok(!/"set_model"/.test(gate), "gate.ts keeps no private command list");
});

// ---------------------------------------------------------------- AI role conversations
test("role start: header x-agent-role — allowed, not allowed, unknown, absent; admin audit; model from the role", async () => {
  const open = agents.createAgent(admin.id, { name: "Quoter", model: { provider: "tigerai", modelId: "m-big" } });
  const sales = agents.createAgent(admin.id, { name: "SalesOnly", group_ids: [gSales.id] });
  const hdr = (user, role) => new Request("http://x/api/agent/new", { method: "POST", headers: { "x-tg-uid": user.id, ...(role ? { "x-agent-role": role } : {}) } });
  assert.equal(await adapter.pendingRoleFor(hdr(bob), "__new__1"), undefined, "no header: upstream behaviour");
  const ok = await adapter.pendingRoleFor(hdr(bob, open.id), "__new__2");
  assert.deepEqual(ok, { initialModel: { provider: "tigerai", modelId: "m-big" } });
  const { roleForSession } = await import("../agents/runtime.ts");
  assert.equal(roleForSession("__new__2")?.id, open.id, "registered for the temp key");
  assert.deepEqual(await adapter.pendingRoleFor(hdr(bob, sales.id), "__new__4"), {}, "bob is in Sales: allowed, the role has no model");
  for (const [u, role] of [[eve, sales.id], [bob, "a-unknown"], [eve, "a-unknown"]]) {
    const res = await adapter.pendingRoleFor(hdr(u, role), "__new__5");
    assert.ok(res instanceof Response && res.status === 403, `${u.name} ${role}`);
    assert.equal(roleForSession("__new__5"), null, "nothing registered on refusal");
  }
  // a disabled role is not available either
  agents.updateAgent(admin.id, open.id, { name: "Quoter", enabled: false });
  assert.equal((await adapter.pendingRoleFor(hdr(bob, open.id), "__new__6")).status, 403);
  agents.updateAgent(admin.id, open.id, { name: "Quoter", enabled: true, model: { provider: "tigerai", modelId: "m-big" } });
  // once the session exists the role is remembered for reloads, and the start is audited
  await adapter.onSessionCreated(hdr(bob, open.id), "real-session-1", join(process.env.TIGERAI_DATA_DIR, "workspace", "users", bob.id));
  assert.equal(roleForSession("real-session-1")?.id, open.id);
  assert.equal(audits("role.session_start").filter((a) => a.actor_id === bob.id).length, 1);
  // a refused role never lands in session_roles
  await adapter.onSessionCreated(hdr(eve, sales.id), "real-session-2", "/x");
  assert.equal(roleForSession("real-session-2"), null);
});

test("role start: the upstream hook keeps a 403 from falling back to a plain conversation", () => {
  const route = readFileSync(new URL("../../app/api/agent/new/route.ts", import.meta.url), "utf8");
  const a = route.indexOf("pendingRoleFor(req, tempKey)");
  const b = route.indexOf("if (tgRole instanceof Response) return tgRole");
  const c = route.indexOf("startRpcSession(tempKey");
  assert.ok(a > 0 && a < b && b < c, "refusal returns before any session is started");
  assert.match(route, /\.\.\.tgRole, \/\/ TG-HOOK:H06/);
});

// ---------------------------------------------------------------- workspace labels
test("workspace labels: own folder and groups for a member, everyone's for an admin", async () => {
  const { workspaceLabels } = await import("../adapter/labels.ts");
  const { personalDir } = await import("../workspace.ts");
  const m = workspaceLabels({ id: bob.id, role: "member" });
  assert.equal(m[personalDir(bob.id)], "Bob 的工作區");
  assert.equal(m[personalDir(alice.id)], undefined);
  assert.ok(Object.values(m).includes("Sales 的工作區"));
  assert.ok(!Object.values(m).includes("Other 的工作區"));
  const a = workspaceLabels({ id: admin.id, role: "admin" });
  assert.equal(a[personalDir(alice.id)], "Alice 的工作區");
  assert.ok(Object.values(a).includes("Other 的工作區"));
});

// ---------------------------------------------------------------- first-time member: own workspace folder
test("first login: /me creates the personal folder; the sidebar state lists it with the person's name", async () => {
  const { workspaceRoot } = await import("../config.ts");
  const { join } = await import("node:path");
  const frank = mk("frank@example.com", "Frank");
  const dir = join(workspaceRoot(), "users", frank.id);
  const { rmSync } = await import("node:fs");
  rmSync(dir, { recursive: true, force: true }); // an account created before this feature has no folder yet
  assert.equal(existsSync(dir), false);
  const me = await call(frank, "GET", "me");
  assert.equal(me.status, 200);
  assert.equal(existsSync(dir), true, "created on first /me");
  const req = new Request("http://x/api/sessions/ui-state", { headers: { "x-tg-uid": frank.id } });
  const state = await adapter.filterUiState(req, { version: 1, revision: 0, sessions: {}, projects: {} });
  assert.ok(state.projects[dir], "own folder listed as a project");
  assert.equal(state.projectNames[dir], "Frank 的工作區");
  assert.equal(Object.keys(state.projects).filter((k) => k !== dir).length, 0, "nobody else's folder");
});

// ---------------------------------------------------------------- one name, one room in a person's list
test("a second room with the same name (any case) is refused; another person's list is unaffected", async () => {
  const a = await call(alice, "POST", "rooms", { name: "Dup talk" });
  assert.equal(a.status, 201);
  const again = await call(alice, "POST", "rooms", { name: "dup TALK" });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "exists");
  assert.equal((await call(eve, "POST", "rooms", { name: "Dup talk" })).status, 201, "a stranger's room is not in her list");
  assert.equal((await call(admin, "POST", "rooms", { name: "Dup talk" })).status, 409, "an admin sees every room, so the name is taken");
});
