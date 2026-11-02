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
// Anamorphic streaks: the horizontal flare an anamorphic lens draws through
// every bright light (street lamps, headlights, lightning). Bright pixels at a
// quarter resolution are smeared sideways in widening steps, then tinted.

const STREAK_PREFILTER_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform sampler2D uExposure; uniform float uThreshold;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * texture(uExposure, vec2(0.5)).r;
  float l = luma(c);
  o = vec4(c * smoothstep(uThreshold, uThreshold * 2.5, l) / max(texture(uExposure, vec2(0.5)).r, 1e-4), 1.0);
}`;
const STREAK_BLUR_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform float uStep;
void main() {
  vec2 t = vec2(uStep / float(textureSize(uSrc, 0).x), 0.0);
  vec3 c = texture(uSrc, vUv).rgb * 0.30
    + (texture(uSrc, vUv - t).rgb + texture(uSrc, vUv + t).rgb) * 0.22
    + (texture(uSrc, vUv - 2.0 * t).rgb + texture(uSrc, vUv + 2.0 * t).rgb) * 0.13;
  o = vec4(c, 1.0);
}`;

export class Anamorphic {
  constructor() { this.name = 'anamorphic'; this.enabled = true; this.threshold = 1.6; this.strength = 0.06; this.tint = [0.55, 0.75, 1.25]; }
  init(r) { this.pPre = postProgram(r.gl, STREAK_PREFILTER_FS, {}, 'streak-pre'); this.pBlur = postProgram(r.gl, STREAK_BLUR_FS, {}, 'streak-blur'); }
  resize(r) {
    const w = Math.max(1, r.displayW >> 2), h = Math.max(1, r.displayH >> 3);
    if (!this.a) { this.a = new Target(r.gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] }); this.b = new Target(r.gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] }); }
    else { this.a.resize(w, h); this.b.resize(w, h); }
  }
  afterLighting(r, color) {
    if (!r.exposureTex) return color;
    const gl = r.gl;
    state(gl);
    this.a.bind();
    this.pPre.use().set('uSrc', color).set('uExposure', r.exposureTex).set('uThreshold', this.threshold);
    fullscreen(gl);
    let src = this.a, dst = this.b;
    this.pBlur.use();
    for (const step of [1, 3, 9, 27, 60]) {
      dst.bind(); this.pBlur.set('uSrc', src.tex).set('uStep', step); fullscreen(gl);
      const t = src; src = dst; dst = t;
    }
    r.streakTex = src.tex;
    return color;
  }
}

// ---------------------------------------------------------------------------
// Composite (Med Engine 2 "film"): exposure, bloom and halation, anamorphic
// streaks, ACES filmic tonemapping, a per-shot grade (lift/gamma/gain, white
// balance, split toning, saturation, contrast), the lens of the shot
// (chromatic aberration, vignette, raindrops on the glass), letterbox bars,
// fades, and fine luminance-weighted film grain; out in sRGB.

