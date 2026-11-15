// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// THE single place that decides what appears where in the TigerAI UI. To move, rename (change the i18n text),
// reorder, hide per role or add an item, edit this file. Upstream files only carry the named slots in SLOTS.
// Self-contained on purpose (no imports): the slot test loads it directly.
// `roles` only decides what is SHOWN. Every action is checked again by the server.

export type RoleTag = "admin" | "head" | "member";
export type Action =
  | { kind: "settings"; tab: string }          // open our settings page on a tab
  | { kind: "upstream"; section: string }      // open an upstream settings section (only the error-boundary fallback uses this)
  | { kind: "panel"; id: PanelId }             // open one of our modals: 精靈 / 交辦 / 技能
  | { kind: "embed"; id: EmbedId }             // a tab that shows an upstream screen inside our modal
  | { kind: "command"; id: string };           // a built-in command of the slot (new chat, new room, ...)
export type PanelId = "agents" | "assignments" | "skills";
export type EmbedId = "skills" | "agents" | "plugins" | "mcp";
export interface Item { id: string; icon: string; labelKey: string; descKey?: string; roles: RoleTag[]; action: Action; group?: string }

/** Every slot an upstream file may call. The slot test checks each has a hook and each hook is in hooks.json. */
export const SLOTS = [
  "brand.version",       // ChatWindow: the greeting block on the empty conversation (it used to be the "web v.. pi v.." line)
  "brand.title",         // SessionSidebar: the product name in the sidebar header; click = our contact popup (upstream: version numbers)
  "composer.state",      // ChatWindow: the composer, replaced when a conversation is room-only
  "composer.functions",  // ChatInput: the 功能 button where the model picker sat
  "sidebar.new",         // SessionSidebar: the New button
  "sidebar.list.extra",  // SessionSidebar: rooms above the conversations
  "sidebar.bottom",      // AppShell: footer icon row
  "toolbar.right",       // AppShell: top bar, after the tool icons (sign out)
  "main.override",       // AppShell: the chat area (room view)
  "toolbar.tabs",        // AppShell: top-bar tabs (history, title, agents, system, tools), debug and stats; admins only
  "onboarding.models",   // AppShell: "open Settings > Models" line of the empty-state hint (admins only)
  "chat.truncation",     // MessageView: under the "answer was cut off" notices: the 繼續 button (everyone) and, for admins, 壓縮上下文
  "chat.sender",         // ChatWindow: renders nothing; hands this conversation's normal send function to the 繼續 button
] as const;
export type SlotName = typeof SLOTS[number];

/** Upstream elements that only some roles keep. Anyone else gets "hide" (the server refuses them as well). */
export const UPSTREAM_VISIBLE_TO: Record<string, RoleTag[]> = {
  "toolbar.tabs": ["admin"],
  "onboarding.models": ["admin"],
  "composer.model": ["admin"],
  "composer.thinking": ["admin"],
  "composer.tools": ["admin"],         // the tool-preset picker (English names, capped by the server anyway)
};

/** Shown only to administrators (設定 › 帳號 › 關於). No member sees a version number anywhere. */
export const PRODUCT_VERSION = "1.0.0-ce";

/** What the product-name popup lists. Only e-mail for now; the other contact details are still to be given by the owner. `value` is shown verbatim, `href` makes it a link. */
export const CONTACT: { id: string; labelKey: string; value: string; href?: string }[] = [
  { id: "email", labelKey: "contactEmail", value: "tiger.ai.tw@gmail.com", href: "mailto:tiger.ai.tw@gmail.com" },
];

/** Sidebar footer: icon + name, same four for everyone (what is inside each one is decided by role in its own modal). */
export const SIDEBAR_BOTTOM: Item[] = [
  { id: "agents",      icon: "bolt",   labelKey: "btnAgents",      roles: ["admin", "head", "member"], action: { kind: "panel", id: "agents" } },
  { id: "assignments", icon: "task",   labelKey: "btnAssignments", roles: ["admin", "head", "member"], action: { kind: "panel", id: "assignments" } },
  { id: "skills",      icon: "layers", labelKey: "skills",         roles: ["admin", "head", "member"], action: { kind: "panel", id: "skills" } },
  { id: "settings",    icon: "gear",   labelKey: "settings",       roles: ["admin", "head", "member"], action: { kind: "settings", tab: "account" } },
];

/** Row icons: a conversation and a room each get their own (the old Portal's speech bubbles). Used by RoomListExtra and by the conversation-row CSS in tigerai/ui/kit.tsx. */
export const ROW_ICONS = {
  conversation: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  room: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
} as const;

/** The "+" menu at the top left of the sidebar. */
export const NEW_MENU: Item[] = [
  { id: "chat",       icon: "chat",   labelKey: "newChat",       roles: ["admin", "head", "member"], action: { kind: "command", id: "new-chat" } },
  { id: "room",       icon: "hash",   labelKey: "newRoomItem",   roles: ["admin", "head", "member"], action: { kind: "command", id: "new-room" } },
  { id: "assignment", icon: "task",   labelKey: "newAssignment", roles: ["admin", "head", "member"], action: { kind: "command", id: "new-assignment" } },
  { id: "announcement", icon: "bell", labelKey: "bNewAnnouncement", roles: ["head"], action: { kind: "command", id: "new-announcement" } },
];

