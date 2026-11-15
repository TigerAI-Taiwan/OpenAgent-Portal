// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { dataDir, workspaceRoot } from "../config";
import { getDb, inTransaction } from "../db/store";
import { ServiceError, userById } from "./service";
import { writeAudit } from "./audit";
import { isVendor } from "./vendor";
import { listPersonal, personalKeyEnvName } from "../provider/personal";

/**
 * 永久刪除一位成員的個人資料 (1.1.0-ce). Everything about it is deliberately narrow and slow:
 *  - an administrator only (never the maintenance account), for a DISABLED account, never yourself;
 *  - step 1 lists what will be deleted (preview), step 2 needs the person's e-mail typed exactly (the server compares it);
 *  - deletes: the account, the personal folder, conversations, personal model keys, filled forms, registration request, meetings,
 *    personal roles and prompts, notices and activity trail. Messages they wrote in channels stay but read 「（已刪除的成員）」 with the
 *    content removed. Organisation records that are not "their data" (交辦單, 公告, 核可單) stay and no longer show a name.
 *  - the audit trail is append-only (a trigger). It keeps ONE row: 「管理員 X 於某時刻刪除一位成員(編號 n)」, and the identifying
 *    fields (user id, e-mail, name) in earlier rows about that person are scrubbed. The scrub is the only code that ever updates
 *    the audit table: inside one transaction it drops the trigger, rewrites only actor_id/extra of the matching rows, and puts the
 *    trigger back (DDL is transactional in SQLite, so a failure restores it); afterwards the trigger's presence is verified.
 */
export const DELETED_ID = "deleted-member";
export const DELETED_TEXT = "（內容已刪除）";

export interface PurgeDeps { deleteSession(sessionId: string): Promise<boolean> }
export const defaultDeps: PurgeDeps = {
  async deleteSession(sessionId) {
    const { resolveSessionPath, invalidateSessionPathCache, invalidateSessionManagerCache } = await import("../../lib/session-reader");
    const path = await resolveSessionPath(sessionId);
    if (!path) return false;
    rmSync(path, { force: true });
    try { invalidateSessionManagerCache(path); invalidateSessionPathCache(sessionId); } catch { /* caches only */ }
    return true;
  },
};

type Actor = { id: string; role: "admin" | "member" };
const q = (sql: string, ...a: (string | number)[]) => getDb().prepare(sql).all(...a) as unknown as Record<string, unknown>[];
const n = (sql: string, ...a: (string | number)[]) => Number((getDb().prepare(sql).get(...a) as { n: number }).n);
const tableExists = (name: string) => !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

function target(actor: Actor, userId: string) {
  if (actor.role !== "admin" || !userById(actor.id) || isVendor(actor.id)) throw new ServiceError("forbidden", "Administrator only", 403);
  const u = userById(userId);
  if (!u) throw new ServiceError("not_found", "No such user", 404);
  if (u.id === actor.id) throw new ServiceError("self", "You cannot delete yourself", 409);
  if (isVendor(userId)) throw new ServiceError("vendor_fixed", "The maintenance account can only be disabled", 403);
  if (u.status !== "disabled") throw new ServiceError("not_disabled", "Disable the account first; only a disabled account can be deleted", 409);
  return u;
}

const inside = (child: string, parent: string): boolean => { const c = resolve(child), p = resolve(parent); return c.startsWith(p.endsWith(sep) ? p : p + sep); };
function countFiles(dir: string): number {
  let total = 0;
  try { for (const e of readdirSync(dir, { withFileTypes: true })) total += e.isDirectory() ? countFiles(join(dir, e.name)) : 1; } catch { /* unreadable */ }
  return total;
}
// leaver.json (the 離職 marker the org branch writes next to the keys) is bookkeeping, not a key the person stored.
function countKeys(dir: string): number { try { return readdirSync(dir).filter((f) => f.startsWith("key-")).length; } catch { return 0; } }
const personalFolder = (dirName: string) => join(workspaceRoot(), "users", dirName);
const keysFolder = (userId: string) => join(dataDir(), "personal-models", userId);

