/**
 * The game's stage on the Med Engine (Zweikampf 1403's renderer, imported read-only, set up the
 * way Gotthard Pullman set it up): the deferred PBR renderer with its shadow cascades, screen-space
 * occlusion, bounce light and reflections, temporal upscaling, auto exposure and bloom; and what
 * a submarine needs on top, added through the engine's own hooks without changing it:
 *
 *  - the sky over Oahu's leeward coast on 15 October 2026 (Gotthard's sky.js and sun.js),
 *  - inside the pressure hull no daylight at all: each compartment lit by its own lamps (two
 *    rows along the overhead, white or red as the lighting is rigged), and the light the
 *    white-painted hull throws back;
 *  - under the sea, the sun's beam refracted at the surface (Snell: n = 1.333) and dimmed with
 *    depth by Beer-Lambert, separately for red, green and blue (clear oceanic water, Jerlov type
 *    I: red is gone by 10 m, blue reaches 100 m), the caustics of the waves near the surface,
 *    and the diffuse light from above coming down the same way;
 *  - a water pass: every pixel's view ray is followed through the sea (not through the hull or
 *    the acrylic observation deck), losing light to absorption and gaining the water's own
 *    scattered blue;
 *  - a floating origin that follows the boat.
 *
 * World axes as in the engine: X east, Y up (0 at the mean sea surface), Z south.
 */
