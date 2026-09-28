// DOM user interface: start screen, HUD, captions, panels, phone map, safety card.
import { ROWS, LETTERS, BUSINESS_ROWS, EXIT_ROWS } from './cabin.js';
import { DEPARTURES } from './places.js';
import { PRESET_LIST, presetWeather, Weather, CAT_LEVELS, STORM_LEVELS, STORM_WHERE } from './weather.js';
import { ATC } from './atc.js';
import { GEO } from '../data/geodata.js';
import { fmtClock, project, unproject, clamp } from './core.js';
import { MENU } from './director.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.opts = { depIndex: 0, weather: 'fair', wx: null, seat: '22A', load: 0.85, lang: 'sv+en', quality: 'high', speed: 1, voice: true, sensitivity: 1, fov: 68, events: 'realistic' };
    try { const saved = JSON.parse(localStorage.getItem('sk1415-opts-v3') || 'null'); if (saved) Object.assign(this.opts, saved); } catch (e) { /* storage unavailable */ }
    if (!PRESET_LIST.some((p) => p.id === this.opts.weather)) this.opts.weather = 'fair';
    this.radioLog = [];
    this.handlers = {};
    this._buildStart();
    this.toastsEl = $('toasts'); this.capEl = $('captions');
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, ...a) { if (this.handlers[ev]) this.handlers[ev](...a); }

  _seg(el, items, cur, onPick) {
    el.innerHTML = '';
    items.forEach((it) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = it.label; b.setAttribute('aria-pressed', String(it.value === cur));
      b.onclick = () => { for (const c of el.children) c.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); onPick(it.value); };
      el.appendChild(b);
    });
  }

  _buildStart() {
    const o = this.opts;
    this._seg($('opt-time'), DEPARTURES.map((d, i) => ({ label: d.label, value: i })), o.depIndex, (v) => { o.depIndex = v; this._refreshFacts(); });
    this._seg($('opt-weather'), PRESET_LIST.map((w) => ({ label: w.label, value: w.id })), o.wx ? null : o.weather, (v) => { o.weather = v; o.wx = null; this._refreshWx(); });
    $('wx-edit').onclick = () => this.openWeather(o.wx || presetWeather(o.weather), { live: false, onApply: (st) => { o.wx = st; for (const c of $('opt-weather').children) c.setAttribute('aria-pressed', 'false'); this._refreshWx(); } });
    this._refreshWx();
    // seat map: columns = rows, 7 cells (F E D aisle C B A from top)
    const sm = $('seatmap'); sm.innerHTML = '';
    const order = ['F', 'E', 'D', null, 'C', 'B', 'A'];
    for (const r of ROWS) {
      for (const L of order) {
        if (!L) { const a = document.createElement('div'); a.className = 'aisle'; a.textContent = r; sm.appendChild(a); continue; }
        const b = document.createElement('button'); b.type = 'button'; b.className = 'seat';
        const id = `${r}${L}`; b.textContent = L; b.title = `Seat ${id}${r <= BUSINESS_ROWS ? ' · SAS Business' : ''}${EXIT_ROWS.includes(r) ? ' · exit row' : ''}${L === 'A' || L === 'F' ? ' · window' : L === 'C' || L === 'D' ? ' · aisle' : ' · middle'}`;
        const blocked = r <= BUSINESS_ROWS && (L === 'B' || L === 'E');
        if (r <= BUSINESS_ROWS) b.classList.add('biz'); if (EXIT_ROWS.includes(r)) b.classList.add('exit'); if (blocked) { b.classList.add('blocked'); b.disabled = true; b.title = 'Blocked middle seat (SAS Business)'; }
        b.setAttribute('aria-pressed', String(id === o.seat)); b.dataset.id = id;
        b.onclick = () => { for (const c of sm.querySelectorAll('.seat')) c.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); o.seat = id; this._refreshFacts(); };
        sm.appendChild(b);
      }
    }
    $('opt-load').value = String(o.load); $('opt-lang').value = o.lang; $('opt-quality').value = o.quality; $('opt-speed').value = String(o.speed); $('opt-voice').checked = o.voice;
    $('opt-load').onchange = (e) => { o.load = +e.target.value; };
    $('opt-lang').onchange = (e) => { o.lang = e.target.value; };
    $('opt-quality').onchange = (e) => { o.quality = e.target.value; };
    $('opt-speed').onchange = (e) => { o.speed = +e.target.value; };
    $('opt-voice').onchange = (e) => { o.voice = e.target.checked; };
    if ($('opt-events')) { $('opt-events').value = o.events || 'realistic'; $('opt-events').onchange = (e) => { o.events = e.target.value; }; }
    $('go').onclick = () => { try { localStorage.setItem('sk1415-opts-v3', JSON.stringify(o)); } catch (e) { /* ignore */ } this.emit('start', { ...o }); };
    this._refreshFacts();
    // keys list for the pause screen
    const keys = [['Mouse', 'Look around (click the view first)'], ['Click / E', 'Use what you look at'], ['B', 'Fasten / unfasten seatbelt'], ['F', 'Tray table'], ['R', 'Recline seat'], ['T', 'Talk to your neighbour'], ['1–5', 'Pick a reply'], ['Space', 'Stand up / sit down'], ['W A S D', 'Walk (standing) / lean (seated)'], ['M', 'Phone: flight map'], ['V', 'Outside camera (drag to orbit, scroll to zoom)'], ['C', 'Flight deck and radio (what the pilots and ATC say)'], ['P', 'Take a photo'], ['Y', 'Swallow (clear your ears)'], ['+ / −', 'Change time speed'], ['U', 'Fullscreen'], ['Esc', 'Pause']];
    $('keys').innerHTML = keys.map(([k, v]) => `<div><kbd>${k}</kbd> ${v}</div>`).join('');
  }
  // the runways ATC will use and a one-line summary for the chosen weather
  _refreshWx() {
    const st = this.opts.wx || presetWeather(this.opts.weather);
    try {
      const wx = new Weather(st), atc = new ATC(wx);
      $('f-rwy-out').textContent = atc.depRwy; $('f-rwy-in').textContent = atc.arrRwy;
      const a = st.arn, c = st.cph, w = (x) => (x.wspd < 1 ? 'calm' : `${String(Math.round(x.wdir / 10) * 10 || 360).padStart(3, '0')}/${Math.round(x.wspd)}${x.gust > x.wspd + 5 ? 'G' + Math.round(x.gust) : ''} kt`);
      $('wx-sum').textContent = `${this.opts.wx ? 'Custom · ' : ''}ARN ${w(a)} · CPH ${w(c)}${st.storms ? ' · thunderstorms' : ''}`;
    } catch (e) { /* keep the defaults */ }
  }

  // ---------- weather editor ----------
  openWeather(state, { live = false, onApply } = {}) {
    const st = JSON.parse(JSON.stringify(state));
    for (let i = st.clouds.length; i < 3; i++) st.clouds.push({ cover: 'SKC', base: 3000 + i * 3000, top: 5000 + i * 3000, type: 'CU' });
    st.cirrus = [0, 0.2, 0.45, 0.7].reduce((b, v) => (Math.abs(v - (st.cirrus ?? 0.2)) < Math.abs(b - (st.cirrus ?? 0.2)) ? v : b), 0);
    $('wxedit').hidden = false;
    $('wx-note').dataset.live = live ? '1' : '';
    this._seg($('wx-presets'), PRESET_LIST.map((w) => ({ label: w.label, value: w.id })), null, (v) => { const p = presetWeather(v); Object.keys(st).forEach((k) => delete st[k]); Object.assign(st, p); for (let i = st.clouds.length; i < 3; i++) st.clouds.push({ cover: 'SKC', base: 3000 + i * 3000, top: 5000 + i * 3000, type: 'CU' }); build(); });
    const VIS = [100, 150, 200, 300, 400, 550, 800, 1000, 1500, 2000, 3000, 5000, 7000, 10000, 20000, 45000, 70000];
    const visLabel = (v) => (v >= 10000 ? `${v / 1000} km` : `${v} m`);
    const num = (obj, k, min, max, step = 1) => `<input type="number" data-o="${obj}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${Math.round(this._get(st, obj)[k] * 10) / 10}">`;
    const sel = (obj, k, opts) => `<select data-o="${obj}" data-k="${k}">${opts.map(([v, l]) => `<option value="${v}"${String(this._get(st, obj)[k]) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const visSel = (obj) => { const cur = this._get(st, obj).vis; const near = VIS.reduce((b, v) => (Math.abs(Math.log(v / cur)) < Math.abs(Math.log(b / cur)) ? v : b), VIS[0]); this._get(st, obj).vis = near; return sel(obj, 'vis', VIS.map((v) => [v, visLabel(v)])); };
    const PREC = [[0, 'none'], [1, 'light rain'], [2, 'moderate rain'], [3, 'heavy rain']];
    const row = (label, f) => `<label>${label}</label>${f('arn')}${f('cph')}`;
    const build = () => {
      $('wx-body').innerHTML = `
        <div class="wxgrid">
          <span></span><span class="h">Arlanda (ESSA)</span><span class="h">Kastrup (EKCH)</span>
          ${row('Wind from (°)', (o) => num(o, 'wdir', 0, 360, 10))}
          ${row('Wind speed (kt)', (o) => num(o, 'wspd', 0, 70, 1))}
          ${row('Gusts to (kt)', (o) => num(o, 'gust', 0, 90, 1))}
          ${row('Visibility', (o) => visSel(o))}
          ${row('Temperature (°C)', (o) => num(o, 'temp', -30, 40, 1))}
          ${row('Dew point (°C)', (o) => num(o, 'dew', -35, 35, 1))}
          ${row('QNH (hPa)', (o) => num(o, 'qnh', 940, 1060, 1))}
          ${row('Precipitation', (o) => sel(o, 'precip', PREC))}
        </div>
        <div class="wxsec">Cloud layers (feet above the ground)</div>
        <div class="wxclouds">${st.clouds.map((c, i) => `
          <label>Layer ${i + 1}${sel(`clouds.${i}`, 'cover', [['SKC', 'none'], ['FEW', 'few'], ['SCT', 'scattered'], ['BKN', 'broken'], ['OVC', 'overcast']])}</label>
          <label>Type${sel(`clouds.${i}`, 'type', [['CU', 'cumulus'], ['ST', 'stratus']])}</label>
          <label>Base${num(`clouds.${i}`, 'base', 100, 30000, 100)}</label>
          <label>Top${num(`clouds.${i}`, 'top', 200, 40000, 100)}</label>`).join('')}
        </div>
        <div class="wxsec">Upper air and thunderstorms</div>
        <div class="wxup">
          <label>Jet stream from (°)${num('', 'jetDir', 0, 360, 10)}</label>
          <label>Jet stream (kt)${num('', 'jetKt', 0, 220, 5)}</label>
          <label>Clear-air turbulence${sel('', 'cat', CAT_LEVELS.map((l, i) => [i, l]))}</label>
          <label>Cirrus${sel('', 'cirrus', [[0, 'none'], [0.2, 'a little'], [0.45, 'some'], [0.7, 'a lot']])}</label>
          <label>Thunderstorms${sel('', 'storms', STORM_LEVELS.map((l, i) => [i, l === 'line' ? 'squall line' : l]))}</label>
          <label>Where${sel('', 'stormWhere', STORM_WHERE.map((w) => [w, { anywhere: 'anywhere', route: 'along the route', ARN: 'around Arlanda', CPH: 'around Kastrup' }[w]]))}</label>
          <label>Storm tops (ft)${num('', 'stormTopFt', 20000, 50000, 1000)}</label>
        </div>`;
      for (const el of $('wx-body').querySelectorAll('[data-k]')) el.oninput = el.onchange = () => { const o = this._get(st, el.dataset.o); const v = el.value; o[el.dataset.k] = el.tagName === 'SELECT' && isNaN(+v) ? v : +v; preview(); };
      preview();
    };
    const clean = () => {
      const out = JSON.parse(JSON.stringify(st));
      for (const k of ['arn', 'cph']) { const a = out[k]; a.dew = Math.min(a.dew, a.temp); a.gust = a.gust > a.wspd ? a.gust : 0; a.wdir = ((a.wdir % 360) + 360) % 360; }
      out.clouds = out.clouds.filter((c) => c.cover !== 'SKC').map((c) => ({ ...c, top: Math.max(c.top, c.base + 300) }));
      out.label = 'Custom';
      return out;
    };
    const preview = () => {
      try {
        const out = clean(); const wx = new Weather(out), atc = new ATC(wx);
        const utc = 4.3;
        $('wx-metar').textContent = `${wx.metar('ARN', utc, atc.depRwy)}
${wx.metar('CPH', utc, atc.arrRwy)}
Runways in use: Arlanda ${atc.depRwy} for take-off, Kastrup ${atc.arrRwy} for landing${live ? ' (once you are airborne, the take-off runway stays; the landing runway can still change until about 90 km out)' : ''}.`;
      } catch (e) { $('wx-metar').textContent = ''; }
    };
    build();
    $('wx-apply').onclick = () => { $('wxedit').hidden = true; onApply?.(clean()); };
    $('wx-cancel').onclick = () => { $('wxedit').hidden = true; };
  }
  weatherOpen() { return !$('wxedit').hidden; }
  _get(st, path) { if (!path) return st; return path.split('.').reduce((o, k) => o[k], st); }

  // ---------- flight deck and radio ----------
  radio(m) {
    this.radioLog.push(m); if (this.radioLog.length > 80) this.radioLog.shift();
    if (!$('radio').hidden) this._appendRadio(m);
  }
  _appendRadio(m) {
    const el = $('radio-log'); const d = document.createElement('div');
    const cls = m.kind === 'atc' ? (m.who === 'SK1415' ? 'us' : 'atc') : m.kind;
    d.className = `rl ${cls}`; d.innerHTML = `<span class="who">${escapeHtml(m.who)}</span>${escapeHtml(m.text)}`;
    el.appendChild(d); while (el.children.length > 80) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
  }
  toggleRadio(v) {
    const p = $('radio'); p.hidden = v === undefined ? !p.hidden : !v;
    if (!p.hidden) { $('radio-log').innerHTML = ''; for (const m of this.radioLog) this._appendRadio(m); }
    return !p.hidden;
  }
  radioOpen() { return !$('radio').hidden; }
  flightDeck(s) {
    if ($('radio').hidden) return;
    $('radio-unit').textContent = s.unit;
    $('fma').innerHTML = [s.fma.thr, s.fma.vert, s.fma.lat].map((x) => `<span>${escapeHtml(x || ' ')}</span>`).join('') + `<span class="ap">${escapeHtml(s.fma.ap || 'AP OFF')}</span>`;
    const c = (l, v) => `<div>${l}<b>${v}</b></div>`;
    $('pfd').innerHTML = c('IAS', `${Math.round(s.ias)} kt`) + c(s.std ? 'ALT (STD)' : 'ALT (QNH)', `${Math.round(s.alt / 10) * 10} ft`) + c('V/S', `${Math.round(s.vs / 50) * 50}`) + c('HDG', `${String(Math.round(s.hdg)).padStart(3, '0')}°`)
      + c('N1', `${Math.round(s.n1[0])} / ${Math.round(s.n1[1])} %`) + c('Flaps', s.flaps) + c('Gear', s.gear) + c('Wind', s.wind);
  }

  _refreshFacts() { const d = DEPARTURES[this.opts.depIndex]; $('f-flight').textContent = d.flight; $('f-dep').textContent = fmtClock(d.time); $('f-seat').textContent = this.opts.seat; }

  showStart(v) { $('start').hidden = !v; }
  loading(p, msg) { $('loading').hidden = p >= 1; $('loadbar').style.width = `${Math.round(p * 100)}%`; if (msg) $('loadmsg').textContent = msg; }
  showHUD(v) { $('hud').hidden = !v; }

  hud(s) {
    $('h-flight').textContent = s.flight; $('h-clock').textContent = fmtClock(s.clock); $('h-phase').textContent = s.phase;
    $('sign-belt').classList.toggle('on', s.belt); $('h-speed').textContent = `${s.speed}×`;
  }
  prompt(text) { const p = $('prompt'); if (!text) { p.hidden = true; return; } p.hidden = false; p.innerHTML = text; }
  caption(c) {
    if (!c || !c.text || c.text === '…') { this.capEl.innerHTML = ''; return; }
    const lang = c.lang === 'sv' ? 'Svenska' : 'English';
    this.capEl.innerHTML = `<div class="cap"><span class="who">${escapeHtml(c.who)}<span class="tag">${c.pa ? 'PA · ' : ''}${lang}</span></span>${escapeHtml(c.text)}</div>`;
  }
  toast(msg, secs = 3.5) {
    if (this.mute) return;
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; this.toastsEl.appendChild(d);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstChild.remove();
    setTimeout(() => d.remove(), secs * 1000);
  }

  // generic choice panel
  _choices(el, items, onPick) {
    el.innerHTML = '';
    items.forEach((it, i) => {
      const b = document.createElement('button'); b.type = 'button';
      b.innerHTML = `<span class="k">${i + 1}</span><span>${escapeHtml(it.text)}</span>${it.price != null ? `<span class="p">${it.price ? it.price + ' kr' : 'free'}</span>` : ''}`;
      b.onclick = () => onPick(it); el.appendChild(b);
    });
    this.activeChoices = { items, onPick };
  }
  pickNumber(n) { const a = this.activeChoices; if (a && a.items[n - 1]) { a.onPick(a.items[n - 1]); return true; } return false; }

  openChat(name, items, onPick) { $('chat').hidden = false; $('chat-title').textContent = `Talking to ${name}`; this._choices($('chat-choices'), items, onPick); }
  closeChat() { $('chat').hidden = true; if (this.activeChoices && !$('service').hidden) return; this.activeChoices = null; }
  chatOpen() { return !$('chat').hidden; }

  serviceMenu(show, business) {
    $('service').hidden = !show;
    if (!show) { this.activeChoices = null; return; }
    this.toast('The cabin crew is at your row — pick with 1–5 or click', 4);
    const base = [{ id: 'coffee', text: 'Coffee, please', price: 0 }, { id: 'tea', text: 'Tea, please', price: 0 }, { id: 'water', text: 'Just water, thanks', price: 0 }, { id: 'menu', text: 'Can I see the menu?' }, { id: 'none', text: 'Nothing for me, thanks' }];
    $('svc-title').textContent = business ? 'SAS Business service' : 'The trolley is at your row';
    this._choices($('svc-choices'), base, (it) => {
      if (it.id === 'menu') { this.menuList(); return; }
      this.emit('order', it.id); $('service').hidden = true; this.activeChoices = null;
    });
  }
  menuList() {
    $('svc-title').textContent = 'Onboard menu · card only';
    this._choices($('svc-choices'), [...MENU.slice(0, 7).map((m) => ({ id: m.id, text: m.name, price: m.price, item: m })), { id: 'back', text: 'Actually, just a coffee' }], (it) => {
      if (it.id === 'back') { this.emit('order', 'coffee'); $('service').hidden = true; this.activeChoices = null; return; }
      this.emit('order', 'buy', it.item); $('service').hidden = true; this.activeChoices = null;
    });
  }
  payPrompt(item, done) {
    $('pay').hidden = false; $('pay-item').innerHTML = `<div class="mono">${escapeHtml(item.name)} — ${item.price} SEK</div>`; $('pay-screen').textContent = `${item.price} SEK\nTap card`;
    const finish = () => { $('pay-screen').textContent = 'Approved ✓'; setTimeout(() => { $('pay').hidden = true; }, 900); this.activeChoices = null; done(); };
    $('pay-tap').onclick = finish; this.activeChoices = { items: [{}], onPick: finish };
  }
  callMenu(show) {
    $('callmenu').hidden = !show;
    if (!show) return;
    this._choices($('call-choices'), [{ id: 'water', text: 'Could I have a glass of water?' }, { id: 'when', text: 'When do we land?' }, { id: 'connect', text: 'I have a connection in Copenhagen — how does that work?' }, { id: 'blanket', text: 'Do you have a blanket?' }, { id: 'sorry', text: 'Sorry, I pressed it by mistake.' }], (it) => { this.emit('call', it.id); $('callmenu').hidden = true; this.activeChoices = null; });
  }
  addTrayItem() { /* items are shown in 3D */ }

  // ---------- phone / map ----------
  togglePhone(v) { const p = $('phone'); p.hidden = v === undefined ? !p.hidden : !v; if (!p.hidden) this._mapBase = null; return !p.hidden; }
  phoneOpen() { return !$('phone').hidden; }
  updatePhone(s) {
    if ($('phone').hidden) return;
    $('ph-clock').textContent = fmtClock(s.clock);
    $('ph-net').textContent = s.onGround ? '4G · Telia' : '✈ Flight mode · SAS Wi-Fi';
    $('fi-alt').textContent = `${Math.round(s.altFt / 10) * 10} ft`; $('fi-gs').textContent = `${Math.round(s.gs)} kt`;
    $('fi-eta').textContent = fmtClock(s.eta); $('fi-hdg').textContent = `${String(Math.round(s.hdg)).padStart(3, '0')}°`;
    $('fi-oat').textContent = `${Math.round(s.oat)} °C`; $('fi-dist').textContent = `${Math.round(s.distKm)} km`;
    this._drawMap(s);
  }
  _drawMap(s) {
    const c = $('map'), g = c.getContext('2d'), W = c.width, H = c.height;
    const view = { lat0: 55.25, lat1: 60.05, lon0: 11.6, lon1: 19.0 };
    const P = (lat, lon) => { const p = project(lat, lon); const a = project(view.lat1, view.lon0), b = project(view.lat0, view.lon1); return [(p.x - a.x) / (b.x - a.x) * W, (p.z - a.z) / (b.z - a.z) * H]; };
    if (!this._mapBase) {
      const base = document.createElement('canvas'); base.width = W; base.height = H; const bg = base.getContext('2d');
      bg.fillStyle = '#0c1a33'; bg.fillRect(0, 0, W, H);
      const fillPolys = (polys, col) => { bg.fillStyle = col; bg.beginPath(); for (const poly of polys) for (const ring of poly) { let x = 0, y = 0; for (let i = 0; i < ring.length; i += 2) { x += ring[i]; y += ring[i + 1]; const [px, py] = P(y / 1e4, x / 1e4); if (i === 0) bg.moveTo(px, py); else bg.lineTo(px, py); } bg.closePath(); } bg.fill('evenodd'); };
      fillPolys(GEO.land, '#22324a'); fillPolys(GEO.lakes, '#0c1a33');
      bg.strokeStyle = 'rgba(160,180,220,0.18)'; bg.lineWidth = 1;
      for (const rd of GEO.roads) { if (rd[0] !== 1) continue; let x = 0, y = 0; bg.beginPath(); for (let i = 1; i < rd.length; i += 2) { x += rd[i]; y += rd[i + 1]; const [px, py] = P(y / 1e4, x / 1e4); if (i === 1) bg.moveTo(px, py); else bg.lineTo(px, py); } bg.stroke(); }
      bg.font = '500 17px "IBM Plex Mono", monospace'; bg.fillStyle = '#9aa8bd';
      for (const [n, la, lo] of [['Stockholm', 59.33, 18.07], ['Norrköping', 58.59, 16.19], ['Linköping', 58.41, 15.62], ['Jönköping', 57.78, 14.16], ['Växjö', 56.88, 14.81], ['Kalmar', 56.66, 16.36], ['Malmö', 55.6, 13.0], ['Göteborg', 57.7, 11.97]]) { const [x, y] = P(la, lo); bg.fillRect(x - 2, y - 2, 4, 4); bg.fillText(n, x + 6, y + 5); }
      bg.fillStyle = '#eef2f8'; bg.font = '600 20px "IBM Plex Mono", monospace';
      for (const [n, la, lo] of [['ARN', 59.652, 17.919], ['CPH', 55.618, 12.656]]) { const [x, y] = P(la, lo); bg.beginPath(); bg.arc(x, y, 5, 0, 7); bg.fill(); bg.fillText(n, x + 8, y - 6); }
      this._mapBase = base;
    }
    g.drawImage(this._mapBase, 0, 0);
    // route
    const pts = s.routePts; g.lineWidth = 3;
    g.setLineDash([7, 7]); g.strokeStyle = 'rgba(143,184,255,0.55)'; g.beginPath();
    pts.forEach(([x, z], i) => { const ll = unproject(x, z); const [px, py] = P(ll.lat, ll.lon); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }); g.stroke();
    g.setLineDash([]); g.strokeStyle = '#8fb8ff'; g.beginPath();
    pts.slice(0, s.flownIdx + 1).forEach(([x, z], i) => { const ll = unproject(x, z); const [px, py] = P(ll.lat, ll.lon); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }); g.stroke();
    // aircraft
    const ll = unproject(s.x, s.z); const [ax, ay] = P(ll.lat, ll.lon);
    g.save(); g.translate(ax, ay); g.rotate(s.hdg * Math.PI / 180);
    g.fillStyle = '#ffcf70'; g.beginPath(); g.moveTo(0, -14); g.lineTo(3, -4); g.lineTo(13, 3); g.lineTo(13, 6); g.lineTo(3, 3); g.lineTo(2, 10); g.lineTo(6, 13); g.lineTo(6, 15); g.lineTo(0, 13); g.lineTo(-6, 15); g.lineTo(-6, 13); g.lineTo(-2, 10); g.lineTo(-3, 3); g.lineTo(-13, 6); g.lineTo(-13, 3); g.lineTo(-3, -4); g.closePath(); g.fill();
    g.restore();
  }

  // ---------- menu card (seat pocket) ----------
  toggleMenuCard(v) {
    const el = $('menucard'); const show = v === undefined ? el.hidden : v; el.hidden = !show;
    if (show && !el.innerHTML) el.innerHTML = menuCardHTML();
    return show;
  }

  // ---------- safety card ----------
  toggleCard(v) {
    const el = $('card'); const show = v === undefined ? el.hidden : v; el.hidden = !show;
    if (show && !el.innerHTML) el.innerHTML = safetyCardHTML();
    return show;
  }

  showPause(v) { $('pause').hidden = !v; }
  pauseOpen() { return !$('pause').hidden; }
  setupPause(speeds, cur, onSpeed, skips, onSkip) {
    this._seg($('pause-speed'), speeds.map((s) => ({ label: `${s}×`, value: s })), cur, onSpeed);
    const sk = $('skip'); sk.innerHTML = '';
    for (const s of skips) { const b = document.createElement('button'); b.className = 'btn small'; b.type = 'button'; b.textContent = s.label; b.onclick = () => onSkip(s.id); sk.appendChild(b); }
  }
  showEnd(stats) {
    $('endscreen').hidden = false;
    if (stats.label) $('end-label').textContent = stats.label;
    if (stats.title) $('end-title').textContent = stats.title;
    $('end-text').textContent = stats.text;
    $('end-stats').innerHTML = stats.items.map(([k, v]) => `<div><span class="label">${k}</span><span class="v">${v}</span></div>`).join('');
  }
  hideEnd() { $('endscreen').hidden = true; }
  // the passenger oxygen mask over your face
  maskOverlay(on) { const el = $('maskoverlay'); if (el) el.hidden = !on; }
  // pause menu: list of events that can be made to happen
  setEvents(list, onPick) {
    const sel = $('pause-event'); if (!sel) return;
    sel.innerHTML = '<option value="">Choose an event…</option>' + list.map((e) => `<option value="${e.id}">${escapeHtml(e.label)}</option>`).join('');
    $('pause-event-go').onclick = () => { if (sel.value) { onPick(sel.value); sel.value = ''; } };
  }
}

