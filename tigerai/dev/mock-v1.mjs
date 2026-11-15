// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// DEV ONLY - not part of the product. A tiny OpenAI-compatible /v1 server for local tests:
//   node tigerai/dev/mock-v1.mjs <port> <key-file>
// GET /v1/models, POST /v1/chat/completions (stream and non-stream, fixed reply), GET /__stats.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 30173);
const key = readFileSync(process.argv[3], "utf8").trim();
const stats = { models: 0, chat: 0, refused: 0, lastUserText: "", lastSystemText: "" };

const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : "");
const lastWith = (messages, role) => textOf([...(messages ?? [])].reverse().find((x) => x.role === role)?.content);

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__stats") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(stats)); return; }
  if (req.headers.authorization !== `Bearer ${key}`) {
    stats.refused++;
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "bad key" } }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    stats.models++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock-chat", object: "model" }, { id: "mock-small", object: "model" }] }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      stats.chat++;
      const json = JSON.parse(body || "{}");
      stats.lastUserText = lastWith(json.messages, "user").slice(0, 600);
      stats.lastSystemText = lastWith(json.messages, "system").slice(0, 3000);
      // Scripted tool use for tests: a user message containing CALL_TOOL:<name>:<json args> makes the model call that tool,
      // and when the tool result comes back it answers with "MOCK-TOOL-RESULT: <result>".
      const msgs = json.messages ?? [];
      const lastMsg = msgs[msgs.length - 1];
      const script = /CALL_TOOL:([A-Za-z0-9_]+):(\{.*?\})(?:\s|$)/s.exec(lastWith(msgs, "user"));
      let toolCall = null;
      let text = "MOCK-REPLY: I read the room and here is a fixed answer.";
      if (lastMsg?.role === "tool") text = `MOCK-TOOL-RESULT: ${textOf(lastMsg.content).slice(0, 600)}`;
      else if (script) toolCall = { name: script[1], args: script[2] };
      const id = `chatcmpl-${stats.chat}`;
      const created = Math.floor(Date.now() / 1000);
      const usage = { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 };
      const chunk = (choice, extra = {}) => ({ id, object: "chat.completion.chunk", created, model: json.model, choices: choice ? [choice] : [], ...extra });
      if (toolCall) {
        const call = { index: 0, id: `call_${stats.chat}`, type: "function", function: { name: toolCall.name, arguments: toolCall.args } };
        if (json.stream) {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
          const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
          send(chunk({ index: 0, delta: { role: "assistant", content: null, tool_calls: [call] }, finish_reason: null }));
          send(chunk({ index: 0, delta: {}, finish_reason: "tool_calls" }));
          send(chunk(null, { usage }));
          res.end("data: [DONE]\n\n");
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id, object: "chat.completion", created, model: json.model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: call.id, type: "function", function: call.function }] }, finish_reason: "tool_calls" }], usage }));
        }
        return;
      }
      if (json.stream) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        send(chunk({ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }));
        for (const word of text.split(/(?<= )/)) send(chunk({ index: 0, delta: { content: word }, finish_reason: null }));
        send(chunk({ index: 0, delta: {}, finish_reason: "stop" }));
        send(chunk(null, { usage }));
        res.end("data: [DONE]\n\n");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id, object: "chat.completion", created, model: json.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, "127.0.0.1", () => console.log(`mock /v1 on 127.0.0.1:${port}`));
