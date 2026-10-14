/**
 * The DMC-12's trim and lamps on the shell: the four rectangular sealed-beam headlamps in the
 * black grille band with its slats and the DMC letters, the bumpers' indicators and side
 * markers, the black rub strip along the waist crease, the seams round the doors and the
 * front lid, the windscreen's black frame and the wipers parked at its foot, the door mirrors
 * and handles, the intake grilles on the rear quarters, the ribbed tail lamps and the plate.
 *
 * Everything is built in the car's frame; parts on the doors are returned separately (and
 * moved to their hinge) so they swing up with them.
 */
import { Group, Mesh, Vector3, Matrix4, PlaneGeometry, MeshStandardMaterial, Color } from 'three';
import { Builder } from './geom.js';
import { rowAt, rowXs, DIM } from './body.js';
import { plateTexture, californiaPlate } from './textures.js';

const V = (x, y, z) => new Vector3(x, y, z);

/** A local frame: origin o, across a (unit), up u (unit); out = a x u. */
export function frame(o, a, u) {
  const n = new Vector3().crossVectors(a, u).normalize();
  const u2 = new Vector3().crossVectors(n, a).normalize();
  return new Matrix4().makeBasis(a.clone().normalize(), u2, n).setPosition(o);
}

/** Point i of the loft at x, mirrored to the left for side < 0. */
function P(i, x, side = 1) { const p = rowAt(x).p[i]; return V(p[0], p[1], p[2] * side); }

/**
 * A strip lying on the shell along line i, from x0 to x1: width w across the line (toward line
 * i + dir), raised by lift. Into builder b, part name.
 */
function lineStrip(b, name, i, x0, x1, { w = 0.02, lift = 0.0025, dir = 1, centred = true, side = 1, step = 0.04 } = {}) {
  const xs = rowXs().filter((x) => x > x0 && x < x1);
  const all = [x0, ...xs, x1];
  const pts = [];
  for (let k = 0; k < all.length; k++) {
    const x = all[k];
    const p = P(i, x, side), q = P(i + dir, x, side);
    let t = q.clone().sub(p);
    if (t.lengthSq() < 1e-8) t = V(0, 1, 0);
    t.normalize();
    const xa = all[Math.min(all.length - 1, k + 1)], xb = all[Math.max(0, k - 1)];
    const along = P(i, xa, side).sub(P(i, xb, side)).normalize();
    const n = new Vector3().crossVectors(along, t).normalize();
    if (n.dot(V(0, p.y - 0.55, p.z)) < 0) n.negate();
    const c = p.clone().addScaledVector(n, lift);
    pts.push(centred ? [c.clone().addScaledVector(t, -w / 2), c.clone().addScaledVector(t, w / 2)] : [c.clone(), c.clone().addScaledVector(t, w)]);
  }
  void step;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [a0, a1] = pts[k], [b0, b1] = pts[k + 1];
    // face outward: check against the normal of the first quad
    const nrm = new Vector3().subVectors(b0, a0).cross(new Vector3().subVectors(a1, a0));
    const out = V(0, a0.y - 0.55, a0.z);
    if (nrm.dot(out) >= 0) b.quad(name, a0, b0, b1, a1); else b.quad(name, a1, b1, b0, a0);
  }
}

/** A vertical seam on the side at x, from line i0 up to line i1 (through the lines between). */
function sideSeam(b, name, x, i0, i1, side, w = 0.005) {
  for (let i = i0; i < i1; i++) {
    const a = P(i, x, side), c = P(i + 1, x, side);
    const n = V(0, (a.y + c.y) / 2 - 0.55, (a.z + c.z) / 2).normalize().multiplyScalar(0.0025);
    const A0 = a.clone().add(n).setX(x - w / 2), A1 = a.clone().add(n).setX(x + w / 2), C0 = c.clone().add(n).setX(x - w / 2), C1 = c.clone().add(n).setX(x + w / 2);
    if (side > 0) b.quad(name, A0, A1, C1, C0); else b.quad(name, A1, A0, C0, C1);
  }
}

