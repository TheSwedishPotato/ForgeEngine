/**
 * The DeLorean time machine: the DMC-12's shell (body.js), its gull-wing doors on their roof
 * hinges, the glass, the wheels, the trim and lamps (details.js), the interior (interior.js)
 * and the time machine's hardware (timemachine.js), in one Group in the car's frame
 * (x forward, y up, z right; the origin on the ground midway between the axles).
 *
 * pose() puts it where the physics says, with the body on its springs; lights() and
 * instruments() make everything in it show what the car is doing.
 */
import { Group, Mesh, Matrix4, Vector3, Color } from 'three';

const FROST = new Color(0.78, 0.82, 0.88);
import { buildShell, meshes, DIM } from './body.js';
import { carMaterials } from './materials.js';
import { buildWheels } from './wheels.js';
import { buildDetails } from './details.js';
import { buildTimeMachine } from './timemachine.js';
import { buildInterior } from './interior.js';
import { Builder } from './geom.js';

export { DIM };

const DEG = Math.PI / 180;
// the five-speed's gate: the lever's lean (fore-aft about z, side about x) in each gear
const GATE = { N: [0, 0], 1: [-0.26, -0.2], 2: [0.26, -0.2], 3: [-0.26, 0], 4: [0.26, 0], 5: [-0.26, 0.2], R: [0.26, 0.2] };

export class Car {
  constructor({ version = 'part1' } = {}) {
    this.version = version;
    const M = (this.M = carMaterials());
    this.root = new Group();
    this.root.name = 'delorean';
    this.body = new Group();          // everything that rides on the springs
    this.root.add(this.body);
    const shell = buildShell();
    this.shell = shell;
    this.body.add(meshes(shell.body, M));
    const det = (this.details = buildDetails(M));
    this.body.add(det.body);
    const tm = (this.timeMachine = buildTimeMachine(M, { version }));
    this.body.add(tm.group);
    const inside = (this.interior = buildInterior(M, { version }));
    this.body.add(inside.group);
    this.live = inside.live;
    this.glassPanes = [];
    this.glassPanes.push({ mesh: inside.live.rearWindow, opts: { dirt: 0.2 } }, { mesh: inside.live.fluxWindow, opts: { dirt: 0.05, frosts: false } });
    const ws = new Mesh(shell.glass.body);
    this.body.add(ws);
    this.glassPanes.push({ mesh: ws, opts: { band: [1.04, 1.1, 0.75, 0], dirt: 0.12 } });
    // the doors, hinged along the roof
    this.doors = {};
    for (const side of ['right', 'left']) {
      const pivot = new Group();
      pivot.position.set(0, DIM.hinge.y, side === 'right' ? DIM.hinge.z : -DIM.hinge.z);
      pivot.add(meshes(shell.doors[side], M));
      pivot.add(side === 'right' ? det.right : det.left);
      pivot.add(doorCard(M, side === 'right' ? 1 : -1));
      if (shell.glass[side]) { const g = new Mesh(shell.glass[side]); pivot.add(g); this.glassPanes.push({ mesh: g, opts: { dirt: 0.1 } }); }
      this.body.add(pivot);
      this.doors[side] = { pivot, open: 0, target: 0 };
    }
    // the wheels (not on the springs)
    this.wheels = buildWheels(M, DIM);
    for (const w of Object.values(this.wheels)) this.root.add(w.steer);
    this.cabin = { matrixInverse: new Matrix4(), min: [-0.92, 0.2, -0.8], max: [0.62, 1.12, 0.8], open: 0 };
    // the pole with the hook, for the lightning (12 November 1955): on the back bumper, its hook at 4 m
    const hb = new Builder();
    hb.cylinder('aluminium', new Vector3(-2.24, 0.45, 0), new Vector3(-2.24, 3.92, 0), 0.025, 0.02, { segs: 8 });
    hb.cylinder('aluminium', new Vector3(-2.24, 3.92, 0), new Vector3(-1.95, 4.08, 0), 0.015, 0.015, { segs: 6 });
    hb.cylinder('aluminium', new Vector3(-1.95, 4.08, 0), new Vector3(-1.9, 3.98, 0), 0.015, 0.015, { segs: 6 });
    hb.box('blackBox', [-2.32, 0.4, -0.12], [-2.18, 0.62, 0.12]);
    this.hook = hb.build(M);
    this.hook.visible = false;
    this.body.add(this.hook);
    // the springs: pitch, roll, heave and their rates
    this.susp = { p: 0, pv: 0, r: 0, rv: 0, h: 0, hv: 0 };
    this.t = 0;
    this.keyAnim = new Map();
  }

