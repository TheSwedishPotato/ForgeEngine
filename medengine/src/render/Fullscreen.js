/**
 * Fullscreen passes: a fragment shader over a screen-covering triangle, with its own uniform block
 * (written into the shared UniformArena and bound with a dynamic offset), sampled inputs and samplers.
 *
 * Bind groups of a pass shader:
 *   group 0   binding 0: `u` uniform (if `uniform` given) | then the inputs in order | then the samplers
 *   group 1   binding 0: the Frame uniform (if `frame: true`), supplied at draw time
 *
 * Input kinds: 'float' (filterable texture_2d), 'ufloat' (texture_2d read with textureLoad), 'depth',
 * 'cube', 'array' (texture_2d_array), 'deptharray'. Sampler kinds: 'filtering', 'comparison', 'nearest'.
 */
import { Frame } from './shaders/common.js';
import { FULLSCREEN_VS } from './shaders/lighting.js';

/**
 * @import { GPU } from '../gpu/Device.js'
 * @import { UniformArena } from '../gpu/Resources.js'
 * @import { StructDef } from '../gpu/wgsl.js'
 * @import { GPUObject } from '../types.js'
 */

/**
 * What `new FullscreenPass(gpu, arena, o)` takes.
 * @typedef {object} FullscreenPassOptions
 * @property {string} label
 * @property {string} fs                   WGSL: functions plus `@fragment fn fs(in: FsOut) -> ...`
 * @property {StructDef | null} [uniform]  a struct() definition, named `U`, bound as `u`
 * @property {[string, 'float' | 'ufloat' | 'depth' | 'cube' | 'array' | 'deptharray'][]} [inputs]  [['tName', 'float'], ...]
 * @property {[string, 'filtering' | 'comparison' | 'nearest', object?][]} [samplers]  [['sName', 'filtering', samplerOptions?], ...]
 * @property {Record<string, string | number | boolean>} [defines]
 * @property {boolean} [frame]             also bind the Frame uniform at group 1
 * @property {string} [prelude]            extra WGSL placed before `fs` (common functions)
 * @property {string} [vs]                 custom vertex shader source (default: a fullscreen triangle)
 */

/**
 * What `pass.draw(encoder, o)` takes.
 * @typedef {object} FullscreenDraw
 * @property {{ view: GPUObject, format: string, clear?: number[] }[]} targets  views to write, with their texture format; `clear` is [r, g, b, a] (absent: keep what is there)
 * @property {Record<string, any> | null} [values]  the uniform fields by name
 * @property {GPUObject[]} [views]         the inputs, in declaration order
 * @property {GPUObject | null} [frameBG]  the Frame bind group, when the pass uses the Frame
 * @property {number} [frameOffset]        its dynamic offset
 * @property {number[] | null} [viewport]  [x, y, w, h] in pixels
 * @property {object | null} [blend]       a GPUBlendState for every target (see BLEND_ADD)
 * @property {string} [label]              the name of the pass in captures and GPU timings
 */

const INPUT = {
  float: { wgsl: 'texture_2d<f32>', entry: { texture: 'float' } },
  ufloat: { wgsl: 'texture_2d<f32>', entry: { texture: 'unfilterable-float' } },
  depth: { wgsl: 'texture_depth_2d', entry: { texture: 'depth' } },
  cube: { wgsl: 'texture_cube<f32>', entry: { texture: 'float', dim: 'cube' } },
  array: { wgsl: 'texture_2d_array<f32>', entry: { texture: 'float', dim: '2d-array' } },
  deptharray: { wgsl: 'texture_depth_2d_array', entry: { texture: 'depth', dim: '2d-array' } },
};
const SAMPLER = {
  filtering: { wgsl: 'sampler', entry: { sampler: 'filtering' } },
  comparison: { wgsl: 'sampler_comparison', entry: { sampler: 'comparison' } },
  nearest: { wgsl: 'sampler', entry: { sampler: 'non-filtering' } },
};

