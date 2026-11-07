/**
 * Med Engine digital humans.
 *
 * Loads the files written by tools/human/build.mjs (CC0 MakeHuman topology, rig and face shapes, shaped per character) and builds
 * a skinned character the renderer draws:
 *  - Catmull-Clark subdivision at load: one level by default (13k -> 53k vertices on the body), with skin weights and face
 *    shapes carried through the same stencils;
 *  - the 52 ARKit face units as morph targets (a sparse set per mesh: only the vertices a shape moves cost memory), driven by
 *    one weight array shared by every mesh of the character (`human.face`, or `setUnit('jawOpen', 0.4)`);
 *  - eyes on their own bones, so gaze is a rotation; lids follow with the eyeLook shapes;
 *  - bones in a world-aligned rest pose (every bone's rest rotation is identity), so a pose is simply a rotation per bone in
 *    its parent's frame, and mocap retargeted with `retargetBVH` (anim/Retarget.js) plays on it as it is.
 *
 *   const human = await Human.load(engine.assets, 'assets/human', 'mara', { levels: 1 });
 *   engine.scene.add(human.root);
 *   const animator = new Animator(human.root);
 *
 * Photogrammetry or any other scanned head: a glTF whose face mesh carries the 52 ARKit blendshapes as morph targets (in the
 * ARKit order of FACE_UNITS, or named in `mesh.extras.targetNames`) works with `Face` unchanged: see `attachScanHead`.
 *
 * Not tested against real MakeHuman exports in this repository (none ship with it): the loader is exercised with a small
 * synthetic character in the same file format (tests/helpers/human.js) and rendered on the GPU.
 */
import { Group } from '../scene/Object3D.js';
import { Bone, Skeleton, SkinnedMesh } from '../scene/Mesh.js';
import { BufferGeometry, BufferAttribute } from '../scene/Geometry.js';
import { StandardMaterial, Texture, DoubleSide, SRGBColorSpace, RepeatWrapping } from '../scene/Material.js';
import { Vector3 } from '../math/core.js';
import { subdivideLevels, applyStencils, applyStencilsSkin } from './Subdivision.js';

/**
 * @import { Object3D } from '../scene/Object3D.js'
 * @import { AssetManager } from '../assets/AssetManager.js'
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

// ---------------------------------------------------------------------------------------------------------- files

const TYPES = { Float32: Float32Array, Uint32: Uint32Array, Uint8: Uint8Array, Uint16: Uint16Array, Int32: Int32Array };
/** A typed array over the packed binary, as described by a `{ offset, length, type }` reference in the JSON header. */
function view(buf, ref) { return new TYPES[ref.type](buf, ref.offset, ref.length); }

