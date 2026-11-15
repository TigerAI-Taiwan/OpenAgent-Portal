// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { MAX_FILE_BYTES } from "../org/xlsx";
import { applyOrgImport, planOrgImport } from "../org/import";

/** /api/tg/admin/org/{preview,apply}: the body is the .xlsx file itself. Administrators only (checked again here). */
export async function orgRoutes(req: Request, method: string, actor: { id: string; role: string }, a?: string, b?: string): Promise<Response | null> {
  if (a !== "org" || method !== "POST" || (b !== "preview" && b !== "apply")) return null;
  if (actor.role !== "admin") return NextResponse.json({ error: "Administrator only" }, { status: 403 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 2 MB" }, { status: 413 });
  const buffer = Buffer.from(await req.arrayBuffer());
  const headers = { "Cache-Control": "no-store" };
  if (b === "preview") return NextResponse.json(await planOrgImport(buffer), { headers });
  const result = await applyOrgImport(actor.id, buffer);
  return NextResponse.json(result, { headers });
}
