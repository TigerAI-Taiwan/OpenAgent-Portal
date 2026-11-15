// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { channelFolder, personFolder, type ChannelSub, type PersonSub } from "../directory/map";
import { dayKey, localParts, wizardZone } from "./time";
import type { RunRow, WizardResult } from "./types";

/**
 * Wizard outputs as Markdown files (1.1.0-ce decision): the channel-visible part of a run goes to the channel's folder
 * (每日摘要 / 工作週報 / 訊息分析), the private parts go to the person's folder (給我的提醒 for 提醒, 給我的監督與稽核 for
 * 監督 and 稽核). The folders come from directory/map.ts (never a path built here) and show up in the 目錄 tree and its HTML
 * reader. The database stays the source of truth for the channel page and the bell: a failed write never fails a run.
 */
const CHANNEL_SUB: Record<string, ChannelSub> = { daily: "每日摘要", weekly: "工作週報", adhoc: "訊息分析" };
const PERSON_SUB: Record<string, PersonSub> = { remind: "給我的提醒", supervise: "給我的監督與稽核", audit: "給我的監督與稽核" };
const ASPECT_ZH: Record<string, string> = { remind: "提醒", supervise: "監督", audit: "稽核" };

const stamp = (ms: number): string => { const p = localParts(ms, wizardZone()); return `${p.day}_${String(p.hh).padStart(2, "0")}${String(p.mm).padStart(2, "0")}`; };
const safe = (s: string): string => s.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 12);

/** The 目錄 node id of a channel file this module wrote (`chan:<room>/<folder>/<file>`), for a link that opens it in the viewer. */
export function channelFileNode(run: RunRow, file: string): string | null {
  const sub = CHANNEL_SUB[run.kind];
  return sub && run.room_id ? `chan:${run.room_id}/${sub}/${basename(file)}` : null;
}

/** Channel part: the posted text plus the items addressed to the whole channel. */
export function writeChannelFile(run: RunRow, roomName: string, result: WizardResult, now = Date.now()): string | null {
  const sub = CHANNEL_SUB[run.kind];
  if (!sub || !run.room_id) return null;
  const channelItems = result.items.filter((i) => i.to === "channel");
  if (!result.post && channelItems.length === 0) return null;
  const lines = [`# ${sub} - ${roomName}`, `> ${dayKey(now)} (${run.trigger === "manual" ? "立即執行" : "排程"})`, ""];
  if (result.post) lines.push(result.post.text.trim(), "");
  // The posted text already lists the channel items (記錄 / 建議); a separate list is only for a run that posted nothing.
  if (!result.post && channelItems.length) { lines.push("## 重點項目", ""); for (const i of channelItems) lines.push(`- ${i.text.trim()}`); lines.push(""); }
  try {
    const file = join(channelFolder(run.room_id, sub), `${stamp(now)}_${safe(run.id)}.md`);
    writeFileSync(file, lines.join("\n"), { mode: 0o600 });
    return file;
  } catch { return null; }
}

/** Private part: one file per person per day and folder, items appended (so a second run the same day adds to it). */
export function writePersonItem(userId: string, aspect: string, text: string, roomName: string | null, now = Date.now()): void {
  const sub = PERSON_SUB[aspect];
  if (!sub) return;
  try {
    const file = join(personFolder(userId, sub), `${dayKey(now)}.md`);
    if (!existsSync(file)) writeFileSync(file, `# ${sub} - ${dayKey(now)}\n\n`, { mode: 0o600 });
    appendFileSync(file, `- [${ASPECT_ZH[aspect] ?? aspect}${roomName ? ` / ${roomName}` : ""}] ${text.trim()}\n`);
  } catch { /* best effort: the bell and the channel page still carry the item */ }
}

export function writePersonItems(run: RunRow, roomName: string | null, result: WizardResult, now = Date.now()): void {
  for (const i of result.items) {
    if (typeof i.to === "string") continue;
    for (const u of new Set(i.to.users)) writePersonItem(u, i.aspect, i.text, roomName, now);
  }
}
