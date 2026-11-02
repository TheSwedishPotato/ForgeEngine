/**
 * The elevator itself, drawn where the physics puts it: the car on its sling (stiles, crosshead,
 * safety plank, roller guides, the safety gear's wedges and their linkage to the governor rope),
 * the platform and its toe guard, the three glass walls in stainless frames, the handrail, the
 * ceiling and its downlights, the car operating panel (thirty floor buttons, door open and close,
 * alarm, the display, the firefighters' and independent service keys), the glass door on its
 * operator, the roof with its balustrade and inspection station; the counterweight with its
 * cast-iron fillers; the eight hoist ropes (stretching), the compensating ropes, the governor rope
 * and the travelling cable.
 */
import { Group, Mesh, PlaneGeometry, Object3D } from 'three';
import { Batch, boxMesh, cylGeo, merge, boxGeo } from './build.js';
import { Display } from './mats.js';
import { FLOORS, CAR, RAILS, SHEAVE, DEFLECTOR, GOVERNOR, ROPE, SPEC, TOP_Y, FACADE, MR, PIT_Y } from '../data/spec.js';
import { COMP, PIT } from './buildingGL.js';
import { Ropes } from './ropes.js';

const T = SPEC.doors.panelTravel, PW = 0.575;
const z0 = CAR.z0, z1 = CAR.z1, zc = CAR.zc, W = CAR.w / 2;
export const ROOF = 2.62;
/** The emergency trap door in the car roof: 0.5 x 0.5 m clear (EN 81-20: at least 0.40 x 0.50). */
export const HATCH = { x0: -0.85, x1: -0.35, z0: 16.1, z1: 16.6 };

export class ElevatorGL {
  constructor({ stage, M, labels, sim, controls, world, glass }) {
    Object.assign(this, { stage, M, labels, sim, controls, world, glass });
    this.car = new Group(); stage.scene.add(this.car);
    this.cw = new Group(); stage.scene.add(this.cw);
    this.display = new Display(192, 96);
    this.carJ = [0, 0, 0];
    this._carBody();
    this._cop();
    this._carDoor();
    this._roof();
    this._hatch();
    this._counterweight();
    this._ropes();
    this._colliders();
  }

