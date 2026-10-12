/**
 * The people in the 3D world, as the passenger model and the crew model have them.
 *
 * On the footplate: the driver and the fireman, standing where cab.js has them, their hands where
 * the crew model has them at this moment (reaching for the regulator, winding the reversing
 * screw, bending to the shovelling plate), looking where they mean to look.
 *
 * The passengers (people/passengers.js): in their seats, passing the time each in their own way
 * (looking out, talking to the person beside them, reading, dozing, a coffee in the diner, a phone
 * held to the glass when the line leaps a gorge); walking the aisle, on the vestibule steps,
 * along the platform, standing out at the photo stop with a phone up to the engine; the conductor
 * by the train. Built a few at a time (those in view first), drawn only near the camera.
 */
import { Vector3, Quaternion } from 'three';
import { makeFigure, passengerLooks, CREW_LOOKS } from '../people/figure.js';
import { cabToModel, CAB } from './locomotive.js';
import { STATIONS } from '../crew/cab.js';
import { BODY } from './pullman.js';

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const _a = new Vector3(), _b = new Vector3(), _q = new Quaternion();

export class PeopleGL {
  constructor(stage, trainGL, sim, { seed = 1211 } = {}) {
    this.stage = stage; this.tgl = trainGL; this.sim = sim;
    this.rand = rng(seed);
    this.time = 0;
    this.crew = [];
    this.model = sim.passengers;
    // the figures' own state (what they are doing in their seat), by passenger
    this.people = [...this.model.list, this.model.conductor].map((p) => ({ p, fig: null, act: 'rest', until: this.rand() * 20, look: 0, phase: this.rand() * 10 }));
    for (const q of this.people) q.partner = null;
    this._partners();
    this.queue = this.people.slice();
    this._crew();
  }

  /** The person each passenger talks to: the nearest other one in the same car. */
  _partners() {
    for (const a of this.people) {
      if (!a.p.seat) continue;
      let best = null, bd = 2.2;
      for (const b of this.people) {
        if (b === a || !b.p.seat || b.p.car !== a.p.car) continue;
        const d = Math.hypot(b.p.seat.x - a.p.seat.x, b.p.seat.z - a.p.seat.z);
        if (d < bd) { bd = d; best = b; }
      }
      a.partner = best;
    }
  }

  get passengers() { return this.people.map((q) => ({ ...q, model: this.tgl.vehicles[q.p.car], act: q.act })); }

  _crew() {
    const eng = this.tgl.vehicles.find((m) => m.kind === 'engine');
    if (!eng) return;
    for (const role of ['driver', 'fireman']) {
      const fig = makeFigure(role, CREW_LOOKS[role], { quality: 'low', texSize: 512 });
      eng.group.add(fig.mesh);
      this.crew.push({ role, fig, model: eng });
    }
  }

  // ---- each frame ---------------------------------------------------------------------------------

  update(dt, camera) {
    this.time += dt;
    const cam = camera.position;
    // build a couple of figures a frame, those nearest the camera first
    if (this.queue.length) {
      this.queue.sort((a, b) => this._dist(a, cam) - this._dist(b, cam));
      for (let k = 0; k < 2 && this.queue.length; k++) {
        const q = this.queue.shift();
        q.fig = q.p.role === 'conductor' ? makeFigure('conductor', CREW_LOOKS.conductor, { quality: 'low', texSize: 512 }) : makeFigure('p' + q.p.id, passengerLooks(rng(q.p.seed)));
        q.parent = null;
      }
    }
    this._updateCrew(dt, cam);
    const onBridge = this.sim.route.structureAt?.(this.sim.train.front)?.type === 'bridge';
    for (const q of this.people) {
      if (!q.fig) continue;
      const p = q.p;
      const hidden = p.state === 'gone' || (p.role === 'conductor' && (p.state === 'aboard' || !p.pos));
      const near = !hidden && this._dist(q, cam) < 90;
      q.fig.mesh.visible = near;
      if (!near) continue;
      this._person(q, dt, onBridge);
    }
  }

  /** Distance of a person from the camera (world), roughly: their car's, or their spot outside. */
  _dist(q, cam) {
    const p = q.p, m = this.tgl.vehicles[p.car];
    if (p.pos?.space === 'out') { this._outWorld(p.pos, _a); return _a.distanceTo(cam); }
    return m ? m.group.position.distanceTo(cam) : 1e9;
  }

  /** A point outside (chainage, offset across, height above the rail) in the world. */
  _outWorld(o, out) {
    const run = this.sim.route.run, P = run.pos(o.s), h = run.headingAt(o.s);
    return this.stage.toWorld(P.x + Math.cos(h) * o.d, P.y - Math.sin(h) * o.d, P.z + o.h, out);
  }

