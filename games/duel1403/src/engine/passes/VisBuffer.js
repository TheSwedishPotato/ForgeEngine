import { Program, Texture, Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';
import { STATIC_GLSL } from '../scene/StaticScene.js';

/**
 * A GPU-driven visibility buffer for the static world, on WebGL2.
 *
 * 1. Hi-Z: after each frame the depth buffer is reduced to a pyramid of
 *    the farthest depth in each 2^n block.
 * 2. Cluster culling on the GPU: one fragment per 64-triangle cluster tests
 *    its bounding sphere against the view frustum and against last frame's
 *    Hi-Z pyramid (seen from last frame's camera), writing visible or not
 *    to a small texture. No compute shaders: a fragment shader over a
 *    texture is the compute pass, and the texture is the output buffer.
 * 3. One draw call for the whole static world: the vertex shader fetches
 *    each vertex from the baked scene by gl_VertexID and collapses every
 *    triangle of a culled cluster to a point, so culled geometry costs one
 *    texture read and never rasterises. Mesh shaders do the same per
 *    cluster; WebGL2 has none, so the vertex shader does it. The
 *    fragment shader writes only the triangle's id (and depth).
 * 4. Resolve: a full-screen pass reads the id, fetches the triangle,
 *    intersects the pixel's camera ray with it for perspective-correct
 *    barycentrics (and the neighbouring pixels' rays for texture
 *    derivatives), and writes the G-buffer: material, map, normal, motion.
 *
 * Moving things (people, weapons, animals) still go through the ordinary
 * G-buffer pass and depth-test against the static world.
 */

const CULL_FS = /* glsl */`
${STATIC_GLSL}
out vec4 o;
uniform vec4 uPlanes[6];
uniform mat4 uPrevViewProj;
uniform highp sampler2D uHiZ;
uniform float uHiZLevels, uOcclusion;
uniform vec2 uHiZSize;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int c = p.y * uSCluW + p.x;
  if (c >= uSClusterCount) { o = vec4(0.0); return; }
  vec4 s = sCluster0(c);
  if (s.w < 0.0) { o = vec4(0.0); return; }
  for (int i = 0; i < 6; i++) if (dot(uPlanes[i].xyz, s.xyz) + uPlanes[i].w < -s.w) { o = vec4(0.0); return; }
  float vis = 1.0;
  if (uOcclusion > 0.5) {
    // the sphere's screen rectangle and nearest depth in last frame's view
    vec4 c0 = uPrevViewProj * vec4(s.xyz, 1.0);
    if (c0.w > s.w + 0.1) {
      float rNdc = s.w / (c0.w - s.w);
      vec2 ctr = c0.xy / c0.w;
      vec2 lo = ctr - vec2(rNdc * uPrevViewProj[0][0], rNdc * uPrevViewProj[1][1]) * 1.05;
      vec2 hi = ctr + vec2(rNdc * uPrevViewProj[0][0], rNdc * uPrevViewProj[1][1]) * 1.05;
      if (all(greaterThan(lo, vec2(-1.0))) && all(lessThan(hi, vec2(1.0)))) {
        vec2 uvLo = lo * 0.5 + 0.5, uvHi = hi * 0.5 + 0.5;
        vec2 sz = (uvHi - uvLo) * uHiZSize;
        float lev = clamp(ceil(log2(max(max(sz.x, sz.y), 1.0))), 0.0, uHiZLevels - 1.0);
        float far = 0.0;
        far = max(far, textureLod(uHiZ, vec2(uvLo.x, uvLo.y), lev).r);
        far = max(far, textureLod(uHiZ, vec2(uvHi.x, uvLo.y), lev).r);
        far = max(far, textureLod(uHiZ, vec2(uvLo.x, uvHi.y), lev).r);
        far = max(far, textureLod(uHiZ, vec2(uvHi.x, uvHi.y), lev).r);
        vec4 cn = uPrevViewProj * vec4(s.xyz, 1.0);
        // nearest point of the sphere, as window depth
        float zNear = (cn.z - s.w * 1.2) / max(cn.w - s.w, 0.05) * 0.5 + 0.5;
        if (zNear > far + 1e-4) vis = 0.0;
      }
    }
  }
  o = vec4(vis);
}`;

const RASTER_VS = /* glsl */`
${STATIC_GLSL}
uniform highp sampler2D uVis;
uniform mat4 uViewProj;
uniform float uAll;
flat out uint vId;
void main() {
  int v = gl_VertexID, tri = v / 3, c = tri / S_CLUSTER;
  float vis = uAll > 0.5 ? 1.0 : texelFetch(uVis, ivec2(c % uSCluW, c / uSCluW), 0).r;
  if (vis < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vId = 0u; return; }
  vec4 p = sPos(v);
  gl_Position = uViewProj * vec4(p.xyz, 1.0);
  vId = uint(tri + 1);
}`;
const RASTER_FS = /* glsl */`
flat in uint vId;
out uint o;
void main() { o = vId; }`;

const RESOLVE_FS = /* glsl */`
${COMMON}
${STATIC_GLSL}
in vec2 vUv;
uniform highp usampler2D uVisBuf;
uniform mat4 uInvViewProj, uViewProjFlat, uPrevViewProj;
uniform vec2 uResolution;
layout(location = 0) out vec4 g0;
layout(location = 1) out vec4 g1;
layout(location = 2) out vec4 g2;
layout(location = 3) out vec4 g3;
vec3 rayAt(vec2 frag, out vec3 orig) {
  vec2 ndc = frag / uResolution * 2.0 - 1.0;
  vec4 a = uInvViewProj * vec4(ndc, -1.0, 1.0), b = uInvViewProj * vec4(ndc, 1.0, 1.0);
  orig = a.xyz / a.w;
  return normalize(b.xyz / b.w - orig);
}
// barycentrics of the ray's hit on the triangle's plane
vec3 bary(vec3 o, vec3 d, vec3 p0, vec3 p1, vec3 p2) {
  vec3 e1 = p1 - p0, e2 = p2 - p0, pv = cross(d, e2);
  float det = dot(e1, pv);
  if (abs(det) < 1e-12) return vec3(1.0, 0.0, 0.0);
  float inv = 1.0 / det;
  vec3 tv = o - p0, qv = cross(tv, e1);
  float u = dot(tv, pv) * inv, v = dot(d, qv) * inv;
  return vec3(1.0 - u - v, u, v);
}
void main() {
  uint id = texelFetch(uVisBuf, ivec2(gl_FragCoord.xy), 0).r;
  if (id == 0u) discard;
  int tri = int(id) - 1;
  vec4 a0 = sPos(tri * 3), a1 = sPos(tri * 3 + 1), a2 = sPos(tri * 3 + 2);
  vec4 n0 = sNrm(tri * 3), n1 = sNrm(tri * 3 + 1), n2 = sNrm(tri * 3 + 2);
  vec3 o, ox, oy;
  vec3 d = rayAt(gl_FragCoord.xy, o), dx = rayAt(gl_FragCoord.xy + vec2(1.0, 0.0), ox), dy = rayAt(gl_FragCoord.xy + vec2(0.0, 1.0), oy);
  vec3 b = bary(o, d, a0.xyz, a1.xyz, a2.xyz), bx = bary(ox, dx, a0.xyz, a1.xyz, a2.xyz), by = bary(oy, dy, a0.xyz, a1.xyz, a2.xyz);
  vec3 W = a0.xyz * b.x + a1.xyz * b.y + a2.xyz * b.z;
  vec2 t0 = vec2(a0.w, n0.w), t1 = vec2(a1.w, n1.w), t2 = vec2(a2.w, n2.w);
  vec2 uv = t0 * b.x + t1 * b.y + t2 * b.z;
  vec2 uvx = t0 * bx.x + t1 * bx.y + t2 * bx.z - uv, uvy = t0 * by.x + t1 * by.y + t2 * by.z - uv;
  vec3 N = normalize(n0.xyz * b.x + n1.xyz * b.y + n2.xyz * b.z + vec3(0.0, 1e-9, 0.0));
  vec3 Ng = normalize(cross(a1.xyz - a0.xyz, a2.xyz - a0.xyz) + vec3(0.0, 1e-12, 0.0));
  if (dot(Ng, d) > 0.0) Ng = -Ng;
  if (dot(N, Ng) < 0.0) N = -N;       // two-sided: face the viewer
  vec4 ma, mb;
  sMaterial(sMatOfTri(tri), ma, mb);
  vec3 base = ma.rgb;
  if (ma.w >= 0.0) base *= textureGrad(uSMaps, vec3(uv, ma.w), uvx, uvy).rgb;
  vec4 cur = uViewProjFlat * vec4(W, 1.0), prev = uPrevViewProj * vec4(W, 1.0);
  vec2 motion = (cur.xy / cur.w - prev.xy / prev.w) * 0.5;
  g0 = vec4(saturate(base), 1.0);
  g1 = vec4(encodeNormal(N), clamp(mb.x, 0.03, 1.0), mb.y);
  g2 = vec4(motion, mb.z, mb.w);
  g3 = vec4(0.0, 0.0, 0.0, 1.0);
}`;

const HIZ_FIRST_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform highp sampler2D uSrc;
uniform vec2 uSrcSize;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  ivec2 m = ivec2(uSrcSize) - 1;
  float d = max(max(texelFetch(uSrc, min(p, m), 0).r, texelFetch(uSrc, min(p + ivec2(1, 0), m), 0).r),
                max(texelFetch(uSrc, min(p + ivec2(0, 1), m), 0).r, texelFetch(uSrc, min(p + ivec2(1, 1), m), 0).r));
  o = vec4(d);
}`;
const HIZ_DOWN_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform highp sampler2D uSrc;
uniform int uLevel;
uniform ivec2 uSrcSize;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2, m = uSrcSize - 1;
  float d = 0.0;
  // three by three where the source is odd, so nothing is missed
  for (int y = 0; y < 3; y++) for (int x = 0; x < 3; x++) {
    if ((x == 2 && (uSrcSize.x & 1) == 0) || (y == 2 && (uSrcSize.y & 1) == 0)) continue;
    d = max(d, texelFetch(uSrc, min(p + ivec2(x, y), m), uLevel).r);
  }
  o = vec4(d);
}`;

