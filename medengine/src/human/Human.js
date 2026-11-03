import {
  Group, Bone, Skeleton, SkinnedMesh, BufferGeometry, BufferAttribute, MeshPhysicalMaterial,
  Vector3, Color, TextureLoader, SRGBColorSpace, RepeatWrapping, CanvasTexture, DoubleSide,
} from 'three';
import { subdivideLevels, applyStencils, applyStencilsSkin } from './Subdivision.js';
import { fetchBytes } from '../world/Packed.js';

/**
 * Med Engine digital humans.
 *
 * Loads the files written by tools/human/build.mjs (CC0 MakeHuman topology, rig and face
 * shapes, shaped per character) and builds a three.js SkinnedMesh rig the Med Engine renders:
 *  - Catmull-Clark subdivision at load: one level by default (13k -> 53k vertices on the body),
 *    with skin weights and face shapes carried through the same stencils;
 *  - the 52 ARKit face units as GPU morph targets (a half-float texture per mesh; only the
 *    shapes in use are evaluated in the vertex shader);
 *  - eyes on their own bones, so gaze is a rotation; lids follow with the eyeLook shapes;
 *  - bones in a world-aligned rest pose (every bone's rest rotation is identity), so a pose is
 *    simply a rotation per bone in its parent's frame.
 */

export const FACE_UNITS = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft',
  'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
  'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight', 'tongueOut',
];

const cache = new Map();
async function fetchPair(url) {
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    const [h, b] = await Promise.all([fetch(url + '.json').then((r) => { if (!r.ok) throw new Error(`${url}.json: ${r.status}`); return r.json(); }), fetchBinary(url)]);
    return { h, buf: b };
  })();
  cache.set(url, p);
  return p;
}

/** The character's binary: .binz (gzip, inflated in the browser) or plain .bin. */
async function fetchBinary(url) {
  const buf = await fetchBytes(url + '.binz').catch(() => fetchBytes(url + '.bin'));
  const u = new Uint8Array(buf, 0, 2);
  if (u[0] === 0x1f && u[1] === 0x8b) {
    // gzip: a server that did not decode it for us
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    return ds.arrayBuffer();
  }
  return buf;
}

const TYPES = { Float32: Float32Array, Uint32: Uint32Array, Uint8: Uint8Array, Uint16: Uint16Array, Int32: Int32Array };
function view(buf, ref) { return new TYPES[ref.type](buf, ref.offset, ref.length); }

// float -> half (for the morph textures)
const _f = new Float32Array(1), _i = new Uint32Array(_f.buffer);
export function toHalf(v) {
  _f[0] = v; const x = _i[0];
  const s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 112; let m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return s; m |= 0x800000; const t = 14 - e; return s | ((m + (1 << (t - 1))) >> t); }
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | ((m + 0x1000) >> 13);
}

/**
 * Builds the morph block for one mesh: which vertices any shape moves get a slot; the texture
 * holds unit-major rows of slot deltas. Returns { slotAttr, morph } (morph goes to userData).
 */
function buildMorph(vertCount, perUnit /* [{unit, idx:Uint32Array, d:Float32Array}] */) {
  const slotOf = new Int32Array(vertCount).fill(-1);
  let slots = 0;
  for (const u of perUnit) for (const v of u.idx) if (slotOf[v] < 0) slotOf[v] = slots++;
  if (!slots) return null;
  const units = FACE_UNITS.length;
  const W = 2048, total = slots * units, H = Math.ceil(total / W);
  const data = new Uint16Array(W * H * 4);
  for (const u of perUnit) {
    for (let i = 0; i < u.idx.length; i++) {
      const t = (u.unit * slots + slotOf[u.idx[i]]) * 4;
      data[t] = toHalf(u.d[i * 3]); data[t + 1] = toHalf(u.d[i * 3 + 1]); data[t + 2] = toHalf(u.d[i * 3 + 2]);
    }
  }
  const slotAttr = new Float32Array(vertCount);
  for (let v = 0; v < vertCount; v++) slotAttr[v] = slotOf[v];
  return { slotAttr, morph: { data, width: W, height: H, slots, weights: null, prev: null } };
}

/** Area-weighted smooth normals over quads/triangles indexed by position index. */
function computeNormals(pos, quads, count) {
  const n = new Float32Array(count * 3);
  const add = (a, b, c) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { n[v * 3] += nx; n[v * 3 + 1] += ny; n[v * 3 + 2] += nz; }
  };
  for (let q = 0; q < quads.length; q += 4) { add(quads[q], quads[q + 1], quads[q + 2]); add(quads[q], quads[q + 2], quads[q + 3]); }
  for (let v = 0; v < count; v++) {
    const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
    n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l;
  }
  return n;
}

