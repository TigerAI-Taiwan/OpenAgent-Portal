// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ServiceError, type Role } from "../accounts/service";
import { createSessionCookie, sessionCookieHeader } from "../accounts/session";
import { RateLimited, approveGroup, approveRequest, autoApprove, codeRequired, disableCode, pendingRequests, rejectRequest, setPhrase, listCodes, registerStudent, registrationOpen, rotateCode, setRegistration } from "../register/service";

/**
 * 學生自行註冊 routes (called from router.ts).
 *   GET  register/status        public  { open, requireCode }  (lets the login page decide whether to show 「註冊」)
 *   POST register               public  name, email, password, code  -> account + signed in; 404 while the switch is off
 *   GET  joincodes              head / administrator: the departments they may hand a code for
 *   POST joincodes/:group       { action: "rotate" | "disable" }  the department's head or an administrator
 *   GET/PUT admin/register      administrator: { open, requireCode }
 */
type Actor = { id: string; role: Role };
const out = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });
const str = (v: unknown): string => (typeof v === "string" ? v : "");
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new ServiceError("content_type", "Content-Type must be application/json", 415);
  try { const v = await req.json(); if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* fall through */ }
  throw new ServiceError("bad_json", "Expected a JSON object");
}

/**
 * Who is typing, as well as the request tells: the forwarded address (set by the reverse proxy; a caller without one has nothing to
 * tell it apart from the class next to it, so then there is no client key and only the account key applies) plus the browser.
 * The address is spoofable, so it is one key among several, never the only defence. Never stored, never shown.
 */
function clientFingerprint(req: Request): string | undefined {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64);
  if (!ip) return undefined;
  return createHash("sha256").update(`${ip}|${req.headers.get("user-agent") ?? ""}|${req.headers.get("accept-language") ?? ""}`).digest("hex").slice(0, 24);
}

export async function registerPublic(req: Request, method: string, b: string | undefined): Promise<Response> {
  if (b === "status" && method === "GET") return out({ open: registrationOpen(), requireCode: codeRequired() });
  if (b === undefined && method === "POST") {
    try {
      const i = await body(req);
      const { user, pending } = registerStudent({ name: i.name, email: i.email, password: i.password, code: i.code, note: i.note, client: clientFingerprint(req) });
      if (pending) return out({ ok: true, pending: true }); // 待核准: no session cookie, the account cannot sign in yet
      return out({ ok: true }, { headers: { "Set-Cookie": sessionCookieHeader(createSessionCookie(user.id, user.token_version)) } });
    } catch (e) {
      if (e instanceof RateLimited) return out({ error: e.message, code: e.code }, { status: 429, headers: { "Retry-After": String(e.retryAfter) } });
      throw e;
    }
  }
  return out({ error: "Not found" }, { status: 404 });
}

export async function joinCodeRoutes(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [group] = seg;
  if (!group && method === "GET") return out({ groups: listCodes(actor) });
  if (group && method === "POST") {
    const b2 = await body(req);
    const action = str(b2.action);
    if (action === "rotate") return out({ group: rotateCode(actor, group) });
    if (action === "set") return out({ group: setPhrase(actor, group, b2.phrase) });
    if (action === "disable") return out({ group: disableCode(actor, group) });
    throw new ServiceError("bad_action", "Choose rotate or disable");
  }
  return out({ error: "Not found" }, { status: 404 });
}

export async function registerAdmin(req: Request, method: string, actor: Actor): Promise<Response> {
  if (actor.role !== "admin") throw new ServiceError("forbidden", "Administrator only", 403);
  if (method === "GET") return out({ open: registrationOpen(), requireCode: codeRequired(), autoApprove: autoApprove(), perHour: Number(process.env.TIGERAI_REGISTER_PER_HOUR) > 0 ? Math.floor(Number(process.env.TIGERAI_REGISTER_PER_HOUR)) : 120 });
  if (method === "PUT") {
    const i = await body(req);
    return out(setRegistration(actor.id, { open: typeof i.open === "boolean" ? i.open : undefined, requireCode: typeof i.requireCode === "boolean" ? i.requireCode : undefined, autoApprove: typeof i.autoApprove === "boolean" ? i.autoApprove : undefined }));
  }
  return out({ error: "Not found" }, { status: 404 });
}

/**
 * regrequests (administrator or class head; every decision is checked against the classes the caller may decide)
 *   GET                         { groups: [{ groupId, groupName, applicants: [...] }] }
 *   POST :userId {action}       approve | reject one applicant
 *   POST group {action:"approve_group", groupId|null}  這一班全部核准;  POST all {action:"approve_all"}
 */
export async function requestRoutes(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [id] = seg;
  if (!id && method === "GET") return out({ groups: pendingRequests(actor) });
  if (id && method === "POST") {
    const i = await body(req);
    const action = str(i.action);
    if (id === "group" && action === "approve_group") return out({ approved: approveGroup(actor, typeof i.groupId === "string" ? i.groupId : null) });
    if (id === "all" && action === "approve_all") return out({ approved: approveGroup(actor, "all") });
    if (action === "approve") { approveRequest(actor, id); return out({ ok: true }); }
    if (action === "reject") { rejectRequest(actor, id); return out({ ok: true }); }
    throw new ServiceError("bad_action", "Choose approve or reject");
  }
  return out({ error: "Not found" }, { status: 404 });
}
