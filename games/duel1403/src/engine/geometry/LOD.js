import { BufferGeometry, BufferAttribute, InstancedMesh, Group, Matrix4, Vector3, Color } from 'three';
import { simplify } from './Simplify.js';

/**
 * Automatic level-of-detail chains and a distance-based LOD instancer.
 *
 * buildLODChain(geometry, ratios) simplifies an indexed geometry with the
 * QEM simplifier to each ratio of its triangle count; every level shares the
 * original vertex buffer (only the index buffer differs), so attributes such
 * as vertex colours survive untouched.
 */
export function buildLODChain(geometry, ratios = [1, 0.35, 0.12, 0.04]) {
  const g = geometry.index ? geometry : indexed(geometry);
  const pos = g.attributes.position.array;
  const idx = Uint32Array.from(g.index.array);
  const out = [];
  let prev = idx;
  for (const r of ratios) {
    if (r >= 1) { out.push({ geometry: g, triangles: idx.length / 3, error: 0 }); continue; }
    // simplify from the previous level: cheaper, and the chain stays nested
    const res = simplify(pos, prev, Math.max(4, Math.floor((idx.length / 3) * r)), { lockBorder: true });
    const lg = new BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) lg.setAttribute(name, a);
    lg.setIndex(new BufferAttribute(res.indices, 1));
    lg.boundingSphere = g.boundingSphere ?? (g.computeBoundingSphere(), g.boundingSphere);
    out.push({ geometry: lg, triangles: res.indices.length / 3, error: res.error });
    prev = res.indices;
  }
  return out;
}

/** Welds an unindexed geometry into an indexed one (positions only define identity). */
export function indexed(geo) {
  const pos = geo.attributes.position.array;
  const n = pos.length / 3;
  const map = new Map(), remap = new Uint32Array(n), keep = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    let j = map.get(k);
    if (j === undefined) { j = keep.length; map.set(k, j); keep.push(i); }
    remap[i] = j;
  }
  const g = new BufferGeometry();
  for (const [name, a] of Object.entries(geo.attributes)) {
    const s = a.itemSize, arr = new a.array.constructor(keep.length * s);
    keep.forEach((src, j) => { for (let c = 0; c < s; c++) arr[j * s + c] = a.array[src * s + c]; });
    g.setAttribute(name, new BufferAttribute(arr, s, a.normalized));
  }
  g.setIndex(new BufferAttribute(remap, 1));
  g.computeVertexNormals();
  return g;
}

const _p = new Vector3();

/**
 * Many instances of one object with an LOD chain: each frame every instance
 * is assigned the level its distance calls for (with 8% hysteresis against
 * flicker), and each level's InstancedMesh receives its instances.
 */
export class LODInstancer {
  /**
   * @param levels   [{ geometry, distance }] finest first; an instance uses the first level whose distance it is within
   * @param material shared material
   * @param count    number of instances
   */
  constructor(levels, material, count, { castShadow = true, name = 'lod', shadowLevel = Math.min(2, levels.length - 1), shadowDistance = 140 } = {}) {
    this.group = new Group();
    this.group.name = name;
    this.levels = levels;
    this.count = count;
    this.matrices = new Float32Array(count * 16);
    this.colors = null;
    this.positions = new Float32Array(count * 3);
    this.scales = new Float32Array(count).fill(1);
    this.assigned = new Int8Array(count).fill(-1);
    this.meshes = levels.map((l, i) => {
      const m = new InstancedMesh(l.geometry, material, count);
      m.count = 0;
      m.castShadow = false;   // shadows come from the coarse proxy below
      m.frustumCulled = false;
      m.name = `${name}-lod${i}`;
      // light-probe captures only need the coarsest level
      if (i < levels.length - 1) m.userData.captureSkip = true;
      this.group.add(m);
      return m;
    });
    // Shadow proxy: every instance within shadow range, at a coarse level.
    // Shadow maps are low-resolution views; a 300-triangle tree casts the same shadow.
    this.shadowDistance = shadowDistance;
    if (castShadow) {
      const sm = new InstancedMesh(levels[shadowLevel].geometry, material, count);
      sm.count = 0;
      sm.castShadow = true;
      sm.frustumCulled = false;
      sm.userData.shadowOnly = true;
      sm.userData.captureSkip = true;
      sm.name = `${name}-shadow`;
      this.group.add(sm);
      this.shadowMesh = sm;
    }
    this.lodBias = 1;
    this.stats = new Array(levels.length).fill(0);
  }

  setInstance(i, matrix, color = null) {
    this.matrices.set(matrix.elements, i * 16);
    _p.setFromMatrixPosition(matrix);
    this.positions[i * 3] = _p.x; this.positions[i * 3 + 1] = _p.y; this.positions[i * 3 + 2] = _p.z;
    this.scales[i] = Math.cbrt(Math.abs(matrix.determinant()));
    if (color) {
      if (!this.colors) this.colors = new Float32Array(this.count * 3).fill(1);
      this.colors[i * 3] = color.r; this.colors[i * 3 + 1] = color.g; this.colors[i * 3 + 2] = color.b;
    }
  }

  /** Re-buckets instances by distance from the camera. */
  update(cameraPos) {
    const L = this.levels.length;
    const counts = new Array(L).fill(0);
    let changed = false;
    for (let i = 0; i < this.count; i++) {
      const dx = this.positions[i * 3] - cameraPos.x, dy = this.positions[i * 3 + 1] - cameraPos.y, dz = this.positions[i * 3 + 2] - cameraPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / (this.scales[i] * this.lodBias);
      let lv = L - 1;
      for (let k = 0; k < L; k++) if (d < this.levels[k].distance) { lv = k; break; }
      // hysteresis: stay finer until clearly past the boundary
      const prev = this.assigned[i];
      if (prev >= 0 && prev < lv && d < this.levels[prev].distance * 1.08) lv = prev;
      if (prev !== lv) changed = true;
      this.assigned[i] = lv;
      counts[lv]++;
    }
    if (!changed && this._built) return;
    this._built = true;
    const fill = new Array(L).fill(0);
    let ns = 0;
    const sm = this.shadowMesh;
    for (let i = 0; i < this.count; i++) {
      if (sm) {
        const dx = this.positions[i * 3] - cameraPos.x, dz = this.positions[i * 3 + 2] - cameraPos.z;
        if (dx * dx + dz * dz < this.shadowDistance * this.shadowDistance) sm.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), (ns++) * 16);
      }
      const lv = this.assigned[i], m = this.meshes[lv], j = fill[lv]++;
      m.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), j * 16);
      if (this.colors) {
        if (!m.instanceColor) m.setColorAt(0, new Color(1, 1, 1));
        m.instanceColor.array.set(this.colors.subarray(i * 3, i * 3 + 3), j * 3);
      }
    }
    this.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.boundingSphere = null;
      m.visible = counts[k] > 0;
    });
    if (sm) { sm.count = ns; sm.instanceMatrix.needsUpdate = true; sm.boundingSphere = null; sm.visible = ns > 0; }
    this.stats = counts;
  }
}

void Matrix4;
