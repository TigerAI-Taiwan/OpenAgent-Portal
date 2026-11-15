// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Community edition feature A: personal model connections ("我的模型連線").
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-byok.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "tg-ce-byok-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_PERSONAL_ALLOW_PRIVATE = "1"; // the fake endpoints below listen on 127.0.0.1
for (const k of ["TIGERAI_V1_BASE_URL", "TIGERAI_V1_API_KEY_FILE", "TIGERAI_V1_MODELS", "TIGERAI_V1_DEFAULT_MODEL"]) delete process.env[k];
mkdirSync(process.env.TIGERAI_DATA_DIR, { recursive: true });

const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const st = await import("../provider/settings.ts");
const pe = await import("../provider/personal.ts");
const pr = await import("../provider/personal-runtime.ts");
const fb = await import("../provider/fallback-runtime.ts");
const lg = await import("../provider/fallback-logic.ts");
const mc = await import("../adapter/member-commands.ts");
const { mergeModelList } = await import("../api/personal.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const adapter = await import("../adapter/index.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const alice = mk("alice@example.com", "Alice");
const bob = mk("bob@example.com", "Bob");

async function call(user, method, path, body) {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  const req = new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await handle(req, segs);
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}
const audits = (prefix) => getDb().prepare("SELECT * FROM audit WHERE action LIKE ?").all(`${prefix}%`);
const endpoint = (models, key) => new Promise((resolve) => {
  const s = createServer((req, res) => {
    if (key && req.headers.authorization !== `Bearer ${key}`) { res.statusCode = 401; return res.end("{}"); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
  });
  s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${s.address().port}/v1`, close: () => s.close() }));
});

const ALICE_KEY = "sk-alice-SECRET-1234567890abcd";
let aliceConn; let ep;

test("a person adds a connection; the key is never in any response, audit row or log, and its file is mode 600", async () => {
  ep = await endpoint(["gpt-mini", "gpt-big"], ALICE_KEY);
  const t = await call(alice, "POST", "personal-models/test", { baseUrl: ep.url, apiKey: ALICE_KEY });
  assert.equal(t.json.ok, true); assert.deepEqual(t.json.ids, ["gpt-mini", "gpt-big"]);
  const bad = await call(alice, "POST", "personal-models/test", { baseUrl: ep.url, apiKey: "sk-wrong-000000000000" });
  assert.equal(bad.json.ok, false); assert.ok(!bad.text.includes("sk-wrong"), "a failed test does not echo the key");

  const r = await call(alice, "POST", "personal-models", { name: "我的 OpenAI", baseUrl: ep.url, apiKey: ALICE_KEY, models: "gpt-mini, gpt-big" });
  assert.equal(r.status, 201);
  aliceConn = r.json.connections[0];
  assert.match(aliceConn.id, /^tgp-[0-9a-f]{8}-[0-9a-f]{8}$/);
  assert.equal(aliceConn.hasKey, true); assert.equal(aliceConn.keyLast4, "abcd");
  assert.ok(!r.text.includes(ALICE_KEY) && !r.text.includes("SECRET"), "the add response has no key");
  const list = await call(alice, "GET", "personal-models");
  assert.ok(!list.text.includes("SECRET")); assert.equal(list.json.connections.length, 1);
  const me = await call(alice, "GET", "me");
  assert.equal(me.json.personalModels, 1);

  // files: directory 700, key file 600, connection list holds no key
  const udir = join(process.env.TIGERAI_DATA_DIR, "personal-models", alice.id);
  assert.equal(statSync(udir).mode & 0o777, 0o700);
  const keyFile = readdirSync(udir).find((f) => f.startsWith("key-"));
  assert.equal(statSync(join(udir, keyFile)).mode & 0o777, 0o600);
  assert.equal(statSync(join(udir, "connections.json")).mode & 0o777, 0o600);
  assert.ok(!readFileSync(join(udir, "connections.json"), "utf8").includes("SECRET"));

  // audit: only add / change / delete, never the key
  const rows = audits("model.personal");
  assert.equal(rows.length, 1); assert.equal(rows[0].action, "model.personal.add"); assert.equal(rows[0].actor_id, alice.id);
  assert.ok(!JSON.stringify(rows).includes("SECRET"));
  const upd = await call(alice, "PATCH", `personal-models/${aliceConn.id}`, { apiKey: "sk-alice-NEW-9999999999wxyz" });
  assert.equal(upd.json.connections[0].keyLast4, "wxyz"); assert.ok(!upd.text.includes("NEW-9999"));
  assert.ok(!JSON.stringify(audits("model.personal")).includes("NEW-9999"));
  assert.equal(pe.personalKey(alice.id, aliceConn.id), "sk-alice-NEW-9999999999wxyz");
  await call(alice, "PATCH", `personal-models/${aliceConn.id}`, { apiKey: ALICE_KEY });
});

test("owner only: other people cannot list, edit, delete or use it; the admin sees a count and nothing else", async () => {
  const b = await call(bob, "GET", "personal-models");
  assert.deepEqual(b.json.connections, []);
  assert.equal((await call(bob, "PATCH", `personal-models/${aliceConn.id}`, { name: "mine now" })).status, 404);
  assert.equal((await call(bob, "DELETE", `personal-models/${aliceConn.id}`)).status, 404);
  assert.equal((await call(admin, "DELETE", `personal-models/${aliceConn.id}`)).status, 404, "an administrator is not the owner either");
  assert.equal((await call(bob, "POST", "personal-models/test", { id: aliceConn.id })).json.ok, false, "testing someone else's saved connection fails");
  assert.equal(pe.userOwnsProvider(alice.id, aliceConn.id), true);
  for (const u of [bob, admin]) assert.equal(pe.userOwnsProvider(u.id, aliceConn.id), false);
  assert.equal(pe.userOwnsProvider(alice.id, "tgp-00000000-abcdef12"), false, "an id that is only shaped like ours is not owned");

  const a = await call(admin, "GET", "admin/models/personal");
  assert.deepEqual(a.json.people, [{ userId: alice.id, name: "Alice", count: 1 }]);
  assert.ok(!a.text.includes(ep.url) && !a.text.includes("gpt-mini") && !a.text.includes("SECRET"), "an administrator sees a count, not an address, model or key");
  assert.equal((await call(bob, "GET", "admin/models/personal")).status, 403);
  assert.equal((await call(bob, "PUT", "admin/models/personal", { allow: false })).status, 403);
});

test("the model picker list: 「我的」 only for its owner; a member's list holds only their own models; admins keep the public ones", () => {
  const upstream = {
    models: { "tigerai:fast": "fast" }, modelList: [{ id: "fast", name: "fast", provider: "tigerai", providerName: "TigerAI Models" }],
    defaultModel: { provider: "tigerai", modelId: "fast" }, thinkingLevels: { "tigerai:fast": ["off", "low"] },
  };
  const mineMember = mergeModelList(upstream, { id: alice.id, role: "member" });
  assert.deepEqual(mineMember.modelList.map((m) => `${m.provider === aliceConn.id ? "mine" : m.provider}/${m.id}`), ["mine/gpt-mini", "mine/gpt-big"]);
  assert.equal(mineMember.modelList[0].providerName, "我的 · 我的 OpenAI");
  assert.deepEqual(mineMember.defaultModel, upstream.defaultModel, "the school's model stays the start model while it is open to them");
  const forBob = mergeModelList(upstream, { id: bob.id, role: "member" });
  assert.deepEqual(forBob.modelList, [], "Bob has nothing of his own: nothing of Alice's, and no public model in a member's list");
  const forAdmin = mergeModelList(upstream, { id: admin.id, role: "admin" });
  assert.deepEqual(forAdmin.modelList.map((m) => m.provider), ["tigerai"]);
  assert.ok(!JSON.stringify(mergeModelList(upstream, { id: bob.id, role: "member" })).includes(aliceConn.id));
});

test("the gate: a member may pick their own model (set_model, new conversation) and nothing else; another person's id is refused for every role", async () => {
  const ownModel = (u) => (p, m) => !!m && pe.userOwnsProvider(u.id, p);
  const allowed = new Set(["prompt", "ensure_session"]);
  assert.equal(mc.memberCommandDenied({ type: "set_model", provider: aliceConn.id, modelId: "gpt-mini" }, new Set(), ownModel(alice)), null);
  assert.match(mc.memberCommandDenied({ type: "set_model", provider: aliceConn.id, modelId: "gpt-mini" }, new Set(), ownModel(bob)), /model_locked/);
  assert.match(mc.memberCommandDenied({ type: "set_model", provider: "tigerai", modelId: "fast" }, new Set(), ownModel(alice)), /model_locked/, "public models stay locked for members");
  assert.match(mc.memberCommandDenied({ type: "set_model", provider: aliceConn.id, modelId: "gpt-mini" }, new Set()), /model_locked/, "no policy = upstream rule");
  assert.match(mc.memberCommandDenied({ type: "set_model", provider: aliceConn.id, modelId: "gpt-mini", thinkingLevel: "high" }, new Set(), ownModel(alice)), /model_locked/);
  assert.match(mc.memberCommandDenied({ type: "set_thinking_level", level: "high" }, allowed, ownModel(alice)), /model_locked/);
  assert.equal(mc.memberCommandDenied({ type: "prompt", message: "hi", provider: aliceConn.id, modelId: "gpt-big" }, allowed, ownModel(alice)), null);
  assert.match(mc.memberCommandDenied({ type: "prompt", message: "hi", provider: aliceConn.id, modelId: "gpt-big" }, allowed, ownModel(bob)), /model_locked/);

  const { gate } = await import("../adapter/gate.ts");
  const { NextRequest } = await import("next/server");
  const { createSessionCookie, SESSION_COOKIE } = await import("../accounts/session.ts");
  const ck = (u) => `${SESSION_COOKIE}=${createSessionCookie(u.id, acc.userById(u.id).token_version)}`;
  const post = (u, path, body) => gate(new NextRequest(`http://x${path}`, { method: "POST", headers: { cookie: ck(u), "content-type": "application/json" }, body: JSON.stringify(body) }), false);
  for (const u of [bob, admin]) {
    const r = await post(u, "/api/agent/new", { cwd: "/tmp", type: "prompt", message: "x", provider: aliceConn.id, modelId: "gpt-mini" });
    assert.equal(r.status, 403, `${u.name} naming Alice's provider on a new conversation`);
    assert.match((await r.json()).error, /personal_forbidden/);
    const r2 = await post(u, "/api/agent/abc123", { type: "set_model", provider: aliceConn.id, modelId: "gpt-mini" });
    assert.equal(r2.status, 403, `${u.name} set_model with Alice's provider`);
  }
  // the owner passes the gate for their own id (an unknown conversation id then fails on ownership, not on this rule)
  const own = await post(alice, "/api/agent/new", { cwd: "/tmp", type: "ensure_session", provider: aliceConn.id, modelId: "gpt-mini" });
  assert.notEqual((await own.clone().json().catch(() => ({}))).error?.slice?.(0, 8), "personal_", "the owner is not refused by the personal rule");

  // an administrator may not send into someone else's conversation while that person has personal connections
  getDb().prepare("INSERT OR IGNORE INTO session_owner (session_id,user_id,cwd,kind,room_id,created_at) VALUES (?,?,?,?,?,?)").run("s-alice", alice.id, "/tmp", "chat", null, Date.now());
  const foreign = await post(admin, "/api/agent/s-alice", { type: "prompt", message: "hello" });
  assert.equal(foreign.status, 403); assert.match((await foreign.json()).error, /personal_session/);
  const abort = await post(admin, "/api/agent/s-alice", { type: "abort" });
  assert.notEqual(abort.status, 403, "reading / aborting stays possible for an administrator");

  // the model list is rewritten for someone who has connections, and only for them
  const get = (u) => gate(new NextRequest("http://x/api/models?cwd=/tmp", { headers: { cookie: ck(u) } }), false);
  assert.match((await get(alice)).headers.get("x-middleware-rewrite") ?? "", /\/api\/tg\/model-list\?cwd=/);
  assert.equal((await get(bob)).headers.get("x-middleware-rewrite"), null, "no connection, no rewrite: upstream behaviour");
});

test("channel @AI, room assistants, automations and other people's conversations never get a personal extension", async () => {
  const ext = (key, cwd) => pr.personalExtensionsFor(key, cwd).length;
  // an ordinary conversation of Alice: yes (owner row kind chat), reopened
  registerOwner("s-chat", alice.id, "/w/users/alice", "chat", null);
  assert.equal(ext("s-chat", "/w/users/alice"), 1);
  registerOwner("s-fork", alice.id, "/w/users/alice", "fork", null);
  assert.equal(ext("s-fork"), 1);
  // the room's conversations, however they were started
  registerOwner("s-room-ai", alice.id, "/w/rooms/r1", "room-ai", "r1");
  registerOwner("s-room-role", alice.id, "/w/rooms/r1", "room-role", "r1");
  registerOwner("s-chat-in-room", alice.id, "/w/rooms/r1", "chat", "r1");
  registerOwner("s-wizard", alice.id, "/w/users/alice", "wizard", "r1");
  registerOwner("s-hook", alice.id, "/w/hooks", "hook", null);
  for (const k of ["s-room-ai", "s-room-role", "s-chat-in-room", "s-wizard", "s-hook"]) assert.equal(ext(k, "/w/users/alice"), 0, k);
  assert.equal(ext("s-unknown"), 0, "no owner row: nobody's connections");
  assert.equal(ext("__new__zzz", "/w/users/alice"), 0, "a temporary key nobody registered");
  // the HTTP start hook registers the person for their temporary key, except inside a room folder
  pr.registerPendingOwner("__new__alice", alice.id);
  assert.equal(ext("__new__alice", "/w/users/alice"), 1);
  assert.equal(ext("__new__alice", "/w/rooms/r1"), 0, "a conversation started inside a channel folder");
  // the assistant of a room: the real room start path (rooms/ai.ts) registers no pending owner, so the same temporary key shape yields nothing
  assert.equal(ext(`__new__room-${Date.now()}`, "/w/rooms/r1"), 0);
  // the owner must be active
  const gone = mk("gone@example.com", "Gone");
  assert.equal(acc.userById(gone.id).status, "active");
});

test("startExtensions (the adapter hook) includes it for the owner's own conversation only", () => {
  const names = (key, cwd) => adapter.startExtensions({ sessionId: key, cwd }).map((e) => e.name);
  assert.ok(names("s-chat", "/w/users/alice").includes("tigerai-personal-models"));
  assert.ok(!names("s-room-ai", "/w/rooms/r1").includes("tigerai-personal-models"));
  assert.ok(names("s-room-ai", "/w/rooms/r1").includes("tigerai-model-fallback"), "the public fallback still runs there");
});

// a pi stand-in: records registrations and handlers; models are visible to the registry only while registered
function fakePi() {
  const providers = new Map(); const handlers = {}; let model = null; const sets = [];
  const registry = { getAll: () => [...providers].flatMap(([id, c]) => c.models.map((m) => ({ provider: id, id: m.id }))), find: (p, id) => (registry.getAll().some((m) => m.provider === p && m.id === id) ? { provider: p, id } : undefined) };
  return {
    providers, sets, handlers, registry,
    pi: { registerProvider: (n, c) => providers.set(n, c), unregisterProvider: (n) => providers.delete(n), on: (e, h) => { handlers[e] = h; }, setModel: async (m) => { model = m; sets.push(m); return true; } },
    ctx: () => ({ model: model ?? undefined, modelRegistry: registry }),
    setCurrent: (m) => { model = m; },
  };
}

test("the extension registers the owner's providers only, with the key as an environment reference, and follows deletions", async () => {
  const f = fakePi();
  const ext = pr.createPersonalExtension({ id: alice.id, role: "member" });
  await ext.factory(f.pi);
  assert.deepEqual([...f.providers.keys()], [aliceConn.id]);
  const cfg = f.providers.get(aliceConn.id);
  assert.match(cfg.apiKey, /^\$TIGERAI_PKEY_/); assert.ok(!JSON.stringify(cfg).includes("SECRET"), "the key is not in the provider config");
  assert.equal(process.env[cfg.apiKey.slice(1)], ALICE_KEY);
  assert.equal(cfg.baseUrl, ep.url); assert.equal(cfg.models.length, 2); assert.equal(cfg.models[0].reasoning, false);
  // Bob's extension registers nothing of Alice's
  const g = fakePi(); await pr.createPersonalExtension({ id: bob.id, role: "member" }).factory(g.pi);
  assert.equal(g.providers.size, 0);
  // switch it off in the middle of a conversation: the next turn removes it and leaves the model
  g.providers.clear();
  f.setCurrent({ provider: aliceConn.id, id: "gpt-mini" });
  await call(alice, "PATCH", `personal-models/${aliceConn.id}`, { enabled: false });
  st.writeConnections([{ id: "tigerai", name: "主要", baseUrl: "http://pub.example/v1", enabled: true, defaultModel: "fast" }]);
  f.providers.set("tigerai", { models: [{ id: "fast" }] });
  await f.handlers.before_agent_start({}, f.ctx());
  assert.equal(f.providers.has(aliceConn.id), false, "unregistered");
  assert.deepEqual(f.sets.at(-1), { provider: "tigerai", id: "fast" }, "the conversation moved to the public model");
  await call(alice, "PATCH", `personal-models/${aliceConn.id}`, { enabled: true });
});

test("fallback: personal first, then the public ones; a public failure never lands on a personal key; room/other sessions have no personal list", () => {
  const models = [{ provider: "tigerai", id: "fast" }, { provider: "tigerai-2", id: "fast" }, { provider: aliceConn.id, id: "gpt-mini" }, { provider: aliceConn.id, id: "gpt-big" }];
  st.writeConnections([
    { id: "tigerai", name: "主要", baseUrl: "http://pub1.example/v1", enabled: true },
    { id: "tigerai-2", name: "備援", baseUrl: "http://pub2.example/v1", enabled: true },
  ]);
  const owner = { id: alice.id, role: "member" };
  const ids = (l) => l.map((c) => c.id);
  assert.deepEqual(ids(fb.connectionsForOwner(models, owner, { provider: aliceConn.id, modelId: "gpt-mini" })), [aliceConn.id, "tigerai", "tigerai-2"]);
  const next = lg.rankCandidates({ from: { provider: aliceConn.id, modelId: "gpt-mini" }, connections: fb.connectionsForOwner(models, owner, { provider: aliceConn.id, modelId: "gpt-mini" }), tried: new Set([aliceConn.id]) });
  assert.deepEqual(next[0], { provider: "tigerai", modelId: "fast" }, "personal down: the school's model takes over");
  assert.deepEqual(ids(fb.connectionsForOwner(models, owner, { provider: "tigerai", modelId: "fast" })), ["tigerai", "tigerai-2", aliceConn.id], "mutual fallback (default on): the public chain first, then her own connection");
  pe.setPersonalSwitches(admin.id, { mutualFallback: false });
  assert.deepEqual(ids(fb.connectionsForOwner(models, owner, { provider: "tigerai", modelId: "fast" })), ["tigerai", "tigerai-2"], "switch off: a public failure moves along the public list only");
  assert.deepEqual(ids(fb.connectionsForOwner(models, owner, { provider: aliceConn.id, modelId: "gpt-mini" })), [aliceConn.id], "switch off: a failed personal connection never moves to a public model");
  assert.equal(lg.noticeText({ kind: "none", from: { provider: aliceConn.id, modelId: "gpt-mini" }, to: null }, () => "我的連線", "tigerai"), "你的模型連線沒有回應，請檢查金鑰或額度");
  pe.setPersonalSwitches(admin.id, { mutualFallback: true });
  assert.equal(pe.personalSwitches().mutualFallback, true);
  assert.deepEqual(ids(fb.connectionsForOwner(models, null, { provider: aliceConn.id, modelId: "gpt-mini" })), ["tigerai", "tigerai-2"], "no owner (room / automation): public only");
  assert.deepEqual(ids(fb.connectionsForOwner(models, { id: bob.id, role: "member" })), ["tigerai", "tigerai-2"], "Bob has none of his own, and cannot see Alice's");
  // the fallback line and the audit never name a personal connection
  const rows0 = audits("model.fallback").length;
  fb.auditFallback("s1", { kind: "fallback", from: { provider: aliceConn.id, modelId: "gpt-mini" }, to: { provider: "tigerai", modelId: "fast" }, reason: "timeout", preferred: null, at: "" });
  assert.equal(audits("model.fallback").length, rows0, "the audit has no record of personal use");
});

test("the two admin switches", async () => {
  const models = [{ provider: "tigerai", id: "fast" }, { provider: aliceConn.id, id: "gpt-mini" }];
  assert.deepEqual((await call(admin, "GET", "admin/models/personal")).json.switches, { allow: true, publicWithoutKey: true, mutualFallback: true });
  // publicWithoutKey off: members must have their own; admins unaffected
  const off = await call(admin, "PUT", "admin/models/personal", { publicWithoutKey: false });
  assert.deepEqual(off.json.switches, { allow: true, publicWithoutKey: false, mutualFallback: true });
  assert.equal(pe.personalRequired({ id: alice.id, role: "member" }), true); assert.equal(pe.personalRequired({ id: admin.id, role: "admin" }), false);
  assert.deepEqual(fb.connectionsForOwner(models, { id: alice.id, role: "member" }).map((c) => c.id), [aliceConn.id], "with a key of her own Alice is served by her connection only");
  const upstream = { models: {}, modelList: [], defaultModel: { provider: "tigerai", modelId: "fast" }, thinkingLevels: {} };
  assert.equal(mergeModelList(upstream, { id: alice.id, role: "member" }).defaultModel.provider, aliceConn.id);
  // the gate refuses a send from a member with no usable key
  const { gate } = await import("../adapter/gate.ts");
  const { NextRequest } = await import("next/server");
  const { createSessionCookie, SESSION_COOKIE } = await import("../accounts/session.ts");
  const ck = (u) => `${SESSION_COOKIE}=${createSessionCookie(u.id, acc.userById(u.id).token_version)}`;
  const post = (u, body) => gate(new NextRequest("http://x/api/agent/new", { method: "POST", headers: { cookie: ck(u), "content-type": "application/json" }, body: JSON.stringify(body) }), false);
  const refused = await post(bob, { cwd: "/tmp", type: "prompt", message: "hi" });
  assert.equal(refused.status, 403); assert.match((await refused.json()).error, /personal_key_required/);
  assert.notEqual((await post(bob, { cwd: "/tmp", type: "ensure_session" })).status, 403, "opening an empty conversation is not a send");
  assert.notEqual((await post(admin, { cwd: "/tmp", type: "prompt", message: "hi" })).status, 403, "administrators are not affected");
  // the conversation of a person with a key leaves a public model at the next turn
  const f = fakePi(); await pr.createPersonalExtension({ id: alice.id, role: "member" }).factory(f.pi);
  f.providers.set("tigerai", { models: [{ id: "fast" }] }); f.setCurrent({ provider: "tigerai", id: "fast" });
  await f.handlers.before_agent_start({}, f.ctx());
  assert.deepEqual(f.sets.at(-1), { provider: aliceConn.id, id: "gpt-mini" });

  // allow off: nothing personal is usable, at all
  await call(admin, "PUT", "admin/models/personal", { allow: false });
  assert.deepEqual(pe.usablePersonal(alice.id), []); assert.equal(pe.userOwnsProvider(alice.id, aliceConn.id), false);
  assert.equal(pe.personalRequired({ id: bob.id, role: "member" }), false, "with the feature off nobody is asked for a key");
  assert.equal((await call(alice, "POST", "personal-models", { name: "x", baseUrl: ep.url, models: "m" })).status, 403);
  assert.equal((await call(alice, "GET", "me")).json.personalModels, 0);
  assert.equal(mergeModelList(upstream, { id: alice.id, role: "member" }).modelList.length, 0);
  assert.equal(audits("model.personal.switches").length, 4, "each switch change is audited (two of them came from the fallback test above)");
  await call(admin, "PUT", "admin/models/personal", { allow: true, publicWithoutKey: true, mutualFallback: true });
  assert.equal((await call(admin, "PUT", "admin/models/personal", { allow: "yes" })).status, 400);
});

test("limits and safety: at most 5, strange keys, internal addresses, and delete removes the key file", async () => {
  assert.equal((await call(alice, "POST", "personal-models", { name: "bang", baseUrl: ep.url, apiKey: "!rm -rf x", models: "m" })).status, 400, "a leading ! would be a shell command for pi");
  assert.equal((await call(alice, "POST", "personal-models", { name: "env", baseUrl: ep.url, apiKey: "$HOME", models: "m" })).status, 400);
  assert.equal((await call(alice, "POST", "personal-models", { name: "sp", baseUrl: ep.url, apiKey: "a b", models: "m" })).status, 400);
  assert.equal((await call(alice, "POST", "personal-models", { name: "emb", baseUrl: ep.url, models: "bge-m3" })).status, 400);
  assert.equal((await call(alice, "POST", "personal-models", { name: "cred", baseUrl: "http://u:p@x.example/v1", models: "m" })).status, 400);
  // internal targets
  delete process.env.TIGERAI_PERSONAL_ALLOW_PRIVATE; pe.resetHostCache();
  for (const url of ["http://169.254.169.254/v1", "http://127.0.0.1:9/v1", `http://${["10", "0", "0", "5"].join(".")}/v1`, "http://[::1]/v1", `http://${["192", "168", "1", "2"].join(".")}/v1`]) {
    const r = await call(alice, "POST", "personal-models", { name: "ssrf", baseUrl: url, models: "m" });
    assert.equal(r.status, 400, url); assert.equal(r.json.code, "bad_host", url);
  }
  assert.equal((await call(alice, "POST", "personal-models/test", { baseUrl: "http://169.254.169.254/v1" })).json.ok, false);
  process.env.TIGERAI_PERSONAL_ALLOW_PRIVATE = "1"; pe.resetHostCache();
  assert.ok(pe.addressBlocked("169.254.169.254"), "the metadata address stays blocked even then");
  // 5 at most
  for (let i = 0; i < 4; i += 1) assert.equal((await call(bob, "POST", "personal-models", { name: `c${i}`, baseUrl: ep.url, models: "m" })).status, 201);
  assert.equal((await call(bob, "POST", "personal-models", { name: "c4", baseUrl: ep.url, models: "m" })).status, 201);
  const sixth = await call(bob, "POST", "personal-models", { name: "c5", baseUrl: ep.url, models: "m" });
  assert.equal(sixth.status, 409); assert.equal(sixth.json.code, "personal_too_many");
  // reorder and delete
  const ids = (await call(bob, "GET", "personal-models")).json.connections.map((c) => c.id);
  const re = await call(bob, "POST", "personal-models/reorder", { ids: [...ids].reverse() });
  assert.deepEqual(re.json.connections.map((c) => c.id), [...ids].reverse());
  assert.equal((await call(bob, "POST", "personal-models/reorder", { ids: ids.slice(1) })).status, 400);
  assert.equal((await call(alice, "POST", "personal-models/reorder", { ids })).status, 400, "someone else's ids are not mine to order");
  for (const id of ids) await call(bob, "DELETE", `personal-models/${id}`);
  assert.deepEqual(readdirSync(join(process.env.TIGERAI_DATA_DIR, "personal-models", bob.id)).filter((f) => f.startsWith("key-")), []);
  assert.equal(audits("model.personal.delete").length, 5);
});

test("upstream's process-wide provider catalog never learns a personal provider", () => {
  pr.guardCatalogs();
  globalThis.__piWebProviderModelCatalog.set(aliceConn.id, [{ id: "gpt-mini" }]);
  globalThis.__piWebProviderModelCatalog.set("other", [{ id: "x" }]);
  globalThis.__piWebProviderNameCatalog.set(aliceConn.id, "我的 · 我的 OpenAI");
  assert.equal(globalThis.__piWebProviderModelCatalog.has(aliceConn.id), false);
  assert.equal(globalThis.__piWebProviderNameCatalog.has(aliceConn.id), false);
  assert.equal(globalThis.__piWebProviderModelCatalog.has("other"), true);
  // an entry that got in before the guard existed is dropped when it is installed
  globalThis.__piWebProviderModelCatalog = new Map([[aliceConn.id, []], ["keep", []]]);
  pr.guardCatalogs();
  assert.deepEqual([...globalThis.__piWebProviderModelCatalog.keys()], ["keep"]);
});

test("the personal page text has the zh-TW strings and the member picker rule follows the connection count", async () => {
  const { zhByok, enByok } = await import("../pages/i18n-byok.ts");
  assert.deepEqual(Object.keys(zhByok).sort(), Object.keys(enByok).sort());
  const { upstreamVisible } = await import("../ui/layout.ts");
  assert.equal(upstreamVisible("composer.model", { role: "member" }), false);
  assert.equal(upstreamVisible("composer.model", { role: "member", personalModels: 1 }), true);
  assert.equal(upstreamVisible("composer.thinking", { role: "member", personalModels: 1 }), false, "thinking control stays admin-only");
  assert.equal(upstreamVisible("composer.model", { role: "admin" }), true);
  ep.close();
});

test("NVIDIA preset: its public base URL passes the personal-connection URL check, and the UI offers it", () => {
  assert.equal(pe.cleanBaseUrl("https://integrate.api.nvidia.com/v1"), "https://integrate.api.nvidia.com/v1");
  const ui = readFileSync(join(root, "tigerai/ui/PersonalModels.tsx"), "utf8");
  assert.ok(ui.includes("https://integrate.api.nvidia.com/v1") && ui.includes("pmPresetNvidia"));
  const i18n = readFileSync(join(root, "tigerai/pages/i18n-byok.ts"), "utf8");
  assert.ok(i18n.includes("build.nvidia.com") && i18n.includes("NVIDIA(免費)"));
});

test("approve/reject confirmation: only a shared prompt is written as /name", () => {
  const i18n = readFileSync(join(root, "tigerai/pages/i18n.ts"), "utf8");
  assert.ok(/cfApproveN: "確定要核可「\{name\}」/.test(i18n));
  for (const f of ["tigerai/ui/Bulletin.tsx", "tigerai/pages/TgApp.tsx"]) {
    const s = readFileSync(join(root, f), "utf8");
    assert.ok(s.includes('"prompt_share" ? "cfApprove" : "cfApproveN"') && s.includes('"prompt_share" ? "cfReject" : "cfRejectN"'), f);
  }
});
