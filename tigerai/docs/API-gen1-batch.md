# /api/tg/* — gen1 UI batch, backend contract (v1)

All routes: JSON, `Cache-Control: no-store`, cookie session. Error body: `{ error, code? }`.
401 not signed in, 403 forbidden, 404 not found OR not visible to the caller (existence is not revealed), 409 state conflict, 400 bad input.
Permission checks are on the server; the flags below are for what to SHOW, never what to trust.

## 11. 交辦單 (assignments) — `/api/tg/assignments`
Own table `assignments` (the approval `work_orders` table has a fixed pending/approved/rejected state machine
and a no-self-approval trigger; a task handed to someone is a different life cycle, so it is not forced into it).

Row: `{ id, title, description, applicantId, applicantName, assigneeId, assigneeName, dueDate (ms|null), sessionId|null,
status: "open"|"accepted"|"done"|"returned", returnReason|null, doneNote|null, createdAt, updatedAt, acceptedAt, finishedAt }`

| Method / path | Who | Body / query | Result |
|---|---|---|---|
| POST `/assignments` | any user | `{ title(≤120), description(≤4000), assigneeId, dueDate?(ms or "YYYY-MM-DD"), sessionId? }` | 201 `{ assignment }`. assignee must be an active user (self allowed). `sessionId` must be one the creator can open (else 403 `bad_session`) |
| GET `/assignments?scope=mine\|assigned\|all&status=` | mine/assigned: any; all: admin only (403 otherwise) | | `{ assignments: [...] }`. mine = I applied, assigned = given to me |
| GET `/assignments/count` | any | | `{ assigned: N, approvals: M, total: N+M }` — N = my assignments in open/accepted; M = pending approval work orders (admin only, else 0). Drives 「待我處理 N」 |
| GET `/assignments/:id` | applicant, assignee, admin (others 404) | | `{ assignment }` |
| POST `/assignments/:id/accept` | assignee only | | open → accepted |
| POST `/assignments/:id/complete` | assignee only | `{ note? }` | open/accepted → done |
| POST `/assignments/:id/return` | assignee only | `{ reason }` (required, ≤500; else 400 `reason_required`) | open/accepted → returned |

Wrong state → 409 `bad_state`. Every step is audited (`assignment.create/accept/complete/return`). Admin may read everything, but cannot act as assignee.

## 12. Room permissions — `/api/tg/rooms`
Room list row (GET `/rooms`) now also has: `isMember, closed, myRole, unread, mentioned`. Deleted rooms are not listed (for anyone).
`unread` is only counted for rooms you are a member of (an admin looking at a room they are not in sees 0). `system` messages do not count.

Roles (`myRole`, highest first): `admin` > `head` (head and member) / `head-viewer` (head, not a member: UI shows 「以主管身分檢視」) > `manager` (room creator) > `member`. A non-admin who is none of these gets 404.
- head = `memberships.is_manager = 1` in a group that ANY current room member belongs to. A head may READ such a room as a non-member; each such read is audited (`room.head_view`, at most once per head per room per hour). A head cannot post until they `POST /rooms/:id/join` (allowed for heads and admins; audited `room.join`). `canJoin` is true for admin and head when not a member and the room is open.

| Method / path | Who | Notes |
|---|---|---|
| POST `/rooms` | any user | creator becomes `manager` |
| POST `/rooms/:id/members` `{userId}`, DELETE `/rooms/:id/members/:uid` | manager or admin | refused while closed (409 `room_closed`) |
| POST `/rooms/:id/join` | admin or head (others 404/403) | adds self as member; refused if closed/deleted |
| POST `/rooms/:id/warn` `{text ≤500}` | head or admin | stores a message `kind:"warning"` (author = actor) in the room; works on a closed room |
| POST `/rooms/:id/close` / `/reopen` | head or admin | stores `kind:"system"` message 「頻道已由 X 關閉/重新開啟」 |
| DELETE `/rooms/:id` | admin only | soft delete: hidden from everyone; audit who/when |
| GET `/admin/rooms/deleted` | admin | `{ rooms: [{ id, name, deletedAt, deletedByName, daysLeft }] }`; also purges rows older than 30 days |
| POST `/admin/rooms/:id/restore` | admin | only within 30 days; else 404 |

