/**
 * The gauges, meters and indicators, each reading the plant the way the real one does (plant.js
 * _gauges): the depth gauges are Bourdon-tube pressure gauges graduated in feet of sea water, the
 * pit log is a pitot tube, the air gauges read pounds above the atmosphere, the electrical meters
 * read the cubicle's buses and lines. Needles have their own lag (a gauge's damping) and stop at
 * their pins. The bubble inclinometer is a curved glass tube with its bubble; the Christmas tree
 * is a board of red and green lights, one for every hull opening.
 */
import { Group, Mesh, MeshStandardMaterial, Color, CircleGeometry, BoxGeometry, CylinderGeometry, TorusGeometry, SphereGeometry, CanvasTexture, Vector3, Quaternion } from 'three';
import { DECK, LEVELS, AXIS, halfWidth, onWall } from '../data/layout.js';
import { FACE } from './controlsGL.js';

const D = DECK, CTY = LEVELS.ct.y, OBY = LEVELS.obs.y;
const _q = new Quaternion(), _z = new Vector3(0, 0, 1);

/**
 * The instruments. pos: centre of the dial (boat coordinates); face: the way the reader faces;
 * r: dial radius (m); range [min, max] over `sweep` degrees; read(g) from plant.g.
 */
export const GAUGES = [
  // ---- control room: the diving station (the board faces the planesmen, who face port)
  { id: 'dg1', label: 'DEPTH', unit: 'FEET', pos: [12.0, D + 1.85, -1.77], face: 'port', r: 0.2, min: 0, max: 165, major: 15, minor: 5, sweep: 320, read: (g) => g.depth },
  { id: 'dg2', label: 'DEPTH', unit: 'FEET', pos: [11.15, D + 1.85, -1.77], face: 'port', r: 0.2, min: 0, max: 165, major: 15, minor: 5, sweep: 320, read: (g) => g.depth },
  { id: 'dg3', label: 'DEPTH', unit: 'FEET', pos: [11.58, D + 1.95, -1.77], face: 'port', r: 0.1, min: 0, max: 600, major: 100, minor: 20, sweep: 300, red: 400, read: (g) => g.depth },
  { id: 'bowAngle', label: 'BOW PLANES', unit: 'RISE  DIVE', pos: [12.25, D + 1.42, -1.77], face: 'port', r: 0.075, min: -30, max: 30, major: 10, minor: 5, sweep: 180, centre: true, read: (g) => g.planes.bow },
  { id: 'sternAngle', label: 'STERN PLANES', unit: 'RISE  DIVE', pos: [10.92, D + 1.42, -1.77], face: 'port', r: 0.075, min: -30, max: 30, major: 10, minor: 5, sweep: 180, centre: true, read: (g) => g.planes.stern },
  { id: 'bubble', kind: 'bubble', label: 'INCLINOMETER', pos: [11.58, D + 1.55, -1.76], face: 'port', r: 0.22, read: (g) => g.pitch },
  { id: 'tree', kind: 'tree', pos: [12.9, D + 1.78, -1.84], face: 'port', r: 0.45 },
  // the steering stand: rudder angle, gyro repeater, pit log
  { id: 'rudder', label: 'RUDDER', unit: 'PORT  STBD', pos: [13.32, D + 1.15, 0.45], face: 'fwd', r: 0.08, min: -40, max: 40, major: 10, minor: 5, sweep: 180, centre: true, read: (g) => g.planes.rudder },
  { id: 'gyro', kind: 'compass', label: 'GYRO', pos: [13.32, D + 1.38, 0.45], face: 'fwd', r: 0.1, read: (g) => g.heading },
  { id: 'log', label: 'SPEED', unit: 'KNOTS', pos: [13.32, D + 1.15, 0.72], face: 'fwd', r: 0.07, min: 0, max: 25, major: 5, minor: 1, sweep: 270, read: (g) => g.speed },
  // the trim manifold's tank gauges (gallons) and the pump's discharge
  ...[['fwdTrim', 'FWD TRIM', 6500], ['fwdWRT', 'FWD W.R.T.', 1400], ['aux1', 'AUX No. 1', 8200], ['aux2', 'AUX No. 2', 8200], ['aftWRT', 'AFT W.R.T.', 1400], ['aftTrim', 'AFT TRIM', 5500], ['negative', 'NEGATIVE', 2200], ['safety', 'SAFETY', 6400]].map(([t, label, max], i) => ({
    id: `tank.${t}`, label, unit: 'GALLONS', pos: [10.55 - i * 0.155, D + 1.78, -1.84], face: 'port', r: 0.065, min: 0, max, major: max / 4, minor: max / 20, sweep: 270, read: (g) => g.tanks?.[t] ?? 0,
  })),
  { id: 'fathometer', label: 'FATHOMETER', unit: 'FEET UNDER KEEL', pos: [9.0, D + 1.6, -1.84], face: 'port', r: 0.075, min: 0, max: 600, major: 100, minor: 20, sweep: 300, red: 50, read: (g) => g.fathometer },
  { id: 'trimFlow', label: 'TRIM PUMP', unit: 'G.P.M.', pos: [9.32, D + 1.62, -1.84], face: 'port', r: 0.06, min: 0, max: 400, major: 100, minor: 20, sweep: 270, read: (g) => g.trimFlow },
  // starboard: the air banks, the manifolds, the hydraulic oil, the boat's barometer
  ...[1, 2, 3, 4, 5].map((n, i) => ({ id: `bank${n}`, label: `No. ${n} BANK`, unit: 'P.S.I.', pos: [12.8 - i * 0.24, D + 1.95, 1.84], face: 'stbd', r: 0.09, min: 0, max: 4000, major: 1000, minor: 200, sweep: 270, red: 3000, read: (g) => g.banks?.[i] ?? 0 })),
  { id: 'hpMan', label: 'H.P. MANIFOLD', unit: 'P.S.I.', pos: [11.55, D + 1.95, 1.84], face: 'stbd', r: 0.1, min: 0, max: 4000, major: 1000, minor: 200, sweep: 270, red: 3000, read: (g) => g.hpManifold },
  { id: 'p600', label: 'M.B.T. BLOW', unit: 'P.S.I.', pos: [11.0, D + 1.55, 1.84], face: 'stbd', r: 0.1, min: 0, max: 1000, major: 200, minor: 50, sweep: 270, red: 610, read: (g) => g.p600 },
  { id: 'p10', label: 'L.P. BLOW', unit: 'P.S.I.', pos: [10.15, D + 1.55, 1.84], face: 'stbd', r: 0.09, min: 0, max: 20, major: 5, minor: 1, sweep: 270, red: 13, read: (g) => g.p10 },
  { id: 'hyd', label: 'HYDRAULIC', unit: 'P.S.I.', pos: [12.75, D + 1.35, -1.71], face: 'port', r: 0.07, min: 0, max: 1000, major: 200, minor: 50, sweep: 270, red: 750, read: (g) => g.hydraulic },
  { id: 'baro', label: 'BAROMETER', unit: 'IN. HG', pos: [10.95, D + 1.95, 1.84], face: 'stbd', r: 0.09, min: 26, max: 34, major: 1, minor: 0.2, sweep: 270, read: (g) => g.barometer },
  // ---- conning tower: depth, gyro repeater, rudder, speed
  { id: 'dg4', label: 'DEPTH', unit: 'FEET', pos: [12.5, CTY + 1.55, 0.6], face: 'fwd', r: 0.1, min: 0, max: 165, major: 15, minor: 5, sweep: 320, read: (g) => g.depth },
  { id: 'ctGyro', kind: 'compass', label: 'GYRO', pos: [12.45, CTY + 1.35, 0.0], face: 'fwd', r: 0.09, read: (g) => g.heading },
  { id: 'ctRudder', label: 'RUDDER', unit: 'PORT  STBD', pos: [12.45, CTY + 1.6, 0.0], face: 'fwd', r: 0.06, min: -40, max: 40, major: 10, minor: 5, sweep: 180, centre: true, read: (g) => g.planes.rudder },
  { id: 'ctLog', label: 'SPEED', unit: 'KNOTS', pos: [12.5, CTY + 1.55, -0.6], face: 'fwd', r: 0.07, min: 0, max: 25, major: 5, minor: 1, sweep: 270, read: (g) => g.speed },
  // ---- maneuvering: the cubicle's meters (facing forward, to the operators)
  ...[['bus', 'BATTERY BUS', 0, 600, (g) => g.volts.bus, 'VOLTS'], ['port', 'PORT BUS', 0, 600, (g) => g.volts.port, 'VOLTS'], ['stbd', 'STBD BUS', 0, 600, (g) => g.volts.stbd, 'VOLTS'],
    ['ampP', 'PORT MOTORS', -6000, 6000, (g) => g.amps.port, 'AMPERES'], ['ampS', 'STBD MOTORS', -6000, 6000, (g) => g.amps.stbd, 'AMPERES'],
    ['batF', 'FWD BATTERY', -6000, 6000, (g) => g.amps.fwdBat, 'AMPERES'], ['batA', 'AFT BATTERY', -6000, 6000, (g) => g.amps.aftBat, 'AMPERES'],
    ['rpmP', 'PORT SHAFT', 0, 320, (g) => g.shaftRpm.port, 'R.P.M.'], ['rpmS', 'STBD SHAFT', 0, 320, (g) => g.shaftRpm.stbd, 'R.P.M.']].map(([k, label, min, max, read, unit], i) => ({
    id: `man.${k}`, label, unit, pos: [-28.76, D + 1.68 - (i % 2) * 0.28, -1.0 + Math.floor(i / 2) * 0.48 + (i % 2) * 0.12], face: 'aft', r: 0.1, min, max, major: (max - min) / 6, minor: (max - min) / 30, sweep: 270, centre: min < 0, read,
  })),
  ...[1, 2, 3, 4].map((n, i) => ({ id: `man.gen${n}`, label: `No. ${n} GEN.`, unit: 'AMPERES', pos: [-28.76, D + 1.3, -1.05 + i * 0.7], face: 'aft', r: 0.08, min: -1000, max: 4000, major: 1000, minor: 200, sweep: 270, read: (g) => g.amps.gen[n - 1] })),
  { id: 'man.h2', label: 'HYDROGEN', unit: '% (LEL 4)', pos: [-29.57, D + 1.55, 1.3], face: 'stbd', r: 0.07, min: 0, max: 5, major: 1, minor: 0.2, sweep: 270, red: 3, read: (g) => Math.max(...(g.batteryH2 ?? [0])) },
  // ---- the engines' gauge boards, at each control stand: tachometer, lube oil, jacket water
  ...[{ n: 1, x: -8.55, z: 0.57 }, { n: 2, x: -8.55, z: -0.57 }, { n: 3, x: -16.6, z: 0.57 }, { n: 4, x: -16.6, z: -0.57 }].flatMap((e) => [
    { id: `eng${e.n}.rpm`, label: `No. ${e.n} ENGINE`, unit: 'R.P.M.', pos: [e.x, D + 1.62, e.z], face: e.z > 0 ? 'stbd' : 'port', r: 0.075, min: 0, max: 900, major: 100, minor: 20, sweep: 270, red: 800, read: (g) => g.engines[e.n - 1].rpm },
    { id: `eng${e.n}.lube`, label: 'LUB. OIL', unit: 'P.S.I.', pos: [e.x - 0.17, D + 1.35, e.z], face: e.z > 0 ? 'stbd' : 'port', r: 0.055, min: 0, max: 60, major: 10, minor: 2, sweep: 270, read: (g) => g.engines[e.n - 1].lube },
    { id: `eng${e.n}.water`, label: 'JACKET WATER', unit: 'DEG. F.', pos: [e.x + 0.17, D + 1.35, e.z], face: e.z > 0 ? 'stbd' : 'port', r: 0.055, min: 50, max: 250, major: 50, minor: 10, sweep: 270, red: 180, read: (g) => g.engines[e.n - 1].jacket },
  ]),
  // ---- the observation deck's own small console (the owner's): depth, speed, heading, the sea's temperature
  { id: 'obs.depth', label: 'DEPTH', unit: 'FEET', pos: [-2.85, OBY + 0.85, 0.45], face: 'aft', r: 0.09, min: 0, max: 450, major: 50, minor: 10, sweep: 300, read: (g) => g.depth },
  { id: 'obs.speed', label: 'SPEED', unit: 'KNOTS', pos: [-2.85, OBY + 0.85, 0.0], face: 'aft', r: 0.07, min: 0, max: 25, major: 5, minor: 1, sweep: 270, read: (g) => g.speed },
  { id: 'obs.gyro', kind: 'compass', label: 'HEADING', pos: [-2.85, OBY + 0.85, -0.45], face: 'aft', r: 0.08, read: (g) => g.heading },
  { id: 'obs.bottom', label: 'BOTTOM', unit: 'FEET BELOW', pos: [-2.85, OBY + 0.66, 0.22], face: 'aft', r: 0.06, min: 0, max: 600, major: 100, minor: 20, sweep: 300, red: 50, read: (g) => g.fathometer },
];

