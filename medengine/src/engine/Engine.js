/**
 * The engine: one object that owns the platform, the stage (renderer, scene, camera), input and physics, and runs the
 * game loop with a fixed simulation step.
 *
 *   const engine = await Engine.create({ platform: new BrowserPlatform(), quality: 'high' });
 *   engine.input.map({ jump: ['Space', 'Pad:a'], move: { type: 'vec2', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], stick: 'Pad:ls' } });
 *   engine.add({
 *     fixedUpdate(dt, e) { ... },     // 60 times a second, before physics: apply input to bodies and characters
 *     afterPhysics(dt, e) { ... },    // after physics: read results
 *     update(dt, e) { ... },          // once per frame: animation, camera, UI
 *     lateUpdate(dt, e) { ... },      // once per frame, after every update
 *   });
 *   engine.start();
 *
 * A frame is: poll input -> N fixed steps (physics at a constant rate, however fast or slow the display is) -> update ->
 * lateUpdate -> render. Frames longer than `maxFrame` are clipped and at most `maxSteps` fixed steps run per frame, so a
 * stall never makes the game spiral. Everything also runs headless (NodePlatform): `engine.run(600, 1 / 60)` simulates
 * ten seconds deterministically, with or without drawing them.
 */
import { Scene } from '../scene/Object3D.js';
import { PerspectiveCamera } from '../scene/Camera.js';
import { Stage } from '../Stage.js';
import { InputManager } from '../input/InputManager.js';
import { World } from '../physics/World.js';
import { AssetManager } from '../assets/AssetManager.js';

/**
 * @import { Platform, Surface } from '../platform/Platform.js'
 * @import { QualityName, RGBA8Image } from '../types.js'
 * @import { WorldOptions } from '../physics/World.js'
 * @import { InputOptions } from '../input/InputManager.js'
 * @import { AssetManagerOptions } from '../assets/AssetManager.js'
 */

/**
 * What Engine.create() takes.
 * @typedef {object} EngineOptions
 * @property {Platform} platform         required: `new BrowserPlatform()` in a browser, `NodePlatform` headless, `DenoPlatform` natively
 * @property {boolean} [render]          false: no GPU and no window at all (logic, servers, tests); `engine.stage` is then null. Default true.
 * @property {QualityName} [quality]     'low' | 'medium' | 'high' (default) | 'ultra'
 * @property {number | null} [renderScale]  internal resolution relative to the display (the upscaler restores it); default: the quality's
 * @property {Surface | null} [surface]  draw into this instead of a surface the platform makes
 * @property {number} [fixedStep]        simulation step in seconds (1/60)
 * @property {number} [maxSteps]         fixed steps allowed per frame (6)
 * @property {number} [maxFrame]         longest frame time taken into account, seconds (0.1): after a stall the game continues, it does not catch up
 * @property {WorldOptions} [physics]    physics world options (gravity, substeps, iterations ...)
 * @property {InputOptions} [input]      input options (deadzone, lockOnClick)
 * @property {{ fov?: number, near?: number, far?: number }} [camera]  the default camera: vertical field of view in degrees (35), near (0.03 m), far (1500 m)
 * @property {string} [baseUrl]          folder (or URL) that relative asset paths are resolved against
 * @property {AssetManagerOptions} [assets]  asset manager options, e.g. `{ gltf: { castShadow: false } }`
 */

/**
 * Anything the engine can run: an object with some of these hooks (all optional). Actors, the Director, the story system and the
 * input manager's helpers are systems; so is a plain object literal.
 * @typedef {object} System
 * @property {(engine: Engine) => void} [onAdd]                    when it is added to an engine
 * @property {(engine: Engine) => void} [onRemove]                 when it is removed
 * @property {(dt: number, engine: Engine) => void} [fixedUpdate]  at the fixed rate (60 Hz), before physics: apply input to bodies and characters
 * @property {(dt: number, engine: Engine) => void} [afterPhysics] after physics, still at the fixed rate: read the results
 * @property {(dt: number, engine: Engine) => void} [update]       once per frame: animation, camera, UI (`engine.alpha` says how far into the next fixed step the frame is)
 * @property {(dt: number, engine: Engine) => void} [lateUpdate]   once per frame, after every system's update
 * @property {(engine: Engine) => void} [dispose]                  when the engine is disposed
 */

