/**
 * Local lights: hundreds of point, spot and tube lights, culled per screen tile.
 *
 * Every light is written into a storage buffer (8 vec4: position+range, colour+type, axis+cone,
 * cone/shadow/radius, shadow matrix); every light's bounding sphere is projected to the screen and
 * added to the lists of the 32x32-pixel tiles it covers (tiled shading on the deferred pass);
 * shadowed spot lights render their depth into one atlas (4x4 tiles).
 */
import { Matrix4, Vector3 } from '../../math/core.js';
import { BUFFER, TEX } from '../../gpu/Device.js';
import { createTexture } from '../../gpu/Resources.js';
import { MAX_LIGHTS, MAX_PER_TILE, TILE, TILE_STRIDE } from '../shaders/lighting.js';

/**
 * @import { Light } from '../../scene/Light.js'
 * @import { GPU } from '../../gpu/Device.js'
 * @import { GPUObject } from '../../types.js'
 */

const SHADOW_TILES = 4;   // 4x4 atlas
const _v = new Vector3(), _d = new Vector3(), _q = new Vector3(), _view = new Matrix4(), _vp = new Matrix4(), _proj = new Matrix4(), _up = new Vector3();
const _tmpQ = { };

export class LightGrid {
  /** @param {GPU} gpu @param {{ shadowSize?: number }} [o]  `shadowSize`: side of the spot-light shadow atlas in pixels (4096) */
  constructor(gpu, { shadowSize = 4096 } = {}) {
    this.gpu = gpu;
    this.data = new Float32Array(MAX_LIGHTS * 32);
    this.lightsBuf = gpu.buffer({ size: MAX_LIGHTS * 32 * 4, usage: BUFFER.STORAGE | BUFFER.COPY_DST, label: 'lights' });
    this.count = 0;
    this.shadowSize = shadowSize;
    this.shadowMap = createTexture(gpu, { width: shadowSize, height: shadowSize, format: 'depth32float', usage: TEX.RENDER | TEX.COPY_SRC, label: 'spot shadow atlas' });
    this.shadowView = this.shadowMap.createView();
    this.tilesX = 0; this.tilesY = 0;
    this.stats = { lights: 0, shadowed: 0, maxPerTile: 0 };
    this.volumetric = [];
    this._resize(1, 1);
  }

  _resize(w, h) {
    this.tilesX = Math.ceil(w / TILE); this.tilesY = Math.ceil(h / TILE);
    const n = this.tilesX * this.tilesY;
    this.grid = new Uint32Array(n * TILE_STRIDE);
    this.tilesBuf?.destroy();
    this.tilesBuf = this.gpu.buffer({ size: Math.max(16, this.grid.byteLength), usage: BUFFER.STORAGE | BUFFER.COPY_DST, label: 'light tiles' });
  }

