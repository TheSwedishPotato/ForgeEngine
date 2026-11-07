/**
 * A dynamic rigid body: a sphere or a capsule (axis along the body's local Y) with mass, velocity and
 * collision settings. Bodies collide with the world's static colliders and with each other, and can be joined
 * by BallJoint / HingeJoint (a ragdoll is a tree of them).
 */
import { Vector3, Quaternion } from '../math/core.js';

let _bodyId = 1;
const _a = new Vector3();

/** @import { Object3D } from '../scene/Object3D.js' */

/**
 * The shape of a rigid body: a sphere, or a capsule whose axis runs along the body's local Y.
 * @typedef {{ type: 'sphere', radius: number } | { type: 'capsule', radius: number, length: number }} BodyShape
 *   `length` of a capsule is the distance between its two end-sphere centres.
 */

/**
 * What `new RigidBody(o)` takes.
 * @typedef {object} BodyOptions
 * @property {BodyShape} shape
 * @property {number} [mass]              kilograms (1); 0 makes the body kinematic (moved by you, pushes others)
 * @property {Vector3} [position]
 * @property {Quaternion} [rotation]
 * @property {number} [friction]          0.7
 * @property {number} [restitution]       bounciness, 0..1 (0)
 * @property {number} [linearDamping]     0.02
 * @property {number} [angularDamping]    0.08
 * @property {number} [gravityScale]      1; 0 floats
 * @property {number} [group]             collision filtering: a body collides when (a.group & b.mask) && (b.group & a.mask) (1)
 * @property {number} [mask]              0xffffffff
 * @property {Object3D | null} [object]   a scene object that follows the body (see sync())
 * @property {any} [userData]             yours
 * @property {number | null} [ignoreGroup]  bodies with the same non-null value never collide with each other (a ragdoll's limbs)
 * @property {boolean} [driven]           a kinematic body whose position you set yourself every frame (a character); the world will not move it
 * @property {boolean} [triggerActivator] report this body to the world's triggers
 */

export class RigidBody {
  /** @param {BodyOptions} o */
  constructor(o) {
    const { shape, mass = 1, position = new Vector3(), rotation = new Quaternion(), friction = 0.7, restitution = 0, linearDamping = 0.02, angularDamping = 0.08, gravityScale = 1, group = 1, mask = 0xffffffff, object = null, userData = null, ignoreGroup = null, driven = false, triggerActivator = false } = o ?? /** @type {BodyOptions} */ ({});
    if (!shape || (shape.type !== 'sphere' && shape.type !== 'capsule')) throw new Error("RigidBody: pass a shape: { type: 'sphere', radius } or { type: 'capsule', radius, length }");
    this.id = _bodyId++;
    this.shape = { ...shape };
    this.position = position.clone();
    this.quaternion = rotation.clone();
    this.linearVelocity = new Vector3();
    this.angularVelocity = new Vector3();
    this.force = new Vector3(); this.torque = new Vector3();
    this.friction = friction; this.restitution = restitution;
    this.linearDamping = linearDamping; this.angularDamping = angularDamping;
    this.gravityScale = gravityScale;
    this.group = group; this.mask = mask;
    this.object = object; this.userData = userData;
    this.ignoreGroup = ignoreGroup; this.driven = driven; this.triggerActivator = triggerActivator;
    this.world = null;
    this.enabled = true;
    /** Bodies connected by a joint do not collide with each other. */
    this.joints = [];
    this.invInertia = new Float64Array(3);     // local principal inverse inertia
    this.iw = new Float64Array(9);             // world inverse inertia tensor (row-major)
    this.setMass(mass);
    this.updateWorld();
    // sleep bookkeeping
    this.sleeping = false; this._still = 0;
  }

  get isDynamic() { return this.invMass > 0; }

