import { Vector3, Quaternion } from 'three';

const _v = new Vector3();
const _q = new Quaternion();
const _qi = new Quaternion();

let nextId = 0;

/**
 * Rigid body with a diagonal inertia tensor in its local frame. The local
 * frame origin is the centre of mass, so shape offsets and joint anchors are
 * measured from the COM.
 */
export class Body {
  constructor({
    name = '',
    mass = 0,
    inertia = null,            // Vector3 principal moments (kg m^2), local frame
    position = new Vector3(),
    quaternion = new Quaternion(),
    linearDamping = 0.0,       // 1/s, tiny air drag / numerical safety
    angularDamping = 0.0,
  } = {}) {
    this.id = nextId++;
    this.name = name;
    this.pos = position.clone();
    this.q = quaternion.clone();
    this.prevPos = this.pos.clone();
    this.prevQ = this.q.clone();
    this.vel = new Vector3();
    this.omega = new Vector3();
    this.force = new Vector3();   // external force, persists until cleared
    this.torque = new Vector3();
    this.gravityScale = 1;
    this.linearDamping = linearDamping;
    this.angularDamping = angularDamping;
    this.shapes = [];
    this.userData = {};
    this.mass = 0;
    this.invMass = 0;
    this.inertia = new Vector3();
    this.invInertia = new Vector3();
    this.setMass(mass, inertia);
  }

  get isStatic() {
    return this.invMass === 0;
  }

  setMass(mass, inertia) {
    if (!mass || mass <= 0) {
      this.mass = 0;
      this.invMass = 0;
      this.inertia.set(0, 0, 0);
      this.invInertia.set(0, 0, 0);
      return this;
    }
    this.mass = mass;
    this.invMass = 1 / mass;
    const I = inertia ?? new Vector3(1, 1, 1).multiplyScalar(0.4 * mass * 0.01);
    this.inertia.copy(I);
    this.invInertia.set(1 / I.x, 1 / I.y, 1 / I.z);
    return this;
  }

  addShape(shape) {
    shape.body = this;
    this.shapes.push(shape);
    return shape;
  }

  localToWorld(local, out) {
    return out.copy(local).applyQuaternion(this.q).add(this.pos);
  }

  prevLocalToWorld(local, out) {
    return out.copy(local).applyQuaternion(this.prevQ).add(this.prevPos);
  }

  worldToLocal(world, out) {
    _qi.copy(this.q).invert();
    return out.copy(world).sub(this.pos).applyQuaternion(_qi);
  }

  /** Direction from local to world (rotation only). */
  localDirToWorld(local, out) {
    return out.copy(local).applyQuaternion(this.q);
  }

  velocityAt(worldPoint, out) {
    _v.subVectors(worldPoint, this.pos);
    return out.crossVectors(this.omega, _v).add(this.vel);
  }

  /** out = I_world^-1 * v */
  applyInvInertia(v, out) {
    _qi.copy(this.q).invert();
    out.copy(v).applyQuaternion(_qi);
    out.set(out.x * this.invInertia.x, out.y * this.invInertia.y, out.z * this.invInertia.z);
    return out.applyQuaternion(this.q);
  }

  /**
   * Generalised inverse mass along unit `normal`. With a world point the
   * constraint is positional (w = 1/m + (r x n)^T I^-1 (r x n)); without it
   * the constraint is purely rotational (w = n^T I^-1 n).
   */
  getInverseMass(normal, worldPoint) {
    if (this.invMass === 0) return 0;
    if (worldPoint) {
      _v.subVectors(worldPoint, this.pos).cross(normal);
    } else {
      _v.copy(normal);
    }
    _qi.copy(this.q).invert();
    _v.applyQuaternion(_qi);
    let w = _v.x * _v.x * this.invInertia.x + _v.y * _v.y * this.invInertia.y + _v.z * _v.z * this.invInertia.z;
    if (worldPoint) w += this.invMass;
    return w;
  }

  /**
   * Applies a positional (or, with velocityLevel, an impulse) correction
   * `corr` at `worldPoint`; without a point it is a pure rotation/angular
   * impulse.
   */
  applyCorrection(corr, worldPoint, velocityLevel = false) {
    if (this.invMass === 0) return;
    if (worldPoint) {
      if (velocityLevel) this.vel.addScaledVector(corr, this.invMass);
      else this.pos.addScaledVector(corr, this.invMass);
      _v.subVectors(worldPoint, this.pos).cross(corr);
    } else {
      _v.copy(corr);
    }
    this.applyInvInertia(_v, _v);
    if (velocityLevel) this.omega.add(_v);
    else this.applyRotation(_v);
  }

