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

// Castle transform as built in Lists.js (position, rotation about Y).
const CASTLE = { x: 30, z: 230, rot: 0.3 };
function castleLocal(lx, lz) {
  const c = Math.cos(CASTLE.rot), s = Math.sin(CASTLE.rot);
  return { x: CASTLE.x + lx * c + lz * s, z: CASTLE.z - lx * s + lz * c };
}
const gate = castleLocal(-2, -15);
const yard = castleLocal(-4, -7);

/** Street graph: id -> [x, z]. */
export const NODES = {
  joust: [0, -12], lists: [14, 14], south: [0, 40], b: [0, 70], sq: [0, 100], n: [0, 132],
  sqE: [14, 100], sqW: [-12, 96], e1: [32, 100], e2: [52, 100], w1: [-32, 92], w2: [-55, 100],
  bath: [-38, 88], fields: [52, 48], fieldsGate: [30, 56], c1: [8, 152], c2: [16, 186], gate: [gate.x - 1.5, gate.z - 4], yard: [yard.x, yard.z],
  n2: [-14, 136], n3: [14, 138],
};
export const EDGES = [
  ['joust', 'lists'], ['lists', 'south'], ['south', 'b'], ['b', 'sq'], ['sq', 'n'], ['sq', 'sqE'], ['sq', 'sqW'],
  ['sqE', 'e1'], ['e1', 'e2'], ['sqW', 'w1'], ['w1', 'w2'], ['w1', 'bath'], ['south', 'fieldsGate'], ['fieldsGate', 'fields'],
  ['n', 'c1'], ['c1', 'c2'], ['c2', 'gate'], ['gate', 'yard'], ['n', 'n2'], ['n', 'n3'], ['b', 'fieldsGate'],
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
  B('hall', 'hall', 'Great hall of Skalice castle', castleLocal(13, 2).x, castleLocal(13, 2).z, 18, 9, [yard.x + 2, yard.z + 2], 'yard', { builtBy: 'lists', h: 11 }),
  B('barracks', 'barracks', 'Garrison room in the gate tower', castleLocal(-14, -4).x, castleLocal(-14, -4).z, 8, 6, [yard.x - 3, yard.z], 'yard', { builtBy: 'castle-extra', roof: 'shingle' }),
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
  gate: { x: gate.x - 1.5, z: gate.z - 3, node: 'gate', name: 'the castle gate' },
  yard: { x: yard.x, z: yard.z, node: 'yard', name: 'the castle yard' },
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
