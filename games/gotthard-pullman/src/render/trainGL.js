/**
 * The train on the screen: every vehicle placed on the real track from the physics, its
 * trucks on the rails (the body follows the chord between them, tilted by the cant and
 * the grade), the wheels turning with the distance run, the engine's wheels with its crank.
 */
import { Group, Euler, Quaternion, Vector3, Matrix4 } from 'three';
import { buildCar, BODY } from './pullman.js';
import { buildLocomotive, animateLocomotive, buildTender, animateTender, LOCO } from './locomotive.js';
import { RAIL_SPACING } from '../world/route.js';
import { CarRide } from '../physics/sway.js';

const _e = new Euler(0, 0, 0, 'YZX');

/** Body pose from two support points on the track at chainages sa (front) and sb (rear). */
export function poseOnTrack(line, sa, sb, out = {}) {
  const a = line.pos(sa), b = line.pos(sb);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, L = Math.hypot(dx, dy);
  const heading = Math.atan2(dx, dy);
  const cantAt = (s) => -Math.atan2(line.cantAt(s), RAIL_SPACING) * Math.sign(line.curvatureAt(s));
  out.x = mx; out.y = my; out.z = mz;
  out.yaw = Math.PI / 2 - heading;            // three.js rotation.y that turns the vehicle's +x onto the heading
  out.heading = heading;
  out.pitch = Math.atan2(dz, L);
  out.roll = (cantAt(sa) + cantAt(sb)) / 2;
  return out;
}

export class TrainGL {
  constructor(stage, route, train) {
    this.stage = stage; this.route = route; this.train = train;
    this.group = new Group();
    this.group.name = 'train';
    stage.scene.add(this.group);
    this.vehicles = train.veh.map((v) => this._model(v));
    for (const m of this.vehicles) this.group.add(m.group);
  }

  _model(v) {
    if (v.kind === 'engine') {
      const { group, parts } = buildLocomotive();
      // the body rides on the leading and trailing coupled axles (its rigid wheelbase)
      return { v, group, parts, supports: (LOCO.axles[4] - LOCO.axles[0]) / 2, offset: LOCO.half - (LOCO.axles[0] + LOCO.axles[4]) / 2, trucks: [], kind: 'engine' };
    }
    if (v.kind === 'tender') { const { group, parts } = buildTender(); return { v, group, parts, supports: 1.8, offset: 0, trucks: [], kind: 'tender' }; }
    if (v.kind === 'helper') return this._placeholder(v);
    const { group, info } = buildCar(v.kind, v.name);
    return { v, group, info, supports: BODY.truck, trucks: info.trucks, ride: new CarRide({ truck: BODY.truck }) };
  }

  _placeholder(v) {
    // (the engine and tender come next; a dark block of the right size meanwhile)
    const { group } = buildCar('parlor', v.name);
    group.scale.set(v.length / 25.3, 1, 1);
    return { v, group, info: null, supports: v.length * 0.35, trucks: [] };
  }

  update(dt = 0) {
    const line = this.route.run, st = this.stage, o = st.origin;
    const pose = {};
    const ddt = Math.min(dt, 0.05);
    for (const m of this.vehicles) {
      const s = m.v.s, sc = s + (m.offset ?? 0);
      poseOnTrack(line, sc + m.supports, sc - m.supports, pose);
      // the model's origin is the vehicle's middle; the supports may sit off it (the engine's coupled wheelbase)
      const fx = Math.sin(pose.heading), fy = Math.cos(pose.heading), off = -(m.offset ?? 0);
      m.group.position.set(pose.x + fx * off - o.x, pose.z - o.z, -(pose.y + fy * off - o.y));
      // the car body on its springs (sway, bounce, roll, pitch), integrated in small steps
      let sw = m.sway;
      if (m.ride) {
        if (ddt > 0) {
          const n = Math.max(1, Math.ceil(ddt / (1 / 120)));
          for (let i = 0; i < n; i++) sw = m.ride.step(ddt / n, s, m.v.v, m.v.a ?? 0, line.curvatureAt(s), line.cantAt(s));
          m.sway = sw;
        }
        if (sw) {
          const rx = Math.cos(pose.heading), ry = -Math.sin(pose.heading);     // right of the heading
          m.group.position.x += rx * sw.lateral;
          m.group.position.z += -ry * sw.lateral;
          m.group.position.y += sw.vertical;
        }
      }
      _e.set((m.roll ?? pose.roll) + (sw?.roll ?? 0), pose.yaw, pose.pitch + (sw?.pitch ?? 0), 'YZX');
      m.group.rotation.copy(_e);
      if (m.kind === 'engine') animateLocomotive(m.parts, this.train.loco.theta, s);
      if (m.kind === 'tender') animateTender(m.parts, s);
      // the trucks follow the track under the body
      for (const [k, tr] of m.trucks.entries()) {
        const ts = s + (k === 0 ? m.supports : -m.supports);
        const h = line.headingAt(ts);
        tr.rotation.y = -(h - pose.heading);
        for (const ws of tr.userData.wheelsets) ws.rotation.z = -ts / BODY.wheelR;
      }
      m.pose = { ...pose };
    }
    this._publishCars();
  }

  /** The cars' frames and window bands, for the interior lighting. */
  _publishCars() {
    const cars = this.vehicles.filter((m) => m.info);
    const n = Math.min(8, cars.length);
    const C = (this.stage.cars ??= { count: 0, inv: new Float32Array(16 * 8), mat: new Float32Array(16 * 8), band: new Float32Array(32), info: new Float32Array(32), lamp: new Float32Array(32) });
    C.count = n;
    const inv = new Matrix4();
    for (let k = 0; k < n; k++) {
      const m = cars[k];
      m.group.updateMatrixWorld();
      C.mat.set(m.group.matrixWorld.elements, k * 16);
      inv.copy(m.group.matrixWorld).invert();
      C.inv.set(inv.elements, k * 16);
      const W = m.info.windows;
      const all = [...W.right, ...W.left];
      const x0 = Math.min(...all.map((q) => q.x0)), x1 = Math.max(...all.map((q) => q.x1));
      const share = (list) => list.filter((q) => !q.frosted).reduce((a, q) => a + (q.x1 - q.x0), 0) / (x1 - x0);
      C.band.set([x0, x1, BODY.belt, BODY.winTop], k * 4);
      C.info.set([BODY.bodyHalf - 0.06, BODY.half - BODY.wall, share(W.right), share(W.left)], k * 4);
      const lamps = m.info.lamps.slice().sort((a, b) => a - b);
      const sp = lamps.length > 1 ? (lamps.at(-1) - lamps[0]) / (lamps.length - 1) : 1;
      C.lamp.set([m.lampPower ?? 0, lamps[0] ?? 0, sp, lamps.length], k * 4);
    }
  }
}
