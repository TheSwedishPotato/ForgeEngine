/**
 * Motion retargeting: plays a motion-capture performance on a different skeleton.
 *
 * The source (a BVH file) and the target (a character's bones) differ in proportions and, usually,
 * in their rest pose: the capture's T-pose against a character modelled with arms angled down. So
 * rotations cannot be copied. The method here keeps what a performance *means*:
 *
 *   limbs   (swing + twist)  each target bone points where the source bone points, in world space, and
 *                            carries the same twist about its own axis (relative to the rest pose),
 *   torso   (delta)          spine, neck, head: the source bone's world rotation relative to its rest
 *                            pose is applied on top of the target's rest orientation,
 *   root                     the hips' travel is scaled by the ratio of leg lengths, so strides fit,
 *                            and the clip is turned to start facing +Z at the origin,
 *   ground (optional)        the pelvis height is corrected so planted feet stay on the floor.
 *
 * Everything is computed from joint world rotations only, so a bone's result never depends on the
 * noise of its children. The output is an AnimationClip of local rotations in the target's own
 * bone frames (and a position track for the pelvis).
 */
import { Quaternion, Vector3 } from '../math/core.js';
import { Track, AnimationClip } from './Clip.js';

/** @import { BVHData } from './BVH.js' */

// ---------------------------------------------------------------------------------------------
// Mappings: target bone -> how it follows the source.
//   { delta: 'Joint' }                    world rotation delta of that source joint
//   { swing: ['JointA', 'JointB'], to }   direction of the A -> B segment + twist of A; `to` is the target bone it points at

const side = (s, S) => ({
  [`clavicle_${s}`]: { swing: [`${S}Shoulder`, `${S}Arm`], to: `upperarm_${s}` },
  [`upperarm_${s}`]: { swing: [`${S}Arm`, `${S}ForeArm`], to: `lowerarm_${s}` },
  [`lowerarm_${s}`]: { swing: [`${S}ForeArm`, `${S}Hand`], to: `hand_${s}` },
  [`hand_${s}`]: { swing: [`${S}Hand`, `${S}HandIndex1`], to: `middle_01_${s}` },
  [`thigh_${s}`]: { swing: [`${S}UpLeg`, `${S}Leg`], to: `calf_${s}` },
  [`calf_${s}`]: { swing: [`${S}Leg`, `${S}Foot`], to: `foot_${s}` },
  [`foot_${s}`]: { swing: [`${S}Foot`, `${S}ToeBase`], to: `ball_${s}` },
  [`ball_${s}`]: { delta: `${S}ToeBase` },
});

/** The Carnegie Mellon capture database as converted by cgspeed (MotionBuilder-friendly BVH) -> Med Engine / MakeHuman bone names. */
export const CMU_TO_MEDENGINE = {
  pelvis: { delta: 'Hips', position: 'Hips' },
  spine_01: { delta: 'LowerBack' },
  spine_02: { delta: 'Spine' },
  spine_03: { delta: 'Spine1' },
  neck_01: { delta: 'Neck1' },
  head: { delta: 'Head' },
  ...side('l', 'Left'), ...side('r', 'Right'),
};

/** Mixamo / Unity humanoid style names (after stripping an `mixamorig:` prefix) -> Med Engine. */
export const MIXAMO_TO_MEDENGINE = (() => {
  const m = {
    pelvis: { delta: 'Hips', position: 'Hips' },
    spine_01: { delta: 'Spine' }, spine_02: { delta: 'Spine1' }, spine_03: { delta: 'Spine2' },
    neck_01: { delta: 'Neck' }, head: { delta: 'Head' },
  };
  for (const [s, S] of [['l', 'Left'], ['r', 'Right']]) {
    Object.assign(m, {
      [`clavicle_${s}`]: { swing: [`${S}Shoulder`, `${S}Arm`], to: `upperarm_${s}` },
      [`upperarm_${s}`]: { swing: [`${S}Arm`, `${S}ForeArm`], to: `lowerarm_${s}` },
      [`lowerarm_${s}`]: { swing: [`${S}ForeArm`, `${S}Hand`], to: `hand_${s}` },
      [`hand_${s}`]: { swing: [`${S}Hand`, `${S}HandMiddle1`], to: `middle_01_${s}` },
      [`thigh_${s}`]: { swing: [`${S}UpLeg`, `${S}Leg`], to: `calf_${s}` },
      [`calf_${s}`]: { swing: [`${S}Leg`, `${S}Foot`], to: `foot_${s}` },
      [`foot_${s}`]: { swing: [`${S}Foot`, `${S}ToeBase`], to: `ball_${s}` },
      [`ball_${s}`]: { delta: `${S}ToeBase` },
    });
  }
  return m;
})();

