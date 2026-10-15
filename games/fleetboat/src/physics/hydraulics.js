/**
 * The main hydraulic system (Fleet Type Submarine, chapter 12): two IMO screw pumps in the pump
 * room charging the 1,500 cubic inch air-loaded accumulator (oil at up to 750 psi, the air side
 * loaded to 1,950 psi from the high-pressure air), feeding the hydraulic manifold in the control
 * room (the levers for the main vents, the flood valves, the main induction), the bow and stern
 * plane tilting rams, the steering rams aft, the bow plane rigging gear and the outer doors of the
 * torpedo tubes.
 *
 * Each ram draws oil for its stroke; while the pressure holds, it moves at its rated speed, and as
 * the accumulator empties and the pressure falls toward what the pumps alone can give, the rams
 * slow; with no pressure at all they stop, and the gear must be shifted to hand (much slower, a
 * man on a crank). The pilot valve unloads the pumps when the accumulator is full.
 */
import { HYDRAULIC, PSI, GAL } from '../data/boat.js';

const IN3 = 1.6387e-5;          // m^3

export class Hydraulics {
  constructor() {
    this.oil = HYDRAULIC.accumulator * 0.9;     // oil in the accumulator (m^3)
    this.pumps = [false, false];                // the IMO pumps (electric, switched in the pump room)
    this.pumpRate = 12 * GAL / 60;              // each, at 600-750 psi (estimate)
    this.p = 700 * PSI;
    this.demand = 0;                            // m^3/s drawn this step
    this.unloaded = false;
  }

  get psi() { return this.p / PSI; }

  /** How fast a ram can move now (0..1 of its rated speed). */
  get capacity() { return Math.max(0, Math.min(1, (this.psi - 150) / 350)); }

  /**
   * A ram asks for oil to move: rate (rated units/s), oil per unit (m^3); returns the speed it gets.
   * Called by each actuator every step it is moving.
   */
  draw(rate, oilPerUnit, dt) {
    const k = this.capacity;
    if (k <= 0) return 0;
    this.demand += Math.abs(rate) * k * oilPerUnit;
    return rate * k;
  }

  step(dt) {
    const running = this.pumps.filter(Boolean).length;
    const max = HYDRAULIC.accumulator;
    // the pilot valve: pumps unload at full, load again below 85 %
    if (this.oil >= max) this.unloaded = true;
    if (this.oil < 0.85 * max) this.unloaded = false;
    const inflow = this.unloaded ? 0 : running * this.pumpRate;
    this.oil = Math.max(0, Math.min(max, this.oil + (inflow - this.demand) * dt));
    // the air-loaded plunger: about 750 psi full, 600 psi near the bottom of its stroke; empty, only
    // what the pumps make against the demand
    if (this.oil > 1e-6) this.p = (600 + 150 * this.oil / max) * PSI;
    else this.p = running ? Math.min(600, 600 * inflow / Math.max(inflow, this.demand + 1e-9)) * PSI : Math.max(0, this.p - 400 * PSI * dt);
    this.demand = 0;
  }
}

export { IN3 };
