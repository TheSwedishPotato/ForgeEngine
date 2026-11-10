/**
 * Static colliders: the fixed shapes of a level. Each answers "which contacts does this capsule make with me"
 * and "where does this ray hit me". A sphere is a capsule of zero length.
 *
 *   new PlaneCollider(normal, offset)              infinite floor / wall (solid on the side opposite the normal)
 *   new BoxCollider({ center, half, rotation })    oriented box
 *   new SphereCollider(center, radius)
 *   new CapsuleCollider(a, b, radius)
 *   new MeshCollider(positions, indices, opts)     triangle soup in world space, BVH accelerated
 *   MeshCollider.fromGeometry(geometry, matrix)    from a scene Geometry and a transform
 */
import { Vector3, Quaternion } from '../math/core.js';
import { AABBTree } from './AABBTree.js';
import { capsuleVsPlane, capsuleVsCapsule, capsuleVsBox, capsuleVsTriangle, rayTriangle, rayBox, raySphere, rayCapsule } from './Collide.js';

/** @import { Contacts } from './Collide.js' */
/** @import { Matrix4 } from '../math/core.js' */
/** @import { BufferGeometry } from '../scene/Geometry.js' */

let _id = 1;
const _hit = { t: 0, nx: 0, ny: 0, nz: 0 };
const _v0 = new Vector3(), _v1 = new Vector3(), _v2 = new Vector3(), _e1 = new Vector3(), _e2 = new Vector3(), _c = new Vector3();

export class Collider {
  constructor(type) {
    this.id = _id++;
    this.type = type;
    this.aabb = new Float32Array(6);
    /** Collision filtering: a body collides when (a.group & b.mask) && (b.group & a.mask). */
    this.group = 1; this.mask = 0xffffffff;
    this.friction = 0.7; this.restitution = 0;
    /** A trigger reports overlaps instead of blocking. */
    this.isTrigger = false;
    this.userData = null;
  }
  /**
   * Appends contacts of a capsule (a-b, radius r) with this collider to `out`.
   * @param {Vector3} a  one end of the capsule's axis
   * @param {Vector3} b  the other end
   * @param {number} r   radius
   * @param {Contacts} out
   */
  collideCapsule(a, b, r, out) {}
  /**
   * Nearest ray hit within maxT: fills `hit` = { t, nx, ny, nz } and returns true.
   * @param {number} ox  ray origin
   * @param {number} oy
   * @param {number} oz
   * @param {number} dx  unit direction
   * @param {number} dy
   * @param {number} dz
   * @param {number} maxT  longest distance to look
   * @param {{ t: number, nx: number, ny: number, nz: number }} hit
   * @returns {boolean}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) { return false; }
}

export class PlaneCollider extends Collider {
  constructor(normal = new Vector3(0, 1, 0), offset = 0) {
    super('plane');
    this.normal = normal.clone().normalize(); this.offset = offset;
    this.aabb.set([-1e9, -1e9, -1e9, 1e9, 1e9, 1e9]);
  }
  collideCapsule(a, b, r, out) { capsuleVsPlane(a, b, r, this.normal.x, this.normal.y, this.normal.z, this.offset, out); }
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    const n = this.normal, den = n.x * dx + n.y * dy + n.z * dz;
    if (den >= -1e-12) return false;
    const t = (this.offset - (n.x * ox + n.y * oy + n.z * oz)) / den;
    if (t < 0 || t > maxT) return false;
    hit.t = t; hit.nx = n.x; hit.ny = n.y; hit.nz = n.z; return true;
  }
}

export class BoxCollider extends Collider {
  /** @param {{center?: Vector3, half?: Vector3, rotation?: Quaternion}} [o]  `half` is the half extents (default 0.5 m each: a 1 m cube) */
  constructor({ center = new Vector3(), half = new Vector3(0.5, 0.5, 0.5), rotation = new Quaternion() } = {}) {
    super('box');
    this.box = { c: new Vector3(), h: half.clone(), q: new Quaternion(), qi: new Quaternion() };
    this.setTransform(center, rotation);
  }
  setTransform(center, rotation = this.box.q) {
    const b = this.box;
    b.c.copy(center); b.q.copy(rotation); b.qi.copy(rotation).invert();
    // world AABB of the rotated box
    const e = this.aabb, h = b.h;
    const ax = Math.abs(1 - 2 * (b.q.y * b.q.y + b.q.z * b.q.z)), ay = Math.abs(2 * (b.q.x * b.q.y - b.q.z * b.q.w)), az = Math.abs(2 * (b.q.x * b.q.z + b.q.y * b.q.w));
    const bx = Math.abs(2 * (b.q.x * b.q.y + b.q.z * b.q.w)), by = Math.abs(1 - 2 * (b.q.x * b.q.x + b.q.z * b.q.z)), bz = Math.abs(2 * (b.q.y * b.q.z - b.q.x * b.q.w));
    const cx = Math.abs(2 * (b.q.x * b.q.z - b.q.y * b.q.w)), cy = Math.abs(2 * (b.q.y * b.q.z + b.q.x * b.q.w)), cz = Math.abs(1 - 2 * (b.q.x * b.q.x + b.q.y * b.q.y));
    const ex = ax * h.x + ay * h.y + az * h.z, ey = bx * h.x + by * h.y + bz * h.z, ez = cx * h.x + cy * h.y + cz * h.z;
    e[0] = b.c.x - ex; e[1] = b.c.y - ey; e[2] = b.c.z - ez; e[3] = b.c.x + ex; e[4] = b.c.y + ey; e[5] = b.c.z + ez;
    return this;
  }
  collideCapsule(a, b, r, out) { capsuleVsBox(a, b, r, this.box, out); }
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) { if (!rayBox(ox, oy, oz, dx, dy, dz, this.box, maxT, _hit)) return false; hit.t = _hit.t; hit.nx = _hit.nx; hit.ny = _hit.ny; hit.nz = _hit.nz; return true; }
}

