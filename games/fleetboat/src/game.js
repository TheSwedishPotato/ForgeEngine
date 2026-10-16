/**
 * The running game: the simulation (sim.js), the world drawn round it (the boat, the sea floor,
 * the sea and sky on the Med Engine) and you aboard, advanced together each frame.
 */
import { FleetStage } from './render/stage.js';
import { BoatGL } from './render/boatGL.js';
import { SeabedGL } from './render/seabedGL.js';
import { Sim } from './sim.js';
import { Player } from './player.js';
import { CrewGL } from './render/crewGL.js';
import { LifeGL } from './render/lifeGL.js';
import { Sound } from './audio/sound.js';
import { Wake } from './world/wake.js';
import { Vector3 } from 'three';

const _c = new Vector3();

export class Game {
  constructor(canvas, { quality = 'high', start = 'dive', clock, player = {} } = {}) {
    this.canvas = canvas;
    this.sim = new Sim({ start, clock });
    this.timeScale = 1;
    this.stage = new FleetStage(canvas, { quality, sea: this.sim.sea });
    this.boatGL = new BoatGL(this.stage, this.sim.plant);
    this.seabedGL = new SeabedGL(this.stage, this.sim.bed);
    this.crewGL = new CrewGL(this.boatGL, this.sim.crew);
    this.life = new LifeGL(this.stage, this.sim);
    this.wake = new Wake();                            // the waves she makes, solved round her
    this.stage.surface.setWake(this.wake);
    this.sound = new Sound(this);
    this.player = new Player(this, player);
    this._place();
  }

  _place() {
    const d = this.sim.plant.dyn;
    this.stage.recentre(d.pos[0], d.pos[2], 0);
    this.seabedGL.update(d.pos[0], d.pos[2]);
    this.boatGL.update();
    this.stage.setTime(this.sim.utcMs);
  }

  /** One frame of real time dt (s). */
  frame(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.sim.advance(dt * this.timeScale);
    const d = this.sim.plant.dyn;
    this.stage.recentre(d.pos[0], d.pos[2]);
    this.seabedGL.update(d.pos[0], d.pos[2]);
    this.boatGL.update(dt);
    this.life.update(dt * this.timeScale);
    this.player.update(dt, this.stage.camera);
    this.wake.step(dt * this.timeScale, d, this.sim.plant, this.sim.sea);
    this.stage.particles.throwSpray(this.wake.spray);
    this.stage.particles.step(dt * this.timeScale, this.sim.plant, this.sim.sea);
    this.stage.adapt(this.player.lookingAtSea?.() ?? 1, dt);
    _c.copy(this.stage.camera.position).applyMatrix4(this.stage.boatInv);
    this.crewGL.update(dt, _c, this.player.mode === 'walk' ? this.player.p.level : 'outside');
    this.stage.setTime(this.sim.utcMs);
    this.stage.render(dt);
    this.sound.update(dt);
    this.onFrame?.(dt);
  }
}
