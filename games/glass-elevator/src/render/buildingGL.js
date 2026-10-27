/**
 * The tower and what is round it: the city on the Stockholm waterfront, the plaza and the quay,
 * the tower's mirror-glass curtain wall, its thirty lift lobbies (each with its landing door,
 * hall buttons, hall lantern, position indicator, the triangle unlocking keyhole and the door to
 * the stairs), the machine room on the roof (the machine, its brakes, the governor, the
 * controller and drive cabinets, the main switch and the panels), and the pit at the foot of the
 * hoistway (the buffers, the tension sheaves, the stop switch, the ladder).
 *
 * Every surface you can stand on or bump into is also a box in the physics world.
 */
import { Group, Mesh, PlaneGeometry, Object3D } from 'three';
import { Batch, boxMesh, cylGeo } from './build.js';
import { Display } from './mats.js';
import { FLOORS, floorY, FACADE, TOWER, ROOF_Y, MR, PIT_Y, CAR, RAILS, SHEAVE, DEFLECTOR, GOVERNOR, BUFFER, SPEC, TOP_Y } from '../data/spec.js';
import { TS_Y0 } from '../physics/hoist.js';

/** The compensating ropes hang from the car and the counterweight behind the buffers, round the tension sheave. */
export const COMP = { x: -1.25, z: CAR.zc + 0.25, carX: -0.45 };

export const LOBBY = { x0: -3.3, x1: 3.3, z0: 11.0, z1: 14.7, h: 3.0 };
export const LOBBY1 = { x0: -8, x1: 8, z0: 7, z1: 14.7, h: 5.7 };
export const PIT = { x0: -2.8, x1: 2.0, z0: FACADE, z1: 17.4 };
export const PANEL_W = 0.575;
const F = FACADE;
const lobbyOf = (n) => (n === 1 ? LOBBY1 : LOBBY);

export class BuildingGL {
  constructor({ stage, M, labels, sim, controls, world, glass }) {
    Object.assign(this, { stage, M, labels, sim, controls, world, glass });
    this.root = new Group(); stage.scene.add(this.root);
    this.hallDisplay = new Display(160, 80);
    this.mrDisplay = new Display(256, 96);
    this.landing = [null];
    this.spots = [];             // stairs, ladders, doors you go through with E
    const b = new Batch(), s = new Batch();   // b: casts shadows, s: does not need to
    this._city(b, s);
    this._tower(b);
    for (let n = 1; n <= FLOORS; n++) this._lobby(n, b);
    this._hoistway(b);
    this._machineRoom(b);
    this._pit(b);
    b.build(this.root);
    s.build(this.root, { shadow: false });
  }

  solid(x0, y0, z0, x1, y1, z1, mu) { this.world.solid([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], mu ? { mu } : {}); }
  /** A box drawn and solid. */
  wall(b, mat, x0, y0, z0, x1, y1, z1, uv = 1) { b.box(mat, x0, y0, z0, x1, y1, z1, uv); this.solid(x0, y0, z0, x1, y1, z1); }

