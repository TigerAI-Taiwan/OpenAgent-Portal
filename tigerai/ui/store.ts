"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// UI state our slots share: which room is open, which settings tab is open, the room list. Deep links:
//   /?room=<id>   /?settings=<tab>   (the old /tg/rooms/<id>, /tg/account ... redirect here)
import { useSyncExternalStore } from "react";

export type UiState = {
  roomId: string | null;
  /** The upstream conversation that was in view when the room opened; a different one closes the room. */
  anchor: string | null;
  settings: { tab: string; create?: boolean } | null;
  /** One of our bottom-row modals (精靈 / 交辦 / 技能) and the tab it is on. Hosted by the top bar, like the settings modal. */
  panel: { id: "agents" | "assignments" | "skills"; tab?: string; focus?: string } | null;
  rooms: RoomRow[];
  roomsLoaded: boolean;
  /** AI role picked in 功能 for the next fresh conversation (applied when that conversation is created). */
  pickedRole: { id: string; name: string } | null;
  /** A ?session= link to a channel's own AI conversation: it is not in the person's list, so the page says so and keeps the input off. */
  roomOnly: { sessionId: string; roomId: string | null } | null;
  /** A message number to scroll to once the open channel has loaded it (a 精靈 source chip was clicked). */
  focusSeq: number | null;
};
export type RoomRow = { id: string; name: string; unread: number; mentioned: number; isMember?: boolean; closed?: boolean; myRole?: string };

let state: UiState = { roomId: null, anchor: null, settings: null, panel: null, rooms: [], roomsLoaded: false, pickedRole: null, roomOnly: null, focusSeq: null };
let inited = false;
const listeners = new Set<() => void>();
function set(patch: Partial<UiState>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }

function init() {
  if (inited || typeof window === "undefined") return;
  inited = true;
  const q = new URLSearchParams(window.location.search);
  const room = q.get("room");
  const tab = q.get("settings");
  if (room) state = { ...state, roomId: room };
  if (tab) state = { ...state, settings: { tab } };
  // A push notification / toast about an AI order links here: open the 交辦 modal on that order (它在「我交辦」).
  const order = q.get("assignment");
  if (order) state = { ...state, panel: { id: "assignments", tab: "mine", focus: order } };
  if (order) setTimeout(() => urlWith("assignment", null), 0);
  const sid = q.get("session");
  if (sid) {
    void fetch(`/api/tg/sessions/${encodeURIComponent(sid)}/info`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) return;
      const j = (await r.json()) as { roomOnly?: boolean; roomId?: string | null };
      if (j.roomOnly === true) set({ roomOnly: { sessionId: sid, roomId: j.roomId ?? null } });
    }).catch(() => undefined);
  }
  try { const r = sessionStorage.getItem("tg-picked-role"); if (r) state = { ...state, pickedRole: JSON.parse(r) }; } catch { /* none */ }
}
/**
 * Upstream toasts 「此對話已不存在」 when a pasted ?session= link is not in the person's list. A room's own conversation is
 * never in anyone's list on purpose and has its own page (「前往頻道」), so for it the toast is wrong. Asks the server;
 * any doubt (module off, request failed) keeps upstream's toast.
 */
export async function shouldToastMissingSession(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return true;
  try {
    const r = await fetch(`/api/tg/sessions/${encodeURIComponent(sessionId)}/info`, { cache: "no-store" });
    if (!r.ok) return true;
    return ((await r.json()) as { roomOnly?: boolean }).roomOnly !== true;
  } catch { return true; }
}
export function clearRoomOnly(): void { if (state.roomOnly) set({ roomOnly: null }); }
export function setPickedRole(role: { id: string; name: string } | null): void {
  set({ pickedRole: role });
  try { if (role) sessionStorage.setItem("tg-picked-role", JSON.stringify(role)); else sessionStorage.removeItem("tg-picked-role"); } catch { /* memory only */ }
}
/** The folder of the composer last shown; 精靈 / 技能 picks made from a modal park their draft hint there. */
let lastCwd: string | null = null;
export function setLastCwd(cwd: string | null): void { if (cwd) lastCwd = cwd; }
export function getLastCwd(): string | null { return lastCwd; }
/** The "+" button registers how to show a fresh conversation without a page load; 功能 picks use it. */
let newChat: (() => void) | null = null;
let newChatReady = false;
/** `ready` = the sidebar has chosen a working folder; before that its "new conversation" does nothing at all. */
export function registerNewChat(fn: (() => void) | null, ready = true): void { newChat = fn; newChatReady = fn !== null && ready; }
export function startNewChat(): boolean { if (!newChat || !newChatReady) return false; closeRoom(); newChat(); return true; }
/**
 * A pick made right after sign-in can arrive before the sidebar has loaded and chosen its folder; "new conversation" then
 * did nothing and the person stayed in whatever conversation the page had opened. Waits until it can really start one.
 */
export async function waitNewChatReady(timeoutMs = 10_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (!(newChat && newChatReady)) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

export function getUi(): UiState { init(); return state; }
const SERVER: UiState = state;
export function useUi(): UiState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getUi, () => SERVER);
}

/** The settings modal sits over the page, so it leaves ?room= alone (closing it returns to the same place). */
function urlWith(key: "room" | "settings" | "assignment", value: string | null) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete(key);
    if (key === "room" && value) u.searchParams.delete("settings");
    if (value) u.searchParams.set(key, value);
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  } catch { /* url is only cosmetic */ }
}
export function openRoom(id: string, anchor: string | null): void { set({ roomId: id, anchor, settings: null }); urlWith("room", id); }
/** Open a channel and scroll to one of its messages (what a 精靈 result's 出處 chip does). */
export function openRoomAt(id: string, seq: number): void { set({ roomId: id, anchor: state.roomId === id ? state.anchor : null, settings: null, focusSeq: seq }); urlWith("room", id); }
export function clearFocusSeq(): void { if (state.focusSeq !== null) set({ focusSeq: null }); }
export function adoptAnchor(anchor: string | null): void { if (state.roomId && state.anchor === null) set({ anchor }); }
export function closeRoom(): void { if (state.roomId) { set({ roomId: null, anchor: null }); urlWith("room", null); } }
export function openSettings(tab: string, create = false): void { set({ settings: { tab, create }, panel: null }); urlWith("settings", tab); }
export function closeSettings(): void { set({ settings: null }); urlWith("settings", null); }
export function openPanel(id: "agents" | "assignments" | "skills", tab?: string, focus?: string): void { set({ panel: { id, tab, ...(focus ? { focus } : {}) }, settings: null }); }
export function closePanel(): void { if (state.panel) set({ panel: null }); }

let loading = false;
export async function refreshRooms(): Promise<void> {
  if (loading || typeof window === "undefined") return;
  loading = true;
  try {
    const r = await fetch("/api/tg/rooms", { cache: "no-store" });
    if (r.ok) {
      // The room in view never shows unread: its own poll marks messages read within a couple of seconds, and until then the
      // list must not flash a count for something the person is looking at.
      const open = state.roomId;
      set({ rooms: ((await r.json()) as { rooms: RoomRow[] }).rooms.map((x) => (x.id === open ? { ...x, unread: 0, mentioned: 0 } : x)), roomsLoaded: true });
    }
  } catch { /* next poll */ } finally { loading = false; }
}
/** Keep the unread count of a room in step with what the person just read, before the next poll. */
export function markRoomRead(id: string): void {
  set({ rooms: state.rooms.map((r) => (r.id === id ? { ...r, unread: 0, mentioned: 0 } : r)) });
}
