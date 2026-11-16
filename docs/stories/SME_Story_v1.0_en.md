# Taiwan Tech Precision: Three Months to Follow One Order All the Way Through

(Story outline v1.0 · 2026-11-16 · Fictional company and characters)

> Employees don't have to learn AI first. They start by leaving a record of their work in their own words, and the company gradually turns those records into work that can be handed over and tracked.

---

## Foreword　Why now, and why start with AI

Many business owners have tried "adopting a system": they bought an ERP, built forms, set up a shared cloud folder, and six months later everyone was back on LINE and the phone. The system is usually not the problem. The problem is that **people have to change their habits and learn a whole system before they see any benefit**, and the benefit arrives too late for anyone to hold on.

AI changes the order of things:

| Before | Now, with AI |
|---|---|
| Data has to be typed into formatted fields before the system can understand it | Employees write in **their own words**; AI understands them and helps organize the content into structure |
| Someone has to spend time writing meeting minutes and weekly reports | AI writes the first draft; people only confirm |
| A veteran's experience stays in his head, and writing an SOP takes too long | AI pulls the steps out of what he has already done; once people confirm them, they become a skill |
| Automation means hiring an engineer to write code | AI builds an n8n workflow from the skill; people test and review it before it goes live |

So this story **starts with "leaving a record of work in your own words," not with "learning AI"**:

1. **The lowest barrier**: employees don't learn anything new. They just write one more sentence a day. The benefit shows up in the first week: the boss no longer has to phone people one by one.
2. **Memory first, then AI has something to work with**: however smart AI is, it knows nothing without records. Records are the raw material for everything else.
3. **It grows one step at a time**: with records you can summarize; with summaries you can see who owes what to whom; once the recurring work is visible, it can become a skill; once the method is stable, it can be handed to a workflow. **Every step uses what the previous step left behind.**
4. **People keep making the decisions**: AI writes drafts, sends reminders, organizes, and carries out what it is permitted to do. Commitments, approvals, and going live are always done by people. That is also why the company feels safe using it.

| Order | Why it comes here |
|---|---|
| ① Leave a record (Chapter 1) | Without records nothing else is possible; this step has the lowest barrier |
| ② Meetings become decisions (Chapter 2) | The place where things most often get "said but not done"; the change is visible right away |
| ③ Task assignments get followed up (Chapter 3) | Only with records and decisions do you know who promised what |
| ④ Experience becomes a skill (Chapter 4) | After a period of accumulated records, you can see which tasks follow a repeated method |
| ⑤ AI takes action (Chapter 5) | Once the steps are clear, AI can use tools to follow them |
| ⑥ Hand it to a workflow (Chapter 6) | Only when the method is fixed and confirmed is it worth letting a machine run it every day |

---

## Prologue　Where is this order stuck right now? (before adoption)

Monday, 8:30 a.m. The meeting room at Taiwan Tech Precision still smells of the coffee the night shift left behind.

Chairman David Wang puts his phone on the table. The screen shows a message from the purchasing department at Polaris Electronics: "500 pieces of the A-series aluminum alloy housing. When can you send us a quote?"

"Jimmy, where is the Polaris order stuck right now?"

Sales manager Jimmy Chen flips through his notebook. "I'm waiting for Engineering to estimate the machining hours. I can't quote until that's done."

Production planner Kevin Chang goes next. "I don't have the drawing on my side. Without a drawing I can't estimate hours, and I can't give a delivery date either."

Sales rep Mandy Lin speaks softly. "The drawing... the customer sent me the third revision last Friday. It's in my LINE chat with Manager Chen."

The room goes quiet for a few seconds.

Everyone is working, but nobody can explain the whole picture. David remembers it happening last month too: one order passed among three people for a week, and in the end the customer called to ask.

That afternoon he decided to try one thing: **don't ask everyone to learn AI yet; just have the sales department leave a record of what they do each day, in their own words.**

> Polaris case status: inquiry received; the drawing is in LINE; nobody knows who has the next step.

---

## Interlude　David Wang hears "Company Brain" for the first time

That evening David phoned the TigerAI consultant. "I don't understand AI. What exactly is this 'Company Brain' you keep talking about?"

The consultant thought for a moment. "Chairman, your company's brain today is each employee's own head, plus everyone's LINE chats. When someone takes leave or quits, that piece of memory goes with them."

"A Company Brain puts what happens in the company every day in one shared place, with permissions, where it can be searched, and then lets AI help organize, remind, and do work. It has three layers:"

