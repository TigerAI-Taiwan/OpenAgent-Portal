# 精靈引擎 (tigerai/wizards) — API 與擴充方式

給下一個開發者(包括要把「會議摘要」接上來的人)。精靈 = 一個「種類」(兩個函式)加上引擎替它做完其餘的事。

## 一支精靈的一生

```
startWizardRun({kind, roomId, runnerId, requestedBy, trigger, period?, params?})
  -> wizard_runs 一列 (status running)
  -> kind.prepare(ctx)      只讀資料庫,不呼叫模型;可回 {skip: "原因"} (記為 skipped,不跑模型)
  -> withAiSlot(...)        和「交辦給 AI」共用同一個名額 (TIGERAI_AI_RUN_CONCURRENCY,預設 2)
  -> 模型呼叫               setWizardModel 可換成假的 (測試);正式用 tigerai/wizards/model.ts
  -> kind.finish(ctx, prepared, reply)   驗證模型輸出,回 WizardResult;拋 WizardFailure = 這次失敗(訊息給人看)
  -> engine.complete        頻道訊息 + 各收件人的 wizard_items + run 標 done + 稽核 wizard.run
  任何一步失敗             -> run 標 failed + 頻道貼「這次整理沒有完成:<原因>」卡片(有權限的人可「重跑」)+ 稽核
```

## 要實作的介面 (`tigerai/wizards/types.ts`)

```ts
interface WizardKind {
  id: string; label: string;                       // 'meeting', '會議摘要'
  prepare(ctx: RunContext): Prepared | Promise<Prepared>;
  finish(ctx: RunContext, prepared, reply: string): WizardResult | Promise<WizardResult>;
}
// RunContext: { run, room | null, runner (跑的人 = 頻道建立者,或自己開的人), now, params }  params = startWizardRun 的 params (逐字稿、檔案 id…)
// Prepared:   { skip } | { prompt, allowed: Set<訊息編號>, noModel?, fromSeq?, toSeq?, data? }
// WizardResult: { post?: {text, confirmable}, items: DeliverItem[], note? }
// DeliverItem:  { aspect, category?, text, sources: Source[], to: 'channel' | 'admins' | {users: string[]}, extra? }
registerWizard(kind)      // 在 engine.ts 載入時內建三支已註冊;新的種類呼叫一次即可
```

- **共用的行格式與驗證** (`format.ts`):`parseLines(reply)` → `checkLines(lines, allowedSeqs, onAspects)`。沒有出處、出處不在 prompt 裡、面向被關掉的行都會被丟掉(`rejected` 計數)。`messageLine()` 產生 prompt 裡 `#編號 時間 人:內容` 的那種行;`formatRules()` / `COMMON_RULES` 是 prompt 的格式與規則段。
- **程式算的事** (`facts.ts`、`time.ts`):日期、逾期天數、「問了沒人回超過 2 天」、公司時區(`TIGERAI_TZ`,預設 Asia/Taipei)。模型不算。
- **結果分送** (`DeliverItem.to`):
  - `'channel'`:貼在頻道的卡片裡(記錄、建議);建議自動有 採用 / 不需要。
  - `{users:[…]}`:私下給這些人,進他們的**公佈欄個人區**並讓鈴鐺計數(監督、稽核、提醒)。同一人同一件事(面向+出處相同)已有未處理的、或 3 天內按過「我知道了」的,不再重送。
  - `'admins'`:給管理員的提案(目前只有技能),公佈欄個人區「待我核准」。
- **出處** (`Source`):`{t:'m', seq}` 頻道訊息編號、`{t:'a', id}` 交辦單。卡片與個人區都畫成可點的 chip。
- **建議的護欄**(`shared.ts shapeSuggestions`)在引擎外圍用:每人每天上限(`TIGERAI_WIZARD_SUGGEST_CAP`,預設 5)、同類被按「不需要」之後少出、同一件事併進監督。新種類要出建議時呼叫它。

## 把「會議摘要」接上來(給另一條開發線)

1. 寫 `kinds/meeting.ts`:`prepare` 從 `ctx.params`(`{transcript}` 或已存的逐字稿 id)組 prompt;`allowed` 用你自己的行編號(例如逐字稿每段 `#1 #2…`);沒有逐字稿就 `{skip}`。
2. `finish`:用 `checkLines` 驗證,輸出 `記錄`(決議)、`提醒`(誰負責什麼、何時,收件人由**程式**從負責人欄位決定,不採信模型指定的收件人)、`監督`(沒人負責的事)、`建議`(後續追蹤)。
3. 在頻道上傳 → `startWizardRun({kind:'meeting', roomId, runnerId: room.owner_id, requestedBy: actor.id, trigger:'manual', params})`;從精靈清單開(沒有頻道)→ `roomId: null`,`runnerId` 是本人,結果只給本人(`to: {users:[本人]}`),不貼頻道。
4. 「一鍵把待辦開成交辦單」是**人按**的動作,放在你自己的路由裡呼叫 `createAssignment(actor, …)`;精靈程式碼不可以 import 它(`ce-wizards.test.mjs` 有掃描)。
5. 稽核 `asr.transcribe` 已在 `audit-text.ts` 有中文名。`WIZARD_ZH`(settings.ts)加上 `meeting` 的名字已預留。
6. 不要自己開第二個並行上限:一律走 `withAiSlot`(引擎已包好);轉文字服務呼叫不屬於 AI 名額,但若會佔住 GPU 請自己限流。

## HTTP

所有 `/api/tg/*` 都需要登入的 cookie;權限在伺服器重新檢查(「誰」見 `settings.ts canManageWizards`)。

