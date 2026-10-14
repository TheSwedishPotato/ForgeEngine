/**
 * The DMC-12's body: Giugiaro's folded-paper wedge in brushed stainless steel.
 *
 * Built as a loft of nine lines running from the nose to the tail, each a polyline of keys
 * (x, y, z), and rows across them: the keel and the floor edge underneath, the sill, the
 * waist crease (the body's widest line, where the black rub strip runs), the belt (the fender
 * tops and the window sills), the roof edge (the A-pillars, the roof's sides, the tops of the
 * sail panels that run back to the tail), the gull-wing hinge line, the deck edge, and the
 * centre line. Each quad between two lines and two rows takes its material and its part
 * (body, a door, a pane) from where it lies. The wheel arches are cut by lifting the lower
 * lines over each wheel.
 *
 * Car frame: x forward, y up from the ground, z to the right; origin on the ground midway
 * between the axles.
 *
 * Measures (DMC, Wikipedia infobox and owners' references): length 4267 mm, width 1857 mm
 * over the body, height 1140 mm, wheelbase 2413 mm, tracks 1590 / 1588 mm; tyres 195/60 HR14
 * front, 235/60 HR15 rear. Proportions of the lines (crease ~0.58 m, sills ~0.86 m, arches
 * ~0.67 / 0.72 m high) read off photographs of the cars at the Petersen museum and of a
 * screen-accurate replica (Wikimedia Commons).
 */
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from 'three';
import { smoothPart } from './geom.js';

export const DIM = {
  length: 4.267, width: 1.857, height: 1.14, wheelbase: 2.413,
  xF: 1.2065, xR: -1.2065, trackF: 1.59, trackR: 1.588,
  rF: 0.295, rR: 0.3315, widthF: 0.195, widthR: 0.235,
  nose: 2.06, tail: -2.205,
  archF: { xc: 1.2065, yc: 0.32, R: 0.345 },
  archR: { xc: -1.2065, yc: 0.355, R: 0.37 },
  // the doors: below the belt, and the glass and roof part above it
  doorLow: [-0.80, 0.60], doorHigh: [-0.90, 0.56],
  cowl: 0.56, header: -0.07, roofRear: -0.95,
  hinge: { y: 1.128, z: 0.34 },
};

// the lines (right side), keys sorted by x
const C = {
  keel: [[-2.10, 0.30, 0], [-1.90, 0.17, 0], [1.70, 0.16, 0], [1.98, 0.24, 0]],
  floor: [[-2.14, 0.30, 0.70], [-1.90, 0.18, 0.80], [1.70, 0.17, 0.80], [2.00, 0.24, 0.74]],
  sill: [[-2.205, 0.27, 0.78], [-2.12, 0.23, 0.885], [-1.80, 0.215, 0.905], [1.60, 0.205, 0.905], [1.96, 0.215, 0.87], [2.06, 0.23, 0.76]],
  crease: [[-2.205, 0.565, 0.80], [-2.13, 0.58, 0.90], [-1.80, 0.59, 0.9285], [0.0, 0.58, 0.9285], [1.60, 0.565, 0.925], [1.96, 0.555, 0.885], [2.06, 0.545, 0.77]],
  belt: [[-2.15, 0.84, 0.80], [-2.05, 0.855, 0.858], [-0.95, 0.885, 0.875], [0.56, 0.835, 0.875], [1.20, 0.745, 0.87], [1.88, 0.66, 0.855], [1.975, 0.645, 0.83]],
  roofEdge: [[-2.15, 0.845, 0.79], [-2.05, 0.87, 0.79], [-0.95, 1.10, 0.665], [-0.07, 1.108, 0.672], [0.56, 0.842, 0.858], [0.62, 0.836, 0.835], [1.20, 0.752, 0.835], [1.88, 0.667, 0.82], [1.975, 0.65, 0.80]],
  hingeLine: [[-2.15, 0.845, 0.70], [-2.05, 0.869, 0.665], [-1.00, 1.088, 0.53], [-0.95, 1.125, 0.34], [-0.07, 1.128, 0.34], [0.56, 0.852, 0.36], [1.20, 0.758, 0.36], [1.88, 0.672, 0.36], [1.975, 0.655, 0.36]],
  deckEdge: [[-2.15, 0.81, 0.62], [-2.05, 0.83, 0.60], [-1.00, 1.05, 0.50], [-0.95, 1.13, 0.18], [-0.07, 1.133, 0.18], [0.56, 0.855, 0.18], [1.20, 0.76, 0.18], [1.88, 0.674, 0.18], [1.975, 0.658, 0.18]],
  centre: [[-2.15, 0.81, 0], [-2.05, 0.83, 0], [-1.00, 1.05, 0], [-0.95, 1.135, 0], [-0.07, 1.138, 0], [0.56, 0.857, 0], [1.20, 0.762, 0], [1.88, 0.676, 0], [1.975, 0.66, 0]],
};
export const LINES = ['keel', 'floor', 'sill', 'crease', 'belt', 'roofEdge', 'hingeLine', 'deckEdge', 'centre'];

