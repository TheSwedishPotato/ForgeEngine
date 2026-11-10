/**
 * The aeroplane's numbers: a Cessna 172P Skyhawk (1981-86). Dimensions, areas, control travels, weights and limits are the
 * type's own (type certificate data sheet 3A12 and the pilot's operating handbook); section data is NACA 2412 for the wing and
 * a thin symmetric section for the tail.
 *
 * Structural coordinates, metres: x to the right, y up from the ground the aeroplane stands on, z aft of the firewall.
 */
import { DEG, LB, lerp } from './util.js';
import { Section } from './aero.js';

export const LIMITS = {
  vne: 158, vno: 127, va: 99, vfe: 85, vfe10: 110, vs0: 33, vs1: 44,          // KIAS
  rpmRed: 2700, mtow: 2400 * LB, flapsDeg: 30,
};

export function c172Config() {
  const wingSec = new Section({ a0: 6.05, aL0: -2.1 * DEG, clmax: 1.70, clmin: -1.1, cd0: 0.0072, cd2: 0.018, clMinD: 0.25, cm0: -0.047, w: 1.9 * DEG });
  const tailSec = new Section({ a0: 5.9, aL0: 0, clmax: 1.15, clmin: -1.15, cd0: 0.0078, cd2: 0.009, w: 2.2 * DEG });

  // wing: 11.0 m span, 1.63 m chord to the flap/aileron break, tapering to 1.13 m; 1.73 deg dihedral; 3 deg of washout
  const half = 5.5, brk = 2.65;
  const xs = [0, 0.55, 1.25, 1.95, 2.65, 3.30, 3.95, 4.55, 5.00, 5.50];
  const wingAt = (x) => {
    const ax = Math.abs(x);
    return { p: [x, 2.0 + ax * Math.tan(1.73 * DEG), 1.02], chord: ax <= brk ? 1.63 : lerp(1.63, 1.13, (ax - brk) / (half - brk)), inc: (1.5 - 3.0 * ax / half) * DEG };
  };
  const wing = {
    name: 'wing', section: wingSec, fuselageUpwash: { radius: 0.6, height: 0.75 },
    stations: [...xs.slice(1).reverse().map((x) => wingAt(-x)), ...xs.map(wingAt)],
    controls(s) {
      const ax = Math.abs(s.pos.x);
      if (ax > 0.55 && ax < brk) { s.ctrl = 1; s.cf = 0.30; s.slot = true; }                 // single-slotted flaps
      else if (ax > brk && ax < 5.0) { s.ctrl = s.pos.x < 0 ? 2 : 3; s.cf = 0.21; }           // ailerons
    },
  };
  // tailplane: 3.45 m span, 3.35 m2 with the elevator (40 % of the chord)
  const hx = [-1.725, -1.15, -0.575, 0, 0.575, 1.15, 1.725];
  const htail = {
    name: 'tailplane', section: tailSec,
    stations: hx.map((x) => ({ p: [x, 1.50, 5.80], chord: lerp(1.14, 0.80, Math.abs(x) / 1.725), inc: -2.2 * DEG })),
    controls(s) { s.ctrl = 4; s.cf = 0.40; },
  };
  // fin and rudder: 1.73 m2, swept
  const fy = [2.72, 2.30, 1.85, 1.35];
  const fin = {
    name: 'fin', section: tailSec,
    stations: fy.map((y) => { const t = (y - 1.35) / 1.37; return { p: [0, y, lerp(5.55, 6.35, t)], chord: lerp(1.65, 0.80, t), inc: 0 }; }),
    controls(s) { s.ctrl = 5; s.cf = 0.40; },
  };
  const P = (x, y, z) => ({ x, y, z });
  return {
    refArea: 16.17, span: 11.0, mac: 1.494,
    surfaces: [wing, htail, fin],
    hornStrip: 5,                                   // the stall-warning opening is in the left wing's leading edge
    // drag areas (m2) of the parts that are not wings, where they are
    bodies: [
      { p: P(0, 1.2, 1.6), f: 0.130 },              // fuselage skin and base
      { p: P(0, 1.25, -0.4), f: 0.045 },            // cooling air through the cowl
      { p: P(0, 0.35, -0.17), f: 0.032 },           // nose leg and wheel
      { p: P(-1.1, 0.4, 1.48), f: 0.042 }, { p: P(1.1, 0.4, 1.48), f: 0.042 },      // main legs and wheels
      { p: P(-1.5, 1.3, 1.05), f: 0.022 }, { p: P(1.5, 1.3, 1.05), f: 0.022 },      // wing struts
      { p: P(0, 1.9, 1.0), f: 0.040 },              // aerials, steps, gaps
    ],
    fuselage: {
      volume: 5.0, kYaw: 1.0, kPitch: 0.45, side: 1.2, cdc: 0.8, centre: P(0, 1.25, 1.3),
      stations: [{ p: P(0, 1.2, -0.5), side: 0.9, plan: 0.9 }, { p: P(0, 1.3, 1.5), side: 2.6, plan: 2.4 }, { p: P(0, 1.25, 4.3), side: 1.7, plan: 1.2 }],
    },
    travel: { elevUp: 28 * DEG, elevDown: 23 * DEG, ailUp: 20 * DEG, ailDown: 15 * DEG, rudder: 16 * DEG, tab: 20 * DEG },
    hinge: { elevSc: 0.50, chAlpha: -0.07, chDelta: -0.35, chTab: -0.12, pilotMax: 45, droop: 2.5, qAil: 1500, qRud: 1300 },
    mass: {
      empty: { m: 670, p: P(0, 1.20, 0.99), I: { x: 1825, y: 2667, z: 1285 } },     // kg; kg m2 about its own centre (pitch, yaw, roll axes)
      seats: { pilot: P(-0.25, 1.05, 0.94), copilot: P(0.25, 1.05, 0.94), rear: P(0, 1.05, 1.85), baggage: P(0, 0.95, 2.41) },
      tanks: [P(-1.15, 2.02, 1.22), P(1.15, 2.02, 1.22)],
    },
    gear: {
      wheels: [
        { name: 'nose', p: P(0, -0.08, -0.17), k: 38000, c: 3400, travel: 0.18, limit: 17000, radius: 0.18, steerable: true, side: 0, cs: 5, brakeForce: 0 },
        { name: 'left main', p: P(-1.265, -0.06, 1.48), k: 52000, c: 4600, travel: 0.22, limit: 30000, radius: 0.22, side: -1, cs: 6, brakeForce: 3200 },
        { name: 'right main', p: P(1.265, -0.06, 1.48), k: 52000, c: 4600, travel: 0.22, limit: 30000, radius: 0.22, side: 1, cs: 6, brakeForce: 3200 },
      ],
      points: [
        { name: 'propeller strike', p: P(0, 0.30, -0.97), fragile: true }, { name: 'nose hit the ground', p: P(0, 0.75, -1.1) },
        { name: 'tail strike', p: P(0, 1.16, 6.55) }, { name: 'left wing tip hit the ground', p: P(-5.5, 2.12, 1.0) },
        { name: 'right wing tip hit the ground', p: P(5.5, 2.12, 1.0) }, { name: 'belly landing', p: P(0, 0.52, 1.2) },
        { name: 'aft fuselage hit the ground', p: P(0, 0.75, 3.6) }, { name: 'fin hit the ground', p: P(0, 2.72, 6.7) },
        { name: 'cabin roof hit the ground', p: P(0, 2.3, 1.2) }, { name: 'tailplane hit the ground', p: P(-1.72, 1.5, 6.0) },
        { name: 'tailplane hit the ground', p: P(1.72, 1.5, 6.0) },
      ],
      tie: [P(-2.55, 1.9, 1.05), P(2.55, 1.9, 1.05), P(0, 1.0, 6.3)],
    },
    prop: { diameter: 1.905, blades: 2, pitch: 1.448, hub: P(0, 1.25, -0.97) },
    eye: P(-0.25, 1.62, 0.93),
  };
}
