import { heightAt } from './terrain.js';

/**
 * Skalice: the small subject town (poddanské městečko) on the levelled
 * terrace below the castle, and the castle itself. The name is invented;
 * the shape is the common one of a Bohemian market town around 1400. A
 * market square with a well and a pillory, the parish church beside it, the
 * headman's house (rychta), a tavern, the crafts along the street, cottages
 * at the edges, fields outside, and the lord's castle on the rock above.
 *
 * Everything here is data shared by the renderer, the people's routines
 * and the player's movement:
 *   NODES / EDGES  the street graph people walk along
 *   BUILDINGS      every building, its use, its door and where inside its
 *                  people stand, sit, work and sleep
 *   PLACES         open-air spots (the well, the pillory, the privy, the fields)
 */

export const TOWN_NAME = 'Skalice';
export const CASTLE_NAME = 'Skalice castle';

// The castle's frame: its centre on the levelled hilltop and its turn about Y.
// Plan (castle-local metres, +z north towards the hall, -z towards the town):
// a walled bailey 48 x 30 m, the gate tower in the middle of the south wall,
// the round keep (bergfried) in the north-west, the great hall (palas)
// along the north wall, the garrison's lean-to against the west wall and the
// stables against the east.
export const CASTLE = { x: 30, z: 230, rot: 0.3 };
export const CASTLE_PLAN = {
  bailey: { x0: -24, x1: 24, z0: -16, z1: 14 },
  wallT: 2, wallH: 9,
  gate: { x: -2, z: -16, w: 7, d: 7, pass: 3, h: 15 },
  keep: { x: -15, z: 5, r: 5, h: 27 },
  hall: { x: 13, z: 9, w: 18, d: 8, h: 11 },
  barracks: { x: -20, z: -9, w: 6, d: 8, h: 4.2 },
  stable: { x: 20.5, z: -8, w: 5, d: 10, h: 3.8 },
  well: { x: 3, z: -3 },
};
function castleLocal(lx, lz) {
  const c = Math.cos(CASTLE.rot), s = Math.sin(CASTLE.rot);
  return { x: CASTLE.x + lx * c + lz * s, z: CASTLE.z - lx * s + lz * c };
}
const gate = castleLocal(-2, -24);          // the road's end in front of the gate
const gatePass = castleLocal(-2, -16);      // through the gate passage
const yard = castleLocal(0, -6);            // the middle of the bailey
const CP = CASTLE_PLAN;

/** Street graph: id -> [x, z]. */
export const NODES = {
  joust: [0, -12], lists: [14, 14], south: [0, 40], b: [0, 70], sq: [0, 100], n: [0, 132],
  sqE: [14, 100], sqW: [-12, 96], e1: [32, 100], e2: [52, 100], w1: [-32, 92], w2: [-55, 100],
  bath: [-38, 88], fields: [52, 48], fieldsGate: [30, 56], c1: [8, 152], c2: [16, 186], gate: [gate.x, gate.z], gatePass: [gatePass.x, gatePass.z], yard: [yard.x, yard.z],
  n2: [-14, 136], n3: [14, 138],
};
export const EDGES = [
  ['joust', 'lists'], ['lists', 'south'], ['south', 'b'], ['b', 'sq'], ['sq', 'n'], ['sq', 'sqE'], ['sq', 'sqW'],
  ['sqE', 'e1'], ['e1', 'e2'], ['sqW', 'w1'], ['w1', 'w2'], ['w1', 'bath'], ['south', 'fieldsGate'], ['fieldsGate', 'fields'],
  ['n', 'c1'], ['c1', 'c2'], ['c2', 'gate'], ['gate', 'gatePass'], ['gatePass', 'yard'], ['n', 'n2'], ['n', 'n3'], ['b', 'fieldsGate'],
];

