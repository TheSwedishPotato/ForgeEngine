import { Matrix4, Vector3, Frustum } from 'three';
import { Program, Texture, Target, state } from '../gl/GL.js';

/**
 * Virtual shadow maps for the sun, on WebGL2.
 *
 * Three clipmap levels, each a virtual 8192 x 8192 shadow map, cover 32 m,
 * 128 m and 512 m around the camera: about 4 mm, 16 mm and 6 cm a texel.
 * Each level is cut into 64 x 64 pages of 128 x 128 texels. Pages live in
 * fixed light space (their grid does not move with the camera), so a page
 * rendered once stays right until the sun moves or something moving casts
 * on it, and only then is it drawn again.
 *
 * - Marking: after the G-buffer, every fourth pixel is scattered by the GPU
 *   (a point draw, one point per pixel) onto the page it needs, at the
 *   coarsest level whose texels are still finer than the pixel. That marks
 *   a 64 x 192 request texture. WebGL2 has no atomics; overlapping point
 *   writes of the same value do the same job.
 * - Readback: the request texture goes to the CPU through a pixel-buffer
 *   object and a fence, a frame or two later, never stalling the GPU.
 * - Allocation: requested pages get a slot in a 4096 x 4096 pool (1024
 *   pages, least recently used evicted), and the page table (one texel a
 *   virtual page, addressed modulo 64, tagged with its page coordinates)
 *   is uploaded each frame.
 * - Rendering: up to a budget of pages a frame, each drawn with its own
 *   orthographic projection into its slot. Pages under moving things
 *   (people, horses, weapons) are redrawn every frame; the sun moving by
 *   more than a quarter of a degree redraws them all, progressively.
 * - Sampling: the lighting looks a point up level by level; where no page
 *   is resident yet, the cascaded shadow maps answer.
 */

export const VSM = { LEVELS: 3, SIDE: 64, PAGE: 128, POOL: 4096, EXTENT: [32, 128, 512], Z: 800 };
const POOL_PAGES = VSM.POOL / VSM.PAGE;            // 32 x 32

const MARK_VS = /* glsl */`
uniform highp sampler2D uDepth;
uniform mat4 uInvViewProj, uView, uVsmLight;
uniform ivec2 uGrid;
uniform float uPixelAngle;
uniform vec4 uLevel[3];      // page size (m), window centre page x, y, unused
void main() {
  gl_PointSize = 1.0;
  ivec2 px = ivec2(gl_VertexID % uGrid.x, gl_VertexID / uGrid.x) * 4 + 2;
  ivec2 sz = textureSize(uDepth, 0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (px.x >= sz.x || px.y >= sz.y) return;
  float d = texelFetch(uDepth, px, 0).r;
  if (d >= 1.0) return;
  vec2 uv = (vec2(px) + 0.5) / vec2(sz);
  vec4 w = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 P = w.xyz / w.w;
  float viewDepth = -(uView * vec4(P, 1.0)).z;
  vec3 lp = (uVsmLight * vec4(P, 1.0)).xyz;
  // the coarsest level still finer than the pixel's footprint
  float foot = viewDepth * uPixelAngle;
  int l = int(clamp(ceil(log2(max(foot / (uLevel[0].x / 128.0), 1.0)) * 0.5), 0.0, 2.0));
  for (int k = 0; k < 3; k++) {
    if (k < l) continue;
    float P0 = uLevel[k].x;
    vec2 ip = floor(lp.xy / P0);
    vec2 rel = ip - uLevel[k].yz;
    if (all(greaterThanEqual(rel, vec2(-32.0))) && all(lessThan(rel, vec2(32.0)))) {
      vec2 slot = mod(ip, 64.0);
      vec2 t = vec2(slot.x, float(k) * 64.0 + slot.y) + 0.5;
      gl_Position = vec4(t / vec2(64.0, 192.0) * 2.0 - 1.0, 0.0, 1.0);
      return;
    }
  }
}`;
const MARK_FS = 'out vec4 o; void main() { o = vec4(1.0); }';

const _lv = new Matrix4(), _pv = new Matrix4(), _vp = new Matrix4(), _fr = new Frustum(), _v = new Vector3(), _up = new Vector3(0, 1, 0);

export class VirtualShadows {
  constructor() { this.name = 'vsm'; this.budget = 24; this.stats = { resident: 0, rendered: 0, requested: 0 }; }

