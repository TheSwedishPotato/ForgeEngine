import { Vector3 } from 'three';
import { Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';
import { SHADOW_GLSL } from './Shadows.js';

const MAX_SMOKE = 16;

/**
 * Participating media: height fog, a ground mist that drifts with the wind,
 * and smoke volumes (dust kicked up, fires). Each pixel raymarches its view
 * ray through the medium at half resolution, sampling the sun's shadow
 * cascades at every step, so light shafts ("god rays") form wherever
 * something blocks the sun — a banner, a tree, a knight walking through the
 * dust. Integration follows Hillaire (2015); a temporal filter removes the
 * noise of the jittered steps. Beyond the march distance an analytic
 * height-fog integral gives aerial perspective to the hills and castle.
 */
const MARCH_FS = /* glsl */`
${COMMON}
${SHADOW_GLSL}
in vec2 vUv; out vec4 o;
uniform sampler2D uDepth;
uniform mat4 uInvViewProj, uView;
uniform vec3 uCameraPos, uSunDir, uSunIrradiance, uAmbient, uAmbientUp;
uniform float uFrame, uTime, uMaxDist;
uniform float uFogDensity, uFogHeight, uFogFalloff, uMistDensity, uMistHeight, uAnisotropy;
uniform vec2 uWind;
uniform int uSteps;
uniform int uSmokeCount;
uniform vec4 uSmoke[${MAX_SMOKE}];      // xyz centre, radius
uniform vec4 uSmokeColor[${MAX_SMOKE}]; // rgb albedo, density
uniform int uPointCount;
uniform vec4 uPointPos[8];
uniform vec4 uPointColor[8];

float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

// Density and the albedo-weighted part of it at p.
vec2 medium(vec3 p, out vec3 albedo) {
  float fog = uFogDensity * exp(-max(p.y - uFogHeight, 0.0) * uFogFalloff);
  // ground mist: thick in the low fields, thinner on the trampled lists
  vec3 q = p * 0.11 + vec3(uWind.x, 0.0, uWind.y) * uTime * 0.02;
  float n = vnoise3(q) * 0.65 + vnoise3(q * 2.7 + 11.0) * 0.35;
  float mist = uMistDensity * smoothstep(0.35, 0.8, n) * exp(-max(p.y, 0.0) / uMistHeight) * smoothstep(5.0, 18.0, length(p.xz));
  float d = fog + mist;
  albedo = vec3(0.9) * d;
  for (int i = 0; i < ${MAX_SMOKE}; i++) {
    if (i >= uSmokeCount) break;
    vec3 c = uSmoke[i].xyz; float r = uSmoke[i].w;
    vec3 dp = p - c;
    float x = dot(dp, dp) / (r * r);
    if (x >= 1.0) continue;
    float puff = uSmokeColor[i].a * pow2(1.0 - x) * (0.55 + 0.45 * vnoise3(p * 3.0 + uTime * 0.3));
    d += puff;
    albedo += uSmokeColor[i].rgb * puff;
  }
  albedo /= max(d, 1e-6);
  return vec2(d, 0.0);
}

void main() {
  float depth = texture(uDepth, vUv).r;
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 end = wp.xyz / wp.w;
  vec3 dir = end - uCameraPos;
  float sceneDist = depth >= 1.0 ? 1e4 : length(dir);
  dir /= max(length(dir), 1e-5);
  float dist = min(sceneDist, uMaxDist);
  float jitter = ign(gl_FragCoord.xy, uFrame);
  float cosT = dot(dir, uSunDir);
  float phase = mix(hg(cosT, uAnisotropy), hg(cosT, -0.25), 0.25);
  vec3 scat = vec3(0.0);
  float T = 1.0;
  int N = uSteps;
  // Steps grow with distance: detail near the camera, reach far away.
  for (int i = 0; i < 64; i++) {
    if (i >= N) break;
    float t0 = dist * pow((float(i) + jitter) / float(N), 1.6);
    float t1 = dist * pow((float(i) + 1.0 + jitter) / float(N), 1.6);
    float dt = t1 - t0;
    vec3 p = uCameraPos + dir * (t0 + dt * 0.5);
    vec3 alb;
    float sigma = medium(p, alb).x;
    if (sigma < 1e-6) continue;
    float viewDepth = -(uView * vec4(p, 1.0)).z;
    float vis = sunShadowFast(p, viewDepth);
    vec3 S = alb * sigma * (uSunIrradiance * vis * phase + uAmbient * (0.75 + 0.25 * saturate(p.y * 0.1)) / (4.0 * PI));
    for (int k = 0; k < 8; k++) {
      if (k >= uPointCount) break;
      vec3 d = uPointPos[k].xyz - p;
      float r2 = dot(d, d);
      S += alb * sigma * uPointColor[k].rgb / (4.0 * PI * (r2 + 0.3)) * saturate(1.0 - r2 / (uPointPos[k].w * uPointPos[k].w));
    }
    float tr = exp(-sigma * dt);
    scat += T * (S - S * tr) / sigma;
    T *= tr;
    if (T < 0.01) break;
  }
  // Aerial perspective beyond the march: analytic exponential height fog.
  if (sceneDist > dist) {
    float L = min(sceneDist, 2500.0) - dist;
    vec3 p0 = uCameraPos + dir * dist;
    float h0 = max(p0.y - uFogHeight, 0.0);
    float b = uFogFalloff;
    float dy = dir.y;
    float od = uFogDensity * exp(-h0 * b) * (abs(dy * b) > 1e-4 ? (1.0 - exp(-b * dy * L)) / (b * dy) : L);
    od = max(od, 0.0);
    float tr = exp(-od);
    vec3 S = 0.9 * (uSunIrradiance * phase + uAmbient / (4.0 * PI));
    scat += T * S * (1.0 - tr);
    T *= tr;
  }
  o = vec4(scat, T);
}`;

const TEMPORAL_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uCur, uHist, uDepth;
uniform mat4 uInvViewProj, uPrevViewProj;
uniform float uReset;
void main() {
  vec4 c = texture(uCur, vUv);
  float d = texture(uDepth, vUv).r;
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, min(d, 0.9999) * 2.0 - 1.0, 1.0);
  vec4 pp = uPrevViewProj * vec4(wp.xyz / wp.w, 1.0);
  vec2 puv = pp.xy / pp.w * 0.5 + 0.5;
  if (uReset > 0.5 || any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) { o = c; return; }
  // neighbourhood clamp keeps moving shafts from ghosting
  vec2 t = 1.0 / vec2(textureSize(uCur, 0));
  vec4 mn = c, mx = c;
  for (int i = 0; i < 4; i++) {
    vec4 s = texture(uCur, vUv + t * vec2(i == 0 ? 1.0 : i == 1 ? -1.0 : 0.0, i == 2 ? 1.0 : i == 3 ? -1.0 : 0.0));
    mn = min(mn, s); mx = max(mx, s);
  }
  vec4 h = clamp(texture(uHist, puv), mn - (mx - mn) * 0.5, mx + (mx - mn) * 0.5);
  o = mix(h, c, 0.12);
}`;

// Depth-aware upsample of the half-res result and composite: L = L*T + S.
const APPLY_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uVol, uDepth, uVolDepth;
uniform mat4 uInvProj;
float lin(float d) { vec4 p = uInvProj * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0); return -p.z / p.w; }
void main() {
  vec3 c = texture(uColor, vUv).rgb;
  float z = lin(texture(uDepth, vUv).r);
  vec2 ts = vec2(textureSize(uVol, 0));
  vec2 p = vUv * ts - 0.5;
  vec2 b = floor(p), f = p - b;
  vec4 sum = vec4(0.0); float wsum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o2 = vec2(i & 1, i >> 1);
    vec2 uv = (b + o2 + 0.5) / ts;
    float zs = lin(texture(uVolDepth, uv).r);
    float w = (o2.x > 0.5 ? f.x : 1.0 - f.x) * (o2.y > 0.5 ? f.y : 1.0 - f.y);
    w *= 1.0 / (1e-3 + abs(z - zs) / max(z, 0.1));
    sum += texture(uVol, uv) * w; wsum += w;
  }
  vec4 v = sum / max(wsum, 1e-6);
  o = vec4(c * v.a + v.rgb, 1.0);
}`;

