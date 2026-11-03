import { Theatre3D } from './theatre3d/Theatre3D.js';
import { Runner } from './story/Runner.js';
import { TITLE, CHAPTERS, EPISODE } from './story/episode1.js';
import { Audio } from '../../../medengine/src/audio/Audio.js';
import { Claude } from '../../../medengine/src/ai/Claude.js';
import './style.css';

/**
 * BATMAN: VESPER — the film on the Med Engine 2.
 * URL flags (for development and the screenshot tools): ?auto=1 plays itself; ?chapter=ch1
 * starts there; ?q=ultra|high|medium|low; ?nocast=1 skips loading the cast (sets only).
 */
const P = new URLSearchParams(location.search);
const auto = P.get('auto') === '1';
const LS = 'vesper.settings';
const settings = Object.assign({ quality: 'high', subtitles: true, subSize: 1, voices: false, volume: 0.9 }, (() => { try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; } })());
if (P.get('q')) settings.quality = P.get('q');
const saveSettings = () => { try { localStorage.setItem(LS, JSON.stringify(settings)); } catch { /* */ } };

const canvas = document.getElementById('film');
const audio = new Audio();
const claude = new Claude();
const T = new Theatre3D(canvas, { audio, quality: settings.quality, auto });
window.vesper = { T, claude, audio };
window.__capture = () => { T.step(1 / 60); return canvas.toDataURL('image/jpeg', 0.92); };
T.stopAt = Number(P.get('stopAt') ?? 0) || null;
T.ui.subtitles = settings.subtitles; T.ui.subSize = settings.subSize; T.voices = settings.voices;

const $ = (s) => document.querySelector(s);
const menu = $('#menu'), loading = $('#loading'), bar = $('#loading .bar div'), lbl = $('#loading .lbl');

// ---------------------------------------------------------------- start-up
let castReady = Promise.resolve(), castDone = true;
const castCheck = () => castDone;
async function boot() {
  T.start();
  // the title backdrop: the cathedral at night
  lbl.textContent = 'Building Vesper…';
  await T.stage('cathedral');
  T.cut({ type: 'free', pos: [-2.2, 2.9, -1.6], target: [45, -6, 130] });
  if (P.get('nocast') !== '1') {
    // the title needs only Batman: the menu opens as soon as he is built, the rest of the cast
    // downloads in parallel and is built in the background (play() waits for it if it must)
    const ids = P.get('cast')?.split(',') ?? ['batman', 'rook', 'nadia', 'cruz', 'marrow', 'kow', 'dez', 'deckhand'];
    await T.loadCast((k, name) => { bar.style.width = `${Math.round(k * 100)}%`; lbl.textContent = `Casting ${name}…`; }, ids.slice(0, 1));
    castDone = false;
    castReady = T.loadCast(null, ids).then(() => { castDone = true; });
    T.place('batman', 'perch', 0);
    T.act('batman', { posture: 'perch' });
    T.cut({ type: 'free', pos: [-2.2, 2.9, -1.6], target: [45, -6, 130], focus: 'batman' });
  }
  loading.classList.add('done');
  window.__ready = true;
  if (auto) { $('#title').classList.add('hidden'); play(P.get('chapter')); return; }
  await claude.ready;
  updateClaudeStatus();
  menu.classList.add('on');
}

function updateClaudeStatus() {
  const s = $('#claude-status');
  s.textContent = claude.available ? `● ${claude.status}` : '○ Claude offline: the story plays from its script. Free text needs Claude.';
  s.className = claude.available ? 'ok' : '';
  $('#claude-key-row').style.display = claude.mode === 'artifact' || claude.mode === 'proxy' || window.claude ? 'none' : '';   // hosted pages cannot reach the API directly
}

// ---------------------------------------------------------------- play
let runner = null;
async function play(fromChapter = null, resume = null) {
  audio.start();
  audio.volume.master = settings.volume;
  $('#title').classList.add('hidden');
  menu.classList.remove('on');
  if (!castCheck()) {
    loading.classList.remove('done'); lbl.textContent = 'Casting…'; bar.style.width = '100%';
    await castReady;
    loading.classList.add('done');
  }
  runner = new Runner(T, claude);
  if (resume) { runner.state = resume.state; runner.flowchart = resume.flowchart ?? []; }
  window.vesper.runner = runner;
  try {
    await runner.play(fromChapter);
  } catch (e) {
    console.error(e);
    T.ui.notify('Something broke: ' + e.message, 'down');
  }
  window.__ended = true;
  await afterEpisode();
}

