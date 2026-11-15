// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Pure decisions (no imports) for what a member may send; unit-tested without a server.

/**
 * Every command that changes which model answers or how hard it thinks. Models are an administrator's
 * function: the list is the upstream set (lib/rpc-manager.ts: set_model, set_thinking_level) plus the
 * names pi's RPC mode knows, so a later upstream version that starts handling one of them stays closed.
 */
export const MODEL_COMMANDS: readonly string[] = [
  "set_model", "cycle_model", "set_thinking_level", "cycle_thinking_level", "set_scoped_models",
  "set_default_model", "set_enabled_models", "set_model_scope",
];

// Commands a member may send to a session. Everything else (bash, set_tools,
// fork/clone, which would create sessions nobody owns, and every model command) is refused.
export const MEMBER_COMMANDS: ReadonlySet<string> = new Set([
  "prompt", "abort", "get_state", "navigate_tree", "compact",
  "set_session_name", "get_session_stats", "get_last_assistant_text", "set_auto_compaction", "clear_queue",
  "steer", "follow_up", "get_tools", "get_commands", "reload", "abort_compaction", "extension_ui_response",
  "extension_ui_input", "set_auto_retry", "ensure_session",
]);
export const MEMBER_NEW_COMMANDS: ReadonlySet<string> = new Set(["prompt", "ensure_session"]);

/** Body fields that pick a model or thinking level; a member never supplies them. */
export const MODEL_FIELDS: readonly string[] = ["provider", "modelId", "model", "thinkingLevel", "thinking", "level", "scopedModels"];

/** Fields that, besides the model itself, change how it thinks: never allowed for a member, even next to their own model. */
const THINKING_FIELDS: readonly string[] = ["thinkingLevel", "thinking", "level", "scopedModels", "model"];

/**
 * Reason the request is refused for a member, or null.
 * `ownModel(provider, modelId)` says whether that model is one of the caller's own personal connections (feature: personal keys):
 * only then a member may pick it, with `set_model` or with provider/modelId on a new conversation. Everything else stays locked.
 */
export function memberCommandDenied(body: unknown, allowed: ReadonlySet<string>, ownModel?: (provider: string, modelId: string) => boolean): string | null {
  const b = body as { type?: unknown } | null;
  const type = typeof b?.type === "string" ? b.type : undefined;
  if (!type) return "Unreadable command";
  const rec = (b ?? {}) as Record<string, unknown>;
  const own = !!ownModel && typeof rec.provider === "string" && typeof rec.modelId === "string" && ownModel(rec.provider, rec.modelId) && !THINKING_FIELDS.some((f) => rec[f] !== undefined && rec[f] !== null && rec[f] !== "");
  if (type === "set_model" && own) return null;
  if (MODEL_COMMANDS.includes(type)) return "model_locked: models are chosen by the administrator";
  if (!allowed.has(type)) return `Command not available to members: ${type}`;
  if (own && ["prompt", "ensure_session"].includes(type)) return null;
  if (MODEL_FIELDS.some((f) => rec[f] !== undefined && rec[f] !== null && rec[f] !== "")) return "model_locked: models are chosen by the administrator";
  return null;
}
