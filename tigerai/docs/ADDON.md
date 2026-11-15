# 顧問包的掛載點 (add-on mount point)

社群版是單純的本地版 Agent Portal。**顧問包**是另外授權的加值包:程式不在公開 repo,在虎智的私人 repo,建置顧問版映像時才放進來。這份文件說明社群版給它留的掛載點、授權怎麼檢查、顧問版映像怎麼建、顧問包裡有什麼。版本分界見根目錄 `EDITIONS.md`。

## 1. 原則

- **同一份程式碼、兩種映像。** 社群映像只有公開 repo;顧問映像是「公開 repo + 顧問包」。社群映像裡沒有顧問包的任何程式。
- **伺服器端擋,不是只藏畫面。** 沒載入或授權無效時:顧問包的 API 路由回 404、它的機器端點(`/api/tigerai/hooks/wizards/tick`)回 404、選單與頁面不存在、AI 對話不載入它的工具。
- **資料不刪。** 已經有顧問包資料的資料庫(n8n 登記、MCP 連接、金鑰)換成社群映像時,資料原封不動、社群版直接忽略;換回顧問映像並有授權就回來。顧問包的資料表(MCP 連接登記)由顧問包自己建(`init()`),社群版的資料庫從來不會有。
- 不做顧問角色。顧問的工作是拜訪、訪談、用虎智後台產出顧問包;客戶 Portal 不需要顧問帳號(待 Founder 最後確認)。「顧問服務聯絡窗口」之後若要做,是顧問包的一個掛點(見第 3 節「預留」),社群版這次沒有。

## 2. 檔案

| 檔案 | 作用 |
|---|---|
| `tigerai/addons/types.ts` | 顧問包的型別(`AddonModule`、`AddonUi`)= 掛載點契約 |
| `tigerai/addons/index.ts` | 這個建置裡有哪些顧問包(伺服器端)。**社群版是空陣列**;顧問映像建置時被取代 |
| `tigerai/addons/ui-index.ts` | 同上,瀏覽器端的頁面元件。社群版是空陣列 |
| `tigerai/addons/license.ts`、`license-key.ts` | 授權檔檢查(Ed25519)、內嵌的公鑰 |
| `tigerai/addons/registry.ts` | 執行時的閘門:授權有效才算「啟用」,所有對顧問包的詢問都經過這裡 |
| `tigerai/addons/hook-wizards-tick.ts` | 上游路由檔(H12)轉進來的入口;沒有啟用的顧問包就回 404 |
| `tigerai/ui/addons.ts`、`tigerai/ui/AddonPage.tsx` | 瀏覽器端:取得伺服器公告的選單、顯示「設定 → 管理 → 顧問包」頁 |

顧問包的程式必須被**編進**映像(Next 不能載入沒打包的程式);載入與否由授權在執行時決定。`TIGERAI_ADDON_DIR`(預設 `<資料目錄>/addons/`)放授權檔 `license.json`,也可用 `TIGERAI_LICENSE_FILE` 指定檔案。

## 3. 掛載點清單

一個顧問包是一個 `AddonModule`(`tigerai/addons/types.ts`):

| 掛點 | 欄位 | 誰使用 |
|---|---|---|
| 啟用條件 | `requires: string[]`(授權的 `features` 必須全部包含) | registry |
| 建表與遷移 | `init()`(授權通過後,每個行程一次) | registry |
| 設定頁籤(設定 → 管理) | `menus.settingsTabs` + 瀏覽器端 `AddonUi.settingsTabs[id]` | `SettingsOverlay` |
| 技能視窗頁籤 | `menus.skillTabs` + `AddonUi.skillTabs[id]` | `SkillsModal` |
| 「功能」清單區塊(功能 sources) | `menus.functionSources` + `AddonUi.functionSections[id]` | 功能按鈕(`parts.tsx`) |
| 側邊欄分組 | `menus.sidebar`(目前只宣告,尚未有畫面使用它;顧問包的側欄項目要等到那一步才接) | 預留 |
| 精靈種類 | `wizardKinds`(啟用時登記到精靈引擎,手動執行;排程只認三支內建的) | `wizards/kind-store.ts` |
| API 路由 | `routes`(`/api/tg/...`)、`adminRoutes`(`/api/tg/admin/...`,路由器先確認是管理員) | `api/router.ts` |
| 機器呼叫端點 | `hooks["wizards/tick"]`(`/api/tigerai/hooks/wizards/tick`;上游路由檔 H12 轉進來)。`hooks/agent` 是社群版自己的(n8n 呼叫 Portal) | 路由檔 |
| AI 對話的 pi 擴充 | `sessionExtensions(ctx)` | `adapter/index.ts startExtensions` |
| 成員可呼叫的 MCP 伺服器 | `allowsMcpServer(name)` | `adapter/path-guard.ts` |
| 連接範本(系統連接) | **顧問包自己內部的**範本登錄(`consultant/connectors/templates.ts`),公開樹沒有 | 顧問包 |
| 預留:顧問聯絡帳號 | 虎智在客戶 Portal 設定的「顧問服務聯絡窗口」。這次沒做,也沒有顧問角色;若做,它是顧問包的資料 + 一個設定頁籤,不改角色模型 | 預留 |

