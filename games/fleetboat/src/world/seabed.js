/**
 * The sea floor off Oahu's leeward (Waianae) coast: the fringing reef close in, a sandy shelf
 * sloping from 30 to 80 metres a few kilometres out, then the island's flank dropping away to
 * the abyss (the bathymetry's broad shape; the detail is invented: patch reefs and coral heads on
 * the shelf, sand ripples, boulders on the slope).
 *
 * World coordinates: X east, Z south, metres from the start point; the coast runs north-south
 * about 2.6 km to the east. depth() is positive downward from the mean surface.
 */

function hash(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, o = 5) {
  let s = 0, a = 0.5;
  for (let k = 0; k < o; k++) { s += a * noise(x, z); x = x * 2.03 + 17.1; z = z * 2.03 - 9.7; a *= 0.5; }
  return s;
}

export const COAST_X = 2600;

/** The broad profile: depth (m) by distance offshore (m). */
function profile(off) {
  if (off < 0) return -2;
  if (off < 250) return 1 + off * 0.04;                       // the reef flat
  if (off < 700) return 11 + (off - 250) * 0.042;             // the reef slope
  if (off < 2400) return 30 + (off - 700) * 0.027;            // the sand shelf
  if (off < 4200) return 76 + (off - 2400) * 0.12;            // the shelf break
  return 292 + (off - 4200) * 0.28;                            // the island's flank
}

export class Seabed {
  constructor({ seed = 3 } = {}) { this.seed = seed; }

  /** Depth of the bottom (m) at world X, Z. */
  depth(X, Z) {
    // the coast wanders a little
    const coast = COAST_X + 300 * (fbm(Z * 0.0006, 3.1, 3) - 0.5);
    const off = coast - X;
    let d = profile(off);
    // patch reefs and coral heads on the shelf (shallower than the sand around them)
    const shelf = Math.max(0, 1 - Math.abs(d - 45) / 35);
    const reef = Math.max(0, fbm(X * 0.012, Z * 0.012, 4) - 0.55) * 18 * shelf;
    const heads = Math.max(0, noise(X * 0.09, Z * 0.09) - 0.78) * 14 * shelf;
    // sand ripples, and the rougher rock of the slope
    const ripple = 0.08 * Math.sin(X * 0.9 + Z * 0.3 + 3 * noise(X * 0.05, Z * 0.05));
    const rough = (fbm(X * 0.04, Z * 0.04, 3) - 0.5) * (d > 80 ? 6 : 2);
    return d - reef - heads + ripple + rough;
  }

  /** What the bottom is made of here: 0 sand, 1 rock or reef. */
  kind(X, Z) {
    const coast = COAST_X + 300 * (fbm(Z * 0.0006, 3.1, 3) - 0.5);
    const d = profile(coast - X);
    const shelf = Math.max(0, 1 - Math.abs(d - 45) / 35);
    const reef = Math.max(0, fbm(X * 0.012, Z * 0.012, 4) - 0.55) * 18 * shelf + Math.max(0, noise(X * 0.09, Z * 0.09) - 0.78) * 14 * shelf;
    return Math.min(1, reef / 2 + (d > 90 ? 0.5 : 0));
  }
}

export { fbm, noise };
