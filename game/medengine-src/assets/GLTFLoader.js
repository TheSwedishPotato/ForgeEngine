/**
 * glTF 2.0 loader: `.glb` (binary) and `.gltf` (JSON with embedded or external buffers and images).
 *
 *   const loader = new GLTFLoader({ platform });
 *   const gltf = await loader.load('models/knight.glb');
 *   scene.add(gltf.scene);
 *   const animator = new Animator(gltf.scene);
 *   animator.play(gltf.clip('Run'));
 *
 * What comes across
 *   scenes / nodes   as Object3D / Group / Bone / Mesh / SkinnedMesh / cameras / lights, with unique names
 *                    (animations find their bones by name), `extras` merged into `userData`
 *   meshes           triangles (strips and fans are converted), POSITION / NORMAL / TEXCOORD_0 / COLOR_0 / JOINTS_0 / WEIGHTS_0,
 *                    sparse and interleaved accessors, normalised and quantised data (KHR_mesh_quantization), 8 joint influences
 *                    reduced to the strongest 4; morph targets (positions); a primitive without NORMAL is flat shaded
 *   materials        metallic-roughness PBR -> StandardMaterial (base colour, metallic-roughness texture, normal, occlusion,
 *                    emissive, alpha modes, double sided), KHR_materials_unlit / emissive_strength / clearcoat / sheen /
 *                    specular / pbrSpecularGlossiness, KHR_texture_transform on the base colour. A separate occlusion texture
 *                    is packed with the metallic-roughness one into the glTF "ORM" layout the shaders read.
 *   skins            Skeleton + SkinnedMesh bound the glTF way (the mesh node's own transform is ignored)
 *   animations       translation / rotation / scale / morph weights -> AnimationClip tracks; STEP and CUBICSPLINE are baked
 *                    to linear keys
 *   punctual lights  KHR_lights_punctual (see `lightScale`)
 *
 * Not supported (loading says so instead of producing a wrong picture): Draco / meshopt / Basis compressed files
 * (decompress them first, e.g. `npx @gltf-transform/cli copy in.glb out.glb` after `decompress`), glTF 1.0, sparse-less morph
 * normals/tangents (ignored), a second UV set, KHR_materials_transmission / volume / iridescence (ignored with a warning),
 * KHR_animation_pointer, cameras' sensor fit.
 *
 * Conventions match the engine: metres, +Y up, right-handed; a glTF "front" faces +Z.
 */
