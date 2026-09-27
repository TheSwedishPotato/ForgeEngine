import { Vector3, Box3 } from 'three';
import { closestPtSegmentSegment, closestPtPointSegment } from './math.js';

/**
 * Collision shapes. All shapes live in their body's local frame.
 *
 *  sphere  : offset, radius
 *  capsule : offset, axis (unit), halfLength, radius
 *  box     : offset, halfExtents (only collides with planes; used for feet)
 *  plane   : normal, constant (static; world space)
 *
 * Material properties are per shape. `compliance` (m/N) makes a contact a
 * spring (padding, ropes); `damping` (Ns/m) is the dashpot in parallel.
 */
export class Shape {
  constructor(type, opts = {}) {
    this.type = type;
    this.body = null;
    this.offset = (opts.offset ?? new Vector3()).clone();
    this.radius = opts.radius ?? 0;
    this.axis = (opts.axis ?? new Vector3(0, 1, 0)).clone().normalize();
    this.halfLength = opts.halfLength ?? 0;
    this.halfExtents = (opts.halfExtents ?? new Vector3()).clone();
    this.normal = (opts.normal ?? new Vector3(0, 1, 0)).clone().normalize();
    this.constant = opts.constant ?? 0;
    this.friction = opts.friction ?? 0.5;
    this.restitution = opts.restitution ?? 0.1;
    this.compliance = opts.compliance ?? 0;
    this.damping = opts.damping ?? 0;
    this.collidesWithPlane = opts.collidesWithPlane ?? true;
    this.collidesWithBodies = opts.collidesWithBodies ?? (type !== 'box');
    this.userData = opts.userData ?? {};
    // World-space cache
    this.wCenter = new Vector3();
    this.wA = new Vector3();
    this.wB = new Vector3();
    this.aabb = new Box3();
  }

  static sphere(radius, offset, opts = {}) {
    return new Shape('sphere', { ...opts, radius, offset });
  }

  static capsule(radius, halfLength, axis, offset, opts = {}) {
    return new Shape('capsule', { ...opts, radius, halfLength, axis, offset });
  }

  static box(halfExtents, offset, opts = {}) {
    return new Shape('box', { ...opts, halfExtents, offset });
  }

  static plane(normal, constant, opts = {}) {
    return new Shape('plane', { ...opts, normal, constant });
  }

  updateWorld() {
    const b = this.body;
    if (this.type === 'plane') return;
    b.localToWorld(this.offset, this.wCenter);
    if (this.type === 'capsule') {
      _v.copy(this.axis).applyQuaternion(b.q).multiplyScalar(this.halfLength);
      this.wA.copy(this.wCenter).sub(_v);
      this.wB.copy(this.wCenter).add(_v);
    }
  }

  computeAabb(margin) {
    const box = this.aabb;
    if (this.type === 'plane') {
      box.makeEmpty();
      return box;
    }
    this.updateWorld();
    if (this.type === 'sphere') {
      box.min.copy(this.wCenter).subScalar(this.radius + margin);
      box.max.copy(this.wCenter).addScalar(this.radius + margin);
    } else if (this.type === 'capsule') {
      box.min.copy(this.wA).min(this.wB).subScalar(this.radius + margin);
      box.max.copy(this.wA).max(this.wB).addScalar(this.radius + margin);
    } else if (this.type === 'box') {
      const r = this.halfExtents.length();
      box.min.copy(this.wCenter).subScalar(r + margin);
      box.max.copy(this.wCenter).addScalar(r + margin);
    }
    return box;
  }
}

const _v = new Vector3();
const _c1 = new Vector3(), _c2 = new Vector3(), _d = new Vector3(), _corner = new Vector3();

/** A single contact point between shape A and shape B. Normal points B -> A. */
export class Contact {
  constructor() {
    this.shapeA = null;
    this.shapeB = null;
    this.normal = new Vector3();
    this.depth = 0;
    this.pA = new Vector3();       // world point on A's surface
    this.pB = new Vector3();       // world point on B's surface
    this.rA = new Vector3();       // local (body A) anchor
    this.rB = new Vector3();       // local (body B) anchor
    this.lambdaN = 0;
    this.vnPre = 0;
    this.compliance = 0;
    this.damping = 0;
    this.friction = 0;
    this.restitution = 0;
  }
}

