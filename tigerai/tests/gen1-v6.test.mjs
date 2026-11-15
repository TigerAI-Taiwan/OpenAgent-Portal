// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Batch v6 regressions: node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-v6.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("failure 1: a member's home folder only stands in for an empty session list once the list has loaded", () => {
  const src = read("components/SessionSidebar.tsx");
  // Before the fix the guard was `allSessions.length === 0 && !tgHome`: for a member the effect ran on the first
  // render, before /api/sessions answered, found no session for ?session=<id> and toasted "no longer exists".
  assert.ok(!/allSessions\.length === 0 && !tgHome\)/.test(src), "guard must not let tgHome bypass the empty-list wait");
  assert.match(src, /allSessions\.length === 0 && !\(tgHome && sessionDetailsLoaded\)/);
});

import { isAgentCreate } from "../ui/role-rule.ts";

test("failure 2: only the conversation-creating call is tagged with the picked role", () => {
  assert.equal(isAgentCreate("/api/agent/new", "POST"), true);
  assert.equal(isAgentCreate("http://x/api/agent/new?a=1", "post"), true);
  assert.equal(isAgentCreate("/api/agent/new", "GET"), false);
  assert.equal(isAgentCreate("/api/agent/abc", "POST"), false);
  assert.equal(isAgentCreate("/api/agent/new-thing", "POST"), false);
});

test("failure 2: a 功能 pick creates no conversation of its own", () => {
  const parts = read("tigerai/ui/parts.tsx");
  const fn = parts.slice(parts.indexOf("export function FunctionsButton"));
  assert.ok(!/api\/agent\/new/.test(fn), "FunctionsButton must not call /api/agent/new (an empty leftover per pick)");
  assert.match(fn, /startConversation\(/);
  assert.match(read("tigerai/ui/start.ts"), /startNewChat\(\)/);
  assert.match(read("tigerai/ui/role-fetch.ts"), /x-agent-role/);
});

import { parseDue } from "../workorders/assignments.ts";

test("failure 5: a due day is stored as noon UTC so no time zone moves it to another day", () => {
  const ms = parseDue("2026-11-30");
  assert.equal(new Date(ms).toISOString(), "2026-11-30T12:00:00.000Z");
  for (const tz of [-11, 0, 8, 11]) assert.equal(new Date(ms + tz * 3600000).toISOString().slice(0, 10), "2026-11-30");
});

import { quietAnswer } from "../ui/member-quiet.ts";
import { auditActionZh, auditSummary } from "../accounts/audit-text.ts";
import { isEmbeddingModel } from "../provider/model-kind.ts";

test("failure 10: the four admin-only upstream GETs get a quiet answer for members; writes and other paths are untouched", () => {
  for (const u of ["/api/open-in-explorer", "/api/worktrees?cwd=/x", "/api/git/status?cwd=/x", "/api/project-trust?cwd=/x"]) assert.ok(quietAnswer(u, "GET"), u);
  assert.equal(quietAnswer("/api/project-trust", "POST"), null);
  assert.equal(quietAnswer("/api/sessions", "GET"), null);
  assert.equal(quietAnswer("/api/models?cwd=/x", "GET"), null);
  assert.ok(quietAnswer("/api/models", "GET"));
  assert.equal(quietAnswer("/api/project-trust?cwd=/x", "GET").body.requiresTrust, false);
});

test("failure 9: audit rows read in Chinese with names, not codes or JSON", () => {
  assert.equal(auditActionZh("room.restore"), "還原頻道");
  assert.equal(auditActionZh("something.new"), "something.new");
  const names = { user: { u1: "林小華" }, room: { r1: "月結小組" } };
  const resolve = (k, id) => names[k]?.[id];
  assert.equal(auditSummary(JSON.stringify({ roomId: "r1", userId: "u1" }), resolve), "頻道:月結小組 · 對象:林小華");
  assert.equal(auditSummary(JSON.stringify({ roomId: "gone", sha256: "abc" }), resolve), "");
  assert.equal(auditSummary("not json", resolve), "");
});

test("failure 11: embedding models are recognised and never chat models", () => {
  for (const id of ["Nemotron-3-Embed-8B", "gpt-Nemotron-3-Embed-8B", "bge-m3", "text-embedding-3-small", "rerank-v2"]) assert.ok(isEmbeddingModel(id), id);
  for (const id of ["tigerai-fast", "qwen3.8-27b-w4", "deepseek-v4-flash"]) assert.ok(!isEmbeddingModel(id), id);
});

test("failures 4, 7, 12, 14: source-level guards", () => {
  assert.match(read("tigerai/ui/RoomView.tsx"), /POLL_MS = 2000/);
  assert.match(read("tigerai/ui/store.ts"), /x\.id === open \? \{ \.\.\.x, unread: 0/);
  assert.match(read("tigerai/rooms/service.ts"), /h\.is_manager=1 AND rm\.room_id=r\.id/);
  assert.match(read("tigerai/ui/parts.tsx"), /deptRoomsView/);
  assert.match(read("tigerai/ui/i18n-overrides.ts"), /"sidebar\.brandLabel": "OpenAgent Portal"/);
  assert.match(read("tigerai/ui/parts.tsx"), /useUpstreamLocale\(\)/);
});

test("failure 3: a ?session= link to a channel's own conversation shows the disabled composer even though the list lacks it", () => {
  assert.match(read("tigerai/ui/store.ts"), /sessions\/\$\{encodeURIComponent\(sid\)\}\/info/);
  const rv = read("tigerai/ui/RoomView.tsx");
  assert.match(rv, /ui\.roomOnly && !ui\.roomId/);
  assert.match(rv, /DisabledComposer reason=\{tr\("roomOnly"\)\}/);
});
