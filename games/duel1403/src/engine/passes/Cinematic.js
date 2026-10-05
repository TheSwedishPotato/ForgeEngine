import { Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

// ---------------------------------------------------------------------------
// Depth of field: physical circle of confusion from a thin lens, half-res
// gather over a 36-tap golden-angle disk with scatter-as-gather weighting
// (a sample only contributes if its own blur reaches this pixel), so sharp
// foreground edges stay sharp over a blurred background.

const COC_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uDepth;
uniform mat4 uInvProj;
uniform float uFocus, uAperture, uFocal, uMaxCoc, uSensor, uHalfWidth;
float linDepth(vec2 uv) { vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, texture(uDepth, uv).r * 2.0 - 1.0, 1.0); return -p.z / p.w; }
void main() {
  // 2x2 prefilter with the CoC of the nearest sample
  vec2 t = 0.5 / vec2(textureSize(uColor, 0));
  vec3 c = vec3(0.0); float coc = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + t * vec2((i & 1) != 0 ? 1.0 : -1.0, (i & 2) != 0 ? 1.0 : -1.0);
    float z = linDepth(uv);
    // thin lens: c = A * f * |z - s| / (z * (s - f)), A = f / N
    float A = uFocal / uAperture;
    float cc = A * uFocal * (z - uFocus) / (z * (uFocus - uFocal));
    cc = clamp(cc / uSensor * uHalfWidth, -uMaxCoc, uMaxCoc);   // metres on the sensor -> half-res pixels
    c += texture(uColor, uv).rgb;
    coc = abs(cc) > abs(coc) ? cc : coc;
  }
  o = vec4(c * 0.25, coc);
}`;

const GATHER_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc;   // rgb + signed CoC in half-res pixels
uniform float uFrame;
void main() {
  vec2 texel = 1.0 / vec2(textureSize(uSrc, 0));
  vec4 centre = texture(uSrc, vUv);
  float cc = abs(centre.a);
  float rot = ign(gl_FragCoord.xy, uFrame) * TAU;
  vec3 sum = centre.rgb; float wsum = 1.0;
  float maxR = 0.0;
  const int N = 36;
  for (int i = 1; i < N; i++) {
    float r = sqrt(float(i) / float(N));
    float a = float(i) * 2.39996323 + rot;
    vec2 off = vec2(cos(a), sin(a)) * r;
    // search radius: the largest blur nearby could reach us
    vec4 s = texture(uSrc, vUv + off * texel * max(cc, 8.0));
    float sc = abs(s.a);
    float dist = r * max(cc, 8.0);
    // background samples may not bleed over a sharper foreground
    float behind = s.a > centre.a + 0.5 ? cc : sc;
    float w = saturate(behind - dist + 1.0);
    sum += s.rgb * w; wsum += w;
  }
  o = vec4(sum / wsum, cc);
}`;

const DOF_COMPOSITE_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uBlur, uCoc;
void main() {
  vec3 sharp = texture(uColor, vUv).rgb;
  vec4 b = texture(uBlur, vUv);
  float coc = abs(texture(uCoc, vUv).a);
  o = vec4(mix(sharp, b.rgb, smoothstep(0.6, 2.0, coc)), 1.0);
}`;

export class DOF {
  constructor() { this.name = 'dof'; this.enabled = true; this.focus = 4; this.aperture = 2.8; this.focal = 0.05; this.amount = 1; this.maxCoc = 14; }
  init(r) {
    this.pCoc = postProgram(r.gl, COC_FS, {}, 'dof-coc');
    this.pGather = postProgram(r.gl, GATHER_FS, {}, 'dof-gather');
    this.pComp = postProgram(r.gl, DOF_COMPOSITE_FS, {}, 'dof-composite');
  }
  resize(r) {
    const w = Math.max(1, r.width >> 1), h = Math.max(1, r.height >> 1);
    if (!this.coc) {
      this.coc = new Target(r.gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] });
      this.blur = new Target(r.gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] });
      this.out = new Target(r.gl, { width: r.width, height: r.height, colors: [{ format: 'rgba16f' }] });
    } else { this.coc.resize(w, h); this.blur.resize(w, h); this.out.resize(r.width, r.height); }
  }
  afterLighting(r, color) {
    if (this.amount <= 0.01) return color;
    const gl = r.gl;
    state(gl);
    this.coc.bind();
    this.pCoc.use().set('uColor', color).set('uDepth', r.depth).set('uInvProj', r.invProj).set('uFocus', Math.max(0.3, this.focus))
      .set('uAperture', this.aperture / Math.max(this.amount, 0.05)).set('uFocal', this.focal).set('uMaxCoc', this.maxCoc).set('uSensor', 0.036).set('uHalfWidth', this.coc.width);
    fullscreen(gl);
    this.blur.bind();
    this.pGather.use().set('uSrc', this.coc.tex).set('uFrame', r.frame);
    fullscreen(gl);
    this.out.bind();
    this.pComp.use().set('uColor', color).set('uBlur', this.blur.tex).set('uCoc', this.coc.tex);
    fullscreen(gl);
    return this.out.tex;
  }
}

// ---------------------------------------------------------------------------
// Motion blur from the per-pixel motion vectors, with a shutter of half a
// frame; depth-aware so a moving blade smears over the background but the
// background does not smear over the blade (McGuire et al. 2012, simplified).

const MB_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uMotion, uDepth;
uniform float uShutter, uFrame;
uniform vec2 uOutSize;
void main() {
  vec2 v = texture(uMotion, vUv).xy * uShutter;
  float px = length(v * uOutSize);
  vec3 c = texture(uColor, vUv).rgb;
  if (px < 0.6) { o = vec4(c, 1.0); return; }
  v *= min(1.0, 40.0 / px);   // cap at 40 px
  float d0 = texture(uDepth, vUv).r;
  float j = ign(gl_FragCoord.xy, uFrame) - 0.5;
  vec3 sum = c; float wsum = 1.0;
  const int N = 10;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5 + j) / float(N) - 0.5;
    vec2 uv = vUv + v * t;
    float d = texture(uDepth, uv).r;
    vec2 sv = texture(uMotion, uv).xy * uShutter;
    // a sample counts if it is in front and moving, or behind and we are moving
    float front = smoothstep(-0.0005, 0.0005, d0 - d);
    float w = mix(saturate(length(sv * uOutSize) / max(px, 1.0)), 1.0, 1.0 - front);
    sum += texture(uColor, uv).rgb * w; wsum += w;
  }
  o = vec4(sum / wsum, 1.0);
}`;

export class MotionBlur {
  constructor() { this.name = 'motionblur'; this.enabled = true; this.shutter = 0.5; }
  init(r) { this.prog = postProgram(r.gl, MB_FS, {}, 'motion-blur'); }
  resize(r) { if (!this.t) this.t = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] }); else this.t.resize(r.displayW, r.displayH); }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    this.t.bind();
    // Scale by real frame time so blur length matches a 1/120 s shutter at any frame rate.
    const sh = this.shutter * Math.min(2, (1 / 60) / Math.max(r.dt, 1e-3));
    this.prog.use().set('uColor', color).set('uMotion', r.gbuffer.colors[2]).set('uDepth', r.depth).set('uShutter', sh)
      .set('uFrame', r.frame).set('uOutSize', [r.displayW, r.displayH]);
    fullscreen(gl);
    return this.t.tex;
  }
}
