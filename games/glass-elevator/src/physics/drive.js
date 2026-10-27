/**
 * The drive: a regenerative variable-voltage variable-frequency inverter running the gearless
 * permanent-magnet machine under field-oriented control. Three loops, as in a real lift drive:
 *
 *  - the motion profile: a jerk-limited (S-curve) speed reference that starts at 1.2 m/s³,
 *    accelerates at 1.0 m/s², cruises at up to 4.0 m/s and lands on the floor with the jerk
 *    rounding the end of the stop. It is generated online from the distance still to go, so the
 *    controller can move the target while the car runs (a new stop further on, or a nearer one
 *    if it can still be reached);
 *  - the position and speed loops on the motor's encoder (a PI speed controller with the
 *    acceleration and the load's unbalance fed forward);
 *  - the torque (current) loop, modelled as a short lag in the hoist (physics/hoist.js).
 *
 * Before the brakes lift the drive builds up the pre-torque the load weighing asks for, so the
 * car neither drops nor jumps when it is let go.
 */
import { SPEC, G } from '../data/spec.js';
import { SHEAVE_R } from './hoist.js';

const R = SHEAVE_R;

/** The highest speed from which a jerk-limited stop (deceleration A, jerk J) still ends within d. */
export function profileSpeed(d, A = SPEC.accel, J = SPEC.jerk) {
  if (d <= 0) return 0;
  const ve = (A * A) / (2 * J), d3 = (A * A * A) / (6 * J * J);
  if (d >= d3) return Math.sqrt(ve * ve + 2 * A * (d - d3));
  return (J / 2) * Math.cbrt((6 * d) / J) ** 2;
}

