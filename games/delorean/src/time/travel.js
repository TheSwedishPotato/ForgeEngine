/**
 * Temporal displacement, as the films show it.
 *
 * The run-up (time circuits on, a destination set, 1.21 GW ready): the flux capacitor races,
 * the coils on the vents glow blue-white from about 70 mph, and from about 80 the car is
 * wrapped in electricity: arcs crawling over the body, a bright field gathering at the nose.
 *
 * 88 mph: three flashes in a fraction of a second, a bang like a sonic boom with each, and
 * the car is gone; behind it two trails of fire burn along its tyre tracks (and in the air,
 * if it left the ground). For a moment the car is nowhere (seen from the driver's seat: the
 * world burns white).
 *
 * Arrival, at the same place and speed: a halo condenses in the air, three flashes and three
 * bangs, and the car is there, iced over from wherever it has been (Doc: "It's cold. Damn
 * cold."), the cold vapour pouring from its vents and steaming off the body for a minute or
 * two while the frost melts.
 */
import { PointLight, Color, Vector3 } from 'three';
import { bolt } from '../render/effects.js';

const LIMBO = 1.35;         // seconds between vanishing and arriving (screen time)

export class TimeTravel {
  constructor(game) {
    this.g = game;
    const car = game.car;
    // two lights on the car for the glow of the run-up and the flash
    this.glowLight = new PointLight(new Color(0.55, 0.75, 1.0), 0, 14);
    this.glowLight.position.set(1.6, 0.7, 0);
    this.flashLight = new PointLight(new Color(0.9, 0.95, 1.0), 0, 80);
    this.flashLight.position.set(0.5, 1.2, 0);
    car.body.add(this.glowLight, this.flashLight);
    this.track = [];        // recent contact points of the rear tyres: [{ l: [x,z], r: [x,z] }]
    this.phase = null;
    this.frost = 0;
    this.vapour = 0;
    this.trails = [];       // burning trails left behind: { pts: [[x,z]...], age }
    this._arcT = 0;
  }

  get busy() { return !!this.phase; }

