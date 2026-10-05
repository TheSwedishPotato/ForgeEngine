import { Vector3, Quaternion } from 'three';
import { Ragdoll } from '../knight/Ragdoll.js';
import { Shape } from '../physics/index.js';
import { resolveArmour } from '../knight/armourProfile.js';
import { solveTwoBone } from '../knight/ik.js';
import { PoseLock } from './constraints.js';
import { JOUST_KIT, SADDLES } from '../data/joust.js';

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const qx = (a) => new Quaternion().setFromAxisAngle(X, a);
const qy = (a) => new Quaternion().setFromAxisAngle(Y, a);
const qz = (a) => new Quaternion().setFromAxisAngle(Z, a);
const _v = new Vector3(), _v2 = new Vector3(), _pole = new Vector3(), _qu = new Quaternion(), _ql = new Quaternion(), _qh = new Quaternion();

// Seat constraints: the high saddle holds the pelvis and wraps the thighs,
// the stirrups take the feet, the cantle backs the loins. Bounds in N and N m.
const LOCKS = {
  pelvis: { kPos: 9e4, maxForce: 4200, kRot: 6000, maxTorque: 1300 },
  abdomen: { kRot: 3000, maxTorque: 480 },
  chest: { kRot: 2200, maxTorque: 380 },
  head: { kRot: 140, maxTorque: 30 },
  thigh: { kPos: 2e4, maxForce: 900, kRot: 600, maxTorque: 150 },
  shin: { kPos: 8000, maxForce: 450 },
  foot: { kPos: 6000, maxForce: 350 },
  upperArm: { kPos: 2500, maxForce: 220 },
  forearm: { kPos: 2500, maxForce: 220 },
};

// The seated attitude (radians).
const SEAT = { hipFlex: 0.5, hipAbd: 0.38, knee: 0.42, pelvisTilt: -0.07, lean: 0.06 };

/**
 * A mounted man in jousting harness: the same articulated body as the duel's
 * fighters, held in the high saddle by bounded seat constraints rather than
 * balanced on his feet. While seated, every segment is pulled towards a
 * riding pose computed in the horse's frame (forward kinematics through the
 * real joints, the lance arm by IK onto the lance grip). A blow that exceeds
 * what seat, legs and back can hold displaces him; displaced far enough, he
 * is out of the saddle and becomes a falling body.
 */
export class Rider {
  constructor(world, { id, name, title = '', heraldry = 'none', colors = {}, skill = 0.7, height = 1.78, mass = 78, items = JOUST_KIT, horse, saddle = 'hohenzeug' }) {
    this.saddle = SADDLES[saddle] ?? SADDLES.hohenzeug;
    this.id = id;
    this.name = name;
    this.title = title;
    this.heraldry = heraldry;
    this.colors = { skin: '#e0b08a', hair: '#5a3c22', hose: '#3a2e22', padding: '#d6ccb0', ...colors };
    this.skill = skill;
    this.horse = horse;
    this.world = world;
    this.profile = resolveArmour(items);
    this.ragdoll = new Ragdoll(world, { id, height, mass, armour: this.profile, strength: 1 });
    this.ragdoll.place(new Vector3(), 0);   // records the rest pose the meshes are built on
    this.b = this.ragdoll.bodies;
    this.j = this.ragdoll.joints;
    this.scale = this.ragdoll.anatomy.scale;
    this.visorDown = true;
    this.totalMass = this.ragdoll.totalMass;
    const s = this.scale;

    // The ecranche: a small shield of wood and leather hung on the left breast.
    this.ecranche = Shape.capsule(0.13 * s, 0.1 * s, new Vector3(0.25, 1, 0.15).normalize(), new Vector3(0.13 * s, 0.0, 0.17 * s), {
      friction: 0.6, restitution: 0.05, compliance: 1 / 9e5, damping: 700,
      userData: { fighter: id, part: 'ecranche', segment: 'chest', segType: 'chest', mat: 'wood' },
    });
    this.b.chest.addShape(this.ecranche);
    world.shapes.push(this.ecranche);

    // Joint frames from the rest pose (every segment's rest orientation is identity).
    this.rest = {};
    for (const b of this.ragdoll.list) this.rest[b.name] = b.pos.clone();
    this.locks = {};
    for (const b of this.ragdoll.list) {
      const key = b.name.replace(/[LR]$/, '');
      const L0 = LOCKS[key];
      if (!L0) continue;
      const sc = this.saddle.scale;
      const k = key === 'pelvis' ? sc.pelvis : key === 'abdomen' || key === 'chest' ? sc.torso : /thigh|shin|foot/.test(key) ? sc.legs : 1;
      const L = { ...L0, maxForce: (L0.maxForce ?? 0) * k, maxTorque: (L0.maxTorque ?? 0) * k };
      this.locks[b.name] = world.addConstraint(new PoseLock(b, horse.body, L));
    }
    this.seated = true;
    this.unseatCause = null;
    this.brace = 0;          // 0..1, leaning into the blow
    this.braceT = 0;
    this.braceCool = 0;
    this.couch = 0;          // 0 carried upright .. 1 couched
    this.lookAt = null;      // world point the head turns to
    this.handTarget = null;  // world point for the right hand (lance grip)
    this.twist = 0;
    this.pose = {};          // horse-frame orientations and positions per segment
    this.downTime = 0;
    this.stun = 0;
    this.helmOff = false;
    this.time = 0;
    this.seat(true);
  }

