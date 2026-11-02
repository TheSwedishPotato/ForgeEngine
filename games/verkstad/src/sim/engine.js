/**
 * A four-stroke engine, cylinder by cylinder, at 2–4 kHz.
 *
 * The crankshaft is one rotating inertia. Each cylinder adds, at its place in the firing order:
 *  - the gas spring of compression and expansion: work taken on the compression stroke and given
 *    back (less 10 %) on the power stroke, fired or not. It is what makes a cranking engine's
 *    speed rise and fall four times a cycle;
 *  - combustion on the power stroke, if the spark jumps and the mixture burns: a torque pulse
 *    sin a (1 + cos a) over the stroke, sized for the cylinder's mean indicated torque at this
 *    speed and load (the full-load curve times how much air and fuel it got);
 * and the whole engine loses friction and pumping torque (FMEP rising with speed, more when cold,
 * more at small throttle). The starter, when engaged, adds a series motor's torque falling with
 * speed, fed from the battery through its internal resistance.
 *
 * The engine control unit is modelled as one: an idle-speed PI controller on the idle air, fuel
 * trims from the lambda sensor that correct for air the meter did not see, and misfire detection
 * the way real ECUs do it: the crankshaft's angular acceleration over each cylinder's power stroke,
 * compared to the others'. Enough of those in 1000 revolutions sets a code.
 *
 * Heat: what the burning fuel does not turn into work, part into the coolant (35 kJ/K before the
 * thermostat opens); the radiator takes it out when the thermostat opens, and the fan helps.
 */

const TAU = Math.PI * 2, CYC = Math.PI * 4;

export class Engine {
  constructor(spec) {
    const e = spec.engine;
    this.e = e; this.spec = spec;
    this.n = e.cyl;
    this.Vd = (Math.PI / 4) * e.bore ** 2 * e.stroke;           // one cylinder's swept volume (m³)
    this.Vtot = this.Vd * this.n;
    this.J = e.inertia;
    this.theta = 0; this.omega = 0;
    this.running = false;
    this.order = e.firing.map((c) => c - 1);                      // cylinder index in firing order
    this.phase = new Array(this.n);
    this.order.forEach((ci, k) => { this.phase[ci] = (k * CYC) / this.n; });
    this.cyl = Array.from({ length: this.n }, () => ({ fire: true, strength: 1, a: 0, lastA: 0, misfires: 0, tPow: 0, w0: 0, accel: 0, fired: false }));
    this.idleAir = 0.3; this.idleI = 0;
    this.coolant = 12; this.oilT = 12; this.ambient = 8;
    this.trimST = 0; this.trimLT = 0;
    this.misfireWindow = 0; this.revs = 0;
    this.events = [];                                             // firing events for the sound and the shake
    this.time = 0;
    this.roll = 0; this.rollV = 0;                                 // the engine rocking on its mounts (rad)
    this.load = 0;
    this.fuelUsed = 0;
    this.stalls = 0;
    this.lastPower = 0;
    // its own random numbers (whether a weak spark jumps), seeded, so a run can be repeated
    let seed = 0x9e3779b9;
    this.rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  }

  get rpm() { return (this.omega * 60) / TAU; }

  /** Full-load mean torque (N·m) at this speed, from the spec's peak torque and power. */
  fullTorque(rpm) {
    const e = this.e;
    const Tp = e.peakPower / ((e.redline * 0.9 * TAU) / 60);            // torque at peak power
    if (e.turbo && e.layout !== 'V6') {
      if (rpm < 1000) return e.peakTorque * (0.45 + 0.45 * rpm / 1000);
      if (rpm < e.torqueRpm) return e.peakTorque * (0.9 + 0.1 * (rpm - 1000) / (e.torqueRpm - 1000));
      if (rpm < 4000) return e.peakTorque;
      return e.peakTorque + (Tp - e.peakTorque) * Math.min(1, (rpm - 4000) / (e.redline * 0.9 - 4000));
    }
    const x = (rpm - e.torqueRpm) / (e.redline * 0.9 - e.torqueRpm);
    if (rpm < e.torqueRpm) return e.peakTorque * (0.72 + 0.28 * Math.sin((Math.PI / 2) * rpm / e.torqueRpm));
    return e.peakTorque + (Tp - e.peakTorque) * Math.min(1, x * x);
  }

