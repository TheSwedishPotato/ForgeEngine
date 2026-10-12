/**
 * The engine's breath, as physics, drawn as 3D Gaussian splats.
 *
 * Every exhaust beat of the low-pressure cylinders leaves the chimney as a few puffs carrying its
 * steam (and the flue gas the blast drags out of the smokebox). A puff is a turbulent thermal: it
 * entrains the air it moves through, so its size grows with its path through the air (σ by
 * α ≈ 0.11 of the path; a thermal's radius ~0.2-0.25), while its momentum relative to the air is
 * shared out over the growing mass (u ∝ 1/σ³). So a blast leaving at 50-90 m/s is stopped within
 * a second some 5-10 m up, a puff of a metre or so, and from then on it drifts with the wind,
 * rising while the dilution leaves it any warmth.
 *
 * Whether it shows is a matter of water. The steam leaves hot and unsaturated, so it is clear
 * just above the chimney; as the cold air dilutes it, the mixture's capacity for vapour falls
 * faster than its vapour, and the excess condenses to a cloud of fine droplets; when the puff has
 * mixed with so much air that the air's own saturation deficit takes it all up, it is gone
 * (the mixing line: condensed = steam + V·ρv,air − V·ρsat(T_mix)). In saturated freezing fog the
 * plume hangs for a minute; in the dry föhn it vanishes a few metres above the chimney. Its
 * opacity is the droplets' extinction (k ≈ 300 m²/kg for droplets of ~5 µm), its light the sun
 * through the mountains' shadow, the valley fog and the plume itself (a sun-aligned grid of
 * optical depth), the sky above and the snow below, darkened by coal smoke when the fire is fresh.
 *
 * The safety valves roar up from the firebox top, the drain cocks spit sideways at the cylinders
 * when starting, the blower keeps a thin stream going at a stand, the whistle has its own cloud.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';
import { TERRAIN_LIGHT_GLSL, GROUND_GLSL } from './terrainLight.js';

const G = 9.81;
const C_GAUSS = Math.pow(2 * Math.PI, 1.5);   // the volume of a Gaussian puff, per σ³ (15.75)
const ALPHA = 0.11;          // entrainment: dσ per metre of path through the air
const K_EXT = 300;           // m²/kg, extinction of condensed droplets (1.5 / (ρw r), r ≈ 5 µm)
const B0 = 0.55;             // buoyancy of undiluted exhaust in cold air, (ρair − ρ) / ρair
const DIFFUSE = 0.75 * (1 - 0.85);   // 3/4 (1 - g) for cloud droplets
const V_STEAM = 1.75;        // m³/kg, exhaust steam at the chimney (about 0.95 bar, 100 °C)
const MAX = 3200;
const STRIDE = 16;

/** Saturation vapour density over water (kg/m³) at T (°C): Magnus (Alduchov & Eskridge 1996). */
export function rhoSat(T) { return (611.2 * Math.exp((17.62 * T) / (243.12 + T))) / (461.5 * (T + 273.15)); }

/** Relative humidity of the air in each weather (typical December values for the Reuss valley). */
const RH = { clear: 0.85, snowfall: 0.95, heavy: 0.97, foehn: 0.4, fog: 1.0, blizzard: 0.9 };

