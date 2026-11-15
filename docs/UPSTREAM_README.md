> 這是 OpenAgent Portal 1.1.2-ce 之前的 README 全文(上游 pi-web 的快速開始、設定、遠端存取、開發說明,以及舊的 Docker 安裝段落)。現行的 README 在 [../README.md](../README.md) / [../README.en.md](../README.en.md)。
> This is the README as it was before 1.1.2-ce (upstream pi-web quick start, configuration, remote access, development notes and the old Docker section). The current README is [../README.md](../README.md) / [../README.en.md](../README.en.md).

# OpenAgent Portal

> **based on [pi-agent](https://github.com/earendil-works/pi) and [pi-web](https://github.com/agegr/pi-web)** (both MIT). Not an official release of either; see [NOTICE](NOTICE). The `tigerai/` directory is under a draft licence (草稿,待法律審閱 / draft pending legal review, [tigerai/LICENSE](tigerai/LICENSE)). The logo is a TigerAI trademark, not covered by the code licence (`public/brand/NOTICE.md`).

## 版本 / Editions

| | 社群版 Community | 顧問包 Consultant pack | 商業客製版 Custom |
|---|---|---|---|
| 對話、頻道、交辦、公佈欄、提示詞、四支內建精靈、地端模型＋備援 | yes | yes | yes |
| 簡易 n8n Webhook 示範(登記、AI 呼叫、n8n 呼叫 Portal) | yes | yes | yes |
| MCP 集成區:n8n 以外的系統(Gitea、Zabbix、自訂)、n8n 排程、Gitea、顧問工具 | no | yes | yes |
| MCP:n8n(示範) | yes | yes | yes |
| API Proxy(依個人權限) | no | no | yes |

**這個 repo 是社群版**:單純的本地版 Agent Portal,附簡易的 n8n Webhook 示範和 n8n 的 MCP 連線;沒有其他系統的 MCP、Gitea 與 n8n 排程。社群版只開放 n8n 的 MCP，當作 MCP 示範；其他系統的 MCP 請洽顧問或虎智科技（tiger.ai.tw@gmail.com）。顧問包是另外授權的加值包,不在這個 repo。完整說明、導入路徑與五個面向:[EDITIONS.md](EDITIONS.md)。

## 1.1.0-ce 學校課程版

把三條分支整合成一個學校課程用版本(社群版,TIGERAI_ENABLED≠1 時仍是原樣上游):

- **自行註冊 + 班級通關密語 + 核准 + 通知**:學生用老師寫的班級密語註冊,老師(該班負責人)或管理員核准,鈴鐺與公佈欄會提醒。
- **上網查資料與投影片**:AI 可 `web_search` / `web_fetch`(SearXNG、Brave、Tavily),`make_slides` 做可編輯的 16:9 PPTX,再經外部 Gotenberg 轉 PDF;預設關,管理員在「上網查資料」開。
- **系統連接(只開 n8n 的 MCP)**:讀取與寫入(建立、修改、試跑自己的流程)都不用核准、每次記稽核;只有把流程「上架」給別人才要管理員審查。
- **填表工具**:老師上傳表單包,學生請 AI 代填成 PDF;需要管理員提供 TrueType 中文字型(做法見 `tigerai/docs/FORMS.md`)。
- **內建技能(含工具)**:技能 → 可用技能有四個內建技能(填寫申請表、上網找參考資料、做成報告投影片、n8n 流程助手),附「內建」徽章;要改請「複製成我的」(原件每次啟動還原,你的複本不會被蓋掉)。可以自建技能來使用這些工具,但技能不會多給任何權限:每次呼叫工具仍檢查上網開關/群組、表單範圍與 n8n 核可。
- **我的模型連線**新增「NVIDIA(免費)」常用服務預設。
- 修正:核可/駁回確認視窗不再對非提示詞申請顯示「/名稱」;表單字型整個嵌入(fontkit 子集化會漏字)。

**內建精靈分級與「訊息分析」**(同一版 1.1.0-ce):

- **每日摘要**建議預設只有「記錄 + 提醒」(AI 只寫白話記錄;提醒全由程式算,私下送給欠事的人);**工作週報**建議預設五個面向全開,並做成報告投影片(頻道版只有記錄、建議、交辦單表;監督、稽核另做主管版,只給主管)。兩支精靈各自保留五個勾選,設定視窗標「建議預設」並有「回到建議預設」。
- **訊息分析**:頻道「⋯」→「訊息分析」,勾面向、選時間範圍,可做成報告投影片;從頻道選單啟動(`@AI` 只是一般問答)。結果的貼法與分送跟排程一樣,每頻道 5 分鐘一次。

**1.1.0-ce 定稿修訂**(細節與理由見 [COMMUNITY_EDITION.md](tigerai/docs/COMMUNITY_EDITION.md) 最後一節、[DECISIONS.md](tigerai/docs/DECISIONS.md)):

- **虎智維修帳號**(選填,`TIGERAI_VENDOR_EMAIL`):只能看系統狀態、模型連線、服務設定,看不到任何人的對話與紀錄,老師可隨時停用;成員頁固定告知「管理員可以查看你的對話。」
- 每個人可在「設定 → 帳號」改自己的姓名、電子郵件(要目前密碼)與密碼;姓名不必唯一、可含空白,建議「學號-班級-姓名」(公司「工號-部門-姓名」)。
- 閒置 30 分鐘自動登出(管理員可調整或關閉);登入與註冊的節流改成每個帳號、每個班各算;封存班級/部門;「監督」改成交辦單給當事人自己單位的主管並提醒當事人;已停用成員可永久刪除個人資料(兩步確認、稽核只留一筆);「使用者紀錄」合併停留時間與匯出 CSV(取代「到勤與使用」)。
- 社群版**沒有人數上限**,也沒有 100 人提醒。
- **有使用問題可以來找虎智科技(tiger.ai.tw@gmail.com)**。

安裝時的新環境變數:`TIGERAI_ADMIN_EMAIL`(學校預設 `tiger.ai.tw@gmail.com`)、`TIGERAI_ADMIN_MUST_CHANGE=1`、`TIGERAI_VENDOR_EMAIL` / `TIGERAI_VENDOR_PASSWORD` / `TIGERAI_VENDOR_MUST_CHANGE`,以及節流 `TIGERAI_LOGIN_GLOBAL_FAILS`、`TIGERAI_REGISTER_WRONG_GLOBAL`、`TIGERAI_REGISTER_PER_HOUR`、`TIGERAI_REGISTER_GLOBAL_PER_HOUR`(全表見 [tigerai/README.md](tigerai/README.md))。

1.1.2-ce 設定:設定 → 管理 → 模型有「個人連線與公用模型互相備援」開關(預設開);技能 → 可用技能有「新增技能」,管理員可審核後分享給全公司或單位。環境變數沒有新增。

完整功能表見 [tigerai/docs/COMMUNITY_EDITION.md](tigerai/docs/COMMUNITY_EDITION.md) 第 0 節。

## 安裝 OpenAgent Portal(Docker)

**需要**:一台能跑 Docker 的機器(Docker Engine 或 Docker Desktop,含 `docker compose`)、`git`、約 3 GB 磁碟、第一次建置需要連網。不需要另外安裝 Node.js。

```bash
git clone https://github.com/TigerAI-Taiwan/OpenAgent-Portal.git
cd OpenAgent-Portal
cp .env.example .env
# 用編輯器打開 .env,填 TIGERAI_ADMIN_EMAIL 與 TIGERAI_ADMIN_PASSWORD(第一位管理員,例如 adm@local)
docker compose up -d --build
```

第一次建置要幾分鐘。完成後:

1. 瀏覽器開 <http://127.0.0.1:30161>(`.env` 的 `PI_WEB_PORT` 可改埠;要從區網連,把 `PI_WEB_BIND` 改成 `0.0.0.0`,並把使用者在網址列輸入的主機名稱填進 `PI_WEB_ALLOWED_HOSTS`)。
2. 用 `.env` 裡的第一位管理員登入。**第一次登入一定要先換密碼**,換完才進得去。若 `TIGERAI_ADMIN_PASSWORD` 留空,臨時密碼會印在 `docker compose logs pi-web`(只印一次)。
3. 加模型連線:**設定 → 模型連線**,填你的模型服務(OpenAI 相容的 `/v1` 網址與金鑰)。建議再加一條**備援連線**,主連線沒回應時自動改用備援。沒有模型,對話與精靈都不會有回應。
4. 到管理頁建立成員與群組,開第一個頻道。

時區預設 `Asia/Taipei`(精靈的「每天 18:00」「逾期幾天」都依它算),要改就改 `.env` 的 `TZ`。所有資料(帳號、頻道、資料庫、對話)放在 Docker volume `pi-agent-data`;備份、升級(`git pull` 後再 `docker compose up -d --build`)與停止(`docker compose stop`)都不會動到它。

接下來:[EDITIONS.md](EDITIONS.md)(社群版與顧問包的差別)、[tigerai/README.md](tigerai/README.md)(所有環境變數)、[tigerai/docs/COMMUNITY_EDITION.md](tigerai/docs/COMMUNITY_EDITION.md)(社群版功能與四支內建精靈)。

*English summary:* install Docker, `git clone`, `cp .env.example .env`, set `TIGERAI_ADMIN_EMAIL`/`TIGERAI_ADMIN_PASSWORD`, run `docker compose up -d --build`, open `http://127.0.0.1:30161`, log in and change the password (forced), then add a model connection under Settings → Model connection (plus a backup connection). Schedules use `TZ` (default `Asia/Taipei`).

[中文文档](./docs/README.zh-CN.md) | [日本語](./docs/README.ja.md) | [Русский](./docs/README.ru.md)

Local browser UI for the [pi coding agent](https://github.com/earendil-works/pi). Pi Web uses the same local configuration and session files as pi, so you can browse and resume conversations, run agent turns, configure models and resources, and inspect project files from a browser.

**[Try the interactive demo →](https://agegr.github.io/pi-web/)** The real Pi Web UI runs entirely in your browser, with sample sessions, files and models. There is nothing to install; replies are pre-written and no model is called.

![Pi Web displaying a pi session with structured Markdown, tool calls, and project navigation](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## Features

- **Session workspace**: browse, resume, rename, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Project file tools**: browse and upload files, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Git worktrees**: switch checkouts from the sidebar while keeping sessions from the same repository grouped together.
- **Web-based configuration**: manage provider login and API keys, models, model tests, plugin packages, and skills without leaving Pi Web.
- **English, Simplified Chinese, and Traditional Chinese UI**: Pi Web follows the browser language initially. Change it under Settings → General → Language.

## 上游 pi-web 的快速開始(npx)

以下是上游 pi-web 的原始用法(不含 OpenAgent Portal 的登入與精靈;`TIGERAI_ENABLED` 沒開就是上游行為)。Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`, then run:

```bash
npx @agegr/pi-web@latest
```

The CLI opens a browser after the server is ready. If it does not, open [http://127.0.0.1:30161](http://127.0.0.1:30161). Pi Web listens only on `127.0.0.1` by default.

If no model provider is configured yet, open the **Models** panel to sign in or add an API key.

To install the `pi-web` command globally:

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

Commands:

```bash
pi-web version          # print the installed version
pi-web status           # list running servers
pi-web stop [--port N]  # stop a running server
pi-web open [--port N]  # open a running server in the browser
pi-web update [--check] # update a global npm install
```

To update, run `pi-web stop`, then `pi-web update` (or run the same install command again). To uninstall, run `npm uninstall -g @agegr/pi-web`.

## Configuration

For port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening. Run `pi-web --help` (or `-h`) to print startup options and exit without starting the server. Unknown options exit with an error.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--help`, `-h` | Print startup options and exit | — |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30161` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_APP_NAME` | PWA manifest `name` and `short_name`; surrounding whitespace is trimmed, empty values use the default | `Pi Web` |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable Pi Web update checks | Unset |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable browser password login; API clients may use Basic Auth with username `pi` | Authentication disabled |
| `PI_WEB_IDLE_TIMEOUT_MS` | Session idle timeout in milliseconds, up to `2147483647`; `0` disables idle shutdown; invalid or out-of-range values use the default | `600000` (10 min) |
| `PI_WEB_SHUTDOWN_DEADLINE_MS` | How long extensions get to handle `session_shutdown` before a closing session is disposed anyway, in milliseconds up to `2147483647`; `0`, invalid or out-of-range values use the default | `5000` (5 s) |
| `PI_CODEMODE_MAX_WORKERS` | pi's limit on codemode scripts running at once, shared by every session and subagent in the server; pi's own default is `2`, and pi-web sets `8` when the variable is unset or empty. Each script may use up to 256 MB | `8` |

Set `PI_WEB_APP_NAME` before starting the server (for example, `PI_WEB_APP_NAME='Work Pi' pi-web`). After changing it, restart the server to serve the new manifest; no rebuild is required. Updates to the name of an already installed PWA are managed by the browser and are not guaranteed to appear immediately. This does not change the page title or icons.

For example:

```bash
pi-web --help
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Password authentication does not encrypt the connection. Do not expose Pi Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Pi Web binds to.

With many chats, terminals or file previews active at once, plain HTTP limits the browser to six connections and requests start to wait; see [Serving Pi Web over HTTP/2](./docs/http2.md).

### Docker

Each release publishes an image to `ghcr.io/agegr/pi-web`. See [Running Pi Web in Docker](./docs/docker.md) for it, the Compose example and which volumes to keep.

### HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Notes

- **Agent data**: Pi Web reads pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another pi agent directory.
- **Filesystem access**: Pi Web must be able to read the agent data directory and the working directories recorded by its sessions. Run Pi Web in the same filesystem environment as pi when sharing existing sessions.
- **Shared configuration**: the Models panel uses pi's model, settings, and credential storage, so changes are visible to both interfaces. An open session applies a saved edit of its model when you select the model again.
- **File access boundary**: the file browser is limited to working directories selected in Pi Web and project or session roots it already knows about; it is not a general filesystem browser.
- **Git worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for switcher visibility, worktree creation, and removal behavior.
- **Integration hooks**: apps that embed Pi Web can replace the session row's context menu, and server-side pi extensions can keep a session from idle shutdown; see [Integration Hooks](./docs/integrations.md).

## Development

```bash
npm install
npm run dev
```

The development server runs at [http://127.0.0.1:30161](http://127.0.0.1:30161). Run the common checks with:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build` or `npm run build` during normal development. It writes to `.next/` and can interfere with the development server; leave builds for release work.

Before starting on a feature, read [Contributing](./CONTRIBUTING.md) for what is in scope and the pull request checklist.

Contributor guides: [Internationalization](./docs/i18n.md) and [Release process](./docs/release.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint and launch option parsing
docs/            Focused user and contributor guides
demo/            Static browser demo published to GitHub Pages (see demo/README.md)
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## License

[MIT](./LICENSE)

## TigerAI Agent Portal (this fork)

This fork adds multi-user accounts, conversation ownership, team rooms with an AI participant, a prompt library and an organisation-sheet import, all in [`tigerai/`](tigerai/README.md). The added code is **fair-code (source available)** under a draft Sustainable-Use-style licence (`tigerai/LICENSE`, pending legal review); it is not an OSI open-source licence. The upstream pi-web code stays under its MIT licence (`LICENSE`). Nothing of the addition runs unless `TIGERAI_ENABLED=1`.