```
            Company-wide channel
   Announcements, shared company knowledge, authorized company-wide information
                  │
   ┌──────────────┴──────────────┐
 Department channels     Project channels (cross-department)
 Sales, Production Planning,     New product introduction, customer complaints,
 Manufacturing Shift 1 / 2       supplier evaluation, cross-department improvement
 Quality, Finance, Engineering
   └──────────────┬──────────────┘
                Company Brain
 Summaries, search, task assignment, reminders, skills, workflows and audit
```

"The top two layers are **where people talk and work**. The bottom layer is **where AI helps the company remember, follow up, and execute**."

| What the Company Brain can do | What it does | Where it appears in the story |
|---|---|---|
| **Summaries** | Turns a day, a week, or a meeting into a readable record, with a source for every sentence | Chapter 1 daily digest, Chapter 2 meeting summary, Chapter 3 weekly work report |
| **Search** | Ask a question and it finds the answer in the records everyone has left, telling you who said it and where | Chapter 1 "Where is the Polaris order stuck?" |
| **Task assignment** | Every item has an owner, a deadline, and a confirmation when it is done | Chapter 2 turning decisions into task assignments, Chapter 3 three task assignments |
| **Reminders** | When someone has promised something and not done it, or a deadline is near, it reminds that person and lets their manager know | Chapter 3 Richard's machining-hours estimate |
| **Skills** | Turns a method confirmed by a veteran into steps a new hire can follow | Chapter 4 quotation skill |
| **Workflows** | Hands work that must be done on a fixed schedule to n8n, to run on time with the same steps | Chapter 6 delivery-date reminders |
| **Audit** | Records who viewed what, who changed what, and who approved what | Every chapter; version history is reinforced by the consulting package's Gitea |

"One more thing," the consultant added. "The brain belongs to the company, not to the AI. The data normally stays on the company's own machines, and the company decides who can see what. AI drafts, looks things up and uses tools, but only does what it is permitted to do; confirming, approving and going live are decided by people. **The one who decides is always a person.**"

David asked just one question: "So what is the first step?"

"Have the sales department leave their work behind every day, in one sentence."

---

## Chapter 1　The company starts to have a memory (Day 3 of adopting AI)

> **Why this step comes first**: without records, AI knows nothing, and "one sentence a day" is the change employees resist least. Start with the sales department only; expand once it works.

Ian Lin from IT spent a morning importing the company's org chart into the system. His first import was rejected: the department name for Production Planning had a typo, and the preview screen flagged it in red. After he fixed it and imported again, every department automatically got its own channel.

David gave the sales department just one instruction: before leaving each day, write one sentence in the sales channel, covering **what the customer asked today, what I did, and who I'm waiting on now.**

Mandy Lin felt a little shy the first time, typing and deleting: "Polaris A-series housing: the customer sent the third drawing revision last week. I put it in LINE and haven't given it to Production Planning yet."

Jimmy Chen read it and simply pulled sales, production planning, and engineering into the "New Product Introduction" project channel. Then he asked:

"@AI The Polaris Electronics order for the A-series housing: where is it stuck now? Who is each person waiting on?"

AI pulled together what the three people had written over the past few days. The sticking point: the drawing is not in the system yet. Sales is waiting for the hours estimate, Production Planning is waiting for the drawing, and the drawing is in Mandy Lin's LINE. Every sentence was tagged with who said it and in which message.

Mandy Lin uploaded the third-revision drawing to the project channel on the spot.

The next morning, David opened the sales department's daily digest. Without phoning anyone, he knew what customers had asked the day before and who owed whom what.

> Polaris case status: the drawing is in the system; Production Planning starts estimating hours.
> Assets left behind: department channels, daily operations records.
> What the Company Brain did this time: **search** (found the sticking point and its source), **summary** (daily digest).
> Next question: once the hours are estimated, Sales and Engineering must meet to confirm which terms they can commit to. After the meeting, will everyone remember the same thing?

---

## Chapter 2　Meetings are no longer wasted (Day 18 of adopting AI)

> **Why meetings**: meetings are where things most often get "said but not done." AI turns a recording into decisions with sources, so for the first time everyone has the same version of what was agreed.

Thursday afternoon. Sales, Production Planning, and Engineering sit in the meeting room to discuss the Polaris terms. Jimmy Chen presses record on his phone.

Kevin Chang says, "We can deliver the first article before Dec 5, but the jig has to be made first." Master Richard Liu adds, "We need to be clear about the 8D this time. The last customer complaint happened because the fixture wasn't aligned properly."

The meeting runs forty minutes. In the past, meeting minutes waited until someone had time to write them, and three days later everyone remembered a different version.

