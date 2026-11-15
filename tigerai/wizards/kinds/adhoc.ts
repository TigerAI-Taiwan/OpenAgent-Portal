// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { COMMON_RULES, checkLines, formatRules, messageLine, parseLines, ASPECT_ZH, ASPECTS, type Aspect, type Checked } from "../format";
import { factLine } from "../facts";
import { collectFacts, factItems, fmtDay, fmtMdHm, renderSections, shapeSuggestions, supervisors } from "../shared";
import { deckLinks, makeReport } from "../report";
import { humanMessages } from "../store";
import { dayKey } from "../time";
import { WizardFailure, type DeliverItem, type WizardKind } from "../types";

/**
 * 訊息分析: a run asked for by a person in a channel (the 「訊息分析」 window or `@AI 用監督和提醒看最近三天`), with the five aspects
 * ticked for this one run and a time range. It is the daily summary's engine with other inputs (trigger "manual-adhoc"): results go out
 * exactly as in the scheduled wizards. 記錄 and 建議 are posted in the channel; 監督 and 稽核 go to the channel's heads and creator (and to
 * the asker when the asker is one of them or an administrator) and to nobody else; 提醒 goes to the person who owes it. So asking for
 * 監督 as a plain member shows that member nothing about others. Params are checked again here, whoever built them.
 */

const MAX_MESSAGES = 150;
const MAX_PER_ASPECT = 6;
export interface AdhocParams { aspects: Aspect[]; sinceTs: number; untilTs: number; rangeLabel: string; slides: boolean; requesterId: string; requesterName: string; alsoTo: string[] }
const MODEL_ASPECTS: Aspect[] = ["record", "suggest", "supervise", "audit"];

function paramsOf(raw: Record<string, unknown>): AdhocParams {
  const aspects = (Array.isArray(raw.aspects) ? raw.aspects : []).filter((a): a is Aspect => ASPECTS.includes(a as Aspect));
  if (aspects.length === 0) throw new WizardFailure("沒有選任何面向");
  return { aspects: [...new Set(aspects)], sinceTs: Number(raw.sinceTs) || 0, untilTs: Number(raw.untilTs) || Date.now() + 1, rangeLabel: String(raw.rangeLabel ?? ""), slides: raw.slides === true, requesterId: String(raw.requesterId ?? ""), requesterName: String(raw.requesterName ?? ""), alsoTo: (Array.isArray(raw.alsoTo) ? raw.alsoTo : []).filter((x): x is string => typeof x === "string") };
}

