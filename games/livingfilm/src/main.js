/**
 * Living Film: a story lived like a film.
 *
 * You choose a story (or write your own) and say who you are. Claude, as
 * the director, writes the film moment by moment: the places, the people
 * and what they feel, every shot and every line. You answer by saying or
 * doing whatever you like, in your own words or from the suggestions it
 * writes for that moment, and the film goes on from there.
 */
import { Film } from './render/film.js';
import { Director, cleanReply } from './director.js';
import { newStory, applyReply, saveStory, loadStory, clearStory, OPENINGS } from './story.js';
import { Voice } from './voice.js';

const ui = document.getElementById('ui');
const film = new Film(document.getElementById('film'));
const params = new URLSearchParams(location.search);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Words between asterisks are what someone does: shown in italics. */
const deeds = (s) => esc(s).replace(/\*([^*]+)\*/g, '<i class="act">$1</i>');

let state = null, director = null, sample = null, busy = false, skip = null, ctl = null;

// --- Claude --------------------------------------------------------------------------------------

const claudeReady = (async () => {
  if (params.get('demo')) { const { demoSample } = await import('./demo.js'); return demoSample; }
  try { return (await window.claude?.use?.('sample')) ?? null; } catch { return null; }
})().then((s) => { sample = s; director = new Director(s); return s; });

// --- the projector loop ----------------------------------------------------------------------------

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  film.frame(dt);
  placeOverlays();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- overlays: subtitles, title card, the director writing ---------------------------------------

const sub = h('<div class="sub" aria-live="polite"></div>');
const card = h('<div class="card"><h2></h2><p></p></div>');
const writing = h('<div class="writing" hidden>the scene is being written<span>.</span><span>.</span><span>.</span></div>');
ui.append(sub, card, writing);

function placeOverlays() {
  const F = film.frameRect(), d = film.dpr;
  const bottom = (F.y + F.h) / d;
  sub.style.top = ''; sub.style.bottom = `${innerHeight - bottom + Math.max(10, F.h / d * 0.035)}px`;
  writing.style.top = `${bottom - 34}px`;
}

function showSub(beat) {
  const who = beat.who === 'you' ? state.player.name : beat.who ? state.cast[beat.who]?.name : null;
  sub.innerHTML = `${beat.narration ? `<p class="narr">${esc(beat.narration)}</p>` : ''}${beat.line ? `<p class="line"><span class="who">${esc(who ?? '')}</span>${deeds(beat.line)}</p>` : ''}`;
}
function showYou(input) {
  sub.innerHTML = `<p class="line me"><span class="who">${esc(state.player.name)}</span>${input.kind === 'do' ? `<i>${esc(input.text)}</i>` : esc(input.text)}</p>`;
}

async function titleCard(scene) {
  card.querySelector('h2').textContent = scene.name || scene.place;
  card.querySelector('p').textContent = `${scene.time}${scene.weather !== 'clear' ? ` · ${scene.weather}` : ''}`;
  card.classList.add('on'); await wait(1900); card.classList.remove('on'); await wait(500);
}

// --- playing a turn --------------------------------------------------------------------------------

const words = (s) => (s.match(/\S+/g) ?? []).length;

async function playBeats(r) {
  if (r.scene.cut || !film.set) {
    film.fadeOut(); await wait(700);
    sub.innerHTML = '';
    film.setCast(r.cast, state.player); film.setScene(r.scene);
    await titleCard(r.scene);
    film.fadeIn();
  } else { film.setCast(r.cast, state.player); film.setScene(r.scene); }
  for (const b of r.beats) {
    const est = 1.4 + (words(b.narration) + words(b.line)) / 2.6;
    film.showBeat(b, est + 1.5);
    showSub(b);
    let skipped = false;
    const skipP = new Promise((res) => { skip = () => { skipped = true; res(); }; });
    const timeP = wait(est * 1000);
    const c = b.who && state.cast[b.who];
    const voiceP = (async () => {
      if (b.narration) await Voice.say(b.narration, { who: 'narrator', sex: null, pitch: 0.9, rate: 1, volume: 0.85 });
      if (b.line) { film.speaking = b.who; await Voice.say(b.line, { who: b.who, sex: c?.sex, pitch: c?.voice?.pitch ?? 1, rate: c?.voice?.rate ?? 1 }); }
    })();
    // mouths move for as long as the line is being read or spoken
    if (b.line) { film.speaking = b.who; setTimeout(() => { if (!Voice.enabled) film.speaking = null; }, Math.min(est * 1000, 600 + words(b.line) * 330)); }
    await Promise.race([Promise.all([timeP, voiceP]), skipP]);
    if (skipped) Voice.stop();
    film.speaking = null;
    skip = null;
  }
}

