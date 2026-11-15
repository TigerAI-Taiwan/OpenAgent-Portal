// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * Which MCP servers a conversation must (un)register, given what it registered earlier and what its
 * person may use now. A server whose URL, token or tool list changed is registered again: before this,
 * a name already registered was skipped, so editing a server kept the old settings until the wrapper
 * was recreated (10 minutes idle).
 */
export interface WantedMcp { url: string; token: string | null; allow: string[] }

export function mcpSignature(s: WantedMcp): string {
  return JSON.stringify([s.url, s.token, [...s.allow].sort()]);
}

export function planMcpSync(registered: ReadonlyMap<string, string>, wanted: ReadonlyMap<string, WantedMcp>): { unregister: string[]; register: string[] } {
  const unregister = [...registered.keys()].filter((n) => !wanted.has(n));
  const register = [...wanted].filter(([n, s]) => registered.get(n) !== mcpSignature(s)).map(([n]) => n);
  return { unregister, register };
}
