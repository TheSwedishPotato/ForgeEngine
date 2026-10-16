/**
 * The boat's own waves: the sea's free surface solved round her as a fluid, not drawn.
 *
 * Potential flow under a free surface (incompressible, irrotational: Laplace's equation in the
 * water, which is the Navier-Stokes equations for an inviscid sea), linearised at the surface:
 *   d(eta)/dt = dphi/dz,   d(phi)/dt = -g eta - p/rho
 * Solved spectrally on a 256 m square that travels with her: each Fourier mode of wavenumber k
 * oscillates at its deep-water frequency w = sqrt(g k), advanced exactly over the step, so the
 * dispersion is right at every length and the Kelvin wedge (19.47 degrees half-angle), the
 * transverse waves at lambda = 2 pi U^2 / g and the bow and stern wave systems come out of the
 * equations by themselves. The hull forces it as a moving pressure (Havelock): over her
 * waterplane the head of water she displaces, a submerged hull's influence fading as exp(-k d)
 * with its depth d. (Her wave-making drag is already in her resistance; this is what you see.)
 *
 * Breaking: where the wave face steepens towards the Stokes limit (slope ~0.44) it breaks and
 * leaves foam, which drifts where it fell and fades over seconds. The screws' wash brings foam up
 * astern when she is on the surface. Spray: the bow throws it when she drives into the sea,
 * most when she slams into a wave; a raised periscope trails its feather.
 */
import { sectionAt } from '../physics/hull.js';
import { HULL, FT, frameX } from '../data/boat.js';
import { qrot } from '../physics/vec.js';

const G = 9.81;
const N = 128, DX = 2.0, L = N * DX;
const H = 1 / 15;                 // the wave solver's step (s); exact per mode, so stable at any step
const SPONGE = 14;                // cells at the edges where the waves die away (the open sea beyond)
const TAU_FOAM = 8;               // foam's life (s)
const YA = HULL.axisY;

// ---- the hull, station by station: half-breadth b, keel yk, top yt, height of greatest breadth yb (m)
const STATIONS = [];
for (let xf = -161; xf <= 152; xf += 1) {
  const s = sectionAt(xf, 32);
  if (!s) { STATIONS.push(null); continue; }
  let b = 0, yb = 0, yk = 1e9, yt = -1e9;
  for (const [z, y] of s) { if (z > b) { b = z; yb = y; } yk = Math.min(yk, y); yt = Math.max(yt, y); }
  STATIONS.push({ b: b * FT, yk: yk * FT, yt: yt * FT, yb: yb * FT });
}
function station(xm) {
  const i = Math.round(xm / FT) + 161;
  return i >= 0 && i < STATIONS.length ? STATIONS[i] : null;
}
const SAIL = { x0: frameX(62.5), x1: frameX(44.5), b: 1.55, y0: 23 * FT, y1: HULL.bridgeDeck + 1.15 };
const SCOPES = [10.85, 9.75];

// ---- a radix-2 FFT, N x N, in place on (re, im)
const LOG = Math.log2(N);
const REV = new Uint16Array(N);
for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < LOG; b++) r |= ((i >> b) & 1) << (LOG - 1 - b); REV[i] = r; }
const COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / N); SIN[i] = Math.sin((2 * Math.PI * i) / N); }
function fft1(re, im, off, stride, inv) {
  for (let i = 0; i < N; i++) {
    const j = REV[i];
    if (j > i) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step], wi = inv ? SIN[k * step] : -SIN[k * step];
        const a = off + (s + k) * stride, b = off + (s + k + half) * stride;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}
function fft2(re, im, inv) {
  for (let r = 0; r < N; r++) fft1(re, im, r * N, 1, inv);
  for (let c = 0; c < N; c++) fft1(re, im, c, N, inv);
  if (inv) { const s = 1 / (N * N); for (let i = 0; i < N * N; i++) { re[i] *= s; im[i] *= s; } }
}