Purge (30 days, lazy: runs on the deleted-list read, on room list read and on restore): removes the room, members, read cursors, assistant rows, messages and folder. Audit `room.purge`.
Closed room: `POST /rooms/:id/messages` → 409 `room_closed`; @AI / @role are not answered (also jobs already queued, and the n8n inbound key bound to it → 409).

## 7 + 13. Room read — `GET /rooms/:id?after=N&read=1`
Existing fields (`room, ai, dir, members, messages, you`) plus:
`isMember, canPost (member && !closed), canJoin (admin && !member && !closed), closed, deleted, myRole, can: { warn, close, reopen, delete, manageMembers }`
- `read=1`: if the caller is a member, the pointer moves to the newest returned seq (so messages arriving while viewing never raise unread). The pointer only moves forward.
- Message kinds: `human | ai | hook | warning | system`.
- Deleted room: admin only gets 200 with `deleted: true, canPost: false`; everybody else 404.

`POST /rooms/:id/read` `{ seq? }` — seq omitted/0 = up to the newest message. Members only (else no-op `{ok:true}`). Returns `{ ok, unread: 0 }`.

`GET /sessions/:id/info` — any signed-in user who may open the session (admin: any; else same rule as the gate): `{ roomOnly: boolean, roomId: string|null }`. `roomOnly` is true for a channel's backing conversation (frontend: disable input, show 「這段對話只能從頻道使用」). No upstream hook needed.

## 15. Model settings (admin only; members 403) — `/api/tg/admin/models`
Config lives in `<data>/models-settings.json` (mode 600) and the key in `<data>/v1-api-key` (mode 600). Env variables are initial defaults only: a saved value wins.

- `GET /admin/models` → `{ baseUrl, baseUrlSource: "settings"|"env"|"none", hasKey, keyLast4|null, offered: string[]|null (null = everything the gateway lists), defaultModel|null, overrides: { [id]: { contextWindow?, maxTokens? } }, defaults:{contextWindow,maxTokens}, configured, models, source, error? }` (the last five are the previous status fields, unchanged).
- `PUT /admin/models` — any subset of `{ baseUrl, apiKey (non-empty string = replace; null = remove), offered (array|null), defaultModel, overrides }`; validates, writes, re-provisions at once (no restart; applies from the next message/new session). Returns the same as GET. Invalid URL (must be http/https) → 400 `bad_url`. Override > gateway's own value → 400 `override_too_high`. defaultModel not offered → 400 `bad_default`. Audit `models.update` (never the key).
- `POST /admin/models/test` `{ baseUrl?, apiKey? }` (omitted = saved ones) → `{ ok, status?, models?: count, ms, error? }`. Always 200 (failure is in the body).
- `GET /admin/models/gateway` → `{ models: [{ id, contextWindow|null, maxTokens|null, offered }] }` straight from the gateway (the prefill for the override fields); 502 `gateway` when unreachable; **409 `not_configured` when no base URL is saved or set by env** (a state conflict, not a gateway failure; the contract now says so). Every error body carries `code`; the page maps `code` to Chinese text (`localizeError` in `tigerai/pages/i18n.ts`) and the server message stays English. `/admin/models/test` failures also carry `code` (`not_configured` or `gateway`).
- `POST /admin/models/refresh` unchanged.
- Members: the proxy gate no longer lets `set_model`, `set_thinking_level` (and `cycle_*`, `set_scoped_models`...) through, and `POST /api/agent/new` with `provider/modelId/thinkingLevel` from a member → 403 `model_locked`. Admin unaffected.

## Added at the frontend's request
- `GET /api/tg/me` also returns `isHead` (head of any group) and `canCreateRoom: true`.
- `GET /api/tg/n8n/apps` -> `{ apps: [{ id, kind: "webhook"|"mcp", name, description }] }`: enabled webhooks / MCP servers the caller's groups may use (admin: all enabled). No URL, no token. Starting a conversation with one is the client's job (a hint in the first message).
- Workspace folder names: `GET /api/sessions/ui-state` (existing hook H05) now fills `projectNames` for the person's folder (`<name> 的工作區`) and each group folder (`<group> 的工作區`); an admin gets everybody's. A name the user saved is kept.

