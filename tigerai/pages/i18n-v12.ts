// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Texts added in 1.1.2-ce (own skills).
export const zhV112 = {
  skNew: "新增技能", skEditTitle: "編輯技能", skFieldName: "技能名稱", skFieldDesc: "什麼時候用（一句話說明）", skFieldSteps: "步驟（AI 照著做的內容）",
  skNoPerm: "技能只是給 AI 的做事說明，不會多給任何權限；工具該不該用，仍由原本的權限判斷。", skSave: "儲存", skSaved: "已儲存", skEdit: "編輯", skDelete: "刪除",
  skDeleteAsk: "刪除這個技能？只會刪掉你自己的這一份。", skDeleted: "已刪除", skSubmit: "送審分享", skSubmitted: "已送給管理員審核",
  skReviewTitle: "等待審核的技能", skReviewHelp: "先看完整內容，再決定分享給全公司或某個單位；技能不會給任何人多餘的權限。", skShareCompany: "分享給全公司", skShareUnit: "選單位", skShareUnitDo: "分享給這個單位", skShared: "已分享", skReject: "退回",
} as const;
export const enV112: Partial<Record<keyof typeof zhV112, string>> = {
  skNew: "New skill", skEditTitle: "Edit skill", skFieldName: "Skill name", skFieldDesc: "When to use it (one sentence)", skFieldSteps: "Steps (what the AI should do)",
  skNoPerm: "A skill is only instructions for the AI; it grants no extra permission. Tools are still checked by their own rules.", skSave: "Save", skSaved: "Saved", skEdit: "Edit", skDelete: "Delete",
  skDeleteAsk: "Delete this skill? Only your own copy is removed.", skDeleted: "Deleted", skSubmit: "Submit to share", skSubmitted: "Sent to an administrator for review",
  skReviewTitle: "Skills waiting for review", skReviewHelp: "Read the whole text first, then share it with the whole company or one unit; a skill never grants extra permission.", skShareCompany: "Share with the whole company", skShareUnit: "Pick a unit", skShareUnitDo: "Share with this unit", skShared: "Shared", skReject: "Send back",
};
