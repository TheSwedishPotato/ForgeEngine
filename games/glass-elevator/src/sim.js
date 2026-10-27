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

  /** Advances by dt seconds of elevator time. */
  advance(dt) {
    this.acc += dt;
    let n = 0;
    const h = this.hoist;
    while (this.acc >= this.dt) {
      if (++n > 2000) { this.acc = 0; break; }       // a long hitch: let the rest go
      this.acc -= this.dt;
      this.ctl.step(this.dt);
      this.doors.step(this.dt, h.yc);
      h.step(this.dt);
      if (++this.tick % 4 === 0) this.world?.step(this.dt * 4);
      if (h.events.length) { for (const e of h.events) this.say(e, 'Elevator'); h.events.length = 0; }
      this.clock += this.dt;
    }
  }
}
