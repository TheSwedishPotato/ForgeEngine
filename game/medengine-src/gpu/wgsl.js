/**
 * WGSL helpers: a small preprocessor and a struct layout generator.
 *
 * Preprocessor directives (each on its own line):
 *   #ifdef NAME / #ifndef NAME / #else / #endif     conditional on a define (value not false/0/undefined)
 *   #if EXPR                                        EXPR: NAME, !NAME, NAME && NAME, NAME || NAME, defined(NAME)
 *   #include name                                  pastes a registered chunk (see `chunks`)
 * Defines are passed per pipeline; they also become `const NAME = value;` for numbers.
 *
 * Struct layouts follow WGSL's host-shareable rules (uniform address space), so the same
 * definition yields both the WGSL text and the byte offsets used to fill a buffer.
 */

export const chunks = new Map();
export function registerChunk(name, source) { chunks.set(name, source); }

const truthy = (defs, n) => { const v = defs[n]; return v !== undefined && v !== false && v !== 0 && v !== null; };

function evalCond(expr, defs) {
  expr = expr.trim();
  if (expr.includes('||')) return expr.split('||').some((e) => evalCond(e, defs));
  if (expr.includes('&&')) return expr.split('&&').every((e) => evalCond(e, defs));
  let m;
  if ((m = /^!\s*(.+)$/.exec(expr))) return !evalCond(m[1], defs);
  if ((m = /^defined\(\s*(\w+)\s*\)$/.exec(expr))) return truthy(defs, m[1]);
  if ((m = /^\((.+)\)$/.exec(expr))) return evalCond(m[1], defs);
  if (/^\w+$/.test(expr)) return truthy(defs, expr);
  throw new Error(`WGSL preprocessor: cannot evaluate "#if ${expr}"`);
}

