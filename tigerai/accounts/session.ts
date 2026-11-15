// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";

/**
 * Signed login cookie (HMAC). No server-side session table: a restart does not
 * log anyone out. Revocation uses the account's token_version, which the proxy
 * compares on every request, so disabling an account or changing its password
 * invalidates cookies already issued.
 */

export const SESSION_COOKIE = "tigerai_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export interface SessionPayload { uid: string; ver: number; exp: number }

let cachedSecret: Buffer | null = null;

export function sessionSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.TIGERAI_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return (cachedSecret = Buffer.from(fromEnv, "utf8"));
  if (fromEnv) throw new Error("TIGERAI_SESSION_SECRET must be at least 32 characters");
  const dir = dataDir();
  const file = join(dir, "session.key");
  if (existsSync(file)) {
    const stored = Buffer.from(readFileSync(file, "utf8").trim(), "base64url");
    if (stored.length >= 32) return (cachedSecret = stored);
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const generated = randomBytes(48);
  writeFileSync(file, generated.toString("base64url"), { encoding: "utf8", mode: 0o600 });
  return (cachedSecret = generated);
}

function sign(data: string): string {
  return createHmac("sha256", sessionSecret()).update(data).digest("base64url");
}

export function createSessionCookie(uid: string, ver: number, maxAge = SESSION_MAX_AGE_SECONDS): string {
  const payload: SessionPayload = { uid, ver, exp: Math.floor(Date.now() / 1000) + maxAge };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Checks signature and expiry only; the caller still checks the account. */
export function verifySessionCookie(value: string | undefined | null): SessionPayload | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const provided = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(body), "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.ver !== "number") return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieHeader(value: string, maxAge = SESSION_MAX_AGE_SECONDS): string {
  // Secure only over HTTPS: a Secure cookie on plain http is silently dropped
  // and the symptom ("login works, then back to the login page") is hard to trace.
  const secure = process.env.TIGERAI_COOKIE_SECURE === "1" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(): string {
  return sessionCookieHeader("", 0);
}
