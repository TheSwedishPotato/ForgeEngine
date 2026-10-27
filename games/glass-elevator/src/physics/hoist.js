/**
 * The hoisting system, stepped at 1 kHz: the car, the counterweight, the hoist ropes over the
 * traction sheave, the machine's rotor and its two brakes, the compensating ropes round their
 * tied-down tension sheave in the pit, the overspeed governor, the safety gear and the oil buffers.
 *
 *  - The car and the counterweight hang on the hoist ropes, which are springs: EA / L for the
 *    length hanging on each side, so the car sits 4 cm lower at the lobby with full load than
 *    empty (the long ropes stretch), and bounces at about 1.6 Hz down there, 11 Hz at the top.
 *  - The ropes are a body of their own (the steel on the sheave and a share of what hangs from
 *    it, moving along their length), held to the sheave by friction only. Each step the friction the sheave must give them is compared with
 *    what an undercut U-groove can give (Euler-Eytelwein, T1 / T2 <= e^(f alpha)); beyond it
 *    the ropes slide in the grooves, as they must when the counterweight lands on its buffer.
 *  - The ropes' own weight (4.7 kg a metre) hangs on whichever side is longer, and the
 *    compensating ropes under the car and the counterweight hang the same weight the other way.
 *  - The machine: rotor and sheave inertia, the motor's torque (from the drive, through the
 *    current loop's lag) and two independent brake sets clamping the sheave. Friction (brakes,
 *    guides, safety gear) is applied implicitly, so a holding brake holds dead still.
 *  - The governor's rope is driven by the car. Over 4.40 m/s its switch opens the safety chain;
 *    at 4.80 m/s its jaws grip the rope, which then lifts the safety gear's linkage on the
 *    descending car, and the wedges bite the rails (progressive gear, about 0.5 gn).
 *  - Oil buffers: a metering pin closes the orifice along the stroke so that the design mass
 *    striking at 115 % of rated speed stops at a uniform 1 gn in 1.08 m (of the 1.10 m stroke).
 */
import { SPEC, G, CAR, ROPE, BUFFER, SHEAVE, tractionLimit, cwYForCar, floorY, PIT_Y } from '../data/spec.js';

const R = SHEAVE.r;
const MS = SPEC.machine.J / (R * R);            // the rotor's inertia, as a mass on the rope (312 kg)
export const MU_STICK = 0.16, MU_SLIDE = 0.12;   // rope on cast iron, lubricated (EN 81-50's design values are 0.1 / 0.2)
const ARC = R * (SPEC.traction.wrapDeg * Math.PI / 180) + 0.26 * Math.PI / 2;
const TS_Y0 = PIT_Y + 0.95;                      // the tension sheave's centre at rest

/** Velocity after a step against Coulomb friction F (N) on mass m, applied implicitly. */
function friction(vFree, F, m, dt) {
  const dv = (F * dt) / m;
  if (Math.abs(vFree) <= dv) return 0;
  return vFree - Math.sign(vFree) * dv;
}

export class Hoist {
  constructor({ floor = 1, load = 0 } = {}) {
    this.P = SPEC.carMass;
    this.load = load;              // rigid load (kg) in the car, besides what the props press on its floor
    this.propForce = 0;            // vertical force (N, + up) the loose things and you put on the car
    this.cw = SPEC.cwMass;
    this.lam = SPEC.ropes.kgPerM;
    this.lamC = SPEC.comp.kgPerM;
    this.ropesCut = false;
    // car, counterweight, ropes, sheave, tension sheave
    this.yc = floorY(floor); this.vc = 0; this.ac = 0;
    this.yw = cwYForCar(this.yc); this.vw = 0;
    this.u = 0; this.vu = 0;
    this.th = 0; this.vs = 0;
    this.stick = true;
    this.ts = TS_Y0; this.vts = 0;
    this.motor = { cmd: 0, torque: 0, enabled: false };
    this.brakes = Array.from({ length: SPEC.brakes.n }, () => ({ cmd: false, lift: 0, fail: false }));
    this.manualRelease = 0;        // the machine room's hand release lever (0 .. 1)
    this.gov = { speed: 0, tripped: false, testTrip: false, switchOpen: false, link: 0, th: 0 };
    this.sg = { engage: 0, set: false };
    this.buf = { car: 0, cw: 0 };
    this.tieDown = { engaged: false };
    this.t = 0;
    this.events = [];
    this._settle();
  }