  /**
   * Writes the lights and the tile lists.
   * @param {GPUObject} enc  a GPUCommandEncoder
   * @param {{ width: number, height: number, view: Matrix4, proj: Matrix4, near: number }} v
   * @param {Light[]} lights
   * @param {Function} drawShadow  called per shadowed spot with (pass, vp, frustumVP) to record casters
   */
  update(enc, v, lights, drawShadow) {
    const W = v.width, H = v.height;
    if (this.tilesX !== Math.ceil(W / TILE) || this.tilesY !== Math.ceil(H / TILE)) this._resize(W, H);
    const D = this.data;
    D.fill(0);
    const counts = new Uint8Array(this.tilesX * this.tilesY);
    this.grid.fill(0);
    const T = this.tilesX * this.tilesY;
    let n = 0, shadowed = 0;
    this.volumetric = [];
    const view = v.view.elements, pe = v.proj.elements;
    const near = v.near;
    const jobs = [];
    for (const l of lights) {
      if (n >= MAX_LIGHTS) break;
      const intensity = l.intensity;
      if (!(intensity > 0)) continue;
      const type = l.isSpotLight ? 1 : l.isTubeLight ? 2 : 0;
      const range = l.distance || 10;
      l.getWorldPosition(_v);
      const o = n * 32;
      D[o] = _v.x; D[o + 1] = _v.y; D[o + 2] = _v.z; D[o + 3] = range;
      D[o + 4] = l.color.r * intensity; D[o + 5] = l.color.g * intensity; D[o + 6] = l.color.b * intensity; D[o + 7] = type;
      let cullR = range;
      if (type === 1) {
        l.target.getWorldPosition(_d); _d.sub(_v).normalize();
        D[o + 8] = _d.x; D[o + 9] = _d.y; D[o + 10] = _d.z; D[o + 11] = Math.cos(l.angle);
        D[o + 12] = Math.cos(l.angle * (1 - (l.penumbra ?? 0.3)));
      } else if (type === 2) {
        // the tube lies along the light's local X axis
        const e = l.matrixWorld.elements;
        _d.set(e[0], e[1], e[2]).normalize();
        const half = (l.length ?? 1.2) / 2;
        D[o + 8] = _d.x; D[o + 9] = _d.y; D[o + 10] = _d.z; D[o + 11] = half;
        cullR = range + half;
      }
      D[o + 13] = -1;
      D[o + 14] = l.radius ?? (type === 2 ? 0.02 : 0.05);
      D[o + 15] = l.volumetric ?? 0;
      // ---- tiles: project the bounding sphere (view space: x right, y up, camera looks down -z)
      const cx = view[0] * _v.x + view[4] * _v.y + view[8] * _v.z + view[12];
      const cy = view[1] * _v.x + view[5] * _v.y + view[9] * _v.z + view[13];
      const cz = view[2] * _v.x + view[6] * _v.y + view[10] * _v.z + view[14];
      let x0 = 0, x1 = this.tilesX - 1, y0 = 0, y1 = this.tilesY - 1;
      if (cz - cullR > -near) continue;                 // wholly behind the near plane
      if (cz + cullR < -near) {                          // wholly in front: project the box; else it covers the screen
        let mnx = 1, mny = 1, mxx = -1, mxy = -1;
        for (let k = 0; k < 8; k++) {
          const px = cx + (k & 1 ? cullR : -cullR), py = cy + (k & 2 ? cullR : -cullR), pz = Math.min(cz + (k & 4 ? cullR : -cullR), -near);
          const w = -pz;
          const sx = (pe[0] * px + pe[8] * pz) / w, sy = (pe[5] * py + pe[9] * pz) / w;
          mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx); mny = Math.min(mny, sy); mxy = Math.max(mxy, sy);
        }
        if (mxx < -1 || mnx > 1 || mxy < -1 || mny > 1) continue;
        x0 = Math.max(0, Math.floor((mnx * 0.5 + 0.5) * W / TILE)); x1 = Math.min(this.tilesX - 1, Math.floor((mxx * 0.5 + 0.5) * W / TILE));
        y0 = Math.max(0, Math.floor((0.5 - mxy * 0.5) * H / TILE)); y1 = Math.min(this.tilesY - 1, Math.floor((0.5 - mny * 0.5) * H / TILE));
      }
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const t = ty * this.tilesX + tx;
        const c = counts[t];
        if (c >= MAX_PER_TILE) continue;
        this.grid[t * TILE_STRIDE + 1 + c] = n;
        counts[t] = c + 1;
      }
      if ((l.volumetric ?? 0) > 0 && this.volumetric.length < 8) this.volumetric.push(n);
      if (type === 1 && l.castShadow && shadowed < SHADOW_TILES * SHADOW_TILES) {
        const idx = shadowed++;
        D[o + 13] = idx;
        jobs.push({ l, idx, o, pos: _v.clone(), dir: _d.clone(), range });
      }
      n++;
    }
    let maxPer = 0;
    for (let t = 0; t < T; t++) { this.grid[t * TILE_STRIDE] = counts[t]; if (counts[t] > maxPer) maxPer = counts[t]; }
    // ---- spot shadows: one pass over the atlas, a viewport per light
    const ts = this.shadowSize / SHADOW_TILES;
    const pass = enc.beginRenderPass({
      label: 'spot shadows', colorAttachments: [],
      depthStencilAttachment: { view: this.shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    for (const j of jobs) {
      const tx = j.idx % SHADOW_TILES, ty = Math.floor(j.idx / SHADOW_TILES);
      const fov = Math.min(170, (j.l.angle * 2 * 180) / Math.PI + 4);
      const nearP = Math.max(0.05, j.range * 0.004);
      _proj.makePerspectiveFov(fov, 1, nearP, j.range, false);
      _up.set(Math.abs(j.dir.y) > 0.98 ? 1 : 0, Math.abs(j.dir.y) > 0.98 ? 0 : 1, 0);
      _q.copy(j.pos).add(j.dir);
      _view.lookAt(j.pos, _q, _up);
      _view.setPosition(j.pos);
      _view.invert();
      _vp.multiplyMatrices(_proj, _view);
      pass.setViewport(tx * ts, ty * ts, ts, ts, 0, 1);
      pass.setScissorRect(tx * ts, ty * ts, ts, ts);
      drawShadow(pass, _vp);
      // atlas matrix: clip -> this tile's uv (v down), depth 0..1
      const A = new Matrix4().set(0.125, 0, 0, (tx + 0.5) * 0.25, 0, -0.125, 0, (ty + 0.5) * 0.25, 0, 0, 1, 0, 0, 0, 0, 1);
      const M = A.multiply(_vp).elements;
      for (let k = 0; k < 16; k++) D[j.o + 16 + k] = M[k];
    }
    pass.end();
    this.count = n;
    this.gpu.queue.writeBuffer(this.lightsBuf, 0, D);
    this.gpu.queue.writeBuffer(this.tilesBuf, 0, this.grid);
    this.stats.lights = n; this.stats.shadowed = shadowed; this.stats.maxPerTile = maxPer;
  }
}

void _tmpQ;
