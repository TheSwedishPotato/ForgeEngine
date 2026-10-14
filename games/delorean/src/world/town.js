/**
 * Downtown Hill Valley: the courthouse and the storefronts round the square and along Main
 * Street, in the dress of each period.
 *
 * The courthouse: a classical block in cream stone on a plinth, a portico of four columns
 * under a pediment, two storeys of tall windows, and over the entrance the clock tower: a
 * square shaft, the clock stage with a face on each side and the ledge round it (where Doc
 * hung on 12 November 1955), a belfry and a dome. The hands keep the time until the
 * lightning; after it they stand at 10:04. In 1885 it is going up, in scaffolding, the
 * clock not yet hung; in 1985 it is grimy; in 2015, restored.
 *
 * The storefronts: each lot keeps its building from 1905 on (brick or stucco, two or three
 * storeys, shop windows, an awning, a sign), its sign and paint changing with the times;
 * before that, the frontier's wooden false fronts with a boardwalk and a porch roof.
 */
import { Vector3, Group, Mesh, CircleGeometry, BoxGeometry, MeshStandardMaterial, Color, Matrix4 } from 'three';
import { Builder } from '../car/geom.js';
import { plateTexture, rng } from '../car/textures.js';
import { COURTHOUSE, MAIN_Z, MAIN_W, SIDE_STREETS } from './map.js';
import { signMaterial } from './props.js';

const V = (x, y, z) => new Vector3(x, y, z);

// ---------------------------------------------------------------------------------------------
// the courthouse

let _clockFace = null;
function clockFaceTexture() {
  return (_clockFace ??= plateTexture(512, 512, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#efe9da'; g.beginPath(); g.arc(c, c, c - 4, 0, 7); g.fill();
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 10; g.beginPath(); g.arc(c, c, c - 10, 0, 7); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(c, c, c - 70, 0, 7); g.stroke();
    const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.fillStyle = '#1a1a1a'; g.font = 'bold 54px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
      g.save(); g.translate(c + Math.cos(a) * (c - 42), c + Math.sin(a) * (c - 42)); g.rotate(a + Math.PI / 2); g.fillText(R[k], 0, 0); g.restore();
    }
    for (let k = 0; k < 60; k++) { const a = (k / 60) * Math.PI * 2; g.lineWidth = k % 5 ? 2 : 5; g.beginPath(); g.moveTo(c + Math.cos(a) * (c - 70), c + Math.sin(a) * (c - 70)); g.lineTo(c + Math.cos(a) * (c - 82), c + Math.sin(a) * (c - 82)); g.stroke(); }
  }));
}