import { Scene, PerspectiveCamera, Matrix4, Vector3 } from 'three';
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
import { Target, Program, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { GEOMETRY_VS, GBUFFER_FS, DEPTH_FS } from '../../../duel1403/src/engine/shaders/geometry.js';
import { CAPTURE_FS } from '../../../duel1403/src/engine/gi/ProbeVolume.js';
import { SKY_GLSL, SkyLUT, sunTransmittance, SUN_E0 } from '../../../gotthard-pullman/src/render/sky.js';
import { sunPosition, sunVector } from '../../../gotthard-pullman/src/render/sun.js';
import { HULL, COMPARTMENTS, CONNING_TOWER, FT } from '../data/boat.js';
import { DECK, LEVELS, HATCHES } from '../data/layout.js';
import { OBS_DECK } from '../physics/mass.js';
import { Surface } from './surface.js';
import { WATER, RAY_BOAT_GLSL } from './water.js';
import { Acrylic } from './acrylic.js';
import { Particles } from './particles.js';

import { PLACE, DATE } from '../data/place.js';
export { PLACE, DATE };

// ---------------------------------------------------------------------------------------------
// The boat's insides and the sea, for the lighting pass

const R_IN = HULL.pressureHullDia / 2 - 0.12;
const COMP_IDS = ['ftr', 'fbr', 'cr', 'abr', 'fer', 'aer', 'man', 'atr', 'ct', 'pump'];
export const NCOMP = COMP_IDS.length;

export const BOAT_GLSL = /* glsl */`
#define NCOMP ${NCOMP}
uniform mat4 uBoatInv;          // world -> boat (x forward, y above the keel, z starboard)
uniform vec4 uHull;             // axis height, inner radius, forward end x, after end x
uniform vec4 uCT;               // forward x, after x, axis height, radius
uniform vec4 uObs;              // centre x, axis height, inner radius, half length of the cylinder
uniform vec4 uTrunk;            // x, bottom, top, radius
uniform vec4 uComp[NCOMP];      // forward x, after x, lamp spacing, lamp intensity
uniform vec4 uCompCol[NCOMP];   // lamp colour, the hull's fill (share of the lamps' light thrown back)
uniform vec4 uLampY;            // lamp heights above the keel: main deck, pump room, conning tower; walking deck
uniform vec4 uSea;              // mean surface (world y), caustics strength, time, refraction index
uniform vec3 uKd;               // diffuse attenuation (1/m)
uniform vec3 uWaterRad;         // the water's radiance at the surface (looking horizontally)
uniform vec3 uSkyDown;          // the sky's irradiance on a level surface just under the sea

float hullR(float x) {
  float fwd = uHull.z, aft = uHull.w;
  float k = 1.0;
  if (x > fwd - 9.0) k = 1.0 - 0.28 * min(1.0, (x - (fwd - 9.0)) / 9.0);
  if (x < aft + 11.0) k = 1.0 - 0.3 * min(1.0, ((aft + 11.0) - x) / 11.0);
  return uHull.y * k;
}
/** 1 inside the pressure hull (or the conning tower, or the trunk), 2 in the observation deck, 0 outside. */
int boatRegion(vec3 wpos, out vec3 q) {
  q = (uBoatInv * vec4(wpos, 1.0)).xyz;
  float dy = q.y - uHull.x;
  if (q.x < uHull.z && q.x > uHull.w) { float R = hullR(q.x); if (dy * dy + q.z * q.z < R * R) return 1; }
  float cy = q.y - uCT.z;
  if (q.x < uCT.x && q.x > uCT.y && cy * cy + q.z * q.z < uCT.w * uCT.w) return 1;
  if (length(vec2(q.x - uTrunk.x, q.z)) < uTrunk.w && q.y > uTrunk.y && q.y < uTrunk.z) return 1;
  float dx = max(abs(q.x - uObs.x) - uObs.w, 0.0), oy = q.y - uObs.y;
  if (dx * dx + oy * oy + q.z * q.z < uObs.z * uObs.z) return 2;
  return 0;
}
int compAt(vec3 q) {
  if (q.y > uLampY.w + 2.6 && q.x < uCT.x && q.x > uCT.y) return 8;
  for (int k = 0; k < 8; k++) if (q.x <= uComp[k].x && q.x >= uComp[k].y) return (k == 2 && q.y < uLampY.w - 0.1) ? 9 : k;
  return q.x > 0.0 ? 0 : 7;
}
/** The compartment's lamps on a surface at q (boat coordinates) with normal n (boat axes). */
vec3 lampLight(int k, vec3 q, vec3 n) {
  vec4 C = uComp[k], col = uCompCol[k];
  if (C.w <= 0.0) return vec3(0.0);
  float ly = k == 8 ? uLampY.z : k == 9 ? uLampY.y : uLampY.x;
  float sp = C.z;
  float i0 = floor((q.x - C.y) / sp);
  float E = 0.0;
  for (int j = -2; j <= 2; j++) {
    float lx = C.y + (i0 + float(j) + 0.5) * sp;
    if (lx > C.x || lx < C.y) continue;
    for (int s = -1; s <= 1; s += 2) {
      vec3 d = vec3(lx, ly, float(s) * 0.42) - q;
      float d2 = dot(d, d);
      vec3 l = d * inversesqrt(max(d2, 1e-6));
      // a shaded bulb: most of its light goes down
      E += (0.3 + 0.7 * max(l.y, 0.0)) * max(dot(n, l), 0.0) / (d2 + 0.08);
    }
  }
  return col.rgb * C.w * (E + col.a);
}
float seaDepth(vec3 w) { return max(0.0, uSea.x - w.y); }
/** The sun's direction under the surface (refracted), or above it. */
vec3 sunDirAt(vec3 w, vec3 L) {
  if (w.y >= uSea.x) return L;
  vec2 h = L.xz / uSea.w;
  return vec3(h.x, sqrt(max(0.0, 1.0 - dot(h, h))), h.y);
}
/** The waves' caustics: the surface focusing the sun into a moving net of lines. */
float caustics(vec3 w, vec3 Ls) {
  vec2 p = (w.xz - Ls.xz / max(Ls.y, 0.2) * w.y) * 0.55;
  float t = uSea.z * 0.6;
  float a = vnoise(p * 1.7 + vec2(t, t * 0.7)) + vnoise(p * 2.9 - vec2(t * 0.8, -t * 0.5));
  float c = 1.0 - abs(a - 1.0);
  return pow(c, 6.0) * 3.0 + 0.55;
}
/** What reaches a point of the sun's beam (relative to its irradiance above the surface). */
vec3 sunWater(vec3 w) {
  float d = seaDepth(w);
  if (d <= 0.0) return vec3(1.0);
  vec3 Lw = sunDirAt(w, uSunDir);
  float cw = max(Lw.y, 0.05);
  // Fresnel at the surface for the sun's elevation (Schlick, n = 1.333: 2 % head on)
  float ct = max(uSunDir.y, 0.0);
  float F = 0.02 + 0.98 * pow5(1.0 - ct);
  float caus = mix(1.0, caustics(w, Lw), uSea.y * exp(-d / 9.0));
  return (1.0 - F) * exp(-uKd * d / cw) * caus;
}
/** The diffuse light under the sea on a surface facing N: mostly from above, a few per cent from below. */
vec3 waterIrradiance(vec3 w, vec3 N) {
  float d = seaDepth(w);
  vec3 T = exp(-uKd * d);
  float up = 0.5 + 0.5 * N.y;
  return uSkyDown * T * (0.05 + 0.95 * up * up);
}
/** The radiance of the water itself, looking in direction R from a point at depth d. */
vec3 waterRadiance(vec3 R, float d) {
  return uWaterRad * exp(-uKd * d) * (0.35 + 0.65 * smoothstep(-0.6, 1.0, R.y));
}
`;

function replaceOnce(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(`lighting patch: "${a.slice(0, 60)}" not found`);
  return src.slice(0, i) + b + src.slice(i + a.length);
}

/**
 * The crew ride in the moving boat: the same correction Gotthard Pullman made for its passengers
 * (a skinned body's last-frame place is its bones' own motion, not the vehicle's counted twice).
 */
const GEOMETRY_VS_RIDING = replaceOnce(GEOMETRY_VS, '  pp = skinMatrix(uPrevBones) * p;', '  pp = skinMatrix(uPrevBones) * p;\n  prevModel = uModel;');
function patchGeometry(r) {
  r.programs.clear();
  r.program = function (kind, defines, key) {
    const k = kind + ':' + key;
    let p = this.programs.get(k);
    if (!p) {
      const fs = kind === 'gbuffer' ? GBUFFER_FS : kind === 'capture' ? CAPTURE_FS : DEPTH_FS;
      p = new Program(this.gl, GEOMETRY_VS_RIDING, fs, defines, `${kind}[${key}]`);
      this.programs.set(k, p);
    }
    return p;
  };
}

export function patchLighting(src) {
  let s = replaceOnce(src, SKY, SKY_GLSL + BOAT_GLSL);
  s = replaceOnce(s, 'vec3 L = uSunDir;',
    'vec3 boatQ; int region = boatRegion(wpos + N * 0.06, boatQ);\n  vec3 L = sunDirAt(wpos, uSunDir);');
  s = replaceOnce(s, 'float vis = uShadowsOn > 0.5 ? sunShadow(wpos, N, viewDepth, rot) : 1.0;',
    'float vis = region == 1 ? 0.0 : (uShadowsOn > 0.5 ? sunShadow(wpos, N, viewDepth, rot) : 1.0);');
  s = replaceOnce(s, 'vec3 direct = (diffBrdf + spec * energy) * NoL * vis * uSunIrradiance;',
    'vec3 sunW = region == 1 ? vec3(0.0) : sunWater(wpos);\n  vec3 direct = (diffBrdf + spec * energy) * NoL * vis * uSunIrradiance * sunW;');
  s = replaceOnce(s, 'vec3 E = irradianceAt(wpos, N);',
    'mat3 toBoat = mat3(uBoatInv);\n  vec3 E = region == 1 ? lampLight(compAt(boatQ), boatQ, normalize(toBoat * N)) : (seaDepth(wpos) > 0.0 ? waterIrradiance(wpos, N) : irradianceAt(wpos, N));');
  s = replaceOnce(s, 'vec3 envL = textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity;',
    'vec3 envL = region == 1 ? E * INV_PI * 0.8 : seaDepth(wpos) > 0.0 ? waterRadiance(R, seaDepth(wpos)) : textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity;');
  s = replaceOnce(s, 'vec3 sss = vec3(0.95, 0.32, 0.16) * max(w - NoL, 0.0) * mix(0.35, 1.0, vis);',
    'vec3 sss = vec3(0.95, 0.32, 0.16) * max(w - NoL, 0.0) * vis * sunW;');
  s = replaceOnce(s, 'vec3 coatRefl = mix(textureLod(uEnvSpec, reflect(-V, N), 0.6).rgb * uEnvIntensity, ssr.rgb, ssr.a);',
    'vec3 coatRefl = mix(region == 1 ? E * INV_PI * 0.8 : textureLod(uEnvSpec, reflect(-V, N), 0.6).rgb * uEnvIntensity, ssr.rgb, ssr.a);');
  // at most 16 textures in one fragment shader (as Gotthard Pullman does): the engine's features
  // this game never turns on read nothing, and the BRDF lookup gives way to its analytic fit
  s = replaceOnce(s, 'c[k] = texelFetch(uProbes, ivec2(index, k), 0).rgb;', 'c[k] = vec3(0.0);');
  s = replaceOnce(s, 'vec4 t = texelFetch(uVsmTable, ivec2(slot.x, float(l) * 64.0 + slot.y), 0);', 'vec4 t = vec4(-1.0);');
  s = replaceOnce(s, 'sum += texture(uVsmAtlas, vec3(uv, dref - 0.00002));', 'sum += 1.0;');
  s = replaceOnce(s, 'mix(1.0, texture(uRTShadow, vUv).r, ', 'mix(1.0, 1.0, ');
  s = replaceOnce(s, 'vec2 dfg = texture(uBrdfLut, vec2(NoV, rough)).rg;', 'vec2 dfg = envBRDFApprox(NoV, rough);');
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
// The water between the eye and what it sees

const FOG_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor;
uniform highp sampler2D uDepth;
uniform mat4 uInvViewProj;
uniform vec3 uCameraPos;
uniform mat4 uBoatInv;
uniform vec4 uHull, uCT, uObs;
uniform vec4 uSea;
uniform vec3 uKd, uC, uWaterRad;
${RAY_BOAT_GLSL}
void main() {
  vec3 col = texture(uColor, vUv).rgb;
  float d = texture(uDepth, vUv).r;
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 p1 = wp.xyz / wp.w;
  vec3 ray = p1 - uCameraPos;
  float L = length(ray);
  vec3 dir = ray / max(L, 1e-5);
  if (d >= 1.0) L = 3000.0;
  // the part of the ray under the (mean) surface
  float sy = uSea.x, cy = uCameraPos.y;
  float t0 = 0.0, t1 = L;
  if (cy > sy) { if (dir.y >= 0.0) { o = vec4(col, 1.0); return; } t0 = (sy - cy) / dir.y; }
  else if (dir.y > 0.0) t1 = min(t1, (sy - cy) / dir.y);
  if (t1 <= t0) { o = vec4(col, 1.0); return; }
  // less what lies inside the boat (its own air)
  vec3 ob = (uBoatInv * vec4(uCameraPos, 1.0)).xyz, db = mat3(uBoatInv) * dir;
  float tw = max(0.0, (t1 - t0) - insideBoat(ob, db, vec2(t0, t1)));
  if (tw <= 0.0) { o = vec4(col, 1.0); return; }
  // the light scattered toward the eye comes mostly from the first 1/c metres of water: take the
  // water's glow at that depth (so the far background is the same in every direction at one depth)
  float tEff = t0 + 0.5 * min(tw, 1.0 / uC.g);
  float dMid = max(0.0, sy - (cy + dir.y * tEff));
  vec3 T = exp(-uC * tw);
  vec3 Linf = uWaterRad * exp(-uKd * dMid) * (0.35 + 0.65 * smoothstep(-0.6, 1.0, dir.y));
  o = vec4(col * T + Linf * (1.0 - T), 1.0);
}`;

class WaterFog {
  constructor(stage) { this.name = 'waterFog'; this.stage = stage; this.enabled = true; }
  init(r) { this.prog = postProgram(r.gl, FOG_FS, {}, 'water-fog'); }
  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.width, height: r.height, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.width, r.height);
  }
  afterLighting(r, color) {
    const gl = r.gl, S = this.stage;
    this.target.bind();
    state(gl);
    this.prog.use().set('uColor', color).set('uDepth', r.depth).set('uInvViewProj', r.invViewProj).set('uCameraPos', r.cameraPos)
      .set('uBoatInv', S.boatInv).set('uHull', S.U.hull).set('uCT', S.U.ct).set('uObs', S.U.obs).set('uSea', S.U.sea)
      .set('uKd', WATER.Kd).set('uC', WATER.c).set('uWaterRad', S.U.waterRad);
    fullscreen(gl);
    return this.target.tex;
  }
}

// ---------------------------------------------------------------------------------------------
// The final image: exposure, a neutral grade, ACES, vignette, grain, sharpening (as Gotthard's)

const COMPOSITE_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uBloom, uExposure, uLogLum;
uniform float uBloomOn, uBloomStrength, uTime, uVignette, uGrain, uLocal, uLogLevel;
uniform vec3 uWB;              // the eye's adaptation to the light's colour (under the sea, to its blue)
uniform vec2 uResolution;
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 aces(vec3 c) { return saturate(ACESOut * RRTAndODTFit(ACESIn * c)); }
vec3 linearToSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 col = texture(uColor, vUv).rgb;
  if (uBloomOn > 0.5) col = mix(col, texture(uBloom, vUv).rgb, uBloomStrength);
  float expo = texture(uExposure, vec2(0.5)).r;
  if (uLocal > 0.0) {
    vec2 g = textureLod(uLogLum, vec2(0.5), 20.0).rg;
    float globalLog = g.x / max(g.y, 1e-4);
    vec2 l = textureLod(uLogLum, vUv, uLogLevel).rg;
    float localLog = l.x / max(l.y, 1e-4);
    expo *= exp2(clamp(-(localLog - globalLog) * uLocal, -2.0, 2.0));
  }
  col *= expo * uWB;
  col = aces(col * 1.05);
  vec2 c = vUv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.35, 0.9, length(c));
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

class Composite {
  constructor() { this.name = 'composite'; this.sharpness = 0.5; this.vignette = 0.3; this.grain = 0.02; this.local = 0.5; this.wb = [1, 1, 1]; }
  init(r) { this.prog = postProgram(r.gl, COMPOSITE_FS, {}, 'composite'); this.rcas = postProgram(r.gl, RCAS_FS, {}, 'rcas'); }
  resize(r) { if (!this.ldr) this.ldr = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba8' }] }); else this.ldr.resize(r.displayW, r.displayH); }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    this.ldr.bind();
    this.prog.use().set('uColor', color).set('uBloom', r.bloomTex ?? color).set('uBloomOn', r.bloomTex ? 1 : 0).set('uBloomStrength', r.pass('bloom')?.strength ?? 0)
      .set('uExposure', r.exposureTex).set('uTime', r.time).set('uVignette', this.vignette).set('uGrain', this.grain).set('uResolution', [r.displayW, r.displayH])
      .set('uLogLum', r.pass('exposure')?.log?.tex ?? r.exposureTex).set('uLocal', r.pass('exposure')?.log ? this.local : 0).set('uLogLevel', 4.5)
      .set('uWB', this.wb);
    fullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    this.rcas.use().set('uSrc', this.ldr.tex).set('uSharpness', this.sharpness);
    fullscreen(gl);
    return color;
  }
}

// ---------------------------------------------------------------------------------------------

export class FleetStage {
  constructor(canvas, { quality = 'high', sea }) {
    this.quality = quality;
    this.sea = sea;
    const r = (this.r = new Renderer(canvas, { quality }));
    patchGeometry(r);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(66, innerWidth / innerHeight, 0.05, 20000);
    this.origin = { x: 0, z: 0 };                   // world = sea coordinates - origin (y is never shifted)
    this.anchored = new Set();
    r.shadows.distance = 140;
    r.contactShadowLength = 0.2;
    r.envIntensity = 1.0;

    this.screen = r.addPass(new ScreenSpace());
    this.fog = r.addPass(new WaterFog(this));
    this.dof = r.addPass(new DOF());
    this.dof.amount = 0;
    this.taa = r.addPass(new TAA());
    r.addPass(new Upscale());
    this.motionBlur = r.addPass(new MotionBlur());
    this.surface = r.addPass(new Surface(this));
    this.particles = r.addPass(new Particles(this));
    this.acrylic = r.addPass(new Acrylic(this));
    this.exposure = r.addPass(new Exposure());
    this.exposure.minEV = -9; this.exposure.maxEV = 7; this.exposure.key = 0.16;
    this.bloom = r.addPass(new Bloom());
    this.composite = r.addPass(new Composite());
    this.debugDraw = r.addPass(new DebugDraw());
    const dbg = new URLSearchParams(location.search).get('debug');
    if (dbg) r.addPass(new Debug(dbg));
    this._applyQuality();

    const gl = r.gl;
    r.lighting = postProgram(gl, patchLighting(LIGHTING_FS), {}, 'lighting');
    r.env.skyProg = postProgram(gl, SKY_CUBE_FS, {}, 'sky-cube');
    this.skyLUT = new SkyLUT(gl);
    // trade-wind cumulus over a clear tropical sky
    this.sky = { mieExt: 2.2e-5, clouds: [0.28, 0, 1.05, 0], overcast: [0.3, 0.32, 0.36], sunDisc: [0, 0, 0], drift: [-6, 2] };
    const baseSky = r.skyUniforms.bind(r);
    r.skyUniforms = () => ({
      ...baseSky(), uSkyLUT: this.skyLUT.tex, uClouds: this.sky.clouds, uSunDisc: this.sky.sunDisc,
      uOvercast: this.sky.overcast, uCloudDrift: this.sky.drift,
    });
    r.vsm = { bind: (L) => this._bindLighting(L) };

    // the boat's spaces and the lamps (set each frame by the boat renderer)
    this.boatInv = new Matrix4();
    this.boatMat = new Matrix4();
    const ct = CONNING_TOWER;
    this.U = {
      hull: [HULL.axisY, R_IN, COMPARTMENTS[0].x0, COMPARTMENTS[COMPARTMENTS.length - 1].x1],
      ct: [ct.x0, ct.x1, ct.kg * FT, ct.innerDia / 2],
      obs: [OBS_DECK.x, OBS_DECK.axisY, OBS_DECK.rIn, OBS_DECK.length / 2],
      trunk: [HATCHES.find((h) => h.id === 'galley').x, HULL.axisY, OBS_DECK.axisY - OBS_DECK.rIn + 0.3, 0.42],
      comp: new Float32Array(NCOMP * 4), compCol: new Float32Array(NCOMP * 4),
      lampY: [DECK + 2.12, LEVELS.pump.y + 2.0, LEVELS.ct.y + 1.95, DECK],
      sea: [0, 1, 0, 1.333], waterRad: [0, 0, 0], skyDown: [0, 0, 0],
    };
    for (let k = 0; k < NCOMP; k++) this.setLamps(k, { power: 0.0055, color: [1, 0.86, 0.68], fill: 0.55, spacing: 2.3 });
    window.med = r;
    window.stage = this;
    window.addEventListener('resize', () => this.resize());
  }

  /** The lamps of one space: intensity (engine units, ~0.0055 for a row of shaded 60 W bulbs), colour, fill. */
  setLamps(k, { power, color, fill, spacing }) {
    const id = COMP_IDS[k];
    let x0, x1;
    if (id === 'ct') { x0 = CONNING_TOWER.x0; x1 = CONNING_TOWER.x1; } else if (id === 'pump') { x0 = LEVELS.pump.x1; x1 = LEVELS.pump.x0; } else { const c = COMPARTMENTS.find((q) => q.id === id); x0 = c.x0; x1 = c.x1; }
    const U = this.U;
    U.comp.set([x0, x1, spacing ?? U.comp[k * 4 + 2] ?? 2.3, power ?? U.comp[k * 4 + 3]], k * 4);
    U.compCol.set([...(color ?? [U.compCol[k * 4], U.compCol[k * 4 + 1], U.compCol[k * 4 + 2]]), fill ?? U.compCol[k * 4 + 3]], k * 4);
  }
  static compIndex(id) { return COMP_IDS.indexOf(id); }

  _applyQuality() {
    const q = this.r.q;
    this.motionBlur.enabled = q.motionBlur;
    this.bloom.enabled = q.bloom;
    this.taa.enabled = true;
    this.dof.enabled = q.dof;
  }
  setQuality(q) { this.quality = q; this.r.setQuality(q); this._applyQuality(); this.taa.reset = true; }
  resize() { this.r.resize(); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  _bindLighting(L) {
    const U = this.U;
    L.set('uBoatInv', this.boatInv).set('uHull', U.hull).set('uCT', U.ct).set('uObs', U.obs).set('uTrunk', U.trunk)
      .set('uComp', U.comp).set('uCompCol', U.compCol).set('uLampY', U.lampY).set('uSea', U.sea)
      .set('uKd', WATER.Kd).set('uWaterRad', U.waterRad).set('uSkyDown', U.skyDown);
  }

  /** Sets where the boat is (its group's world matrix, boat coordinates y above the keel). */
  setBoat(matrixWorld) {
    this.boatMat.copy(matrixWorld);
    this.boatInv.copy(matrixWorld).invert();
  }

  // ---- the floating origin ------------------------------------------------------------------
  anchor(obj, X, Y, Z) { obj.userData.anchor = { X, Y, Z }; this.anchored.add(obj); this._place(obj); return obj; }
  _place(obj) { const a = obj.userData.anchor; obj.position.set(a.X - this.origin.x, a.Y, a.Z - this.origin.z); }
  toWorld(X, Y, Z, out = new Vector3()) { return out.set(X - this.origin.x, Y, Z - this.origin.z); }
  recentre(X, Z, limit = 300) {
    const o = this.origin;
    if (Math.abs(X - o.x) < limit && Math.abs(Z - o.z) < limit) return false;
    o.x = Math.round(X); o.z = Math.round(Z);
    for (const obj of this.anchored) this._place(obj);
    this.taa.reset = true;
    return true;
  }

  // ---- the sun -------------------------------------------------------------------------------
  /** Puts the sun where it is at this UTC time (ms) over the place, and lights the sky and the sea for it. */
  setTime(ms) {
    const pos = sunPosition(ms, PLACE.lat, PLACE.lon);
    const v = sunVector(pos);
    this.sunPos = pos;
    const key = Math.round(pos.azimuth * 10) + ':' + Math.round(pos.elevation * 10);
    if (key !== this._sunKey) {
      this._sunKey = key;
      const r = this.r;
      r.sunDir.set(v.x, v.y, v.z);
      const T = sunTransmittance(v, 10, this.sky.mieExt);
      const c = this.sky.clouds, cloudT = Math.max(0, 1 - c[1]) * (1 - 0.25 * c[0]);
      r.sunColor.set(T[0], T[1], T[2]);
      r.sunIntensity = SUN_E0 * cloudT;
      this.sky.sunDisc = [T[0] * SUN_E0 * cloudT * 3000, T[1] * SUN_E0 * cloudT * 3000, T[2] * SUN_E0 * cloudT * 3000];
      const ghi = SUN_E0 * Math.max(0, v.y) * (T[0] + T[1] + T[2]) / 3 + 0.6;
      const lz = (ghi * 0.35) / 2.44;
      this.sky.overcast = [lz * 0.94, lz * 0.97, lz * 1.02];
      this.skyLUT.update({ sunDir: v, altitude: 10, mieExt: this.sky.mieExt, groundAlbedo: 0.06 });
      r.invalidateEnvironment();
      this._seaLight(v, T, cloudT);
    }
  }

  /** The light in the sea: what comes down through the surface, and the water's own glow. */
  _seaLight(v, T, cloudT) {
    const U = this.U, E0 = SUN_E0 * cloudT;
    const sunY = Math.max(0, v.y);
    // the sky's own irradiance on a level surface (clear tropical sky: ~15 % of the beam's at this sun), less the surface's reflection
    const sky = [0.16, 0.2, 0.28].map((k, i) => k * E0 * Math.max(0.04, sunY) * (0.6 + 0.4 * T[i]));
    // under the surface the sun's beam scattered forward joins the diffuse light
    U.skyDown = sky.map((s, i) => (s * 0.93 + E0 * T[i] * sunY * 0.12));
    // the water's radiance: sunlight scattered back by the water (b_b / (Kd + b_b) of what comes down, over pi)
    U.waterRad = [0, 1, 2].map((i) => (E0 * T[i] * sunY + sky[i]) * WATER.bb[i] / (WATER.Kd[i] + WATER.bb[i]) / Math.PI * 1.6);
  }

  /**
   * The eye's colour adaptation (von Kries): under water, or looking out of the observation deck,
   * the light is the water's blue-green, and the eye takes about half of it out again.
   * looking: 0 inside the hull (lamplight), 1 with the sea filling the view.
   */
  adapt(looking, dt) {
    const y = this.camera.position.y;
    const d = Math.max(0, -y) + 2;
    const amb = WATER.Kd.map((k, i) => Math.exp(-k * d) * [0.75, 0.95, 1.2][i]);
    const lum = 0.2126 * amb[0] + 0.7152 * amb[1] + 0.0722 * amb[2];
    const k = 0.55 * looking * (y < 0.5 ? 1 : 0);
    const want = amb.map((a) => Math.pow(lum / Math.max(a, 1e-3), k));
    const s = 0.2126 * want[0] + 0.7152 * want[1] + 0.0722 * want[2];
    const wb = this.composite.wb, f = Math.min(1, dt * 1.5);
    for (let i = 0; i < 3; i++) wb[i] += (Math.min(4, want[i] / s) - wb[i]) * f;
  }

  render(dt) {
    this.U.sea[2] = this.sea.time;
    this.r.render(this.scene, this.camera, dt);
  }
}

export { COMP_IDS, WATER };
