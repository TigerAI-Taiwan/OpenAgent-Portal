// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../config";
import { getDb } from "../../db/store";
import { getRoom } from "../../rooms/service";
import { deliverExternalItem, recordExternalRun } from "../engine";
import { stripEnd } from "../format";
import type { Summary } from "./summarize";

/** Tables of the meeting feature, created on first use (own file: the shared schema in db/store.ts is not touched). */
export function ensureTables(): void {
  const g = globalThis as unknown as Record<symbol, string | undefined>;
  const key = Symbol.for("tigerai:meeting-tables");
  const path = join(dataDir(), "tigerai.db");
  if (g[key] === path) return;
  getDb().exec(`
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, room_id TEXT, title TEXT NOT NULL, source TEXT NOT NULL,
  audio_name TEXT, audio_bytes INTEGER, status TEXT NOT NULL, failed_stage TEXT, error TEXT,
  summary TEXT, line_count INTEGER NOT NULL DEFAULT 0, asr_ms INTEGER, posted_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meetings_owner ON meetings (owner_id, created_at);
CREATE INDEX IF NOT EXISTS meetings_room ON meetings (room_id, created_at);
CREATE TABLE IF NOT EXISTS meeting_uploads (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, room_id TEXT, name TEXT NOT NULL, title TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_action_links (
  meeting_id TEXT NOT NULL, idx INTEGER NOT NULL, assignment_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, idx)
);
`);
  migratePrivateItems();
  g[key] = path;
}

export const meetingsDir = (): string => join(dataDir(), "meetings");
export const meetingDir = (id: string): string => join(meetingsDir(), id);
export const uploadsDir = (): string => join(meetingsDir(), "_uploads");
export function ensureDir(p: string): string { mkdirSync(p, { recursive: true, mode: 0o700 }); return p; }

export const transcriptPath = (id: string): string => join(meetingDir(id), "transcript.txt");
export const crosscheckPath = (id: string): string => join(meetingDir(id), "crosscheck.json");

/** What the 對照模型 pass left for a meeting: the marked lines and the measured times. Absent for meetings made before 1.1.2-ce. */
export interface CrosscheckFile {
  version: 1; enabled: boolean; mainMs: number | null; compareMs: number | null; wallMs: number | null; agreement: number | null; error?: string;
  flags: { line: number; kinds: ("disagree" | "glossary")[]; other?: string; term?: string }[];
}
export function writeCrosscheck(id: string, v: CrosscheckFile): void { ensureDir(meetingDir(id)); writeFileSync(crosscheckPath(id), JSON.stringify(v) + "\n", { mode: 0o600 }); }
export function readCrosscheck(id: string): CrosscheckFile | null {
  try { const v = JSON.parse(readFileSync(crosscheckPath(id), "utf8")) as CrosscheckFile; return v && v.version === 1 && Array.isArray(v.flags) ? v : null; } catch { return null; }
}
export function writeTranscript(id: string, lines: string[]): void { ensureDir(meetingDir(id)); writeFileSync(transcriptPath(id), lines.join("\n") + "\n", { mode: 0o600 }); }
export function readTranscriptLines(id: string): string[] {
  try { return readFileSync(transcriptPath(id), "utf8").split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")); } catch { return []; }
}

export interface MeetingRow {
  id: string; owner_id: string; room_id: string | null; title: string; source: "paste" | "audio"; audio_name: string | null; audio_bytes: number | null;
  status: "transcribing" | "summarizing" | "done" | "failed"; failed_stage: string | null; error: string | null; summary: string | null;
  line_count: number; asr_ms: number | null; posted_at: number | null; created_at: number; updated_at: number;
}
export const getMeeting = (id: string): MeetingRow | null => { ensureTables(); return (getDb().prepare("SELECT * FROM meetings WHERE id=?").get(id) as unknown as MeetingRow) ?? null; };
export function parseSummaryJson(row: MeetingRow): Summary | null { try { return row.summary ? (JSON.parse(row.summary) as Summary) : null; } catch { return null; } }

/**
 * Early builds kept 提醒/監督 in their own table `wizard_private_items`. The shared engine (公佈欄 個人區 + bell) now holds them:
 * copy what is there (only rows that still have a source and whose meeting's room still exists), then drop the table. Runs once per
 * database; a database that never had the table does nothing. The copy never fails the caller: an old row that cannot be moved is left behind.
 */
function migratePrivateItems(): void {
  const db = getDb();
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wizard_private_items'").get()) return;
    const rows = db.prepare("SELECT * FROM wizard_private_items").all() as unknown as { user_id: string; kind: string; title: string; body: string; sources: string; ref_id: string | null }[];
    let moved = 0;
    for (const r of rows) {
      const m = r.ref_id ? (db.prepare("SELECT room_id FROM meetings WHERE id=?").get(r.ref_id) as { room_id: string | null } | undefined) : undefined;
      const room = m?.room_id ? getRoom(m.room_id) : null;
      if (!room || (r.kind !== "remind" && r.kind !== "supervise")) continue;
      let src: { label: string; quote: string }[] = [];
      try { src = JSON.parse(r.sources); } catch { /* unreadable: skipped below */ }
      const run = recordExternalRun({ kind: "meeting", roomId: room.id, runnerId: room.owner_id, requestedBy: null, ref: r.ref_id! });
      if (deliverExternalItem(run, { aspect: r.kind, userId: r.user_id, text: `${stripEnd(r.title)}。${r.body}`, sources: src.map((x) => ({ t: "x" as const, label: x.label, quote: x.quote })) })) moved++;
    }
    db.exec("DROP TABLE wizard_private_items");
    void moved;
  } catch { /* keep the old table; try again next start */ }
}
