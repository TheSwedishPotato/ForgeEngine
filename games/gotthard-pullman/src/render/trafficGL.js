/**
 * The Treno Gottardo in 3D: a Südostbahn "Traverso" (RABe 526), a Stadler FLIRT derivative of
 * eight articulated cars on Jacobs bogies, 150.2 m, in copper-red with the window band in black
 * glass and a light grey roof carrying the air-conditioning units and two pantographs, a
 * driving cab with a raked nose at each end: three white lights leading, red ones trailing.
 * (Proportions from the FLIRT family: 2.88 m wide, about 4.2 m over the roof equipment.)
 */
import { Group, Euler, MeshStandardMaterial, MeshPhysicalMaterial, Color, Vector3 } from 'three';
import { Builder } from './geom.js';
import { poseOnTrack } from './trainGL.js';

const LEN = 150.2, CARS = 8, LC = LEN / CARS;     // car pitch (bogie centre to bogie centre)
const HALF = 1.44, FLOOR = 0.6, WR = 0.43;
const V = (x, y, z) => new Vector3(x, y, z);
const _e = new Euler(0, 0, 0, 'YZX');

let _mats = null;
function mats() {
  if (_mats) return _mats;
  _mats = {
    copper: new MeshPhysicalMaterial({ color: new Color('#8e3f2b'), roughness: 0.32, metalness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    skirt: new MeshStandardMaterial({ color: new Color('#26272a'), roughness: 0.6, metalness: 0.3 }),
    roof: new MeshStandardMaterial({ color: new Color('#8d9093'), roughness: 0.55, metalness: 0.4 }),
    glass: new MeshPhysicalMaterial({ color: new Color('#0b0f12'), roughness: 0.06, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03 }),
    bellows: new MeshStandardMaterial({ color: new Color('#161616'), roughness: 0.9 }),
    bogie: new MeshStandardMaterial({ color: new Color('#222326'), roughness: 0.7, metalness: 0.4 }),
    steel: new MeshStandardMaterial({ color: new Color('#6e7073'), roughness: 0.35, metalness: 1.0 }),
    lamp: new MeshStandardMaterial({ color: new Color(1, 1, 1), emissive: new Color(1, 0.97, 0.9), emissiveIntensity: 4 }),
    tail: new MeshStandardMaterial({ color: new Color(0.3, 0, 0), emissive: new Color(1, 0.05, 0.03), emissiveIntensity: 3 }),
    light: new MeshStandardMaterial({ color: new Color('#d8d2c4'), emissive: new Color(1, 0.93, 0.8), emissiveIntensity: 0.35, roughness: 0.6 }),
  };
  return _mats;
}

/** The body's section (z, y): skirt, sides, the roof's curve. */
const SECTION = [[HALF - 0.04, 0.45], [HALF, 0.75], [HALF, 3.3], [HALF - 0.18, 3.68], [0.8, 3.86], [0, 3.9], [-0.8, 3.86], [-(HALF - 0.18), 3.68], [-HALF, 3.3], [-HALF, 0.75], [-(HALF - 0.04), 0.45]];

/** One car, x forward, its middle at 0; `nose` for the driving end at +x. */
function car(k, { nose = false, pantograph = false } = {}) {
  const b = new Builder();
  const x0 = -LC / 2 + 0.35, x1 = LC / 2 - 0.35 - (nose ? 3.2 : 0);
  // the body: copper sides above the black skirt, the roof in grey
  b.extrudeX('copper', SECTION.slice(1, 3), x0, x1, { closed: false });
  b.extrudeX('copper', SECTION.slice(8, 10), x0, x1, { closed: false });
  b.extrudeX('roof', SECTION.slice(2, 9), x0, x1, { closed: false });
  b.extrudeX('skirt', [SECTION[0], SECTION[1]], x0, x1, { closed: false });
  b.extrudeX('skirt', [SECTION[9], SECTION[10]], x0, x1, { closed: false });
  b.box('skirt', [x0, 0.42, -HALF + 0.04], [x1, 0.47, HALF - 0.04]);
  // the window band and the doors (black glass a hair proud of the sides)
  for (const s of [-1, 1]) {
    const z = s * (HALF + 0.004);
    const face = (name, xa, xb, ya, yb) => s > 0 ? b.quad(name, V(xa, ya, z), V(xb, ya, z), V(xb, yb, z), V(xa, yb, z)) : b.quad(name, V(xb, ya, z), V(xa, ya, z), V(xa, yb, z), V(xb, yb, z));
    face('glass', x0 + 0.3, x1 - 0.2, 1.3, 2.35);
    for (const xd of [-LC / 2 + 3.4, LC / 2 - 3.4 - (nose ? 2.2 : 0)]) {
      face('skirt', xd - 0.68, xd + 0.68, 0.62, 2.62);
      face('glass', xd - 0.6, xd - 0.06, 1.1, 2.4);
      face('glass', xd + 0.06, xd + 0.6, 1.1, 2.4);
    }
  }
  // the lit interior seen through the glass on dark days and in tunnels (a dim inner wall)
  for (const s of [-1, 1]) b.box('light', [x0 + 0.4, 1.32, s * (HALF - 0.12) - 0.01], [x1 - 0.3, 2.33, s * (HALF - 0.12) + 0.01]);
  // roof equipment: the air conditioning, and the pantograph on two of the cars
  b.box('roof', [-2.2, 3.86, -0.9], [1.4, 4.18, 0.9]);
  if (pantograph) {
    b.box('steel', [-0.9, 3.9, -0.5], [0.9, 4.0, 0.5]);
    b.cylinder('steel', V(-0.6, 4.0, 0), V(0.4, 4.85, 0), 0.03, 0.03, { segs: 6 });
    b.cylinder('steel', V(0.4, 4.85, 0), V(-0.2, 5.2, 0), 0.025, 0.025, { segs: 6 });
    b.box('steel', [-0.35, 5.2, -0.8], [-0.05, 5.24, 0.8]);
  }
  // the nose: the roof raked down to the windscreen, the front closing in
  if (nose) {
    const xs = [x1, x1 + 1.2, x1 + 2.4, x1 + 3.2], tops = [3.9, 3.55, 2.95, 2.35], halfs = [HALF, HALF - 0.08, HALF - 0.22, HALF - 0.42];
    const ring = (i) => SECTION.map(([z, y]) => [z * (halfs[i] / HALF), y > 3.3 ? 3.3 + (y - 3.3) * ((tops[i] - 3.3) / 0.6) : Math.min(y, tops[i])]);
    for (let i = 0; i + 1 < xs.length; i++) {
      const A = ring(i), B = ring(i + 1);
      for (let j = 0; j + 1 < A.length; j++) {
        const mat = A[j][1] > 2.2 && i > 0 ? 'glass' : j === 0 || j === A.length - 2 ? 'skirt' : 'copper';
        b.quad(mat, V(xs[i], A[j][1], A[j][0]), V(xs[i + 1], B[j][1], B[j][0]), V(xs[i + 1], B[j + 1][1], B[j + 1][0]), V(xs[i], A[j + 1][1], A[j + 1][0]));
      }
    }
    // the front face, the lights, the coupler
    const F = ring(3), xf = xs[3];
    for (let j = 1; j + 1 < F.length; j++) b.tri(F[j][1] > 2.0 ? 'glass' : 'copper', V(xf, 1.2, 0), V(xf, F[j + 1][1], F[j + 1][0]), V(xf, F[j][1], F[j][0]));
    for (const z of [-0.85, 0.85]) b.box('lamp', [xf - 0.02, 1.15, z - 0.14], [xf + 0.03, 1.32, z + 0.14]);
    for (const z of [-1.05, 1.05]) b.box('tail', [xf - 0.02, 1.15, z - 0.06], [xf + 0.03, 1.32, z + 0.06]);
    b.box('lamp', [xf - 0.4, 2.2, -0.15], [xf - 0.35, 2.32, 0.15]);
    b.box('skirt', [xf - 0.3, 0.25, -1.2], [xf + 0.15, 0.6, 1.2]);
    b.box('steel', [xf, 0.75, -0.15], [xf + 0.45, 1.0, 0.15]);
  }
  // a Jacobs bogie at the rear (shared with the next car), the gangway bellows
  const bogie = (x) => {
    b.box('bogie', [x - 1.6, 0.25, -1.05], [x + 1.6, 0.75, 1.05]);
    for (const dx of [-1.35, 1.35]) for (const z of [-0.7175, 0.7175]) b.cylinder('steel', V(x + dx, WR, z - 0.06), V(x + dx, WR, z + 0.06), WR, WR, { segs: 14 });
  };
  bogie(-LC / 2);
  if (nose) bogie(LC / 2 - 4.0);
  b.box('bellows', [-LC / 2 - 0.36, 0.7, -1.2], [-LC / 2 + 0.36, 3.5, 1.2]);
  const g = b.build(mats());
  g.name = `traverso-${k}`;
  return g;
}

export class TrafficGL {
  constructor(stage, traffic) {
    this.stage = stage; this.traffic = traffic;
    this.group = new Group(); this.group.name = 'traffic';
    stage.scene.add(this.group);
    // one train set per scheduled train (they are never both near at once, but cheap enough)
    this.sets = traffic.trains.map(() => {
      const cars = [];
      for (let k = 0; k < CARS; k++) {
        const end = k === 0 || k === CARS - 1;
        const g = car(k, { nose: end, pantograph: k === 1 || k === CARS - 2 });
        const holder = new Group();
        holder.add(g);
        if (k === CARS - 1) g.rotation.y = Math.PI;      // the trailing cab faces the other way
        this.group.add(holder);
        cars.push(holder);
      }
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
      for (let k = 0; k < CARS; k++) {
        const front = a.s - k * LC, back = front - LC;
        const c = cars[k];
        if (back < 0 || front > P.length) { c.visible = false; continue; }
        const pose = poseOnTrack(P, front - 0.4, back + 0.4, this._p);
        c.position.set(pose.x - o.x, pose.z - o.z, -(pose.y - o.y));
        c.visible = c.position.distanceTo(cam) < 3000;
        _e.set(pose.roll, pose.yaw, pose.pitch, 'YZX');
        c.rotation.copy(_e);
      }
    });
    // the lamps inside: lit in the tunnels and on dark days (the same as the special's)
    mats().light.emissiveIntensity = 0.35;
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
