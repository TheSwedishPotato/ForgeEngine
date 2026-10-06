import {
  BufferGeometry, Float32BufferAttribute, BoxGeometry, CylinderGeometry, SphereGeometry, ConeGeometry, TorusGeometry,
  LatheGeometry, Vector2, Matrix4, Euler, Quaternion, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Modelled things for the town: everything is real geometry (staves and
 * hoops on a barrel, spokes and felloes on a cart wheel, the timbers of a
 * house frame standing proud of the plaster), batched by material so the
 * whole town draws in a few dozen calls.
 *
 * Proportions follow the period's archaeology and pictures: a beer barrel
 * of about 80 l, a two-wheeled cart with 1.2 m wheels, oak frames on stone
 * sills, thatch 30 cm thick.
 */

const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _s = new Vector3(1, 1, 1), _p = new Vector3();

/** Collects geometries per material key; `build()` merges each group once. */
export class Batch {
  constructor() { this.groups = new Map(); }
  /** Add geo (consumed) at x,y,z turned ry about Y (and rx, rz). keepUV: leave its own UVs. */
  put(key, geo, x = 0, y = 0, z = 0, ry = 0, { rx = 0, rz = 0, keepUV = false, scale = null } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, scale ?? _s.set(1, 1, 1));
    g.applyMatrix4(_m);
    if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.userData.keepUV = keepUV;
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(g);
    return g;
  }
  /** Merged geometry per key, UVs box-projected in metres (times `uvScale[key]`) unless kept. */
  build(uvScale = {}) {
    const out = new Map();
    for (const [key, list] of this.groups) {
      const k = uvScale[key] ?? 1;
      for (const g of list) if (!g.userData.keepUV) boxUV(g, k);
      // normalise attribute sets so they merge
      for (const g of list) for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      out.set(key, mergeGeometries(list, false));
    }
    return out;
  }
}

/** UVs from world position, by the dominant axis of each face's normal (metres * k). */
export function boxUV(g, k = 1) {
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  for (let i = 0; i < P.count; i += 3) {
    // face normal from the triangle
    const ax = P.getX(i), ay = P.getY(i), az = P.getZ(i);
    const e1x = P.getX(i + 1) - ax, e1y = P.getY(i + 1) - ay, e1z = P.getZ(i + 1) - az;
    const e2x = P.getX(i + 2) - ax, e2y = P.getY(i + 2) - ay, e2z = P.getZ(i + 2) - az;
    const nx = Math.abs(e1y * e2z - e1z * e2y), ny = Math.abs(e1z * e2x - e1x * e2z), nz = Math.abs(e1x * e2y - e1y * e2x);
    for (let j = 0; j < 3; j++) {
      const x = P.getX(i + j), y = P.getY(i + j), z = P.getZ(i + j);
      if (ny >= nx && ny >= nz) U.setXY(i + j, x * k, z * k);
      else if (nx >= nz) U.setXY(i + j, z * k, y * k);
      else U.setXY(i + j, x * k, y * k);
    }
  }
  void N;
  U.needsUpdate = true;
}

const box = (w, h, d) => new BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 10, open = false) => new CylinderGeometry(r0, r1, h, n, 1, open);

// ---- vessels, sacks, wood ------------------------------------------------------------------

/** A coopered barrel: bulging staves (lathe) and three iron hoops. h ~0.8 m for 80 l. */
export function barrel(B, x, y, z, { h = 0.8, r = 0.27, lying = false, ry = 0 } = {}) {
  const prof = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new Vector2(r * (0.82 + 0.18 * Math.sin(Math.PI * t)), (t - 0.5) * h)); }
  const body = new LatheGeometry(prof, 14);
  const opt = lying ? { rz: Math.PI / 2 } : {};
  const cy = lying ? y + r : y + h / 2;
  B.put('stave', body, x, cy, z, ry, opt);
  for (const t of [0.12, 0.5, 0.88]) {
    const rr = r * (0.82 + 0.18 * Math.sin(Math.PI * t)) + 0.006;
    const hoop = cyl(rr, rr, 0.035, 14, true);
    hoop.translate(0, (t - 0.5) * h, 0);
    B.put('iron', hoop, x, cy, z, ry, opt);
  }
  for (const s of [-1, 1]) { const head = cyl(r * 0.8, r * 0.8, 0.02, 14); head.translate(0, s * (h / 2 - 0.03), 0); B.put('planks', head, x, cy, z, ry, opt); }
}

