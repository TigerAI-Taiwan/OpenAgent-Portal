# Design decisions, trade-offs and known gaps

## Why a buffer layer (`tigerai/adapter`)
Upstream moves fast and its hot files (`lib/rpc-manager.ts`, `proxy.ts`) are exactly where multi-user has to attach.
Every call site is one or two lines, always `import * as tgAdapter from "@/tigerai/adapter"`, tagged `TG-HOOK:Hxx`
and listed in `adapter/hooks.json`. When `TIGERAI_ENABLED` is not `1` every function passes through. When it is `1`
every internal failure fails closed (503, 403, empty list, read-only tools), never "everyone sees everything".
A browser bundle must not import the adapter (it pulls in `node:sqlite`): the sidebar uses `adapter/client`.

## Hooks (12 ids)
H01 start-up init, H02 proxy gate, H03 session list, H04 search, H05 ids (stats, ui-state, running), H06 new conversation
(cwd check and owner registration), H07 fork, H08 tools and extensions at session start, H09 file reads, H10 cwd validate/browse,
H11 sidebar nav, H12 the two new route files. `node tigerai/tools/check-hooks.mjs` verifies them.

## Decisions and why not the other way
| Decision | Why not the alternative |
|---|---|
| Identity only from a signed cookie, re-checked against the database on every request, `x-tg-*` stripped in the proxy | trusting a header from outside; a cookie that outlives a disabled account (token_version fixes this) |
| Admin-only by default for upstream paths; members get an allow-list | a deny-list silently opens every route upstream adds later |
| Command allow-list for members read from the request body in the proxy (no `bash`, `set_tools`, `fork`, `clone`) | fork/clone would create conversations nobody owns; `bash` is a shell |
| Tool exclusion by SDK `excludeTools` plus a path guard extension | pi's `read`/`grep`/`find`/`ls` read any path the server can; excluding shell tools alone left the whole host readable |
| Room conversations are always read-only and belong to the room (removing someone removes their access even if they started it) | a shared conversation run with an administrator's tools would let any member steer it |
| One conversation per (room, AI role), shared by the room | one agent wearing several hats does not know who it is; one per person makes three people talk to "different" assistants that look the same (this is how the original Portal does it) |
| Prompt delivery through pi's own `resources_discover` | a new call site in the commands route; pi already lists the session's templates in the `/` menu |
| Storage behind `db/driver.ts`, SQLite only | PostgreSQL is the enterprise edition; no PostgreSQL code is here |
| Work orders are their own module with a trigger that forbids approver = applicant | checking it only in code |

## Where this differs from the original Portal (the earlier internal Portal)
| Topic | Original | Here |
|---|---|---|
| Prompt visibility | administrator ticks groups | founder rule: administrators publish, department heads tick, sharing by work order |
| `@AI` | the person's own AI conversation per room with a fed cursor of what it has not seen | the room's shared read-only conversation, last 8 messages as context each time |
| Roles | AgentPreset with skills content injection, `skillScope`, `businessRole`, variables, examples, knowledge directory | name, prompt, model, knowledge folder (readable), skills listed by name only, tool ceiling stored |
| Permissions | capabilities + shell levels + sandbox | two roles; members read-only |

## n8n (community scope) and models
| Decision | Why |
|---|---|
| n8n MCP tools are exposed through pi's own `registerMcpServer` from our extension, with `exposure: hidden` plus `direct` for the allowed tools only | an n8n access token can write workflows and cannot be narrowed on n8n's side, so the per-server whitelist is the only fence; it defaults to search/details/execute and is re-checked at call time |
| "Which groups" empty = nobody but administrators, for MCP and webhooks | prompts default open; an n8n instance is full power, so closed is the safe default |
| Webhook secret header and MCP token live in mode-600 files, never in the database or any response | listing pages must not leak what an n8n URL path or header carries |
| Inbound key: one per caller, SHA-256 hashed, plaintext shown once; Idempotency-Key replay; 30 requests per minute per key; one request at a time through the same queue as room AI | a retry from n8n must not ask the model twice; the gateway machines have a single slot |
| Models: one /v1 endpoint, key by environment reference in models.json; sign-in routes closed to everyone, enforced in the proxy gate | hiding buttons does not stop a curl; subscription-type logins are not offered |
| Room (channel AI) sessions refuse every non-read command sent over HTTP, 403 `room-session`, hook H13 in `POST /api/agent/[id]` | the sidebar hides them but a pasted URL opened them; typing there skips the channel's checks and speaker identity and pollutes the assistant's memory. The channel itself calls the wrapper in-process, so it never meets the route. Gate is in the route, not the proxy, because the command is in the body and the proxy already lets room members through by membership |

## Known gaps (open)
13. The page of a room session still opens and its composer looks usable; the send is refused with the message "這段對話只能從頻道使用" (no disabled-input state yet: it needs a server flag on the session read, i.e. more upstream edits).
0. n8n: MCP server tools are only as good as pi's MCP client; the n8n API path (not MCP, not webhook) is enterprise scope and absent. Inbound keys are not scoped per room beyond the one optional room.
1. `/api/agent/<id>` commands in the body are filtered by an allow-list; a new upstream command type is refused for members until added.
2. Pins/archive (`ui-state`) are one global file: ids are filtered but members share the state.
3. Subagent conversations and anything created by a new upstream route have no owner: administrators only.
4. Admin who @AI in a room is served read-only like everyone (the conversation is shared); the founder's wording was "follows the admin settings".
5. AI role skills are listed by name only (content is not injected); a role's tool list is stored but the read-only ceiling of the room applies.
6. Prompt `{{variables}}` and Open WebUI import/export are not implemented; templates use pi's `$ARGUMENTS`.
7. A group has no head until an administrator marks one; until then only administrators tick for it.
8. The UI still shows Models/Skills/Settings to members; their calls return 403.
9. Unread polling is 15 s (3 s while the AI works); no push.
10. Members who start conversations in a *group* folder get restricted tools; administrators working inside `users/`, `groups/` or `rooms/` folders are restricted too.
11. The login throttle is global (one failing guesser delays everyone for up to 60 s).
12. Licence, DCO/CLA and trademark texts are drafts pending legal review.

## Syncing with upstream
1. `git fetch upstream`; branch `sync/upstream-YYYYMMDD`; merge. Conflicts can only be in files listed in `hooks.json`.
2. `node tigerai/tools/check-hooks.mjs` must be green (it also lists session creators and routes that need a decision).
3. `tsc --noEmit`, `npm run lint`, `npm test`, then the contract tests.
4. Review by hand: `proxy.ts`, `lib/rpc-manager.ts`, `lib/file-access.ts`, `lib/path-security.ts`.

## gen1 UI batch, backend (assignments / room moderation / model settings)
- **Assignments have their own table.** The approval `work_orders` table is pending/approved/rejected with a "decided is final" and a "approver is not applicant" trigger; a task handed to a colleague (open/accepted/done/returned, the assignee acts) shares neither. Forcing it in would have meant weakening those triggers. Cost: two lists; `GET /assignments/count` adds both for 待我處理.
- **A head may read a room they are not in** (head of a group any room member belongs to): needed to judge a warning; mitigated by an audit entry (once per head/room/hour) and the `head-viewer` banner. They cannot post unless they join. Open question: a head of a *large* group sees every room of every member; if that is too wide, narrow it to rooms a member of the head's group created.
- **Purge needs to defeat an append-only trigger.** `room_messages` has no-delete/no-update triggers; the 30-day purge drops `rm_no_delete` inside its own transaction and recreates it before commit (test asserts it is back). Lazy: runs when rooms are read, so a quiet server purges on the next read, not on the 30th day exactly.
- **Model settings are two files, not the database**: `models-settings.json` + `v1-api-key` (mode 600), because provisioning also runs at start-up before anything else, and the key must stay out of the audit log and the DB. Env vars are only the initial values. Applies to the next message through `models.json` + cache invalidation; an already running conversation keeps its loaded model registry until it reloads (not verified against a live pi session in unit tests; check on the demo).
- **Members cannot change models** (gate): `set_model`, `set_thinking_level` left the member allow-list and any model field in a member's request is 403. The test cross-checks every `case "…model…|…thinking…"` in `lib/rpc-manager.ts` against the deny list, so a new upstream command with those words fails the test instead of slipping through.
- **Header name**: roles are chosen with `x-agent-role`, not `x-tg-role`, because the proxy strips every client `x-tg-*` header (identity can only come from the gate).

