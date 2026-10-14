/**
 * Out along the county road east of town: Old Man Peabody's farm (his white frame house,
 * the weathered barn with its gambrel roof, the fields in November stubble, the fence and
 * the mailbox, a scarecrow, the two young pines either side of his lane), and, from 1979,
 * the Twin Pines Mall in its place: the long low mall with the department store at its end,
 * five hundred metres of parking lot under sodium lights, the pylon sign at the gate with
 * its two pines (or one), and Doc's van in the lot.
 */
import { Vector3, Group, Mesh, BoxGeometry, Color, Matrix4 } from 'three';
import { Builder } from '../car/geom.js';
import { rng } from '../car/textures.js';
import { LOT, MALL, PINES, FARM } from './map.js';
import { lotLight, pine, signMaterial } from './props.js';

const V = (x, y, z) => new Vector3(x, y, z);

/** A gabled box: footprint w x d centred at (x, z), rotated rot, walls h, ridge along x. */
function gabled(b, wallMat, roofMat, x, z, w, d, h, rh, rot = 0, gambrel = false) {
  b.transform(new Matrix4().makeRotationY(rot).setPosition(x, 0, z));
  b.box(wallMat, [-w / 2, 0, -d / 2], [w / 2, h, d / 2]);
  const e = 0.4;
  if (!gambrel) {
    b.quad(roofMat, V(-w / 2 - e, h, d / 2 + e), V(w / 2 + e, h, d / 2 + e), V(w / 2 + e, h + rh, 0), V(-w / 2 - e, h + rh, 0));
    b.quad(roofMat, V(w / 2 + e, h, -d / 2 - e), V(-w / 2 - e, h, -d / 2 - e), V(-w / 2 - e, h + rh, 0), V(w / 2 + e, h + rh, 0));
    b.tri(wallMat, V(w / 2, h, d / 2), V(w / 2, h, -d / 2), V(w / 2, h + rh, 0));
    b.tri(wallMat, V(-w / 2, h, -d / 2), V(-w / 2, h, d / 2), V(-w / 2, h + rh, 0));
  } else {
    // the barn's gambrel: a steep lower pitch and a shallow upper one
    const k = [[d / 2 + e, h], [d / 2 * 0.62, h + rh * 0.62], [0, h + rh]];
    for (const s of [1, -1]) {
      for (let i = 0; i < 2; i++) {
        const [z0, y0] = k[i], [z1, y1] = k[i + 1];
        if (s > 0) b.quad(roofMat, V(-w / 2 - e, y0, z0), V(w / 2 + e, y0, z0), V(w / 2 + e, y1, z1), V(-w / 2 - e, y1, z1));
        else b.quad(roofMat, V(w / 2 + e, y0, -z0), V(-w / 2 - e, y0, -z0), V(-w / 2 - e, y1, -z1), V(w / 2 + e, y1, -z1));
      }
    }
    for (const sx of [1, -1]) {
      const pts = [V(sx * w / 2, h, d / 2), V(sx * w / 2, h + rh * 0.62, d / 2 * 0.62), V(sx * w / 2, h + rh, 0), V(sx * w / 2, h + rh * 0.62, -d / 2 * 0.62), V(sx * w / 2, h, -d / 2)];
      for (let i = 1; i + 1 < pts.length; i++) { if (sx > 0) b.tri(wallMat, pts[0], pts[i + 1], pts[i]); else b.tri(wallMat, pts[0], pts[i], pts[i + 1]); }
    }
  }
  b.transform(null);
}

