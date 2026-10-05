import {
  ShaderChunk, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Bone, Skeleton, SkinnedMesh, Group,
  MeshPhysicalMaterial, MeshStandardMaterial, Vector3, Vector2, Quaternion, Matrix4, Color, CanvasTexture, SRGBColorSpace,
  Mesh, SphereGeometry, CylinderGeometry, TorusGeometry, DoubleSide,
} from 'three';
import { skinNormal, eyeTexture, fabricTexture, clothNormal, leatherNormal } from './textures.js';

const BONES = ['pelvis', 'abdomen', 'chest', 'head', 'upperArmL', 'forearmL', 'upperArmR', 'forearmR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));

// Facial landmarks as heights on the unit head sphere (dy = cos(polar)).
// Eyes sit at the vertical middle of the head, as in real proportions.
const FACE = { eye: 0.0, brow: 0.13, noseTip: -0.36, noseBase: -0.45, lipU: -0.55, mouth: -0.6, lipL: -0.65, chin: -0.88, hairline: 0.5 };

const gauss = (v, s) => Math.exp(-(v * v) / (s * s));
const sstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const window1 = (y, y0, y1, f = 0.03) => sstep(y0 - f, y0 + f, y) * (1 - sstep(y1 - f, y1 + f, y));

/** Accumulates skinned triangle geometry. */
class Builder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.si = [];
    this.sw = [];
    this.idx = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  vertex(x, y, z, u, v, weights) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    const w = weights.slice(0, 4);
    while (w.length < 4) w.push([0, 0]);
    let total = 0;
    for (const [, ww] of w) total += ww;
    for (const [b, ww] of w) {
      this.si.push(b);
      this.sw.push(total > 0 ? ww / total : 0);
    }
    return this.count - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  /** Grid of (rows+1) x (cols+1) vertices already added starting at `start`. */
  grid(start, rows, cols, flip = false) {
    const W = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = start + r * W + c, b = a + 1, d = a + W, e = d + 1;
        if (flip) { this.tri(a, b, d); this.tri(b, e, d); }
        else { this.tri(a, d, b); this.tri(b, d, e); }
      }
    }
  }

  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.count > 65535 ? new Uint32BufferAttribute(this.idx, 1) : new Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    smoothSeams(g);
    g.computeBoundingSphere();
    return g;
  }
}

/** Averages normals of coincident vertices (UV seams, ring closures). */
function smoothSeams(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const map = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const e = map.get(k);
    if (e) e.push(i); else map.set(k, [i]);
  }
  const v = new Vector3();
  for (const list of map.values()) {
    if (list.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of list) v.x += n.getX(i), v.y += n.getY(i), v.z += n.getZ(i);
    v.normalize();
    for (const i of list) n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
}

/**
 * Lofts a vertical tube through horizontal cross-sections.
 * rings: [{ y, cx, cz, hw, f, b, n, weights, bumps? }] from bottom to top.
 * Vertices go round from the back (u=0) through the right side, front
 * (u=0.5), left side and back again.
 */
function loftVertical(B, rings, segs, rect, { capTop = false, capBottom = false, section = null } = {}) {
  const [u0, v0, u1, v1] = rect;
  const start = B.count;
  const ys = rings.map((r) => r.y);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const pt = { x: 0, z: 0 };
  for (let r = 0; r < rings.length; r++) {
    const R = rings[r];
    for (let j = 0; j <= segs; j++) {
      const th = -Math.PI + (2 * Math.PI * j) / segs;
      ringPoint(R, th, pt, section);
      const v = v0 + ((R.y - ymin) / (ymax - ymin || 1)) * (v1 - v0);
      B.vertex(R.cx + pt.x, R.y, R.cz + pt.z, u0 + (j / segs) * (u1 - u0), v, R.weights);
    }
  }
  B.grid(start, rings.length - 1, segs, true);
  const cap = (ri, up) => {
    const R = rings[ri];
    const c = B.vertex(R.cx, R.y, R.cz, (u0 + u1) / 2, up ? v1 : v0, R.weights);
    const base = start + ri * (segs + 1);
    for (let j = 0; j < segs; j++) {
      if (up) B.tri(base + j, base + j + 1, c);
      else B.tri(base + j + 1, base + j, c);
    }
  };
  if (capTop) cap(rings.length - 1, true);
  if (capBottom) cap(0, false);
}

function ringPoint(R, th, out, section) {
  const s = Math.sin(th), c = Math.cos(th);
  const n = R.n ?? 2;
  const ex = 2 / n;
  let x = (R.hw) * Math.sign(s) * Math.pow(Math.abs(s), ex);
  let z = (c >= 0 ? R.f : R.b) * Math.sign(c) * Math.pow(Math.abs(c), ex);
  let bump = 0;
  if (R.bumps) for (const bp of R.bumps) {
    let d = th - bp.th;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    bump += bp.amp * gauss(d, bp.s);
  }
  if (section) bump += section(th, R);
  if (bump !== 0) {
    const len = Math.hypot(x, z) || 1;
    x += (x / len) * bump;
    z += (z / len) * bump;
  }
  out.x = x;
  out.z = z;
}

// Linear blend between two bones across a height band.
function blendY(y, lo, hi, boneLo, boneHi) {
  const t = sstep(lo, hi, y);
  if (t <= 0) return [[boneLo, 1]];
  if (t >= 1) return [[boneHi, 1]];
  return [[boneLo, 1 - t], [boneHi, t]];
}

/** Torso profile table (height, half-width, front depth, back depth, superellipse n) for a 1.80 m fighter. */
const TORSO = [
  [0.845, 0.148, 0.088, 0.1, 2.3],
  [0.9, 0.163, 0.1, 0.115, 2.3],
  [0.96, 0.17, 0.104, 0.122, 2.4],
  [1.02, 0.16, 0.1, 0.106, 2.5],
  [1.08, 0.146, 0.099, 0.09, 2.6],
  [1.14, 0.148, 0.103, 0.09, 2.7],
  [1.2, 0.157, 0.11, 0.095, 2.7],
  [1.26, 0.17, 0.118, 0.1, 2.7],
  [1.32, 0.181, 0.123, 0.105, 2.7],
  [1.38, 0.19, 0.121, 0.108, 2.6],
  [1.425, 0.194, 0.106, 0.104, 2.5],
  [1.46, 0.178, 0.086, 0.09, 2.3],
  [1.49, 0.13, 0.068, 0.078, 2.2],
  [1.52, 0.078, 0.056, 0.062, 2.0],
];

