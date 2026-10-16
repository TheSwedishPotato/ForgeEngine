/**
 * The whole trip as one simulation, the same in the browser and headless:
 * Friday 11 December 2026, the Pullman steam special Erstfeld - Göschenen.
 * Physics runs at a fixed 240 Hz; the crew decide in their own time; the
 * timetable, the conductor and the signals decide when the train may go.
 */
import { Traffic } from './world/traffic.js';
import { Signals } from './world/signals.js';
import { Route } from './world/route.js';
import { Weather } from './world/weather.js';
import { Train } from './physics/train.js';
import { makeConsist, HELPER } from './physics/consist.js';
import { Crew } from './crew/crew.js';
import { Passengers } from './people/passengers.js';

export const DATE = { year: 2026, month: 12, day: 11, weekday: 'Friday', utcOffset: 1 };   // CET

/** The special's timetable (a heritage path between the hourly regional trains). Times are local. */
export const TIMETABLE = {
  train: 'Extrazug 31120',      // a heritage extra; the number is invented
  // Amsteg-Silenen, Gurtnellen and Wassen lost their passenger trains long ago (Wassen in 2001);
  // the special runs through Amsteg, waits at Gurtnellen to be overtaken by the hourly
  // Treno Gottardo on the other track, and makes a photo stop at Wassen below the church.
  stops: [
    { name: 'Erstfeld', dep: '10:14', why: 'boarding' },
    { name: 'Gurtnellen', arr: '10:38', dep: '10:49', why: 'overtaken' },
    { name: 'Wassen', arr: '11:06', dep: '11:18', why: 'photo stop' },
    { name: 'Göschenen', arr: '11:34', why: 'terminus' },
  ],
};

