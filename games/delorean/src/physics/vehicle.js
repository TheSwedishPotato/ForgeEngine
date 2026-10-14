/**
 * The DMC-12 on the road.
 *
 * A planar rigid body (forward and lateral speed, yaw rate) on four tyres, each its own
 * rotating body; the PRV V6 driving the rear pair through a dry clutch, the five-speed
 * Renault gearbox and a 3.44 final drive. Integrated at 1 kHz.
 *
 *  - Tyres: Pacejka's "magic formula" in slip ratio and slip angle, combined through the
 *    friction ellipse; the load on each from the weight distribution (35/65, rear engine)
 *    and the longitudinal and lateral load transfer over a 0.47 m centre of gravity.
 *  - Engine: the ZMJ-159's torque curve (207 Nm at 2750 rpm, 97 kW at 5500), friction and
 *    pumping losses with the throttle shut, an idle governor, the rev limiter at 6600.
 *  - Driveline: clutch torque up to 320 Nm with its engagement; gear ratios 3.364, 2.059,
 *    1.381, 1.057, 0.820, reverse 3.182; final 3.444; 88 % efficient.
 *  - Resistance: drag (Cd 0.36 over 1.92 m2: the DMC with Doc's hardware), rolling resistance, the brakes
 *    (front-biased discs), the handbrake on the rear.
 *  - Steering: rack, 16:1, 32 degrees at the wheels with Ackermann geometry.
 *
 * (DMC-12 figures: Wikipedia and spec sheets, conceptcarz, ultimatespecs; gear ratios of the
 * UN1 box as fitted to the DMC; the rest are reasoned estimates noted where they stand.)
 *
 * Frames: the world is X east, Z south (Y up); the car's yaw `heading` turns its forward axis
 * from +X toward -Z (a left turn is positive). The body frame: x forward, z to the right.
 */

export const DMC = {
  mass: 1290,                 // kg: 1233 kerb + the time machine's hardware (~60 kg, a guess)
  Iz: 1750,                   // kg m2 about the vertical: ~ m (L^2 + W^2) / 12 * 0.84
  wheelbase: 2.413, trackF: 1.59, trackR: 1.588,
  frontShare: 0.35,           // of the static weight on the front axle
  cgHeight: 0.47,
  rF: 0.295, rR: 0.3315,      // tyre radii (195/60 R14, 235/60 R15)
  Iw: [1.0, 1.0, 1.35, 1.35], // wheel + tyre + brake inertia, kg m2 (fl, fr, rl, rr)
  mu: 0.95,                   // dry asphalt peak friction
  tyre: { Bx: 11, Cx: 1.65, Ex: 0.1, By: 9.5, Cy: 1.35, Ey: -0.4 },
  cd: 0.36, area: 1.92, crr: 0.014,       // the bare DMC's ~0.34 over 1.8 m2, plus the reactor, the vents and the conduit in the wind
  brakeF: 1350, brakeR: 760, handbrake: 1200,     // Nm per wheel at full pedal / lever
  steerMax: 32 * Math.PI / 180, steerRatio: 16,
  engine: {
    idle: 850, limit: 6600, redline: 6500, inertia: 0.17,
    // rpm -> Nm at full throttle
    curve: [[0, 0], [600, 120], [1000, 160], [1500, 180], [2000, 195], [2750, 207], [3500, 201], [4500, 188], [5500, 168], [6000, 156], [6500, 141], [7000, 110]],
  },
  gears: { 'R': -3.182, 'N': 0, 1: 3.364, 2: 2.059, 3: 1.381, 4: 1.057, 5: 0.820 },
  final: 3.444, eff: 0.88, clutchMax: 320,
};

const RPM = 60 / (2 * Math.PI);
export const MPH = 2.2369363;

function lerpCurve(c, x) {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 0; i + 1 < c.length; i++) if (x <= c[i + 1][0]) { const t = (x - c[i][0]) / (c[i + 1][0] - c[i][0]); return c[i][1] + (c[i + 1][1] - c[i][1]) * t; }
  return c[c.length - 1][1];
}

/** The magic formula: normalised force for a slip s with B, C, E (peak 1). */
function mf(s, B, C, E) { const Bs = B * s; return Math.sin(C * Math.atan(Bs - E * (Bs - Math.atan(Bs)))); }