const meetingsRoot = () => join(dataDir(), "meetings");
const slidesFolder = (userId: string) => join(dataDir(), "slides-personal", userId);
const promptCache = (userId: string) => join(dataDir(), "prompt-cache", userId);
const ownedMeetings = (id: string): string[] => (tableExists("meetings") ? (q("SELECT id FROM meetings WHERE owner_id=?", id) as { id: string }[]).map((r) => r.id) : []);
const pendingUploads = (id: string): string[] => (tableExists("meeting_uploads") ? (q("SELECT id FROM meeting_uploads WHERE user_id=?", id) as { id: string }[]).map((r) => r.id) : []);
/** Every file the person's meetings own on disk: the transcript, the audio, partial uploads. */
const meetingFiles = (id: string): number => ownedMeetings(id).reduce((t, m) => t + (existsSync(join(meetingsRoot(), m)) ? countFiles(join(meetingsRoot(), m)) : 0), 0)
  + pendingUploads(id).filter((u) => existsSync(join(meetingsRoot(), "_uploads", `${u}.part`))).length;
/** Decks made in a channel stay with the channel, but their owner field names the person: it is blanked. */
function channelDecksOf(id: string): string[] {
  const out: string[] = [];
  try {
    for (const r of q("SELECT id FROM rooms") as { id: string }[]) {
      const base = join(workspaceRoot(), "rooms", r.id, "slides");
      if (!existsSync(base)) continue;
      for (const d of readdirSync(base)) { const f = join(base, d, "meta.json"); try { if ((JSON.parse(readFileSync(f, "utf8")) as { ownerId?: string }).ownerId === id) out.push(f); } catch { /* not a deck */ } }
    }
  } catch { /* no rooms yet */ }
  return out;
}

export interface PurgePreview { person: { id: string; name: string; email: string }; items: { key: string; label: string; count: number }[]; kept: { label: string; count: number }[] }

export function preview(actor: Actor, userId: string): PurgePreview {
  const u = target(actor, userId);
  const id = u.id;
  const items = [
    { key: "account", label: "帳號(姓名、電子郵件、登入資料)", count: 1 },
    { key: "folder", label: "個人目錄裡的檔案", count: existsSync(personalFolder(u.dir_name)) ? countFiles(personalFolder(u.dir_name)) : 0 },
    { key: "conversations", label: "和 AI 的對話", count: n("SELECT COUNT(*) AS n FROM session_owner WHERE user_id=? AND room_id IS NULL", id) },
    { key: "keys", label: "個人模型連線與金鑰", count: existsSync(keysFolder(id)) ? countKeys(keysFolder(id)) : 0 },
    { key: "forms", label: "填好的表單", count: tableExists("tg_form_outputs") ? n("SELECT COUNT(*) AS n FROM tg_form_outputs WHERE owner_id=?", id) : 0 },
    { key: "requests", label: "註冊申請", count: n("SELECT COUNT(*) AS n FROM registration_requests WHERE user_id=?", id) },
    { key: "meetings", label: "會議紀錄(逐字稿、摘要、錄音檔與上傳紀錄)", count: tableExists("meetings") ? n("SELECT COUNT(*) AS n FROM meetings WHERE owner_id=?", id) + n("SELECT COUNT(*) AS n FROM meeting_uploads WHERE user_id=?", id) : 0 },
    { key: "meeting_files", label: "會議的逐字稿與錄音檔案", count: meetingFiles(id) },
    { key: "slides", label: "個人簡報檔(個人對話裡做的 pptx/pdf)", count: existsSync(slidesFolder(id)) ? countFiles(slidesFolder(id)) : 0 },
    { key: "channel_decks", label: "頻道簡報上記的製作人(簡報留在頻道,只清除製作人)", count: channelDecksOf(id).length },
    { key: "caches", label: "快取與暫存(提示詞快取、記憶體中的個人金鑰)", count: (existsSync(promptCache(id)) ? countFiles(promptCache(id)) : 0) + (existsSync(keysFolder(id)) ? listPersonal(id).length : 0) },
    { key: "handovers", label: "交接與接手紀錄", count: n("SELECT COUNT(*) AS n FROM handovers WHERE leaver_id=? OR successor_id=?", id, id) + n("SELECT COUNT(*) AS n FROM handover_reads WHERE leaver_id=? OR successor_id=?", id, id) },
    { key: "roles", label: "個人 AI 角色與提示詞", count: n("SELECT COUNT(*) AS n FROM personal_agents WHERE owner_id=?", id) + n("SELECT COUNT(*) AS n FROM prompts WHERE owner_id=?", id) },
    { key: "messages", label: "頻道發言(留下,改顯示「（已刪除的成員）」,內容刪除)", count: n("SELECT COUNT(*) AS n FROM room_messages WHERE author_id=?", id) },
    { key: "audit", label: "稽核紀錄裡能認出這個人的欄位(清除識別資料,只留一筆「刪除了一位成員」)", count: n("SELECT COUNT(*) AS n FROM audit WHERE actor_id=? OR instr(COALESCE(extra,''), ?) > 0 OR instr(COALESCE(extra,''), ?) > 0", id, id, u.email) },
  ];
  const kept = [
    { label: "交辦單(留下,不再顯示姓名)", count: n("SELECT COUNT(*) AS n FROM assignments WHERE applicant_id=? OR assignee_id=?", id, id) },
    { label: "公告(留下)", count: n("SELECT COUNT(*) AS n FROM announcements WHERE author_id=?", id) },
    { label: "核可單(留下)", count: n("SELECT COUNT(*) AS n FROM work_orders WHERE applicant_id=? OR approver_id=?", id, id) },
  ];
  return { person: { id, name: u.name, email: u.email }, items, kept };
}

