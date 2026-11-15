// 1.1.2-ce item 1: a connection marked as a thinking model defaults to a 40000 output budget (cap 65536).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const dir = mkdtempSync(join(tmpdir(), "tg-112-think-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_PERSONAL_ALLOW_PRIVATE = "1";
mkdirSync(process.env.TIGERAI_DATA_DIR, { recursive: true });
const acc = await import("../accounts/service.ts");
const pe = await import("../provider/personal.ts");
const pr = await import("../provider/personal-runtime.ts");
const alice = acc.createUser(null, { email: "alice@example.com", name: "Alice", role: "member", password: "Test-Pass-12345!", mustChange: false }).user;

test("thinking connection created without a size gets 40000, a plain one 16384", async () => {
  const v = await pe.addPersonal(alice.id, { name: "T", baseUrl: "http://127.0.0.1:9/v1", models: "glm-5", reasoning: true });
  assert.equal(v.connections[0].maxTokens, 40000);
  assert.equal(pr.providerConfig(alice.id, pe.listPersonal(alice.id)[0]).models[0].maxTokens, 40000);
  const w = await pe.addPersonal(alice.id, { name: "P", baseUrl: "http://127.0.0.1:9/v1", models: "m" });
  assert.equal(w.connections[1].maxTokens, 16384);
});
test("an explicit size is kept; marking a default-size connection as thinking raises it; cap stays 65536", async () => {
  const list = pe.listPersonal(alice.id);
  const plain = list[1].id;
  const v = await pe.updatePersonal(alice.id, plain, { reasoning: true });
  assert.equal(v.connections.find((c) => c.id === plain).maxTokens, 40000);
  const v2 = await pe.updatePersonal(alice.id, plain, { maxTokens: 20000 });
  assert.equal(v2.connections.find((c) => c.id === plain).maxTokens, 20000);
  const v3 = await pe.updatePersonal(alice.id, plain, { reasoning: false, maxTokens: 16384 });
  assert.equal(v3.connections.find((c) => c.id === plain).maxTokens, 16384);
  await assert.rejects(pe.updatePersonal(alice.id, plain, { maxTokens: 65537 }), /maxTokens/);
  assert.equal(pe.connLimits({ reasoning: true }).maxTokens, 40000);
  assert.equal(pe.connLimits({ reasoning: true, maxTokens: 65536, contextWindow: 60000 }).maxTokens, 30000);
});
test("the NVIDIA preset with a glm model marks thinking (UI source)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../ui/PersonalModels.tsx", import.meta.url), "utf8");
  assert.match(src, /preset === "nvidia"[^;]*glm/);
  assert.match(src, /markThinking\(true\)/);
});