async function turn(input) {
  if (busy || !director) return;
  busy = true; setControls(false);
  if (input) showYou(input);
  writing.hidden = false;
  ctl = new AbortController();
  try {
    const r = await director.turn(state, input, { signal: ctl.signal });
    writing.hidden = true;
    applyReply(state, input, r);
    saveStory(state);
    await playBeats(r);
    renderChips();
  } catch (e) {
    writing.hidden = true;
    const why = e?.code === 'rate_limited' ? 'Claude is busy just now. Wait a moment and try again.' : e?.code === 'not_granted' ? 'Claude was not allowed for this page. Allow it from the page\'s permissions to go on.' : e?.code === 'no_claude' ? 'Claude is not available here, so the film cannot be written. Open it on claude.ai.' : e?.code === 'cancelled' ? '' : 'The scene could not be written. Try again.';
    if (why) sub.innerHTML = `<p class="line err">${esc(why)}</p>`;
    if (input) inputEl.value = input.text;
  }
  busy = false; setControls(true);
}

// --- what you say and do -----------------------------------------------------------------------------

const controls = h(`<div class="controls" hidden>
  <div class="chips"></div>
  <form class="say"><div class="mode"><button type="button" data-m="say" class="on">Say</button><button type="button" data-m="do">Do</button></div><input maxlength="400" autocomplete="off" placeholder="Say anything…" aria-label="What you say or do"><button class="primary" type="submit">Go</button></form>
  <div class="hint">Click the picture or press Space to move on · write in your own words, or choose</div></div>`);
ui.append(controls);
const inputEl = controls.querySelector('input');
let mode = 'say';
function setMode(m) { mode = m; controls.querySelectorAll('.mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === m)); inputEl.placeholder = m === 'say' ? 'Say anything…' : 'Do anything: I take her hand… I walk out into the rain…'; }
controls.querySelectorAll('.mode button').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.m); inputEl.focus(); }));
controls.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const t = inputEl.value.trim(); if (!t || busy) return; inputEl.value = ''; turn({ kind: mode, text: t }); });
function setControls(on) { inputEl.disabled = !on; controls.querySelectorAll('button').forEach((b) => { b.disabled = !on; }); if (on) inputEl.focus({ preventScroll: true }); }
function renderChips() {
  const C = controls.querySelector('.chips');
  C.innerHTML = '';
  for (const s of state.suggestions ?? []) {
    const b = h(`<button type="button"><span class="k">${s.kind}</span>${esc(s.text)}</button>`);
    b.addEventListener('click', () => { if (!busy) turn(s); });
    C.append(b);
  }
}
function measure() { film.uiBottom = controls.hidden ? 0 : controls.getBoundingClientRect().height; }
new ResizeObserver(measure).observe(controls);

document.getElementById('film').addEventListener('click', () => skip?.());
addEventListener('keydown', (e) => { if (e.code === 'Space' && document.activeElement !== inputEl && skip) { e.preventDefault(); skip(); } });

// --- the corner: the story so far, voices, a new film -----------------------------------------------

const corner = h('<div class="corner" hidden><button data-a="story">The story</button><button data-a="voice">Voices: off</button><button data-a="new">New film</button></div>');
ui.append(corner);
corner.addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.a;
  if (a === 'story') storyPanel();
  if (a === 'voice') { Voice.enabled = !Voice.enabled; if (!Voice.enabled) Voice.stop(); e.target.textContent = `Voices: ${Voice.enabled ? 'on' : 'off'}${Voice.enabled && !Voice.available ? ' (none found)' : ''}`; }
  if (a === 'new') { ctl?.abort(); Voice.stop(); startScreen(); }
});

function storyPanel() {
  document.querySelector('.panel')?.remove();
  const cast = Object.values(state.cast);
  const feel = (f) => (f > 60 ? 'loves you' : f > 25 ? 'fond of you' : f > 5 ? 'warm' : f > -10 ? 'unsure of you' : f > -40 ? 'cold' : 'hostile');
  const p = h(`<div class="panel"><button class="close">Close</button>
    <h3>${esc(state.player.name)}</h3><p>${esc(state.player.who)}</p>
    <h3>The story so far</h3><p>${esc(state.summary || 'It has only just begun.')}</p>
    ${state.chronicle.length ? `<h3>Never forgotten</h3>${state.chronicle.slice().reverse().map((c) => `<p>${esc(c)}</p>`).join('')}` : ''}
    <h3>The people</h3>${cast.length ? cast.map((c) => `<div class="person"><b>${esc(c.name)}</b><span class="feel">${esc(feel(c.feeling))}</span><small>${esc(c.role)}${c.note ? ` · ${esc(c.note)}` : ''}</small></div>`).join('') : '<p>Nobody yet.</p>'}
    <h3>The premise</h3><p>${esc(state.premise)}</p></div>`);
  p.querySelector('.close').addEventListener('click', () => p.remove());
  ui.append(p);
}

