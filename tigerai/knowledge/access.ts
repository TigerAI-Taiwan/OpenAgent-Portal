// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { ServiceError, listGroups, type Role } from "../accounts/service";
import { writeAudit } from "../accounts/audit";
import { createAgent, getAgent, listAllAgents, updateAgent, type AgentRow } from "../agents/service";

/**
 * Who may create a company AI role and put knowledge files in it (everything here is checked on the server).
 *   admin            every role;
 *   department head  (is_manager of a group) only roles whose every visibility group is a department they head, and a role they create is
 *                    visible to that one department only. The groups are used exactly as stored: no inheritance up or down the tree;
 *   anyone else      nothing: no listing, no download.
 */
type Actor = { id: string; role: Role };

/** A head-made role carries this tool ceiling: reading its notes, nothing else. (Recorded on the role; see DECISIONS for how far it is enforced.) */
export const HEAD_TOOL_CEILING = ["read"];

export function headGroups(userId: string): string[] {
  return (getDb().prepare("SELECT group_id FROM memberships WHERE user_id=? AND is_manager=1").all(userId) as unknown as { group_id: string }[]).map((r) => r.group_id);
}

/** Departments this person may put roles in: all for an administrator, the ones they head otherwise. */
export function departmentsFor(actor: Actor): { id: string; name: string }[] {
  const mine = actor.role === "admin" ? null : new Set(headGroups(actor.id));
  return listGroups().filter((g) => !mine || mine.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
}

export function canManageRole(actor: Actor, a: Pick<AgentRow, "group_ids">): boolean {
  if (actor.role === "admin") return true;
  const mine = new Set(headGroups(actor.id));
  return a.group_ids.length > 0 && a.group_ids.every((g) => mine.has(g));
}

/** The role, or the right error: 403 for someone who may not manage any role at all or this one, 404 when it does not exist. */
export function requireManage(actor: Actor, id: string): AgentRow {
  if (actor.role !== "admin" && headGroups(actor.id).length === 0) throw new ServiceError("forbidden", "Only department heads and administrators can manage AI role knowledge", 403);
  const a = getDb().prepare("SELECT id FROM agents WHERE id=?").get(id) ? getAgent(id) : null;
  if (!a) throw new ServiceError("not_found", "No such role", 404);
  if (!canManageRole(actor, a)) throw new ServiceError("forbidden", "This role does not belong to your department", 403);
  return a;
}

export function requireHeadOrAdmin(actor: Actor): void {
  if (actor.role !== "admin" && headGroups(actor.id).length === 0) throw new ServiceError("forbidden", "Only department heads and administrators can manage AI role knowledge", 403);
}

export function managedRoles(actor: Actor): AgentRow[] {
  requireHeadOrAdmin(actor);
  return listAllAgents().filter((a) => canManageRole(actor, a));
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A head creates a role for one of their departments. The model, skills and server folder stay unset: those are for an administrator. */
export function createRoleAsHead(actor: Actor, input: Record<string, unknown>): AgentRow {
  requireHeadOrAdmin(actor);
  const gid = str(input.group_id);
  if (!departmentsFor(actor).some((d) => d.id === gid)) throw new ServiceError("forbidden", "Choose one of the departments you head", 403);
  const prompt = str(input.system_prompt);
  if (prompt.length > 4000) throw new ServiceError("too_long", "The instructions are too long (max 4000 characters)");
  const a = createAgent(actor.id, {
    name: str(input.name), description: str(input.description), system_prompt: prompt,
    group_ids: [gid], tool_names: HEAD_TOOL_CEILING, skills: [], model: null, knowledge_dir: null, enabled: true,
  });
  if (actor.role !== "admin") writeAudit("agent.head_create", actor.id, { agentId: a.id, groupId: gid, name: a.name });
  return a;
}

/** A head edits the text of a role of their own department (name, description, instructions, on/off) and nothing else. */
export function updateRoleAsHead(actor: Actor, id: string, input: Record<string, unknown>): AgentRow {
  const cur = requireManage(actor, id);
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const k of ["name", "description", "system_prompt"] as const) if (input[k] !== undefined) { patch[k] = str(input[k]); changed.push(k); }
  if (input.enabled !== undefined) { patch.enabled = input.enabled === true; changed.push("enabled"); }
  if (typeof patch.system_prompt === "string" && patch.system_prompt.length > 4000 && actor.role !== "admin") throw new ServiceError("too_long", "The instructions are too long (max 4000 characters)");
  const a = updateAgent(actor.id, cur.id, patch);
  if (actor.role !== "admin") writeAudit("agent.head_update", actor.id, { agentId: a.id, changed: changed.join(",") });
  return a;
}
