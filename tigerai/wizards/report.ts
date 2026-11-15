// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { writeAudit } from "../accounts/audit";
import { buildPptx, type DeckIn, type SlideIn } from "../slides/deck";
import { convertToPdf, converterConfigured } from "../slides/convert";
import { saveDeck, type DeckMeta } from "../slides/store";
import { ASPECT_ZH, CATEGORY_ZH } from "./format";
import { citeInline } from "./shared";
import type { DeliverItem } from "./types";

/**
 * The slide report of a 工作週報 (and of a 訊息分析 when 「做成報告投影片」 is ticked). It is made by the program from the checked items
 * and uses the same pieces as the make_slides tool (buildPptx -> convertToPdf when a 文件轉檔服務 is set up -> saveDeck), but nothing here
 * asks the model for the deck: no model call, no invented slide, every point carries the sources of the item it came from.
 *
 * Two decks, because a deck saved in a channel can be downloaded by every member:
 *  - the channel deck holds only 記錄, 建議 and the work order table (what the channel post may show);
 *  - the private deck holds 監督 and 稽核 and is saved once per head / administrator as a personal deck (only that person can open it).
 * A deck whose PDF could not be made is still delivered as .pptx, with the reason.
 */

export interface OrderBrief { title: string; assignee: string; status: string; due: string | null; late: number }
export interface ReportInput { roomId: string; roomName: string; ownerId: string; title: string; subtitle: string; items: DeliverItem[]; orders: OrderBrief[]; supervisors: string[] }
export interface MadeDeck { id: string; pdf: boolean; note?: string; title: string }
export interface ReportResult { channel: MadeDeck | null; privateDecks: { userId: string; deck: MadeDeck }[]; error?: string }

const point = (i: DeliverItem): string => `${i.category ? `〔${CATEGORY_ZH[i.category] ?? i.category}〕` : ""}${i.text} ${citeInline(i.sources)}`.slice(0, 390);
const of = (items: DeliverItem[], a: DeliverItem["aspect"]) => items.filter((i) => i.aspect === a);
const slideOf = (aspect: DeliverItem["aspect"], items: DeliverItem[]): SlideIn | null => (items.length ? { title: ASPECT_ZH[aspect], points: items.slice(0, 8).map(point) } : null);

/** Pure: the two deck definitions (null = nothing to put in it). Exported for tests. */
export function reportDecks(i: ReportInput): { channel: DeckIn | null; private: DeckIn | null } {
  const records = of(i.items, "record");
  const suggests = of(i.items, "suggest");
  const channelSlides: SlideIn[] = [];
  if (records.length || suggests.length) channelSlides.push({ title: "本週重點", points: [...records, ...suggests].slice(0, 4).map(point) });
  const rec = slideOf("record", records); if (rec) channelSlides.push(rec);
  if (i.orders.length) channelSlides.push({
    title: "交辦單狀態", points: ["出處:交辦單(程式整理)"],
    table: { headers: ["交辦單", "負責人", "狀態", "到期"], rows: i.orders.slice(0, 7).map((o) => [o.title, o.assignee, o.status + (o.late > 0 ? `(逾期 ${o.late} 天)` : ""), o.due ?? "-"]) },
  });
  if (suggests.length) channelSlides.push({ title: "下週建議", points: suggests.slice(0, 6).map(point) });
  const privateSlides = (["supervise", "audit"] as const).map((a) => slideOf(a, of(i.items, a))).filter((s): s is SlideIn => !!s);
  const mk = (slides: SlideIn[], kind: string): DeckIn | null => (slides.length ? { title: `${i.title}${kind}`, subtitle: i.subtitle, slides } : null);
  return { channel: mk(channelSlides, ""), private: mk(privateSlides, "(主管版)") };
}

async function make(roomId: string | null, ownerId: string, deck: DeckIn): Promise<MadeDeck> {
  const pptx = await buildPptx({ ...deck, author: undefined });
  let pdf: Buffer | null = null; let note = "";
  if (!converterConfigured()) note = "沒有設定文件轉檔服務,只做了可編輯的 .pptx。";
  else { try { pdf = await convertToPdf(pptx); } catch (e) { note = `PDF 沒有做成(${e instanceof Error ? e.message : "轉檔失敗"}),可下載 .pptx。`; } }
  const meta: DeckMeta = saveDeck({ roomId, ownerId, title: deck.title, slides: deck.slides.length + 1, pptx, pdf, pdfNote: note || undefined });
  writeAudit("slides.make", ownerId, { deck: meta.id, title: deck.title, room: roomId, slides: meta.slides, pdf: !!pdf, by: "wizard" });
  return { id: meta.id, pdf: !!pdf, note: note || undefined, title: deck.title };
}

/** Makes the decks. Never throws: a report that could not be made is an `error` the caller shows, not a failed run. */
export async function makeReport(i: ReportInput): Promise<ReportResult> {
  const decks = reportDecks(i);
  const out: ReportResult = { channel: null, privateDecks: [] };
  try {
    if (decks.channel) out.channel = await make(i.roomId, i.ownerId, decks.channel);
    if (decks.private) for (const userId of i.supervisors) out.privateDecks.push({ userId, deck: await make(null, userId, decks.private) });
  } catch (e) { out.error = e instanceof Error ? e.message.slice(0, 120) : "unknown"; }
  return out;
}

export const deckLinks = (d: MadeDeck): string =>
  [d.pdf ? `[PDF](/api/tg/slides/${d.id}?format=pdf)` : "", `[PowerPoint](/api/tg/slides/${d.id}?format=pptx)`].filter(Boolean).join("　");
