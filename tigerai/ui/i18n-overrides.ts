// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Uses upstream's own i18n: its locale packs are plain key -> text tables, so the product's wording is applied to them here
// instead of editing upstream files. (1) one term for one thing: upstream zh-TW says 「工作階段」, the product says 「對話」.
// (2) texts that would leak or contradict the product: the brand tooltip (versions of the engine) and the new-conversation
// tooltip (a server path).
import { getLocalePlugin } from "@/lib/i18n/registry";

export const TERM_FIXES: [RegExp, string][] = [[/工作階段/g, "對話"]];
export const OVERRIDES: Record<string, Record<string, string>> = {
  "zh-TW": {
    "sidebar.brandLabel": "OpenAgent Portal",
    "sidebar.newSessionTitle": "新增對話",
    "agentSwitcher.title": "子代理",
    // Cut-off notices (batch v10). Members read this text; administrators get one more sentence from the slot (ui/truncation.tsx).
    "chat.truncatedWithoutAnswer": "AI 想太久，還沒寫出回答就用完這次的輸出額度。請按「繼續」再試一次；常發生的話，請管理員到 設定 → 模型 調高最大輸出。",
    "chat.truncatedByOutputLimit": "回答太長，寫到一半用完這次的輸出額度。請按「繼續」讓 AI 接著寫。",
  },
  en: {
    "sidebar.brandLabel": "OpenAgent Portal",
    "sidebar.newSessionTitle": "New conversation",
    "chat.truncatedWithoutAnswer": "The AI thought for too long and used up this turn's output budget before writing an answer. Press Continue to try again; if it happens often, ask an administrator to raise the maximum output in Settings → Models.",
    "chat.truncatedByOutputLimit": "The answer was too long and used up this turn's output budget halfway. Press Continue to let the AI finish.",
  },
};

export function applyOverrides(messages: Record<string, string>, locale: string): void {
  if (locale === "zh-TW") for (const [k, v] of Object.entries(messages)) { let t = v; for (const [re, to] of TERM_FIXES) t = t.replace(re, to); if (t !== v) messages[k] = t; }
  Object.assign(messages, OVERRIDES[locale] ?? {});
}

let done = false;
export function installI18nOverrides(): void {
  if (done) return;
  done = true;
  for (const id of ["zh-TW", "en"]) {
    const plugin = getLocalePlugin(id);
    if (plugin) { try { applyOverrides(plugin.messages as Record<string, string>, id); } catch { /* read-only pack: keep upstream text */ } }
  }
}
installI18nOverrides();
