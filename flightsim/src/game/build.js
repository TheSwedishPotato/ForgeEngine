/**
 * Shape-making helpers for the aeroplane and the airfield: lofted skins, aerofoil sections, tubes, hinges, painted textures, and
 * a batch that merges everything sharing a material into one mesh so the renderer has few things to draw.
 */
import {
  BufferGeometry, Float32BufferAttribute, Mesh, Group, StandardMaterial, CanvasTexture, mergeGeometries, DoubleSide, Matrix4, Vector3,
  Quaternion, CylinderGeometry, BoxGeometry, RepeatWrapping,
} from '../../../medengine/src/index.js';

export const mat = (o) => new StandardMaterial({ roughness: 0.6, metalness: 0, ...o });

/** A texture painted with the 2D canvas API. `draw(ctx, w, h)`. */
export function paint(w, h, draw, { repeat = null, aniso = 8, mips = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new CanvasTexture(c);
  t.anisotropy = aniso; t.generateMipmaps = mips;
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.canvas = c; t.ctx = ctx;
  return t;
}

/**
 * A skin stretched over a series of rings (each ring an array of [x, y, z], all the same length).
 * `closed` joins each ring's last point to its first. u runs along the rings (`us`, or evenly), v around them.
 */
export function loft(rings, { closed = true, capStart = false, capEnd = false, us = null, flip = false, v0 = 0, v1 = 1, uv = null } = {}) {
  const m = rings.length, n = rings[0].length, cols = closed ? n + 1 : n;
  const P = [], U = [];
  let I = [];
  const centre = (r) => { const c = [0, 0, 0]; for (const p of r) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; } return c; };
  const cs = rings.map(centre);
  for (let i = 0; i < m; i++) for (let j = 0; j < cols; j++) {
    const p = rings[i][j % n];
    P.push(p[0], p[1], p[2]);
    if (uv) U.push(...uv(p)); else U.push(us ? us[i] : i / (m - 1), v0 + (v1 - v0) * j / (cols - 1));
  }
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    I.push(a, b, c, b, d, c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  let N = g.getAttribute('normal').array;
  // face outward: away from the middle of each ring (`flip` turns the skin inside out)
  let out = 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < cols; j++) {
    const k = (i * cols + j) * 3;
    out += N[k] * (P[k] - cs[i][0]) + N[k + 1] * (P[k + 1] - cs[i][1]) + N[k + 2] * (P[k + 2] - cs[i][2]);
  }
  if ((out < 0) !== flip) {
    for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
    g.setIndex(I); g.computeVertexNormals(); N = g.getAttribute('normal').array;
  }
  if (closed) for (let i = 0; i < m; i++) {                    // the seam: both copies of the vertex share one normal
    const a = (i * cols) * 3, b = (i * cols + n) * 3;
    const x = N[a] + N[b], y = N[a + 1] + N[b + 1], z = N[a + 2] + N[b + 2], l = Math.hypot(x, y, z) || 1;
    N[a] = N[b] = x / l; N[a + 1] = N[b + 1] = y / l; N[a + 2] = N[b + 2] = z / l;
  }
  const parts = [g];
  const cap = (r, c, toward) => {                              // a flat end, facing away from `toward`
    let nx = 0, ny = 0, nz = 0;
    for (let j = 0; j < n; j++) {
      const a = r[j], b = r[(j + 1) % n];
      nx += (a[1] - c[1]) * (b[2] - c[2]) - (a[2] - c[2]) * (b[1] - c[1]); ny += (a[2] - c[2]) * (b[0] - c[0]) - (a[0] - c[0]) * (b[2] - c[2]); nz += (a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0]);
    }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const same = (nx * (c[0] - toward[0]) + ny * (c[1] - toward[1]) + nz * (c[2] - toward[2]) > 0) !== flip, s = same ? 1 : -1;
    const cp = [...c], cn = [nx * s, ny * s, nz * s], cu = [0.5, 0.5], ci = [];
    for (let j = 0; j < n; j++) { cp.push(...r[j]); cn.push(nx * s, ny * s, nz * s); cu.push(0.5, 0.5); }
    for (let j = 0; j < n; j++) { const k = 1 + j, q = 1 + (j + 1) % n; if (same) ci.push(0, k, q); else ci.push(0, q, k); }
    const cg = new BufferGeometry();
    cg.setAttribute('position', new Float32BufferAttribute(cp, 3)); cg.setAttribute('normal', new Float32BufferAttribute(cn, 3));
    cg.setAttribute('uv', new Float32BufferAttribute(cu, 2)); cg.setIndex(ci);
    parts.push(cg);
  };
  if (capStart) cap(rings[0], cs[0], cs[1]);
  if (capEnd) cap(rings[m - 1], cs[m - 1], cs[m - 2]);
  return parts.length > 1 ? mergeGeometries(parts) : g;
}

