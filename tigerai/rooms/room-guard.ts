// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Pure decision (no imports) so it can be unit-tested without a server or a database.

export const ROOM_SESSION_MESSAGE = "這段對話只能從頻道使用";

/** Commands that only read; everything else (prompt, steer, follow_up, bash, abort, set_*, ...) is refused on a room session. */
const READ_COMMANDS = /^(get_[a-z_]+|ensure_session)$/;

/** True when a command sent over HTTP to this session must be refused. */
export function roomCommandRefused(isRoomSession: boolean, commandType: unknown): boolean {
  if (!isRoomSession) return false;
  return !(typeof commandType === "string" && READ_COMMANDS.test(commandType));
}
