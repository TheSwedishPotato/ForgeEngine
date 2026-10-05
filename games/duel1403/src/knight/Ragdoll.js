import { Vector3, Quaternion } from 'three';
import { Body, Joint, Shape } from '../physics/index.js';
import { buildAnatomy, MUSCLES } from './anatomy.js';

const v3 = (a) => new Vector3(a[0], a[1], a[2]);

// Contact materials by the outermost layer. Plate is hard and slippery
// (steel on steel glances), mail a little softer and grippier, cloth and
// flesh soft. Compliance is in m/N.
export const MAT = {
  skin: { friction: 0.5, restitution: 0.02, compliance: 1 / 3e5, damping: 900 },
  cloth: { friction: 0.55, restitution: 0.02, compliance: 1 / 2.5e5, damping: 1000 },
  leather: { friction: 0.5, restitution: 0.03, compliance: 1 / 4e5, damping: 900 },
  mail: { friction: 0.4, restitution: 0.04, compliance: 1 / 7e5, damping: 800 },
  plate: { friction: 0.2, restitution: 0.12, compliance: 1 / 2.5e6, damping: 400 },
  sole: { friction: 0.85, restitution: 0.0, compliance: 0, damping: 0 },
};

const SEG_TYPE = (name) => name.replace(/[LR]$/, '');

/**
 * The articulated body of one fighter: 13 rigid segments and 12 joints,
 * loaded with the armour it wears. Built at the origin in the rest pose,
 * then moved rigidly into place.
 */
