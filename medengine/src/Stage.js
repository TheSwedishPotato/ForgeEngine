import { Scene } from './scene/Object3D.js';
import { PerspectiveCamera } from './scene/Camera.js';
import { Vector3 } from './math/core.js';
import { Renderer } from './render/Renderer.js';

/**
 * @import { Platform, Surface } from './platform/Platform.js'
 * @import { OrthographicCamera } from './scene/Camera.js'
 * @import { ColorGrade } from './render/passes/Post.js'
 * @import { GpuTimes } from './gpu/Timer.js'
 * @import { QualityName, RGBA8Image } from './types.js'
 */

/**
 * What Stage.create() takes.
 * @typedef {object} StageOptions
 * @property {Platform} platform         where to draw: a BrowserPlatform, NodePlatform or DenoPlatform
 * @property {Surface} [surface]         draw into this instead of a surface the platform makes
 * @property {QualityName} [quality]     'low' | 'medium' | 'high' (default) | 'ultra'
 * @property {number | null} [renderScale]  internal resolution relative to the display, 0.25 to 1.5 (default: the quality's; the upscaler restores the rest)
 * @property {Scene} [scene]             an existing scene (default: a new one)
 * @property {PerspectiveCamera | OrthographicCamera} [camera]  an existing camera (default: a perspective camera of `fov`, `near` and `far`)
 * @property {number} [fov]              vertical field of view of the default camera, degrees (35)
 * @property {number} [near]             metres (0.03)
 * @property {number} [far]              metres (1500)
 */

/**
 * The look of a shot: where the focus is, how deep the field, and how fast the focus follows. Depth of field itself is not part of
 * the ME3 renderer yet: the values are tracked (and animated by the Director) so a DOF pass can read them.
 * @typedef {object} Lens
 * @property {number} focus      distance in metres that is sharp
 * @property {number} aperture   f-number (smaller: shallower)
 * @property {number} focal      focal length in metres (0.05 is a 50 mm lens)
 * @property {number} amount     0..1, how much of the effect to apply
 * @property {number} pull       how fast the focus follows `focus`, 1/s
 */

/**
 * A tight, high-resolution shadow around the action.
 * @typedef {object} ShadowFocus
 * @property {Vector3} center
 * @property {number} radius     metres
 */

/**
 * A stage: the renderer with a scene and a camera, plus the per-shot look a game (or the Director) sets.
 *
 *   const stage = await Stage.create({ platform, quality: 'high' });
 *   stage.scene.add(mesh);
 *   stage.grade.saturation = 0.9;               // the colour grade of the shot
 *   stage.lens.focus = 2.4;                     // focus distance in metres (the Director animates this)
 *   stage.shake = 1;                            // an impact kick that decays by itself
 *   stage.shadowFocus = { center, radius };     // a tight high-resolution shadow around the action
 *   stage.render(dt);
 *
 * The Engine owns a Stage and drives `render` for you; use a Stage on its own for tools and viewers.
 */
export class Stage {
  /**
   * Creates the GPU renderer on `platform` (and a surface unless one is given).
   * @param {StageOptions} o
   * @returns {Promise<Stage>}
   */
  static async create(o) {
    const { platform, surface = null, quality = 'high', renderScale = null, scene = null, camera = null, fov = 35, near = 0.03, far = 1500 } = o ?? /** @type {StageOptions} */ ({});
    if (!platform) throw new Error('Stage.create: pass a platform (new BrowserPlatform() in a browser, NodePlatform headless, DenoPlatform natively).');
    const renderer = await Renderer.create({ platform, surface, quality, renderScale });
    return new Stage(renderer, { scene, camera, fov, near, far });
  }

