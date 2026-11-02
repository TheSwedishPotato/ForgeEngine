import { Texture, Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON, SKY } from '../shaders/common.js';
import { GBUFFER_READ } from '../shaders/lighting.js';
import { STATIC_GLSL } from '../scene/StaticScene.js';
import { BVHTextures, BVH_GLSL } from '../scene/BVH.js';
import BVHWorker from '../scene/bvh.worker.js?worker&inline';

/**
 * Ray tracing in fragment shaders, on WebGL2.
 *
 * Shadows: every visible pixel near the camera sends one ray toward a
 * random point of the sun's disc through the BVH of the static world (and
 * past the capsules of everyone's bodies). Hits and misses are
 * accumulated over frames along the motion vectors (rejected where the
 * depth disagrees), which turns one ray a frame into soft, exact
 * penumbras: a roof edge is sharp where it meets the wall and soft a few
 * metres away, as real sunlight is. The town is then left out of the near
 * shadow cascades; the far ones keep it.
 *
 * Path-traced reference (`renderer.pathTrace = true`, F7): every pixel is
 * traced from the camera, three bounces, direct sun by shadow rays and the
 * sky where rays escape, materials and maps from the baked scene, people
 * as grey capsules and the ground as a plane. Accumulated while the camera
 * stays still: the ground truth the real-time lighting can be compared to.
 */

const RT_SHADOW_FS = /* glsl */`
${COMMON}
${GBUFFER_READ}
${BVH_GLSL}
in vec2 vUv; out vec4 o;
uniform highp sampler2D uHist, uHistDepth;
uniform vec3 uSunDir;
uniform float uFrame, uMaxDist, uSunCone, uReset;
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) { o = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec3 P = worldFromDepth(vUv, d);
  float viewDepth = -(uView * vec4(P, 1.0)).z;
  if (viewDepth > uMaxDist) { o = vec4(1.0, d, 0.0, 1.0); return; }
  vec3 N = decodeNormal(texture(uG1, vUv).xy);
  float vis = 0.0;
  if (dot(N, uSunDir) > 0.0) {
    // a random point on the sun's disc
    vec2 xi = hash22(gl_FragCoord.xy + fract(uFrame * 0.618034) * 251.0);
    vec3 T = normalize(cross(abs(uSunDir.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0), uSunDir)), B = cross(uSunDir, T);
    float r = sqrt(xi.x) * uSunCone, a = xi.y * TAU;
    vec3 L = normalize(uSunDir + T * cos(a) * r + B * sin(a) * r);
    vec3 orig = P + N * (0.02 + viewDepth * 0.0015) + L * 0.01;
    int tri; vec2 uv; vec3 cn;
    bool hit = bvhTrace(orig, L, 200.0, true, tri, uv) > 0.0 || capsTrace(orig, L, 40.0, cn) > 0.0;
    vis = hit ? 0.0 : 1.0;
  }
  // accumulate along the motion vectors
  vec2 puv = vUv - texture(uG2, vUv).xy;
  float n = 1.0;
  float h = vis;
  if (uReset < 0.5 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)))) {
    vec4 H = texture(uHist, puv);
    if (abs(H.y - d) < 0.002 + 0.03 * (1.0 - d)) { n = min(H.z + 1.0, 16.0); h = mix(H.x, vis, 1.0 / n); }
  }
  o = vec4(h, d, n, 1.0);
}`;

