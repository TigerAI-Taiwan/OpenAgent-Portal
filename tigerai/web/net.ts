// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";

/**
 * web_fetch's network layer. The AI may name any URL (or be steered to one by a page it read), so the rule is: public internet only.
 *
 *  - http / https only; no user:password in the URL.
 *  - Every address the name resolves to is checked AT CONNECT TIME through the socket's own `lookup` (so a DNS answer that changes
 *    between "check" and "connect" cannot slip through), and a literal IP is checked before any socket is opened.
 *  - Blocked: loopback, private (10/8, 172.16/12, 192.168/16), CGNAT 100.64/10, link-local 169.254/16 (cloud metadata), 0.0.0.0/8,
 *    multicast and reserved, IPv6 ::1, ::, fc00::/7, fe80::/10, ff00::/8, and IPv4-mapped forms of all of these.
 *    Unlike the personal-connection check, NO environment switch relaxes this: a school's internal services are exactly what a
 *    student's prompt must not reach.
 *  - Redirects are followed by hand (max 4) and every hop goes through the same checks.
 *  - Time and size caps; the body is cut at the cap (flagged), never buffered whole.
 */

export const FETCH_UA = "OpenAgentPortal-WebFetch/1.0 (AI assistant fetching a page on a user's request; no crawling)";
export const MAX_BYTES = 1_500_000;
/** The whole fetch (every redirect, the slowest drip of a body included) ends by this deadline. */
export const TIMEOUT_MS = 20_000;
/** Fetches running at once over the whole server: a slow site cannot hold more than this many sockets. */
export const MAX_CONCURRENT = 8;
let inflight = 0;
const MAX_REDIRECTS = 4;

function v4(ip: string): number[] | null {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

/** True when the address must never be fetched. Anything that is not a recognisable IP is blocked (fail closed). */
export function addressBlockedForFetch(input: string): boolean {
  let ip = input.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mapped) { const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16); ip = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; }
  ip = ip.replace(/^::ffff:/, "");
  const kind = isIP(ip);
  if (kind === 4) {
    const a = v4(ip);
    if (!a) return true;
    const [x, y] = a;
    return x === 0 || x === 10 || x === 127 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168)
      || (x === 100 && y >= 64 && y <= 127) || (x === 192 && y === 0 && a[2] === 0) || (x === 198 && (y === 18 || y === 19)) || x >= 224;
  }
  if (kind === 6) {
    if (ip === "::" || ip === "::1") return true;
    const first = parseInt(ip.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (ip.startsWith("64:ff9b:") || ip.startsWith("2002:")) return true; // NAT64 / 6to4 can wrap a private v4
    return false;
  }
  return true;
}

let blockedOverride: ((ip: string) => boolean) | null = null;
/** Tests only: lets a loopback test server stand in for "a public site". Never called by product code. */
export function __setBlockedForTests(fn: ((ip: string) => boolean) | null): void { blockedOverride = fn; }
const blocked = (ip: string) => (blockedOverride ? blockedOverride(ip) : addressBlockedForFetch(ip));

export class FetchRefused extends Error {
  constructor(public reason: "scheme" | "address" | "credentials" | "type" | "redirects" | "timeout" | "network" | "status" | "robots", message: string) { super(message); }
}

function checkedLookup(host: string, options: unknown, cb: (...args: unknown[]) => void): void {
  const wantAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
  lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => blocked(a.address))) return cb(new FetchRefused("address", "That address is not public"));
    if (wantAll) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
  });
}

export interface RawResponse { status: number; finalUrl: string; contentType: string; body: Buffer; truncated: boolean; charset: string }

const TEXTUAL = /^(text\/(html|plain|xml)|application\/(xhtml\+xml|xml|json|rss\+xml|atom\+xml)|application\/[a-z.+-]*\+(json|xml))\b/i;

