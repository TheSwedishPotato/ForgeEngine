import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subdivide, applyStencils, applyStencilsSkin, subdivideLevels } from '../src/human/Subdivision.js';

// A unit cube of six quads.
const P = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
const Q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
const faces = { start: Uint32Array.from([0, 4, 8, 12, 16, 20, 24]), idx: Uint32Array.from(Q.flat()) };

test('cube: counts and stencil rows sum to one', () => {
  const s = subdivide(8, faces);
  assert.equal(s.count, 8 + 12 + 6);
  assert.equal(s.quads.v.length / 4, 24);
  for (let i = 0; i < s.count; i++) {
    let sum = 0;
    for (let j = s.stencils.start[i]; j < s.stencils.start[i + 1]; j++) sum += s.stencils.w[j];
    assert.ok(Math.abs(sum - 1) < 1e-6, `row ${i} sums to ${sum}`);
  }
});

test('cube: corner moves to the known Catmull-Clark position', () => {
  const s = subdivide(8, faces);
  const out = applyStencils(s.stencils, Float32Array.from(P), 3, s.count);
  // valence 3 corner: (Q + 2R) / 3 with Q = (1/3,1/3,1/3), R = (1/6,1/6,1/6) -> 2/9
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(out[c] - 2 / 9) < 1e-6);
});

test('open quad keeps its boundary corners and edge midpoints', () => {
  const s = subdivide(4, { start: Uint32Array.from([0, 4]), idx: Uint32Array.from([0, 1, 2, 3]) });
  const out = applyStencils(s.stencils, Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3, s.count);
  assert.deepEqual(Array.from(out.slice(0, 3)), [0, 0, 0]);
  // edge 0-1 midpoint
  const mids = [];
  for (let i = 4; i < 8; i++) mids.push([out[i * 3], out[i * 3 + 1]]);
  assert.ok(mids.some(([x, y]) => Math.abs(x - 0.5) < 1e-6 && Math.abs(y) < 1e-6));
});

test('skin weights stay normalised; two levels compose', () => {
  const J = new Uint8Array(32), W = new Float32Array(32);
  for (let v = 0; v < 8; v++) { J[v * 4] = v < 4 ? 0 : 1; W[v * 4] = 1; }
  const s = subdivideLevels(8, faces, null, 2);
  assert.equal(s.count, 98);
  const sk = applyStencilsSkin(s.stencils, J, W, s.count);
  for (let i = 0; i < s.count; i++) {
    const sum = sk.weights[i * 4] + sk.weights[i * 4 + 1] + sk.weights[i * 4 + 2] + sk.weights[i * 4 + 3];
    assert.ok(Math.abs(sum - 1) < 1e-5);
  }
});

test('face-varying uvs: centre uv is the face mean', () => {
  const uv = Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]);
  const s = subdivide(4, { start: Uint32Array.from([0, 4]), idx: Uint32Array.from([0, 1, 2, 3]) }, { uv, tidx: Uint32Array.from([0, 1, 2, 3]) });
  const c = s.quads.t[2];
  assert.ok(Math.abs(s.uv[c * 2] - 0.5) < 1e-6 && Math.abs(s.uv[c * 2 + 1] - 0.5) < 1e-6);
});
