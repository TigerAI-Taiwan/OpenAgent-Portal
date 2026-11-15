// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDb, inTransaction } from "../db/store";
import { workspaceRoot } from "../config";
import { generatePassword, hashPassword, validatePassword, verifyPassword } from "./password";
import { writeAudit } from "./audit";

export type Role = "admin" | "member";
export interface UserRow {
  id: string; email: string; name: string; role: Role; status: "active" | "disabled";
  must_change_pw: number; token_version: number; dir_name: string; created_at: number;
}
const PUBLIC_COLS = "id, email, name, role, status, must_change_pw, token_version, dir_name, created_at";

export class ServiceError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newId(prefix: string): string { return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`; }

function ensureDir(...parts: string[]): string {
  const dir = join(workspaceRoot(), ...parts);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function userById(id: string): UserRow | null {
  return (getDb().prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(id) as unknown as UserRow) ?? null;
}

export function listUsers(): (UserRow & { groups: string[] })[] {
  const db = getDb();
  const users = db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY created_at, email`).all() as unknown as UserRow[];
  const mem = db.prepare("SELECT user_id, group_id FROM memberships").all() as unknown as { user_id: string; group_id: string }[];
  return users.map((u) => ({ ...u, groups: mem.filter((m) => m.user_id === u.id).map((m) => m.group_id) }));
}

function activeAdminCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").get() as { n: number }).n;
}

export function createUser(actorId: string | null, input: {
  email: string; name: string; role?: Role; password?: string; mustChange?: boolean;
}): { user: UserRow; initialPassword: string | null } {
  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  if (!EMAIL.test(email)) throw new ServiceError("bad_email", "Invalid email address");
  if (!name || name.length > 80) throw new ServiceError("bad_name", "Name is required (max 80 characters)");
  if (/[\s@]/.test(name)) throw new ServiceError("bad_name", "Name may not contain spaces or @ (it is used for @mentions)");
  if (name.toLowerCase() === "ai") throw new ServiceError("bad_name", "The name \"AI\" is reserved for the room assistant");
  const role: Role = input.role === "admin" ? "admin" : "member";
  const generated = input.password === undefined;
  const password = input.password ?? generatePassword();
  const invalid = validatePassword(password);
  if (invalid) throw new ServiceError("weak_password", invalid);
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new ServiceError("exists", "Email already in use", 409);
  if (db.prepare("SELECT 1 FROM users WHERE lower(name) = lower(?)").get(name)) throw new ServiceError("exists", "Name already in use", 409);
  const id = newId("u");
  const cred = hashPassword(password);
  db.prepare(
    "INSERT INTO users (id,email,name,role,status,pw_hash,pw_salt,pw_iter,must_change_pw,token_version,dir_name,created_at) VALUES (?,?,?,?, 'active',?,?,?,?,0,?,?)",
  ).run(id, email, name, role, cred.hash, cred.salt, cred.iterations, input.mustChange === false ? 0 : 1, id, Date.now());
  ensureDir("users", id);
  writeAudit("user.create", actorId, { userId: id, email, role });
  return { user: userById(id)!, initialPassword: generated ? password : null };
}

/** Email + password check. Returns the user only when everything matches and the account is active. */
export function authenticate(email: string, password: string): UserRow | null {
  const row = getDb().prepare("SELECT *, id AS _id FROM users WHERE email = ?").get(String(email).trim().toLowerCase()) as
    | (UserRow & { pw_hash: string; pw_salt: string; pw_iter: number }) | undefined;
  const ok = verifyPassword(String(password ?? ""), row ? { hash: row.pw_hash, salt: row.pw_salt, iterations: row.pw_iter } : null);
  if (!row || !ok || row.status !== "active") return null;
  return userById(row.id);
}

export function setPassword(actorId: string | null, userId: string, password: string, mustChange: boolean): void {
  const invalid = validatePassword(password);
  if (invalid) throw new ServiceError("weak_password", invalid);
  const cred = hashPassword(password);
  const res = getDb().prepare(
    "UPDATE users SET pw_hash=?, pw_salt=?, pw_iter=?, must_change_pw=?, token_version=token_version+1 WHERE id=?",
  ).run(cred.hash, cred.salt, cred.iterations, mustChange ? 1 : 0, userId);
  if (res.changes === 0) throw new ServiceError("not_found", "No such user", 404);
  writeAudit(mustChange ? "user.password_reset" : "user.password_change", actorId, { userId });
}

export function resetPassword(actorId: string, userId: string): string {
  const password = generatePassword();
  setPassword(actorId, userId, password, true);
  return password;
}