  // -------------------------------------------------------------------------------------------
  _carBody() {
    const M = this.M, b = new Batch();
    // platform, sill, toe guard
    b.box(M.carFloor, -W - 0.05, -0.2, z0, W + 0.05, 0, z1 + 0.06, 2);
    b.box(M.aluminium, -0.62, -0.05, CAR.sillZ, 0.62, 0.002, z0, 1);
    b.box(M.paintDark, -W - 0.05, -0.2, CAR.sillZ, W + 0.05, -0.05, z0, 1);
    b.box(M.stainless, -0.62, -0.75, CAR.sillZ, 0.62, -0.05, CAR.sillZ + 0.008, 1);
    // the frames of the glass: corner posts, kick rail, top rail
    for (const [x, z] of [[-W - 0.03, z0], [W + 0.03, z0], [-W - 0.03, z1], [W + 0.03, z1]]) b.box(M.stainless, x - 0.03, 0, z - 0.03, x + 0.03, CAR.h, z + 0.03, 1);
    for (const [x0, x1, za, zb] of [[-W - 0.05, -W, z0, z1], [W, W + 0.05, z0, z1], [-W, W, z1 - 0.01, z1 + 0.04]]) { b.box(M.stainless, x0, 0, za, x1, 0.1, zb, 1); b.box(M.stainless, x0, CAR.h - 0.05, za, x1, CAR.h, zb, 1); }
    // the front wall (the door side): the returns and the transom
    b.box(M.stainless, -W - 0.05, 0, z0 - 0.04, -0.55, CAR.h, z0, 1);
    b.box(M.stainless, 0.55, 0, z0 - 0.04, W + 0.05, CAR.h, z0, 1);
    b.box(M.stainless, -0.55, CAR.doorH, z0 - 0.04, 0.55, CAR.h, z0, 1);
    // ceiling with its downlights
    { const H = HATCH;
      b.box(M.ceiling, -W - 0.05, CAR.h, z0 - 0.04, H.x0, ROOF, z1 + 0.06); b.box(M.ceiling, H.x1, CAR.h, z0 - 0.04, W + 0.05, ROOF, z1 + 0.06);
      b.box(M.ceiling, H.x0, CAR.h, z0 - 0.04, H.x1, ROOF, H.z0); b.box(M.ceiling, H.x0, CAR.h, H.z1, H.x1, ROOF, z1 + 0.06); }
    for (const [x, z] of [[-0.5, z0 + 0.45], [0.5, z0 + 0.45], [0.05, z1 - 0.45], [0.5, z1 - 0.45]]) b.add(cylGeo(0.07, 0.01, 'y', 20), M.downlight, x, CAR.h - 0.003, z);
    // the handrail along the glass, 0.9 m up
    const hr = 0.9;
    b.tube(M.mirrorSteel, [-W + 0.06, hr, z0 + 0.15], [-W + 0.06, hr, z1 - 0.06], 0.02);
    b.tube(M.mirrorSteel, [W - 0.06, hr, z0 + 0.15], [W - 0.06, hr, z1 - 0.06], 0.02);
    b.tube(M.mirrorSteel, [-W + 0.06, hr, z1 - 0.06], [W - 0.06, hr, z1 - 0.06], 0.02);
    for (const [x, z] of [[-W + 0.06, z0 + 0.3], [-W + 0.06, z1 - 0.3], [W - 0.06, z0 + 0.3], [W - 0.06, z1 - 0.3], [0, z1 - 0.06]]) b.tube(M.mirrorSteel, [x, hr, z], [x + Math.sign(x) * 0.05, hr, z + (Math.abs(x) < 0.1 ? 0.05 : 0)], 0.012);
    // the sling: stiles on the rail line, the crosshead, the safety plank
    const st = W + 0.14;
    for (const s of [-1, 1]) b.box(M.paintDark, s * st - 0.05, CAR.plank, zc - 0.08, s * st + 0.05, 3.3, zc + 0.08);
    b.box(M.paintDark, -st - 0.05, 3.08, zc - 0.1, st + 0.05, 3.3, zc + 0.1);
    b.box(M.paintDark, -st - 0.05, CAR.plank - 0.1, zc - 0.12, st + 0.05, CAR.plank + 0.1, zc + 0.12);
    b.box(M.paintDark, -W, -0.45, z0, W, -0.2, z1, 1);
    // roller guides, top and bottom, three wheels each round the rail's blade
    for (const s of [-1, 1]) for (const y of [3.2, CAR.plank - 0.05]) {
      const x = s * RAILS.car;
      b.add(cylGeo(0.075, 0.03, 'x', 16), M.rubber, x - s * 0.1, y, zc);
      b.add(cylGeo(0.075, 0.03, 'z', 16), M.rubber, x + s * 0.03, y, zc - 0.1);
      b.add(cylGeo(0.075, 0.03, 'z', 16), M.rubber, x + s * 0.03, y, zc + 0.1);
      b.box(M.paintYellow, x - 0.12, y - 0.04, zc - 0.13, x + 0.12, y + 0.04, zc - 0.12);
    }
    // the safety gear's housings under the plank, on each rail
    for (const s of [-1, 1]) b.box(M.paintDark, s * RAILS.car - 0.08, CAR.plank - 0.45, zc - 0.09, s * RAILS.car + 0.08, CAR.plank - 0.12, zc + 0.09);
    b.box(M.paintGrey, -0.3, CAR.striker - 0.05, zc - 0.15, 0.3, CAR.striker + 0.05, zc + 0.15);             // the striker plate
    b.box(M.paintDark, COMP.carX - 0.1, CAR.compHitch - 0.05, COMP.z - 0.1, COMP.carX + 0.1, -0.45, COMP.z + 0.1);
    b.build(this.car);
    // the wedges (they ride up when the gear sets) and the linkage's lever
    this.wedges = [];
    for (const s of [-1, 1]) { const w = boxMesh(M.paintYellow, 0.04, 0.16, 0.12); w.position.set(s * (RAILS.car - 0.045), CAR.plank - 0.36, zc); this.car.add(w); this.wedges.push(w); }
    this.linkLever = boxMesh(M.paintRed, 0.05, 0.05, 0.7); this.linkLever.position.set(GOVERNOR.x, CAR.plank + 0.15, (GOVERNOR.z - GOVERNOR.r + zc) / 2); this.car.add(this.linkLever);
    const gl = this.glass;
    gl.add([-W - 0.02, 0.1, z0 + 0.03], [0, 0, CAR.d - 0.06], [0, CAR.h - 0.15, 0], { moves: 1 });
    gl.add([W + 0.02, 0.1, z1 - 0.03], [0, 0, -(CAR.d - 0.06)], [0, CAR.h - 0.15, 0], { moves: 1 });
    gl.add([W - 0.02, 0.1, z1 + 0.01], [-(CAR.w - 0.04), 0, 0], [0, CAR.h - 0.15, 0], { moves: 1 });
  }

