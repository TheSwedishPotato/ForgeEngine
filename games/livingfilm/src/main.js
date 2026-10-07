/**
 * Living Film: a story lived like a film, run by ORRERY.
 *
 * You choose a story (or write your own) and say who you are. Before the
 * first scene the period is researched (notes that come with the story,
 * and a dossier Claude writes), and your full character sheet is drawn up.
 * Then Claude, as the director under ORRERY's laws, writes the film moment
 * by moment: the places (each one built on the 3D stage before anyone
 * walks in, and kept for good), the people with their own lives, every
 * shot, line, gesture and move, the bystanders' remarks, the music and the
 * sound of the place. The film starts playing while Claude is still
 * writing. You answer in your own words, say or do, or pick one of five
 * choices; [[double brackets]] steer the director.
 */
import './sheet/sheet.css';
import { Film } from './render/film.js';
import { Director, directorPrompt, reportPrompt, sheetPrompt } from './orrery/director.js';
import { newStory, applyReply, saveStory, loadStory, clearStory, recap, AXES } from './orrery/state.js';
import { OPENINGS } from './orrery/openings.js';
import { PACKS, dossierPrompt, placeNotePrompt } from './orrery/research.js';
import { openSheet, showReckoning } from './sheet/sheet.js';
import { drawPortrait } from './render/figures.js';
import { Score } from './audio/score.js';
import { Voice } from './voice.js';
import { INDOOR } from './stage3d/vocab.js';

const ui = document.getElementById('ui');
const params = new URLSearchParams(location.search);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Words between asterisks are what someone does: shown in italics. */
const deeds = (s) => esc(s).replace(/\*([^*]+)\*/g, '<i class="act">$1</i>');
const words = (s) => (String(s ?? '').match(/\S+/g) ?? []).length;

let state = null, director = null, busy = false, skip = null, ctl = null;
const score = new Score();

// --- Claude --------------------------------------------------------------------------------------------

const claudeReady = (async () => {
  if (params.get('demo')) { const { demoSample } = await import('./demo.js'); return demoSample; }
  try { return (await window.claude?.use?.('sample')) ?? null; } catch { return null; }
})().then((s) => { director = new Director(s); return s; });

// --- the screen: the 3D stage, or the painted film where WebGL2 is missing -------------------------------

const film2d = new Film(document.getElementById('film'));
let stage = null;
const stageCanvas = document.getElementById('stage');
const storedQuality = (() => { try { return localStorage.getItem('living-film-quality'); } catch { return null; } })();
const quality = params.get('q') ?? storedQuality ?? 'high';
const want3d = quality !== '2d' && !!document.createElement('canvas').getContext('webgl2');
const stageReady = (async () => {
  if (!want3d) return null;
  try { const { Stage3D } = await import('./stage3d/stage.js'); stage = new Stage3D(stageCanvas, { quality }); return stage; } catch (e) { console.warn('3D stage unavailable, painting instead', e); stage = null; return null; }
})().then((s) => { if (params.get('demo')) window.__stage = s; document.body.classList.toggle('three', !!s); document.getElementById('film').hidden = !!s; stageCanvas.hidden = !s; return s; });

const fade = h('<div class="fade on"></div>');
const bars = h('<div class="bars"><i></i><i></i></div>');
ui.append(bars, fade);
const setFade = (on) => { if (stage) fade.classList.toggle('on', on); else if (on) film2d.fadeOut(); else film2d.fadeIn(); };

/** The scene as the painted film knows it (its own smaller vocabulary). */
function scene2d(sc) {
  const indoor = INDOOR.has(sc.place);
  const light = sc.weather === 'fog' || sc.weather === 'rain' ? 'overcast' : sc.time === 'night' ? (indoor ? 'firelight' : 'moonlight') : sc.time === 'dusk' || sc.time === 'dawn' ? 'golden' : indoor ? 'candle' : 'daylight';
  return { place: sc.place === 'shop' ? 'workshop' : sc.place, name: sc.name, time: sc.time, weather: sc.weather, light, mood: sc.mood, present: sc.present };
}
const playerCast = () => ({ id: 'you', name: state.player.name, sex: state.player.sex, age: 25, look: state.player.look, axes: {} });

