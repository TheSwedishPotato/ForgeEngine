/**
 * Geometry: BufferAttribute and BufferGeometry, plus the primitive shapes.
 *
 * Attribute names the renderer understands:
 *   position (3, float)   normal (3, float)   uv (2, float)   color (3, float)
 *   skinIndex (4, uint8/uint16)   skinWeight (4, float)   morphSlot (1, float; -1 = not morphed)
 * Anything else is kept but ignored by the draw passes.
 */
import { Vector3, Matrix4, Matrix3 } from '../math/core.js';
import { Box3, Sphere } from '../math/geometry.js';

let _geoId = 1;
const _m4 = new Matrix4(), _m3 = new Matrix3(), _v = new Vector3();
const _va = new Vector3(), _vb = new Vector3(), _vc = new Vector3(), _cb = new Vector3(), _ab = new Vector3();

export class BufferAttribute {
  constructor(array, itemSize, normalized = false) {
    if (Array.isArray(array)) throw new TypeError('BufferAttribute: array must be a typed array');
    this.array = array;
    this.itemSize = itemSize;
    this.count = array !== undefined ? array.length / itemSize : 0;
    this.normalized = normalized;
    /** 'static' (uploaded once) or 'dynamic' (re-uploaded when `needsUpdate` is set). */
    this.usage = 'static';
    this.version = 0;
  }
  get isBufferAttribute() { return true; }
  set needsUpdate(v) { if (v) this.version++; }
  setUsage(u) { this.usage = u === 35048 ? 'dynamic' : u === 35044 ? 'static' : u; return this; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  getW(i) { return this.array[i * this.itemSize + 3]; }
  setX(i, v) { this.array[i * this.itemSize] = v; return this; }
  setY(i, v) { this.array[i * this.itemSize + 1] = v; return this; }
  setZ(i, v) { this.array[i * this.itemSize + 2] = v; return this; }
  setW(i, v) { this.array[i * this.itemSize + 3] = v; return this; }
  setXY(i, x, y) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; return this; }
  setXYZ(i, x, y, z) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; return this; }
  setXYZW(i, x, y, z, w) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; this.array[o + 3] = w; return this; }
  set(values, offset = 0) { this.array.set(values, offset); return this; }
  copyArray(a) { this.array.set(a); return this; }
  clone() { const a = new this.constructor(this.array.slice(), this.itemSize, this.normalized); a.usage = this.usage; return a; }
  applyMatrix4(m) {
    for (let i = 0; i < this.count; i++) { _v.fromBufferAttribute(this, i).applyMatrix4(m); this.setXYZ(i, _v.x, _v.y, _v.z); }
    return this;
  }
  applyNormalMatrix(m) {
    for (let i = 0; i < this.count; i++) { _v.fromBufferAttribute(this, i).applyMatrix3(m).normalize(); this.setXYZ(i, _v.x, _v.y, _v.z); }
    return this;
  }
}
export class Float32BufferAttribute extends BufferAttribute { constructor(a, s, n) { super(a instanceof Float32Array ? a : new Float32Array(a), s, n); } }
export class Uint16BufferAttribute extends BufferAttribute { constructor(a, s, n) { super(a instanceof Uint16Array ? a : new Uint16Array(a), s, n); } }
export class Uint32BufferAttribute extends BufferAttribute { constructor(a, s, n) { super(a instanceof Uint32Array ? a : new Uint32Array(a), s, n); } }

