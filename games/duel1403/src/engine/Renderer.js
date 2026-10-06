import { Matrix4, Vector3, Vector4, Frustum, Sphere } from 'three';
import { createContext, Program, Texture, Target, postProgram, fullscreen, state } from './gl/GL.js';
import { SceneAdapter } from './scene/SceneAdapter.js';
import { GEOMETRY_VS, GBUFFER_FS, DEPTH_FS } from './shaders/geometry.js';
import { LIGHTING_FS } from './shaders/lighting.js';
import { Environment } from './passes/Environment.js';
import { Shadows } from './passes/Shadows.js';
import { CAPTURE_FS } from './gi/ProbeVolume.js';

const _m = new Matrix4(), _frustum = new Frustum(), _sphere = new Sphere(), _v = new Vector3();

/** Halton low-discrepancy sequence for sub-pixel jitter. */
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

/**
 * Quality presets. renderScale is the internal resolution relative to the
 * display; the temporal upscaler reconstructs full resolution.
 */
export const QUALITY = {
  ultra: { renderScale: 1.0, shadowSize: 4096, cascades: 4, ssao: true, ssgi: true, ssr: true, volumetrics: 'high', probes: true, bloom: true, dof: true, motionBlur: true, maxDpr: 2, envSize: 256 },
  high: { renderScale: 0.77, shadowSize: 2048, cascades: 4, ssao: true, ssgi: true, ssr: true, volumetrics: 'high', probes: true, bloom: true, dof: true, motionBlur: true, maxDpr: 2, envSize: 256 },
  medium: { renderScale: 0.67, shadowSize: 2048, cascades: 3, ssao: true, ssgi: false, ssr: true, volumetrics: 'low', probes: true, bloom: true, dof: false, motionBlur: true, maxDpr: 1.5, envSize: 128 },
  low: { renderScale: 0.5, shadowSize: 1024, cascades: 2, ssao: false, ssgi: false, ssr: false, volumetrics: 'off', probes: false, bloom: true, dof: false, motionBlur: false, maxDpr: 1, envSize: 128, focusShadows: false, contactShadows: false },
};

export class Renderer {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    const gl = createContext(canvas, { preserveDrawingBuffer: !!new URLSearchParams(location.search).get('manual') });
    this.gl = gl;
    this.adapter = new SceneAdapter(gl);
    this.programs = new Map();
    this.q = { ...QUALITY[quality] ?? QUALITY.high };
    this.qualityName = quality;
    this.frame = 0;
    this.time = 0;
    this.sunDir = new Vector3(-0.55, 0.42, 0.72).normalize();
    this.sunColor = new Vector3(1.0, 0.87, 0.7);
    this.sunIntensity = 7.5;
    this.cloudCover = 0.5;
    this.envIntensity = 1.0;
    this.passes = [];           // extra passes register here (SSAO, GI, volumetrics, post…)
    this.stats = { drawCalls: 0, triangles: 0, items: 0, culled: 0 };

    // Camera matrices.
    this.view = new Matrix4();
    this.proj = new Matrix4();
    this.projJit = new Matrix4();
    this.viewProj = new Matrix4();
    this.viewProjJit = new Matrix4();
    this.invViewProj = new Matrix4();
    this.invProj = new Matrix4();
    this.prevViewProj = new Matrix4();
    this.jitter = [0, 0];
    this.cameraPos = new Vector3();

