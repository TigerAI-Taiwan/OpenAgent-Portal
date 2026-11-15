// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Batch v10 (output default, 繼續 button, logo, compact fix, notice texts, images reach the model):
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-v10.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tg-v10-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
delete process.env.TIGERAI_V1_MAX_TOKENS;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const st = await import("../provider/settings.ts");
const v1 = await import("../provider/v1.ts");
const admin = await import("../provider/admin.ts");
const logic = await import("../ui/truncation-logic.ts");

test("default max output is 32768, never more than half the context", () => {
  assert.equal(st.defaultLimits().maxTokens, 32768);
  assert.deepEqual(st.effectiveLimits({ contextWindow: 64512, maxTokens: null }), { contextWindow: 64512, maxTokens: 32256 });
  assert.equal(st.effectiveLimits({ contextWindow: 131072, maxTokens: null }).maxTokens, 32768);
  assert.equal(st.effectiveLimits(undefined).maxTokens, 16384, "no report at all: 32768 context -> half of it");
  assert.equal(st.effectiveLimits({ contextWindow: 64512, maxTokens: 8000 }).maxTokens, 8000, "gateway value wins over the default");
  assert.equal(st.effectiveLimits({ contextWindow: 64512, maxTokens: 8000 }, { maxTokens: 500 }).maxTokens, 500, "admin override wins over everything");
});

test("input mapping: override, else gateway array, else text + image", () => {
  assert.deepEqual(st.effectiveInput(undefined), ["text", "image"]);
  assert.deepEqual(st.effectiveInput({ input: null }), ["text", "image"]);
  assert.deepEqual(st.effectiveInput({ input: ["text"] }), ["text"]);
  assert.deepEqual(st.effectiveInput({ input: ["text", "image"] }), ["text", "image"]);
  assert.deepEqual(st.effectiveInput({ input: null }, { images: false }), ["text"]);
  assert.deepEqual(st.effectiveInput({ input: ["text"] }, { images: true }), ["text", "image"]);
});

test("provisioning writes input per model, a stale 16384 is replaced, the admin switch applies without restart", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [
      { id: "no-report", context_length: 64512, input: null },
      { id: "text-only", context_length: 131072, input: ["text"] },
      { id: "vision", context_length: 131072, input: ["text", "image"] },
      { id: "bge-embedding-m3" },
    ] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const file = join(process.env.PI_CODING_AGENT_DIR, "models.json");
  try {
    st.writeSettings({ baseUrl: base });
    await v1.provisionV1();
    let models = Object.fromEntries(JSON.parse(readFileSync(file, "utf8")).providers.tigerai.models.map((m) => [m.id, m]));
    assert.deepEqual(models["no-report"].input, ["text", "image"]);
    assert.deepEqual(models["text-only"].input, ["text"]);
    assert.deepEqual(models["vision"].input, ["text", "image"]);
    assert.ok(!models["bge-embedding-m3"], "embedding models stay excluded");
    assert.equal(models["no-report"].maxTokens, 32256);
    assert.equal(models["text-only"].maxTokens, 32768);
    // admin turns pictures off for one model and on for another; stored like the other overrides
    const actor = "admin-1";
    const acc = await import("../accounts/service.ts");
    const a = acc.createUser(null, { email: "a@example.com", name: "A", role: "admin", password: "Test-Pass-12345!", mustChange: false }).user;
    const view = await admin.saveModelSettings(a.id, { overrides: { "no-report": { images: false }, "text-only": { images: true, maxTokens: 500 } } });
    assert.equal(view.overrides["no-report"].images, false);
    models = Object.fromEntries(JSON.parse(readFileSync(file, "utf8")).providers.tigerai.models.map((m) => [m.id, m]));
    assert.deepEqual(models["no-report"].input, ["text"]);
    assert.deepEqual(models["text-only"].input, ["text", "image"]);
    assert.equal(models["text-only"].maxTokens, 500);
    await assert.rejects(admin.saveModelSettings(a.id, { overrides: { x: { images: "yes" } } }), /images/);
    const list = await admin.gatewayModels();
    assert.equal(list.find((m) => m.id === "no-report").imagesDefault, true, "the page shows the gateway-derived default");
    assert.equal(list.find((m) => m.id === "text-only").imagesDefault, false);
    assert.equal(list.find((m) => m.id === "no-report").maxTokensDefault, 32256);
    void actor;
  } finally { server.close(); }
});

