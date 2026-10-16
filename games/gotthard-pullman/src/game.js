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
import { Driving } from './drive.js';
import { Places } from './render/places.js';
import { PeopleGL } from './render/peopleGL.js';
import { Sound } from './audio/sound.js';
import { Traffic } from './world/traffic.js';
import { TrafficGL } from './render/trafficGL.js';
import { SignalsGL } from './render/signalsGL.js';

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
    sim.train.terrain = terrain;            // (where a derailed vehicle comes to rest: the ground itself)
    this.trainGL = new TrainGL(this.stage, route, sim.train);
    this.trainGL.sim = sim;
    this.people = new PeopleGL(this.stage, this.trainGL, sim, seat);
    this.traffic = sim.traffic;
    this.trafficGL = new TrafficGL(this.stage, this.traffic);
    this.signalsGL = new SignalsGL(this.stage, route, sim.signals);
    this.player = new Player(this, seat);
    this.driving = new Driving(this);
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
    onProgress('Preparing the shaders…');
    this._prewarm();
  }

  /**
   * Compiles every material's shaders now, while loading. The renderer makes a material's program
   * the first time something drawn with it comes into view: the first tunnel's vault, a new kind of
   * tree up the valley. Compiled then, mid-ride, the frame stalls (on some machines for a large
   * fraction of a second). So everything in the scene, hidden or not, and every species of tree
   * is put through the renderer's own program cache here.
   */
  _prewarm() {
    const r = this.stage.r, A = r.adapter, done = new Set();
    const warm = (o, { instanced = o.isInstancedMesh, instanceColor = !!o.instanceColor } = {}) => {
      const geo = o.geometry, mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!geo?.attributes?.position || !mat || mat.isShaderMaterial || o.userData?.forgeDraw) return;
      const m = A.material(mat, o);
      const defines = {
        SKINNED: !!o.isSkinnedMesh, INSTANCED: !!instanced, INSTANCE_COLOR: !!(instanced && instanceColor),
        VERTEX_COLOR: !!(mat.vertexColors && geo.attributes.color), ...m.defines, HAS_UV: !!geo.attributes.uv,
      };
      const key = Object.entries(defines).filter(([, v]) => v).map(([k]) => k).join('|');
      if (done.has(key)) return;
      done.add(key);
      for (const kind of ['gbuffer', 'depth']) r.program(kind, defines, key);
    };
    this.stage.scene.traverse((o) => { if (o.isMesh) warm(o); });
    for (const S of this.forest.species ?? []) for (const c of S.chain) warm({ geometry: c.geometry, material: S.mat, userData: {} }, { instanced: true, instanceColor: false });
    this.prewarmed = done.size;
  }

  /** Map position of the player's car (for the floating origin). */
  _carMap() {
    const m = this.player.car();
    const p = this.route.run.pos(m ? m.v.s : this.sim.train.front);
    return p;
  }

  _recentre(limit = 300) { this.stage.recentre(this._carMap(), limit); }

  /** A word on the trip's log when one of the other trains goes by the special. */
  _trafficNews() {
    const eng = this.trainGL.vehicles[0];
    if (!eng) return;
    const n = this.trafficGL.nearest(eng.group.position);
    if (!n || n.d > 40) return;
    const tr = this.traffic.trains[n.i];
    this._passed ??= new Set();
    if (this._passed.has(tr)) return;
    this._passed.add(tr);
    const standing = Math.abs(this.sim.train.speed) < 0.2;
    this.sim.log(tr.name.includes('south') ? (standing ? 'The Treno Gottardo overtakes us on the other track.' : 'The Treno Gottardo goes by on the other track.') : 'The northbound Treno Gottardo comes down past us.');
  }

  /** One frame of real time dt (s). */
  frame(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);      // (a first frame's timestamp can precede the clock read before it)
    const sdt = dt * this.timeScale;
    this.driving.update(sdt);
    this.sim.advance(sdt);
    this._recentre();
    this.trainGL.update(sdt);
    this.people.update(sdt, this.stage.camera, { inside: !this.player.exposed() || this.player.mode === 'walking', car: this.player.car(), driving: this.driving.on });
    this.trafficGL.update(this.sim.clock, this.stage.camera);
    this.signalsGL.update(this.stage.camera);
    this._trafficNews();
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
