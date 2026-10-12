/**
 * Water and steam properties for the boiler and cylinders.
 *
 * Saturated water/steam from the IAPWS-IF97 steam tables (0.5–20 bar),
 * linearly interpolated in pressure; superheated steam as a real gas with
 * a mean specific heat and compressibility, adequate for 1–20 bar and up to
 * about 400 °C (the C 5/6 superheats to roughly 300–350 °C).
 */

// p [bar abs], T_sat [°C], v_f [m³/kg], v_g [m³/kg], h_f [kJ/kg], h_fg [kJ/kg]
const SAT = [
  [0.5, 81.33, 0.001030, 3.2400, 340.5, 2305.4],
  [1.0, 99.61, 0.001043, 1.6940, 417.5, 2257.5],
  [1.5, 111.35, 0.001053, 1.1594, 467.1, 2226.0],
  [2.0, 120.21, 0.001061, 0.8857, 504.7, 2201.6],
  [3.0, 133.52, 0.001073, 0.6058, 561.4, 2163.4],
  [4.0, 143.61, 0.001084, 0.4624, 604.7, 2133.4],
  [5.0, 151.83, 0.001093, 0.3748, 640.1, 2107.4],
  [6.0, 158.83, 0.001101, 0.3156, 670.4, 2085.8],
  [7.0, 164.95, 0.001108, 0.2728, 697.0, 2065.8],
  [8.0, 170.41, 0.001115, 0.2403, 720.9, 2047.5],
  [9.0, 175.35, 0.001121, 0.2149, 742.6, 2030.5],
  [10.0, 179.88, 0.001127, 0.1944, 762.5, 2014.6],
  [11.0, 184.06, 0.001133, 0.1774, 781.0, 1999.6],
  [12.0, 187.96, 0.001139, 0.1632, 798.3, 1985.4],
  [13.0, 191.60, 0.001144, 0.1512, 814.6, 1971.9],
  [14.0, 195.04, 0.001149, 0.1408, 830.1, 1958.9],
  [15.0, 198.29, 0.001154, 0.1317, 844.6, 1946.4],
  [16.0, 201.37, 0.001159, 0.1237, 858.5, 1934.4],
  [17.0, 204.31, 0.001163, 0.1167, 871.8, 1922.7],
  [18.0, 207.11, 0.001168, 0.1104, 884.5, 1911.3],
  [20.0, 212.38, 0.001177, 0.0996, 908.6, 1889.8],
];

export const R_STEAM = 461.5;     // J/(kg K)
export const CP_SUPER = 2.25e3;   // J/(kg K), mean over 1–20 bar, saturation to 350 °C
export const P_ATM = 1.01325;     // bar

function row(p) {
  if (p <= SAT[0][0]) return [SAT[0], SAT[0], 0];
  for (let i = 1; i < SAT.length; i++) {
    if (p <= SAT[i][0]) {
      const a = SAT[i - 1], b = SAT[i];
      return [a, b, (p - a[0]) / (b[0] - a[0])];
    }
  }
  const a = SAT[SAT.length - 2], b = SAT[SAT.length - 1];
  return [a, b, (p - a[0]) / (b[0] - a[0])];
}
const lerpCol = (p, c) => { const [a, b, t] = row(p); return a[c] + (b[c] - a[c]) * t; };

/** Saturation temperature, °C. */
export const tSat = (p) => lerpCol(p, 1);
/** Specific volume of saturated water / steam, m³/kg. */
export const vf = (p) => lerpCol(p, 2);
export const vg = (p) => { const [a, b, t] = row(p); return Math.exp(Math.log(a[3]) + (Math.log(b[3]) - Math.log(a[3])) * t); };
/** Enthalpies, J/kg. */
export const hf = (p) => lerpCol(p, 4) * 1e3;
export const hfg = (p) => lerpCol(p, 5) * 1e3;
export const hg = (p) => hf(p) + hfg(p);
/** d h_f / d p, J/(kg bar): how much the saturated water's enthalpy changes per bar. */
export function dhfdp(p) { const e = 0.05; return (hf(p + e) - hf(p - e)) / (2 * e); }
/** Saturation pressure at a temperature (°C), bar, by bisection on the table. */
export function pSat(T) {
  let lo = 0.5, hi = 20;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (tSat(m) < T) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** Density of steam at p (bar) and T (°C); saturated if T at or below T_sat. */
export function rhoSteam(p, T) {
  const ts = tSat(p);
  if (T <= ts + 0.5) return 1 / vg(p);
  // real-gas correction: compressibility rises from the saturated value toward 1 with superheat
  const Zsat = (p * 1e5 * vg(p)) / (R_STEAM * (ts + 273.15));
  const Z = 1 - (1 - Zsat) * Math.exp(-(T - ts) / 80);
  return (p * 1e5) / (Z * R_STEAM * (T + 273.15));
}
/** Enthalpy of steam at p, T (°C), J/kg. */
export function hSteam(p, T) {
  const ts = tSat(p);
  return hg(p) + CP_SUPER * Math.max(0, T - ts);
}
/** Liquid water enthalpy at temperature T (°C), J/kg (sub-cooled, cp 4.19 kJ/kgK). */
export const hWater = (T) => 4186 * T;
