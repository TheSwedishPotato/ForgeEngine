import { Vector3, Quaternion } from 'three';
import { quatFromTwoAxes } from '../physics/math.js';

const _u = new Vector3(), _p = new Vector3(), _e = new Vector3(), _t = new Vector3();
const _d1 = new Vector3(), _d2 = new Vector3(), _h = new Vector3();
const _bu = new Vector3(), _bl = new Vector3(), _fp = new Vector3();

/**
 * Analytic two-bone IK (shoulder-elbow-glove or hip-knee-ankle).
 *
 * root   : world position of the proximal joint
 * target : desired world position of the end effector
 * pole   : world direction the middle joint should bulge towards
 * bone   : bone description from Ragdoll.bones (local rest geometry)
 *
 * Writes world orientations for the upper and lower segments, such that the
 * middle joint only rotates about its hinge axis. Returns the reach ratio
 * (distance / max reach) so callers can tell when a target is out of range.
 */
export function solveTwoBone(root, target, pole, bone, outUpperQ, outLowerQ, outMid = null, fallbackPole = null) {
  const L1 = bone.L1, L2 = bone.L2;
  _t.subVectors(target, root);
  let d = _t.length();
  const reach = d / (L1 + L2);
  const dMin = Math.abs(L1 - L2) + 1e-3, dMax = L1 + L2 - 1e-4;
  if (d < 1e-6) _t.set(0, -1, 0), d = dMin;
  _u.copy(_t).normalize();
  d = Math.min(Math.max(d, dMin), dMax);

  // The pole only fixes the elbow/knee plane; when it is nearly parallel to
  // the limb that plane is ill-defined, so blend towards the fallback pole
  // to avoid the solution flipping from frame to frame.
  _p.copy(pole).normalize();
  const par = Math.abs(_p.dot(_u));
  if (fallbackPole && par > 0.8) {
    _fp.copy(fallbackPole).normalize();
    _p.lerp(_fp, Math.min(1, (par - 0.8) / 0.15));
  }
  _p.addScaledVector(_u, -_p.dot(_u));
  if (_p.lengthSq() < 1e-8) {
    _p.set(0, 0, 1).addScaledVector(_u, -_u.z);
    if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0).addScaledVector(_u, -_u.x);
  }
  _p.normalize();

  const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const a = L1 * Math.min(1, Math.max(-1, cosA));
  const b = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _e.copy(root).addScaledVector(_u, a).addScaledVector(_p, b);
  if (outMid) outMid.copy(_e);

  // Hinge axis in world: rotating the upper bone direction onto the lower one.
  _h.crossVectors(_p, _u).normalize();

  _d1.subVectors(_e, root).normalize();
  _d2.copy(root).addScaledVector(_u, d).sub(_e).normalize();

  _bu.subVectors(bone.upperMid, bone.upperRoot).normalize();
  _bl.subVectors(bone.lowerEnd, bone.lowerMid).normalize();
  quatFromTwoAxes(_bu, bone.hingeAxis, _d1, _h, outUpperQ);
  quatFromTwoAxes(_bl, bone.hingeAxis, _d2, _h, outLowerQ);
  return reach;
}

/** Orientation looking along `forward` with `up` as the up hint (local +Z forward, +Y up). */
const _f = new Vector3(), _up = new Vector3();
export function lookRotation(forward, up, out) {
  _f.copy(forward).normalize();
  _up.copy(up);
  return quatFromTwoAxes(Z, Y, _f, _up, out);
}

export const X = new Vector3(1, 0, 0);
export const Y = new Vector3(0, 1, 0);
export const Z = new Vector3(0, 0, 1);

export function yawQuat(yaw, out = new Quaternion()) {
  return out.setFromAxisAngle(Y, yaw);
}