// --- the projector loop --------------------------------------------------------------------------------

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (stage) stage.frame(dt); else film2d.frame(dt);
  placeOverlays();
  requestAnimationFrame(loop);
}
stageReady.then(() => requestAnimationFrame(loop));

// --- overlays: subtitles, title card, the director writing, bubbles -------------------------------------

const sub = h('<div class="sub" aria-live="polite"></div>');
const card = h('<div class="card"><h2></h2><p></p></div>');
const writing = h('<div class="writing" hidden><em>the scene is being written</em><span>.</span><span>.</span><span>.</span></div>');
const bubbles = h('<div class="bubbles"></div>');
ui.append(bubbles, sub, card, writing);
let live = [];   // bubbles on screen: {el, who, until}

const controls = h(`<div class="controls" hidden>
  <div class="chips"></div>
  <form class="say"><div class="mode"><button type="button" data-m="say" class="on">Say</button><button type="button" data-m="do">Do</button></div><input maxlength="500" autocomplete="off" placeholder="Say anything…" aria-label="What you say or do"><button class="primary" type="submit">Go</button></form>
  <div class="hint">Click the picture or press Space to move on · keys 1–5 choose · or write your own · <code>[[stats]]</code> <code>[[recap]]</code> <code>[[skip to …]]</code> steer the director</div></div>`);
ui.append(controls);

const controlsHeight = () => (controls.hidden ? 0 : controls.getBoundingClientRect().height);
function frameRect() {
  if (!stage) { const F = film2d.frameRect(), d = film2d.dpr; return { y: F.y / d, h: F.h / d }; }
  const H = innerHeight - controlsHeight(), hh = Math.min(H * 0.94, innerWidth / 2.2);
  return { y: Math.max(0, (H - hh) / 2), h: hh };
}
function placeOverlays() {
  const F = frameRect(), bottom = F.y + F.h;
  sub.style.bottom = `${innerHeight - bottom + Math.max(10, F.h * 0.035)}px`;
  writing.style.top = `${bottom - 34}px`;
  if (stage) { const [t, b] = bars.children; t.style.height = `${F.y}px`; b.style.height = `${Math.max(0, innerHeight - bottom)}px`; }
  const now = performance.now();
  live = live.filter((b) => { if (now > b.until) { b.el.classList.remove('on'); setTimeout(() => b.el.remove(), 500); return false; } return true; });
  let side = 0;
  for (const b of live) {
    const p = stage?.headOnScreen(b.who);
    if (p && p.y > F.y + 40 && p.y < bottom) { b.el.classList.remove('side'); b.el.style.right = ''; b.el.style.left = `${p.x}px`; b.el.style.top = `${p.y}px`; }
    else { b.el.classList.add('side'); b.el.style.left = 'auto'; b.el.style.right = '16px'; b.el.style.top = `${F.y + 16 + side * 66}px`; side++; }
  }
}

/** Someone says something in passing: a bubble over their head for a few seconds. */
function bubble(who, text, delay = 0) {
  setTimeout(() => {
    const name = state.cast[who]?.name ?? state.extras?.[who]?.label ?? '';
    const el = h(`<div class="bubble"><b>${esc(name)}</b>${esc(text)}</div>`);
    bubbles.append(el);
    live.push({ el, who, until: performance.now() + 3600 + text.length * 45 });
    requestAnimationFrame(() => el.classList.add('on'));
  }, delay);
}

function showSub(beat) {
  const who = beat.who === 'you' ? state.player.name : beat.who ? state.cast[beat.who]?.name ?? state.extras?.[beat.who]?.label : null;
  sub.innerHTML = `${beat.narration ? `<p class="narr">${esc(beat.narration)}</p>` : ''}${beat.line ? `<p class="line${beat.who === 'you' ? ' me' : ''}"><span class="who">${esc(who ?? '')}</span>${beat.action ? `<i class="act">${esc(beat.action)}</i> ` : ''}${deeds(beat.line)}</p>` : ''}`;
}
function showYou(input) {
  sub.innerHTML = `<p class="line me"><span class="who">${esc(state.player.name)}</span>${input.kind === 'do' ? `<i>${esc(input.text)}</i>` : esc(input.text)}</p>`;
}
function note(text, ms = 4000) { sub.innerHTML = `<p class="narr">${esc(text)}</p>`; if (ms) setTimeout(() => { if (sub.textContent === text) sub.innerHTML = ''; }, ms); }

