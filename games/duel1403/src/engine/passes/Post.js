import { Target, Texture, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

// ---------------------------------------------------------------------------
// Auto exposure: log-average luminance through a mip chain, adapted over time
// like an eye (faster to light than to dark).

const LOGLUM_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor;
void main() {
  // centre-weighted: what the player looks at matters more
  vec2 c = vUv - 0.5;
  float w = 1.0 - 0.6 * smoothstep(0.1, 0.6, length(c));
  float l = luma(texture(uColor, vUv).rgb);
  o = vec4(log2(max(l, 1e-4)) * w, w, 0.0, 1.0);
}`;
const ADAPT_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform sampler2D uLog, uPrev;
uniform float uLevel, uDt, uKey, uMinEV, uMaxEV, uReset, uCompensation;
void main() {
  vec2 s = textureLod(uLog, vec2(0.5), uLevel).rg;
  float avg = exp2(s.x / max(s.y, 1e-4));
  float target = uKey / max(avg, 1e-4);
  target = clamp(target, exp2(uMinEV), exp2(uMaxEV)) * exp2(uCompensation);
  float prev = texture(uPrev, vec2(0.5)).r;
  float rate = target > prev ? 1.4 : 2.6;   // adapting to darkness is slower
  float e = uReset > 0.5 ? target : prev + (target - prev) * (1.0 - exp(-uDt * rate));
  o = vec4(e, avg, 0.0, 1.0);
}`;

export class Exposure {
  constructor() { this.name = 'exposure'; this.key = 0.18; this.compensation = 0.0; this.minEV = -4; this.maxEV = 3; this.reset = true; }
  init(r) {
    const gl = r.gl;
    this.log = new Target(gl, { width: 256, height: 256, colors: [{ format: 'rgba16f', filter: 'mip' }] });
    this.a = new Target(gl, { width: 1, height: 1, colors: [{ format: 'rgba32f', filter: 'nearest' }] });
    this.b = new Target(gl, { width: 1, height: 1, colors: [{ format: 'rgba32f', filter: 'nearest' }] });
    this.pLog = postProgram(gl, LOGLUM_FS, {}, 'loglum');
    this.pAdapt = postProgram(gl, ADAPT_FS, {}, 'adapt');
  }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    this.log.bind(); this.pLog.use().set('uColor', color); fullscreen(gl);
    this.log.tex.generateMips();
    this.a.bind();
    this.pAdapt.use().set('uLog', this.log.tex).set('uPrev', this.b.tex).set('uLevel', 8).set('uDt', r.dt)
      .set('uKey', this.key).set('uMinEV', this.minEV).set('uMaxEV', this.maxEV).set('uReset', this.reset ? 1 : 0).set('uCompensation', this.compensation);
    fullscreen(gl);
    this.reset = false;
    const t = this.a; this.a = this.b; this.b = t;
    r.exposureTex = this.b.tex;
    return color;
  }
}

// ---------------------------------------------------------------------------
// Bloom: the glow of a real lens. Downsample with a 13-tap filter (Karis
// average on the first level against fireflies), upsample with a 3x3 tent,
// and mix a small, energy-conserving fraction into the image (Jimenez 2014).

const DOWN_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uFirst;
vec3 s(vec2 off) { return texture(uSrc, vUv + off * uTexel).rgb; }
float kw(vec3 c) { return 1.0 / (1.0 + luma(c)); }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 r;
  if (uFirst > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
    r = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  o = vec4(r, 1.0);
}`;
const UP_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uRadius;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 r = texture(uSrc, vUv).rgb * 4.0
    + (texture(uSrc, vUv + vec2(-t.x, 0)).rgb + texture(uSrc, vUv + vec2(t.x, 0)).rgb + texture(uSrc, vUv + vec2(0, -t.y)).rgb + texture(uSrc, vUv + vec2(0, t.y)).rgb) * 2.0
    + texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(-t.x, t.y)).rgb + texture(uSrc, vUv + t).rgb;
  o = vec4(r / 16.0, 1.0);
}`;

export class Bloom {
  constructor() { this.name = 'bloom'; this.levels = 6; this.strength = 0.045; }
  init(r) { this.pDown = postProgram(r.gl, DOWN_FS, {}, 'bloom-down'); this.pUp = postProgram(r.gl, UP_FS, {}, 'bloom-up'); }
  resize(r) {
    const gl = r.gl;
    this.mips?.forEach((m) => m.dispose());
    this.mips = [];
    let w = r.displayW, h = r.displayH;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.mips.push(new Target(gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] }));
    }
  }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    let src = color, sw = r.displayW, sh = r.displayH;
    this.pDown.use();
    for (let i = 0; i < this.levels; i++) {
      const t = this.mips[i];
      t.bind();
      this.pDown.set('uSrc', src).set('uTexel', [1 / sw, 1 / sh]).set('uFirst', i === 0 ? 1 : 0);
      fullscreen(gl);
      src = t.tex; sw = t.width; sh = t.height;
    }
    this.pUp.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.levels - 1; i > 0; i--) {
      const dst = this.mips[i - 1], s = this.mips[i];
      dst.bind();
      this.pUp.set('uSrc', s.tex).set('uTexel', [1 / s.width, 1 / s.height]).set('uRadius', 1.0);
      fullscreen(gl);
    }
    gl.disable(gl.BLEND);
    r.bloomTex = this.mips[0].tex;
    return color;
  }
}

// ---------------------------------------------------------------------------
// Composite: exposure, bloom, ACES filmic tonemapping, a little grading,
// and the lens of the game (aberration, visor slits, being hurt, flash,
// vignette, grain), then out in sRGB.

