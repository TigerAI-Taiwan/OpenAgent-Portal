// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Security review H2: 「永久刪除」 leaves nothing of the person on disk, in the database or in process memory.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-h2-purge-complete.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tg-sec-h2-"));
process.env.TIGERAI_ENABLED = "1";
process.env.TIGERAI_DATA_DIR = join(dir, "data");
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.TIGERAI_PERSONAL_ALLOW_PRIVATE = "1";
delete process.env.TIGERAI_LICENSE_FILE; delete process.env.TIGERAI_ADDON_DIR;
const acc = await import("../accounts/service.ts");
const P = await import("../accounts/purge.ts");
const rooms = await import("../rooms/service.ts");
const { registerOwner } = await import("../rooms/ownership.ts");
const { getDb } = await import("../db/store.ts");
const { personalDir } = await import("../workspace.ts");
const personal = await import("../provider/personal.ts");
const runtime = await import("../provider/personal-runtime.ts");
const meet = await import("../wizards/meeting/store.ts");
const slides = await import("../slides/store.ts");
const { ensureFormTables } = await import("../forms/db.ts");
const { workspaceRoot } = await import("../config.ts");
const PW = "Test-Pass-12345!";
const mk = (email, name, role = "member") => acc.createUser(null, { email, name, role, password: PW, mustChange: false }).user;
const admin = mk("a@x.example", "老師", "admin");
const amy = mk("amy@x.example", "B119-資工二-陳小明");
const ben = mk("ben@x.example", "Ben");
const room = rooms.createRoom({ id: ben.id, role: "member" }, "討論", [amy.id]);
const KEY = "sk-amy-secret-key-7777";

// What Amy leaves behind, in every place the product writes per-person data.
const folder = personalDir(amy.id);
mkdirSync(join(folder, "my-skills", "my-a"), { recursive: true }); writeFileSync(join(folder, "my-skills", "my-a", "SKILL.md"), "x");
registerOwner("sess-amy", amy.id, folder, "chat", null);
personal.setPersonalSwitches(admin.id, { allow: true });
const conn = await personal.addPersonal(amy.id, { name: "mine", baseUrl: "http://127.0.0.1:9/v1", apiKey: KEY, models: ["m"] });
const cid = personal.listPersonal(amy.id)[0].id;
runtime.providerConfig(amy.id, personal.listPersonal(amy.id)[0]); // what a running conversation does: the key goes into the process environment
const ENV = personal.personalKeyEnvName(cid);
meet.ensureTables();
const M = "m-amy-1";
getDb().prepare("INSERT INTO meetings (id,owner_id,room_id,title,source,audio_name,audio_bytes,status,summary,line_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(M, amy.id, null, "週會", "audio", "a.mp3", 3, "done", JSON.stringify({ s: "摘要" }), 1, 1, 1);
meet.writeTranscript(M, ["逐字稿一行"]);
writeFileSync(join(meet.meetingDir(M), "audio.mp3"), "AUDIO");
getDb().prepare("INSERT INTO meeting_uploads (id,user_id,room_id,name,title,size,created_at) VALUES (?,?,?,?,?,?,?)").run("up-amy-1", amy.id, null, "b.mp3", "b", 5, 1);
mkdirSync(meet.uploadsDir(), { recursive: true }); writeFileSync(join(meet.uploadsDir(), "up-amy-1.part"), "PART");
const deckP = slides.saveDeck({ roomId: null, ownerId: amy.id, title: "我的簡報", slides: 1, pptx: Buffer.from("PPTX"), pdf: null });
const deckR = slides.saveDeck({ roomId: room.id, ownerId: amy.id, title: "頻道簡報", slides: 1, pptx: Buffer.from("PPTX"), pdf: null });
ensureFormTables();
mkdirSync(join(process.env.TIGERAI_DATA_DIR, "forms", "out"), { recursive: true });
writeFileSync(join(process.env.TIGERAI_DATA_DIR, "forms", "out", "fo-amy.pdf"), "%PDF");
getDb().prepare("INSERT INTO tg_form_outputs (id,form_id,form_name,owner_id,created_at,bytes) VALUES (?,?,?,?,?,?)").run("fo-amy", "f1", "表", amy.id, 1, 4);
mkdirSync(join(process.env.TIGERAI_DATA_DIR, "prompt-cache", amy.id), { recursive: true }); writeFileSync(join(process.env.TIGERAI_DATA_DIR, "prompt-cache", amy.id, "p.md"), "x");
getDb().prepare("INSERT INTO handovers (id,leaver_id,successor_id,actor_id,at,summary) VALUES (?,?,?,?,?,?)").run("h1", amy.id, ben.id, admin.id, 1, "{}");
getDb().prepare("INSERT INTO handover_reads (leaver_id,successor_id,granted_by,granted_at) VALUES (?,?,?,?)").run(amy.id, ben.id, admin.id, 1);
rooms.postMessage({ id: amy.id, role: "member" }, room.id, "hello");

function walk(root, hits = []) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.name.includes(amy.id) || e.name.includes(amy.email)) hits.push(p);
    if (e.isDirectory()) walk(p, hits);
    else { try { if (statSync(p).size < 5e6) { const t = readFileSync(p, "latin1"); if (t.includes(amy.id) || t.includes("amy@x.example") || t.includes(KEY)) hits.push(p + " (content)"); } } catch { /* unreadable */ } }
  }
  return hits;
}
function dbHits() {
  const db = getDb(); const hits = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) { const t = JSON.stringify(row); if (t.includes(amy.id) || t.includes("amy@x.example")) hits.push(name); }
  }
  return [...new Set(hits)];
}

