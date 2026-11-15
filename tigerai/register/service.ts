// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomInt } from "node:crypto";
import { getDb, inTransaction } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, createUser, setMembership, userById, type Role, type UserRow } from "../accounts/service";
import { verifyPassword } from "../accounts/password";
import { pushToUser } from "../push";
import { joinCompanyChannel, leaveCompanyChannel } from "../rooms/unit-channel";
import { Blocked, WindowCeiling, registerGlobalHour, registerPerClassHour, regWrongGlobalLimit, resetThrottles, throttles } from "../accounts/throttle";

/**
 * 自行註冊 (community edition). The administrator's switch is OFF by default; while it is off, registration does not exist
 * (the page and the API answer 404). When on, a person registers with name, email, password and the class's 通關密語 (a phrase
 * the class's head sets, e.g. 「AI Agent 實作 甲班 2026秋」, matched ignoring case, spaces and punctuation), plus an optional note.
 * The new account is 「待核准」: it cannot sign in until an administrator or the class head approves it. The phrase decides which
 * class the applicant asks to join, so the head approves a whole class in one click. A new account is always a plain member.
 * Optional administrator switch 「代碼正確就自動核准」 (default off) skips the wait for a supervised session.
 * The account row stays status='disabled' while pending (users.status has a fixed CHECK set); registration_requests holds the rest.
 */

const SETTING_OPEN = "register.open";
const SETTING_REQUIRE = "register.require_code";
const SETTING_AUTO = "register.auto_approve";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0 O 1 I
export const CODE_LENGTH = 8; // the random phrase made by 「產生新通關密語」
export const PHRASE_MIN = 8, PHRASE_MAX = 60; // normalized length of a phrase; the raw text may be a little longer

