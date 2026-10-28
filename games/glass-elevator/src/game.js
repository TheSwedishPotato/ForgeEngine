/**
 * The running game: the simulation (sim.js) with the loose things' physics world, the tower and the
 * elevator drawn round it on the Med Engine, you in it, and its sounds, advanced together each frame.
 */
import { Stage } from './render/stage.js';
import { Sim } from './sim.js';
import { World, overlap } from './physics/bodies.js';
import { TS_Y0 } from './physics/hoist.js';
import { Controls } from './world/controls.js';
import { makeMaterials, Labels } from './render/mats.js';
import { BuildingGL } from './render/buildingGL.js';
import { ElevatorGL } from './render/elevatorGL.js';
import { makeProps } from './world/props.js';
import { makeWeights } from './world/weights.js';
import { Player } from './player.js';
import { Sound } from './audio/sound.js';
import { ToolBelt, mend } from './world/tools.js';
import { Laptop } from './ui/laptop.js';
import { Guide } from './ui/guide.js';
import { CAR, FACADE, SPEC, floorY, FLOORS, MR, PIT_Y, cwYForCar } from './data/spec.js';

export class Game {
  constructor(canvas, { quality = 'high', clock, floor = 1, load = 0 } = {}) {
    this.canvas = canvas;
    this.sim = new Sim({ floor, clock, load });
    this.world = new World();
    this.sim.world = this.world;
    this.stage = new Stage(canvas, { quality });
    this.controls = new Controls();
    this.M = makeMaterials();
    this.labels = new Labels();
    const ctx = { stage: this.stage, M: this.M, labels: this.labels, sim: this.sim, controls: this.controls, world: this.world, glass: this.stage.glass };
    this.buildingGL = new BuildingGL(ctx);
    this.elevatorGL = new ElevatorGL(ctx);
    this.props = makeProps(this.world, this.M, this.stage.scene);
    makeWeights(this.world, this.stage.scene, this.props, this.M);
    this.buildingGL.onRepair = () => this.repair();
    // what blocks your hand from a button behind it: the door panels
    this.occluders = [...this.buildingGL.landing.slice(1).flatMap((l) => l.panels), ...this.elevatorGL.doorPanels.flatMap((g) => g.children)];
    this.player = new Player(this);
    this.tools = new ToolBelt(this);
    this.laptop = new Laptop(this);
    this.guide = new Guide(this);
    this.elevatorGL.game = this; this.elevatorGL.hasKey = () => this.tools.belt.some((b) => b.tool === 'key');
    this.buildingGL.hasKey = () => this.tools.belt.some((b) => b.tool === 'key');
    this.sound = new Sound(this);
    this.timeScale = 1;
    this.paused = false;
    this.world.carY = this.sim.hoist.yc;
    this.world.after.push(() => this._doorBlocks());
  }

  /** The simulator's repair: new ropes hung where the car is, brakes relined, the drive fixed, everything reset. */
  repair() {
    const s = this.sim, h = s.hoist;
    if (Math.abs(h.vc) > 0.05) { s.say('Not while the car is moving.', 'Simulator'); return; }
    h.ropesCut = false; h.ropesLeft = SPEC.ropes.n;
    for (const b of h.brakes) b.fail = false;
    s.drive.fault = null; s.doors.curtainFail = false;
    for (const c of this.controls.list) if (c.broken) mend(c);
    for (const L of s.doors.landing) if (L) { L.broken = false; L.wedge = 0; }          // bent interlocks straightened, wedges out
    s.doors.car.wedge = 0;
    if (s.ctl.quake && !s.shake) s.ctl.inputs.seismic = false;
    h.gov.tripped = false; h.gov.testTrip = false; h.gov.switchOpen = false; h.gov.link = 0;
    h.sg.engage = 0; h.sg.set = false;
    h.yw = cwYForCar(h.yc); h.vw = 0; h.ts = TS_Y0; h.vts = 0; h.buf.car = 0; h.buf.cw = 0; h.vc = 0; h.vs = 0; h.vu = 0; h.stick = true;
    h._settle();
    s.ctl.resetFaults();
    s.ctl.inputs.mains = true;
    s.say('Repaired: the ropes, the brakes, the drive, the governor, the safety gear, the door locks and anything smashed are as new.', 'Simulator');
  }

