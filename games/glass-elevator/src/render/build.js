/**
 * Geometry helpers: boxes, cylinders and tubes merged into one mesh per material for everything
 * that never moves (the tower, the rails, the lobbies), each with texture coordinates in metres
 * so a facade or a paving texture repeats at its real size.
 */
import { BufferGeometry, BufferAttribute, BoxGeometry, CylinderGeometry, Mesh, Matrix4, Quaternion, Euler, Vector3, Matrix3 } from 'three';

const _m = new Matrix4(), _n = new Matrix3(), _v = new Vector3(), _q = new Quaternion(), _e = new Euler(), _s = new Vector3();

/** An axis-aligned box from its corners, with world-space UVs (metres / uvScale). */
export function boxGeo(x0, y0, z0, x1, y1, z1, uvScale = 1) {
  const P = [], N = [], U = [];
  const face = (n, a, b, c, d) => {
    for (const p of [a, b, c, a, c, d]) {
      P.push(...p); N.push(...n);
      const k = Math.abs(n[0]) > 0.5 ? [p[2], p[1]] : Math.abs(n[1]) > 0.5 ? [p[0], p[2]] : [p[0], p[1]];
      U.push(k[0] / uvScale, k[1] / uvScale);
    }
  };
  face([1, 0, 0], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  face([-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  face([0, 1, 0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
  face([0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  face([0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  face([0, 0, -1], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(U), 2));
  return g;
}

/** A cylinder of radius r and length h along axis ('x', 'y' or 'z'), centred at (x, y, z). */
export function cylGeo(r, h, axis = 'y', seg = 16, r2 = r) {
  const g = new CylinderGeometry(r2, r, h, seg, 1).toNonIndexed();
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

export class Batch {
  constructor() { this.parts = new Map(); }

  /** Adds geometry with a transform: position, rotation (radians, XYZ) and scale. */
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(s, s, s));
    g.applyMatrix4(_m);
    if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    (this.parts.get(mat) ?? this.parts.set(mat, []).get(mat)).push(g);
    return this;
  }
  box(mat, x0, y0, z0, x1, y1, z1, uvScale = 1) { return this.add(boxGeo(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), uvScale), mat); }
  cyl(mat, x, y, z, r, h, axis = 'y', seg = 16, r2 = r) { return this.add(cylGeo(r, h, axis, seg, r2), mat, x, y, z); }
  /** A straight tube between two points. */
  tube(mat, a, b, r, seg = 8) {
    const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
    const g = cylGeo(r, L, 'y', seg);
    _q.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
    _m.compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
    g.applyMatrix4(_m);
    (this.parts.get(mat) ?? this.parts.set(mat, []).get(mat)).push(g);
    return this;
  }

  /** Merges everything added into one mesh per material under parent. */
  build(parent, { shadow = true } = {}) {
    const out = [];
    for (const [mat, list] of this.parts) {
      const g = merge(list);
      const mesh = new Mesh(g, mat);
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

export function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, o * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(P, 3));
  g.setAttribute('normal', new BufferAttribute(N, 3));
  g.setAttribute('uv', new BufferAttribute(U, 2));
  g.computeBoundingSphere();
  return g;
}

/** One mesh (for things that move) from a box given by its size, centred at the origin. */
export function boxMesh(mat, w, h, d, uvScale = 1) {
  return new Mesh(boxGeo(-w / 2, -h / 2, -d / 2, w / 2, h / 2, d / 2, uvScale), mat);
}

void _n; void BoxGeometry;