export class BufferGeometry {
  constructor() {
    this.id = _geoId++;
    this.type = 'BufferGeometry';
    this.name = '';
    this.index = null;
    this.attributes = {};
    /** Morph target deltas (relative): { position: [BufferAttribute], normal: [...] }. */
    this.morphAttributes = {};
    this.morphTargetsRelative = true;
    this.groups = [];
    this.boundingBox = null;
    this.boundingSphere = null;
    this.drawRange = { start: 0, count: Infinity };
    this.userData = {};
    this._disposeListeners = new Set();
  }
  get isBufferGeometry() { return true; }
  get uuid() { return `geo-${this.id}`; }
  getIndex() { return this.index; }
  setIndex(index) {
    if (Array.isArray(index)) {
      let max = 0; for (const v of index) if (v > max) max = v;
      index = new (max > 65535 ? Uint32BufferAttribute : Uint16BufferAttribute)(index, 1);
    }
    this.index = index;
    return this;
  }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  getAttribute(name) { return this.attributes[name]; }
  hasAttribute(name) { return this.attributes[name] !== undefined; }
  deleteAttribute(name) { delete this.attributes[name]; return this; }
  addGroup(start, count, materialIndex = 0) { this.groups.push({ start, count, materialIndex }); }
  clearGroups() { this.groups = []; }
  setDrawRange(start, count) { this.drawRange.start = start; this.drawRange.count = count; }

  applyMatrix4(m) {
    const { position, normal } = this.attributes;
    position?.applyMatrix4(m); position && (position.needsUpdate = true);
    if (normal) { normal.applyNormalMatrix(_m3.getNormalMatrix(m)); normal.needsUpdate = true; }
    if (this.boundingBox) this.computeBoundingBox();
    if (this.boundingSphere) this.computeBoundingSphere();
    return this;
  }
  rotateX(a) { return this.applyMatrix4(_m4.makeRotationX(a)); }
  rotateY(a) { return this.applyMatrix4(_m4.makeRotationY(a)); }
  rotateZ(a) { return this.applyMatrix4(_m4.makeRotationZ(a)); }
  translate(x, y, z) { return this.applyMatrix4(_m4.makeTranslation(x, y, z)); }
  scale(x, y, z) { return this.applyMatrix4(_m4.makeScale(x, y, z)); }
  center() {
    this.computeBoundingBox();
    this.boundingBox.getCenter(_v).negate();
    return this.translate(_v.x, _v.y, _v.z);
  }