export class Vehicle {
  constructor(p = DMC) {
    this.p = p;
    const L = p.wheelbase;
    this.a = L * (1 - p.frontShare);         // CG to front axle
    this.b = L * p.frontShare;               // CG to rear axle
    // where the CG sits in the car's frame (origin midway between the axles)
    this.cgX = L / 2 - this.a;
    this.wheels = [
      { x: this.a, z: -p.trackF / 2, r: p.rF, I: p.Iw[0], front: true },
      { x: this.a, z: p.trackF / 2, r: p.rF, I: p.Iw[1], front: true },
      { x: -this.b, z: -p.trackR / 2, r: p.rR, I: p.Iw[2], front: false },
      { x: -this.b, z: p.trackR / 2, r: p.rR, I: p.Iw[3], front: false },
    ].map((w) => ({ ...w, omega: 0, steer: 0, Fz: 0, Fx: 0, Fy: 0, slip: 0, alpha: 0, angle: 0, skid: 0 }));
    this.reset({ x: 0, z: 0, heading: 0 });
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 };
    this.auto = true;                          // automatic clutch and gear changes
    this.mu = p.mu;                            // the surface's friction (the world sets it)
    this.rolling = p.crr;
  }

  reset({ x = 0, z = 0, heading = 0, speed = 0, gear = 'N' } = {}) {
    this.x = x; this.z = z; this.heading = heading;
    this.u = speed; this.w = 0; this.r = 0;
    this.ax = 0; this.ay = 0;
    for (const wh of this.wheels) { wh.omega = speed / wh.r; wh.angle = 0; }
    this.gear = gear;
    this.engineOmega = Math.max(this.p.engine.idle, this._wheelRpm(gear)) / RPM;
    this.running = true;
    this.clutch = 1;            // 1 engaged
    this.shiftTimer = 0;
    this.steerAngle = 0;
    this.odometer = 0;
  }

  get speed() { return Math.hypot(this.u, this.w); }
  get rpm() { return this.engineOmega * RPM; }
  /** What the speedometers read: the front wheels' speed (they are not driven), mph. */
  get speedoMph() { return Math.abs((this.wheels[0].omega * this.wheels[0].r + this.wheels[1].omega * this.wheels[1].r) / 2) * MPH; }

  _ratio(g = this.gear) { return (this.p.gears[g] ?? 0) * this.p.final; }
  _wheelRpm(g = this.gear) {
    const rw = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    return Math.abs(rw * this._ratio(g)) * RPM;
  }

  shift(g) {
    if (!(g in this.p.gears) || g === this.gear) return;
    this.gear = g;
    this.shiftTimer = 0.32;     // the clutch is down for a third of a second
  }
  shiftUp() { const order = ['R', 'N', 1, 2, 3, 4, 5]; const i = order.indexOf(this.gear); if (i < order.length - 1) this.shift(order[i + 1]); }
  shiftDown() { const order = ['R', 'N', 1, 2, 3, 4, 5]; const i = order.indexOf(this.gear); if (i > 0) this.shift(order[i - 1]); }

  /** Engine torque at the crank (Nm) for the throttle and speed. */
  engineTorque(rpm, throttle) {
    const e = this.p.engine;
    if (!this.running) return -(18 + 0.004 * rpm);
    let th = throttle;
    if (rpm < e.idle) th = Math.max(th, Math.min(1, (e.idle - rpm) / 250) * 0.22);    // the idle governor
    if (rpm > e.limit) th = 0;                                                        // the limiter cuts the fuel
    const full = lerpCurve(e.curve, rpm);
    const drag = 14 + 0.0045 * rpm + 1.2e-6 * rpm * rpm;                              // friction and pumping
    return full * th - drag * (1 - th);
  }

  /** Advances dt seconds. ground(x, z) -> { mu, crr } (optional). */
  step(dt, ground = null) {
    const n = Math.max(1, Math.ceil(dt / 0.001)), h = dt / n;
    if (ground) { const g = ground(this.x, this.z); this.mu = g?.mu ?? this.p.mu; this.rolling = g?.crr ?? this.p.crr; }
    for (let i = 0; i < n; i++) this._step(h);
  }

  _step(h) {
    const p = this.p, inp = this.input, W = this.wheels;
    const g = 9.81, m = p.mass;
    // --- the driver's aids: the clutch and the gears ------------------------------------------
    this.shiftTimer = Math.max(0, this.shiftTimer - h);
    let clutchCmd;
    if (this.auto) {
      const rpm = this.rpm, v = this.u;
      // pull away: slip the clutch until the wheels catch up; disengage near a stop
      if (this.gear === 'N') clutchCmd = 0;
      else {
        const wr = this._wheelRpm();
        const launch = Math.min(1, Math.max(0, (rpm - 1050) / 900));
        clutchCmd = wr > 1300 ? 1 : Math.max(launch * (0.35 + 0.65 * inp.throttle), wr / 1300);
        if (inp.throttle < 0.05 && wr < 950) clutchCmd = 0;
      }
      // shift points
      if (this.shiftTimer <= 0 && typeof this.gear === 'number') {
        const wr = this._wheelRpm();
        if (wr > 5900 && this.gear < 5) this.shift(this.gear + 1);
        else if (this.gear > 1 && wr < (inp.throttle > 0.7 ? 3100 : 1700)) this.shift(this.gear - 1);
      }
      // from rest: first forward, reverse when held back
      if (Math.abs(v) < 0.6 && this.shiftTimer <= 0) {
        if (inp.throttle > 0.05 && (this.gear === 'N' || this.gear === 'R')) this.shift(1);
        if (inp.reverse && this.gear !== 'R') this.shift('R');
      }
    } else {
      clutchCmd = 1 - inp.clutch;
    }
    if (this.shiftTimer > 0) clutchCmd = 0;
    this.clutch += (clutchCmd - this.clutch) * Math.min(1, h * 14);
    const throttle = this.shiftTimer > 0.1 ? 0 : inp.throttle;

    // --- steering: the rack follows the wheel at a human rate; Ackermann on the fronts ----------
    const target = -inp.steer * p.steerMax * (1 - Math.min(0.55, this.speed / 80));
    this.steerAngle += Math.max(-h * 2.4, Math.min(h * 2.4, target - this.steerAngle));
    const d = this.steerAngle;
    if (Math.abs(d) > 1e-4) {
      const R = p.wheelbase / Math.tan(Math.abs(d)), s = Math.sign(d);
      // turning left (d > 0): the left wheel (z < 0) is the inner one
      W[0].steer = s * Math.atan(p.wheelbase / (R - (s > 0 ? 1 : -1) * p.trackF / 2));
      W[1].steer = s * Math.atan(p.wheelbase / (R + (s > 0 ? 1 : -1) * p.trackF / 2));
    } else { W[0].steer = W[1].steer = 0; }

    // --- loads ----------------------------------------------------------------------------------
    const L = p.wheelbase, hcg = p.cgHeight;
    const FzF = m * g * this.b / L - m * this.ax * hcg / L, FzR = m * g * this.a / L + m * this.ax * hcg / L;
    const latF = m * this.ay * hcg / p.trackF * 0.45, latR = m * this.ay * hcg / p.trackR * 0.55;
    // lateral acceleration to the right (ay > 0) loads the left wheels
    W[0].Fz = Math.max(0, FzF / 2 + latF); W[1].Fz = Math.max(0, FzF / 2 - latF);
    W[2].Fz = Math.max(0, FzR / 2 + latR); W[3].Fz = Math.max(0, FzR / 2 - latR);

    // --- the engine and the clutch --------------------------------------------------------------
    const ratio = this._ratio();
    const rearOmega = (W[2].omega + W[3].omega) / 2;
    const Te = this.engineTorque(this.rpm, throttle);
    let Tc = 0;
    if (ratio !== 0) {
      const slipOmega = this.engineOmega - rearOmega * ratio;
      Tc = Math.max(-1, Math.min(1, slipOmega / 3)) * p.clutchMax * this.clutch;
      // locked: the engine turns with the wheels (then the clutch passes what the engine makes)
      if (this.clutch > 0.98 && Math.abs(slipOmega) < 6) {
        const Ieff = p.engine.inertia;
        Tc = Te - Ieff * 0 + Math.max(-1, Math.min(1, slipOmega / 3)) * 40;
      }
    }
    this.engineOmega += (Te - Tc) / p.engine.inertia * h;
    if (this.engineOmega < 0) this.engineOmega = 0;
    if (this.running && this.rpm < 300 && this.clutch > 0.5 && ratio !== 0) { this.running = false; this.stalled = true; }
    const driveEach = Tc * ratio * p.eff / 2;

    // --- the tyres ------------------------------------------------------------------------------
    let Fx = 0, Fz = 0, Mz = 0;
    const T = p.tyre;
    for (let i = 0; i < 4; i++) {
      const wh = W[i];
      // contact patch velocity in the body frame (x forward, z right), then in the wheel's frame
      const vx = this.u + this.r * wh.z, vz = this.w - this.r * wh.x;
      const cs = Math.cos(wh.steer), sn = Math.sin(wh.steer);
      const vxw = vx * cs - vz * sn, vzw = vx * sn + vz * cs;
      const ref = Math.max(Math.abs(vxw), 1.5);
      const kappa = Math.max(-1.5, Math.min(1.5, (wh.omega * wh.r - vxw) / ref));
      const alpha = Math.atan2(vzw, Math.max(Math.abs(vxw), 0.8));
      const D = this.mu * wh.Fz;
      let fx = D * mf(kappa, T.Bx, T.Cx, T.Ex);
      let fy = -D * mf(alpha, T.By, T.Cy, T.Ey);
      // friction ellipse
      const k = Math.hypot(fx / (D + 1e-6), fy / (D + 1e-6));
      if (k > 1) { fx /= k; fy /= k; }
      // rolling resistance
      fx -= Math.sign(wh.omega) * Math.min(Math.abs(wh.omega * wh.r) * 3, 1) * this.rolling * wh.Fz;
      wh.Fx = fx; wh.Fy = fy; wh.slip = kappa; wh.alpha = alpha;
      wh.skid = Math.min(1, Math.max(0, Math.hypot(kappa * 3, alpha * 4) - 0.35));
      // back to the body frame
      const bx = fx * cs + fy * sn, bz = -fx * sn + fy * cs;
      Fx += bx; Fz += bz;
      Mz += wh.z * bx - wh.x * bz;
      // the wheel's spin: drive, brakes, the road's reaction
      let Tq = -fx * wh.r;
      if (!wh.front) Tq += driveEach;
      const brakeT = (wh.front ? p.brakeF : p.brakeR) * inp.brake + (wh.front ? 0 : p.handbrake * inp.handbrake);
      const I = wh.I + (!wh.front && this.clutch > 0.98 ? p.engine.inertia * ratio * ratio / 2 : 0);
      let om = wh.omega + Tq / I * h;
      // brakes: they stop the wheel, never turn it backwards
      const dB = brakeT / I * h;
      if (Math.abs(om) <= dB) om = 0; else om -= Math.sign(om) * dB;
      wh.omega = om;
      wh.angle = (wh.angle + om * h) % (Math.PI * 2);
    }
    // the engine follows locked wheels exactly (no fighting the stiff coupling)
    if (this.clutch > 0.98 && ratio !== 0) {
      const target = (W[2].omega + W[3].omega) / 2 * ratio;
      if (Math.abs(this.engineOmega - target) < 8) this.engineOmega = target;
    }
    if (this.rpm > p.engine.limit + 300) this.engineOmega = (p.engine.limit + 300) / RPM;

    // --- air ------------------------------------------------------------------------------------
    const v = this.speed;
    const drag = 0.5 * 1.2 * p.cd * p.area * v;
    Fx -= drag * this.u; Fz -= drag * this.w * 3.0;

    // --- the body -------------------------------------------------------------------------------
    // m (du/dt + r w) = Fx ; m (dw/dt - r u) = Fz ; Iz dr/dt = Mz   (r positive turning left)
    const du = Fx / m - this.r * this.w;
    const dw = Fz / m + this.r * this.u;
    this.u += du * h;
    this.w += dw * h;
    this.r += Mz / p.Iz * h;
    // at rest the tyres hold the car still (the model's slip is undefined at zero speed)
    if (v < 0.25 && inp.throttle < 0.02 && (inp.brake > 0.1 || inp.handbrake > 0.1 || this.gear === 'N')) {
      this.u *= 0.9; this.w *= 0.9; this.r *= 0.9;
      if (inp.brake > 0.1) for (const wh of W) wh.omega *= 0.9;
    }
    // accelerations for the load transfer (smoothed, as the springs would)
    const k = Math.min(1, h * 12);
    this.ax += (Fx / m - this.ax) * k;
    this.ay += (Fz / m - this.ay) * k;
    // move in the world
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    // forward is (cos, -sin) in X, Z; right is (sin, cos)
    this.x += (this.u * c + this.w * s) * h;
    this.z += (-this.u * s + this.w * c) * h;
    this.heading += this.r * h;
    this.odometer += v * h;
  }

  /** World velocity (X, Z) of the CG. */
  velocity() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return { x: this.u * c + this.w * s, z: -this.u * s + this.w * c };
  }

  /** The car's frame origin (midway between the axles) in the world. */
  origin() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return { x: this.x - this.cgX * c, z: this.z + this.cgX * s };
  }
}
