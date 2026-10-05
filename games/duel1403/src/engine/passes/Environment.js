import { Program, Texture, Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON, SKY } from '../shaders/common.js';

/** Direction for a cube face texel, matching GL's cube map layout. */
export const CUBE_DIR = /* glsl */`
vec3 cubeDir(int face, vec2 st) {
  vec2 c = st * 2.0 - 1.0;
  float u = c.x, v = c.y;
  if (face == 0) return normalize(vec3(1.0, -v, -u));
  if (face == 1) return normalize(vec3(-1.0, -v, u));
  if (face == 2) return normalize(vec3(u, 1.0, v));
  if (face == 3) return normalize(vec3(u, -1.0, -v));
  if (face == 4) return normalize(vec3(u, -v, 1.0));
  return normalize(vec3(-u, -v, -1.0));
}`;

const SKY_CUBE_FS = /* glsl */`
${COMMON}
${SKY}
${CUBE_DIR}
in vec2 vUv;
uniform int uFace;
out vec4 o;
void main() { o = vec4(skyRadiance(cubeDir(uFace, vUv), false), 1.0); }`;

// GGX prefiltering by importance sampling with mip-filtered lookups
// (Křivánek & Colbert 2008) so few samples give a clean result.
const PREFILTER_FS = /* glsl */`
${COMMON}
${CUBE_DIR}
in vec2 vUv;
uniform int uFace;
uniform float uRoughness;
uniform float uSrcSize;
uniform samplerCube uSrc;
out vec4 o;
vec2 hammersley(uint i, uint n) {
  uint b = i;
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return vec2(float(i) / float(n), float(b) * 2.3283064365386963e-10);
}
void main() {
  vec3 N = cubeDir(uFace, vUv);
  if (uRoughness < 0.001) { o = vec4(textureLod(uSrc, N, 0.0).rgb, 1.0); return; }
  vec3 up = abs(N.y) < 0.999 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 T = normalize(cross(up, N)), B = cross(N, T);
  float a = uRoughness * uRoughness;
  vec3 sum = vec3(0.0); float wsum = 0.0;
  const uint SAMPLES = 96u;
  for (uint i = 0u; i < SAMPLES; i++) {
    vec2 xi = hammersley(i, SAMPLES);
    float phi = TAU * xi.x;
    float cosT = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    float sinT = sqrt(1.0 - cosT * cosT);
    vec3 H = T * (sinT * cos(phi)) + B * (sinT * sin(phi)) + N * cosT;
    vec3 L = reflect(-N, H);
    float NoL = dot(N, L);
    if (NoL <= 0.0) continue;
    float NoH = saturate(dot(N, H));
    float pdf = D_GGX(NoH, a) * 0.25 + 1e-5;
    float omegaS = 1.0 / (float(SAMPLES) * pdf);
    float omegaP = 4.0 * PI / (6.0 * uSrcSize * uSrcSize);
    float mip = max(0.5 * log2(omegaS / omegaP) + 1.0, 0.0);
    sum += textureLod(uSrc, L, mip).rgb * NoL;
    wsum += NoL;
  }
  o = vec4(sum / max(wsum, 1e-4), 1.0);
}`;

// Split-sum DFG lookup (Karis 2013): scale and bias on F0 by (NoV, roughness),
// with the multiple-scattering energy term in the third channel.
const BRDF_LUT_FS = /* glsl */`
${COMMON}
in vec2 vUv;
out vec4 o;
void main() {
  float NoV = max(vUv.x, 1e-3), rough = max(vUv.y, 0.02);
  vec3 V = vec3(sqrt(1.0 - NoV * NoV), 0.0, NoV);
  float a = rough * rough;
  float A = 0.0, B = 0.0;
  const int N = 256;
  for (int i = 0; i < N; i++) {
    float u1 = fract(float(i) / float(N) + 0.5 / float(N));
    float u2 = fract(float(i) * 0.6180339887);
    float phi = TAU * u2;
    float cosT = sqrt((1.0 - u1) / (1.0 + (a * a - 1.0) * u1));
    float sinT = sqrt(1.0 - cosT * cosT);
    vec3 H = vec3(sinT * cos(phi), sinT * sin(phi), cosT);
    vec3 L = 2.0 * dot(V, H) * H - V;
    float NoL = saturate(L.z), NoH = saturate(H.z), VoH = saturate(dot(V, H));
    if (NoL > 0.0) {
      float Vis = V_SmithGGXCorrelated(NoV, NoL, a) * 4.0 * NoL * VoH / max(NoH, 1e-4);
      float Fc = pow5(1.0 - VoH);
      A += (1.0 - Fc) * Vis; B += Fc * Vis;
    }
  }
  o = vec4(A / float(N), B / float(N), 0.0, 1.0);
}`;

