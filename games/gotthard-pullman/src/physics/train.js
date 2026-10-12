/**
 * The train as a chain of masses on the track (Newton's second law for each),
 * joined by screw couplings and side buffers (Hooke's-law springs with damping),
 * driven by the engine's coupled wheels through the adhesion at the rail.
 *
 * Forces on each vehicle, along the track:
 *   weight:      - m g sin(grade)
 *   rolling:     Davis (1926): R[lb] = 1.3 W + 29 n + b W V   (W short tons, n axles, V mph),
 *                more in hard frost (stiff journal grease)
 *   curving:     Röckl: 650/(R-55) N/kN above 350 m, 500/(R-30) below
 *   air:         Davis's C A V² term (C = 0.0024 for the engine in front, 0.00034 for trailing
 *                passenger cars), scaled by the real air density, with the wind and, in a
 *                tunnel, the piston effect of the bore
 *   snow:        the engine's pilot ploughing fresh snow on the rails
 *   brakes:      block friction (brakes.js), limited by adhesion (wheels slide beyond it)
 *   couplings:   tension through the draw gear, compression through the buffers
 *   traction:    the engine's wheels against the rail (locomotive.js)
 * Momentum is conserved through the couplings: what the engine pushes into the
 * train arrives at the observation car's platform a little later, as a jerk.
 */
import { SteamLocomotive } from './locomotive.js';
import { AirBrake } from './brakes.js';
import { muMax, RAIL } from './adhesion.js';

const G = 9.80665;
const LB = 4.44822, ST = 907.185;

// couplings (per vehicle pair): two side buffers (UIC, 105 mm stroke) and the draw gear
const K_DRAW = 1.6e6, C_DRAW = 6e4;
const K_BUF1 = 2.4e6, K_BUF3 = 6.5e8, C_BUF = 1.2e5;
const PRELOAD = 0.004;          // the screw coupling is tightened until the buffers just bear

export class Train {
  /**
   * route: Route; consist: vehicle specs (engine first); opts: { sFront: chainage of the engine's front, weather }
   */
  constructor(route, consist, { sFront, weather, locoOpts = {} } = {}) {
    this.route = route;
    this.events = [];
    this.weather = weather;
    this.loco = new SteamLocomotive(undefined, locoOpts);
    this.veh = [];
    let s = sFront;
    for (const spec of consist) {
      const v = { ...spec, s: s - spec.length / 2, v: 0, a: 0, F: 0, coupler: 0, mEff: spec.mass * (spec.kind === 'engine' ? 1.0 : 1.04) };
      this.veh.push(v);
      s -= spec.length;
    }
    this.brake = new AirBrake(this.veh.map((v) => ({ name: v.name, length: v.length, brakeForce: v.brakeForce, blocks: v.blocks, direct: !!v.direct, heatCapacity: v.heatCapacity, pipeVolume: 0.08 + v.length * 0.004 })));
    this.time = 0;
    this.odometer = 0;
    this.sand = 0;               // sand reaching the rail ahead of the drivers (0..1)
    this.cleaning = 0;
    this.couplerForce = new Float64Array(this.veh.length - 1);
    this.snowLoad = 0;
    this.passengers = new Float64Array(this.veh.length);   // kg of people aboard each vehicle
    this.coachTemp = this.veh.map(() => 12);               // interior °C
    this.coupled = new Array(this.veh.length - 1).fill(true);
    this.helperPower = 0;                                   // banking engine's tractive demand 0..1 (its driver, by radio)
    this.helperTarget = 0;                                  // speed its driver holds when approaching to couple, m/s
  }

  /** A vehicle arrives behind the train (not coupled yet): the banking engine. */
  addBehind(spec, gap, v) {
    const last = this.veh[this.veh.length - 1];
    const h = { ...spec, s: last.s - last.length / 2 - gap - spec.length / 2, v, a: 0, F: 0, coupler: 0, mEff: spec.mass * 1.0 };
    this.veh.push(h);
    this.coupled.push(false);
    this.couplerForce = Float64Array.from([...this.couplerForce, 0]);
    this.passengers = Float64Array.from([...this.passengers, 0]);
    this.coachTemp.push(10);
    this.brake.v.push({ name: h.name, length: h.length, brakeForce: h.brakeForce, blocks: h.blocks, direct: true, heatCapacity: h.heatCapacity, pipeVolume: 0.15, pBP: 5.0, pBC: 0, pBCdirect: 0, tBlock: this.brake.v[0].tBlock, heat: 0, own: true });
    return h;
  }

  get helper() { return this.veh.find((v) => v.kind === 'helper') ?? null; }

