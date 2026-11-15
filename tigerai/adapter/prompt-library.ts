// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, tgEnabled } from "../config";
import { identityForSession } from "./identity";
import { promptsVisibleTo } from "../prompts/service";
import { mySkillsDir } from "../skills/builtin";
import { existsSync } from "node:fs";
import { unitSkillDirs } from "../skills/mine";

/**
 * Delivers the prompt library through pi's own mechanism: an extension answers
 * `resources_discover` with a folder of *.md prompt templates, so the "/" menu
 * (which lists the session's templates) shows exactly what this person may see.
 * No upstream call point is needed. The folder is rewritten on every startup and
 * /reload, so ticking a group takes effect at the person's next /reload or new
 * conversation.
 */

function materialise(user: { id: string } | null): string {
  const dir = join(dataDir(), "prompt-cache", user?.id ?? "_company");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
  for (const p of promptsVisibleTo(user)) {
    const desc = (p.description || p.name).replace(/\r?\n/g, " ").replace(/"/g, "'");
    writeFileSync(join(dir, `${p.name}.md`), `---\ndescription: "${desc}"\n---\n${p.body}\n`, { mode: 0o600 });
  }
  return dir;
}

export function createPromptLibraryExtension(cwd: string): InlineExtension {
  return {
    name: "tigerai-prompt-library",
    hidden: true,
    factory: (pi) => {
      pi.on("resources_discover", (_event, ctx) => {
        if (!tgEnabled()) return undefined;
        try {
          let sid: string | undefined;
          try { sid = ctx.sessionManager.getSessionId(); } catch { sid = undefined; }
          const who = identityForSession(sid, cwd);
          // The person's own skills (copies of built-ins and skills they made) live in their folder, which the SDK ignores as an
          // untrusted project folder; delivering them here shows them in that person's conversations only. Skills add words, not rights.
          const mine = who ? mySkillsDir(who.id) : null;
          const skillPaths = [...(mine && existsSync(mine) ? [mine] : []), ...(who ? unitSkillDirs(who.id) : [])];
          return { promptPaths: [materialise(who)], ...(skillPaths.length ? { skillPaths } : {}) };
        } catch (error) {
          console.error("[tigerai] prompt library:", error instanceof Error ? error.message : error);
          return undefined;
        }
      });
    },
  };
}