/** 設定 = environment and parameters. Everyone: 帳號. Administrators add the 管理 group. */
export const SETTINGS_TABS: Item[] = [
  { id: "account",     icon: "user",   labelKey: "tabAccount",     roles: ["admin", "head", "member"], action: { kind: "settings", tab: "account" } },
  { id: "models",      icon: "cpu",    labelKey: "tabModelConn",   roles: ["admin"], group: "admin", action: { kind: "settings", tab: "models" } },
  { id: "n8n",         icon: "flow",   labelKey: "tabN8nConn",     roles: ["admin"], group: "admin", action: { kind: "settings", tab: "n8n" } },
  { id: "plugins",     icon: "plug",   labelKey: "tabPlugins",     roles: ["admin"], group: "admin", action: { kind: "embed", id: "plugins" } },
  { id: "users",       icon: "users",  labelKey: "users",          roles: ["admin"], group: "admin", action: { kind: "settings", tab: "users" } },
  { id: "groups",      icon: "users",  labelKey: "groups",         roles: ["admin"], group: "admin", action: { kind: "settings", tab: "groups" } },
  { id: "org",         icon: "org",    labelKey: "org",            roles: ["admin"], group: "admin", action: { kind: "settings", tab: "org" } },
  { id: "audit",       icon: "list",   labelKey: "audit",          roles: ["admin"], group: "admin", action: { kind: "settings", tab: "audit" } },
  { id: "deleted",     icon: "trash",  labelKey: "tabDeleted",     roles: ["admin"], group: "admin", action: { kind: "settings", tab: "deleted" } },
  { id: "addon",       icon: "layers", labelKey: "tabAddon",       roles: ["admin"], group: "admin", action: { kind: "settings", tab: "addon" } },
];

/** 技能 = the AI I use for work, and (administrators) how it is stocked. Tabs inside the 技能 modal. */
export const SKILL_TABS: Item[] = [
  { id: "prompts",   icon: "prompt",   labelKey: "tabMyPrompts",    roles: ["admin", "head", "member"], action: { kind: "panel", id: "skills" } },
  { id: "roles",     icon: "robot",    labelKey: "tabRolesUse",     roles: ["admin", "head", "member"], action: { kind: "panel", id: "skills" } },
  { id: "n8napps",   icon: "flow",     labelKey: "fnN8n",           roles: ["admin", "head", "member"], action: { kind: "panel", id: "skills" } },
  { id: "available", icon: "layers",   labelKey: "tabAvailSkills",  roles: ["admin", "head", "member"], action: { kind: "panel", id: "skills" } },
  { id: "install",   icon: "layers",   labelKey: "tabInstallSkills", roles: ["admin"], group: "admin", action: { kind: "embed", id: "skills" } },
  { id: "roleAdmin", icon: "robot",    labelKey: "tabRolesAdmin",        roles: ["admin"], group: "admin", action: { kind: "panel", id: "skills" } },
  { id: "library",   icon: "prompt",   labelKey: "tabPromptLibrary", roles: ["admin"], group: "admin", action: { kind: "panel", id: "skills" } },
  { id: "approvals", icon: "task",     labelKey: "shareRequest",    roles: ["admin"], group: "admin", action: { kind: "panel", id: "skills" } },
  { id: "subagents", icon: "robot",    labelKey: "tabSubagents",    roles: ["admin"], group: "admin", action: { kind: "embed", id: "agents" } },
];

/** The 功能 list. Each entry is a source that the menu fills from the server. */
export const FUNCTION_SOURCES: Item[] = [
  { id: "roles", icon: "robot", labelKey: "fnRoles", descKey: "fnRolesDesc", roles: ["admin", "head", "member"], action: { kind: "command", id: "fn-roles" } },
  { id: "n8n",   icon: "flow",  labelKey: "fnN8n",   descKey: "fnN8nDesc",   roles: ["admin", "head", "member"], action: { kind: "command", id: "fn-n8n" } },
  { id: "plain", icon: "chat",  labelKey: "fnPlain", descKey: "fnPlainDesc", roles: ["admin", "head", "member"], action: { kind: "command", id: "fn-plain" } },
];

/** admin includes head and member; head includes member. */
export function rolesOf(me: { role: string; isHead?: boolean } | null | undefined): RoleTag[] {
  if (!me) return [];
  if (me.role === "admin") return ["admin", "head", "member"];
  return me.isHead ? ["head", "member"] : ["member"];
}
export function visibleItems(items: Item[], me: { role: string; isHead?: boolean } | null | undefined): Item[] {
  const mine = rolesOf(me);
  return items.filter((i) => i.roles.some((r) => mine.includes(r)));
}
/** Whether an upstream element is kept for this person. Unknown people (not loaded yet) never keep a restricted element. */
export function upstreamVisible(name: string, me: { role: string; isHead?: boolean } | null | undefined): boolean {
  const allowed = UPSTREAM_VISIBLE_TO[name];
  if (!allowed) return true;
  const mine = rolesOf(me);
  return allowed.some((r) => mine.includes(r));
}
