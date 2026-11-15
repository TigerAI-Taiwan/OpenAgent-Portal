// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { tgEnabled } from "../config";
import { identityOf } from "../adapter";
import {
  ServiceError, authenticate, createGroup, createUser, deleteGroup, listGroups, listUsers, resetPassword,
  setMembership, setPassword, updateUser, userById,
} from "../accounts/service";
import { allowFileRoot } from "../../lib/allowed-roots";
import { listAudit, writeAudit } from "../accounts/audit";
import { auditActionZh, auditSummary } from "../accounts/audit-text";
import { clearSessionCookieHeader, createSessionCookie, sessionCookieHeader } from "../accounts/session";
import { getDb } from "../db/store";
import { ensurePersonalDir } from "../workspace";
import { getOwner } from "../rooms/ownership";
import {
  accessFlags, addMember, bindSession, closeRoom, createRoom, deleteRoom, joinRoom, listDeletedRooms, listMembers, listRooms, markRead, markReadLatest,
  postMessage, readMessages, removeMember, reopenRoom, requireRoom, restoreRoom, roomDir, roomIsOpen, warnRoom,
} from "../rooms/service";
import {
  acceptAssignment, completeAssignment, createAssignment, listAssignments, pendingCount, requireVisible, returnAssignment,
} from "../workorders/assignments";
import { saveSubscription } from "../push";
import { confirmAiAssignment, returnAiAssignment, startIfAi } from "../workorders/ai-run";
import {
  acknowledge, announcementDetail, bulletinSummary, createAnnouncement, deleteAnnouncement, draftAnnouncement, listAnnouncements, markRead as markAnnouncementRead, personalItems,
  postingScope, updateAnnouncement,
} from "../bulletin/service";
import { addConnection, deleteConnection, gatewayModels, reorderConnections, saveModelSettings, testConnection, updateConnection, viewConnections, viewModelSettings } from "../provider/admin";
import { canAccessSession } from "../rooms/ownership";
import { roomBoundIds } from "../rooms/ownership";
import { orgRoutes } from "./org";
import { addonRoute, addonViews } from "../addons/registry";
import { appsFor, createHookKey, deleteWebhook, listHookKeys, listWebhooks, revokeHookKey, saveWebhook } from "../n8n/service";
import { provisionV1 } from "../provider/v1";
import { fallbackNote } from "../provider/fallback-note";
import {
  canTick, createMine, deleteLibraryOrGroup, deleteMine, groupPrompts, listLibrary, listMine, managedGroups, pickablePrompts, promptsVisibleTo,
  publish, saveGroupPrompt, setTick, submitForSharing, updateMine,
} from "../prompts/service";
import { decideOrder, listOrders } from "../workorders/service";
import * as personal from "../agents/personal";
import { agentsFor, createAgent, disableAgent, listAllAgents, parseAssistantMentions, updateAgent } from "../agents/service";
import { aiStatus, ensureRoomSession, enqueueAi, mentionsAi } from "../rooms/ai";
import { verifyPassword } from "../accounts/password";
import { wizardRoutes } from "./wizards";
import { roomWizardState } from "../wizards/engine";
import { canManageWizards } from "../wizards/settings";
import { skillCache } from "../wizards/skill-cache";
import { asrAdminRoutes, meetingRoutes } from "../wizards/meeting/routes";

/**
 * /api/tg/* — login, account, admin and room endpoints in one dispatcher so the
 * Next route file stays a one-line re-export. The proxy already rejected
 * anonymous callers and members on /api/tg/admin/*; handlers check again
 * (defence in depth: a routing mistake must not become an authorization hole).
 */

const NO_STORE = { "Cache-Control": "no-store" };
const out = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { ...NO_STORE, ...(init.headers ?? {}) } });
const fail = (status: number, error: string, code?: string) => out({ error, ...(code ? { code } : {}) }, { status });

// Global login throttle: each failure doubles the wait (1s..60s); a success or 5 idle minutes resets it.
const THROTTLE = Symbol.for("tigerai:login-throttle");
type Throttle = { fails: number; blockedUntil: number; last: number };
function throttle(): Throttle {
  const g = globalThis as unknown as Record<symbol, Throttle | undefined>;
  return (g[THROTTLE] ??= { fails: 0, blockedUntil: 0, last: 0 });
}

