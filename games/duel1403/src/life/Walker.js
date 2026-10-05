import { Vector3, Quaternion, Group } from 'three';
import { World } from '../physics/index.js';
import { Ragdoll } from '../knight/Ragdoll.js';
import { resolveArmour } from '../knight/armourProfile.js';
import { BodyMesh, SKIN_TONES } from '../render/bodyMesh.js';
import { ArmourMesh } from '../render/armourMesh.js';

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const qx = (a) => new Quaternion().setFromAxisAngle(X, a);
const qy = (a) => new Quaternion().setFromAxisAngle(Y, a);
const qz = (a) => new Quaternion().setFromAxisAngle(Z, a);
const _q = new Quaternion(), _v = new Vector3();

/**
 * A person on foot, posed by forward kinematics rather than simulated: the
 * same 13-segment body and armour/clothing meshes as the duel's fighters,
 * driven by a walking cycle (stride, knee lift, counter-swinging arms,
 * pelvic bob), standing, sitting or lying. Cheap enough for the player and
 * the people near the camera; the rest of the town are instanced figures.
 */
export class Walker {
  constructor({ name = 'Walker', height = 1.75, mass = 72, items = {}, colors = {}, heraldry = 'none', female = false, quality = 'high', beard = 0, headwear = null, texSize = 1024 }) {
    this.name = name;
    this.world = new World();          // never stepped: the bodies are posed
    this.profile = resolveArmour(items);
    this.ragdoll = new Ragdoll(this.world, { id: 99, height, mass, armour: this.profile });
    this.ragdoll.place(new Vector3(), 0);
    this.b = this.ragdoll.bodies;
    this.j = this.ragdoll.joints;
    this.scale = this.ragdoll.anatomy.scale;
    this.colors = { skin: '#e0b08a', hair: '#5a3c22', cloth: '#6a5a40', hose: '#4a3a2a', padding: '#d6ccb0', ...colors };
    this.heraldry = heraldry;
    this.visorDown = false;
    this.female = female;
    this.phase = 0;
    this.pose = {};
    this.footRestY = this.b.footL.pos.y;
    this.mesh = new Group();
    const c = this.colors;
    this.body = new BodyMesh(this, { skin: c.skin ?? SKIN_TONES.light, hair: c.hair, cloth: c.cloth, hose: c.hose, shoe: '#3b2a1c', quality, inflateTorso: female ? 0.008 : 0.012, inflateArm: 0.008, female, beard, headwear, texSize });
    this.armour = new ArmourMesh(this.body, this, { quality });
    this.mesh.add(this.body.group);
  }

  /** Orientation of every segment for a gait phase and speed (m/s), or a posture. */
  _orient(speed, posture) {
    const P = this.pose;
    const A = Math.min(0.55, 0.38 * speed);           // hip swing amplitude
    const ph = this.phase;
    const breath = 0.015 * Math.sin(this.t * 1.7);
    P.pelvis = qy(0.06 * A * Math.sin(ph)).multiply(qx(0.03));
    P.abdomen = qy(-0.05 * A * Math.sin(ph)).multiply(qx(0.04 + 0.08 * A + breath));
    P.chest = qy(-0.12 * A * Math.sin(ph)).multiply(qx(0.06 + 0.05 * A));
    P.head = qx(-0.04 - 0.04 * A).multiply(qy(this.look ?? 0));
    for (const [side, sx, off] of [['L', 1, 0], ['R', -1, Math.PI]]) {
      const ps = ph + off;
      let hip = A * Math.sin(ps), knee = 0.06 + 1.25 * A * Math.max(0, Math.sin(ps + 1.35)) ** 1.4;
      if (posture === 'sit') { hip = 1.45; knee = 1.45; }
      P['thigh' + side] = qz(sx * 0.03).multiply(qx(-hip));
      P['shin' + side] = P['thigh' + side].clone().multiply(qx(knee));
      P['foot' + side] = qy(sx * 0.08).multiply(qx(posture === 'sit' ? 0 : 0.25 * A * Math.cos(ps)));
      const arm = posture === 'sit' ? 0.5 : -0.9 * A * Math.sin(ps);
      P['upperArm' + side] = qz(sx * 0.07).multiply(qx(-arm));
      P['forearm' + side] = P['upperArm' + side].clone().multiply(qx(posture === 'sit' ? -1.1 : -0.18 - 0.35 * A - (this.gesture && side === 'R' ? 1.1 : 0)));
    }
  }

  _fk() {
    const P = this.pose, out = { pelvis: new Vector3(0, this.b.pelvis.userData.restPos.y, 0) };
    const chain = (jn) => {
      const j = this.j[jn], pn = j.parent.name, cn = j.child.name;
      const a = j.anchorParent.clone().applyQuaternion(P[pn]).add(out[pn]);
      out[cn] = a.sub(j.anchorChild.clone().applyQuaternion(P[cn]));
    };
    chain('lumbar'); chain('thoracic'); chain('neck');
    for (const s of ['L', 'R']) { chain('hip' + s); chain('knee' + s); chain('ankle' + s); chain('shoulder' + s); chain('elbow' + s); }
    return out;
  }

  /**
   * Pose at a world position facing yaw. speed in m/s; posture 'stand' |
   * 'walk' | 'sit' | 'lie'. groundY is the height of the ground (or seat).
   */
  update(dt, { x, y, z, yaw, speed = 0, posture = 'stand', gesture = false, look = 0 }) {
    this.t = (this.t ?? 0) + dt;
    const stride = 1.35 * this.scale;                  // m per gait cycle
    if (speed > 0.05) this.phase += (speed / stride) * Math.PI * 2 * dt;
    else this.phase += (0 - Math.sin(this.phase)) * Math.min(1, dt * 4) * 0.5;
    this.gesture = gesture;
    this.look = look;
    this._orient(posture === 'sit' ? 0 : speed, posture);
    const pos = this._fk();
    // put the lower foot on the ground (or the seat under the pelvis)
    let shift;
    if (posture === 'sit') shift = y + 0.47 * this.scale - pos.pelvis.y + 0.06;
    else shift = y - (Math.min(pos.footL.y, pos.footR.y) - this.footRestY);
    const root = qy(yaw);
    if (posture === 'lie') root.multiply(qx(-Math.PI / 2));
    for (const b of this.ragdoll.list) {
      const p = pos[b.name];
      _v.copy(p);
      if (posture === 'lie') { _v.y -= this.b.pelvis.userData.restPos.y; }
      _v.applyQuaternion(root);
      b.pos.set(x + _v.x, (posture === 'lie' ? y + 0.15 : shift) + _v.y, z + _v.z);
      b.q.copy(root).multiply(this.pose[b.name]);
    }
    this.body.update();
    this.armour.update(dt);
  }

  dispose() {
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) m.dispose();
    });
    this.mesh.removeFromParent();
  }
}
