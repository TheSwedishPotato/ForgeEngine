import { Vector3 } from 'three';
import { LifeSim } from '../life/LifeSim.js';
import { Dialogue } from '../life/Dialogue.js';
import { Walker } from '../life/Walker.js';
import { STARTS, GOODS, LAWS, LIFE_SOURCES, ARMY_RANK, fmtMoney, NEEDS, RUMOURS } from '../life/data.js';
import { BUILDING, BUILDINGS, PLACES, TOWN_NAME, groundY, pushOut } from '../world/town.js';
import { PeopleMesh } from '../render/PeopleMesh.js';
import { Interior } from '../render/Interior.js';
import { allRanks } from '../data/society.js';
import { memorySummary } from '../life/Memory.js';
import { GPUParticles } from '../engine/passes/GPUParticles.js';

const _SHOP_KEYS = new Set(['tavern', 'bakery', 'butcher', 'bath', 'cobbler', 'smithy', 'weaver']);
const SAVE_KEY = 'skalice-1403-save-v1';
function readSave() { try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) : null; } catch { return null; } }
function writeSave(o) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); return true; } catch { return false; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ } }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const RANKS = Object.fromEntries(allRanks().map((r) => [r.id, r]));
const _v = new Vector3();
const deg = Math.PI / 180;

/** Sun direction for an hour of the day at 50° N on 27 September (declination about −1.6°). x east, y up, z south. */
function sunDir(hour, out) {
  const H = (hour - 12) * 15 * deg, phi = 50 * deg, dec = -1.6 * deg;
  const east = -Math.cos(dec) * Math.sin(H);
  const north = Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(H) * Math.sin(phi);
  const up = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(H) * Math.cos(phi);
  return out.set(east, up, -north).normalize();
}

/**
 * Life in Skalice: you are someone in the town in September 1403. Walk
 * about, go into buildings, talk to anyone (Claude answers as them), eat,
 * drink, sleep, work for wages, join the castle's company, keep the law or
 * break it. The duel and the joust are things you can do here when you
 * choose (a quarrel, the herald at the joust field).
 *
 * Controls: WASD walk (Shift to hurry), drag the mouse to look, wheel to
 * zoom, E talk / go in / come out, F eat, Q drink, R relieve yourself,
 * Z sleep, T let an hour pass, X drill (soldiers), G steal / cut a purse,
 * V strike someone, J journal, Esc menu. The game saves itself in this
 * browser every minute and when you leave.
 */
export class LifeMode {
  constructor({ stage, lists, audio, root, quality = 'high', onExit, onDuel, onJoust, config }) {
    this.stage = stage;
    this.lists = lists;
    this.audio = audio;
    this.root = root;
    this.quality = quality;
    this.onExit = onExit;
    this.onDuel = onDuel;
    this.onJoust = onJoust;
    this.config = config;
    this.keys = new Set();
    this.camYaw = Math.PI;
    this.camPitch = 0.28;
    this.camDist = 4.2;
    this.started = false;
    this.paused = false;
    this.wall = 0;
    this._buildCreation();
  }

  // --- character creation ------------------------------------------------------------------------

