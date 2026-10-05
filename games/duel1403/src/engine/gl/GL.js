/**
 * Med Engine — thin WebGL2 layer: context, programs, textures, render
 * targets, buffers and a fullscreen triangle. Everything above this file
 * talks to these helpers, never to raw GL state directly.
 */

export function createContext(canvas, { preserveDrawingBuffer = false } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  const ext = {
    colorFloat: gl.getExtension('EXT_color_buffer_float'),
    floatLinear: gl.getExtension('OES_texture_float_linear'),
    aniso: gl.getExtension('EXT_texture_filter_anisotropic'),
    multiDraw: gl.getExtension('WEBGL_multi_draw'),
    halfFloatBlend: gl.getExtension('EXT_float_blend'),
  };
  if (!ext.colorFloat) throw new Error('EXT_color_buffer_float is required');
  gl.ext = ext;
  gl.maxAniso = ext.aniso ? gl.getParameter(ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
  return gl;
}

// ---------------------------------------------------------------------------
// Programs

const SAMPLER_TYPES = new Set();
export class Program {
  constructor(gl, vs, fs, defines = {}, name = 'program') {
    this.gl = gl;
    this.name = name;
    const head = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler2DArray;\nprecision highp sampler2DShadow;\nprecision highp sampler2DArrayShadow;\nprecision highp samplerCube;\nprecision highp sampler3D;\n'
      + Object.entries(defines).filter(([, v]) => v !== false && v != null).map(([k, v]) => `#define ${k} ${v === true ? '' : v}`).join('\n') + '\n';
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, head + vs, name));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, head + fs, name));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: link failed: ${gl.getProgramInfoLog(p)}`);
    this.p = p;
    this.uniforms = new Map();
    this.units = new Map();
    let unit = 0;
    if (!SAMPLER_TYPES.size) for (const t of ['SAMPLER_2D', 'SAMPLER_CUBE', 'SAMPLER_3D', 'SAMPLER_2D_ARRAY', 'SAMPLER_2D_SHADOW', 'SAMPLER_2D_ARRAY_SHADOW', 'INT_SAMPLER_2D', 'UNSIGNED_INT_SAMPLER_2D']) SAMPLER_TYPES.add(gl[t]);
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    gl.useProgram(p);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const base = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(p, info.name);
      const u = { loc, type: info.type, size: info.size, isArray: info.name.endsWith('[0]') };
      if (SAMPLER_TYPES.has(info.type)) {
        u.unit = unit;
        u.target = info.type === gl.SAMPLER_CUBE ? gl.TEXTURE_CUBE_MAP : info.type === gl.SAMPLER_3D ? gl.TEXTURE_3D
          : (info.type === gl.SAMPLER_2D_ARRAY || info.type === gl.SAMPLER_2D_ARRAY_SHADOW) ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
        gl.uniform1i(loc, unit);
        unit += 1;
      }
      this.uniforms.set(base, u);
    }
    this.attribs = new Map();
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); this.attribs.set(a.name, gl.getAttribLocation(p, a.name)); }
  }

  use() { this.gl.useProgram(this.p); return this; }

  has(name) { return this.uniforms.has(name); }

  /** Sets a uniform by name; silently ignores names the compiler optimised away. */
  set(name, v) {
    const u = this.uniforms.get(name);
    if (!u) return this;
    const gl = this.gl;
    if (u.unit !== undefined) {
      gl.activeTexture(gl.TEXTURE0 + u.unit);
      gl.bindTexture(u.target, v?.tex ?? v ?? null);
      return this;
    }
    switch (u.type) {
      case gl.FLOAT: u.isArray ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v.isVector2 ? [v.x, v.y] : v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v.isVector3 ? [v.x, v.y, v.z] : v.isColor ? [v.r, v.g, v.b] : v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v.isVector4 ? [v.x, v.y, v.z, v.w] : v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v.elements ?? v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v.elements ?? v); break;
      case gl.INT: case gl.BOOL: u.isArray ? gl.uniform1iv(u.loc, v) : gl.uniform1i(u.loc, v | 0); break;
      case gl.INT_VEC2: gl.uniform2iv(u.loc, v); break;
      case gl.INT_VEC3: gl.uniform3iv(u.loc, v); break;
      case gl.INT_VEC4: gl.uniform4iv(u.loc, v); break;
      default: throw new Error(`${this.name}: uniform ${name} has unsupported type ${u.type}`);
    }
    return this;
  }

  setAll(obj) { for (const k in obj) this.set(k, obj[k]); return this; }
}

function compile(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log);
    const at = m ? Number(m[1]) : 0;
    const ctx = at ? lines.slice(Math.max(0, at - 4), at + 2).map((l, i) => `${Math.max(1, at - 3) + i}: ${l}`).join('\n') : '';
    throw new Error(`${name} (${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}): ${log}\n${ctx}`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Textures

export const FMT = {
  rgba8: ['RGBA8', 'RGBA', 'UNSIGNED_BYTE'],
  srgba8: ['SRGB8_ALPHA8', 'RGBA', 'UNSIGNED_BYTE'],
  rgba16f: ['RGBA16F', 'RGBA', 'HALF_FLOAT'],
  rgba32f: ['RGBA32F', 'RGBA', 'FLOAT'],
  rg16f: ['RG16F', 'RG', 'HALF_FLOAT'],
  r16f: ['R16F', 'RED', 'HALF_FLOAT'],
  r32f: ['R32F', 'RED', 'FLOAT'],
  r8: ['R8', 'RED', 'UNSIGNED_BYTE'],
  rg8: ['RG8', 'RG', 'UNSIGNED_BYTE'],
  r11g11b10f: ['R11F_G11F_B10F', 'RGB', 'HALF_FLOAT'],
  depth32f: ['DEPTH_COMPONENT32F', 'DEPTH_COMPONENT', 'FLOAT'],
  depth24: ['DEPTH_COMPONENT24', 'DEPTH_COMPONENT', 'UNSIGNED_INT'],
};

export class Texture {
  /**
   * @param {object} o  { width, height, depth (layers), format, filter: 'linear'|'nearest'|'mip', wrap: 'clamp'|'repeat',
   *                     target: '2d'|'array'|'cube'|'3d', compare (for shadow maps), levels, data }
   */
  constructor(gl, o) {
    this.gl = gl;
    this.o = { format: 'rgba8', filter: 'linear', wrap: 'clamp', target: '2d', depth: 1, ...o };
    this.tex = gl.createTexture();
    this.alloc(this.o.width, this.o.height, this.o.depth);
  }

  get target() {
    const gl = this.gl;
    return { '2d': gl.TEXTURE_2D, array: gl.TEXTURE_2D_ARRAY, cube: gl.TEXTURE_CUBE_MAP, '3d': gl.TEXTURE_3D }[this.o.target];
  }

  alloc(w, h, d = this.o.depth) {
    const gl = this.gl, o = this.o;
    this.width = w; this.height = h; this.depth = d;
    if (this.tex && this._allocated) { gl.deleteTexture(this.tex); this.tex = gl.createTexture(); }
    this._allocated = true;
    const [ifmt] = FMT[o.format];
    const T = this.target;
    gl.bindTexture(T, this.tex);
    const mips = o.levels ?? (o.filter === 'mip' ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1);
    this.levels = mips;
    if (o.target === 'array' || o.target === '3d') gl.texStorage3D(T, mips, gl[ifmt], w, h, d);
    else gl.texStorage2D(T, mips, gl[ifmt], w, h);
    const min = o.filter === 'mip' ? gl.LINEAR_MIPMAP_LINEAR : o.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const mag = o.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(T, gl.TEXTURE_MIN_FILTER, o.minFilter ?? min);
    gl.texParameteri(T, gl.TEXTURE_MAG_FILTER, mag);
    const wrap = o.wrap === 'repeat' ? gl.REPEAT : o.wrap === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(T, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(T, gl.TEXTURE_WRAP_T, wrap);
    if (o.target === '3d' || o.target === 'cube') gl.texParameteri(T, gl.TEXTURE_WRAP_R, wrap);
    if (o.compare) {
      gl.texParameteri(T, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(T, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    }
    if (o.aniso && gl.ext.aniso) gl.texParameterf(T, gl.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(o.aniso, gl.maxAniso));
    if (o.data) this.upload(o.data);
    return this;
  }

  upload(data, level = 0, x = 0, y = 0, w = this.width >> level, h = this.height >> level, layer = 0) {
    const gl = this.gl;
    const [, fmt, type] = FMT[this.o.format];
    gl.bindTexture(this.target, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (this.o.target === 'array' || this.o.target === '3d') gl.texSubImage3D(this.target, level, x, y, layer, w, h, 1, gl[fmt], gl[type], data);
    else gl.texSubImage2D(gl.TEXTURE_2D, level, x, y, w, h, gl[fmt], gl[type], data);
    return this;
  }

  /** Upload an image/canvas/ImageBitmap to level 0 (and optionally build mips). */
  uploadImage(img, { flipY = false, mips = true } = {}) {
    const gl = this.gl;
    const [, fmt, type] = FMT[this.o.format];
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl[fmt], gl[type], img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (mips && this.levels > 1) gl.generateMipmap(gl.TEXTURE_2D);
    return this;
  }

  generateMips() { const gl = this.gl; gl.bindTexture(this.target, this.tex); gl.generateMipmap(this.target); return this; }

  dispose() { this.gl.deleteTexture(this.tex); this.tex = null; }
}

// ---------------------------------------------------------------------------
// Render targets

export class Target {
  /**
   * @param colors  array of Texture or texture option objects (allocated here)
   * @param depth   Texture | options | null
   */
  constructor(gl, { width, height, colors = [], depth = null, scale = 1 }) {
    this.gl = gl;
    this.scale = scale;
    this.colors = colors.map((c) => (c instanceof Texture ? c : new Texture(gl, { width, height, ...c })));
    this.depth = depth ? (depth instanceof Texture ? depth : new Texture(gl, { width, height, format: 'depth32f', filter: 'nearest', ...depth })) : null;
    this.width = width; this.height = height;
    this.fbo = gl.createFramebuffer();
    this.attach();
  }

  attach(level = 0, layer = 0) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    this.colors.forEach((c, i) => {
      if (c.o.target === 'array') gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, c.tex, level, layer);
      else if (c.o.target === 'cube') gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_CUBE_MAP_POSITIVE_X + layer, c.tex, level);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c.tex, level);
    });
    if (this.depth) {
      if (this.depth.o.target === 'array') gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.depth.tex, 0, layer);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth.tex, 0);
    }
    gl.drawBuffers(this.colors.length ? this.colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i) : [gl.NONE]);
    if (!this.colors.length) gl.readBuffer(gl.NONE);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete 0x${st.toString(16)}`);
    this.level = level;
    return this;
  }

  /** Binds for drawing and sets the viewport (at `level` if mipmapped). */
  bind(level = 0) {
    const gl = this.gl;
    if (level !== (this.level ?? 0)) this.attach(level);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, Math.max(1, this.width >> level), Math.max(1, this.height >> level));
    return this;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return this;
    this.width = width; this.height = height;
    for (const c of this.colors) c.alloc(width, height);
    this.depth?.alloc(width, height);
    this.attach();
    return this;
  }

  get tex() { return this.colors[0]; }

  dispose() { const gl = this.gl; gl.deleteFramebuffer(this.fbo); for (const c of this.colors) c.dispose(); this.depth?.dispose(); }
}

