/**
 * Joints between two rigid bodies.
 *
 *   new BallJoint(a, b, anchor, { axis, coneAngle, twistMin, twistMax, friction })
 *       The bodies share the world point `anchor`. `axis` is the bone direction used for the limits: the swing of
 *       b's axis away from a's may not exceed `coneAngle`, and the rotation of b about it relative to the pose it
 *       was created in stays within [twistMin, twistMax]. Shoulders, hips, necks.
 *
 *   new HingeJoint(a, b, anchor, axis, { min, max, friction })
 *       The bodies share the point and can only rotate about `axis`; the angle (radians, 0 = the pose at creation,
 *       positive = b turning counter-clockwise about `axis` seen from its tip) stays within [min, max]. Knees, elbows.
 *
 * Use `world.ground` as a body to pin something to the world. Both are solved as velocity constraints with
 * accumulated impulses (warm started across substeps) and a Baumgarte position bias that is removed again in the
 * world's relax pass, so a joint does not inject energy when it pulls an error closed.
 */
import { Vector3, Quaternion } from '../math/core.js';

/** @import { RigidBody } from './Body.js' */

const _S = new Float64Array(9), _T = new Float64Array(9), _U = new Float64Array(9), _K2 = new Float64Array(9);
const _v = new Vector3(), _w = new Vector3(), _a = new Vector3(), _b = new Vector3(), _u = new Vector3(), _p1 = new Vector3(), _p2 = new Vector3();
const _q = new Quaternion(), _q2 = new Quaternion();

function skew(x, y, z, m) { m[0] = 0; m[1] = -z; m[2] = y; m[3] = z; m[4] = 0; m[5] = -x; m[6] = -y; m[7] = x; m[8] = 0; }
function mul3(a, b, o) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
}
/** out += sign * S(r) * I * S(r) */
function addSIS(rx, ry, rz, I, sign, out) {
  skew(rx, ry, rz, _S); mul3(_S, I, _T); mul3(_T, _S, _U);
  for (let k = 0; k < 9; k++) out[k] += sign * _U[k];
}
/** Inverts a 3x3 (row-major) into `o`; returns false when singular. */
function invert3(m, o) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) { o.fill(0); return false; }
  const s = 1 / det;
  o[0] = A * s; o[1] = -(b * i - c * h) * s; o[2] = (b * f - c * e) * s;
  o[3] = B * s; o[4] = (a * i - c * g) * s; o[5] = -(a * f - c * d) * s;
  o[6] = C * s; o[7] = -(a * h - b * g) * s; o[8] = (a * e - b * d) * s;
  return true;
}
function linAdd(b, x, y, z, s) { const im = b.invMass * s, v = b.linearVelocity; v.x += im * x; v.y += im * y; v.z += im * z; }
function angAdd(b, x, y, z, s) {
  const m = b.iw, w = b.angularVelocity;
  w.x += s * (m[0] * x + m[1] * y + m[2] * z); w.y += s * (m[3] * x + m[4] * y + m[5] * z); w.z += s * (m[6] * x + m[7] * y + m[8] * z);
}
function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

/**
 * Limits of a ball joint (radians), or of a hinge (`min` / `max`).
 * @typedef {object} BallLimits
 * @property {number} [coneAngle]  largest swing
 * @property {number} [twistMin]
 * @property {number} [twistMax]
 */

/**
 * What `new BallJoint(a, b, anchor, o)` takes.
 * @typedef {object} BallJointOptions
 * @property {Vector3 | null} [axis]       bone direction (world, at creation) the limits refer to; default: anchor towards b
 * @property {number} [coneAngle]          maximum swing in radians (default: unlimited)
 * @property {number} [twistMin]           twist range in radians about `axis` (default: unlimited)
 * @property {number} [twistMax]
 * @property {number} [friction]           joint friction as a maximum torque in N*m
 * @property {Quaternion | null} [neutral] orientation of b relative to a in the neutral pose (default: the pose at creation)
 */

