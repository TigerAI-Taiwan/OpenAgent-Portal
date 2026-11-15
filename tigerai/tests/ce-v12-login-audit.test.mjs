// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.2-ce: a failed sign-in never stores text typed into the account field unless it is a known account.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v12-la-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const { getDb } = await import("../db/store.ts");
const PW = "Test-Pass-12345!";
acc.createUser(null, { email: "amy@x.example", name: "Amy", password: PW, mustChange: false });
const login = (email) => handle(new Request("http://x/api/tg/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "wrong-password-1" }) }), ["login"]);

test("a password typed in the account field is not in the audit; a known account is", async () => {
  const typed = "Sup3r-Secret-Typed-Here";
  assert.equal((await login(typed)).status, 401);
  assert.equal((await login("amy@x.example")).status, 401);
  const rows = getDb().prepare("SELECT extra FROM audit WHERE action='auth.login_failed' ORDER BY id").all();
  assert.equal(rows.length, 2);
  assert.ok(!rows[0].extra.includes("Sup3r") && !rows[0].extra.includes("Secret"), rows[0].extra);
  const a = JSON.parse(rows[0].extra);
  assert.equal(a.account, "unknown"); assert.match(a.ref, /^[0-9a-f]{8}$/);
  assert.equal(JSON.parse(rows[1].extra).email, "amy@x.example");
  const { loginFailureFields } = await import("../accounts/login-audit.ts");
  assert.equal(loginFailureFields(typed).ref, a.ref, "same text, same tag");
  assert.notEqual(loginFailureFields(typed + "x").ref, a.ref);
});

test("registration audits carry no typed account text", () => {
  const rows = getDb().prepare("SELECT extra FROM audit WHERE action LIKE 'account.self_register%'").all();
  for (const r of rows) assert.ok(!/email/.test(r.extra ?? ""));
});
