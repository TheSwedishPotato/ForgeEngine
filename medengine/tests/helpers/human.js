/**
 * A small synthetic character in the exact files tools/human/build.mjs writes (human-base.json + .binz, <id>.json + .binz,
 * textures), for tests of the Human loader that must run without the MakeHuman data.
 *
 * It is a mannequin made of boxes on the real bone set (the Humanoid skeleton, so every shipped clip plays on it), with
 * the same kinds of parts a real export has:
 *   body       13 boxes (limbs blend 50/50 into the next bone at the joints), one head box that carries all 52 face units
 *   eyes       two boxes on the eye bones
 *   brows      two flat boxes, with the brow shapes
 *   lashes     two flat boxes, with the blink shapes
 *   teeth      a flat box, jawOpen
 *   tongue     a flat box, jawOpen and tongueOut
 *   hair       a cap on the head
 *   shirt      a garment over the chest (the body faces under it are hidden)
 *   jacket     a larger garment over the shirt (layering: offset outward, and the shirt tucked under)
 *   coat       a third layer over both (rank 2: twice the offset, and the tucking cascades)
 *
 * Face shapes are small but real: jawOpen drops the chin, the brow and blink shapes move their own parts, and the other
 * units move a few head vertices by deterministic amounts so that a test can tell any two of the 52 apart.
 */
import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUMANOID_BONES, humanoidRestHeads } from '../../src/anim/Humanoid.js';
import { FACE_UNITS } from '../../src/human/Human.js';
import { png } from './gltf.js';

// ---------------------------------------------------------------------------------------------------------------- binary

class Pack {
  constructor() { this.parts = []; this.size = 0; }
  add(arr) {
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) { this.parts.push(new Uint8Array(pad)); this.size += pad; }
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const ref = { offset: this.size, length: arr.length, type: arr.constructor.name.replace('Array', '') };
    this.parts.push(bytes); this.size += bytes.byteLength;
    return ref;
  }
  bytes() { const out = new Uint8Array(this.size); let o = 0; for (const p of this.parts) { out.set(p, o); o += p.byteLength; } return out; }
}

// ---------------------------------------------------------------------------------------------------------------- tiny vector maths

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------------------------------------------------------------------------------------------------------- boxes

const BONE_INDEX = new Map(HUMANOID_BONES.map(([n], i) => [n, i]));
const boneId = (n) => { const i = BONE_INDEX.get(n); if (i === undefined) throw new Error(`synthetic human: no bone ${n}`); return i; };

/** The four strongest [bone, weight] pairs, normalised, as the builder stores them. */
function top4(list) {
  const merged = new Map();
  for (const [b, w] of list) merged.set(boneId(b), (merged.get(boneId(b)) ?? 0) + w);
  const s = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = s.reduce((a, [, w]) => a + w, 0) || 1;
  const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  s.forEach(([b, x], i) => { j[i] = b; w[i] = x / sum; });
  return { j, w };
}

/** Polygon data under construction: positions, quads, one uv per corner, skin. */
class Poly {
  constructor() { this.pos = []; this.faces = []; this.uv = []; this.faceT = []; this.joints = []; this.weights = []; this.parts = {}; }
  get verts() { return this.pos.length / 3; }

