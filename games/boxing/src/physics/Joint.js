import { Vector3, Quaternion } from 'three';
import { applyPairCorrection } from './solver.js';
import { quatToRotVec, rotVecToQuat, swingTwist, clamp } from './math.js';

const _p0 = new Vector3(), _p1 = new Vector3(), _corr = new Vector3();
const _qr = new Quaternion(), _qt = new Quaternion(), _qs = new Quaternion(), _qd = new Quaternion();
const _sv = new Vector3(), _tv = new Vector3(), _w = new Vector3(), _n = new Vector3();

/**
 * Ball joint with anatomical limits and a muscle drive.
 *
 * The joint rotation is the child's orientation relative to the parent,
 * expressed in the parent's frame and measured from the rest pose:
 *     r = qParent^-1 * qChild * qRest^-1
 * It is decomposed into a twist about `twistAxis` and a swing whose rotation
 * vector has components along `swingAxis1` and `swingAxis2`; each component
 * has its own [min, max] range (the swing range is an elliptical cone).
 * A hinge is a joint whose swing ranges are both [0, 0].
 *
 * The drive pulls r towards `target` with stiffness (Nm/rad) and damping
 * (Nms/rad), saturating at maxTorque (Nm) like a real muscle group.
 */
export class Joint {
  constructor(parent, child, {
    name = '',
    anchor,                      // world-space anchor at the rest pose
    twistAxis = new Vector3(0, 1, 0),
    swingAxis1 = new Vector3(1, 0, 0),
    swingAxis2 = null,
    twist = [-Math.PI, Math.PI],
    swing1 = [-Math.PI, Math.PI],
    swing2 = [-Math.PI, Math.PI],
    limitCompliance = 0,
  }) {
    this.name = name;
    this.parent = parent;
    this.child = child;
    this.anchorParent = parent.worldToLocal(anchor, new Vector3());
    this.anchorChild = child.worldToLocal(anchor, new Vector3());
    this.qRest = parent.q.clone().invert().multiply(child.q);
    this.twistAxis = twistAxis.clone().normalize();
    this.swingAxis1 = swingAxis1.clone().normalize();
    this.swingAxis2 = (swingAxis2 ? swingAxis2.clone() : new Vector3().crossVectors(this.twistAxis, this.swingAxis1)).normalize();
    this.limits = { twist: [...twist], swing1: [...swing1], swing2: [...swing2] };
    this.limitCompliance = limitCompliance;
    this.hasLimits = true;

    // Drive
    this.target = new Quaternion();       // relative rotation, parent frame
    this.targetOmega = new Vector3();     // relative angular velocity, parent frame
    this.stiffness = 0;
    this.damping = 0;
    this.maxTorque = Infinity;
    this.driveEnabled = true;

    // Diagnostics
    this.lastDriveTorque = 0;
    this.lastForce = 0;
  }

  /** Sets the drive target; feeds forward the target's angular velocity. */
  setTarget(q, dt = 0) {
    if (dt > 0) {
      _qd.copy(this.target).invert().premultiply(q); // q * target^-1
      quatToRotVec(_qd, this.targetOmega).multiplyScalar(1 / dt);
    } else {
      this.targetOmega.set(0, 0, 0);
    }
    this.target.copy(q);
  }