    this.env = new Environment(gl, { size: this.q.envSize });
    this.shadows = new Shadows(gl, { size: this.q.shadowSize, cascades: 4 });
    this.shadowFocus = null;          // {center, radius}: a sharper shadow map around what matters (see Shadows)
    this.contactShadowLength = 0.35;  // metres of screen-space ray toward the sun
    this.lighting = postProgram(gl, LIGHTING_FS, {}, 'lighting');
    this.black = new Texture(gl, { width: 1, height: 1, format: 'rgba16f', data: new Uint16Array([0, 0, 0, 0]) });
    this.whiteF = new Texture(gl, { width: 1, height: 1, format: 'rgba8', data: new Uint8Array([255, 255, 255, 255]) });
    this.dummyProbes = new Texture(gl, { width: 1, height: 9, format: 'rgba16f', filter: 'nearest' });
    this.resize();
    this._envDirty = true;
    this.glCheck = !!new URLSearchParams(location.search).get('glcheck');
    this._glErrSeen = new Set();
  }

  /** With ?glcheck=1: report the first GL error raised in each stage (slow; for debugging). */
  check(where) {
    if (!this.glCheck) return;
    const e = this.gl.getError();
    if (e && !this._glErrSeen.has(where)) { this._glErrSeen.add(where); console.error(`GL error 0x${e.toString(16)} in ${where}`); }
  }

  // -------------------------------------------------------------------------
  // Sizes

  resize(w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.maxDpr);
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    this.canvas.width = W; this.canvas.height = H;
    this.displayW = W; this.displayH = H;
    const s = this.q.renderScale;
    this.width = Math.max(1, Math.round(W * s));
    this.height = Math.max(1, Math.round(H * s));
    const gl = this.gl;
    if (!this.gbuffer) {
      this.depth = new Texture(gl, { width: this.width, height: this.height, format: 'depth32f', filter: 'nearest' });
      this.gbuffer = new Target(gl, {
        width: this.width, height: this.height,
        colors: [{ format: 'srgba8', filter: 'nearest' }, { format: 'rgba16f', filter: 'nearest' }, { format: 'rgba16f', filter: 'nearest' }, { format: 'rgba16f', filter: 'nearest' }],
        depth: this.depth,
      });
      // Lit scene colour. Two framebuffers share it: one without depth (for
      // passes that sample the depth texture) and one with it (forward passes).
      this.hdr = new Target(gl, { width: this.width, height: this.height, colors: [{ format: 'rgba16f' }] });
      this.hdrDepth = new Target(gl, { width: this.width, height: this.height, colors: [this.hdr.tex], depth: this.depth });
    } else {
      this.gbuffer.resize(this.width, this.height);
      this.hdr.resize(this.width, this.height);
      this.hdrDepth.width = this.width; this.hdrDepth.height = this.height;
      this.hdrDepth.attach();
    }
    for (const p of this.passes) p.resize?.(this);
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return;
    this.qualityName = name;
    this.q = { ...QUALITY[name] };
    this.shadows.resize(this.q.shadowSize);
    this.resize();
  }

  addPass(p, { first = false } = {}) { first ? this.passes.unshift(p) : this.passes.push(p); p.init?.(this); p.resize?.(this); return p; }
  pass(name) { return this.passes.find((p) => p.name === name); }

  // -------------------------------------------------------------------------
  // Programs

  program(kind, defines, key) {
    const k = kind + ':' + key;
    let p = this.programs.get(k);
    if (!p) {
      const fs = kind === 'gbuffer' ? GBUFFER_FS : kind === 'capture' ? CAPTURE_FS : DEPTH_FS;
      p = new Program(this.gl, GEOMETRY_VS, fs, defines, `${kind}[${key}]`);
      this.programs.set(k, p);
    }
    return p;
  }

  // -------------------------------------------------------------------------
  // Camera

  setupCamera(camera) {
    camera.updateMatrixWorld();
    this.cameraPos.setFromMatrixPosition(camera.matrixWorld);
    this.camera = camera;
    this.view.copy(camera.matrixWorldInverse);
    this.proj.copy(camera.projectionMatrix);
    // Sub-pixel jitter (Halton 2,3; 16 phases) for temporal reconstruction.
    const temporal = !!this.pass('taa')?.enabled;
    const i = (this.frame % 16) + 1;
    this.jitter[0] = temporal ? (halton(i, 2) - 0.5) : 0;
    this.jitter[1] = temporal ? (halton(i, 3) - 0.5) : 0;
    this.projJit.copy(this.proj);
    this.projJit.elements[8] += (this.jitter[0] * 2) / this.width;
    this.projJit.elements[9] += (this.jitter[1] * 2) / this.height;
    this.viewProj.multiplyMatrices(this.proj, this.view);
    this.viewProjJit.multiplyMatrices(this.projJit, this.view);
    this.invViewProj.copy(this.viewProjJit).invert();
    this.invProj.copy(this.projJit).invert();
    _frustum.setFromProjectionMatrix(this.viewProj);
    this.frustum = _frustum.clone();
  }

  // -------------------------------------------------------------------------
  // Drawing

  /** Draws geometry items with the given program kind and view-projection. */
  drawItems(items, kind, vp, { frustum = null, shadow = false, extra = null, minRadius = 0 } = {}) {
    const gl = this.gl;
    let cur = null;
    const sorted = items;
    for (const it of sorted) {
      if (shadow && !it.castShadow) continue;
      if (!shadow && it.object.userData.shadowOnly) continue;
      // in coarse shadow cascades, casters smaller than a few texels cannot be seen
      if (minRadius && it.bounds && it.bounds[3] < minRadius) continue;
      if (frustum && it.bounds) {
        _sphere.center.set(it.bounds[0], it.bounds[1], it.bounds[2]);
        _sphere.radius = it.bounds[3];
        if (!frustum.intersectsSphere(_sphere)) { this.stats.culled++; continue; }
      }
      const p = this.program(kind, it.defines, it.key);
      if (p !== cur) {
        cur = p;
        p.use();
        p.set('uViewProj', vp).set('uViewProjFlat', shadow ? vp : this.viewProj).set('uPrevViewProj', shadow ? vp : this.prevViewProj)
          .set('uCameraPos', this.cameraPos).set('uJitter', this.jitter);
        if (extra) p.setAll(extra);
      }
      p.set('uModel', it.model).set('uPrevModel', it.prevModel).set('uNormalMatrix', it.normalMatrix);
      if (it.skin) p.set('uBones', it.skin.cur).set('uPrevBones', it.skin.prev).set('uBindMatrix', it.skin.bind).set('uBindMatrixInverse', it.skin.bindInv);
      if (kind !== 'depth' || it.mat.defines.ALPHA_TEST) p.setAll(it.mat.uni);
      const side = it.mat.side;
      if (side === 2 || shadow) gl.disable(gl.CULL_FACE);
      else { gl.enable(gl.CULL_FACE); gl.cullFace(side === 1 ? gl.FRONT : gl.BACK); }
      gl.bindVertexArray(it.vao);
      const g = it.geo;
      if (it.instances) {
        if (g.index) gl.drawElementsInstanced(gl.TRIANGLES, g.count, g.indexType, g.start * (g.indexType === gl.UNSIGNED_INT ? 4 : 2), it.instances);
        else gl.drawArraysInstanced(gl.TRIANGLES, g.start, g.count, it.instances);
        this.stats.triangles += (g.count / 3) * it.instances;
      } else {
        if (g.index) gl.drawElements(gl.TRIANGLES, g.count, g.indexType, g.start * (g.indexType === gl.UNSIGNED_INT ? 4 : 2));
        else gl.drawArrays(gl.TRIANGLES, g.start, g.count);
        this.stats.triangles += g.count / 3;
      }
      this.stats.drawCalls++;
    }
    gl.bindVertexArray(null);
  }

  /** Programs used to draw custom geometry (terrain, cluster meshes) in each pass. */
  customDraw(kind, vp, frustum, extra) {
    for (const o of this.lists.custom) o.userData.forgeDraw.draw(this, kind, vp, frustum, extra);
  }

  // -------------------------------------------------------------------------
  // Frame

  render(scene, camera, dt = 1 / 60) {
    const gl = this.gl;
    this.time += dt;
    const cpu0 = performance.now();
    this._gpuBegin();
    this.dt = dt;
    this.stats.drawCalls = 0; this.stats.triangles = 0; this.stats.culled = 0;
    const lists = this.adapter.collect(scene);
    this.lists = lists;
    this.stats.items = lists.opaque.length;
    if (lists.sun) {
      this.sunDir.copy(lists.sun.position).sub(lists.sun.target.position).normalize();
    }
    this.setupCamera(camera);
    this.check('before frame');
    for (const p of this.passes) { p.beginFrame?.(this, lists); this.check(`${p.name}.beginFrame`); }

    if (this._envDirty) { this.env.update(this.skyUniforms()); this._envDirty = false; this.check('environment'); }

    // 1. Shadows
    this.shadows.n = this.q.cascades;
    this.shadows.focus = this.q.focusShadows === false ? null : this.shadowFocus;
    this.shadows.fit(camera, this.sunDir);
    this.shadows.render((c, i) => {
      const fr = new Frustum().setFromProjectionMatrix(c.vp);
      this.drawItems(lists.opaque, 'depth', c.vp, { frustum: fr, shadow: true, minRadius: c.texel * 2.5 });
      this.customDraw('depth', c.vp, fr, null);
    });
    this.check('shadows');

    // 2. G-buffer
    this.gbuffer.bind();
    state(gl, { depthTest: true, depthWrite: true });
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 1, 0]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 3, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    this.drawItems(lists.opaque, 'gbuffer', this.viewProjJit, { frustum: this.frustum });
    this.customDraw('gbuffer', this.viewProjJit, this.frustum, null);
    this.check('gbuffer');
    for (const p of this.passes) { p.afterGBuffer?.(this); this.check(`${p.name}.afterGBuffer`); }

    // 3. Screen-space passes that feed lighting (AO, GI, reflections)
    for (const p of this.passes) if (p.enabled !== false) { p.beforeLighting?.(this); this.check(`${p.name}.beforeLighting`); }

    // 4. Deferred lighting
    this.hdr.bind();
    state(gl);
    const L = this.lighting.use();
    this.bindGBuffer(L);
    L.set('uShadowMap', this.shadows.map).set('uShadowMatrix', this.shadows.matrices).set('uShadowSplits', this.shadows.splits.map((s, i) => (i < this.shadows.n ? s : 0)))
      .set('uShadowTexel', this.shadows.texel).set('uShadowSize', this.shadows.size).set('uShadowsOn', 1)
      .set('uShadowFocusOn', this.shadows.focusOn).set('uShadowFocusTexel', this.shadows.focusTexel)
      .set('uContact', this.q.contactShadows === false ? 0 : this.contactShadowLength)
      .set('uEnvSpec', this.reflectionProbe?.tex ?? this.env.spec).set('uEnvLevels', this.env.levels)
      .set('uReflPos', this.reflectionProbe?.pos ?? [0, 0, 0]).set('uReflRadius', this.reflectionProbe?.radius ?? 0).set('uEnvIntensity', this.envIntensity).set('uBrdfLut', this.env.lut)
      .set('uSkySH', this.env.sh).set('uSunIrradiance', [this.sunColor.x * this.sunIntensity, this.sunColor.y * this.sunIntensity, this.sunColor.z * this.sunIntensity])
      .set('uFrame', this.frame).setAll(this.skyUniforms())
      .set('uAO', this.aoTexture ?? this.whiteF).set('uSSGI', this.ssgiTexture ?? this.black).set('uSSR', this.ssrTexture ?? this.black)
      .set('uProbes', this.probeTexture ?? this.dummyProbes).set('uProbeWeight', this.probeTexture ? 1 : 0);
    if (this.probeVolume) L.set('uProbeMin', this.probeVolume.min).set('uProbeMax', this.probeVolume.max).set('uProbeDims', this.probeVolume.dims);
    this.setPointLights(L, lists.points);
    fullscreen(gl);

    // 5. Everything after lighting: forward particles, volumetrics, temporal
    //    reconstruction and the post chain, ending on the canvas.
    let color = this.hdr.tex;
    this.check('lighting');
    for (const p of this.passes) if (p.enabled !== false && p.afterLighting) { color = p.afterLighting(this, color) ?? color; this.check(`${p.name}.afterLighting`); }

    this.prevViewProj.copy(this.viewProj);
    this.adapter.endFrame(lists.opaque);
    for (const p of this.passes) p.endFrame?.(this);
    this._gpuEnd();
    this.timing.cpu += (performance.now() - cpu0 - this.timing.cpu) * 0.1;
    this.frame++;
  }

  // -------------------------------------------------------------------------
  // Real GPU timing (EXT_disjoint_timer_query_webgl2): what the frame costs on
  // this machine's GPU, read back a few frames late without stalling.

  _gpuBegin() {
    const gl = this.gl;
    this.timing ??= { gpu: 0, cpu: 0, gpuAvailable: false, queries: [], ext: gl.getExtension('EXT_disjoint_timer_query_webgl2') };
    const T = this.timing;
    if (!T.ext) return;
    T.gpuAvailable = true;
    // collect finished queries
    while (T.queries.length) {
      const q = T.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      T.queries.shift();
      if (!gl.getParameter(T.ext.GPU_DISJOINT_EXT)) T.gpu += (gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 - T.gpu) * 0.1;
      gl.deleteQuery(q);
    }
    if (T.queries.length > 4) return;
    T.current = gl.createQuery();
    gl.beginQuery(T.ext.TIME_ELAPSED_EXT, T.current);
  }

  _gpuEnd() {
    const T = this.timing;
    if (!T?.ext || !T.current) return;
    this.gl.endQuery(T.ext.TIME_ELAPSED_EXT);
    T.queries.push(T.current);
    T.current = null;
  }

  bindGBuffer(p) {
    const g = this.gbuffer.colors;
    p.set('uG0', g[0]).set('uG1', g[1]).set('uG2', g[2]).set('uG3', g[3]).set('uDepth', this.depth)
      .set('uInvViewProj', this.invViewProj).set('uView', this.view).set('uViewProjFlat', this.viewProj).set('uInvProj', this.invProj).set('uProj', this.projJit)
      .set('uCameraPos', this.cameraPos).set('uResolution', [this.width, this.height]);
    return p;
  }

  /** Uniforms the probe-capture shader needs (sun, shadows, probe volume, sky). */
  captureUniforms() {
    const sh = this.shadows;
    const u = {
      ...this.skyUniforms(), uMainView: this.view,
      uSunIrradiance: [this.sunColor.x * this.sunIntensity, this.sunColor.y * this.sunIntensity, this.sunColor.z * this.sunIntensity],
      uShadowMap: sh.map, uShadowMatrix: sh.matrices, uShadowSplits: sh.splits.map((s, i) => (i < sh.n ? s : 0)), uShadowTexel: sh.texel, uShadowSize: sh.size, uShadowFocusOn: 0, uShadowFocusTexel: 0,
      uSkySH: this.env.sh, uProbes: this.probeTexture ?? this.dummyProbes, uProbeWeight: this.probeTexture ? 1 : 0,
    };
    if (this.probeVolume) Object.assign(u, { uProbeMin: this.probeVolume.min, uProbeMax: this.probeVolume.max, uProbeDims: this.probeVolume.dims });
    return u;
  }

  skyUniforms() {
    return { uSunDir: this.sunDir, uTime: this.time, uSunColor: this.sunColor, uCloudCover: this.cloudCover };
  }

  setPointLights(p, points) {
    const n = Math.min(points.length, 8);
    const pos = new Float32Array(32), col = new Float32Array(32);
    for (let i = 0; i < n; i++) {
      const l = points[i];
      _v.setFromMatrixPosition(l.matrixWorld);
      pos.set([_v.x, _v.y, _v.z, l.distance || 12], i * 4);
      col.set([l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, 0], i * 4);
    }
    p.set('uPointCount', n).set('uPointPos', pos).set('uPointColor', col);
  }

  invalidateEnvironment() { this._envDirty = true; }
}

void Vector4; void _m;
