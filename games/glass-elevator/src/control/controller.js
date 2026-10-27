/**
 * The controller: what a modern microprocessor elevator controller does, step by step.
 *
 *  - The safety chain: every safety switch in series (stop switches in the machine room, the pit
 *    and on the car roof, the governor, the buffers, the final limits, the safety gear, the
 *    compensation sheave, the car door contact and the thirty landing door locks). Open any of
 *    them and the main contactors and the brakes lose their supply, wherever the car is.
 *  - Starting: doors closed and locked, the chain made, the contactors in, the motor magnetised,
 *    the pre-torque from the load weighing, the brakes lifted (and seen to lift), then the run.
 *    Stopping: zero speed held on the motor, the brakes dropped, the torque taken off.
 *  - Selective collective operation: car calls and hall calls (up and down) answered in the
 *    order the car passes them, reversing at the last call; full load (80 %) passes hall calls;
 *    overload (110 %) keeps the doors open and sounds the buzzer.
 *  - Doors: pre-opening in the last few centimetres of the approach (door-bridging circuit),
 *    dwell times, reopening on the light curtain, the door-open button, a stall or a call;
 *    nudging (slow, with a buzzer) after 20 s of being held.
 *  - Re-levelling with the doors open at 0.1 m/s when loading stretches the ropes by over 10 mm.
 *  - Unintended car movement: the car leaving the door zone with its door open drops the brakes
 *    and locks the elevator out until someone resets it.
 *  - Inspection from the car roof, emergency electrical operation from the machine room (both at
 *    0.3 m/s, hold-to-run), firefighters' service (Phase I recall and Phase II in the car),
 *    independent service, parking at the lobby, and the automatic rescue device that brings the
 *    car to a floor on its battery when the mains fail.
 */
import { SPEC, FLOORS, floorY, nearestFloor, LIMITS } from '../data/spec.js';
import { Drive } from '../physics/drive.js';
import { TS_Y0 } from '../physics/hoist.js';

const Z = SPEC.zones;

export class Controller {
  constructor(sim) {
    this.sim = sim;
    const h = sim.hoist;
    this.calls = { car: new Array(FLOORS + 2).fill(false), up: new Array(FLOORS + 2).fill(false), down: new Array(FLOORS + 2).fill(false) };
    this.lastPress = new Array(FLOORS + 2).fill(-9);
    this.dir = 0;
    this.phase = 'idle';           // idle | start | run | stop | estop
    this.t = 0;
    this.floor = nearestFloor(h.yc);
    this.target = this.floor;
    this.door = 'closed';          // closed | opening | open | closing
    this.dwell = 0; this.held = 0; this.nudging = false;
    this.lantern = { floor: 0, dir: 0, t: 0 };
    this.inputs = {
      mains: true, mainSwitch: true, mrStop: false, pitStop: false, carTopStop: false, ard: true,
      open: false, close: false, alarm: false, cancel: false,
      insp: false, inspUp: false, inspDown: false, inspCommon: false,
      eeo: false, eeoUp: false, eeoDown: false, eeoRun: false,
      fire1: 'off', fire2: 'off', independent: false, parking: true,
    };
    this.faults = { ucm: false, brake: false };
    this.fire = { latched: false, recalled: false };
    this.loadKg = 0;
    this.time = 0; this.idleT = 0; this.alarmT = 0; this.stillT = 0;
    this.bridge = false;
    this.ard = { t: 0, state: 'off' };
    this.overload = false; this.fullLoad = false;
    this.display = { text: String(this.floor), dir: 0, msg: '' };
    this.chainList = [];
  }

  say(text) { this.sim.say(text, 'Controller'); }
  sfx(name, opts) { this.sim.sfx(name, opts); }
  get h() { return this.sim.hoist; }
  get d() { return this.sim.doors; }
  get dr() { return this.sim.drive; }
  get powered() { return this.inputs.mains && this.inputs.mainSwitch; }

  // ---------------------------------------------------------------------------------------------
  // Buttons and switches

