/**
 * The page around the simulator: the start card, the read-out, the tooltip under the mouse, the checklists and the
 * flight-and-weather panel. The game itself (src/game/game.js) does not know about any of this.
 *
 *   npm start            then open http://localhost:8080/
 *   ?start=cold|ready|runway|final|cruise   ?wx=<preset name>   ?hour=14   ?go=1 (skip the start card)   ?quality=low|medium|high|ultra
 */
import { Engine, QUALITY } from '../medengine/src/index.js';
import { BrowserPlatform } from '../medengine/src/platform/browser.js';
import { createGame, WEATHER_PRESETS, FIELD } from './src/game/game.js';
import { KT } from './src/sim/util.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const canvas = $('view'), params = new URLSearchParams(location.search);
const hud = $('hud'), tip = $('tip'), side = $('side'), caption = $('caption'), banner = $('banner'), status = $('status'), fly = $('fly');
let engine = null, game = null, panel = null, hudOn = true, flying = false;

for (const name of Object.keys(WEATHER_PRESETS)) $('sWx').append(el('option', { value: name, textContent: name }));
$('sWx').value = params.get('wx') ?? 'Fair, light wind';
if (params.get('start')) $('sStart').value = params.get('start');
if (params.get('hour')) $('sHour').value = params.get('hour');
const hhmm = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const showHour = () => { $('sHourV').textContent = hhmm(+$('sHour').value); };
$('sHour').addEventListener('input', showHour); showHour();
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------------------------------------------- checklists
const CHECKLISTS = [
  ['Walk-round', ['Look from outside: <kbd>2</kbd>, right-drag to walk round', 'Tie-down ropes <i>— click to untie</i>', 'Wheel chocks <i>— click to remove</i>', 'Pitot tube cover (left wing) <i>— click to remove</i>', 'Back in the cockpit: <kbd>1</kbd>']],
  ['Before starting', ['Control lock <i>— remove (the red flag on the yoke)</i>', 'Parking brake <i>— SET</i>', 'Circuit breakers <i>— all in</i>', 'Avionics master <i>— OFF</i>', 'Fuel selector (on the floor) <i>— BOTH</i>']],
  ['Starting the engine', ['Mixture <i>— RICH (in)</i>', 'Carburettor heat <i>— COLD (in)</i>', 'Master switch <i>— ON (both halves)</i>', 'Primer <i>— 2 to 6 strokes when cold, none when warm; then lock</i>', 'Throttle <i>— open a little (about 10 %)</i>', 'Beacon <i>— ON</i>',
    'Ignition <i>— click round to BOTH, then hold to START; release when it fires</i>', 'Oil pressure <i>— rising within 30 seconds</i>', 'Ammeter <i>— charging; low-voltage light out</i>', 'Avionics master, radios <i>— ON</i>']],
  ['Before take-off', ['Flight controls <i>— free and correct</i>', 'Altimeter <i>— set to the QNH (listen to ATIS on 126.025)</i>', 'Heading indicator <i>— set to the compass</i>', 'Elevator trim <i>— TAKE-OFF</i>', 'Throttle <i>— 1700 rpm</i>',
    'Magnetos <i>— R, then L: drop under 125 rpm each, within 50 of each other; back to BOTH</i>', 'Carburettor heat <i>— pull: rpm drops; push in</i>', 'Suction <i>— in the green</i>', 'Engine gauges <i>— in the green</i>', 'Throttle <i>— 1000 rpm</i>', 'Flaps <i>— UP, or 10° for a short field</i>', 'Strobes, landing light <i>— ON</i>', 'Parking brake <i>— release</i>']],
  ['Take-off and climb', ['Throttle <i>— smoothly FULL (2300 to 2420 rpm standing still)</i>', 'Keep straight with rudder <i>— it pulls left</i>', 'Raise the nose wheel <i>— 55 KIAS</i>', 'Climb <i>— 76 KIAS for best rate</i>', 'Above 3000 ft <i>— lean the mixture for most rpm</i>']],
  ['Cruise', ['Power <i>— 2100 to 2700 rpm (2500 is about 75 %)</i>', 'Trim <i>— until the yoke needs no force</i>', 'Mixture <i>— lean until the EGT peaks, then enrich a little</i>', 'Heading indicator <i>— check against the compass every 15 minutes</i>', 'Carburettor heat <i>— if rpm sags in damp air</i>']],
  ['Approach and landing', ['Mixture <i>— RICH</i>', 'Carburettor heat <i>— ON before reducing power</i>', 'Flaps <i>— 10° below 110 KIAS, more below 85</i>', 'Approach <i>— 65 KIAS with full flap, 70 without</i>', 'PAPI <i>— two red, two white</i>', 'Touch down on the main wheels; hold the nose off', 'Brakes <i>— as needed</i>']],
  ['After landing, shut-down', ['Flaps <i>— UP</i>', 'Carburettor heat <i>— COLD</i>', 'Parking brake <i>— SET</i>', 'Avionics master <i>— OFF</i>', 'Throttle <i>— 1000 rpm</i>', 'Mixture <i>— IDLE CUT-OFF (pull right out)</i>', 'Ignition <i>— OFF</i>', 'Master switch <i>— OFF</i>', 'Control lock <i>— fit</i>']],
  ['Speeds (KIAS)', ['Rotate 55 · best angle 60 · best rate 76', 'Best glide 65', 'Stall: 44 clean, 33 full flap', 'Flaps: 110 for 10°, 85 beyond', 'Manoeuvring 99 at full weight', 'Normal operation up to 127; never exceed 158', 'Largest demonstrated crosswind 15 kt']],
];
const KEYS = [
  ['↑ ↓ ← → or W S A D', 'yoke: pitch and roll (↓ pulls back)'], ['Q E (or Z X)', 'rudder pedals; they also steer the nose wheel'], ['Page Up / Page Down (or = −)', 'throttle'],
  ['Home / End', 'elevator trim: nose down / nose up'], ['F / R (or ] [)', 'flaps down / up one notch'], ['B or Space', 'both wheel brakes'], [', and .', 'left / right brake'], ['K', 'parking brake'],
  ['Y', 'fly with the mouse (it becomes the yoke; Y or Esc lets go)'], ['1 2 3', 'cockpit / outside / tower'], ['right-drag, wheel', 'look around, zoom'], ['V', 'hold to look closer'], ['0', 'centre the view'],
  ['C · M · F1 · H', 'checklists · flight and weather · this list · read-out'], ['P', 'pause'],
  ['Mouse on a control', 'click a switch; drag a lever or knob up and down; the wheel turns knobs; right-click steps back'],
  ['Gamepad', 'left stick yoke, right stick rudder, bumpers throttle, A brakes, d-pad flaps, X/Y trim'],
];

