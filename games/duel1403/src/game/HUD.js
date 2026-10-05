import { ARMOUR, SLOTS, ARMOUR_BY_SLOT, PRESETS, loadoutMass } from '../data/armour.js';
import { WEAPONS, WEAPON_ORDER, OFFHAND } from '../data/weapons.js';
import { OPPONENTS, OPPONENT_ORDER, HERALDRY } from '../data/opponents.js';
import { SYSTEMS, GUARDS } from '../data/guards.js';
import { SOURCES, cite } from '../data/sources.js';
import { resolveArmour, locomotionCost } from '../knight/armourProfile.js';
import { JOUSTERS, SADDLES, JOUST_SOURCES } from '../data/joust.js';
import { ESTATES, SOCIETY_SOURCES } from '../data/society.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export const DEFAULT_CONFIG = {
  player: { items: { ...PRESETS.knight.items }, weapon: 'longsword', offhand: 'none', system: 'liechtenauer', heraldry: 'bohemia', name: 'Jindřich' },
  opponent: 'fencer',
  customOpponent: null,
  rules: 'yield',
  camera: 'fighter',
  quality: 'high',
  volume: 0.8,
};

export class HUD {
  constructor(root, handlers) {
    this.root = root;
    this.on = handlers;
    this.config = structuredClone(DEFAULT_CONFIG);
    root.innerHTML = '';
    this.screens = {};
    this._buildHud();
    this._buildTitle();
    this._buildArmoury();
    this._buildPause();
    this._buildResult();
    this._buildCodex();
    this._buildHelp();
    this._buildJoust();
    this._buildRealm();
    this.current = null;
  }

  loadConfig(c) {
    if (!c) return;
    const d = structuredClone(DEFAULT_CONFIG);
    this.config = { ...d, ...c, player: { ...d.player, ...(c.player ?? {}), items: { ...d.player.items, ...(c.player?.items ?? {}) } } };
    // Drop anything unknown (an old save).
    for (const s of SLOTS) if (!ARMOUR[this.config.player.items[s.id]]) this.config.player.items[s.id] = d.player.items[s.id];
    if (!WEAPONS[this.config.player.weapon]) this.config.player.weapon = 'longsword';
    if (!OPPONENTS[this.config.opponent]) this.config.opponent = 'fencer';
    this._renderArmoury();
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== name;
    this.current = name;
  }

  showHud(on) {
    this.hud.hidden = !on;
  }

  // ---------------------------------------------------------------------------
  // Title