/**
 * What `new HingeJoint(a, b, anchor, axis, o)` takes.
 * @typedef {object} HingeJointOptions
 * @property {number} [min]                lowest angle in radians (default: unlimited)
 * @property {number} [max]                highest angle in radians
 * @property {number} [friction]           joint friction as a maximum torque in N*m
 * @property {Quaternion | null} [neutral] orientation of b relative to a in the neutral pose (default: the pose at creation)
 */

export class Joint {
  /** @param {RigidBody} bodyA @param {RigidBody} bodyB */
  constructor(bodyA, bodyB) {
    if (!bodyA || !bodyB) throw new Error('A joint needs two bodies (use world.ground to pin to the world)');
    this.bodyA = bodyA; this.bodyB = bodyB;
    /** Jointed bodies do not collide with each other unless you set this. */
    this.collideConnected = false;
    this.enabled = true;
    this.world = null;
    /** Fraction of the position error closed per substep (0..1). */
    this.baumgarte = 0.25;
    this.maxBias = 6;
    bodyA.joints.push(this); bodyB.joints.push(this);
  }
  dispose() {
    for (const b of [this.bodyA, this.bodyB]) { const i = b.joints.indexOf(this); if (i >= 0) b.joints.splice(i, 1); }
  }
  /** Solver hooks: called by the World each substep. @param {number} h  substep length in seconds */
  prepare(h) {}
  warmStart() {}
  /** @param {boolean} useBias  apply the position-error bias (false in the relax pass) */
  solve(useBias) {}
  /** Forgets the accumulated impulses (after teleporting a body, or when its group falls asleep). */
  reset() {}
}

export class BallJoint extends Joint {
  /**
   * @param {RigidBody} bodyA @param {RigidBody} bodyB
   * @param {Vector3} anchor  world position of the joint at creation
   * @param {BallJointOptions} [o]
   */
  constructor(bodyA, bodyB, anchor, { axis = null, coneAngle = Math.PI, twistMin = -Math.PI, twistMax = Math.PI, friction = 0, neutral = null } = {}) {
    super(bodyA, bodyB);
    const A = bodyA, B = bodyB;
    _q.copy(A.quaternion).invert(); _q2.copy(B.quaternion).invert();
    this.la = anchor.clone().sub(A.position).applyQuaternion(_q);
    this.lb = anchor.clone().sub(B.position).applyQuaternion(_q2);
    const w = axis ? axis.clone().normalize() : (_v.copy(B.position).sub(anchor).lengthSq() > 1e-10 ? _v.clone().normalize() : new Vector3(0, 1, 0));
    this.axisA = w.clone().applyQuaternion(_q); this.axisB = w.clone().applyQuaternion(_q2);
    if (neutral) this.axisB = this.axisA.clone().applyQuaternion(_q.copy(neutral).invert());   // the axes coincide in the neutral pose
    this.coneAngle = coneAngle; this.twistMin = twistMin; this.twistMax = twistMax; this.friction = friction;
    this.useCone = coneAngle < Math.PI - 1e-6;
    this.useTwist = twistMin > -Math.PI + 1e-6 || twistMax < Math.PI - 1e-6;
    // orientation of b relative to a in the neutral pose (default: the pose at creation), to measure swing and twist from
    this.rest = neutral ? neutral.clone() : A.quaternion.clone().invert().multiply(B.quaternion);
    this.restInv = this.rest.clone().invert();
    // solver state
    this.ra = new Vector3(); this.rb = new Vector3();
    this.Kinv = new Float64Array(9); this.Kf = new Float64Array(9);
    this.P = new Vector3();               // accumulated point impulse
    this.F = new Vector3();               // accumulated friction impulse
    this.bias = new Vector3();
    this.cone = 0; this.coneAcc = 0; this.twLo = 0; this.twHi = 0;
    this.swing = 0; this.twist = 0;      // measured angles, for inspection
    this._h = 1 / 240;
    this._lim = null;
  }

  reset() { this.P.set(0, 0, 0); this.F.set(0, 0, 0); this.coneAcc = 0; this.twLo = 0; this.twHi = 0; }

  /** Distance between the two anchor points right now (should stay near zero). */
  anchorError() {
    const A = this.bodyA, B = this.bodyB;
    _v.copy(this.la).applyQuaternion(A.quaternion).add(A.position);
    _w.copy(this.lb).applyQuaternion(B.quaternion).add(B.position);
    return _v.distanceTo(_w);
  }

