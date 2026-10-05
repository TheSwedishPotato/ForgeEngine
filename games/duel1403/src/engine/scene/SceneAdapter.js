import { Matrix3, Matrix4, Sphere, Vector3, Color } from 'three';
import { Texture } from '../gl/GL.js';

/**
 * Reads a three.js scene graph (used here only as a scene description) and
 * keeps GPU-side mirrors of everything the Med Engine draws: vertex
 * arrays, instance buffers, bone textures, textures and PBR material
 * parameters. Also remembers last frame's transforms for motion vectors.
 *
 * Fixed attribute locations shared by every geometry shader.
 */
export const ATTR = { position: 0, normal: 1, uv: 2, skinIndex: 3, skinWeight: 4, color: 5, instance: 6, instanceColor: 10, prevInstance: 11 };

const WRAP = { 1000: 'repeat', 1001: 'clamp', 1002: 'mirror' };
const _m = new Matrix4(), _n = new Matrix3(), _s = new Sphere(), _c = new Color();
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export class SceneAdapter {
  constructor(gl) {
    this.gl = gl;
    this.geos = new WeakMap();      // BufferGeometry -> GpuGeometry
    this.vaos = new WeakMap();      // Object3D -> { vao, geoVersion }
    this.texs = new WeakMap();      // three Texture -> { tex, version }
    this.prev = new WeakMap();      // Object3D -> Float32Array(16) last frame's world matrix
    this.skins = new WeakMap();     // Skeleton -> { cur, prev, frame }
    this.inst = new WeakMap();      // InstancedMesh -> instance buffers
    this.frame = 0;
    this.white = new Texture(gl, { width: 1, height: 1, format: 'rgba8', data: new Uint8Array([255, 255, 255, 255]) });
    this.flatNormal = new Texture(gl, { width: 1, height: 1, format: 'rgba8', data: new Uint8Array([128, 128, 255, 255]) });
  }

  /**
   * Walks the scene once per frame. Returns the frame's draw lists.
   */
  collect(scene) {
    this.frame++;
    scene.updateMatrixWorld();
    const out = { opaque: [], sprites: [], sun: null, points: [], custom: [] };
    const visit = (o) => {
      if (!o.visible || o.userData.forgeSkip) return;
      if (o.userData.forgeDraw) out.custom.push(o);
      if (o.isDirectionalLight && !out.sun) out.sun = o;
      else if (o.isPointLight) out.points.push(o);
      else if (o.isSprite) { if (o.material.opacity > 0.003) out.sprites.push(o); }
      else if (o.isMesh && !o.userData.forgeDraw) {
        const item = this._item(o);
        if (item) out.opaque.push(item);
      }
      for (const c of o.children) visit(c);
    };
    visit(scene);
    return out;
  }

  /** Called after the frame is rendered: this frame's transforms become "previous". */
  endFrame(items) {
    for (const it of items) {
      let p = this.prev.get(it.object);
      if (!p) { p = new Float32Array(16); this.prev.set(it.object, p); }
      p.set(it.object.matrixWorld.elements);
    }
  }

  _item(o) {
    const geo = o.geometry;
    if (!geo?.attributes?.position) return null;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat || mat.visible === false || mat.isShaderMaterial) return null;
    if (o.isInstancedMesh && o.count === 0) return null;
    const m = this.material(mat, o);
    if (m.transparent && m.opacity < 0.01) return null;
    const g = this.geometry(geo);
    const model = o.matrixWorld.elements;
    let prev = this.prev.get(o) ?? model;
    _n.getNormalMatrix(o.matrixWorld);
    const item = {
      object: o, geo: g, mat: m, model, prevModel: prev, normalMatrix: _n.elements.slice(),
      castShadow: o.castShadow, skin: null, instances: 0, vao: null,
      bounds: null, defines: null,
    };
    if (o.isSkinnedMesh) item.skin = this.skin(o);
    if (o.isInstancedMesh) item.instances = this.instances(o);
    item.vao = this.vao(o, g, !!item.instances);
    // World-space bounding sphere for culling. A skinned body is bounded by a
    // sphere round its root bone (a person fits within 1.6 m of the pelvis).
    if (o.isSkinnedMesh) {
      item.bounds = this.skeletonBounds(o.skeleton);
    } else if (o.frustumCulled !== false) {
      if (o.isInstancedMesh) {
        if (!o.boundingSphere) o.computeBoundingSphere();
        _s.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);
      } else {
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        _s.copy(geo.boundingSphere).applyMatrix4(o.matrixWorld);
      }
      item.bounds = [_s.center.x, _s.center.y, _s.center.z, _s.radius];
    }
    item.defines = {
      SKINNED: !!item.skin, INSTANCED: !!item.instances, INSTANCE_COLOR: !!(item.instances && o.instanceColor),
      VERTEX_COLOR: !!(mat.vertexColors && geo.attributes.color), ...m.defines,
      HAS_UV: !!geo.attributes.uv,
    };
    item.key = Object.entries(item.defines).filter(([, v]) => v).map(([k]) => k).join('|');
    return item;
  }

  // -------------------------------------------------------------------------
  // Geometry

  geometry(geo) {
    let g = this.geos.get(geo);
    const gl = this.gl;
    const pos = geo.attributes.position;
    if (!g) {
      g = { buffers: {}, versions: {}, index: null, indexVersion: -1, count: 0, indexType: 0, version: 0 };
      this.geos.set(geo, g);
    }
    let changed = false;
    for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color']) {
      const a = geo.attributes[name];
      if (!a) continue;
      if (g.versions[name] === a.version && g.buffers[name]) continue;
      const fresh = !g.buffers[name] || g.buffers[name].length !== a.array.length;
      if (fresh) {
        if (g.buffers[name]) gl.deleteBuffer(g.buffers[name].buf);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, a.array, a.usage === 35048 ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
        g.buffers[name] = { buf, size: a.itemSize, type: a.array, normalized: a.normalized, length: a.array.length };
        changed = true;
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, g.buffers[name].buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, a.array);
      }
      g.versions[name] = a.version;
    }
    if (!geo.attributes.normal && !g.buffers.normal) {
      geo.computeVertexNormals();
      return this.geometry(geo);
    }
    if (geo.index && g.indexVersion !== geo.index.version) {
      if (g.index) gl.deleteBuffer(g.index);
      g.index = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.index);
      const arr = geo.index.array;
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      g.indexType = arr instanceof Uint32Array ? gl.UNSIGNED_INT : arr instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
      g.indexVersion = geo.index.version;
      changed = true;
    }
    const range = geo.drawRange;
    const total = geo.index ? geo.index.count : pos.count;
    g.start = range.start;
    g.count = Math.min(total - range.start, range.count === Infinity ? total : range.count);
    if (changed) g.version++;
    return g;
  }

  vao(o, g, instanced) {
    const gl = this.gl;
    const key = instanced ? o : o.geometry;
    let v = this.vaos.get(key);
    if (v && v.version === g.version) return v.vao;
    if (v) gl.deleteVertexArray(v.vao);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [name, b] of Object.entries(g.buffers)) {
      const loc = ATTR[name];
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.enableVertexAttribArray(loc);
      const type = b.type instanceof Float32Array ? gl.FLOAT : b.type instanceof Uint16Array ? gl.UNSIGNED_SHORT : b.type instanceof Uint8Array ? gl.UNSIGNED_BYTE : b.type instanceof Int16Array ? gl.SHORT : b.type instanceof Uint32Array ? gl.UNSIGNED_INT : gl.FLOAT;
      gl.vertexAttribPointer(loc, b.size, type, !!b.normalized, 0, 0);
    }
    if (!g.buffers.uv) gl.vertexAttrib2f(ATTR.uv, 0, 0);
    if (!g.buffers.color) gl.vertexAttrib3f(ATTR.color, 1, 1, 1);
    if (instanced) {
      const ib = this.inst.get(o);
      bindMat4(gl, ib.cur, ATTR.instance);
      bindMat4(gl, ib.prev, ATTR.prevInstance);
      if (ib.color) {
        gl.bindBuffer(gl.ARRAY_BUFFER, ib.color);
        gl.enableVertexAttribArray(ATTR.instanceColor);
        gl.vertexAttribPointer(ATTR.instanceColor, 3, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(ATTR.instanceColor, 1);
      }
    }
    if (g.index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.index);
    gl.bindVertexArray(null);
    this.vaos.set(key, { vao, version: g.version });
    return vao;
  }

  instances(o) {
    const gl = this.gl;
    let ib = this.inst.get(o);
    const im = o.instanceMatrix;
    if (!ib) {
      ib = { cur: gl.createBuffer(), prev: gl.createBuffer(), color: null, version: -1, colorVersion: -1, last: new Float32Array(im.array.length), moved: true };
      for (const b of [ib.cur, ib.prev]) { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, im.array, gl.DYNAMIC_DRAW); }
      ib.last.set(im.array);
      this.inst.set(o, ib);
      // force a VAO rebuild for this object
      this.vaos.delete(o);
    }
    if (ib.version !== im.version) {
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.prev);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ib.last);
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.cur);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, im.array);
      ib.last.set(im.array);
      ib.version = im.version;
      ib.moved = true;
    } else if (ib.moved) {
      // Still this frame: previous equals current.
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.prev);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, im.array);
      ib.moved = false;
    }
    if (o.instanceColor && ib.colorVersion !== o.instanceColor.version) {
      if (!ib.color) { ib.color = gl.createBuffer(); this.vaos.delete(o); }
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.color);
      gl.bufferData(gl.ARRAY_BUFFER, o.instanceColor.array, gl.DYNAMIC_DRAW);
      ib.colorVersion = o.instanceColor.version;
    }
    return o.count;
  }

  // -------------------------------------------------------------------------
  // Skinning: bone matrices in a float texture (4 texels per bone), and last
  // frame's copy for motion vectors.

  skin(o) {
    const sk = o.skeleton;
    let s = this.skins.get(sk);
    const gl = this.gl;
    if (!s) {
      const n = sk.bones.length;
      s = { cur: new Texture(gl, { width: 4, height: n, format: 'rgba32f', filter: 'nearest' }), prev: new Texture(gl, { width: 4, height: n, format: 'rgba32f', filter: 'nearest' }), frame: -1, data: null };
      this.skins.set(sk, s);
    }
    if (s.frame !== this.frame) {
      sk.update();
      const t = s.prev; s.prev = s.cur; s.cur = t;
      s.cur.upload(sk.boneMatrices);
      if (s.frame === -1) s.prev.upload(sk.boneMatrices);
      s.frame = this.frame;
    }
    return { cur: s.cur, prev: s.prev, bind: o.bindMatrix.elements, bindInv: o.bindMatrixInverse.elements };
  }

  /** Sphere round all the bones of a skeleton (+ flesh and armour), once per frame. */
  skeletonBounds(sk) {
    const s = this.skins.get(sk);
    if (s.boundsFrame === this.frame) return s.bounds;
    let cx = 0, cy = 0, cz = 0;
    const n = sk.bones.length, e = [];
    for (const b of sk.bones) { const m = b.matrixWorld.elements; e.push(m[12], m[13], m[14]); cx += m[12]; cy += m[13]; cz += m[14]; }
    cx /= n; cy /= n; cz /= n;
    let r = 0;
    for (let i = 0; i < e.length; i += 3) r = Math.max(r, Math.hypot(e[i] - cx, e[i + 1] - cy, e[i + 2] - cz));
    s.bounds = [cx, cy, cz, r + 0.45];
    s.boundsFrame = this.frame;
    return s.bounds;
  }

  // -------------------------------------------------------------------------
  // Textures

  texture(t, srgb) {
    if (!t) return null;
    const gl = this.gl;
    let e = this.texs.get(t);
    const img = t.image;
    if (!img) return null;
    const w = img.width, h = img.height;
    if (!w || !h) return null;
    if (e && e.version === t.version) return e.tex;
    if (!e || e.w !== w || e.h !== h) {
      e?.tex.dispose();
      const wrap = WRAP[t.wrapS] ?? 'clamp';
      e = { tex: new Texture(gl, { width: w, height: h, format: srgb ? 'srgba8' : 'rgba8', filter: t.generateMipmaps === false ? 'linear' : 'mip', wrap, aniso: 16 }), w, h, version: -1 };
      this.texs.set(t, e);
    }
    if (img.data) {
      // DataTexture: rows as given
      let data = img.data;
      if (data.length === w * h * 3) { const d4 = new Uint8Array(w * h * 4); for (let i = 0, j = 0; i < w * h; i++, j += 3) { d4[i * 4] = data[j]; d4[i * 4 + 1] = data[j + 1]; d4[i * 4 + 2] = data[j + 2]; d4[i * 4 + 3] = 255; } data = d4; }
      e.tex.upload(data);
      if (e.tex.levels > 1) e.tex.generateMips();
    } else {
      e.tex.uploadImage(img, { flipY: t.flipY });
    }
    e.version = t.version;
    return e.tex;
  }

  // -------------------------------------------------------------------------
  // Materials: three's MeshStandard/Physical/Basic parameters become a flat
  // PBR description. Physical extras map onto material types the lighting
  // pass understands (skin subsurface, clear-coated steel, cloth sheen).

  material(mat, o) {
    const m = mat._forge ?? (mat._forge = { defines: {}, uni: {} });
    if (m.version === mat.version && m.frame === this.frame) return m;
    m.frame = this.frame;
    const map = this.texture(mat.map, true);
    const nmap = mat.normalMap ? this.texture(mat.normalMap, false) : null;
    const rmap = mat.roughnessMap ? this.texture(mat.roughnessMap, false) : null;
    const emap = mat.emissiveMap ? this.texture(mat.emissiveMap, true) : null;
    const unlit = !!mat.isMeshBasicMaterial;
    let type = 0, param = 0;
    if (mat.customProgramCacheKey && mat.customProgramCacheKey() === 'skin-sss') type = 1;
    else if (mat.isMeshPhysicalMaterial && mat.clearcoat > 0) { type = 2; param = mat.clearcoat; }
    else if (mat.isMeshPhysicalMaterial && mat.sheen > 0) { type = 3; param = mat.sheen; }
    else if (mat.userData?.foliage) type = 4;
    if (type === 1) param = mat.sheen ?? 0.3;
    m.defines = {
      USE_MAP: !!map, USE_NORMALMAP: !!nmap, USE_ROUGHMAP: !!rmap, USE_EMISSIVEMAP: !!emap,
      FLAT: !!mat.flatShading, DOUBLE_SIDED: mat.side === 2, BACK_SIDE: mat.side === 1, UNLIT: unlit,
      ALPHA_TEST: mat.alphaTest > 0,
    };
    m.transparent = !!mat.transparent;
    m.opacity = mat.opacity ?? 1;
    m.side = mat.side;
    _c.copy(mat.color ?? _c.set(1, 1, 1));
    const em = unlit ? [0, 0, 0] : mat.emissive ? [mat.emissive.r * (mat.emissiveIntensity ?? 1), mat.emissive.g * (mat.emissiveIntensity ?? 1), mat.emissive.b * (mat.emissiveIntensity ?? 1)] : [0, 0, 0];
    if (mat.map) mat.map.updateMatrix();
    if (mat.normalMap) mat.normalMap.updateMatrix();
    if (mat.roughnessMap) mat.roughnessMap.updateMatrix();
    m.uni = {
      uBaseColor: [_c.r, _c.g, _c.b],
      uOpacity: m.opacity,
      uRoughness: mat.roughness ?? 1,
      uMetalness: mat.metalness ?? 0,
      uEmissive: em,
      uUnlitScale: unlit ? 1 : 0,
      uNormalScale: mat.normalScale ? [mat.normalScale.x, mat.normalScale.y] : [1, 1],
      uMatType: type,
      uMatParam: param,
      uSpecular: mat.specularIntensity ?? 1,
      uAlphaTest: mat.alphaTest ?? 0,
      uMap: map ?? this.white,
      uNormalMap: nmap ?? this.flatNormal,
      uRoughMap: rmap ?? this.white,
      uEmissiveMap: emap ?? this.white,
      uMapTransform: mat.map ? mat.map.matrix.elements : [1, 0, 0, 0, 1, 0, 0, 0, 1],
      uNormalMapTransform: mat.normalMap ? mat.normalMap.matrix.elements : [1, 0, 0, 0, 1, 0, 0, 0, 1],
      uRoughMapTransform: mat.roughnessMap ? mat.roughnessMap.matrix.elements : [1, 0, 0, 0, 1, 0, 0, 0, 1],
    };
    m.version = mat.version;
    void o;
    return m;
  }
}

function bindMat4(gl, buf, loc) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(loc + i);
    gl.vertexAttribPointer(loc + i, 4, gl.FLOAT, false, 64, i * 16);
    gl.vertexAttribDivisor(loc + i, 1);
  }
}

export { IDENTITY };
