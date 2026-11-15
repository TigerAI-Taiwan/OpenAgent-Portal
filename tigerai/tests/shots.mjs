// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Screenshots for the first-generation report. Needs the same environment as the contract tests plus SHOTS_DIR.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { Client } from "../tools/client.mjs";
import { buildXlsx, sampleOrgSheets } from "../tools/xlsx-writer.mjs";
import { writeFixtureSession } from "../tools/fixture-session.mjs";

const e = process.env;
const base = e.E2E_BASE_URL;
const dir = e.SHOTS_DIR;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(e.CHROMIUM_PATH ? { executablePath: e.CHROMIUM_PATH } : {});
const shot = async (page, name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/${name}-v1.png` }); console.log("shot", name); };

async function uiLogin(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${base}/tg/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/tg/login"));
  return { ctx, page };
}

// 1. login page
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${base}/tg/login`);
  await page.getByLabel("Email").waitFor();
  await shot(page, "01-login");
  await ctx.close();
}

// API side: data for the pictures
const admin = new Client(base); await admin.login(e.ADMIN_EMAIL, e.ADMIN_PASSWORD);
const a = new Client(base); await a.login(e.MEMBER_A_EMAIL, e.MEMBER_A_PASSWORD);
const b = new Client(base); await b.login(e.MEMBER_B_EMAIL, e.MEMBER_B_PASSWORD);
const aMe = (await a.get("/api/tg/me")).json;
const bMe = (await b.get("/api/tg/me")).json;
const aHome = (await a.get("/api/home")).json.home;

// 2. admin pages
{
  const { ctx, page } = await uiLogin(e.ADMIN_EMAIL, e.ADMIN_PASSWORD);
  await page.goto(`${base}/tg/admin`);
  await page.getByRole("button", { name: "Groups" }).click();
  await shot(page, "02-admin-groups");
  await page.getByRole("button", { name: "Accounts" }).click();
  await shot(page, "02b-admin-accounts");
  await ctx.close();
}

// 3. member A's conversation, invisible to B
const sid = writeFixtureSession({
  agentDir: e.PI_CODING_AGENT_DIR, tigerDir: e.TIGERAI_DATA_DIR, userId: aMe.id, cwd: aHome, name: "Alice: quarterly plan",
  question: "Draft the outline of our quarterly plan.", answer: "Outline: 1. Goals 2. Milestones 3. Risks 4. Owners.",
});
{
  const { ctx, page } = await uiLogin(e.MEMBER_A_EMAIL, e.MEMBER_A_PASSWORD);
  await page.goto(`${base}/`);
  await page.getByText("Alice: quarterly plan").first().waitFor({ timeout: 20000 }).catch(() => console.log("A list: own conversation not found"));
  await shot(page, "03-member-a-sees-own");
  await ctx.close();
}
{
  const { ctx, page } = await uiLogin(e.MEMBER_B_EMAIL, e.MEMBER_B_PASSWORD);
  await page.goto(`${base}/`);
  await page.waitForTimeout(3000);
  await shot(page, "04-member-b-cannot-see");
  const denied = await page.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).status, sid);
  console.log("B direct api status", denied);
  await page.goto(`${base}/?session=${sid}`);
  await page.waitForTimeout(3000);
  await shot(page, "05-member-b-direct-url");
  await ctx.close();
}

// 4. rooms
const tag = Math.random().toString(36).slice(2, 5);
const room = (await a.post("/api/tg/rooms", { name: `Launch plan ${tag}` })).json.room;
await a.post(`/api/tg/rooms/${room.id}/members`, { userId: bMe.id });
await a.post(`/api/tg/rooms/${room.id}/messages`, { text: "Kick-off is on Monday. Please read the brief first." });
await a.post(`/api/tg/rooms/${room.id}/messages`, { text: `@${bMe.name} can you own the schedule?` });
await a.post(`/api/tg/rooms/${room.id}/messages`, { text: "@AI In one short sentence, what is this room planning?" });
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if ((await a.get(`/api/tg/rooms/${room.id}`)).json.messages.some((m) => m.kind === "ai")) break;
}
{
  const { ctx, page } = await uiLogin(e.MEMBER_B_EMAIL, e.MEMBER_B_PASSWORD);
  await page.goto(`${base}/tg/rooms`);
  await page.getByText(`Launch plan ${tag}`).first().waitFor();
  await shot(page, "06-room-list-unread-b");
  await page.getByText(`Launch plan ${tag}`).first().click();
  await page.getByTestId("room-messages").waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole("textbox", { name: /Write a message/ }).fill("Sure, I will take it. @");
  await shot(page, "07-room-mention-picker-b");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: /Write a message/ }).fill("Sure, I will take the schedule.");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await shot(page, "08-room-chat-b");
  await ctx.close();
}

