/**
 * The time machine's light show, drawn over the lit, anti-aliased image (so nothing smears in
 * the temporal filter): camera-facing particles (fire, sparks, the cold vapour, smoke) and
 * electric arcs as glowing ribbons. Tested by hand against the scene's depth, softened where
 * they meet a surface.
 *
 * Particles: { x, y, z, vx, vy, vz, life, age, size, grow, color [r,g,b] (radiance), alpha,
 * drag, rise, kind: 'add' (light) | 'mix' (vapour, smoke) }.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';

const MAX = 6000;
const FLOATS = 12;    // per instance: pos (3), size, color (3), alpha, kind, seed, rot, soft

const VS = /* glsl */`
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPos;      // xyz, size
layout(location = 2) in vec4 aCol;      // rgb, alpha
layout(location = 3) in vec4 aInfo;     // kind, seed, rotation, softness
uniform mat4 uViewProj;
uniform vec3 uCamRight, uCamUp;
out vec2 vUv; out vec4 vCol; out vec4 vInfo; out vec4 vClip;
void main() {
  float c = cos(aInfo.z), s = sin(aInfo.z);
  vec2 q = aCorner * 2.0 - 1.0;
  q = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec3 w = aPos.xyz + (uCamRight * q.x + uCamUp * q.y) * aPos.w;
  vUv = aCorner; vCol = aCol; vInfo = aInfo;
  vClip = uViewProj * vec4(w, 1.0);
  gl_Position = vClip;
}`;

const FS = /* glsl */`
${COMMON}
in vec2 vUv; in vec4 vCol; in vec4 vInfo; in vec4 vClip;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform float uPass;   // 0: additive, 1: mixed
out vec4 o;
void main() {
  if (abs(vInfo.x - uPass) > 0.5) discard;
  vec2 ndc = vClip.xy / vClip.w;
  float d = texture(uDepth, ndc * 0.5 + 0.5).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  float sceneZ = d < 1.0 ? -sp.z / sp.w : 1e9;
  float behind = sceneZ - vClip.w;
  float soft = clamp(behind / max(vInfo.w, 0.02), 0.0, 1.0);
  if (soft <= 0.0) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // a soft blob with some texture: billows for vapour, licks for flame
  float n = vnoise(p * 3.0 + vInfo.y * 17.0) * 0.6 + vnoise(p * 7.0 - vInfo.y * 5.0) * 0.4;
  float shape = smoothstep(1.0, 0.15, r + (n - 0.5) * (uPass > 0.5 ? 0.55 : 0.35));
  float a = shape * vCol.a * soft;
  if (uPass < 0.5) o = vec4(vCol.rgb * a, 0.0);            // light: added
  else o = vec4(vCol.rgb * a, a);                         // vapour: over (premultiplied)
  if (!(abs(o.r) + abs(o.g) + abs(o.b) + abs(o.a) < 1e30)) o = vec4(0.0);
  o = clamp(o, vec4(0.0), vec4(6e3, 6e3, 6e3, 1.0));
}`;

// the arcs: ribbons of quads, each vertex: position, side (+-1), brightness
const ARC_VS = /* glsl */`
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aDir;      // the bolt's direction here
layout(location = 2) in vec2 aSide;     // side (-1..1), brightness
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uWidth;
out float vSide; out float vB; out vec4 vClip;
void main() {
  vec3 toCam = normalize(uCamPos - aPos);
  vec3 off = normalize(cross(aDir, toCam) + 1e-5);
  vec3 w = aPos + off * aSide.x * uWidth * (0.6 + aSide.y * 0.6);
  vSide = aSide.x; vB = aSide.y;
  vClip = uViewProj * vec4(w, 1.0);
  gl_Position = vClip;
}`;
const ARC_FS = /* glsl */`
in float vSide; in float vB; in vec4 vClip;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform vec3 uColor;
out vec4 o;
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  float d = texture(uDepth, ndc * 0.5 + 0.5).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  float sceneZ = d < 1.0 ? -sp.z / sp.w : 1e9;
  if (sceneZ < vClip.w - 0.05) discard;
  float core = exp(-vSide * vSide * 9.0);
  float glow = exp(-vSide * vSide * 2.0) * 0.25;
  o = vec4(uColor * (core + glow) * vB, 0.0);
  if (!(abs(o.r) + abs(o.g) + abs(o.b) < 1e30)) o = vec4(0.0);
  o = clamp(o, vec4(0.0), vec4(6e3, 6e3, 6e3, 0.0));
}`;