  /** Each frame: the run-up's glow and arcs, the flash and the trails, the frost and the vapour. */
  update(dt, { mph, armed }) {
    const g = this.g, car = g.car, fx = g.stage.fx, M = car.M;
    // a brightness scale for the light show: full by day, ~0.6 % at night (the night's exposure
    // is some two hundred times the day's)
    const el = g.stage.sunPos?.elevation ?? 20;
    const day = Math.min(1, Math.max(0, (el + 6) / 16));
    this.k = 0.006 + (1 - 0.006) * day * day;
    fx.arcColor = [0.75 * this.k * 4, 0.88 * this.k * 4, 1.6 * this.k * 4];
    // remember the tyre tracks (every 0.5 m)
    car.root.updateMatrixWorld();
    const wl = new Vector3(-1.2065, 0, -0.794).applyMatrix4(car.root.matrixWorld), wr = new Vector3(-1.2065, 0, 0.794).applyMatrix4(car.root.matrixWorld);
    const last = this.track[this.track.length - 1];
    if (!last || Math.hypot(wl.x - last.l[0], wl.z - last.l[1]) > 0.5) { this.track.push({ l: [wl.x, wl.z], r: [wr.x, wr.z] }); if (this.track.length > 160) this.track.shift(); }
    // --- the run-up -------------------------------------------------------------------------
    const build = armed && !this.phase ? Math.max(0, Math.min(1, (mph - 68) / 20)) : 0;
    const charge = this.phase === 'depart' ? 1 : build;
    M.coil.emissiveIntensity = charge * charge * 6;
    M.coilGlow.emissiveIntensity = charge * charge * 8;
    M.flux.emissiveIntensity = (g.tc.on ? 0.02 : 0) + charge * 1.5;
    this.glowLight.intensity = charge * charge * 0.05;
    if (build > 0.55 && !this.phase) this._arcs(dt, (build - 0.55) / 0.45);
    // --- departure, limbo, arrival -------------------------------------------------------------
    if (this.phase) this.t += dt;
    if (this.phase === 'depart') {
      // three flashes in 0.3 s
      const k = [0, 0.11, 0.22].reduce((s, t0) => s + Math.max(0, 1 - Math.abs(this.t - t0) / 0.05), 0);
      this.flashLight.intensity = k * 6;
      g.stage.composite.flash = [k * 0.35, k * 0.38, k * 0.45];
      this._arcs(dt, 1.2);
      if (this.t >= 0.24 && !this.vanished) this._vanish();
      // from the driver's seat the world burns white while the car is nowhere
      if (this.vanished) g.stage.composite.warp = g.rig.mode === 'driver' || g.rig.mode === 'passenger' ? Math.min(1, (this.t - 0.24) * 6) : 0;
      if (this.t >= 0.24 + LIMBO) this._arrive();
    } else if (this.phase === 'arrive') {
      const k = [0, 0.12, 0.24].reduce((s, t0) => s + Math.max(0, 1 - Math.abs(this.t - t0) / 0.05), 0);
      this.flashLight.intensity = k * 6;
      g.stage.composite.flash = [k * 0.3, k * 0.33, k * 0.4];
      if (this.t >= 0.24 && car.root.visible === false) { car.root.visible = true; g.paused = false; g.pausedPhysicsOnly = false; }
      g.stage.composite.warp = g.rig.mode === 'driver' || g.rig.mode === 'passenger' ? Math.max(0, 1 - this.t / 0.35) : 0;
      if (this.t > 1.2) { this.phase = null; this.flashLight.intensity = 0; g.stage.composite.flash = [0, 0, 0]; g.stage.composite.warp = 0; }
    }
    // --- the fire trails ----------------------------------------------------------------------
    for (const tr of this.trails) {
      tr.age += dt;
      const strength = Math.max(0, 1 - tr.age / 7);
      if (strength <= 0) continue;
      for (const [x, z] of tr.pts) {
        if (Math.random() > dt * 14 * strength) continue;
        const kf = this.k * 1.4;
        fx.emit({ x: x + (Math.random() - 0.5) * 0.1, y: 0.06, z: z + (Math.random() - 0.5) * 0.1, vx: 0, vy: 0.9 + Math.random() * 1.4, vz: 0, life: 0.35 + Math.random() * 0.35, size: 0.08 + strength * 0.1, grow: 0.4, color: [3.5 * kf, 1.25 * kf, 0.3 * kf], alpha: 0.85 * strength, drag: 1.5, rise: 1.4, cool: true, kind: 'add', soft: 0.15 });
        if (Math.random() < 0.06) fx.emit({ x, y: 0.5, z, vx: 0, vy: 1.0, vz: 0, life: 2.5, size: 0.3, grow: 1.0, color: [0.3, 0.3, 0.3], alpha: 0.25 * strength, drag: 0.8, rise: 0.4, kind: 'mix', soft: 0.6, lit: true });
      }
    }
    this.trails = this.trails.filter((t) => t.age < 7.5);
    // --- frost and vapour after a jump ------------------------------------------------------------
    if (this.frost > 0) {
      this.frost = Math.max(0, this.frost - dt / 110);
      car.setFrost(this.frost);
      g.frost = this.frost;
      // the cold vapour from the vents, and steam off the body
      const rate = this.frost * 60;
      for (const s of [1, -1]) {
        if (Math.random() < rate * dt) {
          const p = new Vector3(-2.14, 1.0, 0.43 * s).applyMatrix4(car.body.matrixWorld);
          const v = new Vector3(-1.5, 0.3, 0).transformDirection(car.body.matrixWorld).multiplyScalar(0.8 + Math.random());
          fx.emit({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, life: 2.5 + Math.random() * 2, size: 0.18, grow: 0.6, color: [0.7, 0.72, 0.75], alpha: 0.28, drag: 0.9, rise: -0.15, kind: 'mix', soft: 0.5, lit: true });
        }
      }
      if (Math.random() < this.frost * 25 * dt) {
        const p = new Vector3(-1.8 + Math.random() * 3.6, 1.0 + Math.random() * 0.15, (Math.random() - 0.5) * 1.6).applyMatrix4(car.body.matrixWorld);
        fx.emit({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0.15, vz: 0, life: 3, size: 0.3, grow: 0.5, color: [0.6, 0.62, 0.65], alpha: 0.12, drag: 0.5, rise: 0.05, kind: 'mix', soft: 0.5, lit: true });
      }
    }
    // the light of the vapour: it is lit by the scene's ambient (scaled with the exposure in effect)
    const amb = g.stage.r.env.sh;
    const ambL = Math.max(1e-6, (amb[0] + amb[1] + amb[2]) / 3 * 0.282 / Math.PI) + g.stage.r.sunIntensity * Math.max(0, g.stage.r.sunDir.y) * 0.02;
    for (const p of fx.particles) if (p.lit) { p.color = [ambL * 1.8, ambL * 1.85, ambL * 1.95]; }
  }

