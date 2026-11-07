/**
 * Wavefront OBJ / MTL: the format every modelling tool can still write.
 *
 *   const { group, materialLibraries } = parseOBJ(text);
 *
 * Supports v / vt / vn (and vertex colours `v x y z r g b`), faces of any size (fans) with negative indices, `o` / `g` names, `usemtl`.
 * One Mesh per object / material change. Without normals they are computed (smooth); OBJ has a bottom-left UV origin, so textures
 * for OBJ models are loaded with `flipY = true` (the AssetManager does that).
 */
import { Group } from '../scene/Object3D.js';
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from '../scene/Geometry.js';
import { Mesh } from '../scene/Mesh.js';
import { StandardMaterial } from '../scene/Material.js';

/**
 * @param {string} text
 * @param {object} [o]
 * @param {Map<string, StandardMaterial>|Record<string, StandardMaterial>} [o.materials]  by `usemtl` name (from parseMTL)
 * @param {number} [o.scale]  multiply all positions (many files are in centimetres: 0.01)
 */
export function parseOBJ(text, { materials = null, scale = 1 } = {}) {
  const P = [], T = [], N = [], C = [];
  const libs = [];
  let hasColor = false;
  const parts = [];
  let cur = null, objectName = '', matName = '';
  const start = () => {
    cur = { name: objectName || `object${parts.length}`, material: matName, map: new Map(), pos: [], uv: [], nor: [], col: [], idx: [], hasN: false, hasT: false, missingN: false };
    parts.push(cur);
  };
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln];
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;
    // a trailing backslash continues the line
    while (line.endsWith('\\') && ln + 1 < lines.length) line = line.slice(0, -1) + ' ' + lines[++ln].trim();
    const t = line.split(/\s+/), k = t[0];
    if (k === 'v') {
      P.push(+t[1] * scale, +t[2] * scale, +t[3] * scale);
      if (t.length >= 7) { C.push(+t[4], +t[5], +t[6]); hasColor = true; } else C.push(1, 1, 1);
    } else if (k === 'vt') T.push(+t[1], t[2] === undefined ? 0 : +t[2]);
    else if (k === 'vn') N.push(+t[1], +t[2], +t[3]);
    else if (k === 'o' || k === 'g') { objectName = t.slice(1).join(' '); cur = null; }
    else if (k === 'usemtl') { matName = t.slice(1).join(' '); cur = null; }
    else if (k === 'mtllib') libs.push(t.slice(1).join(' '));
    else if (k === 'f') {
      if (!cur) start();
      const corner = [];
      for (let i = 1; i < t.length; i++) {
        const key = t[i];
        let id = cur.map.get(key);
        if (id === undefined) {
          const [a, b, c] = key.split('/');
          const vi = idx(a, P.length / 3), ti = b ? idx(b, T.length / 2) : -1, ni = c ? idx(c, N.length / 3) : -1;
          if (vi < 0 || vi >= P.length / 3) throw new Error(`OBJ line ${ln + 1}: vertex index ${a} is out of range`);
          id = cur.pos.length / 3;
          cur.pos.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]);
          cur.col.push(C[vi * 3], C[vi * 3 + 1], C[vi * 3 + 2]);
          if (ti >= 0) { cur.uv.push(T[ti * 2], T[ti * 2 + 1]); cur.hasT = true; } else cur.uv.push(0, 0);
          if (ni >= 0) { cur.nor.push(N[ni * 3], N[ni * 3 + 1], N[ni * 3 + 2]); cur.hasN = true; } else { cur.nor.push(0, 0, 0); cur.missingN = true; }
          cur.map.set(key, id);
        }
        corner.push(id);
      }
      for (let i = 1; i + 1 < corner.length; i++) cur.idx.push(corner[0], corner[i], corner[i + 1]);
    }
  }
  const mats = materials instanceof Map ? materials : new Map(Object.entries(materials ?? {}));
  const group = new Group();
  for (const p of parts) {
    if (!p.idx.length) continue;
    const g = new BufferGeometry();
    g.name = p.name;
    g.setAttribute('position', new Float32BufferAttribute(p.pos, 3));
    if (p.hasT) g.setAttribute('uv', new Float32BufferAttribute(p.uv, 2));
    if (hasColor) g.setAttribute('color', new Float32BufferAttribute(p.col, 3));
    g.setIndex(new (p.pos.length / 3 > 65535 ? Uint32BufferAttribute : Uint16BufferAttribute)(p.idx, 1));
    if (p.hasN && !p.missingN) g.setAttribute('normal', new Float32BufferAttribute(p.nor, 3));
    else g.computeVertexNormals();
    const base = mats.get(p.material);
    const mat = base ? (hasColor ? Object.assign(base.clone(), { vertexColors: true }) : base) : new StandardMaterial({ roughness: 0.8, metalness: 0, vertexColors: hasColor });
    const mesh = new Mesh(g, mat);
    mesh.name = p.name + (p.material ? `:${p.material}` : '');
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, materialLibraries: libs };
}

function idx(s, n) { const v = parseInt(s, 10); return v < 0 ? n + v : v - 1; }

/**
 * Parses an MTL file into StandardMaterials. Texture maps are returned by name (`textures`: material -> {map, normalMap, ...} file names);
 * load them and assign yourself, or let the AssetManager do it.
 * @returns {{ materials: Map<string, StandardMaterial>, textures: Map<string, Record<string,string>> }}
 */
export function parseMTL(text) {
  const materials = new Map(), textures = new Map();
  let m = null, tex = null;
  for (let line of text.split(/\r?\n/)) {
    const h = line.indexOf('#');
    if (h >= 0) line = line.slice(0, h);
    const t = line.trim().split(/\s+/);
    if (!t[0]) continue;
    const k = t[0].toLowerCase();
    if (k === 'newmtl') { m = new StandardMaterial({ roughness: 0.8, metalness: 0 }); m.name = t.slice(1).join(' '); materials.set(m.name, m); tex = {}; textures.set(m.name, tex); }
    else if (!m) continue;
    else if (k === 'kd') m.color.setRGB(+t[1], +t[2], +t[3]);
    else if (k === 'ke') m.emissive.setRGB(+t[1], +t[2], +t[3]);
    else if (k === 'ns') m.roughness = Math.min(1, Math.max(0.04, 1 - Math.sqrt(Math.max(0, +t[1]) / 1000)));     // Phong exponent -> roughness
    else if (k === 'd') { m.opacity = +t[1]; if (m.opacity < 1) m.transparent = true; }
    else if (k === 'tr') { m.opacity = 1 - +t[1]; if (m.opacity < 1) m.transparent = true; }
    else if (k === 'map_kd') tex.map = t[t.length - 1];
    else if (k === 'map_ke') tex.emissiveMap = t[t.length - 1];
    else if (k === 'map_bump' || k === 'bump' || k === 'norm') tex.normalMap = t[t.length - 1];
    else if (k === 'map_ns') tex.roughnessMap = t[t.length - 1];
  }
  return { materials, textures };
}
