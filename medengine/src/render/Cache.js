/**
 * GPU-side mirrors of scene objects: geometry buffers, textures, material uniform buffers and bind
 * groups, skeleton palettes, instance buffers. Everything is created on first use and keyed by the
 * scene object through WeakMaps, so dropping the object lets the cache entry go.
 */
import { BUFFER, TEX } from '../gpu/Device.js';
import { createTexture, uploadPixels, uploadImage, generateMips, toHalfArray } from '../gpu/Resources.js';
import { MaterialU, MATERIAL_TYPES } from './shaders/geometry.js';
import { ClampToEdgeWrapping, MirroredRepeatWrapping } from '../scene/Material.js';
import { BufferAttribute } from '../scene/Geometry.js';

let _bufId = 1;
export const tag = (b) => { b.__id = _bufId++; return b; };

const IDENT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Vertex attribute table: shader location, WebGPU format chooser. */
const ATTRS = {
  position: { loc: 0 }, normal: { loc: 1 }, uv: { loc: 2 }, skinIndex: { loc: 3 }, skinWeight: { loc: 4 }, color: { loc: 5 }, morphSlot: { loc: 6 },
};

export class ResourceCache {
  constructor(gpu) {
    this.gpu = gpu;
    this.geos = new WeakMap();
    this.texs = new WeakMap();
    this.mats = new WeakMap();
    this.skels = new WeakMap();
    this.insts = new WeakMap();
    this.frame = 0;
    this.stats = { textures: 0, geometries: 0, textureBytes: 0 };
    this.dummyStorage = tag(gpu.buffer({ size: 256, usage: BUFFER.STORAGE, label: 'dummy storage' }));
    this._mkDefaults();
    this.materialLayout = gpu.layout('material', [
      { b: 0, v: 'f', buffer: 'uniform' },
      { b: 1, v: 'f', texture: 'float' }, { b: 2, v: 'f', texture: 'float' }, { b: 3, v: 'f', texture: 'float' }, { b: 4, v: 'f', texture: 'float' },
      { b: 5, v: 'f', sampler: 'filtering' },
    ]);
  }

