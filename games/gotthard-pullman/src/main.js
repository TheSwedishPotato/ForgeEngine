/**
 * Gotthard Pullman: a ride on a steam special up the Gotthard north ramp, Erstfeld to
 * Göschenen, on Friday 11 December 2026.
 *
 * (Development harness while the world is being built: ?s=<chainage m>&t=<hh:mm>&w=<weather>
 *  &view=track|side|aerial&q=<quality>; ?manual=1 for the screenshot tool.)
 */
import './style.css';
import { Route } from './world/route.js';
import { Terrain } from './world/terrain.js';
import { Weather } from './world/weather.js';
import { GotthardStage } from './render/stage.js';
import { Forest } from './render/forest.js';
import { TrackGL } from './render/track.js';
import { TrainGL } from './render/trainGL.js';
import { Sim } from './sim.js';
import { Game } from './game.js';
import { Structures } from './render/structures.js';
import { Places } from './render/places.js';
import { DATE, hms, fmt } from './sim.js';
import { startScreen, HUD, Phone, DebugPanel, Help } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
const manual = !!params.get('manual');

function loading(text) {
  let el = ui.querySelector('.loading');
  if (!el) { el = document.createElement('div'); el.className = 'loading'; ui.append(el); }
  el.innerHTML = `<b>Gotthard Pullman</b>${text}`;
  return el;
}

async function ride() {
  // the start screen, unless the address already says how to ride (or a test drives the page)
  let opts = { weather: params.get('w') ?? 'clear', quality: params.get('q') ?? 'high', car: params.get('car') ?? 'parlor', chair: Number(params.get('chair') ?? 12), t: params.get('t') ?? '10:12' };
  if (!manual && !params.get('go') && !params.get('w')) opts = await startScreen(ui, opts);
  loading('Laying the line…');
  const join = hms(opts.t);
  const game = await Game.create(canvas, {
    weather: opts.weather, quality: opts.quality, startClock: Math.min(join, hms('10:12')),
    seat: { car: opts.car, chair: opts.chair }, onProgress: (t) => loading(t),
  });
  game.timeScale = Number(params.get('speed') ?? 1);
  // joining later: the physics runs ahead (the crew drives the whole way, as it would)
  if (join > game.sim.clock) {
    loading(`Running ahead to ${opts.t}…`);
    await new Promise((r) => setTimeout(r, 30));
    while (game.sim.clock < join) { game.sim.advance(Math.min(30, join - game.sim.clock)); if ((game.sim.clock | 0) % 120 < 30) { loading(`Running ahead to ${opts.t}… ${fmt(game.sim.clock)}`); await new Promise((r) => setTimeout(r, 0)); } }
  }
  if (params.get('skip')) game.sim.advance(Number(params.get('skip')));
  if (params.get('cam') === 'out') game.player.setOutside(true, { vehicle: Number(params.get('veh') ?? 0), dist: Number(params.get('dist') ?? 18), yaw: Number(params.get('oyaw') ?? 50) * Math.PI / 180, pitch: Number(params.get('opitch') ?? 10) * Math.PI / 180, along: Number(params.get('oal') ?? 0), height: Number(params.get('oh') ?? 2.2) });
  if (params.get('yaw')) game.player.yaw = Number(params.get('yaw')) * Math.PI / 180;
  if (params.get('pitch')) game.player.pitch = Number(params.get('pitch')) * Math.PI / 180;
  ui.querySelector('.loading')?.remove();
  window.game = { game, stage: game.stage, sim: game.sim, ready: true, advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) game.frame(dt / n); } };
  // the screens around the view
  const hud = new HUD(ui, game), phone = new Phone(ui, game), debug = new DebugPanel(ui, game), help = new Help(ui);
  game.ui = { hud, phone, debug, help };
  if (manual && params.get('hud') !== '1') hud.toggle();
  if (params.get('phone') === '1') phone.toggle();
  if (params.get('dbg') === '1') debug.toggle();
  game.onFrame = (dt) => { hud.update(dt); phone.update(dt); debug.update(dt); };
  if (!manual) {
    game.sound.attach(window);
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; game.frame(game.paused ? 0 : dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') game.timeScale = Math.min(64, game.timeScale * 2);
    if (e.key === '-') game.timeScale = Math.max(1, game.timeScale / 2);
    if (e.code === 'KeyM') phone.toggle();
    if (e.code === 'KeyT') hud.toggle();
    if (e.code === 'KeyH') help.toggle();
    if (e.code === 'KeyP') game.paused = !game.paused;
    if (e.code === 'F3') { e.preventDefault(); debug.toggle(); }
  });
}