async function titleCard(sc) {
  card.querySelector('h2').textContent = sc.name || sc.place;
  card.querySelector('p').textContent = [state.clock.date, sc.time, sc.weather !== 'clear' ? sc.weather : ''].filter(Boolean).join(' · ');
  card.classList.add('on'); await wait(2000); card.classList.remove('on'); await wait(450);
}

// --- the places: built before anyone walks in, and kept ---------------------------------------------------

/** Build places in the background, one at a time between frames, so nothing stutters. */
const buildQueue = [];
function prebuild(specs) {
  if (!stage) return;
  const was = buildQueue.length;
  for (const s of specs) if (s && !stage.places.has(s.id) && !buildQueue.some((q) => q.id === s.id)) buildQueue.push(s);
  if (!was && buildQueue.length) nextBuild();
}
function nextBuild() {
  const s = buildQueue[0]; if (!s) return;
  const go = () => { try { stage.ensurePlace(s); } catch (e) { console.warn('could not build', s, e); } buildQueue.shift(); if (buildQueue.length) setTimeout(nextBuild, 120); };
  (window.requestIdleCallback ?? ((f) => setTimeout(f, 60)))(go, { timeout: 1500 });
}

/** Researched before the scene: notes on a place the story reaches for the first time. */
function researchPlace(spec) {
  if (!director || state.codex.entries.some((e) => e.topic === spec.name)) return;
  state.codex.entries.push({ topic: spec.name, text: '(being researched)', source: 'pending' });
  director.json(placeNotePrompt(state, spec), { tier: 'quick' }).then((r) => {
    const e = state.codex.entries.find((x) => x.topic === spec.name);
    if (e && r?.text) { e.text = String(r.text).slice(0, 700); e.source = 'claude'; saveStory(state); }
  }).catch(() => { state.codex.entries = state.codex.entries.filter((x) => !(x.topic === spec.name && x.source === 'pending')); });
}
const codexText = () => state.codex.entries.filter((e) => e.source !== 'pending').map((e) => `${e.topic}: ${e.text}`).join('\n').slice(0, 9000);

// --- a scene on stage -----------------------------------------------------------------------------------

let onStage = null;   // the scene now showing

async function enterScene(sc, cast) {
  const fresh = !onStage || sc.cut;
  if (fresh) { setFade(true); sub.innerHTML = ''; await wait(650); }
  if (stage) {
    stage.enter(sc.spec, { time: sc.time, weather: sc.weather });
    stage.actor('you', playerCast());
    for (const id of sc.present) if (cast[id]) stage.actor(id, cast[id]);
    stage.block(['you', ...sc.present]);
    if (fresh) stage.shot({ shot: 'establishing', on: [], who: null, move: 'pan-right' }, { dur: 9 });
  } else {
    film2d.setCast(cast, state.player); film2d.setScene(scene2d(sc));
  }
  score.set({ mood: sc.mood, place: sc.place, time: sc.time, weather: sc.weather, indoor: INDOOR.has(sc.place), seed: sc.spec.id + sc.mood });
  onStage = sc;
  if (fresh) { await titleCard(sc); setFade(false); }
}

/** People who came on during the reply: dressed, put on their marks. */
function addPeople(cast) {
  if (!onStage) return;
  if (stage) {
    for (const [id, c] of Object.entries(cast)) if (onStage.present.includes(id)) stage.actor(id, c);
    stage.block(['you', ...onStage.present]);
  } else { film2d.setCast({ ...state.cast, ...cast }, state.player); film2d.setScene(scene2d(onStage)); }
}