/** A tub or bucket (open). */
export function tub(B, x, y, z, { r = 0.35, h = 0.45, key = 'stave' } = {}) {
  B.put(key, cyl(r, r * 0.88, h, 14, true), x, y + h / 2, z);
  B.put('planks', cyl(r * 0.88, r * 0.88, 0.02, 14), x, y + 0.02, z);
  for (const t of [0.2, 0.8]) B.put('iron', cyl(r * (1 - 0.12 * t) + 0.005, r * (1 - 0.12 * t) + 0.005, 0.03, 14, true), x, y + h * (1 - t), z);
}

export function crate(B, x, y, z, { w = 0.6, h = 0.45, d = 0.45, ry = 0 } = {}) {
  B.put('planks', box(w, h, d), x, y + h / 2, z, ry);
  // corner battens
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.put('beam', box(0.05, h + 0.01, 0.05), x + (sx * (w / 2 - 0.02)) * Math.cos(ry) + (sz * (d / 2 - 0.02)) * Math.sin(ry), y + h / 2, z - (sx * (w / 2 - 0.02)) * Math.sin(ry) + (sz * (d / 2 - 0.02)) * Math.cos(ry), ry);
}

/** A lumpy grain sack. */
export function sack(B, x, y, z, { s = 1, ry = 0, seed = 1 } = {}) {
  const g = new SphereGeometry(0.24 * s, 10, 8);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const px = P.getX(i), py = P.getY(i), pz = P.getZ(i);
    const n = 1 + 0.08 * Math.sin(px * 31 + seed) * Math.cos(pz * 27 + seed * 2);
    P.setXYZ(i, px * n * 0.95, py * (py > 0 ? 1.5 : 0.9) * n, pz * n * 0.8);
  }
  g.computeVertexNormals();
  B.put('sack', g, x, y + 0.22 * s, z, ry);
  B.put('sack', cyl(0.06 * s, 0.09 * s, 0.1 * s, 8), x, y + 0.6 * s, z, ry);
}

/** Split logs stacked against a wall (along x, local), under a little roof of boards. */
export function woodpile(B, x, y, z, { len = 2.4, h = 1.1, ry = 0 } = {}) {
  const c = Math.cos(ry), s = Math.sin(ry);
  let k = 0;
  for (let row = 0; row * 0.13 < h; row++) {
    for (let i = 0; i * 0.14 < len; i++) {
      const lx = -len / 2 + 0.07 + i * 0.14 + (row % 2) * 0.07, ly = y + 0.07 + row * 0.13;
      const log = cyl(0.062, 0.062, 0.42, 6);
      log.rotateX(Math.PI / 2);
      B.put(k++ % 3 ? 'log' : 'logEnd', log, x + lx * c, ly, z - lx * s, ry);
    }
  }
  B.put('planks', box(len + 0.3, 0.04, 0.7), x, y + h + 0.25, z, ry, { rx: 0.2 });
}

