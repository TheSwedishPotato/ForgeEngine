/**
 * A car as the workshop sees it: a list of real parts, each with its part number, mass, price,
 * condition, the fasteners that hold it and the parts in the way of it, and the shapes it is
 * drawn with. Built from the car's spec (data/cars.js), so the same model drives the physics, the
 * order things come apart in, what a measurement reads and what the 3D model looks like.
 *
 * Car frame: origin on the ground midway between the axles, +Z forward, +X the car's left, +Y up.
 *
 * A part can be taken off (or put on) when every part in its `blockers` is off and every fastener
 * holding it is out; some also `need` a state of the car (the corner off the ground, the bonnet
 * open, the electric parking brake wound back). Clipped parts (`clip`) come off by hand.
 */
import { makeFastener } from '../sim/fastener.js';
import { buildF1 } from './f1.js';

// shapes, in the part's own frame (metres); m: material name (render/mats.js)
export const B = (w, h, d, p = [0, 0, 0], m = 'steel', r) => ({ t: 'box', s: [w, h, d], p, m, r });
export const C = (rad, len, p = [0, 0, 0], ax = 'y', m = 'steel', o = {}) => ({ t: 'cyl', rad, len, p, ax, m, ...o });
export const T = (pts, rad, m = 'hose', o = {}) => ({ t: 'tube', pts, rad, m, ...o });
export const S = (rad, p = [0, 0, 0], m = 'steel', o = {}) => ({ t: 'sph', rad, p, m, ...o });
export const L = (prof, p = [0, 0, 0], ax = 'y', m = 'steel', o = {}) => ({ t: 'lathe', prof, p, ax, m, ...o });
export const TOR = (R, rad, p = [0, 0, 0], ax = 'y', m = 'rubber', o = {}) => ({ t: 'torus', R, rad, p, ax, m, ...o });

let PN = 1000;
const partNo = (prefix) => `${prefix}-${(PN++).toString().padStart(5, '0')}`;

export class Assembly {
  constructor(spec, { paint = spec.paint[0], mileage = 150000, rand = Math.random } = {}) {
    this.spec = spec; this.paint = paint; this.mileage = mileage; this.rand = rand;
    this.parts = new Map(); this.fasteners = new Map();
    this.items = [];            // foreign objects someone left in the car
    this.state = {
      raised: { FL: false, FR: false, RL: false, RR: false },
      hoodOpen: false, hoodLatch: false, trunkOpen: false, doors: {},
      epbService: false, ignition: 0, handbrake: true, gear: 0, brakePedal: 0, throttle: 0,
      externalStarter: false, heaterCart: false, ersSafe: true,
    };
    if (spec.body === 'f1') buildF1(this); else buildRoadCar(this);
    this.ageTo(mileage);
  }

  add(p) {
    const part = {
      id: p.id, name: p.name, kind: p.kind ?? p.id, sys: p.sys ?? 'body', partNo: p.partNo ?? partNo(p.sys?.slice(0, 2).toUpperCase() ?? 'XX'),
      price: p.price ?? 0, mass: p.mass ?? 1, pos: p.pos ?? [0, 0, 0], rot: p.rot ?? [0, 0, 0], g: p.g ?? [],
      fasteners: [], blockers: p.blockers ?? [], need: p.need ?? [], cond: p.cond ?? {}, fixed: !!p.fixed, clip: !!p.clip,
      hinge: p.hinge ?? null, corner: p.corner ?? null, cyl: p.cyl ?? null, side: p.side ?? null, panel: p.panel ?? null,
      parent: p.parent ?? null, info: p.info ?? '', removed: false, installedNew: false, hangs: p.hangs ?? null, label: p.label ?? null,
      spare: p.spare ?? true,
    };
    for (const f of p.fasteners ?? []) {
      const fa = makeFastener({ ...f, id: `${p.id}.${f.id}`, partId: p.id, seize: f.seize ?? 0 });
      this.fasteners.set(fa.id, fa); part.fasteners.push(fa.id);
    }
    this.parts.set(part.id, part);
    return part;
  }

  part(id) { return this.parts.get(id); }
  fast(id) { return this.fasteners.get(id); }
  installed(id) { const p = this.parts.get(id); return !!p && !p.removed; }
  byKind(kind) { return [...this.parts.values()].filter((p) => p.kind === kind); }

  /** What stops this part coming off (or going on) right now: [] if nothing. */
  obstacles(id) {
    const p = this.parts.get(id), why = [];
    if (!p) return ['no such part'];
    if (p.fixed) why.push(`${p.name} is not a part you take off here`);
    for (const b of p.blockers) if (this.installed(b)) why.push(`${this.parts.get(b).name} is in the way`);
    for (const n of p.need) {
      if (n === 'raised' && p.corner && !this.state.raised[p.corner]) why.push(`the ${CORNER_NAME[p.corner]} wheel is on the ground: lift the car`);
      if (n === 'hood' && !this.state.hoodOpen) why.push('the bonnet is shut');
      if (n === 'trunk' && !this.state.trunkOpen) why.push('the boot is shut');
      if (n === 'epb' && !this.state.epbService) why.push('the electric parking brake holds the piston out: wind it back in service mode with the scan tool');
      if (n === 'ers' && !this.state.ersSafe) why.push('the ERS is live (the light is red): isolate the high-voltage system first');
      if (n === 'batteryOff' && this.installed('battery') && !this.fast('battery.neg')?.out) why.push('disconnect the battery (negative terminal) first');
    }
    return why;
  }

  /** Fasteners still holding the part (in the hole). */
  holding(id) { return this.parts.get(id).fasteners.map((f) => this.fasteners.get(f)).filter((f) => !f.out && !f.snapped); }

  canRemove(id) { const p = this.parts.get(id); return !!p && !p.removed && this.obstacles(id).length === 0 && this.holding(id).length === 0; }
  remove(id) { if (!this.canRemove(id)) return false; this.parts.get(id).removed = true; this.onChange?.(id, 'removed'); return true; }

  /** Puts a part (the old one back, or a new one: newCond) in its place. Its fasteners then need doing up. */
  install(id, newCond = null) {
    const p = this.parts.get(id);
    if (!p || !p.removed || this.obstacles(id).length) return false;
    p.removed = false;
    if (newCond) { p.cond = structuredClone(newCond); p.installedNew = true; }
    this.onChange?.(id, 'installed');
    return true;
  }

  /** Wear the car to its mileage: pads, discs, tyres, plugs and the oil as a car of that age has them. */
  ageTo(km) {
    const r = this.rand;
    for (const p of this.parts.values()) {
      const c = p.cond;
      if (p.kind === 'pad') c.mm = Math.max(4.5, c.mm - (0.25 + r() * 0.5) * c.mm * 0.6);
      if (p.kind === 'disc') c.t = c.t - (c.t - c.min) * (0.15 + r() * 0.35);
      if (p.kind === 'wheel') c.tread = Math.max(4.2, c.tread - r() * 2.5);
      if (p.kind === 'plug') c.gap = c.gap + r() * 0.08;
      if (p.kind === 'wiper') c.wear = 0.2 + r() * 0.3;
    }
    for (const f of this.fasteners.values()) if (/wheel|caliper|carrier|exhaust|drain|link|o2/.test(f.partId) && r() < Math.min(0.6, km / 400000)) f.seize = f.spec * (0.2 + r() * 0.9);
  }

  /** Everything a work order needs: what was changed, what fasteners are not right. */
  audit() {
    const changed = [...this.parts.values()].filter((p) => p.installedNew).map((p) => p.id);
    const missing = [...this.parts.values()].filter((p) => p.removed && !p.fixed).map((p) => p.id);
    const bad = [];
    for (const f of this.fasteners.values()) {
      const p = this.parts.get(f.partId);
      if (!p || p.removed) continue;
      const j = judgeLite(f);
      if (j !== 'ok') bad.push({ id: f.id, part: p.name, name: f.name, j, torque: Math.round(f.clamp), spec: f.spec });
    }
    return { changed, missing, bad };
  }
}

function judgeLite(f) {
  if (f.out || f.lost) return 'missing';
  if (f.snapped) return 'snapped';
  if (f.engaged < f.len - 1e-3) return 'loose';
  const r = f.clamp / f.spec;
  return r < 0.85 ? 'loose' : r > 1.3 ? 'over-tightened' : 'ok';
}

export const CORNER_NAME = { FL: 'front left', FR: 'front right', RL: 'rear left', RR: 'rear right' };
export const CORNERS = ['FL', 'FR', 'RL', 'RR'];

// -------------------------------------------------------------------------------------------------
// A road car with its engine in front (the Volvo 240 and the Golf VII)

