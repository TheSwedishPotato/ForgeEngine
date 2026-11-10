/**
 * The post chain: auto exposure, bloom, skin subsurface scattering, temporal anti-aliasing and
 * upscaling (TAAU), the film composite (tonemap, grade, lens, grain) and contrast-adaptive sharpening.
 * Every pass is a FullscreenPass; the Renderer decides the order.
 */
import { struct } from '../../gpu/wgsl.js';
import { generateMips } from '../../gpu/Resources.js';
import { COMMON_WGSL } from '../shaders/common.js';
import { FullscreenPass, RenderTarget, BLEND_ADD } from '../Fullscreen.js';

/** @import { GPUObject } from '../../types.js' */

const RGBA16F = 'rgba16float';

// ---------------------------------------------------------------------------------------------
// Auto exposure: log-average luminance through a mip chain, adapted over time like an eye (faster
// to light than to dark).

const LOGLUM_FS = /* wgsl */`
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  // centre-weighted: what the player looks at matters more
  let c = in.uv - 0.5;
  let w = 1.0 - 0.6 * smoothstep(0.1, 0.6, length(c));
  let l = luma(textureSampleLevel(tColor, sLin, in.uv, 0.0).rgb);
  return vec4f(log2(max(l, 1e-4)) * w, w, 0.0, 1.0);
}`;
const ADAPT_U = struct('U', [['dt', 'f32'], ['key', 'f32'], ['minEV', 'f32'], ['maxEV', 'f32'], ['reset', 'f32'], ['comp', 'f32'], ['level', 'f32']]);
const ADAPT_FS = /* wgsl */`
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  let s = textureSampleLevel(tLog, sLin, vec2f(0.5), u.level).rg;
  let avg = exp2(s.x / max(s.y, 1e-4));
  var tgt = u.key / max(avg, 1e-4);
  tgt = clamp(tgt, exp2(u.minEV), exp2(u.maxEV)) * exp2(u.comp);
  let prev = textureLoad(tPrev, vec2i(0), 0).r;
  let rate = select(2.6, 1.4, tgt > prev);   // adapting to darkness is slower
  var e = prev + (tgt - prev) * (1.0 - exp(-u.dt * rate));
  if (u.reset > 0.5 || !(prev > 0.0)) { e = tgt; }
  return vec4f(e, avg, 0.0, 1.0);
}`;

export class Exposure {
  constructor({ gpu, arena }) {
    this.gpu = gpu;
    this.key = 0.18; this.compensation = 0; this.minEV = -4; this.maxEV = 3; this.reset = true;
    this.log = new RenderTarget(gpu, { width: 256, height: 256, format: RGBA16F, mips: true, label: 'exposure log-luminance' });
    this.a = new RenderTarget(gpu, { width: 1, height: 1, format: RGBA16F, label: 'exposure A' });
    this.b = new RenderTarget(gpu, { width: 1, height: 1, format: RGBA16F, label: 'exposure B' });
    this.pLog = new FullscreenPass(gpu, arena, { label: 'loglum', prelude: COMMON_WGSL, inputs: [['tColor', 'float']], samplers: [['sLin', 'filtering']], fs: LOGLUM_FS });
    this.pAdapt = new FullscreenPass(gpu, arena, { label: 'adapt', prelude: COMMON_WGSL, uniform: ADAPT_U, inputs: [['tLog', 'float'], ['tPrev', 'ufloat']], samplers: [['sLin', 'filtering']], fs: ADAPT_FS });
    this.first = true;
  }
  /** The current exposure texture (1x1: r = multiplier, g = average luminance). */
  get texture() { return this.b; }
  run(enc, colorView, dt) {
    this.pLog.draw(enc, { targets: [{ view: this.log.view, format: RGBA16F, clear: [0, 0, 0, 1] }], views: [colorView] });
    generateMips(this.gpu, this.log.tex, enc);
    this.pAdapt.draw(enc, {
      targets: [{ view: this.a.view, format: RGBA16F, clear: [1, 0, 0, 1] }],
      values: { dt, key: this.key, minEV: this.minEV, maxEV: this.maxEV, reset: this.reset ? 1 : 0, comp: this.compensation, level: 8 },
      views: [this.log.viewAll, this.b.view],
    });
    this.reset = false;
    const t = this.a; this.a = this.b; this.b = t;   // `b` now holds the newest value
  }
}

// ---------------------------------------------------------------------------------------------
// Bloom: the glow of a real lens. Downsample with a 13-tap filter (Karis average on the first
// level against fireflies), upsample with a 3x3 tent, mix a small energy-conserving fraction into
// the image (Jimenez 2014).

