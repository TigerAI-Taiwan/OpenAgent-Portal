// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// DEV ONLY - not part of the product. A fake n8n for local tests:
//   node tigerai/dev/mock-n8n.mjs <port> <token-file>
//   POST /webhook/monthly-revenue  {co_id}  -> fixed monthly revenue JSON (fictional figures)
//   POST /mcp-server/http          minimal MCP over HTTP (initialize, tools/list, tools/call), Bearer token
//   GET  /webhook/portal-get/lookup?co_id=...  a Webhook node left on n8n's default method (GET): POST answers 404 like n8n does
//   GET  /__stats                  what was received (payloads of the webhook; MCP tool names)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 30174);
const token = readFileSync(process.argv[3], "utf8").trim();
const echoKey = process.argv[4] ? readFileSync(process.argv[4], "utf8").trim() : null; // value of X-Portal-Test-Key for /webhook/portal-test/echo
const stats = { get: [], webhook: [], mcp: [], echo: [], keyRefused: 0, unauthorised: 0 };
const TOOLS = ["search_workflows", "get_workflow_details", "execute_workflow", "get_workflow_execution", "create_workflow_from_code", "update_workflow", "publish_workflow", "archive_workflow"];
const COMPANIES = { "2308": { name: "Delta Electronics", month: "2026-10", revenue_ntd_thousand: 36542100, yoy_percent: 8.4 } };

const lookup = (coId) => (COMPANIES[String(coId)] ? { co_id: String(coId), ...COMPANIES[String(coId)] } : { co_id: String(coId), error: "unknown company" });

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/__stats") return json(200, stats);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* leave empty */ }
    if (url.pathname === "/webhook/portal-get/lookup") {
      if (req.method !== "GET") return json(404, { code: 404, message: `This webhook is not registered for ${req.method} requests. Did you mean to make a GET request?` });
      const q = Object.fromEntries(url.searchParams); stats.get.push(q);
      return json(200, lookup(q.co_id));
    }
    if (req.method === "POST" && url.pathname === "/webhook/monthly-revenue") {
      stats.webhook.push(body);
      return json(200, lookup(body.co_id));
    }
    if (req.method === "POST" && url.pathname === "/webhook/portal-test/echo") {
      if (echoKey && req.headers["x-portal-test-key"] !== echoKey) { stats.keyRefused++; return json(403, { error: "bad key" }); }
      stats.echo.push(body);
      return json(200, { result: { received: body, timestamp: new Date().toISOString(), via: "fake-n8n" } });
    }
    if (url.pathname === "/mcp-server/http") {
      if (req.headers.authorization !== `Bearer ${token}`) { stats.unauthorised++; return json(401, { error: "unauthorised" }); }
      const reply = (result) => json(200, { jsonrpc: "2.0", id: body.id, result });
      if (body.method === "initialize") return reply({ protocolVersion: body.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake-n8n", version: "0" } });
      if (body.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      if (body.method === "tools/list") return reply({ tools: [
        { name: "lookup_revenue", description: "Monthly revenue of a listed company by stock code.", inputSchema: { type: "object", properties: { co_id: { type: "string" } }, required: ["co_id"] } },
        ...TOOLS.map((name) => ({ name, description: `fake ${name}`, inputSchema: { type: "object", properties: { id: { type: "string" } } } })),
      ] });
      if (body.method === "tools/call") {
        stats.mcp.push(body.params?.name);
        return reply({ content: [{ type: "text", text: JSON.stringify(lookup(body.params?.arguments?.co_id)) }] });
      }
      return json(200, { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
    }
    res.writeHead(404); res.end();
  });
}).listen(port, "127.0.0.1", () => console.log(`fake n8n on 127.0.0.1:${port}`));