export class VisBuffer {
  constructor() { this.name = 'visbuffer'; this.scene = null; this.enabled = true; this.occlusion = true; this.stats = { clusters: 0, visible: 0 }; }

  init(r) {
    const gl = r.gl;
    this.gl = gl;
    this.pCull = postProgram(gl, CULL_FS, {}, 'vis-cull');
    this.pRaster = new Program(gl, RASTER_VS, RASTER_FS, {}, 'vis-raster');
    this.pResolve = postProgram(gl, RESOLVE_FS, {}, 'vis-resolve');
    this.pHiZ0 = postProgram(gl, HIZ_FIRST_FS, {}, 'hiz-first');
    this.pHiZ = postProgram(gl, HIZ_DOWN_FS, {}, 'hiz-down');
    this.emptyVao = gl.createVertexArray();
    this.fbo = gl.createFramebuffer();
    r.visBuffer = this;
  }

  /** Give it the static world (a StaticScene). */
  setScene(scene) {
    this.scene = scene;
    const rows = Math.ceil(scene.clusterCount / scene.cluW);
    this.cull?.dispose?.();
    this.cull = new Target(this.gl, { width: scene.cluW, height: rows, colors: [{ format: 'r8', filter: 'nearest' }] });
    this.stats.clusters = scene.clusterCount;
    this.hizValid = false;
  }

