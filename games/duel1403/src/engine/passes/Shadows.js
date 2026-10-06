import { Matrix4, Vector3, Vector4 } from 'three';
import { Texture, Target, state } from '../gl/GL.js';

const _v = new Vector3(), _c = new Vector3(), _up = new Vector3(0, 1, 0), _p = new Vector4();
const _view = new Matrix4(), _proj = new Matrix4(), _inv = new Matrix4();

export const FOCUS = 4;   // the array layer of the focus map

/**
 * Cascaded shadow maps for the sun: practical split scheme, each cascade a
 * bounding sphere of its frustum slice (rotation-invariant size) snapped to
 * whole texels so shadows do not crawl as the camera moves.
 *
 * On top of the cascades, an optional focus map: one more layer fitted
 * tightly around what matters most on screen (`focus`: the fighters, the
 * player and the people beside them). A 2048 map over a 3 m sphere gives
 * texels of about 1.5 mm, ten times finer than the first cascade, so the
 * shadows of a blade, fingers or a hood's edge are sharp where you look.
 * It is the WebGL2 form of the idea behind virtual shadow maps (resolution
 * spent where the screen needs it) without their page tables, which need
 * compute shaders and indirect draws.
 */
export class Shadows {
  constructor(gl, { size = 2048, cascades = 4, distance = 70 } = {}) {
    this.gl = gl;
    this.size = size;
    this.n = cascades;
    this.distance = distance;
    this.layers = cascades + 1;
    this.map = new Texture(gl, { target: 'array', width: size, height: size, depth: this.layers, format: 'depth32f', filter: 'linear', compare: true });
    this.target = new Target(gl, { width: size, height: size, depth: this.map });
    this.matrices = new Float32Array(16 * (cascades + 1));
    this.focus = null;          // {center: Vector3, radius} or null
    this.focusOn = 0;
    this.focusTexel = 0;
    this.focusCascade = { view: new Matrix4(), proj: new Matrix4(), vp: new Matrix4(), center: new Vector3(), radius: 1, texel: 0 };
    this.splits = new Float32Array(4);
    this.texel = new Float32Array(4);   // world size of a texel per cascade
    this.cascades = [];
    for (let i = 0; i < cascades; i++) this.cascades.push({ view: new Matrix4(), proj: new Matrix4(), vp: new Matrix4(), center: new Vector3(), radius: 1 });
  }

  resize(size) {
    if (size === this.size) return;
    this.size = size;
    this.map.alloc(size, size, this.layers);
    this.target.width = this.target.height = size;
  }

  /** Fits the cascades to the camera's view frustum. */
  fit(camera, sunDir) {
    const near = camera.near, far = Math.min(camera.far, this.distance);
    const lambda = 0.78;
    const splits = [near];
    for (let i = 1; i <= this.n; i++) {
      const f = i / this.n;
      splits.push(lambda * near * Math.pow(far / near, f) + (1 - lambda) * (near + (far - near) * f));
    }
    _inv.copy(camera.projectionMatrix).invert();
    const camWorld = camera.matrixWorld;
    for (let i = 0; i < this.n; i++) {
      const c = this.cascades[i];
      const zn = splits[i], zf = splits[i + 1];
      // Corners of the slice in view space, from the projection's inverse at the slice depths.
      const corners = [];
      for (const z of [zn, zf]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
        _p.set(x, y, 0.5, 1).applyMatrix4(_inv);
        _v.set(_p.x / _p.w, _p.y / _p.w, _p.z / _p.w);
        _v.multiplyScalar(z / -_v.z);
        corners.push(_v.clone().applyMatrix4(camWorld));
      }
      _c.set(0, 0, 0);
      for (const p of corners) _c.add(p);
      _c.multiplyScalar(1 / 8);
      let r = 0;
      for (const p of corners) r = Math.max(r, p.distanceTo(_c));
      r = Math.ceil(r * 16) / 16;
      // Snap the centre to the texel grid in light space.
      _view.lookAt(_v.set(0, 0, 0), _v2.copy(sunDir).negate(), Math.abs(sunDir.y) > 0.99 ? _v3.set(1, 0, 0) : _up);
      const texel = (2 * r) / this.size;
      const ls = _c.clone().applyMatrix4(_view.clone().invert());
      ls.x = Math.floor(ls.x / texel) * texel;
      ls.y = Math.floor(ls.y / texel) * texel;
      const centre = ls.applyMatrix4(_view);
      const back = 120;   // casters behind the slice (castle, trees) still cast
      const eye = centre.clone().addScaledVector(sunDir, back);
      c.view.lookAt(eye, centre, Math.abs(sunDir.y) > 0.99 ? _v3.set(1, 0, 0) : _up);
      c.view.setPosition(eye);
      c.view.invert();
      c.proj.makeOrthographic(-r, r, r, -r, 0.1, back + r * 2);
      c.vp.multiplyMatrices(c.proj, c.view);
      c.center.copy(centre); c.radius = r;
      this.matrices.set(c.vp.elements, i * 16);
      this.splits[i] = splits[i + 1];
      this.texel[i] = texel;
      c.texel = texel;
    }
    this._fitFocus(sunDir);
  }