  /** Friction and pumping torque (N·m) at this speed, temperature and air. */
  friction(rpm, air) {
    const k = rpm / 1000;
    const cold = 1 + Math.max(0, 70 - this.oilT) / 150;
    const fmep = (0.9 + 0.2 * k + 0.02 * k * k) * cold + (1 - air) * 0.55;   // bar
    return (fmep * 1e5 * this.Vtot) / CYC;
  }

  /**
   * Advances dt seconds. io (from the car, see sim/vehicle.js):
   *   { volts, ignition, starter, throttle, spark[i] (0..1 chance of a good spark), inj[i] (fuel
   *     flow fraction), comp[i] (compression, 1 good), unmetered (air the meter does not see, as a
   *     fraction of idle air), ammOk, o2Ok, fuelOk, fanOn, thermo (0 shut..1 open fixed, or null:
   *     works), opens (°C), radiator (0..1), coolantLevel (0..1), oilLevel (fraction of capacity),
   *     load (N·m from the wheels or the alternator), f1: { starterTool, warm } }
   */
  step(dt, io) {
    const sub = this.e.redline > 9000 ? 4000 : 2000;
    const n = Math.max(1, Math.ceil(dt * sub)), h = dt / n;
    for (let i = 0; i < n; i++) this._step(h, io);
    this._thermal(dt, io);
    this._ecu(dt, io);
  }

