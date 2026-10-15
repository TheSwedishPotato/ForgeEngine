/**
 * The compressed air: the boat's reserve of buoyancy.
 *
 *  - The 3000-pound system: five banks (seven flasks each, the No. 1 bank eight; 560 cubic
 *    feet in all) charged by two high-pressure compressors in the pump room (20 cubic feet of
 *    3000-pound air an hour each), stop valves from each bank to the high-pressure manifold on the
 *    control room's starboard side. From the manifold: the safety, negative and bow buoyancy
 *    tank blows; the two hammer valves to the 600-pound blowing manifold; the reducing valve to
 *    the 225-pound service air; the high-pressure bleed into the boat ("bleed air" after a dive,
 *    to prove the hull tight); the reducing valves to the engines' starting air (250 lb).
 *  - The 600-pound main ballast tank blowing manifold: a stop-check valve to each group of
 *    tanks. Its pressure is what the hammer valve lets through against what the tanks take;
 *    a sentinel valve sings at 610 and the reliefs lift at 750.
 *  - The 10-pound system: the low-pressure blower (a Roots blower in the pump room) and its
 *    manifold, used only after surfacing (its intake is the boat's own air, through the open
 *    conning tower hatch and induction), to finish blowing the tanks and save the banks.
 *
 * Air in the banks is at the sea's temperature; the flasks are real-gas (compressibility from
 * gas.js). The manifolds are pipes, small next to the tanks: their pressure is found each step
 * as the balance of what flows in and what flows out.
 */
import { AIR, FT3, PSI } from '../data/boat.js';
import { ATM, R_GAS } from './units.js';
import { molesReal, pressureReal, airMolarFlow } from './gas.js';

export const HAMMER_CdA = 2.5e-4;       // each hammer valve wide open (estimate: a 1" valve)
export const BLEED_CdA = 2.0e-5;        // high-pressure bleed into the boat
export const LP_BLOWER_M3S = 1350 * FT3 / 60;   // 1350 cfm free air (estimate: tanks dry in ~15 minutes, as the manual has it)
export const LP_BLOWER_PMAX = 13 * PSI; // the blower's relief (above atmospheric)

export class AirSystem {
  constructor() {
    this.T = 288;
    const v = AIR.bankVolume / AIR.banks;
    this.banks = Array.from({ length: AIR.banks }, (_, i) => ({ id: i + 1, V: v, n: 0, stop: 1 }));
    this.setBanks(AIR.pMax);
    this.hammer = [0, 0];               // the two hammer valves, opening 0..1
    this.p600 = ATM;                    // 600-lb manifold pressure (absolute)
    this.relief600 = false;
    this.sentinel = false;
    this.bleed = 0;                     // high-pressure bleed into the boat
    this.compressors = [false, false];
    this.lpBlower = false;
    this.p10 = ATM;                     // 10-lb manifold pressure (absolute)
    this.used = 0;                      // moles drawn from the banks since the start (for the log)
  }

  setBanks(p) { for (const b of this.banks) b.n = molesReal(p, b.V, this.T); }

  /** Pressure in a bank (Pa absolute). */
  bankP(b) { return pressureReal(b.n, b.V, this.T); }

  /** The high-pressure manifold: the banks whose stop valves are open, equalised. */
  get pHP() {
    let n = 0, V = 0;
    for (const b of this.banks) if (b.stop > 0.05) { n += b.n; V += b.V; }
    return V > 0 ? pressureReal(n, V, this.T) : ATM;
  }

  /** Total air in the banks as a fraction of a full 3000-lb charge. */
  get charge() {
    let n = 0;
    for (const b of this.banks) n += b.n;
    return n / molesReal(AIR.pMax, AIR.bankVolume, this.T);
  }

  /** Draws n moles from the banks that are cut in, in proportion to their contents. */
  draw(n) {
    if (n <= 0) return 0;
    let total = 0;
    for (const b of this.banks) if (b.stop > 0.05) total += b.n;
    if (total <= 0) return 0;
    const take = Math.min(n, total * 0.5);
    for (const b of this.banks) if (b.stop > 0.05) b.n -= take * (b.n / total);
    this.used += take;
    return take;
  }

  /**
   * The 600-lb manifold's pressure: the hammer valves' inflow balances what the open blow
   * valves take (the tanks' pressures pT[i] through effective areas a[i]); found by bisection.
   */
  solve600(pHP, outlets) {
    const ham = (this.hammer[0] + this.hammer[1]) * HAMMER_CdA;
    if (ham <= 0) {
      // nothing coming in: the manifold bleeds down into whatever is open
      const open = outlets.filter((o) => o.a > 0);
      if (open.length) this.p600 += (Math.max(...open.map((o) => o.p)) - this.p600) * 0.2;
      return this.p600;
    }
    const net = (p) => {
      let f = airMolarFlow(ham, pHP, this.T, p, this.T);
      for (const o of outlets) if (o.a > 0) f -= Math.max(0, airMolarFlow(o.a, p, this.T, o.p, this.T));
      if (p > AIR.mbtManifoldRelief) f -= airMolarFlow(3e-4 * (p / AIR.mbtManifoldRelief - 1) * 20, p, this.T, ATM, this.T);
      return f;
    };
    let lo = ATM * 0.5, hi = Math.max(pHP, ATM);
    for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (net(m) > 0) lo = m; else hi = m; }
    this.p600 = 0.5 * (lo + hi);
    this.relief600 = this.p600 > AIR.mbtManifoldRelief;
    this.sentinel = this.p600 - ATM > 610 * PSI;
    return this.p600;
  }

  /** The low-pressure blower: a positive displacement blower, its delivery against back pressure. */
  lpFlow(pIntake, pBack) {
    if (!this.lpBlower) return 0;
    const lift = pBack - pIntake;
    if (lift > LP_BLOWER_PMAX) return 0;
    // slip rises with the pressure lifted (a Roots blower leaks back between the lobes)
    const molPerS = LP_BLOWER_M3S * pIntake / (R_GAS * this.T);
    return molPerS * Math.max(0, 1 - 0.35 * Math.max(0, lift) / LP_BLOWER_PMAX);
  }

  /** The compressors charging the banks from the boat's air (or the open air): moles per second. */
  compressorFlow(pIntake) {
    // 20 cubic feet of 3000-lb air an hour each
    const perHour = molesReal(AIR.pMax, 20 * FT3, this.T);
    let q = 0;
    for (const on of this.compressors) if (on) q += perHour / 3600;
    return pIntake > 0.5 * ATM ? q : 0;
  }

  step(dt, { pIntake }) {
    const q = this.compressorFlow(pIntake);
    if (q > 0) {
      // into the banks cut in, up to 3000 psi
      const open = this.banks.filter((b) => b.stop > 0.05 && this.bankP(b) < AIR.pMax);
      for (const b of open) b.n += (q * dt) / open.length;
    }
    return q * dt;      // moles taken from the intake (the boat's air)
  }
}

export { ATM };
