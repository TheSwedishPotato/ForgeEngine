/**
 * The platform layer: everything the engine needs from the machine it runs on, behind one interface.
 *
 *   window / surface   createSurface()      a canvas in a browser, an offscreen target headless, a native window on Deno
 *   GPU                getGPU()             navigator.gpu or a Dawn binding
 *   timing             now(), requestFrame()
 *   input              on('key' | 'pointer' | 'wheel' | 'blur' ...), gamepads(), setPointerLock()
 *   file I/O           readFile(), readText(), writeFile(), decodeImage(), encodePNG()
 *   storage            storage.get / set
 *
 * The renderer, input system, asset manager and Engine only ever talk to this interface, so the
 * same game code runs in a browser tab, in Node (headless, for tests, servers and captures) and in a
 * native Deno window.
 *
 * To support another host (a different window library, a console), subclass Platform and override what the table above lists.
 *
 * @import { RGBA8Image, GPUObject } from '../types.js'
 * @import { GPU } from '../gpu/Device.js'
 */

/**
 * Persistent settings (localStorage in a browser, a JSON file elsewhere). Values are strings.
 * @typedef {object} KeyValueStore
 * @property {(key: string) => string | null} get
 * @property {(key: string, value: string) => void} set
 * @property {(key: string) => void} remove
 */

/**
 * What a platform can do, so that a game can offer the right options.
 * @typedef {object} PlatformCapabilities
 * @property {boolean} windowed      there is a window or a canvas the player looks at
 * @property {boolean} pointerLock   the mouse can be captured for mouse-look
 * @property {boolean} gamepad       gamepads are reported
 * @property {boolean} fileWrite     writeFile() saves to disk (a browser offers a download instead)
 * @property {boolean} jpeg          decodeImage() reads JPEG and WebP as well as PNG
 */

/**
 * A controller, in the shape of the web Gamepad API (standard mapping: buttons 0..3 face, 4/5 bumpers, 6/7 triggers, 12..15 d-pad;
 * axes 0/1 left stick, 2/3 right stick).
 * @typedef {object} PlatformGamepad
 * @property {number} index
 * @property {string} id
 * @property {string} mapping  'standard' for a controller the platform could map
 * @property {number[]} axes
 * @property {{ pressed: boolean, value: number }[]} buttons
 */

/**
 * @typedef {object} PlatformKeyEvent
 * @property {string} code       the physical key, as KeyboardEvent.code: 'KeyW', 'Space', 'ArrowLeft', 'ShiftLeft', 'Digit1'
 * @property {string} key        what the key types: 'w', 'W', ' '
 * @property {boolean} down      pressed (true) or released (false)
 * @property {boolean} repeat    an auto-repeat of a key that is held
 * @property {number} [mods]     bit set: 1 shift, 2 ctrl, 4 alt, 8 meta
 */

/**
 * @typedef {object} PlatformPointerEvent
 * @property {'down' | 'up' | 'move' | 'cancel'} kind
 * @property {number} id            which pointer (a finger, the mouse)
 * @property {number} button        0 left, 1 middle, 2 right
 * @property {number} buttons       bit set of the buttons held
 * @property {string} pointerType   'mouse', 'touch' or 'pen'
 * @property {number} x             position in layout pixels, from the top left of the surface
 * @property {number} y
 * @property {number} dx            movement since the last event (also while the pointer is locked)
 * @property {number} dy
 * @property {number} [mods]
 * @property {number} [pressure]
 */

/**
 * @typedef {object} PlatformWheelEvent
 * @property {number} dx
 * @property {number} dy
 * @property {number} [mode]  0 pixels, 1 lines, 2 pages (as WheelEvent.deltaMode)
 * @property {number} [mods]
 */