const VS = /* glsl */`
${COMMON}
uniform vec3 uSunDir;
${TERRAIN_LIGHT_GLSL}
${GROUND_GLSL}
in vec4 aCenter;     // xyz, optical depth through the centre
in vec3 aCovA;       // xx xy xz
in vec3 aCovB;       // yy yz zz
in vec4 aLight;      // -, smoke, sun left after the plume between, sky left after the plume above
uniform mat4 uView, uViewProj;
uniform vec2 uFocal;
uniform vec2 uResolution;
uniform vec3 uSunIrradiance, uCameraPos;
uniform vec3 uSkySH[9];
uniform float uFogExt;
out vec2 vQ, vAx;
out float vTau, vFade, vDepth, vSoft, vFwd, vSeed;
out vec3 vSun, vSkyUp, vSkyDown, vLv;
void main() {
  const vec2 Q[6] = vec2[](vec2(-1, -1), vec2(1, -1), vec2(1, 1), vec2(-1, -1), vec2(1, 1), vec2(-1, 1));
  vec2 q = Q[gl_VertexID];
  vec4 vp = uView * vec4(aCenter.xyz, 1.0);
  float d = -vp.z;
  if (d < 0.2 || aCenter.w < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float near = clamp((d - 0.5) / 2.5, 0.0, 1.0);
  // EWA: the covariance projected to the screen (Σ' = J W Σ Wᵀ Jᵀ), a quad to 3σ along its axes
  mat3 S = mat3(aCovA.x, aCovA.y, aCovA.z,  aCovA.y, aCovB.x, aCovB.y,  aCovA.z, aCovB.y, aCovB.z);
  mat3 W = mat3(uView);
  mat3 Sv = W * S * transpose(W);
  vec3 j0 = vec3(uFocal.x / d, 0.0, uFocal.x * vp.x / (d * d));
  vec3 j1 = vec3(0.0, uFocal.y / d, uFocal.y * vp.y / (d * d));
  vec3 s0 = Sv * j0, s1 = Sv * j1;
  float a = dot(j0, s0) + 0.3, b = dot(j0, s1), c = dot(j1, s1) + 0.3;
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
  vAx = v1;
  vDepth = d;
  vSoft = 1.0 / max(0.6 * sqrt(max(max(S[0][0], S[1][1]), S[2][2])), 0.05);
  vTau = aCenter.w;
  vSeed = aLight.x;
  vFade = near * exp(-uFogExt * d);          // seen through the fog and the falling snow
  // light: the sun past the mountains, out of a tunnel, through the valley fog and the plume
  vec3 wpos = aCenter.xyz;
  float day = daylightAt(wpos);
  vec3 alb = mix(vec3(0.92), vec3(0.42, 0.40, 0.38), aLight.y);
  vSun = uSunIrradiance * (terrainSun(wpos) * fogSun(wpos) * day * aLight.z) * alb * INV_PI;
  float sky = day * skyLightScale(wpos);
  vSkyUp = shIrradiance(vec3(0.0, 1.0, 0.0), uSkySH) * sky * (0.35 + 0.65 * aLight.w) * alb * INV_PI;
  vSkyDown = shIrradiance(vec3(0.0, -1.0, 0.0), uSkySH) * sky * alb * INV_PI;
  // forward scattering of the thin parts (Henyey-Greenstein g = 0.6, relative to isotropic)
  float mu = dot(normalize(wpos - uCameraPos), uSunDir), g = 0.6;
  vFwd = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
  vLv = mat3(uView) * uSunDir;
}`;

const FS = /* glsl */`
${COMMON}
in vec2 vQ, vAx;
in float vTau, vFade, vDepth, vSoft, vFwd, vSeed;
in vec3 vSun, vSkyUp, vSkyDown, vLv;
uniform sampler2D uDepth;
uniform mat4 uInvProj, uView;
uniform vec2 uResolution;
uniform float uTime;
out vec4 o;
void main() {
  // the turbulent billows of the puff: its density uneven at every scale, boiling slowly
  vec3 np = vec3(vQ * 1.05, vSeed * 37.0 + uTime * 0.12);
  float f = vnoise3(np) * 0.5 + vnoise3(np * 2.1 + 5.3) * 0.28 + vnoise3(np * 4.4 + 9.1) * 0.14 + vnoise3(np * 9.0 + 2.7) * 0.08;
  float tau = vTau * exp(-0.5 * dot(vQ, vQ)) * (0.1 + 1.8 * f);
  float a = (1.0 - exp(-tau)) * vFade;
  if (a < 1.0 / 255.0) discard;
  vec2 uv = gl_FragCoord.xy / uResolution;
  float z = texture(uDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  a *= clamp((-p.z / p.w - vDepth) * vSoft, 0.0, 1.0);
  a = min(a, 0.985);
  // a dense puff has a lit side and a shaded side: its surface as a sphere (view space)
  vec2 s = vQ / 2.3;
  vec2 sv = s.x * vAx + s.y * vec2(-vAx.y, vAx.x);
  vec3 n = normalize(vec3(sv, sqrt(max(0.0, 1.0 - dot(sv, sv)))));
  float dense = smoothstep(0.8, 5.0, vTau);
  // the sun on this side of the puff, diffused through it from its sunward surface (and lumpy)
  float path = vTau * (1.0 - dot(n, vLv)) * (1.3 - 0.6 * f);
  float lit = mix(0.85, 1.15 / (1.0 + ${(0.75 * 0.15).toFixed(4)} * path), dense);
  float thin = exp(-tau);
  vec3 sun = vSun * (lit + 0.25 * max(vFwd - 1.0, 0.0) * thin);
  vec3 nw = transpose(mat3(uView)) * n;
  vec3 sky = mix(vSkyDown, vSkyUp, clamp(0.5 + 0.5 * mix(0.6, nw.y, dense), 0.0, 1.0));
  o = vec4((sun + sky) * a, a);
}`;