const COMPOSITE_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uBloom, uExposure;
uniform float uBloomStrength, uTime, uVignette, uGrain, uAberration, uHurt, uFlash, uVisor, uBloomOn;
uniform vec2 uResolution;
// ACES fitted (Hill 2016): input sRGB->AP1 RRT+ODT fit, output sRGB
const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) { return saturate(ACESOut * RRTAndODTFit(ACESIn * c)); }
vec3 linearToSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 hdr(vec2 uv) {
  vec3 c = texture(uColor, uv).rgb;
  if (uBloomOn > 0.5) c = mix(c, texture(uBloom, uv).rgb, uBloomStrength);
  return c;
}
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c);
  float ab = uAberration * (0.5 + r * 2.0);
  vec3 col = vec3(hdr(vUv + c * ab).r, hdr(vUv).g, hdr(vUv - c * ab).b);
  if (uHurt > 0.001) {
    vec2 off = vec2(sin(uTime * 1.7), cos(uTime * 1.3)) * 0.012 * uHurt;
    vec3 ghost = hdr(vUv + off);
    vec3 blur = vec3(0.0);
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; blur += hdr(vUv + vec2(cos(a), sin(a)) * 0.006 * uHurt); }
    blur /= 8.0;
    col = mix(col, (col + ghost) * 0.5, 0.6 * uHurt);
    col = mix(col, blur, 0.5 * uHurt);
  }
  float exposure = texture(uExposure, vec2(0.5)).r;
  col *= exposure;
  // grade: warm highlights, slightly cool shadows, gentle saturation (an autumn afternoon)
  float l = luma(col);
  col = mix(col, col * vec3(1.04, 1.0, 0.94), smoothstep(0.2, 1.5, l));
  col = mix(col, col * vec3(0.95, 0.99, 1.06), 1.0 - smoothstep(0.0, 0.25, l));
  col = max(mix(vec3(l), col, 1.06), 0.0);
  col = aces(col);
  if (uHurt > 0.001) { float g = luma(col); col = mix(col, vec3(g), 0.45 * uHurt); col *= 1.0 - smoothstep(0.25, 0.75, r) * 0.75 * uHurt; }
  if (uVisor > 0.001) {
    vec2 q = vec2((vUv.x - 0.5) * uResolution.x / uResolution.y, vUv.y - 0.5);
    float slitL = smoothstep(0.035, 0.02, abs(q.y - 0.02)) * smoothstep(0.62, 0.5, abs(q.x + 0.33));
    float slitR = smoothstep(0.035, 0.02, abs(q.y - 0.02)) * smoothstep(0.62, 0.5, abs(q.x - 0.33));
    float open = max(max(slitL, slitR), 1.0 - uVisor);
    col *= mix(0.04, 1.0, open);
  }
  col += uFlash * vec3(1.0, 0.95, 0.9);
  col *= 1.0 - uVignette * smoothstep(0.35, 0.85, r);
  col = linearToSRGB(saturate(col));
  col += (hash12(vUv * uResolution + fract(uTime * 7.13) * 431.0) - 0.5) * uGrain;
  o = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// Robust contrast-adaptive sharpening (after AMD FidelityFX FSR 1 RCAS):
// restores the crispness temporal filtering costs, limited per pixel so it
// never rings.
const RCAS_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform float uSharpness;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 b = texelFetch(uSrc, p + ivec2(0, 1), 0).rgb;
  vec3 d = texelFetch(uSrc, p + ivec2(-1, 0), 0).rgb;
  vec3 e = texelFetch(uSrc, p, 0).rgb;
  vec3 f = texelFetch(uSrc, p + ivec2(1, 0), 0).rgb;
  vec3 h = texelFetch(uSrc, p + ivec2(0, -1), 0).rgb;
  vec3 mn = min(min(b, d), min(f, h)), mx = max(max(b, d), max(f, h));
  vec3 hitMin = mn / (4.0 * mx + 1e-5);
  vec3 hitMax = (1.0 - mx) / (4.0 * mn - 4.0 - 1e-5);
  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uSharpness;
  vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class Composite {
  constructor() { this.name = 'composite'; this.sharpness = 0.55; this.vignette = 0.32; this.grain = 0.025; }
  init(r) { this.prog = postProgram(r.gl, COMPOSITE_FS, {}, 'composite'); this.rcas = postProgram(r.gl, RCAS_FS, {}, 'rcas'); }
  resize(r) { if (!this.ldr) this.ldr = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba8' }] }); else this.ldr.resize(r.displayW, r.displayH); }
  afterLighting(r, color) {
    const gl = r.gl;
    const L = r.lens ?? {};
    state(gl);
    this.ldr.bind();
    this.prog.use().set('uColor', color).set('uBloom', r.bloomTex ?? color).set('uBloomOn', r.bloomTex ? 1 : 0).set('uBloomStrength', r.pass('bloom')?.strength ?? 0)
      .set('uExposure', r.exposureTex).set('uTime', L.time ?? r.time).set('uVignette', this.vignette).set('uGrain', this.grain)
      .set('uAberration', L.aberration ?? 0.0012).set('uHurt', L.hurt ?? 0).set('uFlash', L.flash ?? 0).set('uVisor', L.visor ?? 0)
      .set('uResolution', [r.displayW, r.displayH]);
    fullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    this.rcas.use().set('uSrc', this.ldr.tex).set('uSharpness', this.sharpness);
    fullscreen(gl);
    return color;
  }
}
void Texture;