  pressCar(n) {
    const c = this.calls, m = this.mode;
    if (!this.powered || m === 'fire1' || m === 'inspection' || m === 'eeo' || this.faulted) return;
    if (m === 'fire2' && this.inputs.fire2 !== 'on') return;
    if (c.car[n] && this.time - this.lastPress[n] < 0.6) { c.car[n] = false; this.say(`Car call ${n} cancelled.`); this.sfx('beep2'); return; }
    this.lastPress[n] = this.time;
    if (this._atFloor() === n && this.phase === 'idle') { if (m !== 'fire2' && this.door !== 'open') this._reopen(); this.sfx('beep'); return; }
    if (!c.car[n]) { c.car[n] = true; this.sfx('beep'); }
  }

  pressHall(n, dir) {
    if (!this.powered || this.mode !== 'normal' && this.mode !== 'independent') return;
    if (this.mode === 'independent') { (dir > 0 ? this.calls.up : this.calls.down)[n] = true; return; }
    const here = this._atFloor() === n && this.phase === 'idle';
    if (here && (this.dir === dir || this.dir === 0) && this.door !== 'closed') { this.dir = dir; this._reopen(); this._lantern(n, dir); return; }
    if (here && this.door === 'closed' && !this._anyCalls(1, FLOORS)) { this.dir = dir; this._arrive(n, dir); return; }
    (dir > 0 ? this.calls.up : this.calls.down)[n] = true;
    this.sfx('beep', { floor: n });
  }

  // ---------------------------------------------------------------------------------------------

  get mode() {
    const I = this.inputs;
    if (!I.mainSwitch) return 'off';
    if (!I.mains) return this.ard.state === 'run' || this.ard.state === 'open' ? 'ard' : 'power';
    if (I.insp) return 'inspection';
    if (I.eeo) return 'eeo';
    if (this.fire.recalled && I.fire2 !== 'off') return 'fire2';
    if (this.fire.latched) return 'fire1';
    if (I.independent) return 'independent';
    return 'normal';
  }
  get faulted() { return this.faults.ucm || this.h.sg.set || this.h.gov.tripped; }

  _chain() {
    const h = this.h, d = this.d, I = this.inputs, eeo = I.eeo && !I.insp;
    const zone = Math.abs(h.yc - floorY(nearestFloor(h.yc))) < Z.door;
    const bridge = this.bridge && zone && Math.abs(h.vc) < 0.8;
    return [
      ['main', 'Main switch', I.mainSwitch],
      ['mrStop', 'Machine room stop switch', !I.mrStop],
      ['pitStop', 'Pit stop switch', !I.pitStop],
      ['carTopStop', 'Car roof stop switch', !I.carTopStop],
      ['gov', 'Governor overspeed switch', !h.gov.switchOpen || eeo],
      ['comp', 'Compensation sheave switch', Math.abs(h.ts - TS_Y0) < 0.2],
      ['bufCar', 'Car buffer switch', h.buf.car < 0.02 || eeo],
      ['bufCw', 'Counterweight buffer switch', h.buf.cw < 0.02 || eeo],
      ['finalTop', 'Final limit, top', h.yc < LIMITS.top || eeo],
      ['finalBottom', 'Final limit, bottom', h.yc > LIMITS.bottom || eeo],
      ['sg', 'Safety gear switch', !h.sg.set || eeo],
      ['ucm', 'Unintended movement monitor', !this.faults.ucm],
      ['hatch', 'Car roof trap door contact', (d.hatch ?? 0) < 0.05],
      ['carDoor', 'Car door contact', d.carClosed || bridge],
      ['locks', 'Landing door locks (30)', d.allLocked || bridge],
    ];
  }