| 方法與路徑 | 誰 | 內容 |
|---|---|---|
| `GET wizards/rooms/:room/settings` | 頻道建立者、所屬部門主管、管理員 | `{settings, defaults, runs[12], kinds, tick?}`(`settings.aspects` 是 `{daily:{…}, weekly:{…}}`,`defaults` 是建議預設)(`tick` 只給管理員) |
| `PATCH wizards/rooms/:room/settings` | 同上 | `{daily?:{enabled?,at?:"HH:MM"}, weekly?:{enabled?,at?,weekday?:1-7}, skill?:{…}, aspects?:{daily?:{record?,suggest?,supervise?,audit?,remind?}, weekly?:{…}}, reset?:["daily"\|"weekly"]}`;只改有帶的欄位;`reset` 刪掉該支的五個勾選列(回到建議預設);舊的平面寫法 `aspects:{record:true}` 同時套用到兩支;稽核 `wizard.settings` |
| `POST wizards/rooms/:room/run` | 同上 | `{kind:"daily"\|"weekly"\|"skill"}` 立即執行 / 重跑。回 `{run, outcome:"queued"\|"skipped"}`;`skipped` 的原因在 `run.error`。頻道已關閉 409 `room_closed`;同一支正在跑 409 `already_running` |
| `POST wizards/rooms/:room/adhoc` | 頻道成員(含主管、管理員) | **訊息分析**:`{aspects:["record","suggest",…], range:{type:"today"\|"days"\|"week"\|"custom", n?, from?, to?}, slides?:bool}`。回 `{run, outcome, routing:{toHeadsOnly, private}}`。同頻道 5 分鐘一次(429 `rate_limited`,略過的不算);天數與自訂範圍最多 31 天(400 `bad_range`);沒選面向 400 `bad_aspects`;非成員 403/404;頻道已關 409。`trigger` 是 `manual-adhoc` |
| `POST wizards/runs/:run/confirm` | 同上 | 草稿 → 已確認;稽核 `wizard.confirm`;只能一次(409) |
| `POST wizards/items/:item/adopt` / `dismiss` | 頻道建議:同上;技能提案:**管理員** | 稽核 `wizard.adopt` / `wizard.dismiss`;技能採用另有 `skill.approve` 並寫成 `<agent dir>/skills/<名稱>/SKILL.md` |
| `POST wizards/items/:item/ack` | 該項目的收件人本人 | 「我知道了」;別人(含管理員)得 404 |
| `GET wizards/mine` | 登入者 | `{items, proposals}`(公佈欄 `bulletin/personal` 已包含同樣內容,`kind:"wizard"`) |
| `GET /api/tg/rooms/:id` | 頻道可見者 | 多了 `wizard:{runs, items}`(卡片資料)和 `can.wizards` |
| `GET admin/wizards/status` | 管理員 | `{mode, lastRunAt, stale, anyEnabled}` — `mode` 是 `builtin`(Portal 內建排程,20 分鐘沒跑 = `stale`)或 `external`(顧問包的外部排程,超過 1 小時沒收到 = `stale`) |
| `POST /api/tigerai/hooks/wizards/tick` | 顧問包才有(社群版回 404) | 外部排程的進入點,見 `docs/ADDON.md`;內建排程不用它 |

## 資料表

`wizard_settings`(頻道、key=`daily|weekly|skill|aspect:<面向>`)、`wizard_runs`(每次執行,含 `period` 日或 ISO 週、`confirm_state`、`post_seq`)、`wizard_items`(每則結果與收件人、出處 JSON、狀態 open/adopted/dismissed/done)、`wizard_meta`(上次收到排程的時間)。都在 `db/store.ts` 的 SCHEMA 裡(`CREATE TABLE IF NOT EXISTS`,舊資料庫自動長出來)。


## 1.1.0-ce 的增補

- **面向設定是每支精靈一組**:`settings.ts` 的 `ASPECT_DEFAULTS = {daily, weekly}`;`wizard_settings.key` 為 `aspect:daily:<面向>` / `aspect:weekly:<面向>`(舊的 `aspect:<面向>` 在沒有新列時繼續生效)。`collectFacts` / `factItems` 收的是 `{aspects: Record<Aspect,bool>}`,要用哪一組由種類決定。
- **新種類 `adhoc`(訊息分析)**:`wizards/kinds/adhoc.ts`,參數 `{aspects, sinceTs, untilTs, rangeLabel, slides, requesterId, requesterName, alsoTo}` 存在 run 的 `input`;`alsoTo` 是**伺服器**依要求者身分決定的(主管/建立者/管理員 = 自己),前端送的值不會被採信。啟動走 `wizards/adhoc.ts requestAdhoc()`(權限、範圍、5 分鐘限制),`handleAdhocMention()` 給 `@AI` 句子用,解析在 `wizards/adhoc-parse.ts`(純函式,`parseAdhoc` / `parseRange` / `parseAspects`)。
- **報告**:`wizards/report.ts`:`reportDecks()`(純函式,頻道版與主管版兩份定義)、`makeReport()`(`buildPptx` → `convertToPdf` → `saveDeck`,不丟例外)。新種類要附投影片時呼叫它;私下的主管版項目帶 `extra.deck`(deck id)。
- **每日摘要的 `prepare`** 可回 `noModel`:沒有新訊息但有提醒、或只勾了提醒時不呼叫模型。
- 測試:`tigerai/tests/ce-aspects.test.mjs`(預設、重設、提醒由程式算、週報五面向與報告、隱私分流、訊息分析 API、解析器、限流、`@AI`)。
