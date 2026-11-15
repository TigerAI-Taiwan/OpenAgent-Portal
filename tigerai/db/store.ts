// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { DatabaseSync } from "node:sqlite";
import { registeredStoreDriver, type SqlDb } from "./driver";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";

/**
 * One SQLite file. Everything above this file asks for `getDb()` and nothing
 * else, so a PostgreSQL driver can replace it later without touching callers.
 * The proxy and the route handlers each load their own copy of this module
 * (separate bundles), so the connection is kept per module instance and the
 * file is opened in WAL mode with a busy timeout. busy_timeout is set first:
 * switching to WAL itself needs a lock.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, pw_iter INTEGER NOT NULL,
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  dir_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  parent_id TEXT,
  dir_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL, group_id TEXT NOT NULL, is_manager INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, action TEXT NOT NULL, actor_id TEXT, extra TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
  BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
  BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TABLE IF NOT EXISTS session_owner (
  session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, cwd TEXT,
  kind TEXT NOT NULL DEFAULT 'chat', room_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL,
  bound_session_id TEXT, created_at INTEGER NOT NULL,
  closed_at INTEGER, closed_by TEXT, deleted_at INTEGER, deleted_by TEXT
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL, user_id TEXT NOT NULL, added_by TEXT NOT NULL, added_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS room_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL,
  mentions TEXT NOT NULL DEFAULT '[]', ts INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'human'
);
CREATE INDEX IF NOT EXISTS room_messages_room ON room_messages (room_id, seq);
CREATE TRIGGER IF NOT EXISTS rm_no_update BEFORE UPDATE ON room_messages
  BEGIN SELECT RAISE(ABORT, 'room messages are append-only'); END;
CREATE TRIGGER IF NOT EXISTS rm_no_delete BEFORE DELETE ON room_messages
  BEGIN SELECT RAISE(ABORT, 'room messages are append-only'); END;
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',
  tool_names TEXT,
  model_provider TEXT, model_id TEXT,
  knowledge_dir TEXT,
  group_ids TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS personal_agents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  shared INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS personal_agents_owner ON personal_agents (owner_id);
CREATE TABLE IF NOT EXISTS agent_menu (
  user_id TEXT NOT NULL, agent_id TEXT NOT NULL, position INTEGER NOT NULL,
  PRIMARY KEY (user_id, agent_id)
);
CREATE TABLE IF NOT EXISTS agent_menu_seeded (user_id TEXT PRIMARY KEY, seeded_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS room_assistants (
  room_id TEXT NOT NULL, agent_id TEXT NOT NULL, session_id TEXT NOT NULL,
  PRIMARY KEY (room_id, agent_id)
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  owner_id TEXT,
  scope_group TEXT,
  source_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS prompts_name_scope ON prompts (name, COALESCE(owner_id, ''), COALESCE(scope_group, ''));
CREATE TABLE IF NOT EXISTS prompt_ticks (
  prompt_id TEXT NOT NULL, group_id TEXT NOT NULL, ticked_by TEXT NOT NULL, ticked_at INTEGER NOT NULL,
  PRIMARY KEY (prompt_id, group_id)
);
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  applicant_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approver_id TEXT, decided_at INTEGER, note TEXT, result_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS wo_decided_is_final BEFORE UPDATE ON work_orders
  WHEN OLD.status <> 'pending'
  BEGIN SELECT RAISE(ABORT, 'a decided work order is final'); END;
CREATE TRIGGER IF NOT EXISTS wo_no_self_approval BEFORE UPDATE ON work_orders
  WHEN NEW.status <> 'pending' AND NEW.approver_id = OLD.applicant_id
  BEGIN SELECT RAISE(ABORT, 'the approver cannot be the applicant'); END;
CREATE TRIGGER IF NOT EXISTS wo_no_delete BEFORE DELETE ON work_orders
  BEGIN SELECT RAISE(ABORT, 'work orders are kept'); END;
CREATE TABLE IF NOT EXISTS n8n_webhooks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  group_ids TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hook_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, key_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
  agent_id TEXT, room_id TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER, last_used INTEGER
);
CREATE TABLE IF NOT EXISTS hook_calls (
  key_id TEXT NOT NULL, idem TEXT NOT NULL, status TEXT NOT NULL, answer TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (key_id, idem)
);
CREATE TABLE IF NOT EXISTS session_roles (
  session_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  applicant_id TEXT NOT NULL, assignee_id TEXT NOT NULL,
  due_date INTEGER, session_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','done','returned')),
  return_reason TEXT, done_note TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, accepted_at INTEGER, finished_at INTEGER,
  source TEXT NOT NULL DEFAULT 'person'
);
CREATE INDEX IF NOT EXISTS assignments_assignee ON assignments (assignee_id, status);
CREATE INDEX IF NOT EXISTS assignments_applicant ON assignments (applicant_id);
CREATE TRIGGER IF NOT EXISTS as_finished_is_final BEFORE UPDATE ON assignments
  WHEN OLD.status IN ('done','returned')
  BEGIN SELECT RAISE(ABORT, 'a finished assignment is final'); END;
CREATE TRIGGER IF NOT EXISTS as_no_delete BEFORE DELETE ON assignments
  BEGIN SELECT RAISE(ABORT, 'assignments are kept'); END;
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL, audience_all INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, require_ack INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, deleted_by TEXT
);
CREATE TRIGGER IF NOT EXISTS an_no_delete BEFORE DELETE ON announcements
  BEGIN SELECT RAISE(ABORT, 'announcements are kept (soft delete)'); END;
CREATE TABLE IF NOT EXISTS announcement_groups (
  announcement_id TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY (announcement_id, group_id)
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at INTEGER NOT NULL, acked_at INTEGER,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE TABLE IF NOT EXISTS announcement_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, announcement_id TEXT NOT NULL, editor_id TEXT NOT NULL, ts INTEGER NOT NULL,
  old_title TEXT NOT NULL, old_body TEXT NOT NULL, old_meta TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS ae_no_update BEFORE UPDATE ON announcement_edits
  BEGIN SELECT RAISE(ABORT, 'edit history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ae_no_delete BEFORE DELETE ON announcement_edits
  BEGIN SELECT RAISE(ABORT, 'edit history is append-only'); END;
CREATE TABLE IF NOT EXISTS room_reads (
  room_id TEXT NOT NULL, user_id TEXT NOT NULL, last_seq INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE TRIGGER IF NOT EXISTS rr_forward_only BEFORE UPDATE ON room_reads
  WHEN NEW.last_seq < OLD.last_seq
  BEGIN SELECT RAISE(ABORT, 'read cursor only moves forward'); END;
CREATE TABLE IF NOT EXISTS wizard_settings (
  room_id TEXT NOT NULL, key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  at_time TEXT, weekday INTEGER, updated_by TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, key)
);
CREATE TABLE IF NOT EXISTS wizard_runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, room_id TEXT, runner_id TEXT NOT NULL, requested_by TEXT, trigger TEXT NOT NULL,
  period TEXT, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
  from_seq INTEGER, to_seq INTEGER, post_seq INTEGER, draft TEXT, input TEXT,
  confirm_state TEXT, confirmed_by TEXT, confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS wizard_runs_room ON wizard_runs (room_id, kind, period);
CREATE TABLE IF NOT EXISTS wizard_items (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, room_id TEXT, aspect TEXT NOT NULL, category TEXT, text TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]', recipient_id TEXT, state TEXT NOT NULL DEFAULT 'open', extra TEXT, dedupe TEXT,
  day TEXT, created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS wizard_items_run ON wizard_items (run_id);
CREATE INDEX IF NOT EXISTS wizard_items_recipient ON wizard_items (recipient_id, state);
CREATE TABLE IF NOT EXISTS wizard_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
-- 使用者紀錄: last authenticated activity per person (written at most once a minute) and small admin switches.
CREATE TABLE IF NOT EXISTS user_activity (user_id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tg_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
-- 學生自行註冊: one join code per department (the class); the teacher hands it out, so strangers cannot join a class.
-- 自行註冊的申請: the account row stays 'disabled' until a decision (users.status has a fixed CHECK set; SQLite cannot widen it).
CREATE TABLE IF NOT EXISTS registration_requests (user_id TEXT PRIMARY KEY, group_id TEXT, phrase_entered TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER);
CREATE TABLE IF NOT EXISTS group_join_codes (group_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT, updated_at INTEGER NOT NULL);
-- Authenticated activity, one row per person per minute at most (written beside user_activity); the attendance facts of AI 評分精靈 read it.
CREATE TABLE IF NOT EXISTS activity_log (user_id TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (user_id, ts));
-- 離職交接 (feat/ce-org): one row per handover, and the read-only access a successor gets to the leaver's personal conversations and folder.
CREATE TABLE IF NOT EXISTS handovers (id TEXT PRIMARY KEY, leaver_id TEXT NOT NULL, successor_id TEXT, actor_id TEXT, at INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS handover_reads (leaver_id TEXT NOT NULL, successor_id TEXT NOT NULL, granted_by TEXT, granted_at INTEGER NOT NULL, PRIMARY KEY (leaver_id, successor_id));
-- 目錄對應表: an internal id (unit / channel / person) -> its real folder under the workspace. Folder names never change; names shown are read from the entity.
-- 換部門: the project channels of the old unit are kept by default; the old head decides (pending -> kept | removed). The person's own folder is never touched.
CREATE TABLE IF NOT EXISTS unit_change_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, unit_id TEXT NOT NULL, room_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','kept','removed')), created_by TEXT, created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER);
CREATE TABLE IF NOT EXISTS dir_map (kind TEXT NOT NULL CHECK (kind IN ('unit','channel','person')), id TEXT NOT NULL, folder TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (kind, id));
`;

const KEY = Symbol.for("tigerai:db");
type Holder = { path: string; db: SqlDb };

/** The community driver: node:sqlite, WAL, owner-only file. */
function openSqlite(path: string): SqlDb {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  // Early development schema of the prompt library carried group_ids on the row; the ticks table replaces it.
  try {
    const cols = db.prepare("PRAGMA table_info(prompts)").all() as unknown as { name: string }[];
    if (cols.some((c) => c.name === "group_ids")) db.exec("DROP TABLE prompts");
  } catch { /* no table yet */ }
  db.exec(SCHEMA);
  // Webhooks get a display name (Chinese allowed) apart from the lowercase id used in tool calls (0.1.x gen1-v7).
  try { db.exec("ALTER TABLE group_join_codes ADD COLUMN phrase TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
  try { db.exec("ALTER TABLE n8n_webhooks ADD COLUMN display_name TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
  // 1.1.2-ce: the HTTP method an n8n Webhook node listens on (n8n defaults to GET, the Portal used to send only POST).
  try { db.exec("ALTER TABLE n8n_webhooks ADD COLUMN method TEXT NOT NULL DEFAULT 'POST'"); } catch { /* already there */ }
  // Databases created before the AI participant existed lack the column.
  try { db.exec("ALTER TABLE room_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'"); } catch { /* already there */ }
  // Where an assignment came from: 'person' (a member handed it over), 'ai' or 'n8n' (created through the inbound hook). v9.
  try { db.exec("ALTER TABLE assignments ADD COLUMN source TEXT NOT NULL DEFAULT 'person'"); } catch { /* already there */ }
  // v11: an order can be handed to an AI that works in the background. assignee_kind 'user' | 'ai' (existing rows stay 'user');
  // for 'ai' the assignee_id is 'ai:<agent id or general>' (nobody can log in as that), agent_id the role (null = 一般 AI),
  // run_state 'running' | 'review' (the status column keeps the old CHECK set: SQLite cannot alter a CHECK, and 'accepted' fits both).
  for (const col of ["assignee_kind TEXT NOT NULL DEFAULT 'user'", "agent_id TEXT", "run_state TEXT", "run_started_at INTEGER", "ai_result TEXT", "ai_note TEXT", "run_count INTEGER NOT NULL DEFAULT 0", "room_id TEXT"]) {
    try { db.exec(`ALTER TABLE assignments ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  // v1.1: the maintenance (虎智) account is a flag, never a role (the role CHECK stays admin|member);
  // a class (group) can be archived at the end of a term; idle sign-out remembers the last real user input per person.
  for (const stmt of ["ALTER TABLE users ADD COLUMN is_vendor INTEGER NOT NULL DEFAULT 0", "ALTER TABLE groups ADD COLUMN archived_at INTEGER", "ALTER TABLE user_activity ADD COLUMN last_input INTEGER"]) {
    try { db.exec(stmt); } catch { /* already there */ }
  }
  // Room close / soft delete (gen1 UI batch).
  for (const col of ["closed_at INTEGER", "closed_by TEXT", "deleted_at INTEGER", "deleted_by TEXT"]) {
    try { db.exec(`ALTER TABLE rooms ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  // feat/ce-org: optional employee number (unique), when a person left, and the unit a channel is filed under (NULL = 跨部門頻道).
  for (const stmt of ["ALTER TABLE users ADD COLUMN employee_id TEXT", "ALTER TABLE users ADD COLUMN left_at INTEGER", "ALTER TABLE rooms ADD COLUMN unit_id TEXT", "ALTER TABLE rooms ADD COLUMN is_unit_default INTEGER NOT NULL DEFAULT 0"]) {
    try { db.exec(stmt); } catch { /* already there */ }
  }
  // 1.1.0-ce: 工作週報 / 訊息分析 hand a 「確認」 交辦單 to the person who confirms; the run remembers it so the two stay in step.
  try { db.exec("ALTER TABLE wizard_runs ADD COLUMN confirm_assignment_id TEXT"); } catch { /* already there */ }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id ON users (employee_id COLLATE NOCASE) WHERE employee_id IS NOT NULL");
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return db as unknown as SqlDb;
}

export function dbPath(): string {
  return join(dataDir(), "tigerai.db");
}

export function getDb(): SqlDb {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  const path = dbPath();
  const held = g[KEY];
  if (held && held.path === path) return held.db;
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const driver = registeredStoreDriver();
  if (driver) {
    const db = driver.open({ dataDir: dir, schema: SCHEMA });
    g[KEY] = { path, db };
    return db;
  }
  const db = openSqlite(path);
  g[KEY] = { path, db };
  return db;
}

/** Test helper: drop the cached handle. */
export function closeDb(): void {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  try { g[KEY]?.db.close(); } catch { /* already closed */ }
  g[KEY] = undefined;
}

const DEPTH = Symbol.for("tigerai:tx-depth");
function depthHolder(): { n: number } {
  const g = globalThis as unknown as Record<symbol, { n: number } | undefined>;
  return (g[DEPTH] ??= { n: 0 });
}

/**
 * Run `fn` atomically. Calls nest: the outermost is a real transaction, an inner one is a SAVEPOINT, so a function that opens its own
 * transaction (leaveUser, applyUnitChange) can be used inside a bigger all-or-nothing run (the org.xlsx import) without a second BEGIN.
 */
export function inTransaction<T>(fn: () => T): T {
  const r = transaction(() => ({ value: fn(), commit: true }));
  return r;
}

/** Like inTransaction, but `fn` also says whether to keep the work: `commit: false` rolls it back and still returns the value (a preview). */
export function transaction<T>(fn: () => { value: T; commit: boolean }): T {
  const db = getDb();
  const d = depthHolder();
  const name = `tg_sp${d.n}`;
  db.exec(d.n === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
  d.n += 1;
  let out: { value: T; commit: boolean };
  try {
    out = fn();
  } catch (error) {
    d.n -= 1;
    try { db.exec(d.n === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`); } catch { /* already rolled back */ }
    throw error;
  }
  d.n -= 1;
  if (out.commit) db.exec(d.n === 0 ? "COMMIT" : `RELEASE ${name}`);
  else db.exec(d.n === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
  return out.value;
}
