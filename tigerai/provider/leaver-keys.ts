// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { chmodSync, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";

/**
 * What happens to a person's own model connections (provider/personal.ts) when they leave (decision 5):
 *   - at once: every connection is switched off (the keys stay on disk but nothing can use them);
 *   - 30 days later: the key files are deleted. Everything else of the person is kept.
 *   - coming back inside the 30 days switches the connections that were on back on; after that the keys are gone for good.
 * Standalone on purpose (fs only): accounts/service.ts calls it from updateUser, and personal.ts imports accounts/service.
 * It edits connections.json directly, in the same shape personal.ts writes. A key is never read, logged or returned here.
 */

export const KEY_RETENTION_MS = 30 * 86_400_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const root = () => join(dataDir(), "personal-models");
const dirOf = (userId: string): string | null => (SAFE_ID.test(userId) ? join(root(), userId) : null);

/** A preview runs the real code inside a transaction it rolls back; files are not part of a transaction, so a dry run touches none. */
const DRY = Symbol.for("tigerai:keys-dry-run");
export function withKeysDryRun<T>(fn: () => T): T {
  const g = globalThis as unknown as Record<symbol, boolean | undefined>;
  const prev = g[DRY];
  g[DRY] = true;
  try { return fn(); } finally { g[DRY] = prev; }
}
const dry = (): boolean => !!(globalThis as unknown as Record<symbol, boolean | undefined>)[DRY];

interface Marker { disabledAt: number; wasEnabled: string[]; purgedAt?: number }

function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}
function readJson<T>(file: string): T | null { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return null; } }

type Doc = { connections?: { id?: unknown; enabled?: unknown }[] };

/** Switch every connection off and remember which were on. Idempotent: a second call keeps the first date. */
export function disableLeaverKeys(userId: string, now = Date.now()): { connections: number } {
  if (dry()) return { connections: 0 };
  const dir = dirOf(userId);
  if (!dir || !existsSync(dir)) return { connections: 0 };
  const markerFile = join(dir, "leaver.json");
  const doc = readJson<Doc>(join(dir, "connections.json"));
  const conns = Array.isArray(doc?.connections) ? doc!.connections! : [];
  const existing = readJson<Marker>(markerFile);
  if (existing && !existing.purgedAt) return { connections: conns.length };
  const wasEnabled = conns.filter((c) => c && c.enabled !== false && typeof c.id === "string").map((c) => c.id as string);
  if (conns.length === 0 && !readdirSync(dir).some((f) => f.startsWith("key-"))) return { connections: 0 };
  for (const c of conns) if (c) c.enabled = false;
  if (doc) atomicWrite(join(dir, "connections.json"), JSON.stringify(doc, null, 2) + "\n");
  atomicWrite(markerFile, JSON.stringify({ disabledAt: now, wasEnabled } satisfies Marker));
  return { connections: conns.length };
}

/** The person is back: switch the connections that were on back on, if their keys still exist. */
export function restoreLeaverKeys(userId: string): { restored: number; keysGone: boolean } {
  if (dry()) return { restored: 0, keysGone: false };
  const dir = dirOf(userId);
  const marker = dir ? readJson<Marker>(join(dir, "leaver.json")) : null;
  if (!dir || !marker) return { restored: 0, keysGone: false };
  try { unlinkSync(join(dir, "leaver.json")); } catch { /* already gone */ }
  if (marker.purgedAt) return { restored: 0, keysGone: true };
  const doc = readJson<Doc>(join(dir, "connections.json"));
  let restored = 0;
  if (doc && Array.isArray(doc.connections)) {
    for (const c of doc.connections) if (c && typeof c.id === "string" && marker.wasEnabled.includes(c.id)) { c.enabled = true; restored += 1; }
    atomicWrite(join(dir, "connections.json"), JSON.stringify(doc, null, 2) + "\n");
  }
  return { restored, keysGone: false };
}

/** Delete the key files of everyone who left more than 30 days ago. Returns the people it acted on. Safe to call often. */
export function purgeDueKeys(now = Date.now()): string[] {
  const base = root();
  if (!existsSync(base)) return [];
  const done: string[] = [];
  for (const id of readdirSync(base)) {
    const dir = dirOf(id);
    if (!dir) continue;
    const marker = readJson<Marker>(join(dir, "leaver.json"));
    if (!marker || marker.purgedAt || now - marker.disabledAt < KEY_RETENTION_MS) continue;
    for (const f of readdirSync(dir)) if (f.startsWith("key-")) { try { unlinkSync(join(dir, f)); } catch { /* best effort */ } }
    atomicWrite(join(dir, "leaver.json"), JSON.stringify({ disabledAt: marker.disabledAt, wasEnabled: [], purgedAt: now } satisfies Marker));
    done.push(id);
  }
  return done;
}

export function leaverKeyState(userId: string): { disabledAt: number; purgedAt: number | null; daysLeft: number } | null {
  const dir = dirOf(userId);
  const m = dir ? readJson<Marker>(join(dir, "leaver.json")) : null;
  if (!m) return null;
  return { disabledAt: m.disabledAt, purgedAt: m.purgedAt ?? null, daysLeft: m.purgedAt ? 0 : Math.max(0, Math.ceil((m.disabledAt + KEY_RETENTION_MS - Date.now()) / 86_400_000)) };
}
