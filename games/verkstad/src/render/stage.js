/**
 * The workshop on the Med Engine (Zweikampf 1403's deferred renderer, imported read-only, set up the
 * way Glass Elevator sets it up): PBR with shadow cascades, screen-space occlusion, bounce light and
 * reflections, temporal upscaling, auto exposure and bloom.
 *
 * The light: inside the hall, the LED panels in the ceiling (as irradiance from above and what the
 * floor and walls throw back, Glass Elevator's indoor lighting patch with the hall as its box) and
 * the engine's eight point lights placed where you are; through the open door the autumn daylight
 * over Gothenburg on Monday 2 November 2026 (Gotthard Pullman's sky and sun for 57.7° N).
 *
 * World axes as in the engine: X east, Y up (0 the workshop floor), Z south.
 */
import { Scene, PerspectiveCamera, PointLight } from 'three';
import { Renderer } from '../../../duel1403/src/engine/Renderer.js';
import { ScreenSpace } from '../../../duel1403/src/engine/passes/ScreenSpace.js';
import { TAA, Upscale } from '../../../duel1403/src/engine/passes/TAA.js';
import { Exposure, Bloom } from '../../../duel1403/src/engine/passes/Post.js';
import { LIGHTING_FS } from '../../../duel1403/src/engine/shaders/lighting.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';
import { CUBE_DIR } from '../../../duel1403/src/engine/passes/Environment.js';
import { Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { SKY_GLSL, SkyLUT, sunTransmittance, SUN_E0 } from '../../../gotthard-pullman/src/render/sky.js';
import { sunPosition, sunVector } from '../../../gotthard-pullman/src/render/sun.js';
import { patchLighting } from '../../../glass-elevator/src/render/stage.js';

export const PLACE = { lat: 57.721, lon: 11.94, name: 'Hisingen, Göteborg' };
export const HALL = { x0: -9, x1: 9, z0: -7, z1: 7, h: 5.2 };

const SKY_CUBE_FS = /* glsl */`
${COMMON}
${SKY_GLSL}
${CUBE_DIR}
in vec2 vUv;
uniform int uFace;
out vec4 o;
void main() { o = vec4(skyRadiance(cubeDir(uFace, vUv), false), 1.0); }`;

const COMPOSITE_FS = /* glsl */`
${COMMON}
in vec2 vUv; out vec4 o;
uniform sampler2D uColor, uBloom, uExposure;
uniform float uBloomOn, uBloomStrength, uTime, uVignette, uGrain;
uniform vec2 uResolution;
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 aces(vec3 c) { return saturate(ACESOut * RRTAndODTFit(ACESIn * c)); }
vec3 linearToSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 col = texture(uColor, vUv).rgb;
  if (uBloomOn > 0.5) col = mix(col, texture(uBloom, vUv).rgb, uBloomStrength);
  col = aces(col * texture(uExposure, vec2(0.5)).r * 1.05);
  col *= 1.0 - uVignette * smoothstep(0.35, 0.9, length(vUv - 0.5));
  col = linearToSRGB(saturate(col));
  col += (hash12(vUv * uResolution + fract(uTime * 7.13) * 431.0) - 0.5) * uGrain;
  o = vec4(col, 1.0);
}`;

class Composite {
  constructor() { this.name = 'composite'; this.vignette = 0.22; this.grain = 0.012; }
  init(r) { this.prog = postProgram(r.gl, COMPOSITE_FS, {}, 'composite'); }
  afterLighting(r, color) {
    const gl = r.gl;
    state(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    this.prog.use().set('uColor', color).set('uBloom', r.bloomTex ?? color).set('uBloomOn', r.bloomTex ? 1 : 0).set('uBloomStrength', r.pass('bloom')?.strength ?? 0)
      .set('uExposure', r.exposureTex).set('uTime', r.time).set('uVignette', this.vignette).set('uGrain', this.grain).set('uResolution', [r.displayW, r.displayH]);
    fullscreen(gl);
    return color;
  }
}
void Target;

export class Stage {
  constructor(canvas, { quality = 'high' } = {}) {
    this.quality = quality;
    const r = (this.r = new Renderer(canvas, { quality }));
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 2000);
    r.shadows.distance = 40;
    r.contactShadowLength = 0.1;
    r.envIntensity = 0.8;
    this.screen = r.addPass(new ScreenSpace());
    this.taa = r.addPass(new TAA());
    r.addPass(new Upscale());
    this.exposure = r.addPass(new Exposure());
    this.exposure.minEV = -9; this.exposure.maxEV = 7; this.exposure.key = 0.15;
    this.bloom = r.addPass(new Bloom());
    this.composite = r.addPass(new Composite());
    this.bloom.enabled = r.q.bloom;
    const gl = r.gl;
    r.lighting = postProgram(gl, patchLighting(LIGHTING_FS), {}, 'lighting');
    r.env.skyProg = postProgram(gl, SKY_CUBE_FS, {}, 'sky-cube');
    this.skyLUT = new SkyLUT(gl);
    // a grey November day on the west coast: low stratocumulus, a pale sun through it now and then
    this.sky = { mieExt: 2.4e-5, clouds: [0.75, 0.25, 1.0, 0], overcast: [0.3, 0.32, 0.36], sunDisc: [0, 0, 0], drift: [-6, 2] };
    const baseSky = r.skyUniforms.bind(r);
    r.skyUniforms = () => ({ ...baseSky(), uSkyLUT: this.skyLUT.tex, uClouds: this.sky.clouds, uSunDisc: this.sky.sunDisc, uOvercast: this.sky.overcast, uCloudDrift: this.sky.drift });
    // the hall is Glass Elevator's "tower" (lit from its ceiling); its machine room is put out of the way
    this.U = { tower: [HALL.x0 + 0.05, HALL.x1 - 0.05, HALL.z0 + 0.05, HALL.z1 - 0.05], towerY: [-1.6, HALL.h], indoorE: [0.05, 0.048, 0.045] };
    r.vsm = { bind: (L) => L.set('uTower', this.U.tower).set('uTowerY', this.U.towerY).set('uMR0', [1e5, 1e5, 1e5]).set('uMR1', [1e5 + 1, 1e5 + 1, 1e5 + 1]).set('uIndoorE', this.U.indoorE).set('uMachineE', this.U.indoorE) };
    this.lamps = [];
    for (let i = 0; i < 8; i++) { const l = new PointLight(0xfff4e8, 0, 7); l.visible = false; this.scene.add(l); this.lamps.push(l); }
    window.med = r;
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) { this.quality = q; this.r.setQuality(q); this.bloom.enabled = this.r.q.bloom; this.taa.reset = true; }
  resize() { this.r.resize(); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  /** Puts the sun where it is at this UTC time (ms) over Gothenburg. */
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

  setLamps(list) {
    for (let i = 0; i < 8; i++) {
      const l = this.lamps[i], s = list[i];
      l.visible = !!s;
      if (!s) continue;
      l.position.set(s.pos[0], s.pos[1], s.pos[2]);
      l.intensity = s.power; l.distance = s.range ?? 7;
      if (s.color) l.color.setRGB(s.color[0], s.color[1], s.color[2]);
    }
  }

  render(dt) { this.r.render(this.scene, this.camera, dt); }
}
