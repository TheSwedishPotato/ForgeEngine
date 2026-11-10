/**
 * Med Engine math: vectors, matrices, quaternions, Euler angles and colour.
 *
 * Conventions (the engine's, and what WebGPU wants):
 *  - right-handed world, +Y up, the camera looks down its own -Z;
 *  - matrices are column-major in a Float32Array(16), exactly as WGSL's mat4x4<f32> expects them,
 *    so `matrix.elements` can be copied into a uniform buffer unchanged;
 *  - clip-space depth runs 0..1 (WebGPU), and the camera projection is reversed-Z by default:
 *    near -> 1, far -> 0, which keeps a 32-bit depth buffer precise out to a kilometre and more.
 *
 * The method names follow the common 3D-math vocabulary (set / copy / clone / add / sub / multiply...)
 * so game code reads the way most people already know it. Everything here is written for this engine;
 * there is no third-party code in it.
 */

/**
 * Anything numbers are read from, and written to, by index: an array, a Float32Array, a view into a uniform buffer ...
 * @typedef {{ [i: number]: number }} NumberArrayLike
 */

/**
 * The order an Euler applies its three rotations in.
 * @typedef {'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY'} EulerOrder
 */

/**
 * What `new Color(...)` and `color.set(...)` take: an sRGB hex number (0xff8800), a CSS colour ('#ff8800', 'rgb(255, 136, 0)',
 * 'orange'), another Color, or `[r, g, b]` in linear 0..1.
 * @typedef {number | string | Color | number[]} ColorRepresentation
 */

/**
 * What Vector3.project() and unproject() read from a camera.
 * @typedef {{ matrixWorld: Matrix4, matrixWorldInverse: Matrix4, projectionMatrix: Matrix4, projectionMatrixInverse: Matrix4 }} ProjectionCamera
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
const EPS = Number.EPSILON;

// ---------------------------------------------------------------------------
// MathUtils

export const MathUtils = {
  DEG2RAD, RAD2DEG,
  /**
   * @param {number} v
   * @param {number} min
   * @param {number} max
   */
  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  /**
   * @param {number} n
   * @param {number} m
   */
  euclideanModulo: (n, m) => ((n % m) + m) % m,
  /**
   * @param {number} x
   * @param {number} a1
   * @param {number} a2
   * @param {number} b1
   * @param {number} b2
   */
  mapLinear: (x, a1, a2, b1, b2) => b1 + ((x - a1) * (b2 - b1)) / (a2 - a1),
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} v
   */
  inverseLerp: (x, y, v) => (x !== y ? (v - x) / (y - x) : 0),
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} t
   */
  lerp: (x, y, t) => (1 - t) * x + t * y,
  /**
   * Frame-rate independent exponential smoothing toward `y`.
   * @param {number} x
   * @param {number} y
   * @param {number} lambda
   * @param {number} dt
   */
  damp: (x, y, lambda, dt) => MathUtils.lerp(x, y, 1 - Math.exp(-lambda * dt)),
  /** @param {number} x */
  pingpong: (x, length = 1) => length - Math.abs(MathUtils.euclideanModulo(x, length * 2) - length),
  /**
   * @param {number} x
   * @param {number} min
   * @param {number} max
   */
  smoothstep(x, min, max) {
    if (x <= min) return 0;
    if (x >= max) return 1;
    x = (x - min) / (max - min);
    return x * x * (3 - 2 * x);
  },
  /**
   * @param {number} x
   * @param {number} min
   * @param {number} max
   */
  smootherstep(x, min, max) {
    if (x <= min) return 0;
    if (x >= max) return 1;
    x = (x - min) / (max - min);
    return x * x * x * (x * (x * 6 - 15) + 10);
  },
  /**
   * @param {number} low
   * @param {number} high
   */
  randInt: (low, high) => low + Math.floor(Math.random() * (high - low + 1)),
  /**
   * @param {number} low
   * @param {number} high
   */
  randFloat: (low, high) => low + Math.random() * (high - low),
  /** @param {number} range */
  randFloatSpread: (range) => range * (0.5 - Math.random()),
  /** @param {number} d */
  degToRad: (d) => d * DEG2RAD,
  /** @param {number} r */
  radToDeg: (r) => r * RAD2DEG,
  /** @param {number} v */
  isPowerOfTwo: (v) => (v & (v - 1)) === 0 && v !== 0,
  /** @param {number} v */
  ceilPowerOfTwo: (v) => 2 ** Math.ceil(Math.log2(v)),
  /** @param {number} v */
  floorPowerOfTwo: (v) => 2 ** Math.floor(Math.log2(v)),
  /**
   * A small seeded generator (mulberry32): same seed, same sequence, on every machine.
   * @param {number} seed
   */
  seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  generateUUID() {
    const h = /** @param {number} n */ (n) => n.toString(16).padStart(2, '0');
    const b = new Uint8Array(16);
    (globalThis.crypto?.getRandomValues?.(b)) ?? b.forEach((_, i) => { b[i] = (Math.random() * 256) | 0; });
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const x = [...b].map(h);
    return `${x.slice(0, 4).join('')}-${x.slice(4, 6).join('')}-${x.slice(6, 8).join('')}-${x.slice(8, 10).join('')}-${x.slice(10).join('')}`;
  },
};
const { clamp } = MathUtils;

// ---------------------------------------------------------------------------
// Vector2

export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  get isVector2() { return true; }
  get width() { return this.x; } /** @param {number} v */ set width(v) { this.x = v; }
  get height() { return this.y; } /** @param {number} v */ set height(v) { this.y = v; }
  /**
   * @param {number} x
   * @param {number} y
   */
  set(x, y) { this.x = x; this.y = y; return this; }
  /** @param {number} s */
  setScalar(s) { this.x = s; this.y = s; return this; }
  clone() { return new Vector2(this.x, this.y); }
  /** @param {Vector2} v */
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  /** @param {Vector2} v */
  add(v) { this.x += v.x; this.y += v.y; return this; }
  /** @param {number} s */
  addScalar(s) { this.x += s; this.y += s; return this; }
  /**
   * @param {Vector2} a
   * @param {Vector2} b
   */
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; return this; }
  /**
   * @param {Vector2} v
   * @param {number} s
   */
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }
  /** @param {Vector2} v */
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  /**
   * @param {Vector2} a
   * @param {Vector2} b
   */
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; return this; }
  /** @param {Vector2} v */
  multiply(v) { this.x *= v.x; this.y *= v.y; return this; }
  /** @param {number} s */
  multiplyScalar(s) { this.x *= s; this.y *= s; return this; }
  /** @param {number} s */
  divideScalar(s) { return this.multiplyScalar(1 / s); }
  /** @param {Vector2} v */
  min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); return this; }
  /** @param {Vector2} v */
  max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); return this; }
  /**
   * @param {Vector2} min
   * @param {Vector2} max
   */
  clamp(min, max) { this.x = clamp(this.x, min.x, max.x); this.y = clamp(this.y, min.y, max.y); return this; }
  negate() { this.x = -this.x; this.y = -this.y; return this; }
  /** @param {Vector2} v */
  dot(v) { return this.x * v.x + this.y * v.y; }
  /** @param {Vector2} v */
  cross(v) { return this.x * v.y - this.y * v.x; }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  length() { return Math.hypot(this.x, this.y); }
  normalize() { return this.divideScalar(this.length() || 1); }
  angle() { return Math.atan2(-this.y, -this.x) + Math.PI; }
  /** @param {Vector2} v */
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  /** @param {Vector2} v */
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
  /** @param {number} l */
  setLength(l) { return this.normalize().multiplyScalar(l); }
  /**
   * @param {Vector2} v
   * @param {number} t
   */
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; return this; }
  /**
   * @param {Vector2} a
   * @param {Vector2} b
   * @param {number} t
   */
  lerpVectors(a, b, t) { return this.subVectors(b, a).multiplyScalar(t).add(a); }
  /**
   * @param {Vector2} c
   * @param {number} angle
   */
  rotateAround(c, angle) {
    const cs = Math.cos(angle), sn = Math.sin(angle), x = this.x - c.x, y = this.y - c.y;
    this.x = x * cs - y * sn + c.x; this.y = x * sn + y * cs + c.y; return this;
  }
  /** @param {Vector2} v */
  equals(v) { return v.x === this.x && v.y === this.y; }
  /** @param {ArrayLike<number>} a */
  fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; return this; }
  /**
   * @template {NumberArrayLike} [T=number[]]
   * @param {T} [a]
   * @param {number} [o]
   * @returns {T}
   */
  toArray(a = /** @type {any} */ ([]), o = 0) { a[o] = this.x; a[o + 1] = this.y; return a; }
  *[Symbol.iterator]() { yield this.x; yield this.y; }
}

