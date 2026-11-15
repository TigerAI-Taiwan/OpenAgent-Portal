// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { tgEnabled } from "../config";
import { isAddonActive } from "../addons/registry";
import { EXTERNAL_TICK_FRESH_MS, lastExternalTick, recordBuiltinPass, tick, type TickResult } from "./engine";

/**
 * The Portal's own wizard schedule (community edition): every 5 minutes it asks the engine what is due and starts it, with the same
 * rules as any other caller of `tick()` (a wizard's time has come, once per day/week, at most two at once and only into free AI slots).
 *
 * Stand-down: when the consultant add-on is active (licensed) AND it has received a schedule call within the last hour, the add-on's
 * external scheduler is in charge and this timer does nothing. If those calls stop for an hour the timer takes over again by itself,
 * so a broken external scheduler can never leave wizards silent. TIGERAI_WIZARD_SCHEDULER_MS overrides the 5-minute step (0 = off).
 */

export const SCHEDULER_STEP_MS = 5 * 60_000;
export const SCHEDULER_ADDON_ID = "consultant";

export function schedulerStepMs(): number {
  const raw = process.env.TIGERAI_WIZARD_SCHEDULER_MS;
  if (raw === undefined || raw === "") return SCHEDULER_STEP_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : SCHEDULER_STEP_MS;
}

/** True while the add-on's external scheduler is in charge. */
export function externalInCharge(now = Date.now()): boolean {
  if (!isAddonActive(SCHEDULER_ADDON_ID, now)) return false;
  const last = lastExternalTick();
  return last !== null && now - last <= EXTERNAL_TICK_FRESH_MS;
}

export async function schedulerPass(now = Date.now()): Promise<{ stoodDown: true } | { stoodDown: false; result: TickResult }> {
  if (externalInCharge(now)) return { stoodDown: true };
  const result = await tick(now);
  recordBuiltinPass(now);
  return { stoodDown: false, result };
}

const TIMER = Symbol.for("tigerai:wizard-scheduler");
/** Idempotent; the timer does not keep the process alive. A pass that throws is logged and the next one still runs. */
export function startScheduler(): void {
  if (!tgEnabled()) return;
  const g = globalThis as unknown as Record<symbol, ReturnType<typeof setInterval> | undefined>;
  if (g[TIMER]) return;
  const step = schedulerStepMs();
  if (step === 0) return;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    schedulerPass().catch((e) => console.error("[tigerai] wizard scheduler pass failed:", e instanceof Error ? e.message : e)).finally(() => { busy = false; });
  }, step);
  timer.unref?.();
  g[TIMER] = timer;
  // One pass shortly after start so a wizard whose time passed while the server was down does not wait a whole step.
  setTimeout(() => { void schedulerPass().catch(() => undefined); }, 15_000).unref?.();
}
