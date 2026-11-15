// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports. A turn-level flag per conversation: "web content (a fetched page, search snippets) was read in this turn". While it is
// set, n8n tools that change or run workflows are refused until the user speaks again (a new turn clears it). Prompt-injection guard
// (security review H3): a page can say "now call execute_workflow"; the user's confirmation is their next message.
const KEY = Symbol.for("tigerai:untrusted-turn");
const flags = (): Map<string, number> => ((globalThis as unknown as Record<symbol, Map<string, number> | undefined>)[KEY] ??= new Map());
export const markUntrusted = (sessionId: string | undefined): void => { if (sessionId) { const m = flags(); m.set(sessionId, Date.now()); if (m.size > 2000) m.delete(m.keys().next().value as string); } };
export const isUntrustedTurn = (sessionId: string | undefined): boolean => !!sessionId && flags().has(sessionId);
export const clearTurn = (sessionId: string | undefined): void => { if (sessionId) flags().delete(sessionId); };
