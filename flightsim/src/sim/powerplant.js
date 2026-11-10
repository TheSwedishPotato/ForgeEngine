/**
 * The engine, as a machine rather than a thrust number: a Lycoming O-320-D2J (four cylinders, 5.24 litres, 8.5:1, 160 hp at
 * 2700 rpm) with a float carburettor, two magnetos, a primer, an electric starter and gravity-fed wing tanks.
 *
 * Each step: air is drawn past the throttle plate into the manifold (the manifold pressure settles where the flow through the
 * throttle equals what the cylinders pump), the carburettor meters fuel into it by venturi suction (which is why it runs richer
 * as the air thins, and why you lean), some of the fuel vaporises and the rest wets the manifold walls and evaporates later
 * (which is why a cold engine needs priming and can be flooded), the charge burns if there is a spark and the mixture is
 * inside its limits, friction and pumping take their share, and what is left turns the propeller. The carburettor can ice up.
 * Heat goes into the cylinder heads and the oil and out through the cooling air. Run a tank dry and it stops.
 */
import { clamp, sat, lag, table, rng, R_AIR, RPM, GAL, AVGAS, DEG } from './util.js';

const VD = 0.005244;                        // m3 swept by the four cylinders
const THROAT = 1.45e-3 * 0.85;              // carburettor throat area x discharge coefficient, m2
const FA_ST = 0.0672, LHV = 43.5e6;         // stoichiometric fuel/air, J/kg of avgas
const ETA_I = 0.405;                        // indicated efficiency at best power, warm
const PHI = [0.55, 0.62, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.6, 1.9, 2.2, 2.5];
const PF = [0, 0.35, 0.66, 0.84, 0.93, 0.975, 1.0, 0.985, 0.95, 0.88, 0.7, 0.4, 0];       // power against mixture strength
const EGT_PHI = [0.6, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.8], EGT_C = [560, 690, 750, 790, 760, 700, 640, 590];
const HEAT_PHI = [0.6, 0.8, 1.0, 1.05, 1.3, 1.6], HEAT_F = [0.7, 0.85, 1.0, 1.0, 0.86, 0.75];
const esat = (tC) => 610.94 * Math.exp((17.625 * tC) / (tC + 243.04));

/** Mass flow function of a compressible orifice against pressure ratio (choked below 0.528). */
function psi(pr) {
  if (pr >= 1) return 0;
  if (pr < 0.5283) return 0.6847;
  return Math.sqrt(7 * (Math.pow(pr, 1.4286) - Math.pow(pr, 1.7143)));
}

/** Two wing tanks, a selector valve, and gravity. */
export class FuelSystem {
  constructor() {
    this.capacity = 21.5 * GAL * AVGAS;       // kg per tank (21.5 US gal)
    this.unusable = 1.5 * GAL * AVGAS;
    this.tank = [this.capacity * 0.6, this.capacity * 0.6];
    this.selector = 2;                        // 0 OFF, 1 LEFT, 2 BOTH, 3 RIGHT
    this.water = false;
  }
  get total() { return this.tank[0] + this.tank[1]; }
  gallons(i) { return this.tank[i] / AVGAS / GAL; }
  usable(i) { return Math.max(0, this.tank[i] - this.unusable); }
  /** Is fuel reaching the strainer? */
  get feeding() { const s = this.selector; return (s === 1 || s === 2) && this.usable(0) > 0 || (s === 3 || s === 2) && this.usable(1) > 0; }
  /** Takes up to `kg` from the selected tank(s); returns what it got. */
  draw(kg) {
    const s = this.selector;
    const from = s === 1 ? [0] : s === 3 ? [1] : s === 2 ? [0, 1].filter((i) => this.usable(i) > 0) : [];
    let got = 0;
    for (const i of from) { const d = Math.min(kg / from.length, this.usable(i)); this.tank[i] -= d; got += d; }
    return got;
  }
  /** On BOTH the tanks are joined: fuel runs toward the lower wing (`tilt` = sideways acceleration felt, in g, + to the right). */
  step(dt, tilt) {
    if (this.selector !== 2) return;
    const flow = clamp(0.012 * (this.tank[0] - this.tank[1]) / this.capacity + 0.02 * tilt, -0.03, 0.03) * dt;   // + is left to right
    const f = flow > 0 ? Math.min(flow, this.usable(0), this.capacity - this.tank[1]) : -Math.min(-flow, this.usable(1), this.capacity - this.tank[0]);
    this.tank[0] -= f; this.tank[1] += f;
  }
}

