// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHash } from "node:crypto";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { getOwner } from "../rooms/ownership";
import { userById } from "../accounts/service";
import { listConnections } from "./settings";
import { connLimits, personalKeyEnvName, hostAllowed, isPersonalProvider, personalKey, personalRequired, usablePersonal, type PersonalConn } from "./personal";

/**
 * How one person's connections reach one conversation, and only theirs.
 *
 * Nothing personal is ever written to the global models.json (every conversation and the model picker read that). Instead the
 * conversation of a person gets an inline extension that registers that person's providers into THAT conversation's own model
 * registry through pi's `registerProvider` (probed: a registry built for another conversation does not know them). No extension
 * is created when the conversation has no eligible owner, so a room's assistant, an n8n call, a wizard, a subagent or another
 * person's conversation can never name a personal provider: the model simply is not there.
 *
 * Who is the owner: the person who started it over HTTP (the `/api/agent/new` hook records them under the temporary key) or whom the
 * assignment driver names; for a reopened conversation the owner row, but only for kinds "chat" and "fork" and never room-bound.
 */

export interface PersonalOwner { id: string; role: string }

type Pending = Map<string, { userId: string; at: number }>;
const PENDING = Symbol.for("tigerai:personal-pending-owner");
const pending = (): Pending => ((globalThis as unknown as Record<symbol, Pending | undefined>)[PENDING] ??= new Map());
/** Remember who is starting the conversation known only by its temporary key; forgotten after ten minutes. */
export function registerPendingOwner(tempKey: string, userId: string): void {
  const p = pending();
  const now = Date.now();
  for (const [k, v] of p) if (now - v.at > 10 * 60_000) p.delete(k);
  p.set(tempKey, { userId, at: now });
}

