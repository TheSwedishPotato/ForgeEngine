// A320neo airframe geometry shared by the exterior, the cabin, the flight deck, the physics and the
// airport (jet bridge, pushback). Aircraft frame: x right, y up, z aft; cabin floor y = 0, the
// nose tip at z = -7.40, so the overall length of 37.57 m ends at z = 30.17.
//
// Published figures (Airbus A320 Aircraft Characteristics, FlyByWire A32NX flight model): length
// 37.57 m, span 35.80 m with sharklets, height 11.76 m, fuselage 3.95 m wide and 4.14 m high,
// wheelbase 12.64 m, track 7.59 m, wing root chord 6.07 m, 25 degrees of sweep, 5.1 degrees of
// dihedral, horizontal tail 12.45 m span / 31 m2 / 29 degrees, fin 5.87 m / 21.5 m2 / 34 degrees,
// LEAP-1A fan 78 in (1.98 m). The shapes between those numbers (the nose, the tail cone, the
// belly fairing, the wing planform with its kink, the sharklet, the six cockpit windows, the door
// and gear positions and the LEAP nacelle profile) were measured by slicing the FlightGear
// A320-family 3D model (legoboyvdlp et al., GPL) and are written here as station tables.
import { clamp, lerp, smoothstep, DEG } from './core.js';

export const NOSE_Z = -7.40, TAIL_Z = 30.17;

// ---------------- fuselage ----------------
// Stations along z: [z, top y, bottom y, half-width, height of the widest point]. The section is an
// ellipse above the widest point (radius 1.98 m about y = 0.52 in the constant part) and a slightly
// fuller ellipse below it.
const FUS_ST = [
  [-7.40, -0.29, -0.30, 0.00, -0.30],
  [-7.38, -0.10, -0.46, 0.17, -0.31],
  [-7.30, 0.08, -0.62, 0.30, -0.32],
  [-7.15, 0.20, -0.73, 0.43, -0.32],
  [-6.90, 0.41, -0.92, 0.64, -0.23],
  [-6.65, 0.56, -1.04, 0.80, -0.20],
  [-6.40, 0.69, -1.14, 0.94, -0.17],
  [-6.15, 0.86, -1.21, 1.07, -0.13],
  [-5.90, 1.03, -1.28, 1.19, -0.09],
  [-5.65, 1.27, -1.33, 1.30, -0.05],
  [-5.40, 1.48, -1.38, 1.40, -0.02],
  [-4.90, 1.83, -1.44, 1.57, 0.08],
  [-4.40, 2.02, -1.50, 1.68, 0.15],
  [-3.90, 2.17, -1.51, 1.78, 0.25],
  [-3.40, 2.28, -1.54, 1.86, 0.32],
  [-2.90, 2.37, -1.58, 1.90, 0.40],
  [-2.40, 2.42, -1.61, 1.93, 0.45],
  [-1.40, 2.49, -1.69, 1.985, 0.52],
  [-0.40, 2.50, -1.70, 1.985, 0.52],
  [16.60, 2.50, -1.70, 1.985, 0.52],
  [17.60, 2.50, -1.64, 1.98, 0.54],
  [18.60, 2.50, -1.57, 1.98, 0.57],
  [19.60, 2.49, -1.46, 1.96, 0.60],
  [20.60, 2.48, -1.32, 1.90, 0.62],
  [21.60, 2.49, -1.14, 1.79, 0.64],
  [22.60, 2.50, -0.93, 1.66, 0.74],
  [23.60, 2.50, -0.72, 1.53, 0.83],
  [24.60, 2.48, -0.48, 1.35, 0.86],
  [25.60, 2.43, -0.23, 1.16, 0.92],
  [26.60, 2.34, 0.02, 0.95, 1.18],
  [27.60, 2.19, 0.30, 0.82, 1.31],
  [28.60, 2.08, 0.60, 0.66, 1.34],
  [29.10, 1.99, 0.78, 0.55, 1.40],
  [29.60, 1.87, 0.96, 0.41, 1.43],
  [30.00, 1.74, 1.12, 0.29, 1.43],
  [30.17, 1.66, 1.20, 0.22, 1.43],
];
// belly (wing-to-body) fairing: [z, bottom y, lower-lobe exponent, blend]
const FAIR_ST = [
  [3.2, -1.70, 2.1, 0], [3.9, -1.72, 3.2, 0.5], [4.6, -1.76, 4.4, 0.85], [5.6, -1.84, 5.2, 1], [6.6, -1.90, 5.5, 1],
  [9.6, -1.89, 5.5, 1], [10.6, -1.87, 5.4, 1], [11.6, -1.85, 5.2, 1], [12.6, -1.79, 4.6, 0.9], [13.6, -1.73, 3.6, 0.6], [14.4, -1.70, 2.1, 0],
];