  // -------------------------------------------------------------------------------------------
  _cop() {
    const M = this.M, L = this.labels, C = this.controls, ctl = this.sim.ctl;
    const cop = new Object3D(); cop.position.set(0.8, 0, z0 + 0.002); this.car.add(cop);
    const plate = boxMesh(M.mirrorSteel, 0.44, 1.0, 0.012); plate.position.set(0, 1.25, 0.006); cop.add(plate);
    this.copPlate = plate;
    // behind the faceplate (the screwdriver takes it off): the button board, its chips and the loom
    const pcb = boxMesh(M.paintGreen, 0.4, 0.95, 0.004); pcb.position.set(0, 1.25, 0.002); cop.add(pcb);
    for (let i = 0; i < 6; i++) { const ch = boxMesh(M.plastic, 0.05, 0.03, 0.006); ch.position.set(-0.12 + (i % 3) * 0.12, 1.55 + Math.floor(i / 3) * 0.08, 0.004); cop.add(ch); }
    for (let i = 0; i < 5; i++) { const w = boxMesh(i % 2 ? M.paintRed : M.paintBlue, 0.006, 0.8, 0.006); w.position.set(-0.17 + i * 0.012, 1.2, 0.005); cop.add(w); }
    const btn = (x, y, cell, spec) => {
      const ring = new Mesh(cylGeo(0.026, 0.01, 'z', 24), M.btnRing); ring.position.set(x, y, 0.015); cop.add(ring);
      const face = new Mesh(cylGeo(0.02, 0.01, 'z', 24), M.btnOff); face.position.set(x, y, 0.018); cop.add(face);
      const lab = L.quad(cell, 0.026, 0.026, L.glow); lab.position.set(x, y, 0.0235); cop.add(lab);
      return C.add([ring, face, lab], { litMesh: face, litMat: M.btnLit, offMat: M.btnOff, ...spec });
    };
    // 150 floors do not fit as buttons: a keypad, as in real supertall cars (type the floor, then GO,
    // or wait two seconds); the display shows what you type
    this.entry = ''; this._entryT = 0;
    const go = () => {
      const n = Number(this.entry); this.entry = '';
      if (n >= 1 && n <= FLOORS) { ctl.pressCar(n); this.sim.sfx('beep'); this.sim.say(`Car call registered: floor ${n}.`, 'Car'); }
      else if (n) { this.sim.sfx('beep2'); this.sim.say(`There is no floor ${n} (1 to ${FLOORS}).`, 'Car'); }
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'GO'];
    keys.forEach((k, i) => {
      const col = i % 3, row = 3 - Math.floor(i / 3);
      btn(-0.1 + col * 0.1, 0.96 + row * 0.085, L.text('K' + k, k, { w: 64, h: 64, size: k === 'GO' ? 28 : 40, weight: 700 }), {
        id: `car.key${k}`, label: k === 'GO' ? 'Keypad: GO (send the car)' : k === 'C' ? 'Keypad: clear' : `Keypad: ${k}`,
        down: () => {
          if (k === 'GO') return go();
          if (k === 'C') { this.entry = ''; return; }
          if (this.entry.length < 3) this.entry += k;
          this._entryT = performance.now();
        },
        lit: () => k !== 'C' && k !== 'GO' && this.entry.endsWith(k) && performance.now() - this._entryT < 250,
      });
    });
    this._go = go;
    btn(-0.12, 0.855, L.symbol('open'), { id: 'car.open', label: 'Door open', kind: 'hold', down: () => (ctl.inputs.open = true), up: () => (ctl.inputs.open = false), lit: () => ctl.inputs.open });
    btn(0.0, 0.855, L.symbol('close'), { id: 'car.close', label: 'Door close', kind: 'hold', down: () => (ctl.inputs.close = true), up: () => (ctl.inputs.close = false), lit: () => ctl.inputs.close });
    btn(0, 0.785, L.text('ROPE', 'R', { w: 64, h: 64, size: 40, weight: 700 }), {
      id: 'car.rope', label: 'Part one hoist rope', down: () => {
        const h = this.sim.hoist;
        if (h.ropesCut || h.ropesLeft <= 0) return;
        h.ropesLeft -= 1; this.sim.sfx('snap');
        if (h.ropesLeft === 0) { h.ropesCut = true; this.sim.say('The last hoist rope has parted.', 'Simulator'); }
        else this.sim.say(`One hoist rope has parted: ${h.ropesLeft} of ${SPEC.ropes.n} still hold the car (safety factor now ${h.ropeSafety.toFixed(1)}).`, 'Simulator');
      },
      hint: () => `Part one hoist rope (${this.sim.hoist.ropesLeft} of ${SPEC.ropes.n} holding) · click`,
    });
    btn(0.12, 0.855, L.symbol('bell'), { id: 'car.alarm', label: 'Alarm (hold a second)', kind: 'hold', down: () => (ctl.inputs.alarm = true), up: () => (ctl.inputs.alarm = false), lit: () => ctl.inputs.alarm, litMat: M.amberLit });
    const disp = new Mesh(new PlaneGeometry(0.3, 0.15), this.display.mat); disp.position.set(0, 1.47, 0.0125); cop.add(disp);
    // the firefighters' cabinet: the Phase II key and call cancel; the independent service key
    const fc = boxMesh(M.paintRed, 0.38, 0.12, 0.012); fc.position.set(0, 1.65, 0.013); cop.add(fc);
    const fsym = L.quad(L.symbol('fire'), 0.04, 0.04, L.glow); fsym.position.set(-0.15, 1.65, 0.02); cop.add(fsym);
    const key = (x, id, label, order, get, set) => {
      const k = new Mesh(cylGeo(0.016, 0.02, 'z', 12), M.mirrorSteel); k.position.set(x, 1.65, 0.024); cop.add(k);
      const bar = boxMesh(M.paintDark, 0.007, 0.03, 0.008); bar.position.set(x, 1.65, 0.036); cop.add(bar);
      C.add([k, bar], {
        id, label, kind: 'switch',
        down: () => { const i = order.indexOf(get()); set(order[(i + 1) % order.length]); this.sim.sfx('clack'); },
        hint: () => `${label}: ${String(get()).toUpperCase()} (click to turn)`,
        show: () => { const i = order.indexOf(get()); bar.rotation.z = (i - (order.length - 1) / 2) * -0.8; },
      });
    };
    key(-0.06, 'fire2', 'Firefighters\' Phase II key', ['off', 'hold', 'on'], () => ctl.inputs.fire2, (v) => (ctl.inputs.fire2 = v));
    btn(0.05, 1.65, L.text('CC', 'CC', { w: 64, h: 64, size: 30, weight: 700 }), { id: 'car.cancel', label: 'Call cancel (firefighters\' service)', kind: 'hold', down: () => (ctl.inputs.cancel = true), up: () => (ctl.inputs.cancel = false), lit: () => ctl.inputs.cancel });
    key(0.15, 'independent', 'Independent service key', [false, true], () => ctl.inputs.independent, (v) => (ctl.inputs.independent = v));
  }

