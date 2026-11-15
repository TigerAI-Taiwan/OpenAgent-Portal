// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 系統連接 (n8n MCP) texts. Its own file so the big table in i18n.ts stays untouched by this feature.
import { registerStrings } from "./i18n";

const zh: Record<string, string> = {
  tabConnectors: "系統連接",
  cnHelp: "用 MCP 把 n8n 接給 AI。AI 只能用你打勾的群組、打勾的工具;預設只開讀取。建立、修改、試跑自己的流程不需要核准(每次呼叫都記稽核);要把流程「上架」給別人用,才需要管理員審查。", cnAdd: "新增連接", cnEdit: "編輯", cnNone: "還沒有任何系統連接。",
  cnPickTemplate: "選一個範本", cnName: "代號(小寫英數、-、_)", cnDesc: "說明(成員在功能選單看到)", cnUrl: "MCP 網址", cnKey: "連線金鑰", cnKeyHas: "已儲存(末四碼 {last4}),留空不變更", cnKeyNone: "未設定",
  cnKeyHelp: "金鑰存在伺服器的私有檔案,畫面只顯示末四碼。請用 n8n 裡權限最小的帳號產生存取權杖。",
  cnTest: "測試連線", cnTesting: "測試中…", cnTestOk: "連線成功:對方提供 {n} 個工具({ms} 毫秒)", cnTestFail: "連線失敗:{why}", cnTestNeed: "先測試連線,就能從對方實際提供的工具裡勾選。",
  cnGroups: "開放給哪些群組", cnGroupsNobody: "沒有勾群組 = 只有管理員能用", cnSuggested: "建議:{who}",
  cnTools: "AI 可用的內建技能(含工具)", cnToolsHelp: "沒勾的工具,AI 看不到也叫不動。預設只勾讀取類工具;會改動 n8n 的工具即使勾了,AI 也要先有核可的申請單才能用。", cnToolsAll: "允許全部工具(*)", cnToolsAllWarn: "全部允許包含寫入與刪除,請確認金鑰本身的權限已經很小。",
  cnToolRead: "唯讀", cnToolWrite: "可能會寫入", cnToolUnknown: "未標示", cnToolN8nWrite: "會改動 n8n(要核可)", cnToolsCount: "已開放 {n} 項工具", cnToolsNone: "沒有開放任何工具",
  cnEnabled: "啟用", cnSave: "儲存", cnDelete: "確定要刪除系統連接「{name}」嗎?AI 將不能再使用它。", cnCreated: "已新增", cnSaved: "已儲存", cnTestedAt: "上次測試 {t}",
  cnUnreachable: "連不上這個網址", cnUnauthorized: "對方拒絕了金鑰", cnTimeout: "對方沒有在時間內回應", cnBadResponse: "網址有回應,但不像 MCP 伺服器", cnBadUrl: "網址格式不正確",
};
const en: Record<string, string> = {
  tabConnectors: "System connectors",
  cnHelp: "Link n8n to the AI through MCP. Only the ticked groups and ticked tools; read-only by default. Creating, changing and test-running your own flows needs no approval (every call is audited); only 上架 (publishing a flow for others) needs an administrator's review.", cnAdd: "Add connector", cnEdit: "Edit", cnNone: "No connectors yet.",
  cnPickTemplate: "Pick a template", cnName: "Id (lowercase, - and _)", cnDesc: "Description", cnUrl: "MCP URL", cnKey: "Access key", cnKeyHas: "Stored (ends in {last4}); leave empty to keep", cnKeyNone: "Not set",
  cnKeyHelp: "The key is kept in a private file on the server; the page shows only its last 4 characters. Create the n8n access token with the least-privileged account.",
  cnTest: "Test connection", cnTesting: "Testing…", cnTestOk: "Connected: {n} tools offered ({ms} ms)", cnTestFail: "Connection failed: {why}", cnTestNeed: "Test the connection to tick from the tools the system really offers.",
  cnGroups: "Groups that may use it", cnGroupsNobody: "No group ticked = administrators only", cnSuggested: "Suggested: {who}",
  cnTools: "Built-in skills (with tools) the AI may use", cnToolsHelp: "Unticked tools are invisible to the AI. Read tools are ticked by default; a tool that changes n8n still needs an approved work order even when ticked.", cnToolsAll: "Allow every tool (*)", cnToolsAllWarn: "This includes writing and deleting; make sure the key itself is already narrow.",
  cnToolRead: "read-only", cnToolWrite: "may write", cnToolUnknown: "unlabelled", cnToolN8nWrite: "changes n8n (needs approval)", cnToolsCount: "{n} tools open", cnToolsNone: "No tool open",
  cnEnabled: "Enabled", cnSave: "Save", cnDelete: "Delete connector \"{name}\"? The AI will no longer be able to use it.", cnCreated: "Added", cnSaved: "Saved", cnTestedAt: "Last tested {t}",
  cnUnreachable: "Cannot reach this address", cnUnauthorized: "The system refused the key", cnTimeout: "No answer in time", cnBadResponse: "The address answers but does not look like an MCP server", cnBadUrl: "The URL is not valid",
};
registerStrings(zh, en);
