/**
 * The boat's outside, in boat coordinates (metres: x forward of frame 66 1/2, y above the keel,
 * z to starboard):
 *
 *  - the outer hull, lofted from the same fitted envelope the physics floats (hull.js), so the
 *    waterline you see is the one she trims to;
 *  - the free-flooding superstructure on top of it: the casing's sides with their limber holes
 *    and the teak main deck, from the raked stem to the round of the stern (deck heights from
 *    the General Information Book: 27'-6" at the bow, 22'-11" amidships, 22'-4" aft);
 *  - the conning tower fairwater and bridge, cut down in the late-war fashion, with the
 *    periscope shears, the SJ radar mast and the 20 mm gun platforms (empty now);
 *  - the bow planes (rigged in, folded up against the casing; rigged out, horizontal), the
 *    stern planes and the rudder (turned by the plant), the two four-bladed screws on their
 *    shafts and struts (turning with the shafts);
 *  - the owner's observation deck, an acrylic capsule (acrylic.js draws the glass) in a steel
 *    saddle on the deck where the 4-inch gun stood.
 */
import { Group, Mesh, MeshStandardMaterial, Color, Vector3, CanvasTexture, RepeatWrapping, DoubleSide } from 'three';
import { Builder } from '../../../gotthard-pullman/src/render/geom.js';
import { sectionAt, ENVELOPE } from '../physics/hull.js';
import { deckHeight } from '../physics/dynamics.js';
import { HULL, BOW_PLANES, STERN_PLANES, RUDDER, PROPELLER, CONNING_TOWER, FT, frameX } from '../data/boat.js';
import { OBS_DECK } from '../physics/mass.js';

const V = (x, y, z) => new Vector3(x, y, z);

// ---- paint and plating ------------------------------------------------------------------------

function canvasTex(w, h, draw, { repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = 'srgb';
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}

/** Teak planking: 4" planks, a little weathered to silver. */
function deckTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6e6252'; g.fillRect(0, 0, w, h);
    const n = 16;
    for (let i = 0; i < n; i++) {
      const y = (i / n) * h;
      for (let k = 0; k < 4; k++) {
        const x0 = ((k + (i % 4) * 0.37) % 4) / 4 * w;
        const shade = 92 + ((i * 37 + k * 17) % 24);
        g.fillStyle = `rgb(${shade + 12},${shade + 2},${shade - 14})`;
        g.fillRect(x0, y + 1, w / 4 - 2, h / n - 3);
      }
      g.fillStyle = '#2b2620'; g.fillRect(0, y + h / n - 2, w, 2);       // the caulked seams
    }
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(30,25,20,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 30, 1); }
  });
}

/** The casing's sides: plating with the rows of limber (free-flooding) holes. */
function casingTexture() {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#4a4f55'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,20,22' : '120,120,125'},${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 60, 1 + Math.random() * 3); }
    // a row of rounded slots low on the side, every ~2 ft (the texture is 8 m x 2 m)
    g.fillStyle = '#060707';
    for (let x = 20; x < w; x += 77) {
      g.beginPath(); g.roundRect(x, h * 0.7, 46, 22, 10); g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 6, w, 6);
  });
}

export function makeMaterials() {
  const deckMap = deckTexture();
  const casingMap = casingTexture();
  return {
    hull: new MeshStandardMaterial({ color: new Color('#3a3e43'), roughness: 0.62, metalness: 0.15 }),
    bottom: new MeshStandardMaterial({ color: new Color('#161718'), roughness: 0.7, metalness: 0.1 }),
    casing: new MeshStandardMaterial({ map: casingMap, roughness: 0.6, metalness: 0.15 }),
    deck: new MeshStandardMaterial({ map: deckMap, roughness: 0.85 }),
    dark: new MeshStandardMaterial({ color: new Color('#0a0b0c'), roughness: 0.8 }),
    steel: new MeshStandardMaterial({ color: new Color(0.45, 0.46, 0.47), roughness: 0.35, metalness: 1.0, side: DoubleSide }),
    bronze: new MeshStandardMaterial({ color: new Color(0.72, 0.5, 0.28), roughness: 0.3, metalness: 1.0, side: DoubleSide }),
    rail: new MeshStandardMaterial({ color: new Color('#2c3034'), roughness: 0.5, metalness: 0.3, side: DoubleSide }),
    glassDark: new MeshStandardMaterial({ color: new Color(0.02, 0.025, 0.03), roughness: 0.08 }),
    white: new MeshStandardMaterial({ color: new Color('#e9e7df'), roughness: 0.55 }),
  };
}