export function buildCourthouse(M, state) {
  const C = COURTHOUSE, b = new Builder(), g = new Group();
  const lights = [];
  if (state.courthouse === 'none') return { group: g, colliders: [], lights, clock: null };
  const x0 = C.x - C.w / 2, x1 = C.x + C.w / 2, z0 = C.z - C.d / 2, z1 = C.z + C.d / 2;
  const wall = state.era === 'decline' ? 'stoneDirty' : state.era === 'frontier' ? 'stoneNew' : 'stone';
  const building = state.courthouse === 'building';
  // the plinth and the walls
  b.box('stoneDark', [x0 - 0.6, 0, z0 - 0.6], [x1 + 0.6, 1.3, z1 + 0.6]);
  b.box(wall, [x0, 1.3, z0], [x1, building ? 9 : C.h, z1]);
  if (!building) {
    b.box('trimWhite', [x0 - 0.5, C.h - 0.4, z0 - 0.5], [x1 + 0.5, C.h + 0.5, z1 + 0.5]);     // the cornice
    // the hipped roof
    const ry = C.h + 0.5, rh = 3.2;
    b.quad('roof', V(x0 - 0.3, ry, z1 + 0.3), V(x1 + 0.3, ry, z1 + 0.3), V(x1 - 6, ry + rh, C.z + 2), V(x0 + 6, ry + rh, C.z + 2));
    b.quad('roof', V(x1 + 0.3, ry, z0 - 0.3), V(x0 - 0.3, ry, z0 - 0.3), V(x0 + 6, ry + rh, C.z - 2), V(x1 - 6, ry + rh, C.z - 2));
    b.tri('roof', V(x1 + 0.3, ry, z1 + 0.3), V(x1 + 0.3, ry, z0 - 0.3), V(x1 - 6, ry + rh, C.z - 2));
    b.tri('roof', V(x1 + 0.3, ry, z1 + 0.3), V(x1 - 6, ry + rh, C.z - 2), V(x1 - 6, ry + rh, C.z + 2));
    b.tri('roof', V(x0 - 0.3, ry, z0 - 0.3), V(x0 - 0.3, ry, z1 + 0.3), V(x0 + 6, ry + rh, C.z + 2));
    b.tri('roof', V(x0 - 0.3, ry, z0 - 0.3), V(x0 + 6, ry + rh, C.z + 2), V(x0 + 6, ry + rh, C.z - 2));
    b.box('roof', [x0 + 6, ry + rh - 0.01, C.z - 2], [x1 - 6, ry + rh, C.z + 2]);
  }
  // windows: two storeys of tall sashes on the front and sides
  const win = (cx, cy, cz, nx, nz) => {
    const w = 1.6, h = 3.0;
    const ax = Math.abs(nz) > 0.5 ? V(1, 0, 0) : V(0, 0, 1);
    const p = V(cx, cy, cz);
    const o = V(nx, 0, nz).multiplyScalar(0.03);
    const a = p.clone().addScaledVector(ax, -w / 2), c = p.clone().addScaledVector(ax, w / 2);
    // the white frame, the dark glass a little in
    const n = V(nx, 0, nz);
    const quad = (mat, aa, cc, y0, y1, off) => {
      const A = aa.clone().addScaledVector(n, off).setY(y0), B = cc.clone().addScaledVector(n, off).setY(y0), Cc = cc.clone().addScaledVector(n, off).setY(y1), D = aa.clone().addScaledVector(n, off).setY(y1);
      // ax runs to the viewer's right when (ax x up) . n > 0: then A B C D go round anticlockwise
      if ((ax.x * n.z - ax.z * n.x) > 0) b.quad(mat, A, B, Cc, D); else b.quad(mat, B, A, D, Cc);
    };
    quad('trimWhite', a.clone().addScaledVector(ax, -0.18), c.clone().addScaledVector(ax, 0.18), cy - h / 2 - 0.25, cy + h / 2 + 0.35, 0.03);
    quad(state.era === 'decline' ? 'windowDirty' : 'window', a, c, cy - h / 2, cy + h / 2, 0.05);
    void o;
  };
  if (!building) {
    for (let k = 0; k < 14; k++) {
      const x = x0 + 2.4 + k * ((C.w - 4.8) / 13);
      if (Math.abs(x - C.x) < 9.5) continue;
      for (const y of [4.2, 10.4]) { win(x, y, z1, 0, 1); win(x, y, z0, 0, -1); }
    }
    for (let k = 0; k < 6; k++) { const z = z0 + 2.5 + k * ((C.d - 5) / 5); for (const y of [4.2, 10.4]) { win(x1, y, z, 1, 0); win(x0, y, z, -1, 0); } }
  }
  // the portico: steps, four columns, the entablature and the pediment
  const pz1 = z1 + 7;
  for (let k = 0; k < 5; k++) b.box('stoneDark', [C.x - 10, 0, pz1 + 1.5 - k * 0.3 - 0.3], [C.x + 10, 0.26 * (k + 1), pz1 + 6 - k * 1.1]);
  b.box('stoneDark', [C.x - 10, 0, z1], [C.x + 10, 1.3, pz1]);
  if (!building) {
    for (const x of [-6.6, -2.2, 2.2, 6.6]) b.lathe('trimWhite', V(C.x + x, 1.3, pz1 - 1.2), V(0, 1, 0), [[0.85, 0], [0.85, 0.4], [0.62, 0.6], [0.55, 9.6], [0.75, 10.0], [0.75, 10.5]], { segs: 16 });
    b.box('trimWhite', [C.x - 9.5, 11.8, z1], [C.x + 9.5, 13.3, pz1]);
    b.tri('trimWhite', V(C.x - 9.5, 13.3, pz1), V(C.x + 9.5, 13.3, pz1), V(C.x, 16.6, pz1));
    b.quad('roof', V(C.x - 9.8, 13.3, pz1 + 0.3), V(C.x, 16.8, pz1 + 0.3), V(C.x, 16.8, z1), V(C.x - 9.8, 13.3, z1));
    b.quad('roof', V(C.x, 16.8, pz1 + 0.3), V(C.x + 9.8, 13.3, pz1 + 0.3), V(C.x + 9.8, 13.3, z1), V(C.x, 16.8, z1));
    // the doors
    b.box('doorWood', [C.x - 1.6, 1.3, z1 + 0.02], [C.x + 1.6, 5.6, z1 + 0.08]);
  }
  // the tower
  const tz = C.z, tw = 8.6;
  const shaftTop = building ? 18 : 25;
  b.box(wall, [C.x - tw / 2, C.h, tz - tw / 2], [C.x + tw / 2, shaftTop, tz + tw / 2]);
  let clock = null;
  if (!building) {
    // the ledge round the clock stage, with its railing
    b.box('trimWhite', [C.x - tw / 2 - 1.0, 25, tz - tw / 2 - 1.0], [C.x + tw / 2 + 1.0, 25.4, tz + tw / 2 + 1.0]);
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ox = ax * (tw / 2 + 0.9), oz = az * (tw / 2 + 0.9);
      const sx = az !== 0 ? tw / 2 + 0.9 : 0.04, sz = ax !== 0 ? tw / 2 + 0.9 : 0.04;
      b.box('ironBlack', [C.x + ox - sx, 26.3, tz + oz - sz], [C.x + ox + sx, 26.36, tz + oz + sz]);
      for (let k = -6; k <= 6; k++) {
        const px = C.x + ox + (az !== 0 ? k * 0.8 : 0), pz = tz + oz + (ax !== 0 ? k * 0.8 : 0);
        b.box('ironBlack', [px - 0.025, 25.4, pz - 0.025], [px + 0.025, 26.33, pz + 0.025]);
      }
    }
    b.box(wall, [C.x - tw / 2 - 0.3, 25.4, tz - tw / 2 - 0.3], [C.x + tw / 2 + 0.3, 30.6, tz + tw / 2 + 0.3]);
    b.box('trimWhite', [C.x - tw / 2 - 0.6, 30.6, tz - tw / 2 - 0.6], [C.x + tw / 2 + 0.6, 31.1, tz + tw / 2 + 0.6]);
    // the belfry and the dome
    b.box(wall, [C.x - 3.2, 31.1, tz - 3.2], [C.x + 3.2, 33.6, tz + 3.2]);
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.box('windowDark', [C.x + ax * 3.21 - (az ? 1.2 : 0.02), 31.6, tz + az * 3.21 - (ax ? 1.2 : 0.02)], [C.x + ax * 3.21 + (az ? 1.2 : 0.02), 33.2, tz + az * 3.21 + (ax ? 1.2 : 0.02)]);
    b.lathe('roof', V(C.x, 33.6, tz), V(0, 1, 0), [[3.4, 0], [3.3, 0.6], [2.8, 1.6], [1.8, 2.5], [0.6, 3.0], [0.15, 3.2], [0.15, 4.4], [0, 4.6]], { segs: 20 });
    // the clock: a face on each side, hands that keep the time (or stand at 10:04)
    if (state.clock !== 'none') {
      clock = { hands: [] };
      const faceMat = new MeshStandardMaterial({ map: clockFaceTexture(), emissiveMap: clockFaceTexture(), emissive: new Color(0, 0, 0), roughness: 0.6 });
      clock.faceMat = faceMat;
      for (const [ax, az] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const fg = new Group();
        fg.position.set(C.x + ax * (tw / 2 + 0.32), 28.0, tz + az * (tw / 2 + 0.32));
        fg.rotation.y = Math.atan2(ax, az);
        const face = new Mesh(new CircleGeometry(1.95, 48), faceMat);
        fg.add(face);
        const hour = new Group(), minute = new Group();
        const hm = new Mesh(new BoxGeometry(0.16, 1.15, 0.05), M.ironBlack); hm.position.set(0, 0.45, 0.06); hour.add(hm);
        const mm = new Mesh(new BoxGeometry(0.11, 1.7, 0.05), M.ironBlack); mm.position.set(0, 0.7, 0.1); minute.add(mm);
        fg.add(hour, minute);
        g.add(fg);
        clock.hands.push({ hour, minute });
      }
      clock.stopped = state.clock === 'stopped';
    }
  } else {
    // 1885: scaffolding up the unfinished tower
    for (let k = 0; k < 4; k++) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box('wood', [C.x + sx * (tw / 2 + 1) - 0.08, C.h, tz + sz * (tw / 2 + 1) - 0.08], [C.x + sx * (tw / 2 + 1) + 0.08, 22, tz + sz * (tw / 2 + 1) + 0.08]);
    for (const y of [12, 15, 18, 21]) b.box('wood', [C.x - tw / 2 - 1.1, y, tz + tw / 2 + 0.9], [C.x + tw / 2 + 1.1, y + 0.08, tz + tw / 2 + 1.1]);
  }
  // 1985: the "Save the Clock Tower" banner; 2015: the mall's sign
  if (state.era === 'decline') {
    const m = signMaterial('SAVE THE CLOCK TOWER', { bg: '#f1ece0', fg: '#8a1c1c', font: 'bold 96px Arial, sans-serif' });
    const sign = new Mesh(new BoxGeometry(14, 1.6, 0.05), m); sign.position.set(C.x, 9.5, z1 + 0.6); g.add(sign);
  }
  if (state.era === 'future') {
    const m = signMaterial('COURTHOUSE MALL', { bg: '#0b1a2c', fg: '#7fe0ff', font: 'bold 110px Arial, sans-serif' }, { glow: 1.5 });
    const sign = new Mesh(new BoxGeometry(12, 1.4, 0.1), m); sign.position.set(C.x, 14.2, pz1 + 0.2); g.add(sign);
  }
  g.add(b.build(M));
  // the windows lit late into the evening
  lights.push({ pos: V(C.x, 6, pz1 + 3), color: new Color(1, 0.8, 0.55), power: state.era === 'frontier' ? 0 : 0.03, range: 22 });
  const colliders = [{ type: 'box', x: C.x, z: C.z + 3, hw: C.w / 2 + 0.6, hd: C.d / 2 + 4, rot: 0 }];
  return { group: g, colliders, lights, clock };
}