function menuCardHTML() {
  const sec = (t) => `<div class="sec">${t}</div>`;
  const it = (n, d, p) => `<div class="item"><div>${n}${d ? `<small>${d}</small>` : ''}</div><div class="p">${p}</div></div>`;
  return `<div class="mh"><b>Flavors by SAS</b><span>Onboard café · SAS Go · card payment only · prices in SEK (DKK / NOK / EUR accepted)</span></div>
  ${sec('Always included')}
  ${it('Coffee', 'Freshly brewed, organic', 'free')}${it('Tea', 'Black or green', 'free')}${it('Still water', '', 'free')}
  ${sec('Something to eat')}
  ${it('Chicken &amp; pesto focaccia', 'Grilled chicken, basil pesto, rocket', '95')}${it('Cheese &amp; tomato sandwich', 'Vegetarian · Danish rye', '79')}${it('Kanelbulle', 'Swedish cinnamon bun', '39')}${it('Chocolate bar', 'Marabou mjölkchoklad', '35')}${it('Crisps', 'Sea salt', '35')}
  ${sec('Drinks')}
  ${it('Soft drinks', 'Coca-Cola, Coca-Cola Zero, Fanta', '39')}${it('Orange juice', '', '39')}${it('Sparkling water', 'Loka', '35')}${it('Mikkeller Celebration IPA', '33 cl', '76')}${it('Wine', 'Red or white · 18.7 cl', '89')}
  <div class="foot">Coffee and tea are complimentary on all SAS flights. Snacks and drinks are for sale on European flights in SAS Go. Items shown are representative of the spring 2026 menu; the crew will tell you what is on board today. Press Esc to put the card back.</div>`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function safetyCardHTML() {
  const stroke = 'stroke="#152038" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  const cell = (title, svg, text) => `<div class="cell"><svg viewBox="0 0 200 110">${svg}</svg><h4>${title}</h4><div>${text}</div></div>`;
  const plane = `<g ${stroke}><path d="M20 55 Q20 38 40 36 L165 36 Q182 38 188 55 Q182 72 165 74 L40 74 Q20 72 20 55Z"/><path d="M85 36 L70 6 L96 6 L112 36 M85 74 L70 104 L96 104 L112 74"/></g>
    <g fill="#1e9e57">${[[34, 36], [34, 74], [92, 36], [100, 36], [92, 74], [100, 74], [168, 36], [168, 74]].map(([x, y]) => `<rect x="${x - 5}" y="${y - 4}" width="10" height="8" rx="2"/>`).join('')}</g>`;
  return `<div class="ch"><b>SAFETY ON BOARD · AIRBUS A320neo</b><span>SAS · read before take-off / Läs före start</span></div>
  <div class="grid">
    ${cell('8 emergency exits', plane, 'Two doors at the front, four over-wing window exits (rows 11–12), two doors at the rear. The nearest exit may be behind you.')}
    ${cell('Seatbelt', `<g ${stroke}><rect x="60" y="45" width="80" height="22" rx="6"/><rect x="92" y="49" width="18" height="14" fill="#152038"/><path d="M20 56h40M140 56h40"/><path d="M100 30 v-15 M92 22 l8 -8 8 8"/></g>`, 'Insert the metal tip, pull to tighten. Lift the buckle lid to release. Keep it fastened whenever you are seated.')}
    ${cell('Brace position', `<g ${stroke}><circle cx="120" cy="30" r="10"/><path d="M110 38 Q80 55 70 80 M70 80 L120 84 L120 100 M112 45 L140 70"/><path d="M40 20 L40 100"/></g>`, 'Feet flat on the floor, head down against the seat in front or on your knees, hands on your head.')}
    ${cell('Oxygen', `<g ${stroke}><path d="M100 10 v25"/><path d="M78 35 h44 l-6 26 h-32z"/><circle cx="100" cy="85" r="16"/><path d="M84 85 h-18 M116 85 h18"/></g>`, 'Pull the mask towards you, place it over nose and mouth, breathe normally. Fit your own mask before helping others.')}
    ${cell('Life jacket', `<g ${stroke}><path d="M70 20 Q100 40 130 20 L140 80 Q100 98 60 80Z" fill="#f2c230"/><path d="M92 46 v18 M108 46 v18"/><path d="M80 90 l-6 12 M120 90 l6 12" stroke="#c22"/></g>`, 'Under your seat. Over the head, straps around the waist. Inflate with the red tabs only after leaving the aircraft. Light activates in water.')}
    ${cell('Evacuation slides', `<g ${stroke}><path d="M30 30 h50 v20"/><path d="M80 50 L170 95"/><path d="M80 62 L160 102"/><circle cx="120" cy="60" r="7"/><path d="M114 66 l-10 14 M124 66 l10 12"/></g>`, 'Leave all baggage behind. Remove high heels. Jump onto the slide, arms crossed in front of you.')}
    ${cell('Floor-path lighting', `<g ${stroke}><path d="M20 90 L180 90"/>${[30, 55, 80, 105, 130, 155].map((x) => `<rect x="${x}" y="84" width="14" height="6" fill="#dfe8c8"/>`).join('')}<rect x="172" y="80" width="12" height="12" fill="#c22"/></g>`, 'White or green floor lights lead to the red lights marking the exits.')}
    ${cell('No smoking', `<g ${stroke}><circle cx="100" cy="55" r="36"/><rect x="72" y="50" width="48" height="10"/><path d="M74 29 L126 81" stroke="#c22"/></g>`, 'Smoking and e-cigarettes are prohibited on board, including in the lavatories.')}
    ${cell('Portable electronics', `<g ${stroke}><rect x="80" y="20" width="40" height="72" rx="6"/><path d="M92 50 l8 -12 8 12 M100 38 v26"/></g>`, 'Set phones and tablets to flight mode. Larger devices must be stowed for take-off and landing. Wi-Fi may be used when announced.')}
  </div>
  <div class="foot"><span>SE-ROX · A320-251N · 180 seats</span><span>Press M to put the card back · Tryck M för att lägga tillbaka</span></div>`;
}
