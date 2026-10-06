import { Texture } from '../gl/GL.js';

/**
 * A bounding volume hierarchy over the static world's triangles, built once
 * on the CPU with the binned surface-area heuristic (12 bins, leaves of up
 * to 4 triangles) and packed into float textures for traversal in shaders:
 *
 *   uBvhNode (RGBA32F, 2 texels a node):  min.xyz, a | max.xyz, b
 *       inner: a = left child, b = right child
 *       leaf:  a = first triangle, b = -(count)
 *   uBvhTri  (RGBA32F, 3 texels a triangle, in leaf order):
 *       v0.xyz, original triangle id | edge1.xyz, 0 | edge2.xyz, 0
 *
 * The original id leads back to the StaticScene for materials and uvs.
 */
export const BVH_W = 2048;

export function buildBVH(positions, triCount) {
  // triangle bounds and centroids (padding triangles, far below the world, are dropped)
  const ids = [];
  const bmin = new Float32Array(triCount * 3), bmax = new Float32Array(triCount * 3), cen = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const o = t * 12;
    const y0 = positions[o + 1], y1 = positions[o + 5], y2 = positions[o + 9];
    if (y0 < -5000 && y1 < -5000) continue;
    for (let k = 0; k < 3; k++) {
      const a = positions[o + k], b = positions[o + 4 + k], c = positions[o + 8 + k];
      bmin[t * 3 + k] = Math.min(a, b, c); bmax[t * 3 + k] = Math.max(a, b, c); cen[t * 3 + k] = (a + b + c) / 3;
    }
    // skip degenerate triangles
    const ex = positions[o + 4] - positions[o], ey = positions[o + 5] - positions[o + 1], ez = positions[o + 6] - positions[o + 2];
    const fx = positions[o + 8] - positions[o], fy = positions[o + 9] - positions[o + 1], fz = positions[o + 10] - positions[o + 2];
    const cx = ey * fz - ez * fy, cy = ez * fx - ex * fz, cz = ex * fy - ey * fx;
    if (cx * cx + cy * cy + cz * cz < 1e-14) continue;
    ids.push(t);
  }
  const tris = Int32Array.from(ids);
  const nodes = [];      // {min:[3], max:[3], a, b}
  const BINS = 12;
  const stack = [[0, tris.length, -1, 0]];   // start, end, parent, side
  const area = (mn, mx) => { const x = mx[0] - mn[0], y = mx[1] - mn[1], z = mx[2] - mn[2]; return x * y + y * z + z * x; };
  while (stack.length) {
    const [s, e, parent, side] = stack.pop();
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], cmn = [Infinity, Infinity, Infinity], cmx = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const t = tris[i];
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], bmin[t * 3 + k]); mx[k] = Math.max(mx[k], bmax[t * 3 + k]);
        cmn[k] = Math.min(cmn[k], cen[t * 3 + k]); cmx[k] = Math.max(cmx[k], cen[t * 3 + k]);
      }
    }
    const idx = nodes.length;
    nodes.push({ min: mn, max: mx, a: s, b: -(e - s) });
    if (parent >= 0) { if (side === 0) nodes[parent].a = idx; else nodes[parent].b = idx; }
    const n = e - s;
    if (n <= 4) continue;
    // binned SAH along each axis
    let best = { cost: Infinity, axis: -1, split: 0 };
    for (let ax = 0; ax < 3; ax++) {
      const lo = cmn[ax], hi = cmx[ax];
      if (hi - lo < 1e-6) continue;
      const cnt = new Int32Array(BINS), bbn = [], bbx = [];
      for (let b = 0; b < BINS; b++) { bbn.push([Infinity, Infinity, Infinity]); bbx.push([-Infinity, -Infinity, -Infinity]); }
      for (let i = s; i < e; i++) {
        const t = tris[i];
        const b = Math.min(BINS - 1, Math.floor(((cen[t * 3 + ax] - lo) / (hi - lo)) * BINS));
        cnt[b]++;
        for (let k = 0; k < 3; k++) { bbn[b][k] = Math.min(bbn[b][k], bmin[t * 3 + k]); bbx[b][k] = Math.max(bbx[b][k], bmax[t * 3 + k]); }
      }
      for (let split = 1; split < BINS; split++) {
        const ln = [Infinity, Infinity, Infinity], lx = [-Infinity, -Infinity, -Infinity], rn = [Infinity, Infinity, Infinity], rx = [-Infinity, -Infinity, -Infinity];
        let lc = 0, rc = 0;
        for (let b = 0; b < split; b++) { lc += cnt[b]; for (let k = 0; k < 3; k++) { ln[k] = Math.min(ln[k], bbn[b][k]); lx[k] = Math.max(lx[k], bbx[b][k]); } }
        for (let b = split; b < BINS; b++) { rc += cnt[b]; for (let k = 0; k < 3; k++) { rn[k] = Math.min(rn[k], bbn[b][k]); rx[k] = Math.max(rx[k], bbx[b][k]); } }
        if (!lc || !rc) continue;
        const cost = lc * area(ln, lx) + rc * area(rn, rx);
        if (cost < best.cost) best = { cost, axis: ax, split, lo, hi };
      }
    }
    let mid;
    if (best.axis < 0) mid = s + (n >> 1);
    else {
      // partition in place
      let i = s, j = e - 1;
      const ax = best.axis;
      while (i <= j) {
        const b = Math.min(BINS - 1, Math.floor(((cen[tris[i] * 3 + ax] - best.lo) / (best.hi - best.lo)) * BINS));
        if (b < best.split) i++; else { const tmp = tris[i]; tris[i] = tris[j]; tris[j] = tmp; j--; }
      }
      mid = i;
      if (mid === s || mid === e) mid = s + (n >> 1);
    }
    nodes[idx].a = -1; nodes[idx].b = -1;
    stack.push([mid, e, idx, 1]);
    stack.push([s, mid, idx, 0]);
  }
  return { nodes, tris };
}