/** Sets the clock's hands (the time of day in hours; stopped clocks stay at 10:04). */
export function setClock(clock, hours) {
  if (!clock) return;
  const h = clock.stopped ? 10 + 4 / 60 : hours;
  const minA = ((h % 1) * 60) / 60 * Math.PI * 2, hourA = ((h % 12) / 12) * Math.PI * 2;
  for (const c of clock.hands) { c.minute.rotation.z = -minA; c.hour.rotation.z = -hourA; }
}

// ---------------------------------------------------------------------------------------------
// the storefronts

const NAMES = {
  classic: ['LOU\'S CAFE', 'HILL VALLEY BANK', 'DRUGS - SODA FOUNTAIN', 'HARDWARE', 'BARBER SHOP', 'RECORDS & RADIO', 'FIVE & DIME', 'SHOES', 'TV REPAIR', 'BAKERY', 'TAILOR', 'JEWELERS', 'FURNITURE', 'BOOKS', 'DINER', 'LUNCHEONETTE', 'STATLER MOTORS', 'HOTEL', 'OFFICE SUPPLY', 'FLORIST', 'CANDY', 'PHOTO STUDIO', 'GROCERY', 'TOYS'],
  decline: ['LOU\'S AEROBIC FITNESS CENTER', 'HILL VALLEY BANK', 'PAWN', 'FOR LEASE', 'VIDEO RENTAL', 'THRIFT STORE', 'LIQUOR', 'DISCOUNT SHOES', 'TV & STEREO', 'DONUTS', 'CLOSED', 'BAIL BONDS', 'FURNITURE OUTLET', 'BOOKS', 'ARCADE', 'COFFEE SHOP', 'STATLER AUTO SALES', 'HOTEL', 'COPY CENTER', 'FLOWERS', 'FOR RENT', 'PHOTO', 'MINI MART', 'GAMES'],
  future: ['CAFE 80\'S', 'HILL VALLEY BANK', 'PHARMACY', 'HOVERBOARDS', 'SALON', 'MUSIC', 'MARKET', 'SHOES', 'HOLOMAX', 'BAKERY', 'TAILOR', 'JEWELERS', 'HOME', 'BOOKS', 'DINER', 'TEA', 'STATLER HOVER CARS', 'HOTEL', 'PRINT SHOP', 'FLOWERS', 'GALLERY', 'PHOTO', 'GROCERY', 'TOYS'],
  frontier: ['PALACE SALOON', 'HILL VALLEY BANK', 'GENERAL STORE', 'HARDWARE', 'BARBER', 'ASSAY OFFICE', 'DRY GOODS', 'BOOTS & SADDLES', 'TELEGRAPH', 'BAKERY', 'TAILOR', 'BLACKSMITH', 'UNDERTAKER', 'HOTEL', 'LIVERY', 'SHERIFF', 'FEED & SEED', 'HOTEL', 'DENTIST', 'LAUNDRY', 'GUNSMITH', 'PHOTOGRAPHY', 'MERCANTILE', 'NEWSPAPER'],
};
const SIGN_STYLE = {
  classic: [{ bg: '#7c1c1c', fg: '#f6ecd2' }, { bg: '#1c2f5a', fg: '#f6ecd2' }, { bg: '#f1e6c8', fg: '#2a2a2a' }, { bg: '#1d4a2c', fg: '#f6ecd2' }],
  decline: [{ bg: '#e9e2d0', fg: '#b2241c' }, { bg: '#20201f', fg: '#f1d24a' }, { bg: '#c9c0a8', fg: '#333' }, { bg: '#2c3d63', fg: '#eee' }],
  future: [{ bg: '#081420', fg: '#68e1ff' }, { bg: '#1c0a24', fg: '#ff7ad9' }, { bg: '#f4f4f2', fg: '#111' }, { bg: '#0c2014', fg: '#7dffa3' }],
  frontier: [{ bg: '#ece0c0', fg: '#2a1a10' }, { bg: '#5b3a22', fg: '#f2e2bc' }, { bg: '#e8dcc0', fg: '#7a1810' }],
};

