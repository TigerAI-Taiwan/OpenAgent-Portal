// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { createHash } from "node:crypto";
import { getDb } from "../db/store";
import { writeAudit } from "../accounts/audit";
import { writeXlsx, type SheetOut } from "./xlsx-write";

/**
 * Download the current organisation as org.xlsx (the old product's flow: download, edit, upload, preview, apply).
 * Exporting then importing the same file changes nothing: every cell is the current value, `action` is empty, and `status` is only
 * shown (the import ignores it, because a status column is the situation, not what the person meant).
 */

const q = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).all(...(a as never[])) as unknown as T[];

export const UNIT_HEADERS = ["name", "parent", "description", "managers", "confirmers"];
export const MEMBER_HEADERS = ["action", "email", "employeeId", "name", "role", "status", "units"];

export async function exportOrg(actorId: string): Promise<{ filename: string; bytes: Buffer }> {
  const groups = q<{ id: string; name: string; parent_id: string | null; description: string }>("SELECT id,name,parent_id,description FROM groups ORDER BY name");
  const nameById = new Map(groups.map((g) => [g.id, g.name]));
  const mem = q<{ user_id: string; group_id: string; is_manager: number }>("SELECT user_id, group_id, is_manager FROM memberships");
  const users = q<{ id: string; email: string; name: string; role: string; status: string; employee_id: string | null }>("SELECT id,email,name,role,status,employee_id FROM users ORDER BY created_at, email");
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const unitsRows = groups.map((g) => [
    g.name, g.parent_id ? nameById.get(g.parent_id) ?? "" : "", g.description,
    mem.filter((m) => m.group_id === g.id && m.is_manager === 1).map((m) => emailById.get(m.user_id) ?? "").filter(Boolean).sort().join(";"), "",
  ]);
  const memberRows = users.map((u) => [
    "", u.email, u.employee_id ?? "", u.name, u.role, u.status,
    mem.filter((m) => m.user_id === u.id).map((m) => nameById.get(m.group_id) ?? "").filter(Boolean).sort().join(";"),
  ]);
  const help: [string, string][] = [
    ["units.name", "單位名稱(要改既有單位的上層或說明,就寫同一個名稱;沒寫在表裡的單位完全不動)"],
    ["units.parent", "上層單位的名稱;空白＝不改;「-」＝清成最上層"],
    ["units.description", "說明;空白＝不改;「-」＝清空"],
    ["units.managers", "主管的電子郵件,多個用「;」隔開;整批取代;空白＝不改;「-」＝清空。主管要先是啟用中的帳號,離職者不能新指定"],
    ["units.confirmers", "預留欄位(確認人名單)。這一版不使用,請留空"],
    ["members.action", "hire＝任職(沒有帳號就建立、停用中就復職、已在職只給警告);leave＝離職(帳號停用、單位關係保留,頻道改由你接手);空白＝只更新欄位(帳號必須已存在)"],
    ["members.email", "電子郵件,全表唯一;沒有寫在表裡的人完全不動"],
    ["members.employeeId", "員工編號(學校＝學號),選填、全公司唯一;空白＝不改;「-」＝清空"],
    ["members.name", "姓名(不能有空白或 @,也不能叫 AI);空白＝不改。新帳號必填"],
    ["members.role", "admin(管理員)或 member(成員);空白＝不改"],
    ["members.status", "只供參考(現況),匯入時忽略。要停用請寫 action＝leave,要復職請寫 action＝hire"],
    ["members.units", "這個人所屬的全部單位,多個用「;」隔開,整批取代(例如把「財務部」改成「生產部」就是換部門);空白＝不改;「-」＝全部移出"],
    ["通則", "空白＝不改、「-」＝清空;表外的人和單位不動;先預覽再套用,全成功或全不動;檔案裡不放密碼(新帳號的一次性密碼在套用後只顯示一次)"],
  ];
  const rowsN = Math.max(groups.length, help.length, 2);
  const lists: string[][] = [["action", "role", "units", "欄位", "說明"]];
  for (let i = 0; i < rowsN; i++) lists.push([["hire", "leave"][i] ?? "", ["admin", "member"][i] ?? "", groups[i]?.name ?? "", help[i]?.[0] ?? "", help[i]?.[1] ?? ""]);
  const sheets: SheetOut[] = [
    { name: "units", rows: [UNIT_HEADERS, ...unitsRows], widths: [22, 22, 30, 40, 16], dropdowns: [{ col: "B", formula: "units!$A$2:$A$500", prompt: "上層單位(也可以輸入同一份檔案裡新增的單位)" }] },
    { name: "members", rows: [MEMBER_HEADERS, ...memberRows], widths: [10, 30, 14, 16, 10, 10, 36], dropdowns: [{ col: "A", formula: "lists!$A$2:$A$3", prompt: "hire 任職 / leave 離職 / 空白只更新欄位" }, { col: "E", formula: "lists!$B$2:$B$3" }] },
    { name: "lists", rows: lists, widths: [10, 10, 24, 22, 100] },
  ];
  const bytes = await writeXlsx(sheets);
  writeAudit("org.export", actorId, { items: users.length, scope: `units ${groups.length}`, sha256: createHash("sha256").update(bytes).digest("hex").slice(0, 16) });
  return { filename: "org.xlsx", bytes };
}