  /** A point in a car's frame in the world. */
  _carWorld(car, x, y, z, out) {
    const m = this.tgl.vehicles[car];
    m.group.updateMatrixWorld();
    return out.set(x, y, z).applyMatrix4(m.group.matrixWorld);
  }

  _parent(q, obj) {
    if (q.parent === obj) return;
    obj.add(q.fig.mesh);
    q.parent = obj;
  }

  _updateCrew(dt, cam) {
    for (const c of this.crew) {
      const near = c.model.group.position.distanceTo(cam) < 70;
      c.fig.mesh.visible = near;
      if (!near) continue;
      const person = this.sim.crew?.[c.role];
      const st = STATIONS[c.role];
      const stand = cabToModel(st.stand);
      let low = 0;
      for (const side of ['L', 'R']) {
        const h = person?.hands?.[side];
        if (!h) { c.fig.reach[side] = null; continue; }
        const p = cabToModel(h.pos);
        c.fig.reach[side] = { x: p.x, y: p.y, z: p.z, w: 1 };
        low = Math.max(low, (CAB.floor + 0.95) - p.y);
      }
      // reaching low (the shovelling plate, the drain cocks) the body bends at the waist
      c.fig.bend += (Math.min(1.25, Math.max(0, low) * 1.6) - c.fig.bend) * Math.min(1, dt * 5);
      const L = person?.look ? cabToModel(person.look) : null;
      const look = L ? Math.max(-1.3, Math.min(1.3, Math.atan2(-(L.z - stand.z), L.x - stand.x))) : 0;
      c.fig.update(dt, { x: stand.x, y: CAB.floor, z: stand.z, yaw: Math.PI / 2, speed: 0, posture: 'stand', look });
    }
  }

  _person(q, dt, onBridge) {
    const p = q.p, fig = q.fig, m = this.tgl.vehicles[p.car];
    fig.reach.L = fig.reach.R = null;
    fig.bend = 0;
    const seatedNow = p.state === 'seated' || (p.state === 'leaving' && p.plan[0]?.wait != null && p.pos?.space === 'car');
    if (seatedNow && p.seat) { this._parent(q, m.group); this._seated(q, dt, onBridge); return; }
    if (p.step) {
      // on the steps: between the vestibule floor and the platform, in the world
      const { inside, outside, k } = p.step;
      this._carWorld(p.car, inside.x, BODY.floor, inside.z, _a);
      this._outWorld(outside, _b);
      _a.lerp(_b, 1 - k);
      this._parent(q, this.stage.scene);
      const yaw = this._carYawToWorld(p.car, p.yaw);
      fig.update(dt, { x: _a.x, y: _a.y, z: _a.z, yaw, speed: 0.5, posture: 'walk' });
      return;
    }
    if (p.pos?.space === 'car') {
      this._parent(q, m.group);
      fig.update(dt, { x: p.pos.x, y: BODY.floor, z: p.pos.z, yaw: p.yaw ?? 0, speed: p.speedNow ?? 0, posture: p.speedNow > 0.05 ? 'walk' : 'stand' });
      return;
    }
    if (p.pos?.space === 'out') {
      this._parent(q, this.stage.scene);
      this._outWorld(p.pos, _a);
      let yaw;
      if (p.state === 'standing') {
        // facing what they came out for: the engine for the photographers, the train for the conductor
        const target = p.act === 'engine' ? this._engineWorld(_b) : this._carWorld(p.car, p.door?.x ?? 0, 1.6, 0, _b);
        yaw = Math.atan2(target.x - _a.x, target.z - _a.z);
        if (p.act === 'engine') this._phoneUp(fig, _a, yaw, _b);
      } else yaw = this._trackYawToWorld(p.pos.s, p.heading ?? 0);
      q.yaw = yaw;
      fig.update(dt, { x: _a.x, y: _a.y, z: _a.z, yaw, speed: p.state === 'standing' ? 0 : p.speedNow ?? 0, posture: p.state === 'standing' ? 'stand' : 'walk' });
    }
  }

  _engineWorld(out) {
    const e = this.tgl.vehicles[0];
    e.group.updateMatrixWorld();
    return out.set(4, 2.6, 0).applyMatrix4(e.group.matrixWorld);
  }

  /** A walking direction along the line (angle from the direction of travel toward the right) as a figure's yaw. */
  _trackYawToWorld(s, ang) {
    const h = this.sim.route.run.headingAt(s);
    const fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
    const mx = fx * Math.cos(ang) + rx * Math.sin(ang), my = fy * Math.cos(ang) + ry * Math.sin(ang);
    return Math.atan2(mx, -my);                    // map (x east, y north) -> world (x, z = -y)
  }