/**
 * Buildings. x, z centre; w (along x), d (along z); h wall height; door: the
 * outside door point and the node it opens to; kind picks the interior.
 * `beds`, `work`, `seats` are spots inside the interior (room coordinates,
 * metres from the room centre).
 */
const B = (id, kind, name, x, z, w, d, door, node, extra = {}) => ({ id, kind, name, x, z, w, d, h: extra.h ?? 3.4, door: { x: door[0], z: door[1] }, node, roof: extra.roof ?? 'thatch', ...extra });

export const BUILDINGS = [
  B('church', 'church', 'Church of St Wenceslas', -20, 109.5, 9, 24, [-20, 97.1], 'sqW', { h: 9, roof: 'none', builtBy: 'lists' }),
  B('tavern', 'tavern', 'The tavern (krčma)', 23, 90, 11, 9, [17.3, 90], 'sqE', { roof: 'shingle', sign: 'tavern' }),
  B('rychta', 'rychta', 'The rychta (headman\'s house)', 23, 111, 10, 9, [17.8, 111], 'sqE', { roof: 'shingle' }),
  B('bakery', 'bakery', 'Bakery', -9, 76, 8, 7, [-4.8, 76], 'b', { sign: 'bread' }),
  B('smithy', 'smithy', 'Smithy', 10, 70, 9, 8, [5.3, 70], 'b', { sign: 'smith', roof: 'shingle' }),
  B('butcher', 'butcher', 'Butcher\'s shambles', -9, 122, 7, 7, [-5.3, 122], 'n', { sign: 'meat' }),
  B('cobbler', 'workshop', 'Cobbler\'s workshop', 9, 123, 7, 7, [5.3, 123], 'n', { sign: 'shoe' }),
  B('weaver', 'workshop', 'Weaver\'s house', 9, 80, 7, 6, [5.3, 80], 'b'),
  B('bath', 'bath', 'Bath-house (lázeň)', -40, 80, 10, 8, [-38, 84.3], 'bath', { roof: 'shingle' }),
  B('hall', 'hall', 'Great hall of Skalice castle', castleLocal(CP.hall.x, CP.hall.z).x, castleLocal(CP.hall.x, CP.hall.z).z, CP.hall.w, CP.hall.d, [castleLocal(CP.hall.x, CP.hall.z - CP.hall.d / 2 - 0.05).x, castleLocal(CP.hall.x, CP.hall.z - CP.hall.d / 2 - 0.05).z], 'yard', { builtBy: 'castle', h: CP.hall.h, rot: CASTLE.rot }),
  B('barracks', 'barracks', 'Garrison room against the west wall', castleLocal(CP.barracks.x, CP.barracks.z).x, castleLocal(CP.barracks.x, CP.barracks.z).z, CP.barracks.w, CP.barracks.d, [castleLocal(CP.barracks.x + CP.barracks.w / 2 + 0.05, CP.barracks.z).x, castleLocal(CP.barracks.x + CP.barracks.w / 2 + 0.05, CP.barracks.z).z], 'yard', { builtBy: 'castle', roof: 'shingle', h: CP.barracks.h, rot: CASTLE.rot }),
  // homes
  B('h1', 'house', 'Farmstead', 38, 93, 9, 7, [38, 96.7], 'e1'),
  B('h2', 'house', 'Farmstead', 50, 93, 9, 7, [50, 96.7], 'e2'),
  B('h3', 'house', 'Farmstead', 38, 107, 9, 7, [38, 103.3], 'e1'),
  B('h4', 'house', 'Farmstead', 50, 107, 9, 7, [50, 103.3], 'e2'),
  B('h5', 'house', 'Farmstead', 62, 93, 8, 7, [62, 96.7], 'e2'),
  B('h6', 'cottage', 'Cottage', 62, 107, 6, 5, [62, 104.3], 'e2', { h: 2.6 }),
  B('h7', 'house', 'House', -30, 104, 8, 7, [-30, 100.3], 'w1'),
  B('h8', 'house', 'House', -48, 106, 8, 7, [-48, 102.3], 'w2'),
  B('h9', 'cottage', 'Cottage', -58, 93, 6, 5, [-58, 95.7], 'w2', { h: 2.6 }),
  B('h10', 'cottage', 'Cottage', -64, 106, 6, 5, [-64, 103.3], 'w2', { h: 2.6 }),
  B('h11', 'house', 'House', -9, 137, 7, 7, [-9, 133.3], 'n2'),
  B('h12', 'house', 'House', 9, 140, 7, 7, [9, 136.3], 'n3'),
  B('h13', 'house', 'Merchant\'s house', -22, 128, 9, 8, [-17.3, 128], 'n2', { roof: 'shingle' }),
  B('h14', 'cottage', 'Cottage', 30, 60, 6, 5, [30, 62.8], 'fieldsGate', { h: 2.6 }),
  B('h15', 'cottage', 'Cottage', 42, 64, 6, 5, [42, 61.3], 'fieldsGate', { h: 2.6 }),
  B('h16', 'house', 'Priest\'s house (fara)', -32, 116, 8, 7, [-32, 112.3], 'w1', { roof: 'shingle' }),
];
export const BUILDING = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