  init(r) {
    const gl = r.gl;
    this.gl = gl;
    this.r = r;
    this.atlas = new Texture(gl, { width: VSM.POOL, height: VSM.POOL, format: 'depth32f', filter: 'linear', compare: true });
    this.atlasFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.atlasFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.atlas.tex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    this.table = new Texture(gl, { width: VSM.SIDE, height: VSM.SIDE * VSM.LEVELS, format: 'rgba32f', filter: 'nearest' });
    this.tableData = new Float32Array(VSM.SIDE * VSM.SIDE * VSM.LEVELS * 4);
    this.req = new Target(gl, { width: VSM.SIDE, height: VSM.SIDE * VSM.LEVELS, colors: [{ format: 'rgba8', filter: 'nearest' }] });
    this.pMark = new Program(gl, MARK_VS, MARK_FS, {}, 'vsm-mark');
    this.emptyVao = gl.createVertexArray();
    this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, VSM.SIDE * VSM.SIDE * VSM.LEVELS * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.readback = null;          // {sync, windows}
    this.pages = new Map();        // "l,ix,iy" -> {phys, used, valid, l, ix, iy}
    this.owner = new Array(POOL_PAGES * POOL_PAGES).fill(null);
    this.free = Array.from({ length: POOL_PAGES * POOL_PAGES }, (_, i) => i);
    this.sun = new Vector3();
    this.light = new Matrix4();
    this.windows = [[0, 0], [0, 0], [0, 0]];
    this.dyn = new Map();          // item object -> page keys it covered last frame
    this.frame = 0;
    r.vsm = this;
  }

  active(r) { return r.q.vsm !== false && !r.pathTrace; }

  /** World to light space (rotation only, fixed origin), from the sun direction. */
  _setLight(sunDir) {
    _lv.lookAt(_v.set(0, 0, 0), sunDir.clone().negate(), Math.abs(sunDir.y) > 0.99 ? new Vector3(1, 0, 0) : _up);
    this.light.copy(_lv).invert();       // view matrix: camera at origin looking along -sunDir
  }

  _pageVP(l, ix, iy, out) {
    const P = VSM.EXTENT[l] / VSM.SIDE;
    _pv.makeOrthographic(ix * P, (ix + 1) * P, (iy + 1) * P, iy * P, -VSM.Z, VSM.Z);
    return out.multiplyMatrices(_pv, this.light);
  }

  afterGBuffer(r) {
    if (!this.active(r)) { this.on = false; return; }
    const gl = r.gl;
    this.frame++;
    // the sun: a new direction (more than a degree) redraws everything, progressively
    if (this.sun.lengthSq() === 0 || this.sun.angleTo(r.sunDir) > 0.0175) {
      this.sun.copy(r.sunDir);
      this._setLight(this.sun);
      for (const p of this.pages.values()) p.valid = false;
    }
    // each level's window of pages around the camera
    _v.copy(r.cameraPos).applyMatrix4(this.light);
    for (let l = 0; l < VSM.LEVELS; l++) {
      const P = VSM.EXTENT[l] / VSM.SIDE;
      this.windows[l] = [Math.floor(_v.x / P), Math.floor(_v.y / P)];
    }
    this._collectReadback(gl);
    this._invalidateMoving(r);
    this._renderPages(r);
    this._uploadTable();
    this._mark(r);
    this.on = this.stats.resident > 0;
  }

  /** Pages under anything that moves are redrawn (where it was and where it is). */
  _invalidateMoving(r) {
    const seen = new Set();
    for (const it of r.lists.opaque) {
      const o = it.object;
      if (o.userData.static || !it.castShadow || !it.bounds || it.bounds[3] > 12 || o.isInstancedMesh) continue;
      seen.add(o);
      const keys = this._pagesOfSphere(it.bounds);
      const prev = this.dyn.get(o);
      for (const k of keys) { const p = this.pages.get(k); if (p) p.valid = false; }
      if (prev) for (const k of prev) { const p = this.pages.get(k); if (p) p.valid = false; }
      this.dyn.set(o, keys);
    }
    for (const o of this.dyn.keys()) if (!seen.has(o)) this.dyn.delete(o);
  }

