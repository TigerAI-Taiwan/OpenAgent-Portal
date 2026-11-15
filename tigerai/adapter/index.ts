// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { tgEnabled } from "../config";
import { gate, UID_HEADER } from "./gate";
import { bootstrapAdmin, userById, type Role } from "../accounts/service";
import { bootstrapVendor } from "../accounts/vendor";
import { getDb } from "../db/store";
import { canAccessSession, filterAccessible, getOwner, registerOwner, roomBoundIds, sessionIsRestricted } from "../rooms/ownership";
import { ensurePersonalDir, isRestrictedCwd, memberCwdAllowed, memberRoots, isInside } from "../workspace";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { ROOM_SESSION_MESSAGE, roomCommandRefused } from "../rooms/room-guard";
import { provisionV1 } from "../provider/v1";
import { createFallbackExtension } from "../provider/fallback-runtime";
import { createLoopGuardExtension } from "../agents/loop-guard";
import { guardCatalogs, personalOwnerFor, personalExtensionsFor, registerPendingOwner } from "../provider/personal-runtime";
import { lastPick } from "../provider/personal";
import { createCompletionPushExtension } from "../push/extension";
import { dropOwnerlessUpstreamSubscriptions } from "../push";
import { workspaceLabels } from "./labels";
import { createPathGuard } from "./path-guard";
import { managedRoot } from "../knowledge/store";
import { createPromptLibraryExtension } from "./prompt-library";
import { addonSessionExtensions } from "../addons/registry";
import { createN8nExtension } from "../n8n/extension";
import { createWebExtension } from "../web/extension";
import { createSlidesExtension } from "../slides/extension";
import { createMcpExtension } from "../n8nmcp/extension";
import { createFormsExtension } from "../forms/extension";
import { startScheduler } from "../wizards/scheduler";
import { createRoleExtension, forgetPendingRole, registerPendingRole, roleForSession } from "../agents/runtime";
import { startable } from "../agents/personal";
import { getAgent } from "../agents/service";
import { writeAudit } from "../accounts/audit";
import { installBuiltinSkills } from "../skills/builtin";
import { skillsDir } from "../wizards/skill-writer";
import { sweepInterruptedRuns } from "../workorders/ai-run";

/**
 * The adapter: the only module upstream files import. With TIGERAI_ENABLED
 * unset every function is a no-op, so upstream behaves exactly as before.
 * Once enabled, any internal error fails closed (503 / 403 / empty list /
 * read-only tools) and is never turned into "everyone sees everything".
 */

export type Identity = { userId: string; role: Role; name: string; dirName: string };

let failed = false;
let initialised = false;

export async function init(): Promise<void> {
  if (!tgEnabled() || initialised) return;
  try {
    guardCatalogs(); // keeps personal providers out of upstream's process-wide model catalog (only when the module is on)
    getDb();
    bootstrapAdmin();
    bootstrapVendor();
    // Upstream's broadcast "session complete" list has no owners; it is emptied so only our owner-bound pushes remain.
    try { const n = dropOwnerlessUpstreamSubscriptions((await import("../../lib/session-reader")).getAgentDir()); if (n) console.log(`[tigerai] dropped ${n} ownerless push subscription(s)`); } catch { /* best effort */ }
    // AI orders that were 進行中 when the server stopped are handed back as 待確認 (no automatic restart).
    try { sweepInterruptedRuns(); } catch (e) { console.error("[tigerai] sweep of interrupted AI orders failed:", e instanceof Error ? e.message : e); }
    // 內建技能 are rewritten at every start (the originals stay as shipped); people's copies live elsewhere and are never touched.
    try { installBuiltinSkills(); } catch (e) { console.error("[tigerai] built-in skills failed:", e instanceof Error ? e.message : e); }
    // The one model source. A failure here must not stop the portal (the admin page shows the error).
    await provisionV1().catch((e) => console.error("[tigerai] model provisioning failed:", e instanceof Error ? e.message : e));
    // The Portal's own wizard schedule (community edition); an add-on's external scheduler makes it stand down.
    startScheduler();
    initialised = true;
  } catch (error) {
    failed = true;
    console.error("[tigerai] startup failed; serving 503 until fixed:", error instanceof Error ? error.message : error);
  }
}

