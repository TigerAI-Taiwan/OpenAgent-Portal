// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { MAX_ATTACH_BYTES } from "./budget";

/** One-off .md/.txt attachment in a member's own conversation: the text is put into that prompt, never stored. Pure (used by the browser and tests). */
export { MAX_ATTACH_BYTES };

export function checkAttachment(f: { name: string; size: number }): { ok: true } | { ok: false; reason: "type" | "size" | "empty" } {
  if (!/\.(md|txt)$/i.test(f.name)) return { ok: false, reason: "type" };
  if (f.size === 0) return { ok: false, reason: "empty" };
  if (f.size > MAX_ATTACH_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

/** Strict UTF-8, or null. */
export function decodeAttachment(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""); } catch { return null; }
}

/** The text that goes into the prompt for one attachment. */
export function attachBlock(name: string, text: string): string {
  return `【附件：${name}】\n${text.trim()}\n【附件結束】`;
}
