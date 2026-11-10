/**
 * The GPU: adapter + device + queue, a shader/pipeline/sampler cache, and error collection.
 * Everything is created through `GPU.create(...)`, which takes the WebGPU entry point from the
 * platform (`navigator.gpu` in a browser; the Dawn binding in Node and Deno), so the renderer never
 * touches a global.
 */
import { buildShader } from './wgsl.js';

/** @import { GPUObject } from '../types.js' */

// Numeric WebGPU flag values (identical in every implementation): no dependence on globals.
export const BUFFER = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
export const TEX = { COPY_SRC: 1, COPY_DST: 2, BINDING: 4, STORAGE: 8, RENDER: 16 };
export const STAGE = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
export const MAP = { READ: 1, WRITE: 2 };

const OPTIONAL_FEATURES = ['timestamp-query', 'float32-filterable', 'rg11b10ufloat-renderable', 'bgra8unorm-storage', 'shader-f16', 'indirect-first-instance', 'depth-clip-control'];

export class GPU {
  /**
   * @param {object} o
   * @param {{ requestAdapter(options?: object): Promise<GPUObject> }} o.gpu  the WebGPU entry point (navigator.gpu or a Dawn `create()` result)
   * @param {'high-performance' | 'low-power'} [o.powerPreference]  which adapter to ask for (default 'high-performance')
   * @param {string} [o.label]        name of the device in validation messages (default 'medengine')
   * @returns {Promise<GPU>}
   */
  static async create(o) {
    const { gpu, powerPreference = 'high-performance', label = 'medengine' } = o ?? {};
    if (!gpu) throw new Error('GPU.create: no WebGPU entry point. In a browser WebGPU needs a secure context (https or localhost) and a recent Chrome/Edge/Safari/Firefox; in Node install the optional "webgpu" package.');
    const adapter = await gpu.requestAdapter({ powerPreference });
    if (!adapter) throw new Error('GPU.create: no WebGPU adapter available on this machine');
    const requiredFeatures = OPTIONAL_FEATURES.filter((f) => adapter.features.has(f));
    const L = adapter.limits, want = {};
    // ask for more than the defaults only where the engine can use it
    for (const k of ['maxTextureDimension2D', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxStorageBuffersPerShaderStage', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxSampledTexturesPerShaderStage']) {
      if (L[k] !== undefined) want[k] = k === 'maxStorageBuffersPerShaderStage' ? Math.min(L[k], 10) : k === 'maxTextureDimension2D' ? Math.min(L[k], 16384) : L[k];
    }
    let device;
    try { device = await adapter.requestDevice({ label, requiredFeatures, requiredLimits: want }); }
    catch { device = await adapter.requestDevice({ label, requiredFeatures: requiredFeatures.filter((f) => f === 'timestamp-query' || f === 'float32-filterable') }); }
    const g = new GPU(gpu, adapter, device);
    return g;
  }

  constructor(entry, adapter, device) {
    this.entry = entry; this.adapter = adapter; this.device = device; this.queue = device.queue;
    this.limits = device.limits; this.features = device.features;
    this.errors = [];
    this.shaders = new Map(); this.pipelines = new Map(); this.samplers = new Map(); this.layouts = new Map();
    this.stats = { pipelines: 0, shaders: 0, buffers: 0, textures: 0 };
    /** @type {((message: string) => void)|null} called with each uncaptured WebGPU error instead of logging it */
    this.onError = null;
    device.addEventListener?.('uncapturederror', (e) => {
      const msg = e.error?.message ?? String(e);
      this.errors.push(msg);
      if (this.onError) this.onError(msg); else if (this.errors.length < 12) console.error('[webgpu]', msg);
    });
    // `lost` is set whatever the reason; only a loss nobody asked for is worth an error in the console
    device.lost?.then((info) => { this.lost = info; if (info?.reason !== 'destroyed') console.error('[webgpu] device lost:', info?.message ?? info); });
  }
  /** Releases the device and everything made on it. The GPU object is unusable afterwards. */
  destroy() { this.device.destroy?.(); }
  get hasTimestamps() { return this.features.has('timestamp-query'); }

  // -- shaders --------------------------------------------------------------
  /** Preprocesses and compiles WGSL; cached by label + defines. Compilation errors throw with a source excerpt. */
  shader(label, source, defines = {}) {
    const key = label + '\u0000' + JSON.stringify(defines);
    let m = this.shaders.get(key);
    if (m) return m;
    const code = buildShader(source, defines);
    // Compile errors are collected two ways, because implementations differ: Dawn lists them in getCompilationInfo(),
    // wgpu (Deno, Firefox) reports them as a validation error. Whichever arrives first is recorded once.
    this.device.pushErrorScope('validation');
    m = this.device.createShaderModule({ label, code });
    const scope = this.device.popErrorScope();
    m.__code = code;
    this.shaders.set(key, m);
    this.stats.shaders++;
    const report = (text) => {
      if (m.__reported) return;
      m.__reported = true;
      const msg = `WGSL compile error in ${label}\n${text}`;
      this.errors.push(msg);
      if (this.onError) this.onError(msg); else console.error(msg);
    };
    scope.then((err) => { if (err) report(String(err.message ?? err).split('\n').slice(0, 14).map((l) => `  ${l}`).join('\n')); });
    m.getCompilationInfo?.().then((info) => {
      const errs = info.messages.filter((x) => x.type === 'error');
      if (errs.length) {
        const lines = code.split('\n');
        report(errs.slice(0, 4).map((x) => `  ${label}:${x.lineNum}:${x.linePos} ${x.message}\n    > ${lines[x.lineNum - 1] ?? ''}`).join('\n'));
      }
    });
    return m;
  }

