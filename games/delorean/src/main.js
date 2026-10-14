/**
 * The DeLorean time machine on the Med Engine.
 *
 * (Development: ?dev=stage the bare stage, ?dev=car the car on a turntable; ?manual=1 for the
 *  screenshot tool, which drives the game through window.game.)
 */
import './style.css';
import { Game } from './game/game.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
const manual = !!params.get('manual');

function loading(text) {
  let el = ui.querySelector('.loading');
  if (!el) { el = document.createElement('div'); el.className = 'loading'; ui.append(el); }
  el.innerHTML = `<b>TIME MACHINE</b>${text}`;
  return el;
}

function parseTime(s) {
  const [d, t = '00:00'] = s.split('T');
  const [y, mo, dd] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
  return { y, mo, d: dd, h, mi };
}

async function play() {
  loading('Charging the flux capacitor…');
  await new Promise((r) => setTimeout(r, 20));
  const opts = { quality: params.get('q') ?? (/(iPhone|iPad|Android)/i.test(navigator.userAgent) ? 'low' : 'high'), version: params.get('ver') ?? 'part1' };
  if (params.get('t')) opts.start = parseTime(params.get('t'));
  if (params.get('dest')) opts.destination = parseTime(params.get('dest'));
  if (params.get('x')) opts.place = { x: Number(params.get('x')), z: Number(params.get('z') ?? 40), heading: Number(params.get('h') ?? 0) };
  const game = await Game.create(canvas, opts);
  ui.querySelector('.loading')?.remove();
  if (params.get('cam')) game.rig.setMode(params.get('cam'));
  if (params.get('tc')) game.toggleTimeCircuits();
  if (params.get('doors')) game.car.setDoors(1);
  if (params.get('noglass')) game.stage.glass.enabled = false;
  if (params.get('nofx')) game.stage.fx.enabled = false;
  if (params.get('speed')) game.veh.reset({ x: game.veh.x, z: game.veh.z, heading: game.veh.heading, speed: Number(params.get('speed')) / 2.2369363, gear: 4 });
  game.timeScale = Number(params.get('ts') ?? 1);
  window.game = {
    game, ready: true,
    advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) game.frame(dt / n); },
    // a little script for tests: "key:KeyW=1;wait:5;key:KeyW=0"
    script(s) {
      for (const step of s.split(';')) {
        const [cmd, arg] = step.split(':');
        if (cmd === 'hold') game.input.keys.add(arg);
        if (cmd === 'release') game.input.keys.delete(arg);
        if (cmd === 'tc') game.toggleTimeCircuits();
        if (cmd === 'type') for (const k of arg) game.keypad(k);
        if (cmd === 'wait') this.advance(Number(arg));
        // simulate without drawing (fast), then draw a few frames to settle the image
        if (cmd === 'sim') { game.skipRender = true; const n = Math.round(Number(arg) * 60); for (let i = 0; i < n; i++) game.frame(1 / 60); game.skipRender = false; }
        if (cmd === 'cam') game.rig.setMode(arg);
        if (cmd === 'look') { const [y, p] = arg.split(',').map(Number); game.rig.yaw = y * Math.PI / 180; game.rig.pitch = p * Math.PI / 180; }
        if (cmd === 'orbit') { const [y, p, d] = arg.split(',').map(Number); game.rig.orbitYaw = y * Math.PI / 180; game.rig.orbitPitch = p * Math.PI / 180; if (d) game.rig.orbitDist = d; }
      }
    },
  };
  const keys = {
    KeyC: () => game.rig.cycle(),
    KeyT: () => game.toggleTimeCircuits(),
    KeyL: () => game.toggleHeadlights(),
    KeyG: () => game.toggleDoor('left'),
    KeyJ: () => game.toggleDoor('right'),
    KeyF: () => game.loadPlutonium(),
    KeyP: () => { game.paused = !game.paused; },
    KeyM: () => { game.veh.auto = !game.veh.auto; },
    KeyQ: () => { if (!game.veh.auto) game.veh.shiftDown(); },
    KeyE: () => { if (!game.veh.auto) game.veh.shiftUp(); },
    Enter: () => game.keypad('enter'),
    NumpadEnter: () => game.keypad('enter'),
    Backspace: () => game.keypad('clear'),
    Delete: () => game.keypad('clear'),
  };
  game.input.onKey((e) => {
    if (e.repeat) return;
    if (keys[e.code]) { keys[e.code](); e.preventDefault(); return; }
    const m = /^(Digit|Numpad)([0-9])$/.exec(e.code);
    if (m) game.keypad(m[2]);
  });
  if (!manual) {
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; game.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  return game;
}

async function boot() {
  let app;
  if (params.get('dev') === 'stage') app = await (await import('./dev-stage.js')).devStage(canvas, params);
  else if (params.get('dev') === 'car') app = await (await import('./dev-car.js')).devCar(canvas, params);
  else return play();
  window.game = { ...app, ready: true, advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) app.frame(dt / n); } };
  if (!manual) {
    let last = performance.now();
    const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; app.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
boot().catch((e) => { console.error(e); window.game = { error: String(e.stack || e) }; loading(`<span style="color:#f99">${e.message}</span>`); });
