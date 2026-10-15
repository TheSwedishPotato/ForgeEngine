/**
 * The hull as the sea sees it: the watertight envelope that displaces water.
 *
 * Inside the outer hull are the pressure hull and, between the two, the main ballast, fuel and
 * auxiliary tanks; on top a free-flooding superstructure (the main deck, the conning tower
 * fairwater and the bridge) that fills and drains through its limber holes and so displaces
 * nothing. The envelope here is everything below and inside the outer hull, plus the conning
 * tower (a pressure-tight cylinder on its side) and the bow buoyancy tank up in the bow
 * superstructure. Water in a tank is counted as part of the boat's weight; the tank's volume
 * as part of the displacement: a flooded tank adds both, so cancels.
 *
 * Each cross-section is a superellipse (half-breadth b at the height of greatest beam, other
 * exponents below and above), its breadth, keel and top drawn along the length by a few
 * parameters. The parameters were fitted (tools/fithull.mjs) to the yard's hydrostatics for
 * normal diving trim: 1806.2 tons surfaced at a mean draft of 15'-3" trimmed 9 1/2" by the
 * stern, 2419 tons submerged, centre of buoyancy 9.18 ft above the keel and 1.12 ft abaft frame
 * 69, water plane 5250 sq ft, transverse metacentre 3.22 ft above B.
 *
 * Buoyancy is integrated slice by slice against the actual water surface (waves) and the
 * actual density at each slice's depth, so the boat feels the wave crests, the trim, the heel
 * and the density layer beneath the mixed layer.
 */
import { FT } from './units.js';

// ---- the envelope's shape (feet; x forward of frame 66 1/2, y above the keel) -------------------

// Fitted by tools/fithull.mjs to the yard's displacement curves (even keel at the 15'-3" mean
// draft): surfaced 62,867 ft^3 (target 63,217), LCB 6.12 ft abaft frame 66 1/2 (6.12), KB
// 9.18 ft (9.18), water plane 5,322 sq ft (5,250), BM transverse 3.22 ft (3.22), BM
// longitudinal 414 ft (410, from MT1"), wetted surface 11,415 sq ft (11,543), midship section
// 340 sq ft (340), breadth at the waterline 26.0 ft (26'-0"); submerged (without the free-
// flooding bow buoyancy tank) 84,890 ft^3 (84,665) with its centre 7.00 ft abaft frame 66 1/2
// and 11.39 ft above the keel, where the yard's weights and stability put it.
export const ENVELOPE = {
  B: 13.65,               // greatest half-breadth (beam 27'-3 1/2" at 12 ft above base)
  xFP: 147.17, xAP: -159.5,
  xm1: -5.971, xm0: -27.598,  // where the tapers start
  pF: 1.034, qF: 0.692,   // forward taper: b = B (1 - u^pF)^qF
  pA: 2.219, qA: 1.224,   // after taper
  xk1: 20, xk0: -20,      // flat keel between
  KF: 5.114, kF: 4,       // forefoot rise at the F.P.
  KA: 4.518, kA: 0.6,     // stern cut-up at the A.P.
  yb: 12.0,               // height of greatest breadth
  YT: 20.319,             // top of the envelope
  n1: 1.947, n2: 2.463,   // superellipse exponents, below and above yb
  endTop: 1,              // fraction of the midship top height kept at the ends
  // the conning tower and the bow buoyancy tank
  ct: { x0: 24.0, x1: 41.5, y: 24.4, r: 4.25 },
  bb: { x0: 128, x1: 146, y0: 16.5, y1: 24.0, b: 4.4 },
};

const E = ENVELOPE;

/** Half-breadth taper factor at x. */
function taper(x) {
  if (x > E.xm1) { const u = Math.min(1, (x - E.xm1) / (E.xFP + 3 - E.xm1)); return Math.pow(Math.max(0, 1 - Math.pow(u, E.pF)), E.qF); }
  if (x < E.xm0) { const u = Math.min(1, (E.xm0 - x) / (E.xm0 - (E.xAP - 2))); return Math.pow(Math.max(0, 1 - Math.pow(u, E.pA)), E.qA); }
  return 1;
}
function keel(x) {
  if (x > E.xk1) return E.KF * Math.pow(Math.min(1.2, (x - E.xk1) / (E.xFP - E.xk1)), E.kF);
  if (x < E.xk0) return E.KA * Math.pow(Math.min(1.2, (E.xk0 - x) / (E.xk0 - E.xAP)), E.kA);
  return 0;
}
function top(x) {
  const t = taper(x);
  return E.yb + (E.YT - E.yb) * (E.endTop + (1 - E.endTop) * t);
}

