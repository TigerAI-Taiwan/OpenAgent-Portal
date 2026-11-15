<p align="center"><img src="public/brand/tigerai-logo.png" alt="TigerAI" width="140"></p>

# OpenAgent Portal（based on pi-agent and pi-web）

**給團隊用的自架 AI Agent 入口：公司、學校都能用。** 頻道、交辦、技能、n8n，全部跑在你自己的機器上。

[English](README.en.md) · 社群版 1.1.x-ce · 沒有人數上限

---

## 為什麼需要它

個人用的 AI Agent 工具，一次只服務一個人。團隊要的是另一組東西：

- **共用的頻道與紀錄**：事情說過、決定過、誰答應了什麼，都留得下來、追得到。
- **管理**：帳號與管理員、稽核紀錄、要給別人用的流程要經審查才上架。
- **地端模型加備援**：平常用你自己的模型，主要連線掛了才改走備援。

OpenAgent Portal 就是把這些補在 pi-agent / pi-web 之上。AI 只寫草稿與建議；確認、採用、完成、核准都由人按。

## 從故事開始看

兩個虛構的故事，各用一條線帶你看完整個產品（故事檔在 [`docs/stories/`](docs/stories/)）：

- **[虎虎生風精密：三個月，把一張單追到底](docs/stories/中小企業主_故事_v1.0.md)**（*Taiwan Tech Precision: Three Months to Follow One Order All the Way Through*）
  同仁先用自己的話留下工作，公司再把紀錄一步步變成接得下去、追得到的工作；從全公司頻道、部門與專案頻道，長成 **企業大腦（Company Brain）**。
- **[學 AI Agent：王老師的一學期](docs/stories/學校課程_故事_v1.0.md)**（*Learning AI Agents: Professor Wang's Semester*）
  學生學的不是「怎麼問 AI」，而是看懂細節、讓 AI 把事情做對，從寫提示詞、建技能到建 n8n 流程。

