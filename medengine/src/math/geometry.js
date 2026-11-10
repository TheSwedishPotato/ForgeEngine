/**
 * Bounding volumes and rays: Box3, Sphere, Plane, Ray, Triangle helpers, Frustum.
 * Depends only on ./core.js.
 */
import { Vector3, Matrix4, Matrix3 } from './core.js';

/**
 * What a bounding volume reads from a geometry (a scene BufferGeometry has all of it).
 * @typedef {object} BoundsGeometry
 * @property {{ position?: { count: number, getX(i: number): number, getY(i: number): number, getZ(i: number): number } }} [attributes]
 * @property {Box3 | null} boundingBox
 * @property {Sphere | null} boundingSphere
 * @property {() => void} computeBoundingBox
 * @property {() => void} computeBoundingSphere
 */

/**
 * What a bounding volume reads from a scene object (an Object3D or a Mesh has all of it): a world matrix, children, maybe a geometry.
 * @typedef {object} BoundsObject
 * @property {BoundsGeometry | null} [geometry]
 * @property {Matrix4} matrixWorld
 * @property {BoundsObject[]} children
 * @property {(updateParents: boolean, updateChildren: boolean) => void} updateWorldMatrix
 */

const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3();
const _m = new Matrix4();

// ---------------------------------------------------------------------------
// Box3