const getSetting = (key: string): string | null => (getDb().prepare("SELECT value FROM tg_settings WHERE key=?").get(key) as { value: string } | undefined)?.value ?? null;
const putSetting = (key: string, value: string): void => { getDb().prepare("INSERT INTO tg_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, value, Date.now()); };

export function registrationOpen(): boolean { return getSetting(SETTING_OPEN) === "1"; }
export function codeRequired(): boolean { return getSetting(SETTING_REQUIRE) !== "0"; }

export function autoApprove(): boolean { return getSetting(SETTING_AUTO) === "1"; }

export function setRegistration(actorId: string, patch: { open?: boolean; requireCode?: boolean; autoApprove?: boolean }): { open: boolean; requireCode: boolean; autoApprove: boolean } {
  if (patch.autoApprove !== undefined) putSetting(SETTING_AUTO, patch.autoApprove ? "1" : "0");
  if (patch.open !== undefined) putSetting(SETTING_OPEN, patch.open ? "1" : "0");
  if (patch.requireCode !== undefined) putSetting(SETTING_REQUIRE, patch.requireCode ? "1" : "0");
  writeAudit("register.setting", actorId, { open: registrationOpen() ? "on" : "off", requireCode: codeRequired() ? "yes" : "no", autoApprove: autoApprove() ? "on" : "off" });
  return { open: registrationOpen(), requireCode: codeRequired(), autoApprove: autoApprove() };
}

// ---------------------------------------------------------------- join codes

/** Case, width, spaces and punctuation do not matter: 「AI Agent 實作 甲班」 equals 「ai-agent實作甲班」. */
export const normalizeCode = (v: unknown): string => String(v ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export const formatCode = (c: string): string => `${c.slice(0, 4)}-${c.slice(4)}`;
function newCode(): string {
  for (;;) {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("").toLowerCase();
    if (!getDb().prepare("SELECT 1 FROM group_join_codes WHERE code=?").get(code)) return code;
  }
}

type Actor = { id: string; role: Role };
/** Departments whose code this person may see and change: every department for an administrator, the ones they head for a head. */
export function manageableGroups(actor: Actor): { id: string; name: string }[] {
  const db = getDb();
  if (actor.role === "admin") return db.prepare("SELECT id,name FROM groups ORDER BY name").all() as unknown as { id: string; name: string }[];
  return db.prepare("SELECT g.id,g.name FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=? AND m.is_manager=1 ORDER BY g.name").all(actor.id) as unknown as { id: string; name: string }[];
}
function requireGroup(actor: Actor, groupId: string): { id: string; name: string } {
  const g = manageableGroups(actor).find((x) => x.id === groupId);
  if (!g) throw new ServiceError("forbidden", "Only an administrator or this department's head may manage its join code", 403);
  return g;
}
/** A passphrase is switched ON only for a class that is not archived. */
function requireLive(groupId: string): void {
  if (getDb().prepare("SELECT 1 FROM groups WHERE id=? AND archived_at IS NOT NULL").get(groupId)) throw new ServiceError("archived", "This class is archived; unarchive it before handing out a passphrase", 409);
}

export interface CodeView { groupId: string; name: string; code: string | null; enabled: boolean; members: number }
export function listCodes(actor: Actor): CodeView[] {
  const db = getDb();
  return manageableGroups(actor).map((g) => {
    const row = db.prepare("SELECT code, phrase, enabled FROM group_join_codes WHERE group_id=?").get(g.id) as { code: string; phrase: string; enabled: number } | undefined;
    // Students only: the teacher is the administrator (one per Portal) and a class head is not a student; a disabled or pending account is not one yet.
    const members = (db.prepare("SELECT COUNT(*) AS n FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND u.role<>'admin' AND u.status='active' AND m.is_manager=0").get(g.id) as { n: number }).n;
    return { groupId: g.id, name: g.name, code: row ? (row.phrase || formatCode(row.code.toUpperCase())) : null, enabled: !!row && row.enabled === 1, members };
  });
}
/** A random phrase (for a head who does not want to think of one). The old one stops working at once. */
export function rotateCode(actor: Actor, groupId: string): CodeView { return writePhrase(actor, groupId, null); }
/** Set the class's 通關密語 to text the head chose. Another class may not use the same one (they could not be told apart). */
export function setPhrase(actor: Actor, groupId: string, phrase: unknown): CodeView { return writePhrase(actor, groupId, String(phrase ?? "").trim()); }
function writePhrase(actor: Actor, groupId: string, phrase: string | null): CodeView {
  const g = requireGroup(actor, groupId);
  requireLive(groupId);
  const code = phrase === null ? newCode() : normalizeCode(phrase);
  if (phrase !== null) {
    if (phrase.length > PHRASE_MAX + 20 || [...code].length < PHRASE_MIN || [...code].length > PHRASE_MAX) throw new ServiceError("bad_phrase", `The passphrase needs ${PHRASE_MIN}-${PHRASE_MAX} characters (spaces and punctuation do not count)`);
    const clash = getDb().prepare("SELECT group_id FROM group_join_codes WHERE code=? AND group_id<>?").get(code, g.id);
    if (clash) throw new ServiceError("phrase_taken", "Another class already uses this passphrase", 409);
  }
  getDb().prepare("INSERT INTO group_join_codes (group_id,code,phrase,enabled,created_by,updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(group_id) DO UPDATE SET code=excluded.code, phrase=excluded.phrase, enabled=1, created_by=excluded.created_by, updated_at=excluded.updated_at")
    .run(g.id, code, phrase === null ? "" : phrase, actor.id, Date.now());
  writeAudit(phrase === null ? "joincode.rotate" : "joincode.set", actor.id, { groupId: g.id });
  return listCodes(actor).find((c) => c.groupId === g.id)!;
}
export function disableCode(actor: Actor, groupId: string): CodeView {
  const g = requireGroup(actor, groupId);
  getDb().prepare("UPDATE group_join_codes SET enabled=0, updated_at=? WHERE group_id=?").run(Date.now(), g.id);
  writeAudit("joincode.disable", actor.id, { groupId: g.id });
  return listCodes(actor).find((c) => c.groupId === g.id)!;
}

// ---------------------------------------------------------------- throttle (per account and per class; global ceilings far above a class)

/** Test helper: forget every counter. */
export function resetRegisterThrottle(): void { resetThrottles(); }
/** Registrations ONE class (passphrase) takes per hour; a rolling hour. All classes together may take ten times that. */
export function perHourLimit(): number { return registerPerClassHour(); }

export class RateLimited extends ServiceError {
  constructor(public retryAfter: number) { super("rate_limited", "Too many attempts; try again later", 429); }
}
function limited<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof Blocked) throw new RateLimited(e.retryAfter); throw e; }
}

// ---------------------------------------------------------------- registering

/** `client` is a fingerprint of who is typing (api/register.ts: forwarded address + browser); the e-mail alone is typed by the guesser and costs nothing to change. */
export interface RegisterInput { name: unknown; email: unknown; password: unknown; code?: unknown; note?: unknown; client?: string }
export type RegisterResult = { user: UserRow; groupId: string | null; pending: boolean };

/**
 * Order matters: switch, rate limit, then the passphrase, and only then anything about the account. A caller without a valid
 * passphrase never learns whether an email or a name is taken (createUser's "already in use" errors come after the check).
 * Someone who typed a passphrase that matches no class is refused here, so no applicant ever waits without a class.
 */