let _dmc = null;
function dmcLetters() {
  // the DMC logotype: square letters, the D and C open, the M with a centre stroke
  return (_dmc ??= plateTexture(512, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff';
    const s = 20, H = 120, y0 = 20;
    // D
    g.fillRect(20, y0, s, H); g.fillRect(20, y0, 110, s); g.fillRect(20, y0 + H - s, 110, s); g.fillRect(130, y0 + 18, s, H - 36);
    g.beginPath(); g.moveTo(130, y0); g.lineTo(150, y0 + 18); g.lineTo(130, y0 + 18); g.fill();
    g.beginPath(); g.moveTo(130, y0 + H); g.lineTo(150, y0 + H - 18); g.lineTo(130, y0 + H - 18); g.fill();
    // M
    g.fillRect(185, y0, s, H); g.fillRect(185, y0, 140, s); g.fillRect(245, y0, s, H); g.fillRect(305, y0, s, H);
    // C
    g.fillRect(360, y0, s, H); g.fillRect(360, y0, 130, s); g.fillRect(360, y0 + H - s, 130, s);
  }));
}

// ---------------------------------------------------------------------------------------------

export function buildDetails(M) {
  const bb = new Builder(), bR = new Builder(), bL = new Builder();
  const doorB = (side) => (side > 0 ? bR : bL);
  const extra = [];   // meshes made outside the builders (textured quads)
  const lamps = {};

  for (const side of [1, -1]) {
    // --- the rub strip in the waist crease: on the door and on the front fender behind the arch
    lineStrip(doorB(side), 'trim', 3, DIM.doorLow[0] + 0.01, DIM.doorLow[1] - 0.008, { w: 0.022, side });
    lineStrip(bb, 'trim', 3, DIM.doorLow[1] + 0.008, DIM.archF.xc - DIM.archF.R - 0.01, { w: 0.022, side });
    // --- the door's belt seal and window frame (black), on the door
    lineStrip(doorB(side), 'rubber', 4, DIM.doorHigh[0], DIM.doorHigh[1], { w: 0.022, dir: 1, centred: false, side, lift: 0.004 });
    lineStrip(doorB(side), 'trim', 5, DIM.doorHigh[0], DIM.header + 0.01, { w: 0.03, dir: -1, centred: false, side, lift: 0.004 });
    // --- the windscreen's frame: the A-pillar (on the body)
    lineStrip(bb, 'trim', 5, DIM.header, DIM.cowl, { w: 0.075, dir: 1, centred: true, side, lift: 0.004 });
    // --- the seams round the door (on the body, just outside its edges)
    sideSeam(bb, 'well', DIM.doorLow[1] + 0.004, 2, 4, side);
    sideSeam(bb, 'well', DIM.doorLow[0] - 0.004, 2, 4, side);
    lineStrip(bb, 'well', 6, DIM.doorHigh[0], DIM.header, { w: 0.006, side, lift: 0.0015 });
    // --- the front lid's seams along the fenders
    lineStrip(bb, 'well', 5, 0.66, 1.975, { w: 0.005, side, lift: 0.0015 });
    // --- the door handle: a black pull recessed under the window toward the rear of the door
    {
      const p0 = P(3, -0.63, side), p1 = P(4, -0.63, side);
      const y = p0.y + (p1.y - p0.y) * 0.8, zs = p0.z + (p1.z - p0.z) * 0.8;
      const zs0 = Math.min(zs - 0.006 * side, zs + 0.006 * side), zs1 = Math.max(zs - 0.006 * side, zs + 0.006 * side);
      doorB(side).box('trim', [-0.70, y - 0.011, zs0], [-0.56, y + 0.011, zs1]);
    }
    // --- the door mirror: on the door at the front corner of the window
    {
      const p = P(4, 0.40, side);
      const b = doorB(side);
      const zz = (a, c) => [Math.min(a * side, c * side), Math.max(a * side, c * side)];
      const [s0, s1] = zz(p.z - 0.01, p.z + 0.05), [h0, h1] = zz(p.z + 0.035, p.z + 0.125);
      b.box('trim', [0.385, p.y - 0.005, s0], [0.425, p.y + 0.02, s1]);
      b.box('trim', [0.35, p.y + 0.005, h0], [0.42, p.y + 0.07, h1]);
      b.box('chrome', [0.348, p.y + 0.01, h0 + 0.004], [0.351, p.y + 0.065, h1 - 0.004]);
    }
    // --- the intake grille on the rear quarter, behind the door glass
    {
      for (let k = 0; k < 5; k++) {
        const x = -1.12 + k * 0.035;
        const a = P(4, x, side), c = P(5, x, side);
        const t = c.clone().sub(a);
        const p0 = a.clone().addScaledVector(t, 0.12), p1 = a.clone().addScaledVector(t, 0.85);
        const n = V(0, 0.2, side).normalize().multiplyScalar(0.004);
        bb.quad('grille', side > 0 ? p0.clone().add(n) : p1.clone().add(n), side > 0 ? p0.clone().add(n).setX(x + 0.022) : p1.clone().add(n).setX(x + 0.022), side > 0 ? p1.clone().add(n).setX(x + 0.022) : p0.clone().add(n).setX(x + 0.022), side > 0 ? p1.clone().add(n) : p0.clone().add(n));
      }
    }
    // --- the side markers: amber ahead of the front wheel, red behind the rear one
    {
      const x = 1.75, p = P(2, x, side), q = P(3, x, side);
      const o = p.clone().lerp(q, 0.62).add(V(0, 0, side * 0.004));
      bb.transform(new Matrix4().makeTranslation(o.x, o.y, o.z));
      bb.box('amber', [-0.05, -0.016, -0.003], [0.05, 0.016, 0.003]);
      const x2 = -1.80, p2 = P(2, x2, side), q2 = P(3, x2, side);
      const o2 = p2.clone().lerp(q2, 0.62).add(V(0, 0, side * 0.004));
      bb.transform(new Matrix4().makeTranslation(o2.x, o2.y, o2.z));
      bb.box('tailRed', [-0.05, -0.016, -0.003], [0.05, 0.016, 0.003]);
      bb.transform(null);
    }
  }

  // --- the front: grille band between the bumper and the lid ---------------------------------
  {
    const nose = rowAt(DIM.nose);
    const B3 = nose.p[3], T4 = nose.p[4];
    const bot = V(B3[0], B3[1], 0), top = V(T4[0], T4[1], 0);
    const up = top.clone().sub(bot);
    const bandLen = up.length();
    up.normalize();
    const F = frame(bot, V(0, 0, -1), up);        // u across (to the car's left, seen from the front: to the right), v up the band, w out
    const at = (u, v, w = 0) => new Vector3(u, v, w).applyMatrix4(F);
    void at;
    bb.transform(F);
    // the slats across the middle of the grille
    for (let k = 0; k < 6; k++) {
      const v = 0.012 + k * (bandLen - 0.03) / 5.5;
      bb.box('grille', [-0.33, v, 0], [0.33, v + 0.007, 0.012]);
    }
    // the headlamps: two US rectangular sealed beams (100 x 165 mm) each side, set in black buckets
    const lampH = 0.106, lampW = 0.158, v0 = bandLen / 2 - lampH / 2;
    for (const s of [1, -1]) {
      for (const [u0, u1] of [[0.352, 0.352 + lampW], [0.528, 0.528 + lampW]]) {
        const a = Math.min(u0 * s, u1 * s), c = Math.max(u0 * s, u1 * s);
        bb.box('grille', [a - 0.01, v0 - 0.012, -0.03], [c + 0.01, v0 + lampH + 0.012, 0.004]);
        bb.box('reflector', [a, v0, -0.02], [c, v0 + lampH, -0.012]);
        bb.box('headLens', [a + 0.004, v0 + 0.004, -0.006], [c - 0.004, v0 + lampH - 0.004, 0.006]);
      }
    }
    bb.transform(null);
    // the DMC letters, in the middle of the grille
    const g = new PlaneGeometry(0.17, 0.053);
    const mat = new MeshStandardMaterial({ map: dmcLetters(), color: new Color(0.85, 0.86, 0.88), metalness: 1, roughness: 0.2, alphaTest: 0.5 });
    const m = new Mesh(g, mat);
    const o = at0(F, 0, bandLen / 2, 0.016);
    m.position.copy(o);
    m.quaternion.setFromRotationMatrix(new Matrix4().extractRotation(F));
    // the plane faces +z of its frame: the band's out direction (the frame's x axis runs to the car's left)
    extra.push(m);
    // the bumper: a groove along it, and the indicators toward its corners
    const by0 = rowAt(DIM.nose).p[2][1], by1 = B3[1];
    const fx = DIM.nose;
    bb.transform(frame(V(fx, by0, 0), V(0, 0, -1), V(0, 1, 0)));
    const bh = by1 - by0;
    bb.box('trim', [-0.70, bh * 0.42, -0.006], [0.70, bh * 0.42 + 0.012, 0.002]);
    for (const s of [1, -1]) {
      const a = Math.min(0.5 * s, 0.7 * s), c = Math.max(0.5 * s, 0.7 * s);
      bb.box('amber', [a, bh * 0.62, -0.004], [c, bh * 0.62 + 0.05, 0.006]);
    }
    bb.transform(null);
  }

  // --- the rear: tail lamps across the panel, the plate between them --------------------------
  {
    const tail = rowAt(DIM.tail);
    const B3 = tail.p[3], T4 = tail.p[4];
    const bot = V(B3[0], B3[1], 0), top = V(T4[0], T4[1], 0);
    const up = top.clone().sub(bot);
    const len = up.length();
    up.normalize();
    const F = frame(bot, V(0, 0, 1), up);      // seen from behind: u to the car's right
    bb.transform(F);
    const v0 = 0.045, v1 = len - 0.04;
    for (const s of [1, -1]) {
      const a = Math.min(0.2 * s, 0.79 * s), c = Math.max(0.2 * s, 0.79 * s);
      bb.box('trim', [a - 0.008, v0 - 0.01, -0.012], [c + 0.008, v1 + 0.01, 0.004]);
      // red outboard (tail and stop), amber, then white (reversing) toward the plate
      const seg = (u0, u1, mat) => bb.box(mat, [Math.min(u0 * s, u1 * s), v0, -0.004], [Math.max(u0 * s, u1 * s), v1, 0.008]);
      seg(0.79, 0.52, 'tailRed'); seg(0.52, 0.40, 'amber'); seg(0.40, 0.31, 'brakeRed'); seg(0.31, 0.2, 'reverse');
      // the ribs across the lenses
      for (let k = 1; k < 6; k++) { const v = v0 + (v1 - v0) * k / 6; bb.box('trim', [a, v - 0.004, 0.006], [c, v + 0.004, 0.016]); }
    }
    bb.transform(null);
    // the plate in its recess
    const pm = new MeshStandardMaterial({ map: californiaPlate('OUTATIME'), roughness: 0.4, metalness: 0.3 });
    const plate = new Mesh(new PlaneGeometry(0.305, 0.152), pm);
    plate.position.copy(at0(F, 0, len * 0.5, 0.012));
    plate.quaternion.setFromRotationMatrix(new Matrix4().extractRotation(F));
    extra.push(plate);
    lamps.plate = pm;
    // the rear bumper's groove
    const ry0 = tail.p[2][1];
    bb.transform(frame(V(DIM.tail, ry0, 0), V(0, 0, 1), V(0, 1, 0)));
    bb.box('trim', [-0.75, (B3[1] - ry0) * 0.45, -0.002], [0.75, (B3[1] - ry0) * 0.45 + 0.012, 0.006]);
    bb.transform(null);
  }

  // --- the wipers, parked at the foot of the windscreen ---------------------------------------
  {
    const cowl = P(6, DIM.cowl + 0.005);
    for (const z0 of [0.02, -0.56]) {
      const o = V(DIM.cowl + 0.02, cowl.y + 0.012, z0);
      bb.transform(frame(o, V(0, 0, 1), V(-0.86, 0.5, 0).normalize()));
      bb.box('trim', [0, -0.008, 0], [0.5, 0.008, 0.012]);
      bb.box('rubber', [0.02, -0.004, 0.012], [0.49, 0.004, 0.022]);
      bb.transform(null);
    }
  }

  const body = bb.build(M), right = bR.build(M), left = bL.build(M);
  for (const m of extra) body.add(m);
  // the door parts are moved to their hinges
  for (const [g, s] of [[right, 1], [left, -1]]) g.position.set(0, -DIM.hinge.y, -DIM.hinge.z * s);
  return { body, right, left, lamps };
}

function at0(F, u, v, w) { return new Vector3(u, v, w).applyMatrix4(F); }