export class SphereCollider extends Collider {
  constructor(center = new Vector3(), radius = 0.5) {
    super('sphere');
    this.center = center.clone(); this.radius = radius;
    this.aabb.set([center.x - radius, center.y - radius, center.z - radius, center.x + radius, center.y + radius, center.z + radius]);
  }
  collideCapsule(a, b, r, out) { capsuleVsCapsule(a, b, r, this.center, this.center, this.radius, out); }
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    const t = raySphere(ox, oy, oz, dx, dy, dz, this.center, this.radius, maxT);
    if (t < 0) return false;
    hit.t = t; _c.set(ox + dx * t - this.center.x, oy + dy * t - this.center.y, oz + dz * t - this.center.z).normalize();
    hit.nx = _c.x; hit.ny = _c.y; hit.nz = _c.z; return true;
  }
}

export class CapsuleCollider extends Collider {
  constructor(a = new Vector3(0, 0, 0), b = new Vector3(0, 1, 0), radius = 0.3) {
    super('capsule');
    this.a = a.clone(); this.b = b.clone(); this.radius = radius;
    const r = radius;
    this.aabb.set([Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r]);
  }
  collideCapsule(a, b, r, out) { capsuleVsCapsule(a, b, r, this.a, this.b, this.radius, out); }
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, this.a, this.b, this.radius, maxT);
    if (t < 0) return false;
    hit.t = t; _c.set(ox + dx * t, oy + dy * t, oz + dz * t);
    const ab = _e1.copy(this.b).sub(this.a), l2 = ab.lengthSq(), s = l2 > 0 ? Math.min(1, Math.max(0, _e2.copy(_c).sub(this.a).dot(ab) / l2)) : 0;
    _c.sub(_e2.copy(this.a).addScaledVector(ab, s)).normalize();
    hit.nx = _c.x; hit.ny = _c.y; hit.nz = _c.z; return true;
  }
}

