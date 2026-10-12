/**
 * The game's stage on the Med Engine (Zweikampf 1403's renderer, imported read-only): the
 * deferred PBR renderer with its shadow cascades, screen-space AO/GI/reflections, temporal
 * upscaling, motion blur, auto exposure and bloom; and what a 30 km alpine valley needs on
 * top of a 1 km medieval town, added through the engine's own hooks without changing it:
 *
 *  - the sky of 11 December 2026 (sky.js) in place of the engine's autumn afternoon,
 *  - mountain shadows and the sky view of the gorge (terrainLight.js) in the lighting,
 *  - aerial perspective, valley fog and falling snow (atmosphere.js),
 *  - darkness underground: anything well below the ground (a tunnel) gets no daylight,
 *  - a floating origin: the world is drawn relative to a point near the camera, so a coach
 *    interior 10 km from the map's origin does not shimmer in 32-bit floats,
 *  - a neutral winter grade instead of the engine's warm one.
 *
 * World axes as in the engine: X east, Y up, Z south. Map coordinates: x east, y north, z up.
 */
import { Scene, PerspectiveCamera, Vector3 } from 'three';
import { Renderer } from '../../../duel1403/src/engine/Renderer.js';
import { ScreenSpace } from '../../../duel1403/src/engine/passes/ScreenSpace.js';
import { GaussianSplats } from '../../../duel1403/src/engine/passes/GaussianSplats.js';
import { DOF, MotionBlur } from '../../../duel1403/src/engine/passes/Cinematic.js';
import { TAA, Upscale } from '../../../duel1403/src/engine/passes/TAA.js';
import { Exposure, Bloom } from '../../../duel1403/src/engine/passes/Post.js';
import { DebugDraw } from '../../../duel1403/src/engine/passes/DebugDraw.js';
import { Debug } from '../../../duel1403/src/engine/passes/Debug.js';
import { LIGHTING_FS } from '../../../duel1403/src/engine/shaders/lighting.js';
import { COMMON, SKY } from '../../../duel1403/src/engine/shaders/common.js';
import { CUBE_DIR } from '../../../duel1403/src/engine/passes/Environment.js';
import { Target, Texture, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { SKY_GLSL, SkyLUT, skyParams, sunTransmittance, SUN_E0 } from './sky.js';
import { TERRAIN_LIGHT_GLSL, TerrainLight } from './terrainLight.js';
import { Atmosphere } from './atmosphere.js';
import { TerrainGL } from './terrainGL.js';
import { sunPosition, sunVector, utcMs } from './sun.js';
import { FINE_N, FINE_STEP, FINE_TILE } from '../world/terrain.js';

const LAT = 46.745, LON = 8.62;

// ---------------------------------------------------------------------------------------------
// the lighting pass, with the valley's light

const GROUND_GLSL = /* glsl */`
uniform highp sampler2D uFineAtlas, uFineIndex;
uniform ivec2 uFineIndexSize;
uniform vec4 uFineRect;            // map x0, y0, tile size, sample step
uniform int uFineCols, uFineN;     // atlas columns, samples per tile side (with border)
uniform vec2 uFogSun;              // valley fog: extinction (1/m), top (m)
/** The ground's height under a map point: the 5 m tiles along the line, else the 25 m map. */
float groundAt(vec2 m) {
  vec2 tf = (m - uFineRect.xy) / uFineRect.z;
  ivec2 ti = ivec2(floor(tf));
  if (all(greaterThanEqual(ti, ivec2(0))) && all(lessThan(ti, uFineIndexSize))) {
    float slot = texelFetch(uFineIndex, ti, 0).r;
    if (slot > 0.5) {
      int k = int(slot + 0.5) - 1;
      ivec2 base = ivec2(k % uFineCols, k / uFineCols) * uFineN;
      vec2 f = (m - (uFineRect.xy + vec2(ti) * uFineRect.z)) / uFineRect.w + 1.0;
      ivec2 i = clamp(ivec2(floor(f)), ivec2(0), ivec2(uFineN - 2));
      vec2 w = f - vec2(i);
      float a = texelFetch(uFineAtlas, base + i, 0).r, b = texelFetch(uFineAtlas, base + i + ivec2(1, 0), 0).r;
      float c = texelFetch(uFineAtlas, base + i + ivec2(0, 1), 0).r, d = texelFetch(uFineAtlas, base + i + 1, 0).r;
      return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
    }
  }
  return terrainLightAt(m).z;
}
/** Daylight reaching a point: none a few metres under the ground (inside a tunnel). */
float daylightAt(vec3 wpos) {
  if (uTLOn < 0.5) return 1.0;
  vec2 m = vec2(wpos.x + uOrigin.x, -wpos.z + uOrigin.y);
  float h = wpos.y + uOrigin.z;
  return smoothstep(-6.0, -2.5, h - groundAt(m));
}
/** The sun through the valley fog above a point. */
float fogSun(vec3 wpos) {
  float h = wpos.y + uOrigin.z;
  return exp(-uFogSun.x * max(0.0, uFogSun.y - h) / max(uSunDir.y, 0.05));
}
/** Sky light in the gorge: what the mountains leave of the sky, plus their snow lit by it. */
float skyLightScale(vec3 wpos) {
  float s = terrainSvf(wpos);
  return s + (1.0 - s) * 0.45;
}
`;

const CAR_GLSL = /* glsl */`
// ---- inside the cars: daylight only through the windows, the lamps, the light the panelling throws back
#define MAX_CARS 8
uniform int uCarCount;
uniform mat4 uCarInv[MAX_CARS];       // world -> car (x forward, y up from the rail, z right)
uniform mat4 uCarMat[MAX_CARS];       // car -> world
uniform vec4 uCarBand[MAX_CARS];      // the window band: x0, x1, y0, y1
uniform vec4 uCarInfo[MAX_CARS];      // inner half length, inner half width, glazed share right, left
uniform vec4 uCarLamp[MAX_CARS];      // lamp power, x of the first lamp, spacing, count
int carAt(vec3 wpos, out vec3 lp) {
  for (int k = 0; k < MAX_CARS; k++) {
    if (k >= uCarCount) break;
    vec3 q = (uCarInv[k] * vec4(wpos, 1.0)).xyz;
    vec4 I = uCarInfo[k];
    float az = abs(q.z);
    float ceil = az < 0.85 ? 3.9 : 3.48 - (az - 0.85) / 0.52 * 0.23;
    if (abs(q.x) < I.x && az < I.y && q.y > 1.27 && q.y < ceil) { lp = q; return k; }
  }
  return -1;
}
/** Lambert's form factor from a point (normal n) to a polygon a-b-c-d (all relative to the point). */
float polyFF(vec3 n, vec3 a, vec3 b, vec3 c, vec3 d) {
  vec3 v0 = normalize(a), v1 = normalize(b), v2 = normalize(c), v3 = normalize(d);
  float s = 0.0;
  s += acos(clamp(dot(v0, v1), -1.0, 1.0)) * dot(n, normalize(cross(v0, v1)));
  s += acos(clamp(dot(v1, v2), -1.0, 1.0)) * dot(n, normalize(cross(v1, v2)));
  s += acos(clamp(dot(v2, v3), -1.0, 1.0)) * dot(n, normalize(cross(v2, v3)));
  s += acos(clamp(dot(v3, v0), -1.0, 1.0)) * dot(n, normalize(cross(v3, v0)));
  return max(0.0, abs(s) > 0.0 ? s / (2.0 * PI) : 0.0);
}
/** Irradiance on an interior surface (world normal N) at car-local point q of car k. */
vec3 carInterior(int k, vec3 q, vec3 Nw, float day) {
  mat3 toCar = mat3(uCarInv[k]);
  vec3 n = normalize(toCar * Nw);
  vec4 B = uCarBand[k], I = uCarInfo[k];
  float w = I.y + 0.06;
  // the window bands on the right (z = +w) and left (z = -w) walls, relative to the point
  vec3 r0 = vec3(B.x, B.z, w) - q, r1 = vec3(B.y, B.z, w) - q, r2 = vec3(B.y, B.w, w) - q, r3 = vec3(B.x, B.w, w) - q;
  vec3 l0 = vec3(B.x, B.z, -w) - q, l1 = vec3(B.x, B.w, -w) - q, l2 = vec3(B.y, B.w, -w) - q, l3 = vec3(B.y, B.z, -w) - q;
  float ffR = q.z < w ? polyFF(n, r0, r1, r2, r3) : 0.0;
  float ffL = q.z > -w ? polyFF(n, l0, l1, l2, l3) : 0.0;
  // what the window looks out on: the sky light of a surface facing out that way, dimmed by the gorge
  mat3 toWorld = mat3(uCarMat[k]);
  vec3 outR = normalize(toWorld * vec3(0.0, 0.25, 1.0)), outL = normalize(toWorld * vec3(0.0, 0.25, -1.0));
  vec3 Lr = shIrradiance(outR, uSkySH) * INV_PI, Ll = shIrradiance(outL, uSkySH) * INV_PI;
  vec3 E = PI * (Lr * ffR * I.z + Ll * ffL * I.w);
  // the panelling and the carpet throw some of it back: an even fill
  vec3 fill = PI * (Lr * I.z + Ll * I.w) * 0.035;
  E = (E + fill) * day;
  // the ceiling lamps
  vec4 Lm = uCarLamp[k];
  if (Lm.x > 0.0) {
    for (int i = 0; i < 8; i++) {
      if (float(i) >= Lm.w) break;
      vec3 d = vec3(Lm.y + Lm.z * float(i), 3.5, 0.0) - q;
      float d2 = dot(d, d);
      E += vec3(1.0, 0.86, 0.66) * Lm.x * (max(dot(n, d * inversesqrt(d2)), 0.0) + 0.15) / (d2 + 0.05);
    }
  }
  return E;
}

`;

function replaceOnce(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(`lighting patch: "${a.slice(0, 60)}" not found`);
  return src.slice(0, i) + b + src.slice(i + a.length);
}

export function patchLighting(src) {
  let s = replaceOnce(src, SKY, SKY_GLSL + TERRAIN_LIGHT_GLSL + GROUND_GLSL);
  s = replaceOnce(s, 'in vec2 vUv;\nout vec4 o;', CAR_GLSL + 'in vec2 vUv;\nout vec4 o;');
  s = replaceOnce(s, 'float vis = uShadowsOn > 0.5 ? sunShadow(wpos, N, viewDepth, rot) : 1.0;',
    'float day = daylightAt(wpos);\n  float vis = (uShadowsOn > 0.5 ? sunShadow(wpos, N, viewDepth, rot) : 1.0) * terrainSun(wpos) * fogSun(wpos) * day;');
  s = replaceOnce(s, 'vec3 E = irradianceAt(wpos, N);',
    'vec3 carQ; int carK = carAt(wpos, carQ);\n  vec3 E = carK >= 0 ? carInterior(carK, carQ, N, day) : irradianceAt(wpos, N) * skyLightScale(wpos) * day * g3.a;');
  s = replaceOnce(s, 'vec3 envL = textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity;',
    'vec3 envL = carK >= 0 ? E * INV_PI * 0.8 : textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity * day * mix(1.0, skyLightScale(wpos), 0.6);');
  return s;
}

const SKY_CUBE_FS = /* glsl */`
${COMMON}
${SKY_GLSL}
${CUBE_DIR}
in vec2 vUv;
uniform int uFace;
out vec4 o;
void main() { o = vec4(skyRadiance(cubeDir(uFace, vUv), false), 1.0); }`;

// ---------------------------------------------------------------------------------------------
// the final image: exposure, a neutral grade for snow, ACES, vignette, grain, sharpening

const COMPOSITE_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uBloom, uExposure, uLogLum;
uniform float uBloomOn, uBloomStrength, uTime, uVignette, uGrain, uAberration, uFlash, uLocal, uLogLevel;
uniform vec2 uResolution;
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
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
  float expo = texture(uExposure, vec2(0.5)).r;
  // local exposure (the eye adapts to where it looks): the neighbourhood's log luminance against the
  // whole frame's, compressed by uLocal, at most two stops either way
  if (uLocal > 0.0) {
    vec2 g = textureLod(uLogLum, vec2(0.5), 20.0).rg;
    float globalLog = g.x / max(g.y, 1e-4);
    vec2 l = textureLod(uLogLum, vUv, uLogLevel).rg;
    float localLog = l.x / max(l.y, 1e-4);
    expo *= exp2(clamp(-(localLog - globalLog) * uLocal, -2.0, 2.0));
  }
  col *= expo;
  // a winter grade: keep snow white, let shade stay a little cool, a touch of contrast
  float l = luma(col);
  col = mix(col, col * vec3(0.97, 0.99, 1.04), 1.0 - smoothstep(0.0, 0.3, l));
  col = max(mix(vec3(l), col, 1.03), 0.0);
  col = aces(col * 1.05);
  col += uFlash * vec3(1.0, 0.97, 0.93);
  col *= 1.0 - uVignette * smoothstep(0.35, 0.9, r);
  col = linearToSRGB(saturate(col));
  col += (hash12(vUv * uResolution + fract(uTime * 7.13) * 431.0) - 0.5) * uGrain;
  o = vec4(col, 1.0);
}`;

const RCAS_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform float uSharpness;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 b = texelFetch(uSrc, p + ivec2(0, -1), 0).rgb, d = texelFetch(uSrc, p + ivec2(-1, 0), 0).rgb;
  vec3 e = texelFetch(uSrc, p, 0).rgb;
  vec3 f = texelFetch(uSrc, p + ivec2(1, 0), 0).rgb, h = texelFetch(uSrc, p + ivec2(0, 1), 0).rgb;
  vec3 mn = min(min(b, d), min(min(e, f), h)), mx = max(max(b, d), max(max(e, f), h));
  vec3 amp = clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
  vec3 w = -sqrt(amp) * mix(0.125, 0.2, uSharpness);
  o = vec4(clamp((e + (b + d + f + h) * w) / (1.0 + 4.0 * w), 0.0, 1.0), 1.0);
}`;