/**
 * The events a platform emits, by name.
 * @typedef {object} PlatformEvents
 * @property {PlatformKeyEvent} key
 * @property {PlatformPointerEvent} pointer
 * @property {PlatformWheelEvent} wheel
 * @property {{}} blur                        the window lost focus: held keys should be released
 * @property {{}} focus
 * @property {{ hidden: boolean }} visibility the page was hidden or shown
 * @property {{ locked: boolean }} pointerlock
 * @property {{ index: number, id: string }} gamepadconnected
 * @property {{ index: number, id: string }} gamepaddisconnected
 * @property {{}} close                       the window was closed (windowed Deno)
 */

export class Platform {
  constructor() {
    /** 'browser', 'node', 'deno' ... */
    this.name = 'abstract';
    this._listeners = new Map();
    /**
     * Stored values that survive restarts (localStorage in a browser, a JSON file elsewhere).
     * @type {KeyValueStore}
     */
    this.storage = { get: () => null, set: () => {}, remove: () => {} };
    /** @type {PlatformCapabilities} */
    this.capabilities = { windowed: false, pointerLock: false, gamepad: false, fileWrite: false, jpeg: false };
    /** @type {PlatformGamepad[]} */
    this._pads = [];
  }

  // -- events ---------------------------------------------------------------
  /**
   * Subscribes to an event of the platform. Returns the function that unsubscribes.
   * @template {keyof PlatformEvents} K
   * @param {K} type
   * @param {(event: PlatformEvents[K]) => void} fn
   * @returns {() => void}
   */
  on(type, fn) { (this._listeners.get(type) ?? this._listeners.set(type, new Set()).get(type)).add(fn); return () => this.off(type, fn); }
  /**
   * @template {keyof PlatformEvents} K
   * @param {K} type
   * @param {(event: PlatformEvents[K]) => void} fn
   */
  off(type, fn) { this._listeners.get(type)?.delete(fn); }
  /**
   * Delivers an event to the subscribers: what a window does, and what tests and replays do to drive a game.
   * @template {keyof PlatformEvents} K
   * @param {K} type
   * @param {PlatformEvents[K]} data
   */
  emit(type, data) { const s = this._listeners.get(type); if (s) for (const f of s) f(data); }

  // -- required overrides ---------------------------------------------------
  /** The WebGPU entry point (`navigator.gpu`, or Dawn's or wgpu's equivalent). @returns {Promise<{ requestAdapter(options?: object): Promise<GPUObject> }>} */
  async getGPU() { throw new Error(`${this.name}: getGPU() not implemented`); }
  /**
   * The drawing target: a canvas, an offscreen texture or a native window.
   * @param {{ maxDpr?: number, width?: number, height?: number, dpr?: number, format?: string }} [opts]
   * @returns {Surface}
   */
  createSurface(opts) { throw new Error(`${this.name}: createSurface() not implemented`); }
  /** Milliseconds on a monotonic clock. */
  now() { return performance.now(); }
  /** Calls `cb(timeMs)` before the next frame is shown (requestAnimationFrame in a browser). Returns a handle for cancelFrame(). @param {(timeMs: number) => void} cb @returns {any} */
  requestFrame(cb) { return setTimeout(() => cb(this.now()), 16); }
  /** @param {any} h  a handle from requestFrame() */
  cancelFrame(h) { clearTimeout(h); }
  /** The bytes of a file (a path, or a URL in a browser). @param {string} path @returns {Promise<Uint8Array>} */
  async readFile(path) { throw new Error(`${this.name}: readFile() not implemented`); }
  /** @param {string} path @returns {Promise<string>} */
  async readText(path) { return new TextDecoder().decode(await this.readFile(path)); }
  /** @param {string} path @returns {Promise<any>} */
  async readJSON(path) { return JSON.parse(await this.readText(path)); }
  /** Saves bytes to a file, creating folders (a browser offers a download instead). @param {string} path @param {Uint8Array} bytes @returns {Promise<void>} */
  async writeFile(path, bytes) { throw new Error(`${this.name}: writeFile() not available on this platform`); }
  /**
   * Decodes an image file. Headless platforms return `{ width, height, data }` (RGBA8; PNG only), a browser an ImageBitmap.
   * @param {Uint8Array} bytes
   * @param {string} [mime]
   * @returns {Promise<RGBA8Image | ImageBitmap>}
   */
  async decodeImage(bytes, mime) { throw new Error(`${this.name}: decodeImage() not implemented`); }
  /** @param {RGBA8Image} image @returns {Promise<Uint8Array>} PNG file bytes */
  async encodePNG(image) { throw new Error(`${this.name}: encodePNG() not implemented`); }

