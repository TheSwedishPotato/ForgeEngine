#!/usr/bin/env node
/**
 * Med Engine Human builder.
 *
 *   node tools/human/build.mjs <recipes.mjs> <outDir>
 *
 * Turns character recipes into the engine's human files, from the CC0 MakeHuman data:
 *   <outDir>/human-base.json + .bin   shared by every character: body topology (quads, uvs),
 *                                     skin weights of the game rig, the 52 ARKit face shapes
 *   <outDir>/<id>.json + .bin         one character: the shaped body, bones, fitted proxies
 *                                     (eyes, brows, lashes, teeth, tongue, hair, clothes), the
 *                                     face shapes carried onto those proxies, materials
 *   <outDir>/tex/*.jpg                textures, re-encoded as JPEG
 *
 * Units: metres, y up, facing +z, feet on y = 0. Subdivision happens at load (src/human/).
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { MH_DATA, MH_ASSETS, readText, parseObj, parseTarget, parseMhclo, parseMhmat, fitProxy, loadJSON, vertexGroups, groupMean, expandRanges } from './mhdata.mjs';
import { shape } from './macro.mjs';

const BODY_VERTS = 13380;
const SCALE = 0.1;   // decimetres -> metres

// ---------------------------------------------------------------------------
// Binary writer: arrays packed into one buffer, described in the JSON header.

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

// ---------------------------------------------------------------------------
// Shared data

const base = parseObj(readText(join(MH_DATA, '3dobjs', 'base.obj')));
const groups = vertexGroups();
const rig = loadJSON(join(MH_DATA, 'rigs', 'standard', 'rig.game_engine.json'));
const rigWeights = loadJSON(join(MH_DATA, 'rigs', 'standard', 'weights.game_engine.json')).weights;

// Bone order: parents before children, plus eye bones of our own.
const boneNames = [];
{
  const names = Object.keys(rig);
  const add = (n) => { if (boneNames.includes(n)) return; const p = rig[n].parent; if (p) add(p); boneNames.push(n); };
  for (const n of names) add(n);
  boneNames.push('eye_l', 'eye_r');
}
const boneIndex = Object.fromEntries(boneNames.map((n, i) => [n, i]));
const boneParent = boneNames.map((n) => (n === 'eye_l' || n === 'eye_r') ? boneIndex.head : rig[n].parent ? boneIndex[rig[n].parent] : -1);

/** Per base vertex: list of [bone, weight] (all 19158, helpers included). */
const vertBones = Array.from({ length: base.pos.length / 3 }, () => []);
for (const [bone, list] of Object.entries(rigWeights)) {
  const bi = boneIndex[bone];
  if (bi === undefined) continue;
  for (const [v, w] of list) vertBones[v].push([bi, w]);
}

function top4(list) {
  const merged = new Map();
  for (const [b, w] of list) merged.set(b, (merged.get(b) ?? 0) + w);
  const s = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = s.reduce((a, [, w]) => a + w, 0) || 1;
  const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  s.forEach(([b, x], i) => { j[i] = b; w[i] = x / sum; });
  if (!s.length) { j[0] = boneIndex.head; w[0] = 1; }
  return { j, w };
}

// Body faces (group "body") as n-gons over body vertices.
const bodyFaces = base.faces.filter((f) => f.group === 'body');

// The 52 ARKit face units (faceunits01 pack). Some lines are body vertices, some helpers.
const FACE_DIR = join(MH_ASSETS, 'faceunits01', 'targets', 'faceunits');
const faceUnitNames = readdirSync(FACE_DIR).filter((f) => f.endsWith('.target')).map((f) => f.replace('.target', '')).sort();
const faceUnits = faceUnitNames.map((n) => parseTarget(readText(join(FACE_DIR, n + '.target'))));

// ---------------------------------------------------------------------------
// Helpers

function toMeters(pos, groundY) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) { out[i] = pos[i] * SCALE; out[i + 1] = (pos[i + 1] - groundY) * SCALE; out[i + 2] = pos[i + 2] * SCALE; }
  return out;
}

function facesToArrays(faces, key = 'v') {
  const start = [], idx = [];
  for (const f of faces) { start.push(idx.length); idx.push(...f[key]); }
  start.push(idx.length);
  return { start: Uint32Array.from(start), idx: Uint32Array.from(idx) };
}

