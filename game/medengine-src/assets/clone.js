/**
 * Copying and freeing loaded models.
 *
 * `Object3D.clone()` copies a hierarchy but a SkinnedMesh would still point at the *original* bones. `cloneModel` makes a
 * copy whose skeletons use the copied bones, whose morph weights are its own and whose lights aim at their own targets:
 * spawn as many knights from one loaded glTF as you like, each with its own Animator.
 *
 * Geometry, materials and textures are shared between copies (they are read-only resources).
 */
import { Skeleton } from '../scene/Mesh.js';

/** A deep copy of `root` that can be animated and moved independently of the original. */
export function cloneModel(root) {
  const map = new Map();
  const copy = (src) => {
    const dst = src.clone(false);
    map.set(src, dst);
    for (const c of src.children) dst.add(copy(c));
    return dst;
  };
  const out = copy(root);
  const skeletons = new Map(), weights = new Map();
  for (const [src, dst] of map) {
    if (src.isSkinnedMesh && src.skeleton) {
      let sk = skeletons.get(src.skeleton);
      if (!sk) {
        sk = new Skeleton(src.skeleton.bones.map((b) => map.get(b) ?? b), src.skeleton.boneInverses.map((m) => m.clone()));
        sk.name = src.skeleton.name;
        skeletons.set(src.skeleton, sk);
      }
      dst.bind(sk, src.bindMatrix);
    }
    if (src.morphTargetInfluences) {
      // primitives of one glTF mesh share a single weights array: keep them sharing (a new one, for this copy)
      let w = weights.get(src.morphTargetInfluences);
      if (!w) { w = [...src.morphTargetInfluences]; weights.set(src.morphTargetInfluences, w); }
      dst.morphTargetInfluences = w;
    }
    if (src.target && map.has(src.target)) dst.target = map.get(src.target);
  }
  return out;
}

/** Frees the GPU resources of everything under `root` (geometry, material textures). Shared resources go too: only call it for models nothing else uses. */
export function disposeModel(root) {
  const seen = new Set();
  const free = (r) => { if (r && !seen.has(r)) { seen.add(r); r.dispose?.(); } };
  root.traverse((o) => {
    if (o.geometry) free(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) free(m[k]);
      free(m);
    }
  });
}