const COMPOSITE_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uBloom, uExposure, uStreak;
uniform float uBloomStrength, uTime, uVignette, uGrain, uAberration, uHurt, uFlash, uVisor, uBloomOn, uStreakOn, uStreakStrength;
uniform vec3 uStreakTint;
uniform vec2 uResolution;
uniform vec3 uLift, uGamma, uGain, uShadowTint, uHighTint;
uniform float uSaturation, uContrast, uTemperature, uHalation, uFade, uLetterbox, uLensRain, uExposureBias;
uniform vec3 uFadeColor;
const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) { return saturate(ACESOut * RRTAndODTFit(ACESIn * c)); }
vec3 linearToSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 hdr(vec2 uv) {
  vec3 c = texture(uColor, uv).rgb;
  if (uBloomOn > 0.5) {
    vec3 b = texture(uBloom, uv).rgb;
    c = mix(c, b, uBloomStrength);
    // halation: film's red-orange glow around strong highlights
    c += b * vec3(1.0, 0.35, 0.12) * uHalation * smoothstep(0.5, 4.0, luma(b));
  }
  if (uStreakOn > 0.5) c += texture(uStreak, uv).rgb * uStreakTint * uStreakStrength;
  return c;
}
// Raindrops on the lens: a few cells hold a drop that refracts (flips) what is behind it.
vec2 lensDrops(vec2 uv, out float mask) {
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 offset = vec2(0.0); mask = 0.0;
  for (int l = 0; l < 2; l++) {
    float sc = l == 0 ? 7.0 : 13.0;
    vec2 p = uv * asp * sc + vec2(0.0, uTime * (l == 0 ? 0.02 : 0.05));
    vec2 id = floor(p), f = fract(p) - 0.5;
    float h = hash12(id + float(l) * 17.0);
    if (h > uLensRain * 0.55) continue;
    vec2 c = (hash22(id) - 0.5) * 0.5;
    float life = fract(uTime * 0.1 + h * 7.0);
    float r = (0.12 + 0.18 * hash12(id * 3.1)) * smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.85, 1.0, life));
    vec2 d = f - c;
    float m = smoothstep(r, r * 0.8, length(d * vec2(1.0, 0.85)));
    offset += -d * m * 0.35 / sc;
    mask = max(mask, m);
  }
  return offset;
}
void main() {
  // letterbox: the frame is 2.39:1 (anamorphic scope) when uLetterbox > 0
  float aspect = uResolution.x / uResolution.y;
  float bar = uLetterbox > 0.0 ? max(0.0, (1.0 - aspect / 2.39) * 0.5) * uLetterbox : 0.0;
  if (vUv.y < bar || vUv.y > 1.0 - bar) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 uv = vUv;
  float dropMask = 0.0;
  if (uLensRain > 0.0) uv += lensDrops(vUv, dropMask);
  vec2 c = uv - 0.5;
  float r = length(c);
  float ab = uAberration * (0.5 + r * 2.0);
  vec3 col = vec3(hdr(uv + c * ab).r, hdr(uv).g, hdr(uv - c * ab).b);
  if (dropMask > 0.0) col = mix(col, col * 1.12 + vec3(0.002), dropMask);
  if (uHurt > 0.001) {
    vec2 off = vec2(sin(uTime * 1.7), cos(uTime * 1.3)) * 0.012 * uHurt;
    vec3 ghost = hdr(uv + off);
    vec3 blur = vec3(0.0);
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; blur += hdr(uv + vec2(cos(a), sin(a)) * 0.006 * uHurt); }
    blur /= 8.0;
    col = mix(col, (col + ghost) * 0.5, 0.6 * uHurt);
    col = mix(col, blur, 0.5 * uHurt);
  }
  float exposure = texture(uExposure, vec2(0.5)).r * exp2(uExposureBias);
  col *= exposure;
  // white balance (temperature: + warm, - cool), in linear light before the curve
  col *= vec3(1.0 + uTemperature * 0.10, 1.0, 1.0 - uTemperature * 0.12);
  col = aces(col);
  // grade in display space: lift / gamma / gain (ASC CDL style), split toning
  float l = luma(col);
  col = mix(col, col * uShadowTint, (1.0 - smoothstep(0.0, 0.35, l)));
  col = mix(col, col * uHighTint, smoothstep(0.45, 1.0, l));
  col = pow(max(col * uGain + uLift * (1.0 - col), 0.0), 1.0 / max(uGamma, vec3(0.01)));
  l = luma(col);
  col = mix(vec3(l), col, uSaturation);
  col = saturate((col - 0.5) * uContrast + 0.5);
  if (uHurt > 0.001) { float g = luma(col); col = mix(col, vec3(g), 0.45 * uHurt); col *= 1.0 - smoothstep(0.25, 0.75, r) * 0.75 * uHurt; }
  if (uVisor > 0.001) {
    vec2 q = vec2((vUv.x - 0.5) * uResolution.x / uResolution.y, vUv.y - 0.5);
    float slitL = smoothstep(0.035, 0.02, abs(q.y - 0.02)) * smoothstep(0.62, 0.5, abs(q.x + 0.33));
    float slitR = smoothstep(0.035, 0.02, abs(q.y - 0.02)) * smoothstep(0.62, 0.5, abs(q.x - 0.33));
    float open = max(max(slitL, slitR), 1.0 - uVisor);
    col *= mix(0.04, 1.0, open);
  }
  col += uFlash * vec3(1.0, 0.95, 0.9);
  col *= 1.0 - uVignette * smoothstep(0.3, 0.9, r * vec2(aspect / 1.78, 1.0).x * 1.0 + r * 0.0);
  col = mix(col, uFadeColor, uFade);
  // grain: finer, and stronger in the mids than in the blacks and whites (like film)
  float gl = luma(col);
  float g = (hash12(vUv * uResolution + fract(uTime * 7.13) * 431.0) + hash12(vUv * uResolution * 0.5 + fract(uTime * 3.7) * 97.0) - 1.0);
  col += g * uGrain * (0.35 + 1.3 * gl * (1.0 - gl));
  col = saturate(col);
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

