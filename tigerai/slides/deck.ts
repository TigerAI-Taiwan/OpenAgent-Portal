// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import JSZip from "jszip";

/**
 * A deck as plain data, and the .pptx written from it (hand-built OOXML through JSZip, which the product already depends on: no new
 * package). Layout is fixed 16:9 with one built-in template; nothing is fetched at render time. The text is real text (editable in
 * PowerPoint / LibreOffice / Keynote), sources are real hyperlinks.
 *
 * Why this module splits long slides itself: neither PowerPoint nor LibreOffice shrinks text for a file written without a cached
 * font scale, so a student's slide with ten long bullets would run off the page. Points are chunked by estimated line count and the
 * next chunk becomes a "(續)" slide.
 */

export interface Source { title: string; url: string }
export interface SlideIn {
  title: string;
  /** Shown in the accent colour under the title: a student's name, a section label. */
  label?: string;
  points?: string[];
  sources?: Source[];
  /** A comparison table (header row + rows); rendered as a text grid. */
  table?: { headers: string[]; rows: string[][] };
}
export interface DeckIn { title: string; subtitle?: string; slides: SlideIn[]; references?: Source[]; author?: string }

export const FONT = "Noto Sans CJK TC";
const W = 12192000, H = 6858000, IN = 914400;
const ACCENT = "1F4E79", INK = "1A1A1A", MUTED = "5F6B7A", LINK = "0B5CAD", BG = "FFFFFF", DARK = "14304D";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const emu = (i: number) => Math.round(i * IN);

/** Lines a text needs in a box `inches` wide at `pt` size: CJK and full-width glyphs count a full em, others about 0.55. */
export function estimateLines(text: string, pt: number, inches: number): number {
  const perLine = (inches * 72) / pt;
  let used = 0, lines = 1;
  for (const ch of text) {
    const w = /[⺀-鿿＀-￯　-〿]/.test(ch) ? 1 : 0.55;
    if (used + w > perLine) { lines++; used = 0; }
    used += w;
  }
  return lines;
}

interface Para { text: string; link?: string; bullet?: boolean; size: number; bold?: boolean; color?: string }
interface Shape { x: number; y: number; w: number; h: number; paras: Para[][]; fill?: string; anchor?: "t" | "ctr" | "b"; align?: "l" | "ctr" | "r"; autofit?: boolean }
interface SlideSpec { bg: string; shapes: Shape[]; notes?: string }

