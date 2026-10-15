/**
 * Sea water: what the boat floats in, sinks through and pushes against.
 *
 *  - Density: the UNESCO International Equation of State of Seawater (EOS-80; Millero & Poisson
 *    1981, with the secant bulk modulus of Millero, Chen, Bradshaw & Schleicher 1980), checked
 *    against the published check values (Fofonoff & Millard, UNESCO Tech. Paper 44, 1983).
 *  - Viscosity: Sharqawy, Lienhard & Zubair (2010), for the Reynolds number of the hull.
 *  - Speed of sound: Mackenzie (1981).
 *  - Gravity at a latitude: the 1967 international gravity formula.
 *  - The water column at a place: temperature and salinity with depth (a mixed layer, a
 *    thermocline or halocline, the deep water), and the pressure found by integrating the
 *    density down from the surface (P = P_atm + integral of rho g dz), not by assuming
 *    1 atmosphere every 10 m.
 */
import { ATM, G } from './units.js';

/** Density of sea water (kg/m^3) at salinity S (PSU), temperature t (C), gauge pressure p (bar). */
export function rhoEOS80(S, t, p = 0) {
  const t2 = t * t, t3 = t2 * t, t4 = t3 * t, t5 = t4 * t;
  const rw = 999.842594 + 6.793952e-2 * t - 9.095290e-3 * t2 + 1.001685e-4 * t3 - 1.120083e-6 * t4 + 6.536332e-9 * t5;
  const S15 = S * Math.sqrt(S);
  const r0 = rw
    + S * (8.24493e-1 - 4.0899e-3 * t + 7.6438e-5 * t2 - 8.2467e-7 * t3 + 5.3875e-9 * t4)
    + S15 * (-5.72466e-3 + 1.0227e-4 * t - 1.6546e-6 * t2)
    + 4.8314e-4 * S * S;
  if (p === 0) return r0;
  const Kw = 19652.21 + 148.4206 * t - 2.327105 * t2 + 1.360477e-2 * t3 - 5.155288e-5 * t4;
  const K0 = Kw + S * (54.6746 - 0.603459 * t + 1.09987e-2 * t2 - 6.1670e-5 * t3) + S15 * (7.944e-2 + 1.6483e-2 * t - 5.3009e-4 * t2);
  const A = 3.239908 + 1.43713e-3 * t + 1.16092e-4 * t2 - 5.77905e-7 * t3 + S * (2.2838e-3 - 1.0981e-5 * t - 1.6078e-6 * t2) + 1.91075e-4 * S15;
  const B = 8.50935e-5 - 6.12293e-6 * t + 5.2787e-8 * t2 + S * (-9.9348e-7 + 2.0816e-8 * t + 9.1697e-10 * t2);
  const K = K0 + A * p + B * p * p;
  return r0 / (1 - p / K);
}

/** Dynamic viscosity of sea water (Pa s), t in C, S in PSU (Sharqawy et al. 2010). */
export function viscosity(t, S) {
  const muW = 4.2844e-5 + 1 / (0.157 * (t + 64.993) ** 2 - 91.296);
  const s = S / 1000;
  const A = 1.541 + 1.998e-2 * t - 9.52e-5 * t * t;
  const B = 7.974 - 7.561e-2 * t + 4.724e-4 * t * t;
  return muW * (1 + A * s + B * s * s);
}

/** Speed of sound in sea water (m/s), Mackenzie (1981): t C, S PSU, depth D m. */
export function soundSpeed(t, S, D) {
  return 1448.96 + 4.591 * t - 5.304e-2 * t * t + 2.374e-4 * t ** 3 + 1.340 * (S - 35) + 1.630e-2 * D + 1.675e-7 * D * D - 1.025e-2 * t * (S - 35) - 7.139e-13 * t * D ** 3;
}

