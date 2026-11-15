"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Under the two "the answer was cut off" notices: 「繼續」 for everyone, 「壓縮上下文」 for administrators only.
// 繼續 goes through the conversation's own send function (handed over by SenderBridge, slot chat.sender), so permissions,
// run ids and the event stream behave exactly as when the person types the sentence themselves.
import { useEffect, useState } from "react";
import { tr } from "../pages/i18n";
import { LATCH_FALLBACK_MS, continueText, latchStep, truncationView, type Latch } from "./truncation-logic";

export type Sender = { send: (text: string) => unknown; busy: boolean };
const senders = new Map<string, Sender>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Slot chat.sender: renders nothing, keeps this conversation's send function and busy flag where the notice can reach them. */
export function SenderBridge({ sessionId, send, busy }: { sessionId: string | null; send: Sender["send"]; busy: boolean }) {
  useEffect(() => {
    if (!sessionId) return;
    senders.set(sessionId, { send, busy });
    notify();
    return () => { if (senders.get(sessionId)?.send === send) { senders.delete(sessionId); notify(); } };
  }, [sessionId, send, busy]);
  return null;
}

function useSender(sessionId: string | null): Sender | null {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return sessionId ? senders.get(sessionId) ?? null : null;
}

export function TruncationActions({ unanswered, sessionId, streaming, canCompact, onCompact, compacting, admin }: {
  unanswered: boolean; sessionId: string | null; streaming: boolean; canCompact: boolean; onCompact: () => void; compacting: boolean; admin: boolean;
}) {
  const sender = useSender(sessionId);
  const [latch, setLatch] = useState<Latch>({ sent: false, ran: false });
  const sent = latch.sent;
  const busy = streaming || !sender || sender.busy;
  const v = truncationView({ unanswered, admin, canCompact, busy });
  // Pressed once greys the button while its run goes; when that run has ended the button is live again for the next cut-off.
  useEffect(() => { setLatch((l) => latchStep(l, busy)); }, [busy, sent]);
  useEffect(() => {
    if (!sent || latch.ran) return;
    const t = setTimeout(() => setLatch({ sent: false, ran: false }), LATCH_FALLBACK_MS); // the send never started a run
    return () => clearTimeout(t);
  }, [sent, latch.ran]);
  const btn: React.CSSProperties = { padding: "3px 10px", border: "1px solid currentColor", borderRadius: 999, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" };
  return (
    <div data-tg-truncation style={{ marginTop: 8 }}>
      {v.showAdminExtra && <div data-tg-trunc-admin style={{ marginBottom: 8 }}>{tr("truncAdminExtra")}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {v.showContinue && (
          <button type="button" data-tg-continue style={{ ...btn, fontWeight: 600, ...(sent ? { opacity: 0.5, cursor: "default" } : {}) }} disabled={sent}
            onClick={() => { setLatch({ sent: true, ran: false }); void Promise.resolve(sender!.send(continueText(unanswered))); }}>{tr("continueBtn")}</button>)}
        {v.showCompact && (
          <button type="button" data-tg-compact style={{ ...btn, ...(compacting ? { cursor: "default", opacity: 0.6 } : {}) }} disabled={compacting} onClick={() => onCompact()}>{compacting ? tr("compacting") : tr("compactCtx")}</button>)}
      </div>
    </div>
  );
}