  /** A yaw in a car's frame (0 faces +z) as a yaw in the world. */
  _carYawToWorld(car, yaw) {
    const m = this.tgl.vehicles[car];
    m.group.getWorldQuaternion(_q);
    const d = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).applyQuaternion(_q);
    return Math.atan2(d.x, d.z);
  }

  /** Both hands holding a phone up toward the target, a little below the eyes. */
  _phoneUp(fig, at, yaw, target) {
    const eye = at.y + 1.55 * fig.scale;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const cx = at.x + fx * 0.36, cz = at.z + fz * 0.36, cy = eye - 0.12 + 0.05 * Math.max(-1, Math.min(1, (target.y - eye) / 10));
    const lx = fz, lz = -fx;                       // the figure's left
    fig.reach.L = { x: cx + lx * 0.045, y: cy, z: cz + lz * 0.045, w: 1 };
    fig.reach.R = { x: cx - lx * 0.045, y: cy, z: cz - lz * 0.045, w: 1 };
  }

  // ---- in the seat ------------------------------------------------------------------------------------

  _seated(q, dt, onBridge) {
    const R = this.rand, p = q.p, s = p.seat, t = this.time, fig = q.fig;
    if (t > q.until) {
      const r = R();
      const diner = p.kind === 'diner';
      if (onBridge && R() < 0.5) q.act = 'phone';
      else if (diner && r < 0.4) q.act = 'coffee';
      else if (r < 0.45) q.act = 'window';
      else if (r < 0.65 && q.partner) q.act = 'talk';
      else if (r < 0.75) q.act = 'read';
      else if (r < 0.82) q.act = 'phone';
      else if (r < 0.88 && p.old) q.act = 'doze';
      else q.act = 'rest';
      q.until = t + 12 + R() * 40;
    }
    const f = s.f, lx = f.z, lz = -f.x;            // the passenger's left, in the car frame
    // the window: beside an armchair, in front of a sofa or berth
    const side = s.kind === 'chair' ? Math.sign(s.z) || 1 : Math.sign(f.z) || 1;
    let look = 0, gesture = false;
    const eyeY = BODY.floor + 0.47 * fig.scale + 0.06 + 0.68 * fig.scale;
    const toWindow = Math.atan2(side * lz, side * f.z);
    switch (q.act) {
      case 'window': look = toWindow * 0.85 + 0.15 * Math.sin(t * 0.21 + q.phase); break;
      case 'talk': {
        const o = q.partner.p.seat;
        const dx = o.x - s.x, dz = o.z - s.z;
        look = Math.atan2(dx * lx + dz * lz, dx * f.x + dz * f.z);
        gesture = Math.sin(t * 0.9 + q.phase) > 0.55;
        break;
      }
      case 'read': {
        const cx = s.x + f.x * 0.33, cz = s.z + f.z * 0.33, cy = BODY.floor + 0.72;
        fig.reach.L = { x: cx + lx * 0.11, y: cy, z: cz + lz * 0.11, w: 1 };
        fig.reach.R = { x: cx - lx * 0.11, y: cy, z: cz - lz * 0.11, w: 1 };
        look = 0.05 * Math.sin(t * 0.3 + q.phase);
        break;
      }
      case 'phone': {
        const wx = s.x + f.x * 0.2, wz = s.z + f.z * 0.2 + side * 0.42, cy = eyeY - 0.05;
        fig.reach.L = { x: wx + f.x * 0.03, y: cy, z: wz, w: 1 };
        fig.reach.R = { x: wx - f.x * 0.03, y: cy, z: wz, w: 1 };
        look = toWindow * 0.9;
        break;
      }
      case 'coffee': {
        const sip = Math.sin(t * 0.35 + q.phase) > 0.8;
        const cup = { x: s.x + f.x * 0.42 - lx * 0.12, y: BODY.floor + 0.82, z: s.z + f.z * 0.42 - lz * 0.12 };
        const lips = { x: s.x + f.x * 0.16, y: eyeY - 0.1, z: s.z + f.z * 0.16 };
        fig.reach.R = { ...(sip ? lips : cup), w: 1 };
        look = sip ? 0 : 0.2 * Math.sin(t * 0.2 + q.phase);
        break;
      }
      case 'doze': look = 0.25 * side; break;
      default: look = 0.3 * Math.sin(t * 0.13 + q.phase);
    }
    q.look += (look - q.look) * Math.min(1, dt * 2.5);
    fig.update(dt, { x: s.x, y: BODY.floor, z: s.z, yaw: s.yaw, speed: 0, posture: 'sit', look: q.look, gesture });
  }
}
