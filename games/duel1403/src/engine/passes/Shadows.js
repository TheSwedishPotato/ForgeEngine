import { Matrix4, Vector3, Vector4 } from 'three';
import { Texture, Target, state } from '../gl/GL.js';

const _v = new Vector3(), _c = new Vector3(), _up = new Vector3(0, 1, 0), _p = new Vector4();
const _view = new Matrix4(), _proj = new Matrix4(), _inv = new Matrix4();

/**
 * Cascaded shadow maps for the sun: practical split scheme, each cascade a
 * bounding sphere of its frustum slice (rotation-invariant size) snapped to
 * whole texels so shadows do not crawl as the camera moves.
 */
export class Shadows {
  constructor(gl, { size = 2048, cascades = 4, distance = 70 } = {}) {
    this.gl = gl;
    this.size = size;
    this.n = cascades;
    this.distance = distance;
    this.map = new Texture(gl, { target: 'array', width: size, height: size, depth: cascades, format: 'depth32f', filter: 'linear', compare: true });
    this.target = new Target(gl, { width: size, height: size, depth: this.map });
    this.matrices = new Float32Array(16 * cascades);
    this.splits = new Float32Array(4);
    this.texel = new Float32Array(4);   // world size of a texel per cascade
    this.cascades = [];
    for (let i = 0; i < cascades; i++) this.cascades.push({ view: new Matrix4(), proj: new Matrix4(), vp: new Matrix4(), center: new Vector3(), radius: 1 });
  }

  resize(size) {
    if (size === this.size) return;
    this.size = size;
    this.map.alloc(size, size, this.n);
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
    }
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
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
  }
}

const _v2 = new Vector3(), _v3 = new Vector3();
void _proj;

/** GLSL for sampling the cascades (PCF over a rotated Poisson disk). */
export const SHADOW_GLSL = /* glsl */`
uniform highp sampler2DArrayShadow uShadowMap;
uniform mat4 uShadowMatrix[4];
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
/** Sun visibility at a world position; viewDepth is positive distance along the view axis. */
float sunShadow(vec3 wpos, vec3 n, float viewDepth, float rot) {
  int i = viewDepth < uShadowSplits.x ? 0 : viewDepth < uShadowSplits.y ? 1 : viewDepth < uShadowSplits.z ? 2 : viewDepth < uShadowSplits.w ? 3 : 4;
  if (i > 3) return 1.0;
  float sh = shadowCascade(i, wpos, n, rot, 2.2);
  // Blend into the next cascade over the last 12% of this one.
  float edge = uShadowSplits[i];
  float start = i == 0 ? 0.0 : uShadowSplits[i - 1 < 0 ? 0 : i - 1];
  float f = smoothstep(edge - (edge - start) * 0.12, edge, viewDepth);
  if (f > 0.0 && i < 3) sh = mix(sh, shadowCascade(i + 1, wpos, n, rot, 2.2), f);
  else if (f > 0.0) sh = mix(sh, 1.0, f);
  return sh;
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
