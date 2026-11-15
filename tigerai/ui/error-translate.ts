// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: loaded directly by the tests. A few upstream error texts reach people as raw English (they come from the engine, not
// from our routes). This is the product's translation layer for them: the page's fetch wrapper (role-fetch.ts) answers a failed
// agent command with the same JSON, only `error` replaced. Unknown texts pass through unchanged, so nothing is hidden.
const RULES: { when: RegExp; zh: string; en: string }[] = [
  // 「壓縮上下文」 on a conversation that has almost nothing in it (engine: "Nothing to compact (session too small)").
  { when: /^Nothing to compact/i, zh: "對話還很短,不需要壓縮。", en: "The conversation is still short; there is nothing to compact." },
  // Own model connections (gate.ts): the id is somebody else's, or the conversation belongs to someone using their own key.
  { when: /^personal_forbidden/i, zh: "這組模型連線不是你的,不能使用。", en: "That model connection is not yours." },
  { when: /^personal_session/i, zh: "這段對話的主人使用自己的模型連線,不能代為送出訊息。", en: "This conversation's owner uses their own model connection; you cannot send into it." },
  { when: /^personal_key_required/i, zh: "管理員要求使用自己的 API 金鑰才能對話,請先到「設定」→「帳號」新增「我的模型連線」。", en: "The administrator requires your own API key: add one under Settings > Account > My model connections." },
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
