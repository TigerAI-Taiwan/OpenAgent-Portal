// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Community edition feature C: lecture notes as an AI role's knowledge (no RAG), head scope, attachments:
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-knowledge.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-ce-know-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
mkdirSync(process.env.TIGERAI_DATA_DIR, { recursive: true });
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const ag = await import("../agents/service.ts");
const rt = await import("../agents/runtime.ts");
const bud = await import("../knowledge/budget.ts");
const store = await import("../knowledge/store.ts");
const { getDb } = await import("../db/store.ts");
const { pathAllowed } = await import("../adapter/path-guard.ts");
const { auditActionZh } = await import("../accounts/audit-text.ts");

const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("admin@example.com", "Admin", "admin");
const head = mk("head@example.com", "王老師");
const head2 = mk("head2@example.com", "李老師");
const student = mk("stu@example.com", "學生");
const deptA = acc.createGroup(admin.id, { name: "國文科" });
const deptB = acc.createGroup(admin.id, { name: "數學科" });
acc.setMembership(admin.id, deptA.id, head.id, true, true);
acc.setMembership(admin.id, deptB.id, head2.id, true, true);
acc.setMembership(admin.id, deptA.id, student.id, true, false);

async function call(user, method, path, body, raw) {
  const segs = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  const init = { method, headers: { "x-tg-uid": user.id } };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await handle(new Request(`http://x/api/tg/${path}`, init), segs);
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, json: ct.includes("json") ? await res.json() : null, text: ct.includes("json") ? null : await res.text() };
}
const audits = (action) => getDb().prepare("SELECT * FROM audit WHERE action=?").all(action);
const enc = (s) => new TextEncoder().encode(s);

let roleA;
test("a department head creates a role visible only to their own department", async () => {
  const r = await call(head, "POST", "knowledge/roles", { name: "課程助教", description: "國文講義", system_prompt: "只依講義回答", group_id: deptA.id });
  assert.equal(r.status, 201);
  roleA = r.json.role;
  const row = ag.getAgent(roleA.id);
  assert.deepEqual(row.group_ids, [deptA.id], "visible to that department only");
  assert.deepEqual(row.tool_names, ["read"], "conservative tool ceiling");
  assert.equal(row.model, null); assert.equal(row.knowledge_dir, null); assert.deepEqual(row.skills, []);
  assert.ok(audits("agent.head_create").some((a) => a.actor_id === head.id && JSON.parse(a.extra).groupId === deptA.id), "head create audited");
  // department members can call it, other departments cannot
  assert.ok(ag.agentsFor({ id: student.id, role: "member" }).some((a) => a.id === roleA.id));
  assert.ok(!ag.agentsFor({ id: head2.id, role: "member" }).some((a) => a.id === roleA.id));
});

test("a head cannot create in a department they do not head, nor smuggle model/tools/path", async () => {
  assert.equal((await call(head, "POST", "knowledge/roles", { name: "越界", group_id: deptB.id })).status, 403);
  assert.equal((await call(head, "POST", "knowledge/roles", { name: "無部門" })).status, 403);
  const r = await call(head, "POST", "knowledge/roles", { name: "偷帶", group_id: deptA.id, tool_names: ["bash"], model: { provider: "x", modelId: "y" }, knowledge_dir: "/etc", skills: ["s"] });
  assert.equal(r.status, 201);
  const row = ag.getAgent(r.json.role.id);
  assert.deepEqual(row.tool_names, ["read"]); assert.equal(row.model, null); assert.equal(row.knowledge_dir, null); assert.deepEqual(row.skills, []);
});

