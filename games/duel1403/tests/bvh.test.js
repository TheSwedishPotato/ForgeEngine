// The BVH finds the same nearest hits as testing every triangle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBVH } from '../src/engine/scene/BVH.js';

function rng(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function hitTri(P, t, o, d) {
  const b = t * 12;
  const v0 = [P[b], P[b + 1], P[b + 2]], e1 = [P[b + 4] - v0[0], P[b + 5] - v0[1], P[b + 6] - v0[2]], e2 = [P[b + 8] - v0[0], P[b + 9] - v0[1], P[b + 10] - v0[2]];
  const cr = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]], dt = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const p = cr(d, e2), det = dt(e1, p);
  if (Math.abs(det) < 1e-12) return -1;
  const s = [o[0] - v0[0], o[1] - v0[1], o[2] - v0[2]], u = dt(s, p) / det;
  if (u < 0 || u > 1) return -1;
  const q = cr(s, e1), v = dt(d, q) / det;
  if (v < 0 || u + v > 1) return -1;
  return dt(e2, q) / det;
}
function trace({ nodes, tris }, P, o, d) {
  const inv = d.map((x) => 1 / (x || 1e-12));
  let best = Infinity, stack = [0];
  while (stack.length) {
    const n = nodes[stack.pop()];
    let tn = 0, tf = best;
    for (let k = 0; k < 3; k++) { let a = (n.min[k] - o[k]) * inv[k], b = (n.max[k] - o[k]) * inv[k]; if (a > b) [a, b] = [b, a]; tn = Math.max(tn, a); tf = Math.min(tf, b); }
    if (tn > tf) continue;
    if (n.b < 0) { for (let i = n.a; i < n.a - n.b; i++) { const t = hitTri(P, tris[i], o, d); if (t > 1e-6 && t < best) best = t; } }
    else stack.push(n.a, n.b);
  }
  return best;
}
test('BVH nearest hits equal brute force', () => {
  const R = rng(5), N = 3000, P = new Float32Array(N * 12);
  for (let t = 0; t < N; t++) {
    const cx = (R() - 0.5) * 80, cy = R() * 10, cz = (R() - 0.5) * 80;
    for (let k = 0; k < 3; k++) { P[t * 12 + k * 4] = cx + (R() - 0.5) * 3; P[t * 12 + k * 4 + 1] = cy + (R() - 0.5) * 3; P[t * 12 + k * 4 + 2] = cz + (R() - 0.5) * 3; }
  }
  const bvh = buildBVH(P, N);
  assert.ok(bvh.nodes.length > 100);
  let checked = 0;
  for (let i = 0; i < 300; i++) {
    const o = [(R() - 0.5) * 100, 5 + R() * 20, (R() - 0.5) * 100];
    let d = [(R() - 0.5), -R(), (R() - 0.5)]; const l = Math.hypot(...d); d = d.map((x) => x / l);
    let brute = Infinity;
    for (let t = 0; t < N; t++) { const h = hitTri(P, t, o, d); if (h > 1e-6 && h < brute) brute = h; }
    const fast = trace(bvh, P, o, d);
    if (brute < Infinity) checked++;
    assert.ok(Math.abs(fast - brute) < 1e-4 || (fast === Infinity && brute === Infinity), `ray ${i}: ${fast} vs ${brute}`);
  }
  assert.ok(checked > 50);
});
