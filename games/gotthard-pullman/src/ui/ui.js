/**
 * The screens around the ride: the start (the day's weather, your seat, the picture quality, when
 * to join the trip), the travel card at the top (the time, where the train is, the next stop and
 * how it is running against the timetable), the messages of the trip, your phone with the map,
 * the engine's physics for the curious (F3) and the keys (H).
 */
import { PRESETS } from '../world/weather.js';
import { TIMETABLE, fmt, hms } from '../sim.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ---- the start ------------------------------------------------------------------------------------

/** Joining the trip later: the sim runs ahead to these times while the world is built. */
export const JOIN = [
  { t: '10:12', label: 'Boarding at Erstfeld', note: 'two minutes before departure' },
  { t: '10:31', label: 'Climbing past Amsteg', note: 'the Chärstelenbach bridge' },
  { t: '10:52', label: 'The Pfaffensprung spiral', note: 'after the stop at Gurtnellen' },
  { t: '11:19', label: 'Leaving Wassen', note: 'the loops round the church' },
];

const SEATS = [
  { car: 'parlor', label: 'Parlor car', note: 'a revolving armchair by the window' },
  { car: 'observation', label: 'Observation car', note: 'a lounge chair, the open platform behind' },
  { car: 'diner', label: 'Dining car', note: 'a table for brunch' },
];

/** Shows the start screen; resolves with { weather, quality, car, chair, t } when you board. */
export function startScreen(root, defaults = {}) {
  return new Promise((resolve) => {
    const s = { weather: 'clear', quality: 'high', car: 'parlor', side: 'right', t: '10:12', ...defaults };
    const page = el('div', 'start');
    page.innerHTML = `
      <div class="start-head">
        <div class="kicker">Extrazug ${TIMETABLE.train.replace(/\D+/g, '')} &middot; Friday 11 December 2026</div>
        <h1>Gotthard Pullman</h1>
        <p class="lede">Up the Gotthard's north ramp from Erstfeld to Göschenen behind the SBB C 5/6 2978, in four heavyweight Pullman cars. You ride as a passenger; on the footplate the driver and the fireman work the engine by hand, and everything you feel and hear comes from the physics.</p>
      </div>
      <div class="start-cols">
        <section><h2>The weather</h2><div class="cards weather"></div></section>
        <section class="side">
          <h2>Your seat</h2><div class="opts seats"></div>
          <div class="opts sides"><button data-side="right">Right side</button><button data-side="left">Left side</button></div>
          <h2>Join the trip</h2><div class="opts joins"></div>
          <h2>Picture</h2><div class="opts quality"></div>
          <button class="board">Board the train</button>
          <p class="fine">Click the view to look around with the mouse. H shows the keys.</p>
        </section>
      </div>`;
    const W = page.querySelector('.weather');
    for (const [id, p] of Object.entries(PRESETS)) {
      const c = el('button', 'card', `<b>${p.label}</b><span>${p.desc}</span><i>${fmtT(p.tempErstfeld)} in Erstfeld, ${fmtT(p.tempGoeschenen)} at Göschenen</i>`);
      c.dataset.id = id;
      W.append(c);
    }
    const S = page.querySelector('.seats');
    for (const x of SEATS) { const b = el('button', null, `<b>${x.label}</b><span>${x.note}</span>`); b.dataset.car = x.car; S.append(b); }
    const J = page.querySelector('.joins');
    for (const x of JOIN) { const b = el('button', null, `<b>${x.t} &middot; ${x.label}</b><span>${x.note}</span>`); b.dataset.t = x.t; J.append(b); }
    const Q = page.querySelector('.quality');
    for (const q of ['low', 'medium', 'high', 'ultra']) { const b = el('button', null, q[0].toUpperCase() + q.slice(1)); b.dataset.q = q; Q.append(b); }
    const mark = () => {
      page.querySelectorAll('.weather .card').forEach((b) => b.classList.toggle('on', b.dataset.id === s.weather));
      page.querySelectorAll('.seats button').forEach((b) => b.classList.toggle('on', b.dataset.car === s.car));
      page.querySelectorAll('.sides button').forEach((b) => b.classList.toggle('on', b.dataset.side === s.side));
      page.querySelectorAll('.joins button').forEach((b) => b.classList.toggle('on', b.dataset.t === s.t));
      page.querySelectorAll('.quality button').forEach((b) => b.classList.toggle('on', b.dataset.q === s.quality));
    };
    page.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.id) s.weather = b.dataset.id;
      if (b.dataset.car) s.car = b.dataset.car;
      if (b.dataset.side) s.side = b.dataset.side;
      if (b.dataset.t) s.t = b.dataset.t;
      if (b.dataset.q) s.quality = b.dataset.q;
      mark();
      if (b.classList.contains('board')) {
        page.remove();
        // a window seat on the chosen side (the chairs come in pairs, right then left)
        const chair = s.car === 'parlor' ? 12 + (s.side === 'left' ? 1 : 0) : s.car === 'observation' ? 4 + (s.side === 'left' ? 1 : 0) : 1 + (s.side === 'left' ? 2 : 0);          // the diner: facing the way the train goes
        resolve({ ...s, chair });
      }
    });
    mark();
    root.append(page);
  });
}

