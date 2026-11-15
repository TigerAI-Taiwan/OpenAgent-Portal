# UI slots (gen1) — 緩衝區

Goal: later UI changes (move a button, rename, reorder, hide per role, add a 功能 item) are edits to ONE file, `tigerai/ui/layout.ts`, never to upstream.

## How it works

- Upstream carries a small, fixed set of **named slots**: `<TgSlot name="..." ctx={...}>upstream element</TgSlot>` (or `useTg()` for two elements that only some roles keep). One `// TG-HOOK:Hxx` each, listed in `tigerai/adapter/hooks.json`, imported from `@/tigerai/adapter/client`.
- A slot renders what `tigerai/ui/slots.tsx` registers for it. With `TIGERAI_ENABLED` off (or `me` not loaded / signed out) it renders its upstream children: exact upstream behaviour.
- **Failure isolation:** every slot is wrapped in an error boundary. If our component throws, the error is logged and the upstream children are rendered. Never a blank screen. Not a security boundary: the server checks everything.
- `tigerai/ui/layout.ts` (no imports, loaded directly by the test) holds: `SLOTS`, `UPSTREAM_VISIBLE_TO` (upstream elements only some roles keep), `SIDEBAR_BOTTOM`, `NEW_MENU`, `SETTINGS_TABS`, `FUNCTION_SOURCES`, `PRODUCT_VERSION`, and the role helpers. Items are `{ id, icon, labelKey, roles, action }`; text is only i18n keys (`tigerai/pages/i18n.ts`, zh-TW default, English optional per browser).
- Roles: `admin` includes `head` and `member`; `head` (head of any group) includes `member`. Roles only decide what is SHOWN.

## Slots and hooks (final)

| Hook | Slot / element | Upstream file | Shows |
|---|---|---|---|
| H14 | `brand.version` | components/ChatWindow.tsx (empty conversation hero) | "TigerAI Agent Portal 1.0.0-ce" instead of "web v.. pi v.." |
| H15 | `composer.state` | components/ChatWindow.tsx (around `chatInputElement`) | disabled composer 「這段對話只能從頻道使用」 for a room's backing conversation (`GET /api/tg/sessions/:id/info`) |
| H16 | `useTg()` + `keep("composer.model")`, `keep("composer.thinking")`, `text("composer.placeholder")` | components/ChatInput.tsx (hook line + 3 edited lines) | members: no model picker, no thinking control; short placeholder |
| H17 | `composer.functions` | components/ChatInput.tsx (after the model picker) | 功能 menu: AI 角色 / n8n 應用 / 一般對話 |
| H18 | `sidebar.new` | components/SessionSidebar.tsx (the New button) | one "+" at the top left: 新對話 / 新頻道 / 新交辦單 |
| H19 | `sidebar.list.extra` | components/SessionSidebar.tsx (top of the conversations panel) | rooms as "# name" rows with unread count |
| H20 | `main.override` | components/AppShell.tsx (chat area) | the room view, laid over the chat area (upstream `MessageView` + `ChatInput`) |
| H21 | `toolbar.right` (x2: desktop, phone) | components/AppShell.tsx (top bar) | sign-out icon (tooltip 登出, in-page confirm); also hosts the settings page so it works with the sidebar closed |
| H22 | `sidebar.bottom` | components/AppShell.tsx (footer row) | icon row: 模型 (admin), 技能 (admin), 設定 (everyone) |
| H23 | `onboarding.models` | components/AppShell.tsx (empty-state hint, line 2) | hidden for non-admins: the 「開啟底部的『設定』…『模型』」 line (members cannot pick models) |
| H24 | `useTg().homeCwd` | components/SessionSidebar.tsx (first-load project selection, 3 lines) | members start in their own workspace folder, so home is the new-conversation view, never the 開始使用 steps |
| H25 | `toolbar.tabs` (3 call sites) | components/AppShell.tsx (top bar: desktop, phone inline, phone Agents button) | admins keep the tabs 完整紀錄/產生標題/Agents/系統/工具, debug and stats; members get none (the phone 「更多控制項」 button is hidden by CSS in TigerNav). Members keep only sign-out |
| H11 (existing) | `TigerNav` | components/SessionSidebar.tsx | no visible row any more; keeps the member safety-net CSS |

Cost: 12 hooks (15 call sites) in 5 upstream files (H23, H24, H25 added), 20 lines added and 5 changed (4 import lines among them). Item 4 (workspace label) needs no hook: the backend fills `projectNames` in `filterUiState`.

## What is replaced or hidden, and how

- Right-hand chat pane of the old room page: gone. Rooms open in the normal chat area (H20), one column. The old `/tg/rooms/<id>`, `/tg/account`, `/tg/prompts`, `/tg/admin` URLs redirect to `/?room=<id>` and `/?settings=<tab>`.
- Text row at the sidebar bottom: removed (TigerNav renders nothing visible). If the `sidebar.bottom` slot ever throws, the upstream footer returns, and the member CSS in TigerNav still hides Models/Skills for members.
- Model picker and thinking control for members: `keep()` is false once `me` is known to be a non-admin. While `me` is still loading it returns true (upstream), because the server refuses member model commands anyway (403 `model_locked`).
- Non-member in a room, hidden room-backing conversation: disabled composer with the reason (H20 inside the room view, H15 for the conversation).

