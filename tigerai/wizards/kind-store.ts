// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { WizardKind } from "./types";

/**
 * Where the engine and the add-on registry keep the wizard kinds. A module of its own with no imports from the rest of tigerai, so
 * the add-on registry can register kinds without importing the engine (which imports rooms, which ask the registry).
 */
export type WizardModel = (req: { roomId: string | null; runnerId: string; prompt: string; kind: string }) => Promise<string>;
export type EngineState = { kinds: Map<string, WizardKind>; model: WizardModel | null; active: Set<string>; swept: boolean };
const KEY = Symbol.for("tigerai:wizards");
export const engineState = (): EngineState => ((globalThis as unknown as Record<symbol, EngineState | undefined>)[KEY] ??= { kinds: new Map(), model: null, active: new Set(), swept: false });
export function registerWizard(kind: WizardKind): void { engineState().kinds.set(kind.id, kind); }