  _mkDefaults() {
    const g = this.gpu;
    const mk = (rgba, srgb, label) => {
      const t = createTexture(g, { width: 1, height: 1, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', label });
      uploadPixels(g, t, new Uint8Array(rgba));
      return { tex: t, view: t.createView() };
    };
    this.white = mk([255, 255, 255, 255], true, 'white');
    this.whiteLin = mk([255, 255, 255, 255], false, 'white linear');
    this.flatNormal = mk([128, 128, 255, 255], false, 'flat normal');
    this.black = mk([0, 0, 0, 255], false, 'black');
    this.defaultSampler = g.sampler({ maxAnisotropy: 8 });
  }

  // -------------------------------------------------------------------------------------------
  // Textures

  /** GPU texture record for a Texture used as colour (srgb) or data. Returns null when it has no image yet. */
  texture(tex, srgb) {
    if (!tex || !tex.image) return null;
    const img = tex.image;
    if (!img.width || !img.height) return null;
    let slot = this.texs.get(tex);
    if (!slot) { slot = {}; this.texs.set(tex, slot); tex.onDispose?.(() => { for (const k in slot) slot[k].tex.destroy(); this.texs.delete(tex); }); }
    const key = srgb ? 's' : 'l';
    let r = slot[key];
    if (r && r.version === tex.version) return r;
    const gpu = this.gpu;
    const w = img.width, h = img.height;
    let data = img.data ?? null, gfmt = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
    if (data) {
      const f = tex.format ?? 'rgba8';
      if (f === 'rgba16f') { gfmt = 'rgba16float'; }
      else if (f === 'rgba32f') { data = toHalfArray(data); gfmt = 'rgba16float'; }
      else {
        const n = w * h;
        let src = data;
        if (src instanceof Uint8ClampedArray) src = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
        if (f === 'r8' || src.length === n) { const d = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = src[i]; d[i * 4 + 3] = 255; } src = d; }
        else if (f === 'rg8' || src.length === n * 2) { const d = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { d[i * 4] = src[i * 2]; d[i * 4 + 1] = src[i * 2 + 1]; d[i * 4 + 3] = 255; } src = d; }
        else if (src.length === n * 3) { const d = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { d[i * 4] = src[i * 3]; d[i * 4 + 1] = src[i * 3 + 1]; d[i * 4 + 2] = src[i * 3 + 2]; d[i * 4 + 3] = 255; } src = d; }
        data = src;
      }
      if (tex.flipY) data = flipRows(data, w, h);
    }
    const mips = tex.generateMipmaps !== false && (w > 1 || h > 1);
    if (!r || r.w !== w || r.h !== h || r.format !== gfmt) {
      if (r) r.tex.destroy();
      const t = createTexture(gpu, { width: w, height: h, format: gfmt, mips, usage: data ? 0 : TEX.RENDER, label: tex.name || `texture ${tex.id}` });
      r = { tex: t, view: t.createView(), w, h, format: gfmt, version: -1, key: tag({}) };
      slot[key] = r;
      this.stats.textures++;
      this.stats.textureBytes += w * h * (gfmt === 'rgba16float' ? 8 : 4) * (mips ? 1.33 : 1);
    }
    if (data) uploadPixels(gpu, r.tex, data, { width: w, height: h });
    else if (gpu.queue.copyExternalImageToTexture) uploadImage(gpu, r.tex, img, { flipY: !!tex.flipY });
    else if (!this._warnedImage) { this._warnedImage = true; console.warn('[medengine] this platform cannot upload image elements: use DataTexture (pixels) or decode through platform.decodeImage'); }
    if (mips) generateMips(gpu, r.tex);
    r.version = tex.version;
    r.id = tex.id * 2 + (srgb ? 1 : 0);
    return r;
  }

  samplerFor(tex) {
    if (!tex) return this.defaultSampler;
    const wrap = (v) => (v === ClampToEdgeWrapping ? 'clamp-to-edge' : v === MirroredRepeatWrapping ? 'mirror-repeat' : 'repeat');
    const nearestMag = tex.magFilter <= 1004, nearestMin = tex.minFilter <= 1004;
    return this.gpu.sampler({
      addressModeU: wrap(tex.wrapS), addressModeV: wrap(tex.wrapT),
      magFilter: nearestMag ? 'nearest' : 'linear', minFilter: nearestMin ? 'nearest' : 'linear', mipmapFilter: nearestMin ? 'nearest' : 'linear',
      maxAnisotropy: Math.min(16, Math.max(1, tex.anisotropy | 0)),
    });
  }

  // -------------------------------------------------------------------------------------------
  // Materials

  /** The material's shading model id and lobe parameter. */
  static shadingModel(m) {
    let type = 0, param = 0;
    const mt = m.medType;
    if (mt && MATERIAL_TYPES[mt] !== undefined) {
      type = MATERIAL_TYPES[mt];
      const p = m.medParam;
      param = p ?? (mt === 'skin' ? (m.sheen || 0.3) : mt === 'coat' ? (m.clearcoat || 0.4) : mt === 'cloth' || mt === 'hair' ? (m.sheen || 0.4) : 0);
    } else if (m.clearcoat > 0) { type = 2; param = m.clearcoat; }
    else if (m.sheen > 0) { type = 3; param = m.sheen; }
    return { type, param };
  }

  /**
   * Material record: persistent uniform buffer + bind group, and the pipeline defines it implies.
   * Called once per frame per used material.
   */
  material(m) {
    let r = this.mats.get(m);
    if (!r) {
      r = {
        ubuf: tag(this.gpu.buffer({ size: MaterialU.size, usage: BUFFER.UNIFORM | BUFFER.COPY_DST, label: `material ${m.name || m.id}` })),
        scratch: new Float32Array(MaterialU.size / 4), last: new Float32Array(MaterialU.size / 4), bg: null, bgKey: '', frame: -1, defines: null, defKey: '',
      };
      this.mats.set(m, r);
      m.onDispose?.(() => { r.ubuf.destroy(); this.mats.delete(m); });
    }
    if (r.frame === this.frame) return r;
    r.frame = this.frame;
    const map = this.texture(m.map, true), nmap = this.texture(m.normalMap, false), rmap = this.texture(m.roughnessMap, false), emap = this.texture(m.emissiveMap, true);
    const { type, param } = ResourceCache.shadingModel(m);
    const unlit = !!m.unlit;
    const defines = {
      USE_MAP: !!map, USE_NORMALMAP: !!nmap, USE_ROUGHMAP: !!rmap, USE_EMISSIVEMAP: !!emap,
      METAL_FROM_ROUGHMAP: !!rmap && m.metalnessMap === m.roughnessMap, AO_FROM_ROUGHMAP: !!rmap && !!m.aoMap && m.aoMap === m.roughnessMap,
      FLAT: !!m.flatShading, DOUBLE_SIDED: m.side === 2, BACK_SIDE: m.side === 1, UNLIT: unlit,
      ALPHA_TEST: m.alphaTest > 0 && !m.dither, ALPHA_DITHER: !!m.dither, TRANSPARENT: !!m.transparent && !m.dither && !(m.alphaTest > 0),
      DETAIL: !!m.detail, BATSUIT: m.medType === 'batsuit', WET_SURFACE: m.wetFactor !== 0 && !unlit,
      PUDDLES: !!m.puddles, RAIN_STREAKS: !!m.streaks,
    };
    const defKey = Object.keys(defines).filter((k) => defines[k]).join(',');
    if (defKey !== r.defKey) { r.defKey = defKey; r.defines = defines; }
    // uniform block
    const O = MaterialU.offsets, f = r.scratch;
    const w = (name, ...v) => { const b = O[name].offset >> 2; for (let i = 0; i < v.length; i++) f[b + i] = v[i]; };
    const c = m.color, e = m.emissive, ei = m.emissiveIntensity ?? 1;
    w('baseColor', c.r, c.g, c.b, m.opacity ?? 1);
    w('emissive', unlit ? 0 : e.r * ei, unlit ? 0 : e.g * ei, unlit ? 0 : e.b * ei, unlit ? 1 : 0);
    w('params', m.roughness ?? 1, m.metalness ?? 0, type, param);
    w('params2', m.specularIntensity ?? 1, m.alphaTest ?? 0, m.wetFactor ?? 1, m.aoMapIntensity ?? 1);
    const d = m.detail === 'pores' ? [900, 0.55, 0.12] : m.detail === 'leather' ? [260, 0.9, 0.25] : m.detail === 'fabric' ? [700, 0.35, 0.05] : [0, 0, 0];
    w('detail', d[0], d[1], d[2]);
    w('normalScale', m.normalScale?.x ?? 1, m.normalScale?.y ?? 1);
    const mat3 = (name, t) => {
      let el = IDENT3;
      if (t) { t.updateMatrix(); el = t.matrix.elements; }
      const b = O[name].offset >> 2;
      for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) f[b + col * 4 + row] = el[col * 3 + row];
    };
    mat3('mapT', m.map); mat3('normalT', m.normalMap); mat3('roughT', m.roughnessMap);
    let same = true;
    for (let i = 0; i < f.length; i++) if (f[i] !== r.last[i]) { same = false; break; }
    if (!same) { this.gpu.queue.writeBuffer(r.ubuf, 0, f); r.last.set(f); }
    // bind group (rebuilt when a texture's GPU object changes)
    const key = [map?.key.__id ?? 0, map?.version, nmap?.key.__id ?? 0, nmap?.version, rmap?.key.__id ?? 0, rmap?.version, emap?.key.__id ?? 0, emap?.version, m.map?.id, m.normalMap?.id].join('/');
    if (!r.bg || key !== r.bgKey) {
      const first = m.map ?? m.normalMap ?? m.roughnessMap ?? m.emissiveMap;
      r.bg = this.gpu.device.createBindGroup({
        label: `material ${m.name || m.id}`, layout: this.materialLayout,
        entries: [
          { binding: 0, resource: { buffer: r.ubuf } },
          { binding: 1, resource: (map ?? this.white).view },
          { binding: 2, resource: (nmap ?? this.flatNormal).view },
          { binding: 3, resource: (rmap ?? this.whiteLin).view },
          { binding: 4, resource: (emap ?? this.white).view },
          { binding: 5, resource: this.samplerFor(first) },
        ],
      });
      r.bgKey = key;
    }
    return r;
  }

