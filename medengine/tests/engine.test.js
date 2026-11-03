import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textToVisemes, visemeTrack, speechDuration, EMOTIONS, VISEMES } from '../src/human/Face.js';
import { blendPose, completePose, addPose, NEUTRAL } from '../src/human/Rig.js';
import { parseJSON, sampleOptions } from '../src/ai/Claude.js';
import { FACE_UNITS, toHalf, tuckUnder } from '../src/human/Human.js';

test('visemes: closed lips for p/b/m, open for vowels, pauses at punctuation', () => {
  const v = textToVisemes('Pull me up!').map((x) => x.v);
  assert.equal(v[0], 'PP');
  assert.ok(v.includes('U'));
  assert.ok(v.includes('PP'));
  assert.equal(v[v.length - 1], 'sil');
  const tr = visemeTrack('Eleven minutes.', 1.5);
  assert.ok(Math.abs(tr[tr.length - 1].t1 - 1.5) < 1e-9);
  for (let i = 1; i < tr.length; i++) assert.ok(tr[i].t0 >= tr[i - 1].t0);
});

test('speech duration grows with words and pauses', () => {
  assert.ok(speechDuration('Go.') < speechDuration('It\'s Vesper. It\'s always raining. That isn\'t an answer.'));
  assert.ok(speechDuration('Hello there', 0.5) > speechDuration('Hello there', 1));
});

test('emotions and visemes only use real face units', () => {
  const units = new Set(FACE_UNITS);
  for (const set of [EMOTIONS, VISEMES]) for (const shape of Object.values(set)) for (const k of Object.keys(shape)) assert.ok(units.has(k), k);
  assert.equal(FACE_UNITS.length, 52);
});

test('poses blend, complete and add', () => {
  const a = { spine: [0, 0, 0], armL: { hand: [0, -0.5, 0] } }, b = { spine: [10, 20, 0], armL: { hand: [0, 0, 0.5] } };
  const m = blendPose(a, b, 0.5);
  assert.deepEqual(m.spine, [5, 10, 0]);
  assert.deepEqual(m.armL.hand, [0, -0.25, 0.25]);
  const c = completePose({ head: [5, 0, 0] });
  assert.deepEqual(c.head, [5, 0, 0]);
  assert.deepEqual(c.legL.foot, NEUTRAL.legL.foot);
  addPose(c, { head: [1, 2, 3] });
  assert.deepEqual(c.head, [6, 2, 3]);
});

test('Claude JSON is read tolerantly', () => {
  assert.deepEqual(parseJSON('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJSON('Sure:\n```json\n{"mapped": "ready"}\n```'), { mapped: 'ready' });
  assert.deepEqual(parseJSON('Here you go {"x": [1,2]} done'), { x: [1, 2] });
  assert.throws(() => parseJSON('no json here'));
});

test('half floats', () => {
  const back = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15); };
  for (const v of [0, 0.001, -0.0123, 0.5, 1, -2.25, 0.00006]) assert.ok(Math.abs(back(toHalf(v)) - v) <= Math.abs(v) * 1e-3 + 1e-7, String(v));
});

test('layered clothes: what an outer layer covers is drawn in under it, the rest stays', () => {
  // an inner sheet along x (normals +z) and an outer patch over its left half, 5 mm out
  const geo = (pts, n) => ({ attributes: { position: { array: Float32Array.from(pts.flat()) }, normal: { array: Float32Array.from(pts.flatMap(() => n)) } } });
  const xs = Array.from({ length: 21 }, (_, i) => (i - 10) * 0.02);   // index 10 is x = 0
  const inner = geo(xs.map((x) => [x, 0, 0]), [0, 0, 1]);
  const outer = geo(xs.slice(0, 11).map((x) => [x, 0, 0.005]), [0, 0, 1]);
  tuckUnder([inner, outer], { reach: 0.03, depth: 0.016 });
  const z = (i) => inner.attributes.position.array[i * 3 + 2];
  assert.ok(Math.abs(z(0) + 0.016) < 1e-6, 'covered: tucked');
  assert.ok(Math.abs(z(11) + 0.016) < 1e-6, 'within reach of the edge: tucked');
  assert.equal(z(15), 0, 'open: untouched');
  assert.ok(outer.attributes.position.array.every((v, i) => i % 3 !== 2 || Math.abs(v - 0.005) < 1e-9), 'the outer layer never moves');
});

test('artifact sample options: only members that are set, never cached', () => {
  assert.deepEqual(sampleOptions({ modelTier: 'quick' }), { modelTier: 'quick', cache: false });
  const ctl = new AbortController(), onText = () => {};
  assert.deepEqual(sampleOptions({ modelTier: 'default', onText, signal: ctl.signal }), { modelTier: 'default', cache: false, onText, signal: ctl.signal });
  assert.ok(!('signal' in sampleOptions({ modelTier: 'quick', signal: undefined })));
  assert.ok(!('onText' in sampleOptions({ modelTier: 'quick', onText: undefined })));
});
