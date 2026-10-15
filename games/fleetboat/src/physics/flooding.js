/**
 * Water inside the pressure hull: the compartments, what lets the sea in, and where it goes.
 *
 * Every hull opening has an area; open under water, the sea comes in by Torricelli
 * (Q = Cd A sqrt(2 dp / rho), dp the sea's pressure there over the boat's air): the main
 * induction (the USS Squalus was lost in 1939 to a main induction left open on a dive), the
 * engine exhausts, the hatches, the hull ventilation valves. Below the test depth the hull begins
 * to weep at its glands and fittings; its plating's hoop stress (sigma = p r / t on the 16 ft,
 * 7/8 in high-tensile hull) reaches the steel's yield near the 900 ft design collapse depth.
 *
 * The water runs through open doors to the lower compartment (over the sills), lies in the
 * bilges, and is weight where it lies: on the low end of a trimmed compartment (free surface).
 * The drain pump takes the bilges to sea while it can beat the sea's pressure. A compartment
 * shut off by its doors floods only until its air is squeezed to the sea's pressure (Boyle).
 */
import { COMPARTMENTS, HULL, STRENGTH, FT, PSI } from '../data/boat.js';
import { G } from './units.js';
import { waterFlowSmooth } from './gas.js';

const R = HULL.pressureHullDia / 2, AXIS = HULL.axisY;
const HTS_YIELD = (STRENGTH.collapseDepth / FT) * 0.4447 * PSI * R / STRENGTH.plate;   // hoop stress at the design collapse depth (0.4447 psi a foot of sea water)

/** Cross-section area of water standing h (m) deep in the bottom of the pressure hull circle. */
function segment(h) {
  const d = Math.max(0, Math.min(2 * R, h));
  const a = Math.acos(Math.max(-1, Math.min(1, (R - d) / R)));
  return R * R * a - (R - d) * Math.sqrt(Math.max(0, 2 * R * d - d * d));
}

export class Flooding {
  constructor() {
    this.comps = COMPARTMENTS.map((c) => ({
      ...c, water: 0, len: c.x0 - c.x1, x: (c.x0 + c.x1) / 2,
      // the floodable share of the hull's section (machinery and tanks take the rest)
      perm: c.volumeM3 / (Math.PI * R * R * (c.x0 - c.x1)),
      level: 0,
    }));
    this.byId = Object.fromEntries(this.comps.map((c) => [c.id, c]));
    this.openings = [];       // { id, comp, x, y, CdA, open: () => 0..1 }
    this.leak = 0;            // m^3/s through stressed fittings
    this.stress = 0;          // hull hoop stress (Pa)
    this.collapsed = false;
    this.inflow = {};         // by opening, m^3/s
  }

  /** Water depth standing in a compartment from its volume. */
  levelOf(c) {
    const area = c.water / (c.len * c.perm);
    let lo = 0, hi = 2 * R;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (segment(m) < area) lo = m; else hi = m; }
    return lo;
  }

  get total() { return this.comps.reduce((a, c) => a + c.water, 0); }

  /**
   * One step. env: { pBoat, seaP(x, y) -> Pa at a body point, keelDepth, rho, doors(i) -> 0..1 open,
   *                  pitch (rad), drain: { comp, rate m^3 } }
   */
  step(dt, env) {
    const rho = env.rho;
    // ---- the hull under pressure
    const dpHull = Math.max(0, env.seaP(0, AXIS) - env.pBoat);
    this.stress = dpHull * R / STRENGTH.plate;
    const testStress = STRENGTH.testPressure * R / STRENGTH.plate;
    // weeping past the test depth, growing toward collapse
    const over = Math.max(0, (this.stress - testStress * 1.05) / (HTS_YIELD - testStress));
    this.leak = 0;
    if (over > 0) {
      const CdA = 2e-5 * over * over * 40;
      for (const c of this.comps) {
        const q = waterFlowSmooth(CdA / this.comps.length, dpHull, rho) * dt;
        c.water += q; this.leak += q / dt;
      }
    }
    if (this.stress >= HTS_YIELD && !this.collapsed) this.collapsed = true;
    if (this.collapsed) for (const c of this.comps) c.water = Math.min(c.volumeM3, c.water + c.volumeM3 * 0.5 * dt);
    // ---- the openings
    for (const o of this.openings) {
      const k = o.open();
      if (k <= 0) { this.inflow[o.id] = 0; continue; }
      const pSea = env.seaP(o.x, o.y);
      const c = this.byId[o.comp];
      const pIn = env.pBoat + rho * G * Math.max(0, c.level - (o.y - 0.6));
      const q = Math.max(0, waterFlowSmooth(o.CdA * k, pSea - pIn, rho)) * dt;
      c.water = Math.min(c.volumeM3, c.water + q);
      this.inflow[o.id] = q / dt;
    }
    // ---- through the open doors: water runs over the sill to the lower side
    for (let i = 0; i < this.comps.length - 1; i++) {
      const a = this.comps[i], b = this.comps[i + 1];
      const open = env.doors(i);
      if (open <= 0) continue;
      const sill = 0.35;                                         // the door's sill above the bilge water line (m, estimate)
      const la = this.levelOf(a), lb = this.levelOf(b);
      // the trim tilts the water toward the low end: the aft compartment's floor is lower bow-up
      const tilt = Math.sin(env.pitch) * (a.x - b.x);
      const ha = la + tilt * 0.5 - sill, hb = lb - tilt * 0.5 - sill;
      if (ha <= 0 && hb <= 0) continue;
      const dh = ha - hb;
      const A = 0.5 * 0.97 * Math.max(0.05, Math.max(ha, hb));       // the door's width times the head over the sill
      const q = Math.sign(dh) * Math.min(Math.abs(dh) * a.len * 0.5, A * Math.sqrt(2 * G * Math.abs(dh)) * dt * open);
      a.water = Math.max(0, a.water - q); b.water = Math.max(0, b.water + q);
    }
    for (const c of this.comps) c.level = this.levelOf(c);
  }

  /** The flood water's weight and where it lies (shifted toward the low end by the trim). */
  massItems(pitch) {
    const out = [];
    for (const c of this.comps) {
      if (c.water <= 0.01) continue;
      const h = Math.max(0.05, c.level);
      const shift = Math.max(-c.len / 3, Math.min(c.len / 3, -Math.tan(pitch) * c.len * c.len / (12 * h)));
      out.push({ kg: c.water * 1025, x: c.x + shift, y: (AXIS - R) + h * 0.45, z: 0 });
    }
    return out;
  }
}

export { segment, HTS_YIELD };