  step(dt) {
    const h = this.h, d = this.d, dr = this.dr, I = this.inputs;
    this.time += dt;
    // load weighing: the hitch load cells, read while the car stands
    if (Math.abs(h.vc) < 0.02 && this.phase !== 'run') this.loadKg += (h.measuredLoad() - this.loadKg) * Math.min(1, dt / 0.35);
    const ol = this.loadKg > SPEC.ratedLoad * SPEC.overload;
    if (ol !== this.overload) { this.overload = ol; if (ol) this.say(`Overload: ${Math.round(this.loadKg)} kg in a ${SPEC.ratedLoad} kg car. The doors stay open.`); }
    this.fullLoad = this.loadKg > SPEC.ratedLoad * SPEC.fullLoad;
    this.chainList = this._chain();
    const open = this.chainList.find((c) => !c[2]);
    this.chainOK = !open;
    this.chainCore = this.chainList.every((c) => c[2] || c[0] === 'carDoor' || c[0] === 'locks');
    if (I.fire1 === 'on') this.fire.latched = true;
    if (I.fire1 === 'reset' && I.fire2 === 'off' && this.fire.latched) { this.fire.latched = false; this.fire.recalled = false; this.say('Fire service reset.'); }
    const mode = this.mode;
    if (mode !== this._mode) this._modeChange(this._mode, mode);
    this._mode = mode;
    // ---- unintended car movement: away from the door zone with the car door open --------------
    const zoneErr = h.yc - floorY(nearestFloor(h.yc));
    if (!this.faults.ucm && !d.carClosed && Math.abs(zoneErr) > Z.door) {
      this.faults.ucm = true;
      this.say(`Unintended car movement: the car left the door zone with its door open (${(zoneErr * 1000).toFixed(0)} mm). Brakes dropped, elevator locked out.`);
    }
    // ---- the safety chain and the supply while moving ------------------------------------------
    const moving = this.phase === 'start' || this.phase === 'run' || this.phase === 'stop';
    const supplied = this.powered || mode === 'ard';
    if (moving && (!this.chainOK || !supplied)) this._estop(!supplied ? 'mains supply lost' : `${open[1]} opened`);
    // ---- the motion phases --------------------------------------------------------------------
    this.t += dt;
    if (this.phase === 'start') this._starting();
    else if (this.phase === 'run') this._running(dt);
    else if (this.phase === 'stop') this._stopping();
    else if (this.phase === 'estop') {
      if (Math.abs(h.vc) < 0.005 && this.t > 0.4) { this.phase = 'idle'; this.say(`Stopped ${this._where()}.`); }
    }
    dr.step(dt, this.loadKg);
    // ---- what the mode does with the car at rest -----------------------------------------------
    if (this.phase === 'idle') {
      if (Math.abs(h.vc) < 0.003) this.stillT += dt; else this.stillT = 0;
      if (mode === 'normal' || mode === 'independent' || mode === 'fire1' || mode === 'fire2') this._service(dt, mode);
      else if (mode === 'inspection' || mode === 'eeo') this._jogControl(mode);
      else if (mode === 'power' || mode === 'ard') this._powerFail(dt);
    } else if ((mode === 'inspection' || mode === 'eeo') && this.pending?.kind === 'jog') this._jogControl(mode);
    // ---- doors --------------------------------------------------------------------------------
    this._doors(dt, mode);
    // ---- indicators ---------------------------------------------------------------------------
    if (this.lantern.t > 0) this.lantern.t -= dt;
    const f = nearestFloor(h.yc);
    if (f !== this.floor) { this.floor = f; }
    this._display(mode);
    // the alarm button, held a second
    if (I.alarm) { this.alarmT += dt; if (this.alarmT > 1 && !this._alarmed) { this._alarmed = true; this.say('Alarm: connected to the service centre (two-way voice, battery backed). Help is on its way.'); this.sfx('alarm'); } } else { this.alarmT = 0; this._alarmed = false; }
  }

  _modeChange(from, to) {
    if (from === undefined) return;
    const names = { normal: 'automatic operation', inspection: 'INSPECTION from the car roof', eeo: 'EMERGENCY ELECTRICAL OPERATION from the machine room', fire1: 'FIREFIGHTERS\' SERVICE Phase I: recall to the lobby', fire2: 'FIREFIGHTERS\' SERVICE Phase II: in-car operation', independent: 'INDEPENDENT SERVICE', power: 'mains supply lost: brakes set, emergency lighting', ard: 'AUTOMATIC RESCUE on the battery', off: 'main switch OFF' };
    this.say(`Mode: ${names[to] ?? to}.`);
    if (to !== 'normal' && to !== 'independent') this._cancelAll(to !== 'fire2');
    if (to === 'fire1' && from !== 'fire2') this.fire.recalled = false;
    if (to === 'normal' && (from === 'power' || from === 'ard' || from === 'off')) this.ard.state = 'off';
  }

