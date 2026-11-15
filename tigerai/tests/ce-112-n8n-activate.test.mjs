// 1.1.2-ce item 2: a member may activate (publish) and deactivate their OWN n8n workflows through the helper; never another person's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "tg-112-act-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
mkdirSync(process.env.TIGERAI_DATA_DIR, { recursive: true });
const T = await import("../n8nmcp/templates.ts");
const own = await import("../n8nmcp/ownership.ts");
const data = await import("../skills/builtin-data.ts");

test("the default tool list carries publish/unpublish and both count as writes (so the ownership gate applies)", () => {
  for (const t of ["publish_workflow", "unpublish_workflow"]) { assert.ok(T.DEFAULT_MCP_ALLOW.includes(t), t); assert.ok(T.isN8nWriteTool(t), t); }
});
test("the ownership rule: owner passes, other member refused, admin passes (decision level)", () => {
  own.recordOwner("s1", "wfA0000000001", "u-lin");
  const lin = { id: "u-lin", role: "member" }, wang = { id: "u-wang", role: "member" }, adm = { id: "u-adm", role: "admin" };
  for (const t of ["publish_workflow", "unpublish_workflow"]) {
    assert.equal(own.decideN8nWrite(lin, "s1", t, { workflowId: "wfA0000000001" }, false).allow, true, `owner ${t}`);
    assert.equal(own.decideN8nWrite(wang, "s1", t, { workflowId: "wfA0000000001" }, false).allow, false, `other ${t}`);
    assert.equal(own.decideN8nWrite(adm, "s1", t, { workflowId: "wfA0000000001" }, false).allow, true, `admin ${t}`);
    assert.equal(own.decideN8nWrite(lin, "s1", t, { workflowId: "wfNOREC0000001" }, false).allow, false, `unknown ${t}`);
    assert.equal(own.decideN8nWrite(lin, "s1", t, { workflowId: "wfA0000000001" }, true).allow, false, `after web content ${t}`);
  }
});
test("the n8n helper skill tells the AI how to activate and deactivate own workflows", () => {
  const s = data.BUILTIN_SKILLS.find((x) => x.slug === "n8n-helper");
  assert.match(s.body, /publish_workflow/); assert.match(s.body, /unpublish_workflow/); assert.match(s.body, /自己建立的流程/);
});
