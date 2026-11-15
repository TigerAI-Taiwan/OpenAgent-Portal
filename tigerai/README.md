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
| `TIGERAI_SESSION_SECRET` | cookie signing key (32+ chars); generated and stored if unset | generated |
| `TIGERAI_COOKIE_SECURE` | `1` adds `Secure` to the cookie (use behind HTTPS) | off |
| `TIGERAI_V1_BASE_URL` | the `/v1` endpoint that provides all models; setting it also locks provider sign-in and editing | unset (upstream model handling) |
| `TIGERAI_V1_API_KEY_FILE` | file holding that endpoint's key (never printed or returned) | none |
| `TIGERAI_V1_MODELS` / `TIGERAI_V1_EXCLUDE` / `TIGERAI_V1_DEFAULT_MODEL` | comma list of model ids; ids to hide; the default model | models fetched from `{base}/models`; `tigerai-fast` if offered |
| `TIGERAI_V1_CONTEXT_WINDOW` / `TIGERAI_V1_MAX_TOKENS` | conservative values used for every model | 32768 / 4096 |
| `TIGERAI_TZ` | the company's time zone: what "today", "18:00" and "overdue by N days" mean for the wizards | `Asia/Taipei` |
| `TIGERAI_WIZARD_SCHEDULER_MS` | step of the Portal's own wizard timer; `0` = off | 300000 (5 minutes) |
| `TIGERAI_ADDON_DIR` / `TIGERAI_LICENSE_FILE` | where an add-on licence is looked for (`license.json` in the folder; default `<data dir>/addons`) | none needed in the community edition |
| `TIGERAI_AI_RUN_CONCURRENCY` | background AI jobs at once (交辦給 AI and the wizards share it) | 2 |
| `TIGERAI_WIZARD_SUGGEST_CAP` | suggestions a person's wizards may write per day | 5 |
| `TIGERAI_ADMIN_EMAIL` / `TIGERAI_ADMIN_PASSWORD` | the first administrator | `admin@example.com` / one-time password in the log |

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
| Wizards (精靈) | 每日摘要, 週報 and SKILL 建議 per channel (off until the channel's creator, a department head or an administrator turns them on; 記錄/建議 on, 監督/稽核/提醒 off by default). The five aspects: 記錄 and 建議 go into the channel as a draft to confirm; 監督 and 稽核 go only to the creator and the department heads; 提醒 goes only to the person who owes it; all private results land in the 公佈欄 個人區 and the bell. Every item cites its source messages (no source, no item). the Portal's own timer starts them (every 5 minutes; `TIGERAI_WIZARD_SCHEDULER_MS` changes the step, `0` switches it off). Details: `docs/API-wizards.md`, `docs/COMMUNITY_EDITION.md` |
| Models | one OpenAI-compatible `/v1` endpoint only (`TIGERAI_V1_BASE_URL`, key from a file); no OAuth or key sign-in is offered to anyone |
| n8n webhooks (community scope) | webhooks the AI can call (`n8n_webhook` tool, groups ticked by an administrator, optional secret header); an inbound endpoint `POST /api/tigerai/hooks/agent` with one hashed key per caller; every call audited. The MCP integration (系統連接) and the n8n schedule endpoint are consultant-pack features (`docs/ADDON.md`) |
| Organisation sheet | `org.xlsx` (units / members / lists), preview then all-or-nothing apply, hire / leave / keep |

## Tests and checks

```bash
node tigerai/tools/check-hooks.mjs          # every TG-HOOK present, nothing unlisted, new routes/session creators flagged
node tigerai/tools/check-public.mjs         # hygiene scan of what this fork added
node --experimental-strip-types --test tigerai/tests/path-guard.test.mjs
# dev-only fakes in tigerai/dev/: mock-v1.mjs (fake /v1 with scripted tool calls) and mock-n8n.mjs (fake webhook);
# n8n.test.mjs runs against them (see its header for the variables)
# contract tests need a running dev server with TIGERAI_ENABLED=1 and two seeded members:
E2E_BASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... MEMBER_A_EMAIL=... MEMBER_A_PASSWORD=... \
MEMBER_B_EMAIL=... MEMBER_B_PASSWORD=... TIGERAI_DATA_DIR=... PI_CODING_AGENT_DIR=... \
node tigerai/tools/seed-test-accounts.mjs && node --test tigerai/tests/contract.test.mjs
```

After pulling a new upstream version, follow `docs/DECISIONS.md` ("Syncing with upstream").
