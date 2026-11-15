// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Screenshots of existing conversations for the report. SHOT_SESSIONS = "name=sessionId,name=sessionId", run as member A.
import { chromium } from "playwright";
const e = process.env;
const browser = await chromium.launch(e.CHROMIUM_PATH ? { executablePath: e.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, locale: "en-US" });
const page = await ctx.newPage();
await page.goto(`${e.E2E_BASE_URL}/tg/login`);
await page.getByLabel("Email").fill(e.MEMBER_A_EMAIL);
await page.getByLabel("Password").fill(e.MEMBER_A_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/tg/login"));
for (const pair of (e.SHOT_PATHS ?? "").split(",").filter(Boolean)) {
  const [name, path] = pair.split("=");
  await page.goto(`${e.E2E_BASE_URL}${path}`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${e.SHOTS_DIR}/${name}-v1.png` });
  console.log("shot", name);
}
for (const pair of (e.SHOT_SESSIONS ?? "").split(",").filter(Boolean)) {
  const [name, id] = pair.split("=");
  await page.goto(`${e.E2E_BASE_URL}/?session=${id}`);
  await page.waitForTimeout(5000);
  await page.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== "visible") el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${e.SHOTS_DIR}/${name}-v1.png` });
  console.log("shot", name);
}
await browser.close();
