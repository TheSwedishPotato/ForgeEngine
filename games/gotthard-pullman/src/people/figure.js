/**
 * The people on the train, on the 1403 engine's own figure: the Walker (a skinned body on the
 * ragdoll's skeleton, with its gait, standing weight shifts, sitting and the small motions of a
 * task), dressed for a December day in 2026, with hands that can be put where they are needed:
 * on the regulator, the shovel, a coffee cup, a phone held up to the window.
 *
 * The arm is solved in the Walker's own joint terms (shoulder flexion, abduction, elbow bend,
 * the elbow bending toward the upper arm's front): the elbow bend from the shoulder-hand
 * distance (law of cosines), then the flexion and abduction that turn the bent arm onto the
 * target, choosing the branch that keeps the abduction under 90°.
 */
import { Mesh, MeshStandardMaterial, CylinderGeometry, SphereGeometry, Vector3, Quaternion } from 'three';
import { Walker } from '../../../duel1403/src/life/Walker.js';
import { SKIN_TONES } from '../../../duel1403/src/render/bodyMesh.js';

const _S = new Vector3();

export class Figure extends Walker {
  constructor(opts) {
    super(opts);
    this.reach = { L: null, R: null };    // { x, y, z } in the parent's frame, w: 0..1
    this.bend = 0;                         // forward bend at the waist (radians), to reach low
  }

  update(dt, o) {
    this._u = o;
    super.update(dt, o);
  }

  _orient(dt, speed, posture) {
    super._orient(dt, speed, posture);
    if (this.bend > 0.01) {
      // the spine curls forward from the lumbar joint; the head stays up, looking where it was
      const P = this.pose;
      P.abdomen = qx(this.bend * 0.45).multiply(P.abdomen);
      P.chest = qx(this.bend).multiply(P.chest);
      P.head = qx(this.bend * 0.6).multiply(P.head);
    }
    if (!this._u || (!this.reach.L && !this.reach.R)) return;
    const pos = this._fk();
    const u = this._u;
    const shift = posture === 'sit' ? u.y + 0.47 * this.scale - pos.pelvis.y + 0.06 : u.y - (Math.min(pos.footL.y, pos.footR.y) - this.footRestY);
    const c = Math.cos(u.yaw), s = Math.sin(u.yaw);
    for (const side of ['L', 'R']) {
      const t = this.reach[side];
      if (!t) continue;
      // the target in the body's frame (undo the placing: translation, then the yaw)
      const dx = t.x - u.x, dy = t.y - shift, dz = t.z - u.z;
      const tx = dx * c - dz * s, tz = dx * s + dz * c;
      this._ik(side, pos, tx, dy, tz, t.w ?? 1);
    }
  }

  /** Puts the hand of one arm at (tx, ty, tz) in the body frame, blended in by w. */
  _ik(side, pos, tx, ty, tz, w) {
    const j = this.j['shoulder' + side];
    const pn = j.parent.name;
    _S.copy(j.anchorParent).applyQuaternion(this.pose[pn]).add(pos[pn]);
    const bone = this.ragdoll.bones['arm' + side];
    const L1 = bone.L1, L2 = bone.L2;
    let x = tx - _S.x, y = ty - _S.y, z = tz - _S.z;
    let D = Math.hypot(x, y, z);
    const Dmax = (L1 + L2) * 0.995, Dmin = Math.abs(L1 - L2) + 0.05;
    if (D < 1e-4) return;
    const k = Math.min(Dmax, Math.max(Dmin, D)) / D;
    x *= k; y *= k; z *= k; D *= k;
    const e = Math.acos(Math.max(-1, Math.min(1, (D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2))));
    const A = L1 + L2 * Math.cos(e), B = L2 * Math.sin(e);
    const phi = Math.atan2(B, A), as = Math.asin(Math.max(-1, Math.min(1, z / D)));
    let best = null;
    for (const a of [as - phi, Math.PI - as - phi]) {
      const yp = -A * Math.cos(a) + B * Math.sin(a);
      if (Math.abs(yp) < 1e-5) continue;
      const th = Math.atan2(-x / yp, y / yp);
      const cost = Math.abs(th) + (a < -0.9 || a > 2.9 ? 3 : 0);
      if (!best || cost < best.cost) best = { a, th, cost };
    }
    if (!best) return;
    const P = this.pose;
    const up = P['upperArm' + side], fo = P['forearm' + side];
    const qU = qz(best.th).multiply(qx(-best.a));
    const qF = qU.clone().multiply(qx(-e));
    up.slerp(qU, w); fo.slerp(qF, w);
  }
}

const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
function qx(a) { return new Quaternion().setFromAxisAngle(X, a); }
function qz(a) { return new Quaternion().setFromAxisAngle(Z, a); }

// ---- dress ------------------------------------------------------------------------------------