async function playBeat(b, cast) {
  const est = 1.6 + (words(b.narration) + words(b.line)) / 2.6;
  if (stage && onStage) {
    const ids = new Set([...(b.on ?? []), ...(b.who ? [b.who] : []), ...b.moves.map((m) => m.who), ...b.acts.map((a) => a.who)]);
    let more = false;
    for (const id of ids) if (id !== 'you' && cast[id] && !onStage.present.includes(id)) { onStage.present.push(id); stage.actor(id, cast[id]); more = true; }
    if (more) stage.block(['you', ...onStage.present]);
    for (const m of b.moves) stage.moveTo(m.who, m.to);
    for (const a of stage.actors.values()) if (!a.extra) a.act({ talking: false, gesture: 'none' });
    for (const a of b.acts) stage.actors.get(a.who)?.act({ gesture: a.gesture ?? 'none', task: a.task, emotion: a.emotion });
    if (b.who) stage.actors.get(b.who)?.act({ talking: !!b.line, gesture: b.gesture, emotion: b.emotion, ...(b.task ? { task: b.task } : {}) });
    stage.shot(b, { you: 'you', dur: est + 1.5 });
  } else if (!stage) film2d.showBeat(b, est + 1.5);
  showSub(b);
  let skipped = false;
  const skipP = new Promise((res) => { skip = () => { skipped = true; res(); }; });
  const c = b.who && b.who !== 'you' ? cast[b.who] ?? state.extras?.[b.who] : null;
  const voiceP = (async () => {
    if (b.narration) await Voice.say(b.narration, { who: 'narrator', pitch: 0.9, rate: 1, volume: 0.85 });
    if (b.line) await Voice.say(b.line, { who: b.who, sex: b.who === 'you' ? state.player.sex : c?.sex, pitch: c?.voice?.pitch ?? 1, rate: c?.voice?.rate ?? 1 });
  })();
  if (b.line && !stage) { film2d.speaking = b.who; setTimeout(() => { film2d.speaking = null; }, Math.min(est * 1000, 600 + words(b.line) * 330)); }
  await Promise.race([Promise.all([wait(est * 1000), voiceP]), skipP]);
  if (skipped) Voice.stop();
  if (stage && b.who) stage.actors.get(b.who)?.act({ talking: false });
  skip = null;
}

// --- a turn: Claude writes, the film plays as it arrives ---------------------------------------------------

const LOCAL = /^\s*\[\[\s*(ledger|recap|intensity\s*([1-5])|faster|slower|louder|quieter|harder|gentler)\s*\]\]\s*$/i;

