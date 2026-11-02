/**
 * Mesh simplification by edge collapse with quadric error metrics
 * (Garland & Heckbert 1997). Vertices only ever collapse onto an existing
 * neighbour ("half-edge collapse"), so every simplified level indexes the
 * same vertex buffer as the original — exactly what both the LOD chains
 * and the cluster hierarchy want. Vertices can be locked (cluster group
 * borders, attribute seams, mesh borders) so neighbouring pieces simplified
 * independently still meet without cracks.
 *
 * Pure function on typed arrays; safe to run in a worker.
 *
 * @param {Float32Array} pos        xyz per vertex
 * @param {Uint32Array}  idx        triangle list
 * @param {number}       target     target triangle count
 * @param {object}       o          { lock: Uint8Array per vertex, maxError: metres, lockBorder: true }
 * @returns {{ indices: Uint32Array, error: number }}
 */
export function simplify(pos, idx, target, o = {}) {
  const nv = pos.length / 3;
  const nt = idx.length / 3;
  const maxErr2 = (o.maxError ?? Infinity) ** 2;
  const lock = new Uint8Array(nv);
  if (o.lock) lock.set(o.lock);
  const tri = Uint32Array.from(idx);
  const alive = new Uint8Array(nt).fill(1);
  let liveTris = nt;

  // vertex -> triangles (dynamic lists)
  const vt = new Array(nv);
  for (let i = 0; i < nv; i++) vt[i] = [];
  for (let t = 0; t < nt; t++) { vt[tri[t * 3]].push(t); vt[tri[t * 3 + 1]].push(t); vt[tri[t * 3 + 2]].push(t); }

  // Lock mesh-border vertices: an edge used by only one triangle.
  if (o.lockBorder !== false) {
    const edges = new Map();
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const a = tri[t * 3 + e], b = tri[t * 3 + (e + 1) % 3];
      const k = a < b ? a * nv + b : b * nv + a;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    for (const [k, c] of edges) if (c === 1) { lock[Math.floor(k / nv)] = 1; lock[k % nv] = 1; }
  }

  // Quadrics: plane equations of the incident triangles (unweighted, so the
  // error is a sum of squared distances in metres^2).
  const Q = new Float64Array(nv * 10);
  const W = new Float64Array(nv);   // planes accumulated per vertex
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-20) continue;
    nx /= l; ny /= l; nz /= l;
    const d = -(nx * ax + ny * ay + nz * az);
    for (const v of [a, b, c]) { addPlane(Q, v, nx, ny, nz, d); W[v] += 1; }
  }

  // Binary min-heap of candidate collapses (from -> to), lazily invalidated.
  let cap = 1 << 16, size = 0;
  let hc = new Float64Array(cap), hf = new Int32Array(cap), ht = new Int32Array(cap), hs = new Int32Array(cap);
  const stamp = new Int32Array(nv);
  const grow = () => {
    cap *= 2;
    const c2 = new Float64Array(cap); c2.set(hc); hc = c2;
    const f2 = new Int32Array(cap); f2.set(hf); hf = f2;
    const t2 = new Int32Array(cap); t2.set(ht); ht = t2;
    const s2 = new Int32Array(cap); s2.set(hs); hs = s2;
  };
  const swap = (i, j) => {
    let x = hc[i]; hc[i] = hc[j]; hc[j] = x;
    x = hf[i]; hf[i] = hf[j]; hf[j] = x;
    x = ht[i]; ht[i] = ht[j]; ht[j] = x;
    x = hs[i]; hs[i] = hs[j]; hs[j] = x;
  };
  const push = (cost, from, to) => {
    if (size === cap) grow();
    let i = size++;
    hc[i] = cost; hf[i] = from; ht[i] = to; hs[i] = stamp[from] + stamp[to] * 65536;
    while (i > 0) { const p = (i - 1) >> 1; if (hc[p] <= hc[i]) break; swap(i, p); i = p; }
  };
  const pop = () => {
    size--;
    swap(0, size);
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < size && hc[l] < hc[m]) m = l;
      if (r < size && hc[r] < hc[m]) m = r;
      if (m === i) break;
      swap(i, m); i = m;
    }
    return size;
  };
  // Sum of squared plane distances, normalised by a quarter of the planes
  // involved: close to the worst single-plane deviation, in metres^2.
  const cost = (from, to) => quadricError(Q, from, to, pos[to * 3], pos[to * 3 + 1], pos[to * 3 + 2]) / Math.max(1, (W[from] + W[to]) * 0.25);
  const considerEdge = (a, b) => {
    if (!lock[a]) push(cost(a, b), a, b);
    if (!lock[b]) push(cost(b, a), b, a);
  };
  {
    const seen = new Set();
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const a = tri[t * 3 + e], b = tri[t * 3 + (e + 1) % 3];
      const k = a < b ? a * nv + b : b * nv + a;
      if (seen.has(k)) continue;
      seen.add(k);
      considerEdge(a, b);
    }
  }

  let maxErr = 0;
  const removed = new Uint8Array(nv);
  while (size > 0 && liveTris > target) {
    const c = hc[0], from = hf[0], to = ht[0], st = hs[0];
    pop();
    if (removed[from] || removed[to]) continue;
    if (st !== stamp[from] + stamp[to] * 65536) continue;   // stale entry
    if (c > maxErr2) break;
    // still an edge?
    const tf = vt[from];
    let shared = false;
    for (let k = 0; k < tf.length; k++) { const t = tf[k]; if (!alive[t]) continue; if (tri[t * 3] === to || tri[t * 3 + 1] === to || tri[t * 3 + 2] === to) { shared = true; break; } }
    if (!shared) continue;
    // reject collapses that flip or degenerate a triangle
    let ok = true;
    for (let k = 0; k < tf.length && ok; k++) {
      const t = tf[k];
      if (!alive[t]) continue;
      const a = tri[t * 3], b = tri[t * 3 + 1], cc = tri[t * 3 + 2];
      if (a === to || b === to || cc === to) continue;
      ok = !flips(pos, a, b, cc, from, to);
    }
    if (!ok) continue;
    // collapse from -> to
    for (let k = 0; k < tf.length; k++) {
      const t = tf[k];
      if (!alive[t]) continue;
      const o3 = t * 3;
      if (tri[o3] === to || tri[o3 + 1] === to || tri[o3 + 2] === to) { alive[t] = 0; liveTris--; continue; }
      for (let e = 0; e < 3; e++) if (tri[o3 + e] === from) tri[o3 + e] = to;
      vt[to].push(t);
    }
    removed[from] = 1;
    vt[from] = [];
    for (let k = 0; k < 10; k++) Q[to * 10 + k] += Q[from * 10 + k];
    W[to] += W[from];
    if (c > maxErr) maxErr = c;
    stamp[to]++;
    // compact to's list and requeue its edges
    const list = vt[to].filter((t) => alive[t]);
    vt[to] = list;
    const nb = new Set();
    for (const t of list) for (let e = 0; e < 3; e++) { const v = tri[t * 3 + e]; if (v !== to) nb.add(v); }
    // only edges touching `to` changed cost; the stamp on `to` invalidates their old entries
    for (const v of nb) considerEdge(to, v);
  }
  const out = new Uint32Array(liveTris * 3);
  let j = 0;
  for (let t = 0; t < nt; t++) if (alive[t]) { out[j++] = tri[t * 3]; out[j++] = tri[t * 3 + 1]; out[j++] = tri[t * 3 + 2]; }
  return { indices: out, error: Math.sqrt(maxErr) };
}

