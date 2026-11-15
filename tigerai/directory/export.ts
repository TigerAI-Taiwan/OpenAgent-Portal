// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { writeAudit } from "../accounts/audit";
import { ServiceError } from "../accounts/service";
import { buildPptx, type DeckIn, type SlideIn, type Source } from "../slides/deck";
import { ConvertError, convertToPdf, converterConfigured } from "../slides/convert";
import { locateFile, type Viewer } from "./tree";

/**
 * 匯出: a Markdown file in the tree becomes a PDF or a .pptx on request, through the same deck builder and Gotenberg converter the
 * make_slides tool uses (no new service). The file is read through locateFile, so the viewer needs exactly the right to read it;
 * the export is audited. Splitting is mechanical (a heading starts a slide), because a clear mapping is easier to trust than a
 * clever summary: the content of the file is the content of the deck.
 */

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const MAX_MD = 512 * 1024;

export function markdownToDeck(md: string, fallbackTitle: string): DeckIn {
  const slides: SlideIn[] = [];
  let deckTitle = "";
  let cur: SlideIn | undefined;
  const refs: Source[] = [];
  const start = (title: string) => { cur = { title: title.slice(0, 120), points: [], sources: [] }; slides.push(cur); };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      if (h[1] === "#" && !deckTitle) { deckTitle = h[2].trim(); continue; }
      start(h[2].trim());
      continue;
    }
    if (!line.trim() || /^\s*(-{3,}|\*{3,})\s*$/.test(line)) continue;
    if (!cur) start(deckTitle || fallbackTitle);
    const c = cur!;
    for (const m of line.matchAll(LINK)) {
      const src = { title: m[1].slice(0, 120), url: m[2] };
      if (!c.sources!.some((x) => x.url === src.url)) c.sources!.push(src);
      if (!refs.some((x) => x.url === src.url)) refs.push(src);
    }
    const text = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(LINK, "$1").replace(/[*_`>#]+/g, "").trim();
    if (text) c.points!.push(text.slice(0, 400));
  }
  if (!slides.length) start(deckTitle || fallbackTitle);
  return { title: (deckTitle || fallbackTitle).slice(0, 120), slides: slides.map((s) => ({ ...s, points: s.points!.length ? s.points : undefined, sources: s.sources!.length ? s.sources : undefined })), references: refs.slice(0, 30) };
}

export async function exportMarkdownNode(viewer: Viewer, nodeId: string, format: "pdf" | "pptx"): Promise<{ filename: string; mime: string; bytes: Buffer }> {
  const loc = locateFile(viewer, nodeId);
  const ext = extname(loc.name).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") throw new ServiceError("not_markdown", "Only Markdown files can be exported", 400);
  const md = readFileSync(loc.path);
  if (md.length > MAX_MD) throw new ServiceError("too_big", "The file is too large to export", 413);
  const base = loc.name.replace(/\.(md|markdown)$/i, "");
  const pptx = await buildPptx(markdownToDeck(md.toString("utf8"), base));
  let bytes = pptx;
  if (format === "pdf") {
    if (!converterConfigured()) throw new ServiceError("converter_off", "PDF export needs the conversion service (Settings > Web)", 409);
    try { bytes = await convertToPdf(pptx); } catch (e) { throw new ServiceError("convert_failed", e instanceof ConvertError ? e.message : "Conversion failed", 502); }
  }
  writeAudit("dir.export", viewer.id, { file: nodeId.slice(0, 160), scope: format });
  return { filename: `${base}.${format}`, mime: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes };
}
