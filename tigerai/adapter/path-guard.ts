// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { addonAllowsMcpServer } from "../addons/registry";
import { isConnectorServer } from "../n8nmcp/runtime-templates";

/**
 * pi's read / grep / find / ls tools take any path the server process can read.
 * For a restricted (member or room) session they are fenced to the session's
 * own folder: the path is resolved against it, symlinks are followed, and
 * anything that lands outside is blocked before the tool runs.
 */
const FENCED = new Set(["read", "grep", "find", "ls"]);

function real(p: string): string {
  const abs = resolve(p);
  let probe = abs;
  const tail: string[] = [];
  for (;;) {
    try { return resolve(realpathSync(probe), ...tail.reverse()); } catch {
      const parent = resolve(probe, "..");
      if (parent === probe) return abs;
      tail.push(probe.slice(parent.length + 1));
      probe = parent;
    }
  }
}

export function pathAllowed(root: string, requested: unknown, extraRoots: string[] = []): boolean {
  const base = real(root);
  if (extraRoots.length && typeof requested === "string" && requested.startsWith("/")) {
    const t = real(requested);
    for (const extra of extraRoots) { const e = real(extra); if (t === e || t.startsWith(e + sep)) return true; }
  }
  if (requested === undefined || requested === null || requested === "") return true; // tool default = its cwd
  if (typeof requested !== "string") return false;
  let raw = requested.startsWith("@") ? requested.slice(1) : requested;
  if (raw.startsWith("~")) return false;
  if (raw.split(/[\\/]/).includes("..") && !resolve(base, raw).startsWith(base)) return false;
  raw = resolve(base, raw);
  const target = real(raw);
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
}

export function createPathGuard(cwd: string, extraRoots: string[] = []): InlineExtension {
  return {
    name: "tigerai-path-guard",
    hidden: true,
    factory: (pi) => {
      pi.on("tool_call", (event) => {
        // MCP tools of servers the operator put in a global mcp.json are not for restricted sessions;
        // MCP servers of the system connectors (n8n in the community edition; more with an active add-on package) are allowed here;
        // the connector extension checks the person's groups on every call itself.
        const server = /^mcp__(.+?)__/.exec(event.toolName)?.[1];
        if (event.toolName.startsWith("mcp__") && !(server && (isConnectorServer(server) || addonAllowsMcpServer(server)))) {
          return { block: true, reason: "This tool is not available in this conversation." };
        }
        if (!FENCED.has(event.toolName)) return undefined;
        const input = event.input as Record<string, unknown>;
        const globs = [input.pattern, input.glob].filter((v): v is string => typeof v === "string");
        if (!pathAllowed(cwd, input.path, extraRoots) || globs.some((g) => g.split(/[\\/]/).includes(".."))) {
          return { block: true, reason: "This conversation can only read files inside its own folder." };
        }
        return undefined;
      });
    },
  };
}