  /**
   * A box from ring A to ring B. `a` and `b` are the ring centres, `hx` and `hz` the half sizes across the axis a->b.
   * Winding is made outward per face, whatever the axis. Returns the index of its first vertex.
   */
  box(name, a, b, hx, hz, wa, wb) {
    const d = unit(sub(b, a));
    let u = cross(d, [0, 0, 1]);
    if (Math.hypot(...u) < 0.3) u = cross(d, [1, 0, 0]);
    u = unit(u);
    const w = unit(cross(u, d));
    const ring = (c) => [add(add(c, mul(u, hx)), mul(w, hz)), add(add(c, mul(u, -hx)), mul(w, hz)), add(add(c, mul(u, -hx)), mul(w, -hz)), add(add(c, mul(u, hx)), mul(w, -hz))];
    const corners = [...ring(a), ...ring(b)];
    const first = this.verts, firstFace = this.faces.length;
    const A = top4(wa), B = top4(wb);
    corners.forEach((p, i) => {
      this.pos.push(...p);
      const s = i < 4 ? A : B;
      this.joints.push(...s.j); this.weights.push(...s.w);
    });
    const centre = mul(add(a, b), 0.5);
    const quads = [[0, 1, 2, 3], [4, 5, 6, 7], ...[0, 1, 2, 3].map((i) => [i, (i + 1) % 4, 4 + ((i + 1) % 4), 4 + i])];
    for (let q of quads) {
      const p = q.map((i) => corners[i]);
      const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      const mid = mul(add(add(p[0], p[1]), add(p[2], p[3])), 0.25);
      if (dot(n, sub(mid, centre)) < 0) q = [...q].reverse();
      this.faces.push(q.map((i) => first + i));
      // every face maps the whole texture: (0,0) (1,0) (1,1) (0,1), one uv per corner so the seams split the vertices
      for (let c = 0; c < 4; c++) { this.faceT.push(this.uv.length / 2); this.uv.push(c === 1 || c === 2 ? 1 : 0, c >= 2 ? 1 : 0); }
    }
    const used = new Set();
    for (const sk of [A, B]) sk.j.forEach((j, i) => { if (sk.w[i] > 0) used.add(j); });
    this.parts[name] = { firstVert: first, verts: 8, firstFace, faces: 6, bones: [...used] };
    return first;
  }

  /** An axis-aligned box about `c`. */
  aabb(name, c, h, wt) { return this.box(name, [c[0], c[1] - h[1], c[2]], [c[0], c[1] + h[1], c[2]], h[0], h[2], wt, wt); }

