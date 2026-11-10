/**
 * The asset pipeline: one place that loads, decodes, caches and reports progress for everything a game ships.
 *
 *   const assets = new AssetManager({ platform, baseUrl: 'assets/' });         // or use engine.assets
 *   const { knight, ground, run } = await assets.loadAll({
 *     knight: 'models/knight.glb',                 // glTF / GLB      -> GLTFAsset (scene, animations, skeletons, ...)
 *     ground: { url: 'tex/grass.png', srgb: true },// png / jpg / webp -> Texture
 *     run:    'clips/run.medclip',                 // .medclip         -> AnimationClip
 *     level:  'levels/arena.obj',                  // Wavefront OBJ    -> Group (its .mtl and textures load too)
 *     mocap:  'mocap/walk.bvh',                    // BVH              -> BVHData (retarget it with retargetBVH)
 *     table:  'data/items.json',                   // JSON, text, or raw bytes
 *   }, { onProgress: (p) => bar.value = p.done / p.total });
 *   const guard = assets.instantiate(knight);       // a copy with its own bones: spawn as many as you like
 *
 * Every request is cached by URL (and options): asking twice returns the same asset, and two requests in flight share one download.
 * File access goes through `platform.readFile`, so the same code loads from a web server in a browser, from disk in Node / Deno.
 */
import { Texture, ClampToEdgeWrapping, RepeatWrapping, MirroredRepeatWrapping } from '../scene/Material.js';
import { AnimationClip } from '../anim/Clip.js';
import { parseBVH } from '../anim/BVH.js';
import { GLTFLoader } from './GLTFLoader.js';
import { parseOBJ, parseMTL } from './ObjLoader.js';
import { cloneModel, disposeModel } from './clone.js';

/**
 * What `new AssetManager()` takes (and Engine's `assets` option).
 * @typedef {object} AssetManagerOptions
 * @property {string} [baseUrl]  prepended to relative paths
 * @property {object} [gltf]     options for the GLTFLoader: castShadow, lightScale, animationFps, strictTextures ...
 */

/** @import { Platform } from '../platform/Platform.js' */

/**
 * What a progress listener gets: how many loads started and finished, the bytes read, and the file that just finished.
 * @typedef {object} LoadProgress
 * @property {number} total   loads started
 * @property {number} done    loads finished (failed ones too)
 * @property {number} bytes   bytes read so far
 * @property {number} failed  loads that failed
 * @property {string} url     the file that just finished
 */

/**
 * One entry of a `loadAll` manifest: a path, or a path with its type (when the extension does not say) and the loader's options.
 * @typedef {string | ({ url: string, type?: string } & Record<string, any>)} AssetSpec
 */