/**
 * What each event hands its listener as the first argument (the engine is always the second): the time step in seconds, or for
 * 'error' whatever was thrown. `render` fires just before the frame is drawn, with the real frame time.
 * @typedef {object} EngineEventMap
 * @property {number} fixedUpdate   the fixed step, before physics
 * @property {number} afterPhysics  the fixed step, after physics
 * @property {number} update        the (scaled) frame time
 * @property {number} lateUpdate    the (scaled) frame time, after every system's update
 * @property {number} render        the real frame time, just before drawing
 * @property {unknown} error        what a frame threw (the loop goes on)
 */

/**
 * The names `engine.on()` takes.
 * @typedef {keyof EngineEventMap} EngineEvent
 */

export class Engine {
  /**
   * Creates the platform-bound parts (renderer, input, physics, assets) and returns the engine, ready to `start()`.
   * @param {EngineOptions} o
   * @returns {Promise<Engine>}
   */
  static async create(o) {
    const { platform, render = true, quality = 'high', renderScale = null, surface = null, fixedStep = 1 / 60, maxSteps = 6, maxFrame = 0.1, physics = {}, input = {}, camera = {}, baseUrl = '', assets = {} } = o ?? /** @type {EngineOptions} */ ({});
    if (!platform) throw new Error('Engine.create: pass a platform (new BrowserPlatform() in a browser, NodePlatform headless, DenoPlatform natively).');
    const scene = new Scene();
    const s = surface ?? null;
    let stage = null, cam;
    if (render) {
      stage = await Stage.create({ platform, surface: s, quality, renderScale, scene, fov: camera.fov, near: camera.near, far: camera.far });
      cam = stage.camera;
    } else {
      cam = new PerspectiveCamera(camera.fov ?? 35, 16 / 9, camera.near ?? 0.03, camera.far ?? 1500);
    }
    return new Engine({ platform, stage, scene, camera: cam, fixedStep, maxSteps, maxFrame, physics, input, baseUrl, assets });
  }

  /**
   * Use Engine.create(): it builds the stage (which needs the GPU, so it is asynchronous) and passes it in.
   * @param {object} o
   * @param {Platform} o.platform
   * @param {Stage | null} [o.stage]
   * @param {Scene} o.scene
   * @param {PerspectiveCamera} o.camera
   * @param {number} [o.fixedStep]
   * @param {number} [o.maxSteps]
   * @param {number} [o.maxFrame]
   * @param {WorldOptions} [o.physics]
   * @param {InputOptions} [o.input]
   * @param {string} [o.baseUrl]
   * @param {AssetManagerOptions} [o.assets]
   */
  constructor({ platform, stage = null, scene, camera, fixedStep = 1 / 60, maxSteps = 6, maxFrame = 0.1, physics = {}, input = {}, baseUrl = '', assets = {} }) {
    this.platform = platform;
    /** The renderer, scene and camera look: null when the engine was made with `render: false`. @type {Stage | null} */
    this.stage = stage;
    /** The scene that is drawn: add meshes and lights to it. */
    this.scene = scene;
    /** The camera. Move it yourself, or add a Director. */
    this.camera = camera;
    /** Keyboard, mouse and gamepad as named actions (`engine.input.map({...})`, `engine.input.pressed('jump')`). */
    this.input = new InputManager(platform, input);
    /** The physics world: colliders, rigid bodies, character controllers and ragdolls. */
    this.physics = new World(physics);
    /** Loads and caches models, textures, clips, ...: `await engine.assets.load('models/knight.glb')`. */
    this.assets = new AssetManager({ platform, baseUrl, ...assets });
    /** Seconds per simulation step. */
    this.fixedStep = fixedStep;
    /** Fixed steps allowed per frame. */
    this.maxSteps = maxSteps;
    /** The longest frame time that counts, seconds. */
    this.maxFrame = maxFrame;
    /** Simulation speed: 1 normal, 0.2 slow motion. */
    this.timeScale = 1;
    /** While true, simulated time stands still (input and drawing go on). */
    this.paused = false;
    /** The systems that run every frame, in the order they were added. @type {System[]} */
    this.systems = [];
    this._events = new Map();
    /** Simulated seconds (advances in fixed steps; frozen while paused). */
    this.time = 0;
    /** Frames run. */
    this.frame = 0;
    /** Fixed steps run. */
    this.stepCount = 0;
    /** This frame's simulated time step in seconds (scaled by timeScale; 0 while paused). */
    this.dt = 0;
    /** This frame's real duration in seconds. */
    this.realDt = 0;
    /** How far into the next fixed step the frame is, 0..1 (for interpolating what is drawn between two steps). */
    this.alpha = 0;
    /** Smoothed timings: frames per second, and milliseconds per frame, per frame's fixed steps (`simMs`) and per draw call recording (`renderMs`). */
    this.stats = { fps: 0, frameMs: 0, steps: 0, simMs: 0, renderMs: 0 };
    /** True between start() and stop(). */
    this.running = false;
    this._acc = 0; this._last = 0; this._raf = null; this._errAt = -1e9;
  }