function buildRoadCar(A) {
  const s = A.spec, d = s.dims, W = s.wheels, e = s.engine;
  const zF = d.wheelbase / 2, zR = -d.wheelbase / 2;
  const volvo = s.id === 'volvo240';
  const lay = volvo
    ? { engZ: zF - 0.12, engY: 0.48, hoodY: 0.92, fire: zF - 0.62, radZ: zF + 0.62, batt: [0.5, 0.62, zF - 0.45], air: [-0.48, 0.66, zF + 0.32], resv: [-0.42, 0.8, zF - 0.5], fuse: [0.3, 0.55, zF - 0.95], exp: [0.55, 0.72, zF - 0.1], diag: [0.62, 0.72, zF + 0.15] }
    : { engZ: zF + 0.12, engY: 0.42, hoodY: 0.88, fire: zF - 0.42, radZ: zF + 0.7, batt: [0.5, 0.6, zF + 0.05], air: [0.25, 0.72, zF + 0.5], resv: [0.48, 0.8, zF - 0.32], fuse: [0.62, 0.62, zF - 0.95], exp: [-0.5, 0.74, zF + 0.05], obd: [0.38, 0.5, zF - 1.0] };
  A.layout = lay;
  const rimR = (W.rim * 0.0254) / 2;

  // ---- the shell and its panels (shaped by car/body.js from the spec)
  A.add({ id: 'body', name: 'Body shell', kind: 'body', sys: 'body', fixed: true, mass: 280, panel: 'shell', cond: { rust: volvo ? 0.25 : 0.02 } });
  A.add({ id: 'hood', name: 'Bonnet', kind: 'hood', sys: 'body', fixed: true, mass: 14, panel: 'hood', hinge: { kind: 'hood', max: volvo ? 1.25 : 1.05 } });
  A.add({ id: 'trunk', name: volvo ? 'Boot lid' : 'Tailgate', kind: 'trunk', sys: 'body', fixed: true, mass: 11, panel: 'trunk', hinge: { kind: 'trunk', max: volvo ? 1.2 : 1.35 } });
  const doorList = volvo ? ['FL', 'FR', 'RL', 'RR'] : ['FL', 'FR', 'RL', 'RR'];
  for (const k of doorList) { A.add({ id: 'door' + k, name: `${CORNER_NAME[k]} door`, kind: 'door', sys: 'body', fixed: true, mass: 22, panel: 'door' + k, side: k[1], hinge: { kind: 'door', max: 1.15 } }); A.state.doors[k] = 0; }
  A.add({ id: 'bumperF', name: 'Front bumper', kind: 'bumper', sys: 'body', fixed: true, panel: 'bumperF' });
  A.add({ id: 'bumperR', name: 'Rear bumper', kind: 'bumper', sys: 'body', fixed: true, panel: 'bumperR' });

  // ---- the four corners
  for (const k of CORNERS) corner(A, k, k[0] === 'F' ? zF : zR, k[0] === 'F' ? d.trackF : d.trackR, rimR, volvo);

  // ---- the engine and what hangs on it
  engineBay(A, lay, volvo);
  cabin(A, lay, volvo, zF);
  underbody(A, volvo, zF, zR);
  lights(A, volvo, zF, zR);
}

