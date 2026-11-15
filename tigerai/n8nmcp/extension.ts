// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { type InlineExtension } from "@earendil-works/pi-coding-agent";
import { writeAudit } from "../accounts/audit";
import { identityForSession } from "../adapter/identity";
import { roomSpeaker } from "../rooms/speaker";
import { mcpSignature, planMcpSync } from "./sync";
import { isConnectorServer } from "./runtime-templates";
import { mcpServersFor } from "./service";
import "./grants"; // closes legacy approval requests only
import { isN8nWriteTool } from "./templates";
import { createdWorkflowId, decideN8nWrite, recordOwner } from "./ownership";
import { clearTurn, isUntrustedTurn } from "./turn-guard";

/**
 * What a conversation gets from the system connectors (community edition: n8n):
 *  - the n8n MCP servers ticked for this person's groups are registered with pi's own MCP support (pi.registerMcpServer);
 *    only the tools the administrator ticked are visible, and every call is checked again against the person's groups;
 *  - 1.1.0-ce: n8n tools that WRITE no longer need an approval (only publishing for others is reviewed, n8n/publish.ts); a write call is
 *    audited like any other, with write:true;
 *  - 1.1.x security: n8n write tools on an EXISTING workflow only work on workflows the person created through the Portal (ownership.ts;
 *    administrators on all), and none of them runs after web content was read in the same turn (turn-guard.ts). Best effort: n8n has one shared token;
 *  - every call is audited as mcp.tool_call: who, which connector, which tool, outcome. Never the arguments or the key.
 */

function who(ctx: { sessionManager: { getSessionId(): string }; cwd: string }) {
  let sid: string | undefined;
  try { sid = ctx.sessionManager.getSessionId(); } catch { sid = undefined; }
  // A shared room conversation has no owner of its own: it acts as the person who is speaking to it right now.
  return roomSpeaker(sid) ?? identityForSession(sid, ctx.cwd);
}

const MCP_WAIT_MS = 8000;

export function createMcpExtension(): InlineExtension {
  return {
    name: "tigerai-connectors",
    hidden: true,
    factory: (pi) => {
      const registered = new Map<string, string>(); // server name -> signature of what was registered

      const syncMcp = (person: { id: string; role: "admin" | "member" } | null) => {
        try {
          const wanted = new Map((person ? mcpServersFor(person) : []).map((s) => [s.key, s]));
          const plan = planMcpSync(registered, wanted);
          for (const name of plan.unregister) { pi.unregisterMcpServer(name); registered.delete(name); }
          for (const name of plan.register) {
            const s = wanted.get(name)!;
            // Only the allowed tools are exposed to the model; everything else the server offers is hidden.
            const allowAll = s.allow.includes("*");
            const exposure = allowAll
              ? { exposure: "direct" }
              : { exposure: "hidden", toolExposure: Object.fromEntries(s.allow.map((t) => [t, "direct"])) };
            pi.registerMcpServer(name, { url: s.url, ...exposure, ...(s.token ? { headers: { Authorization: `Bearer ${s.token}` } } : {}) } as never);
            registered.set(name, mcpSignature(s));
          }
        } catch (error) {
          console.error("[tigerai] MCP connector sync failed:", error instanceof Error ? error.message : error);
        }
      };

      // pi's MCP extension connects a registered server in the background, so on the very first message of a new conversation the tools
      // were not there yet (found live: "Tool mcp__n8n_live__search_workflows not found"). Before the model is asked, wait (once per
      // registration, at most MCP_WAIT_MS) until each registered server has offered a tool; a server that is down costs one wait, not one per message.
      const waited = new Set<string>();
      const awaitTools = async () => {
        const todo = [...registered].filter(([name, sig]) => !waited.has(`${name}|${sig}`));
        if (todo.length === 0) return;
        const deadline = Date.now() + MCP_WAIT_MS;
        const ready = () => { const names = pi.getAllTools().map((t) => t.name); return todo.every(([name]) => names.some((n) => n.startsWith(`mcp__${name.replace(/-/g, "_")}__`))); };
        try { while (!ready() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 150)); } catch { /* never break the conversation */ }
        for (const [name, sig] of todo) waited.add(`${name}|${sig}`);
      };
      pi.on("session_start", (_event, ctx) => syncMcp(who(ctx)));
      const sidOf = (ctx: { sessionManager: { getSessionId(): string } }) => { try { return ctx.sessionManager.getSessionId(); } catch { return undefined; } };
      // A new prompt = the user spoke again: the "web content was read" flag of the previous turn no longer applies.
      pi.on("before_agent_start", async (_event, ctx) => { clearTurn(sidOf(ctx)); syncMcp(who(ctx)); await awaitTools(); return undefined; });

      const pending = new Map<string, { person: string; connector: string; template: string; tool: string; write: boolean; serverId: string; create: boolean }>();
      pi.on("tool_call", (event, ctx) => {
        const m = /^mcp__(.+?)__(.+)$/.exec(event.toolName);
        if (!m || !isConnectorServer(m[1])) return undefined;
        const person = who(ctx);
        // Checked again here, not only hidden at registration: the list can change while a conversation is open.
        // pi turns "-" in a server name into "_" inside tool names, so compare in that form.
        const server = person ? mcpServersFor(person).find((s) => s.key.replace(/-/g, "_") === m[1].replace(/-/g, "_")) : undefined;
        const ok = !!server && (server.allow.includes("*") || server.allow.includes(m[2]));
        const info = { connector: server?.name ?? m[1], template: server?.template ?? null, tool: m[2] };
        const deny = (reason: string, outcome: string) => {
          try { writeAudit("mcp.tool_call", person?.id ?? null, { ...info, outcome }); } catch { /* audit must not break the call */ }
          return { block: true, reason };
        };
        if (!ok || !person || !server) return deny("This connector or tool is not enabled for your group.", "denied");
        const write = server.template === "n8n" && isN8nWriteTool(m[2]);
        let create = false;
        if (write) {
          const d = decideN8nWrite(person, server.id, m[2], (event as { input?: unknown }).input, isUntrustedTurn(sidOf(ctx)));
          if (!d.allow) return deny(d.reason, d.code === "untrusted_turn" ? "needs_confirmation" : "not_owner");
          create = d.create;
        }
        pending.set(event.toolCallId, { person: person.id, connector: server.name, template: server.template, tool: m[2], write, serverId: server.id, create });
        return undefined;
      });
      pi.on("tool_result", (event) => {
        const p = pending.get(event.toolCallId);
        if (!p) return undefined;
        pending.delete(event.toolCallId);
        // A workflow this person just created is theirs from now on. If the id cannot be read from the answer, say so in the audit trail:
        // the person then cannot change it until an administrator assigns it.
        if (p.create && !event.isError) {
          try {
            const wf = createdWorkflowId(event as { content?: unknown; details?: unknown });
            if (wf) recordOwner(p.serverId, wf, p.person); else writeAudit("mcp.owner_unknown", p.person, { connector: p.connector, tool: p.tool });
          } catch { /* ownership is best effort; the audit row below still says what happened */ }
        }
        try { writeAudit("mcp.tool_call", p.person, { connector: p.connector, template: p.template, tool: p.tool, outcome: event.isError ? "error" : "ok", ...(p.write ? { write: true } : {}) }); } catch { /* */ }
        return undefined;
      });
    },
  };
}