  _cancelAll(hall = true) {
    const c = this.calls;
    for (let n = 1; n <= FLOORS; n++) { c.car[n] = false; if (hall) { c.up[n] = false; c.down[n] = false; } }
  }

  /** The floor the car stands level at (within the door zone), or 0. */
  _atFloor() { const n = nearestFloor(this.h.yc); return Math.abs(this.h.yc - floorY(n)) < Z.door ? n : 0; }
  _where() { const n = nearestFloor(this.h.yc), e = this.h.yc - floorY(n); return Math.abs(e) < 0.02 ? `at floor ${n}` : `${Math.abs(e).toFixed(2)} m ${e > 0 ? 'above' : 'below'} floor ${n}`; }

  _anyCalls(a, b) {
    const c = this.calls;
    for (let n = Math.max(1, a); n <= Math.min(FLOORS, b); n++) if (c.car[n] || c.up[n] || c.down[n]) return true;
    return false;
  }

  // ---------------------------------------------------------------------------------------------
  // Starting, running and stopping

  /** Starts a trip to floor n (or, for kind 'jog', a hold-to-run move in dir). */
  _start(pending) {
    if (this.phase !== 'idle') return false;
    const h = this.h;
    this.pending = pending;
    this.phase = 'start'; this.t = 0;
    this.trip0 = { enc: h.enc, y: h.yc, k: 1 - h.Tc / SPEC.ropes.EA };
    h.motor.enabled = true;
    this.sfx('contactor');
    return true;
  }

  /**
   * Where the encoder must read for the car to stand level at floor n: the floors' heights, less
   * the change in rope stretch the trip will bring (the car's ropes get shorter going up, so they
   * stretch less and the car rides higher than the rope paid over the sheave says).
   */
  _encFor(n) { const t = this.trip0; return t.enc + (floorY(n) - t.y) * t.k; }

  _starting() {
    const h = this.h, dr = this.dr, P = this.pending;
    if (this.t >= 0.12 && dr.mode === 'off') {
      dr.torqueLimit = SPEC.machine.maxTorque;
      dr.hold(Drive.unbalance(h, this.loadKg));
    }
    if (this.t >= 0.25 && !h.brakes[0].cmd) { for (const b of h.brakes) b.cmd = true; this.sfx('brakeLift'); }
    if (h.brakes.every((b) => b.lift >= 1)) {
      this.phase = 'run'; this.t = 0;
      if (P.kind === 'jog') dr.jog(P.dir, P.vmax);
      else dr.run(P.enc ?? this._encFor(P.floor), P.vmax);
      this.target = P.floor ?? this.target;
    } else if (this.t > 0.9) {
      this.faults.brake = true; this._estop('the brakes did not lift (brake monitoring)');
    }
  }