  // -------------------------------------------------------------------------------------------
  // Geometry

  geometry(geo) {
    let g = this.geos.get(geo);
    if (!g) {
      g = { geo, buffers: {}, versions: {}, formats: {}, index: null, indexVersion: -1, count: 0, vcount: 0, morph: null, sig: '' };
      this.geos.set(geo, g);
      geo.onDispose?.(() => this.disposeGeometry(geo));
      this.stats.geometries++;
    }
    const gpu = this.gpu;
    const A = geo.attributes;
    if (!A.position) return g;
    if (!A.normal) geo.computeVertexNormals();
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    g.vcount = A.position.count;
    // index
    if (geo.index) {
      const ia = geo.index;
      if (g.index === null || g.indexVersion !== ia.version || g.indexCount !== ia.count) {
        g.index?.destroy();
        let arr = ia.array;
        if (!(arr instanceof Uint16Array) && !(arr instanceof Uint32Array)) arr = Uint32Array.from(arr);
        if (arr instanceof Uint16Array && arr.length % 2) { const p = new Uint16Array(arr.length + 1); p.set(arr); arr = p; }
        g.index = gpu.buffer({ size: arr.byteLength, usage: BUFFER.INDEX, data: arr, label: `${geo.name || geo.id} index` });
        g.indexFormat = arr instanceof Uint16Array ? 'uint16' : 'uint32';
        g.indexVersion = ia.version; g.indexCount = ia.count;
      }
      g.count = ia.count;
    } else g.count = g.vcount;
    // vertex attributes
    const names = [];
    for (const name of Object.keys(ATTRS)) {
      const a = A[name];
      if (!a) continue;
      names.push(name);
      if (g.buffers[name] && g.versions[name] === a.version && g.counts?.[name] === a.count) continue;
      const { array, format } = vertexData(name, a);
      const need = array.byteLength;
      if (g.buffers[name] && g.sizes?.[name] === need) gpu.queue.writeBuffer(g.buffers[name], 0, array);
      else {
        g.buffers[name]?.destroy();
        g.buffers[name] = gpu.buffer({ size: need, usage: BUFFER.VERTEX, data: array, label: `${geo.name || geo.id} ${name}` });
      }
      (g.sizes ??= {})[name] = need; (g.counts ??= {})[name] = a.count;
      g.formats[name] = format; g.versions[name] = a.version;
    }
    // morph targets: all deltas in one storage buffer, 4 half floats per (target, slot)
    const mp = geo.morphAttributes?.position;
    if (mp && mp.length && !g.morph) {
      const units = mp.length;
      let slots = geo.userData.morphSlots ?? g.vcount;
      if (!A.morphSlot) {
        // slot = vertex index
        const ms = new Float32Array(g.vcount); for (let i = 0; i < ms.length; i++) ms[i] = i;
        const a = new BufferAttribute(ms, 1);
        A.morphSlot = a;
        const { array, format } = vertexData('morphSlot', a);
        g.buffers.morphSlot = gpu.buffer({ size: array.byteLength, usage: BUFFER.VERTEX, data: array, label: 'morphSlot' });
        g.formats.morphSlot = format; g.versions.morphSlot = a.version; g.sizes ??= {}; g.sizes.morphSlot = array.byteLength; (g.counts ??= {}).morphSlot = a.count;
        names.push('morphSlot');
        slots = g.vcount;
      }
      const data = new Uint16Array(units * slots * 4);
      const rel = geo.morphTargetsRelative !== false;
      const base = A.position.array;
      for (let u = 0; u < units; u++) {
        const t = mp[u].array;
        const n = Math.min(mp[u].count, slots);
        for (let i = 0; i < n; i++) {
          const o = (u * slots + i) * 4;
          const dx = t[i * 3] - (rel ? 0 : base[i * 3]), dy = t[i * 3 + 1] - (rel ? 0 : base[i * 3 + 1]), dz = t[i * 3 + 2] - (rel ? 0 : base[i * 3 + 2]);
          const hx = toHalf(dx), hy = toHalf(dy), hz = toHalf(dz);
          data[o] = hx; data[o + 1] = hy; data[o + 2] = hz; data[o + 3] = 0;
        }
      }
      g.morph = { buffer: tag(gpu.buffer({ size: data.byteLength, usage: BUFFER.STORAGE, data, label: `${geo.name || geo.id} morph` })), units, slots };
    }
    if (g.morph && !names.includes('morphSlot') && g.buffers.morphSlot) names.push('morphSlot');
    g.sig = names.map((n) => n + g.formats[n]).join('|');
    g.names = names;
    return g;
  }

