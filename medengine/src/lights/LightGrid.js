import { Matrix4, Vector3, Vector4, Frustum, PerspectiveCamera } from 'three';
import { Texture, Target } from '../gl/GL.js';

/**
 * Med Engine 2 local lights: hundreds of point, spot and tube lights, culled per screen tile.
 *
 * Lights are read from the scene: three's PointLight and SpotLight, and any Object3D with
 * userData.light = { type: 'tube', length, color, intensity, range } (fluorescent tubes,
 * neon strips: a line light lit with the representative-point method, Karis 2013).
 * Extra per light (userData): radius (source size, softens highlights), volumetric (0..1,
 * how much it lights rain and fog), shadow (true: a spot casts shadows from the atlas).
 *
 * Each frame:
 *  - every light is written into a float texture, 8 texels each (position, colour, axis,
 *    cone, shadow matrix);
 *  - every light's bounding sphere is projected to the screen and added to the lists of the
 *    32x32-pixel tiles it covers (a "tiled forward+" grid, here used by the deferred pass);
 *  - shadowed spot lights render their depth into one 4096² atlas (16 tiles of 1024²).
 */
export const MAX_LIGHTS = 256;
export const MAX_PER_TILE = 32;
export const TILE = 32;
const SHADOW_TILES = 4;   // 4x4 atlas

const _v = new Vector3(), _d = new Vector3(), _c = new Vector4(), _m = new Matrix4(), _bias = new Matrix4();

export class LightGrid {
  constructor(gl) {
    this.gl = gl;
    this.data = new Float32Array(MAX_LIGHTS * 8 * 4);
    this.tex = new Texture(gl, { width: 8, height: MAX_LIGHTS, format: 'rgba32f', filter: 'nearest' });
    this.count = 0;
    this.shadowSize = 4096;
    this.shadowMap = new Texture(gl, { width: this.shadowSize, height: this.shadowSize, format: 'depth32f', filter: 'linear', compare: true });
    this.shadowTarget = new Target(gl, { width: this.shadowSize, height: this.shadowSize, depth: this.shadowMap });
    this.cam = new PerspectiveCamera();
    this.stats = { lights: 0, shadowed: 0, maxPerTile: 0 };
    this.shadowFrame = 0;
  }

  resize(w, h) {
    this.tilesX = Math.ceil(w / TILE); this.tilesY = Math.ceil(h / TILE);
    const n = this.tilesX * this.tilesY;
    this.grid = new Float32Array(n * (1 + MAX_PER_TILE / 4) * 4);
    this.gridTex?.dispose();
    this.gridTex = new Texture(this.gl, { width: n, height: 1 + MAX_PER_TILE / 4, format: 'rgba32f', filter: 'nearest' });
  }

