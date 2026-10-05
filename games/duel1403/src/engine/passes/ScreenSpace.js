import { Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';
import { GBUFFER_READ } from '../shaders/lighting.js';

/**
 * Screen-space lighting effects that feed the deferred lighting pass:
 *   SSAO  — ground-truth-style horizon ambient occlusion (Jimenez 2016, XeGTAO)
 *   SSR   — reflections ray-marched against the depth buffer
 *   SSGI  — one-bounce diffuse light: cosine-distributed rays find the
 *           surfaces nearby and bring their (last frame's) light; denoised
 *           temporally and with an edge-aware à-trous filter.
 * SSR and SSGI read the previous frame's lit image (mip-mapped), reprojected
 * with the motion vectors.
 */

const VIEW_HELPERS = /* glsl */`
float viewZ(vec2 uv) { vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, texture(uDepth, uv).r * 2.0 - 1.0, 1.0); return p.z / p.w; }
vec3 viewPos(vec2 uv) { return viewFromDepth(uv, texture(uDepth, uv).r); }
vec2 projectUv(vec3 v) { vec4 c = uProj * vec4(v, 1.0); return c.xy / c.w * 0.5 + 0.5; }
vec3 viewNormal(vec2 uv) { return normalize(mat3(uView) * decodeNormal(texture(uG1, uv).xy)); }
`;

// Linear screen-space march along a view-space ray; returns hit uv in xy, 1 if hit in z.
const MARCH = /* glsl */`
vec3 marchRay(vec3 origin, vec3 dir, float maxDist, int steps, float jitter, float thickness) {
  // clip the ray to just in front of the near plane
  float len = maxDist;
  if (origin.z + dir.z * len > -0.06) len = (-0.06 - origin.z) / dir.z;
  vec3 endP = origin + dir * len;
  vec2 a = projectUv(origin), b = projectUv(endP);
  vec3 hit = vec3(0.0);
  float prevT = 0.0;
  for (int i = 1; i <= 48; i++) {
    if (i > steps) break;
    float t = (float(i) - 1.0 + jitter) / float(steps);
    t = t * t;  // more steps near the origin
    vec2 uv = mix(a, b, t);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) break;
    // perspective-correct depth along the ray
    float rz = 1.0 / mix(1.0 / origin.z, 1.0 / endP.z, t);
    float sz = viewZ(uv);
    float diff = sz - rz;   // >0: scene surface is in front of the ray (ray went behind it)
    if (diff > 0.0 && diff < thickness + abs(rz) * 0.02) {
      // binary refinement
      float lo = prevT, hi = t;
      for (int k = 0; k < 5; k++) {
        float m = 0.5 * (lo + hi);
        vec2 muv = mix(a, b, m);
        float mz = 1.0 / mix(1.0 / origin.z, 1.0 / endP.z, m);
        if (viewZ(muv) - mz > 0.0) hi = m; else lo = m;
      }
      return vec3(mix(a, b, hi), 1.0);
    }
    prevT = t;
  }
  return vec3(0.0);
}`;

const AO_FS = /* glsl */`
${COMMON}
${GBUFFER_READ}
${VIEW_HELPERS}
in vec2 vUv; out vec4 o;
uniform float uFrame, uRadius;
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) { o = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec3 N = viewNormal(vUv);
  vec3 V = normalize(-P);
  float noiseA = ign(gl_FragCoord.xy, uFrame);
  float noiseB = ign(gl_FragCoord.xy + 37.0, uFrame);
  // radius in uv units
  float rUv = uRadius * uProj[0][0] / max(-P.z, 0.1) * 0.5;
  rUv = min(rUv, 0.12);
  const int SLICES = 3, STEPS = 6;
  float vis = 0.0;
  for (int s = 0; s < SLICES; s++) {
    float phi = (float(s) + noiseA) * PI / float(SLICES);
    vec2 omega = vec2(cos(phi), sin(phi));
    vec3 dirV = vec3(omega, 0.0);
    vec3 ortho = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(ortho, V));
    vec3 projN = N - axis * dot(N, axis);
    float projNLen = length(projN);
    float sgnN = sign(dot(ortho, projN));
    float cosN = saturate(dot(projN, V) / max(projNLen, 1e-4));
    float n = sgnN * acos(cosN);
    float hc0 = -1.0, hc1 = -1.0;
    for (int j = 0; j < STEPS; j++) {
      float st = (float(j) + noiseB) / float(STEPS);
      st = st * st;
      vec2 off = omega * st * rUv + omega / uResolution * 1.5;
      vec3 S0 = viewPos(vUv + off) - P, S1 = viewPos(vUv - off) - P;
      float l0 = length(S0), l1 = length(S1);
      float w0 = saturate((uRadius - l0) / (uRadius * 0.6)), w1 = saturate((uRadius - l1) / (uRadius * 0.6));
      hc0 = max(hc0, mix(-1.0, dot(S0 / l0, V), w0));
      hc1 = max(hc1, mix(-1.0, dot(S1 / l1, V), w1));
    }
    float h0 = -acos(clamp(hc1, -1.0, 1.0));
    float h1 = acos(clamp(hc0, -1.0, 1.0));
    h0 = n + clamp(h0 - n, -PI * 0.5, PI * 0.5);
    h1 = n + clamp(h1 - n, -PI * 0.5, PI * 0.5);
    float sinN = sin(n);
    float a0 = (cosN + 2.0 * h0 * sinN - cos(2.0 * h0 - n)) * 0.25;
    float a1 = (cosN + 2.0 * h1 * sinN - cos(2.0 * h1 - n)) * 0.25;
    vis += projNLen * (a0 + a1);
  }
  vis /= float(SLICES);
  o = vec4(pow(saturate(vis), 1.15), 0.0, 0.0, 1.0);
}`;

// 4x4 depth-aware blur that also upsamples to full resolution.
const AO_BLUR_FS = /* glsl */`
${COMMON}
${GBUFFER_READ}
in vec2 vUv; out vec4 o;
uniform sampler2D uAOHalf;
float lin(vec2 uv) { vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, texture(uDepth, uv).r * 2.0 - 1.0, 1.0); return -p.z / p.w; }
void main() {
  float z = lin(vUv);
  vec2 t = 1.0 / vec2(textureSize(uAOHalf, 0));
  float sum = 0.0, wsum = 0.0;
  for (int y = -2; y <= 1; y++) for (int x = -2; x <= 1; x++) {
    vec2 uv = vUv + (vec2(x, y) + 0.5) * t;
    float zs = lin(uv);
    float w = 1.0 / (1e-3 + abs(z - zs) / max(z, 0.1) * 40.0);
    sum += texture(uAOHalf, uv).r * w; wsum += w;
  }
  o = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;

const SSR_FS = /* glsl */`
${COMMON}
${GBUFFER_READ}
${VIEW_HELPERS}
${MARCH}
in vec2 vUv; out vec4 o;
uniform sampler2D uPrevColor;
uniform float uFrame, uPrevLevels;
void main() {
  float d = texture(uDepth, vUv).r;
  vec4 g1 = texture(uG1, vUv);
  float rough = g1.z;
  if (d >= 1.0 || rough > 0.62) { o = vec4(0.0); return; }
  vec3 P = viewPos(vUv);
  vec3 N = viewNormal(vUv);
  vec3 V = normalize(P);
  // jitter the reflection direction a little by roughness (GGX-ish cone)
  vec2 xi = hash22(gl_FragCoord.xy + fract(uFrame * 0.618) * 117.0);
  vec3 R = reflect(V, N);
  vec3 T = normalize(cross(abs(R.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0), R)), B = cross(R, T);
  float spread = rough * rough * 0.6;
  R = normalize(R + (T * (xi.x - 0.5) + B * (xi.y - 0.5)) * spread);
  if (dot(R, N) < 0.0) R = reflect(R, N);
  float jitter = ign(gl_FragCoord.xy, uFrame);
  vec3 hit = marchRay(P + N * 0.02, R, 30.0, 32, jitter, 0.35);
  if (hit.z < 0.5) { o = vec4(0.0); return; }
  vec2 huv = hit.xy;
  vec2 motion = texture(uG2, huv).xy;
  vec2 puv = huv - motion;
  float hitDist = length(viewPos(huv) - P);
  float lod = clamp(log2(1.0 + rough * hitDist * 18.0), 0.0, uPrevLevels - 1.0);
  vec3 c = textureLod(uPrevColor, puv, lod).rgb;
  // confidence: fade at screen edges, toward the camera, and with roughness
  vec2 e = smoothstep(0.0, 0.1, huv) * smoothstep(0.0, 0.1, 1.0 - huv);
  float conf = e.x * e.y * saturate(1.0 - R.z * 1.5) * (1.0 - smoothstep(0.35, 0.62, rough));
  if (any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) conf = 0.0;
  o = vec4(c, conf);
}`;

const SSGI_FS = /* glsl */`
${COMMON}
${GBUFFER_READ}
${VIEW_HELPERS}
${MARCH}
in vec2 vUv; out vec4 o;
uniform sampler2D uPrevColor;
uniform float uFrame, uRadius;
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) { o = vec4(0.0); return; }
  vec3 P = viewPos(vUv);
  vec3 N = viewNormal(vUv);
  vec3 T = normalize(cross(abs(N.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0), N)), B = cross(N, T);
  vec3 sum = vec3(0.0);
  float hits = 0.0;
  const int RAYS = 2;
  for (int i = 0; i < RAYS; i++) {
    vec2 xi = hash22(gl_FragCoord.xy * 1.37 + vec2(float(i) * 19.1, fract(uFrame * 0.618034) * 173.0));
    // cosine-weighted hemisphere direction
    float r = sqrt(xi.x), phi = TAU * xi.y;
    vec3 dir = normalize(T * (r * cos(phi)) + B * (r * sin(phi)) + N * sqrt(1.0 - xi.x));
    vec3 hit = marchRay(P + N * 0.03, dir, uRadius, 14, ign(gl_FragCoord.xy + float(i) * 7.0, uFrame), 0.5);
    if (hit.z > 0.5) {
      vec2 puv = hit.xy - texture(uG2, hit.xy).xy;
      // only light leaving the side of the hit surface that faces us counts
      vec3 hn = viewNormal(hit.xy);
      float facing = step(0.0, -dot(hn, dir));
      sum += textureLod(uPrevColor, puv, 2.0).rgb * facing;
      hits += 1.0;
    }
  }
  o = vec4(sum / float(RAYS), hits / float(RAYS));
}`;

const GI_TEMPORAL_FS = /* glsl */`
${COMMON}
${GBUFFER_READ}
in vec2 vUv; out vec4 o;
uniform sampler2D uCur, uHist, uHistDepth;
uniform float uReset;
void main() {
  vec4 c = texture(uCur, vUv);
  vec2 puv = vUv - texture(uG2, vUv).xy;
  if (uReset > 0.5 || any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) { o = c; return; }
  vec4 h = texture(uHist, puv);
  // disocclusion: depth moved too much
  float d = texture(uDepth, vUv).r, pd = texture(uHistDepth, puv).r;
  float valid = abs(d - pd) < 0.002 + 0.02 * (1.0 - d) ? 1.0 : 0.0;
  o = mix(c, h, 0.9 * valid);
}`;

// Edge-avoiding à-trous wavelet filter (Dammertz et al. 2010).
const ATROUS_FS = /* glsl */`
${COMMON}
${GBUFFER_READ}
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc;
uniform float uStep;
float lin(vec2 uv) { vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, texture(uDepth, uv).r * 2.0 - 1.0, 1.0); return -p.z / p.w; }
void main() {
  vec2 t = 1.0 / vec2(textureSize(uSrc, 0));
  vec3 n0 = decodeNormal(texture(uG1, vUv).xy);
  float z0 = lin(vUv);
  vec4 sum = vec4(0.0); float wsum = 0.0;
  const float K[3] = float[](0.375, 0.25, 0.0625);
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 uv = vUv + vec2(x, y) * t * uStep;
    vec3 n = decodeNormal(texture(uG1, uv).xy);
    float z = lin(uv);
    float w = K[abs(x)] * K[abs(y)] * pow(saturate(dot(n, n0)), 16.0) * exp(-abs(z - z0) / max(z0 * 0.03, 0.02));
    sum += texture(uSrc, uv) * w; wsum += w;
  }
  o = sum / max(wsum, 1e-5);
}`;

const COPY_FS = `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = vec4(texture(uC, vUv).rgb, 1.0); }`;

export class ScreenSpace {
  constructor() { this.name = 'screenspace'; this.aoRadius = 0.7; this.giRadius = 4.0; this.reset = true; }
  init(r) {
    const gl = r.gl;
    this.pAO = postProgram(gl, AO_FS, {}, 'gtao');
    this.pAOBlur = postProgram(gl, AO_BLUR_FS, {}, 'gtao-blur');
    this.pSSR = postProgram(gl, SSR_FS, {}, 'ssr');
    this.pGI = postProgram(gl, SSGI_FS, {}, 'ssgi');
    this.pGIT = postProgram(gl, GI_TEMPORAL_FS, {}, 'ssgi-temporal');
    this.pAtrous = postProgram(gl, ATROUS_FS, {}, 'atrous');
    this.pCopy = postProgram(gl, COPY_FS, {}, 'copy');
  }
  resize(r) {
    const gl = r.gl;
    const w = r.width, h = r.height, hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const mk = (W, H, fmt = 'rgba16f', filter = 'linear') => new Target(gl, { width: W, height: H, colors: [{ format: fmt, filter }] });
    if (!this.ao) {
      this.aoHalf = mk(hw, hh, 'r16f'); this.ao = mk(w, h, 'r16f');
      this.ssr = mk(w, h);
      this.gi = mk(hw, hh); this.giA = mk(hw, hh); this.giB = mk(hw, hh); this.giTmp = mk(hw, hh);
      this.giDepthA = mk(hw, hh, 'r32f', 'nearest'); this.giDepthB = mk(hw, hh, 'r32f', 'nearest');
      this.prev = mk(w, h, 'rgba16f', 'mip');
    } else {
      this.aoHalf.resize(hw, hh); this.ao.resize(w, h); this.ssr.resize(w, h);
      for (const t of [this.gi, this.giA, this.giB, this.giTmp, this.giDepthA, this.giDepthB]) t.resize(hw, hh);
      this.prev.colors[0].alloc(w, h); this.prev.width = w; this.prev.height = h; this.prev.attach();
    }
    this.reset = true;
  }
  beforeLighting(r) {
    const gl = r.gl;
    state(gl);
    const q = r.q;
    r.aoTexture = null; r.ssrTexture = null; r.ssgiTexture = null;
    if (q.ssao) {
      this.aoHalf.bind();
      r.bindGBuffer(this.pAO.use()).set('uFrame', r.frame).set('uRadius', this.aoRadius);
      fullscreen(gl);
      this.ao.bind();
      r.bindGBuffer(this.pAOBlur.use()).set('uAOHalf', this.aoHalf.tex);
      fullscreen(gl);
      r.aoTexture = this.ao.tex;
    }
    if (this.reset) return;   // the screen-space light needs a previous frame
    if (q.ssr) {
      this.ssr.bind();
      r.bindGBuffer(this.pSSR.use()).set('uPrevColor', this.prev.tex).set('uPrevLevels', this.prev.tex.levels).set('uFrame', r.frame);
      fullscreen(gl);
      r.ssrTexture = this.ssr.tex;
    }
    if (q.ssgi) {
      this.gi.bind();
      r.bindGBuffer(this.pGI.use()).set('uPrevColor', this.prev.tex).set('uFrame', r.frame).set('uRadius', this.giRadius);
      fullscreen(gl);
      // temporal accumulation, then two à-trous iterations
      this.giA.bind();
      r.bindGBuffer(this.pGIT.use()).set('uCur', this.gi.tex).set('uHist', this.giB.tex).set('uHistDepth', this.giDepthB.tex).set('uReset', 0);
      fullscreen(gl);
      // remember depth for next frame's disocclusion test
      this.giDepthA.bind();
      this.pCopy.use().set('uC', r.depthHalf ?? r.depth);
      fullscreen(gl);
      this.giTmp.bind();
      r.bindGBuffer(this.pAtrous.use()).set('uSrc', this.giA.tex).set('uStep', 1);
      fullscreen(gl);
      this.gi.bind();
      r.bindGBuffer(this.pAtrous.use()).set('uSrc', this.giTmp.tex).set('uStep', 2);
      fullscreen(gl);
      let t = this.giA; this.giA = this.giB; this.giB = t;
      t = this.giDepthA; this.giDepthA = this.giDepthB; this.giDepthB = t;
      r.ssgiTexture = this.gi.tex;
    }
  }
  /** Keeps this frame's lit image (before post) for next frame's reflections and bounce light. */
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    this.prev.bind();
    this.pCopy.use().set('uC', color);
    fullscreen(gl);
    this.prev.tex.generateMips();
    this.reset = false;
    return color;
  }
}
