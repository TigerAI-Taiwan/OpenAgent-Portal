// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { NextResponse } from "next/server";
import { ServiceError, listUsers } from "../accounts/service";
import {
  PERSONAL_PREFIX, addPersonal, deletePersonal, personalRequired, personalSummary, personalSwitches, reorderPersonal, setPersonalSwitches, testPersonal, updatePersonal, usablePersonal, viewPersonal, lastPick, clearPick,
} from "../provider/personal";

/**
 * /api/tg/personal-models (the person's own connections) and /api/tg/model-list (the model picker's list with their 「我的」 group).
 * Every function here is given the SIGNED-IN person's id and never reads a user or connection owner from the URL or the body, so there is
 * no request that can reach another person's connections. Keys are accepted on write and never returned.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const out = (data: unknown, init: ResponseInit = {}) => NextResponse.json(data, { ...init, headers: { ...NO_STORE, ...(init.headers ?? {}) } });
type Actor = { id: string; role: "admin" | "member" };

export async function personalRoutes(_req: Request, method: string, actor: Actor, [b, c]: (string | undefined)[], input: Record<string, unknown>): Promise<Response> {
  if (!b && method === "GET") return out(viewPersonal(actor.id));
  if (!b && method === "POST") return out(await addPersonal(actor.id, input), { status: 201 });
  if (b === "test" && method === "POST") return out(await testPersonal(actor.id, input));
  if (b === "pick" && !c && method === "DELETE") { clearPick(actor.id); return out({ ok: true }); }
  if (b === "reorder" && method === "POST") return out(reorderPersonal(actor.id, input.ids));
  if (b && !c && method === "PATCH") return out(await updatePersonal(actor.id, b, input));
  if (b && !c && method === "DELETE") return out(deletePersonal(actor.id, b));
  throw new ServiceError("not_found", "Not found", 404);
}

/** Administrators: the two switches, and how many connections each person has. */
export async function personalAdminRoutes(_req: Request, method: string, actor: Actor, c: string | undefined, input: Record<string, unknown>): Promise<Response | null> {
  if (!c && method === "GET") {
    const names = new Map(listUsers().map((u) => [u.id, u.name]));
    return out({ switches: personalSwitches(), people: personalSummary().map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? p.userId, count: p.count })) });
  }
  if (!c && method === "PUT") return out({ switches: setPersonalSwitches(actor.id, input) });
  return null;
}

/**
 * GET /api/models for a person who has connections of their own: upstream's own answer, then
 *  - an administrator keeps the public list and gets 「我的 · <name>」 groups appended;
 *  - a member sees ONLY their own connections (the public models are not theirs to pick: the gate refuses a set_model to them).
 * Rewritten here by the proxy gate, so no upstream file changes. Other people's connections can never appear: the list is built from the caller's own.
 */
export async function mergedModelList(req: Request, actor: Actor): Promise<Response> {
  const { GET } = await import("../../app/api/models/route");
  const res = await GET(req);
  if (!res.ok) return res;
  return out(mergeModelList(await res.json() as ModelListData, actor));
}

export interface ModelListData {
  models: Record<string, string>; modelList: { id: string; name: string; provider: string; providerName: string; input?: string[] }[];
  defaultModel: { provider: string; modelId: string } | null; thinkingLevels: Record<string, string[]>; [k: string]: unknown;
}
/** The pure part: upstream's list in, the caller's list out. Only the caller's own connections are ever added. */
export function mergeModelList(data: ModelListData, actor: Actor): ModelListData {
  const mine = usablePersonal(actor.id);
  const extra = mine.flatMap((c) => c.models.map((id) => ({ id, name: id, provider: c.id, providerName: `我的 · ${c.name}`, input: ["text"] })));
  const admin = actor.role === "admin";
  return {
    ...data,
    modelList: [...(admin ? data.modelList.filter((m) => !m.provider.startsWith(PERSONAL_PREFIX)) : []), ...extra],
    models: { ...(admin ? Object.fromEntries(Object.entries(data.models).filter(([k]) => !k.startsWith(PERSONAL_PREFIX))) : {}), ...Object.fromEntries(extra.map((m) => [`${m.provider}:${m.id}`, m.name])) },
    thinkingLevels: { ...(admin ? data.thinkingLevels : {}), ...Object.fromEntries(extra.map((m) => [`${m.provider}:${m.id}`, ["off"]])) },
    // Where the administrator requires own keys, a member's new conversation starts on their first own model.
    defaultModel: lastPick(actor.id) ?? (personalRequired(actor) && extra.length ? { provider: extra[0].provider, modelId: extra[0].id } : data.defaultModel),
  };
}
