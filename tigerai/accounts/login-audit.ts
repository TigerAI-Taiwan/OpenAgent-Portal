// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHmac } from "node:crypto";
import { getDb } from "../db/store";
import { sessionSecret } from "./session";

/**
 * What a failed sign-in writes to the audit. People sometimes type the PASSWORD into the account field, so the typed text is kept only when
 * it is an existing account's e-mail (then it is already in the user list). Anything else is "unknown account" plus a short keyed hash
 * (same text -> same tag, so repeated tries can be told apart; the key never leaves the server, so the tag cannot be guessed offline).
 * Never the text, never a prefix of it.
 */
export function loginFailureFields(typed: string): Record<string, string> {
  const t = String(typed ?? "").trim().toLowerCase().slice(0, 120);
  if (t && getDb().prepare("SELECT 1 FROM users WHERE email=?").get(t)) return { email: t };
  return { account: "unknown", ref: createHmac("sha256", sessionSecret()).update(`login-field:${t}`).digest("hex").slice(0, 8) };
}