// ---- the outer shape --------------------------------------------------------------------------

/** Half-breadth of the casing (feet) at x (feet). */
function casingHalf(xf) {
  const mid = 7.4;
  if (xf > 50) return mid * Math.pow(Math.max(0, 1 - Math.pow((xf - 50) / (152.5 - 50), 1.7)), 0.75);
  if (xf < -55) return Math.max(0.4, mid - 5.2 * Math.pow((-55 - xf) / (161 - 55), 1.3));
  return mid;
}

const NE = 14;      // points on each side of the envelope part, keel to the casing
const NC = 4;       // up each casing side
const ND = 8;       // across the deck

/**
 * The outside at x (feet): starboard from the keel up the envelope to the casing, up the casing,
 * across the deck, down the port casing, down the port envelope to the keel. Fixed point counts
 * so the sections loft. Feet, [z, y].
 */
function outerSection(xf) {
  const deck = deckHeight(xf);
  const env = sectionAt(xf, 64);
  let w = casingHalf(xf);
  let stbd = [];
  if (env) {
    const half = 32;
    const side = env.slice(0, half + 1);                      // starboard, keel -> top
    const maxZ = Math.max(...side.map((p) => p[0]));
    w = Math.min(w, maxZ * 0.97);
    // where the upper half of the envelope comes in to the casing's breadth
    let i = side.findIndex((p, k) => k > half / 2 && p[0] < w);
    if (i < 1) i = half;
    const a = side[i - 1], b = side[i];
    const t = (a[0] - w) / Math.max(1e-6, a[0] - b[0]);
    const junction = [w, a[1] + (b[1] - a[1]) * t];
    stbd = [...side.slice(0, i), junction];
  } else {
    // the stem and the stern beyond the envelope: a narrow wedge down to the forefoot or the skeg
    const yk = xf > 0 ? 2 + (xf - ENVELOPE.xFP) * 1.4 : Math.max(5, deck - 9);
    w = Math.max(0.15, w);
    stbd = [[0.05, yk], [w * 0.5, yk + (deck - yk) * 0.4], [w, deck - 1.2]];
  }
  // resample the envelope part to NE points by arc length
  const env2 = resample(stbd, NE);
  const top = stbd[stbd.length - 1];
  // the casing side: slight tumblehome to the deck edge
  const cas = [];
  for (let k = 1; k <= NC; k++) cas.push([top[0] - (k / NC) * 0.25, top[1] + (deck - top[1]) * (k / NC)]);
  const deckPts = [];
  const wd = top[0] - 0.25;
  for (let k = 1; k < ND; k++) { const z = wd - (2 * wd * k) / ND; deckPts.push([z, deck + 0.12 * (1 - (z / wd) ** 2)]); }
  const s = [...env2, ...cas];
  const p = s.map(([z, y]) => [-z, y]).reverse();
  return { pts: [...s, ...deckPts, ...p], parts: { env: NE, cas: NC, deck: ND - 1 } };
}

