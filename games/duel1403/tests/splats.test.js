// Splat smoke: puffs rise from their source, die, and pack valid covariances, sorted back to front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GaussianSplats } from '../src/engine/passes/GaussianSplats.js';

test('smoke rises, ages out and never runs backwards', () => {
  const S = new GaussianSplats({ max: 512 });
  S.setSources([{ x: 0, y: 5, z: 0, rate: 4 }, { x: 500, y: 5, z: 0, rate: 4 }]);   // the second is out of range
  for (let k = 0; k < 60; k++) S.simulate(1 / 30, { x: 0, z: 0 });
  assert.ok(S.live >= 6 && S.live <= 10, `live ${S.live}`);
  for (let i = 0; i < S.live; i++) { assert.ok(S.pos[i * 3 + 1] >= 5, 'rises'); assert.ok(Math.abs(S.pos[i * 3]) < 50, 'only the near source'); }
  for (let k = 0; k < 30 * 20; k++) S.simulate(1 / 30, { x: 0, z: 0 });
  for (let i = 0; i < S.live; i++) assert.ok(S.age[i] < S.life[i] && S.age[i] >= 0);
  assert.ok(S.live < 4 * 14, 'old puffs die');
});

test('packed covariances are positive definite and sorted far to near', () => {
  const S = new GaussianSplats({ max: 512 });
  S.setSources([{ x: 0, y: 5, z: 20, rate: 6 }]);
  for (let k = 0; k < 150; k++) S.simulate(1 / 30, { x: 0, z: 0 });
  // a camera at the origin looking down +z (three.js view matrix: forward is -row 2)
  const view = { elements: new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]) };
  const m = S._pack({ cameraPos: { x: 0, y: 0, z: 0 }, view });
  assert.ok(m > 0);
  let last = Infinity;
  for (let k = 0; k < m; k++) {
    const f = k * 16, I = S.inst;
    const [xx, xy, xz, yy, yz, zz] = [I[f + 4], I[f + 5], I[f + 6], I[f + 7], I[f + 8], I[f + 9]];
    const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
    assert.ok(xx > 0 && xx * yy - xy * xy > 0 && det > 0, 'positive definite');
    assert.ok(I[f + 3] >= 0 && I[f + 3] <= 1, 'opacity');
    assert.ok(I[f + 2] <= last + 1e-6, 'back to front');
    last = I[f + 2];
  }
});