async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new ServiceError("content_type", "Content-Type must be application/json", 415);
  try {
    const v = await req.json();
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new ServiceError("bad_json", "Expected a JSON object");
}

async function installedSkills(userId: string): Promise<{ name: string; description: string }[]> {
  const dir = ensurePersonalDir(userId);
  const hit = skillCache.get(dir);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const { loadSkillsWithInstallInfo } = await import("../../lib/skills-service");
  const rows = (await loadSkillsWithInstallInfo(dir)).skills.map((x) => ({ name: x.name, description: x.description })).sort((p, q) => p.name.localeCompare(q.name));
  skillCache.set(dir, { at: Date.now(), rows });
  return rows;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function handle(req: Request, segments: string[]): Promise<Response> {
  if (!tgEnabled()) return fail(404, "Not found");
  try {
    return await dispatch(req, segments);
  } catch (error) {
    if (error instanceof ServiceError) return fail(error.status, error.message, error.code);
    console.error("[tigerai] api error:", error instanceof Error ? error.message : error);
    return fail(500, "Internal error");
  }
}

async function dispatch(req: Request, seg: string[]): Promise<Response> {
  const method = req.method.toUpperCase();
  const [a, b, c, d] = seg;

  if (a === "login" && method === "POST") return login(req);

  const who = identityOf(req);
  if (!who) return fail(401, "Authentication required");
  const actor = { id: who.userId, role: who.role };

  if (a === "logout" && method === "POST") {
    writeAudit("auth.logout", who.userId);
    return out({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
  }
  if (a === "me" && method === "GET") {
    const u = userById(who.userId)!;
    const head = !!getDb().prepare("SELECT 1 FROM memberships WHERE user_id=? AND is_manager=1").get(u.id);
    let homeDir: string | null = null;
    try { homeDir = ensurePersonalDir(u.id); allowFileRoot(homeDir); } catch (error) { console.error("[tigerai] personal folder:", error); } // first login: the folder the sidebar lists; browsable from the start (a fresh folder has no session yet to allow it)
    return out({ homeDir, id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: !!u.must_change_pw, isHead: head, canCreateRoom: true });
  }
  if (a === "account" && b === "password" && method === "POST") {
    const input = await body(req);
    const row = getDb().prepare("SELECT pw_hash,pw_salt,pw_iter FROM users WHERE id=?").get(who.userId) as { pw_hash: string; pw_salt: string; pw_iter: number };
    if (!verifyPassword(str(input.current), { hash: row.pw_hash, salt: row.pw_salt, iterations: row.pw_iter })) return fail(403, "Current password is wrong", "bad_current");
    if (str(input.current) === str(input.next)) return fail(400, "Choose a different password", "same_password");
    setPassword(who.userId, who.userId, str(input.next), false);
    // token_version moved, so issue a fresh cookie for this browser.
    const fresh = userById(who.userId)!;
    return out({ ok: true }, { headers: { "Set-Cookie": sessionCookieHeader(createSessionCookie(fresh.id, fresh.token_version)) } });
  }

  if (a === "users" && method === "GET") {
    // Names only, for the "add to room" picker.
    return out({ users: listUsers().filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name })) });
  }

  if (a === "agents" && !b && method === "GET") {
    // Roles this person may @: names and descriptions only.
    return out({ agents: agentsFor(actor).map((x) => ({ id: x.id, name: x.name, description: x.description })) });
  }
  if (a === "agents") return personalAgents(req, method, actor, [b, c]);
  if (a === "prompts") return prompts(req, method, actor, [b, c, d]);
  if (a === "workorders" && method === "GET") return out({ orders: listOrders(actor) });
  if (a === "skills" && !b && method === "GET") {
    // 可用技能: what is installed, read-only, names and descriptions only (no paths). Installing and toggling stay administrator-only upstream routes.
    return out({ skills: await installedSkills(actor.id) });
  }
  if (a === "n8n" && b === "apps" && method === "GET") return out({ apps: appsFor(actor) });
  if (a === "addons" && !b && method === "GET") {
    // What each add-on package is and whether it runs (menus come from here). The licence holder and expiry are for administrators only.
    return out({ addons: addonViews().map((v) => (actor.role === "admin" ? v : { ...v, org: null, expires: null, features: [], adds: [] })) });
  }
  if (a === "push" && b === "subscribe" && method === "POST") {
    // Bound to the signed-in person (upstream's /api/push/subscribe is not): only they are ever notified through it.
    const sub = (await body(req)).subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
    try { saveSubscription(actor.id, sub ?? {}); } catch (e) { return fail(400, e instanceof Error ? e.message : "Invalid push subscription"); }
    return out({ ok: true });
  }
  if (a === "wizards") { const r = await wizardRoutes(req, method, actor, [b, c, d, seg[4]], false); if (r) return r; return fail(404, "Not found"); }
  if (a === "assignments") return assignments(req, method, actor, [b, c]);
  if (a === "bulletin") return bulletin(req, method, actor, b);
  if (a === "announcements") return announcements(req, method, actor, [b, c]);
  if (a === "sessions" && c === "info" && method === "GET" && b) {
    // Is this conversation a channel's own? (the page then disables its input). Same visibility rule as opening it.
    if (!canAccessSession(actor, b)) return fail(404, "Not found");
    return out({ roomOnly: roomBoundIds([b]).size > 0, roomId: getOwner(b)?.room_id ?? null });
  }
  if (a === "sessions" && c === "fallback" && method === "GET" && b) {
    // The small "主要連線沒有回應,這次改用…" line of the latest turn. Same visibility rule as opening the conversation.
    if (!canAccessSession(actor, b)) return fail(404, "Not found");
    return out({ note: await fallbackNote(b) });
  }
  // Add-on packages (tigerai/addons): only a package that is compiled in AND licensed is asked; otherwise this falls through to 404.
  if (a !== "admin") { const r = await addonRoute("routes", { req, method, actor, seg, out, body: () => body(req) }); if (r) return r; }
  if (a === "rooms") return rooms(req, method, actor, who.name, seg.slice(1));
  if (a === "meeting") return meetingRoutes(req, method, actor, seg.slice(1));

  if (a === "admin") {
    if (who.role !== "admin") return fail(403, "Administrator only");
    return admin(req, method, actor, [b, c, d, seg[4]]);
  }
  return fail(404, "Not found");
}

