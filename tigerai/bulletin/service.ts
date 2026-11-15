// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { pendingRequests } from "../register/service";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import { aiReviewFor, aiRunningCount, parseDue, type AssignmentRow } from "../workorders/assignments";
import { effectiveBaseUrl, effectiveKey } from "../provider/settings";
import { privateOpenFor, skillProposalsOpen } from "../wizards/store";
import type { ItemView } from "../wizards/types";

/**
 * 公佈欄. Announcements (who may post: admin to anyone, a department head only to the groups they head) and the
 * 提醒泡泡 summary (only what the person must act on). The server decides everything; the page only shows.
 *
 * Time: a day (expiry, due) is stored as noon UTC of that calendar day, like assignments. "Today" is the caller's own
 * local day, given as `tzo` (minutes, Date.getTimezoneOffset()), so no time zone moves a day.
 */

export type Actor = { id: string; role: "admin" | "member" };
const DAY = 86_400_000;

/** The UTC midnight that stands for the caller's local calendar day. */
export function localDay(now: number, tzo: number): number { return Math.floor((now - tzo * 60_000) / DAY) * DAY; }
const dayOf = (ms: number) => Math.floor(ms / DAY) * DAY;
export const isExpired = (expiresAt: number | null, now: number, tzo: number) => expiresAt !== null && dayOf(expiresAt) < localDay(now, tzo);

interface Raw {
  id: string; title: string; body: string; authorId: string; audienceAll: number; pinned: number; expiresAt: number | null; requireAck: number;
  createdAt: number; updatedAt: number; deletedAt: number | null; authorName: string | null;
}
const SELECT = `SELECT a.id, a.title, a.body, a.author_id AS authorId, a.audience_all AS audienceAll, a.pinned, a.expires_at AS expiresAt,
  a.require_ack AS requireAck, a.created_at AS createdAt, a.updated_at AS updatedAt, a.deleted_at AS deletedAt, u.name AS authorName
  FROM announcements a LEFT JOIN users u ON u.id = a.author_id`;

const db = () => getDb();
const all = <T>(sql: string, ...args: (string | number | null)[]) => db().prepare(sql).all(...args) as unknown as T[];
const one = <T>(sql: string, ...args: (string | number | null)[]) => (db().prepare(sql).get(...args) as unknown as T | undefined) ?? null;

function audienceGroups(id: string): { id: string; name: string }[] {
  return all<{ id: string; name: string }>("SELECT g.id, g.name FROM announcement_groups ag JOIN groups g ON g.id = ag.group_id WHERE ag.announcement_id=? ORDER BY g.name", id);
}
/** Groups this person heads (is_manager). */
export function headGroupIds(userId: string): string[] {
  return all<{ group_id: string }>("SELECT group_id FROM memberships WHERE user_id=? AND is_manager=1", userId).map((r) => r.group_id);
}
export const canPostAnywhere = (actor: Actor): boolean => actor.role === "admin" || headGroupIds(actor.id).length > 0;

/** Who may read it: admin, the poster, everyone for a company-wide one, else members of an audience group. */
function visibleTo(actor: Actor, a: Raw): boolean {
  if (a.deletedAt) return false;
  if (actor.role === "admin" || a.authorId === actor.id || a.audienceAll === 1) return true;
  return !!one("SELECT 1 FROM announcement_groups ag JOIN memberships m ON m.group_id = ag.group_id WHERE ag.announcement_id=? AND m.user_id=?", a.id, actor.id);
}
/** Meant for this person (company-wide, or one of their groups). An admin can read everything but is only asked to confirm what was addressed to them. */
function isRecipient(actor: Actor, a: Raw): boolean {
  if (a.deletedAt || a.authorId === actor.id) return false;
  if (a.audienceAll === 1) return true;
  return !!one("SELECT 1 FROM announcement_groups ag JOIN memberships m ON m.group_id = ag.group_id WHERE ag.announcement_id=? AND m.user_id=?", a.id, actor.id);
}
function getRaw(id: string): Raw | null { return one<Raw>(`${SELECT} WHERE a.id=?`, id); }
function requireVisible(actor: Actor, id: string): Raw {
  const a = getRaw(id);
  if (!a || !visibleTo(actor, a)) throw new ServiceError("not_found", "No such announcement", 404);
  return a;
}