/** Scrub identifying fields from earlier audit rows. The ONLY code path that updates the append-only audit table. */
export function scrubAudit(userId: string, email: string, name: string): number {
  const db = getDb();
  const rows = q("SELECT id, actor_id, extra FROM audit WHERE actor_id=? OR instr(COALESCE(extra,''), ?) > 0 OR instr(COALESCE(extra,''), ?) > 0 OR (instr(COALESCE(extra,''), ?) > 0 AND length(?) >= 2)", userId, userId, email, name, name) as { id: number; actor_id: string | null; extra: string | null }[];
  const clean = (v: unknown, key = ""): unknown => {
    if (typeof v === "string") {
      if (v === userId) return DELETED_ID;
      let t = v;
      if (t.includes(email)) t = t.split(email).join("（已刪除的成員）");
      if (/name/i.test(key) && t === name) t = "（已刪除的成員）";
      return t;
    }
    if (Array.isArray(v)) return v.map((x) => clean(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, k)]));
    return v;
  };
  const triggerSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='audit_no_update'").get() as { sql: string } | undefined)?.sql;
  if (!triggerSql) throw new ServiceError("audit_guard_missing", "The audit guard is missing; refusing to touch the audit trail", 500);
  let changed = 0;
  inTransaction(() => {
    db.exec("DROP TRIGGER audit_no_update");
    const upd = db.prepare("UPDATE audit SET actor_id=?, extra=? WHERE id=?");
    for (const r of rows) {
      let extra = r.extra;
      if (extra) { try { extra = JSON.stringify(clean(JSON.parse(extra))); } catch { extra = extra.split(userId).join(DELETED_ID).split(email).join("（已刪除的成員）"); } }
      upd.run(r.actor_id === userId ? DELETED_ID : r.actor_id, extra, r.id);
      changed++;
    }
    db.exec(triggerSql);
  });
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='audit_no_update'").get()) { db.exec(triggerSql); throw new ServiceError("audit_guard_missing", "The audit guard was restored after a failure", 500); }
  return changed;
}

