// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { ServiceError, type Role } from "../accounts/service";
import { getRoom, requireRoom, isHeadOfRoom } from "../rooms/service";
import { isRoomMember } from "../rooms/ownership";
import { visibleTargets, viewReason } from "../userlog/service";
import { CHANNEL_SUBS, PERSON_SUBS, companyAnnouncementsFolder, folderPath } from "./map";

/**
 * The read-only directory tree. Nothing here writes, renames or deletes a file: it lists what the mapping (map.ts) says exists
 * and what the viewer may see, and reads a file for them. Every rule is decided here on the server; the page only draws it.
 *
 * Who sees what (permissions do not follow the tree, they follow the relationship that exists NOW):
 *   全公司/公告                 every signed-in person
 *   部門/<單位>                 members and heads of that unit, administrators (sub-units are not included: no inheritance)
 *   頻道/<頻道>/…               channel members, administrators, and heads of a unit one of the members belongs to (audited like opening the channel);
 *                              an archived channel: administrators only
 *   個人/<人>/我的產出, 我的檔案   the person; the heads of the units they are a direct member of; administrators; a successor of a leaver. Anyone but
 *                              the person is read-only and EVERY view is written to the audit log.
 *   個人/<人>/給我的提醒          the person only
 *   個人/<人>/給我的監督與稽核    the person, and administrators
 */

export interface Viewer { id: string; role: Role }
export type EntryKind = "folder" | "file" | "link";
export interface Entry { id: string; name: string; kind: EntryKind; size?: number; modified?: number; note?: string; disabled?: boolean }
export interface Crumb { id: string; name: string }
export type Described =
  | { kind: "folder"; id: string; name: string; crumbs: Crumb[]; entries: Entry[]; note?: string }
  | { kind: "file"; id: string; name: string; crumbs: Crumb[]; file: { name: string; size: number; mime: string; text: string | null; truncated: boolean; markdown: boolean } };

const MAX_TEXT = 1024 * 1024;
export const MAX_FILE = 20 * 1024 * 1024;
const MAX_ENTRIES = 500;
const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".csv", ".json", ".log"]);
const MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8", ".markdown": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8", ".json": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8",
  ".pdf": "application/pdf", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};
/** Shown in the page itself (the rest is a download). */
const INLINE = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".md", ".markdown", ".txt", ".csv", ".json", ".log"]);
export const mimeOf = (name: string) => MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
export const inlineOk = (name: string) => INLINE.has(extname(name).toLowerCase());

const notFound = () => new ServiceError("not_found", "Not found", 404);

// ------------------------------------------------------------------ node ids

interface Node { raw: string; head: string; arg: string; rest: string[] }

/** `chan:rabc/每日摘要/2026-11-15.md` -> head "chan", arg "rabc", rest ["每日摘要","2026-11-15.md"]. Anything odd is "not found". */
export function parseNode(id: string): Node {
  if (!id || id.length > 600) throw notFound();
  const segs = id.split("/");
  for (const p of segs) if (!p || p === "." || p === ".." || /[\0\\]/.test(p)) throw notFound();
  const [first, ...rest] = segs;
  const colon = first.indexOf(":");
  const head = colon < 0 ? first : first.slice(0, colon);
  const arg = colon < 0 ? "" : first.slice(colon + 1);
  if (!["root", "co", "units", "cross", "unit", "chan", "people", "person"].includes(head)) throw notFound();
  if (["unit", "chan", "person"].includes(head) && !/^[A-Za-z0-9_-]{1,64}$/.test(arg)) throw notFound();
  return { raw: id, head, arg, rest };
}

// ------------------------------------------------------------------ relationships

const sql = <T>(q: string, ...a: unknown[]) => getDb().prepare(q).all(...(a as never[])) as unknown as T[];
const one = <T>(q: string, ...a: unknown[]) => getDb().prepare(q).get(...(a as never[])) as unknown as T | undefined;

function unitRow(id: string) { return one<{ id: string; name: string; parent_id: string | null }>("SELECT id,name,parent_id FROM groups WHERE id=?", id); }
function inUnit(v: Viewer, unitId: string): boolean { return !!one("SELECT 1 FROM memberships WHERE user_id=? AND group_id=?", v.id, unitId); }
function canSeeUnit(v: Viewer, unitId: string): boolean { return v.role === "admin" || inUnit(v, unitId); }

/** Same idea as requireRoom, without throwing and without writing an audit row (listing a folder is not opening the channel). */
function roomVisible(v: Viewer, roomId: string, deleted: boolean): boolean {
  if (deleted) return v.role === "admin";
  return v.role === "admin" || isRoomMember(roomId, v.id) || isHeadOfRoom(v.id, roomId);
}

