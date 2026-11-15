// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { getDb } from "../db/store";
import { type Role } from "../accounts/service";
import { getRoom, requireRoom } from "../rooms/service";
import { ASPECT_ZH, CATEGORY_ZH, type Category } from "./format";
import { sourceKey, type Msg, type Source } from "./facts";
import { localParts } from "./time";
import { WIZARD_ZH } from "./settings";
import type { ItemView, RunRow, RunView, SourceView } from "./types";

/** Rows and views of the wizard tables. No rules live here beyond who may see what a view contains. */

const db = () => getDb();
export const newId = (prefix: string): string => `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
type Actor = { id: string; role: Role };

export function getRun(id: string): RunRow | null {
  return (db().prepare("SELECT * FROM wizard_runs WHERE id=?").get(id) as unknown as RunRow) ?? null;
}
export function insertRun(r: { kind: string; roomId: string | null; runnerId: string; requestedBy: string | null; trigger: "schedule" | "manual"; period: string | null; params?: Record<string, unknown> }): RunRow {
  const id = newId("z");
  db().prepare("INSERT INTO wizard_runs (id,kind,room_id,runner_id,requested_by,trigger,period,status,created_at,input) VALUES (?,?,?,?,?,?,?,'running',?,?)")
    .run(id, r.kind, r.roomId, r.runnerId, r.requestedBy, r.trigger, r.period, Date.now(), JSON.stringify(r.params ?? {}));
  return getRun(id)!;
}

/** The newest message number a finished run of this kind has read in this channel. */
export function lastReadSeq(roomId: string, kind: string): number {
  const r = db().prepare("SELECT MAX(to_seq) AS s FROM wizard_runs WHERE room_id=? AND kind=? AND status='done'").get(roomId, kind) as { s: number | null };
  return r.s ?? 0;
}

/**
 * Has this wizard already been handled for this period (a day, an ISO week)? Any run counts, failed ones too (a failure is
 * shown and rerun by a person, never silently retried by the schedule); only a skipped manual press does not.
 */
export function periodHandled(roomId: string, kind: string, period: string): boolean {
  return !!db().prepare("SELECT 1 FROM wizard_runs WHERE room_id=? AND kind=? AND period=? AND NOT (status='skipped' AND trigger='manual') LIMIT 1").get(roomId, kind, period);
}
export function runningRun(roomId: string, kind: string): RunRow | null {
  return (db().prepare("SELECT * FROM wizard_runs WHERE room_id=? AND kind=? AND status='running' ORDER BY created_at DESC LIMIT 1").get(roomId, kind) as unknown as RunRow) ?? null;
}

/** Human messages of a channel after `afterSeq` (never AI, system, warning or wizard lines), oldest first. */
export function humanMessages(roomId: string, opts: { afterSeq?: number; sinceTs?: number; limit?: number } = {}): Msg[] {
  const rows = db().prepare(
    `SELECT * FROM (SELECT m.seq, m.author_id AS authorId, COALESCE(u.name,'?') AS author, m.ts, m.text FROM room_messages m LEFT JOIN users u ON u.id=m.author_id
      WHERE m.room_id=? AND m.kind='human' AND m.seq>? AND m.ts>=? ORDER BY m.seq DESC LIMIT ?) ORDER BY seq`,
  ).all(roomId, opts.afterSeq ?? 0, opts.sinceTs ?? 0, Math.min(opts.limit ?? 500, 1000)) as unknown as Msg[];
  return rows;
}

// ---------------------------------------------------------------- items

export interface NewItem {
  runId: string; roomId: string | null; aspect: string; category?: Category | null; text: string; sources: Source[]; recipientId: string | null;
  extra?: Record<string, unknown> | null; dedupe?: string | null; day: string;
}
/** The key two private items share when they say the same thing to the same person about the same sources. */
export const dedupeKey = (aspect: string, recipient: string | null, sources: readonly Source[]): string =>
  `${aspect}|${recipient ?? "-"}|${[...sources].map(sourceKey).sort().join(",")}`;
const ACK_QUIET_MS = 3 * 86_400_000;
/** True when the same private item is already open, or the person already said 知道了 within three days. */
export function isDuplicate(dedupe: string): boolean {
  return !!db().prepare("SELECT 1 FROM wizard_items WHERE dedupe=? AND (state='open' OR (state='done' AND decided_at>?)) LIMIT 1").get(dedupe, Date.now() - ACK_QUIET_MS);
}
export function insertItem(i: NewItem): string {
  const id = newId("y");
  db().prepare("INSERT INTO wizard_items (id,run_id,room_id,aspect,category,text,sources,recipient_id,state,extra,dedupe,day,created_at) VALUES (?,?,?,?,?,?,?,?,'open',?,?,?,?)")
    .run(id, i.runId, i.roomId, i.aspect, i.category ?? null, i.text, JSON.stringify(i.sources), i.recipientId, i.extra ? JSON.stringify(i.extra) : null, i.dedupe ?? null, i.day, Date.now());
  return id;
}
export interface ItemRow {
  id: string; run_id: string; room_id: string | null; aspect: string; category: string | null; text: string; sources: string; recipient_id: string | null;
  state: string; extra: string | null; dedupe: string | null; day: string | null; created_at: number; decided_by: string | null; decided_at: number | null;
}
export function getItem(id: string): ItemRow | null { return (db().prepare("SELECT * FROM wizard_items WHERE id=?").get(id) as unknown as ItemRow) ?? null; }

/** Suggestions a person's wizards have written today (the per person and day cap counts these). */
export function suggestionsToday(runnerId: string, day: string): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM wizard_items i JOIN wizard_runs r ON r.id=i.run_id WHERE i.aspect='suggest' AND r.runner_id=? AND i.day=?").get(runnerId, day) as { n: number }).n;
}
/** The same suggestion text already written in this channel in the last 14 days (open or decided): a weekly report must not offer again what a daily summary already did. */
export function suggestionRepeats(roomId: string, text: string): boolean {
  return !!db().prepare("SELECT 1 FROM wizard_items WHERE room_id=? AND aspect='suggest' AND text=? AND created_at>? LIMIT 1").get(roomId, text, Date.now() - 14 * 86_400_000);
}
/** How many suggestions of this category in this channel people answered 不需要 in the last 30 days. */
export function dismissedCount(roomId: string, category: string): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM wizard_items WHERE room_id=? AND aspect='suggest' AND category=? AND state='dismissed' AND decided_at>?").get(roomId, category, Date.now() - 30 * 86_400_000) as { n: number }).n;
}

// ---------------------------------------------------------------- views

const names = (ids: (string | null)[]): Map<string, string> => {
  const m = new Map<string, string>();
  for (const id of new Set(ids.filter((x): x is string => !!x))) { const r = db().prepare("SELECT name FROM users WHERE id=?").get(id) as { name: string } | undefined; if (r) m.set(id, r.name); }
  return m;
};

export function viewRun(r: RunRow): RunView {
  const n = names([r.confirmed_by]);
  return {
    id: r.id, kind: r.kind, kindZh: WIZARD_ZH[r.kind as keyof typeof WIZARD_ZH] ?? r.kind, roomId: r.room_id, status: r.status, error: r.error, trigger: r.trigger, period: r.period,
    createdAt: r.created_at, finishedAt: r.finished_at, postSeq: r.post_seq, confirmState: r.confirm_state, confirmedByName: r.confirmed_by ? n.get(r.confirmed_by) ?? "?" : null, confirmedAt: r.confirmed_at,
  };
}

function parseSources(v: string): Source[] { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } }
const md = (ms: number) => { const p = localParts(ms); return `${p.m}/${p.d}`; };

/** Resolves what a source points at, for a viewer. A message's author and day show only when the viewer may open that channel. */
export function viewItems(actor: Actor, rows: ItemRow[]): ItemView[] {
  const roomOk = new Map<string, boolean>();
  const canSee = (roomId: string | null): boolean => {
    if (!roomId) return false;
    if (!roomOk.has(roomId)) { try { requireRoom(actor, roomId); roomOk.set(roomId, true); } catch { roomOk.set(roomId, false); } }
    return roomOk.get(roomId)!;
  };
  return rows.map((r) => {
    const sources: SourceView[] = parseSources(r.sources).map((s): SourceView => {
      if (s.t === "m") {
        const m = canSee(r.room_id) ? (db().prepare("SELECT m.ts, COALESCE(u.name,'?') AS name FROM room_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.seq=? AND m.room_id=?").get(s.seq, r.room_id) as { ts: number; name: string } | undefined) : undefined;
        return { t: "m", seq: s.seq, roomId: r.room_id, label: m ? `#${s.seq} ${m.name} ${md(m.ts)}` : `#${s.seq}` };
      }
      if (s.t === "x") return { t: "x", roomId: r.room_id, label: s.label, quote: s.quote };
      const a = db().prepare("SELECT title, applicant_id, assignee_id FROM assignments WHERE id=?").get(s.id) as { title: string; applicant_id: string; assignee_id: string } | undefined;
      const mine = a && (actor.role === "admin" || a.applicant_id === actor.id || a.assignee_id === actor.id);
      return { t: "a", id: s.id, roomId: r.room_id, label: mine ? `交辦單:${a!.title}` : "交辦單" };
    });
    const room = r.room_id ? getRoom(r.room_id) : null;
    return {
      id: r.id, runId: r.run_id, roomId: r.room_id, roomName: room?.name ?? null, aspect: r.aspect, aspectZh: ASPECT_ZH[r.aspect as keyof typeof ASPECT_ZH] ?? r.aspect,
      category: r.category ? CATEGORY_ZH[r.category as Category] ?? r.category : null, text: r.text, sources, state: r.state, createdAt: r.created_at,
      extra: r.extra ? (JSON.parse(r.extra) as Record<string, unknown>) : null,
    };
  });
}