  _running(dt) {
    const h = this.h, dr = this.dr, P = this.pending;
    if (P.kind !== 'jog') {
      // a nearer stop the car can still make
      if (P.kind === 'trip' && this.mode === 'fire1') {
        // Phase I: heading for the lobby nonstop, or stopping at the first floor it can still make and reversing
        const dirNow = Math.sign(this._encFor(this.target) - dr.s) || this.dir;
        if (dirNow < 0 && this.target !== 1) { this.target = 1; P.floor = 1; dr.retarget(this._encFor(1)); }
        else if (dirNow > 0) {
          const reach = dr.s + dr.stopping + 0.05;
          for (let n = 1; n <= FLOORS; n++) if (this._encFor(n) >= reach) { if (n < this.target) { this.target = n; P.floor = n; dr.retarget(this._encFor(n)); } break; }
        }
      } else if (P.kind === 'trip' && (this.mode === 'normal' || this.mode === 'independent' || this.mode === 'fire2')) {
        const dir = Math.sign(this._encFor(this.target) - dr.s) || this.dir;
        const reach = dr.s + dir * (dr.stopping + 0.05);
        for (let n = this.floor; n >= 1 && n <= FLOORS; n += dir) {
          if ((this._encFor(n) - reach) * dir < 0) continue;
          if ((this._encFor(n) - this._encFor(this.target)) * dir >= 0) break;
          if (this._shouldStop(n, dir)) { this.target = n; P.floor = n; dr.retarget(this._encFor(n)); break; }
        }
      }
      // in the last 15 cm the leveling sensor reads the car's true height against the floor's magnets
      const err = floorY(this.target) - h.yc;
      if (Math.abs(err) < 0.15) {
        const want = h.enc + err;
        dr.target += (want - dr.target) * Math.min(1, dt / 0.12);
        // pre-opening: the doors start to open as the car levels
        if (P.kind === 'trip' && this.mode === 'normal' && Math.abs(err) < Z.preopen && Math.abs(h.vc) < 0.3 && this.door === 'closed' && !this.overload) {
          this.bridge = true; this._open(); this._arrive(this.target, null, true);
        }
      }
    } else {
      const lim = this.mode === 'inspection' ? (h.yc > floorY(FLOORS) + 0.05 && P.dir > 0) || (h.yc < floorY(1) - 0.05 && P.dir < 0) : false;
      if (lim) dr.jogging = false;
    }
    if (dr.done) { this.phase = 'stop'; this.t = 0; }
  }

  _stopping() {
    const h = this.h, dr = this.dr, P = this.pending;
    if (this.t >= 0.25 && h.brakes[0].cmd) { for (const b of h.brakes) b.cmd = false; this.sfx('brakeDrop'); }
    if (this.t >= 0.5) {
      dr.off(); h.motor.enabled = false; this.phase = 'idle'; this.t = 0; this.sfx('contactorOff');
      this.bridge = false;
      if (P.kind === 'trip' && !this._arrived) this._arrive(P.floor);
      if (P.kind === 'relevel' || P.kind === 'ard') this.bridge = false;
      if (P.kind === 'ard') { this.ard.state = 'open'; this.door = 'opening'; this.say('Automatic rescue: the car is at a floor. Doors opening on the battery.'); }
      this._arrived = false;
      this.pending = null;
    }
  }

  _estop(why) {
    const h = this.h;
    if (this.phase === 'estop') return;
    this.phase = 'estop'; this.t = 0;
    h.motor.enabled = false; this.dr.off();
    for (const b of h.brakes) b.cmd = false;
    this.bridge = false;
    this.say(`Emergency stop at ${Math.abs(h.vc).toFixed(2)} m/s: ${why}.`);
    this.sfx('brakeDrop'); this.sfx('estop');
    this.pending = null; this._arrived = false;
  }

  // ---------------------------------------------------------------------------------------------
  // Service: dispatching, arrivals, re-levelling, parking, fire service

  _shouldStop(n, dir) {
    const c = this.calls, m = this.mode;
    if (c.car[n]) return true;
    if (m !== 'normal' || this.fullLoad) return false;
    if (dir > 0 ? c.up[n] : c.down[n]) return true;
    return false;
  }

