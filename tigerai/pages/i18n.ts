// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { enAddon, zhAddon } from "./i18n-addon";
import { enN8nWebhook, zhN8nWebhook } from "./i18n-n8n";
import { ERR_ZH_BYOK, enByok, zhByok } from "./i18n-byok";
import { enWeb, zhWeb } from "./i18n-web";
import { ERR_ZH_SCHOOL, enUsage, enSchool, zhUsage, zhSchool } from "./i18n-school";
const en = {
  product: "OpenAgent Portal", signIn: "Sign in", email: "Email", password: "Password", signOut: "Sign out",
  chats: "Conversations", rooms: "Rooms", admin: "Administration", account: "Account",
  changePw: "Change password", current: "Current password", next: "New password", save: "Save",
  mustChange: "You must choose a new password before continuing.",
  users: "Accounts", groups: "Groups", audit: "Audit log", org: "Organisation", prompts: "Prompts", n8n: "n8n", workorders: "Work orders", roles: "AI roles", libraryHelp: "Publish templates to the company library. Department heads choose which ones their department sees; being in the library alone shows nothing.", publish: "Publish", ticksCount: "Departments using it", noOrders: "No work orders.", shareRequest: "Share request", approve: "Approve", reject: "Reject", myPrompts: "My prompts (private)", submitShare: "Submit for sharing", deptLibrary: "Company library: choose for your department", deptHelp: "Tick the templates your department uses. Members see them in their / menu.",
  promptName: "Command name", promptDesc: "Description", promptBody: "Template text", visibleTo: "Visible to", everyone: "everyone (no group ticked)", roleModel: "Model (provider/id, optional)", roleKnowledge: "Knowledge folder (optional)", rolePrompt: "Role instructions", delete: "Delete",
  newUser: "New account", name: "Name", role: "Role", status: "Status", create: "Create", member: "Member", administrator: "Administrator",
  active: "active", disabled: "disabled", disable: "Disable", enable: "Enable", reset: "Reset password",
  oneTimePw: "One-time password (shown once, copy it now)", groupName: "Group name", addMember: "Add member", remove: "Remove",
  newRoom: "New room", noRooms: "No rooms yet.", send: "Send", typeMsg: "Write a message (Enter to send, Shift+Enter for a new line, @ to mention, @AI to ask the assistant)",
  members: "Members", openAi: "Open AI conversation", aiHint: "The AI conversation of this room is read-only: it can read files in the room folder but cannot run commands.",
  unread: "unread", mentioned: "mentioned", action: "Action", when: "Time", actor: "By", filter: "Filter by action",
  orgUpload: "Upload org.xlsx", preview: "Preview", apply: "Apply", orgHelp: "Three sheets: units, members, lists. Preview first; nothing is written until you apply.",
  noAccess: "Not available.", loading: "Loading...", back: "Back to conversations", aiWorking: "AI is working on a request...",
};
const zh: typeof en = {
  product: "OpenAgent Portal", signIn: "登入", email: "電子郵件", password: "密碼", signOut: "登出",
  chats: "對話", rooms: "頻道", admin: "管理", account: "帳號",
  changePw: "更改密碼", current: "目前密碼", next: "新密碼", save: "儲存",
  mustChange: "請先設定新密碼才能繼續。",
  users: "成員", groups: "群組", audit: "稽核紀錄", org: "組織", prompts: "提示詞", n8n: "n8n", workorders: "交辦單", roles: "AI 角色", libraryHelp: "把模板發佈到公司共用庫。由各部門主管勾選自己部門要用的；只在庫裡不會被任何人看到。", publish: "發佈", ticksCount: "使用的部門數", noOrders: "沒有工單。", shareRequest: "分享申請", approve: "核准", reject: "駁回", myPrompts: "我的提示詞（私人）", submitShare: "申請分享", deptLibrary: "公司共用庫：為你的部門挑選", deptHelp: "勾選你部門要用的模板，成員會在 / 選單看到。",
  promptName: "指令名稱", promptDesc: "說明", promptBody: "模板內容", visibleTo: "誰看得到", everyone: "所有人（沒有勾選群組）", roleModel: "模型（provider/id，可不填）", roleKnowledge: "知識資料夾（可不填）", rolePrompt: "角色指示", delete: "刪除",
  newUser: "新增帳號", name: "名稱", role: "角色", status: "狀態", create: "建立", member: "成員", administrator: "管理員",
  active: "啟用", disabled: "停用", disable: "停用", enable: "啟用", reset: "重設密碼",
  oneTimePw: "一次性密碼（只顯示這一次，請現在複製）", groupName: "群組名稱", addMember: "加入成員", remove: "移除",
  newRoom: "新增頻道", noRooms: "還沒有頻道。", send: "送出", typeMsg: "輸入訊息（Enter 送出、Shift+Enter 換行、@ 提及、@AI 請 AI 協助）",
  members: "成員", openAi: "開啟 AI 對話", aiHint: "此頻道的 AI 對話為唯讀：可讀取頻道資料夾內的檔案，不能執行指令。",
  unread: "未讀", mentioned: "提及你", action: "動作", when: "時間", actor: "操作者", filter: "依動作篩選",
  orgUpload: "上傳 org.xlsx", preview: "預覽", apply: "套用", orgHelp: "三張工作表：units、members、lists。先預覽，套用前不會寫入任何資料。",
  noAccess: "無法使用。", loading: "載入中...", back: "回到對話", aiWorking: "AI 正在處理請求...",
};