export const adhoc: WizardKind = {
  id: "adhoc",
  label: "訊息分析",
  prepare(ctx) {
    const room = ctx.room;
    if (!room) throw new WizardFailure("訊息分析要在頻道裡執行");
    const p = paramsOf(ctx.params);
    const msgs = humanMessages(room.id, { sinceTs: p.sinceTs, untilTs: p.untilTs, limit: MAX_MESSAGES });
    const on = new Set<Aspect>(p.aspects.filter((a) => MODEL_ASPECTS.includes(a)));
    const facts = collectFacts(room, ctx.now, { aspects: Object.fromEntries(ASPECTS.map((a) => [a, p.aspects.includes(a)])) as Record<Aspect, boolean> });
    const hasFacts = factItems(room, facts, { aspects: Object.fromEntries(ASPECTS.map((a) => [a, p.aspects.includes(a)])) as Record<Aspect, boolean> }).length > 0;
    if (msgs.length === 0 && !hasFacts) return { skip: `${p.rangeLabel}沒有訊息可以分析` };
    if (msgs.length === 0 || on.size === 0) return { prompt: "", noModel: true, allowed: new Set(), data: { count: msgs.length, facts, p } };
    const prompt = [
      `你是頻道「${room.name}」的整理助理。下面是這個頻道 ${fmtDay(msgs[0].ts)} 到 ${fmtDay(msgs[msgs.length - 1].ts)} 的訊息,每則前面有編號。`,
      `請依下面格式輸出,一行一則:\n${formatRules(on)}`,
      `規則:\n${COMMON_RULES}`,
      `訊息:\n${msgs.map((m) => messageLine(m, fmtMdHm(m.ts))).join("\n")}`,
      facts.length ? `程式已經算出(不用重複,也不要改數字):\n${facts.map(factLine).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    return { prompt, allowed: new Set(msgs.map((m) => m.seq)), fromSeq: msgs[0].seq, toSeq: msgs[msgs.length - 1].seq, data: { count: msgs.length, facts, p } };
  },

  async finish(ctx, prepared, reply) {
    const room = ctx.room!;
    const { count, facts, p } = prepared.data as { count: number; facts: ReturnType<typeof collectFacts>; p: AdhocParams };
    const flags = Object.fromEntries(ASPECTS.map((a) => [a, p.aspects.includes(a)])) as Record<Aspect, boolean>;
    const modelOn = new Set<Aspect>(p.aspects.filter((a) => MODEL_ASPECTS.includes(a)));
    const { items, rejected } = prepared.noModel ? { items: [] as Checked[], rejected: undefined } : checkLines(parseLines(reply), prepared.allowed, modelOn);
    const fromFacts = factItems(room, facts, { aspects: flags });
    if (!prepared.noModel && items.length === 0) throw new WizardFailure("AI 的回覆格式不對,或沒有附上訊息出處,這次沒有採用任何內容");
    const by = (a: Aspect): Checked[] => items.filter((i) => i.aspect === a).slice(0, MAX_PER_ASPECT);
    // Who may read 監督 / 稽核: the channel's heads and creator, plus the asker when the asker is allowed to (p.alsoTo is decided by the service from the asker's role).
    const heads = [...new Set([...supervisors(room), ...p.alsoTo])];
    const supervise: DeliverItem[] = [...fromFacts.filter((i) => i.aspect === "supervise").map((i) => ({ ...i, to: { users: heads } })),
      ...by("supervise").map((i): DeliverItem => ({ aspect: "supervise", text: i.text, sources: i.sources, to: { users: heads } }))];
    const shaped = shapeSuggestions({ roomId: room.id, runnerId: ctx.runner.id, day: dayKey(ctx.now), suggestions: by("suggest"), supervise });
    const out: DeliverItem[] = [
      ...by("record").map((i): DeliverItem => ({ aspect: "record", text: i.text, sources: i.sources, to: "channel" })),
      ...shaped.kept.map((i): DeliverItem => ({ aspect: "suggest", category: i.category, text: i.text, sources: i.sources, to: "channel" })),
      ...supervise,
      ...by("audit").map((i): DeliverItem => ({ aspect: "audit", text: i.text, sources: i.sources, to: { users: heads } })),
      ...fromFacts.filter((i) => i.aspect === "remind"),
    ];
    const body = renderSections([
      { aspect: "record", items: out.filter((i) => i.aspect === "record") },
      { aspect: "suggest", items: out.filter((i) => i.aspect === "suggest").map((i) => ({ text: i.text, sources: i.sources, category: i.category })) },
    ]);
    let reportLine = "";
    if (p.slides) {
      const report = await makeReport({ roomId: room.id, roomName: room.name, ownerId: ctx.runner.id, title: `${room.name} 訊息分析 ${p.rangeLabel}`, subtitle: "AI 草稿,待確認", items: out, orders: [], supervisors: heads });
      for (const d of report.privateDecks) out.push({ aspect: "supervise", text: `這次訊息分析的主管版報告已做好:${deckLinks(d.deck)}`, sources: [{ t: "x", label: `訊息分析主管版 ${ctx.run.id}`, quote: room.name }], to: { users: [d.userId] }, extra: { deck: d.deck.id, pdf: d.deck.pdf } });
      reportLine = report.channel ? `**報告投影片**:${deckLinks(report.channel)}${report.channel.note ? `(${report.channel.note})` : ""}` : report.error ? `報告投影片沒有做成:${report.error}` : "";
    }
    const privateOn = p.aspects.filter((a) => a === "supervise" || a === "audit" || a === "remind");
    const text = [
      `**訊息分析(AI 草稿,待確認)**　${p.rangeLabel} · ${p.requesterName || "?"} 要求 · 讀了 ${count} 則訊息 · 面向:${p.aspects.map((a) => ASPECT_ZH[a]).join("、")}`,
      body || "這次沒有可以貼在頻道的記錄。", reportLine,
      privateOn.length ? `> ${privateOn.map((a) => ASPECT_ZH[a]).join("、")}只送給主管或本人,不顯示在頻道。AI 只寫草稿與建議;要不要採用,由頻道建立者或主管決定。` : "> AI 只寫草稿與建議;要不要採用,由頻道建立者或主管決定。",
    ].filter(Boolean).join("\n\n");
    return { post: { text, confirmable: true }, items: out, note: { messages: count, aspects: p.aspects.join(","), range: p.rangeLabel, slides: p.slides, rejected } };
  },
};