export class Volumetrics {
  constructor() {
    this.name = 'volumetrics';
    this.enabled = true;
    this.fog = { density: 0.0016, height: 0.0, falloff: 0.045, mist: 0.012, mistHeight: 1.4, anisotropy: 0.62, maxDist: 90, wind: [1, 0.35], ambient: 1.0 };
    this.smoke = [];      // { pos: Vector3, radius, density, color: [r,g,b] }
    this.reset = true;
  }
  init(r) {
    this.pMarch = postProgram(r.gl, MARCH_FS, {}, 'vol-march');
    this.pTemporal = postProgram(r.gl, TEMPORAL_FS, {}, 'vol-temporal');
    this.pApply = postProgram(r.gl, APPLY_FS, {}, 'vol-apply');
  }
  resize(r) {
    const w = Math.max(1, r.width >> 1), h = Math.max(1, r.height >> 1);
    if (!this.march) {
      this.march = new Target(r.gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] });
      this.a = new Target(r.gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] });
      this.b = new Target(r.gl, { width: w, height: h, colors: [{ format: 'rgba16f' }] });
      this.depthHalf = new Target(r.gl, { width: w, height: h, colors: [{ format: 'r32f', filter: 'nearest' }] });
      this.out = new Target(r.gl, { width: r.width, height: r.height, colors: [{ format: 'rgba16f' }] });
      this.copyDepth = postProgram(r.gl, `in vec2 vUv; out vec4 o; uniform sampler2D uD; void main(){ ivec2 p = ivec2(gl_FragCoord.xy) * 2; float d = max(max(texelFetch(uD, p, 0).r, texelFetch(uD, p + ivec2(1,0), 0).r), max(texelFetch(uD, p + ivec2(0,1), 0).r, texelFetch(uD, p + ivec2(1,1), 0).r)); o = vec4(d); }`, {}, 'depth-half');
    } else { for (const t of [this.march, this.a, this.b, this.depthHalf]) t.resize(w, h); this.out.resize(r.width, r.height); }
    this.reset = true;
  }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    // half-res depth (farthest of 4: fog in front of thin objects stays put)
    this.depthHalf.bind();
    this.copyDepth.use().set('uD', r.depth);
    fullscreen(gl);
    r.depthHalf = this.depthHalf.tex;
    this.march.bind();
    const F = this.fog;
    const smoke = this.smoke.slice(0, MAX_SMOKE);
    const sp = new Float32Array(MAX_SMOKE * 4), sc = new Float32Array(MAX_SMOKE * 4);
    smoke.forEach((s, i) => { sp.set([s.pos.x, s.pos.y, s.pos.z, s.radius], i * 4); sc.set([...(s.color ?? [0.75, 0.68, 0.55]), s.density], i * 4); });
    const sh = r.shadows;
    const sunI = [r.sunColor.x * r.sunIntensity, r.sunColor.y * r.sunIntensity, r.sunColor.z * r.sunIntensity];
    const amb = r.env.sh;   // L00 term ~ average sky radiance * sqrt(4pi)
    const k = 3.5449 * F.ambient;
    const ambient = [amb[0] * k, amb[1] * k, amb[2] * k];
    const M = this.pMarch.use();
    M.set('uDepth', r.depth).set('uInvViewProj', r.invViewProj).set('uView', r.view).set('uCameraPos', r.cameraPos).set('uSunDir', r.sunDir)
      .set('uSunIrradiance', sunI).set('uAmbient', ambient).set('uFrame', r.frame).set('uTime', r.time).set('uMaxDist', F.maxDist)
      .set('uFogDensity', F.density).set('uFogHeight', F.height).set('uFogFalloff', F.falloff).set('uMistDensity', F.mist).set('uMistHeight', F.mistHeight)
      .set('uAnisotropy', F.anisotropy).set('uWind', F.wind).set('uSteps', r.q.volumetrics === 'high' ? 40 : 20)
      .set('uSmokeCount', smoke.length).set('uSmoke', sp).set('uSmokeColor', sc)
      .set('uShadowMap', sh.map).set('uShadowMatrix', sh.matrices).set('uShadowSplits', sh.splits.map((s, i) => (i < sh.n ? s : 0))).set('uShadowTexel', sh.texel).set('uShadowSize', sh.size);
    r.setPointLights(M, r.lists.points);
    fullscreen(gl);
    this.a.bind();
    this.pTemporal.use().set('uCur', this.march.tex).set('uHist', this.b.tex).set('uDepth', this.depthHalf.tex).set('uInvViewProj', r.invViewProj)
      .set('uPrevViewProj', r.prevViewProj).set('uReset', this.reset ? 1 : 0);
    fullscreen(gl);
    this.reset = false;
    const t = this.a; this.a = this.b; this.b = t;
    this.out.bind();
    this.pApply.use().set('uColor', color).set('uVol', this.b.tex).set('uDepth', r.depth).set('uVolDepth', this.depthHalf.tex).set('uInvProj', r.invProj);
    fullscreen(gl);
    return this.out.tex;
  }
}
void Vector3;
