import { Vector3 } from 'three';

const _w = new Vector3();

/**
 * Cloth for flags and banners: position-based (Verlet) particles at the
 * vertices of a PlaneGeometry grid, held by distance constraints along the
 * grid (stretch), across its diagonals (shear) and two cells apart
 * (bending), pinned along the hoist or the top edge, pulled by gravity and
 * pushed by the wind on each vertex's share of the cloth (drag along the
 * normal of the relative wind, so a flag streams out and flaps rather than
 * just leaning). Jakobsen (2001), with the aerodynamic term of Provot.
 *
 * Runs on the CPU: a few hundred particles per flag is nothing next to the
 * physics, and WebGL2 has no compute shaders to move it to the GPU.
 */
export class Cloth {
  /**
   * geometry: a PlaneGeometry (in the mesh's local frame, rotated only about Y).
   * pin(x, y) -> true for vertices held fast.
   */
  constructor(geometry, { pin, widthSegments, heightSegments, mass = 0.18, drag = 1.6, stiffness = 0.9, bend = 0.25, damping = 0.985 } = {}) {
    this.geo = geometry;
    const pos = geometry.attributes.position;
    const n = pos.count;
    this.n = n;
    this.p = new Float32Array(pos.array);
    this.q = new Float32Array(pos.array);          // previous positions
    this.pinned = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.pinned[i] = pin(pos.getX(i), pos.getY(i)) ? 1 : 0;
    this.mass = mass / n; this.drag = drag; this.damping = damping;   // mass: the whole cloth, kg
    const nx = widthSegments + 1, ny = heightSegments + 1;
    const cons = [];
    const add = (a, b, k) => {
      const dx = this.p[a * 3] - this.p[b * 3], dy = this.p[a * 3 + 1] - this.p[b * 3 + 1], dz = this.p[a * 3 + 2] - this.p[b * 3 + 2];
      cons.push(a, b, Math.hypot(dx, dy, dz), k);
    };
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      if (x + 1 < nx) add(i, i + 1, stiffness);
      if (y + 1 < ny) add(i, i + nx, stiffness);
      if (x + 1 < nx && y + 1 < ny) { add(i, i + nx + 1, stiffness * 0.6); add(i + 1, i + nx, stiffness * 0.6); }
      if (x + 2 < nx) add(i, i + 2, bend);
      if (y + 2 < ny) add(i, i + 2 * nx, bend);
    }
    this.c = new Float32Array(cons);
    // each vertex's share of the area
    const w = geometry.parameters?.width ?? 1, h = geometry.parameters?.height ?? 1;
    this.area = (w * h) / n;
    this.normals = geometry.attributes.normal;
  }

  /** Advance by dt seconds with a wind vector in the cloth's local frame (m/s). */
  step(dt, wind) {
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;
    const subs = 2, h = dt / subs;
    const { p, q, pinned, n } = this;
    const N = this.normals.array;
    const kA = (this.drag * this.area * 1.2) / this.mass;   // 1.2 kg/m³ air
    for (let s = 0; s < subs; s++) {
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const i3 = i * 3;
        const vx = (p[i3] - q[i3]) / h, vy = (p[i3 + 1] - q[i3 + 1]) / h, vz = (p[i3 + 2] - q[i3 + 2]) / h;
        // drag of the relative wind along the normal
        const rx = wind.x - vx, ry = wind.y - vy, rz = wind.z - vz;
        const nx = N[i3], ny = N[i3 + 1], nz = N[i3 + 2];
        const dn = rx * nx + ry * ny + rz * nz;
        const f = kA * dn * Math.abs(dn) * 0.5;
        // a little drag along the cloth too, so it trails
        const ax = f * nx + rx * 0.6, ay = f * ny - 9.81 + ry * 0.6, az = f * nz + rz * 0.6;
        if (!(ax === ax)) continue;
        const d = this.damping;
        const nxp = p[i3] + (p[i3] - q[i3]) * d + ax * h * h;
        const nyp = p[i3 + 1] + (p[i3 + 1] - q[i3 + 1]) * d + ay * h * h;
        const nzp = p[i3 + 2] + (p[i3 + 2] - q[i3 + 2]) * d + az * h * h;
        q[i3] = p[i3]; q[i3 + 1] = p[i3 + 1]; q[i3 + 2] = p[i3 + 2];
        p[i3] = nxp; p[i3 + 1] = nyp; p[i3 + 2] = nzp;
      }
      const c = this.c;
      for (let it = 0; it < 4; it++) {
        for (let k = 0; k < c.length; k += 4) {
          const a = c[k] * 3, b = c[k + 1] * 3, rest = c[k + 2], st = c[k + 3];
          const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const pa = pinned[c[k]], pb = pinned[c[k + 1]];
          if (pa && pb) continue;
          const corr = ((len - rest) / len) * st * (pa || pb ? 1 : 0.5);
          if (!pa) { p[a] += dx * corr; p[a + 1] += dy * corr; p[a + 2] += dz * corr; }
          if (!pb) { p[b] -= dx * corr; p[b + 1] -= dy * corr; p[b + 2] -= dz * corr; }
        }
      }
    }
    this.geo.attributes.position.array.set(p);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}

/** A gusty wind, world space: a steady breeze from the west-south-west with gusts and veers. */
export function windAt(t, out = _w, strength = 1) {
  const g = 0.65 + 0.35 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1.7) + 0.25 * Math.sin(t * 1.9) * Math.sin(t * 0.71);
  const veer = 0.35 * Math.sin(t * 0.11) + 0.12 * Math.sin(t * 0.53);
  const v = 5.5 * strength * Math.max(0.15, g);
  return out.set(Math.cos(0.4 + veer) * v, 0.3 * Math.sin(t * 0.9), Math.sin(0.4 + veer) * v);
}