const zhX = {
  tabAccount: "帳號", tabPrompts: "提示詞", tabAssignments: "交辦單", tabAdmin: "管理", tabModels: "模型", tabDeleted: "已封存頻道", tabRoles: "AI 角色", tabPromptLibrary: "提示詞上架",
  settings: "設定", settingsOf: "{name} 的設定", models: "模型", skills: "技能", signOutConfirm: "確定要登出嗎?", cancel: "取消", confirm: "確定", close: "關閉", back: "返回",
  newMenu: "新增", newChat: "新對話", newRoomItem: "新頻道", newAssignment: "新交辦單", roomName: "頻道名稱", pickMembers: "勾選成員", createAndEnter: "建立並進入",
  functionsBtn: "功能", fnRoles: "AI 角色", fnRolesDesc: "用公司共用或你自己的 AI 角色開一段新對話", fnPlain: "一般對話", fnPlainDesc: "使用預設模型,不套用角色",
  greeting: "你好,{name},今天想做什麼?", fnRolesEmpty: "你的功能表還沒有精靈,按底部的「精靈」加進來。", fnShared: "公司共用", fnMine: "我的",
  placeholder: "輸入訊息,@AI 問助理,# 叫出提示詞", notMember: "你不是這個頻道的成員", joinRoom: "加入頻道", roomOnly: "這段對話只能從頻道使用", adminViewing: "你以管理員身分檢視(非成員)", roomClosed: "頻道已關閉,目前唯讀", roomDeleted: "此頻道已封存",
  moreMenu: "更多", warn: "警告", closeRoom: "關閉頻道", reopenRoom: "重新開啟頻道", deleteRoom: "封存頻道", warnText: "警告內容", sendWarn: "發出警告", deleteConfirm: "確定要封存這個頻道嗎?封存後所有人看不到,資料永久保留,管理員隨時可以從設定還原。", removeMember: "移除成員",
  you: "你", ai: "AI", warning: "警告", roomMembers: "成員", unreadN: "{n} 則未讀", openRoomFail: "無法開啟頻道", send2: "傳送", mention: "提及",
  accountName: "名稱", language: "語言", langZh: "繁體中文", langEn: "English", theme: "外觀", themeLight: "淺色", themeDark: "深色", themeAuto: "跟隨系統", passwordTitle: "更改密碼", saved: "已儲存", workspaceOf: "{name} 的工作區",
  asTitle: "標題", asDesc: "說明", asAssignee: "指派給", asDue: "到期日", asLinkSession: "附上目前對話", asCreate: "建立交辦單", asMineTab: "我開的", asAssignedTab: "指派給我", asAllTab: "全部", asAccept: "接受", asComplete: "完成", asReturn: "退回", asReason: "退回原因", asNote: "完成說明", asStatus_open: "待接受", asStatus_accepted: "進行中", asStatus_done: "已完成", asStatus_returned: "已退回", asNone: "沒有交辦單。", asPending: "待我處理 {n}", asBy: "申請人", asTo: "負責人", pickUser: "選擇成員...",
  mdlBaseUrl: "v1 基底網址", mdlTest: "測試連線", mdlKey: "API 金鑰", mdlKeyHas: "已設定(末四碼 {last4})", mdlKeyNone: "尚未設定", mdlKeyHelp: "貼上一次即可,不會再顯示", mdlFetch: "從閘道取得模型清單", mdlOffered: "提供的模型", mdlDefault: "預設模型", mdlCtx: "上下文長度", mdlMax: "最大輸出", mdlSave: "儲存設定", mdlOk: "連線成功,共 {n} 個模型({ms} ms)", mdlFail: "連線失敗", mdlHint: "儲存後從下一則訊息起生效,不需重啟。", mdlAll: "全部(閘道列出的都提供)",
  delRooms: "已封存頻道", delNone: "沒有已封存的頻道。", restore: "還原", daysLeft: "永久保留,不會自動刪除", deletedBy: "封存者",
  error: "發生錯誤", headViewing: "你以主管身分檢視(非成員)", tokenStored: "權杖已儲存", noToken: "沒有權杖", tools: "工具", none: "無", status_pending: "待核可", status_approved: "已核准", status_rejected: "已駁回",
  roomsTitle: "頻道", roomEmpty: "選一個頻道,或用左上角的 + 建立新頻道。", ownerBadge: "管理者", ctxMenuMembers: "成員", add: "加入", addToRoom: "加入成員",
  headOnly: "部門主管可在這裡為部門勾選", noSettingsAccess: "你沒有權限使用這個頁面。", loadFail: "載入失敗",
} as const;
const enX: Partial<Record<keyof typeof zhX, string>> = {
  tabAccount: "Account", tabPrompts: "Prompts", tabAssignments: "Assignments", tabAdmin: "Administration", tabModels: "Models", tabDeleted: "Archived rooms", tabRoles: "AI roles", tabPromptLibrary: "Prompt library",
  settings: "Settings", settingsOf: "Settings of {name}", models: "Models", skills: "Skills", signOutConfirm: "Sign out?", cancel: "Cancel", confirm: "OK", close: "Close", back: "Back",
  newMenu: "New", newChat: "New conversation", newRoomItem: "New room", newAssignment: "New assignment", roomName: "Room name", pickMembers: "Tick members", createAndEnter: "Create and enter",
  functionsBtn: "Functions", placeholder: "Write a message, @AI to ask the assistant, # for prompts", notMember: "You are not a member of this room", joinRoom: "Join room", roomOnly: "This conversation can only be used from its room", adminViewing: "Viewing as administrator (not a member)",
};
// Batch v6 texts (date and file controls, group head, audit page, model page, leaks). Kept apart so the v6 additions are easy to find.
const zhY = {
  saving: "儲存中...",
  cfRemoveRoomMember: "確定要把 {name} 移出這個頻道嗎?", cfCloseRoom: "確定要關閉這個頻道嗎?關閉後只能閱讀,之後可以重新開啟。",
  cfDelGroup: "確定要刪除群組「{name}」嗎?成員帳號不會被刪除,但會失去這個群組給的權限。", cfRemoveGroupMember: "確定要把 {name} 移出群組「{group}」嗎?",
  cfDelPrompt: "確定要刪除提示詞「/{name}」嗎?", cfDisableRole: "確定要停用 AI 角色「@{name}」嗎?", cfApprove: "確定要核可「/{name}」這筆申請嗎?", cfReject: "確定要駁回「/{name}」這筆申請嗎?", cfApproveN: "確定要核可「{name}」這筆申請嗎?", cfRejectN: "確定要駁回「{name}」這筆申請嗎?",
  
  cfDisableUser: "確定要停用「{name}」的帳號嗎?他將無法登入。", cfResetPw: "確定要重設「{name}」的密碼嗎?舊密碼會立刻失效。", cfOrgApply: "確定要套用這份組織檔嗎?會依預覽結果新增與更新成員與群組。",
  autoLabel: "自動", configuredLabel: "已設定",
  weekdays: "日,一,二,三,四,五,六", pickDate: "選擇日期", prevMonth: "上個月", nextMonth: "下個月", clear: "清除", today: "今天",
  chooseFile: "選擇檔案", noFile: "尚未選擇檔案", deptRoomsView: "部門頻道(檢視)", closedShort: "已關閉", mdlSelectAll: "全選", mdlClearAll: "全部取消", mdlCount: "已開放 {n} / {total} 個", mdlEmbedding: "(嵌入模型,不能用於對話)", details: "內容", unknownUser: "(已刪除的帳號)", systemActor: "系統", roomOnlyBody: "這段對話屬於一個頻道,只能從頻道使用。", goToRoom: "前往頻道", headLabel: "主管", setHead: "設為部門主管", unsetHead: "取消部門主管",
} as const;
const enY: Partial<Record<keyof typeof zhY, string>> = {
  weekdays: "Su,Mo,Tu,We,Th,Fr,Sa", pickDate: "Pick a date", prevMonth: "Previous month", nextMonth: "Next month", clear: "Clear", today: "Today",
  chooseFile: "Choose file", noFile: "No file chosen", deptRoomsView: "Department rooms (view only)", closedShort: "closed", mdlSelectAll: "Select all", mdlClearAll: "Clear all", mdlCount: "{n} of {total} offered", mdlEmbedding: "(embedding model, cannot chat)", details: "Details", unknownUser: "(deleted account)", systemActor: "System", roomOnlyBody: "This conversation belongs to a room and can only be used from the room.", goToRoom: "Go to room", headLabel: "Head", setHead: "Make department head", unsetHead: "Remove as department head",
};
// Batch v8 texts (公佈欄, 提醒泡泡).
const zhZ = {
  bulletin: "公佈欄", bulletinBell: "公佈欄與待辦", bTabPersonal: "個人區", bTabPublic: "公用區", bTabMine: "我交辦的", bTabAll: "全部",
  bNothing: "目前沒有需要你處理的事。", bNewAnnouncement: "新公告", bActive: "目前公告", bExpired: "已過期", bPinned: "置頂", bRequireAck: "需要確認", bAck: "我已了解", bAcked: "已確認",
  bAudience: "對象", bAudienceAll: "全公司", bNoGroups: "你目前不是任何部門的主管,不能發公告。", bExpires: "到期日(選填)", bPin: "置頂這則公告", bUnpin: "取消置頂", bTitle: "標題", bBody: "內容(可用 Markdown)",
  bPublish: "發布", bEdit: "編輯", bEdited: "已修改", bDelete: "刪除", bDeleteConfirm: "確定要刪除這則公告嗎?刪除後所有人都看不到。", bReadStats: "已讀 {read}/{total}", bAckStats: "已確認 {n}/{total}",
  bNotRead: "尚未讀", bNotAcked: "尚未確認", bHistory: "修改紀錄", bEditedBy: "{name} 於 {time} 修改前的內容", bAiHelp: "請 AI 幫我寫", bAiTopic: "想說的重點(AI 只幫你起草,由你確認後才發布)",
  bAiWorking: "AI 起草中…", bAiDone: "已填入草稿,請檢查、修改後再發布。", bNoAnn: "目前沒有公告。", bNoExpired: "沒有已過期的公告。", bOverdue: "已逾期", bFrom: "發布者",
  bDueOn: "{day} 到期", bKindAssignment: "交辦單",
} as const;
const enZ: Partial<Record<keyof typeof zhZ, string>> = {
  bulletin: "Bulletin board", bulletinBell: "Bulletin board and to-dos", bTabPersonal: "For me", bTabPublic: "Announcements", bTabMine: "Handed out by me", bTabAll: "All",
  bNothing: "Nothing needs you right now.", bNewAnnouncement: "New announcement", bActive: "Current", bExpired: "Expired", bPinned: "Pinned", bRequireAck: "Needs confirmation", bAck: "I understand", bAcked: "Confirmed",
  bAudience: "For", bAudienceAll: "Whole company", bPublish: "Publish", bEdit: "Edit", bDelete: "Delete", bTitle: "Title", bAiHelp: "Ask AI to draft it", bOverdue: "overdue", bFrom: "Posted by",
};
// Batch v9 texts (brand popup, bottom row, 精靈 / 交辦 / 技能 modals, 設定 split).
const zhV9 = {
  thinkPrefix: "推理", thinkAuto: "自動", thinkOff: "關閉", thinkMinimal: "最少", thinkLow: "低", thinkMedium: "中等", thinkHigh: "高", thinkXhigh: "最高", thinkMax: "最高",
  tabMyPrompts: "我的提示詞", mdlRestore: "還原", contactTitle: "聯絡我們", contactEmail: "電子郵件", about: "關於", versionLabel: "版本 {v}",
  btnAgents: "精靈", btnAssignments: "交辦", tabModelConn: "模型連線", tabMcp: "MCP", tabPlugins: "外掛",
  tabRolesUse: "AI 角色", tabRolesAdmin: "AI 角色上架", tabAvailSkills: "可用技能", tabInstallSkills: "安裝技能", tabSubagents: "子代理",
  foldRooms: "收合頻道", unfoldRooms: "展開頻道", roomsGroup: "頻道", embedFailed: "這個畫面無法載入。", embedNeedFolder: "找不到你的工作資料夾,無法開啟。",
  agentsTitle: "精靈", agMine: "我的精靈", agFind: "找精靈", agEmptyMenu: "你的精靈清單是空的。到「找精靈」把公司或同事分享的加進來,或自己建一個。",
  useThis: "用這個開對話", agAdd: "加入我的功能表", agAdded: "已在我的功能表", agCopy: "複製成我的", agRemove: "移出我的功能表", agKindCompany: "公司共用", agKindMine: "我建的", agKindShared: "{name} 分享",
  agNew: "新增我的精靈", agEdit: "編輯", agDelete: "刪除", agName: "名稱", agDesc: "說明(一句話)", agPrompt: "這個精靈怎麼做事(提示詞)", agShare: "分享給同事(他們可以加進自己的功能表,或複製一份自己改)",
  agMoveUp: "上移", agMoveDown: "下移", agSaved: "已儲存", agCopyNote: "複製只帶走名稱、說明與提示詞,之後各改各的。", agHint: "點一個精靈就用它開新對話。順序只有你自己看得到。",
  cfDelAgent: "確定要刪除你的精靈「{name}」嗎?它會從所有人的功能表消失;已經開過的對話不受影響。", cfRemoveAgent: "確定要把「{name}」移出你的功能表嗎?(不會刪掉它)",
  assignmentsTitle: "交辦", asTabMine: "我交辦的", asTabAssigned: "交辦給我的", asTabAi: "AI 交辦的", asFromAi: "AI 交辦", asFromN8n: "n8n 流程交辦", asNoAi: "目前沒有 AI 或流程交辦的事。", asOnlyProgress: "這裡只看進度;公告與全部待辦在上方鈴鐺的公佈欄。",
  skillsTitle: "技能", skHint: "這是你做工作時會用到的 AI。", skAvailEmpty: "目前沒有可用的技能。", skInstalledNote: "這些技能已由管理員安裝,AI 會在需要時自己使用;你也可以直接指定它。", skUsePrompt: "用這個提示詞開對話", skRolesNote: "公司共用、同事分享與你自己建的 AI 角色。",
} as const;
// Batch v10: the 繼續 button under a cut-off answer and its follow-up sentences.
const zhV10 = {
  continueBtn: "繼續", compactCtx: "壓縮上下文", compacting: "壓縮中…",
  continueCutPrompt: "請從剛才中斷的地方接著寫完。", continueNoAnswerPrompt: "請直接寫出回答,不要再重複思考。",
  truncAdminExtra: "也可以把這個模型的思考關閉。",
  mdlImages: "可收圖", mdlImagesOn: "可以收圖片", mdlImagesOff: "只收文字",
} as const;
const enV10: Partial<Record<keyof typeof zhV10, string>> = {
  continueBtn: "Continue", compactCtx: "Compact context", compacting: "Compacting…",
  continueCutPrompt: "Please continue from where you stopped and finish.", continueNoAnswerPrompt: "Please write the answer directly, without thinking it through again.",
  truncAdminExtra: "You can also turn thinking off for this model.", mdlImages: "Accepts images", mdlImagesOn: "Accepts pictures", mdlImagesOff: "Text only",
};
const enV9: Partial<Record<keyof typeof zhV9, string>> = {
  contactTitle: "Contact", contactEmail: "Email", about: "About", versionLabel: "Version {v}", btnAgents: "Agents", btnAssignments: "Assignments", tabModelConn: "Model connection", 
  thinkPrefix: "Thinking", thinkAuto: "auto", thinkOff: "off", thinkMinimal: "minimal", thinkLow: "low", thinkMedium: "medium", thinkHigh: "high", thinkXhigh: "highest", thinkMax: "max",
  tabRolesUse: "AI roles", tabRolesAdmin: "Manage AI roles", tabAvailSkills: "Available skills", tabInstallSkills: "Install skills", tabSubagents: "Subagents", foldRooms: "Collapse rooms", unfoldRooms: "Expand rooms", roomsGroup: "Rooms",
  agentsTitle: "Agents", agMine: "My agents", agFind: "Find agents", useThis: "Start a conversation", agAdd: "Add to my menu", agAdded: "In my menu", agCopy: "Copy as mine", agRemove: "Remove from my menu", agNew: "New agent of mine",
  assignmentsTitle: "Assignments", asTabMine: "Handed out by me", asTabAssigned: "Handed to me", asTabAi: "From AI", skillsTitle: "Skills",
};
const zhV11 = {
  hashTitle: "提示詞", hashMine: "我的提示詞", hashCompany: "公司提示詞", hashRequired: "(必填)", hashFill: "請填「{name}」", hashPreview: "插入的內容:", hashInsert: "插入",
  asTabToMe: "交辦我", asTabByMe: "我交辦", asKindAll: "全部", asKindUser: "交給人", asKindAi: "交給 AI",
  asTagPerson: "人", asTagAi: "AI", asTagN8n: "n8n",
  asGiveTo: "交給", asToPerson: "人", asToAi: "AI", asPickRole: "AI 角色", asGeneralAi: "一般 AI",
  asReadRoom: "讓 AI 讀「{name}」頻道最近的訊息(唯讀,不用再貼資料)",
  asAiHint: "AI 會在背景處理,不用開著瀏覽器;做完會通知你,由你確認。AI 能做的事不會超過你自己。",
  asRun_running: "進行中", asRun_review: "待確認", asAiWorking: "AI 正在背景處理,可以先關掉這個視窗。", asOpenChat: "開啟對話",
  asToastDone: "AI 做完了:{title}", asToastError: "AI 做的時候出了問題:{title}", asToastRestart: "伺服器重新啟動,工作中斷:{title}", asAiWaiting: "AI 做完了,等你確認",
} as const;
const enV11: Partial<Record<keyof typeof zhV11, string>> = {
  hashTitle: "Prompts", hashMine: "My prompts", hashCompany: "Company prompts", hashRequired: "(required)", hashFill: "Fill in \"{name}\"", hashPreview: "Text to insert:", hashInsert: "Insert",
  asTabToMe: "Handed to me", asTabByMe: "Handed out by me", asKindAll: "All", asKindUser: "To people", asKindAi: "To AI", asGiveTo: "Give to", asToPerson: "Person", asToAi: "AI", asPickRole: "AI role", asGeneralAi: "General AI",
  asReadRoom: "Let the AI read the latest messages of \"{name}\" (read-only, no pasting)",
  asRun_running: "In progress", asRun_review: "To confirm", asOpenChat: "Open conversation",
  asToastDone: "AI is done: {title}", asToastError: "AI ran into a problem: {title}", asToastRestart: "Server restarted, work interrupted: {title}", asAiWaiting: "AI is done, waiting for you",
};
// Community edition: model connection list (several /v1 endpoints tried in order).
const zhCE = {
  connHelp: "模型連線依順序使用:第一組是主要連線(通常是本機的 LLM Manager),後面的是備援(例如虎智雲端 ai-api-proxy,只在主要連線沒有回應時才用,不當主要)。一則訊息遇到連不上、逾時、5xx、429 或找不到模型時,會自動改用下一組連線的同名模型(沒有同名就用它的預設模型),同一則訊息接著做完。換過的連線會先記住 10 分鐘,時間到再試回主要。",
  connNone: "還沒有任何模型連線。請按「新增連線」。", connPrimary: "主要連線", connBackup: "備援", connUp: "上移", connDown: "下移",
  connEnabled: "啟用", connEdit: "編輯", connCollapse: "收合", connDelete: "刪除", connDeleteAsk: "確定刪除連線「{name}」?刪除後它的模型就不能用了。", connOff: "已停用",
  connStatusOk: "連線正常,{n} 個模型", connStatusErr: "連不上(沿用上次的 {n} 個模型)", connAdd: "新增連線", connAddDo: "新增", connName: "名稱", connNameHint: "例如:虎智雲端備援",
  fbNoteLabel: "備援提示",
} as const;
const enCE: Partial<Record<keyof typeof zhCE, string>> = {
  connHelp: "Model connections are used in order: the first is the primary (usually the local LLM Manager), the rest are fallbacks (e.g. the cloud ai-api-proxy: backup only, never the primary). When a message hits unreachable, timeout, 5xx, 429 or model-not-found, the same turn continues on the next connection (same model name, else that connection's default model). A connection that failed is remembered for 10 minutes, then tried first again.",
  connNone: "No model connection yet. Press \"Add connection\".", connPrimary: "Primary", connBackup: "Fallback", connUp: "Move up", connDown: "Move down",
  connEnabled: "Enabled", connEdit: "Edit", connCollapse: "Collapse", connDelete: "Delete", connDeleteAsk: "Delete connection \"{name}\"? Its models stop working.", connOff: "disabled",
  connStatusOk: "reachable, {n} model(s)", connStatusErr: "unreachable (keeping the last {n} model(s))", connAdd: "Add connection", connAddDo: "Add", connName: "Name", connNameHint: "e.g. Cloud fallback",
  fbNoteLabel: "Fallback note",
};
import { enWiz, zhWiz } from "./i18n-wizard";
import { enUL, zhUL } from "./i18n-userlog";
import { enKn, zhKn } from "./i18n-knowledge";
import { enV111, zhV111 } from "./i18n-v11";
import { enV112, zhV112 } from "./i18n-v12";
import { enOrg, zhOrg } from "./i18n-org";
export type Key = keyof typeof zhV112 | keyof typeof zhV111 | keyof typeof zhOrg | keyof typeof zhWiz | keyof typeof zhUL | keyof typeof zhKn | keyof typeof zhV11 | keyof typeof zh | keyof typeof zhX | keyof typeof zhY | keyof typeof zhZ | keyof typeof zhV9 | keyof typeof zhV10 | keyof typeof zhCE | keyof typeof zhAddon | keyof typeof zhN8nWebhook | keyof typeof zhByok | keyof typeof zhSchool | keyof typeof zhUsage | keyof typeof zhWeb;
const ZH: Record<Key, string> = { ...zh, ...zhX, ...zhY, ...zhZ, ...zhV9, ...zhV10, ...zhV11, ...zhCE, ...zhAddon, ...zhN8nWebhook, ...zhByok, ...zhWiz, ...zhUL, ...zhKn, ...zhOrg, ...zhSchool, ...zhUsage, ...zhWeb, ...zhV111, ...zhV112 };
const EN: Partial<Record<Key, string>> = { ...en, ...enX, ...enY, ...enZ, ...enV9, ...enV10, ...enV11, ...enCE, ...enAddon, ...enN8nWebhook, ...enByok, ...enWiz, ...enUL, ...enKn, ...enOrg, ...enSchool, ...enUsage, ...enWeb, ...enV111, ...enV112 };

