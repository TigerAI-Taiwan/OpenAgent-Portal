// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { ConversationMeta, Deps } from "./service";

/** Reads pi's session files through the same helpers the upstream pages use; nothing is written. */
export const fileDeps: Deps = {
  async catalog() {
    const { listAllSessions } = await import("../../lib/session-reader");
    const out = new Map<string, ConversationMeta>();
    for (const s of await listAllSessions({ allowStale: true })) {
      const first = (s.firstMessage ?? "").replace(/\s+/g, " ").trim();
      const title = (s.name && s.name.trim()) || (first && first !== "(no messages)" ? first.slice(0, 60) : "(空白對話)");
      out.set(s.id, { id: s.id, title, modified: Date.parse(s.modified) || 0 });
    }
    return out;
  },
  async messages(sessionId) {
    const { resolveSessionPath, openSessionManager, buildSessionContext } = await import("../../lib/session-reader");
    const path = await resolveSessionPath(sessionId);
    if (!path) return null;
    const sm = openSessionManager(path);
    const ctx = buildSessionContext(sm.getEntries() as never, sm.getLeafId());
    return ctx.messages as unknown[];
  },
};