  setMass(mass) {
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    const s = this.shape, r = s.radius;
    let ix, iy, iz;
    if (s.type === 'sphere') ix = iy = iz = 0.4 * mass * r * r;
    else { const H = s.length + 2 * r; ix = iz = mass * (3 * r * r + H * H) / 12; iy = 0.5 * mass * r * r; }
    // keep thin capsules from spinning absurdly fast about their axis
    iy = Math.max(iy, 0.35 * ix);
    this.invInertia[0] = mass > 0 ? 1 / ix : 0; this.invInertia[1] = mass > 0 ? 1 / iy : 0; this.invInertia[2] = mass > 0 ? 1 / iz : 0;
    return this;
  }

  /** Recomputes the world inverse inertia from the orientation. */
  updateWorld() {
    const q = this.quaternion, x = q.x, y = q.y, z = q.z, w = q.w;
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    const a = this.invInertia[0], b = this.invInertia[1], c = this.invInertia[2], m = this.iw;
    // R * diag(a,b,c) * R^T
    m[0] = r00 * r00 * a + r01 * r01 * b + r02 * r02 * c; m[1] = r00 * r10 * a + r01 * r11 * b + r02 * r12 * c; m[2] = r00 * r20 * a + r01 * r21 * b + r02 * r22 * c;
    m[3] = m[1]; m[4] = r10 * r10 * a + r11 * r11 * b + r12 * r12 * c; m[5] = r10 * r20 * a + r11 * r21 * b + r12 * r22 * c;
    m[6] = m[2]; m[7] = m[5]; m[8] = r20 * r20 * a + r21 * r21 * b + r22 * r22 * c;
  }

  /** The axis of a capsule in world space (unit). */
  axis(out = new Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quaternion); }

  /** World end points of the capsule's axis (both equal the centre for a sphere). */
  segment(a, b) {
    if (this.shape.type === 'sphere') { a.copy(this.position); b.copy(this.position); return; }
    const h = this.shape.length / 2;
    _a.set(0, h, 0).applyQuaternion(this.quaternion);
    a.copy(this.position).sub(_a); b.copy(this.position).add(_a);
  }

  /** Velocity of the material point at world position p. */
  pointVelocity(p, out = new Vector3()) {
    const rx = p.x - this.position.x, ry = p.y - this.position.y, rz = p.z - this.position.z, w = this.angularVelocity, v = this.linearVelocity;
    return out.set(v.x + (w.y * rz - w.z * ry), v.y + (w.z * rx - w.x * rz), v.z + (w.x * ry - w.y * rx));   // v + w x r
  }

  /**
   * Adds a force (newtons) for the coming step.
   * @param {Vector3} f
   * @returns {this}
   */
  applyForce(f) { this.force.add(f); this.wake(); return this; }
  /**
   * Adds an impulse (kg·m/s) to the body's momentum. With `point` (world space) it also spins the body.
   * @param {Vector3} impulse
   * @param {Vector3 | null} [point]  where the impulse acts
   * @returns {this}
   */
  applyImpulse(impulse, point = null) {
    if (!this.invMass) return this;
    this.linearVelocity.addScaledVector(impulse, this.invMass);
    if (point) {
      const rx = point.x - this.position.x, ry = point.y - this.position.y, rz = point.z - this.position.z;
      const lx = ry * impulse.z - rz * impulse.y, ly = rz * impulse.x - rx * impulse.z, lz = rx * impulse.y - ry * impulse.x, m = this.iw;
      this.angularVelocity.x += m[0] * lx + m[1] * ly + m[2] * lz; this.angularVelocity.y += m[3] * lx + m[4] * ly + m[5] * lz; this.angularVelocity.z += m[6] * lx + m[7] * ly + m[8] * lz;
    }
    this.wake();
    return this;
  }
  /** Wakes this body and everything it is jointed to. */
  wake() {
    if (!this.sleeping && this._still === 0) return;
    this.sleeping = false; this._still = 0;
    for (const j of this.joints) { const o = j.bodyA === this ? j.bodyB : j.bodyA; if (o.sleeping) o.wake(); }
  }

  /** Copies the body's pose to its scene object (call after world.step). */
  sync() {
    if (!this.object) return;
    this.object.position.copy(this.position);
    this.object.quaternion.copy(this.quaternion);
  }
}