export function updateUser(actorId: string, userId: string, patch: { status?: string; role?: string; name?: string }): UserRow {
  const user = userById(userId);
  if (!user) throw new ServiceError("not_found", "No such user", 404);
  const nextStatus = patch.status ?? user.status;
  const nextRole = patch.role ?? user.role;
  if (nextStatus !== "active" && nextStatus !== "disabled") throw new ServiceError("bad_status", "Invalid status");
  if (nextRole !== "admin" && nextRole !== "member") throw new ServiceError("bad_role", "Invalid role");
  const losesAdmin = user.role === "admin" && user.status === "active" && (nextRole !== "admin" || nextStatus !== "active");
  if (losesAdmin && activeAdminCount() <= 1) throw new ServiceError("last_admin", "The last active administrator cannot be disabled or demoted", 409);
  if (losesAdmin && userId === actorId) throw new ServiceError("self_lockout", "You cannot disable or demote yourself", 409);
  const db = getDb();
  // Any status or role change bumps token_version so cookies already issued stop working.
  db.prepare("UPDATE users SET status=?, role=?, name=?, token_version=token_version+?  WHERE id=?")
    .run(nextStatus, nextRole, patch.name?.trim() || user.name, nextStatus !== user.status || nextRole !== user.role ? 1 : 0, userId);
  if (nextStatus !== user.status) writeAudit(nextStatus === "disabled" ? "user.disable" : "user.enable", actorId, { userId });
  if (nextRole !== user.role) writeAudit("user.role", actorId, { userId, from: user.role, to: nextRole });
  return userById(userId)!;
}

// ---- groups -------------------------------------------------------------

export interface GroupRow { id: string; name: string; parent_id: string | null; dir_name: string; description: string }

export function listGroups(): (GroupRow & { members: { user_id: string; is_manager: number }[] })[] {
  const db = getDb();
  const groups = db.prepare("SELECT id,name,parent_id,dir_name,description FROM groups ORDER BY name").all() as unknown as GroupRow[];
  const mem = db.prepare("SELECT user_id, group_id, is_manager FROM memberships").all() as unknown as { user_id: string; group_id: string; is_manager: number }[];
  return groups.map((g) => ({ ...g, members: mem.filter((m) => m.group_id === g.id).map((m) => ({ user_id: m.user_id, is_manager: m.is_manager })) }));
}

export function createGroup(actorId: string, input: { name: string; description?: string; parentId?: string | null }): GroupRow {
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 80) throw new ServiceError("bad_name", "Group name is required (max 80 characters)");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM groups WHERE name = ?").get(name)) throw new ServiceError("exists", "Group name already in use", 409);
  const parent = input.parentId ?? null;
  if (parent && !db.prepare("SELECT 1 FROM groups WHERE id = ?").get(parent)) throw new ServiceError("bad_parent", "Parent group does not exist");
  const id = newId("g");
  db.prepare("INSERT INTO groups (id,name,parent_id,dir_name,description) VALUES (?,?,?,?,?)")
    .run(id, name, parent, id, String(input.description ?? "").slice(0, 500));
  ensureDir("groups", id);
  writeAudit("group.create", actorId, { groupId: id, name });
  return db.prepare("SELECT id,name,parent_id,dir_name,description FROM groups WHERE id=?").get(id) as unknown as GroupRow;
}

export function deleteGroup(actorId: string, groupId: string): void {
  inTransaction(() => {
    const db = getDb();
    const res = db.prepare("DELETE FROM groups WHERE id=?").run(groupId);
    if (res.changes === 0) throw new ServiceError("not_found", "No such group", 404);
    db.prepare("DELETE FROM memberships WHERE group_id=?").run(groupId);
    db.prepare("UPDATE groups SET parent_id=NULL WHERE parent_id=?").run(groupId);
  });
  writeAudit("group.delete", actorId, { groupId });
}

export function setMembership(actorId: string, groupId: string, userId: string, present: boolean, isManager = false): void {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM groups WHERE id=?").get(groupId)) throw new ServiceError("not_found", "No such group", 404);
  if (!userById(userId)) throw new ServiceError("not_found", "No such user", 404);
  if (present) {
    db.prepare("INSERT INTO memberships (user_id,group_id,is_manager) VALUES (?,?,?) ON CONFLICT(user_id,group_id) DO UPDATE SET is_manager=excluded.is_manager")
      .run(userId, groupId, isManager ? 1 : 0);
  } else {
    db.prepare("DELETE FROM memberships WHERE user_id=? AND group_id=?").run(userId, groupId);
  }
  writeAudit(present ? "group.member_add" : "group.member_remove", actorId, { groupId, userId, isManager });
}

export function groupDirsOf(userId: string): string[] {
  return (getDb().prepare("SELECT g.dir_name FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=?").all(userId) as unknown as { dir_name: string }[])
    .map((r) => r.dir_name);
}

// ---- bootstrap ----------------------------------------------------------

/**
 * First start: create one administrator. The password comes from
 * TIGERAI_ADMIN_PASSWORD, or is generated and printed once to the server log
 * (never written to a file or a document).
 */
export function bootstrapAdmin(): void {
  const n = (getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (n > 0) return;
  const email = process.env.TIGERAI_ADMIN_EMAIL || "admin@example.com";
  const fromEnv = process.env.TIGERAI_ADMIN_PASSWORD;
  const { initialPassword } = createUser(null, {
    email, name: "admin", role: "admin", password: fromEnv, mustChange: !fromEnv,
  });
  if (initialPassword) {
    console.log(`[tigerai] first start: administrator ${email} created. One-time password: ${initialPassword}`);
  } else {
    console.log(`[tigerai] first start: administrator ${email} created from TIGERAI_ADMIN_PASSWORD`);
  }
}
