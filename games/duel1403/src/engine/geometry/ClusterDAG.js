import { simplify } from './Simplify.js';

/**
 * Builds a cluster hierarchy ("virtual geometry", after Karis et al.,
 * Nanite, SIGGRAPH 2021) for one triangle mesh:
 *
 *   1. split the triangles into clusters of at most 128 connected triangles;
 *   2. gather neighbouring clusters into groups of ~4;
 *   3. simplify each group to half its triangles with the group's outer
 *      border locked, so it still meets its neighbours exactly;
 *   4. split the result into new clusters (the next, coarser level) and repeat.
 *
 * Every cluster records the error and bounds of the group it was made from
 * (its own LOD) and of the group it was folded into (its parent). At run
 * time a cluster is drawn when its own error is invisible but its parent's
 * would not be — a cut through the DAG that is crack-free by construction.
 *
 * Output (all typed arrays, transferable from a worker):
 *   indices   Uint32Array, every cluster's triangles back to back
 *   clusters  Float32Array, STRIDE floats per cluster (see FIELD)
 */
export const STRIDE = 20;
export const FIELD = {
  start: 0, count: 1,
  selfErr: 2, sx: 3, sy: 4, sz: 5, sr: 6,           // LOD sphere + error of this cluster
  parentErr: 7, px: 8, py: 9, pz: 10, pr: 11,       // ... of its parent group
  cx: 12, cy: 13, cz: 14, cr: 15,                   // tight culling sphere
  ax: 16, ay: 17, az: 18, cone: 19,                 // normal cone (axis, half-angle; >= PI/2 = no culling)
  level: -1,
};

export function buildDAG(pos, idx, { clusterSize = 128, groupSize = 4, maxLevels = 24, onProgress = null } = {}) {
  const nv = pos.length / 3;
  const all = [];          // final cluster records
  let level = 0;
  // level 0 clusters
  let current = partition(pos, idx, clusterSize).map((tris) => makeCluster(pos, tris, 0, null));
  for (const c of current) all.push(c);
  while (current.length > 1 && level < maxLevels) {
    onProgress?.(level, current.length);
    const groups = groupClusters(pos, current, groupSize, nv);
    const next = [];
    let progressed = false;
    for (const g of groups) {
      const members = g.map((i) => current[i]);
      const tris = concat(members.map((m) => m.tris));
      const target = Math.max(2, Math.floor(tris.length / 3 / 2));
      // Simplify in group-local vertex numbering. Edges used by only one of
      // the group's triangles are its outer border (or the mesh's): the
      // simplifier locks them, so the group still meets its neighbours.
      const r = simplifyLocal(pos, tris, target);
      const childErr = Math.max(...members.map((m) => m.selfErr));
      const err = Math.max(childErr, r.error) + 1e-6;
      const sphere = mergeSpheres(members.map((m) => m.lodSphere));
      for (const m of members) { m.parentErr = err; m.parentSphere = sphere; }
      if (r.indices.length > tris.length * 0.85 || g.length === 1 && current.length > 1 && r.indices.length >= tris.length) {
        // could not simplify this group: its clusters carry on unchanged as roots
        for (const m of members) { m.parentErr = Infinity; }
        continue;
      }
      progressed = true;
      for (const t of partition(pos, r.indices, clusterSize)) {
        const c = makeCluster(pos, t, err, sphere);
        next.push(c);
        all.push(c);
      }
    }
    if (!progressed || !next.length) break;
    current = next;
    level++;
  }
  for (const c of current) if (c.parentErr === undefined) c.parentErr = Infinity;
  // pack
  let total = 0;
  for (const c of all) total += c.tris.length;
  const indices = new Uint32Array(total);
  const clusters = new Float32Array(all.length * STRIDE);
  let off = 0;
  all.forEach((c, i) => {
    indices.set(c.tris, off);
    const o = i * STRIDE;
    clusters[o] = off; clusters[o + 1] = c.tris.length;
    clusters[o + 2] = c.selfErr; clusters.set(c.lodSphere, o + 3);
    clusters[o + 7] = c.parentErr === Infinity ? 3.4e38 : c.parentErr ?? 3.4e38;
    clusters.set(c.parentSphere ?? c.lodSphere, o + 8);
    clusters.set(c.bounds, o + 12);
    clusters.set(c.coneArr, o + 16);
    off += c.tris.length;
  });
  return { indices, clusters, count: all.length, levels: level + 1 };
}

