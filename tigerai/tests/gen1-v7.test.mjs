// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Batch v7 regressions: node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-v7.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tg-v7-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const acc = await import("../accounts/service.ts");
const n8n = await import("../n8n/service.ts");
const { createN8nExtension } = await import("../n8n/extension.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const { setRoomSpeaker, clearRoomSpeaker, roomSpeaker } = await import("../rooms/speaker.ts");
const { getDb } = await import("../db/store.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const wang = mk("wang@example.com", "王小明");
const lin = mk("lin@example.com", "林小華");
const tester = mk("tester@example.com", "測試員");   // no group
const finance = acc.createGroup(null, { name: "財務部" });
const sales = acc.createGroup(null, { name: "業務部" });
acc.setMembership(null, finance.id, wang.id, true);
acc.setMembership(null, finance.id, lin.id, true);
acc.setMembership(null, sales.id, tester.id, false);

const hook = n8n.saveWebhook(admin.id, { name: "mops-revenue", display_name: "查月營收", url: "http://127.0.0.1:9/webhook/x", description: "傳入 co_id", group_ids: [finance.id] });

// A room assistant session as ensureRoleSession leaves it: owned by the room's creator, bound to the room.
const ROOM_SESSION = "room-session-1";
registerOwner(ROOM_SESSION, wang.id, join(dir, "rooms/r1"), "room-role", "r1");

// Minimal stand-in for pi's extension API: collects handlers and the tool.
function load() {
  const handlers = new Map(); const tools = new Map(); const mcp = [];
  const pi = { on: (n, f) => handlers.set(n, f), registerTool: (t) => tools.set(t.name, t), registerMcpServer: (n) => mcp.push(n), unregisterMcpServer: () => {} };
  createN8nExtension().factory(pi);
  return { handlers, tools, mcp };
}
const ctx = (sid) => ({ sessionManager: { getSessionId: () => sid }, cwd: join(dir, "rooms/r1") });
const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

test("H3: a room assistant has no n8n access until somebody speaks, and gets exactly the speaker's", async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{"revenue":74666163}', { status: 200 }); };
  const { handlers, tools } = load();
  const run = async (sid, name) => (await tools.get("n8n_webhook").execute("c", { name, payload: { co_id: "2308" } }, undefined, undefined, ctx(sid))).content[0].text;

  // nobody speaking: no identity, no webhook (fail closed)
  assert.match(await run(ROOM_SESSION, "mops-revenue"), /No webhook named/);
  assert.equal(calls.length, 0);

  // 王小明 (財務部) speaks: allowed, by id and by display name
  setRoomSpeaker(ROOM_SESSION, wang.id);
  assert.match(await run(ROOM_SESSION, "mops-revenue"), /74666163/);
  assert.match(await run(ROOM_SESSION, "查月營收"), /74666163/);
  const prompt = await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx(ROOM_SESSION));
  assert.match(prompt.systemPrompt, /mops-revenue \(查月營收\)/);
  clearRoomSpeaker(ROOM_SESSION);

  // 測試員 (no matching group) speaks next in the SAME session: nothing leaks from the previous speaker
  setRoomSpeaker(ROOM_SESSION, tester.id);
  const before = calls.length;
  assert.match(await run(ROOM_SESSION, "mops-revenue"), /No webhook named/);
  assert.equal(calls.length, before, "the webhook was not called for the tester");
  assert.equal(await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx(ROOM_SESSION)), undefined, "no webhook list for the tester");
  clearRoomSpeaker(ROOM_SESSION);

  // the room creator (王小明 owns the session row) does not count when somebody else speaks
  setRoomSpeaker(ROOM_SESSION, tester.id);
  assert.equal(roomSpeaker(ROOM_SESSION).id, tester.id);
  clearRoomSpeaker(ROOM_SESSION);
  assert.equal(roomSpeaker(ROOM_SESSION), null);

  // 林小華 (also 財務部) works too; a disabled account does not
  setRoomSpeaker(ROOM_SESSION, lin.id);
  assert.match(await run(ROOM_SESSION, "mops-revenue"), /74666163/);
  getDb().prepare("UPDATE users SET status='disabled' WHERE id=?").run(lin.id);
  assert.equal(roomSpeaker(ROOM_SESSION), null);
  clearRoomSpeaker(ROOM_SESSION);
  const audit = getDb().prepare("SELECT actor_id FROM audit WHERE action='n8n.webhook_call'").all().map((r) => r.actor_id);
  assert.ok(audit.includes(wang.id) && audit.includes(lin.id) && !audit.includes(tester.id), "calls are audited under the speaker");
});