## Add, move, rename or hide (examples)

```ts
// tigerai/ui/layout.ts — add a sidebar-bottom icon for heads and admins
SIDEBAR_BOTTOM.splice(2, 0, { id: "reports", icon: "list", labelKey: "reports", roles: ["head"], action: { kind: "settings", tab: "audit" } });
// move: reorder the array. Hide for members: change roles. Rename: edit the zh text of labelKey in tigerai/pages/i18n.ts.
// New settings tab: add an item to SETTINGS_TABS and a `case` in Section() of tigerai/ui/SettingsOverlay.tsx.
```

## Tests

`node --experimental-strip-types --test tigerai/tests/ui-slots.test.mjs` checks that every slot in layout.ts has a `TgSlot` call, every call names a known slot, every marker is in hooks.json, members see only 設定 in `sidebar.bottom` and keep no model picker. `node tigerai/tools/check-hooks.mjs` and `check-public.mjs` also run. `tigerai/tests/shots-ui.mjs` walks the pages as admin / member / head and writes screenshots plus a checklist.

## Resolved since the first cut

- First-time member: `/api/tg/me` creates the personal folder, and `filterUiState` (H05, existing hook) always lists it as a project named 「<名字> 的工作區」, so 新對話 and 功能 have a folder to start in.
- 交辦單 return/complete ask in an in-page dialog (`TextPromptDialog` in kit.tsx), not `window.prompt`.
- Error text: the server keeps English messages plus a `code`; the page shows Chinese through `localizeError` (pages/i18n.ts). An unknown code shows the server text.
- n8n 應用 from 功能 starts a new conversation with the draft 「用『<flow>』:」 (never sent). The hint travels through sessionStorage and is placed into the draft store at module load.
- Room composer: image-attach button hidden by CSS in RoomView (room messages are text only; the send drops images). Pasting an image into a room draft still attaches it in the composer and is dropped on send: open item.
- Second round (members never see folders): the files panel, 「開啟其他專案…」 and the project bar over the composer are hidden for members by CSS in TigerNav (H11); the model error banner and the tool-preset picker follow `keep("composer.model")` / `keep("composer.tools")` in ChatInput (existing H16 lines, 2 edited lines).
- Room messages: only my own go right; others and AI sit left with avatar and name (CSS scoped to `.tg-left-user` in RoomView). Room names are unique per person's list (409 `exists`); the duplicate seen in the first walk-through came from running the walk-through script twice (two rooms, 267 s apart, same owner), the product had no rule.
- Settings page: one column as wide as the conversation (`.tgs-col`), own `Select` / `Segmented` controls in kit.tsx instead of native select and radio. The admin 全部 view lives inside the 交辦單 tab; the 管理 tab formerly named 交辦單 is 分享申請 (prompt share requests), a different list.
- Sign-out sits at the right end of the top bar even when no conversation is open (it takes the free space only when upstream's debug button is not already pushing the group right).
- The round "N" at the bottom left is Next.js's dev-mode indicator; it does not exist in the production image (`next start`).

## Batch v6 (gen1-v6)

- One modal: `Modal` in `tigerai/ui/kit.tsx` (sizes sm/md/lg, X top right, Esc and backdrop click close, top-most first; on a phone md/lg are full screen with the X, sm stays a card). Settings (lg), 新交辦單 (md, `NewAssignment.tsx`), new room, room actions and every confirm use it. No page needs a back button.
- No new upstream hook. Behaviour that used to need one lives in `tigerai/ui/role-fetch.ts` (a `window.fetch` wrapper: the picked AI role header on the creation call; quiet answers for members, see `member-quiet.ts`), `i18n-overrides.ts` (upstream's own locale tables) and `useUpstreamLocale` / `useScrubPathTitles` in `parts.tsx`.
- Hook H24 changed in place: the member/admin home folder only stands in for an empty session list once the list has loaded (failure 1). Hook count unchanged; marker count for H24 is 2 lines.
- 功能 picks create nothing: role in the store, hint parked under the fresh composer's draft key, fresh view opened through the + button's handler.

## Batch v7 (gen1-v7)

- No new hook id. Existing hooks changed in place: H16 (ChatInput) now has 5 marker lines, four of them are one-line `tg.text(...)` edits so the admin's 「自動」 and 「已設定」 labels come from `TEXTS` in `tigerai/ui/slots.tsx` (add a line there to translate another upstream label; key = `composer.thinking.<level>` or `composer.tools.<preset>`); H24 (SessionSidebar) has 3 marker lines (the missing-session toast asks `shouldToastMissingSession`, so a channel's own conversation raises none).
- H18 ctx gained `ready` (a working folder is chosen). `registerNewChat(fn, ready)` / `waitNewChatReady()` in `tigerai/ui/store.ts`: a 功能 pick waits for it, then always opens a fresh conversation.
- `useConfirm()` in `kit.tsx`: `ask(text, label, run)` + `{dialog}`. Every destructive click goes through it (a test greps for bare `"DELETE"` calls in TgApp.tsx).
- Upstream diff since v6: 7 lines added, 7 changed (ChatInput 4 changed lines, SessionSidebar 3 changed lines); no new lines.

## Batch v8 (gen1-v8): 公佈欄 and the bell
- No new hook id, no new upstream line. `toolbar.right` (H21) now renders `<BellButton /> <SignOutButton />`; `brand.version` (H14) also shows `HomeBulletin` under the greeting. Both are registered in `tigerai/ui/slots.tsx`.
- The bell: count = only what the person must act on, red when something is overdue; click opens the 公佈欄 modal (`ui/Bulletin.tsx`, shared `Modal`, size lg, full screen on a phone, no back button). Tabs: 個人區 (default), 公用區, 我交辦的, 全部 (admin). State and the 15 s poller: `ui/bulletin-store.ts`.
- The 交辦單 settings tab is removed from `SETTINGS_TABS`; the pending badge on 設定 is gone (the bell replaces it). `NEW_MENU` gains 新公告 for `head`/`admin`.
- Change the order or names of the tabs in `Bulletin.tsx` (`tabs`) and the texts in `pages/i18n.ts` (`zhZ`).

## Batch v11b — terminal closed for everyone

| What | Where | Upstream cost |
|---|---|---|
| `/api/terminal` and `/api/terminal/*` answer 403 `terminal_closed` for every signed-in role, administrators included (same style as the provider sign-in lock). Enforced in the gate, not by hiding | `adapter/gate.ts` `terminalClosed()` | none |
| The 「>_」 button in the files row is hidden (title 「開啟工作區終端機」 / "Open workspace terminal" / 「打开工作区终端」); a test reads those titles from upstream's three locale files so a reworded upstream title fails the test instead of silently showing the button again | one CSS rule in `TG_CSS` (`ui/kit.tsx`) | **no hook** |
| Other entries: none exist. Terminal tabs only open from that button (no menu item, no shortcut; checked in `AppShell`, `TabBar`, `SessionSidebar`). A terminal tab restored from an older `sessionStorage` would still render but every call to it is 403 | | |

Hooks: **29 ids, 35 locations, unchanged.** Upstream diff outside `tigerai/`, `public/`, `docs/`: unchanged (342 / 72).

## Batch v11 — # 提示詞

Type `#` in the conversation input or the room input: a popup lists 我的提示詞 and 公司提示詞 (what the person's "/" menu lists; the server decides, `GET /api/tg/prompts/pick`), filtered as you type. ↑↓ Enter/Tab Esc and mouse. Picking replaces the `#query` with the rendered text; it never sends. A prompt with `{{variables}}` opens a dialog first (one field per variable, all required; `{{CURRENT_DATE}}`, `{{CURRENT_TIME}}`, `{{CURRENT_DATETIME}}`, `{{USER_NAME}}`, `{{USER_EMAIL}}` fill themselves; `{{name | default}}` supplies a default). Placeholder: 「輸入訊息,@AI 問助理,# 叫出提示詞」.

| What | Where | Upstream cost |
|---|---|---|
| Conversation input | `ComposerState` (existing slot `composer.state`, H15) now wraps its children in `HashPrompts` | **no new hook** |
| Room input | `RoomView` wraps the upstream `ChatInput` in `HashPrompts` (our file) | none |
| Matching, query detection, variables, one render function | `prompts/pick.ts` (pure; dialog preview, insert and tests share it) | none |
| Popup + dialog | `ui/HashPrompts.tsx`. Listens to the textarea inside its wrapper (`input`, capture-phase `keydown` so Enter never reaches upstream's send handler while the popup shows something) and writes back with the native value setter + an `input` event, so upstream's own state sees the text. `ChatInput.tsx` is untouched | none |

Why no hook / no ChatInput edit: `ChatInput.tsx` is upstream's most changed file; the slot that already wraps it is enough because DOM events reach a wrapper whether or not it renders a box (`display: contents`). Not breaking others: `/` and `@` popups open on their own triggers; `#` is only taken when the text before the caret ends in `#query` at a start or after whitespace **and** at least one prompt matches, otherwise every key goes through (so `#3`, `C#`, `issue#42` are plain text).

**v11 totals.** Hooks: **29 ids, 35 locations, unchanged from v10** (no hook added or moved in v11). Upstream diff against `main` outside `tigerai/`, `public/`, `docs/`: unchanged from v10 (see the figure in the v10 section).

## Batch v11 (gen1-v11): 交辦 two tabs, 交辦給 AI

| # | Change | Where | Upstream cost |
|---|---|---|---|
| 1 | 交辦 modal = two tabs: 交辦我 (default; every order handed to me, tag 人 / AI / n8n from `source`) and 我交辦 (segment 全部 / 交給人 / 交給 AI). The old 「AI 交辦的」 tab is gone (its orders are in 交辦我 with the tag) | `ui/AssignmentsModal.tsx` | none |
| 2 | New order form: 交給 [人 \| AI]. AI: pick an AI 角色 from the 精靈 menu or 「一般 AI」 | `ui/NewAssignment.tsx` | none |
| 3 | AI order card: status 進行中 / 待確認, the AI's result rendered with the conversation's markdown renderer, 「開啟對話」 link, 完成 / 退回 (reason) for the applicant | `ui/AssignmentsModal.tsx` | none |
| 4 | Toast 「AI 做完了:<標題>」 (bottom right, click opens the order), bell count within ~5 s while an AI order of mine works (15 s otherwise), home list 「AI 做完了,等你確認」 under the greeting | `ui/parts.tsx` (`AiToasts` inside the bell, `HomeBulletin`), `ui/bulletin-store.ts` | none (rides the existing `toolbar.right` and `brand.version` slots) |
| 5 | Browser push when the page is closed: asked once, on the click that creates the first AI order; stored per person; deep link `/?assignment=<id>` opens that order | `ui/push-client.ts`, `push/index.ts`, `ui/store.ts` | none (upstream's service worker already shows the payload) |

## Batch v10 (gen1-v10): done 2026-11-15

| # | Change | Where | Upstream cost |
|---|---|---|---|
| 1 | Default max output 32768, never above half the context (64512 -> 32256). Rule unchanged: admin override, else gateway value, else default | `provider/settings.ts` `defaultLimits` / `effectiveLimits`; models.json is rewritten at every start and on 儲存, so a stale 16384 is replaced unless an admin override exists | none |
| 2 | 「繼續」 under both cut-off notices (everyone). Sends 「請從剛才中斷的地方接著寫完。」 (text cut off) or 「請直接寫出回答,不要再重複思考。」 (no answer) through the conversation's own `handleSend`; hidden while a run goes | new slot `chat.truncation` (**H27**, wraps upstream's compact button in `MessageView`) and slot `chat.sender` (**H28**, renders nothing; `ChatWindow` hands over `handleSend` + busy per session id). Logic in `ui/truncation.tsx`, `ui/truncation-logic.ts` | +2 hooks |
| 3 | Logo: the icon files carry no text. **Corrected in v11:** the sidebar header shows the tiger icon AND 「TigerAI Agent Portal」 again (as in v9; click = contact popup); the icon-only sizing CSS was removed. Empty-conversation hero = icon + 「你好,<name>,今天想做什麼?」, no product-name line. Tab title and login page keep the name | `BrandTitle` renders `.sidebar-brand` with `BRAND_SHORT` (icon from the existing `::before`); `TG_CSS` hides `.new-session-brand-name` | none |
| 4 | Upstream bug: `onClick={onCompact}` passed the click event as `customInstructions` (circular JSON) | `MessageView.tsx` one line `onClick={() => onCompact()}` (**H29**). | +1 hook, 1 changed line |
| 5 | Notice texts: member wording in `i18n-overrides.ts`; administrators get one more sentence 「也可以把這個模型的思考關閉。」 and the 「壓縮上下文」 button from the slot; members never see 壓縮 | `ui/i18n-overrides.ts`, `ui/truncation.tsx` | none |
| 6 | Images reach the model: `provider/v1.ts` writes `input` per model (gateway array, else `["text","image"]`; embedding models still excluded). 設定 › 管理 › 模型: 「可收圖」 switch per model (`Switch` in `ui/kit.tsx`, role=switch), admin override `images` in models-settings.json, applied on 儲存 without restart | `provider/settings.ts` `effectiveInput`, `provider/admin.ts`, `ui/SettingsOverlay.tsx` | none |

Hooks: **29 ids, 35 locations** (v9: 26 / 31). Upstream diff against `main` (outside `tigerai/`, `public/`, `docs/`): 342 added / 72 deleted (v9: 337 / 71).
Slots (13): v9's 11 plus `chat.truncation`, `chat.sender`.

### Open after v10
- A model whose gateway entry has `input: null` is now treated as picture-capable. A model that really is text-only and reports nothing must be switched off by the admin (「可收圖」); the failure is the model's, not the portal's.
- 「繼續」 sends a normal user message, so it appears in the conversation and counts as a turn.
- Admin overrides refuse a max output below 400 (existing rule), so the live check used 400, not 256. 「壓縮上下文」 on a short session answers upstream's English 「Nothing to compact (session too small)」: the request is now `{"type":"compact"}` (no event object), but a successful compaction was not exercised live.
- The 「繼續」 button stays on the old notice after use (disabled); it is not hidden once the next reply exists.

## Batch v9 (gen1-v9): done 2026-11-14
Founder: 「好了 可以全部去做」. What landed, and where (the longer proposals/revisions that led here are kept below as history).

| # | Change | Where | Upstream cost |
|---|---|---|---|
| 1 | Logo = tiger head only; tab and phone icons regenerated from it | `public/brand/tigerai-logo.png` (300x300 transparent), `public/icons/icon-192/512`, `apple-touch-icon` | none |
| 2 | "+" sits next to the search | removed `order: -1` from `NewButton` (the header is brand · spacer · + · search) | none |
| 3 | Product name click = contact popup, no version | new slot `brand.title` (**H26**, 1 line in `SessionSidebar.tsx`) renders `BrandTitle`; contacts from `CONTACT` in `layout.ts`; the version is gone from the empty-conversation hero and only appears in the admin's 設定 › 帳號 › 關於 | +1 hook, 1 changed line |
| 4 | Rooms fold; so does 「部門頻道(檢視)」 | `RoomListExtra` (`FoldHead`), state per person in `localStorage` (`tg-fold-rooms-<id>`), unread count stays visible on a folded header | none |
| 5 | Own icons for conversations and rooms | rooms: SVG in the H19 row (`ROW_ICONS.room`); conversations: CSS `::before` on `.session-tree-session .session-tree-main` in `TG_CSS` (mask of `ROW_ICONS.conversation`), so no `sidebar.row.icon` slot was needed | none |
| 6 | Creator closes and reopens their own room | `rooms/service.ts` `requireCloser` (moderator **or** `owner_id`); `accessFlags().can.close/reopen`; the room "⋯" menu already reads those flags. Audit `room.close` / `room.reopen` carry `byCreator`. Delete stays admin only | none |
| 7 | Bottom row 精靈 · 交辦 · 技能 · 設定 | `SIDEBAR_BOTTOM` (icons `bolt`, `task`, `layers`, `gear`), `flexWrap` so nothing squeezes; 模型 icon removed | none |
| 7a | 精靈 = my personal agent menu | `ui/AgentsModal.tsx`, server `agents/personal.ts`; composer 功能 button (⚡ icon, label 「功能」) reads the same `GET /agents/menu` | none |
| 7b | 交辦 = progress modal | `ui/AssignmentsModal.tsx` (我交辦的 / 交辦給我的 / AI 交辦的); `assignments.source` | none |
| 7c | 技能 modal | `ui/SkillsModal.tsx`, tabs from `SKILL_TABS` | none |
| 7d | 設定 modal | `ui/SettingsOverlay.tsx` on the shared `ui/TabbedModal.tsx`; admin 管理 group; MCP and 外掛 are upstream screens embedded (`ui/EmbeddedUpstream.tsx`) | none |

Hooks: **26 ids, 31 locations** (v8: 25 / 30). Upstream diff against `main` (everything outside `tigerai/`, `public/`, `docs/`): v8 end 336 added / 70 deleted, v9 end 337 added / 71 deleted (the one changed line of H26).
Slots (11): `brand.version`, `brand.title`, `composer.state`, `composer.functions`, `sidebar.new`, `sidebar.list.extra`, `sidebar.bottom`, `toolbar.right`, `main.override`, `toolbar.tabs`, `onboarding.models`.

### How the four bottom buttons are built
- **Hosting.** The three new modals (and 設定) are hosted by `SignOutButton` in the top bar (`toolbar.right`, H21), exactly like the settings modal, so they open with the sidebar closed. State: `ui.panel` in `ui/store.ts` (`openPanel("skills", "install")`, `closePanel()`).
- **Tabs are data.** `SETTINGS_TABS` and `SKILL_TABS` in `layout.ts`; the shape (tabs left, content right, stacked on a phone) is `TabbedModal`. A tab whose action is `{ kind: "embed", id }` renders an upstream screen full-bleed.
- **設定** = environment and parameters. Everyone: 帳號 (name, password, language, light/dark; admin also sees 關於 with the version). Admin 管理: 模型連線, n8n 連線 (webhook registration, inbound keys, n8n MCP servers), MCP, 外掛, 成員, 群組, 組織, 稽核, 已刪除頻道. Old `?settings=prompts|roles|library|approvals` links open the matching 技能 tab.
- **技能** = the AI I use for work. Everyone: 我的提示詞, AI 角色 (company + colleagues' + mine, with 「用這個開對話」), n8n 應用, 可用技能 (installed skills, read-only; 「用這個開對話」 puts `/skill:<name> ` in the fresh conversation's draft). Admin 管理: 安裝技能 (upstream `SkillsConfig`), AI 角色上架, 提示詞上架, 分享申請, 子代理 (upstream `AgentsConfig`).
- **Embedded upstream screens** take `embedded`, `cwd` (the administrator's own workspace folder, `me.homeDir`: never a client-typed path), `trust` (from the existing `GET /api/project-trust`) and `onClose`. They only open for administrators (the server answers 403 to anyone else on all their routes). A failing screen shows 「這個畫面無法載入。」 in place (own error boundary). Upstream's own `SettingsPanel` is no longer opened from anywhere in our UI; `openUpstream` stays on `SidebarBottom` only as the fallback the footer slot keeps if our component throws.
- **Starting a conversation from a pick** (`ui/start.ts`, shared by the composer 功能 button and the modals): role in the store, hint parked under the fresh composer's draft key for the last composer folder seen (else the person's own), fresh view opened through the + handler. Same path as before v9; moved out of `parts.tsx`.

### Open after v9
- A company role created after a person's menu was first read is not added to it automatically (it is their menu); they add it under 精靈 › 找精靈. (The first read seeds the menu with the roles they may call, so nobody lost anything on upgrade.)
- A hint draft from a modal pick goes to the last composer folder seen; an administrator who never opened a conversation in this tab gets their own workspace folder, which may not be the folder the sidebar then starts in (the role itself is unaffected).
- Embedded upstream screens bring upstream's look (their own cards); fixing spacing, if needed, is CSS in `TabbedModal`, not an upstream edit. Not tuned beyond a live check.
- The 交辦 modal does not show 全部 (administrators keep that in 公佈欄 › 全部).

---
### History: the v9 proposals (kept so the next person can see what was rejected)
The first plan (before Founder's revisions):
Where each requested change lands in the buffer layer. "No hook" = only tigerai files change.

| # | Founder asked | Lands in | Upstream cost |
|---|---|---|---|
| 1 | Logo = the tiger-head icon only, no English text under it | asset swap `public/brand/tigerai-logo.png` (source: the tiger-head icon from the brand kit); check `public/icons/icon-192/512`, `apple-touch-icon` | no hook (asset) |
| 2 | "+" sits next to the search (magnifier), not at the far left | `sidebar.new` (H18) render position: the slot already sits just before the search button in SessionSidebar, so the move is CSS in our sidebar styles (order) | no hook |
| 3 | Clicking 「TigerAI Agent Portal」 shows our contact details, not version numbers | upstream `components/PiWebTitle.tsx` toggles versions on click. New slot `brand.title` (one TG-HOOK around the button) rendering a tigerai `BrandTitle` that opens a small popup with contact items from a new `CONTACT` list in `layout.ts`. Contents pending from Founder | +1 hook (~2 lines) |
| 4 | The room list collapses/expands like a workspace group | inside `sidebar.list.extra` (H19, our component); remember open/closed per person in localStorage | no hook |
| 5 | Conversations and rooms each get their own icon instead of the "#" text (reference: old Portal the earlier internal Portal) | rooms: our row in H19, icon chosen in `layout.ts` (new `ROW_ICONS`). Conversation rows are upstream: prefer CSS `::before` icon from our stylesheet; only if that fails, a new slot `sidebar.row.icon` | no hook (CSS) / +1 if CSS is not enough |
| 6 | A room's creator can close (not delete) their own room, and reopen it | server: rooms service close/reopen rule extended to the creator (today head/admin); room "⋯" menu item roles in our room header | no hook |

Expected after v9: 26 hook ids at most (+1 for `brand.title`, +1 only if item 5 needs it).

### v9 item 7 (proposal, waiting for Founder): one settings window
Today two windows exist. 設定 opens ours (`SettingsOverlay`); 技能 calls `openUpstream("skills")`, which opens upstream's `SettingsPanel` (sections 一般 / 模型 / 技能 / Agents / 外掛 / MCP) — a second window with a different look, so 技能 "turns into settings".
Upstream already exports each section as an embeddable component (`SkillsConfig`, `McpConfig`, `PluginsConfig`, `AgentsConfig` all take `embedded`, `cwd`, `trust`, `onClose`). Plan:
- `SETTINGS_TABS` gains admin tabs 技能 / MCP / 外掛 / 子代理 that render those upstream components inside our modal (import, no upstream edit). `cwd` = the admin's own workspace; `trust` from the existing project-trust API.
- Upstream 模型 (`ModelsConfig`) and 一般 are not offered: models are ours (gateway, locked), 一般 holds upstream-only options.
- `SIDEBAR_BOTTOM` = 設定 only, for everyone (模型 and 技能 icons removed; both live under 設定 → 管理).
- No new hook. `openUpstream` stays only as the fallback when a tab component fails (error boundary).
Open check before building: the four upstream components' styling inside our modal, and whether project-scoped skills need a folder picker (default: global skills only).

### v9 item 7 — revised by Founder (2026-11-14): 技能 = everyone's work-AI shortcut
Founder: 「技能是每個人都可以使用的 AI 技能,真的跟工作有關的 AI 設定,當作快捷路徑」. Proposed split (waiting for OK):
- **技能** (bottom row, everyone) opens a 技能 modal = "the AI I use for work": tabs 我的提示詞 (moved out of 設定), AI 角色 (company + mine), n8n 應用 (what my groups may use), 技能 (installed skills I can use, read-only, each with 「用這個開對話」). Admin also gets 管理技能 / MCP / 外掛 / 子代理 there (upstream components embedded). Defined as a new `SKILL_TABS` list in `layout.ts`.
- **設定** (everyone) = 帳號 + 管理 (成員/群組/組織, 模型, n8n 登記, AI 角色上架, 提示詞上架, 稽核, 已刪除頻道).
- **模型** icon removed (lives in 設定 → 管理).
- The composer 功能 menu stays as the one-click start; it reads the same lists as the 技能 modal.

### v9 item 7 — second revision (Founder: 「設定就是真的來設定的,環境設定、參數設定」)
Rule: 技能 = what the AI does for work (use + curate). 設定 = environment and parameters (connections, keys, people, records). Proposed (waiting for OK):
- 技能, everyone: 我的提示詞, AI 角色, n8n 應用, 可用技能. Admin adds: 安裝技能, AI 角色上架, 提示詞上架, 子代理.
- 設定, everyone: 帳號 (name, password, language, light/dark). Admin adds under 管理: 模型連線, n8n 連線 (webhook registration, inbound keys), MCP, 外掛, 成員/群組/組織, 稽核, 已刪除頻道.

### v9 item 7 — third revision (Founder: 「舊版設計真不錯,參考舊版 功能、交辦單、技能、設定」)
Old Portal (the earlier internal Portal `components/AppShell.tsx` ~L1180): the sidebar bottom row held 功能 (⚡ menu: 我的 / 範本 / 公司共用 AI 角色 / n8n 應用 / 精靈), 技能 (skills popup), 交辦單 (always reachable — see the 🔴 note there: assignees are not admins and must never lose the way in), 外掛 (admin). Labels + icons, `flexWrap` so nothing squeezes.
Proposed gen1 bottom row (`SIDEBAR_BOTTOM`, waiting for OK): 功能 · 技能 · 交辦單 · 設定, everyone, icon + name.
- 功能 = the same ⚡ list the composer button shows (one source, two entry points).
- 技能 = AI work items (see second revision).
- 交辦單 = opens the 公佈欄 modal on 個人區/我交辦的; the bell stays as the alert count.
- 設定 = account + 管理 (environment/parameters; 外掛 and MCP move here).
- Founder clarified: the row and the 功能/交辦單 buttons follow the old Portal; the CONTENTS of 技能 and 設定 follow the new split (second revision above).
- Founder defined the two old-style buttons:
  - **功能** = my own menu of agents: the ones I built, plus ones others built that I picked into my menu (add to my menu, or copy and edit as mine). Not a fixed company list. Needs: 「加入我的功能表」 / 「複製成我的」 on shared agents, remove from my menu; my menu order per person (server side, not localStorage).
  - **交辦單** = its own modal, only the progress record of work orders: 我交辦的 / 交辦給我的 / AI 交辦的 (orders created by an AI or n8n flow), with status and due. Separate from 公佈欄, which stays the wider view (announcements + every action item + the bell). Needs: a `source` (person / AI / n8n) on assignments so the AI tab can filter.
- Founder (names and icons): bottom row labels = **精靈 · 交辦 · 技能 · 設定** (精靈 = the personal agent menu above; 交辦 = the work-order progress modal). Icons from the old Portal: 精靈 ⚡ (`M13 2 3 14h9l-1 8 10-12h-9l1-8z`, old FeatureMenu), 交辦 check-box (`M9 11l3 3L22 4` + box), 技能 stacked layers (old skills), 設定 gear. The composer 功能 button stays for now, with the old ⚡ icon.

## Batch v12 — workspace header looks like the 頻道 header

The workspace group rows in the left list (「<名字> 的工作區」, a department's group) used upstream's header look (12px, 600 weight, --text on hover/current, chevron in --text-dim). They now use the same look as the 頻道 row (`.tgx-fold`): 11px, normal weight, `--text-muted` in every state (hover only adds the background), 12px chevron in the text colour, 10px left padding, the pin icon dimmed to match. Conversation rows inside an expanded workspace, the folding behaviour and the workspace name text (`adapter/labels.ts`) are not touched; row heights stay upstream's because the list is virtualised on fixed heights.

How: four CSS rules in `TG_CSS` (`ui/kit.tsx`) on upstream's stable class names `.session-tree-group*`. **No hook, no upstream diff.** `TG_CSS` is only mounted when `TIGERAI_ENABLED=1`, so a plain upstream build keeps its own header. Open: if upstream renames those classes the rules silently stop matching (the look reverts, nothing breaks).

## 社群版精靈 (feat/ce-wiz)

- **沒有新的 slot。** 頻道裡的精靈卡片、「精靈設定」選單項、出處 chip 都在 `RoomView`(我們自己的檔案,由既有的 `main.override` H20 帶出);公佈欄個人區多一種 `kind:"wizard"`(`Bulletin.tsx`);管理員的 n8n 設定頁多「精靈排程」區塊(`TgApp.tsx N8n`)。
- **新的上游位置:1 個。** H12 多一個檔案 `app/api/tigerai/hooks/wizards/tick/route.ts`(一行 `export { POST }`),登記在 `hooks.json`。H12 現在 3 個檔案、3 個標記行。
- **頻道「⋯」選單**多「精靈設定」(只對 `can.wizards` 的人顯示;伺服器仍重查)。訊息列加 `data-seq`,出處 chip 用它捲到那一則並框起來(`store.ts openRoomAt` / `focusSeq`)。
- 文字在 `tigerai/pages/i18n-wizard.ts`(不放進 `i18n.ts`,避免和同時進行的改動衝突)。

## Batch ce-meet — 會議摘要 (community edition 2.4)

| What | Where | Upstream cost |
|---|---|---|
| 「會議摘要」 row at the top of the 精靈 list | `wizards/meeting/ui/MeetingEntry.tsx`, mounted by one line in `ui/AgentsModal.tsx` (our file) | **no hook** |
| 「上傳會議錄音」 in the room ⋯ menu | one item + one dialog line in `ui/RoomView.tsx` (our file) | none |
| 「語音轉文字服務」 block under 設定 › 管理 › 模型 | `wizards/meeting/ui/AsrAdmin.tsx`; `case "models"` renders `<><ModelsAdmin /><AsrAdmin /></>` so a change of `ModelsAdmin` itself never conflicts | none |
| 交辦單 form can be pre-filled | `ui/NewAssignment.tsx` gains optional `prefill` and `onCreated` props | none |

Hooks: **29 ids, 35 locations, unchanged.** Upstream diff outside `tigerai/`, `public/`, `docs/`: unchanged (342 / 72). Details, API and the adapter to the shared wizard infrastructure: `tigerai/docs/MEETING.md`.

## CE-model (2026-11-15): model connections, fallback line, small fixes
- **No new hook id.** `chat.sender` (H28) now also renders `FallbackNote`, the one line 「主要連線沒有回應,這次改用「…」的 …」 under the composer (latest turn only; read from the conversation log). `startExtensions` (H08) gained two inline extensions: connection fallback and the completion push. The gate answers `POST /api/push/subscribe` (existing H02).
- 設定 › 管理 › 模型 is a list (`ui/ModelsAdmin.tsx`): number, name, 主要連線/備援, ↑ ↓, enable switch, 編輯, 刪除 (confirm dialog), 新增連線 (shared `Modal`). Opened rows hold the old per-gateway editor (address, key, test, models table).
- `ui/role-fetch.ts` also rewrites the `error` of a failed `POST /api/agent/:id` through `ui/error-translate.ts` (「對話還很短,不需要壓縮。」).
- Upstream diff since v12: none (hook count unchanged: 29 ids / 35 locations).

## CE 3c: 系統連接 (connectors)
- No new hook id. `SETTINGS_TABS` got `connectors` (admins, 設定 › 管理 › 系統連接, component `tigerai/ui/Connectors.tsx`, one `case` in `SettingsOverlay.tsx`); `FUNCTION_SOURCES` got `connectors` (everyone; the 功能 menu lists the connectors this person may use, from `GET /api/tg/connectors`; picking one opens a new conversation with the draft 「請用『名稱』幫我查:」, nothing is sent).
- Texts live in `tigerai/pages/i18n-connectors.ts` (merged into the big table by three lines in `i18n.ts`).
- Details of the feature: `tigerai/docs/MCP_CONNECTORS.md`.

## 顧問包掛點與「顧問包」頁 (feat/ce-integ)

- **沒有新的上游 hook。** 瀏覽器端:`tigerai/ui/addons.ts` 向 `GET /api/tg/addons` 取得伺服器公告的選單與狀態;`SettingsOverlay`、`SkillsModal`、功能按鈕(`parts.tsx`)把公告的項目併進自己的清單,頁面元件來自 `tigerai/addons/ui-index.ts`(社群版是空的)。元件只在伺服器公告了對應 id 時渲染。
- **設定 → 管理 → 顧問包**(`ui/AddonPage.tsx`,只有管理員):未安裝 / 已安裝版本+到期日 / 授權無效的原因、顧問包會多哪些功能、如何取得。
- 精靈設定視窗的排程狀態列依 `mode` 顯示:內建排程(「上次檢查」)或外部排程(顧問包)。
- 登入頁與名稱彈窗多一行「based on pi-agent and pi-web」(`ui/BasedOn.tsx`,連到兩個專案)。左上只放主名 OpenAgent Portal。
- 社群版選單仍有「n8n」頁籤(Webhook 與金鑰)、技能的「n8n 應用」、功能清單的 n8n 區塊(簡易 n8n 示範);沒有「系統連接」(MCP)頁籤與功能區塊,也沒有「精靈排程(n8n)」頁籤,它們由顧問包帶來(`menus`)。
