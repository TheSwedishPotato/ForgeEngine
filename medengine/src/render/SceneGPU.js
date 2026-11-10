/**
 * Walks the scene graph once per frame and produces the render lists: draw items (a mesh range with
 * its material, per-object uniforms and resource bind group), lights, and the sun.
 */
import { Matrix3 } from '../math/core.js';
import { ObjectU } from './shaders/geometry.js';
import { tag } from './Cache.js';

const _n3 = new Matrix3();

/** Offsets (in floats) of the Obj fields, for direct writes. */
const OB = Object.fromEntries(Object.entries(ObjectU.offsets).map(([k, v]) => [k, v.offset >> 2]));

export function sphereInFrustum(planes, cx, cy, cz, r) {
  for (let i = 0; i < 6; i++) {
    const p = planes[i], n = p.normal;
    if (n.x * cx + n.y * cy + n.z * cz + p.constant < -r) return false;
  }
  return true;
}

export class SceneGPU {
  constructor(gpu, cache, arena) {
    this.gpu = gpu; this.cache = cache; this.arena = arena;
    this.resLayout = gpu.layout('resources', [0, 1, 2, 3, 4, 5].map((b) => ({ b, v: 'v', buffer: 'read-only-storage' })));
    this.resBGs = new Map();
    this.stats = { meshes: 0, items: 0, culled: 0 };
  }

  /** Bind group of the storage resources of one draw (palettes, instances, morph deltas). */
  resourceGroup(bonesCur, bonesPrev, instCur, instPrev, instColor, morph) {
    const d = this.cache.dummyStorage;
    const b = [bonesCur ?? d, bonesPrev ?? d, instCur ?? d, instPrev ?? d, instColor ?? d, morph ?? d];
    const key = b.map((x) => x.__id).join('/');
    let bg = this.resBGs.get(key);
    if (!bg) {
      bg = this.gpu.device.createBindGroup({ label: 'resources', layout: this.resLayout, entries: b.map((buffer, binding) => ({ binding, resource: { buffer } })) });
      this.resBGs.set(key, bg);
      if (this.resBGs.size > 4096) this.resBGs.clear();
    }
    return bg;
  }

  /**
   * @returns {{ items: object[], lights: object[], sun: object|null, skinned: number }}
   * Item fields: mesh, geo (GPU record), start, count, material, mat (GPU record), objOffset, resBG, bounds [x,y,z,r], castShadow,
   *   instances, flip, skinned, instanced, morph
   */
  collect(scene, frame) {
    const items = [], lights = [];
    let sun = null, skinned = 0;
    const cache = this.cache, arena = this.arena;
    const stats = this.stats; stats.meshes = 0; stats.items = 0;
    const visit = (o) => {
      if (!o.visible) return;
      if (o.isLight) {
        if (o.isDirectionalLight) { if (!sun) sun = o; } else lights.push(o);
      } else if (o.isMesh && o.geometry && !o.userData.skip) {
        this._mesh(o, items, frame);
        stats.meshes++;
      }
      for (const c of o.children) visit(c);
    };
    visit(scene);
    for (const it of items) if (it.skinned) skinned++;
    stats.items = items.length;
    void cache; void arena;
    return { items, lights, sun, skinned };
  }

