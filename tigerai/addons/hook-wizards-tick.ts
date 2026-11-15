// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { addonHook } from "./registry";

/** /api/tigerai/hooks/wizards/tick: answered by an active add-on package, otherwise 404 (the community edition has no such endpoint). */
export const POST = (req: Request): Promise<Response> => addonHook("wizards/tick", req);