class WinterComposite {
  constructor() { this.name = 'composite'; this.sharpness = 0.5; this.vignette = 0.28; this.grain = 0.018; this.flash = 0; this.local = 0.45; }
  init(r) { this.prog = postProgram(r.gl, COMPOSITE_FS, {}, 'composite'); this.rcas = postProgram(r.gl, RCAS_FS, {}, 'rcas'); }
  resize(r) { if (!this.ldr) this.ldr = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba8' }] }); else this.ldr.resize(r.displayW, r.displayH); }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    this.ldr.bind();
    this.prog.use().set('uColor', color).set('uBloom', r.bloomTex ?? color).set('uBloomOn', r.bloomTex ? 1 : 0).set('uBloomStrength', r.pass('bloom')?.strength ?? 0)
      .set('uExposure', r.exposureTex).set('uTime', r.time).set('uVignette', this.vignette).set('uGrain', this.grain)
      .set('uAberration', 0.0008).set('uFlash', this.flash).set('uResolution', [r.displayW, r.displayH])
      .set('uLogLum', r.pass('exposure')?.log?.tex ?? r.exposureTex).set('uLocal', r.pass('exposure')?.log ? this.local : 0).set('uLogLevel', 4.5);
    fullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    this.rcas.use().set('uSrc', this.ldr.tex).set('uSharpness', this.sharpness);
    fullscreen(gl);
    return color;
  }
}