const fmtT = (c) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)} °C`;

// ---- the travel card and the messages ---------------------------------------------------------------

export class HUD {
  constructor(root, game) {
    this.game = game;
    this.card = el('div', 'hud');
    this.msgs = el('div', 'msgs');
    root.append(this.card, this.msgs);
    this.seen = 0;
    this.visible = true;
    this._t = 0;
  }

  toggle() { this.visible = !this.visible; this.card.style.display = this.visible ? '' : 'none'; }

  update(dt) {
    const G = this.game, sim = G.sim, T = sim.train;
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 0.25;
      const s = T.front, R = sim.route;
      const next = sim.timetable.stops[Math.min(sim.timetable.stops.length - 1, sim.crew.next ?? 0)];
      const st = sim.standingAt;
      const v = Math.abs(T.speed) * 3.6;
      const g = R.run.gradeAt(s) * 1000;
      const z = R.run.pos(s).z;
      const where = placeName(sim, s);
      const late = runningLate(sim, s, v);
      const stop = v < 0.3 && st?.dep ? `At ${st.name} &middot; departs ${st.dep}` : next ? `Next: ${next.name} ${next.arr ?? next.dep}` : '';
      const lateTxt = Math.abs(late) >= 1 ? ` <em>${late > 0 ? `${late.toFixed(0)} min late` : `${(-late).toFixed(0)} min early`}</em>` : '';
      this.card.innerHTML = `<div class="clock">${fmt(sim.clock, true)}</div><div class="where">${where}</div><div class="next">${stop}${lateTxt}</div><div class="numbers">${v.toFixed(0)} km/h &middot; ${g >= 0 ? '↗' : '↘'} ${Math.abs(g).toFixed(0)} ‰ &middot; ${z.toFixed(0)} m${G.timeScale !== 1 ? ` &middot; ×${G.timeScale}` : ''}</div>`;
    }
    // new events of the trip as messages that fade
    const ev = sim.events;
    const total = sim._eventCount ?? ev.length;
    while (this.seen < ev.length && this.seen < 400) {
      const e = ev[this.seen++];
      if (!e) break;
      if (/^(Crew|Fireman|Driver):/.test(e.text) && !G.debug) continue;
      const m = el('div', 'msg', `<span>${fmt(e.clock)}</span> ${e.text}`);
      this.msgs.append(m);
      setTimeout(() => m.classList.add('out'), 9000);
      setTimeout(() => m.remove(), 11000);
    }
    if (this.seen > ev.length) this.seen = ev.length;
    void total;
  }
}

/**
 * How the train is running against the timetable (minutes, + late): between two stops, the clock
 * against the booked time for this point (the run between the booked departure and arrival
 * shared out by distance); standing at a stop, how long past the booked departure.
 */
function runningLate(sim, s, v) {
  const stops = sim.timetable.stops, R = sim.route;
  const at = (st) => R.stations.find((x) => x.name === st.name)?.s ?? 0;
  const i = Math.min(stops.length - 1, sim.crew.next ?? 0);
  const next = stops[i], prev = stops[i - 1];
  if (v < 0.3) { const st = sim.standingAt; return st?.dep ? Math.max(0, sim.clock - hms(st.dep)) / 60 : 0; }
  if (!prev?.dep || !next?.arr) return 0;
  const s0 = at(prev), s1 = at(next), t0 = hms(prev.dep), t1 = hms(next.arr);
  const k = Math.max(0, Math.min(1, (s - s0) / Math.max(1, s1 - s0)));
  return (sim.clock - (t0 + (t1 - t0) * k)) / 60;
}

/** Where the train is, in words: the tunnel or bridge it is on, else the nearest place. */
export function placeName(sim, s) {
  const R = sim.route;
  const st = R.structureAt(s);
  if (st?.name) return st.type === 'tunnel' ? `In the ${st.name}` : `On the ${st.name}`;
  if (st?.type === 'tunnel') return 'In a tunnel';
  let best = null;
  for (const x of R.stations) if (!best || Math.abs(x.s - s) < Math.abs(best.s - s)) best = x;
  if (!best) return '';
  const d = best.s - s;
  return Math.abs(d) < 400 ? best.name : d > 0 ? `Toward ${best.name}` : `Past ${best.name}`;
}

// ---- the phone --------------------------------------------------------------------------------------

/** Your phone, with the map: the line, its tunnels and stations, and the blue dot of the train. */
export class Phone {
  constructor(root, game) {
    this.game = game;
    this.box = el('div', 'phone');
    this.box.innerHTML = `<div class="phone-bar"><span class="pt"></span><span>Maps</span><span>▮▮▮ 5G</span></div><canvas></canvas><div class="phone-info"></div>`;
    this.canvas = this.box.querySelector('canvas');
    this.info = this.box.querySelector('.phone-info');
    this.time = this.box.querySelector('.pt');
    root.append(this.box);
    this.open = false;
    this.zoom = 1;          // pixels per 10 m
    this.box.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0.15, Math.min(6, this.zoom * Math.exp(-e.deltaY * 0.0015))); }, { passive: false });
    this._t = 0;
  }

  toggle() { this.open = !this.open; this.box.classList.toggle('open', this.open); }

  update(dt) {
    if (!this.open) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.1;
    const G = this.game, sim = G.sim, R = sim.route, run = R.run, T = sim.train;
    const cv = this.canvas, W = (cv.width = cv.clientWidth * devicePixelRatio), H = (cv.height = cv.clientHeight * devicePixelRatio);
    const c = cv.getContext('2d');
    const me = run.pos(T.front), head = run.headingAt(T.front);
    const k = (this.zoom / 10) * devicePixelRatio;     // px per metre
    const X = (x) => W / 2 + (x - me.x) * k, Y = (y) => H * 0.55 - (y - me.y) * k;
    c.fillStyle = '#e9e6dc'; c.fillRect(0, 0, W, H);
    // the valley floor and the river would be nice; the line is what matters
    const step = Math.max(1, Math.round(4 / (k * 10)));
    const P = run.pts ?? null;
    const drawRange = (s0, s1, style, width, dash = []) => {
      c.strokeStyle = style; c.lineWidth = width * devicePixelRatio; c.setLineDash(dash.map((d) => d * devicePixelRatio));
      c.beginPath();
      let first = true;
      for (let s = Math.max(0, s0); s <= Math.min(run.length, s1); s += 10 * step) {
        const p = run.pos(s);
        if (first) { c.moveTo(X(p.x), Y(p.y)); first = false; } else c.lineTo(X(p.x), Y(p.y));
      }
      c.stroke(); c.setLineDash([]);
    };
    void P;
    const span = Math.max(W, H) / k;
    const s0 = T.front - span * 2.5, s1 = T.front + span * 2.5;
    drawRange(s0, s1, '#9a958a', 5);
    drawRange(s0, s1, '#5b5850', 2.2);
    for (const t of R.tunnels) if (t.s1 > s0 && t.s0 < s1) drawRange(t.s0, t.s1, '#e9e6dc', 2.6, [4, 3]);
    for (const b of R.bridges) if (b.s1 - b.s0 > 25 && b.s1 > s0 && b.s0 < s1) drawRange(b.s0, b.s1, '#3d6e8f', 3);
    // stations
    c.font = `${11 * devicePixelRatio}px Inter, sans-serif`;
    for (const st of R.stations) {
      const p = run.pos(st.s);
      const x = X(p.x), y = Y(p.y);
      if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
      c.fillStyle = '#fff'; c.strokeStyle = '#333'; c.lineWidth = 1.5 * devicePixelRatio;
      c.beginPath(); c.arc(x, y, 4.5 * devicePixelRatio, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#222'; c.fillText(st.name, x + 8 * devicePixelRatio, y - 6 * devicePixelRatio);
    }
    // the train: the blue dot and its heading
    const x = X(me.x), y = Y(me.y);
    c.fillStyle = 'rgba(40,120,255,0.18)'; c.beginPath(); c.arc(x, y, 16 * devicePixelRatio, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1f6fff'; c.strokeStyle = '#fff'; c.lineWidth = 2.5 * devicePixelRatio;
    c.beginPath(); c.arc(x, y, 6.5 * devicePixelRatio, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#1f6fff';
    c.beginPath();
    const hx = Math.sin(head), hy = -Math.cos(head);
    c.moveTo(x + hx * 16 * devicePixelRatio, y + hy * 16 * devicePixelRatio);
    c.lineTo(x + (hx * 9 - hy * 5) * devicePixelRatio, y + (hy * 9 + hx * 5) * devicePixelRatio);
    c.lineTo(x + (hx * 9 + hy * 5) * devicePixelRatio, y + (hy * 9 - hx * 5) * devicePixelRatio);
    c.fill();
    // scale bar
    const m = niceLen(80 / (k / devicePixelRatio));
    c.fillStyle = '#333'; c.fillRect(12 * devicePixelRatio, H - 16 * devicePixelRatio, m * k, 3 * devicePixelRatio);
    c.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, 12 * devicePixelRatio, H - 22 * devicePixelRatio);
    // the line under the map
    const next = sim.timetable.stops[Math.min(sim.timetable.stops.length - 1, sim.crew.next ?? 0)];
    const nextSt = R.stations.find((q) => q.name === next?.name);
    const dist = nextSt ? Math.max(0, nextSt.s - T.front) : 0;
    this.time.textContent = fmt(sim.clock);
    this.info.innerHTML = `<b>${placeName(sim, T.front)}</b><span>${me.z.toFixed(0)} m above sea level &middot; km ${R.kmAt(T.front).toFixed(1)}</span><span>${next ? `${next.name} in ${(dist / 1000).toFixed(1)} km, due ${next.arr ?? next.dep}` : ''}</span>`;
  }
}

const niceLen = (m) => { const e = Math.pow(10, Math.floor(Math.log10(m))); const f = m / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; };

// ---- the physics for the curious (F3) ---------------------------------------------------------------

export class DebugPanel {
  constructor(root, game) {
    this.game = game;
    this.box = el('pre', 'debug');
    this.box.style.display = 'none';
    root.append(this.box);
    this.open = false;
    this._t = 0;
  }

  toggle() { this.open = !this.open; this.box.style.display = this.open ? '' : 'none'; this.game.debug = this.open; }

  update(dt) {
    if (!this.open) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.2;
    const G = this.game, sim = G.sim, T = sim.train, L = T.loco, o = L.out, c = L.c, B = T.brake, R = sim.route;
    const e = T.veh[0], s = T.front;
    const here = sim.weather.at(e.s, T.time);
    const k = R.run.curvatureAt(s);
    const r = G.stage.r;
    const car = G.player.car?.();
    const felt = car?.ride?.felt ?? {};
    const f = (x, d = 2) => (x == null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));
    this.box.textContent = [
      `TRAIN   ${fmt(sim.clock, true)}  phase ${sim.crew.phase}  next stop ${sim.timetable.stops[sim.crew.next]?.name ?? '-'}`,
      `        v ${f(T.speed * 3.6, 1)} km/h  a ${f(e.a, 3)} m/s²  s ${f(s, 0)} m  km ${f(R.kmAt(s), 3)}  mass ${f(T.mass / 1000, 1)} t`,
      `TRACK   grade ${f(R.run.gradeAt(s) * 1000, 1)} ‰  R ${k ? f(1 / Math.abs(k), 0) : '∞'} m  cant ${f((R.run.cantAt(s) ?? 0) * 1000, 0)} mm  ${R.structureAt(s)?.name ?? R.structureAt(s)?.type ?? ''}`,
      `AIR     ${f(here.tempC, 1)} °C  ρ ${f(here.rho, 3)} kg/m³  wind ${f(here.wind, 1)} m/s  rail ${here.rail}  μ ${f(o.mu, 3)}  sand ${f(T.sand, 2)}`,
      `BOILER  p ${f(L.p - 1.013, 2)} bar(g)  water ${f(o.levelTrue ?? o.level, 1)} mm  crown ${f(o.crownCover * 1000, 0)} mm  fire ${f(L.fire.burning, 0)}+${f(L.fire.green, 0)} kg  ${f(L.fire.temp, 0)} °C`,
      `        steam ${f(o.steamRate * 3600, 0)} kg/h  coal ${f(o.coalRate * 3600, 0)} kg/h  draught ${f(o.draft, 0)} Pa  smoke ${f(o.smoke, 2)}  safety ${f(o.svFlow, 2)} kg/s`,
      `ENGINE  regulator ${f(c.regulator, 2)}  cut-off ${f(c.reverser, 2)}  chest ${f(L.pChest - 1.013, 2)}  receiver ${f(L.pRec - 1.013, 2)} bar(g)  start valve ${c.startingValve ? 'open' : 'shut'}`,
      `        torque ${f(o.torque / 1000, 1)} kNm  Fadh ${f(o.Fadh / 1000, 1)} kN  slip ${f(o.slip, 3)} m/s  creep ${f(o.creep, 4)}  power ${f(o.power / 1000, 0)} kW`,
      `BRAKE   handle ${B.handle}  equalising ${f(B.equalising, 2)}  BP ${B.v.map((x) => f(x.pBP, 1)).join(' ')}  BC ${B.v.map((x) => f(Math.max(x.pBC, x.pBCdirect ?? 0), 1)).join(' ')}  MR ${f(L.pMR, 2)}`,
      `RIDE    lateral ${f(felt.lat, 3)}  vertical ${f(felt.vert, 3)}  longitudinal ${f(felt.lon, 3)} m/s²`,
      `CREW    driver ${handTxt(sim.crew.driver)}  fireman ${handTxt(sim.crew.fireman)}`,
      `RENDER  ${r.stats ? Object.entries(r.stats).map(([a, b]) => `${a} ${typeof b === 'number' ? f(b, 1) : b}`).join('  ') : ''}`,
    ].join('\n');
  }
}

const handTxt = (p) => (p ? Object.entries(p.hands).map(([side, h]) => `${side}:${h.queue[0]?.control ?? (h.on ?? '·')}`).join(' ') : '-');

// ---- the keys ------------------------------------------------------------------------------------

export class Help {
  constructor(root) {
    this.box = el('div', 'help');
    this.box.innerHTML = `<h3>Keys</h3><dl>
      <dt>Mouse</dt><dd>look around (click the view first; Esc lets the mouse go)</dd>
      <dt>E</dt><dd>get up and walk the train (W A S D, Shift a bit quicker); E by your seat to sit down</dd>
      <dt>V</dt><dd>step outside: orbit the train (drag, wheel to zoom)</dd>
      <dt>[ &nbsp;]</dt><dd>outside: the vehicle to look at</dd>
      <dt>M</dt><dd>your phone, with the map (wheel to zoom it)</dd>
      <dt>+ &nbsp;−</dt><dd>time faster or slower (the physics keeps up)</dd>
      <dt>P</dt><dd>pause</dd>
      <dt>N</dt><dd>sound on or off</dd>
      <dt>T</dt><dd>the travel card</dd>
      <dt>F3</dt><dd>the physics of the engine and the train</dd>
      <dt>H</dt><dd>this list</dd></dl>`;
    this.box.style.display = 'none';
    root.append(this.box);
  }
  toggle() { this.box.style.display = this.box.style.display === 'none' ? '' : 'none'; }
}
