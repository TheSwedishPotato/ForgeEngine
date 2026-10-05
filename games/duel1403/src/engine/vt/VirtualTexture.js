import { Texture, Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';
import { GROUND_GLSL } from './groundMaterial.js';

/**
 * Virtual texturing for the ground (after id Software's MegaTexture and
 * Barrett, "Sparse Virtual Textures", 2008).
 *
 * The virtual texture spans `worldSize` metres with PAGES x PAGES pages of
 * 128x128 texels at mip 0 (131,072^2 texels, ~8 mm each over 1 km). Only the
 * pages the camera needs live on the GPU, in a 4080^2 physical cache of 900
 * slots (128 texels + a 4-texel border for bilinear filtering).
 *
 * Each frame:
 *  1. the terrain is drawn into a small feedback buffer, each pixel writing
 *     the page and mip level it would sample;
 *  2. that buffer is read back asynchronously (pixel-pack buffer + fence),
 *     never stalling the GPU;
 *  3. missing pages are generated on the GPU (the procedural ground
 *     material, 4x supersampled), the least recently used page evicted;
 *  4. the page table (one texel per page, a mip chain of it for coarser
 *     levels) is updated so every lookup lands on the best resident page,
 *     falling back to a coarser ancestor until the fine one arrives.
 */
export const PAGES = 1024;          // pages across at mip 0
export const LEVELS = 11;           // 1024 .. 1
const CONTENT = 128, BORDER = 4, SLOT = CONTENT + 2 * BORDER;
const SLOTS_X = 30, ATLAS = SLOTS_X * SLOT;   // 4080
const PINNED_LEVELS = 4;            // the four coarsest levels never leave

/** GLSL: sampling the virtual texture (needs uPageTable, uAtlasA, uAtlasB, uVtWorld). */
export const VT_SAMPLE_GLSL = /* glsl */`
uniform sampler2D uPageTable, uAtlasA, uAtlasB;
uniform float uVtWorld, uVtBias;
const float VT_PAGES = ${PAGES}.0, VT_CONTENT = ${CONTENT}.0, VT_BORDER = ${BORDER}.0, VT_SLOT = ${SLOT}.0, VT_ATLAS = ${ATLAS}.0;
vec2 vtUv(vec3 w) { return clamp(w.xz / uVtWorld + 0.5, vec2(0.0), vec2(0.99999)); }
float vtMip(vec2 uv) {
  vec2 t = uv * VT_PAGES * VT_CONTENT;
  vec2 dx = dFdx(t), dy = dFdy(t);
  float m = max(dot(dx, dx), dot(dy, dy));
  return clamp(0.5 * log2(max(m, 1e-8)) + uVtBias, 0.0, ${LEVELS - 1}.0);
}
void vtFetch(vec2 uv, int level, out vec4 a, out vec4 b) {
  int n = ${PAGES} >> level;
  vec4 e = texelFetch(uPageTable, ivec2(uv * float(n)), level);
  int pl = int(e.b * 255.0 + 0.5);
  vec2 slot = floor(e.rg * 255.0 + 0.5);
  vec2 inPage = fract(uv * float(${PAGES} >> pl));
  vec2 auv = (slot * VT_SLOT + VT_BORDER + inPage * VT_CONTENT) / VT_ATLAS;
  a = textureLod(uAtlasA, auv, 0.0);
  b = textureLod(uAtlasB, auv, 0.0);
}
/** Trilinear-ish lookup: blends the two nearest mip levels. a = albedo+rough, b = normal.xy, height, ao */
void vtSample(vec3 w, out vec4 a, out vec4 b) {
  vec2 uv = vtUv(w);
  float m = vtMip(uv);
  int l0 = int(floor(m));
  vec4 a0, b0, a1, b1;
  vtFetch(uv, l0, a0, b0);
  vtFetch(uv, min(l0 + 1, ${LEVELS - 1}), a1, b1);
  float f = fract(m);
  a = mix(a0, a1, f); b = mix(b0, b1, f);
}`;

/** GLSL for the feedback pass: which page does this pixel want? */
export const VT_FEEDBACK_GLSL = /* glsl */`
vec4 vtFeedback(vec3 w, float extraBias) {
  vec2 uv = vtUv(w);
  int l = int(floor(vtMip(uv) + extraBias));
  l = clamp(l, 0, ${LEVELS - 1});
  ivec2 pg = ivec2(uv * float(${PAGES} >> l));
  // r,g: low 8 bits of x,y; b: high 2 bits of x,y + level; a: valid
  return vec4(float(pg.x & 255), float(pg.y & 255), float((pg.x >> 8) | ((pg.y >> 8) << 2) | (l << 4)), 255.0) / 255.0;
}`;

const GEN_FS = /* glsl */`
${COMMON}
${GROUND_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
uniform vec2 uOrigin;      // world position of the page's content corner (min x, min z)
uniform float uTexel;      // world size of a texel at this level
uniform vec2 uSlotPx;      // slot origin in atlas pixels
float h(vec2 p) { return ground(p, uTexel).height; }
void main() {
  vec2 px = gl_FragCoord.xy - uSlotPx - ${BORDER}.0;     // texel coords inside the page (border included, may be <0)
  // The material is band-limited by footprint, so one sample per texel
  // (plus two height taps for the normal) is enough.
  vec2 p = uOrigin + px * uTexel;
  Ground g = ground(p, uTexel);
  float e = max(uTexel, 0.002);
  float hx = h(p + vec2(e, 0.0)), hz = h(p + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - g.height) / e, 1.0, -(hz - g.height) / e));
  vec3 alb = g.albedo; float rough = g.rough, ao = g.ao, hh = g.height;
  oA = vec4(alb, rough);                          // atlas A is sRGB: albedo stored gamma-encoded
  oB = vec4(n.x * 0.5 + 0.5, n.z * 0.5 + 0.5, saturate(hh * 4.0 + 0.5), ao);
}`;

export class VirtualTexture {
  constructor(gl, { worldSize = 1024, budget = 8 } = {}) {
    this.gl = gl;
    this.worldSize = worldSize;
    this.budget = budget;
    this.atlasA = new Texture(gl, { width: ATLAS, height: ATLAS, format: 'srgba8', filter: 'linear' });
    this.atlasB = new Texture(gl, { width: ATLAS, height: ATLAS, format: 'rgba8', filter: 'linear' });
    this.atlas = new Target(gl, { width: ATLAS, height: ATLAS, colors: [this.atlasA, this.atlasB] });
    this.pageTable = new Texture(gl, { width: PAGES, height: PAGES, format: 'rgba8', filter: 'nearest', levels: LEVELS });
    // page table: minFilter must be NEAREST_MIPMAP_NEAREST for texelFetch with levels to be complete
    gl.bindTexture(gl.TEXTURE_2D, this.pageTable.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    this.tables = [];
    for (let l = 0; l < LEVELS; l++) { const n = PAGES >> l; this.tables.push(new Uint8Array(n * n * 4)); }
    this.dirty = new Array(LEVELS).fill(null);    // [x0,y0,x1,y1] per level
    this.gen = postProgram(gl, GEN_FS, {}, 'vt-generate');
    // slots
    this.slotCount = SLOTS_X * SLOTS_X;
    this.slotPage = new Int32Array(this.slotCount).fill(-1);     // page key in slot
    this.slotUsed = new Float64Array(this.slotCount);
    this.resident = new Map();      // page key -> slot
    this.requested = new Map();     // page key -> priority
    this.freeSlots = [];
    for (let i = this.slotCount - 1; i >= 0; i--) this.freeSlots.push(i);
    this.frame = 0;
    this.stats = { resident: 0, generated: 0, evicted: 0, requests: 0 };
    // feedback readback
    this.fbW = 0; this.fbH = 0;
    this.pbo = gl.createBuffer();
    this.fence = null;
    this.fbData = null;
    // Pin the coarsest levels.
    for (let l = LEVELS - 1; l >= LEVELS - PINNED_LEVELS; l--) {
      const n = PAGES >> l;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) this.requested.set(key(l, x, y), 1e9 + l);
    }
  }

  get uniforms() {
    return { uPageTable: this.pageTable, uAtlasA: this.atlasA, uAtlasB: this.atlasB, uVtWorld: this.worldSize, uVtBias: this.biasOverride ?? -0.5 };
  }

  /** Feedback target sized to 1/8 of the internal resolution. */
  feedbackTarget(w, h) {
    const gl = this.gl;
    const fw = Math.max(16, Math.ceil(w / 8)), fh = Math.max(16, Math.ceil(h / 8));
    if (!this.fb || this.fbW !== fw || this.fbH !== fh) {
      this.fb?.dispose();
      this.fb = new Target(gl, { width: fw, height: fh, colors: [{ format: 'rgba8', filter: 'nearest' }], depth: { format: 'depth24' } });
      this.fbW = fw; this.fbH = fh;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, fw * fh * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.fbData = new Uint8Array(fw * fh * 4);
      this.fence = null;
    }
    return this.fb;
  }

  /** After the feedback pass: start an asynchronous readback (if none is in flight). */
  readFeedback() {
    const gl = this.gl;
    if (this.fence) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb.fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, this.fbW, this.fbH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  /** Collects finished feedback, generates pages within budget, updates the page table. */
  update() {
    const gl = this.gl;
    this.frame++;
    if (this.fence) {
      const st = gl.clientWaitSync(this.fence, 0, 0);
      this.fenceAge = (this.fenceAge ?? 0) + 1;
      // Some drivers (software GL, some mobiles) are slow to signal; after a
      // few frames take the result anyway — a small stall beats starving the streamer.
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || this.fenceAge > 4) {
        this.fenceAge = 0;
        gl.deleteSync(this.fence);
        this.fence = null;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.fbData);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this._parseFeedback(this.fbData);
      }
    }
    this._generate();
    this._uploadTable();
  }

  _parseFeedback(d) {
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const b = d[i + 2];
      const x = d[i] | ((b & 3) << 8), y = d[i + 1] | (((b >> 2) & 3) << 8), l = b >> 4;
      const k = key(l, x, y);
      if (seen.has(k)) continue;
      seen.add(k);
      // the page and its ancestors (so the fallback chain stays warm)
      for (let lv = l, px = x, py = y; lv < LEVELS; lv++, px >>= 1, py >>= 1) {
        const kk = key(lv, px, py);
        const s = this.resident.get(kk);
        if (s !== undefined) this.slotUsed[s] = this.frame;
        else this.requested.set(kk, Math.max(this.requested.get(kk) ?? 0, lv * 1000 + this.frame * 1e-3));   // coarse first
        if (lv > l + 3) break;
      }
    }
    this.stats.requests = this.requested.size;
  }

  _generate() {
    if (!this.requested.size) return;
    // coarse pages first: they fill the largest holes
    const list = [...this.requested.entries()].sort((a, b) => b[1] - a[1]);
    const gl = this.gl;
    let made = 0;
    this.atlas.bind();
    state(gl);
    gl.enable(gl.SCISSOR_TEST);
    this.gen.use();
    for (const [k, prio] of list) {
      if (made >= this.budget * (prio > 1e9 ? 4 : 1)) break;
      this.requested.delete(k);
      if (this.resident.has(k)) continue;
      const slot = this._allocSlot(k);
      if (slot < 0) break;
      const { l, x, y } = unkey(k);
      const sx = (slot % SLOTS_X) * SLOT, sy = Math.floor(slot / SLOTS_X) * SLOT;
      const pageWorld = this.worldSize / (PAGES >> l);
      const texel = pageWorld / CONTENT;
      gl.viewport(sx, sy, SLOT, SLOT);
      gl.scissor(sx, sy, SLOT, SLOT);
      this.gen.set('uOrigin', [x * pageWorld - this.worldSize / 2, y * pageWorld - this.worldSize / 2]).set('uTexel', texel).set('uSlotPx', [sx, sy]);
      fullscreen(gl);
      this.resident.set(k, slot);
      this.slotPage[slot] = k;
      this.slotUsed[slot] = this.frame;
      this._mapPage(l, x, y, slot);
      made++;
      this.stats.generated++;
    }
    gl.disable(gl.SCISSOR_TEST);
    this.stats.resident = this.resident.size;
  }

  _allocSlot(k) {
    if (this.freeSlots.length) return this.freeSlots.pop();
    // evict the least recently used page that is not pinned and not used this frame
    let best = -1, bt = Infinity;
    for (let s = 0; s < this.slotCount; s++) {
      const pk = this.slotPage[s];
      if (pk < 0) return s;
      if (unkey(pk).l >= LEVELS - PINNED_LEVELS) continue;
      if (this.slotUsed[s] < bt) { bt = this.slotUsed[s]; best = s; }
    }
    if (best < 0 || bt >= this.frame - 1) return -1;
    const old = this.slotPage[best];
    const { l, x, y } = unkey(old);
    this.resident.delete(old);
    this.slotPage[best] = -1;
    this._unmapPage(l, x, y, best);
    this.stats.evicted++;
    void k;
    return best;
  }

  /** Points every entry the page covers, at its level and all finer levels, to it — unless a finer page already serves them. */
  _mapPage(L, x, y, slot) {
    const sx = slot % SLOTS_X, sy = Math.floor(slot / SLOTS_X);
    for (let l = L; l >= 0; l--) {
      const n = PAGES >> l, s = 1 << (L - l);
      const t = this.tables[l];
      for (let yy = y * s; yy < (y + 1) * s; yy++) for (let xx = x * s; xx < (x + 1) * s; xx++) {
        const o = (yy * n + xx) * 4;
        if (t[o + 3] && t[o + 2] < L) continue;     // a finer page is already here
        t[o] = sx; t[o + 1] = sy; t[o + 2] = L; t[o + 3] = 255;
      }
      this._markDirty(l, x * s, y * s, (x + 1) * s, (y + 1) * s);
    }
  }

  /** The page left: its entries fall back to whatever serves the parent. */
  _unmapPage(L, x, y, slot) {
    const sx = slot % SLOTS_X, sy = Math.floor(slot / SLOTS_X);
    for (let l = L; l >= 0; l--) {
      const n = PAGES >> l, s = 1 << (L - l);
      const t = this.tables[l];
      for (let yy = y * s; yy < (y + 1) * s; yy++) for (let xx = x * s; xx < (x + 1) * s; xx++) {
        const o = (yy * n + xx) * 4;
        if (t[o + 2] !== L || t[o] !== sx || t[o + 1] !== sy) continue;
        // parent entry at the next coarser level (already correct, processed first)
        const pl = l + 1 > L ? L + 1 : l + 1;
        const pt = this.tables[Math.min(pl, LEVELS - 1)], pn = PAGES >> Math.min(pl, LEVELS - 1);
        const px = xx >> 1, py = yy >> 1;
        const po = (py * pn + px) * 4;
        t[o] = pt[po]; t[o + 1] = pt[po + 1]; t[o + 2] = pt[po + 2]; t[o + 3] = pt[po + 3];
      }
      this._markDirty(l, x * s, y * s, (x + 1) * s, (y + 1) * s);
    }
  }

  _markDirty(l, x0, y0, x1, y1) {
    const d = this.dirty[l];
    if (!d) this.dirty[l] = [x0, y0, x1, y1];
    else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
  }

  _uploadTable() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.pageTable.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let l = 0; l < LEVELS; l++) {
      const d = this.dirty[l];
      if (!d) continue;
      const n = PAGES >> l;
      const [x0, y0, x1, y1] = d;
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, n);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
      gl.texSubImage2D(gl.TEXTURE_2D, l, x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, this.tables[l]);
      this.dirty[l] = null;
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }
}

function key(l, x, y) { return l * 1048576 + y * 1024 + x; }
function unkey(k) { const l = Math.floor(k / 1048576), r = k - l * 1048576; return { l, y: Math.floor(r / 1024), x: r % 1024 }; }

/**
 * Renderer pass driving a virtual texture: pages are generated before the
 * G-buffer (so this frame already uses them), and the feedback pass runs
 * right after it.
 */
export class VirtualTexturePass {
  constructor(vt) { this.name = 'vt'; this.vt = vt; }
  beginFrame() { this.vt.update(); }
  afterGBuffer(r) {
    const gl = r.gl;
    const fb = this.vt.feedbackTarget(r.width, r.height);
    fb.bind();
    state(gl, { depthTest: true, depthWrite: true });
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    r.customDraw('feedback', r.viewProj, r.frustum, null);
    this.vt.readFeedback();
  }
}