/** Private items waiting for this person (監督, 稽核, 提醒 sent to them). Only rows addressed to them. */
export function privateOpenFor(actor: Actor): ItemView[] {
  const rows = db().prepare("SELECT * FROM wizard_items WHERE recipient_id=? AND state='open' AND aspect IN ('supervise','audit','remind') ORDER BY created_at").all(actor.id) as unknown as ItemRow[];
  return viewItems(actor, rows);
}
/** Skill proposals waiting for an administrator. */
export function skillProposalsOpen(actor: Actor): ItemView[] {
  if (actor.role !== "admin") return [];
  const rows = db().prepare("SELECT * FROM wizard_items WHERE aspect='skill' AND state='open' ORDER BY created_at").all() as unknown as ItemRow[];
  return viewItems(actor, rows);
}

/** What a channel shows under its wizard messages: the latest runs with a posted message and their channel items. */
export function roomCards(actor: Actor, roomId: string): { runs: RunView[]; items: ItemView[] } {
  const runs = db().prepare("SELECT * FROM wizard_runs WHERE room_id=? AND post_seq IS NOT NULL ORDER BY post_seq DESC LIMIT 30").all(roomId) as unknown as RunRow[];
  if (runs.length === 0) return { runs: [], items: [] };
  const rows = db().prepare(`SELECT * FROM wizard_items WHERE run_id IN (${runs.map(() => "?").join(",")}) AND recipient_id IS NULL AND aspect IN ('record','suggest') ORDER BY created_at, rowid`).all(...runs.map((r) => r.id)) as unknown as ItemRow[];
  return { runs: runs.map(viewRun), items: viewItems(actor, rows) };
}
