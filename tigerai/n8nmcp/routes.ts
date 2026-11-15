// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { connectorTemplates, connectorsFor, deleteMcpServer, listMcpServers, saveMcpServer, testMcpConnection } from "./service";
import { assignOwner, listOwned, setShared } from "./ownership";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import "./grants"; // registers what approving an n8n write request does (the work-order router needs it loaded)

/** /api/tg/connectors for signed-in people; /api/tg/admin/connectors... for administrators (the router has already checked the role). */
type Actor = { id: string; role: "admin" | "member" };
const out = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });

export function connectorRoutes(method: string, actor: Actor, b: string | undefined): Response | null {
  if (!b && method === "GET") return out({ connectors: connectorsFor(actor) });
  return null;
}

export async function connectorAdminRoutes(method: string, actor: Actor, b: string | undefined, c: string | undefined, body: () => Promise<Record<string, unknown>>): Promise<Response | null> {
  if (!b && method === "GET") return out({ servers: listMcpServers(), templates: connectorTemplates() });
  if (!b && method === "POST") return out(saveMcpServer(actor.id, await body()), { status: 201 });
  if (b === "test" && method === "POST") return out(await testMcpConnection(actor.id, await body()));
  if (b && c === "test" && method === "POST") return out(await testMcpConnection(actor.id, { ...(await body()), id: b }));
  // Who owns which workflow, and which ones are shared for running (ownership.ts). Administrators only; the maintenance account has no write here.
  if (b && c === "workflows" && method === "GET") return out({ workflows: listOwned(b) });
  if (b && c === "workflows" && method === "POST") {
    const i = await body();
    const wf = String(i.workflowId ?? "").trim();
    if (!wf || wf.length > 80) throw new ServiceError("bad_workflow", "workflowId is required");
    if (typeof i.ownerId === "string" && i.ownerId) { assignOwner(b, wf, i.ownerId); writeAudit("mcp.workflow.assign", actor.id, { serverId: b, workflowId: wf, ownerId: i.ownerId }); }
    if (typeof i.shared === "boolean") { setShared(b, wf, actor.id, i.shared); writeAudit("mcp.workflow.share", actor.id, { serverId: b, workflowId: wf, shared: i.shared }); }
    return out({ ok: true });
  }
  if (b && !c && method === "PATCH") return out(saveMcpServer(actor.id, await body(), b));
  if (b && !c && method === "DELETE") { deleteMcpServer(actor.id, b); return out({ ok: true }); }
  return null;
}