import { Object3D, Group } from '../scene/Object3D.js';
import { BufferGeometry, BufferAttribute, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from '../scene/Geometry.js';
import { StandardMaterial, Texture, DoubleSide, FrontSide, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter, LinearFilter, LinearMipmapLinearFilter } from '../scene/Material.js';
import { Mesh, SkinnedMesh, Bone, Skeleton } from '../scene/Mesh.js';
import { PerspectiveCamera, OrthographicCamera } from '../scene/Camera.js';
import { DirectionalLight, PointLight, SpotLight } from '../scene/Light.js';
import { Matrix4 } from '../math/core.js';
import { Track, AnimationClip } from '../anim/Clip.js';

const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Extensions this loader understands. Anything else listed in `extensionsRequired` stops the load. */
const SUPPORTED = new Set([
  'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_specular',
  'KHR_materials_pbrSpecularGlossiness', 'KHR_lights_punctual', 'KHR_mesh_quantization', 'KHR_texture_transform', 'EXT_texture_webp', 'KHR_materials_ior',
]);
const COMPRESSION_HELP = {
  KHR_draco_mesh_compression: 'Draco-compressed mesh',
  EXT_meshopt_compression: 'meshopt-compressed buffers',
  KHR_texture_basisu: 'Basis Universal / KTX2 textures',
};

// ---------------------------------------------------------------------------------------------------- helpers

/** Splits a .glb into its JSON and binary chunks. */
export function splitGLB(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 20 || dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('GLB: missing "glTF" header');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB: container version ${version} is not supported (only 2)`);
  const total = Math.min(dv.getUint32(8, true), u8.length);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = u8.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON && !json) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === CHUNK_BIN && !bin) bin = body;
    off += 8 + ((len + 3) & ~3);
  }
  if (!json) throw new Error('GLB: no JSON chunk');
  return { json, bin };
}

function decodeDataURI(uri) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(uri);
  if (!m) throw new Error('glTF: malformed data URI');
  if (/;base64/.test(m[2])) {
    const s = atob(m[3]), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return { mime: m[1], bytes: out };
  }
  return { mime: m[1], bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
}

function mimeFromName(name = '') {
  const e = name.split(/[?#]/)[0].split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ktx2: 'image/ktx2' }[e] ?? '';
}

/** Float32 copy of an accessor: integer data is scaled to 0..1 / -1..1 when it is flagged `normalized`. */
function toFloat32(acc) {
  const { array, normalized } = acc;
  if (array instanceof Float32Array) return array;
  const out = new Float32Array(array.length);
  if (normalized) {
    const d = array instanceof Int8Array ? 127 : array instanceof Uint8Array ? 255 : array instanceof Int16Array ? 32767 : array instanceof Uint16Array ? 65535 : 4294967295;
    const signed = array instanceof Int8Array || array instanceof Int16Array;
    for (let i = 0; i < array.length; i++) out[i] = signed ? Math.max(array[i] / d, -1) : array[i] / d;
  } else for (let i = 0; i < array.length; i++) out[i] = array[i];
  return out;
}

function stripToTriangles(idx, fan) {
  const n = idx.length;
  if (n < 3) return new Uint32Array(0);
  const out = new Uint32Array((n - 2) * 3);
  let o = 0;
  for (let i = 0; i < n - 2; i++) {
    if (fan) { out[o++] = idx[0]; out[o++] = idx[i + 1]; out[o++] = idx[i + 2]; }
    else if (i & 1) { out[o++] = idx[i + 1]; out[o++] = idx[i]; out[o++] = idx[i + 2]; }
    else { out[o++] = idx[i]; out[o++] = idx[i + 1]; out[o++] = idx[i + 2]; }
  }
  return out;
}

const wrapOf = (w) => (w === 33071 ? ClampToEdgeWrapping : w === 33648 ? MirroredRepeatWrapping : RepeatWrapping);

/** Result of a load. Everything is also reachable by glTF index through the arrays. */
export class GLTFAsset {
  constructor() {
    /** The default scene (a Group). Add it to your scene; clone it with `cloneModel` / `assets.instantiate` to spawn copies. */
    this.scene = null;
    this.scenes = [];
    /** Object3D per glTF node index */ this.nodes = [];
    /** StandardMaterial per glTF material index */ this.materials = [];
    /** Texture per glTF texture index (null where it could not be decoded) */ this.textures = [];
    /** Skeleton per glTF skin index */ this.skeletons = [];
    /** @type {AnimationClip[]} */ this.animations = [];
    this.cameras = [];
    this.lights = [];
    this.asset = {};
    this.userData = {};
    /** Things that did not load perfectly (an undecodable texture, an ignored extension) */ this.warnings = [];
    this.json = null;
    this.extensionsUsed = [];
  }
  /** The clip with this name, or the one at that index. */
  clip(nameOrIndex = 0) {
    const c = typeof nameOrIndex === 'number' ? this.animations[nameOrIndex] : this.animations.find((a) => a.name === nameOrIndex);
    if (!c) throw new Error(`glTF: no animation ${JSON.stringify(nameOrIndex)} (have ${this.animations.map((a) => a.name).join(', ') || 'none'})`);
    return c;
  }
  find(name) { return this.scene?.getObjectByName(name) ?? null; }
  get skinnedMeshes() { const out = []; this.scene?.traverse((o) => { if (o.isSkinnedMesh) out.push(o); }); return out; }
  get meshes() { const out = []; this.scene?.traverse((o) => { if (o.isMesh) out.push(o); }); return out; }
}

// ---------------------------------------------------------------------------------------------------- the loader

export class GLTFLoader {
  /**
   * @param {object} o
   * @param {Platform} [o.platform]   reads files (`readFile`) and decodes images (`decodeImage`)
   * @param {(url:string)=>Promise<Uint8Array>} [o.readFile]  override file access
   * @param {(bytes:Uint8Array, mime:string)=>Promise<any>} [o.decodeImage]  override image decoding
   * @param {boolean} [o.castShadow]    default true
   * @param {boolean} [o.receiveShadow] default true
   * @param {number}  [o.lightScale]    multiplier for KHR_lights_punctual intensities (glTF uses lux / candela; default 1)
   * @param {number}  [o.animationFps]  sample rate used to bake CUBICSPLINE animations (default 60)
   * @param {string|null} [o.rootBone]  AnimationClip root-motion bone (default none: clips play exactly as authored)
   * @param {boolean} [o.strictTextures] throw when a texture cannot be decoded (default: warn and carry on without it)
   */
  constructor(o = {}) {
    this.platform = o.platform ?? null;
    this.readFile = o.readFile ?? ((url) => {
      if (!this.platform) throw new Error('GLTFLoader: give a platform (or readFile) to load files');
      return this.platform.readFile(url);
    });
    this.decodeImage = o.decodeImage ?? ((bytes, mime) => {
      if (!this.platform) throw new Error('GLTFLoader: give a platform (or decodeImage) to decode textures');
      return this.platform.decodeImage(bytes, mime);
    });
    this.options = {
      castShadow: o.castShadow ?? true, receiveShadow: o.receiveShadow ?? true, lightScale: o.lightScale ?? 1,
      animationFps: o.animationFps ?? 60, rootBone: o.rootBone ?? null, strictTextures: !!o.strictTextures,
    };
  }

  async load(url, opts = {}) {
    const bytes = await this.readFile(url);
    const base = typeof url === 'string' ? url : String(url);
    return this.parse(bytes, { baseUrl: base.slice(0, base.lastIndexOf('/') + 1), ...opts });
  }

  /**
   * @param {ArrayBuffer|Uint8Array|string|object} data  a .glb, a .gltf (text or parsed object)
   * @param {object} [o]
   * @param {string} [o.baseUrl] where external buffers / images are looked up
   */
  async parse(data, o = {}) {
    let json, bin = null;
    if (typeof data === 'string') json = JSON.parse(data);
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const u8 = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (u8.length >= 4 && new DataView(u8.buffer, u8.byteOffset, 4).getUint32(0, true) === GLB_MAGIC) ({ json, bin } = splitGLB(u8));
      else json = JSON.parse(new TextDecoder().decode(u8));
    } else json = data;
    const p = new Parse(this, json, bin, o.baseUrl ?? '', { ...this.options, ...o });
    return p.run();
  }
}

class Parse {
  constructor(loader, json, bin, baseUrl, opts) {
    this.loader = loader; this.json = json; this.bin = bin; this.baseUrl = baseUrl; this.opts = opts;
    this.out = new GLTFAsset();
    this.out.json = json;
    this.warned = new Set();
    this.names = new Set();
    this.cache = { buffers: new Map(), views: new Map(), acc: new Map(), geo: new Map(), mat: new Map(), tex: new Map(), img: new Map(), orm: new Map() };
    this.jointNodes = new Set();
  }

  warn(msg, key = msg) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.out.warnings.push(msg);
  }

  async run() {
    const J = this.json;
    if (!J || typeof J !== 'object') throw new Error('glTF: not a glTF file');
    const ver = J.asset?.version;
    if (!ver || !/^2\./.test(ver)) throw new Error(`glTF: version ${ver ?? '(missing)'} is not supported (only glTF 2.x)`);
    this.out.asset = J.asset; this.out.extensionsUsed = J.extensionsUsed ?? [];
    for (const e of J.extensionsRequired ?? []) {
      if (COMPRESSION_HELP[e]) throw new Error(`glTF: this file uses ${COMPRESSION_HELP[e]} (${e}), which Med Engine cannot decode. Re-export without compression, or run it through gltf-transform (decompress) first.`);
      if (!SUPPORTED.has(e)) throw new Error(`glTF: the file requires the extension ${e}, which Med Engine does not support`);
    }
    for (const e of J.extensionsUsed ?? []) {
      if (COMPRESSION_HELP[e] && !(J.extensionsRequired ?? []).includes(e)) this.warn(`${e} is used but optional; the uncompressed fallback data is used`);
      else if (!SUPPORTED.has(e) && !COMPRESSION_HELP[e]) this.warn(`extension ${e} is ignored`);
    }
    for (const sk of J.skins ?? []) for (const j of sk.joints ?? []) this.jointNodes.add(j);

    const O = this.out;
    await this.loadBuffers();
    await this.makeMaterials();
    this.makeNodes();
    this.linkNodes();
    this.makeSkins();
    this.makeAnimations();

    const scenes = J.scenes ?? [];
    O.scenes = scenes.map((s, i) => {
      const g = new Group();
      g.name = s.name || `scene${i}`;
      for (const n of s.nodes ?? []) g.add(O.nodes[n]);
      if (s.extras) Object.assign(g.userData, s.extras);
      return g;
    });
    if (!scenes.length) {                                   // a file without scenes: everything that has no parent
      const g = new Group(); g.name = 'scene';
      const child = new Set();
      for (const n of J.nodes ?? []) for (const c of n.children ?? []) child.add(c);
      (J.nodes ?? []).forEach((_, i) => { if (!child.has(i)) g.add(O.nodes[i]); });
      O.scenes = [g];
    }
    O.scene = O.scenes[J.scene ?? 0] ?? O.scenes[0];
    O.userData = J.asset?.extras ?? {};
    return O;
  }

  uniqueName(base, fallback) {
    let name = base && String(base).length ? String(base) : fallback;
    if (this.names.has(name)) { let k = 1; while (this.names.has(`${name}_${k}`)) k++; name = `${name}_${k}`; }
    this.names.add(name);
    return name;
  }

  // ------------------------------------------------------------------------------------------ binary data
  async buffer(i) {
    let p = this.cache.buffers.get(i);
    if (p) return p;
    const b = this.json.buffers?.[i];
    if (!b) throw new Error(`glTF: buffer ${i} does not exist`);
    p = (async () => {
      let bytes;
      if (b.uri === undefined) {
        if (i !== 0 || !this.bin) throw new Error(`glTF: buffer ${i} has no uri and there is no binary chunk`);
        bytes = this.bin;
      } else if (b.uri.startsWith('data:')) bytes = decodeDataURI(b.uri).bytes;
      else bytes = await this.loader.readFile(this.resolve(b.uri));
      if (bytes.length < b.byteLength) throw new Error(`glTF: buffer ${i} is ${bytes.length} bytes, the file says ${b.byteLength}`);
      return bytes;
    })();
    this.cache.buffers.set(i, p);
    return p;
  }

  resolve(uri) {
    const rel = decodeURI(uri);
    if (this.loader.platform?.resolve) return this.loader.platform.resolve(this.baseUrl, rel);
    return /^([a-z]+:)?\/\//i.test(rel) || rel.startsWith('/') ? rel : this.baseUrl + rel;
  }

  /** All buffers are read up front, then accessors are plain synchronous slices. */
  async loadBuffers() {
    await Promise.all((this.json.buffers ?? []).map((_, i) => this.buffer(i)));
    this.buffers = await Promise.all((this.json.buffers ?? []).map((_, i) => this.buffer(i)));
  }

  /** The bytes of a bufferView. */
  view(i) {
    const v = this.json.bufferViews?.[i];
    if (!v) throw new Error(`glTF: bufferView ${i} does not exist`);
    const buf = this.buffers[v.buffer];
    if (!buf) throw new Error(`glTF: bufferView ${i} points at missing buffer ${v.buffer}`);
    const start = v.byteOffset ?? 0;
    if (start + v.byteLength > buf.length) throw new Error(`glTF: bufferView ${i} runs past the end of buffer ${v.buffer}`);
    return { bytes: buf.subarray(start, start + v.byteLength), stride: v.byteStride ?? 0, buffer: buf, start };
  }

  accessor(i) {
    const hit = this.cache.acc.get(i);
    if (hit) return hit;
    const a = this.json.accessors?.[i];
    if (!a) throw new Error(`glTF: accessor ${i} does not exist`);
    const Ctor = ARRAYS[a.componentType];
    if (!Ctor) throw new Error(`glTF: accessor ${i} has unknown componentType ${a.componentType}`);
    const n = TYPE_SIZE[a.type];
    if (!n) throw new Error(`glTF: accessor ${i} has unknown type ${a.type}`);
    const comp = Ctor.BYTES_PER_ELEMENT, count = a.count;
    const out = new Ctor(count * n);
    if (a.bufferView !== undefined) {
      const { bytes, stride } = this.view(a.bufferView);
      // matrices keep every column 4-byte aligned
      let cols = 1, rows = n, colStride = n * comp;
      if (a.type === 'MAT2') { cols = 2; rows = 2; colStride = Math.ceil((2 * comp) / 4) * 4; }
      else if (a.type === 'MAT3') { cols = 3; rows = 3; colStride = Math.ceil((3 * comp) / 4) * 4; }
      else if (a.type === 'MAT4') { cols = 4; rows = 4; colStride = 4 * comp; }
      const elemBytes = cols * colStride, step = stride || elemBytes, packed = elemBytes === n * comp, off = a.byteOffset ?? 0;
      if (count > 0 && off + (count - 1) * step + elemBytes > bytes.length + (packed ? 0 : colStride - rows * comp)) throw new Error(`glTF: accessor ${i} runs past the end of its bufferView`);
      const out8 = new Uint8Array(out.buffer);
      if (packed && step === elemBytes) out8.set(bytes.subarray(off, off + count * elemBytes));
      else if (packed) for (let k = 0; k < count; k++) out8.set(bytes.subarray(off + k * step, off + k * step + elemBytes), k * elemBytes);
      else for (let k = 0; k < count; k++) for (let c = 0; c < cols; c++) { const s = off + k * step + c * colStride; out8.set(bytes.subarray(s, s + rows * comp), (k * cols + c) * rows * comp); }
    }
    if (a.sparse) {
      const sp = a.sparse, IC = ARRAYS[sp.indices.componentType];
      const iv = this.view(sp.indices.bufferView), vv = this.view(sp.values.bufferView);
      const idx = new IC(sp.count);
      new Uint8Array(idx.buffer).set(iv.bytes.subarray(sp.indices.byteOffset ?? 0, (sp.indices.byteOffset ?? 0) + sp.count * IC.BYTES_PER_ELEMENT));
      const vals = new Ctor(sp.count * n);
      new Uint8Array(vals.buffer).set(vv.bytes.subarray(sp.values.byteOffset ?? 0, (sp.values.byteOffset ?? 0) + sp.count * n * comp));
      for (let k = 0; k < sp.count; k++) for (let c = 0; c < n; c++) out[idx[k] * n + c] = vals[k * n + c];
    }
    const acc = { array: out, itemSize: n, count, normalized: !!a.normalized, componentType: a.componentType };
    this.cache.acc.set(i, acc);
    return acc;
  }

  // ------------------------------------------------------------------------------------------ textures
  async imageSource(i) {
    let p = this.cache.img.get(i);
    if (p) return p;
    p = (async () => {
      const im = this.json.images?.[i];
      if (!im) throw new Error(`image ${i} does not exist`);
      let bytes, mime = im.mimeType ?? '';
      if (im.bufferView !== undefined) bytes = this.view(im.bufferView).bytes;
      else if (im.uri?.startsWith('data:')) { const d = decodeDataURI(im.uri); bytes = d.bytes; mime ||= d.mime; }
      else if (im.uri) { bytes = await this.loader.readFile(this.resolve(im.uri)); mime ||= mimeFromName(im.uri); }
      else throw new Error(`image ${i} has no data`);
      return this.loader.decodeImage(bytes, mime);
    })();
    this.cache.img.set(i, p);
    return p;
  }

  /** A Texture for glTF texture `i` (null when it cannot be decoded and strictTextures is off). */
  async texture(i) {
    if (i === undefined || i === null) return null;
    let p = this.cache.tex.get(i);
    if (p) return p;
    p = (async () => {
      const t = this.json.textures?.[i];
      if (!t) throw new Error(`glTF: texture ${i} does not exist`);
      const ext = t.extensions ?? {};
      let source = t.source;
      if (ext.EXT_texture_webp?.source !== undefined) source = ext.EXT_texture_webp.source;
      if (source === undefined && ext.KHR_texture_basisu) throw new Error(`texture ${i} only exists as a Basis Universal / KTX2 image`);
      if (source === undefined) throw new Error(`texture ${i} has no image`);
      let img;
      try { img = await this.imageSource(source); } catch (e) {
        if (this.opts.strictTextures) throw new Error(`glTF texture ${i}: ${e.message}`);
        this.warn(`texture ${i}${t.name ? ` "${t.name}"` : ''} not loaded: ${e.message}`);
        return null;
      }
      const tex = new Texture(img.data && !img.close ? { width: img.width, height: img.height, data: img.data } : img);
      tex.name = t.name ?? this.json.images?.[source]?.name ?? '';
      tex.flipY = false;                                    // glTF's V axis points down, like the image rows
      const s = t.sampler !== undefined ? this.json.samplers?.[t.sampler] : null;
      if (s) {
        tex.wrapS = wrapOf(s.wrapS); tex.wrapT = wrapOf(s.wrapT);
        tex.magFilter = s.magFilter === 9728 ? NearestFilter : LinearFilter;
        const mf = s.minFilter;
        tex.minFilter = mf === 9728 || mf === 9984 || mf === 9986 ? NearestFilter : mf === 9729 ? LinearFilter : LinearMipmapLinearFilter;
        tex.generateMipmaps = !(mf === 9728 || mf === 9729);
      }
      tex.needsUpdate = true;
      tex.userData.gltfImage = source;
      return tex;
    })();
    this.cache.tex.set(i, p);
    return p;
  }

  /** Raw RGBA8 pixels of a decoded image (needed to repack occlusion + metallic-roughness), or null. */
  pixels(img) {
    if (img?.data) return { w: img.width, h: img.height, data: img.data };
    try {
      if (typeof OffscreenCanvas !== 'undefined' && img?.width) {
        const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height);
        return { w: d.width, h: d.height, data: d.data };
      }
    } catch { /* fall through */ }
    return null;
  }

  /** Occlusion (R) from one texture, roughness / metalness (G / B) from another, in the layout the shaders read. */
  async packedORM(aoIndex, mrIndex) {
    const key = `${aoIndex}|${mrIndex}`;
    let p = this.cache.orm.get(key);
    if (p) return p;
    p = (async () => {
      const ao = await this.texture(aoIndex), mr = mrIndex === undefined ? null : await this.texture(mrIndex);
      const aoPx = ao && this.pixels(ao.image), mrPx = mr && this.pixels(mr.image);
      if (!aoPx || (mr && !mrPx)) { this.warn('a separate occlusion texture could not be packed (the platform cannot read decoded pixels); ambient occlusion from the texture is ignored'); return mr; }
      const W = mrPx ? mrPx.w : aoPx.w, H = mrPx ? mrPx.h : aoPx.h, out = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) {
        const ay = Math.min(aoPx.h - 1, Math.floor((y * aoPx.h) / H));
        for (let x = 0; x < W; x++) {
          const ax = Math.min(aoPx.w - 1, Math.floor((x * aoPx.w) / W)), o = (y * W + x) * 4;
          out[o] = aoPx.data[(ay * aoPx.w + ax) * 4];
          out[o + 1] = mrPx ? mrPx.data[o + 1] : 255;
          out[o + 2] = mrPx ? mrPx.data[o + 2] : 255;
          out[o + 3] = 255;
        }
      }
      const base = mr ?? ao;
      const t = new Texture({ width: W, height: H, data: out });
      t.wrapS = base.wrapS; t.wrapT = base.wrapT; t.magFilter = base.magFilter; t.minFilter = base.minFilter; t.generateMipmaps = base.generateMipmaps;
      t.flipY = false; t.name = `${base.name || 'orm'} (packed)`; t.needsUpdate = true;
      return t;
    })();
    this.cache.orm.set(key, p);
    return p;
  }

  // ------------------------------------------------------------------------------------------ materials
  async makeMaterials() {
    const mats = this.json.materials ?? [];
    this.out.materials = await Promise.all(mats.map((m, i) => this.material(m, i)));
    this.out.textures = await Promise.all((this.json.textures ?? []).map((_, i) => this.texture(i)));
  }

  async material(m, index) {
    const M = new StandardMaterial();
    M.name = m.name ?? `material${index}`;
    const ext = m.extensions ?? {};
    const pbr = m.pbrMetallicRoughness ?? {};
    const bc = pbr.baseColorFactor ?? [1, 1, 1, 1];
    M.color.setRGB(bc[0], bc[1], bc[2]); M.opacity = bc[3];
    M.metalness = pbr.metallicFactor ?? 1;
    M.roughness = pbr.roughnessFactor ?? 1;
    const uv1 = (info) => { if (info && (info.texCoord ?? 0) !== 0) this.warn('a second UV set (texCoord 1) is not supported; that texture is read with the first'); };

    if (pbr.baseColorTexture) {
      uv1(pbr.baseColorTexture);
      const t = await this.texture(pbr.baseColorTexture.index);
      if (t) {
        const tt = pbr.baseColorTexture.extensions?.KHR_texture_transform;
        if (tt) {
          const c = t.clone(); c.userData = { ...t.userData };
          if (tt.offset) c.offset.set(tt.offset[0], tt.offset[1]);
          if (tt.scale) c.repeat.set(tt.scale[0], tt.scale[1]);
          c.rotation = tt.rotation ?? 0;
          c.needsUpdate = true;
          M.map = c;
        } else M.map = t;
      }
    }
    // roughness (G) and metalness (B) share one texture; baked occlusion (R) rides along when it is the same one
    const mrInfo = pbr.metallicRoughnessTexture, aoInfo = m.occlusionTexture;
    if (mrInfo) uv1(mrInfo);
    if (aoInfo) uv1(aoInfo);
    let orm = null;
    if (mrInfo && aoInfo && aoInfo.index !== mrInfo.index) orm = await this.packedORM(aoInfo.index, mrInfo.index);
    else if (!mrInfo && aoInfo) orm = await this.packedORM(aoInfo.index, undefined);
    else if (mrInfo) orm = await this.texture(mrInfo.index);
    if (orm) {
      M.roughnessMap = orm; M.metalnessMap = orm;
      if (aoInfo) { M.aoMap = orm; M.aoMapIntensity = aoInfo.strength ?? 1; }
    }
    if (m.normalTexture) {
      uv1(m.normalTexture);
      const t = await this.texture(m.normalTexture.index);
      if (t) { M.normalMap = t; const s = m.normalTexture.scale ?? 1; M.normalScale.set(s, s); }
    }
    const em = m.emissiveFactor ?? [0, 0, 0];
    M.emissive.setRGB(em[0], em[1], em[2]);
    if (m.emissiveTexture) { uv1(m.emissiveTexture); M.emissiveMap = await this.texture(m.emissiveTexture.index); if (M.emissiveMap && !m.emissiveFactor) M.emissive.setRGB(1, 1, 1); }
    if (ext.KHR_materials_emissive_strength) M.emissiveIntensity = ext.KHR_materials_emissive_strength.emissiveStrength ?? 1;

    switch (m.alphaMode) {
      case 'MASK': M.alphaTest = m.alphaCutoff ?? 0.5; break;
      case 'BLEND': M.transparent = true; break;
      default: M.opacity = 1;                               // OPAQUE ignores alpha entirely
    }
    M.side = m.doubleSided ? DoubleSide : FrontSide;

    if (ext.KHR_materials_unlit) M.unlit = true;
    if (ext.KHR_materials_clearcoat) M.clearcoat = ext.KHR_materials_clearcoat.clearcoatFactor ?? 0;
    if (ext.KHR_materials_sheen) { const sc = ext.KHR_materials_sheen.sheenColorFactor ?? [0, 0, 0]; M.sheen = Math.max(sc[0], sc[1], sc[2]); }
    if (ext.KHR_materials_specular) M.specularIntensity = ext.KHR_materials_specular.specularFactor ?? 1;
    for (const e of ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_iridescence', 'KHR_materials_anisotropy']) {
      if (ext[e]) this.warn(`${e} is ignored (material "${M.name}")`, `${e}`);
    }
    const sg = ext.KHR_materials_pbrSpecularGlossiness;
    if (sg) {
      this.warn('KHR_materials_pbrSpecularGlossiness is approximated as metallic-roughness (diffuse colour, roughness = 1 - glossiness, no specular colour)', 'sg');
      const d = sg.diffuseFactor ?? [1, 1, 1, 1];
      M.color.setRGB(d[0], d[1], d[2]); if (m.alphaMode === 'BLEND' || m.alphaMode === 'MASK') M.opacity = d[3];
      M.metalness = 0; M.roughness = 1 - (sg.glossinessFactor ?? 1);
      if (sg.diffuseTexture) M.map = await this.texture(sg.diffuseTexture.index);
    }
    if (m.extras) Object.assign(M.userData, m.extras);
    M.needsUpdate = true;
    return M;
  }

  /** The material for one primitive: the shared one, or a variant that needs vertex colours / flat shading. */
  materialFor(materialIndex, vertexColors, flat) {
    const key = `${materialIndex ?? -1}|${vertexColors ? 1 : 0}|${flat ? 1 : 0}`;
    let m = this.cache.mat.get(key);
    if (m) return m;
    if (materialIndex !== undefined && !this.out.materials[materialIndex]) throw new Error(`glTF: a primitive uses missing material ${materialIndex}`);
    let base = materialIndex === undefined ? this.cache.mat.get('default') : this.out.materials[materialIndex];
    if (!base) { base = new StandardMaterial({ metalness: 1, roughness: 1 }); base.name = 'default'; this.cache.mat.set('default', base); }   // the glTF default material: white, metallic 1, rough 1
    if (!vertexColors && !flat) m = base;
    else { m = base.clone(); m.vertexColors = vertexColors; m.flatShading = flat || base.flatShading; m.name = base.name; }
    this.cache.mat.set(key, m);
    return m;
  }

  // ------------------------------------------------------------------------------------------ geometry
  /** @returns {BufferGeometry|null} */
  geometry(meshIndex, primIndex) {
    const key = `${meshIndex}.${primIndex}`;
    if (this.cache.geo.has(key)) return this.cache.geo.get(key);
    const mesh = this.json.meshes[meshIndex], prim = mesh.primitives[primIndex];
    const mode = prim.mode ?? 4;
    let g = null;
    if (mode < 4) this.warn(`mesh "${mesh.name ?? meshIndex}": points and lines are not drawn`, `mode${mode}`);
    else if (prim.attributes?.POSITION === undefined) this.warn(`mesh "${mesh.name ?? meshIndex}" primitive ${primIndex} has no POSITION`);
    else {
      if (prim.extensions?.KHR_draco_mesh_compression) throw new Error('glTF: Draco-compressed primitive (KHR_draco_mesh_compression); decompress the file first');
      g = new BufferGeometry();
      g.name = mesh.name ?? `mesh${meshIndex}`;
      const A = prim.attributes;
      g.setAttribute('position', new Float32BufferAttribute(toFloat32(this.accessor(A.POSITION)), 3));
      if (A.NORMAL !== undefined) g.setAttribute('normal', new Float32BufferAttribute(toFloat32(this.accessor(A.NORMAL)), 3));
      if (A.TEXCOORD_0 !== undefined) g.setAttribute('uv', new Float32BufferAttribute(toFloat32(this.accessor(A.TEXCOORD_0)), 2));
      if (A.COLOR_0 !== undefined) { const c = this.accessor(A.COLOR_0); g.setAttribute('color', new Float32BufferAttribute(toFloat32(c), c.itemSize)); }
      if (A.JOINTS_0 !== undefined && A.WEIGHTS_0 !== undefined) {
        let j = this.accessor(A.JOINTS_0), w = toFloat32(this.accessor(A.WEIGHTS_0)), ja = j.array;
        if (A.JOINTS_1 !== undefined && A.WEIGHTS_1 !== undefined) {
          // eight influences per vertex: keep the strongest four
          const j1 = this.accessor(A.JOINTS_1).array, w1 = toFloat32(this.accessor(A.WEIGHTS_1)), n = j.count;
          const jo = new Uint16Array(n * 4), wo = new Float32Array(n * 4), cj = new Array(8), cw = new Array(8), ord = [0, 1, 2, 3, 4, 5, 6, 7];
          for (let v = 0; v < n; v++) {
            for (let k = 0; k < 8; k++) ord[k] = k;
            for (let k = 0; k < 4; k++) { cj[k] = ja[v * 4 + k]; cw[k] = w[v * 4 + k]; cj[k + 4] = j1[v * 4 + k]; cw[k + 4] = w1[v * 4 + k]; }
            ord.sort((a, b) => cw[b] - cw[a]);
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += cw[ord[k]];
            for (let k = 0; k < 4; k++) { jo[v * 4 + k] = cj[ord[k]]; wo[v * 4 + k] = sum > 0 ? cw[ord[k]] / sum : (k === 0 ? 1 : 0); }
          }
          this.warn('a mesh has 8 joint influences per vertex; only the strongest 4 are used', 'joints8');
          ja = jo; w = wo;
        } else if (ja instanceof Uint32Array) ja = Uint16Array.from(ja);
        g.setAttribute('skinIndex', new BufferAttribute(ja, 4));
        // weights that do not add up to one would stretch the skin
        for (let v = 0; v < w.length; v += 4) {
          const s = w[v] + w[v + 1] + w[v + 2] + w[v + 3];
          if (s > 0 && Math.abs(s - 1) > 1e-3) { const k = 1 / s; w[v] *= k; w[v + 1] *= k; w[v + 2] *= k; w[v + 3] *= k; }
        }
        g.setAttribute('skinWeight', new Float32BufferAttribute(w, 4));
      }
      // indices
      let idx = prim.indices !== undefined ? this.accessor(prim.indices).array : null;
      if (mode === 5 || mode === 6) {
        const n = g.attributes.position.count;
        if (!idx) { idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
        idx = stripToTriangles(idx, mode === 6);
      }
      if (idx) {
        if (idx instanceof Uint32Array) g.setIndex(new Uint32BufferAttribute(idx, 1));
        else g.setIndex(new Uint16BufferAttribute(idx instanceof Uint16Array ? idx : Uint16Array.from(idx), 1));
      }
      // morph targets (position deltas)
      if (prim.targets?.length) {
        g.morphAttributes.position = prim.targets.map((t, k) => {
          if (t.POSITION === undefined) return new Float32BufferAttribute(new Float32Array(g.attributes.position.array.length), 3);
          return new Float32BufferAttribute(toFloat32(this.accessor(t.POSITION)), 3);
        });
        g.morphTargetsRelative = true;
        if (mesh.extras?.targetNames) g.userData.morphNames = mesh.extras.targetNames.slice();
        if (prim.targets.some((t) => t.NORMAL !== undefined)) this.warn('morph target normals are ignored', 'morphNormals');
      }
      if (prim.extras) Object.assign(g.userData, prim.extras);
    }
    this.cache.geo.set(key, g);
    return g;
  }

  // ------------------------------------------------------------------------------------------ nodes
  /**
   * One object per glTF node. A node that carries a single thing (one primitive, a camera, a light) *is* that object;
   * a node with several things, or a joint that also has a mesh, becomes a Group / Bone with the things as children.
   */
  makeNodes() {
    const O = this.out, nodes = this.json.nodes ?? [];
    this.meshParts = new Map();                              // node index -> Mesh objects that carry the node's morph weights
    this.pendingBinds = [];                                  // SkinnedMesh + skin index, bound once the skeletons exist
    nodes.forEach((n, i) => {
      const name = this.uniqueName(n.name, `node${i}`);
      const lightRef = n.extensions?.KHR_lights_punctual?.light;
      const meshDef = n.mesh !== undefined ? this.json.meshes?.[n.mesh] : undefined;
      if (n.mesh !== undefined && !meshDef) throw new Error(`glTF: node ${i} uses missing mesh ${n.mesh}`);
      const parts = meshDef ? this.makeMeshParts(i, n, meshDef) : [];
      const payload = parts.length + (n.camera !== undefined ? 1 : 0) + (lightRef !== undefined ? 1 : 0);
      let host;
      if (this.jointNodes.has(i)) host = new Bone();
      else if (payload === 1 && parts.length === 1) host = parts.pop();
      else if (payload === 1 && n.camera !== undefined) host = this.camera(n.camera);
      else if (payload === 1 && lightRef !== undefined) host = this.light(lightRef);
      else host = new Group();
      host.name = name;
      if (n.matrix) _m.fromArray(n.matrix).decompose(host.position, host.quaternion, host.scale);
      else {
        if (n.translation) host.position.fromArray(n.translation);
        if (n.rotation) host.quaternion.fromArray(n.rotation);
        if (n.scale) host.scale.fromArray(n.scale);
      }
      // what the host does not embed becomes a child
      const all = host.isMesh ? [host] : [];
      for (const part of parts) { part.name = this.uniqueName(`${name}.${meshDef.name ?? 'mesh'}${meshDef.primitives.length > 1 ? parts.indexOf(part) : ''}`, `${name}.mesh`); host.add(part); all.push(part); }
      if (n.camera !== undefined && !host.isCamera) { const c = this.camera(n.camera); c.name = this.uniqueName(`${name}.camera`, `${name}.camera`); host.add(c); }
      if (lightRef !== undefined && !host.isLight) { const l = this.light(lightRef); l.name = this.uniqueName(`${name}.light`, `${name}.light`); host.add(l); }
      if (all.length) this.meshParts.set(i, all);
      if (meshDef?.extras) Object.assign(host.userData, meshDef.extras);
      if (n.extras) Object.assign(host.userData, n.extras);
      host.userData.gltfNode = i;
      O.nodes[i] = host;
    });
  }

  /** Mesh objects for the primitives of one mesh node (SkinnedMesh when the node has a skin; bound later). */
  makeMeshParts(nodeIndex, n, meshDef) {
    const weights = n.weights ?? meshDef.weights, parts = [];
    let infl = null;
    meshDef.primitives.forEach((prim, k) => {
      const geo = this.geometry(n.mesh, k);
      if (!geo) return;
      const mat = this.materialFor(prim.material, prim.attributes.COLOR_0 !== undefined, prim.attributes.NORMAL === undefined);
      const skinned = n.skin !== undefined && !!geo.attributes.skinIndex;
      const mesh = skinned ? new SkinnedMesh(geo, mat) : new Mesh(geo, mat);
      mesh.castShadow = this.opts.castShadow; mesh.receiveShadow = this.opts.receiveShadow;
      const cnt = geo.morphAttributes.position?.length ?? 0;
      if (cnt) {
        // every primitive of a glTF mesh shares one weights array: an animation writes to a single place
        infl ??= Array.from({ length: cnt }, (_, q) => weights?.[q] ?? 0);
        mesh.morphTargetInfluences = infl;
      }
      if (skinned) this.pendingBinds.push({ mesh, skin: n.skin });
      parts.push(mesh);
    });
    return parts;
  }

  linkNodes() {
    const nodes = this.json.nodes ?? [];
    nodes.forEach((n, i) => { for (const c of n.children ?? []) { const ch = this.out.nodes[c]; if (!ch) throw new Error(`glTF: node ${i} has a missing child ${c}`); this.out.nodes[i].add(ch); } });
  }

  camera(index) {
    const c = this.json.cameras?.[index];
    if (!c) throw new Error(`glTF: camera ${index} does not exist`);
    let cam;
    if (c.type === 'orthographic') {
      const o = c.orthographic;
      cam = new OrthographicCamera(-o.xmag, o.xmag, o.ymag, -o.ymag, o.znear, o.zfar);
    } else {
      const p = c.perspective;
      cam = new PerspectiveCamera((p.yfov * 180) / Math.PI, p.aspectRatio ?? 1, p.znear, p.zfar ?? Infinity);
    }
    this.out.cameras.push(cam);
    return cam;
  }

  light(index) {
    const defs = this.json.extensions?.KHR_lights_punctual?.lights;
    const d = defs?.[index];
    if (!d) throw new Error(`glTF: light ${index} does not exist`);
    const color = d.color ?? [1, 1, 1], k = this.opts.lightScale, intensity = (d.intensity ?? 1) * k;
    let l;
    if (d.type === 'directional') {
      l = new DirectionalLight(0xffffff, intensity);
      l.position.set(0, 0, 0); l.target.position.set(0, 0, -1);   // light travels down the node's -Z
    } else if (d.type === 'spot') {
      const outer = d.spot?.outerConeAngle ?? Math.PI / 4, inner = d.spot?.innerConeAngle ?? 0;
      l = new SpotLight(0xffffff, intensity, d.range || 50, outer, outer > 0 ? Math.min(1, Math.max(0, 1 - inner / outer)) : 0);
      l.target.position.set(0, 0, -1);
    } else l = new PointLight(0xffffff, intensity, d.range || 50);
    l.color.setRGB(color[0], color[1], color[2]);
    if (d.name) l.userData.lightName = d.name;
    if (l.target) l.add(l.target);                         // the target must live in the graph to follow the node
    this.out.lights.push(l);
    return l;
  }

  makeSkins() {
    const O = this.out;
    O.skeletons = (this.json.skins ?? []).map((s, i) => {
      const bones = (s.joints ?? []).map((j) => O.nodes[j]);
      let inv;
      if (s.inverseBindMatrices !== undefined) {
        const a = this.accessor(s.inverseBindMatrices).array;
        inv = bones.map((_, k) => new Matrix4().fromArray(a, k * 16));
      } else inv = bones.map(() => new Matrix4());
      const sk = new Skeleton(bones, inv);
      sk.name = s.name ?? `skin${i}`;
      return sk;
    });
    // glTF: the skin's joints place the mesh; the mesh node's own transform is ignored (identity bind matrix)
    for (const { mesh, skin } of this.pendingBinds) {
      const sk = O.skeletons[skin];
      if (!sk) throw new Error(`glTF: a mesh uses missing skin ${skin}`);
      mesh.bind(sk, new Matrix4());
    }
  }

  // ------------------------------------------------------------------------------------------ animation
  makeAnimations() {
    const J = this.json, O = this.out, fps = this.opts.animationFps;
    O.animations = (J.animations ?? []).map((a, ai) => {
      const tracks = [];
      let duration = 0;
      for (const ch of a.channels ?? []) {
        const tgt = ch.target, node = tgt?.node;
        if (node === undefined) continue;                  // KHR_animation_pointer and friends
        const path = tgt.path;
        if (!['translation', 'rotation', 'scale', 'weights'].includes(path)) { this.warn(`animation "${a.name ?? ai}": target path ${path} is ignored`, `path${path}`); continue; }
        const smp = a.samplers?.[ch.sampler];
        if (!smp) throw new Error(`glTF: animation ${ai} channel uses a missing sampler`);
        const obj = O.nodes[node];
        if (!obj) throw new Error(`glTF: animation ${ai} targets a missing node ${node}`);
        const times = this.accessor(smp.input).array, outAcc = this.accessor(smp.output), interp = smp.interpolation ?? 'LINEAR';
        const out = toFloat32(outAcc);
        const kind = path === 'translation' ? 'position' : path === 'rotation' ? 'quaternion' : path === 'scale' ? 'scale' : 'weights';
        let size = kind === 'quaternion' ? 4 : kind === 'weights' ? 0 : 3;
        if (kind === 'weights') {
          const mesh = J.meshes?.[J.nodes[node].mesh];
          size = mesh?.primitives?.[0]?.targets?.length ?? mesh?.weights?.length ?? 0;
          if (!size) { this.warn(`animation "${a.name ?? ai}": weights track on a node without morph targets`); continue; }
        }
        const target = kind === 'weights' ? this.weightsTarget(node) : obj;
        const tr = this.track(target.name, kind, size, times, out, interp, fps);
        if (!tr) continue;
        tracks.push(tr);
        duration = Math.max(duration, tr.duration);
      }
      const clip = new AnimationClip(a.name ?? `animation${ai}`, tracks, { duration, loop: false, rootBone: this.opts.rootBone, rootMotion: 'none', meta: { source: 'gltf', index: ai } });
      return clip;
    });
  }

  /** The object that carries a mesh node's morph weights (the node itself, or its first mesh part). */
  weightsTarget(node) {
    const parts = this.meshParts.get(node);
    return parts?.[0] ?? this.out.nodes[node];
  }

  /** One glTF sampler -> a Track of linear keys. */
  track(name, kind, size, times, out, interp, fps) {
    const n = times.length;
    if (!n) return null;
    if (interp === 'CUBICSPLINE') {
      // [in-tangent, value, out-tangent] per key: bake the Hermite curve to linear keys
      const T = [], V = [];
      for (let k = 0; k < n - 1; k++) {
        const t0 = times[k], t1 = times[k + 1], dt = t1 - t0, steps = Math.max(1, Math.ceil(dt * fps));
        for (let s = 0; s < steps; s++) {
          const u = s / steps, u2 = u * u, u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
          T.push(t0 + u * dt);
          const row = [];
          for (let c = 0; c < size; c++) {
            const v0 = out[(k * 3 + 1) * size + c], b0 = out[(k * 3 + 2) * size + c], v1 = out[((k + 1) * 3 + 1) * size + c], a1 = out[((k + 1) * 3) * size + c];
            row.push(h00 * v0 + h10 * dt * b0 + h01 * v1 + h11 * dt * a1);
          }
          if (kind === 'quaternion') { const l = Math.hypot(row[0], row[1], row[2], row[3]) || 1; for (let c = 0; c < 4; c++) row[c] /= l; }
          V.push(...row);
        }
      }
      T.push(times[n - 1]);
      V.push(...Array.from(out.subarray((((n - 1) * 3) + 1) * size, (((n - 1) * 3) + 2) * size)));
      return new Track(name, kind, V, T, 0, size);
    }
    if (interp === 'STEP' && n > 1) {
      const T = [], V = [];
      for (let k = 0; k < n; k++) {
        T.push(times[k]); for (let c = 0; c < size; c++) V.push(out[k * size + c]);
        if (k < n - 1) {
          const eps = Math.min(1e-4, (times[k + 1] - times[k]) * 0.01);
          T.push(times[k + 1] - eps); for (let c = 0; c < size; c++) V.push(out[k * size + c]);
        }
      }
      return new Track(name, kind, V, T, 0, size);
    }
    if (out.length < n * size) throw new Error(`glTF: animation output for "${name}" has ${out.length} values for ${n} keys`);
    return new Track(name, kind, out.slice(0, n * size), times, 0, size);
  }
}

const _m = new Matrix4();

void FrontSide; void Object3D;