  get engine() { return this.veh[0]; }
  get speed() { return this.veh[0].v; }
  get front() { return this.veh[0].s + this.veh[0].length / 2; }
  get rear() { const l = this.veh[this.veh.length - 1]; return l.s - l.length / 2; }
  get length() { return this.veh.reduce((a, v) => a + v.length, 0); }
  get mass() { return this.veh.reduce((a, v) => a + this._mass(v, this.veh.indexOf(v)), 0); }

  _mass(v, i) {
    if (v.kind === 'engine') return this.loco.engineMass;
    if (v.kind === 'tender') return this.loco.tenderMass;
    return v.mass + this.passengers[i];
  }

  step(dt) {
    const R = this.route.run, L = this.loco, W = this.weather;
    this.time += dt;
    const n = this.veh.length;
    // ---- conditions at the engine
    const e = this.veh[0];
    const here = W.at(e.s, this.time);
    const grade = R.gradeAt(e.s);
    // sand: steam sanders blow sand under the leading drivers; it takes a moment to arrive and to clear
    this.sand += ((L.c.sander && L.sand > 0 ? 1 : 0) - this.sand) * Math.min(1, dt * (L.c.sander ? 3 : 0.8));
    if (L.c.sander && L.sand > 0) L.sand = Math.max(0, L.sand - 0.06 * dt);   // ~3.6 kg a minute through the sand pipes (estimate)
    const mu = muMax(e.v, RAIL[here.rail], this.sand, here.cleaned ?? 0);
    // steam heating: what the cars lose through their walls at this temperature (~2.2 kW/K for a heavyweight car)
    let heatDemand = 0;
    for (let i = 2; i < n; i++) heatDemand += Math.max(0, (21 - here.tempC) * 2.2e3) / 2.1e6;   // kg/s of steam (h_fg ~ 2.1 MJ/kg at 3 bar)
    // ---- the engine's machinery and wheels
    const brakeOnDrivers = this._driverBrakeTorque(e, mu);
    const lo = L.step(dt, {
      v: e.v, grade, accel: e.a, normalDrivers: L.spec.adhesiveMass * G * Math.cos(Math.atan(grade)), mu,
      ambientC: here.tempC, windSpeed: here.wind, inTunnel: here.tunnel, heatDemand, airDemand: this.brake.airDemand,
      brakeTorque: brakeOnDrivers,
    });
    // ---- the air brake
    this.brake.step(dt, L.pMR, here.tempC);
    // ---- forces on each vehicle
    const rho = here.rho;
    for (let i = 0; i < n; i++) {
      const v = this.veh[i];
      const m = this._mass(v, i);
      const g = R.gradeAt(v.s);
      const cond = i === 0 ? here : W.at(v.s, this.time);
      const Fg = -m * G * Math.sin(Math.atan(g));
      // Davis rolling resistance (+ frost), opposing motion
      const Wst = m / ST, mph = Math.abs(v.v) * 2.23694;
      const frost = 1 + 0.012 * Math.max(0, -cond.tempC);
      let Froll = LB * (1.3 * Wst + 29 * v.axles + 0.03 * Wst * mph) * frost;
      // curve resistance (Röckl), the engine's long rigid wheelbase working harder
      const k = Math.abs(R.curvatureAt(v.s));
      if (k > 1e-4) {
        const Rad = 1 / k;
        const rc = Rad > 350 ? 650 / Math.max(10, Rad - 55) : 500 / Math.max(10, Rad - 30);
        Froll += (rc / 1000) * m * G * (v.kind === 'engine' ? 1.35 : 1);
      }
      // air: relative wind along the track
      const head = R.headingAt(v.s);
      const windAlong = cond.windFrom != null ? -cond.wind * Math.cos(cond.windFrom - head) : 0;   // + = headwind component
      const vr = v.v + windAlong;
      const C = i === 0 ? v.davisC : (v.kind === 'tender' ? 0.0005 : 0.00034);
      const Aft = (v.frontalArea || 9) * 10.7639;
      const tunnelFactor = cond.tunnel ? 1.9 : 1;
      let Faero = -Math.sign(vr) * C * Aft * (vr * 2.23694) ** 2 * LB * (rho / 1.225) * tunnelFactor;
      // crosswind adds drag (yawed flow over the whole train side)
      const cross = cond.windFrom != null ? cond.wind * Math.sin(cond.windFrom - head) : 0;
      Faero -= Math.sign(v.v) * 0.04 * rho * v.length * 3 * Math.abs(cross) * Math.abs(v.v);
      // snow: only the first vehicle ploughs (the depth lying on the rails)
      const Fsnow = i === 0 ? (cond.snowOnRail ?? 0) * 100 * 1000 * (1 + Math.abs(v.v) / 8) : 0;   // ~1 kN per cm, rising with speed
      // brakes (friction)
      const normal = m * G;
      const muRail = muMax(v.v, RAIL[cond.rail], i === 0 ? this.sand : 0, i > 1 ? 0.5 : 0);
      const fb = this.brake.force(i, v.v, dt, normal, muRail, cond.tempC);
      let Fbrake = fb.F;
      if (i === 0) Fbrake = 0;      // the engine's own brake acts on its wheels (in the loco model)
      // the banking engine: an electric's tractive effort, limited by power, adhesion (with its own slip control) and its driver
      v.Ftrac = 0;
      if (v.kind === 'helper') {
        const muH = muMax(v.v, RAIL[cond.rail], 1, 0.5) * 0.95;
        const Fmax = Math.min(v.maxTE, v.power / Math.max(1, Math.abs(v.v)), muH * normal);
        v.Ftrac = Fmax * this.helperPower;
      }
      v.Fg = Fg; v.Froll = Froll; v.Faero = Faero; v.Fbrake = Fbrake; v.Fsnow = Fsnow; v.mNow = m;
    }
    // couplings
    for (let i = 0; i < n - 1; i++) {
      const a = this.veh[i], b = this.veh[i + 1];
      const gap = (a.s - b.s) - (a.length + b.length) / 2;     // + = drawn apart
      const rel = a.v - b.v;
      let F = 0;
      const x = gap + PRELOAD;
      if (!this.coupled[i] && gap <= 0.002) { this.coupled[i] = true; this.events?.push({ type: 'coupled', i, speed: -rel }); }
      if (x > 0 && this.coupled[i]) F += K_DRAW * x + C_DRAW * rel;                   // draw gear in tension
      if (gap < 0) { const c = -gap; F -= 2 * (K_BUF1 * c + K_BUF3 * c * c * c) + C_BUF * -rel * (rel < 0 ? 1 : 0.3); }   // buffers in compression
      this.couplerForce[i] = F;                                     // + tension
    }
    // ---- integrate (semi-implicit Euler). Friction forces (rolling, curving, brakes, snow) cannot reverse motion.
    for (let i = 0; i < n; i++) {
      const v = this.veh[i];
      const Fc = (i > 0 ? this.couplerForce[i - 1] : 0) - (i < n - 1 ? this.couplerForce[i] : 0);
      const Fdrive = i === 0 ? lo.Fadh : (v.Ftrac ?? 0);
      const active = v.Fg + v.Faero + Fc + Fdrive;
      const friction = v.Froll + v.Fbrake + v.Fsnow;
      const mEff = v.mNow * (v.kind === 'engine' ? 1.0 : 1.04);
      let a;
      if (Math.abs(v.v) < 1e-3 && Math.abs(active) <= friction) { a = 0; v.v = 0; }
      else {
        const dirn = Math.abs(v.v) > 1e-3 ? Math.sign(v.v) : Math.sign(active);
        a = (active - dirn * friction) / mEff;
        const vNew = v.v + a * dt;
        if (Math.abs(v.v) > 1e-3 && Math.sign(vNew) !== Math.sign(v.v) && Math.abs(active) <= friction) { v.v = 0; a = -v.v / dt; }
        else v.v = vNew;
      }
      v.a = a;
      v.F = active;
    }
    for (const v of this.veh) v.s += v.v * dt;
    this.odometer += Math.abs(e.v) * dt;
    // ---- warmth of the cars (steam heat in, walls and doors out)
    const heatPerCar = lo.heatFlow * 2.1e6 / Math.max(1, n - 2);
    for (let i = 2; i < n; i++) {
      const loss = 2.2e3 * (this.coachTemp[i] - here.tempC);
      this.coachTemp[i] += ((heatPerCar - loss) / 2.5e7) * dt;     // ~25 MJ/K: air, panelling, seats, people
    }
  }

  /** The engine's brakes (automatic + direct) act on the coupled wheels: torque on the driver axle. */
  _driverBrakeTorque(e, mu) {
    const x = this.brake.v[0];
    const pc = Math.max(x.pBC, x.pBCdirect);
    if (pc <= 0) return 0;
    const Ktot = x.brakeForce * (pc / 3.8), Kb = Ktot / x.blocks / 9806.65;
    const kmh = Math.abs(e.v) * 3.6;
    const phi = 0.6 * ((16 * Kb + 100) / (80 * Kb + 100)) * ((kmh + 100) / (5 * kmh + 100));
    void mu;
    return Ktot * phi * this.loco.R;
  }
}