/**
 * Sky light: cube capture of the sky, GGX-prefiltered mip chain for
 * reflections, order-2 spherical harmonics for diffuse, and the BRDF LUT.
 */
export class Environment {
  constructor(gl, { size = 256 } = {}) {
    this.gl = gl;
    this.size = size;
    this.levels = 6;
    this.sky = new Texture(gl, { target: 'cube', width: size, height: size, format: 'rgba16f', filter: 'mip' });
    this.spec = new Texture(gl, { target: 'cube', width: size / 2, height: size / 2, format: 'rgba16f', filter: 'mip', levels: this.levels });
    this.skyTarget = new Target(gl, { width: size, height: size, colors: [this.sky] });
    this.specTarget = new Target(gl, { width: size / 2, height: size / 2, colors: [this.spec] });
    this.skyProg = postProgram(gl, SKY_CUBE_FS, {}, 'sky-cube');
    this.prefilter = postProgram(gl, PREFILTER_FS, {}, 'prefilter');
    this.lut = new Texture(gl, { width: 128, height: 128, format: 'rgba16f' });
    const lt = new Target(gl, { width: 128, height: 128, colors: [this.lut] });
    const lp = postProgram(gl, BRDF_LUT_FS, {}, 'brdf-lut');
    state(gl);
    lt.bind(); lp.use(); fullscreen(gl);
    this.sh = new Float32Array(27);
    this.shSmall = new Target(gl, { width: 16, height: 16, colors: [{ format: 'rgba32f' }] });
  }

  /** Re-captures the sky (time of day, clouds) and refilters. */
  update(skyUniforms) {
    const gl = this.gl;
    state(gl);
    this.skyProg.use().setAll(skyUniforms);
    for (let f = 0; f < 6; f++) {
      this.skyTarget.colors[0] = this.sky;
      this._bindFace(this.skyTarget, f, 0);
      this.skyProg.set('uFace', f);
      fullscreen(gl);
    }
    this.sky.generateMips();
    this.filterFrom(this.sky, this.size);
    this._sh(skyUniforms);
  }

  /** GGX-prefilters any HDR cube (sky or a scene capture) into this.spec. */
  filterFrom(src, srcSize) {
    const gl = this.gl;
    this.prefilter.use().set('uSrc', src).set('uSrcSize', srcSize);
    for (let m = 0; m < this.levels; m++) {
      this.prefilter.set('uRoughness', m / (this.levels - 1));
      for (let f = 0; f < 6; f++) {
        this._bindFace(this.specTarget, f, m);
        this.prefilter.set('uFace', f);
        fullscreen(gl);
      }
    }
  }

  _bindFace(t, face, level) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, t.colors[0].tex, level);
    gl.viewport(0, 0, Math.max(1, t.width >> level), Math.max(1, t.height >> level));
  }

  /** Projects the sky onto SH9 on the CPU from a 16x16-per-face readback. */
  _sh(skyUniforms) {
    const gl = this.gl;
    const n = 16;
    const px = new Float32Array(n * n * 4);
    const sh = new Float64Array(27);
    let wsum = 0;
    this.skyProg.use().setAll(skyUniforms);
    for (let f = 0; f < 6; f++) {
      this.shSmall.bind();
      this.skyProg.set('uFace', f);
      fullscreen(gl);
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.FLOAT, px);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const u = ((x + 0.5) / n) * 2 - 1, v = ((y + 0.5) / n) * 2 - 1;
        const d = faceDir(f, u, v);
        const w = 4 / Math.pow(1 + u * u + v * v, 1.5);   // solid angle of the texel
        const i = (y * n + x) * 4;
        projectSH(sh, d, px[i] * w, px[i + 1] * w, px[i + 2] * w);
        wsum += w;
      }
    }
    const norm = (4 * Math.PI) / wsum;
    for (let i = 0; i < 27; i++) this.sh[i] = sh[i] * norm;
  }
}

export function faceDir(f, u, v) {
  let d;
  switch (f) {
    case 0: d = [1, -v, -u]; break;
    case 1: d = [-1, -v, u]; break;
    case 2: d = [u, 1, v]; break;
    case 3: d = [u, -1, -v]; break;
    case 4: d = [u, -v, 1]; break;
    default: d = [-u, -v, -1];
  }
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** Accumulates radiance (r,g,b) from direction d into SH9 (RGB interleaved per coefficient). */
export function projectSH(sh, d, r, g, b) {
  const [x, y, z] = d;
  const Y = [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
  for (let k = 0; k < 9; k++) { sh[k * 3] += Y[k] * r; sh[k * 3 + 1] += Y[k] * g; sh[k * 3 + 2] += Y[k] * b; }
}
