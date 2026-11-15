// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";
import { userById } from "../accounts/service";

/**
 * Who is behind a pi session, for the extensions that run inside it.
 * An owned personal conversation: its owner. A shared room conversation: nobody (it must not
 * borrow anyone's personal templates or n8n access). A conversation that is still being created
 * has no owner row yet, so its folder (users/<id>) says whose it is.
 */
export function identityForSession(sessionId: string | undefined, cwd: string): { id: string; role: "admin" | "member" } | null {
  if (sessionId) {
    const owner = getDb().prepare("SELECT user_id, room_id, kind FROM session_owner WHERE session_id=?").get(sessionId) as { user_id: string; room_id: string | null; kind: string } | undefined;
    if (owner) {
      if (owner.room_id !== null || owner.kind === "hook") return null;
      const u = userById(owner.user_id);
      return u && u.status === "active" ? { id: u.id, role: u.role } : null;
    }
  }
  const m = /[\\/]users[\\/]([^\\/]+)(?:[\\/]|$)/.exec(cwd);
  const u = m ? userById(m[1]) : null;
  return u && u.status === "active" ? { id: u.id, role: u.role } : null;
}
