// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/** The per-folder cache of the installed-skills list the 技能 page shows (60 s). Adopting a proposal clears it so the new skill shows at once. */
export const skillCache = new Map<string, { at: number; rows: { name: string; description: string }[] }>();
export function clearSkillCache(): void { skillCache.clear(); }
