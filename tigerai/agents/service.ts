// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, type Role } from "../accounts/service";

/**
 * AI roles ("AgentPreset"). Two kinds of AI exist in a room:
 *   1. the plain model, called with @AI: no role, no skills;
 *   2. an AI role, called with @<role name>: model + system prompt + skills +
 *      tool ceiling + knowledge folder, defined by an administrator.
 * Field names follow the original Portal's AgentPreset so a role exported from
 * one can be imported into the other.
 */

export interface AgentRow {
  id: string; name: string; description: string; system_prompt: string; skills: string[];
  tool_names: string[] | null; model: { provider: string; modelId: string } | null;
  knowledge_dir: string | null; group_ids: string[]; enabled: boolean;
}

interface Raw { id: string; name: string; description: string; system_prompt: string; skills: string; tool_names: string | null;
  model_provider: string | null; model_id: string | null; knowledge_dir: string | null; group_ids: string; enabled: number }

const list = (v: unknown): string[] => { try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; } };

function parse(r: Raw): AgentRow {
  return {
    id: r.id, name: r.name, description: r.description, system_prompt: r.system_prompt, skills: list(r.skills),
    tool_names: r.tool_names === null ? null : list(r.tool_names),
    model: r.model_provider && r.model_id ? { provider: r.model_provider, modelId: r.model_id } : null,
    knowledge_dir: r.knowledge_dir, group_ids: list(r.group_ids), enabled: r.enabled === 1,
  };
}

export function getAgent(id: string): AgentRow | null {
  const r = getDb().prepare("SELECT * FROM agents WHERE id=?").get(id) as unknown as Raw | undefined;
  if (r) return parse(r);
  return personalAsAgent(id);
}

/**
 * A member's own 精靈 (table personal_agents, see ./personal.ts) seen as an AgentRow, so a conversation started from it
 * reads its prompt through the same runtime path as a company role. It carries a prompt only: no skills, no tool ceiling
 * of its own (the member's own capabilities still apply), no model, no knowledge folder.
 */
function personalAsAgent(id: string): AgentRow | null {
  const r = getDb().prepare("SELECT id,name,description,system_prompt,enabled FROM personal_agents WHERE id=?").get(id) as unknown as
    { id: string; name: string; description: string; system_prompt: string; enabled: number } | undefined;
  return r ? { id: r.id, name: r.name, description: r.description, system_prompt: r.system_prompt, skills: [], tool_names: null, model: null, knowledge_dir: null, group_ids: [], enabled: r.enabled === 1 } : null;
}

export function listAllAgents(): AgentRow[] {
  return (getDb().prepare("SELECT * FROM agents ORDER BY name").all() as unknown as Raw[]).map(parse);
}

/** Roles a person may call: enabled, and either open to everyone (no groups listed) or sharing a group. Others cannot even be @-ed, so their existence stays private. */
export function agentsFor(user: { id: string; role: Role }): AgentRow[] {
  const mine = new Set((getDb().prepare("SELECT group_id FROM memberships WHERE user_id=?").all(user.id) as unknown as { group_id: string }[]).map((r) => r.group_id));
  return listAllAgents().filter((a) => a.enabled && (user.role === "admin" || a.group_ids.length === 0 || a.group_ids.some((g) => mine.has(g))));
}

function clean(input: Record<string, unknown>): Omit<AgentRow, "id"> {
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60 || /[\s@]/.test(name)) throw new ServiceError("bad_name", "Role name is required, at most 60 characters, no spaces or @ (it is used as @name)");
  if (name.toLowerCase() === "ai") throw new ServiceError("bad_name", "\"AI\" is the plain model and cannot be a role name");
  const model = input.model as { provider?: unknown; modelId?: unknown } | null | undefined;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    name, description: String(input.description ?? "").slice(0, 500), system_prompt: String(input.system_prompt ?? "").slice(0, 20000),
    skills: strs(input.skills), tool_names: input.tool_names === null || input.tool_names === undefined ? null : strs(input.tool_names),
    model: model && typeof model.provider === "string" && typeof model.modelId === "string" ? { provider: model.provider, modelId: model.modelId } : null,
    knowledge_dir: typeof input.knowledge_dir === "string" && input.knowledge_dir.trim() ? input.knowledge_dir.trim() : null,
    group_ids: strs(input.group_ids), enabled: input.enabled !== false,
  };
}

function write(id: string, a: Omit<AgentRow, "id">, create: boolean): void {
  const db = getDb();
  const dup = db.prepare("SELECT id FROM agents WHERE name = ? AND id <> ?").get(a.name, id);
  if (dup) throw new ServiceError("exists", "A role with this name already exists", 409);
  const vals = [a.name, a.description, a.system_prompt, JSON.stringify(a.skills), a.tool_names === null ? null : JSON.stringify(a.tool_names),
    a.model?.provider ?? null, a.model?.modelId ?? null, a.knowledge_dir, JSON.stringify(a.group_ids), a.enabled ? 1 : 0];
  if (create) {
    db.prepare("INSERT INTO agents (name,description,system_prompt,skills,tool_names,model_provider,model_id,knowledge_dir,group_ids,enabled,id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(...vals, id, Date.now());
  } else {
    db.prepare("UPDATE agents SET name=?,description=?,system_prompt=?,skills=?,tool_names=?,model_provider=?,model_id=?,knowledge_dir=?,group_ids=?,enabled=? WHERE id=?").run(...vals, id);
  }
}

export function createAgent(actorId: string, input: Record<string, unknown>): AgentRow {
  const id = `a${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  write(id, clean(input), true);
  writeAudit("agent.create", actorId, { agentId: id, name: String(input.name) });
  return getAgent(id)!;
}

export function updateAgent(actorId: string, id: string, input: Record<string, unknown>): AgentRow {
  const cur = getAgent(id);
  if (!cur) throw new ServiceError("not_found", "No such role", 404);
  const merged = { ...cur, ...input } as Record<string, unknown>;
  write(id, clean(merged), false);
  writeAudit("agent.update", actorId, { agentId: id });
  return getAgent(id)!;
}

/** Roles are disabled, not deleted: a room's clone conversation keeps pointing at it. */
export function disableAgent(actorId: string, id: string): void {
  if (!getAgent(id)) throw new ServiceError("not_found", "No such role", 404);
  getDb().prepare("UPDATE agents SET enabled=0 WHERE id=?").run(id);
  writeAudit("agent.disable", actorId, { agentId: id });
}

/**
 * Which roles a message calls. Same matching rule as human @mentions in the
 * original Portal: longest name first, whole word, the match is cut out so a
 * short name cannot match inside a longer one. Only roles the sender may call
 * are considered.
 */
export function parseAssistantMentions(text: string, agents: Pick<AgentRow, "id" | "name">[]): { agentIds: string[]; rest: string } {
  const esc = (v: string) => v.replace(/[-.*+?^${}()|[\]\\]/g, "\\$&");
  const keys = [...agents].filter((a) => a.name.trim()).sort((a, b) => b.name.length - a.name.length);
  const ids: string[] = [];
  let work = text;
  for (const a of keys) {
    const re = new RegExp(`(^|\\s)[@＠]${esc(a.name.trim())}(?=\\s|$|[，,。：:？?!！、])`, "gi");
    if (re.test(work)) { if (!ids.includes(a.id)) ids.push(a.id); work = work.replace(re, "$1"); }
  }
  return { agentIds: ids, rest: work.replace(/\s{2,}/g, " ").trim() };
}