function once(url: URL, o: { maxBytes: number; deadline: number; accept: string; signal?: AbortSignal; anyType: boolean }): Promise<RawResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && blocked(host)) return reject(new FetchRefused("address", "That address is not public"));
    const lib = url.protocol === "https:" ? https : http;
    const left = o.deadline - Date.now();
    if (left <= 0) return reject(new FetchRefused("timeout", "The page took too long"));
    // `timeout` below is only "no data for this long"; a site that sends one byte every few seconds would never trip it. This timer is the real deadline.
    let clear = () => {};
    const req = lib.request(url, {
      method: "GET", lookup: checkedLookup as never, timeout: left,
      headers: { "user-agent": FETCH_UA, accept: o.accept, "accept-encoding": "gzip, deflate, br", "accept-language": "zh-TW,zh;q=0.9,en;q=0.6" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && loc) { res.resume(); return resolve({ status, finalUrl: url.toString(), contentType: "", body: Buffer.alloc(0), truncated: false, charset: "", location: loc }); }
      const ctype = String(res.headers["content-type"] ?? "");
      if (!o.anyType && ctype && !TEXTUAL.test(ctype)) { res.resume(); return reject(new FetchRefused("type", `Not a text page (${ctype.split(";")[0] || "unknown"})`)); }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const stream = enc === "gzip" ? res.pipe(createGunzip()) : enc === "deflate" ? res.pipe(createInflate()) : enc === "br" ? res.pipe(createBrotliDecompress()) : res;
      const chunks: Buffer[] = []; let size = 0; let truncated = false; let done = false;
      const finish = () => { if (done) return; done = true; resolve({ status, finalUrl: url.toString(), contentType: ctype.split(";")[0].trim().toLowerCase(), body: Buffer.concat(chunks), truncated, charset: /charset=([\w-]+)/i.exec(ctype)?.[1]?.toLowerCase() ?? "" }); };
      stream.on("data", (c: Buffer) => {
        if (done) return;
        size += c.length;
        if (size > o.maxBytes) { chunks.push(c.subarray(0, c.length - (size - o.maxBytes))); truncated = true; res.destroy(); finish(); return; }
        chunks.push(c);
      });
      stream.on("end", finish);
      stream.on("error", (e) => { if (!done) { done = true; reject(e); } });
      res.on("close", finish);
    });
    const overall = setTimeout(() => { reject(new FetchRefused("timeout", "The page took too long")); req.destroy(); }, left);
    clear = () => clearTimeout(overall);
    req.on("close", clear);
    req.on("timeout", () => req.destroy(new FetchRefused("timeout", "The page took too long")));
    req.on("error", (e) => reject(e instanceof FetchRefused ? e : (e as { cause?: unknown }).cause instanceof FetchRefused ? (e as { cause: FetchRefused }).cause : new FetchRefused("network", "Could not reach that page")));
    o.signal?.addEventListener("abort", () => req.destroy(new FetchRefused("timeout", "Cancelled")), { once: true });
    req.end();
  });
}

export async function safeGet(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number; accept?: string; signal?: AbortSignal; anyType?: boolean; redirectOk?: (from: URL, to: URL) => boolean } = {}): Promise<RawResponse> {
  const deadline = Date.now() + (opts.timeoutMs ?? TIMEOUT_MS);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new FetchRefused("scheme", "That is not a valid URL"); }
  if (inflight >= MAX_CONCURRENT) throw new FetchRefused("network", "Too many pages are being read at the moment; try again in a moment");
  inflight++;
  try { return await safeGetInner(url, deadline, opts); } finally { inflight--; }
}

async function safeGetInner(first: URL, deadline: number, opts: { maxBytes?: number; accept?: string; signal?: AbortSignal; anyType?: boolean; redirectOk?: (from: URL, to: URL) => boolean }): Promise<RawResponse> {
  let url = first;
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchRefused("scheme", "Only http and https pages can be read");
    if (url.username || url.password) throw new FetchRefused("credentials", "Addresses with a user name or password are refused");
    const r = await once(url, { maxBytes: opts.maxBytes ?? MAX_BYTES, deadline, accept: opts.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", signal: opts.signal, anyType: opts.anyType === true });
    if (r.location) {
      if (hop >= MAX_REDIRECTS) throw new FetchRefused("redirects", "Too many redirects");
      let next: URL;
      try { next = new URL(r.location, url); } catch { throw new FetchRefused("redirects", "Bad redirect"); }
      if (opts.redirectOk && !opts.redirectOk(url, next)) throw new FetchRefused("redirects", "The page redirects to a different site, which is not opened");
      url = next;
      continue;
    }
    return r;
  }
}

// ---------------------------------------------------------------- robots.txt

const ROBOTS = new Map<string, { at: number; text: string | null }>();
export function clearRobotsCache(): void { ROBOTS.clear(); }
const AGENT_TOKEN = "openagentportal";

/** Longest-match Allow/Disallow for our token, else `*`. No file, an error or a timeout = allowed (a user asked for this one page). */
export function robotsAllows(text: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null; let lastWasAgent = false;
  for (const line0 of text.split(/\r?\n/)) {
    const line = line0.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && a.startsWith(AGENT_TOKEN)));
  const pick = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of pick) for (const r of g.rules) {
    if (!r.path) continue;
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

export async function robotsPermits(url: URL): Promise<boolean> {
  const origin = url.origin;
  let hit = ROBOTS.get(origin);
  if (!hit || Date.now() - hit.at > 10 * 60_000) {
    let text: string | null = null;
    try { const r = await safeGet(`${origin}/robots.txt`, { maxBytes: 200_000, timeoutMs: 4000, accept: "text/plain,*/*;q=0.5", anyType: true }); if (r.status === 200) text = r.body.toString("utf8"); } catch { text = null; }
    hit = { at: Date.now(), text }; ROBOTS.set(origin, hit);
  }
  return hit.text === null ? true : robotsAllows(hit.text, url.pathname + url.search);
}

// ---------------------------------------------------------------- HTML to readable text

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", copy: "©", middot: "·", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; } catch { return ""; } }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function decodeBody(body: Buffer, charset: string): string {
  let cs = charset;
  if (!cs) { const m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1")); cs = m?.[1]?.toLowerCase() ?? "utf-8"; }
  try { return new TextDecoder(cs, { fatal: false }).decode(body); } catch { return body.toString("utf8"); }
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim());
  let s = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|footer|aside|head)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, inner: string) => `\n\n## ${inner.replace(/<[^>]+>/g, " ")}\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|table|ul|ol|blockquote|pre|header|main|figure|figcaption)\s*>/gi, "\n\n")
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s).replace(/[ \t 　]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: s };
}