  // -------------------------------------------------------------------------------------------
  _carDoor() {
    const M = this.M, d = this.sim.doors, C = this.controls;
    this.doorPanels = [];
    for (const side of [-1, 1]) {
      const g = new Group(); this.car.add(g);
      const fb = new Batch();
      fb.box(M.stainless, -PW / 2, 0, -0.015, PW / 2, 0.06, 0.015, 1);
      fb.box(M.stainless, -PW / 2, CAR.doorH - 0.05, -0.015, PW / 2, CAR.doorH + 0.02, 0.015, 1);
      fb.box(M.stainless, -PW / 2, 0, -0.015, -PW / 2 + 0.05, CAR.doorH, 0.015, 1);
      fb.box(M.stainless, PW / 2 - 0.05, 0, -0.015, PW / 2, CAR.doorH, 0.015, 1);
      const [frame] = fb.build(g);
      g.position.set(side * PW / 2, 0, CAR.doorZ);
      this.doorPanels.push(g);
      this.glass.add([side < 0 ? -PW + 0.05 : 0.05, 0.06, CAR.doorZ], [PW - 0.1, 0, 0], [0, CAR.doorH - 0.11, 0], { moves: side < 0 ? 2 : 3 });
      // grip: the panel's frame (and the glass in it, through an invisible pickable sheet)
      const sheet = new Mesh(new PlaneGeometry(PW - 0.1, CAR.doorH - 0.12), M.btnOff); sheet.visible = false; sheet.position.set(0, CAR.doorH / 2, 0); g.add(sheet);
      sheet.userData.pickHidden = true;
      C.add([frame, sheet], {
        id: `carDoor.${side}`, label: 'Car door panel', kind: 'grab',
        drag: (dv) => { d.car.Fhand += Math.max(-300, Math.min(300, dv[0] * side * 900)) / 2; },
        hint: () => `Car door: ${Math.round(d.car.x * 100)} % open · hold and drag to push it (it is locked between floors)`,
      });
    }
    // the door operator on the roof, its motor and belt
    const op = new Batch();
    op.box(M.paintGrey, -W - 0.05, ROOF, z0 - 0.06, W + 0.05, ROOF + 0.26, z0 + 0.24);
    op.add(cylGeo(0.07, 0.14, 'z', 16), M.motor, 0.7, ROOF + 0.33, z0 + 0.08);
    op.box(M.rubber, -0.9, ROOF + 0.27, z0 + 0.03, 0.9, ROOF + 0.29, z0 + 0.04);
    op.build(this.car);
  }

