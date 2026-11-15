// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { Type } from "typebox";
import { defineTool, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { writeAudit } from "../accounts/audit";
import { identityForSession } from "../adapter/identity";
import { roomSpeaker } from "../rooms/speaker";
import { webhookHeader, webhooksFor } from "./service";

/**
 * What a conversation gets from n8n (community scope):
 *  - tool `n8n_webhook`: call a webhook an administrator registered for this person's groups.
 *    The model learns which ones exist (names and what input each takes) from a section added to
 *    its system prompt on every prompt, so it never has to guess a name.
 * Every call is written to the audit log (who, which webhook or tool, outcome; never the payload or the token).
 */

const MAX_REPLY_CHARS = 8000;
const TIMEOUT_MS = 30_000;

function who(ctx: { sessionManager: { getSessionId(): string }; cwd: string }) {
  let sid: string | undefined;
  try { sid = ctx.sessionManager.getSessionId(); } catch { sid = undefined; }
  // A shared room conversation has no owner of its own: it acts as the person who is speaking to it right now.
  return roomSpeaker(sid) ?? identityForSession(sid, ctx.cwd);
}

export function createN8nExtension(): InlineExtension {
  return {
    name: "tigerai-n8n",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event, ctx) => {
        const person = who(ctx);
        if (!person) return undefined;
        const hooks = webhooksFor(person);
        if (hooks.length === 0) return undefined;
        const lines = hooks.map((h) => `- ${h.name}${h.display_name ? ` (${h.display_name})` : ""}: ${h.description || "(no description)"}`);
        const base = (event as { systemPrompt?: string }).systemPrompt ?? "";
        return { systemPrompt: `${base}\n\nn8n webhooks you may call with the n8n_webhook tool (pass the name, the lowercase id before any brackets, and a JSON payload with the fields described; the bracketed text is the name people use):\n${lines.join("\n")}` };
      });

      pi.registerTool(defineTool({
        name: "n8n_webhook",
        label: "n8n webhook",
        description: "Call an n8n workflow through a webhook the administrator registered. Give the webhook name and a JSON payload. Returns the workflow's response text. Only webhooks listed in your instructions are available.",
        promptSnippet: "Call a registered n8n webhook with a JSON payload",
        parameters: Type.Object({
          name: Type.String({ description: "The webhook name, exactly as listed." }),
          payload: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "JSON object sent as the request body." })),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
          const person = who(ctx);
          const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
          const asked = String(params.name ?? "").trim();
          const name = asked.toLowerCase();
          // The model may pass the display name people use; the id stays the key, and only what this person may use is searched.
          const hook = person ? webhooksFor(person).find((h) => h.name === name || (h.display_name !== "" && h.display_name === asked)) : undefined;
          if (!person || !hook) {
            try { writeAudit("n8n.webhook_denied", person?.id ?? null, { name: name.slice(0, 64) }); } catch { /* */ }
            return text(`No webhook named "${name}" is available to you.`);
          }
          let outcome = "error";
          try {
            const ctl = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]);
            const secret = webhookHeader(hook.id);
            const res = await fetch(hook.url, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { [secret[0]]: secret[1] } : {}) }, body: JSON.stringify(params.payload ?? {}), signal: ctl });
            const body = (await res.text()).slice(0, MAX_REPLY_CHARS);
            outcome = String(res.status);
            return text(res.ok ? body : `The workflow answered HTTP ${res.status}: ${body.slice(0, 500)}`);
          } catch (error) {
            outcome = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable";
            return text(`The workflow could not be reached (${outcome}).`);
          } finally {
            try { writeAudit("n8n.webhook_call", person.id, { name: hook.name, outcome }); } catch { /* */ }
          }
        },
      }));
    },
  };
}
