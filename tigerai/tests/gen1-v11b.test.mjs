// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Batch v11b: the terminal is closed for every role.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-v11b.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const dir = mkdtempSync(join(tmpdir(), "tg-v11b-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const acc = await import("../accounts/service.ts");
const ses = await import("../accounts/session.ts");
const { gate, terminalClosed } = await import("../adapter/gate.ts");

const mk = (email, role) => acc.createUser(null, { email, name: role === "admin" ? "Admin" : "Member", role, password: "Test-Pass-12345!", mustChange: false }).user;
const admin = mk("admin@example.com", "admin");
const member = mk("m@example.com", "member");
const ask = (u, method, path) => gate(new NextRequest(`http://127.0.0.1:30141${path}`, { method, headers: { cookie: `${ses.SESSION_COOKIE}=${ses.createSessionCookie(u.id, u.token_version)}` } }), false);

test("terminal API: 403 for admin and member on /api/terminal and below", async () => {
  for (const u of [admin, member]) {
    for (const [m, p] of [["POST", "/api/terminal"], ["GET", "/api/terminal"], ["POST", "/api/terminal/abc"], ["GET", "/api/terminal/abc/stream"], ["DELETE", "/api/terminal/abc"]]) {
      const r = await ask(u, m, p);
      assert.equal(r.status, 403, `${u.role} ${m} ${p}`);
    }
  }
  assert.equal((await ask(admin, "GET", "/api/home")).status, 200, "other API stays open for the admin");
  assert.equal(terminalClosed("/api/terminalx"), false);
});

test("module off: the gate is not consulted (adapter returns null)", async () => {
  const { proxyGate } = await import("../adapter/index.ts");
  process.env.TIGERAI_ENABLED = "0";
  assert.equal(proxyGate(new NextRequest("http://127.0.0.1/api/terminal", { method: "POST" })), null);
  process.env.TIGERAI_ENABLED = "1";
});

test("the 「>_」 button is hidden in every UI language, and the upstream titles still match the selectors", () => {
  const css = readFileSync(new URL("../ui/kit.tsx", import.meta.url), "utf8");
  for (const lang of ["en", "zh-TW", "zh-CN"]) {
    const msg = readFileSync(new URL(`../../lib/i18n/messages/${lang}.ts`, import.meta.url), "utf8");
    const title = /"terminal\.open": "([^"]+)"/.exec(msg)[1];
    assert.ok(css.includes(`button[title="${title}"]`), `${lang}: ${title}`);
  }
  assert.match(css, /display:none !important/);
});
