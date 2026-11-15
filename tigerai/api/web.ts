// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { ServiceError, type Role } from "../accounts/service";
import { writeAudit } from "../accounts/audit";
import { saveWebSettings, viewWebSettings, type Provider } from "../web/settings";
import { testSearch } from "../web/service";
import { testConverter } from "../slides/convert";
import { openDeck } from "../slides/store";

type Actor = { id: string; role: Role };
const out = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new ServiceError("content_type", "Content-Type must be application/json", 415);
  try { const v = await req.json(); if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* fall through */ }
  throw new ServiceError("bad_json", "Expected a JSON object");
}

/** /api/tg/admin/web — administrators only (the router refused everyone else; checked again). GET view, PUT save, POST test, POST test-converter. */
export async function webAdminRoutes(req: Request, method: string, actor: Actor, sub: string | undefined): Promise<Response> {
  if (actor.role !== "admin") throw new ServiceError("forbidden", "Administrator only", 403);
  if (!sub && method === "GET") return out(viewWebSettings());
  if (!sub && method === "PUT") return out(saveWebSettings(actor.id, await body(req)));
  if (sub === "test" && method === "POST") {
    const i = await body(req);
    return out(await testSearch(actor.id, { provider: i.provider as Provider | undefined, searxUrl: typeof i.searxUrl === "string" ? i.searxUrl : undefined, apiKey: typeof i.apiKey === "string" ? i.apiKey : undefined }));
  }
  if (sub === "test-converter" && method === "POST") {
    const i = await body(req);
    return out(await testConverter(actor.id, typeof i.url === "string" ? i.url : undefined));
  }
  return out({ error: "Not found" }, { status: 404 });
}

/** GET /api/tg/slides/<id>?format=pdf|pptx — a made deck, for the people openDeck allows. */
export function slidesRoutes(_req: Request, method: string, actor: Actor, id: string | undefined, format: string | null): Response {
  if (method !== "GET" || !id) return out({ error: "Not found" }, { status: 404 });
  const f = format === "pptx" ? "pptx" : "pdf";
  const { meta, file } = openDeck(actor, id, f);
  writeAudit("slides.download", actor.id, { deck: meta.id, format: f, room: meta.roomId });
  const name = `${meta.title.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 60) || "slides"}.${f}`;
  return new NextResponse(new Uint8Array(file), { headers: {
    "Content-Type": f === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "Content-Disposition": `attachment; filename="slides.${f}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