## gen1-v7
- **Channel AI acts as the person who spoke.** A room assistant session belongs to the room and has no identity of its own (`identityForSession` returns null for it, on purpose: it must not borrow the creator's templates or n8n access). v7 adds `rooms/speaker.ts`: while one room job runs, its requester is registered for that job's session (`setRoomSpeaker` before the prompt, `clearRoomSpeaker` in `finally`); the n8n extension reads `roomSpeaker(sid) ?? identityForSession(...)` in `before_agent_start` (webhook list, MCP sync) and on every `n8n_webhook` / MCP tool call. So tools are re-evaluated per message from the speaker's group membership: never the union of the room, never the creator. Why this is safe: the process runs one room AI job at a time (`enqueueTask`), the entry is removed in `finally` (a timed-out run that keeps going is blocked, since nobody is registered), and with nobody registered the session has no n8n access. Known limit: the conversation memory of a room session is shared, so what one speaker's webhook returned stays in that assistant's history for later speakers; the answer is posted to the whole room anyway. `identityForSession` is deliberately unchanged, so personal prompt templates still never reach a room session.
- **Webhook display name** is a column (`display_name`), the lowercase id stays the key the model passes. The model sees `id (顯示名稱): description` and may pass either; only webhooks the speaker may use are searched, and audit records the id.
- **Forced password change loop**: the gate sends every page to `/tg/account`, and that page used to redirect to `/?settings=account`, which the gate sent back. `/tg/account` now renders the change form itself when `mustChangePassword`; the app (and its settings overlay) is never loaded for such a person.
- **Open**: confirmations are in the pages we own; upstream's own destructive buttons (delete a conversation etc.) keep upstream's behaviour. The role and prompt-tick checkboxes are still not optimistic (only the n8n ones are).

## gen1-v8 (公佈欄 + 提醒泡泡)
- **Posting is a server rule, in the service.** `createAnnouncement` / `updateAnnouncement` check: admin = anything; a head (`memberships.is_manager`) = only groups they head, never 全公司; everyone else 403. Editing re-checks the audience, so a head cannot widen an old announcement. The page hides the button for members, but nothing depends on it (tests call the service as member / head / admin).
- **The bubble counts what must be acted on, not what is new.** Three things: assignments to me in open/accepted, 需要確認 announcements addressed to me and not yet confirmed, pending approvals (admin; never one's own). Plain announcements, room chatter and expired 需要確認 do not count. Red = an assignment is past its due day. An admin can read every announcement but is only asked to confirm those addressed to them (`isRecipient`), otherwise the count would be noise.
- **"Today" is the caller's day.** Due and expiry days are stored as noon UTC of the calendar day (same rule as assignments); the browser sends `tzo` (Date.getTimezoneOffset) and the server compares calendar days. Without `tzo` it uses UTC. An announcement is expired the day after its expiry date.
- **Read vs confirm.** Opening the detail marks it read (`announcement_reads.read_at`); 「我已了解」 sets `acked_at`. The poster / admin sees N/M and the names of who has not read / confirmed; a reader never sees others. The poster is not counted in M. Open: editing the body does not reset confirmations (a material change may deserve a new confirmation; left to the poster to post a new one).
- **History and delete.** Every edit appends (who, when, old title, old body, old audience/pin/expiry) to `announcement_edits`, an append-only table (triggers). Delete sets `deleted_at/by`; a trigger refuses a real DELETE. Nothing restores a deleted announcement yet (open: no admin view for it).
- **AI draft only drafts.** `POST /announcements/draft` calls `<base>/chat/completions` server side with `tigerai-fast` (env `TIGERAI_BULLETIN_MODEL` overrides), returns `{title, body}` and stores nothing; only the human's 發布 click creates a row. Any head/admin may call it; each call is audited (`announcement.ai_draft`).
- **No new left-list entry, no new upstream hook.** The bell joins the existing `toolbar.right` slot (H21) next to sign-out; the home summary sits in the existing `brand.version` slot (H14). The 交辦單 settings tab is gone (old `?settings=assignments` opens the 公佈欄); `+` 新交辦單 stays, and 新公告 is in `+` for heads/admins and in the 公用區 tab.
- **Polling.** One reference-counted poller (15 s while the tab is visible, plus on `visibilitychange` and after every action) feeds the bell, the modal tabs and the home summary through `GET /bulletin/summary`.
- **Not in v1:** comments, push, n8n posting, pinned-limit, per-user mute.

## gen1-v9 (bottom row, one settings window, 精靈)
- **Contact popup, no version.** The brand button used to scramble into version numbers (an easter egg of upstream's). Members have no use for them and they leak the build, so a click now opens a small popup listing `CONTACT` from `layout.ts`. For now it holds the product name and the e-mail address the owner allowed to be public; 其餘聯絡方式待 Founder 提供 (phone, address, site). The public-repo scan (`check-public`) allows exactly that one address, no domain pattern. The version stays in 設定 › 帳號 › 關於 for administrators only. The brand button keeps upstream's CSS class so the sidebar's fit logic and look are unchanged.
- **One settings window.** 技能 used to call `openUpstream("skills")`, which opened upstream's `SettingsPanel`: a second window with a different look in which 技能 "turned into settings". Upstream already exports each section as an embeddable component, so the four we need (技能 install, 子代理, 外掛, MCP) are imported into our modal (no upstream edit). Upstream's 模型 and 一般 sections are not offered: models are ours (gateway, locked), 一般 holds options that only make sense for the original product. Rejected: re-implementing the four screens (large, and they follow upstream changes for free now).
- **What goes where.** Founder's rule: 技能 = what the AI does for work (use and curate), 設定 = environment and parameters. So 我的提示詞, AI 角色, n8n 應用, installed skills, install, subagents, role and prompt libraries are in 技能; connections (model, n8n), MCP, plugins, people, audit and deleted rooms are in 設定 › 管理. 外掛 and MCP are infrastructure, hence 設定; skills are what the person calls, hence 技能.
- **精靈 is a personal menu, stored on the server.** Why not the company list: 功能 used to show every role an administrator made. Founder defined it as "my own menu": things I built, things I picked from others. So a menu row is `(user, agent, position)`; the order is the row's position, per person, in the database (not `localStorage`: it must follow the person to another browser).
  - *Use theirs* (加入我的功能表) stores a pointer, so the owner's later edits reach everyone who picked it; *copy* (複製成我的) stores an independent row with name, description and prompt only. A copy of a company role never carries its tools, skills, model or knowledge folder: a member's agent is a prompt, nothing more, and the member's own capabilities still apply.
  - My own agents live in their own table (`personal_agents`), not in `agents`: `agents.name` is globally unique (it is the `@name` in a room), personal names are unique per owner only, and personal agents must never be @-able in a room. `getAgent()` falls back to that table so the runtime reads their prompt through the same path as a company role; `startable()` is the single check for "may this person start a conversation from this id".
  - Sharing is a flag the owner sets; unsharing or deleting removes it from everyone's menu on their next read. Delete is a disable, like company roles: conversations already started keep their prompt.
  - First read seeds the menu with the company roles the person may call, so nobody lost anything on upgrade. Roles created later are not forced in (it is their menu).
  - Only the owner edits or deletes (403 for anyone else, administrators included: an administrator manages company roles in 技能 › AI 角色上架, not a member's private prompt).
- **Considered and left out: admin-pinned roles in everyone's menu.** Would bring back the "fixed company list". Left for when someone asks.
- **交辦 is a progress record; 公佈欄 stays the wider view.** Three disjoint tabs (the modal asks `source=person` for the first two). `assignments.source` is `person | ai | n8n` (migration: default `person`). It can only be set by server code: the HTTP body of `POST /assignments` has no way to say it, and a test greps the router for that. The AI tab lists orders where I am the assignee or the flow owner and the source is not `person`.
- **Inbound hook can hand a task over (new).** There was no path at all through which a flow or an AI could create an assignment, so the AI tab would have stayed empty forever. `POST /api/tigerai/hooks/agent` now also accepts `{ "assignment": { title, description?, assigneeId | assigneeEmail, dueDate? } }` (no `message`): it is recorded as made by the key's owner, source `n8n`, or `ai` when the key carries an AI role; no model call. The key already stands for that owner, so no new authority is created; the assignee is a person, never the flow.
- **Creator may close, not delete.** `closeRoom`/`reopenRoom` accept a moderator (admin, head) or `rooms.owner_id`. Delete stays admin-only. Audit `byCreator` tells the two apart. Known: a creator who left the room can no longer see it (404), so cannot reopen it; an administrator can.
- **Rooms fold per browser, not per account.** Fold state is a convenience (`localStorage`, wrapped in try/catch); a different browser starts unfolded.
- **Why the conversation icon is CSS.** Rows are upstream's; a `::before` mask in our stylesheet gives them an icon without a new hook. If upstream ever changes `.session-tree-main`'s content order the icon would just stop showing; nothing breaks.
- **Model limits (item 8): the old default was wrong, not conservative.** `provisionV1` wrote 32768 / 4096 for every model unless the admin typed an override, while the settings table showed the gateway's own value (e.g. 130048) only as a grey placeholder. So the page said 128K, the runtime used 32K (toolbar "31% / 33k") and replies were cut at 4096. The comment in `v1.ts` justified it with "a gateway's context fields are not reliable"; in practice the gateway (llama.cpp manager) reports them correctly. Now effective = override ?? gateway-reported ?? default (`effectiveLimits`, `settings.ts`); the default output is 16384 (`TIGERAI_V1_MAX_TOKENS` overrides it), never above half the context window. The table shows the effective numbers as real values and stores an override only for a value that differs; 還原 clears a row. Applies on the next message, as before. Known: when the gateway is unreachable and the previous model list is kept, limits fall back to defaults/overrides until the next successful refresh.
- **Reasoning showed "off" and could not be changed (item 9).** The gen1 provisioning wrote models without `reasoning: true` (it only set `supportsReasoningEffort: false`), so pi treated every model as a non-thinking one: the composer's selector read "off" and offered nothing, while the Qwen models behind the gateway kept thinking by themselves (reply footers showed R tokens). The old Portal's `models.json` had `reasoning: true` on every model; the field was simply not carried over. Now each model is `reasoning: true` and the provider compat has `thinkingFormat: "qwen-chat-template"` (pi sends `chat_template_kwargs.enable_thinking`); `TIGERAI_V1_THINKING_FORMAT` can switch it (e.g. `chat-template`) without a code change. New conversations default to `medium` (`defaultThinkingLevel` in settings.json, only written when no level is set). Members still cannot change the level (the server rule is untouched); the administrator keeps the selector.

## Batch v10 (2026-11-15)
- **Truncated replies were an output-budget problem, not a model problem.** Demo sessions ended with `stopReason: "length"` at exactly 16384 output tokens, mostly thinking (one had 35k characters of thinking and no text). The Qwen models use `thinkingFormat: "qwen-chat-template"`, which is only `enable_thinking` on/off, so the low/medium/high levels change nothing. Fix: default 32768 (half the context at most), plus a one-click 「繼續」 so a person is never stuck; the explanation tells members to ask an administrator and administrators to raise 最大輸出 or switch thinking off.
- **Why 「繼續」 is a message and not a hidden retry.** It goes through the same send path as typing (permissions, run ids, SSE), so it is audited like any message and the model sees what the person sees. A hidden re-run would bypass all three. Cost: one extra user turn in the transcript.
- **Why two slots (`chat.truncation` + `chat.sender`) and not a prop.** `MessageView` has no send function and passing one down would touch several upstream signatures. `chat.sender` is a render-nothing slot beside the composer that registers `handleSend` per session id; `chat.truncation` reads it. Two small hooks instead of a prop chain.
- **Images: pi treats a model with no `input` as text-only and strips the picture before the request.** The gateway reports `input: null` for most models, yet five of them (qwen3.8-27b, qwen3.8-flash x2, glm-5.3-flash, Muse-Glimmer-30B) answered a 32x32 red PNG with "Red". So null now means `["text","image"]`; a gateway array is trusted; the admin's switch wins. Risk: a really text-only model that reports nothing will fail on a picture until the admin switches it off (open item).
- **Upstream bug fixed with a hook (H29).** `onClick={onCompact}` hands the click event to `handleCompact(customInstructions)`, which JSON-serialises it: "Converting circular structure to JSON". Worth reporting upstream.
- **Logo text removed, name kept where it matters.** The name stays as aria-label/tooltip of the sidebar icon, in the browser tab and on the login page.

## Batch v11 (2026-11-15): 交辦 two tabs, 交辦給 AI, notification
- **AI orders keep the old `status` column.** The CHECK (`open/accepted/done/returned`) cannot be altered in SQLite without rebuilding the table, and `done` and `returned` are final by trigger. An AI order is `accepted` while it works and while it waits; `run_state` (`running` | `review`) says which, and `done` is only ever written by the applicant's 完成. 退回 on an AI order is not the final `returned`: it sends the reason to the AI as a follow-up in the same conversation and goes back to 進行中, so the final state stays reachable only through 完成. Rejected: a second status vocabulary (every list, the bell and the triggers would learn it).
- **The assignee of an AI order is `ai:<role id | general>`, not the applicant.** It keeps 交辦我 (`assignee_id = me`) free of my own AI orders without a special case, and `step()` (accept/complete/return by the assignee) can never match it. A person's own functions refuse an AI order; the router sends complete / return on an AI order to `confirmAiAssignment` / `returnAiAssignment`, which need the applicant (admin may read only).
- **The AI cannot complete anything.** No code path of the run sets `done`; the run only moves `running` to `review` (`finish`). The role extension adds no tool that touches assignments, and a flow or key cannot create an AI order at all (the inbound hook strips `assigneeKind`/`agentId`, `createAssignment` refuses it for any source but `person`).
- **Never wider than the applicant.** The background run is an ordinary conversation of the applicant (their personal folder; owner registered as the applicant), started the way `POST /api/agent/new` does it: pending role, role model, `session_roles` row. The adapter then applies the same tool exclusion and file fence as for any member in that folder, and n8n access is the applicant's. Roles are checked with `startable()` (the 精靈 menu's own rule) at create time. An administrator's run is read-only too (personal folder is restricted for everyone): conservative on purpose.
- **No time limit, no manual stop (Founder).** The first spec had a 2-hour limit and a 停止 button; both were removed. Nothing hangs silently: a model error, an empty answer or an exception ends in 待確認 with a note (`執行失敗:…`), and a server restart hands every order that was 進行中 back as 待確認 with 「伺服器重新啟動,工作中斷」 (swept once per process from `init()`; never restarted automatically). The idle reaper does not touch a running prompt (`resetIdleTimer` re-arms while `isRunning()`), so `PI_WEB_IDLE_TIMEOUT_MS` needs no change. The person can still press stop inside the conversation itself; that ends the prompt and the order goes to 待確認 with the text so far.
- **Concurrency.** At most 2 background runs at once (`TIGERAI_AI_RUN_CONCURRENCY`), outside the room-AI queue on purpose: a multi-hour research run in that queue would block every channel. Later runs wait in 進行中.
- **Notification, three layers.** Toast (page open), push (page closed), home list at next login. Each transition into 待確認 notifies once, only the applicant: `finish()` updates the row with a `WHERE run_state='running'` guard and notifies only when it changed a row; the audit entry `assignment.ai_notify` records it. Payload = title and link, never the result.
- **Why our own push table.** Upstream's `/api/push/subscribe` stores subscriptions with no owner and `notifySessionComplete` sends to all of them, i.e. in a multi-person portal every device is told about every conversation. We reuse upstream's VAPID keys, `web-push` and the service worker, but keep subscriptions per person (`push_subs`) and send only to the applicant's. **Open (existing upstream behaviour, not changed here):** `AppShell` still calls upstream's subscribe once notification permission is granted, so a granted browser also joins upstream's un-owned pool and receives "session complete" for all sessions. Needs a decision (hook that disables it, or filter in a hook).
- **Push degrades silently.** Needs HTTPS or localhost, a service worker (production build only), a VAPID key and the person's permission. Without any of them nothing is shown and the toast, bell and home list remain. Permission is asked on the 建立 click of the first AI order, never on page load.
- **Open:** the AI's result is stored on the order (200 000 characters max); the full process is in the linked conversation. A person who deletes that conversation keeps the stored result.
- **`#` for prompts (ported from the old Portal).** 「`/` 會做事、`@` 指人或檔案、`#` 寫字」: a slash command acts (model, compact, skills), a prompt only pastes text, so they must not look alike in one list; `@` is taken (people and AI roles in rooms, files upstream); `#` is free and familiar from Open WebUI. A `#` opens the popup only after whitespace or at the start and only while something matches, so `C#`, `issue#42` and `#3` stay plain text. The popup lists exactly what the "/" menu lists (server rule), never anything else. Rendering has one function (`prompts/pick.ts`) for preview, insert and tests; an unknown `{{variable}}` stays visible instead of becoming a plausible sentence. Prompts in this portal have no variable declarations (the old Portal had), so variables are read from the text and every asked one is required; `{{name | default}}` is our small extension for an optional value.
- **Why a wrapper and not a ChatInput change.** It rides the existing `composer.state` slot and the room composer (our file). The one trick is writing into a React-controlled textarea through the native setter and an `input` event; if upstream ever moves to a non-textarea editor this stops working (the popup simply never opens).
- **v11 added no hook.** Everything is in `tigerai/` plus the existing slots; the only files outside it that changed are docs.
- **Terminal closed for all roles (v11b, Founder).** A terminal is a shell on the server: it bypasses every member permission (tool exclusion, file fence, sandbox) and the old fork removed `app/api/terminal/**` for the same reason. Here the route stays (no upstream edit) and the gate answers 403 for everyone, administrators included, so it cannot be reached by a pasted URL or a script. The button is hidden by CSS only for looks. Open: terminal tabs saved in an old browser `sessionStorage` come back as dead tabs until closed. Re-enabling later = delete `terminalClosed()` in the gate and the CSS rule; do not add it back for members.

## 社群版:四支內建精靈 (feat/ce-wiz,2026-11-15)
- **「模型只寫文字,事實由程式算」做到什麼程度。** 規格說日期、天數交給模型時要先算好;實作更嚴:程式算出的事(逾期的承諾、問了沒人回、逾期的交辦單)**自己**用固定句型變成監督/提醒項目,模型看不到要不要說、也不能改數字;模型只負責記錄、建議、以及程式算不出來的監督/稽核(沒人負責、前後不一致),而且必須附它真的看到的訊息編號。理由:本地模型算日期會錯而且錯得很像對的(寫「已過 3 天」其實 5 天)。代價:程式句型比較死板、規則會漏(沒有問號的問句、沒寫日期的承諾)但不會亂報。
- **沒有出處不出。** 在伺服器驗證(`format.ts checkLines`),不靠提示詞。模型寫的 `#編號` 必須在送給它的訊息裡;一則都不合格的回覆整次算失敗(頻道出現「這次整理沒有完成」+ 原因 + 重跑),不是靜靜貼空的。技能提案另外要求至少三則**不同**的訊息(「出現 3 次」由伺服器數,不信模型說的次數)。
- **提醒的收件人由程式決定,模型的提醒一律不收。** 提醒是「只給欠事的人本人」;若讓模型選收件人,一次提示詞注入或幻覺就會把別人的事寄給不相干的人。所以 `提醒` 只來自程式事實(誰承諾、誰的交辦單),模型寫的 `提醒` 行被丟掉(測試 `format`)。
- **規格 2.2 和 2.0 互相衝突,取不外洩的那邊。** 2.2 寫週報「五個面向各一段」貼在頻道,2.0 的硬規則是監督/稽核/提醒私下給、不貼頻道。頻道訊息全員看得到,所以週報**貼頻道的只有記錄、建議、交辦單表**;監督、稽核、提醒同一次產生,照每日摘要的分送規則私下送(頻道文字註明「監督、稽核、提醒只送給主管或本人」,不論有沒有東西,避免洩漏有沒有)。待 Founder 確認(見 COMMUNITY_EDITION.md 的未決事項)。
- **稽核(audit)面向預設關。** 規格只說「監督與提醒預設關閉、記錄與建議預設開」,沒講稽核。稽核的對象和監督一樣(主管 + 建立者、不貼頻道),所以跟監督、提醒一起預設關;要開由主管或管理員在頻道的精靈設定打開。
- **三支排程精靈預設都關。** 「每個頻道可開關;預設每天 18:00」解讀成:預設時間是 18:00,開關由人打開(測試:新頻道的設定全 false)。開著才會佔本地 GPU,不能每個頻道一開就偷跑。
- **誰能改設定。** 規格 2.1 說「管理員可改時間」,2.6 說頻道建立者、所屬部門主管、管理員能改這個頻道的精靈設定。取較寬的 2.6:三種人都能改時間;其他成員 403,看不到頻道的人 404(不洩漏頻道存在)。「所屬部門主管」沿用頻道既有的定義(`isHeadOfRoom`:頻道裡任一成員所在部門的主管)。
- **為什麼 tick 不帶資料、由 Portal 判斷到點。** n8n 流程只有「每 15 分鐘 POST 一次」,沒有頻道清單可以過期。Portal 用 `period`(日或 ISO 週)在 `wizard_runs` 查「這支這天有沒有跑過」,任何狀態的 run 都算(包括失敗:失敗要人看了再重跑,不自動重試去撞 GPU)。例外:手動按下去發現沒新訊息的 skipped 不佔當天,否則上午按一下下午排程就不跑。週報錯過週五晚上(伺服器關著)時,同一週的週六、日仍會補跑一次。一次 tick 最多開 `min(2, 空的 AI 名額)` 支,其餘下一個 15 分鐘。
- **共用 AI 名額。** `withAiSlot` 就是交辦給 AI 用的 `slot`(`TIGERAI_AI_RUN_CONCURRENCY`),沒有開第二個上限;房內 `@AI` 的佇列仍是另一條(一次一個),沒有合併(合併會讓一個數小時的交辦擋住所有頻道的 @AI,v11 已決定過)。
- **跑在什麼身分。** 每次執行開一段新的對話,放在頻道自己的資料夾、擁有者登記成頻道建立者、`room_id` 設為該頻道(所以側邊欄不列、唯讀成員工具集與檔案柵欄 H08 照用)。**不登記 speaker**,所以這段對話沒有 n8n 工具:頻道訊息是不可信的輸入,不能讓它誘導模型去叫流程。能力不會超過建立者(只讀的那一半)。
- **確認 = 一個狀態欄,不寫檔。** 訊息表是 append-only,所以「待確認 → 已確認」放在 `wizard_runs.confirm_state`;頻道卡片每次輪詢重畫,別人也看到。週報讀每日摘要時把未確認的標「尚未確認」。
- **同一人同一件事不重送。** 私下項目的 dedupe key = 面向 + 收件人 + 出處集合;已有未處理的、或 3 天內按過「我知道了」的就不再建。
- **技能只由管理員的「採用」寫成。** `decideItem` 是唯一呼叫 `writeSkill` 的地方,前面是管理員檢查;精靈的其他檔案不能 import 寫檔或 `createAssignment`(測試掃原始碼)。技能寫到 `<agent dir>/skills/<名稱>/SKILL.md`,「可用技能」清單的 60 秒快取在採用時清掉。中文名稱的資料夾用名稱的雜湊(`skill-xxxxxxxx`),因為技能資料夾要小寫英數。
- **新增上游 hook:1 個位置(H12 的第三個檔案)。** `app/api/tigerai/hooks/wizards/tick/route.ts` 一行 `export { POST }`(和 `hooks/agent` 同款),`gate.ts` 把這條路徑和 `hooks/agent` 一樣放行(認金鑰,不認 cookie)。其餘全在 `tigerai/`;介面走既有的 `main.override`、頻道選單(RoomView 是我們的檔案)和公佈欄。
- **已知缺口(未做、照實記):** ① 「跟公司規則不一樣(引用條文)」沒有做:社群版沒有公司規則的存放處,沒有條文就不能出(規格說沒出處不出)。② 假日/工作日沒有區分,每日摘要週末也會跑(有新訊息才跑)。③ 「採用」建議只是標記,沒有自動開交辦單(AI 不能自己開,由人在交辦頁開)。④ 交辦單與頻道的關聯只有「連到頻道自己 AI 對話的交辦單」;其他交辦單不進頻道週報。⑤ 提醒/監督沒有推播(只有鈴鐺和個人區)。⑥ 承諾判斷的「之後講過完成就清掉」是整個人層級,不分事項(同一個人先說完成另一件事,會清掉較早的別件承諾)。

## Batch ce-meet (2026-11-15): 會議摘要

- **Chunked upload instead of one 200 MB body.** Next buffers a request body whenever a proxy exists, capped by `proxyClientMaxBodySize` (128 MB upstream, set for another upload route). A single 200 MB request would be truncated, and raising the cap would put 200 MB in memory, which the spec forbids. 8 MB chunks piped to disk keep both ends at one chunk. A refused chunk is truncated away so the client can resend the same offset.
- **Two steps, two failure states.** Transcribing and summarising are separate (`failed_stage`), because ASR is slow and the model is flaky in different ways; a retry redoes only the step that failed and never re-uploads.
- **Sources are enforced by the program, not requested from the model.** The prompt asks for line numbers, `parseSummary` throws away any item whose numbers are missing or out of range. Who owes what and what is unowned/overdue is derived from the validated data. This is the local-model rule (「模型只產草稿、伺服器驗證輸出」), and it is what makes 「沒有出處就不出」 true rather than hoped for.
- **監督 stays private even though 2.4 lists it in the summary.** Spec 2.0 says 監督 goes only to supervisors and never into the channel; 2.4 lists it among the summary's parts. We followed 2.0 (the room draft says how many items are unowned, the list goes to the supervisors through the adapter; the private 精靈 thread shows it to the requester). 提醒 is in the room draft because in meeting minutes the owner and due date ARE the record; the owner also gets a private 提醒. If the Founder wants the room draft to carry 提醒 only privately, drop the 提醒 section in `renderSummary(…, "room")`.
- **Plain gateway call, not a pi session.** The summary is a JSON-producing one-shot, so it uses the model connection like 公佈欄 drafts. A pi session would add tools, a transcript file and the file fence for no benefit. Cost: the 精靈 flow is not a conversation in the left list (open gap in MEETING.md).
- **Own tables, own settings files, one adapter.** Tables are created by `wizards/meeting/store.ts`, not `db/store.ts`, and settings live in two new 600 files, so this branch does not collide with the shared wizard infrastructure or with the model-connection list being built elsewhere. Wiring to the shared code is `setWizardHost()`.
- **Open:** no bell count for delivered items until the adapter is wired; 80 000-character transcript cap; jobs are in-process (a restart shows them failed with a retry button).

## Community edition, model connections and fallback (2026-11-15, branch feat/ce-model)
- **A list, one provider per connection.** The first connection is the primary (usually the local LLM Manager), the rest are fallbacks (e.g. the cloud ai-api-proxy, backup only, never the primary). Each connection is its own provider in `models.json` (`tigerai`, `tigerai-2`, ...) with its own key reference (`$TIGERAI_V1_RUNTIME_KEY[_<ID>]`). Rejected: one provider with a merged model list. pi addresses a model as provider + id, so a same-named model on two gateways would collide, and per-connection limits/keys/offered sets would need a side table. **The id is stable, the order is the array order:** an AI role that names `tigerai-2/x` keeps working when the list is reordered; `settings.json` `defaultProvider` follows the first enabled connection that has models.
- **Migration without a reset.** `listConnections()` reads the legacy fields (saved URL/offered/default/overrides, `v1-api-key`, `TIGERAI_V1_*`) as connection #1 until the first write of the list; the first write persists `connections` and drops the legacy fields. The key of #1 stays in `v1-api-key` (or the env key file) so nothing moves; later ones use `v1-key-<id>` (mode 600). Env variables are initial defaults only, as before.
- **Fallback is a connection decision, taken at the same place the old fork took it.** The SDK retries the same model first. Only when those are used up does `agent_before_settle` fire; the handler returns `context_edit` (omit the failed assistant entry: the SDK leaves the final failed attempt in context), a `custom` entry `tigerai:model-fallback`, and `continue: true`. Alternatives rejected: re-prompt after `prompt()` resolves (`agent_settled` already fired: the page shows "finished" and starts again) and a `custom_message` notice (pi replays it to the model as a user turn). Only availability failures fall back (unreachable, timeout, 5xx, 429, model not found): not a bad/empty/cut-off answer, not context overflow (compaction's job), not quota/billing (an admin matter), not a user stop.
- **Same name first, else the connection's own default.** Candidates are tried in list order; a connection already tried this turn, disabled, or marked down is skipped. A failed connection is marked down for 10 minutes (`TIGERAI_FALLBACK_COOLDOWN_SECONDS`; per process, in `globalThis`); before the next turn (`before_agent_start`) the conversation steps off a connection marked down, stays on the substitute while the cooldown lasts, and goes back when it is due. A success on a connection clears its mark at once. "Go back" is read from the conversation's own log after the idle wrapper was dropped; a model the person picked afterwards is never overridden.
- **Where it hooks: no new upstream hook.** The extension rides `startExtensions` (H08); the one-line note rides the existing `chat.sender` slot (H28) and is read from the log (`GET /api/tg/sessions/:id/fallback`, same visibility as opening the conversation). Rejected: rendering the custom entry inside the message list (a new hook in `session-reader` and the SSE path for one line of text). Cost: the line sits under the composer, not between messages. It shows only for the latest turn.
- **Members never see connections.** The routes live under `/admin/models/connections` (403 for members, checked in the router); members only get the sentence of the note. Member model changes stay rejected by the gate (`model_locked`). Audit: `model.connection.add|update|delete|reorder`, and `model.fallback` (conversation, kind, reason, from/to connection names as they were, model). No key is ever audited.
- **Known gaps (open).** (1) A running conversation's model registry is a snapshot: a connection added after it started is not a fallback target for it until it reloads (idle wrapper 10 min). (2) Health memory is per process. (3) A connection with a wrong address and no previous model list has no models, so nothing can start on it; the first reachable connection leads. (4) The 30 s retry of an unreachable connection re-writes `models.json` and drops the models cache each time. (5) Streaming that dies halfway: the SDK ends the turn with an error message too, so it falls back like any other, but the partial text is dropped from the model's context (kept in the log).
- **Item 4 closed (the open point of v11).** The gate answers `POST /api/push/subscribe` itself and binds it to the signed-in person (`push_subs`), so upstream's ownerless list stays empty and its broadcast reaches nobody; ownerless entries found at start are dropped (VAPID keys kept). A small extension sends the completion push to the conversation's owner only, and not for channel, n8n hook or AI-order conversations (they have their own signal).
- **Items 2 and 3.** 繼續 frees itself when the run it started has ended (`latchStep`), or after 8 s if no run started. "Nothing to compact (session too small)" is the engine's own text; our fetch wrapper (`ui/error-translate.ts`) rewrites only `error` of a failed agent command and nothing else.

## 系統連接 / connectors (CE 3c)
- **One table, not a new one.** `n8n_mcp_servers` gained `template`, `description`, `last_tools`, `tested_at` (ALTER with defaults). Old rows are `n8n` connectors by the column default, keep their id, key file (`secrets/n8n-mcp-<id>.token`), allow list and tool names (`mcp__n8n_<name>__*`). No data copy step that could fail halfway.
- **Tool names carry the template.** Server name = `<template>_<name>` (`gitea_code`), so two systems can both call a connector `prod`. `isConnectorServer()` decides which MCP servers the group check applies to; any other MCP server (upstream's own admin config) is untouched.
- **Read-only is a list, not a promise.** Templates only ever list tools that read (checked by a test). The server-side fence is the allow list plus the group check on every `tool_call`; the other system's own account/key is the last wall (docs say how small to make it). `readOnlyHint` from the other server and a name pattern only label tools in the form.
- **Own tab, own component.** `tigerai/ui/Connectors.tsx` is the 系統連接 settings tab; the n8n tab lost its MCP form (webhooks and inbound keys stay). Old `/admin/n8n/mcp` routes still work (same functions).
- **Audit without secrets.** `mcp.tool_call` is written once per call: denied at `tool_call`, otherwise at `tool_result` with ok/error. Arguments, keys and URLs are never recorded. The previous `n8n.mcp_*` actions are replaced; old rows keep their zh names in the audit list.
- **Test connection is a small own client** (initialize, tools/list, JSON or SSE answers, session header), because pi's MCP support only connects when a conversation starts and cannot be asked "what do you offer" from the admin page.
- **No hook added.** The 功能 menu section rides the existing `composer.functions` slot; the settings tab rides `SETTINGS_TABS`.

## 社群版收工:版本分界與顧問包掛載點 (feat/ce-integ,2026-11-15)

- **為什麼不是「同一份程式 + 功能開關」。** 第一個想法是把顧問功能留在公開樹、用授權開關關掉。否決:公開 repo 就會帶著 MCP 連接與 Gitea 的全部程式與說明,「社群版不含」只剩一句話;而且 SUL 草稿授權的邊界(`tigerai/` 全部公開)會讓顧問程式也被當成社群程式。所以改成「兩個 repo、同一個建置」:公開 repo 只有掛載點(`tigerai/addons/`),顧問包在私人 repo,建映像時複製進來。
- **為什麼程式編進映像、授權在執行時決定,不是「啟動時掃資料夾載入」。** 規格寫「找 `TIGERAI_ADDON_DIR` 裡的顧問包」。Next 只能執行它打包過的程式,執行時 `import()` 一個資料夾不可行(也不該:那等於執行任意程式)。所以程式在映像裡,`TIGERAI_ADDON_DIR` 放的是授權檔。效果相同(沒授權什麼都不載)。這是對規格字面的偏離,已記。
- **「載入」的意思。** 沒有授權時:`activeAddons()` 回空,路由器問不到任何路由(落到 404)、兩個 hook 檔回 404、選單由伺服器公告所以空、pi 擴充不加、MCP 不放行、精靈種類不登記、`init()` 不跑(顧問包的資料表不建)。測試 `ce-addons.test.mjs` 的「最小範例包」走一遍:沒授權/功能不含/有授權/過期。
- **範圍改了一次(同日,Founder):n8n Webhook 留在社群版。** 第一版把 n8n 整包(webhook、hook 金鑰、MCP、tick)都搬進顧問包;當天 Founder 改為「社群版要能做簡易 n8n / webhook demo」,所以搬回來:webhook 登記與 AI 呼叫(`n8n_webhook` 工具)、功能選單的 n8n 應用、`/api/tigerai/hooks/agent` 與 hook 金鑰管理、`n8n_webhooks`/`hook_keys`/`hook_calls` 資料表,都在公開樹。留在顧問包的只有 MCP 集成區(連接、範本、`n8n_mcp_servers` 表)與 n8n 的排程 tick。教訓:搬出去的是「功能」,不是「一個叫 n8n 的資料夾」;原本 `tigerai/n8n/service.ts` 一檔混著 MCP 與 webhook,切的時候要照功能切(現在 webhook/金鑰在 `tigerai/n8n/service.ts`,MCP 在顧問包的 `connectors/service.ts`)。這個選擇的代價:社群版仍有「AI 呼叫外部網址」的能力(只限管理員登記、群組勾選的 webhook,密鑰 header 不回傳),要擋就得再改;社群版的成員聊天也看得到 n8n 應用。
- **顧問包的資料表(MCP 連接)搬出公開結構。** `n8n_mcp_servers` 的 DDL 與它的欄位遷移在顧問包 `init()`;社群資料庫從來不會有,舊資料庫有的表原封不動(社群版不讀不寫)。
- **授權:Ed25519 簽章檔,不連網。** 公鑰內嵌;簽章簽的是欄位順序固定的 payload。沒選對稱金鑰或 HMAC(驗證的金鑰就在映像裡,等於把簽發能力交給每個客戶)。**開放缺口**:不防系統時間往回調;沒綁機器;換公鑰會讓舊授權全失效。測試用的假金鑰只在 `node --test` 底下被接受(`NODE_TEST_CONTEXT`)。
- **內建排程與 n8n tick 的退讓規則。** 之前 `tick()` 自己記「最後一次被呼叫」;現在 `tick()` 不記,由外部端點(`recordTick`)和內建定時器(`recordBuiltinPass`)各記各的,否則內建定時器的每一輪都會被當成 n8n 的呼叫,退讓判斷永遠成立。退讓條件 = 顧問包授權有效 **且** 1 小時內收過外部(n8n)tick;n8n 停了,內建的自己接手。管理員的精靈設定頁依 `mode` 顯示是誰在驅動、紅字門檻不同(內建 20 分鐘、外部 1 小時)。內建定時器在 `adapter.init()`(H01,已有的 hook)裡啟動,沒有新增上游位置;上游的 tick 路由檔(H12)轉進顧問包的入口(沒有啟用就 404);`hooks/agent` 路由檔維持指向社群的 `tigerai/n8n/inbound`。
- **會議摘要接上引擎。** 暫時的 `wizard_private_items` 表與「給我的提醒」頁籤拿掉:提醒/監督走引擎的 `wizard_items`(公佈欄個人區 + 鈴鐺 + 同一套去重),草稿變成有「確認」的頻道卡(引擎的 run 紀錄),模型呼叫改用共用的 AI 名額。舊表資料第一次使用時搬進引擎(沒出處或房間已刪的不搬)再刪表。出處新增一種 `x`(逐字稿的行,不是頻道訊息,只顯示不連結)。
- **改名:** 產品名 OpenAgent Portal,「based on pi-agent and pi-web」帶連結在登入頁、名稱彈窗、README、NOTICE。`tigerai/`、`TIGERAI_*` 不改;公司與聯絡資訊仍是虎智;LICENSE 仍是 SUL 草稿(標明待法律審閱)。
- **開放/已知缺口:** ① (已處理,Founder 決定隱藏)上游的「MCP」頁籤與 `/api/mcp*`(pi 自己的 MCP 設定):社群版把頁籤從 `layout.ts` 拿掉,並在 `adapter/gate.ts`(我們的檔案,零上游改動)對 `/api/mcp`、`/api/mcp/*` 一律回 404,直到有任何生效的顧問包才放行(顧問包的選單把 MCP 頁籤帶回來)。選「有授權就放行」而不是「全交給系統連接」:後者要改上游的 MCP 頁或 API,前者只動閘門。`TIGERAI_ENABLED≠1` 不經閘門,照上游。注意:這只關上游的「設定頁」API;已存在的 `mcp.json` 設定仍由 pi 讀取,成員的對話本來就不能呼叫 mcp 工具(path-guard)。② 側邊欄分組掛點(`menus.sidebar`)只宣告、沒有畫面用它。③ 顧問聯絡帳號/顧問角色:不做(Founder:客戶 Portal 不需要顧問帳號,待最後確認);只在 ADDON.md 預留一行。④ 顧問包的 n8n/Gitea docker 安裝與接上、Gitea 存檔:待做,只寫了分界。⑤ i18n 字典裡仍有 `asTagN8n`(交辦單來源標籤,資料欄位本來就有 `n8n` 這個值)。⑥ `assignments.source='n8n'` 這個值仍在社群程式裡(已存的資料與標籤用),社群版不會產生它。

## Community edition, personal model connections (2026-11-15, branch feat/ce-byok)
- **Per-conversation provider injection, not the shared `models.json`.** The admin connections are providers in the global `models.json`, which every conversation's registry and the picker read. Putting personal ones there would show them to everyone and let anyone select them. Instead the owner's conversation gets one more inline extension (`provider/personal-runtime.ts`, through `startExtensions`, existing H08) that calls pi's `registerProvider` for that person's connections. Probed against the SDK: a registry built for another conversation does not know them. Consequence worth the design: a conversation without an eligible owner (a room's assistant, n8n, a wizard, a subagent, someone else's) has **no such extension, so the model does not exist there**; the gate's check is the second wall, not the only one. Rejected: one models.json per person (pi has one agent dir; settings and credentials would fork) and a pi `agentDir` per user.
- **Who is the owner.** The person who started it over HTTP (the `pendingRoleFor` hook, H06, now also records the caller under the temporary `__new__` key: the only moment the identity is known, because `startExtensions` sees only the temporary key for a new conversation) or the applicant of an AI order (`workorders/ai-driver.ts`); a reopened conversation by its owner row, kinds `chat` and `fork` only, never room-bound, never `room-ai` / `room-role` / `wizard` / `hook`. A conversation started inside a channel folder is refused as well (`/rooms/<id>`), whatever the key.
- **A literal key is not safe in pi's `apiKey`.** pi reads a leading `!` as a shell command and `$NAME` / `${NAME}` as an environment reference. A person's key could therefore execute a command on the server. Two defences: keys starting with `!` or `$` (and anything with spaces or control characters) are refused at write; and the provider is registered with an environment reference (`$TIGERAI_PKEY_<ID>`) set in the process, never the literal. Cost: the key sits in the server process environment (visible to an administrator's shell tool; members have none). Open gap.
- **Upstream's process-wide provider catalog would have leaked it.** `lib/deferred-provider-models.ts` remembers every extension-registered provider's models in `globalThis` after a session starts and then lists them in `/api/models` for everyone ("deferred models"). Personal ids never get in: `guardCatalogs()` swaps those two maps for ones that ignore ids starting `tgp-` (also purges existing). Found by reading the call site, not by a failing test: the first design (register through the extension and be done) passed every test and would have shown one person's connection in another's picker after the first session started. Zero upstream edits.
- **Id scheme and ownership.** `tgp-<8 hex of sha256(userId)>-<8 hex random>`. The prefix only means "personal"; ownership is decided by finding the id in the caller's own list (`userOwnsProvider`). Any request body to `/api/agent/new` or `/api/agent/<id>` containing a `tgp-…` id that is not the caller's gets 403 `personal_forbidden`, for administrators too (the scan is on the raw body, so a new field name upstream adds is covered).
- **Members may pick only their own models.** The existing rule (`model_locked`: members never choose models) stays; `memberCommandDenied` takes an optional `ownModel` predicate, true only for a provider the caller owns, and only without thinking-level fields. The picker for a member lists only their own group; public models are still the administrator's decision. Cost: a member who moved to their own model gets back to the school's model by starting a new conversation, not by picking it. Rejected: letting members pick public models (changes the lock the administrators set).
- **Model list without an upstream edit.** The gate (H02) rewrites `GET /api/models` to `/api/tg/model-list` only for a person who has at least one usable connection; that handler calls upstream's own handler and merges. Everyone else keeps upstream behaviour byte for byte. `me.personalModels` lets the page keep the picker (`upstreamVisible("composer.model")`); the thinking control stays admin-only.
- **Fallback.** One list per conversation: the owner's connections in their order, then the public ones; a public failure never moves a conversation onto a personal key (nobody's quota is spent on the school's behalf). When "must use own key" is on and the person has a connection, the list is theirs only and a conversation on a public model leaves it at the next turn. A fallback involving a personal connection is not audited (spec: audit only add/change/delete); the one-line note names it 「我的連線」.
- **The two switches** live in `models-settings.json` (`personal`), defaults on/on. `allow` off: every personal connection is unusable at once (registration, picker, ownership, add) but data stays. `publicWithoutKey` off: a member with no usable connection is refused at send (403 `personal_key_required`, gate), a member with one is served by theirs only; administrators are never required.
- **Where an administrator may not go.** An administrator can open any conversation, so the extension owner (the conversation's owner) is not necessarily who types. A send (`prompt`, `steer`, `follow_up`) into a conversation owned by someone who has personal connections, by anyone but the owner, is refused (403 `personal_session`); abort and reading stay allowed. Cost: an administrator cannot continue such a person's conversation even if it is on a public model.
- **Where a request may go (SSRF).** Members give the server URLs to fetch. Loopback, private ranges and link-local/metadata are refused at write, test and registration (DNS resolved, every address checked, `redirect: manual`); `TIGERAI_PERSONAL_ALLOW_PRIVATE=1` opens private ranges and loopback for a school with an on-prem server (169.254 never).
- **Model defaults for a generic endpoint.** `reasoning: false`, no thinking format, text input, 128k context, 4096 output: the gateway's qwen thinking switches send fields strict OpenAI-compatible APIs reject. The person cannot set limits (open: a model with a smaller context fails at the provider).
- **Open gaps.** (1) The key is in `process.env` (above). (2) DNS can change after the write check (rebinding): re-checked per turn with a 60 s cache, not per request. (3) An open conversation notices a deleted/disabled connection at its next turn, not at once. (4) Idle-wrapper behaviour: a connection added mid-conversation is registered at the next turn, fallback sees it then. (5) No per-person usage limit or cost display. (6) A personal model's token prices are 0 in the cost counters. (7) Nobody tests that a model name exists at write; the test button lists the service's models. (8) An administrator cannot continue another person's conversation (above).

## 社群版:使用者紀錄 (feat/ce-userlog,2026-11-15)

**問題。** 學校的老師(部門主管)要知道學生有沒有上線、跟 AI 談了什麼;學生沒有共用帳號,每個人都是一個成員。

**取捨與決定**

- **權限在伺服器,而且只有一個地方**(`userlog/service.ts` 的 `visibleTargets`)。列表、對話列表、內容三條路都經過同一個函式;對話內容另外要求「這個對話確實是那個人自己的、不是頻道的、種類是 chat」,所以拿別人的對話 id 湊進來也讀不到。
- **誰看誰(規格沒寫死的部分,這樣定)。** 管理員:所有非管理員(成員與主管);不看其他管理員(規格:看不到其他主管與管理員,管理員之間互看沒有需求,也沒有理由讓一個管理員被另一個讀)。主管:自己主管的部門的**直接成員**,以 `memberships` 的 `is_manager=1` 找部門,不走 `groups.parent_id`。「主管」= 在任何部門是 `is_manager` 的人,所以同時是別處主管的人,對這位主管也是看不到。
- **為什麼不新增角色或欄位。** 「主管」本來就是 `memberships.is_manager`(公佈欄、頻道檢視都用它);不另開權限表,否則兩份「誰是主管」會漂移。
- **最後上線放在哪。** 放在 proxy 閘門(`adapter/gate.ts`,hook H02 已經有,**零新增 hook**),因為那是唯一每個已登入請求都經過的地方;不放 `/api/tg/me`,因為那只在載入頁面時才叫,開著分頁的人會顯示成離線。代價:頁面自己的輪詢(例如 2.5 秒一次的 running)也算上線——開著分頁就算在線,這正是老師要的意思。每人每分鐘寫一次(記憶體記時間,重啟後第一個請求再寫),寫失敗只記 log,不影響請求。
- **用既有的會話讀取器,不複製一份。** 對話內容用 `lib/session-reader`(列表 `listAllSessions({allowStale:true})`,內容 `buildSessionContext`),畫面用上游 `MessageView`,只是不傳 `onFork`、`onEditContent`、輸入框,所以那些按鈕根本不存在;每則訊息另外印出時間。
- **為什麼不用一般的 `/api/sessions/<id>`。** 閘門對成員會擋非自己的對話(對的),主管也是成員;開一個例外等於放寬整個擋板。另開 `/api/tg/userlog/*`,它自己做範圍檢查,而且只有 GET。
- **稽核。** 被拒絕的請求不寫(否則主管亂點會灌爆紀錄),成功的查看每次一筆。內容不進稽核,只有標題前 60 字。

**錯過的想法(給下一個人)。** ① 一開始想把「對話數、最近時間」存進資料表更新;改成每次由工作階段檔算,因為檔案是事實來源,資料表會與檔案不同步。成本:成員很多時列表要讀一次整個目錄索引(上游自己的側邊欄也在讀,用 `allowStale`,第一次之外是快取)。② 想過逐次通知學生「某某看了你的對話」,Founder 選固定一行告知。

**已知缺口 / 未做**

- 顧問帳號:社群版沒有顧問角色(ADDON.md:不做)。「顧問什麼都看不到」現在靠「他是一般成員」成立;顧問包若把顧問做成管理員,這個功能就會讓他看到,**要在顧問包那邊處理**。
- 「最近一次對話時間」用工作階段檔的修改時間,不是最後一則訊息的時間(兩者通常一致,別的程式動到檔案時會不同)。
- 已停用的成員仍列出(標「已停用」),因為老師可能還想看紀錄;沒有分頁,成員上千時列表會很長。
- 工具輸出(讀檔、shell 結果)原樣顯示給主管,裡面可能有學生貼的內容;沒有遮蔽。
- 看過的對話不顯示「已看過」給學生;只有稽核。

## 社群版:講義當知識(feat/ce-knowledge,2026-11-15)

取捨與缺口。操作見 COMMUNITY_EDITION 第 2b 節。

- **不做 RAG、不做向量**:小檔整份放進角色指示(每次都看得到,回答可靠),大檔留在資料夾讓 AI 用 `read` 翻。代價:大講義靠模型自己決定要不要讀,可能漏讀。
- **預算 = 模型 context 的 30%,小檔優先**:估算偏悲觀(中日韓字 1 字 ≈ 1 token,其他 3 字元 ≈ 1 token),寧可少放。一個檔不會被截斷:放不下就整份改成「需要時才讀」,一旦有一份放不下,更大的也不放。模型長度讀 models.json(執行時用的同一份);查不到用 16384。已知缺口:AI 角色換了模型,「已用 N%」要重開畫面才重算;role 在對話中途不重算。
- **為什麼放在角色指示而不是第一則訊息**:`rolePrompt()` 是既有的唯一入口,頻道助理和一般對話都走它;代價是換新版只影響之後開始的對話(頻道助理在每次啟動重套,所以較快跟上)。
- **主管權限**:角色沒有「建立者」欄位,所以「自己部門的角色」定義為「可見群組非空且全部是自己主管的群組」。管理員建的全公司角色(沒指定群組)、跨科角色主管都不能動(403)。不往上下層繼承,和組織規劃一致。已知缺口:主管建角色沒有數量上限;角色名稱與別人重複時回「已存在」,會讓主管知道該名稱存在。
- **工具上限只是紀錄**:主管建的角色 `tool_names = ["read"]`。`AgentRow.tool_names` 目前在執行時沒有被任何程式強制(成員的工具限制來自 `MEMBER_DENIED_TOOLS`),所以真正的限制是成員本來就沒有 bash/edit/web;管理員用角色開對話時 `tool_names` 也沒有擋。要真的擋要在 `startExtensions` 套用,這次沒做。
- **學生碰不到原檔**:列表、下載、上傳、刪除全部 403;但 AI 可以把內容講出來(整份在指示裡)——這是用途本身,不是漏洞。學生的 session 路徑圍欄只多開那個角色的資料夾(唯讀 read/grep/find/ls),別的角色的資料夾不行。
- **附件不用新的上游 hook**:上游附件鈕在 `onAttachFiles` 路徑下對非圖片是「上傳到工作資料夾再 @提及」,成員不一定能讀。改成包住 `composer.state` 的 `TextAttach` 在捕獲階段攔截「全部都是 .md/.txt」的選檔或放檔,文字寫進輸入框。走過的路:原本想改上游 `accept={onAttachFiles ? undefined : "image/*"}`,但這個 fork 的 ChatWindow 已傳 `onAttachFiles`,按鈕本來就收所有檔,真正的缺口是「文字沒進 prompt」。已知缺口:放到訊息區(輸入框以外)的檔案仍走上游上傳;附件文字會顯示在使用者訊息裡(整段),不是縮成標籤;房間(頻道)輸入框沒有附件。
- **活體驗證(Docker,假的 OpenAI 相容端點)**:老師建角色並上傳、「已用 4%」、學生選角色問,送給模型的請求含 ch1.md 全文、檔名標頭與「出自：檔名」規則,長檔沒被放進去;附件請求含【附件：mynote.md】。判斷只看有回應、無錯誤、請求內容。

## Community edition, school features (2026-11-15, branch feat/ce-school)

**Self-registration**
- **Per-department join code, not "pick a department from a list".** A public page with a department list lets any stranger put themselves into a class (and see class names). A code the teacher hands out proves they are in the room. Codes are stored in plain text (the teacher must be able to read it back; it is not a credential for anything but "become a plain member of this class"), 8 characters from 31 (about 8.5e11), and wrong guesses are throttled globally. Rejected: invite links per student (teacher workload), a department "open for join" flag (leaks class names, no proof of presence).
- **Switch off = the feature does not exist.** The gate answers 404 for `/tg/register` and `POST /api/tg/register`, and the handler answers 404 again (defence in depth). Only `register/status` stays public so the login page can decide whether to draw the link; it reveals nothing but a boolean.
- **No escalation by construction.** `registerStudent` takes four fields and builds the account itself: role `member`, membership with `is_manager=0`. There is no code path where a body field reaches `role`, `isManager` or the group.
- **Code check before account check.** `createUser` reports "email already in use"; running it first would let anyone without a code probe which emails exist. The code is checked first, so the probe answers 403.
- **Throttle is global, like login's, and counts only wrong codes.** A per-IP counter is not possible (no trustworthy address in the proxy). First design counted every 400 (weak password, bad email) as a failure: 40 students typing in the same minute would have locked each other out. Only a wrong code doubles the delay; the hourly cap bounds a flood of real accounts. Cost: one attacker guessing codes also slows the class (up to 60 s per attempt); acceptable for a switch that is on for a lesson.
- **Open gaps.** Email addresses are not verified (no mail sender in the community edition): anyone with the code can register any address. A leaked code stays valid until rotated; no expiry date or use count. A student cannot choose to leave a class. `account.self_register_failed` is written for every wrong code (bounded by the throttle).

**到勤與使用狀況匯出 (what replaced an "AI grading wizard")**
- **The first design was wrong in a reasonable way.** It built a wizard kind with a rubric (到勤 50 / 使用狀況 50), AI-suggested scores with citations, a confirm step and private results for students, because the lesson plan (§9) described exactly that and referred to a school guideline that scores must not be decided by an AI. It was built, tested (13 tests) and removed before it was released. The Founder's point: a score, even a suggested one, steps into the teacher's judgement ("我們不要介入人類的想法,提供成果與建議就好"), and a late/absent penalty rule is a policy, not a fact. What stayed is what the program can state without choosing a policy: active or not in the slot, the first time, totals.
- **No lateness rule.** The first time is printed; the teacher decides whether 09:40 is late for their class.
- **Facts need a trail.** `user_activity.last_seen` is overwritten by the next request, so "was online on Tuesday 09:20" cannot be answered afterwards. The gate's existing once-a-minute write now also inserts a row into `activity_log` (pruned after 400 days). Consequence: dates before this version have only messages and channel posts to go on.
- **AI summary gets numbers, not people.** The prompt contains only class-wide totals; names, emails and conversation titles are never put in it, so the model cannot say anything about an individual even if asked, and the reply is also refused when it mentions scores, deductions, cheating or AI detection. The reply is shown to the caller and not stored. Cost: the summary can only say things like "attendance dropped on 11/10".
- **Scope is `userlog.visibleTargets`**, not a second copy of the rule; plus: anyone who heads any department is a teacher, never a row (an administrator's view would otherwise list the class's own head).
- **Open gaps.** Excused absence (請假) cannot be recorded; "attendance" is a proxy (a page left open counts, a student on a phone call does not). The table is built on request and reads each student's session files in range (fine for a class, slow for hundreds). Class times are not saved between visits.

## Community edition, registration approval (2026-11-15, branch feat/ce-register-approve)

- **Why approval was added back.** The first CE self-registration made an active account at once, and the only gate was the 8-character code. That is fine for a locked classroom but wrong for anything else: a leaked code means strangers inside, with no human look at it. The old product (pi-web-tw: `adminUsers.signup.*`, `pendingCount`, `login.signupPending`) had it right: every signup lands as 待核准 and cannot sign in. Founder's wording: 「註冊後通知管理員打開」. We copy that behaviour, not its three signup modes (the switch plus 「必須輸入通關密語」 cover them) and not its code.
- **Pending account = `users.status='disabled'` plus a `registration_requests` row.** `users.status` has a CHECK of two values and SQLite cannot widen a CHECK without rebuilding the table, which every other module's queries depend on. A disabled row already fails every `status==='active'` check (login, cookie gate, wizards, n8n), so there is no place where a pending account could leak through. The request row carries class, typed phrase, note, state and who decided. Rejected = still disabled, row kept; nothing is deleted.
- **A passphrase the teacher writes, not a random code.** Founder: the teacher must recognise whom to approve without checking each person. The phrase names the class (「AI Agent 實作 甲班 2026秋」) and the approval list is grouped by the class it matched, with one button per class, so approval is a glance at class and head-count. Same table and matching as before (`group_join_codes.code` now holds the normalised phrase, `phrase` the text as typed; old random codes keep working). Normalisation is NFKC + lower-case + dropping spaces/punctuation/symbols, so 「ai-agent 實作甲班」 matches. Trade-off: a human phrase is guessable. What still protects it: the global doubling throttle on wrong phrases, the hourly cap, and that a correct phrase only creates a request. That last point is why auto-approve is off by default and only meaningful with a teacher present.
- **A wrong phrase is refused at registration** rather than parked as "no class". The approver should never receive an applicant nobody can place. The one exception is the administrator turning 「必須輸入通關密語」 off: those applicants have no class and only administrators see them.
- **Notifications reuse existing delivery.** `personalItems()` (the bell count and 公佈欄 個人區) derives one `register` item per class from `pendingRequests(actor)`, so who sees what is exactly the approval scope (administrator: all; head: own classes) and the item disappears by itself when decided; no notification rows to keep in sync. Web push goes through `pushToUser` to administrators and that class's heads (best effort, payload is a title and a link). A head of another class can neither see nor decide: `decide()` looks the applicant up inside the caller's own `pendingRequests` and answers 404 otherwise.
- **Auto-approve switch (default off).** For a supervised session only. It needs a matched class, so an open-workshop applicant with no phrase always waits for a person.
- **Open gaps.** Email is unverified. A rejected applicant keeps the email, so they cannot simply try again (an administrator must delete or re-enable the account in 成員). Push to approvers fires on each registration, so a class of 30 sends 30 pushes; no batching. Head approvals are not visible to the other heads of the same class beyond the audit log.

## 社群版:上網查資料與投影片 (feat/ce-web-slides, 2026-11-15)

**Web research (`tigerai/web/`)**
- **Tools registered everywhere, allowed per call.** The extension is in every conversation (H08 `startExtensions`, no new hook) and each call re-reads the switch and the speaker's groups. Registering only for allowed people would have needed the session to be rebuilt when the admin flips the switch; checking at call time makes "off" immediate, and the system instruction (cite, data-not-instructions) is added per prompt only for people who may use the tools. A channel's @AI acts as the person who spoke (`roomSpeaker`), the same rule as n8n: never the creator, never the room.
- **`web_*` is no longer in the member deny list.** `MEMBER_DENIED_TOOLS` blanket-denied `web_*`, which would have silently removed our tools for every member and every channel. It is replaced by the per-call gate; if a plugin ever registers another `web_*` tool for members, that is now a decision to make there (open item: the list has no pattern for "web tools except ours").
- **Admin switch default OFF, groups empty = administrators only.** Same reasoning as n8n/MCP: an open web is a bigger door than a prompt. Groups are direct membership, no inheritance (same as every other group rule here).
- **Address safety is its own function, with no environment switch.** `addressBlocked()` for personal model connections can be relaxed by `TIGERAI_PERSONAL_ALLOW_PRIVATE=1` (a school's own GPU box). Reusing it for `web_fetch` would let that switch open the school's internal network to a student's prompt, so `web/net.ts` has an unconditional version (adds CGNAT, multicast, NAT64/6to4 wrappers, mapped IPv4 in hex form). The check runs **inside the socket's `lookup`**, i.e. at connect time, so a DNS answer that changes between "check" and "connect" (rebinding) cannot pass; redirects are followed by hand with the same check per hop. The search provider address is different on purpose: the admin types it, it may be private (a SearXNG container), and it is never a URL the model can choose.
- **robots.txt is honoured (longest match, our token before `*`; unreachable file = allowed).** It costs one extra request per site per ten minutes. A user-triggered fetch arguably does not need it; "robots-friendly" was the requirement, and it is the cheap way to be a good guest. The User-Agent names the product generically and says what it is.
- **Prompt injection is handled by labelling, not filtering.** Page text is wrapped as "page text (data, not instructions)" and the system instruction says so. There is no filter for "ignore previous instructions": that is a losing game. The real fence is what the tools can do: `web_fetch` can only read public pages, `web_search` only search, and neither can write anything or reach the school's network. The scripted live test has a "hostile page" step that makes the model try to read the cloud metadata address; the tool refuses. Open: a page can still make the model write misleading text into the channel; the instruction asks for citations so a reader can check.
- **Audit keeps what was asked, not what came back.** `web.search` (query, user, channel), `web.fetch` (URL as given, user, channel). No result lists, no page text. Queries and URLs can still contain personal data typed by a student; they are in the audit log, which only administrators read.
- **Rate limits are per process and in memory** (12 searches / 24 fetches / 6 decks a minute per person). A restart forgets them, and two Portal processes would double them. Fine for one container; not a quota system.
- **Open gaps.** No result cache (the same query twice asks SearXNG twice). `web_fetch` reads HTML and plain text only: PDFs, images and pages that need JavaScript come back empty or refused. SearXNG results vary by day and by which engines are enabled; the live test therefore asserts shape, not content. Brave and Tavily are coded against their documented APIs and covered by unit tests of the address and key handling, but were **not** run live (no keys).

**Slides (`tigerai/slides/`)**
- **.pptx first, PDF as a conversion.** The first design drew the PDF directly (own PDF writer plus a subset of a CJK font shipped in the repo). The Founder's decision replaced it: the group needs a file they can edit, and writing a PDF writer plus font licensing (the Noto CJK OFL has a reserved-name clause that a subset would have had to respect) is more code and more risk than handing a standard .pptx to LibreOffice. So the deck is hand-built OOXML through `jszip` (already a dependency; no new package), and the PDF comes from a separate converter container.
- **LibreOffice is not in the Portal image** (Founder: separate container). Gotenberg wraps LibreOffice behind `POST /forms/libreoffice/convert` and ships Noto Sans CJK TC (verified in the 8.21.1 image: `fc-match "Noto Sans CJK TC"`), so no font work on our side. Cost: one more container to run and its 1.5 GB image; benefit: the Portal image grew by 1 MB. The address is an admin setting with a 「測試」 button that converts a one-slide Chinese deck; empty by default.
- **Not configured or failing is not an error.** The deck is still delivered as .pptx and the tool result tells the AI to say that PDF conversion is not set up. A silent "PDF made" would send students to a 404 on the day of the presentation.
- **One conversion at a time** (an in-process promise queue). LibreOffice is effectively single-process; twenty students pressing the button together would otherwise start twenty conversions against one converter. The queue is per Portal process.
- **The font in the .pptx is `Noto Sans CJK TC`.** The PDF embeds it (checked with `pdffonts`). A student's own PowerPoint without that font substitutes a system CJK font, so the layout can shift slightly; the PDF is the presentation copy. Open: `a:ea` could list the usual Windows/macOS faces first, but LibreOffice in the converter would then have to substitute them, which was not tested.
- **Layout is computed by us, not by the renderer.** A .pptx written without a cached font scale does not shrink text in either PowerPoint or LibreOffice, so `deck.ts` estimates lines (CJK = 1 em, Latin ≈ 0.55 em) and splits long slides into "(續)". The estimate is approximate: a slide with many very wide Latin words can still overflow. Tables are limited to 5 columns of short cells; since 1.1.2-ce up to 30 rows, continued on "(續)" slides (it was 7 rows, dropped silently).
- **Download is a normal authenticated route, not a public link.** `GET /api/tg/slides/<id>?format=pdf|pptx`. Channel decks follow `requireRoom` (members, and the heads/administrators who may read the channel); a non-member and a removed member get 404, same as an unknown id. Stored inside the room's folder, so the existing channel purge removes them. Personal decks are the owner's only (an administrator cannot open them either; the 使用者紀錄 page is where administrators look at conversations). The id is parsed strictly (`<r|u + 12 hex>-<12 hex>`), so it can never name another path.
- **Open gaps.** No list of a channel's decks (the link is in the message; if the message is lost the file is only reachable by the id). Decks are never deleted except with the channel. `make_slides` has no admin switch of its own (it needs a conversation and writes only into the person's own scope); if a school wants it off, turn off the AI role or tell the converter URL empty (then only .pptx is made). A room AI run still has the 5-minute limit: five searches, two page reads and a deck on a slow model can exceed it.
- **Live results (2026-11-15, image `openagent-portal:dev-webslides`, throwaway Portal 30186 + Gotenberg 8.21.1 on 30187).** The search address is the school's existing SearXNG, set only in the admin page (no URL in code). Two runs of the channel flow (two students post views, `@AI 幫每位同學找參考資料`, `@AI 分析並整理成投影片`): a scripted model (which also tries to read the cloud metadata address: refused) and a gateway-served model `tigerai-agent` (real searches, cited `[標題](網址)` links per student, 6-page deck). Both PDFs: 16:9, Noto Sans CJK TC embedded, Chinese readable; all channel members, the teacher and an administrator download with 200, a student of another class gets 404. Screenshots in `gen1-ce-shots/web-slides/`.

## 社群版:只開放 n8n 的 MCP(feat/ce-n8nmcp,2026-11-15)

Founder:社群版只有 n8n 開放 MCP,當作 MCP 示範(他是 n8n 大使);其他系統的 MCP 找顧問或虎智。
伺服器端與畫面都用同一句話:「社群版只開放 n8n 的 MCP，當作 MCP 示範；其他系統的 MCP 請洽顧問或虎智科技（tiger.ai.tw@gmail.com）。」

- **搬回來的是「連線這一整套」,不是「n8n 的幾個檔」。** 連接登記、測試連線的 MCP 客戶端、對話裡的擴充(註冊伺服器、每次呼叫查群組、稽核)、系統連接頁,都從顧問包搬回 `tigerai/n8nmcp/`、`ui/Connectors.tsx`。顧問包只剩「多帶範本」:`AddonModule.connectorTemplates`(Gitea / Zabbix / 自訂)。否決的做法:公開樹只放 n8n 的簡化複本、顧問包保留完整版——兩份程式碰同一張表、同一個 `mcp__` 工具前綴,會有兩個擴充同時註冊同一個伺服器。現在只有一份,顧問包有授權時它的範本才出現在同一個頁面與 API(`activeAddons()` 每次重算,授權過期範本立刻消失)。
- **其他範本在伺服器端被拒,不是只藏選項。** `saveMcpServer` 對不在 `connectorTemplates()` 裡的範本回 403 `edition` 與固定句子;資料庫裡已有的非 n8n 列(顧問映像留下的)原封不動,但列表、PATCH、DELETE、對話註冊都看不到它(404 / 不註冊)。測試 `ce-n8nmcp.test.mjs`。
- **會改動 n8n 的呼叫要有人核可(Founder 要求)。** n8n 的權杖在 n8n 那邊不能縮小,所以閘門在我們這邊:不在「已知唯讀」清單(`N8N_READ_TOOLS`,取自真的 n8n 2.44.6 的 `tools/list`)裡的工具都算寫入,包含 `execute_workflow` 和以後 n8n 新增的任何工具(失敗時關門)。寫入工具需要管理員勾選,**而且**一張核可過的申請單。
  - **先想錯的一版:** 「寫入只能在『交辦給 AI』的背景工作裡做」。理由聽起來合理(交辦是人下的指令、做完要本人確認)。推翻:交辦給 AI 是**申請人自己**按的,沒有第二個人;而 n8n 的改動(尤其是 `execute_workflow` 會真的跑流程、對外送信)需要的是另一個人看過。資料庫已有「核可單」(`work_orders`:核可人必為管理員、不等於申請人,觸發器擋),所以直接用它:AI 用 `n8n_request_write` 開一張 `n8n_mcp_write` 單,核可那一步在同一個交易裡建立「授權」(`n8n_mcp_grants`:這些工具、這個連接、這個申請人、4 小時、10 次)。對話與交辦給 AI 的背景工作都能用這個授權。
  - 授權是「申請人 + 連接 + 工具」,不綁某一段對話。取捨:綁對話要把工作階段 id 帶進核可單,而交辦給 AI 的第一次執行才建立對話,申請時還沒有 id;4 小時 / 10 次的上限就是替代的圍欄。
- **已知缺口(開放):** ① 核可時還不知道 AI 會傳什麼參數,核可的是「為了什麼目的用哪幾個工具」,不是每次呼叫的內容。② 只有一位管理員的安裝,沒有人能核可管理員自己的申請(刻意:自我核可就是沒有核可)。③ 公佈欄的核可卡標題是「n8n 修改申請:<連接>」,但確認對話框(`cfApprove`)仍顯示「/名稱」格式。④ `list_credentials` 與 agent 類工具雖然 n8n 標示唯讀,仍算寫入(會洩漏憑證名稱 / 跑別的 agent),示範用不需要。⑤ 社群版沒有 MCP 的功能清單區塊(顧問包的 `functionSources` 仍會帶來)。⑥ n8n 要讓某個流程可被 MCP 找到,得在 n8n 裡把流程設成「可由 MCP 使用」;Portal 看不到也改不了這個旗標。⑦ 顧問包裡舊的 `n8n.test.mjs`(對模擬 n8n 的整合測試)還用舊的 `/admin/n8n/mcp` 路由,該測試本來就不在 `scripts/test.sh` 裡跑。
- **實跑(n8n 2.44.6 + 腳本化的模型,真的 pi MCP 路徑)發現的三件事,單元測試都看不到:** ① 新對話的**第一則**訊息找不到 MCP 工具(`Tool mcp__n8n_live__search_workflows not found`),第二則才有:pi 的 MCP 擴充是背景連線,我們在 `session_start` 登記後立刻就送出了第一次模型請求。修:`before_agent_start` 等到每個登記的伺服器提供出至少一個工具(每次登記只等一次、最多 8 秒,n8n 掛了只慢第一次)。② pi 在 `tool_call` 事件**之前**就驗證參數,所以參數不合 schema 的寫入呼叫根本到不了我們的閘門(結果一樣沒碰到 n8n,但稽核不會有 `needs_approval`);測寫入閘門要用合法參數。③ n8n 的 `tools/list` 比顧問包舊清單多很多(50 個,含 agent、資料表、憑證工具),`execute_workflow` 現在必須帶 `executionMode`;唯讀清單改成取自實際回傳(每個工具都帶 `readOnlyHint`)。還沒做的實跑:模型是腳本化的(`mock-v1`),沒有用真的 LLM 看它會不會自己想到先 `n8n_request_write`——提示詞只靠工具說明與被擋時的回覆,這是開放缺口。
- **預設工具清單縮小。** 舊的預設含 `execute_workflow`;現在預設只有四個讀取工具,`execute_workflow` 屬於寫入。已存在的連接列保留它們自己的清單(不改使用者存的東西),但執行工具現在多一道核可。

## 社群版:填表工具(feat/ce-n8nmcp,2026-11-15)

Q2(Founder):「直接請學生提供相關資料,由 AI Agent 填入,不要叫 n8n 處理。」成員的 AI 沒有 shell,所以要在 Portal 伺服器上有一個工具。

- **選 TypeScript(pdf-lib + fontkit),不選在容器裡跑現成的 Python。** 先想的是 Python:`fill_library_form.py` 已經實跑驗證過,包成子程序最快。看了 Dockerfile 才改:映像是只有 node 的 `bookworm-slim`,要加 python3、pypdf、reportlab、PyMuPDF 與一個 reportlab 吃得進的字型(Noto CJK 是 CFF 的 .ttc,reportlab 不收,所以它用的是系統的文鼎),等於在多人伺服器上多一個直譯器與一串相依,再讓它處理學生給的資料。移植並不貴,因為座標與規則本來就是資料。代價:兩份實作要對得上,所以用同一份範例(完整 / 缺欄位 / 矛盾)比對輸出,結果一致,畫面也逐格對得上。
- **欄位對照表是資料,不是每份表單一支程式。** `types.ts` 的 JSON:欄位型態(text / choice / multi / bool / date / group)、位置(從頁面左上量的點數)、格式(pattern、身分證檢查碼)、必填,以及一小組規則(requires / forbids / conflict / exactlyOne / age-matches,條件可用 `$age`)。刻意沒有運算式或程式:老師上傳的檔案不能執行東西。代價:規則語言有限,更複雜的表單要擴充規則種類(程式改動,不是老師能自己加)。
- **「不猜」是結構,不是提示詞。** `fill_form` 在伺服器端驗證:缺 → missing、格式或選項不對、互相矛盾 → errors,兩者任一不空就**不畫任何東西**,也不留檔案(測試檢查檔案數與資料列數沒變)。表單沒有的欄位名稱也拒絕,不是忽略。提示詞只是請 AI 去問使用者。放不進欄位、字型缺字也是拒絕,不會縮到看不見或畫成方框。
- **字型不隨附。** 完整的中文字型 8–20 MB,而且授權各自不同。管理員自己放 .ttf / .otf(建議思源黑體 / Noto Sans TC,SIL OFL,可內嵌於產出的 PDF)到 `forms/fonts/` 或 `TIGERAI_FORM_FONT`;**只收 TrueType(.ttf)。** 先想錯的一版:fontkit 也吃 OpenType-CFF,測試用 Noto Sans CJK 的 .otf 全部通過,就寫成「.ttf 或 .otf」。實跑才發現:CFF 子集嵌進 PDF 後,poppler 報 `Embedded font file may be invalid`、改用非嵌入字型,中文會畫錯——程式與測試都看不出來(pdf-lib 沒有錯誤,測試只檢查檔案有產出)。同一個字面存成 .ttf 就正常。所以 `fontStatus()` 看檔頭,`OTTO`(CFF)與 `ttcf`(合集)直接當作不能用,設定頁與填表都說明原因。教訓:「檔案產生了」不等於「別的檢視器開得起來」,要用第二個獨立的檢視器看過。沒字型時畫面警告、填表回 503,檢查資料仍可用。曾經用 Droid Sans Fallback 試:它**沒有拉丁字母與數字**,所以每個數字欄都被正確拒絕——這是缺字檢查有用的證據,也是文件特別寫「字型要同時有中文和英數」的原因。
- **個資只在那份 PDF 裡。** 資料庫與稽核只記表單、結果、缺幾項,沒有值(測試用身分證字號、姓名、電話去掃整個資料庫與稽核)。PDF 600 權限、預設 30 天後刪。下載:本人、學生是「直接成員」的部門的主管、管理員;其他人 404。
- **新北館表單包不放公開 repo。** 館方的表單沒有授權聲明(準備報告),所以 PDF 與對照表放在 learning-agent 教材資料夾(`q2-library/form-package/`),老師自己匯入;公開樹的測試用自己畫的虛構表單。
- **已知缺口(開放):** ① `consent_read` 這類「本人已閱讀」是一個布林值:伺服器分不出是本人確認還是 AI 代填 true;只靠提示詞與表單欄位的說明要求 AI 不得代為同意。要真的擋,得做成本人在畫面按一下的確認。② 老師拿不到「某班學生填了哪些」的清單,只能在有連結時下載(沒有列表頁)。③ 只輸出對照表指定的欄位與頁面;第 2 頁(個資告知)原樣帶過。④ 館方換版時座標要重對,對照表沒有版本比對。⑤ 沒有填好後的預覽圖;學生要自己開 PDF 看。⑥ 沒有批次(同一份資料多人)。⑦ 規則裡的年齡與學歷等常識是我們依常識設的,上課前要跟老師對一次。

## 整合 1.1.0-ce(feat/ce-school-v2,2026-11-15)

- **基底 feat/ce-school,依序併入** feat/ce-register-approve(乾淨)、feat/ce-web-slides、feat/ce-n8nmcp。三條都從同一個 commit 分出,所以衝突只在「兩邊各加一行」的地方,全部兩邊都留:
  - `accounts/audit-text.ts`:註冊核准的標籤(register-approve 版本)加上 web.* / slides.* 標籤;web-slides 版本的 `account.self_register` 等舊字串捨棄,因為核准流程已改寫那幾個動作。
  - `adapter/index.ts`:四個擴充(web、slides、mcp、forms)都註冊,兩條回傳路徑都要加,否則排除工具的路徑會漏掉 mcp/forms。
  - `ui/layout.ts`、`SettingsOverlay.tsx`:分頁 web、connectors、forms 都留。`ui/Bulletin.tsx`:核可項目型別同時有 `kind?`(n8n 寫入標題)和 `register` 項目。`tests/ui-slots.test.mjs`:i18n 來源檔清單是兩邊的聯集。
  - MEMBER_DENIED_TOOLS 的變動(web-slides 拿掉 `web_*` 整批封鎖)自動合併,沒有衝突;n8nmcp 沒有再動它。
  - package.json:兩邊的新依賴(pdf-lib、@pdf-lib/fontkit、jszip)並存。
- **n8n 寫入核可仍是「非申請人的管理員」**(Founder 取消「老師也能核」的改動):這個決定維持 n8nmcp 分支的設計,沒有加老師核准路徑。
- **核可確認視窗的「/名稱」**:共用一個視窗給所有工單種類,只有 `prompt_share` 的名稱是斜線指令;其他種類改用 `cfApproveN`/`cfRejectN`。
- **填表字型踩到的坑**:Google Fonts 的 Noto Sans TC 只有可變字型;直接給 pdf-lib 會漏字(實為 fontkit 子集化 bug,三種 Google CJK 字型都重現,UMing 正常)。解法在安裝端預先做成靜態、子集化的小字型,render 對 8 MB 以下字型整個嵌入。**未解**:輸出 PDF 約 3 MB;若要改用更大字型仍走舊的子集化路徑,可能漏字。
- 本 repo 沒有 DEVLOG.md / LESSONS_LEARNED.md / SDD.md(那是 pi-web-tw 的文件規約),所以這裡只更新 README、COMMUNITY_EDITION、DECISIONS。

## 精靈分級與訊息分析 (feat/ce-aspects,2026-11-15,Founder 核准)

- **每日摘要只預設「記錄 + 提醒」,工作週報預設五面向全開。** 為什麼:① 疲勞(每天五段,人很快就不看);② 資料量(每天只有一天的訊息,監督、稽核要的是「一段時間沒動」,週報看一週才有意義);③ 地端模型的負擔(每天每個頻道一次呼叫要越短越好;提醒由程式算,模型只寫記錄)。代價:急件專案每天想看監督,要自己勾(設定視窗有這個勾選)。
- **每支精靈各有自己的五個勾選,而不是「每日只有兩個」。** 一開始的想法是把每日摘要的面向寫死(少一個設定);Founder 改成都留五個、只讓預設不同。所以設定從頻道共用一組(`aspect:<面向>`)變成每支一組(`aspect:daily:<面向>` / `aspect:weekly:<面向>`);舊資料庫的共用列在使用者改之前繼續對兩支生效,所以升級不會偷偷改掉既有頻道的行為。「回到建議預設」是**刪列**(不是寫入預設值),之後建議預設改了會跟著改。
- **提醒全由程式產生,包括「問了超過 2 天沒人回」。** 這種提醒原本只有監督版(給主管);每日摘要只有提醒時,問的人不會知道自己的問題沒人理,所以加上「你問的…已超過 N 天沒有人回覆,可以再問一次或指定一個人」,收件人是**提問的人**(程式不知道誰該回答,不猜)。承諾沒做到、交辦單逾期/快到期收件人是欠事的人。
- **沒有新訊息但有提醒時,每日摘要照送,不呼叫模型。** 否則交辦單逾期的那天剛好沒人說話,提醒就沒了。
- **工作週報的投影片由程式組,不叫模型做 `make_slides`。** `make_slides` 是給對話用的工具(模型決定有幾頁、寫什麼);週報的內容已經是檢查過、帶出處的項目,再交給模型排版只會多一個編造的機會,也多一次模型負擔。所以直接用同一套零件(`buildPptx` → `convertToPdf` → `saveDeck`)。每一頁的每個重點後面接〔#訊息編號〕,表格頁寫「出處:交辦單」。
- **主管版報告是「每位主管一份個人檔」。** 頻道存放的投影片全體成員都能下載,所以監督/稽核不能放進去;個人檔只有本人打得開(`slides/store.ts` 既有規則),連結用一則私下的項目送到公佈欄個人區。代價:N 位主管做 N 次(內容相同);主管很少,不值得為此做新的權限模型。
- **報告做不成不讓整支精靈失敗。** 週報的文字貼文已經完成;投影片或轉檔失敗只在貼文裡說明,沒有轉檔服務就只給 PowerPoint(與 `make_slides` 一致)。
- **訊息分析是同一個引擎的另一種輸入(`kinds/adhoc.ts`),不是另一套流程。** 所以分送、出處檢查、草稿確認、稽核、失敗卡片全部一樣。「一般成員勾監督」的答案是:允許勾,結果走原本的路(主管與建立者),不是拒絕——拒絕會讓成員以為功能壞了,也會讓「誰勾了監督」變成一個訊號;視窗直接寫明他自己收不到。
- **`@AI` 的解讀在程式裡,用關鍵字。** 判斷「這句是分析請求」要有:面向名字加時間詞,或分析動詞(分析/整理/檢查/看…)加其中之一。只有面向名字沒有動詞或時間(「提醒我明天開會」)一律不算,由一般 @AI 回答。說得不清楚時回問,不猜時間範圍。
- **每頻道 5 分鐘一次:** 擋的是同一個頻道連按,不是全站;全站的負擔由既有的 AI 名額(`TIGERAI_AI_RUN_CONCURRENCY`)擋。找不到訊息而「略過」的不算一次,否則空頻道按一下就要等 5 分鐘。
- **命名:** 每日摘要、工作週報(原「週報」)、訊息分析(原「AI 分析」)只改顯示名稱;內部代號 `daily`、`weekly`、`adhoc` 與資料表不動,舊設定照常讀。
- **已知缺口(照實記):** ① 提醒用的交辦單是「頻道成員名下有期限的未完成交辦單」(既有行為),不限於連到這個頻道的那些,所以同一個人的逾期單會出現在他所在的每個頻道的每日摘要裡(去重規則讓同一件事不會重複送)。② 訊息分析的時間範圍只限制「讀哪些訊息」;提醒/監督的「程式事實」仍看最近 30 天,不受範圍限制。③ 自訂範圍的日期以公司時區的日界計算。④ 主管版投影片沒有「撤回」;主管被移出部門後,舊檔仍在他的個人區。

## 示範實跑後的修正(fix/ce-demo-findings,2026-11-15)

- **個人連線輸出上限。** 先想的是「把 4096 改大」;但 4096 其實是寫死而且連線沒有任何欄位能調,思考型模型的思考也吃同一個額度,所以改成每組連線三個欄位(輸出、上下文、思考型),並讓實際輸出上限不超過上下文一半。管理員連線檢查過:預設 32768 且可逐模型覆寫,沒有同樣的問題,不改。
- **迴圈保護放在緩衝層的 `tool_call` / `tool_result` 掛鉤,不放在 `agent_before_settle`。** 卡住的模型不會走到 settle(它一直在呼叫工具),所以 settle 掛鉤看不到。做法是擋下呼叫、`ctx.abort()`、寫一則 `tigerai:loop-guard` 訊息。空呼叫的判斷是「參數完全沒有內容」;合法的無參數工具(如 `ls`)連續 5 次也會被擋,這是刻意的取捨。**開放缺口:** 上限是固定值(可用環境變數調),沒有依模型或任務調整。
- **會議摘要:先容忍、再重問一次、仍不行才報錯。** 容忍不是亂猜:仍然每一項都要有逐字稿出處,沒出處照舊丟掉;重問時把模型自己上一次的回答貼回去並要求只輸出 JSON。只重問一次,避免一直占用共用模型。
- **角色 / 應用開新對話保留個人模型。** 先想錯的版本:在 `/api/agent/new` 路徑上比較「請求有沒有帶模型」。推翻:新的輸入框已經忘了選擇,請求根本不帶模型,伺服器分不出「沒選」和「忘了」。所以改成閘門記住人最後一次點名的個人模型(新對話或 `set_model`;選公用模型就清掉),角色/應用開新對話與模型清單的預設都讀它;角色自己指定模型才覆蓋,頻道不讀。代價:成員的選單只有自己的連線,要回公用預設只能從「+ → 新對話」(會清掉記住的選擇)。**開放缺口:** 上游自己的「新對話」鍵(Ctrl+Alt+N)不清掉。
- **交辦單狀態在 API 邊界轉換,不改資料庫。** 先想改資料庫欄位值;但 `status='accepted'` 同時被排程、計數與核可邏輯使用,改值風險大。所以只在輸出時轉成 `running`/`review`,兩個頁面同步改讀。
- **通關密語人數**:老師就是管理員(一台一位老師),所以人數只算學生。


## 1.1.0-ce 修訂(feat/ce-v11,2026-11-15,Founder 決定)

**1. 維修帳號:旗標,不是角色。** 一開始想加第三個 role(`vendor`):錯在 `users.role` 有 `CHECK (role IN ('admin','member'))`,SQLite 不能改 CHECK,要重建整張表,而 `admin` 這個字串散在上游鉤子與幾十處程式裡。改成 `role='admin'` + `is_vendor=1`,再用**預設拒絕的白名單**(`accounts/vendor-policy.ts`,零 import)在 proxy 與 API 分派各擋一次——白名單比黑名單好,因為以後新增的任何路由對維修帳號自動是關的。被推翻的想法:「讓維修帳號是 member 再個別放行系統頁」——系統頁(模型連線、n8n 連接)的路由本來就掛在 admin 之下,member 要全部重做;而且 member 沒有「看系統狀態」的路徑。取捨:維修帳號在資料庫是 admin,所以所有「選管理員」的地方(最後一位管理員、核可通知、無主管時的備援)都要排除它——已逐一處理(`activeAdminCount`、`notifyApprovers`、`headsOf`),**新增這類查詢時要記得 `is_vendor=0`**(已知風險)。維修帳號只能被客戶停用,不能被客戶重設密碼(重設等於客戶能取得它的登入,而它的稽核會被誤認為虎智做的)。
**已知缺口:**① 上游 `/api/*` 全部對維修帳號 403,所以側邊欄的對話列表會是空的/報錯,頁面外觀沒特別為它做(它只用設定頁);② 白名單裡 `/api/models`(模型清單,不含個人資料)開放,若將來要更嚴再收。

**2. 姓名不唯一、電子郵件唯一;不加學號欄。** 原本打算加選填的 `employee_id`,Founder 改成「姓名本身就是 學號-班級-姓名(公司:工號-部門-姓名)」:一個欄位承載身分、不用多一份要同步的資料,也少一個 org.xlsx 欄位的對應。代價:姓名不再能當 `@` 提及的唯一鍵,所以提及改成舊 Portal 的做法——在訊息文字裡找每個成員的名字(長的先比、允許空白、全形 ＠)與信箱帳號部分,同名者全部被提到(寧可多通知,不漏通知)。org agent 若為 org.xlsx 加 `employee_id`,與這裡無關,不在學校註冊畫面出現。改電子郵件要目前密碼:帳號被借用的瀏覽器不能順手把信箱換掉。

**3. n8n:只審「上架」,不審寫入。** 舊流程(AI 呼叫 `n8n_request_write` → 核可單 → 4 小時 10 次的授權)被推翻的理由:它審的是「動作」,但真正會影響別人的是「流程被分享出去」;自己建立、試跑自己的流程只影響自己,卻要每次等管理員。取捨:n8n 的存取權杖在 n8n 端無法縮小權限,所以「自己的流程」其實是靠管理員在連接上勾的工具清單來限制,不是靠核准——已知風險:被勾了 `update_workflow` 的人可以改別人的流程(n8n 端沒有擁有者概念時);稽核有 `write: true` 可追。上架的審查**永遠開著**(舊 Portal 的「不審核」選項預設就是不審,在學校不合適)。審查借用既有核可單,所以「核可人不能是申請人」由資料庫觸發器保證;管理員自己上架直接生效。「全公司」在網址表裡用群組代號 `*` 表示。**失敗經驗:**一開始考慮把「上架」做成 n8n 端的 tag 同步,但社群版只有 webhook 與 MCP、沒有 n8n API 金鑰,所以上架的內容就是「webhook 網址+說明」,由審查的管理員看過網址是否是自己的 n8n(核可單內會顯示來源網域)。

**4. @AI:照舊版決定怎麼處理。** 舊 Portal(`lib/rooms/mentions.ts`、`assistants.ts`)是三種完全不同的東西:`@AI`/`@助理`/`@agent`(含全形 ＠)= 叫一般 agent 回答、會花模型用量;`@角色名` = 叫那位 AI 角色(每個 (頻道,角色) 一個獨立對話,避免互相看到對方的職權與資料);`@某人` = 只標記未讀、不執行任何東西。**沒有**「從一句話判斷是不是要開背景工作」這件事——寫在檔頭的理由是:把一段文字誤判成 `@AI` 會平白花掉客戶的 token。新版在 `@AI` 後面加了「用監督和提醒看最近三天」的自然語言解讀(關鍵字,不靠模型),會直接啟動一支會寫進別人鈴鐺的背景精靈,風險比舊版高;舊做法不允許這種自動升級,所以取消,訊息分析只從頻道選單啟動(要勾面向、選範圍,是明確動作)。對 `@AI` 的解析補回舊版的 `@助理`、`@agent` 與全形 ＠。舊版的 `@AI全部`(完整回顧、不管游標)這裡沒有移植(新版每次餵最近幾則,沒有游標);**未決。**

**5. 閒置登出:兩個時鐘。** 只靠瀏覽器計時,關掉分頁或休眠的電腦不會登出;只靠伺服器,頁面不知道要跳走。所以頁面回報「真的有人操作」(輪詢不算,否則開著的分頁永遠不會到期),伺服器自己記 `last_input`、逾時拒絕並讓 `token_version` 加一(其他瀏覽器也登出)。被推翻的想法:用既有的 `last_seen`(每個請求都更新)——但鈴鐺每隔幾秒輪詢,等於永遠不閒置。取捨:長時間等 AI 回答而沒有碰滑鼠的人,30 分鐘後也會被登出(管理員可調長或關閉)。

**6. 監督:交給「他自己的主管」。** 舊做法把監督送給頻道建立者與每個有成員在頻道的單位主管,在跨班頻道裡導師會讀到別班學生的事。監督是關於一個人的事,所以屬於那個人所屬單位的主管。同一人同一出處不重複(用「給他的提醒」的去重鍵,而不是另開一張表)。交辦單的申請人與承辦人都設為那位主管本人(`source='ai'`):不讓頻道建立者變成申請人、也不需要另一個人確認。限制:被點名的人由「事實的 ownerId」或「AI 引用的第一則人類訊息的作者」決定;AI 一條監督引用多人的訊息時只看第一則——**已知缺口**。

**7. 永久刪除與稽核:唯一允許改稽核表的程式。** 稽核表有 append-only 觸發器,不能改。要清掉識別欄位只有兩條路:拿掉觸發器,或在寫入時就不寫識別資料。後者救不了已經寫好的列。所以 `scrubAudit` 是唯一會 UPDATE audit 的程式:同一個交易內 `DROP TRIGGER` → 只改符合者的 `actor_id`/`extra` → 還原觸發器(SQLite 的 DDL 可回滾,失敗會一起還原),最後再驗證觸發器在不在。頻道訊息表同理(`rm_no_update`)。留下的是「某管理員於某時刻刪了編號 n」。**未處理**:交辦單、公告、核可單的標題/內文若含個資不會被清(預覽畫面誠實列為「保留」);會議的音檔(若有)不刪,只刪資料列。刪除前先刪外部檔案(對話、個人目錄、金鑰),任何一步失敗帳號還在、可重做。

**8. 使用者紀錄合併。** 到勤頁(時段、遲到、AI 摘要)被移除:Founder 不要獨立的到勤頁;「提供成果與建議,不介入人的判斷」。停留時間用既有的每分鐘足跡,不另建表:相鄰間隔 ≤10 分鐘才累加,否則只算那一段的第一分鐘。誠實的限制:足跡來自「任何已登入的請求」,所以鈴鐺輪詢也算——與閒置登出配合,開著不動的分頁最多多算 30 分鐘。

**9. 節流:每個鍵各一份。** 原本全站一個計數器,一個學生打錯兩次全班等。改成每個帳號一份、每個班一份(每小時人數),全站天花板設得遠高於一班的行為(登入失敗 300/5 分、密語錯誤 200/10 分),只為擋輪流換鍵的亂猜。沒有 IP 可用(Next 16 路由沒有 socket 位址,`x-forwarded-for` 可偽造)是舊版就有的限制,這裡沒變。記憶體中的鍵表有上限(5000)與 5 分鐘遺忘。

**10. 封存。** 「頻道刪除改成封存」是既有決定;這裡的封存對象是班級:關閉(`closed_at`)而不是刪除,所以不會被 30 天清除。哪些頻道屬於班級:目前資料庫沒有「頻道屬於哪個單位」(org 分支在做),所以用成員判斷——除管理員外所有成員都在這個班的頻道才關,跨班不動。**待 org 分支合併後改用頻道所屬單位。**

**11/12/13.** 沒有人數上限(沒東西要移除,測試固定);安裝 SOP v0.2 與 kit 範例檔(預設管理員 tiger.ai.tw@gmail.com、`TIGERAI_VENDOR_EMAIL`);支援聯絡行用純文字(不放連結追蹤)。

**合併給 org 分支的注意:** ① `accounts/service.ts` 的 `createUser`/`updateUser`/`PUBLIC_COLS` 兩邊都動過,合併時保留兩邊;② 我沒有加 `employee_id` 欄,`db/store.ts` 的 ALTER 清單只有 `is_vendor`、`archived_at`、`last_input`;③ `listGroups()` 沒動,封存狀態由 `archivedMap()` 另外合併;④ 任何新增「選管理員」的查詢都要排除 `is_vendor=1`。

## 社群版:組織、目錄與人員異動(feat/ce-org,2026-11-15)

依《社群版定案 v1.0》第三節(決定 1–15)與《目錄與人員異動設計 v0.2》實作。API 與對應表見 `API-org.md`。

### 為什麼照舊版(pi-web-tw / Agent Portal)的組織模型
舊版的組織表是客戶實際用過的:單位樹、權限不繼承、一人可兼屬、員編、主管是單位上的名單、org.xlsx 一檔三表、離職單位保留、預覽加摘要比對。社群版原本自己寫了一套較簡單的版本(`unit`/`manager` 欄、`keep` 動作、沒有匯出、沒有摘要比對),結果有三個缺陷,這次一併修正:

1. **離職會拔掉所有單位關係**(舊版是保留)。後果:主管看不到離職者的紀錄(使用者紀錄靠單位找人),稽核與交接也不知道他原本在哪。現在 `leave` 只停用帳號,單位保留;不能被「新加進」單位,但原本的連結不動。
2. **管理員刪頻道 30 天後 `purgeExpired` 真的刪訊息與資料夾**,與「永久保留」(決定 6、10)衝突,而且是惰性清除:有人讀頻道就可能觸發,沒有人知道、沒有人按。現在刪除＝封存,**沒有任何自動刪除**;真的清除只剩管理員在「已封存頻道」手動永久刪除,雙重確認(旗標+輸入頻道名稱),稽核寫是誰刪的、刪了幾則訊息。
3. **離職沒有交接**:頻道擁有者離職後沒人能管成員(擁有者不能被移出)、個人 AI 角色與交辦單沒人接。現在離職是一個動作(見下)。

### 離職交接(決定 5、7、11、12、13)
- 一個動作:停用帳號(憑證版本 +1)、單位保留、逐項交接、接手人唯讀。`updateUser(status:disabled)` 仍可用(給程式用),它也會記 `left_at`、停用金鑰,但不交接;畫面上的「停用」按鈕改成「離職」視窗,**先列名下有什麼再做**。
- 交接項目:頻道(只換擁有者,成員不變;接手人若不是成員會被加進去,因為打不開頻道的擁有者沒有意義;**頻道的精靈排程跟著轉,但保持停用**)、個人 AI 角色(換擁有者)、未完成的交辦單與分享申請(逐筆「轉給接手人」或「保留」,已完成的不碰)。個人對話與金鑰不轉。
- **接手人要不要指定(決定 12)**:名下有東西才要;沒有就不要求。**沒人決定的頻道由管理員接手(決定 13)**,稽核 `member.handover_room` 記 `admin_fallback`。org.xlsx 的 `leave` 沒有接手人欄,所以名下的頻道一律由匯入的管理員接手,並給 `leave_owns` 警告;角色與交辦單維持原狀,等管理員到「成員」逐一交接。
- **接手人可以讀、不能改(決定 11,與 v0.2 的建議相反)**:`handover_reads(leaver, successor)`。使用者紀錄的 `visibleTargets` 把這些人併進去、`requireUse` 放行;目錄樹的 `viewReason` 回 `handover`。沒有任何寫入路由(測試確認 POST/DELETE 都 404);每次查看寫稽核(`scope: handover`)。**復職會結束接手人的讀取權**:人回來了,對話就是他自己的。走過的彎路:v0.2 建議預設不可讀、走匯出,理由是對話可能與工作無關——Founder 的取捨是「接手人要能接得上」,隱私靠「唯讀+每次稽核+員工在設定頁固定被告知」處理。
- **個人金鑰(決定 5)**:`provider/leaver-keys.ts`。離職當下 `connections.json` 全部 `enabled:false`(記下原本哪些是開的),金鑰檔留 30 天;排程(`schedulerPass`)與管理頁讀取時 `sweepLeaverKeys` 刪 `key-*`,其他全部保留。30 天內復職會還原;超過後復職,連線維持關閉,稽核寫 `keys_gone`。這個模組刻意不 import `accounts/service`(後者呼叫它),也不讀金鑰內容。
- 為什麼不是「離職時直接刪金鑰」:管理員按錯、或人很快回任,金鑰是別人的東西,回不來。為什麼不是「永遠留著」:金鑰是憑證,不是紀錄。

### 目錄(決定 1、2、4、6)
- **檔案跟著東西走,不跟著職位走**;資料夾用內部代號、永不改名,畫面的名稱與樹即時算(`directory/map.ts`、`tree.ts`)。換部門、改名、改上層、離職都不搬一個檔案。走過的彎路:最初考慮把單位名稱做進路徑(好讀),但舊版的教訓是路徑一變,對話與排程裡記的路徑全斷。
- 頻道的 `unit_id` 是**顯示用標籤**(NULL＝跨部門頻道),不影響誰能開頻道;舊版頻道根本不屬於單位,所以這是新設計。`is_unit_default=1` 的是單位自己的頻道,換部門時自動進出,其餘歸在單位底下的是專案頻道。**單位不會自動建立部門頻道**(不替客戶開他們沒要的頻道);由管理員在頻道設定「歸到單位」並勾「部門頻道」。
- 閱覽只讀、全在伺服器判斷。限制:符號連結一律不跟隨(保留的唯一檢查是 lstat 逐段);檔案 > 20 MB 只能下載;文字預覽上限 1 MB。HTML 閱讀畫面用既有 Markdown 元件顯示 .md(來源連結可點);PDF 以瀏覽器內建檢視器開,其他類型一律沙箱+`nosniff`。
- 匯出:Markdown 依標題切成投影片(內容是什麼、投影片就是什麼,不做「聰明摘要」),用 `make_slides` 的 pptx 產生器,PDF 走既有 Gotenberg。已知缺口:表格會被當成一行行文字、圖片不帶進簡報。
- 單位可改名、改上層;刪中間層時子單位與頻道接到祖父(舊版 `deleteGroup` 的行為是子單位變最上層,會讓整棵子樹從目錄上掉到最上面)。

### 換部門(決定 4)
- 整批取代單位連結(`units` 欄語意),**個人目錄不動**;單位的部門頻道自動進出(擁有者例外:留著,要交接是另一件事);專案頻道保留,每筆進 `unit_change_items`(預設保留,直到舊單位主管或管理員決定移出/保留);名下交辦單逐筆「轉給某人」或保留。
- 已離職的人不能換部門(409 `left_user`)——要先復職。
- 沒做:舊主管的待辦沒有鈴鐺通知(只在「使用者紀錄」頁看得到)。**開放缺口**。

### org.xlsx(決定 8、9、15)
- 格式照舊版:`units`(name、parent、description、managers、confirmers)、`members`(action、email、employeeId、name、role、status、units)、`lists`。空白＝不改、`-`＝清空;`units` 欄整批取代;`hire` 重複不壞;`leave` 單位保留;表外的人與單位不動;下拉只是方便,伺服器逐格再驗;拒絕公式。`confirmers` 欄預留、必須留空(填了只給警告並忽略);**不帶 allowedModels、能力欄**。`status` 只在匯出時顯示、匯入忽略(它是現況,不是意圖;舊版第一版被這個坑過)。
- **預覽＝在交易裡真的跑一次再復原**,不是另寫一個計畫器。舊版自己承認「規則在 planner 重寫了一份」是缺口,匯入成了第三個入口;這樣匯入直接呼叫 `createUser` / `updateUser` / `updateGroup` / `applyUnitChange` / `leaveUser`,規則只有一份。代價:預覽會暫時真的寫入資料庫再復原,所以檔案系統的副作用(個人金鑰)用 `withKeysDryRun` 擋掉;建立新帳號會留下一個空的使用者資料夾(無害,已記下)。
- 摘要比對:`digest = sha256(檔案雜湊 + 變更清單)`;套用在同一個交易裡重算,不符就整個復原回 409。表示「你看過的才會被套用」,連資料庫在預覽之後被別人改過都擋。
- 巢狀交易:`inTransaction` 改成可巢狀(外層真交易、內層 SAVEPOINT),每一列在自己的 savepoint 裡跑,壞的一列不留半個變更,其他列仍會被檢查(所以預覽可以一次列出全部錯誤)。
- 為什麼沒有用 exceljs:規格寫 exceljs,但映像與依賴鎖檔要多一個套件、要連網安裝;JSZip 本來就是依賴(讀檔、簡報都用),寫一個只有「文字格、粗體表頭、欄寬、凍結列、下拉」的小寫檔器(`org/xlsx-write.ts`)就夠。輸出的是標準 OOXML 與資料驗證,Excel / LibreOffice 都能開。**如果日後需要樣式更多的檔案,再換 exceljs。**
- 沒做(社群版範圍外):單位確認人名單、主管送「調整建議」由管理員核准(決定 8、14)。

### 沒有解決、要下一個人知道
- 離職的 `leave_owns` 只警告:org.xlsx 離職的人名下角色與交辦單不會自動轉。
- 目錄樹沒有搜尋、沒有排序切換、沒有拖放;「全公司/公告」是一個普通資料夾,公告資料表(`announcements`)還沒有寫成檔案進去。
- 精靈輸出改寫 MD 檔放到頻道目錄的部分由 feat/ce-aspects 負責,合併時改用 `directory/map.ts`;在那之前目錄裡看得到的只有已經在這些資料夾裡的檔案。
- 用 `TIGERAI_ENABLED≠1` 啟動時這一切不存在(原版 pi-web)。

## 1.1.0-ce release merge (feat/ce-v11 + feat/ce-org)

- **Class archive follows the channel -> unit link.** v11 first guessed "the class's channels" from who was a member (every non-admin member in the class). The org branch added the explicit link (`rooms.unit_id`), so `classOnlyRooms()` now closes exactly the open channels filed under the class. Channels filed under another unit or none (跨部門頻道) keep running. Trade-off: a channel nobody filed under the class is not closed by the archive; the 目錄 shows where each channel is filed.
- **employee_id stays, but only for org.xlsx.** It is an optional column the import/export reads and writes; the school screens (users table, registration) do not show it. A display name is no longer unique (v11), the e-mail is the one unique login.
- **到勤與使用 stays removed.** org's branch still had the tab and route; v11 had removed them on purpose, so the merge keeps v11.
- **Wizard outputs are also Markdown files** (`wizards/files.ts`): the channel-visible part of 每日摘要 / 工作週報 / 訊息分析 goes to `channelFolder(room, sub)`, 提醒 to the person's `給我的提醒`, 監督 and 稽核 to `給我的監督與稽核` (only the person's folder, never the channel's). Paths come only from `directory/map.ts`. The database stays the source of truth; a failed file write never fails a run. Open gap: files are appended/written, never pruned when an item is later dismissed.
- **The maintenance account is never picked as a successor or new owner** (handover, 換部門), and cannot itself be handed over or disabled that way.
- **Dead end:** the purge preview counted `leaver.json` (written next to the keys when an account is disabled) as a second personal key; it now counts only `key-*` files.

## 1.1.2-ce (feat/ce-v12)

- **Mutual fallback, default on.** The first reading was "a failed personal connection must not fall back to the public model" (switch default off). The Founder reversed it: a person's own conversations treat the two lists as backups of each other. Order matters: a public failure goes through the whole public chain first, then to the person's own connections; a personal failure goes to the person's other connections and then the public list. The switch turns it off; with it off a personal failure ends in a fixed notice (`PERSONAL_DOWN_NOTICE`) instead of a silent substitution. Rooms and automations have no owner, so `connectionsForOwner` returns the public list unchanged: nobody's key is spent on a channel's behalf. Dead end: the existing test pinned "a public failure never lands on a personal key"; it now pins the new order, with the off-switch case beside it.
- **Login failure audit.** The audit row kept the first 120 characters of the account field; people type passwords there. Now a known e-mail is kept (needed so a later 永久刪除 can scrub the person) and anything else becomes `account: unknown` plus a keyed 8-hex tag, so repeated tries are still correlated without the text being recoverable. A plain unsalted hash was rejected: short passwords can be guessed offline from 8 hex of SHA-256.
- **Own skills: folder per person, sharing is the administrator's.** The reused part is the 複製成我的 folder (`my-skills`, delivered by `resources_discover`). The 上架 flow for n8n workflows turned out to be a reviewed work order bound to a connector; a skill needs only "read the text, then publish", so the queue is a small list (`tg_settings: skills.submitted`) and publishing is a copy. Editing withdraws a submission so the reviewed text is the shared text. Unit sharing is a folder per unit delivered to that unit's members; it follows memberships at the start of each conversation. Skills carry no tool or permission field by construction, and the tests assert that.
- **Open:** the personal-skill name is the folder name (`my-…`); a Chinese-only title becomes `my-skill-<hash>`, readable in the UI through the `title` field but not in `/skill:` commands. A unit skill shared under the same name as a company skill is shown twice in the list.


## 安全審查修補(fix/ce-security,2026-11-16;審查 release-1.1-review_v0.1)

每一項:決定與理由 / 一度以為對、後來推翻的 / 實作時真的壞掉的 / 還沒解決的。

### H1 金鑰只送到它被存的位址
- **決定**:任何「測試」或「儲存」只要位址(或搜尋供應商)和已存的不同,就必須重新輸入金鑰(`key_required`),對所有角色一體適用(`accounts/secret-dest.ts`);維修帳號對 models / web / asr / connectors 只剩 `GET`(連 `GET connectors/<id>/workflows` 也擋)。
- **為什麼不只擋維修帳號**:管理員自己的帳號被盜或頁面被竄改,結果相同。規則放在「金鑰出門的那一刻」,不放在「誰在按」。
- **一度以為對的**:測試連線「用表單裡的位址 + 已存金鑰」是方便(改網址前先試)。這個方便就是洞。代價:管理員改網址要多打一次金鑰。
- **實作時壞掉的**:`ce-model` 兩個既有測試是「只改 baseUrl 不帶金鑰」,現在依規則失敗,測試改成帶金鑰(不是放寬規則)。
- **未解**:converter(轉檔服務)網址沒有金鑰,但投影片內容會被 POST 過去 —— 靠維修帳號唯讀擋住,管理員自己改網址不受限(管理員本來就是信任邊界)。維修帳號被擋的嘗試由 gate 的 `vendorDenied` 寫稽核;被允許的 GET 不逐筆稽核。

### H2 永久刪除要真的刪
- **決定**:purge 清單補上會議目錄(逐字稿、錄音)與未完成上傳、`slides-personal/<id>`、`prompt-cache/<id>`、交接紀錄、頻道簡報的製作人欄位(簡報留在頻道,只清掉人)、行程環境變數 `TIGERAI_PKEY_*`;預覽逐項列出。
- **一度以為對的**:「DELETE 資料列 = 刪除」。SQLite 把刪掉的列留在 free page 與 WAL,所以改成 `secure_delete` + `VACUUM` + `wal_checkpoint(TRUNCATE)`(只在 purge 期間)。測試掃整個 data / agent / workspace 目錄與每張表。
- **實作時壞掉的**:第一版測試只掃檔案路徑,通過;改掃檔案「內容」才發現 `tigerai.db-wal` 與 db 本身還有舊列。
- **未解**:`VACUUM` 在有讀取連線時會失敗(已 try/catch,舊頁之後被覆寫);備份、`~/.pi` 之外的 shell 歷史、作業系統層的檔案系統日誌不在範圍。對頻道內他人的對話中提到此人的文字不處理(屬他人內容)。

### H3 n8n:best effort 的擁有權
- **決定**(Founder:「原則上當然只能改自己建的,不過社群版管不了大家亂改」):Portal 自己記「誰用 Portal 建了哪條流程」(`n8n_workflow_owners`),非管理員只能 update/archive/publish/execute 自己的流程;管理員可標「分享給大家只能執行」或指定擁有者;建立新流程不限。這一輪若讀過 `web_fetch`/`web_search`,任何 n8n 變更(含建立)都先被擋,使用者再說一句話(新一輪)才放行。
- **為什麼不用 n8n 標籤(`oap:owner:`)**:標籤要再打一次 n8n 寫入、會被同一把 token 任意改掉,而且 MCP 沒有「加標籤」的保證;Portal 端表格至少不會被 n8n 使用者動到。代價:沒經過 Portal 建立的流程沒有擁有者(只有管理員能動,或由管理員指派)。
- **為什麼不是真的權限**:社群版共用一把 n8n token。能開 n8n 畫面或 API 的人仍可改任何東西。商業版的 API Proxy(身分 + ACL)才是真的做法。這個限制必須在手冊與 README 明講,否則會被讀成「已隔離」。
- **一度以為對的**:「寫入工具名單固定,看工具名稱就能判斷」。n8n 的 `create_*` 有些要帶 workflowId,所以規則是「看有沒有指名既有流程」,不是看名字;指不出目標的非建立類寫入對非管理員一律拒絕(fail closed)。
- **未解**:建立工具回覆若不含流程 id,建立者暫時改不了自己的流程(稽核 `mcp.owner_unknown`,管理員指派);真實 n8n 回覆格式只用模擬器與猜測的欄位名(`workflowId`/`id`)驗證 —— **待在真 n8n 上確認**。「確認」是下一則使用者訊息,不是點按鈕,簡單但不是強制的雙因素。M10(上架 webhook 位址 SSRF)、M9(接手無期限)未動。

### M1/M2 註冊
- **決定**:節流 key = 帳號 + 用戶端(轉發位址+瀏覽器,有 proxy 標頭才有);全站「錯誤密語」上限只拒絕錯誤密語(先驗密語);帳號、申請單、停用狀態同一個交易。
- **一度以為對的**:用戶端 key 一律套用。測試(以及沒有 proxy 的學校)裡全班長得一樣,一個人打錯會讓全班等,正是原本要解掉的問題,所以沒有轉發位址時不套用。
- **未解**:`X-Forwarded-For` 可偽造,所以用戶端 key 只是多一層,窮舉的真正防線是密語強度(`PHRASE_MIN` 仍是 4 字,建議調高但會影響既有班級,**未改**)與全站錯誤上限;上限被灌滿後錯誤密語一律 429,但猜中的密語仍會通過(為了不鎖死全班)。

### M3/M4 web_fetch
- 單一總期限 20 秒 + 全站最多 8 個併行;位址帶長值/隨機權杖/成串文字(含 24 字以上非 ASCII)就拒絕並記 `web.fetch_blocked`(只記主機與原因,不抄內容)。
- **未解**:啟發式,短的洩漏(姓名、單號)仍可通過;沒有「只能抓使用者給過/本輪搜尋回過的網址」的白名單(審查建議,影響使用方式太大,**未做**)。

### M11/M12
- `check-public`:規則抽成模組並用假字串測;`--staged` 讀 index;`--history` 逐 commit 掃新增行;上游 5 個測試檔的私網 IP 以檔名白名單(只豁免 IP 規則)。通用 `sk-` 規則要 32 字以上,避免測試佔位字串誤報。**未做**:公網 IP 規則(版本號誤報太多)、commit 作者 email 檢查。
- `guardCatalogs()` 改在 `init()`(模組開啟時)執行。預設埠 30161 是與上游(30141)**刻意的差異**,見 README。compose 的 image 標籤改成 `${OAP_IMAGE_TAG:-1.1.1-ce}`。

### 低度項目
已修:L2(保留名 NFKC)、L3(CSV 欄位加引號)、L8(`oldestAdmin` 排除維修帳號)、L10(web_search 也算「資料不是指令」)。未修(留給 1.1.x):L1、L4、L5、L6、L7、L9、L11、L12;M5(個人連線 DNS 釘住)、M6(金鑰在環境變數)、M7(寫檔不查符號連結)、M8、M9、M10。

### 第二輪(Founder 核准的三項,2026-11-16)
- **通關密語 8 字**:新設定或更改的密語至少 8 個字(CJK 一字算 1),伺服器檢查 + 設定欄提示;已存在的舊密語照常可用,直到被改。代價:要換掉短密語的班級得自己改。窮舉的真正防線仍是全站錯誤上限。
- **web_fetch 白名單**(取代原本「未做」):只能讀(a)本對話使用者訊息裡出現過的網址,或(b)本對話 web_search 回傳的網址;其他一律拒絕並記 `web.fetch_blocked`(reason `not_in_conversation`)。比對:忽略 scheme、片段、結尾斜線,同一站的其他頁**不算**。轉址只能留在同一個可註冊網域(內建的二級後綴清單是啟發式,錯也只會更嚴)。頻道裡「@AI」的提示內含頻道訊息,所以頻道成員貼的網址也算;網頁/工具結果裡的網址不算。
  - 一度考慮「同站其他頁也放行」:搜尋結果常需往下點同站的文章,但這會讓被攻陷的網站內文直接引導 AI 去讀它自己的任意路徑與帶參數網址(與 M3 的外洩手法相同),所以不放行;使用者要貼網址。
  - 服務層 `webFetch()` 不帶 scope 時不限制(測試、日後管理工具用);AI 的 `web_fetch` 工具一律帶。**未解**:使用者訊息來自 session 檔,壓縮(compaction)後較早的網址若被摘要掉就不再算;web_search 的紀錄放在行程記憶體,重啟後要重搜。
- **待核准帳號不進全公司頻道**:註冊交易內退出頻道,核准時才加入;拒絕的永遠不在。

## 1.1.2-ce 整合後的修補(release/1.1.2-ce,2026-11-16;示範實跑發現)

十一項,逐項寫「為什麼這樣做、想錯過什麼、還缺什麼」。測試在 `tigerai/tests/ce-112-*.test.mjs`(另有改在既有測試檔裡的)。

1. **思考型連線預設輸出 40000(上限仍 65536)。** 原本想「把 16384 改大」就好;但一般模型不需要那麼大,所以只在「思考型」勾選時換預設。**明確輸入的數字從不被改**:編輯畫面只在欄位還是預設 16384 時,勾選思考型才自動變 40000。NVIDIA 預設加上 glm 模型會自動勾思考型(glm 的思考佔同一個額度)。管理員的模型連線沒有「思考型」欄位(閘道的模型一律當思考型),所以直接把預設 32768 升到 40000(仍不超過 context 的一半)。**缺口:** 管理員沒有逐連線的思考開關;模型實際會不會思考我們不知道,只靠使用者勾選。
2. **自己建立的流程可以自己啟用 / 停用。** 規則其實早就允許(`ownership.ts`:publish/unpublish 屬於「只能動自己建立的」那一類),缺的是預設工具清單與技能說明:AI 沒被告知可以用 `publish_workflow`,管理員也沒勾。現在兩個工具進預設清單、助手技能寫了怎麼用。**既有連線的清單不會自動變**(管理員勾),避免悄悄放寬。n8n 的「發佈」和 Portal 的「上架給同事」是兩件事,技能裡分開講。
3. **n8n 應用支援 GET。** n8n 的 Webhook 節點預設就是 GET,Portal 只送 POST,所以預設節點回 404。方法跟應用存在一起(`n8n_webhooks.method`,管理員表單與上架表單都有,上架單帶著它)。GET 把內容放網址參數(純量照原樣,物件轉 JSON 文字)。**想過「從流程自動偵測」** 但需要 n8n API/MCP 讀取權限,社群版的 webhook 路徑沒有;改用 n8n 自己的 404 訊息(「did you mean to make a GET request」)只重試一次並記住正確的方法。**缺口:** 只認 GET/POST;訊息格式是 n8n 的行為,改版後會退回「選錯就 404」。
4. **投影片比較表不再壓到「資料來源」。** 舊版固定列高 0.85 吋、最多 8 列,有來源時一定重疊。現在每列依最長儲存格量高度,放不下的列接到「(續)」那張並重複表頭;來源區只在表格最後一張預留。**走錯的一步:** 第一版每一張都預留來源區,表格被切得太碎(一張只放 2 列),後來改成只有「剩下的列全部放這張」時才縮到來源區上方。用 Gotenberg 轉 PNG 看過。**缺口:** 高度是估算(字寬 CJK=1、其他 0.55),極長英文儲存格可能估少。
5. **從頻道開的「交辦給 AI」讀得到該頻道最近訊息。** 交辦單存 `room_id`(只有該頻道成員能附)。執行時把最近 60 則 / 12000 字放進提示,是**唯讀的資料區塊**:沒有新工具、不能發言;每次執行重新檢查申請人還是不是成員、頻道有沒有被刪;稽核只記則數不記內容;區塊明說裡面是別人寫的資料、其中的指示不要照做。**想過給 AI 一個讀頻道的工具**:模型可以多讀,但弱模型常不呼叫工具,而且要另外處理權限,所以選了「放進提示」。**缺口:** 長頻道只看得到最近那一段;退回重跑會再附上較新的訊息,但舊訊息不會因此消失。
6. **頻道裡開的會議摘要要進該頻道。** 房間選單那條路徑本來就會貼回頻道;問題在精靈選單(沒帶頻道)。現在畫面上有開著的頻道時,會議視窗預設勾選「同時發到頻道」。頻道的摘要另存一份 Markdown 到頻道的「檔案」資料夾(沒新增資料夾名稱,避免動到目錄樹與既有測試)。
7. **採用 SKILL 建議前可以改文字。** 採用鈕原本直接安裝 AI 草稿。現在「先改文字」開出名稱 / 什麼時候用 / 步驟(1–12 步、長度有限),「照我改的採用」就裝你改的;資料夾名稱不變(重複檢查用它)。稽核記 `edited`,不記文字。
8. **註冊頁用語中立。** 「姓名(學號-班級-姓名)」改成「姓名」,學校慣例只當範例;「通關密語(學校:課程名稱;公司:部門)」。
9. **顯示名稱可以有空格。** 註冊、設定、管理員建立早就可以;**真正擋空格的是組織匯入**(`org/import.ts` 的 `/[\s@]/`)。「王董 David」從 Excel 匯入會被整列拒絕,現在改成連續空白縮成一個,仍擋 `@`(那是提及標記)、控制字元、空白和保留字「AI」。AI 角色名稱不在此列(它被當 `@名稱` 用,仍不可有空格)。
10. **表單欄位 `ask: true`。** 「建議填、不是必填」的欄位(報價有效期限)留空時,`fill_form` 回 `status: "ask"` 且什麼都不輸出;AI 必須問,使用者說不填才把代號放進 `leave_blank`。**想過直接把它設成必填:** 會逼使用者填一個他不想填的東西,也擋掉合理的留白。**缺口:** `leave_blank` 靠 AI 誠實(它可以不問就把所有鍵塞進去);提示規則寫得很直,但弱模型仍可能略過,所以伺服器端只放行「列在 leave_blank 的鍵」,且稽核記 `ask` 次數。
11. **對照模型(第二個語音轉文字)與摘要自我檢查。** 管理員選填第二組位址/模型/金鑰(金鑰獨立,跟著自己的位址,和主金鑰一樣的 H1 規則)。同一個檔案同時送兩邊,所以多等的時間約為兩者較慢的那個;主逐字稿**永遠是紀錄**,對照只決定哪些行標「待確認」(對齊後編輯距離 ≥2 且 ≥6%,或兩邊數字不同),公司術語(對照模型寫對了、主模型沒寫對;或 3 字以上差一字)也標。第二個模型壞掉不會讓會議失敗,只留一行說明。摘要的「自我檢查」是**程式檢查**不是再問一次模型:每項都有出處行、沒負責人/期限的待辦數、建立在待確認行上的項目、引用了出處行沒有的數字。**想過讓模型自評:** 弱的本地模型自評不可靠,而且多一次模型呼叫。**缺口:** 2 字術語(治具/製具)沒有第二個模型就判斷不出來;「三十天 vs 30」這類中文數字與阿拉伯數字不比對(避免誤報);對齊用視窗搜尋,兩份逐字稿順序差很多時會誤判;**實際兩個真 ASR 的時間差沒量到**(測試用固定延遲的假服務),上線後要看稽核裡的 `compareMs` / `wallMs`。
