import { Vector3, Matrix3 } from 'three';
import { Texture } from '../gl/GL.js';

/**
 * The static world baked for the GPU: every mesh marked `userData.static`
 * (the town, the church, the castle) is flattened into world-space
 * triangles, grouped into clusters of 64 by material and position, and
 * stored in float textures that shaders read directly:
 *
 *   uPos   (RGBA32F)  vertex position xyz, texture u      3 texels a triangle
 *   uNrm   (RGBA32F)  vertex normal xyz,   texture v
 *   uClu   (RGBA32F)  per cluster: bounding sphere | material, first triangle
 *   uMat   (RGBA32F)  per material: base colour, map layer | roughness, metal, type, param
 *   uMaps  (2D array) every material's colour map, 512 x 512, mipmapped
 *
 * The visibility buffer, the ray tracer and the path tracer all draw on
 * this one copy. Cluster size is fixed (each mesh is padded with empty
 * triangles), so a triangle's cluster is just its index / 64.
 */

export const CLUSTER = 64;
export const TEX_W = 2048;

const _v = new Vector3(), _n = new Vector3(), _nm = new Matrix3();

export class StaticScene {
  constructor(r, meshes) {
    this.r = r;
    const gl = r.gl;
    // materials and their maps
    const mats = [], matIndex = new Map(), images = [], imageIndex = new Map();
    const matOf = (m) => {
      if (matIndex.has(m)) return matIndex.get(m);
      let layer = -1;
      const img = m.map?.image;
      if (img) {
        if (!imageIndex.has(img)) { imageIndex.set(img, images.length); images.push(img); }
        layer = imageIndex.get(img);
      }
      const type = m.isMeshPhysicalMaterial && m.sheen > 0 ? 3 : 0;
      mats.push([m.color.r, m.color.g, m.color.b, layer, m.roughness ?? 1, m.metalness ?? 0, type, m.sheen ?? 0]);
      matIndex.set(m, mats.length - 1);
      return mats.length - 1;
    };
    // triangles, sorted into clusters
    const pos = [], nrm = [], clusters = [];
    let triTotal = 0;
    for (const o of meshes) {
      o.updateMatrixWorld();
      const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index;
      const mat = matOf(Array.isArray(o.material) ? o.material[0] : o.material);
      _nm.getNormalMatrix(o.matrixWorld);
      const nTri = (I ? I.count : P.count) / 3;
      // order the triangles along a Morton curve of their centroids so clusters are compact
      const order = [];
      for (let t = 0; t < nTri; t++) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) { const vi = I ? I.getX(t * 3 + k) : t * 3 + k; cx += P.getX(vi); cy += P.getY(vi); cz += P.getZ(vi); }
        order.push([morton(cx / 3, cy / 3, cz / 3), t]);
      }
      order.sort((a, b) => a[0] - b[0]);
      const padded = Math.ceil(nTri / CLUSTER) * CLUSTER;
      for (let c = 0; c < padded / CLUSTER; c++) {
        const first = triTotal + c * CLUSTER;
        const pts = [];
        for (let j = 0; j < CLUSTER; j++) {
          const oi = c * CLUSTER + j;
          for (let k = 0; k < 3; k++) {
            if (oi < nTri) {
              const t = order[oi][1], vi = I ? I.getX(t * 3 + k) : t * 3 + k;
              _v.fromBufferAttribute(P, vi).applyMatrix4(o.matrixWorld);
              _n.fromBufferAttribute(N, vi).applyMatrix3(_nm).normalize();
              const u = U ? U.getX(vi) : 0, w = U ? U.getY(vi) : 0;
              pos.push(_v.x, _v.y, _v.z, u); nrm.push(_n.x, _n.y, _n.z, w);
              pts.push(_v.x, _v.y, _v.z);
            } else { pos.push(0, -1e4, 0, 0); nrm.push(0, 1, 0, 0); }
          }
        }
        // bounding sphere of the cluster
        let cx = 0, cy = 0, cz = 0;
        const n = pts.length / 3 || 1;
        for (let i = 0; i < pts.length; i += 3) { cx += pts[i]; cy += pts[i + 1]; cz += pts[i + 2]; }
        cx /= n; cy /= n; cz /= n;
        let rad = 0;
        for (let i = 0; i < pts.length; i += 3) rad = Math.max(rad, Math.hypot(pts[i] - cx, pts[i + 1] - cy, pts[i + 2] - cz));
        clusters.push([cx, cy, cz, pts.length ? rad : -1, mat, first, 0, 0]);
      }
      triTotal += padded;
    }
    this.triCount = triTotal;
    this.clusterCount = clusters.length;
    this.materialCount = mats.length;
    this.positions = new Float32Array(pos);     // kept for the BVH
    this.normals = new Float32Array(nrm);
    this.clusters = clusters;
    this.materials = mats;
    // textures
    const verts = triTotal * 3, rows = Math.ceil(verts / TEX_W);
    const pad = (a, n) => { const out = new Float32Array(n); out.set(a); return out; };
    this.uPos = new Texture(gl, { width: TEX_W, height: rows, format: 'rgba32f', filter: 'nearest' });
    this.uPos.upload(pad(this.positions, TEX_W * rows * 4));
    this.uNrm = new Texture(gl, { width: TEX_W, height: rows, format: 'rgba32f', filter: 'nearest' });
    this.uNrm.upload(pad(this.normals, TEX_W * rows * 4));
    this.cluW = 256;
    const cRows = Math.ceil(clusters.length / this.cluW);
    const cdata = new Float32Array(this.cluW * 2 * cRows * 4);
    clusters.forEach((c, i) => { const x = (i % this.cluW) * 2, y = Math.floor(i / this.cluW); cdata.set(c.slice(0, 4), (y * this.cluW * 2 + x) * 4); cdata.set(c.slice(4), (y * this.cluW * 2 + x + 1) * 4); });
    this.uClu = new Texture(gl, { width: this.cluW * 2, height: cRows, format: 'rgba32f', filter: 'nearest' });
    this.uClu.upload(cdata);
    const mdata = new Float32Array(Math.max(1, mats.length) * 2 * 4);
    mats.forEach((m, i) => mdata.set(m, i * 8));
    this.uMat = new Texture(gl, { width: Math.max(1, mats.length) * 2, height: 1, format: 'rgba32f', filter: 'nearest' });
    this.uMat.upload(mdata);
    // the maps, all at 512 x 512 in one array texture
    const S = 512, layers = Math.max(1, images.length);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    const levels = Math.log2(S) + 1;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.SRGB8_ALPHA8, S, S, layers);
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g2 = cv.getContext('2d');
    images.forEach((img, i) => {
      g2.clearRect(0, 0, S, S);
      g2.drawImage(img, 0, 0, S, S);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, S, S, 1, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const an = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) gl.texParameterf(gl.TEXTURE_2D_ARRAY, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.uMaps = { tex };
    this.meshes = meshes;
  }

  /** Uniforms every consumer binds. */
  bind(p) {
    return p.set('uSPos', this.uPos).set('uSNrm', this.uNrm).set('uSClu', this.uClu).set('uSMat', this.uMat).set('uSMaps', this.uMaps)
      .set('uSCluW', this.cluW).set('uSTriCount', this.triCount).set('uSClusterCount', this.clusterCount);
  }
}