This time Jimmy Chen uploaded the recording to the "New Product Introduction" channel. Within seconds the transcript was ready, followed by a meeting summary: decisions, who is responsible, and when each is due, each item followed by the transcript line it came from.

On one of them he clicked "Create task assignment": **Jig design, Master Liu, by Nov 25.**

In the transcript, "jig" (治具) was first heard as a similar-sounding word (制具). Ian Lin added the company's common terms (jig, fixture, first article, prototype material, 8D, Polaris Electronics) to the "company glossary," so next time it would be transcribed accurately.

> Polaris case status: terms confirmed; jig, hours, and quote each have an owner.
> Assets left behind: traceable decisions and meeting records.
> What the Company Brain did this time: **summary** (transcript and meeting summary), **task assignment** (turned into task assignments).
> Next question: now that the work is handed out, who follows up?

---

## Chapter 3　Work gets followed up (Day 26 of adopting AI)

> **Why follow-up only now**: the first two chapters left records and decisions behind, so the system knows who promised what and by when. Following up fairly is only possible once those records exist.

The Polaris order was split into three task assignments: drawing confirmation for Mandy Lin, hours estimate for Master Liu, and the quote for Jimmy Chen. Jimmy Chen also handed "prepare the customer spec comparison table" to AI. When AI finished, he reviewed it and clicked confirm.

Master Liu promised the hours estimate by Wednesday. It was Friday, and it still wasn't there.

In the past, this kind of thing waited until Jimmy Chen remembered to ask, or until the customer called to chase. This time, when the weekly report ran, Master Liu's manager received a "supervision" task assignment stating which day Master Liu had promised what, with his original words attached, and Master Liu himself received a reminder.

Nobody was called out in public. The task simply didn't fall through the cracks.

On Friday afternoon, David opened the weekly work report, a slide deck ready to present at the weekly meeting: highlights of the week, the status of each task assignment, suggestions for next week, with a source on every page.

> Polaris case status: hours and technical evaluation complete; terms are in place; ready for the formal quote.
> Assets left behind: tasks, owners, deadlines, and completion records.
> What the Company Brain did this time: **task assignment**, **reminders** (to the person and to the manager), **summary** (weekly work report).
> Next question: the quote depends on Master Liu. What if he isn't there?

---

## Chapter 4　A veteran's experience becomes a skill (Day 45 of adopting AI) ★

> **Why the second month**: you need a period of accumulated records before you can see which steps the veteran follows "every single time." AI can organize them, but which steps can go to newcomers and which need a manager's decision must be confirmed by people.

Master Liu has four steps of his own for estimating a price: check the material spec, plan the process steps, look at similar past quotes, and finally calculate cost. Over the past month he had followed these four steps three times in the engineering channel.

The system organized those three instances into a "skill suggestion," with sources attached. But David didn't click adopt right away.

He called Jimmy Chen and Master Liu in. "Which of these steps can a new hire follow? Which data can a new hire see? Which prices must a manager always decide?"

The three of them spent half an hour editing. The final quotation skill states that material, process steps, and historical references can be used by newcomers, while **any cost or delivery term with no basis is always marked "to be confirmed" and decided by a manager.** Only after that confirmation did the administrator click adopt.

Two weeks later, on a Tuesday, Master Liu took three days off. At noon the Polaris purchasing department called: "Can we get a quote this afternoon?"

In the past, all the company could say at a moment like this was "please wait until the Master gets back."

Leo Lin, a new sales hire who had joined only two weeks earlier, had registered with the sales department's passphrase and been approved by his manager. He opened the quotation skill. AI walked him through the steps, preparing the material spec, process steps, historical quotes, and cost table in order, and produced a draft quote. Two cost items had no basis, and the draft clearly marked them "to be confirmed."

Leo handed the draft to Jimmy Chen. Jimmy filled in those two items, confirmed it, and only then replied to the customer.

**AI prepared the quote, but the one who commits to a price with the customer is a person.**

> Polaris case status: quote draft complete; manager confirming.
> Assets left behind: a reusable quotation skill.
> What the Company Brain did this time: **skill** (quotation steps confirmed by people), **audit** (who adopted it, who confirmed it).
> Next question: the draft is right, but does the formal quotation form still have to be retyped?

---

## Chapter 5　AI takes action, but doesn't make things up (Day 47 of adopting AI)

> **Why AI is allowed to act only now**: the steps and data have been confirmed, so AI has a basis for using tools. Where something is missing, it asks instead of filling it in itself.

