/**
 * Doc Brown's conversion of the DMC-12 (Back to the Future, 1985): the engine cover's louvres
 * gone and its deck covered in hardware. At the back, the nuclear reactor: a black finned
 * drum whose plutonium chamber is shut by a round lid (a 1976 Dodge Polara hubcap, per the
 * replica builders); in Part II Mr. Fusion stands on it instead. Either side of it the two big
 * cooling vents, which breathe white vapour after a jump; rows of capacitors with blue caps,
 * heat sinks, a glass tube between elbows, flexible steel hoses. Along each side a bundle of
 * conduit and coloured wire runs from a riveted box on the front bumper's corner, round the
 * lip of the front wheel arch, along a ribbed plate on the sill, round the rear arch and up
 * to the vents; across the front bumper an aluminium bar.
 *
 * (From photographs of the cars at the Petersen museum and Universal, and of a screen-accurate
 * replica: Wikimedia Commons. Where the photographs say nothing the layout is a reasoned guess.)
 */
import { Group, Vector3, CatmullRomCurve3, Matrix4 } from 'three';
import { Builder } from './geom.js';
import { rowAt, DIM } from './body.js';
import { labelTexture } from './textures.js';
import { Mesh, PlaneGeometry, MeshStandardMaterial } from 'three';

const V = (x, y, z) => new Vector3(x, y, z);

/** A tube of radius r along a smooth curve through pts (parallel-transport frames). */
export function tube(b, name, pts, r, { segs = 8, steps = null, closed = false } = {}) {
  const curve = new CatmullRomCurve3(pts, closed, 'catmullrom', 0.5);
  const n = steps ?? Math.max(4, Math.ceil(curve.getLength() / 0.03));
  const frames = curve.computeFrenetFrames(n, closed);
  const P = [], N = [];
  for (let i = 0; i <= n; i++) {
    const c = curve.getPointAt(i / n);
    const ring = [], nr = [];
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const nn = new Vector3().addScaledVector(frames.normals[i], Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      ring.push(c.clone().addScaledVector(nn, r)); nr.push(nn);
    }
    P.push(ring); N.push(nr);
  }
  const p = b.part(name);
  for (let i = 0; i < n; i++) for (let k = 0; k < segs; k++) {
    const a = P[i][k], bb = P[i + 1][k], c = P[i + 1][k + 1], d = P[i][k + 1];
    const na = N[i][k], nb = N[i + 1][k], nc = N[i + 1][k + 1], nd = N[i][k + 1];
    for (const [v, nn] of [[a, na], [c, nc], [bb, nb], [a, na], [d, nd], [c, nc]]) b._push(p, v, nn, 0, 0, null);
  }
}

/** Deck height on the centre line at x (the engine cover between the sails). */
function deckY(x, z = 0) {
  const r = rowAt(x).p;
  const zc = Math.abs(z);
  // between the centre (line 8) and the deck edge (line 7)
  const t = Math.min(1, zc / Math.max(1e-3, r[7][2]));
  return r[8][1] + (r[7][1] - r[8][1]) * t;
}