/** The bytes as an aligned ArrayBuffer (typed-array views need that), inflating gzip when the server did not. */
async function plainBuffer(bytes) {
  let u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length > 2 && u[0] === 0x1f && u[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Human: this runtime cannot inflate gzip (no DecompressionStream)');
    const stream = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  if (u.byteOffset % 4 || u.byteLength !== u.buffer.byteLength) u = u.slice();
  return u.buffer;
}

/** `<url>.json` and `<url>.binz` (gzip) or `<url>.bin`. */
async function readPair(assets, url) {
  const [h, raw] = await Promise.all([
    assets.json(`${url}.json`),
    assets.bytes(`${url}.binz`).catch(() => assets.bytes(`${url}.bin`)),
  ]);
  return { h, buf: await plainBuffer(raw) };
}

// ---------------------------------------------------------------------------------------------------------- geometry

/**
 * Sparse morph targets for one mesh: every vertex that any shape moves gets a slot, and each of the 52 units stores one
 * relative delta per slot. A unit the mesh does not use shares one all-zero attribute.
 */
function buildMorph(vertCount, perUnit /* [{unit, idx:Uint32Array, d:Float32Array}] */) {
  const slotOf = new Int32Array(vertCount).fill(-1);
  let slots = 0;
  for (const u of perUnit) for (const v of u.idx) if (slotOf[v] < 0) slotOf[v] = slots++;
  if (!slots) return null;
  const targets = new Array(FACE_UNITS.length).fill(null);
  for (const u of perUnit) {
    const a = targets[u.unit] ? targets[u.unit].array : new Float32Array(slots * 3);
    for (let i = 0; i < u.idx.length; i++) {
      const s = slotOf[u.idx[i]] * 3;
      a[s] += u.d[i * 3]; a[s + 1] += u.d[i * 3 + 1]; a[s + 2] += u.d[i * 3 + 2];
    }
    targets[u.unit] ??= new BufferAttribute(a, 3);
  }
  const zero = new BufferAttribute(new Float32Array(slots * 3), 3);
  for (let i = 0; i < targets.length; i++) targets[i] ??= zero;
  const slotAttr = new Float32Array(vertCount);
  for (let v = 0; v < vertCount; v++) slotAttr[v] = slotOf[v];
  return { slotAttr, targets, slots };
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

/** Fans of every polygon as (a, b, c, c) groups so computeNormals can treat n-gons like quads. */
function fanQuads(faces) {
  const out = [];
  for (let f = 0; f < faces.start.length - 1; f++) {
    const s = faces.start[f], e = faces.start[f + 1];
    for (let k = s + 1; k < e - 1; k++) out.push(faces.idx[s], faces.idx[k], faces.idx[k + 1], faces.idx[k + 1]);
  }
  return out;
}

/**
 * Turns polygon data (position-indexed faces + uv-indexed faces) into a renderable geometry, splitting vertices along uv seams.
 * Optional subdivision first. Face shapes are mapped onto the render vertices as sparse morph targets.
 */
function makeGeometry({ count, pos, faces, uv, tidx, joints, weights, morphUnits, levels }) {
  let P = pos, J = joints, W = weights, quadsV = null, quadsT = null, UV = uv, N = count;
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
  }
  // corners -> unique (position, uv) vertices
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
  g.userData.srcIndex = Uint32Array.from(outSrc);          // render vertex -> position index
  g.userData.positionsBySource = P; g.userData.normalsBySource = normals; g.userData.sourceCount = N;
  if (units?.length) {
    // remap the shapes from position indices to render vertices
    const bySrc = new Map();
    outSrc.forEach((p, v) => { if (!bySrc.has(p)) bySrc.set(p, []); bySrc.get(p).push(v); });
    const remapped = units.map((u) => {
      const idx = [], d = [];
      for (let i = 0; i < u.idx.length; i++) for (const v of bySrc.get(u.idx[i]) ?? []) { idx.push(v); d.push(u.d[i * 3], u.d[i * 3 + 1], u.d[i * 3 + 2]); }
      return { unit: u.unit, idx: Uint32Array.from(idx), d: Float32Array.from(d) };
    });
    const m = buildMorph(vi, remapped);
    if (m) {
      g.setAttribute('morphSlot', new BufferAttribute(m.slotAttr, 1));
      g.morphAttributes.position = m.targets; g.morphTargetsRelative = true;
      g.userData.morphSlots = m.slots; g.userData.morphNames = FACE_UNITS.slice();
    }
  }
  g.computeBoundingSphere();
  return g;
}

/**
 * Layered clothes: wherever an outer garment lies over an inner one (any of its vertices within `reach`), the inner one is
 * drawn in under it by `depth` along its own normals. A long coat over a bulky suit jacket otherwise shows the jacket through
 * it in patches; an open front, a collar or a cuff with nothing over it stays exactly where it was. `geoms` are ordered inner
 * to outer.
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

// ---------------------------------------------------------------------------------------------------------- materials

/** RGBA pixels of a decoded image, whether the platform gave raw pixels (Node, Deno) or an ImageBitmap (a browser). */
function pixelsOf(image) {
  if (image?.data) return { width: image.width, height: image.height, data: image.data };
  const w = image.width, h = image.height;
  let ctx;
  if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  else if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; ctx = c.getContext('2d', { willReadFrequently: true }); }
  if (!ctx) throw new Error('Human: cannot read the pixels of an image on this platform');
  ctx.drawImage(image, 0, 0);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: d.width, height: d.height, data: d.data };
}

