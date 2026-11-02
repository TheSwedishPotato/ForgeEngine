/**
 * The film's interface, drawn over the canvas: subtitles, choices (with timers and free text),
 * QTE prompts, the negotiation meter, objectives, notifications, chapter cards, captions, the
 * newspaper, the flowchart, and the "Claude is writing" indicator. Detroit-style restraint:
 * thin type, cold white and blue, everything fades.
 */
const CSS = `
:root { --ui: #e9f1ff; --dim: rgba(233,241,255,.55); --accent: #6fb7ff; --warn: #ff6b6b; --good: #7dffb2; --panel: rgba(8,12,18,.62); }
#ov { position: fixed; inset: 0; pointer-events: none; font-family: "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: var(--ui); z-index: 10; }
#ov * { box-sizing: border-box; }
.ov-sub { position: absolute; left: 50%; bottom: 13vh; transform: translateX(-50%); width: min(1100px, 86vw); text-align: center; font-size: clamp(16px, 1.55vw, 26px); line-height: 1.35; text-shadow: 0 2px 6px #000, 0 0 2px #000; opacity: 0; transition: opacity .25s; }
.ov-sub.on { opacity: 1; }
.ov-sub b { font-weight: 600; letter-spacing: .02em; margin-right: .45em; }
.ov-sub.radio span { font-style: italic; }
.ov-sub.big { font-size: clamp(18px, 1.9vw, 30px); }
.ov-cap { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); font-size: clamp(18px, 2vw, 32px); letter-spacing: .32em; text-transform: uppercase; font-weight: 300; opacity: 0; transition: opacity 1.2s; text-align: center; text-shadow: 0 0 20px #000; max-width: 80vw; }
.ov-cap.on { opacity: 1; }
.ov-obj { position: absolute; left: 4vw; top: 14vh; font-size: 13px; letter-spacing: .2em; text-transform: uppercase; opacity: 0; transition: opacity .6s; }
.ov-obj.on { opacity: .9; }
.ov-obj i { display: block; font-style: normal; color: var(--accent); font-size: 11px; margin-bottom: 6px; }
.ov-notes { position: absolute; right: 3vw; top: 14vh; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.ov-note { background: var(--panel); border-left: 2px solid var(--accent); padding: 8px 14px; font-size: 13px; letter-spacing: .06em; opacity: 0; transform: translateX(20px); transition: all .4s; }
.ov-note.on { opacity: 1; transform: none; }
.ov-note.down { border-color: var(--warn); } .ov-note.up { border-color: var(--good); } .ov-note.intel { border-color: #f2d38a; }
.ov-choice { position: absolute; left: 50%; bottom: 18vh; transform: translateX(-50%); display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; width: min(980px, 92vw); pointer-events: auto; opacity: 0; transition: opacity .3s; }
.ov-choice.on { opacity: 1; }
.ov-choice .prompt { grid-column: 1 / -1; text-align: center; font-size: 14px; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); margin-bottom: 4px; }
.ov-opt { background: var(--panel); border: 1px solid rgba(233,241,255,.18); padding: 12px 16px; font-size: clamp(14px, 1.15vw, 18px); cursor: pointer; display: flex; gap: 12px; align-items: center; transition: border-color .15s, background .15s; backdrop-filter: blur(6px); color: var(--ui); text-align: left; font-family: inherit; }
.ov-opt:hover, .ov-opt:focus { border-color: var(--accent); background: rgba(30,60,100,.55); outline: none; }
.ov-opt kbd { font: 600 12px/1 inherit; border: 1px solid var(--dim); border-radius: 50%; width: 24px; height: 24px; display: grid; place-items: center; flex: none; }
.ov-opt small { display: block; color: var(--dim); font-size: 12px; margin-top: 3px; }
.ov-opt.danger { border-color: rgba(255,107,107,.5); }
.ov-free { grid-column: 1 / -1; display: flex; gap: 8px; }
.ov-free input { flex: 1; background: rgba(8,12,18,.72); border: 1px solid rgba(233,241,255,.25); color: var(--ui); padding: 12px 14px; font: inherit; font-size: 15px; outline: none; }
.ov-free input:focus { border-color: var(--accent); }
.ov-free button { background: var(--accent); color: #031020; border: 0; padding: 0 18px; font: 600 14px inherit; cursor: pointer; }
.ov-timer { grid-column: 1 / -1; height: 2px; background: rgba(233,241,255,.15); }
.ov-timer div { height: 100%; background: var(--ui); width: 100%; }
.ov-qte { position: absolute; left: 50%; top: 58%; transform: translate(-50%,-50%); display: flex; gap: 18px; opacity: 0; transition: opacity .15s; }
.ov-qte.on { opacity: 1; }
.ov-key { width: 74px; height: 74px; border-radius: 50%; border: 2px solid var(--ui); display: grid; place-items: center; font: 600 22px inherit; position: relative; background: rgba(8,12,18,.4); }
.ov-key svg { position: absolute; inset: -6px; width: 86px; height: 86px; transform: rotate(-90deg); }
.ov-key.done { border-color: var(--good); color: var(--good); }
.ov-key.miss { border-color: var(--warn); color: var(--warn); }
.ov-qte-label { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 14px; font-size: 12px; letter-spacing: .3em; text-transform: uppercase; white-space: nowrap; }
.ov-meter { position: absolute; right: 4vw; top: 22vh; text-align: right; opacity: 0; transition: opacity .5s; }
.ov-meter.on { opacity: 1; }
.ov-meter .n { font-size: 54px; font-weight: 200; letter-spacing: .02em; }
.ov-meter .l { font-size: 11px; letter-spacing: .25em; text-transform: uppercase; color: var(--dim); }
.ov-meter .d { font-size: 14px; height: 18px; }
.ov-card { position: absolute; inset: 0; background: #000; display: grid; place-items: center; opacity: 0; transition: opacity 1s; text-align: center; }
.ov-card.on { opacity: 1; }
.ov-card .k { font-size: 12px; letter-spacing: .5em; color: var(--accent); }
.ov-card .t { font-size: clamp(34px, 5vw, 76px); font-weight: 200; letter-spacing: .25em; margin: 18px 0 14px; }
.ov-card .s { font-size: 14px; letter-spacing: .2em; color: var(--dim); }
.ov-fade { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity 1s; }
.ov-think { position: absolute; left: 50%; bottom: 8vh; transform: translateX(-50%); font-size: 12px; letter-spacing: .25em; text-transform: uppercase; color: var(--accent); opacity: 0; transition: opacity .3s; }
.ov-think.on { opacity: .9; animation: pulse 1.4s infinite; }
@keyframes pulse { 50% { opacity: .35; } }
.ov-paper { position: absolute; left: 50%; top: 50%; width: min(760px, 86vw); transform: translate(-50%,-50%) rotate(-1.2deg) scale(.96); background: #ece6d6; color: #16130f; padding: 28px 36px 34px; box-shadow: 0 30px 80px #000; opacity: 0; transition: all 1s; font-family: Georgia, "Times New Roman", serif; }
.ov-paper.on { opacity: 1; transform: translate(-50%,-50%) rotate(-1.2deg) scale(1); }
.ov-paper .mast { font: 900 44px/1 Georgia, serif; text-align: center; border-bottom: 3px double #16130f; padding-bottom: 8px; letter-spacing: .04em; }
.ov-paper .date { font-size: 11px; text-transform: uppercase; letter-spacing: .2em; display: flex; justify-content: space-between; border-bottom: 1px solid #16130f; padding: 6px 0; }
.ov-paper h2 { font: 900 clamp(24px, 3vw, 40px)/1.05 Georgia, serif; margin: 18px 0 10px; }
.ov-paper p { font-size: 14px; font-style: italic; margin: 0; }
.ov-flow { position: absolute; inset: 0; background: rgba(2,4,8,.94); pointer-events: auto; overflow: auto; padding: 6vh 6vw; opacity: 0; transition: opacity .6s; }
.ov-flow.on { opacity: 1; }
.ov-flow h1 { font-weight: 200; letter-spacing: .3em; font-size: 28px; margin: 0 0 6px; }
.ov-flow .ch { margin: 26px 0 8px; font-size: 12px; letter-spacing: .35em; color: var(--accent); }
.ov-flow .node { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 6px 0 6px 12px; }
.ov-flow .node .p { width: 100%; font-size: 11px; color: var(--dim); letter-spacing: .1em; }
.ov-flow .opt { border: 1px solid rgba(233,241,255,.2); padding: 6px 10px; font-size: 13px; }
.ov-flow .opt.sel { border-color: var(--accent); background: rgba(111,183,255,.15); }
.ov-flow .opt.lock { color: rgba(233,241,255,.3); border-style: dashed; }
.ov-flow .stats { display: flex; gap: 28px; margin: 18px 0; flex-wrap: wrap; }
.ov-flow .stats div { font-size: 12px; letter-spacing: .15em; color: var(--dim); } .ov-flow .stats b { display: block; color: var(--ui); font-size: 20px; font-weight: 300; letter-spacing: .05em; }
.ov-flow .btns { display: flex; gap: 12px; margin-top: 30px; flex-wrap: wrap; }
.ov-btn { background: transparent; color: var(--ui); border: 1px solid var(--ui); padding: 12px 22px; font: 500 14px inherit; letter-spacing: .2em; text-transform: uppercase; cursor: pointer; pointer-events: auto; }
.ov-btn:hover { background: var(--ui); color: #000; }
.ov-btn.primary { background: var(--accent); border-color: var(--accent); color: #021120; }
.ov-hint { position: absolute; left: 50%; bottom: 5vh; transform: translateX(-50%); font-size: 12px; letter-spacing: .2em; color: var(--dim); text-transform: uppercase; opacity: 0; transition: opacity .4s; }
.ov-hint.on { opacity: 1; }
.ov-spot { position: absolute; transform: translate(-50%,-50%); font-size: 12px; letter-spacing: .15em; text-transform: uppercase; white-space: nowrap; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ov-spot .dot { width: 14px; height: 14px; border: 2px solid var(--accent); border-radius: 50%; }
.ov-spot.near .dot { background: var(--accent); }
.ov-spot.done { opacity: .35; }
@media (max-width: 700px) { .ov-choice { grid-template-columns: 1fr; bottom: 12vh; } .ov-sub { bottom: 9vh; } }
`;

