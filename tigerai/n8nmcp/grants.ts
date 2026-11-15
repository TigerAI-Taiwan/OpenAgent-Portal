// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { registerOrderKind } from "../workorders/service";

/**
 * 1.1.0-ce: n8n WRITES NO LONGER NEED APPROVAL (Founder: only 分享/上架 is reviewed). Everyone who may use an n8n connector may create,
 * change, test and run their own workflows; every call is still audited (mcp.tool_call, with write:true for a write tool).
 * What needs an administrator is PUBLISHING a workflow for others (n8n/publish.ts).
 *
 * This file used to hold the grants of the `n8n_request_write` flow. The tool and the grant check are gone; only this handler stays
 * so that an old pending 「n8n 修改申請」 can still be closed by an administrator (approving it changes nothing now).
 */
export const ORDER_KIND = "n8n_mcp_write";
registerOrderKind(ORDER_KIND, (order) => order.id);
