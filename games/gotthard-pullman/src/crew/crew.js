/**
 * The engine crew: a driver (Lokführer, on the right) and a fireman (Heizer, on the left).
 *
 * Nothing on the footplate changes by itself. Every control moves only while a hand is
 * on it: the hand first travels there (Fitts' law, cab.js), then works it at the speed a
 * person can (a regulator pulled open over a second or two, a reversing screw wound a
 * turn a second, a shovelful every three or four seconds). One hand does one thing at a
 * time. Decisions come with human reaction times.
 *
 * The driver works the climb the way steam men did: the regulator wide open on the bank
 * and the power set with the reversing screw, notching up as the train gathers speed;
 * a slip is answered by shutting off, sanding and opening up again gently; stops are made
 * by shutting off early and letting the gradient take the speed, then a light brake.
 * The fireman fires little and often, keeps the water in the glass with the injector, and
 * keeps the safety valves from blowing at the stations.
 */
import { CONTROLS, STATIONS, reachTime } from './cab.js';

const kmh = (x) => x / 3.6;

class Hand {
  constructor(person, side) {
    this.person = person; this.side = side;
    const st = STATIONS[person.role];
    this.rest = side === 'L' ? st.restL : st.restR;
    this.pos = [...this.rest];
    this.from = [...this.rest]; this.to = [...this.rest];
    this.t = 0; this.T = 0;          // movement progress
    this.queue = [];                 // jobs in order; queue[0] is being done: { control, phase: 'wait'|'reach'|'work'|'hold'|'return', ... }
    this.on = null;                  // name of the control the hand is on
  }
  get job() { return this.queue[0] ?? null; }
  get free() { return this.queue.length === 0; }
  moveTo(p, T) { this.from = [...this.pos]; this.to = [...p]; this.t = 0; this.T = Math.max(0.05, T); }
  update(dt) {
    if (this.t < this.T) {
      this.t = Math.min(this.T, this.t + dt);
      const u = this.t / this.T, s = u * u * u * (10 - 15 * u + 6 * u * u);     // minimum-jerk profile
      for (let k = 0; k < 3; k++) this.pos[k] = this.from[k] + (this.to[k] - this.from[k]) * s;
    }
    return this.t >= this.T;
  }
}

class Person {
  constructor(role, rand) {
    this.role = role;
    this.rand = rand;
    this.hands = { L: new Hand(this, 'L'), R: new Hand(this, 'R') };
    this.look = [...STATIONS[role].look];
    this.say = null;
    this.reaction = 0.35 + 0.25 * rand();   // s, this person's typical reaction time
  }
  /** A free hand, preferring the given side. */
  hand(pref) {
    const a = this.hands[pref ?? 'R'], b = this.hands[pref === 'L' ? 'R' : 'L'];
    return a.free ? a : b.free ? b : null;
  }
}

export class Crew {
  /** sim: { train, route, clock (seconds of day), timetable, signals, conductor, log(text) } */
  constructor(sim, seed = 1) {
    this.sim = sim;
    let s = seed >>> 0 || 1;
    this.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.driver = new Person('driver', this.rand);
    this.fireman = new Person('fireman', this.rand);
    this.people = [this.driver, this.fireman];
    this.phase = 'prep';
    this.next = 0;                   // index of the next stop in the timetable
    this.decideIn = 0;
    this.fireDecideIn = 0;
    this.slipSince = -1;
    this.sandUntil = 0;
    this.whistles = [];              // { t, pattern } for audio
    this.notes = [];
    this.firing = 0;                 // shovels left in the current round
    this.lastShovel = -99;
    this.stoppedAt = null;
    this.targetSpeed = 0;
    this.planned = { brake: 0 };
    this._tunnelWarned = new Set();
    this._stationWarned = new Set();
  }

  get loco() { return this.sim.train.loco; }

  log(text) { this.sim.log?.(text); this.notes.push({ t: this.sim.train.time, text }); if (this.notes.length > 40) this.notes.shift(); }

  /**
   * Queue a job for a hand: reach the control, work it to `to` at `rate` (units/s) or
   * run `fn` when the hand arrives; optionally keep the hand there for `hold` s.
   */
  work(person, control, { to, rate = 1, fn = null, hold = 0, pref = null, after = 0, queue = false } = {}) {
    const side = pref ?? (CONTROLS[control].pos[0] >= 0 ? 'R' : 'L');
    // queue: line the job up behind whatever this hand is doing (a sequence of movements)
    const h = queue ? person.hands[side] : person.hand(side);   // otherwise the other hand if this one is busy
    if (!h) return false;
    h.queue.push({ control, to, rate, fn, hold, phase: 'wait', wait: after });
    return true;
  }

  busy(person, control) {
    return Object.values(person.hands).some((h) => h.queue.some((j) => j.control === control));
  }

