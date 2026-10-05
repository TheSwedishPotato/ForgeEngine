import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SphereGeometry, PlaneGeometry } from 'three';
import { simplify } from '../src/engine/geometry/Simplify.js';

const arrays = (g) => ({ pos: g.attributes.position.array, idx: Uint32Array.from(g.index.array) });

test('simplifies a sphere to the target with small error', () => {
  const g = new SphereGeometry(1, 64, 32);
  const { pos, idx } = arrays(g);
  // the UV seam duplicates vertices; weld-free run: seam and poles are borders and stay locked
  const r = simplify(pos, idx, 600);
  const tris = r.indices.length / 3;
  assert.ok(tris < idx.length / 3 / 3, `reduced (${tris})`);
  // every vertex is an original one on the sphere; the faces should stay close to it
  let worst = 0;
  for (let i = 0; i < r.indices.length; i += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { const v = r.indices[i + k]; cx += pos[v * 3] / 3; cy += pos[v * 3 + 1] / 3; cz += pos[v * 3 + 2] / 3; }
    worst = Math.max(worst, 1 - Math.hypot(cx, cy, cz));
  }
  assert.ok(worst < 0.06, `faces deviate ${worst.toFixed(3)} from the sphere`);
});

test('flat plane collapses to almost nothing with zero error', () => {
  const g = new PlaneGeometry(10, 10, 40, 40);
  const { pos, idx } = arrays(g);
  const r = simplify(pos, idx, 2);
  assert.ok(r.indices.length / 3 < 200, `got ${r.indices.length / 3}`);
  assert.ok(r.error < 1e-4);
});

test('locked vertices are never removed', () => {
  const g = new PlaneGeometry(4, 4, 16, 16);
  const { pos, idx } = arrays(g);
  const lock = new Uint8Array(pos.length / 3);
  lock[100] = 1; lock[150] = 1;
  const r = simplify(pos, idx, 4, { lock });
  const used = new Set(r.indices);
  assert.ok(used.has(100) && used.has(150));
});

test('handles a 200k-triangle grid in reasonable time', () => {
  const g = new PlaneGeometry(100, 100, 316, 316);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) p[i + 2] = Math.sin(p[i] * 0.3) * Math.cos(p[i + 1] * 0.2) * 2;
  const { pos, idx } = arrays(g);
  const t0 = performance.now();
  const r = simplify(pos, idx, idx.length / 3 / 8);
  const ms = performance.now() - t0;
  console.log(`  200k grid -> ${r.indices.length / 3} tris, error ${r.error.toFixed(4)} m, ${ms.toFixed(0)} ms`);
  assert.ok(ms < 20000);
});
