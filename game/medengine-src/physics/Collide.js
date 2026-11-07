/**
 * Narrow phase: contacts between a capsule (a segment `a`-`b` with a radius; a sphere is a capsule with a = b)
 * and the static shapes of a level: plane, sphere, capsule, oriented box, triangle.
 *
 * A contact is a point on the *static* surface, a normal pointing from the surface toward the capsule, and the
 * penetration depth (how far the capsule must move along the normal to just touch). They are appended to a
 * `Contacts` buffer.
 */
import { Vector3 } from '../math/core.js';

export class Contacts {
  constructor() { this.n = 0; this.d = new Float64Array(7 * 64); }
  clear() { this.n = 0; }
  add(px, py, pz, nx, ny, nz, depth) {
    const o = this.n * 7;
    if (o + 7 > this.d.length) { const g = new Float64Array(this.d.length * 2); g.set(this.d); this.d = g; }
    const d = this.d;
    d[o] = px; d[o + 1] = py; d[o + 2] = pz; d[o + 3] = nx; d[o + 4] = ny; d[o + 5] = nz; d[o + 6] = depth;
    this.n++;
  }
}

const EPS = 1e-9;
/** A capsule whose two ends coincide is a sphere (the same object, or equal values). */
const isPoint = (a, b) => a === b || (a.x === b.x && a.y === b.y && a.z === b.z);
const _p = new Vector3(), _q = new Vector3(), _r = new Vector3(), _s = new Vector3(), _t = new Vector3(), _u = new Vector3(), _v = new Vector3();

/** Parameter t in [0,1] of the point on segment a-b closest to p; the point goes to `out`. */
export function closestOnSegment(p, a, b, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > EPS ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  return t;
}

/** Closest points of segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). Returns [s, t]; points to c1, c2. */
const _st = [0, 0];
export function closestSegSeg(p1, q1, p2, q2, c1, c2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z, d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= EPS && e <= EPS) { s = t = 0; }
  else if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  c1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  c2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
  _st[0] = s; _st[1] = t;
  return _st;
}

