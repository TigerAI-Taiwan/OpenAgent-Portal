"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { useEffect, useState, type ReactNode } from "react";
import { tr } from "../pages/i18n";
import { api } from "./kit";
import HashPrompts from "./HashPrompts";

/** Same card as the conversation input, but disabled with a reason and an optional button. */
export function DisabledComposer({ reason, actionLabel, onAction, busy }: { reason: string; actionLabel?: string; onAction?: () => void; busy?: boolean }) {
  return (
    <div style={{ padding: "8px 16px 14px", flexShrink: 0 }}>
      <div data-tg-composer-disabled style={{ maxWidth: "var(--chat-content-max-width, 820px)", margin: "0 auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid var(--border)", borderRadius: 16, background: "var(--bg-panel)", padding: "12px 16px", opacity: 0.95 }}>
        <textarea disabled rows={1} aria-label={reason} placeholder={reason} style={{ flex: 1, minWidth: 140, background: "none", border: "none", outline: "none", resize: "none", color: "var(--text-muted)", font: "inherit" }} />
        {actionLabel && onAction && <button type="button" className="tgx-btn primary" disabled={busy} onClick={onAction}>{actionLabel}</button>}
      </div>
    </div>
  );
}

const cache = new Map<string, boolean>();

/** Slot composer.state: the conversation of a room is only usable from the room, so its input starts disabled. */
export function ComposerState({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const [roomOnly, setRoomOnly] = useState<boolean>(sessionId ? cache.get(sessionId) ?? false : false);
  useEffect(() => {
    if (!sessionId) { setRoomOnly(false); return; }
    const known = cache.get(sessionId);
    if (known !== undefined) { setRoomOnly(known); return; }
    let alive = true;
    void api<{ roomOnly: boolean }>(`sessions/${encodeURIComponent(sessionId)}/info`).then((r) => {
      if (!alive) return;
      const v = r.ok && r.data.roomOnly === true;
      cache.set(sessionId, v);
      setRoomOnly(v);
    });
    return () => { alive = false; };
  }, [sessionId]);
  if (roomOnly) return <DisabledComposer reason={tr("roomOnly")} />;
  // `#` calls up prompts (HashPrompts wraps the upstream composer; it never edits it).
  return <HashPrompts>{children}</HashPrompts>;
}