/** The people an announcement is for (active accounts, the poster excluded). */
function recipients(a: Raw): { id: string; name: string }[] {
  if (a.audienceAll === 1) return all("SELECT id, name FROM users WHERE status='active' AND id<>? ORDER BY name", a.authorId);
  return all(`SELECT DISTINCT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id JOIN announcement_groups ag ON ag.group_id = m.group_id
    WHERE ag.announcement_id=? AND u.status='active' AND u.id<>? ORDER BY u.name`, a.id, a.authorId);
}

export interface AnnouncementView {
  id: string; title: string; body: string; authorId: string; authorName: string; audienceAll: boolean; audience: { id: string; name: string }[];
  audienceLabel: string; pinned: boolean; expiresAt: number | null; expired: boolean; requireAck: boolean; createdAt: number; updatedAt: number;
  read: boolean; acked: boolean; mine: boolean; canEdit: boolean; edited: boolean;
  stats?: { total: number; read: number; acked: number; notRead: string[]; notAcked: string[] };
}

function view(actor: Actor, a: Raw, now: number, tzo: number, withStats = false): AnnouncementView {
  const mineRow = one<{ read_at: number; acked_at: number | null }>("SELECT read_at, acked_at FROM announcement_reads WHERE announcement_id=? AND user_id=?", a.id, actor.id);
  const groups = a.audienceAll === 1 ? [] : audienceGroups(a.id);
  const mine = a.authorId === actor.id;
  const canEdit = mine || actor.role === "admin";
  const v: AnnouncementView = {
    id: a.id, title: a.title, body: a.body, authorId: a.authorId, authorName: a.authorName ?? "?", audienceAll: a.audienceAll === 1, audience: groups,
    audienceLabel: a.audienceAll === 1 ? "" : groups.map((g) => g.name).join("、"), pinned: a.pinned === 1, expiresAt: a.expiresAt,
    expired: isExpired(a.expiresAt, now, tzo), requireAck: a.requireAck === 1, createdAt: a.createdAt, updatedAt: a.updatedAt,
    read: mine || !!mineRow, acked: !!mineRow?.acked_at, mine, canEdit,
    edited: !!one("SELECT 1 FROM announcement_edits WHERE announcement_id=?", a.id),
  };
  if (withStats && canEdit) {
    const people = recipients(a);
    const reads = new Map(all<{ user_id: string; acked_at: number | null }>("SELECT user_id, acked_at FROM announcement_reads WHERE announcement_id=?", a.id).map((r) => [r.user_id, r.acked_at]));
    v.stats = {
      total: people.length, read: people.filter((p) => reads.has(p.id)).length, acked: people.filter((p) => !!reads.get(p.id)).length,
      notRead: people.filter((p) => !reads.has(p.id)).map((p) => p.name),
      notAcked: a.requireAck === 1 ? people.filter((p) => !reads.get(p.id)).map((p) => p.name) : [],
    };
  }
  return v;
}

// ---------------------------------------------------------------- posting rules

/** `audience`: "all" or a list of group ids. Admin: anything. Head: only groups they head, never the whole company. */
function resolveAudience(actor: Actor, audience: unknown): { all: boolean; groups: string[] } {
  if (audience === "all") {
    if (actor.role !== "admin") throw new ServiceError("audience_forbidden", "Only an administrator can post to the whole company", 403);
    return { all: true, groups: [] };
  }
  const ids = Array.isArray(audience) ? [...new Set(audience.filter((x): x is string => typeof x === "string" && x !== ""))] : [];
  if (ids.length === 0) throw new ServiceError("bad_audience", "Choose who this is for");
  for (const g of ids) if (!one("SELECT 1 FROM groups WHERE id=?", g)) throw new ServiceError("bad_audience", "Unknown group");
  if (actor.role !== "admin") {
    const mine = headGroupIds(actor.id);
    if (mine.length === 0) throw new ServiceError("forbidden", "Only administrators and department heads can post", 403);
    if (ids.some((g) => !mine.includes(g))) throw new ServiceError("audience_forbidden", "You can only post to groups you head", 403);
  }
  return { all: false, groups: ids };
}
function requirePoster(actor: Actor): void {
  if (!canPostAnywhere(actor)) throw new ServiceError("forbidden", "Only administrators and department heads can post", 403);
}
function text(v: unknown, field: string, max: number, required: boolean): string {
  const s = String(v ?? "").trim();
  if (required && !s) throw new ServiceError(field === "title" ? "bad_title" : "bad_body", `${field} is required`);
  if (s.length > max) throw new ServiceError(field === "title" ? "bad_title" : "bad_body", `${field} is too long (max ${max} characters)`);
  return s;
}
const expiry = (v: unknown): number | null => parseDue(v);

