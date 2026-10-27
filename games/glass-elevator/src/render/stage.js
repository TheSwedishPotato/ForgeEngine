/**
 * The game's stage on the Med Engine (Zweikampf 1403's renderer, imported read-only, set up the
 * way Gotthard Pullman and Fleet Boat set it up): the deferred PBR renderer with its shadow
 * cascades, screen-space occlusion, bounce light and reflections, temporal upscaling, auto
 * exposure and bloom; and what a glass elevator on a tower needs on top, added through the
 * engine's own hooks without changing it:
 *
 *  - the sky over Stockholm on 27 October 2026 (Gotthard's sky.js and sun.js): a low autumn sun,
 *    16 degrees at noon, setting before five;
 *  - indoors (the tower's lift lobbies and the machine room on the roof) no daylight: the
 *    ceiling lights and the light the walls throw back, and the engine's point lights for the
 *    lamps near you;
 *  - the glass: the car's three laminated walls and its glass door, the screens round the pit,
 *    drawn over the finished image (passes after the upscale) with their Fresnel reflections.
 *
 * World axes as in the engine: X east, Y up (0 at the lobby floor), Z south.
 */
import { Scene, PerspectiveCamera, PointLight } from 'three';
import { Renderer } from '../../../duel1403/src/engine/Renderer.js';
import { ScreenSpace } from '../../../duel1403/src/engine/passes/ScreenSpace.js';
import { MotionBlur } from '../../../duel1403/src/engine/passes/Cinematic.js';
import { TAA, Upscale } from '../../../duel1403/src/engine/passes/TAA.js';
import { Exposure, Bloom } from '../../../duel1403/src/engine/passes/Post.js';
import { LIGHTING_FS } from '../../../duel1403/src/engine/shaders/lighting.js';
import { COMMON, SKY } from '../../../duel1403/src/engine/shaders/common.js';
import { CUBE_DIR } from '../../../duel1403/src/engine/passes/Environment.js';
import { Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { SKY_GLSL, SkyLUT, sunTransmittance, SUN_E0 } from '../../../gotthard-pullman/src/render/sky.js';
import { sunPosition, sunVector } from '../../../gotthard-pullman/src/render/sun.js';
import { TOWER, ROOF_Y, MR, PLACE } from '../data/spec.js';
import { Glass } from './glass.js';

const INDOOR_GLSL = /* glsl */`
uniform vec4 uTower;          // the tower's inside: x0, x1, z0, z1
uniform vec2 uTowerY;         // its floor and roof
uniform vec3 uMR0, uMR1;      // the machine room
uniform vec3 uIndoorE;        // ceiling lights: irradiance on a level surface
uniform vec3 uMachineE;
int indoor(vec3 p) {
  if (p.x > uTower.x && p.x < uTower.y && p.z > uTower.z && p.z < uTower.w && p.y > uTowerY.x && p.y < uTowerY.y) return 1;
  if (p.x > uMR0.x && p.x < uMR1.x && p.y > uMR0.y && p.y < uMR1.y && p.z > uMR0.z && p.z < uMR1.z) return 2;
  return 0;
}
vec3 indoorLight(int k, vec3 N) {
  // panels in the ceiling: most light from above, the rest thrown back by the floor and walls
  float up = 0.5 + 0.5 * N.y;
  return (k == 2 ? uMachineE : uIndoorE) * (0.3 + 0.7 * up * up);
}
`;

function replaceOnce(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(`lighting patch: "${a.slice(0, 60)}" not found`);
  return src.slice(0, i) + b + src.slice(i + a.length);
}

export function patchLighting(src) {
  let s = replaceOnce(src, SKY, SKY_GLSL + INDOOR_GLSL);
  s = replaceOnce(s, 'vec3 L = uSunDir;', 'int region = indoor(wpos + N * 0.06);\n  vec3 L = uSunDir;');
  s = replaceOnce(s, 'float vis = uShadowsOn > 0.5 ? sunShadow(wpos, N, viewDepth, rot) : 1.0;',
    'float vis = region > 0 ? 0.0 : (uShadowsOn > 0.5 ? sunShadow(wpos, N, viewDepth, rot) : 1.0);');
  s = replaceOnce(s, 'vec3 E = irradianceAt(wpos, N);', 'vec3 E = region > 0 ? indoorLight(region, N) : irradianceAt(wpos, N);');
  s = replaceOnce(s, 'vec3 envL = textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity;',
    'vec3 envL = region > 0 ? E * INV_PI * (0.6 + 0.6 * max(R.y, 0.0)) : textureLod(uEnvSpec, R, rough * (uEnvLevels - 1.0)).rgb * uEnvIntensity;');
  s = replaceOnce(s, 'vec3 coatRefl = mix(textureLod(uEnvSpec, reflect(-V, N), 0.6).rgb * uEnvIntensity, ssr.rgb, ssr.a);',
    'vec3 coatRefl = mix(region > 0 ? E * INV_PI : textureLod(uEnvSpec, reflect(-V, N), 0.6).rgb * uEnvIntensity, ssr.rgb, ssr.a);');
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
// The final image: exposure, ACES, vignette, grain, sharpening (as Gotthard's and Fleet Boat's)

const COMPOSITE_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uBloom, uExposure, uLogLum;
uniform float uBloomOn, uBloomStrength, uTime, uVignette, uGrain, uLocal, uLogLevel;
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
  col = aces(col * expo * 1.05);
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
  constructor() { this.name = 'composite'; this.sharpness = 0.5; this.vignette = 0.25; this.grain = 0.015; this.local = 0.45; }
  init(r) { this.prog = postProgram(r.gl, COMPOSITE_FS, {}, 'composite'); this.rcas = postProgram(r.gl, RCAS_FS, {}, 'rcas'); }
  resize(r) { if (!this.ldr) this.ldr = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba8' }] }); else this.ldr.resize(r.displayW, r.displayH); }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    this.ldr.bind();
    this.prog.use().set('uColor', color).set('uBloom', r.bloomTex ?? color).set('uBloomOn', r.bloomTex ? 1 : 0).set('uBloomStrength', r.pass('bloom')?.strength ?? 0)
      .set('uExposure', r.exposureTex).set('uTime', r.time).set('uVignette', this.vignette).set('uGrain', this.grain).set('uResolution', [r.displayW, r.displayH])
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

export class Stage {
  constructor(canvas, { quality = 'high' } = {}) {
    this.quality = quality;
    const r = (this.r = new Renderer(canvas, { quality }));
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(70, innerWidth / innerHeight, 0.04, 9000);
    r.shadows.distance = 120;
    r.contactShadowLength = 0.15;
    r.envIntensity = 1.0;
    this.screen = r.addPass(new ScreenSpace());
    this.taa = r.addPass(new TAA());
    r.addPass(new Upscale());
    this.motionBlur = r.addPass(new MotionBlur());
    this.motionBlur.shutter = 0.35;
    this.glass = r.addPass(new Glass(this));
    this.exposure = r.addPass(new Exposure());
    this.exposure.minEV = -9; this.exposure.maxEV = 7; this.exposure.key = 0.16;
    this.bloom = r.addPass(new Bloom());
    this.composite = r.addPass(new Composite());
    this._applyQuality();

    const gl = r.gl;
    r.lighting = postProgram(gl, patchLighting(LIGHTING_FS), {}, 'lighting');
    r.env.skyProg = postProgram(gl, SKY_CUBE_FS, {}, 'sky-cube');
    this.skyLUT = new SkyLUT(gl);
    // a fair autumn afternoon: high cirrus and some fair-weather cumulus over the Baltic
    this.sky = { mieExt: 1.8e-5, clouds: [0.32, 0, 1.0, 0], overcast: [0.3, 0.32, 0.36], sunDisc: [0, 0, 0], drift: [-5, 1.5] };
    const baseSky = r.skyUniforms.bind(r);
    r.skyUniforms = () => ({ ...baseSky(), uSkyLUT: this.skyLUT.tex, uClouds: this.sky.clouds, uSunDisc: this.sky.sunDisc, uOvercast: this.sky.overcast, uCloudDrift: this.sky.drift });
    this.U = {
      tower: [TOWER.x0 + 0.02, TOWER.x1 - 0.02, TOWER.z0 + 0.02, TOWER.z1 - 0.02], towerY: [-0.4, ROOF_Y],
      mr0: [MR.x0, MR.floor - 0.6, MR.z0], mr1: [MR.x1, MR.floor + MR.h, MR.z1],
      indoorE: [0.05, 0.047, 0.042], machineE: [0.045, 0.046, 0.05],
    };
    r.vsm = { bind: (L) => L.set('uTower', this.U.tower).set('uTowerY', this.U.towerY).set('uMR0', this.U.mr0).set('uMR1', this.U.mr1).set('uIndoorE', this.U.indoorE).set('uMachineE', this.U.machineE) };
    // eight lamps the engine lights with: placed each frame where you are (the car's downlights, the lobby's)
    this.lamps = [];
    for (let i = 0; i < 8; i++) { const l = new PointLight(0xfff1dd, 0, 6); l.visible = false; this.scene.add(l); this.lamps.push(l); }
    window.med = r;
    window.addEventListener('resize', () => this.resize());
  }

  _applyQuality() {
    const q = this.r.q;
    this.motionBlur.enabled = q.motionBlur;
    this.bloom.enabled = q.bloom;
    this.taa.enabled = true;
  }
  setQuality(q) { this.quality = q; this.r.setQuality(q); this._applyQuality(); this.taa.reset = true; }
  resize() { this.r.resize(); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  /** Puts the sun where it is at this UTC time (ms) over Stockholm, and lights the sky for it. */
  setTime(ms) {
    const pos = sunPosition(ms, PLACE.lat, PLACE.lon);
    const v = sunVector(pos);
    this.sunPos = pos;
    const key = Math.round(pos.azimuth * 10) + ':' + Math.round(pos.elevation * 10);
    if (key === this._sunKey) return;
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
    this.skyLUT.update({ sunDir: v, altitude: 30, mieExt: this.sky.mieExt, groundAlbedo: 0.12 });
    r.invalidateEnvironment();
  }

  /** Places the lamps the engine lights with: [{ pos: [x,y,z], power, range, color }] (at most 8). */
  setLamps(list) {
    for (let i = 0; i < 8; i++) {
      const l = this.lamps[i], s = list[i];
      l.visible = !!s;
      if (!s) continue;
      l.position.set(s.pos[0], s.pos[1], s.pos[2]);
      l.intensity = s.power; l.distance = s.range ?? 6;
      if (s.color) l.color.setRGB(s.color[0], s.color[1], s.color[2]);
    }
  }

  render(dt) { this.r.render(this.scene, this.camera, dt); }
}
