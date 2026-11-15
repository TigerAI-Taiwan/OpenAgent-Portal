// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Texts of the school features: 學生自行註冊 and AI 評分精靈. Kept apart from i18n.ts (which spreads these objects into its tables).
export const zhSchool = {
  // ---- 學生自行註冊
  regLink: "註冊", regTitle: "註冊新帳號", regIntro: "請填寫資料，並輸入老師或主管告訴你的「通關密語」（學校：課程名稱；公司：部門）。註冊後要等老師或管理員核准才能登入。",
  regName: "姓名", regEmail: "電子郵件", regPassword: "密碼(至少 8 個字)", regCode: "通關密語（學校：課程名稱；公司：部門）", regCodeOptional: "通關密語（選填）",
  regNote: "備註（學號、系級，選填）", regSubmit: "註冊", regBack: "回登入頁", regClosed: "目前沒有開放註冊。",
  regPendingTitle: "帳號已建立，等待管理員核准", regPendingHelp: "老師或管理員核准後，你就可以用剛才的 email 與密碼登入。",
  regAdminTitle: "開放自行註冊", regAdminHelp: "預設關閉。開啟後，登入頁會出現「註冊」，學生或同仁輸入課程／部門的通關密語申請帳號，核准後才能登入（一般成員）。用完請關閉。",
  regRequireCode: "必須輸入通關密語", regRequireCodeHelp: "關閉後任何人都能申請（密語選填，沒填的只有管理員能核准），只適合臨時工作坊；建議保持開啟。",
  regAuto: "密語正確就自動核准", regAutoHelp: "預設關閉。只在老師全程在場的課堂使用：密語正確的人註冊後立刻可登入，不必等核准。用完請關閉。",
  regPerHour: "每小時最多 {n} 人註冊(整台伺服器合計)",
  jcTitle: "課程／部門通關密語", jcHelp: "自己取一句容易辨認的話（例如「AI Agent 實作 甲班 2026秋」），告訴學生或同仁；註冊時輸入，就是申請加入這個課程／部門。比對不分大小寫、空白與標點。換新密語後，舊的立刻失效。",
  jcNone: "你沒有可以設通關密語的部門。", jcNoCode: "還沒有通關密語", jcRotate: "隨機產生", jcDisable: "停用密語", jcOff: "已停用", jcMembers: "學生 {n} 人",
  jcCopy: "複製", jcCopied: "已複製", jcConfirmRotate: "換新通關密語後,舊的會立刻失效。繼續嗎?", jcConfirmDisable: "停用後,學生不能再用這個通關密語註冊。繼續嗎?",
  jcSet: "設定", jcPlaceholder: "輸入新的通關密語(至少 8 個字)",
  rqTitle: "等待核准的註冊", rqNone: "目前沒有等待核准的註冊。", rqApprove: "核准", rqReject: "拒絕", rqApproveGroup: "這一組全部核准", rqApproveAll: "全部核准",
  rqNoClass: "（沒有填通關密語）", rqClassLine: "{n} 位申請加入『{name}』", rqCols: "姓名 / email / 輸入的通關密語 / 申請時間", rqConfirmReject: "拒絕後這個帳號會被停用（資料保留）。繼續嗎？",
  rqConfirmGroup: "把這一組的 {n} 位全部核准？", rqGo: "前往核准", rqHelp: "老師看班級與人數即可，一次核准整班；陌生人用「拒絕」。",
  // ---- 內建技能(含工具)
  skBuiltinBadge: "內建", skCopyMine: "複製成我的", skCopied: "已複製成「{name}」,在下方列表找到它", skBuiltinNote: "內建技能(含工具):內建技能附帶 AI 能用的工具(上網、做投影片、填表、n8n),並不會多給任何權限,工具每次呼叫都會再檢查你的權限。內建技能不能直接改,要改請「複製成我的」,也可以自己建技能來使用這些工具。", skMineBadge: "我的",
} as const;
export const enSchool: Partial<Record<keyof typeof zhSchool, string>> = {
  regLink: "Register", regTitle: "Create an account", regIntro: "Fill in the form and enter the passphrase your teacher or manager gave you (school: the course name; company: the department). An administrator or your teacher must approve the account before you can sign in.",
  regName: "Name", regEmail: "Email", regPassword: "Password (at least 8 characters)", regCode: "Passphrase (school: course name; company: department)", regCodeOptional: "Passphrase (optional)",
  regNote: "Note (student ID, department; optional)", regSubmit: "Register", regBack: "Back to sign in", regClosed: "Registration is not open.",
  regPendingTitle: "Account created, waiting for approval", regPendingHelp: "Once your teacher or an administrator approves it, sign in with the email and password you just used.",
  regAdminTitle: "Open self-registration", regAdminHelp: "Off by default. When on, the sign-in page shows 「Register」; students apply with their class passphrase and can sign in once approved (regular members). Turn it off when done.",
  regRequireCode: "Require a class passphrase", regRequireCodeHelp: "When off, anyone can apply (the passphrase is optional; only an administrator can approve those without one). Only for a short workshop; keep it on.",
  regAuto: "Approve automatically when the passphrase is right", regAutoHelp: "Off by default. Only for a supervised class session: a correct passphrase can sign in at once. Turn it off afterwards.",
  regPerHour: "At most {n} registrations per hour (whole server)",
  jcTitle: "Class passphrases", jcHelp: "Choose a phrase you can recognise (e.g. 「AI Agent Lab A 2026 Fall」) and tell the class; typing it at registration means asking to join this class. Case, spaces and punctuation do not matter. A new phrase makes the old one stop working at once.",
  jcNone: "You have no department to set a passphrase for.", jcNoCode: "No passphrase yet", jcRotate: "Random", jcDisable: "Disable", jcOff: "disabled", jcMembers: "{n} student(s)",
  jcCopy: "Copy", jcCopied: "Copied", jcConfirmRotate: "The old code stops working at once. Continue?", jcConfirmDisable: "Students can no longer register with this code. Continue?",
  jcSet: "Set", jcPlaceholder: "New passphrase (at least 8 characters)",
  rqTitle: "Registrations waiting for approval", rqNone: "No registrations are waiting.", rqApprove: "Approve", rqReject: "Reject", rqApproveGroup: "Approve this whole class", rqApproveAll: "Approve all",
  rqNoClass: "(no passphrase given)", rqClassLine: "{n} want to join 『{name}』", rqCols: "Name / email / passphrase entered / note / applied", rqConfirmReject: "The account will be disabled (its data is kept). Continue?",
  rqConfirmGroup: "Approve all {n} in this class?", rqGo: "Go to approvals", rqHelp: "A teacher only checks the class and the count, then approves the whole class; a stranger gets 「Reject」.",
  skBuiltinBadge: "Built-in", skCopyMine: "Copy as mine", skCopied: "Copied as \"{name}\"; find it in the list below", skBuiltinNote: "Built-in skills (with tools): they come with the tools the AI can use (web, slides, forms, n8n) and grant no extra permission; every tool call checks your permission again. Built-ins cannot be edited: use \"Copy as mine\", or build your own skill that uses these tools.", skMineBadge: "Mine",
};
export const ERR_ZH_SCHOOL: Record<string, string> = {
  bad_join_code: "加入代碼不正確或已失效,請向老師確認", bad_period: "期間不正確(結束日不能早於開始日,最長 400 天,最多 150 堂)", bad_slot: "上課時段不正確(星期、開始與較晚的結束時間)", no_students: "這個班級沒有可以匯出的學生", ai_failed: "AI 摘要沒有產生,請稍後再試", rate_limited: "嘗試次數太多,請稍後再試", bad_action: "動作不正確",
};

