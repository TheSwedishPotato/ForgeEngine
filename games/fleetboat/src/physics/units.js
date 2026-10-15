/**
 * Units. The physics runs in SI (m, kg, s, Pa, K, J, W); the boat's records are in the
 * units of a 1943 navy yard (feet and inches, pounds, long tons, US gallons, psi), and the
 * gauges read what the real ones read (feet of sea water, psi, inches of mercury, knots).
 */
export const FT = 0.3048;
export const IN = 0.0254;
export const LB = 0.45359237;               // kg
export const LONG_TON = 2240 * LB;          // 1016.047 kg
export const GAL = 3.785411784e-3;          // US gallon, m^3
export const FT3 = FT * FT * FT;            // 0.0283168 m^3
export const PSI = 6894.757;                // Pa
export const ATM = 101325;                  // Pa
export const INHG = 3386.389;               // Pa
export const KNOT = 1852 / 3600;            // m/s
export const HP = 745.6999;                 // W (mechanical horsepower)
export const G = 9.80665;                   // standard gravity, m/s^2
export const R_GAS = 8.314462618;           // J/(mol K)
export const M_AIR = 0.0289647;             // kg/mol, dry air
export const R_AIR = R_GAS / M_AIR;         // 287.05 J/(kg K)
export const GAMMA_AIR = 1.4;
export const K0 = 273.15;

/**
 * The navy's sea water for tonnage: 35 cubic feet to the long ton (64 lb per cubic foot),
 * 1025.2 kg/m^3. The tank capacities "tons S.W." and the depth gauges' calibration use it.
 */
export const RHO_NAVY = LONG_TON / (35 * FT3);

export const fToC = (f) => (f - 32) * 5 / 9;
export const cToF = (c) => c * 9 / 5 + 32;
export const ft = (x) => x * FT;
export const inch = (x) => x * IN;
/** feet and inches, e.g. ftin(15, 3.25) for 15'-3 1/4". */
export const ftin = (f, i = 0) => (f + i / 12) * FT;
export const tons = (t) => t * LONG_TON;
export const psi = (p) => p * PSI;
export const toPsi = (pa) => pa / PSI;
export const toFt = (m) => m / FT;
export const toKnots = (ms) => ms / KNOT;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