test("notice texts: member wording in the override layer, admin extra sentence from the slot", () => {
  const src0 = read("tigerai/ui/i18n-overrides.ts");
  const zh = src0.slice(src0.indexOf('"zh-TW": {'), src0.indexOf("  en: {"));
  const messages = Object.fromEntries([...zh.matchAll(/"(chat\.\w+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.equal(messages["chat.truncatedWithoutAnswer"], "AI 想太久，還沒寫出回答就用完這次的輸出額度。請按「繼續」再試一次；常發生的話，請管理員到 設定 → 模型 調高最大輸出。");
  assert.equal(messages["chat.truncatedByOutputLimit"], "回答太長，寫到一半用完這次的輸出額度。請按「繼續」讓 AI 接著寫。");
  const member = logic.truncationView({ unanswered: true, admin: false, canCompact: true, busy: false });
  assert.deepEqual(member, { showContinue: true, showCompact: false, showAdminExtra: false }, "members: 繼續 only, no 壓縮, no extra sentence");
  const adm = logic.truncationView({ unanswered: true, admin: true, canCompact: true, busy: false });
  assert.deepEqual(adm, { showContinue: true, showCompact: true, showAdminExtra: true });
  assert.equal(logic.truncationView({ unanswered: false, admin: true, canCompact: true, busy: false }).showCompact, false, "cut-off text: no compact");
  assert.equal(logic.truncationView({ unanswered: true, admin: false, canCompact: false, busy: true }).showContinue, false, "hidden while a run is going");
  assert.equal(logic.continueText(false), "請從剛才中斷的地方接著寫完。");
  assert.equal(logic.continueText(true), "請直接寫出回答,不要再重複思考。");
  const src = read("tigerai/ui/truncation.tsx");
  assert.match(src, /sender!\.send\(continueText\(unanswered\)\)/, "继續 uses the conversation's own send function");
  assert.match(read("tigerai/pages/i18n.ts"), /truncAdminExtra: "也可以把這個模型的思考關閉。"/);
});

test("compact button: no click event reaches customInstructions; the slot's button calls with no argument", () => {
  const mv = read("components/MessageView.tsx");
  assert.match(mv, /onClick=\{\(\) => onCompact\(\)\} \/\/ TG-HOOK:H29/);
  assert.ok(!/onClick=\{onCompact\}/.test(mv), "the raw handler is never given to onClick");
  assert.match(mv, /onCompact: \(\) => onCompact\?\.\(\)/);
  assert.match(read("tigerai/ui/truncation.tsx"), /onClick=\{\(\) => onCompact\(\)\}/);
});

test("logo: the sidebar button shows the icon AND the product name (click = contact popup); the hero greeting has no product name", () => {
  const parts = read("tigerai/ui/parts.tsx");
  assert.match(parts, /data-tg-brand[^\n]*onClick=\{\(\) => setOpen\(true\)\}>\{BRAND_SHORT\}<\/button>/);
  assert.doesNotMatch(read("tigerai/ui/kit.tsx"), /\.sidebar-brand\[data-tg-brand\]\{/, "no icon-only sizing any more");
  assert.match(read("tigerai/ui/kit.tsx"), /\.new-session-brand-name\{display:none\}/);
  assert.match(read("tigerai/pages/i18n.ts"), /greeting: "你好,\{name\},今天想做什麼\?"/);
});