async function turn(input) {
  if (busy || !director) return;
  // the director's steering wheel, where it needs no story written
  if (input && /^\s*stats\s*$/i.test(input.text)) input = { kind: 'director', text: '[[stats]]' };
  if (input && /^\s*\[\[/.test(input.text)) {
    input = { kind: 'director', text: input.text.trim() };
    const m = input.text.match(LOCAL);
    if (m) { localCommand(m[1].toLowerCase().replace(/\s+/g, ' '), m[2]); return; }
  }
  const stats = input?.kind === 'director' && /\[\[\s*stats/i.test(input.text);
  busy = true; setControls(false);
  if (input && input.kind !== 'director') showYou(input);
  writing.hidden = false;
  ctl = new AbortController();
  const queue = []; let done = false, wake = null;
  const poke = () => { const w = wake; wake = null; w?.(); };
  let scenePromise = null, remarks = [], extras = null;
  const castNow = { ...state.cast };
  const hooks = {
    onScene: (sc) => { prebuild([sc.spec]); researchPlace(sc.spec); scenePromise = enterScene(sc, castNow); poke(); },
    onCast: (c) => { Object.assign(castNow, c); if (scenePromise) scenePromise.then(() => addPeople(c)); else addPeople(c); },
    onExtras: (ex) => { extras = ex; state.extras = ex; (scenePromise ?? Promise.resolve()).then(() => stage?.setExtras(ex)); },
    onRemarks: (rs) => { remarks = rs; (scenePromise ?? Promise.resolve()).then(() => rs.forEach((m, i) => bubble(m.who, m.text, 900 + i * 1700))); },
    onBeat: (b) => { queue.push(b); poke(); },
  };
  let played = 0;
  const player = (async () => {
    for (;;) {
      if (scenePromise) await scenePromise;
      if (queue.length) { writing.hidden = true; await playBeat(queue.shift(), castNow); played++; continue; }
      if (done) return;
      if (played) writing.hidden = false;
      await new Promise((r) => { wake = r; });
    }
  })();
  let r = null, err = null;
  try {
    r = await director.turn(state, stats ? null : input, { signal: ctl.signal, codexText: codexText(), hooks, prompt: stats ? reportPrompt(state, codexText()) : null });
  } catch (e) { err = e; }
  done = true; poke();
  await player;
  writing.hidden = true;
  if (r) {
    if (!r.streamed && r.beats.length) {    // the stream could not be read as it came: play the finished reply
      if (r.scene && !scenePromise) await enterScene(r.scene, { ...state.cast, ...r.cast });
      for (const b of r.beats) await playBeat(b, { ...state.cast, ...r.cast });
      if (r.remarks.length && !remarks.length) r.remarks.forEach((m, i) => bubble(m.who, m.text, i * 1500));
    }
    if (r.extras && !extras && stage) stage.setExtras(r.extras);
    applyReply(state, input, r);
    saveStory(state);
    prebuild(Object.values(state.places));
    if (r.turn?.resolution) score.sting(/Clean|Success at/.test(r.turn.resolution.band) ? 'good' : /Hard|Catas/.test(r.turn.resolution.band) ? 'bad' : 'turn');
    if (r.director) directorAnswer(r.director);
    if (r.report) { await wait(600); await showReckoning(state, r.report); }
    renderChips();
    if (!state.player.sheet?.age) buildSheet();
  } else {
    const e = err;
    const why = e?.code === 'rate_limited' ? 'Claude is busy just now. Wait a moment and try again.' : e?.code === 'not_granted' ? 'Claude was not allowed for this page. Allow it from the page\'s permissions to go on.' : e?.code === 'no_claude' ? 'Claude is not available here, so the film cannot be written. Open it on claude.ai.' : e?.code === 'cancelled' ? '' : 'The scene could not be written. Try again.';
    if (why) sub.innerHTML = `<p class="line err">${esc(why)}</p>`;
    if (input && input.kind !== 'director') inputEl.value = input.text;
  }
  busy = false; setControls(true);
}

function localCommand(cmd, n) {
  const S = state.settings;
  if (cmd === 'ledger') { openSheetNow('ledger'); return; }
  if (cmd === 'recap') {
    const R = recap(state);
    directorAnswer(`Where: ${R.where}\nWho is here: ${R.who}\nUnresolved: ${R.open.join('; ') || 'nothing named yet'}\n\n${R.summary}`, 'Recap');
    return;
  }
  if (cmd.startsWith('intensity')) S.intensity = +n;
  if (cmd === 'faster' || cmd === 'slower') S.pace = cmd;
  if (cmd === 'louder') S.louder = 1;
  if (cmd === 'quieter') S.louder = -1;
  if (cmd === 'harder' || cmd === 'gentler') S.difficulty = cmd;
  saveStory(state);
  note(`The director notes: ${cmd}. It takes effect from the next moment.`);
}

function directorAnswer(text, title = 'The director') {
  document.querySelector('.director-note')?.remove();
  const el = h(`<div class="director-note"><b>${esc(title)}</b><p>${esc(text).replace(/\n/g, '<br>')}</p><button>Back to the film</button></div>`);
  el.querySelector('button').addEventListener('click', () => el.remove());
  ui.append(el);
}

// --- the sheet ----------------------------------------------------------------------------------------

let sheetPending = false;
/** ORRERY Book III in full, drawn up from the player's few words while the film plays. */
async function buildSheet() {
  if (!director || sheetPending) return;
  sheetPending = true;
  try {
    const r = await director.json(sheetPrompt(state, codexText()), { tier: director.tier === 'complex' ? 'default' : 'quick' });
    const P = state.player, num = (v, a, b) => Math.max(a, Math.min(b, +v));
    if (r?.sheet && typeof r.sheet === 'object') for (const [k, v] of Object.entries(r.sheet)) if (typeof v === 'string' && v.trim() && !P.sheet[k]) P.sheet[k] = v.trim().slice(0, 600);
    if (r?.body) for (const k of ['fatigue', 'hunger', 'thirst', 'sleep', 'pain']) if (Number.isFinite(+r.body[k]) && r.body[k] !== '') P.body[k] = num(r.body[k], 0, k === 'fatigue' || k === 'pain' ? 10 : 200);
    if (r?.body?.cleanliness && !P.body.cleanliness) P.body.cleanliness = String(r.body.cleanliness).slice(0, 160);
    if (r?.skills && typeof r.skills === 'object') for (const [k, v] of Object.entries(r.skills).slice(0, 16)) if (!P.skills[k]) P.skills[k] = { v: num(v?.v ?? v, 0, 10) || 0, why: String(v?.why ?? '').slice(0, 160) };
    if (r?.means && typeof r.means === 'object') for (const [k, v] of Object.entries(r.means)) if (!P.means[k] && v && (typeof v === 'string' || Array.isArray(v))) P.means[k] = Array.isArray(v) ? v.map(String).slice(0, 14) : String(v).slice(0, 300);
    if (r?.reputation && !Object.keys(P.reputation).length) for (const [k, v] of Object.entries(r.reputation).slice(0, 8)) P.reputation[k] = String(v).slice(0, 200);
    if (r?.moral) { if (+r.moral.order) P.moral.order = num(r.moral.order, 1, 10); if (+r.moral.regard) P.moral.regard = num(r.moral.regard, 1, 10); }
    if (r?.emotion && !P.emotion.primary) Object.assign(P.emotion, { primary: String(r.emotion.primary ?? '').slice(0, 200), undercurrent: String(r.emotion.undercurrent ?? '').slice(0, 200) });
    saveStory(state);
  } catch { /* the sheet fills from play instead */ }
  sheetPending = false;
}

/** A painted portrait, when the stage cannot take one. */
function paintedPortrait() {
  const c = document.createElement('canvas'); c.width = 360; c.height = 480;
  try { drawPortrait(c.getContext('2d'), { ...playerCast(), seed: 3 }, 180, 230, 300, { emotion: 'neutral', t: 0, light: { color: '#ffe8c0', side: -1, dark: 0.2 }, look: 0.2 }); return c.toDataURL('image/png'); } catch { return null; }
}

function openSheetNow(tab = 'person') {
  if (!state) return;
  // the sheet opens at once; the engine's portrait is painted in a moment after
  let el = null;
  try { el = openSheet(state, { tab, portrait: paintedPortrait() }); } catch (e) { console.warn('sheet', e); note('The sheet could not open: ' + (e?.message ?? e)); return; }
  if (stage && onStage) setTimeout(() => {
    try { const url = stage.portrait('you'); const img = el?.querySelector('.portrait'); if (url && img?.tagName === 'IMG') img.src = url; } catch (e) { console.warn('portrait', e); }
  }, 60);
}

// --- what you say and do ------------------------------------------------------------------------------

const inputEl = controls.querySelector('input');
let mode = 'say';
function setMode(m) { mode = m; controls.querySelectorAll('.mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === m)); inputEl.placeholder = m === 'say' ? 'Say anything…' : 'Do anything: I take her hand… I walk out into the rain…'; }
controls.querySelectorAll('.mode button').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.m); inputEl.focus(); }));
controls.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const t = inputEl.value.trim(); if (!t || busy) return; inputEl.value = ''; turn({ kind: mode, text: t }); });
function setControls(on) { inputEl.disabled = !on; controls.querySelectorAll('button').forEach((b) => { b.disabled = !on; }); if (on) inputEl.focus({ preventScroll: true }); }
function renderChips() {
  const C = controls.querySelector('.chips');
  C.innerHTML = '';
  for (const [i, s] of (state.suggestions ?? []).entries()) {
    const b = h(`<button type="button" title="${esc(s.risk ? 'Risk: ' + s.risk : '')}"><span class="n">${i + 1}</span><span class="k">${s.kind}</span>${esc(s.text)}</button>`);
    b.addEventListener('click', () => { if (!busy) turn({ kind: s.kind, text: s.text }); });
    C.append(b);
  }
}