test("a head edits only roles of their own department; admin-made and other-department roles are refused", async () => {
  const other = await call(head2, "POST", "knowledge/roles", { name: "數學助教", group_id: deptB.id });
  const open = ag.createAgent(admin.id, { name: "全公司助手", group_ids: [] });
  const both = ag.createAgent(admin.id, { name: "跨科助手", group_ids: [deptA.id, deptB.id] });
  for (const id of [other.json.role.id, open.id, both.id]) {
    assert.equal((await call(head, "PATCH", `knowledge/roles/${id}`, { description: "x" })).status, 403, id);
    assert.equal((await call(head, "GET", `knowledge/roles/${id}/files`)).status, 403);
    assert.equal((await call(head, "PUT", `knowledge/roles/${id}/files/a.md`, undefined, enc("# x"))).status, 403);
    assert.equal((await call(head, "DELETE", `knowledge/roles/${id}`)).status, 403);
  }
  const ok = await call(head, "PATCH", `knowledge/roles/${roleA.id}`, { description: "新說明", group_ids: [deptB.id], tool_names: ["bash"], model: { provider: "a", modelId: "b" } });
  assert.equal(ok.status, 200);
  const row = ag.getAgent(roleA.id);
  assert.equal(row.description, "新說明");
  assert.deepEqual(row.group_ids, [deptA.id], "department cannot be moved"); assert.deepEqual(row.tool_names, ["read"]); assert.equal(row.model, null);
  assert.ok(audits("agent.head_update").some((a) => JSON.parse(a.extra).agentId === roleA.id));
  const list = await call(head, "GET", "knowledge/roles");
  assert.deepEqual(list.json.roles.map((r) => r.id).sort(), ag.listAllAgents().filter((a) => a.group_ids.length === 1 && a.group_ids[0] === deptA.id).map((a) => a.id).sort(), "list shows own department only");
  assert.deepEqual(list.json.departments.map((d) => d.id), [deptA.id]);
});