export class Powerplant {
  constructor(prop, fuel, o = {}) {
    this.prop = prop; this.fuel = fuel;
    this.rand = rng(o.seed ?? 11);
    // what the pilot's hands set
    this.throttle = 0; this.mixture = 0; this.carbHeat = 0;
    this.magL = false; this.magR = false; this.starter = false;
    // state
    this.omega = 0;                          // rad/s
    this.map = 101325;                       // manifold pressure, Pa
    this.cht = 15; this.oilT = 15; this.egt = 15;       // deg C
    this.oilP = 0;                           // psi
    this.film = 0;                           // kg of liquid fuel lying in the induction system
    this.bowl = 0.055;                       // kg in the carburettor's float bowl
    this.ice = 0;                            // 0..1 of the venturi blocked
    this.carbT = 15;
    this.foul = [0, 0];                      // lead on the plugs of the left / right magneto
    this.phi = 0; this.fuelFlow = 0; this.airFlow = 0; this.torque = 0; this.power = 0; this.rough = 0;
    this.starterAmps = 0; this.suction = 0; this.firing = false; this.damaged = false;
    this.tach = o.tach ?? 2473.6; this.hobbs = o.hobbs ?? 3127.4;
    this._thr = 0; this._miss = 0; this.reaction = 0; this.heatRise = 0;
  }
  get rpm() { return this.omega / RPM; }
  get hp() { return this.power / 745.7; }
  get mapInHg() { return this.map / 3386.389; }
  get gph() { return this.fuelFlow / AVGAS / GAL * 3600; }
  setTemps(tC) { this.cht = this.oilT = this.egt = this.carbT = tC; }

  /** One stroke of the primer: raw fuel sprayed into the intake ports. `amount` 0..1 of a full stroke. */
  prime(amount = 1) { if (this.fuel.feeding) { const kg = 0.0007 * amount; this.film += this.fuel.draw(kg); } }

