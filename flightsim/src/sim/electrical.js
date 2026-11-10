/**
 * The 28-volt electrical system: a 24 V battery behind a contactor, a 60 A belt-driven alternator with its field switch and
 * regulator, the primary and avionics buses, and a circuit breaker in front of every consumer. Whatever is switched on draws
 * current; the alternator supplies what the engine's speed lets it, the battery takes or gives the rest, and the bus voltage is
 * whatever that works out to. Lights really do dim when the starter cranks.
 */
import { clamp, sat, lag } from './util.js';

export const BREAKERS = [
  ['FUEL_IND', 'FUEL IND', 5], ['BCN_PITOT', 'BCN PITOT', 15], ['STROBE', 'STROBE AVN FAN', 5], ['LDG_LT', 'LDG LTS', 15],
  ['FLAP', 'FLAP', 15], ['INST', 'INST', 5], ['INST_LTS', 'INST LTS', 5], ['NAV_LT', 'NAV DOME', 10],
  ['ALT_FLD', 'ALT FLD', 5], ['RADIO1', 'RADIO 1', 10], ['RADIO2', 'RADIO 2', 5],
];

export class Electrical {
  constructor() {
    this.masterBat = false; this.masterAlt = false; this.avionics = false;
    this.breaker = Object.fromEntries(BREAKERS.map(([id]) => [id, true]));
    this.soc = 0.92;                 // battery state of charge
    this.capacity = 12.75 * 3600;    // A s
    this.volts = 0;                  // main bus
    this.battAmps = 0;               // + charging, - discharging (what the ammeter shows)
    this.altAmps = 0; this.loadAmps = 0;
    this.lowVolt = false;
    this.loads = [];                 // { breaker, amps, on(), avionics }
    this.battTemp = 15;
  }
  /** Registers a consumer: `amps` at 28 V (a number or a function), `on` says whether it is switched on. */
  add(breaker, amps, on, avionics = false) { this.loads.push({ breaker, amps, on, avionics }); }

  /** Volts available to something behind `breaker` (0 when the breaker is out or the bus is dead). */
  v(breaker, avionics = false) {
    return this.breaker[breaker] && (!avionics || this.avionics) ? this.volts : 0;
  }
  /** Is it powered well enough to work? */
  has(breaker, avionics = false) { return this.v(breaker, avionics) > 18; }

  step(dt, rpm, starterAmps) {
    const e0 = 23.3 + 2.2 * this.soc - (this.soc < 0.08 ? (0.08 - this.soc) * 60 : 0);      // open-circuit volts
    const rInt = 0.03 * (1 + 0.8 * sat((10 - this.battTemp) / 30)) * (1 + 1.5 * sat(0.3 - this.soc));
    if (!this.masterBat) {
      this.volts += (0 - this.volts) * lag(dt, 0.02);
      this.battAmps = 0; this.altAmps = 0; this.loadAmps = 0; this.lowVolt = false;
      return;
    }
    // what is switched on, as a conductance (lamps and heaters draw less at lower voltage)
    let g = 0.5 / 28;                                                                        // contactor coil, clock
    for (const l of this.loads) {
      if (!this.breaker[l.breaker] || (l.avionics && !this.avionics) || !l.on()) continue;
      g += (typeof l.amps === 'function' ? l.amps() : l.amps) / 28;
    }
    const altOn = this.masterAlt && this.breaker.ALT_FLD && rpm > 450;
    const altMax = altOn ? 60 * sat((rpm - 450) / 950) : 0;
    // try the regulated voltage first; if the alternator cannot hold it, the battery makes up the difference
    let v = 28, iLoad = g * v + starterAmps;
    let iBatt = (v - e0) / (rInt + 0.25 + 1.2 * this.soc * this.soc);                        // charging current tapers as it fills
    if (iBatt < 0) iBatt = 0;
    let iAlt = iLoad + iBatt;
    if (iAlt > altMax) {
      iAlt = altMax;
      v = (e0 / rInt + iAlt - starterAmps) / (g + 1 / rInt);                                 // node equation of the bus
      iBatt = (v - e0) / rInt;                                                               // negative: discharging
      iLoad = g * v + starterAmps;
    }
    this.volts += (Math.max(v, 0) - this.volts) * lag(dt, 0.03);
    this.altAmps = iAlt; this.loadAmps = iLoad; this.battAmps = iBatt;
    this.soc = clamp(this.soc + iBatt * (iBatt > 0 ? 0.9 : 1) * dt / this.capacity, 0, 1);
    this.lowVolt = this.volts < 24.6;
  }
}