  // -------------------------------------------------------------------------------------------
  _roof() {
    const M = this.M, C = this.controls, ctl = this.sim.ctl, b = new Batch();
    // the balustrade on the open sides, 1.1 m high
    const bh = ROOF + 1.1;
    for (const [x0, za, x1, zb] of [[-W - 0.04, z0 + 0.25, -W - 0.04, z1 + 0.04], [W + 0.04, z0 + 0.25, W + 0.04, z1 + 0.04], [-W - 0.04, z1 + 0.04, W + 0.04, z1 + 0.04]]) {
      b.tube(M.paintYellow, [x0, bh, za], [x1, bh, zb], 0.025);
      b.tube(M.paintYellow, [x0, ROOF + 0.55, za], [x1, ROOF + 0.55, zb], 0.02);
      b.box(M.paintYellow, Math.min(x0, x1) - 0.02, ROOF, Math.min(za, zb) - 0.02, Math.max(x0, x1) + 0.02, ROOF + 0.1, Math.max(za, zb) + 0.02);
    }
    for (const [x, z] of [[-W - 0.04, z0 + 0.25], [-W - 0.04, z1 + 0.04], [W + 0.04, z0 + 0.25], [W + 0.04, z1 + 0.04]]) b.tube(M.paintYellow, [x, ROOF, z], [x, bh, z], 0.025);
    // the rope hitch: eight shackle rods with their springs and the load cells
    for (let i = 0; i < 8; i++) {
      const z = zc + (i - 3.5) * 0.034;
      b.add(cylGeo(0.012, 0.3, 'y', 8), M.steel, 0, 3.45, z);
      b.add(cylGeo(0.03, 0.12, 'y', 10), M.paintYellow, 0, 3.36, z);
    }
    b.box(M.paintBlue, -0.08, 3.3, zc - 0.17, 0.08, 3.34, zc + 0.17);
    b.build(this.car);
    // the inspection station
    const st = new Object3D(); st.position.set(0.75, ROOF + 1.0, z0 + 0.38); st.rotation.x = -0.5; this.car.add(st);
    st.add(boxMesh(M.paintYellow, 0.36, 0.14, 0.12));
    const panelBtn = (x, id, label, kind, o) => {
      const r = 0.018;
      const ring = new Mesh(cylGeo(r * 1.3, 0.02, 'y', 16), M.btnRing); ring.position.set(x, 0.075, 0); st.add(ring);
      const face = new Mesh(cylGeo(r, 0.024, 'y', 16), o.red ? M.paintRed : o.black ? M.btnOff : M.paintBlue); face.position.set(x, 0.08, 0); st.add(face);
      const lab = o.sym ? this.labels.quad(this.labels.symbol(o.sym), 0.03, 0.03, this.labels.engraved) : this.labels.quad(this.labels.text('I' + id, o.text, { w: 96, h: 48, size: 28, weight: 700 }), 0.05, 0.025, this.labels.engraved);
      lab.rotation.x = -Math.PI / 2; lab.position.set(x, 0.071, 0.045); st.add(lab);
      if (kind === 'hold') return C.add([ring, face], { id, label, kind: 'hold', down: () => { o.set(true); this.sim.sfx('click'); }, up: () => o.set(false) });
      return C.add([ring, face], { id, label, kind: 'switch', down: () => { o.set(!o.get()); this.sim.sfx('clack'); }, hint: () => `${label}: ${o.get() ? o.on : o.off} (click)`, show: () => { face.position.y = o.get() ? 0.07 : 0.08; } });
    };
    panelBtn(-0.14, 'insp', 'Inspection switch (car roof)', 'switch', { get: () => ctl.inputs.insp, set: (v) => (ctl.inputs.insp = v), text: 'INSP', black: true, on: 'INSPECTION', off: 'NORMAL' });
    panelBtn(-0.07, 'inspUp', 'Inspection UP (hold: COMMON goes in with it)', 'hold', { set: (v) => { ctl.inputs.inspUp = v; ctl.inputs.inspCommon = v; if (v && !ctl.inputs.insp) this.sim.say('Nothing happens: turn the INSP switch (left) to INSPECTION first.', 'Car roof'); }, sym: 'up' });
    panelBtn(0.0, 'inspCommon', 'Inspection COMMON / RUN (hold)', 'hold', { set: (v) => (ctl.inputs.inspCommon = v), text: 'COM', black: true });
    panelBtn(0.07, 'inspDown', 'Inspection DOWN (hold: COMMON goes in with it)', 'hold', { set: (v) => { ctl.inputs.inspDown = v; ctl.inputs.inspCommon = v; if (v && !ctl.inputs.insp) this.sim.say('Nothing happens: turn the INSP switch (left) to INSPECTION first.', 'Car roof'); }, sym: 'down' });
    panelBtn(0.14, 'carTopStop', 'Car roof STOP switch', 'switch', { get: () => ctl.inputs.carTopStop, set: (v) => (ctl.inputs.carTopStop = v), red: true, text: 'STOP', on: 'STOP', off: 'RUN' });
  }

  // -------------------------------------------------------------------------------------------
  _counterweight() {
    const M = this.M, b = new Batch();
    const H = ROPE.cwHeight, hw = 0.1, hz = RAILS.cwHalfZ - 0.07;
    b.box(M.paintDark, -hw - 0.02, 0, -hz, hw + 0.02, 0.18, hz);
    b.box(M.paintDark, -hw - 0.02, H - 0.18, -hz, hw + 0.02, H, hz);
    for (const s of [-1, 1]) b.box(M.paintDark, -hw - 0.02, 0, s * hz - 0.05, hw + 0.02, H, s * hz + 0.05);
    // cast-iron fillers, 40 mm each
    for (let y = 0.2; y < H - 0.22; y += 0.042) b.box(M.castIron, -hw + 0.01, y, -hz + 0.06, hw - 0.01, y + 0.039, hz - 0.06);
    // hazard stripes on its foot, the striker, the shoes
    for (let k = 0; k < 6; k++) b.box(k % 2 ? M.paintDark : M.paintYellow, hw + 0.021, 0, -hz + (k * 2 * hz) / 6, hw + 0.025, 0.18, -hz + ((k + 1) * 2 * hz) / 6);
    b.box(M.paintGrey, -0.08, -0.06, -0.08, 0.08, 0, 0.08);
    for (const s of [-1, 1]) for (const y of [0.1, H - 0.1]) b.box(M.rubber, -0.05, y - 0.08, s * (hz + 0.05), 0.05, y + 0.08, s * (hz + 0.09));
    b.box(M.paintBlue, -0.06, H, -0.17, 0.06, H + 0.05, 0.17);
    b.build(this.cw);
    this.cw.position.set(RAILS.cwX, 0, CAR.zc);
  }