/** Closest point on triangle abc to p (Ericson 5.1.5). */
export function closestOnTriangle(p, a, b, c, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return out.copy(a);
  const bpx = p.x - b.x, bpy = p.y - b.y, bpz = p.z - b.z;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return out.set(a.x + abx * v, a.y + aby * v, a.z + abz * v); }
  const cpx = p.x - c.x, cpy = p.y - c.y, cpz = p.z - c.z;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return out.set(a.x + acx * w, a.y + acy * w, a.z + acz * w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return out.set(b.x + (c.x - b.x) * w, b.y + (c.y - b.y) * w, b.z + (c.z - b.z) * w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return out.set(a.x + abx * v + acx * w, a.y + aby * v + acy * w, a.z + abz * v + acz * w);
}

// ---------------------------------------------------------------------------------------------------------------
// Capsule vs plane. Plane: n.x = d, solid where n.x < d; contacts at each end of the segment.

export function capsuleVsPlane(a, b, r, nx, ny, nz, d, out) {
  let dist = nx * a.x + ny * a.y + nz * a.z - d;
  if (dist < r) out.add(a.x - nx * dist, a.y - ny * dist, a.z - nz * dist, nx, ny, nz, r - dist);
  if (isPoint(a, b)) return;
  dist = nx * b.x + ny * b.y + nz * b.z - d;
  if (dist < r) out.add(b.x - nx * dist, b.y - ny * dist, b.z - nz * dist, nx, ny, nz, r - dist);
}

// Capsule vs sphere / capsule (the other is a segment c-d with radius rs; a sphere has c = d).

export function capsuleVsCapsule(a, b, r, c, d, rs, out) {
  const R = r + rs;
  closestSegSeg(a, b, c, d, _p, _q);
  let dx = _p.x - _q.x, dy = _p.y - _q.y, dz = _p.z - _q.z, dist = Math.hypot(dx, dy, dz);
  if (dist >= R) return;
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, cdx = d.x - c.x, cdy = d.y - c.y, cdz = d.z - c.z;
  const la = Math.hypot(abx, aby, abz), lc = Math.hypot(cdx, cdy, cdz);
  const cr = la > EPS && lc > EPS ? Math.hypot(aby * cdz - abz * cdy, abz * cdx - abx * cdz, abx * cdy - aby * cdx) / (la * lc) : 1;
  if (dist < EPS) {                                       // axes cross: push out along the direction perpendicular to both
    if (la > EPS && lc > EPS && cr > 1e-6) { dx = aby * cdz - abz * cdy; dy = abz * cdx - abx * cdz; dz = abx * cdy - aby * cdx; }
    else { dx = 0; dy = 1; dz = 0; }
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    out.add(_q.x + dx * rs, _q.y + dy * rs, _q.z + dz * rs, dx, dy, dz, R);
    return;
  }
  const nx = dx / dist, ny = dy / dist, nz = dz / dist;
  if (cr < 0.08 && la > EPS && lc > EPS) {
    // nearly parallel: two contacts at the ends of the overlap keep a lying capsule from rocking
    const ux = abx / la, uy = aby / la, uz = abz / la;
    const c0 = (c.x - a.x) * ux + (c.y - a.y) * uy + (c.z - a.z) * uz, c1 = (d.x - a.x) * ux + (d.y - a.y) * uy + (d.z - a.z) * uz;
    const lo = Math.max(0, Math.min(c0, c1)), hi = Math.min(la, Math.max(c0, c1));
    if (hi - lo > 1e-4) {
      for (const s of [lo, hi]) {
        const px = a.x + ux * s, py = a.y + uy * s, pz = a.z + uz * s;
        // the matching point on the other segment, then the separation there
        const t = closestOnSegment(_u.set(px, py, pz), c, d, _v); void t;
        const ex = px - _v.x, ey = py - _v.y, ez = pz - _v.z, e = Math.hypot(ex, ey, ez);
        if (e < R && e > EPS) out.add(_v.x + ex / e * rs, _v.y + ey / e * rs, _v.z + ez / e * rs, ex / e, ey / e, ez / e, R - e);
      }
      return;
    }
  }
  out.add(_q.x + nx * rs, _q.y + ny * rs, _q.z + nz * rs, nx, ny, nz, R - dist);
}

// ---------------------------------------------------------------------------------------------------------------
// Capsule vs oriented box. box = { c: Vector3, h: Vector3 (half extents), q: Quaternion, qi: Quaternion }.

const _la = new Vector3(), _lb = new Vector3(), _lp = new Vector3(), _lc = new Vector3(), _ln = new Vector3();
function boxDist2(px, py, pz, h) {
  const cx = px < -h.x ? -h.x : px > h.x ? h.x : px, cy = py < -h.y ? -h.y : py > h.y ? h.y : py, cz = pz < -h.z ? -h.z : pz > h.z ? h.z : pz;
  return (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
}

function boxPoint(box, a, b, r, t, out) {
  // contact of the point at parameter t of the (local) segment _la-_lb with the box; false when apart
  const h = box.h;
  _lp.set(_la.x + (_lb.x - _la.x) * t, _la.y + (_lb.y - _la.y) * t, _la.z + (_lb.z - _la.z) * t);
  const px = _lp.x, py = _lp.y, pz = _lp.z;
  const cx = px < -h.x ? -h.x : px > h.x ? h.x : px, cy = py < -h.y ? -h.y : py > h.y ? h.y : py, cz = pz < -h.z ? -h.z : pz > h.z ? h.z : pz;
  const dx = px - cx, dy = py - cy, dz = pz - cz, d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    _ln.set(dx / d, dy / d, dz / d); _lc.set(cx, cy, cz);
    out.add(...world(box, _lc), ...rotate(box, _ln), r - d);
    return true;
  }
  // the point is inside the box: leave through the nearest face
  const fx = h.x - Math.abs(px), fy = h.y - Math.abs(py), fz = h.z - Math.abs(pz);
  let depth, nx = 0, ny = 0, nz = 0, qx = px, qy = py, qz = pz;
  if (fx <= fy && fx <= fz) { depth = fx; nx = px >= 0 ? 1 : -1; qx = nx * h.x; }
  else if (fy <= fz) { depth = fy; ny = py >= 0 ? 1 : -1; qy = ny * h.y; }
  else { depth = fz; nz = pz >= 0 ? 1 : -1; qz = nz * h.z; }
  _lc.set(qx, qy, qz); _ln.set(nx, ny, nz);
  out.add(...world(box, _lc), ...rotate(box, _ln), r + depth);
  return true;
}
const _w = [0, 0, 0];
function world(box, v) { _t.copy(v).applyQuaternion(box.q).add(box.c); _w[0] = _t.x; _w[1] = _t.y; _w[2] = _t.z; return _w; }
const _rw = [0, 0, 0];
function rotate(box, v) { _s.copy(v).applyQuaternion(box.q); _rw[0] = _s.x; _rw[1] = _s.y; _rw[2] = _s.z; return _rw; }

export function capsuleVsBox(a, b, r, box, out) {
  _la.copy(a).sub(box.c).applyQuaternion(box.qi);
  _lb.copy(b).sub(box.c).applyQuaternion(box.qi);
  const h = box.h;
  // cheap reject against the box grown by the radius
  const mnx = Math.min(_la.x, _lb.x), mxx = Math.max(_la.x, _lb.x), mny = Math.min(_la.y, _lb.y), mxy = Math.max(_la.y, _lb.y), mnz = Math.min(_la.z, _lb.z), mxz = Math.max(_la.z, _lb.z);
  if (mxx < -h.x - r || mnx > h.x + r || mxy < -h.y - r || mny > h.y + r || mxz < -h.z - r || mnz > h.z + r) return;
  const f = (t) => boxDist2(_la.x + (_lb.x - _la.x) * t, _la.y + (_lb.y - _la.y) * t, _la.z + (_lb.z - _la.z) * t, h);
  let lo = 0, hi = 1;
  for (let i = 0; i < 28; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (f(m1) < f(m2)) hi = m2; else lo = m1; }
  let t = (lo + hi) / 2;
  if (f(t) < 1e-12) {
    // the segment passes through the box: use the deepest point
    let best = -1;
    for (let i = 0; i <= 16; i++) {
      const s = i / 16, px = _la.x + (_lb.x - _la.x) * s, py = _la.y + (_lb.y - _la.y) * s, pz = _la.z + (_lb.z - _la.z) * s;
      const depth = Math.min(h.x - Math.abs(px), h.y - Math.abs(py), h.z - Math.abs(pz));
      if (depth > best) { best = depth; t = s; }
    }
  }
  boxPoint(box, a, b, r, t, out);
  // a capsule lying on a face touches along its length: add the ends so it does not rock
  if (!isPoint(a, b) && lo !== hi) {
    if (t > 0.15) boxPoint(box, a, b, r, 0, out);
    if (t < 0.85) boxPoint(box, a, b, r, 1, out);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Capsule vs triangle. `n` (optional) is the triangle's unit normal. `twoSided` lets the capsule be pushed out
// of either face, which is what a mesh with unreliable winding needs.

const _n = new Vector3(), _cp = new Vector3(), _ct = new Vector3(), _bs = new Vector3(), _bt = new Vector3();
function pointInTriangle(p, a, b, c, n) {
  const d = (u, v, w) => { _u.copy(v).sub(u); _v.copy(w).sub(u); return _u.cross(_v).dot(n); };
  return d(a, b, p) >= -1e-9 && d(b, c, p) >= -1e-9 && d(c, a, p) >= -1e-9;
}

export function capsuleVsTriangle(a, b, r, v0, v1, v2, out, twoSided = true) {
  _u.copy(v1).sub(v0); _v.copy(v2).sub(v0);
  _n.copy(_u).cross(_v);
  const nl = _n.length();
  if (nl < 1e-12) return;
  _n.multiplyScalar(1 / nl);
  const da = _p.copy(a).sub(v0).dot(_n), db = _q.copy(b).sub(v0).dot(_n);
  // quick reject: both ends farther than r on the same side
  if ((da > r && db > r) || (da < -r && db < -r)) return;
  if (!twoSided && da < -r && db < -r) return;
  let best = Infinity, crossing = false;
  if (da * db <= 0 && da !== db) {
    const t = da / (da - db);
    _cp.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    if (pointInTriangle(_cp, v0, v1, v2, _n)) { crossing = true; best = 0; _bs.copy(_cp); _bt.copy(_cp); }
  }
  if (!crossing) {
    const consider = (s, t) => { const d2 = s.distanceToSquared(t); if (d2 < best) { best = d2; _bs.copy(s); _bt.copy(t); } };
    closestOnTriangle(a, v0, v1, v2, _ct); consider(a, _ct);
    if (!isPoint(a, b)) { closestOnTriangle(b, v0, v1, v2, _ct); consider(b, _ct); }
    closestSegSeg(a, b, v0, v1, _p, _q); consider(_p, _q);
    closestSegSeg(a, b, v1, v2, _p, _q); consider(_p, _q);
    closestSegSeg(a, b, v2, v0, _p, _q); consider(_p, _q);
    best = Math.sqrt(best);
    if (best >= r) return;
  }
  if (crossing || best < 1e-6) {
    // the capsule's axis touches the triangle: push out of the face on the side that needs less movement
    const outward = Math.min(da, db), inward = Math.max(da, db);
    const up = r - outward, down = r + inward;                    // distance to clear along +n / along -n
    if (!twoSided || up <= down) out.add(_bt.x, _bt.y, _bt.z, _n.x, _n.y, _n.z, up);
    else out.add(_bt.x, _bt.y, _bt.z, -_n.x, -_n.y, -_n.z, down);
    return;
  }
  const nx = (_bs.x - _bt.x) / best, ny = (_bs.y - _bt.y) / best, nz = (_bs.z - _bt.z) / best;
  if (!twoSided && nx * _n.x + ny * _n.y + nz * _n.z < -0.01) return;       // behind a one-sided face
  out.add(_bt.x, _bt.y, _bt.z, nx, ny, nz, r - best);
  // a capsule lying flat on a face touches at both ends
  if (!isPoint(a, b)) { endContact(a, v0, v1, v2, r, out); endContact(b, v0, v1, v2, r, out); }
}
function endContact(e, v0, v1, v2, r, out) {
  closestOnTriangle(e, v0, v1, v2, _ct);
  const dd = e.distanceTo(_ct);
  if (dd < r && dd > 1e-6 && e.distanceTo(_bs) > r * 0.5) out.add(_ct.x, _ct.y, _ct.z, (e.x - _ct.x) / dd, (e.y - _ct.y) / dd, (e.z - _ct.z) / dd, r - dd);
}

// ---------------------------------------------------------------------------------------------------------------
// Rays

/** Ray vs triangle (Moller-Trumbore). Returns the distance or -1. */
export function rayTriangle(ox, oy, oz, dx, dy, dz, v0, v1, v2, maxT, twoSided = true) {
  const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z, e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (twoSided ? Math.abs(det) < 1e-12 : det < 1e-12) return -1;
  const inv = 1 / det, tx = ox - v0.x, ty = oy - v0.y, tz = oz - v0.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 && t <= maxT ? t : -1;
}

/** Ray vs oriented box. Returns { t, nx, ny, nz } in `out` or false. */
export function rayBox(ox, oy, oz, dx, dy, dz, box, maxT, out) {
  _p.set(ox, oy, oz).sub(box.c).applyQuaternion(box.qi);
  _q.set(dx, dy, dz).applyQuaternion(box.qi);
  let tmin = 0, tmax = maxT, nAxis = -1, nSign = 1;
  const h = box.h, o = [_p.x, _p.y, _p.z], d = [_q.x, _q.y, _q.z], hh = [h.x, h.y, h.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < -hh[i] || o[i] > hh[i]) return false; continue; }
    let t1 = (-hh[i] - o[i]) / d[i], t2 = (hh[i] - o[i]) / d[i], s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = i; nSign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  out.t = tmin;
  _s.set(nAxis === 0 ? nSign : 0, nAxis === 1 ? nSign : 0, nAxis === 2 ? nSign : 0).applyQuaternion(box.q);
  if (nAxis < 0) _s.set(-dx, -dy, -dz).normalize();
  out.nx = _s.x; out.ny = _s.y; out.nz = _s.z;
  return true;
}

/** Ray vs sphere. Returns distance or -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, c, r, maxT) {
  const mx = ox - c.x, my = oy - c.y, mz = oz - c.z;
  const b = mx * dx + my * dy + mz * dz, cc = mx * mx + my * my + mz * mz - r * r;
  if (cc > 0 && b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = Math.max(0, -b - Math.sqrt(disc));
  return t <= maxT ? t : -1;
}

/** Ray vs capsule (segment c-d, radius r): the nearest of the two caps and the cylinder. Returns distance or -1. */
export function rayCapsule(ox, oy, oz, dx, dy, dz, c, d, r, maxT) {
  const bx = d.x - c.x, by = d.y - c.y, bz = d.z - c.z, bl2 = bx * bx + by * by + bz * bz;
  let best = -1;
  const keep = (t) => { if (t >= 0 && (best < 0 || t < best)) best = t; };
  keep(raySphere(ox, oy, oz, dx, dy, dz, c, r, maxT)); keep(raySphere(ox, oy, oz, dx, dy, dz, d, r, maxT));
  if (bl2 > EPS) {
    // infinite cylinder around the axis, clipped to the segment
    const mx = ox - c.x, my = oy - c.y, mz = oz - c.z;
    const md = mx * bx + my * by + mz * bz, nd = dx * bx + dy * by + dz * bz;
    const a = bl2 - nd * nd / 1, b = bl2 * (mx * dx + my * dy + mz * dz) - md * nd, cc = bl2 * (mx * mx + my * my + mz * mz - r * r) - md * md;
    const A = a, B = b, C = cc;
    if (Math.abs(A) > 1e-12) {
      const disc = B * B - A * C;
      if (disc >= 0) {
        const t = (-B - Math.sqrt(disc)) / A;
        if (t >= 0 && t <= maxT) { const s = md + t * nd; if (s >= 0 && s <= bl2) keep(t); }
      }
    }
  }
  return best;
}
