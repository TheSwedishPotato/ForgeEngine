/**
 * The forests of the Reuss valley, as trees.
 *
 * Where ESA WorldCover marks tree cover (20 m cells), trees stand about every 5-6 m,
 * jittered, each with its own height and lean. The canton's forest is some 85 % conifer,
 * naturally dominated by Norway spruce; broadleaves (beech, sycamore, ash) mix in on the
 * low slopes and give out above ~1100 m, and larch joins the spruce toward the tree line.
 * In December the broadleaves and the larches are bare. Nothing grows on the cleared
 * railway corridor, on cliffs or in the river.
 *
 * Spruces are whorls of drooping branch cards (a drawn branch: needles, hanging twigs, snow on
 * top; alpha-tested, so they cast true shadows), thinning to a crossed impostor far away; the
 * bare trees are branches with fans of fine twig cards. Trees are made in 250 m blocks round
 * the camera and drawn with the Med Engine's LOD instancer; beyond ~1 km the terrain's own
 * forest texture takes over.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3, Euler, MeshStandardMaterial, Group, DoubleSide } from 'three';
import { LODInstancer } from '../../../duel1403/src/engine/geometry/LOD.js';
import { spruceAtlas, bareAtlas } from './treeArt.js';

const BLOCK = 250;
const REACH = 1050;          // trees are made within this distance of the camera

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A quad (two triangles) a-b-c-d with the uv rectangle [u0,v0]-[u1,v1] (a at u0,v1; b u1,v1; c u1,v0; d u0,v0). */
function quad(P, N, UV, a, b, c, d, u0, v0, u1, v1) {
  const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();
  for (const [p, u, v] of [[a, u0, v1], [b, u1, v1], [c, u1, v0], [a, u0, v1], [c, u1, v0], [d, u0, v0]]) { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); UV.push(u, v); }
}
function finish(P, N, UV) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new Float32BufferAttribute(UV, 2));
  g.computeBoundingSphere();
  return g;
}
const BARK = [0.0, 0.469, 0.5, 0.5];        // the bark strip of the atlases
const upv = new Vector3(0, 1, 0);
function cylinder(P, N, UV, from, dir, len, r0, r1, segs) {
  const q = new Quaternion().setFromUnitVectors(upv, dir.clone().normalize());
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const pts = [[a0, 0, r0], [a1, 0, r0], [a1, len, r1], [a0, len, r1]].map(([a, y, rr]) => new Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr).applyQuaternion(q).add(from));
    quad(P, N, UV, pts[3], pts[2], pts[1], pts[0], ...BARK);
  }
}

/**
 * A mature Norway spruce, 10 m at scale 1 (instances 17-30 m): a straight trunk, the lower
 * quarter bare (dense forest), then whorls of drooping branches to a narrow spire. Each branch
 * is a hanging card of the branch texture, and (near) a lying one, so it reads from the side
 * and from above.
 */
export function spruceCards(seed = 7, { tiers = 22, branches = 7, cross = true } = {}) {
  const r = rng(seed);
  const P = [], N = [], UV = [];
  cylinder(P, N, UV, new Vector3(), upv, 10, 0.2, 0.03, 6);
  const base = 2.4, top = 9.9;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = base + f * (top - base);
    const L = 1.65 * Math.pow(1 - f, 0.9) + 0.18;
    const n = Math.max(3, Math.round(branches * (0.55 + 0.45 * (1 - f))));
    for (let k = 0; k < n; k++) {
      const az = (k / n) * Math.PI * 2 + t * 2.4 + (r() - 0.5) * 0.4;
      const dir = new Vector3(Math.cos(az), 0, Math.sin(az));
      const side = new Vector3(-dir.z, 0, dir.x);
      const droop = 0.12 + 0.25 * (1 - f) + (r() - 0.5) * 0.08;
      const along = dir.clone().multiplyScalar(L * Math.cos(droop)).add(new Vector3(0, -L * Math.sin(droop), 0));
      const h = L * 0.5;
      const root = new Vector3(dir.x * 0.08, y, dir.z * 0.08), tip = root.clone().add(along);
      const down = new Vector3(0, -h * 0.75, 0).addScaledVector(side, (r() - 0.5) * h * 0.3);
      const up = new Vector3(0, h * 0.25, 0);
      quad(P, N, UV, root.clone().add(up), tip.clone().add(up), tip.clone().add(down), root.clone().add(down), 0, 0.5, 0.5, 1);
      if (cross) {
        const w = side.clone().multiplyScalar(h * 0.55), lift = new Vector3(0, 0.02, 0);
        quad(P, N, UV, root.clone().sub(w).add(lift), tip.clone().sub(w), tip.clone().add(w), root.clone().add(w).add(lift), 0, 0.5, 0.5, 1);
      }
    }
  }
  return finish(P, N, UV);
}

