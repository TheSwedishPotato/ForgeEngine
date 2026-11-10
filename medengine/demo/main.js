/**
 * The Ford in a browser: a canvas, a WebGPU device, and a little HTML for the parts that are text (the start card, the heads-up
 * display, the conversation). The level itself is demo/game.js and does not know it is on a page.
 *
 *   npm run demo            then open http://localhost:8080/
 *   ?quality=low|medium|high|ultra     fixed quality (without it: high, lowered automatically when the frame rate is poor)
 *   ?scale=0.6                         internal render scale, 0.25 .. 1.5 (the upscaler restores the rest)
 *   ?gpu=1                             adds a heads-up line with the time the GPU spends on a frame and on its three costliest passes
 */
import { Engine, QUALITY, Audio } from '../src/index.js';
import { BrowserPlatform } from '../src/platform/browser.js';
import { createGame } from './game.js';

window.__medengineBooted = true;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const canvas = $('view'), splash = $('splash'), play = $('play'), status = $('status');
const hud = $('hud'), hintEl = $('hint'), toastEl = $('toast'), storyEl = $('story');

const params = new URLSearchParams(location.search);
const wanted = params.get('quality');
const auto = !QUALITY[wanted];
const scale = Number(params.get('scale'));
const wantGpuTimes = params.get('gpu') === '1';
const QUALITIES = ['ultra', 'high', 'medium', 'low'];

let engine = null, game = null, audio = null, ready = false, started = false;

// ---------------------------------------------------------------------------------------------------------------- small UI
let toastTimer = 0;
function toast(text, { bad = false, seconds = 4 } = {}) {
  toastEl.textContent = text;
  toastEl.classList.toggle('bad', bad);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), seconds * 1000);
}

function fail(e) {
  console.error(e);
  status.className = 'bad';
  status.textContent = e?.message ?? String(e);
  play.textContent = 'Not available';
  play.disabled = true;
}

const KEY_NAMES = { Space: 'Space', Enter: 'Enter', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
const keyName = (code) => KEY_NAMES[code] ?? String(code).replace(/^(Key|Digit|Numpad)/, '');

// ---------------------------------------------------------------------------------------------------------------- the conversation
// Built with textContent only: whatever the story says is text, never markup.
const live = { timer: null, qte: null, choices: [] };

function renderStory(view) {
  live.timer = live.qte = null; live.choices = [];
  const opening = storyEl.hidden && !!view;
  if (!view) {
    storyEl.hidden = true;
    storyEl.replaceChildren();
    if (engine) engine.input.lockOnClick = true;
    return;
  }
  if (opening && engine) {                       // the mouse is needed for the choices: let go of it while people talk
    engine.input.lockOnClick = false;
    engine.input.lockPointer(false);
  }
  storyEl.hidden = false;
  const parts = [];
  if (view.title) parts.push(el('h2', '', view.title));

  const lines = el('div', 'lines');
  for (const l of view.lines) {
    const p = el('p');
    if (l.speaker) p.append(el('span', 'who', l.speaker));
    p.append(document.createTextNode(l.text));
    lines.append(p);
  }
  parts.push(lines);
  if (view.message) parts.push(el('div', 'note', view.message));

  if (view.meter) {
    const m = view.meter, at = (v) => `${((v - m.min) / (m.max - m.min)) * 100}%`;
    const bar = el('div', 'meter');
    for (const t of [m.lose, m.win]) if (typeof t === 'number') { const u = el('u'); u.style.left = at(t); bar.append(u); }
    const pip = el('i'); pip.style.left = at(m.value); bar.append(pip);
    parts.push(bar);
    const lab = el('div', 'meterlabel');
    lab.append(el('span', '', `${m.name} ${m.value}`), el('span', '', m.rounds ? `round ${Math.min(m.round + 1, m.rounds)} of ${m.rounds}` : ''));
    parts.push(lab);
  }

  if (view.timer) {
    const bar = el('div', 'bar'), fill = el('i');
    bar.append(fill); parts.push(bar);
    live.timer = { fill, bar, total: view.timer.total };
  }

  if (view.qte) {
    const q = view.qte, row = el('div', 'qte'), bar = el('div', 'bar'), fill = el('i');
    bar.append(fill);
    const keys = [];
    if (q.mode === 'mash') {
      const cap = el('kbd', '', keyName(q.key));
      row.append(el('span', '', 'Mash'), cap, el('span', '', `${q.count} / ${q.need}`));
      live.qte = { mode: 'mash', fill, bar, label: row.lastChild, total: q.total };
    } else {
      q.keys.forEach((k) => { const cap = el('kbd', '', keyName(k)); keys.push(cap); row.append(cap); });
      row.append(el('span', '', q.allowMisses ? `${q.misses} / ${q.allowMisses + 1} misses` : ''));
      live.qte = { mode: 'sequence', keys, fill, bar, label: row.lastChild, total: q.window };
    }
    parts.push(row, bar);
  }

  if (view.choices.length) {
    const box = el('div', 'choices');
    for (const c of view.choices) {
      const row = el('div', c.enabled ? 'choice' : 'choice off');
      row.setAttribute('role', 'button');
      row.setAttribute('aria-disabled', String(!c.enabled));
      row.append(el('span', 'n', c.implicit ? '↵' : String(c.index + 1)), el('span', '', c.text));
      if (c.hint) row.append(el('span', 'hintx', c.hint));
      // pointerdown, not click: the key handler of the StorySystem and a focused button would both answer Enter or Space
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); if (c.enabled) game?.choose(c.index); });
      box.append(row);
      live.choices.push({ row, index: c.index, enabled: c.enabled });
    }
    parts.push(box);
  }

  if (view.ended) parts.push(el('div', 'end', `The end · ${view.ended.ending.replace(/_/g, ' ')}`));
  storyEl.replaceChildren(...parts);
  paintStoryLive();
}

