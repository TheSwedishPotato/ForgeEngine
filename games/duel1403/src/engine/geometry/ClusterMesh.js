import { Object3D, Frustum, Sphere, Vector3 } from 'three';
import { Program, state } from '../gl/GL.js';
import { COMMON, SKY } from '../shaders/common.js';
import { SHADOW_GLSL } from '../passes/Shadows.js';
import { PROBES_GLSL } from '../shaders/lighting.js';
import { STRIDE } from './ClusterDAG.js';
import { VT_SAMPLE_GLSL, VT_FEEDBACK_GLSL } from '../vt/VirtualTexture.js';

const VS = /* glsl */`
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
uniform mat4 uViewProj, uViewProjFlat, uPrevViewProj;
out vec3 vWorld; out vec3 vNormal; out vec4 vCur; out vec4 vPrev;
void main() {
  vWorld = position; vNormal = normal;
  vec4 w = vec4(position, 1.0);
  vCur = uViewProjFlat * w; vPrev = uPrevViewProj * w;
  gl_Position = uViewProj * w;
}`;

const GBUFFER_FS = /* glsl */`
${COMMON}
${VT_SAMPLE_GLSL}
in vec3 vWorld; in vec3 vNormal; in vec4 vCur; in vec4 vPrev;
layout(location = 0) out vec4 g0; layout(location = 1) out vec4 g1; layout(location = 2) out vec4 g2; layout(location = 3) out vec4 g3;
void main() {
  vec4 a, b;
  vtSample(vWorld, a, b);
  vec3 Ng = normalize(vNormal);
  vec2 d = b.xy * 2.0 - 1.0;
  // detail normal is relative to level ground: tilt the geometric normal by it
  vec3 N = normalize(Ng + vec3(d.x, 0.0, d.y) * 1.0 / max(0.25, sqrt(saturate(1.0 - dot(d, d)))));
  float rough = a.a;
  vec3 dndu = dFdx(N), dndv = dFdy(N);
  float variance = 0.25 * (dot(dndu, dndu) + dot(dndv, dndv));
  rough = clamp(sqrt(sqrt(min(pow(rough, 4.0) + min(2.0 * variance, 0.18), 1.0))), 0.03, 1.0);
  vec2 motion = (vCur.xy / vCur.w - vPrev.xy / vPrev.w) * 0.5;
  g0 = vec4(a.rgb, b.a);
  g1 = vec4(encodeNormal(N), rough, 0.0);
  g2 = vec4(motion, 0.0, 0.0);
  g3 = vec4(0.0, 0.0, 0.0, 1.0);
}`;

const FEEDBACK_FS = /* glsl */`
${COMMON}
${VT_SAMPLE_GLSL}
${VT_FEEDBACK_GLSL}
in vec3 vWorld; in vec3 vNormal; in vec4 vCur; in vec4 vPrev;
uniform float uFeedbackBias;
out vec4 o;
void main() { o = vtFeedback(vWorld, uFeedbackBias); }`;

const CAPTURE_FS = /* glsl */`
${COMMON}
${SKY}
${SHADOW_GLSL}
${PROBES_GLSL}
${VT_SAMPLE_GLSL}
in vec3 vWorld; in vec3 vNormal; in vec4 vCur; in vec4 vPrev;
uniform vec3 uSunIrradiance;
uniform mat4 uMainView;
out vec4 o;
void main() {
  vec4 a, b;
  vec2 uv = vtUv(vWorld);
  vtFetch(uv, 6, a, b);
  vec3 N = normalize(vNormal);
  float viewDepth = -(uMainView * vec4(vWorld, 1.0)).z;
  float vis = sunShadowFast(vWorld + N * 0.05, viewDepth);
  o = vec4(a.rgb * INV_PI * (uSunIrradiance * saturate(dot(N, uSunDir)) * vis + irradianceAt(vWorld, N)), 1.0);
}`;

const DEPTH_FS = /* glsl */`in vec3 vWorld; in vec3 vNormal; in vec4 vCur; in vec4 vPrev; out vec4 o; void main(){ o = vec4(1.0); }`;

const _f = new Frustum(), _s = new Sphere(), _v = new Vector3();

/**
 * Renders a cluster hierarchy built by ClusterDAG: per frame it picks the
 * cut of the hierarchy whose error is just under a pixel, culls clusters
 * by frustum and normal cone, and submits all of them with one
 * multi-draw call (WEBGL_multi_draw) — millions of source triangles,
 * only the ones that matter drawn.
 */
