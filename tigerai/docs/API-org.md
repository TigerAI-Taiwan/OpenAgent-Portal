# 組織、目錄與人員異動 (feat/ce-org) — API 與擴充方式

給下一個開發者,以及要把精靈輸出接到目錄上的人(feat/ce-aspects)。全部在緩衝層 `tigerai/`,上游不改;`TIGERAI_ENABLED` 不是 `1` 時整組不存在。
管理員專用的路由掛在 `/api/tg/admin/*`(代理層擋非管理員,處理器再查一次);一般路由在 `/api/tg/*`,每條規則都在伺服器端。

## 1. 目錄對應 API(`tigerai/directory/map.ts`)

磁碟上的資料夾**只用內部代號命名、永不改名**;畫面上的名稱與樹由資料庫的關係即時算出。`dir_map(kind,id,folder)` 記錄每個單位、頻道、人的資料夾(相對 workspace 根目錄),第一次用到時寫入。

```ts
channelFolder(roomId, "每日摘要" | "工作週報" | "訊息分析" | "檔案"): string   // 絕對路徑,不存在就建立(mode 700)
personFolder(userId, "給我的提醒" | "給我的監督與稽核" | "我的產出" | "我的檔案"): string
unitFolder(unitId): string
companyAnnouncementsFolder(): string                      // workspace/company/公告
folderPath(kind, id): string                              // 只算路徑、不建立(閱覽用)
displayPath(kind, id, sub?): string[]                     // ["全公司","部門","財務部","頻道","月結專案","每日摘要"]
```

**精靈與其他功能寫檔一律走這幾個函式,不要自己拼路徑。** 要新增一種輸出資料夾,只改 `CHANNEL_SUBS` / `PERSON_SUBS`。檔案本身是普通檔案(Markdown 為主),目錄樹只讀。

### 對應表(現況)
| 概念 | 內部代號 | 實際位置 | 備註 |
|---|---|---|---|
| 單位 | `groups.id` / `dir_name` | `workspace/groups/<dir_name>/` | 改名、改上層、刪中間層都不搬資料夾 |
| 頻道 | `rooms.id` | `workspace/rooms/<id>/<子資料夾>/` | `rooms.unit_id` 只決定目錄顯示位置(NULL＝跨部門頻道),**不給任何人權限** |
| 人 | `users.dir_name` | `workspace/users/<dir_name>/<子資料夾>/` | 換部門、離職都不搬 |

## 2. 目錄樹 API(`tigerai/directory/tree.ts`、`api/dir.ts`;所有登入者,只有 GET)

| 路由 | 說明 |
|---|---|
| `GET /api/tg/dir?node=<id>` | 資料夾:`{kind:"folder",id,name,crumbs,entries[],note?}`;檔案:`{kind:"file",file:{name,size,mime,text,truncated,markdown}}` |
| `GET /api/tg/dir/file?node=<id>[&download=1]` | 檔案本體(`nosniff`;非 PDF 加 `Content-Security-Policy: sandbox`) |
| `GET /api/tg/dir/export?node=<id>&format=pdf\|pptx` | Markdown 轉 PDF/pptx(沿用 `make_slides` 的簡報產生器與 Gotenberg;沒設轉檔服務時 PDF 回 409) |

節點 id:`root`、`co`、`co/ann[/檔]`、`units`、`unit:<id>[/chans\|members\|sub]`、`cross`、`chan:<id>[/<子資料夾>/<檔…>]`、`people`、`person:<id>[/<子資料夾>/<檔…>]`。含 `..`、空段、反斜線、未知開頭一律 404;符號連結一律不列出、不跟隨。

### 誰看得到什麼(依「現在的關係」,不繼承)
| 內容 | 本人 | 頻道成員 | 單位主管(直接成員) | 管理員 | 接手人 |
|---|---|---|---|---|---|
| 頻道目錄 | — | 看 | 看(單位成員所在頻道,稽核) | 看(含已封存) | — |
| 給我的提醒 | 看 | 不 | 不 | 不 | 不 |
| 給我的監督與稽核 | 看 | 不 | 不 | 看(稽核) | 不 |
| 我的產出、我的檔案 | 看 | 不 | 唯讀,每次稽核 | 唯讀,每次稽核 | 唯讀,每次稽核 |
| 部門/<單位> | — | — | 看自己單位 | 全部(含子單位樹) | — |

