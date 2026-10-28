/**
 * The simulation: the hoist, the drive, the doors and the controller stepped together at
 * 1000 steps a second of elevator time, and the loose things in the building (physics/bodies.js)
 * at 250, whatever the frame rate or the time compression. The clock is Stockholm time on
 * Tuesday 27 October 2026.
 */
import { Hoist } from './physics/hoist.js';
import { Drive } from './physics/drive.js';
import { Doors } from './physics/doors.js';
import { Controller } from './control/controller.js';
import { DATE } from './data/spec.js';

export const hms = (s) => { const [h, m = 0, sec = 0] = String(s).split(':').map(Number); return h * 3600 + m * 60 + sec; };
export const fmt = (t) => { t = ((t % 86400) + 86400) % 86400; const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };

export class Sim {
  constructor({ floor = 1, load = 0, clock = hms('13:40') } = {}) {
    this.hoist = new Hoist({ floor, load });
    this.drive = new Drive(this.hoist);
    this.doors = new Doors();
    this.ctl = new Controller(this);
    this.clock = clock;
    this.dt = 1 / 1000;
    this.acc = 0;
    this.tick = 0;
    this.log = [];
    this.sounds = [];
    this.world = null;          // the loose things, when there is a world round the elevator
  }

  get utcMs() { return Date.UTC(DATE.year, DATE.month - 1, DATE.day) + (this.clock - DATE.utcOffset * 3600) * 1000; }

  say(text, who = null) { this.log.push({ t: this.clock, text, who }); if (this.log.length > 200) this.log.shift(); }
  sfx(name, opts = {}) { this.sounds.push({ name, ...opts }); if (this.sounds.length > 64) this.sounds.shift(); }

  /** An earthquake: dur seconds of ground motion, amp its peak acceleration (m/s²). */
  quake(dur = 14, amp = 2.0) { this.shake = { t: 0, dur, amp, a: [0, 0, 0] }; this.say(`Earthquake: the building shakes (peak ground acceleration ${amp.toFixed(1)} m/s²).`, 'Simulator'); }

  /** Advances by dt seconds of elevator time. */
  advance(dt) {
    this.acc += dt;
    let n = 0;
    const h = this.hoist;
    while (this.acc >= this.dt) {
      if (++n > 2000) { this.acc = 0; break; }       // a long hitch: let the rest go
      this.acc -= this.dt;
      if (this.shake) {
        // an earthquake: the ground's acceleration (two horizontal components, ramped in and out)
        const S = this.shake, t = (S.t += this.dt), env = Math.min(1, t / 2, (S.dur - t) / 3);
        S.a = [S.amp * env * Math.sin(2 * Math.PI * 1.7 * t) + 0.5 * S.amp * env * Math.sin(2 * Math.PI * 4.3 * t + 1), 0, S.amp * env * Math.sin(2 * Math.PI * 2.3 * t + 0.4)];
        if (t > 0.8) this.ctl.inputs.seismic = true;          // the sensor's threshold is passed
        if (this.world) this.world.shake = S.a;
        if (t >= S.dur) { this.shake = null; if (this.world) this.world.shake = null; this.ctl.inputs.seismic = false; }
      }
      this.ctl.step(this.dt);
      this.doors.step(this.dt, h.yc);
      h.step(this.dt);
      if (++this.tick % 4 === 0) this.world?.step(this.dt * 4);
      if (h.events.length) { for (const e of h.events) this.say(e, 'Elevator'); h.events.length = 0; }
      this.clock += this.dt;
    }
  }
}
