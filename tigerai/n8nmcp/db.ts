// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { getDb } from "../db/store";

/**
 * Tables of the n8n MCP connection. `n8n_mcp_servers` has the same shape the consultant pack always used, so a database made by
 * either edition reads in the other; the pack's own initTables() is a harmless repeat of the same statements.
 * `n8n_mcp_grants` holds what an approved work order allowed (grants.ts).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS n8n_mcp_servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, url TEXT NOT NULL,
  group_ids TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
  allow_tools TEXT NOT NULL DEFAULT '["search_workflows","get_workflow_details","get_workflow_execution"]'
);
CREATE TABLE IF NOT EXISTS n8n_mcp_grants (
  order_id TEXT PRIMARY KEY, applicant_id TEXT NOT NULL, server_id TEXT NOT NULL, tools TEXT NOT NULL,
  expires_at INTEGER NOT NULL, uses_left INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_n8n_mcp_grants_applicant ON n8n_mcp_grants(applicant_id);
-- Who created which workflow through the Portal (ownership.ts). The n8n side has one shared token, so this is the only record there is.
CREATE TABLE IF NOT EXISTS n8n_workflow_owners (
  server_id TEXT NOT NULL, workflow_id TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, workflow_id)
);
-- Workflows an administrator shared for running only (everyone who has the connector may execute them, nobody but the owner may change them).
CREATE TABLE IF NOT EXISTS n8n_workflow_shares (
  server_id TEXT NOT NULL, workflow_id TEXT NOT NULL, shared_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, workflow_id)
);
`;

const DONE = Symbol.for("tigerai:n8nmcp-db");
export function ensureMcpTables(): void {
  const done = ((globalThis as unknown as Record<symbol, Set<string> | undefined>)[DONE] ??= new Set());
  const key = process.env.TIGERAI_DATA_DIR ?? "";
  const db = getDb();
  if (done.has(key) && db.prepare("SELECT 1 FROM sqlite_master WHERE name='n8n_workflow_shares'").get()) return;
  db.exec(SCHEMA);
  for (const col of ["template TEXT NOT NULL DEFAULT 'n8n'", "description TEXT NOT NULL DEFAULT ''", "last_tools TEXT NOT NULL DEFAULT '[]'", "tested_at INTEGER"]) {
    try { db.exec(`ALTER TABLE n8n_mcp_servers ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  done.add(key);
}