async function boot() {
  loading('Laying the line…');
  const route = await Route.load();
  loading('Raising the mountains…');
  const terrain = await Terrain.load(route);
  const weather = new Weather(route, params.get('w') ?? 'clear');
  const stage = new GotthardStage(canvas, { quality: params.get('q') ?? 'high', terrain, weather, date: DATE });
  const clock = hms(params.get('t') ?? '10:30');
  // the camera
  const s = Number(params.get('s') ?? 12000), view = params.get('view') ?? 'track';
  const p = route.run.pos(s), hd = route.run.headingAt(s);
  const fx = Math.sin(hd), fy = Math.cos(hd);
  let eye, look;
  if (view === 'side') {
    const side = Number(params.get('side') ?? 1), dist = Number(params.get('dist') ?? 35), back = Number(params.get('back') ?? 20);
    eye = { x: p.x + fy * dist * side - fx * back, y: p.y - fx * dist * side - fy * back, z: 0 };
    eye.z = Math.max(terrain.heightAt(eye.x, eye.y) + 1.7, p.z + Number(params.get('eyeh') ?? 2));
    const ahead = Number(params.get('ahead') ?? 30);
    look = { x: p.x + fx * ahead, y: p.y + fy * ahead, z: p.z + 2 };
  } else if (view === 'aerial') {
    eye = { x: p.x - fx * 600, y: p.y - fy * 600, z: p.z + 450 };
    look = { x: p.x + fx * 400, y: p.y + fy * 400, z: p.z };
  } else {
    eye = { x: p.x, y: p.y, z: p.z + 3.6 };
    const q = route.run.pos(s + 60);
    look = { x: q.x, y: q.y, z: q.z + 3.0 };
  }
  if (params.get('yaw')) {
    const a = Number(params.get('yaw')) * Math.PI / 180, d = Math.hypot(look.x - eye.x, look.y - eye.y);
    const b = Math.atan2(look.x - eye.x, look.y - eye.y) + a;
    look = { x: eye.x + Math.sin(b) * d, y: eye.y + Math.cos(b) * d, z: look.z + Number(params.get('pitch') ?? 0) * d / 57.3 };
  }
  if (params.get('noatmo')) stage.atmosphere.enabled = false;
  if (params.get('nomb')) stage.motionBlur.enabled = false;
  stage.recentre(eye, 0);
  stage.setTime(clock, { now: true });
  stage.camera.position.copy(stage.toWorld(eye.x, eye.y, eye.z));
  stage.camera.lookAt(stage.toWorld(look.x, look.y, look.z));
  const forest = params.get('notrees') ? null : new Forest(stage, terrain, route, weather);
  if (forest) { const t0 = performance.now(); while (forest.update(stage.camera.position, 4)); console.log(`forest ${JSON.stringify(forest.stats())} in ${(performance.now() - t0).toFixed(0)} ms`); }
  const track = new TrackGL(stage, route, terrain, weather);
  { const t0 = performance.now(); while (track.update(stage.camera.position, 50)); console.log(`track ${track.pieces.size} pieces in ${(performance.now() - t0).toFixed(0)} ms`); }
  await Structures.create(stage, route, terrain, weather);
  const places = new Places(stage, terrain, route, weather);
  console.log(`places in ${places.buildMs.toFixed(0)} ms, ${places.tiles.size} tiles`);
  const sim = await Sim.create({ route, weather: params.get('w') ?? 'clear' });
  if (params.get('ts')) { const d = Number(params.get('ts')) - sim.train.front; for (const v of sim.train.veh) v.s += d; }
  const trainGL = new TrainGL(stage, route, sim.train);
  trainGL.update();
  if (view === 'car') {
    // frame one vehicle: ?view=car&i=<index>&ang=<deg from its right side>&dist=<m>&eyeh=<m above rail>&along=<m>
    const m = trainGL.vehicles[Number(params.get('i') ?? 4)], P = m.pose;
    const ang = Number(params.get('ang') ?? 0) * Math.PI / 180, dist = Number(params.get('dist') ?? 9), along = Number(params.get('along') ?? 0);
    const fwd = { x: Math.sin(P.heading), y: Math.cos(P.heading) }, right = { x: Math.cos(P.heading), y: -Math.sin(P.heading) };
    const cx = P.x + fwd.x * along, cy = P.y + fwd.y * along;
    const dx = right.x * Math.cos(ang) + fwd.x * Math.sin(ang), dy = right.y * Math.cos(ang) + fwd.y * Math.sin(ang);
    const e = { x: cx + dx * dist, y: cy + dy * dist, z: P.z + Number(params.get('eyeh') ?? 1.8) };
    stage.recentre(e, 0);
    stage.camera.position.copy(stage.toWorld(e.x, e.y, e.z));
    stage.camera.lookAt(stage.toWorld(cx, cy, P.z + Number(params.get('lookh') ?? 2.2)));
    if (params.get('fov')) { stage.camera.fov = Number(params.get('fov')); stage.camera.updateProjectionMatrix(); }
    trainGL.update();
  }
  ui.querySelector('.loading')?.remove();
  let last = performance.now(), t = 0;
  const frame = (dt) => { t += dt; forest?.update(stage.camera.position, 2); track.update(stage.camera.position, 4); trainGL.update(); stage.render(dt); };
  window.game = { stage, route, terrain, weather, forest, track, sim, trainGL, ready: true, advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) frame(dt / n); } };
  if (!manual) {
    const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

(params.get('view') ? boot() : ride()).catch((e) => { console.error(e); loading(`<span style="color:#f99">${e.message}</span>`); });
