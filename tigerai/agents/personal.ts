// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb, inTransaction } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, type Role } from "../accounts/service";
import { agentsFor, getAgent } from "./service";

/**
 * 精靈: each person's own menu of AI roles. A menu holds three kinds of entry:
 *   company  a role an administrator defined (agents table) that this person may call,
 *   mine     an agent this person built (personal_agents, owner = me),
 *   shared   an agent someone else built and marked shared, which I picked into my menu.
 * "Use theirs" = add to my menu (it keeps following the owner's edits). "Make it mine" = copy (an independent copy I can edit).
 * A member's own agent carries a prompt only; it is never @-able in a room and has no tools, model or knowledge folder of its own.
 * The order of the menu is stored here (per person), not in the browser.
 */

type User = { id: string; role: Role };
export type MenuKind = "company" | "mine" | "shared";
export interface MenuEntry { id: string; name: string; description: string; kind: MenuKind; ownerName: string | null; shared?: boolean; inMenu: boolean }
interface P { id: string; owner_id: string; name: string; description: string; system_prompt: string; shared: number; enabled: number; ownerName: string | null }

const PCOLS = "p.id,p.owner_id,p.name,p.description,p.system_prompt,p.shared,p.enabled,(SELECT name FROM users WHERE id=p.owner_id) AS ownerName";
const personal = (id: string): P | undefined => getDb().prepare(`SELECT ${PCOLS} FROM personal_agents p WHERE p.id=?`).get(id) as unknown as P | undefined;
const canSee = (u: User, p: P): boolean => p.enabled === 1 && (p.owner_id === u.id || p.shared === 1);

function visibleEntry(u: User, id: string): MenuEntry | null {
  const p = personal(id);
  if (p) return canSee(u, p) ? { id, name: p.name, description: p.description, kind: p.owner_id === u.id ? "mine" : "shared", ownerName: p.ownerName, shared: p.shared === 1, inMenu: false } : null;
  const c = agentsFor(u).find((a) => a.id === id);
  return c ? { id, name: c.name, description: c.description, kind: "company", ownerName: null, inMenu: false } : null;
}

/** The first time a person's menu is read it starts as the company roles they may already call, so nothing they had disappears. */
function seed(u: User): void {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM agent_menu_seeded WHERE user_id=?").get(u.id)) return;
  inTransaction(() => {
    let pos = 0;
    for (const a of agentsFor(u)) db.prepare("INSERT OR IGNORE INTO agent_menu (user_id,agent_id,position) VALUES (?,?,?)").run(u.id, a.id, pos++);
    db.prepare("INSERT OR IGNORE INTO agent_menu_seeded (user_id,seeded_at) VALUES (?,?)").run(u.id, Date.now());
  });
}

export function menuFor(u: User): MenuEntry[] {
  seed(u);
  const rows = getDb().prepare("SELECT agent_id FROM agent_menu WHERE user_id=? ORDER BY position, agent_id").all(u.id) as unknown as { agent_id: string }[];
  const out: MenuEntry[] = [];
  for (const r of rows) { const e = visibleEntry(u, r.agent_id); if (e) out.push({ ...e, inMenu: true }); }
  return out;
}

/** Everything this person could put in the menu, with whether it already is. */
export function browse(u: User): MenuEntry[] {
  seed(u);
  const db = getDb();
  const inMenu = new Set((db.prepare("SELECT agent_id FROM agent_menu WHERE user_id=?").all(u.id) as unknown as { agent_id: string }[]).map((r) => r.agent_id));
  const all: MenuEntry[] = agentsFor(u).map((a) => ({ id: a.id, name: a.name, description: a.description, kind: "company" as const, ownerName: null, inMenu: inMenu.has(a.id) }));
  for (const p of db.prepare(`SELECT ${PCOLS} FROM personal_agents p WHERE p.enabled=1 AND (p.owner_id=? OR p.shared=1) ORDER BY p.name`).all(u.id) as unknown as P[]) {
    all.push({ id: p.id, name: p.name, description: p.description, kind: p.owner_id === u.id ? "mine" : "shared", ownerName: p.ownerName, shared: p.shared === 1, inMenu: inMenu.has(p.id) });
  }
  return all;
}

/** Can this person start a conversation from this agent? (company roles they may call, or a personal one they own or was shared.) */
export function startable(u: User, id: string): boolean { return visibleEntry(u, id) !== null; }

export function addToMenu(u: User, agentId: string): void {
  seed(u);
  if (!visibleEntry(u, agentId)) throw new ServiceError("not_found", "No such agent", 404);
  const db = getDb();
  const max = (db.prepare("SELECT COALESCE(MAX(position),-1) AS m FROM agent_menu WHERE user_id=?").get(u.id) as unknown as { m: number }).m;
  db.prepare("INSERT OR IGNORE INTO agent_menu (user_id,agent_id,position) VALUES (?,?,?)").run(u.id, agentId, max + 1);
  writeAudit("agent.menu_add", u.id, { agentId });
}

export function removeFromMenu(u: User, agentId: string): void {
  seed(u);
  const res = getDb().prepare("DELETE FROM agent_menu WHERE user_id=? AND agent_id=?").run(u.id, agentId);
  if (res.changes > 0) writeAudit("agent.menu_remove", u.id, { agentId });
}