  // -------------------------------------------------------------------------------------------
  /** Rope bundles: unit-height geometry stretched between their ends each frame. */
  _bundle(n, r, spacing, mat, axisZ = true) {
    const list = [];
    for (let i = 0; i < n; i++) { const g = cylGeo(r, 1, 'y', 6); g.translate(axisZ ? 0 : (i - (n - 1) / 2) * spacing, 0.5, axisZ ? (i - (n - 1) / 2) * spacing : 0); list.push(g); }
    const m = new Mesh(merge(list), mat); m.castShadow = true; m.frustumCulled = false;
    this.stage.scene.add(m);
    return m;
  }
  _span(m, x, y0, y1, z) { m.position.set(x, Math.min(y0, y1), z); m.scale.y = Math.max(0.001, Math.abs(y1 - y0)); }

  /** The ropes move: their sway, and a parted rope's fall (each strand that has gone becomes two falling chains). */
  _ropeUpdate() {
    const h = this.sim.hoist, now = performance.now(), dt = this._ropeT ? Math.min(0.05, (now - this._ropeT) / 1000) * (this.sim.timeScale ?? 1) : 0;
    this._ropeT = now;
    for (let i = 0; i < SPEC.ropes.n; i++) {
      const live = !h.ropesCut && i < h.ropesLeft;
      if (live && this._parted.has(i)) { for (const c of this._parted.get(i)) this.ropes.chains.splice(this.ropes.chains.indexOf(c), 1); this._parted.delete(i); }
      if (!live && !this._parted.has(i)) {
        const z = zc + (i - (SPEC.ropes.n - 1) / 2) * 0.034, x = SHEAVE.x + SHEAVE.r, LINKS = 40;
        const line = (x0, y0, y1, zz) => Array.from({ length: LINKS }, (_, k) => [x0, y0 + (y1 - y0) * (k / (LINKS - 1)), zz]);
        const roof = () => [[-W - 0.1, W + 0.1, z0 - 0.1, z1 + 0.1, h.yc + ROOF + 0.3], [RAILS.cwX - 0.35, RAILS.cwX + 0.35, zc - 0.5, zc + 0.5, h.yw + ROPE.cwHeight]];
        this._parted.set(i, [
          this.ropes.chain(() => [x, this._carHitch(), z], line(x, this._carHitch(), ROPE.carTop, z), 0.0065, roof),
          this.ropes.chain(() => [RAILS.cwX, this._cwHitch(), z], line(RAILS.cwX, this._cwHitch(), ROPE.cwTop, z), 0.0065, roof),
        ]);
      }
    }
    // the ropes hang in a swaying tower: its acceleration two thirds of the way up drives them (earthquake included)
    this.ropes.selfWind = false;
    const A = this.sim.atmos.accelAt(TOP_Y * 0.67), q = this.sim.shake?.a;
    this.ropes.update(dt, [A[0] + (q?.[0] ?? 0), 0, A[2] + (q?.[2] ?? 0)], [[PIT.x0 + 0.1, PIT_Y + 0.05, FACADE + 0.15], [PIT.x1 - 0.1, 1e4, PIT.z1 - 0.1]]);
  }

