// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getSettings } from "../settings";
import { COMMON_RULES, checkLines, formatRules, messageLine, parseLines, type Aspect, type Checked } from "../format";
import { factLine } from "../facts";
import { collectFacts, factItems, fmtDay, fmtMdHm, renderSections, shapeSuggestions, supervisors } from "../shared";
import { humanMessages, lastReadSeq } from "../store";
import { dayKey, localDayStart } from "../time";
import { WizardFailure, type DeliverItem, type WizardKind } from "../types";

/**
 * 每日摘要. Reads the channel's human messages since the previous summary (today's only, the first time); with none, it does not run.
 * One model call writes 記錄 / 建議 / 監督 / 稽核 lines from those messages; the program adds the facts it counted itself
 * (broken promises, unanswered questions, late work orders) as 監督 / 提醒 items. See tigerai/docs/API-wizards.md.
 */

const MAX_MESSAGES = 150;
const MAX_PER_ASPECT = 6;

export const daily: WizardKind = {
  id: "daily",
  label: "每日摘要",
  prepare(ctx) {
    const room = ctx.room;
    if (!room) throw new WizardFailure("每日摘要要在頻道裡執行");
    const s = getSettings(room.id);
    const after = lastReadSeq(room.id, "daily");
    const msgs = humanMessages(room.id, { afterSeq: after, sinceTs: after ? 0 : localDayStart(dayKey(ctx.now)), limit: MAX_MESSAGES });
    if (msgs.length === 0) return { skip: "沒有新的訊息可以整理" };
    const on = new Set<Aspect>((["record", "suggest", "supervise", "audit"] as Aspect[]).filter((a) => s.aspects[a]));
    const facts = collectFacts(room, ctx.now, s);
    const lines = [
      `你是頻道「${room.name}」的整理助理。下面是這個頻道 ${fmtDay(msgs[0].ts)} 到 ${fmtDay(msgs[msgs.length - 1].ts)} 的訊息,每則前面有編號。`,
      on.size ? `請依下面格式輸出,一行一則:\n${formatRules(on)}` : "",
      `規則:\n${COMMON_RULES}`,
      `訊息:\n${msgs.map((m) => messageLine(m, fmtMdHm(m.ts))).join("\n")}`,
      facts.length ? `程式已經算出(不用重複,也不要改數字):\n${facts.map(factLine).join("\n")}` : "",
    ].filter(Boolean);
    return { prompt: lines.join("\n\n"), allowed: new Set(msgs.map((m) => m.seq)), fromSeq: msgs[0].seq, toSeq: msgs[msgs.length - 1].seq, data: { count: msgs.length, facts, on } };
  },

  finish(ctx, prepared, reply) {
    const room = ctx.room!;
    const { count, facts } = prepared.data as { count: number; facts: ReturnType<typeof collectFacts>; on: Set<Aspect> };
    const s = getSettings(room.id);
    const modelOn = new Set<Aspect>((["record", "suggest", "supervise", "audit"] as Aspect[]).filter((a) => s.aspects[a]));
    const { items, rejected } = checkLines(parseLines(reply), prepared.allowed, modelOn);
    if (items.length === 0) throw new WizardFailure("AI 的回覆格式不對,或沒有附上訊息出處,這次沒有採用任何內容");

    const by = (a: Aspect): Checked[] => items.filter((i) => i.aspect === a).slice(0, MAX_PER_ASPECT);
    const fromFacts = factItems(room, facts, s);
    const supervise: DeliverItem[] = [...fromFacts.filter((i) => i.aspect === "supervise"),
      ...by("supervise").map((i): DeliverItem => ({ aspect: "supervise", text: i.text, sources: i.sources, to: { users: supervisors(room) } }))];
    const shaped = shapeSuggestions({ roomId: room.id, runnerId: ctx.runner.id, day: dayKey(ctx.now), suggestions: by("suggest"), supervise });

    const out: DeliverItem[] = [
      ...by("record").map((i): DeliverItem => ({ aspect: "record", text: i.text, sources: i.sources, to: "channel" })),
      ...shaped.kept.map((i): DeliverItem => ({ aspect: "suggest", category: i.category, text: i.text, sources: i.sources, to: "channel" })),
      ...supervise,
      ...by("audit").map((i): DeliverItem => ({ aspect: "audit", text: i.text, sources: i.sources, to: { users: supervisors(room) } })),
      ...fromFacts.filter((i) => i.aspect === "remind"),
    ];
    const body = renderSections([
      { aspect: "record", items: out.filter((i) => i.aspect === "record") },
      { aspect: "suggest", items: out.filter((i) => i.aspect === "suggest").map((i) => ({ text: i.text, sources: i.sources, category: i.category })) },
    ]);
    const text = [
      `**每日摘要(AI 草稿,待確認)**　${fmtDay(ctx.now)} · 讀了 ${count} 則訊息`,
      body || "這次沒有可以貼在頻道的記錄。",
      "> AI 只寫草稿與建議;要不要採用,由頻道建立者或主管決定。",
    ].join("\n\n");
    return { post: { text, confirmable: true }, items: out, note: { messages: count, rejected, folded: shaped.folded, droppedSuggestions: shaped.dropped } };
  },
};
