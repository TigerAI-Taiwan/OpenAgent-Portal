// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Hygiene scan before anything is published:
//   node tigerai/tools/check-public.mjs [base-ref]            files this fork added or changed (committed, staged, working tree, untracked)
//   node tigerai/tools/check-public.mjs --staged              only what is staged, read from the index (for a pre-commit hook)
//   node tigerai/tools/check-public.mjs [base-ref] --history  also every line any commit since base ever added (a key added in one commit and
//                                                             removed in the next is gone from the final diff but not from the pushed history)
// Looks for internal addresses, machine names, customer/demo company names, key-looking strings (rules: check-public-rules.mjs).
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanLine, scanText } from "./check-public-rules.mjs";

const root = process.env.CHECK_PUBLIC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const staged = args.includes("--staged");
const history = args.includes("--history");
const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
const gitRaw = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const git = (...a) => gitRaw(...a).split("\n").filter(Boolean);
const skip = (f) => f === "package-lock.json" || f === "package.json"; // version ranges look like addresses

let files;
if (staged) files = git("diff", "--cached", "--name-only", "--diff-filter=ACMR");
else files = [...new Set([...git("diff", "--name-only", `${base}...HEAD`), ...git("diff", "--name-only"), ...git("diff", "--cached", "--name-only"), ...git("ls-files", "--others", "--exclude-standard")])];

let bad = 0;
const report = (f, line, label) => { console.error(`${f}:${line}: ${label}`); bad++; };
for (const f of files) {
  if (skip(f)) continue;
  let text;
  try {
    if (staged) text = gitRaw("show", `:${f}`);
    else { if (!statSync(join(root, f)).isFile()) continue; text = readFileSync(join(root, f), "utf8"); }
  } catch { continue; }
  if (text.includes("\u0000")) continue;
  for (const x of scanText(f, text)) report(x.file, x.line, x.label);
}

let commits = 0;
if (history && !staged) {
  // Added lines of every commit in the range. A finding names the commit, so the history can be rewritten at the right place.
  const log = gitRaw("log", "-p", "--no-color", "--no-merges", "-U0", "--format=@@COMMIT %h", `${base}..HEAD`);
  let sha = "", file = "";
  for (const l of log.split("\n")) {
    if (l.startsWith("@@COMMIT ")) { sha = l.slice(9); commits++; continue; }
    if (l.startsWith("+++ b/")) { file = l.slice(6); continue; }
    if (l.startsWith("+++") || !l.startsWith("+") || skip(file)) continue;
    for (const label of scanLine(file, l.slice(1))) report(`${file}@${sha}`, "+", `${label} (in history)`);
  }
}
if (bad) { console.error(`check-public: ${bad} finding(s) in ${files.length} file(s)${history ? ` and ${commits} commit(s)` : ""}`); process.exit(1); }
console.log(`check-public: ok (${files.length} files${staged ? " staged" : ` scanned against ${base}`}${history ? `, ${commits} commits of history` : ""})`);