  resize(r) {
    const gl = r.gl;
    this.ids?.dispose?.();
    this.ids = new Texture(gl, { width: r.width, height: r.height, format: 'r32ui', filter: 'nearest' });
    const w = Math.max(1, r.width >> 1), h = Math.max(1, r.height >> 1);
    this.hizLevels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    this.hiz?.dispose?.();
    this.hiz = new Texture(gl, { width: w, height: h, format: 'r32f', filter: 'nearest', levels: this.hizLevels, minFilter: gl.NEAREST_MIPMAP_NEAREST });
    this.hizFbo ??= gl.createFramebuffer();
    this.hizValid = false;
  }

  active(r) { return !!(this.enabled && this.scene && r.q.visBuffer !== false); }

  /** Called by the renderer right after the G-buffer is cleared. */
  gbufferStatic(r) {
    if (!this.active(r)) return false;
    const gl = r.gl, S = this.scene;
    // 1. cull clusters on the GPU
    this.cull.bind();
    state(gl);
    const planes = [];
    for (const p of r.frustum.planes) planes.push(p.normal.x, p.normal.y, p.normal.z, p.constant);
    this.lastPlanes = planes; this.lastOcc = this.occlusion && this.hizValid && !r.cameraCut;
    S.bind(this.pCull.use()).set('uPlanes', planes).set('uPrevViewProj', r.prevViewProj).set('uHiZ', this.hiz)
      .set('uHiZLevels', this.hizLevels).set('uHiZSize', [this.hiz.width, this.hiz.height]).set('uOcclusion', this.occlusion && this.hizValid && !r.cameraCut ? 1 : 0);
    fullscreen(gl);
    // 2. ids and depth, one draw for everything
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ids.tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, r.depth.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, r.width, r.height);
    state(gl, { depthTest: true, depthWrite: true, cull: false });
    gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0]);
    S.bind(this.pRaster.use()).set('uVis', this.cull.tex).set('uViewProj', r.viewProjJit).set('uAll', 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, S.triCount * 3);
    gl.bindVertexArray(null);
    r.stats.drawCalls++;
    // 3. resolve into the G-buffer (colour only; the depth is already there)
    r.gbuffer.bind();
    state(gl, { depthTest: false, depthWrite: false });
    const p = this.pResolve.use();
    S.bind(p).set('uVisBuf', this.ids).set('uInvViewProj', r.invViewProj).set('uViewProjFlat', r.viewProj).set('uPrevViewProj', r.prevViewProj).set('uResolution', [r.width, r.height]);
    fullscreen(gl);
    // restore the G-buffer's depth test for the moving things
    state(gl, { depthTest: true, depthWrite: true });
    return true;
  }

  /** Static geometry drawn with the cluster path into a shadow or capture view (every cluster). */
  drawAll(r, vp) {
    if (!this.scene) return;
    const gl = r.gl;
    S_bindRaster(this, vp);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.scene.triCount * 3);
    gl.bindVertexArray(null);
  }

  /** After the frame's G-buffer: build the Hi-Z pyramid for next frame's culling. */
  afterGBuffer(r) {
    if (!this.active(r)) return;
    const gl = r.gl;
    state(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hizFbo);
    let w = this.hiz.width, h = this.hiz.height;
    for (let l = 0; l < this.hizLevels; l++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hiz.tex, l);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, w, h);
      if (l === 0) this.pHiZ0.use().set('uSrc', r.depth).set('uSrcSize', [r.width, r.height]);
      else {
        // read level l-1 while writing level l: limit the source to that level
        gl.bindTexture(gl.TEXTURE_2D, this.hiz.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, l - 1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, l - 1);
        // (texelFetch's level counts from the base level)
        this.pHiZ.use().set('uSrc', this.hiz).set('uLevel', 0).set('uSrcSize', [Math.max(1, this.hiz.width >> (l - 1)), Math.max(1, this.hiz.height >> (l - 1))]);
      }
      fullscreen(gl);
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.hiz.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, this.hizLevels - 1);
    this.hizValid = true;
  }
}

function S_bindRaster(vb, vp) {
  vb.scene.bind(vb.pRaster.use()).set('uVis', vb.cull.tex).set('uViewProj', vp).set('uAll', 1);
}