function resample(poly, n) {
  const L = [0];
  for (let i = 1; i < poly.length; i++) L.push(L[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  const tot = L[L.length - 1] || 1, out = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * tot;
    while (j < poly.length - 1 && L[j] < s) j++;
    const t = (s - L[j - 1]) / Math.max(1e-9, L[j] - L[j - 1]);
    out.push([poly[j - 1][0] + (poly[j][0] - poly[j - 1][0]) * t, poly[j - 1][1] + (poly[j][1] - poly[j - 1][1]) * t]);
  }
  return out;
}

/** Lofts the outside: hull (below 13 ft the black bottom), casing, deck; smooth normals along each part. */
function loftHull(b) {
  const xs = [];
  for (let x = -161.5; x <= 152.6; x += 1.25) xs.push(x);
  const secs = xs.map((x) => outerSection(x));
  const N = secs[0].pts.length;
  const P = secs.map((s, i) => s.pts.map(([z, y]) => V(xs[i] * FT, y * FT, z * FT)));
  // the index ranges of each part around the section (shared corner vertices are duplicated by the part split)
  const e = NE, c = NC, dk = ND - 1;
  const ranges = [
    ['hullS', 0, e - 1], ['casS', e - 1, e - 1 + c], ['deck', e - 1 + c, e + c + dk], ['casP', e + c + dk, e + c + dk + c], ['hullP', e + c + dk + c, N - 1],
  ];
  const nrm = (i, k, k0, k1) => {
    const a = P[Math.max(0, i - 1)][k], bb = P[Math.min(P.length - 1, i + 1)][k];
    const c0 = P[i][Math.max(k0, k - 1)], c1 = P[i][Math.min(k1, k + 1)];
    const tx = new Vector3().subVectors(bb, a), ts = new Vector3().subVectors(c1, c0);
    const n = new Vector3().crossVectors(ts, tx).normalize();
    return n;
  };
  for (const [name, k0, k1] of ranges) {
    for (let i = 0; i < P.length - 1; i++) {
      for (let k = k0; k < k1; k++) {
        const q = [[i, k], [i + 1, k], [i + 1, k + 1], [i, k + 1]];
        const pts = q.map(([a, kk]) => P[a][kk]);
        const ns = q.map(([a, kk]) => nrm(a, kk, k0, k1));
        const yMid = (pts[0].y + pts[2].y) / 2;
        const part = name.startsWith('hull') ? (yMid < 13.6 * FT ? 'bottom' : 'hull') : name.startsWith('cas') ? 'casing' : 'deck';
        const uv = (pt) => part === 'deck' ? [pt.x / 3.0, pt.z / 3.0] : [pt.x / 8.0, (pt.y - 5.3) / 2.0];
        const p = b.part(part);
        for (const j of [0, 1, 2, 0, 2, 3]) { const [u, w] = uv(pts[j]); b._push(p, pts[j], ns[j], u, w, null); }
      }
    }
  }
  // close the ends: a fan over the last section at each end, facing out (aft at the stern, forward at the bow)
  for (const [sec, out] of [[P[0], -1], [P[P.length - 1], 1]]) {
    const c = sec.reduce((a, v) => a.add(v), new Vector3()).divideScalar(sec.length);
    for (let k = 0; k < N - 1; k++) {
      const n = new Vector3().subVectors(sec[k], c).cross(new Vector3().subVectors(sec[k + 1], c));
      if (n.x * out >= 0) b.tri('hull', c, sec[k], sec[k + 1]); else b.tri('hull', c, sec[k + 1], sec[k]);
    }
  }
}

// ---- the fairwater, bridge and shears ---------------------------------------------------------

/** Plan half-breadth (m) of the fairwater at x (m): rounded forward, drawn out aft. */
function fairHalf(x) {
  const x0 = frameX(44.5), x1 = frameX(62.5);       // forward end, after end
  const L = x0 - x1, u = (x0 - x) / L;              // 0 at the forward end
  if (u < 0 || u > 1) return 0;
  const front = Math.sqrt(Math.min(1, u / 0.18));
  const back = Math.pow(Math.min(1, (1 - u) / 0.45), 0.6);
  return 1.55 * front * back;
}

function fairwater(b) {
  const x0 = frameX(44.5), x1 = frameX(62.5);
  const yb = deckHeight(15) * FT - 0.3, yt = HULL.bridgeDeck + 1.15;
  const n = 36, m = 24;
  const ring = (x) => {
    const w = fairHalf(x);
    const pts = [];
    for (let j = 0; j <= m; j++) { const a = (j / m) * Math.PI; pts.push([w * Math.cos(a), 0]); }
    return { w };
  };
  void ring;
  // the sides: vertical plating, the plan shape swept
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(x1 + (x0 - x1) * (i / n));
  for (const s of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const xa = xs[i], xb = xs[i + 1];
      const wa = fairHalf(xa) * s, wb = fairHalf(xb) * s;
      const a0 = V(xa, yb, wa), b0 = V(xb, yb, wb), b1 = V(xb, yt, wb), a1 = V(xa, yt, wa);
      if (s > 0) b.quad('casing', a0, b0, b1, a1, [xa / 8, (yb - 5.3) / 2, xb / 8, (yt - 5.3) / 2]);
      else b.quad('casing', b0, a0, a1, b1, [xb / 8, (yb - 5.3) / 2, xa / 8, (yt - 5.3) / 2]);
      // the coaming: a rolled top edge
      b.cylinder('rail', V(xa, yt, wa), V(xb, yt, wb), 0.035, 0.035, { segs: 6 });
    }
  }
  // the bridge deck inside (open to the sky), and the cigarette deck aft a step lower
  const bx0 = frameX(46), bx1 = frameX(55.5);
  const step = 26;
  for (let i = 0; i < step; i++) {
    const xa = x1 + (x0 - x1) * (i / step), xb = x1 + (x0 - x1) * ((i + 1) / step);
    const wa = fairHalf(xa) * 0.97, wb = fairHalf(xb) * 0.97;
    const y = xa > bx1 && xb < bx0 + 0.6 ? HULL.bridgeDeck : HULL.bridgeDeck - 0.9;
    b.quad('deck', V(xa, y, wa), V(xb, y, wb), V(xb, y, -wb), V(xa, y, -wa), [xa / 3, wa / 3, xb / 3, -wb / 3]);
  }
  // the conning tower itself shows inside the fairwater under the bridge: its top and the upper hatch
  const ct = CONNING_TOWER, hx = frameX(54);
  b.cylinder('rail', V(hx, HULL.bridgeDeck + 0.02, 0), V(hx, HULL.bridgeDeck + 0.18, 0), 0.4, 0.4, { segs: 20 });
  // the periscope shears: two columns and the tripod, the periscope tubes; the SJ radar mast
  const s1 = frameX(52.2), s2 = frameX(53.8);
  const top = HULL.bridgeDeck + 7.6;
  b.cylinder('rail', V(s1 + 0.6, HULL.bridgeDeck, 0), V(s1, top, 0), 0.22, 0.17, { segs: 12 });
  b.cylinder('rail', V(s2 - 0.9, HULL.bridgeDeck, 0), V(s2, top - 0.5, 0), 0.2, 0.16, { segs: 12 });
  b.cylinder('rail', V(s1, top - 0.3, 0), V(s2, top - 0.8, 0), 0.08, 0.08, { segs: 8 });
  b.box('rail', [s2 - 0.5, top - 0.9, -0.5], [s1 + 0.5, top - 0.75, 0.5]);
  b.cylinder('steel', V(s1 - 0.25, HULL.bridgeDeck + 0.5, 0.0), V(s1 - 0.25, top + 1.6, 0.0), 0.09, 0.09, { segs: 10 });
  b.cylinder('steel', V(s2 + 0.25, HULL.bridgeDeck + 0.5, 0.0), V(s2 + 0.25, top + 0.9, 0.0), 0.12, 0.12, { segs: 10 });
  const sj = frameX(55.2);
  b.cylinder('rail', V(sj, HULL.bridgeDeck, 0.3), V(sj, top - 1.2, 0.3), 0.07, 0.06, { segs: 8 });
  b.box('rail', [sj - 0.05, top - 1.6, -0.25], [sj + 0.05, top - 1.1, 0.85]);
  // the bridge's bulwark windows (the old wind deflector) and the TBT pedestal
  b.box('glassDark', [frameX(46.2) - 0.02, HULL.bridgeDeck + 0.9, -0.7], [frameX(46.2) + 0.02, HULL.bridgeDeck + 1.1, 0.7]);
  // 20 mm gun platforms (empty mounts) fore and aft
  for (const [x, y] of [[frameX(45.3), HULL.bridgeDeck - 0.3], [frameX(61.2), HULL.bridgeDeck - 0.9]]) {
    b.cylinder('rail', V(x, y, 0), V(x, y + 0.8, 0), 0.12, 0.1, { segs: 10 });
  }
  void ct;
}

