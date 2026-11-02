/**
 * A road car's body as one smooth surface, cut into its real panels.
 *
 * The surface S(z, s): at each station along the car a cross-section is built from the car's
 * silhouettes (roof or bonnet line, belt line, shoulder width, roof width, sill), and s runs round
 * it: 0 at the left sill, up the side, over the roof to 1 at the centre line, down the right side to
 * 2. Wheel arches are cut by raising the bottom of the side over each wheel. The underside is open,
 * as a real body's engine bay is; the cabin floor is its own pan.
 *
 * Panels are rectangles in (z, s): the bonnet, the boot lid (or the tailgate), four doors; the
 * rest is the shell (wings, roof, pillars, sills). Each gets a 4 mm shut line. Glass is wherever a
 * window is: the windscreen and the rear window over the roof band, the door glass in the side band.
 * Profiles: docs/references.md (dimensions from the makers' data, the shapes traced by eye).
 */
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

// stations: [z, roof/bonnet/boot top, belt line, shoulder half-width, roof half-width, sill]
const PROFILES = {
  volvo240: {
    st: [[-2.485, 0.84, 0.84, 0.82, 0.8, 0.32], [-2.42, 0.95, 0.95, 0.85, 0.8, 0.3], [-1.6, 0.99, 0.97, 0.857, 0.8, 0.28], [-1.5, 1.08, 0.97, 0.857, 0.66, 0.28],
      [-1.0, 1.405, 0.96, 0.857, 0.63, 0.27], [0.12, 1.42, 0.95, 0.857, 0.63, 0.27], [0.62, 0.95, 0.93, 0.855, 0.8, 0.28], [0.7, 0.93, 0.93, 0.855, 0.8, 0.28],
      [1.6, 0.885, 0.885, 0.85, 0.8, 0.3], [2.22, 0.84, 0.84, 0.84, 0.8, 0.32], [2.3, 0.8, 0.8, 0.82, 0.78, 0.34]],
    cowl: 0.66, roofF: 0.12, roofR: -1.0, trunkF: -1.55, front: 2.3, rear: -2.485,
    doors: { F: [-0.43, 0.64], R: [-1.02, -0.45] }, hatch: false, crown: 0.02, archR: 0.37,
  },
  golf7: {
    st: [[-2.0565, 1.04, 0.98, 0.84, 0.62, 0.38], [-2.0, 1.2, 0.98, 0.87, 0.64, 0.33], [-1.82, 1.36, 0.97, 0.89, 0.65, 0.3], [-1.5, 1.44, 0.96, 0.895, 0.66, 0.29],
      [-0.05, 1.452, 0.94, 0.895, 0.67, 0.29], [0.74, 0.93, 0.92, 0.89, 0.83, 0.3], [0.8, 0.915, 0.915, 0.89, 0.83, 0.3], [1.7, 0.86, 0.86, 0.875, 0.82, 0.32],
      [2.02, 0.79, 0.79, 0.84, 0.78, 0.34], [2.13, 0.71, 0.71, 0.8, 0.74, 0.36], [2.2, 0.6, 0.6, 0.74, 0.68, 0.38]],
    cowl: 0.78, roofF: -0.05, roofR: -1.5, trunkF: -1.5, front: 2.2, rear: -2.0565,
    doors: { F: [-0.32, 0.74], R: [-0.97, -0.34] }, hatch: true, crown: 0.025, archR: 0.37,
  },
};

const U = [0, 0.06, 0.2, 0.34, 0.42, 0.56, 0.7, 0.8, 1];        // where each key point of a half-section sits in s
export const BAND = { belt: 0.42, ghTop: 0.7 };

const lerp = (a, b, t) => a + (b - a) * t;

export class BodyShape {
  constructor(spec) {
    this.spec = spec;
    this.P = PROFILES[spec.id];
    this.wb = spec.dims.wheelbase;
    this.wheelY = spec.wheels.tyreR;
  }

  station(z) {
    const st = this.P.st;
    if (z <= st[0][0]) return st[0];
    for (let i = 1; i < st.length; i++) if (z <= st[i][0]) { const a = st[i - 1], b = st[i], t = (z - a[0]) / (b[0] - a[0]); return a.map((v, k) => lerp(v, b[k], t)); }
    return st[st.length - 1];
  }

