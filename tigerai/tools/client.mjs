// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Tiny cookie-keeping HTTP client shared by the seed script and the contract tests.
export class Client {
  constructor(base) { this.base = base; this.cookie = ""; }
  async req(method, path, body, headers = {}) {
    const res = await fetch(this.base + path, {
      method, redirect: "manual",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(p, h) { return this.req("GET", p, undefined, h); }
  post(p, b = {}, h) { return this.req("POST", p, b, h); }
  async login(email, password) {
    const r = await this.post("/api/tg/login", { email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
    return r.json;
  }
}
