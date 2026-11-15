"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 公佈欄 / 提醒泡泡 state shared by the bubble, the modal and the home screen: which tab is open and the summary the bubble shows.
// One poller (about every 15 s while the tab is visible, plus right after any action) feeds all of them.
import { useSyncExternalStore } from "react";
import { tr } from "../pages/i18n";

export type BulletinTab = "personal" | "public" | "mine" | "all";
export type UrgentItem = { kind: "assignment" | "ack" | "approval" | "wizard"; id: string; title: string; due: number | null; overdue: boolean };
export type UnreadHead = { id: string; title: string; authorName: string; pinned: boolean; requireAck: boolean; createdAt: number };
export type Summary = {
  count: number; overdue: boolean; parts: { assignments: number; acks: number; approvals: number; wizards?: number };
  urgent: UrgentItem[]; unread: { count: number; latest: UnreadHead[] }; canPost: boolean;
  /** AI orders I handed out that stopped and wait for me (待確認), and how many are still working (the page then polls faster). */
  aiReview: { id: string; title: string; note: string | null }[]; aiRunning: number;
};
export type Toast = { key: string; id: string; text: string };
type State = { open: { tab: BulletinTab; announcementId?: string; compose?: boolean } | null; summary: Summary | null; toasts: Toast[] };

let state: State = { open: null, summary: null, toasts: [] };
let seenReview: Set<string> | null = null;
const listeners = new Set<() => void>();
function set(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }

export const POLL_MS = 15_000;
/** While an AI order of mine is working the bell looks every 5 s, so 「AI 做完了」 shows within a few seconds without a reload. */
export const POLL_FAST_MS = 5_000;
export function dismissToast(key: string): void { set({ toasts: state.toasts.filter((t) => t.key !== key) }); }
/** Which AI orders are newly 待確認 since the last look? The first look only records what is already waiting (those are in the home list). */
export function toastsFor(next: Summary["aiReview"], seen: Set<string> | null): { fresh: Toast[]; seen: Set<string> } {
  const now = new Set(next.map((o) => o.id));
  if (seen === null) return { fresh: [], seen: now };
  const fresh = next.filter((o) => !seen.has(o.id)).map((o) => ({ key: `${o.id}:${Date.now()}`, id: o.id, text: toastText(o) }));
  return { fresh, seen: now };
}
function toastText(o: { title: string; note: string | null }): string {
  const n = o.note ?? "";
  return tr(n.startsWith("執行失敗") ? "asToastError" : n.includes("重新啟動") ? "asToastRestart" : "asToastDone", { title: o.title });
}
let loading = false;
export async function refreshSummary(): Promise<void> {
  if (loading || typeof window === "undefined") return;
  loading = true;
  try {
    const r = await fetch(`/api/tg/bulletin/summary?tzo=${new Date().getTimezoneOffset()}`, { cache: "no-store" });
    if (r.ok) {
      const summary = (await r.json()) as Summary;
      const t = toastsFor(summary.aiReview ?? [], seenReview);
      seenReview = t.seen;
      set({ summary, ...(t.fresh.length ? { toasts: [...state.toasts, ...t.fresh] } : {}) });
      if (users > 0 && timer) schedule(); // the pace may have changed (an AI order started or finished)
    }
  } catch { /* next poll */ } finally { loading = false; }
}

let users = 0; let timer: ReturnType<typeof setTimeout> | null = null; let onVisible: (() => void) | null = null;
function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => { if (document.visibilityState === "visible") await refreshSummary(); if (users > 0) schedule(); }, (state.summary?.aiRunning ?? 0) > 0 ? POLL_FAST_MS : POLL_MS);
}
/** Reference-counted: both top-bar call sites (desktop / phone) and the home screen may ask; only one timer runs. */
export function startPolling(): () => void {
  users += 1;
  if (users === 1 && typeof window !== "undefined") {
    void refreshSummary().then(schedule);
    onVisible = () => { if (document.visibilityState === "visible") void refreshSummary(); };
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    users -= 1;
    if (users === 0) { if (timer) clearTimeout(timer); timer = null; if (onVisible) document.removeEventListener("visibilitychange", onVisible); onVisible = null; }
  };
}

export function openBulletin(tab: BulletinTab = "personal", extra: { announcementId?: string; compose?: boolean } = {}): void { set({ open: { tab, ...extra } }); void refreshSummary(); }
export function closeBulletin(): void { set({ open: null }); void refreshSummary(); }
export function useBulletin(): State {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => state);
}