  /** How high the side's bottom edge is at z: the sill, or the wheel arch over a wheel. */
  bottom(z, sill) {
    const R = this.P.archR;
    for (const zw of [this.wb / 2, -this.wb / 2]) { const dz = z - zw; if (Math.abs(dz) < R) return Math.max(sill, this.wheelY + Math.sqrt(R * R - dz * dz)); }
    return sill;
  }

  /** The point of the surface at (z, s); s 0..2 (left sill, roof centre, right sill). */
  at(z, s, out = new Vector3()) {
    const [, top, belt0, hw, rhw0, sill] = this.station(z);
    const belt = Math.min(belt0, top);
    const yb = this.bottom(z, sill);
    const gh = Math.max(0, Math.min(1, (top - belt) / 0.3));
    const rhw = lerp(hw - 0.06, rhw0, gh);
    const crown = this.P.crown * (0.4 + 0.6 * gh);
    const pts = [[hw - 0.035, yb], [hw, Math.min(yb + 0.06, belt - 0.1)], [hw + 0.012, lerp(yb, belt, 0.45)], [hw, belt - 0.06], [hw - 0.03, belt],
      [lerp(hw - 0.03, rhw + 0.02, 0.6), lerp(belt, top, 0.5)], [rhw, lerp(belt, top, 0.92)], [rhw - 0.08, top], [0, top + crown]];
    const u = s <= 1 ? s : 2 - s;
    let i = 1; while (i < U.length - 1 && u > U[i]) i++;
    const t = (u - U[i - 1]) / (U[i] - U[i - 1]);
    const x = lerp(pts[i - 1][0], pts[i][0], t), y = lerp(pts[i - 1][1], pts[i][1], t);
    return out.set(s <= 1 ? x : -x, y, z);
  }

  /** The panels as rectangles in (z, s). */
  panels() {
    const P = this.P, g = 0.004, gs = 0.004;
    const out = [];
    out.push({ id: 'hood', z: [P.cowl + g, P.front - 0.03], s: [BAND.belt, 2 - BAND.belt] });
    out.push({ id: 'trunk', z: [P.rear + (P.hatch ? 0 : 0.04), (P.hatch ? P.roofR : P.trunkF) - g], s: P.hatch ? [0.36, 1.64] : [BAND.belt, 2 - BAND.belt] });
    for (const [side, s0, s1] of [['L', 0.03, BAND.ghTop - gs], ['R', 2 - BAND.ghTop + gs, 1.97]]) {
      out.push({ id: 'doorF' + side, z: [P.doors.F[0] + g, P.doors.F[1] - g], s: [s0, s1] });
      out.push({ id: 'doorR' + side, z: [P.doors.R[0] + g, P.doors.R[1] - g], s: [s0, s1] });
    }
    return out;
  }

  /** Is the surface at (z, s) glass? */
  glass(z, s) {
    const P = this.P, u = s <= 1 ? s : 2 - s;
    if (u >= BAND.ghTop + 0.02) {               // the roof band: windscreen and rear window
      if (z > P.roofF + 0.04 && z < P.cowl - 0.03) return true;
      if (!P.hatch && z < P.roofR - 0.04 && z > P.trunkF + 0.05) return true;
      if (P.hatch && z < P.roofR - 0.04 && z > P.rear + 0.12) return true;
      return false;
    }
    if (u > BAND.belt + 0.03 && u < BAND.ghTop - 0.025) {    // the side band: door glass (and the quarter lights)
      const { F, R } = P.doors;
      if (z > F[0] + 0.05 && z < Math.min(F[1], P.cowl) - 0.08) return true;
      if (z > R[0] + 0.05 && z < R[1] - 0.05) return true;
      if (P.hatch && z > R[0] - 0.5 && z < R[0] - 0.05 && z > P.roofR + 0.05) return true;
    }
    return false;
  }

