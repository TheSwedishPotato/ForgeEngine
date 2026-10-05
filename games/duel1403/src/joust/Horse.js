import { Vector3, Quaternion } from 'three';
import { Shape } from '../physics/index.js';
import { KinematicBody } from './constraints.js';
import { HORSE } from '../data/joust.js';
import { quatToRotVec } from '../physics/math.js';

const UP = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0);
const _q = new Quaternion(), _q2 = new Quaternion(), _v = new Vector3();

/**
 * The jousting horse. It is driven, not simulated: the rider's legs and
 * reins choose a speed and a line, and the horse follows them within what a
 * 600 kg courser can do (acceleration, turning circle by gait). Its back
 * rises and pitches with the gait, which the rider and his lance feel.
 *
 * Frame: local +Z is forward, +X the horse's left, origin at the centre of
 * the barrel.
 */
export class Horse {
  constructor(world, { id, coat = 'bay', position = new Vector3(), yaw = 0 }) {
    this.id = id;
    this.coat = HORSE.coats[coat] ?? HORSE.coats.bay;
    this.body = new KinematicBody({ name: 'horse' + id, position: new Vector3(position.x, HORSE.barrelY, position.z) });
    const ud = (part) => ({ horse: true, owner: id, part, segType: 'horse', mat: 'horse' });
    const add = (s) => { s.collidesWithPlane = false; this.body.addShape(s); return s; };
    add(Shape.capsule(0.33, 0.45, new Vector3(0, 0, 1), new Vector3(0, 0, -0.05), { userData: ud('barrel'), friction: 0.5, restitution: 0.05, compliance: 1 / 4e5, damping: 900 }));
    add(Shape.sphere(0.3, new Vector3(0, 0.12, 0.62), { userData: ud('chest'), compliance: 1 / 4e5, damping: 900 }));
    add(Shape.capsule(0.17, 0.3, new Vector3(0, 0.6, 0.8).normalize(), new Vector3(0, 0.42, 0.88), { userData: ud('neck'), compliance: 1 / 4e5, damping: 900 }));
    add(Shape.capsule(0.11, 0.2, new Vector3(0, -0.55, 0.83).normalize(), new Vector3(0, 0.56, 1.3), { userData: ud('head'), compliance: 1 / 4e5, damping: 900 }));
    this.body.userData = { horse: true, owner: id };
    world.addBody(this.body);

    this.yaw = yaw;
    this.speed = 0;
    this.targetSpeed = 0;
    this.goal = null;          // { x, z }: ride towards it
    this.heading = null;       // or hold this yaw
    this.phase = 0;
    this.stride = 0;
    this.pitch = 0;
    this.bob = 0;
    this.time = 0;
    this.nextPos = new Vector3();
    this.nextQ = new Quaternion();
    this._pose(this.body.pos.clone().setY(0), yaw, 0, 0, this.body.pos, this.body.q);
  }

  get gait() {
    const v = this.speed, G = HORSE.gaits;
    return v < 0.15 ? 'halt' : v < (G.walk + G.trot) / 2 ? 'walk' : v < (G.trot + G.canter) / 2 ? 'trot' : v < (G.canter + G.gallop) / 2 ? 'canter' : 'gallop';
  }

  get forward() { return _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  /** Ground point under the barrel. */
  get ground() { return new Vector3(this.body.pos.x, 0, this.body.pos.z); }

  /** Max turn rate (rad/s): a horse turns short at a walk, wide at the gallop. */
  turnRate() {
    const v = Math.max(0.5, this.speed);
    return Math.min(1.1, 2.6 / v);   // lateral acceleration ~2.6 m/s^2 at speed
  }

  _pose(groundPos, yaw, bob, pitch, outP, outQ) {
    outP.set(groundPos.x, HORSE.barrelY + bob, groundPos.z);
    outQ.setFromAxisAngle(UP, yaw).multiply(_q2.setFromAxisAngle(X, pitch));
  }

  place(x, z, yaw) {
    this.yaw = yaw;
    this.speed = 0;
    this.targetSpeed = 0;
    this._pose(new Vector3(x, 0, z), yaw, 0, 0, this.body.pos, this.body.q);
    this.body.prevPos.copy(this.body.pos);
    this.body.prevQ.copy(this.body.q);
    this.body.vel.set(0, 0, 0);
    this.body.omega.set(0, 0, 0);
  }

  /**
   * Plans the next frame: sets the body's velocity so the world's substeps
   * carry it smoothly to the next pose.
   */
  plan(dt) {
    this.time += dt;
    const dv = this.targetSpeed - this.speed;
    this.speed += Math.sign(dv) * Math.min(Math.abs(dv), (dv > 0 ? HORSE.accel : HORSE.brake) * dt);
    let want = this.yaw;
    const p = this.body.pos;
    if (this.goal) {
      const dx = this.goal.x - p.x, dz = this.goal.z - p.z;
      if (dx * dx + dz * dz > 0.04) want = Math.atan2(dx, dz);
    } else if (this.heading !== null) want = this.heading;
    let e = want - this.yaw;
    while (e > Math.PI) e -= 2 * Math.PI;
    while (e < -Math.PI) e += 2 * Math.PI;
    const r = this.turnRate() * dt;
    this.yaw += Math.max(-r, Math.min(r, e * Math.min(1, dt * 4) * 4));
    const hz = HORSE.strideHz(this.speed);
    this.stride = hz;
    this.phase = (this.phase + hz * dt) % 1;
    // The back: the gallop and canter rock (one suspension per stride), the trot bounces twice.
    const g = this.gait, ph = this.phase * Math.PI * 2;
    const amp = { halt: 0, walk: 0.018, trot: 0.045, canter: 0.06, gallop: 0.07 }[g];
    const pitchAmp = { halt: 0, walk: 0.012, trot: 0.02, canter: 0.05, gallop: 0.055 }[g];
    this.bob = g === 'trot' ? amp * Math.cos(2 * ph) : amp * Math.cos(ph);
    this.pitch = pitchAmp * Math.sin(ph + (g === 'trot' ? 0 : 0.8));
    _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(this.speed * dt).add(p).setY(0);
    this._pose(_v, this.yaw, this.bob, this.pitch, this.nextPos, this.nextQ);
    const b = this.body;
    b.vel.subVectors(this.nextPos, b.pos).multiplyScalar(1 / dt);
    _q.copy(b.q).invert().premultiply(this.nextQ);
    quatToRotVec(_q, b.omega).multiplyScalar(1 / dt);
  }

  /** After the world step: land exactly on the planned pose. */
  commit() {
    this.body.pos.copy(this.nextPos);
    this.body.q.copy(this.nextQ);
  }
}
