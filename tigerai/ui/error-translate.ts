// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: loaded directly by the tests. A few upstream error texts reach people as raw English (they come from the engine, not
// from our routes). This is the product's translation layer for them: the page's fetch wrapper (role-fetch.ts) answers a failed
// agent command with the same JSON, only `error` replaced. Unknown texts pass through unchanged, so nothing is hidden.
const RULES: { when: RegExp; zh: string; en: string }[] = [
  // 「壓縮上下文」 on a conversation that has almost nothing in it (engine: "Nothing to compact (session too small)").
  { when: /^Nothing to compact/i, zh: "對話還很短,不需要壓縮。", en: "The conversation is still short; there is nothing to compact." },
];

/** The text to show instead of the engine's, or null to keep it. */
export function translateEngineError(text: unknown, lang: "zh" | "en"): string | null {
  if (typeof text !== "string") return null;
  const rule = RULES.find((r) => r.when.test(text.trim()));
  return rule ? rule[lang] : null;
}

/** Only agent command posts (/api/agent/<id>) are rewritten. */
export function isAgentCommandUrl(url: string, method: string | undefined): boolean {
  if ((method ?? "GET").toUpperCase() !== "POST") return false;
  const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
  return /^\/api\/agent\/[^/]+$/.test(path) && path !== "/api/agent/new";
}