function corner(A, k, z, track, rimR, volvo) {
  const s = A.spec, W = s.wheels, axle = k[0], side = k[1], sx = side === 'L' ? 1 : -1;
  const x = (sx * track) / 2, y = W.tyreR, Bk = s.brakes[axle];
  const hubFace = x - sx * 0.035;          // where the wheel's back face sits
  const wid = W.tyreW;
  // the wheel: rim and tyre, its nuts (or bolts) on the stud circle
  const pcdR = (Number(W.pcd.split('x')[1]) / 1000) / 2;
  const fasten = [];
  for (let i = 0; i < W.n; i++) {
    const a = (i / W.n) * Math.PI * 2 + 0.3;
    fasten.push({ id: 'n' + (i + 1), name: `wheel ${W.fastener} ${i + 1}`, size: W.size, torque: W.torque, len: 7, thread: W.thread, stiffness: W.torque / 30, pos: [sx * 0.012, Math.sin(a) * pcdR, Math.cos(a) * pcdR], axis: [sx, 0, 0] });
  }
  const tyreProf = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12, a = Math.PI * (t - 0.5); tyreProf.push([rimR + 0.005 + (W.tyreR - rimR) * (0.55 + 0.45 * Math.cos(a) ** 0.35), (wid / 2) * Math.sin(a) * 1.04]); }
  A.add({
    id: 'wheel' + k, name: `${CORNER_NAME[k]} wheel and tyre`, kind: 'wheel', sys: 'wheel', corner: k, side, mass: volvo ? 17 : 19, price: volvo ? 1150 : 1390,
    pos: [x + sx * 0.06, y, z], need: ['raised'], fasteners: fasten, partNo: W.tyre,
    cond: { bar: s.wheels.pressure[axle], tread: 7.5, nail: false, leak: 0, imbalance: 0, season: 'summer', age: 4 },
    g: [
      { t: 'lathe', prof: tyreProf, p: [sx * 0.0, 0, 0], ax: 'x', m: volvo ? 'tyreVolvo' : 'tyreGolf', seg: 56 },
      L([[rimR, -wid / 2 + 0.01], [rimR - 0.012, -wid / 2 + 0.005], [rimR - 0.012, wid / 2 - 0.005], [rimR, wid / 2 - 0.01]], [0, 0, 0], 'x', volvo ? 'rimSilver' : 'rimAlu', { seg: 40, open: true }),
      C(rimR - 0.012, 0.012, [sx * 0.02, 0, 0], 'x', volvo ? 'rimSilver' : 'rimAlu', { seg: 32 }),
      // the face of the wheel: the 240's many-spoked alloy, the Golf's five double spokes (from the reference photos)
      ...(volvo
        ? [...[...Array(10).keys()].map((i) => { const a = (i / 10) * Math.PI * 2; return B(0.022, rimR - 0.085, 0.016, [sx * 0.034, Math.sin(a) * (rimR / 2 + 0.03), Math.cos(a) * (rimR / 2 + 0.03)], 'rimSilver', [a, 0, 0]); }),
          TOR(rimR - 0.03, 0.012, [sx * 0.03, 0, 0], 'x', 'rimSilver', { seg: 40 }), C(0.07, 0.03, [sx * 0.04, 0, 0], 'x', 'rimSilver', { seg: 24 }), C(0.032, 0.012, [sx * 0.058, 0, 0], 'x', 'blackPlastic', { seg: 20 })]
        : [...[...Array(10).keys()].map((i) => { const a = (Math.floor(i / 2) / 5) * Math.PI * 2 + (i % 2 ? 0.16 : -0.16); return B(0.02, rimR - 0.065, 0.016, [sx * 0.036, Math.sin(a) * (rimR / 2 + 0.025), Math.cos(a) * (rimR / 2 + 0.025)], 'rimAlu', [a, 0, 0]); }),
          C(0.068, 0.03, [sx * 0.042, 0, 0], 'x', 'rimAlu', { seg: 24 }), C(0.03, 0.01, [sx * 0.06, 0, 0], 'x', 'chrome', { seg: 20 })]),
      C(0.004, 0.035, [sx * 0.03, rimR - 0.03, 0.03], 'x', 'rubber'),      // the valve
    ],
  });
  // the disc
  const D = Bk.disc;
  const dprof = D.vent ? [[0.075, -D.t / 2], [D.d / 2, -D.t / 2], [D.d / 2, D.t / 2], [0.075, D.t / 2]] : [[0.075, -D.t / 2], [D.d / 2, -D.t / 2], [D.d / 2, D.t / 2], [0.075, D.t / 2]];
  const discX = hubFace - sx * 0.03;
  // ---- the caliper: Volvo's fixed calipers (pads out past their pins), the Golf's floating ones on a carrier
  const calY = 0, calZ = axle === 'F' ? -(D.d / 2 - 0.03) : (D.d / 2 - 0.03);
  const fixed = Bk.caliper === 'fixed';
  const blockersDisc = ['wheel' + k, 'caliper' + k];
  if (!fixed) blockersDisc.push('carrier' + k);
  A.add({
    id: 'disc' + k, name: `${CORNER_NAME[k]} brake disc`, kind: 'disc', sys: 'brake', corner: k, side, mass: D.vent ? 6.2 : 4.1, price: axle === 'F' ? 690 : 540,
    pos: [discX, y, z], blockers: blockersDisc, need: ['raised'], partNo: `${Math.round(D.d * 1000)}x${(D.t * 1000).toFixed(1)}`,
    fasteners: volvo ? [] : [{ id: 'screw', name: 'disc retaining screw', size: 30, drive: 'torx', torque: 4, len: 3, pos: [sx * 0.008, 0.05, 0], axis: [sx, 0, 0] }],
    cond: { t: D.t * 1000, min: D.min * 1000, runout: 0.02, nominal: D.t * 1000, rust: 0.2 },
    g: [L(dprof, [0, 0, 0], 'x', 'brakeDisc', { seg: 40 }), C(0.078, 0.045, [sx * 0.02, 0, 0], 'x', 'castIron', { seg: 32 })],
  });
  const calG = [B(0.05, 0.11, 0.07, [0, 0, 0], fixed ? 'caliperPaint' : 'castIron'), B(0.03, 0.09, 0.05, [-sx * 0.035, 0, 0], fixed ? 'caliperPaint' : 'castIron')];
  const padNeed = ['raised'];
  if (axle === 'R' && A.spec.brakes.epb) padNeed.push('epb');
  if (fixed) {
    const cb = Bk.caliperBolt;
    A.add({ id: 'caliper' + k, name: `${CORNER_NAME[k]} brake caliper (${Bk.pistons}-piston)`, kind: 'caliper', sys: 'brake', corner: k, side, mass: axle === 'F' ? 3.4 : 2.2, price: axle === 'F' ? 1890 : 1450,
      pos: [discX, y + calY, z + calZ], blockers: ['wheel' + k], need: ['raised'], hangs: 'hose' + k,
      fasteners: [{ id: 'b1', name: 'caliper bolt (upper)', size: cb.size, torque: cb.torque, len: 6, pos: [-sx * 0.045, 0.045, 0], axis: [-sx, 0, 0] }, { id: 'b2', name: 'caliper bolt (lower)', size: cb.size, torque: cb.torque, len: 6, pos: [-sx * 0.045, -0.045, 0], axis: [-sx, 0, 0] }],
      cond: { seized: false, leak: false }, g: calG });
    A.add({ id: 'pins' + k, name: `${CORNER_NAME[k]} pad retaining pins`, kind: 'padPins', sys: 'brake', corner: k, side, mass: 0.05, price: 65, clip: true,
      pos: [discX, y + calY, z + calZ * 1.25], blockers: ['wheel' + k], need: ['raised'], g: [C(0.003, 0.08, [0, 0.015, 0], 'x', 'chrome'), C(0.003, 0.08, [0, -0.015, 0], 'x', 'chrome')], info: 'Knocked out with a pin punch, then the anti-rattle spring comes free' });
  } else {
    const gb = Bk.guideBolt, cb = Bk.carrierBolt;
    A.add({ id: 'caliper' + k, name: `${CORNER_NAME[k]} brake caliper${axle === 'R' && A.spec.brakes.epb ? ' (with parking brake motor)' : ''}`, kind: 'caliper', sys: 'brake', corner: k, side, mass: axle === 'F' ? 2.6 : 2.4, price: axle === 'F' ? 1590 : 2890,
      pos: [discX - sx * 0.01, y + calY, z + calZ], blockers: ['wheel' + k], need: padNeed, hangs: 'hose' + k,
      fasteners: [{ id: 'g1', name: 'guide bolt (upper)', size: gb.size, torque: gb.torque, len: 5, pos: [-sx * 0.04, 0.05, 0], axis: [-sx, 0, 0] }, { id: 'g2', name: 'guide bolt (lower)', size: gb.size, torque: gb.torque, len: 5, pos: [-sx * 0.04, -0.05, 0], axis: [-sx, 0, 0] }],
      cond: { seized: false, leak: false }, g: [...calG, ...(axle === 'R' && A.spec.brakes.epb ? [C(0.03, 0.09, [-sx * 0.06, 0, 0.02], 'x', 'blackPlastic')] : [])] });
    A.add({ id: 'carrier' + k, name: `${CORNER_NAME[k]} caliper carrier`, kind: 'carrier', sys: 'brake', corner: k, side, mass: 1.1, price: 640,
      pos: [discX, y + calY, z + calZ * 0.92], blockers: ['wheel' + k, 'caliper' + k, 'padI' + k, 'padO' + k], need: ['raised'],
      fasteners: [{ id: 'c1', name: 'carrier bolt (upper)', size: cb.size, torque: cb.torque, len: 6, pos: [-sx * 0.05, 0.065, 0], axis: [-sx, 0, 0] }, { id: 'c2', name: 'carrier bolt (lower)', size: cb.size, torque: cb.torque, len: 6, pos: [-sx * 0.05, -0.065, 0], axis: [-sx, 0, 0] }],
      g: [B(0.06, 0.16, 0.02, [0, 0, calZ > 0 ? -0.02 : 0.02], 'castIron')] });
  }
  for (const io of ['I', 'O']) {
    const ox = (io === 'O' ? sx : -sx) * (D.t / 2 + 0.008);
    A.add({ id: `pad${io}${k}`, name: `${CORNER_NAME[k]} brake pad (${io === 'O' ? 'outer' : 'inner'})`, kind: 'pad', sys: 'brake', corner: k, side, mass: 0.35, price: axle === 'F' ? 290 : 240,
      pos: [discX + ox, y + calY, z + calZ * 0.95], blockers: fixed ? ['pins' + k, 'wheel' + k] : ['caliper' + k, 'wheel' + k], need: padNeed,
      cond: { mm: Bk.padMM, nominal: Bk.padMM, glazed: false, squealer: !volvo || axle === 'F' }, clip: true,
      g: [B(0.012, 0.05, 0.1, [0, 0, 0], 'padFriction'), B(0.004, 0.052, 0.104, [(io === 'O' ? sx : -sx) * 0.007, 0, 0], 'steel')] });
  }
  // what the brakes hang from, and where a caliper is hung when it is off
  A.add({ id: 'hose' + k, name: `${CORNER_NAME[k]} flexible brake hose`, kind: 'hose', sys: 'brake', corner: k, side, mass: 0.15, price: 210, fixed: true,
    pos: [x - sx * 0.12, y + 0.12, z], cond: { cracked: false, leak: false }, g: [T([[0, 0, 0], [sx * 0.04, 0.05, calZ * 0.3], [sx * 0.09, -0.02, calZ * 0.8]], 0.006, 'rubber')] });
  // hub, knuckle, strut or axle
  A.add({ id: 'hub' + k, name: `${CORNER_NAME[k]} wheel hub and bearing`, kind: 'hub', sys: 'susp', corner: k, side, mass: 2.6, price: 1490, pos: [hubFace - sx * 0.02, y, z],
    blockers: ['disc' + k, ...(fixed ? ['caliper' + k] : ['carrier' + k])], need: ['raised'], fixed: volvo,
    fasteners: volvo ? [] : [1, 2, 3, 4].map((i) => ({ id: 'h' + i, name: `hub bolt ${i}`, size: 18, drive: 'hex', torque: 70, angle: 90, len: 5, pos: [-sx * 0.04, Math.sin(i * 1.57 + 0.78) * 0.05, Math.cos(i * 1.57 + 0.78) * 0.05], axis: [-sx, 0, 0] })),
    cond: { play: 0, rough: 0 }, g: [C(0.065, 0.06, [0, 0, 0], 'x', 'castIron', { seg: 24 }), C(0.028, 0.08, [sx * 0.03, 0, 0], 'x', 'steel', { seg: 16 })] });
  A.add({ id: 'knuckle' + k, name: axle === 'F' ? `${CORNER_NAME[k]} steering knuckle` : `${CORNER_NAME[k]} ${volvo ? 'axle end' : 'stub axle carrier'}`, kind: 'knuckle', sys: 'susp', corner: k, side, fixed: true,
    pos: [hubFace - sx * 0.08, y, z], g: [B(0.05, 0.3, 0.09, [0, 0, 0], 'castIron'), B(0.04, 0.06, 0.18, [0, -0.12, axle === 'F' ? -0.05 : 0], 'castIron')] });
  if (axle === 'F' || !volvo) {
    // strut (front) or shock absorber with its spring
    const top = (axle === 'F' ? (volvo ? 0.8 : 0.76) : 0.62) - y;      // the top mount's height above the hub (absolute ~0.8 m under the bonnet)
    A.add({ id: 'strut' + k, name: `${CORNER_NAME[k]} ${axle === 'F' ? 'strut' : 'shock absorber'}`, kind: 'strut', sys: 'susp', corner: k, side, fixed: true, pos: [hubFace - sx * 0.14, y, z - (axle === 'F' ? 0.02 : 0.08)],
      cond: { leak: false }, g: [C(0.026, top - 0.08, [0, (top - 0.08) / 2 + 0.05, 0], 'y', 'paintBlack'), C(0.011, 0.25, [0, top - 0.05, 0], 'y', 'chrome'),
        { t: 'spring', R: 0.065, rad: 0.0065, turns: 5.5, len: top * 0.48, p: [0, top * 0.42, 0], m: 'springPaint' }] });
  }
  if (axle === 'F') {
    A.add({ id: 'arm' + k, name: `${CORNER_NAME[k]} lower control arm`, kind: 'arm', sys: 'susp', corner: k, side, fixed: true, pos: [hubFace - sx * 0.08, y - 0.15, z],
      cond: { bush: 0 }, g: [T([[0, 0, 0], [-sx * 0.25, 0.02, 0.08], [-sx * 0.38, 0.03, 0.12]], 0.018, 'paintBlack'), T([[-sx * 0.05, 0, 0], [-sx * 0.3, 0.03, -0.25]], 0.016, 'paintBlack')] });
    A.add({ id: 'balljoint' + k, name: `${CORNER_NAME[k]} lower ball joint`, kind: 'balljoint', sys: 'susp', corner: k, side, mass: 0.6, price: volvo ? 420 : 560, pos: [hubFace - sx * 0.08, y - 0.15, z], need: ['raised'],
      blockers: ['wheel' + k], fixed: volvo,
      fasteners: volvo ? [] : [{ id: 'pinch', name: 'pinch bolt nut', size: 16, torque: 60, len: 5, pos: [0, 0.05, 0.03], axis: [0, 0, 1] }, ...[1, 2, 3].map((i) => ({ id: 'a' + i, name: `ball joint to arm nut ${i}`, size: 13, torque: 60, len: 4, pos: [-sx * (0.03 + i * 0.02), -0.01, 0], axis: [0, -1, 0] }))],
      cond: { play: 0 }, g: [S(0.026, [0, 0, 0], 'steel'), C(0.02, 0.03, [0, 0.03, 0], 'y', 'rubber')] });
    A.add({ id: 'link' + k, name: `${CORNER_NAME[k]} anti-roll bar link`, kind: 'link', sys: 'susp', corner: k, side, mass: 0.4, price: volvo ? 260 : 340, pos: [hubFace - sx * 0.18, y + 0.02, z - 0.08], need: ['raised'], blockers: ['wheel' + k],
      fasteners: [{ id: 'top', name: 'link nut (top)', size: volvo ? 13 : 16, torque: volvo ? 40 : 65, len: 4, pos: [0, 0.12, 0], axis: [-sx, 0, 0] }, { id: 'bot', name: 'link nut (bottom)', size: volvo ? 13 : 16, torque: volvo ? 40 : 65, len: 4, pos: [0, -0.1, 0], axis: [-sx, 0, 0] }],
      cond: { play: 0 }, g: [C(0.009, 0.24, [0, 0.01, 0], 'y', 'steel'), S(0.02, [0, 0.12, 0], 'blackPlastic'), S(0.02, [0, -0.1, 0], 'blackPlastic')] });
    A.add({ id: 'tierod' + k, name: `${CORNER_NAME[k]} track rod end`, kind: 'tierod', sys: 'steer', corner: k, side, fixed: true, pos: [hubFace - sx * 0.2, y - 0.04, z - 0.14],
      cond: { play: 0 }, g: [T([[0, 0, 0], [-sx * 0.25, 0, 0.01]], 0.011, 'steel')] });
    if (s.drive === 'FWD') {
      A.add({ id: 'cvboot' + k, name: `${CORNER_NAME[k]} outer CV joint boot`, kind: 'cvboot', sys: 'drive', corner: k, side, mass: 0.3, price: 320, pos: [hubFace - sx * 0.1, y, z], need: ['raised'], blockers: ['wheel' + k], clip: true,
        cond: { torn: false, grease: 1 }, info: 'A split boot: cut off the old one, fit the new around the shaft, close it and band it', g: [L([[0.045, -0.04], [0.04, -0.02], [0.034, 0], [0.03, 0.02], [0.022, 0.05]], [0, 0, 0], 'x', 'rubber', { seg: 24, open: true })] });
      A.add({ id: 'shaft' + k, name: `${CORNER_NAME[k]} drive shaft`, kind: 'driveshaft', sys: 'drive', corner: k, side, fixed: true, pos: [hubFace - sx * 0.1, y, z], g: [C(0.014, Math.abs(x) - 0.25, [-sx * (Math.abs(x) - 0.25) / 2, 0, 0], 'x', 'steel')] });
    }
  }
}

