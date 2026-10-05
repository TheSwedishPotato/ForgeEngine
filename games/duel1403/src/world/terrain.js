/**
 * The land around the lists: one height function used to build the terrain
 * meshes, to place trees, houses and the castle on them, and (in GLSL, via
 * the virtual texture) to paint it. Flat (y = 0) where the physics expects
 * flat ground: the lists, the stands and the pavilions.
 */

// The hills of the old scene, now real terrain: [x, z, radius, height]
export const HILLS = [[30, 230, 120, 55], [-160, 260, 140, 40], [210, 180, 110, 35], [-260, -120, 150, 45], [180, -260, 160, 50], [0, -320, 180, 38]];
export const VILLAGE = { x0: -72, x1: 72, z0: 58, z1: 142 };
export const FLAT_RADIUS = 35;
// The joust field south of the lists: a long level run with its stands.
export const JOUST_FIELD = { x0: -64, x1: 64, z0: -52, z1: -12 };
export function inJoustField(x, z, margin = 0) {
  return x > JOUST_FIELD.x0 - margin && x < JOUST_FIELD.x1 + margin && z > JOUST_FIELD.z0 - margin && z < JOUST_FIELD.z1 + margin;
}   // covers the whole fine patch (corner at 34 m)

function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, oct) { let s = 0, a = 0.5; for (let i = 0; i < oct; i++) { s += a * vnoise(x, z); x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; a *= 0.5; } return s; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Ground height (m) at world x, z. */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = 0;
  // rolling country beyond the tournament field
  const open = smooth(FLAT_RADIUS, FLAT_RADIUS + 45, r);
  h += open * ((fbm(x * 0.008, z * 0.008, 5) - 0.45) * 22 + (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 2.2);
  for (const [hx, hz, hr, hh] of HILLS) {
    const d = Math.hypot(x - hx, z - hz) / hr;
    if (d < 1) h += hh * Math.pow(1 - d * d, 1.6) * (0.85 + 0.3 * fbm(x * 0.03, z * 0.03, 3));
  }
  // the village sits on a levelled terrace
  const vx = smooth(VILLAGE.x0 - 25, VILLAGE.x0, x) * (1 - smooth(VILLAGE.x1, VILLAGE.x1 + 25, x));
  const vz = smooth(VILLAGE.z0 - 25, VILLAGE.z0, z) * (1 - smooth(VILLAGE.z1, VILLAGE.z1 + 25, z));
  h *= 1 - vx * vz;
  // and so does the joust field
  const jx = smooth(JOUST_FIELD.x0 - 22, JOUST_FIELD.x0, x) * (1 - smooth(JOUST_FIELD.x1, JOUST_FIELD.x1 + 22, x));
  const jz = smooth(JOUST_FIELD.z0 - 22, JOUST_FIELD.z0, z) * (1 - smooth(JOUST_FIELD.z1, JOUST_FIELD.z1 + 22, z));
  h *= 1 - jx * jz;
  return Math.max(h, -1.5);
}

/**
 * Fine relief of the tournament ground (centimetres): trodden humps, the
 * ruts of the carts that brought the stands. Fades to exactly zero at the
 * edge of the fine patch so it meets the landscape without a seam.
 */
export function microRelief(x, z, half) {
  const edge = Math.min(half - Math.abs(x), half - Math.abs(z));
  const fade = smooth(0, 3, edge);
  const r = Math.hypot(x, z);
  const inLists = 1 - smooth(5.5, 7.5, r);
  let h = (fbm(x * 0.9, z * 0.9, 4) - 0.5) * 0.035 + (fbm(x * 4.1, z * 4.1, 3) - 0.5) * 0.012;
  h *= 0.25 + 0.75 * (1 - inLists);            // the lists themselves are raked nearly level
  // cart ruts entering from the gate toward the stands
  const rut = (d) => -0.05 * Math.exp(-(d * d) / 0.02);
  const along = z - x * 0.35;
  if (x > 6 && x < 23) h += (rut(along - 1.0) + rut(along + 0.6)) * smooth(6, 9, x);
  return h * fade;
}
