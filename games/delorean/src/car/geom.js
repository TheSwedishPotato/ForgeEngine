/**
 * A small geometry kit for the rolling stock and the buildings: everything is added to a
 * Builder in "parts" (one per material), in metres, and comes out as a few merged meshes.
 * Coordinates of the vehicles: x along the vehicle (forward +), y up from the rail head,
 * z across (right of forward +). (Rotated into the world when placed.)
 */
import { BufferGeometry, Float32BufferAttribute, Mesh, Group, Vector3, Matrix3, Matrix4, Quaternion } from 'three';

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _n = new Vector3();

export class Builder {
  constructor() { this.parts = new Map(); this.xf = null; }

  part(name) {
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = { P: [], N: [], UV: [], C: [] }));
    return p;
  }

  /** Applies a transform (Matrix4) to everything added until cleared (null). */
  transform(m) { this.xf = m; this.nxf = m ? new Matrix3().getNormalMatrix(m) : null; return this; }

  _push(p, v, n, u, w, col) {
    if (this.xf) { v = _a.copy(v).applyMatrix4(this.xf); n = _n.copy(n).applyMatrix3(this.nxf).normalize(); }
    p.P.push(v.x, v.y, v.z); p.N.push(n.x, n.y, n.z); p.UV.push(u, w);
    p.C.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
  }

  /** Triangle a, b, c (counter-clockwise seen from the front), flat normal, uvs optional. */
  tri(name, a, b, c, uv = [0, 0, 1, 0, 1, 1], col = null) {
    const p = this.part(name);
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    this._push(p, a, n, uv[0], uv[1], col); this._push(p, b, n, uv[2], uv[3], col); this._push(p, c, n, uv[4], uv[5], col);
  }

  /** Quad a, b, c, d (counter-clockwise from the front). uv: [u0, v0, u1, v1] over a->b (u) and a->d (v). */
  quad(name, a, b, c, d, uv = [0, 0, 1, 1], col = null) {
    const [u0, v0, u1, v1] = uv;
    this.tri(name, a, b, c, [u0, v0, u1, v0, u1, v1], col);
    this.tri(name, a, c, d, [u0, v0, u1, v1, u0, v1], col);
  }

  /** Axis-aligned box from min to max (in the current transform). uv in metres (scale). */
  box(name, min, max, { col = null, uvScale = 1, faces = 'all' } = {}) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const V = (x, y, z) => new Vector3(x, y, z);
    const s = uvScale;
    const F = {
      px: [V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), [z1 * s, y0 * s, z0 * s, y1 * s]],
      nx: [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), [z0 * s, y0 * s, z1 * s, y1 * s]],
      py: [V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), [x0 * s, z1 * s, x1 * s, z0 * s]],
      ny: [V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), [x0 * s, z0 * s, x1 * s, z1 * s]],
      pz: [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), [x0 * s, y0 * s, x1 * s, y1 * s]],
      nz: [V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), [x1 * s, y0 * s, x0 * s, y1 * s]],
    };
    for (const [k, f] of Object.entries(F)) {
      if (faces !== 'all' && !faces.includes(k)) continue;
      this.quad(name, f[0], f[1], f[2], f[3], f[4], col);
    }
  }

  /** A cylinder (or cone) between points p0 and p1, radii r0/r1, segs around; capped unless open. */
  cylinder(name, p0, p1, r0, r1 = r0, { segs = 12, open = false, col = null, uvScale = 1, phase = 0 } = {}) {
    const d = new Vector3().subVectors(p1, p0), len = d.length();
    if (len < 1e-6) return;
    d.divideScalar(len);
    const up = Math.abs(d.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const e1 = new Vector3().crossVectors(d, up).normalize(), e2 = new Vector3().crossVectors(e1, d);
    const ring = (c, r, t) => new Vector3().copy(c).addScaledVector(e1, Math.cos(t) * r).addScaledVector(e2, Math.sin(t) * r);
    const p = this.part(name);
    const slope = (r0 - r1) / len;
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * Math.PI * 2 + phase, t1 = ((i + 1) / segs) * Math.PI * 2 + phase;
      const a = ring(p0, r0, t0), b = ring(p0, r0, t1), c = ring(p1, r1, t1), e = ring(p1, r1, t0);
      const n0 = new Vector3().addScaledVector(e1, Math.cos(t0)).addScaledVector(e2, Math.sin(t0)).addScaledVector(d, slope).normalize();
      const n1 = new Vector3().addScaledVector(e1, Math.cos(t1)).addScaledVector(e2, Math.sin(t1)).addScaledVector(d, slope).normalize();
      const u0 = (i / segs) * 2 * Math.PI * r0 * uvScale, u1 = ((i + 1) / segs) * 2 * Math.PI * r0 * uvScale;
      // (wound counter-clockwise seen from outside)
      this._push(p, a, n0, u0, 0, col); this._push(p, c, n1, u1, len * uvScale, col); this._push(p, b, n1, u1, 0, col);
      this._push(p, a, n0, u0, 0, col); this._push(p, e, n0, u0, len * uvScale, col); this._push(p, c, n1, u1, len * uvScale, col);
      if (!open) {
        const nd = d.clone().negate();
        this._push(p, p0, nd, 0.5, 0.5, col); this._push(p, a, nd, 0, 0, col); this._push(p, b, nd, 0, 0, col);
        this._push(p, p1, d, 0.5, 0.5, col); this._push(p, c, d, 0, 0, col); this._push(p, e, d, 0, 0, col);
      }
    }
  }

  /** A solid of revolution about the axis from p0 along dir: profile [[r, t], ...] with t in metres along the axis. */
  lathe(name, p0, dir, profile, { segs = 16, col = null } = {}) {
    const d = dir.clone().normalize();
    const up = Math.abs(d.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const e1 = new Vector3().crossVectors(d, up).normalize(), e2 = new Vector3().crossVectors(e1, d);
    const p = this.part(name);
    for (let k = 0; k + 1 < profile.length; k++) {
      const [ra, ta] = profile[k], [rb, tb] = profile[k + 1];
      const dr = rb - ra, dt = tb - ta, L = Math.hypot(dr, dt) || 1;
      for (let i = 0; i < segs; i++) {
        const q0 = (i / segs) * Math.PI * 2, q1 = ((i + 1) / segs) * Math.PI * 2;
        const pt = (r, t, q) => new Vector3().copy(p0).addScaledVector(d, t).addScaledVector(e1, Math.cos(q) * r).addScaledVector(e2, Math.sin(q) * r);
        const nr = (q) => new Vector3().addScaledVector(e1, Math.cos(q) * dt / L).addScaledVector(e2, Math.sin(q) * dt / L).addScaledVector(d, -dr / L).normalize();
        const A = pt(ra, ta, q0), B = pt(ra, ta, q1), C = pt(rb, tb, q1), D = pt(rb, tb, q0);
        const n0 = nr(q0), n1 = nr(q1);
        this._push(p, A, n0, i / segs, k / profile.length, col); this._push(p, C, n1, (i + 1) / segs, (k + 1) / profile.length, col); this._push(p, B, n1, (i + 1) / segs, k / profile.length, col);
        this._push(p, A, n0, i / segs, k / profile.length, col); this._push(p, D, n0, i / segs, (k + 1) / profile.length, col); this._push(p, C, n1, (i + 1) / segs, (k + 1) / profile.length, col);
      }
    }
  }

  /**
   * A box with rounded edges and corners (radius r), smooth-shaded: upholstery and cushions.
   * The surface is the inner core box grown by r, so the corners are spheres and the edges
   * cylinders; k steps of equal angle round each edge.
   */
  soft(name, min, max, r, { k = 2, col = null, uvScale = 1 } = {}) {
    const lo = min, hi = max;
    r = Math.max(1e-4, Math.min(r, (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2));
    const lines = (a0, a1) => {
      const c = [];
      for (let j = 0; j <= k; j++) c.push(a0 + r - r * Math.tan((1 - j / k) * Math.PI / 4));
      for (let j = 0; j <= k; j++) c.push(a1 - r + r * Math.tan((j / k) * Math.PI / 4));
      return c;
    };
    const L = [lines(lo[0], hi[0]), lines(lo[1], hi[1]), lines(lo[2], hi[2])];
    const p = this.part(name);
    const at = (P) => {
      const q = new Vector3(Math.min(Math.max(P[0], lo[0] + r), hi[0] - r), Math.min(Math.max(P[1], lo[1] + r), hi[1] - r), Math.min(Math.max(P[2], lo[2] + r), hi[2] - r));
      const n = new Vector3(P[0] - q.x, P[1] - q.y, P[2] - q.z).normalize();
      return { v: q.addScaledVector(n, r), n };
    };
    // each face: its axis a, side s, and the two axes across it (b x c points out)
    const FACES = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]];
    for (const [a, s, bi, ci] of FACES) {
      const B = L[bi], C = L[ci];
      const pt = (i, j) => { const P = [0, 0, 0]; P[a] = s > 0 ? hi[a] : lo[a]; P[bi] = B[i]; P[ci] = C[j]; return at(P); };
      for (let i = 0; i + 1 < B.length; i++) for (let j = 0; j + 1 < C.length; j++) {
        if (B[i + 1] - B[i] < 1e-7 || C[j + 1] - C[j] < 1e-7) continue;
        const A = pt(i, j), Bv = pt(i + 1, j), Cv = pt(i + 1, j + 1), D = pt(i, j + 1);
        const u0 = B[i] * uvScale, u1 = B[i + 1] * uvScale, v0 = C[j] * uvScale, v1 = C[j + 1] * uvScale;
        this._push(p, A.v, A.n, u0, v0, col); this._push(p, Bv.v, Bv.n, u1, v0, col); this._push(p, Cv.v, Cv.n, u1, v1, col);
        this._push(p, A.v, A.n, u0, v0, col); this._push(p, Cv.v, Cv.n, u1, v1, col); this._push(p, D.v, D.n, u0, v1, col);
      }
    }
  }

  /** Extrudes a 2D profile (in the y-z plane, [[z, y], ...], counter-clockwise seen from +x) from x0 to x1. */
  extrudeX(name, profile, x0, x1, { closed = true, caps = false, col = null, uvScale = 1, smooth = false } = {}) {
    const n = profile.length, m = closed ? n : n - 1;
    let acc = 0;
    for (let i = 0; i < m; i++) {
      const [za, ya] = profile[i], [zb, yb] = profile[(i + 1) % n];
      const seg = Math.hypot(zb - za, yb - ya);
      const a = new Vector3(x0, ya, za), b = new Vector3(x0, yb, zb), c = new Vector3(x1, yb, zb), d = new Vector3(x1, ya, za);
      this.quad(name, a, d, c, b, [x0 * uvScale, acc * uvScale, x1 * uvScale, (acc + seg) * uvScale], col);
      acc += seg;
    }
    if (caps) {
      for (let i = 1; i + 1 < n; i++) {
        this.tri(name, new Vector3(x1, profile[0][1], profile[0][0]), new Vector3(x1, profile[i][1], profile[i][0]), new Vector3(x1, profile[i + 1][1], profile[i + 1][0]), undefined, col);
        this.tri(name, new Vector3(x0, profile[0][1], profile[0][0]), new Vector3(x0, profile[i + 1][1], profile[i + 1][0]), new Vector3(x0, profile[i][1], profile[i][0]), undefined, col);
      }
    }
    void smooth;
  }

  /** Meshes, one per part, with the given materials ({ name: material }). */
  build(materials, { castShadow = true } = {}) {
    const g = new Group();
    for (const [name, p] of this.parts) {
      if (!p.P.length) continue;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(p.P, 3));
      geo.setAttribute('normal', new Float32BufferAttribute(p.N, 3));
      geo.setAttribute('uv', new Float32BufferAttribute(p.UV, 2));
      if (p.C.some((c) => c !== 1)) geo.setAttribute('color', new Float32BufferAttribute(p.C, 3));
      geo.computeBoundingSphere();
      const mat = materials[name] ?? materials.default;
      const mesh = new Mesh(geo, mat);
      mesh.name = name;
      mesh.castShadow = castShadow;
      g.add(mesh);
    }
    return g;
  }
}

/** Smooth vertex normals for a part built from flat triangles (angle-limited), in place. */
export function smoothPart(geo, maxAngleDeg = 40) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const key = (i) => `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
  const groups = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); let g = groups.get(k); if (!g) groups.set(k, (g = [])); g.push(i); }
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  const out = new Float32Array(n * 3), a = new Vector3(), b = new Vector3();
  for (const g of groups.values()) for (const i of g) {
    a.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const s = new Vector3();
    for (const j of g) { b.set(nrm.getX(j), nrm.getY(j), nrm.getZ(j)); if (a.dot(b) >= cosMax) s.add(b); }
    s.normalize();
    out[i * 3] = s.x; out[i * 3 + 1] = s.y; out[i * 3 + 2] = s.z;
  }
  geo.setAttribute('normal', new Float32BufferAttribute(out, 3));
}

export { _b, _c, Quaternion };