const PICK = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
// a December day: jumpers, jackets and cardigans indoors (the coats hang by the doors), dark
// trousers and jeans, winter dresses; hair from black to white (heritage trips run older)
const TOPS = ['#2b3245', '#3a3a3c', '#6b2430', '#5a4a3a', '#8a7556', '#30473a', '#7d7d7b', '#1e1e22', '#a8987a', '#4b5a78', '#c9bda2', '#58304a', '#2f4f5f', '#7a3b22'];
const TROUSERS = ['#22252b', '#2f3a4e', '#3c3c40', '#4a4036', '#1b1b1d', '#55606e', '#3a3226'];
const DRESSES = ['#3b2a3f', '#24304a', '#5a1f24', '#2d3b2f', '#3a3a3a', '#4a3a2e', '#6a5040'];
const HAIR = ['#1c1a18', '#2e221a', '#3b2a1e', '#5a3c22', '#7a5a3a', '#a8875a', '#6a3420', '#8a8580', '#b8b4ae', '#d0ccc4'];
const SKINS = [SKIN_TONES.light, '#e8c4a4', '#e0b896', '#d2a07c', SKIN_TONES.medium, '#c48e6a', SKIN_TONES.tan, '#b98462', SKIN_TONES.brown];

/** A passenger's looks from a seeded generator. */
export function passengerLooks(r) {
  const female = r() < 0.5;
  const old = r() < 0.45;
  const dress = female && r() < 0.45;      // a winter dress (in its colour, dark tights), else a top and trousers
  const hair = old ? PICK(HAIR.slice(7), r) : PICK(HAIR.slice(0, 8), r);
  return {
    female, old,
    height: female ? 1.58 + r() * 0.14 : 1.68 + r() * 0.18,
    mass: female ? 58 + r() * 22 : 70 + r() * 26,
    colors: { skin: PICK(SKINS, r), hair, cloth: dress ? PICK(DRESSES, r) : PICK(TOPS, r), hose: PICK(TROUSERS, r) },
    beard: !female && r() < 0.25 ? 0.2 + r() * 0.6 : 0,
    gown: dress,
  };
}

/** Builds a figure. quality/texture are kept low for the many passengers. */
export function makeFigure(name, looks, { quality = 'low', texSize = 256 } = {}) {
  const f = new Figure({
    name, height: looks.height, mass: looks.mass, colors: looks.colors, female: looks.female,
    beard: looks.beard ?? 0, quality, texSize, headwear: looks.headwear ?? null,
  });
  if (looks.gown === false && f.body.gownMesh) f.body.gownMesh.visible = false;
  // the body mesh tints the cloth's texture (already in the cloth's colour) with that colour again,
  // which turns every top nearly black: the texture alone carries it
  f.body.clothMat?.color.set('#ffffff');
  if (looks.cap) addCap(f, looks.cap);
  f.mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return f;
}

/**
 * A peaked cap on the head bone (engine crews and the conductor): a crown, a band and a visor.
 * color: the cloth; band: the band's colour.
 */
export function addCap(fig, { color = '#1f2a3d', band = '#1a1a1a', visor = '#141414' } = {}) {
  const body = fig.body, s = body.s;
  const C = body._headCenter(), rest = fig.ragdoll.bodies.head.userData.restPos;
  const head = body.bones.find((b) => b.name === 'head');
  const add = (geo, mat) => { geo.translate(-rest.x, -rest.y, -rest.z); const m = new Mesh(geo, mat); m.castShadow = true; head.add(m); return m; };
  const cloth = new MeshStandardMaterial({ color, roughness: 0.85 });
  const bandM = new MeshStandardMaterial({ color: band, roughness: 0.6 });
  const visorM = new MeshStandardMaterial({ color: visor, roughness: 0.35 });
  add(new CylinderGeometry(0.118 * s, 0.112 * s, 0.035 * s, 28).translate(C.x, C.y + 0.075 * s, C.z), bandM);
  add(new CylinderGeometry(0.13 * s, 0.118 * s, 0.055 * s, 28).translate(C.x, C.y + 0.118 * s, C.z - 0.004 * s), cloth);
  add(new SphereGeometry(0.075 * s, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.0, 0.2, 0.95).translate(C.x, C.y + 0.07 * s, C.z + 0.1 * s), visorM);
}

/** The engine crew: blue work jackets and trousers, caps; the conductor in navy with a red band. */
export const CREW_LOOKS = {
  driver: { female: false, height: 1.78, mass: 82, colors: { skin: '#d9a982', hair: '#4a3a2e', cloth: '#26324a', hose: '#22293a' }, beard: 0.35, gown: false, cap: { color: '#1e2638', band: '#1e2638' } },
  fireman: { female: false, height: 1.74, mass: 76, colors: { skin: '#e0b896', hair: '#2e221a', cloth: '#2b3a55', hose: '#22293a' }, beard: 0, gown: false, cap: { color: '#23304a', band: '#23304a' } },
  conductor: { female: true, height: 1.68, mass: 64, colors: { skin: '#e8c4a4', hair: '#5a3c22', cloth: '#1d2436', hose: '#1d2436' }, beard: 0, gown: false, cap: { color: '#1d2436', band: '#9b1c22' } },
};
