// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getRoom, roomIsOpen } from "../../rooms/service";
import { deliverExternalItem, recordExternalRun } from "../engine";
import { supervisors } from "../shared";

/**
 * The adapter between 會議摘要 and the shared wizard engine. Everything the meeting feature does to the outside world goes
 * through this interface; the default implementation uses the engine (a run row and a confirmable card in the channel, private
 * results in the 公佈欄 個人區 with the bell), and tests may replace it with `setWizardHost()`.
 */
export interface PrivateItem {
  /** Who receives it. */
  userId: string;
  /** 'remind' (提醒: only the person who owes), 'supervise' (監督: supervisors only). */
  kind: "remind" | "supervise";
  title: string;
  body: string;
  /** Sources, as shown to the reader: [{ label: "會議「…」第 3 行", quote: "…" }]. An item without any is refused. */
  sources: { label: string; quote: string }[];
  /** The meeting id: groups the items and the channel draft under one run. */
  refId: string;
}
export interface WizardHost {
  /** Post the AI-marked draft into a room (a card with 確認). Must not throw for a closed room (returns false). */
  postToRoom(roomId: string, text: string, ref: string, by: string | null, confirmable?: boolean): boolean;
  /** Put an item in one person's private area (公佈欄 個人區 + bell). */
  deliverPrivate(item: PrivateItem, roomId: string): void;
  /** Who supervises a room: its creator and the heads of the creator's departments. */
  supervisorsOf(roomId: string): string[];
}

export const defaultHost: WizardHost = {
  postToRoom(roomId, text, ref, by, confirmable = true) {
    const room = getRoom(roomId);
    if (!room || room.closed_at || room.deleted_at || !roomIsOpen(roomId)) return false;
    recordExternalRun({ kind: "meeting", roomId, runnerId: room.owner_id, requestedBy: by, ref, post: { text, confirmable } });
    return true;
  },
  deliverPrivate(item, roomId) {
    const room = getRoom(roomId);
    if (!room) return;
    const run = recordExternalRun({ kind: "meeting", roomId, runnerId: room.owner_id, requestedBy: null, ref: item.refId });
    deliverExternalItem(run, {
      aspect: item.kind, userId: item.userId, text: `${item.title}。${item.body}`,
      sources: item.sources.map((s) => ({ t: "x" as const, label: s.label, quote: s.quote })),
    });
  },
  supervisorsOf(roomId) {
    const room = getRoom(roomId);
    return room ? supervisors(room) : [];
  },
};

let host: WizardHost = defaultHost;
export const wizardHost = (): WizardHost => host;
export function setWizardHost(next: WizardHost | null): void { host = next ?? defaultHost; }