  computeBoundingBox() {
    this.boundingBox ??= new Box3();
    const p = this.attributes.position;
    if (!p) { this.boundingBox.makeEmpty(); return; }
    this.boundingBox.setFromArray(p.array, p.itemSize);
  }
  computeBoundingSphere() {
    this.boundingSphere ??= new Sphere();
    const p = this.attributes.position;
    if (!p || !p.count) { this.boundingSphere.makeEmpty(); return; }
    const box = (this._tmpBox ??= new Box3()).setFromArray(p.array, p.itemSize);
    const c = box.getCenter(this.boundingSphere.center);
    let r2 = 0;
    const a = p.array, s = p.itemSize;
    for (let i = 0; i < a.length; i += s) {
      const dx = a[i] - c.x, dy = a[i + 1] - c.y, dz = a[i + 2] - c.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > r2) r2 = d;
    }
    this.boundingSphere.radius = Math.sqrt(r2);
  }

  /** Area-weighted smooth normals (shared vertices are averaged). */
  computeVertexNormals() {
    const pos = this.attributes.position;
    if (!pos) return;
    let nrm = this.attributes.normal;
    if (!nrm || nrm.count !== pos.count) { nrm = new BufferAttribute(new Float32Array(pos.count * 3), 3); this.setAttribute('normal', nrm); }
    else nrm.array.fill(0);
    const idx = this.index, n = nrm.array;
    const tri = (a, b, c) => {
      _va.fromBufferAttribute(pos, a); _vb.fromBufferAttribute(pos, b); _vc.fromBufferAttribute(pos, c);
      _cb.subVectors(_vc, _vb); _ab.subVectors(_va, _vb); _cb.cross(_ab);
      for (const i of [a, b, c]) { n[i * 3] += _cb.x; n[i * 3 + 1] += _cb.y; n[i * 3 + 2] += _cb.z; }
    };
    if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
    for (let i = 0; i < nrm.count; i++) {
      _v.set(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]).normalize();
      n[i * 3] = _v.x; n[i * 3 + 1] = _v.y; n[i * 3 + 2] = _v.z;
    }
    nrm.needsUpdate = true;
  }

  toNonIndexed() {
    if (!this.index) return this;
    const g = new BufferGeometry(), idx = this.index.array;
    for (const [name, a] of Object.entries(this.attributes)) {
      const out = new a.array.constructor(idx.length * a.itemSize);
      for (let i = 0; i < idx.length; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.array[idx[i] * a.itemSize + k];
      g.setAttribute(name, new BufferAttribute(out, a.itemSize, a.normalized));
    }
    for (const gr of this.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    return g;
  }

  clone() { return new BufferGeometry().copy(this); }
  copy(src) {
    this.index = src.index ? src.index.clone() : null;
    this.attributes = {};
    for (const [k, a] of Object.entries(src.attributes)) this.attributes[k] = a.clone();
    this.morphAttributes = {};
    for (const [k, arr] of Object.entries(src.morphAttributes)) this.morphAttributes[k] = arr.map((a) => a.clone());
    this.morphTargetsRelative = src.morphTargetsRelative;
    this.groups = src.groups.map((g) => ({ ...g }));
    this.drawRange = { ...src.drawRange };
    this.userData = { ...src.userData };
    this.boundingBox = src.boundingBox?.clone() ?? null;
    this.boundingSphere = src.boundingSphere?.clone() ?? null;
    return this;
  }
  onDispose(fn) { this._disposeListeners.add(fn); return () => this._disposeListeners.delete(fn); }
  /** Frees the GPU copy (the renderer listens); the geometry stays usable and re-uploads on next draw. */
  dispose() { for (const f of this._disposeListeners) f(this); }
}

/** Merges geometries that have the same attributes. With `useGroups`, one group per input. */
export function mergeGeometries(geometries, useGroups = false) {
  if (!geometries.length) return null;
  const indexed = geometries[0].index !== null;
  const names = Object.keys(geometries[0].attributes);
  const out = new BufferGeometry();
  let offset = 0, indexOffset = 0;
  for (const g of geometries) {
    if ((g.index !== null) !== indexed) throw new Error('mergeGeometries: mix of indexed and non-indexed geometries');
    for (const n of names) if (!g.attributes[n]) throw new Error(`mergeGeometries: attribute "${n}" missing on a geometry`);
  }
  for (const n of names) {
    const a0 = geometries[0].attributes[n];
    let total = 0;
    for (const g of geometries) total += g.attributes[n].array.length;
    const arr = new a0.array.constructor(total);
    let o = 0;
    for (const g of geometries) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  if (indexed) {
    let total = 0, maxV = 0;
    for (const g of geometries) { total += g.index.count; maxV += g.attributes.position.count; }
    const idx = new (maxV > 65535 ? Uint32Array : Uint16Array)(total);
    let o = 0;
    for (const g of geometries) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) idx[o + i] = ia[i] + offset;
      if (useGroups) out.addGroup(indexOffset, ia.length, out.groups.length);
      o += ia.length; indexOffset += ia.length; offset += g.attributes.position.count;
    }
    out.setIndex(new BufferAttribute(idx, 1));
  } else if (useGroups) {
    for (const g of geometries) { out.addGroup(indexOffset, g.attributes.position.count, out.groups.length); indexOffset += g.attributes.position.count; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Primitives. All are indexed, have position / normal / uv, and are centred on the origin.

function fromArrays(positions, normals, uvs, indices) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1, ws = 1, hs = 1, ds = 1) {
    super();
    this.type = 'BoxGeometry';
    const P = [], N = [], U = [], I = [];
    let vertexCount = 0;
    const plane = (u, v, w, udir, vdir, w1, h1, d1, gx, gy) => {
      const sw = w1 / gx, sh = h1 / gy, hw = w1 / 2, hh = h1 / 2, hd = d1 / 2, g1x = gx + 1, g1y = gy + 1;
      let counter = 0;
      const vec = [0, 0, 0];
      for (let iy = 0; iy < g1y; iy++) {
        const y = iy * sh - hh;
        for (let ix = 0; ix < g1x; ix++) {
          const x = ix * sw - hw;
          vec[u] = x * udir; vec[v] = y * vdir; vec[w] = hd;
          P.push(vec[0], vec[1], vec[2]);
          vec[u] = 0; vec[v] = 0; vec[w] = d1 > 0 ? 1 : -1;
          N.push(vec[0], vec[1], vec[2]);
          U.push(ix / gx, 1 - iy / gy);
          counter++;
        }
      }
      for (let iy = 0; iy < gy; iy++) {
        for (let ix = 0; ix < gx; ix++) {
          const a = vertexCount + ix + g1x * iy, b = vertexCount + ix + g1x * (iy + 1);
          const c = vertexCount + (ix + 1) + g1x * (iy + 1), d = vertexCount + (ix + 1) + g1x * iy;
          I.push(a, b, d, b, c, d);
        }
      }
      vertexCount += counter;
    };
    plane(2, 1, 0, -1, -1, depth, height, width, ds, hs);   // +x
    plane(2, 1, 0, 1, -1, depth, height, -width, ds, hs);   // -x
    plane(0, 2, 1, 1, 1, width, depth, height, ws, ds);     // +y
    plane(0, 2, 1, 1, -1, width, depth, -height, ws, ds);   // -y
    plane(0, 1, 2, 1, -1, width, height, depth, ws, hs);    // +z
    plane(0, 1, 2, -1, -1, width, height, -depth, ws, hs);  // -z
    this.copy(fromArrays(P, N, U, I));
    this.parameters = { width, height, depth };
  }
}

export class PlaneGeometry extends BufferGeometry {
  /** In the XY plane, facing +Z (rotate it for a floor). */
  constructor(width = 1, height = 1, ws = 1, hs = 1) {
    super();
    this.type = 'PlaneGeometry';
    const P = [], N = [], U = [], I = [];
    const hw = width / 2, hh = height / 2;
    for (let iy = 0; iy <= hs; iy++) for (let ix = 0; ix <= ws; ix++) {
      P.push(ix * (width / ws) - hw, -(iy * (height / hs) - hh), 0); N.push(0, 0, 1); U.push(ix / ws, 1 - iy / hs);
    }
    for (let iy = 0; iy < hs; iy++) for (let ix = 0; ix < ws; ix++) {
      const a = ix + (ws + 1) * iy, b = ix + (ws + 1) * (iy + 1), c = ix + 1 + (ws + 1) * (iy + 1), d = ix + 1 + (ws + 1) * iy;
      I.push(a, b, d, b, c, d);
    }
    this.copy(fromArrays(P, N, U, I));
    this.parameters = { width, height };
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(radius = 1, ws = 32, hs = 16) {
    super();
    this.type = 'SphereGeometry';
    ws = Math.max(3, ws | 0); hs = Math.max(2, hs | 0);
    const P = [], N = [], U = [], I = [], grid = [];
    let idx = 0;
    for (let iy = 0; iy <= hs; iy++) {
      const row = [], v = iy / hs;
      for (let ix = 0; ix <= ws; ix++) {
        const u = ix / ws;
        const x = -radius * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI);
        const y = radius * Math.cos(v * Math.PI);
        const z = radius * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI);
        P.push(x, y, z);
        const l = Math.hypot(x, y, z) || 1; N.push(x / l, y / l, z / l);
        U.push(u, 1 - v);
        row.push(idx++);
      }
      grid.push(row);
    }
    for (let iy = 0; iy < hs; iy++) for (let ix = 0; ix < ws; ix++) {
      const a = grid[iy][ix + 1], b = grid[iy][ix], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1];
      if (iy !== 0) I.push(a, b, d);
      if (iy !== hs - 1) I.push(b, c, d);
    }
    this.copy(fromArrays(P, N, U, I));
    this.parameters = { radius };
  }
}