function sphereSphere(cA, rA, cB, rB, shapeA, shapeB, out) {
  _d.subVectors(cA, cB);
  const dist2 = _d.lengthSq();
  const rs = rA + rB;
  if (dist2 >= rs * rs) return false;
  const dist = Math.sqrt(dist2);
  const c = out();
  if (dist > 1e-9) c.normal.copy(_d).multiplyScalar(1 / dist);
  else c.normal.set(0, 1, 0);
  c.depth = rs - dist;
  c.pA.copy(cA).addScaledVector(c.normal, -rA);
  c.pB.copy(cB).addScaledVector(c.normal, rB);
  c.shapeA = shapeA;
  c.shapeB = shapeB;
  return true;
}

/**
 * Narrowphase for one shape pair. `alloc` returns a fresh Contact to fill.
 * Returns the number of contacts produced.
 */
export function collide(sa, sb, alloc) {
  // Order so that planes are always B.
  if (sa.type === 'plane') { const t = sa; sa = sb; sb = t; }
  if (sb.type === 'plane') return collidePlane(sa, sb, alloc);
  if (sa.type === 'box' || sb.type === 'box') return 0;

  if (sa.type === 'sphere' && sb.type === 'sphere') {
    return sphereSphere(sa.wCenter, sa.radius, sb.wCenter, sb.radius, sa, sb, alloc) ? 1 : 0;
  }
  if (sa.type === 'capsule' && sb.type === 'capsule') {
    closestPtSegmentSegment(sa.wA, sa.wB, sb.wA, sb.wB, _c1, _c2);
    return sphereSphere(_c1, sa.radius, _c2, sb.radius, sa, sb, alloc) ? 1 : 0;
  }
  if (sa.type === 'capsule' && sb.type === 'sphere') {
    closestPtPointSegment(sb.wCenter, sa.wA, sa.wB, _c1);
    return sphereSphere(_c1, sa.radius, sb.wCenter, sb.radius, sa, sb, alloc) ? 1 : 0;
  }
  if (sa.type === 'sphere' && sb.type === 'capsule') {
    closestPtPointSegment(sa.wCenter, sb.wA, sb.wB, _c2);
    return sphereSphere(sa.wCenter, sa.radius, _c2, sb.radius, sa, sb, alloc) ? 1 : 0;
  }
  return 0;
}

function planeSphere(center, radius, sa, plane, alloc) {
  const dist = center.dot(plane.normal) - plane.constant;
  if (dist >= radius) return 0;
  const c = alloc();
  c.shapeA = sa;
  c.shapeB = plane;
  c.normal.copy(plane.normal);
  c.depth = radius - dist;
  c.pA.copy(center).addScaledVector(plane.normal, -radius);
  c.pB.copy(center).addScaledVector(plane.normal, -dist);
  return 1;
}

function collidePlane(sa, plane, alloc) {
  if (!sa.collidesWithPlane) return 0;
  if (sa.type === 'sphere') return planeSphere(sa.wCenter, sa.radius, sa, plane, alloc);
  if (sa.type === 'capsule') {
    return planeSphere(sa.wA, sa.radius, sa, plane, alloc) + planeSphere(sa.wB, sa.radius, sa, plane, alloc);
  }
  if (sa.type === 'box') {
    const b = sa.body;
    const e = sa.halfExtents;
    let n = 0;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? e.x : -e.x, i & 2 ? e.y : -e.y, i & 4 ? e.z : -e.z).add(sa.offset);
      b.localToWorld(_corner, _corner);
      const dist = _corner.dot(plane.normal) - plane.constant;
      if (dist >= 0) continue;
      const c = alloc();
      c.shapeA = sa;
      c.shapeB = plane;
      c.normal.copy(plane.normal);
      c.depth = -dist;
      c.pA.copy(_corner);
      c.pB.copy(_corner).addScaledVector(plane.normal, -dist);
      n++;
    }
    return n;
  }
  return 0;
}