  /** @param {number} h  substep length in seconds */
  prepare(h) {
    const A = this.bodyA, B = this.bodyB;
    this._h = h;
    this.ra.copy(this.la).applyQuaternion(A.quaternion);
    this.rb.copy(this.lb).applyQuaternion(B.quaternion);
    const ra = this.ra, rb = this.rb, K = _K2, im = A.invMass + B.invMass;
    K.fill(0); K[0] = K[4] = K[8] = im;
    addSIS(ra.x, ra.y, ra.z, A.iw, -1, K);
    addSIS(rb.x, rb.y, rb.z, B.iw, -1, K);
    invert3(K, this.Kinv);
    // position error -> bias velocity
    const ex = B.position.x + rb.x - A.position.x - ra.x, ey = B.position.y + rb.y - A.position.y - ra.y, ez = B.position.z + rb.z - A.position.z - ra.z;
    const k = this.baumgarte / h, l = Math.hypot(ex, ey, ez), s = l * k > this.maxBias ? this.maxBias / l : k;
    this.bias.set(ex * s, ey * s, ez * s);
    // angular limits
    this._prepareLimits(h);
    if (this.friction > 0) {
      K.fill(0);
      for (let i = 0; i < 9; i++) K[i] = A.iw[i] + B.iw[i];
      invert3(K, this.Kf);
    }
  }

  _prepareLimits() {
    this._lim = null;
    if (this.useCone || this.useTwist) this._measure(this.useCone, this.useTwist);
  }

  _measure(swing, twist) {
    const A = this.bodyA, B = this.bodyB;
    if (swing) {
      _a.copy(this.axisA).applyQuaternion(A.quaternion); _b.copy(this.axisB).applyQuaternion(B.quaternion);
      this.swing = Math.acos(Math.min(1, Math.max(-1, _a.dot(_b))));
    }
    if (twist) {
      // rotation of b away from its neutral pose, in a's frame: d = (qa^-1 qb) rest^-1
      _q.copy(A.quaternion).invert().multiply(B.quaternion).multiply(this.restInv);
      let dw = _q.w, dx = _q.x, dy = _q.y, dz = _q.z;
      if (dw < 0) { dw = -dw; dx = -dx; dy = -dy; dz = -dz; }
      this.twist = 2 * Math.atan2(dx * this.axisA.x + dy * this.axisA.y + dz * this.axisA.z, dw);
    }
  }

  /**
   * The swing and twist (radians) of the bodies relative to the neutral pose right now: `{ swing, twist }` (a HingeJoint reports `{ angle }`).
   * @returns {{ swing?: number, twist?: number, angle?: number }}
   */
  measure() { this._measure(true, true); return { swing: this.swing, twist: this.twist }; }

  /**
   * Sets the limits (radians). A HingeJoint takes `{ min, max }` instead.
   * @param {BallLimits & { min?: number, max?: number }} [limits]
   */
  setLimits({ coneAngle = this.coneAngle, twistMin = this.twistMin, twistMax = this.twistMax } = {}) {
    this.coneAngle = coneAngle; this.twistMin = twistMin; this.twistMax = twistMax;
    this.useCone = coneAngle < Math.PI - 1e-6;
    this.useTwist = twistMin > -Math.PI + 1e-6 || twistMax < Math.PI - 1e-6;
  }

  warmStart() {
    const A = this.bodyA, B = this.bodyB, P = this.P, ra = this.ra, rb = this.rb;
    linAdd(A, P.x, P.y, P.z, -1); angAdd(A, ra.y * P.z - ra.z * P.y, ra.z * P.x - ra.x * P.z, ra.x * P.y - ra.y * P.x, -1);
    linAdd(B, P.x, P.y, P.z, 1); angAdd(B, rb.y * P.z - rb.z * P.y, rb.z * P.x - rb.x * P.z, rb.x * P.y - rb.y * P.x, 1);
    if (this.friction > 0) { angAdd(A, this.F.x, this.F.y, this.F.z, -1); angAdd(B, this.F.x, this.F.y, this.F.z, 1); }
    this.coneAcc = 0; this.twLo = 0; this.twHi = 0;
  }

