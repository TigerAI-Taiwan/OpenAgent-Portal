# OpenAgent Portal 安裝說明（Docker）

[English](INSTALL.en.md) · [回到首頁](../README.md)

首頁只放最短的步驟；這一頁是完整版：映像、`.env`、`compose.yaml`、選配服務、區網連線與語音轉文字。

---

## 需要什麼

能跑 Docker 的機器（含 `docker compose`）。映像：

```
ghcr.io/tigerai-taiwan/openagent-portal:1.1.2-ce
```

> 預設埠 **30161**。想從原始碼自己建映像：`docker compose up -d --build`（同一個標籤）。

Portal 與其他三項服務是**各自獨立的容器**，Portal 後台只填網址、按測試：

| 服務 | 用途 | 是否必要 |
|---|---|---|
| Portal（`pi-web`） | 對話、頻道、交辦、技能、精靈 | 必要 |
| SearXNG | 上網查資料（只送查詢關鍵字） | 選配 |
| Gotenberg | 報告投影片、填表出 PDF 的轉檔 | 選配 |
| n8n | 流程 | 選配 |

## `.env`

複製 `.env.example` 成 `.env` 後填寫；**不要提交進版控**。最少要填這三行，其他都有預設值：

```env
TIGERAI_ADMIN_EMAIL=you@example.com
TIGERAI_ADMIN_PASSWORD=<請設定很長的密碼>
TZ=Asia/Taipei
```

其他常用設定：

| 變數 | 用途 |
|---|---|
| `COMPOSE_PROFILES=search,convert,n8n` | 要用選配服務時再加（見下一節） |
| `SEARXNG_SECRET=<隨機字串>` | 開 search 之前要填 |
| `N8N_ENCRYPTION_KEY=<隨機字串>` | 開 n8n 之前要填；n8n 用它加密存下的憑證 |
| `PI_WEB_BIND=0.0.0.0` | 要讓區網連線時設定（預設 `127.0.0.1`，只有本機） |
| `PI_WEB_ALLOWED_HOSTS` | 區網連線時必填：使用者在瀏覽器輸入的主機名稱，逗號分隔 |
| `PI_WEB_PORT` | 本機這端的埠，預設 30161 |
| `TZ` | 時區；排程（例如每日摘要、逾期天數）依這個時區算 |

`.env.example` 裡每一項都有說明。

## `compose.yaml`

repo 內附，節錄如下；服務名稱是 `pi-web`：

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

## 選配服務

選配服務**不會**隨 `docker compose up -d` 啟動；要用哪個就開哪個：

```
docker compose --profile search --profile convert --profile n8n up -d
```

## 啟動後

1. `docker compose up -d`（要選配服務就加 `--profile …`），瀏覽器開 <http://127.0.0.1:30161>。
2. 用 `.env` 的管理員登入。**第一次登入一定要先改密碼**，改完才進得去。
3. **設定 → 模型連線**：填你的模型服務（OpenAI 相容 `/v1` 網址與金鑰），按「測試」。沒有地端模型時，可直接用 NVIDIA 免費模型；有地端模型時，再加一條 NVIDIA 當**備援**（只有地端故障時才改走，畫面會標示，可關閉）。沒有模型，對話與精靈不會有回應。
4. **設定 → 管理**：填 SearXNG（`http://searxng:8080`）、Gotenberg（`http://gotenberg:3000`）、n8n（`http://n8n:5678`）的網址並測試；建立單位與成員，或開放通關密語自行註冊。

## 語音轉文字與備份

- 會議摘要用的**語音轉文字是另一個服務**（OpenAI 相容的轉寫端點），Portal 不內附。沒有接上時，會議摘要仍可貼逐字稿。
- 所有資料放在 Docker volume，備份就是複製資料卷。

## 不啟用 TigerAI 層

不設 `TIGERAI_ENABLED` 時，本專案行為與上游 pi-web 相同，說明見 [UPSTREAM_README.md](UPSTREAM_README.md)。