## 17. Conversation from an AI role
`POST /api/agent/new` with header **`x-agent-role: <agentId>`** (not `x-tg-*`: the proxy strips every client `x-tg-*` header).
- no header: unchanged upstream behaviour.
- role unknown, disabled, or not offered to the caller (`GET /api/tg/agents` lists the offered ones): **403** `{ error }`, and no conversation is started (never a silent plain conversation).
- allowed: the conversation starts with the role's own model (`initialModel`) and prompt/skills/knowledge; it remembers the role (`session_roles`) across idle reloads; audit `role.session_start`.
- A member's own `provider/modelId/thinkingLevel` in the same body is still 403 `model_locked` (checked by the proxy before the route runs). An admin may send them; the role's model wins.
- Upstream hook: one new hook group in `app/api/agent/new/route.ts` (H06): `pendingRoleFor(req, tempKey)`, `if (tgRole instanceof Response) return tgRole`, `...tgRole` in the start options.

## v8. 公佈欄 — `/api/tg/announcements`, `/api/tg/bulletin`
`tzo` (query, minutes, `Date.getTimezoneOffset()`, default 0) says which calendar day is "today" for expiry and overdue.

Announcement row: `{ id, title, body (markdown), authorId, authorName, audienceAll, audience:[{id,name}], audienceLabel, pinned, expiresAt (noon-UTC day|null), expired, requireAck, createdAt, updatedAt, read, acked, mine, canEdit, edited, stats? }`. `stats` (`{ total, read, acked, notRead:[names], notAcked:[names] }`) only for the poster and admin; the poster is not counted in `total`.

| Method / path | Who | Body / result |
|---|---|---|
| GET `/announcements?view=active\|expired` | any (sees what is meant for them; admin sees all) | `{ announcements }` — active: pinned first, then newest; expired: the 已過期 view |
| POST `/announcements` | admin: `audience:"all"` or group ids; head: only group ids they head (else 403 `audience_forbidden`); member 403 `forbidden` | `{ title(≤120), body(≤8000), audience, pinned?, requireAck?, expiresAt? ("YYYY-MM-DD") }` → 201 `{ announcement, history }` |
| POST `/announcements/draft` | head or admin | `{ topic, audience? }` → `{ title, body }`; calls the gateway with tigerai-fast; stores nothing. 409 `not_configured`, 502 `gateway` / `empty_draft` |
| GET `/announcements/:id` | audience, poster, admin (others 404) | `{ announcement, history }` (history only for poster/admin: `[{ id, editorName, ts, oldTitle, oldBody }]`) |
| PATCH `/announcements/:id` | poster or admin | any of title, body, audience (re-checked), pinned, requireAck, expiresAt; the old text goes to history |
| DELETE `/announcements/:id` | poster or admin | soft delete |
| POST `/announcements/:id/read` | audience | marks read |
| POST `/announcements/:id/ack` | audience | 我已了解; 409 `no_ack` when the announcement does not ask for it |
| GET `/bulletin/summary` | any | `{ count, overdue, parts:{assignments,acks,approvals}, urgent:[2 items], unread:{count, latest:[2]}, canPost }` — drives the bell and the home screen |
| GET `/bulletin/personal` | any | `{ items }` sorted by due: `assignment` (+ `assignment` row), `ack` (+ `announcement`), `approval` (admin; `approval:{name,body,applicantName}`). Actions use the existing `/assignments/:id/*`, `/announcements/:id/ack` and `/admin/workorders/:id/decide` |
| GET `/bulletin/scope` | any | `{ all, groups }` — where this person may post (admin: all + every group; head: their groups) |

Audit: `announcement.publish`, `.edit`, `.delete`, `.ack`, `.ai_draft`.

## v9. 精靈, assignment source, creator close
Everything under `/api/tg`; all need a signed-in account.

**精靈 (personal agent menu).** An entry is `{ id, name, description, kind: "company"|"mine"|"shared", ownerName, shared?, inMenu }`. `p…` ids are personal agents.