/** Pack a built BVH (flat nodes: 8 floats each, and the triangle order) into textures. */
export class BVHTextures {
  constructor(gl, positions, { nodes, tris, ms }) {
    this.buildMs = ms;
    this.nodeCount = nodes.length / 8;
    this.triCount = tris.length;
    const nRows = Math.ceil((this.nodeCount * 2) / BVH_W);
    const nd = new Float32Array(BVH_W * nRows * 4);
    nd.set(nodes);
    this.node = new Texture(gl, { width: BVH_W, height: nRows, format: 'rgba32f', filter: 'nearest' });
    this.node.upload(nd);
    const tRows = Math.ceil((tris.length * 3) / BVH_W);
    const td = new Float32Array(BVH_W * tRows * 4);
    tris.forEach((t, i) => {
      const o = t * 12;
      const v0 = [positions[o], positions[o + 1], positions[o + 2]];
      td.set([v0[0], v0[1], v0[2], t,
        positions[o + 4] - v0[0], positions[o + 5] - v0[1], positions[o + 6] - v0[2], 0,
        positions[o + 8] - v0[0], positions[o + 9] - v0[1], positions[o + 10] - v0[2], 0], i * 12);
    });
    this.tri = new Texture(gl, { width: BVH_W, height: tRows, format: 'rgba32f', filter: 'nearest' });
    this.tri.upload(td);
  }
  bind(p) { return p.set('uBvhNode', this.node).set('uBvhTri', this.tri); }
}