async function login(req: Request): Promise<Response> {
  const t = throttle();
  const now = Date.now();
  if (now - t.last > 5 * 60_000) t.fails = 0;
  if (t.blockedUntil > now) {
    return out({ error: "Too many failed attempts" }, { status: 429, headers: { "Retry-After": String(Math.ceil((t.blockedUntil - now) / 1000)) } });
  }
  const input = await body(req);
  const user = authenticate(str(input.email), str(input.password));
  if (!user) {
    t.fails += 1; t.last = now;
    t.blockedUntil = now + Math.min(60_000, 1000 * 2 ** (t.fails - 1));
    writeAudit("auth.login_failed", null, { email: str(input.email).slice(0, 120) });
    return fail(401, "Wrong email or password");
  }
  t.fails = 0; t.blockedUntil = 0;
  writeAudit("auth.login", user.id);
  return out({ ok: true, mustChangePassword: !!user.must_change_pw }, {
    headers: { "Set-Cookie": sessionCookieHeader(createSessionCookie(user.id, user.token_version)) },
  });
}

type Actor = { id: string; role: "admin" | "member" };

async function admin(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [a, b, c, d] = seg;
  if (a === "users") {
    if (!b && method === "GET") return out({ users: listUsers() });
    if (!b && method === "POST") {
      const i = await body(req);
      const r = createUser(actor.id, { email: str(i.email), name: str(i.name), role: i.role === "admin" ? "admin" : "member" });
      return out({ user: r.user, initialPassword: r.initialPassword }, { status: 201 });
    }
    if (b && !c && method === "PATCH") {
      const i = await body(req);
      return out({ user: updateUser(actor.id, b, { status: i.status as string | undefined, role: i.role as string | undefined, name: i.name as string | undefined }) });
    }
    if (b && c === "reset" && method === "POST") return out({ initialPassword: resetPassword(actor.id, b) });
  }
  if (a === "groups") {
    if (!b && method === "GET") return out({ groups: listGroups() });
    if (!b && method === "POST") {
      const i = await body(req);
      return out({ group: createGroup(actor.id, { name: str(i.name), description: str(i.description), parentId: (i.parentId as string) || null }) }, { status: 201 });
    }
    if (b && !c && method === "DELETE") { deleteGroup(actor.id, b); return out({ ok: true }); }
    if (b && c === "members" && method === "PUT") {
      const i = await body(req);
      setMembership(actor.id, b, str(i.userId), i.present !== false, i.isManager === true);
      return out({ ok: true });
    }
  }
  if (a === "agents") {
    if (!b && method === "GET") return out({ agents: listAllAgents() });
    if (!b && method === "POST") return out({ agent: createAgent(actor.id, await body(req)) }, { status: 201 });
    if (b && !c && method === "PATCH") return out({ agent: updateAgent(actor.id, b, await body(req)) });
    if (b && !c && method === "DELETE") { disableAgent(actor.id, b); return out({ ok: true }); }
  }
  if (a === "prompts") {
    if (!b && method === "GET") return out({ prompts: listLibrary() });
    if (!b && method === "POST") return out({ prompt: publish(actor, await body(req)) }, { status: 201 });
    if (b && !c && method === "PATCH") return out({ prompt: publish(actor, await body(req), b) });
    if (b && !c && method === "DELETE") { deleteLibraryOrGroup(actor, b); return out({ ok: true }); }
  }
  if (a === "workorders") {
    if (!b && method === "GET") return out({ orders: listOrders(actor) });
    if (b && c === "decide" && method === "POST") {
      const i = await body(req);
      return out({ order: decideOrder(actor, b, i.approve === true, str(i.note)) });
    }
  }
  if (a === "models") {
    // What the administrator configured. The key is never returned (only its last 4 characters).
    if (!b && method === "GET") return out(viewModelSettings());
    if (!b && method === "PUT") return out(await saveModelSettings(actor.id, await body(req)));
    if (b === "test" && method === "POST") return out(await testConnection(await body(req)));
    if (b === "gateway" && method === "GET") return out({ models: await gatewayModels() });
    // The connection list (administrators only: this whole branch is admin-only). Every write is audited; keys never come back.
    if (b === "connections") {
      if (!c && method === "GET") return out(viewConnections());
      if (!c && method === "POST") return out(await addConnection(actor.id, await body(req)), { status: 201 });
      if (c === "reorder" && method === "POST") return out(await reorderConnections(actor.id, (await body(req)).ids));
      if (c && d === "gateway" && method === "GET") return out({ models: await gatewayModels(c) });
      if (c && !d && method === "PATCH") return out(await updateConnection(actor.id, c, await body(req)));
      if (c && !d && method === "DELETE") return out(await deleteConnection(actor.id, c));
    }
    if (b === "refresh" && method === "POST") { await provisionV1(); return out(viewModelSettings()); }
  }
  if (a === "asr") return asrAdminRoutes(req, method, actor, b);
  if (a === "rooms") {
    if (b === "deleted" && method === "GET") return out({ rooms: listDeletedRooms(actor) });
    if (b && c === "restore" && method === "POST") { restoreRoom(actor, b); return out({ ok: true }); }
  }
  if (a === "n8n") {
    // c = id, and the every n8n admin route is /n8n/<kind>[/<id>] (webhooks, keys).
    if (b === "webhooks") {
      if (!c && method === "GET") return out({ webhooks: listWebhooks() });
      if (!c && method === "POST") return out(saveWebhook(actor.id, await body(req)), { status: 201 });
      if (c && method === "PATCH") return out(saveWebhook(actor.id, await body(req), c));
      if (c && method === "DELETE") { deleteWebhook(actor.id, c); return out({ ok: true }); }
    }
    if (b === "keys") {
      if (!c && method === "GET") return out({ keys: listHookKeys() });
      if (!c && method === "POST") { const r = createHookKey(actor.id, await body(req)); return out({ key: r.key, plaintext: r.plaintext }, { status: 201 }); }
      if (c && method === "DELETE") { revokeHookKey(actor.id, c); return out({ ok: true }); }
    }
  }
  if (a === "wizards") { const r = await wizardRoutes(req, method, actor, [b, c, undefined, undefined], true); if (r) return r; }
  if (a === "audit" && method === "GET") {
    const q = new URL(req.url).searchParams;
    const db = getDb();
    const table: Record<string, [string, string]> = { user: ["users", "name"], room: ["rooms", "name"], group: ["groups", "name"], agent: ["agents", "name"], prompt: ["prompts", "name"], assignment: ["assignments", "title"], announcement: ["announcements", "title"] };
    const memo = new Map<string, string | undefined>();
    const resolve = (kind: string, id: string): string | undefined => {
      const key = `${kind}:${id}`;
      if (!memo.has(key)) {
        const t = table[kind];
        let n = t ? (db.prepare(`SELECT ${t[1]} AS n FROM ${t[0]} WHERE id=?`).get(id) as { n?: string } | undefined)?.n : undefined;
        if (n === undefined && kind === "agent") n = (db.prepare("SELECT name AS n FROM personal_agents WHERE id=?").get(id) as { n?: string } | undefined)?.n;
        memo.set(key, n);
      }
      return memo.get(key);
    };
    // Rows keep their stored fields; each also carries what the page shows: the Chinese action name, who, and a summary.
    const rows = listAudit({ action: q.get("action") || undefined, actor: q.get("actor") || undefined, limit: Number(q.get("limit")) || 200 })
      .map((r) => ({ ...r, actionZh: auditActionZh(r.action), actorName: r.actor_id ? resolve("user", r.actor_id) ?? null : null, summary: auditSummary(r.extra, resolve as Parameters<typeof auditSummary>[1]) }));
    return out({ rows });
  }
  const org = await orgRoutes(req, method, actor, a, b);
  if (org) return org;
  { const r = await addonRoute("adminRoutes", { req, method, actor, seg: seg.filter((x): x is string => x !== undefined), out, body: () => body(req) }); if (r) return r; }
  return fail(404, "Not found");
}

