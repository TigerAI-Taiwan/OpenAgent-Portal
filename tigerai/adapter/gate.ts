// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { activeAddons } from "../addons/registry";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionCookie } from "../accounts/session";
import { userById, type UserRow } from "../accounts/service";
import { canAccessSession } from "../rooms/ownership";
import { ensurePersonalDir, personalDir } from "../workspace";
import { PROVIDER_ID, v1Locked } from "../provider/v1";
import { MEMBER_COMMANDS, MEMBER_NEW_COMMANDS, memberCommandDenied } from "./member-commands";
import { subscribeBody } from "../push";

/**
 * The proxy-side gate (hook H02). Rules, in order:
 *  1. strip every client-supplied x-tg-* header (identity can only come from here)
 *  2. verify the signed cookie, then re-read the account: disabled accounts and
 *     stale token versions are rejected on every request
 *  3. a forced password change confines the user to the change-password page
 *  4. admin-only paths; for members an allow-list of upstream API paths, so a
 *     new upstream route is admin-only until someone decides otherwise
 *  5. conversation ids in the path must belong to the user
 */

export const UID_HEADER = "x-tg-uid";

const PUBLIC = new Set(["/tg/login", "/api/tg/login"]);
const PWC_ALLOWED = new Set(["/tg/account", "/api/tg/me", "/api/tg/logout", "/api/tg/account/password"]);

const MEMBER_GET_EXACT = new Set([
  "/api/sessions", "/api/sessions/search", "/api/agent/running", "/api/models", "/api/models/default",
  "/api/cache-miss-notices", "/api/push/config", "/api/cwd/browse",
]);
const SESSION_ROOT_NON_ID = new Set(["search", "stats", "ui-state", "delete"]);
const AGENT_ROOT_NON_ID = new Set(["new", "running", "debug"]);

