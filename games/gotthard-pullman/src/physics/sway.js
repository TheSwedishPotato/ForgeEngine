/**
 * How a car body rides on its springs: what a passenger feels in the seat.
 *
 * The track is never perfect. Its irregularities are generated from the spectra used for
 * vehicle-dynamics work (a rational PSD of the FRA/ERRI form, S(k) = A kc^2 / ((k^2 + kr^2)(k^2 + kc^2)),
 * for good main-line track): alignment and level a few millimetres over wavelengths of 3 to 70 m,
 * cross-level a millimetre or two. Each truck reads them where it stands (the rear truck the same
 * track a moment later), and the body answers on its secondary suspension as three coupled-enough
 * oscillators:
 *   lateral/roll sway  ~0.8 Hz, damping ratio 0.15  (also pushed by the curve's unbalanced acceleration
 *                                                    v^2/R - g * cant / track gauge, which leans the body out)
 *   bounce             ~1.2 Hz, damping ratio 0.2
 *   pitch              ~1.5 Hz, damping ratio 0.2
 * Heavyweight cars on six-wheel trucks were known for a soft, slow ride; these numbers follow that.
 * Every car gets its own phase of the same track (it runs over it at its own time).
 */
const G = 9.80665;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** A track irregularity signal along s: a sum of sinusoids with a PSD-shaped amplitude. */
export class Irregularity {
  constructor(seed, { A = 1.5e-7, kc = 0.8246, kr = 0.0206, n = 48, lmin = 2.5, lmax = 90 } = {}) {
    const r = rng(seed);
    this.k = new Float64Array(n); this.a = new Float64Array(n); this.ph = new Float64Array(n);
    const k0 = (2 * Math.PI) / lmax, k1 = (2 * Math.PI) / lmin;
    for (let i = 0; i < n; i++) {
      // log-spaced wavenumbers (rad/m), each carrying the PSD's power over its band
      const ka = k0 * Math.pow(k1 / k0, i / n), kb = k0 * Math.pow(k1 / k0, (i + 1) / n);
      const k = Math.sqrt(ka * kb) * (1 + (r() - 0.5) * 0.05);
      const S = (A * kc * kc) / ((k * k + kr * kr) * (k * k + kc * kc));   // m^2 / (rad/m)
      this.k[i] = k; this.a[i] = Math.sqrt(2 * S * (kb - ka)); this.ph[i] = r() * 2 * Math.PI;
    }
  }
  at(s) { let y = 0; for (let i = 0; i < this.k.length; i++) y += this.a[i] * Math.sin(this.k[i] * s + this.ph[i]); return y; }
}

const TRACK = {
  align: new Irregularity(11, { A: 2.4e-7 }),
  level: new Irregularity(23, { A: 2.6e-7 }),
  cross: new Irregularity(37, { A: 0.45e-7, lmin: 3, lmax: 40 }),
};
export { TRACK };

/** Second-order oscillator state: x'' + 2 zeta w x' + w^2 x = w^2 u (u: the input it follows). */
class Osc {
  constructor(f, zeta) { this.w = 2 * Math.PI * f; this.z = zeta; this.x = 0; this.v = 0; this.a = 0; }
  step(dt, u) {
    // semi-implicit
    this.a = this.w * this.w * (u - this.x) - 2 * this.z * this.w * this.v;
    this.v += this.a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export class CarRide {
  constructor({ truck = 9.0, height = 1.9 } = {}) {
    this.truck = truck;        // half the truck-centre distance (m)
    this.height = height;      // the body's centre of mass above the rail (m)
    this.lat = new Osc(0.8, 0.15);
    this.roll = new Osc(0.8, 0.15);
    this.bounce = new Osc(1.2, 0.2);
    this.pitch = new Osc(1.5, 0.2);
    this.felt = { lat: 0, vert: 0, lon: 0 };      // m/s^2 at the seat (body frame), for the passenger
  }

  /**
   * One step for a car whose middle is at chainage s, running at v (m/s) with longitudinal
   * acceleration a, on a line of curvature k (1/m, + right) and cant c (m).
   */
  step(dt, s, v, a, k, c) {
    const T = this.truck;
    const sf = s + T, sr = s - T;
    // what the trucks feel of the track (lateral and vertical, m), and its cross-level (rad)
    const yl = (TRACK.align.at(sf) + TRACK.align.at(sr)) / 2;
    const zl = (TRACK.level.at(sf) + TRACK.level.at(sr)) / 2;
    const pz = (TRACK.level.at(sf) - TRACK.level.at(sr)) / (2 * T);
    const cl = ((TRACK.cross.at(sf) + TRACK.cross.at(sr)) / 2) / 1.5;
    // the curve: the unbalanced lateral acceleration (toward the curve's inside, + right) throws the
    // body out on its springs, about 1.2 cm and 0.26 degrees per m/s^2: out is left in a right-hand
    // curve, and the body's roll (+ right side down) leans it onto its outer side
    const aUnbal = v * v * k - G * (c / 1.5);          // (the cant carries the curve's sign)
    const x = this.lat.step(dt, yl - aUnbal * 0.012);
    const r = this.roll.step(dt, cl - aUnbal * 0.0045);
    const z = this.bounce.step(dt, zl);
    const p = this.pitch.step(dt, pz);
    // what the passenger feels: the body's own accelerations plus the curve's unbalanced pull and the train's surge
    this.felt.lat = aUnbal + this.lat.a + this.roll.a * 1.2;
    this.felt.vert = this.bounce.a + this.pitch.a * 2;
    this.felt.lon = a;
    return { lateral: x, vertical: z, roll: r, pitch: p };
  }
}