export function buildTimeMachine(M, { version = 'part1' } = {}) {
  const b = new Builder();
  const g = new Group();
  const glow = [];

  // --- the deck plate over the engine cover ------------------------------------------------
  for (let k = 0; k < 14; k++) {
    const x0 = -2.04 + k * 0.074, x1 = x0 + 0.074;
    const y0 = deckY(x0) + 0.006, y1 = deckY(x1) + 0.006;
    b.quad('deckPlate', V(x0, y0, 0.5), V(x1, y1, 0.5), V(x1, y1, -0.5), V(x0, y0, -0.5));
  }

  // --- the reactor at the back, on the centre line -------------------------------------------
  const rx = -1.86, ry = deckY(rx) + 0.005;
  b.lathe('blackBox', V(rx, ry, 0), V(0, 1, 0), [[0.14, 0], [0.145, 0.03], [0.145, 0.04], [0.125, 0.045], [0.125, 0.23], [0.135, 0.235], [0.135, 0.26], [0.0, 0.262]], { segs: 32 });
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const m = new Matrix4().makeRotationY(a).setPosition(rx, ry, 0);
    b.transform(m);
    b.box('blackBox', [0.122, 0.05, -0.006], [0.15, 0.225, 0.006]);
    b.transform(null);
  }
  if (version === 'part2') {
    // Mr. Fusion: a white coffee-grinder of a reactor with a clear hopper
    const my = ry + 0.262;
    b.lathe('whitePlastic', V(rx, my, 0), V(0, 1, 0), [[0.12, 0], [0.12, 0.03], [0.1, 0.05], [0.085, 0.06], [0.085, 0.31], [0.08, 0.32], [0.0, 0.322]], { segs: 28 });
    b.box('flux', [rx + 0.06, my + 0.1, -0.05], [rx + 0.09, my + 0.2, 0.05]);
  } else {
    // the plutonium chamber's lid: a chromed hubcap with a handle, a radiation sticker beside it
    const ly = ry + 0.262;
    b.lathe('chrome', V(rx, ly, 0), V(0, 1, 0), [[0.118, 0], [0.118, 0.008], [0.1, 0.022], [0.06, 0.03], [0.03, 0.034], [0.0, 0.035]], { segs: 32 });
    b.box('chrome', [rx - 0.045, ly + 0.035, -0.008], [rx + 0.045, ly + 0.05, 0.008]);
    b.box('yellow', [rx + 0.12, ry + 0.12, -0.04], [rx + 0.128, ry + 0.2, 0.04]);
  }
  // pipes from the reactor's foot into the deck
  for (const s of [1, -1]) tube(b, 'conduitGrey', [V(rx + 0.1, ry + 0.06, 0.1 * s), V(rx + 0.2, ry + 0.05, 0.2 * s), V(rx + 0.33, deckY(rx + 0.33) + 0.04, 0.27 * s), V(rx + 0.55, deckY(rx + 0.55) + 0.03, 0.3 * s)], 0.022, { segs: 10 });

  // --- the cooling vents at the rear corners -------------------------------------------------
  for (const s of [1, -1]) {
    const x0 = -2.12, x1 = -1.72, z = 0.43 * s;
    const yb = deckY(-1.9, 0.43) - 0.01;
    // a black box rising toward the back, its louvred face to the rear
    const pts = [V(x1, yb, 0), V(x1, yb + 0.12, 0), V(x0 + 0.06, yb + 0.30, 0), V(x0, yb + 0.30, 0), V(x0, yb, 0)];
    const w = 0.15;
    // sides
    for (const zz of [z - w, z + w]) {
      const f = zz > z ? 1 : -1;
      for (let i = 1; i + 1 < pts.length; i++) {
        const a = pts[0].clone().setZ(zz), c = pts[i].clone().setZ(zz), d = pts[i + 1].clone().setZ(zz);
        if (f > 0) b.tri('blackBox', a, c, d); else b.tri('blackBox', a, d, c);
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      b.quad('blackBox', a.clone().setZ(z - w), c.clone().setZ(z - w), c.clone().setZ(z + w), a.clone().setZ(z + w));
    }
    // the louvres in its rear face
    for (let k = 0; k < 6; k++) {
      const y = yb + 0.03 + k * 0.045;
      b.box('aluminium', [x0 - 0.018, y, z - w + 0.012], [x0 + 0.002, y + 0.012, z + w - 0.012]);
    }
    // the coil on its inner side, which glows as the car nears 88 mph
    for (let k = 0; k < 7; k++) b.box('coil', [x1 - 0.32 + k * 0.04, yb + 0.06, z - w * s - 0.02 * s - 0.008], [x1 - 0.30 + k * 0.04, yb + 0.16, z - w * s - 0.02 * s + 0.008]);
    // the flexible steel hose from the deck into it
    tube(b, 'conduitGrey', [V(-1.45, deckY(-1.45) + 0.03, 0.3 * s), V(-1.6, deckY(-1.6) + 0.08, 0.36 * s), V(-1.72, yb + 0.1, z)], 0.035, { segs: 12 });
  }

  // --- capacitors, heat sinks and the glass tube on the deck ----------------------------------
  for (const s of [1, -1]) {
    for (let k = 0; k < 6; k++) {
      const x = -1.62 + k * 0.075, z = 0.22 * s;
      const y = deckY(x, z) + 0.006;
      b.cylinder('aluminium', V(x, y, z), V(x, y + 0.06, z), 0.024, 0.024, { segs: 12 });
      b.cylinder('capBlue', V(x, y + 0.06, z), V(x, y + 0.075, z), 0.026, 0.02, { segs: 12 });
    }
    // a heat sink
    const hx = -1.25, hz = 0.32 * s, hy = deckY(hx, hz) + 0.006;
    b.box('aluminium', [hx - 0.08, hy, hz - 0.06], [hx + 0.08, hy + 0.02, hz + 0.06]);
    for (let k = 0; k < 9; k++) b.box('aluminium', [hx - 0.08 + k * 0.019, hy + 0.02, hz - 0.06], [hx - 0.074 + k * 0.019, hy + 0.07, hz + 0.06]);
  }
  {
    const y0 = deckY(-1.15) + 0.07, y1 = deckY(-1.6) + 0.07;
    b.cylinder('whitePlastic', V(-1.6, y1, 0), V(-1.15, y0, 0), 0.026, 0.026, { segs: 14, open: true });
    b.cylinder('flux', V(-1.58, y1, 0), V(-1.17, y0, 0), 0.012, 0.012, { segs: 8 });
    for (const [x, y] of [[-1.62, y1], [-1.13, y0]]) {
      b.cylinder('conduitGrey', V(x, y, 0), V(x, deckY(x) + 0.006, 0), 0.034, 0.034, { segs: 14 });
      b.box('aluminium', [x - 0.06, deckY(x) + 0.006, -0.06], [x + 0.06, deckY(x) + 0.05, 0.06]);
    }
  }

  // --- the sides: sill plates, conduit and wires round the arches ------------------------------
  for (const s of [1, -1]) {
    const F = DIM.archF, R = DIM.archR;
    // the ribbed aluminium plate on the sill between the arches
    const xa = R.xc + R.R + 0.01, xb = F.xc - F.R - 0.01;
    const sp = rowAt(0).p, ys0 = sp[2][1] + 0.005, ys1 = ys0 + 0.11, zs = sp[2][2] + 0.012;
    b.box('aluBrushed', [xa, ys0, s > 0 ? zs - 0.004 : -zs - 0.006], [xb, ys1, s > 0 ? zs + 0.006 : -zs + 0.004]);
    for (let k = 0; k < 4; k++) {
      const y = ys0 + 0.016 + k * 0.024;
      b.box('aluminium', [xa + 0.01, y, s > 0 ? zs + 0.006 : -zs - 0.012], [xb - 0.01, y + 0.008, s > 0 ? zs + 0.012 : -zs - 0.006]);
    }
    // the cable run
    const zc = 0.955 * s;
    const path = [];
    path.push(V(1.95, 0.44, 0.86 * s), V(1.8, 0.44, 0.93 * s));
    for (let k = 1; k <= 11; k++) {
      const a = (k / 12) * Math.PI;
      path.push(V(F.xc + Math.cos(a) * (F.R + 0.03), F.yc + Math.sin(a) * (F.R + 0.03), zc));
    }
    path.push(V(xb - 0.02, ys1 + 0.02, zc - 0.005 * s), V(0.2, ys1 + 0.02, zc - 0.01 * s), V(xa + 0.02, ys1 + 0.02, zc - 0.005 * s));
    for (let k = 1; k <= 7; k++) {
      const a = (k / 12) * Math.PI;
      path.push(V(R.xc + Math.cos(a) * (R.R + 0.03), R.yc + Math.sin(a) * (R.R + 0.03), zc));
    }
    path.push(V(-1.55, 0.85, 0.9 * s), V(-1.72, 0.97, 0.62 * s));
    tube(b, 'conduit', path, 0.016, { segs: 8 });
    // the coloured wires bundled along it, tied every so often
    const curve = new CatmullRomCurve3(path);
    for (const [mat, off] of [['wireRed', [0.018, 0.012]], ['wireYellow', [0.018, -0.012]], ['wireWhite', [0.0, 0.02]]]) {
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const t = i / 80, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
        const side = new Vector3(0, 0, s).cross(tg).normalize();
        pts.push(p.clone().addScaledVector(side, off[1]).add(V(0, 0, off[0] * s)));
      }
      tube(b, mat, pts, 0.005, { segs: 5 });
    }
    for (let i = 1; i < 14; i++) {
      const p = curve.getPointAt(i / 14);
      b.cylinder('trim', p.clone().add(V(-0.008, 0, 0)), p.clone().add(V(0.008, 0, 0)), 0.03, 0.03, { segs: 10 });
    }
    // the riveted box on the bumper's corner
    const bx0 = 1.80, bx1 = 2.0, by0 = 0.30, by1 = 0.47;
    b.box('greyBox', [bx0, by0, s > 0 ? 0.74 : -0.92], [bx1, by1, s > 0 ? 0.92 : -0.74]);
    for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) {
      const x = bx0 + 0.02 + k * 0.053, y = by0 + 0.02 + j * 0.13;
      b.box('aluminium', [x - 0.005, y - 0.005, s > 0 ? 0.92 : -0.926], [x + 0.005, y + 0.005, s > 0 ? 0.926 : -0.92]);
    }
  }
  // the aluminium bar across the front bumper
  b.box('aluBrushed', [2.045, 0.47, -0.72], [2.075, 0.52, 0.72]);
  b.box('aluminium', [2.04, 0.30, -0.6], [2.07, 0.34, 0.6]);

  const built = b.build(M);
  g.add(built);
  for (const m of built.children) if (m.name === 'coil' || m.name === 'flux') glow.push(m);
  // the hazard sticker on the reactor
  void labelTexture; void Mesh; void PlaneGeometry; void MeshStandardMaterial;
  return { group: g, glow };
}
