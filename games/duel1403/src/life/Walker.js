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
const _v = new Vector3();
const TAU = Math.PI * 2, D = (deg) => deg * Math.PI / 180;

/**
 * What a person standing at their task is doing, from the words of their
 * activity: the motion the body makes. Each gives per-side arm raise and
 * elbow bend (radians), a forward bend of the trunk and the head, at time t.
 */
export function taskOf(act = '', role = '') {
  const a = act.toLowerCase();
  if (/ringing/.test(a)) return 'bell';
  if (/hammer|forging|shoeing/.test(a) || (/^working$/.test(a) && /smith|apprentice/.test(role))) return 'hammer';
  if (/digging|ploughing|weeding|gleaning|threshing|fields|dung/.test(a)) return 'dig';
  if (/sweeping/.test(a)) return 'sweep';
  if (/drawing water|fetching water/.test(a)) return 'water';
  if (/cooking|spinning|lighting the fire|heating|baking|keeping house|feeding the beasts|bleeding and shaving/.test(a)) return 'handwork';
  if (/eating|drinking/.test(a)) return 'eat';
  if (/confession|saying the hours|breviary|praying|fasting/.test(a)) return 'pray';
  if (/reckoning|town book|accounts/.test(a)) return 'write';
  if (/begging/.test(a)) return 'beg';
  if (/drilling|cleaning his gear/.test(a)) return 'drill';
  if (/watch at the gate|standing watch|watching/.test(a)) return 'guard';
  if (/selling|serving|gossip|talking|hiring|stories|judging|hearing|calling|taking on|buying|working/.test(a)) return 'talk';
  return null;
}

function taskPose(task, t, side, seed) {
  const s = Math.sin, c = Math.cos, R = side === 'R';
  const pulse = (f, sharp = 3) => Math.pow(Math.max(0, s(t * f * TAU + seed)), sharp);
  switch (task) {
    case 'hammer': {   // a stroke a second: lift, then drop on the anvil; the other hand holds the work in tongs
      const u = 0.5 + 0.5 * s(t * TAU * 0.9 + seed);
      return R ? { arm: 0.5 + 1.1 * u, elbow: 1.5 - 0.9 * u, abd: 0.15, bend: 0.28, head: 0.45 } : { arm: 0.75, elbow: 1.0, abd: 0.12, bend: 0.28, head: 0.45 };
    }
    case 'bell': {     // hauling on the bell rope overhead, both hands, knees giving with each pull
      const u = 0.5 + 0.5 * s(t * TAU * 0.45 + seed);
      return { arm: 1.3 + 1.2 * u, elbow: 0.25 + 0.5 * (1 - u), abd: 0.05, bend: 0.15 * (1 - u), head: -0.25 * u };
    }
    case 'dig': {      // stooped over a hoe or the plough handles, both arms working together
      const u = s(t * TAU * 0.7 + seed);
      return { arm: 0.75 + 0.45 * u, elbow: 0.55 - 0.25 * u, abd: 0.12, bend: 0.55 + 0.12 * u, head: 0.3 };
    }
    case 'sweep': { const u = s(t * TAU * 0.8 + seed); return { arm: 0.55 + (R ? 0.2 : -0.1) * u, elbow: 0.5, abd: 0.1 + (R ? 0.12 : -0.06) * u, bend: 0.3, head: 0.25, twist: 0.25 * u }; }
    case 'water': { const u = 0.5 + 0.5 * s(t * TAU * 0.5 + seed); return { arm: 0.6 + 0.9 * (R ? u : 1 - u), elbow: 0.7, abd: 0.1, bend: 0.25, head: 0.35 }; }
    case 'handwork': { // stirring, spinning, kneading: small working circles in front of the belly
      return R ? { arm: 0.65 + 0.15 * s(t * TAU * 1.1 + seed), elbow: 1.45 + 0.2 * c(t * TAU * 1.1 + seed), abd: 0.18, bend: 0.2, head: 0.4 } : { arm: 0.55, elbow: 1.35 + 0.1 * s(t * 2 + seed), abd: 0.15, bend: 0.2, head: 0.4 };
    }
    case 'eat': {      // a bite or a pull at the mug every few seconds
      const u = pulse(0.22, 2);
      return R ? { arm: 0.45 + 0.55 * u, elbow: 1.2 + 1.0 * u, abd: 0.12, bend: 0.12, head: 0.15 - 0.2 * u } : { arm: 0.4, elbow: 1.3, abd: 0.1, bend: 0.12, head: 0.15 };
    }
    case 'pray': return { arm: 0.55, elbow: 1.75, abd: -0.05, bend: 0.12, head: 0.4 };   // hands joined before the chest, head bowed
    case 'write': return R ? { arm: 0.6, elbow: 1.5 + 0.06 * s(t * 9 + seed), abd: 0.15, bend: 0.32, head: 0.55 } : { arm: 0.55, elbow: 1.4, abd: 0.12, bend: 0.32, head: 0.55 };
    case 'beg': { const u = pulse(0.15, 1); return R ? { arm: 0.6 + 0.4 * u, elbow: 0.4, abd: 0.08, bend: 0.2, head: -0.05 } : { arm: 0.2, elbow: 0.6, abd: 0.08, bend: 0.2, head: -0.05 }; }
    case 'drill': { const u = pulse(0.6, 2); return { arm: 0.7 + 0.35 * u, elbow: 0.9 - 0.5 * u, abd: 0.12, bend: 0.1 + 0.1 * u, head: 0.05 }; }
    case 'guard': return R ? { arm: 0.35, elbow: 1.25, abd: 0.12, bend: 0, head: 0.02, look: 0.6 * s(t * 0.21 + seed) } : { arm: 0.05, elbow: 0.25, abd: 0.08, bend: 0, head: 0.02, look: 0.6 * s(t * 0.21 + seed) };
    case 'talk': {     // the hands speak too: now one, now the other
      const u = pulse(R ? 0.31 : 0.23, 2);
      return { arm: 0.15 + 0.5 * u, elbow: 0.4 + 1.0 * u, abd: 0.1, bend: 0.02, head: 0.05 };
    }
    default: return null;
  }
}