// ---- appendages ---------------------------------------------------------------------------------

/** A flat foil: chord w along x (centred), span h along z (toward +z, or -z when dir < 0), thickness t along y. */
function foil(b, part, w, h, t, dir = 1) {
  const ch = w / 2, sp = h * dir, th = t / 2;
  const prof = [[ch, 0], [ch * 0.6, th], [-ch * 0.3, th * 0.9], [-ch, 0.01], [-ch * 0.3, -th * 0.9], [ch * 0.6, -th]];
  const q = (a, b2, c, d) => (dir > 0 ? b.quad(part, a, b2, c, d) : b.quad(part, d, c, b2, a));
  for (let i = 0; i < prof.length; i++) {
    const [x0, y0] = prof[i], [x1, y1] = prof[(i + 1) % prof.length];
    q(V(x0, y0, 0), V(x1, y1, 0), V(x1, y1, sp), V(x0, y0, sp));
  }
  // the tip and the root, closed as fans
  for (const z of [0, sp]) {
    const out = (z === 0) === (dir > 0);
    for (let i = 1; i < prof.length - 1; i++) {
      const a = V(prof[0][0], prof[0][1], z), c1 = V(prof[i][0], prof[i][1], z), c2 = V(prof[i + 1][0], prof[i + 1][1], z);
      if (out) b.tri(part, a, c2, c1); else b.tri(part, a, c1, c2);
    }
  }
}