function engineBay(A, lay, volvo) {
  const s = A.spec, e = s.engine, EZ = lay.engZ, EY = lay.engY;
  // the engine: block, head, cam cover, sump, the timing cover in front; along the car (Volvo) or across it (Golf)
  const lon = e.longitudinal, len = volvo ? 0.56 : 0.48, cylPitch = volvo ? 0.11 : 0.082;
  const ax = (a, b) => (lon ? [0, a, b] : [b, a, 0]);     // place along the crank axis
  const dim = (w, h, l) => (lon ? [w, h, l] : [l, h, w]);
  const BB = (w, h, l, p, m) => ({ t: 'box', s: dim(w, h, l), p, m });
  A.add({ id: 'engine', name: `${e.code} engine (${(Math.PI / 4 * e.bore ** 2 * e.stroke * e.cyl * 1000).toFixed(1)} l)`, kind: 'engine', sys: 'engine', fixed: true, mass: volvo ? 150 : 104,
    pos: [0, EY, EZ], rot: volvo ? [0, 0, -0.2] : [0, 0, 0],
    cond: { oil: e.oil.capacity, oilAge: 12000, oilGrade: e.oil.grade, sludge: 0, comp: [1, 1, 1, 1], blowby: 0, coolant: 1, headGasket: true, timing: true },
    g: [
      BB(0.3, 0.32, len, [0, 0, 0], volvo ? 'redBlock' : 'engineGrey'),
      BB(0.25, 0.12, len - 0.02, [0, 0.22, 0], 'alu'),
      BB(0.21, 0.07, len - 0.06, [0, 0.31, 0], volvo ? 'camCoverVolvo' : 'blackPlastic'),
      BB(0.28, 0.12, len - 0.06, [0, -0.22, 0], 'alu'),               // sump
      BB(0.24, 0.3, 0.04, ax(0.02, len / 2 + 0.02), 'blackPlastic'),    // timing belt cover
      { t: 'cyl', rad: 0.075, len: 0.03, p: ax(-0.1, len / 2 + 0.05), ax: lon ? 'z' : 'x', m: 'castIron', seg: 28 },   // crank pulley
    ] });
  // the oil: filler cap, dipstick, drain plug, filter
  A.add({ id: 'oilcap', name: 'Oil filler cap', kind: 'oilcap', sys: 'oil', mass: 0.05, price: 120, clip: true, need: ['hood'], pos: [0.03, EY + 0.36, EZ + (lon ? 0.12 : 0)], g: [C(0.03, 0.025, [0, 0, 0], 'y', volvo ? 'blackPlastic' : 'yellowCap', { seg: 20 })] });
  A.add({ id: 'dipstick', name: 'Oil dipstick', kind: 'dipstick', sys: 'oil', mass: 0.05, price: 140, clip: true, need: ['hood'], pos: lon ? [0.17, EY + 0.25, EZ - 0.05] : [-0.05, EY + 0.25, EZ + 0.17], info: 'Wipe, push it fully home, pull it out and read where the oil reaches between MIN and MAX', g: [T([[0, 0, 0], [0, -0.45, 0]], 0.003, 'steel'), TOR(0.018, 0.004, [0, 0.02, 0], 'z', 'yellowCap')] });
  A.add({ id: 'drainplug', name: 'Sump drain plug', kind: 'drainplug', sys: 'oil', mass: 0.05, price: 45, pos: [0, EY - 0.29, EZ - (lon ? 0.15 : 0.02)], clip: false,
    fasteners: [{ id: 'plug', name: 'drain plug', size: e.oil.drainPlug.size, torque: e.oil.drainPlug.torque, len: 5, pos: [0, 0, 0], axis: [0, -1, 0], crush: true }], cond: { washer: 'used' }, g: [C(0.012, 0.012, [0, -0.006, 0], 'y', 'steel', { seg: 6 })] });
  A.add({ id: 'oilfilter', name: 'Oil filter', kind: 'oilfilter', sys: 'oil', mass: 0.45, price: volvo ? 115 : 145, pos: lon ? [-0.2, EY - 0.04, EZ + 0.02] : [0.04, EY - 0.05, EZ + 0.2], partNo: volvo ? 'Mann W 917' : 'Mann W 712/95',
    fasteners: [{ id: 'spin', name: 'oil filter (hand tight + ¾ turn)', size: 76, drive: 'filter', torque: e.oil.filterTorque || 18, len: 2.5, stiffness: 0.07, pos: [0, 0, 0], axis: lon ? [-1, 0, 0] : [0, 0, 1] }],
    cond: { age: 12000 }, g: [C(0.038, 0.1, [lon ? -0.05 : 0, 0, lon ? 0 : 0.05], lon ? 'x' : 'z', volvo ? 'filterBlue' : 'filterWhite', { seg: 24 })] });

  // ignition: the Volvo's distributor, cap, rotor and high-tension leads; the Golf's coil packs
  for (let i = 1; i <= e.cyl; i++) {
    const p = (i - (e.cyl + 1) / 2) * cylPitch;
    const plugPos = lon ? [0.0, EY + 0.33, EZ + p] : [p, EY + 0.33, EZ - 0.02];
    A.add({ id: 'plug' + i, name: `Spark plug, cylinder ${i}`, kind: 'plug', sys: 'ignition', cyl: i, mass: 0.05, price: volvo ? 49 : 119, partNo: e.plug.type, need: ['hood'], pos: [plugPos[0], plugPos[1] - 0.05, plugPos[2]],
      blockers: [volvo ? 'lead' + i : 'coil' + i],
      fasteners: [{ id: 'thread', name: 'spark plug', size: e.plug.socket, torque: e.plug.torque, len: 6, stiffness: 1.2, pos: [0, 0, 0], axis: [0, 1, 0] }],
      cond: { gap: e.plug.gap, wear: 0.2, fouled: false, cracked: false, spec: e.plug.gap }, g: [C(0.008, 0.06, [0, 0.02, 0], 'y', 'ceramic'), C(0.01, 0.015, [0, -0.012, 0], 'y', 'steel', { seg: 6 })] });
    if (volvo) A.add({ id: 'lead' + i, name: `HT lead, cylinder ${i}`, kind: 'lead', sys: 'ignition', cyl: i, mass: 0.05, price: 95, clip: true, need: ['hood'], pos: [plugPos[0], plugPos[1] + 0.03, plugPos[2]],
      cond: { ok: true, resistance: 5.5 }, g: [T([[0, 0, 0], [0.08, 0.05, 0], [0.18, 0.06, (0.2 - p) * 0.6], [0.24, 0.08, 0.22 - p]], 0.0045, 'leadRed')] });
    else A.add({ id: 'coil' + i, name: `Ignition coil, cylinder ${i}`, kind: 'coil', sys: 'ignition', cyl: i, mass: 0.25, price: 590, partNo: '04E 905 110', clip: true, need: ['hood'], pos: [plugPos[0], plugPos[1] + 0.04, plugPos[2]],
      cond: { ok: true }, g: [C(0.012, 0.1, [0, -0.02, 0], 'y', 'blackPlastic'), B(0.04, 0.04, 0.05, [0, 0.04, 0], 'blackPlastic')] });
  }
  if (volvo) {
    A.add({ id: 'distcap', name: 'Distributor cap', kind: 'distcap', sys: 'ignition', mass: 0.15, price: 230, clip: true, need: ['hood'], pos: [0.24, EY + 0.37, EZ + 0.22], blockers: [], cond: { cracked: false, tracking: false },
      g: [C(0.045, 0.05, [0, 0, 0], 'y', 'distCap'), ...[0, 1, 2, 3, 4].map((i) => C(0.007, 0.02, [Math.sin(i * 1.26) * 0.03, 0.03, Math.cos(i * 1.26) * 0.03], 'y', 'distCap'))] });
    A.add({ id: 'rotor', name: 'Distributor rotor arm', kind: 'rotor', sys: 'ignition', mass: 0.02, price: 90, clip: true, need: ['hood'], blockers: ['distcap'], pos: [0.24, EY + 0.35, EZ + 0.22], cond: { worn: false }, g: [B(0.012, 0.01, 0.04, [0, 0, 0.01], 'blackPlastic')] });
    A.add({ id: 'distributor', name: 'Distributor (Bosch, Hall sender)', kind: 'distributor', sys: 'ignition', fixed: true, pos: [0.24, EY + 0.3, EZ + 0.22], g: [C(0.04, 0.12, [0, 0, 0], 'y', 'alu')] });
    A.add({ id: 'diagunit', name: 'Diagnostic unit (LH-Jetronic 2.4 / EZ-116K)', kind: 'diag', sys: 'elec', fixed: true, pos: lay.diag, need: ['hood'], info: 'Fit the lead in socket 2 (fuel) or 6 (ignition), press the button for about 2 s and count the LED: three flashes, a pause, two...',
      g: [B(0.09, 0.04, 0.12, [0, 0, 0], 'blackPlastic'), C(0.006, 0.01, [0, 0.025, 0.03], 'y', 'redLens')] });
    A.add({ id: 'amm', name: 'Air mass meter (hot-wire)', kind: 'amm', sys: 'air', mass: 0.5, price: 2450, pos: [lay.air[0] + 0.05, lay.air[1] + 0.02, lay.air[2] - 0.25], need: ['hood'],
      fasteners: [{ id: 'clamp', name: 'hose clamp', size: 7, drive: 'clamp', torque: 3, len: 3, pos: [0, 0, -0.06], axis: [1, 0, 0] }], cond: { ok: true }, g: [C(0.04, 0.14, [0, 0, 0], 'z', 'alu')] });
  }
  // air intake: filter box, its lid on clips, the element; the intake hose (where a split lets air in past the meter)
  A.add({ id: 'airbox', name: 'Air filter housing', kind: 'airbox', sys: 'air', fixed: true, pos: lay.air, g: [B(0.24, 0.12, 0.32, [0, -0.04, 0], 'blackPlastic')] });
  A.add({ id: 'airlid', name: 'Air filter housing lid', kind: 'airlid', sys: 'air', mass: 0.5, price: 380, clip: true, need: ['hood'], pos: [lay.air[0], lay.air[1] + 0.045, lay.air[2]], info: 'Four spring clips', g: [B(0.25, 0.04, 0.33, [0, 0, 0], 'blackPlastic')] });
  A.add({ id: 'airfilter', name: 'Air filter element', kind: 'airfilter', sys: 'air', mass: 0.25, price: volvo ? 149 : 189, clip: true, need: ['hood'], blockers: ['airlid'], pos: [lay.air[0], lay.air[1] + 0.01, lay.air[2]], partNo: volvo ? 'Mann C 2876' : 'Mann C 27 009',
    cond: { clog: 0.25 }, g: [B(0.2, 0.04, 0.28, [0, 0, 0], 'filterPaper')] });
  A.add({ id: 'vachose', name: volvo ? 'Crankcase breather hose' : 'Vacuum hose (brake servo)', kind: 'vachose', sys: 'air', mass: 0.1, price: 180, clip: true, need: ['hood'], pos: [volvo ? -0.15 : -0.2, EY + 0.3, EZ - 0.18],
    cond: { split: false }, g: [T([[0, 0, 0], [0.08, 0.05, -0.05], [0.18, 0.04, -0.12]], 0.009, 'rubber')] });
  // charging, starting
  A.add({ id: 'battery', name: `Battery 12 V ${s.battery.ah} Ah`, kind: 'battery', sys: 'elec', mass: 16, price: volvo ? 1290 : 1690, need: ['hood'], pos: lay.batt, partNo: `${s.battery.ah} Ah ${s.battery.cca} A EN`,
    fasteners: [{ id: 'neg', name: 'negative terminal clamp', size: 10, torque: 5, len: 3, pos: [-0.06, 0.1, 0.05], axis: [0, 1, 0] }, { id: 'pos', name: 'positive terminal clamp', size: 10, torque: 5, len: 3, pos: [0.06, 0.1, 0.05], axis: [0, 1, 0] }, { id: 'clamp', name: 'hold-down clamp bolt', size: 13, torque: 15, len: 5, pos: [0, -0.08, 0.1], axis: [0, 0, 1] }],
    cond: { soc: 0.85, soh: 0.9, sulfated: false }, g: [B(0.25, 0.18, 0.17, [0, 0, 0], 'batteryCase'), C(0.009, 0.02, [-0.08, 0.1, 0.05], 'y', 'lead'), C(0.009, 0.02, [0.08, 0.1, 0.05], 'y', 'lead'), C(0.012, 0.004, [0.08, 0.11, 0.05], 'y', 'redPlastic')] });
  A.add({ id: 'tensioner', name: 'Auxiliary belt tensioner', kind: 'tensioner', sys: 'charge', fixed: true, pos: lon ? [0.12, EY + 0.02, EZ + 0.33] : [0.32, EY + 0.02, EZ + 0.08], info: volvo ? 'Slacken the alternator pivot and the adjuster bolt to take the belt off' : 'Swing it back with a 16 mm spanner to slip the belt off', g: [C(0.035, 0.03, [0, 0, 0], lon ? 'z' : 'x', 'steel')] });
  A.add({ id: 'belt', name: 'Auxiliary drive belt', kind: 'belt', sys: 'charge', mass: 0.2, price: volvo ? 145 : 260, clip: true, need: ['hood'], pos: lon ? [0, EY - 0.05, EZ + 0.33] : [0.29, EY - 0.05, EZ], partNo: volvo ? '10x950' : '6PK1053',
    cond: { wear: 0.3, glazed: false, tension: 1 }, g: [T(lon ? [[0, -0.05, 0], [0.18, 0.18, 0], [0.12, 0.08, 0], [0, -0.05, 0]] : [[0, -0.05, 0], [0, 0.18, 0.18], [0, 0.08, 0.12], [0, -0.05, 0]], 0.006, 'rubber', { closed: true })] });
  A.add({ id: 'alternator', name: volvo ? 'Alternator (Bosch 70 A)' : 'Alternator (Valeo 110 A)', kind: 'alternator', sys: 'charge', mass: 5.5, price: volvo ? 2490 : 3590, need: ['hood', 'batteryOff'], blockers: ['belt'], pos: lon ? [0.2, EY + 0.12, EZ + 0.3] : [0.3, EY + 0.15, EZ + 0.12],
    fasteners: [{ id: 'pivot', name: 'pivot bolt', size: 13, torque: 25, len: 6, pos: [0, -0.07, 0], axis: lon ? [0, 0, 1] : [1, 0, 0] }, { id: 'adj', name: 'adjuster bolt', size: 13, torque: 25, len: 5, pos: [0, 0.07, 0], axis: lon ? [0, 0, 1] : [1, 0, 0] }],
    cond: { ok: true, output: 1 }, g: [C(0.065, 0.12, [0, 0, 0], lon ? 'z' : 'x', 'alu', { seg: 20 }), C(0.03, 0.02, [0, 0, lon ? 0.07 : 0], lon ? 'z' : 'x', 'steel')] });
  A.add({ id: 'starter', name: 'Starter motor', kind: 'starter', sys: 'elec', mass: 4, price: volvo ? 1990 : 2890, need: ['batteryOff'], pos: lon ? [-0.17, EY - 0.12, EZ - 0.38] : [0.05, EY - 0.1, EZ - 0.22],
    fasteners: [{ id: 's1', name: 'starter bolt (upper)', size: 17, torque: 40, len: 6, pos: [0, 0.05, 0.08], axis: [0, 0, 1] }, { id: 's2', name: 'starter bolt (lower)', size: 17, torque: 40, len: 6, pos: [0, -0.05, 0.08], axis: [0, 0, 1] }],
    cond: { ok: true, solenoid: true }, g: [C(0.045, 0.16, [0, 0, 0], 'z', 'paintBlack'), C(0.02, 0.07, [0, 0.05, 0], 'z', 'alu')] });
  // cooling
  A.add({ id: 'radiator', name: 'Radiator', kind: 'radiator', sys: 'cool', fixed: true, pos: [0, volvo ? 0.52 : 0.44, lay.radZ], g: [B(0.62, 0.42, 0.04, [0, 0, 0], 'radiator'), B(0.08, 0.46, 0.06, [0.35, 0, 0], 'blackPlastic'), B(0.08, 0.46, 0.06, [-0.35, 0, 0], 'blackPlastic')] });
  A.add({ id: 'fan', name: volvo ? 'Viscous fan' : 'Electric cooling fan', kind: 'fan', sys: 'cool', fixed: true, pos: [0, 0.5, lay.radZ - 0.08], cond: { ok: true }, g: [C(0.19, 0.04, [0, 0, 0], 'z', 'blackPlastic', { seg: 9 })] });
  A.add({ id: 'thermohousing', name: 'Thermostat housing', kind: 'thermohousing', sys: 'cool', mass: 0.3, price: 340, need: ['hood'], pos: lon ? [0.12, EY + 0.25, EZ + 0.28] : [-0.27, EY + 0.18, EZ + 0.02],
    fasteners: [{ id: 't1', name: 'housing bolt', size: 10, torque: 10, len: 4, pos: [0.03, 0, 0], axis: [0, 1, 0] }, { id: 't2', name: 'housing bolt', size: 10, torque: 10, len: 4, pos: [-0.03, 0, 0], axis: [0, 1, 0] }],
    g: [C(0.03, 0.05, [0, 0, 0], 'y', 'alu')] });
  A.add({ id: 'thermostat', name: `Thermostat (${e.coolant.thermostat} °C)`, kind: 'thermostat', sys: 'cool', mass: 0.1, price: volvo ? 159 : 420, clip: true, blockers: ['thermohousing'], need: ['hood'], pos: lon ? [0.12, EY + 0.22, EZ + 0.28] : [-0.27, EY + 0.15, EZ + 0.02],
    cond: { stuckOpen: false, stuckShut: false, opens: e.coolant.thermostat }, g: [C(0.026, 0.02, [0, 0, 0], 'y', 'copper'), C(0.008, 0.03, [0, 0.02, 0], 'y', 'steel')] });
  A.add({ id: 'hoseTop', name: 'Upper radiator hose', kind: 'radhose', sys: 'cool', fixed: true, pos: [0, 0, 0], cond: { split: false }, g: [T(lon ? [[0.12, EY + 0.27, EZ + 0.3], [0.1, EY + 0.25, EZ + 0.42], [0.12, 0.66, lay.radZ - 0.02]] : [[-0.27, EY + 0.2, EZ + 0.02], [-0.25, 0.68, lay.radZ - 0.15], [-0.25, 0.66, lay.radZ - 0.03]], 0.018, 'hose')] });
  A.add({ id: 'exptank', name: 'Coolant expansion tank', kind: 'exptank', sys: 'cool', fixed: true, pos: lay.exp, cond: { level: 0.9, glycol: 0.5 }, g: [B(0.14, 0.16, 0.12, [0, 0, 0], 'translucent')] });
  A.add({ id: 'expcap', name: 'Expansion tank cap', kind: 'expcap', sys: 'cool', mass: 0.05, price: 160, clip: true, need: ['hood'], pos: [lay.exp[0], lay.exp[1] + 0.09, lay.exp[2]], info: 'Never open it hot: the coolant is under pressure', g: [C(0.025, 0.02, [0, 0, 0], 'y', 'blueCap', { seg: 16 })] });
  // brakes in the bay
  A.add({ id: 'booster', name: 'Brake servo', kind: 'booster', sys: 'brake', fixed: true, pos: [0.42, 0.72, lay.fire + 0.1], g: [C(0.12, 0.12, [0, 0, 0], 'z', 'paintBlack', { seg: 28 }), C(0.025, 0.2, [0, 0, 0.14], 'z', 'alu')] });
  A.add({ id: 'reservoir', name: 'Brake fluid reservoir', kind: 'reservoir', sys: 'brake', fixed: true, pos: lay.resv, cond: { level: 0.95, water: 1.5 }, g: [B(0.12, 0.07, 0.06, [0, 0, 0], 'translucent')] });
  A.add({ id: 'resvcap', name: 'Brake fluid reservoir cap', kind: 'resvcap', sys: 'brake', mass: 0.03, price: 90, clip: true, need: ['hood'], pos: [lay.resv[0], lay.resv[1] + 0.05, lay.resv[2]], g: [C(0.022, 0.02, [0, 0, 0], 'y', 'yellowCap', { seg: 16 })] });
  A.add({ id: 'washer', name: 'Washer fluid bottle', kind: 'washer', sys: 'body', fixed: true, pos: [-0.55, 0.62, lay.radZ - 0.15], cond: { level: 0.6 }, g: [B(0.14, 0.18, 0.16, [0, 0, 0], 'translucentBlue')] });
  // exhaust manifold side
  A.add({ id: 'manifold', name: 'Exhaust manifold', kind: 'manifold', sys: 'exhaust', fixed: true, pos: lon ? [-0.2, EY + 0.12, EZ] : [0, EY + 0.1, EZ - 0.2], g: [B(lon ? 0.08 : len * 0.8, 0.08, lon ? len * 0.8 : 0.08, [0, 0, 0], 'exhaustHot')] });
  A.add({ id: 'o2sensor', name: 'Lambda (oxygen) sensor', kind: 'o2', sys: 'exhaust', mass: 0.12, price: volvo ? 890 : 1290, need: [], pos: lon ? [-0.25, EY - 0.18, EZ - 0.3] : [0.05, EY - 0.08, EZ - 0.3],
    fasteners: [{ id: 'thread', name: 'lambda sensor (22 mm, slotted socket)', size: 22, torque: 50, len: 5, pos: [0, 0, 0], axis: [0, 1, 0] }], cond: { ok: true, slow: false }, g: [C(0.011, 0.06, [0, 0.02, 0], 'y', 'steel', { seg: 6 }), T([[0, 0.05, 0], [0.05, 0.15, 0.03], [0.15, 0.2, 0.05]], 0.003, 'wire')] });
  // the fuse box
  A.add({ id: 'fuselid', name: 'Fuse box cover', kind: 'fuselid', sys: 'elec', mass: 0.1, price: 120, clip: true, pos: lay.fuse, g: [B(0.18, 0.02, 0.12, [0, 0, 0], 'blackPlastic')] });
  const FUSES = volvo
    ? [['1', 'Lighter, radio memory', 15], ['2', 'Fuel pump', 15], ['3', 'Brake lights', 10], ['4', 'Heater fan', 25], ['5', 'Rear window heater', 25], ['6', 'Windscreen wipers', 10], ['7', 'Indicators, reversing lights', 15], ['8', 'Interior light, clock', 10]]
    : [['SC9', 'Instrument cluster', 5], ['SC17', 'Engine control unit', 10], ['SC23', 'Headlight (right)', 15], ['SC24', 'Headlight (left)', 15], ['SC30', '12 V socket', 20], ['SC34', 'Rear window heater', 30], ['SC40', 'Horn', 15], ['SC46', 'Infotainment', 15]];
  FUSES.forEach(([no, circuit, amp], i) => A.add({ id: 'fuse' + no, name: `Fuse ${no} (${amp} A): ${circuit}`, kind: 'fuse', sys: 'elec', mass: 0.002, price: 15, clip: true, blockers: ['fuselid'], pos: [lay.fuse[0] - 0.06 + (i % 4) * 0.035, lay.fuse[1] - 0.01, lay.fuse[2] - 0.03 + Math.floor(i / 4) * 0.04],
    cond: { ok: true, amp, circuit, short: false }, g: [B(0.01, 0.02, 0.005, [0, 0, 0], amp >= 25 ? 'fuseClear' : amp >= 20 ? 'fuseYellow' : amp >= 15 ? 'fuseBlue' : amp >= 10 ? 'fuseRed' : 'fuseTan')] }));
}

