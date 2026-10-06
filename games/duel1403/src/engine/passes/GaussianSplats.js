import { Program, state } from '../gl/GL.js';
import { COMMON } from '../shaders/common.js';

/**
 * 3D Gaussian splats, used for chimney and smoke-hole smoke.
 *
 * Each splat is an anisotropic 3D Gaussian: a centre, a covariance built
 * from a rotation and three scales (Σ = R S Sᵀ Rᵀ), an albedo and an
 * opacity. The puffs are simulated on the CPU (rise, drag, wind, growth)
 * and sorted back to front each frame; the GPU projects each covariance
 * into screen space with the perspective Jacobian (EWA splatting:
 * Σ' = J W Σ Wᵀ Jᵀ), sizes an instanced quad to 3σ along the eigenvectors
 * of Σ' and evaluates the Gaussian per pixel. Blended premultiplied over
 * the lit HDR image, faded against the depth buffer where it meets roofs,
 * lit by the sun with a forward-scattering phase and by the sky's SH.
 */

const STRIDE = 16;   // floats per instance: centre+opacity, cov xx xy xz, cov yy yz zz, albedo+shade, pad

const VS = /* glsl */`
in vec4 aCenter;     // xyz, opacity
in vec3 aCovA;       // xx xy xz
in vec3 aCovB;       // yy yz zz
in vec4 aColor;      // albedo, shade (0 = in the plume's own shadow, 1 = sunlit)
uniform mat4 uView, uViewProj;
uniform vec2 uFocal;           // P00 * W/2, P11 * H/2: pixels per unit at depth 1
uniform vec2 uResolution;
uniform vec3 uSunDir, uSunIrradiance, uCameraPos;
uniform vec3 uSkySH[9];
out vec2 vQ;
out float vAlpha, vDepth, vSoft;
out vec3 vColor;
void main() {
  const vec2 Q[6] = vec2[](vec2(-1, -1), vec2(1, -1), vec2(1, 1), vec2(-1, -1), vec2(1, 1), vec2(-1, 1));
  vec2 q = Q[gl_VertexID];
  vec4 vp = uView * vec4(aCenter.xyz, 1.0);
  float d = -vp.z;
  if (d < 0.2 || aCenter.w < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float near = clamp((d - 0.5) / 2.5, 0.0, 1.0);   // do not let a puff swallow the camera
  mat3 S = mat3(aCovA.x, aCovA.y, aCovA.z,  aCovA.y, aCovB.x, aCovB.y,  aCovA.z, aCovB.y, aCovB.z);
  mat3 W = mat3(uView);
  mat3 Sv = W * S * transpose(W);
  // the Jacobian of (x, y, z) -> (fx x / -z, fy y / -z), rows as columns of a 3x2
  vec3 j0 = vec3(uFocal.x / d, 0.0, uFocal.x * vp.x / (d * d));
  vec3 j1 = vec3(0.0, uFocal.y / d, uFocal.y * vp.y / (d * d));
  vec3 s0 = Sv * j0, s1 = Sv * j1;
  float a = dot(j0, s0) + 0.3, b = dot(j0, s1), c = dot(j1, s1) + 0.3;   // + a pixel's low-pass
  float mid = 0.5 * (a + c), rad = sqrt(max(0.25 * (a - c) * (a - c) + b * b, 0.0));
  float l1 = mid + rad, l2 = max(mid - rad, 0.1);
  vec2 v1 = abs(b) > 1e-6 ? normalize(vec2(b, l1 - a)) : (a >= c ? vec2(1, 0) : vec2(0, 1));
  vec2 v2 = vec2(-v1.y, v1.x);
  float cap = uResolution.y;
  vec2 off = q.x * 3.0 * min(sqrt(l1), cap) * v1 + q.y * 3.0 * min(sqrt(l2), cap) * v2;
  vec4 clip = uViewProj * vec4(aCenter.xyz, 1.0);
  clip.xy += off / (0.5 * uResolution) * clip.w;
  gl_Position = clip;
  vQ = q * 3.0;
  vDepth = d;
  vSoft = 1.0 / max(0.6 * sqrt(max(max(S[0][0], S[1][1]), S[2][2])), 0.05);
  vAlpha = aCenter.w * near;
  // light: sun through a Henyey-Greenstein lobe, sky from SH
  vec3 v = normalize(aCenter.xyz - uCameraPos);
  float g = 0.45, mu = dot(v, uSunDir);
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / (4.0 * PI);
  float iso = 1.0 / (4.0 * PI);
  vec3 sun = uSunIrradiance * aColor.w * mix(iso, hg, 0.6) * max(uSunDir.y * 3.0, 0.0) ;
  vec3 sky = shIrradiance(vec3(0.0, 1.0, 0.0), uSkySH) * (0.45 + 0.35 * aColor.w) / PI;
  vColor = aColor.rgb * (sun * 4.0 + sky);
}`;