/** Gravity at sea level at a latitude (degrees), 1967 international formula. */
export function gravityAt(lat) {
  const s = Math.sin(lat * Math.PI / 180), s2 = Math.sin(2 * lat * Math.PI / 180);
  return 9.780318 * (1 + 0.0053024 * s * s - 0.0000058 * s2 * s2);
}

/**
 * A water column: temperature and salinity against depth. A mixed layer of depth h at the
 * surface values, a layer (thermocline/halocline) of thickness w below it, then the deep values
 * with a slow further fall to depth. Tabulated every metre down to the bottom, with the in-situ
 * density and the absolute pressure (integrated), the viscosity and the speed of sound.
 */
export class WaterColumn {
  constructor({ tSurf, tDeep, tAbyss = tDeep - 2, sSurf, sDeep, mixed, layer, deepScale = 600, bottom = 1200, lat = 45, pAtm = ATM, name = '' }) {
    Object.assign(this, { tSurf, tDeep, tAbyss, sSurf, sDeep, mixed, layer, deepScale, bottom, lat, pAtm, name });
    this.g = gravityAt(lat);
    const n = Math.ceil(bottom) + 2;
    this.n = n;
    this.T = new Float64Array(n); this.S = new Float64Array(n); this.rho = new Float64Array(n);
    this.P = new Float64Array(n); this.c = new Float64Array(n); this.nu = new Float64Array(n);
    let p = pAtm;
    for (let i = 0; i < n; i++) {
      const T = this.tAt(i), S = this.sAt(i);
      this.T[i] = T; this.S[i] = S;
      // the density at this pressure (gauge, bar), then the next metre's pressure from it
      let rho = rhoEOS80(S, T, (p - pAtm) / 1e5);
      this.rho[i] = rho;
      this.P[i] = p;
      this.c[i] = soundSpeed(T, S, i);
      this.nu[i] = viscosity(T, S) / rho;
      // trapezoid toward the next metre: use the next metre's density at the mid pressure
      const Tn = this.tAt(i + 1), Sn = this.sAt(i + 1);
      const rhoN = rhoEOS80(Sn, Tn, (p + rho * this.g * 0.5 - pAtm) / 1e5);
      p += 0.5 * (rho + rhoN) * this.g;
    }
  }

  /** Temperature (C) at depth z (m below the surface). */
  tAt(z) {
    if (z <= this.mixed) return this.tSurf;
    const u = Math.min(1, (z - this.mixed) / this.layer);
    // a smooth step through the layer, then a slow fall toward the abyssal value
    const step = u * u * (3 - 2 * u);
    const below = Math.max(0, z - this.mixed - this.layer);
    const deep = this.tDeep + (this.tAbyss - this.tDeep) * (1 - Math.exp(-below / this.deepScale));
    return this.tSurf + (deep - this.tSurf) * step;
  }

  sAt(z) {
    if (z <= this.mixed) return this.sSurf;
    const u = Math.min(1, (z - this.mixed) / this.layer);
    return this.sSurf + (this.sDeep - this.sSurf) * u * u * (3 - 2 * u);
  }

  _lerp(arr, z) {
    if (z <= 0) return arr[0];
    const i = Math.min(this.n - 2, Math.floor(z)), f = Math.min(1, z - i);
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }

  /** Absolute pressure (Pa) at depth z (m below the still surface); above it, the air's. */
  pressureAt(z) {
    if (z <= 0) return this.pAtm;
    if (z >= this.n - 1) return this.P[this.n - 1] + this.rho[this.n - 1] * this.g * (z - this.n + 1);
    return this._lerp(this.P, z);
  }
  densityAt(z) { return this._lerp(this.rho, Math.max(0, z)); }
  temperatureAt(z) { return this._lerp(this.T, Math.max(0, z)); }
  salinityAt(z) { return this._lerp(this.S, Math.max(0, z)); }
  soundAt(z) { return this._lerp(this.c, Math.max(0, z)); }
  kinematicViscosityAt(z) { return this._lerp(this.nu, Math.max(0, z)); }
}

export { G };