  setDrive(stiffness, damping, maxTorque = this.maxTorque) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.maxTorque = maxTorque;
  }

  /** Current relative rotation (parent frame, relative to rest). */
  getRelative(out) {
    out.copy(this.parent.q).invert().multiply(this.child.q);
    _qd.copy(this.qRest).invert();
    return out.multiply(_qd);
  }

  /** Clamps a relative rotation into the joint's range. Returns true if it moved. */
  clampRotation(r, out) {
    const L = this.limits;
    const twist = swingTwist(r, this.twistAxis, _qs);
    quatToRotVec(_qs, _sv);
    let s1 = _sv.dot(this.swingAxis1);
    let s2 = _sv.dot(this.swingAxis2);
    let t = twist;
    let changed = false;

    // Elliptical swing cone, radii picked per quadrant.
    const r1 = s1 >= 0 ? L.swing1[1] : -L.swing1[0];
    const r2 = s2 >= 0 ? L.swing2[1] : -L.swing2[0];
    if (r1 <= 1e-6 || r2 <= 1e-6) {
      // Degenerate cone (hinge or planar): clamp per axis.
      const c1 = clamp(s1, L.swing1[0], L.swing1[1]);
      const c2 = clamp(s2, L.swing2[0], L.swing2[1]);
      if (c1 !== s1 || c2 !== s2) { s1 = c1; s2 = c2; changed = true; }
    } else {
      const e = (s1 * s1) / (r1 * r1) + (s2 * s2) / (r2 * r2);
      if (e > 1) {
        const k = 1 / Math.sqrt(e);
        s1 *= k; s2 *= k;
        changed = true;
      }
    }
    const ct = clamp(t, L.twist[0], L.twist[1]);
    if (ct !== t) { t = ct; changed = true; }
    if (!changed) { out.copy(r); return false; }

    _sv.copy(this.swingAxis1).multiplyScalar(s1).addScaledVector(this.swingAxis2, s2);
    rotVecToQuat(_sv, _qs);
    _tv.copy(this.twistAxis).multiplyScalar(t);
    rotVecToQuat(_tv, _qt);
    out.copy(_qs).multiply(_qt);
    return true;
  }

  /** Rotation vector (world) that takes the child to relative rotation r. */
  _errorTo(r, out) {
    // desired child = qParent * r * qRest ; delta = desired * qChild^-1
    _qd.copy(this.parent.q).multiply(r).multiply(this.qRest);
    _qd.multiply(_qt.copy(this.child.q).invert());
    return quatToRotVec(_qd, out);
  }

  solveAttachment(h) {
    this.parent.localToWorld(this.anchorParent, _p0);
    this.child.localToWorld(this.anchorChild, _p1);
    _corr.subVectors(_p1, _p0);
    const lambda = applyPairCorrection(this.parent, this.child, _corr, 0, h, _p0, _p1);
    this.lastForce = lambda / (h * h);
  }

  solveLimits(h) {
    if (!this.hasLimits) return;
    this.getRelative(_qr);
    if (!this.clampRotation(_qr, _qr)) return;
    this._errorTo(_qr, _corr).negate();
    applyPairCorrection(this.parent, this.child, _corr, this.limitCompliance, h);
  }

  solveDrive(h) {
    this.lastDriveTorque = 0;
    if (!this.driveEnabled || this.stiffness <= 0) return;
    this._errorTo(this.target, _corr).negate();
    const lambda = applyPairCorrection(this.parent, this.child, _corr, 1 / this.stiffness, h, null, null, this.maxTorque * h * h);
    this.lastDriveTorque = lambda / (h * h);
  }

  /** Implicit joint damping towards the target's angular velocity. */
  solveVelocity(h) {
    if (!this.driveEnabled || this.damping <= 0) return;
    // Relative angular velocity minus the target's (in world).
    _w.subVectors(this.child.omega, this.parent.omega);
    _tv.copy(this.targetOmega).applyQuaternion(this.parent.q);
    _w.sub(_tv);
    const wl = _w.length();
    if (wl < 1e-9) return;
    _n.copy(_w).multiplyScalar(1 / wl);
    const wsum = this.parent.getInverseMass(_n, null) + this.child.getInverseMass(_n, null);
    if (wsum === 0) return;
    const c = this.damping;
    let J = (c * h * wl) / (1 + c * h * wsum);
    const Jmax = this.maxTorque * h;
    if (J > Jmax) J = Jmax;
    _n.multiplyScalar(J);
    this.parent.applyCorrection(_n, null, true);
    _n.negate();
    this.child.applyCorrection(_n, null, true);
  }
}
