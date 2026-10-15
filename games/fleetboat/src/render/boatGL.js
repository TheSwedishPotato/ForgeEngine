/**
 * The boat in the world: her outside (hullGL.js) and inside (interiorGL.js) in one group that
 * follows the dynamics' pose, with the parts that move moved to the plant's state, and the
 * lighting pass told where her spaces are and how they are lit.
 */
import { Group, PointLight } from 'three';
import { FittingsGL, fittingMaterials } from './fittingsGL.js';
import { ControlsGL, controlMaterials } from './controlsGL.js';
import { InstrumentsGL } from './instrumentsGL.js';
import { OBS_DECK } from '../physics/mass.js';
import { LEVELS } from '../data/layout.js';
import { HullGL, makeMaterials } from './hullGL.js';
import { InteriorGL, interiorMaterials } from './interiorGL.js';
import { FleetStage, COMP_IDS } from './stage.js';
import { YA } from '../physics/dynamics.js';

export class BoatGL {
  constructor(stage, plant) {
    this.stage = stage; this.plant = plant;
    this.outer = new Group();
    this.inner = new Group();
    this.inner.position.y = -YA;
    this.outer.add(this.inner);
    this.hull = new HullGL(makeMaterials());
    this.interior = new InteriorGL(interiorMaterials());
    this.fittings = new FittingsGL(fittingMaterials());
    this.controls = new ControlsGL(controlMaterials());
    this.instruments = new InstrumentsGL();
    this.inner.add(this.hull.group, this.interior.group, this.fittings.group, this.controls.group, this.instruments.group);
    // the observation deck's lamps: low warm lights at the floor's edges, dimmable (the engine's point lights)
    this.obsLamps = [];
    for (const x of [OBS_DECK.x - 1.6, OBS_DECK.x + 0.9]) {
      const l = new PointLight(0xffd9a8, 0.05, 3.2);
      l.position.set(x, LEVELS.obs.y + 0.35, 0);
      this.inner.add(l);
      this.obsLamps.push(l);
    }
    stage.scene.add(this.outer);
  }

  /** Places the boat at the dynamics' pose (relative to the floating origin) and moves her parts. */
  update(dt = 0) {
    const d = this.plant.dyn, S = this.stage;
    this.outer.position.set(d.pos[0] - S.origin.x, d.pos[1], d.pos[2] - S.origin.z);
    this.outer.quaternion.set(d.q[0], d.q[1], d.q[2], d.q[3]);
    this.outer.updateMatrixWorld(true);
    S.setBoat(this.inner.matrixWorld);
    this.hull.update(this.plant);
    this.interior.update(this.plant);
    this.controls.update(this.plant);
    this.instruments.update(this.plant, dt);
    const lamps = this.plant.ctl['obs.lamps'] > 0.5 && this.plant.g.power !== false;
    for (const l of this.obsLamps) l.intensity = lamps ? 0.05 : 0;
    // the lamps: white, red in the control room and conning tower when rigged for red, out without power
    const power = this.plant.g.power !== false;
    const red = this.plant.ctl['cr.lights'] === 'red';
    for (let k = 0; k < COMP_IDS.length; k++) {
      const id = COMP_IDS[k];
      const isRed = red && (id === 'cr' || id === 'ct' || id === 'pump');
      S.setLamps(k, { power: power ? (isRed ? 0.0022 : 0.0055) : 0, color: isRed ? [1, 0.1, 0.05] : [1, 0.86, 0.68], fill: 0.55 });
    }
  }

  /** Boat coordinates (y above the keel) to world. */
  toWorld(x, y, z, out) { return out.set(x, y, z).applyMatrix4(this.inner.matrixWorld); }
}

export { FleetStage };
