/**
 * Small things in the water, drawn over the finished image: bubbles and marine snow.
 *
 * Bubbles come from what the plant says is leaving the tanks: air vented through the main vents
 * (a boil over the deck when she dives), air spilling out of the flood ports at the bottom when a
 * tank is blown dry (the "air bubbling alongside" the lookouts watch for), the escaping air of a
 * blow on surfacing. Each rises at its terminal velocity (about 0.25 m/s for a bubble of a few
 * millimetres, faster as it grows) and grows as it rises, its volume going as 1/p (Boyle): a
 * bubble from 60 ft reaches the surface with twice its volume. Marine snow: the slow drift of
 * organic flakes the light picks out near the eye, a sense of the water's movement past her.
 *
 * Spray (world/wake.js throws it): drops of a few millimetres flung off the bow and the
 * periscope, falling under gravity against the air's drag (terminal velocity about 6.5 m/s for a
 * 2 mm drop), gone when they meet the sea again. One drawn speck stands for a cloud of them.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';
import { WATER } from './water.js';
import { YA } from '../physics/dynamics.js';
import { deckHeight } from '../physics/dynamics.js';
import { FT } from '../data/boat.js';
import { ATM } from '../physics/units.js';

const MAX = 6000;

const VS = /* glsl */`
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPart;         // world position, radius
layout(location = 2) in float aKind;         // 0 bubble, 1 snow, 2 spray
uniform mat4 uViewProj;
uniform vec3 uCamRight, uCamUp;
out vec2 vUv; out vec4 vClip; out float vKind; out vec3 vWorld;
void main() {
  vec3 p = aPart.xyz + (uCamRight * (aCorner.x - 0.5) + uCamUp * (aCorner.y - 0.5)) * aPart.w * 2.0;
  vUv = aCorner; vKind = aKind; vWorld = aPart.xyz;
  vClip = uViewProj * vec4(p, 1.0);
  gl_Position = vClip;
}`;

const FS = /* glsl */`
${COMMON}
in vec2 vUv; in vec4 vClip; in float vKind; in vec3 vWorld;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform vec3 uCameraPos, uKd, uC, uWaterRad, uSkyDown, uSunIrr;
uniform float uAbove;
out vec4 o;
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  float d = texture(uDepth, ndc * 0.5 + 0.5).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  if (d < 1.0 && -sp.z / sp.w < vClip.w - 0.02) discard;
  vec2 c = vUv * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  if (vKind > 1.5) {
    // spray in the air: white drops lit by the sky and the sun
    if (uAbove < 0.5) discard;
    float a = (1.0 - r2) * 0.55;
    vec3 col = (uSkyDown * 0.35 + uSunIrr * 0.12) * a;
    o = vec4(col, a);
    return;
  }
  if (uAbove > 0.5) discard;
  float depth = max(0.0, -vWorld.y);
  vec3 light = uSkyDown * exp(-uKd * depth);
  float dist = length(vWorld - uCameraPos);
  vec3 T = exp(-uC * dist);
  vec3 col; float a;
  if (vKind < 0.5) {
    // a bubble: a bright rim (total reflection at its edge) and a highlight from above
    float rim = smoothstep(0.55, 0.95, sqrt(r2));
    float hi = smoothstep(0.35, 0.0, length(c - vec2(-0.3, 0.35)));
    col = light * (0.25 + 1.6 * rim + 2.5 * hi) * 0.35;
    a = 0.25 + 0.6 * rim;
  } else {
    col = light * 0.18;
    a = (1.0 - r2) * 0.5;
  }
  col *= T; a *= (T.g + T.b) * 0.5;
  o = vec4(col * a, a * 0.7);
}`;

