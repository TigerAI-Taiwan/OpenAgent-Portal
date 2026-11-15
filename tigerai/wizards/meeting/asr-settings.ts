// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../config";
import { ServiceError } from "../../accounts/service";
import { writeAudit } from "../../accounts/audit";
import { KEY_REQUIRED, mayUseStoredSecret, sameDest, typedSecret } from "../../accounts/secret-dest";

/**
 * 語音轉文字服務 (speech to text): an OpenAI-compatible /audio/transcriptions endpoint.
 *   asr-settings.json   url, model, language   (mode 600)
 *   asr-api-key         the key alone          (mode 600; only its last 4 characters are ever shown)
 * Environment (TIGERAI_ASR_URL, TIGERAI_ASR_MODEL, TIGERAI_ASR_API_KEY_FILE) is the initial default; a saved value wins.
 */

export interface AsrSettings { url?: string; model?: string; language?: string; glossary?: string; compareUrl?: string; compareModel?: string }
const settingsFile = () => join(dataDir(), "asr-settings.json");
export const asrKeyFile = () => join(dataDir(), "asr-api-key");
export const compareKeyFile = () => join(dataDir(), "asr-compare-key");

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

/** The 對照模型's own key (never the main key: a second service is a second trust decision). */
export function compareKey(): string | null {
  try { const k = readFileSync(compareKeyFile(), "utf8").trim(); return k || null; } catch { return null; }
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

/** 公司術語表: one term per line (治具、首件、八D…), at most 60 terms of 30 characters. Used as the ASR hint and for the summary's mis-hearing fix. */
export function cleanGlossary(v: unknown): string {
  const terms = String(v ?? "").split(/[\n,，、;；]+/).map((t) => t.trim().replace(/\s+/g, " ").slice(0, 30)).filter(Boolean);
  return [...new Set(terms)].slice(0, 60).join("\n");
}
export function glossaryTerms(): string[] { return cleanGlossary(readAsr().glossary).split("\n").filter(Boolean); }

export function effectiveAsr(): { url: string | null; model: string; language: string | null } {
  const s = readAsr();
  const url = s.url || process.env.TIGERAI_ASR_URL || null;
  return { url, model: s.model || process.env.TIGERAI_ASR_MODEL || "whisper-1", language: s.language || null };
}
export const asrConfigured = (): boolean => !!effectiveAsr().url;

/**
 * 對照模型: an optional second speech-to-text endpoint (1.1.2-ce). Only used together with a configured main service. The main
 * transcript stays the record; the second one only marks the places where the two disagree (crosscheck.ts).
 */
export function effectiveCompare(): { url: string; model: string; language: string | null } | null {
  const s = readAsr();
  if (!s.compareUrl || !asrConfigured()) return null;
  return { url: s.compareUrl, model: s.compareModel || effectiveAsr().model, language: effectiveAsr().language };
}

export function viewAsr() {
  const e = effectiveAsr(); const k = asrKey();
  const c = compareKey(); const s = readAsr();
  return {
    configured: !!e.url, url: e.url ?? "", model: e.model, language: e.language ?? "", glossary: cleanGlossary(readAsr().glossary), hasKey: !!k, keyLast4: k ? k.slice(-4) : null,
    compareUrl: s.compareUrl ?? "", compareModel: s.compareModel ?? "", hasCompareKey: !!c, compareKeyLast4: c ? c.slice(-4) : null,
  };
}

export function saveAsr(actorId: string, input: Record<string, unknown>) {
  const next: AsrSettings = { ...readAsr() };
  const changed: string[] = [];
  if ("url" in input) {
    const before = effectiveAsr().url;
    if (input.url === null || input.url === "") delete next.url; else next.url = normalizeAsrUrl(input.url);
    // The saved key belongs to the saved address: pointing the service elsewhere needs the key typed again (or removed).
    const after = next.url ?? effectiveAsr().url;
    if (before && asrKey() && !sameDest(before, after) && !typedSecret(input.apiKey) && input.apiKey !== null) throw new ServiceError("key_required", KEY_REQUIRED);
    changed.push("url");
  }
  if ("model" in input) { const m = String(input.model ?? "").trim().slice(0, 80); if (m) next.model = m; else delete next.model; changed.push("model"); }
  if ("language" in input) { const l = String(input.language ?? "").trim().slice(0, 12); if (/^[A-Za-z-]*$/.test(l)) { if (l) next.language = l; else delete next.language; } else throw new ServiceError("bad_language", "Language must be a code such as zh"); changed.push("language"); }
  if ("glossary" in input) { const g = cleanGlossary(input.glossary); if (g) next.glossary = g; else delete next.glossary; changed.push("glossary"); }
  if ("compareUrl" in input) {
    const before = next.compareUrl ?? null;
    if (input.compareUrl === null || input.compareUrl === "") delete next.compareUrl; else next.compareUrl = normalizeAsrUrl(input.compareUrl);
    // Same rule as the main key: the saved 對照 key belongs to the saved 對照 address.
    if (before && compareKey() && next.compareUrl && !sameDest(before, next.compareUrl) && !typedSecret(input.compareApiKey) && input.compareApiKey !== null) throw new ServiceError("key_required", KEY_REQUIRED);
    changed.push("compareUrl");
  }
  if ("compareModel" in input) { const m = String(input.compareModel ?? "").trim().slice(0, 80); if (m) next.compareModel = m; else delete next.compareModel; changed.push("compareModel"); }
  if ("compareApiKey" in input) {
    if (input.compareApiKey === null) { try { unlinkSync(compareKeyFile()); } catch { /* none */ } }
    else if (typeof input.compareApiKey === "string" && input.compareApiKey.trim()) atomicWrite(compareKeyFile(), input.compareApiKey.trim() + "\n");
    else throw new ServiceError("bad_key", "The key must be a non-empty string, or null to remove it");
    changed.push("compareApiKey");
  }
  if ("apiKey" in input) {
    if (input.apiKey === null) { try { unlinkSync(asrKeyFile()); } catch { /* none */ } }
    else if (typeof input.apiKey === "string" && input.apiKey.trim()) atomicWrite(asrKeyFile(), input.apiKey.trim() + "\n");
    else throw new ServiceError("bad_key", "The key must be a non-empty string, or null to remove it");
    changed.push("apiKey");
  }
  if (!next.compareUrl) { try { unlinkSync(compareKeyFile()); } catch { /* none */ } }
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
export async function testAsr(input: { url?: unknown; apiKey?: unknown; model?: unknown; target?: unknown }) {
  const started = Date.now();
  try {
    const cmp = input.target === "compare";
    const e = cmp ? { url: readAsr().compareUrl ?? null, model: readAsr().compareModel || effectiveAsr().model } : effectiveAsr();
    const url = input.url ? normalizeAsrUrl(input.url) : e.url;
    if (!url) return { ok: false, ms: 0, code: "not_configured", error: "No address is configured" };
    const typed = typedSecret(input.apiKey);
    const stored = cmp ? compareKey() : asrKey();
    // The saved key is sent only to the saved address (H1).
    if (!mayUseStoredSecret({ hasStored: !!stored, storedDest: e.url, targetDest: url, typedNew: typed })) return { ok: false, ms: 0, code: "key_required", error: KEY_REQUIRED };
    const key = typed ? String(input.apiKey).trim() : stored;
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