瀏覽器端的頁面元件只在**伺服器公告**了對應選單時才會渲染(`GET /api/tg/addons`),所以授權到期不必重建映像,頁面就消失。

## 4. 授權檢查

授權檔是 JSON:`{ "payload": { "org", "edition", "features": [...], "issuedAt", "expires" }, "signature": "<base64>" }`。

- 簽章:Ed25519,簽的是 payload 以固定欄位順序序列化的位元組(`canonicalPayload()`)。公鑰寫在 `tigerai/addons/license-key.ts`;**私鑰不在任何 repo**,只在虎智保管的 `secrets/openagent-license-signing.key`(權限 600)。
- 有效條件:簽章正確、`expires`(日期,含當天,UTC)未過、`features` 含顧問包 `requires` 的每一項、`TIGERAI_ENABLED=1`。授權檔改動後下一次請求就會重讀;到期判斷每次都重算。
- 結果:`未安裝`(沒編進映像)、`已安裝但授權無效`(原因:找不到、讀不了、簽章不對、格式不對、已到期、功能不含)、`已安裝+版本+到期日`。管理員在 設定 → 管理 → 顧問包 看到;成員只看得到選單有沒有出現。
- **已知缺口(開放)**:沒有防「把伺服器時間往前調」;授權不連網驗證;換公鑰會讓之前發的授權全部失效;單機授權沒有綁機器(商業上的「收入靠硬體綁定」另案)。

## 5. 顧問包內容(顧問版映像)

> 以下是顧問包負責的範圍。社群版**不含**其中任何一項。

| 項目 | 內容 | 狀態 |
|---|---|---|
| 系統連接(MCP 集成區) | n8n、Gitea、Zabbix、自訂 MCP 範本;依群組開放、唯讀工具白名單、金鑰檔、稽核 | 已做(從社群版搬出) |
| n8n 排程 tick | `/api/tigerai/hooks/wizards/tick`:精靈排程改由 n8n 控制,收到後內建排程退讓;n8n 流程範本下載、最後收到時間 | 已做(從社群版搬出) |
| n8n 與 Gitea 的安裝(docker)與接上 Portal | 在客戶機器用 docker 裝好 n8n 與 Gitea,並接上 Portal:MCP 連接、n8n tick、Gitea 存檔與版本紀錄 | **待做**:Founder 定案顧問包含此項,這次只寫清楚分界,沒有安裝程式 |
| Gitea 存檔與版本紀錄 | 紀錄存進 Gitea | **待做** |
| 顧問匯入、全公司部門頻道、營運飛輪專案、60 條流程 | 顧問用虎智後台產出顧問包後套用 | **待做**(顧問包的另一部分,規劃另案) |
| PostgreSQL 驅動 | 預留資料夾 `postgres/` | 之後 |

分界一句話:**社群版有簡易的 n8n Webhook 示範**(管理員登記 webhook 應用、AI 在對話/頻道呼叫它、n8n 用金鑰呼叫 `/api/tigerai/hooks/agent`、hook 金鑰管理),但**沒有 MCP 集成區、沒有 Gitea、沒有 n8n 排程**;這些與 n8n/Gitea 的 docker 安裝與接上都是顧問包的事。

## 6. 顧問版映像怎麼建

顧問包的原始碼在私人 repo(預定位置 `TigerAI-Taiwan/OpenAgent-Portal-Enterprise`)。

```bash
# 1. 公開樹的乾淨複本(不含 .git、node_modules)
git -C <公開 repo> archive HEAD | tar -x -C <建置目錄>
# 2. 放進顧問包,並把兩個空的登錄檔換成有它的版本
<顧問包 repo>/scripts/install.sh <建置目錄>
# 3. 用同一個 Dockerfile 建
docker build -t openagent-portal:1.0.0-ce-consultant <建置目錄>
```

`scripts/build-image.sh` 把三步包在一起(也能只建社群映像)。授權由 `scripts/issue-license.mjs` 發(私鑰路徑參數或 `OPENAGENT_LICENSE_KEY`);**發出去的授權檔放進客戶的 `TIGERAI_ADDON_DIR/license.json`**。測試用:`scripts/test.sh` 在拋棄式複本裡跑顧問包測試與公開測試,並發一份測試授權。

## 7. 給社群版開發者的規則

- 公開樹**不可以**出現顧問包的程式或它的資料表定義。新的對外串接一律做成顧問包的一部分,不放 `tigerai/`。
- 動到掛載點(`registry.ts`、`types.ts`)要同時跑公開測試與顧問包測試(`ce-addons.test.mjs` 有一個「最小範例包」測整個流程:授權沒有 → 什麼都不存在;授權有 → 路由、hook、選單、精靈種類出現;授權過期 → 又消失)。