  /** One velocity iteration. `useBias` is false during the world's relax pass. */
  solve(useBias) {
    this._solvePoint(useBias);
    this._solveLimits(useBias);
    if (this.friction > 0) this._solveFriction();
  }

  _solvePoint(useBias) {
    const A = this.bodyA, B = this.bodyB, va = A.linearVelocity, wa = A.angularVelocity, vb = B.linearVelocity, wb = B.angularVelocity, ra = this.ra, rb = this.rb;
    let cx = vb.x + (wb.y * rb.z - wb.z * rb.y) - va.x - (wa.y * ra.z - wa.z * ra.y);
    let cy = vb.y + (wb.z * rb.x - wb.x * rb.z) - va.y - (wa.z * ra.x - wa.x * ra.z);
    let cz = vb.z + (wb.x * rb.y - wb.y * rb.x) - va.z - (wa.x * ra.y - wa.y * ra.x);
    if (useBias) { cx += this.bias.x; cy += this.bias.y; cz += this.bias.z; }
    const K = this.Kinv;
    const lx = -(K[0] * cx + K[1] * cy + K[2] * cz), ly = -(K[3] * cx + K[4] * cy + K[5] * cz), lz = -(K[6] * cx + K[7] * cy + K[8] * cz);
    this.P.x += lx; this.P.y += ly; this.P.z += lz;
    linAdd(A, lx, ly, lz, -1); angAdd(A, ra.y * lz - ra.z * ly, ra.z * lx - ra.x * lz, ra.x * ly - ra.y * lx, -1);
    linAdd(B, lx, ly, lz, 1); angAdd(B, rb.y * lz - rb.z * ly, rb.z * lx - rb.x * lz, rb.x * ly - rb.y * lx, 1);
  }

  /**
   * One angular row about world axis u: drives (wB - wA).u + bias to zero with the accumulated impulse in [lo, hi].
   * Returns the new accumulated impulse.
   */
  _row(ux, uy, uz, bias, lo, hi, acc) {
    const A = this.bodyA, B = this.bodyB, IA = A.iw, IB = B.iw, wa = A.angularVelocity, wb = B.angularVelocity;
    const iax = IA[0] * ux + IA[1] * uy + IA[2] * uz, iay = IA[3] * ux + IA[4] * uy + IA[5] * uz, iaz = IA[6] * ux + IA[7] * uy + IA[8] * uz;
    const ibx = IB[0] * ux + IB[1] * uy + IB[2] * uz, iby = IB[3] * ux + IB[4] * uy + IB[5] * uz, ibz = IB[6] * ux + IB[7] * uy + IB[8] * uz;
    const k = ux * (iax + ibx) + uy * (iay + iby) + uz * (iaz + ibz);
    if (k < 1e-12) return acc;
    const cdot = (wb.x - wa.x) * ux + (wb.y - wa.y) * uy + (wb.z - wa.z) * uz;
    let l = -(cdot + bias) / k;
    const na = Math.min(hi, Math.max(lo, acc + l)); l = na - acc;
    wa.x -= iax * l; wa.y -= iay * l; wa.z -= iaz * l;
    wb.x += ibx * l; wb.y += iby * l; wb.z += ibz * l;
    return na;
  }

  /** bias for a one-sided limit on angle value `x` against `limit` (positive = past the limit when upper). */
  _limitBias(excess, h, useBias) {
    // excess > 0: violated. Speculative when slightly inside so a fast joint cannot overshoot in one substep.
    return excess > 0 ? (useBias ? this.baumgarte / h * Math.min(excess, 0.5) : 0) : excess / h;
  }