function visibleRooms(v: Viewer, unitId: string | null): { id: string; name: string; deleted_at: number | null; is_unit_default: number }[] {
  const rows = unitId
    ? sql<{ id: string; name: string; deleted_at: number | null; is_unit_default: number }>("SELECT id,name,deleted_at,is_unit_default FROM rooms WHERE unit_id=? ORDER BY is_unit_default DESC, name", unitId)
    : sql<{ id: string; name: string; deleted_at: number | null; is_unit_default: number }>("SELECT id,name,deleted_at,is_unit_default FROM rooms WHERE unit_id IS NULL ORDER BY name");
  return rows.filter((r) => roomVisible(v, r.id, !!r.deleted_at));
}

type SubRule = (reason: NonNullable<ReturnType<typeof viewReason>>) => boolean;
const SUB_RULES: Record<(typeof PERSON_SUBS)[number], SubRule> = {
  "給我的提醒": (r) => r === "self",
  "給我的監督與稽核": (r) => r === "self" || r === "admin",
  "我的產出": () => true,
  "我的檔案": () => true,
};

// ------------------------------------------------------------------ real folders (read only)

/** Walk `rel` below `root` one segment at a time; a symbolic link anywhere refuses the whole path. */
function realPath(root: string, rel: string[]): string {
  let p = root;
  for (const part of rel) {
    p = join(p, part);
    let st;
    try { st = lstatSync(p); } catch { throw notFound(); }
    if (st.isSymbolicLink()) throw notFound();
  }
  return p;
}

function listReal(idPrefix: string, root: string, rel: string[]): Entry[] {
  let dir: string;
  try { dir = realPath(root, rel); } catch (e) { if (rel.length === 0) return []; throw e; }
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: Entry[] = [];
  for (const n of names.sort((a, b) => a.localeCompare(b, "zh-Hant"))) {
    if (n.startsWith(".")) continue;
    let st;
    try { st = lstatSync(join(dir, n)); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    const id = `${idPrefix}/${n}`;
    if (st.isDirectory()) out.push({ id, name: n, kind: "folder", modified: st.mtimeMs });
    else if (st.isFile()) out.push({ id, name: n, kind: "file", size: st.size, modified: st.mtimeMs });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1));
}

function describeReal(id: string, name: string, crumbs: Crumb[], root: string, rel: string[]): Described {
  const p = realPath(root, rel);
  const st = statSync(p);
  if (st.isDirectory()) return { kind: "folder", id, name, crumbs, entries: listReal(id, root, rel) };
  if (!st.isFile()) throw notFound();
  const fname = rel[rel.length - 1];
  const ext = extname(fname).toLowerCase();
  let text: string | null = null;
  let truncated = false;
  if (TEXT_EXT.has(ext)) {
    const buf = readFileSync(p);
    truncated = buf.length > MAX_TEXT;
    text = buf.subarray(0, MAX_TEXT).toString("utf8");
  }
  return { kind: "file", id, name: fname, crumbs, file: { name: fname, size: st.size, mime: mimeOf(fname), text, truncated, markdown: ext === ".md" || ext === ".markdown" } };
}

/** The bytes of a file the viewer may read, for download. */
export function readBytes(viewer: Viewer, id: string): { name: string; bytes: Buffer } {
  const loc = locateFile(viewer, id);
  const st = statSync(loc.path);
  if (!st.isFile() || st.size > MAX_FILE) throw notFound();
  return { name: loc.name, bytes: readFileSync(loc.path) };
}

// ------------------------------------------------------------------ names and breadcrumbs

function nameOf(_viewer: Viewer, id: string): string {
  const n = parseNode(id);
  if (n.rest.length) return n.rest[n.rest.length - 1];
  switch (n.head) {
    case "root": return "目錄";
    case "co": return "全公司";
    case "units": return "部門";
    case "cross": return "跨部門頻道";
    case "people": return "個人";
    case "unit": return unitRow(n.arg)?.name ?? n.arg;
    case "chan": return getRoom(n.arg)?.name ?? n.arg;
    default: return one<{ name: string }>("SELECT name FROM users WHERE id=?", n.arg)?.name ?? n.arg;
  }
}
const SUB_NAME: Record<string, string> = { chans: "頻道", members: "成員", sub: "子單位", ann: "公告" };

