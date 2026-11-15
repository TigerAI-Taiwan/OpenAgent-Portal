// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getSettings } from "../settings";
import { COMMON_RULES, checkLines, formatRules, messageLine, parseLines, type Aspect, type Checked } from "../format";
import { factLine } from "../facts";
import { collectFacts, factItems, fmtDay, fmtMdHm, renderSections, shapeSuggestions, supervisors } from "../shared";
import { humanMessages, lastReadSeq } from "../store";
import { dayKey, localDayStart } from "../time";
import { WizardFailure, type DeliverItem, type WizardKind } from "../types";

/**
 * 每日摘要. Reads the channel's human messages since the previous summary (today's only, the first time).
 * Default aspects are 記錄 + 提醒 (settings.ts ASPECT_DEFAULTS): the model only writes the 記錄 lines; every 提醒 is made by the program
 * (late or soon-due work orders, promises not kept, questions nobody answered) and goes privately to the person who owes it. Any other
 * aspect the channel's manager ticks is handled as in the weekly report. With no new messages but a reminder to send, the run makes
 * no model call. See tigerai/docs/API-wizards.md.
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
    const on = new Set<Aspect>((["record", "suggest", "supervise", "audit"] as Aspect[]).filter((a) => s.aspects.daily[a]));
    const facts = collectFacts(room, ctx.now, { aspects: s.aspects.daily });
    if (msgs.length === 0 && !(s.aspects.daily.remind && factItems(room, facts, { aspects: s.aspects.daily }).length)) return { skip: "沒有新的訊息可以整理" };
    // Nothing for a model to write (no new messages, or only 提醒 is ticked): the program's own reminders are the whole run.
    if (msgs.length === 0 || on.size === 0) return { prompt: "", noModel: true, allowed: new Set(), data: { count: msgs.length, facts, on } };
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
    const modelOn = new Set<Aspect>((["record", "suggest", "supervise", "audit"] as Aspect[]).filter((a) => s.aspects.daily[a]));
    const { items, rejected } = prepared.noModel ? { items: [] as Checked[], rejected: undefined } : checkLines(parseLines(reply), prepared.allowed, modelOn);
    const fromFacts = factItems(room, facts, { aspects: s.aspects.daily });
    if (!prepared.noModel && items.length === 0) throw new WizardFailure("AI 的回覆格式不對,或沒有附上訊息出處,這次沒有採用任何內容");

    const by = (a: Aspect): Checked[] => items.filter((i) => i.aspect === a).slice(0, MAX_PER_ASPECT);
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
    const reminded = new Set(out.filter((i) => i.aspect === "remind").flatMap((i) => (i.to as { users: string[] }).users)).size;
    const text = prepared.noModel && !body ? "" : [
      `**每日摘要(AI 草稿,待確認)**　${fmtDay(ctx.now)} · 讀了 ${count} 則訊息`,
      body || "這次沒有可以貼在頻道的記錄。",
      reminded ? `提醒已私下送給 ${reminded} 位同事(不顯示在頻道)。` : "",
      "> AI 只寫草稿與建議;要不要採用,由頻道建立者或主管決定。",
    ].filter(Boolean).join("\n\n");
    return { post: text ? { text, confirmable: true } : undefined, items: out, note: { messages: count, rejected, folded: shaped.folded, droppedSuggestions: shaped.dropped } };
  },
};
