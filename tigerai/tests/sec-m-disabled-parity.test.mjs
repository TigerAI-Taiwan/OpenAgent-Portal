// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Security review M12: with TIGERAI_ENABLED unset, loading the adapter changes nothing in upstream's process-wide state.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-m-disabled-parity.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-parity-"));
delete process.env.TIGERAI_ENABLED;
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const upstreamMap = new Map([["x", []]]);
globalThis.__piWebProviderModelCatalog = upstreamMap;
globalThis.__piWebProviderNameCatalog = undefined;
const before = Object.getOwnPropertyNames(globalThis).filter((k) => k.startsWith("__pi")).sort();

test("importing the adapter with the module off leaves upstream's globals untouched, and init() does nothing", async () => {
  const adapter = await import("../adapter/index.ts");
  assert.equal(globalThis.__piWebProviderModelCatalog, upstreamMap, "the model catalog is still upstream's own Map");
  assert.equal(globalThis.__piWebProviderNameCatalog, undefined);
  assert.deepEqual(Object.getOwnPropertyNames(globalThis).filter((k) => k.startsWith("__pi")).sort(), before);
  await adapter.init();
  assert.equal(globalThis.__piWebProviderModelCatalog, upstreamMap, "init() with the module off stays a no-op");
  assert.equal(globalThis.__piWebProviderNameCatalog, undefined);
});
test("with the module on, init() installs the guard", async () => {
  process.env.TIGERAI_ENABLED = "1";
  const adapter = await import("../adapter/index.ts");
  await adapter.init();
  assert.notEqual(globalThis.__piWebProviderModelCatalog, upstreamMap);
  assert.equal(globalThis.__piWebProviderModelCatalog.has("x"), true, "upstream's entries are carried over");
});
