/**
 * The DMC-12's "turbine" wheels: cast alloy, 14 x 6 in front and 15 x 8 at the rear, a smooth
 * outer ring, a ring of narrow radial slots, a black centre cap; Goodyear radials, 195/60 HR14
 * and 235/60 HR15, lettered on the sidewall (as on the cars at the Petersen and Universal).
 * Behind them the disc brakes and calipers.
 *
 * Wheel frame: the axle along z (+z outward), centre at the origin.
 */
import { Group, Mesh, Vector3, MeshStandardMaterial, Color, DoubleSide } from 'three';
import { Builder } from './geom.js';
import { plateTexture } from './textures.js';

let _letters = null;
function sidewallTexture() {
  if (_letters) return _letters;
  _letters = plateTexture(2048, 64, (g, w, h) => {
    g.fillStyle = '#060606'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7d7d7d'; g.font = 'bold 40px Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    const words = ['GOODYEAR', 'EAGLE GT', 'GOODYEAR', 'EAGLE GT'];
    words.forEach((t, i) => g.fillText(t, (i + 0.5) * w / words.length, h / 2 + 2));
  }, true);
  return _letters;
}

/** One wheel. size: { r (tyre radius), w (section width), rim (rim radius) }. Returns a Group (spins about z). */
export function buildWheel(M, { r, w, rim }, outward = 1) {
  const g = new Group();
  const b = new Builder();
  const z = (t) => t * outward;
  const O = new Vector3(0, 0, 0), ax = new Vector3(0, 0, outward);
  const h = w / 2;
  // the tyre: tread, shoulders, sidewalls (the outer sidewall separately, for its lettering)
  b.lathe('tire', O, ax, [[rim + 0.004, -h + 0.012], [rim + 0.025, -h], [r - 0.045, -h + 0.006], [r - 0.012, -h + 0.022], [r, -h + 0.045], [r - 0.004, -h * 0.35], [r, -h * 0.3], [r, h * 0.3], [r - 0.004, h * 0.35], [r, h - 0.045], [r - 0.012, h - 0.022]], { segs: 48 });
  b.lathe('sidewall', O, ax, [[r - 0.012, h - 0.022], [r - 0.045, h - 0.006], [rim + 0.025, h], [rim + 0.004, h - 0.012]], { segs: 48 });
  // the rim: the outer lip, the smooth outer ring of the face, the slotted ring, the hub
  const face = h - 0.028;
  b.lathe('alloy', O, ax, [[rim + 0.012, h - 0.004], [rim + 0.012, h - 0.016], [rim - 0.004, h - 0.02], [rim * 0.9, face + 0.004], [rim * 0.8, face], [rim * 0.78, face - 0.004]], { segs: 48 });
  b.lathe('alloy', O, ax, [[rim * 0.36, face - 0.004], [rim * 0.34, face], [rim * 0.3, face + 0.008], [rim * 0.27, face + 0.012]], { segs: 32 });
  // the slots: a dark annulus with radial fins over it
  b.lathe('slotDark', O, ax, [[rim * 0.78, face - 0.012], [rim * 0.36, face - 0.012]], { segs: 48 });
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a), c2 = Math.cos(a + 0.12), s2 = Math.sin(a + 0.12);
    const r0 = rim * 0.37, r1 = rim * 0.77, t0 = face - 0.012, t1 = face - 0.001;
    // a fin: a thin radial wall, its top face catching the light
    const fw = 0.0055;
    const P = (rr, aa, t, off) => new Vector3(Math.cos(aa) * rr - Math.sin(aa) * off, Math.sin(aa) * rr + Math.cos(aa) * off, z(t));
    void c; void s; void c2; void s2;
    const top = [P(r0, a, t1, -fw), P(r1, a + 0.04, t1, -fw), P(r1, a + 0.04, t1, fw), P(r0, a, t1, fw)];
    if (outward > 0) b.quad('alloy', top[0], top[1], top[2], top[3]); else b.quad('alloy', top[3], top[2], top[1], top[0]);
    for (const off of [-fw, fw]) {
      const q = [P(r0, a, t0, off), P(r1, a + 0.04, t0, off), P(r1, a + 0.04, t1, off), P(r0, a, t1, off)];
      if ((off > 0) === (outward > 0)) b.quad('alloy', q[3], q[2], q[1], q[0]); else b.quad('alloy', q[0], q[1], q[2], q[3]);
    }
  }
  // the centre cap: black, with a bright ring and the lug nuts hidden under it
  b.lathe('cap', O, ax, [[rim * 0.27, face + 0.012], [rim * 0.25, face + 0.02], [rim * 0.18, face + 0.026], [0.001, face + 0.028]], { segs: 32 });
  // inside: the barrel, the brake disc and its hat
  b.lathe('alloyDark', O, ax, [[rim, h - 0.02], [rim, -h + 0.01], [rim - 0.01, -h + 0.01]], { segs: 32 });
  b.lathe('brake', O, ax, [[rim * 0.92, -0.01], [rim * 0.4, -0.01], [rim * 0.4, 0.012], [rim * 0.92, 0.012], [rim * 0.92, -0.01]], { segs: 32 });
  const mats = { tire: M.tire, sidewall: M.sidewall ?? (M.sidewall = new MeshStandardMaterial({ map: sidewallTexture(), color: new Color(1, 1, 1), roughness: 0.8 })), alloy: M.alloy, slotDark: M.well, cap: M.trim, alloyDark: M.alloyDark, brake: M.brake };
  for (const k in mats) { if (!mats[k]._dbl) { const c = mats[k].clone(); c.side = DoubleSide; c._dbl = true; mats[k] = c; } }
  const spin = b.build(mats);
  spin.name = 'spin';
  g.add(spin);
  // the caliper does not turn with the wheel
  const cb = new Builder();
  cb.box('caliper', [-0.05, rim * 0.62, -0.035 * outward - 0.02], [0.05, rim * 0.95, -0.035 * outward + 0.02]);
  const cal = cb.build({ caliper: M.greyBox });
  cal.rotation.z = outward > 0 ? 0.6 : 0.6;
  g.add(cal);
  g.userData.spin = spin;
  return g;
}

/** The four wheels at their hubs: { fl, fr, rl, rr }, each { steer: Group, wheel: Group }. */
export function buildWheels(M, D) {
  const out = {};
  const front = { r: D.rF, w: D.widthF, rim: 0.1778 }, rear = { r: D.rR, w: D.widthR, rim: 0.1905 };
  for (const [key, x, size, z] of [['fl', D.xF, front, -D.trackF / 2], ['fr', D.xF, front, D.trackF / 2], ['rl', D.xR, rear, -D.trackR / 2], ['rr', D.xR, rear, D.trackR / 2]]) {
    const steer = new Group();
    steer.position.set(x, size.r, z);
    const wheel = buildWheel(M, size, z > 0 ? 1 : -1);
    steer.add(wheel);
    out[key] = { steer, wheel, r: size.r };
  }
  void Mesh;
  return out;
}
