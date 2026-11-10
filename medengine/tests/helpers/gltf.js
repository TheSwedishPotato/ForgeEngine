/**
 * Builds small glTF / GLB files in memory for the loader tests (and the GPU skinning test).
 */
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import { encodePNG } from '../../src/platform/png.js';

const COMPONENT = new Map([[Int8Array, 5120], [Uint8Array, 5121], [Int16Array, 5122], [Uint16Array, 5123], [Uint32Array, 5125], [Float32Array, 5126]]);
const pad4 = (n) => (n + 3) & ~3;

export class GLTFBuilder {
  constructor() {
    this.json = { asset: { version: '2.0', generator: 'medengine-tests' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [] };
    this.parts = [];
    this.length = 0;
  }

  /** Appends raw bytes as a bufferView (4-byte aligned). */
  view(bytes, { target, stride } = {}) {
    const at = pad4(this.length);
    this.parts.push({ at, bytes });
    this.length = at + bytes.length;
    const v = { buffer: 0, byteOffset: at, byteLength: bytes.length };
    if (target) v.target = target;
    if (stride) v.byteStride = stride;
    this.json.bufferViews.push(v);
    this.json.buffers[0].byteLength = pad4(this.length);
    return this.json.bufferViews.length - 1;
  }

  /** A typed array as bufferView + accessor. Returns the accessor index. */
  accessor(array, type, { normalized = false, min, max, target } = {}) {
    const comp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const view = this.view(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), { target });
    const a = { bufferView: view, componentType: COMPONENT.get(array.constructor), count: array.length / comp, type };
    if (normalized) a.normalized = true;
    if (min) a.min = min;
    if (max) a.max = max;
    this.json.accessors.push(a);
    return this.json.accessors.length - 1;
  }

  /** Adds `item` to `json[key]` and returns its index. */
  add(key, item) { (this.json[key] ??= []).push(item); return this.json[key].length - 1; }

  node(def = {}, root = true) {
    const i = this.add('nodes', def);
    if (root) this.json.scenes[0].nodes.push(i);
    return i;
  }

  _bin() {
    const out = new Uint8Array(pad4(this.length));
    for (const p of this.parts) out.set(p.bytes, p.at);
    return out;
  }

  /** The JSON without the containers nothing used (a file without geometry has no buffers). */
  _json() {
    const j = JSON.parse(JSON.stringify(this.json));
    if (!this.length) { delete j.buffers; delete j.bufferViews; delete j.accessors; }
    return j;
  }