  /** Opens (1) or shuts (0) both doors at once (for views); the game drives them one by one. */
  setDoors(v) { for (const d of Object.values(this.doors)) { d.open = d.target = v; } this._poseDoors(); }
  toggleDoor(side) { const d = this.doors[side]; d.target = d.target > 0.5 ? 0 : 1; return d.target; }

  _poseDoors() {
    // a DMC door swings up about 66 degrees on its torsion bar and gas strut
    for (const [side, d] of Object.entries(this.doors)) d.pivot.rotation.x = (side === 'right' ? -1 : 1) * d.open * 1.15;
    this.cabin.open = Math.max(this.doors.right.open, this.doors.left.open);
  }

  /** Puts the car where the vehicle (physics/vehicle.js) is, the body on its springs. */
  pose(veh, dt) {
    const o = veh.origin();
    this.root.position.set(o.x, 0, o.z);
    this.root.rotation.set(0, veh.heading, 0);
    // pitch (nose up with acceleration), roll (away from the turn), springs at ~1.4 Hz
    const S = this.susp, wn = 2 * Math.PI * 1.4, z = 0.45;
    const tp = veh.ax * 0.0042, tr = -veh.ay * 0.0055;
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) {
      S.pv += (wn * wn * (tp - S.p) - 2 * z * wn * S.pv) * h; S.p += S.pv * h;
      S.rv += (wn * wn * (tr - S.r) - 2 * z * wn * S.rv) * h; S.r += S.rv * h;
    }
    this.body.rotation.set(S.r, 0, S.p);
    // the wheels: steer, spin
    const W = veh.wheels, keys = ['fl', 'fr', 'rl', 'rr'];
    keys.forEach((k, i) => {
      const w = this.wheels[k];
      w.steer.rotation.y = W[i].steer;
      w.wheel.userData.spin.rotation.z = -W[i].angle;
    });
    this.t += dt;
    for (const d of Object.values(this.doors)) {
      const step = dt * 0.85;
      d.open += Math.max(-step, Math.min(step, d.target - d.open));
    }
    this._poseDoors();
    this.root.updateMatrixWorld();
    this.cabin.matrixInverse.copy(this.body.matrixWorld).invert();
  }

  /** The lamps: { head (0 off, 1 dipped, 2 main), tail, brake, reverse, indicators ('left','right','hazard'), night }. */
  lights(s) {
    const M = this.M, blink = Math.floor(this.t * 1.5 * 2) % 2 === 0;
    M.headLens.emissiveIntensity = s.head ? (s.head > 1 ? 70 : 45) : 0;
    M.tailRed.emissiveIntensity = s.head ? 0.03 : 0;
    M.brakeRed.emissiveIntensity = s.brake ? 0.35 : s.head ? 0.03 : 0;
    M.reverse.emissiveIntensity = s.reverse ? 0.3 : 0;
    const ind = s.indicators;
    M.amber.emissiveIntensity = ind && blink ? 0.4 : 0;
    M.orangeLamp.emissiveIntensity = this.cabin.open > 0.2 ? 0.06 : 0;
  }

  /** Where the headlamps are, and which way they shine (world), for the stage's spot lights. */
  headlamps(s) {
    if (!s.head) return [];
    const out = [];
    for (const zz of [-0.53, 0.53]) {
      const p = new Vector3(2.0, 0.6, zz).applyMatrix4(this.body.matrixWorld);
      const d = new Vector3(1, s.head > 1 ? -0.005 : -0.03, zz * 0.02).normalize().transformDirection(this.body.matrixWorld);
      out.push({ pos: p, dir: d, color: s.head > 1 ? [3.2, 3.0, 2.6] : [1.6, 1.5, 1.3], range: s.head > 1 ? 220 : 110, shape: s.head > 1 ? [0.22, 0.09, 0.2] : [0.34, 0.1, 0.0] });
    }
    return out;
  }

  /**
   * The instruments. s: { mph, rpm, coolantF, fuel (0..1), volts, oilPsi, gear, steer (road
   * wheel angle, rad), night (0..1), tc (TimeCircuits), digital (bool: Doc's speedometer on),
   * flux (0..1: how hard the capacitor is fluxing), power (0..1), primary (0..1) }.
   */
  instruments(s, dt) {
    const L = this.live, D = L.dials, night = s.night ?? 0;
    const set = (key, v, v0, v1, a0, a1, lag = 6) => {
      const d = D[key]; if (!d) return;
      const t = Math.max(-0.04, Math.min(1.04, (v - v0) / (v1 - v0)));
      const target = -(a0 + (a1 - a0) * t) * DEG;
      d._a = d._a == null ? target : d._a + (target - d._a) * Math.min(1, dt * lag);
      d.needle.rotation.z = d._a;
    };
    // the DMC's dials: the speedometer pegs past 85, as it did
    set('speedo', Math.min(s.mph, 92), 0, 85, -130, 130, 8);
    set('tach', s.rpm, 0, 7000, -130, 130, 10);
    set('temp', s.coolantF, 100, 260, -60, 60, 1);
    set('fuel', s.fuel * 4, 0, 4, -60, 60, 1);
    set('volt', s.volts, 10, 16, -60, 60, 3);
    set('oil', s.oilPsi, 0, 80, -60, 60, 3);
    set('primary', (s.primary ?? 0) * 100, 0, 100, -50, 50, 4);
    set('power', (s.power ?? 0) * 100, 0, 100, -50, 50, 4);
    set('plutonium', (s.plutonium ?? 0) * 50, 0, 50, -50, 50, 2);
    // the dials' own light at night
    for (const k of ['speedo', 'tach', 'temp', 'fuel', 'volt', 'oil']) D[k]?.face?.material.emissive.setScalar(s.head ? 0.0015 : 0);
    // the wheel turns sixteen times the road wheels
    L.steer.rotation.z = (s.steer ?? 0) * 16;
    // the gear lever in its gate
    const g = GATE[s.gear] ?? GATE.N;
    L.shifter.rotation.z += (g[0] - L.shifter.rotation.z) * Math.min(1, dt * 14);
    L.shifter.rotation.x += (g[1] - L.shifter.rotation.x) * Math.min(1, dt * 14);
    // the time circuits
    const tc = s.tc;
    const on = !!tc?.on;
    L.tcLever.rotation.z += ((on ? 0.5 : 0) - L.tcLever.rotation.z) * Math.min(1, dt * 12);
    // the displays at their real brightness, a few hundred cd/m2 (1 unit ~ 10 000 cd/m2)
    const glow = 0.05;
    const colon = Math.floor(this.t * 2) % 2 === 0;
    if (tc) {
      const err = tc.entryError > 0 && Math.floor(this.t * 6) % 2 === 0;
      const dest = tc.shownDestination();
      const typing = tc.buffer.length > 0;
      const blinkTyping = typing && Math.floor(this.t * 4) % 2 === 0;
      L.tc.set(0, err ? null : dest, { on: on && !err && !!dest && !(blinkTyping && false), colon: !typing });
      L.tc.set(1, tc.present, { on, colon });
      L.tc.set(2, tc.lastDeparted, { on: on && !!tc.lastDeparted, colon: true });
    }
    for (const m of L.tcMats) m.emissiveIntensity = on ? glow : 0;
    // Doc's digital speedometer, on with the time circuits
    L.speedo.set(s.mph, on || s.digital);
    L.speedoMat.emissiveIntensity = (on || s.digital) ? glow * 1.4 : 0;
    // the flux capacitor: its lights run in toward the centre, faster as it fluxes harder
    const flux = on ? (s.flux ?? 0.2) : 0;
    this._fluxPhase = (this._fluxPhase ?? 0) + dt * (1.2 + flux * 14);
    L.flux.forEach((m, k) => {
      const ph = ((this._fluxPhase - k / 6) % 1 + 1) % 1;
      const pulse = Math.exp(-ph * 9);
      m.emissiveIntensity = on ? (0.006 + 0.09 * pulse) * (0.5 + flux * 1.5) + 0.004 : 0;
    });
    // the lamps on Doc's panels and the keypad
    const blink = Math.floor(this.t * 3) % 2 === 0;
    L.lamps.empty.emissiveIntensity = on && !tc?.powered ? (blink ? 0.06 : 0.01) : 0;
    L.lamps.keypad.forEach((m, k) => { m.emissiveIntensity = on ? (Math.floor(this.t * 2 + k) % 3 === 0 ? 0.05 : 0.01) : 0; });
    L.lamps.indicators.forEach((m, k) => { m.emissiveIntensity = on ? (tc?.armed ? (Math.floor(this.t * 6 + k) % 2 ? 0.07 : 0.01) : 0.025) : 0; });
    // keys travel in when pressed
    for (const [key, t] of this.keyAnim) {
      const left = t - dt;
      const k = L.keys.find((q) => q.userData.label === key);
      if (k) k.position.copy(k.userData.rest).addScaledVector(k.userData.normal, left > 0 ? -0.003 : 0);
      if (left > 0) this.keyAnim.set(key, left); else this.keyAnim.delete(key);
    }
  }

  pressKey(label) { this.keyAnim.set(label, 0.14); }

  /** Where the hook is (world). */
  hookTip() { return new Vector3(-1.95, 4.0, 0).applyMatrix4(this.body.matrixWorld); }

  /** Frost on the metal after a jump (0..1): whiter, rough, no longer a mirror. */
  setFrost(f) {
    const M = this.M;
    if (!this._base) this._base = ['steel', 'steelDark', 'aluBrushed', 'aluminium', 'deckPlate', 'greyBox', 'blackBox', 'conduitGrey'].map((k) => ({ m: M[k], c: M[k].color.clone(), r: M[k].roughness, mt: M[k].metalness }));
    const k = Math.min(1, f * 1.3);
    for (const b of this._base) {
      b.m.color.copy(b.c).lerp(FROST, k * 0.8);
      b.m.roughness = b.r + (0.82 - b.r) * k;
      b.m.metalness = b.mt + (0.1 - b.mt) * k;
    }
  }
}

/** The door card's armrest, pull and the courtesy lamp on the door's lower edge (in hinge coordinates). */
function doorCard(M, s) {
  const b = new Builder();
  const zi = 0.86 * s;
  const box = (mat, a, c) => b.box(mat, [a[0], a[1], Math.min(a[2], c[2])], [c[0], c[1], Math.max(a[2], c[2])]);
  box('leather', [-0.6, 0.5, zi], [0.2, 0.56, zi - 0.075 * s]);
  box('plasticBlack', [-0.35, 0.6, zi], [-0.05, 0.63, zi - 0.03 * s]);
  box('orangeLamp', [-0.3, 0.215, 0.905 * s], [-0.1, 0.235, 0.89 * s]);
  const g = b.build(M);
  g.position.set(0, -DIM.hinge.y, -DIM.hinge.z * s);
  return g;
}