  _solveLimits(useBias) {
    const A = this.bodyA, h = this._h;
    if (this.useCone && this.swing > this.coneAngle - 0.3) {
      _a.copy(this.axisA).applyQuaternion(A.quaternion); _b.copy(this.axisB).applyQuaternion(this.bodyB.quaternion);
      _u.copy(_a).cross(_b);
      let l = _u.length();
      if (l < 1e-6) { _u.set(Math.abs(_a.x) < 0.9 ? 1 : 0, Math.abs(_a.x) < 0.9 ? 0 : 1, 0).cross(_a); l = _u.length(); }
      _u.multiplyScalar(1 / l);
      this.coneAcc = this._row(_u.x, _u.y, _u.z, this._limitBias(this.swing - this.coneAngle, h, useBias), -Infinity, 0, this.coneAcc);
    }
    if (this.useTwist) {
      _u.copy(this.axisA).applyQuaternion(A.quaternion);
      if (this.twist > this.twistMax - 0.3) this.twHi = this._row(_u.x, _u.y, _u.z, this._limitBias(this.twist - this.twistMax, h, useBias), -Infinity, 0, this.twHi);
      if (this.twist < this.twistMin + 0.3) this.twLo = this._row(_u.x, _u.y, _u.z, -this._limitBias(this.twistMin - this.twist, h, useBias), 0, Infinity, this.twLo);
    }
  }

  _solveFriction() {
    const A = this.bodyA, B = this.bodyB, wa = A.angularVelocity, wb = B.angularVelocity, K = this.Kf;
    const cx = wb.x - wa.x, cy = wb.y - wa.y, cz = wb.z - wa.z;
    let lx = -(K[0] * cx + K[1] * cy + K[2] * cz), ly = -(K[3] * cx + K[4] * cy + K[5] * cz), lz = -(K[6] * cx + K[7] * cy + K[8] * cz);
    const F = this.F, max = this.friction * this._h;
    let nx = F.x + lx, ny = F.y + ly, nz = F.z + lz;
    const n = Math.hypot(nx, ny, nz);
    if (n > max) { const s = max / n; nx *= s; ny *= s; nz *= s; }
    lx = nx - F.x; ly = ny - F.y; lz = nz - F.z; F.set(nx, ny, nz);
    angAdd(A, lx, ly, lz, -1); angAdd(B, lx, ly, lz, 1);
  }
}

export class HingeJoint extends BallJoint {
  /**
   * @param {RigidBody} bodyA @param {RigidBody} bodyB
   * @param {Vector3} anchor world position of the hinge
   * @param {Vector3} axis   world direction of the hinge axis
   * @param {HingeJointOptions} [o]
   */
  constructor(bodyA, bodyB, anchor, axis, { min = -Infinity, max = Infinity, friction = 0, neutral = null } = {}) {
    super(bodyA, bodyB, anchor, { axis, friction, neutral });
    this.useCone = false; this.useTwist = false;
    this.min = min; this.max = max;
    this.useAngle = min > -Math.PI * 4 || max < Math.PI * 4;
    // a reference direction perpendicular to the axis, to measure the angle with
    const ax = axis.clone().normalize();
    const ref = new Vector3(Math.abs(ax.x) < 0.9 ? 1 : 0, Math.abs(ax.x) < 0.9 ? 0 : 1, 0).cross(ax).normalize();
    _q.copy(bodyA.quaternion).invert(); _q2.copy(bodyB.quaternion).invert();
    this.refA = ref.clone().applyQuaternion(_q); this.refB = ref.clone().applyQuaternion(_q2);
    if (neutral) this.refB = this.refA.clone().applyQuaternion(_q.copy(neutral).invert());
    this.angle = this._rawAngle();          // 0 at creation unless a neutral pose says otherwise
    this._turns = 0;
    this.L = new Vector3();               // accumulated axis-alignment impulse
    this.axBias1 = 0; this.axBias2 = 0;
    this.loAcc = 0; this.hiAcc = 0;
    this.p1 = new Vector3(); this.p2 = new Vector3();
  }

