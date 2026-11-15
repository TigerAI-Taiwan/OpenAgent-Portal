// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { homedir } from "node:os";
import { join } from "node:path";

/** The whole module is off unless TIGERAI_ENABLED=1; every hook then passes through. */
export function tgEnabled(): boolean {
  return process.env.TIGERAI_ENABLED === "1";
}

/** Where tigerai.db, the cookie key and the workspace live. */
export function dataDir(): string {
  const fromEnv = process.env.TIGERAI_DATA_DIR;
  if (fromEnv) return fromEnv;
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "tigerai");
}

/** Root of users/<id>, groups/<id> and rooms/<id> folders. */
export function workspaceRoot(): string {
  return process.env.TIGERAI_WORKSPACE_ROOT || join(dataDir(), "workspace");
}

/** How many background AI orders may run at the same time in this process (the model gateway has few slots). */
export function aiRunConcurrency(): number {
  const n = Number(process.env.TIGERAI_AI_RUN_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 8) : 2;
}