  /** Sets the rope rest lengths so that the system hangs in equilibrium where it stands. */
  _settle() {
    const Lc = ROPE.carTop - (this.yc + CAR.crosshead), Lw = ROPE.cwTop - (this.yw + ROPE.cwHitch);
    const Lcc = this.yc + CAR.compHitch - this.ts, Lwc = this.yw - this.ts;
    // comp loop: the tension sheave hangs on it: each side carries half its weight
    const Tb = (SPEC.comp.sheaveMass * G) / 2;
    const LtGeo = Lcc + Lwc + Math.PI * SPEC.comp.sheaveR;
    this.Lt0 = LtGeo - Tb / (SPEC.comp.EA / LtGeo);
    const Tc = (this.P + this.load) * G + Tb + this.lamC * G * Lcc - this.propForce;
    const Tw = this.cw * G + Tb + this.lamC * G * Lwc;
    this.Lc0 = Lc / (1 + Tc / SPEC.ropes.EA);          // e = T L / EA on the rest length
    this.Lw0 = Lw / (1 + Tw / SPEC.ropes.EA);
    this.u = 0;
    Object.assign(this, { Lcc, Lwc, Tb, Tc, Tw, loadCell: Tc, ec: Lc - this.Lc0, ew: Lw - this.Lw0, tractionUse: 0, tractionRatio: 1, brakeTorque: 0, slip: 0 });
  }

  get Lc() { return this.Lc0 - this.u; }
  get Lw() { return this.Lw0 + this.u; }
  /** The encoder's view of the car: rope paid over the sheave (m). */
  get enc() { return this.th * R; }