function crumbsFor(v: Viewer, id: string): Crumb[] {
  const n = parseNode(id);
  const out: Crumb[] = [{ id: "root", name: "目錄" }];
  const push = (cid: string, name: string) => out.push({ id: cid, name });
  if (n.head === "root") return out.slice(0, 1);
  if (n.head === "people" || n.head === "person") {
    push("people", "個人");
    if (n.head === "person") { push(`person:${n.arg}`, nameOf(v, `person:${n.arg}`)); n.rest.forEach((_, i) => push(`person:${n.arg}/${n.rest.slice(0, i + 1).join("/")}`, n.rest[i])); }
    return out;
  }
  push("co", "全公司");
  if (n.head === "co") { n.rest.forEach((r, i) => push(`co/${n.rest.slice(0, i + 1).join("/")}`, SUB_NAME[r] ?? r)); return out; }
  if (n.head === "cross") return (push("cross", "跨部門頻道"), out);
  if (n.head === "chan") {
    const room = getRoom(n.arg);
    if (room?.unit_id && canSeeUnit(v, room.unit_id)) { push("units", "部門"); push(`unit:${room.unit_id}`, nameOf(v, `unit:${room.unit_id}`)); push(`unit:${room.unit_id}/chans`, "頻道"); } else push("cross", "跨部門頻道");
    push(`chan:${n.arg}`, room?.name ?? n.arg);
    n.rest.forEach((_, i) => push(`chan:${n.arg}/${n.rest.slice(0, i + 1).join("/")}`, n.rest[i]));
    return out;
  }
  push("units", "部門");
  if (n.head === "unit") {
    const chain: string[] = [];
    let cur: string | null = n.arg;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) { seen.add(cur); chain.unshift(cur); cur = unitRow(cur)?.parent_id ?? null; if (cur && !canSeeUnit(v, cur)) break; }
    for (const u of chain) push(`unit:${u}`, nameOf(v, `unit:${u}`));
    if (n.rest[0]) push(`unit:${n.arg}/${n.rest[0]}`, SUB_NAME[n.rest[0]] ?? n.rest[0]);
  }
  return out;
}

// ------------------------------------------------------------------ describe

const folder = (id: string, name: string, crumbs: Crumb[], entries: Entry[], note?: string): Described => ({ kind: "folder", id, name, crumbs, entries, note });
const f = (id: string, name: string, extra: Partial<Entry> = {}): Entry => ({ id, name, kind: "folder", ...extra });

/** Pass a person's id; "(已離職)" tells the viewer why a name is greyed out. */
function personNote(status: string): string | undefined { return status === "active" ? undefined : "已離職或停用"; }

function auditPerson(v: Viewer, reason: string, targetId: string, node: string): void {
  if (reason === "self") return;
  writeAudit("dir.person_view", v.id, { userId: targetId, scope: reason === "handover" ? "handover" : reason, file: node.slice(0, 160) });
}