function slider(label, min, max, step, get, set, fmt) {
  const out = el('span'), input = el('input', { type: 'range', min, max, step, value: get() });
  const show = () => { out.textContent = fmt(+input.value); };
  input.addEventListener('input', () => { set(+input.value); show(); }); show();
  return el('label', {}, el('span', { textContent: label }), input, out);
}
function show(which) {
  panel = panel === which ? null : which;
  side.style.display = panel ? 'block' : 'none';
  side.replaceChildren();
  if (!panel) return;
  if (panel === 'check') {
    for (const [title, items] of CHECKLISTS) { const ol = el('ol'); for (const s of items) ol.append(el('li', { innerHTML: s })); side.append(el('h3', { textContent: title }), ol); }
  } else if (panel === 'keys') {
    const t = el('table', { className: 'keys' }); for (const [k, d] of KEYS) t.append(el('tr', {}, el('td', {}, el('kbd', { textContent: k })), el('td', { textContent: d })));
    side.append(el('h3', { textContent: 'Keys and mouse' }), t);
  } else {
    const w = game.weather, ac = game.ac, row = el('div', { className: 'row' });
    for (const [k, name] of [['cold', 'Cold and dark'], ['ready', 'Engine running'], ['runway', 'On the runway'], ['final', 'On final'], ['cruise', 'Cruise']]) row.append(el('button', { textContent: name, onclick: () => { game.reset(k); canvas.focus(); } }));
    const wx = el('select'); for (const name of Object.keys(WEATHER_PRESETS)) wx.append(el('option', { value: name, textContent: name }));
    wx.value = ''; wx.addEventListener('change', () => { game.setWeather(wx.value); show('set'); show('set'); });
    side.append(el('h3', { textContent: 'Put the aeroplane' }), row, el('h3', { textContent: 'Weather' }), el('div', { className: 'row' }, wx),
      slider('Wind from', 0, 350, 10, () => w.windDir, (v) => { w.windDir = v; w.aloftDir = (v + 20) % 360; }, (v) => `${String(v).padStart(3, '0')}° T`),
      slider('Wind speed', 0, 18, 0.5, () => w.windSpeed, (v) => { w.windSpeed = v; w.aloftSpeed = Math.max(w.aloftSpeed, v * 1.6); }, (v) => `${(v / KT).toFixed(0)} kt`),
      slider('Gusts', 0, 10, 0.5, () => w.gust, (v) => { w.gust = v; }, (v) => `+${(v / KT).toFixed(0)} kt`),
      slider('Turbulence', 0, 3, 0.1, () => w.turbulence, (v) => { w.turbulence = v; }, (v) => `× ${v.toFixed(1)}`),
      slider('Temperature', -25, 38, 1, () => w.oat, (v) => { w.oat = v; w.dewpoint = Math.min(w.dewpoint, v); }, (v) => `${v} °C`),
      slider('Dew point', -30, 30, 1, () => w.dewpoint, (v) => { w.dewpoint = Math.min(v, w.oat); }, (v) => `${v} °C`),
      slider('QNH', 970, 1045, 1, () => Math.round(w.qnh / 100), (v) => { w.qnh = v * 100; }, (v) => `${v} hPa`),
      slider('Cloud', 0, 1, 0.05, () => w.cloudCover, (v) => { w.cloudCover = v; }, (v) => `${Math.round(v * 8)}/8`),
      slider('Rain', 0, 1, 0.05, () => w.rain, (v) => { w.rain = v; }, (v) => `${Math.round(v * 100)} %`),
      slider('Local time', 0, 23.75, 0.25, () => w.hour % 24, (v) => { w.hour = v; }, hhmm),
      el('h3', { textContent: 'On board' }),
      slider('Pilot', 50, 120, 1, () => ac.payload.pilot, (v) => { ac.payload.pilot = v; }, (v) => `${v} kg`),
      slider('Front passenger', 0, 120, 1, () => ac.payload.copilot, (v) => { ac.payload.copilot = v; }, (v) => `${v} kg`),
      slider('Rear seats', 0, 180, 1, () => ac.payload.rear, (v) => { ac.payload.rear = v; }, (v) => `${v} kg`),
      slider('Baggage', 0, 54, 1, () => ac.payload.baggage, (v) => { ac.payload.baggage = v; }, (v) => `${v} kg`),
      slider('Fuel, left', 1.5, 21.5, 0.5, () => ac.fuel.gallons(0), (v) => { ac.fuel.tank[0] = v * ac.fuel.capacity / 21.5; }, (v) => `${v.toFixed(1)} gal`),
      slider('Fuel, right', 1.5, 21.5, 0.5, () => ac.fuel.gallons(1), (v) => { ac.fuel.tank[1] = v * ac.fuel.capacity / 21.5; }, (v) => `${v.toFixed(1)} gal`),
      el('h3', { textContent: 'Picture' }));
    const q = el('div', { className: 'row' }); for (const name of ['low', 'medium', 'high', 'ultra']) q.append(el('button', { textContent: name, onclick: () => engine.stage.setQuality(name) }));
    side.append(q, el('button', { textContent: 'Sound on / off', onclick: () => { game.sound.muted = !game.sound.muted; } }));
  }
}
$('bCheck').onclick = () => show('check'); $('bSet').onclick = () => show('set'); $('bKeys').onclick = () => show('keys');
window.addEventListener('keydown', (e) => {
  if (!game || !flying) return;
  if (e.code === 'KeyC') show('check'); else if (e.code === 'KeyM') show('set'); else if (e.code === 'F1') { show('keys'); e.preventDefault(); } else if (e.code === 'KeyH') { hudOn = !hudOn; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.code)) e.preventDefault();
});

