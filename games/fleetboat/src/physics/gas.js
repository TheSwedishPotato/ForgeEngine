/**
 * Air and the gases in it.
 *
 *  - The ideal gas law pV = nRT (Boyle's law at constant temperature, Charles' and Gay-Lussac's
 *    with it) for the air in the ballast tanks, the banks, the boat, the accumulator.
 *    A flask at 3000 psi departs from it a little (Z about 1.04 at 207 bar and 20 C); the
 *    compressibility factor below takes that into account for the banks.
 *  - Flow through a valve or an orifice: compressible (subsonic, or choked at the critical
 *    pressure ratio 0.528 for air) for air, Bernoulli/Torricelli for water.
 *  - Dalton's law: each gas's partial pressure is its mole fraction times the total.
 *  - Henry's law: the gas dissolved in water (and in the crew's blood and tissues) is in
 *    proportion to its partial pressure, with van 't Hoff's temperature dependence.
 */
import { R_GAS, M_AIR, R_AIR, GAMMA_AIR, ATM, K0 } from './units.js';

/** Moles of an ideal gas. */
export const moles = (p, V, T) => (p * V) / (R_GAS * T);
/** Pressure of n moles in V at T. */
export const pressure = (n, V, T) => (n * R_GAS * T) / V;

/**
 * Compressibility factor of air at pressure p (Pa) and T (K): a second-virial fit good to about
 * 0.5 % up to 300 bar at room temperatures (B(T) of air: -7.4 cm^3/mol at 290 K rising through
 * zero near the Boyle temperature 347 K; a third coefficient for the repulsion at high pressure).
 */
export function zAir(p, T) {
  const B = (-7.4e-6) + (T - 290) * 1.3e-7;          // m^3/mol
  const C = 1.4e-9;                                    // m^6/mol^2
  const rhoN = p / (R_GAS * T);                        // first estimate of mol/m^3
  return 1 + B * rhoN + C * rhoN * rhoN;
}

/** Moles of air in a flask of volume V at p and T, with the compressibility factor. */
export const molesReal = (p, V, T) => (p * V) / (zAir(p, T) * R_GAS * T);
/** Pressure of n moles of air in V at T (solved for Z by iteration). */
export function pressureReal(n, V, T) {
  let p = pressure(n, V, T);
  for (let i = 0; i < 4; i++) p = (n * zAir(p, T) * R_GAS * T) / V;
  return p;
}

const CRIT = Math.pow(2 / (GAMMA_AIR + 1), GAMMA_AIR / (GAMMA_AIR - 1));    // 0.528
const CHOKE = Math.sqrt(GAMMA_AIR / R_AIR) * Math.pow(2 / (GAMMA_AIR + 1), (GAMMA_AIR + 1) / (2 * (GAMMA_AIR - 1)));

/**
 * Mass flow of air (kg/s) through an opening of effective area CdA (m^2) from pu (Pa, Tu K) to
 * pd. Positive from up to down; call with the pressures the other way round for reverse flow.
 */
export function airMassFlow(CdA, pu, Tu, pd) {
  if (CdA <= 0 || pu <= pd) return 0;
  const r = pd / pu;
  if (r <= CRIT) return CdA * pu * CHOKE / Math.sqrt(Tu);
  const g = GAMMA_AIR;
  return CdA * pu * Math.sqrt((2 * g) / ((g - 1) * R_AIR * Tu) * (Math.pow(r, 2 / g) - Math.pow(r, (g + 1) / g)));
}

/** Molar flow of air (mol/s), either direction: + from a to b. */
export function airMolarFlow(CdA, pa, Ta, pb, Tb) {
  return pa >= pb ? airMassFlow(CdA, pa, Ta, pb) / M_AIR : -airMassFlow(CdA, pb, Tb, pa) / M_AIR;
}

/** Volume flow of water (m^3/s) through CdA under a pressure difference dp (Pa), signed. */
export function waterFlow(CdA, dp, rho) {
  if (CdA <= 0 || dp === 0) return 0;
  return Math.sign(dp) * CdA * Math.sqrt((2 * Math.abs(dp)) / rho);
}

/**
 * Linearised water flow through an orifice for small pressure differences: the square root's
 * infinite slope at zero makes an explicit integrator chatter, so below dpLin the flow is taken
 * proportional to dp (same flow at dpLin).
 */
export function waterFlowSmooth(CdA, dp, rho, dpLin = 200) {
  if (CdA <= 0) return 0;
  const a = Math.abs(dp);
  if (a >= dpLin) return Math.sign(dp) * CdA * Math.sqrt((2 * a) / rho);
  return (dp / dpLin) * CdA * Math.sqrt((2 * dpLin) / rho);
}

// ---- Dalton and Henry ----------------------------------------------------------------------

/** Dry air by volume (mole fraction). */
export const AIR_COMPOSITION = { N2: 0.78084, O2: 0.20946, Ar: 0.00934, CO2: 0.00042 };

/** Partial pressures (Pa) of a mixture { gas: moles } at total pressure p. */
export function partialPressures(mix, p) {
  let n = 0;
  for (const k in mix) n += mix[k];
  const out = {};
  for (const k in mix) out[k] = n > 0 ? (mix[k] / n) * p : 0;
  return out;
}

/**
 * Henry's law constants (solubility in water, mol/(m^3 Pa)) at 25 C and their van 't Hoff
 * temperature coefficients d(ln kH)/d(1/T) in K (Sander 2015 compilation, rounded).
 */
const HENRY = {
  O2: { kH: 1.3e-5, dT: 1500 },
  N2: { kH: 6.4e-6, dT: 1300 },
  CO2: { kH: 3.3e-4, dT: 2400 },
  H2: { kH: 7.8e-6, dT: 530 },
};

/** Concentration (mol/m^3) of a gas dissolved in water at its partial pressure pp (Pa) and t (C). */
export function dissolved(gas, pp, t = 25) {
  const h = HENRY[gas];
  const T = t + K0;
  return h.kH * Math.exp(h.dT * (1 / T - 1 / 298.15)) * pp;
}

export { ATM, R_GAS, M_AIR, R_AIR };
