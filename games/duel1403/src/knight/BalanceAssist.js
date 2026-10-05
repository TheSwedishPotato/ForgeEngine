import { Vector3, Quaternion } from 'three';
import { applyPairCorrection } from '../physics/solver.js';
import { quatToRotVec } from '../physics/math.js';

const _d = new Vector3(), _c = new Vector3(), _q = new Quaternion(), _w = new Vector3();

/**
 * Balance controller for the pelvis (a "virtual model control" style
 * stand-in for the ankle/hip strategies a real fighter uses).
 *
 * It pulls the pelvis towards a target position/orientation with bounded,
 * compliant forces. The bounds matter: horizontally the force is capped near
 * the friction the feet could actually produce, so a heavy blow still knocks
 * a fighter off balance. Strength is scaled by consciousness and by how many
 * feet are on the canvas, and drops to zero when the fighter is down.
 */
export class BalanceAssist {
  constructor(body, totalMass) {
    this.body = body;
    this.totalMass = totalMass;
    this.targetPos = body.pos.clone();
    this.targetVel = new Vector3();
    this.targetQ = body.q.clone();
    this.strength = 1;
    this.boost = 1;          // temporary extra push-off (lunges)
    this.lift = 1;           // extra vertical strength while rising from the ground
    // Nominal gains (scaled by strength).
    this.kHorizontal = totalMass * 6.5 * 6.5;      // N/m
    this.kVertical = totalMass * 9 * 9;
    this.kRot = 900;                               // Nm/rad
    this.cHorizontal = 2 * 0.9 * Math.sqrt(this.kHorizontal * totalMass);
    this.cVertical = 2 * 0.8 * Math.sqrt(this.kVertical * totalMass);
    this.cRot = 70;
    this.maxHorizontal = 0.75 * totalMass * 9.81;  // ~ foot friction limit
    this.maxVertical = 1.05 * totalMass * 9.81;
    this.maxTorque = 420;
  }

  solvePosition(h) {
    const s = this.strength;
    if (s <= 1e-3) return;
    const b = this.body;
    _d.subVectors(this.targetPos, b.pos);
    // Horizontal
    _c.set(_d.x, 0, _d.z);
    applyPairCorrection(b, null, _c, 1 / (this.kHorizontal * s * this.boost), h, b.pos, null, this.maxHorizontal * s * this.boost * h * h);
    // Vertical: only pushes up (feet cannot pull the body down), plus a
    // gentle pull when far too high (e.g. mid-air after a stumble is left to gravity).
    if (_d.y > 0) {
      _c.set(0, _d.y, 0);
      applyPairCorrection(b, null, _c, 1 / (this.kVertical * s * this.lift), h, b.pos, null, this.maxVertical * s * this.lift * h * h);
    }
    // Orientation
    _q.copy(b.q).invert().premultiply(this.targetQ);
    quatToRotVec(_q, _c);
    applyPairCorrection(b, null, _c, 1 / (this.kRot * s * this.lift), h, null, null, this.maxTorque * s * this.lift * h * h);
  }

  solveVelocity(h) {
    const s = this.strength;
    if (s <= 1e-3) return;
    const b = this.body;
    // Linear damping towards the target velocity (implicit dashpot).
    _d.subVectors(b.vel, this.targetVel);
    const hx = _d.x, hz = _d.z;
    const vh = Math.hypot(hx, hz);
    if (vh > 1e-6) {
      const c = this.cHorizontal * s;
      const w = b.invMass;
      let dv = (c * h * w * vh) / (1 + c * h * w);
      dv = Math.min(dv, this.maxHorizontal * s * h * w);   // force cap
      _c.set(-hx / vh * dv, 0, -hz / vh * dv);
      applyPairCorrection(b, null, _c, 0, h, b.pos, null, Infinity, true);
    }
    if (_d.y < 0) {
      const c = this.cVertical * s;
      const w = b.invMass;
      const dv = (c * h * w * -_d.y) / (1 + c * h * w);
      _c.set(0, dv, 0);
      applyPairCorrection(b, null, _c, 0, h, b.pos, null, Infinity, true);
    }
    // Angular damping
    _w.copy(b.omega);
    const wl = _w.length();
    if (wl > 1e-6) {
      _w.multiplyScalar(1 / wl);
      const wi = b.getInverseMass(_w, null);
      const c = this.cRot * s;
      const dw = (c * h * wi * wl) / (1 + c * h * wi);
      _c.copy(_w).multiplyScalar(-dw);
      applyPairCorrection(b, null, _c, 0, h, null, null, Infinity, true);
    }
  }
}
