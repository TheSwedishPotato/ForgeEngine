/**
 * The WebGPU deferred renderer.
 *
 *   shadows (sun cascades + focus map)  ->  G-buffer  ->  local lights (tiles, spot shadows)
 *   ->  deferred lighting + sky  ->  skin scattering  ->  TAAU  ->  exposure  ->  bloom  ->  film composite
 *
 * Conventions: right-handed world, +Y up; reversed-Z main view (near = 1, far = 0, sky = 0); shadow maps
 * non-reversed. Everything runs at an internal resolution (`renderScale` of the display) and the temporal
 * upscaler reconstructs the display resolution.
 */
import { Matrix4, Vector3 } from '../math/core.js';
import { Frustum } from '../math/geometry.js';
import { GPU, BUFFER, TEX } from '../gpu/Device.js';
import { GpuTimer } from '../gpu/Timer.js';
import { UniformArena, readTexture, toRGBA8 } from '../gpu/Resources.js';
import { Frame } from './shaders/common.js';
import { GEOMETRY_WGSL, ObjectU } from './shaders/geometry.js';
import { LIGHTING_WGSL, LIGHTING_LAYOUT_1, LIGHTING_LAYOUT_2, TILE } from './shaders/lighting.js';
import { ResourceCache, ATTRS } from './Cache.js';
import { SceneGPU, sphereInFrustum } from './SceneGPU.js';
import { Environment } from './passes/Environment.js';
import { Shadows, FOCUS } from './passes/Shadows.js';
import { LightGrid } from './passes/LightGrid.js';
import { Exposure, Bloom, SkinSSS, TAA, Upscale, Composite } from './passes/Post.js';
import { RenderTarget } from './Fullscreen.js';

/**
 * @import { Platform, Surface } from '../platform/Platform.js'
 * @import { Scene } from '../scene/Object3D.js'
 * @import { PerspectiveCamera, OrthographicCamera } from '../scene/Camera.js'
 * @import { QualityName } from '../types.js'
 */

/**
 * What Renderer.create() takes.
 * @typedef {object} RendererOptions
 * @property {Platform} platform         where the GPU comes from, and the surface to draw in
 * @property {Surface | null} [surface]  draw into this instead of a surface the platform makes
 * @property {QualityName} [quality]     'low' | 'medium' | 'high' (default) | 'ultra'
 * @property {number | null} [renderScale]  internal resolution relative to the display (default: the quality's)
 */

/** Halton low-discrepancy sequence for sub-pixel jitter. */
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

/** Quality presets. `renderScale` is the internal resolution relative to the display. */
export const QUALITY = {
  ultra: { renderScale: 1.0, shadowSize: 4096, cascades: 4, bloom: true, sss: true, maxDpr: 2, envSize: 256, spotAtlas: 4096, contactShadows: true, focusShadows: true },
  high: { renderScale: 0.77, shadowSize: 2048, cascades: 4, bloom: true, sss: true, maxDpr: 2, envSize: 256, spotAtlas: 4096, contactShadows: true, focusShadows: true },
  medium: { renderScale: 0.67, shadowSize: 2048, cascades: 3, bloom: true, sss: true, maxDpr: 1.5, envSize: 128, spotAtlas: 2048, contactShadows: true, focusShadows: true },
  low: { renderScale: 0.5, shadowSize: 1024, cascades: 2, bloom: true, sss: false, maxDpr: 1, envSize: 128, spotAtlas: 2048, contactShadows: false, focusShadows: false },
};

const STRIDE = { float32: 4, float32x2: 8, float32x3: 12, float32x4: 16, uint16x4: 8, uint8x4: 4, unorm8x4: 4, uint32x4: 16, unorm16x4: 8 };
const ORDER = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color', 'morphSlot'];
const GBUFFER_FORMATS = ['rgba8unorm-srgb', 'rgba16float', 'rgba16float', 'rgba16float'];
const DEPTH = 'depth32float';

const _vp = new Matrix4(), _proj = new Matrix4(), _frustum = new Frustum(), _v = new Vector3(), _v2 = new Vector3();