/** Picks a known mapping for a BVH by its joint names (`null` when none fits). */
export function guessMapping(bvh) {
  const names = new Set(bvh.joints.map((j) => j.name.replace(/^mixamorig:?/i, '')));
  const has = (...n) => n.every((x) => names.has(x));
  if (has('Hips', 'LowerBack', 'Spine1', 'Neck1', 'LeftUpLeg', 'LeftHandIndex1')) return { name: 'cmu', map: CMU_TO_MEDENGINE, prefix: '' };
  if (has('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftUpLeg')) {
    const raw = bvh.joints.find((j) => /^mixamorig:?Hips$/i.test(j.name));
    return { name: 'mixamo', map: MIXAMO_TO_MEDENGINE, prefix: raw ? raw.name.slice(0, raw.name.length - 4) : '' };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Target skeleton description

/**
 * Every bone's world rotation and head position, as `RigInfo.sample` returns them (indexed like `rig.bones`).
 * @typedef {{ q: Quaternion[], p: Vector3[] }} BonePoses
 */

export class RigInfo {
  /**
   * @param {{name:string, parent:string|null, localPos:number[], restQ?:number[], head?:number[]}[]} bones  parents before children;
   *   `localPos` the bone's position in its parent's frame, `restQ` its rest world rotation (default identity: a world-aligned rig).
   */
  constructor(bones) {
    this.bones = bones;
    this.index = new Map(bones.map((b, i) => [b.name, i]));
    const n = bones.length;
    this.parent = new Int32Array(n);
    this.restWorldQ = bones.map(() => new Quaternion());
    this.restLocalQ = bones.map(() => new Quaternion());
    this.restHead = bones.map(() => new Vector3());
    for (let i = 0; i < n; i++) {
      const b = bones[i], p = b.parent == null ? -1 : this.index.get(b.parent);
      if (p === undefined) throw new Error(`RigInfo: bone ${b.name} has unknown parent ${b.parent}`);
      this.parent[i] = p;
      if (b.restQ) this.restWorldQ[i].fromArray(b.restQ);
      if (p >= 0) {
        this.restLocalQ[i].copy(this.restWorldQ[p]).invert().multiply(this.restWorldQ[i]);
        this.restHead[i].fromArray(b.localPos).applyQuaternion(this.restWorldQ[p]).add(this.restHead[p]);
      } else { this.restLocalQ[i].copy(this.restWorldQ[i]); this.restHead[i].fromArray(b.localPos); }
    }
  }
  has(name) { return this.index.has(name); }
  head(name) { return this.restHead[this.index.get(name)]; }

  /**
   * Forward kinematics of a clip at time `t`: every bone's world rotation and head position (relative to the
   * character's root). Bones the clip does not drive keep their rest orientation relative to the parent.
   * @param {AnimationClip} clip
   * @param {number} t  seconds into the clip
   * @param {BonePoses | null} [out]  filled in place when given
   * @returns {BonePoses}
   */
  sample(clip, t, out = null) {
    const n = this.bones.length;
    out ??= { q: Array.from({ length: n }, () => new Quaternion()), p: Array.from({ length: n }, () => new Vector3()) };
    const tq = new Float32Array(4), tp = new Float32Array(3);
    for (let b = 0; b < n; b++) {
      const name = this.bones[b].name, par = this.parent[b];
      const e = clip.byBone.get(name);
      if (e && e.q) { e.q.sample(t, tq, 0); _q.set(tq[0], tq[1], tq[2], tq[3]); } else _q.copy(this.restLocalQ[b]);
      if (e && e.p) { e.p.sample(t, tp, 0); _v.set(tp[0], tp[1], tp[2]); } else _v.fromArray(this.bones[b].localPos);
      if (par >= 0) { out.q[b].copy(out.q[par]).multiply(_q); out.p[b].copy(_v).applyQuaternion(out.q[par]).add(out.p[par]); }
      else { out.q[b].copy(_q); out.p[b].copy(_v); }
    }
    return out;
  }

  /** Reads the rest pose of a bone hierarchy (Object3D with `isBone` bones). Call `root.updateMatrixWorld(true)` in the rest pose first. */
  static fromObject3D(root) {
    root.updateMatrixWorld(true);
    const list = [];
    const visit = (o, parentBone) => {
      let pb = parentBone;
      if (o.isBone) {
        const wq = o.getWorldQuaternion(new Quaternion());
        list.push({ name: o.name, parent: parentBone ? parentBone.name : null, localPos: o.position.toArray(), restQ: wq.toArray() });
        pb = o;
      }
      for (const c of o.children) visit(c, pb);
    };
    visit(root, null);
    return new RigInfo(list);
  }
}

// ---------------------------------------------------------------------------------------------

const _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion();
const _u = new Vector3(), _v = new Vector3(), _w = new Vector3();

/** Shortest rotation taking unit vector a to unit vector b. */
function arc(a, b, out) {
  const d = a.dot(b);
  if (d > 0.999999) return out.identity();
  if (d < -0.999999) {
    _w.set(1, 0, 0).cross(a); if (_w.lengthSq() < 1e-6) _w.set(0, 1, 0).cross(a);
    return out.setFromAxisAngle(_w.normalize(), Math.PI);
  }
  return out.setFromUnitVectors(a, b);
}

export class Retargeter {
  /**
   * @param {BVHData} bvh   the performance
   * @param {RigInfo} rig   the character's rest pose
   * @param {object} [o]
   * @param {object} [o.map]        mapping (default: guessed from the BVH's joint names)
   * @param {number} [o.fps]        output sampling rate (default 30)
   * @param {number} [o.restFrame]  the source frame holding its rest pose (default 0: cgspeed adds a T-pose there)
   * @param {number} [o.firstFrame] first frame of the performance (default restFrame + 1 for a T-pose file, else 0)
   * @param {boolean} [o.groundFix] keep planted feet on the floor by correcting the pelvis height (default true)
   * @param {boolean} [o.faceForward] turn the clip to start facing +Z (default true)
   * @param {boolean} [o.inPlace]   drop the horizontal root travel (default false)
   */
  constructor(bvh, rig, o = {}) {
    this.bvh = bvh; this.rig = rig;
    const guess = o.map ? { map: o.map, prefix: o.prefix ?? '' } : guessMapping(bvh);
    if (!guess) throw new Error('Retargeter: could not recognise the BVH skeleton; pass a `map`');
    this.map = guess.map; this.prefix = guess.prefix ?? '';
    this.fps = o.fps ?? 30;
    this.restFrame = o.restFrame ?? 0;
    this.firstFrame = o.firstFrame ?? (this.restFrame === 0 && bvh.frames > 1 ? 1 : 0);
    this.groundFix = o.groundFix ?? true;
    this.faceForward = o.faceForward ?? true;
    this.inPlace = !!o.inPlace;
    this.report = { mapped: [], missingTarget: [], missingSource: [] };
    this._prepare();
  }

  _joint(name) { const i = this.bvh.index(this.prefix + name); return i; }

  _prepare() {
    const { bvh, rig } = this;
    const rest = bvh.pose(this.restFrame);
    this.rest = rest;
    const jq = (i) => new Quaternion(rest.q[i * 4], rest.q[i * 4 + 1], rest.q[i * 4 + 2], rest.q[i * 4 + 3]);
    const jp = (i) => new Vector3(rest.p[i * 3], rest.p[i * 3 + 1], rest.p[i * 3 + 2]);
    this.entries = [];
    for (const [target, m] of Object.entries(this.map)) {
      if (!rig.has(target)) { this.report.missingTarget.push(target); continue; }
      const e = { target, ti: rig.index.get(target), kind: m.delta ? 'delta' : 'swing' };
      if (m.delta) {
        e.si = this._joint(m.delta);
        if (e.si < 0) { this.report.missingSource.push(m.delta); continue; }
        e.restInv = jq(e.si).invert();
      } else {
        const a = this._joint(m.swing[0]), b = this._joint(m.swing[1]);
        if (a < 0 || b < 0 || !rig.has(m.to)) { if (a < 0) this.report.missingSource.push(m.swing[0]); if (b < 0) this.report.missingSource.push(m.swing[1]); if (!rig.has(m.to)) this.report.missingTarget.push(m.to); continue; }
        e.si = a;
        e.restInv = jq(a).invert();
        e.u0 = jp(b).sub(jp(a));
        if (e.u0.lengthSq() < 1e-10) { this.report.missingSource.push(`${m.swing.join('->')} (zero length)`); continue; }
        e.u0.normalize();
        e.g0 = rig.head(m.to).clone().sub(rig.restHead[e.ti]);
        if (e.g0.lengthSq() < 1e-10) { this.report.missingTarget.push(`${target}->${m.to} (zero length)`); continue; }
        e.g0.normalize();
      }
      this.entries.push(e);
      this.report.mapped.push(target);
    }
    // order: parents first (RigInfo is already parents-first)
    this.entries.sort((x, y) => x.ti - y.ti);
    // pelvis / root
    const pm = this.map.pelvis;
    this.rootSrc = pm?.position ? this._joint(pm.position) : -1;
    this.pelvisIndex = rig.index.get('pelvis') ?? -1;
    // scale: target leg length over the source leg length (hip -> ankle)
    const lenS = (n) => { const i = this._joint(n); return i < 0 ? 0 : Math.hypot(...bvh.joints[i].offset); };
    const srcLeg = lenS('LeftLeg') + lenS('LeftFoot');
    const tgtLeg = rig.has('calf_l') && rig.has('foot_l') && rig.has('thigh_l') ? rig.head('calf_l').distanceTo(rig.head('thigh_l')) + rig.head('foot_l').distanceTo(rig.head('calf_l')) : 0;
    this.scale = srcLeg > 0 && tgtLeg > 0 ? tgtLeg / srcLeg : 1;
    // feet, for finding the floor: the toe joints of the performer and of the character. The capture's
    // own rest frame cannot say where the floor is (the T-pose frame cgspeed prepends floats at an
    // arbitrary height), so the floor is read from the performance: where the lowest toe goes when planted.
    this.srcToes = ['LeftToeBase', 'RightToeBase'].map((n) => this._joint(n)).filter((i) => i >= 0);
    this.tgtToes = ['ball_l', 'ball_r'].filter((n) => rig.has(n));
    this.tgtToeRef = this.tgtToes.length ? Math.min(...this.tgtToes.map((n) => rig.head(n).y)) : 0;
  }

  /** Heading (yaw, radians) of the performer at a frame: which way the body faces, from hips and shoulders. */
  _heading(frame) {
    const p = this.bvh.pose(frame).p;
    const at = (n) => { const i = this._joint(n); return i < 0 ? null : [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]; };
    const lh = at('LeftUpLeg'), rh = at('RightUpLeg'), ls = at('LeftArm'), rs = at('RightArm');
    let lx = 0, lz = 0;
    if (lh && rh) { lx += lh[0] - rh[0]; lz += lh[2] - rh[2]; }
    if (ls && rs) { lx += ls[0] - rs[0]; lz += ls[2] - rs[2]; }
    // left = (1,0,0) when facing +Z; forward = left x up = (lx,0,lz) x (0,1,0) = (-lz*1... ) -> (−0, ..) compute directly
    const fx = -lz * 1, fz = lx;       // (lx,0,lz) x (0,1,0) = (0*0 - lz*1, lz*0 - lx*0, lx*1 - 0*0) = (-lz, 0, lx)
    return Math.atan2(fx, fz);
  }

  /** Samples frame positions with interpolation: world rotations (slerp) and positions (lerp) of the source. */
  _srcAt(s, outA, outB) {
    const f0 = Math.min(this.bvh.frames - 1, Math.max(0, Math.floor(s))), f1 = Math.min(this.bvh.frames - 1, f0 + 1), t = s - f0;
    this.bvh.pose(f0, 1, outA);
    if (t < 1e-6 || f1 === f0) return outA;
    this.bvh.pose(f1, 1, outB);
    const n = this.bvh.joints.length;
    for (let i = 0; i < n; i++) {
      _q.fromArray(outA.q, i * 4); _q2.fromArray(outB.q, i * 4); _q.slerp(_q2, t); _q.toArray(outA.q, i * 4);
      for (let k = 0; k < 3; k++) outA.p[i * 3 + k] += (outB.p[i * 3 + k] - outA.p[i * 3 + k]) * t;
    }
    return outA;
  }

  /** Runs the retargeting; returns an AnimationClip. */
  run(name = this.bvh.name || 'clip') {
    const { bvh, rig } = this;
    const n = bvh.joints.length, nb = rig.bones.length;
    const t0 = this.firstFrame * bvh.frameTime;
    const duration = Math.max(0, (bvh.frames - 1 - this.firstFrame)) * bvh.frameTime;
    const frames = Math.max(2, Math.round(duration * this.fps) + 1);
    const dt = 1 / this.fps;
    const bufA = { q: new Float64Array(n * 4), p: new Float64Array(n * 3) }, bufB = { q: new Float64Array(n * 4), p: new Float64Array(n * 3) };
    // heading: turn the performance to face +Z
    const yaw = this.faceForward ? this._heading(this.firstFrame) : 0;
    const R = new Quaternion().setFromAxisAngle(_u.set(0, 1, 0), -yaw);
    const c = Math.cos(-yaw), sn = Math.sin(-yaw);
    const first = bvh.pose(this.firstFrame);
    const ox = this.rootSrc >= 0 ? first.p[this.rootSrc * 3] : 0, oz = this.rootSrc >= 0 ? first.p[this.rootSrc * 3 + 2] : 0;

    const outQ = this.entries.map(() => new Float32Array(frames * 4));
    const pelvisP = new Float32Array(frames * 3);
    const worldQ = Array.from({ length: nb }, () => new Quaternion());
    const entryOf = new Map(this.entries.map((e, i) => [e.ti, i]));
    const restPelvis = this.pelvisIndex >= 0 ? rig.bones[this.pelvisIndex].localPos : [0, 0, 0];
    const dq = new Quaternion(), qs = new Quaternion(), qt = new Quaternion(), qg = new Quaternion(), tw = new Quaternion();
    const u = new Vector3(), tgtToeY = new Float64Array(frames), want = new Float64Array(frames);
    const lowSrc = new Float64Array(frames), hipsY = new Float64Array(frames);
    const srcRate = bvh.fps;
    for (let k = 0; k < frames; k++) {
      const s = this.firstFrame + (k * dt * srcRate);
      const S = this._srcAt(s, bufA, bufB);
      // world rotations of the source rotated to face +Z
      for (let i = 0; i < n; i++) { _q.fromArray(S.q, i * 4); _q.premultiply(R); _q.toArray(S.q, i * 4); }
      for (let b = 0; b < nb; b++) {
        const p = rig.parent[b];
        const e = entryOf.get(b);
        if (e === undefined) {
          // follows its parent in the rest relationship
          if (p >= 0) worldQ[b].copy(worldQ[p]).multiply(rig.restLocalQ[b]); else worldQ[b].copy(rig.restWorldQ[b]);
          continue;
        }
        const E = this.entries[e];
        _q.fromArray(S.q, E.si * 4);
        dq.copy(_q).multiply(E.restInv);                         // world delta of the source joint from its rest pose
        if (E.kind === 'delta') {
          worldQ[b].copy(dq).multiply(rig.restWorldQ[b]);
        } else {
          u.copy(E.u0).applyQuaternion(dq);                       // where the source bone points now
          arc(E.u0, u, qs);                                       // source swing
          tw.copy(qs).invert().multiply(dq);                      // what is left: a twist about u0
          let ang = 2 * Math.atan2(tw.x * E.u0.x + tw.y * E.u0.y + tw.z * E.u0.z, tw.w);
          if (ang > Math.PI) ang -= 2 * Math.PI; else if (ang < -Math.PI) ang += 2 * Math.PI;
          arc(E.g0, u, qg);                                       // target swing
          qt.setFromAxisAngle(E.g0, ang);
          worldQ[b].copy(qg).multiply(qt).multiply(rig.restWorldQ[b]);
        }
        // local rotation in the target's frame
        if (p >= 0) _q3.copy(worldQ[p]).invert().multiply(worldQ[b]); else _q3.copy(worldQ[b]);
        _q3.toArray(outQ[e], k * 4);
      }
      // root
      if (this.pelvisIndex >= 0 && this.rootSrc >= 0) {
        const i = this.rootSrc * 3;
        const dx = S.p[i] - ox, dz = S.p[i + 2] - oz;
        // the source positions were not rotated above (only rotations): do it here
        const rx = (dx * c + dz * sn), rz = (-dx * sn + dz * c);
        pelvisP[k * 3] = restPelvis[0] + (this.inPlace ? 0 : rx * this.scale);
        pelvisP[k * 3 + 2] = restPelvis[2] + (this.inPlace ? 0 : rz * this.scale);
        hipsY[k] = S.p[i + 1];
        let low = Infinity;
        for (const ti of this.srcToes) low = Math.min(low, S.p[ti * 3 + 1]);
        lowSrc[k] = low;
      }
    }
    // Heights. The floor of the performance is where its lowest toe sits when planted (2nd percentile
    // of the per-frame lowest toe, which shrugs off a stray noisy frame). The character's lowest toe
    // must be as far above its own floor as the performer's was above theirs, scaled by the leg ratio.
    if (this.pelvisIndex >= 0 && this.rootSrc >= 0) {
      const haveFeet = this.srcToes.length > 0 && this.tgtToes.length > 0;
      const sorted = Float64Array.from(lowSrc).sort();
      const floor = haveFeet ? sorted[Math.min(frames - 1, Math.floor(frames * 0.02))] : 0;
      this.floorSrc = floor;
      for (let k = 0; k < frames; k++) {
        want[k] = this.tgtToeRef + (lowSrc[k] - floor) * this.scale;
        pelvisP[k * 3 + 1] = haveFeet
          ? this.tgtToeRef + (hipsY[k] - floor) * this.scale                       // pelvis above the floor, scaled
          : restPelvis[1] + (hipsY[k] - hipsY[0]) * this.scale;                    // no feet to go by: relative to the first frame
      }
      // ground correction: simulate the target's feet with the computed pose and nudge the pelvis height
      if (this.groundFix && haveFeet) this._fixGround(outQ, entryOf, pelvisP, frames, want, tgtToeY);
    }

    const tracks = [];
    this.entries.forEach((E, e) => tracks.push(new Track(E.target, 'quaternion', outQ[e], null, dt)));
    if (this.pelvisIndex >= 0 && this.rootSrc >= 0) tracks.push(new Track('pelvis', 'position', pelvisP, null, dt));
    const clip = new AnimationClip(name, tracks, { duration: (frames - 1) * dt, meta: { source: bvh.name, fps: this.fps, scale: this.scale, mapped: this.report.mapped.length, t0 } });
    clip.rootBone = this.pelvisIndex >= 0 && this.rootSrc >= 0 ? 'pelvis' : null;
    return clip;
  }

  _fixGround(outQ, entryOf, pelvisP, frames, want, actual) {
    const rig = this.rig, nb = rig.bones.length;
    const wq = Array.from({ length: nb }, () => new Quaternion()), wp = Array.from({ length: nb }, () => new Vector3());
    const local = new Quaternion(), lp = new Vector3();
    const toes = this.tgtToes.map((nme) => rig.index.get(nme));
    for (let k = 0; k < frames; k++) {
      for (let b = 0; b < nb; b++) {
        const e = entryOf.get(b), p = rig.parent[b];
        if (e !== undefined) local.fromArray(outQ[e], k * 4); else local.copy(rig.restLocalQ[b]);
        lp.fromArray(b === this.pelvisIndex ? pelvisP.subarray(k * 3, k * 3 + 3) : rig.bones[b].localPos);
        if (p >= 0) { wq[b].copy(wq[p]).multiply(local); wp[b].copy(lp).applyQuaternion(wq[p]).add(wp[p]); }
        else { wq[b].copy(local); wp[b].copy(lp); }
      }
      let low = Infinity;
      for (const t of toes) low = Math.min(low, wp[t].y);
      actual[k] = low;
    }
    // delta between where the lowest toe should be and where it is, smoothed over 5 frames
    const d = new Float64Array(frames);
    for (let k = 0; k < frames; k++) d[k] = want[k] - actual[k];
    for (let k = 0; k < frames; k++) {
      let s = 0, w = 0;
      for (let j = -2; j <= 2; j++) { const kk = Math.min(frames - 1, Math.max(0, k + j)), ww = 3 - Math.abs(j); s += d[kk] * ww; w += ww; }
      pelvisP[k * 3 + 1] += s / w;
    }
  }
}

/**
 * Retargets a BVH onto a rig in one call.
 * @returns {AnimationClip}
 */
export function retargetBVH(bvh, rig, opts = {}) {
  const r = new Retargeter(bvh, rig, opts);
  const clip = r.run(opts.name);
  clip.loop = !!opts.loop;
  clip.meta.report = r.report;
  return clip;
}