/** A propeller: four blades round a hub, its axis along x. */
export function propellerMesh(mat) {
  const b = new Builder();
  const R = PROPELLER.dia / 2, hub = 0.3;
  b.cylinder('p', V(-0.35, 0, 0), V(0.4, 0, 0), hub, hub * 0.7, { segs: 16 });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    // a blade: skewed, pitched 0.48 rad near the root falling off toward the tip
    const n = 8, pts = [];
    for (let i = 0; i <= n; i++) {
      const r = hub + (R - hub) * (i / n);
      const chord = 0.55 * Math.sin(Math.PI * (0.15 + 0.8 * i / n)) + 0.12;
      const pitch = Math.atan(PROPELLER.pitch / (2 * Math.PI * Math.max(r, 0.35)));
      const skew = 0.25 * (i / n) ** 2;
      pts.push({ r, chord, pitch, skew });
    }
    for (let i = 0; i < n; i++) {
      const A = pts[i], B = pts[i + 1];
      const corner = (q, s) => {
        const c = q.chord * s, ang = a + q.skew + (c * Math.cos(q.pitch)) / q.r;
        return V(c * Math.sin(q.pitch) * 0.4, q.r * Math.cos(ang), q.r * Math.sin(ang));
      };
      const a0 = corner(A, -0.5), a1 = corner(A, 0.5), b0 = corner(B, -0.5), b1 = corner(B, 0.5);
      b.quad('p', a0, b0, b1, a1); b.quad('p', a1, b1, b0, a0);
    }
  }
  const g = b.build({ p: mat });
  return g;
}

