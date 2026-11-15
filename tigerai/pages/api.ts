// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { localizeError } from "./i18n";
export async function call<T = Record<string, unknown>>(path: string, method = "GET", data?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(`/api/tg/${path}`, {
    method,
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let json = {} as T & { error?: string };
  try { json = await res.json(); } catch { /* empty body */ }
  const j = json as { error?: unknown; code?: unknown };
  if (!res.ok && typeof j.error === "string") j.error = localizeError(j.code, j.error);
  return { ok: res.ok, status: res.status, data: json };
}
