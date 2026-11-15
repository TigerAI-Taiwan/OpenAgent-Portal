"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 閒置自動登出, the page's half (accounts/idle.ts is the server's): real input is reported at most once a minute, and the page signs
// itself out after the configured minutes without any. Background polling never counts. Mounted by the toolbar.right slot.
import { useEffect } from "react";
import { useMe } from "./me";

const REPORT_EVERY_MS = 60_000;
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove", "scroll"] as const;

export function IdleWatcher() {
  const { me } = useMe();
  const minutes = me?.idleMinutes ?? 0;
  useEffect(() => {
    if (!me || minutes <= 0) return;
    let last = Date.now(); let reported = 0;
    const on = () => {
      last = Date.now();
      if (last - reported >= REPORT_EVERY_MS) { reported = last; void fetch("/api/tg/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined); }
    };
    for (const e of EVENTS) window.addEventListener(e, on, { passive: true, capture: true });
    const timer = window.setInterval(() => {
      if (Date.now() - last < minutes * 60_000) return;
      void fetch("/api/tg/logout", { method: "POST" }).catch(() => undefined).finally(() => window.location.replace("/tg/login?idle=1"));
    }, 10_000);
    const visible = () => { if (document.visibilityState === "visible" && Date.now() - last >= minutes * 60_000) window.location.replace("/tg/login?idle=1"); };
    document.addEventListener("visibilitychange", visible);
    return () => { for (const e of EVENTS) window.removeEventListener(e, on, { capture: true }); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [me, minutes]);
  return null;
}
