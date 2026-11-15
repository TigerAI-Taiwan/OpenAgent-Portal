"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// What the server says about add-on packages (GET /api/tg/addons) and the page components compiled in for them (addons/ui-index.ts).
// A page component only renders for a menu entry the SERVER announced, so an unlicensed package shows nothing even if its code is in the build.
import { createElement, type ComponentType, type ReactElement } from "react";
import { useEffect, useSyncExternalStore } from "react";
import { ADDON_UI } from "../addons/ui-index";
import type { AddonMenus, AddonView } from "../addons/types";
import type { Item } from "./layout";

let state: AddonView[] | null = null;
let started = false;
const listeners = new Set<() => void>();
const set = (v: AddonView[]) => { state = v; listeners.forEach((l) => l()); };

export function loadAddons(force = false): void {
  if (typeof window === "undefined" || (started && !force)) return;
  started = true;
  void fetch("/api/tg/addons", { cache: "no-store" }).then(async (r) => set(r.ok ? ((await r.json()) as { addons: AddonView[] }).addons : [])).catch(() => set([]));
}
export function useAddons(): AddonView[] | null {
  useEffect(() => { loadAddons(); }, []);
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => null);
}
const EMPTY: Item[] = [];
export function useAddonItems(kind: keyof AddonMenus): Item[] {
  const list = useAddons();
  if (!list) return EMPTY;
  const items = list.flatMap((a) => (a.active ? a.menus[kind] ?? [] : []));
  return items.length === 0 ? EMPTY : items;
}
const announced = (kind: keyof AddonMenus, id: string): string | null => {
  for (const a of state ?? []) if (a.active && (a.menus[kind] ?? []).some((i) => i.id === id)) return a.id;
  return null;
};
export function addonSettingsTab(id: string): ComponentType | null {
  const pkg = announced("settingsTabs", id);
  return (pkg && ADDON_UI.find((u) => u.id === pkg)?.settingsTabs?.[id]) || null;
}
export function addonSkillTab(id: string): ComponentType | null {
  const pkg = announced("skillTabs", id);
  return (pkg && ADDON_UI.find((u) => u.id === pkg)?.skillTabs?.[id]) || null;
}
/** Renders the page a package brought for a menu entry the server announced; nothing for any other id. */
export function AddonTab({ kind, id }: { kind: "settingsTabs" | "skillTabs"; id: string }): ReactElement | null {
  const page = kind === "settingsTabs" ? addonSettingsTab(id) : addonSkillTab(id);
  return page ? createElement(page) : null;
}
/** The 功能 list sections announced by active packages, with the component for each. */
export function useAddonFunctionItems(): Item[] { return useAddonItems("functionSources"); }
export function AddonSection({ id, cwd, close }: { id: string; cwd: string; close: () => void }): ReactElement | null {
  const pkg = announced("functionSources", id);
  const page = pkg ? ADDON_UI.find((u) => u.id === pkg)?.functionSections?.[id] : undefined;
  return page ? createElement(page, { cwd, close }) : null;
}
