/**
 * GPU resource helpers: per-frame uniform memory, texture creation/upload/mip generation, readback,
 * and half-float conversion.
 */
import { BUFFER, TEX, MAP } from './Device.js';

/**
 * @import { GPU } from './Device.js'
 * @import { GPUObject } from '../types.js'
 */

/**
 * Texels read back from the GPU. `data` is the format's typed array: Uint8Array for 8-bit formats, Uint16Array for half floats,
 * Uint32Array for packed formats and Float32Array for 32-bit floats and depth. Row-major, no row padding.
 * @typedef {object} TextureReadback
 * @property {number} width
 * @property {number} height
 * @property {string} format
 * @property {Uint8Array | Uint16Array | Uint32Array | Float32Array} data
 */

// ---------------------------------------------------------------------------
// Texture formats the engine uses: bytes per texel, element type, channel count, filterability.

export const FORMATS = {
  rgba8unorm: { bpp: 4, ch: 4, T: Uint8Array, filter: true, norm: true },
  'rgba8unorm-srgb': { bpp: 4, ch: 4, T: Uint8Array, filter: true, norm: true },
  bgra8unorm: { bpp: 4, ch: 4, T: Uint8Array, filter: true, norm: true, bgra: true },
  'bgra8unorm-srgb': { bpp: 4, ch: 4, T: Uint8Array, filter: true, norm: true, bgra: true },
  r8unorm: { bpp: 1, ch: 1, T: Uint8Array, filter: true, norm: true },
  rg8unorm: { bpp: 2, ch: 2, T: Uint8Array, filter: true, norm: true },
  r16float: { bpp: 2, ch: 1, T: Uint16Array, filter: true, half: true },
  rg16float: { bpp: 4, ch: 2, T: Uint16Array, filter: true, half: true },
  rgba16float: { bpp: 8, ch: 4, T: Uint16Array, filter: true, half: true },
  r32float: { bpp: 4, ch: 1, T: Float32Array, filter: false },
  rg32float: { bpp: 8, ch: 2, T: Float32Array, filter: false },
  rgba32float: { bpp: 16, ch: 4, T: Float32Array, filter: false },
  rgb10a2unorm: { bpp: 4, ch: 4, T: Uint32Array, filter: true },
  rg11b10ufloat: { bpp: 4, ch: 3, T: Uint32Array, filter: true },
  depth32float: { bpp: 4, ch: 1, T: Float32Array, filter: false, depth: true },
  depth24plus: { bpp: 4, ch: 1, T: Float32Array, filter: false, depth: true },
};
export const SHORT_FORMATS = {
  rgba8: 'rgba8unorm', srgba8: 'rgba8unorm-srgb', rgba16f: 'rgba16float', rgba32f: 'rgba32float', r8: 'r8unorm', rg8: 'rg8unorm',
  r16f: 'r16float', rg16f: 'rg16float', r32f: 'r32float', depth32f: 'depth32float',
};
export const fmt = (f) => SHORT_FORMATS[f] ?? f;

// ---------------------------------------------------------------------------
// Half floats

const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
export function floatToHalf(v) {
  _f32[0] = v;
  const x = _u32[0], sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  return sign | (e << 10) | ((m + 0x1000) >> 13);
}
export function halfToFloat(h) {
  const s = (h & 0x8000) << 16, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) { if (m === 0) { _u32[0] = s; return _f32[0]; } let ee = -1, mm = m; do { ee++; mm <<= 1; } while (!(mm & 0x400)); _u32[0] = s | ((127 - 15 - ee) << 23) | ((mm & 0x3ff) << 13); return _f32[0]; }
  if (e === 31) { _u32[0] = s | 0x7f800000 | (m << 13); return _f32[0]; }
  _u32[0] = s | ((e - 15 + 127) << 23) | (m << 13);
  return _f32[0];
}
export function toHalfArray(f32) { const o = new Uint16Array(f32.length); for (let i = 0; i < f32.length; i++) o[i] = floatToHalf(f32[i]); return o; }

// ---------------------------------------------------------------------------
// Uniform arena: all per-frame uniform data (per object, per material, per pass) is written into
// one CPU block, uploaded with a single writeBuffer, and bound with dynamic offsets.

