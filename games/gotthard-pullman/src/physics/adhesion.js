/**
 * Wheel–rail adhesion (Amontons–Coulomb at the contact patch: F <= mu N).
 *
 * mu_max: Curtius–Kniffler's dry-rail curve, mu = 0.161 + 7.5 / (v + 44)
 * (v in km/h, German practice), scaled by the state of the rail head. Field
 * values: about 0.3 dry and 0.2 wet on average, as low as 0.05 with leaves or
 * oil; snow and ice sit between. Sand restores much of what water, snow and
 * ice take away, and does little on dry rail.
 *
 * Creep: the force rises almost linearly with the slip between wheel and rail
 * (micro-slip in the contact patch), peaks at about 1 % creep, then falls toward
 * the sliding (kinetic) level, about 60 % of the peak at full slip: static
 * friction gives way to kinetic friction once the wheel "lets go".
 */

export const RAIL = {
  dry: { factor: 1.0, label: 'dry' },
  frost: { factor: 0.72, label: 'hoar frost' },
  damp: { factor: 0.75, label: 'damp' },
  wet: { factor: 0.65, label: 'wet' },
  slush: { factor: 0.52, label: 'wet snow / slush' },
  snow: { factor: 0.45, label: 'compacted snow' },
  ice: { factor: 0.30, label: 'glaze ice' },
};

/** Dry-rail adhesion limit at speed v (m/s). */
export function curtiusKniffler(v) {
  const kmh = Math.abs(v) * 3.6;
  return 0.161 + 7.5 / (kmh + 44);
}

/**
 * Adhesion limit for an axle.
 * cond: RAIL entry; sand: 0..1 sand on the rail ahead of this wheel; cleaning:
 * 0..1 how much the wheels ahead have already cleaned the rail head.
 */
export function muMax(v, cond, sand = 0, cleaning = 0) {
  const dry = curtiusKniffler(v);
  let f = cond.factor + (1 - cond.factor) * Math.min(1, cleaning);
  // sand: crushed between wheel and rail it lifts poor adhesion toward ~85 % of dry
  if (sand > 0) f = f + (Math.max(f, 0.85) - f) * Math.min(1, sand);
  return dry * f;
}

const PEAK_CREEP = 0.010;     // creep at the adhesion peak
const KINETIC = 0.60;         // full-slip friction as a fraction of the peak

/** Normalised creep curve, peak 1 at PEAK_CREEP. */
export function creepShape(xi) {
  const a = Math.abs(xi) / PEAK_CREEP;
  // rising branch 2a/(1+a^2) peaks at a = 1; beyond the peak it decays to the kinetic level
  const s = a <= 1 ? (2 * a) / (1 + a * a) : KINETIC + (1 - KINETIC) * Math.exp(-(a - 1) / 3);
  return Math.sign(xi) * s;
}

/**
 * Longitudinal adhesion force for a wheelset (or a group of coupled wheelsets).
 * slipV: wheel surface speed minus train speed (m/s), v: train speed (m/s), N: normal load (N).
 * Returns force (N, along + travel) and d force / d slipV for implicit integration.
 */
export function adhesionForce(slipV, v, N, mu) {
  const ref = 0.04 + Math.abs(v) * PEAK_CREEP * 2;   // slip velocity scale (creep defined against speed, floored at standstill)
  const xi = slipV / ref * PEAK_CREEP;
  const F = mu * N * creepShape(xi);
  const e = 1e-4;
  const dF = (mu * N * (creepShape((slipV + e) / ref * PEAK_CREEP) - creepShape((slipV - e) / ref * PEAK_CREEP))) / (2 * e);
  return { F, dF, creep: xi };
}
