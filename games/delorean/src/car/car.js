/**
 * The DeLorean time machine: the DMC-12's shell (body.js), its gull-wing doors on their roof
 * hinges, the glass, the wheels, the trim and lamps (details.js), the interior (interior.js)
 * and the time machine's hardware (timemachine.js), in one Group in the car's frame
 * (x forward, y up, z right; the origin on the ground midway between the axles).
 */
import { Group, Mesh, Matrix4 } from 'three';
import { buildShell, meshes, DIM } from './body.js';
import { carMaterials } from './materials.js';
import { buildWheels } from './wheels.js';
import { buildDetails } from './details.js';
import { buildTimeMachine } from './timemachine.js';
import { buildInterior } from './interior.js';
import { Builder } from './geom.js';

export { DIM };

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
  }

  /** Opens (1) or shuts (0) both doors at once (for views); the game drives them one by one. */
  setDoors(v) { for (const d of Object.values(this.doors)) { d.open = d.target = v; } this._poseDoors(); }

  _poseDoors() {
    // a DMC door swings up about 66 degrees on its torsion bar and gas strut
    for (const [side, d] of Object.entries(this.doors)) d.pivot.rotation.x = (side === 'right' ? -1 : 1) * d.open * 1.15;
    this.cabin.open = Math.max(this.doors.right.open, this.doors.left.open);
  }

  update(dt) {
    for (const d of Object.values(this.doors)) {
      const k = Math.min(1, dt * 1.6);
      d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), k * 0.9 + 0.002);
    }
    this._poseDoors();
    this.root.updateMatrixWorld();
    this.cabin.matrixInverse.copy(this.root.matrixWorld).invert();
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