/** The same for a woman (scaled to her height): narrower shoulders and waist, wider hips. */
const TORSO_F = [
  [0.845, 0.158, 0.09, 0.106, 2.3],
  [0.9, 0.178, 0.1, 0.126, 2.3],
  [0.96, 0.184, 0.102, 0.128, 2.4],
  [1.02, 0.163, 0.095, 0.108, 2.5],
  [1.08, 0.132, 0.088, 0.088, 2.6],
  [1.14, 0.13, 0.09, 0.086, 2.7],
  [1.2, 0.14, 0.098, 0.09, 2.7],
  [1.26, 0.152, 0.104, 0.094, 2.7],
  [1.32, 0.16, 0.108, 0.098, 2.7],
  [1.38, 0.166, 0.106, 0.1, 2.6],
  [1.425, 0.17, 0.096, 0.098, 2.5],
  [1.46, 0.158, 0.08, 0.085, 2.3],
  [1.49, 0.116, 0.064, 0.074, 2.2],
  [1.52, 0.07, 0.054, 0.06, 2.0],
];

function lerpTable(table, y) {
  if (y <= table[0][0]) return table[0];
  for (let i = 1; i < table.length; i++) {
    if (y <= table[i][0]) {
      const a = table[i - 1], b = table[i];
      const t = (y - a[0]) / (b[0] - a[0]);
      const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
      return a.map((v, k) => v + (b[k] - v) * s);
    }
  }
  return table[table.length - 1];
}

function torsoSection(th, R) {
  const y = R.y0;
  let b = 0;
  if (R.female) {
    // bust, and a fuller seat; no muscle relief
    b += 0.034 * window1(y, 1.24, 1.37, 0.04) * (gauss(th - 0.48, 0.42) + gauss(th + 0.48, 0.42));
    b += 0.02 * window1(y, 0.87, 1.0, 0.04) * gauss(Math.abs(th) - 2.65, 0.45);
    b -= 0.004 * window1(y, 1.02, 1.46, 0.05) * gauss(Math.abs(th) - Math.PI, 0.16);
    return b;
  }
  // pecs
  b += 0.013 * window1(y, 1.29, 1.415, 0.035) * (gauss(th - 0.55, 0.38) + gauss(th + 0.55, 0.38));
  // lats flare
  b += 0.011 * window1(y, 1.22, 1.4, 0.05) * (gauss(Math.abs(th) - 1.9, 0.35));
  // shoulder blades
  b += 0.008 * window1(y, 1.3, 1.45, 0.04) * (gauss(Math.abs(th) - 2.55, 0.3));
  // spine groove
  b -= 0.006 * window1(y, 1.02, 1.46, 0.05) * gauss(Math.abs(th) - Math.PI, 0.16);
  // glutes
  b += 0.016 * window1(y, 0.88, 1.0, 0.04) * gauss(Math.abs(th) - 2.65, 0.4);
  // abdominal wall: slight six-pack ridges
  const abs = window1(y, 1.06, 1.27, 0.02) * gauss(th, 0.42);
  b += abs * (0.0035 * Math.cos(y * 2 * Math.PI / 0.065) + 0.002);
  // linea alba
  b -= 0.003 * window1(y, 1.05, 1.3, 0.03) * gauss(th, 0.05);
  // obliques / V-lines
  b += 0.004 * window1(y, 1.0, 1.1, 0.03) * (gauss(th - 0.9, 0.2) + gauss(th + 0.9, 0.2));
  return b;
}

export const SKIN_TONES = {
  light: '#e3b28e',
  medium: '#c48a62',
  tan: '#a56b45',
  brown: '#7d4f33',
  dark: '#5a3825',
};

/**
 * The fighter's body under the armour: a continuous skinned body (sculpted
 * head and face, neck and fists in skin; torso and sleeves in the cloth of
 * the shirt, doublet or gambeson; legs in hose; turnshoes). Bones follow the
 * ragdoll bodies, so every pose is the physics pose.
 */
