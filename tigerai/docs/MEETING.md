# 會議摘要 (community edition spec 2.4)

Folder: `tigerai/wizards/meeting/` (server) and `tigerai/wizards/meeting/ui/` (pages). No new upstream hook, no upstream line changed.

## What a person sees

| Where | What |
|---|---|
| 精靈 list (bottom row 精靈) | a built-in row 「會議摘要」 above the person's own agents (`ui/MeetingEntry.tsx`, one line in `AgentsModal`). The result is a conversation-style thread inside the modal |
| Room ⋯ menu | 「上傳會議錄音」 for members of an open room (`RoomView`, one menu item). The draft is posted into the room as an AI message |
| 設定 › 管理 › 模型 | its own block 「語音轉文字服務」 under the model connection (`ui/AsrAdmin.tsx`, one line in `SettingsOverlay`) |

Modal tabs: 新增 (paste or upload) · 會議記錄 (mine, or the room's). 提醒 and 監督 are not shown here: they arrive in the 公佈欄 個人區 and count on the bell like every other wizard result.

## Rules implemented (spec 2.0 / 2.4)

- The program numbers the transcript lines; the model gets `[n] text` rows and answers JSON only. `summarize.ts` `parseSummary` **drops every item without a valid source** (line numbers inside 1..N) and counts them; a summary where everything was dropped is a failure, not an empty success.
- Owner is resolved to a person by the program (exact name, else a unique partial match among the room's members / active users). Due dates must be a real `YYYY-MM-DD`. `unowned`, `noDue`, `overdue` are computed, never taken from the model.
- 記錄 (決議) + 提醒 (待辦, owner, due) + 建議 are posted in the room as 「會議摘要(AI 草稿,待確認)」 with a 出處對照 section. **監督 (unowned items) is not posted in the room** (spec 2.0: supervisors only); the room draft only counts them. In the 精靈 (private) thread the requester sees all four.
- Room delivery also sends, through the adapter: a 提醒 to each owner who resolved to a person, and a 監督 to the supervisors (room creator + heads of the creator's departments). Both carry sources; the default adapter refuses an item without one.
- 「開成交辦單」 only opens the existing 新交辦單 form pre-filled (title, description with the transcript quotes, assignee when resolved, due). The starter presses 建立; afterwards the page records the link (`POST meeting/:id/actions/:idx`, the assignment must be theirs). The AI never creates an assignment.

## Speech to text

- Setting: admin only, `GET/PUT /api/tg/admin/asr`, `POST /api/tg/admin/asr/test`. Files in the data directory, mode 600: `asr-settings.json` (url, model, language) and `asr-api-key`. Only the last 4 characters are ever returned. Env defaults: `TIGERAI_ASR_URL`, `TIGERAI_ASR_MODEL`, `TIGERAI_ASR_API_KEY_FILE`. The address may be the base (`…/v1`) or the full `…/audio/transcriptions`.
- Test connection sends one second of silence as multipart (`file`, `model`, `response_format=json`) and accepts any 2xx.
- Not configured: `GET /api/tg/meeting/capabilities` says `asrConfigured:false`; the upload button shows 「管理員還沒設定語音轉文字服務」 and `POST meeting/uploads` answers 409 `asr_not_configured`. Pasting a transcript is unaffected.
- Upload = chunks, not one body: `POST meeting/uploads {name,size,title,roomId?}` → `PUT meeting/uploads/:id?offset=N` (raw bytes, 8 MB) → `POST meeting/uploads/:id/finish`. Each chunk is piped to `meetings/_uploads/<id>.part` (offset must equal the file size; a failed chunk is truncated away so it can be resent; the declared size is a hard cap, 200 MB). Reason: the request proxy buffers a whole request body and caps it at 128 MB (`proxyClientMaxBodySize`), below the 200 MB limit, and buffering 200 MB in memory is what the spec forbids.
- Transcribing reads the file lazily from disk (`fs.openAsBlob`) and posts it to the service; the transcript is stored as `meetings/<id>/transcript.txt` (line n = source n) and is downloadable (`GET meeting/:id/transcript`).
- Audit: `asr.transcribe` (meetingId, bytes, ms, outcome ok/failed, reason), `asr.update` (changed field names only), `meeting.create`, `meeting.summary`, `meeting.download`, `meeting.assignment_linked`, `wizard.deliver`.

## API (all under /api/tg, signed in; a meeting is visible to its starter, to members of its room, and to administrators)

| Route | Meaning |
|---|---|
| `GET meeting/capabilities` | `{asrConfigured,maxAudioBytes,types,maxTranscriptChars}` |
| `GET meeting[?room=id]` | my meetings, or the room's that I may see |
| `POST meeting {title,transcript,roomId?}` | paste → starts the summary job |
| `GET meeting/:id` | detail: status, lines, summary, links, prefills (starter only) |
| `POST meeting/:id/retry` | starter only; retries the failed step (transcribe or summary) |

Jobs run in the background in this process (one model call at a time, through the room-AI queue `enqueueTask`). A job found `running` for more than 2 minutes without a live task (restart) is shown as failed with a retry button.

## Adapter to the shared wizard engine (`wizards/meeting/host.ts`)

Everything the feature does to the outside goes through `WizardHost`; `defaultHost` now uses the engine (`wizards/engine.ts`):

- `postToRoom(roomId, text, ref, by)` = `recordExternalRun`: one finished `wizard_runs` row (kind `meeting`, `input = {"ref": meetingId}`) plus the channel message (kind `wizard`), so the draft is a card with 確認 for the channel's creator, a head or an administrator, and shows in the audit as `wizard.run`.
- `deliverPrivate(item, roomId)` = `deliverExternalItem`: a `wizard_items` row addressed to one person (aspect `remind` or `supervise`). The 公佈欄 個人區 and the bell read those rows (`privateOpenFor`), the person clears it with 我知道了, and the engine's duplicate rule (same person, same sources, open or acknowledged within 3 days) applies. An item without a source is refused. Sources are `{t:"x", label, quote}`: a quoted transcript line shown as text, not a link (it points into a transcript, not a channel message).
- `supervisorsOf(roomId)` = the engine's `supervisors()` (creator plus heads of departments with a member in the channel; active accounts only).
- The model call goes through the shared AI slot (`withAiSlot`, `TIGERAI_AI_RUN_CONCURRENCY`) like every other background AI job, instead of the room-AI queue.
- The temporary table `wizard_private_items` and the tab 「給我的提醒」 are gone. A database that still has the table gets its sourced rows copied into the engine and the table dropped, once, at first use (`migratePrivateItems`); rows of a deleted room or without a source are not carried over.
- `setWizardHost()` stays as a test seam.

## Known gaps (open)

- The 精靈 flow is a conversation-style thread kept in the meeting record, **not a pi session** in the left list: an action button cannot live inside a pi conversation, and a pi session cannot be written without a model turn. If a real session is wanted, the shared infrastructure should create it and link the meeting id.
- Transcripts above 80 000 characters are refused (「請分段貼上」); no map-reduce yet.
- Long transcripts and a cold local model can exceed the 10 minute model timeout; the job then fails with a retry.
- Real ASR deployment (Qwen3-ASR / Breeze-ASR) is out of scope; tested only against a fake service.