export class HullGL {
  constructor(mats) {
    this.m = mats;
    const b = new Builder();
    loftHull(b);
    fairwater(b);
    this._saddle(b);
    this._fixed(b);
    this.group = b.build(mats);
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.static = false; } });
    this._moving();
  }

  /** The observation deck's steel: the saddle on the deck, end rings and hoops round the acrylic. */
  _saddle(b) {
    const D = OBS_DECK, h = D.length / 2, R = D.rOut;
    const yDeck = deckHeight(D.x / FT) * FT;
    // the saddle: a steel cradle from the deck to the capsule's sides
    b.box('casing', [D.x - h - 0.3, yDeck - 0.1, -R * 0.82], [D.x + h + 0.3, D.axisY - R * 0.62, R * 0.82]);
    // end rings (where the cylinder meets the domes) and three hoops
    for (const x of [D.x - h, D.x - h / 3, D.x + h / 3, D.x + h]) {
      const segs = 40;
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * Math.PI * 2, t1 = ((i + 1) / segs) * Math.PI * 2;
        if (Math.sin(t0) < -0.62 && Math.sin(t1) < -0.62) continue;
        const r = R + 0.03, w = x === D.x - h || x === D.x + h ? 0.09 : 0.04;
        const p = (t, rr, dx) => V(x + dx, D.axisY + rr * Math.sin(t), rr * Math.cos(t));
        b.quad('steel', p(t0, r, -w), p(t1, r, -w), p(t1, r, w), p(t0, r, w));
        b.quad('steel', p(t0, r, w), p(t1, r, w), p(t1, r - 0.06, w), p(t0, r - 0.06, w));
        b.quad('steel', p(t0, r - 0.06, -w), p(t1, r - 0.06, -w), p(t1, r, -w), p(t0, r, -w));
      }
    }
  }

  /** Fixed appendages: shafts, struts, the skeg, the bow plane fairings, guards. */
  _fixed(b) {
    const px = -140 * FT, py = PROPELLER.shaftHeight, pz = PROPELLER.shaftOffset;
    for (const s of [1, -1]) {
      // the shaft from the hull to the screw, and its strut
      b.cylinder('steel', V(px + 9.5, py + 0.26, s * (pz - 0.24)), V(px + 0.35, py, s * pz), 0.16, 0.16, { segs: 10 });
      b.cylinder('hull', V(px + 1.2, py, s * pz), V(px + 2.0, py + 1.5, s * (pz - 1.1)), 0.09, 0.09, { segs: 8 });
      b.cylinder('hull', V(px + 1.2, py, s * pz), V(px + 1.9, py - 0.3, s * 0.2), 0.08, 0.08, { segs: 8 });
      b.cylinder('hull', V(px + 1.0, py, s * pz), V(px + 2.0, py, s * pz), 0.28, 0.24, { segs: 12 });
      // the screw guard over the top of each screw (the class's "propeller guards")
      b.cylinder('rail', V(px + 2.5, deckHeight(-140) * FT - 1.3, s * 1.2), V(px - 0.5, deckHeight(-140) * FT - 1.6, s * (pz + 1.7)), 0.06, 0.06, { segs: 6 });
    }
    // the skeg: the keel's after end, carrying the rudder's lower bearing
    const sx0 = -132 * FT, sx1 = -157 * FT;
    b.quad('bottom', V(sx0, 1.2, 0.08), V(sx1, 3.0, 0.08), V(sx1, 4.6, 0.08), V(sx0, 4.6, 0.08));
    b.quad('bottom', V(sx1, 3.0, -0.08), V(sx0, 1.2, -0.08), V(sx0, 4.6, -0.08), V(sx1, 4.6, -0.08));
    b.quad('bottom', V(sx0, 1.2, -0.08), V(sx1, 3.0, -0.08), V(sx1, 3.0, 0.08), V(sx0, 1.2, 0.08));
    // stern plane and bow plane stocks' fairings
    b.cylinder('hull', V(STERN_PLANES.stockX, STERN_PLANES.axisY, -1.2), V(STERN_PLANES.stockX, STERN_PLANES.axisY, 1.2), 0.18, 0.18, { segs: 10 });
    // the anchor in its pocket, starboard bow
    b.box('dark', [frameX(10), 4.9, 1.55], [frameX(8), 5.6, 1.75]);
  }

  /** The parts that move: bow planes, stern planes, rudder, screws. */
  _moving() {
    const m = this.m;
    const mk = (fn, part) => { const b = new Builder(); fn(b); const g = b.build({ [part]: m[part] ?? m.hull }); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g; };
    // bow planes: a pivot at each side; rigging folds them up about a fore-and-aft hinge, the tilt turns them about the stock
    this.bowPlanes = [];
    for (const s of [1, -1]) {
      const rig = new Group();
      rig.position.set(BOW_PLANES.stockX, BOW_PLANES.hingeY, s * 1.05);
      const tilt = new Group();
      rig.add(tilt);
      const blade = mk((b) => foil(b, 'hull', BOW_PLANES.width, BOW_PLANES.length * 0.92, 0.32, s), 'hull');
      tilt.add(blade);
      this.group.add(rig);
      this.bowPlanes.push({ rig, tilt, s });
    }
    // stern planes: each side of the stern, on a common stock
    this.sternPlanes = [];
    for (const s of [1, -1]) {
      const tilt = new Group();
      tilt.position.set(STERN_PLANES.stockX, STERN_PLANES.axisY, s * 1.15);
      const blade = mk((b) => foil(b, 'hull', STERN_PLANES.width, STERN_PLANES.span, 0.28, s), 'hull');
      blade.position.x = -STERN_PLANES.width * 0.12;
      tilt.add(blade);
      this.group.add(tilt);
      this.sternPlanes.push({ tilt });
    }
    // the rudder: a vertical foil abaft the screws
    this.rudder = new Group();
    this.rudder.position.set(-(159.5 - 1.2) * FT, 0.9, 0);
    const rb = mk((b) => foil(b, 'hull', 2.05, RUDDER.height, 0.3), 'hull');
    rb.rotation.x = -Math.PI / 2;           // the span (z) turned up to +y
    rb.position.x = -0.85;
    this.rudder.add(rb);
    this.group.add(this.rudder);
    // the screws
    this.screws = [];
    for (const s of [-1, 1]) {
      const g = propellerMesh(m.bronze);
      g.position.set(-140 * FT - 0.1, PROPELLER.shaftHeight, s * PROPELLER.shaftOffset);
      this.group.add(g);
      this.screws.push({ g, s });
    }
  }

  /** Moves the planes, the rudder and the screws to the plant's state. */
  update(plant) {
    const P = plant.planes;
    for (const p of this.bowPlanes) {
      // rigged in: folded up against the casing (about 80 degrees); out: level, tilted to the planes' angle
      const fold = (1 - plant.rig) * 1.38;
      p.rig.rotation.x = -p.s * fold;
      p.tilt.rotation.z = (P.bow * Math.PI) / 180;
    }
    for (const p of this.sternPlanes) p.tilt.rotation.z = (P.stern * Math.PI) / 180;
    this.rudder.rotation.y = -(P.rudder * Math.PI) / 180;
    const revs = plant.shaft;
    this.screws[0].g.rotation.x = -revs.port.revs * Math.PI * 2;
    this.screws[1].g.rotation.x = revs.stbd.revs * Math.PI * 2;
  }
}

export { outerSection, casingHalf, fairHalf, canvasTex, V };