function cabin(A, lay, volvo, zF) {
  const d = A.spec.dims;
  const W = d.width - 0.2, seat = volvo ? 'leather' : 'seatFabric';
  A.add({ id: 'dash', name: 'Dashboard', kind: 'dash', sys: 'interior', fixed: true, pos: [0, 0.88, zF - 1.05], g: [
    B(W, 0.2, 0.4, [0, 0, 0], 'dash'), B(W - 0.04, 0.06, 0.25, [0, 0.12, 0.06], 'dash', [0.25, 0, 0]),
    B(W - 0.1, 0.035, 0.012, [0, -0.04, -0.205], volvo ? 'woodTrim' : 'chrome'),                         // the wood strip (Volvo) or the chrome line (Golf)
    B(0.12, 0.08, 0.012, [W / 2 - 0.1, 0.03, -0.205], 'vent'), B(0.12, 0.08, 0.012, [-W / 2 + 0.1, 0.03, -0.205], 'vent'),
    B(0.2, 0.07, 0.012, [0.0, 0.03, -0.205], 'vent'),
    B(0.42, 0.13, 0.16, [0.37, 0.1, -0.12], 'dash'),                                                       // the instrument binnacle
    B(0.38, 0.09, 0.012, [-0.33, -0.01, -0.205], 'dash'),                                                  // the glovebox lid
    B(0.26, 0.36, 0.2, [0, -0.3, -0.12], 'dash'), B(0.18, 0.045, 0.012, [0, -0.2, -0.225], volvo ? 'clusterScreen' : 'screen'),   // centre console, radio / infotainment
    ...[0, 1, 2, 3, 4].map((i) => B(0.025, 0.02, 0.01, [-0.06 + i * 0.03, -0.29, -0.225], i === 4 ? 'redPlastic' : 'blackPlastic')),
  ] });
  A.add({ id: 'cluster', name: 'Instrument cluster', kind: 'cluster', sys: 'interior', fixed: true, pos: [0.37, 0.99, zF - 1.255], g: [{ t: 'box', s: [0.34, 0.1, 0.01], p: [0, 0, 0], m: 'clusterScreen', r: [-0.2, Math.PI, 0] }] });
  A.add({ id: 'wheelSteer', name: 'Steering wheel', kind: 'steering', sys: 'interior', fixed: true, pos: [0.37, 0.93, zF - 1.42], rot: [-0.42, 0, 0], g: [
    TOR(0.19, 0.016, [0, 0, 0], 'z', 'rubber', { seg: 40 }),
    ...(volvo ? [B(0.2, 0.15, 0.06, [0, -0.01, 0.03], 'blackPlastic'), ...[[0.14, 0.03], [-0.14, 0.03], [0.1, -0.12], [-0.1, -0.12]].map(([x, y]) => B(Math.abs(x) > 0.12 ? 0.1 : 0.03, Math.abs(x) > 0.12 ? 0.03 : 0.1, 0.02, [x * 0.75, y * 0.75, 0.02], 'blackPlastic'))]
      : [C(0.06, 0.05, [0, 0, 0.03], 'z', 'blackPlastic'), B(0.3, 0.035, 0.02, [0, 0, 0.02], 'blackPlastic'), B(0.035, 0.15, 0.02, [0, -0.09, 0.02], 'blackPlastic'), B(0.05, 0.02, 0.005, [0, 0, 0.058], 'chrome')]),
    C(0.025, 0.25, [0, 0, 0.16], 'z', 'blackPlastic'),
  ] });
  A.add({ id: 'ignition', name: 'Ignition lock and key', kind: 'ignition', sys: 'interior', fixed: true, pos: [volvo ? 0.2 : 0.2, 0.82, zF - 1.38], info: 'Click to turn the key: 0 off, I accessories, II ignition, III start (hold)', g: [C(0.018, 0.03, [0, 0, 0], 'z', 'chrome'), B(0.012, 0.03, 0.004, [0, 0, -0.025], 'steel')] });
  A.add({ id: 'hoodrelease', name: 'Bonnet release lever', kind: 'hoodrelease', sys: 'interior', fixed: true, pos: [0.72, 0.55, zF - 1.15], g: [B(0.06, 0.03, 0.08, [0, 0, 0], 'blackPlastic')] });
  A.add({ id: 'handbrake', name: volvo ? 'Handbrake lever' : 'Electric parking brake switch', kind: 'handbrake', sys: 'interior', fixed: true, pos: [0, 0.5, zF - 1.75], g: volvo ? [B(0.05, 0.05, 0.28, [0, 0, 0], 'blackPlastic', [0.25, 0, 0])] : [B(0.03, 0.02, 0.04, [0, 0.05, 0.1], 'blackPlastic')] });
  A.add({ id: 'gearlever', name: `Gear lever (${A.spec.gearbox})`, kind: 'gearlever', sys: 'interior', fixed: true, pos: [0, 0.55, zF - 1.45], g: [C(0.008, 0.25, [0, 0.12, 0], 'y', 'chrome'), S(0.028, [0, 0.26, 0], 'blackPlastic'), C(0.05, 0.06, [0, 0.0, 0], 'y', 'rubber', { r2: 0.03 })] });
  // seats: cushion, backrest with side bolsters, a headrest on its two posts
  const seatG = (wd) => [B(wd, 0.12, 0.5, [0, 0.08, 0], seat), B(wd - 0.12, 0.6, 0.11, [0, 0.42, -0.24], seat, [-0.18, 0, 0]),
    B(0.07, 0.62, 0.15, [wd / 2 - 0.035, 0.42, -0.23], seat, [-0.18, 0, 0]), B(0.07, 0.62, 0.15, [-wd / 2 + 0.035, 0.42, -0.23], seat, [-0.18, 0, 0]),
    B(0.07, 0.1, 0.42, [wd / 2 - 0.035, 0.16, 0.02], seat), B(0.07, 0.1, 0.42, [-wd / 2 + 0.035, 0.16, 0.02], seat),
    B(0.26, 0.17, 0.09, [0, 0.86, -0.35], seat), C(0.006, 0.08, [0.07, 0.75, -0.33], 'y', 'chrome'), C(0.006, 0.08, [-0.07, 0.75, -0.33], 'y', 'chrome')];
  for (const sx of [1, -1]) A.add({ id: 'seat' + (sx > 0 ? 'L' : 'R'), name: `${sx > 0 ? 'Driver' : 'Passenger'} seat`, kind: 'seat', sys: 'interior', fixed: true, pos: [sx * 0.37, 0.35, zF - 1.85], g: seatG(0.52) });
  A.add({ id: 'seatRear', name: 'Rear seat', kind: 'seat', sys: 'interior', fixed: true, pos: [0, 0.35, zF - 2.65], g: [B(d.width - 0.3, 0.13, 0.5, [0, 0.08, 0], seat), B(d.width - 0.3, 0.55, 0.12, [0, 0.4, -0.25], seat, [-0.2, 0, 0]), ...[-0.45, 0, 0.45].map((x) => B(0.24, 0.13, 0.08, [x, 0.74, -0.33], seat))] });
  for (const sx of [1, -1]) A.add({ id: 'doorcard' + (sx > 0 ? 'L' : 'R'), name: 'Door trim panel', kind: 'trim', sys: 'interior', fixed: true, pos: [sx * (d.width / 2 - 0.07), 0.7, zF - 1.75], g: [B(0.02, 0.4, 1.6, [0, 0, 0], volvo ? 'leather' : 'dash'), B(0.06, 0.03, 0.4, [-sx * 0.03, 0.08, 0.2], 'blackPlastic')] });
  A.add({ id: 'carpet', name: 'Carpet', kind: 'carpet', sys: 'interior', fixed: true, pos: [0, 0.26, zF - 1.9], g: [B(d.width - 0.2, 0.02, 1.9, [0, 0, 0], 'carpet')] });
  for (const sx of [1, -1]) A.add({ id: 'wiper' + (sx > 0 ? 'L' : 'R'), name: `Wiper blade (${sx > 0 ? 'driver' : 'passenger'})`, kind: 'wiper', sys: 'body', mass: 0.2, price: volvo ? 129 : 249, clip: true, pos: [sx * 0.3, lay.hoodY + 0.06, zF - 0.98 + (volvo ? 0 : 0.08)], cond: { wear: 0.3 },
    g: [B(volvo ? 0.45 : 0.6, 0.015, 0.02, [0, 0, 0], 'rubber', [0, 0.15 * sx, 0.2])] });
  if (!volvo) A.add({ id: 'obd', name: 'OBD-II diagnostic socket', kind: 'obd', sys: 'elec', fixed: true, pos: lay.obd, info: 'Under the dash, above the driver\'s left knee', g: [B(0.045, 0.02, 0.025, [0, 0, 0], 'blackPlastic')] });
}

