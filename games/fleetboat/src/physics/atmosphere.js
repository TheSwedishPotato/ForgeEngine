/**
 * The air inside the boat: 35,000 cubic feet of it (net, General Information Book O-3), shared by
 * the compartments while their doors stand open, breathed by everyone aboard.
 *
 * Dalton's law: each gas's partial pressure is its share of the moles times the total pressure;
 * the gauges and the crew feel the totals and the partial pressures.
 *  - The crew: each man burns about 0.45 litres of oxygen a minute at rest and gives back 0.385
 *    of carbon dioxide (77 men take 35,000 cu ft to 3 % CO2 in 18.2 hours, as the yard computed);
 *    more when working.
 *  - CO2 absorbent (lithium hydroxide, 15 lb containers spread on the mattresses: 0.10 lb takes
 *    a man-hour's CO2, a container serves 77 men two hours) and oxygen bled from the flasks
 *    (0.9 cubic feet a man-hour).
 *  - Engines draw the boat's air when the induction is shut (the pressure falls); the
 *    high-pressure bleed, tanks vented inboard and leaking air raise it ("pressure in the boat").
 *  - The batteries gas hydrogen while charging; the battery blowers draw it out of the cells to
 *    the ship's exhaust (overboard on the surface, into the boat's air when recirculating under
 *    water). Four per cent is the lower explosive limit.
 *  - Henry's law: the crew's tissues take up nitrogen in proportion to its partial pressure
 *    (five Haldane compartments, half-times 5 to 120 minutes); after a long time at a raised
 *    pressure in the boat, opening the hatch is a decompression.
 *  - Open the conning tower hatch on the surface (or the main induction, or the hull
 *    ventilation with its blowers running) and the boat breathes the open air.
 */
import { ATMOSPHERE, FT3 } from '../data/boat.js';
import { R_GAS, ATM } from './units.js';
import { AIR_COMPOSITION } from './gas.js';

const MOL_PER_L = 1 / 24.45;            // at 25 C, 1 atm
const HALF_TIMES = [5, 10, 20, 40, 120];  // minutes

export class Atmosphere {
  constructor() {
    this.V = ATMOSPHERE.netAirSpace;   // m^3 of air (less as water comes in)
    this.T = 295;
    const n = ATM * this.V / (R_GAS * this.T);
    this.n = { N2: n * (AIR_COMPOSITION.N2 + AIR_COMPOSITION.Ar), O2: n * AIR_COMPOSITION.O2, CO2: n * AIR_COMPOSITION.CO2, H2: 0 };
    this.battery = [{ V: 28, H2: 0 }, { V: 32, H2: 0 }];          // the battery wells' air (m^3, estimate) and their hydrogen (mol)
    this.absorbent = 0;                 // lb of CO2 absorbent spread and still working
    this.o2Bleed = 0;                   // mol/s from the oxygen flasks
    this.tissue = HALF_TIMES.map(() => 0.79 * ATM);   // inert gas tension in the crew's tissues (Pa)
    this.out = {};
  }

  get total() { return this.n.N2 + this.n.O2 + this.n.CO2 + this.n.H2; }
  get p() { return this.total * R_GAS * this.T / this.V; }
  frac(g) { return this.n[g] / this.total; }
  pp(g) { return this.frac(g) * this.p; }

  /** Add (+) or remove (-) n moles of air of the given composition (default: the boat's own). */
  exchange(n, comp = null) {
    if (n >= 0) {
      const c = comp ?? { N2: this.frac('N2'), O2: this.frac('O2'), CO2: this.frac('CO2'), H2: this.frac('H2') };
      for (const g in this.n) this.n[g] += n * (c[g] ?? 0);
    } else {
      const k = Math.min(0.5, -n / this.total);
      for (const g in this.n) this.n[g] *= 1 - k;
    }
  }