const texDone = new Map();
/** Re-encodes a texture as WebP (alpha kept where asked), at most maxSize on a side. */
function texture(srcPath, outDir, { quality = 86, maxSize = 2048, keepAlpha = false } = {}) {
  if (!srcPath || !existsSync(srcPath)) return null;
  const key = srcPath + ':' + maxSize;
  if (texDone.has(key)) return texDone.get(key);
  const name = basename(srcPath).replace(/\.(png|jpg|jpeg)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') + (maxSize < 2048 ? '_' + maxSize : '') + '.webp';
  mkdirSync(join(outDir, 'tex'), { recursive: true });
  const out = join(outDir, 'tex', name);
  if (!existsSync(out)) execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1])
keep = sys.argv[4] == '1'
im = im.convert('RGBA' if keep else 'RGB')
m = int(sys.argv[3])
if max(im.size) > m: im = im.resize((m, m * im.size[1] // im.size[0]), Image.LANCZOS)
im.save(sys.argv[2], 'WEBP', quality=int(sys.argv[5]), method=6, alpha_quality=90)
`, srcPath, out, String(maxSize), keepAlpha ? '1' : '0', String(quality)]);
  const rel = 'tex/' + name;
  texDone.set(key, rel);
  return rel;
}

export const credits = new Map();   // asset -> pack (license is in the pack name: _cc0 / _ccby / _cc-by)
function assetPath(kind, name, ext) {
  // kind/name/name.ext inside any extracted pack
  for (const pack of readdirSync(MH_ASSETS)) {
    for (const p of [join(MH_ASSETS, pack, kind, name, name + ext), join(MH_ASSETS, pack, pack, kind, name, name + ext)]) if (existsSync(p)) { credits.set(`${kind}/${name}`, pack); return p; }
  }
  throw new Error(`asset not found: ${kind}/${name}${ext}`);
}

function findSkin(spec) {
  if (spec.endsWith('.mhmat')) return join(MH_ASSETS, spec);
  return assetPath('skins', spec, '.mhmat');
}

// ---------------------------------------------------------------------------
// Shared base file

export function writeBase(outDir) {
  const pk = new Pack();
  const uvF = Float32Array.from(base.uv);
  const f = facesToArrays(bodyFaces, 'v'), t = facesToArrays(bodyFaces, 't');
  const joints = new Uint8Array(BODY_VERTS * 4), weights = new Float32Array(BODY_VERTS * 4);
  for (let v = 0; v < BODY_VERTS; v++) { const { j, w } = top4(vertBones[v]); joints.set(j, v * 4); weights.set(w, v * 4); }
  // Face units on body vertices only (proxies get theirs per character), metres.
  const morphs = faceUnits.map((tg, k) => {
    const idx = [], d = [];
    for (let i = 0; i < tg.idx.length; i++) {
      if (tg.idx[i] >= BODY_VERTS) continue;
      idx.push(tg.idx[i]); d.push(tg.d[i * 3] * SCALE, tg.d[i * 3 + 1] * SCALE, tg.d[i * 3 + 2] * SCALE);
    }
    return { name: faceUnitNames[k], idx: pk.add(Uint32Array.from(idx)), d: pk.add(Float32Array.from(d)) };
  });
  // The mirror table (left/right vertex pairs), for symmetric garment work at load.
  const header = {
    format: 'med-human-base', version: 1, bodyVerts: BODY_VERTS,
    bones: boneNames, parents: boneParent,
    uv: pk.add(uvF), faceStart: pk.add(f.start), faceV: pk.add(f.idx), faceT: pk.add(t.idx),
    joints: pk.add(joints), weights: pk.add(weights),
    morphs,
    license: 'Derived from the MakeHuman/MPFB CC0 base mesh, rig, weights and faceunits01 targets.',
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'human-base.binz'), gzipSync(pk.bytes(), { level: 9 }));
  writeFileSync(join(outDir, 'human-base.json'), JSON.stringify(header));
}

// ---------------------------------------------------------------------------
// One character

const PROXY_KIND = { eyes: 'eye', eyebrows: 'brow', eyelashes: 'lash', teeth: 'teeth', tongue: 'tongue', hair: 'hair', clothes: 'cloth' };

export function buildCharacter(r, outDir) {
  const pos = shape(base.pos, r.macro, r.details ?? {});
  // Ground: the lowest body vertex (before shoes).
  let minY = Infinity;
  for (let v = 0; v < BODY_VERTS; v++) minY = Math.min(minY, pos[v * 3 + 1]);
  const pk = new Pack();
  const header = { format: 'med-human', version: 1, id: r.id, name: r.name ?? r.id, proxies: [], materials: {}, meta: r.meta ?? {} };

  // Bones: heads at the means of their joint cubes; eye bones at the eye joints.
  const heads = [];
  for (const n of boneNames) {
    let cube;
    if (n === 'eye_l') cube = 'joint-l-eye';
    else if (n === 'eye_r') cube = 'joint-r-eye';
    else cube = rig[n].head.cube_name;
    const m = groups[cube] ? groupMean(pos, groups[cube]) : rig[n].head.default_position;
    heads.push(m[0] * SCALE, (m[1] - minY) * SCALE, m[2] * SCALE);
  }
  header.boneHeads = pk.add(Float32Array.from(heads));

  // Proxies
  const deleted = new Set();
  const list = [];
  const eyesName = r.eyes?.proxy ?? 'high-poly';
  const eyesFile = assetPath('eyes', eyesName, '.mhclo');
  list.push({ kind: 'eyes', file: eyesFile, material: join(dirnameOf(dirnameOf(eyesFile)), 'materials', (r.eyes?.material ?? 'brown') + '.mhmat') });
  if (r.brows) list.push({ kind: 'eyebrows', file: assetPath('eyebrows', r.brows, '.mhclo') });
  if (r.lashes !== null) list.push({ kind: 'eyelashes', file: assetPath('eyelashes', r.lashes ?? 'eyelashes01', '.mhclo') });
  list.push({ kind: 'teeth', file: assetPath('teeth', r.teeth ?? 'teeth_base', '.mhclo') });
  list.push({ kind: 'tongue', file: assetPath('tongue', 'tongue01', '.mhclo') });
  if (r.hair) list.push({ kind: 'hair', file: assetPath('hair', r.hair, '.mhclo') });
  for (const c of r.clothes ?? []) list.push({ kind: 'clothes', file: assetPath('clothes', typeof c === 'string' ? c : c.name, '.mhclo'), opts: typeof c === 'string' ? {} : c });

  for (const p of list) {
    const clo = parseMhclo(p.file);
    if (!(p.opts?.keepBody)) for (const v of clo.deleteVerts) deleted.add(v);
    const obj = parseObj(readText(clo.obj));
    const fitted = fitProxy(clo, pos);
    const n = fitted.length / 3;
    const P = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { P[i * 3] = fitted[i * 3] * SCALE; P[i * 3 + 1] = (fitted[i * 3 + 1] - minY) * SCALE; P[i * 3 + 2] = fitted[i * 3 + 2] * SCALE; }
    // Skin weights from the three reference vertices; eyes ride their own bones.
    const J = new Uint8Array(n * 4), W = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      let res;
      if (p.kind === 'eyes') {
        const side = P[i * 3] > 0 ? 'eye_l' : 'eye_r';
        res = { j: [boneIndex[side], 0, 0, 0], w: [1, 0, 0, 0] };
      } else {
        const ref = clo.refs[i], acc = [];
        for (let k = 0; k < 3; k++) for (const [b, w] of vertBones[ref.v[k]]) acc.push([b, w * ref.w[k]]);
        res = top4(acc.length ? acc : [[boneIndex.head, 1]]);
      }
      J.set(res.j, i * 4); W.set(res.w, i * 4);
    }
    // Face units carried onto the proxy through its binding (not eyes: they turn on bones).
    const morphs = [];
    if (p.kind !== 'eyes' && p.kind !== 'hair' && p.kind !== 'clothes') {
      faceUnits.forEach((tg, k) => {
        const dmap = new Map();
        for (let i = 0; i < tg.idx.length; i++) dmap.set(tg.idx[i], i);
        const idx = [], d = [];
        for (let i = 0; i < n; i++) {
          const ref = clo.refs[i];
          let x = 0, y = 0, z = 0, any = false;
          for (let c = 0; c < 3; c++) {
            const j = dmap.get(ref.v[c]);
            if (j === undefined) continue;
            any = true;
            x += tg.d[j * 3] * ref.w[c]; y += tg.d[j * 3 + 1] * ref.w[c]; z += tg.d[j * 3 + 2] * ref.w[c];
          }
          if (any && (x || y || z)) { idx.push(i); d.push(x * SCALE, y * SCALE, z * SCALE); }
        }
        if (idx.length) morphs.push({ unit: k, idx: pk.add(Uint32Array.from(idx)), d: pk.add(Float32Array.from(d)) });
      });
    }
    const fv = facesToArrays(obj.faces, 'v'), ft = facesToArrays(obj.faces, 't');
    const matPath = p.material ?? clo.material;
    const mat = matPath && existsSync(matPath) ? parseMhmat(matPath) : {};
    const matName = `${p.kind}:${clo.name || basename(p.file, '.mhclo')}`;
    header.materials[matName] = materialFor(PROXY_KIND[p.kind], mat, outDir, p.opts ?? {});
    header.proxies.push({
      name: clo.name || basename(p.file, '.mhclo'), kind: PROXY_KIND[p.kind], material: matName,
      subdivide: p.kind === 'clothes' && !clo.tags.includes('hair'),
      zDepth: clo.zDepth,
      position: pk.add(P), uv: pk.add(Float32Array.from(obj.uv)), faceStart: pk.add(fv.start), faceV: pk.add(fv.idx), faceT: pk.add(ft.idx),
      joints: pk.add(J), weights: pk.add(W), morphs,
    });
  }

  // Body
  header.body = pk.add(toMeters(pos.subarray(0, BODY_VERTS * 3), minY));
  // Faces hidden under clothes: any face with a deleted vertex.
  const hidden = [];
  bodyFaces.forEach((f, i) => { if (f.v.some((v) => deleted.has(v))) hidden.push(i); });
  header.hiddenFaces = pk.add(Uint32Array.from(hidden));
  const skin = parseMhmat(findSkin(r.skin));
  header.materials.skin = materialFor('skin', skin, outDir, r.skinOpts ?? {});
  header.credits = [...credits.entries()].map(([asset, pack]) => ({ asset, pack, license: /cc-?by/i.test(pack) ? 'CC-BY 4.0' : 'CC0' }));
  credits.clear();
  header.height = Math.max(...Array.from({ length: BODY_VERTS }, (_, v) => pos[v * 3 + 1])) * SCALE - minY * SCALE;
  writeFileSync(join(outDir, `${r.id}.binz`), gzipSync(pk.bytes(), { level: 9 }));
  writeFileSync(join(outDir, `${r.id}.json`), JSON.stringify(header));
  return header;
}

function dirnameOf(p) { return p.slice(0, p.lastIndexOf('/')); }

function materialFor(kind, mat, outDir, opts) {
  const alpha = kind === 'hair' || kind === 'brow' || kind === 'lash' || kind === 'eye';
  const m = { kind };
  const big = kind === 'skin' ? 2048 : kind === 'eye' ? 512 : kind === 'brow' || kind === 'lash' || kind === 'teeth' || kind === 'tongue' ? 512 : 1024;
  if (mat.diffuseTexture) m.map = texture(mat.diffuseTexture, outDir, { keepAlpha: alpha, maxSize: big, quality: kind === 'skin' ? 90 : 86 });
  if (mat.normalmapTexture) m.normalMap = texture(mat.normalmapTexture, outDir, { quality: 90, maxSize: big });
  if (mat.specularmapTexture) m.specMap = texture(mat.specularmapTexture, outDir, { quality: 85, maxSize: 1024 });
  if (mat.aomapTexture) m.aoMap = texture(mat.aomapTexture, outDir, { quality: 85, maxSize: 1024 });
  if (mat.diffuseColor) m.color = mat.diffuseColor.split(/\s+/).map(Number);
  Object.assign(m, opts.material ?? {});
  return m;
}

// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [recipesPath, outDir] = process.argv.slice(2);
  if (!recipesPath || !outDir) { console.error('usage: build.mjs <recipes.mjs> <outDir>'); process.exit(1); }
  const { RECIPES } = await import(pathToFileURL(resolve(recipesPath)).href);
  writeBase(outDir);
  const only = process.env.ONLY?.split(',');
  for (const r of RECIPES) {
    if (only && !only.includes(r.id)) continue;
    const t0 = Date.now();
    const h = buildCharacter(r, outDir);
    console.log(`${r.id}: height ${h.height.toFixed(2)} m, ${h.proxies.length} proxies (${Date.now() - t0} ms)`);
  }
}

void expandRanges;
