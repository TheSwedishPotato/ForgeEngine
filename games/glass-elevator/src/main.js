/**
 * Glass Elevator: a 30-storey panoramic traction elevator on the Stockholm waterfront,
 * Tuesday 27 October 2026.
 *
 * (Development: ?q=<quality> &t=<hh:mm> &floor=<car's floor> &load=<kg> &at=<x>,<y>,<z> &yaw=<deg>
 *  &pitch=<deg> &cam=out &manual=1 for the screenshot tool.)
 */
import './style.css';
import { Game } from './game.js';
import { hms } from './sim.js';
import { HUD } from './ui/hud.js';
import { Touch, isTouchDevice } from './ui/touch.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
const manual = !!params.get('manual');
const touch = params.get('touch') ? params.get('touch') === '1' : isTouchDevice();

function loading(text) {
  let el = ui.querySelector('.loading');
  if (!el) { el = document.createElement('div'); el.className = 'loading'; ui.append(el); }
  el.innerHTML = `<b>Glass Elevator</b>${text}`;
  return el;
}

async function go() {
  loading('Hanging the ropes, charging the governor, opening the doors…');
  await new Promise((r) => setTimeout(r, 20));
  const game = new Game(canvas, { quality: params.get('q') ?? (touch ? 'low' : 'high'), clock: params.get('t') ? hms(params.get('t')) : undefined, floor: Number(params.get('floor') ?? 1), load: Number(params.get('load') ?? 0) });
  game.touch = touch;
  const at = params.get('at')?.split(',').map(Number);
  if (at) game.player.teleport(at);
  if (params.get('yaw')) game.player.yaw = (Number(params.get('yaw')) * Math.PI) / 180;
  if (params.get('pitch')) game.player.pitch = (Number(params.get('pitch')) * Math.PI) / 180;
  if (params.get('cam') === 'out') { game.player.mode = 'orbit'; Object.assign(game.player.orbit, { yaw: Number(params.get('oyaw') ?? 35) * Math.PI / 180, pitch: Number(params.get('opitch') ?? 8) * Math.PI / 180, dist: Number(params.get('dist') ?? 26) }); }
  ui.querySelector('.loading')?.remove();
  const hud = new HUD(ui, game);
  if (params.get('tele')) hud.tele.style.display = '';
  if (!manual) { const x = document.createElement('div'); x.className = 'crosshair'; ui.append(x); }
  if (touch) new Touch(ui, game, hud);
  game.onFrame = (dt) => hud.update(dt);
  window.game = { game, stage: game.stage, sim: game.sim, hud, ready: true, advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) game.frame(dt / n); } };
  if (!manual) {
    game.sound.attach(window);
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; game.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  window.addEventListener('keydown', (e) => {
    if (e.target?.tagName === 'INPUT') return;
    if (e.key === '+' || e.key === '=') game.timeScale = Math.min(16, game.timeScale * 2);
    if (e.key === '-') game.timeScale = Math.max(0.125, game.timeScale / 2);
    if (e.code === 'KeyP') game.paused = !game.paused;
  });
}

go().catch((e) => { console.error(e); loading(`<span style="color:#f99">${e.message}</span>`); });