export class UniformArena {
  constructor(gpu, size = 16 << 20, label = 'uniform arena') {
    this.gpu = gpu; this.label = label;
    this.align = gpu.limits.minUniformBufferOffsetAlignment || 256;
    this.generation = 0;
    this._alloc(size);
    this.offset = 0;
    this.highWater = 0;
  }
  _alloc(size) {
    this.size = size;
    this.cpu = new ArrayBuffer(size);
    this.f32 = new Float32Array(this.cpu); this.u32 = new Uint32Array(this.cpu); this.i32 = new Int32Array(this.cpu);
    this.buffer = this.gpu.buffer({ size, usage: BUFFER.UNIFORM | BUFFER.COPY_DST, label: this.label });
    this.generation++;
  }
  reset() { this.offset = 0; }
  /** Reserves `size` bytes, returns the byte offset (aligned to the dynamic-offset alignment). */
  alloc(size) {
    const at = this.offset;
    const end = at + Math.ceil(size / this.align) * this.align;
    if (end > this.size) {
      const old = { cpu: this.cpu, used: this.offset };
      this._alloc(Math.max(this.size * 2, end));
      new Uint8Array(this.cpu).set(new Uint8Array(old.cpu, 0, old.used));
    }
    this.offset = end;
    if (end > this.highWater) this.highWater = end;
    return at;
  }
  flush() { if (this.offset) this.gpu.queue.writeBuffer(this.buffer, 0, this.cpu, 0, this.offset); }
}

// ---------------------------------------------------------------------------
// Textures

export function mipCount(w, h = w) { return Math.floor(Math.log2(Math.max(w, h))) + 1; }

/**
 * Creates a 2D texture (or array / cube). Options: width, height, format, mips (true | number),
 * layers, cube, usage (extra flags), samples, label.
 */
export function createTexture(gpu, { width, height = width, format = 'rgba8unorm', mips = false, layers = 1, cube = false, usage = 0, samples = 1, label = 'texture' }) {
  format = fmt(format);
  const mipLevelCount = mips === true ? mipCount(width, height) : mips || 1;
  const L = cube ? 6 : layers;
  let u = TEX.BINDING | TEX.COPY_DST | usage;
  if (mipLevelCount > 1) u |= TEX.RENDER;
  const tex = gpu.texture({ label, size: [width, height, L], format, mipLevelCount, sampleCount: samples, usage: u, dimension: '2d' });
  tex.__info = { width, height, format, mips: mipLevelCount, layers: L, cube };
  return tex;
}
export const view2D = (tex, o = {}) => tex.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, ...o });
export const viewFull = (tex) => tex.createView({ dimension: (tex.__info?.cube ? 'cube' : (tex.__info?.layers > 1 ? '2d-array' : '2d')) });

/** Uploads raw texels (typed array) to a mip level / layer. `data` must match the format's element size. */
export function uploadPixels(gpu, tex, data, { width = tex.width, height = tex.height, mip = 0, layer = 0 } = {}) {
  const f = FORMATS[tex.format] ?? { bpp: 4 };
  const w = Math.max(1, width >> mip), h = Math.max(1, height >> mip);
  gpu.queue.writeTexture({ texture: tex, mipLevel: mip, origin: [0, 0, layer] }, data, { bytesPerRow: w * f.bpp, rowsPerImage: h }, [w, h, 1]);
}

/** Uploads a browser image source (ImageBitmap, canvas, ...). */
export function uploadImage(gpu, tex, source, { flipY = false, layer = 0, mip = 0 } = {}) {
  gpu.queue.copyExternalImageToTexture({ source, flipY }, { texture: tex, mipLevel: mip, origin: [0, 0, layer], premultipliedAlpha: false }, [source.width, source.height]);
}

const BLIT_WGSL = /* wgsl */`
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@fragment fn fs(v: VOut) -> @location(0) vec4f { return textureSampleLevel(src, smp, v.uv, 0.0); }
`;

/**
 * Fills mip levels 1.. of every layer by repeated 2x2 reduction (bilinear blit).
 * @param {GPU} gpu
 * @param {GPUObject} tex
 * @param {GPUObject | null} [encoder]  records into this command encoder (nothing is submitted); by default it submits its own
 */