test("H3: the room job registers the speaker for its run only", () => {
  const src = read("tigerai/rooms/ai.ts");
  assert.match(src, /setRoomSpeaker\(sessionId, job\.requesterId\)/);
  assert.match(src, /finally \{ clearRoomSpeaker\(sessionId\); \}/);
});

test("item 3: a webhook has a Chinese display name apart from its lowercase id", () => {
  assert.throws(() => n8n.saveWebhook(admin.id, { name: "查月營收", url: "http://x.test/h" }), /Name/);
  const listed = n8n.listWebhooks().find((w) => w.id === hook.id);
  assert.equal(listed.name, "mops-revenue");
  assert.equal(listed.display_name, "查月營收");
  const apps = n8n.appsFor({ id: wang.id, role: "member" }).filter((a) => a.kind === "webhook");
  assert.equal(apps[0].label, "查月營收");
  assert.equal(apps[0].name, "mops-revenue");
  // renaming keeps everything else
  n8n.saveWebhook(admin.id, { display_name: "月營收查詢" }, hook.id);
  assert.equal(n8n.listWebhooks().find((w) => w.id === hook.id).group_ids[0], finance.id);
  n8n.saveWebhook(admin.id, { display_name: "查月營收" }, hook.id);
  // no display name: the id is shown
  const bare = n8n.saveWebhook(admin.id, { name: "bare-hook", url: "http://x.test/b", group_ids: [finance.id] });
  assert.equal(n8n.appsFor({ id: wang.id, role: "member" }).find((a) => a.id === bare.id).label, "bare-hook");
});

test("item 2: a forced password change shows its own form instead of redirecting back to the gate", () => {
  const app = read("tigerai/pages/TgApp.tsx");
  assert.match(app, /if \(r\.data\.mustChangePassword\) \{ setForced\(true\); return; \}/);
  assert.match(app, /if \(forced\) return <ForcedPasswordChange \/>/);
  assert.match(app, /r\.data\.mustChangePassword \? "\/tg\/account"/, "login goes to the form's own page, which the gate lets through");
  assert.ok(!/mustChangePassword \? "\/\?settings=account"/.test(app), "the gate redirects / back to /tg/account: that was the loop");
  const gate = read("tigerai/adapter/gate.ts");
  assert.match(gate, /PWC_ALLOWED = new Set\(\["\/tg\/account", "\/api\/tg\/me", "\/api\/tg\/logout", "\/api\/tg\/account\/password"\]\)/);
});