看別人的個人目錄一律寫稽核 `dir.person_view`(範圍:head / admin / handover)。主管看不到別的主管、管理員(沿用 `userlog` 規則)。

## 3. 單位、員編、換部門、離職(管理員)

| 路由 | 說明 |
|---|---|
| `PATCH /admin/groups/:id` `{name?,description?,parentId?}` | 改名、改上層;擋自己、擋後代(成環)、名稱重複 |
| `DELETE /admin/groups/:id` | 刪中間層:子單位與歸在它底下的頻道一起接到它的上層(沒有上層就成最上層/跨部門);成員只少這個單位 |
| `PUT /admin/users/:id/employee-id` `{employeeId}` | 員編,選填、全公司唯一(不分大小寫),文字存放 |
| `GET /admin/users/:id/inventory` | 名下有什麼:頻道(含排程數)、個人 AI 角色、未完成交辦單與分享申請、對話數、金鑰數、單位 |
| `POST /admin/users/:id/leave` `{successorId?,channels?,assignments?,orders?,agents?}` | **離職**:帳號停用(單位關係保留)、金鑰立即停用、逐項交接、接手人唯讀。名下有東西卻沒指定接手人:409 `successor_required` |
| `GET /admin/users/:id/unit-change?units=a,b` | 換部門預覽 |
| `PUT /admin/users/:id/units` `{unitIds,assignments?,assignTo?}` | 換部門:整批取代單位連結 |
| `PATCH /admin/users/:id` `{status:"active"}` | 復職:還原 30 天內的金鑰、結束接手人的讀取權 |
| `PATCH /rooms/:id` `{unitId,isDefault?}` | 頻道歸單位(擁有者或管理員;`isDefault` 只有管理員) |
| `GET /unit-changes` / `POST /unit-changes/:id {decision:"keep"\|"remove"}` | 換部門後的專案頻道,舊單位主管(或管理員)決定去留 |
| `POST /admin/rooms/:id/purge` `{confirm:true,typedName}` | 唯一會真的刪頻道資料的路徑:已封存的頻道、雙重確認、稽核 |

稽核動作:`member.handover`、`member.handover_room`、`member.keys_disabled`、`member.keys_purged`、`member.rejoin`、`member.unit_change`、`member.unit_room`、`dir.person_view`、`dir.export`、`room.unit`、`room.purge`(手動)、`group.rename`、`group.move`、`user.employee_id`、`org.import`/`org.import_item`/`org.export`。

## 4. org.xlsx(`tigerai/org/*`)

| 路由 | 說明 |
|---|---|
| `GET /admin/org/export` | 目前的組織,三張表:`units`(name、parent、description、managers、confirmers)、`members`(action、email、employeeId、name、role、status、units)、`lists`(下拉來源與每欄說明) |
| `POST /admin/org/preview` | body＝.xlsx。回 `{errors[],warnings[],changes[],summary,digest}`;**不寫任何東西** |
| `POST /admin/org/apply?digest=<digest>` | 同一個檔;digest 不符(檔案或資料變了)409 `stale_preview`;缺 digest 400;有錯 422;成功回 `initialPasswordsCsv`(新帳號一次性密碼,只此一次) |

規則見 `DECISIONS.md`「社群版:組織、目錄與人員異動」。預覽＝在交易裡真的跑一次再復原,所以匯入與手動操作用同一套規則、不會漂移;檔案系統的副作用(個人金鑰)在預覽時一律不做。

## 5. 測試

```
node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-org-p1c.test.mjs   # 離職交接、金鑰 30 天、接手人唯讀
node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-org-p2.test.mjs   # 對應表、目錄樹權限、換部門、單位樹
node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-org-p3.test.mjs   # org.xlsx
```