  /** The binary .glb container. */
  glb() {
    const json = new TextEncoder().encode(JSON.stringify(this._json()));
    const jl = pad4(json.length), bin = this._bin(), bl = bin.length;
    const total = 12 + 8 + jl + (bl ? 8 + bl : 0);
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
    out.set(json, 20); out.fill(0x20, 20 + json.length, 20 + jl);
    if (bl) { dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true); out.set(bin, 28 + jl); }
    return out;
  }

  /** A .gltf: JSON text with the buffer as a data URI (or, with `external`, `{ json, bin }` for a separate file). */
  gltf({ external = null } = {}) {
    const j = this._json();
    const bin = this._bin();
    if (!this.length) return JSON.stringify(j);
    if (external) { j.buffers[0].uri = external; return { json: JSON.stringify(j), bin }; }
    j.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(bin).toString('base64')}`;
    return JSON.stringify(j);
  }
}

/** A solid-colour or patterned PNG as bytes. `fn(x, y) -> [r, g, b, a]` */
export function png(w, h, fn = () => [255, 255, 255, 255]) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return encodePNG({ width: w, height: h, data }, zlib);
}

export const dataURI = (bytes, mime = 'image/png') => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

/** A one-triangle mesh, the smallest useful glTF. Returns the builder; node 0 holds mesh 0. */
export function triangle(b = new GLTFBuilder(), extra = {}) {
  const pos = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', { min: [0, 0, 0], max: [1, 1, 0], target: 34962 });
  const nor = b.accessor(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3', { target: 34962 });
  const uv = b.accessor(new Float32Array([0, 0, 1, 0, 0, 1]), 'VEC2', { target: 34962 });
  const idx = b.accessor(new Uint16Array([0, 1, 2]), 'SCALAR', { target: 34963 });
  b.add('meshes', { name: 'tri', primitives: [{ attributes: { POSITION: pos, NORMAL: nor, TEXCOORD_0: uv }, indices: idx, ...extra }] });
  b.node({ name: 'Tri', mesh: 0 });
  return b;
}

/**
 * A two-bone "arm": a 1 x 0.2 x 0.2 box from x = 0 to 1 skinned to joints at x = 0 (shoulder) and x = 0.5 (elbow), rest pose straight.
 * Vertices left of 0.5 follow the shoulder, those right of it the elbow, with a blended middle ring. Returns the builder.
 */
export function arm(b = new GLTFBuilder(), { animate = true } = {}) {
  // a box of rings along +X: at x = 0, 0.25, 0.5, 0.75, 1.0; each ring has 4 corners (y,z = +-0.1)
  const xs = [0, 0.25, 0.5, 0.75, 1.0], pos = [], joints = [], weights = [];
  const w = [[1, 0], [1, 0], [0.5, 0.5], [0, 1], [0, 1]];
  xs.forEach((x, r) => {
    for (const [y, z] of [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]]) { pos.push(x, y, z); joints.push(0, 1, 0, 0); weights.push(w[r][0], w[r][1], 0, 0); }
  });
  const idx = [];
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
    const a = r * 4 + k, b2 = r * 4 + ((k + 1) % 4), c = (r + 1) * 4 + k, d = (r + 1) * 4 + ((k + 1) % 4);
    idx.push(a, b2, c, b2, d, c);
  }
  const P = b.accessor(new Float32Array(pos), 'VEC3', { target: 34962 });
  const J = b.accessor(new Uint8Array(joints), 'VEC4', { target: 34962 });
  const W = b.accessor(new Float32Array(weights), 'VEC4', { target: 34962 });
  const I = b.accessor(new Uint16Array(idx), 'SCALAR', { target: 34963 });
  b.add('materials', { name: 'skin', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.5, 0.3, 1], metallicFactor: 0, roughnessFactor: 0.7 } });
  b.add('meshes', { name: 'ArmMesh', primitives: [{ attributes: { POSITION: P, JOINTS_0: J, WEIGHTS_0: W }, indices: I, material: 0 }] });
  // joints: shoulder at the origin, elbow 0.5 along x (a child of the shoulder)
  const shoulder = b.node({ name: 'shoulder', children: [1] }, false);
  const elbow = b.node({ name: 'elbow', translation: [0.5, 0, 0] }, false);
  const ibm = new Float32Array(32);
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.5, 0, 0, 1], 16);   // inverse of translate(0.5, 0, 0)
  const IBM = b.accessor(ibm, 'MAT4');
  b.add('skins', { name: 'ArmSkin', joints: [shoulder, elbow], inverseBindMatrices: IBM, skeleton: shoulder });
  // the mesh node is deliberately moved: glTF says a skinned mesh node's own transform is ignored
  const meshNode = b.node({ name: 'ArmNode', mesh: 0, skin: 0, translation: [10, 20, 30] }, false);
  b.json.scenes[0].nodes.push(shoulder, meshNode);
  if (animate) {
    const t = b.accessor(new Float32Array([0, 1]), 'SCALAR', { min: [0], max: [1] });
    const s = Math.sin(Math.PI / 4), c = Math.cos(Math.PI / 4);                // 90 degrees about Z
    const q = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, s, c]), 'VEC4');
    b.add('animations', { name: 'bend', samplers: [{ input: t, output: q, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: elbow, path: 'rotation' } }] });
  }
  return b;
}