  _buildCreation() {
    const el = h(`<div class="screen ui-interactive life-create"><div class="folio">
      <div class="kicker">${esc(TOWN_NAME)} · Thursday 27 September 1403 · the eve of St Wenceslas</div>
      <h2>Who are you?</h2>
      <p class="fine">You wake in ${esc(TOWN_NAME)}, a small market town under the lord of Skalice castle, on the eve of the feast of St Wenceslas, patron of the land. The king is a prisoner in Vienna, Hungarian riders are loose in the kingdom, and the captain at the castle is taking on men. Everyone in the town lives their own day. You can talk to any of them.</p>
      <label class="lrow">Name <input class="lname" maxlength="24" value="${esc(this.config?.player?.name || 'Jan')}"></label>
      <div class="lrow">Sex <label><input type="radio" name="lsex" value="m" checked> man</label> <label><input type="radio" name="lsex" value="f"> woman</label></div>
      <h3>Your station</h3>
      <div class="jlist lstarts">${STARTS.map((s, i) => `<label data-sex="${s.sex}"><input type="radio" name="lstart" value="${s.id}" ${i === 0 ? 'checked' : ''}><b>${esc(s.name)} · ${fmtMoney(s.money)}</b><small>${esc(s.text)}</small></label>`).join('')}</div>
      <p class="fine lclaude">People answer through Claude when it is available to this page (you will be asked to allow it the first time); otherwise they answer from a simpler script.</p>
      <div class="actions">${readSave() ? `<button class="primary" data-a="continue">Continue · ${esc(readSave().player.name)}, ${esc(readSave().when ?? '')}</button>` : ''}<button class="${readSave() ? '' : 'primary'}" data-a="begin">Begin a new life</button><button data-a="back">Back</button></div>
    </div></div>`);
    el.addEventListener('change', () => {
      const female = el.querySelector('input[name=lsex]:checked').value === 'f';
      for (const l of el.querySelectorAll('.lstarts label')) { const off = female && l.dataset.sex === 'male'; l.querySelector('input').disabled = off; l.style.opacity = off ? 0.45 : 1; }
      if (el.querySelector('input[name=lstart]:checked')?.disabled) el.querySelector('input[name=lstart]:not(:disabled)').checked = true;
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'back') this.onExit?.();
      if (a === 'continue') { const o = readSave(); if (o) this.begin({ save: o }); }
      if (a === 'begin') {
        const start = STARTS.find((s) => s.id === el.querySelector('input[name=lstart]:checked').value);
        this.begin({ name: el.querySelector('.lname').value.trim() || 'Jan', sex: el.querySelector('input[name=lsex]:checked').value, start });
      }
    });
    this.root.appendChild(el);
    this.createEl = el;
  }

  begin({ name, sex, start, seed = 1403, save = null }) {
    this.createEl?.remove();
    if (save) { try { this.sim = LifeSim.restore(save, { seed }); } catch (e) { console.warn('save unreadable', e); clearSave(); this.sim = null; } }
    if (!this.sim) this.sim = new LifeSim({ seed, start, name, sex });
    start = STARTS.find((x) => x.id === this.sim.player.start) ?? STARTS[0];
    this.dialogue = new Dialogue(this.sim);
    if (save?.turns) for (const [k, v] of save.turns) this.dialogue.turns.set(k, v);
    this.people = new PeopleMesh(this.stage.scene, this.sim, { quality: this.quality });
    this._buildPlayer();
    this._buildHud();
    this._bind();
    this.sim.on((e) => this._event(e));
    this.started = true;
    const P = this.sim.player;
    this.camYaw = P.yaw;
    this.lastSave = this.wall;
    if (save) this.log(`${P.name} again. ${this.sim.situation()}.`, 'info');
    else this.log(`You are ${P.name}, ${start.name.toLowerCase()}. ${start.text}`, 'info');
    this.log('E talk to someone or go through a door · J journal · Esc menu.', 'info');
    this.dialogue.ready.then(() => { this.hud.querySelector('.lmode').textContent = this.dialogue.mode === 'claude' ? 'people answer through Claude' : 'people answer from a script (Claude not available here)'; });
  }

  _buildPlayer() {
    const P = this.sim.player;
    this.walker?.dispose();
    this.walker = new Walker({ name: P.name, items: P.dress, colors: P.colors, female: P.sex === 'f', headwear: P.sex === 'f' ? 'braid' : null, beard: P.sex === 'f' ? 0 : 0.15, height: P.sex === 'f' ? 1.62 : 1.75, quality: this.quality });
    this.stage.scene.add(this.walker.mesh);
  }

  // --- HUD -------------------------------------------------------------------------------------

  _buildHud() {
    const el = h(`<div class="hud life-hud">
      <div class="lclock"><b class="ldate"></b><span class="ltime"></span><small class="lplace"></small></div>
      <div class="lneeds"></div>
      <div class="lpurse"></div>
      <div class="lcomp"></div>
      <div class="lmark"></div>
      <div class="log"></div>
      <div class="lprompt"></div>
      <div class="callout"></div><div class="subcall"></div>
      <div class="lbar ui-interactive">
        <button data-k="e">E · talk / door</button><button data-k="f">F · eat</button><button data-k="q">Q · drink</button><button data-k="r">R · relieve</button><button data-k="z">Z · sleep</button><button data-k="t">T · wait 1 h</button><button data-k="x">X · drill</button><button data-k="g">G · steal</button><button data-k="v">V · strike</button><button data-k="j">J · journal</button>
      </div>
      <small class="lmode"></small>
    </div>`);
    el.querySelector('.lbar').addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.k; if (k) this._key(k); });
    this.root.appendChild(el);
    this.hud = el;
    this.logEl = el.querySelector('.log');
    // dialogue panel
    this.talkEl = h(`<div class="ltalk ui-interactive" hidden>
      <div class="lthead"><b class="ltname"></b><small class="lttitle"></small><span class="ltatt"></span><button class="ltclose">×</button></div>
      <div class="ltlog"></div>
      <div class="ltchips"></div>
      <form class="ltform"><input class="ltinput" placeholder="Say something…" maxlength="300" autocomplete="off"><button class="primary">Say</button></form>
      <small class="ltstatus"></small>
    </div>`);
    this.talkEl.querySelector('.ltclose').addEventListener('click', () => this.closeTalk());
    this.talkEl.querySelector('.ltform').addEventListener('submit', (e) => { e.preventDefault(); const i = this.talkEl.querySelector('.ltinput'); const t = i.value.trim(); if (t) { i.value = ''; this.speak(t); } });
    this.root.appendChild(this.talkEl);
    // journal
    this.journalEl = h(`<div class="screen dim ui-interactive" hidden><div class="folio wide scroll ljournal"></div></div>`);
    this.journalEl.addEventListener('click', (e) => { if (e.target.closest('button')?.dataset.a === 'close') this.journalEl.hidden = true; });
    this.root.appendChild(this.journalEl);
    // modal (the watch, death, menus)
    this.modalEl = h(`<div class="screen dim ui-interactive" hidden><div class="folio narrow lmodal"></div></div>`);
    this.root.appendChild(this.modalEl);
  }

  log(text, kind = '') {
    if (!this.logEl) return;
    const line = h(`<div class="line ${kind}">${esc(text)}</div>`);
    this.logEl.prepend(line);
    while (this.logEl.children.length > (innerWidth < 760 ? 3 : 6)) this.logEl.lastChild.remove();
    setTimeout(() => line.classList.add('fade'), 9000);
  }

  callout(text, sub = '', ms = 2200) {
    const c = this.hud.querySelector('.callout'), s = this.hud.querySelector('.subcall');
    c.textContent = text; s.textContent = sub;
    c.classList.add('show'); s.classList.toggle('show', !!sub);
    clearTimeout(this._co);
    this._co = setTimeout(() => { c.classList.remove('show'); s.classList.remove('show'); }, ms);
  }

  _hud() {
    const s = this.sim, P = s.player, d = s.date();
    const H = this.hud;
    H.querySelector('.ldate').textContent = d.text;
    H.querySelector('.ltime').textContent = d.clock;
    H.querySelector('.lplace').textContent = P.inside ? BUILDING[P.inside].name : this._placeName();
    const bar = (label, v, bad) => `<div class="lneed${v > 80 ? ' warn' : ''}"><span>${label}</span><i style="width:${Math.min(100, v)}%;background:${bad ? (v > 80 ? '#c0261e' : '#b8862b') : '#5e9a4a'}"></i></div>`;
    H.querySelector('.lneeds').innerHTML = bar('Health', P.health, false) + Object.entries(NEEDS).map(([k, n]) => bar(n.name, P.needs[k], true)).join('') + (P.drunk > 15 ? `<div class="lneed"><span>Drunk</span><i style="width:${Math.min(100, P.drunk)}%;background:#7a4a8a"></i></div>` : '');
    H.querySelector('.lpurse').innerHTML = `${esc(fmtMoney(P.money))} · ${esc(P.army ? ARMY_RANK[P.army.rank].name : RANKS[P.rank]?.name ?? '')}${P.wanted ? ' · <b class="lwanted">wanted by the watch</b>' : ''}${Object.entries(P.inventory).filter(([, n]) => n > 0).map(([k, n]) => ` · ${n}× ${GOODS[k]?.name.split(' ').slice(-1)[0] ?? k}`).join('')}`;
    const comp = s.companions();
    H.querySelector('.lcomp').textContent = comp.length ? `With you: ${comp.map((p) => (P.knownNames.has(p.id) ? p.name : p.title) + (p.follow.wage ? ` (${fmtMoney(p.follow.wage)}/day)` : '')).join(', ')}` : '';
    H.classList.toggle('hue', !!s.justice.hue);
    // what E would do
    const near = this._nearby()[0], door = s.doorNear();
    let prompt = '';
    if (this.talking) prompt = '';
    else if (near) prompt = `E · talk to ${P.knownNames.has(near.id) ? near.fullName : near.title}${near.agent.act ? ` (${near.agent.act})` : ''}`;
    else if (P.inside && this.interior?.nearDoor(P.x, P.z)) prompt = `E · go out`;
    else if (door) prompt = `E · go into ${door.name}`;
    else if (!P.inside && Math.hypot(P.x - PLACES.well.x, P.z - PLACES.well.z) < 3) prompt = 'Q · drink from the well';
    else if (!P.inside && Math.hypot(P.x - PLACES.privy.x, P.z - PLACES.privy.z) < 3) prompt = 'R · use the privy';
    const duty = s.dutyNow(d);
    if (duty && !s.atPlace(duty.place)) prompt += `${prompt ? ' · ' : ''}Duty: ${duty.what}`;
    H.querySelector('.lprompt').textContent = prompt;
    // where you were pointed: a bearing and a distance
    const mk = H.querySelector('.lmark');
    if (this.marker && this.wall < this.marker.until && !P.inside) {
      const dx = this.marker.x - P.x, dz = this.marker.z - P.z, dist = Math.hypot(dx, dz);
      if (dist < 4) this.marker = null;
      else {
        let rel = Math.atan2(dx, dz) - this.camYaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const arrow = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'][((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8];
        mk.textContent = `${arrow} ${this.marker.name} · ${Math.round(dist)} m`;
      }
    } else mk.textContent = '';
  }

  /** People within talking distance: inside, by their places in the room. */
  _nearby(r = 2.4) {
    const s = this.sim, P = s.player;
    if (!P.inside || !this.interior) return s.nearby(r);
    return s.people.filter((p) => p.alive && p.agent.inside === P.inside && !p.agent.route.length)
      .map((p) => { const sp = this.people.posOf(p, this.interior); return { p, d: Math.hypot(sp.x - P.x, sp.z - P.z) }; })
      .filter((o) => o.d < r).sort((a, b) => a.d - b.d).map((o) => o.p);
  }

  _placeName() {
    const P = this.sim.player;
    let best = 'the street', bd = 12;
    for (const [k, pl] of Object.entries(PLACES)) { const dd = Math.hypot(pl.x - P.x, pl.z - P.z); if (dd < bd) { bd = dd; best = pl.name; } }
    return best;
  }

  // --- input ------------------------------------------------------------------------------------

  _bind() {
    this._ls = [];
    const on = (t, ty, fn, o) => { t.addEventListener(ty, fn, o); this._ls.push([t, ty, fn, o]); };
    const typing = (e) => e.target.closest?.('input,textarea,select');
    on(window, 'keydown', (e) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.keys.add(k); e.preventDefault(); return; }
      if (k === 'escape') { if (this.talking) this.closeTalk(); else if (!this.journalEl.hidden) this.journalEl.hidden = true; else this._menu(); return; }
      if (!e.repeat) this._key(k);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    let drag = null;
    on(window, 'pointerdown', (e) => { if (!e.target.closest?.('.ui-interactive')) drag = { x: e.clientX, y: e.clientY }; });
    on(window, 'pointermove', (e) => {
      if (!drag) return;
      this.camYaw -= (e.clientX - drag.x) * 0.006;
      this.camPitch = Math.max(-0.2, Math.min(1.2, this.camPitch + (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    });
    on(window, 'pointerup', () => { drag = null; });
    on(window, 'wheel', (e) => { if (!typing(e) && !e.target.closest?.('.ltalk,.folio')) this.camDist = Math.max(1.6, Math.min(12, this.camDist * (e.deltaY > 0 ? 1.12 : 0.9))); }, { passive: true });
  }

  _key(k) {
    if (!this.started || this.paused || !this.sim.player.alive) return;
    if (this.sim.pendingStop) return;
    const s = this.sim, P = s.player;
    switch (k) {
      case 'e': {
        if (this.talking) return;
        const near = this._nearby()[0];
        if (near) return this.openTalk(near);
        if (P.inside && this.interior?.nearDoor(P.x, P.z)) return this._leave();
        const door = s.doorNear();
        if (door) return this._enter(door);
        break;
      }
      case 'f': if (P.inventory.bread > 0) { s.consume('bread'); this.log('You eat a loaf of rye bread.', 'info'); } else this.log('You have nothing to eat. Bread is 4 parvi at the bakery or the tavern.', 'info'); break;
      case 'q': if (!s.drinkWell()) this.log(P.inside === 'tavern' ? 'Ask the innkeeper for a mug of beer.' : 'Go to the well in the square to drink, or to the tavern.', 'info'); break;
      case 'r': s.relieve(); break;
      case 'z': {
        // at night, until the morning bell; by day, a few hours
        const hr = s.date().h;
        const hours = hr >= 19 ? 29 - hr : hr < 5 ? 5 - hr : 3;
        const r = s.sleep(hours);
        if (!r.ok) this.log(r.why, 'info'); else this.log(`You sleep ${hours.toFixed(1)} hours.`, 'info');
        break;
      }
      case 't': s.advance(1); this.log('An hour passes.', 'info'); break;
      case 'x': { const r = s.drill(2); if (!r.ok) this.log(r.why, 'info'); break; }
      case 'j': this._journal(); break;
      case 'g': this._steal(); break;
      case 'v': this._strike(); break;
      default: break;
    }
  }

  /** Steal from the counter or stall you stand at; with nothing to hand, cut the purse of whoever is next to you. */
  _steal() {
    const s = this.sim;
    const near = this._nearby(1.6)[0];
    const atShop = s.player.inside ? !!_SHOP_KEYS.has(s.player.inside) : Math.hypot(s.player.x - PLACES.market.x, s.player.z - PLACES.market.z) < 7;
    if (atShop && !(near && this.keys.has('shift'))) {
      this._confirm('Take something from the counter while no one is looking?', [['Take it', () => { const r = s.justice.steal(); if (!r.ok) this.log(r.why, 'info'); }], ['Think better of it', () => {}]]);
      return;
    }
    if (!near) { this.log('There is nothing to steal here and nobody close enough to rob.', 'info'); return; }
    this._confirm(`Cut ${this.sim.player.knownNames.has(near.id) ? near.name : 'the ' + near.title}'s purse?`, [['Cut it', () => { const r = s.justice.pickpocket(near); if (!r.ok) this.log(r.why, 'info'); else if (r.caught) this.log(`${near.name} feels your hand at the purse-strings!`, 'hurt big'); }], ['Leave it', () => {}]]);
  }

  /** Strike whoever is in front of you. */
  _strike() {
    const near = this._nearby(1.8)[0];
    if (!near) { this.log('There is nobody within reach.', 'info'); return; }
    this._confirm(`Strike ${this.sim.player.knownNames.has(near.id) ? near.name : 'the ' + near.title}? Brawling is fined, drawing blood more, and killing is a matter for the sword.`, [['Strike', () => {
      const r = this.sim.justice.strike(near);
      this.log(`You hit ${near.name} in the face.`, 'hurt');
      this.audio?.hit?.(0.5);
      if (r.fightsBack) { this.log(`${near.name} goes for you!`, 'hurt big'); this._duel(near, 'brawl'); }
    }], ['No', () => {}]]);
  }

  _enter(b) {
    const r = this.sim.enter(b);
    if (!r.ok) {
      this.log(r.why, 'info');
      if (r.private) this._confirm(`${r.why} Go in anyway?`, [['Go in', () => { this.sim.enter(b, true); this._buildInterior(b); }], ['Leave it', () => {}]]);
      return;
    }
    this._buildInterior(b);
  }

  _buildInterior(b) {
    this.interior?.dispose();
    this.interior = new Interior(this.stage.scene, b);
    const P = this.sim.player;
    const d = this.interior.world(this.interior.doorLocal.x * 0.8, this.interior.doorLocal.z * 0.8);
    P.x = d.x; P.z = d.z; P.y = d.y;
    this.log(`You go into ${b.name}.`, 'info');
    this.audio?.step?.(false);
  }

  _leave() {
    this.sim.leave();
    this.interior?.dispose();
    this.interior = null;
  }

  // --- talking ----------------------------------------------------------------------------------

  openTalk(p) {
    this.talking = p;
    this.closeTalk(true);
    this.talking = p;
    const T = this.talkEl, P = this.sim.player;
    T.hidden = false;
    T.querySelector('.ltname').textContent = P.knownNames.has(p.id) ? p.fullName : p.title[0].toUpperCase() + p.title.slice(1);
    T.querySelector('.lttitle').textContent = `${P.knownNames.has(p.id) ? p.title + ' · ' : ''}${RANKS[p.rank]?.estateName ?? ''} · ${p.words.join(', ')} · ${p.agent.act}`;
    this._att();
    T.querySelector('.ltlog').innerHTML = '';
    const chips = ['God give you good day.', `My name is ${P.name}.`, 'What news?', 'What have you heard about me?', 'What do you sell?', 'Is there work for me?', 'Here, take a groschen.', 'Come with me.', 'Can I come with you?', 'Teach me what you know.', 'I want to serve in the garrison.', 'Farewell.'];
    if (p.follow) chips.splice(7, 2, 'You can go now.');
    if (p.jousts) chips.splice(3, 0, 'I want to ride in the joust.');
    T.querySelector('.ltchips').innerHTML = chips.map((c) => `<button type="button">${esc(c)}</button>`).join('');
    T.querySelectorAll('.ltchips button').forEach((b) => b.addEventListener('click', () => this.speak(b.textContent)));
    T.querySelector('.ltstatus').textContent = this.dialogue.mode === 'claude' ? 'Claude speaks for them.' : 'Scripted answers (Claude not available).';
    setTimeout(() => T.querySelector('.ltinput').focus(), 30);
  }

  _att() {
    const p = this.talking;
    if (!p) return;
    const a = p.attitude;
    this.talkEl.querySelector('.ltatt').textContent = a > 40 ? 'friendly' : a > 10 ? 'well-disposed' : a > -10 ? 'neutral' : a > -40 ? 'cool' : 'hostile';
  }

  closeTalk(keep = false) {
    this.ctl?.abort();
    if (!keep) { this.talkEl.hidden = true; this.talking = null; }
  }

  async speak(text) {
    const p = this.talking;
    if (!p) return;
    const L = this.talkEl.querySelector('.ltlog');
    L.append(h(`<p class="me"><b>You:</b> ${esc(text)}</p>`));
    // the joust: the herald enters you
    if (p.jousts && /joust|tilt|lance|ride in/i.test(text)) {
      L.append(h(`<p><b>${esc(p.name)}:</b> ${esc('A coronel lance and a good horse are waiting for you at the end of the field. God and St Wenceslas be with you.')}</p>`));
      setTimeout(() => { this.closeTalk(); this.onJoust?.(); }, 900);
      return;
    }
    const bubble = h(`<p><b>${esc(p.name)}:</b> <span class="say">…</span></p>`);
    L.append(bubble);
    L.scrollTop = L.scrollHeight;
    this.ctl?.abort();
    this.ctl = new AbortController();
    try {
      const r = await this.dialogue.say(p, text, { signal: this.ctl.signal, onText: ({ text: t }) => { const m = /"say"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(t); if (m) bubble.querySelector('.say').textContent = m[1].replace(/\\"/g, '"'); } });
      bubble.querySelector('.say').textContent = r.say;
      if (r.note) L.append(h(`<p class="note">${esc(r.note)}</p>`));
      this._att();
      for (const act of r.actions) {
        const A = act.type;
        if (A === 'leave') setTimeout(() => this.closeTalk(), 1600);
        if ((A === 'directions' || A === 'lead' || A === 'go_to') && act.ok) { const pl = PLACES[act.place] ?? BUILDING[act.place]; if (pl) { this.marker = { x: pl.x ?? pl.door.x, z: pl.z ?? pl.door.z, name: pl.name, until: this.wall + 90 }; this.log(`${A === 'directions' ? 'The way' : 'Meet'}: ${pl.name}.`, 'info'); } if (A !== 'directions') setTimeout(() => this.closeTalk(), 1400); }
        if (A === 'call_watch') this.log(`${p.name} shouts for the watch!`, 'hurt');
        if (A === 'enlist' && act.ok) this.callout('You serve', 'the captain of Skalice castle', 2600);
        if (A === 'follow' && act.ok) setTimeout(() => this.closeTalk(), 1200);
        if ((A === 'accept' || A === 'give' || A === 'sell' || A === 'buy') && act.ok) this.audio?.coin?.();
        if (A === 'attack') { setTimeout(() => { this.closeTalk(); this.log(`${p.name} goes for you!`, 'hurt big'); this._duel(p, 'attacked'); }, 900); }
      }
    } catch (e) {
      if (e?.code !== 'cancelled') bubble.querySelector('.say').textContent = '(says nothing)';
    }
    L.scrollTop = L.scrollHeight;
    this.talkEl.querySelector('.ltstatus').textContent = this.dialogue.mode === 'claude' ? 'Claude speaks for them.' : `Scripted answers${this.dialogue.lastError ? ` (Claude: ${this.dialogue.lastError})` : ''}.`;
  }

  // --- events, the watch, death ----------------------------------------------------------------------

  _event(e) {
    switch (e.type) {
      case 'bell': this.log(`The bell rings ${e.bell.name}. ${e.bell.text}`, 'info'); this.audio?.bell?.(); break;
      case 'day': this.callout(e.date.text, this.sim.isFeast(e.date) ? 'the feast of St Wenceslas' : '', 2600); break;
      case 'accident': case 'faint': case 'info': case 'work': case 'army': case 'law': this.log(e.text, e.type === 'accident' ? 'hurt' : e.type === 'army' ? 'good' : 'info'); break;
      case 'crime': this.log(e.text, 'hurt big'); break;
      case 'dress': this._buildPlayer(); break;
      case 'stopped': this._stopped(e); break;
      case 'hue': this.log(e.text, 'hurt big'); this.callout('Hue and cry!', e.pursuers ? 'run, or stand and be taken' : '', 2600); this.audio?.bell?.(); break;
      case 'news': case 'give': this.log(e.text, 'info'); break;
      case 'moved': this._syncInterior(); break;
      case 'trial': this._syncInterior(); setTimeout(() => this._trial(), 50); break;
      case 'resist': this.log(e.text, 'hurt big'); this._duel(e.by, 'arrest'); break;
      case 'death': this._death(e.cause); break;
      default: break;
    }
  }

  _stopped(e) {
    const s = this.sim, P = s.player, open = P.crimes.filter((c) => !c.settled && (c.seen.length || c.handhafte));
    this.closeTalk();
    const fine = open.reduce((sum, c) => sum + (LAWS.find((l) => l.id === c.law)?.fine ?? 0), 0) || (e.reason === 'curfew' ? 12 : 0);
    const names = open.map((c) => LAWS.find((l) => l.id === c.law)?.name.toLowerCase()).join(', ');
    const who = e.seizedBy === 'townsfolk' ? `${e.by.name} and the others who ran after you seize you and hold you for the watch` : `${e.by.name} of the watch takes you by the arm`;
    const why = e.reason === 'curfew' && !open.length ? `${e.by.name} of the watch stops you: "It is after the curfew bell. Who are you, and where are you going${P.inventory.candle > 0 ? '' : ' without a light'}?"` : e.serious ? `${who}: "You'll answer before the rychtář and the aldermen for ${names}."${open.some((c) => c.handhafte) ? ' You were taken with the deed in hand.' : ''}` : `${who}: "That's ${names}. The fine is ${fmtMoney(fine)}, or a night in the tower."`;
    const opts = [];
    if (e.reason === 'curfew' && !open.length) opts.push(['Explain yourself', () => s.resolveStop('explain')]);
    if (!e.serious) opts.push([`Pay ${fmtMoney(fine)}`, () => s.resolveStop(P.money >= fine ? 'pay' : 'submit')]);
    opts.push([e.serious ? 'Go with them to the rychta' : 'Go quietly', () => s.resolveStop('submit')]);
    const bribe = Math.max(24, fine * 2);
    if (e.by.watch && P.money >= bribe) opts.push([`Slip him ${fmtMoney(bribe)}`, () => s.resolveStop('bribe', bribe)]);
    opts.push(['Resist', () => s.resolveStop('resist')]);
    this._confirm(why, opts);
  }

  /** The court in the rychta: one count at a time, a plea for each, then the sentence. */
  _trial() {
    const J = this.sim.justice, T = J.trial;
    if (!T) return;
    const P = this.sim.player;
    if (T.i >= T.counts.length) { J.endTrial(); this._syncInterior(); return; }
    const k = T.counts[T.i];
    const court = `${T.judge ? `${T.judge.fullName}, ${T.judge.title}` : 'The headman'}${T.aldermen.length ? `, with ${T.aldermen.map((a) => a.fullName).join(' and ')} as aldermen` : ''}`;
    const accuse = k.accuser ? `${k.accuser.fullName} accuses you: you ${k.text}.` : `You are accused: you ${k.text}.`;
    const proof = k.proof === 'handhafte' ? 'You were taken in the act.' : k.proof === 'witnesses' ? `${k.witnesses.length + (k.accuser ? 1 : 0)} people will swear they saw it.` : k.proof === 'one' ? 'One witness only.' : 'No one swears they saw it.';
    const sm = J.smirPrice(k);
    const helpers = J.oathHelpers(k).length;
    const need = k.great ? 6 : 2;
    const opts = [['Confess', () => this._verdict(J.plead('confess'))], [`Deny it on oath${k.proof === 'one' || k.proof === 'none' ? ` (${helpers} of ${need} oath-helpers would swear for you)` : ''}`, () => this._verdict(J.plead('deny'))]];
    if (sm) opts.push([`Offer reconciliation: ${fmtMoney(sm.price)}${P.money < sm.price ? ' (you have not got it)' : ''}`, () => this._verdict(J.plead('smir'))]);
    this._confirm(`The court of ${TOWN_NAME} sits in the rychta. ${court}. ${accuse} ${proof}`, opts);
  }

  _verdict(r) {
    const J = this.sim.justice;
    const go = () => setTimeout(() => this._trial(), 30);
    if (r.verdict !== 'guilty') { this._confirm(r.text, [['Go on', go]]); return; }
    const sen = r.sentence;
    const carry = (x) => { const t = J.execute(x); this._syncInterior(); if (t === 'dead') return; this._confirm(t || 'It is done.', [['Go on', go]]); };
    const opts = [['Bow your head', () => carry(sen)]];
    if (sen.death) opts.push(['Beg for mercy', () => { const m = J.mercy(sen); this._confirm(m.granted ? `Your friends kneel before the court and beg for your life. ${m.sentence.text}.` : 'The court hears your pleas and is not moved.', [['Go on', () => carry(m.sentence)]]); }]);
    this._confirm(`${r.text} The court finds you guilty. Sentence: ${sen.text}.`, opts);
  }

  /** Build or drop the interior after the sim has moved you (court, pillory, banishment). */
  _syncInterior() {
    const P = this.sim.player;
    if (P.inside && this.interior?.b.id !== P.inside) {
      this.interior?.dispose();
      this.interior = new Interior(this.stage.scene, BUILDING[P.inside]);
      const d = this.interior.world(0, 0);
      P.x = d.x; P.z = d.z; P.y = d.y;
    } else if (!P.inside && this.interior) { this.interior.dispose(); this.interior = null; }
    this.camPos = null;
  }

  _confirm(text, options) {
    const M = this.modalEl;
    M.querySelector('.lmodal').innerHTML = `<p class="lede">${esc(text)}</p><div class="actions">${options.map(([l], i) => `<button data-i="${i}"${i === 0 ? ' class="primary"' : ''}>${esc(l)}</button>`).join('')}</div>`;
    M.hidden = false;
    this.paused = true;
    M.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { M.hidden = true; this.paused = false; options[Number(b.dataset.i)][1](); }));
  }

  _duel(npc, why) {
    if (!this.onDuel) return;
    this.paused = true;
    this.onDuel(npc, why, (result) => {
      this.paused = false;
      const s = this.sim, P = s.player;
      if (result.won) {
        this.log(`You beat ${npc.name}.`, 'good'); npc.hurt = 1;
        if (why === 'arrest') P.wanted = 3;
        s.remember(npc, { kind: 'done', text: why === 'attacked' ? 'beat me when I went for them' : 'beat me in a fight', weight: 7, att: -15 });
      } else {
        P.health = Math.max(5, P.health - 45); this.log(`${npc.name} beats you senseless.`, 'hurt big');
        s.remember(npc, { kind: 'met', text: 'I beat them in a fight', weight: 5 });
        if (why === 'arrest') { s.pendingStop = { by: npc, reason: 'wanted', serious: true }; s.resolveStop('submit'); }
      }
      if (result.killed) {
        npc.alive = false;
        s.crime('killing', { victim: npc, selfDefence: why === 'attacked' });
        for (const p of s.people) if (p.alive && p.spouse === npc.id) s.remember(p, { kind: 'done', text: `killed my ${npc.sex === 'f' ? 'wife' : 'husband'}, ${npc.fullName}`, weight: 10, att: -80, about: 'player' });
      } else if (why === 'brawl' && !result.won) {
        // they drew blood on each other
        const c = P.crimes.slice().reverse().find((x) => x.law === 'brawl' && x.victim === npc.id);
        if (c) c.blood = true;
      }
    });
  }

  _death(cause) {
    const P = this.sim.player;
    clearSave();
    this._confirm(`${P.name} is dead${cause === 'thirst' ? ' of thirst' : cause === 'hunger' ? ' of hunger' : cause === 'the gallows' ? ', hanged on the gallows outside the town' : cause === 'the sword' ? ', beheaded by the sword at the rychta' : ''}. ${P.army ? 'The company buries you outside the churchyard wall.' : 'The sexton rings the bell for you.'} Days lived in ${TOWN_NAME}: ${Math.floor(this.sim.t / 24)}.`, [['Begin again', () => this.restart()], ['Title', () => this.onExit?.()]]);
  }

  _menu() {
    this._confirm(`${this.sim.situation()}.`, [['Back to town', () => {}], ['Journal', () => this._journal()], ['Save now', () => this.log(this.save() ? 'Saved in this browser.' : 'Could not save (storage is blocked here).', 'info')], ['Begin again', () => { clearSave(); this.restart(); }], ['Leave to the title', () => this.onExit?.()]]);
  }

  restart() {
    this.dispose(true);
    this.started = false;
    this._buildCreation();
  }

  _journal() {
    const s = this.sim, P = s.player;
    const met = s.people.filter((p) => p.memories.some((m) => m.about === 'player') || P.knownNames.has(p.id)).sort((a, b) => b.attitude - a.attitude);
    const news = s.justice.news.slice(-6).reverse();
    const J = this.journalEl.querySelector('.ljournal');
    J.innerHTML = `<div class="armoury-head"><div><div class="kicker">${esc(s.situation())}</div><h2>${esc(P.name)}</h2></div><div class="actions"><button data-a="close">Close</button></div></div>
      <div class="realm-cols">
        <section class="estate"><h3>You</h3><p>${esc(P.startName)}${P.army ? ` · ${esc(ARMY_RANK[P.army.rank].name)} of the garrison, ${P.army.days} days' service` : ''}. Purse: ${esc(fmtMoney(P.money))}. Health ${P.health.toFixed(0)}. Reputation ${P.reputation}.</p>
          <table class="jtable">${Object.entries(P.skills).map(([k, v]) => `<tr><td>${Math.round(v)}</td><td>${esc(k)}</td></tr>`).join('')}</table>
          ${P.army ? `<p class="fine">Duties: drill in the yard 5:30–8, watch at the gate 8–12, drill 13–16. Pay at 18:00. Absences are docked. Promotion comes with service and skill: ${esc(Object.values(ARMY_RANK).map((r) => r.name).join(' → '))}.</p>` : `<p class="fine">The captain, Hereš of Vrchy, takes on men in the castle yard after noon or in the tavern of an evening.</p>`}
        </section>
        <section class="estate"><h3>People you know</h3>${met.length ? `<table class="jtable">${met.map((p) => `<tr><td>${p.attitude}</td><td><b>${esc(P.knownNames.has(p.id) ? p.fullName : p.title)}</b><br><small>${esc(p.title)}${p.follow ? ' · with you' : ''} · ${esc(memorySummary(p, 2))}</small></td></tr>`).join('')}</table>` : '<p class="fine">Nobody yet.</p>'}</section>
        <section class="estate"><h3>The law of ${esc(TOWN_NAME)}</h3>${LAWS.map((l) => `<p class="fine"><b>${esc(l.name)}.</b> ${esc(l.text)} <i>(${esc(l.sureness)})</i></p>`).join('')}</section>
        <section class="estate"><h3>Your record</h3>${P.crimes.length ? P.crimes.slice(-8).map((c) => `<p class="fine">${c.settled ? '✓' : c.seen.length ? '<b>open</b>' : 'unseen'} · ${esc(LAWS.find((l) => l.id === c.law)?.name ?? c.law)}${c.value ? ` (${esc(fmtMoney(c.value))})` : ''}</p>`).join('') : '<p class="fine">Clean.</p>'}${P.banished > s.t ? '<p class="fine"><b>Banished from Skalice.</b> If the watch finds you in the town you hang.</p>' : ''}
          <h3>Town talk</h3>${news.length ? news.map((n) => `<p class="fine">${esc(n.text)}</p>`).join('') : '<p class="fine">Nothing of note.</p>'}</section>
        <section class="estate"><h3>What people say</h3>${RUMOURS.map((r) => `<p class="fine">${esc(r)}</p>`).join('')}<h3>Sources</h3>${Object.values(LIFE_SOURCES).map((x) => `<p class="fine"><b>${esc(x.short)}.</b> ${esc(x.text)}</p>`).join('')}</section>
      </div>`;
    this.journalEl.hidden = false;
  }

  // --- per frame ---------------------------------------------------------------------------------------

  frame(dt) {
    this.wall += dt;
    if (!this.started) return;
    const s = this.sim, P = s.player;
    if (!this.paused && P.alive && !this.talking?.__freeze) {
      if (!P.restrained && !P.held) this._move(dt);
      s.update(dt);
    }
    if (this.wall - this.lastSave > 60 && P.alive && !s.justice.trial && !s.pendingStop) this.save();
    // always on the ground outside (never sunk into it, whatever moved you)
    if (!P.inside) P.y = groundY(P.x, P.z);
    // where the player stands, and the people around
    const speed = this._speed ?? 0;
    const posture = P.sleepingUntil > s.t ? 'lie' : 'stand';
    this.walker.update(dt, { x: P.x, y: P.y, z: P.z, yaw: P.yaw, speed, posture, gesture: !!this.talking });
    this.people.update(dt, this.stage.camera, this.interior ? this.interior : null);
    // embers rising from the forge and the hearths (GPU particles)
    if (this.interior && GPUParticles.active) for (const L of this.interior.lights) {
      if (L.intensity < 8 || Math.random() > dt * (this.interior.b.kind === 'smithy' ? 10 : 3)) continue;
      const g = this.interior.group.position;
      GPUParticles.active.emit({ pos: { x: g.x + L.position.x, y: g.y + L.position.y - 0.2, z: g.z + L.position.z }, count: this.interior.b.kind === 'smithy' ? 6 : 2, kind: 'ember', speed: 0.5, life: 2.5, heat: 0.8, size: 0.006, dir: { x: 0, y: 1, z: 0 }, spread: 0.6 });
    }
    this._daylight(s.date().h);
    this._camera(dt);
    this._hud();
  }

  _move(dt) {
    const s = this.sim, P = s.player;
    let fx = 0, fz = 0;
    const K = this.keys;
    if (K.has('w') || K.has('arrowup')) fz += 1;
    if (K.has('s') || K.has('arrowdown')) fz -= 1;
    if (K.has('a') || K.has('arrowleft')) fx += 1;
    if (K.has('d') || K.has('arrowright')) fx -= 1;
    if (this.talking) { fx = 0; fz = 0; }
    const len = Math.hypot(fx, fz);
    let speed = 0;
    if (len > 0) {
      const run = K.has('shift') ? 1.8 : 1;
      speed = 1.45 * run * (P.drunk > 30 ? 0.8 : 1) * (P.needs.fatigue > 85 ? 0.7 : 1);
      // relative to the camera
      const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
      const dx = (fz * sy + fx * cy) / len, dz = (fz * cy - fx * sy) / len;
      const want = Math.atan2(dx, dz);
      let e = want - P.yaw; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      P.yaw += e * Math.min(1, dt * 10);
      let nx = P.x + dx * speed * dt, nz = P.z + dz * speed * dt;
      if (P.drunk > 30) { nx += Math.sin(this.wall * 2.1) * 0.6 * dt; nz += Math.cos(this.wall * 1.7) * 0.6 * dt; }
      if (P.inside && this.interior) ({ x: nx, z: nz } = this.interior.clamp(nx, nz));
      else ({ x: nx, z: nz } = this._collide(nx, nz));
      P.x = nx; P.z = nz;
      P.y = P.inside && this.interior ? this.interior.origin.y : groundY(P.x, P.z);
    }
    this._speed = this._speed === undefined ? speed : this._speed + (speed - this._speed) * Math.min(1, dt * 8);
  }

  /** Walls: keep out of buildings, the castle's walls and towers and the things in the square, and on the map. */
  _collide(x, z) {
    ({ x, z } = pushOut(x, z, 0.3));
    return { x: Math.max(-140, Math.min(140, x)), z: Math.max(-60, Math.min(260, z)) };
  }

  _camera(dt) {
    const P = this.sim.player, cam = this.stage.camera;
    const inside = !!P.inside;
    const dist = inside ? Math.min(this.camDist, 2.6) : this.camDist;
    const target = _v.set(P.x, P.y + 1.55, P.z);
    const cp = Math.cos(this.camPitch);
    const want = new Vector3(target.x - Math.sin(this.camYaw) * dist * cp, target.y + Math.sin(this.camPitch) * dist, target.z - Math.cos(this.camYaw) * dist * cp);
    if (!inside) {
      // keep the camera out of walls: pull it in along the line to the player until it is clear
      for (let i = 0; i < 8; i++) {
        const c = this._collide(want.x, want.z);
        if (Math.abs(c.x - want.x) < 1e-6 && Math.abs(c.z - want.z) < 1e-6) break;
        want.lerp(target, 0.25);
      }
      want.y = Math.max(want.y, groundY(want.x, want.z) + 0.4);
    }
    else { const c = this.interior.clamp(want.x, want.z); want.x = c.x; want.z = c.z; want.y = Math.min(want.y, this.interior.origin.y + this.interior.H - 0.25); }
    const k = 1 - Math.exp(-dt * 10);
    this.camPos ??= want.clone();
    this.camPos.lerp(want, k);
    cam.position.copy(this.camPos);
    cam.lookAt(target);
    if (Math.abs(cam.fov - 55) > 0.1) { cam.fov = 55; cam.updateProjectionMatrix(); }
    this.stage.focusPoint = target;
    // the sharp shadow map around you and whoever stands with you
    const fpts = [this.walker.b.head.pos, this.walker.b.footL.pos];
    if (this.talking) fpts.push(this.people.walkers[this.talking.idx]?.b.head.pos ?? this.walker.b.head.pos);
    this.stage.shadowFocus = fpts;
    this.stage.dofAmount = 0;
    this.stage.visor = 0;
    this.stage.hurt = Math.max(0, (60 - P.health) / 80) + (P.drunk > 40 ? 0.15 : 0);
  }

  /** The sun by the hour; a dim blue moon at night. */
  _daylight(hour) {
    const sun = this.lists.sun, r = this.stage.r;
    if (!sun) return;
    const d = sunDir(hour, new Vector3());
    let I = 7.5, col = [1.0, 0.87, 0.7];
    if (d.y < 0.05) {
      const k = Math.max(0, Math.min(1, (d.y + 0.15) / 0.2));   // twilight
      d.set(0.3, 0.45, -0.85).normalize();                       // the moon
      I = 0.35 + k * 1.5; col = [0.55 + 0.4 * k, 0.62 + 0.2 * k, 0.9 - 0.1 * k];
    } else if (d.y < 0.2) { const k = (d.y - 0.05) / 0.15; I = 1.8 + 5.7 * k; col = [1.0, 0.6 + 0.27 * k, 0.4 + 0.3 * k]; }
    sun.position.copy(sun.target.position).addScaledVector(d, 30);
    if (r) {
      r.sunIntensity = I; r.sunColor.set(...col);
      if (Math.abs((this._envH ?? -9) - hour) > 0.25) { this._envH = hour; r.invalidateEnvironment?.(); }
    }
  }

  /** Keep the life in this browser (localStorage). */
  save() {
    if (!this.sim || !this.sim.player.alive) return false;
    this.lastSave = this.wall;
    const o = this.sim.serialize();
    o.when = `${this.sim.date().text}, ${this.sim.date().clock}`;
    o.turns = [...this.dialogue.turns.entries()].map(([k, v]) => [k, v.slice(-8)]);
    return writeSave(o);
  }

  dispose(keepScene = false) {
    if (this.started) this.save();
    this.stage.shadowFocus = null;
    for (const [t, ty, fn, o] of this._ls ?? []) t.removeEventListener(ty, fn, o);
    this._ls = [];
    this.walker?.dispose();
    this.interior?.dispose();
    this.people?.dispose();
    for (const el of [this.hud, this.talkEl, this.journalEl, this.modalEl, this.createEl]) el?.remove();
    if (this.lists.sun) this.lists.sun.position.copy(this.lists.sun.target.position).add(new Vector3(-0.55, 0.42, 0.72).normalize().multiplyScalar(30));
    if (this.stage.r) { this.stage.r.sunIntensity = 7.5; this.stage.r.sunColor.set(1.0, 0.87, 0.7); this.stage.r.invalidateEnvironment?.(); }
    void keepScene;
  }
}
