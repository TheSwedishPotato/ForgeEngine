import { Vector3, Quaternion, Matrix4 } from 'three';

// Small helpers shared by the solver. Everything writes into an `out`
// argument so the hot loops never allocate.

export const EPS = 1e-9;

/** Rotation vector (axis * angle, shortest arc) of a unit quaternion. */
export function quatToRotVec(q, out) {
  let x = q.x, y = q.y, z = q.z, w = q.w;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-7) return out.set(2 * x, 2 * y, 2 * z);
  const k = (2 * Math.atan2(s, w)) / s;
  return out.set(x * k, y * k, z * k);
}

/** Unit quaternion from a rotation vector (axis * angle). */
export function rotVecToQuat(v, out) {
  const angle = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (angle < 1e-7) return out.set(0.5 * v.x, 0.5 * v.y, 0.5 * v.z, 1).normalize();
  const s = Math.sin(0.5 * angle) / angle;
  return out.set(v.x * s, v.y * s, v.z * s, Math.cos(0.5 * angle));
}

/**
 * Swing-twist decomposition of `q` about unit axis `axis`: q = swing * twist.
 * Returns the signed twist angle; `swingOut` receives the swing quaternion.
 */
const _twist = new Quaternion();
export function swingTwist(q, axis, swingOut) {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  _twist.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  const len = Math.sqrt(_twist.x * _twist.x + _twist.y * _twist.y + _twist.z * _twist.z + _twist.w * _twist.w);
  if (len < 1e-9) {
    _twist.set(0, 0, 0, 1);
  } else {
    _twist.x /= len; _twist.y /= len; _twist.z /= len; _twist.w /= len;
  }
  // swing = q * twist^-1
  swingOut.copy(_twist).conjugate().premultiply(q);
  let angle = 2 * Math.atan2(_twist.x * axis.x + _twist.y * axis.y + _twist.z * axis.z, _twist.w);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  if (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time
 * Collision Detection 5.1.9). Writes the points into c1/c2 and returns the
 * squared distance.
 */
const _d1 = new Vector3(), _d2 = new Vector3(), _r = new Vector3();
export function closestPtSegmentSegment(p1, q1, p2, q2, c1, c2) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= EPS && e <= EPS) {
    c1.copy(p1); c2.copy(p2);
    return c1.distanceToSquared(c2);
  }
  if (a <= EPS) {
    s = 0; t = clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0; s = clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  c1.copy(p1).addScaledVector(_d1, s);
  c2.copy(p2).addScaledVector(_d2, t);
  return c1.distanceToSquared(c2);
}

/** Closest point on segment a-b to point p. */
const _ab = new Vector3();
export function closestPtPointSegment(p, a, b, out) {
  _ab.subVectors(b, a);
  const len2 = _ab.dot(_ab);
  let t = len2 > EPS ? (_r.subVectors(p, a).dot(_ab) / len2) : 0;
  t = clamp(t, 0, 1);
  return out.copy(a).addScaledVector(_ab, t);
}

/**
 * Builds the quaternion that maps the local basis vectors (localA, localB)
 * onto the world directions (worldA, worldB). worldB is orthogonalised
 * against worldA, so only worldA is matched exactly.
 */
const _m = { xa: new Vector3(), xb: new Vector3(), xc: new Vector3(), la: new Vector3(), lb: new Vector3(), lc: new Vector3() };
const _mw = new Matrix4(), _ml = new Matrix4();
export function quatFromTwoAxes(localA, localB, worldA, worldB, out) {
  const { xa, xb, xc, la, lb, lc } = _m;
  xa.copy(worldA).normalize();
  xb.copy(worldB).addScaledVector(xa, -xb.dot(xa));
  if (xb.lengthSq() < 1e-10) {
    // worldB parallel to worldA: pick any perpendicular.
    xb.set(1, 0, 0).addScaledVector(xa, -xa.x);
    if (xb.lengthSq() < 1e-6) xb.set(0, 1, 0).addScaledVector(xa, -xa.y);
  }
  xb.normalize();
  xc.crossVectors(xa, xb);
  la.copy(localA).normalize();
  lb.copy(localB).addScaledVector(la, -lb.dot(la)).normalize();
  lc.crossVectors(la, lb);
  _mw.makeBasis(xa, xb, xc);
  _ml.makeBasis(la, lb, lc).transpose();
  _mw.multiply(_ml);
  return out.setFromRotationMatrix(_mw);
}
