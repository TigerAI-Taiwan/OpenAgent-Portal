// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// n8n end to end against FAKE services: dev/mock-n8n.mjs (webhook) and dev/mock-v1.mjs (scripted tool calls).
// The server under test must run with TIGERAI_V1_BASE_URL pointing at the mock /v1.
// Needs the contract-test variables plus N8N_MOCK_URL and MOCK_V1_STATS.
import test from "node:test";
import assert from "node:assert/strict";
import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "../tools/client.mjs";

const e = process.env;
const ready = e.E2E_BASE_URL && e.ADMIN_PASSWORD && e.MEMBER_A_PASSWORD && e.MEMBER_B_PASSWORD && e.N8N_MOCK_URL && e.MOCK_V1_STATS && e.TIGERAI_DATA_DIR;
const T = (name, fn) => test(name, { skip: !ready && "set the E2E_* variables, N8N_MOCK_URL and MOCK_V1_STATS" }, fn);
const base = e.E2E_BASE_URL;
const s = {};
const DEFAULT_ALLOW = ["search_workflows", "get_workflow_details", "execute_workflow", "get_workflow_execution"];
const stats = async () => (await fetch(`${e.N8N_MOCK_URL}/__stats`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(c, home, message, existingSid) {
  // existingSid: reuse a session whose MCP tools are already connected (a brand-new session connects them during its first prompt)
  const sid = existingSid ?? (await c.post("/api/agent/new", { cwd: home, type: "ensure_session" })).json.sessionId;
  assert.ok(sid);
  const sent = await c.post(`/api/agent/${sid}`, { type: "prompt", message });
  assert.equal(sent.status, 200, sent.text);
  let text = "";
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const st = (await c.post(`/api/agent/${sid}`, { type: "get_state" })).json.data;
    if (st && !st.isStreaming) { text = (await c.post(`/api/agent/${sid}`, { type: "get_last_assistant_text" })).json.data.text; if (text) break; }
  }
  return { sid, text };
}

T("setup", async () => {
  s.admin = new Client(base); await s.admin.login(e.ADMIN_EMAIL, e.ADMIN_PASSWORD);
  s.a = new Client(base); await s.a.login(e.MEMBER_A_EMAIL, e.MEMBER_A_PASSWORD);
  s.b = new Client(base); await s.b.login(e.MEMBER_B_EMAIL, e.MEMBER_B_PASSWORD);
  s.aMe = (await s.a.get("/api/tg/me")).json;
  s.aHome = (await s.a.get("/api/home")).json.home;
  s.bHome = (await s.b.get("/api/home")).json.home;
  s.tag = Math.random().toString(36).slice(2, 6);
});

T("webhook out: only the groups ticked can use it; the AI gets the number back; every call is audited", async () => {
  const { admin, a, b, tag } = s;
  const group = (await admin.post("/api/tg/admin/groups", { name: `fin${tag}` })).json.group;
  await admin.req("PUT", `/api/tg/admin/groups/${group.id}/members`, { userId: s.aMe.id, present: true });
  const created = await admin.post("/api/tg/admin/n8n/webhooks", { name: `monthly-revenue-${tag}`, url: `${e.N8N_MOCK_URL}/webhook/monthly-revenue`, description: 'Send {"co_id": "<stock code>"}; returns last month revenue.' });
  assert.equal(created.status, 201, created.text);
  const listed = (await admin.get("/api/tg/admin/n8n/webhooks")).json.webhooks.find((w) => w.id === created.json.id);
  assert.ok(!listed.url.includes("monthly-revenue"), "the webhook URL path is not shown after creation");
  assert.equal((await a.get("/api/tg/admin/n8n/webhooks")).status, 403);
  assert.equal((await admin.req("PATCH", `/api/tg/admin/n8n/webhooks/${created.json.id}`, { group_ids: [group.id] })).status, 200);
  const q = `How much revenue did Delta Electronics (2308) make last month? CALL_TOOL:n8n_webhook:{"name":"monthly-revenue-${tag}","payload":{"co_id":"2308"}}`;
  const before = (await stats()).webhook.length;
  const ok = await ask(a, s.aHome, q);
  assert.match(ok.text, /MOCK-TOOL-RESULT/);
  assert.match(ok.text, /36542100/, "the number returned by the workflow is in the reply");
  const seen = await stats();
  assert.equal(seen.webhook.length, before + 1);
  assert.equal(seen.webhook.at(-1).co_id, "2308");
  const sys = await (await fetch(e.MOCK_V1_STATS)).json();
  assert.match(sys.lastSystemText, new RegExp(`monthly-revenue-${tag}`), "the model was told which webhooks exist");
  // someone outside the group: the tool refuses and nothing reaches n8n
  const denied = await ask(b, s.bHome, q);
  assert.match(denied.text, /No webhook named/);
  assert.equal((await stats()).webhook.length, before + 1);
  const actions = (await admin.get("/api/tg/admin/audit?action=n8n.&limit=100")).json.rows.map((r) => r.action);
  assert.ok(actions.includes("n8n.webhook_call") && actions.includes("n8n.webhook_denied"));
});

T("webhook out with a secret header: sent to n8n, never returned", async () => {
  const { admin, a, tag } = s;
  const group = (await admin.post("/api/tg/admin/groups", { name: `hdr${tag}` })).json.group;
  await admin.req("PUT", `/api/tg/admin/groups/${group.id}/members`, { userId: s.aMe.id, present: true });
  const secretValue = e.PORTAL_TEST_KEY_FILE ? (await import("node:fs")).readFileSync(e.PORTAL_TEST_KEY_FILE, "utf8").trim() : `v-${Math.random().toString(36).slice(2)}`;
  const made = await admin.post("/api/tg/admin/n8n/webhooks", { name: `echo-${tag}`, url: `${e.N8N_MOCK_URL}/webhook/portal-test/echo`, description: "Echoes the JSON you send.", header: `X-Portal-Test-Key: ${secretValue}` });
  assert.equal(made.status, 201, made.text);
  await admin.req("PATCH", `/api/tg/admin/n8n/webhooks/${made.json.id}`, { group_ids: [group.id] });
  const list = await admin.get("/api/tg/admin/n8n/webhooks");
  assert.ok(!list.text.includes(secretValue), "the header value is never returned");
  assert.equal(list.json.webhooks.find((w) => w.id === made.json.id).hasHeader, true);
  assert.equal((await admin.post("/api/tg/admin/n8n/webhooks", { name: `bad-${tag}`, url: `${e.N8N_MOCK_URL}/x`, header: "no colon here" })).status, 400);
  const echo = await stats();
  const reply = await ask(a, s.aHome, `Echo it. CALL_TOOL:n8n_webhook:{"name":"echo-${tag}","payload":{"hello":"world"}}`);
  assert.match(reply.text, /fake-n8n/);
  const after = await stats();
  assert.equal(after.echo.length, echo.echo.length + 1);
  assert.equal(after.keyRefused, echo.keyRefused, "the right header reached n8n");
});

T("webhook in: a key per caller, hashed; the AI answers; retries do not ask twice; room posting; audit", async () => {
  const { admin, tag } = s;
  const made = await admin.post("/api/tg/admin/n8n/keys", { name: `wf-${tag}` });
  assert.equal(made.status, 201);
  const plaintext = made.json.plaintext;
  assert.match(plaintext, /^tgk_/);
  const keys = (await admin.get("/api/tg/admin/n8n/keys")).json;
  assert.ok(!JSON.stringify(keys).includes(plaintext), "the key is shown once, never listed");
  const post = (key, body, extra = {}) => fetch(`${base}/api/tigerai/hooks/agent`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra }, body: JSON.stringify(body) });
  assert.equal((await post(null, { message: "hi" })).status, 401);
  assert.equal((await post("tgk_wrong", { message: "hi" })).status, 401);
  assert.equal((await post(plaintext, {})).status, 400);
  const first = await post(plaintext, { message: "What is 2+2?" }, { "idempotency-key": `idem-${tag}` });
  assert.equal(first.status, 200);
  const j1 = await first.json();
  assert.equal(j1.ok, true);
  assert.match(j1.answer, /MOCK-REPLY/);
  const chatsBefore = (await (await fetch(e.MOCK_V1_STATS)).json()).chat;
  const again = await (await post(plaintext, { message: "What is 2+2?" }, { "idempotency-key": `idem-${tag}` })).json();
  assert.equal(again.replayed, true);
  assert.equal(again.answer, j1.answer);
  assert.equal((await (await fetch(e.MOCK_V1_STATS)).json()).chat, chatsBefore, "the retry did not ask the model again");
  // the exchange can be posted into a room
  const room = (await s.a.post("/api/tg/rooms", { name: `hooks-${tag}` })).json.room;
  const roomKey = (await admin.post("/api/tg/admin/n8n/keys", { name: `room-${tag}`, room_id: room.id })).json.plaintext;
  assert.equal((await post(roomKey, { message: "Weekly report is ready" })).status, 200);
  const msgs = (await s.a.get(`/api/tg/rooms/${room.id}`)).json.messages;
  assert.ok(msgs.some((m) => m.kind === "hook" && m.author === `n8n:room-${tag}`));
  assert.ok(msgs.some((m) => m.kind === "ai" && /MOCK-REPLY/.test(m.text)));
  // revoke
  const id = keys.keys.find((k) => k.name === `wf-${tag}`).id;
  assert.equal((await admin.req("DELETE", `/api/tg/admin/n8n/keys/${id}`)).status, 200);
  assert.equal((await post(plaintext, { message: "hi" })).status, 401);
  // audit never holds the key or the text
  const rows = (await admin.get("/api/tg/admin/audit?action=hook.&limit=200")).json.rows;
  assert.ok(rows.some((r) => r.action === "hook.request") && rows.some((r) => r.action === "hook.denied"));
  assert.ok(!JSON.stringify(rows).includes(plaintext) && !JSON.stringify(rows).includes("What is 2+2"));
  // a member cannot manage keys
  assert.equal((await s.a.post("/api/tg/admin/n8n/keys", { name: "x" })).status, 403);
});