/** What changes every frame: the time left, the quick-time events, which choice the arrow keys are on. */
function paintStoryLive() {
  const v = game?.story.view;
  if (!v || storyEl.hidden) return;
  if (live.timer && v.timer) {
    const f = Math.max(0, v.timer.left / live.timer.total);
    live.timer.fill.style.width = `${f * 100}%`;
    live.timer.bar.classList.toggle('warn', f < 0.25);
  }
  if (live.qte && v.qte) {
    const q = v.qte, L = live.qte;
    L.fill.style.width = `${Math.max(0, q.left / L.total) * 100}%`;
    L.bar.classList.toggle('warn', q.left / L.total < 0.25);
    if (L.mode === 'mash') L.label.textContent = `${q.count} / ${q.need}`;
    else {
      L.keys.forEach((cap, i) => { cap.className = i < q.index ? 'done' : i === q.index ? 'now' : ''; });
      if (q.allowMisses) L.label.textContent = `${q.misses} / ${q.allowMisses + 1} misses`;
    }
  }
  const sel = game.storySystem.selected;
  for (const c of live.choices) c.row.classList.toggle('sel', c.enabled && c.index === sel);
}

// ---------------------------------------------------------------------------------------------------------------- frame rate
/** Lowers the quality one step when the game cannot keep 30 fps for a few seconds; never raises it again. */
function makeGovernor() {
  let warm = 3, acc = 0, frames = 0, slow = 0;
  return () => {
    const dt = engine.realDt;
    if (!auto || engine.paused || document.hidden || !started) { acc = frames = slow = 0; return; }
    if (warm > 0) { warm -= dt; return; }       // shader compilation and texture uploads make the first seconds uneven
    acc += dt; frames++;
    if (acc < 1.2) return;
    const fps = frames / acc;
    acc = frames = 0;
    slow = fps < 30 ? slow + 1 : 0;
    if (slow < 2) return;
    slow = 0; warm = 2;
    const next = QUALITIES[QUALITIES.indexOf(engine.stage.quality) + 1];
    if (!next) return;
    engine.stage.setQuality(next);
    toast(`${fps.toFixed(0)} fps: quality lowered to ${next}. Add ?quality=high to the address to force it.`);
  };
}