  step(dt) {
    this.t += dt;
    const S = SPEC, lam = this.lam, lamC = this.lamC, EA = S.ropes.EA, damp = S.ropes.damping;
    // ---- hoist ropes ------------------------------------------------------------------------
    const LcRest = Math.max(0.3, this.Lc), LwRest = Math.max(0.3, this.Lw);
    const ec = ROPE.carTop - (this.yc + CAR.crosshead) - LcRest;
    const ew = ROPE.cwTop - (this.yw + ROPE.cwHitch) - LwRest;
    const kc = EA / LcRest, kw = EA / LwRest;
    let Tc = 0, Tw = 0;
    if (!this.ropesCut) {
      if (ec > 0) Tc = Math.max(0, kc * (ec + damp * (-this.vc + this.vu)));
      if (ew > 0) Tw = Math.max(0, kw * (ew + damp * (-this.vw - this.vu)));
    }
    this.Tc = Tc; this.Tw = Tw; this.ec = ec; this.ew = ew;
    const Wc = lam * G * LcRest, Ww = lam * G * LwRest;
    const TcTop = Tc + Wc, TwTop = Tw + Ww;
    // ---- compensating ropes and their tension sheave ------------------------------------------
    const Lcc = Math.max(0, this.yc + CAR.compHitch - this.ts), Lwc = Math.max(0, this.yw - this.ts);
    const Lt = Lcc + Lwc + Math.PI * S.comp.sheaveR;
    const et = Lt - this.Lt0, kt = S.comp.EA / this.Lt0;
    const Tb = et > 0 ? Math.max(0, kt * (et + 0.02 * (this.vc + this.vw - 2 * this.vts))) : 0;
    this.Tb = Tb;
    const Fcc = Tb + lamC * G * Lcc, Fwc = Tb + lamC * G * Lwc;
    // ---- buffers ----------------------------------------------------------------------------
    const Fbc = this._buffer('car', BUFFER.carTop - (this.yc + CAR.striker), -this.vc, this.P + S.ratedLoad, dt);
    const Fbw = this._buffer('cw', BUFFER.cwTop - this.yw, -this.vw, this.cw, dt);
    // ---- the car ----------------------------------------------------------------------------
    // the hanging ropes' inertia: most of each side's moves with what hangs on it, the rest with the sheave
    const mc = this.P + this.load + lamC * Lcc + 0.75 * lam * LcRest;
    const Fc = Tc - (this.P + this.load) * G - Fcc + this.propForce + Fbc;
    let vc = this.vc + (Fc / mc) * dt;
    vc = friction(vc, 180 + 25 * Math.abs(vc), mc, dt);                      // roller guides
    // the safety gear holds against descent only
    this._governor(dt);
    const Fsg = S.safetyGear.force * this.sg.engage;
    if (Fsg > 0 && vc < 0) vc = Math.min(0, vc + (Fsg * dt) / mc);
    if (this.sg.engage > 0 && vc > 0.02) { this.sg.engage = Math.max(0, this.sg.engage - dt * 4); if (this.sg.engage === 0 && this.sg.set) { this.sg.set = false; this.events.push('Safety gear released: the wedges have come off the rails.'); } }
    this.ac = (vc - this.vc) / dt;
    this.vc = vc;
    // ---- the counterweight ------------------------------------------------------------------
    const mw = this.cw + lamC * Lwc + 0.75 * lam * LwRest;
    const Fw = Tw - this.cw * G - Fwc + Fbw;
    this.vw = friction(this.vw + (Fw / mw) * dt, 250, mw, dt);
    // ---- the tension sheave (guided, with its tie-down holding it from jumping) ----------------
    const Mts = S.comp.sheaveMass;
    let vts = this.vts + ((2 * Tb - Mts * G) / Mts) * dt;
    if (this.ts < TS_Y0 - 0.25 && vts < 0) vts = 0;                          // its lower stop
    const held = S.comp.tieDown && vts > 0.04;
    if (held) { vts = 0.04; if (!this.tieDown.engaged && this.t - (this.tieDown.said ?? -99) > 30 && Math.abs(this.vc) > 1) { this.tieDown.said = this.t; this.events.push('Compensation tie-down engaged: the tension sheave is held against rebound.'); } }
    this.tieDown.engaged = held;
    this.vts = vts;
    // ---- motor ------------------------------------------------------------------------------
    const M = this.motor, mx = S.machine.maxTorque;
    const want = M.enabled ? Math.max(-mx, Math.min(mx, M.cmd)) : 0;
    M.torque += (want - M.torque) * Math.min(1, dt / (M.enabled ? S.machine.torqueLag : 0.002));
    // ---- brakes -----------------------------------------------------------------------------
    let Tbrake = 0;
    for (const b of this.brakes) {
      b.lift += (b.cmd ? dt / S.brakes.lift : -dt / S.brakes.drop);
      b.lift = Math.max(0, Math.min(1, b.lift));
      const clamp = 1 - b.lift;
      Tbrake += S.brakes.torque * clamp * (b.fail ? 0.08 : 1);
    }
    Tbrake *= 1 - this.manualRelease;
    this.brakeTorque = Tbrake;
    // ---- sheave and ropes: traction --------------------------------------------------------
    const Fm = M.torque / R, Fr = TwTop - TcTop;               // + moves the ropes toward the counterweight (car up)
    const Fbk = Tbrake / R + 40 / R;                           // brakes and bearings
    const mu = this.ropesCut ? 0 : lam * (0.25 * (LcRest + LwRest) + ARC);
    const Tlow = Math.max(0, Math.min(TcTop, TwTop));
    this.tractionRatio = Tlow > 1 ? Math.max(TcTop, TwTop) / Tlow : Infinity;
    if (this.ropesCut) {
      this.vs = friction(this.vs + (Fm / MS) * dt, Fbk, MS, dt);
      this.vu = 0;
    } else if (this.stick) {
      const m = MS + mu;
      const v0 = this.vs;
      const v = friction(v0 + ((Fm + Fr) / m) * dt, Fbk, m, dt);
      const need = (mu * (v - v0)) / dt - Fr;                // the friction the grooves must give the ropes
      const cap = Tlow * (tractionLimit(MU_STICK) - 1);
      this.tractionUse = cap > 0 ? Math.abs(need) / cap : Infinity;
      if (Math.abs(need) <= cap) { this.vs = v; this.vu = v; } else { this.stick = false; this._slip(Fm, Fr, Fbk, mu, Tlow, dt, Math.sign(need)); }
    } else {
      this._slip(Fm, Fr, Fbk, mu, Tlow, dt, Math.sign(this.vs - this.vu) || Math.sign(-Fr) || 1);
    }
    // ---- positions --------------------------------------------------------------------------
    this.yc += this.vc * dt;
    this.yw += this.vw * dt;
    this.u += this.vu * dt;
    this.th += (this.vs / R) * dt;
    this.ts += this.vts * dt;
    this.slip = this.u - this.th * R;
    this.Lcc = Lcc; this.Lwc = Lwc;
    this.loadCell = Tc;                                         // the hitch load cells read the rope tension
  }

  _slip(Fm, Fr, Fbk, mu, Tlow, dt, dir) {
    const cap = Tlow * (tractionLimit(MU_SLIDE) - 1);
    this.tractionUse = Infinity;
    const vu = this.vu + ((Fr + dir * cap) / mu) * dt;
    const vs = friction(this.vs + ((Fm - dir * cap) / MS) * dt, Fbk, MS, dt);
    if (Math.sign(vs - vu) !== dir || Math.abs(vs - vu) < 1e-6) {
      const v = (mu * vu + MS * vs) / (mu + MS);
      this.vu = v; this.vs = v; this.stick = true;
    } else { this.vu = vu; this.vs = vs; if (!this._slipping) this.events.push('The ropes are slipping in the sheave grooves: traction lost.'); }
    this._slipping = !this.stick;
  }

