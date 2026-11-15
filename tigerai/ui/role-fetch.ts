"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 功能 → AI 角色 prepares a fresh conversation without creating one. Upstream creates the conversation when the first
// message is sent (POST /api/agent/new). This wrapper adds the role header to exactly that call, once, so the role is
// bound at creation and no empty conversation is ever left behind by a pick. Upstream stays untouched.
import { meReady } from "./me";
import { isAgentCommandUrl, translateEngineError } from "./error-translate";
import { quietAnswer } from "./member-quiet";
import { currentLang } from "../pages/i18n";
import { isAgentCreate } from "./role-rule";
import { getUi, setPickedRole } from "./store";

type Marked = typeof fetch & { __tgRole?: true };

export function installRoleFetch(): void {
  if (typeof window === "undefined" || (window.fetch as Marked).__tgRole) return;
  const original = window.fetch.bind(window);
  const wrapped: Marked = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const quiet = quietAnswer(url, init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined));
    if (quiet) {
      const who = await meReady();
      if (who.status === "on" && who.me?.role === "member") return new Response(JSON.stringify(quiet.body), { status: quiet.status, headers: { "Content-Type": "application/json" } });
      return original(input, init);
    }
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined);
    if (isAgentCommandUrl(url, method)) {
      const res = await original(input, init);
      if (res.ok) return res;
      // Engine error texts the product words itself (e.g. "Nothing to compact"): same status and body, only `error` translated.
      try {
        const body = await res.clone().json() as { error?: unknown };
        const text = translateEngineError(body?.error, currentLang());
        if (text) return new Response(JSON.stringify({ ...body, error: text }), { status: res.status, headers: { "Content-Type": "application/json" } });
      } catch { /* not JSON: leave it */ }
      return res;
    }
    const role = getUi().pickedRole;
    const isCreate = role && isAgentCreate(url, method);
    if (!isCreate) return original(input, init);
    const headers = new Headers(init?.headers);
    headers.set("x-agent-role", role.id);
    const res = await original(input, { ...init, headers });
    if (res.ok) setPickedRole(null);
    return res;
  }) as Marked;
  wrapped.__tgRole = true;
  window.fetch = wrapped;
}
installRoleFetch();
