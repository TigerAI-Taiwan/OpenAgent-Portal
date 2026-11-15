// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Community edition: model connection list with ordered fallback (3a), and small fixes 1-4:
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-model.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-ce-model-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
for (const k of ["TIGERAI_V1_BASE_URL", "TIGERAI_V1_API_KEY_FILE", "TIGERAI_V1_MODELS", "TIGERAI_V1_DEFAULT_MODEL"]) delete process.env[k];
mkdirSync(process.env.TIGERAI_DATA_DIR, { recursive: true });

const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const st = await import("../provider/settings.ts");
const lg = await import("../provider/fallback-logic.ts");
const rt = await import("../provider/fallback-runtime.ts");
const note = await import("../provider/fallback-note.ts");
const push = await import("../push/index.ts");
const trl = await import("../ui/truncation-logic.ts");
const et = await import("../ui/error-translate.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const bob = mk("bob@example.com", "Bob");
async function call(user, method, path, body) {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  const req = new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await handle(req, segs);
  return { status: res.status, json: await res.json() };
}
const audits = (action) => getDb().prepare("SELECT * FROM audit WHERE action=?").all(action);
const gateway = (models, key) => new Promise((resolve) => {
  const s = createServer((req, res) => {
    if (key && req.headers.authorization !== `Bearer ${key}`) { res.statusCode = 401; return res.end("{}"); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: models.map((id) => ({ id, context_length: 32000 })) }));
  });
  s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${s.address().port}/v1`, close: () => s.close() }));
});
const modelsJson = () => JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), "utf8")).providers;

// ---------------------------------------------------------------- migration of the old single configuration
test("old single configuration (saved URL + key file, or environment) becomes connection #1 without any reset", async () => {
  // 1. nothing configured: empty list, not locked
  assert.deepEqual(st.listConnections(), []);
  // 2. environment only
  process.env.TIGERAI_V1_BASE_URL = "http://env.example/v1"; process.env.TIGERAI_V1_MODELS = "a,b"; process.env.TIGERAI_V1_DEFAULT_MODEL = "b";
  let l = st.listConnections();
  assert.equal(l.length, 1); assert.equal(l[0].id, "tigerai"); assert.equal(l[0].baseUrl, "http://env.example/v1"); assert.deepEqual(l[0].offered, ["a", "b"]); assert.equal(l[0].defaultModel, "b"); assert.equal(l[0].enabled, true);
  assert.equal(st.connectionsMigrated(), false);
  for (const k of ["TIGERAI_V1_BASE_URL", "TIGERAI_V1_MODELS", "TIGERAI_V1_DEFAULT_MODEL"]) delete process.env[k];
  // 3. the pre-list settings file (baseUrl / offered / defaultModel / overrides) and key file
  writeFileSync(join(process.env.TIGERAI_DATA_DIR, "models-settings.json"), JSON.stringify({ baseUrl: "http://old.example/v1", offered: ["m1"], defaultModel: "m1", overrides: { m1: { maxTokens: 900 } } }));
  writeFileSync(join(process.env.TIGERAI_DATA_DIR, "v1-api-key"), "sk-old-1111\n", { mode: 0o600 });
  l = st.listConnections();
  assert.equal(l.length, 1); assert.equal(l[0].baseUrl, "http://old.example/v1"); assert.deepEqual(l[0].offered, ["m1"]); assert.equal(l[0].overrides.m1.maxTokens, 900);
  assert.equal(st.connKey("tigerai"), "sk-old-1111");
  assert.equal(st.effectiveBaseUrl().url, "http://old.example/v1");
  const view = (await call(admin, "GET", "admin/models/connections")).json;
  assert.equal(view.connections.length, 1); assert.equal(view.connections[0].keyLast4, "1111"); assert.equal(view.connections[0].hasKey, true);
  assert.ok(!JSON.stringify(view).includes("sk-old"));
  // the first write of the list keeps connection #1 intact and drops the legacy fields
  const gw = await gateway(["m1", "m2"], "sk-old-1111");
  try {
    await call(admin, "PATCH", "admin/models/connections/tigerai", { baseUrl: gw.url });
    const saved = JSON.parse(readFileSync(join(process.env.TIGERAI_DATA_DIR, "models-settings.json"), "utf8"));
    assert.ok(Array.isArray(saved.connections) && saved.connections[0].id === "tigerai" && saved.baseUrl === undefined);
    assert.equal(st.connKey("tigerai"), "sk-old-1111", "the key file did not move");
    assert.deepEqual(Object.keys(modelsJson()), ["tigerai"]);
  } finally { gw.close(); }
});

// ---------------------------------------------------------------- the list: add / edit / reorder / disable / delete
test("connections: admin only, keys in mode-600 files, order and disabled state reach models.json, every write is audited", async () => {
  const g1 = await gateway(["tigerai-fast", "big"], "sk-one-1111");
  const g2 = await gateway(["tigerai-fast", "cloud-only"], "sk-two-2222");
  try {
    for (const [m, p, b] of [["GET", "admin/models/connections"], ["POST", "admin/models/connections", { name: "x", baseUrl: g2.url }], ["PATCH", "admin/models/connections/tigerai", {}], ["DELETE", "admin/models/connections/tigerai"], ["POST", "admin/models/connections/reorder", { ids: [] }]])
      assert.equal((await call(bob, m, p, b)).status, 403, `${m} ${p} is admin only`);
    // validation
    assert.equal((await call(admin, "POST", "admin/models/connections", { name: "", baseUrl: g2.url })).json.code, "bad_name");
    assert.equal((await call(admin, "POST", "admin/models/connections", { name: "z", baseUrl: "ftp://x" })).json.code, "bad_url");
    await call(admin, "PATCH", "admin/models/connections/tigerai", { baseUrl: g1.url, apiKey: "sk-one-1111", name: "本機 LLM Manager", offered: null, defaultModel: null });
    const add = await call(admin, "POST", "admin/models/connections", { name: "虎智雲端備援", baseUrl: g2.url, apiKey: "sk-two-2222" });
    assert.equal(add.status, 201);
    assert.deepEqual(add.json.connections.map((c) => c.id), ["tigerai", "tigerai-2"]);
    assert.ok(!JSON.stringify(add.json).includes("sk-two"), "the key never comes back");
    assert.equal(add.json.connections[1].keyLast4, "2222");
    const keyPath = join(process.env.TIGERAI_DATA_DIR, "v1-key-tigerai-2");
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    assert.ok(!readFileSync(join(process.env.TIGERAI_DATA_DIR, "models-settings.json"), "utf8").includes("sk-"));
    // models.json: one provider per enabled connection, in order, each with its own key reference and its own models
    let p = modelsJson();
    assert.deepEqual(Object.keys(p), ["tigerai", "tigerai-2"]);
    assert.equal(p["tigerai-2"].apiKey, "$TIGERAI_V1_RUNTIME_KEY_TIGERAI_2"); assert.equal(p.tigerai.apiKey, "$TIGERAI_V1_RUNTIME_KEY");
    assert.deepEqual(p["tigerai-2"].models.map((m) => m.id), ["tigerai-fast", "cloud-only"]);
    assert.ok(!readFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), "utf8").includes("sk-"));
    // each connection ticks its own models
    assert.equal((await call(admin, "PATCH", "admin/models/connections/tigerai-2", { offered: ["cloud-only"] })).status, 200);
    assert.deepEqual(modelsJson()["tigerai-2"].models.map((m) => m.id), ["cloud-only"]);
    assert.deepEqual(modelsJson().tigerai.models.map((m) => m.id), ["tigerai-fast", "big"]);
    // disable: out of models.json, but still in the list, and the portal stays "locked" (models are still admin-provisioned)
    assert.equal((await call(admin, "PATCH", "admin/models/connections/tigerai-2", { enabled: false })).status, 200);
    assert.deepEqual(Object.keys(modelsJson()), ["tigerai"]);
    assert.equal((await call(admin, "GET", "admin/models/connections")).json.connections[1].enabled, false);
    assert.equal((await call(admin, "PATCH", "admin/models/connections/tigerai-2", { enabled: "yes" })).json.code, "bad_enabled");
    await call(admin, "PATCH", "admin/models/connections/tigerai-2", { enabled: true });
    // reorder: must name every connection once; the first becomes the primary and the default model follows it
    assert.equal((await call(admin, "POST", "admin/models/connections/reorder", { ids: ["tigerai"] })).json.code, "bad_order");
    assert.equal((await call(admin, "POST", "admin/models/connections/reorder", { ids: ["tigerai", "nope"] })).json.code, "bad_order");
    const re = await call(admin, "POST", "admin/models/connections/reorder", { ids: ["tigerai-2", "tigerai"] });
    assert.deepEqual(re.json.connections.map((c) => c.id), ["tigerai-2", "tigerai"]);
    assert.deepEqual(Object.keys(modelsJson()), ["tigerai-2", "tigerai"]);
    assert.equal(JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), "utf8")).defaultProvider, "tigerai-2");
    assert.equal(st.primaryConnection().id, "tigerai-2");
    assert.equal(st.effectiveBaseUrl().url, g2.url);
    // delete: gone from the list and models.json, its key file removed, the other keeps working
    assert.equal((await call(admin, "DELETE", "admin/models/connections/nope")).status, 404);
    const del = await call(admin, "DELETE", "admin/models/connections/tigerai-2");
    assert.deepEqual(del.json.connections.map((c) => c.id), ["tigerai"]);
    assert.equal(existsSync(keyPath), false);
    assert.deepEqual(Object.keys(modelsJson()), ["tigerai"]);
    // the next one added is numbered after the highest id, never reusing the primary's
    assert.equal((await call(admin, "POST", "admin/models/connections", { name: "again", baseUrl: g2.url })).json.connections[1].id, "tigerai-2");
    // audit
    for (const a of ["model.connection.add", "model.connection.update", "model.connection.delete", "model.connection.reorder"]) assert.ok(audits(a).length >= 1, a);
    assert.ok(!JSON.stringify(getDb().prepare("SELECT extra FROM audit").all()).includes("sk-"), "no key in any audit row");
    // the legacy single-connection route edits connection #1 (the first)
    const leg = await call(admin, "PUT", "admin/models", { defaultModel: "big" });
    assert.equal(leg.status, 200); assert.equal(st.listConnections()[0].defaultModel, "big");
  } finally { g1.close(); g2.close(); }
});

test("a connection whose address stops answering keeps its last model list (so a fallback can still be planned)", async () => {
  const g = await gateway(["tigerai-fast"], null);
  await call(admin, "PATCH", "admin/models/connections/tigerai", { baseUrl: g.url, offered: null });
  g.close();
  await call(admin, "PATCH", "admin/models/connections/tigerai", { baseUrl: "http://127.0.0.1:9/v1" });
  assert.deepEqual(modelsJson().tigerai.models.map((m) => m.id), ["tigerai-fast"]);
  assert.equal(modelsJson().tigerai.baseUrl, "http://127.0.0.1:9/v1");
});

// ---------------------------------------------------------------- fallback logic
const C = (id, models, def = null) => ({ id, name: id, models, defaultModel: def });
test("failure classification: connection-level failures fall back, bad answers and context overflow do not", () => {
  const err = (errorMessage) => ({ stopReason: "error", errorMessage });
  assert.equal(lg.classifyFailure(err("Connection error.")), "unreachable");
  assert.equal(lg.classifyFailure(err("connect ECONNREFUSED gateway.example:5000")), "unreachable");
  assert.equal(lg.classifyFailure(err("Request timed out.")), "timeout");
  assert.equal(lg.classifyFailure(err("503 Service Unavailable")), "server-error");
  assert.equal(lg.classifyFailure(err("429 rate limit exceeded")), "overloaded");
  assert.equal(lg.classifyFailure(err("404 model 'x' not found")), "model-unavailable");
  assert.equal(lg.classifyFailure({ stopReason: "stop" }), null);
  assert.equal(lg.classifyFailure({ stopReason: "aborted", errorMessage: "aborted" }), null);
  assert.equal(lg.classifyFailure(err("400 invalid_request: bad tool schema")), null);
  assert.equal(lg.classifyFailure(err("insufficient_quota: billing")), null);
});

test("ranking: order of the list, the failed and tried and recently-down connections skipped, same name first, else the connection's default", () => {
  lg.resetHealth();
  const conns = [C("a", ["m1", "m2"]), C("b", ["m1", "x"], "x"), C("c", ["only"], "only"), C("d", ["q", "tigerai-fast"])];
  const from = { provider: "a", modelId: "m1" };
  // same name where there is one; otherwise that connection's default; otherwise tigerai-fast; otherwise its first model
  assert.deepEqual(lg.rankCandidates({ from, connections: conns, tried: new Set() }), [{ provider: "b", modelId: "m1" }, { provider: "c", modelId: "only" }, { provider: "d", modelId: "tigerai-fast" }]);
  assert.deepEqual(lg.rankCandidates({ from: { provider: "a", modelId: "m2" }, connections: conns, tried: new Set() })[0], { provider: "b", modelId: "x" }, "no same name: the default model");
  assert.equal(lg.pickModel(C("z", ["p", "q"]), "nope"), "p");
  assert.equal(lg.pickModel(C("z", []), "nope"), null);
  // tried this turn is skipped
  assert.deepEqual(lg.rankCandidates({ from, connections: conns, tried: new Set(["b"]) }).map((r) => r.provider), ["c", "d"]);
  // a connection that failed recently is not tried first; after the cooldown it is again
  lg.markDown("b", "timeout", 1_000, 600_000);
  assert.deepEqual(lg.rankCandidates({ from, connections: conns, tried: new Set(), now: 2_000 }).map((r) => r.provider), ["c", "d"]);
  assert.deepEqual(lg.rankCandidates({ from, connections: conns, tried: new Set(), now: 700_000 }).map((r) => r.provider), ["b", "c", "d"]);
  lg.resetHealth();
  assert.deepEqual(lg.rankCandidates({ from, connections: [], tried: new Set() }), []);
});

test("disabled connections never become candidates (connectionsFor keeps enabled ones with models, in order)", () => {
  const list = [
    { id: "tigerai", name: "主要", baseUrl: "http://a/v1", enabled: true, defaultModel: null },
    { id: "tigerai-2", name: "停用", baseUrl: "http://b/v1", enabled: false, defaultModel: null },
    { id: "tigerai-3", name: "備援", baseUrl: "http://c/v1", enabled: true, defaultModel: "q" },
  ];
  const models = [{ provider: "tigerai", id: "m" }, { provider: "tigerai-2", id: "m" }, { provider: "tigerai-3", id: "q" }];
  assert.deepEqual(rt.connectionsFor(models, list).map((c) => c.id), ["tigerai", "tigerai-3"]);
});

test("cooldown: 10 minutes by default, TIGERAI_FALLBACK_COOLDOWN_SECONDS overrides", () => {
  assert.equal(lg.cooldownMs(), 600_000);
  process.env.TIGERAI_FALLBACK_COOLDOWN_SECONDS = "30"; assert.equal(lg.cooldownMs(), 30_000); delete process.env.TIGERAI_FALLBACK_COOLDOWN_SECONDS;
});

// ---------------------------------------------------------------- the controller (what agent_before_settle / before_agent_start do)
function fakeHost(conns, start) {
  const h = { cur: start, switched: [], records: [], t: 1_000_000, failSwitch: new Set() };
  h.host = {
    current: () => h.cur, contextWindowOf: () => 32000,
    switchTo: async (ref) => { if (h.failSwitch.has(ref.provider)) return false; h.cur = ref; h.switched.push(ref); return true; },
    connections: () => conns, record: (r) => h.records.push(r), sessionId: () => "s1", now: () => h.t,
  };
  return h;
}
const failedEvent = (provider, model, msg = "Connection error.") => ({
  entries: [], context: { contextEntries: [{ sourceEntry: { id: "e9" }, messages: [{ role: "assistant", stopReason: "error", errorMessage: msg, provider, model }] }] },
});

test("controller: the failed turn continues on the next connection (context_edit + custom entry + continue), is remembered, and goes back after the cooldown", async () => {
  lg.resetHealth();
  const h = fakeHost([C("tigerai", ["tigerai-fast"]), C("tigerai-2", ["tigerai-fast", "x"], "x")], { provider: "tigerai", modelId: "tigerai-fast" });
  const ctl = new rt.FallbackController(h.host);
  const r = await ctl.onBeforeSettle(failedEvent("tigerai", "tigerai-fast"));
  assert.equal(r.continue, true);
  assert.deepEqual(h.cur, { provider: "tigerai-2", modelId: "tigerai-fast" }, "same-named model on the next connection");
  assert.deepEqual(r.entries.map((e) => e.type), ["context_edit", "custom"]);
  assert.equal(r.entries[0].targetId, "e9"); assert.equal(r.entries[0].replacement, null);
  assert.equal(r.entries[1].customType, "tigerai:model-fallback");
  assert.ok(!r.entries.some((e) => e.type === "custom_message"), "never a custom_message: pi would replay it to the model as a user turn");
  assert.equal(h.records[0].kind, "fallback");
  assert.deepEqual(h.records[0].preferred, { provider: "tigerai", modelId: "tigerai-fast" });
  // next message within the cooldown: stays on the substitute and says so
  const appended = [];
  h.t += 60_000; await ctl.beforePrompt((t, d) => appended.push(d));
  assert.equal(h.cur.provider, "tigerai-2"); assert.equal(appended[0].kind, "skip-unhealthy");
  // cooldown over: back to the primary
  h.t += 11 * 60_000; await ctl.beforePrompt((t, d) => appended.push(d));
  assert.equal(h.cur.provider, "tigerai"); assert.equal(appended.at(-1).kind, "restore");
  // and after that no more records
  const n = appended.length; await ctl.beforePrompt((t, d) => appended.push(d)); assert.equal(appended.length, n);
});

test("controller: a connection that failed minutes ago is skipped BEFORE sending; nobody left = recorded 'none', turn ends as it would", async () => {
  lg.resetHealth();
  const h = fakeHost([C("tigerai", ["m"]), C("tigerai-2", ["m"])], { provider: "tigerai", modelId: "m" });
  const ctl = new rt.FallbackController(h.host);
  lg.markDown("tigerai", "unreachable", h.t, 600_000);
  const appended = [];
  await ctl.beforePrompt((t, d) => appended.push(d));
  assert.equal(h.cur.provider, "tigerai-2"); assert.equal(appended[0].kind, "skip-unhealthy"); assert.equal(appended[0].reason, "unreachable");
  // both down and the second one fails during the turn: no candidate
  const r = await ctl.onBeforeSettle(failedEvent("tigerai-2", "m", "503 Service Unavailable"));
  assert.equal(r.continue, undefined); assert.equal(r.entries.at(-1).data.kind, "none");
  // an error that is not about availability is left alone
  const h2 = fakeHost([C("tigerai", ["m"]), C("tigerai-2", ["m"])], { provider: "tigerai", modelId: "m" });
  assert.equal(await new rt.FallbackController(h2.host).onBeforeSettle(failedEvent("tigerai", "m", "400 invalid_request bad schema")), undefined);
  assert.equal(h2.switched.length, 0);
  // a turn that did not end in an error does nothing
  assert.equal(await new rt.FallbackController(h2.host).onBeforeSettle({ entries: [], context: { contextEntries: [{ sourceEntry: { id: "x" }, messages: [{ role: "assistant", stopReason: "stop", provider: "tigerai", model: "m" }] }] } }), undefined);
  // a switch that is refused (no key) moves on to the next candidate
  const h3 = fakeHost([C("a", ["m"]), C("b", ["m"]), C("c", ["m"])], { provider: "a", modelId: "m" }); h3.failSwitch.add("b");
  const r3 = await new rt.FallbackController(h3.host).onBeforeSettle(failedEvent("a", "m"));
  assert.equal(r3.continue, true); assert.equal(h3.cur.provider, "c");
  lg.resetHealth();
});

test("controller: a person's own model choice ends the 'go back' memory, our own switch does not", async () => {
  lg.resetHealth();
  const h = fakeHost([C("a", ["m"]), C("b", ["m"])], { provider: "a", modelId: "m" });
  const ctl = new rt.FallbackController(h.host);
  await ctl.onBeforeSettle(failedEvent("a", "m"));
  lg.resetHealth(); // the primary is healthy again
  ctl.onExplicitModelChange();
  const ap = []; await ctl.beforePrompt((t, d) => ap.push(d));
  assert.equal(h.cur.provider, "b", "stays where the person put it");
  // restoring from the log after the idle wrapper was dropped
  const ctl2 = new rt.FallbackController(h.host);
  ctl2.restoreFromEntries([{ type: "model_change" }, { type: "custom", customType: "tigerai:model-fallback", data: { kind: "fallback", from: { provider: "a", modelId: "m" }, to: { provider: "b", modelId: "m" }, preferred: { provider: "a", modelId: "m" } } }]);
  await ctl2.beforePrompt((t, d) => ap.push(d)); assert.equal(h.cur.provider, "a");
});

test("the one-line note: only for the latest turn, names come from the connection list, silent when nothing happened", () => {
  const rec = { kind: "fallback", from: { provider: "tigerai", modelId: "tigerai-fast" }, to: { provider: "tigerai-2", modelId: "tigerai-fast" } };
  const entries = [{ type: "message", message: { role: "user" } }, { type: "custom", customType: "tigerai:model-fallback", data: rec }, { type: "message", message: { role: "assistant" } }];
  const n = note.noteFromEntries(entries);
  assert.match(n.text, /^主要連線沒有回應,這次改用「.+」的 tigerai-fast。$/);
  assert.equal(note.noteFromEntries([...entries, { type: "message", message: { role: "user" } }]), null, "a later turn without a fallback: no note");
  // the pre-send step-off is written BEFORE the turn's user message (after the previous answer): it still belongs to that turn
  const pre = [{ type: "message", message: { role: "user" } }, { type: "message", message: { role: "assistant" } }, { type: "custom", customType: "tigerai:model-fallback", data: { ...rec, kind: "skip-unhealthy" } }, { type: "message", message: { role: "user" } }];
  assert.ok(note.noteFromEntries(pre), "skip-unhealthy before the user message shows");
  assert.equal(note.noteFromEntries([...pre, { type: "message", message: { role: "assistant" } }, { type: "message", message: { role: "user" } }]), null, "and not on the turn after");
  assert.equal(note.noteFromEntries([{ type: "message", message: { role: "user" } }]), null);
  assert.equal(note.noteFromEntries([{ type: "message", message: { role: "user" } }, { type: "custom", customType: "tigerai:model-fallback", data: { ...rec, kind: "restore" } }]), null);
});

test("members cannot see connections; the note route needs access to the conversation", async () => {
  assert.equal((await call(bob, "GET", "admin/models")).status, 403);
  assert.equal((await call(bob, "GET", "sessions/does-not-exist/fallback")).status, 404);
});

// ---------------------------------------------------------------- items 1-4
test("item 1: an AI order waiting for confirmation counts in the bell (and so does its overdue state)", async () => {
  const asg = await import("../workorders/assignments.ts");
  const bul = await import("../bulletin/service.ts");
  const a = asg.createAssignment({ id: bob.id, role: "member" }, { title: "AI 單", assigneeKind: "ai" });
  getDb().prepare("UPDATE assignments SET run_state='review', status='accepted' WHERE id=?").run(a.id);
  const s = bul.bulletinSummary({ id: bob.id, role: "member" });
  assert.equal(s.count, 1); assert.equal(s.parts.assignments, 1); assert.equal(s.aiReview.length, 1);
  assert.equal(asg.pendingCount({ id: bob.id, role: "member" }).total, 1);
});

test("item 2: the 繼續 button frees itself when the run it started has ended; it frees itself too when no run ever started", () => {
  let l = { sent: true, ran: false };
  l = trl.latchStep(l, false); assert.deepEqual(l, { sent: true, ran: false }, "pressed, run not started yet: still grey");
  l = trl.latchStep(l, true); assert.deepEqual(l, { sent: true, ran: true });
  l = trl.latchStep(l, true); assert.deepEqual(l, { sent: true, ran: true });
  l = trl.latchStep(l, false); assert.deepEqual(l, { sent: false, ran: false }, "run ended: live again for the next cut-off");
  assert.deepEqual(trl.latchStep({ sent: false, ran: false }, true), { sent: false, ran: false }, "never pressed: untouched");
  assert.ok(trl.LATCH_FALLBACK_MS > 0);
});

test("item 3: 'Nothing to compact' reads 對話還很短,不需要壓縮。; other errors pass through; only agent command posts are rewritten", () => {
  assert.equal(et.translateEngineError("Nothing to compact (session too small)", "zh"), "對話還很短,不需要壓縮。");
  assert.match(et.translateEngineError("Nothing to compact", "en"), /nothing to compact/i);
  assert.equal(et.translateEngineError("Compaction failed: 500", "zh"), null);
  assert.equal(et.translateEngineError(undefined, "zh"), null);
  assert.equal(et.isAgentCommandUrl("/api/agent/abc-123", "POST"), true);
  assert.equal(et.isAgentCommandUrl("/api/agent/abc-123", "GET"), false);
  assert.equal(et.isAgentCommandUrl("/api/agent/new", "POST"), false);
  assert.equal(et.isAgentCommandUrl("/api/agent/abc/events", "POST"), false);
});

test("item 4: the 'conversation complete' push goes to the conversation's owner only (never to other subscribers, never for channel/hook/AI-order sessions)", async () => {
  const sent = [];
  push.setPushSender(async (t, p) => { sent.push({ endpoint: t.endpoint, p }); });
  const alice = mk("alice@example.com", "Alice");
  push.subscribeBody(bob.id, { subscription: { endpoint: "https://push.example/bob", keys: { p256dh: "k", auth: "a" } } });
  push.subscribeBody(alice.id, { subscription: { endpoint: "https://push.example/alice", keys: { p256dh: "k", auth: "a" } } });
  assert.equal(push.subscriptionCount(bob.id), 1);
  assert.throws(() => push.subscribeBody(bob.id, { subscription: { endpoint: "http://not-https" } }));
  const own = (id, user, kind) => getDb().prepare("INSERT INTO session_owner (session_id,user_id,cwd,kind,room_id,created_at) VALUES (?,?,?,?,?,?)").run(id, user, null, kind, null, 1);
  own("s-chat", bob.id, "chat"); own("s-room", bob.id, "room-ai"); own("s-hook", bob.id, "hook"); own("s-order", bob.id, "chat");
  getDb().prepare("INSERT INTO assignments (id,title,applicant_id,assignee_id,session_id,created_at,updated_at,source,assignee_kind) VALUES ('o1','t',?,?,?,1,1,'person','ai')").run(bob.id, bob.id, "s-order");
  assert.equal(push.completionRecipient("s-chat"), bob.id);
  assert.equal(push.completionRecipient("s-room"), null); assert.equal(push.completionRecipient("s-hook"), null);
  assert.equal(push.completionRecipient("s-order"), null); assert.equal(push.completionRecipient("unknown"), null);
  assert.equal(await push.pushSessionComplete("s-chat", "我的對話"), 1);
  assert.deepEqual(sent.map((s) => s.endpoint), ["https://push.example/bob"], "Alice's device is not told about Bob's conversation");
  assert.equal(sent[0].p.title, "我的對話"); assert.match(sent[0].p.url, /session=s-chat/);
  assert.equal(await push.pushSessionComplete("s-room", "x"), 0);
  // upstream's ownerless list is emptied (keys stay)
  const ag = process.env.PI_CODING_AGENT_DIR; mkdirSync(ag, { recursive: true });
  writeFileSync(join(ag, "web-push.json"), JSON.stringify({ vapidKeys: { publicKey: "p", privateKey: "q" }, subscriptions: [{ endpoint: "https://old", keys: {}, locale: "en" }] }));
  assert.equal(push.dropOwnerlessUpstreamSubscriptions(ag), 1);
  const after = JSON.parse(readFileSync(join(ag, "web-push.json"), "utf8"));
  assert.deepEqual(after.subscriptions, []); assert.equal(after.vapidKeys.publicKey, "p");
  push.setPushSender(null);
});
