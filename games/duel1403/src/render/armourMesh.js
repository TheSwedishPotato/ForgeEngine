import {
  BufferGeometry, Float32BufferAttribute, Mesh, Group, MeshPhysicalMaterial, MeshStandardMaterial, Vector2, Vector3,
  SkinnedMesh, Matrix4, DoubleSide, Color, CylinderGeometry, SphereGeometry, BoxGeometry, Object3D, TubeGeometry, CatmullRomCurve3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder, loftVertical, blendY, BI, TORSO, lerpTable, sstep } from './bodyMesh.js';
import { steelNormal, mailNormal, quiltNormal, clothNormal, leatherNormal, fabricTexture, heraldryTexture } from './textures.js';
import { HERALDRY } from '../data/opponents.js';

/**
 * Armour, piece by piece, generated from the same anatomy the physics uses.
 * Rigid plates are meshes parented to the bone of the body they are strapped
 * to (so they move exactly with it); flexible defences — mail, quilted
 * linen, cloth covers — are skinned lofts across neighbouring bones.
 */

// ---- geometry helpers --------------------------------------------------------

/**
 * Sweeps an elliptical (front/back asymmetric) cross-section along Y.
 * ring(y) => { cx, cz, rx, rf, rb, n? } ; th0..th1 is the arc swept
 * (0 = front, +PI/2 = +X side).
 */
function sweep({ y0, y1, ny = 16, nth = 32, th0 = -Math.PI, th1 = Math.PI, ring, closeTop = false }) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= ny; i++) {
    const t = i / ny;
    const y = y0 + (y1 - y0) * t;
    const R = ring(y, t);
    for (let j = 0; j <= nth; j++) {
      const th = th0 + ((th1 - th0) * j) / nth;
      const s = Math.sin(th), c = Math.cos(th);
      const n = R.n ?? 2;
      const ex = 2 / n;
      const x = R.rx * Math.sign(s) * Math.pow(Math.abs(s), ex);
      const z = (c >= 0 ? R.rf : R.rb) * Math.sign(c) * Math.pow(Math.abs(c), ex);
      pos.push(R.cx + x, R.y ?? y, R.cz + z);
      uv.push(j / nth, t);
    }
  }
  const W = nth + 1;
  for (let i = 0; i < ny; i++) for (let j = 0; j < nth; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  if (closeTop) {
    const top = pos.length / 3;
    const R = ring(y1, 1);
    pos.push(R.cx, R.y ?? y1, R.cz);
    uv.push(0.5, 1);
    for (let j = 0; j < nth; j++) idx.push(ny * W + j, ny * W + j + 1, top);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Generic parametric surface: fn(u, v, out) with u,v in [0,1]. */
function param(fn, nu, nv) {
  const pos = [], uv = [], idx = [];
  const p = new Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      fn(i / nu, j / nv, p);
      pos.push(p.x, p.y, p.z);
      uv.push(i / nu, j / nv);
    }
  }
  const W = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function legProfile(y) {
  // Leg radii (lateral, front, back) for a 1.80 m man, by height above ground.
  const prof = [
    [0.1, 0.04, 0.04, 0.04], [0.16, 0.046, 0.043, 0.049], [0.24, 0.052, 0.049, 0.06], [0.32, 0.059, 0.052, 0.07],
    [0.38, 0.061, 0.053, 0.07], [0.45, 0.058, 0.058, 0.06], [0.505, 0.056, 0.059, 0.054], [0.56, 0.062, 0.067, 0.062],
    [0.65, 0.073, 0.079, 0.074], [0.75, 0.082, 0.089, 0.083], [0.86, 0.089, 0.094, 0.092], [0.97, 0.094, 0.098, 0.1],
  ];
  if (y <= prof[0][0]) return prof[0].slice(1);
  for (let i = 1; i < prof.length; i++) {
    if (y <= prof[i][0]) {
      const a = prof[i - 1], b = prof[i];
      const t = (y - a[0]) / (b[0] - a[0]);
      return [1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * t);
    }
  }
  return prof[prof.length - 1].slice(1);
}

function armProfile(d) {
  // Arm radii by distance below the shoulder joint.
  const prof = [
    [0.0, 0.064, 0.062, 0.062], [0.05, 0.064, 0.06, 0.06], [0.1, 0.057, 0.056, 0.057], [0.15, 0.051, 0.058, 0.055],
    [0.2, 0.049, 0.058, 0.052], [0.25, 0.045, 0.05, 0.048], [0.3, 0.04, 0.041, 0.043], [0.34, 0.046, 0.047, 0.045],
    [0.4, 0.045, 0.044, 0.04], [0.46, 0.039, 0.036, 0.034], [0.52, 0.033, 0.03, 0.029], [0.57, 0.03, 0.027, 0.027],
  ];
  if (d <= 0) return prof[0].slice(1);
  for (let i = 1; i < prof.length; i++) {
    if (d <= prof[i][0]) {
      const a = prof[i - 1], b = prof[i];
      const t = (d - a[0]) / (b[0] - a[0]);
      return [1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * t);
    }
  }
  return prof[prof.length - 1].slice(1);
}

// ---- materials ---------------------------------------------------------------------

function steelMat(tint = '#c3c7cc', rough = 0.26) {
  const m = new MeshPhysicalMaterial({
    color: tint, metalness: 1, roughness: rough, normalMap: steelNormal(), normalScale: new Vector2(0.12, 0.12),
    clearcoat: 0.25, clearcoatRoughness: 0.35,
  });
  m.normalMap.repeat?.set(2, 2);
  return m;
}

function mailMat(rep = [10, 8]) {
  const nm = mailNormal().clone();
  nm.needsUpdate = true;
  nm.repeat.set(rep[0], rep[1]);
  return new MeshStandardMaterial({ color: '#8f9499', metalness: 1, roughness: 0.42, normalMap: nm, normalScale: new Vector2(1.1, 1.1), side: DoubleSide });
}

function padMat(color = '#d6ccb0', spacing = 18, rep = [6, 3]) {
  const nm = quiltNormal(spacing).clone();
  nm.needsUpdate = true;
  nm.repeat.set(rep[0], rep[1]);
  const map = fabricTexture(color).clone();
  map.needsUpdate = true;
  map.repeat.set(rep[0], rep[1]);
  return new MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.95, normalMap: nm, normalScale: new Vector2(0.9, 0.9), side: DoubleSide });
}

