// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { ServiceError, type Role } from "../accounts/service";
import { describe, inlineOk, mimeOf, readBytes } from "../directory/tree";
import { exportMarkdownNode } from "../directory/export";

type Actor = { id: string; role: Role };
const NO_STORE = { "Cache-Control": "no-store" };
const json = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { ...NO_STORE, ...(init.headers ?? {}) } });

/**
 * /api/tg/dir (every signed-in person; the rules are in directory/tree.ts):
 *   GET /dir?node=<id>                  a folder's entries, or a file's text for the reader
 *   GET /dir/file?node=<id>             the file itself (download; an image / PDF / text opens in the page)
 *   GET /dir/export?node=<id>&format=pdf|pptx   a Markdown file as a PDF or deck
 * Only GET exists: the tree can neither write nor delete anything.
 */
export async function dirRoutes(req: Request, method: string, actor: Actor, sub: string | undefined): Promise<Response> {
  if (method !== "GET") throw new ServiceError("not_found", "Not found", 404);
  const q = new URL(req.url).searchParams;
  const node = q.get("node") || "root";
  if (!sub) return json(describe(actor, node));
  if (sub === "file") {
    const { name, bytes } = readBytes(actor, node);
    const safe = name.replace(/[\\/:*?"<>|\r\n]+/g, "_");
    const inline = inlineOk(name) && q.get("download") !== "1";
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": mimeOf(name), "X-Content-Type-Options": "nosniff", ...(mimeOf(name) === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox" }), ...NO_STORE, // a PDF needs the browser's viewer, which a sandbox would block; the rest is sandboxed
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    } });
  }
  if (sub === "export") {
    const f = q.get("format") === "pptx" ? "pptx" : "pdf";
    const r = await exportMarkdownNode(actor, node, f);
    return new NextResponse(new Uint8Array(r.bytes), { headers: { "Content-Type": r.mime, "X-Content-Type-Options": "nosniff", ...NO_STORE, "Content-Disposition": `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(r.filename)}` } });
  }
  throw new ServiceError("not_found", "Not found", 404);
}
