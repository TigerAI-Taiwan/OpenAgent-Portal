// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Test fixture: writes a finished conversation (user + assistant message) into the isolated pi agent folder
// and registers its owner the way the server would. No model is involved.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function writeFixtureSession({ agentDir, tigerDir, userId, cwd, name, question, answer }) {
  const id = randomUUID();
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const dir = join(agentDir, "sessions", `--${cwd.replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`);
  mkdirSync(dir, { recursive: true });
  const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);
  const [m1, m2, m3] = [hex(), hex(), hex()];
  const ts = now.toISOString();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const lines = [
    { type: "session", version: 3, id, timestamp: ts, cwd },
    { type: "message", id: m1, parentId: null, timestamp: ts, message: { role: "user", content: question, timestamp: now.getTime() } },
    { type: "message", id: m2, parentId: m1, timestamp: ts, message: { role: "assistant", content: [{ type: "text", text: answer }], api: "fixture", provider: "fixture", model: "fixture", usage, stopReason: "stop", timestamp: now.getTime() } },
    { type: "session_info", id: m3, parentId: m2, timestamp: ts, name },
  ];
  writeFileSync(join(dir, `${stamp}_${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const db = new DatabaseSync(join(tigerDir, "tigerai.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare("INSERT OR IGNORE INTO session_owner (session_id,user_id,cwd,kind,room_id,created_at) VALUES (?,?,?,?,NULL,?)").run(id, userId, cwd, "chat", Date.now());
  db.close();
  return id;
}
