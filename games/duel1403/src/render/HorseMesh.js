import {
  Group, Mesh, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, MeshPhysicalMaterial, CylinderGeometry,
  SphereGeometry, ConeGeometry, TorusGeometry, BoxGeometry, Vector3, Quaternion, DoubleSide, Color, CatmullRomCurve3, TubeGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heraldryTexture, fabricTexture } from './textures.js';
import { HERALDRY } from '../data/opponents.js';
import { HORSE } from '../data/joust.js';

const _v = new Vector3(), _q = new Quaternion();

/**
 * Sweep along +Z through elliptical sections, Catmull-Rom smoothed:
 * rings = [[z, cy, rx, ryTop, ryBottom], ...]. Optional y-cut keeps only
 * the part above `minY` (for the caparison's open hem).
 */
function sweepZ(rings, { seg = 28, sub = 4, uvWrap = true, minAngle = -Math.PI, maxAngle = Math.PI, flare = null, folds = null } = {}) {
  const cr = (k) => {   // Catmull-Rom on each column
    const out = [];
    for (let i = 0; i < rings.length - 1; i++) {
      const p0 = rings[Math.max(0, i - 1)], p1 = rings[i], p2 = rings[i + 1], p3 = rings[Math.min(rings.length - 1, i + 2)];
      for (let s = 0; s < sub; s++) {
        const t = s / sub, t2 = t * t, t3 = t2 * t;
        out.push(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
      }
    }
    out.push(rings[rings.length - 1][k]);
    return out;
  };
  const Z = cr(0), CY = cr(1), RX = cr(2), RT = cr(3), RB = cr(4);
  const pos = [], uv = [], idx = [];
  const n = Z.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= seg; j++) {
      const a = minAngle + (maxAngle - minAngle) * (j / seg);
      const s = Math.sin(a), c = Math.cos(a);
      // a = 0 is the top (+Y); positive a turns towards +X (the left flank)
      const y = CY[i] + (c >= 0 ? RT[i] : RB[i]) * c;
      let x = RX[i] * s;
      if (flare) x *= 1 + flare(c, i / (n - 1));
      let yy = y, zz = Z[i];
      if (folds) { const f = folds(a, c, i / (n - 1)); x *= 1 + f.r; yy += f.y; zz += f.z ?? 0; }
      pos.push(x, yy, zz);
      uv.push(uvWrap ? 0.5 - (a - Math.PI / 2) / (2 * Math.PI) : j / seg, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(points, radii, seg = 14, flatten = 1) {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
  const g = new TubeGeometry(curve, Math.max(8, points.length * 6), 1, seg, false);
  // scale each ring by its radius
  const P = g.attributes.position, N = curve.getSpacedPoints(Math.max(8, points.length * 6));
  const rings = Math.max(8, points.length * 6) + 1;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const r = radii(t);
    const c = N[i];
    for (let j = 0; j <= seg; j++) {
      const k = i * (seg + 1) + j;
      _v.fromBufferAttribute(P, k).sub(c);
      _v.x *= r * flatten; _v.y *= r; _v.z *= r;
      P.setXYZ(k, c.x + _v.x, c.y + _v.y, c.z + _v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// Body sections: z, centre y, half width, top, bottom (metres, barrel frame).
const BODY = [
  [-0.98, 0.16, 0.05, 0.05, 0.05],
  [-0.9, 0.18, 0.2, 0.24, 0.22],
  [-0.72, 0.16, 0.3, 0.33, 0.36],
  [-0.48, 0.1, 0.32, 0.36, 0.38],
  [-0.18, 0.07, 0.33, 0.37, 0.4],
  [0.15, 0.1, 0.33, 0.37, 0.39],
  [0.42, 0.14, 0.3, 0.37, 0.36],
  [0.66, 0.12, 0.27, 0.32, 0.3],
  [0.82, 0.14, 0.2, 0.22, 0.2],
  [0.9, 0.2, 0.08, 0.1, 0.08],
];

/**
 * A courser of about 15 hands in its jousting harness: coat, mane and tail,
 * a cloth caparison painted with the rider's arms, a steel chanfron, the
 * saddle (the high Hohenzeug or the war saddle), stirrups and reins. The legs
 * run through the gait cycle of the simulated horse.
 */
export class HorseMesh {
  constructor(horse, rider, { quality = 'high' } = {}) {
    this.horse = horse;
    this.rider = rider;
    this.group = new Group();
    this.group.name = 'horse' + horse.id;
    const coat = horse.coat;
    const her = HERALDRY[rider.heraldry] ?? HERALDRY.none;
    const seg = quality === 'low' ? 18 : 30;
    const coatMat = new MeshPhysicalMaterial({ color: coat.coat, roughness: 0.55, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new Color(coat.coat).offsetHSL(0, -0.1, 0.2) });
    const darkMat = new MeshStandardMaterial({ color: coat.mane, roughness: 0.8 });
    const pointsMat = new MeshStandardMaterial({ color: coat.points, roughness: 0.7 });
    const hoofMat = new MeshStandardMaterial({ color: '#2a2420', roughness: 0.6 });
    const steel = new MeshPhysicalMaterial({ color: '#c8ccd2', metalness: 1, roughness: 0.28, clearcoat: 0.2 });
    const leather = new MeshStandardMaterial({ color: '#4a2c18', roughness: 0.7 });
    const wood = new MeshStandardMaterial({ color: rider.colors.accent ?? '#7a5a3a', roughness: 0.6 });
    const tex = heraldryTexture(her, rider.colors.cloth ?? '#7a1c1c').clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, 1);
    const capMat = new MeshPhysicalMaterial({ map: tex, roughness: 0.85, sheen: 0.5, sheenRoughness: 0.6, side: DoubleSide });
    capMat.userData.cloth = true;
    this.root = new Group();   // follows the barrel; stirrups and reins live in world space
    this.body = new Group();
    this.root.add(this.body);
    this.group.add(this.root);

    // ---- coat --------------------------------------------------------------------------
    const barrel = new Mesh(sweepZ(BODY, { seg }), coatMat);
    const neck = new Mesh(tube([[0, 0.2, 0.62], [0, 0.38, 0.82], [0, 0.55, 1.0], [0, 0.66, 1.14]], (t) => 0.24 - 0.13 * t, 16, 0.62), coatMat);
    const headG = tube([[0, 0.7, 1.12], [0, 0.6, 1.3], [0, 0.42, 1.46], [0, 0.3, 1.54]], (t) => 0.1 - 0.04 * t + 0.02 * Math.sin(t * Math.PI), 14, 0.75);
    const head = new Mesh(headG, coatMat);
    const muzzle = new Mesh(new SphereGeometry(0.075, 12, 8).scale(0.85, 0.8, 1.1).translate(0, 0.27, 1.56), pointsMat);
    const ears = new Mesh(mergeGeometries([0.045, -0.045].map((x) => new ConeGeometry(0.03, 0.12, 8).rotateX(-0.3).translate(x, 0.8, 1.1))), coatMat);
    this.body.add(barrel, neck, head, muzzle, ears);
    // mane along the crest, forelock
    this.body.add(new Mesh(tube([[0, 0.42, 0.68], [0, 0.6, 0.86], [0, 0.74, 1.04], [0, 0.78, 1.12]], (t) => 0.05 - 0.02 * t, 8, 0.5), darkMat));
    // tail: from the dock, hanging and streaming with speed
    this.tailRoot = new Group();
    this.tailRoot.position.set(0, 0.26, -0.96);
    this.tail = new Mesh(tube([[0, 0, 0], [0, -0.12, -0.12], [0, -0.42, -0.2], [0, -0.75, -0.18]], (t) => 0.045 + 0.05 * Math.sin(t * 2.6), 10, 0.7), darkMat);
    this.tailRoot.add(this.tail);
    this.body.add(this.tailRoot);

    // ---- legs ----------------------------------------------------------------------------
    // Each leg: upper (forearm / gaskin) and lower (cannon) with the hoof. Pivots in the barrel frame.
    this.legs = [];
    const legDef = [
      { name: 'LF', x: 0.17, y: -0.14, z: 0.52, front: true },
      { name: 'RF', x: -0.17, y: -0.14, z: 0.52, front: true },
      { name: 'LH', x: 0.17, y: -0.06, z: -0.62, front: false },
      { name: 'RH', x: -0.17, y: -0.06, z: -0.62, front: false },
    ];
    const ground = HORSE.barrelY;
    for (const d of legDef) {
      const reach = ground + d.y;            // pivot height above the ground
      const L1 = d.front ? 0.44 : 0.5, L3 = 0.13, L2 = reach - L1 - L3;
      const hip = new Group();
      hip.position.set(d.x, d.y, d.z);
      const upper = new Mesh(tube([[0, 0.12, 0], [0, -L1 * 0.5, d.front ? 0.02 : -0.04], [0, -L1, 0]], (t) => (d.front ? 0.12 : 0.15) - 0.06 * t, 12, 0.8), coatMat);
      hip.add(upper);
      const knee = new Group();
      knee.position.set(0, -L1, 0);
      const lower = new Mesh(tube([[0, 0.02, 0], [0, -L2 * 0.5, 0], [0, -L2, 0]], (t) => 0.058 - 0.01 * t + 0.012 * Math.exp(-((t - 0.05) ** 2) / 0.004), 10, 0.85), coat.points === coat.coat ? coatMat : pointsMat);
      knee.add(lower);
      const fet = new Group();
      fet.position.set(0, -L2, 0);
      fet.add(new Mesh(new CylinderGeometry(0.045, 0.06, L3, 12).translate(0, -L3 / 2, 0.02), hoofMat));
      fet.add(new Mesh(new SphereGeometry(0.052, 10, 8).translate(0, 0, 0), pointsMat));
      knee.add(fet);
      hip.add(knee);
      this.body.add(hip);
      this.legs.push({ ...d, hip, knee, fet, L1, L2 });
    }

    // ---- caparison: cloth over body and neck, open at the hem ---------------------------
    const capRings = BODY.slice(1, -1).map(([z, cy, rx, rt, rb]) => [z, cy, rx + 0.035, rt + 0.03, rb + 0.25]);
    capRings.unshift([-1.02, 0.14, 0.26, 0.3, 0.56]);
    capRings.push([0.92, 0.18, 0.3, 0.3, 0.62]);
    // The trapper hangs in folds from the horse's back, and its hem rides up
    // between the legs and falls lower at the flanks.
    const capGeo = sweepZ(capRings, {
      seg: seg * 2, sub: 6, minAngle: -Math.PI * 0.86, maxAngle: Math.PI * 0.86,
      flare: (c, t) => (c < -0.2 ? 0.12 * (-c - 0.2) : 0) * (1 + 0.5 * Math.abs(t - 0.5)),
      folds: (a, c, t) => {
        const low = Math.max(0, -c - 0.1);                // folds deepen towards the hem
        const r = low * (0.07 * Math.sin(t * 46 + Math.sin(t * 9) * 2) + 0.03 * Math.sin(t * 97));
        const hem = c < -0.75 ? (0.1 * Math.sin(t * Math.PI * 2 * 3) - 0.08 * Math.cos(t * Math.PI * 2)) * (-c - 0.75) * 4 : 0;
        return { r, y: hem };
      },
    });
    this.caparison = new Mesh(capGeo, capMat);
    this.body.add(this.caparison);
    // the crinet cloth over the neck
    const crin = tube([[0, 0.22, 0.66], [0, 0.42, 0.86], [0, 0.6, 1.04], [0, 0.68, 1.12]], (t) => 0.27 - 0.13 * t, 16, 0.66);
    this.body.add(new Mesh(crin, capMat));
    // ---- chanfron: steel over the face, with a little spike plume holder
    {
      const ch = tube([[0, 0.78, 1.1], [0, 0.66, 1.3], [0, 0.47, 1.46], [0, 0.36, 1.53]], (t) => 0.105 - 0.04 * t, 14, 0.8);
      const m = new Mesh(ch, steel);
      m.scale.set(1.08, 1.03, 1.02);
      m.position.set(0, 0.012, 0.006);
      this.body.add(m);
      this.body.add(new Mesh(mergeGeometries([0.07, -0.07].map((x) => new TorusGeometry(0.035, 0.009, 6, 14).rotateY(Math.PI / 2 + Math.sign(x) * 0.5).translate(x, 0.6, 1.3))), steel));
    }

    // ---- saddle --------------------------------------------------------------------------
    const high = rider.saddle?.seatY > 0.55;
    const sy = BODY[5][1] + BODY[5][3];   // top of the back near the seat
    const seat = new Mesh(new BoxGeometry(0.42, high ? 0.22 : 0.1, 0.62).translate(0, sy + (high ? 0.1 : 0.04), -0.12), leather);
    const cantle = new Mesh(new CylinderGeometry(0.24, 0.26, high ? 0.42 : 0.24, 18, 1, true, -Math.PI * 0.5 - 0.9, 1.8 + Math.PI * 0).rotateY(Math.PI).translate(0, sy + (high ? 0.3 : 0.16), -0.36), wood);
    cantle.material = wood.clone(); cantle.material.side = DoubleSide;
    const pommel = new Mesh(new BoxGeometry(0.38, high ? 0.5 : 0.22, 0.06).translate(0, sy + (high ? 0.3 : 0.14), 0.18), wood);
    this.body.add(seat, cantle, pommel);
    if (high) {
      // the wings of the high saddle that box in the thighs
      for (const sx of [1, -1]) this.body.add(new Mesh(new BoxGeometry(0.04, 0.55, 0.3).rotateZ(sx * 0.35).translate(sx * 0.24, sy + 0.05, 0.12), wood));
    }
    // girth and breast strap
    this.body.add(new Mesh(new TorusGeometry(0.42, 0.018, 6, 28).scale(0.86, 1, 0.3).translate(0, 0.02, 0.12), leather));

    // stirrups and reins: placed each frame from the rider
    this.stirrups = ['L', 'R'].map(() => {
      const g = new Group();
      g.add(new Mesh(new TorusGeometry(0.07, 0.012, 6, 12, Math.PI * 1.2).rotateZ(-Math.PI * 0.1), steel));
      const leatherStrap = new Mesh(new BoxGeometry(0.03, 1, 0.006).translate(0, 0.5, 0), leather);
      g.add(leatherStrap);
      g.userData.strap = leatherStrap;
      this.group.add(g);
      return g;
    });
    this.reins = ['L', 'R'].map(() => {
      const m = new Mesh(new CylinderGeometry(0.006, 0.006, 1, 5).translate(0, 0.5, 0), leather);
      this.group.add(m);
      return m;
    });
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.time = 0;
  }

  /** Leg angles for one leg at gait phase p (0..1): [upper swing, knee flex, fetlock]. */
  _legPose(p, front, gait) {
    // Stance is the fraction of the cycle on the ground: long at the walk, short at the gallop.
    const duty = { halt: 1, walk: 0.62, trot: 0.45, canter: 0.4, gallop: 0.36 }[gait];
    const reach = { halt: 0, walk: 0.32, trot: 0.42, canter: 0.5, gallop: 0.58 }[gait];
    if (gait === 'halt') return [0, 0, 0];
    if (p < duty) {
      const t = p / duty;                       // planted: sweeps back
      const a = reach * (1 - 2 * t);
      return [a, front ? 0.05 : -0.05 - 0.15 * Math.sin(t * Math.PI), -0.25 * t];
    }
    const t = (p - duty) / (1 - duty);          // swing: folds and reaches forward
    const a = reach * (-1 + 2 * (t * t * (3 - 2 * t)));
    const fold = Math.sin(t * Math.PI) * (front ? 1.5 : 1.1) * (0.6 + reach);
    return [a + (front ? 0.15 : -0.1) * Math.sin(t * Math.PI), front ? fold : -fold * 0.8, front ? -fold * 0.5 : fold * 0.6];
  }

  update(dt) {
    this.time += dt;
    const h = this.horse, b = h.body;
    this.root.position.copy(b.pos);
    this.root.quaternion.copy(b.q);
    this.root.updateMatrixWorld(true);
    const gait = h.gait;
    // Footfall offsets: the walk is four-beat, the trot diagonal, the canter and gallop led by the left fore.
    const off = {
      halt: { LF: 0, RF: 0, LH: 0, RH: 0 },
      walk: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 },
      trot: { LF: 0, RH: 0, RF: 0.5, LH: 0.5 },
      canter: { RH: 0, LH: 0.3, RF: 0.3, LF: 0.6 },
      gallop: { RH: 0, LH: 0.12, RF: 0.42, LF: 0.54 },
    }[gait];
    for (const L of this.legs) {
      const [a, k, f] = this._legPose((h.phase + off[L.name]) % 1, L.front, gait);
      L.hip.rotation.x = -a;
      L.knee.rotation.x = L.front ? k : k;
      L.fet.rotation.x = f;
    }
    // the tail streams back with speed, swishes at rest
    this.tailRoot.rotation.x = -Math.min(1.1, h.speed * 0.12) - 0.1 * Math.sin(this.time * 2.2);
    this.tailRoot.rotation.z = 0.12 * Math.sin(this.time * 1.3);
    // stirrups under the rider's feet (or hanging free), reins from the bit to the bridle hand
    const r = this.rider;
    ['L', 'R'].forEach((s, i) => {
      const st = this.stirrups[i];
      const sx = s === 'L' ? 1 : -1;
      const hang = this.root.localToWorld(new Vector3(sx * 0.3, 0.42 - 0.95, -0.1));
      const foot = r.seated ? r.b['foot' + s].pos : hang;
      const top = this.root.localToWorld(new Vector3(sx * 0.24, 0.5, -0.08));
      st.position.copy(foot).add(_v.set(0, -0.06, 0));
      st.quaternion.copy(b.q);
      const strap = st.userData.strap;
      const len = top.distanceTo(st.position);
      strap.scale.set(1, len, 1);
      _v.subVectors(top, st.position).normalize().applyQuaternion(_q.copy(b.q).invert());
      strap.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), _v);
      const bit = this.root.localToWorld(new Vector3(sx * 0.07, 0.32, 1.48));
      const hand = r.seated ? r.b.forearmL.localToWorld(r.ragdoll.bones.armL.lowerEnd.clone(), new Vector3()) : this.root.localToWorld(new Vector3(sx * 0.1, 0.5, 0.75));
      const rein = this.reins[i];
      rein.position.copy(bit);
      _v.subVectors(hand, bit);
      rein.scale.set(1, _v.length(), 1);
      rein.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), _v.normalize());
    });
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) m.dispose();
    });
    this.group.removeFromParent();
  }
}