  // ---------------------------------------------------------------------------------------------------- systems

  /**
   * Adds a system (any object with fixedUpdate / afterPhysics / update / lateUpdate / dispose hooks). Returns it, so
   * `const director = engine.add(new Director(engine))` works.
   * @template {System} T
   * @param {T} system
   * @returns {T}
   */
  add(system) {
    this.systems.push(system);
    system.onAdd?.(this);
    return system;
  }
  /**
   * @template {System} T
   * @param {T} system
   * @returns {T}
   */
  remove(system) {
    const i = this.systems.indexOf(system);
    if (i >= 0) { this.systems.splice(i, 1); system.onRemove?.(this); }
    return system;
  }

  /**
   * Subscribes to one of the loop's moments; the listener gets what the systems' hooks get: `(dt, engine)` (for 'render' the real
   * frame time, for 'error' the error). Returns the function that unsubscribes.
   * @template {EngineEvent} K
   * @param {K} type
   * @param {(value: EngineEventMap[K], engine: Engine) => void} fn
   * @returns {() => void}
   */
  on(type, fn) {
    let s = this._events.get(type);
    if (!s) this._events.set(type, s = new Set());
    s.add(fn);
    return () => s.delete(fn);
  }
  /**
   * Calls the listeners of `type` with `(value, engine)`.
   * @template {EngineEvent} K
   * @param {K} type
   * @param {EngineEventMap[K]} [value]
   */
  emit(type, value) { const s = this._events.get(type); if (s) for (const f of s) f(value, this); }

  // ---------------------------------------------------------------------------------------------------- the loop

  /** Stops simulated time (input, updates and drawing go on, with `dt` 0). */
  pause() { this.paused = true; }
  resume() { this.paused = false; }

  _runHook(name, dt) {
    for (const s of this.systems) if (s[name]) s[name](dt, this);
    this.emit(name, dt);
  }

  /** One fixed simulation step. */
  _fixed(h) {
    this.input.beginFixed();
    try {
      this._runHook('fixedUpdate', h);
      this.physics.step(h);
      this._runHook('afterPhysics', h);
    } finally { this.input.endFixed(); }
    this.time += h; this.stepCount++;
  }

  /**
   * Advances the game by `realDt` seconds of real time: fixed steps, updates and (when `draw`) one rendered frame.
   * The loop calls this; tests and tools can call it themselves.
   * @param {number} realDt  seconds (clipped to `maxFrame`)
   * @param {boolean} [draw]
   */
  tick(realDt, draw = true) {
    const t0 = performance.now();
    realDt = Math.max(0, Math.min(realDt, this.maxFrame));
    this.realDt = realDt;
    const dt = this.paused ? 0 : realDt * this.timeScale;
    this.dt = dt;
    this.input.advance(realDt);

    this._acc += dt;
    let steps = 0;
    while (this._acc >= this.fixedStep - 1e-9 && steps < this.maxSteps) { this._fixed(this.fixedStep); this._acc -= this.fixedStep; steps++; }
    if (this._acc >= this.fixedStep) this._acc = 0;       // could not keep up: drop the backlog instead of spiralling
    if (this._acc < 0) this._acc = 0;
    this.alpha = this._acc / this.fixedStep;
    const t1 = performance.now();

    this._runHook('update', dt);
    this._runHook('lateUpdate', dt);
    this.camera.updateMatrixWorld?.();
    const t2 = performance.now();
    if (draw && this.stage) { this.emit('render', realDt); this.stage.render(realDt); }
    const t3 = performance.now();

    this.frame++;
    const s = this.stats, k = 0.1;
    s.steps = steps;
    s.simMs += (t1 - t0 - s.simMs) * k;
    s.renderMs += (t3 - t2 - s.renderMs) * k;
    s.frameMs += (t3 - t0 - s.frameMs) * k;
    if (realDt > 0) s.fps += (1 / realDt - s.fps) * (s.fps ? k : 1);
  }