test("students (and anyone not a head) cannot list, upload, delete or download", async () => {
  await call(head, "PUT", `knowledge/roles/${roleA.id}/files/ch1.md`, undefined, enc("# 第一章\n春江花月夜"));
  for (const [m, p, raw] of [["GET", "knowledge/roles"], ["GET", `knowledge/roles/${roleA.id}/files`], ["GET", `knowledge/roles/${roleA.id}/files/ch1.md`], ["PUT", `knowledge/roles/${roleA.id}/files/z.md`, enc("x")], ["DELETE", `knowledge/roles/${roleA.id}/files/ch1.md`], ["POST", "knowledge/roles"], ["PATCH", `knowledge/roles/${roleA.id}`]]) {
    const r = await call(student, m, p, m === "POST" || m === "PATCH" ? { name: "n", group_id: deptA.id } : undefined, raw);
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  // the plain role list a student sees carries names only
  const roles = ag.agentsFor({ id: student.id, role: "member" });
  assert.ok(roles.length > 0);
  const rolesApi = await call(student, "GET", "agents");
  assert.deepEqual(Object.keys(rolesApi.json.agents[0]).sort(), ["description", "id", "name"]);
  // the head can download it
  const dl = await call(head, "GET", `knowledge/roles/${roleA.id}/files/ch1.md`);
  assert.equal(dl.status, 200); assert.match(dl.text, /春江花月夜/);
});

test("path traversal and bad names are refused; files stay inside the role folder", async () => {
  const bad = ["../x.md", "a/../../b.md", "a\\b.md", "..md", ".hidden.md", "x.exe", "x.md.sh", "noext", "a%2Fb.md".replace("%2F", "/")];
  for (const n of bad) {
    const r = await call(head, "PUT", `knowledge/roles/${roleA.id}/files/${encodeURIComponent(n)}`, undefined, enc("hello"));
    assert.ok([400].includes(r.status), `${n} -> ${r.status}`);
  }
  assert.throws(() => store.putFile(head.id, roleA.id, "../../evil.md", enc("x")), (e) => e.status === 400);
  assert.throws(() => store.readFileText(roleA.id, "../../../etc/passwd"), (e) => e.status === 400);
  assert.throws(() => store.roleDir("../etc"), (e) => e.status === 400);
  assert.equal(store.cleanName("課程:第1章?.md"), "課程_第1章_.md");
  const entries = readdirSync(store.knowledgeRoot());
  assert.deepEqual(entries.sort(), [...new Set(entries)].sort());
  assert.ok(!existsSync(join(dir, "evil.md")));
  // the role folder holds only the accepted files
  assert.ok(readdirSync(store.roleDir(roleA.id)).every((f) => /\.(md|txt)$/.test(f)));
});

test("only UTF-8 text within the size caps is accepted; replace and delete are audited", async () => {
  const put = (n, bytes) => call(head, "PUT", `knowledge/roles/${roleA.id}/files/${encodeURIComponent(n)}`, undefined, bytes);
  assert.equal((await put("bin.md", new Uint8Array([0x23, 0, 0xff, 0xfe]))).status, 400, "NUL / invalid UTF-8");
  assert.equal((await put("lat.txt", new Uint8Array([0xe9, 0xe8]))).status, 400, "latin-1 bytes are not UTF-8");
  assert.equal((await put("empty.md", new Uint8Array())).status, 400);
  assert.equal((await put("big.md", enc("a".repeat(bud.MAX_FILE_BYTES + 1)))).status, 413);
  const add = await put("ch2.txt", enc("第二章 內容"));
  assert.equal(add.status, 200); assert.equal(add.json.file.replaced, false);
  const rep = await put("ch2.txt", enc("第二章 新版內容"));
  assert.equal(rep.json.file.replaced, true);
  assert.equal((await call(head, "DELETE", `knowledge/roles/${roleA.id}/files/ch2.txt`)).status, 200);
  assert.equal((await call(head, "DELETE", `knowledge/roles/${roleA.id}/files/ch2.txt`)).status, 404);
  assert.ok(audits("knowledge.add").length >= 2 && audits("knowledge.replace").length === 1 && audits("knowledge.delete").length === 1);
  const a = audits("knowledge.replace")[0];
  assert.equal(JSON.parse(a.extra).file, "ch2.txt"); assert.equal(a.actor_id, head.id);
  assert.equal(auditActionZh("knowledge.replace"), "換新版知識檔");
});

test("inline vs on-demand split follows 30% of the model's context window", () => {
  const files = [{ name: "small.md", bytes: 100, tokens: 100 }, { name: "mid.md", bytes: 100, tokens: 500 }, { name: "huge.md", bytes: 100, tokens: 5000 }];
  const p = bud.planKnowledge(files, 4000, true); // budget 1200
  assert.equal(p.budgetTokens, 1200);
  assert.deepEqual(p.inline, ["mid.md", "small.md"]); assert.deepEqual(p.onDemand, ["huge.md"]);
  assert.equal(p.usedTokens, 100 + 500 + 2 * bud.FILE_OVERHEAD_TOKENS);
  assert.equal(p.percent, Math.round((p.usedTokens / 1200) * 100));
  const all = bud.planKnowledge(files, 100000, true);
  assert.deepEqual(all.onDemand, []);
  // a file is never cut: once one does not fit, larger ones do not sneak in
  assert.deepEqual(bud.planKnowledge([{ name: "a.md", bytes: 1, tokens: 900 }, { name: "b.md", bytes: 1, tokens: 950 }], 4000, true).inline, ["a.md"]);
  assert.ok(bud.estimateTokens("中文".repeat(10)) >= 20 && bud.estimateTokens("abc".repeat(30)) >= 30);
});

test("the model's context window comes from models.json; an unknown model falls back to a small default", () => {
  assert.deepEqual(store.contextWindowFor(null), { window: bud.UNKNOWN_WINDOW, known: false });
  writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), JSON.stringify({ providers: { tigerai: { models: [{ id: "big", contextWindow: 100000 }, { id: "tiny", contextWindow: 2000 }] } } }));
  assert.deepEqual(store.contextWindowFor({ provider: "tigerai", modelId: "big" }), { window: 100000, known: true });
  assert.equal(store.contextWindowFor({ provider: "tigerai", modelId: "nope" }).known, false);
  writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ defaultProvider: "tigerai", defaultModel: "big" }));
  assert.equal(store.contextWindowFor(null).window, 100000, "default model when the role names none");
});