export class MeshCollider extends Collider {
  /**
   * @param {Float32Array|number[]} positions  xyz per vertex, already in world space
   * @param {Uint16Array|Uint32Array|number[]|null} indices  three per triangle (null: positions are a triangle list)
   * @param {{twoSided?: boolean}} [o]  default true: a capsule is pushed out of whichever face it is nearer to
   */
  constructor(positions, indices = null, { twoSided = true } = {}) {
    super('mesh');
    this.twoSided = twoSided;
    this.positions = positions instanceof Float32Array ? positions : Float32Array.from(positions);
    const nv = this.positions.length / 3;
    this.indices = indices ? (indices instanceof Uint32Array ? indices : Uint32Array.from(indices)) : Uint32Array.from({ length: nv }, (_, i) => i);
    const nt = this.indices.length / 3, boxes = new Float32Array(nt * 6), P = this.positions, I = this.indices;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let t = 0; t < nt; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(P[a + k], P[b + k], P[c + k]), hi = Math.max(P[a + k], P[b + k], P[c + k]);
        boxes[t * 6 + k] = lo; boxes[t * 6 + 3 + k] = hi;
      }
      x0 = Math.min(x0, boxes[t * 6]); y0 = Math.min(y0, boxes[t * 6 + 1]); z0 = Math.min(z0, boxes[t * 6 + 2]);
      x1 = Math.max(x1, boxes[t * 6 + 3]); y1 = Math.max(y1, boxes[t * 6 + 4]); z1 = Math.max(z1, boxes[t * 6 + 5]);
    }
    this.triangleCount = nt;
    this.tree = new AABBTree(boxes);
    this.aabb.set([x0, y0, z0, x1, y1, z1]);
  }

  /**
   * A mesh collider from a scene geometry transformed by `matrix` (a Matrix4; default identity).
   * @param {BufferGeometry} geometry
   * @param {Matrix4 | null} [matrix]
   * @param {{ twoSided?: boolean }} [o]  see the constructor
   * @returns {MeshCollider}
   */
  static fromGeometry(geometry, matrix = null, o = {}) {
    const pos = geometry.attributes.position, n = pos.count, out = new Float32Array(n * 3), v = new Vector3();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); if (matrix) v.applyMatrix4(matrix); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
    const idx = geometry.index ? geometry.index.array : null;
    return new MeshCollider(out, idx, o);
  }

  _tri(i) {
    const P = this.positions, I = this.indices;
    _v0.fromArray(P, I[i * 3] * 3); _v1.fromArray(P, I[i * 3 + 1] * 3); _v2.fromArray(P, I[i * 3 + 2] * 3);
  }

  collideCapsule(a, b, r, out) {
    const x0 = Math.min(a.x, b.x) - r, y0 = Math.min(a.y, b.y) - r, z0 = Math.min(a.z, b.z) - r, x1 = Math.max(a.x, b.x) + r, y1 = Math.max(a.y, b.y) + r, z1 = Math.max(a.z, b.z) + r;
    this.tree.query(x0, y0, z0, x1, y1, z1, (i) => { this._tri(i); capsuleVsTriangle(a, b, r, _v0, _v1, _v2, out, this.twoSided); });
  }

  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    let best = -1, bi = -1;
    this.tree.raycast(ox, oy, oz, dx, dy, dz, maxT, (i) => {
      this._tri(i);
      const t = rayTriangle(ox, oy, oz, dx, dy, dz, _v0, _v1, _v2, best >= 0 ? best : maxT, this.twoSided);
      if (t >= 0 && (best < 0 || t < best)) { best = t; bi = i; return t; }
      return undefined;
    });
    if (bi < 0) return false;
    this._tri(bi);
    _c.copy(_v1).sub(_v0).cross(_e1.copy(_v2).sub(_v0)).normalize();
    if (_c.x * dx + _c.y * dy + _c.z * dz > 0) _c.negate();                     // face the ray
    hit.t = best; hit.nx = _c.x; hit.ny = _c.y; hit.nz = _c.z; return true;
  }
}
