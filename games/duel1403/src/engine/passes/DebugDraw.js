import { Vector3 } from 'three';
import { Program, state } from '../gl/GL.js';

/**
 * Immediate-mode debug geometry for the Med Engine: lines, circles,
 * spheres, capsules, boxes and arrows in world space, plus text labels
 * pinned to world points. Everything submitted during a frame is drawn
 * once, on top of the final image (optionally depth-tested against the
 * scene), and cleared.
 */
const VS = /* glsl */`
layout(location = 0) in vec3 position;
layout(location = 1) in vec4 color;
uniform mat4 uViewProj;
out vec4 vColor;
out vec4 vClip;
void main() { vColor = color; vClip = uViewProj * vec4(position, 1.0); gl_Position = vClip; }`;
const FS = /* glsl */`
in vec4 vColor; in vec4 vClip; out vec4 o;
uniform sampler2D uDepth;
uniform float uXray;
void main() {
  vec3 ndc = vClip.xyz / vClip.w;
  float scene = texture(uDepth, ndc.xy * 0.5 + 0.5).r;
  float hidden = step(scene + 0.00002, ndc.z * 0.5 + 0.5);
  o = vec4(vColor.rgb, vColor.a * mix(1.0, 0.28, hidden * uXray));
}`;

const MAX = 120000;   // vertices per frame
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const _a = new Vector3(), _b = new Vector3(), _u = new Vector3(), _w = new Vector3(), _t = new Vector3();

export class DebugDraw {
  constructor() {
    this.name = 'debugdraw';
    this.enabled = true;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.n = 0;
    this.labels = [];
    this.xray = true;    // lines behind geometry drawn faintly instead of hidden
  }

  init(r) {
    const gl = r.gl;
    this.r = r;
    this.prog = new Program(gl, VS, FS, {}, 'debug-lines');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.bp = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bp);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.bc = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bc);
    gl.bufferData(gl.ARRAY_BUFFER, this.col.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  // --- primitives ------------------------------------------------------------

  line(a, b, c = [1, 1, 1, 1]) {
    if (this.n + 2 > MAX) return;
    const p = this.pos, q = this.col, i = this.n;
    p[i * 3] = a.x; p[i * 3 + 1] = a.y; p[i * 3 + 2] = a.z;
    p[i * 3 + 3] = b.x; p[i * 3 + 4] = b.y; p[i * 3 + 5] = b.z;
    q.set(c.length === 4 ? c : [...c, 1], i * 4);
    q.set(c.length === 4 ? c : [...c, 1], i * 4 + 4);
    this.n += 2;
  }

  /** Circle of radius r around centre c in the plane with normal n. */
  circle(c, r, n, color, seg = 24) {
    basis(n, _u, _w);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      _a.copy(c).addScaledVector(_u, Math.cos(a0) * r).addScaledVector(_w, Math.sin(a0) * r);
      _b.copy(c).addScaledVector(_u, Math.cos(a1) * r).addScaledVector(_w, Math.sin(a1) * r);
      this.line(_a.clone(), _b.clone(), color);
    }
  }

  sphere(c, r, color) {
    this.circle(c, r, X, color, 16);
    this.circle(c, r, Y, color, 16);
    this.circle(c, r, Z, color, 16);
  }

  capsule(a, b, r, color) {
    const ax = _t.subVectors(b, a);
    const len = ax.length();
    if (len < 1e-6) { this.sphere(a, r, color); return; }
    const d = ax.clone().multiplyScalar(1 / len);
    const u = new Vector3(), w = new Vector3();
    basis(d, u, w);
    this.circle(a, r, d, color, 14);
    this.circle(b, r, d, color, 14);
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = u.clone().multiplyScalar(x * r).addScaledVector(w, y * r);
      this.line(a.clone().add(o), b.clone().add(o), color);
    }
    // end caps: half circles in two planes
    for (const [p, s] of [[a, -1], [b, 1]]) for (const v of [u, w]) {
      const seg = 8;
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI, t1 = ((i + 1) / seg) * Math.PI;
        const p0 = p.clone().addScaledVector(v, Math.cos(t0) * r).addScaledVector(d, s * Math.sin(t0) * r);
        const p1 = p.clone().addScaledVector(v, Math.cos(t1) * r).addScaledVector(d, s * Math.sin(t1) * r);
        this.line(p0, p1, color);
      }
    }
  }

  /** Oriented box from centre, half extents and a quaternion. */
  box(c, half, q, color) {
    const corners = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(new Vector3(x * half.x, y * half.y, z * half.z).applyQuaternion(q).add(c));
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [i, j] of E) this.line(corners[i], corners[j], color);
  }

  arrow(from, dir, len, color) {
    const to = from.clone().addScaledVector(dir, len);
    this.line(from, to, color);
    const d = dir.clone().normalize(), u = new Vector3(), w = new Vector3();
    basis(d, u, w);
    const h = Math.min(0.06, len * 0.25);
    for (const v of [u, w]) for (const s of [1, -1]) this.line(to, to.clone().addScaledVector(d, -h).addScaledVector(v, s * h * 0.5), color);
  }

  cross(p, s, color) {
    this.line(_a.copy(p).add(_t.set(s, 0, 0)).clone(), _b.copy(p).add(_t.set(-s, 0, 0)).clone(), color);
    this.line(_a.copy(p).add(_t.set(0, s, 0)).clone(), _b.copy(p).add(_t.set(0, -s, 0)).clone(), color);
    this.line(_a.copy(p).add(_t.set(0, 0, s)).clone(), _b.copy(p).add(_t.set(0, 0, -s)).clone(), color);
  }

  /** A text label at a world point (drawn as DOM by whoever owns the overlay). */
  label(p, text, color = '#fff') { this.labels.push({ p: p.clone(), text, color }); }

  // --- frame -------------------------------------------------------------------

  /** Drawn last, on the canvas, after the post chain. */
  afterLighting(r, color) {
    if (!this.n) return color;
    const gl = r.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.displayW, r.displayH);
    state(gl, { blend: 'alpha' });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bp);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos, 0, this.n * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bc);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.col, 0, this.n * 4);
    this.prog.use().set('uViewProj', r.viewProj).set('uDepth', r.depth).set('uXray', this.xray ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return color;
  }

  /** Clears the frame's geometry; returns the labels for the overlay. */
  endFrame() {
    this.n = 0;
    this.frameLabels = this.labels;
    this.labels = [];
  }
}

function basis(n, u, w) {
  const a = Math.abs(n.y) < 0.95 ? _t.set(0, 1, 0) : _t.set(1, 0, 0);
  u.crossVectors(n, a).normalize();
  w.crossVectors(n, u).normalize();
}