export class Box3 {
  constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min; this.max = max;
  }
  get isBox3() { return true; }
  /**
   * @param {Vector3} min
   * @param {Vector3} max
   */
  set(min, max) { this.min.copy(min); this.max.copy(max); return this; }
  /** @param {Iterable<Vector3>} points */
  setFromPoints(points) { this.makeEmpty(); for (const p of points) this.expandByPoint(p); return this; }
  /**
   * From a flat xyz array (stride 3), optionally transformed by a matrix.
   * @param {ArrayLike<number>} array
   * @param {Matrix4 | null} [matrix]
   */
  setFromArray(array, stride = 3, matrix = null) {
    this.makeEmpty();
    for (let i = 0; i + 2 < array.length; i += stride) {
      _v1.set(array[i], array[i + 1], array[i + 2]);
      if (matrix) _v1.applyMatrix4(matrix);
      this.expandByPoint(_v1);
    }
    return this;
  }
  /**
   * @param {Vector3} center
   * @param {Vector3} size
   */
  setFromCenterAndSize(center, size) { const h = _v1.copy(size).multiplyScalar(0.5); this.min.copy(center).sub(h); this.max.copy(center).add(h); return this; }
  clone() { return new Box3().copy(this); }
  /** @param {Box3} b */
  copy(b) { this.min.copy(b.min); this.max.copy(b.max); return this; }
  makeEmpty() { this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); return this; }
  isEmpty() { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }
  getCenter(t = new Vector3()) { return this.isEmpty() ? t.set(0, 0, 0) : t.addVectors(this.min, this.max).multiplyScalar(0.5); }
  getSize(t = new Vector3()) { return this.isEmpty() ? t.set(0, 0, 0) : t.subVectors(this.max, this.min); }
  /** @param {Vector3} p */
  expandByPoint(p) { this.min.min(p); this.max.max(p); return this; }
  /** @param {Vector3} v */
  expandByVector(v) { this.min.sub(v); this.max.add(v); return this; }
  /** @param {number} s */
  expandByScalar(s) { this.min.addScalar(-s); this.max.addScalar(s); return this; }
  /**
   * Grows to include a scene object and its descendants (world space), using their geometry bounds.
   * @param {BoundsObject} object
   * @param {boolean} [precise]
   */
  expandByObject(object, precise = false) {
    object.updateWorldMatrix(false, false);
    const g = object.geometry;
    if (g) {
      if (precise && g.attributes?.position) {
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) { _v1.fromBufferAttribute(pos, i).applyMatrix4(object.matrixWorld); this.expandByPoint(_v1); }
      } else {
        if (!g.boundingBox) g.computeBoundingBox();
        if (g.boundingBox && !g.boundingBox.isEmpty()) _box.copy(g.boundingBox).applyMatrix4(object.matrixWorld), this.union(_box);
      }
    }
    for (const c of object.children) this.expandByObject(c, precise);
    return this;
  }
  /**
   * @param {BoundsObject} object
   * @param {boolean} [precise]
   */
  setFromObject(object, precise = false) { this.makeEmpty(); return this.expandByObject(object, precise); }
  /** @param {Vector3} p */
  containsPoint(p) { return !(p.x < this.min.x || p.x > this.max.x || p.y < this.min.y || p.y > this.max.y || p.z < this.min.z || p.z > this.max.z); }
  /** @param {Box3} b */
  containsBox(b) { return this.min.x <= b.min.x && b.max.x <= this.max.x && this.min.y <= b.min.y && b.max.y <= this.max.y && this.min.z <= b.min.z && b.max.z <= this.max.z; }
  /** @param {Box3} b */
  intersectsBox(b) { return !(b.max.x < this.min.x || b.min.x > this.max.x || b.max.y < this.min.y || b.min.y > this.max.y || b.max.z < this.min.z || b.min.z > this.max.z); }
  /** @param {Sphere} s */
  intersectsSphere(s) { this.clampPoint(s.center, _v1); return _v1.distanceToSquared(s.center) <= s.radius * s.radius; }
  /** @param {Plane} pl */
  intersectsPlane(pl) {
    let min = 0, max = 0;
    if (pl.normal.x > 0) { min = pl.normal.x * this.min.x; max = pl.normal.x * this.max.x; } else { min = pl.normal.x * this.max.x; max = pl.normal.x * this.min.x; }
    if (pl.normal.y > 0) { min += pl.normal.y * this.min.y; max += pl.normal.y * this.max.y; } else { min += pl.normal.y * this.max.y; max += pl.normal.y * this.min.y; }
    if (pl.normal.z > 0) { min += pl.normal.z * this.min.z; max += pl.normal.z * this.max.z; } else { min += pl.normal.z * this.max.z; max += pl.normal.z * this.min.z; }
    return min <= -pl.constant && max >= -pl.constant;
  }
  /** @param {Vector3} p */
  clampPoint(p, t = new Vector3()) { return t.copy(p).clamp(this.min, this.max); }
  /** @param {Vector3} p */
  distanceToPoint(p) { return this.clampPoint(p, _v1).distanceTo(p); }
  getBoundingSphere(t = new Sphere()) {
    if (this.isEmpty()) return t.makeEmpty();
    this.getCenter(t.center); t.radius = this.getSize(_v1).length() * 0.5; return t;
  }
  /** @param {Box3} b */
  intersect(b) { this.min.max(b.min); this.max.min(b.max); if (this.isEmpty()) this.makeEmpty(); return this; }
  /** @param {Box3} b */
  union(b) { this.min.min(b.min); this.max.max(b.max); return this; }
  /**
   * Transforms the box by a matrix and re-fits an axis-aligned box around the result.
   * @param {Matrix4} m
   */
  applyMatrix4(m) {
    if (this.isEmpty()) return this;
    const { min, max } = this, e = m.elements;
    // Arvo's method: per-axis min/max of each matrix column's contribution
    let x0 = e[12], x1 = e[12], y0 = e[13], y1 = e[13], z0 = e[14], z1 = e[14];
    /** @type {[number, 'x' | 'y' | 'z'][]} */
    const axes = [[0, 'x'], [4, 'y'], [8, 'z']];
    for (const [c, ax] of axes) {
      const lo = min[ax], hi = max[ax];
      let a = e[c] * lo, b = e[c] * hi; x0 += Math.min(a, b); x1 += Math.max(a, b);
      a = e[c + 1] * lo; b = e[c + 1] * hi; y0 += Math.min(a, b); y1 += Math.max(a, b);
      a = e[c + 2] * lo; b = e[c + 2] * hi; z0 += Math.min(a, b); z1 += Math.max(a, b);
    }
    min.set(x0, y0, z0); max.set(x1, y1, z1);
    return this;
  }
  /** @param {Vector3} o */
  translate(o) { this.min.add(o); this.max.add(o); return this; }
  /** @param {Box3} b */
  equals(b) { return b.min.equals(this.min) && b.max.equals(this.max); }
}
const _box = new Box3();

