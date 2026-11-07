/**
 * Image-based lighting from the sky model: a cube capture of the sky, its GGX-prefiltered mip chain
 * (specular reflections), order-2 spherical harmonics (diffuse, computed on the GPU and left there),
 * and the split-sum BRDF lookup table.
 */
import { struct } from '../../gpu/wgsl.js';
import { BUFFER, TEX } from '../../gpu/Device.js';
import { createTexture, generateMips } from '../../gpu/Resources.js';
import { COMMON_WGSL, SKY_WGSL } from '../shaders/common.js';
import { FullscreenPass, ComputeKernel } from '../Fullscreen.js';

/**
 * @import { GPU } from '../../gpu/Device.js'
 * @import { UniformArena } from '../../gpu/Resources.js'
 */

const SKY_U = struct('U', [['face', 'u32']]);
const PRE_U = struct('U', [['face', 'u32'], ['roughness', 'f32'], ['srcSize', 'f32']]);

const SKY_FS = /* wgsl */`
@fragment fn fs(in: FsOut) -> @location(0) vec4f { return vec4f(skyRadiance(cubeDir(u.face, in.uv), false), 1.0); }
`;

// GGX prefiltering by importance sampling with mip-filtered lookups (Krivanek & Colbert 2008)
const PREFILTER_FS = /* wgsl */`
fn hammersley(i: u32, n: u32) -> vec2f {
  var b = i;
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return vec2f(f32(i) / f32(n), f32(b) * 2.3283064365386963e-10);
}
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  let N = cubeDir(u.face, in.uv);
  if (u.roughness < 0.001) { return vec4f(textureSampleLevel(tSrc, sLin, N, 0.0).rgb, 1.0); }
  var up = vec3f(1.0, 0.0, 0.0);
  if (abs(N.y) < 0.999) { up = vec3f(0.0, 1.0, 0.0); }
  let T = normalize(cross(up, N)); let B = cross(N, T);
  let a = u.roughness * u.roughness;
  var sum = vec3f(0.0); var wsum = 0.0;
  let SAMPLES = 96u;
  for (var i = 0u; i < SAMPLES; i++) {
    let xi = hammersley(i, SAMPLES);
    let phi = TAU * xi.x;
    let cosT = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let sinT = sqrt(1.0 - cosT * cosT);
    let H = T * (sinT * cos(phi)) + B * (sinT * sin(phi)) + N * cosT;
    let L = reflect(-N, H);
    let NoL = dot(N, L);
    if (NoL <= 0.0) { continue; }
    let NoH = saturate(dot(N, H));
    let pdf = D_GGX(NoH, a) * 0.25 + 1e-5;
    let omegaS = 1.0 / (f32(SAMPLES) * pdf);
    let omegaP = 4.0 * PI / (6.0 * u.srcSize * u.srcSize);
    let mip = max(0.5 * log2(omegaS / omegaP) + 1.0, 0.0);
    sum += textureSampleLevel(tSrc, sLin, L, mip).rgb * NoL;
    wsum += NoL;
  }
  return vec4f(sum / max(wsum, 1e-4), 1.0);
}
`;

// Split-sum DFG lookup (Karis 2013): scale and bias on F0 by (NoV, roughness)
const LUT_FS = /* wgsl */`
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  let NoV = max(in.uv.x, 1e-3); let rough = max(in.uv.y, 0.02);
  let V = vec3f(sqrt(1.0 - NoV * NoV), 0.0, NoV);
  let a = rough * rough;
  var A = 0.0; var B = 0.0;
  let N = 256;
  for (var i = 0; i < N; i++) {
    let u1 = fract(f32(i) / f32(N) + 0.5 / f32(N));
    let u2 = fract(f32(i) * 0.6180339887);
    let phi = TAU * u2;
    let cosT = sqrt((1.0 - u1) / (1.0 + (a * a - 1.0) * u1));
    let sinT = sqrt(1.0 - cosT * cosT);
    let H = vec3f(sinT * cos(phi), sinT * sin(phi), cosT);
    let L = 2.0 * dot(V, H) * H - V;
    let NoL = saturate(L.z); let NoH = saturate(H.z); let VoH = saturate(dot(V, H));
    if (NoL > 0.0) {
      let Vis = V_SmithGGXCorrelated(NoV, NoL, a) * 4.0 * NoL * VoH / max(NoH, 1e-4);
      let Fc = pow5(1.0 - VoH);
      A += (1.0 - Fc) * Vis; B += Fc * Vis;
    }
  }
  return vec4f(A / f32(N), B / f32(N), 0.0, 1.0);
}
`;