  arrays() {
    const start = [0], idx = [], t = [];
    this.faces.forEach((f, i) => { idx.push(...f); t.push(...f.map((_, c) => this.faceT[i * 4 + c])); start.push(idx.length); });
    return {
      position: Float32Array.from(this.pos), uv: Float32Array.from(this.uv),
      faceStart: Uint32Array.from(start), faceV: Uint32Array.from(idx), faceT: Uint32Array.from(t),
      joints: Uint8Array.from(this.joints), weights: Float32Array.from(this.weights),
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------- the character

/**
 * @param {object} [o]
 * @param {string} [o.id]       character id (file names)
 * @param {number} [o.height]   metres (the bone set scales with it)
 * @param {boolean} [o.gzip]    write `.binz` (gzip, what the builder does) or plain `.bin`
 * @param {object} [o.meta]     the header's meta (hairColor, skinTint)
 * @returns {{ files: Map<string, Uint8Array|string>, info: object }}  files by relative path
 */
export function buildSyntheticHuman({ id = 'tess', height = 1.75, gzip = true, meta = { hairColor: [0.16, 0.09, 0.04], skinTint: [1, 0.92, 0.86] } } = {}) {
  const k = height / 1.75;
  const H = humanoidRestHeads({ height, armAngle: 40 });
  const P = (n) => [H[n].x, H[n].y, H[n].z];
  const y = (v) => v * k;
  const body = new Poly();
  const rigid = (n) => [[n, 1]];
  const blend = (a, b) => [[a, 0.5], [b, 0.5]];

  body.box('hips', [0, y(0.86), 0], [0, y(1.07), 0], 0.155 * k, 0.095 * k, rigid('pelvis'), blend('pelvis', 'spine_01'));
  body.box('belly', [0, y(1.07), 0], [0, y(1.29), 0], 0.145 * k, 0.09 * k, blend('spine_01', 'spine_02'), blend('spine_02', 'spine_03'));
  body.box('chest', [0, y(1.29), 0], [0, y(1.50), 0], 0.17 * k, 0.1 * k, rigid('spine_03'), rigid('spine_03'));
  body.box('neck', [0, y(1.50), 0], [0, y(1.62), 0], 0.045 * k, 0.045 * k, rigid('neck_01'), rigid('neck_01'));
  const headFirst = body.box('head', [0, y(1.60), -0.01 * k], [0, y(1.80), -0.01 * k], 0.08 * k, 0.085 * k, rigid('head'), rigid('head'));
  for (const s of ['l', 'r']) {
    body.box(`upperarm_${s}`, P(`upperarm_${s}`), P(`lowerarm_${s}`), 0.045 * k, 0.045 * k, rigid(`upperarm_${s}`), blend(`upperarm_${s}`, `lowerarm_${s}`));
    body.box(`lowerarm_${s}`, P(`lowerarm_${s}`), P(`hand_${s}`), 0.04 * k, 0.04 * k, blend(`upperarm_${s}`, `lowerarm_${s}`), rigid(`lowerarm_${s}`));
    body.box(`hand_${s}`, P(`hand_${s}`), P(`middle_03_${s}`), 0.018 * k, 0.042 * k, rigid(`hand_${s}`), rigid(`hand_${s}`));
    const sg = s === 'l' ? 1 : -1;
    body.box(`thigh_${s}`, P(`thigh_${s}`), P(`calf_${s}`), 0.065 * k, 0.07 * k, rigid(`thigh_${s}`), blend(`thigh_${s}`, `calf_${s}`));
    body.box(`calf_${s}`, P(`calf_${s}`), P(`foot_${s}`), 0.05 * k, 0.055 * k, blend(`thigh_${s}`, `calf_${s}`), rigid(`calf_${s}`));
    body.aabb(`foot_${s}`, [sg * 0.09 * k, 0.05 * k, 0.05 * k], [0.045 * k, 0.05 * k, 0.11 * k], rigid(`foot_${s}`));
  }
  const bodyArrays = body.arrays();
  const bodyVerts = body.verts;
  const headVerts = Array.from({ length: 8 }, (_, i) => headFirst + i);

  // ---- face units on the body: all 52 in FACE_UNITS order, as the base file has them
  const kk = k;
  const bodyMorphs = FACE_UNITS.map((name, u) => {
    const idx = [], d = [];
    headVerts.forEach((v, i) => {
      let delta = null;
      if (name === 'jawOpen') { if (i < 4) delta = [0, -0.035 * kk, -0.004 * kk]; }            // ring A is the chin end: the jaw drops
      else if (name === 'tongueOut') delta = null;                                               // a tongue-only unit: nothing on the skin
      else if (((u * 5 + i * 3) % 8) < 3) {
        const f = (n) => (((u * 7 + i * 13 + n * 5) % 11) - 5) * 0.0008 * kk;
        delta = [f(0), f(1), f(2)];
      }
      if (delta) { idx.push(v); d.push(...delta); }
    });
    return { name, idx: Uint32Array.from(idx), d: Float32Array.from(d) };
  });

  // ---- proxies
  const proxies = [];
  const addProxy = (spec) => proxies.push(spec);
  const eyeHalf = 0.013 * k;
  {
    const p = new Poly();
    const eye = (s) => { const c = P(`eye_${s}`); p.aabb(`eye_${s}`, c, [eyeHalf, eyeHalf, eyeHalf], rigid(`eye_${s}`)); };
    eye('l'); eye('r');
    addProxy({ name: 'eyes', kind: 'eye', material: 'eyes', subdivide: false, zDepth: 0, poly: p, morphs: () => null });
  }
  {
    const p = new Poly();
    for (const [s, sg] of [['l', 1], ['r', -1]]) p.aabb(`brow_${s}`, [sg * 0.034 * k, y(1.715), 0.077 * k], [0.026 * k, 0.005 * k, 0.004 * k], rigid('head'));
    const shape = (unitName, x, yy, z, i, vert) => {
      const side = vert < 8 ? 1 : -1;                                                            // first box is the left (+x) one
      const outer = side * x > 0.034 * k;
      switch (unitName) {
        case 'browDownLeft': return side === 1 ? [0, -0.012 * k, 0] : null;
        case 'browDownRight': return side === -1 ? [0, -0.012 * k, 0] : null;
        case 'browInnerUp': return outer ? null : [0, 0.01 * k, 0];
        case 'browOuterUpLeft': return side === 1 && outer ? [0, 0.01 * k, 0] : null;
        case 'browOuterUpRight': return side === -1 && outer ? [0, 0.01 * k, 0] : null;
        default: return null;
      }
    };
    addProxy({ name: 'brows', kind: 'brow', material: 'brows', subdivide: false, zDepth: 10, poly: p, morphs: shape });
  }
  {
    const p = new Poly();
    for (const [s, sg] of [['l', 1], ['r', -1]]) p.aabb(`lash_${s}`, [sg * 0.032 * k, y(1.70), 0.082 * k], [0.016 * k, 0.003 * k, 0.003 * k], rigid('head'));
    const shape = (unitName, x, yy, z, i, vert) => (unitName === 'eyeBlinkLeft' && vert < 8) || (unitName === 'eyeBlinkRight' && vert >= 8) ? [0, -0.008 * k, 0] : null;
    addProxy({ name: 'lashes', kind: 'lash', material: 'lashes', subdivide: false, zDepth: 20, poly: p, morphs: shape });
  }
  {
    const p = new Poly();
    p.aabb('teeth', [0, y(1.64), 0.055 * k], [0.03 * k, 0.006 * k, 0.012 * k], rigid('head'));
    addProxy({ name: 'teeth', kind: 'teeth', material: 'teeth', subdivide: false, zDepth: 0, poly: p, morphs: (u) => (u === 'jawOpen' ? [0, -0.03 * k, 0] : null) });
  }
  {
    const p = new Poly();
    p.aabb('tongue', [0, y(1.63), 0.05 * k], [0.018 * k, 0.005 * k, 0.02 * k], rigid('head'));
    addProxy({ name: 'tongue', kind: 'tongue', material: 'tongue', subdivide: false, zDepth: 0, poly: p, morphs: (u) => (u === 'jawOpen' ? [0, -0.03 * k, 0] : u === 'tongueOut' ? [0, 0, 0.03 * k] : null) });
  }
  {
    const p = new Poly();
    p.aabb('hair', [0, y(1.795), -0.01 * k], [0.088 * k, 0.035 * k, 0.09 * k], rigid('head'));
    addProxy({ name: 'hair', kind: 'hair', material: 'hair', subdivide: false, zDepth: 0, poly: p, morphs: () => null });
  }
  {
    const p = new Poly();
    p.box('shirt', [0, y(1.29), 0], [0, y(1.50), 0], 0.18 * k, 0.11 * k, rigid('spine_03'), rigid('spine_03'));
    addProxy({ name: 'shirt', kind: 'cloth', material: 'shirt', subdivide: true, zDepth: 50, poly: p, morphs: () => null });
  }
  {
    const p = new Poly();
    p.box('jacket', [0, y(1.28), 0], [0, y(1.51), 0], 0.19 * k, 0.12 * k, rigid('spine_03'), rigid('spine_03'));
    addProxy({ name: 'jacket', kind: 'cloth', material: 'jacket', subdivide: true, zDepth: 60, poly: p, morphs: () => null });
  }
  {
    const p = new Poly();
    p.box('coat', [0, y(1.27), 0], [0, y(1.52), 0], 0.2 * k, 0.13 * k, rigid('spine_03'), rigid('spine_03'));
    addProxy({ name: 'coat', kind: 'cloth', material: 'coat', subdivide: true, zDepth: 70, poly: p, morphs: () => null });
  }

  // ---- the two files
  const basePack = new Pack();
  const ba = bodyArrays;
  const baseHeader = {
    format: 'med-human-base', version: 1, bodyVerts,
    bones: HUMANOID_BONES.map(([n]) => n), parents: HUMANOID_BONES.map(([, p]) => (p ? BONE_INDEX.get(p) : -1)),
    uv: basePack.add(ba.uv), faceStart: basePack.add(ba.faceStart), faceV: basePack.add(ba.faceV), faceT: basePack.add(ba.faceT),
    joints: basePack.add(ba.joints), weights: basePack.add(ba.weights),
    morphs: bodyMorphs.map((m) => ({ name: m.name, idx: basePack.add(m.idx), d: basePack.add(m.d) })),
    license: 'synthetic test data',
  };

  const pk = new Pack();
  const heads = [];
  for (const [n] of HUMANOID_BONES) heads.push(H[n].x, H[n].y, H[n].z);
  // the chest box's faces are hidden under the shirt
  const chest = body.parts.chest;
  const hidden = Array.from({ length: chest.faces }, (_, i) => chest.firstFace + i);
  const header = {
    format: 'med-human', version: 1, id, name: `Synthetic ${id}`, proxies: [], materials: {}, meta,
    boneHeads: pk.add(Float32Array.from(heads)),
  };
  header.materials.skin = { kind: 'skin', map: 'tex/skin.png' };
  header.materials.eyes = { kind: 'eye', color: [0.85, 0.9, 0.95] };
  header.materials.brows = { kind: 'brow', color: [0.1, 0.06, 0.03] };
  header.materials.lashes = { kind: 'lash', color: [0.05, 0.03, 0.02] };
  header.materials.teeth = { kind: 'teeth', color: [0.95, 0.93, 0.88] };
  header.materials.tongue = { kind: 'tongue', color: [0.7, 0.3, 0.3] };
  header.materials.hair = { kind: 'hair', map: 'tex/hair.png', color: [0.2, 0.1, 0.05] };
  header.materials.shirt = { kind: 'cloth', color: [0.65, 0.15, 0.12] };
  header.materials.jacket = { kind: 'leather', color: [0.14, 0.11, 0.09], rough: 0.4 };
  header.materials.coat = { kind: 'wool', color: [0.3, 0.3, 0.33] };

  const proxyInfo = [];
  for (const spec of proxies) {
    const a = spec.poly.arrays();
    // the shapes: one entry per unit that moves any vertex of this part
    const morphs = [];
    FACE_UNITS.forEach((name, unitIdx) => {
      const idx = [], d = [];
      for (let v = 0; v < spec.poly.verts; v++) {
        const delta = spec.morphs(name, a.position[v * 3], a.position[v * 3 + 1], a.position[v * 3 + 2], v, v);
        if (delta) { idx.push(v); d.push(...delta); }
      }
      if (idx.length) morphs.push({ unit: unitIdx, idx: pk.add(Uint32Array.from(idx)), d: pk.add(Float32Array.from(d)) });
    });
    header.proxies.push({
      name: spec.name, kind: spec.kind, material: spec.material, subdivide: spec.subdivide, zDepth: spec.zDepth,
      position: pk.add(a.position), uv: pk.add(a.uv), faceStart: pk.add(a.faceStart), faceV: pk.add(a.faceV), faceT: pk.add(a.faceT),
      joints: pk.add(a.joints), weights: pk.add(a.weights), morphs,
    });
    proxyInfo.push({ name: spec.name, kind: spec.kind, verts: spec.poly.verts, faces: spec.poly.faces.length, morphUnits: morphs.map((m) => FACE_UNITS[m.unit]) });
  }
  header.body = pk.add(ba.position);
  header.hiddenFaces = pk.add(Uint32Array.from(hidden));
  header.credits = [{ asset: 'synthetic/test', pack: 'tests', license: 'CC0' }];
  let top = -Infinity;
  for (let v = 0; v < bodyVerts; v++) top = Math.max(top, ba.position[v * 3 + 1]);
  header.height = top;

  const pack = (name, bytes) => [gzip ? `${name}.binz` : `${name}.bin`, gzip ? zlib.gzipSync(bytes) : Buffer.from(bytes)];
  const files = new Map([
    ['human-base.json', JSON.stringify(baseHeader)],
    pack('human-base', basePack.bytes()),
    [`${id}.json`, JSON.stringify(header)],
    pack(id, pk.bytes()),
    // 8 x 8 textures: skin (warm, slightly noisy), hair (dark strands with an alpha cut)
    ['tex/skin.png', png(8, 8, (x, yy) => [220 - ((x * 7 + yy * 3) % 5) * 4, 180 - ((x + yy) % 4) * 3, 150, 255])],
    ['tex/hair.png', png(8, 8, (x, yy) => [90 + (x % 3) * 20, 60 + (yy % 3) * 10, 40, (x + yy) % 5 === 0 ? 0 : 255])],
  ]);
  const info = {
    id, height: top, k,
    bones: baseHeader.bones, parents: baseHeader.parents, boneHeads: Float32Array.from(heads),
    bodyVerts, bodyFaces: body.faces.length, hiddenFaces: hidden, bodyParts: body.parts, headVerts, proxies: proxyInfo,
    bodyFaceVerts: body.faces, bodyPositions: ba.position,
    bodyMorphUnits: bodyMorphs.filter((m) => m.idx.length).map((m) => m.name),
    bodyMorphs,
  };
  return { files, info };
}

/** Writes the files of a synthetic character under `dir` and returns its info. */
export function writeSyntheticHuman(dir, opts = {}) {
  const { files, info } = buildSyntheticHuman(opts);
  for (const [rel, data] of files) {
    const path = join(dir, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, data);
  }
  return info;
}
