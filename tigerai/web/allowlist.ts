// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports. web_fetch may only open (a) an address that appears in a person's own message in the same conversation, or (b) one that
// web_search returned in the same conversation. Anything else a page or a channel message tells the AI to open is refused: a stranger's
// text cannot make the Portal fetch an address of the stranger's choosing (security review M3). Redirects stay on the same site.

/** Addresses in free text: http(s) up to a space or a closing bracket/quote; trailing punctuation (including full-width) is not part of it. */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  // ASCII URL characters only: a Chinese sentence glued to an address ends the address. A closing ")" belongs to it only when a "(" opened inside it.
  for (const m of text.matchAll(/https?:\/\/[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]+/gi)) {
    let u = m[0];
    for (;;) {
      const t = u.replace(/[.,;:!?'*]+$/, "");
      const unbalanced = t.endsWith(")") && (t.match(/\)/g)?.length ?? 0) > (t.match(/\(/g)?.length ?? 0);
      const next = unbalanced ? t.slice(0, -1) : t;
      if (next === u) break;
      u = next;
    }
    out.push(u);
  }
  return out;
}

/** Comparison form: scheme-insensitive, host lower-case, no fragment, no trailing slash. Null when it is not an address. */
export function normalizeUrl(raw: string): string | null {
  try { const u = new URL(raw.trim()); if (u.protocol !== "http:" && u.protocol !== "https:") return null; u.hash = ""; return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`; } catch { return null; }
}

// Second-level public suffixes common in this product's markets; not the whole public-suffix list (a heuristic, and it errs towards stricter).
const SLD = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "idv"]);
/** example.com / example.com.tw / example.co.uk for www.example.com.tw etc. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(h) || h.includes(":")) return h; // an IP address is its own site
  const p = h.split(".");
  if (p.length <= 2) return h;
  const last2 = p[p.length - 2];
  return SLD.has(last2) && p[p.length - 1].length === 2 ? p.slice(-3).join(".") : p.slice(-2).join(".");
}
export const sameSite = (a: string, b: string): boolean => registrableDomain(a) === registrableDomain(b);

const KEY = Symbol.for("tigerai:web-search-urls");
const searched = (): Map<string, Set<string>> => ((globalThis as unknown as Record<symbol, Map<string, Set<string>> | undefined>)[KEY] ??= new Map());
/** Remember the addresses a web_search returned for this conversation. */
export function recordSearchResults(sessionId: string | undefined, urls: string[]): void {
  if (!sessionId) return;
  const m = searched();
  const set = m.get(sessionId) ?? new Set<string>();
  for (const u of urls) { const n = normalizeUrl(u); if (n) set.add(n); }
  m.delete(sessionId); m.set(sessionId, set); // most recent last
  if (m.size > 500) m.delete(m.keys().next().value as string);
}

/** The text of the user messages in a session's entries (what the pi session manager returns). */
export function userTexts(entries: unknown[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const msg = (e as { type?: string; message?: { role?: string; content?: unknown } })?.type === "message" ? (e as { message: { role?: string; content?: unknown } }).message : null;
    if (!msg || msg.role !== "user") continue;
    if (typeof msg.content === "string") out.push(msg.content);
    else if (Array.isArray(msg.content)) for (const b of msg.content as { type?: string; text?: string }[]) if (b?.type === "text" && typeof b.text === "string") out.push(b.text);
  }
  return out;
}

export interface FetchScope { allowed(url: string): boolean }
/** The scope of one conversation: its user messages (read now, so a pasted address counts at once) plus what its searches returned. */
export function scopeFor(sessionId: string | undefined, entries: () => unknown[]): FetchScope {
  return {
    allowed(url: string): boolean {
      const n = normalizeUrl(url);
      if (!n) return false;
      if (sessionId && searched().get(sessionId)?.has(n)) return true;
      let texts: string[] = [];
      try { texts = userTexts(entries()); } catch { texts = []; }
      return texts.some((t) => extractUrls(t).some((u) => normalizeUrl(u) === n));
    },
  };
}
export const NOT_ALLOWED_MESSAGE = "只能讀你貼的網址或搜尋結果裡的網址";