/** Open-air places people go to. */
export const PLACES = {
  well: { x: 2.2, z: 101, node: 'sq', name: 'the well' },
  pillory: { x: 7, z: 106, node: 'sq', name: 'the pillory (pranýř)' },
  market: { x: -3, z: 92, node: 'sq', name: 'the market square' },
  privy: { x: 31, z: 84, node: 'sqE', name: 'the privy behind the tavern' },
  fields: { x: 54, z: 44, node: 'fields', name: 'the fields' },
  gate: { x: castleLocal(-2, -22).x, z: castleLocal(-2, -22).z, node: 'gate', name: 'the castle gate' },
  yard: { x: castleLocal(-3, -4).x, z: castleLocal(-3, -4).z, node: 'yard', name: 'the castle yard' },
  joust: { x: 0, z: -14, node: 'joust', name: 'the joust field' },
  lists: { x: 10, z: 10, node: 'lists', name: 'the lists (fighting ring)' },
};

export function groundY(x, z) { return heightAt(x, z); }

/** Shortest path on the street graph (Dijkstra; the graph is tiny). */
export function path(fromNode, toNode) {
  if (fromNode === toNode) return [fromNode];
  const dist = { [fromNode]: 0 }, prev = {}, open = new Set(Object.keys(NODES));
  const adj = {};
  for (const [a, b] of EDGES) { (adj[a] ??= []).push(b); (adj[b] ??= []).push(a); }
  while (open.size) {
    let u = null;
    for (const n of open) if (dist[n] !== undefined && (u === null || dist[n] < dist[u])) u = n;
    if (u === null) break;
    open.delete(u);
    if (u === toNode) break;
    for (const v of adj[u] ?? []) {
      const [ax, az] = NODES[u], [bx, bz] = NODES[v];
      const d = dist[u] + Math.hypot(ax - bx, az - bz);
      if (dist[v] === undefined || d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  const out = [toNode];
  while (out[0] !== fromNode) { const p = prev[out[0]]; if (!p) return [fromNode, toNode]; out.unshift(p); }
  return out;
}

/** Nearest street node to a point. */
export function nearestNode(x, z) {
  let best = 'sq', bd = Infinity;
  for (const [k, [nx, nz]] of Object.entries(NODES)) { const d = Math.hypot(nx - x, nz - z); if (d < bd) { bd = d; best = k; } }
  return best;
}

export { castleLocal };

// ---- solid things: what people (and you) cannot walk through -----------------------------

/**
 * Oriented boxes on the ground: {id, x, z, hw, hd, c, s} (centre, half
 * extents along the box's own axes, cos/sin of its turn about Y).
 */
export const COLLIDERS = [];
function solid(id, x, z, w, d, rot = 0) { COLLIDERS.push({ id, x, z, hw: w / 2, hd: d / 2, c: Math.cos(rot), s: Math.sin(rot) }); }
/** A box given in castle-local coordinates. */
function castleSolid(id, lx, lz, w, d) { const p = castleLocal(lx, lz); solid(id, p.x, p.z, w, d, CASTLE.rot); }
for (const b of BUILDINGS) if (!b.rot) solid(b.id, b.x, b.z, b.w, b.d);
{
  const { x0, x1, z0, z1 } = CP.bailey, t = CP.wallT, g = CP.gate;
  castleSolid('wallN', (x0 + x1) / 2, z1, x1 - x0 + t, t);
  castleSolid('wallW', x0, (z0 + z1) / 2, t, z1 - z0 + t);
  castleSolid('wallE', x1, (z0 + z1) / 2, t, z1 - z0 + t);
  // the south wall either side of the gate tower
  const gl = g.x - g.w / 2, gr = g.x + g.w / 2;
  castleSolid('wallS1', (x0 + gl) / 2, z0, gl - x0, t);
  castleSolid('wallS2', (gr + x1) / 2, z0, x1 - gr, t);
  // the gate tower's two flanks, the passage between them
  const fw = (g.w - g.pass) / 2;
  castleSolid('gateL', gl + fw / 2, g.z, fw, g.d);
  castleSolid('gateR', gr - fw / 2, g.z, fw, g.d);
  castleSolid('keep', CP.keep.x, CP.keep.z, CP.keep.r * 1.8, CP.keep.r * 1.8);
  castleSolid('hall', CP.hall.x, CP.hall.z, CP.hall.w, CP.hall.d);
  castleSolid('barracks', CP.barracks.x, CP.barracks.z, CP.barracks.w, CP.barracks.d);
  castleSolid('stable', CP.stable.x, CP.stable.z, CP.stable.w, CP.stable.d);
  castleSolid('castleWell', CP.well.x, CP.well.z, 1.8, 1.8);
}
// things in the square (the renderer draws them at the same places)
solid('well', PLACES.well.x, PLACES.well.z, 1.9, 1.9);
solid('pillory', PLACES.pillory.x, PLACES.pillory.z, 1.3, 1.3);
solid('privyHut', PLACES.privy.x, PLACES.privy.z + 1.6, 1.3, 1.3);

/** Register more solid things (props placed by the renderer). */
export function addSolid(id, x, z, w, d, rot = 0) { solid(id, x, z, w, d, rot); }

function toLocal(o, x, z) { const dx = x - o.x, dz = z - o.z; return [dx * o.c - dz * o.s, dx * o.s + dz * o.c]; }
function toWorld(o, lx, lz) { return [o.x + lx * o.c + lz * o.s, o.z - lx * o.s + lz * o.c]; }

/** Is a point inside anything solid (grown by r)? Returns the collider or null. */
export function solidAt(x, z, r = 0, skip = null) {
  for (const o of COLLIDERS) {
    if (skip && skip.has(o.id)) continue;
    const [lx, lz] = toLocal(o, x, z);
    if (Math.abs(lx) < o.hw + r && Math.abs(lz) < o.hd + r) return o;
  }
  return null;
}

/** Push a point of radius r out of everything solid, along the shortest way. */
export function pushOut(x, z, r = 0.3, skip = null) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const o of COLLIDERS) {
      if (skip && skip.has(o.id)) continue;
      const [lx, lz] = toLocal(o, x, z);
      const px = o.hw + r - Math.abs(lx), pz = o.hd + r - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      const [nx, nz] = px < pz ? [Math.sign(lx || 1) * (o.hw + r), lz] : [lx, Math.sign(lz || 1) * (o.hd + r)];
      [x, z] = toWorld(o, nx, nz);
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/** First collider a segment crosses (each grown by r), or null. */
function blocked(ax, az, bx, bz, r, skip) {
  let best = null, bt = Infinity;
  for (const o of COLLIDERS) {
    if (skip && skip.has(o.id)) continue;
    const [x0, z0] = toLocal(o, ax, az), [x1, z1] = toLocal(o, bx, bz);
    let t0 = 0, t1 = 1;
    let ok = true;
    for (const [p, d, h] of [[x0, x1 - x0, o.hw + r], [z0, z1 - z0, o.hd + r]]) {
      if (Math.abs(d) < 1e-9) { if (p <= -h || p >= h) { ok = false; break; } continue; }
      let ta = (-h - p) / d, tb = (h - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 >= t1) { ok = false; break; }
    }
    if (ok && t0 < bt) { bt = t0; best = o; }
  }
  return best;
}

/** The point just outside a building's door, and the door itself. */
export function doorApproach(b, out = 1.3) {
  const c = Math.cos(b.rot ?? 0), s = Math.sin(b.rot ?? 0);
  const dx = b.door.x - b.x, dz = b.door.z - b.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const onX = Math.abs(lx) / b.w > Math.abs(lz) / b.d;
  const nlx = onX ? Math.sign(lx) : 0, nlz = onX ? 0 : Math.sign(lz);
  const nx = nlx * c + nlz * s, nz = -nlx * s + nlz * c;
  return { x: b.door.x + nx * out, z: b.door.z + nz * out, nx, nz };
}

/**
 * A walkable polyline through the given points: wherever a leg would cross
 * a building, wall or other solid thing, it goes round it by the corners.
 * skipFirst / skipLast: collider ids ignored on the first / last leg (the
 * building you come out of or go into).
 */
export function navRoute(points, { skipFirst = null, skipLast = null, r = 0.4 } = {}) {
  const out = [points[0]];
  const leg = (a, b, skip, depth) => {
    const hit = blocked(a[0], a[1], b[0], b[1], r, skip);
    if (!hit || depth > 4) { out.push(b); return; }
    // corners of the obstacle, grown a little more than the test
    const m = r + 0.5;
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => toWorld(hit, sx * (hit.hw + m), sz * (hit.hd + m))).filter((c) => !solidAt(c[0], c[1], 0.2));
    let best = null, bl = Infinity;
    const len = (pts) => pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    const skipHit = new Set([...(skip ?? []), hit.id]);
    for (const c of cs) {
      if (blocked(a[0], a[1], c[0], c[1], r, skip ? new Set([...skip]) : null)?.id === hit.id) continue;
      if (blocked(c[0], c[1], b[0], b[1], r, null)?.id === hit.id) continue;
      const l = len([a, c, b]); if (l < bl) { bl = l; best = [c]; }
    }
    if (!best) for (let i = 0; i < cs.length; i++) for (const j of [i + 1, i - 1]) {
      const c1 = cs[i], c2 = cs[(j + cs.length) % cs.length];
      if (!c1 || !c2) continue;
      if (blocked(a[0], a[1], c1[0], c1[1], r, null)?.id === hit.id) continue;
      if (blocked(c2[0], c2[1], b[0], b[1], r, null)?.id === hit.id) continue;
      const l = len([a, c1, c2, b]); if (l < bl) { bl = l; best = [c1, c2]; }
    }
    if (!best) { out.push(b); return; }
    let prev = a;
    for (const c of best) { leg(prev, c, skip, depth + 1); prev = c; }
    leg(prev, b, null, depth + 1);
    void skipHit;
  };
  for (let i = 1; i < points.length; i++) {
    const skip = new Set();
    if (i === 1 && skipFirst) skip.add(skipFirst);
    if (i === points.length - 1 && skipLast) skip.add(skipLast);
    leg(out[out.length - 1], points[i], skip.size ? skip : null, 0);
  }
  return out;
}