export class CylinderGeometry extends BufferGeometry {
  constructor(radiusTop = 1, radiusBottom = 1, height = 1, radial = 24, heightSeg = 1, openEnded = false) {
    super();
    this.type = 'CylinderGeometry';
    const P = [], N = [], U = [], I = [], rows = [];
    let index = 0;
    const slope = (radiusBottom - radiusTop) / height;
    for (let y = 0; y <= heightSeg; y++) {
      const row = [], v = y / heightSeg, r = v * (radiusBottom - radiusTop) + radiusTop;
      for (let x = 0; x <= radial; x++) {
        const u = x / radial, th = u * Math.PI * 2, s = Math.sin(th), c = Math.cos(th);
        P.push(r * s, -v * height + height / 2, r * c);
        const nx = s, ny = slope, nz = c, l = Math.hypot(nx, ny, nz); N.push(nx / l, ny / l, nz / l);
        U.push(u, 1 - v);
        row.push(index++);
      }
      rows.push(row);
    }
    for (let x = 0; x < radial; x++) for (let y = 0; y < heightSeg; y++) {
      const a = rows[y][x], b = rows[y + 1][x], c = rows[y + 1][x + 1], d = rows[y][x + 1];
      if (radiusTop > 0 || y !== 0) I.push(a, b, d);
      if (radiusBottom > 0 || y !== heightSeg - 1) I.push(b, c, d);
    }
    const cap = (top) => {
      const r = top ? radiusTop : radiusBottom, sign = top ? 1 : -1, centre = index;
      for (let x = 1; x <= radial; x++) { P.push(0, (height / 2) * sign, 0); N.push(0, sign, 0); U.push(0.5, 0.5); index++; }
      const first = index;
      for (let x = 0; x <= radial; x++) {
        const th = (x / radial) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
        P.push(r * s, (height / 2) * sign, r * c); N.push(0, sign, 0); U.push(c * 0.5 + 0.5, s * 0.5 * sign + 0.5); index++;
      }
      for (let x = 0; x < radial; x++) {
        const c = centre + x, i = first + x;
        if (top) I.push(i, i + 1, c); else I.push(i + 1, i, c);
      }
    };
    if (!openEnded) { if (radiusTop > 0) cap(true); if (radiusBottom > 0) cap(false); }
    this.copy(fromArrays(P, N, U, I));
    this.parameters = { radiusTop, radiusBottom, height };
  }
}

