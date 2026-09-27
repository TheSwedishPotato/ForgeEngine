import { PUNCHES } from '../boxer/moves.js';

const fmtClock = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const SETTINGS_DEFAULT = {
  name: 'Red Forge',
  difficulty: 'pro',
  rounds: 3,
  roundLength: 120,
  stance: 'orthodox',
  quality: 'high',
  camera: 'fighter',
  volume: 0.8,
};

/**
 * Broadcast-style overlay: fighter plates, round clock, impact telemetry,
 * call-outs, menus, scorecards and touch controls. Pure DOM.
 */
export class HUD {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    root.innerHTML = `
      <div class="hud" id="hud" hidden>
        <div class="bar">
          <div class="plate red">
            <div class="plate-name"><span class="corner-tag">RED</span><span id="nameA"></span></div>
            <div class="meter health"><i id="hpA"></i><b id="hpAlag"></b></div>
            <div class="meter stamina"><i id="stA"></i></div>
          </div>
          <div class="clockbox">
            <div class="round" id="roundLbl">ROUND 1</div>
            <div class="clock" id="clock">3:00</div>
          </div>
          <div class="plate blue">
            <div class="plate-name"><span id="nameB"></span><span class="corner-tag">BLUE</span></div>
            <div class="meter health"><i id="hpB"></i><b id="hpBlag"></b></div>
            <div class="meter stamina"><i id="stB"></i></div>
          </div>
        </div>
        <div class="telemetry" id="telemetry" hidden>
          <div class="tel-punch" id="telPunch">CROSS</div>
          <div class="tel-grid">
            <div><span id="telForce">0</span><small>kN peak</small></div>
            <div><span id="telSpeed">0</span><small>m/s glove</small></div>
            <div><span id="telDv">0</span><small>m/s head &Delta;V</small></div>
            <div><span id="telDw">0</span><small>rad/s head &Delta;&omega;</small></div>
          </div>
        </div>
        <div class="callout" id="callout"></div>
        <div class="subcall" id="subcall"></div>
        <div class="getup" id="getup" hidden>
          <div class="getup-title">GET UP!</div>
          <div class="getup-meter"><i id="getupFill"></i></div>
          <div class="getup-hint" id="getupHint">Tap SPACE / any button repeatedly</div>
        </div>
        <button class="ui-interactive pause-btn" id="pauseBtn" aria-label="Pause">II</button>
        <div class="hint" id="hint">WASD move · J jab · K cross · U/I hooks · N/M uppercuts · Shift body · Space block · Q/E slip · C duck · V camera · H help</div>
      </div>

      <div class="touch" id="touch" hidden>
        <div class="stick ui-interactive" id="stick"><div class="knob" id="knob"></div></div>
        <div class="pad ui-interactive">
          <button data-p="leadUppercut">L UPPER</button>
          <button data-p="rearUppercut">R UPPER</button>
          <button data-p="leadHook">L HOOK</button>
          <button data-p="rearHook">R HOOK</button>
          <button data-p="jab" class="big">JAB</button>
          <button data-p="cross" class="big">CROSS</button>
        </div>
        <div class="dpad ui-interactive">
          <button data-d="slipLeft">SLIP ◀</button>
          <button data-d="duck">DUCK</button>
          <button data-d="slipRight">▶ SLIP</button>
          <button id="blockBtn" class="wide">BLOCK</button>
          <button id="bodyBtn" class="wide">BODY</button>
        </div>
      </div>

      <div class="screen ui-interactive side" id="menu">
        <div class="card">
          <div class="kicker">FORGE ENGINE · FIGHT NIGHT</div>
          <h1 class="title">FORGE<span>BOXING</span></h1>
          <p class="lede">Every punch is simulated: 14-segment ragdoll fighters, torque-limited muscles and padded-glove contact physics. Knockouts come from how hard the head is snapped.</p>
          <div class="tape">
            <div class="tape-head"><span>TALE OF THE TAPE</span></div>
            <div class="tape-row"><b>1.80 m</b><span>Height</span><b>1.80 m</b></div>
            <div class="tape-row"><b>80 kg</b><span>Weight</span><b>80 kg</b></div>
            <div class="tape-row"><b id="tapeStance">Orthodox</b><span>Stance</span><b>Orthodox</b></div>
            <div class="tape-row"><b id="tapeName">Red Forge</b><span>Fighter</span><b id="tapeOpp">Titan</b></div>
          </div>
          <div class="form">
            <label>Opponent
              <select id="optDiff">
                <option value="rookie">Rookie</option>
                <option value="pro" selected>Pro</option>
                <option value="contender">Contender</option>
                <option value="champion">Champion</option>
              </select>
            </label>
            <label>Rounds
              <select id="optRounds"><option>1</option><option selected>3</option><option>6</option><option>12</option></select>
            </label>
            <label>Round length
              <select id="optLen"><option value="60">1:00</option><option value="120" selected>2:00</option><option value="180">3:00</option></select>
            </label>
            <label>Stance
              <select id="optStance"><option value="orthodox">Orthodox</option><option value="southpaw">Southpaw</option></select>
            </label>
            <label>Graphics
              <select id="optQuality"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            </label>
            <label>Camera
              <select id="optCamera"><option value="fighter">Over the shoulder</option><option value="broadcast">Broadcast</option><option value="high">High angle</option></select>
            </label>
          </div>
          <div class="actions">
            <button class="primary" id="startBtn">Step into the ring</button>
            <button id="controlsBtn">Controls</button>
          </div>
          <p class="fine">Keyboard, mouse, gamepad or touch. Best with sound on.</p>
        </div>
      </div>

      <div class="screen ui-interactive" id="controls" hidden>
        <div class="card narrow">
          <h2>Controls</h2>
          <table class="keys">
            <tr><th>Move</th><td>W A S D · left stick</td></tr>
            <tr><th>Jab / Cross</th><td>J / K · left / right mouse · X / Y</td></tr>
            <tr><th>Lead / Rear hook</th><td>U / I · middle mouse · A / B</td></tr>
            <tr><th>Uppercuts</th><td>N / M · RB + face button</td></tr>
            <tr><th>Body shot</th><td>hold Shift · hold RT</td></tr>
            <tr><th>Block (high guard)</th><td>Space · LT</td></tr>
            <tr><th>Slip left / right</th><td>Q / E · right stick</td></tr>
            <tr><th>Duck / Lean back</th><td>C / Z · right stick down / up</td></tr>
            <tr><th>Camera · Pause · Replay</th><td>V · P or Esc · R</td></tr>
            <tr><th>Get up when down</th><td>tap Space / any button fast</td></tr>
          </table>
          <p class="fine">Punches land where the physics puts them: step into range (about an arm's length), throw off the jab, and keep your guard up. Hooks turn the head the most, and that is what drops people. Body shots drain stamina, and a clean one on the liver can fold a fighter.</p>
          <div class="actions"><button class="primary" id="controlsBack">Back</button></div>
        </div>
      </div>

      <div class="screen ui-interactive dim" id="pause" hidden>
        <div class="card narrow">
          <h2>Paused</h2>
          <div class="actions col">
            <button class="primary" id="resumeBtn">Resume</button>
            <button id="camBtn">Camera: Over the shoulder</button>
            <button id="pauseControls">Controls</button>
            <button id="quitBtn">Quit to menu</button>
          </div>
          <label class="vol">Volume <input type="range" id="optVol" min="0" max="1" step="0.05" value="0.8" /></label>
        </div>
      </div>

      <div class="screen ui-interactive dim" id="between" hidden>
        <div class="card">
          <div class="kicker" id="betweenKicker">END OF ROUND 1</div>
          <h2>Punch stats</h2>
          <table class="stats" id="statsTable"></table>
          <div class="cards" id="cards"></div>
          <p class="fine" id="cornerTip"></p>
        </div>
      </div>

      <div class="screen ui-interactive dim" id="result" hidden>
        <div class="card">
          <div class="kicker" id="resultKicker">RESULT</div>
          <h1 class="title small" id="resultTitle">WINNER</h1>
          <p class="lede" id="resultDetail"></p>
          <table class="stats" id="resultStats"></table>
          <div class="actions">
            <button class="primary" id="rematchBtn">Rematch</button>
            <button id="replayBtn">Watch the finish</button>
            <button id="menuBtn">Main menu</button>
          </div>
        </div>
      </div>
    `;
    const $ = (id) => root.querySelector('#' + id);
    this.$ = $;
    this.el = {
      hud: $('hud'), hpA: $('hpA'), hpB: $('hpB'), hpAlag: $('hpAlag'), hpBlag: $('hpBlag'), stA: $('stA'), stB: $('stB'),
      clock: $('clock'), roundLbl: $('roundLbl'), callout: $('callout'), subcall: $('subcall'), telemetry: $('telemetry'),
      getup: $('getup'), getupFill: $('getupFill'), menu: $('menu'), pause: $('pause'), between: $('between'), result: $('result'),
      controls: $('controls'), touch: $('touch'), hint: $('hint'),
    };
    this.lag = { A: 100, B: 100 };
    this._wire();
    this.calloutTimer = null;
    this.telTimer = null;
  }

  _wire() {
    const $ = this.$, h = this.h;
    const readSettings = () => ({
      difficulty: $('optDiff').value,
      rounds: +$('optRounds').value,
      roundLength: +$('optLen').value,
      stance: $('optStance').value,
      quality: $('optQuality').value,
      camera: $('optCamera').value,
    });
    $('optStance').addEventListener('change', () => { $('tapeStance').textContent = $('optStance').value === 'southpaw' ? 'Southpaw' : 'Orthodox'; });
    $('optDiff').addEventListener('change', () => {
      const n = this.opponentNames?.[$('optDiff').value];
      if (n) $('tapeOpp').textContent = n;
    });
    $('startBtn').addEventListener('click', () => h.start(readSettings()));
    $('controlsBtn').addEventListener('click', () => this.show('controls'));
    $('controlsBack').addEventListener('click', () => this.show(this.backTo ?? 'menu'));
    $('resumeBtn').addEventListener('click', () => h.resume());
    $('camBtn').addEventListener('click', () => { const m = h.cycleCamera(); this.setCameraLabel(m); });
    $('pauseControls').addEventListener('click', () => { this.backTo = 'pause'; this.show('controls'); });
    $('quitBtn').addEventListener('click', () => h.quit());
    $('rematchBtn').addEventListener('click', () => h.rematch());
    $('menuBtn').addEventListener('click', () => h.quit());
    $('replayBtn').addEventListener('click', () => h.replay());
    $('pauseBtn').addEventListener('click', () => h.pause());
    $('optVol').addEventListener('input', (e) => h.volume(+e.target.value));
  }

  applySettings(s) {
    const $ = this.$;
    $('optDiff').value = s.difficulty;
    $('optRounds').value = String(s.rounds);
    $('optLen').value = String(s.roundLength);
    $('optStance').value = s.stance;
    $('optQuality').value = s.quality;
    $('optCamera').value = s.camera;
    $('optVol').value = String(s.volume);
    $('tapeStance').textContent = s.stance === 'southpaw' ? 'Southpaw' : 'Orthodox';
  }

  setCameraLabel(m) {
    const names = { fighter: 'Over the shoulder', broadcast: 'Broadcast', high: 'High angle' };
    this.$('camBtn').textContent = `Camera: ${names[m] ?? m}`;
  }

  setNames(a, b) {
    this.$('nameA').textContent = a;
    this.$('nameB').textContent = b;
  }

  setTape(a, opp) {
    this.$('tapeName').textContent = a;
    this.$('tapeOpp').textContent = opp;
  }

  /** Show one screen (or 'hud' / 'none'). */
  show(which) {
    for (const k of ['menu', 'pause', 'between', 'result', 'controls']) this.el[k].hidden = k !== which;
    if (which !== 'controls') this.backTo = null;
  }

  showHud(v) {
    this.el.hud.hidden = !v;
    if (this.touchEnabled) this.el.touch.hidden = !v;
  }

  enableTouch(input) {
    const t = this.el.touch;
    this.touchEnabled = true;
    t.hidden = this.el.hud.hidden;
    this.el.hint.hidden = true;
    document.body.classList.add('touch-ui');
    const stick = this.$('stick'), knob = this.$('knob');
    let id = null, cx = 0, cy = 0;
    const R = 50;
    const move = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.touch.move.x = dx / R;
      input.touch.move.y = -dy / R;
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      stick.setPointerCapture(id);
      move(e.clientX, e.clientY);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e.clientX, e.clientY); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      input.touch.move.x = input.touch.move.y = 0;
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    t.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.press({ type: 'punch', punch: b.dataset.p });
      input.press({ type: 'mash' });
    }));
    t.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.press({ type: 'defend', move: b.dataset.d });
    }));
    const block = this.$('blockBtn');
    block.addEventListener('pointerdown', (e) => { e.preventDefault(); input.touch.block = true; block.classList.add('on'); input.press({ type: 'mash' }); });
    const unblock = () => { input.touch.block = false; block.classList.remove('on'); };
    block.addEventListener('pointerup', unblock);
    block.addEventListener('pointercancel', unblock);
    block.addEventListener('pointerleave', unblock);
    const body = this.$('bodyBtn');
    body.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.touch.body = !input.touch.body;
      body.classList.toggle('on', input.touch.body);
    });
  }

  update(match, a, b) {
    const el = this.el;
    const hA = Math.max(0, a.health), hB = Math.max(0, b.health);
    el.hpA.style.width = `${hA}%`;
    el.hpB.style.width = `${hB}%`;
    this.lag.A += (hA - this.lag.A) * 0.03;
    this.lag.B += (hB - this.lag.B) * 0.03;
    el.hpAlag.style.width = `${Math.max(hA, this.lag.A)}%`;
    el.hpBlag.style.width = `${Math.max(hB, this.lag.B)}%`;
    el.stA.style.width = `${Math.max(0, a.stamina)}%`;
    el.stB.style.width = `${Math.max(0, b.stamina)}%`;
    el.hpA.parentElement.classList.toggle('hurt', a.stun > 0.45);
    el.hpB.parentElement.classList.toggle('hurt', b.stun > 0.45);
    el.clock.textContent = fmtClock(match.clock);
    el.roundLbl.textContent = `ROUND ${match.round} / ${match.rounds}`;
    el.clock.classList.toggle('late', match.clock < 10 && match.state === 'fight');
  }

  callout(text, sub = '', { ms = 1400, kind = '' } = {}) {
    const c = this.el.callout, s = this.el.subcall;
    c.textContent = text;
    s.textContent = sub;
    c.className = `callout show ${kind}`;
    s.className = `subcall ${sub ? 'show' : ''}`;
    clearTimeout(this.calloutTimer);
    if (ms > 0) this.calloutTimer = setTimeout(() => this.clearCallout(), ms);
  }

  clearCallout() {
    this.el.callout.className = 'callout';
    this.el.subcall.className = 'subcall';
  }

  telemetry(ev, side) {
    const t = this.el.telemetry;
    const label = ev.punchType ? PUNCHES[ev.punchType].label : 'Shot';
    const where = ev.zone === 'body' ? (ev.liver ? 'to the liver' : 'to the body') : ev.zone === 'block' ? 'blocked' : 'to the head';
    this.$('telPunch').textContent = `${side === 'A' ? '◀' : '▶'} ${label.toUpperCase()} ${where}`;
    this.$('telForce').textContent = (ev.force / 1000).toFixed(2);
    this.$('telSpeed').textContent = ev.speed.toFixed(1);
    this.$('telDv').textContent = ev.zone === 'head' ? ev.dv.toFixed(2) : '–';
    this.$('telDw').textContent = ev.zone === 'head' ? ev.dw.toFixed(1) : '–';
    t.hidden = false;
    t.className = `telemetry ${side === 'A' ? 'red' : 'blue'} ${ev.zone}`;
    void t.offsetWidth;
    t.classList.add('pop');
    clearTimeout(this.telTimer);
    this.telTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  getUp(visible, fill = 0, touch = false) {
    this.el.getup.hidden = !visible;
    this.el.getupFill.style.width = `${Math.round(fill * 100)}%`;
    this.$('getupHint').textContent = touch ? 'Tap any button repeatedly' : 'Tap SPACE or any button repeatedly';
  }

  showBetween(match, a, b, tip) {
    this.$('betweenKicker').textContent = `END OF ROUND ${match.round}`;
    this.$('statsTable').innerHTML = statsRows(a, b, true);
    const tots = match.totals();
    this.$('cards').innerHTML = match.judges.map((j, i) => {
      const last = j.cards[j.cards.length - 1] ?? [10, 10];
      return `<div class="judge"><span>Judge ${String.fromCharCode(65 + i)}</span><b>${last[0]}–${last[1]}</b><small>total ${tots[i][0]}–${tots[i][1]}</small></div>`;
    }).join('');
    this.$('cornerTip').textContent = tip;
    this.show('between');
  }

  showResult(result, a, b, playerWon) {
    const $ = this.$;
    $('resultKicker').textContent = result.method.toUpperCase() + (result.method.includes('Decision') || result.method === 'Draw' ? '' : ` · ROUND ${result.round}`);
    $('resultTitle').textContent = result.winner ? (playerWon ? 'YOU WIN' : `${result.winner.name.toUpperCase()} WINS`) : 'DRAW';
    $('resultTitle').className = `title small ${result.winner ? (playerWon ? 'win' : 'loss') : ''}`;
    $('resultDetail').textContent = result.detail ? esc(result.detail) : '';
    $('resultStats').innerHTML = statsRows(a, b, false);
    $('replayBtn').hidden = !(result.method === 'KO' || result.method === 'TKO');
    this.show('result');
  }
}

function statsRows(a, b, round) {
  const s = (x) => (round ? x.roundStats : x.stats);
  const pct = (x) => `${Math.round((100 * s(x).landed) / Math.max(1, s(x).thrown))}%`;
  const rows = [
    ['Punches landed', `${s(a).landed}/${s(a).thrown}`, `${s(b).landed}/${s(b).thrown}`],
    ['Connect rate', pct(a), pct(b)],
    ['Power punches', `${s(a).powerLanded}`, `${s(b).powerLanded}`],
    ['Knockdowns scored', `${round ? b.roundStats.knockdowns : b.stats.knockdowns}`, `${round ? a.roundStats.knockdowns : a.stats.knockdowns}`],
  ];
  return `<tr><th></th><th class="red">${esc(a.name)}</th><th class="blue">${esc(b.name)}</th></tr>` +
    rows.map(([k, x, y]) => `<tr><td>${k}</td><td>${x}</td><td>${y}</td></tr>`).join('');
}