export class Renderer {
  /**
   * Creates the GPU device on `platform` and a renderer drawing into `surface` (default: the platform's).
   * @param {RendererOptions} o
   * @returns {Promise<Renderer>}
   */
  static async create(o) {
    const { platform, quality = 'high', renderScale = null } = o ?? /** @type {RendererOptions} */ ({});
    let surface = o?.surface ?? null;
    if (!platform) throw new Error('Renderer.create: pass a platform (new BrowserPlatform() in a browser, NodePlatform headless, DenoPlatform natively).');
    const gpu = await GPU.create({ gpu: await platform.getGPU() });
    const ownsSurface = !surface;
    surface ??= platform.createSurface();
    surface.configure(gpu);
    const r = new Renderer({ gpu, platform, surface, quality, renderScale });
    // what create() made, dispose() releases: the device always, the surface only when it was not handed in
    r.ownsGPU = true; r.ownsSurface = ownsSurface;
    return r;
  }

  /** @param {{ gpu: GPU, platform?: Platform | null, surface: Surface, quality?: QualityName, renderScale?: number | null }} o */
  constructor({ gpu, platform = null, surface, quality = 'high', renderScale = null }) {
    this.gpu = gpu; this.platform = platform; this.surface = surface;
    this.q = { ...(QUALITY[quality] ?? QUALITY.high) };
    if (renderScale) this.q.renderScale = renderScale;
    this.qualityName = quality;
    this.frame = 0; this.time = 0; this.dt = 1 / 60;
    this.arena = new UniformArena(gpu, 8 << 20);
    this.cache = new ResourceCache(gpu);
    this.sceneGPU = new SceneGPU(gpu, this.cache, this.arena);
    this.stats = { drawCalls: 0, triangles: 0, items: 0, culled: 0, lights: 0, shadowedLights: 0, cpuMs: 0 };
    /** Per-pass GPU timing, off until enableGpuTiming(). */
    this.timer = null;

    // -- state the game drives (see also Stage)
    this.sunDir = new Vector3(-0.55, 0.42, 0.72).normalize();
    this.sunColor = { x: 1.0, y: 0.87, z: 0.7 };
    this.sunIntensity = 7.5;           // used when the scene has no DirectionalLight
    this.cloudCover = 0.5;
    this.envIntensity = 1;
    this.weather = { night: 0, overcast: 0, lightning: 0, cityGlow: [0.05, 0.035, 0.02], lightningDir: [0.3, 0.6, -0.7] };
    this.wetness = 0; this.rain = 0;
    this.shadowFocus = null;           // { center: Vector3, radius }
    this.contactShadowLength = 0.35;   // metres of screen-space ray toward the sun
    this.shadowsOn = true;
    this.debug = 0;
    this.lens = {};                    // per-frame lens state read by the composite (aberration, hurt, flash, visor)
    this.reflectionProbe = null;       // { pos: Vector3, radius }

    // -- camera matrices
    this.view = new Matrix4(); this.proj = new Matrix4(); this.projJit = new Matrix4();
    this.viewProj = new Matrix4(); this.viewProjJit = new Matrix4(); this.invViewProj = new Matrix4(); this.invViewProjFlat = new Matrix4(); this.invProj = new Matrix4();
    this.prevViewProj = new Matrix4(); this.cameraPos = new Vector3();
    this.jitter = [0, 0];

    // -- layouts and pipelines
    this.frameLayout = gpu.layout('frame', [{ b: 0, v: 'vf', buffer: 'uniform', dynamic: true }]);
    this.objectLayout = gpu.layout('object', [{ b: 0, v: 'v', buffer: 'uniform', dynamic: true }]);
    this.geometryLayout = gpu.pipelineLayout('geometry', [this.frameLayout, this.cache.materialLayout, this.objectLayout, this.sceneGPU.resLayout]);
    this.lightLayout1 = gpu.layout('lighting1', LIGHTING_LAYOUT_1);
    this.lightLayout2 = gpu.layout('lighting2', LIGHTING_LAYOUT_2);
    this.lightingPipelineLayout = gpu.pipelineLayout('lighting', [this.frameLayout, this.lightLayout1, this.lightLayout2]);
    this._frameBG = null; this._objBG = null; this._arenaGen = -1;

    // -- passes
    const ctx = { gpu, arena: this.arena };
    this.env = new Environment(ctx, { size: this.q.envSize });
    this.shadows = new Shadows(gpu, { size: this.q.shadowSize, cascades: this.q.cascades });
    this.lightGrid = new LightGrid(gpu, { shadowSize: this.q.spotAtlas });
    this.exposure = new Exposure(ctx);
    this.bloom = new Bloom(ctx);
    this.sss = new SkinSSS(ctx);
    this.taa = new TAA(ctx);
    this.upscale = new Upscale(ctx);
    this.composite = new Composite(ctx);
    this.extraPasses = [];            // user passes: { afterLighting(renderer, enc, colorView) -> view? }
    this._whiteAO = null;
    this._lightBG1 = null;
    this._envKey = ''; this._envTime = -10;
    this.resize();
    // the BRDF lookup table is a constant: render it once
    const enc = gpu.device.createCommandEncoder({ label: 'init' });
    this.env.initLUT(enc);
    gpu.queue.submit([enc.finish()]);
    this._unsub = surface.onResize(() => this.resize());
  }

