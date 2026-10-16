/**
 * The loading gauge swept along the running line: everything the scenery builders put down
 * (terrain, buildings, roads, the overhead line's masts, signals, tunnel vaults) is checked
 * against the space the train needs. Prints what reaches into it, by chainage.
 *   node tools/clearance.mjs
 */
import { Route } from '../src/world/route.js';
import { Terrain } from '../src/world/terrain.js';
import PLACES from '../src/data/places.js';
import { Places } from '../src/render/places.js';

const R = await Route.load(), T = await Terrain.load(R), L = R.run;
// (the scenery's own rules for keeping out of the trains' way)
const P0 = Object.assign(Object.create(Places.prototype), { route: R, T });
const HALF = 1.6, TOP = 4.65, BOTTOM = 0.35;               // the train's half width (+ a margin), its height
const widen = (s) => 45 * Math.abs(L.curvatureAt(s));       // a car's swing in a curve
const hits = [];
const hit = (kind, s, what) => hits.push({ kind, s: Math.round(s), what });
const frame = (s) => { const p = L.pos(s), h = L.headingAt(s); return { p, h, rx: Math.cos(h), ry: -Math.sin(h), fx: Math.sin(h), fy: Math.cos(h) }; };
/** Where a map point lies against the running line: { s, off (right +), dz (over the rail) } or null. */
let hint = null;
const rel = (x, y, z) => {
  const q = L.locate(x, y, hint, hint == null ? 1e9 : 400); hint = q.s;
  if (q.s <= 0.5 || q.s >= L.length - 0.5) return null;
  const f = frame(q.s);
  return { s: q.s, off: (x - f.p.x) * f.rx + (y - f.p.y) * f.ry, dz: z - f.p.z, d: q.d };
};

