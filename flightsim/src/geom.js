// Geometry helpers: profile sweeps, lofts, rounded-rect tunnels, colour merging.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Sweep a 2D profile [[x,y],...] along z from z0 to z1. UV: u along z (metres/uScale), v along profile arc.
export function sweepProfile(profile, z0, z1, { segZ = 1, uScale = 1, vScale = 1, flipX = false, uOffset = 0, invert = false } = {}) {
  const n = profile.length;
  const pos = [], uv = [], idx = [];
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  for (let j = 0; j <= segZ; j++) {
    const z = z0 + (z1 - z0) * j / segZ;
    for (let i = 0; i < n; i++) {
      pos.push(flipX ? -profile[i][0] : profile[i][0], profile[i][1], z);
      uv.push((z - z0) / uScale + uOffset, arc[i] / vScale);
    }
  }
  for (let j = 0; j < segZ; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if (flipX !== invert) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Loft of ellipses along y: rings [{y, rx, rz, x=0, z=0}], segs around. Caps optional.
// u wraps around starting at the back (-z) so u=0.5 faces +z.
export function loft(rings, segs = 10, { capTop = true, capBottom = true } = {}) {
  const pos = [], uv = [], idx = [];
  const n = rings.length;
  for (let j = 0; j < n; j++) {
    const r = rings[j];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push((r.x || 0) - Math.sin(a) * r.rx, r.y, (r.z || 0) - Math.cos(a) * r.rz);
      uv.push(i / segs, j / (n - 1));
    }
  }
  const row = segs + 1;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const addCap = (j, up) => {
    const r = rings[j]; const ci = pos.length / 3;
    pos.push(r.x || 0, r.y, r.z || 0); uv.push(0.5, up ? 1 : 0);
    for (let i = 0; i < segs; i++) { const a = j * row + i, b = a + 1; if (up) idx.push(a, b, ci); else idx.push(b, a, ci); }
  };
  if (capTop) addCap(n - 1, true);
  if (capBottom) addCap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Rounded rectangle loop in local (a,b) coordinates, n points.
export function rrLoop(w, h, r, n = 32) {
  const pts = [];
  const cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
  const per = n / 4;
  for (const [cx, cy, a0] of cs) for (let i = 0; i < per; i++) {
    const a = a0 + (i / (per - 1)) * Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// Tunnel between two 3D loops (same count). Faces point inward (towards the tunnel axis) when inward = true.
export function tunnel(loopA, loopB, inward = true) {
  const n = loopA.length, pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = loopA[i % n], b = loopB[i % n];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(i / n, 0, i / n, 1);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (inward) idx.push(a, b, c, c, b, d); else idx.push(a, c, b, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Planar polygon (fan) from 3D loop.
export function capLoop(loop, flip = false) {
  const n = loop.length, pos = [], idx = [];
  const c = new THREE.Vector3(); loop.forEach((p) => c.add(p)); c.divideScalar(n);
  pos.push(c.x, c.y, c.z);
  loop.forEach((p) => pos.push(p.x, p.y, p.z));
  for (let i = 0; i < n; i++) { const a = 1 + i, b = 1 + ((i + 1) % n); if (flip) idx.push(0, b, a); else idx.push(0, a, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = []; for (let i = 0; i <= n; i++) uv.push(0.5, 0.5);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const _c = new THREE.Color();
// Set per-vertex colour (and flat UV if requested) on a geometry; returns non-indexed-safe geometry.
export function colorize(g, color, { flatUV = null, uvScale = null } = {}) {
  _c.set(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (flatUV) { const uv = g.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, flatUV[0], flatUV[1]); }
  if (uvScale) { const uv = g.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale); }
  return g;
}

// Merge a list of {geo, color, matrix?} into one geometry with vertex colours.
export function mergeColored(parts, opts = {}) {
  const geos = [];
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (p.matrix) g.applyMatrix4(p.matrix);
    if (!g.attributes.color || p.color !== undefined) colorize(g, p.color ?? '#ffffff', { flatUV: p.flatUV ?? opts.flatUV });
    else if (!g.attributes.uv) colorize(g, '#ffffff');
    geos.push(g);
  }
  const m = mergeGeometries(geos, false);
  return m;
}

export const M4 = () => new THREE.Matrix4();
export function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  return m;
}