// ---------------------------------------------------------------------------
// Vector3

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  get isVector3() { return true; }
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  /** @param {number} s */
  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  /** @param {number} x */
  setX(x) { this.x = x; return this; }
  /** @param {number} y */
  setY(y) { this.y = y; return this; }
  /** @param {number} z */
  setZ(z) { this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  /** @param {Vector3} v */
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  /** @param {Vector3} v */
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  /** @param {number} s */
  addScalar(s) { this.x += s; this.y += s; this.z += s; return this; }
  /**
   * @param {Vector3} a
   * @param {Vector3} b
   */
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  /**
   * @param {Vector3} v
   * @param {number} s
   */
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  /** @param {Vector3} v */
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  /** @param {number} s */
  subScalar(s) { this.x -= s; this.y -= s; this.z -= s; return this; }
  /**
   * @param {Vector3} a
   * @param {Vector3} b
   */
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  /** @param {Vector3} v */
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  /** @param {number} s */
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  /**
   * @param {Vector3} a
   * @param {Vector3} b
   */
  multiplyVectors(a, b) { this.x = a.x * b.x; this.y = a.y * b.y; this.z = a.z * b.z; return this; }
  /** @param {Vector3} v */
  divide(v) { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; }
  /** @param {number} s */
  divideScalar(s) { return this.multiplyScalar(1 / s); }
  /** @param {Euler} e */
  applyEuler(e) { return this.applyQuaternion(_q1.setFromEuler(e)); }
  /**
   * @param {Vector3} axis
   * @param {number} angle
   */
  applyAxisAngle(axis, angle) { return this.applyQuaternion(_q1.setFromAxisAngle(axis, angle)); }
  /** @param {Matrix3} m */
  applyMatrix3(m) {
    const { x, y, z } = this, e = m.elements;
    this.x = e[0] * x + e[3] * y + e[6] * z;
    this.y = e[1] * x + e[4] * y + e[7] * z;
    this.z = e[2] * x + e[5] * y + e[8] * z;
    return this;
  }
  /** @param {Matrix3} m */
  applyNormalMatrix(m) { return this.applyMatrix3(m).normalize(); }
  /**
   * Transforms as a point (w = 1) and divides by w.
   * @param {Matrix4} m
   */
  applyMatrix4(m) {
    const { x, y, z } = this, e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
  /** @param {Quaternion} q */
  applyQuaternion(q) {
    const { x, y, z } = this, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  /** @param {ProjectionCamera} camera */
  project(camera) { return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix); }
  /** @param {ProjectionCamera} camera */
  unproject(camera) { return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld); }
  /**
   * Direction transform: rotation and scale of m, no translation, then normalised.
   * @param {Matrix4} m
   */
  transformDirection(m) {
    const { x, y, z } = this, e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }
  /** @param {Vector3} v */
  min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this; }
  /** @param {Vector3} v */
  max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this; }
  /**
   * @param {Vector3} min
   * @param {Vector3} max
   */
  clamp(min, max) { this.x = clamp(this.x, min.x, max.x); this.y = clamp(this.y, min.y, max.y); this.z = clamp(this.z, min.z, max.z); return this; }
  /**
   * @param {number} lo
   * @param {number} hi
   */
  clampScalar(lo, hi) { this.x = clamp(this.x, lo, hi); this.y = clamp(this.y, lo, hi); this.z = clamp(this.z, lo, hi); return this; }
  /**
   * @param {number} min
   * @param {number} max
   */
  clampLength(min, max) { const l = this.length(); return this.divideScalar(l || 1).multiplyScalar(clamp(l, min, max)); }
  floor() { this.x = Math.floor(this.x); this.y = Math.floor(this.y); this.z = Math.floor(this.z); return this; }
  ceil() { this.x = Math.ceil(this.x); this.y = Math.ceil(this.y); this.z = Math.ceil(this.z); return this; }
  round() { this.x = Math.round(this.x); this.y = Math.round(this.y); this.z = Math.round(this.z); return this; }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  /** @param {Vector3} v */
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  manhattanLength() { return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z); }
  normalize() { return this.divideScalar(this.length() || 1); }
  /** @param {number} l */
  setLength(l) { return this.normalize().multiplyScalar(l); }
  /**
   * @param {Vector3} v
   * @param {number} t
   */
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  /**
   * @param {Vector3} a
   * @param {Vector3} b
   * @param {number} t
   */
  lerpVectors(a, b, t) { return this.subVectors(b, a).multiplyScalar(t).add(a); }
  /** @param {Vector3} v */
  cross(v) { return this.crossVectors(this, v); }
  /**
   * @param {Vector3} a
   * @param {Vector3} b
   */
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx;
    return this;
  }
  /** @param {Vector3} v */
  projectOnVector(v) { const d = v.lengthSq(); return d === 0 ? this.set(0, 0, 0) : this.copy(v).multiplyScalar(this.dot(v) / d); }
  /** @param {Vector3} n */
  projectOnPlane(n) { _v1.copy(this).projectOnVector(n); return this.sub(_v1); }
  /** @param {Vector3} n */
  reflect(n) { return this.sub(_v1.copy(n).multiplyScalar(2 * this.dot(n))); }
  /** @param {Vector3} v */
  angleTo(v) {
    const d = Math.sqrt(this.lengthSq() * v.lengthSq());
    return d === 0 ? Math.PI / 2 : Math.acos(clamp(this.dot(v) / d, -1, 1));
  }
  /** @param {Vector3} v */
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  /** @param {Vector3} v */
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  /** @param {Vector3} v */
  manhattanDistanceTo(v) { return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z); }
  /** @param {{ radius: number, phi: number, theta: number }} s */
  setFromSpherical(s) { return this.setFromSphericalCoords(s.radius, s.phi, s.theta); }
  /**
   * @param {number} r
   * @param {number} phi
   * @param {number} theta
   */
  setFromSphericalCoords(r, phi, theta) {
    const sp = Math.sin(phi) * r;
    this.x = sp * Math.sin(theta); this.y = Math.cos(phi) * r; this.z = sp * Math.cos(theta);
    return this;
  }
  /** @param {Matrix4} m */
  setFromMatrixPosition(m) { const e = m.elements; this.x = e[12]; this.y = e[13]; this.z = e[14]; return this; }
  /** @param {Matrix4} m */
  setFromMatrixScale(m) {
    const e = m.elements;
    this.x = Math.hypot(e[0], e[1], e[2]); this.y = Math.hypot(e[4], e[5], e[6]); this.z = Math.hypot(e[8], e[9], e[10]);
    return this;
  }
  /**
   * @param {Matrix4} m
   * @param {number} i
   */
  setFromMatrixColumn(m, i) { return this.fromArray(m.elements, i * 4); }
  /** @param {Euler} e */
  setFromEuler(e) { this.x = e._x; this.y = e._y; this.z = e._z; return this; }
  /** @param {Vector3} v */
  equals(v) { return v.x === this.x && v.y === this.y && v.z === this.z; }
  /** @param {ArrayLike<number>} a */
  fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; return this; }
  /**
   * @template {NumberArrayLike} [T=number[]]
   * @param {T} [a]
   * @param {number} [o]
   * @returns {T}
   */
  toArray(a = /** @type {any} */ ([]), o = 0) { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; return a; }
  /**
   * @param {{ getX(i: number): number, getY(i: number): number, getZ(i: number): number }} attr
   * @param {number} i
   */
  fromBufferAttribute(attr, i) { this.x = attr.getX(i); this.y = attr.getY(i); this.z = attr.getZ(i); return this; }
  random() { this.x = Math.random(); this.y = Math.random(); this.z = Math.random(); return this; }
  *[Symbol.iterator]() { yield this.x; yield this.y; yield this.z; }
}

