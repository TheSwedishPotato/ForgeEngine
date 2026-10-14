/**
 * The game: the car (its model and its physics), the world on the date the clock shows,
 * the time circuits, the driver's controls and the cameras, and the moment of displacement.
 *
 * The clock runs at the speed of life (or faster for testing); everything in the world
 * follows it: the sun and the moon, the town's lights, the courthouse clock. When the car
 * reaches 88 mph with the time circuits on, a destination set and 1.21 gigawatts at the
 * flux capacitor, it leaves this moment and arrives at the destination, at the same place
 * and speed; the world around it becomes the world of that date.
 */
import { TimeStage } from '../render/stage.js';
import { Car } from '../car/car.js';
import { Vehicle, MPH } from '../physics/vehicle.js';
import { TimeCircuits, TRIGGER_MPH } from '../time/timecircuits.js';
import { Timeline } from '../time/timeline.js';
import { World } from '../world/world.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { collide } from './collide.js';
import { localToUtc, utcToLocal } from '../astro.js';
import { START } from '../world/map.js';
import { TimeTravel } from '../time/travel.js';
import { Storm, STRIKE_UTC } from '../time/lightning.js';

export class Game {
  static async create(canvas, opts = {}) {
    const g = new Game(canvas, opts);
    await g.init(opts);
    return g;
  }

  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.stage = new TimeStage(canvas, { quality });
    this.timeline = new Timeline();
    this.world = new World(this.stage, this.timeline);
    this.timeScale = 1;
    this.paused = false;
    this.listeners = [];
  }

  async init({ start = { y: 1985, mo: 10, d: 26, h: 1, mi: 20 }, version = 'part1', place = START, destination = { y: 1955, mo: 11, d: 5, h: 6, mi: 0 }, empty = false, gearbox = 'auto' } = {}) {
    const st = this.stage;
    this.utc = localToUtc(start);
    this.car = new Car({ version });
    st.scene.add(this.car.root);
    for (const g of this.car.glassPanes) st.glass.add(g.mesh, g.opts);
    st.cabin = this.car.cabin;
    this.veh = new Vehicle();
    this.veh.reset({ x: place.x, z: place.z, heading: place.heading });
    this.tc = new TimeCircuits({ presentUtc: this.utc, destination, power: version === 'part2' ? 'fusion' : 'plutonium', charges: 2 });
    this.tc.lastDeparted = null;
    if (empty) { this.tc.charge = 0; this.tc.spare = 0; }
    this.veh.auto = gearbox !== 'manual';
    this.version = version;
    this.input = new Input(this.canvas);
    this.rig = new CameraRig(st.camera);
    this.headlights = 1;
    this.engine = { coolantF: 175, fuel: 0.72 };
    this.events = [];
    this.world.setTime(this.utc, utcToLocal(this.utc));
    this._sky();
    this.car.pose(this.veh, 0);
    this.travel = new TimeTravel(this);
    this.storm = new Storm(this);
    this.startOpts = { start, place, destination, empty, version };
  }

  /** The lightning run again: back to the end of Main Street, two minutes before the strike. */
  retryLightning() {
    const o = this.startOpts;
    this.utc = STRIKE_UTC - 150 * 1000;
    this.veh.reset({ x: o.place.x, z: o.place.z, heading: o.place.heading });
    this.storm.reset();
    this.tc.presentUtc = this.utc;
    this.world.setTime(this.utc, this.local);
    this._sky();
    this.emit({ type: 'retry' });
  }

  /** Seconds to the strike (on the storm night, before it), or null. */
  get toStrike() { const t = (STRIKE_UTC - this.utc) / 1000; return this.storm.active(this.local) && t > -2 ? t : null; }

  on(f) { this.listeners.push(f); }
  emit(e) { for (const f of this.listeners) f(e); }

  get local() { return utcToLocal(this.utc); }

  _sky() {
    const l = this.local;
    const air = this.world.air(l, this.utc);
    this.air = air;
    this.stage.setSky(this.utc, air);
  }

  /** One frame of dt seconds of real time. */
  frame(dt) {
    dt = Math.min(dt, 0.1);
    if (this.paused && !this.pausedPhysicsOnly) { if (!this.skipRender) this.stage.render(0); return; }
    const limbo = this.paused && this.pausedPhysicsOnly;      // the car is nowhere: the world waits
    const veh = this.veh, inp = this.input, car = this.car;
    // --- the driver -----------------------------------------------------------------------------
    inp.update(dt, veh.speed);
    const stopped = veh.speed < 0.8;
    // from a stop, holding the brake puts it in reverse; then the pedals swap
    if (veh.auto) {
      if (stopped && inp.brake > 0.5 && inp.throttle < 0.05) this._revHold = (this._revHold ?? 0) + dt; else this._revHold = 0;
      if (this._revHold > 0.45 && veh.gear !== 'R') veh.shift('R');
      if (veh.gear === 'R') {
        if (stopped && inp.throttle > 0.3) veh.shift(1);
        veh.input.throttle = inp.brake; veh.input.brake = inp.throttle;
      } else { veh.input.throttle = inp.throttle; veh.input.brake = inp.brake; }
    } else { veh.input.throttle = inp.throttle; veh.input.brake = inp.brake; }
    veh.input.steer = inp.steer;
    veh.input.handbrake = inp.handbrake;
    if (!veh.running && (inp.throttle > 0.2 || inp.held('KeyR'))) { veh.running = true; veh.stalled = false; veh.engineOmega = 90; this.emit({ type: 'start' }); }
    // --- the physics ----------------------------------------------------------------------------
    if (!limbo) {
      veh.step(dt, (x, z) => this.world.surfaceAt(x, z));
      const hits = collide(veh, this.world.colliders);
      for (const h of hits) this._hit(h);
      // --- the clock ----------------------------------------------------------------------------
      this.utc += dt * 1000 * this.timeScale;
    }
    this.tc.presentUtc = this.utc;
    this.tc.tick(dt);
    for (const e of this.tc.drain()) this.emit({ ...e, type: 'tc', ev: e.type });
    const mph = veh.speedoMph;
    // --- 88 miles per hour ------------------------------------------------------------------------
    if (this.tc.armed && mph >= TRIGGER_MPH && !this.travel.busy) { this.departedFrom = this.local; this.travel.depart(); this.emit({ type: 'depart', from: this.departedFrom, to: { ...this.tc.destination } }); }
    this.storm.update(dt, this.local);
    this.car.hook.visible = !!this.world.state?.rig;
    if (this.tc.on && this.tc.destination && !this.tc.powered && mph >= TRIGGER_MPH) this.emit({ type: 'empty' });
    this.travel.update(dt, { mph, armed: this.tc.armed });
    this.stage.fx.step(dt);
    // --- the world on this date ----------------------------------------------------------------
    const local = this.local;
    this.world.setTime(this.utc, local);
    if (!this._skyT || (this._skyT -= dt) <= 0) { this._sky(); this._skyT = 0.5; }
    const rain = this.air?.rain ?? 0;
    this.stage.fx.rain = rain;
    this.world.setWet(rain > 0 ? Math.min(1, rain * 1.2) : 0);
    this.stage.glass.rain = rain;
    if (rain > 0) { const sh = this.stage.r.env.sh, a = (sh[0] + sh[1] + sh[2]) / 3 * 0.09 + 0.00012 * (this.stage.night ?? 0); this.stage.fx.rainColor = [a * 0.9, a * 0.95, a * 1.1]; }
    // the storm's flashes light the whole sky for an instant
    const sf = this.storm.skyFlash;
    if (!this.travel.busy) this.stage.composite.flash = [sf * 0.05, sf * 0.055, sf * 0.07];
    // --- the car ---------------------------------------------------------------------------------
    car.pose(veh, dt);
    const night = this.stage.night ?? 0;
    const head = this.headlights;
    car.lights({ head, brake: veh.input.brake > 0.05, reverse: veh.gear === 'R', indicators: this.indicators });
    this.stage.spots = car.headlamps({ head });
    // the engine's state for the dials: coolant warms toward 190 F, fuel at ~19 mpg
    const E = this.engine;
    E.coolantF += ((veh.running ? 188 + veh.rpm / 1000 : 70) - E.coolantF) * Math.min(1, dt / 120);
    E.fuel = Math.max(0, E.fuel - (veh.speed * dt / 1609.34) / 19 / 13.2 - (veh.running ? 0.6 / 3600 / 13.2 * dt : 0));
    const flux = this.tc.on ? Math.min(1, 0.15 + Math.max(0, mph - 30) / 58 * 0.85) : 0;
    car.instruments({
      mph, rpm: veh.running ? veh.rpm : 0, coolantF: E.coolantF, fuel: E.fuel, volts: veh.running ? (head ? 13.7 : 14.2) : 12.3,
      oilPsi: veh.running ? Math.min(70, 12 + veh.rpm / 100) : 0, gear: veh.gear, steer: veh.steerAngle, night, head,
      tc: this.tc, digital: veh.running, flux, power: this.tc.on ? (this.tc.powered ? Math.min(1, 0.3 + mph / 88 * 0.7) : 0.05) : 0,
      primary: this.tc.on ? 0.62 : 0, plutonium: this.tc.charge > 0 ? 0.92 : 0.02,
    }, dt);
    this.flux = flux;
    // --- the view -------------------------------------------------------------------------------
    const [lx, ly] = inp.takeLook();
    if (lx || ly) this.rig.look(lx, ly);
    const z = inp.takeZoom(); if (z !== 1) this.rig.zoom(z);
    this.rig.update(dt, car, veh);
    // the glass: what the cabin looks like reflected in it, the frost after a jump
    const g = this.stage.glass;
    // the cabin mirrored in the glass from inside: as bright as the cabin really is (the sky's
    // light through the glass onto dark leather, the sun's on the dash), not a fixed grey
    const r = this.stage.r, sh = r.env.sh, k = 0.282095 * 0.02, sun = r.sunIntensity * Math.max(0, r.sunDir.y) * 0.0012;
    g.interior = [sh[0] * k + r.sunColor.x * sun, sh[1] * k + r.sunColor.y * sun, sh[2] * k + r.sunColor.z * sun];
    g.frost = Math.max(0, (this.frost ?? 0));
    this.onFrame?.(dt);
    if (!this.skipRender) this.stage.render(dt);
  }

  _hit(h) {
    const c = h.collider;
    if (c.pine != null) {
      // a young pine: run down; the future remembers
      this.timeline.change(this.utc, 'pineDown', { pine: c.pine });
      this.emit({ type: 'pine', pine: c.pine });
    }
    this.emit({ type: 'hit', speed: h.speed, what: c.name ?? (c.type === 'circle' ? 'post' : 'wall'), soft: h.soft });
  }

  // ---- time travel ------------------------------------------------------------------------------

  /** The displacement itself: the clock jumps to the destination, the world becomes the destination's. */
  displaceNow() {
    const arrive = this.tc.displace();
    this.utc = arrive;
    this.tc.presentUtc = arrive;
    const local = this.local;
    this.world.setTime(this.utc, local);
    this._sky();
    this.stage.exposure.reset = true;
    this.stage.taa.reset = true;
    this.emit({ type: 'arrive', at: local });
  }

  // ---- the car's controls ---------------------------------------------------------------------

  toggleTimeCircuits() { const on = this.tc.toggle(); this.emit({ type: 'lever', on }); return on; }
  keypad(k) { const ok = this.tc.key(k); if (/^[0-9]$/.test(k)) this.car.pressKey(k); this.emit({ type: 'keypad', key: k, ok }); return ok; }
  toggleHeadlights() { this.headlights = (this.headlights + 1) % 3; return this.headlights; }
  toggleDoor(side) { const t = this.car.toggleDoor(side); this.emit({ type: 'door', side, open: t > 0.5 }); return t; }
  loadPlutonium() { const ok = this.tc.load(); this.emit({ type: 'plutonium', ok }); return ok; }
  /** F: a pellet into the reactor (Part I, at a stop), or rubbish into Mr. Fusion (Part II). */
  refuel() {
    if (this.veh.speed > 1) { this.emit({ type: 'refuel', ok: false, why: 'moving' }); return false; }
    const ok = this.tc.power === 'fusion' ? this.tc.feedFusion() : this.tc.load();
    this.emit({ type: 'refuel', ok, fusion: this.tc.power === 'fusion', why: ok ? null : this.tc.charge ? 'full' : 'none' });
    return ok;
  }
}

export { MPH };
