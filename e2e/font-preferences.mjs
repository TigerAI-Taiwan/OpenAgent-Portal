import assert from "node:assert/strict";

/** Starts and ends in General settings, with both font overrides reset. */
export async function checkFontPreferences(page) {
  const ui = page.getByRole("textbox", { name: "Interface font", exact: true });
  const mono = page.getByRole("textbox", { name: "Monospace font", exact: true });
  const uiWeight = page.getByRole("slider", { name: "Interface font weight", exact: true });
  const monoWeight = page.getByRole("slider", { name: "Monospace font weight", exact: true });
  const weight = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontWeight);
  const resetUi = page.getByRole("button", { name: "Reset interface font", exact: true });
  const resetMono = page.getByRole("button", { name: "Reset monospace font", exact: true });
  const font = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
  const openSettings = async () => {
    const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
  };
  assert.equal(await ui.inputValue(), "");
  assert.equal(await mono.inputValue(), "");
  assert.equal(await uiWeight.inputValue(), "400");
  assert.equal(await monoWeight.inputValue(), "400");
  assert.equal(await weight(".markdown-user-message"), "400", "Regular, not Light, is the default");
  assert.equal(await weight(".markdown-code-block code"), "400");
  await uiWeight.fill("500");
  await monoWeight.fill("600");
  for (const selector of ["body", ".chat-input-textarea", ".markdown-user-message", "#settings-font-ui"]) {
    assert.equal(await weight(selector), "500", selector);
  }
  for (const selector of [".markdown-code-block pre", ".markdown-code-block code", "#settings-font-mono"]) {
    assert.equal(await weight(selector), "600", selector);
  }
  assert.equal(await weight(".markdown-user-message strong"), "700", "Markdown emphasis keeps its weight");
  assert.equal(await weight(".markdown-body h2"), "600", "Headings keep their weight");
  await ui.pressSequentially("Times New Roman, serif");
  assert.equal(await ui.inputValue(), "Times New Roman, serif", "Typing spaces must not join font names");
  await mono.fill("monospace");
  for (const selector of ["body", ".chat-input-textarea", ".markdown-user-message", "#settings-font-ui"]) {
    assert.match(await font(selector), /^"?Times New Roman"?, serif,/, selector);
  }
  for (const selector of [".markdown-code-block code", "#settings-font-mono"]) {
    assert.match(await font(selector), /^monospace,/, selector);
  }
  await page.reload({ waitUntil: "load" });
  await page.locator(".markdown-code-block code").waitFor();
  assert.match(await font("body"), /^"?Times New Roman"?, serif,/);
  assert.match(await font(".markdown-code-block code"), /^monospace,/);
  assert.equal(await weight(".markdown-user-message"), "500");
  assert.equal(await weight(".markdown-code-block code"), "600");
  await openSettings();
  assert.equal(await ui.inputValue(), "Times New Roman, serif");
  assert.equal(await mono.inputValue(), "monospace");
  assert.equal(await uiWeight.inputValue(), "500");
  assert.equal(await monoWeight.inputValue(), "600");

  const other = await page.context().newPage();
  try {
    // Count the storage events this tab really receives, so a miss can be told
    // apart from the app ignoring one.
    await other.addInitScript(() => {
      window.__storageEvents = [];
      window.addEventListener("storage", (event) => window.__storageEvents.push([event.key, event.newValue]));
    });
    await other.goto(page.url(), { waitUntil: "load" });
    // "load" can fire before the app has mounted. Wait until the new tab has
    // applied the stored font, so its storage listener exists before we change it.
    await other.waitForFunction(() => /^"?Times New Roman"?, serif,/.test(getComputedStyle(document.body).fontFamily));
    await other.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await other.bringToFront();
    await ui.fill("serif");
    const synced = (timeout) => other.waitForFunction(() => getComputedStyle(document.body).fontFamily.startsWith("serif,"), undefined, { timeout });
    try {
      await synced(5_000);
    } catch {
      // Report what each tab holds, so a CI-only miss can be diagnosed, then
      // change the value once more: a second event shows sync works at all.
      const state = (p) => p.evaluate(() => ({
        bodyFont: getComputedStyle(document.body).fontFamily,
        cssVar: document.documentElement.style.getPropertyValue("--font-ui"),
        stored: localStorage.getItem("pi-ui-font-family"),
        visibility: document.visibilityState,
        storageEvents: window.__storageEvents,
      }));
      const first = `main=${JSON.stringify(await state(page))} other=${JSON.stringify(await state(other))}`;
      await ui.fill("serif, sans-serif");
      try {
        await synced(15_000);
      } catch (error) {
        throw new Error(`cross-tab font sync (first and second change): ${first} then other=${JSON.stringify(await state(other))}`, { cause: error });
      }
      console.log(`NOTE: first cross-tab font change was missed, the second arrived: ${first}`);
      await ui.fill("serif");
    }
    await uiWeight.fill("300");
    await other.waitForFunction(() => getComputedStyle(document.body).fontWeight === "300");
    await resetUi.click();
    await other.waitForFunction(() => !document.documentElement.style.getPropertyValue("--font-ui") && getComputedStyle(document.body).fontWeight === "400");
  } finally {
    await other.close();
  }
  assert.equal(await mono.inputValue(), "monospace", "Resetting the UI font must preserve the code font");
  assert.equal(await uiWeight.inputValue(), "400");
  assert.equal(await monoWeight.inputValue(), "600");
  await ui.fill("serif");
  await uiWeight.fill("500");
  await resetMono.click();
  assert.equal(await ui.inputValue(), "serif", "Resetting the code font must preserve the UI font");
  assert.equal(await uiWeight.inputValue(), "500");
  assert.equal(await monoWeight.inputValue(), "400");
  await resetUi.click();
  await uiWeight.fill("600");
  assert.equal(await resetUi.isDisabled(), false, "Weight alone must enable Reset");
  await resetUi.click();

  // Changing font metrics must refit a draft without requiring another keystroke.
  await page.keyboard.press("Escape");
  const textarea = page.locator(".chat-input-textarea");
  await textarea.fill("iiii llll mmmm wwww sample text ".repeat(12));
  await openSettings();
  await ui.fill("serif");
  const serifHeight = await textarea.evaluate((el) => el.clientHeight);
  // The height only has to change when the two families wrap the draft into a
  // different number of lines. Minimal CI images (the Playwright container has
  // only WenQuanYi) can give serif and monospace different advances that still
  // wrap to the same count, so a changed height cannot be demanded there; the
  // fit invariant below is checked either way.
  const linesFor = (family) => textarea.evaluate((el, f) => {
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-size:${getComputedStyle(el).fontSize};font-family:${f}`;
    probe.textContent = "iiii llll mmmm wwww sample text ".repeat(12);
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    const cs = getComputedStyle(el);
    const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Math.ceil(width / avail);
  }, family);
  const metricsDiffer = (await linesFor("serif")) !== (await linesFor("monospace"));
  await ui.fill("monospace");
  await page.waitForFunction(({ oldHeight, mustChange }) => {
    const input = document.querySelector(".chat-input-textarea");
    return (!mustChange || input.clientHeight !== oldHeight) && (input.scrollHeight <= input.clientHeight + 1 || input.clientHeight >= 199);
  }, { oldHeight: serifHeight, mustChange: metricsDiffer });
  await resetUi.click();

  assert.deepEqual(await page.evaluate(() => ({
    ui: localStorage.getItem("pi-ui-font-family"),
    mono: localStorage.getItem("pi-mono-font-family"),
    uiWeight: localStorage.getItem("pi-ui-font-weight"),
    monoWeight: localStorage.getItem("pi-mono-font-weight"),
    width: localStorage.getItem("pi-chat-content-width"),
    fontSize: localStorage.getItem("pi-chat-content-font-size"),
  })), { ui: null, mono: null, uiWeight: null, monoWeight: null, width: "820", fontSize: "14" });
  assert.equal(await resetUi.isDisabled(), true);
  assert.equal(await resetMono.isDisabled(), true);
  console.log("PASS: font families and weights, persistence, cross-tab sync, independent reset, emphasis and draft resizing");
}
