/**
 * Readers for the MakeHuman / MPFB data formats (all CC0 data, read as data, nothing executed):
 *   base.obj           the hm08 base mesh (decimetres, y up, facing +z), body + helper geometry
 *   *.target(.gz)      sparse vertex offsets: "index dx dy dz" per line
 *   *.mhclo            a proxy (clothes, hair, eyes, eyebrows...) bound to the base mesh: every proxy
 *                      vertex is a weighted sum of three base vertices plus a scaled offset
 *   *.mhmat            material key/value text
 *   rig.*.json         bones whose head/tail are the mean of a "joint cube" vertex group
 *   weights.*.json     per-bone lists of [vertex, weight]
 */
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';

export const MH_DATA = process.env.MH_DATA ?? '/opt/tools/mpfb2/src/mpfb/data';
export const MH_ASSETS = process.env.MH_ASSETS ?? '/opt/tools/mh/x';

export function readText(path) {
  if (existsSync(path)) {
    const buf = readFileSync(path);
    return (path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
  }
  if (existsSync(path + '.gz')) return gunzipSync(readFileSync(path + '.gz')).toString('utf8');
  throw new Error(`missing ${path}`);
}

/** Parses an OBJ into positions, uvs, and faces (each face: {v:[...], t:[...], group}). */
export function parseObj(text) {
  const pos = [], uv = [], faces = [];
  let group = 'default';
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const p = line.split(/\s+/); pos.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('vt ')) { const p = line.split(/\s+/); uv.push(+p[1], +p[2]); }
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1);
      const v = [], t = [];
      for (const c of p) { const [a, b] = c.split('/'); v.push(+a - 1); t.push(b ? +b - 1 : +a - 1); }
      faces.push({ v, t, group });
    }
  }
  return { pos: Float64Array.from(pos), uv: Float64Array.from(uv), faces };
}

export function parseTarget(text) {
  const idx = [], d = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s[0] === '#') continue;
    const p = s.split(/\s+/);
    if (p.length < 4) continue;
    idx.push(+p[0]); d.push(+p[1], +p[2], +p[3]);
  }
  return { idx: Int32Array.from(idx), d: Float64Array.from(d) };
}

export function loadTarget(rel) {
  const path = rel.startsWith('/') ? rel : join(MH_DATA, 'targets', rel + (rel.endsWith('.target') ? '' : '.target'));
  return parseTarget(readText(path));
}

export function applyTarget(pos, t, w) {
  if (!w) return;
  for (let i = 0; i < t.idx.length; i++) {
    const v = t.idx[i] * 3;
    pos[v] += t.d[i * 3] * w; pos[v + 1] += t.d[i * 3 + 1] * w; pos[v + 2] += t.d[i * 3 + 2] * w;
  }
}

/** Parses an .mhmat into a map (texture paths resolved against the file's folder). */
export function parseMhmat(path) {
  const out = { _dir: dirname(path) };
  for (const line of readText(path).split('\n')) {
    const s = line.trim();
    if (!s || s[0] === '#') continue;
    const i = s.indexOf(' ');
    const k = i < 0 ? s : s.slice(0, i), v = i < 0 ? '' : s.slice(i + 1).trim();
    if (k === 'tag' || k === 'shaderConfig' || k === 'shaderParam') continue;
    out[k] = /Texture$/.test(k) ? join(dirname(path), v) : v;
  }
  return out;
}

/** Parses an .mhclo proxy definition. */
export function parseMhclo(path) {
  const text = readText(path);
  const dir = dirname(path);
  const out = { dir, name: '', obj: null, material: null, scale: {}, refs: [], deleteVerts: [], zDepth: 50, tags: [] };
  let mode = null;
  for (const raw of text.split('\n')) {
    const s = raw.trim();
    if (!s || s[0] === '#') continue;
    if (s === 'verts 0' || s.startsWith('verts ')) { mode = 'verts'; continue; }
    if (s === 'delete_verts') { mode = 'delete'; continue; }
    if (mode === 'verts') {
      const p = s.split(/\s+/);
      if (/^[0-9]/.test(p[0]) && (p.length === 9 || p.length === 1 || p.length === 4)) {
        if (p.length === 1) out.refs.push({ v: [+p[0], +p[0], +p[0]], w: [1, 0, 0], o: [0, 0, 0] });
        else if (p.length === 9) out.refs.push({ v: [+p[0], +p[1], +p[2]], w: [+p[3], +p[4], +p[5]], o: [+p[6], +p[7], +p[8]] });
        continue;
      }
      // a key line inside the vertex list (e.g. "material ..."): parse it, stay in verts mode
    }
    if (mode === 'delete') {
      if (/^[0-9]/.test(s)) {
        const toks = s.split(/\s+/);
        for (let i = 0; i < toks.length; i++) {
          if (toks[i + 1] === '-') { for (let k = +toks[i]; k <= +toks[i + 2]; k++) out.deleteVerts.push(k); i += 2; }
          else if (toks[i] !== '-') out.deleteVerts.push(+toks[i]);
        }
        continue;
      }
      mode = null;
    }
    const i = s.indexOf(' ');
    const k = i < 0 ? s : s.slice(0, i), v = i < 0 ? '' : s.slice(i + 1).trim();
    if (k === 'name') out.name = v;
    else if (k === 'obj_file') out.obj = join(dir, v);
    else if (k === 'material') out.material = join(dir, v);
    else if (k === 'x_scale' || k === 'y_scale' || k === 'z_scale') { const p = v.split(/\s+/); out.scale[k[0]] = [+p[0], +p[1], +p[2]]; }
    else if (k === 'z_depth') out.zDepth = +v;
    else if (k === 'tag') out.tags.push(v.toLowerCase());
  }
  return out;
}

/**
 * Fits a proxy to the (morphed) base mesh positions: v = sum(w_i * B[ref_i]) + offset * scale,
 * where scale per axis is the distance between two reference vertices over the stored value.
 */
export function fitProxy(mhclo, basePos) {
  const sc = (axis, comp) => {
    const s = mhclo.scale[axis];
    if (!s) return 1;
    return Math.abs(basePos[s[0] * 3 + comp] - basePos[s[1] * 3 + comp]) / s[2];
  };
  const sx = sc('x', 0), sy = sc('y', 1), sz = sc('z', 2);
  const n = mhclo.refs.length;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = mhclo.refs[i];
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = r.w[0] * basePos[r.v[0] * 3 + c] + r.w[1] * basePos[r.v[1] * 3 + c] + r.w[2] * basePos[r.v[2] * 3 + c];
    }
    out[i * 3] += r.o[0] * sx; out[i * 3 + 1] += r.o[1] * sy; out[i * 3 + 2] += r.o[2] * sz;
  }
  return out;
}

export function loadJSON(path) { return JSON.parse(readText(path)); }

export function vertexGroups() {
  return loadJSON(join(MH_DATA, 'mesh_metadata', 'basemesh_vertex_groups.json'));
}

/** Expands [[a,b],...] inclusive ranges into an index list. */
export function expandRanges(ranges) {
  const out = [];
  for (const [a, b] of ranges) for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function groupMean(pos, ranges) {
  const idx = expandRanges(ranges);
  const m = [0, 0, 0];
  for (const i of idx) { m[0] += pos[i * 3]; m[1] += pos[i * 3 + 1]; m[2] += pos[i * 3 + 2]; }
  return m.map((x) => x / idx.length);
}
