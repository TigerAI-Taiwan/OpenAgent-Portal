// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 表單 (填表工具) page texts. Its own file so the big table in i18n.ts stays untouched by this feature.
import { registerStrings } from "./i18n";

const zh: Record<string, string> = {
  tabForms: "表單",
  fmIntro: "上傳一份空白 PDF 和它的欄位對照表(JSON),學生就能在對話裡請 AI 幫忙填。AI 只會問資料、檢查、輸出,缺資料或前後矛盾時不會輸出,也不會自己猜。簽名一律留給本人親簽。",
  fmFont: "伺服器還沒有中文字型,填表會被拒絕。請管理員把 TrueType 字型檔(.ttf,不是 .otf 或 .ttc;要同時有中文與英數字,例如 Noto Sans TC,SIL OFL 授權)放到資料目錄的 forms/fonts/,或設定環境變數 TIGERAI_FORM_FONT。",
  fmNone: "還沒有表單。", fmImport: "匯入表單", fmName: "表單名稱", fmDesc: "說明(給老師自己看)",
  fmDepts: "開放給哪些部門(班級)", fmDeptsNone: "你沒有可以開放的部門", fmPdf: "空白表單(PDF)", fmDef: "欄位對照表(JSON)",
  fmDefHelp: "對照表是資料,不是程式:列出每個欄位的位置、格式、必填,和哪些回答互相矛盾。格式說明見 docs/FORMS.md。",
  fmSave: "匯入", fmSaved: "已匯入", fmEnabled: "啟用", fmFields: "{n} 個欄位", fmDepsLabel: "部門",
  fmDelete: "確定要刪除表單「{name}」嗎?學生將不能再填。已填好的 PDF 會依保留天數自動刪除。",
  fmCheck: "檢查範例資料", fmCheckHelp: "貼上一份範例資料(JSON)試試對照表:只檢查,不輸出、不留存。", fmCheckGo: "檢查", fmCheckOk: "沒有缺漏或矛盾,可以輸出。",
  fmMissing: "缺少", fmErrors: "問題", fmWarnings: "提醒", fmNoDept: "沒有選部門",
  fmPickFile: "請選擇 PDF 與對照表", fmBadDef: "對照表不是正確的 JSON",
};
const en: Record<string, string> = {
  tabForms: "Forms",
  fmIntro: "Upload a blank PDF and its field map (JSON); students can then ask the AI to fill it in a conversation. The AI only asks, checks and writes; with missing or contradictory data nothing is written and nothing is guessed. Signatures are always left for the person.",
  fmFont: "The server has no Chinese font yet, so filling is refused. Put a TrueType .ttf font (not .otf or .ttc) with both Chinese and Latin glyphs (for example Noto Sans TC, SIL OFL) in forms/fonts/ in the data directory, or set TIGERAI_FORM_FONT.",
  fmNone: "No forms yet.", fmImport: "Import a form", fmName: "Form name", fmDesc: "Description (for you)",
  fmDepts: "Departments (classes) that may use it", fmDeptsNone: "You have no department to give it to", fmPdf: "Blank form (PDF)", fmDef: "Field map (JSON)",
  fmDefHelp: "The map is data, not code: where each field goes, its format, what is required and which answers contradict each other. See docs/FORMS.md.",
  fmSave: "Import", fmSaved: "Imported", fmEnabled: "Enabled", fmFields: "{n} fields", fmDepsLabel: "Departments",
  fmDelete: "Delete form \"{name}\"? Students can no longer fill it. Filled PDFs are removed after the retention period.",
  fmCheck: "Check sample data", fmCheckHelp: "Paste sample data (JSON) to try the map: it only checks, nothing is written or kept.", fmCheckGo: "Check", fmCheckOk: "Nothing missing or contradictory; it could be written.",
  fmMissing: "Missing", fmErrors: "Problems", fmWarnings: "Notes", fmNoDept: "No department chosen",
  fmPickFile: "Choose the PDF and the field map", fmBadDef: "The field map is not valid JSON",
};
registerStrings(zh, en);