export function registerStudent(input: RegisterInput, now = Date.now()): RegisterResult {
  if (!registrationOpen()) throw new ServiceError("not_found", "Not found", 404);
  const T = throttles();
  const accountKey = String(input.email ?? "").trim().toLowerCase().slice(0, 120);
  const clientKey = input.client ? `c:${String(input.client).slice(0, 64)}` : null; // no forwarded address: nothing separates this caller from the class beside them
  // Waiting is per account AND per client: a guesser changing the e-mail still waits as the same client. A student's typos only slow that student.
  limited(() => { T.regAccount.check(accountKey, now); if (clientKey) T.regAccount.check(clientKey, now); T.regDoneGlobal.check(registerGlobalHour(), now); });
  const raw = normalizeCode(input.code);
  const entered = String(input.code ?? "").trim().slice(0, PHRASE_MAX + 20);
  let groupId: string | null = null;
  if (raw || codeRequired()) {
    const row = raw.length >= 1 && raw.length <= PHRASE_MAX
      ? (getDb().prepare("SELECT gc.group_id AS groupId FROM group_join_codes gc JOIN groups g ON g.id=gc.group_id WHERE gc.code=? AND gc.enabled=1 AND g.archived_at IS NULL").get(raw) as { groupId: string } | undefined)
      : undefined;
    if (!row) {
      // The ceiling over all wrong passphrases only ever refuses WRONG passphrases (below): somebody flooding guesses cannot stop a class that has the right one.
      limited(() => T.regWrongGlobal.check(regWrongGlobalLimit(), now));
      T.regAccount.fail(accountKey, now); if (clientKey) T.regAccount.fail(clientKey, now); T.regWrongGlobal.add(now);
      writeAudit("account.self_register_failed", null, { reason: "bad_code" });
      throw new ServiceError("bad_join_code", "The passphrase is wrong or no longer valid", 403);
    }
    groupId = row.groupId;
  }
  // Per class (per passphrase): one class takes at most N registrations an hour, whatever the others do.
  const classKey = groupId ?? "(open)";
  const ceiling = T.regDoneClass.get(classKey) ?? new WindowCeiling(3600_000);
  T.regDoneClass.set(classKey, ceiling);
  limited(() => ceiling.check(registerPerClassHour(), now));
  const note = ""; // v1.1: the 備註 box is gone (the name itself says 學號-班級-姓名); rows from earlier versions keep theirs
  // A typo in the form (weak password, bad email) is not an attack and must not slow down the rest of the class: only a wrong passphrase counts as a failure.
  const auto = autoApprove() && groupId !== null; // an open workshop without a passphrase always waits for a person
  // ONE transaction: the account, its request and (when it waits) its disabled state are committed together. There is no moment in
  // which an active account without a request exists, and a failure half-way leaves nothing behind.
  const user = inTransaction(() => {
    const u = createUser(null, { email: String(input.email ?? ""), name: String(input.name ?? ""), role: "member", password: typeof input.password === "string" ? input.password : "", mustChange: false }).user;
    getDb().prepare("INSERT INTO registration_requests (user_id,group_id,phrase_entered,note,status,created_at,decided_by,decided_at) VALUES (?,?,?,?,?,?,NULL,?)")
      .run(u.id, groupId, entered, note, auto ? "approved" : "pending", now, auto ? now : null);
    if (!auto) { getDb().prepare("UPDATE users SET status='disabled' WHERE id=?").run(u.id); leaveCompanyChannel(u.id); }
    else if (groupId) setMembership(u.id, groupId, u.id, true, false); // never a head
    return u;
  });
  ceiling.add(now); T.regDoneGlobal.add(now); T.regAccount.ok(accountKey); if (clientKey) T.regAccount.ok(clientKey);
  writeAudit("account.self_register", user.id, { userId: user.id, groupId, via: groupId ? "passphrase" : "open", result: auto ? "auto_approved" : "pending" });
  if (!auto) notifyApprovers(groupId, now);
  return { user: userById(user.id)!, groupId, pending: !auto };
}

/** The account is waiting: the right password on a pending account lets the login page say so (nothing is revealed to a wrong password). */
export function isPendingLogin(email: string, password: string): boolean {
  const row = getDb().prepare("SELECT u.pw_hash, u.pw_salt, u.pw_iter FROM users u JOIN registration_requests r ON r.user_id=u.id WHERE u.email=? AND u.status='disabled' AND r.status='pending'")
    .get(String(email).trim().toLowerCase()) as { pw_hash: string; pw_salt: string; pw_iter: number } | undefined;
  return !!row && verifyPassword(String(password ?? ""), { hash: row.pw_hash, salt: row.pw_salt, iterations: row.pw_iter });
}

