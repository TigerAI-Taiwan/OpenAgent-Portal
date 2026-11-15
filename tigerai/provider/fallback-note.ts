// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { FALLBACK_ENTRY_TYPE, noticeText, type FallbackRecord } from "./fallback-logic";
import { listConnections } from "./settings";

/**
 * The one small line under a conversation: "主要連線沒有回應,這次改用「…」的 …". It is read from the conversation's own log, so it
 * survives a reload, and it is only shown for the latest turn: a record after the last user message, or one written just before it (after the previous answer).
 */
export function noteFromEntries(entries: readonly unknown[]): { text: string; kind: string } | null {
  let lastUser = -1; let assistantBefore = -1; let lastAssistant = -1; let lastRec = -1; let rec: Partial<FallbackRecord> | null = null;
  entries.forEach((raw, i) => {
    const e = raw as { type?: string; customType?: string; message?: { role?: string }; data?: unknown };
    if (e?.type === "message" && e.message?.role === "assistant") lastAssistant = i;
    if (e?.type === "message" && e.message?.role === "user") { lastUser = i; assistantBefore = lastAssistant; }
    if (e?.type === "custom" && e.customType === FALLBACK_ENTRY_TYPE) { lastRec = i; rec = e.data as Partial<FallbackRecord>; }
  });
  const r = rec as Partial<FallbackRecord> | null;
  // A record written before the turn's own user message (the pre-send step-off) still belongs to that turn: it comes after the previous answer.
  if (!r || lastRec <= assistantBefore || !r.from || !r.kind || r.kind === "restore") return null;
  const list = listConnections();
  const nameOf = (p: string) => list.find((c) => c.id === p)?.name ?? p;
  return { kind: r.kind, text: noticeText({ kind: r.kind, from: r.from, to: r.to ?? null }, nameOf, list.find((c) => c.enabled)?.id ?? list[0]?.id ?? null) };
}

export async function fallbackNote(sessionId: string): Promise<{ text: string; kind: string } | null> {
  const reader = await import("../../lib/session-reader");
  const file = await reader.resolveSessionPath(sessionId);
  if (!file) return null;
  return noteFromEntries(reader.getSessionEntries(file));
}
