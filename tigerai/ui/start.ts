"use client";
/* eslint-disable @next/next/no-location-assign-relative-destination -- full page load on purpose: the fallback opens the app root */
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Start a fresh conversation from an AI role (精靈 / 功能), an n8n app or a skill. Nothing is created here: the pick only prepares
// the fresh conversation (role header on its creation call, hint in its draft). The conversation exists once the first message
// is sent, like any other.
import { parkedNewSessionDraftKey, setDraft } from "@/lib/draft-store";
import { getLastCwd, setPickedRole, startNewChat, waitNewChatReady } from "./store";

// A draft hint for a fresh conversation is parked under the fresh composer's key for that folder (the next fresh composer there
// takes it back). When the page has to reload first it travels through sessionStorage and is parked at module load, before any
// composer mounts. It is never sent.
const PENDING_DRAFT = "tg-pending-draft";
(function takePendingDraft() {
  try {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(PENDING_DRAFT);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_DRAFT);
    const d = JSON.parse(raw) as { cwd?: string; text?: string };
    if (d.cwd && d.text) setDraft(parkedNewSessionDraftKey(d.cwd), { value: d.text, images: [] });
  } catch { /* storage blocked: no hint, nothing else lost */ }
})();

/** `cwd` = the folder of the composer the pick was made from; modals pass nothing and the last folder seen (else the person's own) is used. */
export async function startConversation(role: { id: string; name: string } | null, hint = "", cwd: string | null = null, fallbackCwd: string | null = null): Promise<void> {
  const folder = cwd ?? getLastCwd() ?? fallbackCwd;
  // Right after sign-in the sidebar may not have chosen its folder yet: wait for it, so the pick always opens a fresh conversation.
  const ready = await waitNewChatReady();
  setPickedRole(role);
  if (hint && folder) {
    setDraft(parkedNewSessionDraftKey(folder), { value: hint, images: [] });
    try { sessionStorage.setItem(PENDING_DRAFT, JSON.stringify({ cwd: folder, text: hint })); } catch { /* no hint after a reload */ }
  }
  if (!ready || !startNewChat()) window.location.href = "/";
}
