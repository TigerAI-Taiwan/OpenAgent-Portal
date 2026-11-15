// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Pure-logic regressions from the first run on clean demo data (no server needed):
//   node --experimental-strip-types --test tigerai/tests/gen1-fixes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WRITE_TOOLS = ["create_workflow_from_code", "update_workflow", "publish_workflow", "archive_workflow"];

test("room-session guard: structure (route hook before any command runs; channel path is in-process, not HTTP)", () => {
  const route = readFileSync(new URL("../../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const hook = route.indexOf("roomSessionGuard(id, body.type); // TG-HOOK:H13");
  assert.ok(hook > 0, "hook present");
  assert.ok(hook < route.indexOf('body.type === "set_tools"'), "hook runs before set_tools and send()");
  const ai = readFileSync(new URL("../rooms/ai.ts", import.meta.url), "utf8");
  assert.ok(!/\/api\/agent\//.test(ai), "the channel drives the wrapper in-process, so the route guard cannot block it");
  assert.match(ai, /wrapper\.send\(\{ type: "prompt"/);
});

import { roomCommandRefused, ROOM_SESSION_MESSAGE } from "../rooms/room-guard.ts";
test("room-session guard: every sending command is refused on a room session, reads and ordinary sessions pass", () => {
  assert.equal(ROOM_SESSION_MESSAGE, "這段對話只能從頻道使用");
  for (const type of ["prompt", "steer", "follow_up", "bash", "abort", "set_model", "set_tools", "compact", "navigate_tree", "fork", "extension_ui_response", undefined, 5])
    assert.equal(roomCommandRefused(true, type), true, String(type));
  for (const type of ["get_state", "get_tools", "get_commands", "get_last_assistant_text", "ensure_session"])
    assert.equal(roomCommandRefused(true, type), false, type);
  for (const type of ["prompt", "steer", "bash"]) assert.equal(roomCommandRefused(false, type), false, "ordinary session untouched");
});

// ---- error codes become Chinese on the page; unknown ones keep the server text ----
test("localizeError: known code and codeless message are Chinese, unknown stays as sent", async () => {
  const { localizeError } = await import("../pages/i18n.ts");
  assert.equal(localizeError("not_configured", "No base URL is configured"), "尚未設定 v1 基底網址");
  assert.equal(localizeError(undefined, "Administrator only"), "僅限管理員");
  assert.equal(localizeError("brand_new_code", "Something new"), "Something new");
});