  /** Writes the lights and the tile lists. drawShadow(vp, frustum) renders casters for one spot. */
  update(r, lights, drawShadow) {
    const W = r.width, H = r.height;
    if (!this.grid || this.tilesX !== Math.ceil(W / TILE) || this.tilesY !== Math.ceil(H / TILE)) this.resize(W, H);
    const D = this.data;
    D.fill(0);
    const counts = new Uint8Array(this.tilesX * this.tilesY);
    this.grid.fill(0);
    let n = 0, shadowed = 0;
    this.volumetric = [];
    const view = r.view, proj = r.proj;
    const near = r.camera.near;
    const shadowJobs = [];
    for (const l of lights) {
      if (n >= MAX_LIGHTS) break;
      const ud = l.userData;
      const type = l.isSpotLight ? 1 : ud.light?.type === 'tube' ? 2 : 0;
      const color = l.color ?? ud.light?.color;
      const intensity = (l.intensity ?? ud.light?.intensity ?? 1);
      if (intensity <= 0) continue;
      const range = l.distance || ud.light?.range || 10;
      l.getWorldPosition(_v);
      const o = n * 32;
      D[o] = _v.x; D[o + 1] = _v.y; D[o + 2] = _v.z; D[o + 3] = range;
      D[o + 4] = color.r * intensity; D[o + 5] = color.g * intensity; D[o + 6] = color.b * intensity; D[o + 7] = type;
      let cullR = range;
      if (type === 1) {
        l.target.getWorldPosition(_d); _d.sub(_v).normalize();
        D[o + 8] = _d.x; D[o + 9] = _d.y; D[o + 10] = _d.z; D[o + 11] = Math.cos(l.angle);
        D[o + 12] = Math.cos(l.angle * (1 - (l.penumbra ?? 0.3)));
      } else if (type === 2) {
        _d.set(1, 0, 0).applyQuaternion(l.getWorldQuaternion(new l.quaternion.constructor())).normalize();
        const half = (ud.light.length ?? 1.2) / 2;
        D[o + 8] = _d.x; D[o + 9] = _d.y; D[o + 10] = _d.z; D[o + 11] = half;
        cullR = range + half;
      }
      D[o + 13] = -1;
      D[o + 14] = ud.radius ?? (type === 2 ? 0.02 : 0.05);
      D[o + 15] = ud.volumetric ?? 0;
      if ((ud.volumetric ?? 0) > 0 && this.volumetric.length < 8) this.volumetric.push(n);
      if (type === 1 && (ud.shadow || l.castShadow) && shadowed < SHADOW_TILES * SHADOW_TILES) {
        const idx = shadowed++;
        D[o + 13] = idx;
        shadowJobs.push({ l, idx, o, pos: _v.clone(), dir: _d.clone(), range });
      }
      // ---- tiles: project the bounding sphere
      _c.set(_v.x, _v.y, _v.z, 1).applyMatrix4(view);
      const cx = _c.x, cy = _c.y, cz = _c.z;
      let x0 = 0, x1 = this.tilesX - 1, y0 = 0, y1 = this.tilesY - 1;
      if (cz - cullR > -near) continue;          // wholly behind the near plane
      if (cz + cullR < -near) {                 // wholly in front: project; else it covers the screen
        let mnx = 1, mny = 1, mxx = -1, mxy = -1;
        for (let k = 0; k < 8; k++) {
          const px = cx + (k & 1 ? cullR : -cullR), py = cy + (k & 2 ? cullR : -cullR), pz = Math.min(cz + (k & 4 ? cullR : -cullR), -near);
          const e = proj.elements;
          const w = -pz;
          const sx = (e[0] * px + e[8] * pz) / w, sy = (e[5] * py + e[9] * pz) / w;
          mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx); mny = Math.min(mny, sy); mxy = Math.max(mxy, sy);
        }
        if (mxx < -1 || mnx > 1 || mxy < -1 || mny > 1) continue;
        x0 = Math.max(0, Math.floor((mnx * 0.5 + 0.5) * W / TILE)); x1 = Math.min(this.tilesX - 1, Math.floor((mxx * 0.5 + 0.5) * W / TILE));
        y0 = Math.max(0, Math.floor((mny * 0.5 + 0.5) * H / TILE)); y1 = Math.min(this.tilesY - 1, Math.floor((mxy * 0.5 + 0.5) * H / TILE));
      }
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const t = ty * this.tilesX + tx;
        const c = counts[t];
        if (c >= MAX_PER_TILE) continue;
        const row = 1 + (c >> 2);
        this.grid[(row * this.tilesX * this.tilesY + t) * 4 + (c & 3)] = n;
        counts[t] = c + 1;
      }
      n++;
    }
    let maxPer = 0;
    for (let t = 0; t < counts.length; t++) { this.grid[t * 4] = counts[t]; if (counts[t] > maxPer) maxPer = counts[t]; }
    // ---- spot shadows
    if (shadowJobs.length && drawShadow) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowTarget.fbo);
      gl.enable(gl.SCISSOR_TEST);
      const ts = this.shadowSize / SHADOW_TILES;
      for (const j of shadowJobs) {
        const tx = j.idx % SHADOW_TILES, ty = Math.floor(j.idx / SHADOW_TILES);
        const cam = this.cam;
        cam.fov = Math.min(170, (j.l.angle * 2 * 180) / Math.PI + 4);
        cam.aspect = 1; cam.near = Math.max(0.05, j.range * 0.004); cam.far = j.range;
        cam.position.copy(j.pos);
        cam.up.set(Math.abs(j.dir.y) > 0.98 ? 1 : 0, Math.abs(j.dir.y) > 0.98 ? 0 : 1, 0);
        cam.lookAt(_v.copy(j.pos).add(j.dir));
        cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        gl.viewport(tx * ts, ty * ts, ts, ts);
        gl.scissor(tx * ts, ty * ts, ts, ts);
        gl.depthMask(true);
        gl.clearBufferfv(gl.DEPTH, 0, [1]);
        drawShadow(_m, new Frustum().setFromProjectionMatrix(_m));
        // atlas matrix: ndc -> this tile's uv, depth 0..1
        const s = 1 / SHADOW_TILES;
        _bias.set(0.5 * s, 0, 0, (tx + 0.5) * s, 0, 0.5 * s, 0, (ty + 0.5) * s, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
        const M = _bias.multiply(_m).elements;
        for (let k = 0; k < 16; k++) D[j.o + 16 + k] = M[k];
      }
      gl.disable(gl.SCISSOR_TEST);
    }
    this.count = n;
    this.tex.upload(D.subarray(0, MAX_LIGHTS * 32));
    this.gridTex.upload(this.grid);
    this.stats.lights = n; this.stats.shadowed = shadowed; this.stats.maxPerTile = maxPer;
  }

  /** Uniforms for any shader including LIGHTS_GLSL. */
  bind(p) {
    p.set('uLights', this.tex).set('uLightGrid', this.gridTex).set('uTilesX', this.tilesX).set('uTilesY', this.tilesY)
      .set('uSpotShadow', this.shadowMap).set('uLightCount', this.count);
  }
}