/** The lots: { x, z, w, d, facing (unit normal of the front: +z south, -z north, ±x) }. */
export function lots() {
  const out = [];
  const r = rng(2024);
  const run = (xa, xb, zFront, dir) => {
    let x = xa;
    while (x < xb - 6) {
      const w = Math.min(xb - x, 7 + Math.floor(r() * 4) * 2.5);
      out.push({ x: x + w / 2, z: zFront - dir * 9, w, d: 18, nx: 0, nz: dir, seed: out.length });
      x += w;
    }
  };
  const north = MAIN_Z - MAIN_W / 2 - 4.5, south = MAIN_Z + MAIN_W / 2 + 4.5;
  // Main Street, both sides, the cross streets left open
  for (const [xa, xb] of [[-400, -306], [-294, -100], [100, 290], [310, 380]]) run(xa, xb, north, 1);
  for (const [xa, xb] of [[-400, -306], [-294, -94], [-78, 78], [94, 290], [310, 380]]) run(xa, xb, south, -1);
  // the side streets round the square, their outer sides
  for (const s of SIDE_STREETS) {
    const dir = s.x > 0 ? -1 : 1;
    let z = -118;
    while (z < -4) {
      const w = 8 + Math.floor(r() * 3) * 2.5;
      out.push({ x: s.x - dir * (6 + 4.5 + 9), z: z + w / 2, w, d: 18, nx: dir, nz: 0, seed: out.length, side: true });
      z += w;
    }
  }
  return out;
}

