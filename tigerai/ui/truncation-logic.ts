// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// What the cut-off notice offers, as plain data so it is testable without rendering.
import { tr } from "../pages/i18n";

/** The follow-up sentence 繼續 sends: one per notice (text cut off / no answer at all). */
export function continueText(unanswered: boolean): string {
  return tr(unanswered ? "continueNoAnswerPrompt" : "continueCutPrompt");
}

export interface TruncationView { showContinue: boolean; showCompact: boolean; showAdminExtra: boolean }

/** 繼續: everyone, hidden while a run is going (or before the send function is known). 壓縮上下文 and the extra sentence: administrators, no-answer notice only. */
export function truncationView(a: { unanswered: boolean; admin: boolean; canCompact: boolean; busy: boolean }): TruncationView {
  return { showContinue: !a.busy, showCompact: a.unanswered && a.admin && a.canCompact, showAdminExtra: a.unanswered && a.admin };
}

/**
 * The 繼續 button greys out once pressed so a double click sends one sentence. It must not stay grey for ever: when the run it started
 * has ended, the next cut-off shows a live button again. `ran` = that run has been seen busy; the button frees itself when it ends.
 * If no run is ever seen (the send failed before starting) the component frees it after a few seconds (see LATCH_FALLBACK_MS).
 */
export interface Latch { sent: boolean; ran: boolean }
export const LATCH_FALLBACK_MS = 8000;
export function latchStep(l: Latch, busy: boolean): Latch {
  if (!l.sent) return l;
  if (busy) return l.ran ? l : { sent: true, ran: true };
  return l.ran ? { sent: false, ran: false } : l;
}