export class BodyMesh {
  constructor(knight, {
    skin = SKIN_TONES.light, hair = '#3a2818', cloth = '#6a5a40', hose = '#4a3a2a', shoe = '#3b2a1c',
    iris = '#4a3a28', quality = 'high', inflateTorso = 0.006, inflateArm = 0.006, inflateLeg = 0.002,
    clothMap = null, clothNormalMap = null, clothRough = 0.88,
    female = false, beard = 0, headwear = null, texSize = 1024, gown = female,
  } = {}) {
    this.female = female;
    this.knight = knight;
    this.group = new Group();
    this.group.name = 'knight-' + knight.name;
    const rag = knight.ragdoll;
    const s = rag.anatomy.scale;
    this.s = s;
    const J = rag.anatomy.J;
    this.J = J;
    const segs = quality === 'low' ? 18 : 30;
    this.inflate = { torso: inflateTorso, arm: inflateArm, leg: inflateLeg };

    this.bones = BONES.map((n) => {
      const b = new Bone();
      b.name = n;
      b.position.copy(rag.bodies[n].userData.restPos);
      this.group.add(b);
      return b;
    });
    this.group.updateMatrixWorld(true);
    this.skeleton = new Skeleton(this.bones);

    this.painter = new SkinPainter(skin, hair, { size: texSize, beard: female ? 0 : beard, female });
    this.regions = this.painter.regions;

    // ---- skin: neck, head, fists ---------------------------------------------
    const SK = new Builder();
    const neck = [];
    for (let y = 1.43; y <= 1.67; y += 0.012) {
      const t = (y - 1.43) / 0.24;
      const hw = (0.064 - 0.006 * Math.sin(t * Math.PI) + 0.02 * sstep(0.35, 0, t)) * s;
      neck.push({ y: y * s, cx: 0, cz: (-0.006 - 0.008 * t) * s, hw, f: hw * (0.9 - 0.12 * t), b: hw * 1.02, n: 2, weights: blendY(y, 1.52, 1.62, BI.chest, BI.head) });
    }
    loftVertical(SK, neck, segs, this.regions.neck);
    this._buildHead(SK);
    for (const side of ['L', 'R']) this._buildHand(SK, side);
    const skinMat = new MeshPhysicalMaterial({
      map: this.painter.texture, normalMap: skinNormal(), normalScale: new Vector2(0.18, 0.18),
      roughness: 0.55, metalness: 0, sheen: 0.3, sheenRoughness: 0.55,
      sheenColor: new Color(skin).lerp(new Color('#ffb59a'), 0.5), specularIntensity: 0.5,
    });
    skinMat.normalMap.repeat.set(28, 28);
    applySubsurface(skinMat);
    this.skinMat = skinMat;
    this.skinMesh = this._addMesh(SK.build(), skinMat);

    const E = new Builder();
    for (const sx of [1, -1]) this._buildEye(E, sx);
    this.eyeMesh = this._addMesh(E.build(), new MeshPhysicalMaterial({ map: eyeTexture(iris), roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 }));

    // ---- cloth: torso and sleeves ----------------------------------------------
    const CL = new Builder();
    const rings = [];
    const it = inflateTorso;
    const TT = female ? TORSO_F : TORSO;
    for (let y = TT[0][0]; y <= TT[TT.length - 1][0] + 1e-6; y += 0.0125) {
      const [, hw, f, b, n] = lerpTable(TT, y);
      let weights;
      if (y < 1.1) weights = blendY(y, 1.03, 1.1, BI.pelvis, BI.abdomen);
      else weights = blendY(y, 1.19, 1.26, BI.abdomen, BI.chest);
      rings.push({ y: y * s, y0: y, cx: 0, cz: -0.004 * s, hw: (hw + it) * s, f: (f + it) * s, b: (b + it) * s, n, weights, female });
    }
    loftVertical(CL, rings, segs * 2, [0, 0, 1, 1], { capTop: true, capBottom: true, section: (th, R) => torsoSection(th, R) * s * 0.35 });
    for (const side of ['L', 'R']) this._buildArm(CL, side, segs);
    this.clothMat = new MeshStandardMaterial({
      color: clothMap ? '#ffffff' : cloth, map: clothMap ?? fabricTexture(cloth), roughness: clothRough,
      normalMap: clothNormalMap ?? clothNormal(), normalScale: new Vector2(0.5, 0.5),
    });
    this.clothMat.map.repeat?.set(3, 3);
    this.clothMesh = this._addMesh(CL.build(), this.clothMat);
    if (gown) this._buildGown(segs, cloth);
    if (headwear) this._buildHeadwear(headwear, hair);

    // ---- hose ------------------------------------------------------------------
    const HO = new Builder();
    for (const side of ['L', 'R']) this._buildLeg(HO, side, segs);
    this.hoseMat = new MeshStandardMaterial({ color: '#ffffff', map: fabricTexture(hose), roughness: 0.9, normalMap: clothNormal(), normalScale: new Vector2(0.4, 0.4) });
    this.hoseMesh = this._addMesh(HO.build(), this.hoseMat);

    // ---- turnshoes ---------------------------------------------------------------
    const SH = new Builder();
    for (const side of ['L', 'R']) this._buildShoe(SH, side);
    this.shoeMat = new MeshStandardMaterial({ color: shoe, roughness: 0.62, normalMap: leatherNormal(), normalScale: new Vector2(0.4, 0.4) });
    this.shoeMesh = this._addMesh(SH.build(), this.shoeMat);
    this._q = new Quaternion();
    this._p = new Vector3();
  }

  /**
   * The long gown (kirtle) of a woman of 1400: fitted to the hips, falling
   * in a wide bell to the ankle. Rigid to the pelvis, flared enough for the stride.
   */
  _buildGown(segs, cloth) {
    const s = this.s;
    const G = new Builder();
    const rings = [];
    for (let y = 1.0; y >= 0.04; y -= 0.04) {
      const t = (1.0 - y) / 0.96;
      const hw = 0.19 + 0.17 * t * t + 0.03 * t;
      rings.push({ y: y * s, y0: y, cx: 0, cz: (-0.01 + 0.02 * t) * s, hw: hw * s, f: (0.12 + 0.17 * t * t) * s, b: (0.14 + 0.19 * t * t) * s, n: 2.2, weights: [[BI.pelvis, 1]] });
    }
    rings.reverse();
    // folds deepen toward the hem
    loftVertical(G, rings, segs * 2, [0, 0, 1, 1], { section: (th, R) => (0.012 * (1 - R.y0)) * Math.sin(th * 9) * s });
    const mat = new MeshStandardMaterial({ color: '#ffffff', map: fabricTexture(cloth), roughness: 0.92, normalMap: clothNormal(), normalScale: new Vector2(0.4, 0.4), side: DoubleSide });
    mat.map.repeat?.set(4, 3);
    mat.userData.cloth = true;
    this.gownMesh = this._addMesh(G.build(), mat);
  }

  /**
   * Women's headwear: a married woman covers her hair with a linen veil and
   * wimple (the Wenceslas Bible and every Bohemian painting of the time); a
   * girl wears her hair in a braid with a band (vínek); a working woman ties
   * a kerchief. Built rigid on the head bone.
   */
  _buildHeadwear(kind, hair) {
    const s = this.s, C = this._headCenter(), rest = this.knight.ragdoll.bodies.head.userData.restPos;
    const head = this.bones[BI.head];
    const add = (geo, mat) => { geo.translate(-rest.x, -rest.y, -rest.z); const m = new Mesh(geo, mat); m.castShadow = true; head.add(m); return m; };
    if (kind === 'veil' || kind === 'kerchief') {
      const linen = new MeshStandardMaterial({ color: kind === 'veil' ? '#ece6d8' : '#c8b088', roughness: 0.9, side: DoubleSide });
      linen.userData.cloth = true;
      const g = 0.62;   // the face opening, radians either side of the front
      const cap = new SphereGeometry(0.118 * s, 32, 20, Math.PI / 2 + g, Math.PI * 2 - 2 * g, 0, Math.PI * (kind === 'veil' ? 0.78 : 0.66));
      cap.scale(1, 1.12, 1.08);
      add(cap.translate(C.x, C.y + 0.008 * s, C.z - 0.004 * s), linen);
      if (kind === 'kerchief') {
        // the cloth comes down behind to the nape and is knotted there
        const back = new CylinderGeometry(0.1 * s, 0.112 * s, 0.11 * s, 20, 1, true, Math.PI / 2 + 0.3, Math.PI - 0.6);
        add(back.translate(C.x, C.y - 0.05 * s, C.z - 0.01 * s), linen);
        add(new SphereGeometry(0.03 * s, 10, 8).scale(1.4, 1, 1).translate(C.x, C.y - 0.06 * s, C.z - 0.115 * s), linen);
        for (const sx of [-1, 1]) add(new CylinderGeometry(0.012 * s, 0.02 * s, 0.09 * s, 6).rotateZ(sx * 0.35).translate(C.x + sx * 0.02 * s, C.y - 0.11 * s, C.z - 0.118 * s), linen);
      }
      if (kind === 'veil') {
        // the wimple under the chin and the veil falling over the shoulders behind
        const wimple = new CylinderGeometry(0.075 * s, 0.11 * s, 0.13 * s, 24, 1, true);
        add(wimple.translate(C.x, C.y - 0.12 * s, C.z - 0.005 * s), linen);
        const drape = new CylinderGeometry(0.12 * s, 0.2 * s, 0.26 * s, 24, 1, true, 0.9, Math.PI * 2 - 1.8);
        add(drape.translate(C.x, C.y - 0.1 * s, C.z - 0.03 * s), linen);
        add(new TorusGeometry(0.112 * s, 0.006 * s, 6, 32).rotateX(Math.PI / 2 - 0.25).translate(C.x, C.y + 0.07 * s, C.z), linen);
      }
    } else if (kind === 'braid') {
      const hm = new MeshStandardMaterial({ color: hair, roughness: 0.7 });
      // hair gathered back, and one long braid down the back
      const back = new SphereGeometry(0.106 * s, 24, 16, Math.PI / 2 + 1.0, Math.PI * 2 - 2.0, 0, Math.PI * 0.62);
      add(back.scale(1, 1.1, 1.06).translate(C.x, C.y + 0.012 * s, C.z - 0.006 * s), hm);
      for (let i = 0; i < 9; i++) {
        const y = C.y - 0.06 * s - i * 0.045 * s, r = (0.026 - 0.0015 * i) * s;
        add(new SphereGeometry(r, 10, 8).scale(1, 1.4, 1).translate(C.x + (i % 2 ? 0.006 : -0.006) * s, y, C.z - 0.105 * s - Math.min(i, 3) * 0.008 * s), hm);
      }
      const band = new MeshStandardMaterial({ color: '#b0161c', roughness: 0.8 });
      add(new TorusGeometry(0.109 * s, 0.007 * s, 6, 32).rotateX(Math.PI / 2 - 0.3).translate(C.x, C.y + 0.05 * s, C.z), band);
    }
  }

