/**
 * The ropes as things that move. Every hoist and compensating rope is drawn strand by strand,
 * each a taut string between its ends under its own tension: its sideways sway is the sum of its
 * first three modes, frequency f_k = k c / 2L with wave speed c = sqrt(T / mu), excited by the
 * building's sway (wind, and an earthquake) and damped at 1 %. Long ropes hang slack and sway
 * slowly; short ones are stiff and still, as in a real hoistway, where rope sway is worst when
 * the ropes' frequency comes near the building's. Each rope ends at the car in a hitch spring that
 * shares the load between the ropes; the springs show each rope's tension (the ropes are not all
 * cut to exactly the same length, so the tensions are not quite equal). A rope that parts is no
 * longer a string: it becomes a chain of links under gravity that falls down the hoistway and
 * piles on the car roof or the counterweight.
 */
import { InstancedMesh, Object3D, Vector3, Quaternion } from 'three';
import { cylGeo } from './build.js';

const K = 3, SEG = 14, ZETA = 0.01, G = 9.81;
const _o = new Object3D(), _a = new Vector3(), _b = new Vector3(), _d = new Vector3(), _up = new Vector3(0, 1, 0), _q = new Quaternion();

export class Ropes {
  constructor(scene, mat, cap = 1600) {
    const geo = cylGeo(1, 1, 'y', 6); geo.translate(0, 0.5, 0);
    this.mesh = new InstancedMesh(geo, mat, cap); this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.runs = []; this.chains = [];
    this.wind = [0, 0];                                  // the building's sway acceleration from wind (m/s²)
  }

  /** A run of n parallel ropes: ends(i) gives [bottom, top], T(i) the rope's tension (N), mu its mass a metre. */
  run(spec) { const r = { ...spec, strands: Array.from({ length: spec.n }, () => ({ ax: new Float64Array(K), vx: new Float64Array(K), az: new Float64Array(K), vz: new Float64Array(K) })) }; this.runs.push(r); return r; }

  /** A parted rope: a chain hanging from anchor() (a moving point), lying along pts at first, settling on floors(). */
  chain(anchor, pts, r, floors) {
    const n = pts.length, rest = [];
    for (let i = 1; i < n; i++) rest.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const c = { anchor, p: pts.map((q) => [...q]), q: pts.map((q) => [...q]), rest, r, floors };
    this.chains.push(c);
    return c;
  }