/** The impostor: two crossed upright cards with the whole tree on them. */
export function spruceImpostor() {
  const P = [], N = [], UV = [];
  const w = 1.9, h = 10.3;
  for (const a of [0, Math.PI / 2]) {
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
    quad(P, N, UV, new Vector3(-dx, h, -dz), new Vector3(dx, h, dz), new Vector3(dx, 0, dz), new Vector3(-dx, 0, -dz), 0.5, 0, 0.75, 1);
  }
  return finish(P, N, UV);
}

/**
 * A tree bare for the winter (beech, sycamore; or a larch), 10 m at scale 1: trunk and two
 * orders of branches, and fans of fine twig cards at the ends of the branches.
 */
export function bareTree(seed = 11, { conifer = false, detail = 1 } = {}) {
  const r = rng(seed);
  const P = [], N = [], UV = [];
  const twigCard = (at, dir, size) => {
    const d = dir.clone().normalize();
    let s = new Vector3(-d.z, 0, d.x);
    if (s.lengthSq() < 0.01) s.set(1, 0, 0);
    s.normalize();
    const u = s.multiplyScalar(size * 0.5), v = d.clone().multiplyScalar(size);
    quad(P, N, UV, at.clone().sub(u).add(v), at.clone().add(u).add(v), at.clone().add(u), at.clone().sub(u), 0, 0.5, 0.5, 1);
  };
  const H = conifer ? 10 : 7.2;
  const trunkDir = new Vector3((r() - 0.5) * 0.05, 1, (r() - 0.5) * 0.05).normalize();
  cylinder(P, N, UV, new Vector3(), trunkDir, H, 0.22, 0.05, Math.max(4, Math.round(7 * detail)));
  const nMain = conifer ? Math.round(12 * detail) + 2 : Math.round(6 * detail) + 1;
  for (let i = 0; i < nMain; i++) {
    const t = conifer ? 0.22 + 0.74 * (i / nMain) : 0.38 + 0.55 * r();
    const p = trunkDir.clone().multiplyScalar(H * t);
    const az = r() * Math.PI * 2;
    const tilt = conifer ? 1.55 + r() * 0.2 : 0.55 + r() * 0.5;
    const d = new Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const L = conifer ? 1.9 * (1 - t) + 0.3 : H * (0.32 + 0.22 * r());
    cylinder(P, N, UV, p, d, L, conifer ? 0.045 : 0.1, conifer ? 0.02 : 0.05, conifer ? 3 : 5);
    const end = p.clone().addScaledVector(d, L);
    if (!conifer && detail >= 0.6) {
      for (let k = 0; k < (detail >= 1 ? 3 : 2); k++) {
        const d2 = d.clone().lerp(new Vector3(r() - 0.5, 0.8, r() - 0.5).normalize(), 0.5).normalize();
        const p2 = p.clone().addScaledVector(d, L * (0.4 + 0.5 * r()));
        cylinder(P, N, UV, p2, d2, L * 0.5, 0.045, 0.02, 3);
        twigCard(p2.clone().addScaledVector(d2, L * 0.25), d2, L * 0.75);
      }
    }
    twigCard(end.clone().addScaledVector(d, -L * 0.25), d.clone().add(new Vector3(0, conifer ? -0.35 : 0.3, 0)), conifer ? L * 0.9 : L * 0.8);
  }
  return finish(P, N, UV);
}

// ---------------------------------------------------------------------------------------------