/** Two targets that swap each frame (history buffers). */
export class PingPong {
  constructor(gl, opts) { this.a = new Target(gl, opts); this.b = new Target(gl, opts); }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
  get read() { return this.b; }
  get write() { return this.a; }
  resize(w, h) { this.a.resize(w, h); this.b.resize(w, h); }
}

// ---------------------------------------------------------------------------
// Fullscreen triangle

let _fsVao = null;
export function fullscreen(gl) {
  if (!_fsVao || _fsVao.gl !== gl) {
    const vao = gl.createVertexArray();
    _fsVao = { gl, vao };
  }
  gl.bindVertexArray(_fsVao.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export const FS_VERT = /* glsl */`
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Compiles a fullscreen post program. */
export function postProgram(gl, fs, defines = {}, name = 'post') {
  return new Program(gl, FS_VERT, fs, defines, name);
}

// ---------------------------------------------------------------------------
// Buffers

export function buffer(gl, data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, usage);
  return b;
}

/** Common GL state helpers, so passes state their needs explicitly. */
export function state(gl, { depthTest = false, depthWrite = false, cull = false, blend = null, depthFunc = 'LEQUAL', colorMask = true } = {}) {
  depthTest ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
  gl.depthMask(depthWrite);
  gl.depthFunc(gl[depthFunc]);
  if (cull) { gl.enable(gl.CULL_FACE); gl.cullFace(cull === 'front' ? gl.FRONT : gl.BACK); } else gl.disable(gl.CULL_FACE);
  if (blend) {
    gl.enable(gl.BLEND);
    if (blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (blend === 'alpha') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else if (blend === 'premul') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else if (blend === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ZERO);
  } else gl.disable(gl.BLEND);
  const cm = !!colorMask;
  gl.colorMask(cm, cm, cm, cm);
}