function simplifyLocal(pos, tris, target) {
  const map = new Map();
  const local = new Uint32Array(tris.length);
  const lp = [];
  const back = [];
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i];
    let j = map.get(v);
    if (j === undefined) { j = back.length; map.set(v, j); back.push(v); lp.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
    local[i] = j;
  }
  const r = simplify(new Float32Array(lp), local, target, { lockBorder: true });
  const out = new Uint32Array(r.indices.length);
  for (let i = 0; i < out.length; i++) out[i] = back[r.indices[i]];
  return { indices: out, error: r.error };
}

function concat(arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint32Array(n); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function makeCluster(pos, tris, selfErr, lodSphere) {
  const bounds = boundingSphere(pos, tris);
  return { tris, selfErr, lodSphere: lodSphere ?? bounds, bounds, coneArr: normalCone(pos, tris), parentErr: undefined, parentSphere: null };
}

/** Splits a triangle list into connected clusters of at most `max` triangles (greedy BFS from a spatial seed order). */
export function partition(pos, idx, max) {
  const nt = idx.length / 3;
  if (nt <= max) return [Uint32Array.from(idx)];
  // triangle adjacency through shared edges
  const edgeTri = new Map();
  const nv = pos.length / 3;
  const adj = new Int32Array(nt * 3).fill(-1);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const a = idx[t * 3 + e], b = idx[t * 3 + (e + 1) % 3];
    const k = a < b ? a * nv + b : b * nv + a;
    const o = edgeTri.get(k);
    if (o === undefined) edgeTri.set(k, t * 3 + e);
    else { const ot = Math.floor(o / 3); adj[t * 3 + e] = ot; adj[o] = t; }
  }
  // seed order: Morton code of centroids
  const cen = new Float32Array(nt * 3);
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const c = (pos[idx[t * 3] * 3 + k] + pos[idx[t * 3 + 1] * 3 + k] + pos[idx[t * 3 + 2] * 3 + k]) / 3;
    cen[t * 3 + k] = c; if (c < mn[k]) mn[k] = c; if (c > mx[k]) mx[k] = c;
  }
  const codes = new Float64Array(nt);
  const order = new Uint32Array(nt);
  for (let t = 0; t < nt; t++) {
    const q = [0, 1, 2].map((k) => Math.min(1023, Math.floor(((cen[t * 3 + k] - mn[k]) / Math.max(mx[k] - mn[k], 1e-9)) * 1023)));
    codes[t] = morton3(q[0], q[1], q[2]);
    order[t] = t;
  }
  order.sort((a, b) => codes[a] - codes[b]);
  const assigned = new Int32Array(nt).fill(-1);
  const out = [];
  const queue = new Int32Array(nt);
  for (let s = 0; s < nt; s++) {
    const seed = order[s];
    if (assigned[seed] >= 0) continue;
    const id = out.length;
    const tris = [];
    let qh = 0, qt = 0;
    queue[qt++] = seed; assigned[seed] = id;
    const sx = cen[seed * 3], sy = cen[seed * 3 + 1], sz = cen[seed * 3 + 2];
    while (qh < qt && tris.length < max) {
      // pick the queued triangle closest to the seed (keeps clusters round)
      let best = qh, bd = Infinity;
      for (let q = qh; q < Math.min(qt, qh + 24); q++) {
        const t = queue[q];
        const d = (cen[t * 3] - sx) ** 2 + (cen[t * 3 + 1] - sy) ** 2 + (cen[t * 3 + 2] - sz) ** 2;
        if (d < bd) { bd = d; best = q; }
      }
      const t = queue[best]; queue[best] = queue[qh]; queue[qh] = t; qh++;
      tris.push(t);
      for (let e = 0; e < 3; e++) {
        const n = adj[t * 3 + e];
        if (n >= 0 && assigned[n] < 0) { assigned[n] = id; queue[qt++] = n; }
      }
    }
    // anything queued but not taken goes back to the pool
    for (let q = qh; q < qt; q++) assigned[queue[q]] = -1;
    const arr = new Uint32Array(tris.length * 3);
    tris.forEach((t, i) => { arr[i * 3] = idx[t * 3]; arr[i * 3 + 1] = idx[t * 3 + 1]; arr[i * 3 + 2] = idx[t * 3 + 2]; });
    out.push(arr);
  }
  return out;
}