/** `ids` = the menu in the order wanted. Entries not listed keep their place after the listed ones; unknown ids are ignored. */
export function reorderMenu(u: User, ids: unknown): void {
  seed(u);
  if (!Array.isArray(ids)) throw new ServiceError("bad_order", "Expected a list of ids");
  const db = getDb();
  const cur = (db.prepare("SELECT agent_id FROM agent_menu WHERE user_id=? ORDER BY position, agent_id").all(u.id) as unknown as { agent_id: string }[]).map((r) => r.agent_id);
  const want = ids.filter((x): x is string => typeof x === "string" && cur.includes(x));
  const order = [...new Set(want), ...cur.filter((x) => !want.includes(x))];
  inTransaction(() => { order.forEach((id, i) => db.prepare("UPDATE agent_menu SET position=? WHERE user_id=? AND agent_id=?").run(i, u.id, id)); });
}

function cleanFields(input: Record<string, unknown>): { name: string; description: string; system_prompt: string; shared: boolean } {
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 40) throw new ServiceError("bad_name", "Name is required, at most 40 characters");
  const body = String(input.system_prompt ?? "");
  if (body.length > 8000) throw new ServiceError("too_long", "The prompt is too long (max 8000 characters)");
  return { name, description: String(input.description ?? "").trim().slice(0, 300), system_prompt: body, shared: input.shared === true };
}

function requireUniqueName(ownerId: string, name: string, exceptId = ""): void {
  const dup = getDb().prepare("SELECT 1 FROM personal_agents WHERE owner_id=? AND name=? AND enabled=1 AND id<>?").get(ownerId, name, exceptId);
  if (dup) throw new ServiceError("exists", "You already have an agent with this name", 409);
}

export function createMine(u: User, input: Record<string, unknown>): MenuEntry {
  const f = cleanFields(input);
  requireUniqueName(u.id, f.name);
  const n = (getDb().prepare("SELECT COUNT(*) AS n FROM personal_agents WHERE owner_id=? AND enabled=1").get(u.id) as unknown as { n: number }).n;
  if (n >= 50) throw new ServiceError("limit", "You can keep at most 50 agents of your own", 409);
  const id = `p${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  getDb().prepare("INSERT INTO personal_agents (id,owner_id,name,description,system_prompt,shared,enabled,created_at) VALUES (?,?,?,?,?,?,1,?)").run(id, u.id, f.name, f.description, f.system_prompt, f.shared ? 1 : 0, Date.now());
  writeAudit("agent.personal_create", u.id, { agentId: id, name: f.name });
  addToMenu(u, id);
  return { ...visibleEntry(u, id)!, inMenu: true };
}

function requireMine(u: User, id: string): P {
  const p = personal(id);
  if (!p || !canSee(u, p)) throw new ServiceError("not_found", "No such agent", 404);
  if (p.owner_id !== u.id) throw new ServiceError("forbidden", "Only the person who built this agent can change it", 403);
  return p;
}

export function updateMine(u: User, id: string, input: Record<string, unknown>): MenuEntry {
  const p = requireMine(u, id);
  const f = cleanFields({ name: p.name, description: p.description, system_prompt: p.system_prompt, shared: p.shared === 1, ...input });
  requireUniqueName(u.id, f.name, id);
  getDb().prepare("UPDATE personal_agents SET name=?,description=?,system_prompt=?,shared=? WHERE id=?").run(f.name, f.description, f.system_prompt, f.shared ? 1 : 0, id);
  writeAudit("agent.personal_update", u.id, { agentId: id });
  return visibleEntry(u, id)!;
}

/** Disabled, not erased: conversations started from it keep reading its prompt. It leaves every menu. */
export function deleteMine(u: User, id: string): void {
  requireMine(u, id);
  inTransaction(() => {
    getDb().prepare("UPDATE personal_agents SET enabled=0 WHERE id=?").run(id);
    getDb().prepare("DELETE FROM agent_menu WHERE agent_id=?").run(id);
  });
  writeAudit("agent.personal_delete", u.id, { agentId: id });
}

/** 複製成我的: an independent copy of a visible agent (name, description, prompt only), already in my menu. */
export function copyToMine(u: User, id: string, name?: string): MenuEntry {
  const e = visibleEntry(u, id);
  const src = e ? getAgent(id) : null;
  if (!e || !src) throw new ServiceError("not_found", "No such agent", 404);
  const base = (typeof name === "string" && name.trim() ? name.trim() : `${src.name} (copy)`).slice(0, 40);
  let final = base, i = 2;
  while (getDb().prepare("SELECT 1 FROM personal_agents WHERE owner_id=? AND name=? AND enabled=1").get(u.id, final)) final = `${base.slice(0, 36)} ${i++}`;
  const made = createMine(u, { name: final, description: src.description, system_prompt: src.system_prompt, shared: false });
  writeAudit("agent.copy", u.id, { agentId: id, name: final });
  return made;
}

/** The text of one of MY agents, for the edit form. */
export function mineDetail(u: User, id: string): { id: string; name: string; description: string; system_prompt: string; shared: boolean } {
  const p = requireMine(u, id);
  return { id: p.id, name: p.name, description: p.description, system_prompt: p.system_prompt, shared: p.shared === 1 };
}
