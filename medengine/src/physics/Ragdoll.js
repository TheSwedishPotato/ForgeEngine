/**
 * A ragdoll for a humanoid skeleton: sixteen capsule bodies (hips, abdomen, chest, head, and per side upper arm,
 * forearm, hand, thigh, calf, foot) joined by ball joints with swing and twist limits and hinges with angle limits
 * at the knees and elbows. It is built from the bones' positions and orientations, so it can start from any pose,
 * with the momentum the limbs had when you called `track()` in the frames before.
 *
 *   const ragdoll = new Ragdoll(humanoid, world);   // the rig in its rest pose
 *   // while animated, once per frame (optional, gives the limbs their velocity):
 *   ragdoll.track(dt);
 *   // on a hit:
 *   ragdoll.activate({ velocity: hero.velocity, impulse: { point, vector } });
 *   // every frame afterwards, after world.step():
 *   ragdoll.update();                               // writes the bodies' rotations into the bones
 *   // to get up:
 *   const pose = ragdoll.snapshotClip();            // cross-fade from this into a get-up clip
 *   ragdoll.deactivate();
 *
 * `rig` is anything with `{ root, bones }` where `bones` maps the Med Engine bone names (see HUMANOID_BONES) to
 * Object3Ds: an anim/Humanoid, or a loaded character. Bones a rig lacks are skipped along with the parts that need
 * them. Parts of one ragdoll never collide with each other (limits keep the pose plausible); they collide with
 * the world and with other bodies.
 */
import { Vector3, Quaternion } from '../math/core.js';
import { RigidBody } from './Body.js';
import { BallJoint, HingeJoint } from './Joints.js';
import { Track, AnimationClip } from '../anim/Clip.js';

/**
 * @import { Object3D } from '../scene/Object3D.js'
 * @import { World } from './World.js'
 */

/**
 * What `new Ragdoll(rig, world, o)` takes.
 * @typedef {object} RagdollOptions
 * @property {number | null} [scale]   body size relative to a 1.75 m person (default: measured from the rig)
 * @property {number} [mass]           total mass in kg (77)
 * @property {number} [friction]       0.8
 * @property {number} [restitution]    0
 * @property {number} [jointFriction]  resistance of the joints in N*m (1.5)
 * @property {number} [angularDamping] 0.9
 * @property {number} [linearDamping]  0.05
 */

const DEG = Math.PI / 180;
let _group = 1000;
const _p = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _v = new Vector3(), _w = new Vector3(), _a = new Vector3(), _b = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Joint limits in degrees. Hinge angles are flexion: 0 = straight, positive = bending the knee/elbow. */
export const RAGDOLL_LIMITS = {
  abdomen: { cone: 30, twist: [-25, 25] },
  chest: { cone: 35, twist: [-30, 30] },
  head: { cone: 50, twist: [-55, 55] },
  upperarm: { cone: 125, twist: [-85, 65] },
  forearm: { hinge: [-5, 150] },
  hand: { cone: 65, twist: [-30, 30] },
  thigh: { cone: 95, twist: [-40, 40] },
  calf: { hinge: [-5, 150] },
  foot: { cone: 45, twist: [-18, 18] },
};

