import { Quaternion, Vector3, Matrix4, Euler, MathUtils } from 'three';

/**
 * Med Engine 2 rig: a pose language for the digital humans.
 *
 * A pose is plain data, so poses blend by interpolating numbers and are easy to author:
 *
 *   {
 *     pelvis: { pos: [x, y, z] (m, root frame), rot: [pitch, yaw, roll] (deg) },
 *     spine:  [pitch, yaw, roll]   total over the three spine bones (pitch + = bend forward)
 *     neck:   [pitch, yaw, roll],  head: [pitch, yaw, roll]
 *     armL / armR: {
 *       hand:  [out, up, fwd]  wrist position relative to the shoulder, chest frame, metres
 *                              (out = away from the body's midline on that side)
 *       elbow: [out, up, fwd]  where the elbow should point (pole direction)
 *       fingers: [out, up, fwd] direction the fingers point; palm: [out, up, fwd] palm normal
 *       curl: 0..1 (fist), thumb: 0..1, spread: 0..1
 *       clavicle: [up, fwd] shrug angles in degrees
 *     }
 *     legL / legR: { foot: [out, lift, fwd] ankle: out/fwd relative to the hip (root frame), lift above the floor;
 *                    knee: [out, up, fwd] pole; toe: pitch of the foot (deg, + = toes up), yaw }
 *   }
 *
 * The solver runs two-bone IK for arms and legs with pole vectors, builds full bone rotations
 * (direction and twist) from rest-pose bases, and writes local quaternions for the world-aligned
 * rest skeleton of Med Engine humans. Missing fields fall back to NEUTRAL.
 */

export const NEUTRAL = {
  pelvis: { pos: [0, 0, 0], rot: [0, 0, 0] },
  spine: [2, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  armL: { hand: [0.07, -0.52, 0.05], elbow: [0.25, 0, -1], fingers: [0.05, -1, 0.25], palm: [-1, 0, 0.15], curl: 0.25, thumb: 0.2, spread: 0.1, clavicle: [0, 0] },
  armR: { hand: [0.07, -0.52, 0.05], elbow: [0.25, 0, -1], fingers: [0.05, -1, 0.25], palm: [-1, 0, 0.15], curl: 0.25, thumb: 0.2, spread: 0.1, clavicle: [0, 0] },
  legL: { foot: [0.0, 0, 0.0], knee: [0.08, 0, 1], toe: 0, yaw: 8 },
  legR: { foot: [0.0, 0, 0.0], knee: [0.08, 0, 1], toe: 0, yaw: 8 },
};

// ---------------------------------------------------------------------------
// Pose data helpers

/** Deep linear blend of two pose objects (numbers and number arrays). */
export function blendPose(a, b, t, out = {}) {
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const x = a?.[k], y = b?.[k];
    if (x === undefined) { out[k] = clonePose(y); continue; }
    if (y === undefined) { out[k] = clonePose(x); continue; }
    if (typeof x === 'number') out[k] = x + (y - x) * t;
    else if (Array.isArray(x)) out[k] = x.map((v, i) => v + ((y[i] ?? v) - v) * t);
    else if (typeof x === 'object') out[k] = blendPose(x, y, t, out[k] && typeof out[k] === 'object' ? out[k] : {});
    else out[k] = t < 0.5 ? x : y;
  }
  return out;
}
export function clonePose(p) { return p === undefined ? undefined : JSON.parse(JSON.stringify(p)); }
/** Fills missing fields from NEUTRAL (or a given base). */
export function completePose(p, base = NEUTRAL) {
  const out = clonePose(base);
  const merge = (o, s) => { for (const k in s) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) { o[k] = o[k] ?? {}; merge(o[k], s[k]); } else o[k] = Array.isArray(s[k]) ? [...s[k]] : s[k]; } };
  merge(out, p ?? {});
  return out;
}
/** Adds offsets (an "additive" layer: breathing, recoil...) to a complete pose. */
export function addPose(p, add, w = 1) {
  for (const k in add) {
    if (typeof add[k] === 'number') p[k] = (p[k] ?? 0) + add[k] * w;
    else if (Array.isArray(add[k])) { p[k] = p[k] ?? add[k].map(() => 0); add[k].forEach((v, i) => { p[k][i] = (p[k][i] ?? 0) + v * w; }); }
    else if (typeof add[k] === 'object') { p[k] = p[k] ?? {}; addPose(p[k], add[k], w); }
  }
  return p;
}