/** A line's point at x (clamped to its ends: beyond them it stays at its end point). */
export function lineAt(name, x) {
  const k = C[name];
  if (x <= k[0][0]) return [...k[0]];
  if (x >= k[k.length - 1][0]) return [...k[k.length - 1]];
  for (let i = 0; i + 1 < k.length; i++) {
    const a = k[i], b = k[i + 1];
    if (x >= a[0] && x <= b[0]) {
      const t = (x - a[0]) / (b[0] - a[0]);
      return [x, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return [...k[k.length - 1]];
}

function archAt(x) {
  for (const a of [DIM.archF, DIM.archR]) {
    const d = x - a.xc;
    if (Math.abs(d) <= a.R + 1e-9) return { y: a.yc + Math.sqrt(Math.max(0, a.R * a.R - d * d)), front: a === DIM.archF };
  }
  return null;
}

/** A row of the loft at x: the nine points, the wheel arches cut in. */
export function rowAt(x) {
  const p = LINES.map((n) => lineAt(n, x));
  const arch = archAt(x);
  if (arch) {
    p[1] = [x, Math.max(p[1][1], arch.y + 0.015), 0.60];
    p[2] = [x, Math.max(p[2][1], arch.y), p[2][2]];
    p[3] = [x, Math.max(p[3][1], arch.y), p[3][2]];
    if (p[4][1] < arch.y + 0.04) p[4][1] = arch.y + 0.04;
  }
  return { x, p, arch };
}

/** The x of every row: the keys, the cuts, the arches finely, and no gap over 7 cm. */
export function rowXs() {
  const xs = new Set();
  for (const n of LINES) for (const k of C[n]) xs.add(+k[0].toFixed(4));
  for (const v of [...DIM.doorLow, ...DIM.doorHigh, DIM.cowl, DIM.header, DIM.roofRear, -0.87, 0.53, -0.04, 1.58, -1.60]) xs.add(v);
  for (const a of [DIM.archF, DIM.archR]) {
    xs.add(+(a.xc - a.R - 0.002).toFixed(4)); xs.add(+(a.xc + a.R + 0.002).toFixed(4));
    for (let i = 0; i <= 32; i++) xs.add(+(a.xc - a.R + (2 * a.R * i) / 32).toFixed(4));
  }
  const s = [...xs].filter((x) => x >= DIM.tail - 1e-6 && x <= DIM.nose + 1e-6).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (i > 0) { const gap = s[i] - s[i - 1], n = Math.ceil(gap / 0.07); for (let k = 1; k < n; k++) out.push(s[i - 1] + (gap * k) / n); }
    out.push(s[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

class Part {
  constructor() { this.P = []; this.N = []; this.UV = []; }
  tri(a, b, c, ua, ub, uc) {
    const e1 = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), e2 = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = e1.cross(e2);
    const l = n.length();
    if (l < 1e-9) return;
    n.divideScalar(l);
    for (const [v, u] of [[a, ua], [b, ub], [c, uc]]) { this.P.push(v[0], v[1], v[2]); this.N.push(n.x, n.y, n.z); this.UV.push(u[0], u[1]); }
  }
  quad(a, b, c, d, ua, ub, uc, ud) { this.tri(a, b, c, ua, ub, uc); this.tri(a, c, d, ua, uc, ud); }
  geometry(smooth = 32, offset = null) {
    const g = new BufferGeometry();
    let P = this.P;
    if (offset) { P = P.slice(); for (let i = 0; i < P.length; i += 3) { P[i] -= offset[0]; P[i + 1] -= offset[1]; P[i + 2] -= offset[2]; } }
    g.setAttribute('position', new Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.UV, 2));
    if (smooth) smoothPart(g, smooth);
    g.computeBoundingSphere();
    return g;
  }
}

/** Which material and part a quad between line i and i+1, rows at x0..x1, belongs to. */
function classify(i, x0, x1, arch) {
  const xm = (x0 + x1) / 2;
  const [dl0, dl1] = DIM.doorLow, [dh0, dh1] = DIM.doorHigh;
  const inLow = xm > dl0 && xm < dl1, inHigh = xm > dh0 && xm < dh1;
  const front = xm > DIM.cowl, ws = xm > DIM.header && xm < DIM.cowl, roof = xm > DIM.roofRear && xm < DIM.header, rear = xm < DIM.roofRear;
  const ends = xm > 1.58 || xm < -1.60;
  switch (i) {
    case 0: return { mat: arch ? 'well' : 'under' };
    case 1: return { mat: arch ? 'well' : ends ? 'bumper' : 'under' };
    case 2: return { mat: ends ? 'bumper' : 'steel', door: inLow };
    case 3: return { mat: 'steel', door: inLow };
    case 4:
      if (front) return { mat: 'steel' };
      if (inHigh) return (xm < -0.87 || xm > 0.53) ? { mat: 'trim', door: true } : { mat: 'glass', door: true };
      return { mat: 'steel' };
    case 5:
      if (ws) return { mat: 'glass' };
      if (roof && inHigh) return { mat: 'steel', door: true };
      return { mat: 'steel' };
    case 6:
      if (ws) return { mat: 'glass' };
      return { mat: 'steel' };
    case 7:
      if (ws) return { mat: 'glass' };
      if (rear) return { mat: xm > -1.0 ? 'steel' : 'deck' };
      return { mat: 'steel' };
  }
  return { mat: 'steel' };
}

const FRONT_CAP = ['under', 'bumper', 'bumper', 'grille', 'steel', 'steel', 'steel', 'steel'];
const REAR_CAP = ['under', 'bumper', 'bumper', 'tailPanel', 'steel', 'steel', 'steel', 'steel'];

/**
 * Builds the shell. Returns { body: { mat: geometry }, doors: { right: {mat: geometry}, left },
 * glass: { body: geometry, right, left }, hinge, rows } — the doors' geometry relative to their hinge.
 */
export function buildShell() {
  const xs = rowXs();
  const rows = xs.map(rowAt);
  const parts = { body: {}, right: {}, left: {} };
  const get = (who, mat) => (parts[who][mat] ??= new Part());
  const mirror = (v) => [v[0], v[1], -v[2]];
  // arc length along each row (v texture coordinate)
  const vlen = rows.map((r) => { const a = [0]; for (let i = 1; i < 9; i++) a.push(a[i - 1] + Math.hypot(r.p[i][1] - r.p[i - 1][1], r.p[i][2] - r.p[i - 1][2])); return a; });
  for (let k = 0; k + 1 < rows.length; k++) {
    const A = rows[k], B = rows[k + 1];
    const arch = !!(A.arch && B.arch);
    for (let i = 0; i < 8; i++) {
      const c = classify(i, A.x, B.x, arch);
      const a0 = A.p[i], a1 = A.p[i + 1], b0 = B.p[i], b1 = B.p[i + 1];
      const ua0 = [A.x * 2, vlen[k][i] * 4], ua1 = [A.x * 2, vlen[k][i + 1] * 4], ub0 = [B.x * 2, vlen[k + 1][i] * 4], ub1 = [B.x * 2, vlen[k + 1][i + 1] * 4];
      // right side: rows go tail->nose (x up), lines go bottom->top: (a0, b0, b1, a1) faces out (+z)
      const whoR = c.door ? 'right' : 'body', whoL = c.door ? 'left' : 'body';
      get(whoR, c.mat).quad(a0, b0, b1, a1, ua0, ub0, ub1, ua1);
      get(whoL, c.mat).quad(mirror(a0), mirror(a1), mirror(b1), mirror(b0), ua0, ua1, ub1, ub0);
      // the cabin's lining: the shell offset inward and facing in (door cards, headliner, pillars)
      const xm = (A.x + B.x) / 2;
      if (c.mat !== 'glass' && i >= 2 && i <= 7 && xm > DIM.roofRear - 0.02 && xm < DIM.cowl + 0.02) {
        const inset = (v) => { const d = Math.hypot(v[1] - 0.55, v[2]) || 1; const k = (i >= 5 ? 0.025 : 0.045) / d; return [v[0], v[1] - (v[1] - 0.55) * k, v[2] - v[2] * k]; };
        const ia0 = inset(a0), ia1 = inset(a1), ib0 = inset(b0), ib1 = inset(b1);
        const mat = i >= 5 ? 'headliner' : 'liner';
        get(whoR, mat).quad(ia0, ia1, ib1, ib0, ua0, ua1, ub1, ub0);
        get(whoL, mat).quad(mirror(ia0), mirror(ib0), mirror(ib1), mirror(ia1), ua0, ub0, ub1, ua1);
      }
    }
  }
  // the caps: strips across the car between the mirrored lines of the first and last row
  const cap = (row, mats, facingFront) => {
    for (let i = 0; i < 8; i++) {
      const r0 = row.p[i], r1 = row.p[i + 1], l0 = mirror(r0), l1 = mirror(r1);
      const P = get('body', mats[i]);
      const uv = (v) => [v[2] * 2, v[1] * 2];
      if (facingFront) P.quad(r0, l0, l1, r1, uv(r0), uv(l0), uv(l1), uv(r1));
      else P.quad(l0, r0, r1, l1, uv(l0), uv(r0), uv(r1), uv(l1));
    }
  };
  cap(rows[rows.length - 1], FRONT_CAP, true);
  cap(rows[0], REAR_CAP, false);

  const H = DIM.hinge;
  const out = { body: {}, doors: { right: {}, left: {} }, glass: {}, rows };
  for (const [mat, p] of Object.entries(parts.body)) {
    if (mat === 'glass') out.glass.body = p.geometry(0);
    else out.body[mat] = p.geometry(mat === 'steel' ? 28 : 35);
  }
  for (const side of ['right', 'left']) {
    const pivot = [0, H.y, side === 'right' ? H.z : -H.z];
    for (const [mat, p] of Object.entries(parts[side])) {
      if (mat === 'glass') out.glass[side] = p.geometry(0, pivot);
      else out.doors[side][mat] = p.geometry(28, pivot);
    }
  }
  out.hinge = H;
  return out;
}

/** Meshes from { mat: geometry } with the car's materials. */
export function meshes(geos, M, { castShadow = true } = {}) {
  const g = new Group();
  for (const [mat, geo] of Object.entries(geos)) {
    const m = new Mesh(geo, M[mat] ?? M.steel);
    m.castShadow = castShadow;
    m.name = mat;
    g.add(m);
  }
  return g;
}
