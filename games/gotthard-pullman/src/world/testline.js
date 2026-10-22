/**
 * A test section (not part of the real Gotthard line): the running line carries on beyond
 * Göschenen, down a very steep 100 per mille drop, then a long descent at 35 per mille down the
 * mountain, through a sag and up again at 35 per mille. For trying the physics (brakes, adhesion,
 * a runaway, a stall on the climb) with the controls (F). The crew's timetable ends at Göschenen.
 *
 * The profile, from the end of the line at Göschenen (distance along the extension, m):
 *   0-150 level, 300-1500 falling 100 per mille, 1700-11700 falling 35 per mille,
 *   12000-18000 rising 35 per mille, level to the end at 18400 (vertical curves between).
 */
const KNOTS = [[0, 0], [150, 0], [300, -0.10], [1500, -0.10], [1700, -0.035], [11700, -0.035], [12000, 0.035], [18000, 0.035], [18150, 0]];
/** Where the start screen sets the train down (the engine's front, metres beyond Göschenen): the top of each test track. */
export const TEST_STARTS = { steep: 120, long: 1760 };
export const gradeAt = (u) => {
  for (let i = 0; i + 1 < KNOTS.length; i++) {
    const [a, ga] = KNOTS[i], [b, gb] = KNOTS[i + 1];
    if (u <= b) return ga + ((gb - ga) * (u - a)) / (b - a);
  }
  return 0;
};

/**
 * The extension's samples (x, y, z every `step` m) from the line's last point: a turn back
 * through 180 degrees out of Göschenen, then down the valley beside the real line (its course
 * smoothed over 2.4 km, so without the spirals, and set OFFSET m to the side), the joins eased.
 */
const OFFSET = 150, LENGTH = 18400;
export function extensionSamples(run, step) {
  const n = run.n, W = Math.round(3000 / run.step);
  // the valley's course: the real line from Göschenen northward, smoothed, set to one side
  const vx = [], vy = [];
  for (let i = n - 1; i >= 0; i -= 25) {
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j += 5) { sx += run.x[j]; sy += run.y[j]; c++; }
    vx.push(sx / c); vy.push(sy / c);
  }
  const P = [];
  for (let i = 0; i < vx.length; i++) {
    const a = Math.max(0, i - 1), b = Math.min(vx.length - 1, i + 1), h = Math.atan2(vx[b] - vx[a], vy[b] - vy[a]);
    P.push([vx[i] + Math.cos(h) * OFFSET, vy[i] - Math.sin(h) * OFFSET]);
  }
  // out of the station and round (radius 450 m) toward the valley
  const pts = [];
  let x = run.x[n - 1], y = run.y[n - 1], h = run.heading[n - 1];
  for (let d = 0; d < 200; d += 10) { x += Math.sin(h) * 10; y += Math.cos(h) * 10; pts.push([x, y]); }
  const turn = Math.sign(OFFSET) > 0 ? 1 : -1;
  for (let d = 0; d < Math.PI * 450; d += 10) { h += (turn * 10) / 450; x += Math.sin(h) * 10; y += Math.cos(h) * 10; pts.push([x, y]); }
  // then the valley course, from its point nearest the end of the turn onward
  let k0 = 0, best = 1e18;
  for (let i = 0; i < P.length; i++) { const d = (P[i][0] - x) ** 2 + (P[i][1] - y) ** 2; if (d < best && i < P.length / 3) { best = d; k0 = i; } }
  for (let i = k0 + 4; i < P.length; i++) pts.push(P[i]);
  // resample every step, ease the corners (a moving average over 440 m), and lay the grades
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const at = (u) => { let i = 0; while (i < cum.length - 2 && cum[i + 1] < u) i++; const t = Math.min(1, (u - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i])); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; };
  const len = Math.min(LENGTH, cum.at(-1) - 50), raw = [];
  for (let u = step; u <= len; u += step) raw.push(at(u));
  const M = Math.round(220 / step), out = [];
  let z = run.z[n - 1];
  for (let i = 0; i < raw.length; i++) {
    // (a symmetric window, narrowing toward the start: the line leaves the station on its own course)
    const r = Math.min(M, i);
    let sx = 0, sy = 0, c = 0;
    for (let j = i - r; j <= Math.min(raw.length - 1, i + r); j++) { sx += raw[j][0]; sy += raw[j][1]; c++; }
    z += gradeAt((i + 0.5) * step) * step;
    out.push(sx / c, sy / c, z);
  }
  return out;
}

/**
 * Its tunnels and bridges, from the natural ground (the DEM): deeper than 25 m under it, a
 * tunnel; more than 12 m over it, a bridge (short gaps between them closed up).
 */
export function extensionStructures(route, ground) {
  const L = route.run, s0 = route.testFrom;
  if (s0 == null) return;
  const runs = (test) => {
    const out = [];
    let cur = null;
    for (let s = s0; s <= L.length; s += 10) {
      const p = L.pos(s), on = test(ground(p.x, p.y) - p.z);
      if (on && !cur) cur = { s0: s };
      if (!on && cur) { cur.s1 = s; out.push(cur); cur = null; }
    }
    if (cur) { cur.s1 = L.length; out.push(cur); }
    // close gaps under 60 m, drop pieces under 30 m
    const merged = [];
    for (const r of out) { const m = merged.at(-1); if (m && r.s0 - m.s1 < 60) m.s1 = r.s1; else merged.push({ ...r }); }
    return merged.filter((r) => r.s1 - r.s0 >= 30);
  };
  runs((depth) => depth > 25).forEach((t, i) => route.tunnels.push({ name: `Test tunnel ${i + 1}`, s0: t.s0, s1: t.s1 }));
  runs((depth) => depth < -12).forEach((b, i) => route.bridges.push({ name: `Test viaduct ${i + 1}`, s0: b.s0, s1: b.s1 }));
}
