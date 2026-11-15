"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Browser push for 「AI 做完了」. Asked once, when someone hands an order to an AI (never on page load). Every failure is silent:
// no service worker (dev server, http on a non-localhost address), no VAPID key, permission denied -> the toast, the bell and the
// home list still tell the person. The key pair is upstream's (/api/push/config); the subscription is stored for THIS person only.
function b64(s: string): Uint8Array<ArrayBuffer> {
  const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enableAiPush(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !window.isSecureContext) return false;
    if (Notification.permission === "denied") return false;
    if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return false;
    const cfg = await fetch("/api/push/config");
    if (!cfg.ok) return false;
    const { publicKey } = (await cfg.json()) as { publicKey?: string };
    if (!publicKey) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) }));
    const r = await fetch("/api/tg/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    return r.ok;
  } catch { return false; }
}