export class Ragdoll {
  /**
   * @param {{ root: Object3D, bones: Record<string, Object3D> }} rig  in its rest pose
   * @param {World} world
   * @param {RagdollOptions} [o]
   */
  constructor(rig, world, { scale = null, mass = 77, friction = 0.8, restitution = 0, jointFriction = 1.5, angularDamping = 0.9, linearDamping = 0.05 } = {}) {
    this.rig = rig; this.world = world;
    this.friction = friction; this.restitution = restitution; this.jointFriction = jointFriction;
    this.angularDamping = angularDamping; this.linearDamping = linearDamping;
    this.active = false;
    this.bodies = {}; this.joints = [];
    this._tracked = null; this._vel = null;
    rig.root.updateMatrixWorld(true);
    const B = rig.bones, H = {};
    for (const [n, b] of Object.entries(B)) H[n] = b.getWorldPosition(new Vector3());
    this._restHeads = H;
    const need = ['pelvis', 'head', 'thigh_l', 'thigh_r'];
    for (const n of need) if (!B[n]) throw new Error(`Ragdoll: the rig has no '${n}' bone`);
    const k = scale ?? Math.max(0.2, H.head.distanceTo(H.pelvis) / 0.65);
    this.scale = k;
    const left = H.thigh_l.clone().sub(H.thigh_r).setY(0).normalize();
    this.forward = left.clone().cross(UP).normalize();               // the way the character faces in the rest pose
    const P = (n) => H[n].clone();
    const lerp = (a, b, t) => H[a].clone().lerp(H[b], t);
    const ext = (a, b, d) => H[b].clone().addScaledVector(H[b].clone().sub(H[a]).normalize(), d * k);
    const has = (...names) => names.every((n) => B[n]);
    const parts = [];
    const add = (name, bone, a, b, r, m, bones, parent = null) => { if (has(bone, ...bones)) parts.push({ name, bone, a, b, radius: r * k, mass: m, bones, parent }); };
    add('pelvis', 'pelvis', P('thigh_r'), P('thigh_l'), 0.105, 11, ['pelvis']);
    if (has('spine_01', 'spine_02', 'spine_03', 'neck_01')) {
      add('abdomen', 'spine_01', P('spine_01'), lerp('spine_01', 'spine_02', 0.9), 0.12, 12, ['spine_01'], 'pelvis');
      add('chest', 'spine_02', P('spine_02'), lerp('spine_03', 'neck_01', 0.5), 0.14, 14, ['spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'].filter((n) => B[n]), 'abdomen');
      add('head', 'neck_01', P('neck_01'), ext('neck_01', 'head', 0.12), 0.09, 5, ['neck_01', 'head'], 'chest');
    }
    for (const s of ['l', 'r']) {
      if (has(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`)) {
        add(`upperarm_${s}`, `upperarm_${s}`, P(`upperarm_${s}`), P(`lowerarm_${s}`), 0.05, 2.2, [`upperarm_${s}`], 'chest');
        add(`forearm_${s}`, `lowerarm_${s}`, P(`lowerarm_${s}`), P(`hand_${s}`), 0.042, 1.4, [`lowerarm_${s}`], `upperarm_${s}`);
        add(`hand_${s}`, `hand_${s}`, P(`hand_${s}`), ext(`lowerarm_${s}`, `hand_${s}`, 0.1), 0.04, 0.6, [`hand_${s}`], `forearm_${s}`);
      }
      if (has(`thigh_${s}`, `calf_${s}`, `foot_${s}`)) {
        add(`thigh_${s}`, `thigh_${s}`, P(`thigh_${s}`), P(`calf_${s}`), 0.085, 8.5, [`thigh_${s}`], 'pelvis');
        add(`calf_${s}`, `calf_${s}`, P(`calf_${s}`), P(`foot_${s}`), 0.062, 3.7, [`calf_${s}`], `thigh_${s}`);
        const toe = B[`ball_${s}`] ? ext(`foot_${s}`, `ball_${s}`, 0.05) : H[`foot_${s}`].clone().addScaledVector(this.forward, 0.18 * k);
        add(`foot_${s}`, `foot_${s}`, P(`foot_${s}`), toe, 0.04, 1.2, [`foot_${s}`, `ball_${s}`].filter((n) => B[n]), `calf_${s}`);
      }
    }
    // scale the masses to the requested total
    const total = parts.reduce((t, p) => t + p.mass, 0);
    for (const p of parts) p.mass *= mass / total;
    // rest orientation of each part's capsule, and its offset from the primary bone
    const boneRestQ = {};
    for (const [n, b] of Object.entries(B)) boneRestQ[n] = b.getWorldQuaternion(new Quaternion());
    for (const p of parts) {
      const dir = p.b.clone().sub(p.a).normalize();
      p.restQ = new Quaternion().setFromUnitVectors(UP, dir);
      const qb = boneRestQ[p.bone], qi = qb.clone().invert();
      p.restOffset = qi.clone().multiply(p.restQ);                               // bone -> capsule frame
      p.aL = p.a.clone().sub(H[p.bone]).applyQuaternion(qi);                      // end points in the primary bone's frame
      p.bL = p.b.clone().sub(H[p.bone]).applyQuaternion(qi);
      p.length = p.a.distanceTo(p.b);
    }
    this.parts = parts;
    this._byName = Object.fromEntries(parts.map((p) => [p.name, p]));
    // bone drive order: parents first
    this._order = [];
    const keyOf = new Map(Object.entries(B).map(([n, b]) => [b, n]));
    const walk = (o, parentIdx) => {
      let idx = parentIdx;
      if (keyOf.has(o)) { idx = this._order.length; this._order.push({ bone: o, key: keyOf.get(o), name: o.name || keyOf.get(o), parent: parentIdx, part: null, offset: null, posOffset: null }); }
      for (const c of o.children) walk(c, idx);
    };
    walk(rig.root, -1);
    this._boneIndex = new Map(this._order.map((e, i) => [e.key, i]));
  }

  // ----------------------------------------------------------------------------------------------- pose capture

  /** World end points and orientation of a part for the rig's current pose. */
  _partPose(part, outA, outB, outQ) {
    const bone = this.rig.bones[part.bone];
    bone.getWorldPosition(_p); bone.getWorldQuaternion(_q);
    outA.copy(part.aL).applyQuaternion(_q).add(_p);
    outB.copy(part.bL).applyQuaternion(_q).add(_p);
    outQ.copy(_q).multiply(part.restOffset);
  }

  /**
   * Call once per frame while the character is animated (after the animation is applied) so that the limbs have
   * their velocity when the ragdoll starts.
   */
  track(dt) {
    if (this.active || !(dt > 0)) return;
    this.rig.root.updateMatrixWorld(true);
    const next = {}, prev = this._tracked;
    for (const part of this.parts) {
      const a = new Vector3(), b = new Vector3(), q = new Quaternion();
      this._partPose(part, a, b, q);
      next[part.name] = { pos: a.add(b).multiplyScalar(0.5), q };
    }
    if (prev) {
      this._vel = {};
      for (const part of this.parts) {
        const o = prev[part.name], n = next[part.name];
        const lin = n.pos.clone().sub(o.pos).multiplyScalar(1 / dt);
        // angular velocity from the rotation between the two frames: dq = q1 * q0^-1
        _q.copy(o.q).invert(); _q2.copy(n.q).multiply(_q);
        if (_q2.w < 0) { _q2.set(-_q2.x, -_q2.y, -_q2.z, -_q2.w); }
        const s = Math.sqrt(Math.max(0, 1 - _q2.w * _q2.w)), ang = 2 * Math.atan2(s, _q2.w);
        this._vel[part.name] = { lin, w: s > 1e-6 ? new Vector3(_q2.x, _q2.y, _q2.z).multiplyScalar(ang / s / dt) : new Vector3() };
      }
    }
    this._tracked = next;
  }

  // ----------------------------------------------------------------------------------------------- activation

  /**
   * Turns the character into a ragdoll.
   * @param {object} [o]
   * @param {Vector3} [o.velocity]   starting velocity of every body (m/s), e.g. the character's, used when track() has not been running
   * @param {{point: Vector3, vector: Vector3}} [o.impulse]  an impulse (N*s) applied to the body nearest `point`
   * @param {boolean} [o.inheritMotion]  use the limb velocities gathered by track() (default true; they include the character's own motion)
   */
  activate({ velocity = null, impulse = null, inheritMotion = true } = {}) {
    if (this.active) return this;
    const rig = this.rig, world = this.world;
    rig.root.updateMatrixWorld(true);
    const group = (this._group ??= _group++);
    const a = new Vector3(), b = new Vector3(), q = new Quaternion();
    const info = {};
    for (const part of this.parts) {
      this._partPose(part, a, b, q);
      const centre = a.clone().add(b).multiplyScalar(0.5);
      const body = new RigidBody({
        shape: { type: 'capsule', radius: part.radius, length: Math.max(1e-3, a.distanceTo(b)) }, mass: part.mass,
        position: centre, rotation: q, friction: this.friction, restitution: this.restitution,
        linearDamping: this.linearDamping, angularDamping: this.angularDamping, ignoreGroup: group,
      });
      body.userData = { ragdoll: this, part: part.name };
      world.addBody(body);
      this.bodies[part.name] = body;
      info[part.name] = { a: a.clone(), b: b.clone(), q: q.clone() };
      const tracked = inheritMotion && this._vel && this._vel[part.name];
      if (tracked) { body.linearVelocity.copy(tracked.lin); body.angularVelocity.copy(tracked.w); }
      else if (velocity) body.linearVelocity.copy(velocity);
      // bone offsets from the body frame
      for (const bn of part.bones) {
        const e = this._order[this._boneIndex.get(bn)]; if (!e) continue;
        e.part = part.name;
        rig.bones[bn].getWorldQuaternion(_q);
        e.offset = body.quaternion.clone().invert().multiply(_q);
        if (bn === 'pelvis') {
          rig.bones[bn].getWorldPosition(_p);
          e.posOffset = _p.clone().sub(body.position).applyQuaternion(body.quaternion.clone().invert());
        }
      }
    }
    this._buildJoints(info);
    this.active = true;
    if (impulse) this.applyImpulse(impulse.point, impulse.vector);
    return this;
  }

  _hingeAxis(part, parentPart, towards) {
    // flexion axis in the rest pose: rotating the child's direction d towards `towards` (perpendicular to d)
    const d = part.b.clone().sub(part.a).normalize();
    const t = towards.clone().addScaledVector(d, -towards.dot(d)).normalize();
    return d.cross(t).normalize();                       // rest world axis
  }

  _buildJoints(info) {
    const world = this.world, B = this.bodies, L = RAGDOLL_LIMITS, joints = this.joints;
    const open = Math.PI;
    for (const part of this.parts) {
      if (!part.parent || !B[part.parent] || !B[part.name]) continue;
      const parentPart = this._byName[part.parent], A = B[part.parent], C = B[part.name];
      const kind = part.name.replace(/_[lr]$/, '');
      const lim = L[kind]; if (!lim) continue;
      const neutral = parentPart.restQ.clone().invert().multiply(part.restQ);
      const anchor = info[part.name].a.clone();
      const axis = info[part.name].b.clone().sub(info[part.name].a).normalize();
      let j;
      if (lim.hinge) {
        // rest axis expressed in the parent's rest frame, then rotated into the current pose
        const towards = kind === 'calf' ? this.forward.clone().negate() : this.forward.clone();
        const restAxis = this._hingeAxis(part, parentPart, towards);
        const axisWorld = restAxis.clone().applyQuaternion(parentPart.restQ.clone().invert()).applyQuaternion(A.quaternion);
        j = new HingeJoint(A, C, anchor, axisWorld, { friction: this.jointFriction, neutral });
        const m = j.measure().angle;
        j.setLimits({ min: Math.min(lim.hinge[0] * DEG, m - 0.05), max: Math.max(lim.hinge[1] * DEG, m + 0.05) });
      } else {
        j = new BallJoint(A, C, anchor, { axis, friction: this.jointFriction, neutral });
        const m = j.measure();
        j.setLimits({
          coneAngle: Math.min(open, Math.max(lim.cone * DEG, m.swing + 0.08)),
          twistMin: Math.min(lim.twist[0] * DEG, m.twist - 0.08), twistMax: Math.max(lim.twist[1] * DEG, m.twist + 0.08),
        });
      }
      world.addJoint(j);
      joints.push(j);
    }
  }

  /** Gives an impulse to the body nearest `point`. */
  applyImpulse(point, vector) {
    let best = null, bd = Infinity;
    for (const body of Object.values(this.bodies)) { const d = body.position.distanceToSquared(point); if (d < bd) { bd = d; best = body; } }
    if (best) best.applyImpulse(vector, point);
  }

  /** Removes the bodies and joints from the world; the bones stay in the last pose. */
  deactivate() {
    if (!this.active) return;
    for (const j of this.joints) this.world.removeJoint(j);
    for (const b of Object.values(this.bodies)) this.world.removeBody(b);
    this.joints.length = 0; this.bodies = {};
    for (const e of this._order) { e.part = null; e.offset = null; e.posOffset = null; }
    this.active = false; this._vel = null; this._tracked = null;
  }

  // ----------------------------------------------------------------------------------------------- per frame

  /** Writes the bodies' poses into the bones. Call after world.step(). */
  update() {
    if (!this.active) return;
    const rig = this.rig, order = this._order;
    const wq = this._wq || (this._wq = order.map(() => new Quaternion()));
    rig.root.getWorldQuaternion(_q2);
    for (let i = 0; i < order.length; i++) {
      const e = order[i], bone = e.bone, pq = e.parent >= 0 ? wq[e.parent] : _q2;
      if (e.part && this.bodies[e.part]) {
        const body = this.bodies[e.part];
        wq[i].copy(body.quaternion).multiply(e.offset);
        bone.quaternion.copy(_q.copy(pq).invert().multiply(wq[i]));
        if (e.posOffset) {
          _v.copy(e.posOffset).applyQuaternion(body.quaternion).add(body.position);
          bone.position.copy(bone.parent.worldToLocal(_v));
        }
      } else wq[i].copy(pq).multiply(bone.quaternion);
    }
    rig.root.updateMatrixWorld(true);
  }

  // ----------------------------------------------------------------------------------------------- inspection

  /** World position of the pelvis body. */
  pelvisPosition(out = new Vector3()) { const b = this.bodies.pelvis; return b ? out.copy(b.position) : out; }

  /** Is everything slower than `speed` (m/s)? */
  isSettled(speed = 0.2) {
    for (const b of Object.values(this.bodies)) if (b.linearVelocity.length() > speed || b.angularVelocity.length() * b.shape.radius > speed) return false;
    return this.active;
  }

  /**
   * How the body lies: { faceUp, direction } where `direction` is the horizontal unit vector from the pelvis to
   * the head, to turn a get-up clip toward.
   */
  lying() {
    const B = this.bodies;
    const chest = B.chest || B.pelvis, head = B.head || B.chest;
    const dir = head.position.clone().sub(B.pelvis.position).setY(0);
    if (dir.lengthSq() < 1e-6) dir.copy(this.forward);
    dir.normalize();
    // the chest's front is its rest-pose forward, turned by the body
    const part = this._byName.chest || this._byName.pelvis;
    const front = this.forward.clone().applyQuaternion(part.restQ.clone().invert()).applyQuaternion(chest.quaternion);
    return { faceUp: front.y > 0, direction: dir };
  }

  /**
   * The current pose as a one-key clip (local rotation of every bone, local position of the pelvis) to cross-fade
   * from, e.g. into a get-up clip.
   */
  snapshotClip(name = 'ragdoll-pose') {
    const tracks = [];
    for (const e of this._order) {
      const q = e.bone.quaternion;
      tracks.push(new Track(e.name, 'quaternion', [q.x, q.y, q.z, q.w], null, 1));
    }
    const p = this.rig.bones.pelvis.position;
    tracks.push(new Track('pelvis', 'position', [p.x, p.y, p.z], null, 1));
    return new AnimationClip(name, tracks, { duration: 1, loop: true, rootMotion: 'none' });
  }
}
