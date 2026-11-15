// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { deleteForm, departmentsFor, dryRun, fontReady, formsFor, importForm, managedForms, mayManage, myOutputs, outputFor, specOf, updateForm } from "./service";

/** /api/tg/forms/...: signed-in people (each handler checks who may do what). */
type Actor = { id: string; role: "admin" | "member" };
const out = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });

export async function formRoutes(method: string, actor: Actor, b: string | undefined, c: string | undefined, d: string | undefined, body: () => Promise<Record<string, unknown>>): Promise<Response | null> {
  if (!b && method === "GET") return out({ forms: formsFor(actor).map(specOf), outputs: myOutputs(actor) });
  if (b === "outputs" && c && d === "download" && method === "GET") {
    const f = outputFor(actor, c);
    const bytes = readFileSync(f.path);
    return new NextResponse(bytes, { headers: {
      "content-type": "application/pdf", "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-disposition": `attachment; filename="form.pdf"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    } });
  }
  if (b === "manage") {
    if (!mayManage(actor)) return out({ error: "Only administrators and department heads can manage forms", code: "forbidden" }, { status: 403 });
    if (!c && method === "GET") return out({ forms: managedForms(actor), departments: departmentsFor(actor), fontReady: fontReady() });
    if (!c && method === "POST") return out(await importForm(actor, await body()), { status: 201 });
    if (c && !d && method === "PATCH") { await updateForm(actor, c, await body()); return out({ ok: true }); }
    if (c && !d && method === "DELETE") { deleteForm(actor, c); return out({ ok: true }); }
    if (c && d === "check" && method === "POST") return out(dryRun(actor, c, (await body()).data));
  }
  return null;
}