/** zh-TW is the default. A person can switch to English in Settings › Account (stored in this browser only). */
export function currentLang(): "zh" | "en" {
  try { return typeof localStorage !== "undefined" && localStorage.getItem("tg-lang") === "en" ? "en" : "zh"; } catch { return "zh"; }
}
export function setLang(lang: "zh" | "en"): void { try { localStorage.setItem("tg-lang", lang); } catch { /* blocked */ } }
/** Plain translator with {name} placeholders; usable outside React. */
export function tr(k: Key, vars?: Record<string, string | number>): string {
  const en = currentLang() === "en";
  const text = (en ? EN[k] ?? EXTRA_EN[k] : undefined) ?? ZH[k] ?? EXTRA_ZH[k] ?? k;
  return vars ? text.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? "")) : text;
}
export function useT(): (k: Key, vars?: Record<string, string | number>) => string {
  return tr;
}

// Strings of add-on packages (tigerai/docs/ADDON.md). A package registers its own dictionaries once when its page module loads; `trx` looks
// there first and falls back to the built-in dictionaries, so a package page can use both. A key that exists nowhere is shown as itself.
const EXTRA_ZH: Record<string, string> = {};
const EXTRA_EN: Record<string, string> = {};
export function registerStrings(zh: Record<string, string>, en: Record<string, string> = {}): void { Object.assign(EXTRA_ZH, zh); Object.assign(EXTRA_EN, en); }
export function trx(k: string, vars?: Record<string, string | number>): string {
  const en = currentLang() === "en";
  const text = (en ? (EXTRA_EN[k] ?? (EN as Record<string, string | undefined>)[k]) : undefined) ?? EXTRA_ZH[k] ?? (ZH as Record<string, string | undefined>)[k] ?? k;
  return vars ? text.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? "")) : text;
}
export function useTx(): typeof trx { return trx; }