// order-2 SH projection of a cube map: one workgroup, 64 threads, reduced in shared memory
const SH_CS = /* wgsl */`
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var<storage, read_write> sh: array<vec4f>;
@group(0) @binding(2) var<uniform> P: vec4u;   // x: face size at the sampled mip, y: mip level
var<workgroup> part: array<vec4f, 640>;         // 64 threads x (9 coefficients + weight)
fn cubeDirC(face: u32, uv: vec2f) -> vec3f {
  let sc = uv.x * 2.0 - 1.0; let tc = uv.y * 2.0 - 1.0;
  switch (face) {
    case 0u: { return normalize(vec3f(1.0, -tc, -sc)); }
    case 1u: { return normalize(vec3f(-1.0, -tc, sc)); }
    case 2u: { return normalize(vec3f(sc, 1.0, tc)); }
    case 3u: { return normalize(vec3f(sc, -1.0, -tc)); }
    case 4u: { return normalize(vec3f(sc, -tc, 1.0)); }
    default: { return normalize(vec3f(-sc, -tc, -1.0)); }
  }
}
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) t: u32) {
  let n = P.x;
  var acc: array<vec3f, 9>;
  for (var k = 0; k < 9; k++) { acc[k] = vec3f(0.0); }
  var wsum = 0.0;
  let total = 6u * n * n;
  for (var i = t; i < total; i += 64u) {
    let face = i / (n * n); let r = i % (n * n);
    let x = r % n; let y = r / n;
    let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(n);
    let d = cubeDirC(face, uv);
    let uu = uv.x * 2.0 - 1.0; let vv = uv.y * 2.0 - 1.0;
    let w = 4.0 / pow(1.0 + uu * uu + vv * vv, 1.5);
    let c = textureLoad(src, vec2i(i32(x), i32(y)), i32(face), i32(P.y)).rgb * w;
    var Y = array<f32, 9>(0.282095, 0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x, 1.092548 * d.x * d.y, 1.092548 * d.y * d.z,
                          0.315392 * (3.0 * d.z * d.z - 1.0), 1.092548 * d.x * d.z, 0.546274 * (d.x * d.x - d.y * d.y));
    for (var k = 0; k < 9; k++) { acc[k] += Y[k] * c; }
    wsum += w;
  }
  for (var k = 0u; k < 9u; k++) { part[t * 10u + k] = vec4f(acc[k], 0.0); }
  part[t * 10u + 9u] = vec4f(wsum, 0.0, 0.0, 0.0);
  workgroupBarrier();
  if (t < 9u) {
    var s = vec3f(0.0); var ws = 0.0;
    for (var j = 0u; j < 64u; j++) { s += part[j * 10u + t].xyz; ws += part[j * 10u + 9u].x; }
    sh[t] = vec4f(s * (4.0 * 3.14159265359 / max(ws, 1e-6)), 0.0);
  }
}
`;