// ---------------------------------------------------------------------------

const _q = new Quaternion(), _q2 = new Quaternion(), _pw = new Quaternion(), _m = new Matrix4(), _e = new Euler();
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3(), _t = new Vector3(), _p = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3();
const D2R = Math.PI / 180;

/** Rotation taking the orthonormal frame (d0, s0) to (d1, s1) (secondary vectors orthogonalised). */
function lookRotation(d0, s0, d1, s1, out) {
  const basis = (d, s, m) => {
    _x.copy(d).normalize();
    _y.copy(s).addScaledVector(_x, -s.dot(_x));
    if (_y.lengthSq() < 1e-8) _y.set(Math.abs(_x.y) < 0.9 ? 0 : 1, Math.abs(_x.y) < 0.9 ? 1 : 0, 0).addScaledVector(_x, -(Math.abs(_x.y) < 0.9 ? _x.y : _x.x));
    _y.normalize();
    _z.crossVectors(_x, _y);
    return m.makeBasis(_x, _y, _z);
  };
  const m0 = basis(d0, s0, new Matrix4()), m1 = basis(d1, s1, new Matrix4());
  _m.copy(m1).multiply(m0.transpose());
  return out.setFromRotationMatrix(_m);
}

export class Rig {
  /** @param human a Human (src/human/Human.js) */
  constructor(human) {
    this.h = human;
    const B = this.B = human.bones;
    const rest = (n) => B[n].userData.rest.clone();
    this.rest = rest;
    const dir = (a, b) => rest(b).sub(rest(a)).normalize();
    const len = (a, b) => rest(b).distanceTo(rest(a));
    this.limbs = {};
    for (const s of ['l', 'r']) {
      const sign = s === 'l' ? 1 : -1;
      // palm normal at rest: from the knuckle line and the hand's length
      const knuckles = rest(`index_01_${s}`).sub(rest(`pinky_01_${s}`));
      const along = dir(`hand_${s}`, `middle_01_${s}`);
      const palm = new Vector3().crossVectors(knuckles, along).normalize().multiplyScalar(sign);
      this.limbs['arm' + s.toUpperCase()] = {
        side: sign, a: `upperarm_${s}`, b: `lowerarm_${s}`, c: `hand_${s}`, clav: `clavicle_${s}`,
        l1: len(`upperarm_${s}`, `lowerarm_${s}`), l2: len(`lowerarm_${s}`, `hand_${s}`),
        restA: dir(`upperarm_${s}`, `lowerarm_${s}`), restB: dir(`lowerarm_${s}`, `hand_${s}`),
        restHandDir: along, restPalm: palm,
        fingers: ['index', 'middle', 'ring', 'pinky'].map((f) => ({ bones: [1, 2, 3].map((k) => `${f}_0${k}_${s}`), restDir: dir(`${f}_01_${s}`, `${f}_02_${s}`) })),
        thumb: { bones: [1, 2, 3].map((k) => `thumb_0${k}_${s}`), restDir: dir(`thumb_01_${s}`, `thumb_02_${s}`) },
      };
      this.limbs['leg' + s.toUpperCase()] = {
        side: sign, a: `thigh_${s}`, b: `calf_${s}`, c: `foot_${s}`, ball: `ball_${s}`,
        l1: len(`thigh_${s}`, `calf_${s}`), l2: len(`calf_${s}`, `foot_${s}`),
        restA: dir(`thigh_${s}`, `calf_${s}`), restB: dir(`calf_${s}`, `foot_${s}`), restFoot: dir(`foot_${s}`, `ball_${s}`),
        ankleHeight: rest(`foot_${s}`).y,
      };
    }
    this.pelvisRest = rest('pelvis');
    this.spineBones = ['spine_01', 'spine_02', 'spine_03'];
    this.lookTarget = null;       // world point the head and eyes turn to
    this.lookWeight = 0;
    this.eyeTarget = null;        // eyes only (saccades are added by the face)
    this.eyeOffset = [0, 0];      // radians, small eye darts
    this.pose = completePose({});
  }

  /** Root frame: the character root's world quaternion. */
  _rootQ(out) { return this.h.root.getWorldQuaternion(out); }

  _setLocalFromWorld(bone, worldQ) {
    bone.parent.getWorldQuaternion(_pw);
    bone.quaternion.copy(_pw.invert().multiply(worldQ));
    bone.updateWorldMatrix(false, true);
  }