  /**
   * @param {Renderer} renderer
   * @param {Omit<StageOptions, 'platform' | 'surface' | 'quality' | 'renderScale'>} [o]
   */
  constructor(renderer, { scene = null, camera = null, fov = 35, near = 0.03, far = 1500 } = {}) {
    /** The GPU renderer: passes, quality, statistics (`renderer.stats`). */
    this.renderer = this.r = renderer;
    /** What is drawn. @type {Scene} */
    this.scene = scene ?? new Scene();
    const s = renderer.surface;
    /**
     * The camera the scene is drawn through (a perspective camera unless you passed another). The Director and the Engine move it.
     * @type {PerspectiveCamera | OrthographicCamera}
     */
    this.camera = camera ?? new PerspectiveCamera(fov, s.width / s.height, near, far);
    /**
     * The lens of the shot (see Lens).
     * @type {Lens}
     */
    this.lens = { focus: 3, aperture: 2.0, focal: 0.05, amount: 1, pull: 8 };
    /** The eased focus distance in metres a depth-of-field pass should use: follows `lens.focus` at `lens.pull` per second. */
    this.focus = this.lens.focus;
    /** An impact kick, 0..1 and more: shakes the camera, and decays by itself (3 per second). */
    this.shake = 0;
    this._shake = new Vector3();
    /**
     * A tight, high-resolution shadow around the action (see ShadowFocus), or null: renders an extra shadow cascade there.
     * @type {ShadowFocus | null}
     */
    this.shadowFocus = null;
    this._unsub = s.onResize(() => this.fitCamera());
    this.fitCamera();
  }

  /** The drawing target (the canvas, the window or the offscreen texture). @returns {Surface} */
  get surface() { return this.renderer.surface; }
  /**
   * The colour grade (lift / gamma / gain, white balance, saturation, contrast ...), applied in the film composite. Change its
   * fields in place; the Director sets them per shot.
   * @returns {ColorGrade}
   */
  get grade() { return this.renderer.composite.grade; }
  /** The current quality tier. @returns {QualityName} */
  get quality() { return /** @type {QualityName} */ (this.renderer.qualityName); }
  /** Switches the quality tier while running: the internal resolution, the shadow maps and the effects follow. @param {QualityName} name */
  setQuality(name) { this.renderer.setQuality(name); }
  /**
   * Per-pass GPU timing with timestamp queries: returns whether the device can do it, and then `stage.gpuTimes` has the numbers
   * (see gpu/Timer.js for what they mean and how browsers round them). Off by default: it costs a little.
   * @param {boolean} [on]
   * @returns {boolean}
   */
  enableGpuTiming(on = true) { return this.renderer.enableGpuTiming(on); }
  /** Smoothed GPU milliseconds per frame and per pass, or null while timing is off or nothing has come back yet. @returns {GpuTimes | null} */
  get gpuTimes() { return this.renderer.timer?.avg ?? null; }

  /** Keeps a perspective camera's aspect ratio in step with the surface. */
  fitCamera() {
    const s = this.renderer.surface, c = this.camera;
    if (c.isPerspectiveCamera && s.height > 0) { c.aspect = s.width / s.height; c.updateProjectionMatrix(); }
  }

  /**
   * Draws one frame of the scene through the camera, with the grade, the lens and the shake applied. The Engine calls this each frame.
   * @param {number} [dt]  seconds since the last frame (drives the focus pull, the shake, the temporal filters and the auto exposure)
   */
  render(dt = 1 / 60) {
    const r = this.renderer, L = this.lens;
    this.focus += (L.focus - this.focus) * Math.min(1, dt * (L.pull ?? 8));
    this.shake = Math.max(0, this.shake - dt * 3.0);
    const k = this.shake * this.shake * 0.05;
    this._shake.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    this.camera.position.add(this._shake);
    r.shadowFocus = this.shadowFocus ? { center: this.shadowFocus.center, radius: this.shadowFocus.radius } : null;
    try { r.render(this.scene, this.camera, dt); } finally { this.camera.position.sub(this._shake); }
  }

  /**
   * Waits for the GPU and returns the last frame as RGBA8 `{ width, height, data }`. On a canvas or a window, whose texture lives for
   * one frame, the promise resolves with the next frame that is drawn (Engine.screenshot() draws one for you).
   * @returns {Promise<RGBA8Image>}
   */
  capture() { return this.renderer.capture(); }

  /** Frees the renderer (and the GPU device, when it made it). */
  dispose() { this._unsub?.(); this.renderer.dispose(); }
}