  /** The arcs crawling over the car, more and brighter as it nears 88 mph. */
  _arcs(dt, k) {
    const fx = this.g.stage.fx, car = this.g.car;
    this._arcT -= dt;
    if (this._arcT > 0) return;
    this._arcT = 0.035;
    const m = car.body.matrixWorld;
    const P = (x, y, z) => { const v = new Vector3(x, y, z).applyMatrix4(m); return [v.x, v.y, v.z]; };
    const R = Math.random;
    const n = Math.round(3 + k * 16);
    for (let i = 0; i < n; i++) {
      // from a point on the body to another nearby, or out into the air; most at the front
      const front = R() < 0.55;
      const x0 = front ? 1.6 + R() * 0.5 : -2.1 + R() * 3.9, side = R() < 0.5 ? -1 : 1;
      const y0 = 0.3 + R() * 0.75, z0 = side * (0.5 + R() * 0.45);
      const a = P(x0, y0, z0);
      const b = front ? P(2.3 + R() * 0.6, 0.2 + R() * 0.9, (R() - 0.5) * 1.8) : P(x0 + (R() - 0.5) * 1.4, y0 + (R() - 0.3) * 0.6, z0 + side * R() * 0.5);
      fx.arcs.push({ points: bolt(a, b, 0.35, 5), b: 2.5 + k * 6, life: 0.05 + R() * 0.06 });
    }
    // the field at the nose
    const nose = P(2.35, 0.55, 0);
    const kk = this.k * k * 2;
    fx.emit({ x: nose[0], y: nose[1], z: nose[2], vx: 0, vy: 0, vz: 0, life: 0.08, size: 0.4 + k * 1.0, color: [0.9 * kk, 1.1 * kk, 2.2 * kk], alpha: 1, kind: 'add', soft: 0.5 });
    // sparks off the tyres and the underside
    for (let i = 0; i < Math.round(k * 3); i++) {
      const p = P(-2 + R() * 4, 0.15, (R() - 0.5) * 1.6);
      const ks = this.k * 3;
      fx.emit({ x: p[0], y: p[1], z: p[2], vx: (R() - 0.5) * 3, vy: R() * 2.5, vz: (R() - 0.5) * 3, life: 0.2 + R() * 0.2, size: 0.012, color: [4 * ks, 5 * ks, 7 * ks], alpha: 1, drag: 2, rise: -6, kind: 'add', soft: 0.05 });
    }
  }

  /** 88 mph: begin. */
  depart() {
    this.phase = 'depart';
    this.t = 0;
    this.vanished = false;
    this.g.emit({ type: 'boom', n: 3 });
  }

  _vanish() {
    const g = this.g;
    this.vanished = true;
    g.car.root.visible = false;
    // the fire: along the last 30 m of both tyre tracks
    const tr = this.track.slice(-60);
    this.trails.push({ pts: tr.map((p) => p.l), age: 0 }, { pts: tr.map((p) => p.r), age: 0 });
    // a burst of light and sparks where it was
    const p = g.car.root.position;
    const kb = this.k * 4;
    for (let i = 0; i < 60; i++) g.stage.fx.emit({ x: p.x + (Math.random() - 0.5) * 3, y: 0.3 + Math.random() * 1.2, z: p.z + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 8, life: 0.3 + Math.random() * 0.4, size: 0.015, color: [5 * kb, 6 * kb, 9 * kb], alpha: 1, drag: 1.5, rise: -5, kind: 'add', soft: 0.05 });
    // the car is nowhere for a moment: the outside view stays here to watch the fire
    g.rig.freeze = true;
    g.paused = true;
    g.pausedPhysicsOnly = true;
    this.phase = 'depart';
  }

  _arrive() {
    const g = this.g;
    // the clock, the world, the sky: the destination's
    g.displaceNow();
    this.trails = [];
    g.stage.fx.particles.length = 0;
    g.stage.fx.arcs.length = 0;
    g.rig.freeze = false;
    this.phase = 'arrive';
    this.t = 0;
    this.frost = 1;
    this.track = [];
    g.emit({ type: 'boom', n: 3, arrival: true });
    // the halo condensing where the car will be
    const p = g.car.root.position;
    const kh = (this.k ?? 1) * 2;
    for (let i = 0; i < 3; i++) g.stage.fx.emit({ x: p.x, y: 0.8, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.3, fadeIn: 0.1 + i * 0.05, size: 5 - i * 1.3, color: [1.2 * kh, 1.4 * kh, 2.2 * kh], alpha: 0.6, kind: 'add', soft: 1 });
  }
}
