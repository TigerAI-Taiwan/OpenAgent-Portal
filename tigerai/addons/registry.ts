// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { tgEnabled } from "../config";
import { registerWizard } from "../wizards/kind-store";
import { ADDONS } from "./index";
import { readLicense } from "./license";
import type { AddonMenus, AddonModule, AddonRoute, AddonView } from "./types";

/**
 * The runtime side of the add-on mount point. A package is ACTIVE only while all of this holds: it was compiled into the build,
 * TIGERAI_ENABLED=1, a signed licence verifies, has not expired, and lists every feature the package requires. Everything the
 * server asks a package for goes through the functions below, so an inactive package contributes nothing: no route (the router
 * answers 404), no hook, no wizard kind, no pi extension, no menu entry.
 */

const INIT = Symbol.for("tigerai:addon-init");
const inited = (): Set<string> => ((globalThis as unknown as Record<symbol, Set<string> | undefined>)[INIT] ??= new Set());

export interface Status { module: AddonModule; active: boolean; reason: string | null; org: string | null; edition: string | null; expires: string | null; features: string[] }

function statusOf(m: AddonModule, now: number): Status {
  const lic = readLicense(now);
  const base = { module: m, org: null as string | null, edition: null as string | null, expires: null as string | null, features: [] as string[] };
  if (!tgEnabled()) return { ...base, active: false, reason: "disabled" };
  if (!lic.ok) return { ...base, active: false, reason: lic.reason, ...(lic.payload ? { org: lic.payload.org, edition: lic.payload.edition, expires: lic.payload.expires, features: lic.payload.features } : {}) };
  const p = lic.payload;
  const have = { org: p.org, edition: p.edition, expires: p.expires, features: p.features };
  const missing = m.requires.filter((f) => !p.features.includes(f));
  if (missing.length) return { ...base, ...have, active: false, reason: "feature_missing" };
  return { ...base, ...have, active: true, reason: null };
}

/** Packages that are active right now; runs a package's `init()` the first time it is seen active in this process. */
export function activeAddons(now = Date.now()): AddonModule[] {
  const list: AddonModule[] = [];
  for (const m of ADDONS) {
    if (!statusOf(m, now).active) continue;
    const key = `${m.id}:${process.env.TIGERAI_DATA_DIR ?? ""}`;
    if (!inited().has(key)) {
      inited().add(key);
      try {
        m.init?.();
        for (const k of m.wizardKinds ?? []) registerWizard(k);
      } catch (error) {
        inited().delete(key);
        console.error(`[tigerai] add-on ${m.id} failed to start:`, error instanceof Error ? error.message : error);
        continue;
      }
    }
    list.push(m);
  }
  return list;
}

export const isAddonActive = (id: string, now = Date.now()): boolean => activeAddons(now).some((m) => m.id === id);
export const hasAnyAddon = (): boolean => ADDONS.length > 0;

/** For the 顧問包 page and the menus: every compiled-in package with its state. Nothing secret. */
export function addonViews(now = Date.now()): AddonView[] {
  activeAddons(now); // runs init once for newly active ones
  return ADDONS.map((m) => {
    const s = statusOf(m, now);
    return {
      id: m.id, name: m.name, version: m.version, adds: m.adds, installed: true as const, active: s.active, reason: s.reason,
      org: s.org, edition: s.edition, expires: s.expires, features: s.features,
      menus: s.active ? (m.menus ?? {}) : {},
    };
  });
}

export async function addonRoute(kind: "routes" | "adminRoutes", ctx: Parameters<AddonRoute>[0]): Promise<Response | null> {
  for (const m of activeAddons()) {
    const h = m[kind];
    if (!h) continue;
    const r = await h(ctx);
    if (r) return r;
  }
  return null;
}

/** /api/tigerai/hooks/<name>: 404 unless an active package handles it. */
export async function addonHook(name: string, req: Request): Promise<Response> {
  for (const m of activeAddons()) {
    const h = m.hooks?.[name];
    if (h) return h(req);
  }
  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export function addonSessionExtensions(ctx: { sessionId: string; cwd: string }): InlineExtension[] {
  const out: InlineExtension[] = [];
  for (const m of activeAddons()) { try { out.push(...(m.sessionExtensions?.(ctx) ?? [])); } catch (e) { console.error(`[tigerai] add-on ${m.id} extension:`, e instanceof Error ? e.message : e); } }
  return out;
}
export const addonAllowsMcpServer = (name: string): boolean => activeAddons().some((m) => m.allowsMcpServer?.(name) === true);
export type { AddonMenus };
