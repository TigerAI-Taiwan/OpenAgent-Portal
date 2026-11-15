// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { pushSessionComplete } from "./index";

/** "This conversation is done" to the conversation's owner only (replaces upstream's broadcast to every subscription). Best effort, never throws. */
export function createCompletionPushExtension(): InlineExtension {
  return {
    name: "tigerai-completion-push",
    hidden: true,
    factory: (pi) => {
      pi.on("agent_settled", (event, ctx) => {
        if ((event as { aborted?: boolean }).aborted) return; // a stopped run did not finish anything
        try {
          void pushSessionComplete(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionName()).catch(() => undefined);
        } catch { /* best effort */ }
      });
    },
  };
}