  // -------------------------------------------------------------------------------------------
  // Sizes

  resize() {
    const gpu = this.gpu, s = this.surface;
    const W = Math.max(1, s.width), H = Math.max(1, s.height);
    this.displayW = W; this.displayH = H;
    const sc = this.q.renderScale;
    this.width = Math.max(1, Math.round(W * sc)); this.height = Math.max(1, Math.round(H * sc));
    const mk = (format, label, extra = 0) => gpu.texture({ label, size: [this.width, this.height, 1], format, usage: TEX.RENDER | TEX.BINDING | TEX.COPY_SRC | extra });
    for (const t of this.gbuffer ?? []) t.destroy();
    this.depthTex?.destroy(); this.hdr?.destroy(); this.skin?.destroy();
    this.gbuffer = GBUFFER_FORMATS.map((f, i) => mk(f, `gbuffer ${i}`));
    this.gviews = this.gbuffer.map((t) => t.createView());
    this.depthTex = mk(DEPTH, 'depth');
    this.depthView = this.depthTex.createView();
    this.hdr = mk('rgba16float', 'hdr'); this.hdrView = this.hdr.createView();
    this.skin = mk('rgba16float', 'skin diffuse'); this.skinView = this.skin.createView();
    this.bloom.resize(this.displayW, this.displayH);
    this.sss.resize(this.width, this.height);
    this.taa.resize(this.displayW, this.displayH);
    this.upscale.resize(this.displayW, this.displayH);
    this.composite.resize(this.displayW, this.displayH);
    this._lightBG1 = null;
    this.taa.reset = true;
  }

  /**
   * Turns per-pass GPU timing (timestamp queries) on or off. Returns whether it is on: false when the device has no 'timestamp-query'.
   * The numbers are in `renderer.timer.avg` / `.last` (see gpu/Timer.js) and arrive a few frames after the frame they measure.
   */
  enableGpuTiming(on = true) {
    if (!on) { this.timer?.dispose(); this.timer = null; return false; }
    this.timer ??= new GpuTimer(this.gpu);
    return this.timer.supported;
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return;
    this.qualityName = name;
    this.q = { ...QUALITY[name] };
    this.shadows.resize(this.q.shadowSize, this.q.cascades);
    this._lightBG1 = null;
    this.resize();
  }

  // -------------------------------------------------------------------------------------------
  // Camera