const el = (cls, parent, tag = 'div') => { const e = document.createElement(tag); if (cls) e.className = cls; parent?.appendChild(e); return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Overlay {
  constructor(cast) {
    this.cast = cast;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = this.root = el('', document.body); root.id = 'ov';
    this.sub = el('ov-sub', root);
    this.cap = el('ov-cap', root);
    this.obj = el('ov-obj', root);
    this.notes = el('ov-notes', root);
    this.choiceEl = el('ov-choice', root);
    this.qteEl = el('ov-qte', root);
    this.meterEl = el('ov-meter', root);
    this.think = el('ov-think', root);
    this.hint = el('ov-hint', root);
    this.spots = el('', root);
    this.fadeEl = el('ov-fade', root);
    this.card = el('ov-card', root);
    this.paper = el('ov-paper', root);
    this.flowEl = el('ov-flow', root);
    this.subtitles = true;
    this.subSize = 1;
  }

  // -------------------------------------------------------------- subtitles
  showLine(who, text, { radio = false } = {}) {
    if (!this.subtitles) return;
    const c = this.cast[who];
    this.sub.className = 'ov-sub on' + (radio || c?.radio ? ' radio' : '');
    this.sub.style.fontSize = this.subSize !== 1 ? `calc(clamp(16px, 1.55vw, 26px) * ${this.subSize})` : '';
    this.sub.innerHTML = '';
    if (c) { const b = el('', this.sub, 'b'); b.textContent = c.name.toUpperCase(); b.style.color = c.color; }
    const s = el('', this.sub, 'span'); s.textContent = text;
  }
  clearLine() { this.sub.className = 'ov-sub'; }

  async caption(text, dur = 3) {
    this.cap.textContent = text; this.cap.classList.add('on');
    await sleep(dur * 1000);
    this.cap.classList.remove('on');
    await sleep(500);
  }

  objective(text) {
    if (!text) { this.obj.classList.remove('on'); return; }
    this.obj.innerHTML = '<i>OBJECTIVE</i>'; const s = el('', this.obj, 'span'); s.textContent = text;
    this.obj.classList.add('on');
  }

  notify(text, kind = 'event') {
    if (!text) return;
    const n = el('ov-note ' + kind, this.notes);
    n.textContent = (kind === 'up' ? '▲ ' : kind === 'down' ? '▼ ' : '') + text;
    requestAnimationFrame(() => n.classList.add('on'));
    setTimeout(() => { n.classList.remove('on'); setTimeout(() => n.remove(), 500); }, 3600);
  }

  thinking(on, text = 'Claude is thinking…') { this.think.textContent = text; this.think.classList.toggle('on', !!on); }

  // -------------------------------------------------------------- choices
  /** Resolves { id } or { free: text }. Keys 1-4 pick; Enter sends free text; a timer takes the default. */
  choose(spec) {
    return new Promise((resolve) => {
      const C = this.choiceEl;
      C.innerHTML = '';
      if (spec.prompt) { const p = el('prompt', C); p.textContent = spec.prompt; }
      let done = false;
      const finish = (r) => { if (done) return; done = true; C.classList.remove('on'); removeEventListener('keydown', onKey, true); clearInterval(timer); setTimeout(() => { C.innerHTML = ''; }, 300); resolve(r); };
      spec.options.forEach((o, i) => {
        const b = el('ov-opt' + (o.danger ? ' danger' : ''), C, 'button');
        const k = el('', b, 'kbd'); k.textContent = String(i + 1);
        const t = el('', b, 'span'); t.textContent = o.label;
        if (o.hint) { const h = el('', t, 'small'); h.textContent = o.hint; }
        b.onclick = () => finish({ id: o.id });
      });
      let input = null;
      if (spec.allowFree) {
        const f = el('ov-free', C);
        input = el('', f, 'input');
        input.placeholder = spec.converse ? 'Or say anything… (Claude answers)' : 'Or type what Batman does or says…';
        input.maxLength = 300;
        const go = el('', f, 'button'); go.textContent = '➤';
        const send = () => { const v = input.value.trim(); if (v) finish({ free: v }); };
        go.onclick = send;
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); });
      }
      let timer = null;
      if (spec.timer) {
        const tb = el('ov-timer', C), bar = el('', tb);
        let elapsed = 0, lastT = performance.now();
        timer = setInterval(() => {
          const now = performance.now(), step = now - lastT; lastT = now;
          if (this.paused || (input && document.activeElement === input && input.value)) return;   // pause and typing stop the clock
          elapsed += step;
          const k = 1 - elapsed / (spec.timer * 1000);
          bar.style.width = Math.max(0, k * 100) + '%';
          if (k <= 0) finish({ id: spec.default ?? spec.options[0].id, timedOut: true });
        }, 50);
      }
      const onKey = (e) => {
        const n = Number(e.key);
        if (n >= 1 && n <= spec.options.length) { e.preventDefault(); finish({ id: spec.options[n - 1].id }); }
      };
      addEventListener('keydown', onKey, true);
      requestAnimationFrame(() => C.classList.add('on'));
      this._pendingChoice = { finish, spec };
    });
  }

  // -------------------------------------------------------------- QTE
  /** keys: sequence; each must be pressed within window seconds. Resolves true/false. */
  qte({ keys, window = 1.2, label = '' }, onTick) {
    return new Promise((resolve) => {
      const Q = this.qteEl;
      Q.innerHTML = '';
      const items = keys.map((k) => {
        const d = el('ov-key', Q);
        d.innerHTML = `<svg viewBox="0 0 86 86"><circle cx="43" cy="43" r="40" fill="none" stroke="rgba(233,241,255,.18)" stroke-width="3"/><circle class="ring" cx="43" cy="43" r="40" fill="none" stroke="#e9f1ff" stroke-width="3" stroke-dasharray="251.3" stroke-dashoffset="0"/></svg><span>${k === 'SPACE' ? '␣' : k}</span>`;
        return d;
      });
      if (label) { const l = el('ov-qte-label', Q); l.textContent = label; }
      Q.classList.add('on');
      let i = 0, t0 = performance.now(), ok = true;
      const finish = (res) => { removeEventListener('keydown', onKey, true); cancelAnimationFrame(raf); setTimeout(() => { Q.classList.remove('on'); }, 350); resolve(res); };
      const onKey = (e) => {
        const want = keys[i];
        const key = e.code === 'Space' ? 'SPACE' : e.key.toUpperCase();
        if (key === want) { e.preventDefault(); items[i].classList.add('done'); onTick?.(i, true); i++; t0 = performance.now(); if (i >= keys.length) finish(ok); }
        else if (/^[A-Z]$|^SPACE$/.test(key)) { ok = false; items[i].classList.add('miss'); onTick?.(i, false); finish(false); }
      };
      addEventListener('keydown', onKey, true);
      // touch/click: tapping the prompt counts
      items.forEach((d, k) => { d.style.pointerEvents = 'auto'; d.onclick = () => { if (k === i) onKey({ key: keys[i] === 'SPACE' ? ' ' : keys[i], code: keys[i] === 'SPACE' ? 'Space' : '', preventDefault() {} }); }; });
      let raf;
      let lastT = performance.now();
      const tick = () => {
        const now = performance.now();
        if (this.paused) t0 += now - lastT;
        lastT = now;
        const k = (now - t0) / (window * 1000);
        const ring = items[i]?.querySelector('.ring');
        if (ring) ring.style.strokeDashoffset = String(251.3 * Math.min(1, k));
        if (k >= 1) { items[i]?.classList.add('miss'); finish(false); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      this._pendingQte = () => onKey({ key: keys[i] === 'SPACE' ? ' ' : keys[i], code: keys[i] === 'SPACE' ? 'Space' : '', preventDefault() {} });
    });
  }

  meter({ show, name, label, value, delta }) {
    const M = this.meterEl;
    if (!show) { M.classList.remove('on'); return; }
    M.innerHTML = `<div class="l">${name ?? ''}</div><div class="n">${Math.round(value)}%</div><div class="l">${label ?? ''}</div><div class="d" style="color:${delta > 0 ? 'var(--good)' : 'var(--warn)'}">${delta ? (delta > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(delta)) + '%' : ''}</div>`;
    M.classList.add('on');
  }

  async fade(to, dur = 1) { this.fadeEl.style.transition = `opacity ${dur}s`; this.fadeEl.style.opacity = String(to); await sleep(dur * 1000); }

  async chapterCard(kicker, title, sub, hold = 3.2) {
    const C = this.card;
    C.innerHTML = `<div><div class="k">${kicker}</div><div class="t">${title}</div><div class="s">${sub ?? ''}</div></div>`;
    C.classList.add('on');
    await sleep(hold * 1000);
    C.classList.remove('on');
    await sleep(900);
  }

  async headline(h, by, dateline = 'VESPER LEDGER') {
    const P = this.paper;
    P.innerHTML = `<div class="mast">The Vesper Ledger</div><div class="date"><span>Vesper City · Earth-V</span><span>Morning Edition</span><span>Forty Cents</span></div><h2></h2><p></p>`;
    P.querySelector('h2').textContent = h; P.querySelector('p').textContent = by;
    P.classList.add('on');
    await sleep(5200);
    P.classList.remove('on');
    await sleep(900);
    void dateline;
  }

  setHint(text) { this.hint.textContent = text ?? ''; this.hint.classList.toggle('on', !!text); }

  /** The flowchart: every choice of the run, chosen and unexplored; returns the button pressed. */
  flowchart(runner, chapters, buttons) {
    return new Promise((resolve) => {
      const F = this.flowEl;
      const st = runner.state;
      const label = (v) => String(v).replace(/^./, (c) => c.toUpperCase());
      F.innerHTML = `<h1>FLOWCHART</h1><div class="stats">
        <div>NADIA<b>${label(st.nadia)}</b></div><div>ROOK<b>${label(st.rook)}</b></div><div>THE FERRYMAN<b>${label(st.marrow)}</b></div>
        <div>THE CODE<b>${st.code}%</b></div><div>THE CITY SEES<b>${st.legend > 1 ? 'A guardian' : st.legend < -1 ? 'A monster' : 'A rumour'}</b></div><div>CRUZ<b>${st.trust.cruz >= 2 ? 'An ally' : st.trust.cruz > 0 ? 'Curious' : 'A stranger'}</b></div></div>`;
      for (const ch of chapters) {
        const nodes = runner.flowchart.filter((n) => n.chapter === ch.id && n.options);
        if (!nodes.length) continue;
        const h = el('ch', F); h.textContent = ch.title;
        for (const n of nodes) {
          const row = el('node', F);
          const p = el('p', row); p.textContent = n.prompt ?? '';
          for (const o of n.options) { const d = el('opt ' + (o.id === n.chosen ? 'sel' : 'lock'), row); d.textContent = o.id === n.chosen ? o.label : '?'; d.title = o.id === n.chosen ? '' : 'Not taken (yet)'; }
          if (n.free) { const d = el('opt sel', row); d.textContent = '“' + n.free + '”'; }
        }
      }
      const btns = el('btns', F);
      for (const b of buttons) { const x = el('ov-btn' + (b.primary ? ' primary' : ''), btns, 'button'); x.textContent = b.label; x.onclick = () => { F.classList.remove('on'); setTimeout(() => { F.innerHTML = ''; }, 600); resolve(b.id); }; }
      F.classList.add('on');
    });
  }
}
