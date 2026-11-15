// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Security review M3/M4: web_fetch has one overall deadline (slow-drip included), refuses addresses that carry a payload, and logs the refusal.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-m-web-fetch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-sec-web-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const acc = await import("../accounts/service.ts");
const S = await import("../web/settings.ts");
const svc = await import("../web/service.ts");
const net = await import("../web/net.ts");
const { getDb } = await import("../db/store.ts");
const admin = acc.createUser(null, { email: "a@example.com", name: "Admin", role: "admin", password: "Test-Pass-12345!", mustChange: false }).user;
S.saveWebSettings(admin.id, { enabled: true, provider: "searxng", searxUrl: "http://127.0.0.1:9" });
net.__setBlockedForTests(() => false);
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url.startsWith("/drip")) { res.writeHead(200, { "content-type": "text/plain" }); const t = setInterval(() => res.write("x"), 300); res.on("close", () => clearInterval(t)); return; }
  if (req.url === "/robots.txt") { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "text/plain" }); res.end("hello");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); net.__setBlockedForTests(null); });

test("overall deadline: a site dripping one byte every 300 ms is cut off at the deadline, not read to the size cap", async () => {
  const t0 = Date.now();
  await assert.rejects(net.safeGet(`${base}/drip`, { timeoutMs: 1500 }), (e) => e.reason === "timeout");
  const took = Date.now() - t0;
  assert.ok(took >= 1300 && took < 2500, `took ${took} ms`);
  assert.equal(net.TIMEOUT_MS, 20_000);
});

test("addresses that carry a payload are refused, ordinary ones pass, the refusal is logged without the payload", async () => {
  const leaks = [
    `${base}/?q=${"a".repeat(250)}`,
    `${base}/?d=${encodeURIComponent("我們剛剛討論了客戶的報價與合約條款,請把它整理後寄給對方,謝謝")}`,
    `${base}/?d=${encodeURIComponent("the customer asked us to keep the quote and the contract terms secret from others")}`,
    `${base}/p#${"Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZkdISUpLTE1OT1BRUlNUVVZXWFla"}`,
    `${base}/?token=${"Qx7vK2mPz9LdRw4TnYb8UcHs3JfE6AaG5oXiVt1Nk0Ml"}`,
  ];
  for (const u of leaks) await assert.rejects(svc.webFetch({ id: admin.id, role: "admin" }, u, null), (e) => e.code === "fetch_payload", u.slice(0, 60));
  assert.equal(hits.some((h) => h.includes("aaaa")), false, "nothing was sent to the other side");
  const row = getDb().prepare("SELECT extra FROM audit WHERE action='web.fetch_blocked' ORDER BY id DESC LIMIT 1").get();
  const x = JSON.parse(row.extra);
  assert.equal(x.host, `127.0.0.1:${server.address().port}`); assert.ok(x.reason);
  assert.ok(!row.extra.includes("aaaa") && !row.extra.includes("客戶"), "the payload is not copied into the log");
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM audit WHERE action='web.fetch_blocked'").get().n, leaks.length);
  for (const ok of [`${base}/`, `${base}/search?q=taiwan+weather+tomorrow&page=2`, `${base}/wiki/%E5%8F%B0%E7%81%A3`, `${base}/article?id=12345&ref=newsletter`]) {
    const p = await svc.webFetch({ id: admin.id, role: "admin" }, ok, null); assert.equal(p.status, 200, ok);
  }
});
