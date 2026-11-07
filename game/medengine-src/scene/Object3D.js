/**
 * The scene graph: Object3D (a transform with children), Group and Scene.
 *
 * Every object has a local transform (position / quaternion / scale, with a linked Euler
 * `rotation`), a cached local `matrix` and a `matrixWorld`. Transforms are recomputed lazily:
 * call `scene.updateMatrixWorld()` (the renderer does, once a frame) or
 * `object.updateWorldMatrix(true, false)` when you need an exact world transform right now.
 */
import { Vector3, Quaternion, Euler, Matrix4, MathUtils } from '../math/core.js';

let _nextId = 1;
const _q = new Quaternion(), _m = new Matrix4(), _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();
const _axisX = new Vector3(1, 0, 0), _axisY = new Vector3(0, 1, 0), _axisZ = new Vector3(0, 0, 1);

export class Object3D {
  constructor() {
    this.id = _nextId++;
    this.name = '';
    this.type = 'Object3D';
    this.parent = null;
    this.children = [];
    this.up = new Vector3(0, 1, 0);

    const position = new Vector3(), rotation = new Euler(), quaternion = new Quaternion(), scale = new Vector3(1, 1, 1);
    rotation._onChange(() => quaternion.setFromEuler(rotation, false));
    quaternion._onChange(() => rotation.setFromQuaternion(quaternion, undefined, false));
    this.position = position; this.rotation = rotation; this.quaternion = quaternion; this.scale = scale;

    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.matrixAutoUpdate = true;
    this.matrixWorldAutoUpdate = true;
    this.matrixWorldNeedsUpdate = false;

    this.visible = true;
    this.castShadow = false;
    this.receiveShadow = false;
    this.frustumCulled = true;
    this.renderOrder = 0;
    /** Free-form per-object data. The engine reads a few keys: `shadowOnly`, `static`, `skip`. */
    this.userData = {};
  }
  get isObject3D() { return true; }
  get uuid() { return (this._uuid ??= MathUtils.generateUUID()); }

  // -- hierarchy ------------------------------------------------------------
  add(...objects) {
    for (const o of objects) {
      if (o === this) { console.error('Object3D.add: an object cannot be its own child'); continue; }
      if (!o?.isObject3D) { console.error('Object3D.add: not an Object3D', o); continue; }
      o.parent?.remove(o);
      o.parent = this;
      this.children.push(o);
    }
    return this;
  }
  remove(...objects) {
    for (const o of objects) {
      const i = this.children.indexOf(o);
      if (i !== -1) { o.parent = null; this.children.splice(i, 1); }
    }
    return this;
  }
  removeFromParent() { this.parent?.remove(this); return this; }
  clear() { for (const c of this.children) c.parent = null; this.children.length = 0; return this; }
  /** Re-parents while keeping the world transform. */
  attach(object) {
    this.updateWorldMatrix(true, false);
    _m.copy(this.matrixWorld).invert();
    object.updateWorldMatrix(true, false);
    if (object.parent) { object.parent.updateWorldMatrix(true, false); _m.multiply(object.parent.matrixWorld); }
    // object.matrix = inverse(this.world) * object.parent.world * object.matrix
    object.applyMatrix4(_m);
    object.parent?.remove(object);
    object.parent = this; this.children.push(object);
    object.updateWorldMatrix(false, true);
    return this;
  }
  getObjectByName(name) { return this.getObjectByProperty('name', name); }
  getObjectById(id) { return this.getObjectByProperty('id', id); }
  getObjectByProperty(key, value) {
    if (this[key] === value) return this;
    for (const c of this.children) { const r = c.getObjectByProperty(key, value); if (r) return r; }
    return undefined;
  }
  /** Calls `fn` on this object and everything below it. @param {(object: Object3D) => void} fn */
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  /** Like traverse(), skipping hidden objects and what is below them. @param {(object: Object3D) => void} fn */
  traverseVisible(fn) { if (!this.visible) return; fn(this); for (const c of this.children) c.traverseVisible(fn); }
  traverseAncestors(fn) { if (this.parent) { fn(this.parent); this.parent.traverseAncestors(fn); } }