// ---------------------------------------------------------------------------
// Vector4

export class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  get isVector4() { return true; }
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} w
   */
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  /** @param {number} s */
  setScalar(s) { this.x = s; this.y = s; this.z = s; this.w = s; return this; }
  clone() { return new Vector4(this.x, this.y, this.z, this.w); }
  /** @param {{ x: number, y: number, z: number, w?: number }} v */
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w ?? 1; return this; }
  /** @param {Vector4} v */
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; this.w += v.w; return this; }
  /** @param {Vector4} v */
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; this.w -= v.w; return this; }
  /** @param {number} s */
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; this.w *= s; return this; }
  /** @param {number} s */
  divideScalar(s) { return this.multiplyScalar(1 / s); }
  /** @param {Matrix4} m */
  applyMatrix4(m) {
    const { x, y, z, w } = this, e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
    this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
    this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
    this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;
    return this;
  }
  /** @param {Vector4} v */
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w; }
  lengthSq() { return this.dot(this); }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { return this.divideScalar(this.length() || 1); }
  /**
   * @param {Vector4} v
   * @param {number} t
   */
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; this.w += (v.w - this.w) * t; return this; }
  /** @param {Vector4} v */
  equals(v) { return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w; }
  /** @param {ArrayLike<number>} a */
  fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; this.w = a[o + 3]; return this; }
  /**
   * @template {NumberArrayLike} [T=number[]]
   * @param {T} [a]
   * @param {number} [o]
   * @returns {T}
   */
  toArray(a = /** @type {any} */ ([]), o = 0) { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; a[o + 3] = this.w; return a; }
  *[Symbol.iterator]() { yield this.x; yield this.y; yield this.z; yield this.w; }
}

