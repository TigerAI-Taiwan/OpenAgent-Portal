// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../config";
import { ServiceError } from "../../accounts/service";
import { writeAudit } from "../../accounts/audit";

/**
 * 語音轉文字服務 (speech to text): an OpenAI-compatible /audio/transcriptions endpoint.
 *   asr-settings.json   url, model, language   (mode 600)
 *   asr-api-key         the key alone          (mode 600; only its last 4 characters are ever shown)
 * Environment (TIGERAI_ASR_URL, TIGERAI_ASR_MODEL, TIGERAI_ASR_API_KEY_FILE) is the initial default; a saved value wins.
 */

export interface AsrSettings { url?: string; model?: string; language?: string }
const settingsFile = () => join(dataDir(), "asr-settings.json");
export const asrKeyFile = () => join(dataDir(), "asr-api-key");

function atomicWrite(file: string, text: string): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

export function readAsr(): AsrSettings {
  try { const v = JSON.parse(readFileSync(settingsFile(), "utf8")) as AsrSettings; return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

export function asrKey(): string | null {
  for (const f of [asrKeyFile(), process.env.TIGERAI_ASR_API_KEY_FILE]) {
    if (!f || !existsSync(f)) continue;
    try { const k = readFileSync(f, "utf8").trim(); if (k) return k; } catch { /* next */ }
  }
  return null;
}

/** Accepts the full .../audio/transcriptions address or just the base (.../v1) and returns the full address. */
export function normalizeAsrUrl(v: unknown): string {
  const raw = String(v ?? "").trim().replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(raw); } catch { throw new ServiceError("bad_url", "The address is not valid"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ServiceError("bad_url", "The address must start with http:// or https://");
  if (u.username || u.password) throw new ServiceError("bad_url", "Do not put credentials in the address; use the key field");
  return /\/audio\/transcriptions$/.test(u.pathname) ? raw : `${raw}/audio/transcriptions`;
}

export function effectiveAsr(): { url: string | null; model: string; language: string | null } {
  const s = readAsr();
  const url = s.url || process.env.TIGERAI_ASR_URL || null;
  return { url, model: s.model || process.env.TIGERAI_ASR_MODEL || "whisper-1", language: s.language || null };
}
export const asrConfigured = (): boolean => !!effectiveAsr().url;

export function viewAsr() {
  const e = effectiveAsr(); const k = asrKey();
  return { configured: !!e.url, url: e.url ?? "", model: e.model, language: e.language ?? "", hasKey: !!k, keyLast4: k ? k.slice(-4) : null };
}

export function saveAsr(actorId: string, input: Record<string, unknown>) {
  const next: AsrSettings = { ...readAsr() };
  const changed: string[] = [];
  if ("url" in input) {
    if (input.url === null || input.url === "") delete next.url; else next.url = normalizeAsrUrl(input.url);
    changed.push("url");
  }
  if ("model" in input) { const m = String(input.model ?? "").trim().slice(0, 80); if (m) next.model = m; else delete next.model; changed.push("model"); }
  if ("language" in input) { const l = String(input.language ?? "").trim().slice(0, 12); if (/^[A-Za-z-]*$/.test(l)) { if (l) next.language = l; else delete next.language; } else throw new ServiceError("bad_language", "Language must be a code such as zh"); changed.push("language"); }
  if ("apiKey" in input) {
    if (input.apiKey === null) { try { unlinkSync(asrKeyFile()); } catch { /* none */ } }
    else if (typeof input.apiKey === "string" && input.apiKey.trim()) atomicWrite(asrKeyFile(), input.apiKey.trim() + "\n");
    else throw new ServiceError("bad_key", "The key must be a non-empty string, or null to remove it");
    changed.push("apiKey");
  }
  atomicWrite(settingsFile(), JSON.stringify(next, null, 2) + "\n");
  writeAudit("asr.update", actorId, { changed: changed.join(",") });
  return viewAsr();
}

/** One second of silence: enough for an endpoint to accept or refuse, nothing a person said. */
export function silentWav(): Uint8Array {
  const rate = 8000; const n = rate; const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

/** Always resolves; the failure is in the result and never contains the key. */
export async function testAsr(input: { url?: unknown; apiKey?: unknown; model?: unknown }) {
  const started = Date.now();
  try {
    const e = effectiveAsr();
    const url = input.url ? normalizeAsrUrl(input.url) : e.url;
    if (!url) return { ok: false, ms: 0, code: "not_configured", error: "No address is configured" };
    const key = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : asrKey();
    const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : e.model;
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(silentWav())], { type: "audio/wav" }), "test.wav");
    fd.append("model", model); fd.append("response_format", "json");
    const res = await fetch(url, { method: "POST", headers: key ? { Authorization: `Bearer ${key}` } : {}, body: fd, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { ok: false, ms: Date.now() - started, code: "asr", error: `The service answered ${res.status}` };
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, ms: 0, code: error.code, error: error.message };
    return { ok: false, ms: Date.now() - started, code: "asr", error: error instanceof Error ? error.message.slice(0, 160) : "failed" };
  }
}
