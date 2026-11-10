/**
 * The MakeHuman macro system (gender, age, muscle, weight, height, proportions and the three
 * ethnic blends), reimplemented from the published rules in macro.json: each macro value
 * picks the two nearest named shapes and weights them linearly; combination targets are the
 * products of those weights.
 */
import { join } from 'node:path';
import { MH_DATA, loadJSON, loadTarget, applyTarget } from './mhdata.mjs';

const MACRO = loadJSON(join(MH_DATA, 'targets', 'macrodetails', 'macro.json'));

function components(name, value) {
  const out = [];
  for (const p of MACRO.macrotargets[name].parts) {
    if (value > p.lowest && value < p.highest) {
      const t = (value - p.lowest) / (p.highest - p.lowest);
      if (p.low) out.push([p.low, 1 - t]);
      if (p.high) out.push([p.high, t]);
    }
  }
  return out;
}

/**
 * @param m {gender, age, muscle, weight, height, proportions, race:{african,asian,caucasian}}
 *   all 0..1 (age 0.5 = 25 years, 1 = 90; gender 1 = male)
 * @returns [[relative target path, weight], ...]
 */
export function macroStack(m, cutoff = 0.005) {
  const c = {};
  for (const k of ['gender', 'age', 'muscle', 'weight', 'proportions', 'height', 'cupsize', 'firmness']) c[k] = components(k, m[k] ?? 0.5);
  const out = [];
  for (const [race, rw] of Object.entries(m.race ?? { african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 })) {
    if (rw <= 1e-4) continue;
    for (const [a, aw] of c.age) for (const [g, gw] of c.gender) {
      const w = rw * gw * aw;
      if (w > cutoff) out.push([`macrodetails/${race}-${g}-${a}`, w]);
    }
  }
  for (const [g, gw] of c.gender) for (const [a, aw] of c.age) for (const [mu, mw] of c.muscle) for (const [we, ww] of c.weight) {
    const w = gw * aw * mw * ww;
    if (w > cutoff) out.push([`macrodetails/universal-${g}-${a}-${mu}-${we}`, w]);
    for (const [h, hw] of c.height) if (gw * aw * mw * ww * hw > cutoff) out.push([`macrodetails/height/${g}-${a}-${mu}-${we}-${h}`, gw * aw * mw * ww * hw]);
    for (const [p, pw] of c.proportions) if (gw * aw * mw * ww * pw > cutoff) out.push([`macrodetails/proportions/${g}-${a}-${mu}-${we}-${p}`, gw * aw * mw * ww * pw]);
  }
  return out;
}

const cache = new Map();
export function target(rel) {
  let t = cache.get(rel);
  if (!t) { t = loadTarget(rel); cache.set(rel, t); }
  return t;
}

/** Applies the macro stack and any extra detail targets ({'nose/nose-scale-horiz-incr': 0.4, ...}). */
export function shape(basePos, m, details = {}, bodyVerts = 13380) {
  if (m.heightM) m = { ...m, height: solveHeight(basePos, m, details, bodyVerts) };
  const pos = Float64Array.from(basePos);
  for (const [rel, w] of macroStack(m)) applyTarget(pos, target(rel), w);
  for (const [rel, w] of Object.entries(details)) applyTarget(pos, target(rel), w);
  return pos;
}

function bodyHeight(pos, n) {
  let lo = Infinity, hi = -Infinity;
  for (let v = 0; v < n; v++) { const y = pos[v * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  return (hi - lo) * 0.1;
}

/** The height macro (0..1) that makes the body stand heightM metres tall (bisection). */
function solveHeight(basePos, m, details, n) {
  let a = 0.0, b = 1.0;
  for (let i = 0; i < 14; i++) {
    const mid = (a + b) / 2;
    const pos = Float64Array.from(basePos);
    for (const [rel, w] of macroStack({ ...m, height: mid })) applyTarget(pos, target(rel), w);
    for (const [rel, w] of Object.entries(details)) applyTarget(pos, target(rel), w);
    if (bodyHeight(pos, n) < m.heightM) a = mid; else b = mid;
  }
  return (a + b) / 2;
}