  _service(dt, mode) {
    const h = this.h, d = this.d, c = this.calls;
    const here = this._atFloor();
    // re-levelling: loading or unloading has stretched the ropes by more than 10 mm
    if (mode === 'fire1') {
      if (here === 1 && Math.abs(h.yc) < 0.03) { if (!this.fire.recalled) { this.fire.recalled = true; this.say('Fire service: the car is at the lobby with its doors open, for the firefighters.'); } if (this.door === 'closed') this._open(); }
      else if (this.door === 'closed' && this.chainOK && !this.faulted && !this.overload) this._trip(1, 'fire');
      return;
    }
    if (here && this.stillT > 0.6 && Math.abs(h.yc - floorY(here)) > Z.relevel && this.chainCore && !this.faulted) {
      this.bridge = true;
      if (this._start({ kind: 'relevel', floor: here, enc: h.enc + floorY(here) - h.yc, vmax: SPEC.speeds.relevel })) { this.say(`Re-levelling ${((floorY(here) - h.yc) * 1000).toFixed(0)} mm with the doors open (rope stretch).`); }
      return;
    }
    if (this.door !== 'closed' || !this.chainOK || this.overload || this.faulted) { this.idleT = 0; return; }
    // the next stop in the direction of travel, reversing at the last call
    let dir = this.dir;
    const f = here || nearestFloor(h.yc);
    const above = this._anyCalls(f + 1, FLOORS), below = this._anyCalls(1, f - 1);
    const serveUp = c.up[f] && (dir >= 0 || !below), serveDown = c.down[f] && (dir <= 0 || !above);
    if (mode !== 'fire2' && here && (c.car[f] || (mode === 'normal' && (serveUp || serveDown)))) { this._arrive(f, serveUp ? 1 : serveDown ? -1 : dir); return; }
    if (mode === 'fire2' && c.car[f]) c.car[f] = false;
    if (dir > 0 && !above) dir = below ? -1 : 0;
    else if (dir < 0 && !below) dir = above ? 1 : 0;
    else if (dir === 0) dir = above ? 1 : below ? -1 : 0;
    this.dir = dir;
    if (!dir) {
      this.idleT += dt;
      if (mode === 'normal' && this.inputs.parking && this.idleT > 90 && f !== 1) { this.say('Parking: returning to the lobby.'); this._trip(1, 'park'); }
      return;
    }
    this.idleT = 0;
    // nearest stop in dir, else the furthest call (where the car reverses)
    let tgt = 0;
    for (let n = f + dir; n >= 1 && n <= FLOORS; n += dir) if (this._shouldStop(n, dir)) { tgt = n; break; }
    if (!tgt) for (let n = dir > 0 ? FLOORS : 1; n !== f; n -= dir) if (c.car[n] || c.up[n] || c.down[n]) { tgt = n; break; }
    if (tgt) this._trip(tgt, 'trip');
  }

  _trip(n, why) {
    if (!this.d.carClosed || !this.d.allLocked) return;
    this.dir = Math.sign(floorY(n) - this.h.yc);
    this.target = n;
    this._start({ kind: why === 'fire' || why === 'park' ? 'trip' : 'trip', floor: n, vmax: SPEC.ratedSpeed });
  }

  /** The car has arrived (or is about to, with the doors pre-opening) at floor n. */
  _arrive(n, dirHint = null, early = false) {
    const c = this.calls;
    if (this.mode === 'fire1' && n !== 1) { this._cancelAll(); return; }
    if (early) this._arrived = true;
    c.car[n] = false;
    let nd = this.dir;
    if (dirHint !== null && dirHint !== undefined) nd = dirHint;
    const above = this._anyCalls(n + 1, FLOORS), below = this._anyCalls(1, n - 1);
    if (nd > 0 && !above && !c.up[n]) nd = below || c.down[n] ? -1 : 0;
    else if (nd < 0 && !below && !c.down[n]) nd = above || c.up[n] ? 1 : 0;
    if (nd === 0) nd = c.up[n] ? 1 : c.down[n] ? -1 : 0;
    this.dir = nd;
    let hall = false;
    if (nd >= 0 && c.up[n]) { c.up[n] = false; hall = true; }
    if (nd <= 0 && c.down[n]) { c.down[n] = false; hall = true; }
    if (this.mode === 'fire2') { this._cancelAll(false); return; }      // Phase II: doors only on constant pressure
    this._lantern(n, nd);
    this.dwell = hall ? SPEC.doors.dwellHall : SPEC.doors.dwellCar;
    if (!early) this._open();
  }

  _lantern(n, dir) { this.lantern = { floor: n, dir, t: 6 }; this.sfx(dir < 0 ? 'gong2' : 'gong', { floor: n }); }

  // ---------------------------------------------------------------------------------------------
  // Doors