/** GLSL to read the baked scene. */
export const STATIC_GLSL = /* glsl */`
uniform highp sampler2D uSPos, uSNrm, uSClu, uSMat;
uniform highp sampler2DArray uSMaps;
uniform int uSCluW, uSTriCount, uSClusterCount;
const int S_TEXW = ${TEX_W};
const int S_CLUSTER = ${CLUSTER};
ivec2 sAt(int v) { return ivec2(v % S_TEXW, v / S_TEXW); }
vec4 sPos(int v) { return texelFetch(uSPos, sAt(v), 0); }
vec4 sNrm(int v) { return texelFetch(uSNrm, sAt(v), 0); }
vec4 sCluster0(int c) { return texelFetch(uSClu, ivec2((c % uSCluW) * 2, c / uSCluW), 0); }
vec4 sCluster1(int c) { return texelFetch(uSClu, ivec2((c % uSCluW) * 2 + 1, c / uSCluW), 0); }
void sMaterial(int m, out vec4 a, out vec4 b) { a = texelFetch(uSMat, ivec2(m * 2, 0), 0); b = texelFetch(uSMat, ivec2(m * 2 + 1, 0), 0); }
int sMatOfTri(int tri) { return int(sCluster1(tri / S_CLUSTER).x); }
`;

/** A 30-bit Morton code of a point in a 1 km cube around the town. */
function morton(x, y, z) {
  const q = (v) => Math.max(0, Math.min(1023, Math.floor((v + 512) / 1024 * 1024)));
  const spread = (v) => { v = (v | (v << 16)) & 0x030000FF; v = (v | (v << 8)) & 0x0300F00F; v = (v | (v << 4)) & 0x030C30C3; v = (v | (v << 2)) & 0x09249249; return v; };
  return (spread(q(x)) | (spread(q(y)) << 1) | (spread(q(z)) << 2)) >>> 0;
}