/** A two-wheeled farm cart with shafts, standing tipped forward on its shafts. */
export function cart(B, x, y, z, { ry = 0 } = {}) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const R = 0.62;
  for (const side of [-1, 1]) {
    const [wx, wz] = at(side * 0.78, 0);
    // felloe ring, hub, spokes
    const rim = new TorusGeometry(R - 0.04, 0.045, 6, 20); rim.rotateY(Math.PI / 2);
    B.put('beam', rim, wx, y + R, wz, ry);
    const tyre = new TorusGeometry(R, 0.018, 4, 24); tyre.rotateY(Math.PI / 2);
    B.put('iron', tyre, wx, y + R, wz, ry);
    const hub = cyl(0.09, 0.09, 0.26, 10); hub.rotateZ(Math.PI / 2);
    B.put('beam', hub, wx, y + R, wz, ry);
    for (let i = 0; i < 10; i++) {
      const sp = cyl(0.022, 0.026, R - 0.08, 5); sp.translate(0, (R - 0.08) / 2, 0); sp.rotateX((i / 10) * Math.PI * 2);
      B.put('beam', sp, wx, y + R, wz, ry);
    }
  }
  // axle, bed, side rails with staves, shafts (tilted: the cart rests on them)
  const tilt = -0.16;
  const ax = cyl(0.05, 0.05, 1.7, 8); ax.rotateZ(Math.PI / 2);
  B.put('beam', ax, x, y + R, z, ry);
  const bedY = y + R + 0.12;
  B.put('planks', box(1.3, 0.05, 2.3), x, bedY, z, ry, { rx: tilt });
  for (const side of [-1, 1]) {
    const [rx2, rz2] = at(side * 0.66, 0);
    B.put('beam', box(0.06, 0.06, 2.3), rx2, bedY + 0.42, rz2, ry, { rx: tilt });
    for (let i = 0; i < 6; i++) { const lz = -1.0 + i * 0.4; const [px, pz] = at(side * 0.66, lz); B.put('beam', box(0.04, 0.42, 0.04), px, bedY + 0.21 - lz * Math.sin(tilt), pz, ry, { rx: tilt }); }
    const [sx2, sz2] = at(side * 0.45, 1.95);
    B.put('beam', box(0.07, 0.07, 2.2), sx2, y + 0.38, sz2, ry, { rx: tilt * 1.9 });
  }
}

/** A trestle bench or table. */
export function bench(B, x, y, z, { w = 1.8, h = 0.45, d = 0.32, ry = 0, key = 'planks' } = {}) {
  const c = Math.cos(ry), s = Math.sin(ry);
  B.put(key, box(w, 0.06, d), x, y + h, z, ry);
  for (const sx of [-1, 1]) {
    const lx = sx * (w / 2 - 0.18);
    for (const a of [-0.28, 0.28]) B.put('beam', box(0.05, h, 0.05), x + lx * c, y + h / 2, z - lx * s, ry, { rx: a });
  }
}

export function stool(B, x, y, z, { h = 0.45 } = {}) {
  B.put('planks', cyl(0.18, 0.18, 0.05, 10), x, y + h, z);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; B.put('beam', cyl(0.025, 0.025, h, 5), x + Math.cos(a) * 0.12, y + h / 2, z + Math.sin(a) * 0.12, 0, { rx: Math.sin(a) * 0.18, rz: -Math.cos(a) * 0.18 }); }
}

/** A hollowed log trough. */
export function trough(B, x, y, z, { len = 2.2, ry = 0 } = {}) {
  const t = cyl(0.3, 0.3, len, 10, false); t.rotateZ(Math.PI / 2); t.scale(1, 0.75, 1);
  B.put('log', t, x, y + 0.24, z, ry);
  const w = box(len - 0.2, 0.02, 0.36); B.put('water', w, x, y + 0.42, z, ry);
}

/** A haystack: a rounded cone of hay on a pole. */
export function haystack(B, x, y, z, { r = 1.6, h = 3.2 } = {}) {
  const prof = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new Vector2(r * Math.sin(Math.PI * (0.08 + 0.9 * (1 - t)) / 1.6) * (1 - t * 0.85), t * h)); }
  B.put('hay', new LatheGeometry(prof, 16), x, y, z);
  B.put('beam', cyl(0.04, 0.04, 0.8, 5), x, y + h + 0.2, z);
}

/** Wattle fence: posts with woven rods, from (x0,z0) to (x1,z1). */
export function wattle(B, x0, z0, x1, z1, y, { h = 1.0 } = {}) {
  const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
  const n = Math.max(2, Math.ceil(len / 0.9));
  for (let i = 0; i <= n; i++) { const t = i / n; B.put('log', cyl(0.035, 0.04, h + 0.15, 5), x0 + (x1 - x0) * t, y + (h + 0.15) / 2, z0 + (z1 - z0) * t); }
  for (let k = 0; k < 6; k++) B.put('wattle', box(len, 0.06, 0.04), (x0 + x1) / 2, y + 0.18 + k * (h - 0.25) / 5, (z0 + z1) / 2, ry);
}

