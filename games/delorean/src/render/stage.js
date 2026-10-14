/**
 * The game's stage on the Med Engine (Zweikampf 1403's renderer, imported read-only): the
 * deferred PBR renderer with its shadow cascades, screen-space AO, bounce light and
 * reflections, temporal upscaling, motion blur, auto exposure and bloom. What a car at night
 * needs on top of a sunlit medieval town is added through the engine's own hooks, without
 * changing it:
 *
 *  - the sky of any hour of any year (sky.js): sun, twilight, moon, stars, the town's glow,
 *  - the moon as the light when the sun is down (the engine has one directional light),
 *  - headlights: spot lights with a real beam (the engine has only point lights),
 *  - two dozen point lights instead of eight (a parking lot's lamps, a street at night),
 *  - the car's cabin: shaded by its roof, so the sky does not light the seats as if outdoors,
 *  - the eye at night: rods instead of cones below a few candelas (the Purkinje shift).
 *
 * World axes as in the engine: X east, Y up, Z south.
 */
import { Scene, PerspectiveCamera, Vector3, Matrix4 } from 'three';
import { Renderer } from '../../../duel1403/src/engine/Renderer.js';
import { ScreenSpace } from '../../../duel1403/src/engine/passes/ScreenSpace.js';
import { DOF, MotionBlur } from '../../../duel1403/src/engine/passes/Cinematic.js';
import { TAA, Upscale } from '../../../duel1403/src/engine/passes/TAA.js';
import { Exposure, Bloom } from '../../../duel1403/src/engine/passes/Post.js';
import { DebugDraw } from '../../../duel1403/src/engine/passes/DebugDraw.js';
import { Debug } from '../../../duel1403/src/engine/passes/Debug.js';
import { LIGHTING_FS } from '../../../duel1403/src/engine/shaders/lighting.js';
import { COMMON, SKY } from '../../../duel1403/src/engine/shaders/common.js';
import { CUBE_DIR } from '../../../duel1403/src/engine/passes/Environment.js';
import { Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { SKY_GLSL, SkyLUT, transmittance, SUN_E0 } from './sky.js';
import { Glass } from './glass.js';
import { sunPosition, moonPosition, skyVector, equatorialToWorld, moonIlluminance } from '../astro.js';

export const MAX_POINTS = 24, MAX_SPOTS = 4;

// ---------------------------------------------------------------------------------------------
// the lighting pass

const EXTRA_GLSL = /* glsl */`
uniform vec3 uLightDir;                 // the light that casts the shadows: the sun, or the moon at night
#define MAX_SPOTS ${MAX_SPOTS}
uniform int uSpotCount;
uniform vec4 uSpotPos[MAX_SPOTS];       // xyz, range (m)
uniform vec4 uSpotDir[MAX_SPOTS];       // beam axis, cos of the outer cone
uniform vec4 uSpotColor[MAX_SPOTS];     // rgb * intensity (candela / 10 000), cos of the inner cone
uniform vec4 uSpotShape[MAX_SPOTS];     // the beam's spread: horizontal and vertical half-angle tangents, cut-off tilt, unused
// the car's cabin: a box in the car's frame (x forward, y up, z right) under a steel roof
uniform mat4 uCabinInv;
uniform vec4 uCabinMin, uCabinMax;      // xyz; w: how open the doors are (0..1)
float cabinShade(vec3 wpos, vec3 N, out float inside) {
  vec3 q = (uCabinInv * vec4(wpos, 1.0)).xyz;
  vec3 e = min(q - uCabinMin.xyz, uCabinMax.xyz - q);
  inside = smoothstep(0.0, 0.06, min(min(e.x, e.y), e.z));
  if (inside <= 0.0) return 1.0;
  // the sky comes in through the windscreen (forward and up), the side glass and the open doors
  vec3 n = normalize(mat3(uCabinInv) * N);
  float ws = max(dot(n, normalize(vec3(0.75, 0.62, 0.0))), 0.0);
  float sides = max(abs(n.z) * 0.8 + n.y * 0.3, 0.0);
  float f = 0.06 + 0.42 * ws + 0.16 * sides + 0.5 * uCabinMin.w * (0.4 + 0.6 * max(n.y, 0.0));
  return mix(1.0, min(f, 1.0), inside);
}
`;

const SPOT_LOOP = /* glsl */`
  // --- spot lights (headlamps) ------------------------------------------------
  for (int i = 0; i < MAX_SPOTS; i++) {
    if (i >= uSpotCount) break;
    vec3 d = uSpotPos[i].xyz - wpos;
    float dist2 = dot(d, d);
    float r = uSpotPos[i].w;
    float fall = pow2(saturate(1.0 - pow2(dist2 / (r * r)))) / (dist2 + 0.25);
    vec3 Lp = d * inversesqrt(dist2);
    // the beam: wide across, flat in height, cut off above the horizon on the near side (a low beam)
    vec3 ax = uSpotDir[i].xyz;
    vec3 side = normalize(cross(ax, vec3(0.0, 1.0, 0.0)));
    vec3 upv = cross(side, ax);
    vec3 v = -Lp;
    float fwd = dot(v, ax);
    float beam = 0.0;
    if (fwd > 0.0) {
      vec2 t = vec2(dot(v, side), dot(v, upv)) / fwd;
      vec2 s = t / uSpotShape[i].xy;
      beam = exp(-dot(s, s) * 1.6);
      beam *= smoothstep(uSpotShape[i].z + 0.012, uSpotShape[i].z - 0.012, t.y);   // the cut-off
      beam += 0.04 * exp(-dot(t, t) * 2.0);                                         // the spill
    }
    vec3 dB;
    vec3 sp = brdfDirect(N, V, Lp, diffuseColor, F0, rough, dB);
    direct += (dB + sp) * saturate(dot(N, Lp)) * fall * beam * uSpotColor[i].rgb;
  }
`;

function replaceOnce(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(`lighting patch: "${a.slice(0, 60)}" not found`);
  return src.slice(0, i) + b + src.slice(i + a.length);
}

export function patchLighting(src) {
  let s = replaceOnce(src, SKY, SKY_GLSL);
  s = replaceOnce(s, 'in vec2 vUv;\nout vec4 o;', EXTRA_GLSL + 'in vec2 vUv;\nout vec4 o;');
  s = replaceOnce(s, '#define MAX_POINTS 8', `#define MAX_POINTS ${MAX_POINTS}`);
  s = replaceOnce(s, 'vec3 L = uSunDir;', 'vec3 L = uLightDir;');
  s = replaceOnce(s, '  // --- indirect', SPOT_LOOP + '\n  // --- indirect');
  // the cabin: the roof shades the sky light and what the interior reflects
  s = replaceOnce(s, 'vec3 E = irradianceAt(wpos, N);', 'float inCabin; float cab = cabinShade(wpos, N, inCabin);\n  vec3 E = irradianceAt(wpos, N) * cab;');
  s = replaceOnce(s, 'vec3 envL = textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity;',
    'vec3 envL = textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity * mix(1.0, cab * 0.6, inCabin);');
  // at most 16 textures in one shader (the limit of many graphics cards): the engine's features
  // this game does not use (light probes, virtual shadow pages, ray-traced shadows) read nothing,
  // and the BRDF's lookup table gives way to its analytic fit (Karis 2014, in COMMON)
  s = replaceOnce(s, 'c[k] = texelFetch(uProbes, ivec2(index, k), 0).rgb;', 'c[k] = vec3(0.0);');
  s = replaceOnce(s, 'vec4 t = texelFetch(uVsmTable, ivec2(slot.x, float(l) * 64.0 + slot.y), 0);', 'vec4 t = vec4(-1.0);');
  s = replaceOnce(s, 'sum += texture(uVsmAtlas, vec3(uv, dref - 0.00002));', 'sum += 1.0;');
  s = replaceOnce(s, 'mix(1.0, texture(uRTShadow, vUv).r, ', 'mix(1.0, 1.0, ');
  s = replaceOnce(s, 'vec2 dfg = texture(uBrdfLut, vec2(NoV, rough)).rg;', 'vec2 dfg = envBRDFApprox(NoV, rough);');
  // screen-space inputs can come back invalid on some graphics cards (phones): count as none
  s = replaceOnce(s, 'float ao = texture(uAO, vUv).r;', 'float ao = texture(uAO, vUv).r;\n  if (!(ao >= 0.0 && ao <= 1.0)) ao = 1.0;');
  s = replaceOnce(s, 'vec4 gi = texture(uSSGI, vUv);', 'vec4 gi = texture(uSSGI, vUv);\n  if (!(abs(gi.r) + abs(gi.g) + abs(gi.b) + abs(gi.a) < 1e30)) gi = vec4(0.0);\n  gi = clamp(gi, vec4(0.0), vec4(6e4, 6e4, 6e4, 1.0));');
  s = replaceOnce(s, 'vec4 ssr = texture(uSSR, vUv);', 'vec4 ssr = texture(uSSR, vUv);\n  if (!(abs(ssr.r) + abs(ssr.g) + abs(ssr.b) + abs(ssr.a) < 1e30)) ssr = vec4(0.0);\n  ssr = clamp(ssr, vec4(0.0), vec4(6e4, 6e4, 6e4, 1.0));');
  s = replaceOnce(s, 'vec3 N = decodeNormal(g1.xy);', 'vec3 N = decodeNormal(g1.xy);\n  if (!(abs(N.x) <= 1.0 && abs(N.y) <= 1.0 && abs(N.z) <= 1.0)) N = V;');
  s = replaceOnce(s, 'vec3 color = direct + indirectDiffuse + indirectSpec + emissive;',
    'vec3 color = direct + indirectDiffuse + indirectSpec + emissive;\n  if (!(color.r + color.g + color.b < 1e30)) color = vec3(0.0);\n  color = min(color, vec3(6e4));');
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
// the final image: exposure, the eye at night, ACES, the time machine's flash, vignette, grain

const COMPOSITE_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uBloom, uExposure;
uniform float uBloomOn, uBloomStrength, uTime, uVignette, uGrain, uAberration, uNight;
uniform vec3 uFlash;            // a flash over the whole view (time displacement), rgb
uniform float uWarp;            // 0..1: the instant of displacement, the view burns out from the centre
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
  float ab = uAberration * (0.5 + r * 2.0) + uWarp * 0.02;
  vec3 col = vec3(hdr(vUv + c * ab).r, hdr(vUv).g, hdr(vUv - c * ab).b);
  float expo = texture(uExposure, vec2(0.5)).r;
  // the eye at night (mesopic vision): below a few cd/m2 the rods take over, colour fades to
  // a bluish grey (scotopic luminance after Wyszecki & Stiles); 1 unit of radiance ~ 10 000 cd/m2,
  // so from about 3 cd/m2 down to 0.01 cd/m2
  float Y = luma(col);
  float scot = max(dot(col, vec3(0.04, 0.51, 0.45)), 0.0);
  float m = smoothstep(-11.5, -19.0, log2(max(Y, 1e-12))) * uNight;
  col = mix(col, scot * vec3(0.78, 0.92, 1.22), m * 0.75);
  col *= expo;
  col = aces(col * 1.05);
  col = mix(col, vec3(1.0), saturate(uWarp * (1.4 - r)));
  col += uFlash;
  col *= 1.0 - uVignette * smoothstep(0.35, 0.95, r);
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

class NightComposite {
  constructor() { this.name = 'composite'; this.sharpness = 0.5; this.vignette = 0.3; this.grain = 0.02; this.flash = [0, 0, 0]; this.warp = 0; this.night = 0; this.aberration = 0.0008; }
  init(r) { this.prog = postProgram(r.gl, COMPOSITE_FS, {}, 'composite'); this.rcas = postProgram(r.gl, RCAS_FS, {}, 'rcas'); }
  resize(r) { if (!this.ldr) this.ldr = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba8' }] }); else this.ldr.resize(r.displayW, r.displayH); }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    this.ldr.bind();
    this.prog.use().set('uColor', color).set('uBloom', r.bloomTex ?? color).set('uBloomOn', r.bloomTex ? 1 : 0).set('uBloomStrength', r.pass('bloom')?.strength ?? 0)
      .set('uExposure', r.exposureTex).set('uTime', r.time).set('uVignette', this.vignette).set('uGrain', this.grain)
      .set('uAberration', this.aberration).set('uFlash', this.flash).set('uWarp', this.warp).set('uNight', this.night).set('uResolution', [r.displayW, r.displayH]);
    fullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    this.rcas.use().set('uSrc', this.ldr.tex).set('uSharpness', this.sharpness);
    fullscreen(gl);
    return color;
  }
}

// ---------------------------------------------------------------------------------------------

const _v = new Vector3();

export class TimeStage {
  constructor(canvas, { quality = 'high' } = {}) {
    this.quality = quality;
    const r = (this.r = new Renderer(canvas, { quality }));
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(60, innerWidth / innerHeight, 0.03, 20000);
    r.shadows.distance = 140;
    r.contactShadowLength = 0.2;
    r.envIntensity = 1.0;

    // passes, in pipeline order (extra ones are inserted before 'glass' by addEffect)
    this.screen = r.addPass(new ScreenSpace());
    this.dof = r.addPass(new DOF());
    this.dof.amount = 0;
    this.taa = r.addPass(new TAA());
    r.addPass(new Upscale());
    this.motionBlur = r.addPass(new MotionBlur());
    this.glass = r.addPass(new Glass());
    this.exposure = r.addPass(new Exposure());
    this.exposure.minEV = -6; this.exposure.maxEV = 10.5; this.exposure.key = 0.16;
    this.bloom = r.addPass(new Bloom());
    this.bloom.strength = 0.05;
    this.composite = r.addPass(new NightComposite());
    this.debugDraw = r.addPass(new DebugDraw());
    const dbg = new URLSearchParams(location.search).get('debug');
    if (dbg) r.addPass(new Debug(dbg));
    this._applyQuality();

    const gl = r.gl;
    r.lighting = postProgram(gl, patchLighting(LIGHTING_FS), {}, 'lighting');
    r.env.skyProg = postProgram(gl, SKY_CUBE_FS, {}, 'sky-cube');
    this.skyLUT = new SkyLUT(gl);
    this.trueSun = new Vector3(0, 1, 0);
    this.sky = {
      clouds: [0.1, 0, 1, 0], overcast: [0.3, 0.32, 0.36], sunDisc: [0, 0, 0], drift: [1, 0],
      moonDir: [0, -1, 0], moonDisc: [0, 0, 0], starRot: [1, 0, 0, 0, 1, 0, 0, 0, 1], starsLM: [0, 0, 0], glow: [0, 0, 0],
    };
    const baseSky = r.skyUniforms.bind(r);
    r.skyUniforms = () => ({
      ...baseSky(), uSunDir: this.trueSun, uSkyLUT: this.skyLUT.tex, uClouds: this.sky.clouds, uSunDisc: this.sky.sunDisc,
      uOvercast: this.sky.overcast, uCloudDrift: this.sky.drift, uMoonDir: this.sky.moonDir, uMoonDisc: this.sky.moonDisc,
      uStarRot: this.sky.starRot, uStarsLM: this.sky.starsLM, uGlow: this.sky.glow,
    });
    // more point lights than the engine's eight
    r.setPointLights = (p, points) => this._setPoints(p, points);
    // the engine calls vsm.bind(L) on the lighting program just before drawing: our uniforms go in there
    r.vsm = { bind: (L) => this._bindLighting(L) };
    this.spots = [];                 // [{ pos: Vector3, dir: Vector3, color: [r,g,b] (cd/1e4), range, shape: [tx, ty, cut] }]
    this.cabin = null;               // { matrixInverse: Matrix4, min: [x,y,z], max: [x,y,z], open: 0..1 }
    this._cabinInv = new Matrix4();
    this.effects = [];
    window.med = r;
    window.stage = this;
    window.addEventListener('resize', () => this.resize());
  }

  /** Adds a forward pass (drawn over the lit, anti-aliased image, before the exposure). */
  addEffect(p) {
    const r = this.r;
    const i = r.passes.findIndex((q) => q.name === 'exposure');
    r.passes.splice(i, 0, p);
    p.init?.(r); p.resize?.(r);
    return p;
  }

  _applyQuality() {
    const q = this.r.q;
    this.motionBlur.enabled = q.motionBlur;
    this.bloom.enabled = q.bloom;
    this.taa.enabled = true;
    this.dof.enabled = false;
  }

  setQuality(q) { this.quality = q; this.r.setQuality(q); this._applyQuality(); this.taa.reset = true; }

  resize() {
    this.r.resize();
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  _setPoints(p, points) {
    // the nearest lights to the camera matter most
    const cam = this.r.cameraPos;
    let list = points;
    if (points.length > MAX_POINTS) {
      list = points.map((l) => { l.getWorldPosition(_v); return { l, d: _v.distanceToSquared(cam) / Math.max(1e-3, l.intensity) }; })
        .sort((a, b) => a.d - b.d).slice(0, MAX_POINTS).map((e) => e.l);
    }
    const n = Math.min(list.length, MAX_POINTS);
    const pos = (this._pp ??= new Float32Array(MAX_POINTS * 4)), col = (this._pc ??= new Float32Array(MAX_POINTS * 4));
    for (let i = 0; i < n; i++) {
      const l = list[i];
      l.getWorldPosition(_v);
      pos.set([_v.x, _v.y, _v.z, l.distance || 12], i * 4);
      col.set([l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, 0], i * 4);
    }
    p.set('uPointCount', n).set('uPointPos', pos).set('uPointColor', col);
  }

  _bindLighting(L) {
    const r = this.r;
    L.set('uLightDir', r.sunDir);
    const S = this.spots, n = Math.min(S.length, MAX_SPOTS);
    const a = (this._sa ??= new Float32Array(MAX_SPOTS * 4)), b = (this._sb ??= new Float32Array(MAX_SPOTS * 4)), c = (this._sc ??= new Float32Array(MAX_SPOTS * 4)), d = (this._sd ??= new Float32Array(MAX_SPOTS * 4));
    for (let i = 0; i < n; i++) {
      const s = S[i];
      a.set([s.pos.x, s.pos.y, s.pos.z, s.range ?? 120], i * 4);
      b.set([s.dir.x, s.dir.y, s.dir.z, 0], i * 4);
      c.set([s.color[0], s.color[1], s.color[2], 0], i * 4);
      d.set([s.shape?.[0] ?? 0.35, s.shape?.[1] ?? 0.1, s.shape?.[2] ?? 0.02, 0], i * 4);
    }
    L.set('uSpotCount', n).set('uSpotPos', a).set('uSpotDir', b).set('uSpotColor', c).set('uSpotShape', d);
    const C = this.cabin;
    if (C) {
      L.set('uCabinInv', C.matrixInverse).set('uCabinMin', [C.min[0], C.min[1], C.min[2], C.open ?? 0]).set('uCabinMax', [C.max[0], C.max[1], C.max[2], 0]);
    } else {
      L.set('uCabinInv', this._cabinInv).set('uCabinMin', [1, 1, 1, 0]).set('uCabinMax', [0, 0, 0, 0]);
    }
  }

  // ---- the sky ---------------------------------------------------------------------------------

  /**
   * Lights the world for a moment (UTC ms) and an era's air:
   * { glow: [r,g,b] radiance of the town's light on the horizon, haze (aerosol extinction /m),
   *   clouds: [cover, overcast, brightness, murk] }.
   */
  setSky(utcMs, air = {}) {
    const sun = sunPosition(utcMs), moon = moonPosition(utcMs);
    this.sunPos = sun; this.moonPos = moon;
    const key = `${Math.round(sun.azimuth * 10)}:${Math.round(sun.elevation * 10)}:${Math.round(moon.azimuth * 5)}:${Math.round(moon.elevation * 5)}:${JSON.stringify(air)}`;
    if (key === this._skyKey) return;
    this._skyKey = key;
    const r = this.r;
    const sv = skyVector(sun), mv = skyVector(moon);
    this.trueSun.set(sv.x, sv.y, sv.z);
    const mie = air.haze ?? 1.8e-5;
    const clouds = air.clouds ?? [0.08, 0, 1, 0];
    this.sky.clouds = clouds;
    const cloudT = Math.max(0, 1 - clouds[1]) * (1 - 0.35 * clouds[0]) * (clouds[1] > 0.95 ? 0 : 1);
    const Ts = transmittance(sv, 150, mie), Tm = transmittance(mv, 150, mie);
    // the moon's light (relative to the sun's) and its disc
    const moonLux = moonIlluminance(moon) * 10000, moonE = SUN_E0 * moonLux / 120000;
    const lunarL = SUN_E0 * 0.12 / Math.PI;
    this.sky.moonDir = [mv.x, mv.y, mv.z];
    this.sky.moonDisc = Tm.map((t) => t * lunarL * cloudT);
    this.sky.sunDisc = Ts.map((t) => t * SUN_E0 * cloudT * 3000);
    // the light that casts the shadows
    const sunUp = sun.elevation > -0.8;
    if (sunUp) {
      r.sunDir.set(sv.x, Math.max(sv.y, 0.012), sv.z).normalize();
      r.sunColor.set(Ts[0], Ts[1], Ts[2]);
      r.sunIntensity = SUN_E0 * cloudT;
    } else if (moon.elevation > -0.8) {
      r.sunDir.set(mv.x, Math.max(mv.y, 0.012), mv.z).normalize();
      r.sunColor.set(Tm[0] * 0.92, Tm[1] * 0.96, Tm[2]);
      r.sunIntensity = moonE * cloudT;
    } else {
      r.sunDir.set(0, 1, 0);
      r.sunIntensity = 0;
    }
    // the overcast deck: lit by the sun, the moon, and from below by the town
    const ghi = SUN_E0 * Math.max(0, sv.y) * (Ts[0] + Ts[1] + Ts[2]) / 3 + moonE * Math.max(0, mv.y) + 1e-6;
    const lz = (ghi * (clouds[1] > 0.5 ? 0.2 : 0.35)) / 2.44;
    this.sky.overcast = [lz * 0.94, lz * 0.97, lz * 1.02];
    // the night: stars and the Milky Way fade in through astronomical twilight and fade out in the town's glow
    const dark = Math.min(1, Math.max(0, (-sun.elevation - 4) / 12));
    const glow = air.glow ?? [0, 0, 0];
    const glowL = (glow[0] + glow[1] + glow[2]) / 3;
    const pollution = Math.min(1, glowL / 2.5e-5);
    const moonWash = moon.elevation > 0 ? moon.phase * 0.6 : 0;
    this.sky.starsLM = [dark * 6e-5 * (1 - 0.8 * pollution) * (1 - 0.5 * moonWash), dark * 2.2e-6 * (1 - pollution) * (1 - moonWash) * (1 - clouds[0]), dark];
    this.sky.glow = glow.map((g) => g * (0.3 + 0.7 * dark));
    this.sky.starRot = equatorialToWorld(utcMs);
    this.skyLUT.update({ sunDir: sv, moonDir: mv, moonE: moonE * cloudT, altitude: 150, mieExt: mie, groundAlbedo: 0.18 });
    this.night = Math.min(1, Math.max(0, (-sun.elevation + 2) / 10));
    this.composite.night = this.night;
    this.exposure.compensation = -1.3 * this.night;
    r.invalidateEnvironment();
  }

  // ---- frame ---------------------------------------------------------------------------------

  render(dt) {
    this.r.render(this.scene, this.camera, dt);
  }
}