export class Wake {
  constructor() {
    this.N = N; this.dx = DX; this.L = L;
    this.eta = new Float64Array(N * N); this.phi = new Float64Array(N * N);
    this.P = new Float64Array(N * N); this.Ps = new Float64Array(N * N);
    this.foam = new Float32Array(N * N);
    this.re = new Float64Array(N * N); this.im = new Float64Array(N * N);
    this.pr = new Float64Array(N * N); this.pi = new Float64Array(N * N);
    this.tex = new Float32Array(N * N * 4);           // for the renderer: height, d/dX, d/dZ, foam
    this.o = null;                                     // world X, Z of cell (0, 0)
    this.acc = 0;
    this.spray = [];                                   // [X, Y, Z, vx, vy, vz] thrown this frame (world)
    this.version = 0;
    // the modes: frequency and the grid's filter on the shortest (unresolved) waves
    this.w = new Float64Array(N * N); this.kk = new Float64Array(N * N); this.damp = new Float64Array(N * N);
    const kN = Math.PI / DX;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const kx = (2 * Math.PI / L) * (i < N / 2 ? i : i - N), kz = (2 * Math.PI / L) * (j < N / 2 ? j : j - N);
      const k = Math.hypot(kx, kz), n = j * N + i;
      this.kk[n] = k; this.w[n] = Math.sqrt(G * k);
      // viscous decay 2 nu k^2 (tiny) and a filter at the grid's limit
      this.damp[n] = Math.exp(-H * (2 * 1.0e-6 * k * k + 0.6 * (k / kN) ** 6));
    }
    this.edge = new Float64Array(N);
    for (let i = 0; i < N; i++) { const d = Math.min(i, N - 1 - i); this.edge[i] = d >= SPONGE ? 1 : 1 - 0.18 * (1 - d / SPONGE) ** 2; }
    this.stemY = null;
  }

  /** Advances the surface by dt with the boat dyn (pos, q, v), her plant (screws, periscopes) and the sea. */
  step(dt, dyn, plant, sea) {
    this.spray.length = 0;
    this.vw = qrot(dyn.q, dyn.v);                     // her velocity over the ground (world)
    const fwd = qrot(dyn.q, [1, 0, 0]), stb = qrot(dyn.q, [0, 0, 1]);
    const fh = Math.hypot(fwd[0], fwd[2]) || 1, fx = fwd[0] / fh, fz = fwd[2] / fh;
    this._follow(dyn.pos[0] - fx * 50, dyn.pos[2] - fz * 50);
    this.acc += dt;
    let n = 0;
    while (this.acc >= H && n < 2) { this._solve(dyn, plant, fx, fz, fwd, stb); this.acc -= H; n++; }
    if (this.acc > H) this.acc = 0;                     // (time running fast: let the waves lag rather than the frame)
    if (n) this._texture();
    this._spray(dt, dyn, plant, sea, fx, fz, fwd);
  }

  /** Keeps the square round her: rolls the grid by whole cells, the sea coming in calm. */
  _follow(cx, cz) {
    const ox = cx - L / 2, oz = cz - L / 2;
    if (!this.o) { this.o = [Math.round(ox / DX) * DX, Math.round(oz / DX) * DX]; return; }
    const di = Math.round((ox - this.o[0]) / DX), dj = Math.round((oz - this.o[1]) / DX);
    if (!di && !dj) return;
    if (Math.abs(di) >= N || Math.abs(dj) >= N) { this.eta.fill(0); this.phi.fill(0); this.foam.fill(0); }
    else for (const A of [this.eta, this.phi, this.foam]) {
      const B = Float64Array.from(A);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const si = i + di, sj = j + dj;
        A[j * N + i] = si >= 0 && si < N && sj >= 0 && sj < N ? B[sj * N + si] : 0;
      }
    }
    this.o[0] += di * DX; this.o[1] += dj * DX;
  }

  /** The pressure head (m of water) she puts on the surface, cell by cell. */
  _pressure(dyn, fx, fz, fwd) {
    const P = this.P, U = Math.hypot(this.vw[0], this.vw[2]), k0 = G / Math.max(1, U * U);
    P.fill(0);
    const px = dyn.pos[0], pz = dyn.pos[2], py = dyn.pos[1];
    const sx = -fz, sz = fx;                             // starboard, level
    for (let j = 0; j < N; j++) {
      const Z = this.o[1] + (j + 0.5) * DX - pz;
      for (let i = 0; i < N; i++) {
        const X = this.o[0] + (i + 0.5) * DX - px;
        const bx = X * fx + Z * fz;
        if (bx < -50 || bx > 48) continue;
        const bz = X * sx + Z * sz;
        if (Math.abs(bz) > 8) continue;
        const lift = py + fwd[1] * bx - YA;              // world height of the keel datum at this station
        let head = 0;
        const s = station(bx);
        if (s && Math.abs(bz) < s.b) {
          const c = Math.sqrt(1 - (bz / s.b) ** 2);
          const yBot = lift + s.yb - (s.yb - s.yk) * c, yTop = lift + s.yb + (s.yt - s.yb) * c;
          if (yBot < 0) head = yTop > 0 ? -yBot : (yTop - yBot) * Math.exp(-k0 * -yTop);
        }
        if (bx > SAIL.x0 && bx < SAIL.x1 && Math.abs(bz) < SAIL.b) {
          const y0 = lift + SAIL.y0, y1 = lift + SAIL.y1;
          if (y0 < 0) head = Math.max(head, y1 > 0 ? -y0 : (y1 - y0) * Math.exp(-k0 * -y1));
        }
        P[j * N + i] = head;
      }
    }
    // smoothed to what the grid can carry (separable [1 4 6 4 1]/16)
    const T = this.re, S = this.Ps, w = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let a = 0; for (let k = -2; k <= 2; k++) { const ii = i + k; if (ii >= 0 && ii < N) a += w[k + 2] * P[j * N + ii]; }
      T[j * N + i] = a;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let a = 0; for (let k = -2; k <= 2; k++) { const jj = j + k; if (jj >= 0 && jj < N) a += w[k + 2] * T[jj * N + i]; }
      S[j * N + i] = a;
    }
  }

  /** One step of the free surface: every mode advanced exactly under her pressure. */
  _solve(dyn, plant, fx, fz, fwd, stb) {
    this._pressure(dyn, fx, fz, fwd);
    const { re, im, pr, pi, eta, phi, Ps, w, kk, damp } = this;
    // eta and phi in one complex transform; the pressure in another
    for (let n = 0; n < N * N; n++) { re[n] = eta[n]; im[n] = phi[n]; pr[n] = Ps[n]; pi[n] = 0; }
    fft2(re, im, false); fft2(pr, pi, false);
    const Er = new Float64Array(N * N), Ei = new Float64Array(N * N), Fr = new Float64Array(N * N), Fi = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const n = j * N + i, m = ((N - j) % N) * N + ((N - i) % N);
      // separate the two real fields: E = (Z(k) + Z*(-k)) / 2, F = (Z(k) - Z*(-k)) / 2i
      Er[n] = (re[n] + re[m]) / 2; Ei[n] = (im[n] - im[m]) / 2;
      Fr[n] = (im[n] + im[m]) / 2; Fi[n] = -(re[n] - re[m]) / 2;
    }
    for (let n = 0; n < N * N; n++) {
      const k = kk[n];
      if (k === 0) { re[n] = Er[n] - Fi[n]; im[n] = Ei[n] + Fr[n]; continue; }
      const om = w[n], c = Math.cos(om * H), s = Math.sin(om * H), d = damp[n];
      const ur = Er[n] + pr[n], ui = Ei[n] + pi[n];
      const er = (-pr[n] + ur * c + (k / om) * Fr[n] * s) * d, ei = (-pi[n] + ui * c + (k / om) * Fi[n] * s) * d;
      const gr = (Fr[n] * c - (om / k) * ur * s) * d, gi = (Fi[n] * c - (om / k) * ui * s) * d;
      re[n] = er - gi; im[n] = ei + gr;                  // Z = E + i F
    }
    fft2(re, im, true);
    const e = this.edge;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const n = j * N + i, t = e[i] * e[j];
      eta[n] = re[n] * t; phi[n] = im[n] * t;
    }
    // breaking and foam: steep faces, and the screws' wash on the surface
    const F = this.foam, fd = Math.exp(-H / TAU_FOAM);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const n = j * N + i;
      const gx = (eta[n + 1] + Ps[n + 1] - eta[n - 1] - Ps[n - 1]) / (2 * DX), gz = (eta[n + N] + Ps[n + N] - eta[n - N] - Ps[n - N]) / (2 * DX);
      const sl = Math.hypot(gx, gz);
      // (the Stokes limit is a slope of about 0.44 at the crest; the 2 m grid rounds a crest off to
      // about half its true steepness, so a resolved slope of 0.18 is a face that is breaking)
      F[n] = Math.min(1.5, F[n] * fd + Math.max(0, sl - 0.18) * H * 8);
    }
    const sh = plant?.shaft;
    if (sh) {
      const sternX = -48, screwY = dyn.pos[1] + fwd[1] * sternX + (5 * FT - YA);
      if (screwY > -6) {
        for (const [side, sd] of [[-1, sh.port], [1, sh.stbd]]) {
          const turn = Math.min(1, Math.abs(sd.revs ?? 0) / 4) * (1 + screwY / 6);
          if (turn < 0.05) continue;
          for (let a = 0; a < 6; a++) {
            const bx = sternX - a * 1.5, bz = side * (2.2 + a * 0.15);
            this._foamAt(dyn.pos[0] + fx * bx - fz * bz, dyn.pos[2] + fz * bx + fx * bz, turn * H * 2.5);
          }
        }
      }
    }
    // the periscope's feather
    plant?.scopes?.forEach((u, k) => {
      if (u < 0.5) return;
      const top = dyn.pos[1] + fwd[1] * SCOPES[k] + HULL.periscopeDownTop + u * (HULL.periscopeUpTop - HULL.periscopeDownTop) - YA;
      const U = Math.hypot(this.vw[0], this.vw[2]);
      if (top > 0 && top < 9 && dyn.pos[1] + 15 * FT - YA < 0 && U > 0.6) {
        this._foamAt(dyn.pos[0] + fx * SCOPES[k], dyn.pos[2] + fz * SCOPES[k], Math.min(1, U / 4) * H * 6);
      }
    });
    void stb;
  }

  _foamAt(X, Z, amount) {
    const i = Math.floor((X - this.o[0]) / DX), j = Math.floor((Z - this.o[1]) / DX);
    if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) return;
    this.foam[j * N + i] = Math.min(1.5, this.foam[j * N + i] + amount);
  }

  /** The surface the renderer draws: the waves she makes (her own hollow is the hull itself), slopes, foam. */
  _texture() {
    const T = this.tex, e = this.eta, P = this.Ps, F = this.foam;
    const h = (n) => e[n] + P[n];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const n = j * N + i;
      const ip = Math.min(N - 1, i + 1), im = Math.max(0, i - 1), jp = Math.min(N - 1, j + 1), jm = Math.max(0, j - 1);
      T[n * 4] = h(n);
      T[n * 4 + 1] = (h(j * N + ip) - h(j * N + im)) / ((ip - im) * DX);
      T[n * 4 + 2] = (h(jp * N + i) - h(jm * N + i)) / ((jp - jm) * DX);
      T[n * 4 + 3] = Math.min(1, F[n]);
    }
    this.version++;
  }

  /** The surface she makes at world X, Z (m), for anyone who wants it. */
  heightAt(X, Z) {
    if (!this.o) return 0;
    const i = Math.floor((X - this.o[0]) / DX), j = Math.floor((Z - this.o[1]) / DX);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return this.tex[(j * N + i) * 4];
  }

  /** Spray: the bow driving into the sea (and slamming into it), the periscope's feather. */
  _spray(dt, dyn, plant, sea, fx, fz, fwd) {
    if (dt <= 0) return;
    const U = Math.hypot(this.vw[0], this.vw[2]);
    const stemX = 44.5, sx = dyn.pos[0] + fx * stemX, sz = dyn.pos[2] + fz * stemX;
    const sy = dyn.pos[1] + fwd[1] * stemX + 15 * FT - YA;          // the stem at her surfaced waterline
    const seaY = sea.eta(sx, sz) + this.heightAt(sx, sz);
    const rel = sy - seaY;
    const vrel = this.stemY == null ? 0 : (rel - this.stemY) / dt;
    this.stemY = rel;
    const deckY = dyn.pos[1] + fwd[1] * stemX + 26 * FT - YA;
    if (deckY > seaY - 0.5 && sy < seaY + 1.5) {
      // water piling up the stem: a steady sheet with way on, a burst when she comes down on a sea
      const slam = Math.max(0, -vrel - 1.0);
      const rate = Math.max(0, U - 2.5) ** 2 * 3 + slam * slam * 60;
      let n = rate * dt;
      n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let k = 0; k < Math.min(n, 60); k++) {
        const side = Math.random() < 0.5 ? -1 : 1, back = Math.random() * 8;
        const out = (0.3 * U + 0.5 * slam) * (0.6 + Math.random() * 0.8);
        const up = (0.25 * U + 0.8 * slam) * (0.5 + Math.random());
        const bx = stemX - back, bz = side * (0.3 + back * 0.25);
        this.spray.push([dyn.pos[0] + fx * bx - fz * bz, seaY + 0.2, dyn.pos[2] + fz * bx + fx * bz,
          this.vw[0] * 0.5 - fz * side * out, up, this.vw[2] * 0.5 + fx * side * out]);
      }
    }
    plant?.scopes?.forEach((u, k) => {
      if (u < 0.5 || U < 1.5 || dyn.pos[1] + 15 * FT - YA > 0) return;
      let n = (U - 1.5) ** 2 * 4 * dt; n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let m = 0; m < n; m++) {
        const X = dyn.pos[0] + fx * SCOPES[k], Z = dyn.pos[2] + fz * SCOPES[k];
        const side = Math.random() < 0.5 ? -1 : 1;
        this.spray.push([X, sea.eta(X, Z) + 0.1, Z, this.vw[0] * 0.6 - fz * side * 0.4 * U, 0.35 * U * Math.random(), this.vw[2] * 0.6 + fx * side * 0.4 * U]);
      }
    });
  }
}

export const WAKE = { N, DX, L };