  /** The focus map: a tight ortho box around `focus`, texel-snapped. */
  _fitFocus(sunDir) {
    const f = this.focus;
    this.focusOn = f && f.radius > 0 ? 1 : 0;
    if (!this.focusOn) return;
    const c = this.focusCascade;
    const r = Math.ceil(f.radius * 32) / 32;
    const up = Math.abs(sunDir.y) > 0.99 ? _v3.set(1, 0, 0) : _up;
    _view.lookAt(_v.set(0, 0, 0), _v2.copy(sunDir).negate(), up);
    const texel = (2 * r) / this.size;
    const ls = _c.copy(f.center).applyMatrix4(_inv.copy(_view).invert());
    ls.x = Math.floor(ls.x / texel) * texel;
    ls.y = Math.floor(ls.y / texel) * texel;
    const centre = ls.applyMatrix4(_view);
    const back = 60;
    const eye = _v.copy(centre).addScaledVector(sunDir, back);
    c.view.lookAt(eye, centre, up);
    c.view.setPosition(eye);
    c.view.invert();
    c.proj.makeOrthographic(-r, r, r, -r, 0.1, back + r * 2);
    c.vp.multiplyMatrices(c.proj, c.view);
    c.center.copy(centre); c.radius = r; c.texel = texel;
    this.matrices.set(c.vp.elements, FOCUS * 16);
    this.focusTexel = texel;
  }

  /** Renders every cascade with the supplied draw callback (receives the cascade's view-projection). */
  render(drawCasters) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, this.size, this.size);
    state(gl, { depthTest: true, depthWrite: true, cull: false, colorMask: false });
    gl.enable(gl.POLYGON_OFFSET_FILL);
    for (let i = 0; i < this.n; i++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.map.tex, 0, i);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.polygonOffset(1.6 + i * 0.6, 2.0 + i);
      drawCasters(this.cascades[i], i);
    }
    if (this.focusOn) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.map.tex, 0, FOCUS);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.polygonOffset(1.2, 1.5);
      drawCasters(this.focusCascade, FOCUS);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
  }
}

const _v2 = new Vector3(), _v3 = new Vector3();
void _proj;