function addPlane(Q, v, a, b, c, d) {
  const o = v * 10;
  Q[o] += a * a; Q[o + 1] += a * b; Q[o + 2] += a * c; Q[o + 3] += a * d;
  Q[o + 4] += b * b; Q[o + 5] += b * c; Q[o + 6] += b * d;
  Q[o + 7] += c * c; Q[o + 8] += c * d; Q[o + 9] += d * d;
}

function quadricError(Q, u, v, x, y, z) {
  const a = u * 10, b = v * 10;
  const q0 = Q[a] + Q[b], q1 = Q[a + 1] + Q[b + 1], q2 = Q[a + 2] + Q[b + 2], q3 = Q[a + 3] + Q[b + 3];
  const q4 = Q[a + 4] + Q[b + 4], q5 = Q[a + 5] + Q[b + 5], q6 = Q[a + 6] + Q[b + 6];
  const q7 = Q[a + 7] + Q[b + 7], q8 = Q[a + 8] + Q[b + 8], q9 = Q[a + 9] + Q[b + 9];
  const e = q0 * x * x + 2 * q1 * x * y + 2 * q2 * x * z + 2 * q3 * x + q4 * y * y + 2 * q5 * y * z + 2 * q6 * y + q7 * z * z + 2 * q8 * z + q9;
  return Math.max(e, 0);
}

/** Does moving vertex `from` to `to` flip triangle (a,b,c) (which contains `from`)? */
function flips(pos, a, b, c, from, to) {
  const n0 = normal(pos, a, b, c, -1, -1);
  const n1 = normal(pos, a, b, c, from, to);
  const l0 = Math.hypot(n0[0], n0[1], n0[2]), l1 = Math.hypot(n1[0], n1[1], n1[2]);
  if (l1 < 1e-14) return true;
  if (l0 < 1e-14) return false;
  return (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * l1) < 0.25;
}
function normal(pos, a, b, c, from, to) {
  if (a === from) a = to; if (b === from) b = to; if (c === from) c = to;
  const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
  const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * Welds vertices that share a position (within eps), returning a remap
 * array and the canonical positions — needed before simplifying meshes
 * whose triangles were exported unindexed (flat shading).
 */
export function weld(pos, eps = 1e-5) {
  const n = pos.length / 3;
  const remap = new Uint32Array(n);
  const map = new Map();
  const out = [];
  const inv = 1 / eps;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * inv)},${Math.round(pos[i * 3 + 1] * inv)},${Math.round(pos[i * 3 + 2] * inv)}`;
    let j = map.get(k);
    if (j === undefined) { j = out.length / 3; map.set(k, j); out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    remap[i] = j;
  }
  return { remap, positions: new Float32Array(out), count: out.length / 3 };
}
