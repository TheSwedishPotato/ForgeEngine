/**
 * The air the aeroplane flies in: pressure, temperature, density and humidity with height, the wind with its shear near the
 * ground, gusts, and turbulence as a frozen field of eddies that drifts with the wind. The aeroplane samples the field at every
 * wing strip, so a gust reaches one wing before the other and the tail after the nose.
 */
import { DEG, G0, R_AIR, GAMMA, clamp, sat, lerp, smooth, rng, FT } from './util.js';

const LAPSE = 0.0065;                 // K/m, standard troposphere
const EXP = G0 / (LAPSE * R_AIR);     // 5.2559
const P0 = 101325, T0 = 288.15;

/** Saturation vapour pressure over water, Pa (Magnus). */
const esat = (tC) => 610.94 * Math.exp((17.625 * tC) / (tC + 243.04));

/** Height in metres that an altimeter set to `setting` (Pa) shows at static pressure `p`: the ISA calibration law. */
export function altimeterHeight(p, setting = P0) {
  return (T0 / LAPSE) * (Math.pow(setting / P0, 1 / EXP) - Math.pow(p / P0, 1 / EXP));
}

export class Weather {
  constructor(o = {}) {
    this.fieldElev = 43;              // m above sea level
    this.qnh = 101325;                // Pa: the altimeter setting at which an altimeter on the field reads its elevation
    this.oat = 15;                    // deg C at the field
    this.dewpoint = 8;
    this.windDir = 250;               // degrees true the surface wind blows FROM, at 10 m
    this.windSpeed = 3;               // m/s at 10 m
    this.gust = 0;                    // m/s on top of the mean in gusts
    this.aloftDir = 270;              // at 900 m above the field
    this.aloftSpeed = 8;
    this.turbulence = 1;              // multiplier on what the wind and the sun produce
    this.cloudCover = 0.3;            // 0..1
    this.rain = 0;                    // 0..1
    this.hour = 14;                   // local solar time
    this.dayOfYear = 172;
    this.latitude = 59.35;
    Object.assign(this, o);
    this.time = 0;
    this._air = { p: P0, T: T0, rho: 1.225, a: 340.3, rh: 0.5, tC: 15 };
    this._w = { x: 0, y: 0, z: 0 };
    const r = rng(o.seed ?? 7);
    // the eddies: wavelengths from 12 m to 1.5 km, amplitude ~ wavelength^(1/3) (Kolmogorov), velocity normal to the wave vector
    this.modes = [];
    for (let i = 0; i < 14; i++) {
      const lam = 12 * Math.pow(125, i / 13);
      const th = r() * Math.PI * 2, el = (r() - 0.5) * 1.2, k = (2 * Math.PI) / lam;
      const kx = Math.cos(th) * Math.cos(el) * k, ky = Math.sin(el) * k, kz = Math.sin(th) * Math.cos(el) * k;
      // a unit vector at right angles to k (so the field has no divergence)
      let ex = r() - 0.5, ey = r() - 0.5, ez = r() - 0.5;
      const kk = (ex * kx + ey * ky + ez * kz) / (k * k);
      ex -= kk * kx; ey -= kk * ky; ez -= kk * kz;
      const n = Math.hypot(ex, ey, ez) || 1;
      this.modes.push({ kx, ky, kz, ex: ex / n, ey: ey / n, ez: ez / n, amp: Math.cbrt(lam), ph: r() * 6.283, rate: (r() - 0.5) * 0.25 });
    }
    const norm = Math.sqrt(this.modes.reduce((s, m) => s + 0.5 * m.amp * m.amp, 0));
    for (const m of this.modes) m.amp /= norm;                 // the sum now has an RMS of 1 per unit vector
  }

  get fieldTempK() { return this.oat + 273.15; }
  /** Pressure at the field (QFE) from the QNH, by the altimeter's own law. */
  get qfe() { return P0 * Math.pow(Math.pow(this.qnh / P0, 1 / EXP) - (LAPSE * this.fieldElev) / T0, EXP); }
  /** Relative humidity at the surface, 0..1. */
  get surfaceRH() { return clamp(esat(this.dewpoint) / esat(this.oat), 0, 1); }
  /** Cloud base above the field from the spread between temperature and dew point (about 125 m per degree). */
  get cloudBase() { return Math.max(0, 125 * (this.oat - this.dewpoint)); }

  /** Sun elevation and azimuth (rad; azimuth from north through east) from latitude, day and local solar hour. */
  sun() {
    const decl = 23.44 * DEG * Math.sin(((this.dayOfYear - 81) / 365) * 2 * Math.PI);
    const lat = this.latitude * DEG, H = (this.hour - 12) * 15 * DEG;
    const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(clamp(sinEl, -1, 1));
    const az = Math.atan2(-Math.cos(decl) * Math.sin(H), Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(H));
    return { el, az };
  }