/** GLSL for sampling the cascades (PCF over a rotated Poisson disk). */
export const SHADOW_GLSL = /* glsl */`
uniform highp sampler2DArrayShadow uShadowMap;
uniform mat4 uShadowMatrix[5];
uniform float uShadowFocusOn, uShadowFocusTexel;
uniform vec4 uShadowSplits;
uniform vec4 uShadowTexel;
uniform float uShadowSize;
const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
float shadowCascade(int i, vec3 wpos, vec3 n, float rot, float softness) {
  vec3 p = wpos + n * uShadowTexel[i] * 1.6;
  vec4 c = uShadowMatrix[i] * vec4(p, 1.0);
  vec3 s = c.xyz / c.w * 0.5 + 0.5;
  if (any(lessThan(s.xy, vec2(0.0))) || any(greaterThan(s.xy, vec2(1.0))) || s.z > 1.0) return 1.0;
  float radius = softness / uShadowSize * (1.0 + float(i) * 0.15);
  float ca = cos(rot), sa = sin(rot);
  float sum = 0.0;
  for (int k = 0; k < 12; k++) {
    vec2 o = POISSON[k];
    o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca);
    sum += texture(uShadowMap, vec4(s.xy + o * radius, float(i), s.z));
  }
  return sum / 12.0;
}
/**
 * The focus map, where it covers the point: 1 inside its inner part, fading
 * to 0 at its edge (w), and the visibility it gives.
 */
float shadowFocus(vec3 wpos, vec3 n, float rot, out float w) {
  w = 0.0;
  if (uShadowFocusOn < 0.5) return 1.0;
  vec3 p = wpos + n * uShadowFocusTexel * 2.0;
  vec4 c = uShadowMatrix[4] * vec4(p, 1.0);
  vec3 s = c.xyz / c.w * 0.5 + 0.5;
  vec2 e = min(s.xy, 1.0 - s.xy);
  w = smoothstep(0.0, 0.08, min(e.x, e.y));
  if (w <= 0.0 || s.z > 1.0) { w = 0.0; return 1.0; }
  // the same world-size penumbra as the first cascade, in finer texels
  float radius = 2.2 * (uShadowTexel.x / max(uShadowFocusTexel, 1e-6)) / uShadowSize;
  radius = min(radius, 0.02);
  float ca = cos(rot), sa = sin(rot);
  float sum = 0.0;
  for (int k = 0; k < 12; k++) {
    vec2 o = POISSON[k];
    o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca);
    sum += texture(uShadowMap, vec4(s.xy + o * radius, 4.0, s.z));
  }
  return sum / 12.0;
}
// ---- virtual shadow maps (passes/VirtualShadows.js) ----
uniform float uVsmOn;
uniform mat4 uVsmLight;
uniform highp sampler2D uVsmTable;
uniform highp sampler2DShadow uVsmAtlas;
uniform vec4 uVsmLevel[3];     // page size (m), window centre page x, y
/** Visibility from the finest resident virtual page, or false where none is resident. */
bool vsmShadow(vec3 wpos, vec3 n, float rot, out float vis) {
  vis = 1.0;
  if (uVsmOn < 0.5) return false;
  for (int l = 0; l < 3; l++) {
    float P = uVsmLevel[l].x, texel = P / 128.0;
    vec3 lp = (uVsmLight * vec4(wpos + n * texel * 2.0, 1.0)).xyz;
    vec2 ip = floor(lp.xy / P);
    vec2 rel = ip - uVsmLevel[l].yz;
    if (any(lessThan(rel, vec2(-32.0))) || any(greaterThanEqual(rel, vec2(32.0)))) continue;
    vec2 slot = mod(ip, 64.0);
    vec4 t = texelFetch(uVsmTable, ivec2(slot.x, float(l) * 64.0 + slot.y), 0);
    if (t.x < 0.0 || t.z != ip.x || t.w != ip.y) continue;
    vec2 f = lp.xy / P - ip;
    float dref = (800.0 - lp.z) / 1600.0;
    // a penumbra of about 3 cm in the world, in this level's texels, kept inside the page
    float rad = clamp(0.03 / texel, 1.0, 6.0);
    float ca = cos(rot), sa = sin(rot), sum = 0.0;
    for (int k = 0; k < 12; k++) {
      vec2 o = POISSON[k];
      o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca) * rad;
      vec2 inPage = clamp(f * 128.0 + o, vec2(0.75), vec2(127.25));
      vec2 uv = (t.xy * 128.0 + inPage) / 4096.0;
      sum += texture(uVsmAtlas, vec3(uv, dref - 0.00002));
    }
    vis = sum / 12.0;
    return true;
  }
  return false;
}
/** Sun visibility at a world position; viewDepth is positive distance along the view axis. */
float sunShadow(vec3 wpos, vec3 n, float viewDepth, float rot) {
  float fw;
  float fs = shadowFocus(wpos, n, rot, fw);
  if (fw >= 1.0) return fs;
  float vv;
  if (vsmShadow(wpos, n, rot, vv)) return mix(vv, fs, fw);
  int i = viewDepth < uShadowSplits.x ? 0 : viewDepth < uShadowSplits.y ? 1 : viewDepth < uShadowSplits.z ? 2 : viewDepth < uShadowSplits.w ? 3 : 4;
  if (i > 3) return mix(1.0, fs, fw);
  if (fw >= 1.0) return fs;
  float sh = shadowCascade(i, wpos, n, rot, 2.2);
  // Blend into the next cascade over the last 12% of this one.
  float edge = uShadowSplits[i];
  float start = i == 0 ? 0.0 : uShadowSplits[i - 1 < 0 ? 0 : i - 1];
  float f = smoothstep(edge - (edge - start) * 0.12, edge, viewDepth);
  if (f > 0.0 && i < 3) sh = mix(sh, shadowCascade(i + 1, wpos, n, rot, 2.2), f);
  else if (f > 0.0) sh = mix(sh, 1.0, f);
  return mix(sh, fs, fw);
}
/** Cheap single-tap version for volumetrics. */
float sunShadowFast(vec3 wpos, float viewDepth) {
  int i = viewDepth < uShadowSplits.x ? 0 : viewDepth < uShadowSplits.y ? 1 : viewDepth < uShadowSplits.z ? 2 : viewDepth < uShadowSplits.w ? 3 : 4;
  if (i > 3) return 1.0;
  vec4 c = uShadowMatrix[i] * vec4(wpos, 1.0);
  vec3 s = c.xyz / c.w * 0.5 + 0.5;
  if (any(lessThan(s.xy, vec2(0.0))) || any(greaterThan(s.xy, vec2(1.0)))) return 1.0;
  return texture(uShadowMap, vec4(s.xy, float(i), s.z - 0.0015));
}
`;