  _euler(bone, deg, frac = 1) {
    _e.set(deg[0] * D2R * frac, deg[1] * D2R * frac, deg[2] * D2R * frac, 'YXZ');
    bone.quaternion.setFromEuler(_e);
  }

  /** Solves and applies a pose (complete it first, or pass partials: they are completed). */
  apply(pose) {
    const P = pose.armL && pose.legR ? pose : completePose(pose);
    this.pose = P;
    const B = this.B, h = this.h;
    for (const b of h.boneList) b.quaternion.identity();
    // torso
    B.pelvis.position.copy(this.pelvisRest).add(_a.fromArray(P.pelvis.pos));
    this._euler(B.pelvis, P.pelvis.rot);
    for (const n of this.spineBones) this._euler(B[n], P.spine, 1 / 3);
    this._euler(B.neck_01, P.neck);
    this._euler(B.head, P.head);
    h.root.updateMatrixWorld(true);
    // look-at: head and neck turn toward the target, over what the pose asks
    if (this.lookTarget && this.lookWeight > 0) this._look();
    // arms
    for (const k of ['armL', 'armR']) this._arm(this.limbs[k], P[k]);
    // legs
    for (const k of ['legL', 'legR']) this._leg(this.limbs[k], P[k]);
    this._eyes();
  }

  _look() {
    const B = this.B;
    B.head.getWorldPosition(_a);
    _d.copy(this.lookTarget).sub(_a);
    // in the chest frame
    B.spine_03.getWorldQuaternion(_q).invert();
    _d.applyQuaternion(_q).normalize();
    let yaw = Math.atan2(_d.x, _d.z), pitch = -Math.asin(MathUtils.clamp(_d.y, -1, 1));
    yaw = MathUtils.clamp(yaw, -1.2, 1.2) * this.lookWeight; pitch = MathUtils.clamp(pitch, -0.6, 0.7) * this.lookWeight;
    _e.set(pitch * 0.4, yaw * 0.45, 0, 'YXZ'); B.neck_01.quaternion.multiply(_q.setFromEuler(_e));
    _e.set(pitch * 0.6, yaw * 0.55, 0, 'YXZ'); B.head.quaternion.multiply(_q.setFromEuler(_e));
    B.neck_01.updateWorldMatrix(false, true);
  }

  _eyes() {
    const B = this.B;
    const target = this.eyeTarget ?? this.lookTarget;
    for (const n of ['eye_l', 'eye_r']) {
      const e = B[n];
      e.quaternion.identity();
      e.updateWorldMatrix(true, false);
      if (target) {
        e.getWorldPosition(_a);
        _d.copy(target).sub(_a).normalize();
        B.head.getWorldQuaternion(_q);
        _t.copy(_d).applyQuaternion(_q2.copy(_q).invert());
        let yaw = Math.atan2(_t.x, _t.z), pitch = -Math.asin(MathUtils.clamp(_t.y, -1, 1));
        yaw = MathUtils.clamp(yaw + this.eyeOffset[0], -0.55, 0.55); pitch = MathUtils.clamp(pitch + this.eyeOffset[1], -0.4, 0.4);
        _e.set(pitch, yaw, 0, 'YXZ');
        e.quaternion.setFromEuler(_e);
      } else if (this.eyeOffset[0] || this.eyeOffset[1]) {
        _e.set(this.eyeOffset[1], this.eyeOffset[0], 0, 'YXZ'); e.quaternion.setFromEuler(_e);
      }
      e.updateWorldMatrix(false, true);
    }
  }

