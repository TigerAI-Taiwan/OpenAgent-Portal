// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";

/**
 * 表單 (form packages) and the filled PDFs. The submitted VALUES are never stored in the database: the only place they exist afterwards is
 * the filled PDF itself, in a private file that its owner (and the teacher / administrator who may look) can download, and that is deleted
 * after TIGERAI_FORM_RETENTION_DAYS (default 30).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tg_forms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', group_ids TEXT NOT NULL DEFAULT '[]',
  def TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_form_outputs (
  id TEXT PRIMARY KEY, form_id TEXT NOT NULL, form_name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL, bytes INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tg_form_outputs_owner ON tg_form_outputs(owner_id, created_at);
`;
const DONE = Symbol.for("tigerai:forms-db");
export function ensureFormTables(): void {
  const done = ((globalThis as unknown as Record<symbol, Set<string> | undefined>)[DONE] ??= new Set());
  const key = process.env.TIGERAI_DATA_DIR ?? "";
  const db = getDb();
  if (done.has(key) && db.prepare("SELECT 1 FROM sqlite_master WHERE name='tg_form_outputs'").get()) return;
  db.exec(SCHEMA);
  done.add(key);
}