// ---------------------------------------------------------------------------------------------------------------- the read-out
const pad = (v, n) => String(Math.round(v)).padStart(n, ' ');
function paint() {
  const s = game.info();
  hud.hidden = !hudOn;
  if (hudOn) {
    const lines = [
      `<b>IAS</b> ${pad(s.kias, 3)} kt   <b>ALT</b> ${pad(s.alt, 5)} ft   <b>VS</b> ${pad(s.vs, 5)}`,
      `<b>HDG</b> ${String(Math.round(s.hdg) % 360).padStart(3, '0')}°    <b>RPM</b> ${pad(s.rpm, 4)}     <b>AGL</b> ${pad(s.agl, 5)} ft`,
      `<b>THR</b> ${pad(s.throttle * 100, 3)} %   <b>MIX</b> ${pad(s.mixture * 100, 3)} %   <b>FLAP</b> ${pad(s.flaps, 2)}°`,
      `<b>TRIM</b> ${s.trim >= 0 ? '+' : '−'}${Math.abs(s.trim * 100).toFixed(0).padStart(2, '0')}   <b>FUEL</b> ${s.fuelL.toFixed(1)} / ${s.fuelR.toFixed(1)} gal`,
      `<b>WIND</b> ${s.wind}   ${s.onGround ? `on ${s.surface}` : `${s.g.toFixed(1)} g`}${s.parkBrake ? '   <span class="warn">PARK BRAKE</span>' : s.brake > 0 ? '   BRAKES' : ''}`,
    ];
    if (s.stall) lines.push('<span class="warn">STALL WARNING</span>');
    if (s.mouseYoke) lines.push('mouse is the yoke — Y to let go');
    if (s.paused) lines.push('<span class="warn">PAUSED — P</span>');
    hud.innerHTML = lines.join('\n');
  }
  if (s.tip) { tip.textContent = s.tip; tip.style.display = 'block'; tip.style.left = `${Math.min(s.mouse.x + 18, innerWidth - 440)}px`; tip.style.top = `${s.mouse.y + 20}px`; } else tip.style.display = 'none';
  if (s.caption) { caption.textContent = s.caption; caption.style.display = 'block'; } else caption.style.display = 'none';
  if (s.message) {
    if (banner.dataset.m !== s.message) {
      banner.dataset.m = s.message;
      banner.replaceChildren(el('b', { textContent: 'Accident: ' }), document.createTextNode(s.message), el('br'),
        el('button', { textContent: 'Back to the apron', onclick: () => game.reset('cold') }), el('button', { textContent: 'Line up on the runway', onclick: () => game.reset('runway') }), el('button', { textContent: 'Try the approach again', onclick: () => game.reset('final') }));
    }
    banner.style.display = 'block';
  } else { banner.style.display = 'none'; banner.dataset.m = ''; }
}

