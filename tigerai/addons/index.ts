// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { AddonModule } from "./types";

/**
 * The server-side list of add-on packages compiled into this build. EMPTY in the community edition.
 * The consultant image build replaces this file with one that imports `./consultant` (tigerai/docs/ADDON.md).
 */
export const ADDONS: AddonModule[] = [];
