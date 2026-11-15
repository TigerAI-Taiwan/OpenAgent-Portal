// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * Throttles (1.1.0-ce). Before, ONE counter for the whole server doubled its wait on every failure, so a student's two typos made the
 * rest of the class wait. Now each KEY has its own counter: the account (e-mail) for sign-in and registration, the class (passphrase)
 * for how many registrations it takes in an hour. A separate GLOBAL ceiling, far above anything a class does, stays as the last resort
 * against someone who rotates keys to dodge the per-key counters. State lives on globalThis (shared by proxy/route bundles, survives hot reload).
 */
const STEP_MS = 1000, MAX_WAIT_MS = 60_000, FORGET_MS = 5 * 60_000, MAX_KEYS = 5000;

export class Blocked extends Error { constructor(public retryAfter: number) { super("Too many attempts"); } }
type Entry = { fails: number; blockedUntil: number; last: number };

export class KeyedThrottle {
  private m = new Map<string, Entry>();
  /** Throws Blocked while this key is waiting. */
  check(key: string, now = Date.now()): void {
    const e = this.m.get(key);
    if (!e) return;
    if (now - e.last > FORGET_MS) { this.m.delete(key); return; }
    if (e.blockedUntil > now) throw new Blocked(Math.ceil((e.blockedUntil - now) / 1000));
  }
  fail(key: string, now = Date.now()): void {
    if (this.m.size >= MAX_KEYS) this.prune(now);
    const e = this.m.get(key) ?? { fails: 0, blockedUntil: 0, last: now };
    if (now - e.last > FORGET_MS) e.fails = 0;
    e.fails += 1; e.last = now; e.blockedUntil = now + Math.min(MAX_WAIT_MS, STEP_MS * 2 ** (e.fails - 1));
    this.m.set(key, e);
  }
  ok(key: string): void { this.m.delete(key); }
  private prune(now: number): void { for (const [k, e] of this.m) if (now - e.last > FORGET_MS) this.m.delete(k); if (this.m.size >= MAX_KEYS) this.m.clear(); }
}

/** At most `limit` events in the last `windowMs`, counted over everything. */
export class WindowCeiling {
  private at: number[] = [];
  constructor(private windowMs: number) {}
  private trim(now: number): void { while (this.at.length && now - this.at[0] >= this.windowMs) this.at.shift(); }
  check(limit: number, now = Date.now()): void { this.trim(now); if (this.at.length >= limit) throw new Blocked(Math.max(1, Math.ceil((this.at[0] + this.windowMs - now) / 1000))); }
  add(now = Date.now()): void { this.trim(now); this.at.push(now); }
  count(now = Date.now()): number { this.trim(now); return this.at.length; }
}

const ROOT = Symbol.for("tigerai:throttles-v11");
interface Registry { loginAccount: KeyedThrottle; loginGlobal: WindowCeiling; regAccount: KeyedThrottle; regWrongGlobal: WindowCeiling; regDoneGlobal: WindowCeiling; regDoneClass: Map<string, WindowCeiling> }
export function throttles(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  return (g[ROOT] ??= { loginAccount: new KeyedThrottle(), loginGlobal: new WindowCeiling(5 * 60_000), regAccount: new KeyedThrottle(), regWrongGlobal: new WindowCeiling(10 * 60_000), regDoneGlobal: new WindowCeiling(3600_000), regDoneClass: new Map() });
}
export function resetThrottles(): void { (globalThis as unknown as Record<symbol, Registry | undefined>)[ROOT] = undefined; }

const num = (name: string, def: number): number => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? Math.floor(n) : def; };
/** Failed sign-ins over the whole server in 5 minutes before everybody waits (a class mistyping at once stays far below this). */
export const loginGlobalLimit = (): number => num("TIGERAI_LOGIN_GLOBAL_FAILS", 300);
/** Wrong passphrases over the whole server in 10 minutes. */
export const regWrongGlobalLimit = (): number => num("TIGERAI_REGISTER_WRONG_GLOBAL", 200);
/** Registrations a single class (passphrase) takes per hour. */
export const registerPerClassHour = (): number => num("TIGERAI_REGISTER_PER_HOUR", 120);
/** All classes together per hour: ten times a class. */
export const registerGlobalHour = (): number => num("TIGERAI_REGISTER_GLOBAL_PER_HOUR", registerPerClassHour() * 10);