/** Distance to stop from speed v, acceleration a, with the deceleration ramped (jerk J) to a plateau ap and back. */
function plateauDist(ap, v, a, J) {
  const t1 = (a + ap) / J;
  const x1 = v * t1 + (a * t1 * t1) / 2 - (J * t1 ** 3) / 6;
  const v1 = v + a * t1 - (J * t1 * t1) / 2;
  const w = (ap * ap) / (2 * J);
  return x1 + (v1 * v1 - w * w) / (2 * ap) + ap ** 3 / (6 * J * J);
}
/** The shortest jerk-limited stop from (v, a) with deceleration at most A. */
export function stopDist(v, a, A = SPEC.accel, J = SPEC.jerk) {
  a = Math.max(a, -A);
  if (a < 0 && v <= (a * a) / (2 * J)) return (2 / 3) * v * v / -a;      // already rounding off the stop
  const ap = Math.max(-a, Math.min(A, Math.sqrt(J * v + (a * a) / 2)), 1e-6);
  return plateauDist(ap, v, a, J);
}
/** The deceleration plateau that ends the stop exactly d ahead (bisection; the distance falls as ap grows). */
function plateauFor(d, v, a, A, J) {
  let lo = Math.max(-a, 1e-4), hi = Math.max(lo, Math.min(A, Math.sqrt(J * v + (a * a) / 2)));
  if (d >= plateauDist(lo, v, a, J)) return lo;
  if (d <= plateauDist(hi, v, a, J)) return hi;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (plateauDist(m, v, a, J) > d) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export class Drive {
  constructor(hoist) {
    this.h = hoist;
    this.mode = 'off';            // off | hold | run | jog
    this.s = hoist.enc; this.v = 0; this.a = 0; this.dir = 0; this.jerk = 0;
    this.target = this.s; this.vmax = SPEC.ratedSpeed;
    this.A = SPEC.accel; this.J = SPEC.jerk;
    this.integ = 0; this.preF = 0; this.done = false;
    this.torqueLimit = SPEC.machine.maxTorque;
    this.fault = null;            // 'runaway': the speed loop reads its feedback wrong (simulated failure)
    this.power = 0; this.energy = 0;
  }

  /** Holds the sheave where it stands, building up the pre-torque (N at the rope) first. */
  hold(preF) { this.mode = 'hold'; this.s = this.h.enc; this.v = 0; this.a = 0; this.integ = 0; this.preF = preF; this.done = false; }
  run(target, vmax = SPEC.ratedSpeed, A = SPEC.accel, J = SPEC.jerk) {
    if (this.mode === 'off') this.hold(this.preF);
    this.mode = 'run'; this.target = target; this.vmax = vmax; this.A = A; this.J = J; this.done = false; this.braking = false;
    this.dir = Math.sign(target - this.s) || 1;
  }
  retarget(target) { if (this.mode === 'run') this.target = target; }
  jog(dir, vmax) { if (this.mode === 'off') this.hold(this.preF); this.mode = 'jog'; this.dir = dir; this.vmax = vmax; this.jogging = true; this.A = 0.8; this.J = 3; this.done = false; }
  off() { this.mode = 'off'; this.v = 0; this.a = 0; this.integ = 0; this.h.motor.cmd = 0; }

  /** Distance (m) the reference still needs to stop from where it is. */
  get stopping() { return stopDist(this.v, this.a, this.A, this.J); }

  step(dt, loadKg) {
    const h = this.h;
    if (this.mode === 'off') { h.motor.cmd = 0; this.power = 0; return; }
    const a0 = this.a;
    if (this.mode === 'run') {
      // time-optimal S-curve: accelerate (rounding into the cruise), and brake the moment the
      // shortest jerk-limited stop reaches the target; while braking, re-solve the deceleration
      // plateau each step so the stop ends exactly on the target
      const A = this.A, J = this.J, v = this.v, a = this.a;
      const d = (this.target - this.s) * this.dir;
      const dmin = stopDist(v, a, A, J);
      if (!this.braking && d <= dmin + 1e-4) this.braking = true;
      else if (this.braking && ((d > dmin + 0.3 && v < this.vmax - 0.01) || (v < 0.02 && d > 0.004))) this.braking = false;
      let na;
      if (!this.braking) {
        const aT = v + (a > 0 ? (a * a) / (2 * J) : 0) >= this.vmax ? 0 : A;
        na = a + Math.max(-J * dt, Math.min(J * dt, aT - a));
      } else if (a < 0 && v <= (a * a) / (2 * J) + 1e-9) {
        na = Math.min(0, a + ((a * a) / (2 * Math.max(v, 1e-6))) * dt);       // rounding off: jerk that brings a and v to zero together
      } else {
        const ap = plateauFor(Math.max(d, 0), v, a, A, J);
        na = a > -ap ? Math.max(-ap, a - J * dt) : -ap;
      }
      this.a = na;
      this.v = Math.max(0, v + na * dt);
      this.s += this.dir * this.v * dt;
      if ((this.braking && this.v < 0.002 && d < 0.003) || d < -0.003) { this.s = this.target; this.v = 0; this.a = 0; this.mode = 'hold'; this.done = true; this.braking = false; }
    } else if (this.mode === 'jog') {
      const vt = this.jogging ? this.vmax : 0;
      const at = this.jogging ? Math.max(-this.A, Math.min(this.A, (vt - this.v) * 4)) : -this.A * Math.min(1, this.v / 0.03);
      this.a += Math.max(-this.J * dt, Math.min(this.J * dt, at - this.a));
      this.v = Math.max(0, this.v + this.a * dt);
      this.s += this.dir * this.v * dt;
      if (!this.jogging && this.v <= 0.003) { this.v = 0; this.a = 0; this.mode = 'hold'; this.done = true; }
    }
    this.jerk = (this.a - a0) / dt;
    // ---- position and speed loops ----------------------------------------------------------
    const M = this._mass(loadKg);
    const wc = 8;
    const kp = M * wc, ki = (kp * wc) / 4;
    let fb = h.vs;
    if (this.fault === 'runaway') fb *= 0.6;                     // the encoder reads 60 %: the loop drives faster and faster
    const vref = this.dir * this.v + 4 * (this.s - h.enc);
    const ev = vref - fb;
    let F = this.preF + M * this.dir * this.a + kp * ev + ki * this.integ;
    const lim = this.torqueLimit / R;
    if (Math.abs(F) < lim || Math.sign(ev) !== Math.sign(this.integ)) this.integ += ev * dt;
    F = Math.max(-lim, Math.min(lim, F));
    h.motor.cmd = F * R;
    // the power at the shaft (+ motoring, - regenerating into the supply)
    this.power = h.motor.torque * (h.vs / R);
    this.energy += (this.power > 0 ? this.power / SPEC.machine.efficiency : this.power * SPEC.machine.efficiency) * dt;
  }

  /** The moving mass the drive believes it is driving, at the rope (kg). */
  _mass(loadKg) {
    const h = this.h;
    return h.P + Math.max(0, loadKg) + h.cw + h.lam * 124 + h.lamC * 124 + SPEC.machine.J / (R * R);
  }

  /** The unbalance (N at the rope, + when the car side is heavier) for a car load, from the installation's own geometry. */
  static unbalance(h, loadKg) {
    return G * (h.P + loadKg - h.cw) + h.lamC * G * (h.Lcc - h.Lwc) + h.lam * G * (h.Lc - h.Lw);
  }
}
