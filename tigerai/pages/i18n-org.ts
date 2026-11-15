// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Texts of 組織、目錄與人員異動 (feat/ce-org). Kept apart from i18n.ts (which spreads both objects into its tables).
export const zhOrg = {
  purgeBtn: "永久刪除", purgeAsk1: "要永久刪除頻道「{name}」嗎?{n} 則訊息與資料夾會被移除,無法還原。",
  purgeAsk2: "第二次確認:請輸入頻道名稱「{name}」才能刪除。", purgeTyped: "輸入頻道名稱", purgeDone: "已永久刪除,並寫入稽核紀錄。",
  archivedKeep: "封存的頻道永久保留,不會自動刪除;要清除只能由管理員在這裡手動永久刪除。",
  // 組織 tab
  orgIntro: "公司改組織的方式:下載目前的 org.xlsx → 在裡面改 → 上傳 → 看預覽 → 套用。空白＝不改、「-」＝清空;表外的人和單位完全不動;先預覽再套用,全成功或全不動。",
  orgExport: "下載目前的組織 (org.xlsx)", orgChoose: "選擇 org.xlsx", orgPreviewBtn: "預覽", orgApplyBtn: "套用", orgErrors: "錯誤(有任何錯誤就不能套用)", orgWarnings: "警告(可以套用,請看一眼)",
  orgChanges: "變更清單", orgNoChanges: "沒有任何變更。", orgSummary: "新增單位 {uc}、修改單位 {uu}、任職 {hire}、復職 {rejoin}、修改 {upd}、離職 {leave}",
  orgSheetRow: "{sheet} 第 {row} 列 {col}", orgFrom: "原", orgTo: "新", orgStale: "預覽已過期:檔案或資料在你看過之後變了,請重新預覽。", orgDone: "已套用。", orgPwTitle: "新帳號的一次性初始密碼(只顯示這一次)",
  orgPwDownload: "下載 initial-passwords.csv", orgApplyAsk: "套用這份組織表?只會套用你剛剛預覽的內容。",
  chUnitCreate: "新增單位", chUnitUpdate: "修改單位", chMemberCreate: "新增帳號", chMemberUpdate: "修改", chMemberLeave: "離職", chMemberRejoin: "復職",
  // 單位
  grpParent: "上層單位", grpNoParent: "(最上層)", grpEdit: "修改", grpRename: "單位名稱", grpSave: "儲存", grpPath: "完整路徑",
  cfDelGroup2: "要刪除單位「{name}」嗎?它的子單位會接到它的上層,頻道一起往上掛;成員只是少了這個單位。",
  // 成員: 離職 / 換部門 / 員編
  empId: "員編", unitsCol: "單位", leaveBtn: "離職", rejoinBtn: "復職", moveBtn: "換部門", leftTag: "已離職",
  leaveTitle: "{name} 離職", leaveIntro: "帳號會停用、單位關係保留;個人金鑰立刻停用,30 天後刪除金鑰檔,其他資料全部保留。名下有東西要先指定接手人;接手人可以唯讀查看他的個人對話與目錄(每次查看都會記稽核),不能改寫。",
  leaveNothing: "這個人名下沒有頻道、AI 角色或未完成的交辦單,不需要指定接手人。", leaveSuccessor: "接手人", leavePick: "選一位啟用中的成員",
  leaveChannels: "他擁有的頻道(只換擁有者,成員不變)", leaveRoles: "他的個人 AI 角色(換擁有者)", leaveOrders: "未完成的交辦單與分享申請(逐筆決定)",
  leaveToSuccessor: "交給接手人", leaveToAdmin: "由我(管理員)接手", leaveKeep: "保留", leaveTransfer: "轉給接手人", leaveConv: "個人對話 {n} 段、個人金鑰 {k} 組:保留(金鑰 30 天後刪除)", leaveSchedules: "{n} 個排程會跟著轉過去,但保持停用,由新擁有者看過再開",
  leaveDo: "離職並交接", leaveDone: "已處理,並寫入稽核紀錄。", leaveAsAssignee: "承辦", leaveAsApplicant: "申請",
  moveTitle: "{name} 換部門", moveIntro: "勾選他之後所屬的全部單位(整批取代)。個人目錄不動,只改連結;部門頻道自動換;專案頻道保留,由舊單位主管決定;交辦單逐筆決定。",
  moveLeaveCh: "離開:{unit} 的部門頻道「{name}」", moveJoinCh: "加入:{unit} 的部門頻道「{name}」", moveProject: "專案頻道「{name}」({unit}):先保留,由舊單位主管決定去留",
  moveOrders: "他名下的交辦單", moveAssignTo: "轉給", moveDo: "確認換部門", moveNoChange: "單位沒有變化。", moveDone: "已換部門。",
  ucTitle: "換部門後的專案頻道(舊單位主管決定)", ucNone: "沒有待決定的專案頻道。", ucKeep: "保留", ucRemove: "移出", ucAbout: "{user} 從 {unit} 調走,仍在專案頻道「{room}」。",
  // 目錄
  dirTab: "目錄", dirRoot: "目錄", dirEmpty: "這個資料夾是空的。", dirDownload: "下載", dirExportPdf: "匯出 PDF", dirExportPptx: "匯出簡報 (pptx)", dirReadOnly: "唯讀", dirTooBig: "檔案太大或不是文字,請下載。",
  dirKindFolder: "資料夾", dirNoLink: "沒有權限開啟", dirOpenFail: "開啟失敗", dirTruncated: "(只顯示前 1 MB)",
  roomUnit: "歸到單位", roomUnitHint: "只影響目錄的顯示位置,不影響誰能開這個頻道。不選＝跨部門頻道。", roomUnitNone: "(跨部門頻道)", roomUnitDefault: "這是該單位的部門頻道(換部門時自動進出)", roomUnitSave: "儲存", roomUnitDone: "已更新。",
} as const;
export const enOrg: Partial<Record<keyof typeof zhOrg, string>> = {
  purgeBtn: "Delete permanently", purgeAsk1: "Permanently delete channel \"{name}\"? {n} message(s) and its folder will be removed and cannot be restored.",
  purgeAsk2: "Second confirmation: type the channel name \"{name}\" to delete it.", purgeTyped: "Type the channel name", purgeDone: "Deleted permanently and written to the audit log.",
  archivedKeep: "Archived channels are kept for good and never deleted automatically; only an administrator can remove one here, by hand.",
  orgIntro: "To change the organisation: download the current org.xlsx, edit it, upload it, read the preview, apply. Empty = unchanged, \"-\" = clear; people and units not in the file are never touched; preview first, all or nothing.",
  orgExport: "Download the current organisation (org.xlsx)", orgChoose: "Choose org.xlsx", orgPreviewBtn: "Preview", orgApplyBtn: "Apply", orgErrors: "Errors (nothing can be applied while there are errors)", orgWarnings: "Warnings (you can apply; please look)",
  orgChanges: "Changes", orgNoChanges: "No changes.", orgSummary: "units created {uc}, units changed {uu}, hired {hire}, rejoined {rejoin}, changed {upd}, left {leave}",
  orgSheetRow: "{sheet} row {row} {col}", orgFrom: "from", orgTo: "to", orgStale: "The preview is out of date: the file or the data changed. Preview again.", orgDone: "Applied.", orgPwTitle: "One-time initial passwords of the new accounts (shown only now)",
  orgPwDownload: "Download initial-passwords.csv", orgApplyAsk: "Apply this organisation sheet? Only what you just previewed is applied.",
  empId: "Employee no.", unitsCol: "Units", leaveBtn: "Leave", rejoinBtn: "Rejoin", moveBtn: "Change unit", leftTag: "left",
  dirTab: "Directory", dirRoot: "Directory", dirEmpty: "This folder is empty.", dirDownload: "Download", dirExportPdf: "Export PDF", dirExportPptx: "Export slides (pptx)", dirReadOnly: "read only",
};
