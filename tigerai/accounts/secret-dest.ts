// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports. One rule for every "test" and "save" that holds a stored secret: a STORED key only ever travels to the address it was
// stored for. Pointing a form at a different address (or provider) without typing the key again must fail, for every role.
// Why: a 測試連線 button that fills in the saved key and posts it to whatever address is in the form turns any admin-capable
// account into a way to copy the key to a host of its choice (security review H1).

/** Normalised for comparison only: trimmed, trailing slashes dropped, scheme and host lower-cased. Never returned to anyone. */
export function destKey(url: unknown): string {
  const raw = String(url ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try { const u = new URL(raw); return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`; } catch { return raw.toLowerCase(); }
}
export const sameDest = (a: unknown, b: unknown): boolean => destKey(a) === destKey(b);
export const typedSecret = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

/**
 * May the stored secret be used for `target`? True when there is nothing stored to protect, the destination is the stored one,
 * or the caller typed a new secret. `target` empty/undefined means "the stored address".
 */
export function mayUseStoredSecret(opts: { hasStored: boolean; storedDest: unknown; targetDest: unknown; typedNew: boolean }): boolean {
  if (!opts.hasStored || opts.typedNew) return true;
  if (opts.targetDest === undefined || opts.targetDest === null || String(opts.targetDest).trim() === "") return true;
  return sameDest(opts.storedDest, opts.targetDest);
}
export const KEY_REQUIRED = "The address changed, so the saved key is not sent there. Type the key again to use it with the new address.";