/**
 * A new texture with the original's shading and another colour: the pixels are centred on the colour by their mean luminance.
 * Printed logos, reflective strips and white trim are clamped so they do not survive the dye.
 */
export function recolorTexture(tex, color, { contrast = 1.3, keep = 0 } = {}) {
  const { width, height, data } = pixelsOf(tex.image);
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 64) { sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; }
  const mean = Math.max(8, sum / Math.max(1, n));
  const lin = color.map((x) => Math.pow(Math.max(0, x), 1 / 2.2) * 255);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const l = Math.min(1.25, (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / mean);
    const s = Math.max(0, 1 + (l - 1) * contrast);
    for (let k = 0; k < 3; k++) out[i + k] = Math.min(255, lin[k] * s * (1 - keep) + data[i + k] * keep);
    out[i + 3] = data[i + 3];
  }
  const t = new Texture({ width, height, data: out });
  t.name = `${tex.name || 'texture'} (recoloured)`;
  t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.flipY = tex.flipY;
  t.needsUpdate = true;
  return t;
}

/**
 * A material for one part, in the engine's shading models. `textures` maps the descriptor's file names to loaded Textures.
 * @param {object} desc  { kind: 'skin'|'eye'|'brow'|'lash'|'hair'|'teeth'|'tongue'|'leather'|'wool'|'batsuit'|'cloth', map?, normalMap?, color?, rough? }
 */
export function humanMaterial(desc, textures = new Map(), opts = {}) {
  const k = desc.kind;
  const m = new StandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  const tex = (file) => textures.get(file) ?? null;
  if (desc.map && !desc.color) m.map = tex(desc.map);
  if (desc.map && desc.color) { const t = tex(desc.map); m.map = t ? recolorTexture(t, desc.color, { contrast: k === 'leather' ? 0.9 : 0.8 }) : null; if (!m.map) m.color.setRGB(...desc.color); }
  else if (desc.color && !desc.map) m.color.setRGB(...desc.color);
  if (desc.normalMap) m.normalMap = tex(desc.normalMap);
  m.medType = 'default';
  switch (k) {
    case 'skin':
      m.medType = 'skin'; m.roughness = 0.52; m.sheen = 0.35; m.detail = 'pores';
      if (opts.skinTint) m.color.setRGB(...opts.skinTint);
      break;
    case 'eye': m.roughness = 0.05; m.medType = 'eye'; m.specularIntensity = 1.0; m.alphaTest = 0.5; break;
    case 'brow': case 'lash':
      m.alphaTest = 0.35; m.side = DoubleSide; m.roughness = 0.7; m.medType = 'hair'; m.dither = true; break;
    case 'hair':
      m.alphaTest = 0.4; m.side = DoubleSide; m.roughness = 0.45; m.medType = 'hair'; m.dither = true; m.sheen = 0.6; break;
    case 'teeth': m.roughness = 0.25; m.medType = 'skin'; m.sheen = 0.15; break;
    case 'tongue': m.roughness = 0.3; m.medType = 'skin'; break;
    case 'leather': m.roughness = desc.rough ?? 0.5; m.clearcoat = 0.12; m.medType = 'coat'; m.detail = 'leather'; break;
    case 'wool': m.roughness = 0.85; m.sheen = 0.5; m.medType = 'cloth'; m.detail = 'fabric'; break;
    case 'batsuit': m.roughness = 0.5; m.medType = 'batsuit'; m.color.setRGB(1, 1, 1); break;
    default: m.roughness = 0.75; m.sheen = 0.25; m.medType = 'cloth'; m.detail = 'fabric';
  }
  m.wetFactor = k === 'skin' ? 0.6 : k === 'eye' ? 0 : 1;
  return m;
}

// ---------------------------------------------------------------------------------------------------------- the human