/** A small deterministic generator, so a run looks the same every time. */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class SteamPlume {
  constructor(stage) {
    this.name = 'steam';
    this.enabled = true;
    this.stage = stage;
    this.max = MAX;
    this.rand = rng(1415);
    const F = (n) => new Float32Array(MAX * n);
    this.pos = F(3); this.u = F(3); this.rot = F(4); this.an = F(3);
    this.sig = F(1); this.m = F(1); this.V0 = F(1); this.T0 = F(1); this.smoke = F(1);
    this.age = F(1); this.life = F(1); this.mw = F(1); this.tau = F(1);
    this.tSun = F(1); this.tUp = F(1); this.seed = F(1);
    this.live = 0;
    this.inst = new Float32Array(MAX * STRIDE);
    this.order = new Uint32Array(MAX); this.keys = new Float32Array(MAX);
    this._A = new Float32Array(MAX); this._B = new Float32Array(MAX); this._D = new Float32Array(MAX); this._ord = new Uint32Array(MAX);
    this._grid = new Float32Array(100 * 100);
    // the air: wind (world, m/s), temperature (°C), relative humidity, fog extinction
    this.wind = { x: 0, y: 0, z: 0 };
    this.air = { x: 0, y: 0, z: 0 };
    this.tempC = -3; this.rh = 0.85; this.fogExt = 0;
  }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'steam');
    this.copy = postProgram(gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'steam-copy');
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    for (const [name, size, off] of [['aCenter', 4, 0], ['aCovA', 3, 4], ['aCovB', 3, 7], ['aLight', 4, 10]]) {
      const loc = this.prog.attribs.get(name);
      if (loc === undefined || loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  setWeather(weather) {
    const p = weather.p;
    const a = ((p.windFrom ?? 0) * Math.PI) / 180, w = p.wind ?? 0;
    this.wind = { x: -Math.sin(a) * w, y: 0, z: Math.cos(a) * w };
    this.air = { ...this.wind };
    this.rh = RH[p.id] ?? 0.85;
    this.rhOpen = this.rh;
    this.tempC = p.tempErstfeld ?? 0;
    this.fogExt = p.fog || (p.snowfall ?? 0) > 0 ? 3.912 / Math.max(50, p.visibility ?? 1e5) : 0;
  }

  /** The air where the engine is: temperature, and in a tunnel the air the train pushes ahead of it. */
  setAir(tempC, tunnel, trainVel) {
    this.tempC = tempC;
    if (tunnel) {
      // the piston effect: in the tube the air moves with the train at a good part of its speed
      this.air = { x: trainVel.x * 0.4, y: 0, z: trainVel.z * 0.4 };
      this.rh = 0.95;
    } else {
      this.air = { ...this.wind };
      this.rh = this.rhOpen ?? this.rh;
    }
  }

  /** Moves every puff with the floating origin. */
  shift(dx, dy, dz) {
    for (let i = 0; i < this.live; i++) { this.pos[i * 3] += dx; this.pos[i * 3 + 1] += dy; this.pos[i * 3 + 2] += dz; }
  }

  /**
   * One puff: world position p, absolute velocity v (m/s), its steam m (kg). gas: the volume it has
   * already taken up of flue gas or air, as a multiple of the steam's own; T0 its temperature (°C);
   * smoke 0..1.
   */
  puff(p, v, m, { gas = 1.5, T0 = 125, smoke = 0, jitter = 0.15 } = {}) {
    if (this.live >= MAX || m <= 0) return;
    const i = this.live++, R = this.rand, o = i * 3;
    const V0 = m * V_STEAM * gas;
    const s0 = Math.cbrt(V0 / C_GAUSS);
    this.pos.set([p.x + (R() - 0.5) * jitter, p.y + (R() - 0.5) * jitter, p.z + (R() - 0.5) * jitter], o);
    this.u.set([v.x - this.air.x, v.y - this.air.y, v.z - this.air.z], o);
    const u1 = R(), u2 = R() * 2 * Math.PI, u3 = R() * 2 * Math.PI, a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    this.rot.set([a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)], i * 4);
    this.an.set([0.8 + R() * 0.4, 0.75 + R() * 0.35, 0.8 + R() * 0.4], o);
    this.sig[i] = s0; this.m[i] = m; this.V0[i] = V0; this.T0[i] = T0; this.smoke[i] = smoke;
    this.age[i] = 0; this.life[i] = 50 + R() * 20; this.mw[i] = 0; this.tau[i] = 0;
    this.tSun[i] = 1; this.tUp[i] = 1; this.seed[i] = R();
  }

  _kill(i) {
    const k = --this.live;
    if (i === k) return;
    for (const [A, n] of [[this.pos, 3], [this.u, 3], [this.rot, 4], [this.an, 3]]) A.copyWithin(i * n, k * n, k * n + n);
    for (const A of [this.sig, this.m, this.V0, this.T0, this.smoke, this.age, this.life, this.mw, this.tau, this.tSun, this.tUp, this.seed]) A[i] = A[k];
  }

  /** Entrainment, buoyancy, the wind, condensation and evaporation (see the head of the file). */
  simulate(dt, cam) {
    const P = this.pos, U = this.u, w = this.air;
    const Ta = this.tempC, rhoV = this.rh * rhoSat(Ta);
    const D = 0.03 + 0.006 * Math.hypot(w.x, w.z);         // ambient turbulence (m/s of σ)
    for (let i = this.live - 1; i >= 0; i--) {
      const age = (this.age[i] += dt);
      const o = i * 3;
      let s = this.sig[i];
      // buoyancy: the warmth and the light vapour, both diluted by the air taken in
      const dil = this.V0[i] / (C_GAUSS * s * s * s);
      U[o + 1] += G * B0 * dil * dt;
      // entrainment: σ⁴ grows by 4 α |u| σ³ dt (u σ³ is conserved), the path is Δσ / α
      const sp = Math.hypot(U[o], U[o + 1], U[o + 2]);
      if (sp > 1e-4) {
        const s2 = Math.pow(s * s * s * s + 4 * ALPHA * sp * s * s * s * dt, 0.25);
        const k = (s2 - s) / ALPHA / sp;
        P[o] += U[o] * k; P[o + 1] += U[o + 1] * k; P[o + 2] += U[o + 2] * k;
        const r = (s / s2) ** 3;
        U[o] *= r; U[o + 1] *= r; U[o + 2] *= r;
        s = s2;
      }
      // the air's own turbulence, and its drift
      const s3 = s + D * dt, r3 = (s / s3) ** 3;
      U[o] *= r3; U[o + 1] *= r3; U[o + 2] *= r3;
      s = s3;
      this.sig[i] = s;
      P[o] += w.x * dt; P[o + 1] += w.y * dt; P[o + 2] += w.z * dt;
      // the water: what the mixture cannot hold at its temperature (latent heat keeps a little back)
      const V = C_GAUSS * s * s * s, Tm = Ta + (this.T0[i] - Ta) * (this.V0[i] / V);
      const mw = Math.max(0, this.m[i] + V * rhoV - V * rhoSat(Tm)) * 0.85;
      this.mw[i] = mw;
      this.tau[i] = (K_EXT * mw) / (2 * Math.PI * s * s);
      const dx = P[o] - cam.x, dz = P[o + 2] - cam.z;
      if (age > this.life[i] || (age > 1.2 && this.tau[i] < 0.004) || dx * dx + dz * dz > 4e6) this._kill(i);
    }
  }

  /**
   * Optical depth of the plume between each puff and a light from direction L (unit, world):
   * the puffs projected on a plane across L, taken nearest the light first, each reading the
   * depth gathered so far under it, then laying down its own (a Gaussian column).
   */
  _shade(L, out) {
    const n = this.live, P = this.pos;
    if (!n) return;
    const ux = Math.abs(L.y) < 0.9 ? 0 : 1, uy = 1 - ux;
    let e1x = L.y * 0 - L.z * uy, e1y = L.z * ux - L.x * 0, e1z = L.x * uy - L.y * ux;   // L × up
    const l1 = Math.hypot(e1x, e1y, e1z) || 1; e1x /= l1; e1y /= l1; e1z /= l1;
    const e2x = L.y * e1z - L.z * e1y, e2y = L.z * e1x - L.x * e1z, e2z = L.x * e1y - L.y * e1x;
    const A = this._A, B = this._B, Dp = this._D, ord = this._ord;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      A[i] = x * e1x + y * e1y + z * e1z; B[i] = x * e2x + y * e2y + z * e2z; Dp[i] = x * L.x + y * L.y + z * L.z;
      a0 = Math.min(a0, A[i]); a1 = Math.max(a1, A[i]); b0 = Math.min(b0, B[i]); b1 = Math.max(b1, B[i]);
      ord[i] = i;
    }
    const N = 96, h = Math.max(0.6, (a1 - a0) / (N - 6), (b1 - b0) / (N - 6));
    const nx = Math.min(N, Math.ceil((a1 - a0) / h) + 6), ny = Math.min(N, Math.ceil((b1 - b0) / h) + 6);
    const grid = this._grid; grid.fill(0, 0, nx * ny);
    const ox = a0 - 3 * h, oy = b0 - 3 * h;
    const sub = ord.subarray(0, n);
    sub.sort((p, q) => Dp[q] - Dp[p]);
    for (let k = 0; k < n; k++) {
      const i = sub[k];
      const fx = (A[i] - ox) / h - 0.5, fy = (B[i] - oy) / h - 0.5;
      const ix = Math.max(0, Math.min(nx - 2, Math.floor(fx))), iy = Math.max(0, Math.min(ny - 2, Math.floor(fy)));
      const tx = Math.min(1, Math.max(0, fx - ix)), ty = Math.min(1, Math.max(0, fy - iy));
      const g0 = grid[iy * nx + ix], g1 = grid[iy * nx + ix + 1], g2 = grid[(iy + 1) * nx + ix], g3 = grid[(iy + 1) * nx + ix + 1];
      out[i] = (g0 + (g1 - g0) * tx) * (1 - ty) + (g2 + (g3 - g2) * tx) * ty;
      const t = this.tau[i];
      if (t < 0.01) continue;
      const s = this.sig[i], r = Math.min(6, Math.ceil((2.2 * s) / h));
      const cx = Math.round(fx), cy = Math.round(fy), inv = (h * h) / (2 * s * s);
      for (let y = Math.max(0, cy - r); y <= Math.min(ny - 1, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(nx - 1, cx + r); x++) {
          const dx = x - fx, dy = y - fy;
          grid[y * nx + x] += t * Math.exp(-(dx * dx + dy * dy) * inv);
        }
      }
    }
  }

  /** Back to front, with each puff's covariance, optical depth and light. */
  _pack(r) {
    const n = this.live, cam = r.cameraPos, view = r.view.elements;
    const sd = r.sunDir;
    this._shade({ x: sd.x, y: sd.y, z: sd.z }, this.tSun);
    this._shade({ x: 0, y: 1, z: 0 }, this.tUp);
    const fx = -view[2], fy = -view[6], fz = -view[10];
    const ord = this.order, keys = this.keys;
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (this.tau[i] < 0.004) continue;
      const o = i * 3;
      const d = (this.pos[o] - cam.x) * fx + (this.pos[o + 1] - cam.y) * fy + (this.pos[o + 2] - cam.z) * fz;
      if (d < 0.2 - 3 * this.sig[i]) continue;
      keys[i] = d;
      ord[m++] = i;
    }
    const sub = ord.subarray(0, m);
    sub.sort((a, b) => keys[b] - keys[a]);
    const I = this.inst;
    for (let k = 0; k < m; k++) {
      const i = sub[k], o = i * 3, q = i * 4, f = k * STRIDE;
      const s = this.sig[i];
      const sx = s * this.an[o], sy = s * this.an[o + 1], sz = s * this.an[o + 2];
      const x = this.rot[q], y = this.rot[q + 1], z = this.rot[q + 2], w = this.rot[q + 3];
      const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
      const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
      const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
      const a = sx * sx, b = sy * sy, c = sz * sz;
      I[f] = this.pos[o]; I[f + 1] = this.pos[o + 1]; I[f + 2] = this.pos[o + 2];
      // (the anisotropy changes the volume a little; the optical depth keeps to the mean σ)
      I[f + 3] = this.tau[i];
      I[f + 4] = r00 * r00 * a + r01 * r01 * b + r02 * r02 * c;
      I[f + 5] = r00 * r10 * a + r01 * r11 * b + r02 * r12 * c;
      I[f + 6] = r00 * r20 * a + r01 * r21 * b + r02 * r22 * c;
      I[f + 7] = r10 * r10 * a + r11 * r11 * b + r12 * r12 * c;
      I[f + 8] = r10 * r20 * a + r11 * r21 * b + r12 * r22 * c;
      I[f + 9] = r20 * r20 * a + r21 * r21 * b + r22 * r22 * c;
      I[f + 10] = this.seed[i];
      I[f + 11] = this.smoke[i] * Math.exp(-this.age[i] / 25);
      // the droplets hardly absorb: light diffuses on through the plume rather than dying in it
      // (two-stream diffusion for conservative scattering, T = 1 / (1 + 3/4 (1 - g) τ), g ≈ 0.85)
      I[f + 12] = 1 / (1 + DIFFUSE * this.tSun[i]);
      I[f + 13] = 1 / (1 + DIFFUSE * this.tUp[i]);
    }
    return m;
  }

  afterLighting(r, color) {
    const dt = Math.max(0, Math.min(r.dt ?? 1 / 60, 1 / 20));
    if (!this.enabled) return color;
    this.simulate(dt, r.cameraPos);
    if (!this.live) return color;
    const m = this._pack(r);
    if (!m) return color;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, m * STRIDE);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    // drawn over the finished, anti-aliased image (the puffs are smooth; they carry no motion
    // vectors, so the temporal filter would only smear them)
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const P = r.proj.elements, W = r.displayW, H = r.displayH;
    const si = r.sunIntensity ?? 1, sc = r.sunColor;
    const prog = this.prog.use();
    prog.set('uView', r.view).set('uViewProj', r.viewProj).set('uInvProj', r.invProj)
      .set('uFocal', [P[0] * W * 0.5, P[5] * H * 0.5]).set('uResolution', [W, H])
      .set('uSunDir', r.sunDir).set('uSunIrradiance', [sc.x * si, sc.y * si, sc.z * si]).set('uCameraPos', r.cameraPos)
      .set('uSkySH', r.env.sh).set('uDepth', r.depth).set('uFogExt', this.fogExt).set('uTime', (this.time = (this.time ?? 0) + dt));
    this.stage.bindGround?.(prog);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, m);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}

