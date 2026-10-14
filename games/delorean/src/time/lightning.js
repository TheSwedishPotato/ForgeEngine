/**
 * Saturday, 12 November 1955: the storm, and the bolt that strikes the courthouse clock tower
 * at 10:04 PM (the clock stops at that minute for the next thirty years).
 *
 * Doc's plan: a cable from the tower's lightning rod, down past the clock, across the square
 * to the lamp posts and across Main Street at the height of a hook on a pole on the back of
 * the time machine. At 10:04:00 the bolt hits the rod and its 1.21 gigawatts run down the
 * cable: if at that moment the hook is on the cable and the car is doing 88 mph with the time
 * circuits on, the charge goes to the flux capacitor and the car is displaced. Miss it and the
 * lightning will not strike there again.
 *
 * Also the storm itself: rain, flashes in the clouds, thunder arriving at the speed of sound.
 */
import { Vector3 } from 'three';
import { localToUtc } from '../astro.js';
import { bolt } from '../render/effects.js';
import { RIG } from '../world/rig.js';

export const STRIKE_UTC = localToUtc({ y: 1955, mo: 11, d: 12, h: 22, mi: 4 });
const WINDOW = 0.45;      // seconds either side of the strike that the hook may touch the cable

export class Storm {
  constructor(game) {
    this.g = game;
    this.next = 4;
    this.struck = false;
    this.flash = 0;
  }

  /** Is the night of the storm (the evening of 12 November 1955)? */
  active(local) { return local.y === 1955 && local.mo === 11 && local.d === 12 && local.h >= 17; }

  update(dt, local) {
    const g = this.g, fx = g.stage.fx;
    if (!this.active(local)) { this.flash = 0; return; }
    const R = Math.random;
    // the distant flashes, and their thunder
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 5 + R() * 14;
      const dist = 1500 + R() * 4000;
      this.flash = 0.6 + R() * 0.8;
      g.emit({ type: 'thunder', delay: dist / 343, size: 0.5 + (4000 - dist) / 6000 });
    }
    this.flash = Math.max(0, this.flash - dt * 6);
    // the strike
    const t = (g.utc - STRIKE_UTC) / 1000;
    if (!this.struck && t >= 0) this._strike();
    if (this.struck && t < 1.0) {
      // the bolt flickers on for half a second; the current runs down the cable
      if (t < 0.6) {
        for (let k = 0; k < 2; k++) fx.arcs.push({ points: bolt([RIG.cloud.x + (R() - 0.5) * 40, RIG.cloud.y, RIG.cloud.z], [RIG.rod.x, RIG.rod.y, RIG.rod.z], 0.18, 7), b: 60 * (1 - t / 0.6) * (R() < 0.5 ? 1 : 0.4), life: 0.06 });
        const pts = RIG.cable;
        const n = Math.floor(Math.min(1, t / 0.25) * (pts.length - 1));
        for (let i = 0; i < n; i += 2) {
          const p = pts[i], q = pts[Math.min(pts.length - 1, i + 2)];
          fx.arcs.push({ points: bolt([p.x, p.y, p.z], [q.x, q.y, q.z], 0.4, 3), b: 8, life: 0.05 });
        }
      }
      if (t < 0.4) {
        const p = RIG.clock;
        for (let i = 0; i < 6; i++) fx.emit({ x: p.x + (R() - 0.5) * 2, y: p.y + (R() - 0.5) * 2, z: p.z, vx: (R() - 0.5) * 6, vy: R() * 4, vz: R() * 5, life: 0.6 + R() * 0.6, size: 0.04, color: [8 * (this.g.travel.k ?? 1), 6 * (this.g.travel.k ?? 1), 3 * (this.g.travel.k ?? 1)], alpha: 1, drag: 1, rise: -9, kind: 'add', soft: 0.05 });
      }
    }
    // does the hook touch the cable at the moment of the strike?
    if (this.struck && t < WINDOW && !this.powered && g.car.hook?.visible) {
      const tip = g.car.hookTip();
      const c = RIG.cableAt(tip.z);
      if (c && Math.abs(tip.x - RIG.street.x) < 1.6 && Math.abs(tip.y - c.y) < 0.4) {
        this.powered = true;
        g.tc.lightning = 0.6;
        g.emit({ type: 'contact' });
      }
    }
  }

  _strike() {
    this.struck = true;
    this.flash = 3;
    this.g.emit({ type: 'thunder', delay: 0.05, size: 1.6, strike: true });
    this.g.emit({ type: 'strike' });
  }

  /** The sky's brightening in a flash (0..). */
  get skyFlash() { return this.flash; }

  reset() { this.struck = false; this.powered = false; }
}

export { Vector3 };