export class Human {
  /**
   * Loads `<baseUrl>/human-base.json|.binz` and `<baseUrl>/<id>.json|.binz` (and the textures the character names).
   * @param {AssetManager} assets   `engine.assets`
   * @param {string} baseUrl        folder holding human-base.* and <id>.*
   * @param {string} id             character id
   * @param {object} [o]
   * @param {number} [o.levels]     subdivision levels for body and clothes (0..2, default 1)
   * @param {boolean} [o.strictTextures]  throw when a texture the character names cannot be loaded (default: keep the plain colour)
   * @returns {Promise<Human>}
   */
  static async load(assets, baseUrl, id, o = {}) {
    if (!assets?.json || !assets?.bytes) throw new Error('Human.load: pass an AssetManager first: Human.load(engine.assets, baseUrl, id)');
    const root = baseUrl.replace(/\/+$/, '');
    const [base, ch] = await Promise.all([readPair(assets, `${root}/human-base`), readPair(assets, `${root}/${id}`)]);
    // the textures, so that building the character is synchronous
    const files = new Set();
    for (const m of Object.values(ch.h.materials ?? {})) for (const f of [m.map, m.normalMap]) if (f) files.add(f);
    const textures = new Map();
    await Promise.all([...files].map(async (f) => {
      try { textures.set(f, await assets.texture(`${root}/${f}`, { wrap: 'repeat' })); } catch (e) { if (o.strictTextures) throw e; /* a missing texture leaves the colour */ }
    }));
    return new Human(base, ch, { ...o, textures });
  }

