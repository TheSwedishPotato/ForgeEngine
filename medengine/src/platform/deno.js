/**
 * Deno platform: Med Engine as a native program.
 *
 * Two modes:
 *
 *   headless   `new DenoPlatform({ headless: true })` - renders into an offscreen texture with Deno's own WebGPU (wgpu).
 *              Used for tests, captures and benchmarks; works on any machine that has a GPU or a software Vulkan driver.
 *              Run it with:  deno run --unstable-webgpu -A main.js
 *
 *   windowed   `new DenoPlatform({ title: 'My game', width: 1280, height: 720 })` - a native window through Deno 2.9's
 *              `deno desktop` with the "raw" backend (no web engine: Deno hands the engine a window, keyboard / mouse
 *              events and a WebGPU surface). deno.json:
 *                { "desktop": { "backend": "raw" }, "unstable": ["webgpu"] }
 *              Build and run:  deno desktop main.js   (produces one executable / app bundle per OS)
 *
 *   STATUS: the headless mode is tested (tests run on Deno's wgpu as well as on Dawn). The windowed mode follows the API in
 *   Deno's documentation but could NOT be run where this engine was written (no display, and `deno desktop` downloads its
 *   backend). Treat it as a first draft: the likeliest things to need a fix are the event field names (the docs say the
 *   events "mirror their browser equivalents") and the pointer / gamepad support the raw backend does not document.
 *   A fallback that needs no such assumptions is the CEF backend (`deno desktop --backend cef`): it opens a Chromium window
 *   on the same page the browser build uses, with BrowserPlatform, full WebGPU and gamepads.
 */
import { Platform, Surface } from './Platform.js';
import { HeadlessSurface } from './node.js';
import { decodePNG, encodePNG } from './png.js';

/** KeyboardEvent.key -> .code, for windows whose key events carry only `key`. */
function codeFromKey(key) {
  if (!key) return '';
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/[0-9]/.test(key)) return `Digit${key}`;
    if (key === ' ') return 'Space';
    return { '-': 'Minus', '=': 'Equal', ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote' }[key] ?? key;
  }
  return { Control: 'ControlLeft', Shift: 'ShiftLeft', Alt: 'AltLeft', Meta: 'MetaLeft', Esc: 'Escape' }[key] ?? key;
}