  /**
   * One step. env: {
   *   people: [{ work 0..1 }], outsideOpen: CdA (m^2) of openings to the open air above water,
   *   ventBlowers: m^3/s of forced exchange with the outside, batteryH2: [mol/s, mol/s],
   *   batteryFans: [m^3/s, m^3/s], batteryOverboard (bool), waterVolume (m^3 of flood water),
   *   heat (W into the air)
   * }
   */
  step(dt, env) {
    this.V = Math.max(50, ATMOSPHERE.netAirSpace - (env.waterVolume ?? 0));
    // ---- breathing
    let o2 = 0, co2 = 0;
    for (const p of env.people ?? []) {
      const lpm = 0.45 * (1 + 2.2 * (p.work ?? 0));
      o2 += lpm / 60 * MOL_PER_L; co2 += 0.855 * lpm / 60 * MOL_PER_L;
    }
    this.n.O2 = Math.max(0, this.n.O2 - o2 * dt); this.n.CO2 += co2 * dt;
    // ---- the absorbent takes CO2 (faster the more there is in the air), and is used up
    if (this.absorbent > 0) {
      const molPerLb = 1 / 0.10 * (0.385 * 60 * MOL_PER_L);       // a man-hour's CO2 per 0.10 lb
      const rate = Math.min(this.n.CO2 * 0.5, this.absorbent * molPerLb / 3600 * 2.0 * Math.min(1, this.frac('CO2') / 0.01));
      this.n.CO2 -= rate * dt;
      this.absorbent = Math.max(0, this.absorbent - rate * dt / molPerLb);
    }
    this.n.O2 += this.o2Bleed * dt;
    // ---- the battery wells: hydrogen given off, drawn out by the battery blowers
    for (let i = 0; i < 2; i++) {
      const w = this.battery[i];
      w.H2 += (env.batteryH2?.[i] ?? 0) * dt;
      const fan = env.batteryFans?.[i] ?? 0;
      const conc = w.H2 / (w.V * ATM / (R_GAS * this.T));
      const out = Math.min(w.H2, conc * fan * ATM / (R_GAS * this.T) * dt);
      w.H2 -= out;
      if (!env.batteryOverboard) this.n.H2 += out;
      // and some diffuses into the compartment anyway
      const leak = w.H2 * 0.0005 * dt;
      w.H2 -= leak; this.n.H2 += leak;
      w.pct = conc * 100;
    }
    // ---- the open air: an opening above water equalises the pressure and mixes the gases
    const outside = { N2: AIR_COMPOSITION.N2 + AIR_COMPOSITION.Ar, O2: AIR_COMPOSITION.O2, CO2: AIR_COMPOSITION.CO2, H2: 0 };
    const pOut = env.pOutside ?? ATM;
    if ((env.outsideOpen ?? 0) > 0) {
      const dp = pOut - this.p;
      const q = Math.sign(dp) * env.outsideOpen * Math.sqrt(2 * Math.abs(dp) / 1.2);    // m^3/s, incompressible enough for small dp
      const dn = q * this.p / (R_GAS * this.T) * dt;
      const lim = Math.abs(dp) * this.V / (R_GAS * this.T) * 0.5;
      this.exchange(Math.max(-lim, Math.min(lim, dn)), outside);
    }
    if ((env.ventBlowers ?? 0) > 0) {
      // supply and exhaust: replace the boat's air with fresh at the blowers' rate
      const k = Math.min(1, env.ventBlowers * dt / this.V);
      const nTot = this.total;
      for (const g in this.n) this.n[g] += (nTot * outside[g] - this.n[g]) * k;
    }
    // ---- temperature: machinery and people warm it, the hull cools it toward the sea
    const heatIn = (env.heat ?? 0) + (env.people?.length ?? 0) * 120;
    const C = this.total * 29.1;                                 // J/K (cp of the air) ...
    const hull = 2.2e4 * (this.T - (env.seaT ?? 288));           // W to the sea through the hull (estimate)
    this.T += dt * (heatIn - hull) / (C + 6e7);                   // ... and the boat's furniture, which holds most of the heat
    // ---- Henry's law in the crew: tissue nitrogen toward the inspired partial pressure
    const pN2 = this.pp('N2');
    for (let i = 0; i < HALF_TIMES.length; i++) {
      const k = Math.LN2 / (HALF_TIMES[i] * 60);
      this.tissue[i] += (pN2 - this.tissue[i]) * (1 - Math.exp(-k * dt));
    }
    const o = this.out;
    o.p = this.p; o.o2 = this.frac('O2') * 100; o.co2 = this.frac('CO2') * 100; o.h2 = this.frac('H2') * 100;
    o.ppO2 = this.pp('O2'); o.ppCO2 = this.pp('CO2'); o.T = this.T;
    // supersaturation if the pressure fell now to the outside air's: the worst tissue's ratio
    o.supersat = Math.max(...this.tissue) / Math.max(1, 0.79 * pOut);
    o.batteryH2 = this.battery.map((w) => w.pct ?? 0);
  }
}

export { FT3 };