/** Builds the storefronts for the state's era. */
export function buildStorefronts(M, state, mats) {
  const b = new Builder(), g = new Group();
  const colliders = [], lights = [];
  const era = state.era;
  if (era === 'wild') return { group: g, colliders, lights };
  const L = lots();
  const r0 = rng(77);
  for (const lot of L) {
    const r = rng(lot.seed * 7 + 1);
    // in the settlement years only a few buildings stand
    if (era === 'settlement' && r() > 0.25) continue;
    if (era === 'frontier' && (Math.abs(lot.x) > 300 || r() > 0.7)) continue;
    const frontierish = era === 'frontier' || era === 'settlement';
    const floors = frontierish ? 1 + (r() > 0.6 ? 1 : 0) : 2 + (r() > 0.55 ? 1 : 0);
    const fh = frontierish ? 3.6 : 4.2;
    const H = floors * fh + (frontierish ? 2.2 : 0.8);
    const kind = frontierish ? 'wood' : r() > 0.35 ? 'brick' : 'stucco';
    const tone = Math.floor(r() * 4);
    const wallMat = kind === 'wood' ? `clap${tone % 3}` : kind === 'brick' ? `brick${tone}` : `stucco${tone}`;
    // the lot's frame: u along the street, n out to it
    // (u, up, n) right-handed: u x up = n
    const n = V(lot.nx, 0, lot.nz), u = V(lot.nz, 0, -lot.nx);
    const front = V(lot.x, 0, lot.z).addScaledVector(n, lot.d / 2);
    const m = new Matrix4().makeBasis(u, V(0, 1, 0), n).setPosition(front);
    b.transform(m);
    const hw = lot.w / 2 - 0.05;
    b.box(wallMat, [-hw, 0, -lot.d], [hw, H, 0]);
    if (!frontierish) {
      b.box('trimWhite', [-hw, H - 0.5, 0], [hw, H, 0.35]);                       // the cornice
      // the shop window and the door
      b.box(era === 'decline' && r() < 0.25 ? 'boarded' : 'window', [-hw + 0.6, 0.5, 0.0], [hw - 2.2, 3.2, 0.06]);
      b.box('doorWood', [hw - 1.9, 0, 0.0], [hw - 0.8, 2.6, 0.08]);
      b.box('trimWhite', [-hw + 0.4, 3.2, 0.0], [hw - 0.4, 3.45, 0.12]);
      // the windows upstairs
      const nw = Math.max(1, Math.floor(lot.w / 2.6));
      for (let f = 1; f < floors; f++) for (let k = 0; k < nw; k++) {
        const cx = -hw + (k + 0.5) * (2 * hw / nw), y = f * fh + 0.9;
        b.box('trimWhite', [cx - 0.62, y - 0.12, 0], [cx + 0.62, y + 2.0, 0.05]);
        b.box(era === 'decline' && r() < 0.15 ? 'boarded' : 'windowDark', [cx - 0.5, y, 0.0], [cx + 0.5, y + 1.85, 0.08]);
      }
      // a striped awning (the 1950s), a plain one later
      if (r() < (era === 'classic' ? 0.7 : 0.4)) {
        const am = `awning${Math.floor(r() * 3)}`;
        b.quad(am, V(-hw + 0.3, 3.6, 0.05), V(hw - 0.3, 3.6, 0.05), V(hw - 0.3, 3.0, 1.6), V(-hw + 0.3, 3.0, 1.6));
        b.quad(am, V(-hw + 0.3, 3.0, 1.6), V(hw - 0.3, 3.0, 1.6), V(hw - 0.3, 2.75, 1.6), V(-hw + 0.3, 2.75, 1.6));
      }
    } else {
      // a false front over a boardwalk with a porch roof on posts
      b.box(wallMat, [-hw, H, -0.3], [hw, H + 1.6, 0]);
      b.box('window', [-hw + 0.7, 0.9, 0.0], [hw - 2.4, 2.6, 0.06]);
      b.box('doorWood', [hw - 2.0, 0.3, 0.0], [hw - 0.9, 2.7, 0.08]);
      b.box('wood', [-hw, 0, 0], [hw, 0.3, 2.6]);
      b.box('wood', [-hw, 3.3, 0], [hw, 3.42, 2.8]);
      for (const x of [-hw + 0.15, hw - 0.15]) b.box('wood', [x - 0.08, 0.3, 2.5], [x + 0.08, 3.3, 2.66]);
      if (floors > 1) for (let k = 0; k < 2; k++) { const cx = -hw / 2 + k * hw; b.box('windowDark', [cx - 0.5, 4.6, 0], [cx + 0.5, 6.2, 0.06]); }
    }
    b.transform(null);
    // the sign
    const names = NAMES[frontierish ? 'frontier' : era];
    const name = names[lot.seed % names.length];
    const styles = SIGN_STYLE[frontierish ? 'frontier' : era];
    const st = styles[lot.seed % styles.length];
    const glow = (era === 'future' ? 1.2 : era === 'classic' && r() < 0.4 ? 0.6 : 0);
    const sm = signMaterial(name, { ...st, font: `bold ${name.length > 14 ? 76 : 110}px ${frontierish ? 'Georgia, serif' : 'Arial, sans-serif'}` }, { glow });
    const sw = Math.min(lot.w - 1.2, 9), sh = sw / 4.6;
    const sign = new Mesh(new BoxGeometry(sw, sh, 0.08), sm);
    sign.position.copy(front).addScaledVector(n, 0.25).setY(frontierish ? H + 0.4 : 3.45 + sh / 2 + 0.25);
    sign.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(u, V(0, 1, 0), n));
    g.add(sign);
    // a lit window at night
    if (!frontierish && r() < 0.5) lights.push({ pos: front.clone().addScaledVector(n, 1.5).setY(2.2), color: era === 'future' ? new Color(0.85, 0.9, 1) : new Color(1, 0.78, 0.5), power: 0.006, range: 10, shop: true });
    colliders.push({ type: 'box', x: lot.x, z: lot.z, hw: lot.w / 2, hd: lot.d / 2 + (frontierish ? 2.6 : 0.4), rot: Math.atan2(lot.nx, lot.nz) });
  }
  void r0; void mats;
  g.add(b.build(M));
  return { group: g, colliders, lights };
}
