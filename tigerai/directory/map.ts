// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/store";
import { workspaceRoot } from "../config";
import { ServiceError } from "../accounts/service";

/**
 * 目錄對應 (the directory mapping API). The Portal shows one tree
 *   全公司/ 公告, 部門/<單位>/{頻道/<頻道>/…, 成員}, 跨部門頻道/<頻道>/…
 *   個人/<人>/{給我的提醒, 給我的監督與稽核, 我的產出, 我的檔案}
 * but nothing on disk is named after a unit, a channel or a person: a folder is named after the entity's INTERNAL id and never
 * renamed (a rename, a re-parent or a 換部門 changes the display tree, not a single path). `dir_map` records, per entity, which
 * folder (relative to the workspace root) holds its files; names for display come from the entity row each time.
 *
 * Other modules (wizard outputs, meeting summaries, exports) get their folder from here and never build a path themselves:
 *     channelFolder(roomId, "每日摘要")   -> absolute folder of a channel's sub-folder (created, owner-only mode)
 *     personFolder(userId, "給我的提醒")  -> absolute folder of a person's sub-folder (created)
 *     unitFolder(unitId)                 -> absolute folder of a unit's own files
 * Adding a new kind of output means adding a sub-folder name here, nowhere else.
 */

export const CHANNEL_SUBS = ["每日摘要", "工作週報", "訊息分析", "檔案"] as const;
export const PERSON_SUBS = ["給我的提醒", "給我的監督與稽核", "我的產出", "我的檔案"] as const;
export type ChannelSub = (typeof CHANNEL_SUBS)[number];
export type PersonSub = (typeof PERSON_SUBS)[number];
export type DirKind = "unit" | "channel" | "person";

const SUB_OK = (list: readonly string[], sub: string) => list.includes(sub);

/** The folder a new entity gets: the same layout the Portal has always used, so existing data stays where it is. */
function defaultFolder(kind: DirKind, id: string): string {
  const db = getDb();
  if (kind === "person") {
    const u = db.prepare("SELECT dir_name FROM users WHERE id=?").get(id) as { dir_name: string } | undefined;
    if (!u) throw new ServiceError("not_found", "No such person", 404);
    return join("users", u.dir_name);
  }
  if (kind === "unit") {
    const g = db.prepare("SELECT dir_name FROM groups WHERE id=?").get(id) as { dir_name: string } | undefined;
    if (!g) throw new ServiceError("not_found", "No such unit", 404);
    return join("groups", g.dir_name);
  }
  if (!db.prepare("SELECT 1 FROM rooms WHERE id=?").get(id)) throw new ServiceError("not_found", "No such channel", 404);
  return join("rooms", id);
}

/** The relative folder recorded for this entity (recorded on first use, then fixed for good). */
export function mappedFolder(kind: DirKind, id: string): string {
  const db = getDb();
  const row = db.prepare("SELECT folder FROM dir_map WHERE kind=? AND id=?").get(kind, id) as { folder: string } | undefined;
  if (row) return row.folder;
  const folder = defaultFolder(kind, id);
  db.prepare("INSERT OR IGNORE INTO dir_map (kind,id,folder,created_at) VALUES (?,?,?,?)").run(kind, id, folder, Date.now());
  return folder;
}

function absolute(rel: string): string {
  if (rel.split(/[\\/]/).includes("..")) throw new ServiceError("bad_path", "Invalid folder");
  return join(workspaceRoot(), rel);
}

function ensure(dir: string): string { mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }

export function unitFolder(unitId: string): string { return ensure(absolute(mappedFolder("unit", unitId))); }
export function channelRoot(roomId: string): string { return ensure(absolute(mappedFolder("channel", roomId))); }
export function personRoot(userId: string): string { return ensure(absolute(mappedFolder("person", userId))); }

export function channelFolder(roomId: string, sub: ChannelSub): string {
  if (!SUB_OK(CHANNEL_SUBS, sub)) throw new ServiceError("bad_folder", "Unknown channel folder");
  return ensure(join(channelRoot(roomId), sub));
}
export function personFolder(userId: string, sub: PersonSub): string {
  if (!SUB_OK(PERSON_SUBS, sub)) throw new ServiceError("bad_folder", "Unknown personal folder");
  return ensure(join(personRoot(userId), sub));
}
/** 全公司/公告: files every signed-in person may read (read only in the tree). */
export function companyAnnouncementsFolder(): string { return ensure(join(workspaceRoot(), "company", "公告")); }

/** The displayed path of something, as names (the tree shows these; folders on disk never carry them). */
export function displayPath(kind: DirKind, id: string, sub?: string): string[] {
  const db = getDb();
  if (kind === "person") {
    const u = db.prepare("SELECT name FROM users WHERE id=?").get(id) as { name: string } | undefined;
    return ["個人", u?.name ?? id, ...(sub ? [sub] : [])];
  }
  if (kind === "unit") return ["全公司", "部門", ...unitPathNames(id)];
  const r = db.prepare("SELECT name, unit_id FROM rooms WHERE id=?").get(id) as { name: string; unit_id: string | null } | undefined;
  if (!r) return ["全公司"];
  const base = r.unit_id ? ["全公司", "部門", ...unitPathNames(r.unit_id), "頻道"] : ["全公司", "跨部門頻道"];
  return [...base, r.name, ...(sub ? [sub] : [])];
}

/** 營運處 / 業務部 — the names from the top unit down. Broken data (loop, missing parent) ends the walk. */
export function unitPathNames(unitId: string): string[] {
  const db = getDb();
  const names: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = unitId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const g = db.prepare("SELECT name, parent_id FROM groups WHERE id=?").get(cur) as { name: string; parent_id: string | null } | undefined;
    if (!g) break;
    names.unshift(g.name);
    cur = g.parent_id;
  }
  return names;
}

/** Where an entity's folder is, WITHOUT creating it (viewing must not write). */
export function folderPath(kind: DirKind, id: string): string { return absolute(mappedFolder(kind, id)); }