// ---------------------------------------------------------------------------------------------------------------- start
async function boot() {
  try {
    const quality = QUALITY[params.get('quality')] ? params.get('quality') : 'high';
    engine = await Engine.create({ platform: new BrowserPlatform({ canvas }), quality, renderScale: Number(params.get('scale')) || undefined, camera: { fov: 62, near: 0.05, far: 90000 } });
    game = createGame(engine, { start: $('sStart').value, preset: $('sWx').value });
    game.weather.hour = +$('sHour').value;
    engine.on('update', paint);
    engine.on('error', (e) => console.error(e));
    window.__sim = { engine, game };
    engine.tick(1 / 60);
    fly.disabled = false; fly.textContent = 'Fly';
    if (params.get('go')) begin();
  } catch (e) {
    console.error(e);
    status.className = 'bad'; status.textContent = ` ${e?.message ?? e}`; fly.textContent = 'Not available';
  }
}
function begin() {
  const kind = $('sStart').value;
  game.setWeather($('sWx').value); game.weather.hour = +$('sHour').value;
  game.reset(kind);
  game.sound.start();
  $('splash').remove(); $('bar').hidden = false; hud.hidden = false; flying = true;
  canvas.focus();
  engine.start();
  if (kind === 'cold') show('check');
}
fly.addEventListener('click', begin);
boot();
