// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Creates two member accounts on a running dev server and sets their passwords,
// going through the real flow (admin creates, forced change on first login).
// Reads E2E_BASE_URL, ADMIN_EMAIL/PASSWORD, MEMBER_A_*/MEMBER_B_* from the environment; prints no secrets.
import { Client } from "./client.mjs";
const e = process.env;
const base = e.E2E_BASE_URL;
if (!base || !e.ADMIN_PASSWORD || !e.MEMBER_A_PASSWORD || !e.MEMBER_B_PASSWORD) { console.error("missing environment"); process.exit(2); }
const admin = new Client(base);
await admin.login(e.ADMIN_EMAIL, e.ADMIN_PASSWORD);
for (const [name, email, pw] of [["alice", e.MEMBER_A_EMAIL, e.MEMBER_A_PASSWORD], ["bob", e.MEMBER_B_EMAIL, e.MEMBER_B_PASSWORD]]) {
  const users = (await admin.get("/api/tg/admin/users")).json.users;
  if (users.some((u) => u.email === email)) { console.log(`${name}: exists`); continue; }
  const created = await admin.post("/api/tg/admin/users", { email, name, role: "member" });
  if (created.status !== 201) throw new Error(`create ${name}: ${created.status}`);
  const c = new Client(base);
  const first = await c.login(email, created.json.initialPassword);
  if (!first.mustChangePassword) throw new Error("expected forced password change");
  const changed = await c.post("/api/tg/account/password", { current: created.json.initialPassword, next: pw });
  if (changed.status !== 200) throw new Error(`password change: ${changed.status}`);
  console.log(`${name}: created`);
}
