import { Vector3, Quaternion } from 'three';
import { Body, Joint, Shape } from '../physics/index.js';
import { buildAnatomy, MUSCLES } from './anatomy.js';

const v3 = (a) => new Vector3(a[0], a[1], a[2]);

// Materials: skin on skin is slippery with sweat; gloves are padded leather
// (soft contact ~ 1.8e5 N/m, i.e. ~2 cm of compression at 3.5 kN); boot soles
// grip the canvas.
const MAT = {
  skin: { friction: 0.35, restitution: 0.05, compliance: 1 / 4e5, damping: 900 },
  head: { friction: 0.35, restitution: 0.05, compliance: 1 / 6e5, damping: 700 },
  glove: { friction: 0.3, restitution: 0.2, compliance: 1 / 1.8e5, damping: 300 },
  sole: { friction: 0.95, restitution: 0.0, compliance: 0, damping: 0 },
  boot: { friction: 0.6, restitution: 0.05, compliance: 1 / 4e5, damping: 900 },
};

/**
 * Builds the articulated body of one boxer: 13 rigid segments and 12 joints.
 * The ragdoll is constructed in the rest pose at the origin and then moved
 * rigidly into place.
 */
export class Ragdoll {
  constructor(world, { id, height = 1.8, mass = 80 } = {}) {
    this.world = world;
    this.id = id;
    this.anatomy = buildAnatomy({ height, mass });
    this.bodies = {};
    this.joints = {};
    this.list = [];
    this.totalMass = 0;
    const { seg, shapes, joints } = this.anatomy;

    const make = (name, key, mirror) => {
      const g = seg[key];
      const com = g.com.clone();
      if (mirror) com.x = -com.x;
      const b = new Body({ name, mass: g.mass, inertia: g.inertia.clone(), position: com, angularDamping: 0.2, linearDamping: 0.02 });
      for (const sd of shapes[key]) {
        const off = v3(sd.offset);
        if (mirror) off.x = -off.x;
        const part = sd.part ?? key;
        const mat = part === 'glove' ? MAT.glove : part === 'sole' ? MAT.sole : key === 'foot' ? MAT.boot : key === 'head' ? MAT.head : MAT.skin;
        const opts = { ...mat, userData: { boxer: id, part, segment: name } };
        let s;
        if (sd.type === 'sphere') s = Shape.sphere(sd.radius, off, opts);
        else if (sd.type === 'capsule') s = Shape.capsule(sd.radius, sd.halfLength, v3(sd.axis), off, opts);
        else if (sd.type === 'box') s = Shape.box(v3(sd.halfExtents), off, { ...opts, collidesWithBodies: false });
        // Only the soles touch the canvas while standing; everything else can
        // land on it when a fighter goes down.
        if (key === 'foot' && sd.type === 'capsule') s.collidesWithPlane = false;
        b.addShape(s);
      }
      b.userData = { boxer: id, segment: name };
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
      j.muscle = MUSCLES[mk];
      j.group = mk;
      j.setDrive(j.muscle.stiffness, j.muscle.damping, j.muscle.maxTorque);
      this.joints[jd.name] = j;
    }

    // Bone geometry needed by the IK (local to each body, rest pose).
    const J = this.anatomy.J;
    this.bones = {};
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const sh = this.joints['shoulder' + side], el = this.joints['elbow' + side];
      const hip = this.joints['hip' + side], kn = this.joints['knee' + side], an = this.joints['ankle' + side];
      const glove = this.bodies['forearm' + side].shapes.find((s) => s.userData.part === 'glove');
      this.bones['arm' + side] = {
        upperBody: this.bodies['upperArm' + side],
        lowerBody: this.bodies['forearm' + side],
        rootLocalInParent: sh.anchorParent.clone(),
        upperRoot: sh.anchorChild.clone(),
        upperMid: el.anchorParent.clone(),
        lowerMid: el.anchorChild.clone(),
        lowerEnd: glove.offset.clone(),
        hingeAxis: el.twistAxis.clone(),
        L1: sh.anchorChild.distanceTo(el.anchorParent),
        L2: el.anchorChild.distanceTo(glove.offset),
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
    // Adjacent-but-not-jointed pairs that would otherwise fight each other.
    const ex = (a, b) => world.excludePair(this.bodies[a], this.bodies[b]);
    ex('pelvis', 'chest');
    ex('chest', 'upperArmL'); ex('chest', 'upperArmR');
    ex('abdomen', 'thighL'); ex('abdomen', 'thighR');
    ex('thighL', 'thighR');
    ex('head', 'abdomen');
  }

  /** Rigidly moves the whole ragdoll (built at the origin facing +Z). */
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
    for (const b of this.list) out.addScaledVector(b.pos, b.mass);
    return out.multiplyScalar(1 / this.totalMass);
  }

  velocity(out) {
    out.set(0, 0, 0);
    for (const b of this.list) out.addScaledVector(b.vel, b.mass);
    return out.multiplyScalar(1 / this.totalMass);
  }
}