export class ClusterMesh extends Object3D {
  constructor(r, data, { vt, castShadow = true, name = 'clusters' } = {}) {
    super();
    this.name = name;
    this.userData.forgeDraw = this;
    this.frustumCulled = false;
    this.vt = vt;
    this.castShadow = castShadow;
    const gl = r.gl;
    this.gl = gl;
    this.C = data.clusters;
    this.count = data.count;
    this.levels = data.levels;
    this.sourceTris = data.sourceTris;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.counts = new Int32Array(this.count);
    this.offsets = new Int32Array(this.count);
    this.sel = new Int32Array(this.count);   // the current LOD cut (cluster ids)
    this.nSel = 0;
    this.selFrame = -1;
    this.stats = { clusters: 0, triangles: 0, culled: 0 };
    if (!r._clusterPrograms) {
      r._clusterPrograms = {
        gbuffer: new Program(gl, VS, GBUFFER_FS, {}, 'cluster-gbuffer'),
        feedback: new Program(gl, VS, FEEDBACK_FS, {}, 'cluster-feedback'),
        capture: new Program(gl, VS, CAPTURE_FS, {}, 'cluster-capture'),
        depth: new Program(gl, VS, DEPTH_FS, {}, 'cluster-depth'),
      };
    }
    this.programs = r._clusterPrograms;
  }

  /** The LOD cut for a viewpoint: clusters whose own error is under tau px and whose parent's is not. */
  select(eye, scale, tau) {
    const C = this.C;
    let n = 0;
    const ex = eye.x, ey = eye.y, ez = eye.z;
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      const se = C[o + 2];
      let d = Math.hypot(C[o + 3] - ex, C[o + 4] - ey, C[o + 5] - ez) - C[o + 6];
      if (se * scale > tau * Math.max(d, 0.05)) continue;          // own error visible: too coarse
      const pe = C[o + 7];
      if (pe < 3e38) {
        d = Math.hypot(C[o + 8] - ex, C[o + 9] - ey, C[o + 10] - ez) - C[o + 11];
        if (pe * scale <= tau * Math.max(d, 0.05)) continue;      // parent is fine too: draw the parent instead
      }
      this.sel[n++] = i;
    }
    this.nSel = n;
  }

  _cut(r) {
    if (this.selFrame === r.frame) return;
    this.selFrame = r.frame;
    const scale = r.height * r.proj.elements[5] * 0.5;   // pixels per metre at distance 1
    const tau = { ultra: 0.8, high: 1.2, medium: 2, low: 3.5 }[r.qualityName] ?? 1.2;
    this.select(r.cameraPos, scale, tau);
  }

  /** Builds the multi-draw lists for this cut with frustum (and optionally cone) culling. */
  _lists(frustum, eye) {
    const C = this.C;
    let m = 0, tris = 0, culled = 0;
    for (let k = 0; k < this.nSel; k++) {
      const i = this.sel[k], o = i * STRIDE;
      _s.center.set(C[o + 12], C[o + 13], C[o + 14]); _s.radius = C[o + 15];
      if (frustum && !frustum.intersectsSphere(_s)) { culled++; continue; }
      if (eye && C[o + 19] < 1.5) {
        // normal-cone backface culling: every triangle faces away from the eye
        _v.set(C[o + 12] - eye.x, C[o + 13] - eye.y, C[o + 14] - eye.z);
        const dist = _v.length();
        if (dist > C[o + 15]) {
          const cosT = (_v.x * C[o + 16] + _v.y * C[o + 17] + _v.z * C[o + 18]) / dist;
          const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
          const alpha = Math.asin(Math.min(1, C[o + 15] / dist));
          if (theta + alpha + C[o + 19] < Math.PI / 2) { culled++; continue; }
        }
      }
      this.counts[m] = C[o + 1];
      this.offsets[m] = C[o] * 4;
      tris += C[o + 1] / 3;
      m++;
    }
    return { m, tris, culled };
  }

  _submit(m) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (gl.ext.multiDraw) gl.ext.multiDraw.multiDrawElementsWEBGL(gl.TRIANGLES, this.counts, 0, gl.UNSIGNED_INT, this.offsets, 0, m);
    else for (let i = 0; i < m; i++) gl.drawElements(gl.TRIANGLES, this.counts[i], gl.UNSIGNED_INT, this.offsets[i]);
    gl.bindVertexArray(null);
  }

  /** Called by the renderer for each pass that rasterises geometry. */
  draw(r, kind, vp, frustum, extra) {
    if (!this.visible) return;
    if (kind === 'depth' && !this.castShadow) return;
    this._cut(r);
    const gl = r.gl;
    const p = this.programs[kind];
    if (!p) return;
    p.use().set('uViewProj', vp).set('uViewProjFlat', kind === 'gbuffer' ? r.viewProj : vp).set('uPrevViewProj', kind === 'gbuffer' ? r.prevViewProj : vp);
    if (kind !== 'depth') p.setAll(this.vt.uniforms);
    if (kind === 'feedback') p.set('uFeedbackBias', -Math.log2(8));   // the feedback buffer is 1/8 resolution
    if (extra) p.setAll(extra);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    if (kind === 'depth') gl.disable(gl.CULL_FACE);
    const eye = kind === 'gbuffer' || kind === 'feedback' ? r.cameraPos : null;
    const { m, tris, culled } = this._lists(frustum, eye);
    this._submit(m);
    if (kind === 'gbuffer') { this.stats.clusters = m; this.stats.triangles = tris; this.stats.culled = culled; }
    r.stats.drawCalls++;
    r.stats.triangles += tris;
  }
}
void _f; void state;