test("before: the data exists everywhere and the preview lists every kind", async () => {
  assert.ok(walk(process.env.TIGERAI_DATA_DIR).length >= 5, "the person's data is on disk");
  assert.equal(process.env[ENV], KEY);
  getDb().prepare("UPDATE users SET status='disabled' WHERE id=?").run(amy.id);
  const pv = P.preview({ id: admin.id, role: "admin" }, amy.id);
  const c = (k) => pv.items.find((i) => i.key === k)?.count;
  assert.ok(c("meeting_files") >= 3, "transcript + audio + partial upload"); assert.ok(c("slides") >= 2); assert.equal(c("channel_decks"), 1); assert.ok(c("caches") >= 2); assert.equal(c("handovers"), 2);
});

test("after the purge: no path, file content, database row or environment variable of the person remains", async () => {
  await P.purge({ id: admin.id, role: "admin" }, amy.id, "amy@x.example", { deleteSession: async () => true });
  const checked = [folder, join(process.env.TIGERAI_DATA_DIR, "personal-models", amy.id), meet.meetingDir(M), join(meet.uploadsDir(), "up-amy-1.part"), join(process.env.TIGERAI_DATA_DIR, "slides-personal", amy.id), join(process.env.TIGERAI_DATA_DIR, "forms", "out", "fo-amy.pdf"), join(process.env.TIGERAI_DATA_DIR, "prompt-cache", amy.id)];
  for (const p of checked) assert.equal(existsSync(p), false, `still on disk: ${p}`);
  assert.equal(process.env[ENV], undefined, "the key left the process environment at once");
  // The channel deck stays (it belongs to the channel) but no longer names the person.
  const meta = JSON.parse(readFileSync(join(workspaceRoot(), "rooms", room.id, "slides", deckR.id, "meta.json"), "utf8"));
  assert.notEqual(meta.ownerId, amy.id);
  for (const root of [process.env.TIGERAI_DATA_DIR, process.env.PI_CODING_AGENT_DIR, workspaceRoot()]) if (existsSync(root)) assert.deepEqual(walk(root), [], `leftovers under ${root}`);
  assert.deepEqual(dbHits(), [], "database rows still naming the person");
  console.log("paths checked:", checked.length, "+ full scan of data dir, agent dir, workspace and every database table");
});