export class ConeGeometry extends CylinderGeometry {
  constructor(radius = 1, height = 1, radial = 24, heightSeg = 1, openEnded = false) { super(0, radius, height, radial, heightSeg, openEnded); this.type = 'ConeGeometry'; }
}

/** A capsule along Y: `length` is the straight part, total height = length + 2 * radius. */
export class CapsuleGeometry extends BufferGeometry {
  constructor(radius = 1, length = 1, capSeg = 6, radial = 16) {
    super();
    this.type = 'CapsuleGeometry';
    const P = [], N = [], U = [], I = [];
    const rings = capSeg * 2 + 2, half = length / 2;
    for (let j = 0; j < rings; j++) {
      const top = j <= capSeg;
      const a = top ? (j / capSeg) * Math.PI / 2 : ((j - capSeg - 1) / capSeg) * Math.PI / 2 + Math.PI / 2; // 0..pi/2 then pi/2..pi
      const ny = Math.cos(a), rr = Math.sin(a);
      const y = ny * radius + (top ? half : -half);
      for (let i = 0; i <= radial; i++) {
        const th = (i / radial) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
        P.push(rr * radius * s, y, rr * radius * c); N.push(rr * s, ny, rr * c); U.push(i / radial, 1 - j / (rings - 1));
      }
    }
    for (let j = 0; j < rings - 1; j++) for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i, b = a + radial + 1;
      I.push(a, b, a + 1, b, b + 1, a + 1);
    }
    this.copy(fromArrays(P, N, U, I));
    this.parameters = { radius, length };
  }
}

export class TorusGeometry extends BufferGeometry {
  constructor(radius = 1, tube = 0.4, radial = 12, tubular = 48) {
    super();
    this.type = 'TorusGeometry';
    const P = [], N = [], U = [], I = [];
    for (let j = 0; j <= radial; j++) for (let i = 0; i <= tubular; i++) {
      const u = (i / tubular) * Math.PI * 2, v = (j / radial) * Math.PI * 2;
      const x = (radius + tube * Math.cos(v)) * Math.cos(u), y = (radius + tube * Math.cos(v)) * Math.sin(u), z = tube * Math.sin(v);
      P.push(x, y, z);
      N.push(Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v));
      U.push(i / tubular, j / radial);
    }
    for (let j = 1; j <= radial; j++) for (let i = 1; i <= tubular; i++) {
      const a = (tubular + 1) * j + i - 1, b = (tubular + 1) * (j - 1) + i - 1, c = (tubular + 1) * (j - 1) + i, d = (tubular + 1) * j + i;
      I.push(a, b, d, b, c, d);
    }
    this.copy(fromArrays(P, N, U, I));
  }
}