/** Traversal in GLSL: any hit (shadows) and closest hit (path tracing), plus capsules for people. */
export const BVH_GLSL = /* glsl */`
uniform highp sampler2D uBvhNode, uBvhTri;
const int BVH_W = ${BVH_W};
// people as capsules: a texture of (a.xyz, radius), (b.xyz, 0) pairs, refreshed every frame
uniform highp sampler2D uCaps;
uniform int uCapCount;
vec4 bvhNode(int i, int k) { int t = i * 2 + k; return texelFetch(uBvhNode, ivec2(t % BVH_W, t / BVH_W), 0); }
vec4 bvhTri(int i, int k) { int t = i * 3 + k; return texelFetch(uBvhTri, ivec2(t % BVH_W, t / BVH_W), 0); }
bool slab(vec3 o, vec3 inv, vec3 mn, vec3 mx, float tmax, out float tn) {
  vec3 a = (mn - o) * inv, b = (mx - o) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  tn = max(max(lo.x, lo.y), max(lo.z, 0.0));
  float tf = min(min(hi.x, hi.y), min(hi.z, tmax));
  return tn <= tf;
}
// Moller-Trumbore; returns t or -1, barycentric u,v
float triHit(vec3 o, vec3 d, int i, out vec2 uv, out int orig) {
  vec4 a = bvhTri(i, 0); vec3 e1 = bvhTri(i, 1).xyz, e2 = bvhTri(i, 2).xyz;
  orig = int(a.w);
  vec3 p = cross(d, e2);
  float det = dot(e1, p);
  if (abs(det) < 1e-10) return -1.0;
  float inv = 1.0 / det;
  vec3 s = o - a.xyz;
  float u = dot(s, p) * inv;
  if (u < 0.0 || u > 1.0) return -1.0;
  vec3 q = cross(s, e1);
  float v = dot(d, q) * inv;
  if (v < 0.0 || u + v > 1.0) return -1.0;
  uv = vec2(u, v);
  return dot(e2, q) * inv;
}
float bvhTrace(vec3 o, vec3 d, float tmax, bool anyHit, out int hitTri, out vec2 hitUv) {
  vec3 inv = 1.0 / (d + sign(d) * 1e-12 + vec3(d.x == 0.0 ? 1e-12 : 0.0, d.y == 0.0 ? 1e-12 : 0.0, d.z == 0.0 ? 1e-12 : 0.0));
  int stack[64];
  int sp = 0;
  stack[sp++] = 0;
  float best = tmax;
  hitTri = -1;
  int guard = 0;
  while (sp > 0 && guard++ < 4096) {
    int n = stack[--sp];
    vec4 A = bvhNode(n, 0), B = bvhNode(n, 1);
    float tn;
    if (!slab(o, inv, A.xyz, B.xyz, best, tn)) continue;
    if (B.w < 0.0) {
      int first = int(A.w), cnt = int(-B.w);
      for (int k = 0; k < 4; k++) {
        if (k >= cnt) break;
        vec2 uv; int orig;
        float t = triHit(o, d, first + k, uv, orig);
        if (t > 1e-4 && t < best) { best = t; hitTri = orig; hitUv = uv; if (anyHit) return t; }
      }
    } else if (sp < 62) {
      // nearer child last so it is popped first
      int l = int(A.w), r = int(B.w);
      vec4 la = bvhNode(l, 0), lb = bvhNode(l, 1), ra = bvhNode(r, 0), rb = bvhNode(r, 1);
      float tl, tr;
      bool hl = slab(o, inv, la.xyz, lb.xyz, best, tl), hr = slab(o, inv, ra.xyz, rb.xyz, best, tr);
      if (hl && hr) { if (tl < tr) { stack[sp++] = r; stack[sp++] = l; } else { stack[sp++] = l; stack[sp++] = r; } }
      else if (hl) stack[sp++] = l;
      else if (hr) stack[sp++] = r;
    }
  }
  return hitTri >= 0 ? best : -1.0;
}
// people: their bodies' capsules; returns t of the nearest hit or -1
float capsTrace(vec3 o, vec3 d, float tmax, out vec3 nrm) {
  float best = tmax; bool hit = false;
  for (int i = 0; i < 256; i++) {
    if (i >= uCapCount) break;
    vec4 A4 = texelFetch(uCaps, ivec2(i * 2, 0), 0), B4 = texelFetch(uCaps, ivec2(i * 2 + 1, 0), 0);
    vec3 a = A4.xyz, b = B4.xyz; float r = A4.w;
    // quick reject: the ray must pass within reach of the capsule
    vec3 mid = (a + b) * 0.5; float reach = length(b - a) * 0.5 + r;
    vec3 om = mid - o; float tc = dot(om, d);
    if (tc < -reach || tc > best + reach || dot(om, om) - tc * tc > reach * reach) continue;
    // ray vs capsule (Inigo Quilez)
    vec3 ba = b - a, oa = o - a;
    float baba = dot(ba, ba), bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
    float A = baba - bard * bard, Bq = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
    float h = Bq * Bq - A * C;
    float t = -1.0;
    if (h >= 0.0) {
      t = (-Bq - sqrt(h)) / max(A, 1e-9);
      float y = baoa + t * bard;
      if (y <= 0.0 || y >= baba) {
        vec3 oc = (y <= 0.0) ? oa : o - b;
        float bb = dot(d, oc), cc = dot(oc, oc) - r * r, hh = bb * bb - cc;
        t = hh > 0.0 ? -bb - sqrt(hh) : -1.0;
      }
    }
    if (t > 1e-3 && t < best) {
      best = t; hit = true;
      vec3 p = o + d * t; vec3 pa = p - a;
      float k = clamp(dot(pa, ba) / baba, 0.0, 1.0);
      nrm = normalize(pa - ba * k);
    }
  }
  return hit ? best : -1.0;
}
`;
