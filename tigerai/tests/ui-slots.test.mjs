// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// UI buffer layer: node --experimental-strip-types --test tigerai/tests/ui-slots.test.mjs
// 1. every slot named in layout.ts has a TgSlot call in upstream code, and every call names a known slot
// 2. every TG-HOOK marker in upstream is listed in hooks.json
// 3. role filtering: a member sees only 設定 in sidebar.bottom and keeps no model picker or thinking control
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CONTACT, NEW_MENU, SETTINGS_TABS, SIDEBAR_BOTTOM, SKILL_TABS, SLOTS, upstreamVisible, visibleItems } from "../ui/layout.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if ([".git", "node_modules", ".next", "tigerai"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}
const upstream = walk(root).map((f) => ({ f: f.slice(root.length + 1), text: readFileSync(f, "utf8") }));
const hooks = JSON.parse(readFileSync(join(root, "tigerai/adapter/hooks.json"), "utf8")).hooks;
const member = { role: "member" }, head = { role: "member", isHead: true }, admin = { role: "admin" };

test("every slot has an upstream call, every call names a known slot", () => {
  const calls = new Map();
  for (const { f, text } of upstream) for (const m of text.matchAll(/<TgSlot name="([\w.]+)"/g)) calls.set(m[1], [...(calls.get(m[1]) ?? []), f]);
  for (const slot of SLOTS) assert.ok(calls.has(slot), `slot ${slot} has no TgSlot call in upstream code`);
  for (const name of calls.keys()) assert.ok(SLOTS.includes(name), `TgSlot name "${name}" is not in layout.ts SLOTS`);
});

test("every TG-HOOK marker in upstream is in hooks.json (id and file)", () => {
  for (const { f, text } of upstream) {
    for (const m of text.matchAll(/TG-HOOK:(H\d\d)/g)) assert.ok(hooks.some((h) => h.id === m[1] && h.file === f), `${m[1]} in ${f} is not in hooks.json`);
    if (/<TgSlot /.test(text)) assert.ok(/TG-HOOK:H\d\d/.test(text), `${f} calls TgSlot without a TG-HOOK marker`);
  }
});

test("sidebar.bottom: 精靈 · 交辦 · 技能 · 設定 for everyone, in that order, no 模型 icon", () => {
  const ids = ["agents", "assignments", "skills", "settings"];
  for (const who of [member, head, admin]) assert.deepEqual(visibleItems(SIDEBAR_BOTTOM, who).map((i) => i.id), ids);
  assert.deepEqual(visibleItems(SIDEBAR_BOTTOM, null), []);
  assert.ok(!SIDEBAR_BOTTOM.some((i) => i.id === "models"), "the 模型 bottom icon is gone (it lives in 設定 › 模型連線)");
  assert.deepEqual(SIDEBAR_BOTTOM.map((i) => i.icon), ["bolt", "task", "layers", "gear"]);
  const i18n = readFileSync(join(root, "tigerai/pages/i18n.ts"), "utf8");
  assert.match(i18n, /btnAgents: "精靈"/); assert.match(i18n, /btnAssignments: "交辦"/); assert.match(i18n, /\bskills: "技能"/); assert.match(i18n, /\bsettings: "設定"/);
  const parts = readFileSync(join(root, "tigerai/ui/parts.tsx"), "utf8");
  assert.match(parts, /flexWrap: "wrap"/, "nothing squeezes on a narrow sidebar or a phone");
});

test("brand.title: one slot, contact popup from CONTACT, no version number anywhere a member sees", () => {
  assert.ok(SLOTS.includes("brand.title"));
  assert.deepEqual(CONTACT.map((c) => c.id), ["email"]);
  const parts = readFileSync(join(root, "tigerai/ui/parts.tsx"), "utf8");
  assert.ok(!/PRODUCT_VERSION/.test(parts), "the empty-conversation hero no longer prints the version");
  const settings = readFileSync(join(root, "tigerai/ui/SettingsOverlay.tsx"), "utf8");
  assert.match(settings, /me\?\.role === "admin" && !me\.mustChangePassword[\s\S]{0,200}data-tg-about/, "version only in the admin's 關於 card");
  const hooksFor = hooks.filter((h) => h.file === "components/SessionSidebar.tsx" && h.anchor === "brand.title");
  assert.equal(hooksFor.length, 1);
  const sidebar = readFileSync(join(root, "components/SessionSidebar.tsx"), "utf8");
  assert.match(sidebar, /<TgSlot name="brand\.title"><PiWebTitle[^\n]*TG-HOOK:H26/);
});