export class Ragdoll {
  constructor(world, { id, height = 1.78, mass = 78, armour, strength = 1 }) {
    this.world = world;
    this.id = id;
    this.armour = armour;
    this.anatomy = buildAnatomy({ height, mass, armourMass: armour.massBy, bulk: armour.bulk });
    this.bodies = {};
    this.joints = {};
    this.list = [];
    this.totalMass = 0;
    const { seg, shapes, joints } = this.anatomy;

    const make = (name, key, mirror) => {
      const g = seg[key];
      const com = g.com.clone();
      if (mirror) com.x = -com.x;
      const b = new Body({ name, mass: g.mass, inertia: g.inertia.clone(), position: com, angularDamping: 0.25, linearDamping: 0.02 });
      // A limb is never faster than a fencer's hand at full cut (~15 m/s, Askew 2012);
      // anything far beyond that is a contact pop, so cap it.
      b.maxSpeed = 24;
      for (const sd of shapes[key]) {
        const off = v3(sd.offset);
        if (mirror) off.x = -off.x;
        const part = sd.part ?? key;
        const matKey = part === 'sole' ? 'sole' : part === 'hand' ? armour.outer.hand : armour.outer[key];
        const mat = MAT[matKey] ?? MAT.skin;
        const opts = { ...mat, userData: { fighter: id, part, segment: name, segType: key, mat: matKey } };
        let s;
        if (sd.type === 'sphere') s = Shape.sphere(sd.radius, off, opts);
        else if (sd.type === 'capsule') s = Shape.capsule(sd.radius, sd.halfLength, v3(sd.axis), off, opts);
        else s = Shape.box(v3(sd.halfExtents), off, { ...opts, collidesWithBodies: false });
        if (key === 'foot' && sd.type === 'capsule') s.collidesWithPlane = false;
        b.addShape(s);
      }
      b.userData = { fighter: id, segment: name, segType: key };
      this.bodies[name] = b;
      this.list.push(b);
      this.totalMass += b.mass;
      return b;
    };

    make('pelvis', 'pelvis');
    make('abdomen', 'abdomen');
    make('chest', 'chest');
    make('head', 'head');
    for (const side of ['L', 'R']) {
      const mirror = side === 'R';
      make('upperArm' + side, 'upperArm', mirror);
      make('forearm' + side, 'forearm', mirror);
      make('thigh' + side, 'thigh', mirror);
      make('shin' + side, 'shin', mirror);
      make('foot' + side, 'foot', mirror);
    }

    for (const jd of joints) {
      const j = new Joint(this.bodies[jd.parent], this.bodies[jd.child], {
        name: jd.name,
        anchor: v3(jd.anchor),
        twistAxis: v3(jd.twistAxis),
        swingAxis1: v3(jd.swingAxis1),
        swingAxis2: v3(jd.swingAxis2),
        twist: jd.twist,
        swing1: jd.swing1,
        swing2: jd.swing2,
      });
      const mk = jd.name.replace(/[LR]$/, '');
      j.muscle = { ...MUSCLES[mk] };
      // Stronger (or weaker) fighters; the legs also carry the armour.
      const legBoost = (mk === 'hip' || mk === 'knee' || mk === 'ankle') ? 1 + 0.25 * Math.min(1, armour.total / 40) : 1;
      j.muscle.maxTorque *= strength * legBoost;
      j.muscle.stiffness *= strength * legBoost;
      j.group = mk;
      j.setDrive(j.muscle.stiffness, j.muscle.damping, j.muscle.maxTorque);
      this.joints[jd.name] = j;
    }
    if (armour.stiffNeck) {
      // The great bascinet is strapped to the breastplate: the head turns with the body.
      const n = this.joints.neck;
      n.limits.twist = [-0.2, 0.2];
      n.limits.swing1 = [-0.15, 0.15];
      n.limits.swing2 = [-0.15, 0.15];
    }

    const J = this.anatomy.J;
    this.bones = {};
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const sh = this.joints['shoulder' + side], el = this.joints['elbow' + side];
      const hip = this.joints['hip' + side], kn = this.joints['knee' + side], an = this.joints['ankle' + side];
      const hand = this.bodies['forearm' + side].shapes.find((s) => s.userData.part === 'hand');
      this.bones['arm' + side] = {
        upperBody: this.bodies['upperArm' + side],
        lowerBody: this.bodies['forearm' + side],
        rootLocalInParent: sh.anchorParent.clone(),
        upperRoot: sh.anchorChild.clone(),
        upperMid: el.anchorParent.clone(),
        lowerMid: el.anchorChild.clone(),
        lowerEnd: hand.offset.clone(),
        hingeAxis: el.twistAxis.clone(),
        L1: sh.anchorChild.distanceTo(el.anchorParent),
        L2: el.anchorChild.distanceTo(hand.offset),
        side: sx,
      };
      const foot = this.bodies['foot' + side];
      this.bones['leg' + side] = {
        upperBody: this.bodies['thigh' + side],
        lowerBody: this.bodies['shin' + side],
        rootLocalInParent: hip.anchorParent.clone(),
        upperRoot: hip.anchorChild.clone(),
        upperMid: kn.anchorParent.clone(),
        lowerMid: kn.anchorChild.clone(),
        lowerEnd: an.anchorParent.clone(),
        hingeAxis: kn.twistAxis.clone(),
        L1: hip.anchorChild.distanceTo(kn.anchorParent),
        L2: kn.anchorChild.distanceTo(an.anchorParent),
        ankleInFoot: an.anchorChild.clone(),
        footBody: foot,
        side: sx,
      };
    }
    this.restHipY = J.hipY;

    for (const b of this.list) world.addBody(b);
    for (const j of Object.values(this.joints)) world.addJoint(j);
    const ex = (a, b) => world.excludePair(this.bodies[a], this.bodies[b]);
    ex('pelvis', 'chest');
    ex('chest', 'upperArmL'); ex('chest', 'upperArmR');
    ex('abdomen', 'thighL'); ex('abdomen', 'thighR');
    ex('thighL', 'thighR');
    ex('head', 'abdomen');
    ex('head', 'upperArmL'); ex('head', 'upperArmR');
  }

  place(position, yaw) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    for (const b of this.list) {
      if (!b.userData.restPos) {
        b.userData.restPos = b.pos.clone();
        b.userData.restQ = b.q.clone();
      }
      b.pos.copy(b.userData.restPos).applyQuaternion(q).add(position);
      b.q.copy(q).multiply(b.userData.restQ);
      b.prevPos.copy(b.pos);
      b.prevQ.copy(b.q);
      b.vel.set(0, 0, 0);
      b.omega.set(0, 0, 0);
    }
  }

  centerOfMass(out) {
    out.set(0, 0, 0);
    let m = 0;
    for (const b of this.list) { out.addScaledVector(b.pos, b.mass); m += b.mass; }
    return out.multiplyScalar(1 / m);
  }
}

export { SEG_TYPE };