// ---------------------------------------------------------------------------------------------

export class GotthardStage {
  constructor(canvas, { quality = 'high', terrain, weather, date }) {
    this.quality = quality;
    this.date = date;
    const r = (this.r = new Renderer(canvas, { quality }));
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 120000);
    this.origin = { x: 0, y: 0, z: 0 };
    this.anchored = new Set();
    this.terrain = terrain;
    r.shadows.distance = 220;
    r.contactShadowLength = 0.25;
    r.envIntensity = 1.0;

    // passes, in pipeline order
    this.screen = r.addPass(new ScreenSpace());
    this.atmosphere = r.addPass(new Atmosphere(this));
    this.splats = r.addPass(new GaussianSplats({ max: 3000, range: 600 }));
    this.dof = r.addPass(new DOF());
    this.dof.amount = 0;
    this.taa = r.addPass(new TAA());
    r.addPass(new Upscale());
    this.motionBlur = r.addPass(new MotionBlur());
    this.exposure = r.addPass(new Exposure());
    this.exposure.minEV = -6; this.exposure.maxEV = 7; this.exposure.key = 0.16;
    this.bloom = r.addPass(new Bloom());
    this.composite = r.addPass(new WinterComposite());
    this.debugDraw = r.addPass(new DebugDraw());
    const dbg = new URLSearchParams(location.search).get('debug');
    if (dbg) r.addPass(new Debug(dbg));
    this._applyQuality();