addEventListener('click', (e) => { if (e.target === stageCanvas || e.target.id === 'film' || e.target === fade) skip?.(); });
addEventListener('keydown', (e) => {
  if (document.activeElement === inputEl || document.querySelector('.sheet, .start')) return;
  if (e.code === 'Space' && skip) { e.preventDefault(); skip(); }
  const n = +e.key;
  if (n >= 1 && n <= 5 && !busy && state?.suggestions?.[n - 1]) { const s = state.suggestions[n - 1]; turn({ kind: s.kind, text: s.text }); }
});

// --- the corner -------------------------------------------------------------------------------------------

const corner = h('<div class="corner" hidden><button data-a="sheet">Character</button><button data-a="book">Chapters</button><button data-a="sound">Sound: on</button><button data-a="voice">Voices: off</button><button data-a="new">New film</button></div>');
ui.append(corner);
corner.addEventListener('click', (e) => {
  const b = e.target.closest('button'), a = b?.dataset.a;
  if (a === 'sheet') openSheetNow('person');
  if (a === 'book') openSheetNow('book');
  if (a === 'sound') { score.start(); score.setEnabled(!score.on); b.textContent = `Sound: ${score.on ? 'on' : 'off'}`; }
  if (a === 'voice') { Voice.enabled = !Voice.enabled; if (!Voice.enabled) Voice.stop(); b.textContent = `Voices: ${Voice.enabled ? 'on' : 'off'}${Voice.enabled && !Voice.available ? ' (none found)' : ''}`; }
  if (a === 'new') { ctl?.abort(); Voice.stop(); startScreen(); }
});

