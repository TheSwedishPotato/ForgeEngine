/**
 * Mountain shadows and the open sky, for the whole map, computed on the GPU.
 *
 * For every 25 m cell of the map (and every 100 m cell of the ring round it) a ray is
 * marched toward the sun over the heights, out to 14 km, with the earth's curvature
 * (less a seventh for refraction). It stores the lowest height at which a point in that
 * cell still sees the sun ("shadow top") and how far off the mountain is that hides it
 * below that. Any point (the ground, a car roof, a bridge deck, a puff of steam) is then in
 * sunshine if it is above the shadow top; the edge is softened by the sun's own disc (half
 * a degree: 9.3 m of penumbra per km to the ridge). The shadows of the ridges move across
 * the valley with the sun.
 *
 * The sky view factor (how much of the sky a level patch of ground sees past the mountains:
 * 1 - mean sin^2 of the horizon elevation over 16 directions) dims the sky light in the
 * gorge.
 */
import { Texture, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

/** Lookups for any shader (needs COMMON). Declares uOrigin, the floating origin (map x, map y, height). */
export const TERRAIN_LIGHT_GLSL = /* glsl */`
uniform highp sampler2D uTLMap, uTLFar, uTLSvf;
uniform vec4 uTLMapRect;     // x0, y0, step, -
uniform ivec2 uTLMapSize;
uniform vec4 uTLFarRect;
uniform ivec2 uTLFarSize;
uniform vec4 uTLSvfRect;
uniform ivec2 uTLSvfSize;
uniform vec3 uOrigin;
uniform float uTLOn;
vec4 tlBilinear(highp sampler2D t, ivec2 size, vec4 rect, vec2 m) {
  vec2 f = (m - rect.xy) / rect.z;
  f = clamp(f, vec2(0.0), vec2(size - 1) - 0.001);
  ivec2 i = ivec2(floor(f)); vec2 w = f - vec2(i);
  vec4 a = texelFetch(t, i, 0), b = texelFetch(t, min(i + ivec2(1, 0), size - 1), 0);
  vec4 c = texelFetch(t, min(i + ivec2(0, 1), size - 1), 0), d = texelFetch(t, min(i + 1, size - 1), 0);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
bool tlInMap(vec2 m) {
  vec2 hi = uTLMapRect.xy + vec2(uTLMapSize - 1) * uTLMapRect.z;
  return all(greaterThanEqual(m, uTLMapRect.xy)) && all(lessThanEqual(m, hi));
}
/** x: shadow top (m), y: distance to the hiding ridge (m), z: ground height (m). */
vec4 terrainLightAt(vec2 m) {
  return tlInMap(m) ? tlBilinear(uTLMap, uTLMapSize, uTLMapRect, m) : tlBilinear(uTLFar, uTLFarSize, uTLFarRect, m);
}
/** Sun visibility past the mountains for a world point (floating-origin coordinates). */
float terrainSun(vec3 wpos) {
  if (uTLOn < 0.5) return 1.0;
  vec2 m = vec2(wpos.x + uOrigin.x, -wpos.z + uOrigin.y);
  float h = wpos.y + uOrigin.z;
  vec4 L = terrainLightAt(m);
  float w = 1.5 + L.y * 0.00466;
  return smoothstep(-w, w, h - L.x);
}
/** Sky view factor past the mountains, rising toward 1 above the ground. */
float terrainSvf(vec3 wpos) {
  if (uTLOn < 0.5) return 1.0;
  vec2 m = vec2(wpos.x + uOrigin.x, -wpos.z + uOrigin.y);
  float h = wpos.y + uOrigin.z;
  vec2 f = (m - uTLSvfRect.xy) / uTLSvfRect.z;
  if (any(lessThan(f, vec2(0.0))) || any(greaterThan(f, vec2(uTLSvfSize - 1)))) return 0.85;
  vec4 s = tlBilinear(uTLSvf, uTLSvfSize, uTLSvfRect, m);
  return mix(s.x, 1.0, clamp((h - s.y - 3.0) / 400.0, 0.0, 1.0));
}
`;

const HEIGHTS_GLSL = /* glsl */`
uniform highp sampler2D uMapH, uFarH;
uniform vec4 uMapHRect; uniform ivec2 uMapHSize;
uniform vec4 uFarHRect; uniform ivec2 uFarHSize;
float hBil(highp sampler2D t, ivec2 size, vec4 rect, vec2 m) {
  vec2 f = clamp((m - rect.xy) / rect.z, vec2(0.0), vec2(size - 1) - 0.001);
  ivec2 i = ivec2(floor(f)); vec2 w = f - vec2(i);
  float a = texelFetch(t, i, 0).r, b = texelFetch(t, i + ivec2(1, 0), 0).r, c = texelFetch(t, i + ivec2(0, 1), 0).r, d = texelFetch(t, i + 1, 0).r;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
bool inMapH(vec2 m) { vec2 hi = uMapHRect.xy + vec2(uMapHSize - 1) * uMapHRect.z; return all(greaterThanEqual(m, uMapHRect.xy)) && all(lessThanEqual(m, hi)); }
float heightAt(vec2 m) { return inMapH(m) ? hBil(uMapH, uMapHSize, uMapHRect, m) : hBil(uFarH, uFarHSize, uFarHRect, m); }
`;

const SHADOW_FS = /* glsl */`
${COMMON}
${HEIGHTS_GLSL}
in vec2 vUv; out vec4 o;
uniform vec4 uOut;            // the output grid: x0, y0, step
uniform vec3 uSunDir;         // world: x east, y up, z south
uniform float uMaxDist;
void main() {
  vec2 m = uOut.xy + floor(gl_FragCoord.xy) * uOut.z;
  float h0 = heightAt(m);
  float horiz = length(uSunDir.xz);
  vec2 dir = horiz > 1e-5 ? vec2(uSunDir.x, -uSunDir.z) / horiz : vec2(0.0, 1.0);
  float tanS = uSunDir.y / max(horiz, 1e-5);
  const float CURV = 1.0 / (2.0 * 6371000.0 / (1.0 - 0.13));   // earth curvature less refraction
  float top = h0 - 1e4, dTop = 0.0;
  for (int k = 1; k <= 150; k++) {
    float d = 20.0 + 6.0 * pow(float(k), 1.55);
    if (d > uMaxDist) break;
    float t = heightAt(m + dir * d) - d * tanS - d * d * CURV;
    if (t > top) { top = t; dTop = d; }
  }
  o = vec4(top, dTop, h0, 1.0);
}`;

const SVF_FS = /* glsl */`
${COMMON}
${HEIGHTS_GLSL}
in vec2 vUv; out vec4 o;
uniform vec4 uOut;
void main() {
  vec2 m = uOut.xy + floor(gl_FragCoord.xy) * uOut.z;
  float h0 = heightAt(m) + 1.5;
  float svf = 0.0;
  for (int a = 0; a < 16; a++) {
    float ang = (float(a) + 0.5) / 16.0 * TAU;
    vec2 dir = vec2(cos(ang), sin(ang));
    float mt = 0.0;
    for (int k = 1; k <= 36; k++) {
      float d = 15.0 + 5.0 * float(k * k);
      mt = max(mt, (heightAt(m + dir * d) - h0) / d);
    }
    svf += 1.0 / (1.0 + mt * mt);
  }
  o = vec4(svf / 16.0, h0 - 1.5, 0.0, 1.0);
}`;

export class TerrainLight {
  constructor(stage, terrain) {
    this.stage = stage;
    const gl = (this.gl = stage.r.gl);
    const T = (this.T = terrain), F = T.far;
    this.mapH = new Texture(gl, { width: T.w, height: T.h, format: 'r32f', filter: 'nearest', data: T.H });
    this.farH = new Texture(gl, { width: F.w, height: F.h, format: 'r32f', filter: 'nearest', data: F.H });
    const mk = (w, h) => new Target(gl, { width: w, height: h, colors: [{ format: 'rgba32f', filter: 'nearest' }] });
    // light maps: the map at 25 m, the ring at 100 m; two of each so a new one can be built over several frames
    this.map = [mk(T.w, T.h), mk(T.w, T.h)];
    this.far = [mk(F.w, F.h), mk(F.w, F.h)];
    this.cur = 0;
    this.mapRect = [T.x0, T.y0, T.step, 0];
    this.farRect = [F.x0, F.y0, F.step, 0];
    const sStep = 50;
    this.svfSize = [Math.floor((T.x1 - T.x0) / sStep) + 1, Math.floor((T.y1 - T.y0) / sStep) + 1];
    this.svfRect = [T.x0, T.y0, sStep, 0];
    this.svf = mk(...this.svfSize);
    this.shadowProg = postProgram(gl, SHADOW_FS, {}, 'terrain-shadow');
    this.svfProg = postProgram(gl, SVF_FS, {}, 'terrain-svf');
    this.job = null;
    this.ready = false;
    this._svfDone = false;
    this.sunDir = null;
  }

  _heights(P) {
    const T = this.T, F = T.far;
    P.set('uMapH', this.mapH).set('uMapHRect', this.mapRect).set('uMapHSize', [T.w, T.h])
      .set('uFarH', this.farH).set('uFarHRect', this.farRect).set('uFarHSize', [F.w, F.h]);
  }

  /** Starts a new shadow computation for this sun (spread over the next frames unless now). */
  update(sunDir, { now = false } = {}) {
    this.sunDir = { x: sunDir.x, y: sunDir.y, z: sunDir.z };
    const back = 1 - this.cur;
    this.job = { back, row: 0, part: 'map', rows: this.T.h, sun: this.sunDir };
    if (now) while (this.job) this.step(1e9);
  }

  /** Does a slice of the pending work (rowsBudget rows of the map grid's worth). */
  step(rowsBudget = 140) {
    const gl = this.gl;
    if (!this._svfDone) {
      this.svf.bind(); state(gl);
      const P = this.svfProg.use(); this._heights(P);
      P.set('uOut', this.svfRect);
      fullscreen(gl);
      this._svfDone = true;
    }
    const J = this.job;
    if (!J) return;
    const T = this.T, F = T.far;
    const target = J.part === 'map' ? this.map[J.back] : this.far[J.back];
    const rows = J.part === 'map' ? T.h : F.h;
    const n = Math.min(rows - J.row, J.part === 'map' ? rowsBudget : Math.ceil(rowsBudget / 2));
    target.bind(); state(gl);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, J.row, target.width, n);
    const P = this.shadowProg.use(); this._heights(P);
    P.set('uOut', J.part === 'map' ? this.mapRect : this.farRect).set('uSunDir', [J.sun.x, J.sun.y, J.sun.z]).set('uMaxDist', J.part === 'map' ? 14000 : 30000);
    fullscreen(gl);
    gl.disable(gl.SCISSOR_TEST);
    J.row += n;
    if (J.row >= rows) {
      if (J.part === 'map') { J.part = 'far'; J.row = 0; } else { this.cur = J.back; this.job = null; this.ready = true; }
    }
  }

  /** Sets the lookup uniforms on a program that includes TERRAIN_LIGHT_GLSL. */
  bind(P, origin) {
    const T = this.T, F = T.far;
    P.set('uTLMap', this.map[this.cur].tex).set('uTLMapRect', this.mapRect).set('uTLMapSize', [T.w, T.h])
      .set('uTLFar', this.far[this.cur].tex).set('uTLFarRect', this.farRect).set('uTLFarSize', [F.w, F.h])
      .set('uTLSvf', this.svf.tex).set('uTLSvfRect', this.svfRect).set('uTLSvfSize', this.svfSize)
      .set('uOrigin', [origin.x, origin.y, origin.z]).set('uTLOn', this.ready ? 1 : 0);
  }
}