// ---------------------------------------------------------------------------
// Quaternion

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this._x = x; this._y = y; this._z = z; this._w = w; }
  get isQuaternion() { return true; }
  get x() { return this._x; } /** @param {number} v */ set x(v) { this._x = v; this._onChangeCallback(); }
  get y() { return this._y; } /** @param {number} v */ set y(v) { this._y = v; this._onChangeCallback(); }
  get z() { return this._z; } /** @param {number} v */ set z(v) { this._z = v; this._onChangeCallback(); }
  get w() { return this._w; } /** @param {number} v */ set w(v) { this._w = v; this._onChangeCallback(); }
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} w
   */
  set(x, y, z, w) { this._x = x; this._y = y; this._z = z; this._w = w; this._onChangeCallback(); return this; }
  clone() { return new Quaternion(this._x, this._y, this._z, this._w); }
  /** @param {Quaternion} q */
  copy(q) { this._x = q.x; this._y = q.y; this._z = q.z; this._w = q.w; this._onChangeCallback(); return this; }
  /** @param {Euler} e */
  setFromEuler(e, update = true) {
    const x = e._x, y = e._y, z = e._z, order = e._order;
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    switch (order) {
      case 'XYZ': this._x = s1 * c2 * c3 + c1 * s2 * s3; this._y = c1 * s2 * c3 - s1 * c2 * s3; this._z = c1 * c2 * s3 + s1 * s2 * c3; this._w = c1 * c2 * c3 - s1 * s2 * s3; break;
      case 'YXZ': this._x = s1 * c2 * c3 + c1 * s2 * s3; this._y = c1 * s2 * c3 - s1 * c2 * s3; this._z = c1 * c2 * s3 - s1 * s2 * c3; this._w = c1 * c2 * c3 + s1 * s2 * s3; break;
      case 'ZXY': this._x = s1 * c2 * c3 - c1 * s2 * s3; this._y = c1 * s2 * c3 + s1 * c2 * s3; this._z = c1 * c2 * s3 + s1 * s2 * c3; this._w = c1 * c2 * c3 - s1 * s2 * s3; break;
      case 'ZYX': this._x = s1 * c2 * c3 - c1 * s2 * s3; this._y = c1 * s2 * c3 + s1 * c2 * s3; this._z = c1 * c2 * s3 - s1 * s2 * c3; this._w = c1 * c2 * c3 + s1 * s2 * s3; break;
      case 'YZX': this._x = s1 * c2 * c3 + c1 * s2 * s3; this._y = c1 * s2 * c3 + s1 * c2 * s3; this._z = c1 * c2 * s3 - s1 * s2 * c3; this._w = c1 * c2 * c3 - s1 * s2 * s3; break;
      case 'XZY': this._x = s1 * c2 * c3 - c1 * s2 * s3; this._y = c1 * s2 * c3 - s1 * c2 * s3; this._z = c1 * c2 * s3 + s1 * s2 * c3; this._w = c1 * c2 * c3 + s1 * s2 * s3; break;
      default: throw new Error(`Quaternion.setFromEuler: unknown order ${order}`);
    }
    if (update) this._onChangeCallback();
    return this;
  }
  /**
   * @param {Vector3} axis
   * @param {number} angle
   */
  setFromAxisAngle(axis, angle) {
    const h = angle / 2, s = Math.sin(h);
    this._x = axis.x * s; this._y = axis.y * s; this._z = axis.z * s; this._w = Math.cos(h);
    this._onChangeCallback();
    return this;
  }
  /** @param {Matrix4} m */
  setFromRotationMatrix(m) {
    const te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10];
    const tr = m11 + m22 + m33;
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1);
      this._w = 0.25 / s; this._x = (m32 - m23) * s; this._y = (m13 - m31) * s; this._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      this._w = (m32 - m23) / s; this._x = 0.25 * s; this._y = (m12 + m21) / s; this._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      this._w = (m13 - m31) / s; this._x = (m12 + m21) / s; this._y = 0.25 * s; this._z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      this._w = (m21 - m12) / s; this._x = (m13 + m31) / s; this._y = (m23 + m32) / s; this._z = 0.25 * s;
    }
    this._onChangeCallback();
    return this;
  }
  /**
   * The shortest rotation taking unit vector `from` to unit vector `to`.
   * @param {Vector3} from
   * @param {Vector3} to
   */
  setFromUnitVectors(from, to) {
    let r = from.dot(to) + 1;
    if (r < EPS) {
      r = 0;
      if (Math.abs(from.x) > Math.abs(from.z)) { this._x = -from.y; this._y = from.x; this._z = 0; this._w = r; }
      else { this._x = 0; this._y = -from.z; this._z = from.y; this._w = r; }
    } else {
      this._x = from.y * to.z - from.z * to.y; this._y = from.z * to.x - from.x * to.z; this._z = from.x * to.y - from.y * to.x; this._w = r;
    }
    return this.normalize();
  }
  /** @param {Quaternion} q */
  angleTo(q) { return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1))); }
  /**
   * @param {Quaternion} q
   * @param {number} step
   */
  rotateTowards(q, step) {
    const angle = this.angleTo(q);
    if (angle === 0) return this;
    return this.slerp(q, Math.min(1, step / angle));
  }
  identity() { return this.set(0, 0, 0, 1); }
  invert() { return this.conjugate(); }
  conjugate() { this._x *= -1; this._y *= -1; this._z *= -1; this._onChangeCallback(); return this; }
  /** @param {Quaternion} q */
  dot(q) { return this._x * q._x + this._y * q._y + this._z * q._z + this._w * q._w; }
  lengthSq() { return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() {
    let l = this.length();
    if (l === 0) { this._x = 0; this._y = 0; this._z = 0; this._w = 1; }
    else { l = 1 / l; this._x *= l; this._y *= l; this._z *= l; this._w *= l; }
    this._onChangeCallback();
    return this;
  }
  /** @param {Quaternion} q */
  multiply(q) { return this.multiplyQuaternions(this, q); }
  /** @param {Quaternion} q */
  premultiply(q) { return this.multiplyQuaternions(q, this); }
  /**
   * @param {Quaternion} a
   * @param {Quaternion} b
   */
  multiplyQuaternions(a, b) {
    const qax = a._x, qay = a._y, qaz = a._z, qaw = a._w, qbx = b._x, qby = b._y, qbz = b._z, qbw = b._w;
    this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    this._onChangeCallback();
    return this;
  }
  /**
   * @param {Quaternion} qb
   * @param {number} t
   */
  slerp(qb, t) {
    if (t === 0) return this;
    if (t === 1) return this.copy(qb);
    const x = this._x, y = this._y, z = this._z, w = this._w;
    let cos = w * qb._w + x * qb._x + y * qb._y + z * qb._z;
    if (cos < 0) { this._w = -qb._w; this._x = -qb._x; this._y = -qb._y; this._z = -qb._z; cos = -cos; }
    else this.copy(qb);
    if (cos >= 1.0) { this._w = w; this._x = x; this._y = y; this._z = z; return this; }
    const sqrSin = 1.0 - cos * cos;
    if (sqrSin <= EPS) {
      const s = 1 - t;
      this._w = s * w + t * this._w; this._x = s * x + t * this._x; this._y = s * y + t * this._y; this._z = s * z + t * this._z;
      this.normalize();
      return this;
    }
    const sin = Math.sqrt(sqrSin), half = Math.atan2(sin, cos);
    const ra = Math.sin((1 - t) * half) / sin, rb = Math.sin(t * half) / sin;
    this._w = w * ra + this._w * rb; this._x = x * ra + this._x * rb; this._y = y * ra + this._y * rb; this._z = z * ra + this._z * rb;
    this._onChangeCallback();
    return this;
  }
  /**
   * @param {Quaternion} a
   * @param {Quaternion} b
   * @param {number} t
   */
  slerpQuaternions(a, b, t) { return this.copy(a).slerp(b, t); }
  /** @param {Quaternion} q */
  equals(q) { return q._x === this._x && q._y === this._y && q._z === this._z && q._w === this._w; }
  /** @param {ArrayLike<number>} a */
  fromArray(a, o = 0) { this._x = a[o]; this._y = a[o + 1]; this._z = a[o + 2]; this._w = a[o + 3]; this._onChangeCallback(); return this; }
  /**
   * @template {NumberArrayLike} [T=number[]]
   * @param {T} [a]
   * @param {number} [o]
   * @returns {T}
   */
  toArray(a = /** @type {any} */ ([]), o = 0) { a[o] = this._x; a[o + 1] = this._y; a[o + 2] = this._z; a[o + 3] = this._w; return a; }
  /** @param {() => void} cb */
  _onChange(cb) { this._onChangeCallback = cb; return this; }
  _onChangeCallback() {}
  *[Symbol.iterator]() { yield this._x; yield this._y; yield this._z; yield this._w; }
}

// ---------------------------------------------------------------------------
// Euler

