import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuContext } from './helpers.js';
import { struct } from '../../src/gpu/wgsl.js';
import { UniformArena, createTexture, uploadPixels, generateMips, readTexture, toFloat32, halfToFloat, floatToHalf } from '../../src/gpu/Resources.js';
import { TEX, BUFFER } from '../../src/gpu/Device.js';

const ctx = await gpuContext();
const skip = ctx ? false : 'WebGPU not available';

test('struct layout follows WGSL uniform rules', () => {
  const S = struct('S', [['a', 'f32'], ['v', 'vec3f'], ['b', 'f32'], ['m', 'mat4x4f'], ['c', 'vec2f'], ['arr', 'f32', 3], ['n', 'mat3x3f']]);
  assert.deepEqual([S.offsets.a.offset, S.offsets.v.offset, S.offsets.b.offset, S.offsets.m.offset, S.offsets.c.offset, S.offsets.arr.offset, S.offsets.n.offset], [0, 16, 28, 32, 96, 112, 160]);
  assert.equal(S.size, 208);
  assert.match(S.wgsl, /arr: array<f32, 3>/);
});

test('shader + uniform arena with dynamic offsets + mips + readback', { skip }, async () => {
  const { gpu } = ctx;
  // 1. a texture with mips: 4x4 checker (red / blue) -> level 1 is the average
  const tex = createTexture(gpu, { width: 4, height: 4, format: 'rgba8unorm', mips: true, usage: TEX.COPY_SRC, label: 'checker' });
  const px = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) px.set((x + y) % 2 ? [0, 0, 255, 255] : [255, 0, 0, 255], (y * 4 + x) * 4);
  uploadPixels(gpu, tex, px, { width: 4, height: 4 });
  generateMips(gpu, tex);
  const m1 = await readTexture(gpu, tex, { mip: 1 });
  assert.equal(m1.width, 2);
  for (let i = 0; i < 4; i++) { assert.ok(Math.abs(m1.data[i * 4] - 128) <= 2 && Math.abs(m1.data[i * 4 + 2] - 128) <= 2, `mip1 texel ${i}: ${Array.from(m1.data.subarray(i * 4, i * 4 + 4))}`); }

  // 2. render two quads with different per-draw uniforms from one arena (dynamic offsets)
  const U = struct('U', [['color', 'vec4f'], ['scale', 'f32'], ['shift', 'vec2f']]);
  const code = `
    ${U.wgsl}
    @group(0) @binding(0) var<uniform> u: U;
    struct V { @builtin(position) p: vec4f };
    @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
      var q = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
      var o: V; o.p = vec4f(q[i] * u.scale + u.shift, 0, 1); return o;
    }
    @fragment fn fs(v: V) -> @location(0) vec4f { return u.color; }`;
  const mod = gpu.shader('arena-test', code);
  const bgl = gpu.layout('arena-test', [{ b: 0, v: 'vf', buffer: 'uniform', dynamic: true, min: U.size }]);
  const pipe = gpu.renderPipeline('arena-test', () => ({
    layout: gpu.pipelineLayout('arena-test', [bgl]),
    vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
  }));
  const target = createTexture(gpu, { width: 8, height: 8, format: 'rgba8unorm', usage: TEX.RENDER | TEX.COPY_SRC });
  const arena = new UniformArena(gpu, 1 << 16);
  const draws = [{ color: [1, 0, 0, 1], scale: 1, shift: [0, 0] }, { color: [0, 1, 0, 1], scale: 0.5, shift: [0.0, 0.0] }];
  const offsets = draws.map((d) => {
    const o = arena.alloc(U.size), w = U.writer(arena.f32, arena.u32, arena.i32)(o);
    w.set('color', d.color); w.set('scale', d.scale); w.set('shift', d.shift);
    return o;
  });
  assert.equal(offsets[1], 256);
  arena.flush();
  const bg = gpu.device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: arena.buffer, size: U.size } }] });
  const enc = gpu.device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
  pass.setPipeline(pipe);
  for (const o of offsets) { pass.setBindGroup(0, bg, [o]); pass.draw(3); }
  pass.end();
  gpu.queue.submit([enc.finish()]);
  const img = await readTexture(gpu, target);
  const at = (x, y) => Array.from(img.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
  assert.deepEqual(at(0, 0), [255, 0, 0, 255], 'corner: first draw (red) only');
  assert.deepEqual(at(4, 4), [0, 255, 0, 255], 'centre: second draw (green) on top');
  assert.deepEqual(gpu.errors, [], 'no validation errors');
});

test('half-float conversion round-trips and readback of rgba16float', { skip }, async () => {
  for (const v of [0, 1, -1, 0.5, 65504, 1e-5, 3.14159, -0.0001]) assert.ok(Math.abs(halfToFloat(floatToHalf(v)) - v) <= Math.abs(v) * 1e-3 + 1e-7, `half ${v}`);
  const { gpu } = ctx;
  const t = createTexture(gpu, { width: 2, height: 1, format: 'rgba16f', usage: TEX.COPY_SRC });
  uploadPixels(gpu, t, new Uint16Array([floatToHalf(0.25), floatToHalf(2), floatToHalf(-1), floatToHalf(1), floatToHalf(4), 0, 0, floatToHalf(1)]), { width: 2, height: 1 });
  const f = toFloat32(await readTexture(gpu, t));
  assert.deepEqual(Array.from(f), [0.25, 2, -1, 1, 4, 0, 0, 1]);
  void BUFFER;
});

test('shader compile errors are reported with the source line', { skip }, async () => {
  const { gpu } = ctx;
  const before = gpu.errors.length;
  gpu.shader('broken', '@fragment fn fs() -> @location(0) vec4f { return vec3f(1.0); }');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(gpu.errors.length > before && /WGSL compile error in broken/.test(gpu.errors.at(-1)), gpu.errors.at(-1));
  gpu.errors.length = 0;
});