  // -- transform ------------------------------------------------------------
  applyMatrix4(m) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    this.matrix.premultiply(m);
    this.matrix.decompose(this.position, this.quaternion, this.scale);
  }
  applyQuaternion(q) { this.quaternion.premultiply(q); return this; }
  setRotationFromAxisAngle(axis, angle) { this.quaternion.setFromAxisAngle(axis, angle); }
  setRotationFromEuler(e) { this.quaternion.setFromEuler(e, true); }
  setRotationFromQuaternion(q) { this.quaternion.copy(q); }
  rotateOnAxis(axis, angle) { _q.setFromAxisAngle(axis, angle); this.quaternion.multiply(_q); return this; }
  rotateOnWorldAxis(axis, angle) { _q.setFromAxisAngle(axis, angle); this.quaternion.premultiply(_q); return this; }
  rotateX(a) { return this.rotateOnAxis(_axisX, a); }
  rotateY(a) { return this.rotateOnAxis(_axisY, a); }
  rotateZ(a) { return this.rotateOnAxis(_axisZ, a); }
  translateOnAxis(axis, d) { _v.copy(axis).applyQuaternion(this.quaternion); this.position.addScaledVector(_v, d); return this; }
  translateX(d) { return this.translateOnAxis(_axisX, d); }
  translateY(d) { return this.translateOnAxis(_axisY, d); }
  translateZ(d) { return this.translateOnAxis(_axisZ, d); }
  localToWorld(v) { this.updateWorldMatrix(true, false); return v.applyMatrix4(this.matrixWorld); }
  worldToLocal(v) { this.updateWorldMatrix(true, false); return v.applyMatrix4(_m.copy(this.matrixWorld).invert()); }
  /** Turns the object so its -Z axis (+Z for non-camera, non-light objects) points at the target. */
  lookAt(x, y, z) {
    if (x.isVector3) _v.copy(x); else _v.set(x, y, z);
    const parent = this.parent;
    this.updateWorldMatrix(true, false);
    _v2.setFromMatrixPosition(this.matrixWorld);
    if (this.isCamera || this.isLight) _m.lookAt(_v2, _v, this.up); else _m.lookAt(_v, _v2, this.up);
    this.quaternion.setFromRotationMatrix(_m);
    if (parent) {
      _m.extractRotation(parent.matrixWorld);
      _q.setFromRotationMatrix(_m);
      this.quaternion.premultiply(_q.invert());
    }
  }
  getWorldPosition(t = new Vector3()) { this.updateWorldMatrix(true, false); return t.setFromMatrixPosition(this.matrixWorld); }
  getWorldQuaternion(t = new Quaternion()) { this.updateWorldMatrix(true, false); this.matrixWorld.decompose(_v, t, _v2); return t; }
  getWorldScale(t = new Vector3()) { this.updateWorldMatrix(true, false); this.matrixWorld.decompose(_v, _q, t); return t; }
  getWorldDirection(t = new Vector3()) {
    this.updateWorldMatrix(true, false);
    const e = this.matrixWorld.elements;
    return t.set(e[8], e[9], e[10]).normalize();
  }
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }
  updateMatrixWorld(force = false) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (!this.matrixWorldAutoUpdate) { /* user manages matrixWorld */ }
      else if (this.parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    for (const c of this.children) c.updateMatrixWorld(force);
  }
  updateWorldMatrix(updateParents, updateChildren) {
    if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false);
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldAutoUpdate) {
      if (this.parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    }
    if (updateChildren) for (const c of this.children) c.updateWorldMatrix(false, true);
  }
  /** Deep copy: geometry and materials are shared (they are resources), the hierarchy is new. */
  clone(recursive = true) { return new this.constructor().copy(this, recursive); }
  copy(src, recursive = true) {
    this.name = src.name; this.up.copy(src.up);
    this.position.copy(src.position); this.rotation.order = src.rotation.order;
    this.quaternion.copy(src.quaternion); this.scale.copy(src.scale);
    this.matrix.copy(src.matrix); this.matrixWorld.copy(src.matrixWorld);
    this.matrixAutoUpdate = src.matrixAutoUpdate; this.matrixWorldNeedsUpdate = src.matrixWorldNeedsUpdate;
    this.visible = src.visible; this.castShadow = src.castShadow; this.receiveShadow = src.receiveShadow;
    this.frustumCulled = src.frustumCulled; this.renderOrder = src.renderOrder;
    this.userData = JSON.parse(JSON.stringify(src.userData ?? {}, (k, v) => (typeof v === 'object' && v && (v.isObject3D || ArrayBuffer.isView(v)) ? undefined : v)));
    for (const k of Object.keys(src.userData ?? {})) if (this.userData[k] === undefined) this.userData[k] = src.userData[k];
    if (recursive) for (const c of src.children) this.add(c.clone());
    return this;
  }
}

export class Group extends Object3D {
  constructor() { super(); this.type = 'Group'; }
  get isGroup() { return true; }
}

/** The root of a scene. `background`/`environment` are read by the renderer when set. */
export class Scene extends Object3D {
  constructor() {
    super();
    this.type = 'Scene';
    this.background = null;
  }
  get isScene() { return true; }
}

void _v3;
