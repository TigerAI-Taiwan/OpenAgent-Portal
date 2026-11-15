// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { writeAudit } from "../accounts/audit";
import { readWebSettings } from "../web/settings";
import { buildPptx } from "./deck";

/**
 * .pptx -> PDF through a separate 文件轉檔服務 (Gotenberg: LibreOffice behind HTTP, `POST /forms/libreoffice/convert`). LibreOffice is NOT in
 * the Portal image; the administrator points the Portal at the service in 設定 → 管理 → 上網查資料. One conversion at a time (a queue):
 * LibreOffice is single-process and a class pressing the button together must not start twenty of them. Not configured or failing is
 * not an error for the caller: the deck is still delivered as .pptx.
 */

const CONVERT_TIMEOUT_MS = 120_000;
const QUEUE = Symbol.for("tigerai:converter-queue");
function queue<T>(task: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as Record<symbol, Promise<unknown> | undefined>;
  const prev = g[QUEUE] ?? Promise.resolve();
  const run = prev.then(task, task);
  g[QUEUE] = run.then(() => undefined, () => undefined);
  return run;
}

export class ConvertError extends Error {}

export function converterConfigured(): boolean { return readWebSettings().converterUrl !== ""; }

export async function convertToPdf(pptx: Buffer, baseUrl = readWebSettings().converterUrl): Promise<Buffer> {
  if (!baseUrl) throw new ConvertError("not configured");
  return queue(async () => {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(pptx)], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), "deck.pptx");
    let res: Response;
    try { res = await fetch(`${baseUrl.replace(/\/+$/, "")}/forms/libreoffice/convert`, { method: "POST", body: form, signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS), redirect: "error" }); }
    catch { throw new ConvertError("The conversion service could not be reached"); }
    if (!res.ok) throw new ConvertError(`The conversion service answered HTTP ${res.status}`);
    const pdf = Buffer.from(await res.arrayBuffer());
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ConvertError("The conversion service did not return a PDF");
    return pdf;
  });
}

/** Admin's 「測試」: converts a one-slide deck (Chinese text included) and reports OK. Uses the form's address when given. */
export async function testConverter(actorId: string, url?: string) {
  const t0 = Date.now();
  const target = (url ?? readWebSettings().converterUrl).trim();
  try {
    if (!target) throw new ConvertError("The conversion service address is not set");
    const pptx = await buildPptx({ title: "轉檔測試 Conversion test", subtitle: "OpenAgent Portal", slides: [{ title: "測試投影片", points: ["繁體中文要能正常顯示"] }] });
    const pdf = await convertToPdf(pptx, target);
    writeAudit("web.test", actorId, { target: "converter", ok: true });
    return { ok: true, ms: Date.now() - t0, bytes: pdf.length };
  } catch (e) {
    writeAudit("web.test", actorId, { target: "converter", ok: false });
    return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : "failed" };
  }
}
