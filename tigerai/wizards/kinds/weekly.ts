// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../../db/store";
import { getSettings } from "../settings";
import { COMMON_RULES, checkLines, formatRules, parseLines, type Aspect, type Checked } from "../format";
import { factLine, type Source } from "../facts";
import { collectFacts, factItems, fmtDay, renderSections, shapeSuggestions, supervisors } from "../shared";
import { dayKey, localDayStart, weekStartDay, addDays, calendarDays } from "../time";
import { WizardFailure, type DeliverItem, type RunRow, type WizardKind } from "../types";
import type { ItemRow } from "../store";

/**
 * 週報. Reads this week's finished 每日摘要 of the channel (confirmed or not; the prompt says which) and the work orders linked to the
 * channel's own conversation, and writes a draft for the channel. What the channel sees is 記錄 and 建議 plus the work order table
 * (counted by the program). 監督, 稽核 and 提醒 are routed privately like every other run: a post in the channel is read by every member,
 * and those three aspects are not for every member.
 */

const MAX_PER_ASPECT = 6;
interface OrderLine { id: string; title: string; assignee: string; status: string; due: string | null; late: number }

export const weekly: WizardKind = {
  id: "weekly",
  label: "週報",
  prepare(ctx) {
    const room = ctx.room;
    if (!room) throw new WizardFailure("週報要在頻道裡執行");
    const today = dayKey(ctx.now);
    const monday = weekStartDay(today);
    const since = localDayStart(monday);
    const db = getDb();
    const dailies = db.prepare("SELECT * FROM wizard_runs WHERE room_id=? AND kind='daily' AND status='done' AND created_at>=? ORDER BY created_at").all(room.id, since) as unknown as RunRow[];
    const orders = linkedOrders(room.id, ctx.now);
    if (dailies.length === 0 && orders.length === 0) return { skip: "這週沒有每日摘要或交辦單可以整理" };

    const allowed = new Set<number>();
    const blocks: string[] = [];
    for (const r of dailies) {
      const items = db.prepare("SELECT * FROM wizard_items WHERE run_id=? AND recipient_id IS NULL AND aspect IN ('record','suggest') ORDER BY created_at, rowid").all(r.id) as unknown as ItemRow[];
      const lines = items.map((i) => {
        const seqs = (JSON.parse(i.sources) as Source[]).filter((s): s is Extract<Source, { t: "m" }> => s.t === "m").map((s) => s.seq);
        seqs.forEach((n) => allowed.add(n));
        return `- ${i.aspect === "record" ? "記錄" : "建議"}:${i.text} ${seqs.map((n) => `#${n}`).join(" ")}`;
      });
      blocks.push(`【${fmtDay(r.created_at)} 每日摘要,${r.confirm_state === "confirmed" ? "已確認" : "尚未確認(內容僅供參考)"}】\n${lines.join("\n") || "- (沒有項目)"}`);
    }
    const s = getSettings(room.id);
    const on = new Set<Aspect>((["record", "suggest", "supervise", "audit"] as Aspect[]).filter((a) => s.aspects[a]));
    const facts = collectFacts(room, ctx.now, s);
    const prompt = [
      `你是頻道「${room.name}」的週報整理助理。下面是這週(${monday} 起)的每日摘要;請整理成這週的重點。`,
      on.size ? `請依下面格式輸出,一行一則:\n${formatRules(on)}` : "",
      `規則:\n${COMMON_RULES}`,
      blocks.length ? `每日摘要:\n${blocks.join("\n\n")}` : "這週沒有每日摘要。",
      orders.length ? `這週與頻道有關的交辦單(程式整理,不用重複):\n${orders.map((o) => `- ${o.title}(${o.assignee},${o.status}${o.late > 0 ? `,逾期 ${o.late} 天` : ""})`).join("\n")}` : "",
      facts.length ? `程式已經算出(不用重複,也不要改數字):\n${facts.map(factLine).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    if (allowed.size === 0) {
      // Only work orders this week: there is nothing a line could cite, so the report is the program's table alone.
      return { prompt: "", noModel: true, allowed, data: { dailies: dailies.length, unconfirmed: dailies.filter((r) => r.confirm_state !== "confirmed").length, orders, facts, monday, tableOnly: true } };
    }
    return { prompt, allowed, data: { dailies: dailies.length, unconfirmed: dailies.filter((r) => r.confirm_state !== "confirmed").length, orders, facts, monday, tableOnly: false } };
  },

  finish(ctx, prepared, reply) {
    const room = ctx.room!;
    const d = prepared.data as { dailies: number; unconfirmed: number; orders: OrderLine[]; facts: ReturnType<typeof collectFacts>; monday: string; tableOnly: boolean };
    const s = getSettings(room.id);
    const modelOn = new Set<Aspect>((["record", "suggest", "supervise", "audit"] as Aspect[]).filter((a) => s.aspects[a]));
    const checked = d.tableOnly ? { items: [] as Checked[], rejected: undefined } : checkLines(parseLines(reply), prepared.allowed, modelOn);
    if (!d.tableOnly && checked.items.length === 0) throw new WizardFailure("AI 的回覆格式不對,或沒有附上訊息出處,這次沒有採用任何內容");
    const by = (a: Aspect) => checked.items.filter((i) => i.aspect === a).slice(0, MAX_PER_ASPECT);
    const heads = supervisors(room);
    const fromFacts = factItems(room, d.facts, s);
    const supervise: DeliverItem[] = [...fromFacts.filter((i) => i.aspect === "supervise"), ...by("supervise").map((i): DeliverItem => ({ aspect: "supervise", text: i.text, sources: i.sources, to: { users: heads } }))];
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
    const table = d.orders.length
      ? ["### 交辦單狀態(程式整理)", ...d.orders.map((o) => `- ${o.title}　${o.assignee}　${o.status}${o.due ? `　到期 ${o.due}` : ""}${o.late > 0 ? `　逾期 ${o.late} 天` : ""}　〔交辦單〕`)].join("\n")
      : "";
    const text = [
      `**週報(AI 草稿,待確認)**　${d.monday.replace(/-/g, "/")} 起這一週`,
      `這週共讀了 ${d.dailies} 份每日摘要${d.unconfirmed ? `,其中 ${d.unconfirmed} 份還沒有人確認(內容僅供參考)` : ""}。`,
      body, table,
      "> 監督、稽核、提醒只送給主管或本人,不顯示在頻道。AI 只寫草稿與建議;要不要採用,由頻道建立者或主管決定。",
    ].filter(Boolean).join("\n\n");
    // The work orders are sources too: 提醒 about them already travelled as facts; the table cites them.
    return { post: { text, confirmable: true }, items: out, note: { dailies: d.dailies, unconfirmed: d.unconfirmed, orders: d.orders.length, rejected: checked.rejected } };
  },
};

/**
 * Work orders that belong to the channel: linked to its own AI conversation (the channel's or one of its AI roles').
 * Work orders are private to whoever handed them over and whoever got them; only the ones somebody tied to the channel are quoted in it.
 */
function linkedOrders(roomId: string, now: number): OrderLine[] {
  const db = getDb();
  const sessions = [
    (db.prepare("SELECT bound_session_id AS s FROM rooms WHERE id=?").get(roomId) as { s: string | null } | undefined)?.s,
    ...(db.prepare("SELECT session_id AS s FROM room_assistants WHERE room_id=?").all(roomId) as unknown as { s: string }[]).map((r) => r.s),
  ].filter((x): x is string => !!x);
  if (sessions.length === 0) return [];
  const rows = db.prepare(
    `SELECT a.id, a.title, a.status, a.due_date AS due, COALESCE(u.name,'?') AS assignee FROM assignments a LEFT JOIN users u ON u.id=a.assignee_id
     WHERE a.session_id IN (${sessions.map(() => "?").join(",")}) AND (a.status IN ('open','accepted') OR a.updated_at>=?) ORDER BY a.created_at`,
  ).all(...sessions, now - 7 * 86_400_000) as unknown as { id: string; title: string; status: string; due: number | null; assignee: string }[];
  const today = dayKey(now);
  const zh: Record<string, string> = { open: "待接受", accepted: "進行中", done: "已完成", returned: "已退回" };
  return rows.map((r) => {
    const due = r.due ? new Date(r.due).toISOString().slice(0, 10) : null;
    const late = due && (r.status === "open" || r.status === "accepted") ? Math.max(0, calendarDays(due, today)) : 0;
    return { id: r.id, title: r.title, assignee: r.assignee, status: zh[r.status] ?? r.status, due: due ? due.replace(/-/g, "/") : null, late };
  });
}
void addDays;
