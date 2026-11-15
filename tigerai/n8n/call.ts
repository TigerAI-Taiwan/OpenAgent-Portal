// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { rememberMethod, webhookHeader, type Webhook, type WebhookMethod } from "./service";

/**
 * One call of a registered n8n webhook (1.1.2-ce). n8n's Webhook node listens on ONE HTTP method (its default is GET); the Portal used to
 * send only POST, so a workflow built with the default node answered 404 "not registered for POST requests".
 *  - the method is stored with the app (admin form / 上架 form);
 *  - GET carries the payload as query parameters (scalars as they are, objects and arrays as JSON text), POST as a JSON body;
 *  - when n8n still answers 404 with its "not registered for X ... did you mean to make a Y request" message, the call is repeated ONCE
 *    with the method n8n names and that method is stored, so an app registered with the wrong method heals itself.
 */
export interface CallResult { status: number; body: string; method: WebhookMethod; corrected: boolean }

export function buildRequest(url: string, method: WebhookMethod, payload: Record<string, unknown> | undefined, secret: [string, string] | null): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { ...(secret ? { [secret[0]]: secret[1] } : {}) };
  if (method === "GET") {
    const u = new URL(url);
    for (const [k, v] of Object.entries(payload ?? {})) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(k, typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));
    }
    return { url: u.toString(), init: { method: "GET", headers } };
  }
  return { url, init: { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload ?? {}) } };
}

/** The method n8n names in its 404 body, or null. */
export function methodHint(status: number, body: string): WebhookMethod | null {
  if (status !== 404) return null;
  const m = /did you mean to make a (GET|POST) request/i.exec(body) ?? /not registered for (?:GET|POST) requests[^]*?(GET|POST)/i.exec(body);
  return m ? (m[1].toUpperCase() as WebhookMethod) : null;
}

export async function callWebhook(hook: Pick<Webhook, "id" | "url" | "method">, payload: Record<string, unknown> | undefined, signal: AbortSignal, maxChars = 8000): Promise<CallResult> {
  const secret = webhookHeader(hook.id);
  const once = async (method: WebhookMethod) => {
    const r = buildRequest(hook.url, method, payload, secret);
    const res = await fetch(r.url, { ...r.init, signal });
    return { status: res.status, body: (await res.text()).slice(0, maxChars) };
  };
  let method = hook.method;
  let r = await once(method);
  const hint = methodHint(r.status, r.body);
  if (hint && hint !== method) {
    method = hint; r = await once(method);
    if (r.status >= 200 && r.status < 300) { try { rememberMethod(hook.id, method); } catch { /* the call worked; remembering is a convenience */ } }
    return { ...r, method, corrected: true };
  }
  return { ...r, method, corrected: false };
}
