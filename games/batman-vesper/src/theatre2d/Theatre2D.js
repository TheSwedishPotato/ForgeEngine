import { CAST } from '../story/episode1.js';
import { speechDuration } from '../../../../medengine/src/human/Face.js';

/**
 * The illustrated story: the same script as the film, told the way the reference app tells
 * stories. A character stands full height over the place; a dark card carries the line and
 * who speaks it; underneath, "Type what should happen next…" and the suggestions to tap.
 * Pictures are stills rendered by the Med Engine (tools/stills.mjs): painted backgrounds and
 * cut-out portraits in a few moods each.
 */
const STILLS = './stills';
const MOOD = {
  batman: { grim: ['grim', 'cold', 'neutral', 'tired', 'calm'], determined: ['determined', 'angry', 'fury'], worried: ['worried', 'afraid', 'sad', 'pained'] },
  rook: { grim: ['grim', 'cold', 'neutral', 'sad'], fury: ['fury', 'angry', 'determined'], desperate: ['desperate', 'afraid', 'worried', 'pained', 'surprised'] },
  nadia: { smirk: ['smirk', 'neutral', 'calm', 'happy', 'contempt'], determined: ['determined', 'cold', 'angry'], afraid: ['afraid', 'pained', 'sad', 'worried', 'surprised'] },
  cruz: { cold: ['cold', 'neutral', 'calm'], determined: ['determined', 'angry', 'surprised'], worried: ['worried', 'sad', 'afraid'] },
  marrow: { cold: ['cold', 'neutral', 'calm'], contempt: ['contempt', 'smirk', 'angry'], surprised: ['surprised', 'afraid'] },
  kow: { grim: ['grim', 'neutral'], fury: ['fury', 'angry'], pained: ['pained', 'afraid'] },
  dez: { worried: ['worried', 'neutral'], angry: ['angry', 'fury'], afraid: ['afraid', 'desperate', 'pained'] },
  deckhand: { grim: ['grim', 'neutral'], fury: ['fury', 'angry'], pained: ['pained', 'afraid'] },
};
const BG = { cathedral: 'cathedral', 'cathedral:dawn': 'cathedral_dawn', garage: 'garage', garageRoof: 'garageRoof', harbour: 'harbour', acheron: 'acheron' };
const FIGHT_TEXT = {
  takedown: (n) => [`You come out of the dark. One strike to the jaw, one to the ribs: ${n} folds before he knows what hit him.`],
  combo: (n, ok) => ok ? [`${n} swings first. You aren't there. Two blows, an elbow, and the concrete takes him.`] : [`${n} lands one — your ribs flare white — then you land three.`],
  batarang: (n, ok) => ok ? [`The batarang leaves your hand and rings off the gun. ${n} stares at his empty fingers.`] : ['The batarang sparks off a pillar. Too wide.'],
  disarm: (n) => [`You take ${n}'s wrist, turn it until the gun drops, and kick it into the dark.`],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; parent?.appendChild(e); return e; };