  _pagesOfSphere(b) {
    _v.set(b[0], b[1], b[2]).applyMatrix4(this.light);
    const keys = [];
    for (let l = 0; l < VSM.LEVELS; l++) {
      const P = VSM.EXTENT[l] / VSM.SIDE;
      // a caster also shades pages down-sun of it: stretch the box along the light's xy shadow of up to 6 m
      const x0 = Math.floor((_v.x - b[3]) / P), x1 = Math.floor((_v.x + b[3]) / P);
      const y0 = Math.floor((_v.y - b[3] - 6) / P), y1 = Math.floor((_v.y + b[3] + 6) / P);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) continue;
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) keys.push(`${l},${ix},${iy}`);
    }
    return keys;
  }

  _collectReadback(gl) {
    const R = this.readback;
    if (!R) return;
    const st = gl.clientWaitSync(R.sync, 0, 0);
    if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) return;
    gl.deleteSync(R.sync);
    this.readback = null;
    const px = new Uint8Array(VSM.SIDE * VSM.SIDE * VSM.LEVELS * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let n = 0;
    for (let l = 0; l < VSM.LEVELS; l++) {
      const [cx, cy] = R.windows[l];
      for (let sy = 0; sy < VSM.SIDE; sy++) for (let sx = 0; sx < VSM.SIDE; sx++) {
        if (px[((l * VSM.SIDE + sy) * VSM.SIDE + sx) * 4] < 128) continue;
        // the absolute page in the window [c-32, c+31] whose index is sx (mod 64)
        const ix = cx - 32 + (((sx - (cx - 32)) % 64) + 64) % 64;
        const iy = cy - 32 + (((sy - (cy - 32)) % 64) + 64) % 64;
        this._want(l, ix, iy);
        n++;
      }
    }
    this.stats.requested = n;
  }

  _want(l, ix, iy) {
    const key = `${l},${ix},${iy}`;
    let p = this.pages.get(key);
    if (!p) {
      let phys = this.free.pop();
      if (phys === undefined) {
        // evict the least recently used page not wanted in the last two frames
        let worst = null;
        for (const q of this.pages.values()) if (q.used < this.frame - 2 && (!worst || q.used < worst.used)) worst = q;
        if (!worst) return;
        this.pages.delete(worst.key);
        phys = worst.phys;
      }
      p = { key, l, ix, iy, phys, used: this.frame, valid: false };
      this.pages.set(key, p);
      this.owner[phys] = key;
    }
    p.used = this.frame;
  }

  _renderPages(r) {
    const gl = r.gl;
    const todo = [];
    for (const p of this.pages.values()) if (!p.valid && p.used >= this.frame - 3) todo.push(p);
    todo.sort((a, b) => a.l - b.l || b.used - a.used);
    const n = Math.min(this.budget, todo.length);
    if (n) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.atlasFbo);
      state(gl, { depthTest: true, depthWrite: true, cull: false, colorMask: false });
      gl.enable(gl.SCISSOR_TEST);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 2.0);
      for (let i = 0; i < n; i++) {
        const p = todo[i];
        const px = (p.phys % POOL_PAGES) * VSM.PAGE, py = Math.floor(p.phys / POOL_PAGES) * VSM.PAGE;
        gl.viewport(px, py, VSM.PAGE, VSM.PAGE);
        gl.scissor(px, py, VSM.PAGE, VSM.PAGE);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        this._pageVP(p.l, p.ix, p.iy, _vp);
        _fr.setFromProjectionMatrix(_vp);
        r.drawItems(r.lists.opaque, 'depth', _vp, { frustum: _fr, shadow: true, minRadius: (VSM.EXTENT[p.l] / VSM.SIDE / VSM.PAGE) * 2 });
        r.customDraw('depth', _vp, _fr, null);
        p.valid = true;
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
    }
    this.stats.rendered = n;
  }

  _uploadTable() {
    const T = this.tableData;
    T.fill(-1);
    let resident = 0;
    for (const p of this.pages.values()) {
      if (!p.valid) continue;
      const [cx, cy] = this.windows[p.l];
      if (p.ix < cx - 32 || p.ix >= cx + 32 || p.iy < cy - 32 || p.iy >= cy + 32) continue;
      const sx = ((p.ix % 64) + 64) % 64, sy = ((p.iy % 64) + 64) % 64;
      const o = ((p.l * VSM.SIDE + sy) * VSM.SIDE + sx) * 4;
      T[o] = p.phys % POOL_PAGES; T[o + 1] = Math.floor(p.phys / POOL_PAGES); T[o + 2] = p.ix; T[o + 3] = p.iy;
      resident++;
    }
    this.table.upload(T);
    this.stats.resident = resident;
  }

  /** Scatter this frame's needs into the request texture and start reading it back. */
  _mark(r) {
    const gl = r.gl;
    if (this.readback) return;          // one readback in flight at a time
    this.req.bind();
    state(gl);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    const grid = [Math.ceil(r.width / 4), Math.ceil(r.height / 4)];
    const pixelAngle = (2 * Math.tan(((r.camera?.fov ?? 55) * Math.PI) / 360)) / r.height;
    this.pMark.use().set('uDepth', r.depth).set('uInvViewProj', r.invViewProj).set('uView', r.view).set('uVsmLight', this.light)
      .set('uGrid', grid).set('uPixelAngle', pixelAngle).set('uLevel', this._levelUniform());
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.POINTS, 0, grid[0] * grid[1]);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, VSM.SIDE, VSM.SIDE * VSM.LEVELS, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.readback = { sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), windows: this.windows.map((w) => [...w]) };
    gl.flush();
  }

  _levelUniform() {
    const out = [];
    for (let l = 0; l < VSM.LEVELS; l++) out.push(VSM.EXTENT[l] / VSM.SIDE, this.windows[l][0], this.windows[l][1], 0);
    return out;
  }

  /** Uniforms for the lighting pass (see VSM_GLSL in Shadows.js). */
  bind(p) {
    return p.set('uVsmOn', this.on ? 1 : 0).set('uVsmLight', this.light).set('uVsmTable', this.table).set('uVsmAtlas', this.atlas).set('uVsmLevel', this._levelUniform());
  }
}
