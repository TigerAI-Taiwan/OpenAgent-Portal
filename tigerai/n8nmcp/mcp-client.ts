// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * A minimal MCP client over streamable HTTP, only for "test connection": initialize, then tools/list.
 * The real conversation traffic goes through pi's own MCP support; this exists so the administrator sees what the
 * other system offers before ticking anything. Errors never contain the token.
 */
export interface McpTool { name: string; description: string; readOnly: boolean | null }
export type McpTestResult = { ok: true; tools: McpTool[]; ms: number; server: string } | { ok: false; code: "bad_url" | "timeout" | "unreachable" | "unauthorized" | "bad_response"; error: string; ms: number };

const TIMEOUT_MS = 15_000;
const PROTOCOL = "2025-03-26";

async function rpc(url: string, headers: Record<string, string>, body: unknown, id: number | null): Promise<{ result?: Record<string, unknown>; status: number; session: string | null }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const session = res.headers.get("mcp-session-id");
  if (res.status === 401 || res.status === 403) return { status: res.status, session };
  if (id === null) { await res.text().catch(() => ""); return { status: res.status, session }; }
  if (!res.ok) return { status: res.status, session };
  const text = await res.text();
  const type = res.headers.get("content-type") ?? "";
  const messages: Record<string, unknown>[] = [];
  if (type.includes("text/event-stream")) {
    for (const line of text.split("\n")) if (line.startsWith("data:")) { try { messages.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ } }
  } else { try { messages.push(JSON.parse(text)); } catch { /* skip */ } }
  const mine = messages.find((m) => m.id === id);
  if (!mine || mine.error) return { status: 502, session };
  return { result: (mine.result ?? {}) as Record<string, unknown>, status: res.status, session };
}

export async function testMcp(url: string, token: string | null): Promise<McpTestResult> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  try { const u = new URL(url); if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme"); } catch { return { ok: false, code: "bad_url", error: "The MCP URL is not valid", ms: 0 }; }
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  try {
    const init = await rpc(url, auth, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "tigerai-portal", version: "1" } } }, 1);
    if (init.status === 401 || init.status === 403) return { ok: false, code: "unauthorized", error: "The system refused the key", ms: ms() };
    if (!init.result) return { ok: false, code: "bad_response", error: `The address answered, but not like an MCP server (HTTP ${init.status})`, ms: ms() };
    const server = String((init.result.serverInfo as { name?: unknown } | undefined)?.name ?? "");
    const headers = { ...auth, ...(init.session ? { "mcp-session-id": init.session } : {}), "mcp-protocol-version": String(init.result.protocolVersion ?? PROTOCOL) };
    await rpc(url, headers, { jsonrpc: "2.0", method: "notifications/initialized" }, null);
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await rpc(url, headers, { jsonrpc: "2.0", id: 2 + page, method: "tools/list", params: cursor ? { cursor } : {} }, 2 + page);
      if (!r.result) return { ok: false, code: "bad_response", error: "The system did not list its tools", ms: ms() };
      for (const t of (r.result.tools as { name?: unknown; description?: unknown; annotations?: { readOnlyHint?: unknown } }[] | undefined) ?? []) {
        if (typeof t.name !== "string") continue;
        tools.push({ name: t.name, description: String(t.description ?? "").slice(0, 200), readOnly: typeof t.annotations?.readOnlyHint === "boolean" ? t.annotations.readOnlyHint : null });
      }
      cursor = typeof r.result.nextCursor === "string" ? r.result.nextCursor : undefined;
      if (!cursor) break;
    }
    if (init.session) void fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
    return { ok: true, tools: tools.slice(0, 500), ms: ms(), server };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, code: timeout ? "timeout" : "unreachable", error: timeout ? "The system did not answer in time" : "Could not reach the system", ms: ms() };
  }
}