/**
 * Feeds the plume from the engine each frame: the beats from the physics' queue, and the steady
 * flows (safety valves, blower, drain cocks, whistle). loco: the engine's physics; model: its
 * Object3D (whose matrixWorld places the chimney); vel: the engine's velocity in the world (m/s).
 */
export function feedSteam(plume, loco, model, vel, dt) {
  const q = loco.queue ?? [];
  const o = loco.out, c = loco.c;
  const M = model.matrixWorld.elements;
  const at = (x, y, z) => ({ x: M[0] * x + M[4] * y + M[8] * z + M[12], y: M[1] * x + M[5] * y + M[9] * z + M[13], z: M[2] * x + M[6] * y + M[10] * z + M[14] });
  const up = { x: M[4], y: M[5], z: M[6] }, side = { x: M[8], y: M[9], z: M[10] }, fwd = { x: M[0], y: M[1], z: M[2] };
  const smoke = Math.min(0.8, (o.smoke ?? 0) ** 2 * 0.7);   // grey only just after a round of firing
  const R = plume.rand;
  // the chimney top (engine coordinates: x forward from the middle, y up from the rail, z right)
  const chimney = at(6.3425 - 1.75, 4.55, 0);
  const blastV = (strength) => Math.max(6, Math.min(90, 0.4 * Math.sqrt((2 * Math.max(0, strength) * 1e5) / 0.6)));
  // the queue is shared (the sound reads it too): take the beats newer than the last one seen
  const last = plume._lastBeat ?? 0;
  for (const ev of q) {
    if (!(ev.n > last)) continue;
    plume._lastBeat = ev.n;
    if (ev.type !== 'beat' || (loco.time ?? 0) - (ev.t ?? 0) > 0.5) continue;   // (not the backlog of a skip)
    const m = Math.max(0.01, ev.mass ?? 0.1), vb = blastV(ev.strength ?? 0.2);
    // the beat as a short column: the head of the blast fastest
    for (const [share, k, dy] of [[0.4, 1.0, 0.0], [0.35, 0.78, 0.12], [0.25, 0.55, 0.25]]) {
      const p = { x: chimney.x + up.x * dy, y: chimney.y + up.y * dy, z: chimney.z + up.z * dy };
      const v = vb * k * (0.9 + R() * 0.2);
      plume.puff(p, { x: vel.x + up.x * v + (R() - 0.5) * 2, y: vel.y + up.y * v, z: vel.z + up.z * v + (R() - 0.5) * 2 }, m * share, { smoke });
    }
  }
  // the blower and the air pump's exhaust, up the chimney when the regulator is shut
  const blow = (0.09 * (c.blower ?? 0) + 0.035 * (c.airPump ?? 0) * (loco.pumpOn ? 1 : 0)) * (c.regulator < 0.1 ? 1 : 0);
  plume._blow = (plume._blow ?? 0) + blow * dt;
  while (plume._blow > 0.012) {
    plume._blow -= 0.012;
    plume.puff(chimney, { x: vel.x + up.x * 18, y: vel.y + up.y * 18, z: vel.z + up.z * 18 }, 0.012, { smoke: smoke * 0.7 });
  }
  // the safety valves on the firebox top: boiler steam, a roaring jet straight up
  const sv = o.svFlow ?? 0;
  if (sv > 0) {
    plume._sv = (plume._sv ?? 0) + sv * dt;
    const valves = at(6.3425 - 9.3, 4.2, 0);
    while (plume._sv > 0.06) {
      plume._sv -= 0.06;
      plume.puff(valves, { x: vel.x + up.x * 70, y: vel.y + up.y * 70, z: vel.z + up.z * 70 }, 0.06, { gas: 1.1, T0: 115, jitter: 0.3 });
    }
  }
  // the drain cocks: wet steam and water spat out sideways and a little forward at the cylinders,
  // in bursts with the piston strokes; the flashing water makes it big and white at once
  const dr = c.drainCocks ? o.drainFlow ?? 0 : 0;
  if (dr > 0.002) {
    plume._dc = (plume._dc ?? 0) + dr * dt;
    while (plume._dc > 0.024) {
      plume._dc -= 0.024;
      for (const s of [-1, 1]) {
        const p = at(6.3425 - 1.1 + (R() - 0.5) * 0.3, 0.65 + R() * 0.2, s * 1.3);
        const v = 14 + R() * 14, up = (R() - 0.3) * 0.5, ahead = 0.15 + R() * 0.45;
        plume.puff(p, { x: vel.x + (side.x * s + fwd.x * ahead) * v, y: vel.y + up * v, z: vel.z + (side.z * s + fwd.z * ahead) * v }, 0.012, { gas: 3, T0: 100, jitter: 0.15 });
      }
    }
  }
  // the whistle
  const wh = o.whistleFlow ?? 0;
  if (wh > 0.005) {
    plume._wh = (plume._wh ?? 0) + wh * dt;
    const wpos = at(6.3425 - 9.75, 4.25, 0.35);
    while (plume._wh > 0.008) { plume._wh -= 0.008; plume.puff(wpos, { x: vel.x + up.x * 25, y: vel.y + up.y * 25, z: vel.z + up.z * 25 }, 0.008, { gas: 1.1, T0: 110, jitter: 0.1 }); }
  }
}
