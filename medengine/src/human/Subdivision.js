/**
 * Catmull-Clark subdivision as a linear operator.
 *
 * Every vertex of the subdivided mesh is a weighted sum of the original vertices (a "stencil").
 * Because subdivision is linear, the same stencils carry anything defined per vertex: positions,
 * skin weights, morph-target deltas. So a character is stored at base resolution and smoothed
 * at load, with its face shapes and skinning smoothed exactly like its surface.
 *
 * Input:  n vertices, polygon faces {start[], idx[]} (start has faces+1 entries), and optional
 *         face-varying uvs {uv[], tidx[]} (tidx parallel to idx).
 * Output: { count, stencils: {start, src, w}, faces (quads) {v[], t[]}, uv[] }
 *         Vertex order: original vertex points, then edge points, then face points.
 *
 * Boundaries (and edges shared by more than two faces) follow the crease rules: boundary edge
 * points are midpoints and boundary vertices only mix with their boundary neighbours, so open
 * edges (where a garment hides the body, a sleeve's cuff) do not shrink.
 */
export function subdivide(n, faces, uvs = null) {
  const F = faces.start.length - 1;
  const fidx = faces.idx;
  // ---- edges
  const edgeMap = new Map();      // key a*n+b (a<b) -> edge id
  const edgeA = [], edgeB = [], edgeFaces = [];
  const faceEdges = new Int32Array(fidx.length);
  for (let f = 0; f < F; f++) {
    const s = faces.start[f], e = faces.start[f + 1], k = e - s;
    for (let i = 0; i < k; i++) {
      const a = fidx[s + i], b = fidx[s + ((i + 1) % k)];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const key = lo * n + hi;
      let id = edgeMap.get(key);
      if (id === undefined) { id = edgeA.length; edgeMap.set(key, id); edgeA.push(lo); edgeB.push(hi); edgeFaces.push([]); }
      edgeFaces[id].push(f);
      faceEdges[s + i] = id;
    }
  }
  const E = edgeA.length;
  const boundaryEdge = new Uint8Array(E);
  for (let e = 0; e < E; e++) boundaryEdge[e] = edgeFaces[e].length !== 2 ? 1 : 0;
  // ---- vertex adjacency
  const vFaces = Array.from({ length: n }, () => []);
  const vEdges = Array.from({ length: n }, () => []);
  for (let f = 0; f < F; f++) for (let j = faces.start[f]; j < faces.start[f + 1]; j++) vFaces[fidx[j]].push(f);
  for (let e = 0; e < E; e++) { vEdges[edgeA[e]].push(e); vEdges[edgeB[e]].push(e); }

  // ---- stencils (sparse rows over original vertices)
  const rows = new Array(n + E + F);
  const facePoint = (f) => {
    const s = faces.start[f], e = faces.start[f + 1], k = e - s;
    const r = new Map();
    for (let j = s; j < e; j++) r.set(fidx[j], (r.get(fidx[j]) ?? 0) + 1 / k);
    return r;
  };
  const fp = new Array(F);
  for (let f = 0; f < F; f++) { fp[f] = facePoint(f); rows[n + E + f] = fp[f]; }
  const add = (r, src, w) => { for (const [i, x] of src) r.set(i, (r.get(i) ?? 0) + x * w); };
  for (let e = 0; e < E; e++) {
    const r = new Map();
    if (boundaryEdge[e]) { r.set(edgeA[e], 0.5); r.set(edgeB[e], 0.5); }
    else {
      r.set(edgeA[e], 0.25); r.set(edgeB[e], 0.25);
      add(r, fp[edgeFaces[e][0]], 0.25); add(r, fp[edgeFaces[e][1]], 0.25);
    }
    rows[n + e] = r;
  }
  for (let v = 0; v < n; v++) {
    const r = new Map();
    const es = vEdges[v];
    if (!es.length) { r.set(v, 1); rows[v] = r; continue; }
    const bEdges = es.filter((e) => boundaryEdge[e]);
    if (bEdges.length) {
      if (bEdges.length === 2 && vFaces[v].length > 1) {
        r.set(v, 0.75);
        for (const e of bEdges) { const o = edgeA[e] === v ? edgeB[e] : edgeA[e]; r.set(o, (r.get(o) ?? 0) + 0.125); }
      } else r.set(v, 1);   // corner or non-manifold: keep
    } else {
      const k = es.length;
      const fs = vFaces[v];
      // (Q + 2R + (k-3)S) / k with Q = mean face point, R = mean edge midpoint
      for (const f of fs) add(r, fp[f], 1 / (fs.length * k));
      for (const e of es) {
        r.set(edgeA[e], (r.get(edgeA[e]) ?? 0) + (2 / k) * 0.5 / k);
        r.set(edgeB[e], (r.get(edgeB[e]) ?? 0) + (2 / k) * 0.5 / k);
      }
      r.set(v, (r.get(v) ?? 0) + (k - 3) / k);
    }
    rows[v] = r;
  }
  // pack
  const start = new Uint32Array(rows.length + 1);
  let total = 0;
  for (let i = 0; i < rows.length; i++) { start[i] = total; total += rows[i].size; }
  start[rows.length] = total;
  const src = new Uint32Array(total), w = new Float32Array(total);
  for (let i = 0, o = 0; i < rows.length; i++) for (const [s, x] of rows[i]) { src[o] = s; w[o] = x; o++; }

  // ---- new faces (quads), with face-varying uvs
  const qv = new Uint32Array(fidx.length * 4);
  let qt = null, newUv = null;
  if (uvs) {
    // uv list: original uvs, then per-face edge uvs, then per-face centre uvs
    const U = uvs.uv.length / 2;
    newUv = new Float32Array((U + fidx.length + F) * 2);
    newUv.set(uvs.uv);
    qt = new Uint32Array(fidx.length * 4);
    for (let f = 0; f < F; f++) {
      const s = faces.start[f], e = faces.start[f + 1], k = e - s;
      let cu = 0, cv = 0;
      for (let j = s; j < e; j++) { cu += uvs.uv[uvs.tidx[j] * 2]; cv += uvs.uv[uvs.tidx[j] * 2 + 1]; }
      const centre = U + fidx.length + f;
      newUv[centre * 2] = cu / k; newUv[centre * 2 + 1] = cv / k;
      for (let i = 0; i < k; i++) {
        const a = uvs.tidx[s + i], b = uvs.tidx[s + ((i + 1) % k)];
        const ei = U + s + i;
        newUv[ei * 2] = (uvs.uv[a * 2] + uvs.uv[b * 2]) / 2;
        newUv[ei * 2 + 1] = (uvs.uv[a * 2 + 1] + uvs.uv[b * 2 + 1]) / 2;
      }
    }
  }
  for (let f = 0, q = 0; f < F; f++) {
    const s = faces.start[f], e = faces.start[f + 1], k = e - s;
    const U = uvs ? uvs.uv.length / 2 : 0;
    for (let i = 0; i < k; i++) {
      const prev = (i + k - 1) % k;
      qv[q * 4] = fidx[s + i];
      qv[q * 4 + 1] = n + faceEdges[s + i];
      qv[q * 4 + 2] = n + E + f;
      qv[q * 4 + 3] = n + faceEdges[s + prev];
      if (uvs) {
        qt[q * 4] = uvs.tidx[s + i];
        qt[q * 4 + 1] = U + s + i;
        qt[q * 4 + 2] = U + fidx.length + f;
        qt[q * 4 + 3] = U + s + prev;
      }
      q++;
    }
  }
  return { count: rows.length, stencils: { start, src, w }, quads: { v: qv, t: qt }, uv: newUv };
}