/** Things for sale: loaves, pots, cloth bolts, shoes on a board. */
export function goods(B, kind, x, y, z, { ry = 0, n = 6 } = {}) {
  const c = Math.cos(ry), s = Math.sin(ry);
  for (let i = 0; i < n; i++) {
    const lx = -0.5 + (i % 3) * 0.5, lz = -0.15 + Math.floor(i / 3) * 0.3;
    const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
    if (kind === 'bread') { const g = new SphereGeometry(0.11, 10, 6); g.scale(1.3, 0.6, 1); B.put('bread', g, px, y + 0.06, pz, ry); }
    else if (kind === 'pots') { const prof = [new Vector2(0, 0), new Vector2(0.08, 0), new Vector2(0.12, 0.08), new Vector2(0.1, 0.18), new Vector2(0.07, 0.22), new Vector2(0.075, 0.24)]; B.put('pottery', new LatheGeometry(prof, 10), px, y, pz); }
    else if (kind === 'cloth') { const g = cyl(0.09, 0.09, 0.55, 10); g.rotateZ(Math.PI / 2); B.put(i % 2 ? 'clothRed' : 'clothBlue', g, px, y + 0.09 + (i > 2 ? 0.17 : 0), z + (i % 3 - 1) * 0.2, ry); }
    else if (kind === 'meat') { const g = new SphereGeometry(0.12, 8, 6); g.scale(0.8, 1.4, 0.7); B.put('meat', g, px, y - 0.2, pz); B.put('iron', cyl(0.006, 0.006, 0.25, 4), px, y + 0.02, pz); }
    else if (kind === 'shoes') { const g = box(0.1, 0.07, 0.26); B.put('leather', g, px, y + 0.035, pz, ry); }
    else if (kind === 'apples') { B.put('apple', new SphereGeometry(0.045, 6, 5), px * 0.4 + x * 0.6, y + 0.04, pz * 0.4 + z * 0.6); }
  }
}

/** A market stall: a trestle counter with an awning on four posts. */
export function stall(B, x, y, z, { ry = 0, ware = 'bread', awning = 'awning' } = {}) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [cx, cz] = at(0, 0);
  B.put('planks', box(2.4, 0.06, 1.0), cx, y + 0.9, cz, ry);
  B.put('planks', box(2.4, 0.5, 0.04), ...withY(at(0, -0.5), y + 0.62), ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [px, pz] = at(sx * 1.15, sz * 0.48); const hh = sz < 0 ? 2.3 : 2.0; B.put('beam', box(0.08, hh, 0.08), px, y + hh / 2, pz, ry); }
  const aw = box(2.7, 0.03, 1.5); B.put(awning, aw, cx, y + 2.18, cz, ry, { rx: 0.2 });
  goods(B, ware, cx, y + 0.93, cz, { ry });
}
function withY([x, z], y) { return [x, y, z]; }

/** An ale-stake: the bush on a pole that marks a tavern selling. */
export function aleStake(B, x, y, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const pole = cyl(0.04, 0.04, 1.6, 6); pole.rotateZ(Math.PI / 2);
  B.put('beam', pole, x + 0.8 * c, y, z - 0.8 * s, ry);
  const bush = new SphereGeometry(0.35, 8, 6); const P = bush.attributes.position;
  for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) * (1 + 0.25 * Math.sin(i * 7.1)), P.getY(i) * (1 + 0.25 * Math.cos(i * 5.3)), P.getZ(i) * (1 + 0.2 * Math.sin(i * 3.7)));
  bush.computeVertexNormals();
  B.put('leaves', bush, x + 1.6 * c, y - 0.2, z - 1.6 * s);
}