  _setupCamera(camera) {
    this.camera = camera;
    this.cameraPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.copy(camera.matrixWorldInverse);
    this.proj.copy(camera.projectionMatrix);
    const i = (this.frame % 16) + 1;
    const temporal = this.taa.enabled;
    this.jitter[0] = temporal ? halton(i, 2) - 0.5 : 0;
    this.jitter[1] = temporal ? halton(i, 3) - 0.5 : 0;
    this.projJit.copy(this.proj);
    const e = this.projJit.elements;
    if (camera.isOrthographicCamera) { e[12] -= (this.jitter[0] * 2) / this.width; e[13] += (this.jitter[1] * 2) / this.height; }
    else { e[8] += (this.jitter[0] * 2) / this.width; e[9] -= (this.jitter[1] * 2) / this.height; }
    this.viewProj.multiplyMatrices(this.proj, this.view);
    this.viewProjJit.multiplyMatrices(this.projJit, this.view);
    this.invViewProj.copy(this.viewProjJit).invert();
    this.invViewProjFlat.copy(this.viewProj).invert();
    this.invProj.copy(this.projJit).invert();
    _frustum.setFromProjectionMatrix(this.viewProj);
    this.frustum = _frustum;
    // a camera cut: last frame's pixels say nothing about this one
    const moved = this._lastCamPos ? this._lastCamPos.distanceTo(this.cameraPos) : 1e9;
    const dir = camera.getWorldDirection(_v2);
    const turned = this._lastCamDir ? 1 - this._lastCamDir.dot(dir) : 1;
    if (moved > 3 || turned > 0.02) this.taa.reset = true;
    (this._lastCamPos ??= new Vector3()).copy(this.cameraPos);
    (this._lastCamDir ??= new Vector3()).copy(dir);
  }

  // -------------------------------------------------------------------------------------------
  // Frame uniforms

  _frameGroups() {
    if (this._arenaGen !== this.arena.generation) {
      const dev = this.gpu.device;
      this._frameBG = dev.createBindGroup({ label: 'frame', layout: this.frameLayout, entries: [{ binding: 0, resource: { buffer: this.arena.buffer, size: Frame.size } }] });
      this._objBG = dev.createBindGroup({ label: 'object', layout: this.objectLayout, entries: [{ binding: 0, resource: { buffer: this.arena.buffer, size: ObjectU.size } }] });
      this._arenaGen = this.arena.generation;
    }
  }

  _sunState(sun) {
    if (sun) {
      sun.getWorldPosition(_v);
      (sun.target ? sun.target.getWorldPosition(_v2) : _v2.set(0, 0, 0));
      const d = _v.sub(_v2);
      if (d.lengthSq() > 1e-12) this.sunDir.copy(d).normalize();
      return { r: sun.color.r, g: sun.color.g, b: sun.color.b, i: sun.intensity };
    }
    return { r: this.sunColor.x, g: this.sunColor.y, b: this.sunColor.z, i: this.sunIntensity };
  }

  /** Allocates and fills the main Frame uniform. Returns its dynamic offset. */
  _mainFrame(sunState, lightCount) {
    const off = this.arena.alloc(Frame.size);
    const w = Frame.writer(this.arena.f32, this.arena.u32, this.arena.i32)(off);
    const W = this.weather, sh = this.shadows;
    w.set('viewProj', this.viewProjJit).set('viewProjFlat', this.viewProj).set('prevViewProj', this.prevViewProj)
      .set('view', this.view).set('proj', this.projJit).set('invViewProj', this.invViewProj).set('invProj', this.invProj)
      .set('cameraPos', this.cameraPos).set('time', this.time)
      .set('jitter', this.jitter).set('resolution', [this.width, this.height])
      .set('wetness', this.wetness).set('rain', this.rain).set('frame', this.frame).set('envLevels', this.env.levels)
      .set('sunDir', this.sunDir).set('cloudCover', this.cloudCover)
      .set('sunColor', [sunState.r, sunState.g, sunState.b]).set('night', W.night)
      .set('sunIrradiance', [sunState.r * sunState.i, sunState.g * sunState.i, sunState.b * sunState.i]).set('overcast', W.overcast)
      .set('cityGlow', W.cityGlow).set('lightning', W.lightning)
      .set('lightningPos', W.lightningDir).set('envIntensity', this.envIntensity)
      .set('shadowMat', sh.matrices)
      .set('shadowSplits', sh.splits).set('shadowTexel', sh.texel)
      .set('shadowSize', sh.size).set('shadowsOn', this.shadowsOn ? 1 : 0).set('shadowFocusOn', sh.focusOn).set('shadowFocusTexel', sh.focusTexel)
      .set('contact', this.q.contactShadows === false ? 0 : this.contactShadowLength).set('lightCount', lightCount)
      .set('tilesX', Math.ceil(this.width / TILE)).set('tilesY', Math.ceil(this.height / TILE))
      .set('reflPos', this.reflectionProbe?.pos ?? [0, 0, 0]).set('reflRadius', this.reflectionProbe?.radius ?? 0)
      .set('debug', this.debug).set('aoOn', 0).set('ssrOn', 0);
    return off;
  }