| Method / path | Result |
|---|---|
| GET `/agents` | unchanged: company roles the caller may `@` (used by rooms) |
| GET `/agents/menu` | `{ menu }` in the caller's own order. First call seeds it with the company roles the caller may call |
| POST `/agents/menu` `{ agentId }` | add (404 if the caller cannot see it) → `{ menu }` |
| PUT `/agents/menu` `{ ids:[…] }` | new order; unknown ids ignored, unlisted entries keep their place after the listed ones |
| DELETE `/agents/menu/:id` | remove from my menu (does not delete the agent) |
| GET `/agents/browse` | `{ agents }` everything the caller could add: company roles they may call, their own, colleagues' shared ones |
| POST `/agents/mine` `{ name(≤40), description?, system_prompt(≤8000), shared? }` | 201 `{ agent }`, already in the menu. 409 `exists` (same name of mine), 409 `limit` (50) |
| GET / PATCH / DELETE `/agents/mine/:id` | owner only (403 `forbidden` for anyone else even if shared, 404 if invisible). DELETE disables it and removes it from every menu |
| POST `/agents/:id/copy` `{ name? }` | 201 `{ agent }`: independent copy (name, description, prompt only) in my menu |

Starting a conversation: `POST /api/agent/new` with `x-agent-role: <id>` as before; a personal id works for the owner and, when shared, for anyone (`startable`). A private agent of someone else is 403 like any unavailable role. Personal agents are never `@`-able in a room.
Audit: `agent.menu_add`, `agent.menu_remove`, `agent.personal_create`, `agent.personal_update`, `agent.personal_delete`, `agent.copy`.

**Assignment source.** Rows gain `source: "person"|"ai"|"n8n"`. `GET /assignments?scope=mine|assigned|all[&source=person|ai|n8n]`, new `scope=ai` (I am the assignee or the owner of the flow, source `ai`/`n8n`; ignores `source`). Bad value → 400 `bad_source`. `POST /assignments` cannot set the source (always `person`).

**Inbound hook, hand over a task.** `POST /api/tigerai/hooks/agent` (Bearer key) with `{ "assignment": { "title", "description"?, "assigneeId" | "assigneeEmail", "dueDate"? } }` → 201 `{ ok, assignmentId, source }`. `source` is `ai` when the key has an AI role, else `n8n`. Applicant = the key's owner (must be active, else 403). Same validation as the page (400 `bad_title` / `bad_assignee` / `bad_due`). Audit `assignment.create` with `source`, plus `hook.request` outcome `assignment`.

**Installed skills (read-only).** GET `/skills` → `{ skills:[{ name, description }] }` for the caller's own workspace (cached 60 s). No paths. Installing and toggling stay administrator-only upstream routes.

**Rooms.** `POST /rooms/:id/close` and `/reopen` now also accept the room's creator (`rooms.owner_id`); everyone else who is not an administrator or head: 403. `accessFlags().can.close/reopen` reflect it. `DELETE /rooms/:id` is unchanged (admin). Audit extra `byCreator`.

## v11. 交辦給 AI, notification
Everything under `/api/tg`.

| Method / path | Result |
|---|---|
| POST `/assignments` `{ title, description?, dueDate?, assigneeKind: "ai", agentId? }` | 201 `{ assignment }` and the background run starts. `agentId` absent / `"general"` = 一般 AI; otherwise a role the caller may start, else 403 `bad_agent`. `assigneeKind` other than user/ai: 400 `bad_assignee` |
| GET `/assignments?scope=mine\|assigned\|all[&kind=user\|ai][&source=…]` | `kind` filters on who it was handed to (400 `bad_kind`). `scope=assigned` never contains my own AI orders. `scope=ai` is unchanged and unused by the modal |
| POST `/assignments/:id/complete` | on an AI order: the applicant confirms (only from 待確認; 409 while the AI works) |
| POST `/assignments/:id/return` `{ reason }` | on an AI order: reason required; goes to the AI as a follow-up in the same conversation, order back to 進行中 |
| GET `/assignments/count` | adds `aiReview` (AI orders waiting for me) |
| GET `/bulletin/summary` | adds `aiReview: [{ id, title, note }]` (max 5) and `aiRunning` |
| POST `/push/subscribe` `{ subscription }` | stores the browser push subscription for the signed-in person only; 400 on a non-https endpoint or missing keys |