  disposeGeometry(geo) {
    const g = this.geos.get(geo);
    if (!g) return;
    for (const b of Object.values(g.buffers)) b.destroy();
    g.index?.destroy(); g.morph?.buffer.destroy();
    this.geos.delete(geo);
  }

  // -------------------------------------------------------------------------------------------
  // Skeletons: two palettes (this frame's and last frame's) for motion vectors

  skeleton(skel) {
    let r = this.skels.get(skel);
    const bytes = Math.max(64, skel.bones.length * 64);
    if (!r) {
      r = { bufs: [0, 1].map((i) => tag(this.gpu.buffer({ size: bytes, usage: BUFFER.STORAGE | BUFFER.COPY_DST, label: `skeleton palette ${i}` }))), cur: 0, frame: -10 };
      this.skels.set(skel, r);
    }
    if (r.frame === this.frame) return r;
    skel.update();
    const consecutive = r.frame === this.frame - 1;
    r.cur ^= 1;
    this.gpu.queue.writeBuffer(r.bufs[r.cur], 0, skel.boneMatrices);
    if (!consecutive) this.gpu.queue.writeBuffer(r.bufs[r.cur ^ 1], 0, skel.boneMatrices);
    r.frame = this.frame;
    return r;
  }

  // -------------------------------------------------------------------------------------------
  // Instances