  _setControl(name, value) {
    const c = this.loco.c, B = this.sim.train.brake;
    switch (name) {
      case 'regulator': c.regulator = value; break;
      case 'reverser': c.reverser = value; break;
      case 'drainCocks': c.drainCocks = value > 0.5; break;
      case 'sander': c.sander = value > 0.5; break;
      case 'whistle': c.whistle = value; break;
      case 'blower': c.blower = value; break;
      case 'dampers': c.dampers = value; break;
      case 'firedoor': c.firedoor = value > 0.5; break;
      case 'injectorL': c.injector[0] = value > 0.5; break;
      case 'injectorR': c.injector[1] = value > 0.5; break;
      case 'steamHeat': c.steamHeat = value; break;
      case 'startingValve': c.startingValve = value > 0.5; break;
      case 'directBrake': B.direct = value; break;
      case 'trainBrake':
        if (value === 'release' || value === 'running' || value === 'lap' || value === 'emergency') B.handle = value;
        else B.setService(value);
        break;
    }
  }

  _getControl(name) {
    const c = this.loco.c, B = this.sim.train.brake;
    switch (name) {
      case 'regulator': return c.regulator;
      case 'reverser': return c.reverser;
      case 'blower': return c.blower;
      case 'dampers': return c.dampers;
      case 'whistle': return c.whistle;
      case 'steamHeat': return c.steamHeat;
      case 'directBrake': return B.direct;
      default: return 0;
    }
  }

  _updateHands(dt) {
    for (const p of this.people) {
      for (const h of Object.values(p.hands)) {
        const arrived = h.update(dt);
        const j = h.job;
        if (!j) { h.on = null; continue; }
        const ctl = CONTROLS[j.control];
        if (j.phase === 'wait') {
          j.wait -= dt;
          if (j.wait <= 0) { j.phase = 'reach'; h.moveTo(ctl.pos, reachTime(h.pos, ctl, this.rand)); p.look = [...ctl.pos]; }
        } else if (j.phase === 'reach' && arrived) {
          j.phase = 'work'; h.on = j.control;
          if (j.fn) { j.fn(); j.phase = j.hold > 0 ? 'hold' : 'return'; }
        } else if (j.phase === 'work') {
          if (typeof j.to === 'number' && typeof this._getControl(j.control) === 'number' && !['drainCocks', 'sander', 'firedoor', 'injectorL', 'injectorR', 'startingValve', 'trainBrake'].includes(j.control)) {
            const cur = this._getControl(j.control);
            const d = j.to - cur, stepv = j.rate * dt;
            const nv = Math.abs(d) <= stepv ? j.to : cur + Math.sign(d) * stepv;
            this._setControl(j.control, nv);
            // hand follows the handle a little
            h.pos[0] = ctl.pos[0] + (j.control === 'regulator' ? -0.12 * nv : 0);
            if (nv === j.to) j.phase = j.hold > 0 ? 'hold' : 'return';
          } else {
            this._setControl(j.control, j.to);
            j.phase = j.hold > 0 ? 'hold' : 'return';
          }
        } else if (j.phase === 'hold') {
          j.hold -= dt;
          if (j.hold <= 0) { if (j.release != null) this._setControl(j.control, j.release); j.phase = 'return'; }
        } else if (j.phase === 'return') {
          h.queue.shift(); h.on = null;
          // straight on to the next job in the queue, or back to rest
          if (!h.queue.length) { h.moveTo(h.rest, reachTime(h.pos, { pos: h.rest, size: 0.2 }, this.rand) * 0.8); p.look = [...STATIONS[p.role].look]; }
        }
      }
    }
  }

  /** A whistle: the driver pulls the cord for `dur` seconds. */
  whistle(dur = 1.2, why = '') {
    if (this.busy(this.driver, 'whistle')) return;
    const ok = this.work(this.driver, 'whistle', { fn: () => { this.loco.c.whistle = 1; this.whistles.push({ t: this.sim.train.time, dur, why }); }, hold: dur, pref: 'L' });
    if (ok) { const h = Object.values(this.driver.hands).find((x) => x.queue.some((j) => j.control === 'whistle')); const j = h?.queue.find((x) => x.control === 'whistle'); if (j) j.release = 0; }
  }

  // ---------------------------------------------------------------------------

  /** You take the driver's place (true) or give it back: his hands leave the controls. */
  setManual(on) {
    this.manual = !!on;
    for (const h of Object.values(this.driver.hands)) h.queue.length = 0;
    if (!on && this.phase === 'run') this.decideIn = 0;
    this.log(on ? 'You take over the regulator; the driver stands back.' : 'The driver takes over again.');
  }

  tick(dt) {
    // off the rails: the driver shuts off steam and puts the brake into emergency, and that is all
    // there is to do; the fireman still minds the fire and the water (a boiler is a boiler)
    if (this.sim.train.derail?.any && this.phase !== 'derailed') {
      this.phase = 'derailed';
      this.loco.c.regulator = 0;
      this.sim.train.brake.handle = 'emergency';
      for (const h of Object.values(this.driver.hands)) h.queue.length = 0;
      this.log('Driver: steam off, emergency brake - we are off the road!');
    }
    this._updateHands(dt);
    if (this.phase === 'derailed') { this.fireDecideIn -= dt; if (this.fireDecideIn <= 0) { this.fireDecideIn = 0.5; this._firemanThink(); } return; }
    this.decideIn -= dt; this.fireDecideIn -= dt;
    if (this.decideIn <= 0) { this.decideIn = 0.25; if (this.manual) this._manualThink(); else this._driverThink(); }
    if (this.fireDecideIn <= 0) { this.fireDecideIn = 0.5; this._firemanThink(); }
  }