// 5. org import through the page
{
  const { ctx, page } = await uiLogin(e.ADMIN_EMAIL, e.ADMIN_PASSWORD);
  await page.goto(`${base}/tg/admin`);
  await page.getByRole("button", { name: "Organisation" }).click();
  const file = await buildXlsx(sampleOrgSheets(`S${tag}`));
  await page.getByLabel("Upload org.xlsx").setInputFiles({ name: "org.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByText("unitsCreate").waitFor();
  await shot(page, "09-org-preview");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByTestId("org-passwords").waitFor();
  await shot(page, "10-org-applied");
  await ctx.close();
}

// 5b. n8n: a registered webhook (fake receiver), the admin page, and a conversation that uses it
if (e.N8N_MOCK_URL) {
  const g = (await admin.post("/api/tg/admin/groups", { name: `Finance ${tag}` })).json.group;
  await admin.req("PUT", `/api/tg/admin/groups/${g.id}/members`, { userId: aMe.id, present: true });
  const wh = await admin.post("/api/tg/admin/n8n/webhooks", { name: `monthly-revenue-${tag}`, url: `${e.N8N_MOCK_URL}/webhook/monthly-revenue`, description: 'Looks up the monthly revenue of a listed company. Send {"co_id": "<stock code>"}. Returns JSON with the company name, month and revenue_ntd_thousand (thousand NTD).' });
  await admin.req("PATCH", `/api/tg/admin/n8n/webhooks/${wh.json.id}`, { group_ids: [g.id] });
  const key = await admin.post("/api/tg/admin/n8n/keys", { name: `wf-${tag}` });
  const { ctx: actx, page: apage } = await uiLogin(e.ADMIN_EMAIL, e.ADMIN_PASSWORD);
  await apage.goto(`${base}/tg/admin`);
  await apage.getByRole("button", { name: "n8n", exact: true }).click();
  await apage.getByText(`monthly-revenue-${tag}`).first().waitFor();
  await shot(apage, "13-admin-n8n");
  await actx.close();
  const nsid = (await a.post("/api/agent/new", { cwd: aHome, type: "ensure_session" })).json.sessionId;
  await a.post(`/api/agent/${nsid}`, { type: "set_session_name", name: "Delta Electronics revenue (n8n)" });
  await a.post(`/api/agent/${nsid}`, { type: "prompt", message: "How much revenue did Delta Electronics (2308) make last month? Use the n8n webhook and answer with the number." });
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = (await a.post(`/api/agent/${nsid}`, { type: "get_state" })).json.data;
    if (st && !st.isStreaming && (await a.post(`/api/agent/${nsid}`, { type: "get_last_assistant_text" })).json.data.text) break;
  }
  const { ctx: nctx, page: npage } = await uiLogin(e.MEMBER_A_EMAIL, e.MEMBER_A_PASSWORD);
  await npage.goto(`${base}/?session=${nsid}`);
  await npage.waitForTimeout(4000);
  await shot(npage, "14-n8n-conversation-member-a");
  await nctx.close();
  if (key.json.plaintext) console.log("inbound key created (not printed)");
}

// 6a. library: A heads a department; an administrator publishes; A ticks it for the department
const dept = (await admin.post("/api/tg/admin/groups", { name: `Dept ${tag}` })).json.group;
await admin.req("PUT", `/api/tg/admin/groups/${dept.id}/members`, { userId: aMe.id, present: true, isManager: true });
const pub = (await admin.post("/api/tg/admin/prompts", { name: `weekly-report-${tag}`, description: "Turn notes into a weekly report", body: "Write a weekly report from: $ARGUMENTS" })).json.prompt;
await a.post(`/api/tg/prompts/${pub.id}/ticks`, { groupId: dept.id });
await a.post("/api/tg/prompts", { name: `my-checklist-${tag}`, description: "Private checklist", body: "Make a checklist for: $ARGUMENTS" });
{
  const { ctx, page } = await uiLogin(e.MEMBER_A_EMAIL, e.MEMBER_A_PASSWORD);
  await page.goto(`${base}/?session=${sid}`);
  await page.waitForTimeout(3500);
  const box = page.locator("textarea").last();
  await box.click();
  await box.type("/");
  await page.waitForTimeout(1200);
  await shot(page, "12-slash-menu-member-a");
  await ctx.close();
}
// 6. prompt library: A's own page and the "/" menu in a new conversation
{
  const { ctx, page } = await uiLogin(e.MEMBER_A_EMAIL, e.MEMBER_A_PASSWORD);
  await page.goto(`${base}/tg/prompts`);
  await page.getByRole("heading", { name: "My prompts (private)" }).waitFor();
  await shot(page, "11-prompts-member-a");
  await ctx.close();
}
await browser.close();