export class Euler {
  /** @param {EulerOrder} [order] */
  constructor(x = 0, y = 0, z = 0, order = Euler.DEFAULT_ORDER) { this._x = x; this._y = y; this._z = z; this._order = order; }
  get isEuler() { return true; }
  get x() { return this._x; } /** @param {number} v */ set x(v) { this._x = v; this._onChangeCallback(); }
  get y() { return this._y; } /** @param {number} v */ set y(v) { this._y = v; this._onChangeCallback(); }
  get z() { return this._z; } /** @param {number} v */ set z(v) { this._z = v; this._onChangeCallback(); }
  get order() { return this._order; } /** @param {EulerOrder} v */ set order(v) { this._order = v; this._onChangeCallback(); }
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {EulerOrder} [order]
   */
  set(x, y, z, order = this._order) { this._x = x; this._y = y; this._z = z; this._order = order; this._onChangeCallback(); return this; }
  clone() { return new Euler(this._x, this._y, this._z, this._order); }
  /** @param {Euler} e */
  copy(e) { this._x = e._x; this._y = e._y; this._z = e._z; this._order = e._order; this._onChangeCallback(); return this; }
  /**
   * @param {Matrix4} m
   * @param {EulerOrder} [order]
   */
  setFromRotationMatrix(m, order = this._order, update = true) {
    const te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10];
    switch (order) {
      case 'XYZ':
        this._y = Math.asin(clamp(m13, -1, 1));
        if (Math.abs(m13) < 0.9999999) { this._x = Math.atan2(-m23, m33); this._z = Math.atan2(-m12, m11); } else { this._x = Math.atan2(m32, m22); this._z = 0; }
        break;
      case 'YXZ':
        this._x = Math.asin(-clamp(m23, -1, 1));
        if (Math.abs(m23) < 0.9999999) { this._y = Math.atan2(m13, m33); this._z = Math.atan2(m21, m22); } else { this._y = Math.atan2(-m31, m11); this._z = 0; }
        break;
      case 'ZXY':
        this._x = Math.asin(clamp(m32, -1, 1));
        if (Math.abs(m32) < 0.9999999) { this._y = Math.atan2(-m31, m33); this._z = Math.atan2(-m12, m22); } else { this._y = 0; this._z = Math.atan2(m21, m11); }
        break;
      case 'ZYX':
        this._y = Math.asin(-clamp(m31, -1, 1));
        if (Math.abs(m31) < 0.9999999) { this._x = Math.atan2(m32, m33); this._z = Math.atan2(m21, m11); } else { this._x = 0; this._z = Math.atan2(-m12, m22); }
        break;
      case 'YZX':
        this._z = Math.asin(clamp(m21, -1, 1));
        if (Math.abs(m21) < 0.9999999) { this._x = Math.atan2(-m23, m22); this._y = Math.atan2(-m31, m11); } else { this._x = 0; this._y = Math.atan2(m13, m33); }
        break;
      case 'XZY':
        this._z = Math.asin(-clamp(m12, -1, 1));
        if (Math.abs(m12) < 0.9999999) { this._x = Math.atan2(m32, m22); this._y = Math.atan2(m13, m11); } else { this._x = Math.atan2(-m23, m33); this._y = 0; }
        break;
      default: throw new Error(`Euler.setFromRotationMatrix: unknown order ${order}`);
    }
    this._order = order;
    if (update) this._onChangeCallback();
    return this;
  }
  /**
   * @param {Quaternion} q
   * @param {EulerOrder} [order]
   */
  setFromQuaternion(q, order = this._order, update = true) { _m1.makeRotationFromQuaternion(q); return this.setFromRotationMatrix(_m1, order, update); }
  /**
   * @param {Vector3} v
   * @param {EulerOrder} [order]
   */
  setFromVector3(v, order = this._order) { return this.set(v.x, v.y, v.z, order); }
  /** @param {EulerOrder} newOrder */
  reorder(newOrder) { _q1.setFromEuler(this); return this.setFromQuaternion(_q1, newOrder); }
  /** @param {Euler} e */
  equals(e) { return e._x === this._x && e._y === this._y && e._z === this._z && e._order === this._order; }
  /** @param {[number, number, number, EulerOrder?]} a */
  fromArray(a) { this._x = a[0]; this._y = a[1]; this._z = a[2]; if (a[3] !== undefined) this._order = a[3]; this._onChangeCallback(); return this; }
  /**
   * `[x, y, z, order]`: the three angles and then the order's name.
   * @template {{ [i: number]: number | string }} [T=(number | string)[]]
   * @param {T} [a]
   * @param {number} [o]
   * @returns {T}
   */
  toArray(a = /** @type {any} */ ([]), o = 0) { a[o] = this._x; a[o + 1] = this._y; a[o + 2] = this._z; a[o + 3] = this._order; return a; }
  /** @param {() => void} cb */
  _onChange(cb) { this._onChangeCallback = cb; return this; }
  _onChangeCallback() {}
  *[Symbol.iterator]() { yield this._x; yield this._y; yield this._z; yield this._order; }
}
/** @type {EulerOrder} The order a new Euler uses unless told otherwise. */
Euler.DEFAULT_ORDER = 'XYZ';

// ---------------------------------------------------------------------------
// Matrix3

export class Matrix3 {
  constructor() { this.elements = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]); }
  get isMatrix3() { return true; }
  /**
   * @param {number} n11
   * @param {number} n12
   * @param {number} n13
   * @param {number} n21
   * @param {number} n22
   * @param {number} n23
   * @param {number} n31
   * @param {number} n32
   * @param {number} n33
   */
  set(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
    const te = this.elements;
    te[0] = n11; te[1] = n21; te[2] = n31; te[3] = n12; te[4] = n22; te[5] = n32; te[6] = n13; te[7] = n23; te[8] = n33;
    return this;
  }
  identity() { return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1); }
  /** @param {Matrix3} m */
  copy(m) { this.elements.set(m.elements); return this; }
  clone() { return new Matrix3().copy(this); }
  /** @param {Matrix4} m */
  setFromMatrix4(m) { const me = m.elements; return this.set(me[0], me[4], me[8], me[1], me[5], me[9], me[2], me[6], me[10]); }
  /** @param {Matrix3} m */
  multiply(m) { return this.multiplyMatrices(this, m); }
  /** @param {Matrix3} m */
  premultiply(m) { return this.multiplyMatrices(m, this); }
  /**
   * @param {Matrix3} a
   * @param {Matrix3} b
   */
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a11 = ae[0], a12 = ae[3], a13 = ae[6], a21 = ae[1], a22 = ae[4], a23 = ae[7], a31 = ae[2], a32 = ae[5], a33 = ae[8];
    const b11 = be[0], b12 = be[3], b13 = be[6], b21 = be[1], b22 = be[4], b23 = be[7], b31 = be[2], b32 = be[5], b33 = be[8];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31; te[3] = a11 * b12 + a12 * b22 + a13 * b32; te[6] = a11 * b13 + a12 * b23 + a13 * b33;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31; te[4] = a21 * b12 + a22 * b22 + a23 * b32; te[7] = a21 * b13 + a22 * b23 + a23 * b33;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31; te[5] = a31 * b12 + a32 * b22 + a33 * b32; te[8] = a31 * b13 + a32 * b23 + a33 * b33;
    return this;
  }
  /** @param {number} s */
  multiplyScalar(s) { const te = this.elements; for (let i = 0; i < 9; i++) te[i] *= s; return this; }
  determinant() {
    const te = this.elements, a = te[0], b = te[1], c = te[2], d = te[3], e = te[4], f = te[5], g = te[6], h = te[7], i = te[8];
    return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
  }
  invert() {
    const te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n12 = te[3], n22 = te[4], n32 = te[5], n13 = te[6], n23 = te[7], n33 = te[8];
    const t11 = n33 * n22 - n32 * n23, t12 = n32 * n13 - n33 * n12, t13 = n23 * n12 - n22 * n13;
    const det = n11 * t11 + n21 * t12 + n31 * t13;
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    const d = 1 / det;
    te[0] = t11 * d; te[1] = (n31 * n23 - n33 * n21) * d; te[2] = (n32 * n21 - n31 * n22) * d;
    te[3] = t12 * d; te[4] = (n33 * n11 - n31 * n13) * d; te[5] = (n31 * n12 - n32 * n11) * d;
    te[6] = t13 * d; te[7] = (n21 * n13 - n23 * n11) * d; te[8] = (n22 * n11 - n21 * n12) * d;
    return this;
  }
  transpose() {
    const m = this.elements; let t;
    t = m[1]; m[1] = m[3]; m[3] = t; t = m[2]; m[2] = m[6]; m[6] = t; t = m[5]; m[5] = m[7]; m[7] = t;
    return this;
  }
  /**
   * The matrix that transforms normals for the model matrix `m4` (inverse transpose of its 3x3).
   * @param {Matrix4} m4
   */
  getNormalMatrix(m4) { return this.setFromMatrix4(m4).invert().transpose(); }
  /**
   * @param {number} tx
   * @param {number} ty
   * @param {number} sx
   * @param {number} sy
   * @param {number} rotation
   * @param {number} cx
   * @param {number} cy
   */
  setUvTransform(tx, ty, sx, sy, rotation, cx, cy) {
    const c = Math.cos(rotation), s = Math.sin(rotation);
    this.set(sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx, -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty, 0, 0, 1);
    return this;
  }
  /** @param {Matrix3} m */
  equals(m) { for (let i = 0; i < 9; i++) if (this.elements[i] !== m.elements[i]) return false; return true; }
  /** @param {ArrayLike<number>} a */
  fromArray(a, o = 0) { for (let i = 0; i < 9; i++) this.elements[i] = a[i + o]; return this; }
  /**
   * @template {NumberArrayLike} [T=number[]]
   * @param {T} [a]
   * @param {number} [o]
   * @returns {T}
   */
  toArray(a = /** @type {any} */ ([]), o = 0) { for (let i = 0; i < 9; i++) a[o + i] = this.elements[i]; return a; }
}