/** A well: stone drum, two posts, a windlass with rope and bucket, a little shingled roof. */
export function well(B, x, y, z, { ry = 0 } = {}) {
  B.put('stone', cyl(0.85, 0.9, 0.85, 18, true), x, y + 0.42, z);
  B.put('stone', cyl(0.62, 0.62, 0.86, 18, true), x, y + 0.42, z);
  const lip = new TorusGeometry(0.74, 0.13, 6, 18); lip.rotateX(Math.PI / 2);
  B.put('stone', lip, x, y + 0.86, z);
  B.put('water', cyl(0.62, 0.62, 0.02, 18), x, y + 0.2, z);
  const c = Math.cos(ry), s = Math.sin(ry);
  for (const sd of [-1, 1]) B.put('beam', box(0.14, 2.3, 0.14), x + sd * 0.82 * c, y + 1.15, z - sd * 0.82 * s, ry);
  const wl = cyl(0.09, 0.09, 1.5, 8); wl.rotateZ(Math.PI / 2);
  B.put('log', wl, x, y + 1.7, z, ry);
  const crank = box(0.04, 0.32, 0.04); B.put('iron', crank, x + 0.86 * c, y + 1.55, z - 0.86 * s, ry);
  B.put('rope', cyl(0.012, 0.012, 0.9, 4), x, y + 1.25, z);
  tubAt(B, x, y + 0.72, z);
  for (const sd of [-1, 1]) { const r = box(2.1, 0.03, 0.85); B.put('shingleProp', r, x - sd * 0.38 * s, y + 2.48, z - sd * 0.38 * c, ry, { rx: sd * 0.55 }); }
}
function tubAt(B, x, y, z) { B.put('stave', cyl(0.14, 0.12, 0.24, 10, true), x, y, z); B.put('iron', cyl(0.145, 0.145, 0.02, 10, true), x, y + 0.08, z); }

/** The pillory: a stone step, a post and a hinged board with holes for neck and wrists. */
export function pillory(B, x, y, z) {
  B.put('stone', cyl(0.75, 0.85, 0.35, 8), x, y + 0.17, z);
  B.put('stone', cyl(0.55, 0.65, 0.25, 8), x, y + 0.47, z);
  B.put('beam', box(0.24, 2.6, 0.24), x, y + 1.9, z);
  for (const dy of [0, 0.12]) B.put('planks', box(1.3, 0.12, 0.08), x, y + 1.65 + dy, z + 0.17);
  for (const dx of [-0.4, 0, 0.4]) B.put('dark', cyl(dx ? 0.05 : 0.09, dx ? 0.05 : 0.09, 0.1, 10), x + dx, y + 1.71, z + 0.17, 0, { rx: Math.PI / 2 });
  B.put('iron', box(0.08, 0.3, 0.1), x + 0.7, y + 1.71, z + 0.17);
  const cap = new ConeGeometry(0.35, 0.4, 4); B.put('shingleProp', cap, x, y + 3.4, z, Math.PI / 4);
}

/** A privy: plank hut with a lean roof and a heart-less door (that came later). */
export function privy(B, x, y, z, ry = 0) {
  B.put('planks', box(1.2, 2.1, 1.2), x, y + 1.05, z, ry);
  B.put('shingleProp', box(1.5, 0.05, 1.5), x, y + 2.2, z, ry, { rx: 0.2 });
  B.put('dark', box(0.62, 1.7, 0.03), x - Math.sin(ry) * 0.61, y + 0.9, z - Math.cos(ry) * 0.61, ry);
}

/** A dung heap by a farmstead. */
export function dungHeap(B, x, y, z) {
  const g = new SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.45, 0.8);
  const P = g.attributes.position; for (let i = 0; i < P.count; i++) P.setY(i, P.getY(i) * (1 + 0.15 * Math.sin(i * 4.1)));
  g.computeVertexNormals();
  B.put('dung', g, x, y, z);
}

/** A grave: a mound and a wooden cross. */
export function grave(B, x, y, z, ry = 0) {
  const m = new SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2); m.scale(0.9, 0.35, 1.9);
  B.put('earthProp', m, x, y, z, ry);
  B.put('beam', box(0.08, 1.1, 0.06), x, y + 0.55, z + 0.9 * Math.cos(ry), ry);
  B.put('beam', box(0.5, 0.07, 0.06), x, y + 0.8, z + 0.9 * Math.cos(ry), ry);
}

void Vector3;