const PATH_FS = /* glsl */`
${COMMON}
${SKY}
${STATIC_GLSL}
${BVH_GLSL}
in vec2 vUv; out vec4 o;
uniform highp sampler2D uAccum;
uniform mat4 uInvViewProjFlat;
uniform vec3 uCamPos, uSunIrr;
uniform vec2 uRes;
uniform float uFrame, uCount, uSunCone;
float rnd(inout uint s) { s = s * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return float((w >> 22u) ^ w) / 4294967295.0; }
vec3 cosineDir(vec3 n, inout uint s) {
  float u = rnd(s), v = rnd(s), r = sqrt(u), a = TAU * v;
  vec3 t = normalize(cross(abs(n.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0), n)), b = cross(n, t);
  return normalize(t * r * cos(a) + b * r * sin(a) + n * sqrt(1.0 - u));
}
// nearest surface: the static world, the people, the ground plane
bool scene(vec3 ro, vec3 rd, out vec3 p, out vec3 n, out vec3 albedo) {
  int tri; vec2 bc; vec3 cn;
  float t = bvhTrace(ro, rd, 2000.0, false, tri, bc);
  float tc = capsTrace(ro, rd, t > 0.0 ? t : 2000.0, cn);
  float tg = rd.y < -1e-4 ? -ro.y / rd.y : -1.0;
  float best = 1e9; int which = -1;
  if (t > 0.0) { best = t; which = 0; }
  if (tc > 0.0 && tc < best) { best = tc; which = 1; }
  if (tg > 0.0 && tg < best) { best = tg; which = 2; }
  if (which < 0) return false;
  p = ro + rd * best;
  if (which == 0) {
    vec4 a0 = sPos(tri * 3), a1 = sPos(tri * 3 + 1), a2 = sPos(tri * 3 + 2);
    vec4 n0 = sNrm(tri * 3), n1 = sNrm(tri * 3 + 1), n2 = sNrm(tri * 3 + 2);
    float w = 1.0 - bc.x - bc.y;
    n = normalize(n0.xyz * w + n1.xyz * bc.x + n2.xyz * bc.y);
    vec3 ng = normalize(cross(a1.xyz - a0.xyz, a2.xyz - a0.xyz));
    if (dot(ng, rd) > 0.0) ng = -ng;
    if (dot(n, ng) < 0.0) n = -n;
    vec2 uv = vec2(a0.w, n0.w) * w + vec2(a1.w, n1.w) * bc.x + vec2(a2.w, n2.w) * bc.y;
    vec4 ma, mb; sMaterial(sMatOfTri(tri), ma, mb);
    albedo = ma.rgb;
    if (ma.w >= 0.0) albedo *= textureLod(uSMaps, vec3(uv, ma.w), 1.5).rgb;
  } else if (which == 1) { n = cn; albedo = vec3(0.45, 0.4, 0.36); }
  else { n = vec3(0.0, 1.0, 0.0); albedo = vec3(0.21, 0.24, 0.13); }
  return true;
}
bool shadowed(vec3 ro, vec3 rd) {
  int tri; vec2 bc; vec3 cn;
  return bvhTrace(ro, rd, 400.0, true, tri, bc) > 0.0 || capsTrace(ro, rd, 60.0, cn) > 0.0;
}
void main() {
  uint s = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(uFrame) * 26699u;
  rnd(s);
  vec2 px = gl_FragCoord.xy + vec2(rnd(s), rnd(s)) - 0.5;
  vec2 ndc = px / uRes * 2.0 - 1.0;
  vec4 a = uInvViewProjFlat * vec4(ndc, -1.0, 1.0), b = uInvViewProjFlat * vec4(ndc, 1.0, 1.0);
  vec3 ro = uCamPos, rd = normalize(b.xyz / b.w - a.xyz / a.w);
  vec3 L = vec3(0.0), thr = vec3(1.0);
  for (int bounce = 0; bounce < 4; bounce++) {
    vec3 p, n, alb;
    if (!scene(ro, rd, p, n, alb)) { L += thr * skyRadiance(rd, bounce == 0); break; }
    // the sun, by a shadow ray to a point on its disc
    vec3 T = normalize(cross(abs(uSunDir.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0), uSunDir)), B = cross(uSunDir, T);
    float r = sqrt(rnd(s)) * uSunCone, an = rnd(s) * TAU;
    vec3 Ls = normalize(uSunDir + T * cos(an) * r + B * sin(an) * r);
    float nl = dot(n, Ls);
    if (nl > 0.0 && !shadowed(p + n * 0.01, Ls)) L += thr * alb * INV_PI * uSunIrr * nl;
    // bounce
    thr *= alb;
    if (bounce >= 1) { float q = max(max(thr.r, thr.g), thr.b); if (rnd(s) > q) break; thr /= max(q, 1e-3); }
    ro = p + n * 0.01; rd = cosineDir(n, s);
  }
  L = min(L, vec3(60.0));      // tame fireflies
  vec3 prev = uCount > 0.5 ? texture(uAccum, vUv).rgb : vec3(0.0);
  o = vec4((prev * uCount + L) / (uCount + 1.0), 1.0);
}`;