export function preprocess(source, defines = {}, depth = 0) {
  if (depth > 8) throw new Error('WGSL preprocessor: #include nesting too deep');
  const out = [];
  const stack = []; // each: { active, taken, parentActive }
  const active = () => stack.every((s) => s.active);
  const lines = source.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln], t = line.trim();
    if (t.startsWith('#')) {
      let m;
      if ((m = /^#ifdef\s+(\w+)/.exec(t))) { const c = truthy(defines, m[1]); stack.push({ active: c, taken: c }); continue; }
      if ((m = /^#ifndef\s+(\w+)/.exec(t))) { const c = !truthy(defines, m[1]); stack.push({ active: c, taken: c }); continue; }
      if ((m = /^#if\s+(.+)$/.exec(t))) { const c = evalCond(m[1], defines); stack.push({ active: c, taken: c }); continue; }
      if ((m = /^#elif\s+(.+)$/.exec(t))) { const s = stack[stack.length - 1]; const c = !s.taken && evalCond(m[1], defines); s.active = c; s.taken ||= c; continue; }
      if (/^#else\b/.test(t)) { const s = stack[stack.length - 1]; s.active = !s.taken; s.taken = true; continue; }
      if (/^#endif\b/.test(t)) { if (!stack.length) throw new Error(`WGSL preprocessor: stray #endif at line ${ln + 1}`); stack.pop(); continue; }
      if ((m = /^#include\s+([\w./-]+)/.exec(t))) {
        if (!active()) continue;
        const chunk = chunks.get(m[1]);
        if (chunk === undefined) throw new Error(`WGSL preprocessor: unknown #include ${m[1]}`);
        out.push(preprocess(typeof chunk === 'function' ? chunk(defines) : chunk, defines, depth + 1));
        continue;
      }
    }
    if (active()) out.push(line);
  }
  if (stack.length) throw new Error('WGSL preprocessor: missing #endif');
  return out.join('\n');
}

/** Prepends `const NAME = value;` for numeric / boolean defines, then preprocesses. */
export function buildShader(source, defines = {}) {
  let head = '';
  for (const [k, v] of Object.entries(defines)) {
    if (typeof v === 'number') head += `const ${k}: ${Number.isInteger(v) ? 'i32' : 'f32'} = ${v};\n`;
  }
  return head + preprocess(source, defines);
}

// ---------------------------------------------------------------------------
// Struct layouts

const SCALAR = { f32: [4, 4, 1], u32: [4, 4, 1], i32: [4, 4, 1] };   // [align, size, components]
const TYPES = {
  ...SCALAR,
  vec2f: [8, 8, 2], vec3f: [16, 12, 3], vec4f: [16, 16, 4],
  vec2u: [8, 8, 2], vec3u: [16, 12, 3], vec4u: [16, 16, 4],
  vec2i: [8, 8, 2], vec3i: [16, 12, 3], vec4i: [16, 16, 4],
  mat3x3f: [16, 48, 12], mat4x4f: [16, 64, 16],
};
const WGSL_NAME = {
  f32: 'f32', u32: 'u32', i32: 'i32', vec2f: 'vec2<f32>', vec3f: 'vec3<f32>', vec4f: 'vec4<f32>',
  vec2u: 'vec2<u32>', vec3u: 'vec3<u32>', vec4u: 'vec4<u32>', vec2i: 'vec2<i32>', vec3i: 'vec3<i32>', vec4i: 'vec4<i32>',
  mat3x3f: 'mat3x3<f32>', mat4x4f: 'mat4x4<f32>',
};

/**
 * Where one field of a struct sits.
 * @typedef {object} StructField
 * @property {number} offset  bytes from the start of the struct
 * @property {string} type    the WGSL type ('f32', 'vec3f', 'mat4x4f' ...)
 * @property {number} count   array length (0 for a single value)
 * @property {number} stride  bytes between array elements (the size of a single value otherwise)
 * @property {number} comps   components of the type (1 for f32, 3 for vec3f ...)
 */

/**
 * What struct() makes: the WGSL source of the struct, its size and where each field sits, and a writer for filling it.
 * @typedef {object} StructDef
 * @property {string} name
 * @property {number} size    bytes, rounded up to the struct's alignment
 * @property {string} wgsl    the WGSL source of the struct
 * @property {Record<string, StructField>} offsets
 * @property {(f32: Float32Array, u32?: Uint32Array | null, i32?: Int32Array | null) => (byteOffset: number) => StructWriter} writer
 *   a writer over a buffer's contents: `def.writer(f32, u32, i32)(byteOffset).set('time', 1.5)`
 */

/**
 * What a struct field can be set to: a number or boolean, an array or typed array of the field's components, a matrix, vector or colour
 * from the math module, or (for an array field) a flat array that fills the elements in turn.
 * @typedef {number | boolean | ArrayLike<number> | { elements: ArrayLike<number> } | { r: number, g: number, b: number } | { x: number, y: number, z?: number, w?: number }} StructValue
 */

/**
 * Fills one struct instance in a buffer.
 * @typedef {object} StructWriter
 * @property {(field: string, value: StructValue, index?: number) => StructWriter} set  writes a field (`index` picks the element of an array field); returns the writer
 */

/**
 * struct('Frame', [['viewProj', 'mat4x4f'], ['cameraPos', 'vec3f'], ['time', 'f32'], ['lights', 'vec4f', 8]])
 * -> { name, size, wgsl, offsets, writer(f32, u32?, i32?) }
 * A 3rd element makes an array (stride rounded up to 16 as the uniform address space requires).
 * @param {string} name  the WGSL struct's name
 * @param {[string, string, number?][]} fields  [field name, WGSL type ('f32', 'vec3f', 'mat4x4f' ...), array length?]
 * @returns {StructDef}
 */
export function struct(name, fields) {
  let off = 0, maxAlign = 4;
  const members = [], offsets = {};
  for (const [fname, type, count] of fields) {
    const t = TYPES[type];
    if (!t) throw new Error(`struct ${name}: unknown type ${type}`);
    let [align, size] = t;
    if (count) {
      const stride = Math.ceil(size / 16) * 16;
      align = 16;
      off = Math.ceil(off / align) * align;
      offsets[fname] = { offset: off, type, count, stride, comps: t[2] };
      members.push(`  ${fname}: array<${WGSL_NAME[type]}, ${count}>,`);
      off += stride * count;
    } else {
      off = Math.ceil(off / align) * align;
      offsets[fname] = { offset: off, type, count: 0, stride: size, comps: t[2] };
      members.push(`  ${fname}: ${WGSL_NAME[type]},`);
      off += size;
    }
    maxAlign = Math.max(maxAlign, align);
  }
  const size = Math.ceil(off / maxAlign) * maxAlign;
  const wgsl = `struct ${name} {\n${members.join('\n')}\n}`;
  return {
    name, size, wgsl, offsets,
    /**
     * A writer over [buffer, byteOffset]: `w.set('time', 1.5)`, `w.set('viewProj', matrix4)`, `w.set('lights', float32Array)`.
     * @param {Float32Array} f32  the buffer's bytes as floats
     * @param {Uint32Array | null} [u32]  the same bytes as unsigned integers (needed when the struct has u32 / vecNu fields)
     * @param {Int32Array | null} [i32]   the same bytes as signed integers (needed for i32 / vecNi fields)
     * @returns {(byteOffset: number) => StructWriter}
     */
    writer(f32, u32 = null, i32 = null) {
      return (byteOffset) => ({
        set(field, value, index = 0) {
          const o = offsets[field];
          if (!o) throw new Error(`struct ${name}: no field ${field}`);
          const base = (byteOffset + o.offset + (o.count ? o.stride * index : 0)) >> 2;
          const isInt = o.type.endsWith('u') || o.type === 'u32', isSigned = o.type.endsWith('i') || o.type === 'i32';
          const dst = isInt ? u32 : isSigned ? i32 : f32;
          if (typeof value === 'number' || typeof value === 'boolean') { dst[base] = +value; return this; }
          if (o.type === 'mat3x3f') {
            const e = value.elements ?? value;
            if (e.length === 9) { for (let c = 0; c < 3; c++) { dst[base + c * 4] = e[c * 3]; dst[base + c * 4 + 1] = e[c * 3 + 1]; dst[base + c * 4 + 2] = e[c * 3 + 2]; } }
            else for (let i = 0; i < 12; i++) dst[base + i] = e[i];
            return this;
          }
          if (value.elements) { for (let i = 0; i < value.elements.length; i++) dst[base + i] = value.elements[i]; return this; }
          if (value.isColor) { dst[base] = value.r; dst[base + 1] = value.g; dst[base + 2] = value.b; return this; }
          if (value.isVector2 || value.isVector3 || value.isVector4) { dst[base] = value.x; dst[base + 1] = value.y; if (o.comps > 2) dst[base + 2] = value.z; if (o.comps > 3) dst[base + 3] = value.w; return this; }
          // arrays: for array fields, `value` fills consecutive elements of `stride` bytes (comps used per element)
          if (o.count) {
            const per = o.comps, stride = o.stride >> 2, n = Math.min(o.count, Math.floor(value.length / per));
            for (let i = 0; i < n; i++) for (let k = 0; k < per; k++) dst[(byteOffset + o.offset >> 2) + i * stride + k] = value[i * per + k];
            return this;
          }
          for (let i = 0; i < value.length; i++) dst[base + i] = value[i];
          return this;
        },
      });
    },
  };
}