function underbody(A, volvo, zF, zR) {
  const d = A.spec.dims;
  A.add({ id: 'gearbox', name: `Gearbox (${A.spec.gearbox})`, kind: 'gearbox', sys: 'drive', fixed: true, pos: volvo ? [0, 0.4, zF - 0.75] : [-0.35, 0.42, zF + 0.1], cond: { oil: 1 }, g: volvo ? [C(0.13, 0.55, [0, 0, 0], 'z', 'alu', { r2: 0.09 })] : [B(0.35, 0.3, 0.3, [0, 0, 0], 'alu')] });
  if (volvo) {
    A.add({ id: 'propshaft', name: 'Propeller shaft', kind: 'propshaft', sys: 'drive', fixed: true, pos: [0, 0.32, 0], g: [C(0.035, d.wheelbase - 1.1, [0, 0, -0.2], 'z', 'paintBlack')] });
    A.add({ id: 'axleR', name: 'Rear axle (Dana/Spicer 1031)', kind: 'axle', sys: 'drive', fixed: true, pos: [0, A.spec.wheels.tyreR, zR], cond: { oil: 1 }, g: [C(0.035, d.trackR - 0.15, [0, 0, 0], 'x', 'paintBlack'), S(0.13, [0, 0, 0.02], 'paintBlack'), C(0.08, 0.12, [0, 0, 0.12], 'z', 'paintBlack')] });
    for (const sx of [1, -1]) A.add({ id: 'springR' + (sx > 0 ? 'L' : 'R'), name: 'Rear coil spring and damper', kind: 'spring', sys: 'susp', fixed: true, pos: [sx * 0.5, A.spec.wheels.tyreR, zR - 0.05], g: [{ t: 'spring', R: 0.06, rad: 0.006, turns: 6, len: 0.28, p: [0, 0.18, 0], m: 'springPaint' }] });
  } else {
    A.add({ id: 'beamR', name: 'Rear torsion beam axle', kind: 'axle', sys: 'susp', fixed: true, pos: [0, A.spec.wheels.tyreR - 0.02, zR + 0.25], g: [B(d.trackR - 0.3, 0.06, 0.1, [0, 0, 0], 'paintBlack'), ...[1, -1].map((sx) => B(0.06, 0.06, 0.45, [sx * (d.trackR / 2 - 0.17), 0, -0.15], 'paintBlack'))] });
    for (const sx of [1, -1]) A.add({ id: 'springR' + (sx > 0 ? 'L' : 'R'), name: 'Rear coil spring', kind: 'spring', sys: 'susp', fixed: true, pos: [sx * (d.trackR / 2 - 0.25), A.spec.wheels.tyreR, zR + 0.05], g: [{ t: 'spring', R: 0.055, rad: 0.006, turns: 5, len: 0.22, p: [0, 0.12, 0], m: 'springPaint' }] });
  }
  // exhaust: down the middle to the back
  const ex = [[volvo ? -0.15 : 0.05, 0.25, zF - 0.4], [0.05, 0.2, 0.3], [0.1, 0.2, -0.5], [0.2, 0.22, zR - 0.15]];
  A.add({ id: 'pipe', name: 'Exhaust front pipe and catalytic converter', kind: 'pipe', sys: 'exhaust', fixed: true, pos: [0, 0, 0], g: [T(ex.slice(0, 3), 0.025, 'exhaust'), C(0.07, 0.35, [0.05, 0.2, volvo ? 0.6 : 0.3], 'z', 'exhaust')] });
  A.add({ id: 'silencer', name: 'Rear silencer', kind: 'silencer', sys: 'exhaust', mass: 7, price: volvo ? 990 : 1690, pos: [0.25, 0.24, zR - 0.45], need: [],
    fasteners: [{ id: 'clamp', name: 'exhaust clamp nut', size: 13, torque: 25, len: 4, pos: [0, 0, 0.35], axis: [1, 0, 0] }], cond: { hole: false, rattle: false },
    g: [C(0.12, 0.42, [0, 0, 0], 'z', 'exhaust', { seg: 20 }), C(0.025, 0.25, [0.02, 0, 0.32], 'z', 'exhaust'), C(0.028, 0.12, [0.0, -0.03, -0.27], 'z', 'chrome')] });
  A.add({ id: 'tank', name: `Fuel tank (${volvo ? 60 : 50} l)`, kind: 'tank', sys: 'fuel', fixed: true, pos: [0, 0.32, volvo ? zR - 0.25 : zR + 0.55], cond: { fuel: 0.4 }, g: [B(0.8, 0.22, 0.5, [0, 0, 0], 'paintBlack')] });
}

