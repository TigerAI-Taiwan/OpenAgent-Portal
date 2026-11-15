// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { writePersonItem } from "./files";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { createAssignment } from "../workorders/assignments";
import type { Source } from "./facts";
import { dayKey } from "./time";
import { collapseStops } from "./format";
import { dedupeKey, insertItem, isDuplicate } from "./store";
import type { DeliverItem, RunRow } from "./types";

/**
 * 監督 routing (1.1.0-ce). Before: every 監督 item went to the channel's creator and to the heads of every department that has a member
 * in the channel, so a head read about people from other departments and the creator read about everybody. Now each 監督 item is
 * about ONE named person and becomes a 交辦單 for the head(s) of THAT person's own department(s), carrying its sources; the named person
 * gets a 提醒 (bell + 公佈欄 個人區) that the matter went to their head. A person with no head, or no department, sends it to the
 * administrators (the customer's, never the maintenance account). 稽核 is unchanged (still supervisors()).
 * Items with nobody named (a finished report deck) are not routed here and keep the old audience.
 */

const human = (id: string | null | undefined): boolean => !!id && !id.startsWith("wizard:") && id !== "ai" && !id.startsWith("agent:");

/** The person a 監督 item is about: the program's own fact says it; for the model's items it is the author of the first channel message cited. */
export function subjectOf(item: DeliverItem): string | null {
  const direct = (item.extra as { subjectId?: unknown } | undefined)?.subjectId;
  if (typeof direct === "string" && direct) return direct;
  for (const s of item.sources) {
    if (s.t !== "m") continue;
    const row = getDb().prepare("SELECT author_id FROM room_messages WHERE seq=?").get(s.seq) as { author_id: string } | undefined;
    if (row && human(row.author_id)) return row.author_id;
  }
  return null;
}

/** Heads of the groups the person belongs to (never the person themself); if there are none, the customer's active administrators. */
export function headsOf(subjectId: string): { ids: string[]; fallback: boolean } {
  const db = getDb();
  const heads = (db.prepare(
    `SELECT DISTINCT h.user_id AS id FROM memberships m JOIN memberships h ON h.group_id=m.group_id AND h.is_manager=1 JOIN users u ON u.id=h.user_id
     WHERE m.user_id=? AND h.user_id<>? AND u.status='active' AND u.is_vendor=0 ORDER BY h.user_id`,
  ).all(subjectId, subjectId) as unknown as { id: string }[]).map((r) => r.id);
  if (heads.length) return { ids: heads, fallback: false };
  const admins = (db.prepare("SELECT id FROM users WHERE role='admin' AND status='active' AND is_vendor=0 AND id<>? ORDER BY created_at").all(subjectId) as unknown as { id: string }[]).map((r) => r.id);
  return { ids: admins, fallback: true };
}

function sourceLines(sources: readonly Source[]): string[] {
  const db = getDb();
  return sources.map((s) => {
    if (s.t === "m") {
      const m = db.prepare("SELECT m.text, COALESCE(u.name,'?') AS name, m.ts FROM room_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.seq=?").get(s.seq) as { text: string; name: string; ts: number } | undefined;
      return m ? `- 頻道訊息 #${s.seq}(${m.name}):${m.text.replace(/\s+/g, " ").slice(0, 160)}` : `- 頻道訊息 #${s.seq}`;
    }
    if (s.t === "a") {
      const a = db.prepare("SELECT title FROM assignments WHERE id=?").get(s.id) as { title: string } | undefined;
      return `- 交辦單:${a?.title ?? s.id}`;
    }
    return `- ${s.label}:${s.quote}`;
  });
}

/** true = this 監督 item was routed here (交辦單 for the heads + 提醒 for the named person); false = leave it to the old delivery. */
export function routeSupervision(run: RunRow, item: DeliverItem, day = dayKey(Date.now())): boolean {
  if (item.aspect !== "supervise" || item.sources.length === 0) return false;
  const subject = subjectOf(item);
  if (!subject || !getDb().prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(subject)) return false;
  // The 提醒 for the named person doubles as the duplicate guard: the same matter is not handed over again tomorrow.
  const dedupe = dedupeKey("remind", subject, item.sources) + "|supervise";
  if (isDuplicate(dedupe)) return true;
  const { ids } = headsOf(subject);
  const text = collapseStops(item.text);
  const name = (getDb().prepare("SELECT name FROM users WHERE id=?").get(subject) as { name: string }).name;
  insertItem({
    runId: run.id, roomId: run.room_id, aspect: "remind", category: null, sources: [...item.sources], recipientId: subject, dedupe, day,
    text: `這件事已轉給你的主管追蹤:${text}`, extra: { supervised: true },
  });
  const plain = text.replace(/[「」]/g, "");
  const title = `監督:${name}　${plain.startsWith(name) ? plain.slice(name.length).replace(/^[的\s]+/, "") : plain}`.slice(0, 120).replace(/　$/, ""); // the sentence already starts with the name: say it once
  const description = `${text}\n\n出處:\n${sourceLines(item.sources).join("\n")}\n\n(由 AI 依頻道訊息整理,只列事實;怎麼處理由你決定。)`.slice(0, 4000);
  const roomName = run.room_id ? (getDb().prepare("SELECT name FROM rooms WHERE id=?").get(run.room_id) as { name: string } | undefined)?.name ?? null : null;
  writePersonItem(subject, "remind", `這件事已轉給你的主管追蹤:${text}`, roomName); // markdown copy in the person's folder (wizards/files.ts)
  for (const head of ids) {
    createAssignment({ id: head, role: "member" }, { title, description, assigneeId: head }, "ai");
    writePersonItem(head, "supervise", `${name}:${text}`, roomName); // 監督 is private to the head: their folder, never the channel's
  }
  writeAudit("wizard.supervise_route", run.requested_by, { runId: run.id, roomId: run.room_id, userId: subject, items: ids.length });
  return true;
}
