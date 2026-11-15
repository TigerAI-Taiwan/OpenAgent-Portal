// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, type Role } from "../accounts/service";
import { createOrder, registerOrderKind } from "../workorders/service";

/**
 * Prompt library, founder rules (these differ from the original Portal, where an
 * administrator ticked groups):
 *  1. anyone can create a prompt; it is private (owner = that person);
 *  2. sharing goes through a work order; an administrator other than the
 *     applicant approves, and a COPY lands in the company library (owner NULL,
 *     source_id = the original, which the owner keeps);
 *  3. a department head (group manager) ticks, for their own groups only, which
 *     library prompts that department uses; a head can also keep prompts that
 *     belong to their own group (scope_group) directly;
 *  4. administrators publish into the library (directly or by approving orders)
 *     and do not assign groups, except for a group that has no head: until
 *     heads exist for it only an administrator can tick (temporary rule);
 *  5. a person's "/" menu = their own + library prompts ticked for one of their
 *     groups + prompts scoped to a group they belong to. Being in the library
 *     is not enough to be seen.
 */

export interface PromptRow {
  id: string; name: string; description: string; body: string;
  owner_id: string | null; scope_group: string | null; source_id: string | null; enabled: boolean;
}
interface Raw { id: string; name: string; description: string; body: string; owner_id: string | null; scope_group: string | null; source_id: string | null; enabled: number }
const parse = (r: Raw): PromptRow => ({ ...r, enabled: r.enabled === 1 });

type Actor = { id: string; role: Role };
const MAX_BODY = 32 * 1024;
const MAX_PER_USER = 200;

/** The slash command name: letters, digits, dash, underscore (any script). */
export function commandName(raw: string): string {
  return raw.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 60);
}

function groupsOf(userId: string): string[] {
  return (getDb().prepare("SELECT group_id FROM memberships WHERE user_id=?").all(userId) as unknown as { group_id: string }[]).map((r) => r.group_id);
}
export function managedGroups(userId: string): string[] {
  return (getDb().prepare("SELECT group_id FROM memberships WHERE user_id=? AND is_manager=1").all(userId) as unknown as { group_id: string }[]).map((r) => r.group_id);
}

export function getPrompt(id: string): PromptRow | null {
  const r = getDb().prepare("SELECT * FROM prompts WHERE id=?").get(id) as unknown as Raw | undefined;
  return r ? parse(r) : null;
}

/** What a person's "/" menu may list (rule 5). `null` = nobody known: nothing personal, nothing ticked. */
export function promptsVisibleTo(user: { id: string } | null): PromptRow[] {
  if (!user) return [];
  const db = getDb();
  const mine = db.prepare("SELECT * FROM prompts WHERE enabled=1 AND owner_id=?").all(user.id) as unknown as Raw[];
  const groups = groupsOf(user.id);
  const shared: Raw[] = [];
  for (const g of groups) {
    shared.push(...(db.prepare("SELECT p.* FROM prompts p JOIN prompt_ticks t ON t.prompt_id=p.id WHERE p.enabled=1 AND p.owner_id IS NULL AND p.scope_group IS NULL AND t.group_id=?").all(g) as unknown as Raw[]));
    shared.push(...(db.prepare("SELECT * FROM prompts WHERE enabled=1 AND owner_id IS NULL AND scope_group=?").all(g) as unknown as Raw[]));
  }
  const seen = new Set<string>();
  // On a name clash the person's own wins, then the first shared one.
  const names = new Set<string>();
  const out: PromptRow[] = [];
  for (const r of [...mine, ...shared]) {
    if (seen.has(r.id) || names.has(r.name.toLowerCase())) continue;
    seen.add(r.id); names.add(r.name.toLowerCase()); out.push(parse(r));
  }
  return out;
}

