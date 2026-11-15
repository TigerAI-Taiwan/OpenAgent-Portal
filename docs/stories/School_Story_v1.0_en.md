# Learning AI Agents: Professor Wang's Semester

(Story outline v1.0 · 2026-11-16 · Fictional school, teacher, and students)

> Students aren't here to learn "how to ask AI." They are here to learn how to read the details and get AI to do the job right.

---

## Foreword　Why this course, and why it is arranged this way

Students are already using AI for their homework. The trouble is that the teacher can't tell what they have learned, and the students only learn to "paste the question into AI."

This course doesn't teach "how to ask AI." It teaches three abilities you will need in any future job:

| Ability | Why it matters |
|---|---|
| **Reading the details and saying what is wrong** | AI's first version often "looks done but is actually wrong." People who can point out what is wrong and demand a fix are using AI; the others are being used by it |
| **Telling models' capabilities apart** | The same task gives very different results from different models. Many people overlook this and assume AI is just AI |
| **Knowing what to give the Agent, what to give a workflow, and what to keep for people** | In future work, flexible tasks go to an Agent, fixed tasks go to a workflow, and people make the decisions |

Why a shared platform instead of letting each student use their own AI:

- The whole class uses **one entrance**, and the teacher sets up the course, approves requests, and reviews records all in one place;
- Each student uses **their own free key**, so nobody pays, and each person's usage is visible;
- Conversations, assignments, and group discussions are all **kept on record**, so the teacher has evidence rather than guesses.

Why the four assignments are in this order:

| Order | What is learned | Why it comes here |
|---|---|---|
| Assignment 1: Bear on a bicycle | Prompting and details; model capability | The most intuitive: you can tell at a glance whether the picture is right; learn to "see details" first |
| Assignment 2: Library card | Agents use tools and check their work | Moving from "generating" to "doing": AI has to produce a real file, and it can't guess |
| Assignment 3: n8n financial report | Agent and workflow | Moving from "doing something once" to "doing it every day": fixed tasks go to a workflow |
| Assignment 4: Group research | Teams working with AI | Apply the first three in a team: collect, research, and summarize, with people making the judgment |

---

## Prologue　The week before the semester

Professor Wang has taught programming at the university for ten years. This year the department head asked her, "Would you like to teach the AI Agent course?"

Her first reaction was a headache. Every student uses a different AI, some paying and some not; the assignments handed in don't show who actually did the work; and most of all, she doesn't know whether the students are actually learning.

The TigerAI team set up the machine for her and gave her an administrator account. The first time she logged in she was required to change her password, and then she changed the email under "Settings → Account" to her own.

She did just three things: created a course called "AI Agent Hands-On, Fall 2026," set a passphrase, and uploaded her lecture notes to the "Course Teaching Assistant."

Before the semester began, she posted an announcement on the course website: **Before class, please apply for a free key from NVIDIA. In this course, you won't spend a single dollar.**

---

## Class 1　Joining the course (Week 1)

The bell rings, and Professor Wang writes the passphrase on the blackboard.

Thirty students open their browsers and click "Register," entering their names in the form "student ID-class-name": B11201-CS Year 3 Class A-Chloe Lin, B11202-CS Year 3 Class A-Eric Chen, and so on.

One student mistypes a character in the passphrase and is blocked; the classmate next to him registers without trouble and doesn't have to wait for him.

Professor Wang's phone shows a notification: "30 requests to join 'AI Agent Hands-On, Fall 2026'." She glances at the list and clicks "Approve this whole group."

Then each student goes to "My model connections," chooses "NVIDIA (free)," pastes in the key, picks glm, and clicks "Test." When the green light comes on, voices around the classroom say, "It works."

> What students learn: how one system lets the whole class use AI together, each with their own key.
> What the teacher gets: a student roster she can take attendance from.

---

## Assignment 1　Bear on a bicycle (Weeks 2-3)

Professor Wang puts the task on the screen: "Using a single HTML file, make an animation of a bear riding a bicycle toward the right. Grading looks at details: whether the structure and motion look real."

Eric Chen is the first to hand in a first version. The bear moves, the bicycle moves, even the background moves. He is very pleased.

Professor Wang walks over. "Look at the wheel."

The wheel turns, but the lines on the ground slide backward at a speed that doesn't match the wheel, so the wheel is slipping. The bear's feet aren't on the pedals either; they are paddling in mid-air.

"Don't ask AI what's wrong yet," Professor Wang says. "After class, go look at a real bicycle by the school gate. Then come back and write down three things that don't look real."

