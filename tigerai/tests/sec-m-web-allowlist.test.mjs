// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// web_fetch only opens addresses the user pasted in the conversation or web_search returned in it; redirects stay on the same site.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-m-web-allowlist.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "tg-allow-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const acc = await import("../accounts/service.ts");
const S = await import("../web/settings.ts");
const net = await import("../web/net.ts");
const al = await import("../web/allowlist.ts");
const { createWebExtension } = await import("../web/extension.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const { getDb } = await import("../db/store.ts");
const admin = acc.createUser(null, { email: "a@example.com", name: "Admin", role: "admin", password: "Test-Pass-12345!", mustChange: false }).user;
let base;
const server = http.createServer((req, res) => {
  if (req.url === "/robots.txt") { res.writeHead(404); return res.end(); }
  if (req.url === "/same") { res.writeHead(302, { location: `${base}/landed` }); return res.end(); }
  if (req.url === "/other") { res.writeHead(302, { location: "http://localhost:" + server.address().port + "/landed" }); return res.end(); }
  res.writeHead(200, { "content-type": "text/plain" }); res.end("page " + req.url);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
base = `http://127.0.0.1:${server.address().port}`;
S.saveWebSettings(admin.id, { enabled: true, provider: "searxng", searxUrl: base });
net.__setBlockedForTests(() => false);
test.after(() => { server.close(); net.__setBlockedForTests(null); });

test("helpers: URLs are pulled out of free text (full-width punctuation too); registrable domain; normalisation", () => {
  assert.deepEqual(al.extractUrls("看這個 https://example.com/a?b=1。還有(http://x.org/p),謝謝"), ["https://example.com/a?b=1", "http://x.org/p"]);
  assert.equal(al.normalizeUrl("HTTPS://Example.com/a/#frag"), al.normalizeUrl("http://example.com/a"));
  assert.equal(al.registrableDomain("www.example.com.tw"), "example.com.tw");
  assert.equal(al.registrableDomain("news.bbc.co.uk"), "bbc.co.uk");
  assert.equal(al.sameSite("a.example.com", "b.example.com"), true);
  assert.equal(al.sameSite("example.com", "evil.com"), false);
});

function boot() {
  const sid = `s-${Math.random().toString(36).slice(2)}`;
  const cwd = join(dir, "data", "workspace", "users", admin.id);
  registerOwner(sid, admin.id, cwd, "chat", null);
  const tools = new Map(); createWebExtension().factory({ on: () => {}, registerTool: (t) => tools.set(t.name, t) });
  const entries = [];
  const ctx = { sessionManager: { getSessionId: () => sid, getEntries: () => entries }, cwd };
  const user = (text) => entries.push({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
  const fetchText = async (url) => (await tools.get("web_fetch").execute("1", { url }, undefined, undefined, ctx)).content[0].text;
  const search = (q) => tools.get("web_search").execute("2", { query: q }, undefined, undefined, ctx);
  return { user, fetchText, search, entries, sid };
}

test("an address the user pasted can be read; an address nobody gave is refused with the Chinese message, and logged", async () => {
  const b = boot();
  assert.match(await b.fetchText(`${base}/secret`), /只能讀你貼的網址或搜尋結果裡的網址/);
  assert.ok(getDb().prepare("SELECT 1 FROM audit WHERE action='web.fetch_blocked' AND extra LIKE '%not_in_conversation%'").get());
  b.user(`請幫我讀 ${base}/pasted 這一頁。`);
  assert.match(await b.fetchText(`${base}/pasted`), /page \/pasted/);
  assert.match(await b.fetchText(`${base}/pasted2`), /只能讀你/, "another page of the same site is not allowed");
});

test("an address that came back from web_search in this conversation can be read, in no other conversation", async () => {
  const b = boot(), other = boot();
  al.recordSearchResults(b.sid, [`${base}/hit1`]);
  assert.match(await b.fetchText(`${base}/hit1`), /page \/hit1/);
  assert.match(await other.fetchText(`${base}/hit1`), /只能讀你/);
});

test("redirects are followed only within the same registrable domain", async () => {
  const b = boot();
  b.user(`${base}/same ${base}/other`);
  assert.match(await b.fetchText(`${base}/same`), /page \/landed/);
  const t = await b.fetchText(`${base}/other`); // 127.0.0.1 -> localhost: another site
  assert.doesNotMatch(t, /page \/landed/);
});
