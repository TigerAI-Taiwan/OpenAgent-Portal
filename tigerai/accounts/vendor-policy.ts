// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: the maintenance (虎智) account's allow-list, shared by the proxy gate and the API dispatcher (both check it).
// Default is DENY. The maintenance account may look at the system (status, model connections, service settings) and manage its
// own sign-in. It never reads people: no conversations, no 使用者紀錄, no personal folders, no audit trail of people, no keys,
// no accounts, no org, no channels, no work orders.

/** Admin API prefixes (below /api/tg/admin/) the maintenance account may READ (GET only; security review H1). */
const ADMIN_ALLOWED = ["system", "models", "web", "asr", "connectors"];
/** Everyone's own-account routes the account needs to sign in, sign out and keep its own sign-in details. */
const SELF = new Set(["me", "logout", "account/password", "account/profile", "account/email", "activity"]);

export function vendorAllows(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (path.startsWith("/api/tg/admin/")) {
    const rest = path.slice("/api/tg/admin/".length).split("/");
    if (!ADMIN_ALLOWED.includes(rest[0])) return false;
    // Read-only: no address or key change, and no "test" (it posts to an address the caller names). Changing these needs the customer's administrator.
    if (rest[0] === "connectors" && rest.filter(Boolean).length > 1) return false; // the list only: not the per-workflow owner records
    return m === "GET" && !rest.includes("test") && !rest.includes("test-converter");
  }
  if (path.startsWith("/api/tg/")) return SELF.has(path.slice("/api/tg/".length)) || (m === "GET" && path === "/api/tg/addons");
  if (path === "/api/tg" || path === "/api") return false;
  if (path.startsWith("/api/")) return m === "GET" && (path === "/api/models" || path === "/api/models/default"); // the model list is not personal
  return true; // pages (the shell); every data call above is checked
}