  _prepareLimits(h) {
    const A = this.bodyA, B = this.bodyB;
    _a.copy(this.axisA).applyQuaternion(A.quaternion); _b.copy(this.axisB).applyQuaternion(B.quaternion);
    // two directions perpendicular to the hinge axis, and the misalignment e = a x b projected on them
    this.p1.set(Math.abs(_a.x) < 0.9 ? 1 : 0, Math.abs(_a.x) < 0.9 ? 0 : 1, 0).cross(_a).normalize();
    this.p2.copy(_a).cross(this.p1);
    _u.copy(_a).cross(_b);
    const k = this.baumgarte / h, cap = this.maxBias;
    this.axBias1 = Math.max(-cap, Math.min(cap, k * _u.dot(this.p1)));
    this.axBias2 = Math.max(-cap, Math.min(cap, k * _u.dot(this.p2)));
    // angle about the axis, unwrapped so a joint that turns past +-pi keeps counting
    this.angle += wrapPi(this._rawAngle() - wrapPi(this.angle));
  }

  /** Hinge angle (radians) from the neutral pose, in (-pi, pi]. */
  _rawAngle() {
    const A = this.bodyA, B = this.bodyB;
    _a.copy(this.axisA).applyQuaternion(A.quaternion);
    _v.copy(this.refA).applyQuaternion(A.quaternion); _w.copy(this.refB).applyQuaternion(B.quaternion);
    return Math.atan2(_u.copy(_v).cross(_w).dot(_a), _v.dot(_w));
  }

  /** Sets the angle limits (radians, relative to the neutral pose). @param {{ min?: number, max?: number }} [limits] */
  setLimits({ min = this.min, max = this.max } = {}) { this.min = min; this.max = max; this.useAngle = min > -Math.PI * 4 || max < Math.PI * 4; }

  /** The hinge angle in radians right now, relative to the neutral pose. @returns {{ angle: number }} */
  measure() { return { angle: this._rawAngle() }; }

  reset() { super.reset(); this.L.set(0, 0, 0); this.loAcc = 0; this.hiAcc = 0; }

  warmStart() {
    super.warmStart();
    angAdd(this.bodyA, this.L.x, this.L.y, this.L.z, -1); angAdd(this.bodyB, this.L.x, this.L.y, this.L.z, 1);
    this.loAcc = 0; this.hiAcc = 0;
  }

  _solveLimits(useBias) {
    const h = this._h, p1 = this.p1, p2 = this.p2;
    // keep the two axes parallel: equality rows about p1 and p2
    const wa = this.bodyA.angularVelocity, wb = this.bodyB.angularVelocity;
    for (let r = 0; r < 2; r++) {
      const p = r ? p2 : p1, bias = useBias ? (r ? this.axBias2 : this.axBias1) : 0;
      const A = this.bodyA, B = this.bodyB, IA = A.iw, IB = B.iw;
      const iax = IA[0] * p.x + IA[1] * p.y + IA[2] * p.z, iay = IA[3] * p.x + IA[4] * p.y + IA[5] * p.z, iaz = IA[6] * p.x + IA[7] * p.y + IA[8] * p.z;
      const ibx = IB[0] * p.x + IB[1] * p.y + IB[2] * p.z, iby = IB[3] * p.x + IB[4] * p.y + IB[5] * p.z, ibz = IB[6] * p.x + IB[7] * p.y + IB[8] * p.z;
      const k = p.x * (iax + ibx) + p.y * (iay + iby) + p.z * (iaz + ibz);
      if (k < 1e-12) continue;
      const cdot = (wb.x - wa.x) * p.x + (wb.y - wa.y) * p.y + (wb.z - wa.z) * p.z;
      const l = -(cdot + bias) / k;
      this.L.x += p.x * l; this.L.y += p.y * l; this.L.z += p.z * l;
      wa.x -= iax * l; wa.y -= iay * l; wa.z -= iaz * l;
      wb.x += ibx * l; wb.y += iby * l; wb.z += ibz * l;
    }
    if (!this.useAngle) return;
    _u.copy(this.axisA).applyQuaternion(this.bodyA.quaternion);
    if (this.angle > this.max - 0.3) this.hiAcc = this._row(_u.x, _u.y, _u.z, this._limitBias(this.angle - this.max, h, useBias), -Infinity, 0, this.hiAcc);
    if (this.angle < this.min + 0.3) this.loAcc = this._row(_u.x, _u.y, _u.z, -this._limitBias(this.min - this.angle, h, useBias), 0, Infinity, this.loAcc);
  }
}
