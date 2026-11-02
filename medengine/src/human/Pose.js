import { Quaternion, Vector3 } from 'three';

const _a = new Vector3(), _b = new Vector3(), _d = new Vector3(), _q = new Quaternion(), _pw = new Quaternion(), _pwi = new Quaternion();

/**
 * Turns `bone` (in world space) so the direction from its head to `child`'s head points along
 * `dir` (world). Works with the world-aligned rest pose of Med Engine humans: the result is
 * stored as the bone's local rotation. `amount` < 1 turns part of the way.
 */
export function aimBone(bone, child, dir, amount = 1) {
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _d.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_d, _b.copy(dir).normalize());
  if (amount < 1) _q.slerp(new Quaternion(), 1 - amount);
  bone.parent.getWorldQuaternion(_pw);
  _pwi.copy(_pw).invert();
  // local' = pw^-1 * q * pw * local
  bone.quaternion.premultiply(_pw).premultiply(_q).premultiply(_pwi);
  bone.updateWorldMatrix(false, true);
}

/** Rotates a bone by an extra rotation expressed in world axes. */
export function rotateWorld(bone, axis, angle) {
  bone.parent.getWorldQuaternion(_pw);
  _pwi.copy(_pw).invert();
  _q.setFromAxisAngle(_a.copy(axis).normalize(), angle);
  bone.quaternion.premultiply(_pw).premultiply(_q).premultiply(_pwi);
  bone.updateWorldMatrix(false, true);
}

/** Resets every bone to the rest pose. */
export function restPose(human) {
  for (const b of human.boneList) b.quaternion.identity();
  human.root.updateMatrixWorld(true);
}
