// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../../db/store";
import { checkLines, messageLine, parseLines } from "../format";
import { fmtMdHm } from "../shared";
import { humanMessages } from "../store";
import { dayKey, localDayStart, weekStartDay } from "../time";
import type { DeliverItem, WizardKind } from "../types";
import { WizardFailure } from "../types";
import { skillSlug, installedSkillNames } from "../skill-writer";

/**
 * SKILL 建議. Once a week it reads the week's channel messages and looks for work that is done again and again with the same steps.
 * The model only proposes; the server keeps a proposal only if it cites at least three different messages (the "three times"
 * rule is counted here, not trusted from the model) and its name is not already taken. The proposal goes to the administrators'
 * 公佈欄 (待我核准). Nothing is installed until an administrator presses 採用 (see decideItem in engine.ts): the AI cannot publish a skill.
 */

export const MIN_REPEATS = 3;
const MAX_PROPOSALS = 3;
const MIN_MESSAGES = 6;

export const skill: WizardKind = {
  id: "skill",
  label: "SKILL 建議",
  prepare(ctx) {
    const room = ctx.room;
    if (!room) throw new WizardFailure("SKILL 建議要在頻道裡執行");
    const since = localDayStart(weekStartDay(dayKey(ctx.now)));
    const msgs = humanMessages(room.id, { sinceTs: since, limit: 300 });
    if (msgs.length < MIN_MESSAGES) return { skip: "這週的訊息太少,看不出重複的做法" };
    const prompt = [
      `你要從頻道「${room.name}」這週的訊息裡,找出「重複在做、步驟固定」的事:同一件事至少出現 ${MIN_REPEATS} 次,做法大致相同。`,
      "找到的每一件事寫成一行,格式:\n技能｜<名稱,十個字內>｜<什麼時候用>｜<步驟一;步驟二;步驟三>｜#編號 #編號 #編號",
      `規則:\n1. 最後一欄要列出至少 ${MIN_REPEATS} 則不同的訊息編號,分別是這件事出現的那幾次。\n2. 步驟用半形分號分開,至少兩步。\n3. 只輸出上面格式的行,不要前言、結語或 Markdown。\n4. 沒有重複出現的事就什麼都不要輸出。不要硬湊。\n5. 使用繁體中文。`,
      `訊息:\n${msgs.map((m) => messageLine(m, fmtMdHm(m.ts), 200)).join("\n")}`,
    ].join("\n\n");
    return { prompt, allowed: new Set(msgs.map((m) => m.seq)), data: { count: msgs.length } };
  },

  finish(ctx, prepared, reply) {
    const room = ctx.room!;
    const { items, rejected } = checkLines(parseLines(reply), prepared.allowed, new Set(["skill"]));
    const taken = new Set([...installedSkillNames(), ...knownProposalSlugs()]);
    const out: DeliverItem[] = [];
    let tooFew = 0; let duplicate = 0;
    for (const i of items) {
      if (!i.skill) continue;
      if (new Set(i.sources.map((s) => (s.t === "m" ? s.seq : -1))).size < MIN_REPEATS) { tooFew++; continue; }
      const slug = skillSlug(i.skill.name);
      if (taken.has(slug)) { duplicate++; continue; }
      taken.add(slug);
      if (out.length >= MAX_PROPOSALS) break;
      out.push({ aspect: "skill", text: i.skill.name, sources: i.sources, to: "admins", extra: { name: i.skill.name, when: i.skill.when, steps: i.skill.steps, slug, roomName: room.name } });
    }
    // No proposal is a normal answer (most weeks nothing repeats), not a failure.
    return { items: out, note: { proposals: out.length, tooFew, duplicate, rejected } };
  },
};

/** Names already proposed in the last 60 days, adopted or waiting; a dismissed one counts too, so the same idea does not come back every week. */
function knownProposalSlugs(): string[] {
  const rows = getDb().prepare("SELECT extra FROM wizard_items WHERE aspect='skill' AND created_at>?").all(Date.now() - 60 * 86_400_000) as unknown as { extra: string | null }[];
  return rows.map((r) => { try { return (JSON.parse(r.extra ?? "{}") as { slug?: string }).slug ?? ""; } catch { return ""; } }).filter(Boolean);
}