  // ---------------------------------------------------------------------------
  // The driver

  _stopTarget() {
    const tt = this.sim.timetable, R = this.sim.route;
    const st = tt.stops[this.next];
    if (!st) return null;
    const station = R.stations.find((x) => x.name === st.name);
    // where the front of the engine should come to rest
    const sFront = station.stopFront ?? station.stopCentre + this.sim.train.length / 2;
    return { ...st, station, sFront };
  }

  /**
   * You are driving: the driver only keeps the book - where she stands, when she starts, the stops -
   * from what the train actually does, so the stations, the passengers and the timetable go on.
   */
  _manualThink() {
    const T = this.sim.train, v = T.speed, t = T.time;
    const stop = this._stopTarget();
    const d = stop ? stop.sFront - T.front : 1e9;
    switch (this.phase) {
      case 'prep': case 'stopped': {
        if (this.phase === 'stopped' && this.next >= this.sim.timetable.stops.length - 1) { this.phase = 'arrived'; break; }
        if (v > 0.3) {
          const early = !this.sim.departureDue?.(), notReady = !this.sim.readyToStart?.();
          this.log(early ? 'Driver: we are not due out yet!' : notReady ? 'Conductor: not everyone is aboard!' : 'Driver: right away.');
          this.next++; this.phase = 'run'; this._t0 = t;
        }
        break;
      }
      case 'starting': case 'run': case 'approach': case 'drawup': {
        if (this.phase !== 'approach' && stop && d < 1600) this.phase = 'approach';
        if (Math.abs(v) < 0.05 && stop && Math.abs(d) < 40) {
          this.phase = 'stopped'; this.stoppedAt = t;
          this.log(`Stopped at ${stop.name}, ${d >= 0 ? d.toFixed(1) + ' m short of' : (-d).toFixed(1) + ' m past'} the mark.`);
          this.sim.arrived?.(stop);
        } else if (stop && d < -250) {
          this.log(`Through ${stop.name} without stopping.`);
          this.next++; this.phase = 'run';
        }
        break;
      }
    }
  }

  /** Speed the driver wants now: line, curves and engine limits ahead, with braking curves. */
  _speedPlan() {
    const T = this.sim.train, R = this.sim.route.run;
    const front = T.front, rear = T.rear;
    const vmaxEngine = kmh(60);                     // a little under the engine's 65 km/h for the heritage stock
    let vt = vmaxEngine;
    // the curve and station limits under the whole train, and ahead with a gentle planning deceleration
    const b = 0.3;
    // running early against the timetable: ease the pace (no point arriving before the booked time)
    const stop = this._stopTarget(), dep = this.sim.timetable.stops[this.next - 1];
    if (stop?.arr && dep?.dep) {
      const t0 = this.sim.hms(dep.dep), t1 = this.sim.hms(stop.arr);
      const s0 = this.sim.route.stations.find((x) => x.name === dep.name).s, s1 = stop.sFront;
      const frac = Math.min(1, Math.max(0, (this.sim.clock - t0) / Math.max(60, t1 - t0)));
      const ahead = front - (s0 + (s1 - s0) * frac);
      if (ahead > 300) vt = Math.min(vt, vmaxEngine * Math.max(0.7, 1 - (ahead - 300) / 3000));
    }
    for (let s = rear; s < front + 900; s += 10) {
      let lim = Math.min(R.curveSpeedAt(s) * 0.97, vmaxEngine);
      lim = Math.min(lim, this._stationLimit(s));
      if (s <= front) vt = Math.min(vt, lim);
      else vt = Math.min(vt, Math.sqrt(lim * lim + 2 * b * (s - front)));
    }
    // the signals: stop before a main signal at Halt (warned by its distant signal)
    const auth = this.sim.signals?.authority(front) ?? Infinity;
    if (auth < Infinity) vt = Math.min(vt, Math.sqrt(2 * 0.35 * Math.max(0, auth - 30)));
    return vt;
  }

  /** Turnouts at the two terminal stations: 40 km/h on the diverging routes. */
  _stationLimit(s) {
    const R = this.sim.route;
    for (const st of [R.origin, R.terminus]) if (Math.abs(s - st.s) < 520) return kmh(40);
    return 1e9;
  }