export class Theatre2D {
  constructor(root, { audio } = {}) {
    this.audio = audio;
    this.root = root;
    root.innerHTML = `
      <div class="st-bg"></div><div class="st-bg2"></div><div class="st-vignette"></div>
      <img class="st-char" alt="" />
      <div class="st-pill"><span class="st-icon"></span><span class="st-count">100</span></div>
      <div class="st-meter"></div>
      <div class="st-card"><button class="st-more" title="Menu">⋮</button><div class="st-who"></div><div class="st-text"></div></div>
      <div class="st-input">
        <div class="st-field"><textarea rows="2" placeholder="Type what should happen next..."></textarea><button class="st-send" aria-label="Send">➤</button></div>
        <div class="st-chips"></div>
      </div>
      <div class="st-title"></div>`;
    this.$ = (s) => root.querySelector(s);
    this.bg = this.$('.st-bg'); this.bg2 = this.$('.st-bg2'); this.char = this.$('.st-char');
    this.who = this.$('.st-who'); this.text = this.$('.st-text'); this.card = this.$('.st-card');
    this.chips = this.$('.st-chips'); this.ta = this.$('textarea'); this.send = this.$('.st-send');
    this.count = this.$('.st-count'); this.meterEl = this.$('.st-meter'); this.titleEl = this.$('.st-title');
    this.speed = 1;
    this.runner = null;
    this.setName = null;
    this.focus = null;
    this._advance = null;
    this.card.addEventListener('click', () => this._advance?.());
    this.$('.st-more').addEventListener('click', (e) => { e.stopPropagation(); this.onMenu?.(); });
    this.send.addEventListener('click', () => this._submit?.());
    this.ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit?.(); } });
    // free text typed while nobody is asking: ignored until a choice comes
    this._idleInput();
  }

  _idleInput() { this.ta.disabled = true; this.ta.placeholder = 'Type what should happen next...'; this.send.disabled = true; }

  // ------------------------------------------------------------- pictures
  _setBg(key) {
    const url = `${STILLS}/bg_${key}.webp`;
    if (this._bgKey === url) return;
    this._bgKey = url;
    // cross-fade
    this.bg2.style.backgroundImage = this.bg.style.backgroundImage;
    this.bg2.style.opacity = '1';
    this.bg.style.backgroundImage = `url(${url})`;
    requestAnimationFrame(() => { this.bg2.style.transition = 'opacity .8s'; this.bg2.style.opacity = '0'; });
  }

  _portrait(who, emo) {
    const moods = MOOD[who];
    if (!moods) return;
    let pick = Object.keys(moods)[0];
    if (emo) for (const [k, list] of Object.entries(moods)) if (list.includes(emo)) { pick = k; break; }
    const url = `${STILLS}/${who}_${pick}.webp`;
    if (this.char.dataset.src === url && this.char.style.opacity !== '0') return;
    this.char.dataset.src = url;
    this.char.style.opacity = '0';
    const img = new Image();
    img.onload = () => { this.char.src = url; this.char.style.opacity = '1'; };
    img.onerror = () => { this.char.style.opacity = '0'; };
    img.src = url;
    this.focus = who;
  }

  // ------------------------------------------------------------- scene API
  async chapterCard(id, title, sub) {
    const k = id === 'prologue' ? 'PROLOGUE' : id === 'epilogue' ? 'EPILOGUE' : id.startsWith('night') ? 'NIGHT' : 'CHAPTER ' + id.replace('ch', '');
    this.titleEl.innerHTML = `<div><small>${k}</small><b>${title}</b><span>${sub ?? ''}</span></div>`;
    this.titleEl.classList.add('on');
    this.char.style.opacity = '0';
    await sleep(2600 / this.speed);
    this.titleEl.classList.remove('on');
  }
  async stage(name, o = {}) { this.setName = name; this._setBg(BG[name + (o.time ? ':' + o.time : '')] ?? BG[name] ?? 'garageRoof'); }
  place() {} weather() {} space() {} kick() {} sting() {} strike() {}
  act(who, spec) { if (spec?.setVisible === false && this.focus === who) this.char.style.opacity = '0'; return Promise.resolve(); }
  cut(spec) {
    if (spec.still === 'garage_breaker' || spec.still === 'dez_dark' || spec.still === 'kow_dark') this._setBg('garage_dark');
    if (spec.on && MOOD[spec.on] && spec.type !== 'ews' && spec.type !== 'insert') this._portrait(spec.on);
    if (spec.type === 'ews' || spec.type === 'insert') this.char.style.opacity = '0';
  }
  lights(m) { if (m !== 'on') this._setBg('garage_dark'); }
  music(m, i) { this.audio?.music(m, i); }
  sfx(n) { this.audio?.sfx(n); }
  ambience(a) { this.audio?.ambience(a); }
  wait(s) { return sleep((s * 1000) / this.speed); }
  objective(t) { if (t) this._note('Objective: ' + t); }
  notify(t) { if (t) this._note(t); }
  thinking(on, text = 'Claude is thinking…') { this.ta.placeholder = on ? text : 'Type what should happen next...'; this.card.classList.toggle('thinking', !!on); }
  fade() { return Promise.resolve(); }
  meter(m) {
    if (!m.show) { this.meterEl.classList.remove('on'); return; }
    this.meterEl.innerHTML = `${m.name} <b>${Math.round(m.value)}%</b> <small>${m.label}</small>`;
    this.meterEl.classList.add('on');
  }
  _note(t) {
    const n = el('div', 'st-note', this.root); n.textContent = t;
    setTimeout(() => n.classList.add('on'), 20);
    setTimeout(() => { n.classList.remove('on'); setTimeout(() => n.remove(), 500); }, 3200);
  }

  /** A line: the speaker in the card, their picture if they have one, typed on; tap to go on. */
  async line(who, text, o = {}) {
    const c = CAST[who];
    if (MOOD[who]) this._portrait(who, o.emo);
    this.who.textContent = (c?.name ?? who).toUpperCase() + (c?.radio || o.radio ? ' · RADIO' : '');
    this.who.style.color = '';
    this.card.classList.toggle('radio', !!(c?.radio || o.radio));
    await this._type(text, speechDuration(text, c?.voice?.rate ?? 1));
    this.count.textContent = String(this.runner?.state.code ?? 100);
  }

  async caption(text) {
    this.who.textContent = 'VESPER';
    this.card.classList.remove('radio');
    await this._type(text, 2.6);
  }

  async _type(text, dur) {
    this.text.textContent = '';
    let skip = false;
    this._advance = () => { skip = true; };
    const step = Math.max(8, Math.min(28, (dur * 1000) / Math.max(1, text.length))) / this.speed;
    for (let i = 1; i <= text.length && !skip; i++) { this.text.textContent = text.slice(0, i); await sleep(step); }
    this.text.textContent = text;
    // hold for reading, or until tapped
    let go = false;
    this._advance = () => { go = true; };
    const t0 = performance.now(), hold = (900 + text.length * 32) / this.speed;
    while (!go && performance.now() - t0 < hold) await sleep(40);
    this._advance = null;
  }

  // ------------------------------------------------------------- choices
  choose(spec) {
    return new Promise((resolve) => {
      this.chips.innerHTML = '';
      if (spec.prompt) { this.who.textContent = 'WHAT NOW?'; this.text.textContent = spec.prompt; }
      const done = (r) => { this.chips.innerHTML = ''; this._submit = null; this.ta.value = ''; this._idleInput(); resolve(r); };
      for (const o of spec.options) {
        const b = el('button', 'st-chip' + (o.danger ? ' danger' : ''), this.chips);
        b.textContent = o.label;
        b.onclick = () => done({ id: o.id });
      }
      if (spec.allowFree) {
        this.ta.disabled = false; this.send.disabled = false;
        this.ta.placeholder = spec.converse ? `Say anything to ${CAST[spec.converseWho]?.name ?? 'them'}...` : 'Type what should happen next...';
        this._submit = () => { const v = this.ta.value.trim(); if (v) done({ free: v }); };
      }
    });
  }

  async qte(spec) {
    // a beat of action: tap the chip (or press its key) before the bar runs out
    this.who.textContent = 'NOW';
    this.text.textContent = spec.label + '!';
    return new Promise((resolve) => {
      this.chips.innerHTML = '';
      const b = el('button', 'st-chip qte', this.chips);
      b.innerHTML = `<span>${spec.label}</span><i></i>`;
      const bar = b.querySelector('i');
      const ms = (spec.window ?? 1.2) * 1600 * spec.keys.length;
      const t0 = performance.now();
      let raf;
      const end = (ok) => { cancelAnimationFrame(raf); removeEventListener('keydown', onKey); this.chips.innerHTML = ''; this.audio?.sfx(ok ? 'success' : 'fail'); resolve(ok); };
      const onKey = (e) => { if (e.key.toUpperCase() === spec.keys[0] || (spec.keys[0] === 'SPACE' && e.code === 'Space')) end(true); };
      b.onclick = () => end(true);
      addEventListener('keydown', onKey);
      const tick = () => { const k = (performance.now() - t0) / ms; bar.style.width = `${Math.max(0, 1 - k) * 100}%`; if (k >= 1) end(false); else raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    });
  }

  async fight(kind, who, ok) {
    this.audio?.sfx('punch');
    const name = CAST[who]?.name ?? who;
    for (const t of (FIGHT_TEXT[kind] ?? FIGHT_TEXT.takedown)(name, ok)) { this.who.textContent = 'ACTION'; await this._type(t, 2.5); }
  }

  async explore(spec, visit) {
    const left = new Set(spec.spots.map((s) => s.id));
    for (;;) {
      const opts = spec.spots.filter((s) => left.has(s.id)).map((s) => ({ id: s.id, label: 'Search: ' + s.label }));
      if (spec.need.every((n) => !left.has(n))) opts.push({ id: '__go', label: 'Move on' });
      if (!opts.length) return;
      const r = await this.choose({ prompt: spec.objective, options: opts });
      if (r.id === '__go') return;
      const s = spec.spots.find((x) => x.id === r.id);
      left.delete(s.id);
      await visit(s);
    }
  }

  async special(name, args) {
    const T = {
      glide: ['You stand. The cape opens like a held breath.', 'Then you fall — and the wind takes you over Vesper, the streets a burning grid below.'],
      boat: [args?.late ? 'The Acheron is already past the cranes. You open the Nightjar\'s throttles all the way.' : 'The Nightjar tears across the harbour, the Acheron\'s lights ahead in the rain.', 'Every swell is a wall. You steer into them.'],
      board: ['The grapple bites the Acheron\'s rail. The sea drops away beneath you.'],
    }[name] ?? [];
    this.char.style.opacity = '0';
    for (const t of T) { this.who.textContent = 'VESPER'; await this._type(t, 2.8); }
  }

  async headline(h, by) {
    const p = el('div', 'st-paper', this.root);
    p.innerHTML = `<div class="mast">The Vesper Ledger</div><h2></h2><p></p>`;
    p.querySelector('h2').textContent = h; p.querySelector('p').textContent = by;
    setTimeout(() => p.classList.add('on'), 20);
    await sleep(4800 / this.speed);
    p.classList.remove('on'); setTimeout(() => p.remove(), 800);
  }

  async endCard() {
    this.titleEl.innerHTML = '<div><small>END OF EPISODE 1</small><b>FIRST NIGHT</b><span>The city remembers what you did.</span></div>';
    this.titleEl.classList.add('on');
    await sleep(3200 / this.speed);
    this.titleEl.classList.remove('on');
  }
}
