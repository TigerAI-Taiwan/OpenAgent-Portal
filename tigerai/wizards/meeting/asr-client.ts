// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { openAsBlob } from "node:fs";
import { asrKey, effectiveAsr } from "./asr-settings";

/** Send one audio file to the configured service. The file is read lazily from disk (a file-backed Blob), never loaded whole. */
export async function transcribeFile(path: string, name: string, mime: string): Promise<string> {
  const e = effectiveAsr();
  if (!e.url) throw new Error("not_configured");
  const key = asrKey();
  const fd = new FormData();
  fd.append("file", await openAsBlob(path, { type: mime }), name);
  fd.append("model", e.model);
  fd.append("response_format", "json");
  if (e.language) fd.append("language", e.language);
  const res = await fetch(e.url, { method: "POST", headers: key ? { Authorization: `Bearer ${key}` } : {}, body: fd, signal: AbortSignal.timeout(60 * 60_000) });
  if (!res.ok) throw new Error(`The speech service answered ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  let text = "";
  if (ct.includes("json")) text = String(((await res.json()) as { text?: unknown }).text ?? "");
  else text = await res.text();
  text = text.trim();
  if (!text) throw new Error("The speech service returned no text");
  return text;
}