  // -- pipelines ------------------------------------------------------------
  /** Cached render pipeline. `make()` returns the descriptor, called only on a miss. */
  renderPipeline(key, make) {
    let p = this.pipelines.get(key);
    if (!p) { p = this.device.createRenderPipeline(make()); this.pipelines.set(key, p); this.stats.pipelines++; }
    return p;
  }
  computePipeline(key, make) {
    let p = this.pipelines.get(key);
    if (!p) { p = this.device.createComputePipeline(make()); this.pipelines.set(key, p); this.stats.pipelines++; }
    return p;
  }
  /** Cached bind group layout from a compact description: [{ b, v:'vf', buffer:'uniform'|'storage'|'read-only-storage', dynamic, texture:'float'|'unfilterable-float'|'depth'|'uint'|'sint', dim:'2d', ms, sampler:'filtering'|'comparison'|'non-filtering', storageTexture:'rgba16float' }]. */
  layout(key, entries) {
    let l = this.layouts.get(key);
    if (l) return l;
    const vis = (s) => (s.includes('v') ? STAGE.VERTEX : 0) | (s.includes('f') ? STAGE.FRAGMENT : 0) | (s.includes('c') ? STAGE.COMPUTE : 0);
    l = this.device.createBindGroupLayout({
      label: key,
      entries: entries.map((e) => {
        const o = { binding: e.b, visibility: vis(e.v ?? 'vfc') };
        if (e.buffer) o.buffer = { type: e.buffer, hasDynamicOffset: !!e.dynamic, minBindingSize: e.min ?? 0 };
        else if (e.texture) o.texture = { sampleType: e.texture, viewDimension: e.dim ?? '2d', multisampled: !!e.ms };
        else if (e.sampler) o.sampler = { type: e.sampler };
        else if (e.storageTexture) o.storageTexture = { access: e.access ?? 'write-only', format: e.storageTexture, viewDimension: e.dim ?? '2d' };
        return o;
      }),
    });
    this.layouts.set(key, l);
    return l;
  }
  pipelineLayout(label, layouts) { return this.device.createPipelineLayout({ label, bindGroupLayouts: layouts }); }

  // -- resources ------------------------------------------------------------
  sampler(o = {}) {
    const d = { magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', maxAnisotropy: 1, ...o };
    if (d.maxAnisotropy > 1 && (d.magFilter !== 'linear' || d.minFilter !== 'linear' || d.mipmapFilter !== 'linear')) d.maxAnisotropy = 1;
    const key = JSON.stringify(d);
    let s = this.samplers.get(key);
    if (!s) { s = this.device.createSampler({ label: 'sampler', ...d }); this.samplers.set(key, s); }
    return s;
  }
  /**
   * Creates a buffer (the size is rounded up to a multiple of 4), optionally filled with `data`.
   * @param {object} o
   * @param {number} o.size   bytes
   * @param {number} o.usage  BUFFER flags (`COPY_DST` is added when `data` is given)
   * @param {string} [o.label]
   * @param {ArrayBufferView | ArrayBuffer | null} [o.data]  uploaded at creation
   * @param {boolean} [o.mapped]  create the buffer mapped for writing
   * @returns {GPUObject}
   */
  buffer({ size, usage, label = 'buffer', data = null, mapped = false }) {
    size = Math.max(4, Math.ceil(size / 4) * 4);
    const b = this.device.createBuffer({ label, size, usage: usage | (data ? BUFFER.COPY_DST : 0), mappedAtCreation: mapped });
    if (data) this.queue.writeBuffer(b, 0, data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);
    this.stats.buffers++;
    return b;
  }
  /** Uploads typed-array contents to a buffer, padding the size to 4 bytes. */
  write(buffer, data, offset = 0) {
    let bytes = data;
    if (data.byteLength % 4) { bytes = new Uint8Array(Math.ceil(data.byteLength / 4) * 4); bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); }
    this.queue.writeBuffer(buffer, offset, bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  }
  texture(desc) { this.stats.textures++; return this.device.createTexture(desc); }

  /** Resolves when everything submitted so far has finished on the GPU. */
  async idle() { await this.queue.onSubmittedWorkDone(); }

  /** Runs `fn` inside a validation error scope; returns the error message or null. */
  async validate(fn) {
    this.device.pushErrorScope('validation');
    await fn();
    const e = await this.device.popErrorScope();
    return e ? e.message : null;
  }
}
