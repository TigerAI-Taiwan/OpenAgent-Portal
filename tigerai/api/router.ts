// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { tgEnabled } from "../config";
import { identityOf } from "../adapter";
import {
  ServiceError, authenticate, createGroup, createUser, deleteGroup, listGroups, listUsers, resetPassword,
  setEmployeeId, setMembership, setPassword, updateGroup, updateUser, userById,
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
  postMessage, purgeRoom, readMessages, removeMember, reopenRoom, requireRoom, restoreRoom, roomDir, roomIsOpen, setRoomUnit, warnRoom,
} from "../rooms/service";
import {
  acceptAssignment, apiAssignment, completeAssignment, createAssignment, listAssignments, pendingCount, requireVisible, returnAssignment,
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
import { dirRoutes } from "./dir";
import { applyUnitChange, decideUnitChangeItem, listUnitChangeItems, previewUnitChange } from "../org/transfer";
import { inventoryOf, leaveUser, sweepLeaverKeys } from "../org/handover";
import { leaverKeyState } from "../provider/leaver-keys";
import { addonRoute, addonViews } from "../addons/registry";
import { appsFor, createHookKey, deleteWebhook, listHookKeys, listWebhooks, revokeHookKey, saveWebhook } from "../n8n/service";
import { formRoutes } from "../forms/routes";
import { connectorAdminRoutes, connectorRoutes } from "../n8nmcp/routes";
import { usablePersonal } from "../provider/personal";
import { provisionV1 } from "../provider/v1";
import { personalRoutes, personalAdminRoutes, mergedModelList } from "./personal";
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
import { isPendingLogin } from "../register/service";
import { joinCodeRoutes, registerAdmin, registerPublic, requestRoutes } from "./register";
import { knowledgeRoutes } from "./knowledge";
import { slidesRoutes, webAdminRoutes } from "./web";
import { roomWizardState } from "../wizards/engine";
import { canManageWizards } from "../wizards/settings";
import { skillCache } from "../wizards/skill-cache";
import * as mineSkill from "../skills/mine";
import { unitSkills } from "../skills/mine";
import { copyBuiltinSkill, isBuiltinSkill, mySkills } from "../skills/builtin";
import { fileDeps } from "../userlog/reader";
import * as userlog from "../userlog/service";
import { isVendor, vendorIds, guardVendorChange } from "../accounts/vendor";
import { vendorAllows } from "../accounts/vendor-policy";
import { getPolicy, mayPublish, publish as publishN8n, savePolicy } from "../n8n/publish";
import { loginFailureFields } from "../accounts/login-audit";
import { idleMinutes, recordInput, setIdleMinutes } from "../accounts/idle";
import { preview as purgePreview, purge as purgeMember } from "../accounts/purge";
import { Blocked, loginGlobalLimit, throttles } from "../accounts/throttle";
import { archiveClass, archivedMap, unarchiveClass } from "../accounts/archive";
import { updateOwnProfile } from "../accounts/profile";
import { systemStatus } from "../accounts/system-status";
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

async function bodyOrEmpty(req: Request, method: string): Promise<Record<string, unknown>> { return method === "GET" || method === "DELETE" ? {} : body(req); }

async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new ServiceError("content_type", "Content-Type must be application/json", 415);
  try {
    const v = await req.json();
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new ServiceError("bad_json", "Expected a JSON object");
}

async function installedSkills(userId: string): Promise<{ name: string; description: string; builtin: boolean }[]> {
  const dir = ensurePersonalDir(userId);
  const own = [...mySkills(userId), ...unitSkills(userId)]; // read every time (cheap), so a new copy shows at once
  const merge = (rows: { name: string; description: string }[]) => [...rows.map((x) => ({ name: x.name, description: x.description, builtin: isBuiltinSkill(x.name) })), ...own.filter((m) => !rows.some((x) => x.name === m.name))].sort((p, q) => p.name.localeCompare(q.name));
  const hit = skillCache.get(dir);
  if (hit && Date.now() - hit.at < 60_000) return merge(hit.rows);
  const { loadSkillsWithInstallInfo } = await import("../../lib/skills-service");
  const rows = (await loadSkillsWithInstallInfo(dir)).skills.map((x) => ({ name: x.name, description: x.description }));
  skillCache.set(dir, { at: Date.now(), rows });
  return merge(rows);
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
  if (a === "register") return registerPublic(req, method, b); // 學生自行註冊: public; the switch (default off) is checked inside

  const who = identityOf(req);
  if (!who) return fail(401, "Authentication required");
  const actor = { id: who.userId, role: who.role };
  const vendor = isVendor(who.userId);
  // Defence in depth: the proxy already fenced the maintenance account; a routing mistake must not open anything to it.
  if (vendor && !vendorAllows(method, `/api/tg/${seg.join("/")}`)) return fail(403, "vendor_fenced: the maintenance account cannot open this");

  if (a === "logout" && method === "POST") {
    writeAudit("auth.logout", who.userId);
    return out({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
  }
  if (a === "me" && method === "GET") {
    const u = userById(who.userId)!;
    const head = !!getDb().prepare("SELECT 1 FROM memberships WHERE user_id=? AND is_manager=1").get(u.id);
    let homeDir: string | null = null;
    try { homeDir = ensurePersonalDir(u.id); allowFileRoot(homeDir); } catch (error) { console.error("[tigerai] personal folder:", error); } // first login: the folder the sidebar lists; browsable from the start (a fresh folder has no session yet to allow it)
    // personalModels: how many of their own model connections are usable now (the picker shows 「我的」 for them; the page needs no list for it).
    return out({ homeDir, id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: !!u.must_change_pw, isHead: head, canCreateRoom: true, personalModels: usablePersonal(u.id).length, canUserLog: !vendor && userlog.mayUse({ id: u.id, role: u.role }), isVendor: vendor, idleMinutes: idleMinutes() });
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

  if (a === "activity" && method === "POST") { recordInput(who.userId); return out({ ok: true }); }
  if (a === "account" && (b === "profile" || b === "email") && method === "POST") {
    const i = await body(req);
    const u = updateOwnProfile(who.userId, { name: i.name, email: i.email, currentPassword: i.current });
    return out({ ok: true, name: u.name, email: u.email });
  }

  if (a === "users" && method === "GET") {
    // Names only, for the "add to room" picker.
    const hide = vendorIds();
    return out({ users: listUsers().filter((u) => u.status === "active" && !hide.has(u.id)).map((u) => ({ id: u.id, name: u.name })) });
  }

  if (a === "knowledge") return knowledgeRoutes(req, method, actor, [b, c, d, seg[4]]);
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
  if (a === "skills" && b === "copy" && method === "POST") {
    // 複製成我的: a built-in's editable copy in this person's own folder. The originals are never written from here.
    return out(copyBuiltinSkill(actor.id, str((await body(req)).name)));
  }
  if (a === "skills" && b === "mine") {
    // 我的技能: written from scratch, edited and deleted by the owner only (the folder is always the SIGNED-IN person's). Sharing is the administrator's.
    if (!c && method === "POST") return out(mineSkill.createMine(actor.id, await body(req)), { status: 201 });
    if (c && !d && method === "GET") return out({ skill: mineSkill.readMine(actor.id, c) });
    if (c && !d && method === "PUT") return out(mineSkill.updateMine(actor.id, c, await body(req)));
    if (c && !d && method === "DELETE") { mineSkill.deleteMine(actor.id, c); return out({ ok: true }); }
    if (c && d === "submit" && method === "POST") { mineSkill.submitMine(actor.id, c); return out({ ok: true }); }
  }
  if (a === "n8n" && b === "apps" && method === "GET") return out({ apps: appsFor(actor) });
  // 上架: writing and testing own workflows is free; publishing for others is reviewed (administrators publish directly).
  if (a === "n8n" && b === "publish" && method === "GET") return out({ policy: getPolicy(), may: mayPublish(actor), groups: listGroups().map((g) => ({ id: g.id, name: g.name })) });
  if (a === "n8n" && b === "publish" && method === "POST") return out(publishN8n(actor, await body(req)), { status: 201 });
  if (a === "forms") { const r = await formRoutes(method, actor, b, c, d, () => body(req)); if (r) return r; }
  if (a === "connectors") { const r = connectorRoutes(method, actor, b); if (r) return r; }
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
  // Own model connections: what the person sees and edits (the owner only; every function takes the caller's id, never an id from the URL).
  if (a === "personal-models") return personalRoutes(req, method, actor, [b, c], await bodyOrEmpty(req, method));
  if (a === "model-list" && method === "GET") return mergedModelList(req, actor);
  // Add-on packages (tigerai/addons): only a package that is compiled in AND licensed is asked; otherwise this falls through to 404.
  if (a !== "admin") { const r = await addonRoute("routes", { req, method, actor, seg, out, body: () => body(req) }); if (r) return r; }
  if (a === "rooms") return rooms(req, method, actor, who.name, seg.slice(1));
  if (a === "meeting") return meetingRoutes(req, method, actor, seg.slice(1));
  if (a === "slides") return slidesRoutes(req, method, actor, b, new URL(req.url).searchParams.get("format")); // made decks: channel members / the owner (slides/store.ts)
  if (a === "units" && !b && method === "GET") {
    // Units the person may file a channel under: administrators every unit, everyone else the units they belong to (names and a full path only).
    const rows = (actor.role === "admin" ? listGroups() : listGroups().filter((g) => g.members.some((m) => m.user_id === actor.id)));
    const byId = new Map(listGroups().map((g) => [g.id, g]));
    const pathOf = (id: string): string => { const names: string[] = []; const seen = new Set<string>(); let cur: string | null = id; while (cur && !seen.has(cur)) { seen.add(cur); const g = byId.get(cur); if (!g) break; names.unshift(g.name); cur = g.parent_id; } return names.join(" / "); };
    return out({ units: rows.map((g) => ({ id: g.id, name: g.name, path: pathOf(g.id), parentId: g.parent_id })) });
  }
  if (a === "unit-changes") {
    // 換部門 leaves the old unit's project channels kept; its head (or an administrator) keeps or removes them here.
    if (!b && method === "GET") return out({ items: listUnitChangeItems(actor, new URL(req.url).searchParams.get("all") === "1") });
    if (b && method === "POST") { decideUnitChangeItem(actor, b, (await body(req)).decision === "remove" ? "remove" : "keep"); return out({ ok: true }); }
    return fail(404, "Not found");
  }
  if (a === "dir") return dirRoutes(req, method, actor, b); // read-only directory tree (rules in directory/tree.ts)
  if (a === "regrequests") return requestRoutes(req, method, actor, seg.slice(1)); // administrator or class head (checked inside)
  if (a === "joincodes") return joinCodeRoutes(req, method, actor, seg.slice(1)); // department head or administrator (checked inside)

  // 使用者紀錄: read-only. Administrators and department heads; every rule is in userlog/service.ts (not here, not in the page).
  if (a === "userlog") {
    if (b === undefined && method === "GET") {
      const rows = await userlog.listMembers(actor, fileDeps);
      return out({ members: rows, headsCanView: userlog.headsCanView(), canSwitch: actor.role === "admin" });
    }
    if (b === "export" && method === "GET") {
      const { filename, csv } = await userlog.exportCsv(actor, fileDeps);
      return new Response(csv, { headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
    }
    if (b === "setting" && method === "PUT") {
      if (actor.role !== "admin") return fail(403, "Administrator only");
      userlog.setHeadsCanView(actor.id, (await body(req)).headsCanView !== false);
      return out({ ok: true, headsCanView: userlog.headsCanView() });
    }
    if (b === "member" && c && method === "GET" && d === undefined) return out(await userlog.listConversations(actor, c, fileDeps));
    if (b === "member" && c && d && method === "GET") return out(await userlog.readConversation(actor, c, d, fileDeps));
    return fail(404, "Not found"); // no other method exists: nothing here can send, edit or delete
  }
  if (a === "admin") {
    if (who.role !== "admin") return fail(403, "Administrator only");
    return admin(req, method, actor, [b, c, d, seg[4]]);
  }
  return fail(404, "Not found");
}

async function login(req: Request): Promise<Response> {
  const T = throttles();
  const now = Date.now();
  const input = await body(req);
  const key = str(input.email).trim().toLowerCase().slice(0, 120);
  // Per account (one student's typos wait only for that student) and a far higher global ceiling against someone rotating accounts.
  try { T.loginGlobal.check(loginGlobalLimit(), now); T.loginAccount.check(key, now); } catch (e) {
    if (e instanceof Blocked) return out({ error: "Too many failed attempts" }, { status: 429, headers: { "Retry-After": String(e.retryAfter) } });
    throw e;
  }
  const user = authenticate(str(input.email), str(input.password));
  if (!user && isPendingLogin(str(input.email), str(input.password))) {
    // The right password on an account that waits for approval: say so (not a failed guess, so no throttle step).
    return out({ error: "帳號已建立，等待管理員核准", code: "pending_approval" }, { status: 403 });
  }
  if (!user) {
    T.loginAccount.fail(key, now); T.loginGlobal.add(now);
    writeAudit("auth.login_failed", null, loginFailureFields(str(input.email)));
    return fail(401, "Wrong email or password");
  }
  T.loginAccount.ok(key);
  writeAudit("auth.login", user.id);
  recordInput(user.id); // a fresh sign-in starts a fresh idle window
  return out({ ok: true, mustChangePassword: !!user.must_change_pw }, {
    headers: { "Set-Cookie": sessionCookieHeader(createSessionCookie(user.id, user.token_version)) },
  });
}

type Actor = { id: string; role: "admin" | "member" };

async function admin(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [a, b, c, d] = seg;
  if (a === "register") return registerAdmin(req, method, actor);
  if (a === "users") {
    if (!b && method === "GET") { sweepLeaverKeys(); const v = vendorIds(); return out({ users: listUsers().map((u) => ({ ...u, isVendor: v.has(u.id) })) }); }
    if (!b && method === "POST") {
      const i = await body(req);
      const r = createUser(actor.id, { email: str(i.email), name: str(i.name), role: i.role === "admin" ? "admin" : "member" });
      return out({ user: r.user, initialPassword: r.initialPassword }, { status: 201 });
    }
    if (b && !c && method === "PATCH") {
      const i = await body(req);
      guardVendorChange(b, { role: i.role as string | undefined, name: i.name as string | undefined });
      return out({ user: updateUser(actor.id, b, { status: i.status as string | undefined, role: i.role as string | undefined, name: i.name as string | undefined }) });
    }
    if (b && c === "purge" && method === "GET") return out(purgePreview(actor, b));
    if (b && c === "purge" && method === "POST") return out(await purgeMember(actor, b, (await body(req)).confirmEmail));
    if (b && c === "reset" && method === "POST") { if (isVendor(b)) return fail(403, "The maintenance account keeps its own password", "vendor_fixed"); }
    if (b && c === "reset" && method === "POST") return out({ initialPassword: resetPassword(actor.id, b) });
    // 離職與交接 (feat/ce-org): what the person owns, then the one action that hands it over and disables the account.
    if (b && c === "inventory" && method === "GET") { if (!userById(b)) return fail(404, "No such user"); sweepLeaverKeys(); return out({ inventory: inventoryOf(b), keys: leaverKeyState(b) }); }
    if (b && c === "leave" && method === "POST") {
      const i = await body(req);
      const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, never>) : undefined);
      return out({ result: leaveUser(actor, b, { successorId: str(i.successorId) || null, channels: obj(i.channels), assignments: obj(i.assignments), orders: obj(i.orders), agents: i.agents === "keep" ? "keep" : "transfer" }) });
    }
    if (b && c === "unit-change" && method === "GET") return out({ preview: previewUnitChange(b, (new URL(req.url).searchParams.get("units") ?? "").split(",").filter(Boolean)) });
    if (b && c === "units" && method === "PUT") {
      const i = await body(req);
      const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, never>) : undefined);
      return out({ result: applyUnitChange(actor, b, { unitIds: Array.isArray(i.unitIds) ? (i.unitIds as string[]) : [], assignments: obj(i.assignments), assignTo: str(i.assignTo) || null }) });
    }
    if (b && c === "employee-id" && method === "PUT") { setEmployeeId(actor.id, b, (await body(req)).employeeId); return out({ user: userById(b) }); }
  }
  if (a === "groups") {
    if (!b && method === "GET") { const arch = archivedMap(); return out({ groups: listGroups().map((g) => ({ ...g, archivedAt: arch.get(g.id) ?? null })) }); }
    if (b && c === "archive" && method === "POST") return out(((await body(req)).archived === false ? unarchiveClass : archiveClass)(actor, b));
    if (!b && method === "POST") {
      const i = await body(req);
      return out({ group: createGroup(actor.id, { name: str(i.name), description: str(i.description), parentId: (i.parentId as string) || null }) }, { status: 201 });
    }
    if (b && !c && method === "DELETE") { deleteGroup(actor.id, b); return out({ ok: true }); }
    if (b && !c && method === "PATCH") {
      const i = await body(req);
      return out({ group: updateGroup(actor.id, b, { name: i.name === undefined ? undefined : str(i.name), description: i.description === undefined ? undefined : str(i.description), parentId: "parentId" in i ? ((i.parentId as string) || null) : undefined }) });
    }
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
    // The two switches for people's own connections, and how many each person has (a count, never an address or a key).
    if (b === "personal") { const r = await personalAdminRoutes(req, method, actor, c, method === "PUT" ? await body(req) : {}); if (r) return r; }
  }
  if (a === "idle") {
    if (method === "GET") return out({ minutes: idleMinutes() });
    if (method === "PUT") return out({ minutes: setIdleMinutes(actor.id, (await body(req)).minutes) });
  }
  if (a === "skills") {
    if (b === "submitted" && method === "GET") return out({ skills: mineSkill.listSubmitted(), units: listGroups().map((g) => ({ id: g.id, name: g.name })) });
    if (b === "share" && method === "POST") { const i = await body(req); return out(mineSkill.shareSkill(actor.id, { userId: str(i.userId), name: str(i.name), scope: str(i.scope), unitId: str(i.unitId) || undefined })); }
    if (b === "reject" && method === "POST") { const i = await body(req); mineSkill.rejectSubmitted(actor.id, str(i.userId), str(i.name)); return out({ ok: true }); }
  }
  if (a === "system" && method === "GET") return out(systemStatus());
  if (a === "web") return webAdminRoutes(req, method, actor, b);
  if (a === "asr") return asrAdminRoutes(req, method, actor, b);
  if (a === "rooms") {
    if (b === "deleted" && method === "GET") return out({ rooms: listDeletedRooms(actor) });
    if (b && c === "restore" && method === "POST") { restoreRoom(actor, b); return out({ ok: true }); }
    // The only way channel data ever goes away: by hand, archived channels only, two confirmations (see rooms/service.ts purgeRoom).
    if (b && c === "purge" && method === "POST") { purgeRoom(actor, b, await body(req)); return out({ ok: true }); }
  }
  if (a === "connectors") { const r = await connectorAdminRoutes(method, actor, b, c, () => body(req)); if (r) return r; }
  if (a === "n8n") {
    // c = id, and the every n8n admin route is /n8n/<kind>[/<id>] (webhooks, keys).
    if (b === "webhooks") {
      if (!c && method === "GET") return out({ webhooks: listWebhooks() });
      if (!c && method === "POST") return out(saveWebhook(actor.id, await body(req)), { status: 201 });
      if (c && method === "PATCH") return out(saveWebhook(actor.id, await body(req), c));
      if (c && method === "DELETE") { deleteWebhook(actor.id, c); return out({ ok: true }); }
    }
    if (b === "publish-policy") {
      if (method === "GET") return out({ policy: getPolicy() });
      if (method === "PUT") return out({ policy: savePolicy(actor.id, await body(req)) });
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
      return out({ room: createRoom(actor, str(i.name), ids, str(i.unitId) || null) }, { status: 201 });
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
    // 1.1.0-ce follows the old Portal: "@AI" is plain Q&A, "@<role>" calls that role, "@person" only tags. A natural-language sentence
    // such as 「@AI 用監督看最近三天」 is NOT turned into a 訊息分析 run any more (a weak model's chat must never start a model job
    // that writes to people's bells); 訊息分析 starts from the channel's menu (wizards/rooms/:room/adhoc). See DECISIONS "@AI".
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
  if (id && !sub && method === "PATCH") { const i = await body(req); return out({ room: setRoomUnit(actor, id, str(i.unitId) || null, i.isDefault === true) }); }
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
  if (!id && method === "POST") return out({ assignment: apiAssignment(startIfAi(createAssignment(actor, await body(req)))) }, { status: 201 });
  if (!id && method === "GET") {
    const q = new URL(req.url).searchParams;
    return out({ assignments: listAssignments(actor, q.get("scope") || "mine", q.get("status") || undefined, q.get("source") || undefined, q.get("kind") || undefined).map(apiAssignment) });
  }
  if (id === "count" && method === "GET") return out(pendingCount(actor));
  if (id && !action && method === "GET") return out({ assignment: apiAssignment(requireVisible(actor, id)) });
  if (id && action === "accept" && method === "POST") return out({ assignment: apiAssignment(acceptAssignment(actor, id)) });
  const isAi = !!id && id !== "count" && requireVisible(actor, id).assigneeKind === "ai";
  if (id && action === "complete" && method === "POST") return out({ assignment: apiAssignment(isAi ? confirmAiAssignment(actor, id, str((await body(req)).note)) : completeAssignment(actor, id, str((await body(req)).note))) });
  if (id && action === "return" && method === "POST") return out({ assignment: apiAssignment(isAi ? returnAiAssignment(actor, id, (await body(req)).reason) : returnAssignment(actor, id, (await body(req)).reason)) });
  return fail(404, "Not found");
}

/** 提醒泡泡 and 個人區: only what this person must act on. `tzo` = the browser's Date.getTimezoneOffset(), so "today" is the caller's day. */
const tzoOf = (req: Request): number => { const n = Number(new URL(req.url).searchParams.get("tzo")); return Number.isFinite(n) && Math.abs(n) <= 840 ? n : 0; };

async function bulletin(req: Request, method: string, actor: Actor, what: string | undefined): Promise<Response> {
  if (method !== "GET") return fail(404, "Not found");
  if (what === "summary") return out(bulletinSummary(actor, Date.now(), tzoOf(req)));
  if (what === "personal") return out({ items: personalItems(actor, Date.now(), tzoOf(req)).map((i) => (i.kind === "assignment" ? { ...i, assignment: apiAssignment(i.assignment) } : i)) });
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
