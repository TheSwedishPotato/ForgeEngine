import { Target, Texture, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/**
 * Temporal anti-aliasing and upscaling (TAAU). The scene is rendered at a
 * reduced internal resolution with a different sub-pixel jitter each
 * frame; this pass reconstructs the full display resolution by combining
 * the current samples (Gaussian-weighted by their true sub-pixel position)
 * with the reprojected history, clipped to the current neighbourhood's
 * colour distribution so ghosts cannot survive (Karis 2014; Salvi 2016;
 * Epic's TAAU, 2018).
 */
const FS = /* glsl */`
${COMMON}
in vec2 vUv;
out vec4 o;
uniform sampler2D uCurrent;     // internal resolution, jittered
uniform sampler2D uHistory;     // display resolution
uniform sampler2D uMotion;      // internal resolution: xy motion (uv/frame)
uniform sampler2D uDepth;
uniform vec2 uInSize, uOutSize;
uniform vec2 uJitter;           // pixels at internal resolution
uniform float uReset;

vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
// Tonemapped weighting keeps single bright samples from dominating (Karis).
vec3 tm(vec3 c) { return c / (1.0 + luma(c)); }
vec3 itm(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }

// History with a 5-tap Catmull-Rom (Jimenez 2016): sharp under motion.
vec3 sampleHistory(vec2 uv) {
  vec2 pos = uv * uOutSize;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) / uOutSize, t3 = (c + 2.0) / uOutSize, t12 = (c + w2 / w12) / uOutSize;
  vec3 r = texture(uHistory, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
         + texture(uHistory, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
         + texture(uHistory, vec2(t12.x, t12.y)).rgb * (w12.x * w12.y)
         + texture(uHistory, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
         + texture(uHistory, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, 0.0);
}

void main() {
  // Position of this output pixel in input pixel space (centres at .5).
  vec2 inPos = vUv * uInSize;
  // The jittered image shows, at pixel centre c, what unjittered would be at c - jitter.
  vec2 base = floor(inPos + uJitter);
  vec3 sum = vec3(0.0); float wsum = 0.0;
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  float closest = 1.0; vec2 closestUv = vUv;
  float scale = uOutSize.x / uInSize.x;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 px = base + vec2(x, y);
    vec2 suv = (px + 0.5) / uInSize;
    vec3 s = tm(texture(uCurrent, suv).rgb);
    if (any(isnan(s)) || any(isinf(s))) s = vec3(0.0);   // one bad pixel must not spread through the history
    // where this sample really landed this frame
    vec2 d = (px + 0.5 - uJitter) - inPos;
    float w = exp(-2.29 * dot(d, d) * max(1.0, scale * scale) * 0.6);
    sum += s * w; wsum += w;
    vec3 yc = toYCoCg(s);
    m1 += yc; m2 += yc * yc;
    float dd = texture(uDepth, suv).r;
    if (dd < closest) { closest = dd; closestUv = suv; }
  }
  vec3 cur = sum / max(wsum, 1e-5);
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  vec2 motion = texture(uMotion, closestUv).xy;
  vec2 prevUv = vUv - motion;
  float offscreen = any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0))) ? 1.0 : 0.0;
  vec3 hist = tm(sampleHistory(prevUv));
  if (any(isnan(hist)) || any(isinf(hist))) hist = vec3(0.0);
  // Clip the history toward the neighbourhood mean (variance box, gamma 1.1).
  vec3 hy = toYCoCg(hist);
  vec3 lo = mean - 1.1 * sigma, hi = mean + 1.1 * sigma;
  vec3 dir = hy - mean;
  vec3 ext = max(abs(dir) / max(hi - lo, vec3(1e-5)) * 2.0, vec3(1.0));
  hy = mean + dir / max(ext.x, max(ext.y, ext.z));
  hist = fromYCoCg(hy);
  // Blend: more of the new frame where it has a sample close to this pixel
  // or the scene moved fast; history carries the accumulated detail.
  float speed = length(motion * uOutSize);
  float conf = saturate(wsum / 1.5);
  float alpha = mix(0.035, 0.12, conf) + saturate(speed * 0.02) * 0.1;
  alpha = max(alpha, max(offscreen, uReset));
  vec3 res = mix(hist, cur, alpha);
  if (any(isnan(res)) || any(isinf(res))) res = vec3(0.0);
  o = vec4(itm(res), 1.0);
}`;

export class TAA {
  constructor() { this.name = 'taa'; this.enabled = true; this.reset = true; }

  init(r) { this.prog = postProgram(r.gl, FS, {}, 'taa'); }

  resize(r) {
    const gl = r.gl;
    const w = r.displayW, h = r.displayH;
    if (!this.a) {
      this.a = new Target(gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] });
      this.b = new Target(gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] });
    } else { this.a.resize(w, h); this.b.resize(w, h); }
    this.reset = true;
  }

  afterLighting(r, color) {
    const gl = r.gl;
    this.a.bind();
    state(gl);
    this.prog.use().set('uCurrent', color).set('uHistory', this.b.tex).set('uMotion', r.gbuffer.colors[2]).set('uDepth', r.depth)
      .set('uInSize', [r.width, r.height]).set('uOutSize', [r.displayW, r.displayH]).set('uJitter', r.jitter).set('uReset', this.reset ? 1 : 0);
    fullscreen(gl);
    this.reset = false;
    const out = this.a.tex;
    const t = this.a; this.a = this.b; this.b = t;
    r.displayColor = out;
    return out;
  }
}

/**
 * Without temporal reconstruction, a plain bilinear upscale so the rest of
 * the chain always works at display resolution.
 */
export class Upscale {
  constructor() { this.name = 'upscale'; }
  init(r) { this.prog = postProgram(r.gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'upscale'); }
  resize(r) { if (!this.t) this.t = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] }); else this.t.resize(r.displayW, r.displayH); }
  afterLighting(r, color) {
    if (r.pass('taa')?.enabled) return color;
    this.t.bind(); state(r.gl); this.prog.use().set('uC', color); fullscreen(r.gl);
    r.displayColor = this.t.tex;
    return this.t.tex;
  }
}
void Texture;