/**
 * The section polygon at x (feet): [z, y] counter-clockwise (starboard is +z), or null where the
 * envelope has no breadth. nv vertices round.
 */
export function sectionAt(x, nv = 28) {
  const t = taper(x);
  if (t < 0.01) return null;
  const b = E.B * t, yk = keel(x), yt = top(x);
  if (yt - yk < 0.3) return null;
  const yb = Math.min(yt - 0.2, Math.max(yk + 0.2, E.yb + (yk > 0 ? yk * 0.35 : 0)));
  const pts = [];
  // starboard side from the keel up to the top, then the port side back down
  const half = nv / 2;
  for (let i = 0; i <= half; i++) {
    const a = -Math.PI / 2 + (i / half) * Math.PI;         // -90 (keel) .. +90 (top)
    const s = Math.sin(a), c = Math.cos(a);
    const n = s < 0 ? E.n1 : E.n2;
    const ry = s < 0 ? yb - yk : yt - yb;
    const z = b * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = yb + ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    pts.push([z, y]);
  }
  for (let i = half - 1; i >= 1; i--) { const [z, y] = pts[i]; pts.push([-z, y]); }
  return pts;
}

/** The conning tower's section at x (feet), or null. */
function ctSection(x, nv = 20) {
  const c = E.ct;
  if (x < c.x0 || x > c.x1) return null;
  const pts = [];
  for (let i = 0; i < nv; i++) { const a = -Math.PI / 2 + (i / nv) * Math.PI * 2; pts.push([c.r * Math.cos(a), c.y + c.r * Math.sin(a)]); }
  return pts;
}
/** The bow buoyancy tank's section at x (feet), or null: a rounded box under the bow deck. */
function bbSection(x) {
  const c = E.bb;
  if (x < c.x0 || x > c.x1) return null;
  const u = (x - c.x0) / (c.x1 - c.x0);
  const b = c.b * Math.sqrt(Math.max(0.05, 1 - u * u));
  return [[0, c.y0], [b * 0.6, c.y0], [b, c.y0 + 1.5], [b, c.y1], [-b, c.y1], [-b, c.y0 + 1.5], [-b * 0.6, c.y0]];
}

/**
 * The hull sliced for integration: n slices from the A.P. to just past the F.P. Each slice
 * has its x (m, centre), thickness dx (m), and the section polygons in metres ([z, y]).
 */
export function buildSlices(n = 72, { bb = true } = {}) {
  const x0 = (E.xAP - 2) * FT, x1 = (E.xFP + 3.5) * FT;
  const dx = (x1 - x0) / n;
  const slices = [];
  for (let i = 0; i < n; i++) {
    const xm = x0 + (i + 0.5) * dx, xf = xm / FT;
    const polys = [];
    for (const s of [sectionAt(xf), ctSection(xf), bb ? bbSection(xf) : null]) if (s) polys.push(s.map(([z, y]) => [z * FT, y * FT]));
    if (polys.length) slices.push({ x: xm, dx, polys, area: polys.reduce((a, p) => a + polyArea(p), 0) });
  }
  return slices;
}

/** Signed area of a polygon [[z, y], ...] (counter-clockwise positive in z-right, y-up). */
export function polyArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) { const [z0, y0] = p[i], [z1, y1] = p[(i + 1) % n]; a += z0 * y1 - z1 * y0; }
  return Math.abs(a) / 2;
}

/**
 * Clips polygon p ([[z, y], ...]) to the half-plane a*z + b*y <= c and returns its area and
 * centroid { A, z, y } (Sutherland-Hodgman against one edge, then the shoelace formula).
 */