/** GLSL: the light loop for a shading point (diffuse + specular), used by deferred lighting. */
export const LIGHTS_GLSL = /* glsl */`
uniform highp sampler2D uLights;
uniform highp sampler2D uLightGrid;
uniform highp sampler2DShadow uSpotShadow;
uniform int uTilesX, uTilesY, uLightCount;

vec4 lightTexel(int i, int k) { return texelFetch(uLights, ivec2(k, i), 0); }

float spotShadow(int i, int idx, vec3 wpos, vec3 N, float dist, float rot) {
  mat4 M = mat4(lightTexel(i, 4), lightTexel(i, 5), lightTexel(i, 6), lightTexel(i, 7));
  vec4 p = M * vec4(wpos + N * (0.01 + dist * 0.004), 1.0);
  p.xyz /= p.w;
  vec2 t0 = vec2(float(idx % 4), float(idx / 4)) * 0.25;
  if (any(lessThan(p.xy, t0)) || any(greaterThan(p.xy, t0 + 0.25)) || p.z > 1.0) return 1.0;
  float s = 0.0;
  float r = 1.6 / 4096.0;
  for (int k = 0; k < 8; k++) {
    float a = rot + float(k) * 2.39996;
    float rr = sqrt((float(k) + 0.5) / 8.0);
    vec2 o = vec2(cos(a), sin(a)) * rr * r * 1.8;
    s += texture(uSpotShadow, vec3(clamp(p.xy + o, t0 + 0.0005, t0 + 0.2495), p.z - 0.0004));
  }
  return s / 8.0;
}

/** Sums every tile light at wpos. diffOut gets the diffuse part (for skin scattering). */
vec3 localLights(vec3 wpos, vec3 N, vec3 V, vec3 diffuseColor, vec3 F0, float rough, int matType, float rot, out vec3 diffOut) {
  ivec2 tile = ivec2(gl_FragCoord.xy) / 32;
  int t = tile.y * uTilesX + tile.x;
  int n = int(texelFetch(uLightGrid, ivec2(t, 0), 0).r);
  vec3 sum = vec3(0.0);
  diffOut = vec3(0.0);
  for (int k = 0; k < 32; k++) {
    if (k >= n) break;
    int i = int(texelFetch(uLightGrid, ivec2(t, 1 + k / 4), 0)[k % 4] + 0.5);
    vec4 a = lightTexel(i, 0), b = lightTexel(i, 1), c = lightTexel(i, 2), d = lightTexel(i, 3);
    int type = int(b.w + 0.5);
    vec3 lp = a.xyz;
    vec3 specPoint = lp;
    if (type == 2) {
      // tube: closest point for diffuse, representative point on the reflection ray for specular
      vec3 axis = c.xyz * c.w;
      vec3 p0 = lp - axis, p1 = lp + axis;
      vec3 seg = p1 - p0;
      float tt = clamp(dot(wpos - p0, seg) / dot(seg, seg), 0.0, 1.0);
      lp = p0 + seg * tt;
      vec3 R = reflect(-V, N);
      vec3 l0 = p0 - wpos, l1 = p1 - wpos;
      vec3 ld = l1 - l0;
      float rl = dot(R, ld);
      float ts = clamp((dot(R, l0) * rl - dot(l0, ld)) / max(dot(ld, ld) - rl * rl, 1e-5), 0.0, 1.0);
      specPoint = p0 + seg * ts;
    }
    vec3 L = lp - wpos;
    float dist2 = dot(L, L);
    float range = a.w;
    float win = pow2(saturate(1.0 - pow2(dist2 / (range * range))));
    if (win <= 0.0) continue;
    float dist = sqrt(dist2);
    L /= dist;
    float fall = win / (dist2 + d.z * d.z + 0.01);
    if (type == 2) fall *= 1.0 + c.w * 0.8;   // a long tube gives more light
    if (type == 1) {
      float cd = dot(-L, c.xyz);
      fall *= smoothstep(c.w, d.x, cd);
      if (fall <= 0.0) continue;
      if (d.y >= 0.0) fall *= spotShadow(i, int(d.y + 0.5), wpos, N, dist, rot);
    }
    float NoLraw = dot(N, L);
    float NoL = saturate(NoLraw);
    vec3 Ls = normalize(specPoint - wpos);
    // a spherical source widens the highlight (energy-normalised, Karis 2013)
    float sr = saturate(rough * rough + d.z / (2.0 * dist));
    vec3 dB;
    vec3 sp = brdfDirect(N, V, Ls, diffuseColor, F0, sqrt(sr), dB) * saturate(dot(N, Ls));
    vec3 col = b.rgb * fall;
    vec3 diff = dB * NoL;
    if (matType == 1) {
      // skin: wrapped diffuse with a red scattering tint past the terminator
      float w = saturate((NoLraw + 0.5) / 1.5);
      diff += diffuseColor * INV_PI * vec3(0.95, 0.32, 0.16) * max(w - NoL, 0.0);
    }
    diffOut += diff * col;
    sum += (diff + sp) * col;
  }
  return sum;
}
`;