  /**
   * @param {number} dt
   * @param {object} air     { p, T, rho, rh, tC } of the outside air
   * @param {number} volts   what the starter would get
   * @param {number} coolV   speed of the cooling air through the cowl, m/s
   */
  step(dt, air, volts, coolV) {
    const om = this.omega, rpm = om / RPM, rps = Math.abs(om) / (2 * Math.PI);
    // ---- induction air: outside air, or air heated round the exhaust when carburettor heat is pulled
    const heat = this.heatRise = this.carbHeat * clamp(0.075 * (this.egt - air.tC), 0, 60);
    const Tin = air.T + heat, pin = air.p, rhoIn = pin / (R_AIR * Tin);
    const aFrac = (0.028 + 0.972 * Math.pow(this.throttle, 1.7)) * (1 - 0.85 * this.ice);
    const etaV = 0.70 + 0.16 * sat(rpm / 1200) - 0.05 * Math.max(0, (rpm - 2300) / 1000) ** 2;
    const kCyl = etaV / (R_AIR * Tin) * VD * rps / 2, kThr = THROAT * aFrac * pin / Math.sqrt(R_AIR * Tin);
    let lo = 1500, hi = pin;
    if (kCyl > 1e-9) for (let i = 0; i < 16; i++) { const pm = 0.5 * (lo + hi); if (kThr * psi(pm / pin) > kCyl * pm) lo = pm; else hi = pm; }
    else lo = hi = pin;
    const pm = this.map += (0.5 * (lo + hi) - this.map) * lag(dt, 0.04);
    const mair = this.airFlow = kCyl * pm;                      // kg/s into the cylinders
    const load = pm / 100000;

    // ---- the carburettor
    this.bowl = Math.min(0.055, this.bowl + (this.fuel.feeding ? this.fuel.draw(Math.min(0.055 - this.bowl, 0.03 * dt)) : 0));
    const wet = sat(this.bowl / 0.008);
    const mix = this.mixture < 0.04 ? 0 : 0.30 + 0.70 * Math.pow((this.mixture - 0.04) / 0.96, 0.85);
    const faBase = table([0, 0.12, 0.3, 0.8, 1], [0.090, 0.082, 0.074, 0.075, 0.088], this.throttle);
    // fuel is drawn by venturi suction (main jet) and by manifold vacuum (idle jet): at cranking speed there is little of either
    const draw = Math.min(1, sat((pin - pm) / 8000) + sat(mair / 0.02) ** 2);
    const mfCarb = mair * faBase * Math.sqrt(1.225 / rhoIn) * mix * (1 + 0.35 * this.ice) * wet * draw;
    const dThr = this.throttle - this._thr; this._thr = this.throttle;
    const squirt = dThr > 0 ? 0.0006 * dThr * wet : 0;          // the accelerator pump
    this.bowl = Math.max(0, this.bowl - mfCarb * dt - squirt);
    // what vaporises at once, what lies on the manifold walls, what evaporates off them
    const fv = sat(0.12 + 0.016 * this.cht);
    const tau = mair > 5e-4 ? clamp(11 - 0.18 * this.cht, 0.5, 20) / (1 + 150 * mair) : 150;
    const evap = this.film / tau;
    this.film = Math.max(0, this.film + ((1 - fv) * mfCarb - evap) * dt + squirt);
    const phi = this.phi = mair > 5e-5 ? (fv * mfCarb + (mair > 5e-4 ? evap : 0)) / (mair * FA_ST) : 0;
    this.fuelFlow += (mfCarb + squirt / dt - this.fuelFlow) * lag(dt, 0.5);

    // ---- ignition and combustion
    const both = this.magL && this.magR, any = this.magL || this.magR;
    let pf = any && rpm > 60 && !this.damaged ? table(PHI, PF, phi) : 0;
    let magF = 1, magRough = 0;
    if (any && !both) { const f = this.foul[this.magL ? 0 : 1]; magF = (0.89 + 0.06 * load) * (1 - 0.3 * f); magRough = f; }
    else if (both) magF = 1 - 0.02 * (this.foul[0] + this.foul[1]);
    // near the limits some cycles do not fire
    const miss = pf > 0 ? sat((0.6 - pf) / 0.6) + magRough * 0.5 + (this.ice > 0.05 && this.carbT > 1 ? 0.25 : 0) : 0;
    if (miss > 0 && this.rand() < 0.25) this._miss = this.rand() < miss ? 0.35 : 1;
    else if (miss === 0) this._miss = 1;
    // slow engines lose heat to the walls; at low manifold pressure the charge is diluted by leftover exhaust
    const etaI = ETA_I * (1 - 0.22 * Math.exp(-Math.abs(rpm) / 350)) * (1 - 0.45 * sat((50000 - pm) / 40000));
    const mCycle = etaV * pm / (R_AIR * Tin) * VD;
    const qInd = mCycle * FA_ST * LHV * etaI * pf * magF * this._miss / (4 * Math.PI);
    this.firing = qInd > 1;
    this.rough += (miss - this.rough) * lag(dt, 0.3);

    // ---- friction, pumping, the starter, the propeller: the shaft
    const visc = Math.exp((60 - this.oilT) / 45);
    const kr = Math.abs(rpm) / 1000;
    const qFric = ((60e3 + 14e3 * kr + 5e3 * kr * kr) * (1 + 1.4 * sat((40 - this.oilT) / 55)) + (pin - pm)) * VD / (4 * Math.PI);
    let qStart = 0; this.starterAmps = 0;
    if (this.starter && volts > 8 && rpm < 450 && !this.damaged) {
      const slip = Math.max(0, 1 - om / 24), v = volts / 24;
      qStart = 150 * v * v * slip; this.starterAmps = (220 * slip + 30) * v;
    }
    const qProp = this.prop.torque;
    const drive = qInd + qStart - qProp;
    let nom = om;
    if (om === 0 && Math.abs(drive) < 18) nom = 0;                                  // held by compression and stiction
    else {
      const dir = om !== 0 ? Math.sign(om) : Math.sign(drive);
      nom = om + (drive - dir * qFric) / this.prop.inertia * dt;
      if (om !== 0 && Math.sign(nom) !== Math.sign(om) && Math.abs(drive) < qFric + 18) nom = 0;
      if (this.damaged) nom = 0;
    }
    this.omega = nom;
    // the torque the engine puts on the shaft is the torque the airframe feels the other way
    this.reaction = qInd + qStart - (om !== 0 ? Math.sign(om) * qFric : Math.min(qFric, Math.abs(drive)) * Math.sign(drive));
    this.torque = qInd - qFric; this.power = this.torque * om;

    // ---- heat
    const pInd = qInd * Math.abs(om), pFric = qFric * Math.abs(om), cool = air.rho * Math.max(coolV, 0);
    this.cht += (0.12 * pInd * table(HEAT_PHI, HEAT_F, phi) + 0.25 * pFric - (8 + 1.28 * cool) * (this.cht - air.tC)) / 30000 * dt;
    this.oilT += (0.25 * pFric + 10 * (this.cht - this.oilT) - (5 + 0.9 * cool) * (this.oilT - air.tC)) / 12000 * dt;
    const egtT = this.firing ? air.tC + table(EGT_PHI, EGT_C, phi) * (0.62 + 0.38 * load) + (any && !both ? 25 : 0) : this.cht;
    this.egt += (egtT - this.egt) * lag(dt, this.firing ? 2 : 9);
    const oilTarget = Math.abs(rpm) > 20 ? Math.min(0.081 * Math.abs(rpm) * visc, 55 + 30 * Math.min(visc, 1.5)) : 0;
    this.oilP += (oilTarget - this.oilP) * lag(dt, 0.7);
    this.suction += (Math.min(5.05, 5 * Math.abs(rpm) / 1500) - this.suction) * lag(dt, 0.4);

    // ---- carburettor ice: the venturi and the evaporating fuel chill the air well below outside temperature
    const drop = (1 - Math.pow(pm / pin, 0.2857)) * Tin * 0.2 + 10 * sat(mfCarb / (mair * 0.07 + 1e-9));
    this.carbT = Tin - 273.15 - (mair > 1e-3 ? drop : 0);
    if (mair > 2e-3 && this.carbT < 0.5 && this.carbT > -25 && air.rh > 0.45) {
      const water = Math.min(1.5, air.rh * esat(air.tC) / esat(15));
      this.ice = Math.min(1, this.ice + dt * ((air.rh - 0.45) / 0.55) * water * Math.max(0.25, 1 - Math.abs(this.carbT + 6) / 22) / 150);
    } else if (this.carbT > 1) this.ice = Math.max(0, this.ice - dt * this.carbT / 400);

    // ---- the plugs foul when it idles rich and cool, and burn clean when worked lean and hot
    for (let i = 0; i < 2; i++) {
      if (this.firing && phi > 1.3 && this.cht < 110 && rpm < 1100) this.foul[i] = Math.min(1, this.foul[i] + dt / (i ? 700 : 900));
      else if (this.firing && this.cht > 150 && phi < 1.25) this.foul[i] = Math.max(0, this.foul[i] - dt / 50);
    }
    if (this.oilP > 5) this.hobbs += dt / 3600;
    this.tach += dt / 3600 * Math.abs(rpm) / 2566;
  }
}
export { DEG };
