/**
 * Cameras. Projection matrices are WebGPU's: clip depth 0..1, and by default reversed
 * (near -> 1, far -> 0) which spreads a 32-bit float depth buffer evenly over the whole range.
 * `far` may be Infinity.
 */
import { Object3D } from './Object3D.js';
import { Matrix4, MathUtils } from '../math/core.js';

export class Camera extends Object3D {
  constructor() {
    super();
    this.type = 'Camera';
    this.matrixWorldInverse = new Matrix4();
    this.projectionMatrix = new Matrix4();
    this.projectionMatrixInverse = new Matrix4();
    this.reversedZ = true;
  }
  get isCamera() { return true; }
  updateMatrixWorld(force) { super.updateMatrixWorld(force); this.matrixWorldInverse.copy(this.matrixWorld).invert(); }
  updateWorldMatrix(p, c) { super.updateWorldMatrix(p, c); this.matrixWorldInverse.copy(this.matrixWorld).invert(); }
  getWorldDirection(t) {
    this.updateWorldMatrix(true, false);
    const e = this.matrixWorld.elements;
    return t.set(-e[8], -e[9], -e[10]).normalize();   // a camera looks down its own -Z
  }
}

export class PerspectiveCamera extends Camera {
  /** `fov` is the vertical field of view in degrees. */
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.type = 'PerspectiveCamera';
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
    this.zoom = 1;
    this.filmGauge = 35;   // mm, full-frame; used by setFocalLength
    this.view = null;
    this.updateProjectionMatrix();
  }
  get isPerspectiveCamera() { return true; }
  /** Sets the field of view from a lens focal length in millimetres (on a 35 mm wide film gate). */
  setFocalLength(mm) {
    const vExtent = (0.5 * this.getFilmHeight()) / mm;
    this.fov = MathUtils.RAD2DEG * 2 * Math.atan(vExtent);
    this.updateProjectionMatrix();
  }
  getFocalLength() { return (0.5 * this.getFilmHeight()) / Math.tan(MathUtils.DEG2RAD * 0.5 * this.fov); }
  getFilmWidth() { return this.filmGauge * Math.min(this.aspect, 1); }
  getFilmHeight() { return this.filmGauge / Math.max(this.aspect, 1); }
  /** Renders a sub-rectangle of a larger virtual image (tiles, or sub-pixel jitter). */
  setViewOffset(fullWidth, fullHeight, x, y, width, height) {
    this.view = { fullWidth, fullHeight, offsetX: x, offsetY: y, width, height };
    this.updateProjectionMatrix();
  }
  clearViewOffset() { this.view = null; this.updateProjectionMatrix(); }
  updateProjectionMatrix() {
    const near = this.near;
    let top = (near * Math.tan(MathUtils.DEG2RAD * 0.5 * this.fov)) / this.zoom, height = 2 * top, width = this.aspect * height, left = -0.5 * width;
    const v = this.view;
    if (v) {
      left += (v.offsetX * width) / v.fullWidth;
      top -= (v.offsetY * height) / v.fullHeight;
      width *= v.width / v.fullWidth;
      height *= v.height / v.fullHeight;
    }
    this.projectionMatrix.makePerspective(left, left + width, top, top - height, near, this.far, this.reversedZ);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
  copy(src, recursive) {
    super.copy(src, recursive);
    this.fov = src.fov; this.aspect = src.aspect; this.near = src.near; this.far = src.far; this.zoom = src.zoom; this.filmGauge = src.filmGauge;
    this.view = src.view ? { ...src.view } : null; this.reversedZ = src.reversedZ;
    this.updateProjectionMatrix();
    return this;
  }
}

export class OrthographicCamera extends Camera {
  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super();
    this.type = 'OrthographicCamera';
    this.left = left; this.right = right; this.top = top; this.bottom = bottom; this.near = near; this.far = far; this.zoom = 1;
    this.updateProjectionMatrix();
  }
  get isOrthographicCamera() { return true; }
  copy(src, recursive) {
    super.copy(src, recursive);
    this.left = src.left; this.right = src.right; this.top = src.top; this.bottom = src.bottom; this.near = src.near; this.far = src.far; this.zoom = src.zoom; this.reversedZ = src.reversedZ;
    this.updateProjectionMatrix();
    return this;
  }
  updateProjectionMatrix() {
    const dx = (this.right - this.left) / (2 * this.zoom), dy = (this.top - this.bottom) / (2 * this.zoom);
    const cx = (this.right + this.left) / 2, cy = (this.top + this.bottom) / 2;
    this.projectionMatrix.makeOrthographic(cx - dx, cx + dx, cy + dy, cy - dy, this.near, this.far, this.reversedZ);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
