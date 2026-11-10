import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodePlatform } from '../src/platform/node.js';
import {
  Engine, Vector3, Quaternion, Group, PlaneCollider, GLTFLoader, DoubleSide, Texture, BufferGeometry, BufferAttribute,
} from '../src/index.js';
import { Human, FACE_UNITS, humanMaterial, recolorTexture, tuckUnder, attachScanHead } from '../src/human/Human.js';
import { Actor, loadClipLibrary } from '../src/human/Actor.js';
import { subdivideLevels, applyStencils } from '../src/human/Subdivision.js';
import { writeSyntheticHuman } from './helpers/human.js';
import { GLTFBuilder } from './helpers/gltf.js';

const ROOT = new URL('../', import.meta.url).pathname;
const near = (a, b, eps = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} ± ${eps}, got ${a}`);
const flush = () => new Promise((r) => setImmediate(r));
const DT = 1 / 60;
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize()))));

// ----------------------------------------------------------------------------------------------------------------- fixtures

const made = [];
/** Writes a synthetic character to a fresh folder (removed after the tests). */
function character(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'medhuman-'));
  made.push(dir);
  return { dir, info: writeSyntheticHuman(dir, opts) };
}
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

let sharedEngine = null;
const assetsOnly = async () => (sharedEngine ??= await Engine.create({ platform: new NodePlatform(), render: false, baseUrl: ROOT })).assets;
const load = async (c, o = {}) => Human.load(await assetsOnly(), c.dir, c.info.id, o);

/** A repeatable stream of numbers in [0, 1) (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Which part of the synthetic body a source vertex belongs to. */
const partOf = (info, v) => Object.entries(info.bodyParts).find(([, p]) => v >= p.firstVert && v < p.firstVert + p.verts)?.[0];

/** The subdivision of the visible body, computed here independently of the loader. */
function reference(info, levels) {
  if (!levels) return { count: info.bodyVerts, stencils: null };
  const hidden = new Set(info.hiddenFaces);
  const start = [0], idx = [];
  info.bodyFaceVerts.forEach((f, i) => { if (hidden.has(i)) return; idx.push(...f); start.push(idx.length); });
  const s = subdivideLevels(info.bodyVerts, { start: Uint32Array.from(start), idx: Uint32Array.from(idx) }, null, levels);
  return { count: s.count, stencils: s.stencils };
}
function expectedDelta(info, ref, unitName) {
  const m = info.bodyMorphs.find((x) => x.name === unitName);
  const dense = new Float32Array(info.bodyVerts * 3);
  for (let i = 0; i < m.idx.length; i++) dense.set(m.d.subarray(i * 3, i * 3 + 3), m.idx[i] * 3);
  return ref.stencils ? applyStencils(ref.stencils, dense, 3, ref.count) : dense;
}
/** The first original vertex a subdivided row is made of (all of a row's sources lie in one box). */
const rowSource = (ref, row) => (ref.stencils ? ref.stencils.src[ref.stencils.start[row]] : row);

// ----------------------------------------------------------------------------------------------------------------- the loader

test('Human.load reads the two gzip files and builds a skeleton in a world-aligned rest pose', async () => {
  const c = character();
  const h = await load(c);
  assert.equal(h.id, 'tess');
  assert.equal(h.name, 'Synthetic tess');
  near(h.height, c.info.height, 1e-6);
  assert.equal(h.credits[0].license, 'CC0');
  assert.deepEqual(Object.keys(h.bones), c.info.bones);
  assert.equal(h.skeleton.bones.length, c.info.bones.length);
  h.root.updateMatrixWorld(true);
  const p = new Vector3(), q = new Quaternion();
  c.info.bones.forEach((n, i) => {
    const b = h.bones[n];
    b.getWorldPosition(p);
    near(p.x, c.info.boneHeads[i * 3], 1e-5, `${n}.x`); near(p.y, c.info.boneHeads[i * 3 + 1], 1e-5, `${n}.y`); near(p.z, c.info.boneHeads[i * 3 + 2], 1e-5, `${n}.z`);
    b.getWorldQuaternion(q);
    assert.ok(Math.abs(q.w) > 0.999999, `${n} rests with the identity rotation`);
    const par = c.info.parents[i];
    assert.equal(b.parent, par < 0 ? h.root : h.bones[c.info.bones[par]], `${n} hangs under its parent`);
  });
});

test('plain .bin files load like the gzipped ones', async () => {
  const gz = character({ id: 'a' }), plain = character({ id: 'a', gzip: false });
  assert.ok(readdirSync(plain.dir).includes('human-base.bin') && !readdirSync(plain.dir).includes('human-base.binz'));
  assert.ok(readdirSync(gz.dir).includes('human-base.binz'));
  const [x, y] = [await load(gz, { levels: 0 }), await load(plain, { levels: 0 })];
  assert.equal(x.body.geometry.attributes.position.count, y.body.geometry.attributes.position.count);
  assert.deepEqual([...x.body.geometry.attributes.position.array], [...y.body.geometry.attributes.position.array]);
});

test('the body drops the faces hidden under clothes and splits vertices along uv seams', async () => {
  const c = character(), { info } = c;
  const h = await load(c, { levels: 0 });
  const g = h.body.geometry;
  const shown = info.bodyFaces - info.hiddenFaces.length;
  assert.equal(info.hiddenFaces.length, 6);
  assert.equal(g.index.count, shown * 6, 'two triangles for every visible quad');
  assert.equal(g.attributes.position.count, shown * 4, 'here every corner has its own uv, so every corner is a vertex');
  assert.ok(h.body.isSkinnedMesh && h.body.skeleton === h.skeleton);
  for (const a of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'morphSlot']) assert.ok(g.attributes[a], a);
  const P = g.attributes.position.array, N = g.attributes.normal.array, UV = g.attributes.uv.array, J = g.attributes.skinIndex.array, W = g.attributes.skinWeight.array;
  const src = g.userData.srcIndex;
  const centre = {};
  for (const [name, part] of Object.entries(info.bodyParts)) {
    const m = [0, 0, 0];
    for (let i = 0; i < 8; i++) for (let a = 0; a < 3; a++) m[a] += info.bodyPositions[(part.firstVert + i) * 3 + a] / 8;
    centre[name] = m;
  }
  for (let v = 0; v < g.attributes.position.count; v++) {
    const part = partOf(info, src[v]);
    assert.notEqual(part, 'chest', 'no vertex of the hidden chest is drawn');
    near(Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]), 1, 1e-5, 'unit normal');
    const out = (P[v * 3] - centre[part][0]) * N[v * 3] + (P[v * 3 + 1] - centre[part][1]) * N[v * 3 + 1] + (P[v * 3 + 2] - centre[part][2]) * N[v * 3 + 2];
    assert.ok(out > 0, `normal of a ${part} vertex points outward`);
    assert.ok(UV[v * 2] >= 0 && UV[v * 2] <= 1 && UV[v * 2 + 1] >= 0 && UV[v * 2 + 1] <= 1);
    let sum = 0;
    for (let k = 0; k < 4; k++) { sum += W[v * 4 + k]; assert.ok(J[v * 4 + k] < info.bones.length); }
    near(sum, 1, 1e-5, 'weights add to one');
  }
  // the winding: every triangle faces away from the middle of its box
  const I = g.index.array;
  for (let t = 0; t < I.length; t += 3) {
    const a = [I[t], I[t + 1], I[t + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const e1 = a[1].map((x, i) => x - a[0][i]), e2 = a[2].map((x, i) => x - a[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cen = centre[partOf(info, src[I[t]])];
    const mid = a[0].map((x, i) => (x + a[1][i] + a[2][i]) / 3 - cen[i]);
    assert.ok(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0, 'counter-clockwise from outside');
  }
});

test('one subdivision level smooths the body and keeps skin weights inside the bones of their own box', async () => {
  const c = character(), { info } = c;
  const lo = await load(c, { levels: 0 }), hi = await load(c, { levels: 1 });
  const g = hi.body.geometry;
  assert.ok(g.attributes.position.count > lo.body.geometry.attributes.position.count * 2, 'more vertices');
  const ref = reference(info, 1);
  const J = g.attributes.skinIndex.array, W = g.attributes.skinWeight.array, src = g.userData.srcIndex;
  let blended = 0;
  for (let v = 0; v < g.attributes.position.count; v++) {
    const part = info.bodyParts[partOf(info, rowSource(ref, src[v]))];
    let sum = 0, bones = 0;
    for (let k = 0; k < 4; k++) {
      const w = W[v * 4 + k];
      sum += w;
      if (w > 1e-6) { bones++; assert.ok(part.bones.includes(J[v * 4 + k]), `a ${partOf(info, rowSource(ref, src[v]))} vertex is weighted to a bone it was not bound to`); }
    }
    near(sum, 1, 1e-4, 'weights stay normalised');
    if (bones > 1) blended++;
  }
  assert.ok(blended > 20, `${blended} blended vertices at the joints`);
  // a box bound to one bone stays rigid: the neck
  const neck = info.bones.indexOf('neck_01');
  let seen = 0;
  for (let v = 0; v < g.attributes.position.count; v++) {
    if (partOf(info, rowSource(ref, src[v])) !== 'neck') continue;
    seen++;
    let w = 0;
    for (let k = 0; k < 4; k++) if (J[v * 4 + k] === neck) w += W[v * 4 + k];
    near(w, 1, 1e-5, 'neck vertex');
  }
  assert.ok(seen > 20);
  // smoothing pulls corners in: the body is not larger than the boxes it was made from
  const P = g.attributes.position.array;
  let top = -Infinity;
  for (let i = 1; i < P.length; i += 3) top = Math.max(top, P[i]);
  assert.ok(top <= info.height + 1e-6 && top > info.height - 0.05, `top of the head ${top} vs ${info.height}`);
});

test('the face is one weight per ARKit unit, shared by every mesh that has shapes', async () => {
  const c = character();
  const h = await load(c);
  assert.equal(FACE_UNITS.length, 52);
  assert.ok(h.face instanceof Float32Array && h.face.length === 52);
  assert.equal(h.unitIndex.jawOpen, FACE_UNITS.indexOf('jawOpen'));
  assert.equal(h.unitIndex.tongueOut, 51);
  const withShapes = h.meshes.filter((m) => m.geometry.morphAttributes.position).map((m) => m.name).sort();
  assert.deepEqual(withShapes, ['body', 'brows', 'lashes', 'teeth', 'tongue']);
  for (const m of h.meshes) {
    if (withShapes.includes(m.name)) assert.equal(m.morphTargetInfluences, h.face, `${m.name} reads the shared weights`);
    else assert.notEqual(m.morphTargetInfluences, h.face);
  }
  h.setUnit('jawOpen', 0.5); h.setUnit('noSuchUnit', 1);
  assert.equal(h.face[24], 0.5);
  assert.equal(h.getUnit('jawOpen'), 0.5);
  assert.equal(h.getUnit('noSuchUnit'), 0);
  assert.ok(h.body.morphTargetInfluences[24] === 0.5, 'the renderer sees it');
  // 52 targets per mesh, in unit order; the ones a mesh does not use share one all-zero attribute
  const teeth = h.parts.teeth[0].geometry;
  assert.equal(teeth.morphAttributes.position.length, 52);
  assert.equal(teeth.morphTargetsRelative, true);
  const unused = teeth.morphAttributes.position.filter((_, i) => i !== 24);
  assert.ok(unused.every((a) => a === unused[0]), 'unused units share one attribute');
  assert.ok(unused[0].array.every((x) => x === 0));
  assert.notEqual(teeth.morphAttributes.position[24], unused[0]);
  assert.equal(teeth.userData.morphSlots, 24, 'the teeth box has 24 corners and jawOpen moves them all');
  assert.deepEqual(teeth.userData.morphNames, FACE_UNITS);
});

test('face shapes land on the right render vertices, also through subdivision and uv seams', async () => {
  const c = character(), { info } = c;
  for (const levels of [0, 1]) {
    const h = await load(c, { levels });
    const g = h.body.geometry, ref = reference(info, levels);
    const slot = g.attributes.morphSlot.array, src = g.userData.srcIndex;
    let checked = 0, moved = 0;
    for (let u = 0; u < FACE_UNITS.length; u++) {
      const want = expectedDelta(info, ref, FACE_UNITS[u]);
      const target = g.morphAttributes.position[u].array;
      for (let v = 0; v < g.attributes.position.count; v++) {
        for (let a = 0; a < 3; a++) {
          const got = slot[v] < 0 ? 0 : target[slot[v] * 3 + a];
          near(got, want[src[v] * 3 + a], 2e-6, `${FACE_UNITS[u]} at vertex ${v} (level ${levels})`);
          checked++;
          if (got !== 0) moved++;
        }
      }
    }
    assert.ok(checked > 40000 && moved > 500, `${checked} values checked, ${moved} non-zero`);
    // jawOpen: the chin end of the head drops, the top does not
    const jaw = g.morphAttributes.position[24].array;
    const head = info.bodyParts.head;
    let down = 0, still = 0;
    for (let v = 0; v < g.attributes.position.count; v++) {
      if (partOf(info, rowSource(ref, src[v])) !== 'head') continue;
      const dy = slot[v] < 0 ? 0 : jaw[slot[v] * 3 + 1];
      if (dy < -0.005) down++; else if (Math.abs(dy) < 1e-6) still++;
      assert.ok(dy <= 1e-6, 'nothing of the head rises when the jaw opens');
    }
    assert.ok(down > 0 && still > 0, `${down} vertices drop, ${still} stay (${head.verts} corners)`);
  }
});

test('proxies: eyes ride the eye bones, brows and lashes carry their shapes, parts keep their draw order', async () => {
  const c = character(), { info } = c;
  const h = await load(c, { levels: 0 });
  assert.deepEqual(h.meshes.map((m) => m.name), ['body', 'eyes', 'brows', 'lashes', 'teeth', 'tongue', 'hair', 'shirt', 'jacket', 'coat']);
  assert.deepEqual(Object.keys(h.parts).sort(), ['brow', 'cloth', 'eye', 'hair', 'lash', 'teeth', 'tongue']);
  for (const [kind, list] of Object.entries(h.parts)) for (const m of list) assert.equal(m.userData.kind, kind);
  const order = Object.fromEntries(h.meshes.map((m) => [m.name, m.renderOrder]));
  assert.deepEqual([order.brows, order.lashes, order.shirt, order.jacket, order.coat], [10, 20, 50, 60, 70]);
  // each eye is weighted to its own bone alone: +x is the character's left
  const eyes = h.parts.eye[0].geometry, P = eyes.attributes.position.array, J = eyes.attributes.skinIndex.array, W = eyes.attributes.skinWeight.array;
  const l = info.bones.indexOf('eye_l'), r = info.bones.indexOf('eye_r');
  for (let v = 0; v < eyes.attributes.position.count; v++) {
    assert.equal(J[v * 4], P[v * 3] > 0 ? l : r);
    assert.equal(W[v * 4], 1);
  }
  // browDownLeft moves the left brow (+x) only
  const brows = h.parts.brow[0].geometry, bp = brows.attributes.position.array, slot = brows.attributes.morphSlot.array;
  const down = brows.morphAttributes.position[FACE_UNITS.indexOf('browDownLeft')].array;
  let leftVerts = 0;
  for (let v = 0; v < brows.attributes.position.count; v++) {
    const dy = slot[v] < 0 ? 0 : down[slot[v] * 3 + 1];
    if (bp[v * 3] > 0) { near(dy, -0.012, 1e-6, 'left brow drops'); leftVerts++; } else near(dy, 0, 1e-9, 'right brow stays');
  }
  assert.equal(leftVerts, 24);
  // meshes with nothing to do on the face have no shapes at all
  assert.ok(!h.parts.hair[0].geometry.morphAttributes.position);
  assert.ok(!h.parts.eye[0].geometry.morphAttributes.position);
});

test('garments: each layer stands off 4.5 mm further than the one below, and inner layers are tucked in under outer ones', async () => {
  const c = character();
  const h = await load(c, { levels: 0 });
  const layers = ['shirt', 'jacket', 'coat'].map((name) => {
    const g = h.meshes.find((m) => m.name === name).geometry;
    return { name, g, pos: g.attributes.position.array, nor: g.attributes.normal.array, src: g.userData.srcIndex, base: g.userData.positionsBySource, n: g.attributes.position.count };
  });
  // what the loader should have made, worked out here with a plain double loop: offset by rank, then tuck inner layers under
  // outer ones in order, each against the positions as they are at that moment
  const want = layers.map((L, rank) => {
    const out = new Float32Array(L.n * 3);
    for (let v = 0; v < L.n; v++) for (let a = 0; a < 3; a++) out[v * 3 + a] = L.base[L.src[v] * 3 + a] + L.nor[v * 3 + a] * 0.0045 * rank;
    return out;
  });
  const tucked = layers.map(() => 0);
  for (let o = 1; o < layers.length; o++) {
    for (let i = 0; i < o; i++) {
      const A = layers[i];
      for (let v = 0; v < A.n; v++) {
        let covered = false;
        for (let w = 0; w < layers[o].n && !covered; w++) {
          covered = Math.hypot(want[o][w * 3] - want[i][v * 3], want[o][w * 3 + 1] - want[i][v * 3 + 1], want[o][w * 3 + 2] - want[i][v * 3 + 2]) < 0.03;
        }
        if (covered) { for (let a = 0; a < 3; a++) want[i][v * 3 + a] -= A.nor[v * 3 + a] * 0.016; tucked[i]++; }
      }
    }
  }
  layers.forEach((L, i) => { for (let k = 0; k < L.n * 3; k++) near(L.pos[k], want[i][k], 3e-6, `${L.name}[${k}]`); });
  // the numbers that make this more than a re-run of the algorithm: the coat is rank 2, so twice the offset of the jacket's
  const coat = layers[2];
  for (let v = 0; v < coat.n; v++) for (let a = 0; a < 3; a++) near(coat.pos[v * 3 + a] - coat.base[coat.src[v] * 3 + a], coat.nor[v * 3 + a] * 0.009, 3e-6, 'coat stands off 9 mm');
  assert.equal(tucked[2], 0, 'nothing lies over the coat');
  assert.ok(tucked[1] === layers[1].n, `the coat covers the whole jacket (${tucked[1]} of ${layers[1].n} vertices pulled in)`);
  assert.ok(tucked[0] >= layers[0].n, 'the shirt is pulled in by the jacket');
});

test('tuckUnder pulls in only what an outer layer covers, and leaves the rest where it was', () => {
  const grid = (z, x0, x1) => {
    const g = new BufferGeometry(), pos = [], nor = [];
    for (let x = x0; x <= x1; x += 0.02) { pos.push(x, 0, z); nor.push(0, 0, 1); }
    g.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3));
    g.setAttribute('normal', new BufferAttribute(Float32Array.from(nor), 3));
    return g;
  };
  const inner = grid(0, -0.2, 0.2), outer = grid(0.01, -0.2, 0);
  tuckUnder([inner, outer], { reach: 0.03, depth: 0.016 });
  const P = inner.attributes.position.array;
  for (let i = 0; i < P.length / 3; i++) {
    const x = -0.2 + i * 0.02;
    const covered = x <= 0.03 + 1e-9;      // an outer vertex lies within 3 cm (the outer layer ends at x = 0)
    near(P[i * 3 + 2], covered ? -0.016 : 0, 1e-7, `x = ${x.toFixed(2)}`);
    near(P[i * 3], x, 1e-6);
  }
  const O = outer.attributes.position.array;
  assert.ok(O.every((v, i) => (i % 3 === 2 ? Math.abs(v - 0.01) < 1e-7 : true)), 'the outer layer is not touched');
});

test('materials follow the part kinds, the tint and the hair colour of the character', async () => {
  const c = character(), { info } = c;
  const h = await load(c);
  const m = h.materials;
  assert.equal(m.skin.medType, 'skin');
  assert.ok(m.skin.map instanceof Texture && m.skin.map.image.width === 8, 'the skin texture came from the file');
  near(m.skin.color.g, 0.92, 1e-6, 'skin tint');
  assert.equal(m.eyes.medType, 'eye'); assert.equal(m.eyes.alphaTest, 0.5);
  for (const k of ['brows', 'lashes', 'hair']) { assert.equal(m[k].medType, 'hair'); assert.equal(m[k].side, DoubleSide); assert.equal(m[k].dither, true); }
  assert.equal(m.teeth.medType, 'skin');
  assert.equal(m.shirt.medType, 'cloth'); assert.equal(m.shirt.detail, 'fabric');
  assert.equal(m.jacket.medType, 'coat'); near(m.jacket.roughness, 0.4, 1e-9); assert.equal(m.jacket.clearcoat, 0.12);
  assert.equal(m.hair.map.name, 'hair.png (recoloured)', 'hair is dyed from its texture');
  // the dye is the character's hairColor: a lighter colour gives lighter pixels
  const mean = (t) => { let s = 0; const d = t.image.data; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); };
  const blond = await load(character({ id: 'blond', meta: { hairColor: [0.8, 0.65, 0.3] } }));
  assert.ok(mean(blond.materials.hair.map) > mean(m.hair.map) * 1.5, `${mean(blond.materials.hair.map)} vs ${mean(m.hair.map)}`);
  assert.equal(h.meta.hairColor.length, 3);
  assert.equal(info.id, 'tess');
});

test('recolorTexture dyes a flat texture to exactly the colour and keeps alpha; humanMaterial builds each kind', () => {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set([200, 150, 100, i % 2 ? 255 : 0], i * 4);
  const tex = new Texture({ width: 4, height: 4, data });
  const out = recolorTexture(tex, [0.2, 0.1, 0.05]);
  const want = [0.2, 0.1, 0.05].map((x) => Math.floor(Math.pow(x, 1 / 2.2) * 255));
  for (let i = 0; i < 16; i++) {
    assert.deepEqual([...out.image.data.subarray(i * 4, i * 4 + 3)], want);
    assert.equal(out.image.data[i * 4 + 3], i % 2 ? 255 : 0);
  }
  assert.equal(out.name, 'texture (recoloured)');
  const keep = recolorTexture(tex, [0, 0, 0], { keep: 1 });
  assert.deepEqual([...keep.image.data.subarray(0, 3)], [200, 150, 100], 'keep = 1 leaves the original');
  const m = humanMaterial({ kind: 'leather', color: [0.1, 0.1, 0.1] });
  assert.equal(m.medType, 'coat'); assert.equal(m.detail, 'leather'); assert.equal(m.wetFactor, 1);
  assert.equal(humanMaterial({ kind: 'skin' }).wetFactor, 0.6);
  assert.equal(humanMaterial({ kind: 'eye' }).wetFactor, 0);
  assert.equal(humanMaterial({ kind: 'batsuit' }).medType, 'batsuit');
  assert.equal(humanMaterial({ kind: 'something else' }).medType, 'cloth');
});

test('a missing texture keeps the colour; strictTextures makes it an error', async () => {
  const c = character();
  rmSync(join(c.dir, 'tex', 'skin.png'));
  const h = await load(c);
  assert.equal(h.materials.skin.map, null, 'no texture, no crash');
  await assert.rejects(load(c, { strictTextures: true }), /skin\.png/);
});

test('files that are not human files, and a missing assets manager, are refused clearly', async () => {
  const c = character();
  await assert.rejects(Human.load({}, c.dir, 'tess'), /pass an AssetManager first/);
  await assert.rejects(load({ dir: c.dir, info: { id: 'nobody' } }), /nobody/);
  const bad = { h: { format: 'something' }, buf: new ArrayBuffer(0) };
  assert.throws(() => new Human(bad, bad), /not med-human files/);
});

test('dispose frees the geometry and the materials', async () => {
  const c = character();
  const h = await load(c);
  let geos = 0, mats = 0;
  for (const m of h.meshes) m.geometry.dispose = () => { geos++; };
  for (const m of Object.values(h.materials)) m.dispose = () => { mats++; };
  h.dispose();
  assert.equal(geos, h.meshes.length);
  assert.equal(mats, Object.keys(h.materials).length);
});

// ----------------------------------------------------------------------------------------------------------------- scan heads

/** A glTF head: a quad skinned to the head bone with `names.length` blendshapes, on pelvis > head > eyes. */
function scanHead(names = FACE_UNITS) {
  const b = new GLTFBuilder();
  const P = b.accessor(new Float32Array([-0.05, 1.62, 0.1, 0.05, 1.62, 0.1, 0.05, 1.72, 0.1, -0.05, 1.72, 0.1]), 'VEC3', { target: 34962 });
  const J = b.accessor(new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4', { target: 34962 });
  const W = b.accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4', { target: 34962 });
  const I = b.accessor(new Uint16Array([0, 1, 2, 0, 2, 3]), 'SCALAR', { target: 34963 });
  const targets = names.map((_, k) => { const d = new Float32Array(12); d[(k % 4) * 3 + 2] = 0.01 * (1 + (k % 3)); return { POSITION: b.accessor(d, 'VEC3') }; });
  b.add('meshes', { name: 'head', extras: { targetNames: [...names] }, weights: new Array(names.length).fill(0), primitives: [{ attributes: { POSITION: P, JOINTS_0: J, WEIGHTS_0: W }, indices: I, targets }] });
  b.node({ name: 'pelvis', translation: [0, 0.95, 0], children: [1] });
  b.node({ name: 'head', translation: [0, 0.65, 0], children: [2, 3] }, false);
  b.node({ name: 'eye_l', translation: [0.032, 0.085, 0.085] }, false);
  b.node({ name: 'eye_r', translation: [-0.032, 0.085, 0.085] }, false);
  const ibm = new Float32Array(64);
  [[0, 0.95, 0], [0, 1.6, 0], [0.032, 1.685, 0.085], [-0.032, 1.685, 0.085]].forEach((t, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -t[0], -t[1], -t[2], 1], i * 16));
  b.add('skins', { joints: [0, 1, 2, 3], inverseBindMatrices: b.accessor(ibm, 'MAT4'), skeleton: 0 });
  b.node({ name: 'headMesh', mesh: 0, skin: 0 });
  return b;
}
async function scanRoot(names) {
  const gltf = await new GLTFLoader({ platform: new NodePlatform() }).parse(scanHead(names).glb(), {});
  const root = new Group();
  for (const ch of [...gltf.scene.children]) root.add(ch);
  return root;
}

test('attachScanHead maps the blendshapes of a scanned head by name and syncs them from the shared weights', async () => {
  const root = await scanRoot();
  const scan = attachScanHead(root);
  assert.deepEqual(scan.missing, []);
  assert.equal(scan.meshes.length, 1);
  assert.ok(scan.bones.pelvis.isBone && scan.bones.head.isBone && scan.bones.eye_l.isBone);
  scan.setUnit('jawOpen', 0.7); scan.setUnit('browInnerUp', 0.3);
  const w = scan.meshes[0].morphTargetInfluences;
  assert.equal(w[24], 0, 'not copied until sync');
  scan.sync();
  near(w[24], 0.7, 1e-6); near(w[FACE_UNITS.indexOf('browInnerUp')], 0.3, 1e-6);
  near(scan.getUnit('jawOpen'), 0.7, 1e-6);
});

test('attachScanHead copes with reordered, prefixed and aliased names and reports what is missing', async () => {
  // reversed order: target k is unit 51 - k
  const rev = attachScanHead(await scanRoot([...FACE_UNITS].reverse()));
  rev.setUnit('jawOpen', 1); rev.sync();
  assert.equal(rev.meshes[0].morphTargetInfluences[51 - 24], 1);
  assert.deepEqual(rev.missing, []);
  // a file-specific prefix, an alias, and a head that has only some of the shapes
  const names = FACE_UNITS.slice(0, 40).map((n) => `Head_BS.${n}`);
  names[24] = 'mouth_open';
  const some = attachScanHead(await scanRoot(names), { aliases: { mouth_open: 'jawOpen' } });
  some.setUnit('jawOpen', 0.4); some.sync();
  near(some.meshes[0].morphTargetInfluences[24], 0.4, 1e-6, 'the alias');
  assert.deepEqual(some.missing, FACE_UNITS.slice(40));
  some.setUnit('eyeBlinkLeft', 1); some.sync();
  near(some.meshes[0].morphTargetInfluences[FACE_UNITS.indexOf('eyeBlinkLeft')], 1, 1e-6, 'the prefix');
  some.setUnit('mouthSmileLeft', 1);                      // not on this head: setting it is harmless
  some.sync();
  assert.equal(some.meshes[0].morphTargetInfluences.length, 40);
});

// ----------------------------------------------------------------------------------------------------------------- an actor in a human

let libraryCache = null;
async function stageHuman({ levels = 1, floor = true } = {}) {
  const c = character();
  const engine = await Engine.create({ platform: new NodePlatform(), render: false, baseUrl: ROOT });
  if (floor) engine.physics.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
  libraryCache ??= await loadClipLibrary(engine.assets, 'assets/anim/humanoid');
  const human = await Human.load(engine.assets, c.dir, c.info.id, { levels });
  const actor = new Actor(human, { clips: libraryCache, rng: seeded(7) });
  engine.add(actor);
  return { engine, actor, human, info: c.info };
}
const run = (engine, seconds, dt = DT) => engine.run(Math.round(seconds / dt), dt, { draw: false });

test('an Actor made of a Human idles, walks and its face weights are the ones the renderer reads', async () => {
  const { engine, actor, human } = await stageHuman();
  assert.ok(actor.face && actor.face.h === human, 'a face system on the human');
  assert.equal(actor.human, human);
  near(actor.height, 1.744, 0.01);
  run(engine, 0.5);
  assert.equal(actor.state, 'idle');
  const bodyPose = (n) => actor.bones[n].getWorldPosition(new Vector3());
  const before = bodyPose('hand_r');
  actor.walkTo([3, 0, 0]);
  run(engine, 2);
  assert.equal(actor.state, 'move');
  assert.ok(bodyPose('hand_r').distanceTo(before) > 1, 'the whole skeleton went along');
  assert.equal(human.body.morphTargetInfluences, human.face, 'one shared array');
  assert.ok(actor.bones.head.getWorldPosition(new Vector3()).x > 1, 'the head is where the walk took it');
  assert.equal(human.skeleton.bones[human.skeleton.bones.indexOf(actor.bones.head)], actor.bones.head, 'the skinned meshes read these very bones');
});

test('emotions and speech move the face units; blinks come on their own', async () => {
  const { engine, actor, human } = await stageHuman();
  run(engine, 0.5);
  actor.emote('happy');
  run(engine, 1.5);
  assert.ok(human.getUnit('mouthSmileLeft') > 0.5 && human.getUnit('mouthSmileRight') > 0.45, 'smiling');
  actor.emote('neutral');
  run(engine, 2);
  assert.ok(human.getUnit('mouthSmileLeft') < 0.05, 'smile gone');
  assert.throws(() => actor.emote('not-an-emotion'), /emotion/i);
  // speech: the jaw works for as long as the line lasts, then closes, and the promise resolves
  const line = actor.say('Hello there, my friend');
  assert.ok(line.duration > 1.5 && line.duration < 3);
  let jaw = 0, t = 0, resolved = null;
  line.then((v) => { resolved = v; });
  while (t < line.duration + 0.3) { engine.tick(DT, false); t += DT; jaw = Math.max(jaw, human.getUnit('jawOpen')); }
  await flush();
  assert.ok(jaw > 0.15, `jaw opened to ${jaw}`);
  assert.equal(resolved, true);
  run(engine, 1);
  assert.ok(human.getUnit('jawOpen') < 0.03, 'mouth closed again');
  // blinks: roughly every two to seven seconds
  let blinks = 0, was = false;
  for (let i = 0; i < 30 / DT; i++) {
    engine.tick(DT, false);
    const b = human.getUnit('eyeBlinkLeft');
    if (b > 0.5 && !was) blinks++;
    was = b > 0.5;
  }
  assert.ok(blinks >= 3 && blinks <= 15, `${blinks} blinks in 30 s`);
});

test('the eyes follow the look-at target through the eye bones, with the small darts of a living face on top', async () => {
  const { engine, actor } = await stageHuman({ floor: false });
  run(engine, 0.5);
  const target = new Vector3(1.5, 1.7, 3);
  actor.lookAt(target);
  run(engine, 1.5);
  for (const n of ['eye_l', 'eye_r']) {
    const eye = actor.bones[n], f = new Vector3(0, 0, 1).applyQuaternion(eye.getWorldQuaternion(new Quaternion()));
    const d = target.clone().sub(eye.getWorldPosition(new Vector3()));
    assert.ok(angleBetween(f, d) < 0.1, `${n} is ${(angleBetween(f, d) * 57.3).toFixed(1)} degrees off`);
  }
  // the darts really are there: over 10 s the eyes move by more than a hair, but never far
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 600; i++) {
    engine.tick(DT, false);
    const eye = actor.bones.eye_l, f = new Vector3(0, 0, 1).applyQuaternion(eye.getWorldQuaternion(new Quaternion()));
    const a = angleBetween(f, target.clone().sub(eye.getWorldPosition(new Vector3())));
    min = Math.min(min, a); max = Math.max(max, a);
  }
  assert.ok(max - min > 0.004, 'the eyes are never perfectly still');
  assert.ok(max < 0.12, `never more than ${(max * 57.3).toFixed(1)} degrees off`);
});

test('a ragdoll made of a Human falls, lies and gets up again', async () => {
  const { engine, actor } = await stageHuman();
  actor.attachCharacter(engine.physics);
  actor.place([0, 0, 0]);
  run(engine, 0.5);
  actor.walkTo([50, 0, 0], { run: true });
  run(engine, 1.5);
  actor.ragdollOn({ impulse: { point: actor.chest(), vector: new Vector3(0, 0, 90) } });
  run(engine, 4);
  assert.ok(actor.bones.pelvis.getWorldPosition(new Vector3()).y < 0.35, 'down');
  const up = actor.ragdollOff();
  let done = null; up.then((v) => { done = v; });
  run(engine, 8); await flush();
  assert.equal(done, true);
  run(engine, 1);
  assert.ok(actor.bones.head.getWorldPosition(new Vector3()).y > 1.45, 'standing again');
  assert.equal(actor.state, 'idle');
});

test('an Actor made of a scanned head drives its blendshapes from emotions and speech', async () => {
  const root = await scanRoot();
  const scan = attachScanHead(root);
  const engine = await Engine.create({ platform: new NodePlatform(), render: false, baseUrl: ROOT });
  const actor = new Actor(scan, { rng: seeded(3), height: 1.75 });
  engine.add(actor);
  const w = scan.meshes[0].morphTargetInfluences;
  actor.emote('surprised');
  run(engine, 1.5);
  assert.ok(w[FACE_UNITS.indexOf('browInnerUp')] > 0.6, `brows ${w[FACE_UNITS.indexOf('browInnerUp')]}`);
  assert.ok(w[FACE_UNITS.indexOf('jawOpen')] > 0.15);
  actor.emote('neutral');
  const line = actor.say('Ah');
  let top = 0;
  for (let i = 0; i < 60; i++) { engine.tick(DT, false); top = Math.max(top, w[FACE_UNITS.indexOf('jawOpen')]); }
  assert.ok(top > 0.1, 'the scan speaks');
  void line;
});