  _mesh(mesh, items, frame) {
    const cache = this.cache, arena = this.arena;
    const geo = mesh.geometry;
    const g = cache.geometry(geo);
    if (!g.buffers.position || g.count === 0) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hasGroups = Array.isArray(mesh.material) && geo.groups.length > 0;
    const skeleton = mesh.isSkinnedMesh && mesh.skeleton ? mesh.skeleton : null;
    const skinOk = !!(skeleton && g.buffers.skinIndex && g.buffers.skinWeight);
    const instanced = !!mesh.isInstancedMesh && mesh.count > 0;
    if (mesh.isInstancedMesh && !instanced) return;

    // ---- per-object uniforms (shared by every pass and every group of this mesh)
    const off = arena.alloc(ObjectU.size);
    const f = arena.f32, u = arena.u32, i32 = arena.i32, b = off >> 2;
    const m = mesh.matrixWorld;
    f.set(m.elements, b + OB.model);
    let prev = mesh.__prevWorld;
    if (!prev) prev = mesh.__prevWorld = new Float32Array(m.elements);
    if (mesh.__prevFrame !== frame - 1 && mesh.__prevFrame !== frame) prev.set(m.elements);   // not drawn last frame: no motion
    f.set(prev, b + OB.prevModel);
    _n3.getNormalMatrix(m);
    const ne = _n3.elements;
    for (let c = 0; c < 3; c++) { f[b + OB.normalMat + c * 4] = ne[c * 3]; f[b + OB.normalMat + c * 4 + 1] = ne[c * 3 + 1]; f[b + OB.normalMat + c * 4 + 2] = ne[c * 3 + 2]; }
    let bonesCur = null, bonesPrev = null;
    if (skinOk) {
      f.set(mesh.bindMatrix.elements, b + OB.bind);
      f.set(mesh.bindMatrixInverse.elements, b + OB.bindInv);
      const sk = cache.skeleton(skeleton);
      bonesCur = sk.bufs[sk.cur]; bonesPrev = sk.bufs[sk.cur ^ 1];
    }
    let instCur = null, instPrev = null, instColor = null;
    if (instanced) {
      const ir = cache.instances(mesh);
      instCur = ir.curBuf; instPrev = ir.prev; instColor = ir.color && mesh.instanceColor ? ir.color : null;
    }
    // morph targets: the strongest 16 active weights
    let morph = null, morphN = 0;
    const infl = mesh.morphTargetInfluences;
    if (g.morph && infl && g.buffers.morphSlot) {
      morph = g.morph.buffer;
      const prevW = mesh.__prevInfl ?? (mesh.__prevInfl = new Float32Array(infl.length));
      const same = mesh.__prevFrame === frame - 1 || mesh.__prevFrame === frame;
      const act = [];
      for (let k = 0; k < Math.min(infl.length, g.morph.units); k++) if (Math.abs(infl[k]) > 1e-4 || (same && Math.abs(prevW[k]) > 1e-4)) act.push(k);
      if (act.length > 16) act.sort((p, q) => Math.abs(infl[q]) - Math.abs(infl[p])).length = 16;
      morphN = act.length;
      for (let a = 0; a < morphN; a++) {
        const k = act[a];
        i32[b + OB.morphIdx + a] = k;
        f[b + OB.morphW + a] = infl[k];
        f[b + OB.morphPW + a] = same ? prevW[k] : infl[k];
      }
      for (let k = 0; k < infl.length; k++) prevW[k] = infl[k];
    }
    u[b + OB.morphN] = morphN;
    u[b + OB.morphSlots] = g.morph?.slots ?? 0;
    u[b + OB.instances] = instanced ? mesh.count : 1;
    mesh.__prevFrame = frame;
    const resBG = this.resourceGroup(bonesCur, bonesPrev, instCur, instPrev, instColor, morph);

    // ---- bounds (world sphere)
    let bounds;
    if (!mesh.frustumCulled) bounds = null;
    else if (skinOk) bounds = this._skeletonSphere(skeleton, mesh.userData.cullMargin ?? 0.6);
    else {
      let bs = geo.boundingSphere;
      if (instanced) {
        if (!mesh.boundingSphere || mesh.__bsVersion !== mesh.instanceMatrix.version) { mesh.computeBoundingSphere(); mesh.__bsVersion = mesh.instanceMatrix.version; }
        bs = mesh.boundingSphere;
      }
      if (bs && bs.radius >= 0) {
        const e = m.elements, c = bs.center;
        const s = m.getMaxScaleOnAxis();
        bounds = [e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12], e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13], e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14], bs.radius * s];
      } else bounds = null;
    }
    const det = m.determinant();
    const flip = det < 0;
    const draws = [];
    if (hasGroups) {
      for (const gr of geo.groups) {
        const mat = mats[gr.materialIndex];
        if (!mat || mat.visible === false) continue;
        draws.push({ start: gr.start, count: gr.count, mat });
      }
    } else if (mats[0]?.visible !== false) {
      const r = geo.drawRange;
      const start = Math.max(0, r.start), count = Math.min(g.count - start, r.count);
      draws.push({ start, count, mat: mats[0] });
    }
    for (const d of draws) {
      if (d.count <= 0) continue;
      const mr = cache.material(d.mat);
      items.push({
        mesh, geo: g, start: d.start, count: d.count, material: d.mat, mat: mr, objOffset: off, resBG, bounds,
        castShadow: mesh.castShadow && !d.mat.unlit && d.mat.shadowCast !== false, shadowOnly: !!mesh.userData.shadowOnly,
        instances: instanced ? mesh.count : 1, flip, skinned: skinOk, instanced, morph: morphN > 0 || !!morph,
        instanceColor: instanced && !!instColor, layer: mesh.renderOrder,
      });
    }
  }

  _skeletonSphere(skel, margin) {
    const bones = skel.bones;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < bones.length; i++) {
      const e = bones[i].matrixWorld.elements;
      const x = e[12], y = e[13], z = e[14];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    if (!isFinite(mnx)) return null;
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
    return [cx, cy, cz, Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) / 2 + margin];
  }

  /** Called after the frame: remember this frame's transforms for motion vectors. */
  endFrame(items) {
    let last = null;
    for (const it of items) {
      if (it.mesh === last) continue;
      last = it.mesh;
      it.mesh.__prevWorld.set(it.mesh.matrixWorld.elements);
    }
  }
}

void tag;
