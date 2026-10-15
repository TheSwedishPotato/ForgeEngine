/**
 * The screens round the view: the start (when and how to begin), the head-up card (the time
 * circuits in small, the speed, what to do next), the keypad (type a destination, or pick a
 * famous one), messages, the help, and the touch controls for phones (steer by dragging the
 * left half, pedals on the right, buttons along the top).
 */
import { FAMOUS, TC_ROWS_UI } from './data.js';
import { MONTHS } from '../car/instruments.js';
import { utcToLocal, weekday } from '../astro.js';

const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };
const pad = (n, k = 2) => String(n).padStart(k, '0');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Phones and tablets have the on-screen buttons, not the keys: hints name what there is to press. */
const TOUCH_FIRST = typeof matchMedia === 'function' && !matchMedia('(hover: hover) and (pointer: fine)').matches;
const BUTTONS = { T: 'TIME CKT', K: 'KEYPAD', F: 'FUEL', R: 'RETRY' };
export function keyName(k) { return TOUCH_FIRST ? BUTTONS[k] ?? k : k; }

export function longDate(t) {
  if (!t) return '';
  const h12 = ((t.h + 11) % 12) + 1;
  return `${DAYS[weekday(t.y, t.mo, t.d)]}, ${MONTH_NAMES[t.mo - 1]} ${t.d}, ${String(t.y).padStart(4, '0')}, ${h12}:${pad(t.mi)} ${t.h < 12 ? 'AM' : 'PM'}`;
}

