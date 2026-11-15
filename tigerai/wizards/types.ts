// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { RoomRow } from "../rooms/service";
import type { UserRow } from "../accounts/service";
import type { Aspect, Category } from "./format";
import type { Source } from "./facts";

/**
 * The generic wizard contract. A wizard KIND (daily, weekly, skill, meeting ...) is two functions; everything around them
 * (the run record, the shared AI slot, the model call, posting into the channel, routing results to the right person,
 * 確認 / 採用 / 不需要, audit, failure display and rerun) belongs to the engine (engine.ts) and is the same for every kind.
 * See tigerai/docs/API-wizards.md for how to add one.
 */

export interface RunRow {
  id: string; kind: string; room_id: string | null; runner_id: string; requested_by: string | null; trigger: "schedule" | "manual";
  period: string | null; status: "running" | "done" | "failed" | "skipped"; error: string | null; created_at: number; started_at: number | null; finished_at: number | null;
  from_seq: number | null; to_seq: number | null; post_seq: number | null; draft: string | null; input: string | null;
  confirm_state: "draft" | "confirmed" | null; confirmed_by: string | null; confirmed_at: number | null;
}

export interface RunContext {
  run: RunRow;
  /** null for a wizard that is not tied to a channel (a meeting summary started from the wizard list). */
  room: RoomRow | null;
  /** The person the wizard runs as (the channel's creator): never more than that person may do. */
  runner: UserRow;
  now: number;
  /** Per-run parameters given to startWizardRun (a transcript, an upload id ...). Plain JSON, kept on the run row. */
  params: Record<string, unknown>;
}

export type Prepared =
  | { skip: string }
  | {
    prompt: string;
    /** True when the program alone has everything to say: the engine then makes no model call and passes an empty reply to `finish`. */
    noModel?: boolean;
    /** Message numbers (#n) the prompt contained; a line citing none of them is dropped. */
    allowed: ReadonlySet<number>;
    fromSeq?: number; toSeq?: number;
    /** Whatever `finish` needs again (kept in memory only). */
    data?: unknown;
  };

/** Who gets an item: the channel (everyone in it), administrators (a proposal), or named people (private). */
export type Audience = "channel" | "admins" | { users: string[] };
export interface DeliverItem {
  aspect: Aspect | "skill"; category?: Category; text: string; sources: Source[]; to: Audience;
  extra?: Record<string, unknown>;
}
export interface WizardResult {
  /** Markdown that becomes the channel message (and the stored draft). Omit to post nothing. */
  post?: { text: string; confirmable: boolean };
  items: DeliverItem[];
  /** Short note for the audit entry (counts only, never text). */
  note?: Record<string, unknown>;
}

export interface WizardKind {
  id: string;
  /** Chinese name shown on cards and in the audit log. */
  label: string;
  /** Collect the facts, decide whether there is anything to do, build the prompt. Cheap and database-only: no model call. */
  prepare(ctx: RunContext): Prepared | Promise<Prepared>;
  /** Check the model's reply and turn it into a result. Throw WizardFailure to fail the run with a message people can read. */
  finish(ctx: RunContext, prepared: Exclude<Prepared, { skip: string }>, reply: string): WizardResult | Promise<WizardResult>;
}

/** A failure whose text is meant for people ("AI 回覆的內容沒有帶出處"). Any other error is shown as a cleaned, short message. */
export class WizardFailure extends Error {}

export interface SourceView { t: "m" | "a" | "x"; seq?: number; id?: string; quote?: string; roomId: string | null; label: string }
export interface ItemView {
  id: string; runId: string; roomId: string | null; roomName: string | null; aspect: string; aspectZh: string; category: string | null; text: string;
  sources: SourceView[]; state: string; createdAt: number; extra: Record<string, unknown> | null;
}
export interface RunView {
  id: string; kind: string; kindZh: string; roomId: string | null; status: RunRow["status"]; error: string | null; trigger: string; period: string | null;
  createdAt: number; finishedAt: number | null; postSeq: number | null; confirmState: RunRow["confirm_state"]; confirmedByName: string | null; confirmedAt: number | null;
}