export class Environment {
  /**
   * @param {{ gpu: GPU, arena: UniformArena }} ctx
   * @param {object} [o]
   * @param {number} [o.size]  cube face size in pixels (256); the filtered chain is half of it
   */
  constructor({ gpu, arena }, { size = 256 } = {}) {
    this.gpu = gpu; this.arena = arena; this.size = size;
    this.levels = 6;
    const half = Math.max(16, size >> 1);
    this.sky = createTexture(gpu, { width: size, height: size, format: 'rgba16float', cube: true, mips: true, usage: TEX.RENDER, label: 'sky cube' });
    this.spec = createTexture(gpu, { width: half, height: half, format: 'rgba16float', cube: true, mips: this.levels, usage: TEX.RENDER, label: 'environment specular' });
    this.lut = createTexture(gpu, { width: 128, height: 128, format: 'rgba16float', usage: TEX.RENDER, label: 'brdf lut' });
    this.skyView = this.sky.createView({ dimension: 'cube' });
    this.specView = this.spec.createView({ dimension: 'cube' });
    this.lutView = this.lut.createView();
    this.sh = gpu.buffer({ size: 9 * 16, usage: BUFFER.STORAGE | BUFFER.COPY_DST, label: 'sky SH' });
    this.skyPass = new FullscreenPass(gpu, arena, { label: 'sky-cube', frame: true, uniform: SKY_U, prelude: COMMON_WGSL + SKY_WGSL, fs: SKY_FS });
    this.prePass = new FullscreenPass(gpu, arena, {
      label: 'env-prefilter', uniform: PRE_U, inputs: [['tSrc', 'cube']], samplers: [['sLin', 'filtering', { mipmapFilter: 'linear' }]], prelude: COMMON_WGSL, fs: PREFILTER_FS,
    });
    this.lutPass = new FullscreenPass(gpu, arena, { label: 'brdf-lut', prelude: COMMON_WGSL, fs: LUT_FS });
    this.shKernel = new ComputeKernel(gpu, {
      label: 'sky-sh', code: SH_CS,
      entries: [{ b: 0, texture: 'float', dim: '2d-array' }, { b: 1, buffer: 'storage' }, { b: 2, buffer: 'uniform' }],
    });
    this.shParams = gpu.buffer({ size: 16, usage: BUFFER.UNIFORM | BUFFER.COPY_DST, label: 'sh params' });
    this.shSrcView = null;
    this.dirty = true;
    this.hash = '';
  }

  /** Renders the BRDF lookup table (once). */
  initLUT(enc) {
    this.lutPass.draw(enc, { targets: [{ view: this.lut.createView(), format: 'rgba16float', clear: [0, 0, 0, 1] }] });
  }

  /** Re-captures the sky and refilters it. `frameBG/frameOffset` bind a Frame holding the sky state. */
  update(enc, frameBG, frameOffset) {
    const gpu = this.gpu;
    const faceView = (tex, face, mip) => tex.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: face, arrayLayerCount: 1 });
    for (let f = 0; f < 6; f++) {
      this.skyPass.draw(enc, { targets: [{ view: faceView(this.sky, f, 0), format: 'rgba16float', clear: [0, 0, 0, 1] }], values: { face: f }, frameBG, frameOffset });
    }
    generateMips(gpu, this.sky, enc);
    this.filterFrom(enc, this.skyView, this.size);
    // spherical harmonics from a small mip of the sky
    const mip = Math.max(0, Math.min(this.sky.mipLevelCount - 1, Math.log2(this.size) - 4));
    const n = Math.max(1, this.size >> mip);
    gpu.queue.writeBuffer(this.shParams, 0, new Uint32Array([n, mip, 0, 0]));
    this.shSrcView ??= this.sky.createView({ dimension: '2d-array' });
    this.shKernel.dispatch(enc, [this.shSrcView, { buffer: this.sh }, { buffer: this.shParams }], 1);
    this.dirty = false;
  }

  /** GGX-prefilters any HDR cube (the sky, or a scene capture) into `spec`. */
  filterFrom(enc, cubeView, srcSize) {
    for (let m = 0; m < this.levels; m++) {
      const size = Math.max(1, this.spec.width >> m);
      for (let f = 0; f < 6; f++) {
        this.prePass.draw(enc, {
          targets: [{ view: this.spec.createView({ dimension: '2d', baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: f, arrayLayerCount: 1 }), format: 'rgba16float', clear: [0, 0, 0, 1] }],
          values: { face: f, roughness: m / (this.levels - 1), srcSize }, views: [cubeView],
        });
      }
      void size;
    }
  }
}
