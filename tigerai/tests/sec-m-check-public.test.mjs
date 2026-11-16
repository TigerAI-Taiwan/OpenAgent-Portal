// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Security review M11: check-public catches the key shapes the old rules missed, scans staged files and history, stays quiet on the
// upstream fixtures' private-IP literals, and stays RED on real-looking secrets. Every secret below is made up and built from fragments.
//   node --experimental-transform-types --import ./tigerai/tests/register.mjs --test tigerai/tests/sec-m-check-public.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanLine } from "../tools/check-public-rules.mjs";

const j = (...p) => p.join("");
const rnd = "Qx7vK2mPz9LdRw4TnYb8UcHs3JfE6AaG5oXiVt1Nk0";
const fakes = {
  anthropic: j("sk", "-ant-api03-", rnd, rnd.slice(0, 20)),
  openrouter: j("sk", "-or-v1-", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"),
  openai: j("sk", "-", rnd, "ABCDEFGH"),
  jwt: j("ey", "Jhbgc", "iOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NTY3ODkwIn0.", "dGVzdHNpZ25hdHVyZQ"),
  google: j("AI", "za", "SyA1234567890abcdefghijklmnopqrstuv"),
  nvidia: j("nv", "api-", rnd),
  bearer: j("Authorization: Bear", "er ", rnd),
  hex40: j("gitea_to", "ken = ", "0123456789abcdef0123456789abcdef01234567"),
  aws: j("AK", "IA", "ABCDEFGHIJKLMNOP"),
};

test("each secret shape is caught", () => {
  for (const [name, v] of Object.entries(fakes)) assert.ok(scanLine("x.ts", `const k = "${v}";`).length > 0, name);
});
test("ordinary lines are not flagged", () => {
  const sha = j("0123456789abcdef", "0123456789abcdef", "01234567");
  for (const l of [`const sha = '${sha}'; // a commit`, "const key = 'sk-alice-1234';", "Authorization: `Bearer ${token}`", "risk-assessment-and-mitigation-framework-for-all-teams-2026", `git checkout ${sha}`]) assert.deepEqual(scanLine("x.ts", l), [], l);
});
test("the upstream fixtures' private IPs are waived by file, anything else is not", () => {
  const line = j("const ip = '192.", "168.1.20';");
  assert.deepEqual(scanLine("lib/network-addresses.test.mjs", line), []);
  assert.ok(scanLine("lib/other-new.test.mjs", line).length > 0);
  assert.ok(scanLine("tigerai/x.ts", line).length > 0);
  assert.ok(scanLine("lib/network-addresses.test.mjs", fakes.openai).length > 0, "the waiver covers the IP rule only");
});

// End to end in a throwaway repository: staged scan, working tree scan, and history scan.
const tool = join(import.meta.dirname, "..", "tools", "check-public.mjs");
function repo() {
  const d = mkdtempSync(join(tmpdir(), "tg-cp-"));
  const g = (...a) => execFileSync("git", a, { cwd: d, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  g("init", "-q", "-b", "main"); writeFileSync(join(d, "a.txt"), "clean\n"); g("add", "."); g("commit", "-qm", "base");
  return { d, g };
}
const run = (d, ...a) => spawnSync("node", [tool, ...a], { cwd: d, env: { ...process.env, CHECK_PUBLIC_ROOT: d }, encoding: "utf8" });

test("staged mode is red on a staged secret and green once it is gone; clean repos are green", () => {
  const { d, g } = repo();
  assert.equal(run(d, "main").status, 0);
  writeFileSync(join(d, "leak.env"), `KEY=${fakes.anthropic}\n`); g("add", "leak.env");
  const r = run(d, "--staged"); assert.equal(r.status, 1); assert.match(r.stderr, /leak\.env:1: Anthropic API key/);
  assert.equal(run(d, "main").status, 1, "the normal scan sees staged files too");
  g("reset", "-q"); writeFileSync(join(d, "leak.env"), "gone\n"); g("add", "leak.env");
  assert.equal(run(d, "--staged").status, 0);
});
test("history mode finds a secret that one commit added and the next removed", () => {
  const { d, g } = repo();
  g("checkout", "-qb", "work");
  writeFileSync(join(d, "c.txt"), `token ${fakes.jwt}\n`); g("add", "."); g("commit", "-qm", "oops");
  writeFileSync(join(d, "c.txt"), "removed\n"); g("add", "."); g("commit", "-qm", "remove it");
  assert.equal(run(d, "main").status, 0, "the final diff is clean");
  const r = run(d, "main", "--history"); assert.equal(r.status, 1); assert.match(r.stderr, /JWT.*in history/);
});

test("1.1.2-ce: the fictional story companies are allowed by file (README and the story files) and nowhere else; a real-looking secret in a story file is still red", () => {
  const demo = j("虎虎", "生風精密");
  for (const f of ["README.md", "README.en.md", "docs/stories/中小企業主_故事_v1.0.md", "docs/stories/SME_Story_v1.0_en.md", "docs/stories/教師工作坊_四個練習_v1.0.md", "docs/stories/Teacher_Workshop_Four_Exercises_v1.0_en.md"])
    assert.deepEqual(scanLine(f, `${demo}: a fictional company`), [], f);
  assert.deepEqual(scanLine("docs/other.md", `${demo}: a fictional company`), ["customer or demo company name"], "a new file never inherits the exemption");
  assert.deepEqual(scanLine("tigerai/pages/i18n.ts", `${demo}`), ["customer or demo company name"]);
  assert.ok(scanLine("docs/stories/SME_Story_v1.0_en.md", `${demo} ${fakes.anthropic}`).includes("Anthropic API key"), "only the name rule is waived");
  assert.ok(scanLine("README.md", `see ${j("192.168", ".1.5")}`).includes("private IPv4 address"), "and nothing else");
});
