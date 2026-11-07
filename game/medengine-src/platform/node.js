/**
 * Headless platform for Node: renders with Dawn (the engine Chrome uses) through the optional `webgpu`
 * package, into an offscreen texture. Used for tests, CI, server-side captures and benchmarks.
 *
 *   npm i webgpu            (optional peer dependency)
 *
 * On a machine without a GPU, point Vulkan at a software driver, e.g.
 *   VK_ICD_FILENAMES=/path/to/vk_swiftshader_icd.json
 * Input can be injected with `platform.emit('key', {...})`, `platform.injectKey()` etc., which is how
 * the tests and the replay tools drive a game.
 */
import { Platform, Surface } from './Platform.js';
import { decodePNG, encodePNG } from './png.js';
import { TEX } from '../gpu/Device.js';

export class NodePlatform extends Platform {
  /**
   * @param {object} [o]
   * @param {number} [o.width]    size of the offscreen target in pixels (default 1280)
   * @param {number} [o.height]   (default 720)
   * @param {number} [o.dpr]      device pixel ratio the game sees (default 1)
   * @param {string} [o.format]   surface texture format (default 'rgba8unorm')
   * @param {string | null} [o.storageFile]  a JSON file that `platform.storage` is kept in; by default it lives in memory only
   */
  constructor({ width = 1280, height = 720, dpr = 1, format = 'rgba8unorm', storageFile = null } = {}) {
    super();
    this.name = 'node';
    this.opts = { width, height, dpr, format };
    this.capabilities = { windowed: false, pointerLock: false, gamepad: false, fileWrite: true, jpeg: false };
    this._storageFile = storageFile;
    this._store = {};
    this.storage = {
      get: (k) => this._store[k] ?? null,
      set: (k, v) => { this._store[k] = v; this._save(); },
      remove: (k) => { delete this._store[k]; this._save(); },
    };
  }
  async _node() {
    this.fs ??= await import('node:fs/promises');
    this.fsSync ??= await import('node:fs');
    this.zlib ??= (await import('node:zlib')).default ?? (await import('node:zlib'));
    this.pathMod ??= await import('node:path');
    if (this._storageFile && !this._loaded) {
      this._loaded = true;
      try { this._store = JSON.parse(await this.fs.readFile(this._storageFile, 'utf8')); } catch { /* first run */ }
    }
  }
  _save() { if (this._storageFile) import('node:fs').then((fs) => fs.writeFileSync(this._storageFile, JSON.stringify(this._store))); }

  /**
   * Dawn's WebGPU entry point, from the optional `webgpu` package. Typed by hand so the declarations do not depend on
   * whether that package is installed.
   * @returns {Promise<GPU>}
   */
  async getGPU() {
    let mod;
    try { mod = await import('webgpu'); } catch (e) {
      throw new Error('NodePlatform: the optional "webgpu" package is not installed (npm i webgpu). ' + (e.message ?? ''));
    }
    Object.assign(globalThis, mod.globals);
    return mod.create(['enable-dawn-features=allow_unsafe_apis']);
  }
  createSurface(opts = {}) { return new HeadlessSurface({ ...this.opts, ...opts }); }
  now() { return performance.now(); }
  requestFrame(cb) { return setTimeout(() => cb(this.now()), 0); }

  async readFile(path) {
    await this._node();
    if (/^https?:\/\//.test(path)) { const r = await fetch(path); if (!r.ok) throw new Error(`readFile ${path}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
    if (path.startsWith('file://')) path = new URL(path).pathname;
    return new Uint8Array(await this.fs.readFile(path));
  }
  async writeFile(path, bytes) {
    await this._node();
    await this.fs.mkdir(this.pathMod.dirname(path), { recursive: true });
    await this.fs.writeFile(path, bytes);
  }
  async exists(path) { await this._node(); try { await this.fs.access(path); return true; } catch { return false; } }
  async listDir(path) { await this._node(); return this.fs.readdir(path); }

  async decodeImage(bytes, mime = '') {
    await this._node();
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const isPng = u8[0] === 137 && u8[1] === 80;
    if (!isPng) throw new Error(`NodePlatform.decodeImage: only PNG is decodable headless (got ${mime || 'unknown'}). Convert textures to PNG for headless runs; browsers decode JPEG/WebP natively.`);
    return decodePNG(u8, this.zlib);
  }
  async encodePNG(img) { await this._node(); return encodePNG(img, this.zlib); }
}

/** Offscreen "window": a texture the frame is rendered into; read it back for a screenshot. */
export class HeadlessSurface extends Surface {
  constructor({ width, height, dpr = 1, format = 'rgba8unorm' }) {
    super();
    this.dpr = dpr; this.format = format;
    this.cssWidth = width; this.cssHeight = height;
    this.width = Math.round(width * dpr); this.height = Math.round(height * dpr);
    this.texture = null;
  }
  configure(gpu) { this.gpu = gpu; this._make(); }
  _make() {
    this.texture?.destroy();
    this.texture = this.gpu.texture({ label: 'headless surface', size: [this.width, this.height], format: this.format, usage: TEX.RENDER | TEX.COPY_SRC | TEX.BINDING });
  }
  getCurrentTexture() { return this.texture; }
  resize(cssW, cssH) {
    this.cssWidth = cssW; this.cssHeight = cssH;
    this.width = Math.max(1, Math.round(cssW * this.dpr)); this.height = Math.max(1, Math.round(cssH * this.dpr));
    if (this.gpu) this._make();
    this._notify();
  }
  destroy() { this.texture?.destroy(); }
}
