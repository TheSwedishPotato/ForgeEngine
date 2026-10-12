/**
 * The passengers of the special as people with somewhere to be.
 *
 * Who sits where (a well-booked train, the player's armchair kept free); who is still on the
 * platform at Erstfeld when the ride begins, walking up to their car; the vestibule steps, one
 * person at a time per door (a heavyweight car's steps are steep: about three seconds each); the
 * aisle to the seat. At the Wassen photo stop most of them get out to photograph the engine and
 * the church above the loops, until the conductor calls them back; at Göschenen everyone gets out
 * and goes. Each person's weight rides with the train: getting on adds it to the car's mass,
 * getting off takes it away.
 *
 * The conductor is on the platform at every stop with people about, gets on last, and gives the
 * right away only when everyone is aboard and the doors are shut (sim.boardingDone).
 *
 * Positions: inside a car { space: 'car', car, x, z } in the car's frame (x forward, z right);
 * outside { space: 'out', s, d, h }: chainage, offset across the line (+ right of the direction
 * of travel), height above the rail.
 */
import { LAYOUTS, BODY, doorsOf, aisleZ } from '../world/carLayout.js';

const MASS = 80;              // kg: a person in winter clothes with a bag
const STEP_TIME = 3.2;        // s up or down a vestibule's steps
const PLATFORM_H = 0.55;      // m, the Swiss standard platform height above the rail
const FILL = { parlor: 0.78, observation: 0.62, diner: 0.55, sleeper: 0.3 };

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class Passengers {
  constructor(sim, { seed = 1211, player = { car: 'parlor', chair: 12 } } = {}) {
    this.sim = sim;
    this.rand = rng(seed);
    this.list = [];
    this.doors = new Map();          // `${car}:${x}` -> time the steps are free again
    this._acc = 0;
    this.player = player;
    this._seat();
    const C = { id: 'conductor', role: 'conductor', car: this._middleCar(), state: 'aboard', pos: null, plan: [], speed: 1.35, mass: MASS };
    C.door = { x: doorsOf(LAYOUTS[sim.train.veh[C.car].kind]())[0] };
    this.conductor = C;
    for (const p of this.list) sim.train.passengers[p.car] += p.mass;
    sim.train.passengers[C.car] += C.mass;
  }

  _middleCar() {
    const V = this.sim.train.veh;
    const cars = V.map((v, i) => i).filter((i) => LAYOUTS[V[i].kind]);
    return cars[Math.floor(cars.length / 2)];
  }

  /** Seats from the cars' plans, filled at random (the same every run). */
  _seat() {
    const R = this.rand, V = this.sim.train.veh;
    let playerDone = false;
    V.forEach((veh, car) => {
      const mk = LAYOUTS[veh.kind];
      if (!mk) return;
      const L = mk();
      const seats = [];
      L.chairs.forEach((c, i) => {
        const f = { x: Math.cos(c.yaw ?? 0), z: -Math.sin(c.yaw ?? 0) };
        seats.push({ x: c.x - f.x * 0.12, z: c.z - f.z * 0.12, yaw: (c.yaw ?? 0) + Math.PI / 2, f, kind: 'chair', index: i, table: veh.kind === 'diner' });
      });
      for (const s of L.sofas ?? []) {
        const th = s.yaw ?? 0, w = s.w ?? 1.5, n = w > 1.6 ? 3 : 2;
        const f = { x: Math.cos(th), z: -Math.sin(th) };
        for (let k = 0; k < n; k++) {
          const pz = (k - (n - 1) / 2) * (w / n), px = -0.1;
          seats.push({ x: s.x + px * Math.cos(th) + pz * Math.sin(th), z: s.z - px * Math.sin(th) + pz * Math.cos(th), yaw: th + Math.PI / 2, f, kind: s.berth ? 'berth' : 'sofa' });
        }
      }
      const doors = doorsOf(L);
      for (const st of seats) {
        if (!playerDone && veh.kind === this.player.car && st.kind === 'chair' && st.index === this.player.chair) { playerDone = true; st.player = true; continue; }
        if (R() > (FILL[veh.kind] ?? 0.5)) continue;
        // the door nearer the seat
        const door = doors.reduce((a, b) => (Math.abs(b - st.x) < Math.abs(a - st.x) ? b : a));
        const old = R() < 0.45;
        this.list.push({
          id: this.list.length, car, kind: veh.kind, layout: L, seat: st, door: { x: door }, seed: Math.floor(R() * 1e9),
          old, speed: (old ? 1.0 : 1.25) + R() * 0.25, mass: MASS - 10 + R() * 25,
          state: 'seated', pos: { space: 'car', car, x: st.x, z: st.z }, yaw: st.yaw, plan: [], photo: R() < 0.72, act: null,
        });
      }
    });
  }

  // ---- the plans --------------------------------------------------------------------------------

  /** The platform side at a stop (+1 right of the direction of travel). */
  _side(stop) {
    const st = this.sim.route.stations.find((x) => x.name === stop.name);
    return st?.platformSide ?? 1;
  }

  _platformH(stop) { return stop.name === 'Wassen' ? 0.05 : PLATFORM_H; }

  /** The car's middle chainage now. */
  _carS(car) { return this.sim.train.veh[car].s; }

  /** Out through the nearest door onto the platform, as a list of legs. */
  _legsOut(p, side, h) {
    const L = p.layout, legs = [];
    const xd = p.door.x;
    // up from the seat into the aisle, along it to the vestibule, to the door
    legs.push({ space: 'car', x: p.seat.x + p.seat.f.x * 0.45, z: (p.seat.z + aisleZ(L, p.seat.x)) / 2 });
    for (const x of stepsAlong(p.seat.x, xd)) legs.push({ space: 'car', x, z: aisleZ(L, x) });
    legs.push({ space: 'car', x: xd, z: side * (BODY.half - 0.25) });
    legs.push({ door: 'down', x: xd, side, h });
    return legs;
  }

  /** In at the door and along the aisle to the seat. */
  _legsIn(p, side, h) {
    const L = p.layout, legs = [];
    const xd = p.door.x;
    legs.push({ door: 'up', x: xd, side, h });
    legs.push({ space: 'car', x: xd, z: aisleZ(L, xd) });
    for (const x of stepsAlong(xd, p.seat.x)) legs.push({ space: 'car', x, z: aisleZ(L, x) });
    legs.push({ space: 'car', x: p.seat.x + p.seat.f.x * 0.45, z: (p.seat.z + aisleZ(L, p.seat.x)) / 2 });
    legs.push({ sit: true });
    return legs;
  }

  /** Ride begins at Erstfeld: the last few are still on the platform. */
  startAtErstfeld(stop) {
    const R = this.rand, side = this._side(stop), h = this._platformH(stop);
    const late = this.list.filter(() => R() < 0.13).slice(0, 10);
    for (const p of late) {
      const sd = this._carS(p.car) + p.door.x;
      const from = sd + (R() < 0.5 ? -1 : 1) * (25 + R() * 55);
      p.state = 'walking';
      p.pos = { space: 'out', s: from, d: side * (3 + R() * 2.5), h };
      p.plan = [{ wait: this.sim.clock + R() * 12 }, { space: 'out', s: sd, d: side * (BODY.half + 1.2), h }, ...this._legsIn(p, side, h)];
      this.sim.train.passengers[p.car] -= p.mass;
      p.aboard = false;
    }
    this._conductorOut(stop, this.sim.clock, hmsOf(stop.dep) - 25);
    this.sim.boardingDone = false;
  }

  /** At a stop: the photo stop and the terminus have plans; elsewhere everyone stays aboard. */
  onArrive(stop) {
    const R = this.rand, side = this._side(stop), h = this._platformH(stop), now = this.sim.clock;
    if (stop.why === 'photo stop') {
      const dep = hmsOf(stop.dep);
      const front = this.sim.train.front;
      for (const p of this.list) {
        if (!p.photo || p.state !== 'seated') continue;
        // a place to stand: most ahead of the engine, to have it coming at them; some along the train
        const ahead = R() < 0.65;
        const spot = ahead ? front + 6 + R() * 38 : this._carS(p.car) + (R() - 0.5) * 30;
        const d = side * (ahead ? 3.5 + R() * 6 : 5 + R() * 5);
        const back = dep - 260 + R() * 70;            // the conductor's call is four minutes before the off
        p.state = 'leaving';
        p.plan = [{ wait: now + 25 + R() * 50 }, ...this._legsOut(p, side, h), { space: 'out', s: spot, d, h }, { look: 'engine', until: back }, { space: 'out', s: this._carS(p.car) + p.door.x, d: side * (BODY.half + 1.0), h }, ...this._legsIn(p, side, h)];
      }
      this._conductorOut(stop, now + 20, dep - 30);
      this.sim.log?.(`Conductor: twelve minutes at Wassen for photographs. Back aboard by ${fmtClock(dep - 120)}, please.`);
      this._callAt = dep - 240;
      this.sim.boardingDone = false;
    } else if (stop.why === 'terminus') {
      const st = this.sim.route.stations.find((x) => x.name === stop.name);
      for (const p of this.list) {
        if (p.state !== 'seated') continue;
        p.state = 'leaving';
        const exit = (st?.s ?? this.sim.train.front) - 40 + R() * 30;
        p.plan = [{ wait: now + 30 + R() * 150 }, ...this._legsOut(p, side, h), { space: 'out', s: exit, d: side * (4 + R() * 4), h }, { gone: true }];
      }
      this._conductorOut(stop, now + 15, Infinity);
      this.sim.log?.('Conductor: Göschenen, end of the journey. Thank you for travelling with us.');
    }
  }

  /** The conductor steps down at `from`, stands by the middle of the train, gets on last at `board`. */
  _conductorOut(stop, from, board) {
    const C = this.conductor, side = this._side(stop), h = this._platformH(stop);
    const sd = this._carS(C.car) + C.door.x;
    C.layout = LAYOUTS[this.sim.train.veh[C.car].kind]();
    C.side = side;
    C.state = 'leaving';
    C.pos = { space: 'car', car: C.car, x: C.door.x, z: side * (BODY.half - 0.3) };
    C.plan = [{ wait: from }, { door: 'down', x: C.door.x, side, h }, { space: 'out', s: sd - 6, d: side * (BODY.half + 2.5), h }, { look: 'train', until: board, conductor: true }];
    if (Number.isFinite(board)) C.plan.push({ space: 'out', s: sd, d: side * (BODY.half + 1.0), h }, { door: 'up', x: C.door.x, side, h }, { aboard: true });
  }

  // ---- each tenth of a second -----------------------------------------------------------------------

  tick(dt) {
    this._acc += dt;
    if (this._acc < 0.1) return;
    const step = this._acc;
    this._acc = 0;
    const now = this.sim.clock;
    if (this._callAt && now >= this._callAt) { this._callAt = null; this.sim.log?.('Conductor: all aboard, please!'); }
    let busy = false;
    for (const p of [...this.list, this.conductor]) {
      if (!p.plan.length) continue;
      this._advance(p, step, now);
      if (p.plan.length && p !== this.conductor) busy = true;
    }
    const C = this.conductor;
    // the right away: nobody left on the platform or in the vestibules, and the conductor aboard
    const ready = !busy || this.list.every((p) => p.state === 'seated' || p.state === 'gone' || p.state === 'toSeat');
    this.sim.boardingDone = ready && (C.state === 'aboard' || !C.plan.length);
    // the conductor gets on when everyone else is aboard (or at the booked time)
    if (ready && C.plan.length && C.plan[0].conductor) C.plan[0].until = Math.min(C.plan[0].until, now + 4);
  }

  _advance(p, dt, now) {
    let t = dt;
    while (t > 1e-6 && p.plan.length) {
      const leg = p.plan[0];
      if (leg.wait != null) { if (now < leg.wait) { p.speedNow = 0; return; } p.plan.shift(); continue; }
      if (leg.look) { p.state = 'standing'; p.act = leg.look; p.speedNow = 0; if (now < leg.until) return; p.act = null; p.plan.shift(); continue; }
      if (leg.sit) { p.plan.shift(); p.state = 'seated'; p.pos = { space: 'car', car: p.car, x: p.seat.x, z: p.seat.z }; p.yaw = p.seat.yaw; p.speedNow = 0; continue; }
      if (leg.gone) { p.plan.shift(); p.state = 'gone'; p.pos = null; continue; }
      if (leg.aboard) { p.plan.shift(); p.state = 'aboard'; p.pos = null; continue; }
      if (leg.door) {
        // the steps: wait for them to be free, then a few seconds up or down
        const key = `${p.car}:${leg.x}`;
        if (!leg.t0) {
          const free = this.doors.get(key) ?? 0;
          if (now < free) { p.speedNow = 0; return; }
          leg.t0 = now; this.doors.set(key, now + STEP_TIME);
          p.state = 'stepping';
        }
        const k = Math.min(1, (now - leg.t0) / STEP_TIME);
        const sDoor = this._carS(p.car) + leg.x;
        const inside = { space: 'car', car: p.car, x: leg.x, z: leg.side * (BODY.half - 0.25) };
        const outside = { space: 'out', s: sDoor, d: leg.side * (BODY.half + 0.55), h: leg.h };
        p.step = { inside, outside, k: leg.door === 'up' ? k : 1 - k, dir: leg.door };
        // facing into the car going up, out of it going down (car frame: yaw 0 faces +z)
        p.yaw = leg.door === 'up' ? (leg.side > 0 ? Math.PI : 0) : (leg.side > 0 ? 0 : Math.PI);
        if (k < 1) return;
        p.step = null;
        p.plan.shift();
        p.pos = leg.door === 'up' ? inside : outside;
        // aboard or not: the car's mass changes with the person's
        if (leg.door === 'up') { this.sim.train.passengers[p.car] += p.mass; p.aboard = true; p.state = 'toSeat'; }
        else { this.sim.train.passengers[p.car] -= p.mass; p.aboard = false; p.state = 'walking'; }
        continue;
      }
      // walking to the next point, in the space it is given in
      if (leg.space !== p.pos.space) p.pos = leg.space === 'car' ? { space: 'car', car: p.car, x: leg.x, z: leg.z } : { space: 'out', s: leg.s, d: leg.d, h: leg.h };
      const P = p.pos;
      const [ax, az, bx, bz] = P.space === 'car' ? [P.x, P.z, leg.x, leg.z] : [P.s, P.d, leg.s, leg.d];
      const dx = bx - ax, dz = bz - az, dist = Math.hypot(dx, dz);
      const v = p.speed * (P.space === 'car' ? 0.75 : 1);
      p.speedNow = v;
      if (dist < 1e-3) { p.plan.shift(); continue; }
      const go = Math.min(dist, v * t);
      t -= go / v;
      if (P.space === 'car') { P.x += (dx / dist) * go; P.z += (dz / dist) * go; p.yaw = Math.atan2(dx, dz); }
      else { P.s += (dx / dist) * go; P.d += (dz / dist) * go; P.h = leg.h; p.heading = Math.atan2(dz, dx); }
      if (go >= dist - 1e-6) p.plan.shift();
    }
  }
}

/** x positions every half metre from a toward b (excluding a). */
function stepsAlong(a, b) {
  const out = [], n = Math.max(1, Math.ceil(Math.abs(b - a) / 0.5));
  for (let i = 1; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

const hmsOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 3600 + m * 60; };
const fmtClock = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;
