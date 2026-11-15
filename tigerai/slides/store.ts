// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";
import { ServiceError, type Role } from "../accounts/service";
import { roomDir, requireRoom } from "../rooms/service";

/**
 * Where a made deck lives and who may download it.
 *  - Made in a channel: <room folder>/slides/<id>/ — it goes away with the channel's own purge — and every channel member (and
 *    a head or administrator who may read the channel, exactly requireRoom's rule) can download.
 *  - Made in someone's own conversation: <data>/slides-personal/<owner>/<id>/ — the owner only.
 * The id is `<scope>-<12 hex>` and is parsed strictly, so it can never name another path. A person who may not see the channel gets
 * 404 (the channel's existence is not revealed), the same answer as an id that does not exist.
 */

export interface DeckMeta { id: string; title: string; roomId: string | null; ownerId: string; createdAt: number; slides: number; hasPdf: boolean; pdfNote?: string }
const ID = /^([ru][0-9a-f]{12})-([0-9a-f]{12})$/;

function dirOf(scope: string, id: string): string {
  return scope.startsWith("r") ? join(roomDir(scope), "slides", id) : join(dataDir(), "slides-personal", scope, id);
}

export function saveDeck(input: { roomId: string | null; ownerId: string; title: string; slides: number; pptx: Buffer; pdf: Buffer | null; pdfNote?: string }): DeckMeta {
  const scope = input.roomId ?? input.ownerId;
  if (!/^[ru][0-9a-f]{12}$/.test(scope)) throw new ServiceError("bad_scope", "Cannot store a deck for this conversation");
  const id = `${scope}-${randomBytes(6).toString("hex")}`;
  const dir = dirOf(scope, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "deck.pptx"), input.pptx, { mode: 0o600 });
  if (input.pdf) writeFileSync(join(dir, "deck.pdf"), input.pdf, { mode: 0o600 });
  const meta: DeckMeta = { id, title: input.title, roomId: input.roomId, ownerId: input.ownerId, createdAt: Date.now(), slides: input.slides, hasPdf: !!input.pdf, ...(input.pdfNote ? { pdfNote: input.pdfNote } : {}) };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
  return meta;
}

/** The deck and its file, or a 404 for anyone who may not have it. */
export function openDeck(actor: { id: string; role: Role }, id: string, format: "pdf" | "pptx"): { meta: DeckMeta; file: Buffer } {
  const m = ID.exec(id);
  if (!m) throw new ServiceError("not_found", "Not found", 404);
  const scope = m[1];
  const dir = dirOf(scope, id);
  let meta: DeckMeta;
  try { meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as DeckMeta; } catch { throw new ServiceError("not_found", "Not found", 404); }
  if (meta.id !== id) throw new ServiceError("not_found", "Not found", 404);
  if (scope.startsWith("r")) {
    try { requireRoom(actor, scope); } catch { throw new ServiceError("not_found", "Not found", 404); }
  } else if (meta.ownerId !== actor.id) throw new ServiceError("not_found", "Not found", 404);
  const path = join(dir, format === "pdf" ? "deck.pdf" : "deck.pptx");
  if (!existsSync(path)) throw new ServiceError("no_pdf", format === "pdf" ? "This deck has no PDF (the conversion service was not available)" : "Not found", 404);
  return { meta, file: readFileSync(path) };
}