function write(owner: string | null, scope: string | null, input: Record<string, unknown>, id?: string, sourceId: string | null = null): PromptRow {
  const db = getDb();
  const existing = id ? getPrompt(id) : null;
  const name = commandName(String(input.name ?? existing?.name ?? ""));
  if (!name) throw new ServiceError("bad_name", "A template needs a name (letters, digits, - and _)");
  const body = String(input.body ?? existing?.body ?? "");
  if (!body.trim() || body.length > MAX_BODY) throw new ServiceError("bad_body", `Template text is required (at most ${MAX_BODY} characters)`);
  const description = String(input.description ?? existing?.description ?? "").slice(0, 300);
  const enabled = input.enabled === undefined ? (existing?.enabled ?? true) : input.enabled !== false;
  const dup = db.prepare("SELECT id FROM prompts WHERE name=? AND COALESCE(owner_id,'')=? AND COALESCE(scope_group,'')=? AND id<>?").get(name, owner ?? "", scope ?? "", id ?? "");
  if (dup) throw new ServiceError("exists", "A template with this name already exists here", 409);
  if (!existing && owner) {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM prompts WHERE owner_id=?").get(owner) as { n: number }).n;
    if (n >= MAX_PER_USER) throw new ServiceError("limit", "Too many personal templates");
  }
  const rowId = id ?? `p${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  if (existing) db.prepare("UPDATE prompts SET name=?,description=?,body=?,enabled=? WHERE id=?").run(name, description, body, enabled ? 1 : 0, rowId);
  else db.prepare("INSERT INTO prompts (id,name,description,body,owner_id,scope_group,source_id,enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(rowId, name, description, body, owner, scope, sourceId, enabled ? 1 : 0, Date.now());
  return getPrompt(rowId)!;
}

// 1. personal -----------------------------------------------------------------
export function listMine(userId: string): (PromptRow & { shareStatus: string | null })[] {
  const rows = getDb().prepare("SELECT * FROM prompts WHERE owner_id=? ORDER BY name").all(userId) as unknown as Raw[];
  const orders = getDb().prepare("SELECT payload, status FROM work_orders WHERE kind='prompt_share' AND applicant_id=? ORDER BY created_at").all(userId) as unknown as { payload: string; status: string }[];
  return rows.map((r) => {
    const last = [...orders].reverse().find((o) => (JSON.parse(o.payload) as { promptId?: string }).promptId === r.id);
    return { ...parse(r), shareStatus: last?.status ?? null };
  });
}
export function createMine(actor: Actor, input: Record<string, unknown>): PromptRow {
  const p = write(actor.id, null, input);
  writeAudit("prompt.create", actor.id, { promptId: p.id, scope: "personal" });
  return p;
}
export function updateMine(actor: Actor, id: string, input: Record<string, unknown>): PromptRow {
  const p = getPrompt(id);
  if (!p || p.owner_id !== actor.id) throw new ServiceError("not_found", "No such template", 404);
  return write(actor.id, null, input, id);
}
export function deleteMine(actor: Actor, id: string): void {
  const p = getPrompt(id);
  if (!p || p.owner_id !== actor.id) throw new ServiceError("not_found", "No such template", 404);
  getDb().prepare("DELETE FROM prompts WHERE id=?").run(id);
  writeAudit("prompt.delete", actor.id, { promptId: id });
}

// 2. share by work order -----------------------------------------------------
export function submitForSharing(actor: Actor, id: string): { orderId: string } {
  const p = getPrompt(id);
  if (!p || p.owner_id !== actor.id) throw new ServiceError("not_found", "No such template", 404);
  const open = getDb().prepare("SELECT payload FROM work_orders WHERE kind='prompt_share' AND applicant_id=? AND status='pending'").all(actor.id) as unknown as { payload: string }[];
  if (open.some((o) => (JSON.parse(o.payload) as { promptId?: string }).promptId === id)) throw new ServiceError("pending", "This template already has a pending sharing request", 409);
  // The order carries a snapshot: what the administrator reads is what gets published.
  const order = createOrder("prompt_share", actor.id, { promptId: id, name: p.name, description: p.description, body: p.body });
  return { orderId: order.id };
}

registerOrderKind("prompt_share", (order) => {
  const pl = order.payload as { promptId: string; name: string; description: string; body: string };
  let name = pl.name;
  // A library name that is taken gets the applicant's marker rather than failing the approval.
  const taken = getDb().prepare("SELECT 1 FROM prompts WHERE name=? AND owner_id IS NULL AND scope_group IS NULL").get(name);
  if (taken) name = `${name}-${order.id.slice(-4)}`;
  const copy = write(null, null, { name, description: pl.description, body: pl.body }, undefined, pl.promptId);
  return copy.id;
});

// 3./4. the library ----------------------------------------------------------
export function listLibrary(): (PromptRow & { ticks: string[] })[] {
  const rows = getDb().prepare("SELECT * FROM prompts WHERE owner_id IS NULL AND scope_group IS NULL ORDER BY name").all() as unknown as Raw[];
  const ticks = getDb().prepare("SELECT prompt_id, group_id FROM prompt_ticks").all() as unknown as { prompt_id: string; group_id: string }[];
  return rows.map((r) => ({ ...parse(r), ticks: ticks.filter((t) => t.prompt_id === r.id).map((t) => t.group_id) }));
}
export function publish(actor: Actor, input: Record<string, unknown>, id?: string): PromptRow {
  if (actor.role !== "admin") throw new ServiceError("forbidden", "Only an administrator publishes to the library", 403);
  const p = write(null, null, input, id);
  writeAudit(id ? "prompt.update" : "prompt.publish", actor.id, { promptId: p.id });
  return p;
}
export function canTick(actor: Actor, groupId: string): boolean {
  return actor.role === "admin" || managedGroups(actor.id).includes(groupId);
}
export function setTick(actor: Actor, promptId: string, groupId: string, on: boolean): void {
  const p = getPrompt(promptId);
  if (!p || p.owner_id !== null || p.scope_group !== null) throw new ServiceError("not_found", "No such library template", 404);
  if (!getDb().prepare("SELECT 1 FROM groups WHERE id=?").get(groupId)) throw new ServiceError("not_found", "No such group", 404);
  if (!canTick(actor, groupId)) throw new ServiceError("forbidden", "Only the head of a department can choose its templates", 403);
  const db = getDb();
  if (on) db.prepare("INSERT OR IGNORE INTO prompt_ticks (prompt_id,group_id,ticked_by,ticked_at) VALUES (?,?,?,?)").run(promptId, groupId, actor.id, Date.now());
  else db.prepare("DELETE FROM prompt_ticks WHERE prompt_id=? AND group_id=?").run(promptId, groupId);
  writeAudit(on ? "prompt.tick" : "prompt.untick", actor.id, { promptId, groupId });
}
/** Heads keep prompts that belong to their own department directly (visible to its members only). */
export function saveGroupPrompt(actor: Actor, groupId: string, input: Record<string, unknown>, id?: string): PromptRow {
  if (!canTick(actor, groupId)) throw new ServiceError("forbidden", "Only the head of this department can do this", 403);
  const p = write(null, groupId, input, id);
  writeAudit(id ? "prompt.update" : "prompt.create", actor.id, { promptId: p.id, scope: "group", groupId });
  return p;
}
export function deleteLibraryOrGroup(actor: Actor, id: string): void {
  const p = getPrompt(id);
  if (!p || p.owner_id !== null) throw new ServiceError("not_found", "No such template", 404);
  if (p.scope_group ? !canTick(actor, p.scope_group) : actor.role !== "admin") throw new ServiceError("forbidden", "Not allowed", 403);
  const db = getDb();
  db.prepare("DELETE FROM prompt_ticks WHERE prompt_id=?").run(id);
  db.prepare("DELETE FROM prompts WHERE id=?").run(id);
  writeAudit("prompt.delete", actor.id, { promptId: id });
}
export function groupPrompts(groupId: string): PromptRow[] {
  return (getDb().prepare("SELECT * FROM prompts WHERE owner_id IS NULL AND scope_group=? ORDER BY name").all(groupId) as unknown as Raw[]).map(parse);
}

/**
 * What the `#` popup lists: exactly what the person's "/" menu lists (rule 5), with the text, split into 我的 and 公司 for display.
 * Visibility is decided here, never by the page: an unpublished prompt of someone else is not in `promptsVisibleTo`.
 */
export function pickablePrompts(user: { id: string }): { id: string; name: string; description: string; body: string; mine: boolean }[] {
  return promptsVisibleTo(user).map((p) => ({ id: p.id, name: p.name, description: p.description, body: p.body, mine: p.owner_id === user.id }));
}
