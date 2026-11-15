"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Who is signed in, fetched once per page load and shared by every slot.
import { useSyncExternalStore } from "react";

export type TgMe = { id: string; name: string; email: string; role: "admin" | "member"; mustChangePassword: boolean; isHead?: boolean; canUserLog?: boolean; homeDir?: string | null; /** how many of their own model connections are usable now */ personalModels?: number; isVendor?: boolean; idleMinutes?: number };
export type MeState = { status: "loading" | "off" | "on"; me: TgMe | null };

let state: MeState = { status: "loading", me: null };
let started = false;
const listeners = new Set<() => void>();
function set(next: MeState) { state = next; listeners.forEach((l) => l()); }

export function loadMe(force = false): void {
  if (typeof window === "undefined" || (started && !force)) return;
  started = true;
  void fetch("/api/tg/me", { cache: "no-store" })
    .then(async (r) => (r.ok ? set({ status: "on", me: (await r.json()) as TgMe }) : set({ status: "off", me: null })))
    .catch(() => set({ status: "off", me: null }));
}
export function getMeState(): MeState { return state; }
const SERVER: MeState = { status: "loading", me: null };
export function useMe(): MeState {
  loadMe();
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => SERVER);
}

/** Resolves once /api/tg/me has answered (signed in or not). */
export function meReady(): Promise<MeState> {
  loadMe();
  if (state.status !== "loading") return Promise.resolve(state);
  return new Promise((resolve) => { const l = () => { if (state.status !== "loading") { listeners.delete(l); resolve(state); } }; listeners.add(l); });
}