// ---------------------------------------------------------------------------
// Sphere

export class Sphere {
  constructor(center = new Vector3(), radius = -1) { this.center = center; this.radius = radius; }
  get isSphere() { return true; }
  /**
   * @param {Vector3} c
   * @param {number} r
   */
  set(c, r) { this.center.copy(c); this.radius = r; return this; }
  /**
   * @param {Iterable<Vector3>} points
   * @param {Vector3} [optionalCenter]
   */
  setFromPoints(points, optionalCenter) {
    const c = this.center;
    if (optionalCenter) c.copy(optionalCenter);
    else new Box3().setFromPoints(points).getCenter(c);
    let max = 0;
    for (const p of points) max = Math.max(max, c.distanceToSquared(p));
    this.radius = Math.sqrt(max);
    return this;
  }
  clone() { return new Sphere().copy(this); }
  /** @param {Sphere} s */
  copy(s) { this.center.copy(s.center); this.radius = s.radius; return this; }
  isEmpty() { return this.radius < 0; }
  makeEmpty() { this.center.set(0, 0, 0); this.radius = -1; return this; }
  /** @param {Vector3} p */
  containsPoint(p) { return p.distanceToSquared(this.center) <= this.radius * this.radius; }
  /** @param {Vector3} p */
  distanceToPoint(p) { return p.distanceTo(this.center) - this.radius; }
  /** @param {Sphere} s */
  intersectsSphere(s) { const r = this.radius + s.radius; return s.center.distanceToSquared(this.center) <= r * r; }
  /** @param {Box3} b */
  intersectsBox(b) { return b.intersectsSphere(this); }
  /** @param {Plane} pl */
  intersectsPlane(pl) { return Math.abs(pl.distanceToPoint(this.center)) <= this.radius; }
  /** @param {Vector3} p */
  expandByPoint(p) {
    if (this.isEmpty()) { this.center.copy(p); this.radius = 0; return this; }
    _v1.subVectors(p, this.center);
    const l2 = _v1.lengthSq();
    if (l2 > this.radius * this.radius) {
      const l = Math.sqrt(l2), d = (l - this.radius) * 0.5;
      this.center.addScaledVector(_v1, d / l); this.radius += d;
    }
    return this;
  }
  /** @param {Sphere} s */
  union(s) {
    if (s.isEmpty()) return this;
    if (this.isEmpty()) return this.copy(s);
    if (this.center.equals(s.center)) { this.radius = Math.max(this.radius, s.radius); return this; }
    _v2.subVectors(s.center, this.center).setLength(s.radius);
    this.expandByPoint(_v3.copy(s.center).add(_v2));
    this.expandByPoint(_v3.copy(s.center).sub(_v2));
    return this;
  }
  /** @param {Matrix4} m */
  applyMatrix4(m) { this.center.applyMatrix4(m); this.radius *= m.getMaxScaleOnAxis(); return this; }
  /** @param {Vector3} o */
  translate(o) { this.center.add(o); return this; }
  /** @param {Sphere} s */
  equals(s) { return s.center.equals(this.center) && s.radius === this.radius; }
}

// ---------------------------------------------------------------------------
// Plane: normal . p + constant = 0, the normal points to the positive (inside) side.