test("item 4: every destructive click in the app asks first", () => {
  const app = read("tigerai/pages/TgApp.tsx");
  for (const m of app.matchAll(/^.*"DELETE".*$/gm)) assert.match(m[0], /ask\(|const run = /, `no confirm around: ${m[0].trim().slice(0, 90)}`);
  // 停用 became the 離職 dialog (it lists what is handed over and asks before it does anything); the org sheet's apply asks in OrgPanel.
  assert.match(app, /setLeaving\(u\)/);
  assert.match(read("tigerai/ui/OrgPanel.tsx"), /ask\(tr\("orgApplyAsk"\)/);
  for (const frag of ["reset(u)", 'decide(o.id, true)', 'decide(o.id, false)', 'member(g.id, m.user_id, false)']) {
    const line = app.split("\n").find((l) => l.includes(frag));
    assert.ok(line && /ask\(/.test(line), `confirm for ${frag}`);
  }
  const room = read("tigerai/ui/RoomView.tsx");
  assert.match(room, /ask\(tr\("cfRemoveRoomMember"/);
  assert.match(room, /dlg === "close" && <ConfirmDialog/);
  assert.match(room, /dlg === "delete" && <ConfirmDialog/);
  assert.ok(!/run: \(\) => void act\(info\.closed \? "\/reopen" : "\/close"\)/.test(room), "close must not run straight from the menu");
});

test("item 5: a channel's own conversation link raises no 'no longer exists' toast", async () => {
  const { shouldToastMissingSession } = await import("../ui/store.ts");
  const real = globalThis.fetch;
  const answer = (status, body) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status }); };
  answer(200, { roomOnly: true }); assert.equal(await shouldToastMissingSession("s1"), false);
  answer(200, { roomOnly: false }); assert.equal(await shouldToastMissingSession("s1"), true);
  answer(404, {}); assert.equal(await shouldToastMissingSession("s1"), true);
  globalThis.fetch = async () => { throw new Error("offline"); }; assert.equal(await shouldToastMissingSession("s1"), true);
  globalThis.fetch = real;
  assert.match(read("components/SessionSidebar.tsx"), /shouldToastMissingSession\(initialSessionId \?\? null\)\.then/);
});

test("item 6: n8n group boxes change at once and cannot be double-clicked", () => {
  const app = read("tigerai/pages/TgApp.tsx");
  assert.match(app, /if \(lock\.current\.has\(key\)\) return;/);
  assert.match(app, /disabled=\{saving\.has\(`\$\{kind\}:\$\{it\.id\}`\)\}/);
  assert.match(app, /if \(!r\.ok\) show\(prev\);/, "a refused save puts the old state back");
});

test("item 7: a 功能 pick waits until a fresh conversation can really be started", async () => {
  const store = await import("../ui/store.ts");
  assert.equal(store.startNewChat(), false, "nothing registered: not started");
  let started = 0;
  store.registerNewChat(() => { started++; }, false);       // sidebar mounted, no folder chosen yet
  assert.equal(store.startNewChat(), false);
  assert.equal(started, 0, "a not-ready sidebar must not be asked (it would do nothing and the old conversation stays)");
  const waiting = store.waitNewChatReady(2000);
  setTimeout(() => store.registerNewChat(() => { started++; }, true), 250);
  assert.equal(await waiting, true);
  assert.equal(store.startNewChat(), true);
  assert.equal(started, 1);
  store.registerNewChat(null);
  assert.equal(await store.waitNewChatReady(150), false, "gives up and the caller falls back to a page load");
  assert.match(read("tigerai/ui/start.ts"), /const ready = await waitNewChatReady\(\)/);
  assert.match(read("components/SessionSidebar.tsx"), /ready: !!selectedCwd/);
});

test("item 8: the admin picker's 'auto' and 'configured' are Chinese", async () => {
  const { tr } = await import("../pages/i18n.ts");
  assert.equal(tr("autoLabel"), "自動");
  assert.equal(tr("configuredLabel"), "已設定");
  const slots = read("tigerai/ui/slots.tsx");
  assert.match(slots, /composer\.thinking\.\$\{l\}/);
  assert.equal(tr("thinkMedium"), "中等"); assert.equal(tr("thinkOff"), "關閉"); assert.equal(tr("thinkPrefix"), "推理");
  assert.match(slots, /"composer\.tools\.configured": \(\) => tr\("configuredLabel"\)/);
  const input = read("components/ChatInput.tsx");
  assert.equal((input.match(/tg\.text\(`composer\.(thinking|tools)\./g) ?? []).length, 4);
});