  /** A Frame holding only a view-projection, for shadow passes. */
  _depthFrame(vp) {
    const off = this.arena.alloc(Frame.size);
    Frame.writer(this.arena.f32, this.arena.u32, this.arena.i32)(off).set('viewProj', vp);
    return off;
  }

  // -------------------------------------------------------------------------------------------
  // Pipelines

  /** Everything that selects a geometry pipeline for an item, as a cheap string (computed once per item and frame). */
  _pipeKey(it) {
    const m = it.material;
    return `${it.geo.sig}|${it.mat.defKey}|${m.side}|${it.flip ? 1 : 0}${it.skinned ? 1 : 0}${it.instanced ? 1 : 0}${it.instanceColor ? 1 : 0}${it.morph ? 1 : 0}${m.vertexColors ? 1 : 0}`;
  }

  _geoPipeline(it, kind, level) {
    const g = it.geo, m = it.material, md = it.mat.defines;
    // shadow casters only need a fragment stage when the surface has holes (alpha test, dither, transparency)
    const needsFragment = kind === 'gbuffer' || !!(md.ALPHA_TEST || md.ALPHA_DITHER || md.TRANSPARENT);
    const used = ORDER.filter((n) => {
      if (!g.buffers[n]) return false;
      if (n === 'uv') return needsFragment;
      if (n === 'skinIndex' || n === 'skinWeight') return it.skinned;
      if (n === 'color') return needsFragment && !!m.vertexColors;
      if (n === 'morphSlot') return it.morph && !!g.morph;
      return true;
    });
    const defines = {};
    if (used.includes('uv')) defines.HAS_UV = true;
    if (it.skinned) defines.SKINNED = true;
    if (it.instanced) { defines.INSTANCED = true; if (it.instanceColor) defines.INSTANCE_COLOR = true; }
    if (used.includes('color')) defines.HAS_COLOR = true;
    if (used.includes('morphSlot')) defines.MORPH = true;
    if (kind === 'gbuffer') {
      defines.GBUFFER = true;
      for (const k in md) if (md[k]) defines[k] = true;
    } else if (needsFragment) {
      for (const k of ['USE_MAP', 'ALPHA_TEST', 'ALPHA_DITHER', 'TRANSPARENT']) if (md[k]) defines[k] = true;
    }
    const side = kind === 'gbuffer' ? m.side : 2;
    const key = `geo:${kind}:${kind === 'depth' ? level : ''}:${used.map((n) => n + g.formats[n]).join('|')}:${Object.keys(defines).sort().join(',')}:${side}:${side === 2 ? 0 : it.flip ? 1 : 0}`;
    const gpu = this.gpu;
    const pipeline = gpu.renderPipeline(key, () => {
      const module = gpu.shader(`geometry:${kind}`, GEOMETRY_WGSL, defines);
      const buffers = used.map((n) => ({ arrayStride: STRIDE[g.formats[n]], attributes: [{ shaderLocation: ATTRS[n].loc, offset: 0, format: g.formats[n] }] }));
      // a mirrored transform reverses the winding
      const cullMode = side === 2 ? 'none' : ((side === 1) !== it.flip ? 'front' : 'back');
      const desc = {
        label: key, layout: this.geometryLayout,
        vertex: { module, entryPoint: 'vs', buffers },
        primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
      };
      if (kind === 'gbuffer') {
        desc.fragment = { module, entryPoint: 'fs', targets: GBUFFER_FORMATS.map((format) => ({ format })) };
        desc.depthStencil = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' };
      } else {
        if (needsFragment) desc.fragment = { module, entryPoint: 'fs', targets: [] };
        desc.depthStencil = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2 + level, depthBiasSlopeScale: 1.6 + 0.6 * level };
      }
      return desc;
    });
    return { pipeline, used };
  }

  /** Records draws of `items` into `pass`. */
  _draw(pass, items, kind, frameOffset, { frustum = null, level = 0, minRadius = 0 } = {}) {
    pass.setBindGroup(0, this._frameBG, [frameOffset]);
    const st = this.stats;
    let curPipe = null, curMat = null, curRes = null, curGeo = null, curUsed = null, curObj = -1;
    const planes = frustum ? frustum.planes : null;
    const pipes = (this._pipes ??= {})[kind + level] ??= new Map();
    for (const it of items) {
      if (kind === 'depth') { if (!it.castShadow) continue; } else if (it.shadowOnly) continue;
      const b = it.bounds;
      if (b) {
        if (minRadius && b[3] < minRadius) continue;
        if (planes && !sphereInFrustum(planes, b[0], b[1], b[2], b[3])) { st.culled++; continue; }
      }
      let rec = pipes.get(it.pk ??= this._pipeKey(it));
      if (!rec) { rec = this._geoPipeline(it, kind, level); pipes.set(it.pk, rec); }
      const { pipeline, used } = rec;
      if (pipeline !== curPipe) { pass.setPipeline(pipeline); curPipe = pipeline; curGeo = null; }
      if (it.mat.bg !== curMat) { pass.setBindGroup(1, it.mat.bg); curMat = it.mat.bg; }
      if (it.objOffset !== curObj || curObj < 0) { pass.setBindGroup(2, this._objBG, [it.objOffset]); curObj = it.objOffset; }
      if (it.resBG !== curRes) { pass.setBindGroup(3, it.resBG); curRes = it.resBG; }
      if (it.geo !== curGeo || used !== curUsed) {
        const g = it.geo;
        for (let s = 0; s < used.length; s++) pass.setVertexBuffer(s, g.buffers[used[s]]);
        if (g.index) pass.setIndexBuffer(g.index, g.indexFormat);
        curGeo = g; curUsed = used;
      }
      if (it.geo.index) pass.drawIndexed(it.count, it.instances, it.start, 0, 0);
      else pass.draw(it.count, it.instances, it.start, 0);
      st.drawCalls++; st.triangles += (it.count / 3) * it.instances;
    }
  }

  // -------------------------------------------------------------------------------------------
  // The frame

  /**
   * Renders `scene` seen from `camera` into the surface.
   * @param {Scene} scene
   * @param {PerspectiveCamera | OrthographicCamera} camera
   * @param {number} [dt] seconds since the last frame (1/60)
   */
  render(scene, camera, dt = 1 / 60) {
    const t0 = performance.now();
    const gpu = this.gpu, dev = gpu.device;
    this.dt = dt; this.time += dt;
    const st = this.stats; st.drawCalls = 0; st.triangles = 0; st.culled = 0;
    this.cache.frame = this.frame;
    this.arena.reset();
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    this._setupCamera(camera);
    this._frameGroups();
    const gen0 = this.arena.generation;

    const lists = this.sceneGPU.collect(scene, this.frame);
    const items = lists.items;
    // group by pipeline-relevant state to keep bind and pipeline changes low
    items.sort((a, b) => (a.mat.defKey < b.mat.defKey ? -1 : a.mat.defKey > b.mat.defKey ? 1 : a.geo.sig < b.geo.sig ? -1 : a.geo.sig > b.geo.sig ? 1 : a.material.id - b.material.id));
    st.items = items.length;
    const sun = this._sunState(lists.sun);
    const enc = dev.createCommandEncoder({ label: `frame ${this.frame}` });
    const timing = this.timer?.begin(enc) ?? null;

    // -- sky light (only when the sky changed)
    const mainFrame = this._mainFrame(sun, 0);
    const key = this._envKeyOf(sun);
    if (key !== this._envKey && (this.time - this._envTime > 0.2 || this.env.dirty)) {
      this.env.update(enc, this._frameBG, mainFrame);
      this._envKey = key; this._envTime = this.time;
    }

    // -- sun shadows
    const sh = this.shadows;
    sh.focus = this.q.focusShadows === false ? null : this.shadowFocus;
    let frameOffset;
    if (this.shadowsOn) {
      sh.fit(camera, this.sunDir);
      // rewrite the main frame now that the cascade matrices exist
      frameOffset = this._mainFrame(sun, lists.lights.length);
      sh.render(enc, (pass, cascade, index) => {
        if (!cascade) return;
        const fo = this._depthFrame(cascade.vp);
        _frustum.setFromProjectionMatrix(cascade.vp);
        this._draw(pass, items, 'depth', fo, { frustum: _frustum, level: index, minRadius: cascade.texel * 2.5 });
      });
      _frustum.setFromProjectionMatrix(this.viewProj);
    } else { frameOffset = this._mainFrame(sun, lists.lights.length); }

    // -- G-buffer
    {
      const pass = enc.beginRenderPass({
        label: 'gbuffer',
        colorAttachments: this.gviews.map((view, i) => ({ view, loadOp: 'clear', storeOp: 'store', clearValue: i === 1 ? [0, 0, 1, 0] : [0, 0, 0, 0] })),
        depthStencilAttachment: { view: this.depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      this._draw(pass, items, 'gbuffer', frameOffset, { frustum: this.frustum });
      pass.end();
    }

    // -- local lights: tile lists and spot shadows
    this.lightGrid.update(enc, { width: this.width, height: this.height, view: this.view, proj: this.proj, near: camera.near }, lists.lights, (pass, vp) => {
      const fo = this._depthFrame(vp);
      const fr = new Frustum().setFromProjectionMatrix(vp);
      this._draw(pass, items, 'depth', fo, { frustum: fr, level: 5 });
    });
    st.lights = this.lightGrid.stats.lights; st.shadowedLights = this.lightGrid.stats.shadowed;

    // -- deferred lighting
    this._lighting(enc, frameOffset);

    // -- everything after lighting
    let color = this.hdrView;
    if (this.q.sss !== false && this.sss.enabled) color = this.sss.run(enc, this, color, this.skinView, this.depthView);
    for (const p of this.extraPasses) if (p.afterLighting) color = p.afterLighting(this, enc, color, frameOffset) ?? color;
    let display;
    if (this.taa.enabled) display = this.taa.run(enc, this, color, this.gviews[2], this.depthView);
    else display = this.upscale.run(enc, color);
    this.exposure.run(enc, display, dt);
    if (this.bloom.enabled && this.q.bloom) this.bloom.run(enc, display);
    const target = this.surface.getCurrentTexture();
    this.composite.run(enc, this, {
      colorView: display, bloomView: this.bloom.enabled && this.q.bloom ? this.bloom.texture.view : null, bloomStrength: this.bloom.strength,
      exposureView: this.exposure.texture.view, outView: target.createView(), outFormat: this.surface.format, lens: this.lens, time: this.time,
    });

    // a pending capture() of a one-frame surface: copy the finished image into a texture that outlives the frame
    let grab = null;
    if (this._grabs?.length) {
      grab = gpu.texture({ label: 'capture', size: [target.width, target.height, 1], format: target.format, usage: TEX.COPY_SRC | TEX.COPY_DST });
      enc.copyTextureToTexture({ texture: target }, { texture: grab }, [target.width, target.height, 1]);
    }

    if (timing) this.timer.end(enc, timing);

    if (this.arena.generation !== gen0 && !this._warnedArena) { this._warnedArena = true; console.warn('[medengine] the uniform arena grew during a frame: this frame may show stale data'); }
    this.arena.flush();
    gpu.queue.submit([enc.finish()]);
    this.surface.present();
    if (timing) this.timer.collect(timing);
    if (grab) {
      const waiting = this._grabs.splice(0);
      readTexture(gpu, grab).then((r) => {
        grab.destroy();
        const data = toRGBA8(r);
        waiting.forEach((w, i) => w.resolve({ width: r.width, height: r.height, data: i ? data.slice() : data }));
      }, (e) => { grab.destroy(); for (const w of waiting) w.reject(e); });
    }

    // -- bookkeeping for the next frame
    this.prevViewProj.copy(this.viewProj);
    this.sceneGPU.endFrame(items);
    this.frame++;
    this.stats.cpuMs += (performance.now() - t0 - this.stats.cpuMs) * 0.1;
    this.lastItems = items;
  }

  _envKeyOf(sun) {
    const q = (v, s) => Math.round(v / s);
    const W = this.weather, d = this.sunDir;
    return [q(d.x, 0.004), q(d.y, 0.004), q(d.z, 0.004), q(sun.r * sun.i, 0.05), q(sun.g * sun.i, 0.05), q(sun.b * sun.i, 0.05), q(this.cloudCover, 0.02), q(W.night, 0.02), q(W.overcast, 0.02), q(W.lightning, 0.1),
      q(W.cityGlow[0], 0.005), q(W.cityGlow[1], 0.005), q(W.cityGlow[2], 0.005), q(this.envIntensity, 0.01)].join(',');
  }

  invalidateEnvironment() { this.env.dirty = true; this._envKey = ''; }

  _lighting(enc, frameOffset) {
    const gpu = this.gpu, dev = gpu.device;
    if (!this._lightBG1) {
      this._whiteAO ??= (() => { const t = gpu.texture({ size: [1, 1, 1], format: 'r8unorm', usage: TEX.BINDING | TEX.COPY_DST }); gpu.queue.writeTexture({ texture: t }, new Uint8Array([255]), { bytesPerRow: 1 }, [1, 1, 1]); return t.createView(); })();
      this._lightBG1 = dev.createBindGroup({
        label: 'lighting inputs', layout: this.lightLayout1,
        entries: [
          { binding: 0, resource: this.gviews[0] }, { binding: 1, resource: this.gviews[1] }, { binding: 2, resource: this.gviews[2] }, { binding: 3, resource: this.gviews[3] },
          { binding: 4, resource: this.depthView },
          { binding: 5, resource: this.shadows.view },
          { binding: 6, resource: this.lightGrid.shadowView },
          { binding: 7, resource: gpu.sampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }) },
          { binding: 8, resource: this.env.specView },
          { binding: 9, resource: gpu.sampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge', mipmapFilter: 'linear' }) },
          { binding: 10, resource: this.env.lutView },
          { binding: 11, resource: this._whiteAO },
        ],
      });
    }
    const bg2 = dev.createBindGroup({
      label: 'lighting storage', layout: this.lightLayout2,
      entries: [{ binding: 0, resource: { buffer: this.lightGrid.lightsBuf } }, { binding: 1, resource: { buffer: this.lightGrid.tilesBuf } }, { binding: 2, resource: { buffer: this.env.sh } }],
    });
    const module = gpu.shader('lighting', LIGHTING_WGSL);
    const pipeline = gpu.renderPipeline('lighting', () => ({
      label: 'lighting', layout: this.lightingPipelineLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }, { format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    }));
    const pass = enc.beginRenderPass({
      label: 'lighting',
      colorAttachments: [
        { view: this.hdrView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
        { view: this.skinView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this._frameBG, [frameOffset]);
    pass.setBindGroup(1, this._lightBG1);
    pass.setBindGroup(2, bg2);
    pass.draw(3);
    pass.end();
  }

  // -------------------------------------------------------------------------------------------
  // Utilities

  /**
   * Waits for the GPU and returns the last presented frame as RGBA8 bytes { width, height, data }.
   * A canvas or window texture only lives for one frame, so for those the NEXT frame to be drawn is copied out as it is
   * drawn (Engine.screenshot() draws that frame for you); an offscreen surface keeps its texture and is read directly.
   */
  async capture() {
    if (this.surface.transient) return new Promise((resolve, reject) => { (this._grabs ??= []).push({ resolve, reject }); });
    await this.gpu.idle();
    const tex = this.surface.getCurrentTexture();
    const r = await readTexture(this.gpu, tex);
    return { width: r.width, height: r.height, data: toRGBA8(r) };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._unsub?.();
    this.timer?.dispose();
    for (const t of this.gbuffer ?? []) t.destroy();
    this.depthTex?.destroy(); this.hdr?.destroy(); this.skin?.destroy();
    this._grabs?.splice(0).forEach((w) => w.reject(new Error('the renderer was disposed before the frame to capture was drawn')));
    if (this.ownsSurface) this.surface.destroy?.();
    if (this.ownsGPU) this.gpu.destroy();
  }
}

void FOCUS; void BUFFER; void RenderTarget; void _vp; void _proj;
