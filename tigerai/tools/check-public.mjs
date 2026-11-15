// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Hygiene scan before anything is published: node tigerai/tools/check-public.mjs [base-ref]
// Scans every file this fork added or changed relative to the base ref (default origin/main).
// Looks for internal addresses, machine names, customer/demo company names, key-looking strings.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const base = process.argv[2] ?? "origin/main";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const files = [...new Set([...git("diff", "--name-only", `${base}...HEAD`), ...git("diff", "--name-only"), ...git("ls-files", "--others", "--exclude-standard")])];

// Written as fragments so this file does not trip its own scan.
const j = (...p) => p.join("");
const rules = [
  [/\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/, "private IPv4 address"],
  [new RegExp(`\\b(${j("Srv", "0\\d")}|${j("srv", "0\\d")}|${j("wrt", "-srv")}|${j("97", "00x4")}|${j("Spar", "k")})\\b`, "i"), "internal machine name"],
  [new RegExp(j("n8n", "\\.tw")), "internal domain"],
  [new RegExp(j("tiger\\.ai", "\\.tw")), "internal domain"],
  [new RegExp(j("/home/", "wrt")), "home directory of a person"],
  [new RegExp(`${j("虎虎", "生風")}|${j("Taiwan Tech ", "Precision")}|${j("宏", "達")}`), "customer or demo company name"],
  [/\b(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{20,})\b/, "key-looking string"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
];
// The only real-looking emails allowed are example domains.
const email = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g;
const okDomains = new Set(["example.com", "example.org", "example.net", "local", "users.noreply.github.com", "anthropic.com"]);

// The product's own public contact address (shown in the brand popup, tigerai/ui/layout.ts CONTACT). The owner allowed it to be public.
const PUBLIC_CONTACTS = [j("tiger.ai", ".tw", "@", "gmail", ".com")];

let bad = 0;
for (const f of files) {
  let text;
  try { if (!statSync(join(root, f)).isFile()) continue; text = readFileSync(join(root, f), "utf8"); } catch { continue; }
  if (text.includes("\u0000")) continue;
  if (f === "package-lock.json" || f === "package.json") continue; // version ranges look like addresses
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const line = PUBLIC_CONTACTS.reduce((l, c) => l.split(c).join(""), raw);
    for (const [re, label] of rules) if (re.test(line)) { console.error(`${f}:${i + 1}: ${label}`); bad++; }
    for (const m of line.matchAll(email)) if (!okDomains.has(m[1].toLowerCase()) && !m[1].toLowerCase().endsWith(".example") && !/^[a-z0-9-]+\.(ts|tsx|js|mjs|json|css)$/.test(m[1])) { console.error(`${f}:${i + 1}: email on a real-looking domain (${m[1]})`); bad++; }
  });
}
if (bad) { console.error(`check-public: ${bad} finding(s) in ${files.length} file(s)`); process.exit(1); }
console.log(`check-public: ok (${files.length} files scanned against ${base})`);
