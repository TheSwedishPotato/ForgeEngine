/**
 * The sea floor round the boat: a patch of terrain (1.2 km across, 4 m apart) from seabed.js,
 * rebuilt as the boat moves on. Sand pale, the reef and rock darker, coral heads with their
 * colours (which the water takes away with depth: red first).
 */
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Mesh, MeshStandardMaterial, Color } from 'three';
import { canvasTex } from './hullGL.js';

const N = 300, STEP = 4;

export class SeabedGL {
  constructor(stage, seabed) {
    this.stage = stage; this.bed = seabed;
    const sand = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#bdb090'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { const s = 140 + Math.random() * 90; g.fillStyle = `rgba(${s},${s * 0.93},${s * 0.78},${0.25 + Math.random() * 0.4})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(70,62,50,${Math.random() * 0.25})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 0, 7); g.fill(); }
    });
    sand.repeat?.set?.(1, 1);
    this.mat = new MeshStandardMaterial({ map: sand, vertexColors: true, roughness: 0.95 });
    this.mesh = null;
    this.centre = null;
  }

  /** Rebuilds the patch when the boat has gone 200 m from its centre. X, Z: sea coordinates. */
  update(X, Z) {
    if (this.centre && Math.hypot(X - this.centre[0], Z - this.centre[1]) < 200) return;
    const cx = Math.round(X / STEP) * STEP, cz = Math.round(Z / STEP) * STEP;
    this.centre = [cx, cz];
    const P = new Float32Array(N * N * 3), C = new Float32Array(N * N * 3), UV = new Float32Array(N * N * 2), H = new Float32Array(N * N);
    const half = (N - 1) * STEP / 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const X1 = cx - half + i * STEP, Z1 = cz - half + j * STEP, k = j * N + i;
      const d = this.bed.depth(X1, Z1);
      H[k] = -d;
      P.set([X1 - cx, -d, Z1 - cz], k * 3);
      UV.set([X1 / 6, Z1 / 6], k * 2);
      const r = this.bed.kind(X1, Z1);
      const n = (Math.sin(X1 * 0.37) * Math.sin(Z1 * 0.29) + 1) * 0.5;
      // sand, rock, and a little coral colour on the reef
      const sand = [0.95, 0.9, 0.78], rock = [0.38, 0.36, 0.33], coral = [0.75 + 0.2 * n, 0.45, 0.4 + 0.3 * (1 - n)];
      const k2 = Math.min(1, r), cor = r > 0.4 && d < 60 ? 0.35 * n : 0;
      for (let q = 0; q < 3; q++) C[k * 3 + q] = (sand[q] * (1 - k2) + rock[q] * k2) * (1 - cor) + coral[q] * cor;
    }
    const Nn = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(N - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * N + i], hu = H[Math.min(N - 1, j + 1) * N + i];
      const nx = hl - hr, nz = hd - hu, ny = 2 * STEP, l = Math.hypot(nx, ny, nz);
      Nn.set([nx / l, ny / l, nz / l], k * 3);
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let t = 0;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx.set([a, c, b, b, c, d], t); t += 6;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(Nn, 3));
    geo.setAttribute('color', new Float32BufferAttribute(C, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(UV, 2));
    geo.setIndex(new Uint32BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    if (this.mesh) { this.stage.scene.remove(this.mesh); this.stage.anchored.delete(this.mesh); this.mesh.geometry.dispose(); }
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.stage.scene.add(this.mesh);
    this.stage.anchor(this.mesh, cx, 0, cz);
  }
}