export class Plane {
  constructor(normal = new Vector3(1, 0, 0), constant = 0) { this.normal = normal; this.constant = constant; }
  get isPlane() { return true; }
  /**
   * @param {Vector3} n
   * @param {number} c
   */
  set(n, c) { this.normal.copy(n); this.constant = c; return this; }
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} w
   */
  setComponents(x, y, z, w) { this.normal.set(x, y, z); this.constant = w; return this; }
  /**
   * @param {Vector3} n
   * @param {Vector3} p
   */
  setFromNormalAndCoplanarPoint(n, p) { this.normal.copy(n); this.constant = -p.dot(n); return this; }
  /**
   * @param {Vector3} a
   * @param {Vector3} b
   * @param {Vector3} c
   */
  setFromCoplanarPoints(a, b, c) {
    const n = _v1.subVectors(c, b).cross(_v2.subVectors(a, b)).normalize();
    return this.setFromNormalAndCoplanarPoint(n, a);
  }
  clone() { return new Plane().copy(this); }
  /** @param {Plane} p */
  copy(p) { this.normal.copy(p.normal); this.constant = p.constant; return this; }
  normalize() { const i = 1 / this.normal.length(); this.normal.multiplyScalar(i); this.constant *= i; return this; }
  negate() { this.constant *= -1; this.normal.negate(); return this; }
  /** @param {Vector3} p */
  distanceToPoint(p) { return this.normal.dot(p) + this.constant; }
  /** @param {Sphere} s */
  distanceToSphere(s) { return this.distanceToPoint(s.center) - s.radius; }
  /** @param {Vector3} p */
  projectPoint(p, t = new Vector3()) { return t.copy(p).addScaledVector(this.normal, -this.distanceToPoint(p)); }
  coplanarPoint(t = new Vector3()) { return t.copy(this.normal).multiplyScalar(-this.constant); }
  /**
   * @param {Vector3} a
   * @param {Vector3} b
   */
  intersectLine(a, b, t = new Vector3()) {
    const dir = _v1.subVectors(b, a), den = this.normal.dot(dir);
    if (den === 0) return this.distanceToPoint(a) === 0 ? t.copy(a) : null;
    const u = -(a.dot(this.normal) + this.constant) / den;
    if (u < 0 || u > 1) return null;
    return t.copy(a).addScaledVector(dir, u);
  }
  /**
   * @param {Matrix4} m
   * @param {Matrix3} [normalMatrix]
   */
  applyMatrix4(m, normalMatrix) {
    const nm = normalMatrix || new Matrix3().getNormalMatrix(m);
    const ref = this.coplanarPoint(_v1).applyMatrix4(m);
    this.normal.applyMatrix3(nm).normalize();
    this.constant = -ref.dot(this.normal);
    return this;
  }
}

// ---------------------------------------------------------------------------
// Ray

