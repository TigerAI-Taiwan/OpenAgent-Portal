// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, renameSync, statSync, truncateSync } from "node:fs";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { getDb } from "../../db/store";
import { writeAudit } from "../../accounts/audit";
import { ServiceError, listUsers } from "../../accounts/service";
import { accessFlags, getRoom, listMembers, requireRoom, roomIsOpen } from "../../rooms/service";
import { withAiSlot } from "../../workorders/ai-run";
import { effectiveBaseUrl, effectiveDefaultModel, effectiveKey } from "../../provider/settings";
import { requireVisible } from "../../workorders/assignments";
import { transcribeFile } from "./asr-client";
import { asrConfigured } from "./asr-settings";
import { wizardHost } from "./host";
import {
  ensureDir, ensureTables, getMeeting, meetingDir, parseSummaryJson, readTranscriptLines, transcriptPath, uploadsDir, writeTranscript, type MeetingRow,
} from "./store";
import {
  MAX_TRANSCRIPT_CHARS, SYSTEM_PROMPT, assignmentPrefill, buildUserPrompt, parseSummary, renderSummary, segmentTranscript, todayOf, type Person, type Summary,
} from "./summarize";

type Actor = { id: string; role: "admin" | "member" };

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
export const CHUNK_MAX_BYTES = 16 * 1024 * 1024;
export const AUDIO_TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".webm": "audio/webm" };

/** Test seam: the model call. Returns the model's raw text. */
export type ModelCall = (system: string, user: string) => Promise<string>;
let modelCall: ModelCall = gatewayChat;
export function setModelCall(fn: ModelCall | null): void { modelCall = fn ?? gatewayChat; }

