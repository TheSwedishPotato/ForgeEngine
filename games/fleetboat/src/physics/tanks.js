/**
 * The ballast tanks: what makes the boat dive and rise.
 *
 * Each tank holds water below and a bubble of air above (moles n, at the sea's temperature).
 * The air's pressure is Boyle's: p = nRT / V_air. Water stands in the tank where the pressures
 * balance: the air's pressure plus the column of water inside equals the sea's pressure at the
 * flood ports in the bottom of the tank (P = rho g h).
 *
 *  - A main ballast tank has no flood valves: its flood ports are always open, so the water
 *    stands wherever the air lets it. Surfaced, the air in a "dry" tank is held at the sea's
 *    pressure at the ports, 15 ft down (6.6 psi above the atmosphere). Open the vent on top and
 *    that air rushes out; the sea comes in through the ports as fast as the air leaves. Blow it
 *    and the air pushes the water back out; blow too much and the rest bubbles out of the ports.
 *    Going up with the vents shut, the air expands as the sea's pressure falls and drives more
 *    water out by itself (Boyle); going down, it is squeezed and the tank takes water.
 *  - Safety, negative and the fuel ballast tanks have flood valves: water comes in only as fast
 *    as the valve passes it (Torricelli: Q = Cd A sqrt(2 dp / rho)).
 *  - The variable (trim and auxiliary) tanks have no sea connection at all: the trim pump and
 *    the trim manifold move their water (trim.js).
 *
 * Every tank is a vertical prism (its capacity spread evenly between its bottom and top heights,
 * which put its centre where the yard's moment diagram has it).
 */
import { TANKS, FT } from '../data/boat.js';
import { R_GAS, G } from './units.js';
import { airMolarFlow, waterFlowSmooth } from './gas.js';

const T0 = 288.15;

/** Heights of each tank (ft above the keel): bottom and top, centred on the yard's KG. Estimates. */
const HEIGHTS = {
  mbt1: [0.6, 13.1], mbt2a: [1.5, 18.3], mbt2b: [1.5, 18.3], mbt2c: [0.6, 17.9], mbt2d: [0.6, 17.9],
  fbt3a: [0.5, 17.8], fbt3b: [0.5, 17.8], mbt4a: [0.4, 17.9], mbt4b: [0.4, 17.9], fbt5a: [0.4, 17.9], fbt5b: [0.4, 17.9],
  mbt6a: [0.5, 17.9], mbt6b: [0.5, 17.9], mbt6c: [0.4, 17.7], mbt6d: [0.4, 17.7], mbt7: [4.0, 13.6],
  safety: [0.8, 17.9], negative: [0.5, 5.7], bowBuoyancy: [16.5, 24.0],
  fwdTrim: [5.6, 13.6], fwdWRT: [3.0, 8.3], aux1: [1.0, 17.2], aux2: [1.0, 17.2], aftWRT: [6.5, 13.0], aftTrim: [12.9, 18.1],
};

/**
 * Effective areas (Cd A, m^2). Vents: the main vents are 10-12" valves on risers to the
 * superstructure (estimate); flood valves of the safety and negative tanks are large (they must
 * flood in seconds on a dive); the blow lines are 1 1/2" to 2" pipe.
 */
const VENT = { mbt: 0.030, fbt: 0.030, safety: 0.020, negative: 0.012, bowBuoyancy: 0.028, variable: 0.004 };
const FLOOD = { safety: 0.10, negative: 0.075, fbt: 0.25 };   // the fuel ballast tanks' rectangular flood valves, left open when they serve as main ballast
const BLOW = { mbt: 3.5e-4, fbt: 3.0e-4, safety: 9.0e-4, negative: 6.0e-4, bowBuoyancy: 3.5e-4, variable: 2.5e-4 };

export class Tank {
  constructor(def) {
    Object.assign(this, def);
    const [y0, y1] = HEIGHTS[def.id] ?? [def.kg - 4, def.kg + 4];
    this.y0 = y0 * FT; this.y1 = y1 * FT;
    this.H = this.y1 - this.y0;
    this.A = this.volume / this.H;
    this.zOff = def.z * (def.kind === 'variable' ? 2.2 : 2.6);     // port/starboard tanks sit off the centreline (m)
    this.free = def.kind === 'mbt' || def.kind === 'bowBuoyancy';   // free flooding: ports always open
    this.ventCdA = VENT[def.kind] ?? 0.02;
    this.floodCdA = FLOOD[def.kind] ?? 0;
    this.blowCdA = BLOW[def.kind] ?? 5e-4;
    this.vent = 0;              // outboard vent opening 0..1 (moved by its operating gear)
    this.flood = 0;             // flood valve opening 0..1 (tanks that have them)
    this.ventInboard = 0;       // inboard vent (safety, negative, variable: into the boat)
    this.T = T0;
    this.water = 0;             // m^3 of water
    this.n = 0;                 // moles of air
    this.residual = def.kind === 'mbt' || def.kind === 'fbt' ? 0.011 * this.volume : 0;
    this.bubbling = 0;          // mol/s of air escaping through the flood ports (for the bubbles)
    this.venting = 0;           // mol/s out of the vent (for the roar and the plume)
    this.pAir = 101325;
  }