function lights(A, volvo, zF, zR) {
  const d = A.spec.dims, front = zF + d.overhangF - 0.06, rear = -(d.length - d.overhangF - d.wheelbase / 2) + 0.05;
  for (const sx of [1, -1]) {
    const S1 = sx > 0 ? 'L' : 'R';
    const hx = sx * (volvo ? 0.52 : 0.6), hy = volvo ? 0.72 : 0.78;
    A.add({ id: 'headlamp' + S1, name: `${sx > 0 ? 'Left' : 'Right'} headlamp`, kind: 'headlamp', sys: 'light', fixed: true, pos: [hx, hy, front], g: [] });
    A.add({ id: 'cap' + S1, name: `${sx > 0 ? 'Left' : 'Right'} headlamp rear cover`, kind: 'lampcap', sys: 'light', clip: true, need: ['hood'], mass: 0.05, price: 95, pos: [hx, hy, front - 0.14], g: [C(0.045, 0.03, [0, 0, 0], 'z', 'rubber', { seg: 18 })] });
    A.add({ id: 'bulb' + S1, name: `${sx > 0 ? 'Left' : 'Right'} dipped-beam bulb (${A.spec.bulbs.head})`, kind: 'bulb', sys: 'light', clip: true, need: ['hood'], blockers: ['cap' + S1], mass: 0.02, price: volvo ? 89 : 119, partNo: A.spec.bulbs.head, pos: [hx, hy, front - 0.11],
      cond: { ok: true, circuit: 'head' }, info: 'Do not touch the glass: the oil of your skin burns into it', g: [C(0.009, 0.03, [0, 0, 0.02], 'z', 'bulbGlass'), C(0.016, 0.01, [0, 0, -0.005], 'z', 'steel')] });
    A.add({ id: 'tail' + S1, name: `${sx > 0 ? 'Left' : 'Right'} tail lamp`, kind: 'taillamp', sys: 'light', fixed: true, pos: [sx * (d.width / 2 - 0.2), volvo ? 0.78 : 0.95, rear], g: [] });
    A.add({ id: 'brakebulb' + S1, name: `${sx > 0 ? 'Left' : 'Right'} brake/tail bulb (${A.spec.bulbs.tail})`, kind: 'bulb', sys: 'light', clip: true, need: ['trunk'], mass: 0.01, price: 29, partNo: A.spec.bulbs.tail, pos: [sx * (d.width / 2 - 0.2), volvo ? 0.78 : 0.95, rear + 0.06],
      cond: { ok: true, circuit: 'brake' }, g: [S(0.012, [0, 0, 0], 'bulbGlass'), C(0.012, 0.015, [0, 0, 0.01], 'z', 'steel')] });
  }
}

