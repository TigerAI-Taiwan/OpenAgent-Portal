// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { ServiceError } from "../../accounts/service";
import { AUDIT_ACTION_ZH } from "../../accounts/audit-text";
import { saveAsr, testAsr, viewAsr } from "./asr-settings";
import { appendChunk, capabilities, createFromText, finishUpload, getView, linkAction, listMeetings, retry, startUpload, transcriptFile, view } from "./service";

// Chinese names for the audit page (the table in accounts/audit-text.ts is shared, so this module adds its own lines).
Object.assign(AUDIT_ACTION_ZH, {
  "asr.transcribe": "語音轉文字", "asr.update": "更新語音轉文字服務設定", "meeting.create": "建立會議記錄", "meeting.summary": "AI 整理會議摘要",
  "meeting.download": "下載逐字稿", "meeting.assignment_linked": "會議待辦開成交辦單", "wizard.deliver": "精靈送出個人通知",
});

type Actor = { id: string; role: "admin" | "member" };
const NO_STORE = { "Cache-Control": "no-store" };
const out = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { ...NO_STORE, ...(init.headers ?? {}) } });

async function json(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new ServiceError("content_type", "Content-Type must be application/json", 415);
  try { const v = await req.json(); if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* below */ }
  throw new ServiceError("bad_json", "Expected a JSON object");
}

/** /api/tg/admin/asr — administrators only (the router already refused everyone else; checked again here). */
export async function asrAdminRoutes(req: Request, method: string, actor: Actor, sub: string | undefined): Promise<Response> {
  if (actor.role !== "admin") throw new ServiceError("forbidden", "Administrator only", 403);
  if (!sub && method === "GET") return out(viewAsr());
  if (!sub && method === "PUT") return out(saveAsr(actor.id, await json(req)));
  if (sub === "test" && method === "POST") return out(await testAsr(await json(req)));
  throw new ServiceError("not_found", "Not found", 404);
}

/** /api/tg/meeting/* — see tigerai/docs/MEETING.md for the table. Every route is the caller's own or a room's they belong to. */
export async function meetingRoutes(req: Request, method: string, actor: Actor, seg: (string | undefined)[]): Promise<Response> {
  const [a, b, c] = seg;
  if (a === "capabilities" && method === "GET") return out(capabilities());
  if (a === "uploads") {
    if (!b && method === "POST") return out(startUpload(actor, await json(req)), { status: 201 });
    if (b && !c && method === "PUT") {
      const offset = Number(new URL(req.url).searchParams.get("offset"));
      if (!Number.isInteger(offset) || offset < 0) throw new ServiceError("bad_offset", "offset is required");
      return out(await appendChunk(actor, b, offset, req.body));
    }
    if (b && c === "finish" && method === "POST") return out({ meeting: view(actor, finishUpload(actor, b)) }, { status: 201 });
  }
  if (!a) {
    if (method === "GET") return out({ meetings: listMeetings(actor, new URL(req.url).searchParams.get("room") || undefined) });
    if (method === "POST") { const m = createFromText(actor, await json(req)); return out({ meeting: view(actor, m) }, { status: 201 }); }
  }
  if (a && !b && method === "GET") return out({ meeting: getView(actor, a) });
  if (a && b === "retry" && method === "POST") return out({ meeting: view(actor, retry(actor, a)) });
  if (a && b === "transcript" && method === "GET") {
    const f = transcriptFile(actor, a);
    return new Response(Readable.toWeb(createReadStream(f.path)) as ReadableStream, {
      headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="transcript.txt"; filename*=UTF-8''${encodeURIComponent(f.filename)}` },
    });
  }
  if (a && b === "actions" && c && method === "POST") {
    const i = await json(req);
    linkAction(actor, a, Number(c), String(i.assignmentId ?? ""));
    return out({ ok: true });
  }
  throw new ServiceError("not_found", "Not found", 404);
}
