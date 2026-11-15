// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Security review low items: L2 reserved name, L3 CSV quoting (shape), L8 maintenance account never owns channels.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-low-fixes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "tg-low-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_VENDOR_EMAIL = "vendor@tiger.example";
process.env.TIGERAI_VENDOR_PASSWORD = "Vendor-Pass-12345!";
process.env.TIGERAI_VENDOR_MUST_CHANGE = "0";
const acc = await import("../accounts/service.ts");
const { bootstrapVendor } = await import("../accounts/vendor.ts");
const { oldestAdmin } = await import("../rooms/unit-channel.ts");
const { getDb } = await import("../db/store.ts");

test("L2: the reserved name AI is refused in full-width, padded and zero-width forms", () => {
  for (const n of ["AI", "ai", "Ａｉ", "ＡＩ", " AI ", "A​I", "a i"]) assert.equal(acc.isReservedName(n), true, JSON.stringify(n));
  for (const n of ["Aimee", "AIM", "陳小明"]) assert.equal(acc.isReservedName(n), false, n);
  assert.throws(() => acc.createUser(null, { email: "x@example.com", name: "Ａｉ", password: "Test-Pass-12345!", mustChange: false }), (e) => e.code === "bad_name");
});
test("L8: the oldest-administrator lookup never returns the maintenance account, even when it is the only active administrator or the oldest", () => {
  const admin = acc.createUser(null, { email: "a@example.com", name: "Admin", role: "admin", password: "Test-Pass-12345!", mustChange: false }).user;
  bootstrapVendor();
  getDb().prepare("UPDATE users SET created_at=1 WHERE is_vendor=1").run(); // the oldest of all
  assert.equal(oldestAdmin(), admin.id);
  getDb().prepare("UPDATE users SET status='disabled' WHERE id=?").run(admin.id);
  assert.equal(oldestAdmin(), null, "with the customer's administrator gone the maintenance account does not inherit");
});
