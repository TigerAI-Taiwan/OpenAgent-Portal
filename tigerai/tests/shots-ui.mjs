// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Walks the gen1 UI batch as admin / member / head against a running dev server and saves screenshots + a checklist.
// E2E_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, SHOTS_DIR, CHROMIUM_PATH (optional). Test data only; prints no secrets.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "../tools/client.mjs";

const e = process.env;
const base = e.E2E_BASE_URL, dir = e.SHOTS_DIR;
mkdirSync(dir, { recursive: true });
const PW = "Walk-through-2026-x";
const results = [];
const check = (name, ok, note = "") => { results.push({ name, ok: !!ok, note }); console.log(ok ? "PASS" : "FAIL", name, note); };

const admin = new Client(base);
await admin.login(e.ADMIN_EMAIL, e.ADMIN_PASSWORD);
async function member(name, email) {
  let list = (await admin.get("/api/tg/admin/users")).json.users;
  let u = list.find((x) => x.email === email);
  const c = new Client(base);
  if (!u) {
    const created = await admin.post("/api/tg/admin/users", { email, name, role: "member" });
    await c.login(email, created.json.initialPassword);
    await c.post("/api/tg/account/password", { current: created.json.initialPassword, next: PW });
    u = (await admin.get("/api/tg/admin/users")).json.users.find((x) => x.email === email);
  }
  await c.login(email, PW);
  return { c, u };
}
const wang = await member("王小明", "wang@example.com");
const lin = await member("林小華", "lin@example.com");
let groups = (await admin.get("/api/tg/admin/groups")).json.groups;
let g = groups.find((x) => x.name === "品保部");
if (!g) { await admin.post("/api/tg/admin/groups", { name: "品保部" }); g = (await admin.get("/api/tg/admin/groups")).json.groups.find((x) => x.name === "品保部"); }
await admin.req("PUT", `/api/tg/admin/groups/${g.id}/members`, { userId: wang.u.id, present: true });
await admin.req("PUT", `/api/tg/admin/groups/${g.id}/members`, { userId: lin.u.id, present: true });

// a room made by 王小明 with 林小華 in it; admin is not a member
const existing = (await wang.c.get("/api/tg/rooms")).json.rooms.find((r) => r.name === "品質討論");
const made = existing ? { json: { room: existing } } : await wang.c.post("/api/tg/rooms", { name: "品質討論" });
const roomId = made.json.room?.id;
if (roomId && !existing) {
  await wang.c.post(`/api/tg/rooms/${roomId}/members`, { userId: lin.u.id });
  await wang.c.post(`/api/tg/rooms/${roomId}/messages`, { text: "大家好,今天的 **不良率** 報告如下:\n\n| 線別 | 不良率 |\n|---|---|\n| A | 0.8% |" });
  await lin.c.post(`/api/tg/rooms/${roomId}/messages`, { text: "收到,我來看看。" });
}

const browser = await chromium.launch(e.CHROMIUM_PATH ? { executablePath: e.CHROMIUM_PATH } : {});
async function open(client, size = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport: size, locale: "zh-TW" });
  const ck = client.cookie.split("=");
  await ctx.addCookies([{ name: ck[0], value: ck.slice(1).join("="), url: base }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (x) => errors.push(String(x)));
  page.on("response", (r) => { if (r.status() >= 400 && !/open-in-explorer/.test(r.url())) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  return { ctx, page, errors };
}
const shot = async (page, name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/${name}.png` }); };
const text = (page) => page.evaluate(() => document.body.innerText);

for (const [who, client] of [["admin", admin], ["wang", wang.c], ["lin", lin.c]]) {
  const { page, errors } = await open(client);
  await page.goto(base + "/", { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, `${who}-01-home`);
  const body = await text(page);
  check(`${who}: no 'New room' / English footer text`, !/Rooms|Prompts|Administration|Sign out/.test(body));
  check(`${who}: bottom icon row`, (await page.locator("[data-tg-bottom] button").count()) === (who === "admin" ? 3 : 1), `${await page.locator("[data-tg-bottom] button").count()}`);
  check(`${who}: model picker ${who === "admin" ? "kept" : "hidden"}`, who === "admin" ? true : (await page.getByText(/provider|模型選擇/).count()) === 0);
  await page.getByRole("button", { name: "新增" }).first().click();
  await shot(page, `${who}-02-plus-menu`);
  check(`${who}: + menu has 3 entries`, (await page.getByRole("menuitem").count()) === 3);
  await page.getByRole("menuitem", { name: "新頻道" }).click();
  await shot(page, `${who}-03-new-room-dialog`);
  await page.getByRole("button", { name: "取消" }).click();
  if (roomId) {
    await page.getByRole("button", { name: /# 品質討論/ }).first().click();
    await page.waitForTimeout(1500);
    await shot(page, `${who}-04-room`);
    const t = await text(page);
    check(`${who}: room shows messages`, /不良率/.test(t));
    check(`${who}: room has table markdown`, (await page.locator("[data-tg-room] table").count()) > 0);
    if (who === "admin") {
      check("admin: non-member banner", /你以管理員身分檢視/.test(t));
      check("admin: composer disabled + 加入頻道", (await page.locator("[data-tg-composer-disabled] textarea[disabled]").getAttribute("placeholder")) === "你不是這個頻道的成員" && (await page.getByRole("button", { name: "加入頻道" }).count()) === 1);
    } else {
      check(`${who}: composer enabled`, (await page.locator("[data-tg-composer] textarea").count()) > 0);
      await page.locator("[data-tg-composer] textarea").fill("@");
      await page.waitForTimeout(500);
      await shot(page, `${who}-05-at-popup`);
      check(`${who}: @ popup lists members and AI`, (await page.getByRole("option").count()) >= 2);
    }
    await page.getByRole("button", { name: "更多" }).click();
    await shot(page, `${who}-06-room-menu`);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: /的設定|設定/ }).last().click();
  await page.waitForTimeout(800);
  await shot(page, `${who}-07-settings`);
  const tabs = await page.locator(".tgs-tabs .tgx-row").allInnerTexts();
  check(`${who}: settings tabs`, who === "admin" ? tabs.length >= 12 : tabs.length === 3, tabs.join("|"));
  if (who === "admin") {
    for (const [label, name] of [["模型", "models"], ["交辦單", "assign"], ["已刪除頻道", "deleted"], ["AI 角色", "roles"], ["n8n", "n8n"], ["稽核紀錄", "audit"], ["成員", "users"]]) {
      await page.locator(".tgs-tabs .tgx-row", { hasText: label }).first().click();
      await shot(page, `admin-08-tab-${name}`);
    }
  } else {
    await page.locator(".tgs-tabs .tgx-row", { hasText: "交辦單" }).click();
    await shot(page, `${who}-08-assignments`);
  }
  check(`${who}: no console errors`, errors.length === 0, errors.slice(0, 2).join(" // ").slice(0, 200));
  await page.close();
}

// phone width
{
  const { page } = await open(wang.c, { width: 400, height: 800 });
  await page.goto(base + "/?room=" + roomId, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, "wang-09-phone-room");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("phone: room no horizontal scroll", !overflow);
  await page.goto(base + "/?settings=account", { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "wang-10-phone-settings");
  check("phone: settings no horizontal scroll", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
}
await browser.close();
writeFileSync(`${dir}/checklist.md`, results.map((r) => `- [${r.ok ? "x" : " "}] ${r.name}${r.note ? ` (${r.note})` : ""}`).join("\n") + "\n");
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