  /**
   * Geometry for a region (z0..z1, s0..s1), split into materials: 0 paint, 1 glass, 2 black trim
   * (the window frames' rubber), relative to `origin`. Normals from the surface itself.
   */
  patch(z0, z1, s0, s1, origin = [0, 0, 0], test = null) {
    const nz = Math.max(2, Math.ceil((z1 - z0) / 0.06)), ns = Math.max(2, Math.ceil((s1 - s0) / 0.025));
    const tri = [[], [], []], nrm = [[], [], []], uvs = [[], [], []];
    const p = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3();
    // the parameterisation runs the same way everywhere (s up the left side, over the roof, down the
    // right; z forward), so ds × dz points out of the body everywhere: one winding, one normal rule
    const normal = (z, s, out) => {
      const ez = 0.01;
      let es = 0.012;
      this.at(z + ez, s, a); this.at(z - ez, s, b); a.sub(b);
      do { this.at(z, Math.min(2, s + es), c); this.at(z, Math.max(0, s - es), d); c.sub(d); es *= 2; } while (c.lengthSq() < 1e-8 && es < 0.2);
      return out.crossVectors(c, a).normalize();
    };
    const v = new Vector3(), n = new Vector3();
    const push = (k, z, s) => { this.at(z, s, v); normal(z, s, n); tri[k].push(v.x - origin[0], v.y - origin[1], v.z - origin[2]); nrm[k].push(n.x, n.y, n.z); uvs[k].push(z, s); };
    for (let i = 0; i < nz; i++) for (let j = 0; j < ns; j++) {
      const za = lerp(z0, z1, i / nz), zb = lerp(z0, z1, (i + 1) / nz), sa = lerp(s0, s1, j / ns), sb = lerp(s0, s1, (j + 1) / ns);
      const zc = (za + zb) / 2, sc = (sa + sb) / 2;
      if (test && !test(zc, sc)) continue;
      const k = this.glass(zc, sc) ? 1 : 0;
      const quad = [[za, sa], [za, sb], [zb, sa], [zb, sa], [za, sb], [zb, sb]];
      for (const [z, s] of quad) push(k, z, s);
    }
    return mergeTri(tri, nrm, uvs);
  }

  /** The end faces (the nose under the grille, the tail panel): a fan from the middle. */
  cap(front, origin = [0, 0, 0]) {
    const z = front ? this.P.front : this.P.rear;
    const ring = [];
    for (let i = 0; i <= 80; i++) ring.push(this.at(z, (i / 80) * 2));
    const mid = this.station(z), c = new Vector3(0, (mid[1] + mid[5]) / 2, z);
    const pos = [], nor = [], uv = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const tri = front ? [c, ring[i], ring[i + 1]] : [c, ring[i + 1], ring[i]];
      for (const q of tri) { pos.push(q.x - origin[0], q.y - origin[1], q.z - origin[2]); nor.push(0, 0, front ? 1 : -1); uv.push(q.x, q.y); }
    }
    // the bottom edge closed straight across
    const l = ring[0], r = ring[ring.length - 1];
    for (const q of front ? [c, r, l] : [c, l, r]) { pos.push(q.x - origin[0], q.y - origin[1], q.z - origin[2]); nor.push(0, 0, front ? 1 : -1); uv.push(0, 0); }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.addGroup(0, pos.length / 3, 0);
    return g;
  }

  /** Where a panel hinges, and about which axis (car frame). */
  hinge(id) {
    const P = this.P;
    if (id === 'hood') { const st = this.station(P.cowl); return { pivot: [0, st[1], P.cowl], axis: 'x', sign: -1 }; }
    if (id === 'trunk') { const z = P.hatch ? P.roofR : P.trunkF; return { pivot: [0, this.station(z)[1], z], axis: 'x', sign: 1 }; }
    const side = id.endsWith('L') ? 1 : -1, row = id[4];
    const z1 = P.doors[row][1], hw = this.station(z1)[3];
    return { pivot: [side * hw, 0.6, z1], axis: 'y', sign: side > 0 ? -1 : 1 };
  }
}

function mergeTri(tri, nrm, uvs) {
  const pos = [], nor = [], uv = [], groups = [];
  for (let k = 0; k < 3; k++) {
    if (!tri[k].length) continue;
    groups.push({ start: pos.length / 3, count: tri[k].length / 3, mat: k });
    pos.push(...tri[k]); nor.push(...nrm[k]); uv.push(...uvs[k]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  for (const gr of groups) g.addGroup(gr.start, gr.count, gr.mat);
  return g;
}

export const BODY_PROFILES = PROFILES;
