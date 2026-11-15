// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import type { RoomRow } from "../rooms/service";
import { listMembers } from "../rooms/service";
import { ASPECT_ZH, CATEGORY_ZH, type Aspect, type Checked } from "./format";
import { assignmentFacts, promiseFacts, unansweredFacts, type Fact, type Msg, type Source } from "./facts";
import { dismissedCount, suggestionRepeats, suggestionsToday } from "./store";
import { suggestCap } from "./settings";
import { localParts, DAY_MS } from "./time";
import type { DeliverItem } from "./types";
import { humanMessages } from "./store";

/** Pieces the built-in wizards share. */

export const fmtDay = (ms: number): string => { const p = localParts(ms); return `${p.y}/${String(p.m).padStart(2, "0")}/${String(p.d).padStart(2, "0")}`; };
export const fmtMdHm = (ms: number): string => { const p = localParts(ms); return `${String(p.m).padStart(2, "0")}/${String(p.d).padStart(2, "0")} ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`; };

/** Who receives 監督 and 稽核: the channel's creator and the heads of departments that have a member in it (active accounts only). */
export function supervisors(room: Pick<RoomRow, "id" | "owner_id">): string[] {
  const rows = getDb().prepare(
    `SELECT DISTINCT h.user_id AS id FROM memberships h JOIN memberships m ON m.group_id=h.group_id JOIN room_members rm ON rm.user_id=m.user_id
     JOIN users u ON u.id=h.user_id WHERE h.is_manager=1 AND rm.room_id=? AND u.status='active'`,
  ).all(room.id) as unknown as { id: string }[];
  const owner = getDb().prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(room.owner_id);
  return [...new Set([...(owner ? [room.owner_id] : []), ...rows.map((r) => r.id)])];
}

/** The facts the program counts for a channel: promises past their date or due soon, questions nobody answered, work orders late or due soon. */
export function collectFacts(room: Pick<RoomRow, "id">, now: number, on: { aspects: Record<Aspect, boolean> }): Fact[] {
  if (!on.aspects.supervise && !on.aspects.remind) return [];
  const msgs = humanMessages(room.id, { sinceTs: now - 30 * DAY_MS, limit: 500 });
  const facts: Fact[] = [...promiseFacts(msgs, now), ...unansweredFacts(msgs, now)];
  if (on.aspects.remind || on.aspects.supervise) { // a late work order feeds both: 提醒 to the assignee, 監督 to their head
    const members = listMembers(room.id).map((m) => m.id);
    if (members.length) {
      const orders = getDb().prepare(
        `SELECT a.id, a.title, a.assignee_id AS assigneeId, COALESCE(u.name,'?') AS assigneeName, a.due_date AS dueDate FROM assignments a LEFT JOIN users u ON u.id=a.assignee_id
         WHERE a.assignee_kind='user' AND a.status IN ('open','accepted') AND a.due_date IS NOT NULL AND a.title NOT LIKE '監督:%' AND a.assignee_id IN (${members.map(() => "?").join(",")})`,
      ).all(...members) as unknown as { id: string; title: string; assigneeId: string; assigneeName: string; dueDate: number }[];
      facts.push(...assignmentFacts(orders, now));
    }
  }
  return facts;
}

/** Private items the program itself makes from facts. No model is involved, so their text and numbers are exact. */
export function factItems(room: Pick<RoomRow, "id" | "owner_id">, facts: readonly Fact[], on: { aspects: Record<Aspect, boolean> }): DeliverItem[] {
  const out: DeliverItem[] = [];
  const heads = supervisors(room);
  const active = (id: string | null) => !!id && !!getDb().prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(id);
  for (const f of facts) {
    if (on.aspects.supervise && f.supervise) out.push({ aspect: "supervise", text: f.supervise, sources: f.sources, to: { users: heads }, extra: { fact: f.kind, days: f.days, ...(f.ownerId ? { subjectId: f.ownerId } : {}) } });
    // A reminder goes to the person who owes it, and to nobody else (not the heads, not the channel).
    if (on.aspects.remind && f.remind && active(f.ownerId)) out.push({ aspect: "remind", text: f.remind, sources: f.sources, to: { users: [f.ownerId!] }, extra: { fact: f.kind, days: f.days } });
  }
  return out;
}

/**
 * Suggestions are the one aspect that can be noise, so three guards run in code (not in the prompt):
 *  - a category people answered 不需要 twice in this channel within 30 days is not written again; once, at most one;
 *  - a suggestion about the same message as a 監督 item is folded into that item instead of being a second card;
 *  - the same text already written in the last 14 days (a weekly report repeating a daily suggestion) is not offered again;
 *  - each person (the channel's creator) gets at most `suggestCap()` suggestions per day over all their channels.
 */
export function shapeSuggestions(opts: { roomId: string; runnerId: string; day: string; suggestions: Checked[]; supervise: DeliverItem[] }): { kept: Checked[]; folded: number; dropped: number } {
  const seen = new Map<string, number>();
  const cap = Math.max(0, suggestCap() - suggestionsToday(opts.runnerId, opts.day));
  const supervised = new Set(opts.supervise.flatMap((i) => i.sources.map((s) => (s.t === "m" ? s.seq : -1))).filter((n) => n >= 0));
  const kept: Checked[] = []; let folded = 0; let dropped = 0;
  for (const s of opts.suggestions) {
    if (suggestionRepeats(opts.roomId, s.text)) { dropped++; continue; }
    const cat = s.category ?? "other";
    const dismissed = dismissedCount(opts.roomId, cat);
    const used = seen.get(cat) ?? 0;
    if (dismissed >= 2 || (dismissed === 1 && used >= 1)) { dropped++; continue; }
    seen.set(cat, used + 1);
    const host = opts.supervise.find((i) => i.sources.some((x) => x.t === "m" && s.sources.some((y) => y.t === "m" && y.seq === x.seq)));
    if (host && s.sources.some((y) => y.t === "m" && supervised.has(y.seq))) { host.text = `${host.text} 建議:${s.text}`; folded++; continue; }
    if (kept.length >= cap) { dropped++; continue; }
    kept.push(s);
  }
  return { kept, folded, dropped };
}

/** One line of a posted draft: the text and where it came from, e.g. "…〔#12 #15〕". */
export const citeInline = (sources: readonly Source[]): string => `〔${sources.map((s) => (s.t === "m" ? `#${s.seq}` : s.t === "x" ? s.label : "交辦單")).join(" ")}〕`;

/** Sections for a posted draft; an aspect with nothing in it is left out. */
export function renderSections(sections: { aspect: Aspect; items: { text: string; sources: readonly Source[]; category?: string }[] }[]): string {
  const parts: string[] = [];
  for (const s of sections) {
    if (s.items.length === 0) continue;
    parts.push(`### ${ASPECT_ZH[s.aspect]}`);
    for (const i of s.items) parts.push(`- ${i.category ? `〔${CATEGORY_ZH[i.category as keyof typeof CATEGORY_ZH] ?? i.category}〕` : ""}${i.text} ${citeInline(i.sources)}`);
    parts.push("");
  }
  return parts.join("\n").trim();
}
export type { Msg };