export const BLEND_ADD = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };

export class FullscreenPass {
  /**
   * @param {GPU} gpu
   * @param {UniformArena} arena
   * @param {FullscreenPassOptions} o
   */
  constructor(gpu, arena, { label, fs, uniform = null, inputs = [], samplers = [], defines = {}, frame = false, prelude = '', vs = FULLSCREEN_VS }) {
    this.gpu = gpu; this.arena = arena; this.label = label; this.uniformDef = uniform; this.inputs = inputs; this.defines = defines; this.usesFrame = frame;
    const entries = [];
    let b = 0, decl = '';
    if (uniform) { decl += `${uniform.wgsl}\n@group(0) @binding(0) var<uniform> u: ${uniform.name};\n`; entries.push({ b: 0, v: 'vf', buffer: 'uniform', dynamic: true, min: uniform.size }); b = 1; }
    for (const [name, kind] of inputs) {
      const k = INPUT[kind];
      if (!k) throw new Error(`FullscreenPass ${label}: unknown input kind ${kind}`);
      decl += `@group(0) @binding(${b}) var ${name}: ${k.wgsl};\n`;
      entries.push({ b, v: 'vf', ...k.entry }); b++;
    }
    this.samplerObjs = [];
    for (const [name, kind, opts] of samplers) {
      const k = SAMPLER[kind];
      decl += `@group(0) @binding(${b}) var ${name}: ${k.wgsl};\n`;
      entries.push({ b, v: 'vf', ...k.entry });
      this.samplerObjs.push({ binding: b, sampler: kind === 'comparison' ? gpu.sampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', ...opts })
        : kind === 'nearest' ? gpu.sampler({ magFilter: 'nearest', minFilter: 'nearest', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', ...opts })
        : gpu.sampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', ...opts }) });
      b++;
    }
    if (frame) decl += `${Frame.wgsl}\n@group(1) @binding(0) var<uniform> frame: Frame;\n`;
    this.source = `${decl}\n${vs}\n${prelude}\n${fs}`;
    this.bgl = gpu.layout(`fs:${label}`, entries);
    const layouts = [this.bgl];
    if (frame) layouts.push(gpu.layout('frame', [{ b: 0, v: 'vf', buffer: 'uniform', dynamic: true }]));
    this.pipelineLayout = gpu.pipelineLayout(`fs:${label}`, layouts);
    this._ubg = null;
  }

  /**
   * The render pipeline of this pass for some target formats (cached).
   * @param {string[]} formats  texture formats of the colour targets
   * @param {object | null} [blend]  a GPUBlendState used for every target
   * @param {string | null} [depthFormat]  a depth format, when the pass tests depth
   * @param {string} [depthCompare]  default 'always'
   * @returns {GPUObject}
   */
  pipeline(formats, blend = null, depthFormat = null, depthCompare = 'always') {
    const gpu = this.gpu;
    const key = `fs:${this.label}:${formats.join(',')}:${blend ? 'b' : ''}:${depthFormat ?? ''}`;
    const module = gpu.shader(`fs:${this.label}`, this.source, this.defines);
    return gpu.renderPipeline(key, () => ({
      label: key, layout: this.pipelineLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: formats.map((format) => (blend ? { format, blend } : { format })) },
      primitive: { topology: 'triangle-list' },
      ...(depthFormat ? { depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare } } : {}),
    }));
  }

  _uniformGroup(offset) {
    const a = this.arena;
    if (!this._ubg || this._ubg.gen !== a.generation) this._ubg = { gen: a.generation, buffer: a.buffer };
    return this._ubg;
  }

  /**
   * Records the pass.
   * @param {GPUObject} enc  a GPUCommandEncoder
   * @param {FullscreenDraw} o
   */
  draw(enc, { targets, values = null, views = [], frameBG = null, frameOffset = 0, viewport = null, blend = null, label = this.label }) {
    const gpu = this.gpu, device = gpu.device;
    const pipeline = this.pipeline(targets.map((t) => t.format), blend);
    const entries = [];
    let dyn = [];
    if (this.uniformDef) {
      const off = this.arena.alloc(this.uniformDef.size);
      const w = this.uniformDef.writer(this.arena.f32, this.arena.u32, this.arena.i32)(off);
      if (values) for (const k in values) w.set(k, values[k]);
      entries.push({ binding: 0, resource: { buffer: this.arena.buffer, size: this.uniformDef.size } });
      dyn = [off];
    }
    let b = this.uniformDef ? 1 : 0;
    for (let i = 0; i < this.inputs.length; i++) {
      if (!views[i]) throw new Error(`FullscreenPass ${this.label}: missing input ${this.inputs[i][0]}`);
      entries.push({ binding: b++, resource: views[i] });
    }
    for (const s of this.samplerObjs) entries.push({ binding: s.binding, resource: s.sampler });
    const bg = device.createBindGroup({ label, layout: this.bgl, entries });
    const rp = enc.beginRenderPass({
      label,
      colorAttachments: targets.map((t) => ({ view: t.view, loadOp: t.clear ? 'clear' : 'load', storeOp: 'store', clearValue: t.clear ?? [0, 0, 0, 0] })),
    });
    rp.setPipeline(pipeline);
    rp.setBindGroup(0, bg, dyn);
    if (this.usesFrame) rp.setBindGroup(1, frameBG, [frameOffset]);
    if (viewport) rp.setViewport(viewport[0], viewport[1], viewport[2], viewport[3], 0, 1);
    rp.draw(3);
    rp.end();
  }
}

/** A compute pipeline over one bind group (uniform + storage buffers + textures). */
export class ComputeKernel {
  constructor(gpu, { label, code, entries, defines = {}, entryPoint = 'main' }) {
    this.gpu = gpu; this.label = label;
    this.bgl = gpu.layout(`cs:${label}`, entries.map((e) => ({ v: 'c', ...e })));
    const module = gpu.shader(`cs:${label}`, code, defines);
    this.pipeline = gpu.computePipeline(`cs:${label}`, () => ({ label, layout: gpu.pipelineLayout(label, [this.bgl]), compute: { module, entryPoint } }));
  }
  dispatch(enc, resources, x, y = 1, z = 1, dynamicOffsets = []) {
    const bg = this.gpu.device.createBindGroup({ label: this.label, layout: this.bgl, entries: resources.map((resource, binding) => ({ binding, resource })).filter((e) => e.resource) });
    const p = enc.beginComputePass({ label: this.label });
    p.setPipeline(this.pipeline); p.setBindGroup(0, bg, dynamicOffsets); p.dispatchWorkgroups(x, y, z); p.end();
  }
}

/** A colour texture you can render into and sample from. */
export class RenderTarget {
  constructor(gpu, { width, height, format = 'rgba16float', mips = false, label = 'target', usage = 0 }) {
    this.gpu = gpu; this.format = format; this.label = label; this.mips = mips; this.usage = usage;
    this.width = 0; this.height = 0;
    this.resize(width, height);
  }
  resize(width, height) {
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    if (this.tex && width === this.width && height === this.height) return this;
    this.tex?.destroy();
    this.width = width; this.height = height;
    this.tex = this.gpu.texture({
      label: this.label, size: [width, height, 1], format: this.format, usage: 4 | 16 | 1 | 2 | this.usage,
      mipLevelCount: this.mips === true ? Math.floor(Math.log2(Math.max(width, height))) + 1 : this.mips || 1,
    });
    this.view = this.tex.createView({ baseMipLevel: 0, mipLevelCount: 1 });
    this.viewAll = this.tex.createView();
    return this;
  }
  /** A view of one mip level. */
  level(m) { return this.tex.createView({ baseMipLevel: m, mipLevelCount: 1 }); }
  destroy() { this.tex?.destroy(); this.tex = null; }
}