/** Returns null at once when the module is off (upstream proxy stays synchronous); otherwise a promise. */
export function proxyGate(req: NextRequest): Promise<NextResponse> | null {
  if (!tgEnabled()) return null;
  return (async () => {
    try {
      // The proxy may run in its own bundle that never saw instrumentation.
      if (!initialised && !failed) await init();
      return await gate(req, failed);
    } catch (error) {
      console.error("[tigerai] gate error:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "TigerAI gate error" }, { status: 503 });
    }
  })();
}

export function identityOf(req: Request): Identity | null {
  if (!tgEnabled()) return null;
  const uid = req.headers.get(UID_HEADER);
  if (!uid) return null;
  try {
    const u = userById(uid);
    if (!u || u.status !== "active") return null;
    return { userId: u.id, role: u.role, name: u.name, dirName: u.dir_name };
  } catch {
    return null;
  }
}

function deny(status: number, error: string): Response {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function filterSessions<T extends { id: string }>(req: Request, list: T[]): Promise<T[]> {
  if (!tgEnabled()) return list;
  const who = identityOf(req);
  if (!who) return [];
  try {
    // A channel's AI conversation is shared and has no personal identity (no templates, no n8n); listed in
    // a sidebar it showed the channel id as a project and invited people to type into it. It is read in the channel.
    const rooms = roomBoundIds(list.map((s) => s.id));
    const visible = list.filter((s) => !rooms.has(s.id));
    if (who.role === "admin") return visible;
    const ok = new Set(filterAccessible({ id: who.userId, role: who.role }, visible.map((s) => s.id)));
    return visible.filter((s) => ok.has(s.id));
  } catch (error) {
    console.error("[tigerai] filterSessions:", error);
    return [];
  }
}

export async function filterIds(req: Request, ids: string[]): Promise<string[]> {
  if (!tgEnabled()) return ids;
  const who = identityOf(req);
  if (!who) return [];
  if (who.role === "admin") return ids;
  try {
    return filterAccessible({ id: who.userId, role: who.role }, ids);
  } catch {
    return [];
  }
}

/** Keeps only the keys of an id-keyed object (ui-state pins, read times) that the caller may see. */
export async function filterIdKeyed<T extends Record<string, unknown>>(req: Request, obj: T | undefined): Promise<T | undefined> {
  if (!tgEnabled() || !obj) return obj;
  const keep = new Set(await filterIds(req, Object.keys(obj)));
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keep.has(k))) as T;
}

/** Pins, archive and read times are keyed by session id: show a member only their own keys. */
export async function filterUiState<S extends { sessions: Record<string, unknown>; readAt?: Record<string, number> }>(req: Request, state: S): Promise<S> {
  if (!tgEnabled()) return state;
  const sessions = (await filterIdKeyed(req, state.sessions)) ?? {};
  const readAt = await filterIdKeyed(req, state.readAt);
  const who = identityOf(req);
  let projectNames = (state as { projectNames?: Record<string, string> }).projectNames;
  if (who) {
    try { projectNames = { ...workspaceLabels({ id: who.userId, role: who.role }), ...(projectNames ?? {}) }; } catch (error) { console.error("[tigerai] workspaceLabels:", error); }
  }
  // The person's own folder is always listed (as a pinned project), so a first-time member has somewhere to start.
  let projects = (state as { projects?: Record<string, { pinnedAt: number; root: string }> }).projects;
  if (who) {
    try {
      const own = ensurePersonalDir(who.userId);
      projects = { ...(projects ?? {}), [own]: projects?.[own] ?? { pinnedAt: 1, root: own } };
    } catch (error) { console.error("[tigerai] personal folder:", error); }
  }
  return { ...state, sessions, ...(projects ? { projects } : {}), ...(readAt ? { readAt } : {}), ...(projectNames ? { projectNames } : {}) };
}

export async function checkCwd(req: Request, cwd: string): Promise<Response | null> {
  if (!tgEnabled()) return null;
  const who = identityOf(req);
  if (!who) return deny(403, "Not signed in");
  if (who.role === "admin") return null;
  try {
    return memberCwdAllowed({ id: who.userId }, cwd) ? null : deny(403, "That folder is not available to you");
  } catch {
    return deny(403, "That folder is not available to you");
  }
}