export function clipBelow(p, a, b, c) {
  const n = p.length;
  let A = 0, cz = 0, cy = 0, wet = 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = p[i], Q = p[(i + 1) % n];
    const dP = a * P[0] + b * P[1] - c, dQ = a * Q[0] + b * Q[1] - c;
    if (dP <= 0) out.push(P);
    let I = null;
    if ((dP <= 0) !== (dQ <= 0)) {
      const t = dP / (dP - dQ);
      I = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
      out.push(I);
    }
    // the wetted part of this edge
    if (dP <= 0 && dQ <= 0) wet += Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    else if (I && dP <= 0) wet += Math.hypot(I[0] - P[0], I[1] - P[1]);
    else if (I && dQ <= 0) wet += Math.hypot(Q[0] - I[0], Q[1] - I[1]);
  }
  const m = out.length;
  if (m < 3) return { A: 0, z: 0, y: 0, wet: 0 };
  for (let i = 0; i < m; i++) {
    const [z0, y0] = out[i], [z1, y1] = out[(i + 1) % m];
    const cr = z0 * y1 - z1 * y0;
    A += cr; cz += (z0 + z1) * cr; cy += (y0 + y1) * cr;
  }
  if (Math.abs(A) < 1e-12) return { A: 0, z: 0, y: 0, wet: 0 };
  return { A: Math.abs(A) / 2, z: cz / (3 * A), y: cy / (3 * A), wet };
}

/**
 * Hydrostatics of the slices floating upright at a straight waterline: draft dF at the F.P. and
 * dA at the A.P. (m above the keel). Returns volume, centre of buoyancy, water plane area and
 * its moments (for the metacentric radii), and the wetted girth integral (wetted surface).
 */
export function hydrostatics(slices, dF, dA) {
  const xF = E.xFP * FT, xA = E.xAP * FT;
  let V = 0, Mx = 0, My = 0, Awp = 0, Iwp = 0, IwpL = 0, Mwx = 0, S = 0;
  for (const s of slices) {
    const d = dA + (dF - dA) * (s.x - xA) / (xF - xA);
    for (const p of s.polys) {
      const r = clipBelow(p, 0, 1, d);
      if (r.A <= 0) continue;
      V += r.A * s.dx; Mx += r.A * s.x * s.dx; My += r.A * r.y * s.dx;
      // the water plane: the section's breadth at the waterline
      const w = breadthAt(p, d);
      if (w > 0) { Awp += w * s.dx; Iwp += (w ** 3 / 12) * s.dx; Mwx += w * s.x * s.dx; IwpL += w * s.x * s.x * s.dx; }
      S += wettedGirth(p, d) * s.dx;
    }
  }
  const lcf = Awp > 0 ? Mwx / Awp : 0;
  return { V, lcb: Mx / V, kb: My / V, Awp, lcf, bmT: Iwp / V, bmL: (IwpL - Awp * lcf * lcf) / V, S };
}

/** Breadth of a polygon at height y (the length of the horizontal chord). */
export function breadthAt(p, y) {
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0, n = p.length; i < n; i++) {
    const [z0, y0] = p[i], [z1, y1] = p[(i + 1) % n];
    if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
      const z = z0 + (z1 - z0) * (y - y0) / (y1 - y0);
      zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
    }
  }
  return zmax > zmin ? zmax - zmin : 0;
}

/** Length of the polygon's boundary below height y. */
function wettedGirth(p, y) {
  let L = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    let [z0, y0] = p[i], [z1, y1] = p[(i + 1) % n];
    if (y0 > y && y1 > y) continue;
    if (y0 > y) { const t = (y - y1) / (y0 - y1); z0 = z1 + (z0 - z1) * t; y0 = y; }
    else if (y1 > y) { const t = (y - y0) / (y1 - y0); z1 = z0 + (z1 - z0) * t; y1 = y; }
    L += Math.hypot(z1 - z0, y1 - y0);
  }
  return L;
}

/** The whole envelope's volume and centroid (fully submerged). */
export function envelopeVolume(slices) {
  let V = 0, Mx = 0, My = 0;
  for (const s of slices) for (const p of s.polys) {
    const r = clipBelow(p, 0, 1, 1e9);
    V += r.A * s.dx; Mx += r.A * s.x * s.dx; My += r.A * r.y * s.dx;
  }
  return { V, lcb: Mx / V, kb: My / V };
}

export { taper, keel, top };
