// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { ServiceError, userById, type Role } from "../accounts/service";
import { writeAudit } from "../accounts/audit";
import { dayKey, localDayStart, weekStartDay, wizardZone } from "../wizards/time";

/**
 * 使用者紀錄 (community edition): who was last online, and a READ-ONLY view of a member's conversations.
 * Everything here is decided on the server; the page only draws what comes back.
 *
 * Scope (viewer -> whom they may look at):
 *   admin  : every other non-admin account (members and department heads). Never another administrator.
 *   head   : the DIRECT members of the departments (groups) they head. Sub-departments are not included.
 *            Never another head (a person who heads any department) and never an administrator.
 *   others : nothing.
 * The off switch 「主管可查看對話」 (default on) only takes the head's access away; administrators keep theirs.
 * The community edition has no consultant account; a consultant-pack account is an ordinary member and so sees nothing.
 */

const SEEN_EVERY_MS = 60_000;
const SETTING_HEADS = "userlog.heads_can_view";

// ------------------------------------------------------------------ last online

const SEEN = Symbol.for("tigerai:userlog-seen");
function seenMemo(): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  return (g[SEEN] ??= new Map());
}

/** Called for every authenticated request. At most one database write per person per minute. */
export function touchActive(userId: string, now = Date.now()): void {
  const memo = seenMemo();
  const last = memo.get(userId);
  if (last !== undefined && now - last < SEEN_EVERY_MS) return;
  memo.set(userId, now);
  try {
    getDb().prepare("INSERT INTO user_activity (user_id, last_seen) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_seen = excluded.last_seen").run(userId, now);
    // The minute-by-minute trail the attendance facts of AI 評分精靈 read (last_seen alone is overwritten by the next request). Pruned after a year.
    getDb().prepare("INSERT OR IGNORE INTO activity_log (user_id, ts) VALUES (?, ?)").run(userId, now);
    if (Math.random() < 0.001) getDb().prepare("DELETE FROM activity_log WHERE ts < ?").run(now - 400 * 86_400_000);
  } catch (error) {
    memo.delete(userId); // best effort: never fail a request because of this
    console.error("[tigerai] last-online write failed:", error instanceof Error ? error.message : error);
  }
}

export function lastSeen(userId: string): number | null {
  const row = getDb().prepare("SELECT last_seen FROM user_activity WHERE user_id=?").get(userId) as { last_seen: number } | undefined;
  return row ? row.last_seen : null;
}

// ------------------------------------------------------------------ switch

export function headsCanView(): boolean {
  const row = getDb().prepare("SELECT value FROM tg_settings WHERE key=?").get(SETTING_HEADS) as { value: string } | undefined;
  return row ? row.value !== "0" : true;
}

