// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: the audit page shows Chinese action names, people's names and a short readable summary instead of
// codes, ids and raw JSON. The stored rows are unchanged (the raw action stays available as a tooltip).

export const AUDIT_ACTION_ZH: Record<string, string> = {
  "auth.login": "登入", "auth.logout": "登出", "auth.login_failed": "登入失敗",
  "user.create": "建立帳號", "user.role": "變更角色", "user.disable": "停用帳號", "user.enable": "啟用帳號", "user.password_reset": "重設密碼", "user.password_change": "變更密碼",
  "group.create": "建立群組", "group.delete": "刪除群組", "group.rename": "單位改名", "group.move": "調整單位上層", "user.employee_id": "設定員工編號", "member.handover": "離職交接", "member.handover_room": "交接頻道擁有者", "member.keys_disabled": "停用離職者的個人金鑰", "member.rejoin": "回任(還原金鑰、結束接手人讀取)", "member.keys_purged": "刪除離職滿 30 天的個人金鑰檔", "member.unit_change": "換部門", "member.unit_room": "專案頻道去留(舊單位主管決定)", "room.unit": "把頻道歸到單位", "dir.person_view": "查看個人目錄(唯讀)", "dir.export": "匯出目錄檔案", "org.export": "匯出組織表", "org.import_item": "匯入組織表(逐項)", "user.rename": "改姓名", "group.member_add": "加入群組成員", "group.member_remove": "移出群組成員",
  "room.create": "建立頻道", "room.join": "加入頻道", "room.member_add": "加入頻道成員", "room.member_remove": "移除頻道成員", "room.warn": "發出警告", "room.close": "關閉頻道",
  "room.reopen": "重新開啟頻道", "agent.menu_add": "把精靈加入我的功能表", "agent.menu_remove": "把精靈移出我的功能表", "agent.personal_create": "建立我的精靈", "agent.personal_update": "修改我的精靈", "agent.personal_delete": "刪除我的精靈", "agent.copy": "複製精靈成我的", "room.delete": "封存頻道", "room.restore": "還原頻道", "room.purge": "永久刪除頻道(管理員手動)", "room.head_view": "主管檢視頻道",
  "room.ai_reply": "頻道 AI 回覆", "room.ai_failed": "頻道 AI 回覆失敗", "room.ai_session": "建立頻道 AI 對話", "room.role_session": "建立頻道 AI 角色對話", "room.bind_session": "綁定頻道對話",
  "agent.create": "建立 AI 角色", "agent.head_create": "部門主管建立 AI 角色", "agent.head_update": "部門主管修改 AI 角色", "knowledge.add": "新增知識檔", "knowledge.replace": "換新版知識檔", "knowledge.delete": "刪除知識檔", "agent.update": "修改 AI 角色", "agent.disable": "停用 AI 角色", "role.session_start": "以 AI 角色開始對話",
  "prompt.create": "建立提示詞", "prompt.update": "修改提示詞", "prompt.delete": "刪除提示詞", "prompt.publish": "上架提示詞", "prompt.tick": "部門採用提示詞", "prompt.untick": "部門取消採用提示詞",
  "workorder.create": "提出分享申請", "workorder.approve": "核可分享申請", "workorder.reject": "駁回分享申請",
  "assignment.create": "建立交辦單", "assignment.accept": "接受交辦單", "assignment.complete": "完成交辦單", "assignment.return": "退回交辦單", "assignment.ai_start": "AI 開始處理交辦單", "assignment.ai_finish": "AI 處理完交辦單(待確認)", "assignment.ai_notify": "通知申請人交辦單待確認",
  "announcement.publish": "發布公告", "announcement.edit": "修改公告", "announcement.delete": "刪除公告", "announcement.ack": "確認公告(我已了解)", "announcement.ai_draft": "AI 起草公告",
  "models.update": "更新模型設定", "model.connection.add": "新增模型連線", "model.connection.update": "修改模型連線", "model.connection.delete": "刪除模型連線", "model.connection.reorder": "調整模型連線順序", "model.fallback": "模型備援(改用其他連線)", "agent.loop_guard": "AI 卡在空的工具呼叫,系統已停止這一輪", "org.import": "匯入組織",
  "mcp.connection.add": "新增系統連接", "mcp.connection.update": "修改系統連接", "mcp.connection.delete": "刪除系統連接", "mcp.connection.test": "測試系統連接", "mcp.tool_call": "AI 使用系統連接的工具", "form.import": "匯入表單", "form.update": "修改表單", "form.delete": "刪除表單", "form.fill": "AI 填表", "form.download": "下載填好的表單", "mcp.write_request": "AI 申請修改 n8n", "mcp.write_grant": "核可 AI 修改 n8n",
  "n8n.mcp_create": "登記 n8n MCP", "n8n.mcp_update": "修改 n8n MCP", "n8n.mcp_delete": "刪除 n8n MCP", "n8n.mcp_call": "呼叫 n8n MCP", "n8n.mcp_denied": "n8n MCP 被拒絕",
  "n8n.webhook_create": "登記 n8n Webhook", "n8n.webhook_update": "修改 n8n Webhook", "n8n.webhook_delete": "刪除 n8n Webhook", "n8n.webhook_call": "呼叫 n8n Webhook", "n8n.webhook_denied": "n8n Webhook 被拒絕",
  "wizard.run": "精靈執行", "wizard.settings": "修改頻道精靈設定", "wizard.confirm": "確認精靈草稿", "wizard.adopt": "採用精靈建議", "wizard.dismiss": "精靈建議不需要", "wizard.ack": "知道了(精靈通知)",
  "wizard.tick": "n8n 排程啟動精靈", "skill.approve": "核准技能建議", "asr.transcribe": "語音轉文字",
  "account.self_register": "自行註冊(待核准或自動核准)", "account.approve": "核准註冊", "account.reject": "拒絕註冊", "joincode.set": "設定班級通關密語", "account.self_register_failed": "自行註冊失敗(通關密語不正確)", "register.setting": "變更「開放自行註冊」", "joincode.rotate": "產生班級加入代碼", "joincode.disable": "停用班級加入代碼",
  "web.setting": "更新上網查資料設定", "web.test": "測試上網查資料或文件轉檔服務", "web.search": "AI 上網搜尋", "web.fetch": "AI 讀取網頁", "slides.make": "AI 製作投影片", "slides.download": "下載投影片",
  "usage.export": "匯出到勤與使用狀況 CSV", "usage.summary": "AI 摘要建議(到勤與使用狀況)",
  "userlog.list": "查看成員的對話列表", "userlog.view": "查看成員的對話內容", "userlog.setting": "變更「主管可查看對話」", "userlog.export": "匯出使用者紀錄 CSV",
  "account.profile": "修改自己的姓名或電子郵件", "auth.idle_logout": "閒置自動登出", "auth.idle_setting": "變更閒置自動登出時間", "vendor.create": "建立虎智維修帳號", "vendor.denied": "維修帳號嘗試開啟不允許的功能", "member.purge": "永久刪除一位成員的個人資料", "n8n.publish": "上架 n8n 流程", "n8n.publish_request": "申請上架 n8n 流程", "n8n.publish_policy": "變更 n8n 上架設定", "wizard.supervise_route": "監督事項轉給部門主管", "class.archive": "封存班級／部門", "class.unarchive": "取消封存班級／部門",
  "n8n.hookkey_create": "建立 n8n 呼叫金鑰", "n8n.hookkey_revoke": "撤銷 n8n 呼叫金鑰", "hook.request": "n8n 呼叫 Portal", "hook.denied": "n8n 呼叫被拒絕",
};
export function auditActionZh(action: string): string { return AUDIT_ACTION_ZH[action] ?? action; }