    // the valley's light
    const gl = r.gl;
    r.lighting = postProgram(gl, patchLighting(LIGHTING_FS), {}, 'lighting');
    r.env.skyProg = postProgram(gl, SKY_CUBE_FS, {}, 'sky-cube');
    this.skyLUT = new SkyLUT(gl);
    this.terrainLight = new TerrainLight(this, terrain);
    this._buildFineAtlas();
    this.sky = { mieExt: 1e-5, clouds: [0.1, 0, 1, 0], overcast: [0.3, 0.32, 0.36], sunDisc: [0, 0, 0], drift: [1, 0] };
    const baseSky = r.skyUniforms.bind(r);
    r.skyUniforms = () => ({
      ...baseSky(), uSkyLUT: this.skyLUT.tex, uClouds: this.sky.clouds, uSunDisc: this.sky.sunDisc,
      uOvercast: this.sky.overcast, uCloudDrift: this.sky.drift,
    });
    // the engine calls vsm.bind(L) on the lighting program just before drawing: our uniforms go in there
    r.vsm = { bind: (L) => this._bindLighting(L) };

    this.terrainGL = new TerrainGL(this, terrain);
    this.scene.add(this.terrainGL);
    this.setWeather(weather);
    window.med = r;
    window.stage = this;
    window.addEventListener('resize', () => this.resize());
  }

  _applyQuality() {
    const q = this.r.q;
    this.motionBlur.enabled = q.motionBlur;
    this.bloom.enabled = q.bloom;
    this.taa.enabled = true;
    this.dof.enabled = q.dof;
  }

  setQuality(q) { this.quality = q; this.r.setQuality(q); this._applyQuality(); this.taa.reset = true; }

  resize() {
    this.r.resize();
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** The fine tiles in one texture, so the lighting can find the ground under any pixel. */
  _buildFineAtlas() {
    const T = this.terrain, gl = this.r.gl, N = FINE_N + 3;
    const keys = [...T.fineWanted];
    const cols = 8, rows = Math.ceil(keys.length / cols);
    this.atlas = new Texture(gl, { width: cols * N, height: rows * N, format: 'r32f', filter: 'nearest' });
    const tw = Math.floor((T.x1 - T.x0) / FINE_TILE) + 1, th = Math.floor((T.y1 - T.y0) / FINE_TILE) + 1;
    const index = new Float32Array(tw * th);
    keys.forEach((key, k) => {
      const [ti, tj] = key.split(',').map(Number);
      const t = T.fineTile(ti, tj);
      this.atlas.upload(t.H, 0, (k % cols) * N, Math.floor(k / cols) * N, N, N);
      index[tj * tw + ti] = k + 1;
    });
    this.atlasIndex = new Texture(gl, { width: tw, height: th, format: 'r32f', filter: 'nearest', data: index });
    this.atlasInfo = { cols, N, size: [tw, th], rect: [T.x0, T.y0, FINE_TILE, FINE_STEP] };
  }

  _bindLighting(L) {
    this.terrainLight.bind(L, this.origin);
    const A = this.atlasInfo;
    L.set('uFineAtlas', this.atlas).set('uFineIndex', this.atlasIndex).set('uFineIndexSize', A.size).set('uFineRect', A.rect)
      .set('uFineCols', A.cols).set('uFineN', A.N).set('uFogSun', this.fogSun ?? [0, 0]);
    // the cars' interiors (set by the train renderer each frame)
    const C = this.cars;
    L.set('uCarCount', C ? C.count : 0);
    if (C && C.count) L.set('uCarInv', C.inv).set('uCarMat', C.mat).set('uCarBand', C.band).set('uCarInfo', C.info).set('uCarLamp', C.lamp);
  }

  // ---- the floating origin ------------------------------------------------------------------

  /** Keeps obj at a fixed map position (x east, y north, z up) whatever the origin. */
  anchor(obj, map) {
    obj.userData.anchor = { x: map.x, y: map.y, z: map.z };
    this.anchored.add(obj);
    this._place(obj);
    return obj;
  }
  unanchor(obj) { this.anchored.delete(obj); }
  _place(obj) {
    const a = obj.userData.anchor, o = this.origin;
    obj.position.set(a.x - o.x, a.z - o.z, -(a.y - o.y));
  }
  /** Map point -> world (floating) position. */
  toWorld(x, y, z, out = new Vector3()) { const o = this.origin; return out.set(x - o.x, z - o.z, -(y - o.y)); }
  toMap(v, out = {}) { const o = this.origin; out.x = v.x + o.x; out.y = -v.z + o.y; out.z = v.y + o.z; return out; }

  /** Moves the origin (in whole metres, so nothing creeps) when the camera has gone far from it. */
  recentre(map, limit = 400) {
    const o = this.origin;
    if (Math.abs(map.x - o.x) < limit && Math.abs(map.y - o.y) < limit && Math.abs(map.z - o.z) < limit) return false;
    o.x = Math.round(map.x); o.y = Math.round(map.y); o.z = Math.round(map.z);
    for (const obj of this.anchored) this._place(obj);
    this.taa.reset = true;
    return true;
  }

  // ---- weather and sun ----------------------------------------------------------------------

  setWeather(weather) {
    this.weather = weather;
    const sp = skyParams(weather);
    this.sky.mieExt = sp.mieExt;
    this.sky.clouds = sp.clouds;
    this.atmosphere.setWeather(weather);
    this.terrainGL.setWeather(weather);
    const p = weather.p;
    this.fogSun = p.fog ? [3.912 / Math.max(50, p.visibility), p.fogTop ?? 1e4] : [0, 0];
    this.sky.drift = [Math.sin((p.windFrom ?? 0) * Math.PI / 180 + Math.PI) * (p.wind ?? 2) * 4, Math.cos((p.windFrom ?? 0) * Math.PI / 180 + Math.PI) * (p.wind ?? 2) * 4];
    this._sunKey = null;
  }

  /** Puts the sun where it is at this local time (seconds of the day) and lights the sky for it. */
  setTime(clock, { now = false } = {}) {
    const pos = sunPosition(utcMs(this.date, clock), LAT, LON);
    const v = sunVector(pos);
    this.sunPos = pos;
    const key = Math.round(pos.azimuth * 20) + ':' + Math.round(pos.elevation * 20);   // every 0.05 degrees
    if (key === this._sunKey) return;
    this._sunKey = key;
    const r = this.r;
    r.sunDir.set(v.x, v.y, v.z);
    const alt = this.origin.z || 800;
    const T = sunTransmittance(v, alt, this.sky.mieExt);
    // the clouds take the direct beam: broken cloud thins it, an overcast deck hides the sun
    const c = this.sky.clouds;
    const cloudT = Math.max(0, 1 - c[1]) * (1 - 0.35 * c[0]) * (c[1] > 0.95 ? 0 : 1);
    const E = SUN_E0 * cloudT;
    r.sunColor.set(T[0], T[1], T[2]);
    r.sunIntensity = E;
    // the disc's radiance would be ~1.5e5 here; half floats stop at 65504, so it is held at a bright 3e4
    this.sky.sunDisc = [T[0] * SUN_E0 * cloudT * 3000, T[1] * SUN_E0 * cloudT * 3000, T[2] * SUN_E0 * cloudT * 3000];
    // the overcast deck's own brightness: what gets through thick stratus at this sun (CIE overcast)
    const ghi = SUN_E0 * Math.max(0, v.y) * (T[0] + T[1] + T[2]) / 3 + 0.6;
    const k = c[1] > 0.5 ? (c[0] >= 1 && c[3] > 0.5 ? 0.11 : 0.2) : 0.35;
    const lz = (ghi * k) / 2.44;
    this.sky.overcast = [lz * 0.94, lz * 0.97, lz * 1.02];
    this.skyLUT.update({ sunDir: v, altitude: alt, mieExt: this.sky.mieExt, groundAlbedo: (this.weather.p.groundSnowValley ?? 0) > 0.05 ? 0.6 : 0.25 });
    r.invalidateEnvironment();
    this.terrainLight.update(v, { now });
  }

  // ---- frame ---------------------------------------------------------------------------------

  render(dt) {
    this.terrainLight.step();
    this.r.render(this.scene, this.camera, dt);
  }
}
