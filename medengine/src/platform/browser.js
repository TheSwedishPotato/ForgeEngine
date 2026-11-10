/**
 * Browser platform: a canvas, DOM input events, requestAnimationFrame, fetch, localStorage.
 * WebGPU needs a secure context (https:// or http://localhost).
 */
import { Platform, Surface } from './Platform.js';

export class BrowserPlatform extends Platform {
  /**
   * @param {object} [o]
   * @param {HTMLCanvasElement | null} [o.canvas]   adopt an existing canvas (otherwise one is created and added to `parent`)
   * @param {HTMLElement | null} [o.parent]   where a new canvas goes (default: the page's body)
   * @param {number} [o.maxDpr]              cap on devicePixelRatio (default 2)
   */
  constructor({ canvas = null, parent = null, maxDpr = 2 } = {}) {
    super();
    this.name = 'browser';
    this.canvas = canvas;
    this.parent = parent ?? document.body;
    this.maxDpr = maxDpr;
    this.capabilities = { windowed: true, pointerLock: true, gamepad: !!navigator.getGamepads, fileWrite: false, jpeg: true };
    this.storage = {
      get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
      remove: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
    };
    this._attached = false;
  }

  async getGPU() {
    if (!navigator.gpu) {
      throw new Error(isSecureContext
        ? 'WebGPU is not available in this browser. Use a current Chrome, Edge, Safari or Firefox.'
        : 'WebGPU needs a secure context: open this page over https:// or http://localhost.');
    }
    return navigator.gpu;
  }

  createSurface(opts = {}) {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
      this.canvas.tabIndex = 0;
      this.parent.appendChild(this.canvas);
    }
    const s = new CanvasSurface(this.canvas, { maxDpr: opts.maxDpr ?? this.maxDpr });
    this._attach();
    return s;
  }

  _attach() {
    if (this._attached) return;
    this._attached = true;
    const c = this.canvas, mods = (e) => (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
    const stop = (e) => e.preventDefault();
    const on = (t, target, fn, opt) => { target.addEventListener(t, fn, opt); (this._cleanup ??= []).push(() => target.removeEventListener(t, fn, opt)); };
    on('keydown', window, (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.emit('key', { code: e.code, key: e.key, down: true, repeat: e.repeat, mods: mods(e) });
      if (!e.metaKey && !e.ctrlKey && /^(Arrow|Space|Tab)/.test(e.code)) stop(e);
    });
    on('keyup', window, (e) => this.emit('key', { code: e.code, key: e.key, down: false, repeat: false, mods: mods(e) }));
    const rect = () => c.getBoundingClientRect();
    const ptr = (kind) => (e) => {
      const r = rect();
      this.emit('pointer', {
        kind, id: e.pointerId, button: e.button, buttons: e.buttons, pointerType: e.pointerType,
        x: e.clientX - r.left, y: e.clientY - r.top, dx: e.movementX || 0, dy: e.movementY || 0, mods: mods(e),
        pressure: e.pressure,
      });
    };
    on('pointerdown', c, (e) => { c.focus?.(); try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ } ptr('down')(e); });
    on('pointerup', c, ptr('up'));
    on('pointercancel', c, ptr('cancel'));
    on('pointermove', c, ptr('move'));
    on('wheel', c, (e) => { this.emit('wheel', { dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, mods: mods(e) }); e.preventDefault(); }, { passive: false });
    on('contextmenu', c, stop);
    on('blur', window, () => this.emit('blur', {}));
    on('focus', window, () => this.emit('focus', {}));
    on('visibilitychange', document, () => this.emit('visibility', { hidden: document.hidden }));
    on('pointerlockchange', document, () => this.emit('pointerlock', { locked: document.pointerLockElement === c }));
    on('gamepadconnected', window, (e) => this.emit('gamepadconnected', { index: e.gamepad.index, id: e.gamepad.id }));
    on('gamepaddisconnected', window, (e) => this.emit('gamepaddisconnected', { index: e.gamepad.index, id: e.gamepad.id }));
  }

  now() { return performance.now(); }
  requestFrame(cb) { return requestAnimationFrame(cb); }
  cancelFrame(h) { cancelAnimationFrame(h); }

  gamepads() {
    const pads = navigator.getGamepads?.() ?? [];
    const out = [];
    for (const p of pads) if (p && p.connected) out.push({ index: p.index, id: p.id, mapping: p.mapping, axes: Array.from(p.axes), buttons: p.buttons.map((b) => ({ pressed: b.pressed, value: b.value })) });
    return out;
  }
  setPointerLock(on) { if (on) this.canvas?.requestPointerLock?.(); else document.exitPointerLock?.(); }
  setCursor(css) { if (this.canvas) this.canvas.style.cursor = css; }
  setFullscreen(on) { if (on) (this.canvas?.parentElement ?? document.documentElement).requestFullscreen?.(); else document.exitFullscreen?.(); }
  setTitle(t) { document.title = t; }

  async readFile(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`readFile ${url}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async readText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`readText ${url}: HTTP ${r.status}`); return r.text(); }
  async writeFile(name, bytes) {  // a browser cannot write to disk: offer a download
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes])); a.download = name.split('/').pop();
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async decodeImage(bytes, mime = '') {
    const blob = new Blob([bytes], mime ? { type: mime } : undefined);
    return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }
  async encodePNG({ width, height, data }) {
    const c = new OffscreenCanvas(width, height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height), 0, 0);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  }

  dispose() { for (const f of this._cleanup ?? []) f(); this._attached = false; }
}

/** The page's canvas, tracked at physical-pixel size. */
export class CanvasSurface extends Surface {
  constructor(canvas, { maxDpr = 2 } = {}) {
    super();
    this.transient = true;
    this.canvas = canvas; this.maxDpr = maxDpr;
    this.context = canvas.getContext('webgpu');
    this._measure();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => { if (this._measure()) this._notify(); });
      this._ro.observe(canvas);
    }
  }
  _measure() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const cw = Math.max(1, this.canvas.clientWidth || window.innerWidth), ch = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    const changed = w !== this.width || h !== this.height;
    this.dpr = dpr; this.cssWidth = cw; this.cssHeight = ch; this.width = w; this.height = h;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    return changed;
  }
  configure(gpu) {
    this.format = gpu.entry.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    this.context.configure({ device: gpu.device, format: this.format, alphaMode: 'opaque', usage: 16 /* RENDER_ATTACHMENT */ | 4 /* TEXTURE_BINDING */ | 1 /* COPY_SRC */ });
  }
  getCurrentTexture() { return this.context.getCurrentTexture(); }
  resize() { if (this._measure()) this._notify(); }
  destroy() { this._ro?.disconnect(); this.context.unconfigure?.(); }
}