  _addMesh(geo, mat) {
    const m = new SkinnedMesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.bind(this.skeleton, new Matrix4());
    this.group.add(m);
    return m;
  }

  _buildArm(B, side, segs) {
    const s = this.s, J = this.J;
    const sx = side === 'L' ? 1 : -1;
    const sh = new Vector3(sx * J.shoulderX, J.shoulderY, 0);
    const armX = sx * (J.shoulderX + 0.02 * s);
    const el = new Vector3(armX, J.elbowY, 0);
    const wr = new Vector3(armX, J.wristY, 0);
    const ua = BI['upperArm' + side], fa = BI['forearm' + side];
    // Profile: distance below the shoulder joint -> (rx lateral, front, back)
    const prof = [
      [0.0, 0.064, 0.062, 0.062],
      [0.05, 0.064, 0.06, 0.06],
      [0.1, 0.057, 0.056, 0.057],
      [0.15, 0.051, 0.058, 0.055],
      [0.2, 0.049, 0.058, 0.052],
      [0.25, 0.045, 0.05, 0.048],
      [0.3, 0.04, 0.041, 0.043],
      [0.34, 0.046, 0.047, 0.045],
      [0.4, 0.045, 0.044, 0.04],
      [0.46, 0.039, 0.036, 0.034],
      [0.52, 0.033, 0.03, 0.029],
      [0.57, 0.03, 0.027, 0.027],
    ];
    const rings = [];
    const L1 = J.shoulderY - J.elbowY;
    // Shoulder cap: hemisphere around the joint.
    const r0 = prof[0][1] * s;
    for (let k = 5; k >= 1; k--) {
      const a = (k / 6) * (Math.PI / 2);
      rings.push({ y: sh.y + Math.sin(a) * r0, cx: sh.x + sx * 0.004 * s, cz: 0, hw: Math.cos(a) * r0, f: Math.cos(a) * r0, b: Math.cos(a) * r0, n: 2, weights: [[ua, 1]] });
    }
    for (let d = 0; d <= 0.57 + 1e-6; d += 0.0125) {
      const i = prof.findIndex((p) => p[0] >= d);
      const a = prof[Math.max(0, i - 1)], b = prof[Math.max(0, i)];
      const t = b[0] === a[0] ? 0 : (d - a[0]) / (b[0] - a[0]);
      const ia = this.inflate.arm * Math.max(0, 1 - Math.max(0, d - 0.5) / 0.07);
      const rx = (a[1] + (b[1] - a[1]) * t + ia) * s, f = (a[2] + (b[2] - a[2]) * t + ia) * s, bk = (a[3] + (b[3] - a[3]) * t + ia) * s;
      const y = sh.y - d * s;
      const c = y > el.y ? new Vector3().lerpVectors(sh, el, (sh.y - y) / L1) : new Vector3().lerpVectors(el, wr, (el.y - y) / (el.y - wr.y));
      const weights = blendY(-y, -(el.y + 0.035 * s), -(el.y - 0.03 * s), ua, fa);
      rings.push({ y, cx: c.x + sx * 0.004 * s * Math.max(0, 1 - d / 0.15), cz: c.z, hw: rx, f, b: bk, n: 2, weights,
        bumps: [{ th: 0.2 * sx, s: 0.5, amp: 0.004 * s * window1(d, 0.12, 0.28, 0.04) }] });
    }
    rings.reverse();
    loftVertical(B, rings, segs, this.regions['arm' + side], { capTop: true });
  }

  _buildLeg(B, side, segs) {
    const s = this.s, J = this.J;
    const sx = side === 'L' ? 1 : -1;
    const x = sx * J.hipX;
    const th = BI['thigh' + side], sh = BI['shin' + side];
    const prof = [
      [0.1, 0.04, 0.04, 0.04],
      [0.16, 0.046, 0.043, 0.049],
      [0.24, 0.052, 0.049, 0.06],
      [0.32, 0.059, 0.052, 0.07],
      [0.38, 0.061, 0.053, 0.07],
      [0.45, 0.058, 0.058, 0.06],
      [0.505, 0.056, 0.059, 0.054],
      [0.56, 0.062, 0.067, 0.062],
      [0.65, 0.073, 0.079, 0.074],
      [0.75, 0.082, 0.089, 0.083],
      [0.86, 0.089, 0.094, 0.092],
      [0.97, 0.094, 0.098, 0.1],
    ];
    const rings = [];
    for (let y = 0.1; y <= 0.97 + 1e-6; y += 0.0125) {
      const i = prof.findIndex((p) => p[0] >= y);
      const a = prof[Math.max(0, i - 1)], b = prof[Math.max(0, i)];
      const t = b[0] === a[0] ? 0 : (y - a[0]) / (b[0] - a[0]);
      const il = this.inflate.leg;
      const rx = a[1] + (b[1] - a[1]) * t + il, f = a[2] + (b[2] - a[2]) * t + il, bk = a[3] + (b[3] - a[3]) * t + il;
      const weights = blendY(y, 0.47, 0.55, sh, th);
      // quads bulge (front-inner), calf (back)
      const bumps = [
        { th: 0.25 * sx, s: 0.45, amp: 0.006 * window1(y, 0.6, 0.85, 0.06) * s },
        { th: Math.PI, s: 0.8, amp: 0.004 * window1(y, 0.3, 0.42, 0.05) * s },
      ];
      rings.push({ y: y * s, cx: x * (1 - 0.1 * (1 - y / 0.97)), cz: (y < 0.5 ? -0.004 : 0) * s, hw: rx * s, f: f * s, b: bk * s, n: 2, weights, bumps });
    }
    loftVertical(B, rings, segs, this.regions['leg' + side]);
  }