  _buildTitle() {
    const el = h(`<div class="screen title-screen ui-interactive">
      <div class="folio">
        <div class="kicker">Království české · Anno Domini MCCCCIII</div>
        <h1 class="title">Zweikampf<span>Bohemia 1403</span></h1>
        <p class="lede">A duel in the lists, fought with the arms, armour and fighting arts of the year 1403 — while King Wenceslas sits captive in Vienna and Sigismund's Hungarians and Cumans ride through the kingdom. Every fighter is a physical body: his muscles move real mass, his armour weighs what it weighed, and a blow does what its energy and the steel in its way allow.</p>
        <div class="actions">
          <button class="primary" data-a="fight">To the lists</button>
          <button class="primary" data-a="joust">The joust</button>
          <button data-a="armoury">Armoury</button>
          <button data-a="help">How to fight</button>
          <button data-a="realm">The realm</button>
          <button data-a="codex">Sources</button>
        </div>
        <label class="vol gfx">Graphics <select data-q><option value="ultra">Ultra (native 4K-ready)</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <p class="fine">Liechtenauer (Hs. 3227a, 1389) · Fiore dei Liberi (1409) · Ms. I.33 (c. 1300) · the Wenceslas Bible (1390s)</p>
      </div>
    </div>`);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'fight') this.on.start(this.config);
      else if (a === 'joust') { this._renderJoust(); this.show('joust'); }
      else if (a === 'armoury') this.show('armoury');
      else if (a === 'help') { this._helpBack = 'title'; this.show('help'); }
      else if (a === 'codex') { this._codexBack = 'title'; this.show('codex'); }
      else if (a === 'realm') this.show('realm');
    });
    this._bindQuality(el);
    this.root.appendChild(el);
    this.screens.title = el;
  }

  // ---------------------------------------------------------------------------
  // Armoury: head to toe, the weapon, and who you fight

  _buildArmoury() {
    const el = h(`<div class="screen armoury-screen ui-interactive" hidden>
      <div class="folio wide">
        <div class="armoury-head">
          <div>
            <div class="kicker">The armoury</div>
            <h2>Arm yourself, head to foot</h2>
          </div>
          <div class="actions"><button data-a="back">Back</button><button class="primary" data-a="fight">To the lists</button></div>
        </div>
        <div class="armoury-grid">
          <section class="col-you">
            <h3>You</h3>
            <div class="presets"></div>
            <div class="slots"></div>
            <div class="weapon-pick"></div>
            <div class="totals"></div>
          </section>
          <section class="col-detail">
            <h3 class="detail-title">—</h3>
            <div class="detail-body"></div>
          </section>
          <section class="col-foe">
            <h3>Your opponent</h3>
            <div class="foes"></div>
            <div class="rules"></div>
          </section>
        </div>
      </div>
    </div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.a === 'back') this.show('title');
      else if (b.dataset.a === 'fight') this.on.start(this.config);
      else if (b.dataset.preset) {
        this.config.player.items = { ...PRESETS[b.dataset.preset].items };
        this._renderArmoury();
        this._detailPreset(b.dataset.preset);
      } else if (b.dataset.foe) {
        this.config.opponent = b.dataset.foe;
        this._renderArmoury();
        this._detailFoe(b.dataset.foe);
      } else if (b.dataset.rules) {
        this.config.rules = b.dataset.rules;
        this._renderArmoury();
      }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.slot) {
        this.config.player.items[t.dataset.slot] = t.value;
        this._detailItem(t.value);
      } else if (t.dataset.k === 'weapon') {
        this.config.player.weapon = t.value;
        if (WEAPONS[t.value].hands === 2) this.config.player.offhand = 'none';
        this.config.player.system = WEAPONS[t.value].systems.find((s) => s !== 'halfsword');
        this._detailWeapon(t.value);
      } else if (t.dataset.k === 'offhand') {
        this.config.player.offhand = t.value;
      } else if (t.dataset.k === 'system') {
        this.config.player.system = t.value;
        this._detailSystem(t.value);
      } else if (t.dataset.k === 'heraldry') {
        this.config.player.heraldry = t.value;
      }
      this._renderArmoury(false);
    });
    el.addEventListener('focusin', (e) => {
      const t = e.target;
      if (t.dataset?.slot) this._detailItem(t.value);
    });
    this.root.appendChild(el);
    this.screens.armoury = el;
    this.arm = el;
    this._renderArmoury();
    this._detailPreset('knight');
  }

  _renderArmoury(full = true) {
    const el = this.arm;
    if (!el) return;
    const c = this.config;
    const P = c.player;
    if (full) {
      el.querySelector('.presets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button data-preset="${k}">${esc(p.name)}</button>`).join('');
      el.querySelector('.slots').innerHTML = SLOTS.map((s) => `
        <label class="slot"><span>${esc(s.name)}<small>${esc(s.native)}</small></span>
          <select data-slot="${s.id}">${ARMOUR_BY_SLOT[s.id].map((id) => `<option value="${id}" ${P.items[s.id] === id ? 'selected' : ''}>${esc(ARMOUR[id].name)}${ARMOUR[id].date ? ' — ' + esc(ARMOUR[id].date) : ''}</option>`).join('')}</select>
        </label>`).join('');
      const W = WEAPONS[P.weapon];
      el.querySelector('.weapon-pick').innerHTML = `
        <label class="slot"><span>Weapon<small>Zbraň · Wehr</small></span>
          <select data-k="weapon">${WEAPON_ORDER.map((id) => `<option value="${id}" ${P.weapon === id ? 'selected' : ''}>${esc(WEAPONS[id].name)} — ${esc(WEAPONS[id].date)}</option>`).join('')}</select></label>
        <label class="slot"><span>Off hand<small>Druhá ruka</small></span>
          <select data-k="offhand" ${W.hands === 2 ? 'disabled' : ''}>${Object.keys(OFFHAND).map((id) => `<option value="${id}" ${P.offhand === id ? 'selected' : ''}>${esc(OFFHAND[id].name)}</option>`).join('')}</select></label>
        <label class="slot"><span>Fighting art<small>Kunst</small></span>
          <select data-k="system">${W.systems.filter((s) => s !== 'halfsword').map((s) => `<option value="${s}" ${P.system === s ? 'selected' : ''}>${esc(SYSTEMS[s].name)}</option>`).join('')}</select></label>
        <label class="slot"><span>Your arms<small>Erb</small></span>
          <select data-k="heraldry">${Object.entries(HERALDRY).map(([k, v]) => `<option value="${k}" ${P.heraldry === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>`;
      el.querySelector('.foes').innerHTML = OPPONENT_ORDER.map((id) => {
        const o = OPPONENTS[id];
        const m = loadoutMass(o.items);
        return `<button class="foe ${c.opponent === id ? 'on' : ''}" data-foe="${id}">
          <b>${esc(o.name)}</b><span>${esc(o.title)}</span>
          <small>${esc(WEAPONS[o.weapon].name)}${o.offhand !== 'none' ? ' & ' + esc(OFFHAND[o.offhand].name.toLowerCase()) : ''} · ${m.toFixed(0)} kg of armour · ${'★'.repeat(Math.round(o.skill * 5))}</small></button>`;
      }).join('');
      el.querySelector('.rules').innerHTML = `<h4>The terms of the duel</h4>
        <div class="seg">
          <button data-rules="yield" class="${c.rules === 'yield' ? 'on' : ''}">To the yield</button>
          <button data-rules="death" class="${c.rules === 'death' ? 'on' : ''}">À outrance</button>
          <button data-rules="blood" class="${c.rules === 'blood' ? 'on' : ''}">First blood</button>
        </div>
        <p class="fine">${c.rules === 'yield' ? 'A judicial combat: it ends when one yields, cannot rise, or dies.' : c.rules === 'death' ? 'No quarter asked: it ends when one cannot fight on.' : 'A friendly bout: the first real wound ends it.'}</p>`;
    }
    // Totals
    const prof = resolveArmour(P.items);
    const cost = locomotionCost(prof);
    const W = WEAPONS[P.weapon];
    const wm = W.parts.reduce((s, p) => s + p.mass, 0) + (P.offhand === 'buckler' ? OFFHAND.buckler.mass : 0);
    const anach = SLOTS.map((s) => ARMOUR[P.items[s.id]]).filter((a) => a.anachronism);
    el.querySelector('.totals').innerHTML = `
      <div class="tot"><b>${prof.total.toFixed(1)} kg</b><span>armour</span></div>
      <div class="tot"><b>${wm.toFixed(1)} kg</b><span>arms</span></div>
      <div class="tot"><b>+${Math.round((cost - 1) * 100)}%</b><span>effort to move</span></div>
      <div class="tot"><b>${Math.round(prof.vision(true) * 100)}%</b><span>sight, visor down</span></div>
      <p class="fine">Effort after Jaquet et al. (2016): 39.8 kg of plate cost 66 % more energy to walk and run. ${anach.map((a) => esc(a.name) + ': ' + esc(a.anachronism)).join(' ')}</p>`;
  }

  _detail(title, body) {
    this.arm.querySelector('.detail-title').textContent = title;
    this.arm.querySelector('.detail-body').innerHTML = body;
  }

  _srcList(ids) {
    if (!ids || !ids.length) return '';
    return `<div class="src"><b>Sources</b>${ids.map((id) => `<p>${esc(SOURCES[id]?.text ?? id)}</p>`).join('')}</div>`;
  }

  _detailItem(id) {
    const a = ARMOUR[id];
    if (!a) return;
    const zones = [...new Set((a.layers ?? []).flatMap((l) => l.zones))];
    this._detail(a.name, `
      <p class="native">${esc(a.native)}${a.date ? ' · <i>' + esc(a.date) + '</i>' : ''}</p>
      <p>${esc(a.description)}</p>
      ${a.anachronism ? `<p class="warn">${esc(a.anachronism)}</p>` : ''}
      <table class="kv">
        <tr><th>Weight</th><td>${a.mass.toFixed(1)} kg</td></tr>
        ${(a.layers ?? []).map((l) => `<tr><th>${esc(l.mat === 'plate' ? `Plate ${l.t} mm` : l.mat === 'pad' ? `Linen, ${l.n} layers` : l.mat)}</th><td>${esc(l.zones.join(', '))}${l.cover < 1 ? ` (${Math.round(l.cover * 100)}% covered)` : ''}${l.visor ? ' — visor' : ''}</td></tr>`).join('')}
        ${a.vision < 1 ? `<tr><th>Sight</th><td>${Math.round(a.vision * 100)}% of the field of view</td></tr>` : ''}
        ${a.breath ? `<tr><th>Breathing</th><td>recovery −${Math.round(a.breath * 100)}%</td></tr>` : ''}
      </table>
      ${zones.length ? '' : '<p class="fine">No protection.</p>'}
      ${this._srcList(a.sources)}`);
  }

  _detailWeapon(id) {
    const w = WEAPONS[id];
    const m = w.parts.reduce((s, p) => s + p.mass, 0);
    this._detail(w.name, `
      <p class="native">${esc(w.native)} · <i>${esc(w.date)}</i></p>
      <p>${esc(w.description)}</p>
      <table class="kv"><tr><th>Type</th><td>${esc(w.type)}</td></tr><tr><th>Mass</th><td>${m.toFixed(2)} kg</td></tr><tr><th>Held</th><td>${w.hands === 2 ? 'two hands' : 'one hand'}</td></tr>
      <tr><th>Arts</th><td>${w.systems.map((s) => esc(SYSTEMS[s].short)).join(', ')}</td></tr></table>
      ${this._srcList(w.sources)}`);
  }

  _detailSystem(id) {
    const s = SYSTEMS[id];
    this._detail(s.name, `<p>${esc(s.description)}</p>
      <ol class="guards">${GUARDS[id].map((g) => `<li><b>${esc(g.name)}</b> <i>${esc(g.translation)}</i><br>${esc(g.text)}</li>`).join('')}</ol>
      ${this._srcList(s.sources)}`);
  }

  _detailPreset(id) {
    const p = PRESETS[id];
    const prof = resolveArmour(p.items);
    this._detail(p.name, `<p>${esc(p.description)}</p>
      <ul class="kitlist">${SLOTS.map((s) => ARMOUR[p.items[s.id]]).filter((a) => a.mass > 0).map((a) => `<li>${esc(a.name)} <small>${a.mass.toFixed(1)} kg</small></li>`).join('')}</ul>
      <p class="fine">${prof.total.toFixed(1)} kg in all.</p>`);
  }

  _detailFoe(id) {
    const o = OPPONENTS[id];
    this._detail(`${o.name}`, `<p class="native">${esc(o.title)}</p><p>${esc(o.blurb)}</p>
      <table class="kv"><tr><th>Weapon</th><td>${esc(WEAPONS[o.weapon].name)}${o.offhand !== 'none' ? ' and ' + esc(OFFHAND[o.offhand].name.toLowerCase()) : ''}</td></tr>
      <tr><th>Armour</th><td>${SLOTS.map((s) => ARMOUR[o.items[s.id]]).filter((a) => a.mass > 0.5).map((a) => esc(a.name)).join(', ') || 'none'}</td></tr>
      <tr><th>Skill</th><td>${'★'.repeat(Math.round(o.skill * 5))}${'☆'.repeat(5 - Math.round(o.skill * 5))}</td></tr></table>
      ${this._srcList(o.sources)}`);
  }

  // ---------------------------------------------------------------------------
  // In-fight HUD

  _buildHud() {
    const el = h(`<div class="hud" hidden>
      <div class="bars">
        <div class="plate you"><div class="pname"></div><div class="meter blood"><i></i></div><div class="meter stamina"><i></i></div><div class="state"></div></div>
        <div class="plate foe"><div class="pname"></div><div class="meter blood"><i></i></div><div class="meter stamina"><i></i></div><div class="state"></div></div>
      </div>
      <div class="guardbox"><b class="gname"></b><span class="gtr"></span><small class="gmode"></small></div>
      <div class="log"></div>
      <div class="callout"></div><div class="subcall"></div>
      <div class="hint">Drag to cut · click to thrust where you click · hold right mouse or Space to parry · WASD move · 1–8 / Q E guards · F half-sword · G wrestle · V visor · C camera</div>
      <button class="pause-btn ui-interactive">II</button>
      <canvas class="trail"></canvas>
    </div>`);
    el.querySelector('.pause-btn').addEventListener('click', () => this.on.pause());
    this.root.appendChild(el);
    this.hud = el;
    this.trailCanvas = el.querySelector('.trail');
    this.logEl = el.querySelector('.log');
  }

  setNames(a, b) {
    this.hud.querySelector('.you .pname').textContent = a;
    this.hud.querySelector('.foe .pname').textContent = b;
  }

  update(you, foe) {
    const set = (sel, k) => {
      const p = this.hud.querySelector(sel);
      p.querySelector('.blood i').style.width = `${Math.max(0, (k.blood - 2.4) / 2.6) * 100}%`;
      p.querySelector('.stamina i').style.width = `${k.stamina}%`;
      const bits = [];
      if (k.state === 'dead') bits.push('dead');
      else if (k.state === 'out') bits.push('senseless');
      else if (k.state === 'down') bits.push('down');
      if (k.yielded) bits.push('yields');
      if (k.bleed > 0.6) bits.push('bleeding');
      if (k.stun > 0.45) bits.push('dazed');
      if (!k.armed) bits.push('disarmed');
      if (k.limb.armR < 0.5 || k.limb.armL < 0.5) bits.push('arm hurt');
      if (k.limb.legR < 0.5 || k.limb.legL < 0.5) bits.push('leg hurt');
      if (k.profile.hasVisor) bits.push(k.visorDown ? 'visor down' : 'visor up');
      p.querySelector('.state').textContent = bits.join(' · ');
    };
    set('.you', you);
    set('.foe', foe);
    const g = you.guard;
    this.hud.querySelector('.gname').textContent = g?.name ?? '';
    this.hud.querySelector('.gtr').textContent = g?.translation ? `— ${g.translation}` : '';
    const ml = you.modeLabel();
    this.hud.querySelector('.gmode').textContent = `${SYSTEMS[you.system]?.short ?? ''}${ml ? ' · ' + ml : ''} · guard ${you.guardIndex + 1}/${you.guards.length}`;
  }

  log(text, kind = '') {
    const line = h(`<div class="line ${kind}">${esc(text)}</div>`);
    this.logEl.prepend(line);
    const max = innerWidth < 760 ? 3 : 5;
    while (this.logEl.children.length > max) this.logEl.lastChild.remove();
    setTimeout(() => line.classList.add('fade'), 6000);
  }

  clearLog() {
    this.logEl.innerHTML = '';
  }

  callout(text, sub = '', ms = 1600) {
    const c = this.hud.querySelector('.callout'), s = this.hud.querySelector('.subcall');
    c.textContent = text;
    s.textContent = sub;
    c.classList.add('show');
    s.classList.toggle('show', !!sub);
    clearTimeout(this._co);
    this._co = setTimeout(() => { c.classList.remove('show'); s.classList.remove('show'); }, ms);
  }

  /** Draws the stroke the player is dragging. */
  drawTrail(trail) {
    const cv = this.trailCanvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== innerWidth * dpr) { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    const now = performance.now();
    const pts = trail.filter((p) => now - p[2] < 350);
    if (pts.length < 2) return;
    g.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = 1 - (now - pts[i][2]) / 350;
      g.strokeStyle = `rgba(245,230,190,${0.55 * a})`;
      g.lineWidth = 2 + 6 * a;
      g.beginPath();
      g.moveTo(pts[i - 1][0], pts[i - 1][1]);
      g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    }
  }

  // ---------------------------------------------------------------------------

  /** The graphics preset selector (title and pause screens share the setting). */
  _bindQuality(el) {
    const sel = el.querySelector('select[data-q]');
    if (!sel) return;
    sel.value = this.config.quality ?? 'high';
    sel.addEventListener('change', () => {
      this.config.quality = sel.value;
      for (const s of this.root.querySelectorAll('select[data-q]')) s.value = sel.value;
      this.on.quality?.(sel.value);
    });
  }

  _buildPause() {
    const el = h(`<div class="screen dim ui-interactive" hidden><div class="folio narrow">
      <h2>Paused</h2>
      <div class="actions col"><button class="primary" data-a="resume">Resume</button><button data-a="help">How to fight</button><button data-a="yield">Yield</button><button data-a="quit">Leave the lists</button></div>
      <label class="vol">Volume <input type="range" min="0" max="1" step="0.05"></label>
      <label class="vol gfx">Graphics <select data-q><option value="ultra">Ultra (native 4K-ready)</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
    </div></div>`);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'resume') this.on.resume();
      else if (a === 'help') { this._helpBack = 'pause'; this.show('help'); }
      else if (a === 'yield') this.on.yieldFight();
      else if (a === 'quit') this.on.quit();
    });
    const vol = el.querySelector('input');
    vol.value = this.config.volume;
    vol.addEventListener('input', () => { this.config.volume = Number(vol.value); this.on.volume(Number(vol.value)); });
    this._bindQuality(el);
    this.root.appendChild(el);
    this.screens.pause = el;
  }

  _buildResult() {
    const el = h(`<div class="screen dim ui-interactive" hidden><div class="folio">
      <div class="kicker">The judgement of the lists</div>
      <h1 class="title small verdict"></h1>
      <p class="lede how"></p>
      <div class="woundcols"></div>
      <div class="actions"><button class="primary" data-a="rematch">Fight again</button><button data-a="armoury">Armoury</button><button data-a="title">Title</button></div>
    </div></div>`);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'rematch') this.on.rematch();
      else if (a === 'armoury') { this.on.quit(); this.show('armoury'); }
      else if (a === 'title') this.on.quit();
    });
    this.root.appendChild(el);
    this.screens.result = el;
  }

  showResult({ won, verdict, how, you, foe }) {
    const el = this.screens.result;
    const v = el.querySelector('.verdict');
    v.textContent = verdict;
    v.classList.toggle('win', won);
    el.querySelector('.how').textContent = how;
    const col = (k) => `<div><h4>${esc(k.name)}</h4><ul>${k.wounds.length ? k.wounds.map((w) => `<li>${esc((w.side ? w.side + ' ' : '') + w.zone)}: ${esc(w.kind)}${w.severity ? ` (${w.severity > 1.1 ? 'deep' : w.severity > 0.5 ? 'serious' : 'light'})` : ''}</li>`).join('') : '<li>unhurt</li>'}</ul>
      <p class="fine">Blood lost: ${((5 - k.blood) * 1000).toFixed(0)} ml · blows struck: ${k.stats.attacks} · parried: ${k.stats.parries}</p></div>`;
    el.querySelector('.woundcols').innerHTML = col(you) + col(foe);
    this.show('result');
  }

  _buildCodex() {
    const el = h(`<div class="screen ui-interactive" hidden><div class="folio wide scroll">
      <div class="armoury-head"><div><div class="kicker">Codex</div><h2>Sources and method</h2></div><div class="actions"><button data-a="back">Back</button></div></div>
      <div class="codex-cols">
        <section>
          <h3>How a blow is judged</h3>
          <p>Each fighter is 13 rigid body segments joined at anatomical joint limits, moved by torque-limited muscles (shoulder 95 N·m, hip 240 N·m, knee 260 N·m). Weapons are rigid bodies with their real mass and balance, held by the hands. Armour adds its weight to the segments it rests on, so an armoured arm is slower to swing and an armoured man harder to stop.</p>
          <p>When a weapon meets a body the physics measures the energy the contact absorbs and how the weapon arrived — edge first (a cut), point first (a thrust), or with a blunt face. The armour at that exact spot is then worked through from the outside in:</p>
          <ul>
            <li><b>Plate</b> stops cuts; most of the blow glances, the rest arrives as a bruise or a concussion. A point goes through only above about 40·t<sup>1.7</sup> J (t in mm): out of reach of a sword thrust on a 2 mm breastplate, within reach of a hammer's beak on thin limb plate.</li>
            <li><b>Mail</b> stops cuts; a narrow point can split riveted rings above about 70 J.</li>
            <li><b>Quilted linen</b> soaks up 0.43·n<sup>1.89</sup> J of a cut — 80 J at 16 layers, 200 J at 26 (Williams) — and about 60 % of that against a point.</li>
          </ul>
          <p>Whatever remains cuts or pierces: wounds bleed by where they are (throat, armpit, groin and the hollow of the knee bleed fast), arms and legs lose strength, a hand that is cut or broken lets go of its weapon. Blunt trauma to the head stuns. Blood loss and stunning bring a man down.</p>
          <p>The gaps are where the period books say they are: the face, under the arms, the palms, the hollows of the knees, between the legs. Mail worn under the plate is what closes them.</p>
        </section>
        <section class="srcs">
          <h3>Sources</h3>
          ${Object.values(SOURCES).map((s) => `<p><b>${esc(s.short)}.</b> ${esc(s.text)}</p>`).join('')}
          <h3>The joust</h3>
          ${Object.values(JOUST_SOURCES).map((s) => `<p><b>${esc(s.short)}.</b> ${esc(s.text)}</p>`).join('')}
        </section>
      </div>
    </div></div>`);
    el.addEventListener('click', (e) => { if (e.target.closest('button')?.dataset.a === 'back') this.show(this._codexBack ?? 'title'); });
    this.root.appendChild(el);
    this.screens.codex = el;
  }

  _buildHelp() {
    const el = h(`<div class="screen ui-interactive" hidden><div class="folio scroll">
      <h2>How to fight</h2>
      <table class="kv keys">
        <tr><th>Cut</th><td>Drag the mouse (or your finger) across the screen <b>in the direction the blade should travel</b>. Drag over the part of him you want to hit. Down-left from high right is a Zornhau; across is a Zwerchhau; up is an Unterhau.</td></tr>
        <tr><th>Thrust</th><td>Click or tap <b>the spot</b> you want the point in — his face, an armpit, the palm of his hand.</td></tr>
        <tr><th>Parry</th><td>Hold the right mouse button, Space or PARRY: your weapon goes to cover the line his blow is coming down. Time it.</td></tr>
        <tr><th>Keys for blows</th><td>U I O · J K L · M , — the key's place is where the blow comes from; K thrusts.</td></tr>
        <tr><th>Move</th><td>W A S D (left stick on touch). Keep your measure: just out of reach, then step in with the blow.</td></tr>
        <tr><th>Guards</th><td>1–8 or Q / E. Liechtenauer: each guard is broken by one master strike — vom Tag by the Zwerchhau, Ochs by the Krumphau, Pflug by the Schielhau, Alber by the Scheitelhau.</td></tr>
        <tr><th>F</th><td>Long sword: take the half-sword (left hand on the blade) — thrust into the gaps of a harness; a swing from here is the Mordschlag with the cross and pommel. Poleaxe: hammer or axe. War hammer: face or beak.</td></tr>
        <tr><th>G</th><td>Wrestle: shove or throw him when you are close. A man on the ground in armour is in trouble.</td></tr>
        <tr><th>V</th><td>Raise or lower your visor: up you see and breathe; down you are safe from a thrust in the face.</td></tr>
        <tr><th>C</th><td>Camera: over the shoulder, from the barrier, through your own helmet.</td></tr>
      </table>
      <p class="fine">Against an unarmoured man, cut. Against plate, cuts are wasted: half-sword thrusts at the gaps, a hammer or poleaxe on the helmet, or a throw and the dagger. Armour is heavy: it tires you, and it slows your arms.</p>
      <div class="actions"><button class="primary" data-a="back">Back</button></div>
    </div></div>`);
    el.addEventListener('click', (e) => { if (e.target.closest('button')?.dataset.a === 'back') this.show(this._helpBack ?? 'title'); });
    this.root.appendChild(el);
    this.screens.help = el;
  }

  // ---------------------------------------------------------------------------
  // Touch controls

  enableTouch(input) {
    const el = h(`<div class="touch">
      <div class="stick ui-interactive"><div class="knob"></div></div>
      <div class="pad ui-interactive">
        <button data-t="parry" class="big">PARRY</button>
        <button data-t="guardPrev">◀ guard</button><button data-t="guardNext">guard ▶</button>
        <button data-t="mode">grip</button><button data-t="shove">wrestle</button>
        <button data-t="visor">visor</button><button data-t="camera">camera</button>
      </div>
      <div class="swipe-hint">swipe to cut · tap to thrust</div>
    </div>`);
    this.hud.appendChild(el);
    this.root.classList.add('touch-ui');
    const stick = el.querySelector('.stick'), knob = el.querySelector('.knob');
    let sid = null, cx = 0, cy = 0;
    stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      stick.setPointerCapture(e.pointerId);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      let x = (e.clientX - cx) / 52, y = (e.clientY - cy) / 52;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
      input.touch.move.x = x;
      input.touch.move.y = -y;
    });
    const end = () => { sid = null; knob.style.transform = ''; input.touch.move.x = 0; input.touch.move.y = 0; };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    for (const b of el.querySelectorAll('.pad button')) {
      const t = b.dataset.t;
      if (t === 'parry') {
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.touch.parry = true; b.classList.add('on'); });
        const off = () => { input.touch.parry = false; b.classList.remove('on'); };
        b.addEventListener('pointerup', off);
        b.addEventListener('pointerleave', off);
        b.addEventListener('pointercancel', off);
      } else {
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const map = { guardPrev: { type: 'guardStep', dir: -1 }, guardNext: { type: 'guardStep', dir: 1 }, mode: { type: 'mode' }, shove: { type: 'shove' }, visor: { type: 'visor' }, camera: { type: 'camera' } };
          input.press(map[t]);
        });
      }
    }
  }
  // ---------------------------------------------------------------------------
  // The joust: pick a challenger and a saddle

  _buildJoust() {
    const el = h(`<div class="screen joust-screen ui-interactive" hidden>
      <div class="folio">
        <div class="kicker">Gestech · the joust of peace</div>
        <h2>The joust</h2>
        <p class="fine">Run at large, as jousts were before the tilt (first recorded in 1429): no barrier, the riders pass left side to left side with the lance across the horse's neck. Coronel-tipped lances of fir are made to break on the little shield (ecranche) on the left breast. A broken lance scores 1, on the helm 2; striking the horse or below the girdle is a foul. You have ${4} courses.</p>
        <h3>Challenger</h3>
        <div class="jlist jfoes"></div>
        <h3>Saddle</h3>
        <div class="jlist jsaddles"></div>
        <p class="fine">Mouse: where your lance should strike him · click or Space: brace as you meet · W/S: spur or rein in · A/D: your line · C: camera.</p>
        <div class="actions"><button class="primary" data-a="ride">Ride into the lists</button><button data-a="back">Back</button></div>
        <p class="fine jsrc"></p>
      </div>
    </div>`);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'ride') this.on.joust?.(this.config);
      else if (a === 'back') this.show('title');
    });
    el.addEventListener('change', (e) => {
      if (e.target.name === 'jfoe') this.config.joustFoe = e.target.value;
      if (e.target.name === 'jsaddle') this.config.joustSaddle = e.target.value;
    });
    el.querySelector('.jsrc').textContent = [JOUST_SOURCES.tilt, JOUST_SOURCES.hohenzeug, JOUST_SOURCES.banda].map((s) => s.short).join(' · ');
    this.root.appendChild(el);
    this.screens.joust = el;
    this.joustEl = el;
  }

  _renderJoust() {
    const el = this.joustEl;
    const foe = this.config.joustFoe ?? 'rozmberk', sad = this.config.joustSaddle ?? 'hohenzeug';
    el.querySelector('.jfoes').innerHTML = JOUSTERS.map((j) => `<label><input type="radio" name="jfoe" value="${j.id}" ${j.id === foe ? 'checked' : ''}><b>${esc(j.name)}</b><small>${esc(j.title)} · arms: ${esc(HERALDRY[j.heraldry]?.name ?? '')} · skill ${Math.round(j.skill * 100)}</small></label>`).join('');
    el.querySelector('.jsaddles').innerHTML = Object.entries(SADDLES).map(([id, s]) => `<label><input type="radio" name="jsaddle" value="${id}" ${id === sad ? 'checked' : ''}><b>${esc(s.name)} · <i>${esc(s.native)}</i></b><small>${esc(s.text)}</small></label>`).join('');
  }

  // ---------------------------------------------------------------------------
  // The realm: estates and ranks of Bohemia in 1403

  _buildRealm() {
    const sure = { attested: 'named in sources of the time', later: 'documented later, projected back', general: 'common to Central Europe' };
    const est = ESTATES.map((e) => `<section class="estate">
        <h3>${esc(e.name)} <small>· ${esc(e.cz)} · ${esc(e.de)}</small></h3>
        <p>${esc(e.text)}</p>
        ${e.rights ? `<p class="fine"><b>Rights:</b> ${e.rights.map(esc).join('; ')}. ${e.duties ? `<b>Owed:</b> ${e.duties.map(esc).join('; ')}.` : ''}</p>` : ''}
        ${e.dress ? `<p class="fine"><b>Dress:</b> ${esc(e.dress)}</p>` : ''}
        ${e.arms ? `<p class="fine"><b>Arms:</b> ${e.arms.map(esc).join('; ')}.</p>` : ''}
        <table class="jtable">${e.members.map((m) => `<tr><td>${m.rank}</td><td><b>${esc(m.name)}</b> <i>${esc(m.cz)}</i></td><td>${esc(m.note)}</td></tr>`).join('')}</table>
        <p class="fine"><i>${esc(sure[e.sureness] ?? '')}</i> · ${e.sources.map((k) => esc(SOCIETY_SOURCES[k]?.short ?? k)).join(' · ')}</p>
      </section>`).join('');
    const el = h(`<div class="screen ui-interactive" hidden><div class="folio wide scroll">
      <div class="armoury-head"><div><div class="kicker">Království české · 1403</div><h2>The realm</h2></div><div class="actions"><button data-a="back">Back</button></div></div>
      <p class="fine">Who stood where in the kingdom in 1403, from the captive king to the lodger in a cottager's house. The number is precedence: who sits higher, who gives way in the street. The town, its people and their conduct will be built on this.</p>
      <div class="realm-cols">${est}</div>
      <h3>Sources</h3>
      ${Object.values(SOCIETY_SOURCES).map((s) => `<p class="fine"><b>${esc(s.short)}.</b> ${esc(s.text)}</p>`).join('')}
    </div></div>`);
    el.addEventListener('click', (e) => { if (e.target.closest('button')?.dataset.a === 'back') this.show('title'); });
    this.root.appendChild(el);
    this.screens.realm = el;
  }
}

export { cite };
