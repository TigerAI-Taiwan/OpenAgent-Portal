// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import { createOrder, registerOrderKind } from "../workorders/service";
import { NAME, checkUrl, cleanMethod, groupsOf, maskUrl, saveWebhook, type Person } from "./service";

/**
 * 上架 (publishing) an n8n workflow for other people, 1.1.0-ce. Writing, testing and running your OWN workflows needs no approval any more
 * (n8nmcp/grants.ts); making one available to others as a Portal n8n app is the only n8n step that is reviewed:
 *
 *   member: publish(...)  --> work order kind `n8n_publish` (pending) --> an administrator (never the applicant) approves --> webhook app
 *   administrator: publish(...) goes straight through (they can do the same in 設定 → n8n 連線), audited.
 *
 * Review is always on in the community edition: the old product's 「要不要審核」 switch (default off) does not exist here.
 * Kept from the old product (2026-10-26): 誰可以上架 (全部同仁 / 只有管理員 / 指定部門, default 全部同仁) and
 * 上架後誰看得到 (全公司 / 上架者的部門 / 上架時自己勾, default 全公司). Both are decided on the server, never by the page.
 */
export type PublishWho = "all" | "admin" | "groups";
export type PublishVisibility = "all" | "own" | "choose";
export interface PublishPolicy { who: PublishWho; whoGroupIds: string[]; visibility: PublishVisibility }
export const ORDER_KIND = "n8n_publish";
/** Stored in a webhook's group list: every signed-in member sees it. */
export const EVERYONE = "*";

const KEY = "n8n.publish.policy";
const WHO: PublishWho[] = ["all", "admin", "groups"];
const VIS: PublishVisibility[] = ["all", "own", "choose"];
export const DEFAULT_POLICY: PublishPolicy = { who: "all", whoGroupIds: [], visibility: "all" };

