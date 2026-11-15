// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { workspaceRoot } from "./config";
import { getDb } from "./db/store";
import { groupDirsOf, type UserRow } from "./accounts/service";

/** Folder layout: <root>/users/<id>, <root>/groups/<id>, <root>/rooms/<id>. Ids, never names, so a rename cannot break a path. */

export function personalDir(userId: string): string {
  return join(workspaceRoot(), "users", userId);
}
export function ensurePersonalDir(userId: string): string {
  const dir = personalDir(userId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function real(p: string): string {
  const abs = resolve(p);
  try { return realpathSync(abs); } catch { return abs; }
}

export function isInside(child: string, parent: string): boolean {
  const c = real(child);
  const p = real(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/** Folders a member may use as a working directory or read files from. */
export function memberRoots(user: Pick<UserRow, "id">): string[] {
  const roots = [personalDir(user.id)];
  for (const dir of groupDirsOf(user.id)) roots.push(join(workspaceRoot(), "groups", dir));
  const rooms = getDb().prepare("SELECT room_id FROM room_members WHERE user_id=?").all(user.id) as unknown as { room_id: string }[];
  for (const r of rooms) roots.push(join(workspaceRoot(), "rooms", r.room_id));
  return roots;
}

/** Folders a member may use as a *conversation* cwd: personal folder, or a group folder. Rooms get theirs through the room feature. */
export function memberCwdAllowed(user: Pick<UserRow, "id">, cwd: string): boolean {
  if (cwd.split(/[\\/]/).includes("..")) return false;
  return memberRoots(user).some((root) => isInside(cwd, root));
}

/** True when this cwd sits in the shared (room) or personal tree: sessions started there run read-only. */
export function isRestrictedCwd(cwd: string | undefined): boolean {
  if (!cwd) return true;
  const root = workspaceRoot();
  return isInside(cwd, join(root, "users")) || isInside(cwd, join(root, "rooms")) || isInside(cwd, join(root, "groups")) || isInside(cwd, join(root, "hooks"));
}
