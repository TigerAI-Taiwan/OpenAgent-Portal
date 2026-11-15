// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// The rules of check-public.mjs, in a module of their own so a test can feed them fake strings. Written as fragments so this file
// does not trip its own scan.
const j = (...p) => p.join("");

export const rules = [
  [/\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/, "private IPv4 address", "private-ip"],
  [new RegExp(`\\b(${j("Srv", "0\\d")}|${j("srv", "0\\d")}|${j("wrt", "-srv")}|${j("97", "00x4")}|${j("Spar", "k")})\\b`, "i"), "internal machine name"],
  [new RegExp(j("n8n", "\\.tw")), "internal domain"],
  [new RegExp(j("tiger\\.ai", "\\.tw")), "internal domain"],
  [new RegExp(j("/home/", "wrt")), "home directory of a person"],
  [new RegExp(`${j("虎虎", "生風")}|${j("Taiwan Tech ", "Precision")}|${j("宏", "達")}`), "customer or demo company name", "demo-name"],
  // ---- secrets. Real keys are long and random; the generic sk- rule needs 32+ so short test placeholders ("sk-alice-1234") do not trip it.
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\bsk-or-v1-[A-Za-z0-9]{20,}/, "OpenRouter API key"],
  [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/, "sk- API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, "JWT (an n8n API key is one)"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\bnvapi-[A-Za-z0-9_-]{20,}/, "NVIDIA API key"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, "AWS access key"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/, "GitHub token"],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, "GitLab token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{20,}/, "Slack token"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/, "bearer token"],
  [/(?:token|secret|key|passw(?:or)?d|authorization|api[_-]?key)[^\n]{0,40}\b[0-9a-f]{40,}\b/i, "40+ hex token next to a key/secret word"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
];

/**
 * Private IPv4 literals in the upstream project's own test fixtures (they test its network-address and request-security code, so the
 * addresses ARE the data). Listed by file on purpose: a new file never inherits the exemption, and only the private-ip rule is waived.
 */
export const UPSTREAM_FIXTURE_PRIVATE_IPS = new Set([
  "app/api/open-in-explorer/route.test.mjs",
  "lib/network-addresses.test.mjs",
  "lib/open-in-file-manager.test.mjs",
  "lib/pi-web-cli-commands.test.mjs",
  "lib/request-security.test.mjs",
]);

/**
 * The two fictional story companies (a precision manufacturer, a university course) are named on purpose in the stories and in the README
 * that links them. Listed by file, like the fixtures above: a new file never inherits the exemption, and only the demo-name rule is waived.
 * A real customer's name is still caught everywhere else (and a story file that names one is not covered by "fictional").
 */
export const PUBLIC_STORY_FILES = new Set([
  "README.md", "README.en.md",
  "docs/stories/中小企業主_故事_v1.0.md", "docs/stories/SME_Story_v1.0_en.md",
  "docs/stories/學校課程_故事_v1.0.md", "docs/stories/School_Story_v1.0_en.md",
]);

const PUBLIC_CONTACTS = [j("tiger.ai", ".tw", "@", "gmail", ".com")];
const email = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g;
// The only real-looking emails allowed are example domains.
const okDomains = new Set(["example.com", "example.org", "example.net", "local", "users.noreply.github.com", "anthropic.com"]);

/** Findings for one line of one file: [label, ...]. */
export function scanLine(file, raw) {
  const out = [];
  const line = PUBLIC_CONTACTS.reduce((l, c) => l.split(c).join(""), raw);
  for (const [re, label, id] of rules) {
    if (id === "private-ip" && UPSTREAM_FIXTURE_PRIVATE_IPS.has(file)) continue;
    if (id === "demo-name" && PUBLIC_STORY_FILES.has(file)) continue;
    if (re.test(line)) out.push(label);
  }
  for (const m of line.matchAll(email)) if (!okDomains.has(m[1].toLowerCase()) && !m[1].toLowerCase().endsWith(".example") && !/^[a-z0-9-]+\.(ts|tsx|js|mjs|json|css)$/.test(m[1])) out.push(`email on a real-looking domain (${m[1]})`);
  return out;
}
export function scanText(file, text) {
  const found = [];
  text.split("\n").forEach((raw, i) => { for (const label of scanLine(file, raw)) found.push({ file, line: i + 1, label }); });
  return found;
}
