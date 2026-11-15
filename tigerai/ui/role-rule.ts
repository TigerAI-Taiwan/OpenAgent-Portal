// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: loaded directly by the tests. Which request is the creation of a conversation.
export function isAgentCreate(url: string, method: string | undefined): boolean {
  return (method ?? "GET").toUpperCase() === "POST" && /\/api\/agent\/new(\?|$)/.test(url);
}