Jimmy Chen read the draft. The content was mostly complete, but it couldn't be sent to Polaris yet. The customer name, items, quantities, delivery date, and quote validity period all had to be entered into the company's official quotation form.

In the past, Mandy Lin retyped all of it, and often got a number wrong.

This time Leo asked AI to "fill in the quotation form." AI came back first with a question: "The quote validity period hasn't been confirmed. How many days should I enter?" It did not fill it in on its own. Leo asked Jimmy Chen, entered thirty days, and only then did AI produce the PDF.

Jimmy Chen opened it and checked it; everything was right. He sent it to Polaris.

Meanwhile, in the supplier evaluation channel, Purchasing asked AI to search the web for information on two aluminum suppliers. Every item came with a source link, so everyone could click through and check for themselves.

> Polaris case status: formal quote sent; customer confirms the order.
> Assets left behind: controlled tools and tasks that can be executed.
> What the Company Brain did this time: used **tools** to fill in the formal quotation form and search the web; where information was missing, it did not fill in blanks.
> Next question: the order is in. Every day, organizing orders and chasing delivery dates is yet another job that comes up daily.

---

## Chapter 6　Repetitive work goes to a workflow (Day 75 of adopting AI)

> **Why a workflow comes last**: a workflow follows the same steps every day, so if the method isn't settled, mistakes get repeated every day too. That's why it is handed to n8n only once the method is fixed, tested, and reviewed. AI does the thinking, n8n follows the steps, and people make the decisions.

After Polaris placed the order, the first thing Ryan Wu in Production Planning did every morning was to go through the status of all orders, then pick out those nearing their delivery dates and remind the people responsible.

"This is the same every day. Can the system do it?"

He asked AI to build an n8n workflow: at 9:00 every morning, compile order statuses; three days before a delivery date, remind the person responsible; and list separately any orders with no delivery date so someone can fill them in.

He ran a trial in the test environment: the order that was due got a reminder, the one not yet due did not, and the order missing a delivery date was listed. Running the same order again did not send a duplicate reminder. He deliberately set the notification recipient wrong; the system logged an error and notified him as well.

**A trial run needs no approval, but only on test data and test recipients.** To make it available to the whole company, he clicked "Publish," and it went live only after Ian Lin reviewed it.

At 9:00 the next morning, the workflow ran by itself. For the first time, Ryan didn't open a spreadsheet.

> Polaris case status: in production; delivery date tracked daily by the workflow.
> Assets left behind: an automated workflow that runs on a schedule.
> What the Company Brain did this time: **workflow** (n8n runs on time every day), **audit** (publishing review, error log).

---

## Epilogue　Three months later

On a Monday three months later, David asked at the weekly meeting: "Where is the Polaris order now?"

This time nobody flipped through a notebook. Ryan Wu said, "It ships tomorrow. The workflow already sent the reminder yesterday."

The company didn't become smart overnight. Employees simply left a record of their work every day in their own words, and the Company Brain slowly turned those records into work that can be handed over and tracked: when people leave, the memory stays; when the veteran is away, the method stays.

David knows there is more ahead: billing, warranty, and renewals still to take on. Version history and the workflows of more departments can be built up gradually on your own, or built together with the consultants.

> **Everything in the Community Edition you can do yourselves. If you want to save time, avoid detours, or have someone accountable for delivery and handover, come to our consulting service.**

---

| Time | The Polaris deal | Assets the company keeps |
|---|---|---|
| Weeks 1-2 | Inquiry received; drawing enters the system | Department channels, daily operations records |
| Week 3 | Terms confirmed | Traceable decisions and meeting records |
| Week 4 | Hours and technical evaluation complete | Tasks, owners, deadlines, and completion records |
| Month 2 | Quote draft → formal quote → order | Quotation skill, controlled tools |
| Month 3 | Production scheduling and delivery tracking | Automated workflow that runs on a schedule |

(Three months is a demonstration timeline, not a guarantee for every company.)

---

## Cast of Characters (Chinese and English names)

| Role | Chinese | English |
|---|---|---|
| Chairman | 王董 | David Wang |
| | 陳志明 | Jimmy Chen |
| | 林美君 | Mandy Lin |
| | 張建國 | Kevin Chang |
| | 劉師傅 | Master Richard Liu (later "Richard") |
| | 小林 | Leo Lin |
| | 吳排程 | Ryan Wu |
| | 林資訊 | Ian Lin |
| | 黃班長 | Tony Huang |
| | 周作業 | Joe Chou |
| | 許夜班 | Sam Hsu |
| | 蔡品保 | Grace Tsai |
| | 鄭財務 | Fiona Cheng |