const COPY_FS = `in vec2 vUv; out vec4 o; uniform highp sampler2D uSrc; void main() { o = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

export class RayTracing {
  constructor() { this.name = 'raytracing'; this.shadows = true; this.maxDist = 45; this.count = 0; }

  init(r) {
    this.r = r;
    this.pShadow = postProgram(r.gl, RT_SHADOW_FS, {}, 'rt-shadow');
    this.pPath = postProgram(r.gl, PATH_FS, {}, 'path-trace');
    this.pCopy = postProgram(r.gl, COPY_FS, {}, 'pt-copy');
    this.caps = new Texture(r.gl, { width: 512, height: 1, format: 'rgba32f', filter: 'nearest' });
    this.capData = new Float32Array(512 * 4);
    this.capCount = 0;
    r.rayTracing = this;
  }

  /** Build the BVH of the baked static world (once, in a worker; ray tracing starts when it arrives). */
  setScene(staticScene) {
    this.scene = staticScene;
    const w = new BVHWorker();
    w.onmessage = (e) => {
      this.bvh = new BVHTextures(this.r.gl, staticScene.positions, e.data);
      this.reset = true;
      w.terminate();
      console.info(`[Med Engine] BVH: ${this.bvh.triCount} triangles, ${this.bvh.nodeCount} nodes, built in ${this.bvh.buildMs.toFixed(0)} ms (worker)`);
    };
    w.postMessage({ positions: staticScene.positions.slice(), triCount: staticScene.triCount });
  }

  /** Everyone's bodies as capsules: [{a:Vector3, b:Vector3, r}] (call each frame). */
  setCapsules(list) {
    const n = Math.min(256, list.length);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      this.capData.set([c.a.x, c.a.y, c.a.z, c.r, c.b.x, c.b.y, c.b.z, 0], i * 8);
    }
    this.capCount = n;
    this.capsDirty = true;
  }

  resize(r) {
    const hw = Math.max(1, r.width >> 1), hh = Math.max(1, r.height >> 1);
    const mk = (w, h) => new Target(r.gl, { width: w, height: h, colors: [{ format: 'rgba16f', filter: 'linear' }] });
    this.hA?.dispose?.(); this.hB?.dispose?.();
    this.hA = mk(hw, hh); this.hB = mk(hw, hh);
    this.pA?.dispose?.(); this.pB?.dispose?.();
    const mk32 = () => new Target(r.gl, { width: r.width, height: r.height, colors: [{ format: 'rgba32f', filter: 'nearest' }] });
    this.pA = mk32(); this.pB = mk32();
    this.reset = true; this.count = 0;
  }

  active(r) { return !!(this.bvh && this.shadows && r.q.rtShadows !== false); }

  _uploadCaps() {
    if (!this.capsDirty) return;
    this.caps.upload(this.capData);
    this.capsDirty = false;
  }

  beforeLighting(r) {
    r.rtShadowTexture = null;
    r.rtShadowsActive = this.active(r);
    if (!r.rtShadowsActive || r.pathTrace) return;
    const gl = r.gl;
    this._uploadCaps();
    this.hA.bind();
    state(gl);
    const p = this.pShadow.use();
    r.bindGBuffer(p);
    this.bvh.bind(p).set('uCaps', this.caps).set('uCapCount', this.capCount).set('uHist', this.hB.tex)
      .set('uSunDir', r.sunDir).set('uFrame', r.frame).set('uMaxDist', this.maxDist).set('uSunCone', 0.012).set('uReset', this.reset || r.cameraCut ? 1 : 0);
    fullscreen(gl);
    const t = this.hA; this.hA = this.hB; this.hB = t;
    this.reset = false;
    r.rtShadowTexture = this.hB.tex;
    r.rtShadowDist = this.maxDist;
  }

  /** The path tracer replaces the lit image while it is on. */
  afterLighting(r, color) {
    if (!r.pathTrace || !this.bvh) { this.count = 0; return color; }
    const gl = r.gl;
    this._uploadCaps();
    const key = r.viewProj.elements.map((v) => v.toFixed(4)).join();
    if (key !== this._key || this.capsDirtyPT) { this.count = 0; this._key = key; }
    this.pA.bind();
    state(gl);
    const p = this.pPath.use();
    this.scene.bind(p);
    this.bvh.bind(p).set('uCaps', this.caps).set('uCapCount', this.capCount).set('uAccum', this.pB.tex)
      .set('uInvViewProjFlat', this._inv ??= r.viewProj.clone()).setAll(r.skyUniforms())
      .set('uCamPos', r.cameraPos).set('uRes', [r.width, r.height]).set('uFrame', r.frame).set('uCount', this.count).set('uSunCone', 0.0047)
      .set('uSunIrr', [r.sunColor.x * r.sunIntensity, r.sunColor.y * r.sunIntensity, r.sunColor.z * r.sunIntensity]);
    this._inv.copy(r.viewProj).invert();
    p.set('uInvViewProjFlat', this._inv);
    fullscreen(gl);
    const t = this.pA; this.pA = this.pB; this.pB = t;
    this.count++;
    // into the lit image, so the rest of the chain (exposure, tonemapping) applies
    r.hdr.bind();
    state(gl);
    this.pCopy.use().set('uSrc', this.pB.tex);
    fullscreen(gl);
    return color;
  }
}
