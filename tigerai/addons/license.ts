// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";
import { LICENSE_PUBLIC_KEY_PEM } from "./license-key";

/**
 * Licence file = JSON { payload: { org, edition, features[], issuedAt, expires }, signature: base64(Ed25519 over canonical(payload)) }.
 * `expires` is a calendar date (YYYY-MM-DD, valid through the end of that day, UTC). Nothing here phones home; a licence that
 * verifies and has not expired is valid. Known gap: there is no protection against setting the server clock back.
 */

export interface LicensePayload { org: string; edition: string; features: string[]; issuedAt: string; expires: string }
export type LicenseCheck =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: "missing" | "unreadable" | "bad_signature" | "expired" | "bad_payload"; payload?: LicensePayload };

/** Where add-on licences live: TIGERAI_ADDON_DIR, else <data dir>/addons. The licence is `license.json` inside it. */
export function addonDir(): string { return process.env.TIGERAI_ADDON_DIR || join(dataDir(), "addons"); }
export function licensePath(): string { return process.env.TIGERAI_LICENSE_FILE || join(addonDir(), "license.json"); }

/** The exact bytes that are signed: the payload with its keys in a fixed order. */
export function canonicalPayload(p: LicensePayload): string {
  return JSON.stringify({ org: p.org, edition: p.edition, features: [...p.features], issuedAt: p.issuedAt, expires: p.expires });
}

function validPayload(v: unknown): v is LicensePayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.org === "string" && p.org.length > 0 && typeof p.edition === "string" && Array.isArray(p.features) && p.features.every((f) => typeof f === "string")
    && typeof p.issuedAt === "string" && typeof p.expires === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.expires);
}

export function checkLicenseText(text: string, now = Date.now(), publicKeyPem = LICENSE_PUBLIC_KEY_PEM): LicenseCheck {
  let doc: { payload?: unknown; signature?: unknown };
  try { doc = JSON.parse(text); } catch { return { ok: false, reason: "unreadable" }; }
  if (!validPayload(doc.payload) || typeof doc.signature !== "string") return { ok: false, reason: "bad_payload" };
  let good = false;
  try { good = verify(null, Buffer.from(canonicalPayload(doc.payload)), createPublicKey(publicKeyPem), Buffer.from(doc.signature, "base64")); } catch { good = false; }
  if (!good) return { ok: false, reason: "bad_signature" };
  const end = Date.parse(`${doc.payload.expires}T23:59:59.999Z`);
  if (!Number.isFinite(end) || now > end) return { ok: false, reason: "expired", payload: doc.payload };
  return { ok: true, payload: doc.payload };
}

const CACHE = Symbol.for("tigerai:license-cache");
type Cache = { path: string; mtime: number; size: number; text: string | null };

/** Reads the licence file (re-read only when it changes) and verifies it; expiry is re-checked on every call. */
export function readLicense(now = Date.now()): LicenseCheck {
  const path = licensePath();
  const g = globalThis as unknown as Record<symbol, Cache | undefined>;
  if (!existsSync(path)) { g[CACHE] = undefined; return { ok: false, reason: "missing" }; }
  let text: string;
  try {
    const st = statSync(path);
    const c = g[CACHE];
    if (c && c.path === path && c.mtime === st.mtimeMs && c.size === st.size && c.text !== null) text = c.text;
    else { text = readFileSync(path, "utf8"); g[CACHE] = { path, mtime: st.mtimeMs, size: st.size, text }; }
  } catch { return { ok: false, reason: "unreadable" }; }
  return checkLicenseText(text, now, testKey() ?? LICENSE_PUBLIC_KEY_PEM);
}

/** Unit tests of the mount point sign with a throwaway key. Honoured ONLY inside `node --test` (NODE_TEST_CONTEXT is set by the runner); a running server never sets it. */
const TEST_KEY = Symbol.for("tigerai:test-license-key");
export function setTestLicenseKey(pem: string | null): void { (globalThis as unknown as Record<symbol, string | null>)[TEST_KEY] = pem; }
function testKey(): string | null { return process.env.NODE_TEST_CONTEXT ? ((globalThis as unknown as Record<symbol, string | null | undefined>)[TEST_KEY] ?? null) : null; }