export class Particles {
  constructor(stage) { this.name = 'particles'; this.enabled = true; this.stage = stage; this.n = 0; this.snowN = 1400; }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'particles');
    this.copy = postProgram(gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'particles-copy');
    this.data = new Float32Array(MAX * 5);
    this.vel = new Float32Array(MAX * 3);
    this.r0 = new Float32Array(MAX);           // radius at its birth depth, and the birth pressure
    this.p0 = new Float32Array(MAX);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX * 20, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    // marine snow: a cloud round the eye
    for (let i = 0; i < this.snowN; i++) this._snow(i, true);
    this.n = this.snowN;
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  _snow(i, init = false) {
    const c = this.stage.camera.position, D = this.data;
    const R = 14;
    D[i * 5] = c.x + (Math.random() - 0.5) * 2 * R; D[i * 5 + 1] = c.y + (Math.random() - 0.5) * 2 * R; D[i * 5 + 2] = c.z + (Math.random() - 0.5) * 2 * R;
    D[i * 5 + 3] = 0.004 + Math.random() * 0.01; D[i * 5 + 4] = 1;
    void init;
  }

  /** Lets out bubbles: n of them at world point (x, y, z), spread s (m), radius r (m), at sea pressure p (Pa). */
  emit(x, y, z, n, s, r, p) {
    for (let k = 0; k < n; k++) {
      if (this.n >= MAX) return;
      const i = this.n++, D = this.data;
      D[i * 5] = x + (Math.random() - 0.5) * s; D[i * 5 + 1] = y + Math.random() * s * 0.3; D[i * 5 + 2] = z + (Math.random() - 0.5) * s;
      const rr = r * (0.5 + Math.random());
      D[i * 5 + 3] = rr; D[i * 5 + 4] = 0;
      this.r0[i] = rr; this.p0[i] = p;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.4; this.vel[i * 3 + 1] = 0.5 + Math.random() * 0.5; this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
  }

  /** Throws spray: [X, Y, Z, vx, vy, vz] in world coordinates. */
  throwSpray(list) {
    const D = this.data, O = this.stage.origin;
    for (const [x, y, z, vx, vy, vz] of list) {
      if (this.n >= MAX) return;
      const i = this.n++;
      D[i * 5] = x - O.x; D[i * 5 + 1] = y; D[i * 5 + 2] = z - O.z; D[i * 5 + 3] = 0.12 + Math.random() * 0.25; D[i * 5 + 4] = 2;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    }
  }

  /** Steps the bubbles, the snow and the spray; emits from the plant's tanks. */
  step(dt, plant, sea) {
    if (!this.data) return;
    const D = this.data, c = this.stage.camera.position, col = sea.column, O = this.stage.origin;
    // the floating origin moved: everything moves with it
    if (this._o && (this._o[0] !== O.x || this._o[1] !== O.z)) {
      const dx = this._o[0] - O.x, dz = this._o[1] - O.z;
      for (let i = 0; i < this.n; i++) if (D[i * 5 + 4] !== 1) { D[i * 5] += dx; D[i * 5 + 2] += dz; }
    }
    this._o = [O.x, O.z];
    // emission from the tanks venting and spilling, in the boat's frame -> world
    const M = this.stage.boatMat.elements;
    const toW = (x, y, z) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
    for (const tk of plant.boat.tanks) {
      const out = (tk.venting ?? 0) + (tk.bubbling ?? 0);
      if (out <= 0.05) continue;
      // moles a second -> bubbles a frame (one drawn bubble stands for a great many)
      const n = Math.min(40, Math.ceil(Math.sqrt(out) * dt * 30));
      const vent = (tk.venting ?? 0) > (tk.bubbling ?? 0);
      const y = vent ? deckHeight(tk.x / FT) * FT : tk.y0 + 0.2;
      const z = vent ? (tk.zOff ?? 0) * 0.3 : (Math.abs(tk.zOff) > 0.1 ? Math.sign(tk.zOff) * 3.3 : 0);
      const w = toW(tk.x, y, z);
      if (w[1] > -0.2) continue;
      this.emit(w[0], w[1], w[2], n, vent ? 1.2 : 2.0, vent ? 0.03 : 0.02, col.pressureAt(-w[1]));
    }
    // move: bubbles rise, wobble, swell; burst at the surface; the snow drifts and wraps round the eye
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const kind = D[i * 5 + 4];
      if (kind > 1.5) {
        // a drop: gravity and quadratic drag (g / vt^2 with vt = 6.5 m/s); back into the sea
        const v = this.vel, k3 = i * 3, sp = Math.hypot(v[k3], v[k3 + 1], v[k3 + 2]), kd = (9.81 / 42) * sp * dt;
        v[k3] -= v[k3] * kd; v[k3 + 1] -= 9.81 * dt + v[k3 + 1] * kd; v[k3 + 2] -= v[k3 + 2] * kd;
        D[i * 5] += v[k3] * dt; D[i * 5 + 1] += v[k3 + 1] * dt; D[i * 5 + 2] += v[k3 + 2] * dt;
        if (v[k3 + 1] < 0 && D[i * 5 + 1] < sea.eta(D[i * 5] + O.x, D[i * 5 + 2] + O.z)) continue;
      } else if (kind > 0.5) {
        D[i * 5 + 1] -= 0.004 * dt;
        for (let a = 0; a < 3; a++) {
          const k = i * 5 + a, cc = a === 0 ? c.x : a === 1 ? c.y : c.z;
          if (D[k] - cc > 14) D[k] -= 28; else if (D[k] - cc < -14) D[k] += 28;
        }
        if (D[i * 5 + 1] > -0.3) D[i * 5 + 1] -= 20;
      } else {
        const y = D[i * 5 + 1];
        if (y > -0.05) continue;                               // burst at the surface
        const p = y < 0 ? col.pressureAt(-y) : ATM;
        const r = this.r0[i] * Math.cbrt(this.p0[i] / p);      // Boyle: V p constant
        D[i * 5 + 3] = r;
        const vt = Math.min(0.35, 0.18 + 6 * r);               // terminal rise velocity (m/s)
        this.vel[i * 3 + 1] += (vt - this.vel[i * 3 + 1]) * Math.min(1, dt * 2);
        this.vel[i * 3] *= 1 - dt * 0.8; this.vel[i * 3 + 2] *= 1 - dt * 0.8;
        D[i * 5] += (this.vel[i * 3] + Math.sin(y * 7 + i) * 0.05) * dt;
        D[i * 5 + 1] += this.vel[i * 3 + 1] * dt;
        D[i * 5 + 2] += (this.vel[i * 3 + 2] + Math.cos(y * 6 + i) * 0.05) * dt;
      }
      if (j !== i) { for (let a = 0; a < 5; a++) D[j * 5 + a] = D[i * 5 + a]; this.r0[j] = this.r0[i]; this.p0[j] = this.p0[i]; for (let a = 0; a < 3; a++) this.vel[j * 3 + a] = this.vel[i * 3 + a]; }
      j++;
    }
    this.n = j;
    this.hasSpray = false;
    for (let i = 0; i < this.n; i++) if (D[i * 5 + 4] > 1.5) { this.hasSpray = true; break; }
    // keep the snow's count
    while (this.n < MAX && this.countSnow() < this.snowN) { this._snow(this.n); this.n++; }
  }
  countSnow() { let k = 0; for (let i = 0; i < this.n; i++) if (this.data[i * 5 + 4] > 0.5) k++; return k; }

  afterLighting(r, color) {
    if (!this.n) return color;
    const gl = r.gl, S = this.stage;
    // under the sea (or looking into it from the observation deck); above it, only the spray
    const above = r.cameraPos.y > 2 ? 1 : 0;
    if (above && !this.hasSpray) return color;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.n * 5));
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.disable(gl.CULL_FACE);
    const e = S.camera.matrixWorld.elements;
    this.prog.use().set('uViewProj', r.viewProj).set('uCamRight', [e[0], e[1], e[2]]).set('uCamUp', [e[4], e[5], e[6]])
      .set('uDepth', r.depth).set('uInvProj', r.invProj).set('uCameraPos', r.cameraPos)
      .set('uKd', WATER.Kd).set('uC', WATER.c).set('uWaterRad', S.U.waterRad).set('uSkyDown', S.U.skyDown)
      .set('uAbove', above).set('uSunIrr', [r.sunColor.x * r.sunIntensity, r.sunColor.y * r.sunIntensity, r.sunColor.z * r.sunIntensity]);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}

void YA;
