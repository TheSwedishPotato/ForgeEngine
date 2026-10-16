/**
 * The propellers: two solid four-bladed manganese bronze screws, 7.791 ft across, design pitch
 * 8.812 ft (P/D 1.13), turning 280 rpm at full power (General Information Book A-1). The
 * starboard screw is right-handed, the port left-handed, so their torques cancel.
 *
 * Open-water characteristics: thrust T = KT rho n^2 D^4, torque Q = KQ rho n^2 D^5, with KT and
 * KQ functions of the advance ratio J = Va / (n D). The curves are a quadratic fit to the
 * Wageningen B-series chart for B4-55 at P/D 1.1 (Oosterveld & van Oossanen 1975), read at J =
 * 0, 0.4, 0.6, 0.8, 1.0, 1.2. They give the yard's design point: 2,700 shp a shaft at 280 rpm
 * driving the boat at 20 1/4 knots (tests/physics.test.js). Va = V (1 - w), the wake fraction
 * w and the thrust deduction t are estimates for a twin-screw fleet boat.
 *
 * Backing, or turning ahead while the boat goes astern, is the other three quadrants: a simple
 * four-quadrant model by the hydrodynamic pitch angle beta = atan(Va / (0.7 pi n D)), with
 * the thrust and torque coefficients C_T*, C_Q* as smooth functions of beta that match the
 * open-water curve in the first quadrant (after the shape of the Wageningen four-quadrant data).
 */
import { PROPELLER } from '../data/boat.js';

export const D = PROPELLER.dia;
export const WAKE = 0.085, THRUST_DEDUCTION = 0.12;

// KT(J), KQ(J): fitted to B4-55, P/D 1.1:  J: 0, .4, .6, .8, 1.0, 1.2 ->
//   KT 0.44, 0.35, 0.29, 0.22, 0.14, 0.05;  10KQ 0.80, 0.68, 0.59, 0.48, 0.36, 0.22
const KT_C = [0.4400, -0.1750, -0.1250];
const KQ_C = [0.08010, -0.02207, -0.02202];
export const KT = (J) => KT_C[0] + KT_C[1] * J + KT_C[2] * J * J;
// the torque coefficient scaled to the yard's design point (2,700 shp a shaft at 280 rpm and
// 20 1/4 knots): the chart-read B4-55 curve asks about 9 % more torque than this screw took
export const KQ_SCALE = 0.91;
export const KQ = (J) => KQ_SCALE * (KQ_C[0] + KQ_C[1] * J + KQ_C[2] * J * J);
export const J0 = (() => { const [a, b, c] = KT_C; return (-b - Math.sqrt(b * b - 4 * c * a)) / (2 * c); })();   // zero thrust

/**
 * Thrust (N, + ahead) and torque (N m, the load on the shaft, + opposing ahead rotation) at
 * rotation n (rev/s, + ahead) with the water arriving at Va (m/s, + from ahead), density rho.
 */
export function propForces(n, Va, rho) {
  const nD = Math.abs(n) * D;
  if (Math.abs(n) < 1e-3) {
    // a locked or trailing screw: a little drag from the blades
    const drag = 0.5 * rho * Math.PI * (D / 2) ** 2 * 0.06 * Va * Math.abs(Va);
    return { T: -drag, Q: 0, J: Infinity };
  }
  if (n > 0 && Va >= 0) {
    const J = Va / nD;
    // beyond zero thrust the screw windmills; keep the curves' slope, bounded
    const Jc = Math.min(J, 1.6);
    return { T: KT(Jc) * rho * n * n * D ** 4, Q: KQ(Jc) * rho * n * n * D ** 5, J };
  }
  // the other quadrants: by the hydrodynamic pitch angle beta (degrees)
  const beta = Math.atan2(Va, 0.7 * Math.PI * n * D);          // -180..180
  const Vr2 = Va * Va + (0.7 * Math.PI * n * D) ** 2;
  const A0 = Math.PI * D * D / 4;
  const { ct, cq } = fourQuadrant(beta);
  return { T: ct * 0.5 * rho * Vr2 * A0, Q: cq * 0.5 * rho * Vr2 * A0 * D, J: Va / nD };
}

/**
 * C_T*(beta), C_Q*(beta) relative to their values at beta = 0 (the bollard pull ahead, from the
 * open-water curve): a table after the shape of the Wageningen four-quadrant data (B4-70,
 * Roddy, Hess & Faller 2006). Astern bollard pull about 70 % of ahead; crash-back (turning
 * astern while still going ahead) the strongest; a stopped screw a little drag.
 */
const BETA = [-180, -135, -110, -90, -45, 0, 30, 90, 135, 180];
const CT_REL = [-0.72, -0.40, 0.0, 0.22, 0.75, 1.0, 0.0, -0.22, -1.05, -0.72];
const CQ_REL = [-0.75, -0.45, -0.05, 0.05, 0.75, 1.0, 0.1, -0.05, -1.05, -0.75];
function fourQuadrant(beta) {
  const k = 8 / (Math.PI * (0.7 * Math.PI) ** 2);            // KT -> C_T* at J = 0
  const b = beta * 180 / Math.PI;
  let i = 0;
  while (i < BETA.length - 2 && BETA[i + 1] < b) i++;
  const f = Math.max(0, Math.min(1, (b - BETA[i]) / (BETA[i + 1] - BETA[i])));
  return {
    ct: KT(0) * k * (CT_REL[i] + (CT_REL[i + 1] - CT_REL[i]) * f),
    cq: KQ(0) * k * (CQ_REL[i] + (CQ_REL[i + 1] - CQ_REL[i]) * f),
  };
}

/** Open-water efficiency at J. */
export const eta0 = (J) => (J * KT(J)) / (2 * Math.PI * KQ(J));
