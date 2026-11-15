# TigerAI Agent Portal - first generation

A multi-user layer on top of [pi-web](https://github.com/agegr/pi-web): accounts,
groups, who may see which conversation, team rooms with `@mentions` and an AI
participant, a prompt library, and an organisation sheet import. It is **fair-code
(source available)**, not open source in the OSI sense: free to use and modify,
including inside a company, but you may not resell it or offer it as a hosted
service. See `LICENSE` (draft, pending legal review).

All of it lives in this directory. Upstream files only gained one-line call sites
marked `// TG-HOOK:Hxx`, and none of it runs unless `TIGERAI_ENABLED=1`.

## Run it

```bash
export TIGERAI_ENABLED=1
export TIGERAI_DATA_DIR=/path/to/data        # tigerai.db, cookie key, workspace
export TIGERAI_ADMIN_EMAIL=admin@example.com # first start only
export TIGERAI_ADMIN_PASSWORD=...            # first start only; if unset a one-time password is printed to the server log
npm run dev                                  # or: next start
```

| Variable | Meaning | Default |
|---|---|---|
| `TIGERAI_ENABLED` | `1` turns everything on. Unset = upstream behaviour, unchanged | off |
| `TIGERAI_DATA_DIR` | database, session-cookie key | `<pi agent dir>/tigerai` |
| `TIGERAI_WORKSPACE_ROOT` | folders `users/<id>`, `groups/<id>`, `rooms/<id>` | `<data dir>/workspace` |
| `TIGERAI_ADMIN_EMAIL` / `TIGERAI_ADMIN_PASSWORD` / `TIGERAI_ADMIN_MUST_CHANGE` | first administrator, created at first start only (school install: `tiger.ai.tw@gmail.com`); `1` forces a new password at first sign-in | `admin@example.com`, generated, forced |
| `TIGERAI_VENDOR_EMAIL` / `TIGERAI_VENDOR_PASSWORD` / `TIGERAI_VENDOR_MUST_CHANGE` | optional TigerAI maintenance account: system status, model connections and service settings only; cannot see people's conversations or records; the customer's administrator can disable it | none (no account) |
| `TIGERAI_LOGIN_GLOBAL_FAILS` | failed sign-ins over the whole server in 5 minutes before everyone waits (each account also waits on its own, 1 to 60 s, doubling) | 300 |
| `TIGERAI_REGISTER_PER_HOUR` / `TIGERAI_REGISTER_GLOBAL_PER_HOUR` | registrations one class (passphrase) takes per hour / all classes together | 120 / ten times that |
| `TIGERAI_REGISTER_WRONG_GLOBAL` | wrong passphrases over the whole server in 10 minutes (each account also waits on its own) | 200 |
| `TIGERAI_SESSION_SECRET` | cookie signing key (32+ chars); generated and stored if unset | generated |
| `TIGERAI_COOKIE_SECURE` | `1` adds `Secure` to the cookie (use behind HTTPS) | off |
| `TIGERAI_V1_BASE_URL` | the `/v1` endpoint that provides all models; setting it also locks provider sign-in and editing | unset (upstream model handling) |
| `TIGERAI_V1_API_KEY_FILE` | file holding that endpoint's key (never printed or returned) | none |
| `TIGERAI_V1_MODELS` / `TIGERAI_V1_EXCLUDE` / `TIGERAI_V1_DEFAULT_MODEL` | comma list of model ids; ids to hide; the default model | models fetched from `{base}/models`; `tigerai-fast` if offered |
| `TIGERAI_V1_CONTEXT_WINDOW` / `TIGERAI_V1_MAX_TOKENS` | conservative values used for every model | 32768 / 4096 |
| `TIGERAI_REGISTER_PER_HOUR` | most self-registrations accepted per rolling hour over the whole server (the switch 「開放自行註冊」 is off by default and lives in 設定 › 管理 › 成員) | `120` |
| `TIGERAI_WEB_SEARXNG_URL` | optional INITIAL address of the SearXNG service for 上網查資料; the real setting lives in 設定 › 管理 › 上網查資料 (a saved value wins; nothing is hard-coded, the feature is off by default) | unset |
| `TIGERAI_CONVERTER_URL` | optional INITIAL address of the 文件轉檔服務 (Gotenberg) that turns the AI's .pptx into a PDF; same rule: set it in 設定 › 管理 › 上網查資料, a saved value wins | unset (the AI delivers .pptx only) |
| `TIGERAI_TZ` | the company's time zone: what "today", "18:00" and "overdue by N days" mean for the wizards | `Asia/Taipei` |
| `TIGERAI_WIZARD_SCHEDULER_MS` | step of the Portal's own wizard timer; `0` = off | 300000 (5 minutes) |
| `TIGERAI_ADDON_DIR` / `TIGERAI_LICENSE_FILE` | where an add-on licence is looked for (`license.json` in the folder; default `<data dir>/addons`) | none needed in the community edition |
| `TIGERAI_FORM_FONT` | path of a TrueType .ttf font (not .otf / .ttc) with Chinese and Latin glyphs for the form tool (otherwise the first .ttf / .otf in `<data dir>/forms/fonts/`; an .otf is reported as unusable); not shipped | none: filling is refused until a font exists |
| `TIGERAI_FORM_RETENTION_DAYS` | days a filled PDF is kept before it is deleted (`0` = keep) | 30 |
| `TIGERAI_AI_RUN_CONCURRENCY` | background AI jobs at once (交辦給 AI and the wizards share it) | 2 |
| `TIGERAI_WIZARD_SUGGEST_CAP` | suggestions a person's wizards may write per day | 5 |
| `TIGERAI_ADMIN_EMAIL` / `TIGERAI_ADMIN_PASSWORD` | the first administrator (a single-label domain such as `adm@local` is accepted) | `admin@example.com` / one-time password in the log |
| `TIGERAI_ADMIN_MUST_CHANGE` | `1` forces the first administrator to change the password at first login even when it came from `TIGERAI_ADMIN_PASSWORD` (the root `compose.yaml` sets it) | off (a generated password always must be changed) |

Inbound call from n8n (key from Administration > n8n):

```bash
curl -X POST "$PORTAL/api/tigerai/hooks/agent" -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -H 'Idempotency-Key: run-123' -d '{"message":"What is 12 times 12?"}'
```

Pages: `/tg/login`, `/tg/rooms`, `/tg/prompts`, `/tg/account`, `/tg/admin`.

## What it does

| Area | Behaviour |
|---|---|
| Accounts | email + password, administrator or member, groups (with department heads), disable at once, reset password with forced change, append-only audit log |
| Conversations | each belongs to the person who started it; list, search, stats, pins and every `/api/sessions/<id>`, `/api/agent/<id>` route are filtered; a conversation with no owner is for administrators only |
| Members' limits | work only in their own folder (or their group's); read-only tools (no shell, no edit/write); file tools fenced to the conversation's folder; no admin pages |
| Rooms | members, messages (append-only), `@name` mentions, unread counts that only move forward; `@AI` asks the plain model; `@<role>` asks an AI role the person may use; one request at a time per room, failure becomes one short notice |
| Prompt library | personal prompts are private; sharing is a work order approved by another administrator; department heads tick which library prompts their department uses; the `/` menu shows own + ticked |
| Wizards (精靈) | 每日摘要, 工作週報 and SKILL 建議 per channel (off until the channel's creator, a department head or an administrator turns them on; each keeps all five switches; recommended defaults: daily 記錄 + 提醒, weekly all five plus a slide report; plus 訊息分析 on demand). The five aspects: 記錄 and 建議 go into the channel as a draft to confirm; 監督 and 稽核 go only to the creator and the department heads; 提醒 goes only to the person who owes it; all private results land in the 公佈欄 個人區 and the bell. Every item cites its source messages (no source, no item). the Portal's own timer starts them (every 5 minutes; `TIGERAI_WIZARD_SCHEDULER_MS` changes the step, `0` switches it off). Details: `docs/API-wizards.md`, `docs/COMMUNITY_EDITION.md` |
| Models | one OpenAI-compatible `/v1` endpoint only (`TIGERAI_V1_BASE_URL`, key from a file); no OAuth or key sign-in is offered to anyone |
| n8n webhooks (community scope) | webhooks the AI can call (`n8n_webhook` tool, groups ticked by an administrator, optional secret header); an inbound endpoint `POST /api/tigerai/hooks/agent` with one hashed key per caller; every call audited. The n8n MCP connection (系統連接, n8n only; `docs/COMMUNITY_EDITION.md` 2c) is a community feature, writes need an approved work order; other systems' MCP templates and the n8n schedule endpoint are consultant-pack features (`docs/ADDON.md`) |
| Form filling (community scope) | an administrator or department head uploads a blank PDF + field map; the AI (`list_forms`, `fill_form`) collects data from the student and gets a PDF back only when nothing is missing or contradictory; `docs/FORMS.md` |
| Organisation sheet | `org.xlsx` (units / members / lists), preview then all-or-nothing apply, hire / leave / keep |

## Security behaviour you will meet (security-review batch, fix/ce-security)

| Where | What you will see | Why / how to work with it |
|---|---|---|
| Models, search provider, speech-to-text, system connections (n8n) | Moving a saved address (or switching the search provider) without typing the key again is refused with `key_required`; the 測試 buttons likewise never send a saved key to an address that is not the saved one | A saved key only goes to the address it was saved for. Changing the address: type the key again (or remove it). Applies to every role |
| Maintenance (vendor) account | Read-only (`GET`) on models / web / asr / connectors; no save, no test | Changes there need the customer's administrator |
| n8n workflows | A member can update / archive / publish / execute only workflows they created through the Portal; administrators can act on all. Creating is free. Administrators can mark a workflow "shared for running" or assign an owner: `POST /api/tg/admin/connectors/<server>/workflows` with `{workflowId, shared?: true/false, ownerId?}`; `GET` the same path lists owners. After `web_fetch`/`web_search` in a turn, n8n changes are refused until the user speaks again (`needs_confirmation` in the audit trail) | **Best effort.** The community edition uses ONE shared n8n token: anybody with n8n's own screens or API can still change anything. Real per-person control is the commercial edition (API proxy with identity and ACL). A workflow made before this rule, or whose id the answer did not contain (`mcp.owner_unknown` in the audit trail), has no owner until an administrator assigns one |
| 永久刪除 | Also removes meeting transcripts + audio + half-finished uploads, personal slides, prompt cache, handover records, blanks the maker on channel decks, drops the person's `TIGERAI_PKEY_*` variables from the process, and VACUUMs the database (free pages and the log no longer hold the rows). The preview lists each kind | Test: `tigerai/tests/sec-h2-purge-complete.test.mjs` scans every file and table for the id/e-mail afterwards |
| Self-registration | New or changed class passphrases need 8+ characters (a CJK character counts 1; older ones keep working). Pending accounts are not in 全公司頻道 until approved. Waits are kept per account AND per client (forwarded address + browser, only when a reverse proxy sets `X-Forwarded-For`); the "too many wrong passphrases" ceiling (`TIGERAI_REGISTER_WRONG_GLOBAL`) refuses only wrong passphrases | Without a proxy header there is no client key (everyone looks alike); put the Portal behind a proxy that sets it |
| `web_fetch` | Only addresses the user pasted in the conversation or `web_search` returned in it (anything else: 「只能讀你貼的網址或搜尋結果裡的網址」, audit `web.fetch_blocked`); redirects stay on the same site. 20 s total deadline, at most 8 at once, and an address carrying a long value / random token / running text is refused (`fetch_payload`, audit `web.fetch_blocked` with host and reason only) | Stops "open https://evil/?q=<the conversation>"; short leaks still pass |
| Default port | 30161 (CLI default, `npm run dev/start`, Dockerfile, compose) | **Intentional difference from upstream (30141)**, so both can run on one machine; it is not an opt-in of the TigerAI module |

## Tests and checks

```bash
node tigerai/tools/check-hooks.mjs          # every TG-HOOK present, nothing unlisted, new routes/session creators flagged
node tigerai/tools/check-public.mjs         # hygiene scan of what this fork added (internal names + secret shapes: sk-ant-, sk-or-, sk-, JWT, AIza, nvapi-, AWS, GitHub/GitLab/Slack, bearer, 40-hex)
node tigerai/tools/check-public.mjs --staged            # only what is staged, from the index (pre-commit)
node tigerai/tools/check-public.mjs <base> --history    # also every line any commit since <base> ever added (run before a public push)
node --experimental-strip-types --test tigerai/tests/path-guard.test.mjs
# dev-only fakes in tigerai/dev/: mock-v1.mjs (fake /v1 with scripted tool calls) and mock-n8n.mjs (fake webhook);
# n8n.test.mjs runs against them (see its header for the variables)
# contract tests need a running dev server with TIGERAI_ENABLED=1 and two seeded members:
E2E_BASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... MEMBER_A_EMAIL=... MEMBER_A_PASSWORD=... \
MEMBER_B_EMAIL=... MEMBER_B_PASSWORD=... TIGERAI_DATA_DIR=... PI_CODING_AGENT_DIR=... \
node tigerai/tools/seed-test-accounts.mjs && node --test tigerai/tests/contract.test.mjs
```

After pulling a new upstream version, follow `docs/DECISIONS.md` ("Syncing with upstream").