export function normalizePolicy(raw: unknown): PublishPolicy {
  const r = (raw ?? {}) as Partial<PublishPolicy>;
  return {
    who: WHO.includes(r.who as PublishWho) ? (r.who as PublishWho) : DEFAULT_POLICY.who,
    whoGroupIds: Array.isArray(r.whoGroupIds) ? [...new Set(r.whoGroupIds.filter((x): x is string => typeof x === "string" && !!x))] : [],
    visibility: VIS.includes(r.visibility as PublishVisibility) ? (r.visibility as PublishVisibility) : DEFAULT_POLICY.visibility,
  };
}
export function getPolicy(): PublishPolicy {
  const row = getDb().prepare("SELECT value FROM tg_settings WHERE key=?").get(KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULT_POLICY };
  try { return normalizePolicy(JSON.parse(row.value)); } catch { return { ...DEFAULT_POLICY }; }
}
export function savePolicy(actorId: string, raw: unknown): PublishPolicy {
  const p = normalizePolicy(raw);
  getDb().prepare("INSERT INTO tg_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(KEY, JSON.stringify(p), Date.now());
  writeAudit("n8n.publish_policy", actorId, { scope: p.who, kind: p.visibility });
  return p;
}

export function mayPublish(person: Person, policy = getPolicy()): { ok: true } | { ok: false; reason: "adminOnly" | "notInGroup" } {
  if (person.role === "admin") return { ok: true };
  if (policy.who === "admin") return { ok: false, reason: "adminOnly" };
  if (policy.who === "groups" && !groupsOf(person.id).some((g) => policy.whoGroupIds.includes(g))) return { ok: false, reason: "notInGroup" };
  return { ok: true };
}

/** Who sees the app: decided here from the policy; for "own" the page's list is ignored (otherwise "only my department" would be only a look). */
export function resolveVisibility(person: Person, policy: PublishPolicy, requested: unknown): string[] {
  const existing = new Set((getDb().prepare("SELECT id FROM groups").all() as unknown as { id: string }[]).map((g) => g.id));
  const picked = [...new Set((Array.isArray(requested) ? requested : []).filter((g): g is string => typeof g === "string" && (g === EVERYONE || existing.has(g))))];
  if (person.role === "admin" || policy.visibility === "choose") {
    if (picked.length === 0) throw new ServiceError("no_groups", "Choose who may use it (everyone or at least one department)");
    return picked.includes(EVERYONE) ? [EVERYONE] : picked;
  }
  if (policy.visibility === "all") return [EVERYONE];
  const own = groupsOf(person.id).filter((g) => existing.has(g));
  if (own.length === 0) throw new ServiceError("no_groups", "You are in no department, so there is nobody to share with; ask an administrator");
  return own;
}

interface Payload { method?: string; name: string; title: string; body: string; webhook: string; label: string; description: string; url: string; groupIds: string[] }

/** Returns what happened: published (administrator) or the order waiting for review (member). */
export function publish(person: Person, input: Record<string, unknown>): { published: boolean; orderId?: string; webhookId?: string } {
  const policy = getPolicy();
  const may = mayPublish(person, policy);
  if (!may.ok) throw new ServiceError("publish_denied", may.reason === "adminOnly" ? "Only administrators may publish n8n workflows" : "Your department may not publish n8n workflows", 403);
  const name = String(input.name ?? "").trim().toLowerCase();
  if (!NAME.test(name)) throw new ServiceError("bad_name", "Name: lowercase letters, digits, - and _");
  const url = checkUrl(input.url, "The webhook URL");
  const label = String(input.label ?? "").trim().slice(0, 40);
  const description = String(input.description ?? "").trim().slice(0, 300);
  if (!description) throw new ServiceError("bad_description", "Say what the workflow does and what input it needs");
  const method = cleanMethod(input.method);
  const groupIds = resolveVisibility(person, policy, input.groupIds);
  const db = getDb();
  if (db.prepare("SELECT 1 FROM n8n_webhooks WHERE name=?").get(name)) throw new ServiceError("exists", "An app with this name already exists", 409);
  if (person.role === "admin") {
    const r = saveWebhook(person.id, { name, display_name: label, url, method, description, group_ids: groupIds, enabled: true });
    writeAudit("n8n.publish", person.id, { webhookId: r.id, name, scope: groupIds.includes(EVERYONE) ? "all" : "groups" });
    return { published: true, webhookId: r.id };
  }
  const open = db.prepare("SELECT payload FROM work_orders WHERE kind=? AND status='pending'").all(ORDER_KIND) as unknown as { payload: string }[];
  if (open.some((o) => (JSON.parse(o.payload) as Payload).webhook === name)) throw new ServiceError("exists", "A request for this name is already waiting", 409);
  const body = `${label || name}:${description}\n網址:${maskUrl(url)}(核可前請確認是公司或學校自己的 n8n)\n誰看得到:${groupIds.includes(EVERYONE) ? "所有人" : `${groupIds.length} 個部門`}`;
  const payload: Payload = { name: `上架 n8n 流程:${label || name}`, title: `上架 n8n 流程:${label || name}`, body, webhook: name, label, description, url, method, groupIds };
  const order = createOrder(ORDER_KIND, person.id, payload as unknown as Record<string, unknown>);
  writeAudit("n8n.publish_request", person.id, { orderId: order.id, name });
  return { published: false, orderId: order.id };
}

registerOrderKind(ORDER_KIND, (order, approverId) => {
  const p = order.payload as unknown as Payload;
  const r = saveWebhook(approverId, { name: p.webhook, display_name: p.label, url: p.url, method: p.method, description: p.description, group_ids: p.groupIds, enabled: true });
  writeAudit("n8n.publish", approverId, { webhookId: r.id, name: p.webhook, applicant: order.applicant_id, scope: p.groupIds.includes(EVERYONE) ? "all" : "groups" });
  return r.id;
});