  /** q <- q + 0.5 * [rot, 0] * q, clamped for robustness. */
  applyRotation(rot, scale = 1) {
    const maxPhi = 0.5;
    const phi = rot.length();
    if (phi * scale > maxPhi) scale = maxPhi / phi;
    const rx = rot.x * scale, ry = rot.y * scale, rz = rot.z * scale;
    const q = this.q;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    // dq = [r, 0] (x) q
    const dx = rx * qw + ry * qz - rz * qy;
    const dy = -rx * qz + ry * qw + rz * qx;
    const dz = rx * qy - ry * qx + rz * qw;
    const dw = -rx * qx - ry * qy - rz * qz;
    q.set(qx + 0.5 * dx, qy + 0.5 * dy, qz + 0.5 * dz, qw + 0.5 * dw).normalize();
  }

  /** Explicit integration step at the start of a substep. */
  integrate(h, gravity) {
    this.prevPos.copy(this.pos);
    this.prevQ.copy(this.q);
    if (this.invMass === 0) return;

    this.vel.addScaledVector(gravity, h * this.gravityScale);
    this.vel.addScaledVector(this.force, h * this.invMass);
    if (this.linearDamping > 0) this.vel.multiplyScalar(Math.max(0, 1 - this.linearDamping * h));
    this.pos.addScaledVector(this.vel, h);

    // Angular: w += h I^-1 (tau - w x (I w)); gyroscopic term keeps spinning
    // limbs honest.
    _qi.copy(this.q).invert();
    const wl = _v.copy(this.omega).applyQuaternion(_qi);
    const Iwx = this.inertia.x * wl.x, Iwy = this.inertia.y * wl.y, Iwz = this.inertia.z * wl.z;
    const tl = _vt.copy(this.torque).applyQuaternion(_qi);
    const gx = wl.y * Iwz - wl.z * Iwy;
    const gy = wl.z * Iwx - wl.x * Iwz;
    const gz = wl.x * Iwy - wl.y * Iwx;
    wl.x += h * this.invInertia.x * (tl.x - gx);
    wl.y += h * this.invInertia.y * (tl.y - gy);
    wl.z += h * this.invInertia.z * (tl.z - gz);
    this.omega.copy(wl).applyQuaternion(this.q);
    if (this.angularDamping > 0) this.omega.multiplyScalar(Math.max(0, 1 - this.angularDamping * h));
    // Safety clamp: a limb spinning faster than this is a solver blow-up.
    const w2 = this.omega.lengthSq();
    if (w2 > MAX_OMEGA * MAX_OMEGA) this.omega.multiplyScalar(MAX_OMEGA / Math.sqrt(w2));

    this.applyRotation(_vt.copy(this.omega), h);
  }

  /** Derive velocities from the positional change of the substep. */
  updateVelocities(h) {
    if (this.invMass === 0) return;
    this.vel.subVectors(this.pos, this.prevPos).multiplyScalar(1 / h);
    _q.copy(this.prevQ).invert().premultiply(this.q); // q * prevQ^-1
    const s = _q.w >= 0 ? 2 / h : -2 / h;
    this.omega.set(_q.x * s, _q.y * s, _q.z * s);
    const v2 = this.vel.lengthSq();
    const vmax = this.maxSpeed ?? MAX_VEL;
    if (v2 > vmax * vmax) this.vel.multiplyScalar(vmax / Math.sqrt(v2));
  }

  kineticEnergy() {
    if (this.invMass === 0) return 0;
    _qi.copy(this.q).invert();
    const wl = _v.copy(this.omega).applyQuaternion(_qi);
    return 0.5 * this.mass * this.vel.lengthSq() +
      0.5 * (this.inertia.x * wl.x * wl.x + this.inertia.y * wl.y * wl.y + this.inertia.z * wl.z * wl.z);
  }
}

const _vt = new Vector3();
const MAX_OMEGA = 120; // rad/s
const MAX_VEL = 60;    // m/s