  update(dt, shake, box) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    // wind: the building sways by a few hundredths of a m/s², slowly (a filtered random walk)
    if (this.selfWind !== false) for (let i = 0; i < 2; i++) this.wind[i] += (-this.wind[i] / 4 + 0.03 * (Math.random() - 0.5) / Math.sqrt(dt) * 0.5) * dt;
    const A = [this.wind[0] + (shake?.[0] ?? 0), this.wind[1] + (shake?.[2] ?? 0)];
    let n = 0;
    const M = this.mesh;
    const seg = (x0, y0, z0, x1, y1, z1, r) => {
      if (n >= M.instanceMatrix.count) return;
      _a.set(x0, y0, z0); _b.set(x1, y1, z1); _d.subVectors(_b, _a); const L = _d.length(); if (L < 1e-4) return;
      _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / L));
      _o.position.copy(_a); _o.quaternion.copy(_q); _o.scale.set(r, L, r); _o.updateMatrix();
      M.setMatrixAt(n++, _o.matrix);
    };
    for (const R of this.runs) {
      for (let i = 0; i < R.n; i++) {
        if (R.live && !R.live(i)) continue;
        const [B, T] = R.ends(i), L = Math.max(0.05, Math.hypot(T[0] - B[0], T[1] - B[1], T[2] - B[2]));
        const c = Math.sqrt(Math.max(1, R.T(i)) / R.mu), S = R.strands[i];
        // the string's modes, each a damped oscillator driven by the building's acceleration
        for (let k = 0; k < K; k++) {
          const w = ((k + 1) * Math.PI * c) / L;
          if (w > 120) { S.ax[k] = S.az[k] = S.vx[k] = S.vz[k] = 0; continue; }
          const f = (k % 2 === 0 ? 4 / ((k + 1) * Math.PI) : 0);
          const sub = Math.min(30, Math.ceil((w * dt) / 0.4));
          const h = dt / sub;
          for (let s = 0; s < sub; s++) {
            S.vx[k] += (-A[0] * f - 2 * ZETA * w * S.vx[k] - w * w * S.ax[k]) * h; S.ax[k] += S.vx[k] * h;
            S.vz[k] += (-A[1] * f - 2 * ZETA * w * S.vz[k] - w * w * S.az[k]) * h; S.az[k] += S.vz[k] * h;
          }
        }
        // a rope can swing no further than the hoistway lets it (it slaps the wall)
        const lim = 0.25, amp = Math.abs(S.ax[0]) + Math.abs(S.az[0]);
        if (amp > lim) { const k = lim / amp; for (let j = 0; j < K; j++) { S.ax[j] *= k; S.az[j] *= k; S.vx[j] *= 0.5; S.vz[j] *= 0.5; } }
        let px = B[0], py = B[1], pz = B[2];
        for (let j = 1; j <= SEG; j++) {
          const s = j / SEG; let ux = 0, uz = 0;
          for (let k = 0; k < K; k++) { const sn = Math.sin((k + 1) * Math.PI * s); ux += S.ax[k] * sn; uz += S.az[k] * sn; }
          const x = B[0] + (T[0] - B[0]) * s + ux, y = B[1] + (T[1] - B[1]) * s, z = B[2] + (T[2] - B[2]) * s + uz;
          seg(px, py, pz, x, y, z, R.r);
          px = x; py = y; pz = z;
        }
        // the hitch spring at the car, squeezed by this rope's tension
        if (R.spring) { const sp = R.spring(i); seg(B[0], B[1] - sp.len, B[2], B[0], B[1], B[2], sp.r); }
      }
    }
    // parted ropes: links under gravity (Verlet), kept their length, resting on what is below them
    const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
    for (const C of this.chains) {
      const P = C.p, Q = C.q;
      for (let s = 0; s < steps; s++) {
        for (let i = 1; i < P.length; i++) { const p = P[i], q = Q[i]; for (let a = 0; a < 3; a++) { const v = (p[a] - q[a]) * 0.9995; q[a] = p[a]; p[a] += v + (a === 1 ? -G * h * h : 0); } }
        for (let it = 0; it < 8; it++) {
          const a0 = C.anchor(); P[0][0] = a0[0]; P[0][1] = a0[1]; P[0][2] = a0[2];
          for (let i = 1; i < P.length; i++) {
            const a = P[i - 1], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = Math.hypot(dx, dy, dz) || 1e-6;
            if (d <= C.rest[i - 1]) continue;                  // a rope pulls, it does not push
            const e = (d - C.rest[i - 1]) / d, wa = i === 1 ? 0 : 0.5, wb = i === 1 ? 1 : 0.5;
            a[0] += dx * e * wa; a[1] += dy * e * wa; a[2] += dz * e * wa; b[0] -= dx * e * wb; b[1] -= dy * e * wb; b[2] -= dz * e * wb;
          }
          for (let i = 1; i < P.length; i++) {
            const p = P[i];
            p[0] = Math.max(box[0][0], Math.min(box[1][0], p[0])); p[2] = Math.max(box[0][2], Math.min(box[1][2], p[2]));
            let fl = box[0][1];
            for (const f of C.floors()) if (p[0] > f[0] && p[0] < f[1] && p[2] > f[2] && p[2] < f[3] && p[1] > f[4] - 0.3) fl = Math.max(fl, f[4]);
            if (p[1] < fl) { p[1] = fl; Q[i][0] = p[0] - (p[0] - Q[i][0]) * 0.3; Q[i][2] = p[2] - (p[2] - Q[i][2]) * 0.3; }
          }
        }
      }
      for (let i = 1; i < P.length; i++) seg(P[i - 1][0], P[i - 1][1], P[i - 1][2], P[i][0], P[i][1], P[i][2], C.r);
    }
    M.count = n;
    M.instanceMatrix.needsUpdate = true;
  }
}
