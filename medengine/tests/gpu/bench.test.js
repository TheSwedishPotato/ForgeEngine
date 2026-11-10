// The benchmark on a real device: each drawn scene runs a few frames and reports sane CPU, GPU and renderer numbers.
// Small sizes and counts: this checks that the benchmark works, not how fast the device is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuContext, makePlatform } from './helpers.js';
import { Engine } from '../../src/index.js';
import { runScene, describeAdapter } from '../../bench/run.js';

const ctx = await gpuContext();
const skip = ctx ? false : 'WebGPU not available';
const ROOT = new URL('../../', import.meta.url).pathname;

const OPTIONS = { ford: {}, crowd: { count: 4 }, lights: { count: 24 }, draws: { side: 12 } };

for (const [name, scene] of Object.entries(OPTIONS)) {
  test(`bench scene "${name}": runs on the GPU and reports what it did`, { skip, timeout: 240000 }, async () => {
    const engine = await Engine.create({ platform: makePlatform({ width: 256, height: 144 }), quality: 'low', baseUrl: ROOT });
    const adapter = describeAdapter(engine.stage.renderer.gpu);
    const r = await runScene(engine, name, { frames: 10, warmup: 4, scene });
    assert.deepEqual(r.gpuErrors, [], 'no WebGPU validation errors');
    assert.equal(r.frames, 10);
    assert.ok(r.msPerFrame > 0 && r.fps > 0);
    assert.ok(r.cpu.simMs.median > 0 && r.cpu.renderMs.median > 0, 'both halves of the frame were timed');
    assert.ok(r.renderer.drawCalls > 5 && r.renderer.triangles > 100, `drew ${r.renderer.drawCalls} calls, ${r.renderer.triangles} triangles`);
    if (adapter.timestamps) {
      assert.ok(r.gpu && r.gpu.frames >= 8, `GPU frames measured: ${r.gpu?.frames} of 10`);
      assert.ok(r.gpu.spanMs.median > 0);
      assert.ok(r.gpu.passes.length >= 5 && r.gpu.passes[0].ms >= r.gpu.passes.at(-1).ms, 'passes are listed most expensive first');
      assert.equal(r.gpu.untimed, 0, 'every pass of the frame fits in the timer');
      assert.ok(r.gpu.passes.some((p) => p.name === 'gbuffer'), 'the G-buffer pass is among them');
    } else assert.equal(r.gpu, null);
    if (name === 'lights') assert.ok(r.renderer.lights >= 24, `${r.renderer.lights} lights seen by the renderer`);
    if (name === 'crowd') assert.ok(r.renderer.triangles > 20000, 'skinned characters are drawn');
    assert.equal(engine.stage.gpuTimes, null, 'timing is switched off again afterwards');
    engine.dispose();
  });
}