function clothMat(color, opts = {}) {
  const map = fabricTexture(color, opts).clone();
  map.needsUpdate = true;
  map.repeat.set(opts.rep ?? 3, opts.rep ?? 3);
  const nm = clothNormal().clone();
  nm.needsUpdate = true;
  nm.repeat.set(6, 6);
  return new MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.86, normalMap: nm, normalScale: new Vector2(0.5, 0.5), side: DoubleSide });
}

function leatherMat(color = '#4a3020') {
  return new MeshStandardMaterial({ color, roughness: 0.6, normalMap: leatherNormal(), normalScale: new Vector2(0.4, 0.4) });
}

const darkMat = new MeshStandardMaterial({ color: '#050505', roughness: 1 });
const brassMat = new MeshPhysicalMaterial({ color: '#b88a3c', metalness: 1, roughness: 0.32 });

// ---- the builder ------------------------------------------------------------------------

export class ArmourMesh {
  /**
   * body: BodyMesh (bones, skeleton, J, s); knight: the fighter (profile, colours).
   */
  constructor(body, knight, { quality = 'high' } = {}) {
    this.body = body;
    this.knight = knight;
    this.s = body.s;
    this.J = body.J;
    this.items = knight.profile.items;
    this.group = body.group;
    this.rag = knight.ragdoll;
    this.segs = quality === 'low' ? 18 : 30;
    const tint = knight.colors.steel ?? '#c3c7cc';
    this.steel = steelMat(tint, knight.colors.steelRough ?? 0.26);
    this.visor = null;
    this.visorOpen = 0;
    this.hidden = [];
    this.meshes = [];

    // Layer stack (metres beyond the body surface) for the torso, arms, legs.
    const it = this.items;
    const under = { shirt: 0.006, armingDoublet: 0.011, gambeson: 0.022 }[it.under] ?? 0.006;
    const mail = it.mail === 'noMail' ? 0 : 0.008;
    const plate = { coatOfPlates: 0.014, brigandine: 0.012, breastplate: 0.026 }[it.plate] ?? 0;
    this.stack = { under, mail: under + mail, plate: under + mail + plate };
    body.inflate.torso = under;

    this._head(it.head);
    this._neck(it.neck);
    this._torso();
    this._arms(it.arms);
    this._hands(it.hands);
    this._legs(it.legs);
    this._feet(it.feet);
    for (const m of this.meshes) { m.castShadow = true; m.receiveShadow = true; }
  }

  // --- utilities ---
  bone(name) {
    return this.body.bones[BI[name]];
  }

  rest(name) {
    return this.rag.bodies[name].userData.restPos;
  }

  /** Adds a rigid piece built in rest-pose world coordinates to a bone. */
  rigid(boneName, geo, mat) {
    const r = this.rest(boneName);
    geo.translate(-r.x, -r.y, -r.z);
    const m = new Mesh(geo, mat);
    this.bone(boneName).add(m);
    this.meshes.push(m);
    return m;
  }

  skinned(builder, mat) {
    const m = new SkinnedMesh(builder.build(), mat);
    m.frustumCulled = false;
    m.bind(this.body.skeleton, new Matrix4());
    this.group.add(m);
    this.meshes.push(m);
    return m;
  }

  headCenter() {
    return this.body._headCenter();
  }

  // ---- head ------------------------------------------------------------------------
  _head(id) {
    const s = this.s;
    const C = this.headCenter();
    const hairOff = () => { /* helmets cover the hair */ };
    void hairOff;
    switch (id) {
      case 'hood': return this._hood(C);
      case 'armingCap': return this._cap(C, 0.112, 0.02);
      case 'mailCoif': this._cap(C, 0.112, 0.0); return this._coif(C);
      case 'kettleHat': this._cap(C, 0.112, 0.01); return this._kettle(C);
      case 'openBascinet': this._bascinet(C, { visor: null, aventail: true }); return;
      case 'klappvisier': this._bascinet(C, { visor: 'klapp', aventail: true }); return;
      case 'hounskull': this._bascinet(C, { visor: 'hounskull', aventail: true }); return;
      case 'greatBascinet': this._bascinet(C, { visor: 'round', aventail: false, great: true }); return;
      case 'greatHelm': this._coif(C); this._greatHelm(C); return;
      default: void s;
    }
  }

  _cap(C, R, extra) {
    const s = this.s;
    const g = param((u, v, p) => {
      const th = -Math.PI + u * 2 * Math.PI;
      const phi = v * Math.PI * 0.58;
      const r = (R + extra) * s;
      const front = Math.cos(th);
      const drop = front > 0.55 ? 0.62 : 1;
      p.set(C.x + Math.sin(th) * Math.sin(phi * drop) * r * 0.84, C.y + 0.012 * s + Math.cos(phi * drop) * r * 1.02, C.z - 0.006 * s + front * Math.sin(phi * drop) * r);
    }, this.segs, 10);
    this.rigid('head', g, padMat('#e2d9c2', 10, [4, 2]));
  }