function morton3(x, y, z) {
  const s = (v) => { v = (v | (v << 16)) & 0x030000ff; v = (v | (v << 8)) & 0x0300f00f; v = (v | (v << 4)) & 0x030c30c3; v = (v | (v << 2)) & 0x09249249; return v; };
  return s(x) + s(y) * 2 + s(z) * 4;
}

/** Groups clusters with their most-connected unassigned neighbours. */
function groupClusters(pos, clusters, size, nv) {
  const n = clusters.length;
  const edgeOwner = new Map();
  const shared = new Array(n).fill(0).map(() => new Map());
  clusters.forEach((c, ci) => {
    const t = c.tris;
    for (let i = 0; i < t.length; i += 3) for (let e = 0; e < 3; e++) {
      const a = t[i + e], b = t[i + (e + 1) % 3];
      const k = a < b ? a * nv + b : b * nv + a;
      const o = edgeOwner.get(k);
      if (o === undefined) edgeOwner.set(k, ci);
      else if (o !== ci) { shared[ci].set(o, (shared[ci].get(o) ?? 0) + 1); shared[o].set(ci, (shared[o].get(ci) ?? 0) + 1); }
    }
  });
  const cen = clusters.map((c) => c.bounds);
  const order = [...clusters.keys()].sort((a, b) => cen[a][0] - cen[b][0] || cen[a][2] - cen[b][2]);
  const taken = new Uint8Array(n);
  const groups = [];
  for (const c of order) {
    if (taken[c]) continue;
    const g = [c]; taken[c] = 1;
    while (g.length < size) {
      let best = -1, bw = 0;
      for (const m of g) for (const [nb, w] of shared[m]) if (!taken[nb] && w > bw) { bw = w; best = nb; }
      if (best < 0) break;
      g.push(best); taken[best] = 1;
    }
    groups.push(g);
  }
  void pos;
  return groups;
}

function boundingSphere(pos, tris) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) for (let k = 0; k < 3; k++) { const v = pos[tris[i] * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  let r = 0;
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i];
    r = Math.max(r, Math.hypot(pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]));
  }
  return [c[0], c[1], c[2], r];
}

function mergeSpheres(sp) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const s of sp) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], s[k] - s[3]); mx[k] = Math.max(mx[k], s[k] + s[3]); }
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  let r = 0;
  for (const s of sp) r = Math.max(r, Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2]) + s[3]);
  return [c[0], c[1], c[2], r];
}

function normalCone(pos, tris) {
  let ax = 0, ay = 0, az = 0;
  const ns = [];
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-20) continue;
    ns.push(nx / l, ny / l, nz / l);
    ax += nx; ay += ny; az += nz;
  }
  const l = Math.hypot(ax, ay, az);
  if (l < 1e-12) return [0, 1, 0, 10];
  ax /= l; ay /= l; az /= l;
  let maxA = 0;
  for (let i = 0; i < ns.length; i += 3) maxA = Math.max(maxA, Math.acos(Math.max(-1, Math.min(1, ns[i] * ax + ns[i + 1] * ay + ns[i + 2] * az))));
  return [ax, ay, az, maxA];
}