Row fields added: `assigneeKind` (`user`\|`ai`), `agentId`, `agentName`, `runState` (`running`\|`review`\|null), `runStartedAt`, `aiResult`, `aiNote`, `runCount`. An AI order has `status: "accepted"` while `runState` is set; `done` after the applicant's 完成.
Notes (`aiNote`): `執行失敗:<reason>`, `AI 沒有產生內容`, `伺服器重新啟動,工作中斷`.
Env: `TIGERAI_AI_RUN_CONCURRENCY` (default 2). There is no run time limit.
Audit: `assignment.ai_start`, `assignment.ai_finish` (outcome ok/error/interrupted), `assignment.ai_notify`, `push.subscribe`, plus the existing `create` / `complete` / `return`.

## CE-model. Model connections (admin only; members 403) — `/api/tg/admin/models/connections`
A list in the order of use; the first enabled one is the primary. Settings in `<data>/models-settings.json` (`connections`), keys in `<data>/v1-api-key` (connection `tigerai`) and `<data>/v1-key-<id>`, all mode 600. Old single settings and `TIGERAI_V1_*` read as connection `tigerai` until the first write. Keys never come back (only `hasKey`, `keyLast4`).

| Method / path | Result |
|---|---|
| GET `/connections` | `{ connections: [{ id, name, baseUrl, enabled, hasKey, keyLast4, offered|null, defaultModel|null, overrides, status: { ok, models, error? }|null }], migrated, defaults }` (`status` is null for a disabled one) |
| POST `/connections` `{ name, baseUrl, apiKey?, enabled?, offered?, defaultModel?, overrides? }` | 201, same body as GET plus the legacy fields. 400 `bad_name`, `bad_url`; 409 `too_many` (8) |
| PATCH `/connections/:id` | any subset of the same fields (`apiKey: null` removes the key). 404 `not_found`, 400 `bad_enabled` / `bad_default` / `override_too_high` |
| DELETE `/connections/:id` | removes it and its key file; models.json is rewritten |
| POST `/connections/reorder` `{ ids: [...] }` | must name every connection once, else 400 `bad_order` |
| GET `/connections/:id/gateway` | that connection's own model list (as `/admin/models/gateway`) |
| POST `/admin/models/test` `{ id?, baseUrl?, apiKey? }` | `id` tests that connection with its saved key unless a key is given |
| PUT `/admin/models` (legacy) | edits connection #1 (the first in the list; creates it when none) |

Member-visible: GET `/api/tg/sessions/:id/fallback` → `{ note: { text, kind } | null }` (visibility as opening the conversation).
Audit: `model.connection.add|update|delete|reorder` (`connection`, `name`, `changed` / `order`), `model.fallback` (`sessionId`, `kind` fallback|skip-unhealthy|none, `reason`, `fromConnection`, `toConnection`, `model`). Conversation entry: custom `tigerai:model-fallback` `{ kind, from, to, reason, detail?, preferred, at }`.
Env: `TIGERAI_FALLBACK_COOLDOWN_SECONDS` (default 600).
POST `/api/push/subscribe` (upstream path) is answered by the gate and stored per person; the "conversation complete" push goes to the owner only.

## 系統連接 (connectors, CE 3c)
- `GET /api/tg/connectors` (everyone): connectors this person may use, `{ connectors: [{ id, template, templateLabel, name, description }] }`. No URL, key or tool list.
- Administrators only, under `/api/tg/admin/connectors`:
  - `GET` → `{ servers: [{ id, name, template, description, url (masked), group_ids, enabled, allow_tools, hasToken, tokenLast4, tools, testedAt }], templates }`
  - `POST { template, name, description?, url, token?, group_ids?, allow_tools? }` → 201 `{ id }`; `allow_tools` omitted = the template's read-only list (custom = none).
  - `PATCH /:id` (any of name, description, url, token, group_ids, enabled, allow_tools); `DELETE /:id`.
  - `POST /test { url?, token? }` or `POST /:id/test { url?, token? }` → 200 `{ ok: true, tools: [{ name, description, readOnly }], ms, server }` or `{ ok: false, code: unreachable|unauthorized|timeout|bad_response|bad_url, error }`. With an id, the tool list is stored.
- The old `/api/tg/admin/n8n/mcp[/:id]` routes call the same functions.
- Audit: `mcp.connection.add|update|delete|test`, `mcp.tool_call` (`connector`, `template`, `tool`, `outcome` ok|error|denied).
