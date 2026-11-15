// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { getDb } from "../db/store";
import { getAgent, type AgentRow } from "./service";

/**
 * How an AI role reaches the model: its text is appended to the system prompt
 * of that one conversation (before_agent_start), its model is the session's
 * initial model, and its knowledge folder becomes one extra readable root for
 * the file fence. No model call is made here either.
 */

const KEY = Symbol.for("tigerai:pending-roles");
function pending(): Map<string, string> {
  const g = globalThis as unknown as Record<symbol, Map<string, string> | undefined>;
  return (g[KEY] ??= new Map());
}

/** A session that is about to be created is only known by its temporary key. */
export function registerPendingRole(tempKey: string, agentId: string): void { pending().set(tempKey, agentId); }
export function forgetPendingRole(tempKey: string): void { pending().delete(tempKey); }

export function roleForSession(sessionKey: string): AgentRow | null {
  const fromPending = pending().get(sessionKey);
  if (fromPending) return getAgent(fromPending);
  const row = (getDb().prepare("SELECT agent_id FROM room_assistants WHERE session_id=?").get(sessionKey) as { agent_id: string } | undefined)
    ?? (getDb().prepare("SELECT agent_id FROM session_roles WHERE session_id=?").get(sessionKey) as { agent_id: string } | undefined);
  return row ? getAgent(row.agent_id) : null;
}

export function rolePrompt(a: AgentRow): string {
  const parts = [`You are "${a.name}", an AI role in a team chat room. Stay in this role.`, a.system_prompt.trim()];
  if (a.skills.length) parts.push(`Skills you must follow: ${a.skills.join(", ")}.`);
  if (a.knowledge_dir) parts.push(`Reference material is in ${a.knowledge_dir}. Look things up there with the read tool before answering from memory.`);
  return parts.filter(Boolean).join("\n\n");
}

export function createRoleExtension(a: AgentRow): InlineExtension {
  const text = rolePrompt(a);
  return {
    name: "tigerai-ai-role",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const base = (event as { systemPrompt?: string }).systemPrompt ?? "";
        return { systemPrompt: `${base}\n\n${text}`.trim() };
      });
    },
  };
}