const FS = /* glsl */`
in vec2 vQ;
in float vAlpha, vDepth, vSoft;
in vec3 vColor;
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform vec2 uResolution;
out vec4 o;
void main() {
  float g = exp(-0.5 * dot(vQ, vQ));
  float a = vAlpha * g;
  if (a < 1.0 / 255.0) discard;
  // fade where the puff meets geometry rather than cutting it with a hard line
  vec2 uv = gl_FragCoord.xy / uResolution;
  float z = texture(uDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  float scene = -p.z / p.w;
  a *= clamp((scene - vDepth) * vSoft, 0.0, 1.0);
  a = min(a, 0.98);
  o = vec4(vColor * a, a);
}`;

/** A small deterministic generator, so the smoke looks the same for every run of a test. */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class GaussianSplats {
  constructor({ max = 2400, range = 160 } = {}) {
    this.name = 'gaussianSplats';
    this.max = max;
    this.range = range;           // only sources within this distance of the camera smoke
    this.sources = [];
    this.windFn = null;
    this.enabled = true;
    this.time = 0;
    this.rand = rng(1403);
    // simulation state, struct of arrays
    const F = (n) => new Float32Array(max * n);
    this.pos = F(3); this.vel = F(3); this.rot = F(4); this.scale = F(3);
    this.age = F(1); this.life = F(1); this.alpha = F(1); this.grow = F(1); this.albedo = F(1);
    this.live = 0;
    this.order = new Uint32Array(max);
    this.keys = new Float32Array(max);
    this.inst = new Float32Array(max * STRIDE);
    GaussianSplats.active = this;
  }

  /** sources: [{ x, y, z, rate (puffs/s), size (m), dark (0..1) }] */
  setSources(list) { this.sources = list.map((s) => ({ rate: 2.5, size: 0.35, dark: 0.3, ...s, acc: this.rand() })); }

  init(r) {
    const gl = r.gl;
    this.gl = gl;
    this.prog = new Program(gl, COMMON + VS, FS, {}, 'gaussian-splats');
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    for (const [name, size, off] of [['aCenter', 4, 0], ['aCovA', 3, 4], ['aCovB', 3, 7], ['aColor', 4, 10]]) {
      const loc = this.prog.attribs.get(name);
      if (loc === undefined || loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _spawn(s) {
    if (this.live >= this.max) return;
    const i = this.live++, R = this.rand;
    const j = s.size * 0.5;
    this.pos.set([s.x + (R() - 0.5) * j, s.y + R() * 0.2, s.z + (R() - 0.5) * j], i * 3);
    this.vel.set([(R() - 0.5) * 0.3, 0.9 + R() * 0.6, (R() - 0.5) * 0.3], i * 3);
    // a random rotation (uniform quaternion) and an uneven puff
    const u1 = R(), u2 = R() * 2 * Math.PI, u3 = R() * 2 * Math.PI;
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    this.rot.set([a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)], i * 4);
    this.scale.set([s.size * (0.7 + R() * 0.6), s.size * (0.6 + R() * 0.5), s.size * (0.7 + R() * 0.6)], i * 3);
    this.age[i] = 0;
    this.life[i] = 7 + R() * 6;
    this.alpha[i] = (0.3 + R() * 0.15) * (0.8 + s.dark * 0.6);
    this.grow[i] = 0.35 + R() * 0.3;
    this.albedo[i] = 0.62 - s.dark * 0.35 + R() * 0.08;
  }

  _kill(i) {
    const k = --this.live;
    if (i === k) return;
    this.pos.copyWithin(i * 3, k * 3, k * 3 + 3);
    this.vel.copyWithin(i * 3, k * 3, k * 3 + 3);
    this.rot.copyWithin(i * 4, k * 4, k * 4 + 4);
    this.scale.copyWithin(i * 3, k * 3, k * 3 + 3);
    this.age[i] = this.age[k]; this.life[i] = this.life[k]; this.alpha[i] = this.alpha[k];
    this.grow[i] = this.grow[k]; this.albedo[i] = this.albedo[k];
  }

  simulate(dt, cam) {
    this.time += dt;
    const R2 = this.range * this.range;
    for (const s of this.sources) {
      const dx = s.x - cam.x, dz = s.z - cam.z;
      if (dx * dx + dz * dz > R2) continue;
      s.acc += s.rate * dt;
      while (s.acc >= 1) { s.acc -= 1; this._spawn(s); }
    }
    const w = this.windFn ? this.windFn(this.time, (this._w ??= { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } })) : { x: 0, y: 0, z: 0 };
    const P = this.pos, V = this.vel;
    for (let i = this.live - 1; i >= 0; i--) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) { this._kill(i); continue; }
      const o = i * 3;
      // buoyancy fades as the smoke cools; drag pulls it toward the wind, more so higher up
      const lift = 1.6 * Math.exp(-age * 0.5);
      const k = 1 - Math.exp(-dt * (0.25 + Math.min(age, 4) * 0.15));
      const t = this.time * 0.6 + i * 0.37;
      V[o] += (w.x * 0.55 + Math.sin(t) * 0.25 - V[o]) * k;
      V[o + 1] += (lift - V[o + 1]) * k + (Math.sin(t * 1.3) * 0.15) * dt;
      V[o + 2] += (w.z * 0.55 + Math.cos(t * 0.8) * 0.25 - V[o + 2]) * k;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
    }
  }

  /** Sort back to front and pack covariance, colour and opacity per splat. */
  _pack(r) {
    const n = this.live, cam = r.cameraPos, view = r.view.elements;
    const fx = -view[2], fy = -view[6], fz = -view[10];    // camera forward
    const ord = this.order, keys = this.keys;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const d = (this.pos[o] - cam.x) * fx + (this.pos[o + 1] - cam.y) * fy + (this.pos[o + 2] - cam.z) * fz;
      if (d < 0.2 - 3 * this.scale[o]) continue;
      keys[i] = d;
      ord[m++] = i;
    }
    const sub = ord.subarray(0, m);
    sub.sort((a, b) => keys[b] - keys[a]);
    const I = this.inst;
    for (let k = 0; k < m; k++) {
      const i = sub[k], o = i * 3, q = i * 4, f = k * STRIDE;
      const t = this.age[i] / this.life[i];
      const g = 1 + this.age[i] * this.grow[i] * 0.55;         // puffs spread as they rise
      const sx = this.scale[o] * g, sy = this.scale[o + 1] * g, sz = this.scale[o + 2] * g;
      // R from the quaternion; Σ = R diag(s²) Rᵀ
      const x = this.rot[q], y = this.rot[q + 1], z = this.rot[q + 2], w = this.rot[q + 3];
      const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
      const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
      const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
      const a = sx * sx, b = sy * sy, c = sz * sz;
      I[f] = this.pos[o]; I[f + 1] = this.pos[o + 1]; I[f + 2] = this.pos[o + 2];
      // fade in over the first moments, thin out as it spreads, gone at the end
      I[f + 3] = this.alpha[i] * Math.min(1, t * 12) * (1 - t) * (1 - t) / g;
      I[f + 4] = r00 * r00 * a + r01 * r01 * b + r02 * r02 * c;
      I[f + 5] = r00 * r10 * a + r01 * r11 * b + r02 * r12 * c;
      I[f + 6] = r00 * r20 * a + r01 * r21 * b + r02 * r22 * c;
      I[f + 7] = r10 * r10 * a + r11 * r11 * b + r12 * r12 * c;
      I[f + 8] = r10 * r20 * a + r11 * r21 * b + r12 * r22 * c;
      I[f + 9] = r20 * r20 * a + r21 * r21 * b + r22 * r22 * c;
      const alb = this.albedo[i] + t * 0.15;                  // young smoke is sooty, old smoke pale
      I[f + 10] = alb; I[f + 11] = alb * 0.98; I[f + 12] = alb * 0.95;
      I[f + 13] = 0.45 + 0.55 * Math.min(1, t * 2.5);         // the dense young plume shades itself
    }
    return m;
  }

  afterLighting(r, color) {
    const dt = Math.max(0, Math.min(r.dt ?? 1 / 60, 1 / 20));
    if (!this.enabled || !this.sources.length) return color;
    this.simulate(dt, r.cameraPos);
    const m = this._pack(r);
    if (!m) return color;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, m * STRIDE);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    r.hdr.bind();
    state(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const P = r.proj.elements;
    const si = r.sunIntensity ?? 1, sc = r.sunColor;
    this.prog.use()
      .set('uView', r.view).set('uViewProj', r.viewProjJit).set('uInvProj', r.invProj)
      .set('uFocal', [P[0] * r.width * 0.5, P[5] * r.height * 0.5]).set('uResolution', [r.width, r.height])
      .set('uSunDir', r.sunDir).set('uSunIrradiance', [sc.x * si, sc.y * si, sc.z * si]).set('uCameraPos', r.cameraPos)
      .set('uSkySH', r.env.sh).set('uDepth', r.depth);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, m);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return color;
  }
}
GaussianSplats.active = null;