export async function checkPath(req: Request, absPath: string): Promise<Response | null> {
  if (!tgEnabled()) return null;
  const who = identityOf(req);
  if (!who) return deny(403, "Not signed in");
  if (who.role === "admin") return null;
  try {
    const roots = memberRoots({ id: who.userId });
    // A file that does not exist yet is judged by its nearest existing parent.
    let probe = absPath;
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    return roots.some((r) => isInside(probe, r) && isInside(absPath, r)) ? null : deny(403, "Access denied");
  } catch {
    return deny(403, "Access denied");
  }
}

export const ROLE_HEADER = "x-agent-role";

/**
 * A conversation started from an AI role (功能 menu). Header `x-agent-role: <agentId>` on POST /api/agent/new.
 * Returns undefined (no header: upstream behaviour), a 403 Response (unknown role or not allowed to this person:
 * never a silent plain conversation), or the start options to spread (the role's own model, never a member's pick).
 */
export async function pendingRoleFor(req: Request, tempKey: string): Promise<Response | { initialModel?: { provider: string; modelId: string } } | undefined> {
  if (!tgEnabled()) return undefined;
  // Whoever starts a conversation over HTTP is its owner from the first moment: their personal model connections (if any) are
  // registered into this conversation only. The temporary key is all startExtensions sees for a brand-new conversation.
  try { const owner = identityOf(req); if (owner) registerPendingOwner(tempKey, owner.userId); } catch { /* no personal connections then */ }
  const wanted = req.headers.get(ROLE_HEADER);
  // The person's chosen personal model sticks: a role or an app (a fresh composer) must not drop them back to the public default.
  // Only an explicit model of the role itself replaces it. (The pick is recorded by the gate from the request that named it.)
  let kept: { initialModel: { provider: string; modelId: string } } | undefined;
  try { const w = identityOf(req); const pick = w ? lastPick(w.userId) : null; if (pick) kept = { initialModel: pick }; } catch { /* no kept pick */ }
  if (!wanted) return kept;
  try {
    const who = identityOf(req);
    const role = who && startable({ id: who.userId, role: who.role }, wanted) ? getAgent(wanted) : undefined;
    if (!who || !role) return deny(403, "That AI role is not available to you");
    registerPendingRole(tempKey, role.id);
    setTimeout(() => forgetPendingRole(tempKey), 10 * 60_000).unref?.();
    return role.model ? { initialModel: role.model } : kept ?? {};
  } catch (error) {
    console.error("[tigerai] pendingRoleFor:", error);
    return deny(403, "That AI role is not available to you");
  }
}

export async function onSessionCreated(req: Request, sessionId: string, cwd: string): Promise<void> {
  if (!tgEnabled()) return;
  const who = identityOf(req);
  if (!who) return;
  try {
    const wanted = req.headers.get(ROLE_HEADER);
    if (wanted && startable({ id: who.userId, role: who.role }, wanted)) {
      getDb().prepare("INSERT OR IGNORE INTO session_roles (session_id,agent_id,user_id,created_at) VALUES (?,?,?,?)").run(sessionId, wanted, who.userId, Date.now());
      writeAudit("role.session_start", who.userId, { sessionId, agentId: wanted });
    }
    const roomMatch = /[\\/]rooms[\\/]([^\\/]+)[\\/]?$/.exec(cwd);
    registerOwner(sessionId, who.userId, cwd, "chat", roomMatch ? roomMatch[1] : null);
  } catch (error) {
    console.error("[tigerai] onSessionCreated:", error);
  }
}

export async function onSessionForked(req: Request, parentId: string, newId: string): Promise<void> {
  if (!tgEnabled()) return;
  const who = identityOf(req);
  if (!who) return;
  try {
    const parent = getOwner(parentId);
    // A fork keeps the parent's room binding (so it stays read-only) but belongs to the person who forked.
    registerOwner(newId, who.userId, parent?.cwd ?? null, "fork", parent?.room_id ?? null);
  } catch (error) {
    console.error("[tigerai] onSessionForked:", error);
  }
}