  _driverThink() {
    const T = this.sim.train, L = this.loco, B = T.brake, c = L.c;
    const v = T.speed, t = T.time;
    const stop = this._stopTarget();
    if (L.failed && this.phase !== 'failed') {
      this.phase = 'failed';
      this.log(`Driver: the ${L.failed} has gone — fire out, she is finished. Calling for rescue.`);
      this.sim.requestAssistance?.(true);
    }
    if (['starting', 'run', 'approach', 'drawup'].includes(this.phase) && !this.sim.assist) {
      // judge the progress over the last five minutes, the sand and the water left
      this._prog ??= [];
      if (!this._prog.length || t - this._prog[this._prog.length - 1][0] >= 30) this._prog.push([t, T.front]);
      while (this._prog.length > 11) this._prog.shift();
      const span = this._prog.length > 10 ? T.front - this._prog[0][1] : 1e9;
      const recentSlips = (this._slipTimes ?? []).filter((x) => t - x < 180).length;
      const atMark = stop && Math.abs(stop.sFront - T.front) < 20;
      const why = span < 200 && !atMark ? 'she is barely moving' : (L.sand < 15 && recentSlips >= 3) ? 'the sand is gone and she will not hold the rail'
        : L.tenderWater < 2500 ? 'the tender is nearly dry' : null;
      if (why) {
        this.phase = 'stalled'; this._prog = [];
        this.log(`Driver: ${why}. Stopping on the bank and calling the dispatcher for a banking engine.`);
        this.sim.requestAssistance?.();
      }
    }
    if (v < -0.3 && !this._rollback) {
      // she is running back: shut off and brake at once, whatever else was going on
      this._rollback = true;
      this.log('Driver: running back — brakes!');
      for (const h of Object.values(this.driver.hands)) h.queue.length = 0;
      this.work(this.driver, 'trainBrake', { to: 1 });
      this.work(this.driver, 'directBrake', { to: 1, rate: 3 });
    } else if (v > -0.05 && this._rollback && Math.abs(v) < 0.05) { this._rollback = false; }
    switch (this.phase) {
      case 'prep': {
        // engine standing: direct brake on, gear in the middle, cocks open, train pipe charged
        if (B.direct < 0.6 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0.8, rate: 2 });
        if (B.handle !== 'running' && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 'running' });
        if (this.sim.departureDue?.() && this.sim.readyToStart?.()) { this.next++; this.phase = 'starting'; this._t0 = t; this.log('Driver: right away.'); }
        else if (this.sim.departureSoon?.() && Math.abs(c.reverser - 0.75) > 0.02 && !this.busy(this.driver, 'reverser')) {
          this.work(this.driver, 'reverser', { to: 0.75, rate: 0.06 });   // wound into full fore gear, a turn a second
        }
        break;
      }
      case 'starting': {
        const dtS = t - this._t0;
        const here = this.sim.weather.at(T.front, t);
        const poorRail = ['frost', 'wet', 'slush', 'snow', 'ice', 'damp'].includes(here.rail);
        const steep = this.sim.route.run.gradeAt(T.front) > 0.012;
        // a hill start: whistle; sand first on a bad rail; steam on against the engine brake; let the brake off as she takes the load
        if (dtS < 0.3) { this.whistle(1.6, 'departure'); this._noStartingValve = false; this.regLimit = 1; }
        if (c.reverser < 0.7 && !this._slipping && !this.busy(this.driver, 'reverser')) this.work(this.driver, 'reverser', { to: 0.75, rate: 0.06 });
        if ((poorRail || steep) && !c.sander && dtS > 0.5 && L.sand > 0 && !this.busy(this.driver, 'sander')) { this.work(this.driver, 'sander', { to: 1 }); this.sandUntil = t + 40; }
        const want = Math.min(this.regLimit ?? 1, v < 0.3 ? 0.3 : v < 2 ? 0.45 : 0.7);
        if (dtS > 2.0 && !this._slipping && c.regulator < want - 0.04 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: want, rate: 0.12, pref: 'R' });
        // release once the cylinders are pulling (the regulator open and steam in the chest)
        if (c.regulator > 0.2 && L.pChest > 6 && B.direct > 0 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0, rate: 1.2 });
        // she will not move on the HP cylinders alone: the starting valve gives the LP side live steam
        if (dtS > 7 && v < 0.15 && !c.startingValve && !this._noStartingValve && !this._slipping && c.regulator > 0.25 && B.direct < 0.05 && !this.busy(this.driver, 'startingValve')) this.work(this.driver, 'startingValve', { to: 1 });
        if ((v > kmh(8) || this._slipping) && c.startingValve && !this.busy(this.driver, 'startingValve')) this.work(this.driver, 'startingValve', { to: 0 });
        // cylinder cocks shut after a few turns of the wheels, when the steam runs dry
        if (T.odometer - (this._odo0 ??= T.odometer) > 25 && c.drainCocks && !this.busy(this.driver, 'drainCocks')) this.work(this.driver, 'drainCocks', { to: 0 });
        this._handleSlip();
        if (v > kmh(12)) { this.phase = 'run'; this._odo0 = undefined; }
        break;
      }
      case 'failed': {
        if (c.regulator > 0 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: 0, rate: 0.6 });
        if (B.direct < 0.7 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 1, rate: 1.5 });
        if (B.handle !== 'service' && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 1 });
        break;
      }
      case 'stalled': {
        // brakes on, steam off, cocks open; the fire kept quiet and the water up while we wait
        if (c.regulator > 0 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: 0, rate: 0.6 });
        if (B.direct < 0.7 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0.9, rate: 1.5 });
        if (v > 0.05 && B.handle !== 'service' && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 0.6 });
        if (v <= 0.05 && B.handle === 'service' && this.sim.assist?.state === 'coupled' && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 'running' });
        if (c.sander && !this.busy(this.driver, 'sander')) this.work(this.driver, 'sander', { to: 0 });
        if (this.sim.assist?.state === 'coupled' && t - this.sim.assist.coupledAt > 60) {
          this.phase = 'starting'; this._t0 = t; this._odo0 = undefined; this._stallStart = null; this.log('Driver: right away, with the banker.');
        }
        break;
      }
      case 'signal': {
        // standing at a signal at Halt: steam off, the engine brake holding her on the bank
        if (c.regulator > 0 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: 0, rate: 0.6 });
        if (B.direct < 0.7 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0.85, rate: 1.5 });
        if (B.handle !== 'running' && v < 0.05 && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 'running' });
        const auth = this.sim.signals?.authority(T.front) ?? Infinity;
        if (auth > 120) { this.phase = 'starting'; this._t0 = t; this._odo0 = undefined; this._slipping = false; this.log('Driver: the signal is off - away.'); }
        break;
      }
      case 'run': {
        if (v < 0.3 && (this.sim.signals?.authority(T.front) ?? Infinity) < 90) { this.phase = 'signal'; this.log('Driver: stopped at a signal at danger.'); break; }
        this._handleSlip();
        // (if she was quick off the mark, the cylinder cocks are still open: shut them now)
        if (c.drainCocks && !this.busy(this.driver, 'drainCocks')) this.work(this.driver, 'drainCocks', { to: 0 });
        const vt = this._speedPlan();
        this.targetSpeed = vt;
        // stopping: shut off when the gradient and a light brake can stop her at the mark
        if (stop) {
          const d = stop.sFront - T.front;
          const g = this.sim.route.run.gradeAt(T.front);
          const aCoast = 9.81 * (g + 0.0025);         // what gravity and resistance take with steam off
          if (d < 1600 && v * v / (2 * Math.max(0.1, aCoast + 0.12)) > d - 30) { this.phase = 'approach'; this.log(`Driver: steam off for ${stop.name}.`); break; }
        }
        this._tunnelWhistles();
        if (!this._slipping) this._powerControl(v, vt);
        break;
      }
      case 'approach': {
        this._handleSlip();
        const d = stop.sFront - T.front;
        const R = this.sim.route.run;
        // the gradient under the whole train is what slows it
        let g = 0; for (let k = 0; k <= 4; k++) g += R.gradeAt(T.rear + (T.front - T.rear) * k / 4); g /= 5;
        const aNat = 9.81 * (g + 0.0025);
        const coast = v * v / (2 * Math.max(0.02, aNat));
        const drawUp = v > 0.2 && coast < d - 12;            // she will stop short: a little steam
        if (drawUp) {
          if (c.reverser < 0.55 && !this.busy(this.driver, 'reverser')) this.work(this.driver, 'reverser', { to: 0.6, rate: 0.06 });
          if (c.regulator < 0.25 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: 0.3, rate: 0.3, pref: 'R' });
          if (B.handle === 'service' && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 'running' });
        } else {
          if (c.regulator > 0 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: 0, rate: 0.5, pref: 'R' });
          if (c.reverser > 0.32 && v > kmh(5) && !this.busy(this.driver, 'reverser')) this.work(this.driver, 'reverser', { to: 0.3, rate: 0.06 });
          const need = v * v / (2 * Math.max(1.5, d - 1.5));
          const extra = need - aNat;
          if (!this.busy(this.driver, 'trainBrake')) {
            if (v < kmh(5) && d < 8) {
              // the last metres: train brake off so the cars do not lurch, the engine brake holds her
              if (B.handle !== 'running') this.work(this.driver, 'trainBrake', { to: 'running' });
              if (B.direct < 0.5 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0.7, rate: 1.0 });
            } else if (extra > 0.05) {
              const stage = Math.min(1, extra / 0.55);
              if (B.handle !== 'service' || Math.abs(B.serviceTarget - (5.0 - 0.4 - 1.1 * stage)) > 0.15) this.work(this.driver, 'trainBrake', { to: stage });
            } else if (extra < -0.04 && B.handle === 'service') {
              this.work(this.driver, 'trainBrake', { to: 'running' });
            }
          }
        }
        if (Math.abs(v) < 0.05) {
          if (Math.abs(d) < 15) {
            this.phase = 'stopped'; this.stoppedAt = t;
            this.log(`Driver: stopped at ${stop.name}, ${d >= 0 ? d.toFixed(1) + ' m short of' : (-d).toFixed(1) + ' m past'} the mark.`);
            this.sim.arrived?.(stop);
          } else if (d > 15) {
            // stopped short on the bank: a hill start to draw up
            this.phase = 'drawup'; this._t0 = t;
          }
        }
        break;
      }
      case 'drawup': {
        const d = stop.sFront - T.front;
        if (B.direct < 0.5 && c.regulator < 0.1 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0.8, rate: 1.5 });
        if (c.reverser < 0.55 && !this.busy(this.driver, 'reverser')) this.work(this.driver, 'reverser', { to: 0.6, rate: 0.06 });
        if (c.regulator < 0.3 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: 0.35, rate: 0.3, pref: 'R' });
        if (c.regulator > 0.25 && L.pChest > 6 && B.direct > 0 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0, rate: 1.2 });
        if (B.handle !== 'running' && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 'running' });
        if (v > kmh(4) || d < 30) this.phase = 'approach';
        break;
      }
      case 'stopped': {
        if (B.direct < 0.6 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0.8, rate: 1.5 });
        if (c.regulator > 0 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: 0, rate: 0.5 });
        if (!c.drainCocks && !this.busy(this.driver, 'drainCocks')) this.work(this.driver, 'drainCocks', { to: 1 });
        if (B.handle !== 'running' && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 'running' });
        if (this.next >= this.sim.timetable.stops.length - 1) { this.phase = 'arrived'; break; }
        if (this.sim.departureDue?.() && this.sim.readyToStart?.()) {
          this.next++; this.phase = 'starting'; this._t0 = t; this._odo0 = undefined; this._slipping = false;
          this.log('Driver: right away.');
        } else if (this.sim.departureSoon?.() && Math.abs(c.reverser - 0.75) > 0.02 && !this.busy(this.driver, 'reverser')) {
          this.work(this.driver, 'reverser', { to: 0.75, rate: 0.06 });
        }
        break;
      }
      case 'arrived': {
        if (c.regulator > 0 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: 0, rate: 0.5 });
        if (Math.abs(c.reverser) > 0.02 && !this.busy(this.driver, 'reverser')) this.work(this.driver, 'reverser', { to: 0, rate: 0.06 });
        if (B.direct < 0.6 && !this.busy(this.driver, 'directBrake')) this.work(this.driver, 'directBrake', { to: 0.8, rate: 1.5 });
        break;
      }
    }
  }

  /**
   * On the bank: regulator wide (as far as the rail allows), the power set on the reversing
   * screw, notched up as she gathers speed. Above the wanted speed, shorten the cut-off first,
   * then ease the regulator. Right hand on the regulator, left on the reversing screw.
   */
  _powerControl(v, vt) {
    const c = this.loco.c, L = this.loco, B = this.sim.train.brake;
    const err = vt - v;
    const vk = v * 3.6;
    const maxCut = vk < 12 ? 0.75 : vk < 20 ? 0.66 : vk < 30 ? 0.6 : vk < 40 ? 0.52 : vk < 50 ? 0.45 : 0.4;
    const minCut = 0.22;
    const pLow = L.p < L.spec.pSet - 2.6;           // steam falling back: give the fireman a chance
    if (B.handle === 'service' && err > -kmh(4) && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 'running' });
    const regTop = Math.min(1, this.regLimit ?? 1);
    let cutWant = c.reverser, regWant = c.regulator;
    if (err > kmh(1.5) && !pLow) {
      if (c.regulator < regTop - 0.02) regWant = Math.min(regTop, c.regulator + 0.2);
      else cutWant = Math.min(maxCut, c.reverser + 0.04);
    } else if (err < -kmh(1.5) || pLow) {
      if (c.reverser > minCut + 0.02) cutWant = Math.max(minCut, c.reverser - 0.04);
      else regWant = Math.max(0, c.regulator - 0.2);
      if (err < -kmh(6) && !this.busy(this.driver, 'trainBrake')) this.work(this.driver, 'trainBrake', { to: 0.1 });
    }
    cutWant = Math.min(cutWant, maxCut);
    if (Math.abs(cutWant - c.reverser) > 0.015 && !this.busy(this.driver, 'reverser')) this.work(this.driver, 'reverser', { to: cutWant, rate: 0.06, pref: 'L' });
    if (Math.abs(regWant - c.regulator) > 0.02 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: regWant, rate: 0.2, pref: 'R' });
  }

  /**
   * Wheelslip: the beat races and the engine shakes. Shut off at once, sand, wait for the
   * wheels to bite, then open up again gently and not as far as before; at a crawl, ease
   * the reversing screw back too (less torque per turn).
   */
  _handleSlip() {
    const L = this.loco, c = L.c, t = this.sim.train.time, v = this.sim.train.speed;
    const slip = L.out.slip;
    this.regLimit ??= 1;
    if (slip > 0.6) {
      if (this.slipSince < 0) this.slipSince = t;
      if (t - this.slipSince > this.driver.reaction && !this._slipping) {
        this._slipping = true;
        this.slips = (this.slips ?? 0) + 1;
        (this._slipTimes ??= []).push(t); if (this._slipTimes.length > 20) this._slipTimes.shift();
        this.log('Driver: she\'s slipping!');
        this.regLimit = Math.max(0.22, Math.min(this.regLimit, c.regulator) * 0.8);
        // a reflex: the right hand drops whatever it was doing and shuts the regulator
        const rh = this.driver.hands.R;
        rh.queue.length = 0; rh.on = null;
        for (const h of Object.values(this.driver.hands)) h.queue = h.queue.filter((j) => j.control !== 'regulator');
        this.work(this.driver, 'regulator', { to: 0.03, rate: 2.5, pref: 'R', queue: true });
        if (!c.sander && L.sand > 0 && !this.busy(this.driver, 'sander')) this.work(this.driver, 'sander', { to: 1 });
        if (v < kmh(6) && c.reverser > 0.6 && !this.busy(this.driver, 'reverser')) this.work(this.driver, 'reverser', { to: Math.max(0.6, c.reverser - 0.08), rate: 0.1 });
        if (c.startingValve && !this.busy(this.driver, 'startingValve')) { this.work(this.driver, 'startingValve', { to: 0 }); this._noStartingValve = true; }
        this.sandUntil = t + 25;
      }
    } else {
      this.slipSince = -1;
      if (this._slipping && slip < 0.1) {
        this._gripSince ??= t;
        if (t - this._gripSince > 1.0) { this._slipping = false; this._gripSince = null; this._regainAt = t + 1.2; }
      } else this._gripSince = null;
    }
    if (!this._slipping && this._regainAt && t > this._regainAt) {
      const lim = this.phase === 'starting' ? this.regLimit : Math.min(1, this.regLimit + 0.1);
      if (c.regulator < lim - 0.03 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: lim, rate: 0.05, pref: 'R' });
      else if (c.regulator >= lim - 0.03) this._regainAt = 0;
    }
    // the first shudder of a slip at speed (the beat quickening against the speed): ease off a touch before she lets go
    if (!this._slipping && v > kmh(10) && slip > 0.3 && slip <= 0.6 && c.regulator > 0.35 && !this.busy(this.driver, 'regulator')) {
      this.work(this.driver, 'regulator', { to: c.regulator - 0.06, rate: 0.4, pref: 'R' });
      this.regLimit = Math.max(0.35, Math.min(this.regLimit, c.regulator - 0.03));
    }
    // as she gathers speed the rail asks less of the wheels: trust it again, slowly
    if (!this._slipping && v > kmh(8)) this.regLimit = Math.min(1, this.regLimit + 0.0025);
    // keep the regulator within what the rail has shown it will take
    if (!this._slipping && c.regulator > this.regLimit + 0.05 && !this.busy(this.driver, 'regulator')) this.work(this.driver, 'regulator', { to: this.regLimit, rate: 0.3, pref: 'R' });
    // on a bad rail on the bank the sanders stay on while she is working (the crew know the line)
    const here = this.sim.weather.at(this.sim.train.front, t);
    // (hoar frost on the railhead counts: on a December morning in the shade of the valley it grips like a wet rail)
    const badRail = ['snow', 'ice', 'slush', 'wet', 'frost', 'damp'].includes(here.rail);
    const working = c.regulator > 0.3 && this.sim.route.run.gradeAt(this.sim.train.front) > 0.008;
    if (badRail && working && L.sand > 5) this.sandUntil = Math.max(this.sandUntil, t + 6);
    if (!c.sander && L.sand > 5 && t < this.sandUntil && !this.busy(this.driver, 'sander')) this.work(this.driver, 'sander', { to: 1 });
    if (c.sander && t > this.sandUntil && !this._slipping && !this.busy(this.driver, 'sander')) this.work(this.driver, 'sander', { to: 0 });
  }

  _handleSlipAndBrake() { this._handleSlip(); }

  /** Whistle boards before tunnels and stations. */
  _tunnelWhistles() {
    const T = this.sim.train, R = this.sim.route;
    for (const tun of R.tunnels) {
      const d = tun.s0 - T.front;
      if (d > 0 && d < 260 && !this._tunnelWarned.has(tun.s0) && tun.s1 - tun.s0 > 80) { this._tunnelWarned.add(tun.s0); this.whistle(1.0, 'tunnel'); }
    }
    for (const st of R.stations) {
      const d = st.s - T.front;
      if (d > 300 && d < 600 && !this._stationWarned.has(st.name)) { this._stationWarned.add(st.name); this.whistle(1.4, 'station'); }
    }
  }

  // ---------------------------------------------------------------------------
  // The fireman

  _firemanThink() {
    const L = this.loco, c = L.c, T = this.sim.train, t = T.time;
    const F = this.fireman;
    const working = c.regulator > 0.3;
    const standing = Math.abs(T.speed) < 0.1;
    // ---- the fire: target bed by what is coming
    const departingSoon = this.sim.departureSoon?.() ?? false;
    // no fresh coal in the last mile before a stop (she would only blow off standing), unless steam is short
    const stop = this._stopTarget();
    const nearStop = stop && this.phase === 'run' && stop.sFront - T.front < 1500;
    const steamShort = L.p < L.spec.pSet - 2;
    const target = nearStop && !steamShort ? 150 : working ? 340 : departingSoon ? 300 : 190;
    const bed = L.fire.burning + L.fire.green;
    if (this.firing === 0 && bed < target - 25 && t - this.lastShovel > 6) this.firing = Math.min(8, Math.ceil((target - bed) / 6));
    if (this.firing > 0 && F.hands.R.free && F.hands.L.free && t - this.lastShovel > 3.2) {
      // door open, a shovelful from the tender plate swung in, door shut
      this.lastShovel = t;
      this.firing--;
      this.work(F, 'firedoor', { to: 1, pref: 'L', queue: true });
      this.work(F, 'shovelPlate', { fn: () => { L.fireShovel(6); }, pref: 'R', after: 0.2, queue: true });
      this.work(F, 'firedoor', { to: 0, pref: 'L', after: 2.4, queue: true });
    }
    // ---- water: keep it in the glass. He reads the glass and knows what the bank, the pull and
    // the boiling do to it: the true level is what the boiler holds.
    const R = this.sim.route.run;
    const g = R.gradeAt(T.front), acc = this.sim.train.veh[0].a;
    const swellGuess = 25 * Math.min(1, L.out.steamRate / 2.6);
    const level = L.out.level - 3500 * (g + (acc || 0) / 9.81) * 0.9 - swellGuess;
    // The glass's lowest mark is 100 mm over the highest point of the firebox crown (the rule for
    // locomotive boilers); he keeps well above it, and fills her up before a stop: the brakes throw
    // the water forward off the crown sheet, and a full boiler standing does not blow off.
    const hard = L.out.steamRate > 1.8;
    const stopping = (nearStop || this.phase === 'approach' || this.phase === 'drawup') && !steamShort;
    const low = stopping ? 215 : hard ? 175 : 155, high = stopping ? 255 : hard ? 235 : 215;
    const injOn = (k) => L.c.injector[k] === true || L.c.injector[k] > 0;
    // steam to spare (she is about to lift her valves): water in now rather than steam out of the valves
    const lifting = !standing && L.p > L.spec.pSet - 0.15 && level < high + 25;
    if (!injOn(0) && (level < low || lifting) && !this.busy(F, 'injectorL')) this.work(F, 'injectorL', { to: 1, pref: 'L' });
    if (injOn(0) && level > (lifting ? high + 25 : high) && !this.busy(F, 'injectorL')) this.work(F, 'injectorL', { to: 0, pref: 'L' });
    if (injOn(0) && !lifting && level > low + 15 && L.p < L.spec.pSet - 1.2 && hard && !this.busy(F, 'injectorL')) this.work(F, 'injectorL', { to: 0, pref: 'L' });
    // falling behind: the driver puts on the second injector
    if (!injOn(1) && level < low - 50 && !this.busy(this.driver, 'injectorR') && this.driver.hands.R.free) this.work(this.driver, 'injectorR', { to: 1, pref: 'R' });
    if (injOn(1) && level > low + 20 && !this.busy(this.driver, 'injectorR')) this.work(this.driver, 'injectorR', { to: 0, pref: 'R' });
    // standing with a hot fire: the injector also stops her blowing off
    if (standing && L.p > L.spec.pSet - 0.25 && !injOn(0) && level < 240 && !this.busy(F, 'injectorL')) this.work(F, 'injectorL', { to: 1, pref: 'L' });
    // ---- blower: on whenever the regulator is shut (no blast to draw the fire, and no blowback)
    const wantBlower = c.regulator < 0.2 ? (L.p < L.spec.pSet - 1 ? 0.5 : standing && L.p > L.spec.pSet - 0.4 ? 0.08 : 0.25) : 0;
    if (Math.abs(c.blower - wantBlower) > 0.08 && !this.busy(F, 'blower')) this.work(F, 'blower', { to: wantBlower, rate: 1 });
    // ---- dampers: wide when working, nearly shut at stops if the steam is up (keeps her from blowing off)
    const wantDamp = standing && L.p > L.spec.pSet - 0.8 ? (L.p > L.spec.pSet - 0.35 ? 0.1 : 0.35) : 1;
    if (Math.abs(c.dampers - wantDamp) > 0.1 && !this.busy(F, 'dampers')) this.work(F, 'dampers', { to: wantDamp, rate: 1 });
    // ---- train heating: on in the cold
    const wantHeat = this.sim.weather.at(T.front, t).tempC < 12 ? 0.8 : 0;
    if (Math.abs(c.steamHeat - wantHeat) > 0.1 && !this.busy(this.driver, 'steamHeat') && this.driver.hands.R.free) this.work(this.driver, 'steamHeat', { to: wantHeat, rate: 0.5 });
  }

  /** Hand positions for drawing the crew (cab frame). */
  pose() {
    return this.people.map((p) => ({ role: p.role, L: p.hands.L.pos, R: p.hands.R.pos, onL: p.hands.L.on, onR: p.hands.R.on, look: p.look }));
  }
}