function dialTexture(d) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), cx = S / 2, R = S / 2 - 4;
  g.fillStyle = '#f0ead8'; g.beginPath(); g.arc(cx, cx, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2b261d'; g.lineWidth = 5; g.stroke();
  if (d.kind === 'compass') {
    g.fillStyle = '#1b1b1b'; g.strokeStyle = '#1b1b1b';
    for (let a = 0; a < 360; a += 5) {
      const t = (a - 90) * Math.PI / 180, major = a % 30 === 0;
      g.lineWidth = major ? 3 : 1.5;
      g.beginPath(); g.moveTo(cx + Math.cos(t) * (R - (major ? 26 : 14)), cx + Math.sin(t) * (R - (major ? 26 : 14))); g.lineTo(cx + Math.cos(t) * (R - 6), cx + Math.sin(t) * (R - 6)); g.stroke();
      if (major) { g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] ?? String(a / 10); g.fillText(lab, cx + Math.cos(t) * (R - 46), cx + Math.sin(t) * (R - 46)); }
    }
  } else {
    const ang = (v) => (-d.sweep / 2 + d.sweep * (v - d.min) / (d.max - d.min)) * Math.PI / 180 - Math.PI / 2;
    if (d.red != null) { g.strokeStyle = '#b8241b'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cx, R - 16, ang(d.red), ang(d.max)); g.stroke(); }
    g.strokeStyle = '#1b1b1b'; g.fillStyle = '#1b1b1b';
    const n = Math.round((d.max - d.min) / d.minor);
    for (let i = 0; i <= n; i++) {
      const v = d.min + i * d.minor, a = ang(v), major = Math.abs((v - d.min) / d.major - Math.round((v - d.min) / d.major)) < 1e-6;
      const r0 = R - (major ? 28 : 18), r1 = R - 7;
      g.lineWidth = major ? 4 : 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); g.stroke();
      if (major) {
        // thousands are written as hundreds of the scale's own unit (the class's gauges: "x 100")
        const big = Math.max(Math.abs(d.max), Math.abs(d.min)) >= 2000;
        const txt = big ? String(Math.round(v / 100)) : String(Math.round(v * 10) / 10);
        g.font = `bold ${d.r < 0.08 ? 28 : 24}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(txt, cx + Math.cos(a) * (R - 52), cx + Math.sin(a) * (R - 52));
      }
    }
  }
  g.fillStyle = '#1b1b1b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 19px sans-serif'; g.fillText(d.label ?? '', cx, cx + 50);
  const big = d.kind !== 'compass' && Math.max(Math.abs(d.max ?? 0), Math.abs(d.min ?? 0)) >= 2000;
  g.font = '15px sans-serif'; g.fillText((d.unit ?? '') + (big ? ' x 100' : ''), cx, cx + 72);
  const t = new CanvasTexture(c);
  t.colorSpace = 'srgb';
  t.anisotropy = 8;
  return t;
}

export class InstrumentsGL {
  constructor() {
    this.group = new Group();
    this.brass = new MeshStandardMaterial({ color: new Color(0.78, 0.6, 0.3), roughness: 0.28, metalness: 1.0 });
    this.black = new MeshStandardMaterial({ color: new Color('#111'), roughness: 0.4 });
    this.needleMat = new MeshStandardMaterial({ color: new Color('#111'), roughness: 0.4 });
    this.redMat = new MeshStandardMaterial({ color: new Color('#b0281e'), roughness: 0.4 });
    this.lightOn = { red: new MeshStandardMaterial({ color: new Color(0.3, 0.02, 0.02), emissive: new Color(1, 0.08, 0.04), emissiveIntensity: 0.6 }), green: new MeshStandardMaterial({ color: new Color(0.02, 0.3, 0.05), emissive: new Color(0.1, 1, 0.2), emissiveIntensity: 0.45 }), off: new MeshStandardMaterial({ color: new Color(0.05, 0.05, 0.05), roughness: 0.3 }) };
    this.items = GAUGES.map((d) => this._make(d));
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  }

  _mount(d) {
    const m = new Group();
    const p = [...d.pos];
    const f = FACE[d.face] ?? FACE.fwd;
    const n = new Vector3(-f[0], -f[1], -f[2]);
    // on the hull's side: onto its curve, facing along its inward normal
    const onMain = p[1] < DECK + 2.6 && p[1] > DECK - 0.1 && Math.abs(p[2]) > 0.9;
    if (onMain && Math.abs(p[2]) > halfWidth(p[0], p[1]) - 0.22) {
      // on a board on the hull's side: out along the plating's normal, proud of the board's face
      const w = onWall(p[0], p[1], Math.sign(p[2]), 0.19);
      p[1] = w.pos[1]; p[2] = w.pos[2];
      n.set(...w.normal);
    }
    m.position.set(...p);
    _q.setFromUnitVectors(_z, n);
    m.quaternion.copy(_q);
    this.group.add(m);
    return m;
  }

  _make(d) {
    const m = this._mount(d);
    const r = d.r;
    if (d.kind === 'bubble') {
      // a curved glass tube on a white board, a black bubble that runs to the high end
      m.add(new Mesh(new BoxGeometry(r * 2.2, r * 0.5, 0.01), new MeshStandardMaterial({ color: new Color('#ece6d2'), roughness: 0.5 })));
      m.add(new Mesh(new TorusGeometry(r * 3, 0.012, 8, 40, 0.75).rotateZ(Math.PI / 2 - 0.375).translate(0, -r * 2.85, 0.01), new MeshStandardMaterial({ color: new Color(0.6, 0.65, 0.5), roughness: 0.1 })));
      const bubble = new Mesh(new SphereGeometry(0.014, 10, 8), this.black);
      m.add(bubble);
      return { d, m, bubble, v: 0 };
    }
    if (d.kind === 'tree') {
      // the hull opening indicator: two rows of lights on a black board
      m.add(new Mesh(new BoxGeometry(r * 2, r * 0.9, 0.02), this.black));
      const lights = [];
      for (let i = 0; i < 26; i++) {
        const L = new Mesh(new CylinderGeometry(0.012, 0.012, 0.01, 10).rotateX(Math.PI / 2).translate(-r * 0.9 + (i % 13) * r * 0.15, i < 13 ? r * 0.18 : -r * 0.18, 0.015), this.lightOn.off);
        m.add(L); lights.push(L);
      }
      return { d, m, lights };
    }
    m.add(new Mesh(new CircleGeometry(r, 40), new MeshStandardMaterial({ map: dialTexture(d), roughness: 0.3 })));
    m.add(new Mesh(new TorusGeometry(r * 1.02, r * 0.07, 8, 32), this.brass));
    m.add(new Mesh(new CylinderGeometry(r * 1.05, r * 1.05, r * 0.3, 32).rotateX(Math.PI / 2).translate(0, 0, -r * 0.16), this.brass));
    const needle = new Group();
    needle.position.z = 0.004;
    needle.add(new Mesh(new BoxGeometry(r * 0.05, r * 0.85, 0.002).translate(0, r * 0.38, 0), d.kind === 'compass' ? this.redMat : this.needleMat));
    needle.add(new Mesh(new CircleGeometry(r * 0.07, 12).translate(0, 0, 0.002), this.needleMat));
    m.add(needle);
    return { d, m, needle, v: d.min ?? 0 };
  }

  /** Reads the plant's gauges; the needles follow with a little lag. */
  update(plant, dt) {
    const g = plant.g;
    if (!g.depth && g.depth !== 0) return;
    const k = Math.min(1, dt * 4);
    for (const it of this.items) {
      const d = it.d;
      if (d.kind === 'tree') {
        const board = g.board ?? [];
        it.lights.forEach((L, i) => { const b = board[i]; L.material = !b ? this.lightOn.off : b.open ? this.lightOn.red : this.lightOn.green; });
        continue;
      }
      let v = d.read(g);
      if (!Number.isFinite(v)) v = 0;
      if (d.kind === 'bubble') {
        it.v += (Math.max(-12, Math.min(12, v)) - it.v) * k;
        // the bubble runs uphill: bow up, it runs forward (toward the reader's right, facing port)
        const a = (it.v / 12) * 0.36;
        it.bubble.position.set(Math.sin(a) * d.r * 3, -d.r * 2.85 + Math.cos(a) * d.r * 3 + 0.0, 0.016);
        continue;
      }
      if (d.kind === 'compass') {
        // the card turns so the heading sits under the lubber's line at the top
        let dv = ((v - it.v + 540) % 360) - 180;
        it.v = (it.v + dv * k + 360) % 360;
        it.m.children[0].rotation.z = (it.v * Math.PI) / 180;
        it.needle.rotation.z = 0;
        continue;
      }
      const lo = d.min - (d.max - d.min) * 0.02, hi = d.max + (d.max - d.min) * 0.02;
      it.v += (Math.max(lo, Math.min(hi, v)) - it.v) * k;
      const a = (-d.sweep / 2 + d.sweep * (it.v - d.min) / (d.max - d.min)) * Math.PI / 180;
      it.needle.rotation.z = -a;
    }
  }
}
