// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { MAX_FILE_BYTES } from "../org/xlsx";
import { runOrg } from "../org/import";
import { exportOrg } from "../org/export";
import { ServiceError } from "../accounts/service";

/**
 * /api/tg/admin/org/{export,preview,apply}. Administrators only (checked again here).
 *   GET  export                 org.xlsx of the current organisation
 *   POST preview                body = the .xlsx file -> errors, warnings, the change list and a digest. Writes nothing.
 *   POST apply?digest=<digest>  same body; applies only when the digest still matches (409 otherwise). All or nothing.
 */
export async function orgRoutes(req: Request, method: string, actor: { id: string; role: string }, a?: string, b?: string): Promise<Response | null> {
  if (a !== "org") return null;
  if (actor.role !== "admin") return NextResponse.json({ error: "Administrator only" }, { status: 403 });
  const headers = { "Cache-Control": "no-store" };
  if (method === "GET" && b === "export") {
    const { filename, bytes } = await exportOrg(actor.id);
    return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"`, "X-Content-Type-Options": "nosniff" } });
  }
  if (method !== "POST" || (b !== "preview" && b !== "apply")) return null;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 2 MB" }, { status: 413 });
  const buffer = Buffer.from(await req.arrayBuffer());
  if (b === "preview") return NextResponse.json((await runOrg(actor, buffer, "preview")).plan, { headers });
  const digest = new URL(req.url).searchParams.get("digest") ?? req.headers.get("x-org-digest") ?? "";
  if (!digest) throw new ServiceError("digest_required", "Preview first, then apply with the preview's digest", 400);
  const result = await runOrg(actor, buffer, "apply", digest);
  if (result.plan.errors.some((e) => e.code === "stale_preview")) return NextResponse.json({ error: result.plan.errors[0].message, code: "stale_preview" }, { status: 409, headers });
  if (result.plan.errors.length) return NextResponse.json({ error: `The file has ${result.plan.errors.length} problem(s); run the preview`, code: "invalid_file", plan: result.plan }, { status: 422, headers });
  return NextResponse.json({ summary: result.plan.summary, plan: result.plan, initialPasswordsCsv: result.initialPasswordsCsv }, { headers });
}
