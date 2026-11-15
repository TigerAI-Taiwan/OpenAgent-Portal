// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { createAssignment } from "../workorders/assignments";
import { supervisors } from "./shared";
import { headsOf } from "./supervise-route";
import type { RunRow } from "./types";

/**
 * 「確認」交辦單 (1.1.0-ce decision #3). 工作週報 and 訊息分析 are AI drafts; the draft is only the record once a person confirms it. Besides the
 * 確認 button on the channel card, the run hands a 交辦單 to whoever confirms (the channel's creator when they are an administrator or a head; otherwise the head of the creator's own class/department
 * (in a school: the teacher, so a student-made group channel is confirmed by the teacher); in the end an administrator), linking the Markdown file in the 目錄.
 * Finishing the 交辦單 and pressing 確認 are the same act: each marks the other (finishOrderOf here; the other direction is inline in workorders/assignments.ts, which this module imports). 每日摘要 stays bell-only.
 */
export const CONFIRM_KINDS: Record<string, string> = { weekly: "工作週報", adhoc: "訊息分析" };

const active = "status='active' AND is_vendor=0";

export function confirmerOf(room: { id: string; owner_id: string }): string | null {
  const db = getDb();
  const ok = (id: string): boolean => !!db.prepare(`SELECT 1 FROM users WHERE id=? AND ${active}`).get(id);
  const owner = ok(room.owner_id) ? room.owner_id : null;
  // The creator confirms their own channel when they are somebody who may (an administrator or the head of a group). A student who
  // opened a group-work channel is neither: there the draft goes to the head of their own class (the teacher), else to an administrator.
  const mayConfirm = !!owner && (!!db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin'").get(owner) || !!db.prepare("SELECT 1 FROM memberships WHERE user_id=? AND is_manager=1").get(owner));
  if (mayConfirm) return owner;
  const heads = headsOf(room.owner_id).ids.filter(ok);
  if (heads.length) return heads[0];
  if (owner) return owner;
  const head = supervisors(room).find(ok);
  if (head) return head;
  return (db.prepare(`SELECT id FROM users WHERE role='admin' AND ${active} ORDER BY created_at LIMIT 1`).get() as { id: string } | undefined)?.id ?? null;
}

/** Hands the 確認 交辦單 over and remembers it on the run. Never throws: a run without its order still has the 確認 button. */
export function makeConfirmOrder(run: RunRow, room: { id: string; name: string; owner_id: string } | null, node: string | null): string | null {
  const label = CONFIRM_KINDS[run.kind];
  if (!label || !room) return null;
  try {
    const to = confirmerOf(room);
    if (!to) return null;
    const link = node ? `\n\n檔案:/?settings=dir&node=${encodeURIComponent(node)}` : "";
    const a = createAssignment({ id: to, role: "member" }, {
      title: `確認:${room.name} ${label}`.slice(0, 120),
      description: `AI 整理了「${room.name}」的${label}草稿,請看過內容後確認;完成這張交辦單就等於確認(頻道裡的「確認」按鈕效果相同)。${link}`,
      assigneeId: to,
    }, "ai");
    getDb().prepare("UPDATE wizard_runs SET confirm_assignment_id=? WHERE id=?").run(a.id, run.id);
    return a.id;
  } catch { return null; }
}

/** The channel 確認 was pressed: the 交辦單 is done too. */
export function finishOrderOf(runId: string, actorId: string): void {
  const r = getDb().prepare("SELECT confirm_assignment_id AS id FROM wizard_runs WHERE id=?").get(runId) as { id: string | null } | undefined;
  if (!r?.id) return;
  const now = Date.now();
  const res = getDb().prepare("UPDATE assignments SET status='done', updated_at=?, finished_at=?, done_note='已在頻道確認' WHERE id=? AND status IN ('open','accepted')").run(now, now, r.id);
  if (res.changes) writeAudit("assignment.complete", actorId, { assignmentId: r.id, via: "wizard.confirm" });
}
