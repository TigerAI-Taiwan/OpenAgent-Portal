// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { Item } from "../ui/layout";
import type { WizardKind } from "../wizards/types";

/**
 * The shape of an add-on package (see tigerai/docs/ADDON.md). The community edition ships none: `./index.ts` is an empty list.
 * A package is compiled into the image at build time (Next cannot load code it did not bundle) and then only RUNS when a signed
 * licence names it: until then none of its routes, hooks, menus, wizard kinds or session extensions exist for the server.
 */

export type AddonActor = { id: string; role: "admin" | "member" };

export interface AddonRouteContext {
  req: Request;
  method: string;
  actor: AddonActor;
  /** The path after /api/tg/ (or after /api/tg/admin/ for an admin route), split on "/". */
  seg: string[];
  /** The same helpers the built-in routes use: a no-store JSON answer and a validated JSON body. */
  out: (data: unknown, init?: ResponseInit) => Response;
  body: () => Promise<Record<string, unknown>>;
}
/** Return null to say "not mine" (the dispatcher then answers 404). Throw ServiceError for a refusal. */
export type AddonRoute = (ctx: AddonRouteContext) => Promise<Response | null> | Response | null;

export interface AddonMenus {
  /** 設定 › 管理 tabs. The page for each id comes from the client manifest (`ui-index.ts`). */
  settingsTabs?: Item[];
  /** Tabs inside the 技能 modal. */
  skillTabs?: Item[];
  /** Sections of the 功能 list. */
  functionSources?: Item[];
  /** Extra icons in the sidebar footer. */
  sidebar?: Item[];
}

export interface AddonModule {
  id: string;
  name: string;
  version: string;
  /** Licence features that must ALL be listed in the signed licence. */
  requires: string[];
  /** One line each, shown on the 設定 › 管理 › 顧問包 page. */
  adds: string[];
  /** Tables and migrations of the package. Runs once per process, only once the licence has been accepted. */
  init?: () => void;
  menus?: AddonMenus;
  /** Registered with the wizard engine once the package is active. */
  wizardKinds?: WizardKind[];
  /** /api/tg/<...> for everyone signed in (the handler checks permissions itself). */
  routes?: AddonRoute;
  /** /api/tg/admin/<...>: only reached by administrators. */
  adminRoutes?: AddonRoute;
  /** /api/tigerai/hooks/<name>: the two upstream route files forward here. Machine callers; the handler authenticates them. */
  hooks?: Record<string, (req: Request) => Promise<Response>>;
  /** Extra pi extensions for every conversation (the same list `startExtensions` builds). */
  sessionExtensions?: (ctx: { sessionId: string; cwd: string }) => InlineExtension[];
  /** MCP server names (the part between `mcp__` and the tool) that a member's conversation may call. */
  allowsMcpServer?: (name: string) => boolean;
}

/** What the browser is told about each package (no code, no secrets). */
export interface AddonView {
  id: string; name: string; version: string; adds: string[];
  installed: true; active: boolean; reason: string | null;
  org: string | null; edition: string | null; expires: string | null; features: string[];
  menus: AddonMenus;
}