export function describe(v: Viewer, id: string): Described {
  const n = parseNode(id);
  const crumbs = crumbsFor(v, id);
  const name = nameOf(v, id);
  switch (n.head) {
    case "root":
      return folder(id, name, crumbs, [f("co", "全公司"), f("people", "個人")]);
    case "co": {
      if (n.rest.length === 0) return folder(id, name, crumbs, [f("co/ann", "公告"), f("units", "部門"), f("cross", "跨部門頻道")]);
      if (n.rest[0] === "ann") return describeReal(id, name, crumbs, companyAnnouncementsFolder(), n.rest.slice(1));
      throw notFound();
    }
    case "units": {
      if (n.rest.length) throw notFound();
      const all = sql<{ id: string; name: string; parent_id: string | null }>("SELECT id,name,parent_id FROM groups ORDER BY name");
      const ids = new Set(all.map((g) => g.id));
      const mine = all.filter((g) => canSeeUnit(v, g.id));
      // Administrators see the real tree (top units here, sub-units inside); everyone else sees their own units as a flat list with the full path.
      const shown = v.role === "admin" ? mine.filter((g) => !g.parent_id || !ids.has(g.parent_id)) : mine;
      return folder(id, name, crumbs, shown.map((g) => f(`unit:${g.id}`, v.role === "admin" ? g.name : pathLabel(g.id))));
    }
    case "cross": {
      if (n.rest.length) throw notFound();
      return folder(id, name, crumbs, visibleRooms(v, null).map((r) => f(`chan:${r.id}`, r.name, r.deleted_at ? { note: "已封存" } : {})));
    }
    case "unit": {
      const u = unitRow(n.arg);
      if (!u || !canSeeUnit(v, n.arg)) throw notFound();
      if (n.rest.length === 0) {
        const hasChildren = v.role === "admin" && !!one("SELECT 1 FROM groups WHERE parent_id=?", n.arg);
        return folder(id, name, crumbs, [f(`unit:${n.arg}/chans`, "頻道"), f(`unit:${n.arg}/members`, "成員"), ...(hasChildren ? [f(`unit:${n.arg}/sub`, "子單位")] : [])]);
      }
      if (n.rest.length > 1) throw notFound();
      if (n.rest[0] === "chans") return folder(id, SUB_NAME.chans, crumbs, visibleRooms(v, n.arg).map((r) => f(`chan:${r.id}`, r.name, { note: r.deleted_at ? "已封存" : r.is_unit_default ? "部門頻道" : "專案頻道" })));
      if (n.rest[0] === "sub") {
        if (v.role !== "admin") throw notFound();
        return folder(id, SUB_NAME.sub, crumbs, sql<{ id: string; name: string }>("SELECT id,name FROM groups WHERE parent_id=? ORDER BY name", n.arg).map((g) => f(`unit:${g.id}`, g.name)));
      }
      if (n.rest[0] === "members") {
        const rows = sql<{ id: string; name: string; status: string; is_manager: number }>("SELECT u.id,u.name,u.status,m.is_manager FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.is_manager DESC, u.name", n.arg);
        return folder(id, SUB_NAME.members, crumbs, rows.map((r) => {
          const ok = viewReason(v, r.id) !== null;
          const note = [r.is_manager ? "主管" : "", personNote(r.status) ?? ""].filter(Boolean).join(" · ");
          return { id: `person:${r.id}`, name: r.name, kind: "link" as const, disabled: !ok, ...(note ? { note } : {}) };
        }), "成員是連結:點開會到他的個人目錄(要有權限才開得了)。");
      }
      throw notFound();
    }
    case "chan": {
      const room = getRoom(n.arg);
      if (!room) throw notFound();
      requireRoom(v, n.arg, { allowDeleted: true }); // 404 when not allowed; audits a head's reading
      if (room.deleted_at && v.role !== "admin") throw notFound();
      if (n.rest.length === 0) return folder(id, name, crumbs, CHANNEL_SUBS.map((s) => f(`chan:${n.arg}/${s}`, s)), room.deleted_at ? "這個頻道已封存(資料永久保留)。" : undefined);
      if (!(CHANNEL_SUBS as readonly string[]).includes(n.rest[0])) throw notFound();
      return describeReal(id, name, crumbs, folderPath("channel", n.arg), n.rest);
    }
    case "people": {
      if (n.rest.length) throw notFound();
      const me = one<{ id: string; name: string; status: string }>("SELECT id,name,status FROM users WHERE id=?", v.id);
      const others = visibleTargets(v);
      const entries: Entry[] = [];
      if (me) entries.push({ id: `person:${me.id}`, name: me.name, kind: "folder", note: "我自己" });
      for (const t of others) entries.push({ id: `person:${t.id}`, name: t.name, kind: "folder", ...(personNote(t.status) ? { note: personNote(t.status) } : {}) });
      return folder(id, name, crumbs, entries, "只列出你有權限看的人;看別人的個人目錄是唯讀,每一次都會記在稽核紀錄。");
    }
    case "person": {
      const reason = viewReason(v, n.arg);
      if (!reason) throw notFound();
      if (n.rest.length === 0) {
        auditPerson(v, reason, n.arg, id);
        return folder(id, name, crumbs, PERSON_SUBS.filter((s) => SUB_RULES[s](reason)).map((s) => f(`person:${n.arg}/${s}`, s)), reason === "self" ? undefined : "唯讀;每次查看都會記在稽核紀錄。");
      }
      const sub = n.rest[0] as (typeof PERSON_SUBS)[number];
      if (!(PERSON_SUBS as readonly string[]).includes(sub) || !SUB_RULES[sub](reason)) throw notFound();
      auditPerson(v, reason, n.arg, id);
      return describeReal(id, name, crumbs, folderPath("person", n.arg), n.rest);
    }
  }
  throw notFound();
}

function pathLabel(unitId: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = unitId;
  while (cur && !seen.has(cur)) { seen.add(cur); const g = unitRow(cur); if (!g) break; names.unshift(g.name); cur = g.parent_id; }
  return names.join(" / ");
}

/** The real file behind a file node, after the same permission checks `describe` does. */
export function locateFile(v: Viewer, id: string): { path: string; name: string } {
  const d = describe(v, id);
  if (d.kind !== "file") throw notFound();
  const n = parseNode(id);
  let root: string;
  let rel: string[];
  if (n.head === "co") { root = companyAnnouncementsFolder(); rel = n.rest.slice(1); }
  else if (n.head === "chan") { root = folderPath("channel", n.arg); rel = n.rest; }
  else if (n.head === "person") { root = folderPath("person", n.arg); rel = n.rest; }
  else throw notFound();
  return { path: realPath(root, rel), name: d.name };
}