/** "gpu 5.8 ms · lighting 1.9 · gbuffer 1.2 · taa 0.7": what the GPU spent on the frame and on its three costliest passes. */
function gpuTimesLine(timer) {
  if (!timer.samples) return 'gpu: measuring…';
  const top = Object.entries(timer.avg.passes).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `gpu ${timer.avg.spanMs.toFixed(1)} ms · ${top.map(([name, ms]) => `${name} ${ms.toFixed(1)}`).join(' · ')}`;
}

// ---------------------------------------------------------------------------------------------------------------- boot
function describeGPU(gpu) {
  const i = gpu.adapter?.info ?? {};
  const name = i.description || [i.vendor, i.architecture, i.device].filter(Boolean).join(' ');
  return name || 'WebGPU adapter';
}

async function boot() {
  const platform = new BrowserPlatform({ canvas });
  status.textContent = 'starting the renderer';
  engine = await Engine.create({
    platform,
    quality: auto ? 'high' : wanted,
    renderScale: scale >= 0.25 && scale <= 1.5 ? scale : null,
    baseUrl: new URL('../', import.meta.url).href,
    input: { lockOnClick: true },
  });
  const gpu = engine.stage.renderer.gpu;
  gpu.onError = (msg) => { console.error('[webgpu]', msg); toast(`GPU error: ${String(msg).split('\n')[0].slice(0, 160)}`, { bad: true, seconds: 8 }); };
  engine.on('error', (e) => toast(`Error: ${e?.message ?? e}`, { bad: true, seconds: 8 }));
  engine.input.setContext('splash');            // nothing is bound while the start card is up

  status.textContent = 'building the level';
  audio = new Audio();
  game = await createGame(engine, { audio, ui: { story: renderStory } });
  game.intro(true);

  // ---- the heads-up display, four times a second
  const governor = makeGovernor();
  const gpuName = describeGPU(gpu);
  $('hud-gpu').textContent = `WebGPU · ${gpuName}`;
  const timesEl = $('hud-times');
  const timing = wantGpuTimes && engine.stage.enableGpuTiming();
  timesEl.hidden = !wantGpuTimes;
  if (wantGpuTimes) timesEl.textContent = timing ? 'gpu: measuring…' : 'gpu times: this adapter has no timestamp queries';
  let hudClock = 0, lastHint = '', lostShown = false;
  engine.on('lateUpdate', () => {
    governor();
    paintStoryLive();
    if (!started) return;
    const h = engine.input.pointerLocked || game.talking ? game.hint() : `Click to capture the mouse · ${game.hint()}`;
    if (h !== lastHint) { hintEl.textContent = lastHint = h; }
    hudClock += engine.realDt;
    if (hudClock < 0.25) return;
    hudClock = 0;
    const s = game.status(), st = engine.stats, r = engine.stage.renderer.stats;
    $('hud-perf').textContent = `${st.fps.toFixed(0)} fps · cpu ${st.frameMs.toFixed(1)} ms · ${engine.stage.quality}${auto ? ' (auto)' : ''} · ${r.drawCalls ?? 0} draws`;
    $('hud-state').textContent = `${s.state}${s.grounded ? '' : ' · airborne'} · camera ${s.camera}${engine.paused ? ' · paused' : ''}`;
    if (timing) timesEl.textContent = gpuTimesLine(engine.stage.renderer.timer);
    if (gpu.lost && !lostShown) { lostShown = true; toast(`The GPU device was lost (${gpu.lost.reason ?? 'unknown'}). Reload the page.`, { bad: true, seconds: 60 }); }
  });

  window.medengineDemo = { engine, game, audio };
  engine.start();
  ready = true;
  play.disabled = false;
  play.textContent = 'Click to play';
  status.textContent = `${gpuName} · ${engine.stage.quality}${auto ? ' (auto)' : ''}`;
  play.focus();
}

function begin() {
  if (!ready || started) return;
  started = true;
  splash.hidden = true;
  hud.hidden = hintEl.hidden = false;
  audio.start();
  game.intro(false);
  engine.input.setContext('default');
  engine.input.lockPointer(true);
  canvas.focus();
}

play.addEventListener('click', begin);
window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && ready && !started) { e.preventDefault(); begin(); } });

boot().catch(fail);
