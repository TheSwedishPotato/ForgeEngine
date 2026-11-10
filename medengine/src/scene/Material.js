/**
 * Textures and materials.
 *
 * One physically based material model: `StandardMaterial`. Besides the usual metal-rough
 * parameters it carries the engine's *shading model* (`medType`), which picks the lobe used by the
 * deferred lighting pass: 'default', 'skin' (subsurface), 'coat' (clear coat), 'cloth' (sheen),
 * 'foliage' (translucent), 'eye', 'hair', 'batsuit', 'water'.
 *
 * Colour spaces: textures in the `map` / `emissiveMap` slots are read as sRGB, every other slot as
 * linear data. Set `texture.colorSpace = 'srgb-linear'` to override for a colour slot.
 */
import { Color, Vector2, Matrix3 } from '../math/core.js';

/** @import { ColorRepresentation } from '../math/core.js' */

/**
 * The shading model of a surface: which lobe the deferred lighting pass uses.
 * @typedef {'default' | 'skin' | 'coat' | 'cloth' | 'foliage' | 'eye' | 'hair' | 'batsuit' | 'water'} ShadingModel
 */

/**
 * What `new StandardMaterial(params)` and `material.setValues(params)` take: any of the material's own settings, all optional.
 * @typedef {object} MaterialParams
 * @property {ColorRepresentation} [color]            base colour (white); a number such as 0xb4ae9f, a Color or a CSS name
 * @property {number} [roughness]                     0 mirror .. 1 matte (1)
 * @property {number} [metalness]                     0 dielectric .. 1 metal (0)
 * @property {ColorRepresentation} [emissive]         light the surface gives off (black)
 * @property {number} [emissiveIntensity]             multiplies `emissive` (1); above 1 it glows and feeds the bloom
 * @property {Texture | null} [map]                   base colour texture (read as sRGB)
 * @property {Texture | null} [normalMap]
 * @property {Vector2} [normalScale]
 * @property {Texture | null} [roughnessMap]          glTF packing: roughness in green, multiplies `roughness`
 * @property {Texture | null} [metalnessMap]          the same texture as `roughnessMap`: metalness in blue
 * @property {Texture | null} [aoMap]                 the same texture as `roughnessMap`: baked occlusion in red
 * @property {number} [aoMapIntensity]
 * @property {Texture | null} [emissiveMap]           read as sRGB
 * @property {boolean} [flatShading]
 * @property {boolean} [vertexColors]
 * @property {number} [specularIntensity]
 * @property {ShadingModel | null} [medType]          null: chosen from `clearcoat` and `sheen`
 * @property {number} [clearcoat]
 * @property {number} [sheen]
 * @property {number | null} [medParam]               strength of the lobe; the default depends on `medType`
 * @property {'pores' | 'leather' | 'fabric' | null} [detail]  micro-normal detail close up
 * @property {number} [wetFactor]                     0: this surface never gets wet (1)
 * @property {boolean} [puddles]                      collects puddles with raindrop ripples on level ground
 * @property {boolean} [streaks]                      water runs down it in the rain
 * @property {boolean} [dither]                       stochastic alpha (hair cards, lashes), resolved by the temporal filter
 * @property {boolean} [unlit]                        colour only, no lighting
 * @property {string} [name]
 * @property {boolean} [visible]
 * @property {number} [side]                          FrontSide, BackSide or DoubleSide
 * @property {boolean} [transparent]
 * @property {number} [opacity]
 * @property {number} [alphaTest]                     pixels with less alpha than this are discarded
 * @property {Record<string, any>} [userData]
 */

export const FrontSide = 0, BackSide = 1, DoubleSide = 2;
export const RepeatWrapping = 1000, ClampToEdgeWrapping = 1001, MirroredRepeatWrapping = 1002;
export const SRGBColorSpace = 'srgb', LinearSRGBColorSpace = 'srgb-linear', NoColorSpace = '';
export const NearestFilter = 1003, LinearFilter = 1006, LinearMipmapLinearFilter = 1008;

let _texId = 1, _matId = 1;

export class Texture {
  /**
   * `image` is a browser image source (ImageBitmap, canvas, ...) or raw pixels
   * `{ width, height, data }` (see DataTexture).
   * @param {ImageBitmap | HTMLCanvasElement | OffscreenCanvas | { width: number, height: number, data?: ArrayBufferView } | null} [image]
   */
  constructor(image = null) {
    this.id = _texId++;
    this.name = '';
    this.image = image;
    this.wrapS = RepeatWrapping; this.wrapT = RepeatWrapping;
    this.magFilter = LinearFilter; this.minFilter = LinearMipmapLinearFilter;
    this.anisotropy = 8;
    this.generateMipmaps = true;
    this.colorSpace = NoColorSpace;
    this.flipY = false;
    this.offset = new Vector2(0, 0); this.repeat = new Vector2(1, 1); this.center = new Vector2(0, 0); this.rotation = 0;
    this.matrix = new Matrix3();
    this.matrixAutoUpdate = true;
    this.version = 0;
    this.userData = {};
    this._disposeListeners = new Set();
  }
  get isTexture() { return true; }
  set needsUpdate(v) { if (v) this.version++; }
  updateMatrix() {
    if (!this.matrixAutoUpdate) return;
    this.matrix.setUvTransform(this.offset.x, this.offset.y, this.repeat.x, this.repeat.y, this.rotation, this.center.x, this.center.y);
  }
  clone() { const t = new Texture(this.image); t.copy(this); return t; }
  copy(s) {
    this.wrapS = s.wrapS; this.wrapT = s.wrapT; this.magFilter = s.magFilter; this.minFilter = s.minFilter; this.anisotropy = s.anisotropy;
    this.generateMipmaps = s.generateMipmaps; this.colorSpace = s.colorSpace; this.flipY = s.flipY;
    this.offset.copy(s.offset); this.repeat.copy(s.repeat); this.center.copy(s.center); this.rotation = s.rotation;
    this.version++;
    return this;
  }
  onDispose(fn) { this._disposeListeners.add(fn); return () => this._disposeListeners.delete(fn); }
  dispose() { for (const f of this._disposeListeners) f(this); }
}

