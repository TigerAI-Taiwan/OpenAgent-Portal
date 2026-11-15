// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import test from "node:test";
import assert from "node:assert/strict";
import { cleanAsrText } from "../wizards/meeting/asr-client.ts";

test("the llama.cpp / Qwen3-ASR prefix and tags are removed, plain text is untouched", () => {
  assert.equal(cleanAsrText("language Chinese<asr_text>各位早，現在開始開會。"), "各位早，現在開始開會。");
  assert.equal(cleanAsrText("  language English<asr_text>hello</asr_text>\n"), "hello");
  assert.equal(cleanAsrText("各位早，開會。"), "各位早，開會。");
  assert.equal(cleanAsrText("我說 language 這個詞"), "我說 language 這個詞");
});

test("simplified transcripts become Traditional (characters only, no phrase table); Traditional stays", async () => {
  const { taiwanText } = await import("../wizards/meeting/asr-client.ts");
  assert.equal(await taiwanText("现在开始本周生产会议，铝合金外壳，新品导入"), "現在開始本週生產會議，鋁合金外殼，新品導入");
  assert.equal(await taiwanText("各位早，現在開始開會。"), "各位早，現在開始開會。");
});

test("glossary: one term per line, deduplicated, capped; it reaches the summary prompt", async () => {
  const { cleanGlossary } = await import("../wizards/meeting/asr-settings.ts");
  const { buildUserPrompt } = await import("../wizards/meeting/summarize.ts");
  assert.equal(cleanGlossary("治具、夾具\n首件, 治具\n\n八D"), "治具\n夾具\n首件\n八D");
  const p = buildUserPrompt(["一行"], { title: "t", today: "2026-11-17", people: [], glossary: ["治具", "八D"] });
  assert.ok(p.includes("公司術語表") && p.includes("治具、八D") && p.includes("依術語表判讀") && p.includes("逐字稿是原始紀錄,不能改"));
  assert.ok(!buildUserPrompt(["一行"], { title: "t", today: "2026-11-17", people: [] }).includes("公司術語表"));
});