const TYPE_BY_EXT = {
  glb: 'gltf', gltf: 'gltf', obj: 'obj', mtl: 'mtl', bvh: 'bvh', medclip: 'clip',
  png: 'texture', jpg: 'texture', jpeg: 'texture', webp: 'texture', gif: 'texture', bmp: 'texture', avif: 'texture',
  json: 'json', txt: 'text', md: 'text', csv: 'text', glsl: 'text', wgsl: 'text', story: 'text', svg: 'text', html: 'text', css: 'text', js: 'text', mjs: 'text',
};
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' };
const extOf = (url) => url.split(/[?#]/)[0].split('.').pop().toLowerCase();

export class AssetManager {
  /** @param {AssetManagerOptions & { platform: Platform }} o */
  constructor({ platform, baseUrl = '', gltf = {} } = {}) {
    if (!platform) throw new Error('AssetManager: a platform is required');
    this.platform = platform;
    this.baseUrl = baseUrl && !baseUrl.endsWith('/') ? `${baseUrl}/` : baseUrl;
    this.gltfOptions = gltf;
    /** Loaded assets by the names given to loadAll() */ this.named = {};
    /** Loads started / finished / bytes read, for loading bars. */ this.progress = { total: 0, done: 0, bytes: 0, failed: 0 };
    this._cache = new Map();
    this._listeners = new Set();
    /** Custom types: `assets.register('wav', 'audio', async (bytes, url, am) => ...)` */
    this._custom = new Map();
  }

  /** Resolves a path against `baseUrl`. */
  url(path) {
    if (path.startsWith('data:')) return path;
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path) || path.startsWith('/') || !this.baseUrl) return path;
    return this.platform.resolve ? this.platform.resolve(this.baseUrl, path) : this.baseUrl + path;
  }

  /** Teaches the manager a file type: `fn(bytes, url, assets, options) => asset`. */
  register(ext, type, fn) { TYPE_BY_EXT[ext.toLowerCase()] = type; this._custom.set(type, fn); return this; }

  /**
   * Subscribe to progress updates: fn({ total, done, bytes, failed, url }). Returns an unsubscribe function.
   * @param {(progress: LoadProgress) => void} fn
   * @returns {() => void}
   */
  onProgress(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _tick(url) { for (const f of this._listeners) f({ ...this.progress, url }); }

  async _read(url) {
    const bytes = await this.platform.readFile(url);
    this.progress.bytes += bytes.length ?? bytes.byteLength ?? 0;
    return bytes;
  }

  /**
   * Loads one asset (cached). `type` is detected from the extension: 'gltf' | 'texture' | 'obj' | 'mtl' | 'bvh' | 'clip' | 'json' | 'text' | 'bytes'.
   * @param {string} path
   * @param {string} [type]
   * @param {object} [options]  texture: { flipY, wrap: 'repeat'|'clamp'|'mirror', mipmaps, anisotropy, srgb (informational) };
   *                            obj: { scale }; gltf: GLTFLoader options for this load
   */
  load(path, type = null, options = {}) {
    const url = this.url(path);
    type ??= TYPE_BY_EXT[extOf(url)] ?? 'bytes';
    const key = `${type}|${url}|${Object.keys(options).length ? JSON.stringify(options) : ''}`;
    let p = this._cache.get(key);
    if (p) return p;
    this.progress.total++;
    p = this._load(url, type, options).then((a) => { this.progress.done++; this._tick(url); return a; }, (e) => {
      this.progress.done++; this.progress.failed++; this._cache.delete(key); this._tick(url);
      const err = new Error(`AssetManager: could not load '${path}' as ${type}: ${e.message}`);
      err.cause = e;
      throw err;
    });
    this._cache.set(key, p);
    return p;
  }

  async _load(url, type, o) {
    const custom = this._custom.get(type);
    if (custom) return custom(await this._read(url), url, this, o);
    switch (type) {
      case 'bytes': return this._read(url);
      case 'text': return new TextDecoder().decode(await this._read(url));
      case 'json': return JSON.parse(new TextDecoder().decode(await this._read(url)));
      case 'texture': return this._texture(url, o);
      case 'gltf': {
        const loader = new GLTFLoader({ platform: this.platform, readFile: (u) => this._read(u), ...this.gltfOptions, ...o });
        return loader.load(url);
      }
      case 'obj': return this._obj(url, o);
      case 'mtl': return parseMTL(new TextDecoder().decode(await this._read(url)));
      case 'bvh': return parseBVH(new TextDecoder().decode(await this._read(url)), url.split('/').pop().replace(/\.bvh$/i, ''));
      case 'clip': return AnimationClip.fromBinary(await this._read(url));
      default: throw new Error(`unknown asset type '${type}'`);
    }
  }

  async _texture(url, o = {}) {
    const bytes = await this._read(url);
    const img = await this.platform.decodeImage(bytes, MIME_BY_EXT[extOf(url)] ?? '');
    const t = new Texture(img.data && !img.close ? { width: img.width, height: img.height, data: img.data } : img);
    t.name = url.split('/').pop();
    t.flipY = o.flipY ?? true;                              // an image's first row is its top; textures want V = 1 there
    const wrap = { repeat: RepeatWrapping, clamp: ClampToEdgeWrapping, mirror: MirroredRepeatWrapping }[o.wrap ?? 'repeat'];
    t.wrapS = t.wrapT = wrap;
    if (o.mipmaps === false) t.generateMipmaps = false;
    if (o.anisotropy) t.anisotropy = o.anisotropy;
    if (o.linear) t.colorSpace = 'srgb-linear';
    t.needsUpdate = true;
    return t;
  }

  async _obj(url, o) {
    const text = new TextDecoder().decode(await this._read(url));
    // material libraries first: parseOBJ needs the materials, and their textures
    const libs = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);
    const materials = new Map();
    for (const lib of libs) {
      let mtl;
      try { mtl = await this.load(this.platform.resolve(url, lib), 'mtl'); } catch { continue; }       // a missing .mtl is not fatal
      for (const [name, m] of mtl.materials) {
        materials.set(name, m);
        const tex = mtl.textures.get(name) ?? {};
        for (const [slot, file] of Object.entries(tex)) {
          try { m[slot] = await this.load(this.platform.resolve(url, file), 'texture', { flipY: true }); } catch { /* texture missing: keep the colour */ }
        }
      }
    }
    return parseOBJ(text, { materials, scale: o.scale ?? 1 }).group;
  }

  /**
   * Loads a set of assets in parallel. `manifest`: { name: path | { url, type?, ...options } } or an array of paths.
   * @param {string[] | Record<string, AssetSpec>} manifest
   * @param {{ onProgress?: ((progress: LoadProgress) => void) | null }} [o]
   * @returns {Promise<Record<string, any>>}  the assets by name (by path for an array)
   */
  async loadAll(manifest, { onProgress = null } = {}) {
    const entries = Array.isArray(manifest) ? manifest.map((p) => [p, p]) : Object.entries(manifest);
    const off = onProgress ? this.onProgress(onProgress) : null;
    try {
      const out = {};
      await Promise.all(entries.map(async ([name, spec]) => {
        const { url, type, ...opts } = typeof spec === 'string' ? { url: spec } : spec;
        out[name] = this.named[name] = await this.load(url, type ?? null, opts);
      }));
      return out;
    } finally { off?.(); }
  }

  get(name) {
    if (!(name in this.named)) throw new Error(`AssetManager: nothing loaded as '${name}'`);
    return this.named[name];
  }
  has(name) { return name in this.named; }

  // -- typed shortcuts
  texture(path, options) { return this.load(path, 'texture', options); }
  model(path, options) { return this.load(path, 'gltf', options); }
  clip(path) { return this.load(path, 'clip'); }
  json(path) { return this.load(path, 'json'); }
  text(path) { return this.load(path, 'text'); }
  bytes(path) { return this.load(path, 'bytes'); }

  /**
   * An independent copy of a loaded model (a GLTFAsset, a name given to loadAll, or any Object3D): its own bones, morph weights and
   * transform; geometry, materials and textures are shared. Give each copy its own Animator.
   */
  instantiate(model) {
    if (typeof model === 'string') model = this.get(model);
    const root = model.scene ?? model;
    if (!root?.isObject3D) throw new Error('AssetManager.instantiate: expected a loaded glTF or an Object3D');
    return cloneModel(root);
  }

  /** Forgets one cached asset (it is loaded again next time); with `free`, models also release their GPU memory. */
  async unload(path, { free = false } = {}) {
    const url = this.url(path);
    for (const [key, p] of this._cache) {
      if (!key.includes(`|${url}|`)) continue;
      this._cache.delete(key);
      if (free) { try { const a = await p; const root = a?.scene ?? (a?.isObject3D ? a : null); if (root) disposeModel(root); else a?.dispose?.(); } catch { /* it never loaded */ } }
    }
  }

  /** Releases everything this manager loaded. */
  async dispose() {
    for (const p of this._cache.values()) {
      try { const a = await p; const root = a?.scene ?? (a?.isObject3D ? a : null); if (root) disposeModel(root); else a?.dispose?.(); } catch { /* ignore */ }
    }
    this._cache.clear(); this.named = {}; this._listeners.clear();
  }
}