  /** The state of the air at height `y` (metres above the field). The returned object is reused. */
  air(y) {
    const a = this._air, Tf = this.fieldTempK;
    const T = Math.max(Tf - LAPSE * y, 216.65);
    const p = this.qfe * Math.pow(T / Tf, EXP);
    const tC = T - 273.15;
    // the dew point falls about 1.8 K per km, the temperature 6.5: humidity rises with height up to the cloud base
    const rh = clamp(esat(this.dewpoint - 0.0018 * y) / esat(tC), 0, 1);
    const e = rh * esat(tC);
    a.p = p; a.T = T; a.tC = tC; a.rh = rh;
    a.rho = p / (R_AIR * T) * (1 - 0.378 * e / p);
    a.a = Math.sqrt(GAMMA * R_AIR * T);
    return a;
  }

  /** How rough the air is, m/s RMS, at height `agl`. */
  roughness(agl) {
    const sun = Math.max(0, Math.sin(this.sun().el));
    const mech = 0.11 * this._surface * (1 - sat(agl / 1200)) + 0.035 * this.aloftSpeed * sat(agl / 600) * 0.4;
    const thermal = 0.9 * sun * (1 - 0.7 * this.cloudCover) * sat(agl / 80) * (1 - sat((agl - 1500) / 800));
    return this.turbulence * (mech + thermal);
  }

  /** Advance the weather's clock (gusts and eddies move). */
  step(dt) {
    this.time += dt;
    const t = this.time;
    // gusts: a slow, lumpy rise and fall of the surface wind
    const g = 0.5 + 0.5 * Math.sin(t * 0.21 + 1.3 * Math.sin(t * 0.083)) * Math.sin(t * 0.057 + 2);
    this._gustNow = this.gust * g * g;
    this._surface = this.windSpeed + this._gustNow;
    this._veer = 8 * DEG * Math.sin(t * 0.047 + 0.6 * Math.sin(t * 0.13)) * sat(this.gust / 3 + 0.3);
  }

  /**
   * Wind velocity (world, m/s: the way the air moves) at a point. `x`, `z` world metres; `agl` height above the ground.
   * `mean` true leaves the turbulence out (for the windsock's steady part, the wake direction).
   */
  wind(x, agl, z, out = this._w, mean = false) {
    if (this._surface === undefined) this.step(0);
    const h = Math.max(agl, 0.3);
    // speed: a power-law boundary layer up to 300 m, then on to the wind aloft at 900 m
    const vs = this._surface * Math.pow(Math.min(h, 300) / 10, 0.16);
    const k = smooth(300, 900, h);
    const speed = lerp(vs, Math.max(this.aloftSpeed, vs * 0.6), k);
    let dd = ((this.aloftDir - this.windDir + 540) % 360) - 180;
    const dir = (this.windDir + dd * smooth(60, 900, h)) * DEG + this._veer * (1 - k);
    out.x = -speed * Math.sin(dir); out.y = 0; out.z = speed * Math.cos(dir);
    if (mean) return out;
    const s = this.roughness(agl);
    if (s > 1e-3) {
      const t = this.time, ux = out.x, uz = out.z;
      let gx = 0, gy = 0, gz = 0;
      for (const m of this.modes) {
        const v = m.amp * Math.sin(m.kx * (x - ux * t) + m.ky * agl + m.kz * (z - uz * t) + m.ph + m.rate * t);
        gx += v * m.ex; gy += v * m.ey; gz += v * m.ez;
      }
      const lid = sat(agl / 12);                    // the ground stops the air going down through it
      out.x += gx * s * 1.4; out.y += gy * s * 1.4 * lid; out.z += gz * s * 1.4;
    }
    return out;
  }
}

/** A few ready-made days. */
export const WEATHER_PRESETS = {
  'Calm, clear': { windSpeed: 0.5, gust: 0, aloftSpeed: 3, turbulence: 0.3, cloudCover: 0.1, rain: 0, oat: 15, dewpoint: 5, qnh: 101325 },
  'Fair, light wind': { windDir: 250, windSpeed: 3, gust: 0, aloftDir: 270, aloftSpeed: 8, turbulence: 1, cloudCover: 0.3, rain: 0, oat: 15, dewpoint: 8, qnh: 101600 },
  'Gusty crosswind': { windDir: 320, windSpeed: 6.5, gust: 4.5, aloftDir: 340, aloftSpeed: 15, turbulence: 1.3, cloudCover: 0.5, rain: 0, oat: 12, dewpoint: 6, qnh: 100400 },
  'Overcast, rain': { windDir: 200, windSpeed: 5, gust: 2, aloftDir: 220, aloftSpeed: 13, turbulence: 0.9, cloudCover: 1, rain: 0.7, oat: 9, dewpoint: 8, qnh: 99300 },
  'Cold, still morning': { windSpeed: 0.3, gust: 0, aloftSpeed: 4, turbulence: 0.2, cloudCover: 0.15, rain: 0, oat: -8, dewpoint: -10, qnh: 103200, hour: 8.5 },
  'Hot afternoon': { windDir: 110, windSpeed: 2.5, gust: 1.5, aloftDir: 140, aloftSpeed: 6, turbulence: 1.6, cloudCover: 0.35, rain: 0, oat: 31, dewpoint: 14, qnh: 100900, hour: 15.5 },
};
export const FT_PER_M = 1 / FT;