/**
 * Server messages stay English (logs, API clients); the page shows Chinese. Keyed by the error `code` the server sends,
 * then by the few codeless messages. An unknown code keeps the server's own text, so nothing is hidden.
 */
const ERR_ZH: Record<string, string> = {
  ...ERR_ZH_BYOK,
  ...ERR_ZH_SCHOOL,
  too_many: "連線最多 8 組", bad_enabled: "啟用狀態不正確",
  not_configured: "尚未設定 v1 基底網址", gateway: "無法連到模型閘道", bad_url: "網址格式不正確(需為 http:// 或 https://,且不可含帳密)",
  bad_key: "API 金鑰格式不正確", bad_default: "預設模型必須是已開放的模型", bad_offered: "開放模型清單格式不正確",
  bad_override: "上下文或輸出長度的數值不正確", bad_overrides: "模型限制格式不正確", override_too_high: "數值不可高於閘道回報的上限",
  forbidden: "你沒有權限執行這個操作", not_found: "找不到這筆資料", bad_state: "狀態已改變,請重新整理", bad_status: "狀態不正確",
  bad_name: "名稱不符合規則", bad_title: "標題必填(最多 120 字)", bad_description: "說明太長", bad_body: "內容必填且不可太長",
  bad_email: "電子郵件格式不正確", bad_role: "角色不正確", bad_parent: "上層群組不存在", bad_room: "找不到這個頻道", bad_agent: "找不到這個 AI 角色",
  bad_assignee: "請選擇一位啟用中的成員", bad_due: "到期日不正確", bad_session: "這段對話無法使用", bad_header: "標頭格式需為「名稱: 值」", bad_json: "資料格式不正確",
  content_type: "資料格式不正確", exists: "已被使用（電子郵件不能重複）", empty: "內容不可為空", decided: "這張單已經核可過", invalid_file: "檔案有錯誤,請先預覽",
  last_admin: "不能停用或降級最後一位管理員", limit: "已達數量上限", not_closed: "這個頻道沒有關閉", bound: "這個頻道已經有 AI 對話", owner: "只有頻道管理者或管理員可以這樣做",
  pending: "還有待處理的項目", reason_required: "請填寫原因", room_closed: "這個頻道已關閉", self_approval: "申請人不能核可自己的單", self_lockout: "不能對自己的帳號這樣做",
  too_long: "內容太長", unknown_kind: "不支援的類型", weak_password: "密碼強度不足", same_password: "請使用和目前不同的密碼", bad_current: "目前密碼不正確",
  bad_time: "時間或星期不正確", bad_settings: "設定格式不正確", unknown_wizard: "沒有這支精靈", already_running: "這支精靈正在執行", bad_decision: "這個動作不適用", nothing_new: "沒有新的訊息可以整理",
  not_room_session: "這段對話不是從這個頻道開始的", bad_order: "排序資料不正確(連線順序必須包含每一組各一次)", bad_source: "不支援的來源", model_locked: "模型由管理員設定,成員不能更改",
};
const ERR_MSG_ZH: Record<string, string> = {
  "Authentication required": "請先登入", "Wrong email or password": "電子郵件或密碼不正確", "Administrator only": "僅限管理員", "Not found": "找不到",
  "Internal error": "伺服器發生錯誤", "Too many failed attempts": "失敗次數太多,請稍後再試",
};
export function localizeError(code: unknown, message: string): string {
  if (currentLang() === "en") return message;
  return (typeof code === "string" ? ERR_ZH[code] : undefined) ?? ERR_MSG_ZH[message] ?? message;
}

// ---- dates and times: Taiwan format (2026/11/30, 14:05), never the browser's US default
const LOCALE = () => (currentLang() === "en" ? "en-GB" : "zh-TW");
/** A due DAY (stored as noon UTC of that day) shown as the calendar day it names, whatever the viewer's time zone. */
export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function fmtDateTime(ms: number): string { return new Date(ms).toLocaleString(LOCALE(), { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
export function fmtClock(ms: number): string { return new Date(ms).toLocaleTimeString(LOCALE(), { hour12: false, hour: "2-digit", minute: "2-digit" }); }