// --- the start: choose a story, say who you are -------------------------------------------------------------

function startScreen() {
  document.querySelectorAll('.start, .sheet, .director-note').forEach((x) => x.remove());
  controls.hidden = true; corner.hidden = true; film2d.uiBottom = 0;
  sub.innerHTML = '';
  setFade(true);
  const saved = loadStory();
  let pick = OPENINGS[0];
  const el = h(`<div class="start"><div class="inner">
    <h1>Living Film</h1>
    <p class="tag">A story you live from the inside, like a film. Nothing is written in advance: say and do what you like, and Claude directs every place, person, shot and line as it happens, under the laws of the ORRERY engine.</p>
    <section><h2>Choose your story</h2><div class="openings">${OPENINGS.map((o, i) => `<button type="button" class="opening${i === 0 ? ' on' : ''}" data-id="${o.id}"><small>${esc(o.when)}</small><b>${esc(o.title)}</b><span>${esc(o.premise ? o.premise.slice(0, 160) + '…' : 'Write the beginning yourself: any time, any place, any life.')}</span></button>`).join('')}</div></section>
    <section class="form">
      <h2>Who you are</h2>
      <label class="own" hidden>Your story's beginning<textarea class="premise" maxlength="1500" placeholder="Where and when it begins, what kind of world, what is happening…"></textarea></label>
      <div class="row"><label>Your name<input class="name" maxlength="40" value="Anna"></label><label>You are<select class="sex"><option value="f">a woman</option><option value="m">a man</option></select></label></div>
      <label>Who you are, in a few words (your full character sheet is drawn up from this)<textarea class="who" maxlength="700"></textarea></label>
      <div class="row"><label>Hair<select class="hair"><option value="#2a1e14">black</option><option value="#4a3020" selected>brown</option><option value="#7a5a32">light brown</option><option value="#b08850">fair</option><option value="#8a3a1c">red</option><option value="#8a8478">grey</option></select></label><label>Clothes<select class="cloth"><option value="#5a4a34">undyed wool</option><option value="#7a2a22">madder red</option><option value="#2a3a5a">woad blue</option><option value="#2a2a2a">black</option><option value="#4a5a32">green</option><option value="#9a7a2a">weld yellow</option></select></label></div>
      <div class="row"><label>Intensity<select class="intensity"><option value="1">1 · still</option><option value="2" selected>2 · working</option><option value="3">3 · pressured</option></select></label><label>Speech<select class="period"><option value="heavy" selected>of its time</option><option value="light">lightly period</option><option value="modern">plain modern</option></select></label><label>Claude<select class="tier"><option value="default">Quick to answer</option><option value="complex">Deepest (slower)</option></select></label><label>Picture<select class="quality"><option value="high">3D, best</option><option value="medium">3D, lighter</option><option value="low">3D, lightest</option><option value="2d">Painted (no 3D)</option></select></label></div>
    </section>
    <div class="go">${saved ? `<button class="cont">Continue: ${esc(saved.player.name)}, ${esc(saved.scene?.name || 'the story')}</button>` : ''}<button class="primary begin">Begin</button></div>
    <p class="note claude-note">Claude writes the film for you; the first time, you will be asked to allow it. Before the first scene the period is researched: the four stories here carry notes looked up on the web when the film was made (sources are in the Codex), and for every story Claude also writes a dossier from what it knows, since the page itself cannot search the web.</p>
  </div></div>`);
  const who = el.querySelector('.who'), sex = el.querySelector('.sex');
  el.querySelector('.quality').value = quality;
  const choose = (o) => { pick = o; el.querySelectorAll('.opening').forEach((b) => b.classList.toggle('on', b.dataset.id === o.id)); el.querySelector('.own').hidden = o.id !== 'own'; if (o.who) who.value = o.who; };
  el.querySelectorAll('.opening').forEach((b) => b.addEventListener('click', () => choose(OPENINGS.find((o) => o.id === b.dataset.id))));
  choose(pick);
  el.querySelector('.quality').addEventListener('change', (e) => {
    try { localStorage.setItem('living-film-quality', e.target.value); } catch { /* storage blocked */ }
    if (e.target.value !== quality) el.querySelector('.claude-note').insertAdjacentHTML('afterbegin', '<b>The picture setting applies the next time the page is opened.</b> ');
  });
  claudeReady.then((s) => { if (!s) el.querySelector('.claude-note').innerHTML = '<span class="err">Claude is not available on this page, so the film cannot be written here.</span> Open Living Film on claude.ai to play.'; });
  el.querySelector('.begin').addEventListener('click', async () => {
    const premise = pick.id === 'own' ? el.querySelector('.premise').value.trim() : pick.premise;
    if (!premise) { el.querySelector('.premise').focus(); return; }
    score.start();
    clearStory();
    state = newStory({
      premise, opening: pick.id,
      settings: { intensity: +el.querySelector('.intensity').value, period: el.querySelector('.period').value },
      player: { name: el.querySelector('.name').value.trim() || 'Anna', sex: sex.value, who: who.value.trim(), look: { hair: el.querySelector('.hair').value, clothes: el.querySelector('.cloth').value, hairStyle: sex.value === 'f' ? 'braid' : 'short', hose: '#3a3028' } },
    });
    const pack = PACKS[pick.id];
    if (pack) { state.codex.title = pack.title; state.codex.sources = pack.sources; state.codex.entries = pack.facts.map((f, i) => ({ topic: `Researched ${i + 1}`, text: f, source: 'researched' })).concat([{ topic: 'Speech and address', text: pack.speech, source: 'researched' }]); }
    await claudeReady; await stageReady;
    director.tier = el.querySelector('.tier').value;
    begin(el, false);
  });
  el.querySelector('.cont')?.addEventListener('click', async () => { score.start(); state = saved; await claudeReady; await stageReady; begin(el, true); });
  ui.append(el);
}