  _step(h, io) {
    const e = this.e, rpm = this.rpm;
    this.time += h;
    // the starter: a series-wound motor (geared 1:12 or so); its torque falls with speed
    let Ts = 0, Is = 0;
    if (io.starter && io.volts > 6 && !e.mguk) {
      const free = 320 * TAU / 60;                                // crank speed it would reach unloaded
      const k = Math.max(0, 1 - this.omega / free);
      Is = (e.cyl * this.Vd * 1000 > 2 ? 260 : 210) * k * (io.volts / 12);
      Ts = (this.Vtot * 1000 > 2 ? 135 : 105) * k * (io.volts / 11.5) ** 2;
    }
    if (e.mguk && io.f1?.starterTool) Ts = 60 * Math.max(0, 1 - this.omega / (3200 * TAU / 60));
    this.starterAmps = Is;
    // air: the idle valve (or the throttle's idle opening) plus the pedal, plus unmetered air
    const pedal = io.throttle ?? 0;
    const air = Math.min(1, this.idleAir + pedal * (1 - this.idleAir) + (io.unmetered ?? 0) * 0.06);
    this.air = air;
    // mixture: the fuelling meters the air it sees; unmetered air leans it out (lambda > 1) until the trims catch it
    const seen = air - (io.unmetered ?? 0) * 0.06;
    const fuel = (seen / air) * (1 + (this.trimST + this.trimLT) / 100) * (io.ammOk === false ? 0.85 : 1);
    const lambda = 1 / Math.max(0.3, fuel);
    this.lambda = lambda;
    const mixOK = lambda < 1.28 && lambda > 0.72 && io.fuelOk !== false;
    const burn = Math.max(0, 1 - Math.abs(lambda - 0.95) * 1.6);
    const Tfull = this.fullTorque(Math.max(rpm, 300));
    const Tind = Tfull + this.friction(Math.max(rpm, 300), 1);          // indicated: what the gas does before friction
    let T = Ts - this.friction(rpm, air) * Math.sign(this.omega || 1) * (this.omega > 0.5 ? 1 : this.omega / 0.5);
    const gasK = (this.Vd * 1e5 * e.cr * 0.06);                   // N·m of compression torque per cylinder (peak)
    let roll = 0;
    for (let c = 0; c < this.n; c++) {
      const C = this.cyl[c];
      const a = (((this.theta - this.phase[c]) % CYC) + CYC) % CYC;
      // a new cycle (TDC firing) for this cylinder: will it fire?
      if (a < C.lastA) {
        const sparkP = io.ignition ? (io.spark?.[c] ?? 1) : 0;
        const fuelC = io.inj?.[c] ?? 1;
        const comp = io.comp?.[c] ?? 1;
        const cranking = rpm < 300;
        const limiter = rpm > e.redline;                                 // fuel cut at the rev limit
        const fires = sparkP > 0 && this.rand() < sparkP && mixOK && fuelC > 0.35 && comp > 0.45 && this.omega > 8 && this.sync > 1.5 && !limiter && (!e.mguk || io.f1?.warm);
        C.fired = fires;
        C.strength = fires ? burn * Math.min(1, fuelC / 0.9) * Math.min(1, comp) * (cranking ? 0.8 : 1) : 0;
        C.w0 = this.omega; C.tPow = this.time;
        if (this.running || cranking) this.events.push({ t: this.time, cyl: c + 1, fired: fires, s: C.strength, rpm });
      }
      // a quarter-way into the power stroke the ECU samples the acceleration this firing gave
      if (C.lastA < Math.PI && a >= Math.PI) C.accel = (this.omega - C.w0) / Math.max(1e-4, this.time - C.tPow);
      C.lastA = a;
      // gas spring: compression (3π..4π) takes, expansion (0..π) gives back 90 %
      let Tg = 0;
      const comp = io.comp?.[c] ?? 1;
      if (a > 3 * Math.PI) Tg = -gasK * comp * Math.sin(a - 3 * Math.PI) * Math.pow((a - 3 * Math.PI) / Math.PI, 2);
      else if (a < Math.PI) Tg = 0.9 * gasK * comp * Math.sin(a) * Math.pow(1 - a / Math.PI, 2);
      // combustion
      let Tc = 0;
      if (a < Math.PI && C.strength > 0) {
        const Tm = (Tind / this.n) * air * C.strength;          // this cylinder's mean indicated torque
        Tc = TAU * Tm * Math.sin(a) * (1 + Math.cos(a)) * 1.0;
      }
      T += Tg + Tc;
      roll += Tc;
    }
    // what the engine drives (alternator, the wheels on the rollers), as a torque against it
    T -= (io.load ?? 0) * (this.omega > 1 ? 1 : this.omega);
    this.omega = Math.max(0, this.omega + (T / this.J) * h);
    this.theta = (this.theta + this.omega * h) % (CYC * 1000);
    this.revs += (this.omega * h) / TAU;
    // the ECU has to see the crank's reference mark (and the fuel rail come up to pressure) before it fires anything
    if (this.omega > 5) this.sync = (this.sync ?? 0) + (this.omega * h) / TAU; else this.sync = 0;
    this.netTorque = T;
    // the engine rocks on its mounts against the torque it makes (a damped spring, ~12 Hz)
    const kM = 2400, cM = 60, Jb = 0.9 * (this.Vtot * 1000 > 2 ? 1.2 : 1);
    this.rollV += ((-roll * 0.004 - kM * this.roll - cM * this.rollV) / Jb) * h;
    this.roll += this.rollV * h;
    // running or not: firing and above about 350 rpm
    const firing = this.cyl.some((C) => C.fired);
    if (!this.running && firing && this.rpm > (e.mguk ? 2500 : 480)) this.running = true;
    if (this.running && (this.rpm < (e.mguk ? 1800 : 220) || !io.ignition)) { this.running = false; if (io.ignition) this.stalls++; }
    this.fuelUsed += air * (this.omega / TAU) * 0.5 * this.Vtot * 1.2 / 14.7 * h * (this.running ? 1 : 0);   // kg
    this.lastPower = (Tfull * air) * this.omega * (this.running ? 1 : 0);
  }

