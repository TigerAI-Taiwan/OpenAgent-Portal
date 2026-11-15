// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { randomUUID } from "node:crypto";
import { registerOwner } from "../rooms/ownership";
import { roomDir } from "../rooms/service";
import { promptAndWait } from "../rooms/ai";
import { ensurePersonalDir } from "../workspace";
import { startRpcSession } from "../../lib/rpc-manager";

/**
 * The only place a wizard touches the pi runtime. It starts a fresh conversation for each run, in the channel's own folder, owned by the
 * channel and run for its creator: the same "shared conversation" the channel's @AI uses, so the read-only member tool set and the
 * file fence (H08) apply. No speaker is registered, so the conversation has no n8n access at all: a wizard writes text from the
 * prompt it was given and does nothing else (the channel text it reads cannot talk it into calling a flow).
 * It is loaded on first use; tests install a fake with setWizardModel and never load this file.
 */

export async function runtimeModel(req: { roomId: string | null; runnerId: string; prompt: string }): Promise<string> {
  const dir = req.roomId ? roomDir(req.roomId) : ensurePersonalDir(req.runnerId);
  const { session, realSessionId } = await startRpcSession(`__new__${randomUUID()}`, "", dir, {});
  registerOwner(realSessionId, req.runnerId, dir, "wizard", req.roomId);
  return await promptAndWait(session, req.prompt);
}
