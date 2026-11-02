import { Object3D, Vector3, Color } from 'three';
import { Program, Texture, Target, postProgram, fullscreen, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/**
 * Cloth simulated on the GPU, on WebGL2: capes and cloaks.
 *
 * A cape is a grid of particles whose positions live in a float texture
 * (one texel a particle), with last frame's in another. Each frame, in
 * fragment shaders over those textures (WebGL2's compute):
 *   1. Verlet integration: gravity, a little air drag, and the wind
 *      pushing on the cloth along its normal;
 *   2. several Jacobi passes over distance constraints to the neighbours
 *      along the grid (stretch), across it (shear) and two along (bend);
 *   3. collision with the wearer's body capsules and the ground;
 *   4. the top row pinned to the shoulders.
 * The cape is drawn straight from the texture: the vertex shader fetches
 * each particle and builds its normal from its neighbours. It casts
 * shadows and has motion vectors like everything else.
 */

const W = 14, H = 20;      // particles across, down

const STEP_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform highp sampler2D uPos, uPrev;
uniform vec3 uGravity, uWind;
uniform float uDt, uDrag;
uniform vec4 uAnchor[${W}];
uniform vec4 uCapA[16], uCapB[16];
uniform int uCapN;
uniform float uGround;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 x = texelFetch(uPos, p, 0).xyz, xp = texelFetch(uPrev, p, 0).xyz;
  if (p.y == 0) { o = vec4(uAnchor[p.x].xyz, 1.0); return; }
  // the cloth's normal here, for the wind's push
  vec3 r = texelFetch(uPos, ivec2(min(p.x + 1, ${W - 1}), p.y), 0).xyz - texelFetch(uPos, ivec2(max(p.x - 1, 0), p.y), 0).xyz;
  vec3 d = texelFetch(uPos, ivec2(p.x, min(p.y + 1, ${H - 1})), 0).xyz - texelFetch(uPos, ivec2(p.x, max(p.y - 1, 0)), 0).xyz;
  vec3 n = normalize(cross(r, d) + 1e-6);
  vec3 v = (x - xp) / max(uDt, 1e-4);
  vec3 rel = uWind - v;
  vec3 a = uGravity + n * dot(rel, n) * abs(dot(rel, n)) * 0.6 + rel * 0.15;
  vec3 nx = x + (x - xp) * (1.0 - uDrag) + a * uDt * uDt;
  // never let a bad step spread: hang the particle straight down from its anchor
  if (any(isnan(nx)) || any(isinf(nx)) || distance(nx, uAnchor[p.x].xyz) > 4.0) nx = uAnchor[p.x].xyz - vec3(0.0, float(p.y) * 0.06, 0.0);
  o = vec4(nx, 1.0);
}`;

const RELAX_FS = /* glsl */`
in vec2 vUv; out vec4 o;
uniform highp sampler2D uPos;
uniform vec2 uRest;           // spacing across, down
uniform vec4 uCapA[16], uCapB[16];
uniform int uCapN;
uniform float uGround;
vec3 pull(vec3 x, ivec2 q, float rest, float k) {
  if (q.x < 0 || q.y < 0 || q.x >= ${W} || q.y >= ${H}) return vec3(0.0);
  vec3 y = texelFetch(uPos, q, 0).xyz;
  vec3 d = y - x;
  float l = length(d);
  if (l < 1e-6) return vec3(0.0);
  // the top row is pinned: it does not give, so pull the whole correction
  float share = q.y == 0 ? 1.0 : 0.5;
  return d * (1.0 - rest / l) * share * k;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 x = texelFetch(uPos, p, 0).xyz;
  if (p.y == 0) { o = vec4(x, 1.0); return; }
  float sx = uRest.x, sy = uRest.y, dg = length(uRest);
  vec3 c = vec3(0.0);
  c += pull(x, p + ivec2(1, 0), sx, 1.0) + pull(x, p - ivec2(1, 0), sx, 1.0);
  c += pull(x, p + ivec2(0, 1), sy, 1.0) + pull(x, p - ivec2(0, 1), sy, 1.0);
  c += pull(x, p + ivec2(1, 1), dg, 0.5) + pull(x, p + ivec2(-1, 1), dg, 0.5) + pull(x, p + ivec2(1, -1), dg, 0.5) + pull(x, p + ivec2(-1, -1), dg, 0.5);
  c += pull(x, p + ivec2(2, 0), sx * 2.0, 0.2) + pull(x, p - ivec2(2, 0), sx * 2.0, 0.2) + pull(x, p + ivec2(0, 2), sy * 2.0, 0.25) + pull(x, p - ivec2(0, 2), sy * 2.0, 0.25);
  x += c * 0.5;
  // out of the body and above the ground
  for (int i = 0; i < 16; i++) {
    if (i >= uCapN) break;
    vec3 A = uCapA[i].xyz, B = uCapB[i].xyz; float rad = uCapA[i].w + 0.025;
    vec3 ab = B - A;
    float t = clamp(dot(x - A, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec3 q = A + ab * t, dq = x - q;
    float l = length(dq);
    if (l < rad && l > 1e-5) x = q + dq / l * rad;
  }
  x.y = max(x.y, uGround + 0.01);
  o = vec4(x, 1.0);
}`;

const VS = /* glsl */`
uniform highp sampler2D uPos, uPrevPos;
uniform mat4 uViewProj, uViewProjFlat, uPrevViewProj;
out vec3 vWorld; out vec3 vNormal; out vec2 vUv; out vec4 vCur; out vec4 vPrev;
vec3 at(sampler2D t, ivec2 q) { return texelFetch(t, clamp(q, ivec2(0), ivec2(${W - 1}, ${H - 1})), 0).xyz; }
void main() {
  ivec2 q = ivec2(gl_VertexID % ${W}, gl_VertexID / ${W});
  vec3 x = at(uPos, q);
  vec3 r = at(uPos, q + ivec2(1, 0)) - at(uPos, q - ivec2(1, 0)), d = at(uPos, q + ivec2(0, 1)) - at(uPos, q - ivec2(0, 1));
  vNormal = normalize(cross(d, r) + 1e-6);
  vWorld = x;
  vUv = vec2(q) / vec2(${W - 1}, ${H - 1});
  vCur = uViewProjFlat * vec4(x, 1.0);
  vPrev = uPrevViewProj * vec4(at(uPrevPos, q), 1.0);
  gl_Position = uViewProj * vec4(x, 1.0);
}`;
const GBUFFER_FS = /* glsl */`
${COMMON}
in vec3 vWorld; in vec3 vNormal; in vec2 vUv; in vec4 vCur; in vec4 vPrev;
uniform vec3 uColor, uTrim;
layout(location = 0) out vec4 g0; layout(location = 1) out vec4 g1; layout(location = 2) out vec4 g2; layout(location = 3) out vec4 g3;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  // wool: a faint twill and a woven border at the hem
  float tw = 0.94 + 0.06 * sin((vUv.x * 140.0 + vUv.y * 180.0));
  vec3 base = (vUv.y > 0.95 || vUv.x < 0.03 || vUv.x > 0.97 ? uTrim : uColor) * tw;
  vec2 motion = (vCur.xy / vCur.w - vPrev.xy / vPrev.w) * 0.5;
  g0 = vec4(saturate(base), 0.5);
  g1 = vec4(encodeNormal(N), 0.92, 0.0);
  g2 = vec4(motion, 3.0, 0.6);        // cloth sheen
  g3 = vec4(0.0, 0.0, 0.0, 1.0);
}`;
const DEPTH_FS = 'in vec3 vWorld; in vec3 vNormal; in vec2 vUv; in vec4 vCur; in vec4 vPrev; out vec4 o; void main() { o = vec4(1.0); }';

/** One cape. Add it to the scene; call setBody() each frame with the wearer. */
export class GPUCloth extends Object3D {
  constructor(r, { color = '#7a1018', trim = '#d8c060', width = 0.62, length = 1.15 } = {}) {
    super();
    this.userData.forgeDraw = this;
    this.frustumCulled = false;
    this.castShadow = true;
    this.r = r;
    this.color = new Color(color); this.trim = new Color(trim);
    this.width = width; this.length = length;
    const gl = r.gl;
    const mk = () => new Target(gl, { width: W, height: H, colors: [{ format: 'rgba32f', filter: 'nearest' }] });
    this.pos = mk(); this.prev = mk(); this.tmp = mk(); this.last = mk();
    this.anchors = new Float32Array(W * 4);
    this.caps = { a: new Float32Array(64), b: new Float32Array(64), n: 0 };
    this.ground = 0;
    this.started = false;
    // the index buffer of the grid
    const idx = [];
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i; idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.indexCount = idx.length;
    if (!r._clothPrograms) {
      r._clothPrograms = {
        step: postProgram(gl, STEP_FS, {}, 'cloth-step'),
        relax: postProgram(gl, RELAX_FS, {}, 'cloth-relax'),
        gbuffer: new Program(gl, VS, GBUFFER_FS, {}, 'cloth-gbuffer'),
        depth: new Program(gl, VS, DEPTH_FS, {}, 'cloth-depth'),
      };
    }
    this.P = r._clothPrograms;
    (r.cloths ??= new Set()).add(this);
  }

  /**
   * The wearer this frame: shoulder line (left and right points, in world
   * space), the direction of the back, the body's capsules, the ground height.
   */
  setBody({ left, right, back, capsules = [], ground = 0 }) {
    for (let i = 0; i < W; i++) {
      const t = i / (W - 1);
      // a gentle curve round the back of the neck
      const bow = 0.06 * (1 - (2 * t - 1) ** 2);
      this.anchors[i * 4] = left.x + (right.x - left.x) * t + back.x * bow;
      this.anchors[i * 4 + 1] = left.y + (right.y - left.y) * t + 0.02 * (1 - (2 * t - 1) ** 2);
      this.anchors[i * 4 + 2] = left.z + (right.z - left.z) * t + back.z * bow;
    }
    const n = Math.min(16, capsules.length);
    for (let i = 0; i < n; i++) { const c = capsules[i]; this.caps.a.set([c.a.x, c.a.y, c.a.z, c.r], i * 4); this.caps.b.set([c.b.x, c.b.y, c.b.z, 0], i * 4); }
    this.caps.n = n;
    this.ground = ground;
    this.back = back;
    this.hasBody = true;
  }

  /** Lay the cape out hanging behind the shoulders (first frame, or after a jump). */
  _reset() {
    const data = new Float32Array(W * H * 4);
    const dy = this.length / (H - 1);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      data[o] = this.anchors[i * 4] + (this.back?.x ?? 0) * 0.05 * j / H;
      data[o + 1] = this.anchors[i * 4 + 1] - j * dy;
      data[o + 2] = this.anchors[i * 4 + 2] + (this.back?.z ?? 0) * 0.05 * j / H;
      data[o + 3] = 1;
    }
    for (const t of [this.pos, this.prev, this.last]) t.tex.upload(data);
    this.started = true;
  }

  step(dt, wind) {
    if (!this.hasBody || !this.visible) return;
    const r = this.r, gl = r.gl, P = this.P;
    // a jump (teleport) of the wearer: start the cape again
    const ax = this.anchors[(W >> 1) * 4], ay = this.anchors[(W >> 1) * 4 + 1], az = this.anchors[(W >> 1) * 4 + 2];
    if (!this.started || (this._lastA && Math.hypot(ax - this._lastA[0], ay - this._lastA[1], az - this._lastA[2]) > 0.5)) this._reset();
    this._lastA = [ax, ay, az];
    state(gl);
    const sub = 2, h = Math.min(dt, 1 / 30) / sub;
    // keep this frame's starting positions for motion vectors
    this._copy(this.pos, this.last);
    for (let s = 0; s < sub; s++) {
      this.tmp.bind();
      P.step.use().set('uPos', this.pos.tex).set('uPrev', this.prev.tex).set('uGravity', [0, -9.81, 0]).set('uWind', [wind.x, wind.y, wind.z])
        .set('uDt', h).set('uDrag', 0.012).set('uAnchor', this.anchors);
      fullscreen(gl);
      // rotate: prev <- pos, pos <- tmp
      let t = this.prev; this.prev = this.pos; this.pos = this.tmp; this.tmp = t;
      for (let k = 0; k < 6; k++) {
        this.tmp.bind();
        P.relax.use().set('uPos', this.pos.tex).set('uRest', [this.width / (W - 1), this.length / (H - 1)])
          .set('uCapA', this.caps.a).set('uCapB', this.caps.b).set('uCapN', this.caps.n).set('uGround', this.ground);
        fullscreen(gl);
        t = this.pos; this.pos = this.tmp; this.tmp = t;
      }
    }
  }

  _copy(src, dst) {
    const gl = this.r.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  draw(r, kind, vp) {
    if (!this.visible || !this.started) return;
    const p = this.P[kind];
    if (!p) return;
    const gl = r.gl;
    p.use().set('uPos', this.pos.tex).set('uPrevPos', this.last.tex).set('uViewProj', vp)
      .set('uViewProjFlat', kind === 'gbuffer' ? r.viewProj : vp).set('uPrevViewProj', kind === 'gbuffer' ? r.prevViewProj : vp);
    if (kind === 'gbuffer') p.set('uColor', this.color).set('uTrim', this.trim);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    r.stats.drawCalls++;
  }

  dispose() {
    this.r.cloths?.delete(this);
    for (const t of [this.pos, this.prev, this.tmp, this.last]) t.dispose?.();
    this.removeFromParent();
  }
}

/** Steps every cape at the start of the frame. */
export class ClothSystem {
  constructor() { this.name = 'cloth'; this.time = 0; this.wind = new Vector3(); }
  beginFrame(r) {
    if (!r.cloths?.size) return;
    this.time += r.dt ?? 1 / 60;
    this.windFn?.(this.time, this.wind);
    for (const c of r.cloths) c.step(r.dt ?? 1 / 60, this.wind);
  }
}