  _ropes() {
    const M = this.M;
    // the hoist and compensating ropes, strand by strand (render/ropes.js)
    const h = this.sim.hoist, N = SPEC.ropes.n, R = (this.ropes = new Ropes(this.stage.scene, M.rope));
    const mu = SPEC.ropes.kgPerM / N, muC = SPEC.comp.kgPerM / SPEC.comp.n;
    const off = (i, n, d) => (i - (n - 1) / 2) * d;
    this._ropeErr = Array.from({ length: N }, (_, i) => ((i * 7919) % 13) / 13 * 0.006 - 0.003);   // each rope a few mm longer or shorter
    const live = (i) => !h.ropesCut && i < h.ropesLeft;
    this._carHitch = () => h.yc + CAR.crosshead + 0.3;
    this._cwHitch = () => h.yw + ROPE.cwHeight;
    // one rope's share of the car side: the hitch springs (120 kN/m) in series with the rope even out the length errors
    const share = (i, Ttot, L) => {
      let nl = 0, mean = 0; for (let j = 0; j < N; j++) if (live(j)) { nl++; mean += this._ropeErr[j]; }
      if (!nl) return 0; mean /= nl;
      const kr = SPEC.ropes.EA / N / Math.max(1, L), k = 1 / (1 / 120e3 + 1 / kr);
      return Math.max(0, Ttot / nl + k * (this._ropeErr[i] - mean));
    };
    R.run({ n: N, r: 0.0065, mu, live, ends: (i) => { const x = SHEAVE.x + SHEAVE.r, z = zc + off(i, N, 0.034); return [[x, this._carHitch(), z], [x, ROPE.carTop, z]]; },
      T: (i) => share(i, h.Tc, ROPE.carTop - this._carHitch()), spring: (i) => ({ len: Math.max(0.04, 0.14 - share(i, h.Tc, ROPE.carTop - this._carHitch()) / 120e3), r: 0.014 }) });
    R.run({ n: N, r: 0.0065, mu, live, ends: (i) => { const z = zc + off(i, N, 0.034); return [[RAILS.cwX, this._cwHitch(), z], [RAILS.cwX, ROPE.cwTop, z]]; },
      T: (i) => share(i, h.Tw, ROPE.cwTop - this._cwHitch()) });
    R.run({ n: SPEC.comp.n, r: 0.009, mu: muC, ends: (i) => { const z = COMP.z + off(i, SPEC.comp.n, 0.05); return [[COMP.carX, h.ts, z], [COMP.carX, h.yc + CAR.compHitch, z]]; }, T: () => (h.Tb ?? 5000) / SPEC.comp.n });
    R.run({ n: SPEC.comp.n, r: 0.009, mu: muC, ends: (i) => { const z = COMP.z + off(i, SPEC.comp.n, 0.05); return [[RAILS.cwX, h.ts, z], [RAILS.cwX, h.yw, z]]; }, T: () => (h.Tb ?? 5000) / SPEC.comp.n });
    this._parted = new Map();
    // the ropes from the traction sheave down to the deflector, in the machine room floor (they run, but look the same)
    const b = new Batch();
    for (let i = 0; i < 8; i++) {
      const z = zc + (i - 3.5) * 0.034;
      b.tube(M.rope, [SHEAVE.x - SHEAVE.r, SHEAVE.y, z], [DEFLECTOR.x + DEFLECTOR.r * 0.7, DEFLECTOR.y + DEFLECTOR.r * 0.7, z], 0.0065, 6);
      b.add(cylGeo(SHEAVE.r + 0.004, 0.012, 'z', 32), M.rope, SHEAVE.x, SHEAVE.y, z);
    }
    // the governor rope: two strands from the governor down to its tension pulley in the pit
    for (const s of [-1, 1]) b.tube(M.rope, [GOVERNOR.x, GOVERNOR.y, GOVERNOR.z + s * GOVERNOR.r], [GOVERNOR.x, GOVERNOR.tensionY, GOVERNOR.z + s * GOVERNOR.r], 0.004, 5);
    b.build(this.stage.scene, { shadow: false });
    // the travelling cable: a flat band hanging in a loop from under the car to its fixing half way up
    this.cableCar = boxMesh(M.paintDark, 0.05, 1, 0.012); this.cableCar.geometry.translate(0, 0.5, 0); this.stage.scene.add(this.cableCar);
    this.cableFix = boxMesh(M.paintDark, 0.05, 1, 0.012); this.cableFix.geometry.translate(0, 0.5, 0); this.stage.scene.add(this.cableFix);
    this.cableLoop = new Mesh(cylGeo(0.16, 0.05, 'x', 12), M.paintDark); this.stage.scene.add(this.cableLoop);
  }

  // -------------------------------------------------------------------------------------------
  /** The car's surfaces and its door panels, as moving boxes in the physics world. */
  _colliders() {
    const h = this.sim.hoist, d = this.sim.doors, w = this.world;
    const vel = () => [0, h.vc, 0];
    const acc = (J) => { this.carJ[0] += J[0]; this.carJ[1] += J[1]; this.carJ[2] += J[2]; };
    const box = (x0, y0, za, x1, y1, zb, mu) => w.mover({ bounds: () => [[x0, h.yc + y0, za], [x1, h.yc + y1, zb]], vel, onImpulse: acc, mu, car: true });
    box(-W - 0.05, -0.25, CAR.sillZ, W + 0.05, 0, z1 + 0.06, 0.7);                       // floor
    box(-W - 0.2, 0, z0 - 0.04, -W, CAR.h, z1 + 0.06);                                     // west glass
    box(W, 0, z0 - 0.04, W + 0.2, CAR.h, z1 + 0.06);                                       // east glass
    box(-W - 0.2, 0, z1, W + 0.2, CAR.h, z1 + 0.2);                                        // back glass
    box(-W - 0.05, 0, z0 - 0.04, -0.55, CAR.h, z0);                                       // front returns
    box(0.55, 0, z0 - 0.04, W + 0.05, CAR.h, z0);
    box(-0.55, CAR.doorH, z0 - 0.04, 0.55, CAR.h, z0);
    { const H = HATCH;                                                                   // ceiling and roof, round the hatch
      box(-W - 0.05, CAR.h, z0 - 0.06, H.x0, ROOF, z1 + 0.06); box(H.x1, CAR.h, z0 - 0.06, W + 0.05, ROOF, z1 + 0.06);
      box(H.x0, CAR.h, z0 - 0.06, H.x1, ROOF, H.z0); box(H.x0, CAR.h, H.z1, H.x1, ROOF, z1 + 0.06);
      w.mover({ bounds: () => ((d.hatch ?? 0) < 0.4 ? [[H.x0, h.yc + CAR.h, H.z0], [H.x1, h.yc + ROOF, H.z1]] : null), vel, onImpulse: acc, car: true }); }
    box(-W - 0.05, ROOF, z0 - 0.06, W + 0.05, ROOF + 0.26, z0 + 0.24);                   // door operator
    box(-W - 0.1, ROOF, z0 + 0.24, -W - 0.02, ROOF + 1.1, z1 + 0.08);                      // balustrade
    box(W + 0.02, ROOF, z0 + 0.24, W + 0.1, ROOF + 1.1, z1 + 0.08);
    box(-W - 0.1, ROOF, z1 + 0.02, W + 0.1, ROOF + 1.1, z1 + 0.1);
    box(-W - 0.19, 3.08, zc - 0.1, W + 0.19, 3.3, zc + 0.1);                               // crosshead
    box(0.55, ROOF, z0 + 0.25, 0.95, ROOF + 1.0, z0 + 0.5);                                // inspection station
    for (const side of [-1, 1]) {
      const xc = () => side * (PW / 2 + d.car.x * T);
      w.mover({
        bounds: () => [[xc() - PW / 2, h.yc + 0.01, CAR.doorZ - 0.016], [xc() + PW / 2, h.yc + CAR.doorH, CAR.doorZ + 0.016]],
        vel: () => [side * d.car.v, h.vc, 0],
        onImpulse: (J, dt) => { d.car.Fext += (J[0] * side) / dt / 2; this.carJ[1] += J[1]; },
        car: true,
      });
    }
    w.after.push((dt) => { h.propForce = this.carJ[1] / dt + (this.playerForce ?? 0); this.carJ = [0, 0, 0]; w.carY = h.yc; });
  }