async function gatewayChat(system: string, user: string): Promise<string> {
  const base = effectiveBaseUrl().url;
  if (!base) throw new Error("No model connection is configured");
  const key = effectiveKey();
  const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(10 * 60_000),
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: effectiveDefaultModel(), temperature: 0.2, max_tokens: 8000, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`The model service answered ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return String(j.choices?.[0]?.message?.content ?? "");
}

/** Test seam: where transcription runs (default: the configured service). */
export type Transcriber = (path: string, name: string, mime: string) => Promise<string>;
let transcriber: Transcriber = transcribeFile;
export function setTranscriber(fn: Transcriber | null): void { transcriber = fn ?? transcribeFile; }

const ACTIVE = Symbol.for("tigerai:meeting-active");
const active = (): Set<string> => ((globalThis as unknown as Record<symbol, Set<string> | undefined>)[ACTIVE] ??= new Set());

const safeError = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\S*\/\S*/g, "").replace(/\s+/g, " ").trim().slice(0, 200);

// ---------------------------------------------------------------- access

function canSee(actor: Actor, m: MeetingRow): boolean {
  if (actor.role === "admin" || m.owner_id === actor.id) return true;
  if (!m.room_id) return false;
  const room = getRoom(m.room_id);
  return !!room && !room.deleted_at && listMembers(m.room_id).some((x) => x.id === actor.id);
}
export function requireMeeting(actor: Actor, id: string): MeetingRow {
  const m = getMeeting(id);
  if (!m || !canSee(actor, m)) throw new ServiceError("not_found", "No such meeting", 404);
  return m;
}
function requireOwner(actor: Actor, id: string): MeetingRow {
  const m = requireMeeting(actor, id);
  if (m.owner_id !== actor.id && actor.role !== "admin") throw new ServiceError("forbidden", "Only the person who started this meeting record can do this", 403);
  return m;
}
/** A room the actor may post into (member of an open room). */
function requirePostRoom(actor: Actor, roomId: string): void {
  const room = requireRoom(actor, roomId);
  if (!accessFlags(actor, room).canPost) throw new ServiceError("room_closed", "You cannot post in this room", 409);
}

export function capabilities() { return { asrConfigured: asrConfigured(), maxAudioBytes: MAX_AUDIO_BYTES, types: Object.keys(AUDIO_TYPES), maxTranscriptChars: MAX_TRANSCRIPT_CHARS }; }

// ---------------------------------------------------------------- views

function peopleFor(m: MeetingRow): Person[] {
  if (m.room_id) return listMembers(m.room_id);
  return listUsers().filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name }));
}
const dayOf = (ms: number) => todayOf(ms);

export function view(actor: Actor, m: MeetingRow, full = false) {
  const links = getDb().prepare("SELECT idx, assignment_id AS assignmentId FROM meeting_action_links WHERE meeting_id=?").all(m.id) as unknown as { idx: number; assignmentId: string }[];
  const owner = (getDb().prepare("SELECT name FROM users WHERE id=?").get(m.owner_id) as { name: string } | undefined)?.name ?? "?";
  const base = {
    id: m.id, title: m.title, source: m.source, roomId: m.room_id, status: m.status, failedStage: m.failed_stage, error: m.error, lineCount: m.line_count,
    audioName: m.audio_name, audioBytes: m.audio_bytes, ownerName: owner, mine: m.owner_id === actor.id, postedAt: m.posted_at, createdAt: m.created_at, updatedAt: m.updated_at,
    asrMs: m.asr_ms,
  };
  if (!full) return base;
  const lines = readTranscriptLines(m.id);
  const summary = parseSummaryJson(m);
  const meta = { title: m.title, date: dayOf(m.created_at) };
  return {
    ...base, lines, summary, links,
    markdown: summary ? renderSummary(meta, summary, lines, "personal") : null,
    prefills: summary && m.owner_id === actor.id ? summary.actions.map((a) => assignmentPrefill(meta, a, lines)) : [],
  };
}

export function listMeetings(actor: Actor, roomId?: string) {
  ensureTables();
  sweepStale();
  if (roomId) {
    requireRoom(actor, roomId);
    const rows = getDb().prepare("SELECT * FROM meetings WHERE room_id=? ORDER BY created_at DESC LIMIT 50").all(roomId) as unknown as MeetingRow[];
    return rows.filter((m) => canSee(actor, m)).map((m) => view(actor, m));
  }
  const rows = getDb().prepare("SELECT * FROM meetings WHERE owner_id=? ORDER BY created_at DESC LIMIT 50").all(actor.id) as unknown as MeetingRow[];
  return rows.map((m) => view(actor, m));
}

export function getView(actor: Actor, id: string) { ensureTables(); sweepStale(); return view(actor, requireMeeting(actor, id), true); }

/** A job that was running when the process stopped never finishes: show it as failed so the person can retry. */
function sweepStale(): void {
  const cutoff = Date.now() - 2 * 60_000;
  const rows = getDb().prepare("SELECT id, status FROM meetings WHERE status IN ('transcribing','summarizing') AND updated_at<?").all(cutoff) as unknown as { id: string; status: string }[];
  for (const r of rows) {
    if (active().has(r.id)) continue;
    getDb().prepare("UPDATE meetings SET status='failed', failed_stage=?, error=?, updated_at=? WHERE id=?").run(r.status === "transcribing" ? "transcribe" : "summary", "處理被中斷(伺服器重新啟動),請按重試。", Date.now(), r.id);
  }
}

// ---------------------------------------------------------------- create

function cleanTitle(v: unknown, fallback: string): string { const t = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80); return t || fallback; }

export function createFromText(actor: Actor, input: { title?: unknown; transcript?: unknown; roomId?: unknown }): MeetingRow {
  ensureTables();
  const raw = String(input.transcript ?? "");
  if (!raw.trim()) throw new ServiceError("empty_transcript", "The transcript is empty");
  if (raw.length > MAX_TRANSCRIPT_CHARS) throw new ServiceError("transcript_too_long", `The transcript is too long (limit ${MAX_TRANSCRIPT_CHARS} characters); paste it in parts`);
  const roomId = typeof input.roomId === "string" && input.roomId ? input.roomId : null;
  if (roomId) requirePostRoom(actor, roomId);
  const lines = segmentTranscript(raw);
  const id = randomUUID(); const now = Date.now();
  writeTranscript(id, lines);
  getDb().prepare("INSERT INTO meetings (id,owner_id,room_id,title,source,status,line_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, actor.id, roomId, cleanTitle(input.title, `會議 ${dayOf(now)}`), "paste", "summarizing", lines.length, now, now);
  writeAudit("meeting.create", actor.id, { meetingId: id, roomId, source: "paste", chars: raw.length });
  launch(id);
  return getMeeting(id)!;
}

const uploading = new Set<string>();

export function startUpload(actor: Actor, input: { name?: unknown; size?: unknown; title?: unknown; roomId?: unknown }) {
  ensureTables();
  if (!asrConfigured()) throw new ServiceError("asr_not_configured", "The administrator has not set up the speech-to-text service yet", 409);
  const name = String(input.name ?? "").replace(/[\\/]/g, "_").slice(0, 120);
  const ext = extname(name).toLowerCase();
  if (!AUDIO_TYPES[ext]) throw new ServiceError("bad_type", "Only mp3, m4a, wav or webm audio files are accepted");
  const size = Number(input.size);
  if (!Number.isInteger(size) || size <= 0) throw new ServiceError("bad_size", "The file size is not valid");
  if (size > MAX_AUDIO_BYTES) throw new ServiceError("too_large", `The file is larger than ${MAX_AUDIO_BYTES / 1024 / 1024} MB`, 413);
  const roomId = typeof input.roomId === "string" && input.roomId ? input.roomId : null;
  if (roomId) requirePostRoom(actor, roomId);
  const id = randomUUID();
  ensureDir(uploadsDir());
  getDb().prepare("INSERT INTO meeting_uploads (id,user_id,room_id,name,title,size,created_at) VALUES (?,?,?,?,?,?,?)").run(id, actor.id, roomId, name, cleanTitle(input.title, name.replace(/\.[^.]+$/, "") || "會議"), size, Date.now());
  return { uploadId: id, chunkBytes: 8 * 1024 * 1024 };
}

function upload(actor: Actor, id: string) {
  const u = getDb().prepare("SELECT * FROM meeting_uploads WHERE id=?").get(id) as unknown as { id: string; user_id: string; room_id: string | null; name: string; title: string; size: number } | undefined;
  if (!u || u.user_id !== actor.id) throw new ServiceError("not_found", "No such upload", 404);
  return u;
}
const partPath = (id: string) => join(uploadsDir(), `${id}.part`);

/** Append one chunk straight to disk. The body is piped, never collected; the declared total is a hard cap. */
export async function appendChunk(actor: Actor, id: string, offset: number, body: ReadableStream<Uint8Array> | null): Promise<{ received: number }> {
  ensureTables();
  const u = upload(actor, id);
  if (uploading.has(id)) throw new ServiceError("busy", "A chunk of this upload is still being written", 409);
  const path = partPath(id);
  const have = existsSync(path) ? statSync(path).size : 0;
  if (offset !== have) throw new ServiceError("bad_offset", `Expected offset ${have}`, 409);
  if (!body) throw new ServiceError("empty_chunk", "The chunk is empty");
  const room = Math.min(CHUNK_MAX_BYTES, u.size - have);
  if (room <= 0) throw new ServiceError("too_large", "The file is already complete", 413);
  uploading.add(id);
  let n = 0;
  const limit = new Transform({ transform(chunk: Buffer, _enc, cb) { n += chunk.length; if (n > room) cb(new ServiceError("chunk_too_large", "The chunk is larger than allowed", 413)); else cb(null, chunk); } });
  try {
    ensureDir(uploadsDir());
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), limit, createWriteStream(path, { flags: "a", mode: 0o600 }));
  } catch (e) {
    // Drop what a failed chunk wrote, so the client can send the same offset again.
    try { truncateSync(path, have); } catch { /* none */ }
    throw e instanceof ServiceError ? e : new ServiceError("upload_failed", "The upload was interrupted", 400);
  } finally { uploading.delete(id); }
  return { received: statSync(path).size };
}

export function finishUpload(actor: Actor, id: string): MeetingRow {
  ensureTables();
  const u = upload(actor, id);
  const path = partPath(id);
  const got = existsSync(path) ? statSync(path).size : 0;
  if (got !== u.size) throw new ServiceError("incomplete", `Received ${got} of ${u.size} bytes`, 409);
  if (!asrConfigured()) throw new ServiceError("asr_not_configured", "The administrator has not set up the speech-to-text service yet", 409);
  const mid = randomUUID(); const now = Date.now();
  const dir = ensureDir(meetingDir(mid));
  renameSync(path, join(dir, `audio${extname(u.name).toLowerCase()}`));
  getDb().prepare("INSERT INTO meetings (id,owner_id,room_id,title,source,audio_name,audio_bytes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(mid, actor.id, u.room_id, u.title, "audio", u.name, u.size, "transcribing", now, now);
  getDb().prepare("DELETE FROM meeting_uploads WHERE id=?").run(id);
  writeAudit("meeting.create", actor.id, { meetingId: mid, roomId: u.room_id, source: "audio", bytes: u.size });
  launch(mid);
  return getMeeting(mid)!;
}

// ---------------------------------------------------------------- jobs

function setStatus(id: string, status: MeetingRow["status"], patch: { stage?: string | null; error?: string | null } = {}): void {
  getDb().prepare("UPDATE meetings SET status=?, failed_stage=?, error=?, updated_at=? WHERE id=?").run(status, patch.stage ?? null, patch.error ?? null, Date.now(), id);
}

/** Run the pipeline in the background; returns at once. A second launch for the same meeting is ignored. */
export function launch(id: string): Promise<void> {
  if (active().has(id)) return Promise.resolve();
  active().add(id);
  return runPipeline(id).catch((e) => { console.error("[tigerai] meeting pipeline:", safeError(e)); }).finally(() => active().delete(id));
}

async function runPipeline(id: string): Promise<void> {
  let m = getMeeting(id)!;
  if (m.status === "transcribing") {
    const started = Date.now();
    try {
      const dir = meetingDir(id);
      const ext = extname(m.audio_name ?? "").toLowerCase();
      const text = await transcriber(join(dir, `audio${ext}`), m.audio_name ?? `audio${ext}`, AUDIO_TYPES[ext] ?? "application/octet-stream");
      if (text.length > MAX_TRANSCRIPT_CHARS) throw new Error(`The transcript is longer than ${MAX_TRANSCRIPT_CHARS} characters`);
      const lines = segmentTranscript(text);
      writeTranscript(id, lines);
      getDb().prepare("UPDATE meetings SET line_count=?, asr_ms=?, status='summarizing', failed_stage=NULL, error=NULL, updated_at=? WHERE id=?").run(lines.length, Date.now() - started, Date.now(), id);
      writeAudit("asr.transcribe", m.owner_id, { meetingId: id, bytes: m.audio_bytes ?? 0, ms: Date.now() - started, outcome: "ok", lines: lines.length });
    } catch (e) {
      const why = safeError(e);
      setStatus(id, "failed", { stage: "transcribe", error: `轉文字沒有完成:${why}` });
      writeAudit("asr.transcribe", m.owner_id, { meetingId: id, bytes: m.audio_bytes ?? 0, ms: Date.now() - started, outcome: "failed", reason: why });
      return;
    }
    m = getMeeting(id)!;
  }
  if (m.status !== "summarizing") return;
  const lines = readTranscriptLines(id);
  const people = peopleFor(m);
  const today = todayOf();
  try {
    const raw = await withAiSlot(() => modelCall(SYSTEM_PROMPT, buildUserPrompt(lines, { title: m.title, today, people })));
    const summary = parseSummary(raw, { lineCount: lines.length, today, people });
    if (!summary) throw new Error("AI 的回答格式不對,沒有可用的內容");
    const kept = summary.decisions.length + summary.actions.length + summary.suggestions.length;
    if (kept === 0 && summary.dropped > 0) throw new Error("AI 整理出來的項目都沒有附上逐字稿出處,已全部擋下");
    getDb().prepare("UPDATE meetings SET summary=?, status='done', failed_stage=NULL, error=NULL, updated_at=? WHERE id=?").run(JSON.stringify(summary), Date.now(), id);
    writeAudit("meeting.summary", m.owner_id, { meetingId: id, decisions: summary.decisions.length, actions: summary.actions.length, dropped: summary.dropped });
    if (m.room_id) deliver(getMeeting(id)!, summary, lines);
  } catch (e) {
    setStatus(id, "failed", { stage: "summary", error: `這次整理沒有完成:${safeError(e)}` });
    if (m.room_id && roomIsOpen(m.room_id)) wizardHost().postToRoom(m.room_id, `會議「${m.title}」這次整理沒有完成。原因:${safeError(e)}。上傳的人可以在「上傳會議錄音」的會議記錄裡按重試。`, `${m.id}:failed:${Date.now()}`, m.owner_id, false);
  }
}

/** Post the draft to the room; then the private parts: 提醒 to each owner who is a person, 監督 to the supervisors. Nothing is decided here. */
function deliver(m: MeetingRow, s: Summary, lines: string[]): void {
  const host = wizardHost();
  const meta = { title: m.title, date: dayOf(m.created_at) };
  if (m.posted_at) return;
  if (!m.room_id || !roomIsOpen(m.room_id)) return;
  if (host.postToRoom(m.room_id, renderSummary(meta, s, lines, "room"), m.id, m.owner_id)) getDb().prepare("UPDATE meetings SET posted_at=? WHERE id=?").run(Date.now(), m.id);
  const sources = (a: { lines: number[] }) => a.lines.slice(0, 3).map((n) => ({ label: `會議「${m.title}」第 ${n} 行`, quote: (lines[n - 1] ?? "").slice(0, 80) }));
  for (const a of s.actions) {
    if (!a.ownerId) continue;
    host.deliverPrivate({ userId: a.ownerId, kind: "remind", title: `會議待辦:${a.task}`.slice(0, 120), body: `${a.due ? `期限 ${a.due}。` : "期限未定。"}這是 AI 依會議逐字稿整理的提醒,不是正式的交辦單。`, sources: sources(a), refId: m.id }, m.room_id!);
  }
  const unowned = s.actions.filter((a) => a.unowned);
  if (unowned.length) {
    for (const uid of host.supervisorsOf(m.room_id)) {
      host.deliverPrivate({ userId: uid, kind: "supervise", title: `會議「${m.title}」有 ${unowned.length} 件事沒人負責`, body: unowned.map((a) => `- ${a.task}`).join("\n"), sources: unowned.flatMap(sources).slice(0, 6), refId: m.id }, m.room_id!);
    }
  }
}

export function retry(actor: Actor, id: string): MeetingRow {
  const m = requireOwner(actor, id);
  if (m.status !== "failed") throw new ServiceError("not_failed", "Only a failed meeting can be retried", 409);
  if (m.failed_stage === "transcribe") {
    if (!asrConfigured()) throw new ServiceError("asr_not_configured", "The administrator has not set up the speech-to-text service yet", 409);
    setStatus(id, "transcribing");
  } else setStatus(id, "summarizing");
  launch(id);
  return getMeeting(id)!;
}

export function transcriptFile(actor: Actor, id: string): { path: string; filename: string } {
  const m = requireMeeting(actor, id);
  if (!existsSync(transcriptPath(m.id))) throw new ServiceError("no_transcript", "There is no transcript yet", 409);
  writeAudit("meeting.download", actor.id, { meetingId: id });
  return { path: transcriptPath(m.id), filename: `${m.title.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "meeting"}-逐字稿.txt` };
}

/** Called by the page after the person pressed 建立 in the prefilled 交辦單 form. The assignment must be theirs. */
export function linkAction(actor: Actor, id: string, idx: number, assignmentId: string): void {
  const m = requireOwner(actor, id);
  const s = parseSummaryJson(m);
  if (!s || !Number.isInteger(idx) || idx < 0 || idx >= s.actions.length) throw new ServiceError("bad_action", "No such action item");
  const a = requireVisible(actor, assignmentId);
  if (a.applicantId !== actor.id) throw new ServiceError("forbidden", "That assignment is not yours", 403);
  getDb().prepare("INSERT OR REPLACE INTO meeting_action_links (meeting_id,idx,assignment_id,user_id,created_at) VALUES (?,?,?,?,?)").run(id, idx, assignmentId, actor.id, Date.now());
  writeAudit("meeting.assignment_linked", actor.id, { meetingId: id, assignmentId });
}