/** The look of a shot: the grade and lens. Defaults are neutral. */
export const NEUTRAL_GRADE = {
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], shadowTint: [1, 1, 1], highTint: [1, 1, 1],
  saturation: 1, contrast: 1, temperature: 0, halation: 0.0, exposureBias: 0,
};

export class Composite {
  constructor() {
    this.name = 'composite'; this.sharpness = 0.55; this.vignette = 0.32; this.grain = 0.025;
    this.grade = { ...NEUTRAL_GRADE };
    this.letterbox = 0;        // 0..1 (animates the bars in)
    this.fade = 0; this.fadeColor = [0, 0, 0];
    this.lensRain = 0;         // raindrops on the lens, 0..1
  }
  init(r) { this.prog = postProgram(r.gl, COMPOSITE_FS, {}, 'composite'); this.rcas = postProgram(r.gl, RCAS_FS, {}, 'rcas'); }
  resize(r) { if (!this.ldr) this.ldr = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba8' }] }); else this.ldr.resize(r.displayW, r.displayH); }
  afterLighting(r, color) {
    const gl = r.gl;
    const L = r.lens ?? {};
    const G = this.grade, an = r.pass('anamorphic');
    state(gl);
    this.ldr.bind();
    this.prog.use().set('uColor', color).set('uBloom', r.bloomTex ?? color).set('uBloomOn', r.bloomTex ? 1 : 0).set('uBloomStrength', r.pass('bloom')?.strength ?? 0)
      .set('uStreak', r.streakTex ?? color).set('uStreakOn', r.streakTex && an?.enabled !== false ? 1 : 0).set('uStreakStrength', an?.strength ?? 0).set('uStreakTint', an?.tint ?? [1, 1, 1])
      .set('uExposure', r.exposureTex).set('uTime', L.time ?? r.time).set('uVignette', this.vignette).set('uGrain', this.grain)
      .set('uAberration', L.aberration ?? 0.0012).set('uHurt', L.hurt ?? 0).set('uFlash', L.flash ?? 0).set('uVisor', L.visor ?? 0)
      .set('uResolution', [r.displayW, r.displayH])
      .set('uLift', G.lift).set('uGamma', G.gamma).set('uGain', G.gain).set('uShadowTint', G.shadowTint).set('uHighTint', G.highTint)
      .set('uSaturation', G.saturation).set('uContrast', G.contrast).set('uTemperature', G.temperature).set('uHalation', G.halation).set('uExposureBias', G.exposureBias)
      .set('uFade', this.fade).set('uFadeColor', this.fadeColor).set('uLetterbox', this.letterbox).set('uLensRain', this.lensRain);
    fullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    this.rcas.use().set('uSrc', this.ldr.tex).set('uSharpness', this.sharpness);
    fullscreen(gl);
    return color;
  }
}
void Texture;