/** The start screen: resolves with the options. */
export function startScreen(ui, defaults) {
  return new Promise((resolve) => {
    const o = { ...defaults };
    const s = el('div', 'start');
    const starts = [
      { id: '1985', title: 'Twin Pines Mall', when: 'Saturday, 26 October 1985, 1:20 AM', text: 'The empty parking lot at night, where Doc first showed Marty the time machine. The time circuits are set for 5 November 1955.', start: { y: 1985, mo: 10, d: 26, h: 1, mi: 20 }, dest: { y: 1955, mo: 11, d: 5, h: 6, mi: 0 }, place: 'lot' },
      { id: '1955', title: 'Hill Valley, 1955', when: 'Saturday, 12 November 1955, 10:01 PM', text: 'The night of the storm. No plutonium: only the lightning that strikes the clock tower at 10:04 can send you home. Hit Doc\'s cable at 88 mph.', start: { y: 1955, mo: 11, d: 12, h: 22, mi: 1 }, dest: { y: 1985, mo: 10, d: 26, h: 1, mi: 24 }, place: 'main', empty: true },
      { id: '2015', title: 'Hill Valley, 2015', when: 'Wednesday, 21 October 2015, 4:28 PM', text: 'The future, in the last minute of rain. Mr. Fusion on the back: feed it rubbish and go anywhere.', start: { y: 2015, mo: 10, d: 21, h: 16, mi: 28 }, dest: { y: 1985, mo: 10, d: 26, h: 21, mi: 0 }, place: 'main', version: 'part2' },
      { id: '1885', title: 'Hill Valley, 1885', when: 'Wednesday, 2 September 1885, 8:00 AM', text: 'A frontier town of dirt streets and false fronts; the courthouse going up, its clock not yet hung.', start: { y: 1885, mo: 9, d: 2, h: 8, mi: 0 }, dest: { y: 1985, mo: 10, d: 27, h: 11, mi: 0 }, place: 'main', version: 'part2' },
    ];
    s.innerHTML = `
      <div class="start-head">
        <div class="kicker">On the Med Engine</div>
        <h1>TIME MACHINE</h1>
        <p class="lede">The DeLorean DMC-12 that Doc Brown built: stainless steel, gull-wing doors, the time circuits on the dash and the flux capacitor behind your head. Set a destination on the keypad, turn the time circuits on, and bring her up to 88 miles per hour.</p>
      </div>
      <div class="start-cols">
        <div><h2>When to begin</h2><div class="cards"></div></div>
        <div class="side">
          <h2>The car</h2><div class="opts ver"></div>
          <h2>Gearbox</h2><div class="opts row gearbox"></div>
          <h2>Picture</h2><div class="opts row quality"></div>
          <button class="go">Start</button>
          <p class="fine">On a phone: drag the left half to steer, the pedals are at the bottom right. Keys: H for help.</p>
        </div>
      </div>`;
    const cards = s.querySelector('.cards');
    let chosen = starts[0];
    for (const st of starts) {
      const b = el('button', 'card', `<b>${st.title}</b><i>${st.when}</i><span>${st.text}</span>`);
      b.onclick = () => { chosen = st; cards.querySelectorAll('.card').forEach((c) => c.classList.remove('on')); b.classList.add('on'); if (st.version) setVer(st.version); };
      if (st === chosen) b.classList.add('on');
      cards.append(b);
    }
    const group = (cls, items, key) => {
      const g = s.querySelector(cls);
      const bs = items.map(([v, label, sub]) => {
        const b = el('button', o[key] === v ? 'on' : '', `${label}${sub ? `<span>${sub}</span>` : ''}`);
        b.onclick = () => { o[key] = v; bs.forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
        g.append(b);
        return b;
      });
      return (v) => { o[key] = v; bs.forEach((x, i) => x.classList.toggle('on', items[i][0] === v)); };
    };
    const setVer = group('.ver', [['part1', 'Part I', 'plutonium reactor'], ['part2', 'Part II', 'Mr. Fusion']], 'version');
    group('.gearbox', [['auto', 'Automatic'], ['manual', 'Manual']], 'gearbox');
    group('.quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], 'quality');
    s.querySelector('.go').onclick = () => {
      s.remove();
      resolve({ ...o, start: chosen.start, destination: chosen.dest, place: chosen.place, empty: !!chosen.empty, scenario: chosen.id });
    };
    ui.append(s);
  });
}

// ---------------------------------------------------------------------------------------------

export class HUD {
  constructor(ui, game) {
    this.g = game;
    this.root = el('div', 'hud');
    this.root.innerHTML = `
      <div class="tcmini">${TC_ROWS_UI.map((r, i) => `<div class="tcr r${i}"><i>${r}</i><span class="d"></span></div>`).join('')}</div>
      <div class="drive"><b class="mph">0</b><small>MPH</small><span class="gear">N</span><span class="pu"></span></div>
      <div class="hint"></div>`;
    ui.append(this.root);
    this.rows = [...this.root.querySelectorAll('.tcr .d')];
    this.mph = this.root.querySelector('.mph');
    this.gear = this.root.querySelector('.gear');
    this.pu = this.root.querySelector('.pu');
    this.hint = this.root.querySelector('.hint');
    this.root.querySelector('.tcmini').onclick = () => game.ui?.keypad.toggle(true);
    this.msgs = el('div', 'msgs');
    ui.append(this.msgs);
  }

  fmt(t, on) {
    if (!on || !t) return '<em>--- -- ---- --:--</em>';
    const h12 = ((t.h + 11) % 12) + 1;
    return `${MONTHS[t.mo - 1]} ${pad(t.d)} ${pad(t.y, 4)} ${pad(h12)}:${pad(t.mi)}<sup>${t.h < 12 ? 'AM' : 'PM'}</sup>`;
  }

  update() {
    const g = this.g, tc = g.tc, on = tc.on;
    const rows = [tc.shownDestination(), tc.present, tc.lastDeparted];
    rows.forEach((t, i) => { const h = this.fmt(t, on && !!t); if (this.rows[i]._h !== h) { this.rows[i].innerHTML = h; this.rows[i]._h = h; } });
    const mph = Math.floor(g.veh.speedoMph);
    this.mph.textContent = mph;
    this.mph.classList.toggle('hot', tc.armed && mph >= 70);
    this.gear.textContent = g.veh.gear === 'N' ? 'N' : g.veh.gear === 'R' ? 'R' : `${g.veh.gear}`;
    this.pu.textContent = tc.power === 'fusion' ? (tc.charge ? 'Mr. Fusion: ready' : 'Mr. Fusion: empty') : tc.charge ? 'Plutonium: loaded' : tc.spare ? `Plutonium: EMPTY (${tc.spare} in the case: F)` : 'Plutonium: EMPTY';
    this.pu.classList.toggle('warn', !tc.powered);
    // what to do next
    let h = '';
    const ts = g.toStrike;
    if (g.travel.busy) h = '';
    else if (ts != null && ts > 0 && !tc.powered) h = `Lightning in <b>${Math.floor(ts / 60)}:${pad(Math.floor(ts % 60))}</b> — be under the cable at 88 mph at 10:04:00${ts < 40 ? '' : ` (${keyName('R')}: start again)`}`;
    else if (ts != null && ts <= 0 && !tc.powered && !g.storm.powered) h = `Missed it. <b>${keyName('R')}</b> to try again`;
    else if (!tc.on) h = `Turn the time circuits on: <b>${keyName('T')}</b>`;
    else if (!tc.destination) h = `Set a destination on the keypad: <b>${keyName('K')}</b>`;
    else if (!tc.powered) h = tc.power === 'fusion' ? `Refuel Mr. Fusion: <b>${keyName('F')}</b>` : tc.spare ? `Load plutonium (stopped): <b>${keyName('F')}</b>` : 'No power. Only a bolt of lightning delivers 1.21 gigawatts…';
    else if (mph < 88) h = `Bring her up to <b>88 mph</b>`;
    if (h !== this._h) { this.hint.innerHTML = h; this._h = h; }
  }

  say(text, cls = '', secs = 4) {
    const m = el('div', `msg ${cls}`, text);
    this.msgs.append(m);
    setTimeout(() => m.classList.add('out'), secs * 1000);
    setTimeout(() => m.remove(), secs * 1000 + 600);
    while (this.msgs.children.length > 4) this.msgs.firstChild.remove();
  }
}

// ---------------------------------------------------------------------------------------------

export class Keypad {
  constructor(ui, game) {
    this.g = game;
    const k = (this.root = el('div', 'keypad hidden'));
    k.innerHTML = `
      <div class="kp-head"><b>Time circuits</b><button class="close" aria-label="Close">×</button></div>
      <div class="kp-body">
        <div class="kp-left">
          <button class="lever">Time circuits: <b>OFF</b></button>
          <div class="kp-entry"></div>
          <div class="pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'enter'].map((c) => `<button data-k="${c}" class="${c.length > 1 ? 'fn' : ''}">${c === 'clear' ? 'CLR' : c === 'enter' ? 'SET' : c}</button>`).join('')}</div>
          <p class="fine">Month, day, year, hour (0-23), minute: <b>11 05 1955 06 00</b>. SET takes a date alone.</p>
        </div>
        <div class="kp-right"><h3>Famous dates</h3><div class="famous"></div></div>
      </div>`;
    ui.append(k);
    k.querySelector('.close').onclick = () => this.toggle(false);
    k.querySelector('.lever').onclick = () => game.toggleTimeCircuits();
    k.querySelectorAll('.pad button').forEach((b) => { b.onclick = () => { if (!game.tc.on) game.toggleTimeCircuits(); game.keypad(b.dataset.k); }; });
    const fam = k.querySelector('.famous');
    for (const f of FAMOUS) {
      const t = f.t, b = el('button', '', `<b>${f.label}</b><span>${MONTHS[t.mo - 1]} ${pad(t.d)} ${pad(t.y, 4)} ${pad(((t.h + 11) % 12) + 1)}:${pad(t.mi)} ${t.h < 12 ? 'AM' : 'PM'}</span><i>${f.note}</i>`);
      b.onclick = () => {
        if (!game.tc.on) game.toggleTimeCircuits();
        // typed in, as Doc would: the digits go through the keypad
        const s = `${pad(t.mo)}${pad(t.d)}${pad(t.y, 4)}${pad(t.h)}${pad(t.mi)}`;
        game.keypad('clear');
        for (const c of s) game.keypad(c);
      };
      fam.append(b);
    }
    this.entry = k.querySelector('.kp-entry');
    this.lever = k.querySelector('.lever b');
  }
  get open() { return !this.root.classList.contains('hidden'); }
  toggle(v = !this.open) { this.root.classList.toggle('hidden', !v); }
  update() {
    const tc = this.g.tc;
    this.lever.textContent = tc.on ? 'ON' : 'OFF';
    const b = tc.buffer.padEnd(12, '_');
    const txt = tc.on ? `${b.slice(0, 2)} ${b.slice(2, 4)} ${b.slice(4, 8)} ${b.slice(8, 10)}:${b.slice(10, 12)}` : 'circuits off';
    if (this.entry._t !== txt) { this.entry.textContent = txt; this.entry._t = txt; }
    this.entry.classList.toggle('err', tc.entryError > 0);
  }
}

// ---------------------------------------------------------------------------------------------

export class Help {
  constructor(ui) {
    this.root = el('div', 'help hidden', `
      <div class="kp-head"><b>Driving the time machine</b><button class="close">×</button></div>
      <table>
        <tr><td>W / ↑</td><td>accelerator</td></tr><tr><td>S / ↓</td><td>brake; hold at a stop for reverse</td></tr>
        <tr><td>A D / ← →</td><td>steer</td></tr><tr><td>Space</td><td>handbrake</td></tr>
        <tr><td>T</td><td>time circuits on / off (the lever by the gear stick)</td></tr>
        <tr><td>K</td><td>the keypad; digits 0-9 type, Enter sets, Backspace clears</td></tr>
        <tr><td>F</td><td>load plutonium (stopped) / feed Mr. Fusion</td></tr>
        <tr><td>C</td><td>view: driver, chase, orbit, passenger</td></tr>
        <tr><td>Mouse / drag</td><td>look round; wheel zooms outside</td></tr>
        <tr><td>L</td><td>headlamps: off, dipped, main</td></tr>
        <tr><td>G / J</td><td>open or shut the left / right door</td></tr>
        <tr><td>M</td><td>automatic or manual; Q / E change down / up</td></tr>
        <tr><td>N</td><td>sound</td></tr><tr><td>P</td><td>pause</td></tr><tr><td>+ / −</td><td>the clock faster / slower</td></tr>
        <tr><td>R</td><td>on the night of the storm: back to the end of Main Street for another run at the cable</td></tr>
      </table>
      <p class="fine">Reach 88 mph with the circuits on, a destination set and 1.21 gigawatts at the flux capacitor, and you arrive at the destination time — at the same place. Mind what stands there then.</p>`);
    ui.append(this.root);
    this.root.querySelector('.close').onclick = () => this.toggle(false);
  }
  toggle(v = this.root.classList.contains('hidden')) { this.root.classList.toggle('hidden', !v); }
}

// ---------------------------------------------------------------------------------------------

/** Touch controls: the left half steers (drag sideways), pedals bottom right, buttons on top. */
export class Touch {
  constructor(ui, game, canvas) {
    this.g = game;
    const T = game.input.touch;
    const root = (this.root = el('div', 'touch'));
    root.innerHTML = `
      <div class="steer"><div class="knob"></div></div>
      <div class="pedals"><button class="brake">BRAKE</button><button class="gas">GAS</button></div>
      <div class="tbtns">
        <button data-a="cam">VIEW</button><button data-a="tc">TIME CKT</button><button data-a="pad">KEYPAD</button>
        <button data-a="fuel">FUEL</button><button data-a="lights">LIGHTS</button><button data-a="door">DOOR</button><button data-a="retry" class="hidden">RETRY</button><button data-a="help">?</button>
      </div>`;
    ui.append(root);
    const steer = root.querySelector('.steer'), knob = root.querySelector('.knob');
    let sid = null, sx = 0;
    steer.addEventListener('pointerdown', (e) => { sid = e.pointerId; sx = e.clientX; steer.setPointerCapture(e.pointerId); T.active = true; e.preventDefault(); });
    steer.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      const w = steer.clientWidth * 0.4;
      T.steer = Math.max(-1, Math.min(1, (e.clientX - sx) / w));
      knob.style.transform = `translateX(${T.steer * 40}%)`;
    });
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; T.steer = 0; knob.style.transform = ''; };
    steer.addEventListener('pointerup', end); steer.addEventListener('pointercancel', end);
    const pedal = (b, key) => {
      b.addEventListener('pointerdown', (e) => { T[key] = 1; T.active = true; b.classList.add('on'); e.preventDefault(); });
      const up = () => { T[key] = 0; b.classList.remove('on'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    };
    pedal(root.querySelector('.gas'), 'throttle');
    pedal(root.querySelector('.brake'), 'brake');
    const act = { cam: () => game.rig.cycle(), tc: () => game.toggleTimeCircuits(), pad: () => game.ui.keypad.toggle(), fuel: () => game.refuel(), lights: () => game.toggleHeadlights(), door: () => game.toggleDoor('left'), help: () => game.ui.help.toggle(), retry: () => { if (game.storm.active(game.local)) game.retryLightning(); } };
    root.querySelectorAll('.tbtns button').forEach((b) => { b.onclick = () => act[b.dataset.a]?.(); });
    this.retry = root.querySelector('[data-a="retry"]');
    void canvas;
  }
  /** The storm night's RETRY (the R key) is shown only on that night. */
  update() {
    const show = !!this.g.local && this.g.storm.active(this.g.local);
    if (show !== this._retry) { this.retry.classList.toggle('hidden', !show); this._retry = show; }
  }
}