async function rooms(req: Request, method: string, actor: Actor, name: string, seg: string[]): Promise<Response> {
  const [id, sub, uid] = seg;
  if (!id) {
    if (method === "GET") return out({ rooms: listRooms(actor) });
    if (method === "POST") {
      const i = await body(req);
      const ids = Array.isArray(i.memberIds) ? i.memberIds.filter((x): x is string => typeof x === "string") : [];
      return out({ room: createRoom(actor, str(i.name), ids) }, { status: 201 });
    }
  }
  if (id && !sub && method === "GET") {
    const room = requireRoom(actor, id, { allowDeleted: true });
    const q = new URL(req.url).searchParams;
    const messages = readMessages(actor, id, Number(q.get("after")) || 0, 200, true);
    // Opening or polling a room you are in keeps it read: messages arriving while you look never raise the count.
    if (q.get("read") === "1" && !room.deleted_at && messages.length) markRead(actor, id, messages[messages.length - 1].seq);
    const flags = accessFlags(actor, room);
    return out({ room, ai: aiStatus(id), dir: roomDir(id), members: listMembers(id), messages, you: { id: actor.id, name }, ...flags, can: { ...flags.can, wizards: !room.deleted_at && canManageWizards(actor, room) }, wizard: roomWizardState(actor, id) });
  }
  if (id && sub === "messages" && method === "POST") {
    const i = await body(req);
    const message = postMessage(actor, id, str(i.text));
    // @AI: queued, answered later as a room message marked as AI.
    // @AI = the plain model; @<role> = an AI role this person may call.
    const { agentIds, rest } = parseAssistantMentions(message.text, agentsFor(actor));
    if (mentionsAi(message.text)) enqueueAi(id, actor.id, message.seq, message.text);
    for (const agentId of agentIds) enqueueAi(id, actor.id, message.seq, rest, agentId);
    return out({ message }, { status: 201 });
  }
  if (id && sub === "read" && method === "POST") {
    requireRoom(actor, id);
    const i = await body(req);
    const seq = Math.floor(Number(i.seq) || 0);
    if (seq > 0) markRead(actor, id, seq); else markReadLatest(actor, id);
    return out({ ok: true, unread: 0 });
  }
  if (id && sub === "members" && !uid && method === "POST") {
    const i = await body(req);
    addMember(actor, id, str(i.userId));
    return out({ members: listMembers(id) });
  }
  if (id && sub === "members" && uid && method === "DELETE") {
    removeMember(actor, id, uid);
    return out({ members: listMembers(id) });
  }
  if (id && sub === "join" && method === "POST") { joinRoom(actor, id); return out({ ok: true, ...accessFlags(actor, requireRoom(actor, id)) }); }
  if (id && sub === "warn" && method === "POST") { warnRoom(actor, id, str((await body(req)).text)); return out({ ok: true }, { status: 201 }); }
  if (id && sub === "close" && method === "POST") { closeRoom(actor, id); return out({ ok: true }); }
  if (id && sub === "reopen" && method === "POST") { reopenRoom(actor, id); return out({ ok: true }); }
  if (id && !sub && method === "DELETE") { deleteRoom(actor, id); return out({ ok: true }); }
  if (id && sub === "ai" && method === "POST") {
    // "Open AI conversation": make sure the room's own conversation exists (a member may press it; it never takes a client-chosen folder).
    requireRoom(actor, id);
    if (!roomIsOpen(id)) return fail(409, "This room is closed", "room_closed");
    return out({ sessionId: await ensureRoomSession(id) });
  }
  if (id && sub === "bind" && method === "POST") {
    const i = await body(req);
    const sessionId = str(i.sessionId);
    const owner = getOwner(sessionId);
    // Only a conversation this user created inside this room's own folder can be bound.
    if (!owner || owner.user_id !== actor.id || owner.room_id !== id) return fail(403, "That conversation was not started in this room", "not_room_session");
    bindSession(actor, id, sessionId);
    return out({ ok: true });
  }
  return fail(404, "Not found");
}

