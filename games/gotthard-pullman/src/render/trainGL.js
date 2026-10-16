/**
 * The train on the screen: every vehicle placed on the real track from the physics, its
 * trucks on the rails (the body follows the chord between them, tilted by the cant and
 * the grade), the wheels turning with the distance run, the engine's wheels with its crank.
 */
import { Group, Euler, Quaternion, Vector3, Matrix4 } from 'three';
import { buildCar, BODY, carMaterials } from './pullman.js';
import { buildLocomotive, animateLocomotive, animateCab, animateGauges, buildTender, animateTender, LOCO } from './locomotive.js';
import { RAIL_SPACING } from '../world/route.js';
import { CarRide } from '../physics/sway.js';
import { feedSteam } from './steam.js';
import { wheelsetShift } from './wheel.js';

const _w = new Vector3();

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
  // (a three.js roll about the vehicle's x turns its right side down for a positive angle: the
  // track's cant, which lowers the inner rail, is the opposite sign of the track's own angle)
  out.roll = -(cantAt(sa) + cantAt(sb)) / 2;
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
    stage.glass?.setPanes(this.vehicles.filter((m) => m.info).slice(0, 8).map((m) => m.info));
    // the weather on the windows: what has gathered while the train stood in Erstfeld, then the trip's own
    const p = train.weather?.p ?? {};
    this.sillSnow = (p.snowfall ?? 0) * 0.004;          // m (about half an hour's worth)
    this.lampLevel = 0;
    // snow lies on the cars' steel roofs after their wait at Erstfeld (the roofs are not heated)
    const roofSnow = Math.min(0.85, (p.snowfall ?? 0) * 0.45);
    carMaterials().roof.color.setRGB(0.045 + (0.82 - 0.045) * roofSnow, 0.047 + (0.84 - 0.047) * roofSnow, 0.05 + (0.88 - 0.05) * roofSnow);
    carMaterials().roof.roughness = 0.65 + 0.25 * roofSnow;
  }

  /** Snow, frost and thaw on the outside of the windows, and the lamps inside (per frame). */
  _weatherOnGlass(dt) {
    const g = this.stage.glass, T = this.train;
    if (!g) return;
    const p = T.weather?.p ?? {}, here = T.weather?.at?.(T.front, T.time);
    const inTunnel = !!here?.tunnel;
    // snow driven against the car sticks on the sill and in the corners (more with wind and speed), melts above 0 °C
    const temp = here?.tempC ?? 0;
    const rate = (p.snowfall ?? 0) * 0.01 / 3600 * (0.6 + Math.min(1.5, (Math.abs(T.speed) + (p.wind ?? 0)) / 12));
    if (!inTunnel) this.sillSnow += rate * dt;
    if (temp > 0.5) this.sillSnow -= dt * 0.002 / 60 * temp;
    this.sillSnow = Math.max(0, Math.min(0.09, this.sillSnow));
    const frost = p.id === 'fog' ? 0.75 : temp < -8 ? 0.35 : temp < -2 ? 0.12 : 0.0;
    const wet = p.id === 'foehn' ? 0.6 : temp > -1.5 && (p.snowfall ?? 0) > 0 ? 0.3 : 0;
    g.snow = [this.sillSnow, Math.min(1, this.sillSnow * 25 + ((p.snowfall ?? 0) > 0 ? 0.25 : 0)), frost, wet];
    g.speed = Math.abs(T.speed);
    // the lamps: on in the tunnels and on dark days
    const dark = inTunnel || ['heavy', 'blizzard', 'fog'].includes(p.id);
    this.lampLevel += ((dark ? 1 : 0) - this.lampLevel) * Math.min(1, dt * 3);
    g.lamp = this.lampLevel;
    const sh = this.stage.r.env.sh;
    const k = 0.282095 / Math.PI * (inTunnel ? 0.0 : 0.06);
    g.interior = [sh[0] * k + this.lampLevel * 0.004, sh[1] * k + this.lampLevel * 0.0035, sh[2] * k + this.lampLevel * 0.0027];
    for (const m of this.vehicles) if (m.info) m.lampPower = this.lampLevel * 0.006;
  }

  /** The vestibule doors: opened on the platform side while people get on and off, shut for the right away. */
  _doors(dt) {
    const sim = this.sim;
    let side = 0;
    if (sim && !sim.boardingDone && Math.abs(this.train.speed) < 0.05 && sim.standingAt) {
      if (this._doorStop !== sim.standingAt) { this._doorStop = sim.standingAt; this._doorSide = sim.passengers?._side(sim.standingAt) ?? 0; }
      side = this._doorSide;
    }
    for (const m of this.vehicles) for (const d of m.info?.doorLeaves ?? []) {
      const want = d.s === side ? 1 : 0;
      d.open += Math.max(-dt * 0.6, Math.min(dt * 0.6, want - d.open));
      d.holder.rotation.y = d.s * d.dir * 1.45 * d.open;     // inward, nearly square to the side
    }
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
      if (m.kind === 'engine') { animateLocomotive(m.parts, this.train.loco.theta, s); animateCab(m.parts.controls, this.train.loco.c, this.train.brake, ddt); animateGauges(m.parts.controls, this.train.loco, this.train.brake, this.train.speed, ddt); }
      if (m.kind === 'engine' && m.parts.pony) this._pony(m, s, pose);
      if (m.kind === 'tender') {
        animateTender(m.parts, s);
        for (const [j, w] of m.parts.wheels.entries()) w.position.z = wheelsetShift(LOCO.tenderR, s + w.position.x, m.v.v, line.curvatureAt(s + w.position.x), j * 2.1);
      }
      // the trucks follow the track under the body: they stay on the rails while the body moves on
      // its springs (so the body's sway, bounce, roll and pitch are taken out of them again)
      for (const [k, tr] of m.trucks.entries()) {
        const ts = s + (k === 0 ? m.supports : -m.supports);
        const h = line.headingAt(ts);
        tr.userData.x0 ??= tr.position.x;
        const x0 = tr.userData.x0;
        tr.position.set(x0, -(sw?.vertical ?? 0) - x0 * (sw?.pitch ?? 0), -(sw?.lateral ?? 0));
        tr.rotation.x = -(sw?.roll ?? 0);
        tr.rotation.z = -(sw?.pitch ?? 0);
        tr.rotation.y = -(h - pose.heading);
        for (const [j, ws] of tr.userData.wheelsets.entries()) {
          ws.rotation.z = -ts / BODY.wheelR;
          // each wheelset steered by its coned treads: hunting on the straight, out to the flange in curves
          ws.position.z = wheelsetShift(BODY.wheelR, ts + ws.position.x, m.v.v, line.curvatureAt(ts), k * 1.7 + j * 0.9);
        }
      }
      m.pose = { ...pose };
    }
    this._publishCars();
    this._doors(ddt);
    this._weatherOnGlass(ddt);
    // the engine's steam
    const eng = this.vehicles[0];
    if (eng?.kind === 'engine' && this.stage.steam) {
      const h = eng.pose.heading, v = eng.v.v;
      eng.group.updateMatrixWorld();
      const vel = { x: Math.sin(h) * v, y: 0, z: -Math.cos(h) * v };
      const here = this.train.weather?.at?.(eng.v.s, this.train.time);
      if (here) this.stage.steam.setAir(here.tempC, here.tunnel, vel);
      feedSteam(this.stage.steam, this.train.loco, eng.group, vel, ddt || 1 / 60);
    }
  }

  /**
   * The engine's pony truck swings on its pivot to follow the rails: in a curve the track under
   * it lies off the line of the coupled wheelbase the frame rides on, and the truck goes with
   * the track (its wheels in the rails), not with the frame.
   */
  _pony(m, s, pose) {
    const P = m.parts.pony, line = this.route.run;
    P.userData.x0 ??= P.position.x;
    P.userData.y0 ??= P.position.y;
    const x0 = P.userData.x0, sp = s + x0;
    const q = line.pos(sp);
    this.stage.toWorld(q.x, q.y, q.z, _w);
    m.group.updateMatrixWorld();
    m.group.worldToLocal(_w);
    P.position.set(x0, P.userData.y0 + _w.y, _w.z + wheelsetShift(LOCO.ponyR, sp, m.v.v, line.curvatureAt(sp), 0.4));
    P.rotation.y = -(line.headingAt(sp) - pose.heading);
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