/** A rounded cross-section in the x-y plane at station z: bottom centre first, up the right side, over the top, down the left. */
export function ring(z, yc, hw, ht, hb, n = 24, e = 2.6, from = -90, to = 270) {
  const out = [];
  const open = to - from < 359.9;
  for (let j = 0; j < n; j++) {
    const a = (from + (to - from) * j / (open ? n - 1 : n)) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    out.push([hw * Math.sign(c) * Math.abs(c) ** (2 / e), yc + (s >= 0 ? ht : hb) * Math.sign(s) * Math.abs(s) ** (2 / e), z]);
  }
  return out;
}

/** NACA four-digit section as [x, y] in chord units between chord fractions x0 and x1: over the top from x1 to x0, back underneath. */
export function naca(code, x0 = 0, x1 = 1, n = 14) {
  const m = +code[0] / 100, p = +code[1] / 10, t = +code.slice(2) / 100;
  const at = (x) => {
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = m === 0 ? 0 : x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x);
    return [yc + yt, yc - yt];
  };
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, x = x0 + (x1 - x0) * (x0 === 0 ? s * s : s);            // crowd the points toward a leading edge
    const [u, l] = at(x); up.push([x, u]); lo.push([x, l]);
  }
  return [...up.reverse(), ...(x0 === 0 ? lo.slice(1) : lo)];
}

/**
 * A wing-like panel: `section` ([x, y] in chord units) swept through stations { le: [x, y, z] of the leading edge (chord 0),
 * chord, twist (rad, leading edge up), origin (chord fraction that `le` refers to, default 0) }. `vertical` stands it up (a fin).
 */
export function panel(section, stations, { vertical = false, capStart = true, capEnd = true, flip = false } = {}) {
  const rings = stations.map((s) => {
    const c = s.chord, ci = Math.cos(s.twist ?? 0), si = Math.sin(s.twist ?? 0), o = s.origin ?? 0;
    return section.map(([px, py]) => {
      const a = (px - o) * c, t = py * c;                       // along the chord (aft), through the thickness
      return vertical ? [s.le[0] + t, s.le[1], s.le[2] + a] : [s.le[0], s.le[1] - a * si + t * ci, s.le[2] + a * ci + t * si];
    });
  });
  return loft(rings, { closed: true, capStart, capEnd, flip });
}

/** A straight tube (or a flattened strut with `flat`) from a to b. */
export function tube(a, b, r, { r2 = r, flat = 1, seg = 10 } = {}) {
  const va = new Vector3(...a), vb = new Vector3(...b), d = vb.clone().sub(va), L = d.length();
  const g = new CylinderGeometry(r2, r, L, seg, 1, false);
  g.scale(1, 1, flat);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  g.applyMatrix4(new Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
  return g;
}

export function box(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** Collects geometry by material and turns each pile into a single mesh. */
export class Batch {
  constructor() { this.piles = new Map(); }
  add(geometry, material, matrix = null) {
    if (matrix) geometry.applyMatrix4(matrix);
    let g = geometry;
    if (!g.getAttribute('uv')) { g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2)); }
    if (!g.index) g = g.clone();
    if (!this.piles.has(material)) this.piles.set(material, []);
    this.piles.get(material).push(g);
    return this;
  }
  build(parent, { cast = true, receive = true } = {}) {
    const out = [];
    for (const [material, list] of this.piles) {
      const mesh = new Mesh(list.length > 1 ? mergeGeometries(list) : list[0], material);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      parent.add(mesh); out.push(mesh);
    }
    this.piles.clear();
    return out;
  }
}

/** Hangs `object` (built in its parent's coordinates) on a hinge through `point` along `axis`; returns set(angle). */
export function hinge(parent, object, point, axis) {
  const pivot = new Group();
  pivot.position.set(...point);
  const base = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), new Vector3(...axis).normalize());
  pivot.quaternion.copy(base);
  parent.add(pivot);
  parent.add(object);
  parent.updateMatrixWorld(true);
  pivot.attach(object);
  const q = new Quaternion(), X = new Vector3(1, 0, 0);
  return { pivot, set(angle) { pivot.quaternion.copy(base).multiply(q.setFromAxisAngle(X, angle)); } };
}
export { DoubleSide };

/** A flat disc in the x-y plane facing +z, with the texture's circle mapped onto it. */
export function disc(r, seg = 40, inner = 0) {
  const P = [], N = [], U = [], I = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    P.push(c * inner, s * inner, 0, c * r, s * r, 0); N.push(0, 0, 1, 0, 0, 1);
    U.push(0.5 + 0.5 * c * inner / r, 0.5 + 0.5 * s * inner / r, 0.5 + 0.5 * c, 0.5 + 0.5 * s);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3)); g.setAttribute('normal', new Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new Float32BufferAttribute(U, 2)); g.setIndex(I);
  return g;
}
