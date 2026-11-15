// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { ASPECTS, ASPECT_ZH, type Aspect } from "./format";

/**
 * 「@AI 用監督和提醒看最近三天」: reading a request for 訊息分析 out of a chat line. Done in code, by keywords, never by the model
 * (a weak local model reads "提醒我明天開會" as a request for the 提醒 aspect; code only treats a line as an analysis request when it
 * has a range word, or an analysis verb together with an aspect word). Pure and synchronous.
 */

export type RangeSpec =
  | { type: "today" } | { type: "days"; n: number } | { type: "week" } | { type: "custom"; from: string; to: string };
export interface AdhocRequest { aspects: Aspect[]; range: RangeSpec | null; slides: boolean; defaultedAspects: boolean }

const NUM: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 十: 10 };
export const DEFAULT_ADHOC_ASPECTS: Aspect[] = ["record", "suggest"];
export const MAX_ADHOC_DAYS = 31;

const VERB = /分析|整理|檢查|盤點|跑一下|看一下|看看|看(?=最近|今天|今日|本週|這週|這周|這一週|近)|用.{0,12}看|摘要|報告/;

export function parseRange(text: string): RangeSpec | null {
  const m = /(?:最近|近|過去)\s*(\d{1,2}|[一二兩两三四五六七十])\s*天/.exec(text) ?? /(\d{1,2}|[一二兩两三四五六七十])\s*天內/.exec(text);
  if (m) { const n = /^\d+$/.test(m[1]) ? +m[1] : NUM[m[1]]; return n >= 1 && n <= MAX_ADHOC_DAYS ? { type: "days", n } : null; }
  if (/本週|這週|這周|這一週|這禮拜|本周|這星期/.test(text)) return { type: "week" };
  if (/今天|今日/.test(text)) return { type: "today" };
  return null;
}

export function parseAspects(text: string): Aspect[] {
  return ASPECTS.filter((a) => text.includes(ASPECT_ZH[a]));
}

/**
 * null = this line is not a request for an analysis (let the plain @AI answer it). Otherwise the request; `range: null` means the
 * person did not say which days, and the caller asks back instead of guessing.
 */
export function parseAdhoc(rawText: string): AdhocRequest | null {
  const text = rawText.replace(/(^|[^\w@])@ai(?![\w-])/gi, "$1").trim();
  if (!text) return null;
  const aspects = parseAspects(text);
  const range = parseRange(text);
  const verb = VERB.test(text);
  if (!((aspects.length && range) || (verb && (aspects.length || range)) || /訊息分析/.test(text))) return null;
  // 「提醒我…」 / 「建議你…」 with no analysis verb and no range is an ordinary sentence.
  if (!verb && !/訊息分析/.test(text) && !range) return null;
  return { aspects: aspects.length ? aspects : [...DEFAULT_ADHOC_ASPECTS], range, slides: /投影片|簡報|報告/.test(text) && /做成|做一份|製作|產生|出一份|投影片|簡報/.test(text), defaultedAspects: aspects.length === 0 };
}
