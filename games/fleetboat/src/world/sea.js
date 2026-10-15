/**
 * The sea at the boat: the water column (temperature, salinity, density and pressure with depth),
 * the waves on the surface (and the water's orbital motion under them), and the bottom.
 *
 * Waves: a Pierson-Moskowitz spectrum for the wind (fully developed sea), sampled into a dozen
 * linear (Airy) components with random phases and a spread of directions about the wind's.
 * Elevation eta = sum a cos(k.x - w t + phase); under it the water moves in circles that shrink
 * as e^(kz) with depth. Deep water: w^2 = g k.
 */
import { WaterColumn } from '../physics/seawater.js';
import { G } from '../physics/units.js';

export class Sea {
  constructor({ column, wind = 0, windFrom = 270, seed = 7, floor = null } = {}) {
    this.column = column ?? new WaterColumn({ tSurf: 15, tDeep: 10, sSurf: 35, sDeep: 35, mixed: 30, layer: 50, bottom: 1500 });
    this.time = 0;
    this.waves = [];
    this.floorFn = floor;
    this.setWind(wind, windFrom, seed);
  }

  /** Wind speed (m/s at 19.5 m) and the direction it blows from (degrees). */
  setWind(U, from = 270, seed = 7) {
    this.wind = U; this.windFrom = from;
    this.waves = [];
    if (U < 0.5) return;
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    // Pierson-Moskowitz: S(w) = alpha g^2 / w^5 exp(-beta (w0/w)^4), w0 = g / U
    const alpha = 8.1e-3, beta = 0.74, w0 = G / U;
    const wp = 0.877 * w0;                            // the peak
    const N = 12, wMin = wp * 0.6, wMax = wp * 3.2;
    const dw = (wMax - wMin) / N;
    const dirTo = ((from + 180) % 360) * Math.PI / 180;
    for (let i = 0; i < N; i++) {
      const w = wMin + (i + 0.5) * dw;
      const S = alpha * G * G / w ** 5 * Math.exp(-beta * (w0 / w) ** 4);
      const a = Math.sqrt(2 * S * dw);
      const k = w * w / G;
      const th = dirTo + (rnd() - 0.5) * 1.2;         // directional spread
      // world: X east, Z south; a bearing th (from north, clockwise) points (sin th, -cos th)
      this.waves.push({ a, k, w, kx: k * Math.sin(th), kz: -k * Math.cos(th), ph: rnd() * Math.PI * 2 });
    }
    this.hs = 4 * Math.sqrt(this.waves.reduce((acc, c) => acc + c.a * c.a / 2, 0));   // significant height
  }

  step(dt) { this.time += dt; }

  /** Surface elevation (m) at world X, Z. */
  eta(X, Z) {
    let e = 0;
    for (const c of this.waves) e += c.a * Math.cos(c.kx * X + c.kz * Z - c.w * this.time + c.ph);
    return e;
  }

  /** The water's orbital velocity (world m/s) at X, Y (<= 0), Z. */
  orbital(X, Y, Z) {
    let vx = 0, vy = 0, vz = 0;
    for (const c of this.waves) {
      const th = c.kx * X + c.kz * Z - c.w * this.time + c.ph;
      const amp = c.a * c.w * Math.exp(c.k * Math.min(0, Y));
      const ch = Math.cos(th);
      vx += amp * ch * c.kx / c.k; vz += amp * ch * c.kz / c.k;
      vy += amp * Math.sin(th);
    }
    return [vx, vy, vz];
  }

  /** Depth of the bottom (m, positive) at X, Z. */
  floor(X, Z) { return this.floorFn ? this.floorFn(X, Z) : 1e4; }
}