export class Forest {
  constructor(stage, terrain, route, weather) {
    this.stage = stage; this.T = terrain; this.route = route;
    this.group = new Group();
    this.group.name = 'forest';
    stage.scene.add(this.group);
    this.blocks = new Map();
    this.queue = [];
    this.setWeather(weather);
  }

  setWeather(weather) {
    const p = weather.p;
    const snow = p.snowfall > 0 ? 0.95 : p.id === 'fog' ? 1.0 : p.id === 'foehn' ? 0.0 : 0.45;
    this.snow = snow;
    // the species: LOD levels (finest first) and their distances for a unit-scale tree
    const fog = p.id === 'fog';
    const spruceTex = spruceAtlas(snow);
    const beechTex = bareAtlas({ bark: fog ? '#9a9aa0' : '#57534e', twig: fog ? '#d8dce4' : '#665d58' });
    const larchTex = bareAtlas({ bark: fog ? '#94908c' : '#4b4038', twig: fog ? '#d4d6da' : '#6a5a4c' });
    const mat = (map, foliage) => {
      const m = new MeshStandardMaterial({ map, alphaTest: 0.45, side: DoubleSide, roughness: 0.92 });
      if (foliage) m.userData.foliage = true;
      return m;
    };
    const lv = (geometry) => ({ geometry, triangles: geometry.attributes.position.count / 3 });
    const spruceLevels = (seed) => [lv(spruceCards(seed)), lv(spruceCards(seed, { tiers: 13, branches: 5, cross: false })), lv(spruceCards(seed, { tiers: 7, branches: 4, cross: false })), lv(spruceImpostor())];
    this.species = [
      { name: 'spruce', chain: spruceLevels(7), mat: mat(spruceTex, true), dist: [7, 20, 45, Infinity] },
      { name: 'spruce2', chain: spruceLevels(23), mat: mat(spruceTex, true), dist: [7, 20, 45, Infinity] },
      { name: 'broadleaf', chain: [lv(bareTree(11)), lv(bareTree(11, { detail: 0.6 })), lv(bareTree(11, { detail: 0.3 }))], mat: mat(beechTex, false), dist: [10, 32, Infinity] },
      { name: 'larch', chain: [lv(bareTree(31, { conifer: true })), lv(bareTree(31, { conifer: true, detail: 0.5 })), lv(bareTree(31, { conifer: true, detail: 0.25 }))], mat: mat(larchTex, false), dist: [10, 32, Infinity] },
    ];
    for (const b of this.blocks.values()) this._disposeBlock(b);
    this.blocks.clear();
  }

  /** Distance to the nearest track (m), from the terrain's track segments. */
  _trackDist(x, y) {
    const T = this.T, S = T.samples;
    let best = 1e9;
    for (const k of T._segmentsIn(x - 20, y - 20, x + 20, y + 20)) {
      const a = k * 4, b = a + 4;
      const dx = S[b] - S[a], dy = S[b + 1] - S[a + 1], L2 = dx * dx + dy * dy || 1;
      let t = ((x - S[a]) * dx + (y - S[a + 1]) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(S[a] + dx * t - x, S[a + 1] + dy * t - y));
    }
    return best;
  }

