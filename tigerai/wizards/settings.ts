// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, type Role } from "../accounts/service";
import { isHeadOfRoom, requireRoom, type RoomRow } from "../rooms/service";
import { fmtHm, parseHm } from "./time";
import type { Aspect } from "./format";

/**
 * Per-channel wizard settings. Three scheduled wizards (每日摘要 / 週報 / SKILL 建議), each switch + time (+ weekday), and the five
 * aspects. Defaults follow the spec: every wizard is OFF until someone who may manage the channel turns it on; once a wizard runs,
 * 記錄 and 建議 are on and 監督, 稽核, 提醒 are off (they are private and only a head or an administrator opts into them).
 *
 * Who may change anything here, run a wizard now, or press 確認 / 採用 / 不需要 on a channel result: the channel's creator, a head of
 * a department that has a member in the channel, and an administrator. Nobody else, including other members of the channel.
 */

export type Wizard = "daily" | "weekly" | "skill";
export const SCHEDULED: Wizard[] = ["daily", "weekly", "skill"];
export const WIZARD_ZH: Record<Wizard | "meeting", string> = { daily: "每日摘要", weekly: "週報", skill: "SKILL 建議", meeting: "會議摘要" };

export interface WizardSetting { enabled: boolean; at: string; /** ISO weekday 1..7; null for a daily wizard */ weekday: number | null }
export interface RoomWizardSettings { daily: WizardSetting; weekly: WizardSetting; skill: WizardSetting; aspects: Record<Aspect, boolean> }

const DEFAULTS: Record<Wizard, WizardSetting> = {
  daily: { enabled: false, at: "18:00", weekday: null },
  weekly: { enabled: false, at: "17:00", weekday: 5 },
  skill: { enabled: false, at: "17:30", weekday: 5 },
};
export const ASPECT_DEFAULTS: Record<Aspect, boolean> = { record: true, suggest: true, supervise: false, audit: false, remind: false };

type Actor = { id: string; role: Role };
interface Row { key: string; enabled: number; at_time: string | null; weekday: number | null }

export function canManageWizards(actor: Actor, room: Pick<RoomRow, "id" | "owner_id">): boolean {
  return actor.role === "admin" || room.owner_id === actor.id || isHeadOfRoom(actor.id, room.id);
}
export function requireManager(actor: Actor, roomId: string): RoomRow {
  const room = requireRoom(actor, roomId); // 404 for someone who cannot even see the channel
  if (room.deleted_at) throw new ServiceError("not_found", "No such room", 404);
  if (!canManageWizards(actor, room)) throw new ServiceError("forbidden", "Only the channel's creator, a department head or an administrator can do this", 403);
  return room;
}

export function getSettings(roomId: string): RoomWizardSettings {
  const rows = getDb().prepare("SELECT key, enabled, at_time, weekday FROM wizard_settings WHERE room_id=?").all(roomId) as unknown as Row[];
  const by = new Map(rows.map((r) => [r.key, r]));
  const one = (w: Wizard): WizardSetting => {
    const r = by.get(w);
    const d = DEFAULTS[w];
    return r ? { enabled: r.enabled === 1, at: r.at_time && parseHm(r.at_time) !== null ? r.at_time : d.at, weekday: d.weekday === null ? null : (r.weekday ?? d.weekday) } : { ...d };
  };
  const aspects = { ...ASPECT_DEFAULTS };
  for (const a of Object.keys(aspects) as Aspect[]) { const r = by.get(`aspect:${a}`); if (r) aspects[a] = r.enabled === 1; }
  return { daily: one("daily"), weekly: one("weekly"), skill: one("skill"), aspects };
}

/** Only the fields present in `input` change. Returns the new settings. */
export function saveSettings(actor: Actor, roomId: string, input: Record<string, unknown>): RoomWizardSettings {
  requireManager(actor, roomId);
  const db = getDb();
  const now = Date.now();
  const changed: string[] = [];
  const put = (key: string, enabled: boolean, at: string | null, weekday: number | null) => {
    db.prepare("INSERT INTO wizard_settings (room_id,key,enabled,at_time,weekday,updated_by,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(room_id,key) DO UPDATE SET enabled=excluded.enabled, at_time=excluded.at_time, weekday=excluded.weekday, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
      .run(roomId, key, enabled ? 1 : 0, at, weekday, actor.id, now);
  };
  const cur = getSettings(roomId);
  for (const w of SCHEDULED) {
    const v = input[w];
    if (v === undefined) continue;
    if (!v || typeof v !== "object") throw new ServiceError("bad_settings", "Settings must be an object");
    const o = v as Record<string, unknown>;
    const next = { ...cur[w] };
    if (o.enabled !== undefined) next.enabled = o.enabled === true;
    if (o.at !== undefined) {
      const m = parseHm(o.at);
      if (m === null) throw new ServiceError("bad_time", "Time must look like 18:00");
      next.at = fmtHm(m);
    }
    if (o.weekday !== undefined && DEFAULTS[w].weekday !== null) {
      const d = Number(o.weekday);
      if (!Number.isInteger(d) || d < 1 || d > 7) throw new ServiceError("bad_time", "Weekday must be 1 (Monday) to 7 (Sunday)");
      next.weekday = d;
    }
    put(w, next.enabled, next.at, next.weekday);
    changed.push(`${w}:${next.enabled ? "on" : "off"}@${next.at}`);
  }
  if (input.aspects !== undefined) {
    if (!input.aspects || typeof input.aspects !== "object") throw new ServiceError("bad_settings", "Settings must be an object");
    for (const [a, v] of Object.entries(input.aspects as Record<string, unknown>)) {
      if (!(a in ASPECT_DEFAULTS)) throw new ServiceError("bad_settings", "Unknown aspect");
      put(`aspect:${a}`, v === true, null, null);
      changed.push(`${a}:${v === true ? "on" : "off"}`);
    }
  }
  if (changed.length) writeAudit("wizard.settings", actor.id, { roomId, changed: changed.join(",") });
  return getSettings(roomId);
}

/** Per person and day cap on suggestions (the spec's default is 5). */
export function suggestCap(): number {
  const env = Number(process.env.TIGERAI_WIZARD_SUGGEST_CAP);
  if (Number.isInteger(env) && env >= 0 && env <= 50) return env;
  const row = getDb().prepare("SELECT value FROM wizard_meta WHERE key='suggest_cap'").get() as { value: string } | undefined;
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : 5;
}
