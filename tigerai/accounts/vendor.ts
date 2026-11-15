// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { ServiceError, createUser } from "./service";
import { writeAudit } from "./audit";

/**
 * The maintenance account (維修帳號) of 虎智科技: an administrator-looking account (role stays 'admin' so the system pages open) that is
 * fenced by an allow-list (vendor-policy.ts, checked at the proxy AND in the dispatcher). It cannot read anyone's conversations or
 * records, cannot mint keys, cannot change roles (its own included). The customer's administrator may disable and enable it (never
 * delete or reset it); it does not count as "the customer's administrator" for the last-admin rule, approvals or notices.
 * Created at start-up when TIGERAI_VENDOR_EMAIL is set (optional); password from TIGERAI_VENDOR_PASSWORD or generated and printed once.
 */

export function isVendor(userId: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM users WHERE id=? AND is_vendor=1").get(userId);
}

export function vendorIds(): Set<string> {
  return new Set((getDb().prepare("SELECT id FROM users WHERE is_vendor=1").all() as unknown as { id: string }[]).map((r) => r.id));
}

/** Idempotent. Never turns an existing ordinary account into the maintenance account. */
export function bootstrapVendor(): void {
  const email = (process.env.TIGERAI_VENDOR_EMAIL ?? "").trim().toLowerCase();
  if (!email) return;
  const db = getDb();
  const row = db.prepare("SELECT id, is_vendor FROM users WHERE email=?").get(email) as { id: string; is_vendor: number } | undefined;
  if (row) { if (!row.is_vendor) console.error("[tigerai] TIGERAI_VENDOR_EMAIL names an ordinary account; it was left alone (use another e-mail)"); return; }
  const fromEnv = process.env.TIGERAI_VENDOR_PASSWORD || undefined; // compose passes "" when unset
  const { user, initialPassword } = createUser(null, { email, name: "虎智維修帳號", role: "admin", password: fromEnv, mustChange: !fromEnv || process.env.TIGERAI_VENDOR_MUST_CHANGE === "1" });
  db.prepare("UPDATE users SET is_vendor=1 WHERE id=?").run(user.id);
  writeAudit("vendor.create", null, { userId: user.id });
  console.log(initialPassword ? `[tigerai] maintenance account ${email} created. One-time password: ${initialPassword}` : `[tigerai] maintenance account ${email} created from TIGERAI_VENDOR_PASSWORD`);
}

/** The customer's administrator may only switch the maintenance account on or off. */
export function guardVendorChange(userId: string, patch: { role?: string; name?: string }): void {
  if (!isVendor(userId)) return;
  if (patch.role !== undefined || patch.name !== undefined) throw new ServiceError("vendor_fixed", "The maintenance account can only be disabled or enabled", 403);
}