/** Tools a member's session never gets. Fail-closed: unknown owner means restricted. */
const MEMBER_DENIED_TOOLS = [
  "bash", "edit", "write", "powershell", "codemode", "Agent", "get_subagent_result", "steer_subagent",
  "exec*", // web_search / web_fetch are ours (web/extension.ts) and gated per call by 上網查資料's switch and groups, so "web_*" no longer blanket-denies them
];

export function toolExcludes(sessionId: string, cwd?: string): string[] {
  if (!tgEnabled()) return [];
  try {
    const temp = sessionId.startsWith("__new__");
    const restricted = temp ? isRestrictedCwd(cwd) : sessionIsRestricted(sessionId);
    return restricted ? MEMBER_DENIED_TOOLS : [];
  } catch {
    return MEMBER_DENIED_TOOLS;
  }
}

/** Every session gets the prompt library; restricted ones (members, shared rooms) also get a file fence, and role sessions their role text. */
export function startExtensions(ctx: { sessionId: string; cwd: string }): InlineExtension[] {
  if (!tgEnabled()) return [];
  if (!tgEnabled()) return [];
  const library = createPromptLibraryExtension(ctx.cwd);
  const n8n = createN8nExtension();
  // 上網查資料 (web_search / web_fetch) and make_slides: registered everywhere, allowed per call (web/settings.ts mayUseWeb; slides/extension.ts).
  const web = createWebExtension();
  const slides = createSlidesExtension();
  const mcp = createMcpExtension();
  const forms = createFormsExtension();
  const addons = addonSessionExtensions(ctx);
  const role = roleForSession(ctx.sessionId);
  // Connection fallback: when the primary model connection does not answer, the same turn goes on with the next one (provider/fallback-runtime.ts).
  // Personal model connections of the person who owns this conversation (none for rooms, automations, other people): provider/personal-runtime.ts.
  const personal = personalExtensionsFor(ctx.sessionId, ctx.cwd);
  const fallback = createFallbackExtension({ sessionId: ctx.sessionId, owner: personalOwnerFor(ctx.sessionId, ctx.cwd) });
  const completion = createCompletionPushExtension();
  // Stops a run stuck in empty / failing tool calls (agents/loop-guard.ts).
  const loopGuard = createLoopGuardExtension({ sessionId: ctx.sessionId, actorId: personalOwnerFor(ctx.sessionId, ctx.cwd)?.id ?? null });
  // An administrator's conversation started from a role still wears the role.
  if (toolExcludes(ctx.sessionId, ctx.cwd).length === 0) return [library, n8n, web, slides, mcp, forms, ...addons, ...personal, fallback, loopGuard, completion, ...(role ? [createRoleExtension(role)] : [])];
  return [
    library,
    n8n,
    web,
    slides,
    mcp,
    forms,
    ...addons,
    ...personal,
    fallback,
    loopGuard,
    completion,
    // The company's skills (built-in and the ones an administrator adopted) are read-only text the AI must be able to open: the SDK lists a skill by
    // its path and the model loads the steps with `read`. Without this root a member's AI answered 「技能檔位於工作區外」 and guessed the steps (SME run, unit 4).
    createPathGuard(ctx.cwd, [skillsDir(), ...(role?.knowledge_dir ? [role.knowledge_dir] : []), ...(role && managedRoot(role) ? [managedRoot(role)!] : [])]),
    ...(role ? [createRoleExtension(role)] : []),
  ];
}

/**
 * A channel's AI conversation may only be driven by the channel itself, which calls the wrapper in-process
 * and never comes through this route. A browser (a pasted URL) would skip the channel's permission checks and
 * speaker identity and write into the assistant's memory. Fails closed when the module is on.
 */
export function roomSessionGuard(sessionId: string, commandType: unknown): Response | null {
  if (!tgEnabled()) return null;
  let isRoom = true; // fail closed: a lookup error refuses
  try { isRoom = roomBoundIds([sessionId]).size > 0; } catch (error) { console.error("[tigerai] roomSessionGuard:", error); }
  if (!roomCommandRefused(isRoom, commandType)) return null;
  return NextResponse.json({ error: ROOM_SESSION_MESSAGE, code: "room-session", message: ROOM_SESSION_MESSAGE, accepted: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export { canAccessSession, ensurePersonalDir };