export class Ray {
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) { this.origin = origin; this.direction = direction; }
  /**
   * @param {Vector3} o
   * @param {Vector3} d
   */
  set(o, d) { this.origin.copy(o); this.direction.copy(d); return this; }
  clone() { return new Ray().copy(this); }
  /** @param {Ray} r */
  copy(r) { this.origin.copy(r.origin); this.direction.copy(r.direction); return this; }
  /** @param {number} t */
  at(t, target = new Vector3()) { return target.copy(this.origin).addScaledVector(this.direction, t); }
  /** @param {Vector3} v */
  lookAt(v) { this.direction.copy(v).sub(this.origin).normalize(); return this; }
  /** @param {Vector3} p */
  distanceSqToPoint(p) {
    const t = _v1.subVectors(p, this.origin).dot(this.direction);
    if (t < 0) return this.origin.distanceToSquared(p);
    _v1.copy(this.origin).addScaledVector(this.direction, t);
    return _v1.distanceToSquared(p);
  }
  /** @param {Sphere} s */
  intersectSphere(s, target = new Vector3()) {
    _v1.subVectors(s.center, this.origin);
    const tca = _v1.dot(this.direction), d2 = _v1.dot(_v1) - tca * tca, r2 = s.radius * s.radius;
    if (d2 > r2) return null;
    const thc = Math.sqrt(r2 - d2), t0 = tca - thc, t1 = tca + thc;
    if (t1 < 0) return null;
    return this.at(t0 < 0 ? t1 : t0, target);
  }
  /** @param {Plane} pl */
  intersectPlane(pl, target = new Vector3()) {
    const t = this.distanceToPlane(pl);
    return t === null ? null : this.at(t, target);
  }
  /** @param {Plane} pl */
  distanceToPlane(pl) {
    const den = pl.normal.dot(this.direction);
    if (den === 0) return pl.distanceToPoint(this.origin) === 0 ? 0 : null;
    const t = -(this.origin.dot(pl.normal) + pl.constant) / den;
    return t >= 0 ? t : null;
  }
  /**
   * Slab test; returns the hit point or null. `distanceToBox` gives t instead.
   * @param {Box3} box
   */
  intersectBox(box, target = new Vector3()) {
    const t = this.distanceToBox(box);
    return t === null ? null : this.at(t, target);
  }
  /** @param {Box3} box */
  distanceToBox(box) {
    const o = this.origin, d = this.direction;
    let tmin = -Infinity, tmax = Infinity;
    for (const a of /** @type {('x' | 'y' | 'z')[]} */ (['x', 'y', 'z'])) {
      const inv = 1 / d[a];
      let t0 = (box.min[a] - o[a]) * inv, t1 = (box.max[a] - o[a]) * inv;
      if (inv < 0) [t0, t1] = [t1, t0];
      if (t0 > tmin) tmin = t0;
      if (t1 < tmax) tmax = t1;
      if (tmin > tmax || tmax < 0) return null;
    }
    return tmin >= 0 ? tmin : tmax;
  }
  /**
   * Moller-Trumbore; returns t or null.
   * @param {Vector3} a
   * @param {Vector3} b
   * @param {Vector3} c
   */
  intersectTriangleT(a, b, c, backfaceCulling = false) {
    const e1 = _v1.subVectors(b, a), e2 = _v2.subVectors(c, a), n = _v3.crossVectors(e1, e2);
    let dn = this.direction.dot(n), sign;
    if (dn > 0) { if (backfaceCulling) return null; sign = 1; }
    else if (dn < 0) { sign = -1; dn = -dn; } else return null;
    _v4.subVectors(this.origin, a);
    const dq = sign * this.direction.dot(_v2.crossVectors(_v4, e2));
    if (dq < 0) return null;
    const du = sign * this.direction.dot(e1.cross(_v4));
    if (du < 0 || dq + du > dn) return null;
    const qn = -sign * _v4.dot(n);
    if (qn < 0) return null;
    return qn / dn;
  }
  /**
   * @param {Vector3} a
   * @param {Vector3} b
   * @param {Vector3} c
   * @param {boolean} [backfaceCulling]
   */
  intersectTriangle(a, b, c, backfaceCulling, target = new Vector3()) {
    const t = this.intersectTriangleT(a, b, c, backfaceCulling);
    return t === null ? null : this.at(t, target);
  }
  /** @param {Matrix4} m */
  applyMatrix4(m) { this.origin.applyMatrix4(m); this.direction.transformDirection(m); return this; }
}

// ---------------------------------------------------------------------------
// Triangle helpers (static, allocation free)

