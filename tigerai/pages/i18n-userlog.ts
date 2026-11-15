// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Texts of 使用者紀錄. Kept apart from i18n.ts (which spreads both objects into its tables).
export const zhUL = {
  ulTab: "使用者紀錄", ulIntro: "看成員最後上線的時間,以及他們跟 AI 的對話(只能看,不能回、改、刪)。每次查看都會記在稽核紀錄。",
  ulSwitch: "主管可查看對話", ulSwitchHelp: "關閉後,部門主管不能再看成員的對話;管理員不受影響。",
  ulColName: "姓名", ulColDept: "班級/部門", ulColSeen: "最後上線", ulColCount: "對話數", ulColLatest: "最近一次對話",
  ulNone: "沒有可以查看的成員。", ulNoDept: "(沒有部門)", ulDisabled: "已停用", ulNever: "從未上線",
  ulConvTitle: "{name} 的對話", ulConvNone: "這位成員還沒有對話。", ulConvColTitle: "標題", ulConvColTime: "最近時間",
  ulReadOnly: "唯讀:只能查看,不能回覆、修改或刪除。", ulYou: "成員", ulLoadFail: "讀取失敗",
  ulNotice: "管理員可以查看你的對話。", ulOpen: "查看",
} as const;
export const enUL: Partial<Record<keyof typeof zhUL, string>> = {
  ulTab: "User log", ulIntro: "When members were last online, and their conversations with the AI (view only). Every view is written to the audit log.",
  ulSwitch: "Department heads may view conversations", ulSwitchHelp: "When off, heads can no longer see members' conversations; administrators are not affected.",
  ulColName: "Name", ulColDept: "Class / department", ulColSeen: "Last online", ulColCount: "Conversations", ulColLatest: "Latest conversation",
  ulNone: "No members to show.", ulNoDept: "(no department)", ulDisabled: "Disabled", ulNever: "Never online",
  ulConvTitle: "Conversations of {name}", ulConvNone: "No conversations yet.", ulConvColTitle: "Title", ulConvColTime: "Last activity",
  ulReadOnly: "Read only: you cannot reply, edit or delete.", ulYou: "Member", ulLoadFail: "Could not load", ulNotice: "Administrators can view your conversations.", ulOpen: "View",
};