  /** Head shape: a sculpted ellipsoid (brow, sockets, nose, lips, jaw, chin). */
  static sculpt(dx, dy, dz, out) {
    const F = FACE;
    const a = 0.079, b = 0.114, c = 0.1;
    let x = dx * a, y = dy * b, z = dz * c;
    const front = Math.max(0, dz);
    const f2 = front * front;
    // fuller, higher occiput
    if (dz < 0) z *= 1 + 0.08 * -dz * sstep(-0.4, 0.3, dy);
    // rounder, broader crown (an ellipsoid alone looks like an egg)
    const crown = sstep(0.25, 0.95, dy);
    x *= 1 + 0.1 * crown;
    z *= 1 + 0.06 * crown;
    y *= 1 - 0.05 * crown;
    // cranium a touch wider than the face; square jaw
    const lower = sstep(-0.2, -0.9, dy);
    x *= 1 - 0.12 * lower * (0.3 + 0.7 * front) + 0.03 * sstep(-0.1, 0.4, dy);
    // lower face projects forward (maxilla, mouth, chin)
    z += 0.014 * f2 * sstep(-0.98, -0.62, dy) * (1 - sstep(-0.5, -0.1, dy));
    // chin
    z += 0.008 * gauss(dx, 0.28) * gauss(dy - F.chin, 0.1) * front;
    // underside of the jaw tucks in toward the neck
    if (dy < -0.85) z -= 0.02 * (1 - front) * sstep(-0.85, -1, dy);
    // brow ridge; forehead slopes back
    z += 0.009 * gauss(dy - F.brow, 0.08) * gauss(dx, 0.6) * front;
    z -= 0.005 * gauss(dy - 0.55, 0.22) * f2;
    // eye sockets: almond opening with lids above and below
    for (const s of [1, -1]) {
      z -= 0.013 * gauss(dx - s * 0.35, 0.125) * gauss(dy - F.eye, 0.068) * front;
      z += 0.0022 * gauss(dx - s * 0.35, 0.13) * (gauss(dy - F.eye - 0.085, 0.03) + 0.6 * gauss(dy - F.eye + 0.08, 0.03)) * front;
      // soft bags under the eyes
      z += 0.002 * gauss(dx - s * 0.33, 0.14) * gauss(dy - F.eye + 0.13, 0.05) * front;
    }
    // nose: bridge from between the eyes, tip, then under to the lip
    const bridge = sstep(F.eye + 0.1, F.eye - 0.02, dy);
    const noseZ = dy > F.noseTip
      ? 0.006 + 0.03 * sstep(F.eye + 0.02, F.noseTip, dy)
      : 0.036 * (1 - sstep(F.noseTip, F.noseBase, dy));
    const noseW = 0.075 + 0.08 * sstep(F.eye - 0.15, F.noseTip - 0.03, dy);
    z += bridge * noseZ * gauss(dx, noseW) * f2;
    // nostrils (alae)
    z += 0.008 * gauss(Math.abs(dx) - 0.14, 0.055) * gauss(dy - F.noseTip + 0.04, 0.055) * front;
    // cheekbones and cheeks
    const cheek = 0.009 * gauss(dy - F.eye + 0.13, 0.14) * (gauss(dx - 0.58, 0.2) + gauss(dx + 0.58, 0.2));
    x += Math.sign(dx) * cheek * 0.8;
    z += cheek * 0.5;
    // mouth: lips and the line between them
    z += 0.007 * gauss(dx, 0.2) * gauss(dy - F.lipU, 0.045) * front;
    z += 0.006 * gauss(dx, 0.17) * gauss(dy - F.lipL, 0.04) * front;
    z -= 0.005 * gauss(dx, 0.24) * gauss(dy - F.mouth, 0.013) * front;
    // philtrum
    z -= 0.0018 * gauss(dx, 0.045) * gauss(dy - (F.noseBase + F.lipU) / 2, 0.04) * front;
    // temples
    x -= 0.004 * gauss(dy - 0.2, 0.12) * gauss(Math.abs(dz) - 0.55, 0.2) * Math.sign(dx);
    out.set(x, y, z);
    return out;
  }

  _headCenter() {
    const J = this.J, s = this.s;
    return new Vector3(0, J.neckY + 0.132 * s, 0.006 * s);
  }

  _buildHead(B) {
    const s = this.s;
    const C = this._headCenter();
    this.headCenter = C;
    const segU = 72, segV = 56;
    const [u0, v0, u1, v1] = this.regions.head;
    const start = B.count;
    const p = new Vector3();
    for (let iv = 0; iv <= segV; iv++) {
      const phi = (Math.PI * iv) / segV;
      for (let iu = 0; iu <= segU; iu++) {
        const th = -Math.PI + (2 * Math.PI * iu) / segU;
        const dx = Math.sin(phi) * Math.sin(th), dy = Math.cos(phi), dz = Math.sin(phi) * Math.cos(th);
        BodyMesh.sculpt(dx, dy, dz, p);
        // short haircut adds a little volume
        const hair = sstep(0.25, 0.45, dy) * (1 - sstep(0.55, 0.75, dz) * (1 - sstep(0.55, 0.7, dy)));
        p.multiplyScalar(s * (1 + 0.035 * hair));
        B.vertex(C.x + p.x, C.y + p.y, C.z + p.z, u0 + (iu / segU) * (u1 - u0), v1 - (iv / segV) * (v1 - v0), [[BI.head, 1]]);
      }
    }
    B.grid(start, segV, segU, false);
    // Ears: flattened ellipsoids on the sides.
    for (const sx of [1, -1]) {
      const ec = new Vector3(sx * 0.078 * s, -0.004 * s, -0.012 * s).add(C);
      const eStart = B.count;
      const eu = 16, ev = 12;
      const [a0, b0, a1, b1] = this.regions.ears;
      for (let iv = 0; iv <= ev; iv++) {
        const phi = (Math.PI * iv) / ev;
        for (let iu = 0; iu <= eu; iu++) {
          const th = (2 * Math.PI * iu) / eu;
          const lx = Math.sin(phi) * Math.cos(th), ly = Math.cos(phi), lz = Math.sin(phi) * Math.sin(th);
          // shell shape: thin, tilted back, with a rim
          const rim = 1 + 0.15 * Math.pow(Math.abs(lz), 3);
          const x = ec.x + sx * lx * 0.011 * s * (lx * sx > 0 ? 1 : 0.35);
          const y = ec.y + ly * 0.03 * s * rim;
          const z = ec.z + lz * 0.019 * s * rim - ly * 0.006 * s;
          B.vertex(x, y, z, a0 + (iu / eu) * (a1 - a0), b1 - (iv / ev) * (b1 - b0), [[BI.head, 1]]);
        }
      }
      B.grid(eStart, ev, eu, sx < 0);
    }
  }