/** 精靈: my own menu of agents (see agents/personal.ts). Everything here acts on the caller's own menu and own agents only. */
async function personalAgents(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [b, c] = seg;
  if (b === "menu") {
    if (!c && method === "GET") return out({ menu: personal.menuFor(actor) });
    if (!c && method === "POST") { personal.addToMenu(actor, str((await body(req)).agentId)); return out({ menu: personal.menuFor(actor) }, { status: 201 }); }
    if (!c && method === "PUT") { personal.reorderMenu(actor, (await body(req)).ids); return out({ menu: personal.menuFor(actor) }); }
    if (c && method === "DELETE") { personal.removeFromMenu(actor, c); return out({ menu: personal.menuFor(actor) }); }
  }
  if (b === "browse" && !c && method === "GET") return out({ agents: personal.browse(actor) });
  if (b === "mine") {
    if (!c && method === "POST") return out({ agent: personal.createMine(actor, await body(req)) }, { status: 201 });
    if (c && method === "GET") return out({ agent: personal.mineDetail(actor, c) });
    if (c && method === "PATCH") return out({ agent: personal.updateMine(actor, c, await body(req)) });
    if (c && method === "DELETE") { personal.deleteMine(actor, c); return out({ ok: true }); }
  }
  if (b && c === "copy" && method === "POST") return out({ agent: personal.copyToMine(actor, b, str((await body(req)).name) || undefined) }, { status: 201 });
  return fail(404, "Not found");
}

