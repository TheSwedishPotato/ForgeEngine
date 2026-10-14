/**
 * The DeLorean time machine on the Med Engine.
 *
 * (Development: ?dev=stage the bare stage, ?dev=car the car on a turntable; ?manual=1 for the
 *  screenshot tool, which drives the game through window.game.)
 */
import './style.css';
import { Game } from './game/game.js';
import { startScreen, HUD, Keypad, Help, Touch, longDate } from './ui/ui.js';
import { Sound } from './audio/sound.js';
import { START, MAIN_Z } from './world/map.js';

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
  const phone = /(iPhone|iPad|Android)/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches);
  let opts = { quality: params.get('q') ?? (phone ? 'low' : 'high'), version: params.get('ver') ?? 'part1', gearbox: 'auto' };
  if (!manual && !params.get('go')) opts = await startScreen(ui, opts);
  loading('Charging the flux capacitor…');
  await new Promise((r) => setTimeout(r, 30));
  const places = { lot: START, main: { x: -700, z: MAIN_Z + 3.5, heading: 0 } };
  const o = { ...opts, place: places[opts.place] ?? START };
  if (params.get('t')) o.start = parseTime(params.get('t'));
  if (params.get('dest')) o.destination = parseTime(params.get('dest'));
  if (params.get('x')) o.place = { x: Number(params.get('x')), z: Number(params.get('z') ?? 40), heading: Number(params.get('h') ?? 0) };
  if (params.get('empty')) o.empty = true;
  const game = await Game.create(canvas, o);
  ui.querySelector('.loading')?.remove();
  if (params.get('cam')) game.rig.setMode(params.get('cam'));
  if (params.get('tc')) game.toggleTimeCircuits();
  if (params.get('doors')) game.car.setDoors(1);
  if (params.get('noglass')) game.stage.glass.enabled = false;
  if (params.get('nofx')) game.stage.fx.enabled = false;
  if (params.get('speed')) game.veh.reset({ x: game.veh.x, z: game.veh.z, heading: game.veh.heading, speed: Number(params.get('speed')) / 2.2369363, gear: 4 });
  game.timeScale = Number(params.get('ts') ?? 1);
  // the screens and the sound
  const hud = new HUD(ui, game), keypad = new Keypad(ui, game), help = new Help(ui);
  const touch = new Touch(ui, game, canvas);
  game.ui = { hud, keypad, help, touch };
  const sound = (game.sound = new Sound());
  sound.attach(window);
  if (manual && params.get('hud') !== '1') { hud.root.classList.add('hidden'); touch.root.classList.add('hidden'); }
  wireEvents(game, hud, sound);
  game.onFrame = (dt) => {
    hud.update(); keypad.update();
    const v = game.veh;
    sound.update({
      rpm: v.rpm, throttle: v.input.throttle, running: v.running, speed: v.speed, skid: Math.max(...v.wheels.map((w) => w.skid)),
      inside: game.rig.mode === 'driver' || game.rig.mode === 'passenger', flux: game.flux ?? 0, armed: game.tc.armed,
      arcs: game.tc.armed ? Math.max(0, (v.speedoMph - 80) / 8) : (game.travel.phase === 'depart' ? 1 : 0), frost: game.travel.frost,
      night: game.stage.night ?? 0, rural: game.world.state.era !== 'decline' && game.world.state.era !== 'future',
    });
    void dt;
  };
  window.game = {
    game, ready: true,
    advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) game.frame(dt / n); },
    // a little script for tests: "tc;hold:KeyW;sim:18;wait:0.5"
    script(s) {
      for (const step of s.split(';')) {
        const [cmd, arg] = step.split(':');
        if (cmd === 'hold') game.input.keys.add(arg);
        if (cmd === 'release') game.input.keys.delete(arg);
        if (cmd === 'tc') game.toggleTimeCircuits();
        if (cmd === 'type') for (const k of arg) game.keypad(k);
        if (cmd === 'wait') this.advance(Number(arg));
        // simulate without drawing (fast)
        if (cmd === 'sim') { game.skipRender = true; const n = Math.round(Number(arg) * 60); for (let i = 0; i < n; i++) game.frame(1 / 60); game.skipRender = false; }
        if (cmd === 'cam') game.rig.setMode(arg);
        if (cmd === 'keypad') keypad.toggle(true);
        if (cmd === 'look') { const [y, p] = arg.split(',').map(Number); game.rig.yaw = y * Math.PI / 180; game.rig.pitch = p * Math.PI / 180; }
        if (cmd === 'orbit') { const [y, p, d] = arg.split(',').map(Number); game.rig.orbitYaw = y * Math.PI / 180; game.rig.orbitPitch = p * Math.PI / 180; if (d) game.rig.orbitDist = d; }
      }
    },
  };
  const keys = {
    KeyC: () => game.rig.cycle(),
    KeyT: () => game.toggleTimeCircuits(),
    KeyK: () => keypad.toggle(),
    KeyH: () => help.toggle(),
    KeyL: () => game.toggleHeadlights(),
    KeyG: () => game.toggleDoor('left'),
    KeyJ: () => game.toggleDoor('right'),
    KeyF: () => game.refuel(),
    KeyN: () => sound.toggle(),
    KeyP: () => { game.paused = !game.paused; },
    KeyM: () => { game.veh.auto = !game.veh.auto; hud.say(game.veh.auto ? 'Automatic' : 'Manual: Q / E change gear'); },
    KeyQ: () => { if (!game.veh.auto) game.veh.shiftDown(); },
    KeyE: () => { if (!game.veh.auto) game.veh.shiftUp(); },
    Equal: () => { game.timeScale = Math.min(600, game.timeScale * 4); hud.say(`Clock x${game.timeScale}`); },
    Minus: () => { game.timeScale = Math.max(1, game.timeScale / 4); hud.say(`Clock x${game.timeScale}`); },
    Enter: () => game.keypad('enter'),
    NumpadEnter: () => game.keypad('enter'),
    Backspace: () => game.keypad('clear'),
    Delete: () => game.keypad('clear'),
    Escape: () => { keypad.toggle(false); help.toggle(false); },
    KeyR: () => { if (game.storm.active(game.local)) game.retryLightning(); },
  };
  game.input.onKey((e) => {
    if (e.repeat) return;
    if (keys[e.code]) { keys[e.code](); e.preventDefault(); return; }
    const m = /^(Digit|Numpad)([0-9])$/.exec(e.code);
    if (m) { if (!game.tc.on) game.toggleTimeCircuits(); game.keypad(m[2]); }
  });
  hud.say(game.tc.destination ? 'Press <b>T</b> for the time circuits, then bring her up to 88 mph' : 'Set a destination: <b>K</b>', '', 6);
  if (!manual) {
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; game.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  return game;
}

