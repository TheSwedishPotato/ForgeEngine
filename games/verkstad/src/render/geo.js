/**
 * Shapes into geometry: the part descriptions of car/assembly.js and car/f1.js (boxes, cylinders,
 * tubes along splines, lathed profiles, tori, coil springs, lofted carbon bodywork) turned into
 * three.js geometry in the part's own frame, merged per material (the Med Engine draws one
 * material per mesh).
 */
import { BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, LatheGeometry, TubeGeometry, CatmullRomCurve3, Curve, Vector2, Vector3, BufferGeometry, Float32BufferAttribute, Mesh, Group, Euler, Matrix4, Quaternion } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _s = new Vector3(1, 1, 1), _p = new Vector3();

function orient(g, ax) {
  if (ax === 'x') g.rotateZ(-Math.PI / 2);
  else if (ax === 'z') g.rotateX(Math.PI / 2);
  return g;
}

class Helix extends Curve {
  constructor(R, turns, len) { super(); this.R = R; this.turns = turns; this.len = len; }
  getPoint(t, out = new Vector3()) { const a = t * this.turns * Math.PI * 2; return out.set(Math.cos(a) * this.R, (t - 0.5) * this.len, Math.sin(a) * this.R); }
}

/** A lofted body: sections [z, half-width, bottom y, top y, superellipse exponent], closed at both ends. */
export function loft(sec, n = 28) {
  const pos = [], idx = [], uv = [];
  const ring = (s) => {
    const [z, hw, yb, yt, e] = s, cy = (yb + yt) / 2, hh = (yt - yb) / 2;
    const out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); out.push([Math.sign(c) * Math.abs(c) ** (2 / e) * hw, cy + Math.sign(sn) * Math.abs(sn) ** (2 / e) * hh, z]); }
    return out;
  };
  const rings = sec.map(ring);
  rings.forEach((r, k) => r.forEach((p, i) => { pos.push(...p); uv.push(i / n, k / (rings.length - 1)); }));
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
    const a = k * n + i, b = k * n + ((i + 1) % n), c = (k + 1) * n + i, d = (k + 1) * n + ((i + 1) % n);
    if (sec[k][0] > sec[k + 1][0]) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  // the end caps
  for (const [k, flip] of [[0, sec[0][0] > sec[1][0]], [rings.length - 1, sec[0][0] < sec[1][0]]]) {
    const c = pos.length / 3; const r = rings[k];
    pos.push(0, r.reduce((s, p) => s + p[1], 0) / n, r[0][2]); uv.push(0.5, 0.5);
    for (let i = 0; i < n; i++) { const a = k * n + i, b = k * n + ((i + 1) % n); if (flip) idx.push(c, a, b); else idx.push(c, b, a); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** One shape as geometry in the part's frame. */
export function primGeometry(p) {
  let g;
  switch (p.t) {
    case 'box': g = new BoxGeometry(...p.s); break;
    case 'cyl': g = orient(new CylinderGeometry(p.r2 ?? p.rad, p.rad, p.len, p.seg ?? 16), p.ax); break;
    case 'sph': g = new SphereGeometry(p.rad, 16, 10); break;
    case 'torus': g = new TorusGeometry(p.R, p.rad, 8, p.seg ?? 32); if (p.ax === 'x') g.rotateY(Math.PI / 2); else if (p.ax === 'y') g.rotateX(Math.PI / 2); break;
    case 'lathe': g = orient(new LatheGeometry(p.prof.map(([r, y]) => new Vector2(Math.max(0.0005, r), y)), p.seg ?? 24), p.ax); break;
    case 'tube': { const pts = p.pts.map((q) => new Vector3(...q)); g = new TubeGeometry(new CatmullRomCurve3(pts, !!p.closed), Math.max(4, pts.length * 8), p.rad, 8, !!p.closed); break; }
    case 'spring': g = new TubeGeometry(new Helix(p.R, p.turns, p.len), Math.round(p.turns * 24), p.rad, 6, false); break;
    case 'loft': g = loft(p.sec); break;
    default: g = new BoxGeometry(0.01, 0.01, 0.01);
  }
  if (!g.index) g = g.toNonIndexed ? g : g;
  if (p.r) { _e.set(...p.r); g.applyMatrix4(_m.makeRotationFromEuler(_e)); }
  if (p.t !== 'tube' && p.t !== 'loft') g.translate(...(p.p ?? [0, 0, 0]));
  else if (p.p && p.t === 'loft') g.translate(...p.p);
  return g;
}

function normalise(g) {
  // every geometry merged together must have the same attributes, indexed
  if (!g.index) { const n = g.attributes.position.count, idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(idx); }
  if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** Shapes merged per material: [{ geo, m }]. */
export function mergeByMaterial(prims) {
  const by = new Map();
  for (const p of prims) { const g = normalise(primGeometry(p)); if (!by.has(p.m)) by.set(p.m, []); by.get(p.m).push(g); }
  return [...by.entries()].map(([m, gs]) => ({ m, geo: gs.length === 1 ? gs[0] : mergeGeometries(gs) }));
}

/** A group of meshes for a list of shapes; mats(name) gives the material. */
export function meshGroup(prims, mats) {
  const grp = new Group();
  for (const { m, geo } of mergeByMaterial(prims)) {
    const mesh = new Mesh(geo, mats(m));
    mesh.castShadow = true; mesh.receiveShadow = true;
    grp.add(mesh);
  }
  return grp;
}

/** Splits a geometry with groups (non-indexed) into one geometry per group: [{ geo, mat }]. */
export function splitGroups(geo) {
  const out = [];
  for (const gr of geo.groups) {
    const g = new BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = geo.attributes[name]; if (!a) continue;
      g.setAttribute(name, new Float32BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
    }
    out.push({ geo: normalise(g), mat: gr.materialIndex });
  }
  return out;
}

/** A fastener's head: a hex (nut or bolt), a Torx or Allen socket head, a hose clip, a quick-release pin. */
export function fastenerGeometry(f) {
  const s = f.size / 1000;
  let g;
  if (f.drive === 'filter') return null;                      // the filter canister is the part itself
  if (f.drive === 'pin' || f.drive === 'dzus') g = new CylinderGeometry(0.008, 0.008, 0.012, 12);
  else if (f.drive === 'clamp') g = new BoxGeometry(0.012, 0.01, 0.006);
  else if (f.drive === 'torx' || f.drive === 'allen') g = new CylinderGeometry(0.006, 0.006, 0.004, 12);
  else g = new CylinderGeometry(s / Math.sqrt(3), s / Math.sqrt(3), Math.max(0.006, s * 0.65), 6);
  // stand it along its axis
  const ax = new Vector3(...f.axis).normalize();
  _q.setFromUnitVectors(new Vector3(0, 1, 0), ax);
  g.applyMatrix4(_m.compose(_p.set(...f.pos), _q, _s));
  return normalise(g);
}