  /** The light curtain's beams across the doorway: anything (or anyone) in them. */
  /**
   * How far open each door must stay for the things in its doorway: a panel cannot close through
   * a box, so it stops against it (the operator then feels the stall and reopens).
   */
  _doorBlocks() {
    const d = this.sim.doors, h = this.sim.hoist, T = SPEC.doors.panelTravel;
    const need = (z0, z1, y0) => {
      let x = 0;
      for (const b of this.world.bodies) {
        const [lo, hi] = b.aabb();
        if (hi[2] < z0 || lo[2] > z1 || hi[1] < y0 + 0.01 || lo[1] > y0 + CAR.doorH) continue;
        if (hi[0] < -0.6 || lo[0] > 0.6) continue;
        x = Math.max(x, Math.min(1, (Math.max(Math.abs(lo[0]), Math.abs(hi[0])) + 0.005) / T));
      }
      return x;
    };
    d.car.block = Math.max(need(CAR.doorZ - 0.02, CAR.doorZ + 0.02, h.yc), d.car.wedge ?? 0);
    for (let n = 1; n <= FLOORS; n++) d.landing[n].block = Math.abs(h.yc - floorY(n)) < 30 || d.landing[n].x > 0 ? Math.max(need(FACADE, FACADE + 0.04, floorY(n)), d.landing[n].wedge ?? 0) : 0;
  }

  _curtain() {
    const d = this.sim.doors, h = this.sim.hoist;
    if (d.car.x < 0.01) { d.curtainBlocked = false; return; }
    const half = d.car.x * SPEC.doors.panelTravel;
    const box = [[-half, h.yc + SPEC.doors.curtainBottom, FACADE - 0.04], [half, h.yc + SPEC.doors.curtainTop, CAR.z0 + 0.04]];
    let blocked = this.world.bodies.some((b) => overlap(b.aabb(), box));
    const p = this.player.p;
    if (this.player.mode === 'walk' && p[0] + 0.25 > box[0][0] && p[0] - 0.25 < box[1][0] && p[2] + 0.25 > box[0][2] && p[2] - 0.25 < box[1][2] && p[1] < box[1][1] && p[1] + 1.8 > box[0][1]) blocked = true;
    d.curtainBlocked = blocked;
  }

  /** The eight lamps the engine lights with, where they matter: the car's, the lobby's, the machine room's, the pit's. */
  _lamps() {
    const L = [], h = this.sim.hoist, c = this.sim.ctl, cam = this.stage.camera.position;
    const on = c.powered || c.mode === 'ard';
    if (Math.abs(cam.y - h.yc) < 40) {
      if (on) for (const [x, z] of [[-0.5, CAR.z0 + 0.45], [0.5, CAR.z0 + 0.45], [-0.5, CAR.z1 - 0.45], [0.5, CAR.z1 - 0.45]]) L.push({ pos: [x, h.yc + 2.4, z], power: 0.03, range: 4.5, color: [1, 0.93, 0.84] });
      else L.push({ pos: [0, h.yc + 2.4, CAR.zc], power: 0.006, range: 4, color: [1, 1, 1] });     // the emergency light
    }
    if (cam.y > MR.floor - 0.5) { L.push({ pos: [-1.2, MR.floor + 2.8, 14.7], power: 0.05, range: 7 }); L.push({ pos: [1.0, MR.floor + 2.8, 16.7], power: 0.05, range: 7 }); }
    else if (cam.y < -0.5) L.push({ pos: [0, PIT_Y + 2.6, 16.2], power: 0.04, range: 6 });
    else if (cam.z < FACADE) {
      let n = 1;
      for (let k = FLOORS; k >= 1; k--) if (cam.y >= floorY(k) - 0.2) { n = k; break; }
      const y = floorY(n) + (n === 1 ? 5.6 : 2.9);
      for (const x of n === 1 ? [-5, 2, 5.5] : [-1.6, 1.6]) L.push({ pos: [x, y, n === 1 ? 11 : 12.8], power: n === 1 ? 0.09 : 0.04, range: n === 1 ? 9 : 6 });
    }
    this.stage.setLamps(L.slice(0, 8));
  }

  /** One frame of real time dt (s). */
  frame(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this._curtain();
    if (!this.paused) this.sim.advance(dt * this.timeScale);
    const h = this.sim.hoist;
    this.props.update(h.yc);
    this.elevatorGL.update();
    this.buildingGL.update();
    this.controls.update();
    this.player.update(dt, this.stage.camera);
    if (this.sim.shake) { const a = this.sim.shake.a, c = this.stage.camera.position; c.x += a[0] * 0.01; c.z += a[2] * 0.01; }   // the building shakes under you
    this._lamps();
    this.stage.setTime(this.sim.utcMs);
    this.stage.render(dt);
    this.sound.update(dt);
    this.guide.update(dt);
    this.onFrame?.(dt);
  }
}
