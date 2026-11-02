/**
 * Verkstan: a car workshop on Hisingen, Gothenburg, Monday 2 November 2026.
 *
 * (Development: ?q=<quality> &offline=1 (no AI) &car=volvo240|golf7|f1_2026 (the first customer's
 *  car, offline) &fault=<id>[,<id>] &at=<x>,<y>,<z> &yaw=<deg> &pitch=<deg> &hood=1 &lift=<m>
 *  &manual=1 for the screenshot tool.)
 */
import './style.css';
import { Game } from './game.js';
import { HUD } from './ui/hud.js';
import { offlineCustomer } from './ai/offline.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
const manual = !!params.get('manual');
const touch = matchMedia('(pointer: coarse)').matches && !params.get('desktop');

function loading(text) {
  let el = ui.querySelector('.loading');
  if (!el) { el = document.createElement('div'); el.className = 'loading'; ui.append(el); }
  el.innerHTML = `<b>Verkstan</b>${text}`;
  return el;
}

async function go() {
  loading('Switching on the lights, filling the compressor, putting the coffee on…');
  await new Promise((r) => setTimeout(r, 20));
  const offline = !!params.get('offline') || !!params.get('car');
  const game = new Game(canvas, { quality: params.get('q') ?? (touch ? 'low' : 'high'), manual, touch, offline });
  const hud = new HUD(ui, game);
  if (params.get('car') || params.get('fault')) {
    const p = offlineCustomer(Math.random, { wantCar: params.get('car') ?? 'volvo240', allowF1: true });
    if (params.get('fault')) p.faults = params.get('fault').split(',').map((f) => ({ id: f.split(':')[0], where: f.split(':')[1] ?? '' }));
    if (params.get('paint')) p.paint = '#' + params.get('paint');
    await game.brain.probe();
    game._prefetch = () => { if (!game.queue.length) game.queue.push(offlineCustomer()); };
    await game.nextCustomer(p);
    game.carPos.t = 1;
  } else await game.start();
  const at = params.get('at')?.split(',').map(Number);
  if (at) game.player.teleport(at);
  if (params.get('yaw')) game.player.yaw = (Number(params.get('yaw')) * Math.PI) / 180;
  if (params.get('pitch')) game.player.pitch = (Number(params.get('pitch')) * Math.PI) / 180;
  if (params.get('hood')) { game.cust.A.state.hoodLatch = true; game.cust.A.state.hoodOpen = true; }
  if (params.get('lift')) { const W = game.workshop; for (let i = 0; i < 4; i++) { W.aimArm(i, game.cust.spec); W.lift.arms[i] = true; W.arms[i].userData.target = 1; } W.lift.y = Number(params.get('lift')); }
  if (params.get('pose')) game.player.pose = Number(params.get('pose'));
  ui.querySelector('.loading')?.remove();
  canvas.addEventListener('mousedown', (e) => {
    if (game.uiOpen) return;
    if (e.button === 0) game.press();
    if (e.button === 2 && (game.tool.id === 'gauge' || game.player.target?.id === 'liftbox')) game.press();
  });
  addEventListener('mouseup', () => game.release());
  game.onFrame = (dt) => hud.update(dt);
  window.game = { game, stage: game.stage, hud, ready: true, advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) game.frame(dt / n); } };
  if (!manual) {
    game.sound.attach(window);
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; game.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    let seen = false; try { seen = !!localStorage.getItem('verkstad.seenHelp'); localStorage.setItem('verkstad.seenHelp', '1'); } catch { /* private mode */ } if (!seen) hud.openHelp();
  }
  addEventListener('keydown', (e) => { if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return; if (e.code === 'KeyP') game.timeScale = game.timeScale ? 0 : 1; });
}

go().catch((e) => { console.error(e); loading(`<span style="color:#f99">${e.message}</span>`); });