export function setHeadsCanView(actorId: string, on: boolean): void {
  getDb().prepare("INSERT INTO tg_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .run(SETTING_HEADS, on ? "1" : "0", Date.now());
  writeAudit("userlog.setting", actorId, { scope: "heads_can_view", to: on ? "on" : "off" });
}

// ------------------------------------------------------------------ scope

export interface Viewer { id: string; role: Role }
export interface Target { id: string; name: string; email: string; status: string; departments: string[] }

/** People whose conversations this viewer may read because they took over from them (decision 11). Read only, like every view here. */
function grantedLeavers(viewerId: string): string[] {
  return (getDb().prepare("SELECT leaver_id FROM handover_reads WHERE successor_id=?").all(viewerId) as unknown as { leaver_id: string }[]).map((r) => r.leaver_id);
}

const isHead = (userId: string): boolean => !!getDb().prepare("SELECT 1 FROM memberships WHERE user_id=? AND is_manager=1").get(userId);

function departmentsOf(userId: string): string[] {
  return (getDb().prepare("SELECT g.name FROM memberships m JOIN groups g ON g.id=m.group_id WHERE m.user_id=? ORDER BY g.name").all(userId) as unknown as { name: string }[]).map((r) => r.name);
}

/** People this viewer may look at; empty for anyone without the right. */
export function visibleTargets(viewer: Viewer): Target[] {
  const db = getDb();
  let rows: { id: string; name: string; email: string; status: string }[] = [];
  if (viewer.role === "admin") {
    rows = db.prepare("SELECT id,name,email,status FROM users WHERE role<>'admin' AND id<>? ORDER BY name").all(viewer.id) as unknown as typeof rows;
  } else if (headsCanView()) {
    // Direct members of the groups this person heads; sub-groups are not walked. A member who heads any department is invisible to other heads.
    rows = db.prepare(
      `SELECT DISTINCT u.id,u.name,u.email,u.status FROM users u
         JOIN memberships mm ON mm.user_id=u.id
         JOIN memberships me ON me.group_id=mm.group_id AND me.user_id=? AND me.is_manager=1
        WHERE u.role<>'admin' AND u.id<>?
          AND NOT EXISTS (SELECT 1 FROM memberships h WHERE h.user_id=u.id AND h.is_manager=1)
        ORDER BY u.name`,
    ).all(viewer.id, viewer.id) as unknown as typeof rows;
  }
  for (const id of grantedLeavers(viewer.id)) {
    const u = db.prepare("SELECT id,name,email,status FROM users WHERE id=?").get(id) as unknown as (typeof rows)[number] | undefined;
    if (u && u.id !== viewer.id && !rows.some((r) => r.id === id)) rows.push(u);
  }
  return rows.map((r) => ({ ...r, departments: departmentsOf(r.id) }));
}

/** Why this viewer may look at that person ("self" included), or null. Directory and conversations share it. */
export function viewReason(viewer: Viewer, targetId: string): "self" | "admin" | "head" | "handover" | null {
  if (viewer.id === targetId) return "self";
  if (grantedLeavers(viewer.id).includes(targetId)) return "handover";
  if (viewer.role !== "admin" && !isHead(viewer.id)) return null;
  if (viewer.role !== "admin" && !headsCanView()) return null;
  return visibleTargets(viewer).some((t) => t.id === targetId) ? (viewer.role === "admin" ? "admin" : "head") : null;
}

/** Whether the person may use this feature at all (decides whether the tab is offered). */
export function mayUse(viewer: Viewer): boolean {
  if (viewer.role === "admin") return true;
  if (grantedLeavers(viewer.id).length) return true;
  return headsCanView() && isHead(viewer.id);
}

function requireUse(viewer: Viewer): void {
  if (viewer.role === "admin") return;
  if (grantedLeavers(viewer.id).length) return; // a successor reads only the people they took over from (visibleTargets)
  if (!isHead(viewer.id)) throw new ServiceError("forbidden", "Only administrators and department heads may open this", 403);
  if (!headsCanView()) throw new ServiceError("userlog_off", "Viewing conversations is turned off for department heads", 403);
}

function requireTarget(viewer: Viewer, targetId: string): Target {
  requireUse(viewer);
  const t = visibleTargets(viewer).find((x) => x.id === targetId);
  if (!t) throw new ServiceError("forbidden", "You may not view this person", 403);
  return t;
}

// ------------------------------------------------------------------ data

export interface ConversationMeta { id: string; title: string; modified: number }
/** What the page needs from the session store; the default reads pi's files (tigerai/userlog/reader.ts), tests pass a fake. */
export interface Deps {
  /** Every session the store knows, by id. */
  catalog(): Promise<Map<string, ConversationMeta>>;
  /** The messages of one session, each with its time. */
  messages(sessionId: string): Promise<unknown[] | null>;
}

/** A person's own, non-channel conversations that still exist. */
async function conversationsOf(userId: string, deps: Deps): Promise<ConversationMeta[]> {
  const ids = (getDb().prepare("SELECT session_id FROM session_owner WHERE user_id=? AND kind='chat' AND room_id IS NULL").all(userId) as unknown as { session_id: string }[]).map((r) => r.session_id);
  const cat = await deps.catalog();
  return ids.flatMap((id) => { const m = cat.get(id); return m ? [m] : []; }).sort((a, b) => b.modified - a.modified);
}

export interface MemberRow { id: string; name: string; email: string; status: string; departments: string[]; lastSeen: number | null; conversations: number; latestConversation: number | null; stayTodayMs: number; stayWeekMs: number }

/** Gaps longer than this between two minute-marks are not counted as time spent (a person who left the tab is not "staying"). */
export const STAY_GAP_MS = 10 * 60_000;
/** Active time from the minute trail (activity_log): the sum of gaps up to 10 minutes between neighbouring marks, plus the first minute of each stretch. */
export function stayMs(userId: string, fromMs: number, toMs: number): number {
  const rows = getDb().prepare("SELECT ts FROM activity_log WHERE user_id=? AND ts>=? AND ts<? ORDER BY ts").all(userId, fromMs, toMs) as unknown as { ts: number }[];
  let total = 0; let prev: number | null = null;
  for (const { ts } of rows) {
    if (prev === null || ts - prev > STAY_GAP_MS) total += 60_000; else total += ts - prev;
    prev = ts;
  }
  return total;
}
/** Start of today and of this week (Monday) in the Portal's time zone. */
export function dayWeekStarts(now: number): { day: number; week: number } {
  const today = dayKey(now);
  return { day: localDayStart(today), week: localDayStart(weekStartDay(today)) };
}

export async function listMembers(viewer: Viewer, deps: Deps, now = Date.now()): Promise<MemberRow[]> {
  requireUse(viewer);
  const { day, week } = dayWeekStarts(now);
  const out: MemberRow[] = [];
  const cat = await deps.catalog();
  const own = getDb().prepare("SELECT session_id FROM session_owner WHERE user_id=? AND kind='chat' AND room_id IS NULL");
  for (const t of visibleTargets(viewer)) {
    const convs = (own.all(t.id) as unknown as { session_id: string }[]).flatMap((r) => { const m = cat.get(r.session_id); return m ? [m] : []; });
    out.push({ ...t, lastSeen: lastSeen(t.id), conversations: convs.length, latestConversation: convs.length ? Math.max(...convs.map((c) => c.modified)) : null, stayTodayMs: stayMs(t.id, day, now + 1), stayWeekMs: stayMs(t.id, week, now + 1) });
  }
  return out;
}

const cell = (v: unknown): string => {
  let t = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // a name must not run as a spreadsheet formula
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const stamp = (ms: number | null): string => (ms === null ? "" : new Date(ms).toLocaleString("sv-SE", { timeZone: wizardZone() }).slice(0, 16));
const minutes = (ms: number): number => Math.round(ms / 60_000);

/** 匯出 CSV: the same table, the same people (visibleTargets), UTF-8 with a BOM so Excel opens the Chinese text. No conversation text; the export is audited. */
export async function exportCsv(viewer: Viewer, deps: Deps, now = Date.now()): Promise<{ filename: string; csv: string }> {
  const rows = await listMembers(viewer, deps, now);
  const head = ["姓名", "班級/部門", "最後上線", "今天停留(分)", "本週停留(分)", "對話數", "最近對話"];
  const lines = [head, ...rows.map((r) => [r.name, r.departments.join("、"), stamp(r.lastSeen), minutes(r.stayTodayMs), minutes(r.stayWeekMs), r.conversations, stamp(r.latestConversation)])];
  writeAudit("userlog.export", viewer.id, { items: rows.length });
  return { filename: `userlog-${dayKey(now)}.csv`, csv: "\uFEFF" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n" };
}

export async function listConversations(viewer: Viewer, targetId: string, deps: Deps): Promise<{ person: Target; conversations: ConversationMeta[] }> {
  const person = requireTarget(viewer, targetId);
  const conversations = await conversationsOf(targetId, deps);
  writeAudit("userlog.list", viewer.id, { userId: targetId, items: conversations.length, ...(viewReason(viewer, targetId) === "handover" ? { scope: "handover" } : {}) });
  return { person, conversations };
}

export async function readConversation(viewer: Viewer, targetId: string, sessionId: string, deps: Deps): Promise<{ person: Target; title: string; messages: unknown[] }> {
  const person = requireTarget(viewer, targetId);
  // The conversation must be that person's own, non-channel one; anything else is refused whatever the id.
  const own = getDb().prepare("SELECT 1 FROM session_owner WHERE session_id=? AND user_id=? AND kind='chat' AND room_id IS NULL").get(sessionId, targetId);
  if (!own) throw new ServiceError("forbidden", "That conversation does not belong to this person", 403);
  const meta = (await deps.catalog()).get(sessionId);
  const messages = meta ? await deps.messages(sessionId) : null;
  if (!meta || !messages) throw new ServiceError("not_found", "Conversation not found", 404);
  writeAudit("userlog.view", viewer.id, { userId: targetId, sessionId, title: meta.title.slice(0, 60), ...(viewReason(viewer, targetId) === "handover" ? { scope: "handover" } : {}) });
  return { person, title: meta.title, messages };
}

export { userById };