// ---------------------------------------------------------------- the approval list

export interface RequestRow { userId: string; name: string; email: string; groupId: string | null; groupName: string | null; phrase: string; note: string; createdAt: number }
export interface RequestGroup { groupId: string | null; groupName: string | null; applicants: RequestRow[] }

/** Pending applicants this person may decide, grouped by the class their passphrase matched: every class for an administrator, the ones they head for a head. */
export function pendingRequests(actor: Actor): RequestGroup[] {
  const db = getDb();
  const rows = db.prepare(`SELECT r.user_id AS userId, u.name, u.email, r.group_id AS groupId, g.name AS groupName, r.phrase_entered AS phrase, r.note, r.created_at AS createdAt
    FROM registration_requests r JOIN users u ON u.id=r.user_id LEFT JOIN groups g ON g.id=r.group_id
    WHERE r.status='pending' AND u.status='disabled' ORDER BY g.name, r.created_at`).all() as unknown as RequestRow[];
  const mine = actor.role === "admin" ? null : new Set(manageableGroups(actor).map((g) => g.id));
  const groups: RequestGroup[] = [];
  for (const r of rows) {
    if (mine && !(r.groupId && mine.has(r.groupId))) continue;
    let g = groups.find((x) => x.groupId === r.groupId);
    if (!g) { g = { groupId: r.groupId, groupName: r.groupName, applicants: [] }; groups.push(g); }
    g.applicants.push(r);
  }
  return groups;
}
export function pendingCount(actor: Actor): number { return pendingRequests(actor).reduce((n, g) => n + g.applicants.length, 0); }

function decide(actor: Actor, userId: string, approve: boolean, now: number): void {
  const group = pendingRequests(actor).find((g) => g.applicants.some((a) => a.userId === userId));
  if (!group) throw new ServiceError("not_found", "No such pending registration", 404); // also what a head gets for another class's applicant
  const db = getDb();
  if (approve) {
    db.prepare("UPDATE users SET status='active', token_version=token_version+1 WHERE id=?").run(userId);
    if (group.groupId) setMembership(actor.id, group.groupId, userId, true, false);
    joinCompanyChannel(userId); // the company channel is for approved people only
  }
  db.prepare("UPDATE registration_requests SET status=?, decided_by=?, decided_at=? WHERE user_id=?").run(approve ? "approved" : "rejected", actor.id, now, userId);
  writeAudit(approve ? "account.approve" : "account.reject", actor.id, { userId, groupId: group.groupId });
}
export function approveRequest(actor: Actor, userId: string, now = Date.now()): void { decide(actor, userId, true, now); }
export function rejectRequest(actor: Actor, userId: string, now = Date.now()): void { decide(actor, userId, false, now); } // the account stays, disabled; nothing is deleted
/** 這一班全部核准 (groupId null = the applicants without a class, administrator only; "all" = every group this person may decide). */
export function approveGroup(actor: Actor, groupId: string | null | "all", now = Date.now()): number {
  let n = 0;
  for (const g of pendingRequests(actor)) {
    if (groupId !== "all" && g.groupId !== groupId) continue;
    for (const a of g.applicants) { decide(actor, a.userId, true, now); n += 1; }
  }
  return n;
}

// ---------------------------------------------------------------- telling the approvers

/** Everyone who can decide this class: every active administrator, plus the class's heads. Their bell and 公佈欄 個人區 read pendingRequests; here only the browser push. */
function notifyApprovers(groupId: string | null, now: number): void {
  const db = getDb();
  const ids = new Set((db.prepare("SELECT id FROM users WHERE role='admin' AND status='active' AND is_vendor=0").all() as { id: string }[]).map((r) => r.id));
  if (groupId) for (const r of db.prepare("SELECT m.user_id AS id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND m.is_manager=1 AND u.status='active'").all(groupId) as { id: string }[]) ids.add(r.id);
  const name = groupId ? (db.prepare("SELECT name FROM groups WHERE id=?").get(groupId) as { name: string } | undefined)?.name ?? "" : "";
  for (const id of ids) {
    const n = pendingCount({ id, role: userById(id)?.role ?? "member" });
    void pushToUser(id, { title: `有 ${n} 位新註冊等待核准`, body: name ? `申請加入『${name}』` : "請到「管理」核准", url: "/?bulletin=1", tag: "tigerai-register-pending" }).catch(() => 0);
  }
  void now;
}