export async function purge(actor: Actor, userId: string, confirmEmail: unknown, deps: PurgeDeps = defaultDeps): Promise<{ number: number }> {
  const u = target(actor, userId);
  if (String(confirmEmail ?? "").trim().toLowerCase() !== u.email.toLowerCase()) throw new ServiceError("confirm_mismatch", "Type the person's e-mail exactly to confirm", 400);
  const id = u.id;
  // Conversations first (files outside the database): a failure here leaves the account in place so the step can be repeated.
  const sessions = q("SELECT session_id FROM session_owner WHERE user_id=? AND room_id IS NULL", id) as { session_id: string }[];
  for (const s of sessions) await deps.deleteSession(s.session_id);
  const folder = personalFolder(u.dir_name);
  if (existsSync(folder) && inside(folder, join(workspaceRoot(), "users"))) rmSync(folder, { recursive: true, force: true });
  // Meetings: transcripts, audio, half-finished uploads (the rows go in the transaction below).
  for (const m of ownedMeetings(id)) { const d = join(meetingsRoot(), m); if (inside(d, meetingsRoot())) rmSync(d, { recursive: true, force: true }); }
  for (const up of pendingUploads(id)) { const f = join(meetingsRoot(), "_uploads", `${up}.part`); if (inside(f, meetingsRoot())) rmSync(f, { force: true }); }
  // Made-slides, prompt cache, and the owner mark on decks that stay with a channel.
  for (const dir of [slidesFolder(id), promptCache(id)]) if (existsSync(dir) && inside(dir, dataDir()) && resolve(dir) !== resolve(dataDir())) rmSync(dir, { recursive: true, force: true });
  for (const f of channelDecksOf(id)) { try { const m = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>; m.ownerId = DELETED_ID; writeFileSync(f, JSON.stringify(m), { mode: 0o600 }); } catch { /* best effort; the test lists what is left */ } }
  // The keys in this process's memory go now, not at the next restart: pi was given them as $TIGERAI_PKEY_<id> references.
  try { for (const c of listPersonal(id)) delete process.env[personalKeyEnvName(c.id)]; } catch { /* no personal connections */ }
  const keys = keysFolder(id);
  if (existsSync(keys) && inside(keys, join(dataDir(), "personal-models"))) rmSync(keys, { recursive: true, force: true });
  if (tableExists("tg_form_outputs")) {
    for (const o of q("SELECT id FROM tg_form_outputs WHERE owner_id=?", id) as { id: string }[]) {
      const f = join(dataDir(), "forms", "out", `${o.id}.pdf`);
      if (inside(f, join(dataDir(), "forms"))) rmSync(f, { force: true });
    }
  }
  const db = getDb();
  // SQLite keeps deleted rows readable in free pages and in the write-ahead log. For this one operation, deleted content is zeroed
  // (secure_delete) and the log is folded back and truncated afterwards, so "deleted" also holds for the database file.
  db.exec("PRAGMA secure_delete=ON");
  const number = n("SELECT COUNT(*) AS n FROM audit WHERE action='member.purge'") + 1;
  const { email, name } = u;
  inTransaction(() => {
    const del = (sql: string) => db.prepare(sql).run(id);
    del("DELETE FROM session_owner WHERE user_id=? AND room_id IS NULL");
    del("DELETE FROM session_roles WHERE user_id=?");
    db.prepare("UPDATE session_owner SET user_id=? WHERE user_id=?").run(DELETED_ID, id); // a channel's own conversation: nobody inherits it
    if (tableExists("tg_form_outputs")) del("DELETE FROM tg_form_outputs WHERE owner_id=?");
    if (tableExists("meetings")) { del("DELETE FROM meeting_action_links WHERE user_id=?"); del("DELETE FROM meeting_uploads WHERE user_id=?"); del("DELETE FROM meetings WHERE owner_id=?"); }
    for (const sql of [
      "DELETE FROM registration_requests WHERE user_id=?", "DELETE FROM memberships WHERE user_id=?", "DELETE FROM room_members WHERE user_id=?", "DELETE FROM room_reads WHERE user_id=?",
      "DELETE FROM agent_menu WHERE user_id=?", "DELETE FROM agent_menu_seeded WHERE user_id=?", "DELETE FROM personal_agents WHERE owner_id=?", "DELETE FROM prompts WHERE owner_id=?",
      "DELETE FROM push_subs WHERE user_id=?", "DELETE FROM user_activity WHERE user_id=?", "DELETE FROM activity_log WHERE user_id=?", "DELETE FROM wizard_items WHERE recipient_id=?",
      "DELETE FROM announcement_reads WHERE user_id=?",
    ]) del(sql);
    // Channels they created go to the acting administrator (the channel stays; nobody inherits a deleted person).
    db.prepare("UPDATE rooms SET owner_id=? WHERE owner_id=?").run(actor.id, id);
    db.prepare("UPDATE room_members SET added_by=? WHERE added_by=?").run(actor.id, id);
    // The messages stay as a gap in the conversation: no author, no content. (Append-only trigger: lifted for this statement only.)
    const trig = (db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='rm_no_update'").get() as { sql: string } | undefined)?.sql;
    if (trig) db.exec("DROP TRIGGER rm_no_update");
    db.prepare("UPDATE room_messages SET author_id=?, text=?, mentions='[]' WHERE author_id=?").run(DELETED_ID, DELETED_TEXT, id);
    if (trig) db.exec(trig);
    db.prepare("DELETE FROM handover_reads WHERE leaver_id=? OR successor_id=?").run(id, id);
    db.prepare("DELETE FROM handovers WHERE leaver_id=? OR successor_id=?").run(id, id);
    del("DELETE FROM users WHERE id=?");
  });
  const scrubbed = scrubAudit(id, email, name);
  writeAudit("member.purge", actor.id, { number, items: scrubbed });
  // VACUUM rewrites the file without the free pages (older deletions and updates of the same person's rows live there too).
  try { db.exec("VACUUM"); } catch { /* a reader holds the database: the pages are reused and zeroed by later writes */ }
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* another connection is reading: the log is folded back at the next checkpoint */ }
  try { db.exec("PRAGMA secure_delete=OFF"); } catch { /* default */ }
  return { number };
}