function tableAt(T, z, k) {
  if (z <= T[0][0]) return T[0][k];
  for (let i = 1; i < T.length; i++) {
    if (z <= T[i][0]) {
      const a = T[i - 1], b = T[i], t = (z - a[0]) / (b[0] - a[0]);
      // smooth interpolation between stations (Catmull-Rom on the neighbouring values)
      const p0 = (T[i - 2] || a)[k], p1 = a[k], p2 = b[k], p3 = (T[i + 1] || b)[k];
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
  }
  return T[T.length - 1][k];
}

// The fuselage cross-section at z: { top, bot, hw, yw, nU, nL } (n = superellipse exponents).
export function fusSection(z, o = {}) {
  const zc = clamp(z, NOSE_Z, TAIL_Z);
  o.top = tableAt(FUS_ST, zc, 1); o.bot = tableAt(FUS_ST, zc, 2); o.hw = Math.max(0, tableAt(FUS_ST, zc, 3)); o.yw = tableAt(FUS_ST, zc, 4);
  o.nU = 2.0; o.nL = 2.1;
  if (zc > FAIR_ST[0][0] && zc < FAIR_ST[FAIR_ST.length - 1][0]) {
    let i = 1; while (FAIR_ST[i][0] < zc) i++;
    const a = FAIR_ST[i - 1], b = FAIR_ST[i], t = (zc - a[0]) / (b[0] - a[0]);
    const w = lerp(a[3], b[3], t);
    o.bot = Math.min(o.bot, lerp(a[1], b[1], t)); o.nL = lerp(2.1, lerp(a[2], b[2], t), w);
  }
  return o;
}

// A point on the fuselage surface: side -1/1, u in [-1, 1] from the bottom (-1) through the widest
// point (0) to the top (1); `grow` pushes it outwards (m) along the section.
const _fs = {};
export function fusPoint(z, side, u, out, grow = 0) {
  const s = fusSection(z, _fs);
  const up = u >= 0, n = up ? s.nU : s.nL;
  const phi = Math.abs(u) * Math.PI / 2;
  const c = Math.cos(phi), sn = Math.sin(phi);
  const b = up ? s.top - s.yw : s.yw - s.bot;
  const x = (s.hw + grow) * Math.pow(c, 2 / n), y = s.yw + (up ? 1 : -1) * (b + grow) * Math.pow(sn, 2 / n);
  out.x = side * x; out.y = y; out.z = z;
  return out;
}

// Half-width of the fuselage skin at height y (for things that must sit on the skin).
export function fusHalfWidthAt(z, y) {
  const s = fusSection(z, _fs);
  const up = y >= s.yw, n = up ? s.nU : s.nL, b = up ? s.top - s.yw : s.yw - s.bot;
  const d = clamp(Math.abs(y - s.yw) / Math.max(b, 1e-3), 0, 1);
  return s.hw * Math.pow(Math.max(0, 1 - Math.pow(d, n)), 1 / n);
}

// Outward unit normal (x, y) of the section at height y on the given side (approximate).
export function fusNormalAt(z, side, y) {
  const e = 0.01, x0 = fusHalfWidthAt(z, y - e), x1 = fusHalfWidthAt(z, y + e);
  const nx = 2 * e, ny = -(x1 - x0);
  const l = Math.hypot(nx, ny) || 1;
  return { x: side * nx / l, y: ny / l };
}

// ---------------- cabin, doors, windows ----------------
// Upper-lobe skin circle in the constant section, and the cabin lining inside it.
export const SKIN = { yc: 0.52, R: 1.98 };
export const DOOR_Z = { L1: -2.38, L4: 22.26 };       // passenger door centres (0.81 x 1.85 m openings)
export const COCKPIT_DOOR_Z = -3.45;                   // flight-deck / cabin partition
export const AFT_BULKHEAD_Z = 24.06;                   // rear pressure bulkhead (cabin length 27.51 m)

// ---------------- wing ----------------
// Planform: straight leading edge swept 27.3 degrees, trailing edge unswept inboard of the kink
// (the "Yehudi"), swept 16 degrees outboard of it. Root chord 6.09 m at the fuselage side.
export const WING = { root: 1.95, kink: 6.30, tip: 16.30 };
export const wingLE = (s) => 5.72 + 0.516 * (s - 2.5);
export const wingTE = (s) => (s < WING.kink ? 11.53 : 11.53 + 0.2915 * (s - WING.kink));
export const wingChord = (s) => wingTE(s) - wingLE(s);
// quarter-chord line height (dihedral about 6 degrees on the ground), incidence (washout) and thickness
export const wingYqc = (s) => -0.616 + 0.1075 * (s - 2.5);
export const wingInc = (s) => (s < WING.kink ? lerp(2.9, 1.15, (s - 2.5) / (WING.kink - 2.5)) : lerp(1.15, 1.0, (s - WING.kink) / (WING.tip - WING.kink))) * DEG;
export const wingTC = (s) => (s < WING.kink ? lerp(0.135, 0.11, clamp((s - 2.0) / (WING.kink - 2.0), 0, 1)) : lerp(0.11, 0.10, (s - WING.kink) / (WING.tip - WING.kink)));
// moving surfaces (spanwise ranges, m from the centreline)
export const SLATS = [[2.30, 5.39], [6.07, 8.60], [8.60, 11.15], [11.15, 13.70], [13.70, 16.26]];
export const FLAPS = [[2.00, 6.39], [6.39, 13.19]];
export const SPOILERS = [[4.48, 6.19], [6.67, 8.45], [8.45, 10.00], [10.00, 11.55], [11.55, 13.06]];
export const AILERON = [13.28, 16.29];
export const CANOES = [4.85, 8.28, 11.93];            // flap-track fairings
export const flapChord = (s) => (s < 6.39 ? 1.22 : lerp(1.0, 0.62, (s - 6.39) / (13.19 - 6.39)));
// Sharklet: the tip blends upwards and ends 2.3 m above the wing at a span of 17.9 m, canted
// outwards about 21 degrees, leading edge swept 45 degrees. [y, z LE, z TE, span]
export const SHARKLET = [
  [0.87, 12.82, 14.44, 16.30], [0.95, 13.10, 14.56, 16.70], [1.08, 13.41, 14.81, 17.05], [1.38, 13.80, 14.97, 17.23],
  [1.88, 14.30, 15.21, 17.41], [2.38, 14.79, 15.45, 17.58], [2.88, 15.29, 15.69, 17.76], [3.08, 15.49, 15.83, 17.83], [3.14, 15.58, 15.80, 17.86],
];

// ---------------- tail ----------------
export const HTP = { root: 0.9, tip: 6.225 };
export const htpLE = (s) => 25.37 + 0.625 * (s - 2);
export const htpTE = (s) => 28.35 + 0.23 * (s - 2);
export const htpY = (s) => 1.428 + 0.161 * (s - 2);  // mid-plane: about 9 degrees of dihedral
export const HTP_PIVOT = { y: 1.40, z: 28.0 };        // trimmable stabiliser hinge (rear spar)
// fin: [y, z LE, z TE, half thickness]; dorsal fillet at the root
export const FIN = [
  [2.30, 19.60, 28.02, 0.26], [2.50, 20.40, 28.02, 0.265], [2.62, 21.10, 28.03, 0.26], [2.78, 22.20, 28.04, 0.252],
  [3.08, 22.89, 28.07, 0.242], [4.08, 23.76, 28.31, 0.209], [5.08, 24.64, 28.55, 0.177], [6.08, 25.51, 28.79, 0.144],
  [7.08, 26.39, 29.03, 0.111], [8.08, 27.26, 29.27, 0.079], [8.30, 27.62, 29.30, 0.06], [8.43, 28.30, 29.28, 0.03],
];
export const RUDDER_XC = 0.66;                         // hinge line as a fraction of the fin chord

// ---------------- engines (CFM LEAP-1A26) ----------------
export const ENGINE = { x: 5.75, y: -1.715, zLip: 3.97, zFan: 4.75, rFan: 0.99, zNozzle: 8.04, zEnd: 9.30 };
// nacelle outer profile [z, r]; the translating reverser sleeve runs from 6.21 to the nozzle
export const NACELLE = [[3.99, 0.985], [3.97, 1.04], [4.05, 1.10], [4.20, 1.16], [4.40, 1.21], [4.70, 1.245], [5.20, 1.255], [5.80, 1.25], [6.21, 1.235], [6.80, 1.21], [7.37, 1.17], [7.70, 1.12], [8.04, 1.03]];
export const REVERSER_Z = 6.21;
export const CORE = [[7.80, 0.80], [8.04, 0.74], [8.30, 0.64], [8.62, 0.49]];  // core cowl to the core nozzle
export const PLUG = [[8.60, 0.37], [8.85, 0.31], [9.10, 0.18], [9.30, 0.03]];
// pylon side outline [z, y]
export const PYLON = [[4.45, -0.47], [5.30, -0.26], [7.40, -0.21], [9.40, -0.37], [10.45, -0.41], [10.30, -0.52], [9.60, -1.10], [9.30, -1.30], [8.30, -1.32], [7.95, -0.62], [4.45, -0.56]];

// ---------------- landing gear ----------------
// Contact points with the struts at their static deflection: the cabin floor (door sills) about
// 3.5 m above the apron (Airbus gives 3.42-3.73 m across the family), which leaves the LEAP-1A
// nacelles about half a metre of ground clearance. Wheelbase 12.64 m, track 7.59 m; tyres
// 46x17R20 main, 30x8.8R15 nose.
export const NOSE_GEAR = { z: -2.29, y: -3.48, r: 0.381, wheelX: 0.26 };
export const MAIN_GEAR = { x: 3.795, z: 10.35, y: -3.48, r: 0.584, wheelX: 0.46, pivotY: -0.62, pivotZ: 9.95 };
export const WHEELBASE = MAIN_GEAR.z - NOSE_GEAR.z;

// ---------------- flight deck glazing ----------------
// Six panes per aircraft (three a side): windshield, sliding window, rear window. Corners are
// listed [z, y, x] for the left side, going round the pane.
export const COCKPIT_PANES = [
  { name: 'windshield', pts: [[-6.00, 0.89, -0.09], [-5.565, 1.35, -0.03], [-5.12, 1.395, -0.775], [-5.52, 0.93, -0.885]] },
  { name: 'sliding', pts: [[-5.45, 0.93, -0.96], [-5.083, 1.388, -0.826], [-4.76, 1.37, -1.01], [-4.755, 0.82, -1.385]] },
  { name: 'rear', pts: [[-4.68, 0.82, -1.41], [-4.66, 1.388, -1.042], [-4.25, 1.388, -1.20], [-4.111, 1.25, -1.341], [-4.13, 0.81, -1.605]] },
];

// ---------------- mass properties ----------------
// Mean aerodynamic chord of the planform (computed once) and the CG at a typical 27 % MAC.
export const MAC = (() => {
  let A = 0, Sc2 = 0, Scz = 0;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const s = lerp(0, WING.tip, (i + 0.5) / n), ds = WING.tip / n;
    const c = s < WING.root ? wingChord(WING.root) : wingChord(s), le = s < WING.root ? wingLE(WING.root) : wingLE(s);
    A += c * ds; Sc2 += c * c * ds; Scz += c * le * ds;
  }
  const mac = Sc2 / A, leMac = Scz / A;
  return { len: mac, zLE: leMac, area2: 2 * A };
})();
export const cgAt = (pctMac) => MAC.zLE + pctMac * MAC.len;

// Smoothstep helper re-exported for shape code
export { smoothstep };