test("the role prompt carries the inline notes with headers and the citation rule; overflow is left to the read tool", async () => {
  const r = await call(head, "POST", "knowledge/roles", { name: "分流助教", group_id: deptA.id });
  const id = r.json.role.id;
  writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), JSON.stringify({ providers: { tigerai: { models: [{ id: "tiny", contextWindow: 2000 }] } } }));
  getDb().prepare("UPDATE agents SET model_provider='tigerai', model_id='tiny' WHERE id=?").run(id); // budget 600 tokens
  await call(head, "PUT", `knowledge/roles/${id}/files/short.md`, undefined, enc("# 短講義\n牛頓第一定律"));
  await call(head, "PUT", `knowledge/roles/${id}/files/long.md`, undefined, enc("很長的講義。".repeat(200)));
  const view = await call(head, "GET", `knowledge/roles/${id}/files`);
  assert.equal(view.json.files.find((f) => f.name === "short.md").mode, "inline");
  assert.equal(view.json.files.find((f) => f.name === "long.md").mode, "ondemand");
  assert.ok(view.json.budget.percent > 0 && view.json.budget.percent <= 100);
  assert.equal(view.json.role.canReadOnDemand, true);
  const text = rt.rolePrompt(ag.getAgent(id));
  assert.match(text, /檔名：short\.md/); assert.match(text, /牛頓第一定律/); assert.match(text, /出自：檔名/);
  assert.ok(!text.includes("很長的講義。很長的講義。"), "overflow text is not inlined");
  assert.ok(text.includes(store.roleDir(id)) && text.includes("long.md"), "overflow is named with its folder");
  // the folder is a readable root for that role's session, nothing else is
  assert.ok(pathAllowed("/somewhere/else", join(store.roleDir(id), "long.md"), [store.managedRoot(ag.getAgent(id))]));
  assert.ok(!pathAllowed("/somewhere/else", join(store.knowledgeRoot(), "other", "x.md"), [store.managedRoot(ag.getAgent(id))]));
  // a role without the read tool: the view says the overflow cannot be read
  ag.updateAgent(admin.id, id, { tool_names: ["grep"] });
  assert.equal((await call(admin, "GET", `knowledge/roles/${id}/files`)).json.role.canReadOnDemand, false);
});

test("an administrator manages every role", async () => {
  const all = await call(admin, "GET", "knowledge/roles");
  assert.equal(all.status, 200);
  assert.equal(all.json.roles.length, ag.listAllAgents().length);
  assert.equal((await call(admin, "PUT", `knowledge/roles/${roleA.id}/files/by-admin.md`, undefined, enc("管理員上傳"))).status, 200);
  assert.equal(audits("agent.head_create").length >= 2 && audits("knowledge.add").some((a) => a.actor_id === admin.id), true);
});

test("one-off attachment limits are defined and the text helper enforces them", async () => {
  const ui = await import("../knowledge/attach.ts");
  assert.equal(ui.MAX_ATTACH_BYTES, bud.MAX_ATTACH_BYTES);
  assert.equal(ui.attachBlock("a.md", "hi").startsWith("【附件：a.md】"), true);
  assert.deepEqual(ui.checkAttachment({ name: "a.pdf", size: 10 }), { ok: false, reason: "type" });
  assert.deepEqual(ui.checkAttachment({ name: "a.md", size: bud.MAX_ATTACH_BYTES + 1 }), { ok: false, reason: "size" });
  assert.deepEqual(ui.checkAttachment({ name: "a.TXT", size: 10 }), { ok: true });
  assert.equal(ui.decodeAttachment(enc("好")), "好");
  assert.equal(ui.decodeAttachment(new Uint8Array([0xff, 0xfe, 0xfd])), null, "not UTF-8");
});