/** Top of the 資料來源 strip; nothing else may reach below SOURCES_TOP - 0.1. */
export const SOURCES_TOP = 5.95;
const TABLE_PT = 13;
/** Measured table: column width, header cells and the height every row needs for its longest cell (wrapping counted in lines). */
export function planTable(t: { headers: string[]; rows: string[][] }): { cw: number; head: string[]; rows: string[][]; headH: number; heights: number[] } {
  const cols = Math.min(t.headers.length, 5);
  const cw = 12.1 / cols;
  const head = t.headers.slice(0, cols).map((c) => clip(String(c), 24));
  const rows = t.rows.slice(0, 30).map((r) => Array.from({ length: cols }, (_, i) => clip(String(r[i] ?? ""), 80)));
  const hOf = (cells: string[]) => Math.min(1.7, Math.max(0.5, Math.max(...cells.map((c) => estimateLines(c, TABLE_PT, cw - 0.25))) * 0.24 + 0.2));
  return { cw, head, rows, headH: hOf(head), heights: rows.map(hOf) };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function chunkPoints(points: string[], pt: number, widthIn: number, maxLines: number): string[][] {
  const out: string[][] = []; let cur: string[] = []; let used = 0;
  for (const p of points) {
    const l = estimateLines(p, pt, widthIn - 0.4) + 0.35;
    if (cur.length && used + l > maxLines) { out.push(cur); cur = []; used = 0; }
    cur.push(p); used += l;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function planDeck(deck: DeckIn): SlideSpec[] {
  const specs: SlideSpec[] = [];
  // 1. title slide
  specs.push({
    bg: DARK,
    shapes: [
      { x: 0.9, y: 2.2, w: 11.5, h: 1.8, anchor: "b", paras: [[{ text: clip(deck.title, 80), size: 40, bold: true, color: "FFFFFF" }]] },
      { x: 0.9, y: 4.2, w: 11.5, h: 1.2, paras: [[{ text: clip(deck.subtitle ?? "", 160), size: 22, color: "C9D6E6" }], ...(deck.author ? [[{ text: clip(deck.author, 120), size: 16, color: "C9D6E6" }]] : [])] },
    ],
  });
  const all = new Map<string, Source>();
  const note = (s: Source) => { if (!all.has(s.url)) all.set(s.url, s); };
  for (const s of deck.slides) {
    (s.sources ?? []).forEach(note);
    const hasTable = !!s.table && s.table.headers.length > 0;
    const pts = (s.points ?? []).map((p) => clip(String(p), 220));
    const srcs = (s.sources ?? []).slice(0, 4);
    const chunks = pts.length ? chunkPoints(pts, 20, 12.1, hasTable ? 3 : srcs.length ? 9 : 11) : [[]];
    // 1.1.2-ce: a comparison table is measured, never assumed. Rows get the height their longest cell needs; the rows that do not fit above the
    // sources footer (or the page edge) continue on a "(續)" slide with the header repeated. Sources reserve their strip on every slide of a
    // slide that has them (the last one shows them), so a table can never run under the footer.
    const sourcesBottom = SOURCES_TOP - 0.1, pageBottom = 7.1;
    const tbl = hasTable ? planTable(s.table!) : null;
    let rest = tbl ? tbl.rows.map((_, k) => k) : [];
    type Page = { chunk: string[]; i: number; tableRows: number[] | null; y?: number };
    const pages: Page[] = [];
    const header = (cont: boolean): Shape[] => [
      { x: 0, y: 0, w: 13.333, h: 0.22, fill: ACCENT, paras: [] },
      { x: 0.6, y: 0.4, w: 12.1, h: 0.9, anchor: "ctr", paras: [[{ text: clip(s.title, 70) + (cont ? "(續)" : ""), size: 30, bold: true, color: INK }]] },
    ];
    const tableShapes = (rowIdx: number[], y0: number): Shape[] => {
      const t = tbl!; const out: Shape[] = []; let y = y0;
      const put = (cells: string[], h: number, ri: number) => { cells.forEach((cell, ci) => out.push({
        x: 0.6 + ci * t.cw, y, w: t.cw - 0.05, h: h - 0.05, fill: ri === 0 ? ACCENT : ri % 2 ? "EEF3F8" : "FFFFFF", anchor: "ctr",
        paras: [[{ text: cell, size: TABLE_PT, bold: ri === 0, color: ri === 0 ? "FFFFFF" : INK }]],
      })); y += h; };
      put(t.head, t.headH, 0);
      rowIdx.forEach((k) => put(t.rows[k], t.heights[k], k + 1));
      return out;
    };
    /** Rows of `rest` that fit between y and `bottom` once the header row is there (at least one when `force`). */
    const fitTo = (y: number, force: boolean, bottom: number): number[] => {
      const out: number[] = []; let used = y + tbl!.headH;
      for (const k of rest) { if (used + tbl!.heights[k] > bottom && !(force && out.length === 0)) break; used += tbl!.heights[k]; out.push(k); }
      return out;
    };
    // The strip is only drawn on the LAST slide of the table, so only a slide that takes every remaining row has to stay above it.
    const fit = (y: number, force: boolean): number[] => {
      const full = fitTo(y, force, pageBottom);
      return srcs.length && full.length === rest.length ? fitTo(y, force, sourcesBottom) : full;
    };
    chunks.forEach((chunk, i) => {
      let y = 1.3 + (s.label ? 0.6 : 0);
      if (chunk.length) {
        const lines = chunk.reduce((a, p) => a + estimateLines(p, 20, 11.7) + 0.35, 0);
        y += Math.min(Math.max(lines * 0.36, 0.6), 5.0) + 0.1;
      }
      let tableRows: number[] | null = null;
      if (tbl && i === 0) {
        // on the first slide the table sits under the points when at least the header and one row fit there; otherwise it starts on its own slide
        const onTop = fit(y, false);
        if (onTop.length) { tableRows = onTop; rest = rest.filter((k) => !onTop.includes(k)); }
      }
      pages.push({ chunk, i, tableRows, y });
    });
    while (tbl && rest.length) {
      const take = fit(s.label ? 1.9 : 1.45, true);
      pages.push({ chunk: [], i: pages.length, tableRows: take, y: 1.45 });
      rest = rest.filter((k) => !take.includes(k));
    }
    pages.forEach((pg, pi) => {
      const shapes: Shape[] = header(pi > 0);
      let y = 1.3;
      if (s.label) { shapes.push({ x: 0.6, y, w: 12.1, h: 0.5, paras: [[{ text: clip(s.label, 80), size: 18, bold: true, color: ACCENT }]] }); y += 0.6; }
      if (pg.chunk.length) {
        const lines = pg.chunk.reduce((a, p) => a + estimateLines(p, 20, 11.7) + 0.35, 0);
        shapes.push({ x: 0.6, y, w: 12.1, h: Math.min(Math.max(lines * 0.36, 0.6), srcs.length ? 5.9 - y : 6.6 - y), paras: pg.chunk.map((p) => [{ text: p, bullet: true, size: 20, color: INK }]) });
      }
      if (pg.tableRows && tbl) shapes.push(...tableShapes(pg.tableRows, pg.chunk.length ? pg.y! : (s.label ? 1.9 : 1.45)));
      if (pi === pages.length - 1 && srcs.length) {
        shapes.push({ x: 0.6, y: SOURCES_TOP, w: 12.1, h: 1.0, paras: [
          [{ text: "資料來源", size: 11, bold: true, color: MUTED }],
          ...srcs.map((r) => [{ text: `${clip(r.title, 60)}  ${clip(r.url, 90)}`, link: r.url, size: 11, color: LINK }]),
        ] });
      }
      specs.push({ bg: BG, shapes });
    });
  }
  // references: every source of every slide plus the ones the AI listed, one place for the whole deck
  (deck.references ?? []).forEach(note);
  const refs = [...all.values()];
  if (refs.length) {
    for (let i = 0; i < refs.length; i += 8) {
      const part = refs.slice(i, i + 8);
      specs.push({ bg: BG, shapes: [
        { x: 0, y: 0, w: 13.333, h: 0.22, fill: ACCENT, paras: [] },
        { x: 0.6, y: 0.4, w: 12.1, h: 0.9, anchor: "ctr", paras: [[{ text: i === 0 ? "參考資料" : "參考資料(續)", size: 30, bold: true, color: INK }]] },
        { x: 0.6, y: 1.5, w: 12.1, h: 5.2, paras: part.flatMap((r, k) => [
          [{ text: `[${i + k + 1}] ${clip(r.title, 80)}`, size: 16, bold: true, color: INK }],
          [{ text: clip(r.url, 120), link: r.url, size: 13, color: LINK }],
        ]) },
      ] });
    }
  }
  return specs;
}

// ---------------------------------------------------------------- OOXML writing

const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const fontXml = `<a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface="${FONT}"/>`;

function runXml(p: Para, rid: string | null): string {
  const fill = `<a:solidFill><a:srgbClr val="${p.color ?? INK}"/></a:solidFill>`;
  return `<a:r><a:rPr lang="zh-TW" sz="${p.size * 100}" b="${p.bold ? 1 : 0}" dirty="0"${rid ? "" : ""}>${fill}${fontXml}${rid ? `<a:hlinkClick r:id="${rid}"/>` : ""}</a:rPr><a:t>${esc(p.text)}</a:t></a:r>`;
}

function slideXml(spec: SlideSpec, rels: string[]): string {
  let id = 2;
  const shapes = spec.shapes.map((s) => {
    const sid = id++;
    const body = s.paras.length === 0 ? `<a:p><a:endParaRPr lang="zh-TW"/></a:p>` : s.paras.map((line) => {
      const p0 = line[0];
      const ppr = p0.bullet ? `<a:pPr marL="285750" indent="-285750" algn="${s.align ?? "l"}"><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>` : `<a:pPr algn="${s.align ?? "l"}"><a:buNone/></a:pPr>`;
      const runs = line.map((r) => {
        let rid: string | null = null;
        if (r.link) { rels.push(r.link); rid = `rId${rels.length + 1}`; }
        return runXml(r, rid);
      }).join("");
      return `<a:p>${ppr}${runs}</a:p>`;
    }).join("");
    const fill = s.fill ? `<a:solidFill><a:srgbClr val="${s.fill}"/></a:solidFill>` : `<a:noFill/>`;
    return `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="Shape ${sid}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(s.x)}" y="${emu(s.y)}"/><a:ext cx="${emu(s.w)}" cy="${emu(s.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${s.anchor ?? "t"}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;
  }).join("");
  return `${HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${spec.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="OpenAgent"><a:themeElements><a:clrScheme name="OpenAgent"><a:dk1><a:srgbClr val="1A1A1A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="14304D"/></a:dk2><a:lt2><a:srgbClr val="EEF3F8"/></a:lt2><a:accent1><a:srgbClr val="1F4E79"/></a:accent1><a:accent2><a:srgbClr val="2E75B6"/></a:accent2><a:accent3><a:srgbClr val="5F6B7A"/></a:accent3><a:accent4><a:srgbClr val="C55A11"/></a:accent4><a:accent5><a:srgbClr val="548235"/></a:accent5><a:accent6><a:srgbClr val="7F6000"/></a:accent6><a:hlink><a:srgbClr val="0B5CAD"/></a:hlink><a:folHlink><a:srgbClr val="5F6B7A"/></a:folHlink></a:clrScheme><a:fontScheme name="OpenAgent"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relsFile = (items: { id: string; type: string; target: string; external?: boolean }[]) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ` TargetMode="External"` : ""}/>`).join("")}</Relationships>`;

export async function buildPptx(deck: DeckIn): Promise<Buffer> {
  const specs = planDeck(deck);
  const zip = new JSZip();
  const n = specs.length;
  zip.file("[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${specs.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", relsFile([{ id: "rId1", type: `${REL}/officeDocument`, target: "ppt/presentation.xml" }, { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" }]));
  zip.file("docProps/core.xml", `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.title)}</dc:title><dc:creator>OpenAgent Portal</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`);
  zip.file("ppt/presentation.xml", `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${specs.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", relsFile([{ id: "rId1", type: `${REL}/slideMaster`, target: "slideMasters/slideMaster1.xml" }, ...specs.map((_, i) => ({ id: `rId${i + 2}`, type: `${REL}/slide`, target: `slides/slide${i + 1}.xml` })), { id: `rId${n + 2}`, type: `${REL}/theme`, target: "theme/theme1.xml" }]));
  zip.file("ppt/slideMasters/slideMaster1.xml", `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", relsFile([{ id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" }, { id: "rId2", type: `${REL}/theme`, target: "../theme/theme1.xml" }]));
  zip.file("ppt/slideLayouts/slideLayout1.xml", `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relsFile([{ id: "rId1", type: `${REL}/slideMaster`, target: "../slideMasters/slideMaster1.xml" }]));
  zip.file("ppt/theme/theme1.xml", THEME);
  specs.forEach((spec, i) => {
    const links: string[] = [];
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(spec, links));
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, relsFile([{ id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" }, ...links.map((u, k) => ({ id: `rId${k + 2}`, type: `${REL}/hyperlink`, target: u, external: true }))]));
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