const DOWN_U = struct('U', [['texel', 'vec2f'], ['first', 'f32']]);
const DOWN_FS = /* wgsl */`
fn sm(uv: vec2f, off: vec2f) -> vec3f { return textureSampleLevel(tSrc, sLin, uv + off * u.texel, 0.0).rgb; }
fn kw(c: vec3f) -> f32 { return 1.0 / (1.0 + luma(c)); }
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  let uv = in.uv;
  let a = sm(uv, vec2f(-2.0, 2.0)); let b = sm(uv, vec2f(0.0, 2.0)); let c = sm(uv, vec2f(2.0, 2.0));
  let d = sm(uv, vec2f(-2.0, 0.0)); let e = sm(uv, vec2f(0.0, 0.0)); let f = sm(uv, vec2f(2.0, 0.0));
  let g = sm(uv, vec2f(-2.0, -2.0)); let h = sm(uv, vec2f(0.0, -2.0)); let i = sm(uv, vec2f(2.0, -2.0));
  let j = sm(uv, vec2f(-1.0, 1.0)); let k = sm(uv, vec2f(1.0, 1.0)); let l = sm(uv, vec2f(-1.0, -1.0)); let m = sm(uv, vec2f(1.0, -1.0));
  var r: vec3f;
  if (u.first > 0.5) {
    let g0 = (a + b + d + e) * 0.25; let g1 = (b + c + e + f) * 0.25; let g2 = (d + e + g + h) * 0.25; let g3 = (e + f + h + i) * 0.25; let g4 = (j + k + l + m) * 0.25;
    let w0 = kw(g0) * 0.125; let w1 = kw(g1) * 0.125; let w2 = kw(g2) * 0.125; let w3 = kw(g3) * 0.125; let w4 = kw(g4) * 0.5;
    r = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  return vec4f(r, 1.0);
}`;
const UP_U = struct('U', [['texel', 'vec2f'], ['radius', 'f32']]);
const UP_FS = /* wgsl */`
fn sm(uv: vec2f, off: vec2f) -> vec3f { return textureSampleLevel(tSrc, sLin, uv + off, 0.0).rgb; }
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  let t = u.texel * u.radius; let uv = in.uv;
  let r = sm(uv, vec2f(0.0)) * 4.0
    + (sm(uv, vec2f(-t.x, 0.0)) + sm(uv, vec2f(t.x, 0.0)) + sm(uv, vec2f(0.0, -t.y)) + sm(uv, vec2f(0.0, t.y))) * 2.0
    + sm(uv, vec2f(-t.x, -t.y)) + sm(uv, vec2f(t.x, -t.y)) + sm(uv, vec2f(-t.x, t.y)) + sm(uv, t);
  return vec4f(r / 16.0, 1.0);
}`;

