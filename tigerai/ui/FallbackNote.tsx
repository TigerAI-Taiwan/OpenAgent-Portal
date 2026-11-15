"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// One small line under the conversation when the primary model connection did not answer and another one did:
// 「主要連線沒有回應,這次改用「…」的 …」. Text comes from the server (it knows the connection names; members never see the
// connection list itself, only this sentence). Read again when a run ends; it belongs to the latest turn only.
import { useEffect, useState } from "react";
import { api } from "./kit";
import { tr } from "../pages/i18n";

export function FallbackNote({ sessionId, busy }: { sessionId: string | null; busy: boolean }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!sessionId || busy) return;
    let live = true;
    const t = setTimeout(() => {
      void api<{ note: { text: string } | null }>(`sessions/${encodeURIComponent(sessionId)}/fallback`).then((r) => { if (live) setText(r.ok ? r.data.note?.text ?? "" : ""); }).catch(() => { if (live) setText(""); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [sessionId, busy]);
  useEffect(() => { setText(""); }, [sessionId]);
  if (!text) return null;
  return <div data-tg-fallback-note role="status" aria-label={tr("fbNoteLabel")} className="tgx-muted" style={{ fontSize: 12, padding: "2px 12px 6px", textAlign: "center" }}>{text}</div>;
}