英文版：[Taiwan Tech Precision](docs/stories/SME_Story_v1.0_en.md) · [Professor Wang's Semester](docs/stories/School_Story_v1.0_en.md)。故事裡的公司、學校、人物與數字皆為虛構。

## 社群版功能

| 類別 | 功能 |
|---|---|
| 日常工作 | 對話（傳圖、附加 .md/.txt）；頻道（全公司／部門／專案，可 @AI）；交辦（給人或給 AI，做完要人確認）；公佈欄與鈴鐺；提示詞（自己寫、`#` 叫出、可分享） |
| 技能 | 內建技能（含工具）：填寫申請表、上網找參考資料、做成報告投影片、n8n 流程助手；可「複製成我的」，也可自建技能。技能不會多給權限 |
| 精靈（摘要與分析） | 每日摘要、工作週報、訊息分析，都從「記錄、監督、稽核、提醒、建議」五個面向看，每項產出附出處；另有 SKILL 建議、會議摘要（上傳錄音或貼逐字稿，需另接語音轉文字服務） |
| 上網與文件 | 上網查資料（SearXNG，只送查詢關鍵字）；做成報告投影片、填表出 PDF（Gotenberg 轉檔） |
| n8n | 簡易 webhook（Portal 呼叫 n8n、n8n 呼叫 Portal）；**n8n MCP**。社群版只開放 n8n 的 MCP，當作 MCP 示範；每人可自己建、測流程，上架給別人用才要管理員審查 |
| 模型 | 多組連線排順序；地端模型＋備援；每人可加個人金鑰（含 NVIDIA 免費選項），個人連線與公用模型可互相備援 |
| 帳號與管理 | 自行註冊＋通關密語＋核准；組織 `org.xlsx` 匯入；使用者紀錄（最後上線、停留時間、CSV 匯出）；稽核；閒置自動登出 |

更多（MCP 集成區、其他系統的 MCP、Gitea 存檔、營運飛輪與流程範本、API Proxy）屬顧問包或商業客製版，見 [EDITIONS.md](EDITIONS.md)。

## 快速開始（Docker）

**需要**：能跑 Docker 的機器（含 `docker compose`）。映像：

```
ghcr.io/tigerai-taiwan/openagent-portal:1.1.2-ce
```

> 預設埠 **30161**。想從原始碼自己建映像：`docker compose up -d --build`（同一個標籤）。

Portal 與其他三項服務是**各自獨立的容器**，Portal 後台只填網址、按測試：Portal（必要）；SearXNG（上網查資料）、Gotenberg（投影片／PDF 轉檔）、n8n（流程）都是選配。

`.env`（複製 `.env.example` 後填寫；**不要提交進版控**）。最少要填這三行，其他都有預設值：

```env
TIGERAI_ADMIN_EMAIL=you@example.com
TIGERAI_ADMIN_PASSWORD=<請設定很長的密碼>
TZ=Asia/Taipei
```

要用選配服務時再加（見下一節）：`COMPOSE_PROFILES=search,convert,n8n`、`SEARXNG_SECRET=<隨機字串>`、`N8N_ENCRYPTION_KEY=<隨機字串>`。要讓區網連線：`PI_WEB_BIND=0.0.0.0` 並填 `PI_WEB_ALLOWED_HOSTS`（使用者在瀏覽器輸入的主機名稱，逗號分隔）。埠：`PI_WEB_PORT`（預設 30161）。

`compose.yaml`（repo 內附，節錄；服務名稱 `pi-web`）：

```yaml
services:
  pi-web:
    image: ghcr.io/tigerai-taiwan/openagent-portal:${OAP_IMAGE_TAG:-1.1.2-ce}
    restart: unless-stopped
    environment:
      PORT: "30161"
      TIGERAI_ENABLED: "1"
      TIGERAI_ADMIN_EMAIL: ${TIGERAI_ADMIN_EMAIL:-adm@local}
      TIGERAI_ADMIN_PASSWORD: ${TIGERAI_ADMIN_PASSWORD:-}
      TZ: ${TZ:-Asia/Taipei}
    ports: ["${PI_WEB_BIND:-127.0.0.1}:${PI_WEB_PORT:-30161}:30161"]
    volumes: [pi-agent-data:/home/node/.pi/agent, pi-cwd-data:/home/node/pi-cwd]

  # 選配服務,預設不啟動(compose profiles):searxng(search)、gotenberg(convert)、n8n(n8n)
  searxng:   { profiles: [search],  image: "searxng/searxng:2026.9.5-c7f3080aa" }   # 只在內部網路,另需 docs/searxng-settings.yml(已附)
  gotenberg: { profiles: [convert], image: "gotenberg/gotenberg:8.21.1" }          # 只在內部網路
  n8n:       { profiles: [n8n],     image: "docker.n8n.io/n8nio/n8n:2.44.6" }      # 編輯畫面只綁本機 127.0.0.1:5678
```

選配服務**不會**隨 `docker compose up -d` 啟動；要用哪個就開哪個：

```
docker compose --profile search --profile convert --profile n8n up -d
```

啟動後：

1. `docker compose up -d`（要選配服務就加 `--profile …`），瀏覽器開 <http://127.0.0.1:30161>。
2. 用 `.env` 的管理員登入。**第一次登入一定要先改密碼**，改完才進得去。
3. **設定 → 模型連線**：填你的模型服務（OpenAI 相容 `/v1` 網址與金鑰），按「測試」。沒有地端模型時，可直接用 NVIDIA 免費模型；有地端模型時，再加一條 NVIDIA 當**備援**（只有地端故障時才改走，畫面會標示，可關閉）。沒有模型，對話與精靈不會有回應。
4. **設定 → 管理**：填 SearXNG（`http://searxng:8080`）、Gotenberg（`http://gotenberg:3000`）、n8n（`http://n8n:5678`）的網址並測試；建立單位與成員，或開放通關密語自行註冊。

會議摘要用的**語音轉文字是另一個服務**（OpenAI 相容的轉寫端點），Portal 不內附。所有資料放在 Docker volume，備份就是複製資料卷。

## 資料與隱私

平常資料全部在你的機器上。只有在你設定了備援（例如 NVIDIA）或成員加了個人金鑰、而地端模型失敗或該成員選用時，對話才會送到你選擇的模型服務商，畫面會標示。上網搜尋只送查詢關鍵字。**管理員可以查看成員的對話**（唯讀、每次查看記稽核），成員的設定頁固定告知這件事。

## 版本

| | 社群版（本 repo） | 顧問包 | 商業客製版 |
|---|---|---|---|
| 內容 | 上表所有功能，**不設人數上限** | 顧問帶著把流程與系統接好 | 依個人管權限、串核心系統 |
| 取得 | 自行安裝 | 由虎智授權的顧問提供 | 與虎智洽談 |

> 社群版的東西，你們都可以自己動手。要省時間、少走冤枉路，或想要有人負責交付和交接，再來找顧問服務。

## 手冊

老師使用手冊、中小企業導入手冊：**PDF 手冊與上課投影片：聯繫虎智科技索取。**

## 致謝與授權

- 上游：[pi-web](https://github.com/agegr/pi-web)（agegr，MIT）、[pi-agent / pi](https://github.com/earendil-works/pi)（earendil-works，MIT）。授權聲明見 [NOTICE](NOTICE)。本專案**不是**上游的官方版本。
- `tigerai/` 目錄採用 TigerAI Sustainable Use License（**草稿，待法律審閱**）。Logo 為 TigerAI 商標，不在程式授權範圍內。

作者：盧業興 Morris Lu · n8n Taipei Ambassador · 虎智科技 TigerAI（n8n Expert Partner）。
有使用問題可以來找虎智科技（tiger.ai.tw@gmail.com）。

---

## 上游 pi-web 快速開始（不啟用 TigerAI 層）

不設 `TIGERAI_ENABLED` 時，本專案行為與上游 pi-web 相同。上游的 npx 快速開始、設定、遠端存取與開發說明，請見 [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md)（由現行 README「上游 pi-web 的快速開始」以後各節搬移）。