export class Effects {
  constructor() {
    this.name = 'effects';
    this.enabled = true;
    this.particles = [];
    this.arcs = [];          // [{ points: [[x,y,z],...], b (brightness), life }]
    this.arcColor = [0.75, 0.88, 1.6];
    this.arcScale = 1;
    this.rain = 0;                     // 0..1
    this.rainColor = [0.01, 0.01, 0.012];
    this.time = 0;
  }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'fx-particles');
    this.arcProg = new Program(gl, ARC_VS, ARC_FS, {}, 'fx-arcs');
    this.copy = postProgram(gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'fx-copy');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, MAX * FLOATS * 4, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
    gl.bindVertexArray(null);
    this.data = new Float32Array(MAX * FLOATS);
    // arcs
    this.arcVao = gl.createVertexArray();
    gl.bindVertexArray(this.arcVao);
    this.arcBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.arcBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 60000 * 8 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);
    this.arcData = new Float32Array(60000 * 8);
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  emit(p) { if (this.particles.length < MAX) this.particles.push({ age: 0, drag: 0.5, rise: 0, grow: 0, alpha: 1, soft: 0.3, rot: Math.random() * 6.28, spin: (Math.random() - 0.5), seed: Math.random(), kind: 'add', ...p }); }

  /** Moves everything on (the engine's dt). Shifts the world by (dx, dz) if given (not used). */
  step(dt) {
    const P = this.particles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.rise * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      if (p.y < 0.02 && p.vy < 0) { p.y = 0.02; p.vy *= -0.3; }
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) { const a = this.arcs[i]; a.life -= dt; if (a.life <= 0) this.arcs.splice(i, 1); }
  }

  afterLighting(r, color) {
    const P = this.particles, A = this.arcs;
    this.time += r.dt ?? 0.016;
    if (!P.length && !A.length && !(this.rain > 0)) return color;
    const gl = r.gl;
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    const cam = r.camera;
    const e = cam.matrixWorld.elements;
    const right = [e[0], e[1], e[2]], up = [e[4], e[5], e[6]];
    if (P.length) {
      const D = this.data;
      let n = 0;
      for (const p of P) {
        const t = p.age / p.life;
        const fade = (p.fadeIn ? Math.min(1, p.age / p.fadeIn) : 1) * (1 - t) ** (p.fadePow ?? 1);
        const o = n * FLOATS;
        D[o] = p.x; D[o + 1] = p.y; D[o + 2] = p.z; D[o + 3] = p.size * (1 + p.grow * p.age);
        const c = p.color, ce = p.cool ? [c[0] * (1 - t * 0.9), c[1] * (1 - t * 0.95), c[2] * (1 - t)] : c;
        D[o + 4] = ce[0]; D[o + 5] = ce[1]; D[o + 6] = ce[2]; D[o + 7] = p.alpha * fade;
        D[o + 8] = p.kind === 'add' ? 0 : 1; D[o + 9] = p.seed; D[o + 10] = p.rot; D[o + 11] = p.soft;
        n++;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, D, 0, n * FLOATS);
      const prog = this.prog.use();
      prog.set('uViewProj', r.viewProj).set('uCamRight', right).set('uCamUp', up).set('uDepth', r.depth).set('uInvProj', r.invProj);
      gl.bindVertexArray(this.vao);
      gl.enable(gl.BLEND);
      // the vapour and smoke first (over), then the light (added)
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      prog.set('uPass', 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.blendFunc(gl.ONE, gl.ONE);
      prog.set('uPass', 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
    if (A.length || this.rain > 0) {
      const D = this.arcData;
      let n = 0;
      const push = (p, d, s, b) => { if (n >= 60000) return; const o = n * 8; D[o] = p[0]; D[o + 1] = p[1]; D[o + 2] = p[2]; D[o + 3] = d[0]; D[o + 4] = d[1]; D[o + 5] = d[2]; D[o + 6] = s; D[o + 7] = b; n++; };
      for (const a of A) {
        const pts = a.points, b = a.b * Math.min(1, a.life * 8);
        for (let i = 0; i + 1 < pts.length; i++) {
          const p0 = pts[i], p1 = pts[i + 1];
          const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
          push(p0, d, -1, b); push(p1, d, -1, b); push(p1, d, 1, b);
          push(p0, d, -1, b); push(p1, d, 1, b); push(p0, d, 1, b);
        }
      }
      const nArcs = n;
      // the rain: streaks in a box about the camera, falling at 9 m/s, slanted by the wind
      if (this.rain > 0) {
        const cp = r.cameraPos, N = Math.floor(2200 * this.rain), H = 14, S = 16, t = this.time;
        const vx = 1.4, vy = -9, vz = 0.6, len = 0.045;
        for (let i = 0; i < N; i++) {
          const h1 = Math.sin(i * 12.9898) * 43758.5453, h2 = Math.sin(i * 78.233) * 12345.678, h3 = Math.sin(i * 39.425) * 24634.633;
          const fx = h1 - Math.floor(h1), fz = h2 - Math.floor(h2), fy = h3 - Math.floor(h3);
          // a fixed lattice in the world, wrapped round the camera, so the drops do not ride along with it
          const x = cp.x + ((((fx * S * 2 - cp.x) % (S * 2)) + S * 3) % (S * 2)) - S;
          const z = cp.z + ((((fz * S * 2 - cp.z) % (S * 2)) + S * 3) % (S * 2)) - S;
          const y = cp.y - H / 2 + ((((fy * H - t * -vy) % H) + H) % H);
          const p0 = [x + vx * (y - cp.y) / 9, y, z + vz * (y - cp.y) / 9], d = [vx * len, vy * len, vz * len], p1 = [p0[0] + d[0], p0[1] + d[1], p0[2] + d[2]];
          push(p0, d, -1, 1); push(p1, d, -1, 1); push(p1, d, 1, 1);
          push(p0, d, -1, 1); push(p1, d, 1, 1); push(p0, d, 1, 1);
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.arcBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, D, 0, n * 8);
      const prog = this.arcProg.use();
      prog.set('uViewProj', r.viewProj).set('uCamPos', r.cameraPos).set('uDepth', r.depth).set('uInvProj', r.invProj)
        .set('uWidth', 0.018 * this.arcScale).set('uColor', this.arcColor);
      gl.bindVertexArray(this.arcVao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      if (nArcs) gl.drawArrays(gl.TRIANGLES, 0, nArcs);
      if (n > nArcs) { prog.set('uWidth', 0.0045).set('uColor', this.rainColor); gl.drawArrays(gl.TRIANGLES, nArcs, n - nArcs); }
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
    return this.target.tex;
  }
}

/** A jagged bolt from a to b (midpoint displacement), as a list of points. */
export function bolt(a, b, rough = 0.3, depth = 5, rnd = Math.random) {
  let pts = [a, b];
  let off = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * rough;
  for (let k = 0; k < depth; k++) {
    const next = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1];
      next.push([(p[0] + q[0]) / 2 + (rnd() - 0.5) * off, (p[1] + q[1]) / 2 + (rnd() - 0.5) * off, (p[2] + q[2]) / 2 + (rnd() - 0.5) * off], q);
    }
    pts = next;
    off *= 0.55;
  }
  return pts;
}
