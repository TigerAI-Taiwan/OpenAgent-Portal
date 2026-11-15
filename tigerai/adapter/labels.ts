// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { join } from "node:path";
import { getDb } from "../db/store";
import { workspaceRoot } from "../config";
import { personalDir } from "../workspace";

/**
 * Display names for workspace folders ("<name> 的工作區"), keyed by the folder path the sidebar uses as the
 * project key. A member gets their own folder and their groups'; an administrator sees everybody's.
 * A name the user set themselves is never overwritten (the caller only adds what is missing).
 */
export function workspaceLabels(user: { id: string; role: "admin" | "member" }): Record<string, string> {
  const db = getDb();
  const out: Record<string, string> = {};
  const users = (user.role === "admin"
    ? db.prepare("SELECT id, name FROM users").all()
    : db.prepare("SELECT id, name FROM users WHERE id=?").all(user.id)) as unknown as { id: string; name: string }[];
  for (const u of users) out[personalDir(u.id)] = `${u.name} 的工作區`;
  const groups = (user.role === "admin"
    ? db.prepare("SELECT dir_name, name FROM groups").all()
    : db.prepare("SELECT g.dir_name, g.name FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=?").all(user.id)) as unknown as { dir_name: string; name: string }[];
  for (const g of groups) out[join(workspaceRoot(), "groups", g.dir_name)] = `${g.name} 的工作區`;
  return out;
}
