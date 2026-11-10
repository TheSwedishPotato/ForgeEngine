// Per-pass GPU timing with timestamp queries. The absolute numbers depend on the device; what is checked is that the machinery
// is right: every pass of the frame is stamped under its own label, the stamps are read back without stalling, a heavier
// scene costs measurably more GPU time, and switching it on or off never invalidates a frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuContext, makePlatform } from './helpers.js';
import { Engine, Mesh, PlaneGeometry, SphereGeometry, StandardMaterial, DirectionalLight, GpuTimer } from '../../src/index.js';

const ctx = await gpuContext();
const skip = ctx ? false : 'WebGPU not available';

async function scene(n, { w = 256, h = 144 } = {}) {
  const engine = await Engine.create({ platform: makePlatform({ width: w, height: h }), quality: 'low' });
  const gpu = engine.stage.renderer.gpu;
  gpu.errors.length = 0;
  const { scene: sc, camera } = engine;
  const ground = new Mesh(new PlaneGeometry(40, 40), new StandardMaterial({ color: 0x808080, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);
  const geo = new SphereGeometry(0.25, 40, 24), mat = new StandardMaterial({ color: 0xcc3322, roughness: 0.4 });
  for (let i = 0; i < n; i++) {
    const m = new Mesh(geo, mat);
    m.position.set((i % 20) * 0.6 - 6, 0.25 + Math.floor(i / 20) * 0.55, -Math.floor(i / 100) * 0.6);
    m.castShadow = true; sc.add(m);
  }
  const sun = new DirectionalLight(0xfff0dd, 7); sun.position.set(-4, 8, 5); sun.castShadow = true; sc.add(sun);
  camera.position.set(0, 2, 9); camera.lookAt(0, 1, 0);
  engine.stage.fitCamera();
  return { engine, gpu };
}

test('GpuTimer: every pass of the frame is timed under its own label', { skip }, async () => {
  const { engine, gpu } = await scene(1);
  const r = engine.stage.renderer;
  if (!gpu.hasTimestamps) { assert.equal(engine.stage.enableGpuTiming(), false, 'no timestamp-query on this device: reported, not thrown'); engine.dispose(); return; }
  assert.equal(engine.stage.gpuTimes, null, 'off by default');
  assert.equal(engine.stage.enableGpuTiming(), true);
  const got = [];
  r.timer.onSample = (s) => got.push(s);
  // one frame at a time, waiting for its read-back: every frame is measured exactly once. (Queue frames faster than the GPU finishes
  // them and the ring of result buffers fills: those frames are skipped, never waited for - the last test covers that.)
  for (let i = 0; i < 24; i++) { engine.run(1, 1 / 60); await r.timer.flush(); }
  assert.equal(r.timer.samples, 24, 'frames measured');
  assert.equal(got.length, r.timer.samples, 'onSample fires once per measured frame');
  const t = engine.stage.gpuTimes;
  for (const name of ['gbuffer', 'lighting']) assert.ok(name in t.passes, `${name} is timed (${Object.keys(t.passes).join(', ')})`);
  assert.ok(Object.keys(t.passes).some((n) => n.startsWith('shadow cascade')), 'shadow cascades are timed');
  assert.ok(Object.keys(t.passes).length >= 6, `${Object.keys(t.passes).length} passes in a frame`);
  for (const [n, ms] of Object.entries(t.passes)) assert.ok(ms >= 0 && ms < 5000, `${n}: ${ms} ms`);
  assert.ok(t.spanMs > 0 && t.sumMs > 0);
  assert.ok(t.spanMs >= Math.max(...Object.values(t.passes)) - 1e-6, 'the frame span covers its longest pass');
  assert.ok(Object.values(r.timer.last.passes).every((v) => Number.isFinite(v)));
  assert.deepEqual(gpu.errors, [], 'no WebGPU validation errors');
  engine.dispose();
});

test('GpuTimer: a heavier scene costs measurably more GPU time', { skip }, async () => {
  const light = await scene(2), heavy = await scene(900);
  if (!light.gpu.hasTimestamps) { light.engine.dispose(); heavy.engine.dispose(); return; }
  const measure = async ({ engine }) => {
    engine.stage.enableGpuTiming();
    engine.run(5, 1 / 60);
    await engine.stage.renderer.timer.flush();
    engine.stage.renderer.timer.samples = 0;
    engine.run(20, 1 / 60);
    await engine.stage.renderer.timer.flush();
    return engine.stage.gpuTimes;
  };
  const a = await measure(light), b = await measure(heavy);
  assert.ok(b.passes.gbuffer > a.passes.gbuffer * 1.5, `gbuffer: ${a.passes.gbuffer.toFixed(2)} ms for 2 spheres, ${b.passes.gbuffer.toFixed(2)} ms for 900`);
  assert.ok(b.spanMs > a.spanMs, `frame span ${a.spanMs.toFixed(2)} -> ${b.spanMs.toFixed(2)} ms`);
  assert.deepEqual(light.gpu.errors, []); assert.deepEqual(heavy.gpu.errors, []);
  light.engine.dispose(); heavy.engine.dispose();
});

test('GpuTimer: on, off and on again; more frames in flight than result buffers; the picture is unchanged', { skip }, async () => {
  const plain = await scene(5), timed = await scene(5);
  if (!timed.gpu.hasTimestamps) { plain.engine.dispose(); timed.engine.dispose(); return; }
  timed.engine.stage.enableGpuTiming();
  plain.engine.run(40, 1 / 60); timed.engine.run(40, 1 / 60);       // 40 frames queued without waiting: the ring (6) is exceeded and frames are skipped, not broken
  const a = await plain.engine.screenshot(), b = await timed.engine.screenshot();
  assert.equal(a.data.length, b.data.length);
  let diff = 0; for (let i = 0; i < a.data.length; i++) diff += Math.abs(a.data[i] - b.data[i]);
  assert.ok(diff / a.data.length < 0.5, `timing does not change the picture (mean difference ${(diff / a.data.length).toFixed(3)} of 255)`);
  assert.equal(timed.engine.stage.enableGpuTiming(false), false);
  assert.equal(timed.engine.stage.gpuTimes, null);
  timed.engine.run(5, 1 / 60);
  assert.equal(timed.engine.stage.enableGpuTiming(true), true);
  timed.engine.run(10, 1 / 60);
  await timed.engine.stage.renderer.timer.flush();
  assert.ok(timed.engine.stage.renderer.timer.samples > 0);
  assert.deepEqual(timed.gpu.errors, []); assert.deepEqual(plain.gpu.errors, []);
  plain.engine.dispose(); timed.engine.dispose();
});

test('GpuTimer: a frame with more passes than maxPasses still draws and says how many were not timed; reset() forgets', { skip }, async () => {
  const { engine, gpu } = await scene(3);
  if (!gpu.hasTimestamps) { engine.dispose(); return; }
  const r = engine.stage.renderer;
  r.timer = new GpuTimer(gpu, { maxPasses: 4 });
  for (let i = 0; i < 4; i++) { engine.run(1, 1 / 60); await r.timer.flush(); }
  assert.ok(r.timer.untimed > 4, `${r.timer.untimed} passes did not fit`);
  assert.equal(Object.keys(r.timer.last.passes).length <= 4, true, 'only the first four are in the numbers');
  const img = await engine.screenshot();
  assert.ok(img.data.some((v) => v > 0), 'the frame itself is drawn in full');
  assert.ok(r.timer.samples > 0);
  r.timer.reset();
  assert.equal(r.timer.samples, 0);
  assert.deepEqual(r.timer.avg, { spanMs: 0, sumMs: 0, passes: {} });
  assert.deepEqual(gpu.errors, []);
  engine.dispose();
});

test('GpuTimer: exported, and without timestamp support it just reports unsupported', { skip }, async () => {
  assert.equal(typeof GpuTimer, 'function');
  const fake = { hasTimestamps: false };
  const t = new GpuTimer(fake);
  assert.equal(t.supported, false);
  assert.equal(t.begin({}), null);
  await t.flush;                                                    // nothing to wait for
  t.dispose();
});
