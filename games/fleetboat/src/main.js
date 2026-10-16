/**
 * Fleet Boat: aboard a Balao-class submarine off Oahu, Thursday 15 October 2026.
 *
 * (Development: ?start=dive|diesels|submerged &t=<hh:mm> &q=<quality> &cam=out &yaw=<deg>
 *  &pitch=<deg> &at=<level>,<x>,<z>; ?manual=1 for the screenshot tool.)
 */
import './style.css';
import { Game } from './game.js';
import { hms, fmt } from './sim.js';
import { HUD } from './ui/hud.js';
import { Orders } from './ui/orders.js';
import { Touch, isTouchDevice } from './ui/touch.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
const manual = !!params.get('manual');
// a phone or tablet gets the touch controls and a lighter picture; a PC keeps the keys
const touch = params.get('touch') ? params.get('touch') === '1' : isTouchDevice();

function loading(text) {
  let el = ui.querySelector('.loading');
  if (!el) { el = document.createElement('div'); el.className = 'loading'; ui.append(el); }
  el.innerHTML = `<b>Fleet Boat</b>${text}`;
  return el;
}

async function go() {
  loading('Flooding the tubes, charging the banks…');
  await new Promise((r) => setTimeout(r, 20));
  const at = params.get('at')?.split(',');
  const player = at ? { level: at[0], x: Number(at[1]), z: Number(at[2] ?? 0) } : {};
  const game = new Game(canvas, { quality: params.get('q') ?? (touch ? 'low' : 'high'), start: params.get('start') ?? 'dive', clock: params.get('t') ? hms(params.get('t')) : undefined, player });
  if (params.get('yaw')) game.player.yaw = Number(params.get('yaw')) * Math.PI / 180;
  if (params.get('pitch')) game.player.pitch = Number(params.get('pitch')) * Math.PI / 180;
  if (params.get('cam') === 'out') { game.player.mode = 'orbit'; Object.assign(game.player.orbit, { yaw: Number(params.get('oyaw') ?? 140) * Math.PI / 180, pitch: Number(params.get('opitch') ?? 12) * Math.PI / 180, dist: Number(params.get('dist') ?? 70) }); }
  if (params.get('order')) game.sim.crew.order(params.get('order'), params.get('depth') ? { depth: Number(params.get('depth')) * 0.3048 } : {});
  if (params.get('skip')) {
    // (the waves she makes are stepped with her, so they are there when the view opens)
    for (let t = Number(params.get('skip')); t > 0; t -= 1 / 15) { game.sim.advance(Math.min(t, 1 / 15)); game.wake.step(Math.min(t, 1 / 15), game.sim.plant.dyn, game.sim.plant, game.sim.sea); }
  }
  if (params.get('dbgsurf')) game.stage.surface.debug = true;
  for (const k of ['surface', 'fog', 'acrylic', 'bloom', 'motionBlur', 'screen']) if (params.get('no' + k)) game.stage[k].enabled = false;
  ui.querySelector('.loading')?.remove();
  const hud = new HUD(ui, game);
  const orders = new Orders(ui, game);
  if (params.get('scope')) { const P = game.sim.plant; P.set('ct.scope1', 1); P.scopes[0] = 1; Object.assign(game.player.p, { level: 'ct', x: 10.85, z: 0.35 }); game.player.takeScope(); if (params.get('power')) game.player.scope.power = Number(params.get('power')); }
  if (!manual) { const x = document.createElement('div'); x.className = 'crosshair'; ui.append(x); }
  void orders;
  if (touch) { game.touch = true; new Touch(ui, game); }
  if (manual && params.get('hud') !== '1') hud.toggle();
  game.onFrame = (dt) => hud.update(dt);
  window.game = { game, stage: game.stage, sim: game.sim, ready: true, advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) game.frame(dt / n); } };
  if (!manual) {
    game.sound.attach(window);
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; game.frame(game.paused ? 0 : dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') game.timeScale = Math.min(16, game.timeScale * 2);
    if (e.key === '-') game.timeScale = Math.max(1, game.timeScale / 2);
    if (e.code === 'KeyP') game.paused = !game.paused;
    if (e.code === 'KeyT') hud.toggle();
  });
  void fmt;
}

go().catch((e) => { console.error(e); loading(`<span style="color:#f99">${e.message}</span>`); });