  // -------------------------------------------------------------------------------------------
  _city(b, s) {
    const M = this.M;
    // the ground north, east and west of the tower; the plaza and quay to the south; the water
    this.wall(b, M.asphalt, -600, -0.4, -600, 600, 0, F - 0.001);
    const pz = 70;
    this.wall(b, M.paver, -120, -0.4, PIT.z1, 120, 0, pz, 3);
    this.wall(b, M.paver, -120, -0.4, F, PIT.x0, 0, PIT.z1, 3);
    this.wall(b, M.paver, PIT.x1, -0.4, F, 120, 0, PIT.z1, 3);
    b.box(M.concrete, -600, -2.6, pz, 600, -0.05, pz + 1.2, 2);                 // the quay's edge
    s.box(M.water, -3000, -1.6, pz + 1.2, 3000, -1.2, 3000);
    // a few lime trees on the plaza
    for (const [x, z] of [[-12, 30], [-6, 42], [6, 36], [14, 27], [20, 48], [-20, 50]]) {
      b.cyl(M.wood, x, 1.5, z, 0.16, 3, 'y', 8);
      b.add(cylGeo(2.2, 3.6, 'y', 10, 0.6), M.leaf, x, 4.6, z);
      this.solid(x - 0.2, 0, z - 0.2, x + 0.2, 3, z + 0.2);
    }
    // the city: blocks round the tower, and the far shore across the water
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const mats = [M.cityA, M.cityB, M.cityC];
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2, r = 70 + rnd() * 420;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8 - 60;
      if (z > 40) continue;
      if (Math.abs(x) < 40 && Math.abs(z) < 40) continue;
      const w = 18 + rnd() * 30, d = 18 + rnd() * 30, h = rnd() < 0.15 ? 60 + rnd() * 50 : 14 + rnd() * 30;
      b.box(mats[i % 3], x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, 4);
    }
    for (let i = 0; i < 70; i++) {
      const x = -1400 + i * 40 + rnd() * 20, z = 650 + rnd() * 250, w = 25 + rnd() * 30, h = 12 + rnd() * 26 + (Math.abs(x) < 400 ? 20 : 0);
      s.box(mats[i % 3], x - w / 2, -1.2, z, x + w / 2, h, z + 30, 4);
    }
  }

  // -------------------------------------------------------------------------------------------
  _tower(b) {
    const M = this.M, top = TOWER.top;
    M.curtain.map.repeat.set(1 / 1.5, 1 / 3.9);
    M.curtain.map.offset.set(0, -6 / 3.9);
    const C = M.curtain;
    // north, east and west faces, the roof
    b.box(C, TOWER.x0, 0, TOWER.z0, TOWER.x1, top, TOWER.z0 + 0.3);
    b.box(C, TOWER.x0, 0, TOWER.z0, TOWER.x0 + 0.3, top, F);
    b.box(C, TOWER.x1 - 0.3, 0, TOWER.z0, TOWER.x1, top, F);
    this.wall(b, M.concrete, TOWER.x0, ROOF_Y - 0.3, TOWER.z0, TOWER.x1, ROOF_Y, F, 2);
    // the south face, with the landing door openings up the middle and the entrance at the foot
    const fz0 = F - 0.3;
    this.wall(b, C, TOWER.x0, 0, fz0, -0.55, top, F);
    this.wall(b, C, 0.55, 2.6, fz0, TOWER.x1, top, F);
    this.wall(b, C, 0.55, 0, fz0, 5, 2.6, F);
    this.wall(b, C, 7, 0, fz0, TOWER.x1, 2.6, F);
    for (let n = 1; n <= FLOORS; n++) {
      const y0 = floorY(n), y1 = n < FLOORS ? floorY(n + 1) - 0.3 : top;
      this.wall(b, C, -0.55, y0 + CAR.doorH, fz0, 0.55, y1, F);
      if (n < FLOORS) this.wall(b, C, -0.55, y1, fz0, 0.55, floorY(n + 1), F);
    }
    // roof plant and the stair house
    b.box(M.paintGrey, -12, ROOF_Y, -8, -6, ROOF_Y + 2.4, -2);
    b.box(M.paintGrey, 6, ROOF_Y, -10, 12, ROOF_Y + 2.0, -4);
    b.box(M.concrete, 4, ROOF_Y, 6, 9, ROOF_Y + 3.4, 12, 2);
  }

  // -------------------------------------------------------------------------------------------
  _lobby(n, b) {
    const M = this.M, L = lobbyOf(n), y0 = floorY(n), H = L.h;
    // floor, ceiling, walls
    this.wall(b, M.lobbyFloor, L.x0, y0 - 0.3, L.z0, L.x1, y0, L.z1, 3);
    this.wall(b, M.aluminium, -0.62, y0 - 0.05, L.z1, 0.62, y0, F + 0.035);   // the landing sill
    this.wall(b, M.ceiling, L.x0, y0 + H, L.z0, L.x1, y0 + H + 0.1, L.z1);
    this.wall(b, M.plaster, L.x0 - 0.3, y0, L.z0, L.x0, y0 + H, L.z1);
    this.wall(b, M.plaster, L.x1, y0, L.z0, L.x1 + 0.3, y0 + H, L.z1);
    this.wall(b, M.plaster, L.x0, y0, L.z0 - 0.3, L.x1, y0 + H, L.z0);
    // the wall with the landing door, lined inside; the entrance on the lobby floor
    const z0 = L.z1 - 0.1;
    if (n === 1) {
      this.wall(b, M.plaster, L.x0, 0, z0, -0.7, H, L.z1);
      this.wall(b, M.plaster, 0.7, 0, z0, 5, H, L.z1);
      this.wall(b, M.plaster, 5, 2.6, z0, 7, H, L.z1);
      this.wall(b, M.plaster, 7, 0, z0, L.x1, H, L.z1);
      this.wall(b, M.plaster, -0.7, 2.3, z0, 0.7, H, L.z1);
      b.box(M.stainless, 4.9, 0, z0 - 0.05, 5, 2.7, F, 1); b.box(M.stainless, 7, 0, z0 - 0.05, 7.1, 2.7, F, 1); b.box(M.stainless, 4.9, 2.6, z0 - 0.05, 7.1, 2.7, F, 1);
      // reception desk and a bench
      this.wall(b, M.wood, -6.5, 0, 9, -3.5, 1.05, 10);
      b.box(M.stainless, -6.6, 1.05, 8.9, -3.4, 1.1, 10.1);
      this.wall(b, M.wood, 3, 0, 8, 6, 0.45, 8.5);
    } else {
      this.wall(b, M.plaster, L.x0, y0, z0, -0.7, y0 + H, L.z1);
      this.wall(b, M.plaster, 0.7, y0, z0, L.x1, y0 + H, L.z1);
      this.wall(b, M.plaster, -0.7, y0 + 2.3, z0, 0.7, y0 + H, L.z1);
    }
    // the landing door's portal (stainless jambs and head)
    b.box(M.stainless, -0.7, y0, z0 - 0.05, -0.55, y0 + 2.3, F, 1);
    b.box(M.stainless, 0.55, y0, z0 - 0.05, 0.7, y0 + 2.3, F, 1);
    b.box(M.stainless, -0.7, y0 + CAR.doorH, z0 - 0.05, 0.7, y0 + 2.3, F, 1);
    // its track and header on the hoistway side
    b.box(M.paintDark, -1.3, y0 + CAR.doorH, F, 1.3, y0 + CAR.doorH + 0.16, F + 0.05);
    // ceiling lights
    for (const x of n === 1 ? [-5, -1.5, 2, 5.5] : [-1.6, 1.6]) for (const z of n === 1 ? [9, 12.5] : [12.8]) b.box(M.lampPanel, x - 0.3, y0 + H - 0.01, z - 0.3, x + 0.3, y0 + H, z + 0.3);
    // the stairs door (west wall), the office door (east)
    const sx = L.x0 + 0.01;
    b.box(M.wood, sx, y0, 11.7, sx + 0.04, y0 + 2.1, 12.7);
    b.box(M.stainless, sx, y0 + 1.0, 12.55, sx + 0.08, y0 + 1.05, 12.62);
    const exit = this.labels.text('EXIT', 'EXIT', { w: 128, h: 48, size: 34, weight: 700 });
    const ex = this.labels.quad(exit, 0.4, 0.15, this.labels.glowGreen); ex.position.set(sx + 0.02, y0 + 2.35, 12.2); ex.rotation.y = Math.PI / 2; this.root.add(ex);
    b.box(M.wood, L.x1 - 0.05, y0, 12.0, L.x1 - 0.01, y0 + 2.1, 13.2);
    this.spots.push({ kind: 'stairs', floor: n, pos: [L.x0 + 0.5, y0, 12.2], label: n === FLOORS ? 'stairs: E up to the machine room, Q down' : n === 1 ? 'stairs: E up a floor' : 'stairs: E up a floor, Q down a floor' });
    // the floor's number, big, beside the door
    const fl = this.labels.text('F' + n, String(n), { w: 96, h: 96, size: 64, weight: 300 });
    const fm = this.labels.quad(fl, 0.42, 0.42); fm.position.set(-1.6, y0 + 1.55, z0 - 0.005); fm.rotation.y = Math.PI; this.root.add(fm);
    // ---- the hall station ----
    const C = this.controls, ctl = this.sim.ctl;
    const st = new Object3D(); st.position.set(1.05, y0 + 1.0, z0 - 0.005); st.rotation.y = Math.PI; this.root.add(st);
    const plate = boxMesh(M.stainless, 0.13, n === 1 || n === FLOORS ? 0.16 : 0.26, 0.01); st.add(plate);
    const H_ = { up: null, down: null };
    for (const dir of [1, -1]) {
      if ((dir > 0 && n === FLOORS) || (dir < 0 && n === 1)) continue;
      const y = n === 1 || n === FLOORS ? 0 : dir * 0.055;
      const ring = new Mesh(cylGeo(0.024, 0.012, 'z', 20), M.btnRing); ring.position.set(0, y, 0.008); st.add(ring);
      const face = new Mesh(cylGeo(0.018, 0.012, 'z', 20), M.btnOff); face.position.set(0, y, 0.011); st.add(face);
      const lab = this.labels.quad(this.labels.symbol(dir > 0 ? 'up' : 'down'), 0.022, 0.022, this.labels.glow); lab.position.set(0, y, 0.0175); st.add(lab);
      H_[dir > 0 ? 'up' : 'down'] = C.add([ring, face, lab], {
        id: `hall.${n}.${dir > 0 ? 'up' : 'down'}`, label: `Floor ${n} hall call ${dir > 0 ? 'UP' : 'DOWN'}`, floor: n,
        down: () => { ctl.pressHall(n, dir); this.sim.sfx('click', { floor: n }); },
        lit: () => (dir > 0 ? ctl.calls.up[n] : ctl.calls.down[n]), litMesh: face, litMat: M.btnLit, offMat: M.btnOff,
      });
    }
    // the hall lantern and the position indicator over the door
    const lan = new Object3D(); lan.position.set(0, y0 + 2.48, z0 - 0.005); lan.rotation.y = Math.PI; this.root.add(lan);
    const lb = boxMesh(M.stainless, 0.5, 0.14, 0.02); lan.add(lb);
    const lu = new Mesh(cylGeo(0.045, 0.02, 'z', 3), M.lensOff); lu.rotation.z = Math.PI; lu.position.set(-0.12, 0, 0.012); lan.add(lu);
    const ld = new Mesh(cylGeo(0.045, 0.02, 'z', 3), M.lensOff); ld.position.set(0.12, 0, 0.012); lan.add(ld);
    const disp = new Mesh(new PlaneGeometry(0.26, 0.13), this.hallDisplay.mat); disp.position.set(0, 0.17, 0.011); lan.add(disp);
    // the unlocking keyhole in the door head (the triangle)
    const tri = this.labels.quad(this.labels.symbol('triangle'), 0.05, 0.05); tri.position.set(0.42, y0 + 2.2, z0 - 0.056); tri.rotation.y = Math.PI; this.root.add(tri);
    C.add(tri, { id: `unlock.${n}`, label: `Floor ${n} landing door: emergency unlocking (triangle key)`, kind: 'key', down: () => { this.sim.doors.unlock(n); this.sim.say(`You turn the triangle key in floor ${n}'s landing door: its lock lifts for a few seconds. Pull the door open by hand.`, 'You'); this.sim.sfx('clack', { floor: n }); } });
    // fire service Phase I key switch at the lobby
    if (n === 1) {
      const fp = new Object3D(); fp.position.set(1.75, 1.45, z0 - 0.005); fp.rotation.y = Math.PI; this.root.add(fp);
      fp.add(boxMesh(M.paintRed, 0.16, 0.22, 0.01));
      const fl2 = this.labels.quad(this.labels.symbol('fire'), 0.05, 0.05, this.labels.glow); fl2.position.set(0, 0.06, 0.007); fp.add(fl2);
      const key = new Mesh(cylGeo(0.018, 0.03, 'z', 12), M.mirrorSteel); key.position.set(0, -0.04, 0.015); fp.add(key);
      const keyBar = boxMesh(M.paintDark, 0.008, 0.04, 0.01); keyBar.position.set(0, -0.04, 0.033); fp.add(keyBar);
      const order = ['off', 'on', 'reset'];
      C.add([key, keyBar, fl2], {
        id: 'fire1', label: 'Firefighters\' service Phase I key switch (lobby)', kind: 'switch',
        down: () => { const i = order.indexOf(ctl.inputs.fire1); ctl.inputs.fire1 = order[(i + 1) % 3]; this.sim.sfx('clack'); },
        hint: () => `Phase I key: ${ctl.inputs.fire1.toUpperCase()} (click to turn: OFF, ON, RESET)`,
        show: () => { keyBar.rotation.z = { off: 0, on: -0.8, reset: 0.8 }[ctl.inputs.fire1]; },
      });
    }
    this.landing[n] = { lu, ld, y0, panels: this._landingDoor(n, y0) };
  }

  /** The landing door's two panels: drawn, solid (moving surfaces), and something to pull. */
  _landingDoor(n, y0) {
    const M = this.M, d = this.sim.doors, panels = [];
    for (const side of [-1, 1]) {
      const p = boxMesh(M.stainless, PANEL_W, CAR.doorH + 0.02, 0.03, 1);
      p.position.set(side * PANEL_W / 2, y0 + CAR.doorH / 2, F + 0.02);
      p.castShadow = true;
      this.root.add(p);
      panels.push(p);
      const L = d.landing[n];
      const xc = () => side * (PANEL_W / 2 + L.x * SPEC.doors.panelTravel);
      this.world.mover({
        bounds: () => (L.x > 0.995 && Math.abs(xc()) > 1 ? null : [[xc() - PANEL_W / 2, y0 + 0.01, F + 0.003], [xc() + PANEL_W / 2, y0 + CAR.doorH, F + 0.037]]),
        vel: () => [side * L.v, 0, 0],
        onImpulse: (J, dt) => { const f = (J[0] * side) / dt / 2; if (d.coupled === n) d.car.Fext += f; else L.Fext += f; },
      });
      this.controls.add(p, {
        id: `landingDoor.${n}.${side}`, label: `Floor ${n} landing door panel`, kind: 'grab', floor: n,
        drag: (dv) => { const f = Math.max(-300, Math.min(300, dv[0] * side * 900)) / 2; if (d.coupled === n) d.car.Fhand += f; else L.Fhand += f; },
        hint: () => `Floor ${n} landing door: ${L.locked ? 'locked' : `${Math.round(L.x * 100)} % open`} · hold and drag to slide it`,
      });
    }
    return panels;
  }

  // -------------------------------------------------------------------------------------------
  _hoistway(b) {
    const M = this.M, yb = PIT_Y + 0.2, yt = MR.floor;
    // car rails (T127-1/B) at x = ±1.32, blades toward the car; counterweight rails (T89/B)
    for (const s of [-1, 1]) {
      const x = s * RAILS.car;
      b.box(M.rail, x - s * 0.008, yb, CAR.zc - 0.0635, x + s * 0.008, yt, CAR.zc + 0.0635);
      b.box(M.railWeb, x + s * 0.008, yb, CAR.zc - 0.008, x + s * 0.097, yt, CAR.zc + 0.008);
    }
    for (const s of [-1, 1]) {
      const z = CAR.zc + s * RAILS.cwHalfZ;
      b.box(M.rail, RAILS.cwX - 0.0445, yb, z - s * 0.005, RAILS.cwX + 0.0445, yt, z + s * 0.005);
      b.box(M.railWeb, RAILS.cwX - 0.005, yb, z + s * 0.005, RAILS.cwX + 0.005, yt, z + s * 0.07);
    }
    // the steel frame: two columns out at the corners, a tie and brackets at every floor and between
    for (const x of [PIT.x0, PIT.x1]) b.box(M.paintGrey, x - 0.15, PIT_Y, PIT.z1 - 0.3, x + 0.15, MR.floor, PIT.z1);
    const levels = [];
    for (let n = 1; n <= FLOORS; n++) { levels.push(floorY(n) + 2.75); if (n > 1) levels.push(floorY(n) + 0.9); }
    for (const y of levels) {
      b.box(M.paintGrey, PIT.x0, y, PIT.z1 - 0.25, PIT.x1, y + 0.16, PIT.z1 - 0.1);
      for (const x of [PIT.x0, PIT.x1]) b.box(M.paintGrey, x - 0.06, y, F, x + 0.06, y + 0.16, PIT.z1 - 0.1);
      for (const s of [-1, 1]) b.box(M.paintGrey, s * RAILS.car + s * 0.1, y, F, s * RAILS.car + s * 0.22, y + 0.12, CAR.zc + 0.08);
      b.box(M.paintGrey, RAILS.cwX - 0.16, y, F, RAILS.cwX - 0.06, y + 0.12, CAR.zc + RAILS.cwHalfZ + 0.1);
    }
    // the glass screen round the foot of the hoistway, 2.5 m high, and its door to the pit ladder
    const gl = this.glass, gh = 2.5;
    gl.add([PIT.x0, 0, F + 0.05], [0, 0, PIT.z1 - F - 0.35], [0, gh, 0]);
    gl.add([PIT.x0 + 0.15, 0, PIT.z1 - 0.15], [PIT.x1 - PIT.x0 - 0.3, 0, 0], [0, gh, 0]);
    gl.add([PIT.x1, 0, F + 0.05], [0, 0, 1.25], [0, gh, 0]);
    this.solid(PIT.x0 - 0.05, 0, F, PIT.x0 + 0.05, gh, PIT.z1);
    this.solid(PIT.x0, 0, PIT.z1 - 0.2, PIT.x1, gh, PIT.z1 - 0.1);
    this.solid(PIT.x1 - 0.05, 0, F, PIT.x1 + 0.05, gh, F + 1.3);
    b.box(M.stainless, PIT.x1 - 0.05, gh, F, PIT.x1 + 0.05, gh + 0.06, PIT.z1);
    b.box(M.paintGrey, PIT.x1 - 0.04, 0, F + 1.3, PIT.x1 + 0.04, 2.2, PIT.z1 - 0.3);            // the pit door
    this.solid(PIT.x1 - 0.04, 0, F + 1.3, PIT.x1 + 0.04, 2.2, PIT.z1 - 0.3);
    this.spots.push({ kind: 'pitDoor', pos: [PIT.x1 + 0.45, 0, F + 1.75], label: 'the pit door: E to climb down the pit ladder' });
    // the travelling cable's fixing, half way up
    b.box(M.paintDark, 0.6, TOP_Y / 2 - 0.2, F + 0.02, 0.9, TOP_Y / 2 + 0.2, F + 0.12);
  }

  // -------------------------------------------------------------------------------------------
  _machineRoom(b) {
    const M = this.M, y = MR.floor, C = this.controls, sim = this.sim, ctl = sim.ctl, h = sim.hoist;
    // the room
    this.wall(b, M.concrete, MR.x0, y - 0.3, MR.z0, MR.x1, y, MR.z1, 2);
    this.wall(b, M.concrete, MR.x0, y + MR.h, MR.z0, MR.x1, y + MR.h + 0.25, MR.z1, 2);
    this.wall(b, M.concrete, MR.x0 - 0.25, y - 0.3, MR.z0, MR.x0, y + MR.h, MR.z1, 2);
    this.wall(b, M.concrete, MR.x1, y - 0.3, MR.z0, MR.x1 + 0.25, y + MR.h, MR.z1, 2);
    this.wall(b, M.concrete, MR.x0, y - 0.3, MR.z0 - 0.25, MR.x1, y + MR.h, MR.z0, 2);
    this.wall(b, M.concrete, MR.x0, y - 0.3, MR.z1, MR.x1, y + MR.h, MR.z1 + 0.25, 2);
    // the supports under it, down to the roof
    for (const [x, z] of [[MR.x0, MR.z1], [MR.x1, MR.z1]]) b.box(M.paintGrey, x - 0.15, ROOF_Y - 4, z - 0.15, x + 0.15, y, z + 0.15);
    b.box(M.paintGrey, MR.x0, y - 0.6, MR.z1 - 0.3, MR.x1, y - 0.3, MR.z1);
    b.box(M.lampPanel, -1.8, y + MR.h - 0.01, 14.5, -0.6, y + MR.h, 15.0);
    b.box(M.lampPanel, 0.4, y + MR.h - 0.01, 16.5, 1.6, y + MR.h, 17.0);
    // the door from the roof stairs
    b.box(M.paintGrey, 1.4, y, MR.z0, 2.4, y + 2.1, MR.z0 + 0.04);
    this.spots.push({ kind: 'mrDoor', pos: [1.9, y, MR.z0 + 0.6], label: 'the machine room door: E or Q down the stairs to floor 30' });
    // ---- the machine: bedplate on its plinth, the motor, the sheave, the brake drum and its two brakes
    const zc = SHEAVE.z, sx = SHEAVE.x;
    this.wall(b, M.concrete, -1.4, y, zc - 1.1, 0.8, y + 0.25, zc + 0.9);
    b.box(M.paintDark, -1.3, y + 0.25, zc - 1.0, 0.7, y + 0.35, zc + 0.8);
    b.box(M.paintDark, sx - 0.12, y + 0.35, zc - 0.85, sx + 0.12, SHEAVE.y, zc - 0.7);
    b.box(M.paintDark, sx - 0.12, y + 0.35, zc + 0.55, sx + 0.12, SHEAVE.y, zc + 0.7);
    this.solid(-1.3, y, zc - 1.0, 0.7, y + 1.5, zc + 0.8);
    const mach = new Group(); mach.position.set(sx, SHEAVE.y, zc); this.root.add(mach);
    const motor = new Mesh(cylGeo(0.5, 0.55, 'z', 32), M.motor); motor.position.z = -0.42; motor.castShadow = true; mach.add(motor);
    const cap = new Mesh(cylGeo(0.12, 0.08, 'z', 16), M.steel); cap.position.z = -0.73; mach.add(cap);
    const tbox = boxMesh(M.paintDark, 0.3, 0.22, 0.2); tbox.position.set(0, 0.55, -0.42); mach.add(tbox);
    this.sheave = new Group(); mach.add(this.sheave);
    const sh = new Mesh(cylGeo(SHEAVE.r, 0.22, 'z', 40), M.castIron); this.sheave.add(sh);
    for (let k = 0; k < 6; k++) { const sp = boxMesh(M.steel, 0.05, SHEAVE.r * 1.6, 0.24); sp.rotation.z = (k * Math.PI) / 3; this.sheave.add(sp); }
    const drum = new Mesh(cylGeo(0.36, 0.12, 'z', 32), M.mirrorSteel); drum.position.z = 0.25; this.sheave.add(drum);
    this.brakeShoes = [];
    for (const s of [-1, 1]) {
      const g = new Group(); g.position.set(s * 0.4, 0, 0.25); mach.add(g);
      const body = boxMesh(M.paintRed, 0.16, 0.32, 0.2); g.add(body);
      const shoe = boxMesh(M.rubber, 0.03, 0.26, 0.1); shoe.position.x = -s * 0.095; g.add(shoe);
      this.brakeShoes.push({ g, s, shoe });
    }
    // the hand release lever: pull it to lift the brakes, a little at a time
    const lever = new Group(); lever.position.set(0, 0.42, 0.25); mach.add(lever);
    const arm = boxMesh(M.paintRed, 0.04, 0.5, 0.04); arm.position.y = 0.25; lever.add(arm);
    const grip = new Mesh(cylGeo(0.03, 0.14, 'x', 12), M.rubber); grip.position.y = 0.5; lever.add(grip);
    this.lever = lever;
    C.add([arm, grip], {
      id: 'brakeRelease', label: 'Manual brake release lever', kind: 'grab',
      drag: (dv) => { this._leverPull = Math.min(1, Math.hypot(dv[0], dv[1], dv[2]) * 2.5); },
      up: () => { this._leverPull = 0; },
      hint: () => `Manual brake release: ${Math.round(h.manualRelease * 100)} % · hold and drag toward you to lift the brakes; the car moves by its unbalance (watch the governor)`,
    });
    // the deflector sheave and the governor
    this.deflector = new Mesh(cylGeo(DEFLECTOR.r, 0.2, 'z', 32), M.castIron); this.deflector.position.set(DEFLECTOR.x, DEFLECTOR.y, DEFLECTOR.z); this.root.add(this.deflector);
    b.box(M.paintDark, DEFLECTOR.x - 0.3, DEFLECTOR.y + 0.3, DEFLECTOR.z - 0.2, DEFLECTOR.x + 0.3, y - 0.3, DEFLECTOR.z + 0.2);
    b.box(M.paintGrey, GOVERNOR.x - 0.2, y, GOVERNOR.z - 0.15, GOVERNOR.x + 0.2, GOVERNOR.y - 0.18, GOVERNOR.z + 0.15);
    this.solid(GOVERNOR.x - 0.25, y, GOVERNOR.z - 0.2, GOVERNOR.x + 0.25, GOVERNOR.y + 0.2, GOVERNOR.z + 0.2);
    this.gov = new Group(); this.gov.position.set(GOVERNOR.x, GOVERNOR.y, GOVERNOR.z); this.root.add(this.gov);
    const gs = new Mesh(cylGeo(GOVERNOR.r, 0.06, 'x', 28), M.paintBlue); this.gov.add(gs);
    this.flyweights = [];
    for (const s of [-1, 1]) { const w = boxMesh(M.steel, 0.03, 0.05, 0.11); w.position.set(-0.05, 0, s * 0.06); this.gov.add(w); this.flyweights.push(w); }
    this.govJaw = boxMesh(M.paintYellow, 0.08, 0.06, 0.06); this.govJaw.position.set(GOVERNOR.x, GOVERNOR.y - 0.2, GOVERNOR.z - GOVERNOR.r); this.root.add(this.govJaw);
    // ---- the controller and drive cabinets on the north wall, with the panel
    const cz = MR.z0 + 0.45;
    this.wall(b, M.cabinet, -3.3, y, MR.z0, -1.4, y + 2.0, cz);
    this.wall(b, M.cabinet, -1.3, y, MR.z0, -0.2, y + 2.0, cz);
    b.box(M.paintDark, -1.1, y + 1.5, cz, -0.4, y + 1.8, cz + 0.02);              // the drive's fan grille
    const disp = new Mesh(new PlaneGeometry(0.42, 0.16), this.mrDisplay.mat); disp.position.set(-2.35, y + 1.72, cz + 0.006); this.root.add(disp);
    const panel = (id, label, x, yy, kind, opts) => this._panelControl(id, label, -3.3 + x, y + yy, cz + 0.005, kind, opts);
    panel('eeo', 'Emergency electrical operation: NORMAL / EEO', 0.25, 1.4, 'switch', { get: () => ctl.inputs.eeo, set: (v) => (ctl.inputs.eeo = v), text: 'EEO' });
    panel('eeoUp', 'EEO: UP (hold, with RUN)', 0.55, 1.4, 'hold', { set: (v) => (ctl.inputs.eeoUp = v), sym: 'up' });
    panel('eeoRun', 'EEO: RUN (hold)', 0.75, 1.4, 'hold', { set: (v) => (ctl.inputs.eeoRun = v), text: 'RUN' });
    panel('eeoDown', 'EEO: DOWN (hold, with RUN)', 0.95, 1.4, 'hold', { set: (v) => (ctl.inputs.eeoDown = v), sym: 'down' });
    panel('govTrip', 'Governor remote tripping (test: trips it at the next move)', 0.25, 1.1, 'button', { press: () => { h.gov.testTrip = true; sim.say('Governor test magnet armed: it will trip at the next movement.', 'Technician'); }, text: 'GOV' });
    panel('govReset', 'Governor remote reset', 0.5, 1.1, 'button', { press: () => sim.say(h.resetGovernor() ? 'Governor reset. (If the safety gear is set, release it by moving the car up on EEO.)' : 'The governor can only be reset with the car at rest.', 'Technician'), text: 'RST' });
    panel('faultReset', 'Fault reset (unintended movement, brake faults)', 0.75, 1.1, 'button', { press: () => ctl.resetFaults(), text: 'FLT' });
    panel('ard', 'Automatic rescue device: ON / OFF', 1.0, 1.1, 'switch', { get: () => ctl.inputs.ard, set: (v) => (ctl.inputs.ard = v), text: 'ARD' });
    panel('mrStop', 'Machine room STOP switch', 1.35, 1.25, 'switch', { get: () => ctl.inputs.mrStop, set: (v) => (ctl.inputs.mrStop = v), red: true });
    panel('parking', 'Parking at the lobby: ON / OFF', 1.6, 1.1, 'switch', { get: () => ctl.inputs.parking, set: (v) => (ctl.inputs.parking = v), text: 'PRK' });
    // the main switch by the door
    this.wall(b, M.paintGrey, 0.9, y + 1.0, MR.z0, 1.25, y + 1.45, MR.z0 + 0.2);
    this._panelControl('main', 'MAIN SWITCH (isolates the elevator)', 1.075, y + 1.22, MR.z0 + 0.205, 'switch', { get: () => ctl.inputs.mainSwitch, set: (v) => (ctl.inputs.mainSwitch = v), red: true, big: true });
    // ---- the simulator's own panel: failures to put the safety systems to the test
    const sz = MR.z1 - 0.06;
    this.wall(b, M.paintYellow, -3.0, y + 0.9, sz - 0.2, -1.4, y + 1.9, MR.z1);
    const sim_ = this.labels.text('SIMFAULT', 'SIMULATOR: FAILURES', { w: 384, h: 48, size: 28, weight: 700 });
    const sl = this.labels.quad(sim_, 0.9, 0.11); sl.position.set(-2.2, y + 1.78, sz - 0.205); sl.rotation.y = Math.PI; this.root.add(sl);
    const f = (id, label, x, yy, kind, opts) => this._panelControl(id, label, x, y + yy, sz - 0.205, kind, { ...opts, flip: true });
    f('mains', 'Mains supply to the building (cut it: a power failure)', -1.65, 1.5, 'switch', { get: () => ctl.inputs.mains, set: (v) => (ctl.inputs.mains = v), text: 'AC' });
    f('brakeFail', 'Failure: both brake linings contaminated (they will not hold)', -1.95, 1.5, 'switch', { get: () => h.brakes[0].fail, set: (v) => { for (const k of h.brakes) k.fail = v; }, text: 'BRK' });
    f('runaway', 'Failure: the drive\'s encoder misreads (the drive runs away)', -2.25, 1.5, 'switch', { get: () => sim.drive.fault === 'runaway', set: (v) => (sim.drive.fault = v ? 'runaway' : null), text: 'DRV' });
    f('curtainFail', 'Failure: the light curtain is blind', -2.55, 1.5, 'switch', { get: () => sim.doors.curtainFail, set: (v) => (sim.doors.curtainFail = v), text: 'LC' });
    f('cutRopes', 'Failure: all eight hoist ropes part (the safety gear must hold the car)', -2.85, 1.5, 'button', { press: () => { if (!h.ropesCut) { h.ropesCut = true; sim.say('All eight hoist ropes have parted.', 'Simulator'); sim.sfx('snap'); } }, text: 'CUT', red: true });
    f('repair', 'Repair everything (ropes, brakes, drive, governor, safety gear, faults)', -2.2, 1.15, 'button', { press: () => this.onRepair?.(), text: 'FIX' });
  }

  /** A panel control: a button, a hold-to-run button or a two-position switch, with its label. */
  _panelControl(id, label, x, y, z, kind, o) {
    const M = this.M, g = new Object3D(); g.position.set(x, y, z); if (o.flip) g.rotation.y = Math.PI; this.root.add(g);
    const r = o.big ? 0.05 : 0.03;
    const ring = new Mesh(cylGeo(r, 0.02, 'z', 20), M.btnRing); ring.position.z = 0.01; g.add(ring);
    const face = new Mesh(cylGeo(r * 0.75, 0.022, 'z', 20), o.red ? M.paintRed : M.btnOff); face.position.z = 0.016; g.add(face);
    const lab = o.sym ? this.labels.symbol(o.sym) : this.labels.text('P' + (o.text ?? id), o.text ?? '', { w: 96, h: 48, size: 30, weight: 700 });
    const lq = this.labels.quad(lab, o.sym ? 0.04 : 0.07, o.sym ? 0.04 : 0.035, this.labels.engraved); lq.position.set(0, -r - 0.03, 0.002); g.add(lq);
    const sim = this.sim;
    if (kind === 'switch') {
      const bar = boxMesh(o.red ? M.paintRed : M.paintDark, 0.012, r * 1.5, 0.014); bar.position.z = 0.03; g.add(bar);
      return this.controls.add([ring, face, bar], {
        id, label, kind: 'switch',
        down: () => { o.set(!o.get()); sim.sfx('clack'); },
        hint: () => `${label}: ${o.get() ? 'ON' : 'OFF'} (click to switch)`,
        show: () => { bar.rotation.z = o.get() ? -Math.PI / 2 : 0; },
      });
    }
    if (kind === 'hold') return this.controls.add([ring, face], { id, label, kind: 'hold', down: () => { o.set(true); sim.sfx('click'); }, up: () => o.set(false), hint: () => `${label}`, lit: () => false });
    return this.controls.add([ring, face], { id, label, kind: 'button', down: () => { o.press(); sim.sfx('click'); } });
  }

  // -------------------------------------------------------------------------------------------
  _pit(b) {
    const M = this.M, y = PIT_Y, C = this.controls, ctl = this.sim.ctl;
    this.wall(b, M.concrete, PIT.x0, y - 0.3, PIT.z0, PIT.x1, y, PIT.z1, 2);
    this.wall(b, M.concrete, PIT.x0 - 0.3, y, PIT.z0, PIT.x0, 0, PIT.z1, 2);
    this.wall(b, M.concrete, PIT.x1, y, PIT.z0, PIT.x1 + 0.3, 0, PIT.z1, 2);
    this.wall(b, M.concrete, PIT.x0, y, PIT.z1, PIT.x1, 0, PIT.z1 + 0.3, 2);
    this.wall(b, M.concrete, PIT.x0, y, PIT.z0 - 0.3, PIT.x1, 0, PIT.z0, 2);
    // the buffers on their pedestals
    const ped = (x, top) => { this.wall(b, M.concrete, x - 0.25, y, CAR.zc - 0.25, x + 0.25, top - SPEC.buffers.stroke - 0.55, CAR.zc + 0.25); };
    ped(0, BUFFER.carTop); ped(RAILS.cwX, BUFFER.cwTop);
    this.buffers = {};
    for (const [k, x, top] of [['car', 0, BUFFER.carTop], ['cw', RAILS.cwX, BUFFER.cwTop]]) {
      const base = top - SPEC.buffers.stroke - 0.55;
      b.cyl(M.paintYellow, x, base + 0.75, CAR.zc, 0.13, 1.5, 'y', 24);
      const plunger = new Mesh(cylGeo(0.07, SPEC.buffers.stroke + 0.1, 'y', 20), M.mirrorSteel); this.root.add(plunger);
      const head = new Mesh(cylGeo(0.11, 0.08, 'y', 20), M.rubber); this.root.add(head);
      this.buffers[k] = { plunger, head, top, x };
      this.solid(x - 0.14, base, CAR.zc - 0.14, x + 0.14, base + 1.5, CAR.zc + 0.14);
    }
    // the compensation's tension sheave in its guides, with the tie-down
    const tx = COMP.x, tz = COMP.z;
    this.tension = new Group(); this.root.add(this.tension); this.tension.position.set(tx, TS_Y0, tz);
    const ts = new Mesh(cylGeo(SPEC.comp.sheaveR, 0.18, 'z', 32), M.castIron); this.tension.add(ts);
    const tsw = boxMesh(M.paintGrey, 0.5, 0.3, 0.12); tsw.position.set(0, 0, -0.13); this.tension.add(tsw);
    for (const s of [-1, 1]) b.box(M.paintDark, tx + s * 0.3 - 0.04, y, tz - 0.16, tx + s * 0.3 + 0.04, y + 2.3, tz - 0.1);
    b.box(M.paintYellow, tx - 0.35, y + 2.2, tz - 0.17, tx + 0.35, y + 2.3, tz - 0.09);       // the tie-down's frame
    this.tensionSheave = ts;
    // the governor rope's tension pulley on its weighted lever
    this.govPulley = new Mesh(cylGeo(GOVERNOR.r, 0.05, 'x', 24), M.paintBlue); this.govPulley.position.set(GOVERNOR.x, GOVERNOR.tensionY, GOVERNOR.z); this.root.add(this.govPulley);
    b.box(M.paintDark, GOVERNOR.x - 0.03, y, GOVERNOR.z - 0.4, GOVERNOR.x + 0.03, GOVERNOR.tensionY, GOVERNOR.z - 0.34);
    b.box(M.castIron, GOVERNOR.x - 0.1, GOVERNOR.tensionY - 0.1, GOVERNOR.z + 0.25, GOVERNOR.x + 0.1, GOVERNOR.tensionY + 0.1, GOVERNOR.z + 0.45);
    // the stop switch and the light switch by the ladder, the ladder
    const lx = PIT.x1 - 0.25;
    for (let k = 0; k < 12; k++) b.box(M.steel, lx - 0.22, y + 0.3 + k * 0.3, PIT.z1 - 0.12, lx + 0.22, y + 0.33 + k * 0.3, PIT.z1 - 0.09);
    for (const s of [-1, 1]) b.box(M.steel, lx + s * 0.22 - 0.02, y, PIT.z1 - 0.13, lx + s * 0.22 + 0.02, 0.9, PIT.z1 - 0.08);
    this.spots.push({ kind: 'pitLadder', pos: [lx, y, PIT.z1 - 0.6], label: 'the pit ladder: E to climb out to the plaza' });
    b.box(M.paintYellow, PIT.x1 - 0.02, y + 1.0, F + 0.6, PIT.x1, y + 1.5, F + 0.9);
    const g = new Object3D(); g.position.set(PIT.x1 - 0.03, y + 1.25, F + 0.75); g.rotation.y = -Math.PI / 2; this.root.add(g);
    const knob = new Mesh(cylGeo(0.04, 0.05, 'z', 20), M.paintRed); knob.position.z = 0.02; g.add(knob);
    C.add(knob, { id: 'pitStop', label: 'Pit STOP switch', kind: 'switch', down: () => { ctl.inputs.pitStop = !ctl.inputs.pitStop; this.sim.sfx('clack'); }, hint: () => `Pit STOP switch: ${ctl.inputs.pitStop ? 'STOP (pulled out: the elevator cannot move)' : 'RUN'} (click)`, show: () => { knob.position.z = ctl.inputs.pitStop ? 0.05 : 0.02; } });
  }

  // -------------------------------------------------------------------------------------------
  update() {
    const sim = this.sim, ctl = sim.ctl, d = sim.doors, h = sim.hoist, T = SPEC.doors.panelTravel;
    for (let n = 1; n <= FLOORS; n++) {
      const L = this.landing[n], x = d.landing[n].x;
      L.panels[0].position.x = -(PANEL_W / 2 + x * T);
      L.panels[1].position.x = PANEL_W / 2 + x * T;
      const lit = ctl.lantern.t > 0 && ctl.lantern.floor === n;
      const up = lit && ctl.lantern.dir >= 0, dn = lit && ctl.lantern.dir <= 0 && ctl.lantern.dir !== 0;
      L.lu.material = up ? this.M.upLit : this.M.lensOff;
      L.ld.material = dn ? this.M.downLit : this.M.lensOff;
    }
    const D = ctl.display;
    this.hallDisplay.draw(D.text, D.dir, D.msg === 'OVERLOAD' || D.msg === 'FULL' || D.msg === 'PLEASE CLEAR DOORS' ? '' : D.msg);
    // the machine room: the sheave and the deflector turn, the brakes open, the governor spins
    this.sheave.rotation.z = -h.th;
    this.deflector.rotation.z = -h.u / DEFLECTOR.r;
    for (const s of this.brakeShoes) s.g.position.x = s.s * (0.4 + 0.012 * Math.min(...h.brakes.map((k) => k.lift)) + 0.012 * h.manualRelease);
    h.manualRelease += ((this._leverPull ?? 0) - h.manualRelease) * 0.2;
    this._leverPull = Math.max(0, (this._leverPull ?? 0) - 0.01);
    this.lever.rotation.x = -h.manualRelease * 0.6;
    this.gov.rotation.x = -h.gov.th;
    const fly = Math.min(1, Math.abs(h.vc) / SPEC.governor.trip);
    for (const w of this.flyweights) w.position.x = -0.05 - fly * fly * 0.05;
    this.govJaw.position.x = GOVERNOR.x + (h.gov.tripped ? 0.0 : 0.06);
    // the pit: the buffers' plungers, the tension sheave
    for (const [k, B] of Object.entries(this.buffers)) {
      const top = B.top - h.buf[k];
      B.plunger.position.set(B.x, top - (SPEC.buffers.stroke + 0.1) / 2 - 0.04, CAR.zc);
      B.head.position.set(B.x, top - 0.04, CAR.zc);
    }
    this.tension.position.y = h.ts;
    this.tensionSheave.rotation.z = (h.yc - h.yw) / SPEC.comp.sheaveR / 2;
    this.govPulley.rotation.x = -h.gov.th * GOVERNOR.r / GOVERNOR.r;
    // the machine room's controller display
    const mode = ctl.mode.toUpperCase();
    this.mrDisplay.draw(`${ctl.floor}`, D.dir, `${mode} ${ctl.chainOK ? 'CHAIN OK' : 'CHAIN OPEN'}`, ctl.chainOK ? '#7dff9a' : '#ff6a4a');
  }
}