  /** Brace: lean into the shock, back and loins set against the cantle. */
  doBrace() {
    if (this.braceCool > 0 || !this.seated) return false;
    this.braceT = 0.55;
    this.braceCool = 1.6;
    return true;
  }

  // --- pose ------------------------------------------------------------------------

  _orientations() {
    const P = this.pose;
    const lean = SEAT.lean + 0.16 * this.brace + 0.05 * this.couch;
    P.pelvis = qx(SEAT.pelvisTilt + 0.04 * this.brace);
    P.abdomen = qy(this.twist * 0.4).multiply(qx(lean * 0.6));
    P.chest = qy(this.twist).multiply(qx(lean));
    // head: towards the opponent, within what the helm and neck allow
    let yaw = this.twist, pitch = 0.05;
    if (this.lookAt) {
      this.horse.body.worldToLocal(this.lookAt, _v);
      _v.sub(_v2.set(0, this.saddle.seatY + 0.75, 0));
      yaw = Math.max(-0.9, Math.min(0.9, Math.atan2(_v.x, Math.max(0.3, _v.z))));
      pitch = Math.max(-0.3, Math.min(0.35, -Math.atan2(_v.y, Math.hypot(_v.x, _v.z))));
    }
    P.head = qy(yaw).multiply(qx(pitch));
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const th = qz(sx * SEAT.hipAbd).multiply(qx(-SEAT.hipFlex));
      P['thigh' + side] = th;
      P['shin' + side] = th.clone().multiply(qx(SEAT.knee));
      P['foot' + side] = qz(sx * SEAT.hipAbd * 0.25).multiply(qy(sx * 0.12));
    }
    // bridle hand: forearm forward over the pommel
    P.upperArmL = qz(0.15).multiply(qx(-0.45));
    P.forearmL = P.upperArmL.clone().multiply(qx(-1.15));
    P.upperArmR = qz(-0.25).multiply(qx(0.2));
    P.forearmR = P.upperArmR.clone().multiply(qx(-1.3));
  }

  /** Positions by forward kinematics through the joints, from the seat. */
  _positions(out) {
    const P = this.pose;
    out.pelvis = new Vector3(0, this.saddle.seatY + 0.11 * this.scale, -0.12);
    const chain = (jn) => {
      const j = this.j[jn];
      const pn = j.parent.name, cn = j.child.name;
      const a = j.anchorParent.clone().applyQuaternion(P[pn]).add(out[pn]);
      out[cn] = a.sub(j.anchorChild.clone().applyQuaternion(P[cn]));
    };
    chain('lumbar'); chain('thoracic'); chain('neck');
    for (const s of ['L', 'R']) { chain('hip' + s); chain('knee' + s); chain('ankle' + s); chain('shoulder' + s); chain('elbow' + s); }
    return out;
  }

  /** Right arm onto the lance grip (world target), by IK in the horse frame. */
  _lanceArm(pos) {
    if (!this.handTarget) return;
    const P = this.pose, hb = this.horse.body;
    const bone = this.ragdoll.bones.armR;
    const sh = this.j.shoulderR;
    const root = sh.anchorParent.clone().applyQuaternion(P.chest).add(pos.chest);
    const target = hb.worldToLocal(this.handTarget, new Vector3());
    _pole.set(-0.6, -0.4, -0.7);   // elbow out and back, under the lance
    solveTwoBone(root, target, _pole, bone, _qu, _ql);
    P.upperArmR = _qu.clone();
    P.forearmR = _ql.clone();
    pos.upperArmR = root.clone().sub(sh.anchorChild.clone().applyQuaternion(P.upperArmR));
    const el = this.j.elbowR;
    pos.forearmR = el.anchorParent.clone().applyQuaternion(P.upperArmR).add(pos.upperArmR).sub(el.anchorChild.clone().applyQuaternion(P.forearmR));
  }

  _computePose() {
    this._orientations();
    const pos = this._positions({});
    this._lanceArm(pos);
    this.posePos = pos;
  }

  /** Places the rider in the saddle (snap = teleport onto the pose). */
  seat(snap = false) {
    this._computePose();
    const hb = this.horse.body;
    for (const b of this.ragdoll.list) {
      const L = this.locks[b.name];
      const p = this.posePos[b.name], q = this.pose[b.name];
      if (L) { L.localPos.copy(p); L.localQ.copy(q); L.strength = 1; }
      if (snap) {
        hb.localToWorld(p, b.pos);
        b.q.copy(hb.q).multiply(q);
        b.prevPos.copy(b.pos); b.prevQ.copy(b.q);
        b.vel.copy(hb.vel); b.omega.set(0, 0, 0);
      }
    }
    this._driveJoints(1 / 60);
    if (snap) { this.seated = true; this.unseatCause = null; this.downTime = 0; }
  }

  _driveJoints(dt) {
    const P = this.pose;
    for (const j of Object.values(this.j)) {
      const qp = P[j.parent.name], qc = P[j.child.name];
      if (!qp || !qc) continue;
      _qh.copy(qp).invert().multiply(qc);
      j.setTarget(_qh, dt);
      const m = j.muscle;
      j.setDrive(m.stiffness, m.damping, m.maxTorque);
    }
  }

  // --- per frame -----------------------------------------------------------------------

  update(dt) {
    this.time += dt;
    this.braceCool = Math.max(0, this.braceCool - dt);
    this.braceT = Math.max(0, this.braceT - dt);
    const want = this.braceT > 0 ? 1 : 0;
    this.brace += (want - this.brace) * Math.min(1, dt * (want ? 14 : 3));
    this.stun = Math.max(0, this.stun - dt * 0.25);
    if (!this.seated) { this.downTime += dt; return; }
    this._computePose();
    // Sitting loose he gives; set against the cantle and leaning in, he holds.
    const torso = Math.max(0.2, 0.6 + 0.65 * this.brace - 0.4 * this.stun);
    for (const b of this.ragdoll.list) {
      const L = this.locks[b.name];
      if (!L) continue;
      L.localPos.copy(this.posePos[b.name]);
      L.localQ.copy(this.pose[b.name]);
      const key = b.name.replace(/[LR]$/, '');
      L.strength = key === 'abdomen' || key === 'chest' || key === 'pelvis' ? torso : 1;
    }
    this._driveJoints(dt);
  }

  /** How far the blow has moved him from his seat. */
  displacement() {
    const L = this.locks;
    return {
      seat: L.pelvis.posErr,
      back: Math.max(L.abdomen.rotErr, L.chest.rotErr * 0.9),
      pelvisRot: L.pelvis.rotErr,
    };
  }

  /** Out of the saddle: the seat constraints let go and he falls. */
  unseat(cause) {
    if (!this.seated) return;
    this.seated = false;
    this.unseatCause = cause;
    for (const L of Object.values(this.locks)) L.strength = 0;
    // Muscles: soft, arms in to break the fall.
    for (const j of Object.values(this.j)) {
      const m = j.muscle;
      j.setDrive(m.stiffness * 0.35, m.damping * 0.8, m.maxTorque * 0.6);
      j.setTarget(new Quaternion());
    }
    this.downTime = 0;
  }

  get pelvisPos() { return this.b.pelvis.pos; }
  get head() { return this.b.head; }
}
