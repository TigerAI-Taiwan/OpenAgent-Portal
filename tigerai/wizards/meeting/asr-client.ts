// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { openAsBlob } from "node:fs";
import { asrKey, compareKey, effectiveAsr, effectiveCompare, glossaryTerms } from "./asr-settings";

/**
 * Some OpenAI-compatible servers (llama.cpp / vLLM serving Qwen3-ASR) return the model's raw tag in front of the text:
 * `language Chinese<asr_text>...`. Drop that prefix and any stray <asr_text> tags; plain text passes through unchanged.
 */
export function cleanAsrText(raw: string): string {
  return raw.replace(/^\s*language\s+[A-Za-z][A-Za-z -]*?\s*<asr_text>/i, "").replace(/<\/?asr_text>/gi, "").trim();
}

let toTaiwan: ((s: string) => string) | null | undefined;
/** Simplified -> Traditional with Taiwan phrasing (opencc-js, s2tw: characters only; the phrase table of s2twp turned 新品导入 into 新品匯入). Text that is already Traditional is unchanged; if the library cannot load, the text is returned as it is. */
export async function taiwanText(text: string): Promise<string> {
  if (toTaiwan === undefined) {
    try { const m = (await import("opencc-js")) as { Converter: (o: { from: string; to: string }) => (s: string) => string }; toTaiwan = m.Converter({ from: "cn", to: "tw" }); } catch { toTaiwan = null; }
  }
  return toTaiwan ? toTaiwan(text) : text;
}

/** Send one audio file to a speech service. The file is read lazily from disk (a file-backed Blob), never loaded whole. */
async function transcribeAt(e: { url: string | null; model: string; language: string | null }, key: string | null, path: string, name: string, mime: string): Promise<string> {
  if (!e.url) throw new Error("not_configured");
  const fd = new FormData();
  fd.append("file", await openAsBlob(path, { type: mime }), name);
  fd.append("model", e.model);
  fd.append("response_format", "json");
  if (e.language) fd.append("language", e.language);
  const terms = glossaryTerms();
  if (terms.length) fd.append("prompt", terms.join("、").slice(0, 600)); // a hint, for endpoints that accept it (OpenAI-style `prompt`)
  const res = await fetch(e.url, { method: "POST", headers: key ? { Authorization: `Bearer ${key}` } : {}, body: fd, signal: AbortSignal.timeout(60 * 60_000) });
  if (!res.ok) throw new Error(`The speech service answered ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  let text = "";
  if (ct.includes("json")) text = String(((await res.json()) as { text?: unknown }).text ?? "");
  else text = await res.text();
  text = await taiwanText(cleanAsrText(text));
  if (!text) throw new Error("The speech service returned no text");
  return text;
}

export function transcribeFile(path: string, name: string, mime: string): Promise<string> { return transcribeAt(effectiveAsr(), asrKey(), path, name, mime); }
/** The 對照模型 (optional second service); null when none is set. */
export function transcribeCompare(path: string, name: string, mime: string): Promise<string> {
  const c = effectiveCompare();
  if (!c) return Promise.reject(new Error("not_configured"));
  return transcribeAt(c, compareKey(), path, name, mime);
}