test("sidebar: the + sits next to the search (no order override), rooms fold, conversations and rooms have their own icons", () => {
  const parts = readFileSync(join(root, "tigerai/ui/parts.tsx"), "utf8");
  assert.ok(!/order: -1/.test(parts), "the + is no longer pulled to the far left");
  assert.match(parts, /FoldHead[\s\S]*deptRoomsView/);
  assert.match(parts, /localStorage\.setItem\(`tg-fold-/);
  assert.ok(!/# \{r\.name\}/.test(parts), "no '#' text in front of room names");
  const kit = readFileSync(join(root, "tigerai/ui/kit.tsx"), "utf8");
  assert.match(kit, /\.session-tree-session \.session-tree-main::before/, "conversation icon comes from our stylesheet (no extra upstream hook)");
});

test("members get no model picker and no thinking control; admin keeps both", () => {
  for (const el of ["composer.model", "composer.thinking", "composer.tools", "onboarding.models", "toolbar.tabs"]) {
    assert.equal(upstreamVisible(el, member), false);
    assert.equal(upstreamVisible(el, head), false);
    assert.equal(upstreamVisible(el, null), false);
    assert.equal(upstreamVisible(el, admin), true);
  }
  assert.equal(upstreamVisible("anything.else", member), true);
});

test("設定 = 帳號 for everyone; the 管理 group is admin only; 技能 holds the work-AI tabs", () => {
  assert.deepEqual(visibleItems(SETTINGS_TABS, member).map((i) => i.id), ["account", "dir"]);
  assert.deepEqual(visibleItems(SETTINGS_TABS, head).map((i) => i.id), ["account", "dir", "forms", "userlog"], "a department head also gets 表單 and 使用者紀錄 (the server checks the switch and the scope; 到勤與使用 is gone since 1.1.0-ce)");
  assert.ok(!SETTINGS_TABS.some((i) => i.id === "assignments"), "no 交辦單 tab in Settings: it is the 交辦 modal and the bell");
  const adminTabs = visibleItems(SETTINGS_TABS, admin).filter((i) => i.group === "admin").map((i) => i.id);
  for (const id of ["models", "n8n", "connectors", "forms", "addon", "plugins", "users", "groups", "org", "userlog", "audit", "deleted"]) assert.ok(adminTabs.includes(id), `設定 › 管理 has ${id}`);
  for (const id of ["prompts", "roles", "library", "approvals"]) assert.ok(!SETTINGS_TABS.some((i) => i.id === id), `${id} moved out of 設定`);
  assert.ok(SETTINGS_TABS.filter((i) => i.group === "admin" && i.id !== "userlog" && i.id !== "forms").every((i) => i.roles.length === 1 && i.roles[0] === "admin"));
  assert.deepEqual(SETTINGS_TABS.find((i) => i.id === "userlog").roles, ["head"], "使用者紀錄 is for heads (admins include head)");
  assert.deepEqual(visibleItems(SKILL_TABS, member).map((i) => i.id), ["prompts", "roles", "n8napps", "available"]);
  assert.deepEqual(visibleItems(SKILL_TABS, admin).filter((i) => i.group === "admin").map((i) => i.id), ["install", "roleAdmin", "library", "approvals", "subagents"]);
  assert.ok(SKILL_TABS.filter((i) => i.group === "admin").every((i) => i.roles.length === 1 && i.roles[0] === "admin"));
  const embeds = [...SETTINGS_TABS, ...SKILL_TABS].filter((i) => i.action.kind === "embed").map((i) => i.action.id).sort();
  assert.deepEqual(embeds, ["agents", "plugins", "skills"], "the upstream screens are embedded, never opened as upstream's own window; the MCP page is not among them (the system-connection tab is ours, not upstream's MCP screen)");
  assert.ok(!SETTINGS_TABS.some((i) => i.id === "mcp"));
  assert.deepEqual([...SETTINGS_TABS, ...SKILL_TABS].filter((i) => /connector/i.test(i.id)).map((i) => i.id), ["connectors"], "the community menus carry one system-connection tab (n8n MCP only); the other templates come from the consultant pack");
  assert.equal(visibleItems(NEW_MENU, member).length, 3);
  assert.ok(visibleItems(NEW_MENU, head).some((i) => i.id === "announcement") && !visibleItems(NEW_MENU, member).some((i) => i.id === "announcement"), "新公告 only for heads and admins");
});

test("upstream's own SettingsPanel is not opened from our UI any more (openUpstream is only a fallback)", () => {
  assert.ok(!SIDEBAR_BOTTOM.some((i) => i.action.kind === "upstream"));
  assert.ok(![...SETTINGS_TABS, ...SKILL_TABS].some((i) => i.action.kind === "upstream"));
});

test("labels are i18n keys that exist in the zh table", () => {
  const i18n = readFileSync(join(root, "tigerai/pages/i18n.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-addon.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-n8n.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-userlog.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-knowledge.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-school.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-web.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-mcp.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-forms.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-v11.ts"), "utf8") + readFileSync(join(root, "tigerai/pages/i18n-org.ts"), "utf8");
  for (const item of [...SIDEBAR_BOTTOM, ...NEW_MENU, ...SETTINGS_TABS, ...SKILL_TABS]) assert.ok(new RegExp(`\\b${item.labelKey}:`).test(i18n), `missing i18n key ${item.labelKey}`);
});

test("the bell sits in the toolbar.right slot (no new upstream hook), next to sign-out, and the bubble has no list entry", () => {
  const slots = readFileSync(join(root, "tigerai/ui/slots.tsx"), "utf8");
  assert.match(slots, /"toolbar\.right": \(\) => <><IdleWatcher \/><BellButton \/><SignOutButton \/><\/>/);
  const layout = readFileSync(join(root, "tigerai/ui/layout.ts"), "utf8");
  assert.ok(!/sidebar\.list\.extra.*bulletin/i.test(layout));
  const parts = readFileSync(join(root, "tigerai/ui/parts.tsx"), "utf8");
  assert.match(parts, /startPolling/);
  const store = readFileSync(join(root, "tigerai/ui/bulletin-store.ts"), "utf8");
  assert.match(store, /POLL_MS = 15_000/);
  assert.match(store, /visibilityState === "visible"/);
  assert.match(store, /export function closeBulletin\(\): void \{ set\(\{ open: null \}\); void refreshSummary\(\)/);
});
