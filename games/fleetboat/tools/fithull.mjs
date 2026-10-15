// Fits the hull envelope's shape parameters (src/physics/hull.js, ENVELOPE) to the yard's
// hydrostatics for normal diving trim (General Information Book A-1), by Nelder-Mead.
//   node tools/fithull.mjs            prints the fitted parameters and how close each target is
import { ENVELOPE, buildSlices, hydrostatics, envelopeVolume, sectionAt, breadthAt, clipBelow } from '../src/physics/hull.js';

const FT = 0.3048;
const T = {
  Venv: 2419 * 35, lcbEnv: -7.0, kbEnv: 11.40,
  Vs: 1806.2 * 35, lcbS: -(5 + 1.12), kbS: 9.18, Awp: 5250, bmT: 3.22, bmL: 410, S: 11543,   // bmL: from MT1" = 210 ft-tons (the book's 271 ft disagrees with its own MT1" and trim)
  midArea: 340, bWL: 26.0,
};
const KEYS = ['xm1', 'xm0', 'pF', 'qF', 'pA', 'qA', 'xk1', 'xk0', 'KF', 'kF', 'KA', 'kA', 'YT', 'n1', 'n2', 'endTop'];
const LO = { xm1: -60, xm0: -110, pF: 1.0, qF: 0.3, pA: 1.0, qA: 0.3, xk1: 20, xk0: -130, KF: 0.0, kF: 1, KA: 1, kA: 0.6, YT: 18.5, n1: 1.4, n2: 1.6, endTop: 0.15 };
const HI = { xm1: 90, xm0: 60, pF: 4, qF: 1.5, pA: 4, qA: 1.5, xk1: 150, xk0: -20, KF: 14, kF: 4, KA: 14, kA: 4, YT: 23, n1: 6, n2: 6, endTop: 1 };

function evaluate(v, verbose = false) {
  KEYS.forEach((k, i) => { ENVELOPE[k] = Math.min(HI[k], Math.max(LO[k], v[i])); });
  const s = buildSlices(72);
  // the yard's 2419 tons do not count the bow buoyancy tank (free flooding, in the superstructure)
  const env = envelopeVolume(buildSlices(72, { bb: false }));
  const h = hydrostatics(s, 15.25 * FT, 15.25 * FT);       // the yard's displacement curves: even keel at the mean draft
  const xm = -6.0;          // midships, 12" aft of frame 69
  const sec = sectionAt(xm).map(([z, y]) => [z * FT, y * FT]);
  const mid = clipBelow(sec, 0, 1, 15.25 * FT).A / FT ** 2;
  const bwl = breadthAt(sec, 15.25 * FT) / FT;
  const r = {
    Venv: env.V / FT ** 3, lcbEnv: env.lcb / FT, kbEnv: env.kb / FT,
    Vs: h.V / FT ** 3, lcbS: h.lcb / FT, kbS: h.kb / FT, Awp: h.Awp / FT ** 2, bmT: h.bmT / FT, bmL: h.bmL / FT, S: h.S / FT ** 2,
    midArea: mid, bWL: bwl,
  };
  const rel = (k, w) => w * ((r[k] - T[k]) / T[k]) ** 2;
  const abs = (k, sc, w) => w * ((r[k] - T[k]) / sc) ** 2;
  let e = rel('Venv', 400) + rel('Vs', 400) + abs('lcbS', 1, 3) + abs('kbS', 0.15, 1) + rel('Awp', 80) + abs('bmT', 0.1, 1)
    + rel('bmL', 3) + rel('S', 6) + abs('lcbEnv', 1, 3) + abs('kbEnv', 0.2, 1) + rel('midArea', 30) + abs('bWL', 0.3, 1);
  if (verbose) for (const k of Object.keys(T)) console.log(k.padEnd(8), r[k].toFixed(2).padStart(10), 'target', String(T[k]).padStart(8), ((r[k] / T[k] - 1) * 100).toFixed(1) + '%');
  return e;
}

function nelderMead(f, x0, step, iters = 4000) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; simplex.push(x); }
  let vals = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = idx.map((i) => simplex[i]); vals = idx.map((i) => vals[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const xr = c.map((cj, j) => cj + (cj - worst[j])); const fr = f(xr);
    if (fr < vals[0]) {
      const xe = c.map((cj, j) => cj + 2 * (cj - worst[j])); const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
    else {
      const xc = c.map((cj, j) => cj + 0.5 * (worst[j] - cj)); const fc = f(xc);
      if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; }
      else for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((x, j) => simplex[0][j] + 0.5 * (x - simplex[0][j])); vals[i] = f(simplex[i]); }
    }
    if (it % 500 === 0) console.log('iter', it, vals[0].toExponential(3));
  }
  return { x: simplex[0], v: vals[0] };
}

let x = KEYS.map((k) => ENVELOPE[k]);
const step = KEYS.map((k) => (HI[k] - LO[k]) * 0.08);
for (let round = 0; round < 7; round++) {
  const r = nelderMead(evaluate, x, step.map((s) => s / (1 + (round % 3))), 2500);
  x = r.x;
  console.log('round', round, 'error', r.v.toExponential(3));
}
evaluate(x, true);
console.log('\nENVELOPE parameters:');
console.log(KEYS.map((k, i) => `${k}: ${+Math.min(HI[k], Math.max(LO[k], x[i])).toFixed(3)}`).join(', '));