export function generateMips(gpu, tex, encoder = null) {
  const info = tex.__info ?? { layers: tex.depthOrArrayLayers, mips: tex.mipLevelCount, format: tex.format };
  const format = tex.format, f = FORMATS[format];
  if (tex.mipLevelCount < 2) return;
  const filterable = f ? f.filter || gpu.features.has('float32-filterable') : true;
  const module = gpu.shader('mip-blit', BLIT_WGSL);
  const pipeline = gpu.renderPipeline(`mip-blit:${format}`, () => ({
    label: `mip-blit ${format}`, layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  }));
  const sampler = gpu.sampler({ magFilter: filterable ? 'linear' : 'nearest', minFilter: filterable ? 'linear' : 'nearest', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const enc = encoder ?? gpu.device.createCommandEncoder({ label: 'mips' });
  for (let layer = 0; layer < (info.layers ?? 1); layer++) {
    for (let m = 1; m < tex.mipLevelCount; m++) {
      const bg = gpu.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: tex.createView({ dimension: '2d', baseMipLevel: m - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }) },
          { binding: 1, resource: sampler },
        ],
      });
      const pass = enc.beginRenderPass({
        label: 'mipmaps',
        colorAttachments: [{ view: tex.createView({ dimension: '2d', baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    }
  }
  if (!encoder) gpu.queue.submit([enc.finish()]);
}

// ---------------------------------------------------------------------------
// Readback (tests, screenshots, benchmarks)

/**
 * Reads texels back to the CPU. Returns { width, height, data } where data is the format's typed array (row-major, unpadded).
 * @param {GPU} gpu
 * @param {GPUObject} tex
 * @param {{ mip?: number, layer?: number, x?: number, y?: number, width?: number | null, height?: number | null }} [o]  the region to read (default: the whole mip level)
 * @returns {Promise<TextureReadback>}
 */
export async function readTexture(gpu, tex, { mip = 0, layer = 0, x = 0, y = 0, width = null, height = null } = {}) {
  const f = FORMATS[tex.format];
  if (!f) throw new Error(`readTexture: unsupported format ${tex.format}`);
  const mw = Math.max(1, tex.width >> mip), mh = Math.max(1, tex.height >> mip);
  width ??= mw - x; height ??= mh - y;
  const bpr = Math.ceil((width * f.bpp) / 256) * 256;
  const buf = gpu.buffer({ size: bpr * height, usage: BUFFER.MAP_READ | BUFFER.COPY_DST, label: 'readback' });
  const enc = gpu.device.createCommandEncoder({ label: 'readback' });
  enc.copyTextureToBuffer({ texture: tex, mipLevel: mip, origin: [x, y, layer], aspect: f.depth ? 'depth-only' : 'all' }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: height }, [width, height, 1]);
  gpu.queue.submit([enc.finish()]);
  await buf.mapAsync(MAP.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const out = new Uint8Array(width * height * f.bpp);
  for (let r = 0; r < height; r++) out.set(src.subarray(r * bpr, r * bpr + width * f.bpp), r * width * f.bpp);
  buf.unmap(); buf.destroy();
  return { width, height, format: tex.format, data: new f.T(out.buffer) };
}

/**
 * Converts a readTexture() result to Float32 (half floats and 8-bit normalised are expanded; BGRA is swizzled to RGBA).
 * @param {TextureReadback} r
 * @returns {Float32Array}
 */
export function toFloat32(r) {
  const f = FORMATS[r.format];
  const n = r.data.length, out = new Float32Array(n);
  if (f.half) for (let i = 0; i < n; i++) out[i] = halfToFloat(r.data[i]);
  else if (f.norm) for (let i = 0; i < n; i++) out[i] = r.data[i] / 255;
  else for (let i = 0; i < n; i++) out[i] = r.data[i];
  if (f.bgra) for (let i = 0; i < n; i += 4) { const t = out[i]; out[i] = out[i + 2]; out[i + 2] = t; }
  return out;
}
/**
 * RGBA8 bytes (always R,G,B,A order) from a read-back 8-bit texture.
 * @param {TextureReadback} r
 * @returns {Uint8Array}
 */
export function toRGBA8(r) {
  const f = FORMATS[r.format];
  if (!f.norm || f.bpp !== 4) throw new Error(`toRGBA8: ${r.format} is not an 8-bit RGBA format`);
  const d = new Uint8Array(r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength));
  if (f.bgra) for (let i = 0; i < d.length; i += 4) { const t = d[i]; d[i] = d[i + 2]; d[i + 2] = t; }
  return d;
}