export class Bloom {
  constructor({ gpu, arena }) {
    this.gpu = gpu; this.levels = 6; this.strength = 0.045; this.enabled = true;
    this.mips = [];
    this.down = new FullscreenPass(gpu, arena, { label: 'bloom-down', prelude: COMMON_WGSL, uniform: DOWN_U, inputs: [['tSrc', 'float']], samplers: [['sLin', 'filtering']], fs: DOWN_FS });
    this.up = new FullscreenPass(gpu, arena, { label: 'bloom-up', uniform: UP_U, inputs: [['tSrc', 'float']], samplers: [['sLin', 'filtering']], fs: UP_FS });
  }
  resize(w, h) {
    this.w = w; this.h = h;
    let mw = w, mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      if (this.mips[i]) this.mips[i].resize(mw, mh); else this.mips[i] = new RenderTarget(this.gpu, { width: mw, height: mh, format: RGBA16F, label: `bloom ${i}` });
    }
  }
  get texture() { return this.mips[0]; }
  run(enc, colorView) {
    let src = colorView, sw = this.w, sh = this.h;
    for (let i = 0; i < this.levels; i++) {
      const t = this.mips[i];
      this.down.draw(enc, { targets: [{ view: t.view, format: RGBA16F, clear: [0, 0, 0, 1] }], values: { texel: [1 / sw, 1 / sh], first: i === 0 ? 1 : 0 }, views: [src] });
      src = t.view; sw = t.width; sh = t.height;
    }
    for (let i = this.levels - 1; i > 0; i--) {
      const dst = this.mips[i - 1], s = this.mips[i];
      this.up.draw(enc, { targets: [{ view: dst.view, format: RGBA16F }], blend: BLEND_ADD, values: { texel: [1 / s.width, 1 / s.height], radius: 1 }, views: [s.view] });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Skin subsurface scattering (after Jimenez et al., "Separable Subsurface Scattering", 2015). The
// lighting pass writes skin's diffuse light into its own target; here it is blurred along the
// surface with a sum-of-Gaussians skin profile: red light travels several millimetres under the
// skin, green less, blue hardly at all. The kernel is measured in world millimetres and projected
// per pixel; samples that leave the skin or jump in depth are rejected.

const SSS_U = struct('U', [['invProj', 'mat4x4f'], ['dir', 'vec2f'], ['pxPerMeter', 'f32'], ['width', 'f32'], ['pass2', 'f32']]);
const SSS_FS = /* wgsl */`
fn lin(d: f32) -> f32 {
  if (d <= 0.0) { return 1.0e6; }
  let p = u.invProj * vec4f(0.0, 0.0, d, 1.0);
  return -p.z / p.w;
}
fn profile(r2: f32) -> vec3f {
  let V0 = vec3f(0.0064, 0.0064, 0.0064); let V1 = vec3f(0.0484, 0.0484, 0.0310); let V2 = vec3f(0.187, 0.12, 0.05);
  let V3 = vec3f(0.567, 0.21, 0.04); let V4 = vec3f(1.99, 0.41, 0.06);
  let W0 = vec3f(0.233, 0.455, 0.649); let W1 = vec3f(0.100, 0.336, 0.344); let W2 = vec3f(0.118, 0.198, 0.0);
  let W3 = vec3f(0.113, 0.007, 0.007); let W4 = vec3f(0.358, 0.004, 0.0);
  return W0 * exp(-r2 / (2.0 * V0)) + W1 * exp(-r2 / (2.0 * V1)) + W2 * exp(-r2 / (2.0 * V2)) + W3 * exp(-r2 / (2.0 * V3)) + W4 * exp(-r2 / (2.0 * V4));
}
fn depthAt(uv: vec2f) -> f32 {
  let dims = vec2f(textureDimensions(tDepth));
  return textureLoad(tDepth, clamp(vec2i(uv * dims), vec2i(0), vec2i(dims) - 1), 0);
}
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  let c = textureSampleLevel(tSkin, sLin, in.uv, 0.0);
  if (c.a < 0.5) {
    if (u.pass2 > 0.5) { return textureSampleLevel(tColor, sLin, in.uv, 0.0); }
    return c;
  }
  let z = lin(depthAt(in.uv));
  let pxPerMm = u.pxPerMeter / max(z, 0.05) * 0.001 * u.width;
  let texel = 1.0 / vec2f(textureDimensions(tSkin));
  let TAPS = 9;
  let range = 3.2;
  var sum = c.rgb * profile(0.0);
  var wsum = profile(0.0);
  for (var i = 1; i <= TAPS; i++) {
    var mm = range * f32(i) / f32(TAPS);
    mm = mm * mm / range;   // denser near the centre
    let px = mm * pxPerMm;
    if (px < 0.5) { continue; }
    for (var s = -1; s <= 1; s += 2) {
      let uv = in.uv + u.dir * texel * px * f32(s);
      let t = textureSampleLevel(tSkin, sLin, uv, 0.0);
      let zt = lin(depthAt(uv));
      // follow the surface: reject other surfaces and non-skin
      let dz = abs(zt - z) * 1000.0;
      let w = profile(mm * mm + dz * dz) * t.a;
      sum += t.rgb * w; wsum += w;
    }
  }
  let blurred = sum / max(wsum, vec3f(1e-5));
  if (u.pass2 > 0.5) {
    let lit = textureSampleLevel(tColor, sLin, in.uv, 0.0);
    let orig = textureSampleLevel(tOrig, sLin, in.uv, 0.0).rgb;
    return vec4f(lit.rgb - orig + blurred, lit.a);
  }
  return vec4f(blurred, 1.0);
}`;

export class SkinSSS {
  constructor({ gpu, arena }) {
    this.gpu = gpu; this.enabled = true; this.width = 1;
    this.pass = new FullscreenPass(gpu, arena, {
      label: 'skin-sss', uniform: SSS_U, prelude: COMMON_WGSL,
      inputs: [['tSkin', 'float'], ['tDepth', 'depth'], ['tColor', 'float'], ['tOrig', 'float']],
      samplers: [['sLin', 'filtering']], fs: SSS_FS,
    });
  }
  resize(w, h) {
    if (!this.tmp) { this.tmp = new RenderTarget(this.gpu, { width: w, height: h, format: RGBA16F, label: 'sss tmp' }); this.out = new RenderTarget(this.gpu, { width: w, height: h, format: RGBA16F, label: 'sss out' }); }
    else { this.tmp.resize(w, h); this.out.resize(w, h); }
  }
  /** Returns the view of the image with scattered skin. */
  run(enc, r, colorView, skinView, depthView) {
    const pxPerMeter = r.proj.elements[5] * 0.5 * r.height;
    const common = { invProj: r.invProj.elements, pxPerMeter, width: this.width };
    this.pass.draw(enc, { targets: [{ view: this.tmp.view, format: RGBA16F, clear: [0, 0, 0, 0] }], values: { ...common, dir: [1, 0], pass2: 0 }, views: [skinView, depthView, colorView, skinView] });
    this.pass.draw(enc, { targets: [{ view: this.out.view, format: RGBA16F, clear: [0, 0, 0, 1] }], values: { ...common, dir: [0, 1], pass2: 1 }, views: [this.tmp.view, depthView, colorView, skinView] });
    return this.out.view;
  }
}

// ---------------------------------------------------------------------------------------------
// Temporal anti-aliasing and upscaling (TAAU). The scene is rendered at a reduced internal
// resolution with a different sub-pixel jitter each frame; this pass reconstructs the display
// resolution by combining the current samples (Gaussian-weighted by their true sub-pixel position)
// with the reprojected history, clipped to the current neighbourhood's colour distribution so ghosts
// cannot survive (Karis 2014; Salvi 2016; Epic's TAAU, 2018).
//
// Jitter convention: input pixel i holds the scene at (i + 0.5 + jitter) in input-pixel units.

const TAA_U = struct('U', [['inSize', 'vec2f'], ['outSize', 'vec2f'], ['jitter', 'vec2f'], ['reset', 'f32'], ['_p', 'f32']]);
const TAA_FS = /* wgsl */`
fn toYCoCg(c: vec3f) -> vec3f { return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
fn fromYCoCg(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
fn tm(c: vec3f) -> vec3f { return c / (1.0 + luma(c)); }
fn itm(c: vec3f) -> vec3f { return c / max(1.0 - luma(c), 1e-4); }
fn clean(c: vec3f) -> vec3f { return select(vec3f(0.0), clamp(c, vec3f(0.0), vec3f(60000.0)), c == c); }

// history with a 5-tap Catmull-Rom (Jimenez 2016): sharp under motion
fn sampleHistory(uv: vec2f) -> vec3f {
  let pos = uv * u.outSize;
  let c = floor(pos - 0.5) + 0.5;
  let f = pos - c;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (c - 1.0) / u.outSize; let t3 = (c + 2.0) / u.outSize; let t12 = (c + w2 / w12) / u.outSize;
  let r = textureSampleLevel(tHist, sLin, vec2f(t12.x, t0.y), 0.0).rgb * (w12.x * w0.y)
        + textureSampleLevel(tHist, sLin, vec2f(t0.x, t12.y), 0.0).rgb * (w0.x * w12.y)
        + textureSampleLevel(tHist, sLin, vec2f(t12.x, t12.y), 0.0).rgb * (w12.x * w12.y)
        + textureSampleLevel(tHist, sLin, vec2f(t3.x, t12.y), 0.0).rgb * (w3.x * w12.y)
        + textureSampleLevel(tHist, sLin, vec2f(t12.x, t3.y), 0.0).rgb * (w12.x * w3.y);
  let wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, vec3f(0.0));
}

@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  let inPos = in.uv * u.inSize;                    // this output pixel, in input pixel space
  let base = floor(inPos - u.jitter);
  let maxp = vec2i(u.inSize) - 1;
  var sum = vec3f(0.0); var wsum = 0.0;
  var m1 = vec3f(0.0); var m2 = vec3f(0.0);
  var closest = 0.0; var closestP = clamp(vec2i(inPos), vec2i(0), maxp);
  let scale = u.outSize.x / u.inSize.x;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let px = base + vec2f(f32(x), f32(y));
    let ip = clamp(vec2i(px), vec2i(0), maxp);
    let s = tm(clean(textureLoad(tCur, ip, 0).rgb));
    let d = (px + 0.5 + u.jitter) - inPos;         // where this sample really landed
    let w = exp(-2.29 * dot(d, d) * max(1.0, scale * scale) * 0.6);
    sum += s * w; wsum += w;
    let yc = toYCoCg(s);
    m1 += yc; m2 += yc * yc;
    let dd = textureLoad(tDepth, ip, 0);           // reversed-Z: the nearest surface has the largest value
    if (dd > closest) { closest = dd; closestP = ip; }
  }}
  let cur = sum / max(wsum, 1e-5);
  let mean = m1 / 9.0;
  let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
  let motion = textureLoad(tMotion, closestP, 0).xy;
  let prevUv = in.uv - motion;
  var offscreen = 0.0;
  if (any(prevUv < vec2f(0.0)) || any(prevUv > vec2f(1.0))) { offscreen = 1.0; }
  var hist = tm(clean(sampleHistory(prevUv)));
  // clip the history toward the neighbourhood mean (variance box, gamma 1.1)
  var hy = toYCoCg(hist);
  let lo = mean - 1.1 * sigma; let hi = mean + 1.1 * sigma;
  let dir = hy - mean;
  let ext = max(abs(dir) / max(hi - lo, vec3f(1e-5)) * 2.0, vec3f(1.0));
  hy = mean + dir / max(ext.x, max(ext.y, ext.z));
  hist = fromYCoCg(hy);
  // more of the new frame where it has a sample close to this pixel or the scene moved fast
  let speed = length(motion * u.outSize);
  let conf = saturate(wsum / 1.5);
  var alpha = mix(0.035, 0.12, conf) + saturate(speed * 0.02) * 0.1;
  alpha = max(alpha, max(offscreen, u.reset));
  let res = clean(mix(hist, cur, alpha));
  return vec4f(itm(res), 1.0);
}`;

export class TAA {
  constructor({ gpu, arena }) {
    this.gpu = gpu; this.enabled = true; this.reset = true;
    this.pass = new FullscreenPass(gpu, arena, {
      label: 'taa', uniform: TAA_U, prelude: COMMON_WGSL,
      inputs: [['tCur', 'ufloat'], ['tHist', 'float'], ['tMotion', 'ufloat'], ['tDepth', 'depth']], samplers: [['sLin', 'filtering']], fs: TAA_FS,
    });
  }
  resize(w, h) {
    if (!this.a) { this.a = new RenderTarget(this.gpu, { width: w, height: h, format: RGBA16F, label: 'taa A' }); this.b = new RenderTarget(this.gpu, { width: w, height: h, format: RGBA16F, label: 'taa B' }); }
    else { this.a.resize(w, h); this.b.resize(w, h); }
    this.reset = true;
  }
  /** Resolves into the display-resolution image; returns its view. */
  run(enc, r, colorView, motionView, depthView) {
    this.pass.draw(enc, {
      targets: [{ view: this.a.view, format: RGBA16F, clear: [0, 0, 0, 1] }],
      values: { inSize: [r.width, r.height], outSize: [r.displayW, r.displayH], jitter: r.jitter, reset: this.reset ? 1 : 0 },
      views: [colorView, this.b.view, motionView, depthView],
    });
    this.reset = false;
    const out = this.a.view;
    const t = this.a; this.a = this.b; this.b = t;
    return out;
  }
}

/** Without temporal reconstruction: a bilinear upscale so the rest of the chain works at display resolution. */
export class Upscale {
  constructor({ gpu, arena }) {
    this.gpu = gpu;
    this.pass = new FullscreenPass(gpu, arena, { label: 'upscale', inputs: [['tC', 'float']], samplers: [['sLin', 'filtering']], fs: /* wgsl */`
      @fragment fn fs(in: FsOut) -> @location(0) vec4f { return textureSampleLevel(tC, sLin, in.uv, 0.0); }` });
  }
  resize(w, h) { if (!this.t) this.t = new RenderTarget(this.gpu, { width: w, height: h, format: RGBA16F, label: 'upscale' }); else this.t.resize(w, h); }
  run(enc, colorView) { this.pass.draw(enc, { targets: [{ view: this.t.view, format: RGBA16F, clear: [0, 0, 0, 1] }], views: [colorView] }); return this.t.view; }
}

// ---------------------------------------------------------------------------------------------
// Composite ("film"): exposure, bloom and halation, ACES filmic tonemapping, sRGB encoding, a
// per-shot grade (lift / gamma / gain, white balance, split toning, saturation, contrast), the lens
// of the shot (chromatic aberration, vignette, raindrops on the glass), letterbox bars, fades, and
// fine luminance-weighted film grain.

const COMP_U = struct('U', [
  ['resolution', 'vec2f'], ['time', 'f32'], ['vignette', 'f32'],
  ['grain', 'f32'], ['aberration', 'f32'], ['hurt', 'f32'], ['flash', 'f32'],
  ['visor', 'f32'], ['bloomOn', 'f32'], ['bloomStrength', 'f32'], ['streakOn', 'f32'],
  ['streakStrength', 'f32'], ['saturation', 'f32'], ['contrast', 'f32'], ['temperature', 'f32'],
  ['halation', 'f32'], ['fade', 'f32'], ['letterbox', 'f32'], ['lensRain', 'f32'],
  ['exposureBias', 'f32'], ['encode', 'f32'], ['_p0', 'f32'], ['_p1', 'f32'],
  ['streakTint', 'vec3f'], ['lift', 'vec3f'], ['gamma', 'vec3f'], ['gain', 'vec3f'],
  ['shadowTint', 'vec3f'], ['highTint', 'vec3f'], ['fadeColor', 'vec3f'],
]);
const COMP_FS = /* wgsl */`
const ACESIn = mat3x3f(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const ACESOut = mat3x3f(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
fn RRTAndODTFit(v: vec3f) -> vec3f { let a = v * (v + 0.0245786) - 0.000090537; let b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
fn aces(c: vec3f) -> vec3f { return saturate(ACESOut * RRTAndODTFit(ACESIn * c)); }
fn linearToSRGB(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
fn hdr(uv: vec2f) -> vec3f {
  var c = textureSampleLevel(tColor, sLin, uv, 0.0).rgb;
  if (u.bloomOn > 0.5) {
    let b = textureSampleLevel(tBloom, sLin, uv, 0.0).rgb;
    c = mix(c, b, u.bloomStrength);
    // halation: film's red-orange glow around strong highlights
    c += b * vec3f(1.0, 0.35, 0.12) * u.halation * smoothstep(0.5, 4.0, luma(b));
  }
  if (u.streakOn > 0.5) { c += textureSampleLevel(tStreak, sLin, uv, 0.0).rgb * u.streakTint * u.streakStrength; }
  return c;
}
struct Drops { offset: vec2f, mask: f32 };
// raindrops on the lens: a few cells hold a drop that refracts (flips) what is behind it
fn lensDrops(uv: vec2f) -> Drops {
  let asp = vec2f(u.resolution.x / u.resolution.y, 1.0);
  var r: Drops; r.offset = vec2f(0.0); r.mask = 0.0;
  for (var l = 0; l < 2; l++) {
    let sc = select(13.0, 7.0, l == 0);
    let p = uv * asp * sc + vec2f(0.0, u.time * select(0.05, 0.02, l == 0));
    let id = floor(p); let f = fract(p) - 0.5;
    let h = hash12(id + f32(l) * 17.0);
    if (h > u.lensRain * 0.55) { continue; }
    let c = (hash22(id) - 0.5) * 0.5;
    let life = fract(u.time * 0.1 + h * 7.0);
    let rad = (0.12 + 0.18 * hash12(id * 3.1)) * smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.85, 1.0, life));
    let d = f - c;
    let m = smoothstep(rad, rad * 0.8, length(d * vec2f(1.0, 0.85)));
    r.offset += -d * m * 0.35 / sc;
    r.mask = max(r.mask, m);
  }
  return r;
}
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  // letterbox: the frame is 2.39:1 (anamorphic scope) when letterbox > 0
  let aspect = u.resolution.x / u.resolution.y;
  var bar = 0.0;
  if (u.letterbox > 0.0) { bar = max(0.0, (1.0 - aspect / 2.39) * 0.5) * u.letterbox; }
  if (in.uv.y < bar || in.uv.y > 1.0 - bar) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  var uv = in.uv;
  var dropMask = 0.0;
  if (u.lensRain > 0.0) { let d = lensDrops(in.uv); uv += d.offset; dropMask = d.mask; }
  let c = uv - 0.5;
  let r = length(c);
  let ab = u.aberration * (0.5 + r * 2.0);
  var col = vec3f(hdr(uv + c * ab).r, hdr(uv).g, hdr(uv - c * ab).b);
  if (dropMask > 0.0) { col = mix(col, col * 1.12 + vec3f(0.002), dropMask); }
  if (u.hurt > 0.001) {
    let off = vec2f(sin(u.time * 1.7), cos(u.time * 1.3)) * 0.012 * u.hurt;
    let ghost = hdr(uv + off);
    var blur = vec3f(0.0);
    for (var i = 0; i < 8; i++) { let a = f32(i) * 0.785; blur += hdr(uv + vec2f(cos(a), sin(a)) * 0.006 * u.hurt); }
    blur /= 8.0;
    col = mix(col, (col + ghost) * 0.5, 0.6 * u.hurt);
    col = mix(col, blur, 0.5 * u.hurt);
  }
  let exposure = textureLoad(tExposure, vec2i(0), 0).r * exp2(u.exposureBias);
  col *= exposure;
  // white balance (temperature: + warm, - cool), in linear light before the curve
  col *= vec3f(1.0 + u.temperature * 0.10, 1.0, 1.0 - u.temperature * 0.12);
  col = aces(col);
  if (u.encode > 0.5) { col = linearToSRGB(col); }
  // grade in display space: lift / gamma / gain (ASC CDL style), split toning
  var l = luma(col);
  col = mix(col, col * u.shadowTint, (1.0 - smoothstep(0.0, 0.35, l)));
  col = mix(col, col * u.highTint, smoothstep(0.45, 1.0, l));
  col = pow(max(col * u.gain + u.lift * (1.0 - col), vec3f(0.0)), vec3f(1.0) / max(u.gamma, vec3f(0.01)));
  l = luma(col);
  col = mix(vec3f(l), col, u.saturation);
  col = saturate((col - 0.5) * u.contrast + 0.5);
  if (u.hurt > 0.001) { let g = luma(col); col = mix(col, vec3f(g), 0.45 * u.hurt); col *= 1.0 - smoothstep(0.25, 0.75, r) * 0.75 * u.hurt; }
  if (u.visor > 0.001) {
    let q = vec2f((in.uv.x - 0.5) * u.resolution.x / u.resolution.y, in.uv.y - 0.5);
    let slitL = smoothstep(0.035, 0.02, abs(q.y - 0.02)) * smoothstep(0.62, 0.5, abs(q.x + 0.33));
    let slitR = smoothstep(0.035, 0.02, abs(q.y - 0.02)) * smoothstep(0.62, 0.5, abs(q.x - 0.33));
    let open = max(max(slitL, slitR), 1.0 - u.visor);
    col *= mix(0.04, 1.0, open);
  }
  col += u.flash * vec3f(1.0, 0.95, 0.9);
  col *= 1.0 - u.vignette * smoothstep(0.3, 0.9, r);
  col = mix(col, u.fadeColor, u.fade);
  // grain: finer, and stronger in the mids than in the blacks and whites (like film)
  let gl = luma(col);
  let g = hash12(in.uv * u.resolution + fract(u.time * 7.13) * 431.0) + hash12(in.uv * u.resolution * 0.5 + fract(u.time * 3.7) * 97.0) - 1.0;
  col += g * u.grain * (0.35 + 1.3 * gl * (1.0 - gl));
  return vec4f(saturate(col), 1.0);
}`;

// Robust contrast-adaptive sharpening (after AMD FidelityFX FSR 1 RCAS): restores the crispness
// temporal filtering costs, limited per pixel so it never rings.
const RCAS_U = struct('U', [['sharpness', 'f32']]);
const RCAS_FS = /* wgsl */`
@fragment fn fs(in: FsOut) -> @location(0) vec4f {
  let p = vec2i(in.pos.xy);
  let mx_ = vec2i(textureDimensions(tSrc)) - 1;
  let b = textureLoad(tSrc, clamp(p + vec2i(0, 1), vec2i(0), mx_), 0).rgb;
  let d = textureLoad(tSrc, clamp(p + vec2i(-1, 0), vec2i(0), mx_), 0).rgb;
  let e = textureLoad(tSrc, p, 0).rgb;
  let f = textureLoad(tSrc, clamp(p + vec2i(1, 0), vec2i(0), mx_), 0).rgb;
  let h = textureLoad(tSrc, clamp(p + vec2i(0, -1), vec2i(0), mx_), 0).rgb;
  let mn = min(min(b, d), min(f, h)); let mxv = max(max(b, d), max(f, h));
  let hitMin = mn / (4.0 * mxv + 1e-5);
  let hitMax = (1.0 - mxv) / (4.0 * mn - 4.0 - 1e-5);
  let lobeRGB = max(-hitMin, hitMax);
  let lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * u.sharpness;
  let c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}`;

/**
 * The colour grade of a shot, applied in the film composite (in linear light, before the tone curve and the sRGB encoding). The
 * neutral values change nothing. RGB triples are `[r, g, b]`.
 * @typedef {object} ColorGrade
 * @property {[number, number, number]} lift        raises the blacks: added in proportion to how dark each channel is (0 = none)
 * @property {[number, number, number]} gamma       midtone curve per channel (1 = none; above 1 brightens the midtones)
 * @property {[number, number, number]} gain       multiplies the whole picture per channel (1 = none)
 * @property {[number, number, number]} shadowTint multiplies the shadows (1 = none): a cool or a green cast in the dark parts
 * @property {[number, number, number]} highTint   multiplies the highlights (1 = none)
 * @property {number} saturation   1 = none, 0 = black and white
 * @property {number} contrast     1 = none; pivots around mid grey of the display range
 * @property {number} temperature  white balance: positive is warmer, negative cooler (0 = none); each unit scales red 10% up and blue 12% down
 * @property {number} halation     0 = none; the red-orange glow film puts around strong highlights
 * @property {number} exposureBias stops added to the automatic exposure (0 = none)
 */

/**
 * The neutral grade: what every shot starts from.
 * @type {ColorGrade}
 */
export const NEUTRAL_GRADE = {
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], shadowTint: [1, 1, 1], highTint: [1, 1, 1],
  saturation: 1, contrast: 1, temperature: 0, halation: 0, exposureBias: 0,
};

/**
 * What `Composite.run` draws from, besides the encoder and the renderer.
 * @typedef {object} CompositeInputs
 * @property {GPUObject} colorView          the display-resolution HDR image
 * @property {GPUObject | null} [bloomView]
 * @property {number} [bloomStrength]
 * @property {GPUObject | null} [streakView]  anamorphic streaks, when there are any
 * @property {number} [streakStrength]
 * @property {number[]} [streakTint]        [r, g, b]
 * @property {GPUObject} exposureView       the 1x1 exposure texture
 * @property {GPUObject} outView            the surface's view
 * @property {string} outFormat             the surface's format
 * @property {{ time?: number, aberration?: number, hurt?: number, flash?: number, visor?: number }} [lens]  the lens effects of the shot
 * @property {number} [time]
 */

export class Composite {
  constructor({ gpu, arena }) {
    this.gpu = gpu;
    this.sharpness = 0.55; this.vignette = 0.32; this.grain = 0.025;
    /** @type {ColorGrade} */
    this.grade = { ...NEUTRAL_GRADE, lift: [...NEUTRAL_GRADE.lift], gamma: [...NEUTRAL_GRADE.gamma], gain: [...NEUTRAL_GRADE.gain], shadowTint: [...NEUTRAL_GRADE.shadowTint], highTint: [...NEUTRAL_GRADE.highTint] };
    this.letterbox = 0; this.fade = 0; this.fadeColor = [0, 0, 0]; this.lensRain = 0;
    this.encodeSRGB = true;
    this.pass = new FullscreenPass(gpu, arena, {
      label: 'composite', uniform: COMP_U, prelude: COMMON_WGSL,
      inputs: [['tColor', 'float'], ['tBloom', 'float'], ['tExposure', 'ufloat'], ['tStreak', 'float']], samplers: [['sLin', 'filtering']], fs: COMP_FS,
    });
    this.rcas = new FullscreenPass(gpu, arena, { label: 'rcas', uniform: RCAS_U, inputs: [['tSrc', 'ufloat']], fs: RCAS_FS });
    this.black = null;
  }
  resize(w, h) {
    if (!this.ldr) this.ldr = new RenderTarget(this.gpu, { width: w, height: h, format: 'rgba8unorm', label: 'composite ldr' }); else this.ldr.resize(w, h);
    if (!this.blackTex) {
      this.blackTex = new RenderTarget(this.gpu, { width: 1, height: 1, format: RGBA16F, label: 'black' });
    }
  }
  /**
   * Tone maps, grades and sharpens `colorView` into the surface.
   * @param {GPUObject} enc  a GPUCommandEncoder
   * @param {{ displayW: number, displayH: number }} r  the renderer (its display size)
   * @param {CompositeInputs} o
   */
  run(enc, r, { colorView, bloomView, bloomStrength, streakView = null, streakStrength = 0, streakTint = [1, 1, 1], exposureView, outView, outFormat, lens = {}, time = 0 }) {
    const G = this.grade;
    this.pass.draw(enc, {
      targets: [{ view: this.ldr.view, format: 'rgba8unorm', clear: [0, 0, 0, 1] }],
      values: {
        resolution: [r.displayW, r.displayH], time: lens.time ?? time, vignette: this.vignette, grain: this.grain,
        aberration: lens.aberration ?? 0.0012, hurt: lens.hurt ?? 0, flash: lens.flash ?? 0, visor: lens.visor ?? 0,
        bloomOn: bloomView ? 1 : 0, bloomStrength: bloomStrength ?? 0, streakOn: streakView ? 1 : 0, streakStrength,
        saturation: G.saturation, contrast: G.contrast, temperature: G.temperature, halation: G.halation,
        fade: this.fade, letterbox: this.letterbox, lensRain: this.lensRain, exposureBias: G.exposureBias, encode: this.encodeSRGB ? 1 : 0,
        streakTint, lift: G.lift, gamma: G.gamma, gain: G.gain, shadowTint: G.shadowTint, highTint: G.highTint, fadeColor: this.fadeColor,
      },
      views: [colorView, bloomView ?? this.blackTex.view, exposureView, streakView ?? this.blackTex.view],
    });
    this.rcas.draw(enc, { targets: [{ view: outView, format: outFormat, clear: [0, 0, 0, 1] }], values: { sharpness: this.sharpness }, views: [this.ldr.view] });
  }
}
