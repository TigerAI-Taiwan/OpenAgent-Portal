// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: the community edition has no user limit and no 100-user reminder. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-nolimit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-nolimit-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const acc = await import("../accounts/service.ts");

test("150 accounts can be created: nothing counts or limits users", () => {
  for (let i = 0; i < 150; i++) acc.createUser(null, { email: `u${i}@x.example`, name: `U${i}`, password: "Test-Pass-12345!", mustChange: false });
  assert.equal(acc.listUsers().length, 150);
});

test("no source file mentions a 100-user limit or reminder", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const hits = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (n === "tests") continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n) && /(100\s*(人|位|users|seats))|userLimit|seat_limit|MAX_USERS/i.test(readFileSync(p, "utf8"))) hits.push(p); } };
  walk(root);
  assert.deepEqual(hits, []);
});