  /** Two-bone IK: start a, lengths, target t, pole p (world). Returns the elbow/knee position. */
  _ik(a, l1, l2, target, pole, outMid) {
    _d.copy(target).sub(a);
    let dist = _d.length();
    const reach = (l1 + l2) * 0.999;
    if (dist > reach) { _d.multiplyScalar(reach / dist); dist = reach; }
    dist = Math.max(dist, Math.abs(l1 - l2) + 1e-3);
    _d.normalize();
    const cosA = MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1).addScaledVector(_d, -_d.z);
    _p.normalize();
    outMid.copy(a).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
    return dist;
  }

  _arm(L, S) {
    const B = this.B, side = L.side;
    const chestQ = B.spine_03.getWorldQuaternion(new Quaternion());
    const toWorld = (v) => new Vector3(v[0] * side, v[1], v[2]).applyQuaternion(chestQ);
    // clavicle shrug
    const cl = S.clavicle ?? [0, 0];
    _e.set(0, -cl[1] * D2R * side, cl[0] * D2R * side, 'YXZ');
    B[L.clav].quaternion.setFromEuler(_e);
    B[L.clav].updateWorldMatrix(false, true);
    const shoulder = B[L.a].getWorldPosition(new Vector3());
    const target = shoulder.clone().add(toWorld(S.hand));
    const pole = toWorld(S.elbow ?? [0.25, 0, -1]);
    const elbow = new Vector3();
    this._ik(shoulder, L.l1, L.l2, target, pole, elbow);
    const upper = elbow.clone().sub(shoulder).normalize();
    const lower = target.clone().sub(elbow).normalize();
    // the twist: rest "elbow back" frame to the solved bend plane
    const restPole = new Vector3(0, 0, -1);
    lookRotation(L.restA, restPole, upper, pole, _q);
    this._setLocalFromWorld(B[L.a], _q);
    lookRotation(L.restB, restPole, lower, pole, _q);
    this._setLocalFromWorld(B[L.b], _q);
    // hand: finger direction and palm normal
    const fingers = toWorld(S.fingers ?? [0, -1, 0.2]);
    const palm = toWorld(S.palm ?? [-1, 0, 0]);
    lookRotation(L.restHandDir, L.restPalm, fingers, palm, _q);
    this._setLocalFromWorld(B[L.c], _q);
    // fingers curl around the axis across the knuckles (local frame = rest frame)
    const curl = S.curl ?? 0.2, thumb = S.thumb ?? 0.2, spread = S.spread ?? 0;
    const axis = new Vector3();
    L.fingers.forEach((f, i) => {
      axis.crossVectors(f.restDir, L.restPalm).normalize();
      const amt = [1.0, 1.15, 0.9][0];
      const angles = [curl * 1.45 * amt, curl * 1.7, curl * 1.1];
      f.bones.forEach((bn, k) => {
        B[bn].quaternion.setFromAxisAngle(axis, -angles[k] * side * (k === 0 ? 1 : 1));
        if (k === 0 && spread) B[bn].quaternion.multiply(_q2.setFromAxisAngle(L.restPalm, (i - 1.5) * 0.12 * spread * side));
      });
    });
    axis.crossVectors(L.thumb.restDir, L.restPalm).normalize();
    L.thumb.bones.forEach((bn, k) => { B[bn].quaternion.setFromAxisAngle(axis, -thumb * [0.5, 0.7, 0.8][k] * side); });
    B[L.c].updateWorldMatrix(false, true);
  }

  _leg(L, S) {
    const B = this.B, side = L.side;
    const rootQ = this._rootQ(new Quaternion());
    const toWorld = (v) => new Vector3(v[0] * side, v[1], v[2]).applyQuaternion(rootQ);
    const hip = B[L.a].getWorldPosition(new Vector3());
    // horizontal place from the hip, height from the floor the actor stands on
    const target = hip.clone().add(toWorld([S.foot[0], 0, S.foot[2]]));
    target.y = this.h.root.getWorldPosition(_c).y + L.ankleHeight + (S.foot[1] ?? 0) + (this.floorOffset?.[L.side > 0 ? 0 : 1] ?? 0);
    const pole = toWorld(S.knee ?? [0.08, 0, 1]);
    const knee = new Vector3();
    this._ik(hip, L.l1, L.l2, target, pole, knee);
    const upper = knee.clone().sub(hip).normalize();
    const lower = target.clone().sub(knee).normalize();
    const restPole = new Vector3(0, 0, 1);
    lookRotation(L.restA, restPole, upper, pole, _q);
    this._setLocalFromWorld(B[L.a], _q);
    lookRotation(L.restB, restPole, lower, pole, _q);
    this._setLocalFromWorld(B[L.b], _q);
    // foot: flat by default, yawed outward, pitched by `toe`
    const yaw = (S.yaw ?? 6) * D2R * side, pitch = (S.toe ?? 0) * D2R;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).applyAxisAngle(new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), -pitch).applyQuaternion(rootQ);
    const restFwd = new Vector3(L.restFoot.x, 0, L.restFoot.z).normalize();
    lookRotation(restFwd, new Vector3(0, 1, 0), fwd, new Vector3(0, 1, 0).applyQuaternion(rootQ), _q);
    this._setLocalFromWorld(B[L.c], _q);
  }
}
