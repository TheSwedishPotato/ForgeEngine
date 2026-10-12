/**
 * The running game: the physics (sim.js: the crew driving the C 5/6, the train on the line,
 * the weather), the world around it and you in your seat, all advanced together each frame.
 */
import { Route } from './world/route.js';
import { Terrain } from './world/terrain.js';
import { GotthardStage } from './render/stage.js';
import { Forest } from './render/forest.js';
import { TrackGL } from './render/track.js';
import { TrainGL } from './render/trainGL.js';
import { Sim, DATE, hms } from './sim.js';
import { Player } from './player.js';
import { Structures } from './render/structures.js';
import { Places } from './render/places.js';
import { PeopleGL } from './render/peopleGL.js';
import { Sound } from './audio/sound.js';

export class Game {
  static async create(canvas, { weather = 'clear', quality = 'high', startClock = hms('10:12'), seat = {}, onProgress = () => {} } = {}) {
    onProgress('Laying the line…');
    const route = await Route.load();
    onProgress('Raising the mountains…');
    const terrain = await Terrain.load(route);
    const sim = await Sim.create({ route, weather, startClock, seat });
    const game = new Game(canvas, { route, terrain, sim, quality, seat, onProgress });
    onProgress('Boring the tunnels, building the bridges…');
    game.structures = await Structures.create(game.stage, route, terrain, sim.weather);
    return game;
  }

  constructor(canvas, { route, terrain, sim, quality, seat, onProgress }) {
    this.canvas = canvas;
    this.route = route; this.terrain = terrain; this.sim = sim;
    this.weather = sim.weather;
    this.timeScale = 1;
    onProgress('Building the valley…');
    this.stage = new GotthardStage(canvas, { quality, terrain, weather: this.weather, date: DATE });
    this.trainGL = new TrainGL(this.stage, route, sim.train);
    this.people = new PeopleGL(this.stage, this.trainGL, sim, seat);
    this.player = new Player(this, seat);
    this.sound = new Sound(this);
    // start centred on the player's car, with the sun and the world made around it
    this._recentre(0);
    this.stage.setTime(sim.clock, { now: true });
    this.forest = new Forest(this.stage, terrain, route, this.weather);
    this.track = new TrackGL(this.stage, route, terrain, this.weather);
    this.places = new Places(this.stage, terrain, route, this.weather);
    this.trainGL.update(0);
    this.player.update(0, this.stage.camera);
    while (this.forest.update(this.stage.camera.position, 8));
    while (this.track.update(this.stage.camera.position, 60));
  }

  /** Map position of the player's car (for the floating origin). */
  _carMap() {
    const m = this.player.car();
    const p = this.route.run.pos(m ? m.v.s : this.sim.train.front);
    return p;
  }

  _recentre(limit = 300) { this.stage.recentre(this._carMap(), limit); }

  /** One frame of real time dt (s). */
  frame(dt) {
    dt = Math.min(dt, 0.1);
    const sdt = dt * this.timeScale;
    this.sim.advance(sdt);
    this._recentre();
    this.trainGL.update(sdt);
    this.people.update(sdt, this.stage.camera);
    this.player.update(dt, this.stage.camera);
    this.forest.update(this.stage.camera.position, 2);
    this.track.update(this.stage.camera.position, 4);
    this.places.update(this.stage.camera.position);
    this.stage.setTime(this.sim.clock);
    this.stage.render(dt);
    this.sound.update(dt);
    this.onFrame?.(dt);
  }
}
