// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 1.1.0-ce: permanent deletion of a disabled member's personal data. node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/ce-v11-purge.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-v11-purge-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { handle } = await import("../api/router.ts");
const acc = await import("../accounts/service.ts");
const P = await import("../accounts/purge.ts");
const rooms = await import("../rooms/service.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const { writeAudit } = await import("../accounts/audit.ts");
const { getDb } = await import("../db/store.ts");
const { personalDir } = await import("../workspace.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("a@x.example", "老師", "admin");
const amy = mk("amy@x.example", "B119-資工二-陳小明");
const ben = mk("ben@x.example", "Ben");
const room = rooms.createRoom({ id: ben.id, role: "member" }, "討論", [amy.id]);
const call = async (user, method, path, body) => { const res = await handle(new Request(`http://x/api/tg/${path}`, { method, headers: { "x-tg-uid": user.id, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/")); return { status: res.status, json: JSON.parse(await res.text()) }; };

// what Amy leaves behind
const folder = personalDir(amy.dir_name); mkdirSync(join(folder, "my-skills"), { recursive: true }); writeFileSync(join(folder, "note.txt"), "x");
const keys = join(process.env.TIGERAI_DATA_DIR, "personal-models", amy.id); mkdirSync(keys, { recursive: true }); writeFileSync(join(keys, "key-tgp-1"), "sk-SECRET");
registerOwner("sess-amy", amy.id, folder, "chat", null);
const sent = rooms.postMessage({ id: amy.id, role: "member" }, room.id, "我的私人想法 amy@x.example");
rooms.postMessage({ id: ben.id, role: "member" }, room.id, "收到");
getDb().prepare("INSERT INTO registration_requests (user_id,group_id,phrase_entered,note,status,created_at) VALUES (?,?,?,?,?,?)").run(amy.id, null, "p", "S1234", "approved", 1);
writeAudit("user.create", admin.id, { userId: amy.id, email: "amy@x.example", role: "member" });
writeAudit("userlog.view", admin.id, { userId: amy.id, sessionId: "sess-amy", title: "x" });
writeAudit("auth.login", amy.id);
writeAudit("auth.login_failed", null, { email: "amy@x.example" });
writeAudit("auth.login", ben.id);
const deleted = [];
const deps = { deleteSession: async (id) => { deleted.push(id); return true; } };

test("only an administrator, only a disabled account, never yourself, never the maintenance account", async () => {
  assert.equal((await call(ben, "GET", `admin/users/${amy.id}/purge`)).status, 403);
  assert.equal((await call(admin, "GET", `admin/users/${amy.id}/purge`)).status, 409, "an active account cannot be deleted");
  await call(admin, "PATCH", `admin/users/${amy.id}`, { status: "disabled" });
  assert.equal((await call(admin, "GET", `admin/users/${admin.id}/purge`)).status, 409);
});

test("step 1 lists what will go; step 2 needs the e-mail typed exactly", async () => {
  const pv = (await call(admin, "GET", `admin/users/${amy.id}/purge`)).json;
  const count = (k) => pv.items.find((i) => i.key === k).count;
  assert.equal(count("conversations"), 1); assert.equal(count("folder"), 1); assert.equal(count("keys"), 1); assert.equal(count("messages"), 1); assert.equal(count("requests"), 1);
  assert.ok(count("audit") >= 3);
  assert.equal((await call(admin, "POST", `admin/users/${amy.id}/purge`, { confirmEmail: "wrong@x.example" })).json.code, "confirm_mismatch");
  assert.ok(acc.userById(amy.id), "nothing happened");
});

test("the purge removes the data, blanks channel messages, scrubs the audit trail and keeps one row", async () => {
  const r = await P.purge({ id: admin.id, role: "admin" }, amy.id, "AMY@x.example", deps);
  assert.equal(r.number, 1);
  assert.deepEqual(deleted, ["sess-amy"]);
  assert.equal(acc.userById(amy.id), null);
  assert.equal(existsSync(folder), false); assert.equal(existsSync(keys), false);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM registration_requests WHERE user_id=?").get(amy.id).n, 0);
  const msgs = rooms.readMessages({ id: ben.id, role: "member" }, room.id);
  const gone = msgs.find((m) => m.seq === sent.seq);
  assert.equal(gone.author, "（已刪除的成員）"); assert.equal(gone.text, P.DELETED_TEXT);
  assert.ok(msgs.some((m) => m.text === "收到"), "other people's messages are untouched");
  const all = JSON.stringify(getDb().prepare("SELECT actor_id, extra FROM audit").all());
  assert.ok(!all.includes(amy.id) && !all.includes("amy@x.example"), "no identifying field of the person is left in the audit trail");
  const purgeRow = getDb().prepare("SELECT * FROM audit WHERE action='member.purge'").all();
  assert.equal(purgeRow.length, 1); assert.equal(purgeRow[0].actor_id, admin.id); assert.equal(JSON.parse(purgeRow[0].extra).number, 1);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM audit WHERE action='auth.login' AND actor_id=?").get(ben.id).n, 1, "other people's rows are untouched");
});

test("the append-only guards are back after the scrub", () => {
  for (const name of ["audit_no_update", "audit_no_delete", "rm_no_update", "rm_no_delete"]) assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name), name);
  assert.throws(() => getDb().prepare("UPDATE audit SET action='x' WHERE id=1").run(), /append-only/);
  assert.throws(() => getDb().prepare("UPDATE room_messages SET text='x' WHERE seq=1").run(), /append-only/);
  assert.throws(() => getDb().prepare("DELETE FROM audit WHERE id=1").run(), /append-only/);
});
