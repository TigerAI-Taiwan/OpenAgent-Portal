// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: loaded directly by the tests. Upstream's panels ask four admin-only endpoints on every load. The server refuses a
// member (correct), but each refusal printed a red 403 in the console. For a member those four GETs are answered here with
// the same "nothing available" the panels already handle, so no refused request is made. The server still enforces it.
export type Quiet = { status: number; body: unknown };

export function quietAnswer(url: string, method: string | undefined): Quiet | null {
  if ((method ?? "GET").toUpperCase() !== "GET") return null;
  const path = (url.startsWith("http") ? new URL(url).pathname : url.split("?")[0]);
  switch (path) {
    case "/api/open-in-explorer": return { status: 403, body: { error: "unavailable" } };
    case "/api/worktrees": return { status: 200, body: { error: "unavailable" } };
    case "/api/git/status": return { status: 200, body: { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 } };
    // The model list needs a folder for a member; asked without one (before the sidebar has chosen) it is refused, so answer empty.
    case "/api/models": return /[?&]cwd=/.test(url) ? null : { status: 200, body: { models: {}, modelList: [], defaultModel: null, defaultThinkingLevel: null } };
    case "/api/project-trust": return { status: 200, body: { requiresTrust: false, trusted: false, decision: null, inherited: false } };
    default: return null;
  }
}
