// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { EMAIL } from "./email";
import { getDb } from "../db/store";
import { ServiceError, isReservedName, userById, type UserRow } from "./service";
import { verifyPassword } from "./password";
import { writeAudit } from "./audit";

/**
 * 設定 → 帳號: anyone edits their OWN display name and sign-in e-mail (the password has its own route). Nothing here takes a user id:
 * the caller is the person. The e-mail is the one unique login, so changing it needs the current password and a free address; the
 * display name may repeat and may contain spaces (the form's hint 「學號-班級-姓名」 / 「工號-部門-姓名」 is a hint, never enforced).
 */
export function updateOwnProfile(userId: string, input: { name?: unknown; email?: unknown; currentPassword?: unknown }): UserRow {
  const user = userById(userId);
  if (!user) throw new ServiceError("not_found", "No such user", 404);
  const db = getDb();
  const changes: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (!name || name.length > 80) throw new ServiceError("bad_name", "Name is required (max 80 characters)");
    if (/@/.test(name)) throw new ServiceError("bad_name", "Name may not contain @ (it is used for @mentions)");
    if (isReservedName(name)) throw new ServiceError("bad_name", "The name \"AI\" is reserved for the room assistant");
    if (name !== user.name) { db.prepare("UPDATE users SET name=? WHERE id=?").run(name, userId); changes.name = name; }
  }
  if (input.email !== undefined) {
    const email = String(input.email ?? "").trim().toLowerCase();
    if (email !== user.email.toLowerCase()) {
      if (!EMAIL.test(email)) throw new ServiceError("bad_email", "Invalid email address");
      const row = db.prepare("SELECT pw_hash,pw_salt,pw_iter FROM users WHERE id=?").get(userId) as { pw_hash: string; pw_salt: string; pw_iter: number };
      if (!verifyPassword(String(input.currentPassword ?? ""), { hash: row.pw_hash, salt: row.pw_salt, iterations: row.pw_iter })) throw new ServiceError("bad_current", "Current password is wrong", 403);
      if (db.prepare("SELECT 1 FROM users WHERE email=? AND id<>?").get(email, userId)) throw new ServiceError("exists", "Email already in use", 409);
      db.prepare("UPDATE users SET email=? WHERE id=?").run(email, userId);
      changes.emailFrom = user.email; changes.emailTo = email;
    }
  }
  if (Object.keys(changes).length) writeAudit("account.profile", userId, { userId, ...changes });
  return userById(userId)!;
}