/** A part's spare from the parts shelf: its condition as new. */
export function newCond(part, spec) {
  const c = structuredClone(part.cond);
  switch (part.kind) {
    case 'pad': c.mm = c.nominal; c.glazed = false; break;
    case 'disc': c.t = c.nominal; c.runout = 0.01; c.rust = 0; break;
    case 'caliper': c.seized = false; c.leak = false; break;
    case 'wheel': c.tread = 8; c.nail = false; c.leak = 0; c.imbalance = 0; c.age = 0; c.bar = spec.wheels.pressure[part.corner[0]]; break;
    case 'plug': c.gap = c.spec; c.wear = 0; c.fouled = false; c.cracked = false; break;
    case 'coil': case 'lead': case 'o2': case 'amm': case 'alternator': c.ok = true; c.slow = false; c.output = 1; c.resistance = 5.5; break;
    case 'starter': c.ok = true; c.solenoid = true; break;
    case 'battery': c.soc = 0.8; c.soh = 1; c.sulfated = false; break;
    case 'bulb': c.ok = true; break;
    case 'fuse': c.ok = true; break;
    case 'airfilter': c.clog = 0; break;
    case 'oilfilter': c.age = 0; break;
    case 'belt': c.wear = 0; c.glazed = false; c.tension = 1; break;
    case 'thermostat': c.stuckOpen = false; c.stuckShut = false; break;
    case 'vachose': c.split = false; break;
    case 'distcap': c.cracked = false; c.tracking = false; break;
    case 'rotor': c.worn = false; break;
    case 'link': case 'balljoint': case 'hub': c.play = 0; c.rough = 0; break;
    case 'cvboot': c.torn = false; c.grease = 1; break;
    case 'silencer': c.hole = false; c.rattle = false; break;
    case 'wiper': c.wear = 0; break;
    case 'drainplug': c.washer = 'new'; break;
    default: break;
  }
  return c;
}