export const hms = (str) => { const [h, m, s = 0] = str.split(':').map(Number); return h * 3600 + m * 60 + s; };
export const fmt = (sec, withSec = false) => {
  sec = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${withSec ? ':' + String(s).padStart(2, '0') : ''}`;
};

export const DT = 1 / 240;

export class Sim {
  static async create(opts = {}) {
    const route = opts.route ?? await Route.load();
    return new Sim(route, opts);
  }

  constructor(route, { weather = 'clear', weatherOverrides = {}, cars, startClock = hms('10:00'), seed = 1, log = null, seat } = {}) {
    this.route = route;
    this.weather = new Weather(route, weather, weatherOverrides);
    this.timetable = TIMETABLE;
    this.clock = startClock;            // seconds of the local day
    this.train = new Train(route, makeConsist(cars), { sFront: route.origin.stopFront, weather: this.weather, locoOpts: { ambientC: this.weather.p.tempErstfeld } });
    this.crew = new Crew(this, seed);
    this.stopIndex = 0;                 // the stop the train is at or heading for
    this.atStation = this.timetable.stops[0];
    this.events = [];
    this.logFn = log;
    this.boardingDone = true;           // the passenger model clears this while people are getting on/off
    this.history = [];
    this.arrivals = {};
    this._acc = 0;
    // a warm engine standing ready: fire built up, steam near the mark, pipe charged
    const L = this.train.loco;
    L.fire.burning = 240; L.c.blower = 0.25; L.c.drainCocks = true;
    // the people: seated, and at Erstfeld the last few still coming along the platform
    this.passengers = new Passengers(this, { seed: 1211 + seed - 1, player: seat });
    // the other trains and the signals (both run in the physics' time, so joining late, or a test, sees them)
    this.traffic = new Traffic(route);
    this.signals = new Signals(this);
    this._sigAcc = 0;
    const first = this.timetable.stops[0];
    if (this.clock < hms(first.dep) - 40) this.passengers.startAtErstfeld(first);
  }

  log(text) {
    const e = { clock: this.clock, text };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    this.logFn?.(`${fmt(this.clock, true)}  ${text}`);
  }

  get currentStop() { return this.timetable.stops[this.crew.next]; }
  hms(x) { return hms(x); }

  /** The stop the train stands at (when stopped or preparing). */
  get standingAt() { return this.timetable.stops[this.crew.next]; }
  departureDue() {
    const st = this.standingAt;
    return !!st?.dep && this.clock >= hms(st.dep);
  }
  departureSoon() {
    const st = this.standingAt;
    return !!st?.dep && this.clock >= hms(st.dep) - 90;
  }
  /** The conductor gives the right away when everyone is aboard and the doors are shut (exit signal clears at the booked time). */
  readyToStart() { return this.boardingDone; }

  arrived(stop) {
    this.arrivals[stop.name] = this.clock;
    const late = stop.arr ? this.clock - hms(stop.arr) : 0;
    this.log(`Arrived ${stop.name} ${fmt(this.clock, true)}${stop.arr ? ` (booked ${stop.arr}, ${late >= 0 ? '+' : ''}${(late / 60).toFixed(1)} min)` : ''}.`);
    this.passengers?.onArrive(stop);
    this.onArrive?.(stop);
  }

  /**
   * The driver has called the dispatcher: a banking engine is sent up from Erstfeld. Getting a
   * locomotive and driver ready takes about a quarter of an hour (estimate), then it runs up
   * behind the train on the same track at up to 60 km/h and buffers up gently.
   */
  requestAssistance() {
    if (this.assist) return;
    const dist = Math.max(0, this.train.rear - this.route.origin.s);
    const travel = dist / (55 / 3.6);
    this.assist = { requested: this.clock, eta: this.clock + 14 * 60 + travel, state: 'coming' };
    this.log(`Dispatcher: banking engine from Erstfeld, about ${Math.round((14 * 60 + travel) / 60)} minutes.`);
  }

  _assistTick() {
    const A = this.assist, T = this.train;
    if (!A) return;
    if (A.state === 'coming' && this.clock >= A.eta - 40) {
      T.addBehind(HELPER, 60, 1.5);
      A.state = 'approaching';
      this.log('Banking engine in sight behind the train.');
    }
    if (A.state === 'approaching') {
      const h = T.helper, last = T.veh[T.veh.length - 2];
      const gap = (last.s - last.length / 2) - (h.s + h.length / 2);
      // its driver closes up at walking pace and buffers up at about 1 m/s
      const want = gap > 20 ? 3 : gap > 3 ? 1.5 : 0.8;
      T.helperPower = h.v < want ? Math.min(0.15, (want - h.v) * 0.2) : 0;
      if (T.coupled[T.coupled.length - 1]) {
        A.state = 'coupled'; T.brake.helperCoupled = true; T.helperPower = 0;
        this.log('Banking engine coupled; brake pipe connected and tested.');
        A.coupledAt = this.clock;
      }
    }
    if (A.state === 'coupled') {
      // pushes when the steam engine is working, by radio; stays behind at the summit
      const L = T.loco;
      const working = L.c.regulator > 0.15 && this.crew.phase !== 'approach';
      T.helperPower += ((working ? 0.6 : 0) - T.helperPower) * Math.min(1, DT * 0.5);
      if (T.speed * 3.6 > 45) T.helperPower *= 0.5;
    }
  }

  /**
   * The other trains are solid: where one of them and the special come together on the same rails
   * (a signal passed at danger, a runaway rolling back), they collide. The Treno Gottardo (about
   * 290 t, estimate) and the vehicle that strikes it share their momentum (an inelastic impact;
   * the rest of the special arrives through its buffers); hard enough, the vehicle is thrown off
   * the rails. Afterwards the other train stands where it was struck.
   */
  _collisions() {
    const T = this.train, M = 290e3;
    for (const r of this.traffic.runs) {
      if (!r.onMap || r.done) continue;
      for (const [track, a0, b0] of r.occupies()) {
        if (track !== 'L') continue;
        const a = Math.min(a0, b0), b = Math.max(a0, b0);
        if (b <= T.rear || a >= T.front) continue;
        const i = r._i(r.u), dir = Math.sign(r.ts[Math.min(i + 1, r.ts.length - 1)] - r.ts[Math.max(0, i - 1)]) || 1;
        const vr = r.crashed ? 0 : dir * r.v;
        const ahead = (a + b) / 2 > (T.rear + T.front) / 2;
        const k = ahead ? 0 : T.veh.length - 1, v = T.veh[k];
        const closing = ahead ? v.v - vr : vr - v.v;
        if (closing <= 0.05) continue;
        const m = v.mNow ?? v.mass, vc = (m * v.v + M * vr) / (m + M), first = !r.crashed;
        if (first) this.log(`COLLISION with the ${r.train.name.includes('south') ? 'southbound' : 'northbound'} Treno Gottardo at ${(closing * 3.6).toFixed(0)} km/h!`);
        r.crashed = true; r.v = 0;
        // the impact shares the momentum; after it the wreck of the other train is a dead weight in the way
        v.v = first ? vc : ahead ? Math.min(v.v, 0) : Math.max(v.v, 0);
        if (closing > 6 && !v.wreck) T.derail.derail(k, 'was thrown off the rails in the collision', { lat: (k % 2 ? 1 : -1) * 0.6, roll: 0 });
        else if (!v.wreck) { v.v = ahead ? Math.min(v.v, 0) : Math.max(v.v, 0); T.brake.handle = 'emergency'; }
      }
    }
  }

  /** The derailments and what follows them, into the trip's log. */
  _wreckNews() {
    const E = this.train.events;
    this._evN ??= 0;
    for (; this._evN < E.length; this._evN++) {
      const e = E[this._evN];
      if (e.type === 'derailed') this.log(`DERAILED: the ${e.name} ${e.why} at ${(Math.abs(e.speed) * 3.6).toFixed(0)} km/h, km ${this.route.kmAt(e.s).toFixed(2)}.`);
      else if (e.type === 'coupling broke') this.log(`The coupling between the ${e.between[0]} and the ${e.between[1]} has torn apart.`);
      else if (e.type === 'on its side') this.log(`The ${e.name} has gone over on its side.`);
      else if (e.type === 'fell') this.log(`The ${e.name} has fallen, striking the ground at ${(e.speed * 3.6).toFixed(0)} km/h.`);
    }
  }

  /** Advance the world by dt seconds of simulated time. */
  advance(dt) {
    this._acc += dt;
    while (this._acc >= DT) {
      this._acc -= DT;
      this.clock += DT;
      this.crew.tick(DT);
      this.passengers.tick(DT);
      this._assistTick();
      this.train.step(DT);
      this._sigAcc += DT;
      if (this._sigAcc >= 0.1) { this.traffic.step(this._sigAcc, this.clock, this.signals); this._collisions(); this.signals.step(this._sigAcc); this._sigAcc = 0; this._wreckNews(); }
    }
  }
}