The following week, Eric's notebook reads: the feet must follow the pedals, the chain must move, and distant trees must move more slowly than near ones. He gave those three points to AI, then asked AI to check for anything else that didn't look real. By the second and third versions, the bear was really "pedaling" the bicycle.

Next to him, Tina Huang tried the same task with a different model, and her first version was very different. Some models couldn't even produce code that ran.

Professor Wang says in class: "The quality of the first version is the model's score. How much you improved from the first version to the best version is your score."

> What students learn: how well a prompt works depends on how much you know about real-world details, and every model has different capabilities.

---

## Assignment 2　The library card (Week 4)

"This one is easy," Professor Wang says. "Ask AI to fill out a library card application for you."

Chloe Lin types her information to AI. AI doesn't just fill it in. It replies: "Your mobile number and registered address haven't been provided, and your birthday and age don't match. Please confirm."

Chloe is startled. She really had typed her age wrong.

Only after she completes the information does AI produce the PDF. The text lines up box by box with the original application form, and the signature field is left blank.

Professor Wang says: "This is what makes an Agent different from a chat AI. It uses tools to produce a file, it checks first, and it doesn't guess just to get something handed in. The signature is always signed by you."

> What students learn: Agents use tools, check their work, and don't guess.

---

## Assignment 3　n8n financial report analysis (Weeks 5-7)

For these three weeks, Professor Wang invited an n8n instructor from industry to share a real case: one person, one AI Agent, and n8n, building a Taiwan stock financial report analysis system that downloads reports, has AI extract the numbers, compares them against official data, and finally produces a report.

Howard Chang is the most interested. Following the n8n skill the professor provided, he asked AI to build a simplified workflow for him: look up a company's monthly revenue.

AI built the workflow in n8n. He clicked "Test," and the first run failed: the URL was wrong. He opened n8n's execution log, and the red cell said exactly where the error was. After he fixed it and ran it again, everything turned green.

Building it and testing it himself needed no approval from the teacher. Only when he felt it was good enough and wanted to share it with the whole class did he click "Publish," which sent a task assignment to Professor Wang for review.

Professor Wang drew a table in class:

**AI Agent does the thinking, n8n follows the steps, people make the decisions.**

> What students learn: the difference between an Agent and a workflow, and how to turn AI's ideas into a process you can see and control.

---

## Assignment 4　Group research: Agent vs n8n (Weeks 8-10)

The last assignment is a group project. The question: "If Assignment 3 were done entirely by an AI Agent versus done with n8n, what are the pros and cons of each?"

Cindy Lee's group opened a channel of their own and brought in the members and Professor Wang. Each person first posted their own view in the channel: some said an Agent is more flexible, others said n8n gives the same result every time and is easier to debug when something goes wrong.

Then someone typed: "@AI For each classmate's idea, search the web for reference material, and attach a link to every item." AI looked them up one by one, attaching a URL to every entry.

When the discussion was done, one more line: "@AI Turn our analysis into a report deck." A PDF and an editable pptx appeared in the channel.

On presentation day, Professor Wang noticed that every slide from this group had a note at the bottom saying where the information came from.

> What students learn: how a team works with AI to collect information, research, and summarize, and then makes the final judgment themselves.

---

## End of term　What the teacher saw

At the end of the term, Professor Wang opens the "User records."

For every student, she can see when they last logged in, how much time they spent this semester, and what they talked about with AI. Students' settings pages have also said all along: "Administrators can view your conversations."

She exports a CSV. The system does not assign any grades.

"I decide the grades," she says. "The system gives me the evidence."

When the term ends, she archives the course. Next semester, on the same machine, she will open a new one.

> **Want the complete lecture slides? Please contact TigerAI (tiger.ai.tw@gmail.com); they are free.**

---

| Week | Lesson | What students learn |
|---|---|---|
| Week 1 | Joining the course, free NVIDIA key | The whole class uses AI together, each with their own key |
| Weeks 2-3 | Bear on a bicycle | Prompting and details; recognizing model capability |
| Week 4 | Library card | Agents use tools, check their work, and don't guess |
| Weeks 5-7 | n8n financial report analysis | The difference and division of labor between Agent and workflow |
| Weeks 8-10 | Group research | A team and AI collecting, researching, and summarizing together |
| End of term | User records, export | The teacher gets evidence; she decides the grades |

---

## Cast of Characters (Chinese and English names)

| Chinese | English |
|---|---|
| 王老師 | Professor Wang |
| 林小晴 | Chloe Lin |
| 陳柏宇 | Eric Chen |
| 張家豪 | Howard Chang |
| 黃雅婷 | Tina Huang |
| 李欣妍 | Cindy Lee |
