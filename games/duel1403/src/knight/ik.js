import { Vector3, Quaternion } from 'three';
import { quatFromTwoAxes } from '../physics/math.js';

const _u = new Vector3(), _p = new Vector3(), _e = new Vector3(), _t = new Vector3();
const _d1 = new Vector3(), _d2 = new Vector3(), _h = new Vector3();
const _bu = new Vector3(), _bl = new Vector3(), _fp = new Vector3();

/**
 * Analytic two-bone IK (shoulder-elbow-hand or hip-knee-ankle).
 * Writes world orientations for the upper and lower segments so the middle
 * joint only bends about its hinge. Returns distance / max reach.
 */
export function solveTwoBone(root, target, pole, bone, outUpperQ, outLowerQ, outMid = null, fallbackPole = null) {
  const L1 = bone.L1, L2 = bone.L2;
  _t.subVectors(target, root);
  let d = _t.length();
  const reach = d / (L1 + L2);
  const dMin = Math.abs(L1 - L2) + 1e-3, dMax = L1 + L2 - 1e-4;
  if (d < 1e-6) { _t.set(0, -1, 0); d = dMin; }
  _u.copy(_t).normalize();
  d = Math.min(Math.max(d, dMin), dMax);

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

  _h.crossVectors(_p, _u).normalize();
  _d1.subVectors(_e, root).normalize();
  _d2.copy(root).addScaledVector(_u, d).sub(_e).normalize();

  _bu.subVectors(bone.upperMid, bone.upperRoot).normalize();
  _bl.subVectors(bone.lowerEnd, bone.lowerMid).normalize();
  quatFromTwoAxes(_bu, bone.hingeAxis, _d1, _h, outUpperQ);
  quatFromTwoAxes(_bl, bone.hingeAxis, _d2, _h, outLowerQ);
  return reach;
}

const _f = new Vector3(), _up = new Vector3();
export const X = new Vector3(1, 0, 0);
export const Y = new Vector3(0, 1, 0);
export const Z = new Vector3(0, 0, 1);

/** Orientation looking along `forward` (local +Z) with `up` as the up hint (local +Y). */
export function lookRotation(forward, up, out) {
  _f.copy(forward).normalize();
  _up.copy(up);
  return quatFromTwoAxes(Z, Y, _f, _up, out);
}

/** Weapon orientation: local +Y along `dir`, local +X towards `edge`. */
export function weaponRotation(dir, edge, out) {
  return quatFromTwoAxes(Y, X, dir, edge, out);
}

export function yawQuat(yaw, out = new Quaternion()) {
  return out.setFromAxisAngle(Y, yaw);
}
