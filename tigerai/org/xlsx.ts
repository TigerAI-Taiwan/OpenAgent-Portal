// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import JSZip from "jszip";

/**
 * A deliberately small .xlsx reader: values only. It reads text and number
 * cells of every sheet and REFUSES a file with formulas (no evaluation, no
 * injection through a computed cell), oversized parts or too many rows.
 */

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PART_BYTES = 20 * 1024 * 1024; // uncompressed, per part: a zip-bomb guard
export const MAX_ROWS_PER_SHEET = 5000;

export type Sheet = { name: string; rows: { row: number; cells: Record<string, string> }[] };

export class XlsxError extends Error {}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

function colLetters(ref: string): string { return /^[A-Z]+/.exec(ref)?.[0] ?? ""; }
function rowNumber(ref: string): number { return Number(/\d+$/.exec(ref)?.[0] ?? 0); }

async function part(zip: JSZip, name: string): Promise<string | null> {
  const f = zip.file(name);
  if (!f) return null;
  const text = await f.async("string");
  if (text.length > MAX_PART_BYTES) throw new XlsxError("The spreadsheet is too large");
  return text;
}

export async function readXlsx(buffer: Buffer): Promise<Sheet[]> {
  if (buffer.length > MAX_FILE_BYTES) throw new XlsxError("The file is larger than 2 MB");
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new XlsxError("This is not an .xlsx file");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer); } catch { throw new XlsxError("This is not an .xlsx file"); }
  const wb = await part(zip, "xl/workbook.xml");
  const rels = await part(zip, "xl/_rels/workbook.xml.rels");
  if (!wb || !rels) throw new XlsxError("This is not an .xlsx workbook");
  const shared: string[] = [];
  const sst = await part(zip, "xl/sharedStrings.xml");
  if (sst) for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(decode([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  const target = new Map<string, string>();
  for (const r of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(r[0])?.[1];
    const t = /\bTarget="([^"]*)"/.exec(r[0])?.[1];
    if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const sheets: Sheet[] = [];
  for (const s of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/\bname="([^"]*)"/.exec(s[0])?.[1] ?? "");
    const rid = /\br:id="([^"]*)"/.exec(s[0])?.[1] ?? "";
    const xml = target.has(rid) ? await part(zip, target.get(rid)!) : null;
    if (!xml) continue;
    if (/<f[ >\/]/.test(xml)) throw new XlsxError(`Sheet "${name}" contains formulas; paste values only`);
    const rows: Sheet["rows"] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: Record<string, string> = {};
      let rowNo = 0;
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1];
        if (!ref) continue;
        rowNo = rowNumber(ref);
        const type = /\bt="([^"]*)"/.exec(c[1])?.[1];
        const inner = c[2] ?? "";
        let value = "";
        if (type === "s") value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1])] ?? "";
        else if (type === "inlineStr") value = decode([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
        else value = decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
        if (value.trim() !== "") cells[colLetters(ref)] = value.trim();
      }
      if (Object.keys(cells).length) rows.push({ row: rowNo, cells });
    }
    if (rows.length > MAX_ROWS_PER_SHEET + 1) throw new XlsxError(`Sheet "${name}" has more than ${MAX_ROWS_PER_SHEET} rows`);
    sheets.push({ name, rows });
  }
  if (sheets.length === 0) throw new XlsxError("The workbook has no readable sheets");
  return sheets;
}
