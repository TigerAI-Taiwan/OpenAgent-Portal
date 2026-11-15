// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { get, parseDate } from "./validate";
import type { CheckPos, CirclePos, Field, FormDef, Option, Slot, TextField } from "./types";

/**
 * Draws validated values onto the blank PDF as a transparent layer of dark-blue text and marks, so what the machine wrote can be told
 * from the printed form. Never called before validate() found nothing missing or contradictory. Signature, official-use boxes and anything
 * not in the field map stay blank: a person signs a form themselves.
 */
const INK = rgb(0.05, 0.1, 0.55);

export interface Rendered { bytes: Uint8Array; pages: number }

/** Page sizes of a blank PDF (points), for import-time checks. */
export async function pageSizesOf(pdf: Uint8Array): Promise<{ width: number; height: number }[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: false, updateMetadata: false });
  return doc.getPages().map((p) => p.getSize());
}

function stripSuffix(v: string, suf?: string): string { return suf && v.length > 1 && suf.includes(v[v.length - 1]) ? v.slice(0, -1) : v; }

/**
 * A font of at most this size is embedded whole instead of subsetted. fontkit's TrueType subsetter drops some glyphs (digits, names) from Google's
 * CJK fonts (Noto Sans TC, Chocolate Classical Sans, Iansui all reproduced it; AR PL UMing subsets fine) and nothing in the output says so: the
 * PDF opens, the text layer is right, the page shows blanks. The installer therefore ships a pre-subsetted Big5 font (docs/FORMS.md); a larger,
 * unknown font still goes through the subsetter, as before.
 */
export const WHOLE_FONT_MAX = 8 * 1024 * 1024;

export async function renderForm(blank: Uint8Array, def: FormDef, data: Record<string, unknown>, fontBytes: Uint8Array): Promise<{ ok: true; out: Rendered } | { ok: false; problems: string[] }> {
  const doc = await PDFDocument.load(blank, { updateMetadata: false });
  doc.registerFontkit(fontkit);
  let font: PDFFont;
  try { font = await doc.embedFont(fontBytes, { subset: fontBytes.length > WHOLE_FONT_MAX }); } catch (error) { return { ok: false, problems: [`字型無法使用:${error instanceof Error ? error.message : String(error)}`] }; }
  const supported = new Set(font.getCharacterSet());
  const pages = doc.getPages();
  const problems: string[] = [];

  const page = (n: number | undefined): PDFPage => pages[n ?? 0];
  const text = (label: string, value: string, s: Slot) => {
    if (!value) return;
    const missing = [...new Set([...value].filter((c) => !supported.has(c.codePointAt(0)!)))];
    if (missing.length) { problems.push(`${label}:字型沒有這些字 ${missing.join("")},請換字型或改寫`); return; }
    const pg = page(s.page);
    let size = s.size ?? 10.5;
    const min = s.minSize ?? 5.5;
    let w = font.widthOfTextAtSize(value, size);
    while (w > s.x1 - s.x0 && size > min) { size -= 0.25; w = font.widthOfTextAtSize(value, size); }
    if (w > s.x1 - s.x0 + 0.5) { problems.push(`${label}:文字放不進欄位(${value},欄寬 ${(s.x1 - s.x0).toFixed(0)}pt)`); return; }
    const x = s.align === "left" ? s.x0 : s.x0 + (s.x1 - s.x0 - w) / 2;
    pg.drawText(value, { x, y: pg.getHeight() - s.top, size, font, color: INK });
  };
  const check = (c: CheckPos) => {
    const pg = page(c.page); const H = pg.getHeight();
    const cx = c.x + 5; const cy = c.y + 7;
    const line = (x1: number, y1: number, x2: number, y2: number) => pg.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: 1.3, color: INK });
    line(cx - 3.4, cy + 0.2, cx - 1.0, cy + 3.2);
    line(cx - 1.0, cy + 3.2, cx + 4.2, cy - 4.2);
  };
  const circle = (c: CirclePos) => {
    const pg = page(c.page); const H = pg.getHeight();
    const x0 = c.x0 - 2, x1 = c.x1 + 2, y0 = H - c.y1 - 0.5, y1 = H - c.y0 + 0.5;
    pg.drawEllipse({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, xScale: (x1 - x0) / 2, yScale: (y1 - y0) / 2, borderWidth: 0.9, borderColor: INK });
  };
  const mark = (o: Option | undefined) => { if (!o) return; if (o.check) check(o.check); if (o.circle) circle(o.circle); };
  const writeText = (f: TextField, label: string, v: unknown) => {
    const s = stripSuffix(String(v), f.stripSuffix);
    if (f.splitOn && f.slots) { s.split(f.splitOn).forEach((part, i) => { if (f.slots![i]) text(label, part, f.slots![i]); }); return; }
    if (f.slot) text(label, s, f.slot);
  };

  const draw = (f: Field) => {
    const v = get(data, f.key);
    if (v === undefined || v === null || v === "") return;
    switch (f.type) {
      case "text": writeText(f, f.label, v); break;
      case "choice": mark(f.options[String(v)]); break;
      case "multi": for (const k of v as string[]) mark(f.options[k]); break;
      case "bool": if (v === true && f.check) check(f.check); break;
      case "date": {
        const d = parseDate(v);
        if (!d) break;
        const roc = f.rocYear === true || (f.eraField ? get(data, f.eraField) === "roc" : false);
        if (f.parts.year) text(f.label, String(roc ? d.y - 1911 : d.y), f.parts.year);
        if (f.parts.month) text(f.label, String(d.m), f.parts.month);
        if (f.parts.day) text(f.label, String(d.d), f.parts.day);
        break;
      }
      case "group": for (const s of f.fields) { const sv = get(data, `${f.key}.${s.key}`); if (sv !== undefined && sv !== null && sv !== "") writeText(s, `${f.label}${s.label}`, sv); } break;
    }
  };
  for (const f of def.fields) draw(f);
  if (problems.length) return { ok: false, problems };
  const bytes = await doc.save();
  return { ok: true, out: { bytes, pages: pages.length } };
}
