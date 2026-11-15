// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Texts of the meeting feature. Chinese is the default; English follows the browser choice (tg-lang) like the rest of the portal.
import { currentLang } from "../../../pages/i18n";

const ZH = {
  title: "會議摘要",
  entryDesc: "上傳會議錄音或貼上逐字稿,AI 從記錄、提醒、監督、建議整理成草稿",
  start: "開始",
  roomMenu: "上傳會議錄音",
  tabNew: "新增", tabList: "會議記錄",
  fTitle: "會議名稱", fTitlePh: "例如:十一月月結會議",
  modePaste: "貼上逐字稿", modeUpload: "上傳錄音",
  pastePh: "把逐字稿貼在這裡(一句一行最好,沒有換行也可以)",
  run: "整理成會議摘要", runUpload: "上傳並整理",
  chooseAudio: "選擇錄音檔", noAudio: "還沒選檔案",
  audioHint: "mp3、m4a、wav、webm,最大 200 MB。錄音會先轉成文字,再由 AI 整理。",
  asrOff: "管理員還沒設定語音轉文字服務",
  asrOffHint: "你仍然可以直接貼上逐字稿。",
  uploading: "上傳中 {pct}%", transcribing: "轉成文字中…", summarizing: "AI 整理中…",
  failed: "沒有完成", retry: "重試",
  bigFile: "檔案超過 200 MB", badType: "只收 mp3、m4a、wav、webm",
  draftNote: "AI 草稿 — 每一項都附逐字稿行號作為出處;採不採用、要不要開交辦單,由你決定。",
  inRoom: "已貼回頻道(AI 草稿)。",
  secDecisions: "記錄:決議", secActions: "提醒:待辦與期限", secSupervise: "監督:沒人負責的事", secSuggest: "建議:後續追蹤",
  none: "沒有", owner: "負責", due: "期限", noOwner: "(沒人負責)", noDue: "(未定)", overdue: "已過期",
  openAssignment: "開成交辦單", opened: "已開單", dropped: "有 {n} 項因為找不到逐字稿出處,已被系統擋下。",
  transcript: "逐字稿", download: "下載逐字稿", line: "第 {n} 行",
  noMeetings: "還沒有會議記錄。", back: "回清單",
  askUser: "請整理這場會議:{title}",
  by: "上傳者",
  stRunning: "處理中", stDone: "完成", stFailed: "沒有完成",
  asrTitle: "語音轉文字服務", asrUrl: "服務網址", asrUrlPh: "https://…/v1(OpenAI 相容 /audio/transcriptions)",
  asrModel: "模型名稱", asrLang: "語言代碼(可留空)", asrKey: "金鑰", asrKeyHas: "已設定(末四碼 {last4}),留空表示不變", asrKeyNone: "尚未設定",
  asrHelp: "金鑰存成只有伺服器能讀的檔案,畫面只顯示末四碼。沒設定時,成員仍可貼逐字稿,但不能上傳錄音。",
  asrTest: "測試連線", asrSave: "儲存", asrOk: "連線正常({ms} ms)", asrFail: "連線失敗", asrSaved: "已儲存", asrClear: "移除金鑰",
} as const;
const EN: Partial<Record<keyof typeof ZH, string>> = {
  title: "Meeting summary", start: "Start", roomMenu: "Upload a meeting recording", tabNew: "New", tabList: "Meetings",
  fTitle: "Meeting name", modePaste: "Paste a transcript", modeUpload: "Upload a recording", run: "Summarise", runUpload: "Upload and summarise",
  asrOff: "The administrator has not set up the speech-to-text service yet", asrOffHint: "You can still paste a transcript.",
  openAssignment: "Create an assignment", opened: "Assignment created", transcript: "Transcript", download: "Download transcript", retry: "Retry",
  asrTitle: "Speech-to-text service", asrTest: "Test connection", asrSave: "Save",
};
export type MKey = keyof typeof ZH;
export function mt(k: MKey, vars?: Record<string, string | number>): string {
  const text = (currentLang() === "en" ? EN[k] : undefined) ?? ZH[k];
  return vars ? text.replace(/\{(\w+)\}/g, (_m, n: string) => String(vars[n] ?? "")) : text;
}