async function research() {
  writing.hidden = false;
  writing.querySelector('em').textContent = 'researching the period';
  try {
    const r = await director.json(dossierPrompt(state.premise, PACKS[state.opening]), { tier: 'quick' });
    if (r?.title && !state.codex.title) state.codex.title = String(r.title).slice(0, 80);
    for (const e of (Array.isArray(r?.entries) ? r.entries : []).slice(0, 18)) if (e?.topic && e?.text) state.codex.entries.push({ topic: String(e.topic).slice(0, 40), text: String(e.text).slice(0, 700), source: 'claude' });
  } catch { /* the researched notes stand alone */ }
  writing.querySelector('em').textContent = 'the scene is being written';
  saveStory(state);
}

let observing = false;
async function begin(el, resumed) {
  el.remove();
  controls.hidden = false; corner.hidden = false; film2d.uiBottom = controlsHeight();
  if (!observing) { observing = true; new ResizeObserver(() => { film2d.uiBottom = controlsHeight(); }).observe(controls); }
  onStage = null;
  prebuild(Object.values(state.places));
  if (resumed && state.scene) {
    await enterScene({ ...state.scene, cut: true }, state.cast);
    if (stage && state.extras) stage.setExtras(state.extras);
    sub.innerHTML = `<p class="narr">${esc(state.summary.slice(0, 320))}</p>`;
    renderChips(); setControls(true);
  } else {
    await research();
    buildSheet();
    await turn(null);
  }
}

startScreen();
export { state, directorPrompt, AXES };