  // -------------------------------------------------------------------------------------------
  _hatch() {
    const M = this.M, H = HATCH, d = this.sim.doors, g = new Group();
    g.position.set((H.x0 + H.x1) / 2, ROOF + 0.015, H.z1); this.car.add(g);
    const lid = boxMesh(M.stainless, H.x1 - H.x0 + 0.04, 0.03, H.z1 - H.z0 + 0.04, 1); lid.position.z = -(H.z1 - H.z0) / 2; g.add(lid);
    const handle = boxMesh(M.paintYellow, 0.14, 0.03, 0.03); handle.position.set(0, 0.03, -(H.z1 - H.z0) + 0.06); g.add(handle);
    this.hatchLid = g; d.hatch = 0; d.hatchCmd = 0;
    this.controls.add([lid, handle], {
      id: 'hatch', label: 'Emergency trap door in the car roof', kind: 'switch',
      down: () => {
        const P = this.game?.player, inside = P && P.p[1] < this.sim.hoist.yc + 2;
        if (inside && !d.hatchCmd && !this.hasKey?.()) { this.sim.say('From inside the car the trap door only opens with a key (the hoistway door key fits).', 'You'); return; }
        d.hatchCmd = d.hatchCmd ? 0 : 1;
        this.sim.say(d.hatchCmd ? 'Trap door open: its safety contact opens the chain, so the car cannot move. E under or beside it: climb through.' : 'Trap door shut and latched.', 'You');
      },
      hint: () => `Car roof trap door: ${d.hatch > 0.5 ? 'open' : 'shut'} · click to ${d.hatch > 0.5 ? 'shut' : 'open'} it · E beside it when open: climb through`,
    });
  }

  update() {
    const dd = this.sim.doors;
    dd.hatch += Math.max(-0.02, Math.min(0.02, (dd.hatchCmd ?? 0) - dd.hatch));
    if (this.hatchLid) this.hatchLid.rotation.x = dd.hatch * 1.9;
    const sim = this.sim, h = sim.hoist, d = sim.doors, ctl = sim.ctl;
    this.car.position.y = h.yc;
    this.cw.position.y = h.yw;
    const dx = d.car.x * T;
    this.doorPanels[0].position.x = -(PW / 2 + dx);
    this.doorPanels[1].position.x = PW / 2 + dx;
    this.glass.carY = h.yc; this.glass.doorX = dx;
    const D = ctl.display;
    if (this.entry && performance.now() - this._entryT > 2000) this._go();
    this.display.draw(D.text, D.dir, this.entry ? `Floor ${this.entry}_` : D.msg);
    // the safety gear's wedges ride up the rails as it sets; the linkage lever follows the governor rope
    for (const w of this.wedges) w.position.y = CAR.plank - 0.36 + 0.05 * h.sg.engage;
    this.linkLever.rotation.x = Math.min(0.5, h.gov.link * 6);
    // ropes
    this._ropeUpdate();
    // the travelling cable's loop hangs half way between its ends (it is 10 m longer than half the rise)
    const yCar = h.yc - 0.45, yFix = TOP_Y / 2;
    const S = TOP_Y / 2 + 10, low = (yCar + yFix - S + Math.PI * 0.16) / 2;
    this._span(this.cableCar, 0.75, low, yCar, FACADE + 0.32);
    this._span(this.cableFix, 0.75, low, yFix, FACADE + 0.08);
    this.cableLoop.position.set(0.75, low, FACADE + 0.2);
    // the car's lamps: the downlights, and their glints in the glass
    const lit = ctl.powered && !ctl.inputs.brkLight && !ctl.standby;
    this.M.downlight.emissiveIntensity = lit ? 6 : 0.6;
    this.glass.interior = lit ? [0.03, 0.028, 0.025] : [0.004, 0.004, 0.004];
    this.glass.lamp = lit ? [0.6, 0.55, 0.5] : [0, 0, 0];
    void MR;
  }
}
