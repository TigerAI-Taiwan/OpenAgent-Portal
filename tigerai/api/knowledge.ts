// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { ServiceError, type Role } from "../accounts/service";
import { createRoleAsHead, departmentsFor, managedRoles, requireHeadOrAdmin, requireManage, updateRoleAsHead } from "../knowledge/access";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "../knowledge/budget";
import { deleteFile, putFile, readFileText, viewKnowledge } from "../knowledge/store";
import { disableAgent } from "../agents/service";
import { listGroups } from "../accounts/service";

/**
 * /api/tg/knowledge/...  (department heads and administrators; every handler checks again, a member gets 403 for all of it)
 *   GET    roles                      roles I may manage + departments I may create in
 *   POST   roles                      create a role (head: for one of their departments)
 *   PATCH  roles/:id                  edit its text
 *   DELETE roles/:id                  switch it off
 *   GET    roles/:id/files            files with inline / on-demand split and the budget
 *   GET    roles/:id/files/:name      download (managers only)
 *   PUT    roles/:id/files/:name      add or replace; the body is the raw file
 *   DELETE roles/:id/files/:name
 */
type Actor = { id: string; role: Role };
const H = { "Cache-Control": "no-store" };
const out = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: H });

async function json(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new ServiceError("content_type", "Content-Type must be application/json", 415);
  try { const v = await req.json(); if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* fall through */ }
  throw new ServiceError("bad_json", "Expected a JSON object");
}

async function rawBody(req: Request): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) throw new ServiceError("too_big", `One file may be at most ${MAX_FILE_BYTES / 1024} KB`, 413);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new ServiceError("too_big", `One file may be at most ${MAX_FILE_BYTES / 1024} KB`, 413);
  return buf;
}

function roleView(a: ReturnType<typeof managedRoles>[number], names: Map<string, string>) {
  return {
    id: a.id, name: a.name, description: a.description, system_prompt: a.system_prompt, enabled: a.enabled, group_ids: a.group_ids,
    departments: a.group_ids.map((g) => names.get(g) ?? g), model: a.model,
    // Beyond-budget files are read by the AI with the read tool; a role whose tool list leaves read out cannot do that.
    canReadOnDemand: a.tool_names === null || a.tool_names.includes("read"),
  };
}

export async function knowledgeRoutes(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [what, id, sub, rawName] = seg;
  if (what !== "roles") return out({ error: "Not found" }, 404);
  const names = new Map(listGroups().map((g) => [g.id, g.name]));
  if (!id) {
    if (method === "GET") {
      requireHeadOrAdmin(actor);
      return out({ roles: managedRoles(actor).map((a) => roleView(a, names)), departments: departmentsFor(actor), limits: { maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES, maxTotalBytes: MAX_TOTAL_BYTES } });
    }
    if (method === "POST") return out({ role: roleView(createRoleAsHead(actor, await json(req)), names) }, 201);
    return out({ error: "Not found" }, 404);
  }
  if (!sub) {
    if (method === "PATCH") return out({ role: roleView(updateRoleAsHead(actor, id, await json(req)), names) });
    if (method === "DELETE") { const a = requireManage(actor, id); disableAgent(actor.id, a.id); return out({ ok: true }); }
    return out({ error: "Not found" }, 404);
  }
  if (sub !== "files") return out({ error: "Not found" }, 404);
  const role = requireManage(actor, id);
  if (!rawName) {
    if (method !== "GET") return out({ error: "Not found" }, 404);
    const v = viewKnowledge(role);
    return out({ files: v.files, budget: v.plan, role: roleView(role, names), limits: { maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES, maxTotalBytes: MAX_TOTAL_BYTES } });
  }
  const name = rawName; // Next has already decoded the path segment; cleanName refuses separators and ..
  if (method === "GET") {
    const text = readFileText(role.id, name);
    return new NextResponse(text, { headers: { ...H, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "X-Content-Type-Options": "nosniff" } });
  }
  if (method === "PUT") { const r = putFile(actor.id, role.id, name, await rawBody(req)); return out({ file: r, view: (() => { const v = viewKnowledge(role); return { files: v.files, budget: v.plan }; })() }); }
  if (method === "DELETE") { deleteFile(actor.id, role.id, name); return out({ ok: true }); }
  return out({ error: "Not found" }, 404);
}