  _buildEye(E, sx) {
    const s = this.s;
    const C = this.headCenter;
    const d = new Vector3(sx * 0.35, FACE.eye, 0).setZ(Math.sqrt(1 - 0.35 * 0.35 - FACE.eye * FACE.eye)).normalize();
    const p = BodyMesh.sculpt(d.x, d.y, d.z, new Vector3()).multiplyScalar(s);
    const center = p.add(C).add(new Vector3(0, 0, -0.0058 * s));
    const r = 0.0122 * s;
    const seg = 20;
    const start = E.count;
    for (let iv = 0; iv <= seg; iv++) {
      const phi = (Math.PI * iv) / seg;
      for (let iu = 0; iu <= seg; iu++) {
        const th = -Math.PI + (2 * Math.PI * iu) / seg;
        const x = Math.sin(phi) * Math.sin(th), y = Math.cos(phi), z = Math.sin(phi) * Math.cos(th);
        // texture: iris at the front (u=0.5, v=0.5)
        E.vertex(center.x + x * r, center.y + y * r, center.z + z * r, iu / seg, 1 - iv / seg, [[BI.head, 1]]);
      }
    }
    E.grid(start, seg, seg, false);
  }

  _buildHand(G, side) {
    const s = this.s;
    const rag = this.knight.ragdoll;
    const fore = rag.bodies['forearm' + side];
    const hand = fore.shapes.find((sh) => sh.userData.part === 'hand');
    const C = fore.userData.restPos.clone().add(hand.offset);
    const sx = side === 'L' ? 1 : -1;
    const bone = BI['forearm' + side];
    const seg = 24, segV = 18;
    const start = G.count;
    const p = new Vector3();
    for (let iv = 0; iv <= segV; iv++) {
      const phi = (Math.PI * iv) / segV;
      for (let iu = 0; iu <= seg; iu++) {
        const th = -Math.PI + (2 * Math.PI * iu) / seg;
        const dx = Math.sin(phi) * Math.sin(th), dy = Math.cos(phi), dz = Math.sin(phi) * Math.cos(th);
        const k = dy < 0 ? 1 + 0.08 * -dy : 1 - 0.3 * Math.pow(dy, 3);
        const medial = dx * sx < 0 ? 0.85 : 1;
        p.set(dx * 0.036 * k * medial, dy * 0.052, dz * 0.044 * k);
        p.z += 0.003 * gauss(dy + 0.35, 0.15) * Math.max(0, dz);
        p.multiplyScalar(s);
        G.vertex(C.x + p.x, C.y + p.y + 0.006 * s, C.z + p.z, 0.95, 0.4, [[bone, 1]]);
      }
    }
    G.grid(start, segV, seg, false);
    const tStart = G.count;
    const tSeg = 10, tLen = 8;
    for (let i = 0; i <= tLen; i++) {
      const t = i / tLen;
      const cy = C.y + (0.02 - 0.05 * t) * s;
      const cz = C.z + (0.042 + 0.01 * Math.sin(t * Math.PI)) * s;
      const cxx = C.x + sx * (0.016 - 0.008 * t) * s;
      const r = (0.012 * Math.sqrt(Math.sin(Math.min(1, t * 1.1 + 0.08) * Math.PI) + 0.05)) * s;
      for (let j = 0; j <= tSeg; j++) {
        const th = (2 * Math.PI * j) / tSeg;
        G.vertex(cxx + Math.cos(th) * r, cy, cz + Math.sin(th) * r, 0.95, 0.4, [[bone, 1]]);
      }
    }
    G.grid(tStart, tLen, tSeg, sx < 0);
  }

  _buildShoe(K, side) {
    const s = this.s;
    const foot = BI['foot' + side], shin = BI['shin' + side];
    const fb = this.knight.ragdoll.bodies['foot' + side];
    const fc = fb.userData.restPos;
    const fStart = K.count;
    const nu = 26, nv = 14;
    const p = new Vector3();
    for (let iv = 0; iv <= nv; iv++) {
      const phi = (Math.PI * iv) / nv;
      for (let iu = 0; iu <= nu; iu++) {
        const th = -Math.PI + (2 * Math.PI * iu) / nu;
        const dx = Math.sin(phi) * Math.sin(th), dy = Math.cos(phi), dz = Math.sin(phi) * Math.cos(th);
        const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
        const len = dz > 0 ? 0.142 : 0.085;
        const toeTaper = 1 - 0.55 * Math.max(0, dz) ** 2;
        const hy = dy > 0 ? 0.05 * (1 - 0.45 * Math.max(0, dz)) : 0.04;
        p.set(sp(dx, 0.7) * 0.048 * toeTaper, sp(dy, 0.6) * hy, sp(dz, 0.8) * len);
        p.multiplyScalar(s);
        K.vertex(fc.x + p.x, fc.y + 0.004 * s + p.y, fc.z + 0.016 * s + p.z, iu / nu, iv / nv, [[foot, 1]]);
      }
    }
    K.grid(fStart, nv, nu, false);
    // ankle collar
    const rings = [];
    const x = (side === 'L' ? 1 : -1) * this.J.hipX;
    for (let y = 0.07; y <= 0.13; y += 0.012) {
      const r = (0.046 + 0.004 * sstep(0.12, 0.08, y)) * s;
      rings.push({ y: y * s, cx: x, cz: 0.0, hw: r, f: r, b: r * 1.08, n: 2, weights: blendY(y, 0.075, 0.12, foot, shin) });
    }
    loftVertical(K, rings, 20, [0, 0, 1, 1]);
  }