  /**
   * Builds a character from already-read data: `base` and `ch` are `{ h: header (parsed JSON), buf: ArrayBuffer }` of the two files.
   * @param {{ h: any, buf: ArrayBuffer }} base  the parsed header and the binary of human-base
   * @param {{ h: any, buf: ArrayBuffer }} ch    the same for the character
   * @param {object} [o]
   * @param {number} [o.levels]                  subdivision levels (0..2, default 1)
   * @param {Map<string, Texture>} [o.textures]  loaded textures by the file names the character gives
   */
  constructor(base, ch, { levels = 1, textures = new Map() } = {}) {
    const B = base.h, C = ch.h;
    if (B.format !== 'med-human-base' || C.format !== 'med-human') throw new Error('Human: these are not med-human files (format fields missing)');
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
    const mats = C.materials ?? {};
    const getMat = (name) => (this.materials[name] ??= humanMaterial(mats[name].kind === 'hair' && this.meta.hairColor ? { ...mats[name], color: this.meta.hairColor } : mats[name], textures, { skinTint: this.meta.skinTint }));

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
    const bodyMorphs = (B.morphs ?? []).map((m, unit) => ({ unit, idx: view(base.buf, m.idx), d: view(base.buf, m.d) }));
    const body = makeGeometry({
      count: B.bodyVerts, pos: bodyPos, faces: { start: Uint32Array.from(keep.start), idx: Uint32Array.from(keep.idx) },
      uv: view(base.buf, B.uv), tidx: Uint32Array.from(keep.t), joints: view(base.buf, B.joints), weights: view(base.buf, B.weights),
      morphUnits: bodyMorphs, levels,
    });
    this.body = this._mesh('body', body, getMat('skin'));

    // ---- proxies (eyes, brows, lashes, teeth, tongue, hair, clothes)
    this.parts = {};
    for (const p of C.proxies ?? []) {
      const g = makeGeometry({
        count: p.position.length / 3, pos: view(ch.buf, p.position),
        faces: { start: view(ch.buf, p.faceStart), idx: view(ch.buf, p.faceV) },
        uv: view(ch.buf, p.uv), tidx: view(ch.buf, p.faceT),
        joints: view(ch.buf, p.joints), weights: view(ch.buf, p.weights),
        morphUnits: (p.morphs ?? []).map((m) => ({ unit: m.unit, idx: view(ch.buf, m.idx), d: view(ch.buf, m.d) })),
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
    /** The 52 face unit weights (0..1) in FACE_UNITS order. Write them directly or with setUnit(). */
    this.face = new Float32Array(FACE_UNITS.length);
    this.facePrev = new Float32Array(FACE_UNITS.length);
    for (const m of this.meshes) if (m.geometry.morphAttributes.position) m.morphTargetInfluences = this.face;
    this.unitIndex = Object.fromEntries(FACE_UNITS.map((n, i) => [n, i]));
  }

  _mesh(name, geometry, material) {
    const m = new SkinnedMesh(geometry, material);
    m.name = name;
    m.castShadow = true;
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
    for (const m of this.meshes) m.geometry.dispose?.();
    for (const m of Object.values(this.materials)) m.dispose?.();
  }
}

// ---------------------------------------------------------------------------------------------------------- scans

/**
 * What `attachScanHead` returns: the face interface of `Human`, over a scanned head.
 * @typedef {object} ScanHead
 * @property {Object3D} root
 * @property {Record<string, Object3D>} bones
 * @property {Float32Array} face               the shared weights, in FACE_UNITS order
 * @property {Float32Array} facePrev
 * @property {Record<string, number>} unitIndex  FACE_UNITS name -> index
 * @property {Object3D[]} meshes               the meshes that carry morph targets
 * @property {string[]} missing                the FACE_UNITS the scan has no shape for
 * @property {() => void} sync                 copies `face` into the meshes (call once per frame after the face has been updated; Actor does)
 * @property {(name: string, w: number) => void} setUnit
 * @property {(name: string) => number} getUnit
 * @property {() => void} dispose
 */

/**
 * Prepares a loaded glTF head (a photogrammetry scan with the 52 ARKit blendshapes as morph targets) for the `Face` system.
 *
 * The scan's own meshes and skeleton are used as they are. What this does is the glue: it finds the morph targets of the
 * meshes by name (`geometry.userData.morphNames`, which the GLTFLoader fills from `extras.targetNames`), builds one shared
 * weight array in FACE_UNITS order, and returns an object with the same face interface as `Human` (`face`, `unitIndex`,
 * `setUnit`, `getUnit`, `bones`, `root`), so `new Face(head, rig)` and `Actor` treat it like a MakeHuman character.
 *
 * @param {Object3D} root  `gltf.scene` of the scan
 * @param {object} [o]
 * @param {Record<string, string>} [o.aliases]  the scan's names for morph targets -> ARKit names, for the ones that differ
 * @returns {ScanHead}
 */
export function attachScanHead(root, { aliases = {} } = {}) {
  const meshes = [], bones = {};
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh && o.geometry?.morphAttributes?.position?.length) meshes.push(o);
  });
  const face = new Float32Array(FACE_UNITS.length);
  const unitIndex = Object.fromEntries(FACE_UNITS.map((n, i) => [n, i]));
  const found = new Set();
  for (const mesh of meshes) {
    const names = mesh.geometry.userData.morphNames ?? mesh.userData.targetNames ?? null;
    const n = mesh.geometry.morphAttributes.position.length;
    // the weights array of a mesh is its own (the renderer reads it), mapped from the shared face array by a small per-mesh table
    const map = new Int16Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      const raw = names?.[k];
      const name = raw ? (aliases[raw] ?? raw) : FACE_UNITS[k];
      const u = unitIndex[name] ?? unitIndex[name?.replace(/^.*[._]/, '')];
      if (u !== undefined) { map[k] = u; found.add(FACE_UNITS[u]); }
    }
    mesh.userData.faceMap = map;
    mesh.morphTargetInfluences = mesh.morphTargetInfluences && mesh.morphTargetInfluences.length === n ? mesh.morphTargetInfluences : new Array(n).fill(0);
  }
  const sync = () => { for (const mesh of meshes) { const map = mesh.userData.faceMap, w = mesh.morphTargetInfluences; for (let k = 0; k < map.length; k++) if (map[k] >= 0) w[k] = face[map[k]]; } };
  return {
    root, bones, face, facePrev: new Float32Array(face.length), unitIndex, meshes,
    missing: FACE_UNITS.filter((u) => !found.has(u)),
    /** Copies the shared face weights into the meshes: call once per frame after the face has been updated (Actor does). */
    sync,
    setUnit(name, w) { const i = unitIndex[name]; if (i !== undefined) face[i] = w; },
    getUnit(name) { return face[unitIndex[name]] ?? 0; },
    dispose() {},
  };
}