  /** Fills the tank with water (frac 0..1) and air at pressure p (Pa). */
  set(frac, p) {
    this.water = Math.max(this.residual, Math.min(this.volume, frac * this.volume));
    const Va = Math.max(1e-6, this.volume - this.water);
    this.pAir = p;
    this.n = (p * Va) / (R_GAS * this.T);
  }

  get level() { return this.water / this.A; }                  // height of the water above the bottom (m)
  get fill() { return this.water / this.volume; }
  get airVolume() { return Math.max(1e-6, this.volume - this.water); }

  /**
   * One step. env: { pPort, pTop, pBoat, rho, T, ventOutlet (Pa at the vent's outlet),
   *                  blow: { p, T } supply on this tank's blow line (or null), blowOpen 0..1 }
   * Returns the moles of air that went into the boat (inboard venting) and taken from the blow
   * supply this step.
   */
  step(dt, env) {
    const { pPort, rho } = env;
    this.T = env.T;
    const RT = R_GAS * this.T;
    let toBoat = 0, fromSupply = 0;
    // ---- air: blow in, vent out (outboard to the sea or the air; inboard into the boat)
    const pa = this.n * RT / this.airVolume;
    this.pAir = pa;
    if (env.blow && env.blowOpen > 0) {
      const q = Math.max(0, airMolarFlow(this.blowCdA * env.blowOpen, env.blow.p, env.blow.T, pa, this.T));   // a check valve: no backflow
      const dn = q * dt;
      this.n += dn; fromSupply += dn;
    }
    this.venting = 0;
    if (this.vent > 0) {
      const q = airMolarFlow(this.ventCdA * this.vent, pa, this.T, env.ventOutlet, this.T);
      let dn = Math.min(this.n * 0.5, q * dt);
      // the outlet under water: air only goes out (the sea above a lower-pressure bubble comes down
      // the riser instead, which is the same as coming in by the ports); in the open air it can
      // also draw air in, when the tank's bubble is below the atmosphere's pressure
      if (dn < 0 && !env.ventInAir) dn = 0;
      this.n -= dn;
      if (dn > 0) this.venting += dn / dt;
    }
    if (this.ventInboard > 0) {
      const q = airMolarFlow(this.ventCdA * 0.6 * this.ventInboard, pa, this.T, env.pBoat, env.TBoat ?? this.T);
      const dn = Math.max(-this.n * 0.5, Math.min(this.n * 0.5, q * dt));
      this.n -= dn; toBoat += dn;
      this.venting += Math.max(0, dn / dt);
    }
    // ---- water
    this.bubbling = 0;
    if (this.free) this._quasiStatic(pPort, rho, RT, dt);
    else if (this.kind !== 'variable') this._throughValve(dt, pPort, rho, RT);
    this.pAir = this.n * RT / this.airVolume;
    return { toBoat, fromSupply };
  }

  /**
   * Free-flooding tank: the water stands where p_air + rho g h = p_port. With a = rho g,
   * c = nRT/A, H the tank's height, solve c/(H - h) + a h = p for h in [0, H):
   *   a h^2 - (a H + p) h + (p H - c) = 0, the smaller root.
   */
  _quasiStatic(p, rho, RT, dt) {
    const a = rho * G, H = this.H, c = this.n * RT / this.A;
    const hmin = this.residual / this.A;
    // the most air the tank can hold: dry to the residual water, at the port's pressure less that column
    const pDry = p - a * hmin;
    const nMax = Math.max(0, pDry) * (this.volume - this.residual) / RT;
    if (this.n > nMax) { this.bubbling = (this.n - nMax) / dt; this.n = nMax; this.water = this.residual; return; }
    const B = a * H + p, C = p * H - c;
    const disc = Math.max(0, B * B - 4 * a * C);
    let h = (B - Math.sqrt(disc)) / (2 * a);
    h = Math.min(H * 0.9999, Math.max(hmin, h));
    this.water = h * this.A;
  }

  /** A tank with a flood valve: water flows through it (Torricelli) toward the pressure balance. */
  _throughValve(dt, p, rho, RT) {
    if (this.flood <= 0) return;
    const h = this.level;
    const Va = this.airVolume;
    const pa = this.n * RT / Va;
    const dp = p - (pa + rho * G * h);                     // + the sea pushes in
    let dV = waterFlowSmooth(this.floodCdA * this.flood, dp, rho) * dt;
    // never step past the balance: d(dp)/dV = -(pa / Va + rho g / A)
    const stiff = pa / Va + rho * G / this.A;
    const toBalance = dp / stiff;
    if (Math.abs(dV) > Math.abs(toBalance)) dV = toBalance;
    // pushed out below the bottom: the air follows the water out through the valve
    let w = this.water + dV;
    if (w < this.residual) {
      // the excess air at the bottom bubbles out
      const pDry = p;
      const nMax = Math.max(0, pDry) * (this.volume - this.residual) / RT;
      if (this.n > nMax) { this.bubbling = (this.n - nMax) / dt; this.n = nMax; }
      w = this.residual;
    }
    this.water = Math.min(this.volume * 0.9999, w);
  }
}

export function makeTanks() {
  return TANKS.map((d) => new Tank(d));
}

export { HEIGHTS, T0 };