function json(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function redirectToLogin(req: NextRequest): NextResponse {
  const url = new URL("/tg/login", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

/** Session id named by the path, if the path addresses one conversation. */
export function sessionIdInPath(path: string): string | null {
  const m = /^\/api\/(sessions|agent)\/([^/]+)(?:\/|$)/.exec(path);
  if (!m) return null;
  const skip = m[1] === "sessions" ? SESSION_ROOT_NON_ID : AGENT_ROOT_NON_ID;
  if (skip.has(m[2])) return null;
  try { return decodeURIComponent(m[2]); } catch { return m[2]; }
}

/** Upstream's terminal API (create / read / write / resize a pty). */
export function terminalClosed(path: string): boolean { return path === "/api/terminal" || path.startsWith("/api/terminal/"); }

/** Upstream's MCP settings (list/save, test, sign-in). The community edition has no MCP integration: these answer 404 unless an add-on package is licensed. */
export function mcpSettingsPath(path: string): boolean { return path === "/api/mcp" || path.startsWith("/api/mcp/"); }

export async function gate(req: NextRequest, failed: boolean): Promise<NextResponse> {
  const path = req.nextUrl.pathname;
  const method = req.method.toUpperCase();
  const isApi = path === "/api" || path.startsWith("/api/");
  if (failed) return json(503, "TigerAI module failed to start");

  const headers = new Headers(req.headers);
  for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-tg-")) headers.delete(k);
  headers.delete("authorization"); // upstream's Basic password is not used when accounts are on

  const pass = () => NextResponse.next({ request: { headers } });

  if (path === "/login") return NextResponse.redirect(new URL("/tg/login", req.url));
  if (path === "/api/web-auth") return json(410, "Replaced by /api/tg/login");
  if (PUBLIC.has(path)) return pass();
  // n8n and other callers authenticate with their own key inside the handler, not with a cookie.
  if (path === "/api/tigerai/hooks/agent" || path === "/api/tigerai/hooks/wizards/tick") {
    const authz = req.headers.get("authorization");
    if (authz) headers.set("authorization", authz); // the caller's key travels here, unlike upstream's Basic password
    return pass();
  }

  const payload = verifySessionCookie(req.cookies.get(SESSION_COOKIE)?.value);
  let user: UserRow | null = null;
  if (payload) {
    const row = userById(payload.uid);
    if (row && row.status === "active" && row.token_version === payload.ver) user = row;
  }
  if (!user) return isApi ? json(401, "Authentication required") : redirectToLogin(req);

  if (user.must_change_pw && !PWC_ALLOWED.has(path)) {
    return isApi ? json(403, "password_change_required") : NextResponse.redirect(new URL("/tg/account", req.url));
  }
  headers.set(UID_HEADER, user.id);

  // A terminal is a shell on the server: it would bypass every member permission, so it is closed to ALL roles (administrators too).
  if (terminalClosed(path)) return json(403, "terminal_closed: the workspace terminal is turned off");

  if (mcpSettingsPath(path) && activeAddons().length === 0) return json(404, "Not found");

  const locked = modelsLockResponse(path, method, user.role);
  if (locked) return locked;

  // Upstream keeps push subscriptions with no owner and tells ALL of them about every conversation. Here the subscription is bound to
  // the signed-in person and upstream's list is never written (so its broadcast reaches nobody; see push/index.ts).
  if (method === "POST" && path === "/api/push/subscribe") {
    try { subscribeBody(user.id, await req.json()); } catch { return json(400, "Invalid push subscription"); }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  if (user.role === "admin") return pass();

  // ---- members ----
  if (path === "/tg/admin" || path.startsWith("/tg/admin/") || path.startsWith("/api/tg/admin/")) {
    return isApi ? json(403, "Administrator only") : NextResponse.redirect(new URL("/", req.url));
  }
  if (path.startsWith("/tg/") || path.startsWith("/api/tg/")) return pass();
  if (!isApi) return pass();

  const sid = sessionIdInPath(path);
  if (sid) {
    if (!canAccessSession(user, sid)) return json(403, "You do not have access to this conversation");
    if (method === "POST" && path === `/api/agent/${encodeURIComponent(sid)}`) {
      const denied = await commandDenied(req, MEMBER_COMMANDS);
      if (denied) return json(403, denied);
    }
    return pass();
  }
  // Members have no home directory of their own on the host: answer with their personal folder.
  if (method === "GET" && path === "/api/home") return NextResponse.json({ home: personalDir(user.id) });
  if (method === "POST" && path === "/api/default-cwd") return NextResponse.json({ cwd: ensurePersonalDir(user.id) });
  if (method === "GET" && MEMBER_GET_EXACT.has(path)) return pass();
  if (method === "GET" && path.startsWith("/api/files/")) return pass(); // narrowed again by H09
  if (method === "POST" && path === "/api/sessions/stats") return pass(); // ids filtered by H05
  if (path === "/api/sessions/ui-state") return pass();
  if (method === "POST" && path === "/api/cwd/validate") return pass();
  if (method === "POST" && path === "/api/agent/new") {
    const denied = await commandDenied(req, MEMBER_NEW_COMMANDS);
    return denied ? json(403, denied) : pass();
  }
  return json(403, "Administrator only");
}

/**
 * With a /v1 endpoint configured, models are provisioned by the operator for everyone:
 * sign-in flows and provider/model editing are closed to ALL roles (administrators too),
 * and the provider lists the Models panel shows are empty. Enforced here, not by hiding buttons.
 */
function modelsLockResponse(path: string, method: string, role: string): NextResponse | null {
  if (!v1Locked()) return null;
  if (method === "GET" && path === "/api/auth/providers" && role === "admin") {
    return NextResponse.json({ providers: [], oauthProviders: [], apiKeyProviders: [], providerNames: { [PROVIDER_ID]: "TigerAI Models (admin-provisioned)" } }, { headers: { "Cache-Control": "no-store" } });
  }
  const closed = path.startsWith("/api/auth/") || path.startsWith("/api/models/refresh") || path.startsWith("/api/models/enabled")
    || (path.startsWith("/api/models-config") && method !== "GET");
  if (closed) return json(403, "models_locked: models are provisioned by the administrator and cannot be changed here");
  return null;
}

async function commandDenied(req: NextRequest, allowed: ReadonlySet<string>): Promise<string | null> {
  try {
    return memberCommandDenied(await req.clone().json(), allowed);
  } catch {
    return "Unreadable command";
  }
}