// ---- 到勤與使用狀況匯出
export const zhUsage = {
  usTab: "到勤與使用", usIntro: "選班級與日期,看每位學生在上課時段有沒有上線與使用的次數,並匯出 CSV(Excel 可直接開)。全部由程式依紀錄計算,只列事實,不打分數、不下判斷;成績由老師自己決定。每次匯出都會記在稽核紀錄。",
  usClass: "班級(部門)", usFrom: "開始日", usTo: "結束日", usSlots: "上課時段(選填)", usSlotsHelp: "有填時段,就列出每堂課每位學生是否在時段內有活動及第一次活動的時間;沒填時段則只列整段期間的合計。", usAddSlot: "加一個時段", usRemove: "移除",
  usShow: "查看", usCsv: "匯出 CSV", usNoGroups: "你沒有可以查看的班級(部門主管看自己的班,且需開啟「主管可查看對話」)。", usNoRows: "這個班級沒有可以列出的學生。", usLoading: "計算中…",
  usColStudent: "學生", usColActive: "有活動天數", usColConv: "對話", usColMsg: "訊息", usColPosts: "頻道發言", usColSeen: "最後上線",
  usPresent: "有活動", usAbsent: "沒有活動", usFirst: "首次 {t}", usLegend: "「有活動」= 該時段內有任何已登入的活動(上線、傳訊息、頻道發言、交辦)。「上線」不等於「在上課」,請搭配現場點名。",
  usWd1: "週一", usWd2: "週二", usWd3: "週三", usWd4: "週四", usWd5: "週五", usWd6: "週六", usWd7: "週日",
  usSummary: "AI 摘要建議", usSummaryHelp: "只用整班的合計數字(不含姓名)請 AI 寫一段中立的摘要與課堂建議,只給你看,不評論個別學生,也不打分數。", usSummaryBusy: "AI 寫摘要中…", usSummaryTitle: "AI 摘要建議(只有你看得到)",
} as const;
export const enUsage: Partial<Record<keyof typeof zhUsage, string>> = {
  usTab: "Attendance & usage", usIntro: "Pick a class and dates to see, per student, whether they were online during class and how much they used the AI, and export a CSV (opens in Excel). Everything is computed by the program from the records and lists facts only: no scores, no judgements; grading is yours. Every export is audited.",
  usClass: "Class (department)", usFrom: "From", usTo: "To", usSlots: "Class times (optional)", usSlotsHelp: "With class times, each class shows whether each student had activity in the slot and the first time; without them only period totals are listed.", usAddSlot: "Add a time", usRemove: "Remove",
  usShow: "Show", usCsv: "Export CSV", usNoGroups: "You have no class to view (a department head sees their own class, and 「heads can view conversations」 must be on).", usNoRows: "No students to list for this class.", usLoading: "Computing…",
  usColStudent: "Student", usColActive: "Active days", usColConv: "Chats", usColMsg: "Messages", usColPosts: "Channel posts", usColSeen: "Last online",
  usPresent: "active", usAbsent: "no activity", usFirst: "first {t}", usLegend: "「active」 = any signed-in activity in the slot (online, a message, a channel post, an order). Being online is not the same as attending; combine with a roll call.",
  usWd1: "Mon", usWd2: "Tue", usWd3: "Wed", usWd4: "Thu", usWd5: "Fri", usWd6: "Sat", usWd7: "Sun",
  usSummary: "AI summary", usSummaryHelp: "Sends only class-wide totals (no names) and asks the AI for a neutral summary and suggestions for the lesson, for you only. It never comments on individual students and gives no scores.", usSummaryBusy: "AI is writing…", usSummaryTitle: "AI summary (only you can see this)",
};