async function afterEpisode() {
  if (auto) return;   // the test tools read the result; no menus
  for (;;) {
    const pick = auto ? 'title' : await T.ui.flowchart(runner, CHAPTERS, [
      { id: 'night2', label: 'Continue: Night Two', primary: true },
      { id: 'again', label: 'Play again' },
      { id: 'title', label: 'Title' },
    ]);
    if (pick === 'night2') {
      await claude.ready;
      if (!claude.available) { T.ui.notify('Night Two is written live by Claude: connect Claude in Settings.', 'down'); openSettings(); continue; }
      await runner.continueStory();
      continue;
    }
    if (pick === 'again') return play();
    location.reload();
    return;
  }
}

// ---------------------------------------------------------------- menus
$('#new').onclick = () => play();
$('#continue').onclick = () => { const s = Runner.loadSave(); if (s?.chapter) play(s.chapter.startsWith('night') ? null : s.chapter, s); };
$('#chapters').onclick = () => {
  const box = $('#chapter-list');
  box.innerHTML = '';
  CHAPTERS.forEach((c, i) => { const b = document.createElement('button'); b.className = 'mbtn small'; b.textContent = `${i === 0 ? 'Prologue' : i === CHAPTERS.length - 1 ? 'Epilogue' : 'Chapter ' + i} · ${c.title}`; b.onclick = () => play(c.id); box.appendChild(b); });
  box.classList.toggle('on');
};
$('#settings').onclick = () => openSettings();
$('#about').onclick = () => $('#credits').classList.toggle('on');
if (!Runner.loadSave()) $('#continue').disabled = true;

function openSettings() {
  const S = $('#settings-panel');
  S.classList.add('on');
  $('#set-quality').value = settings.quality;
  $('#set-subs').checked = settings.subtitles;
  $('#set-subsize').value = String(settings.subSize);
  $('#set-voices').checked = settings.voices;
  $('#set-volume').value = String(settings.volume);
  $('#set-key').value = claude.settings.key ?? '';
  updateClaudeStatus();
}
$('#settings-close').onclick = () => {
  settings.quality = $('#set-quality').value;
  settings.subtitles = $('#set-subs').checked; settings.subSize = Number($('#set-subsize').value);
  settings.voices = $('#set-voices').checked; settings.volume = Number($('#set-volume').value);
  saveSettings();
  T.stageE.setQuality(settings.quality);
  T.stopAt = Number(P.get('stopAt') ?? 0) || null;
T.ui.subtitles = settings.subtitles; T.ui.subSize = settings.subSize; T.voices = settings.voices;
  audio.volume.master = settings.volume; if (audio.master) audio.master.gain.value = settings.volume;
  const k = $('#set-key').value.trim();
  if (k !== (claude.settings.key ?? '')) claude.setKey(k);
  updateClaudeStatus();
  $('#settings-panel').classList.remove('on');
};

// pause: Esc
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && runner && !$('#settings-panel').classList.contains('on')) {
    const p = $('#pause');
    p.classList.toggle('on');
    T.paused = T.ui.paused = p.classList.contains('on');
    T.timeScale = T.paused ? 0.0001 : 1;
  }
  if (e.key === 'F3') { e.preventDefault(); $('#stats').classList.toggle('on'); }
});
$('#resume').onclick = () => { $('#pause').classList.remove('on'); T.paused = T.ui.paused = false; T.timeScale = 1; };
$('#pause-settings').onclick = () => openSettings();
$('#pause-quit').onclick = () => location.reload();
setInterval(() => {
  const s = $('#stats');
  if (!s.classList.contains('on')) return;
  const r = T.stageE.r;
  s.textContent = `MED ENGINE 2 · ${r.qualityName} · ${r.width}x${r.height}\ndraws ${r.stats.drawCalls} · tris ${(r.stats.triangles / 1e3).toFixed(0)}k\nlights ${r.lightGrid.stats.lights} (spot shadows ${r.lightGrid.stats.shadowed}, max ${r.lightGrid.stats.maxPerTile}/tile)\n${r.timing?.gpuAvailable ? `GPU ${r.timing.gpu.toFixed(1)} ms · ` : ''}CPU ${(r.timing?.cpu ?? 0).toFixed(1)} ms\nClaude: ${claude.status}`;
}, 500);

document.title = `${TITLE.name} — ${TITLE.episodeTitle}`;
void EPISODE;
boot().catch((e) => { console.error(e); lbl.textContent = 'Could not start: ' + e.message; });