/** What the game's events show and sound like. */
function wireEvents(game, hud, sound) {
  let warnedEmpty = 0;
  game.on((e) => {
    switch (e.type) {
      case 'lever': sound.circuits(e.on); hud.say(e.on ? 'Time circuits on' : 'Time circuits off'); break;
      case 'keypad': if (e.ok !== false || e.key === 'clear') sound.key(e.key); break;
      case 'tc':
        if (e.ev === 'set') hud.say(`Destination set: <b>${longDate(e.destination)}</b>`, 'when');
        if (e.ev === 'error') { sound.error(); hud.say('Not a date the circuits can take', 'warn'); }
        break;
      case 'boom': sound.booms(!!e.arrival); break;
      case 'arrive': hud.say(longDate(e.at), 'when big', 7); break;
      case 'door': sound.door(e.open); break;
      case 'refuel':
        if (e.ok) { sound.tone(e.fusion ? 300 : 180, 0.4, 0.1, 'sawtooth'); hud.say(e.fusion ? 'Mr. Fusion: 1.21 gigawatts' : 'Plutonium loaded: 1.21 gigawatts'); }
        else hud.say(e.why === 'moving' ? 'Stop the car first' : e.why === 'full' ? 'The chamber is already loaded' : 'No plutonium left', 'warn');
        break;
      case 'hit': if (e.speed > 2) { sound.thud(Math.min(1, e.speed / 15)); if (e.speed > 8 && !e.soft) hud.say('Crash!', 'warn'); } break;
      case 'thunder': sound.thunder(e.delay, e.size, e.strike); break;
      case 'strike': hud.say('10:04 PM — the lightning strikes the clock tower!', 'big', 5); break;
      case 'contact': hud.say('<b>1.21 GIGAWATTS!</b>', 'big', 4); break;
      case 'retry': hud.say('Back at the end of Main Street. The bolt strikes at 10:04:00 PM.', '', 5); break;
      case 'pine': hud.say('You ran down one of Old Man Peabody\'s young pines…', '', 6); break;
    }
  });
  // 88 mph without power: the EMPTY lamp, once a run
  game.on((e) => { if (e.type === 'empty' && Date.now() - warnedEmpty > 8000) { warnedEmpty = Date.now(); hud.say('<b>EMPTY</b> — no power at the flux capacitor', 'warn'); sound.error(); } });
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