// ---------------------------------------------------------------------------
// Matrix4

export class Matrix4 {
  constructor() { this.elements = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  get isMatrix4() { return true; }
  /**
   * Arguments are given row by row (the way matrices are written on paper); storage is column-major.
   * @param {number} n11
   * @param {number} n12
   * @param {number} n13
   * @param {number} n14
   * @param {number} n21
   * @param {number} n22
   * @param {number} n23
   * @param {number} n24
   * @param {number} n31
   * @param {number} n32
   * @param {number} n33
   * @param {number} n34
   * @param {number} n41
   * @param {number} n42
   * @param {number} n43
   * @param {number} n44
   */
  set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
    const te = this.elements;
    te[0] = n11; te[4] = n12; te[8] = n13; te[12] = n14;
    te[1] = n21; te[5] = n22; te[9] = n23; te[13] = n24;
    te[2] = n31; te[6] = n32; te[10] = n33; te[14] = n34;
    te[3] = n41; te[7] = n42; te[11] = n43; te[15] = n44;
    return this;
  }
  identity() { return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); }
  clone() { return new Matrix4().copy(this); }
  /** @param {Matrix4} m */
  copy(m) { this.elements.set(m.elements); return this; }
  /** @param {Matrix4} m */
  copyPosition(m) { const te = this.elements, me = m.elements; te[12] = me[12]; te[13] = me[13]; te[14] = me[14]; return this; }
  /** @param {Matrix3} m */
  setFromMatrix3(m) { const me = m.elements; return this.set(me[0], me[3], me[6], 0, me[1], me[4], me[7], 0, me[2], me[5], me[8], 0, 0, 0, 0, 1); }
  /**
   * @param {Vector3} x
   * @param {Vector3} y
   * @param {Vector3} z
   */
  extractBasis(x, y, z) { x.setFromMatrixColumn(this, 0); y.setFromMatrixColumn(this, 1); z.setFromMatrixColumn(this, 2); return this; }
  /**
   * @param {Vector3} x
   * @param {Vector3} y
   * @param {Vector3} z
   */
  makeBasis(x, y, z) { return this.set(x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1); }
  /**
   * Keeps only the rotation of `m` (scale divided out).
   * @param {Matrix4} m
   */
  extractRotation(m) {
    const te = this.elements, me = m.elements;
    const sx = 1 / Math.hypot(me[0], me[1], me[2]), sy = 1 / Math.hypot(me[4], me[5], me[6]), sz = 1 / Math.hypot(me[8], me[9], me[10]);
    te[0] = me[0] * sx; te[1] = me[1] * sx; te[2] = me[2] * sx; te[3] = 0;
    te[4] = me[4] * sy; te[5] = me[5] * sy; te[6] = me[6] * sy; te[7] = 0;
    te[8] = me[8] * sz; te[9] = me[9] * sz; te[10] = me[10] * sz; te[11] = 0;
    te[12] = 0; te[13] = 0; te[14] = 0; te[15] = 1;
    return this;
  }
  /** @param {Euler} euler */
  makeRotationFromEuler(euler) {
    const te = this.elements, x = euler._x, y = euler._y, z = euler._z;
    const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
    switch (euler._order) {
      case 'XYZ': {
        const ae = a * e, af = a * f, be = b * e, bf = b * f;
        te[0] = c * e; te[4] = -c * f; te[8] = d;
        te[1] = af + be * d; te[5] = ae - bf * d; te[9] = -b * c;
        te[2] = bf - ae * d; te[6] = be + af * d; te[10] = a * c;
        break;
      }
      case 'YXZ': {
        const ce = c * e, cf = c * f, de = d * e, df = d * f;
        te[0] = ce + df * b; te[4] = de * b - cf; te[8] = a * d;
        te[1] = a * f; te[5] = a * e; te[9] = -b;
        te[2] = cf * b - de; te[6] = df + ce * b; te[10] = a * c;
        break;
      }
      case 'ZXY': {
        const ce = c * e, cf = c * f, de = d * e, df = d * f;
        te[0] = ce - df * b; te[4] = -a * f; te[8] = de + cf * b;
        te[1] = cf + de * b; te[5] = a * e; te[9] = df - ce * b;
        te[2] = -a * d; te[6] = b; te[10] = a * c;
        break;
      }
      case 'ZYX': {
        const ae = a * e, af = a * f, be = b * e, bf = b * f;
        te[0] = c * e; te[4] = be * d - af; te[8] = ae * d + bf;
        te[1] = c * f; te[5] = bf * d + ae; te[9] = af * d - be;
        te[2] = -d; te[6] = b * c; te[10] = a * c;
        break;
      }
      case 'YZX': {
        const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
        te[0] = c * e; te[4] = bd - ac * f; te[8] = bc * f + ad;
        te[1] = f; te[5] = a * e; te[9] = -b * e;
        te[2] = -d * e; te[6] = ad * f + bc; te[10] = ac - bd * f;
        break;
      }
      case 'XZY': {
        const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
        te[0] = c * e; te[4] = -f; te[8] = d * e;
        te[1] = ac * f + bd; te[5] = a * e; te[9] = ad * f - bc;
        te[2] = bc * f - ad; te[6] = b * e; te[10] = bd * f + ac;
        break;
      }
      default: throw new Error(`Matrix4.makeRotationFromEuler: unknown order ${euler._order}`);
    }
    te[3] = 0; te[7] = 0; te[11] = 0; te[12] = 0; te[13] = 0; te[14] = 0; te[15] = 1;
    return this;
  }
  /** @param {Quaternion} q */
  makeRotationFromQuaternion(q) { return this.compose(_zero, q, _one); }
  /**
   * A rotation that looks from `eye` toward `target` (the -Z axis of the result points at the target).
   * @param {Vector3} eye
   * @param {Vector3} target
   * @param {Vector3} up
   */
  lookAt(eye, target, up) {
    const te = this.elements;
    _z.subVectors(eye, target);
    if (_z.lengthSq() === 0) _z.z = 1;
    _z.normalize();
    _x.crossVectors(up, _z);
    if (_x.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) _z.x += 0.0001; else _z.z += 0.0001;
      _z.normalize();
      _x.crossVectors(up, _z);
    }
    _x.normalize();
    _y.crossVectors(_z, _x);
    te[0] = _x.x; te[4] = _y.x; te[8] = _z.x;
    te[1] = _x.y; te[5] = _y.y; te[9] = _z.y;
    te[2] = _x.z; te[6] = _y.z; te[10] = _z.z;
    return this;
  }
  /** @param {Matrix4} m */
  multiply(m) { return this.multiplyMatrices(this, m); }
  /** @param {Matrix4} m */
  premultiply(m) { return this.multiplyMatrices(m, this); }
  /**
   * @param {Matrix4} a
   * @param {Matrix4} b
   */
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12], a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14], a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12], b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14], b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41; te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43; te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41; te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43; te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41; te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43; te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41; te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43; te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return this;
  }
  /** @param {number} s */
  multiplyScalar(s) { const te = this.elements; for (let i = 0; i < 16; i++) te[i] *= s; return this; }
  determinant() {
    const te = this.elements;
    const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12], n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13];
    const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14], n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];
    return n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34)
      + n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31)
      + n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31)
      + n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31);
  }
  transpose() {
    const te = this.elements; let t;
    t = te[1]; te[1] = te[4]; te[4] = t; t = te[2]; te[2] = te[8]; te[8] = t; t = te[6]; te[6] = te[9]; te[9] = t;
    t = te[3]; te[3] = te[12]; te[12] = t; t = te[7]; te[7] = te[13]; te[13] = t; t = te[11]; te[11] = te[14]; te[14] = t;
    return this;
  }
  /**
   * @param {number | Vector3} x
   * @param {number} [y]
   * @param {number} [z]
   */
  setPosition(x, y, z) {
    const te = this.elements;
    if (typeof x === 'object') { te[12] = x.x; te[13] = x.y; te[14] = x.z; } else { te[12] = x; te[13] = /** @type {number} */ (y); te[14] = /** @type {number} */ (z); }
    return this;
  }
  invert() {
    const te = this.elements;
    const n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3], n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7];
    const n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11], n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const d = 1 / det;
    te[0] = t11 * d;
    te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
    te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
    te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
    te[4] = t12 * d;
    te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
    te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
    te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
    te[8] = t13 * d;
    te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
    te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
    te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
    te[12] = t14 * d;
    te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
    te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
    te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
    return this;
  }
  /** @param {Vector3} v */
  scale(v) {
    const te = this.elements, x = v.x, y = v.y, z = v.z;
    te[0] *= x; te[4] *= y; te[8] *= z; te[1] *= x; te[5] *= y; te[9] *= z;
    te[2] *= x; te[6] *= y; te[10] *= z; te[3] *= x; te[7] *= y; te[11] *= z;
    return this;
  }
  getMaxScaleOnAxis() {
    const te = this.elements;
    return Math.sqrt(Math.max(te[0] ** 2 + te[1] ** 2 + te[2] ** 2, te[4] ** 2 + te[5] ** 2 + te[6] ** 2, te[8] ** 2 + te[9] ** 2 + te[10] ** 2));
  }
  /**
   * @param {number | Vector3} x
   * @param {number} [y]
   * @param {number} [z]
   */
  makeTranslation(x, y, z) {
    if (typeof x === 'object') return this.set(1, 0, 0, x.x, 0, 1, 0, x.y, 0, 0, 1, x.z, 0, 0, 0, 1);
    return this.set(1, 0, 0, x, 0, 1, 0, /** @type {number} */ (y), 0, 0, 1, /** @type {number} */ (z), 0, 0, 0, 1);
  }
  /** @param {number} t */
  makeRotationX(t) { const c = Math.cos(t), s = Math.sin(t); return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1); }
  /** @param {number} t */
  makeRotationY(t) { const c = Math.cos(t), s = Math.sin(t); return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1); }
  /** @param {number} t */
  makeRotationZ(t) { const c = Math.cos(t), s = Math.sin(t); return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); }
  /**
   * @param {Vector3} axis
   * @param {number} angle
   */
  makeRotationAxis(axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c, x = axis.x, y = axis.y, z = axis.z, tx = t * x, ty = t * y;
    return this.set(tx * x + c, tx * y - s * z, tx * z + s * y, 0, tx * y + s * z, ty * y + c, ty * z - s * x, 0, tx * z - s * y, ty * z + s * x, t * z * z + c, 0, 0, 0, 0, 1);
  }
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  makeScale(x, y, z) { return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1); }
  /**
   * @param {Vector3} position
   * @param {Quaternion} quaternion
   * @param {Vector3} scale
   */
  compose(position, quaternion, scale) {
    const te = this.elements, x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w;
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2, sx = scale.x, sy = scale.y, sz = scale.z;
    te[0] = (1 - (yy + zz)) * sx; te[1] = (xy + wz) * sx; te[2] = (xz - wy) * sx; te[3] = 0;
    te[4] = (xy - wz) * sy; te[5] = (1 - (xx + zz)) * sy; te[6] = (yz + wx) * sy; te[7] = 0;
    te[8] = (xz + wy) * sz; te[9] = (yz - wx) * sz; te[10] = (1 - (xx + yy)) * sz; te[11] = 0;
    te[12] = position.x; te[13] = position.y; te[14] = position.z; te[15] = 1;
    return this;
  }
  /**
   * @param {Vector3} position
   * @param {Quaternion} quaternion
   * @param {Vector3} scale
   */
  decompose(position, quaternion, scale) {
    const te = this.elements;
    let sx = Math.hypot(te[0], te[1], te[2]);
    const sy = Math.hypot(te[4], te[5], te[6]), sz = Math.hypot(te[8], te[9], te[10]);
    if (this.determinant() < 0) sx = -sx;
    position.x = te[12]; position.y = te[13]; position.z = te[14];
    _m2.copy(this);
    const isx = 1 / sx, isy = 1 / sy, isz = 1 / sz, m = _m2.elements;
    m[0] *= isx; m[1] *= isx; m[2] *= isx; m[4] *= isy; m[5] *= isy; m[6] *= isy; m[8] *= isz; m[9] *= isz; m[10] *= isz;
    quaternion.setFromRotationMatrix(_m2);
    scale.x = sx; scale.y = sy; scale.z = sz;
    return this;
  }
  /**
   * Perspective projection for WebGPU: depth 0..1. With `reversed` (the engine's default) the near
   * plane maps to 1 and the far plane to 0. `far` may be Infinity.
   * @param {number} left
   * @param {number} right
   * @param {number} top
   * @param {number} bottom
   * @param {number} near
   * @param {number} far
   */
  makePerspective(left, right, top, bottom, near, far, reversed = false) {
    const te = this.elements;
    const x = (2 * near) / (right - left), y = (2 * near) / (top - bottom);
    const a = (right + left) / (right - left), b = (top + bottom) / (top - bottom);
    let c, d;
    if (reversed) {
      if (far === Infinity) { c = 0; d = near; } else { c = near / (far - near); d = (near * far) / (far - near); }
    } else if (far === Infinity) { c = -1; d = -near; } else { c = -far / (far - near); d = -(far * near) / (far - near); }
    te[0] = x; te[4] = 0; te[8] = a; te[12] = 0;
    te[1] = 0; te[5] = y; te[9] = b; te[13] = 0;
    te[2] = 0; te[6] = 0; te[10] = c; te[14] = d;
    te[3] = 0; te[7] = 0; te[11] = -1; te[15] = 0;
    return this;
  }
  /**
   * Convenience: perspective from a vertical field of view in degrees.
   * @param {number} fovDeg
   * @param {number} aspect
   * @param {number} near
   * @param {number} far
   */
  makePerspectiveFov(fovDeg, aspect, near, far, reversed = false) {
    const top = near * Math.tan(fovDeg * DEG2RAD * 0.5), right = top * aspect;
    return this.makePerspective(-right, right, top, -top, near, far, reversed);
  }
  /**
   * @param {number} left
   * @param {number} right
   * @param {number} top
   * @param {number} bottom
   * @param {number} near
   * @param {number} far
   */
  makeOrthographic(left, right, top, bottom, near, far, reversed = false) {
    const te = this.elements;
    const w = 1 / (right - left), h = 1 / (top - bottom), p = 1 / (far - near);
    const x = (right + left) * w, y = (top + bottom) * h;
    const z = reversed ? p : -p, d = reversed ? far * p : -near * p;
    te[0] = 2 * w; te[4] = 0; te[8] = 0; te[12] = -x;
    te[1] = 0; te[5] = 2 * h; te[9] = 0; te[13] = -y;
    te[2] = 0; te[6] = 0; te[10] = z; te[14] = d;
    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    return this;
  }
  /** @param {Matrix4} m */
  equals(m) { for (let i = 0; i < 16; i++) if (this.elements[i] !== m.elements[i]) return false; return true; }
  /** @param {ArrayLike<number>} a */
  fromArray(a, o = 0) { for (let i = 0; i < 16; i++) this.elements[i] = a[i + o]; return this; }
  /**
   * @template {NumberArrayLike} [T=number[]]
   * @param {T} [a]
   * @param {number} [o]
   * @returns {T}
   */
  toArray(a = /** @type {any} */ ([]), o = 0) { for (let i = 0; i < 16; i++) a[o + i] = this.elements[i]; return a; }
}

