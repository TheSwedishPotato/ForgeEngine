import { Program, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/**
 * GPU particles: sparks from steel on steel, embers from forges and
 * hearths. WebGL2 has no compute shaders, so the simulation runs in a vertex
 * shader with transform feedback (the GPU writes the new state of every
 * particle back into a buffer, ping-pong, nothing returns to the CPU).
 * Each particle falls (sparks) or rises on hot air (embers), loses heat,
 * and collides with the scene through the depth buffer: if it passes
 * behind a visible surface it bounces off that surface's G-buffer normal.
 * Drawn as additive streaks along their screen-space motion, glowing with
 * a black-body colour that cools as they age.
 *
 * The CPU only writes new particles into a ring of the buffer when it
 * emits them (emit()); everything else stays on the GPU.
 */

const STRIDE = 12;      // floats: pos.xyz life | vel.xyz maxLife | temp size kind seed

const UPDATE_VS = /* glsl */`
${COMMON}
in vec4 aPosLife;
in vec4 aVelMax;
in vec4 aMisc;
out vec4 oPosLife;
out vec4 oVelMax;
out vec4 oMisc;
uniform float uDt, uTime;
uniform mat4 uViewProj, uInvProj;
uniform sampler2D uDepth, uG1;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec4 pl = aPosLife, vm = aVelMax, mi = aMisc;
  if (pl.w > 0.0) {
    vec3 p = pl.xyz, v = vm.xyz;
    bool ember = mi.z > 0.5;
    vec3 acc = vec3(0.0, -9.81, 0.0);
    if (ember) {
      // buoyant in the hot air over the fire, wandering
      float t = uTime * 1.7 + mi.w * 31.0;
      acc = vec3(sin(t + p.y * 3.0) * 1.6, 1.4 * mi.x, cos(t * 1.3 + p.x * 2.0) * 1.6);
    }
    v += acc * uDt;
    v *= exp(-uDt * (ember ? 1.4 : 0.25));
    vec3 np = p + v * uDt;
    // collide with whatever is drawn: behind the depth buffer by a little = hit
    vec4 c = uViewProj * vec4(np, 1.0);
    if (c.w > 0.05) {
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
        float d = texture(uDepth, uv).r;
        vec4 sp = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        float sceneZ = -sp.z / sp.w;
        float z = c.w;
        if (d < 1.0 && z > sceneZ + 0.005 && z < sceneZ + 0.3) {
          vec3 n = decodeNormal(texture(uG1, uv).xy);
          if (dot(v, n) < 0.0) {
            vec3 vn = n * dot(v, n), vt = v - vn;
            v = vt * 0.6 - vn * (ember ? 0.1 : 0.35);
            np = p + n * 0.004;
            mi.x *= 0.85;      // a bounce costs heat
          }
        }
      }
    }
    pl.xyz = np;
    pl.w -= uDt;
    vm.xyz = v;
    mi.x *= exp(-uDt * (ember ? 0.5 : 2.2));   // cooling
  }
  oPosLife = pl; oVelMax = vm; oMisc = mi;
  gl_Position = vec4(0.0);
}`;
const UPDATE_FS = 'out vec4 o; void main() { o = vec4(0.0); }';

const DRAW_VS = /* glsl */`
in vec4 aPosLife;
in vec4 aVelMax;
in vec4 aMisc;
uniform mat4 uViewProj;
uniform vec2 uResolution;
out vec2 vQ;
out float vHeat, vFade;
void main() {
  if (aPosLife.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  const vec2 Q[6] = vec2[](vec2(-1, -1), vec2(1, -1), vec2(1, 1), vec2(-1, -1), vec2(1, 1), vec2(-1, 1));
  vec2 q = Q[gl_VertexID];
  vec3 p = aPosLife.xyz, v = aVelMax.xyz;
  float streak = aMisc.z > 0.5 ? 0.015 : 0.035;
  vec4 a = uViewProj * vec4(p, 1.0), b = uViewProj * vec4(p - v * streak, 1.0);
  vec2 sa = a.xy / a.w, sb = b.xy / b.w;
  vec2 dir = (sa - sb) * uResolution;
  float len = length(dir);
  vec2 t = len > 1e-3 ? dir / len : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  float wpx = max(1.2, aMisc.y * uResolution.y / max(a.w, 0.1));
  // the quad spans from the tail to the head, a few pixels wide
  vec2 mid = mix(sb, sa, 0.5);
  vec2 off = (t * (len * 0.5 + wpx) * q.x + n * wpx * q.y) / uResolution;
  gl_Position = vec4((mid + off) * a.w, a.z, a.w);
  vQ = q;
  vHeat = aMisc.x;
  vFade = clamp(aPosLife.w / max(aVelMax.w, 1e-3) * 3.0, 0.0, 1.0);
}`;
const DRAW_FS = /* glsl */`
in vec2 vQ;
in float vHeat, vFade;
out vec4 o;
void main() {
  float r = length(vQ * vec2(0.6, 1.0));
  float a = smoothstep(1.0, 0.2, r) * vFade;
  // a black body cooling from yellow-white through orange to dull red
  vec3 c = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.82, 0.45), clamp(vHeat, 0.0, 1.0));
  o = vec4(c * (1.5 + 30.0 * vHeat * vHeat) * a, 0.0);
}`;

export class GPUParticles {
  constructor({ max = 16384 } = {}) { this.name = 'gpuParticles'; this.max = max; this.next = 0; this.liveUntil = -1; this.time = 0; GPUParticles.active = this; }

  init(r) {
    const gl = r.gl;
    this.gl = gl;
    this.update = new Program(gl, UPDATE_VS, UPDATE_FS, {}, 'particles-update', { feedback: ['oPosLife', 'oVelMax', 'oMisc'] });
    this.draw = new Program(gl, DRAW_VS, DRAW_FS, {}, 'particles-draw');
    const bytes = this.max * STRIDE * 4;
    this.buf = [gl.createBuffer(), gl.createBuffer()];
    for (const b of this.buf) { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_COPY); }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const vao = (prog, buffer, divisor) => {
      const v = gl.createVertexArray();
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [name, off] of [['aPosLife', 0], ['aVelMax', 4], ['aMisc', 8]]) {
        const loc = prog.attribs.get(name);
        if (loc === undefined || loc < 0) continue;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, off * 4);
        gl.vertexAttribDivisor(loc, divisor);
      }
      gl.bindVertexArray(null);
      return v;
    };
    this.upVao = this.buf.map((b) => vao(this.update, b, 0));
    this.drawVao = this.buf.map((b) => vao(this.draw, b, 1));
    this.tf = gl.createTransformFeedback();
    this.src = 0;
    this.scratch = new Float32Array(STRIDE * 512);
  }

  /**
   * Emit particles. kind 'spark' (falls, hot, short) or 'ember' (rises,
   * glows long). pos: {x,y,z}; dir: optional bias; speed, spread, life, heat.
   */
  emit({ pos, count = 30, kind = 'spark', dir = null, speed = 5, spread = 1, life = 0.6, heat = 1, size = 0.004 }) {
    if (!this.gl) return;
    const gl = this.gl;
    count = Math.min(count, 512);
    const f = this.scratch;
    for (let i = 0; i < count; i++) {
      let x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
      const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      if (dir) { x = dir.x + x * spread; y = dir.y + y * spread; z = dir.z + z * spread; const l2 = Math.hypot(x, y, z) || 1; x /= l2; y /= l2; z /= l2; }
      const s = speed * (0.35 + Math.random() * 0.9);
      const L = life * (0.4 + Math.random() * 0.9);
      f.set([pos.x, pos.y, pos.z, L, x * s, y * s + (kind === 'ember' ? 0.3 : 1), z * s, L, heat * (0.75 + Math.random() * 0.25), size * (0.6 + Math.random() * 0.8), kind === 'ember' ? 1 : 0, Math.random()], i * STRIDE);
    }
    // into the ring, in up to two pieces
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[this.src]);
    const first = Math.min(count, this.max - this.next);
    gl.bufferSubData(gl.ARRAY_BUFFER, this.next * STRIDE * 4, f, 0, first * STRIDE);
    if (count > first) gl.bufferSubData(gl.ARRAY_BUFFER, 0, f, first * STRIDE, (count - first) * STRIDE);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.next = (this.next + count) % this.max;
    this.liveUntil = Math.max(this.liveUntil, this.time + life * 1.4);
  }

  afterLighting(r, color) {
    const dt = Math.min(r.dt ?? 1 / 60, 1 / 20);
    this.time += dt;
    if (this.time > this.liveUntil) return color;
    const gl = this.gl;
    // 1. simulate: read buffer src, write buffer dst
    const dst = 1 - this.src;
    const u = this.update.use();
    r.bindGBuffer(u);
    u.set('uDt', dt).set('uTime', this.time).set('uViewProj', r.viewProjJit).set('uInvProj', r.invProj);
    gl.bindVertexArray(this.upVao[this.src]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buf[dst]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.max);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    this.src = dst;
    // 2. draw the streaks, additive, into the lit image
    r.hdr.bind();
    state(gl);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.draw.use().set('uViewProj', r.viewProjJit).set('uResolution', [r.width, r.height]);
    gl.bindVertexArray(this.drawVao[this.src]);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.max);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return color;
  }
}
GPUParticles.active = null;
