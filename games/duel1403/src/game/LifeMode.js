import { Vector3 } from 'three';
import { LifeSim } from '../life/LifeSim.js';
import { Dialogue } from '../life/Dialogue.js';
import { Walker } from '../life/Walker.js';
import { STARTS, GOODS, LAWS, LIFE_SOURCES, ARMY_RANK, fmtMoney, NEEDS, RUMOURS } from '../life/data.js';
import { BUILDING, BUILDINGS, PLACES, TOWN_NAME, groundY } from '../world/town.js';
import { PeopleMesh } from '../render/PeopleMesh.js';
import { Interior } from '../render/Interior.js';
import { allRanks } from '../data/society.js';

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
 * Z sleep, T let an hour pass, X drill (soldiers), J journal, Esc menu.
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
      <div class="actions"><button class="primary" data-a="begin">Begin</button><button data-a="back">Back</button></div>
    </div></div>`);
    el.addEventListener('change', () => {
      const female = el.querySelector('input[name=lsex]:checked').value === 'f';
      for (const l of el.querySelectorAll('.lstarts label')) { const off = female && l.dataset.sex === 'male'; l.querySelector('input').disabled = off; l.style.opacity = off ? 0.45 : 1; }
      if (el.querySelector('input[name=lstart]:checked')?.disabled) el.querySelector('input[name=lstart]:not(:disabled)').checked = true;
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'back') this.onExit?.();
      if (a === 'begin') {
        const start = STARTS.find((s) => s.id === el.querySelector('input[name=lstart]:checked').value);
        this.begin({ name: el.querySelector('.lname').value.trim() || 'Jan', sex: el.querySelector('input[name=lsex]:checked').value, start });
      }
    });
    this.root.appendChild(el);
    this.createEl = el;
  }

  begin({ name, sex, start, seed = 1403 }) {
    this.createEl?.remove();
    this.sim = new LifeSim({ seed, start, name, sex });
    this.dialogue = new Dialogue(this.sim);
    this.people = new PeopleMesh(this.stage.scene, this.sim);
    this._buildPlayer();
    this._buildHud();
    this._bind();
    this.sim.on((e) => this._event(e));
    this.started = true;
    const P = this.sim.player;
    this.camYaw = P.yaw;
    this.log(`You are ${P.name}, ${start.name.toLowerCase()}. ${start.text}`, 'info');
    this.log('E talk to someone or go through a door · J journal · Esc menu.', 'info');
    this.dialogue.ready.then(() => { this.hud.querySelector('.lmode').textContent = this.dialogue.mode === 'claude' ? 'people answer through Claude' : 'people answer from a script (Claude not available here)'; });
  }

  _buildPlayer() {
    const P = this.sim.player;
    this.walker?.dispose();
    this.walker = new Walker({ name: P.name, items: P.dress, colors: P.colors, female: P.sex === 'f', height: P.sex === 'f' ? 1.62 : 1.75, quality: this.quality });
    this.stage.scene.add(this.walker.mesh);
  }

  // --- HUD -------------------------------------------------------------------------------------

  _buildHud() {
    const el = h(`<div class="hud life-hud">
      <div class="lclock"><b class="ldate"></b><span class="ltime"></span><small class="lplace"></small></div>
      <div class="lneeds"></div>
      <div class="lpurse"></div>
      <div class="log"></div>
      <div class="lprompt"></div>
      <div class="callout"></div><div class="subcall"></div>
      <div class="lbar ui-interactive">
        <button data-k="e">E · talk / door</button><button data-k="f">F · eat</button><button data-k="q">Q · drink</button><button data-k="r">R · relieve</button><button data-k="z">Z · sleep</button><button data-k="t">T · wait 1 h</button><button data-k="x">X · drill</button><button data-k="j">J · journal</button>
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
  }

  /** People within talking distance: inside, by their places in the room. */
  _nearby(r = 2.4) {
    const s = this.sim, P = s.player;
    if (!P.inside || !this.interior) return s.nearby(r);
    return s.people.filter((p) => p.alive && p.agent.inside === P.inside && !p.agent.route.length)
      .map((p) => { const sp = this.interior.spotOf(p); return { p, d: Math.hypot(sp.x - P.x, sp.z - P.z) }; })
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
      default: break;
    }
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
    const chips = ['God give you good day.', `My name is ${P.name}.`, 'What news?', 'What do you sell?', 'Is there work for me?', 'I want to serve in the garrison.', 'Where is the tavern?', 'Farewell.'];
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
      const A = r.action.type;
      if (A === 'leave') setTimeout(() => this.closeTalk(), 1600);
      if (A === 'directions') { const pl = PLACES[r.action.place] ?? BUILDING[r.action.place]; if (pl) this.marker = { x: pl.x ?? pl.door.x, z: pl.z ?? pl.door.z, name: pl.name, until: this.wall + 40 }; }
      if (A === 'call_watch') this.log(`${p.name} shouts for the watch!`, 'hurt');
      if (A === 'enlist' && r.action.ok) this.callout('You serve', 'the captain of Skalice castle', 2600);
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
      case 'resist': this.log(e.text, 'hurt big'); this._duel(e.by, 'arrest'); break;
      case 'death': this._death(e.cause); break;
      default: break;
    }
  }

  _stopped(e) {
    const s = this.sim, P = s.player, open = P.crimes.filter((c) => !c.settled);
    const fine = open.reduce((sum, c) => sum + (LAWS.find((l) => l.id === c.law)?.fine ?? 0), 0) || (e.reason === 'curfew' ? 12 : 0);
    const why = e.reason === 'curfew' && !open.length ? `${e.by.name} of the watch stops you: "It is after the curfew bell. Who are you, and where are you going without a light?"` : `${e.by.name} of the watch takes you by the arm: "You'll answer to the rychtář for ${open.map((c) => LAWS.find((l) => l.id === c.law)?.name.toLowerCase()).join(', ')}."`;
    const opts = [];
    if (e.reason === 'curfew' && !open.length) opts.push(['Explain yourself', () => s.resolveStop('explain')]);
    opts.push([`Pay ${fmtMoney(fine)}`, () => s.resolveStop(P.money >= fine ? 'pay' : 'submit')], ['Go quietly', () => s.resolveStop('submit')], ['Resist', () => s.resolveStop('resist')]);
    this._confirm(why, opts);
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
      const P = this.sim.player;
      if (result.won) { this.log(`You beat ${npc.name}.`, 'good'); npc.hurt = 1; if (why === 'arrest') P.wanted = 3; }
      else { P.health = Math.max(5, P.health - 45); this.log(`${npc.name} beats you senseless.`, 'hurt big'); if (why === 'arrest') { this.sim.pendingStop = { by: npc, reason: 'wanted' }; this.sim.resolveStop('submit'); } }
      if (result.killed) { npc.alive = false; this.sim.crime('killing', { victim: npc }); }
    });
  }

  _death(cause) {
    const P = this.sim.player;
    this._confirm(`${P.name} is dead${cause === 'thirst' ? ' of thirst' : cause === 'hunger' ? ' of hunger' : ''}. ${P.army ? 'The company buries you outside the churchyard wall.' : 'The sexton rings the bell for you.'} Days lived in ${TOWN_NAME}: ${Math.floor(this.sim.t / 24)}.`, [['Begin again', () => this.restart()], ['Title', () => this.onExit?.()]]);
  }

  _menu() {
    this._confirm(`${this.sim.situation()}.`, [['Back to town', () => {}], ['Journal', () => this._journal()], ['Begin again', () => this.restart()], ['Leave to the title', () => this.onExit?.()]]);
  }

  restart() {
    this.dispose(true);
    this.started = false;
    this._buildCreation();
  }

  _journal() {
    const s = this.sim, P = s.player;
    const met = s.people.filter((p) => p.memory.length || P.knownNames.has(p.id));
    const J = this.journalEl.querySelector('.ljournal');
    J.innerHTML = `<div class="armoury-head"><div><div class="kicker">${esc(s.situation())}</div><h2>${esc(P.name)}</h2></div><div class="actions"><button data-a="close">Close</button></div></div>
      <div class="realm-cols">
        <section class="estate"><h3>You</h3><p>${esc(P.startName)}${P.army ? ` · ${esc(ARMY_RANK[P.army.rank].name)} of the garrison, ${P.army.days} days' service` : ''}. Purse: ${esc(fmtMoney(P.money))}. Health ${P.health.toFixed(0)}. Reputation ${P.reputation}.</p>
          <table class="jtable">${Object.entries(P.skills).map(([k, v]) => `<tr><td>${Math.round(v)}</td><td>${esc(k)}</td></tr>`).join('')}</table>
          ${P.army ? `<p class="fine">Duties: drill in the yard 5:30–8, watch at the gate 8–12, drill 13–16. Pay at 18:00. Absences are docked. Promotion comes with service and skill: ${esc(Object.values(ARMY_RANK).map((r) => r.name).join(' → '))}.</p>` : `<p class="fine">The captain, Hereš of Vrchy, takes on men in the castle yard after noon or in the tavern of an evening.</p>`}
        </section>
        <section class="estate"><h3>People you know</h3>${met.length ? `<table class="jtable">${met.map((p) => `<tr><td>${p.attitude}</td><td><b>${esc(P.knownNames.has(p.id) ? p.fullName : p.title)}</b><br><small>${esc(p.title)} · ${esc(p.memory.slice(-2).join('; '))}</small></td></tr>`).join('')}</table>` : '<p class="fine">Nobody yet.</p>'}</section>
        <section class="estate"><h3>The law of ${esc(TOWN_NAME)}</h3>${LAWS.map((l) => `<p class="fine"><b>${esc(l.name)}.</b> ${esc(l.text)} <i>(${esc(l.sureness)})</i></p>`).join('')}</section>
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
      this._move(dt);
      s.update(dt);
    }
    // where the player stands, and the people around
    const speed = this._speed ?? 0;
    const posture = P.sleepingUntil > s.t ? 'lie' : 'stand';
    this.walker.update(dt, { x: P.x, y: P.y, z: P.z, yaw: P.yaw, speed, posture, gesture: !!this.talking });
    this.people.update(dt, this.stage.camera, this.interior ? this.interior : null);
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

  /** Walls: keep out of buildings (their footprints), and on the map. */
  _collide(x, z) {
    for (const b of BUILDINGS) {
      if (b.kind === 'hall' || b.kind === 'barracks') continue;
      const hw = b.w / 2 + 0.3, hd = b.d / 2 + 0.3;
      const lx = x - b.x, lz = z - b.z;
      if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
        const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
        if (px < pz) x = b.x + Math.sign(lx) * hw; else z = b.z + Math.sign(lz) * hd;
      }
    }
    // the castle stands on its rock: keep to the gate and the yard
    return { x: Math.max(-140, Math.min(140, x)), z: Math.max(-60, Math.min(250, z)) };
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

  dispose(keepScene = false) {
    for (const [t, ty, fn, o] of this._ls ?? []) t.removeEventListener(ty, fn, o);
    this._ls = [];
    this.walker?.dispose();
    this.interior?.dispose();
    for (const l of Object.values(this.people?.parts ?? {})) l.group.removeFromParent();
    for (const el of [this.hud, this.talkEl, this.journalEl, this.modalEl, this.createEl]) el?.remove();
    if (this.lists.sun) this.lists.sun.position.copy(this.lists.sun.target.position).add(new Vector3(-0.55, 0.42, 0.72).normalize().multiplyScalar(30));
    if (this.stage.r) { this.stage.r.sunIntensity = 7.5; this.stage.r.sunColor.set(1.0, 0.87, 0.7); this.stage.r.invalidateEnvironment?.(); }
    void keepScene;
  }
}