// ---------------------------------------------------------------------------
// Color (linear working space; hex and CSS values are read as sRGB and converted)

/** @param {number} c */
const srgbToLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4);
/** @param {number} c */
const linearToSrgb = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * c ** 0.41666 - 0.055);

export class Color {
  /**
   * @param {ColorRepresentation | undefined} [r]
   * @param {number} [g]
   * @param {number} [b]
   */
  constructor(r, g, b) {
    this.r = 1; this.g = 1; this.b = 1;
    if (g === undefined && b === undefined) this.set(r);
    else this.setRGB(/** @type {number} */ (r), /** @type {number} */ (g), /** @type {number} */ (b));
  }
  get isColor() { return true; }
  /** @param {ColorRepresentation | undefined} v */
  set(v) {
    if (v === undefined) return this;
    if (v && typeof v === 'object' && !Array.isArray(v) && v.isColor) return this.copy(v);
    if (typeof v === 'number') return this.setHex(v);
    if (typeof v === 'string') return this.setStyle(v);
    if (Array.isArray(v)) return this.setRGB(v[0], v[1], v[2]);
    return this;
  }
  /** @param {number} s */
  setScalar(s) { this.r = s; this.g = s; this.b = s; return this; }
  /**
   * `hex` is an sRGB colour like 0xff8800; stored linear.
   * @param {number} hex
   */
  setHex(hex, srgb = true) {
    hex = Math.floor(hex);
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    this.r = srgb ? srgbToLinear(r) : r; this.g = srgb ? srgbToLinear(g) : g; this.b = srgb ? srgbToLinear(b) : b;
    return this;
  }
  /**
   * Linear components, 0..1 (or above, for HDR emissive colours).
   * @param {number} r
   * @param {number} g
   * @param {number} b
   */
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  /**
   * @param {number} h
   * @param {number} s
   * @param {number} l
   */
  setHSL(h, s, l) {
    h = MathUtils.euclideanModulo(h, 1); s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    if (s === 0) return this.setRGB(l, l, l);
    const p = l <= 0.5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
    const hue = /** @param {number} t */ (t) => { t = MathUtils.euclideanModulo(t, 1); return t < 1 / 6 ? q + (p - q) * 6 * t : t < 1 / 2 ? p : t < 2 / 3 ? q + (p - q) * 6 * (2 / 3 - t) : q; };
    return this.setHex(((hue(h + 1 / 3) * 255) << 16) | ((hue(h) * 255) << 8) | (hue(h - 1 / 3) * 255) | 0);
  }
  /**
   * '#rgb', '#rrggbb', 'rgb(r,g,b)' and a few CSS names.
   * @param {string} s
   */
  setStyle(s) {
    s = s.trim().toLowerCase();
    /** @type {Record<string, number>} */
    const named = { white: 0xffffff, black: 0, red: 0xff0000, green: 0x008000, blue: 0x0000ff, yellow: 0xffff00, orange: 0xffa500, gray: 0x808080, grey: 0x808080, cyan: 0x00ffff, magenta: 0xff00ff };
    if (named[s] !== undefined) return this.setHex(named[s]);
    let m;
    if ((m = /^#([0-9a-f]{3})$/.exec(s))) return this.setHex(parseInt(m[1].split('').map((c) => c + c).join(''), 16));
    if ((m = /^#([0-9a-f]{6})$/.exec(s))) return this.setHex(parseInt(m[1], 16));
    if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s))) return this.setHex((+m[1] << 16) | (+m[2] << 8) | +m[3]);
    return this;
  }
  clone() { return new Color(this.r, this.g, this.b); }
  /** @param {Color} c */
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  getHex() { return (Math.round(clamp(linearToSrgb(this.r), 0, 1) * 255) << 16) | (Math.round(clamp(linearToSrgb(this.g), 0, 1) * 255) << 8) | Math.round(clamp(linearToSrgb(this.b), 0, 1) * 255); }
  getHexString() { return this.getHex().toString(16).padStart(6, '0'); }
  getStyle() { return `#${this.getHexString()}`; }
  /** @param {Color} c */
  add(c) { this.r += c.r; this.g += c.g; this.b += c.b; return this; }
  /** @param {Color} c */
  multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
  /** @param {number} s */
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
  /**
   * @param {Color} c
   * @param {number} t
   */
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
  /**
   * @param {Color} a
   * @param {Color} b
   * @param {number} t
   */
  lerpColors(a, b, t) { return this.copy(a).lerp(b, t); }
  /** @param {Color} c */
  equals(c) { return c.r === this.r && c.g === this.g && c.b === this.b; }
  /** @param {ArrayLike<number>} a */
  fromArray(a, o = 0) { this.r = a[o]; this.g = a[o + 1]; this.b = a[o + 2]; return this; }
  /**
   * @template {NumberArrayLike} [T=number[]]
   * @param {T} [a]
   * @param {number} [o]
   * @returns {T}
   */
  toArray(a = /** @type {any} */ ([]), o = 0) { a[o] = this.r; a[o + 1] = this.g; a[o + 2] = this.b; return a; }
  *[Symbol.iterator]() { yield this.r; yield this.g; yield this.b; }
}

// scratch objects used by the methods above (module-level so the hot paths allocate nothing)
const _v1 = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3();
const _zero = new Vector3(0, 0, 0), _one = new Vector3(1, 1, 1);
const _q1 = new Quaternion(), _m1 = new Matrix4(), _m2 = new Matrix4();