// --- the start: choose a story, say who you are ------------------------------------------------------

function startScreen() {
  document.querySelector('.start')?.remove();
  document.querySelector('.panel')?.remove();
  controls.hidden = true; corner.hidden = true; measure();
  sub.innerHTML = '';
  const saved = loadStory();
  let pick = OPENINGS[0];
  const el = h(`<div class="start"><div class="inner">
    <h1>Living Film</h1>
    <p class="tag">A story you live from the inside, like a film. Nothing is written in advance: say and do what you like, and Claude directs every place, person, shot and line as it happens.</p>
    <section><h2>Choose your story</h2><div class="openings">${OPENINGS.map((o, i) => `<button type="button" class="opening${i === 0 ? ' on' : ''}" data-id="${o.id}"><small>${esc(o.when)}</small><b>${esc(o.title)}</b><span>${esc(o.premise ? o.premise.slice(0, 150) + '…' : 'Write the beginning yourself: any time, any place, any life.')}</span></button>`).join('')}</div></section>
    <section class="form">
      <h2>Who you are</h2>
      <label class="own" hidden>Your story's beginning<textarea class="premise" maxlength="1200" placeholder="Where and when it begins, what kind of world, what is happening…"></textarea></label>
      <div class="row"><label>Your name<input class="name" maxlength="40" value="Anna"></label><label>You are<select class="sex"><option value="f">a woman</option><option value="m">a man</option></select></label></div>
      <label>Who you are, in a few words<textarea class="who" maxlength="500"></textarea></label>
      <div class="row"><label>Hair<select class="hair"><option value="#2a1e14">black</option><option value="#4a3020" selected>brown</option><option value="#7a5a32">light brown</option><option value="#b08850">fair</option><option value="#8a3a1c">red</option></select></label><label>Clothes<select class="cloth"><option value="#5a4a34">undyed wool</option><option value="#7a2a22">madder red</option><option value="#2a3a5a">woad blue</option><option value="#2a2a2a">black</option><option value="#4a5a32">green</option></select></label><label>Claude<select class="tier"><option value="default">Quick to answer</option><option value="complex">Deepest (slower)</option></select></label></div>
    </section>
    <div class="go">${saved ? `<button class="cont">Continue: ${esc(saved.player.name)}, ${esc(saved.scene?.name || 'the story')}</button>` : ''}<button class="primary begin">Begin</button></div>
    <p class="note claude-note">Claude writes the film for you; the first time, you will be asked to allow it. Everything you see and hear is written live for your story. Turn voices on in the corner if you like.</p>
  </div></div>`);
  const who = el.querySelector('.who'), sex = el.querySelector('.sex');
  const choose = (o) => { pick = o; el.querySelectorAll('.opening').forEach((b) => b.classList.toggle('on', b.dataset.id === o.id)); el.querySelector('.own').hidden = o.id !== 'own'; if (o.who) who.value = o.who; };
  el.querySelectorAll('.opening').forEach((b) => b.addEventListener('click', () => choose(OPENINGS.find((o) => o.id === b.dataset.id))));
  choose(pick);
  claudeReady.then((s) => { if (!s) { el.querySelector('.claude-note').innerHTML = '<span class="err">Claude is not available on this page, so the film cannot be written here.</span> Open Living Film on claude.ai to play.'; } });
  el.querySelector('.begin').addEventListener('click', async () => {
    const premise = pick.id === 'own' ? el.querySelector('.premise').value.trim() : pick.premise;
    if (!premise) { el.querySelector('.premise').focus(); return; }
    clearStory();
    state = newStory({ premise, player: { name: el.querySelector('.name').value.trim() || 'Anna', sex: sex.value, who: who.value.trim(), look: { hair: el.querySelector('.hair').value, clothes: el.querySelector('.cloth').value, hairStyle: sex.value === 'f' ? 'braid' : 'short' } } });
    await claudeReady;
    director.tier = el.querySelector('.tier').value;
    begin(el, null);
  });
  el.querySelector('.cont')?.addEventListener('click', async () => { state = saved; await claudeReady; begin(el, saved); });
  ui.append(el);
}

async function begin(el, resumed) {
  el.remove();
  controls.hidden = false; corner.hidden = false; measure();
  film.setCast(state.cast, state.player);
  if (resumed && state.scene) {
    film.setScene(state.scene);
    film.fadeIn();
    const last = [...state.log].reverse().find((l) => l.who && l.who !== 'you');
    film.showBeat({ shot: last ? 'medium' : 'establishing', on: last ? [last.who] : [], who: null, move: 'drift', emotion: 'neutral', narration: '', line: '' }, 8);
    sub.innerHTML = `<p class="narr">${esc(state.summary.slice(0, 300))}</p>`;
    renderChips(); setControls(true);
  } else {
    await turn(null);
  }
}

startScreen();
export { state, film, cleanReply };