export function buildFarm(M, state) {
  const b = new Builder(), g = new Group();
  const colliders = [], lights = [];
  const H = FARM.house, B = FARM.barn;
  // the house: two storeys of white clapboard, a porch along the front, a shingle roof
  gabled(b, 'clap0', 'shingle', H.x, H.z, H.w, H.d, H.h, 3.2, H.rot);
  b.transform(new Matrix4().makeRotationY(H.rot).setPosition(H.x, 0, H.z));
  b.box('wood', [-H.w / 2, 0, H.d / 2], [H.w / 2, 0.5, H.d / 2 + 2.4]);
  b.box('shingle', [-H.w / 2 - 0.2, 3.0, H.d / 2], [H.w / 2 + 0.2, 3.15, H.d / 2 + 2.6]);
  for (let k = 0; k < 5; k++) { const x = -H.w / 2 + 0.3 + k * (H.w - 0.6) / 4; b.box('trimWhite', [x - 0.08, 0.5, H.d / 2 + 2.3], [x + 0.08, 3.0, H.d / 2 + 2.46]); }
  for (const x of [-3.5, 3.5]) for (const y of [1.2, 4.6]) b.box('windowDark', [x - 0.6, y, H.d / 2 - 0.02], [x + 0.6, y + 1.6, H.d / 2 + 0.04]);
  b.box('doorWood', [-0.6, 0.5, H.d / 2 - 0.02], [0.6, 2.7, H.d / 2 + 0.05]);
  b.box('brickChimney', [H.w / 2 - 1.6, H.h, -0.5], [H.w / 2 - 0.8, H.h + 4.2, 0.5]);
  b.transform(null);
  colliders.push({ type: 'box', x: H.x, z: H.z + 1.2, hw: H.w / 2, hd: H.d / 2 + 1.2, rot: H.rot });
  // the barn: weathered boards, a gambrel roof, big doors facing the lane
  gabled(b, 'barnWood', 'roofTin', B.x, B.z, B.w, B.d, B.h * 0.55, B.h * 0.45, B.rot, true);
  b.transform(new Matrix4().makeRotationY(B.rot).setPosition(B.x, 0, B.z));
  b.box('wood', [-B.w / 2 - 0.02, 0, -2.5], [-B.w / 2 + 0.03, 4.5, 2.5]);
  b.box('trimWhite', [-B.w / 2 - 0.04, 4.5, -2.6], [-B.w / 2 + 0.04, 4.7, 2.6]);
  b.transform(null);
  colliders.push({ type: 'box', x: B.x, z: B.z, hw: B.w / 2, hd: B.d / 2, rot: B.rot, hard: true, name: 'barn' });
  // a silo by the barn
  b.cylinder('concreteBase', V(B.x + 4, 0, B.z - 11), V(B.x + 4, 13, B.z - 11), 2.6, 2.6, { segs: 18 });
  b.lathe('roofTin', V(B.x + 4, 13, B.z - 11), V(0, 1, 0), [[2.7, 0], [1.6, 1.4], [0.2, 2.2], [0, 2.3]], { segs: 18 });
  colliders.push({ type: 'circle', x: B.x + 4, z: B.z - 11, r: 2.7, hard: true });
  // the fence along the county road, the lane through it, the mailbox
  for (let x = 1082; x < 1580; x += 3) {
    if (Math.abs(x - 1094) < 22) continue;
    b.box('wood', [x - 0.06, 0, 59.5], [x + 0.06, 1.3, 59.7]);
    b.box('wood', [x - 1.5, 0.75, 59.55], [x + 1.5, 0.87, 59.65]);
    b.box('wood', [x - 1.5, 1.15, 59.55], [x + 1.5, 1.27, 59.65]);
  }
  b.box('wood', [1078.95, 0, 52], [1079.05, 1.1, 52.1]);
  b.box('ironBlack', [1078.8, 1.1, 51.8], [1079.2, 1.35, 52.4]);
  // a scarecrow in the field
  const S = FARM.scarecrow;
  const sc = new Builder();
  sc.box('wood', [-0.05, 0, -0.05], [0.05, 2.2, 0.05]);
  sc.box('wood', [-0.05, 1.7, -0.85], [0.05, 1.8, 0.85]);
  sc.box('burlap', [-0.2, 1.2, -0.3], [0.2, 1.95, 0.3]);
  sc.box('burlap', [-0.12, 1.25, -0.8], [0.12, 1.75, -0.3]);
  sc.box('burlap', [-0.12, 1.25, 0.3], [0.12, 1.75, 0.8]);
  sc.lathe('straw', V(0, 2.15, 0), V(0, 1, 0), [[0.0, 0.25], [0.45, 0.25], [0.2, 0.32], [0.18, 0.5], [0.0, 0.55]], { segs: 10 });
  const scg = sc.build(M); scg.position.set(S.x, 0, S.z);
  g.add(scg);
  colliders.push({ type: 'circle', x: S.x, z: S.z, r: 0.45, name: 'scarecrow', soft: true, object: scg });
  g.add(b.build(M));
  // the farm's sign on the barn
  const sm = signMaterial('PEABODY', { bg: '#efe6cf', fg: '#5c1a10', font: 'bold 130px Georgia, serif' });
  const sign = new Mesh(new BoxGeometry(5, 1.1, 0.06), sm);
  sign.position.set(B.x - B.w / 2 - 0.08, 6.0, B.z); sign.rotation.y = -Math.PI / 2;
  g.add(sign);
  // a lamp in the farmhouse window before dawn
  lights.push({ pos: V(H.x - 3.5, 2.0, H.z + H.d / 2 + 1), color: new Color(1, 0.7, 0.4), power: 0.004, range: 10 });
  void state;
  return { group: g, colliders, lights };
}

