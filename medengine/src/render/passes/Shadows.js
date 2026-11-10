/**
 * Cascaded shadow maps for the sun: practical split scheme, each cascade a bounding sphere of its
 * frustum slice (rotation-invariant size) snapped to whole texels so shadows do not crawl as the
 * camera moves. On top of the cascades an optional focus map: one more layer fitted tightly around
 * what matters most on screen (`focus`: the fighters, the player and the people beside them). A
 * 2048 map over a 3 m sphere gives texels of about 1.5 mm, ten times finer than the first cascade,
 * so the shadows of a blade, fingers or a hood's edge are sharp where you look.
 *
 * Depth is stored non-reversed (near 0, far 1) and compared with a `less-equal` sampler.
 */
import { Matrix4, Vector3, Vector4 } from '../../math/core.js';
import { TEX } from '../../gpu/Device.js';
import { createTexture } from '../../gpu/Resources.js';
import { MAX_CASCADES } from '../shaders/common.js';

export const FOCUS = 4;   // the array layer of the focus map

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _c = new Vector3(), _up = new Vector3(0, 1, 0), _p = new Vector4();
const _view = new Matrix4(), _inv = new Matrix4(), _vinv = new Matrix4();

class Cascade {
  constructor() { this.view = new Matrix4(); this.proj = new Matrix4(); this.vp = new Matrix4(); this.center = new Vector3(); this.radius = 1; this.texel = 0; }
}

export class Shadows {
  constructor(gpu, { size = 2048, cascades = 4, distance = 70 } = {}) {
    this.gpu = gpu; this.size = size; this.n = cascades; this.distance = distance;
    this.layers = MAX_CASCADES;
    this.matrices = new Float32Array(16 * MAX_CASCADES);
    this.splits = new Float32Array(4);
    this.texel = new Float32Array(4);
    this.focus = null;          // { center: Vector3, radius } or null
    this.focusOn = 0; this.focusTexel = 0;
    this.cascades = Array.from({ length: cascades }, () => new Cascade());
    this.focusCascade = new Cascade();
    this._alloc();
  }

  _alloc() {
    this.map?.destroy();
    this.map = createTexture(this.gpu, { width: this.size, height: this.size, layers: this.layers, format: 'depth32float', usage: TEX.RENDER | TEX.COPY_SRC, label: 'sun shadow maps' });
    this.view = this.map.createView({ dimension: '2d-array' });
    this.layerViews = Array.from({ length: this.layers }, (_, i) => this.map.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
  }

  resize(size, cascades = this.n) {
    if (size !== this.size) { this.size = size; this._alloc(); }
    if (cascades !== this.n) { this.n = cascades; this.cascades = Array.from({ length: cascades }, () => new Cascade()); }
  }

  /** Fits the cascades to the camera's view frustum. */
  fit(camera, sunDir) {
    const near = camera.near, far = Math.min(camera.far, this.distance);
    const lambda = 0.78;
    const splits = [near];
    for (let i = 1; i <= this.n; i++) {
      const f = i / this.n;
      splits.push(lambda * near * Math.pow(far / near, f) + (1 - lambda) * (near + (far - near) * f));
    }
    _inv.copy(camera.projectionMatrix).invert();
    const camWorld = camera.matrixWorld;
    const up = Math.abs(sunDir.y) > 0.99 ? _v3.set(1, 0, 0) : _up;
    for (let i = 0; i < this.n; i++) {
      const c = this.cascades[i];
      const zn = splits[i], zf = splits[i + 1];
      // corners of the slice in view space, from the projection's inverse at the slice depths
      const corners = [];
      for (const z of [zn, zf]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
        _p.set(x, y, 0.5, 1).applyMatrix4(_inv);
        const v = new Vector3(_p.x / _p.w, _p.y / _p.w, _p.z / _p.w);
        v.multiplyScalar(z / -v.z);
        corners.push(v.applyMatrix4(camWorld));
      }
      _c.set(0, 0, 0);
      for (const p of corners) _c.add(p);
      _c.multiplyScalar(1 / 8);
      let r = 0;
      for (const p of corners) r = Math.max(r, p.distanceTo(_c));
      r = Math.ceil(r * 16) / 16;
      this._place(c, _c, r, sunDir, up, 120);
      this.matrices.set(c.vp.elements, i * 16);
      this.splits[i] = splits[i + 1];
      this.texel[i] = c.texel;
    }
    for (let i = this.n; i < 4; i++) { this.splits[i] = 0; this.texel[i] = this.texel[Math.max(0, this.n - 1)]; }
    this._fitFocus(sunDir, up);
  }

  /** Positions cascade `c` around `centerWorld` with radius r, snapping to the texel grid in light space. */
  _place(c, centerWorld, r, sunDir, up, back) {
    _view.lookAt(_v.set(0, 0, 0), _v2.copy(sunDir).negate(), up);
    const texel = (2 * r) / this.size;
    _vinv.copy(_view).invert();
    const ls = new Vector3().copy(centerWorld).applyMatrix4(_vinv);
    ls.x = Math.floor(ls.x / texel) * texel;
    ls.y = Math.floor(ls.y / texel) * texel;
    const centre = ls.applyMatrix4(_view);
    const eye = centre.clone().addScaledVector(sunDir, back);
    c.view.lookAt(eye, centre, up);
    c.view.setPosition(eye);
    c.view.invert();
    c.proj.makeOrthographic(-r, r, r, -r, 0.1, back + r * 2, false);
    c.vp.multiplyMatrices(c.proj, c.view);
    c.center.copy(centre); c.radius = r; c.texel = texel;
  }

  /** The focus map: a tight ortho box around `focus`, texel-snapped. */
  _fitFocus(sunDir, up) {
    const f = this.focus;
    this.focusOn = f && f.radius > 0 ? 1 : 0;
    if (!this.focusOn) return;
    const c = this.focusCascade;
    const r = Math.ceil(f.radius * 32) / 32;
    this._place(c, f.center, r, sunDir, up, 60);
    this.matrices.set(c.vp.elements, FOCUS * 16);
    this.focusTexel = c.texel;
  }

  /**
   * Renders every cascade. `draw(pass, cascade, index)` records the casters into the pass; the pass
   * has the layer's depth attachment bound.
   */
  render(enc, draw) {
    const run = (layer, cascade, index, label) => {
      const pass = enc.beginRenderPass({
        label, colorAttachments: [],
        depthStencilAttachment: { view: this.layerViews[layer], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      draw(pass, cascade, index);
      pass.end();
    };
    for (let i = 0; i < this.n; i++) run(i, this.cascades[i], i, `shadow cascade ${i}`);
    if (this.focusOn) run(FOCUS, this.focusCascade, FOCUS, 'shadow focus');
    else run(FOCUS, null, -1, 'shadow focus (clear)');   // keep the layer defined (cleared to 1 = lit)
  }
}
