// The benchmark's own machinery: argument parsing, the statistics, the adapter check, the report table and the CPU-only scene.
// (tests/gpu/bench.test.js runs the drawn scenes.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { NodePlatform } from '../src/platform/node.js';
import { Engine } from '../src/index.js';
import { summarize, describeAdapter, runScene } from '../bench/run.js';
import { parseArgs, table } from '../bench/bench.mjs';
import { SCENES, SCENE_NAMES } from '../bench/scenes.js';

const ROOT = new URL('../', import.meta.url).pathname;

test('summarize: mean, median, p95, p99 and max of a list', () => {
  const s = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(s.mean, 50.5);
  assert.equal(s.median, 51);
  assert.equal(s.p95, 96);
  assert.equal(s.p99, 100);
  assert.equal(s.max, 100);
  assert.equal(summarize([]), null);
  assert.deepEqual(summarize([5]), { mean: 5, median: 5, p95: 5, p99: 5, max: 5 });
  const unsorted = summarize([9, 1, 5]);
  assert.equal(unsorted.median, 5); assert.equal(unsorted.max, 9);
});

test('describeAdapter: software renderers are recognised, real GPUs are not', () => {
  const adapter = (info, extra = {}) => ({ adapter: { info, ...extra }, hasTimestamps: true });
  assert.equal(describeAdapter(adapter({ vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader driver' })).software, true);
  assert.equal(describeAdapter(adapter({ description: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).software, true);
  assert.equal(describeAdapter(adapter({ vendor: 'nvidia', architecture: 'ada', description: 'NVIDIA GeForce RTX 4070' })).software, false);
  assert.equal(describeAdapter(adapter({ vendor: 'apple', architecture: 'metal-3', description: 'Apple M2' })).software, false);
  assert.equal(describeAdapter(adapter({ vendor: 'amd', description: 'AMD Radeon' }, { isFallbackAdapter: true })).software, true, 'a fallback adapter is software whatever it is called');
  assert.equal(describeAdapter(adapter({ description: 'x' })).timestamps, true);
  assert.equal(describeAdapter({ hasTimestamps: false }).timestamps, false);
  assert.equal(describeAdapter(null).software, false);
});

test('parseArgs: defaults, every option, and clear errors', () => {
  const d = parseArgs([]);
  assert.deepEqual([d.size, d.quality, d.frames, d.warmup, d.software, d.scenes, d.json], [[1280, 720], 'high', 120, 30, false, null, null]);
  const o = parseArgs(['--scenes', 'ford,physics', '--size', '1920x1080', '--quality', 'low', '--frames', '10', '--warmup', '0', '--json', 'x.json', '--software']);
  assert.deepEqual(o, { scenes: ['ford', 'physics'], size: [1920, 1080], quality: 'low', frames: 10, warmup: 0, json: 'x.json', software: true });
  assert.throws(() => parseArgs(['--size', 'big']), /WIDTHxHEIGHT/);
  assert.throws(() => parseArgs(['--frames', '0']), /at least 1/);
  assert.throws(() => parseArgs(['--frames']), /wants a number/);
  assert.throws(() => parseArgs(['--nonsense']), /unknown option/);
});

test('table: one row per scene, columns aligned, missing numbers shown as a dash', () => {
  const r = (scene, o = {}) => ({ scene, msPerFrame: 16.6667, fps: 60, cpu: { simMs: { median: 1.234 }, renderMs: { median: 12.5 } }, gpu: { spanMs: { median: 8.1 } }, renderer: { drawCalls: 120, triangles: 1234567 }, ...o });
  const t = table([r('ford'), r('physics', { cpu: { simMs: { median: 2.6 }, renderMs: null }, gpu: null, renderer: null })]).split('\n');
  assert.equal(t.length, 4);
  assert.match(t[0], /^scene\s+ms\/frame\s+fps\s+cpu sim\s+cpu draw\s+gpu span\s+draws\s+triangles$/);
  assert.match(t[2], /^ford\s+16\.7\s+60\s+1\.23\s+12\.5\s+8\.10\s+120\s+1,234,567$/);
  assert.match(t[3], /^physics\s+16\.7\s+60\s+2\.60\s+-\s+-\s+-\s+-$/);
  assert.equal(new Set(t.filter((l, i) => i !== 1).map((l) => l.length)).size, 1, 'all rows are as wide as the header');
});

test('the scene list: every scene says what it is and whether it needs a GPU', () => {
  assert.deepEqual(SCENE_NAMES, ['ford', 'crowd', 'lights', 'draws', 'physics']);
  for (const n of SCENE_NAMES) { assert.ok(SCENES[n].about.length > 20, n); assert.equal(typeof SCENES[n].needsGPU, 'boolean'); assert.equal(typeof SCENES[n].build, 'function'); }
  assert.equal(SCENES.physics.needsGPU, false);
});

test('runScene on the physics scene (no GPU): 400 bodies really are simulated and timed', async () => {
  const engine = await Engine.create({ platform: new NodePlatform(), render: false, baseUrl: ROOT });
  const r = await runScene(engine, 'physics', { frames: 25, warmup: 5, scene: { count: 400 } });
  assert.equal(r.scene, 'physics');
  assert.equal(r.frames, 25);
  assert.equal(r.bodies, 400);
  assert.equal(r.gpu, null); assert.equal(r.renderer, null);
  assert.equal(r.cpu.renderMs, null);
  assert.equal(r.cpu.simMs.mean > 0, true);
  assert.ok(r.cpu.simMs.median <= r.cpu.simMs.p95 && r.cpu.simMs.p95 <= r.cpu.simMs.max);
  assert.ok(r.msPerFrame > 0 && Math.abs(r.fps - 1000 / r.msPerFrame) < 1e-6);
  // the work was real: the last body starts at y = 14.97 and has had 30 frames (0.5 s) of gravity, about a metre of fall
  const top = engine.physics.bodies.at(-1).position.y;
  assert.ok(top < 14.2 && top > 12, `the highest body fell from 14.97 to ${top.toFixed(2)}`);
  await assert.rejects(() => runScene(engine, 'no-such-scene'), /unknown scene/);
  engine.dispose();
});