async function assignments(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [id, action] = seg;
  if (!id && method === "POST") return out({ assignment: startIfAi(createAssignment(actor, await body(req))) }, { status: 201 });
  if (!id && method === "GET") {
    const q = new URL(req.url).searchParams;
    return out({ assignments: listAssignments(actor, q.get("scope") || "mine", q.get("status") || undefined, q.get("source") || undefined, q.get("kind") || undefined) });
  }
  if (id === "count" && method === "GET") return out(pendingCount(actor));
  if (id && !action && method === "GET") return out({ assignment: requireVisible(actor, id) });
  if (id && action === "accept" && method === "POST") return out({ assignment: acceptAssignment(actor, id) });
  const isAi = !!id && id !== "count" && requireVisible(actor, id).assigneeKind === "ai";
  if (id && action === "complete" && method === "POST") return out({ assignment: isAi ? confirmAiAssignment(actor, id, str((await body(req)).note)) : completeAssignment(actor, id, str((await body(req)).note)) });
  if (id && action === "return" && method === "POST") return out({ assignment: isAi ? returnAiAssignment(actor, id, (await body(req)).reason) : returnAssignment(actor, id, (await body(req)).reason) });
  return fail(404, "Not found");
}

/** 提醒泡泡 and 個人區: only what this person must act on. `tzo` = the browser's Date.getTimezoneOffset(), so "today" is the caller's day. */
const tzoOf = (req: Request): number => { const n = Number(new URL(req.url).searchParams.get("tzo")); return Number.isFinite(n) && Math.abs(n) <= 840 ? n : 0; };

