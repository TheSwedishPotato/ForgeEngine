import { BufferGeometry, BufferAttribute, Mesh, MeshPhysicalMaterial, CanvasTexture, DoubleSide, Vector3 } from 'three';

/**
 * Cloth on the CPU (Verlet integration, position-based constraints): capes and coat tails.
 * A grid of particles whose top row is pinned to anchor points (the shoulders); structural,
 * shear and bending constraints; collision with body capsules and the ground; wind with a
 * drag term along the cloth normal, so it billows and snaps. The result is an ordinary mesh
 * the renderer draws like any other (materials, wetness, shadows), updated every frame.
 * A few hundred particles cost well under a millisecond.
 */
export class Cloth {
  constructor({ w = 18, h = 26, width = 1.0, length = 1.3, material = null, scallops = 0, scallopDepth = 0.08 } = {}) {
    this.w = w; this.h = h; this.width = width; this.length = length;
    const n = w * h;
    this.p = new Float32Array(n * 3); this.q = new Float32Array(n * 3);   // now, previous
    this.anchors = new Float32Array(w * 3);
    this.caps = [];
    this.ground = -1e9;
    this.wind = new Vector3();
    this.started = false;
    this.restX = width / (w - 1); this.restY = length / (h - 1);
    const geo = new BufferGeometry();
    this.pos = new BufferAttribute(new Float32Array(n * 3), 3); this.pos.setUsage(35048);
    this.nor = new BufferAttribute(new Float32Array(n * 3), 3); this.nor.setUsage(35048);
    const uv = new Float32Array(n * 2), idx = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { uv[(j * w + i) * 2] = i / (w - 1); uv[(j * w + i) * 2 + 1] = 1 - j / (h - 1); }
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i; idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); }
    geo.setAttribute('position', this.pos); geo.setAttribute('normal', this.nor); geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.boundingSphere = null;
    const mat = material ?? new MeshPhysicalMaterial({ color: 0x08080a, roughness: 0.6, sheen: 0.3, side: DoubleSide });
    mat.side = DoubleSide;
    if (scallops) { mat.map = scallopMask(scallops, scallopDepth); mat.alphaTest = 0.5; }
    mat.userData.medType ??= 'cloth';
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = 'cloth';
  }

  setAnchors(left, right, back) {
    const w = this.w;
    for (let i = 0; i < w; i++) {
      const t = i / (w - 1), bow = 0.05 * (1 - (2 * t - 1) ** 2);
      this.anchors[i * 3] = left.x + (right.x - left.x) * t + back.x * bow;
      this.anchors[i * 3 + 1] = left.y + (right.y - left.y) * t + 0.015 * (1 - (2 * t - 1) ** 2);
      this.anchors[i * 3 + 2] = left.z + (right.z - left.z) * t + back.z * bow;
    }
    this.back = back.clone();
  }

  reset() {
    const { w, h, p, q } = this;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 3;
      p[o] = this.anchors[i * 3] + (this.back?.x ?? 0) * 0.04 * j / h;
      p[o + 1] = this.anchors[i * 3 + 1] - j * this.restY;
      p[o + 2] = this.anchors[i * 3 + 2] + (this.back?.z ?? 0) * 0.04 * j / h;
    }
    q.set(p);
    this.started = true;
  }

  step(dt) {
    if (!this.started) this.reset();
    const { w, h, p, q } = this;
    // a big jump of the anchors (a cut, a teleport): lay the cloth out again
    if (Math.hypot(p[0] - this.anchors[0], p[1] - this.anchors[1], p[2] - this.anchors[2]) > 0.6) this.reset();
    const sub = 2, hdt = Math.min(dt, 1 / 30) / sub;
    for (let s = 0; s < sub; s++) {
      this._normals();
      const N = this.nor.array;
      for (let k = w; k < w * h; k++) {
        const o = k * 3;
        const vx = (p[o] - q[o]) / hdt, vy = (p[o + 1] - q[o + 1]) / hdt, vz = (p[o + 2] - q[o + 2]) / hdt;
        const rx = this.wind.x - vx, ry = this.wind.y - vy, rz = this.wind.z - vz;
        const rn = rx * N[o] + ry * N[o + 1] + rz * N[o + 2];
        const ax = N[o] * rn * Math.abs(rn) * 0.5 + rx * 0.12, ay = -9.81 + N[o + 1] * rn * Math.abs(rn) * 0.5 + ry * 0.12, az = N[o + 2] * rn * Math.abs(rn) * 0.5 + rz * 0.12;
        for (let c = 0; c < 3; c++) {
          const x = p[o + c];
          p[o + c] = x + (x - q[o + c]) * 0.985 + [ax, ay, az][c] * hdt * hdt;
          q[o + c] = x;
        }
      }
      for (let i = 0; i < w; i++) { p[i * 3] = this.anchors[i * 3]; p[i * 3 + 1] = this.anchors[i * 3 + 1]; p[i * 3 + 2] = this.anchors[i * 3 + 2]; q[i * 3] = p[i * 3]; q[i * 3 + 1] = p[i * 3 + 1]; q[i * 3 + 2] = p[i * 3 + 2]; }
      for (let it = 0; it < 6; it++) {
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const a = j * w + i;
          if (i + 1 < w) this._link(a, a + 1, this.restX, 1);
          if (j + 1 < h) this._link(a, a + w, this.restY, 1);
          if (i + 1 < w && j + 1 < h) { this._link(a, a + w + 1, Math.hypot(this.restX, this.restY), 0.4); this._link(a + 1, a + w, Math.hypot(this.restX, this.restY), 0.4); }
          if (j + 2 < h) this._link(a, a + 2 * w, this.restY * 2, 0.3);
          if (i + 2 < w) this._link(a, a + 2, this.restX * 2, 0.15);
        }
        this._collide();
      }
    }
    this.pos.array.set(p);
    this.pos.needsUpdate = true;
    this._normals();
    this.nor.needsUpdate = true;
  }

  _link(a, b, rest, k) {
    const p = this.p, A = a * 3, B = b * 3;
    const dx = p[B] - p[A], dy = p[B + 1] - p[A + 1], dz = p[B + 2] - p[A + 2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) return;
    const diff = (l - rest) / l * k;
    const wa = a < this.w ? 0 : 0.5, wb = b < this.w ? 0 : 0.5;
    const tot = wa + wb || 1;
    const fa = diff * (wa / tot), fb = diff * (wb / tot);
    p[A] += dx * fa; p[A + 1] += dy * fa; p[A + 2] += dz * fa;
    p[B] -= dx * fb; p[B + 1] -= dy * fb; p[B + 2] -= dz * fb;
  }

  _collide() {
    const p = this.p, n = this.w * this.h;
    for (let k = this.w; k < n; k++) {
      const o = k * 3;
      for (const c of this.caps) {
        const ax = c.a.x, ay = c.a.y, az = c.a.z, bx = c.b.x - ax, by = c.b.y - ay, bz = c.b.z - az;
        const px = p[o] - ax, py = p[o + 1] - ay, pz = p[o + 2] - az;
        const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz + 1e-9)));
        const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
        const d = Math.hypot(dx, dy, dz), r = c.r + 0.02;
        if (d < r && d > 1e-6) { const s = r / d; p[o] = ax + bx * t + dx * s; p[o + 1] = ay + by * t + dy * s; p[o + 2] = az + bz * t + dz * s; }
      }
      if (p[o + 1] < this.ground + 0.01) p[o + 1] = this.ground + 0.01;
    }
  }

  _normals() {
    const { w, h, p } = this, N = this.nor.array;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const a = (j * w + i) * 3;
      const r = (j * w + Math.min(i + 1, w - 1)) * 3, l = (j * w + Math.max(i - 1, 0)) * 3;
      const d = (Math.min(j + 1, h - 1) * w + i) * 3, u = (Math.max(j - 1, 0) * w + i) * 3;
      const ex = p[r] - p[l], ey = p[r + 1] - p[l + 1], ez = p[r + 2] - p[l + 2];
      const fx = p[d] - p[u], fy = p[d + 1] - p[u + 1], fz = p[d + 2] - p[u + 2];
      let nx = fy * ez - fz * ey, ny = fz * ex - fx * ez, nz = fx * ey - fy * ex;
      const len = Math.hypot(nx, ny, nz) || 1;
      N[a] = nx / len; N[a + 1] = ny / len; N[a + 2] = nz / len;
    }
  }
}

/** Alpha mask for a scalloped hem: arcs between points along the bottom edge (v = 0). */
function scallopMask(count, depth) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 512);
  x.globalCompositeOperation = 'destination-out';
  const seg = 512 / count, dpx = depth * 512 / 1;
  for (let k = 0; k < count; k++) {
    x.beginPath();
    x.ellipse(seg * (k + 0.5), 512 + dpx * 0.15, seg * 0.52, dpx * 1.15, 0, Math.PI, 0);
    x.fill();
  }
  return new CanvasTexture(c);
}