/** What an id-like key points at; the resolver turns (kind, id) into a name, or undefined when it no longer exists. */
type Kind = "user" | "room" | "group" | "agent" | "prompt" | "assignment" | "announcement";
const REF: Record<string, [Kind, string]> = {
  userId: ["user", "對象"], successorId: ["user", "接手人"], applicant: ["user", "申請人"], assignee: ["user", "承辦人"], roomId: ["room", "頻道"], groupId: ["group", "群組"],
  agentId: ["agent", "AI 角色"], promptId: ["prompt", "提示詞"], assignmentId: ["assignment", "交辦單"], announcementId: ["announcement", "公告"],
};
const KIND_ZH: Record<string, string> = { kept: "保留", removed: "移出", default: "部門頻道", project: "專案頻道", handover: "接手人唯讀查看", admin_fallback: "沒人決定,由管理員接手", successor: "接手人", prompt: "提示詞", agent: "AI 角色", personal: "個人", group: "部門", daily: "每日摘要", weekly: "工作週報", skill: "SKILL 建議", meeting: "會議摘要", adhoc: "訊息分析" };
const ROLE_ZH: Record<string, string> = { admin: "管理員", member: "成員" };
const PLAIN: Record<string, string> = { account: "帳號", ref: "識別碼", connection: "連線", order: "順序", model: "模型", fromConnection: "原連線", toConnection: "改用", connector: "連接", tool: "工具", template: "範本", name: "名稱", email: "電子郵件", reason: "原因", changed: "變更項目", scope: "範圍", outcome: "結果", key: "金鑰名稱", chars: "字數", ms: "耗時(毫秒)", from: "原本", to: "改為", trigger: "觸發", items: "項目數", title: "對話", skill: "技能", file: "檔名", bytes: "大小(位元組)" };

export function auditSummary(extra: string | null, resolve: (kind: Kind, id: string) => string | undefined): string {
  if (!extra) return "";
  let o: Record<string, unknown>;
  try { o = JSON.parse(extra) as Record<string, unknown>; } catch { return ""; }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === "") continue;
    const ref = REF[k];
    if (ref && typeof v === "string") { const n = resolve(ref[0], v); if (n) parts.push(`${ref[1]}:${n}`); continue; }
    if (k === "role" || k === "from" || k === "to") { parts.push(`${PLAIN[k] ?? "角色"}:${ROLE_ZH[String(v)] ?? String(v)}`); continue; }
    if (k === "kind" || k === "scope") { parts.push(`${k === "kind" ? "類型" : "範圍"}:${KIND_ZH[String(v)] ?? String(v)}`); continue; }
    if (k === "isManager") { if (v === true) parts.push("身分:部門主管"); continue; }
    if (PLAIN[k] && (typeof v === "string" || typeof v === "number")) parts.push(`${PLAIN[k]}:${String(v).slice(0, 60)}`);
  }
  return parts.join(" · ");
}
