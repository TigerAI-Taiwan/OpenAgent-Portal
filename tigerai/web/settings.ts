// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import { getDb } from "../db/store";
import { KEY_REQUIRED, typedSecret } from "../accounts/secret-dest";

/**
 * 上網查資料 and 文件轉檔服務 settings (community edition). Two files in the data directory, both mode 600:
 *   web-settings.json   switch, provider, address, allowed groups, converter address (no key)
 *   web-search-key      the search API key alone (Brave / Tavily); only its last 4 characters are ever shown
 * Nothing is hard-coded: TIGERAI_WEB_SEARXNG_URL and TIGERAI_CONVERTER_URL are optional INITIAL values only; a saved value wins.
 * The switch defaults to OFF and "which groups" empty means administrators only (an open web is a bigger door than a prompt).
 */

export type Provider = "searxng" | "brave" | "tavily";
export const PROVIDERS: Provider[] = ["searxng", "brave", "tavily"];
export interface WebSettings { enabled: boolean; provider: Provider; searxUrl: string; groupIds: string[]; converterUrl: string }

const settingsFile = () => join(dataDir(), "web-settings.json");
export const keyFile = () => join(dataDir(), "web-search-key");

function atomicWrite(file: string, text: string): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

export function readWebSettings(): WebSettings {
  let raw: Partial<WebSettings> = {};
  try { raw = JSON.parse(readFileSync(settingsFile(), "utf8")) as Partial<WebSettings>; } catch { /* none yet */ }
  return {
    enabled: raw.enabled === true,
    provider: PROVIDERS.includes(raw.provider as Provider) ? (raw.provider as Provider) : "searxng",
    searxUrl: typeof raw.searxUrl === "string" ? raw.searxUrl : (process.env.TIGERAI_WEB_SEARXNG_URL ?? ""),
    groupIds: Array.isArray(raw.groupIds) ? raw.groupIds.filter((x): x is string => typeof x === "string") : [],
    converterUrl: typeof raw.converterUrl === "string" ? raw.converterUrl : (process.env.TIGERAI_CONVERTER_URL ?? ""),
  };
}

export function readSearchKey(): string | null {
  try { const k = readFileSync(keyFile(), "utf8").trim(); return k || null; } catch { return null; }
}

function cleanUrl(v: unknown, allowEmpty = true): string {
  const s = typeof v === "string" ? v.trim().replace(/\/+$/, "") : "";
  if (!s) { if (allowEmpty) return ""; throw new ServiceError("bad_url", "Address is required"); }
  let u: URL;
  try { u = new URL(s); } catch { throw new ServiceError("bad_url", "Address must look like http://host:port"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ServiceError("bad_url", "Address must start with http:// or https://");
  if (u.username || u.password) throw new ServiceError("bad_url", "Do not put a user name or password in the address");
  return u.toString().replace(/\/+$/, "");
}

export function viewWebSettings() {
  const s = readWebSettings();
  const k = readSearchKey();
  return { ...s, hasKey: !!k, keyLast4: k ? k.slice(-4) : null, groups: (getDb().prepare("SELECT id,name FROM groups ORDER BY name").all() as unknown as { id: string; name: string }[]) };
}

export function saveWebSettings(actorId: string, input: Record<string, unknown>) {
  const cur = readWebSettings();
  const next = { ...cur };
  if ("enabled" in input) { if (typeof input.enabled !== "boolean") throw new ServiceError("bad_enabled", "enabled must be true or false"); next.enabled = input.enabled; }
  if ("provider" in input) { if (!PROVIDERS.includes(input.provider as Provider)) throw new ServiceError("bad_provider", "Unknown search provider"); next.provider = input.provider as Provider; }
  if ("searxUrl" in input) next.searxUrl = cleanUrl(input.searxUrl);
  if ("converterUrl" in input) next.converterUrl = cleanUrl(input.converterUrl);
  if ("groupIds" in input) {
    if (!Array.isArray(input.groupIds) || input.groupIds.some((x) => typeof x !== "string")) throw new ServiceError("bad_groups", "groupIds must be a list of ids");
    const known = new Set((getDb().prepare("SELECT id FROM groups").all() as unknown as { id: string }[]).map((g) => g.id));
    next.groupIds = [...new Set(input.groupIds as string[])].filter((g) => known.has(g));
  }
  // The saved search key belongs to the provider it was saved for: switching provider needs the key typed again (or removed).
  if (readSearchKey() && next.provider !== cur.provider && !typedSecret(input.apiKey) && !("apiKey" in input && (input.apiKey === null || input.apiKey === ""))) throw new ServiceError("key_required", KEY_REQUIRED);
  if ("apiKey" in input) {
    if (input.apiKey === null || input.apiKey === "") { try { unlinkSync(keyFile()); } catch { /* none */ } }
    else {
      const key = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      if (key.length < 8 || key.length > 300 || /\s/.test(key)) throw new ServiceError("bad_key", "That does not look like an API key");
      atomicWrite(keyFile(), key + "\n");
    }
  }
  if (next.enabled && next.provider === "searxng" && !next.searxUrl) throw new ServiceError("no_search_url", "Set the SearXNG address before turning it on");
  if (next.enabled && next.provider !== "searxng" && !readSearchKey()) throw new ServiceError("no_search_key", "This provider needs an API key before it can be turned on");
  atomicWrite(settingsFile(), JSON.stringify(next, null, 2));
  // The key itself never goes into the log; whether one is set does.
  writeAudit("web.setting", actorId, { enabled: next.enabled, provider: next.provider, groups: next.groupIds.length, searxUrl: next.searxUrl, converter: next.converterUrl, keyChanged: "apiKey" in input });
  return viewWebSettings();
}

/** May this person use the web tools right now? Server-side; the page only draws what this says. */
export function mayUseWeb(person: { id: string; role: string }): boolean {
  const s = readWebSettings();
  if (!s.enabled) return false;
  if (person.role === "admin") return true;
  if (s.groupIds.length === 0) return false;
  const mine = new Set((getDb().prepare("SELECT group_id FROM memberships WHERE user_id=?").all(person.id) as unknown as { group_id: string }[]).map((r) => r.group_id));
  return s.groupIds.some((g) => mine.has(g));
}
