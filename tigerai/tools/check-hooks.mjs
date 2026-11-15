// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Run after every upstream sync:  node tigerai/tools/check-hooks.mjs
// 1. every TG-HOOK marker listed in hooks.json is present the expected number of times, with its anchor nearby
// 2. no unlisted marker exists
// 3. "leak" watch: places that create sessions or list session ids, compared with the recorded set
// 4. new upstream API routes that the proxy gate has not been told about are listed (members are refused by default)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const spec = JSON.parse(readFileSync(join(root, "tigerai/adapter/hooks.json"), "utf8"));
const problems = [];
const notes = [];

const perFile = new Map();
for (const h of spec.hooks) {
  const path = join(root, h.file);
  if (!existsSync(path)) { problems.push(`${h.id}: file missing: ${h.file}`); continue; }
  const lines = readFileSync(path, "utf8").split("\n");
  const marks = lines.map((l, i) => (l.includes(`TG-HOOK:${h.id}`) ? i : -1)).filter((i) => i >= 0);
  perFile.set(`${h.file}`, (perFile.get(h.file) ?? new Set()).add(h.id));
  if (marks.length !== h.expectCount) problems.push(`${h.id}: ${h.file} has ${marks.length} marker(s), expected ${h.expectCount}`);
  const near = marks.some((i) => lines.slice(Math.max(0, i - 10), i + 11).some((l) => l.includes(h.anchor)));
  if (marks.length && !near) problems.push(`${h.id}: anchor "${h.anchor}" not within 10 lines of a marker in ${h.file} (upstream moved the code?)`);
}
// stray markers
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if ([".git", "node_modules", ".next", "tigerai"].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(ts|tsx|mjs|js|json)$/.test(name)) out.push(p);
  }
  return out;
}
const markerRe = /TG-HOOK:(H\d\d)/g;
const seenIds = new Set();
for (const f of walk(root)) {
  const text = readFileSync(f, "utf8");
  if (!text.includes("TG-HOOK:")) continue;
  const rel = relative(root, f);
  for (const m of text.matchAll(markerRe)) {
    seenIds.add(m[1]);
    if (!perFile.get(rel)?.has(m[1])) problems.push(`${m[1]}: marker in ${rel} is not listed in hooks.json`);
  }
}
for (const id of new Set(spec.hooks.map((h) => h.id))) {
  if (!seenIds.has(id)) problems.push(`${id}: no marker found anywhere`);
}
const proxy = readFileSync(join(root, spec.matcher.file), "utf8");
if (!proxy.includes(spec.matcher.mustInclude)) problems.push(`proxy matcher no longer contains ${spec.matcher.mustInclude}`);

// leak watch
function grepCount(pattern, dirs) {
  try {
    const out = execFileSync("git", ["grep", "-n", "-F", pattern, "--", ...dirs], { cwd: root, encoding: "utf8" });
    return out.split("\n").filter(Boolean).filter((l) => !l.includes(".test.")).length;
  } catch { return 0; }
}
const callers = grepCount(spec.startRpcSessionCallers.grep, spec.startRpcSessionCallers.dirs);
notes.push(`startRpcSession( call sites outside tests: ${callers}`);
if (spec.startRpcSessionCallers.recorded !== null && callers !== spec.startRpcSessionCallers.recorded) {
  problems.push(`startRpcSession( call sites changed: ${callers}, recorded ${spec.startRpcSessionCallers.recorded}. A new one may create sessions with no owner: decide, then update hooks.json`);
}
try {
  const lister = execFileSync("git", ["grep", "-l", "-E", "listAllSessions|getRunningRpcSessionIds|getAwaitingInputRpcSessionIds", "--", "app/api"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => !f.includes(".test."));
  const unhooked = lister.filter((f) => !readFileSync(join(root, f), "utf8").includes("TG-HOOK:"));
  for (const f of unhooked) problems.push(`leak watch: ${f} lists sessions but has no TG-HOOK`);
} catch { /* no matches */ }

// new routes
const gate = readFileSync(join(root, "tigerai/adapter/gate.ts"), "utf8");
const routes = walk(join(root, "app/api")).filter((f) => f.endsWith("route.ts")).map((f) => "/" + relative(join(root, "app"), dirname(f)));
const unknown = routes.filter((r) => !r.startsWith("/api/tg") && !r.startsWith("/api/sessions") && !r.startsWith("/api/agent")
  && !gate.includes(r.replace(/\/\[.*$/, "")));
notes.push(`upstream routes members are refused by default (admin only): ${unknown.length}`);

for (const n of notes) console.log("note:", n);
if (problems.length) { for (const p of problems) console.error("FAIL:", p); process.exit(1); }
console.log(`ok: ${seenIds.size} hook ids, ${spec.hooks.length} locations, all markers present`);
