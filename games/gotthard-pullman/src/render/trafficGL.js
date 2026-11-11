/**
 * The other trains in 3D, each built from its entry in the roster (world/roster.js): multiple
 * units (the copper Traverso, the white Giruno and Astoro with their long noses) of cars with the
 * window band in black glass, doors in the livery's colour and roofs carrying the air-conditioning
 * and the pantographs; engines (the Re 420 and the six-axle Re 620, box bodies with a cab at each
 * end); the EW IV coaches; container and tank wagons. Three white lights lead, red ones trail.
 * (Bodies 2.88 m wide, about 4.2 m over the roof equipment; proportions, not rivet counts.)
 */
import { Group, Euler, MeshStandardMaterial, MeshPhysicalMaterial, Color, Vector3, Matrix4 } from 'three';
import { tyre, BACK } from './wheel.js';
import { Builder } from './geom.js';
import { poseOnTrack } from './trainGL.js';
import { ROSTER } from '../world/roster.js';

const HALF = 1.44, WR = 0.43;
const V = (x, y, z) => new Vector3(x, y, z);
const _e = new Euler(0, 0, 0, 'YZX');

const _mats = new Map();
/** The materials of one livery (shared by every train of the type). */
function mats(type) {
  let M = _mats.get(type);
  if (M) return M;
  const L = ROSTER[type].livery, paint = (c) => (L.metal ? new MeshPhysicalMaterial({ color: new Color(c), roughness: 0.32, metalness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.2 }) : new MeshPhysicalMaterial({ color: new Color(c), roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
  M = {
    body: paint(L.body), door: paint(L.door ?? L.body), accent: paint(L.accent ?? L.body), loco: paint(L.loco ?? L.body), cargo: paint(L.cargo ?? L.loco ?? L.body),
    skirt: new MeshStandardMaterial({ color: new Color(L.skirt), roughness: 0.6, metalness: 0.3 }),
    roof: new MeshStandardMaterial({ color: new Color(L.roof), roughness: 0.55, metalness: 0.4 }),
    glass: new MeshPhysicalMaterial({ color: new Color(L.band), roughness: 0.06, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03 }),
    bellows: new MeshStandardMaterial({ color: new Color('#161616'), roughness: 0.9 }),
    bogie: new MeshStandardMaterial({ color: new Color('#222326'), roughness: 0.7, metalness: 0.4 }),
    steel: new MeshStandardMaterial({ color: new Color('#6e7073'), roughness: 0.35, metalness: 1.0 }),
    tank: new MeshStandardMaterial({ color: new Color('#8b8f92'), roughness: 0.45, metalness: 0.6 }),
    box0: new MeshStandardMaterial({ color: new Color('#1f5fa8'), roughness: 0.7 }), box1: new MeshStandardMaterial({ color: new Color('#b5451b'), roughness: 0.7 }),
    box2: new MeshStandardMaterial({ color: new Color('#3d7d4a'), roughness: 0.7 }), box3: new MeshStandardMaterial({ color: new Color('#c9c4b8'), roughness: 0.7 }),
    lamp: new MeshStandardMaterial({ color: new Color(1, 1, 1), emissive: new Color(1, 0.97, 0.9), emissiveIntensity: 4 }),
    tail: new MeshStandardMaterial({ color: new Color(0.3, 0, 0), emissive: new Color(1, 0.05, 0.03), emissiveIntensity: 3 }),
    light: new MeshStandardMaterial({ color: new Color('#d8d2c4'), emissive: new Color(1, 0.93, 0.8), emissiveIntensity: 0.35, roughness: 0.6 }),
  };
  _mats.set(type, M);
  return M;
}

/** The body's section (z, y): skirt, sides, the roof's curve. */
const SECTION = [[HALF - 0.04, 0.45], [HALF, 0.75], [HALF, 3.3], [HALF - 0.18, 3.68], [0.8, 3.86], [0, 3.9], [-0.8, 3.86], [-(HALF - 0.18), 3.68], [-HALF, 3.3], [-HALF, 0.75], [-(HALF - 0.04), 0.45]];

/** A bogie's frame and its two wheelsets at x. */
function bogie(b, x, axles = 2) {
  b.box('bogie', [x - 1.6, 0.25, -1.05], [x + 1.6, 0.75, 1.05]);
  for (const dx of axles === 3 ? [-1.9, 0, 1.9] : [-1.35, 1.35]) for (const sd of [-1, 1]) {
    b.transform(new Matrix4().makeTranslation(x + dx, WR, 0));
    tyre(b, 'steel', WR, sd, { segs: 18 });
    b.cylinder('bogie', V(0, 0, sd * (BACK + 0.03)), V(0, 0, sd * (BACK + 0.08)), WR - 0.05, WR - 0.05, { segs: 16 });
    b.transform(null);
  }
}
/** A pantograph on the roof at x. */
function panto(b, x) {
  b.box('steel', [x - 0.9, 3.9, -0.5], [x + 0.9, 4.0, 0.5]);
  b.cylinder('steel', V(x - 0.6, 4.0, 0), V(x + 0.4, 4.85, 0), 0.03, 0.03, { segs: 6 });
  b.cylinder('steel', V(x + 0.4, 4.85, 0), V(x - 0.2, 5.2, 0), 0.025, 0.025, { segs: 6 });
  b.box('steel', [x - 0.35, 5.2, -0.8], [x - 0.05, 5.24, 0.8]);
}
/** The straight body between x0 and x1 in a paint, the roof and the skirt. */
function shell(b, paint, x0, x1) {
  b.extrudeX(paint, SECTION.slice(1, 3), x0, x1, { closed: false });
  b.extrudeX(paint, SECTION.slice(8, 10), x0, x1, { closed: false });
  b.extrudeX('roof', SECTION.slice(2, 9), x0, x1, { closed: false });
  b.extrudeX('skirt', [SECTION[0], SECTION[1]], x0, x1, { closed: false });
  b.extrudeX('skirt', [SECTION[9], SECTION[10]], x0, x1, { closed: false });
  b.box('skirt', [x0, 0.42, -HALF + 0.04], [x1, 0.47, HALF - 0.04]);
}
/** A panel on a side (s = +1 right, -1 left), a hair proud of it. */
function panel(b, name, s, xa, xb, ya, yb) {
  const z = s * (HALF + 0.004);
  if (s > 0) b.quad(name, V(xa, ya, z), V(xb, ya, z), V(xb, yb, z), V(xa, yb, z)); else b.quad(name, V(xb, ya, z), V(xa, ya, z), V(xa, yb, z), V(xb, yb, z));
}

/** One vehicle of a train, x forward, its middle at 0. kind: cab (nose at +x), car, coach, loco, loco6, container, tank. */
function vehicle(type, kind, len, k, n) {
  const T = ROSTER[type], b = new Builder(), h = len / 2;
  if (kind === 'container' || kind === 'tank') {
    b.box('bogie', [-h + 0.5, 0.95, -1.3], [h - 0.5, 1.15, 1.3]);                             // the frame
    if (kind === 'tank') {
      b.cylinder('tank', V(-h + 1.2, 2.45, 0), V(h - 1.2, 2.45, 0), 1.3, 1.3, { segs: 20 });
      b.box('bogie', [-0.5, 3.7, -0.5], [0.5, 3.95, 0.5]);
      for (const x of [-h + 2.2, h - 2.2]) b.box('bogie', [x - 0.15, 1.15, -1.25], [x + 0.15, 1.6, 1.25]);
    } else {
      // two 20-foot boxes or one 40-foot, in the colours of the trade
      const two = (k * 7) % 3 !== 0;
      const put = (xa, xb, c) => b.box(`box${c}`, [xa, 1.15, -1.22], [xb, 3.75, 1.22]);
      if (two) { put(-h + 1.0, -0.25, (k * 3) % 4); put(0.25, h - 1.0, (k * 5 + 1) % 4); } else put(-h + 1.4, h - 1.4, (k + 2) % 4);
    }
    bogie(b, -h + 2.4); bogie(b, h - 2.4);
    for (const x of [-h + 0.25, h - 0.25]) for (const z of [-0.875, 0.875]) b.cylinder('steel', V(x - 0.25, 1.05, z), V(x + 0.25, 1.05, z), 0.18, 0.18, { segs: 10 });
    return b.build(mats(type));
  }
  if (kind === 'loco' || kind === 'loco6') {
    const x0 = -h + 0.45, x1 = h - 0.45;
    shell(b, 'loco', x0, x1);
    for (const e of [-1, 1]) {
      const xf = e > 0 ? x1 : x0;
      // the cab end: the front in the engine's (or SBB Cargo's blue) paint, the windscreen, the lights, the buffers
      b.box(T.livery.cargo ? 'cargo' : 'loco', [Math.min(xf, xf + e * 0.12), 0.75, -HALF], [Math.max(xf, xf + e * 0.12), 3.3, HALF]);
      b.box('glass', [Math.min(xf + e * 0.1, xf + e * 0.16), 2.25, -1.15], [Math.max(xf + e * 0.1, xf + e * 0.16), 3.0, 1.15]);
      for (const z of [-0.95, 0.95]) b.box(e > 0 ? 'lamp' : 'tail', [Math.min(xf + e * 0.1, xf + e * 0.17), 1.3, z - 0.12], [Math.max(xf + e * 0.1, xf + e * 0.17), 1.5, z + 0.12]);
      if (e > 0) b.box('lamp', [xf + 0.1, 3.05, -0.12], [xf + 0.17, 3.2, 0.12]);
      for (const z of [-0.875, 0.875]) b.cylinder('steel', V(xf, 1.05, z), V(xf + e * 0.45, 1.05, z), 0.2, 0.2, { segs: 10 });
      for (const s of [-1, 1]) panel(b, 'glass', s, xf - e * 1.5, xf - e * 0.5, 2.2, 3.0);            // cab side windows
    }
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const x = -h * 0.5 + (i * h) / 3; panel(b, 'bogie', s, x - 0.35, x + 0.35, 2.3, 2.95); }   // the machine room's grilles
    panto(b, -h + 3.2); panto(b, h - 3.2);
    if (kind === 'loco6') { bogie(b, -h + 3.4); bogie(b, 0); bogie(b, h - 3.4); } else { bogie(b, -h + 3.6); bogie(b, h - 3.6); }
    return b.build(mats(type));
  }
  // ---- a car of a multiple unit, or a coach
  const cab = kind === 'cab', sleek = T.nose === 'sleek', noseLen = cab ? (sleek ? 5.6 : 3.2) : 0;
  const x0 = -h + 0.35, x1 = h - 0.35 - noseLen;
  shell(b, 'body', x0, x1);
  for (const s of [-1, 1]) {
    panel(b, 'glass', s, x0 + 0.3, x1 - 0.2, 1.3, 2.35);                                   // the window band
    if (T.livery.accent) panel(b, 'accent', s, x0, x1, 0.78, 0.92);                         // a line of the accent above the skirt
    for (const xd of [-h + 3.4, h - 3.4 - (cab ? noseLen - 1.0 : 0)]) {
      panel(b, 'door', s, xd - 0.68, xd + 0.68, 0.62, 2.62);
      panel(b, 'glass', s, xd - 0.6, xd - 0.06, 1.1, 2.4);
      panel(b, 'glass', s, xd + 0.06, xd + 0.6, 1.1, 2.4);
    }
    // the lit interior seen through the glass on dark days and in tunnels
    b.box('light', [x0 + 0.4, 1.32, s * (HALF - 0.12) - 0.01], [x1 - 0.3, 2.33, s * (HALF - 0.12) + 0.01]);
  }
  b.box('roof', [-2.2, 3.86, -0.9], [1.4, 4.18, 0.9]);                                       // the air conditioning
  if (kind !== 'coach' && (k === 1 || k === n - 2 || (n > 9 && k === Math.floor(n / 2)))) panto(b, 0);
  if (cab) {
    // the nose: the roof raked down to the windscreen, the front closing in (long and low on the fast trains)
    const N = sleek ? [0, 1.6, 3.2, 4.6, 5.6] : [0, 1.2, 2.4, 3.2];
    const tops = sleek ? [3.9, 3.7, 3.2, 2.5, 1.75] : [3.9, 3.55, 2.95, 2.35], halfs = sleek ? [HALF, HALF - 0.05, HALF - 0.2, HALF - 0.5, HALF - 0.85] : [HALF, HALF - 0.08, HALF - 0.22, HALF - 0.42];
    const xs = N.map((d) => x1 + d);
    const ring = (i) => SECTION.map(([z, y]) => [z * (halfs[i] / HALF), y > 3.3 ? 3.3 + (y - 3.3) * ((tops[i] - 3.3) / 0.6) : Math.min(y, tops[i])]);
    for (let i = 0; i + 1 < xs.length; i++) {
      const A = ring(i), B = ring(i + 1);
      for (let j = 0; j + 1 < A.length; j++) {
        const glass = A[j][1] > (sleek ? 2.0 : 2.2) && i > 0 && i < xs.length - (sleek ? 2 : 0);
        const mat = glass ? 'glass' : j === 0 || j === A.length - 2 ? 'skirt' : sleek && i >= xs.length - 3 && A[j][1] < 2.0 ? 'accent' : 'body';
        b.quad(mat, V(xs[i], A[j][1], A[j][0]), V(xs[i + 1], B[j][1], B[j][0]), V(xs[i + 1], B[j + 1][1], B[j + 1][0]), V(xs[i], A[j + 1][1], A[j + 1][0]));
      }
    }
    const F = ring(xs.length - 1), xf = xs.at(-1), ym = sleek ? 1.1 : 1.2;
    for (let j = 1; j + 1 < F.length; j++) b.tri(!sleek && F[j][1] > 2.0 ? 'glass' : sleek ? 'accent' : 'body', V(xf, ym, 0), V(xf, F[j + 1][1], F[j + 1][0]), V(xf, F[j][1], F[j][0]));
    const zl = sleek ? 0.42 : 0.85;
    for (const z of [-zl, zl]) b.box('lamp', [xf - 0.02, ym - 0.05, z - 0.14], [xf + 0.03, ym + 0.12, z + 0.14]);
    for (const z of [-zl - 0.2, zl + 0.2]) b.box('tail', [xf - 0.02, ym - 0.05, z - 0.06], [xf + 0.03, ym + 0.12, z + 0.06]);
    b.box('lamp', [xs[1] + 0.4, tops[1] - 0.02, -0.15], [xs[1] + 0.5, tops[1] + 0.08, 0.15]);
    b.box('skirt', [xf - 0.3, 0.25, -(sleek ? 0.7 : 1.2)], [xf + 0.15, 0.6, sleek ? 0.7 : 1.2]);
  }
  // the bogies: Jacobs bogies shared between the cars of the articulated sets, a pair under each of the others
  if (T.jacobs) { bogie(b, -h); if (cab) bogie(b, h - noseLen - 1.4); } else { bogie(b, -h + 4.2); bogie(b, h - 4.2 - (cab ? noseLen - 1.5 : 0)); }
  b.box('bellows', [-h - 0.36, 0.7, -1.2], [-h + 0.36, 3.5, 1.2]);
  return b.build(mats(type));
}

export class TrafficGL {
  constructor(stage, traffic) {
    this.stage = stage; this.traffic = traffic;
    this.group = new Group(); this.group.name = 'traffic';
    stage.scene.add(this.group);
    // one train set per scheduled train, of its own type
    this.sets = traffic.trains.map((tr) => {
      const T = ROSTER[tr.type], n = T.cars.length;
      let off = 0;
      const cars = T.cars.map(([kind, len], k) => {
        const rear = kind === 'cabR';
        const g = vehicle(tr.type, rear ? 'cab' : kind, len, k, n);
        g.name = `${tr.type}-${k}`;
        const holder = new Group();
        holder.add(g);
        if (rear) g.rotation.y = Math.PI;      // the trailing cab faces the other way
        holder.userData.off = off; holder.userData.len = len;
        off += len;
        this.group.add(holder);
        return holder;
      });
      return cars;
    });
    this._p = {};
  }

  update(clock, camera) {
    const o = this.stage.origin, cam = camera.position;
    const live = new Map(this.traffic.at(clock).map((a) => [a.train, a]));
    this.traffic.trains.forEach((tr, i) => {
      const cars = this.sets[i], a = live.get(tr);
      if (!a) { for (const c of cars) c.visible = false; return; }
      const P = tr.path;
      for (const c of cars) {
        const front = a.s - c.userData.off, back = front - c.userData.len;
        if (back < 0 || front > P.length) { c.visible = false; continue; }
        const pose = poseOnTrack(P, front - 0.4, back + 0.4, this._p);
        c.position.set(pose.x - o.x, pose.z - o.z, -(pose.y - o.y));
        c.visible = c.position.distanceTo(cam) < 3000;
        _e.set(pose.roll, pose.yaw, pose.pitch, 'YZX');
        c.rotation.copy(_e);
      }
    });
  }

  /** The nearest point of any of these trains to p (world) and its speed: for the sound. */
  nearest(p) {
    let best = null;
    for (const [i, cars] of this.sets.entries()) for (const c of cars) {
      if (!c.visible) continue;
      const d = c.position.distanceTo(p);
      if (!best || d < best.d) best = { d, i, pos: c.position };
    }
    return best;
  }
}