/** A periodic curve through [phase 0..1, value] points (Catmull-Rom). */
function cycle(points) {
  const n = points.length;
  return (phi) => {
    phi = ((phi % 1) + 1) % 1;
    let i = 0;
    while (i < n - 1 && points[i + 1][0] <= phi) i++;
    const p = (j) => points[((j % n) + n) % n];
    const a = p(i - 1), b = p(i), c = p(i + 1), d = p(i + 2);
    const span = ((c[0] - b[0]) + 1) % 1 || 1;
    const u = (((phi - b[0]) + 1) % 1) / span;
    const u2 = u * u, u3 = u2 * u;
    return 0.5 * ((2 * b[1]) + (-a[1] + c[1]) * u + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * u2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * u3);
  };
}
// Normal walking, degrees, from heel strike (0) through toe-off (about 0.6) to the next heel strike.
const HIP = cycle([[0, 30], [0.1, 27], [0.2, 19], [0.3, 10], [0.4, 1], [0.5, -8], [0.56, -10], [0.62, -4], [0.7, 10], [0.8, 25], [0.87, 33], [0.94, 31]]);
const KNEE = cycle([[0, 3], [0.06, 11], [0.13, 17], [0.22, 13], [0.32, 6], [0.42, 4], [0.5, 9], [0.58, 30], [0.65, 50], [0.72, 61], [0.8, 50], [0.88, 25], [0.95, 6]]);
const ANKLE = cycle([[0, 0], [0.06, -7], [0.15, -1], [0.3, 6], [0.45, 10], [0.55, 2], [0.62, -18], [0.7, -10], [0.8, -1], [0.9, 2]]);

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
    this.v = 0; this.k = 0; this.run = 0; this.lean = 0; this.lateral = 0;
    this.seed = (name.length * 1.37) % 6.28;
    this.pose = {};
    this.footRestY = this.b.footL.pos.y;
    this.mesh = new Group();
    const c = this.colors;
    this.body = new BodyMesh(this, { skin: c.skin ?? SKIN_TONES.light, hair: c.hair, cloth: c.cloth, hose: c.hose, shoe: '#3b2a1c', quality, inflateTorso: female ? 0.008 : 0.012, inflateArm: 0.008, female, beard, headwear, texSize });
    this.armour = new ArmourMesh(this.body, this, { quality });
    this.mesh.add(this.body.group);
  }

  /**
   * Orientation of every segment. Walking follows normal adult gait
   * (Perry & Burnfield; Winter): per cycle from heel strike, the hip goes
   * from 30° flexion to 10° extension at about 55 % and back; the knee
   * flexes about 15° in loading response and about 60° in swing; the ankle
   * plantarflexes about 7° after heel strike, dorsiflexes to about 10° in
   * late stance and plantarflexes about 18° at toe-off. The pelvis rotates
   * ±4°, drops about 4° on the swing side and tilts forward about 4°; the
   * thorax counter-rotates, the arms swing against the legs with the elbows
   * a little bent, and the head stays level and looking ahead. All scale
   * with speed (k); faster than about 2 m/s blends into a run.
   */
  _orient(dt, speed, posture) {
    const P = this.pose;
    const k = this.k, run = this.run;
    const t = this.t;
    const breath = 0.015 * Math.sin(t * 1.7);
    const ph = this.phase;
    const L = ph, R = (ph + 0.5) % 1;
    const idle = Math.max(0, 1 - k * 3);
    // weight shift when standing: slow, from foot to foot
    const shift = idle * Math.sin(t * 0.55 + this.seed);
    const rotA = -D(4) * k * Math.cos(TAU * L);
    const obl = D(4) * k * Math.sin(2 * TAU * L) + D(2.2) * shift;
    const tilt = D(4) + D(1.5) * k * Math.cos(2 * TAU * L) + D(6) * run;
    this.lateral = 0.022 * k * Math.sin(TAU * L) + 0.03 * shift;
    P.pelvis = qy(rotA).multiply(qx(tilt * 0.6)).multiply(qz(obl));
    P.abdomen = qy(-rotA * 0.3).multiply(qx(0.06 + D(3) * k + D(6) * run + breath)).multiply(qz(-obl * 0.6));
    P.chest = qy(-rotA * 0.9).multiply(qx(0.08 + D(3) * k + D(7) * run + breath)).multiply(qz(-obl * 0.4));
    // the head keeps level and looks where it means to
    const wander = idle * (0.18 * Math.sin(t * 0.23 + this.seed) + 0.08 * Math.sin(t * 0.61));
    P.head = qy((this.look ?? 0) + wander).multiply(qx(0.1 + D(4) * k + D(4) * run + 0.03 * idle * Math.sin(t * 0.17)));
    for (const [side, sx, phi] of [['L', 1, L], ['R', -1, R]]) {
      // the loaded leg straight, the other knee eased, when standing
      const load = side === 'L' ? Math.max(0, shift) : Math.max(0, -shift);
      let hip = D(HIP(phi)), knee = D(KNEE(phi)), ank = D(ANKLE(phi));
      hip = D(5) + (hip - D(5)) * k + D(12) * run * Math.max(0, Math.sin(TAU * (phi - 0.6)));
      knee = D(3) + (knee - D(3)) * k + D(45) * run * Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (phi - 0.5) / 0.45))));
      ank *= k;
      if (idle > 0) { hip += idle * D(4) * (1 - load); knee += idle * (D(2) + D(9) * (1 - load)); }
      if (posture === 'sit') { hip = 1.45; knee = 1.45; ank = 0; }
      if (posture === 'pillory') { hip = 0.12; knee = 0.1; ank = 0.05; }
      const ab = sx * (0.03 + (posture === 'sit' ? 0.08 : 0));
      P['thigh' + side] = qz(ab).multiply(qx(-hip));
      P['shin' + side] = P['thigh' + side].clone().multiply(qx(knee));
      // foot pitch from the ankle angle: flat when the shin leans over it by the dorsiflexion
      const shinPitch = knee - hip;
      P['foot' + side] = qy(sx * 0.1).multiply(qx(posture === 'sit' ? 0 : shinPitch - ank));
      // arms swing against the legs; the elbow bends more as the arm comes forward
      const swing = -Math.cos(TAU * phi) * (D(16) * k + D(20) * run);
      let arm = D(3) + swing, elbow = D(14) + D(8) * k + D(10) * Math.max(0, swing) / Math.max(1e-3, D(16)) * k + D(65) * run;
      let abd = 0.07 + 0.03 * run;
      if (posture === 'sit') { arm = 0.5; elbow = 1.1; }
      if (posture === 'pillory') { arm = 1.25; elbow = 0.15; abd = 0.32; }
      if (this.gesture && side === 'R' && posture !== 'pillory') { arm = Math.max(arm, 0.45); elbow += 1.0; }
      // at work: the task's motion, faded in as he stops walking
      const tw = this.taskW * (posture === 'pillory' || posture === 'lie' ? 0 : 1);
      if (tw > 0.01 && this.task) {
        const tp = taskPose(this.task, t, side, this.seed);
        if (tp) { arm += (tp.arm - arm) * tw; elbow += (tp.elbow - elbow) * tw; abd += (tp.abd - abd) * tw; this._tp = tp; }
      }
      P['upperArm' + side] = qz(sx * abd).multiply(qx(-arm));
      P['forearm' + side] = P['upperArm' + side].clone().multiply(qx(-elbow));
    }
    if (this._tp && this.taskW > 0.01 && posture !== 'pillory' && posture !== 'lie') {
      const w = this.taskW, tp = this._tp, sit = posture === 'sit' ? 0.4 : 1;
      P.abdomen = qx(tp.bend * 0.45 * w * sit).multiply(P.abdomen);
      P.chest = qy((tp.twist ?? 0) * w).multiply(qx(tp.bend * w * sit)).multiply(P.chest);
      P.head = qy((tp.look ?? 0) * w).multiply(qx(tp.head * w)).multiply(P.head);
      this._tp = null;
    }
    if (posture === 'pillory') {
      // bent at the board, neck and wrists through it
      P.pelvis = qx(0.2); P.abdomen = qx(0.55); P.chest = qx(0.75); P.head = qx(0.35);
    }
    void dt; void speed;
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
  update(dt, { x, y, z, yaw, speed = 0, posture = 'stand', gesture = false, look = 0, task = null }) {
    dt = Math.min(dt, 0.1);
    if (task) this.task = task;
    this.taskW = (this.taskW ?? 0) + (((task && speed < 0.05) ? 1 : 0) - (this.taskW ?? 0)) * Math.min(1, dt * 3);
    this.t = (this.t ?? 0) + dt;
    // start and stop smoothly: speed eases in and out over about a quarter second
    if (posture !== 'stand' && posture !== 'walk') speed = 0;
    this.v += (speed - this.v) * Math.min(1, dt * 6);
    const v = this.v;
    const kWant = v < 0.05 ? 0 : Math.min(1.35, Math.pow(Math.max(0.2, v) / 1.35, 0.55));
    this.k += (kWant - this.k) * Math.min(1, dt * 5);
    this.run += (Math.max(0, Math.min(1, (v - 2.0) / 1.0)) - this.run) * Math.min(1, dt * 4);
    // stride from the legs' own geometry, so the planted foot does not skate
    if (v > 0.03) {
      const stride = Math.max(0.25, this._strideAt(Math.max(0.3, this.k)) * (1 + 0.45 * this.run));
      this.phase = (this.phase + (v / stride) * dt) % 1;
    } else {
      // come to rest at double support, feet together
      const target = this.phase < 0.25 ? 0 : this.phase < 0.75 ? 0.5 : 1;
      this.phase += (target - this.phase) * Math.min(1, dt * 3);
      this.phase %= 1;
    }
    // lean into turns
    if (this.lastYaw !== undefined && dt > 0) {
      let dy = yaw - this.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const want = Math.max(-0.14, Math.min(0.14, -(dy / dt) * v * 0.05));
      this.lean += (want - this.lean) * Math.min(1, dt * 4);
    }
    this.lastYaw = yaw;
    this.gesture = gesture;
    this.look = look;
    this._orient(dt, posture === 'sit' ? 0 : v, posture);
    const pos = this._fk();
    // put the lower foot on the ground (or the seat under the pelvis)
    let shift;
    if (posture === 'sit') shift = y + 0.47 * this.scale - pos.pelvis.y + 0.06;
    else shift = y - (Math.min(pos.footL.y, pos.footR.y) - this.footRestY);
    const root = qy(yaw);
    if (posture === 'lie') root.multiply(qx(-Math.PI / 2));
    else root.multiply(qz(this.lean));
    const lat = posture === 'lie' || posture === 'sit' ? 0 : this.lateral;
    for (const b of this.ragdoll.list) {
      const p = pos[b.name];
      _v.copy(p);
      _v.x += lat;
      if (posture === 'lie') { _v.y -= this.b.pelvis.userData.restPos.y; }
      _v.applyQuaternion(root);
      b.pos.set(x + _v.x, (posture === 'lie' ? y + 0.15 : shift) + _v.y, z + _v.z);
      b.q.copy(root).multiply(this.pose[b.name]);
    }
    this.body.update();
    this.armour.update(dt);
  }

  /** Horizontal travel of the stance foot under the hip (heel strike to toe-off), metres, divided by the stance fraction. */
  _strideAt(k) {
    const key = Math.round(k * 50);
    this._strides ??= new Map();
    if (this._strides.has(key)) return this._strides.get(key);
    const { L1, L2 } = this.ragdoll.bones.legL;
    const z = (phi) => {
      const hip = D(5) + (D(HIP(phi)) - D(5)) * k, knee = D(3) + (D(KNEE(phi)) - D(3)) * k;
      return L1 * Math.sin(hip) + L2 * Math.sin(hip - knee);
    };
    const v = (z(0) - z(0.6)) / 0.6;
    this._strides.set(key, v);
    return v;
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