export class DenoPlatform extends Platform {
  /**
   * @param {object} [o]
   * @param {boolean} [o.headless]  offscreen only (default: true when `Deno.BrowserWindow` is not available)
   * @param {number} [o.width]      pixels (1280)
   * @param {number} [o.height]     pixels (720)
   * @param {number} [o.dpr]        device pixel ratio (1)
   * @param {string} [o.title]      window title
   * @param {string} [o.format]     headless surface format, default 'rgba8unorm'
   * @param {boolean} [o.exitOnClose] exit the process when the window is closed (default true; a surface only hides on close)
   * @param {number} [o.maxFps]     frame limiter for windowed mode, 0 = leave it to the display's vertical sync
   */
  constructor({ headless = undefined, width = 1280, height = 720, dpr = 1, title = 'Med Engine', format = 'rgba8unorm', exitOnClose = true, maxFps = 0 } = {}) {
    super();
    this.name = 'deno';
    const hasWindow = typeof Deno !== 'undefined' && typeof Deno.BrowserWindow === 'function';
    this.headless = headless ?? !hasWindow;
    this.opts = { width, height, dpr, format, title, exitOnClose, maxFps };
    this.capabilities = { windowed: !this.headless, pointerLock: false, gamepad: false, fileWrite: true, jpeg: typeof createImageBitmap === 'function' };
    this.window = null;
    this._store = {};
    this.storage = {
      get: (k) => { try { return localStorage.getItem(k); } catch { return this._store[k] ?? null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); } catch { this._store[k] = v; } },
      remove: (k) => { try { localStorage.removeItem(k); } catch { delete this._store[k]; } },
    };
    this._lastX = 0; this._lastY = 0; this._frameAt = 0;
  }

  async getGPU() {
    if (!navigator.gpu) throw new Error('DenoPlatform: navigator.gpu is missing. Run deno with --unstable-webgpu (or "unstable": ["webgpu"] in deno.json).');
    return navigator.gpu;
  }

  createSurface(opts = {}) {
    if (this.headless) return new HeadlessSurface({ ...this.opts, ...opts });
    if (!this.window) this._openWindow();
    return new DenoWindowSurface(this, this.window);
  }

  now() { return performance.now(); }

  requestFrame(cb) {
    const gap = this.opts.maxFps > 0 ? 1000 / this.opts.maxFps : 0;
    const wait = Math.max(0, this._frameAt + gap - this.now());
    return setTimeout(() => { this._frameAt = this.now(); cb(this._frameAt); }, wait);
  }
  cancelFrame(h) { clearTimeout(h); }

  // ------------------------------------------------------------------------------------------ files
  _path(path) {
    if (path instanceof URL) return path;
    if (path.startsWith('file://')) return new URL(path);
    return path;
  }
  async readFile(path) {
    if (typeof path === 'string' && /^https?:\/\//.test(path)) {
      const r = await fetch(path);
      if (!r.ok) throw new Error(`readFile ${path}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }
    return Deno.readFile(this._path(path));
  }
  async writeFile(path, bytes) {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    if (i > 0) await Deno.mkdir(path.slice(0, i), { recursive: true });
    await Deno.writeFile(path, bytes);
  }
  async exists(path) { try { await Deno.stat(this._path(path)); return true; } catch { return false; } }
  async listDir(path) { const out = []; for await (const e of Deno.readDir(this._path(path))) out.push(e.name); return out; }

  async decodeImage(bytes, mime = '') {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const zlib = this.zlib ??= await import('node:zlib');
    if (u8[0] === 137 && u8[1] === 80) return decodePNG(u8, zlib);          // PNG: our own decoder gives exact pixels
    if (typeof createImageBitmap !== 'function') throw new Error(`DenoPlatform.decodeImage: no decoder for ${mime || 'this image'} (PNG only)`);
    return createImageBitmap(new Blob([u8], mime ? { type: mime } : undefined), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }
  async encodePNG(img) { return encodePNG(img, this.zlib ??= await import('node:zlib')); }

  // ------------------------------------------------------------------------------------------ window
  _openWindow() {
    const { width, height, title } = this.opts;
    const win = this.window = new Deno.BrowserWindow({ title, width, height });
    const on = (type, fn) => win.addEventListener(type, fn);
    const mods = (e) => (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
    const pos = (e) => [e.clientX ?? e.x ?? e.offsetX ?? e.detail?.x ?? 0, e.clientY ?? e.y ?? e.offsetY ?? e.detail?.y ?? 0];
    on('keydown', (e) => this.emit('key', { code: e.code || codeFromKey(e.key), key: e.key, down: true, repeat: !!e.repeat, mods: mods(e) }));
    on('keyup', (e) => this.emit('key', { code: e.code || codeFromKey(e.key), key: e.key, down: false, repeat: false, mods: mods(e) }));
    const ptr = (kind) => (e) => {
      const [x, y] = pos(e);
      const dx = e.movementX ?? (kind === 'move' ? x - this._lastX : 0), dy = e.movementY ?? (kind === 'move' ? y - this._lastY : 0);
      this._lastX = x; this._lastY = y;
      this.emit('pointer', { kind, id: 1, button: e.button ?? 0, buttons: e.buttons ?? (kind === 'up' ? 0 : 1), pointerType: 'mouse', x, y, dx, dy, mods: mods(e), pressure: kind === 'down' ? 0.5 : 0 });
    };
    on('mousedown', ptr('down')); on('mouseup', ptr('up')); on('mousemove', ptr('move'));
    on('wheel', (e) => this.emit('wheel', { dx: e.deltaX ?? 0, dy: e.deltaY ?? 0, mode: e.deltaMode ?? 0, mods: mods(e) }));
    on('focus', () => this.emit('focus', {}));
    on('blur', () => this.emit('blur', {}));
    on('close', () => { this.emit('close', {}); if (this.opts.exitOnClose) Deno.exit(0); });
    return win;
  }

  setTitle(t) { this.window?.setTitle?.(t); }
  setFullscreen(on) { this.window?.setFullscreen?.(on); }
  setPointerLock(on) { this.window?.setPointerLock?.(on); }       // not part of the documented raw backend: used when it exists
  setCursor(css) { this.window?.setCursor?.(css); }

  dispose() { try { this.window?.close(); } catch { /* already gone */ } }
}

/** The native window as a drawing target. */
class DenoWindowSurface extends Surface {
  constructor(platform, win) {
    super();
    this.transient = true;
    this.platform = platform; this.win = win;
    this.dpr = win.scaleFactor ?? win.getScaleFactor?.() ?? platform.opts.dpr ?? 1;
    this._measure();
    win.addEventListener('resize', (e) => {
      const w = e.detail?.width, h = e.detail?.height;
      if (this._measure(w, h)) { this._apply(); this._notify(); }
    });
  }
  _measure(w, h) {
    if (w == null || h == null) [w, h] = this.win.getSize();
    const pw = Math.max(1, Math.round(w * this.dpr)), ph = Math.max(1, Math.round(h * this.dpr));
    const changed = pw !== this.width || ph !== this.height;
    this.cssWidth = w; this.cssHeight = h; this.width = pw; this.height = ph;
    return changed;
  }
  _apply() { if (this.native) { this.native.width = this.width; this.native.height = this.height; } }
  configure(gpu) {
    // the adapter has already been requested by GPU.create(), which getNativeWindow() requires
    this.native = this.win.getNativeWindow();
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context = this.native.getContext('webgpu');
    this._apply();
    this.context.configure({ device: gpu.device, format: this.format, alphaMode: 'opaque', usage: 16 /* RENDER_ATTACHMENT */ | 4 /* TEXTURE_BINDING */ | 1 /* COPY_SRC */ });
  }
  getCurrentTexture() { return this.context.getCurrentTexture(); }
  present() { this.native.present(); }          // without it the window stays blank
  resize() { if (this._measure()) { this._apply(); this._notify(); } }
  destroy() { this.context?.unconfigure?.(); }
}