  _open() { if (this.door !== 'open') { this.door = 'opening'; this.sfx('doorMotor'); } }
  _close() { if (this.door !== 'closed') { this.door = 'closing'; this.sfx('doorMotor'); } }
  _reopen() { if (this.door === 'closing' || this.door === 'closed') { this._open(); } this.dwell = Math.max(this.dwell, SPEC.doors.dwellCar); }

  _doors(dt, mode) {
    const d = this.d, dc = d.car, I = this.inputs;
    const here = this._atFloor() && Math.abs(this.h.vc) < 0.31;
    dc.powered = (this.powered || mode === 'ard') && !I.brkDoor;
    const bridgeOK = this.bridge || this.phase === 'idle';
    // the door operator follows the door state
    if (this.door === 'opening' || this.door === 'open') dc.cmd = here && bridgeOK ? 'open' : 'close';
    else dc.cmd = 'close';
    dc.nudge = this.nudging;
    if (this.door === 'opening' && dc.x >= 0.999) { this.door = 'open'; if (this.dwell <= 0) this.dwell = SPEC.doors.dwellCar; }
    if (this.door === 'closing' && d.carClosed && d.allLocked) { this.door = 'closed'; this.nudging = false; this.held = 0; this.sfx('doorShut'); }
    if (this.door === 'closed' && !d.carClosed && this.phase === 'idle' && here) this.door = 'opening';
    if (mode === 'inspection' || mode === 'eeo' || mode === 'power' || mode === 'off') { if (this.door !== 'closed' && mode !== 'power' && mode !== 'off') this._close(); return; }
    if (mode === 'ard') { if (this.ard.state === 'open' && this.door === 'closed') this._open(); if (this.door === 'opening' && d.carOpen) this.door = 'open'; return; }
    const blocked = d.curtainBlocked && !d.curtainFail;
    if (mode === 'fire2') {
      // constant pressure: open while the button is held, reclose if let go early; the same for closing
      if (I.open && here) { if (this.door !== 'open') this.door = 'opening'; this._f2 = 'open'; }
      else if (I.close) { if (this.door !== 'closed') this.door = 'closing'; this._f2 = 'close'; }
      else if (this._f2 === 'open' && this.door === 'opening') this.door = 'closing';
      else if (this._f2 === 'close' && this.door === 'closing') this.door = 'opening';
      if (I.cancel) { this._cancelAll(false); }
      return;
    }
    if (mode === 'fire1') {
      if (this.fire.recalled && this._atFloor() === 1) { if (this.door === 'closed' || this.door === 'closing') this._open(); return; }
      if (this.door === 'open' || this.door === 'opening') { this.nudging = true; this._close(); }
      return;
    }
    if (this.door === 'open') {
      if (blocked) { this.dwell = Math.max(this.dwell, 1.5); this.held += dt; }
      if (I.open) this.dwell = Math.max(this.dwell, 2.0);
      if (this.overload) this.dwell = Math.max(this.dwell, 1.0);
      if (mode === 'independent') { if (I.close && this._anyCalls(1, FLOORS)) this._close(); return; }
      if (I.close && !I.open && !this.overload) this.dwell = Math.min(this.dwell, 0.2);
      this.dwell -= dt;
      if (this.held > SPEC.doors.nudgeAfter && !this.nudging) { this.nudging = true; this.say('Nudging: the doors close slowly, with the buzzer, ignoring the light curtain.'); }
      if (this.dwell <= 0 && (!blocked || this.nudging)) this._close();
    } else if (this.door === 'closing') {
      const reopen = (!this.nudging && blocked) || I.open || dc.stall > 0.25 || this.overload;
      if (reopen) {
        this.say(dc.stall > 0.25 ? 'Doors reopening: something in the doorway stopped them.' : blocked ? 'Doors reopening: the light curtain is interrupted.' : this.overload ? 'Doors reopening: overload.' : 'Doors reopening.');
        dc.stall = 0;
        this.held += 1.5;
        this._open(); this.dwell = 2.0;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Inspection and emergency electrical operation: hold to run

  _jogControl(mode) {
    const I = this.inputs;
    const dir = mode === 'inspection' ? (I.inspCommon ? (I.inspUp && !I.inspDown ? 1 : I.inspDown && !I.inspUp ? -1 : 0) : 0)
      : (I.eeoRun ? (I.eeoUp && !I.eeoDown ? 1 : I.eeoDown && !I.eeoUp ? -1 : 0) : 0);
    if (this.phase === 'idle') {
      if (dir && this.chainOK && this.powered) this._start({ kind: 'jog', dir, vmax: mode === 'inspection' ? SPEC.speeds.inspection : SPEC.speeds.eeo });
      else if (dir && !this._jogNo) {
        // say once per press why it will not run
        this._jogNo = true;
        const open = this.chainList.find((c) => !c[2]);
        this.say(`${mode === 'eeo' ? 'EEO' : 'Inspection'}: the car will not run: ${!this.powered ? 'no power (mains off)' : `the safety chain is open at the ${open[1].toLowerCase()}`}.`);
      }
      if (!dir) this._jogNo = false;
      return;
    }
    if (!dir || dir !== this.pending?.dir) {
      // let go: the drive brings the car to a stop at once, then the brakes drop
      if (this.phase === 'run') this.dr.jogging = false;
      else if (this.phase === 'start') { this.phase = 'stop'; this.t = 0.25; this.dr.off(); this.h.motor.enabled = false; for (const b of this.h.brakes) b.cmd = false; }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Mains failure and the automatic rescue device

  _powerFail(dt) {
    const h = this.h, A = this.ard, I = this.inputs;
    if (!I.ard || !I.mainSwitch || this.faulted || !this.chainCore) return;
    if (A.state === 'off') { A.state = 'wait'; A.t = 0; }
    A.t += dt;
    if (A.state === 'wait' && A.t > 8 && Math.abs(h.vc) < 0.01) {
      const here = this._atFloor();
      if (here && Math.abs(h.yc - floorY(here)) < 0.03) { A.state = 'open'; this.door = 'opening'; this.say('Automatic rescue: the car is level at a floor. Doors opening on the battery.'); return; }
      if (!this.d.carClosed || !this.d.allLocked) return;
      // the light direction: the way the unbalance pulls (the battery only has to hold it back)
      const un = Drive.unbalance(h, this.loadKg);
      const dir = un > 0 ? -1 : 1;
      let n = nearestFloor(h.yc);
      if ((floorY(n) - h.yc) * dir < 0) n += dir;
      n = Math.max(1, Math.min(FLOORS, n));
      A.state = 'run';
      this.say(`Automatic rescue on the battery: moving the car ${dir > 0 ? 'up' : 'down'} (the light direction) to floor ${n} at ${SPEC.speeds.ard} m/s.`);
      this._start({ kind: 'ard', floor: n, vmax: SPEC.speeds.ard });
    }
  }

  // ---------------------------------------------------------------------------------------------

  _display(mode) {
    const D = this.display;
    D.text = String(this.floor);
    D.dir = this.phase === 'run' || this.phase === 'start' ? Math.sign(this.h.vc) || this.dir : this.dir;
    D.msg = this.overload ? 'OVERLOAD' : mode === 'fire1' || mode === 'fire2' ? 'FIRE SERVICE' : mode === 'inspection' ? 'INSPECTION' : mode === 'eeo' ? 'EMERGENCY OP.' : mode === 'independent' ? 'INDEPENDENT' : this.faulted ? 'OUT OF SERVICE' : mode === 'power' || mode === 'ard' || mode === 'off' ? (mode === 'ard' ? 'RESCUE' : '') : this.nudging ? 'PLEASE CLEAR DOORS' : this.fullLoad ? 'FULL' : '';
  }

  /** Machine room panel: fault reset (after unintended movement, or a brake fault). */
  resetFaults() {
    if (Math.abs(this.h.vc) > 0.01) return;
    if (this.faults.ucm || this.faults.brake) this.say('Faults reset by the technician.');
    this.faults.ucm = false; this.faults.brake = false;
  }
}
