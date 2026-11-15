// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/store";
import { dataDir } from "../config";

/**
 * 系統狀態 for the administrator and the maintenance account: version, how long it has been up, the size of the database and the
 * backups that sit next to it (names, sizes, times only). Counts, never people: nothing here names a member.
 */
export const PRODUCT_VERSION = "1.1.0-ce";

export function systemStatus(now = Date.now()): Record<string, unknown> {
  const db = getDb();
  const n = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  let dbBytes = 0;
  try { dbBytes = statSync(join(dataDir(), "tigerai.db")).size; } catch { /* no file yet */ }
  const backups: { name: string; bytes: number; modified: number }[] = [];
  for (const sub of ["backups", "backup"]) {
    const dir = join(dataDir(), sub);
    if (!existsSync(dir)) continue;
    try {
      for (const name of readdirSync(dir).slice(0, 200)) {
        const st = statSync(join(dir, name));
        if (st.isFile()) backups.push({ name, bytes: st.size, modified: st.mtimeMs });
      }
    } catch { /* unreadable: show none */ }
  }
  backups.sort((a, b) => b.modified - a.modified);
  return {
    version: PRODUCT_VERSION, node: process.version, uptimeSec: Math.round(process.uptime()), now,
    database: { bytes: dbBytes },
    counts: { accounts: n("SELECT COUNT(*) AS n FROM users WHERE is_vendor=0"), channels: n("SELECT COUNT(*) AS n FROM rooms WHERE deleted_at IS NULL") },
    backups: backups.slice(0, 20),
  };
}
