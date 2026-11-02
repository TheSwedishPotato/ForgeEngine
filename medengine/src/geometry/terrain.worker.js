// Builds the terrain meshes and their cluster hierarchies off the main thread.
import { buildDAG } from './ClusterDAG.js';
import { heightAt, microRelief } from '../../world/terrain.js';

/** Regular grid mesh over [x0,x0+size] x [z0,z0+size] with n cells per side. */
function grid(x0, z0, size, n, hf, skip = null) {
  const nv = (n + 1) * (n + 1);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const step = size / n;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = (j * (n + 1) + i) * 3;
    pos[k] = x; pos[k + 1] = hf(x, z); pos[k + 2] = z;
  }
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j * (n + 1) + i) * 3;
    const x = pos[k], z = pos[k + 2], e = step * 0.5;
    const dx = hf(x + e, z) - hf(x - e, z), dz = hf(x, z + e) - hf(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    nor[k] = -dx / l; nor[k + 1] = 2 * e / l; nor[k + 2] = -dz / l;
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
    if (skip && skip(cx, cz)) continue;
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    // alternate the diagonal so slopes don't show a grain
    if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  return { positions: pos, normals: nor, indices: Uint32Array.from(idx) };
}

self.onmessage = (e) => {
  const { patchHalf, patchN, landSize, landN } = e.data;
  const t0 = performance.now();
  const out = {};
  const patch = grid(-patchHalf, -patchHalf, patchHalf * 2, patchN, (x, z) => heightAt(x, z) + microRelief(x, z, patchHalf));
  const pd = buildDAG(patch.positions, patch.indices);
  out.patch = { positions: patch.positions, normals: patch.normals, indices: pd.indices, clusters: pd.clusters, count: pd.count, levels: pd.levels, sourceTris: patch.indices.length / 3 };
  self.postMessage({ progress: 'patch', ms: performance.now() - t0 });
  const land = grid(-landSize / 2, -landSize / 2, landSize, landN, heightAt, (x, z) => Math.abs(x) < patchHalf && Math.abs(z) < patchHalf);
  const ld = buildDAG(land.positions, land.indices);
  out.land = { positions: land.positions, normals: land.normals, indices: ld.indices, clusters: ld.clusters, count: ld.count, levels: ld.levels, sourceTris: land.indices.length / 3 };
  out.ms = performance.now() - t0;
  const transfer = [];
  for (const m of [out.patch, out.land]) transfer.push(m.positions.buffer, m.normals.buffer, m.indices.buffer, m.clusters.buffer);
  self.postMessage({ done: true, ...out }, transfer);
};