export function createAnnouncement(actor: Actor, input: Record<string, unknown>): AnnouncementView {
  requirePoster(actor);
  const aud = resolveAudience(actor, input.audience);
  const title = text(input.title, "title", 120, true);
  const body = text(input.body, "body", 8000, true);
  const id = `n${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = Date.now();
  const expiresAt = expiry(input.expiresAt);
  db().exec("BEGIN IMMEDIATE");
  try {
    db().prepare("INSERT INTO announcements (id,title,body,author_id,audience_all,pinned,expires_at,require_ack,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, title, body, actor.id, aud.all ? 1 : 0, input.pinned === true ? 1 : 0, expiresAt, input.requireAck === true ? 1 : 0, now, now);
    for (const g of aud.groups) db().prepare("INSERT INTO announcement_groups (announcement_id,group_id) VALUES (?,?)").run(id, g);
    db().exec("COMMIT");
  } catch (e) { try { db().exec("ROLLBACK"); } catch { /* done */ } throw e; }
  writeAudit("announcement.publish", actor.id, { announcementId: id, audience: aud.all ? "all" : aud.groups.join(","), requireAck: input.requireAck === true, pinned: input.pinned === true });
  return view(actor, getRaw(id)!, now, 0);
}

/** Poster or admin. The text before the change goes to the history (who, when, old text) so an edit can never rewrite the past. */
export function updateAnnouncement(actor: Actor, id: string, input: Record<string, unknown>): AnnouncementView {
  const a = requireVisible(actor, id);
  if (a.authorId !== actor.id && actor.role !== "admin") throw new ServiceError("forbidden", "Only the poster or an administrator can edit this", 403);
  const oldGroups = a.audienceAll === 1 ? [] : audienceGroups(id).map((g) => g.id);
  const next = { title: a.title, body: a.body, pinned: a.pinned, expiresAt: a.expiresAt, requireAck: a.requireAck, all: a.audienceAll, groups: oldGroups };
  if ("title" in input) next.title = text(input.title, "title", 120, true);
  if ("body" in input) next.body = text(input.body, "body", 8000, true);
  if ("pinned" in input) next.pinned = input.pinned === true ? 1 : 0;
  if ("requireAck" in input) next.requireAck = input.requireAck === true ? 1 : 0;
  if ("expiresAt" in input) next.expiresAt = expiry(input.expiresAt);
  if ("audience" in input) {
    const aud = resolveAudience(actor, input.audience);
    next.all = aud.all ? 1 : 0; next.groups = aud.groups;
  }
  const now = Date.now();
  const meta = JSON.stringify({ audienceAll: a.audienceAll === 1, groups: oldGroups, pinned: a.pinned === 1, expiresAt: a.expiresAt, requireAck: a.requireAck === 1 });
  db().exec("BEGIN IMMEDIATE");
  try {
    db().prepare("INSERT INTO announcement_edits (announcement_id,editor_id,ts,old_title,old_body,old_meta) VALUES (?,?,?,?,?,?)").run(id, actor.id, now, a.title, a.body, meta);
    db().prepare("UPDATE announcements SET title=?, body=?, pinned=?, expires_at=?, require_ack=?, audience_all=?, updated_at=? WHERE id=? AND deleted_at IS NULL")
      .run(next.title, next.body, next.pinned, next.expiresAt, next.requireAck, next.all, now, id);
    if ("audience" in input) {
      db().prepare("DELETE FROM announcement_groups WHERE announcement_id=?").run(id);
      for (const g of next.groups) db().prepare("INSERT INTO announcement_groups (announcement_id,group_id) VALUES (?,?)").run(id, g);
    }
    db().exec("COMMIT");
  } catch (e) { try { db().exec("ROLLBACK"); } catch { /* done */ } throw e; }
  writeAudit("announcement.edit", actor.id, { announcementId: id, changed: Object.keys(input).join(",") });
  return view(actor, getRaw(id)!, now, 0, true);
}

/** Soft delete: the row stays (with who and when), nobody sees it any more. */
export function deleteAnnouncement(actor: Actor, id: string): void {
  const a = requireVisible(actor, id);
  if (a.authorId !== actor.id && actor.role !== "admin") throw new ServiceError("forbidden", "Only the poster or an administrator can delete this", 403);
  db().prepare("UPDATE announcements SET deleted_at=?, deleted_by=? WHERE id=? AND deleted_at IS NULL").run(Date.now(), actor.id, id);
  writeAudit("announcement.delete", actor.id, { announcementId: id });
}

// ---------------------------------------------------------------- reading

export function markRead(actor: Actor, id: string): void {
  requireVisible(actor, id);
  db().prepare("INSERT OR IGNORE INTO announcement_reads (announcement_id,user_id,read_at) VALUES (?,?,?)").run(id, actor.id, Date.now());
}

/** 我已了解. Only for an announcement that asks for it; one click, kept with the time. */
export function acknowledge(actor: Actor, id: string): AnnouncementView {
  const a = requireVisible(actor, id);
  if (a.requireAck !== 1) throw new ServiceError("no_ack", "This announcement does not ask for confirmation", 409);
  const now = Date.now();
  db().prepare("INSERT INTO announcement_reads (announcement_id,user_id,read_at,acked_at) VALUES (?,?,?,?) ON CONFLICT(announcement_id,user_id) DO UPDATE SET acked_at=COALESCE(acked_at, excluded.acked_at)")
    .run(id, actor.id, now, now);
  writeAudit("announcement.ack", actor.id, { announcementId: id });
  return view(actor, a, now, 0);
}

/** `view`: "active" (not expired, pinned first), "expired" (已過期). Admin sees everything, everyone else what was meant for them. */
export function listAnnouncements(actor: Actor, which: string, now = Date.now(), tzo = 0): AnnouncementView[] {
  const rows = all<Raw>(`${SELECT} WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 500`).filter((a) => visibleTo(actor, a));
  const views = rows.map((a) => view(actor, a, now, tzo, true));
  const sel = views.filter((v) => (which === "expired" ? v.expired : !v.expired));
  return which === "expired" ? sel : sel.sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.createdAt - x.createdAt);
}

export function announcementDetail(actor: Actor, id: string, now = Date.now(), tzo = 0): { announcement: AnnouncementView; history: { id: number; editorName: string; ts: number; oldTitle: string; oldBody: string }[] } {
  const a = requireVisible(actor, id);
  const v = view(actor, a, now, tzo, true);
  const history = v.canEdit
    ? all<{ id: number; editorName: string | null; ts: number; oldTitle: string; oldBody: string }>(
      `SELECT e.id, u.name AS editorName, e.ts, e.old_title AS oldTitle, e.old_body AS oldBody FROM announcement_edits e LEFT JOIN users u ON u.id=e.editor_id WHERE e.announcement_id=? ORDER BY e.id DESC`, id)
      .map((h) => ({ ...h, editorName: h.editorName ?? "?" }))
    : [];
  return { announcement: v, history };
}

// ---------------------------------------------------------------- 提醒泡泡 / 個人區

export type Item =
  | { kind: "assignment"; id: string; title: string; due: number | null; overdue: boolean; createdAt: number; assignment: AssignmentRow }
  | { kind: "ack"; id: string; title: string; due: null; overdue: false; createdAt: number; announcement: AnnouncementView }
  | { kind: "approval"; id: string; title: string; due: null; overdue: false; createdAt: number; approval: { name: string; body: string; applicantName: string; kind: string } }
  /** A 精靈 result that is only for me: 監督 / 稽核 (I am a head or the channel's creator), 提醒 (I owe it), or a SKILL proposal (I am an administrator). */
  | { kind: "wizard"; id: string; title: string; due: null; overdue: false; createdAt: number; wizard: ItemView }
  /** 有 N 位新註冊等待核准: one per class the person may decide (administrator: all, plus the ones without a class; head: own classes). */
  | { kind: "register"; id: string; title: string; due: null; overdue: false; createdAt: number; register: { groupId: string | null; groupName: string | null; count: number } };

/** Everything that waits for this person to act: assignments to me not finished, 需要確認 not yet confirmed, approvals (admin). Sorted by due. */
export function personalItems(actor: Actor, now = Date.now(), tzo = 0): Item[] {
  const today = localDay(now, tzo);
  const items: Item[] = [];
  const assigned = all<AssignmentRow>(`SELECT a.id, a.title, a.description, a.applicant_id AS applicantId, COALESCE(ua.name,'?') AS applicantName,
    a.assignee_id AS assigneeId, COALESCE(us.name,'?') AS assigneeName, a.due_date AS dueDate, a.session_id AS sessionId, a.status, a.return_reason AS returnReason,
    a.done_note AS doneNote, a.created_at AS createdAt, a.updated_at AS updatedAt, a.accepted_at AS acceptedAt, a.finished_at AS finishedAt
    FROM assignments a LEFT JOIN users ua ON ua.id=a.applicant_id LEFT JOIN users us ON us.id=a.assignee_id
    WHERE a.assignee_id=? AND a.status IN ('open','accepted')`, actor.id);
  for (const a of assigned) items.push({ kind: "assignment", id: a.id, title: a.title, due: a.dueDate, overdue: a.dueDate !== null && dayOf(a.dueDate) < today, createdAt: a.createdAt, assignment: a });
  // AI orders I handed out that the AI has stopped on: they wait for my confirmation (the applicant is the one who acts).
  for (const a of aiReviewFor(actor)) items.push({ kind: "assignment", id: a.id, title: a.title, due: a.dueDate, overdue: a.dueDate !== null && dayOf(a.dueDate) < today, createdAt: a.createdAt, assignment: a });
  const acks = all<Raw>(`${SELECT} WHERE a.deleted_at IS NULL AND a.require_ack=1 AND a.author_id<>? AND NOT EXISTS
    (SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.user_id=? AND r.acked_at IS NOT NULL) ORDER BY a.created_at`, actor.id, actor.id)
    .filter((a) => isRecipient(actor, a) && !isExpired(a.expiresAt, now, tzo));
  for (const a of acks) items.push({ kind: "ack", id: a.id, title: a.title, due: null, overdue: false, createdAt: a.createdAt, announcement: view(actor, a, now, tzo) });
  if (actor.role === "admin") {
    const orders = all<{ id: string; kind: string; payload: string; applicantName: string | null; created_at: number }>(
      `SELECT w.id, w.kind, w.payload, u.name AS applicantName, w.created_at FROM work_orders w LEFT JOIN users u ON u.id=w.applicant_id WHERE w.status='pending' AND w.applicant_id<>? ORDER BY w.created_at`, actor.id);
    for (const o of orders) {
      let p: { name?: string; body?: string; title?: string } = {};
      try { p = JSON.parse(o.payload) as typeof p; } catch { /* keep empty */ }
      items.push({ kind: "approval", id: o.id, title: p.title ?? `/${p.name ?? "?"}`, due: null, overdue: false, createdAt: o.created_at, approval: { name: p.title ?? p.name ?? "", body: p.body ?? "", applicantName: o.applicantName ?? "?", kind: o.kind } });
    }
  }
  // 精靈 results addressed to me only (private ones never sit in a channel): the bell counts them like everything else I must act on.
  for (const w of [...privateOpenFor(actor), ...skillProposalsOpen(actor)]) {
    items.push({ kind: "wizard", id: w.id, title: w.aspect === "skill" ? w.text : `${w.aspectZh}${w.roomName ? `:${w.roomName}` : ""}`.slice(0, 80), due: null, overdue: false, createdAt: w.createdAt, wizard: w });
  }
  for (const g of pendingRequests(actor)) {
    const n = g.applicants.length;
    items.push({ kind: "register", id: g.groupId ?? "none", title: g.groupName ? `有 ${n} 位新註冊等待核准:${n} 位申請加入『${g.groupName}』` : `有 ${n} 位新註冊等待核准`, due: null, overdue: false, createdAt: Math.min(...g.applicants.map((a) => a.createdAt)), register: { groupId: g.groupId, groupName: g.groupName, count: n } });
  }
  return items.sort((x, y) => (x.due ?? Infinity) - (y.due ?? Infinity) || x.createdAt - y.createdAt);
}

/** One call feeds the bubble (count, red), the home screen (latest unread, most urgent) and the tab badge. */
export function bulletinSummary(actor: Actor, now = Date.now(), tzo = 0) {
  const items = personalItems(actor, now, tzo);
  const unread = listAnnouncements(actor, "active", now, tzo).filter((a) => !a.read && !a.mine && isRecipient(actor, { id: a.id, authorId: a.authorId, audienceAll: a.audienceAll ? 1 : 0, deletedAt: null } as Raw));
  const head = (a: AnnouncementView) => ({ id: a.id, title: a.title, authorName: a.authorName, pinned: a.pinned, requireAck: a.requireAck, createdAt: a.createdAt });
  return {
    count: items.length,
    overdue: items.some((i) => i.overdue),
    parts: { assignments: items.filter((i) => i.kind === "assignment").length, acks: items.filter((i) => i.kind === "ack").length, approvals: items.filter((i) => i.kind === "approval").length, wizards: items.filter((i) => i.kind === "wizard").length, registers: items.filter((i) => i.kind === "register").length },
    urgent: items.slice(0, 2).map((i) => ({ kind: i.kind, id: i.id, title: i.title, due: i.due, overdue: i.overdue })),
    unread: { count: unread.length, latest: unread.slice(0, 2).map(head) },
    canPost: canPostAnywhere(actor),
    // AI orders I handed out: finished ones wait for me (toast, home list); running ones make the page poll faster.
    aiReview: aiReviewFor(actor).slice(0, 5).map((a) => ({ id: a.id, title: a.title, note: a.aiNote })),
    aiRunning: aiRunningCount(actor),
  };
}

/** Groups this person may post to: admin = all, head = the ones they head. `all` only for admin. */
export function postingScope(actor: Actor): { all: boolean; groups: { id: string; name: string }[] } {
  if (actor.role === "admin") return { all: true, groups: all("SELECT id, name FROM groups ORDER BY name") };
  const mine = headGroupIds(actor.id);
  return { all: false, groups: mine.length ? all<{ id: string; name: string }>(`SELECT id, name FROM groups WHERE id IN (${mine.map(() => "?").join(",")}) ORDER BY name`, ...mine) : [] };
}

// ---------------------------------------------------------------- AI draft (the AI never publishes)

/** Asks the gateway (server side, tigerai-fast) for a title and body. Nothing is stored: a person edits and publishes. */
export async function draftAnnouncement(actor: Actor, input: { topic?: unknown; audience?: unknown }): Promise<{ title: string; body: string }> {
  requirePoster(actor);
  const topic = text(input.topic, "body", 1000, true);
  const base = effectiveBaseUrl().url;
  if (!base) throw new ServiceError("not_configured", "No base URL is configured", 409);
  const audience = typeof input.audience === "string" ? input.audience.slice(0, 200) : "";
  const model = process.env.TIGERAI_BULLETIN_MODEL || "tigerai-fast";
  const key = effectiveKey();
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model, temperature: 0.3, max_tokens: 1500,
        messages: [
          { role: "system", content: "你是公司內部公告的撰寫助理。只輸出一個 JSON 物件,格式 {\"title\":\"...\",\"body\":\"...\"}。title 為繁體中文、不超過 30 字;body 為繁體中文 Markdown、簡短清楚(必要時用條列)、不編造日期或數字、不加署名。不要輸出 JSON 以外的任何文字。" },
          { role: "user", content: `請依下列重點寫一則公告${audience ? `(對象:${audience})` : ""}:\n${topic}` },
        ],
      }),
    });
  } catch (e) { throw new ServiceError("gateway", `Gateway unreachable: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`, 502); }
  if (!res.ok) throw new ServiceError("gateway", `Gateway answered ${res.status}`, 502);
  let content = "";
  try { content = String(((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? ""); } catch { /* empty */ }
  const draft = parseDraft(content);
  if (!draft) throw new ServiceError("empty_draft", "The AI returned nothing usable; try again", 502);
  writeAudit("announcement.ai_draft", actor.id, { chars: draft.body.length });
  return draft;
}

export function parseDraft(raw: string): { title: string; body: string } | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { title?: unknown; body?: unknown };
      const title = String(o.title ?? "").trim().slice(0, 120); const body = String(o.body ?? "").trim().slice(0, 8000);
      if (title && body) return { title, body };
    } catch { /* fall back to plain text */ }
  }
  const lines = cleaned.replace(/^```\w*\n?|```$/g, "").trim().split("\n");
  const title = (lines.shift() ?? "").replace(/^#+\s*/, "").trim().slice(0, 120);
  const body = lines.join("\n").trim().slice(0, 8000);
  return title && body ? { title, body } : null;
}
