/**
 * Things that draw: Mesh, SkinnedMesh (+ Bone, Skeleton), InstancedMesh.
 * Skinning follows the standard "attached bind" model: a bone's skin matrix is
 * `bone.matrixWorld * boneInverse`, applied between `bindMatrix` and its inverse, so a character
 * can be moved as a whole by moving its root.
 */
import { Object3D } from './Object3D.js';
import { BufferAttribute } from './Geometry.js';
import { Matrix4, Vector3 } from '../math/core.js';
import { Sphere } from '../math/geometry.js';
import { StandardMaterial } from './Material.js';

/**
 * @import { BufferGeometry } from './Geometry.js'
 * @import { Material } from './Material.js'
 */

const _m = new Matrix4(), _v = new Vector3();

export class Mesh extends Object3D {
  /**
   * @param {BufferGeometry | null} [geometry]
   * @param {Material | Material[]} [material]  a material, or an array indexed by the geometry's groups (default: a StandardMaterial)
   */
  constructor(geometry = null, material = new StandardMaterial()) {
    super();
    this.type = 'Mesh';
    this.geometry = geometry;
    /** A material, or an array indexed by the geometry's groups. */
    this.material = material;
    /** Morph target weights (when the geometry has morphAttributes). */
    this.morphTargetInfluences = null;
  }
  get isMesh() { return true; }
  copy(src, recursive) {
    super.copy(src, recursive);
    this.geometry = src.geometry; this.material = src.material;
    this.morphTargetInfluences = src.morphTargetInfluences ? [...src.morphTargetInfluences] : null;
    return this;
  }
}

export class Bone extends Object3D {
  constructor() { super(); this.type = 'Bone'; }
  get isBone() { return true; }
}

export class Skeleton {
  constructor(bones = [], boneInverses = []) {
    this.bones = bones.slice();
    this.boneInverses = boneInverses;
    this.boneMatrices = new Float32Array(this.bones.length * 16);
    if (!boneInverses.length) this.calculateInverses();
    else if (this.bones.length !== boneInverses.length) {
      this.boneInverses = this.bones.map((_, i) => boneInverses[i] ?? new Matrix4());
    }
  }
  get isSkeleton() { return true; }
  /** Records the bones' current world transforms as the bind pose. Needs up-to-date matrixWorld. */
  calculateInverses() {
    this.boneInverses.length = 0;
    for (const b of this.bones) this.boneInverses.push(new Matrix4().copy(b.matrixWorld).invert());
  }
  /** Puts the bones back into the recorded bind pose. */
  pose() {
    for (let i = 0; i < this.bones.length; i++) this.bones[i].matrixWorld.copy(this.boneInverses[i]).invert();
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      if (b.parent?.isBone) {
        b.matrix.copy(b.parent.matrixWorld).invert().multiply(b.matrixWorld);
      } else b.matrix.copy(b.matrixWorld);
      b.matrix.decompose(b.position, b.quaternion, b.scale);
      b.updateMatrixWorld(true);
    }
  }
  update() {
    const bones = this.bones, inv = this.boneInverses, out = this.boneMatrices;
    for (let i = 0; i < bones.length; i++) {
      _m.multiplyMatrices(bones[i].matrixWorld, inv[i]);
      out.set(_m.elements, i * 16);
    }
  }
  clone() { return new Skeleton(this.bones, this.boneInverses.map((m) => m.clone())); }
  getBoneByName(name) { return this.bones.find((b) => b.name === name); }
}

export class SkinnedMesh extends Mesh {
  constructor(geometry, material) {
    super(geometry, material);
    this.type = 'SkinnedMesh';
    this.bindMode = 'attached';
    this.bindMatrix = new Matrix4();
    this.bindMatrixInverse = new Matrix4();
    this.skeleton = null;
  }
  get isSkinnedMesh() { return true; }
  bind(skeleton, bindMatrix) {
    this.skeleton = skeleton;
    if (bindMatrix === undefined) {
      this.updateMatrixWorld(true);
      this.skeleton.calculateInverses();
      bindMatrix = this.matrixWorld;
    }
    this.bindMatrix.copy(bindMatrix);
    this.bindMatrixInverse.copy(bindMatrix).invert();
  }
  pose() { this.skeleton.pose(); }
  normalizeSkinWeights() {
    const w = this.geometry.attributes.skinWeight;
    for (let i = 0; i < w.count; i++) {
      const s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
      if (s !== 0) { const k = 1 / s; w.setXYZW(i, w.getX(i) * k, w.getY(i) * k, w.getZ(i) * k, w.getW(i) * k); }
      else w.setXYZW(i, 1, 0, 0, 0);
    }
  }
  updateMatrixWorld(force) {
    super.updateMatrixWorld(force);
    if (this.bindMode === 'attached') this.bindMatrixInverse.copy(this.matrixWorld).invert();
    else this.bindMatrixInverse.copy(this.bindMatrix).invert();
  }
  copy(src, recursive) { super.copy(src, recursive); this.bindMode = src.bindMode; this.bindMatrix.copy(src.bindMatrix); this.bindMatrixInverse.copy(src.bindMatrixInverse); this.skeleton = src.skeleton; return this; }
}

export class InstancedMesh extends Mesh {
  constructor(geometry, material, count) {
    super(geometry, material);
    this.type = 'InstancedMesh';
    this.count = count;
    this.instanceMatrix = new BufferAttribute(new Float32Array(count * 16), 16);
    this.instanceMatrix.usage = 'dynamic';
    this.instanceColor = null;
    this.boundingSphere = null;
    for (let i = 0; i < count; i++) this.setMatrixAt(i, _m.identity());
  }
  get isInstancedMesh() { return true; }
  setMatrixAt(i, m) { m.toArray(this.instanceMatrix.array, i * 16); }
  getMatrixAt(i, m) { return m.fromArray(this.instanceMatrix.array, i * 16); }
  setColorAt(i, c) {
    if (!this.instanceColor) this.instanceColor = Object.assign(new BufferAttribute(new Float32Array(this.count * 3).fill(1), 3), { usage: 'dynamic' });
    c.toArray(this.instanceColor.array, i * 3);
  }
  computeBoundingSphere() {
    const g = this.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    this.boundingSphere ??= new Sphere();
    this.boundingSphere.makeEmpty();
    const s = new Sphere();
    for (let i = 0; i < this.count; i++) {
      this.getMatrixAt(i, _m);
      s.copy(g.boundingSphere).applyMatrix4(_m);
      this.boundingSphere.union(s);
    }
  }
  dispose() { /* GPU buffers are released with the geometry / by the renderer's weak maps */ }
}

/**
 * A camera-facing quad with a texture: particles, glows, lens flares. NOT drawn by Med Engine 3 yet: the renderer has no transparent
 * forward pass, so a sprite stays in the scene graph (scenes that use one load and run) and is skipped when the frame is drawn.
 */
export class Sprite extends Object3D {
  /** @param {Material | null} [material]  default: an unlit, transparent StandardMaterial */
  constructor(material = null) {
    super();
    this.type = 'Sprite';
    this.material = material ?? new StandardMaterial({ unlit: true, transparent: true });
    this.center = { x: 0.5, y: 0.5 };
  }
  get isSprite() { return true; }
}

void _v;