  /** Copies the (interpolated) body poses onto the bones. */
  update(alpha = 1) {
    const rag = this.knight.ragdoll;
    for (let i = 0; i < BONES.length; i++) {
      const body = rag.bodies[BONES[i]];
      const bone = this.bones[i];
      const rest = body.userData.restPos;
      const pos = body.renderPos ?? body.pos, q = body.renderQ ?? body.q;
      // bone origin sits at the body's rest-pose COM; rotation is the body's.
      bone.quaternion.copy(q);
      bone.position.copy(pos);
      void rest;
      void alpha;
    }
    this.group.updateMatrixWorld(true);
  }

  /** Paints a cut or bruise on the face or scalp where a blow landed. */
  mark(worldPoint, severity, cut = true) {
    const head = this.knight.ragdoll.bodies.head;
    const local = head.worldToLocal(worldPoint, new Vector3()).add(head.userData.restPos).sub(this.headCenter);
    const d = local.clone().normalize();
    const phi = Math.acos(Math.max(-1, Math.min(1, d.y)));
    const th = Math.atan2(d.x, d.z);
    const [u0, v0, u1, v1] = this.regions.head;
    const u = u0 + ((th + Math.PI) / (2 * Math.PI)) * (u1 - u0);
    const v = v1 - (phi / Math.PI) * (v1 - v0);
    this.painter.bruise(u, v, 0.012 + 0.02 * Math.min(1, severity), Math.min(0.5, 0.12 + severity * 0.5));
    if (cut) this.painter.cut(u, v);
  }
}

/**
 * Skin albedo atlas: base tone with subtle variation, painted facial
 * features and hair, plus runtime bruising.
 */