  _hood(C) {
    const s = this.s;
    const B = new Builder();
    const rings = [];
    // The hood (kápě, Gugel): close round the head, open at the face, then a
    // cape that follows the slope of the shoulders and hangs to mid-chest.
    const top = 0.13, bottom = -0.46, n = 34;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const dy = top + (bottom - top) * t;           // metres from the head centre (unscaled)
      const y = C.y + dy * s;
      let hw, f, b;
      if (dy > -0.11) {
        const head = Math.sqrt(Math.max(0, 1 - (dy / 0.135) ** 2)) * 0.112;
        hw = f = b = Math.max(head, 0.078) + 0.008;
        f *= 1.05; b *= 1.1;
      } else if (dy > -0.19) {
        const u = (-0.11 - dy) / 0.08;                // the neck: gathered
        hw = 0.086 + 0.03 * u; f = 0.088 + 0.02 * u; b = 0.094 + 0.02 * u;
      } else if (dy > -0.28) {
        const u = sstep(0, 1, (-0.19 - dy) / 0.09);   // over the shoulders
        hw = 0.116 + 0.13 * u; f = 0.108 + 0.04 * u; b = 0.114 + 0.045 * u;
      } else {
        const u = (-0.28 - dy) / 0.18;                // hanging
        hw = 0.246 + 0.008 * u; f = 0.148 + 0.006 * u; b = 0.159 + 0.006 * u;
      }
      const w = dy > -0.1 ? [[BI.head, 1]] : blendY(y, C.y - 0.2 * s, C.y - 0.1 * s, BI.chest, BI.head);
      rings.push({ y, cx: 0, cz: (dy < -0.19 ? -0.012 : -0.01) * s, hw: hw * s, f: f * s, b: b * s, n: 2, weights: w });
    }
    this._partialLoft(B, rings, (y) => (y > C.y - 0.105 * s && y < C.y + 0.085 * s ? 0.85 : 0));
    const mat = clothMat(this.knight.colors.accent ?? '#5a4e40');
    mat.side = DoubleSide;
    this.skinned(B, mat);
    // the liripipe: the hood's long tail, hanging down the back
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new Vector3(C.x, C.y + (0.07 - 0.38 * t) * s, C.z - (0.1 + 0.075 * Math.sin(t * 1.6)) * s)); }
    const tube = new TubeGeometry(new CatmullRomCurve3(pts), 16, 0.022 * s, 8, false);
    // taper toward the end
    const P = tube.attributes.position, curve = new CatmullRomCurve3(pts);
    for (let i = 0; i < P.count; i++) {
      const ring = Math.floor(i / 9), t = ring / 16, c = curve.getPointAt(Math.min(1, t));
      const k = 1.3 - 0.7 * t;
      P.setXYZ(i, c.x + (P.getX(i) - c.x) * k, c.y + (P.getY(i) - c.y) * k, c.z + (P.getZ(i) - c.z) * k);
    }
    tube.computeVertexNormals();
    this.rigid('head', tube, mat);
  }

  /** Loft that leaves a gap of half-angle gap(y) at the front (the face opening). */
  _partialLoft(B, rings, gap) {
    const segs = this.segs;
    const start = B.count;
    for (const R of rings) {
      const g = gap(R.y);
      for (let j = 0; j <= segs; j++) {
        const th = g + ((2 * Math.PI - 2 * g) * j) / segs;     // from +gap round the back to -gap
        const sn = Math.sin(th), c = Math.cos(th);
        const x = R.hw * sn, z = (c >= 0 ? R.f : R.b) * c;
        B.vertex(R.cx + x, R.y, R.cz + z, j / segs, 0, R.weights);
      }
    }
    B.grid(start, rings.length - 1, segs, true);
  }

  _coif(C) {
    const s = this.s;
    const B = new Builder();
    const rings = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const y = C.y + (0.14 - 0.34 * t) * s;
      const dy = (y - C.y) / (0.145 * s);
      const headR = Math.sqrt(Math.max(0, 1 - Math.min(1, dy * dy))) * 0.118 * s;
      const r = t < 0.5 ? Math.max(headR, 0.082 * s) : (0.085 + 0.12 * sstep(0.62, 1, t)) * s;
      const w = y > C.y - 0.1 * s ? [[BI.head, 1]] : blendY(y, C.y - 0.2 * s, C.y - 0.1 * s, BI.chest, BI.head);
      rings.push({ y, cx: 0, cz: -0.006 * s, hw: r, f: r * 1.04, b: r * 1.06, n: 2, weights: w });
    }
    this._partialLoft(B, rings, (y) => (y > C.y - 0.085 * s && y < C.y + 0.07 * s ? 0.7 : 0));
    this.skinned(B, mailMat([8, 4]));
  }

  _kettle(C) {
    const s = this.s;
    // Dome.
    const dome = param((u, v, p) => {
      const th = -Math.PI + u * 2 * Math.PI;
      const phi = v * Math.PI * 0.5;
      const r = 0.122 * s;
      p.set(C.x + Math.sin(th) * Math.sin(phi) * r * 0.92, C.y + 0.035 * s + Math.cos(phi) * r * 1.12, C.z - 0.004 * s + Math.cos(th) * Math.sin(phi) * r);
    }, this.segs, 12);
    // Brim drawn down at the front into brow ridges either side of the nasal.
    const brim = param((u, v, p) => {
      const th = -Math.PI + u * 2 * Math.PI;
      const r = (0.12 + 0.1 * v) * s;
      const front = Math.max(0, Math.cos(th));
      const ridge = front * (0.6 + 0.4 * Math.abs(Math.sin(th * 2.2)));
      const drop = (0.03 + 0.05 * ridge) * v * s;
      p.set(C.x + Math.sin(th) * r * 0.94, C.y + 0.035 * s - drop - 0.012 * v * s, C.z - 0.004 * s + Math.cos(th) * r);
    }, this.segs * 2, 4);
    const g = mergeGeometries([dome, brim]);
    this.rigid('head', g, this.steel).material.side = DoubleSide;
    // Short nasal.
    const nasal = new BoxGeometry(0.012 * s, 0.06 * s, 0.006 * s);
    nasal.rotateX(-0.25);
    nasal.translate(C.x, C.y + 0.0 * s, C.z + 0.142 * s);
    this.rigid('head', nasal, this.steel);
  }

  _bascinet(C, { visor, aventail, great = false }) {
    const s = this.s;
    // Skull: rises to a point behind the crown and comes down to the nape;
    // open at the face from the brow.
    const apex = new Vector3(C.x, C.y + 0.19 * s, C.z - 0.035 * s);
    const skull = param((u, v, p) => {
      const th = -Math.PI + u * 2 * Math.PI;
      const front = Math.cos(th);
      const rimY = great
        ? C.y - (0.13 + 0.02 * (1 - Math.abs(front))) * s
        : C.y - (front > 0 ? 0.02 + 0.06 * (1 - sstep(0.35, 0.95, front)) : 0.08 + 0.04 * -front) * s;
      const browY = C.y + 0.045 * s;
      const yRim = (!great && front > 0.55) ? browY + (rimY - browY) * sstep(0.95, 0.55, front) : rimY;
      const y = apex.y + (yRim - apex.y) * v;
      const h = (apex.y - y) / (apex.y - (C.y - 0.02 * s));
      const prof = Math.sin(Math.min(1, h) * Math.PI / 2) ** 0.85;
      const rx = 0.112 * s * prof, rz = (front > 0 ? 0.13 : 0.125) * s * prof;
      const cz = apex.z + (C.z - 0.008 * s - apex.z) * Math.min(1, h);
      p.set(C.x + Math.sin(th) * rx, y, cz + front * rz);
    }, this.segs * 2, 18);
    const sk = this.rigid('head', skull, this.steel);
    sk.material.side = DoubleSide;
    // Vervelles band / lining edge
    if (aventail) {
      const band = sweep({ y0: C.y - 0.085 * s, y1: C.y - 0.07 * s, ny: 1, nth: this.segs * 2, th0: 0.95, th1: 2 * Math.PI - 0.95, ring: () => ({ cx: C.x, cz: C.z - 0.008 * s, rx: 0.114 * s, rf: 0.132 * s, rb: 0.127 * s }) });
      this.rigid('head', band, leatherMat('#2a1a10'));
      // Mail aventail from the helmet rim down over the shoulders.
      const B = new Builder();
      const rings = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const y = C.y + (-0.075 - 0.22 * t) * s;
        const r0 = 0.112 * s;
        const r = r0 + (0.06 + 0.07 * sstep(0.45, 1, t)) * s * t;
        const w = y > C.y - 0.12 * s ? [[BI.head, 1]] : blendY(y, C.y - 0.24 * s, C.y - 0.12 * s, BI.chest, BI.head);
        rings.push({ y, cx: 0, cz: -0.008 * s, hw: r * (t < 0.3 ? 1 : 1 + 0.25 * t), f: r * 1.05, b: r * 1.05, n: 2, weights: w });
      }
      // The aventail covers the throat and chin: full ring.
      loftVertical(B, rings.slice().reverse().map((R) => R).reverse(), this.segs * 2, [0, 0, 1, 1]);
      this.skinned(B, mailMat([12, 3]));
    }
    if (great) {
      // Plate gorget resting on the shoulders.
      const gor = sweep({
        y0: C.y - 0.3 * s, y1: C.y - 0.13 * s, ny: 8, nth: this.segs * 2,
        ring: (y, t) => {
          const r = (0.2 - 0.09 * sstep(0, 1, t)) * s;
          return { cx: C.x, cz: C.z - 0.01 * s, rx: r * 1.2, rf: r * 1.05, rb: r };
        },
      });
      this.rigid('chest', gor, this.steel).material.side = DoubleSide;
    }
    if (!visor) return;
    // Visor on a pivot (brow hinge for the Klappvisier, temple pivots otherwise).
    const pivot = new Object3D();
    const headRest = this.rest('head');
    if (visor === 'klapp') pivot.position.set(C.x - headRest.x, C.y + 0.09 * s - headRest.y, C.z + 0.115 * s - headRest.z);
    else pivot.position.set(C.x - headRest.x, C.y + 0.03 * s - headRest.y, C.z - 0.0 * s - headRest.z);
    this.bone('head').add(pivot);
    const snout = visor === 'hounskull' ? 0.13 : visor === 'klapp' ? 0.035 : 0.02;
    const vis = param((u, v, p) => {
      const th = -1.7 + u * 3.4;                    // across the face
      const y = C.y + (0.065 - (great ? 0.2 : 0.185) * v) * s;
      const dy = (y - (C.y - 0.035 * s)) / (0.11 * s);
      const bell = Math.exp(-dy * dy * 1.6);
      const front = Math.cos(th);
      const r = 0.138 * s + snout * s * Math.pow(Math.max(0, front), 3.5) * bell;
      const rx = 0.122 * s * (1 - 0.08 * v);
      p.set(C.x + Math.sin(th) * rx, y, C.z - 0.01 * s + front * r);
    }, this.segs, 14);
    vis.translate(-C.x, -C.y, -C.z);
    vis.translate(C.x - headRest.x - pivot.position.x, C.y - headRest.y - pivot.position.y, C.z - headRest.z - pivot.position.z);
    const vm = new Mesh(vis, this.steel);
    vm.material.side = DoubleSide;
    pivot.add(vm);
    this.meshes.push(vm);
    // Sights (eye slits) and breaths: dark inlays proud of the surface.
    const slits = [];
    for (const sx of [1, -1]) {
      const slit = new BoxGeometry(0.06 * s, 0.007 * s, 0.01 * s);
      const zf = visor === 'hounskull' ? 0.175 : 0.146;
      slit.rotateY(sx * 0.42);
      slit.translate(sx * 0.038 * s, 0.002 * s, zf * s);
      slits.push(slit);
    }
    for (let i = 0; i < 6; i++) {
      const hole = new BoxGeometry(0.006 * s, 0.006 * s, 0.01 * s);
      const zf = visor === 'hounskull' ? 0.2 : 0.15;
      hole.translate((i % 2 ? 1 : -1) * (0.014 + 0.012 * Math.floor(i / 2)) * s, -0.07 * s, zf * s - 0.01 * s * Math.floor(i / 2));
      slits.push(hole);
    }
    const sl = mergeGeometries(slits);
    sl.translate(C.x - headRest.x - pivot.position.x, C.y - headRest.y - pivot.position.y, C.z - headRest.z - pivot.position.z);
    const slm = new Mesh(sl, darkMat);
    pivot.add(slm);
    this.visor = { pivot, kind: visor };
  }

  _greatHelm(C) {
    const s = this.s;
    const helm = sweep({
      y0: C.y - 0.15 * s, y1: C.y + 0.14 * s, ny: 10, nth: this.segs * 2, closeTop: true,
      ring: (y, t) => ({ cx: C.x, cz: C.z + 0.008 * s, rx: (0.128 - 0.01 * t) * s, rf: (0.15 - 0.012 * t) * s, rb: (0.135 - 0.01 * t) * s, n: 2.1 }),
    });
    this.rigid('head', helm, this.steel).material.side = DoubleSide;
    const parts = [];
    for (const sx of [1, -1]) {
      const slit = new BoxGeometry(0.075 * s, 0.009 * s, 0.012 * s);
      slit.rotateY(sx * 0.35);
      slit.translate(C.x + sx * 0.045 * s, C.y + 0.01 * s, C.z + 0.152 * s);
      parts.push(slit);
    }
    this.rigid('head', mergeGeometries(parts), darkMat);
    const cross = [new BoxGeometry(0.014 * s, 0.2 * s, 0.006 * s).translate(C.x, C.y - 0.03 * s, C.z + 0.16 * s), new BoxGeometry(0.14 * s, 0.012 * s, 0.006 * s).translate(C.x, C.y + 0.025 * s, C.z + 0.158 * s)];
    this.rigid('head', mergeGeometries(cross), brassMat);
  }

  // ---- neck ---------------------------------------------------------------------------
  _neck(id) {
    if (id !== 'mailStandard') return;
    const s = this.s;
    const B = new Builder();
    const rings = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const y = (1.44 + 0.17 * t) * s;
      const r = (0.105 - 0.03 * sstep(0, 0.6, t)) * s;
      rings.push({ y, cx: 0, cz: -0.012 * s, hw: r * (1 + 0.5 * (1 - t)), f: r, b: r * 1.05, n: 2, weights: blendY(y / s, 1.52, 1.6, BI.chest, BI.head) });
    }
    loftVertical(B, rings, this.segs * 2, [0, 0, 1, 1]);
    this.skinned(B, mailMat([12, 2]));
  }

  // ---- torso ---------------------------------------------------------------------------
  _torsoRings(inflate, yTop, yBottom, { skirt = 0, sleeveless = true } = {}) {
    const s = this.s;
    const rings = [];
    for (let y = yBottom; y <= yTop + 1e-6; y += 0.0125) {
      const yy = Math.max(TORSO[0][0], y);
      const [, hw, f, b, n] = lerpTable(TORSO, Math.min(yy, TORSO[TORSO.length - 1][0]));
      let weights;
      if (y < 0.9) weights = [[BI.pelvis, 1]];
      else if (y < 1.1) weights = blendY(y, 1.03, 1.1, BI.pelvis, BI.abdomen);
      else weights = blendY(y, 1.19, 1.26, BI.abdomen, BI.chest);
      const flare = y < TORSO[0][0] ? skirt * (TORSO[0][0] - y) / (TORSO[0][0] - yBottom + 1e-6) : 0;
      const top = y > 1.47 ? -0.03 * (y - 1.47) / 0.05 : 0;
      rings.push({ y: y * s, cx: 0, cz: -0.004 * s, hw: (hw + inflate + flare + top * 0.5) * s, f: (f + inflate + flare * 0.8) * s, b: (b + inflate + flare * 0.8) * s, n, weights });
    }
    void sleeveless;
    return rings;
  }

  _sleeve(B, side, inflate, dEnd) {
    const s = this.s, J = this.J;
    const sx = side === 'L' ? 1 : -1;
    const sh = new Vector3(sx * J.shoulderX, J.shoulderY, 0);
    const armX = sx * (J.shoulderX + 0.02 * s);
    const el = new Vector3(armX, J.elbowY, 0);
    const wr = new Vector3(armX, J.wristY, 0);
    const ua = BI['upperArm' + side], fa = BI['forearm' + side];
    const rings = [];
    const L1 = J.shoulderY - J.elbowY;
    for (let d = -0.02; d <= dEnd + 1e-6; d += 0.0125) {
      const [rx, f, bk] = armProfile(Math.max(0, d));
      const y = sh.y - d * s;
      const c = y > el.y ? new Vector3().lerpVectors(sh, el, (sh.y - y) / L1) : new Vector3().lerpVectors(el, wr, (el.y - y) / (el.y - wr.y));
      const weights = d < 0.04 ? blendY(-y, -(sh.y + 0.01 * s), -(sh.y - 0.06 * s), BI.chest, ua) : blendY(-y, -(el.y + 0.035 * s), -(el.y - 0.03 * s), ua, fa);
      rings.push({ y, cx: c.x, cz: c.z, hw: (rx + inflate) * s, f: (f + inflate) * s, b: (bk + inflate) * s, n: 2, weights });
    }
    rings.reverse();
    loftVertical(B, rings, this.segs, [0, 0, 1, 1]);
  }

  _torso() {
    const it = this.items, s = this.s, st = this.stack;
    const kc = this.knight.colors;
    // Padding layer (visible on its own or under mail).
    if (it.under === 'gambeson') {
      const B = new Builder();
      loftVertical(B, this._torsoRings(st.under, 1.49, 0.66, { skirt: 0.05 }), this.segs * 2, [0, 0, 1, 1]);
      for (const side of ['L', 'R']) this._sleeve(B, side, st.under, 0.6);
      this.skinned(B, padMat(kc.padding ?? '#d6ccb0', 14, [10, 6]));
    }
    // Mail.
    if (it.mail === 'haubergeon' || it.mail === 'hauberk') {
      const B = new Builder();
      loftVertical(B, this._torsoRings(st.mail, 1.47, 0.7, { skirt: 0.06 }), this.segs * 2, [0, 0, 1, 1]);
      for (const side of ['L', 'R']) this._sleeve(B, side, st.mail, it.mail === 'hauberk' ? 0.58 : 0.33);
      this.skinned(B, mailMat([14, 7]));
    }
    // Plate.
    if (it.plate === 'coatOfPlates' || it.plate === 'brigandine') {
      const B = new Builder();
      const bottom = it.plate === 'brigandine' ? 0.86 : 0.95;
      loftVertical(B, this._torsoRings(st.plate, 1.46, bottom, { skirt: 0.03 }), this.segs * 2, [0, 0, 1, 1]);
      const col = it.plate === 'brigandine' ? (kc.velvet ?? '#5a1420') : (kc.velvet ?? '#3a2a1a');
      const m = clothMat(col, { rivets: true, rep: 4 });
      m.roughness = 0.7;
      this.skinned(B, m);
    }
    if (it.plate === 'breastplate') this._breastplate();
    // Jupon over all.
    if (it.cover === 'jupon') {
      const B = new Builder();
      const inf = st.plate + (it.plate === 'breastplate' ? 0.012 : 0.006);
      loftVertical(B, this._torsoRings(inf, 1.48, 0.74, { skirt: 0.06 }), this.segs * 2, [0, 0, 1, 1]);
      const her = HERALDRY[this.knight.heraldry] ?? null;
      const map = heraldryTexture(her && her.field ? her : null, kc.cloth ?? '#7a1c1c');
      const m = new MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.85, normalMap: clothNormal(), normalScale: new Vector2(0.4, 0.4), side: DoubleSide });
      this.skinned(B, m);
    }
  }

  _breastplate() {
    const s = this.s, st = this.stack;
    const off = st.plate;
    const globose = (y) => 0.028 * Math.exp(-(((y - 1.27) / 0.12) ** 2));
    const ring = (front) => (y) => {
      const [, hw, f, b] = lerpTable(TORSO, y / s);
      return { cx: 0, cz: -0.004 * s, rx: (hw + off) * s, rf: (f + off + (front ? globose(y / s) : 0)) * s, rb: (b + off) * s, n: 2.2 };
    };
    // Breast: neck opening and arm openings cut by the swept arc and height.
    const breast = sweep({ y0: 1.1 * s, y1: 1.45 * s, ny: 18, nth: 28, th0: -1.25, th1: 1.25, ring: ring(true) });
    this.rigid('chest', breast, this.steel).material.side = DoubleSide;
    const back = sweep({ y0: 1.1 * s, y1: 1.44 * s, ny: 14, nth: 24, th0: 1.95, th1: 2 * Math.PI - 1.95, ring: ring(false) });
    this.rigid('chest', back, this.steel);
    // Plackart / lower plates on the belly, then fauld lames over the hips.
    const plack = sweep({ y0: 1.0 * s, y1: 1.12 * s, ny: 6, nth: 36, ring: (y) => { const r = ring(true)(y); r.rx += 0.004 * s; r.rf += 0.004 * s; r.rb += 0.004 * s; return r; } });
    this.rigid('abdomen', plack, this.steel).material.side = DoubleSide;
    for (let i = 0; i < 4; i++) {
      const y1 = 1.0 - i * 0.045, y0 = y1 - 0.05;
      const lame = sweep({
        y0: y0 * s, y1: y1 * s, ny: 2, nth: 36,
        ring: (y) => {
          const [, hw, f, b] = lerpTable(TORSO, Math.max(0.85, y / s));
          const e = off + 0.012 + i * 0.008;
          return { cx: 0, cz: -0.004 * s, rx: (hw + e) * s, rf: (f + e) * s, rb: (b + e) * s, n: 2.2 };
        },
      });
      this.rigid('pelvis', lame, this.steel).material.side = DoubleSide;
    }
  }

  // ---- arms -------------------------------------------------------------------------------
  _arms(id) {
    if (id === 'bareArms') return;
    const s = this.s, J = this.J;
    const base = this.stack.mail + 0.006;
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const sh = new Vector3(sx * J.shoulderX, J.shoulderY, 0);
      const armX = sx * (J.shoulderX + 0.02 * s);
      const ringUpper = (inf) => (y) => {
        const d = (J.shoulderY - y) / s;
        const [rx, f, bk] = armProfile(d);
        const t = (sh.y - y) / (J.shoulderY - J.elbowY);
        return { cx: sh.x + (armX - sh.x) * t, cz: 0, rx: (rx + inf) * s, rf: (f + inf) * s, rb: (bk + inf) * s };
      };
      const ringLower = (inf) => (y) => {
        const d = (J.shoulderY - y) / s;
        const [rx, f, bk] = armProfile(d);
        return { cx: armX, cz: 0, rx: (rx + inf) * s, rf: (f + inf) * s, rb: (bk + inf) * s };
      };
      if (id === 'plateArms') {
        // Rerebrace (open at the inside of the arm).
        const reb = sweep({ y0: J.elbowY + 0.03 * s, y1: J.shoulderY - 0.07 * s, ny: 10, nth: 22, th0: sx > 0 ? -0.95 : 2.2, th1: sx > 0 ? 4.08 : 7.23, ring: ringUpper(base + 0.012) });
        this.rigid('upperArm' + side, reb, this.steel).material.side = DoubleSide;
        // Spaulder: three lames over the shoulder.
        for (let i = 0; i < 3; i++) {
          const R = (0.072 + 0.01 * i) * s + base * s;
          const cap = new SphereGeometry(R, 20, 10, 0, Math.PI * 2, 0, Math.PI * (0.32 + 0.08 * i));
          cap.scale(1, 0.9, 1.05);
          cap.rotateZ(-sx * (0.45 + 0.25 * i));
          cap.translate(sh.x + sx * 0.01 * s, sh.y - (0.005 + 0.03 * i) * s, 0);
          this.rigid('upperArm' + side, cap, this.steel).material.side = DoubleSide;
        }
        // Couter with a side wing.
        const cup = new SphereGeometry((0.052 + base) * s, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
        cup.rotateX(-Math.PI / 2);
        cup.scale(1, 1.15, 1);
        cup.translate(armX, J.elbowY, -0.02 * s);
        this.rigid('forearm' + side, cup, this.steel).material.side = DoubleSide;
        const wing = new CylinderGeometry(0.045 * s, 0.045 * s, 0.003 * s, 20);
        wing.rotateZ(Math.PI / 2);
        wing.translate(armX + sx * 0.055 * s, J.elbowY, 0.0);
        this.rigid('forearm' + side, wing, this.steel);
        // Vambrace: a closed tube.
        const vam = sweep({ y0: J.wristY + 0.01 * s, y1: J.elbowY - 0.035 * s, ny: 10, nth: 24, ring: ringLower(base + 0.01) });
        this.rigid('forearm' + side, vam, this.steel).material.side = DoubleSide;
      } else if (id === 'splints') {
        const leather = leatherMat('#5a3a22');
        const sleeveU = sweep({ y0: J.elbowY + 0.03 * s, y1: J.shoulderY - 0.06 * s, ny: 6, nth: 18, ring: ringUpper(base + 0.006) });
        this.rigid('upperArm' + side, sleeveU, leather).material.side = DoubleSide;
        const sleeveL = sweep({ y0: J.wristY + 0.02 * s, y1: J.elbowY - 0.04 * s, ny: 6, nth: 18, ring: ringLower(base + 0.006) });
        this.rigid('forearm' + side, sleeveL, leather).material.side = DoubleSide;
        const bars = [];
        for (let i = 0; i < 5; i++) {
          const th = (sx > 0 ? -1.6 : -0.9) + i * 0.6;
          for (const [y0, y1, rf] of [[J.elbowY + 0.04 * s, J.shoulderY - 0.07 * s, ringUpper(base + 0.011)], [J.wristY + 0.03 * s, J.elbowY - 0.05 * s, ringLower(base + 0.011)]]) {
            const ym = (y0 + y1) / 2;
            const R = rf(ym);
            const bar = new BoxGeometry(0.014 * s, y1 - y0, 0.003 * s);
            bar.rotateY(th);
            bar.translate(R.cx + Math.sin(th) * R.rx, ym, R.cz + Math.cos(th) * (Math.cos(th) > 0 ? R.rf : R.rb));
            bars.push({ geo: bar, upper: y0 > J.elbowY });
          }
        }
        this.rigid('upperArm' + side, mergeGeometries(bars.filter((b) => b.upper).map((b) => b.geo)), this.steel);
        this.rigid('forearm' + side, mergeGeometries(bars.filter((b) => !b.upper).map((b) => b.geo)), this.steel);
        const cup = new SphereGeometry((0.05 + base) * s, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
        cup.rotateX(-Math.PI / 2);
        cup.translate(armX, J.elbowY, -0.02 * s);
        this.rigid('forearm' + side, cup, this.steel).material.side = DoubleSide;
      }
    }
  }

  // ---- hands -----------------------------------------------------------------------------
  _hands(id) {
    if (id === 'bareHands') return;
    const s = this.s, J = this.J;
    const glove = id === 'gloves' ? leatherMat('#6a4528') : id === 'mailMittens' ? mailMat([3, 3]) : leatherMat('#2e1e14');
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const fore = this.rag.bodies['forearm' + side];
      const hand = fore.shapes.find((sh) => sh.userData.part === 'hand');
      const C = fore.userData.restPos.clone().add(hand.offset);
      const fist = new SphereGeometry(1, 18, 14);
      fist.scale(0.041 * s, 0.058 * s, 0.05 * s);
      fist.translate(C.x, C.y + 0.004 * s, C.z + 0.002 * s);
      this.rigid('forearm' + side, fist, glove);
      if (id === 'gauntlets') {
        const armX = sx * (J.shoulderX + 0.02 * s);
        // Hourglass: flared cuff up the wrist, narrowing at the wrist, then the plate over the back of the hand.
        const g = sweep({
          y0: C.y - 0.01 * s, y1: J.wristY + 0.085 * s, ny: 10, nth: 24,
          ring: (y, t) => {
            const narrow = 1 - 0.28 * Math.exp(-(((y - J.wristY) / (0.025 * s)) ** 2));
            const r = (0.05 + 0.028 * sstep(0.45, 1, t)) * s * narrow;
            const cx = t < 0.4 ? C.x : armX;
            return { cx: cx + (armX - C.x) * Math.min(1, t * 1.5), cz: 0.004 * s, rx: r * 0.92, rf: r, rb: r * 1.02 };
          },
        });
        this.rigid('forearm' + side, g, this.steel).material.side = DoubleSide;
        const knuckles = [];
        for (let i = 0; i < 4; i++) {
          const k = new BoxGeometry(0.075 * s, 0.012 * s, 0.03 * s);
          k.translate(C.x + sx * 0.012 * s, C.y - (0.03 + 0.014 * i) * s, C.z + 0.035 * s);
          knuckles.push(k);
        }
        this.rigid('forearm' + side, mergeGeometries(knuckles), this.steel);
      }
    }
  }

  // ---- legs -------------------------------------------------------------------------------
  _legs(id) {
    const s = this.s, J = this.J;
    if (id === 'hose') return;
    const base = 0.004;
    const legRing = (side, inf) => (y) => {
      const sx = side === 'L' ? 1 : -1;
      const [rx, f, b] = legProfile(y / s);
      return { cx: sx * J.hipX * (1 - 0.1 * (1 - y / s / 0.97)), cz: (y / s < 0.5 ? -0.004 : 0) * s, rx: (rx + inf) * s, rf: (f + inf) * s, rb: (b + inf) * s };
    };
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      if (id === 'mailChausses') {
        const B = new Builder();
        const rings = [];
        for (let y = 0.07; y <= 0.95 + 1e-6; y += 0.0125) {
          const R = legRing(side, base + 0.008)(y * s);
          rings.push({ y: y * s, cx: R.cx, cz: R.cz, hw: R.rx, f: R.rf, b: R.rb, n: 2, weights: y < 0.12 ? blendY(y, 0.08, 0.12, BI['foot' + side], BI['shin' + side]) : blendY(y, 0.47, 0.55, BI['shin' + side], BI['thigh' + side]) });
        }
        loftVertical(B, rings, this.segs, [0, 0, 1, 1]);
        this.skinned(B, mailMat([5, 14]));
        continue;
      }
      if (id === 'gamboised') {
        const th = sweep({ y0: J.kneeY + 0.05 * s, y1: J.hipY - 0.03 * s, ny: 10, nth: 24, ring: legRing(side, base + 0.016) });
        this.rigid('thigh' + side, th, padMat(this.knight.colors.padding ?? '#cfc3a2', 12, [4, 3])).material.side = DoubleSide;
      }
      if (id === 'plateLegs') {
        // Cuisse over the front of the thigh.
        const cu = sweep({ y0: J.kneeY + 0.04 * s, y1: J.hipY - 0.02 * s, ny: 12, nth: 22, th0: -1.75, th1: 1.75, ring: legRing(side, base + 0.014) });
        this.rigid('thigh' + side, cu, this.steel).material.side = DoubleSide;
        // Closed greave.
        const gr = sweep({ y0: J.ankleY + 0.035 * s, y1: J.kneeY - 0.045 * s, ny: 14, nth: 26, ring: legRing(side, base + 0.012) });
        this.rigid('shin' + side, gr, this.steel).material.side = DoubleSide;
      }
      if (id === 'plateLegs' || id === 'gamboised') {
        // Poleyn with a side wing.
        const R = legRing(side, base + 0.02)(J.kneeY);
        const cup = new SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
        cup.rotateX(Math.PI / 2);
        cup.scale(R.rx * 1.05, 0.075 * s, R.rf * 0.9);
        cup.translate(R.cx, J.kneeY + 0.005 * s, R.cz + 0.012 * s);
        this.rigid('shin' + side, cup, this.steel).material.side = DoubleSide;
        const wing = new SphereGeometry(0.04 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.3);
        wing.rotateZ(-sx * Math.PI / 2);
        wing.translate(R.cx + sx * R.rx * 0.95, J.kneeY, R.cz + 0.01 * s);
        this.rigid('shin' + side, wing, this.steel).material.side = DoubleSide;
      }
    }
  }

  // ---- feet ----------------------------------------------------------------------------------
  _feet(id) {
    if (id !== 'sabatons') return;
    const s = this.s;
    for (const side of ['L', 'R']) {
      const fb = this.rag.bodies['foot' + side];
      const fc = fb.userData.restPos;
      const geos = [];
      for (let i = 0; i < 6; i++) {
        const z0 = -0.03 + i * 0.035;
        const lame = param((u, v, p) => {
          const th = -1.4 + u * 2.8;
          const z = fc.z + (z0 + v * 0.04) * s;
          const taper = 1 - 0.5 * sstep(0.05, 0.2, (z - fc.z) / s);
          const r = (0.056 + 0.004 * i * 0) * s * taper;
          p.set(fc.x + Math.sin(th) * r, fc.y - 0.012 * s + Math.cos(th) * r * 0.9 * (1 - 0.3 * sstep(0.05, 0.2, (z - fc.z) / s)), z);
        }, 12, 2);
        geos.push(lame);
      }
      // Pointed toe.
      const toe = new CylinderGeometry(0.0, 0.03 * s, 0.07 * s, 10);
      toe.rotateX(Math.PI / 2);
      toe.translate(fc.x, fc.y - 0.02 * s, fc.z + 0.2 * s);
      geos.push(toe);
      this.rigid('foot' + side, mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g)), this.steel).material.side = DoubleSide;
    }
  }

  /** Raises (0) or lowers (1) the visor, smoothly. */
  update(dt) {
    if (!this.visor) return;
    const target = this.knight.visorDown ? 0 : 1;
    this.visorOpen += (target - this.visorOpen) * Math.min(1, dt * 8);
    const a = this.visorOpen;
    if (this.visor.kind === 'klapp') this.visor.pivot.rotation.x = -1.9 * a;
    else this.visor.pivot.rotation.x = -1.45 * a;
  }
}

export { Color };
