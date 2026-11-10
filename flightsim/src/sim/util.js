/**
 * Units and small maths shared by the simulation. Everything inside the sim is SI (m, kg, s, N, Pa, K, rad);
 * these constants convert at the edges (gauges, the pilot's handbook numbers in the tests).
 *
 * Axes. World: +X east, +Y up, +Z south (so north is -Z). Aircraft body: +X right wing, +Y up, +Z aft (the nose is -Z).
 * That is the engine's own convention (a camera looks down -Z), so the pilot's eye needs no extra rotation.
 * Body rotation rates: +x pitches the nose up, +y yaws the nose left, +z rolls left.
 */
export const KT = 0.514444, FT = 0.3048, NM = 1852, LB = 0.45359237, LBF = 4.4482216, INHG = 3386.389, PSI = 6894.757;
export const GAL = 3.785411784e-3, HP = 745.69987, DEG = Math.PI / 180, G0 = 9.80665, RPM = Math.PI / 30;
export const AVGAS = 719.0;              // kg/m3 (6.0 lb per US gallon)
export const R_AIR = 287.053, GAMMA = 1.4;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** The fraction of the way a first-order lag of time constant `tau` moves in `dt`. */
export const lag = (dt, tau) => 1 - Math.exp(-dt / Math.max(tau, 1e-6));
export const wrap360 = (d) => ((d % 360) + 360) % 360;
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };
export const cToF = (c) => c * 1.8 + 32;

/** Piecewise-linear lookup; clamps outside the table. */
export function table(xs, ys, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
}

/** A small seeded random generator (mulberry32), so a flight can be repeated exactly. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- vectors are plain { x, y, z }; quaternions { x, y, z, w } (the engine's Vector3 and Quaternion fit too)
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export function cross(o, a, b) {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  o.x = x; o.y = y; o.z = z; return o;
}
/** o = q * v (body to world when q is the aircraft's attitude). */
export function qrot(o, q, v) {
  const { x, y, z, w } = q, vx = v.x, vy = v.y, vz = v.z;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  o.x = vx + w * tx + (y * tz - z * ty);
  o.y = vy + w * ty + (z * tx - x * tz);
  o.z = vz + w * tz + (x * ty - y * tx);
  return o;
}
/** o = q^-1 * v (world to body). */
export function qrotInv(o, q, v) {
  const x = -q.x, y = -q.y, z = -q.z, w = q.w, vx = v.x, vy = v.y, vz = v.z;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  o.x = vx + w * tx + (y * tz - z * ty);
  o.y = vy + w * ty + (z * tx - x * tz);
  o.z = vz + w * tz + (x * ty - y * tx);
  return o;
}
/** Attitude from heading (deg true), pitch and bank (deg; right wing down is positive). */
export function quatFromHPB(hdg, pitch = 0, bank = 0) {
  const mul = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  const ax = (x, y, z, a) => { const s = Math.sin(a / 2); return { x: x * s, y: y * s, z: z * s, w: Math.cos(a / 2) }; };
  return mul(mul(ax(0, 1, 0, -hdg * DEG), ax(1, 0, 0, pitch * DEG)), ax(0, 0, 1, -bank * DEG));
}