class SkinPainter {
  constructor(skin, hair, { size = 1024, beard = 0, female = false } = {}) {
    const S = size;
    this.beard = beard;
    this.female = female;
    this.S = S;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = S;
    const g = (this.g = this.canvas.getContext('2d'));
    this.regions = {
      head: [0, 0.5, 0.5, 1],
      torso: [0.5, 0.5, 1, 1],
      armL: [0, 0, 0.25, 0.5],
      armR: [0.25, 0, 0.5, 0.5],
      legL: [0.5, 0, 0.7, 0.5],
      legR: [0.7, 0, 0.9, 0.5],
      neck: [0.9, 0, 1, 0.25],
      ears: [0.9, 0.25, 1, 0.5],
    };
    const base = new Color(skin);
    g.fillStyle = skin;
    g.fillRect(0, 0, S, S);
    // Mottling
    for (let i = 0; i < 5000; i++) {
      const c = base.clone().offsetHSL((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06);
      g.fillStyle = `#${c.getHexString()}`;
      g.globalAlpha = 0.08;
      const r = 2 + Math.random() * 10;
      g.beginPath();
      g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    this._paintTorso(base);
    this._paintFace(base, new Color(hair));
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  px(u, v) {
    return [u * this.S, (1 - v) * this.S];
  }

  headUV(dx, dy, dz) {
    const len = Math.hypot(dx, dy, dz);
    dx /= len; dy /= len; dz /= len;
    const phi = Math.acos(dy);
    const th = Math.atan2(dx, dz);
    const [u0, v0, u1, v1] = this.regions.head;
    return this.px(u0 + ((th + Math.PI) / (2 * Math.PI)) * (u1 - u0), v1 - (phi / Math.PI) * (v1 - v0));
  }

  _paintTorso(base) {
    const g = this.g;
    const [u0, v0, u1, v1] = this.regions.torso;
    const [x0, y1] = this.px(u0, v0), [x1, y0] = this.px(u1, v1);
    const W = x1 - x0, H = y1 - y0;
    const yOf = (h) => y1 - ((h - 0.845) / (1.52 - 0.845)) * H;
    const xOf = (th) => x0 + ((th + Math.PI) / (2 * Math.PI)) * W;
    const dark = base.clone().multiplyScalar(0.72);
    g.fillStyle = `#${dark.getHexString()}`;
    // nipples / areolae
    for (const th of [0.62, -0.62]) {
      g.globalAlpha = 0.6;
      g.beginPath();
      g.ellipse(xOf(th), yOf(1.325), 7, 6, 0, 0, Math.PI * 2);
      g.fill();
    }
    // navel
    g.globalAlpha = 0.7;
    g.beginPath();
    g.ellipse(xOf(0), yOf(1.085), 4, 6, 0, 0, Math.PI * 2);
    g.fill();
    // muscle shading (soft)
    g.globalAlpha = 0.07;
    for (let k = 0; k < 3; k++) {
      g.fillRect(xOf(-0.5), yOf(1.13 + k * 0.065) - 2, xOf(0.5) - xOf(-0.5), 3);
    }
    g.fillRect(xOf(0) - 1.5, yOf(1.3), 3, yOf(1.05) - yOf(1.3));
    // pec underline
    g.globalAlpha = 0.12;
    g.lineWidth = 5;
    g.strokeStyle = `#${dark.getHexString()}`;
    for (const sgn of [1, -1]) {
      g.beginPath();
      g.moveTo(xOf(sgn * 0.08), yOf(1.29));
      g.quadraticCurveTo(xOf(sgn * 0.6), yOf(1.265), xOf(sgn * 1.05), yOf(1.33));
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  _paintFace(base, hair) {
    const g = this.g;
    const [u0, v0, u1, v1] = this.regions.head;
    const [hx0, hy1] = this.px(u0, v0), [hx1, hy0] = this.px(u1, v1);
    const HW = hx1 - hx0, HH = hy1 - hy0;
    // Map (theta, phi) grid for per-pixel painting of hair and stubble.
    const img = g.getImageData(hx0, hy0, HW, HH);
    const d = img.data;
    const hairRGB = [hair.r * 255, hair.g * 255, hair.b * 255];
    const stub = base.clone().lerp(hair, 0.35);
    const stubRGB = [stub.r * 255, stub.g * 255, stub.b * 255];
    for (let y = 0; y < HH; y++) {
      const phi = (y / HH) * Math.PI;
      const dy = Math.cos(phi);
      for (let x = 0; x < HW; x++) {
        const th = -Math.PI + (x / HW) * 2 * Math.PI;
        const dz = Math.sin(phi) * Math.cos(th);
        const dx = Math.sin(phi) * Math.sin(th);
        // hairline: top of head, not the forehead; faded on the sides/back
        let h = sstep(0.3, 0.44, dy) * (1 - sstep(0.52, 0.66, dz) * (1 - sstep(FACE.hairline, FACE.hairline + 0.12, dy)));
        // fade: short on the sides above the ears
        h = Math.max(h, 0.55 * sstep(-0.05, 0.25, dy) * sstep(0.1, -0.2, dz));
        const noise = Math.random();
        const i = (y * HW + x) * 4;
        if (h > 0.01) {
          const a = Math.min(1, h * (0.75 + 0.35 * noise));
          d[i] = d[i] * (1 - a) + hairRGB[0] * a;
          d[i + 1] = d[i + 1] * (1 - a) + hairRGB[1] * a;
          d[i + 2] = d[i + 2] * (1 - a) + hairRGB[2] * a;
        }
        // stubble on jaw, chin and upper lip
        const beard = sstep(FACE.noseTip, FACE.noseBase - 0.05, dy) * sstep(0.15, 0.5, Math.abs(dz) + 0.3 * sstep(-0.4, -0.7, dy)) * (dz > -0.2 ? 1 : 0);
        if (beard > 0 && noise < 0.55 + 0.4 * this.beard) {
          const a = this.female ? 0 : beard * (0.16 + 0.75 * this.beard);
          d[i] = d[i] * (1 - a) + stubRGB[0] * a;
          d[i + 1] = d[i + 1] * (1 - a) + stubRGB[1] * a;
          d[i + 2] = d[i + 2] * (1 - a) + stubRGB[2] * a;
        }
      }
    }
    g.putImageData(img, hx0, hy0);
    // Eyebrows
    g.strokeStyle = `#${hair.getHexString()}`;
    g.lineCap = 'round';
    for (const sx of [1, -1]) {
      for (let k = 0; k < 26; k++) {
        const t = k / 25;
        const dx = sx * (0.14 + 0.44 * t);
        const dy = FACE.brow + 0.01 + 0.035 * Math.sin(t * Math.PI) - 0.02 * t;
        const [px, py] = this.headUV(dx, dy, Math.sqrt(Math.max(0.05, 1 - dx * dx - dy * dy)));
        g.globalAlpha = 0.55;
        g.lineWidth = 3.2 - 1.5 * t;
        g.beginPath();
        g.moveTo(px - sx * 2, py + 1.5);
        g.lineTo(px + sx * 2, py - 1.5);
        g.stroke();
      }
    }
    // Eye area: lids and lashes shadow
    for (const sx of [1, -1]) {
      const [px, py] = this.headUV(sx * 0.35, FACE.eye, 0.93);
      const grd = g.createRadialGradient(px, py, 2, px, py, 20);
      grd.addColorStop(0, 'rgba(40,20,15,0.55)');
      grd.addColorStop(1, 'rgba(40,20,15,0)');
      g.globalAlpha = 1;
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(px, py, 22, 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Lips
    const lip = base.clone().lerp(new Color('#8a3b36'), 0.45);
    g.fillStyle = `#${lip.getHexString()}`;
    for (const [dy, h] of [[FACE.lipU, 5], [FACE.lipL, 6]]) {
      const [px, py] = this.headUV(0, dy, 0.9);
      g.globalAlpha = 0.6;
      g.beginPath();
      g.ellipse(px, py, 20, h, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.7;
    g.fillStyle = 'rgba(40,15,12,1)';
    {
      const [px, py] = this.headUV(0, FACE.mouth, 0.9);
      g.fillRect(px - 18, py - 1, 36, 2);
    }
    // Warm cheeks / nose
    for (const [dx, dy, r] of [[0.5, FACE.eye - 0.2, 30], [-0.5, FACE.eye - 0.2, 30], [0, FACE.noseTip + 0.02, 12]]) {
      const [px, py] = this.headUV(dx, dy, 0.85);
      const grd = g.createRadialGradient(px, py, 1, px, py, r);
      grd.addColorStop(0, 'rgba(190,70,60,0.12)');
      grd.addColorStop(1, 'rgba(190,70,60,0)');
      g.fillStyle = grd;
      g.globalAlpha = 1;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }

  bruise(u, v, r, alpha) {
    const g = this.g;
    const [x, y] = this.px(u, v);
    const R = r * this.S;
    const grd = g.createRadialGradient(x, y, 0, x, y, R);
    grd.addColorStop(0, `rgba(120,30,40,${alpha})`);
    grd.addColorStop(0.5, `rgba(110,40,70,${alpha * 0.6})`);
    grd.addColorStop(1, 'rgba(100,40,60,0)');
    g.fillStyle = grd;
    g.fillRect(x - R, y - R, R * 2, R * 2);
    this.texture.needsUpdate = true;
  }

  cut(u, v) {
    const g = this.g;
    const [x, y] = this.px(u, v);
    g.strokeStyle = 'rgba(110,5,10,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 6, y - 1);
    g.lineTo(x + 6, y + 1);
    g.stroke();
    // blood trickle downward (towards lower v = larger canvas y)
    g.strokeStyle = 'rgba(120,8,12,0.55)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x, y);
    let yy = y;
    for (let k = 0; k < 6; k++) {
      yy += 5 + Math.random() * 5;
      g.lineTo(x + (Math.random() - 0.5) * 4, yy);
    }
    g.stroke();
    this.texture.needsUpdate = true;
  }
}

/**
 * Cheap subsurface scattering for skin: wrap lighting that lets reddish
 * light bleed past the terminator, as light does through real skin.
 */
function applySubsurface(mat, tint = [0.95, 0.3, 0.16], wrap = 0.55) {
  const line = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  const chunk = ShaderChunk.lights_physical_pars_fragment;
  if (!chunk.includes(line)) return;   // three.js changed; skip gracefully
  const patched = chunk.replace(line, `
    float sssRaw = dot( geometryNormal, directLight.direction );
    float sssWrap = saturate( ( sssRaw + ${wrap.toFixed(2)} ) / ${(1 + wrap).toFixed(2)} );
    vec3 sssIrr = directLight.color * max( sssWrap - saturate( sssRaw ), 0.0 ) * vec3( ${tint.map((v) => v.toFixed(2)).join(', ')} );
    reflectedLight.directDiffuse += ( irradiance + sssIrr ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', patched);
  };
  mat.customProgramCacheKey = () => 'skin-sss';
}

export { Builder, loftVertical, blendY, BONES, BI, TORSO, lerpTable, torsoSection, sstep, gauss, window1, applySubsurface, FACE, smoothSeams };