  /**
   * Runs `frames` frames of exactly `dt` seconds each (default one fixed step) - deterministic. `draw: false` skips the renderer.
   * @param {number} frames
   * @param {number} [dt]
   * @param {{ draw?: boolean }} [o]
   * @returns {this}
   */
  run(frames, dt = this.fixedStep, { draw = true } = {}) {
    for (let i = 0; i < frames; i++) this.tick(dt, draw);
    return this;
  }

  /**
   * Like run(), but lets promises settle between frames. Code written with `await actor.walkTo(...)` or `await story.say(...)` only
   * continues when the JS stack unwinds, which a synchronous run() never does: a script and the simulation must take turns.
   * @param {number} frames
   * @param {number} [dt]
   * @param {{ draw?: boolean }} [o]
   * @returns {Promise<this>}
   */
  async runAsync(frames, dt = this.fixedStep, { draw = true } = {}) {
    for (let i = 0; i < frames; i++) {
      this.tick(dt, draw);
      await new Promise((resolve) => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)));
    }
    return this;
  }

  /** Starts the real-time loop on the platform's frame callback (requestAnimationFrame in a browser). @returns {this} */
  start() {
    if (this.running) return this;
    this.running = true;
    this._last = this.platform.now();
    const loop = (t) => {
      if (!this.running) return;
      const now = typeof t === 'number' ? t : this.platform.now();
      const dt = (now - this._last) / 1000;
      this._last = now;
      try { this.tick(dt); } catch (e) { this._fail(e); }
      if (this.running) this._raf = this.platform.requestFrame(loop);
    };
    this._raf = this.platform.requestFrame(loop);
    return this;
  }

  /** Stops the real-time loop. @returns {this} */
  stop() {
    this.running = false;
    if (this._raf !== null) this.platform.cancelFrame?.(this._raf);
    this._raf = null;
    return this;
  }

  /** A game error must not freeze the loop silently: report it (not more than every two seconds) and keep going. */
  _fail(e) {
    const now = this.platform.now();
    if (now - this._errAt > 2000) { console.error('[medengine] error in frame', this.frame, e); this._errAt = now; }
    this.emit('error', e);
  }

  // ---------------------------------------------------------------------------------------------------- utilities

  /**
   * The last frame as RGBA8 `{ width, height, data }`. On a canvas or a window, whose texture lives for one frame only, the scene
   * is drawn once more (no time passes) and that frame is returned.
   * @returns {Promise<RGBA8Image>}
   */
  async screenshot() {
    if (!this.stage) throw new Error('Engine.screenshot: this engine runs without a renderer');
    const shot = this.stage.capture();
    if (this.stage.surface.transient) { this.emit('render', 0); this.stage.render(0); }
    return shot;
  }
  /**
   * The last frame as PNG bytes; written to `path` when given (not possible in a browser: it offers a download).
   * @param {string | null} [path]
   * @returns {Promise<Uint8Array>}
   */
  async screenshotPNG(path = null) {
    const bytes = await this.platform.encodePNG(await this.screenshot());
    if (path) await this.platform.writeFile(path, bytes);
    return bytes;
  }

  /** Stops the loop and frees everything the engine made: systems, input listeners, assets, the renderer and its GPU device. */
  dispose() {
    this.stop();
    for (const s of [...this.systems]) { s.dispose?.(this); }
    this.systems.length = 0;
    this.input.dispose();
    this.assets.dispose();
    this.stage?.dispose();
  }
}