  instances(mesh) {
    let r = this.insts.get(mesh);
    const ia = mesh.instanceMatrix;
    if (!r) {
      r = { bufs: [0, 1].map((i) => tag(this.gpu.buffer({ size: Math.max(64, ia.array.byteLength), usage: BUFFER.STORAGE | BUFFER.COPY_DST, label: `instances ${i}` }))), cur: 0, version: -1, changed: -10, color: null, colorVersion: -1, cap: ia.count };
      this.insts.set(mesh, r);
    }
    if (r.version !== ia.version || r.version < 0) {
      const first = r.version < 0;
      r.cur ^= 1;
      this.gpu.queue.writeBuffer(r.bufs[r.cur], 0, ia.array);
      if (first) this.gpu.queue.writeBuffer(r.bufs[r.cur ^ 1], 0, ia.array);
      r.version = ia.version; r.changed = this.frame;
    }
    r.prev = (this.frame - r.changed <= 0) ? r.bufs[r.cur ^ 1] : r.bufs[r.cur];
    r.curBuf = r.bufs[r.cur];
    const ic = mesh.instanceColor;
    if (ic) {
      if (!r.color) r.color = tag(this.gpu.buffer({ size: Math.max(16, ic.count * 16), usage: BUFFER.STORAGE | BUFFER.COPY_DST, label: 'instance colors' }));
      if (r.colorVersion !== ic.version || r.colorVersion < 0) {
        const d = new Float32Array(ic.count * 4);
        for (let i = 0; i < ic.count; i++) { d[i * 4] = ic.array[i * 3]; d[i * 4 + 1] = ic.array[i * 3 + 1]; d[i * 4 + 2] = ic.array[i * 3 + 2]; d[i * 4 + 3] = 1; }
        this.gpu.queue.writeBuffer(r.color, 0, d);
        r.colorVersion = ic.version;
      }
    }
    return r;
  }
}

// ---------------------------------------------------------------------------

function flipRows(data, w, h) {
  const stride = data.length / h;
  const out = new data.constructor(data.length);
  for (let y = 0; y < h; y++) out.set(data.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
  return out;
}

const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(v) {
  _f[0] = v;
  const x = _u[0], sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0x1000) >> 13); }
  return sign | (e << 10) | ((m + 0x1000) >> 13);
}

/** Converts a BufferAttribute to the typed array + WebGPU vertex format the shaders expect. */
function vertexData(name, a) {
  const arr = a.array, n = a.itemSize;
  if (name === 'skinIndex') {
    if (arr instanceof Uint8Array) return { array: arr, format: 'uint8x4' };
    if (arr instanceof Uint16Array) return { array: arr, format: 'uint16x4' };
    if (arr instanceof Uint32Array) return { array: arr, format: 'uint32x4' };
    return { array: Uint16Array.from(arr), format: 'uint16x4' };
  }
  if (name === 'skinWeight') {
    if (arr instanceof Uint8Array && a.normalized) return { array: arr, format: 'unorm8x4' };
    if (arr instanceof Uint16Array && a.normalized) return { array: arr, format: 'unorm16x4' };
    return { array: arr instanceof Float32Array ? arr : Float32Array.from(arr), format: 'float32x4' };
  }
  if (name === 'color') {
    const cnt = a.count, out = new Float32Array(cnt * 4);
    for (let i = 0; i < cnt; i++) { out[i * 4] = arr[i * n]; out[i * 4 + 1] = arr[i * n + 1]; out[i * 4 + 2] = arr[i * n + 2]; out[i * 4 + 3] = n > 3 ? arr[i * n + 3] : 1; }
    return { array: out, format: 'float32x4' };
  }
  const f32 = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  return { array: f32, format: n === 1 ? 'float32' : n === 2 ? 'float32x2' : 'float32x3' };
}

export { ATTRS };
