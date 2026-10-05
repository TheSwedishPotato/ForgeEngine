import { BufferGeometry, Float32BufferAttribute, CylinderGeometry, IcosahedronGeometry, LatheGeometry, SphereGeometry, CapsuleGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';
import { indexed } from '../engine/geometry/LOD.js';

/**
 * Procedural models for the scenery, detailed enough to hold up close and
 * meant to be reduced by the LOD chain at distance:
 *  - a Norway spruce: tiers of drooping, ragged branch skirts round a trunk
 *  - an autumn broadleaf (lime/oak-like): forked trunk, branches, lumpy leaf clumps
 *  - an onlooker: tunic, belt, arms, head and a hood or a hat
 * Vertex colours carry ambient occlusion (darker inside the crown, at the
 * foot of the trunk), multiplied by the per-instance colour.
 */

function colorize(geo, fn) {
  const p = geo.attributes.position, n = p.count;
  const c = new Float32Array(n * 3);
  const v = new Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(p, i); const k = fn(v, i); c[i * 3] = k[0]; c[i * 3 + 1] = k[1]; c[i * 3 + 2] = k[2]; }
  geo.setAttribute('color', new Float32BufferAttribute(c, 3));
  return geo;
}
function strip(geo) {
  // merge-compatible attribute set
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

/** Norway spruce, ~9 m at scale 1. */
export function spruceGeometry(seed = 7) {
  const r = rng(seed);
  const parts = [];
  const trunk = new CylinderGeometry(0.12, 0.32, 9.5, 10, 6);
  trunk.translate(0, 4.75, 0);
  colorize(trunk, (v) => { const k = 0.55 + 0.45 * Math.min(1, v.y / 3); return [0.42 * k, 0.32 * k, 0.24 * k]; });
  parts.push(strip(trunk));
  const tiers = 13;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = 1.6 + f * 7.6;
    const radius = 2.4 * Math.pow(1 - f, 0.9) + 0.25;
    const segs = 18;
    // a drooping skirt: rings from the trunk outwards, sagging at the tips, ragged edge
    const rings = 4;
    const pos = [], col = [], idx = [];
    for (let k = 0; k <= rings; k++) {
      const u = k / rings;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2 + t * 0.7;
        const jag = 1 + (k === rings ? (r() - 0.5) * 0.35 + 0.15 * Math.sin(a * 7 + t) : 0);
        const rr = radius * u * jag;
        const droop = 0.65 * u * u * radius * 0.45 + 0.35 * u;
        pos.push(Math.cos(a) * rr, y - droop + (r() - 0.5) * 0.06, Math.sin(a) * rr);
        const shade = 0.45 + 0.55 * u;   // darker toward the trunk
        col.push(0.20 * shade, 0.30 * shade, 0.17 * shade);
      }
    }
    const row = segs + 1;
    for (let k = 0; k < rings; k++) for (let s = 0; s < segs; s++) {
      const a = k * row + s, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
      idx.push(a, b, c, b, d, c);   // both faces: the skirt is seen from below too
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

/** Autumn broadleaf, ~8 m. */
export function broadleafGeometry(seed = 11) {
  const r = rng(seed);
  const parts = [];
  const bark = (g) => colorize(g, (v) => { const k = 0.5 + 0.5 * Math.min(1, v.y / 2.5); return [0.36 * k, 0.30 * k, 0.24 * k]; });
  const trunk = new CylinderGeometry(0.22, 0.4, 3.4, 10, 4);
  trunk.translate(0, 1.7, 0);
  parts.push(strip(bark(trunk)));
  const tips = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + r() * 0.6;
    const tilt = 0.55 + r() * 0.35;
    const len = 2.6 + r() * 1.2;
    const br = new CylinderGeometry(0.07, 0.17, len, 7, 3);
    br.translate(0, len / 2, 0);
    br.rotateZ(-tilt);
    br.rotateY(a);
    br.translate(0, 3.0 + r() * 0.5, 0);
    parts.push(strip(bark(br)));
    tips.push(new Vector3(Math.sin(tilt) * len, 3.2 + Math.cos(tilt) * len, 0).applyAxisAngle(new Vector3(0, 1, 0), a));
  }
  const centre = new Vector3(0, 5.6, 0);
  const clumps = [...tips, centre, new Vector3(0, 7.0, 0), ...tips.map((t) => t.clone().lerp(centre, 0.5).add(new Vector3(0, 0.6, 0)))];
  for (const c of clumps) {
    const rad = 1.3 + r() * 0.9;
    const s = indexed(strip(new IcosahedronGeometry(rad, 3)));   // weld first so the bumps stay closed
    const p = s.attributes.position;
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      const bump = 1 + 0.18 * Math.sin(n.x * 9 + c.x) * Math.sin(n.y * 8 + c.y) * Math.sin(n.z * 7) + (r() - 0.5) * 0.12;
      v.copy(n).multiplyScalar(rad * bump);
      v.y *= 0.82;
      p.setXYZ(i, v.x + c.x, v.y + c.y, v.z + c.z);
    }
    s.computeVertexNormals();
    colorize(s, (vv) => {
      // occlusion: darker inside and underneath the crown
      const d = vv.clone().sub(centre).length() / 4;
      const under = Math.min(1, Math.max(0, (vv.y - 3.5) / 3));
      const k = 0.35 + 0.65 * Math.min(1, d) * (0.6 + 0.4 * under);
      return [k, k, k];
    });
    parts.push(strip(s));
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

/**
 * An onlooker, ~1.7 m, in parts so each can carry its own instance colour:
 * body (belted tunic flaring to the knee, arms), head, hood with liripipe, brimmed hat.
 */
export function onlookerParts() {
  const body = [];
  const prof = [[0.001, 0.0], [0.11, 0.02], [0.12, 0.42], [0.2, 0.55], [0.21, 0.75], [0.19, 0.95], [0.21, 1.2], [0.2, 1.33], [0.08, 1.42], [0.001, 1.44]].map(([x, y]) => new Vector2(x, y));
  const tunic = new LatheGeometry(prof, 16);
  tunic.scale(1, 1, 0.78);
  // hose below the hem darker, folds darker toward the belt
  colorize(tunic, (v) => { const k = v.y < 0.42 ? 0.45 : 0.72 + 0.28 * Math.min(1, (v.y - 0.4) / 0.9); return [k, k, k]; });
  body.push(strip(tunic));
  const belt = new CylinderGeometry(0.205, 0.205, 0.05, 16, 1, true);
  belt.scale(1, 1, 0.8);
  belt.translate(0, 0.98, 0);
  colorize(belt, () => [0.25, 0.2, 0.16]);
  body.push(strip(belt));
  for (const s of [-1, 1]) {
    const arm = new CapsuleGeometry(0.055, 0.5, 4, 8);
    arm.rotateZ(s * 0.12);
    arm.translate(s * 0.25, 1.05, 0.02);
    colorize(arm, (v) => { const k = 0.6 + 0.4 * Math.min(1, (v.y - 0.8) / 0.4); return [k, k, k]; });
    body.push(strip(arm));
  }
  const head = new SphereGeometry(0.105, 16, 12);
  head.scale(1, 1.12, 1);
  head.translate(0, 1.56, 0.01);
  colorize(head, (v) => { const k = 0.85 + 0.15 * Math.min(1, (v.y - 1.45) / 0.2); return [k, k, k]; });
  const hood = new SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hood.translate(0, 1.58, -0.015);
  const liri = new CylinderGeometry(0.03, 0.06, 0.32, 6);
  liri.rotateX(0.9);
  liri.translate(0, 1.62, -0.2);
  const hoodG = mergeGeometries([strip(colorize(hood, () => [1, 1, 1])), strip(colorize(liri, () => [0.9, 0.9, 0.9]))]);
  const brim = new CylinderGeometry(0.2, 0.2, 0.02, 18);
  brim.translate(0, 1.65, 0);
  const crown = new CylinderGeometry(0.09, 0.115, 0.13, 16);
  crown.translate(0, 1.72, 0);
  const hatG = mergeGeometries([strip(colorize(brim, () => [1, 1, 1])), strip(colorize(crown, () => [0.9, 0.9, 0.9]))]);
  const out = { body: mergeGeometries(body), head: strip(head), hood: hoodG, hat: hatG };
  for (const g of Object.values(out)) g.computeBoundingSphere();
  return out;
}