  _makeBlock(bi, bj) {
    const T = this.T;
    const x0 = T.x0 + bi * BLOCK, y0 = T.y0 + bj * BLOCK;
    const lists = this.species.map(() => []);
    const st = T.lcStep;
    for (let cy = 0; cy < BLOCK / st; cy++) for (let cx = 0; cx < BLOCK / st; cx++) {
      const mx = x0 + (cx + 0.5) * st, my = y0 + (cy + 0.5) * st;
      if (T.coverAt(mx, my) !== 10) continue;
      // a 4 x 4 stratified grid in the 20 m cell, some places empty
      for (let s = 0; s < 16; s++) {
        const gi = Math.floor((mx - T.x0) / st * 4) + (s & 3), gj = Math.floor((my - T.y0) / st * 4) + (s >> 2);
        const h1 = hash2(gi, gj), h2 = hash2(gj + 7919, gi - 104729), h3 = hash2(gi * 31 + 17, gj * 17 - 5);
        if (h3 < 0.42) continue;
        const x = mx - st / 2 + ((s & 3) + 0.15 + 0.7 * h1) * (st / 4), y = my - st / 2 + ((s >> 2) + 0.15 + 0.7 * h2) * (st / 4);
        if (T._naturalSlope(x, y) > 1.25) continue;                // a cliff
        if (this._trackDist(x, y) < 11) continue;                  // the cleared corridor
        const z = T.heightAt(x, y);
        // species by altitude
        const pBroad = Math.max(0.03, Math.min(0.35, 0.35 - (z - 700) / 400 * 0.32));
        const pLarch = z > 1250 ? Math.min(0.4, 0.12 + (z - 1250) / 550 * 0.28) : 0.0;
        const u = hash2(gi * 7 + 3, gj * 13 + 11);
        const sp = u < pBroad ? 2 : u < pBroad + pLarch ? 3 : (h1 < 0.5 ? 0 : 1);
        const height = sp >= 2 ? 14 + 10 * h2 : 17 + 13 * h2 * h2;          // m
        lists[sp].push({ x, y, z: z - 0.3, scale: height / 10, rot: h3 * 6.283, lean: (h1 - 0.5) * 0.06 });
      }
    }
    const group = new Group();
    group.name = `trees-${bi},${bj}`;
    const anchor = { x: x0, y: y0, z: T.coarseAt(x0 + BLOCK / 2, y0 + BLOCK / 2) };
    const m = new Matrix4(), q = new Quaternion(), e = new Euler(), pos = new Vector3(), sc = new Vector3();
    const inst = [];
    lists.forEach((list, k) => {
      if (!list.length) return;
      const S = this.species[k];
      const li = new LODInstancer(S.chain.map((c, i) => ({ geometry: c.geometry, distance: S.dist[i] })), S.mat, list.length, { name: `${S.name}-${bi},${bj}`, shadowLevel: Math.min(2, S.chain.length - 1), shadowDistance: 160 });
      list.forEach((t, i) => {
        e.set(t.lean, t.rot, t.lean * 0.7);
        q.setFromEuler(e);
        pos.set(t.x - anchor.x, t.z - anchor.z, -(t.y - anchor.y));
        sc.setScalar(t.scale);
        m.compose(pos, q, sc);
        li.setInstance(i, m);
      });
      group.add(li.group);
      inst.push(li);
    });
    this.stage.anchor(group, anchor);
    this.group.add(group);
    return { bi, bj, group, inst, n: lists.reduce((a, l) => a + l.length, 0) };
  }

  _disposeBlock(b) {
    this.stage.unanchor(b.group);
    this.group.remove(b.group);
    for (const li of b.inst) for (const mesh of li.group.children) mesh.dispose?.();
  }

  /** Makes and drops blocks around the camera (a few per call), and picks every tree's detail. */
  update(cameraWorld, budget = 3) {
    const st = this.stage, T = this.T;
    const cm = st.toMap(cameraWorld);
    const ci = Math.floor((cm.x - T.x0) / BLOCK), cj = Math.floor((cm.y - T.y0) / BLOCK);
    const R = Math.ceil(REACH / BLOCK);
    const want = [];
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      const bx = T.x0 + (i + 0.5) * BLOCK, by = T.y0 + (j + 0.5) * BLOCK;
      const d = Math.hypot(bx - cm.x, by - cm.y);
      if (d < REACH + BLOCK * 0.7) want.push({ i, j, d });
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set(want.map((w) => `${w.i},${w.j}`));
    for (const [k, b] of this.blocks) if (!keep.has(k)) { this._disposeBlock(b); this.blocks.delete(k); }
    let made = 0;
    for (const w of want) {
      const k = `${w.i},${w.j}`;
      if (this.blocks.has(k)) continue;
      if (made >= budget) break;
      this.blocks.set(k, this._makeBlock(w.i, w.j));
      made++;
    }
    const local = new Vector3();
    for (const b of this.blocks.values()) {
      local.copy(cameraWorld).sub(b.group.position);
      for (const li of b.inst) li.update(local);
    }
    return made;
  }

  get pending() { return false; }
  stats() { let n = 0; for (const b of this.blocks.values()) n += b.n; return { blocks: this.blocks.size, trees: n }; }
}