async function bulletin(req: Request, method: string, actor: Actor, what: string | undefined): Promise<Response> {
  if (method !== "GET") return fail(404, "Not found");
  if (what === "summary") return out(bulletinSummary(actor, Date.now(), tzoOf(req)));
  if (what === "personal") return out({ items: personalItems(actor, Date.now(), tzoOf(req)) });
  if (what === "scope") return out(postingScope(actor));
  return fail(404, "Not found");
}

async function announcements(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [id, action] = seg;
  const tzo = tzoOf(req);
  const detail = (x: string) => out(announcementDetail(actor, x, Date.now(), tzo));
  if (!id && method === "GET") return out({ announcements: listAnnouncements(actor, new URL(req.url).searchParams.get("view") === "expired" ? "expired" : "active", Date.now(), tzo) });
  if (!id && method === "POST") return out(announcementDetail(actor, createAnnouncement(actor, await body(req)).id, Date.now(), tzo), { status: 201 });
  if (id === "draft" && method === "POST") { const i = await body(req); return out(await draftAnnouncement(actor, { topic: i.topic, audience: i.audience })); }
  if (id && !action && method === "GET") return detail(id);
  if (id && !action && method === "PATCH") { updateAnnouncement(actor, id, await body(req)); return detail(id); }
  if (id && !action && method === "DELETE") { deleteAnnouncement(actor, id); return out({ ok: true }); }
  if (id && action === "read" && method === "POST") { markAnnouncementRead(actor, id); return out({ ok: true }); }
  if (id && action === "ack" && method === "POST") { acknowledge(actor, id); return detail(id); }
  return fail(404, "Not found");
}

async function prompts(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [b, c, d] = seg;
  // what my "/" menu shows
  if (b === "pick" && method === "GET") return out({ prompts: pickablePrompts(actor) });
  if (!b && method === "GET") return out({ prompts: promptsVisibleTo(actor).map((p) => ({ id: p.id, name: p.name, description: p.description, personal: p.owner_id !== null })) });
  if (b === "mine" && method === "GET") return out({ prompts: listMine(actor.id) });
  if (!b && method === "POST") return out({ prompt: createMine(actor, await body(req)) }, { status: 201 });
  if (b === "library" && method === "GET") {
    // For department heads (their groups) and administrators (all groups).
    const heads = actor.role === "admin" ? listGroups().map((g) => g.id) : managedGroups(actor.id);
    if (heads.length === 0) return fail(403, "Only department heads can choose templates for their department");
    const groups = listGroups().filter((g) => heads.includes(g.id)).map((g) => ({ id: g.id, name: g.name, prompts: groupPrompts(g.id) }));
    return out({ library: listLibrary().filter((p) => p.enabled), groups });
  }
  if (b === "group" && c) {
    if (method === "POST") return out({ prompt: saveGroupPrompt(actor, c, await body(req)) }, { status: 201 });
  }
  if (b === "shared" && c && method === "DELETE") { deleteLibraryOrGroup(actor, c); return out({ ok: true }); }
  if (b && c === "ticks" && method === "POST") {
    const i = await body(req);
    setTick(actor, b, str(i.groupId), i.on !== false);
    return out({ ok: true, canTick: canTick(actor, str(i.groupId)) });
  }
  if (b && c === "share" && method === "POST") return out(submitForSharing(actor, b), { status: 201 });
  if (b && !c && method === "PATCH") return out({ prompt: updateMine(actor, b, await body(req)) });
  if (b && !c && method === "DELETE") { deleteMine(actor, b); return out({ ok: true }); }
  void d;
  return fail(404, "Not found");
}