export function buildMall(M, state) {
  const b = new Builder(), g = new Group();
  const colliders = [], lights = [];
  // the mall: a long low block, its entrances lit, the department store at its east end
  b.box('stucco1', [MALL.x0, 0, MALL.z0], [MALL.x1 - 90, 8.5, MALL.z1]);
  b.box('stucco2', [MALL.x1 - 90, 0, MALL.z0 - 10], [MALL.x1, 12, MALL.z1 + 4]);
  b.box('trimWhite', [MALL.x0 - 0.5, 8.2, MALL.z1 - 0.2], [MALL.x1 - 90, 8.8, MALL.z1 + 0.6]);
  for (const x of [1190, 1270, 1350]) {
    b.box('windowLit', [x - 6, 0, MALL.z1 + 0.02], [x + 6, 4.2, MALL.z1 + 0.1]);
    b.box('trimWhite', [x - 7, 4.2, MALL.z1], [x + 7, 5.4, MALL.z1 + 3]);
    lights.push({ pos: V(x, 3.8, MALL.z1 + 2.5), color: new Color(0.85, 0.95, 1.0), power: 0.02, range: 16 });
  }
  b.box('windowLit', [MALL.x1 - 60, 0, MALL.z1 + 4.02], [MALL.x1 - 30, 5, MALL.z1 + 4.1]);
  colliders.push({ type: 'box', x: (MALL.x0 + MALL.x1) / 2, z: (MALL.z0 + MALL.z1) / 2 + 2, hw: (MALL.x1 - MALL.x0) / 2, hd: (MALL.z1 - MALL.z0) / 2 + 4, rot: 0, hard: true });
  // the lot's lights, on a 50 m grid
  for (let x = LOT.x0 + 40; x < LOT.x1; x += 50) for (let z = LOT.z0 + 40; z < LOT.z1; z += 50) {
    lights.push(...lotLight(b, x, z));
    colliders.push({ type: 'circle', x, z, r: 0.5, hard: true });
  }
  // the pylon sign at the gate
  const pyX = 1096, pyZ = 72;
  b.box('steelPole', [pyX - 0.25, 0, pyZ - 0.25], [pyX + 0.25, 7, pyZ + 0.25]);
  b.box('steelPole', [pyX + 5.75, 0, pyZ - 0.25], [pyX + 6.25, 7, pyZ + 0.25]);
  colliders.push({ type: 'circle', x: pyX, z: pyZ, r: 0.4, hard: true }, { type: 'circle', x: pyX + 6, z: pyZ, r: 0.4, hard: true });
  g.add(b.build(M));
  const name = state.mall ?? 'Twin Pines';
  const sm = signMaterial(`${name.toUpperCase()} MALL`, { bg: '#f3efe2', fg: '#1d4b2a', font: 'bold 120px Georgia, serif', border: '#1d4b2a' }, { glow: 0.9 });
  const sign = new Mesh(new BoxGeometry(8, 2.2, 0.4), sm);
  sign.position.set(pyX + 3, 7.6, pyZ);
  g.add(sign);
  lights.push({ pos: V(pyX + 3, 6, pyZ + 2), color: new Color(1, 0.95, 0.85), power: 0.01, range: 10 });
  const ds = signMaterial('HILL VALLEY DEPT. STORE', { bg: '#1a1a1a', fg: '#f1f1f1', font: 'bold 92px Arial, sans-serif' }, { glow: 1.4 });
  const dsign = new Mesh(new BoxGeometry(26, 2.6, 0.2), ds);
  dsign.position.set(MALL.x1 - 45, 9.5, MALL.z1 + 4.2);
  g.add(dsign);
  // Doc's van, parked where he set up the experiment
  const vb = new Builder();
  vb.transform(new Matrix4().makeRotationY(0.6).setPosition(1250, 0, 210));
  vb.box('vanWhite', [-2.6, 0.45, -1.0], [2.6, 2.4, 1.0]);
  vb.box('vanWhite', [2.6, 0.45, -1.0], [3.3, 1.3, 1.0]);
  vb.box('windowDark', [2.55, 1.35, -0.95], [2.62, 2.1, 0.95]);
  for (const [x, z] of [[-1.7, -1.0], [-1.7, 1.0], [2.2, -1.0], [2.2, 1.0]]) vb.cylinder('tireWorld', V(x, 0.38, z - 0.12), V(x, 0.38, z + 0.12), 0.38, 0.38, { segs: 14 });
  vb.transform(null);
  g.add(vb.build(M));
  const van = signMaterial('DR. E. BROWN ENTERPRISES', { bg: '#f2f0ea', fg: '#7a1c18', font: 'bold 64px Arial, sans-serif', sub: '24 HR. SCIENTIFIC SERVICES', subFont: 'bold 40px Arial, sans-serif' });
  const vs = new Mesh(new BoxGeometry(3.6, 0.8, 0.02), van);
  vs.position.set(1250, 1.6, 210).add(V(Math.sin(0.6), 0, Math.cos(0.6)).multiplyScalar(1.02));
  vs.rotation.y = 0.6;
  g.add(vs);
  colliders.push({ type: 'box', x: 1250, z: 210, hw: 3.3, hd: 1.05, rot: 0.6, hard: true });
  return { group: g, colliders, lights };
}

/** The twin pines (as they stand on this date). */
export function buildPines(M, state, year) {
  const b = new Builder();
  const colliders = [];
  PINES.forEach((p, i) => {
    if (!state.pines[i]) {
      if (year >= 1945) b.cylinder('bark', V(p.x, 0, p.z), V(p.x, 0.25, p.z), 0.12, 0.1, { segs: 7 });    // the stump
      return;
    }
    const age = Math.max(0, year - 1945);
    const h = Math.min(18, 1.4 + age * 0.45);
    pine(b, p.x, p.z, h, i + 1);
    colliders.push({ type: 'circle', x: p.x, z: p.z, r: Math.max(0.15, h * 0.03), pine: i, soft: h < 6, hard: h >= 6 });
  });
  const r = rng(5);
  void r;
  return { group: b.build(M), colliders };
}