/** Applies stencils to per-vertex data of `width` floats. */
export function applyStencils(st, data, width, count) {
  const out = new Float32Array(count * width);
  for (let i = 0; i < count; i++) {
    for (let j = st.start[i]; j < st.start[i + 1]; j++) {
      const s = st.src[j] * width, x = st.w[j], o = i * width;
      for (let c = 0; c < width; c++) out[o + c] += data[s + c] * x;
    }
  }
  return out;
}

/** Skin weights through stencils: blends each source's 4 influences, keeps the strongest 4. */
export function applyStencilsSkin(st, joints, weights, count) {
  const J = new Uint8Array(count * 4), W = new Float32Array(count * 4);
  const acc = new Map();
  for (let i = 0; i < count; i++) {
    acc.clear();
    for (let j = st.start[i]; j < st.start[i + 1]; j++) {
      const s = st.src[j] * 4, x = st.w[j];
      for (let c = 0; c < 4; c++) { const wt = weights[s + c]; if (wt > 0) acc.set(joints[s + c], (acc.get(joints[s + c]) ?? 0) + wt * x); }
    }
    const top = [...acc.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((a, [, v]) => a + v, 0) || 1;
    top.forEach(([b, v], c) => { J[i * 4 + c] = b; W[i * 4 + c] = v / sum; });
    if (!top.length) W[i * 4] = 1;
  }
  return { joints: J, weights: W };
}

/** Repeated subdivision, composing stencils so data is applied once from the base. */
export function subdivideLevels(n, faces, uvs, levels) {
  let cur = { count: n, quads: null, uv: uvs?.uv ?? null };
  let stencil = null;
  let curFaces = faces, curUvs = uvs;
  for (let l = 0; l < levels; l++) {
    const s = subdivide(cur.count, curFaces, curUvs);
    stencil = stencil ? compose(s.stencils, stencil, s.count) : s.stencils;
    const nq = s.quads.v.length / 4;
    const start = new Uint32Array(nq + 1);
    for (let i = 0; i <= nq; i++) start[i] = i * 4;
    curFaces = { start, idx: s.quads.v };
    curUvs = uvs ? { uv: s.uv, tidx: s.quads.t } : null;
    cur = s;
  }
  return { count: cur.count, stencils: stencil, quads: { v: curFaces.idx, t: curUvs?.tidx ?? null }, uv: curUvs?.uv ?? null };
}

function compose(outer, inner, count) {
  const rows = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const r = new Map();
    for (let j = outer.start[i]; j < outer.start[i + 1]; j++) {
      const m = outer.src[j], x = outer.w[j];
      for (let k = inner.start[m]; k < inner.start[m + 1]; k++) r.set(inner.src[k], (r.get(inner.src[k]) ?? 0) + inner.w[k] * x);
    }
    rows.push(r); total += r.size;
  }
  const start = new Uint32Array(count + 1), src = new Uint32Array(total), w = new Float32Array(total);
  for (let i = 0, o = 0; i < count; i++) { start[i] = o; for (const [s, x] of rows[i]) { src[o] = s; w[o] = x; o++; } }
  start[count] = total;
  return { start, src, w };
}