/**
 * Turns polygon data (position-indexed faces + uv-indexed faces) into a renderable geometry,
 * splitting vertices along uv seams. Optional subdivision first.
 */
function makeGeometry({ count, pos, faces, uv, tidx, joints, weights, morphUnits, levels }) {
  let P = pos, J = joints, W = weights, quadsV, quadsT, UV = uv, N = count;
  let units = morphUnits;
  if (levels > 0) {
    const s = subdivideLevels(count, faces, uv ? { uv, tidx } : null, levels);
    P = applyStencils(s.stencils, pos, 3, s.count);
    const sk = applyStencilsSkin(s.stencils, joints, weights, s.count);
    J = sk.joints; W = sk.weights;
    quadsV = s.quads.v; quadsT = s.quads.t; UV = s.uv; N = s.count;
    if (morphUnits?.length) {
      // carry each shape through the stencils, sparsely: only rows touching moved vertices
      units = morphUnits.map((u) => {
        const moved = new Map();
        for (let i = 0; i < u.idx.length; i++) moved.set(u.idx[i], i);
        const idx = [], d = [];
        const st = s.stencils;
        for (let r = 0; r < N; r++) {
          let x = 0, y = 0, z = 0, hit = false;
          for (let j = st.start[r]; j < st.start[r + 1]; j++) {
            const k = moved.get(st.src[j]);
            if (k === undefined) continue;
            hit = true; const w = st.w[j];
            x += u.d[k * 3] * w; y += u.d[k * 3 + 1] * w; z += u.d[k * 3 + 2] * w;
          }
          if (hit && (Math.abs(x) + Math.abs(y) + Math.abs(z)) > 1e-7) { idx.push(r); d.push(x, y, z); }
        }
        return { unit: u.unit, idx: Uint32Array.from(idx), d: Float32Array.from(d) };
      });
    }
  } else {
    // triangulate polygons into a quad-ish list: keep n-gons as fans in an index list below
    quadsV = null;
  }
  // corners -> unique (pos, uv) vertices
  const corners = [];   // [p, t] per corner, grouped by 4 (quads) or fans
  const tris = [];
  if (quadsV) {
    for (let q = 0; q < quadsV.length; q += 4) {
      const c = [0, 1, 2, 3].map((i) => [quadsV[q + i], quadsT ? quadsT[q + i] : quadsV[q + i]]);
      tris.push([c[0], c[1], c[2]], [c[0], c[2], c[3]]);
    }
  } else {
    for (let f = 0; f < faces.start.length - 1; f++) {
      const s = faces.start[f], e = faces.start[f + 1];
      const c = [];
      for (let j = s; j < e; j++) c.push([faces.idx[j], tidx ? tidx[j] : faces.idx[j]]);
      for (let k = 1; k < c.length - 1; k++) tris.push([c[0], c[k], c[k + 1]]);
    }
  }
  void corners;
  const normals = computeNormals(P, quadsV ?? fanQuads(faces), N);
  const key = new Map();
  const outP = [], outN = [], outUV = [], outJ = [], outW = [], outSrc = [];
  const index = new Uint32Array(tris.length * 3);
  let vi = 0;
  tris.forEach((t, ti) => {
    t.forEach(([p, tt], k) => {
      const kk = p * 4194304 + tt;
      let id = key.get(kk);
      if (id === undefined) {
        id = vi++; key.set(kk, id);
        outP.push(P[p * 3], P[p * 3 + 1], P[p * 3 + 2]);
        outN.push(normals[p * 3], normals[p * 3 + 1], normals[p * 3 + 2]);
        outUV.push(UV ? UV[tt * 2] : 0, UV ? UV[tt * 2 + 1] : 0);
        outJ.push(J[p * 4], J[p * 4 + 1], J[p * 4 + 2], J[p * 4 + 3]);
        outW.push(W[p * 4], W[p * 4 + 1], W[p * 4 + 2], W[p * 4 + 3]);
        outSrc.push(p);
      }
      index[ti * 3 + k] = id;
    });
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(Float32Array.from(outP), 3));
  g.setAttribute('normal', new BufferAttribute(Float32Array.from(outN), 3));
  g.setAttribute('uv', new BufferAttribute(Float32Array.from(outUV), 2));
  g.setAttribute('skinIndex', new BufferAttribute(Uint16Array.from(outJ), 4));
  g.setAttribute('skinWeight', new BufferAttribute(Float32Array.from(outW), 4));
  g.setIndex(new BufferAttribute(index, 1));
  g.userData.srcIndex = Uint32Array.from(outSrc);   // render vertex -> position index
  g.userData.positionsBySource = P; g.userData.normalsBySource = normals; g.userData.sourceCount = N;
  let morph = null;
  if (units?.length) {
    // remap units from position index to render vertices
    const bySrc = new Map();
    outSrc.forEach((p, v) => { if (!bySrc.has(p)) bySrc.set(p, []); bySrc.get(p).push(v); });
    const remapped = units.map((u) => {
      const idx = [], d = [];
      for (let i = 0; i < u.idx.length; i++) for (const v of bySrc.get(u.idx[i]) ?? []) { idx.push(v); d.push(u.d[i * 3], u.d[i * 3 + 1], u.d[i * 3 + 2]); }
      return { unit: u.unit, idx: Uint32Array.from(idx), d: Float32Array.from(d) };
    });
    const m = buildMorph(vi, remapped);
    if (m) { g.setAttribute('morphSlot', new BufferAttribute(m.slotAttr, 1)); morph = m.morph; }
  }
  g.computeBoundingSphere();
  return { geometry: g, morph };
}

function fanQuads(faces) {
  const out = [];
  for (let f = 0; f < faces.start.length - 1; f++) {
    const s = faces.start[f], e = faces.start[f + 1];
    for (let k = s + 1; k < e - 1; k++) out.push(faces.idx[s], faces.idx[k], faces.idx[k + 1], faces.idx[k + 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Materials

const loader = new TextureLoader();
const texCache = new Map();
function tex(url, srgb) {
  const k = url + (srgb ? ':s' : '');
  if (!texCache.has(k)) {
    const t = loader.load(url);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    texCache.set(k, t);
  }
  return texCache.get(k);
}

/** Loads an image and returns a recoloured canvas texture: the original's shading, a new colour. */
function recolor(url, color, { contrast = 1.3, keep = 0.0 } = {}) {
  const canvas = document.createElement('canvas');
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width; canvas.height = img.height;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, img.width, img.height), p = d.data;
    // mean luminance, so the shading is centred on the new colour
    let sum = 0;
    for (let i = 0; i < p.length; i += 64) sum += 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
    const mean = Math.max(8, sum / (p.length / 64));
    const lin = color.map((x) => Math.pow(x, 1 / 2.2) * 255);
    for (let i = 0; i < p.length; i += 4) {
      // clamp: printed logos, reflective strips and white trim must not survive the dye
      const l = Math.min(1.25, (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) / mean);
      const s = Math.max(0, 1 + (l - 1) * contrast);
      for (let k = 0; k < 3; k++) p[i + k] = Math.min(255, lin[k] * s * (1 - keep) + p[i + k] * keep);
    }
    c.putImageData(d, 0, 0);
    t.needsUpdate = true;
  };
  img.src = url;
  return t;
}

/**
 * Layered clothes: wherever an outer garment lies over an inner one (any of its vertices within
 * `reach`), the inner one is drawn in under it by `depth` along its own normals. A long coat over a
 * bulky suit jacket otherwise shows the jacket through it in patches; an open front, a collar or a
 * cuff with nothing over it stays exactly where it was. `geoms` are ordered inner to outer.
 */
export function tuckUnder(geoms, { reach = 0.03, depth = 0.016 } = {}) {
  const cell = reach, key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  for (let o = 1; o < geoms.length; o++) {
    const Q = geoms[o].attributes.position.array, grid = new Map();
    for (let j = 0; j < Q.length; j += 3) {
      const k = key(Math.floor(Q[j] / cell), Math.floor(Q[j + 1] / cell), Math.floor(Q[j + 2] / cell));
      let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(j);
    }
    const r2 = reach * reach;
    for (let i = 0; i < o; i++) {
      const attr = geoms[i].attributes.position, P = attr.array, N = geoms[i].attributes.normal.array;
      for (let v = 0; v < P.length; v += 3) {
        const cx = Math.floor(P[v] / cell), cy = Math.floor(P[v + 1] / cell), cz = Math.floor(P[v + 2] / cell);
        let covered = false;
        for (let dx = -1; dx <= 1 && !covered; dx++) for (let dy = -1; dy <= 1 && !covered; dy++) for (let dz = -1; dz <= 1 && !covered; dz++) {
          const b = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (b) for (const j of b) { const ex = Q[j] - P[v], ey = Q[j + 1] - P[v + 1], ez = Q[j + 2] - P[v + 2]; if (ex * ex + ey * ey + ez * ez < r2) { covered = true; break; } }
        }
        if (covered) for (let c = 0; c < 3; c++) P[v + c] -= N[v + c] * depth;
      }
      attr.needsUpdate = true;
    }
  }
}

/** Material for one part, in the engine's material language (userData.medType). */
export function humanMaterial(desc, root, opts = {}) {
  const k = desc.kind;
  const m = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  const url = (p) => root + '/' + p;
  if (desc.map && !desc.color) m.map = tex(url(desc.map), true);
  if (desc.map && desc.color) m.map = recolor(url(desc.map), desc.color, { contrast: k === 'leather' ? 0.9 : 0.8 });
  else if (desc.color && !desc.map) m.color.setRGB(...desc.color);
  if (desc.normalMap) { m.normalMap = tex(url(desc.normalMap), false); }
  m.userData.medType = 'default';
  switch (k) {
    case 'skin':
      m.userData.medType = 'skin'; m.roughness = 0.52; m.sheen = 0.35;
      if (opts.skinTint) m.color.setRGB(...opts.skinTint);
      m.userData.detail = 'pores';
      break;
    case 'eye': m.roughness = 0.05; m.userData.medType = 'eye'; m.specularIntensity = 1.0; m.alphaTest = 0.5; break;
    case 'brow': case 'lash':
      m.alphaTest = 0.35; m.side = DoubleSide; m.roughness = 0.7; m.userData.medType = 'hair'; m.userData.dither = true; break;
    case 'hair':
      m.alphaTest = 0.4; m.side = DoubleSide; m.roughness = 0.45; m.userData.medType = 'hair'; m.userData.dither = true; m.sheen = 0.6; break;
    case 'teeth': m.roughness = 0.25; m.userData.medType = 'skin'; m.sheen = 0.15; break;
    case 'tongue': m.roughness = 0.3; m.userData.medType = 'skin'; break;
    case 'leather': m.roughness = desc.rough ?? 0.5; m.clearcoat = 0.12; m.userData.medType = 'coat'; m.userData.detail = 'leather'; break;
    case 'wool': m.roughness = 0.85; m.sheen = 0.5; m.userData.medType = 'cloth'; m.userData.detail = 'fabric'; break;
    case 'batsuit': m.roughness = 0.5; m.userData.medType = 'batsuit'; m.color.setRGB(1, 1, 1); break;
    default: m.roughness = 0.75; m.sheen = 0.25; m.userData.medType = 'cloth'; m.userData.detail = 'fabric';
  }
  m.userData.wetFactor = k === 'skin' ? 0.6 : k === 'eye' ? 0 : 1;
  return m;
}

// ---------------------------------------------------------------------------

export class Human {
  /**
   * @param baseUrl folder holding human-base.json/.bin and <id>.json/.bin
   * @param id      character id
   * @param o       { levels: subdivision levels for body/clothes (0..2) }
   */
  /** Starts downloading characters (all at once) so later load() calls only build them. */
  static prefetch(baseUrl, ids) {
    for (const u of ['/human-base', ...ids.map((id) => '/' + id)]) fetchPair(baseUrl + u).catch(() => {});
  }

  static async load(baseUrl, id, o = {}) {
    const [base, ch] = await Promise.all([fetchPair(baseUrl + '/human-base'), fetchPair(baseUrl + '/' + id)]);
    globalThis.__mark?.(id + ' downloaded');
    const h = new Human(base, ch, baseUrl, o);
    globalThis.__mark?.(id + ' constructed');
    return h;
  }

  constructor(base, ch, root, { levels = 1 } = {}) {
    const B = base.h, C = ch.h;
    this.id = C.id; this.name = C.name; this.meta = C.meta ?? {}; this.height = C.height; this.credits = C.credits;
    this.root = new Group();
    this.root.name = C.id;
    // ---- skeleton (world-aligned rest pose)
    const heads = view(ch.buf, C.boneHeads);
    this.bones = {};
    const list = B.bones.map((name, i) => {
      const b = new Bone(); b.name = name;
      this.bones[name] = b;
      b.userData.rest = new Vector3(heads[i * 3], heads[i * 3 + 1], heads[i * 3 + 2]);
      return b;
    });
    B.parents.forEach((p, i) => {
      const b = list[i];
      if (p >= 0) { list[p].add(b); b.position.copy(b.userData.rest).sub(list[p].userData.rest); }
      else { this.root.add(b); b.position.copy(b.userData.rest); }
    });
    this.root.updateMatrixWorld(true);
    this.skeleton = new Skeleton(list);
    this.boneList = list;
    this.meshes = [];
    this.materials = {};
    const mats = C.materials;
    const getMat = (name) => (this.materials[name] ??= humanMaterial(mats[name].kind === 'hair' && this.meta.hairColor ? { ...mats[name], color: this.meta.hairColor } : mats[name], root, { skinTint: this.meta.skinTint }));

    // ---- body
    const bodyPos = view(ch.buf, C.body);
    const hidden = new Set(view(ch.buf, C.hiddenFaces));
    const fStart = view(base.buf, B.faceStart), fV = view(base.buf, B.faceV), fT = view(base.buf, B.faceT);
    const keep = { start: [0], idx: [], t: [] };
    for (let f = 0; f < fStart.length - 1; f++) {
      if (hidden.has(f)) continue;
      for (let j = fStart[f]; j < fStart[f + 1]; j++) { keep.idx.push(fV[j]); keep.t.push(fT[j]); }
      keep.start.push(keep.idx.length);
    }
    const bodyMorphs = B.morphs.map((m, unit) => ({ unit, idx: view(base.buf, m.idx), d: view(base.buf, m.d) }));
    const body = makeGeometry({
      count: B.bodyVerts, pos: bodyPos, faces: { start: Uint32Array.from(keep.start), idx: Uint32Array.from(keep.idx) },
      uv: view(base.buf, B.uv), tidx: Uint32Array.from(keep.t), joints: view(base.buf, B.joints), weights: view(base.buf, B.weights),
      morphUnits: bodyMorphs, levels,
    });
    this.body = this._mesh('body', body, getMat('skin'));

    // ---- proxies
    this.parts = {};
    for (const p of C.proxies) {
      const g = makeGeometry({
        count: p.position.length / 3, pos: view(ch.buf, p.position),
        faces: { start: view(ch.buf, p.faceStart), idx: view(ch.buf, p.faceV) },
        uv: view(ch.buf, p.uv), tidx: view(ch.buf, p.faceT),
        joints: view(ch.buf, p.joints), weights: view(ch.buf, p.weights),
        morphUnits: p.morphs.map((m) => ({ unit: m.unit, idx: view(ch.buf, m.idx), d: view(ch.buf, m.d) })),
        levels: p.subdivide ? levels : 0,
      });
      const mesh = this._mesh(p.name, g, getMat(p.material));
      mesh.userData.kind = p.kind;
      mesh.renderOrder = p.zDepth ?? 0;
      (this.parts[p.kind] ??= []).push(mesh);
    }
    // ---- garment layers: outer clothes sit a little further out than inner ones (no poke-through)
    const cloth = this.meshes.filter((m) => m.userData.kind === 'cloth' && !/shoe|boot/i.test(m.name)).sort((a, b) => a.renderOrder - b.renderOrder);
    cloth.forEach((m, rank) => {
      if (!rank) return;
      const P = m.geometry.attributes.position.array, N = m.geometry.attributes.normal.array;
      for (let i = 0; i < P.length; i++) P[i] += N[i] * 0.0045 * rank;
    });
    tuckUnder(cloth.map((m) => m.geometry));
    // ---- the face: one weight per unit, shared by every mesh that has shapes
    this.face = new Float32Array(FACE_UNITS.length);
    this.facePrev = new Float32Array(FACE_UNITS.length);
    for (const m of this.meshes) if (m.userData.morph) { m.userData.morph.weights = this.face; m.userData.morph.prev = this.facePrev; }
    this.unitIndex = Object.fromEntries(FACE_UNITS.map((n, i) => [n, i]));
  }

  _mesh(name, { geometry, morph }, material) {
    const m = new SkinnedMesh(geometry, material);
    m.name = name;
    m.castShadow = true;
    m.frustumCulled = false;
    if (morph) m.userData.morph = morph;
    this.root.add(m);
    m.bind(this.skeleton);
    this.meshes.push(m);
    return m;
  }

  /** Sets one face unit (0..1). */
  setUnit(name, w) { const i = this.unitIndex[name]; if (i !== undefined) this.face[i] = w; }
  getUnit(name) { return this.face[this.unitIndex[name]] ?? 0; }

  /** World position of a bone's head now. */
  bonePos(name, out = new Vector3()) { return this.bones[name].getWorldPosition(out); }

  /** Rest-pose positions of the body surface (subdivided), for garments built at load. */
  get surface() { return this.body.geometry.userData; }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
  }
}

export { Color };