  /** An oil buffer: x the striker's travel into it (m), v its speed into it, M its design mass. */
  _buffer(k, x, v, M, dt) {
    const B = SPEC.buffers, b = this.buf;
    let p = b[k];
    if (x > p - 1e-5 && x > 0) {
      // the striker drives the plunger: force from the metering pin's orifice, the return spring, the solid stop
      p = x;
      const vd2 = Math.max(B.designSpeed * B.designSpeed - 2 * B.decel * Math.min(x, B.stroke), 0.09);
      const c = (M * (G + B.decel)) / vd2;
      let F = (v > 0 ? c * v * v : 0) + 2500 + 4000 * x;
      if (x > B.stroke) F += 6e7 * (x - B.stroke);
      b[k] = p;
      b[k + 'Max'] = Math.max(b[k + 'Max'] ?? 0, x);
      if (!b[k + 'Hit'] && v > 0.05) { b[k + 'Hit'] = true; this.events.push(`The ${k === 'car' ? 'car' : 'counterweight'} struck its buffer at ${v.toFixed(2)} m/s.`); }
      return F;
    }
    // free: the plunger's spring pushes it back out
    b[k] = Math.max(0, p - 0.12 * dt);
    if (b[k] === 0) b[k + 'Hit'] = false;
    return 0;
  }

  _governor(dt) {
    const g = this.gov, S = SPEC.governor;
    const v = this.vc;
    g.speed = g.tripped ? 0 : Math.abs(v);
    if (!g.tripped) g.th += (v / 0.15) * dt;
    if (Math.abs(v) >= S.overspeedSwitch && !g.switchOpen) { g.switchOpen = true; this.events.push(`Governor overspeed switch opened at ${Math.abs(v).toFixed(2)} m/s.`); }
    if (!g.tripped && (Math.abs(v) >= S.trip || (g.testTrip && Math.abs(v) > 0.05))) {
      g.tripped = true; g.switchOpen = true;
      this.events.push(g.testTrip ? `Governor tripped by its remote test magnet at ${Math.abs(v).toFixed(2)} m/s.` : `Governor tripped at ${Math.abs(v).toFixed(2)} m/s: the jaws grip the governor rope.`);
    }
    // a gripped rope stands still: the descending car lifts the safety gear's linkage against it
    if (g.tripped) g.link = Math.max(0, g.link - v * dt);
    if (g.tripped && g.link >= S.linkTravel && !this.sg.set) {
      this.sg.set = true; this._sgFrom = this.yc; this._sgV = v;
      this.events.push(`Safety gear set at ${(-v).toFixed(2)} m/s: the wedges bite the rails.`);
    }
    if (this.sg.set && this.sg.engage < 1 && !(v > 0.02)) this.sg.engage = Math.min(1, this.sg.engage + dt / SPEC.safetyGear.engageTime);
    if (this.sg.set && this._sgFrom !== undefined && Math.abs(v) < 0.005 && this.sg.engage >= 1) {
      const d = this._sgFrom - this.yc, a = (this._sgV * this._sgV) / (2 * Math.max(d, 1e-3));
      this.events.push(`The car stopped on its safety gear in ${d.toFixed(2)} m (average ${(a / G).toFixed(2)} gn).`);
      this._sgFrom = undefined;
    }
  }

  /** Resets the governor (its remote reset solenoid): only with the car at rest. */
  resetGovernor() {
    const g = this.gov;
    if (Math.abs(this.vc) > 0.01) return false;
    g.tripped = false; g.testTrip = false; g.switchOpen = false; g.link = 0;
    return true;
  }

  /** What the drive's load weighing should read (kg in the car), from the hitch load cells. */
  measuredLoad() {
    return (this.loadCell - this.Tb - this.lamC * G * this.Lcc) / G - this.P;
  }

  /** Static equilibrium helpers for the tests and the HUD. */
  get stretch() { return this.ec; }
  get ropeSafety() { return (SPEC.ropes.mbf * SPEC.ropes.n) / Math.max(1, Math.max(this.Tc + this.lam * G * this.Lc, this.Tw + this.lam * G * this.Lw)); }
}

export { R as SHEAVE_R, TS_Y0 };