/** A 2D outline (array of {x,y} or [x,y]) to extrude along +Z. No holes; simple (non-self-intersecting) polygons. */
export class Shape {
  constructor(points = []) { this.points = points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y })); }
}

/** Ear-clipping triangulation of a simple polygon; returns triangle index triples. */
export function triangulate(pts) {
  const n = pts.length, idx = [...Array(n).keys()];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
  if (area < 0) idx.reverse();
  const out = [];
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (cross(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inside(pts[j], a, b, c)) { ear = false; break; } }
      if (!ear) continue;
      out.push(i0, i1, i2); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

export class ExtrudeGeometry extends BufferGeometry {
  /** options: depth, bevelEnabled, bevelThickness, bevelSize (a single flat bevel step). */
  constructor(shape, { depth = 1, bevelEnabled = false, bevelThickness = 0.1, bevelSize = 0.1 } = {}) {
    super();
    this.type = 'ExtrudeGeometry';
    const pts = shape.points, n = pts.length;
    const bt = bevelEnabled ? bevelThickness : 0, bs = bevelEnabled ? bevelSize : 0;
    let area = 0;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
    const sgn = area >= 0 ? 1 : -1;
    // inset outline for the bevelled caps (miter offset by bevelSize along the vertex normal)
    const offset = (d) => pts.map((p, i) => {
      const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
      let e1x = p.x - a.x, e1y = p.y - a.y, e2x = b.x - p.x, e2y = b.y - p.y;
      const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
      e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
      let nx = (e1y + e2y) * sgn, ny = -(e1x + e2x) * sgn; // outward bisector
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const k = 1 / Math.max(0.3, nx * (e1y * sgn) + ny * (-e1x * sgn));
      return { x: p.x + nx * d * k, y: p.y + ny * d * k };
    });
    // z runs from -bevelThickness to depth + bevelThickness (the caps sit on the inset outline)
    const rings = bt > 0 ? [[offset(-bs), -bt], [pts, 0], [pts, depth], [offset(-bs), depth + bt]] : [[pts, 0], [pts, depth]];
    const P = [], N = [], U = [], I = [];
    // side walls (flat shaded: each quad has its own vertices)
    for (let r = 0; r < rings.length - 1; r++) {
      const [A, za] = rings[r], [B, zb] = rings[r + 1];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, base = P.length / 3;
        const a0 = A[i], a1 = A[j], b0 = B[i], b1 = B[j];
        P.push(a0.x, a0.y, za, a1.x, a1.y, za, b1.x, b1.y, zb, b0.x, b0.y, zb);
        const ux = a1.x - a0.x, uy = a1.y - a0.y, vx = b0.x - a0.x, vy = b0.y - a0.y, vz = zb - za;
        let nx = uy * vz, ny = -ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        if (sgn < 0) { nx = -nx; ny = -ny; nz = -nz; }
        for (let k = 0; k < 4; k++) N.push(nx, ny, nz);
        U.push(0, 0, 1, 0, 1, 1, 0, 1);
        if (sgn > 0) I.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    const tri = triangulate(pts);
    const cap = (poly, z, front) => {
      const base = P.length / 3;
      for (const p of poly) { P.push(p.x, p.y, z); N.push(0, 0, front ? -1 : 1); U.push(p.x, p.y); }
      for (let i = 0; i < tri.length; i += 3) front ? I.push(base + tri[i], base + tri[i + 2], base + tri[i + 1]) : I.push(base + tri[i], base + tri[i + 1], base + tri[i + 2]);
    };
    cap(rings[0][0], rings[0][1], true);
    cap(rings[rings.length - 1][0], rings[rings.length - 1][1], false);
    this.copy(fromArrays(P, N, U, I));
  }
}