export const Triangle = {
  /**
   * Closest point on triangle abc to p (Ericson, Real-Time Collision Detection).
   * @param {Vector3} p
   * @param {Vector3} a
   * @param {Vector3} b
   * @param {Vector3} c
   * @param {Vector3} [target]  written to and returned
   */
  closestPoint(p, a, b, c, target = new Vector3()) {
    const ab = _v1.subVectors(b, a), ac = _v2.subVectors(c, a), ap = _v3.subVectors(p, a);
    const d1 = ab.dot(ap), d2 = ac.dot(ap);
    if (d1 <= 0 && d2 <= 0) return target.copy(a);
    const bp = _v4.subVectors(p, b), d3 = ab.dot(bp), d4 = ac.dot(bp);
    if (d3 >= 0 && d4 <= d3) return target.copy(b);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return target.copy(a).addScaledVector(ab, d1 / (d1 - d3));
    const cp = _v4.subVectors(p, c), d5 = ab.dot(cp), d6 = ac.dot(cp);
    if (d6 >= 0 && d5 <= d6) return target.copy(c);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return target.copy(a).addScaledVector(ac, d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return target.copy(b).addScaledVector(_v4.subVectors(c, b), w);
    }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return target.copy(a).addScaledVector(ab, v).addScaledVector(ac, w);
  },
  /**
   * The unit normal of triangle abc (counter-clockwise is the front), or zero for a degenerate triangle.
   * @param {Vector3} a
   * @param {Vector3} b
   * @param {Vector3} c
   * @param {Vector3} [target]  written to and returned
   */
  normal(a, b, c, target = new Vector3()) {
    target.subVectors(c, b).cross(_v1.subVectors(a, b));
    const l = target.lengthSq();
    return l > 0 ? target.multiplyScalar(1 / Math.sqrt(l)) : target.set(0, 0, 0);
  },
  /** @param {Vector3} a @param {Vector3} b @param {Vector3} c */
  area(a, b, c) { return _v1.subVectors(c, b).cross(_v2.subVectors(a, b)).length() * 0.5; },
};

// ---------------------------------------------------------------------------
// Frustum: six planes extracted from a view-projection matrix.
// Works for any projection with 0..1 clip depth, reversed or not (WebGPU), and for orthographic
// matrices (the shadow cascades use this too).

export class Frustum {
  constructor() { this.planes = Array.from({ length: 6 }, () => new Plane()); }
  /**
   * Rows of the clip matrix: inside means -w <= x <= w, -w <= y <= w, 0 <= z <= w.
   * @param {Matrix4} m
   */
  setFromProjectionMatrix(m) {
    const e = m.elements, p = this.planes;
    const r0 = [e[0], e[4], e[8], e[12]], r1 = [e[1], e[5], e[9], e[13]], r2 = [e[2], e[6], e[10], e[14]], r3 = [e[3], e[7], e[11], e[15]];
    const set = /** @param {Plane} pl @param {number[]} a @param {number[]} b @param {number} s */ (pl, a, b, s) => pl.setComponents(a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]).normalize();
    set(p[0], r3, r0, +1); // left   : w + x >= 0
    set(p[1], r3, r0, -1); // right  : w - x >= 0
    set(p[2], r3, r1, +1); // bottom : w + y >= 0
    set(p[3], r3, r1, -1); // top    : w - y >= 0
    set(p[4], r2, [0, 0, 0, 0], 0); // z >= 0 (near, or far when reversed)
    set(p[5], r3, r2, -1); // w - z >= 0
    return this;
  }
  clone() { const f = new Frustum(); f.planes.forEach((pl, i) => pl.copy(this.planes[i])); return f; }
  /** @param {Vector3} pt */
  containsPoint(pt) { for (const pl of this.planes) if (pl.distanceToPoint(pt) < 0) return false; return true; }
  /** @param {Sphere} s */
  intersectsSphere(s) {
    const n = -s.radius;
    for (const pl of this.planes) if (pl.distanceToPoint(s.center) < n) return false;
    return true;
  }
  /** @param {Box3} box */
  intersectsBox(box) {
    for (const pl of this.planes) {
      const { normal } = pl;
      _v1.x = normal.x > 0 ? box.max.x : box.min.x;
      _v1.y = normal.y > 0 ? box.max.y : box.min.y;
      _v1.z = normal.z > 0 ? box.max.z : box.min.z;
      if (pl.distanceToPoint(_v1) < 0) return false;
    }
    return true;
  }
  /** @param {BoundsObject} object */
  intersectsObject(object) {
    const g = object.geometry;
    if (!g) return true;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const bs = /** @type {Sphere} */ (g.boundingSphere);   // computeBoundingSphere() has set it
    if (bs.isEmpty()) return true;
    _sph.copy(bs).applyMatrix4(object.matrixWorld);
    return this.intersectsSphere(_sph);
  }
}
const _sph = new Sphere();
void _m;