const ROOM_CWD = /[\\/]rooms[\\/][^\\/]+[\\/]?$/;
export function personalOwnerFor(sessionKey: string, cwd?: string): PersonalOwner | null {
  try {
    if (cwd && ROOM_CWD.test(cwd)) return null;
    let userId: string | null = null;
    if (sessionKey.startsWith("__new__")) userId = pending().get(sessionKey)?.userId ?? null;
    else {
      const o = getOwner(sessionKey);
      if (o && !o.room_id && (o.kind === "chat" || o.kind === "fork")) userId = o.user_id;
    }
    if (!userId) return null;
    const u = userById(userId);
    return u && u.status === "active" ? { id: u.id, role: u.role } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- keep personal providers out of upstream's process-wide catalog

/**
 * lib/deferred-provider-models.ts remembers the models of every extension-registered provider in a process-wide map and lists them for
 * everyone. A personal provider must never get in: the map (and the display-name map beside it) is replaced by one that ignores our ids.
 */
class GuardedMap<V> extends Map<string, V> {
  override set(key: string, value: V): this { return isPersonalProvider(key) ? this : super.set(key, value); }
}
export function guardCatalogs(): void {
  const g = globalThis as unknown as Record<string, Map<string, unknown> | undefined>;
  for (const name of ["__piWebProviderModelCatalog", "__piWebProviderNameCatalog"]) {
    const cur = g[name];
    if (cur instanceof GuardedMap) continue;
    const next = new GuardedMap<unknown>();
    for (const [k, v] of cur ?? []) if (!isPersonalProvider(k)) next.set(k, v);
    g[name] = next;
  }
}
// Not called at import: with TIGERAI_ENABLED off nothing of this module may touch the upstream globals (adapter/index.ts init() calls it).

// ---------------------------------------------------------------- registration

const envName = personalKeyEnvName;
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** The provider config for one connection. The key travels as an environment reference, so pi never reads it as a command or a template. */
export function providerConfig(userId: string, c: PersonalConn) {
  const key = personalKey(userId, c.id);
  let apiKey = "not-needed";
  if (key) { process.env[envName(c.id)] = key; apiKey = `$${envName(c.id)}`; } else delete process.env[envName(c.id)];
  return {
    name: `我的 · ${c.name}`,
    baseUrl: c.baseUrl,
    api: "openai-completions" as const,
    apiKey,
    // A generic OpenAI-compatible endpoint: none of the gateway's reasoning switches (they send extra fields strict APIs refuse).
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    // The limits are the person's own (default 16384 answer tokens in 128k): a whole single-file page does not fit in 4096.
    models: c.models.map((id) => { const l = connLimits(c); return { id, name: id, reasoning: l.reasoning, input: ["text" as const], cost: ZERO, contextWindow: l.contextWindow, maxTokens: l.maxTokens }; }),
  };
}

type Registry = { getAll(): { provider: string; id: string }[]; find(p: string, id: string): unknown };
type ProviderApi = { registerProvider: (n: string, c: never) => void; unregisterProvider: (n: string) => void };

/** Registers what is usable now and removes what is not (a connection deleted or switched off while the conversation lives). */
async function syncProviders(pi: ProviderApi, ownerId: string, registered: Map<string, string>): Promise<Set<string>> {
  const usable: PersonalConn[] = [];
  for (const c of usablePersonal(ownerId)) if (await hostAllowed(c.baseUrl)) usable.push(c);
  const want = new Set(usable.map((c) => c.id));
  for (const id of [...registered.keys()]) {
    if (want.has(id)) continue;
    try { pi.unregisterProvider(id); } catch { /* already gone */ }
    registered.delete(id);
    delete process.env[envName(id)];
  }
  for (const c of usable) {
    const cfg = providerConfig(ownerId, c);
    // Register again only when something changed: a re-registration replaces the provider's models under a running conversation.
    const sig = createHash("sha256").update(JSON.stringify([cfg, personalKey(ownerId, c.id) ?? ""])).digest("hex");
    if (registered.get(c.id) === sig) continue;
    pi.registerProvider(c.id, cfg as never);
    registered.set(c.id, sig);
  }
  return want;
}

/** The first public connection's model, for a conversation that must leave a personal model. */
function publicTarget(models: { provider: string; id: string }[]): { provider: string; id: string } | null {
  for (const c of listConnections()) {
    if (!c.enabled) continue;
    const m = (c.defaultModel && models.find((x) => x.provider === c.id && x.id === c.defaultModel)) || models.find((x) => x.provider === c.id);
    if (m) return m;
  }
  return null;
}

export function createPersonalExtension(owner: PersonalOwner): InlineExtension {
  return {
    name: "tigerai-personal-models",
    hidden: true,
    factory: async (pi) => {
      const registered = new Map<string, string>();
      try { await syncProviders(pi as unknown as ProviderApi, owner.id, registered); } catch (e) { console.error("[tigerai] personal models: registration failed:", e instanceof Error ? e.message : e); }
      pi.on("before_agent_start", async (_event, rawCtx) => {
        try {
          const ctx = rawCtx as unknown as { model?: { provider: string; id: string }; modelRegistry: Registry };
          const want = await syncProviders(pi as unknown as ProviderApi, owner.id, registered);
          const cur = ctx.model;
          if (!cur) return;
          const all = ctx.modelRegistry.getAll();
          const mine = usablePersonal(owner.id).filter((c) => want.has(c.id));
          // Leave the current model when it is a personal one that is gone (deleted, switched off, the switch closed),
          // or a public one while the administrator requires own keys and the person has one.
          const leave = (isPersonalProvider(cur.provider) && !want.has(cur.provider)) || (!isPersonalProvider(cur.provider) && personalRequired(owner) && mine.length > 0);
          if (!leave) return;
          let target: { provider: string; id: string } | null = null;
          for (const c of mine) { const m = all.find((x) => x.provider === c.id && c.models.includes(x.id)); if (m) { target = m; break; } }
          if (!target && !personalRequired(owner)) target = publicTarget(all);
          const model = target && ctx.modelRegistry.find(target.provider, target.id);
          if (model) await pi.setModel(model as Parameters<typeof pi.setModel>[0]);
        } catch (e) { console.error("[tigerai] personal models: reconcile failed:", e instanceof Error ? e.message : e); }
      });
    },
  };
}

/** Extensions for a conversation: none unless the conversation has an eligible owner (a person, never a room or an automation). */
export function personalExtensionsFor(sessionKey: string, cwd?: string): InlineExtension[] {
  guardCatalogs();
  const owner = personalOwnerFor(sessionKey, cwd);
  return owner ? [createPersonalExtension(owner)] : [];
}