/** Raw pixels. `format`: 'rgba8' (Uint8Array), 'rgba16f' (Uint16Array of half floats), 'rgba32f' (Float32Array), 'r8', 'rg8'. */
export class DataTexture extends Texture {
  constructor(data, width, height, format = 'rgba8') {
    super({ data, width, height });
    this.format = format;
    this.generateMipmaps = false;
    this.flipY = false;
    this.version = 1;
  }
  get isDataTexture() { return true; }
}

/** A texture drawn with the 2D canvas API (browser) or any canvas-like object with width/height. */
export class CanvasTexture extends Texture {
  constructor(canvas) { super(canvas); this.version = 1; this.flipY = true; }
  get isCanvasTexture() { return true; }
}

/** Loads images through the platform's decoder; returns a Texture whose image arrives later. */
export class ImageTexture extends Texture {
  constructor(image) { super(image); this.version = image ? 1 : 0; this.flipY = true; }
}

// ---------------------------------------------------------------------------

export class Material {
  constructor() {
    this.id = _matId++;
    this.name = '';
    this.type = 'Material';
    this.visible = true;
    this.side = FrontSide;
    this.transparent = false;
    this.opacity = 1;
    this.alphaTest = 0;
    this.version = 0;
    this.userData = {};
    this._disposeListeners = new Set();
  }
  get isMaterial() { return true; }
  set needsUpdate(v) { if (v) this.version++; }
  onDispose(fn) { this._disposeListeners.add(fn); return () => this._disposeListeners.delete(fn); }
  dispose() { for (const f of this._disposeListeners) f(this); }
}

export class StandardMaterial extends Material {
  /** @param {MaterialParams} [params] */
  constructor(params = {}) {
    super();
    this.type = 'StandardMaterial';
    this.color = new Color(1, 1, 1);
    this.roughness = 1;
    this.metalness = 0;
    this.emissive = new Color(0, 0, 0);
    this.emissiveIntensity = 1;
    /** @type {Texture | null} */ this.map = null;
    /** @type {Texture | null} */ this.normalMap = null;
    this.normalScale = new Vector2(1, 1);
    /** Roughness is read from the map's green channel (glTF metallic-roughness packing) and multiplies `roughness`. */
    /** @type {Texture | null} */ this.roughnessMap = null;
    /**
     * glTF's packed texture: set `metalnessMap` and `aoMap` to the same texture as `roughnessMap` and metalness is read
     * from its blue channel and baked occlusion from its red channel (multiplied by `aoMapIntensity`). A separate
     * metalness / occlusion texture is not supported.
     */
    /** @type {Texture | null} */ this.metalnessMap = null;
    /** @type {Texture | null} */ this.aoMap = null;
    this.aoMapIntensity = 1;
    /** @type {Texture | null} */ this.emissiveMap = null;
    this.flatShading = false;
    this.vertexColors = false;
    this.specularIntensity = 1;
    // engine shading model
    /** @type {ShadingModel | null} the lobe the lighting pass uses (null = chosen from clearcoat / sheen) */ this.medType = null;
    this.clearcoat = 0;
    this.sheen = 0;
    /** @type {number | null} lobe strength; defaults depend on the type */ this.medParam = null;
    /** @type {'pores' | 'leather' | 'fabric' | null} micro-normal detail close up */ this.detail = null;
    this.wetFactor = 1;           // 0 = this surface never gets wet
    this.puddles = false;         // collects puddles with raindrop ripples on level ground
    this.streaks = false;         // water runs down it in the rain
    this.dither = false;          // stochastic alpha (hair cards, lashes), resolved by TAA
    this.unlit = false;
    this.setValues(params);
  }
  get isStandardMaterial() { return true; }
  /**
   * Sets several settings at once; colours accept anything `Color.set` takes.
   * @param {MaterialParams} values
   * @returns {this}
   */
  setValues(values) {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) continue;
      const cur = this[k];
      if (cur && cur.isColor && !v.isColor) cur.set(v);
      else if (cur && cur.isVector2 && v.isVector2) cur.copy(v);
      else this[k] = v;
    }
    return this;
  }
  clone() {
    const m = new StandardMaterial();
    for (const [k, v] of Object.entries(this)) {
      if (k === 'id' || k === '_disposeListeners') continue;
      m[k] = v && v.clone && !v.isTexture ? v.clone() : v && typeof v === 'object' && !v.isTexture && !Array.isArray(v) ? { ...v } : v;
    }
    return m;
  }
}

/** An unlit material (colour only). */
export class BasicMaterial extends StandardMaterial {
  /** @param {MaterialParams} [params] */
  constructor(params = {}) { super(params); this.type = 'BasicMaterial'; this.unlit = true; }
}

// Familiar names, so code written for other engines' material classes ports with fewer edits.
export { StandardMaterial as MeshStandardMaterial, StandardMaterial as MeshPhysicalMaterial, BasicMaterial as MeshBasicMaterial };
