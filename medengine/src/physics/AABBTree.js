/**
 * A static bounding-volume tree over axis-aligned boxes (triangles of a level mesh, or a world's colliders).
 * Built once by median split along the widest axis, stored flat in typed arrays; queries allocate nothing.
 */
const LEAF = 4;

export class AABBTree {
  /**
   * @param {Float32Array|number[]} boxes  6 numbers per item: minX minY minZ maxX maxY maxZ
   */
  constructor(boxes) {
    const n = (this.count = boxes.length / 6);
    this.boxes = boxes instanceof Float32Array ? boxes : Float32Array.from(boxes);
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    const maxNodes = Math.max(1, 2 * Math.ceil(n / (LEAF / 2)) + 1);
    this.nb = new Float32Array(maxNodes * 6);   // node bounds
    this.left = new Int32Array(maxNodes);       // child index, or -1 for a leaf
    this.right = new Int32Array(maxNodes);      // child index, or first item (into `order`) for a leaf
    this.cnt = new Int32Array(maxNodes);        // items in a leaf
    this.nodes = 0;
    this._stack = new Int32Array(128);
    if (n > 0) this._build(0, n);
  }

  _build(lo, hi) {
    const id = this.nodes++, B = this.boxes, o = this.order, nb = this.nb;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = lo; i < hi; i++) {
      const b = o[i] * 6;
      x0 = Math.min(x0, B[b]); y0 = Math.min(y0, B[b + 1]); z0 = Math.min(z0, B[b + 2]);
      x1 = Math.max(x1, B[b + 3]); y1 = Math.max(y1, B[b + 4]); z1 = Math.max(z1, B[b + 5]);
      const cx = (B[b] + B[b + 3]) / 2, cy = (B[b + 1] + B[b + 4]) / 2, cz = (B[b + 2] + B[b + 5]) / 2;
      cx0 = Math.min(cx0, cx); cy0 = Math.min(cy0, cy); cz0 = Math.min(cz0, cz); cx1 = Math.max(cx1, cx); cy1 = Math.max(cy1, cy); cz1 = Math.max(cz1, cz);
    }
    nb[id * 6] = x0; nb[id * 6 + 1] = y0; nb[id * 6 + 2] = z0; nb[id * 6 + 3] = x1; nb[id * 6 + 4] = y1; nb[id * 6 + 5] = z1;
    if (hi - lo <= LEAF) { this.left[id] = -1; this.right[id] = lo; this.cnt[id] = hi - lo; return id; }
    const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0, axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const key = (i) => { const b = i * 6; return B[b + axis] + B[b + 3 + axis]; };
    const sub = Array.from(o.subarray(lo, hi)).sort((a, b) => key(a) - key(b));
    o.set(sub, lo);
    const mid = (lo + hi) >> 1;
    this.left[id] = this._build(lo, mid);
    this.right[id] = this._build(mid, hi);
    this.cnt[id] = 0;
    return id;
  }

  /** Calls `fn(itemIndex)` for every item whose box overlaps the query box. Return `false` from fn to stop. */
  query(x0, y0, z0, x1, y1, z1, fn) {
    if (!this.nodes) return;
    const nb = this.nb, S = this._stack, B = this.boxes;
    let sp = 0;
    S[sp++] = 0;
    while (sp) {
      const id = S[--sp], k = id * 6;
      if (nb[k] > x1 || nb[k + 3] < x0 || nb[k + 1] > y1 || nb[k + 4] < y0 || nb[k + 2] > z1 || nb[k + 5] < z0) continue;
      if (this.left[id] < 0) {
        const s = this.right[id], c = this.cnt[id];
        for (let i = s; i < s + c; i++) {
          const it = this.order[i], b = it * 6;
          if (B[b] > x1 || B[b + 3] < x0 || B[b + 1] > y1 || B[b + 4] < y0 || B[b + 2] > z1 || B[b + 5] < z0) continue;
          if (fn(it) === false) return;
        }
      } else { S[sp++] = this.left[id]; S[sp++] = this.right[id]; }
    }
  }

  /**
   * Walks the items a ray can touch, nearest boxes first is not guaranteed; `fn(item, tEnter)` returns the new
   * maximum distance (the nearest hit so far) or undefined to keep it.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, fn) {
    if (!this.nodes) return maxT;
    const nb = this.nb, S = this._stack, B = this.boxes;
    const ix = dx !== 0 ? 1 / dx : Infinity, iy = dy !== 0 ? 1 / dy : Infinity, iz = dz !== 0 ? 1 / dz : Infinity;
    const slab = (arr, k) => {
      let tmin = 0, tmax = maxT;
      let t1 = (arr[k] - ox) * ix, t2 = (arr[k + 3] - ox) * ix;
      if (ix === Infinity) { if (ox < arr[k] || ox > arr[k + 3]) return -1; } else { tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2)); }
      t1 = (arr[k + 1] - oy) * iy; t2 = (arr[k + 4] - oy) * iy;
      if (iy === Infinity) { if (oy < arr[k + 1] || oy > arr[k + 4]) return -1; } else { tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2)); }
      t1 = (arr[k + 2] - oz) * iz; t2 = (arr[k + 5] - oz) * iz;
      if (iz === Infinity) { if (oz < arr[k + 2] || oz > arr[k + 5]) return -1; } else { tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2)); }
      return tmax >= tmin ? tmin : -1;
    };
    let sp = 0;
    S[sp++] = 0;
    while (sp) {
      const id = S[--sp];
      if (slab(nb, id * 6) < 0) continue;
      if (this.left[id] < 0) {
        const s = this.right[id], c = this.cnt[id];
        for (let i = s; i < s + c; i++) {
          const it = this.order[i], te = slab(B, it * 6);
          if (te < 0 || te > maxT) continue;
          const r = fn(it, te);
          if (r !== undefined) maxT = r;
        }
      } else { S[sp++] = this.left[id]; S[sp++] = this.right[id]; }
    }
    return maxT;
  }
}