  // -- optional -------------------------------------------------------------
  /** Connected controllers: [{ index, id, mapping, axes[], buttons[{ pressed, value }] }]. Platforms with real pads override this. @returns {PlatformGamepad[]} */
  gamepads() { return this._pads; }
  /** Captures (true) or releases (false) the mouse for mouse-look. @param {boolean} on */
  setPointerLock(on) {}
  /** A CSS cursor name ('default', 'none', 'pointer'). @param {string} css */
  setCursor(css) {}
  /** @param {boolean} on */
  setFullscreen(on) {}
  /** @param {string} title */
  setTitle(title) {}
  /** Resolves `rel` against `base` (a path or URL). @param {string} base @param {string} rel @returns {string} */
  resolve(base, rel) {
    if (/^[a-z]+:\/\//i.test(rel) || rel.startsWith('/') || rel.startsWith('data:')) return rel;
    const b = base.endsWith('/') ? base : base.slice(0, base.lastIndexOf('/') + 1);
    const parts = (b + rel).split('/'), out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
    return out.join('/');
  }
  dispose() {}

  // -- synthetic input: tests, replays and bots drive a game through the same events a window would -----
  /** @param {string} code  e.g. 'KeyW' @param {boolean} [down] @param {Partial<PlatformKeyEvent>} [extra] */
  injectKey(code, down = true, extra = {}) { this.emit('key', { code, key: extra.key ?? code, down, repeat: false, ...extra }); }
  /** @param {'down' | 'up' | 'move' | 'cancel'} kind @param {number} x @param {number} y @param {Partial<PlatformPointerEvent>} [extra] */
  injectPointer(kind, x, y, extra = {}) { this.emit('pointer', { kind, id: 1, button: 0, buttons: kind === 'up' ? 0 : 1, x, y, dx: 0, dy: 0, pointerType: 'mouse', ...extra }); }
  /** @param {number} dx @param {number} dy */
  injectWheel(dx, dy) { this.emit('wheel', { dx, dy }); }
  /** Sets what gamepads() reports (the same shape a browser platform produces). @param {PlatformGamepad[]} pads */
  setGamepads(pads) { this._pads = pads; }
}

/** A drawing target. Platforms return one from createSurface(). */
export class Surface {
  constructor() {
    this.width = 1; this.height = 1;          // in physical pixels
    this.cssWidth = 1; this.cssHeight = 1;    // in layout pixels
    this.dpr = 1;
    /** The texture format of what getCurrentTexture() returns. */
    this.format = 'rgba8unorm';
    /** True when the texture from getCurrentTexture() only lives for one frame (a canvas, a window): it cannot be read afterwards. */
    this.transient = false;
    this._resize = new Set();
  }
  /** Calls `fn(surface)` when the size changes. Returns the function that stops it. @param {(surface: Surface) => void} fn @returns {() => void} */
  onResize(fn) { this._resize.add(fn); return () => this._resize.delete(fn); }
  _notify() { for (const f of this._resize) f(this); }
  /** Attaches the surface to a device. @param {GPU} gpu */
  configure(gpu) {}
  /** The texture to draw this frame's final image into. @returns {GPUObject} */
  getCurrentTexture() { throw new Error('Surface.getCurrentTexture not implemented'); }
  /** Shows the frame (windows that need telling; a canvas presents by itself). */
  present() {}
  /** Re-measures a surface that follows its element or window; headless surfaces take the new size. @param {number} [cssWidth] @param {number} [cssHeight] */
  resize(cssWidth, cssHeight) {}
  destroy() {}
}