  _ecu(dt, io) {
    const e = this.e;
    if (!this.running) { this.idleI *= 0.98; this.idleAir += (0.32 - this.idleAir) * Math.min(1, dt * 2); return; }
    // idle speed control (only off the pedal): fast idle when cold
    const target = e.idle + Math.max(0, 40 - this.coolant) * 6;
    if ((io.throttle ?? 0) < 0.02) {
      const err = (target - this.rpm) / 1000;
      this.idleI = Math.max(-0.2, Math.min(0.35, this.idleI + err * dt * 1.0));
      this.idleAir = Math.max(0.1, Math.min(0.65, 0.24 + err * 0.45 + this.idleI));
    }
    // closed-loop fuelling: the lambda sensor (once warm) reads lean or rich and the trims follow
    if (io.o2Ok !== false && this.coolant > 40) {
      const errL = (this.lambda - 1) * 100;
      this.trimST = Math.max(-25, Math.min(25, this.trimST + errL * dt * 2));
      this.trimLT = Math.max(-25, Math.min(25, this.trimLT + this.trimST * dt * 0.05));
    } else this.trimST *= 0.99;
    // misfire detection: a cylinder whose power stroke gave much less acceleration than the mean
    const acc = this.cyl.map((C) => C.accel), mean = acc.reduce((a, b) => a + b, 0) / this.n;
    for (const C of this.cyl) {
      if (C._seen === C.tPow) continue;
      C._seen = C.tPow;
      if (C.accel < mean - Math.abs(mean) * 0.6 - 40 && this.rpm > 400) C.misfires++;
    }
    if (this.revs > 200) {                                        // each cylinder fires 100 times in 200 revolutions
      this.revs = 0;
      this.misfireRate = this.cyl.map((C) => C.misfires / 100);
      for (const C of this.cyl) C.misfires = 0;
    }
  }

  _thermal(dt, io) {
    const amb = this.ambient;
    const heat = this.running ? Math.max(1800, this.lastPower * 1.1) + 1500 : 0;       // W into the coolant
    const lvl = io.coolantLevel ?? 1;
    const opens = io.opens ?? 87;
    let open = Math.max(0, Math.min(1, (this.coolant - opens) / 10));
    if (io.thermo != null) open = io.thermo;
    const fan = io.fanOn ? 1 : 0.35;
    const out = open * 900 * fan * (io.radiator ?? 1) * Math.max(0, this.coolant - amb) + 9 * (this.coolant - amb);
    const C = 35000 * Math.max(0.3, lvl);
    this.coolant += ((heat - out) / C) * dt;
    if (lvl < 0.5 && this.running) this.coolant += dt * 0.08;                              // steam pockets, the gauge climbs
    this.oilT += (this.coolant - this.oilT) * Math.min(1, dt / 240) + (this.running ? 0 : 0);
    this.thermostatOpen = open;
  }

  /** Oil pressure (bar) at the sender: rises with speed, falls with hot thin oil and a low level. */
  oilPressure(oilLevel) {
    if (this.omega < 1) return 0;
    const visc = 1 + Math.max(0, 80 - this.oilT) / 60;
    const starve = oilLevel < 0.35 ? Math.max(0, (oilLevel - 0.15) / 0.2) : 1;
    return Math.min(5.5, (0.6 + this.rpm / 1100) * visc) * starve;
  }

  /** A compression test: the gauge reading (bar) in cylinder c after five cranking strokes. */
  compression(c, comp) { return (this.e.cr * 1.25 * (0.55 + 0.45 * Math.min(1, comp)) + (comp < 0.6 ? -4 : 0)) * (this.e.mguk ? 1 : 1); }

  drainEvents() { const ev = this.events; this.events = []; return ev; }
}