// ---- the terrain: across the gauge, nothing of the ground above the cars' underframes (not in tunnels)
for (let s = 5; s < L.length; s += 2) {
  if (R.structureAt(s)) continue;
  const f = frame(s), w = HALF + widen(s);
  for (const a of [-w, -w / 2, 0, w / 2, w]) {
    const g = T.heightAt(f.p.x + f.rx * a, f.p.y + f.ry * a);
    if (g > f.p.z + BOTTOM + 0.25) { hit('terrain', s, `ground ${(g - f.p.z).toFixed(1)} m over the rail at ${a.toFixed(1)} m`); break; }
  }
}
// ---- buildings
const near = (x, y) => { const q = L.locate(x, y, null, 1e9); return q.d < 40; };
PLACES.buildings.forEach((b, id) => {
  let pts = []; for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
  if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  if (!pts.some(([x, y]) => near(x, y))) return;
  const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  const cl = P0._clearOfTracks(pts, T.heightAt(cx, cy));
  if (cl.drop) return;
  pts = cl.pts;
  // the outline, filled in every metre
  const dense = [];
  for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay))); for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]); }
  let gmin = 1e9; for (const [x, y] of pts) gmin = Math.min(gmin, T.heightAt(x, y));
  hint = null;
  for (const [x, y] of dense) {
    const r = rel(x, y, gmin);
    if (r && Math.abs(r.off) < HALF + widen(r.s) && r.dz < TOP && !R.structureAt(r.s)) { hit('building', r.s, `${b.c || 'building'} #${id} at ${r.off.toFixed(1)} m`); break; }
  }
});
// ---- roads (as places.js lays them: on the ground, bridges straight between their ends)
const width = { motorway: 7.6, trunk: 7.5, primary: 7.0, secondary: 6.0, tertiary: 5.5, unclassified: 4.5, residential: 4.5, living_street: 4.0, service: 3.2 };
PLACES.roads.forEach((r, id) => {
  const w = width[r.c]; if (!w || r.f?.includes('is_tunnel')) return;
  const pts = []; for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]]);
  if (!pts.some(([x, y]) => near(x, y))) return;
  const bridge = r.f?.includes('is_bridge');
  const P = [];
  for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1)); for (let k = 0; k < n; k++) P.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]); }
  P.push(pts.at(-1));
  const z0 = T.heightAt(...P[0]), z1 = T.heightAt(...P.at(-1)), deck = bridge ? P0._overbridge(P, w, z0, z1) : null;
  hint = null;
  for (let i = 0; i < P.length; i++) {
    const [x, y] = P[i], z = bridge ? deck[i] : T.heightAt(x, y);
    const rr = rel(x, y, z + 0.45);
    if (!rr || Math.abs(rr.off) > HALF + widen(rr.s) + w / 2 + 1.4) continue;
    if (R.structureAt(rr.s)?.type === 'tunnel') continue;
    if (rr.dz > BOTTOM && rr.dz < TOP + 0.3) { hit('road', rr.s, `${r.c}${bridge ? ' bridge' : ''} #${id} ${rr.dz.toFixed(1)} m over the rail, ${rr.off.toFixed(1)} m across`); break; }
  }
});
// ---- tunnel vaults (structures.js: centred between the tracks when the other is within 6 m)
const sframe = (s) => { const p = L.pos(s), h = L.headingAt(s), q = R.right.locate(p.x, p.y, null, 0); return { off: q.d < 6 ? q.d / 2 : 0, double: q.d < 6, dzR: Math.abs(R.right.pos(q.s).z - p.z) }; };
for (const t of R.tunnels) {
  const W = sframe(t.s0).double ? 4.3 : 2.4, H = W + 2.1;
  for (let s = t.s0; s <= t.s1; s += 2) {
    const c = sframe(s).off, w = HALF - 0.15 + widen(s);
    for (const [a, u] of [[-w, 0.4], [w, 0.4], [-w, 3.5], [w, 3.5], [-1.2, 4.1], [1.2, 4.1], [0, 4.6]]) {
      const x = a - c;                           // across from the vault's centre line
      const inside = u <= H - W ? Math.abs(x) <= W : x * x + (u - (H - W)) ** 2 <= W * W;
      if (!inside) { hit('tunnel', s, `${t.name ?? 'tunnel'}: the vault (half ${W} m, centred ${c.toFixed(1)} m right${sframe(s).dzR > 3 ? `, the other track ${sframe(s).dzR.toFixed(0)} m above/below` : ''}) cuts the gauge at ${a.toFixed(1)} m, ${u} m up`); break; }
    }
  }
}
// ---- the overhead line's masts (track.js: 3.1 m out from each main track, outer side) and the signals
for (const [line, side] of [[R.run, -1], [R.right, 1]]) {
  let s = 8;
  while (s < line.length - 5) {
    const p = line.pos(s), h = line.headingAt(s), x = p.x + Math.cos(h) * side * 3.1, y = p.y - Math.sin(h) * side * 3.1;
    // (track.js leaves out a mast whose foot would stand on another main track)
    const fouls = [R.run, R.right].some((O) => { if (O === line) return false; const q = O.locate(x, y); return q.d < 2.6 && Math.abs(O.pos(q.s).z - p.z) < 6; });
    if (fouls) { s += 40; continue; }
    hint = null; const r = rel(x, y, p.z + 2);
    if (r && Math.abs(r.off) < HALF + widen(r.s) && Math.abs(r.dz) < 5 && !R.inTunnel(r.s)) hit('mast', r.s, `${line === R.run ? 'its own' : 'the other line\'s'} mast ${r.off.toFixed(1)} m across`);
    s += 40;
  }
}
// ---- summary: runs of hits
const byKind = {};
for (const h of hits) (byKind[h.kind] ??= []).push(h);
for (const [k, list] of Object.entries(byKind)) {
  list.sort((a, b) => a.s - b.s);
  const groups = [];
  for (const h of list) { const g = groups.at(-1); if (g && h.s - g.s1 < 15) { g.s1 = h.s; g.n++; } else groups.push({ s0: h.s, s1: h.s, n: 1, what: h.what }); }
  console.log(`\n${k}: ${list.length} hits in ${groups.length} places`);
  for (const g of groups.slice(0, 40)) { const tn = R.tunnels.reduce((m, t) => Math.min(m, Math.abs(t.s0 - g.s0), Math.abs(t.s1 - g.s0)), 1e9); console.log(`  s ${g.s0}-${g.s1} (km ${R.kmAt(g.s0).toFixed(2)})  ${g.what}${g.n > 1 ? `  (+${g.n - 1})` : ''}${tn < 60 ? `  [${tn.toFixed(0)} m from a portal]` : ''}`); }
}
if (!hits.length) console.log('the gauge is clear');
