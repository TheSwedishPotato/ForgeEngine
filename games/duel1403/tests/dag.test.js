import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaneGeometry } from 'three';
import { buildDAG, STRIDE } from '../src/engine/geometry/ClusterDAG.js';

function terrain(n) {
  const g = new PlaneGeometry(100, 100, n, n);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) p[i + 1] = Math.sin(p[i] * 0.2) * Math.cos(p[i + 2] * 0.15) * 3 + Math.sin(p[i] * 1.7 + p[i + 2]) * 0.2;
  return { pos: p, idx: Uint32Array.from(g.index.array) };
}

/** Same selection rule as the renderer: own error invisible, parent's visible. */
function cut(dag, cam, tau, scale) {
  const C = dag.clusters, sel = [];
  const proj = (e, x, y, z, r) => (e >= 3e38 ? Infinity : e * scale / Math.max(Math.hypot(x - cam[0], y - cam[1], z - cam[2]) - r, 0.1));
  for (let i = 0; i < dag.count; i++) {
    const o = i * STRIDE;
    if (proj(C[o + 2], C[o + 3], C[o + 4], C[o + 5], C[o + 6]) <= tau && proj(C[o + 7], C[o + 8], C[o + 9], C[o + 10], C[o + 11]) > tau) sel.push(i);
  }
  return sel;
}

test('builds a multi-level hierarchy whose cuts cover the surface without cracks', () => {
  const { pos, idx } = terrain(160);   // 51k triangles
  const t0 = performance.now();
  const dag = buildDAG(pos, idx);
  console.log(`  ${idx.length / 3} tris -> ${dag.count} clusters, ${dag.levels} levels, ${(performance.now() - t0).toFixed(0)} ms`);
  assert.ok(dag.levels >= 4);
  for (const [cam, tau] of [[[0, 5, 0], 1], [[0, 40, 0], 1], [[300, 50, 0], 1], [[0, 5, 0], 8]]) {
    const sel = cut(dag, cam, tau, 1000);
    // crack-free: every edge in the cut is either shared by two selected
    // triangles or lies on the outer border of the original mesh
    const edges = new Map();
    let tris = 0;
    for (const i of sel) {
      const o = i * STRIDE, st = dag.clusters[o], n = dag.clusters[o + 1];
      tris += n / 3;
      for (let k = st; k < st + n; k += 3) for (let e = 0; e < 3; e++) {
        const a = dag.indices[k + e], b = dag.indices[k + (e + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const [key, c] of edges) if (c === 1) {
      const [a, b] = key.split(',').map(Number);
      const onBorder = (v) => Math.abs(Math.abs(pos[v * 3]) - 50) < 1e-3 || Math.abs(Math.abs(pos[v * 3 + 2]) - 50) < 1e-3;
      if (!(onBorder(a) && onBorder(b))) open++;
    }
    console.log(`  cam ${cam} tau ${tau}: ${sel.length} clusters, ${tris} tris, open edges ${open}`);
    assert.equal(open, 0, 'cut has cracks');
    assert.ok(tris > 0);
  }
});
