/**
 * The simulation: the sea, the sea floor, the boat's plant and (once aboard) her crew, stepped
 * together at 60 steps a second of boat time, whatever the frame rate or the time compression.
 * The clock is Hawaii time on Thursday 15 October 2026.
 */
import { Sea } from './world/sea.js';
import { Seabed } from './world/seabed.js';
import { WaterColumn } from './physics/seawater.js';
import { Plant } from './physics/plant.js';
import { CONDITIONS, crewWeight } from './sim/conditions.js';
import { Crew } from './crew/crew.js';
import { DATE } from './data/place.js';

export const hms = (s) => { const [h, m = 0, sec = 0] = String(s).split(':').map(Number); return h * 3600 + m * 60 + sec; };
export const fmt = (t) => { t = ((t % 86400) + 86400) % 86400; const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };

export class Sim {
  constructor({ start = 'dive', clock = hms('09:40'), wind = 6 } = {}) {
    this.clock = clock;
    this.bed = new Seabed();
    // off Oahu in October: a warm mixed layer over the thermocline (World Ocean Atlas, 21 N 158 W)
    const column = new WaterColumn({ tSurf: 27.2, tDeep: 19, tAbyss: 6, sSurf: 35.0, sDeep: 34.8, mixed: 60, layer: 120, deepScale: 400, bottom: 4000, lat: 21.4 });
    this.sea = new Sea({ column, wind, windFrom: 60, floor: (X, Z) => this.bed.depth(X, Z) });
    this.plant = new Plant({ sea: this.sea });
    crewWeight(this.plant);
    (CONDITIONS[start] ?? CONDITIONS.dive)(this.plant, { heading: 330 * Math.PI / 180 });
    this.log = [];
    this.plant.step(1e-4);
    this.crew = new Crew(this, { condition: start === 'submerged' ? 'submerged' : 'surfaced' });
    this.crew.step(0);
    this.plant.compensate(start === 'submerged' ? undefined : undefined);
    this.dt = 1 / 60;
    this.acc = 0;
  }

  get utcMs() { return Date.UTC(DATE.year, DATE.month - 1, DATE.day) + (this.clock - DATE.utcOffset * 3600) * 1000; }

  say(text, who = null) { this.log.push({ t: this.clock, text, who }); if (this.log.length > 200) this.log.shift(); }

  /** Advances by dt seconds of boat time. */
  advance(dt) {
    this.acc += dt;
    const P = this.plant;
    while (this.acc >= this.dt) {
      this.acc -= this.dt;
      this.sea.step(this.dt);
      this.crew?.step(this.dt);
      P.step(this.dt);
      for (const e of P.events) this.say(e);
      this.clock += this.dt;
    }
  }
}
