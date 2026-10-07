/**
 * The character sheet, made like a Netherlandish panel of the fifteenth
 * century: a gilded frame, red brocade with gold pomegranates, a band of
 * ermine, blackletter headings, and the portrait set before a painted
 * landscape (blue-green hills, a castle on its rock, a road, a hedge of
 * roses). The portrait itself is taken from the stage, by the same engine
 * that films the story.
 *
 * Everything ORRERY tracks is here: the person in their layers, the body
 * and mind, skills and means, standing and reputation, every named person
 * with the five standings, the world and the threads, the ledgers (what
 * the narrator holds back is behind a veil you lift yourself), the book of
 * chapters, the full status updates, the Codex of period notes, and the
 * continuity ledger to carry the story anywhere.
 */
import { AXES, continuityLedger } from '../orrery/state.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const has = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const val = (v) => (Array.isArray(v) ? v.map(esc).join(' · ') : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `<b>${esc(k)}</b> ${val(x)}`).join(' · ') : esc(v));
const rows = (o, labels) => labels.filter(([k]) => has(o?.[k])).map(([k, l]) => `<div class="row"><dt>${esc(l)}</dt><dd>${val(o[k])}</dd></div>`).join('');
const section = (title, inner, note = '') => (inner ? `<section><h3>${esc(title)}</h3>${note ? `<p class="note">${esc(note)}</p>` : ''}<dl>${inner}</dl></section>` : '');
const bar = (v, max = 10, cls = '') => `<span class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, (Number(v) || 0) / max * 100))}%"></i></span>`;

// ORRERY Book III field names, in its order, with their labels
const PUBLIC = [['age', 'Age'], ['origin', 'Origin'], ['languages', 'Languages'], ['face', 'Face'], ['body', 'Body'], ['hands', 'Hands'], ['voice', 'Voice'], ['gait', 'Gait'],
  ['clothing', 'Clothing'], ['accessories', 'Carried'], ['grooming', 'Grooming'], ['smell', 'Smell'], ['perception', 'How others read them'], ['bearing', 'Bearing and habit'], ['marks', 'Marks of the life'], ['firstWord', 'First words']];
const PRIVATE = [['coreWant', 'Core want'], ['coreFear', 'Core fear'], ['coreWound', 'Core wound'], ['selfImage', 'Self-image'], ['gap', 'The gap'], ['selfDeception', 'Self-deception'], ['defence', 'Defence'],
  ['moralFloor', 'Moral floor'], ['alreadyCrossed', 'Already crossed'], ['personality', 'Contradictions'], ['goals', 'Goals'], ['secrets', 'Secrets'], ['faith', 'Faith'], ['superstitions', 'Superstitions'],
  ['loyalty', 'Loyalty, in order'], ['prejudices', 'Prejudices'], ['attachments', 'Attachments'], ['appetites', 'Appetites and comforts'], ['competence', 'Believes and is'], ['speech', 'Speech']];
const STANDING = [['kin', 'Kin and household'], ['position', 'Position'], ['patron', 'Patron'], ['enemies', 'Enemies'], ['obligations', 'Obligations'], ['legal', 'Legal standing'], ['mobility', 'Mobility'], ['whoWouldNotice', 'Who would notice tonight']];
const ROUTINE = [['day', 'The ordinary day'], ['arcStart', 'Where they started']];
const MEANS = [['money', 'Purse'], ['standing', 'Standing'], ['burn', 'Daily cost'], ['runway', 'Runway'], ['income', 'Income'], ['debtsOwed', 'Owes'], ['debtsHeld', 'Is owed'], ['worn', 'Worn'], ['carried', 'Carried'], ['stored', 'Stored'], ['property', 'Property'], ['consumables', 'Supplies'], ['sentimental', 'Kept for love']];

const TABS = [['person', 'The Person'], ['body', 'Body & Mind'], ['means', 'Skills & Means'], ['people', 'The People'], ['world', 'The World'], ['book', 'The Book'], ['reckoning', 'Reckoning'], ['codex', 'Codex'], ['ledger', 'Ledger']];

/** The painted landscape behind the portrait (SVG), after the panel's distant hills, castle and roses. */
export function landscapeSVG() {
  const rose = (x, y, r, c) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${c}"/><circle r="${r * 0.62}" fill="#ffffff" opacity=".18"/><path d="M${-r * 0.5} 0 q${r * 0.5} ${-r * 0.7} ${r} 0" stroke="#5a0c12" stroke-width="${r * 0.18}" fill="none" opacity=".5"/></g>`;
  let roses = '';
  for (let i = 0; i < 26; i++) { const x = (i * 37) % 300 + ((i * 7) % 11), y = 368 + ((i * 13) % 22); roses += rose(x, y, 4 + (i % 3), i % 4 ? '#b8202c' : '#e6a0a8'); }
  let leaves = '';
  for (let i = 0; i < 60; i++) { const x = (i * 53) % 300, y = 360 + ((i * 17) % 40); leaves += `<ellipse cx="${x}" cy="${y}" rx="6" ry="3" transform="rotate(${(i * 47) % 180} ${x} ${y})" fill="${i % 2 ? '#2e4a22' : '#3c5c2a'}"/>`; }
  return `<svg class="land" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f9fb8"/><stop offset=".55" stop-color="#c9d6d2"/><stop offset="1" stop-color="#ece4c8"/></linearGradient>
  <linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8aa6b0"/><stop offset="1" stop-color="#a9bcae"/></linearGradient></defs>
  <rect width="300" height="400" fill="url(#sky)"/>
  <path d="M0 200 Q40 160 80 185 T160 175 T240 165 T300 180 V260 H0Z" fill="url(#far)"/>
  <path d="M0 235 Q60 205 120 228 T230 215 T300 225 V300 H0Z" fill="#6f8a6a"/>
  <g fill="#9a9488" stroke="#6a6458" stroke-width=".8"><path d="M196 214 l0 -34 l6 0 l0 -10 l4 6 l4 -6 l0 10 l6 0 l0 34z"/><path d="M214 214 l0 -22 l14 0 l0 22z"/><path d="M226 214 l0 -40 l3 -8 l3 8 l0 40z"/><path d="M182 214 l0 -18 l12 0 l0 18z"/></g>
  <g fill="#c24a2a"><path d="M196 180 l9 -12 l9 12z"/><path d="M225 174 l4 -10 l4 10z"/></g>
  <path d="M170 216 Q200 206 240 214 L250 222 L165 224Z" fill="#7a7466"/>
  <path d="M0 262 Q80 240 160 258 T300 252 V400 H0Z" fill="#4f6a3e"/>
  <path d="M140 400 Q150 330 196 262 L204 262 Q170 330 176 400Z" fill="#b8a678" opacity=".85"/>
  <g fill="#2a3e22">${[[40, 250, 13], [64, 244, 10], [262, 246, 12], [118, 252, 8], [284, 254, 9]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/><rect x="${x - 1.2}" y="${y}" width="2.4" height="${r}" fill="#3a2a1a"/>`).join('')}</g>
  <g opacity=".5" fill="#ffffff"><ellipse cx="70" cy="90" rx="38" ry="7"/><ellipse cx="230" cy="70" rx="30" ry="5"/></g>
  <rect y="352" width="300" height="48" fill="#24361c"/>${leaves}${roses}
</svg>`;
}

function personTab(P) {
  const S = P.sheet ?? {};
  const drift = (P.moral?.drift ?? []).slice(-8);
  return `${section('Public', rows(S, PUBLIC), has(S) ? '' : 'The full portrait is being written; it fills in as the story learns who you are.')}
  ${section('Private', rows(S, PRIVATE))}
  ${section('Standing in the world', rows(S, STANDING))}
  ${section('Routine and arc', rows(S, ROUTINE) + (drift.length ? `<div class="row"><dt>Drift log</dt><dd>${drift.map(esc).join('<br>')}</dd></div>` : ''))}`;
}

const HUNGER = (h) => (h >= 36 ? 'desperation' : h >= 18 ? 'impaired' : h >= 6 ? 'irritable' : 'fed');
const SLEEP = (h) => (h >= 72 ? 'dangerous' : h >= 48 ? 'hallucination risk' : h >= 24 ? 'judgement slipping' : 'rested enough');
const FATIGUE = (f) => (f >= 10 ? 'collapse' : f >= 8 ? 'fine motor failing' : f >= 6 ? 'judgement degrading' : f >= 3 ? 'tired' : 'fresh');

function bodyTab(P) {
  const B = P.body ?? {}, E = P.emotion ?? {}, K = P.knowledge ?? {}, M = P.moral ?? {};
  const g = (label, v, max, word) => `<div class="gauge"><span>${label}</span>${bar(v, max)}<em>${esc(v ?? 0)}${max === 10 ? '/10' : 'h'} · ${esc(word)}</em></div>`;
  return `<section><h3>The body</h3>
    ${g('Fatigue', B.fatigue, 10, FATIGUE(B.fatigue ?? 0))}${g('Pain', B.pain, 10, (B.pain ?? 0) >= 6 ? 'contaminates everything' : (B.pain ?? 0) >= 3 ? 'nagging' : 'little')}
    ${g('Hunger', B.hunger, 48, HUNGER(B.hunger ?? 0))}${g('Thirst', B.thirst, 24, (B.thirst ?? 0) >= 12 ? 'thinking slows' : 'enough')}${g('Since sleep', B.sleep, 72, SLEEP(B.sleep ?? 0))}
    <dl>${rows(B, [['injuries', 'Injuries'], ['illness', 'Illness'], ['strain', 'Strain'], ['chronic', 'Old hurts'], ['substance', 'Substance'], ['cleanliness', 'Cleanliness']])}</dl></section>
  ${section('The mind', rows(E, [['primary', 'Feeling'], ['undercurrent', 'Beneath it'], ['suppression', 'Held down'], ['triggers', 'Triggers']]))}
  <section><h3>Moral position</h3><div class="axis"><span>Lawful</span>${bar(M.order ?? 5, 10, 'two')}<span>Chaotic</span></div><div class="axis"><span>Selfless</span>${bar(M.regard ?? 5, 10, 'two')}<span>Predatory</span></div></section>
  ${section('What you know', rows(K, [['knows', 'Knows'], ['believes', 'Believes'], ['suspects', 'Suspects']]), 'Only what your character has seen or been told. What you are wrong about, the narrator keeps.')}`;
}

function meansTab(P) {
  const skills = Object.entries(P.skills ?? {}).sort((a, b) => (b[1].v ?? 0) - (a[1].v ?? 0));
  const rep = P.reputation ?? {};
  return `<section><h3>Capabilities</h3>${skills.length ? skills.map(([k, s]) => `<div class="skill"><span>${esc(k)}</span>${bar(s.v ?? s)}<b>${esc(s.v ?? s)}</b>${s.why ? `<small>${esc(s.why)}</small>` : ''}</div>`).join('') : '<p class="note">Earned and lost in play.</p>'}</section>
  ${section('Means', rows(P.means, MEANS))}
  ${section('Reputation', Object.entries(rep).map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd>${val(v)}</dd></div>`).join(''))}`;
}

function peopleTab(state) {
  const people = Object.values(state.cast).sort((a, b) => ['core', 'standing', 'ambient'].indexOf(a.tier) - ['core', 'standing', 'ambient'].indexOf(b.tier));
  if (!people.length) return '<p class="note">Nobody yet.</p>';
  return people.map((c) => `<article class="person${c.alive === false ? ' dead' : ''}">
    <header><b>${esc(c.name)}</b><span class="tier">${esc(c.alive === false ? 'dead' : c.tier)}</span></header>
    <p>${esc(c.role)}</p>
    <div class="axes">${AXES.map((a) => `<div><span>${a}</span>${bar(c.axes?.[a], 10, a)}<b>${esc(c.axes?.[a] ?? '–')}</b></div>`).join('')}</div>
    ${c.state ? `<p class="now">${esc(c.state)}</p>` : ''}${c.intent ? `<p class="now"><i>Wants now:</i> ${esc(c.intent)}</p>` : ''}
  </article>`).join('');
}

function worldTab(state, reveal) {
  const W = state.world ?? {}, T = state.threads ?? {}, C = state.clock ?? {};
  const veil = !reveal ? `<button class="veil" data-reveal="1">Lift the veil: show what the narrator holds (spoils the story)</button>` : '';
  const armed = state.ledger.slice().reverse();
  return `${section('The hour', rows(C, [['date', 'Date'], ['time', 'Time'], ['season', 'Season']]))}
  ${section('The world', rows(W, [['macro', 'The great events'], ['regional', 'Here'], ['economy', 'Prices and plenty'], ['mood', 'The mood'], ['rumours', 'Rumours'], ['scapegoats', 'Blamed'], ['last7', 'This week'], ['approaching', 'Coming']]))}
  ${section('The threads', [T.A && `<div class="row"><dt>A · the pressure</dt><dd>${val(T.A)}</dd></div>`, T.B && `<div class="row"><dt>B · the personal</dt><dd>${val(T.B)}</dd></div>`, ...(T.C ?? []).map((t) => `<div class="row"><dt>C · slow burn</dt><dd>${val(t)}</dd></div>`)].filter(Boolean).join(''))}
  ${veil}${reveal ? `${section('The consequence ledger', armed.map((e) => `<div class="row"><dt>${esc(e.at ?? '')} · ${esc(e.status)}</dt><dd>${esc(e.action)}${e.witnesses ? ` <i>Witnesses:</i> ${esc(e.witnesses)}` : ''}${(e.pending ?? []).map((p) => `<br><b>${esc(p.horizon)}</b> ${esc(p.what)}${p.trigger ? ` <i>(when ${esc(p.trigger)})</i>` : ''}`).join('')}</dd></div>`).join(''))}
  ${section('The promise ledger', state.promises.map((p) => `<div class="row"><dt>${esc(p.status)}</dt><dd>${esc(p.planted)} → ${esc(p.payoff)}</dd></div>`).join(''))}
  ${section('The silent layer', rows(state.silent, [['plots', 'Hidden plots'], ['antagonist', 'The antagonist'], ['wrongAbout', 'You are wrong about'], ['withheld', 'Withheld'], ['notes', 'Notes']]))}` : ''}`;
}

function bookTab(state) {
  if (!state.chapters.length) return '<p class="note">The book begins with the first scene.</p>';
  const who = (id) => (id === 'you' ? state.player.name : state.cast[id]?.name ?? state.extras?.[id]?.label ?? id);
  return state.chapters.map((ch, i) => `<details class="chapter"${i === state.chapters.length - 1 ? ' open' : ''}><summary><span class="num">${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][i] ?? i + 1}</span> ${esc(ch.title)}</summary>
    ${ch.scenes.map((sc) => `<div class="scene"><h4>${esc(sc.name)}${sc.date ? ` <small>${esc(sc.date)}${sc.time ? ', ' + esc(sc.time) : ''}</small>` : ''}</h4>
      ${sc.beats.map((b) => (b.line ? `<p class="said"><b>${esc(who(b.who))}</b>${b.action ? ` <i>${esc(b.action)}</i>` : ''} “${esc(b.line)}”</p>` : '') + (b.narration ? `<p>${esc(b.narration)}</p>` : '')).join('')}
    </div>`).join('')}</details>`).join('');
}

/** A full status update (ORRERY Part Four), as the panel shows it. */
export function reportHTML(r, state) {
  if (!r) return '<p class="note">The first full status update comes after a few scenes, and every three to five scenes after that. Ask for one any time with [[stats]].</p>';
  const sec = (t, k) => (r[k] ? `<div class="row"><dt>${t}</dt><dd>${esc(r[k])}</dd></div>` : '');
  return `<section><h3>${esc(state.player.name)} — Complete profile</h3><dl>${sec('Profile', 'profile')}${sec('Psychology', 'psychology')}${sec('Appearance', 'appearance')}${sec('Belief, attachment, appetite', 'belief')}${sec('Speech', 'speech')}${sec('Standing', 'standing')}${sec('Routine and arc', 'routine')}${sec('Emotional state', 'emotion')}${sec('Wealth and resources', 'wealth')}</dl></section>
  ${r.skills?.length ? `<section><h3>Skills</h3>${r.skills.map((s) => `<div class="skill"><span>${esc(s.name)}</span>${bar(s.v)}<b>${s.v}</b>${s.why ? `<small>${esc(s.why)}</small>` : ''}</div>`).join('')}</section>` : ''}
  ${r.fame?.length ? `<section><h3>Fame and reputation</h3>${r.fame.map((f) => `<div class="skill"><span>${esc(f.group)}</span>${bar(f.score)}<b>${f.score}</b><small>${esc(f.trend)}${f.note ? ' · ' + esc(f.note) : ''}</small></div>`).join('')}</section>` : ''}
  <section><h3>Environment — complete detail</h3><dl>${sec('Where and when', 'environment')}${sec('The senses', 'senses')}${sec('Concurrent events', 'concurrent')}</dl></section>
  ${r.npcs?.length ? `<section><h3>The people</h3>${r.npcs.map((n) => `<article class="person"><header><b>${esc(n.name)}</b></header><div class="axes">${AXES.map((a) => `<div><span>${a}</span>${bar(n[a], 10, a)}<b>${n[a] ?? '–'}</b></div>`).join('')}</div>${n.state ? `<p class="now">${esc(n.state)}</p>` : ''}${n.intent ? `<p class="now"><i>Intent:</i> ${esc(n.intent)}</p>` : ''}</article>`).join('')}</section>` : ''}
  ${r.inMotion?.length ? `<section class="motion"><h3>In motion</h3>${r.inMotion.map((m) => `<p>${esc(m)}</p>`).join('')}</section>` : ''}`;
}

function reckoningTab(state, which) {
  if (!state.reports.length) return reportHTML(null, state);
  const i = which ?? state.reports.length - 1, R = state.reports[i];
  const nav = state.reports.length > 1 ? `<nav class="reports">${state.reports.map((x, k) => `<button data-report="${k}" class="${k === i ? 'on' : ''}">Scene ${x.scene}</button>`).join('')}</nav>` : '';
  return `${nav}<p class="note">${esc(R.date || '')} · after scene ${R.scene}</p>${reportHTML(R.report, state)}`;
}

function codexTab(state) {
  const C = state.codex ?? {};
  return `<p class="note">Period notes the director reads before every scene. ${C.sources?.length ? 'The notes marked “researched” were looked up on the web when this film was made; the rest Claude wrote from what it knows and may contain mistakes.' : 'Claude wrote these from what it knows, since the page cannot search the web; they may contain mistakes.'}</p>
  ${C.title ? `<h3>${esc(C.title)}</h3>` : ''}<dl>${(C.entries ?? []).map((e) => `<div class="row"><dt>${esc(e.topic)}${e.source === 'researched' ? ' <span class="tag">researched</span>' : ''}</dt><dd>${esc(e.text)}</dd></div>`).join('')}</dl>
  ${C.sources?.length ? `<section><h3>Sources</h3>${C.sources.map((u) => `<p><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, ''))}</a></p>`).join('')}</section>` : ''}`;
}

function ledgerTab(state) {
  return `<p class="note">ORRERY's continuity ledger: the whole story in one block. Paste it anywhere to carry the story on; it is also kept in this browser.</p><button class="copy">Copy the ledger</button><pre class="ledger">${esc(continuityLedger(state))}</pre>`;
}

/**
 * Open the sheet. opts: { tab, portrait (an image URL from the stage), onClose }.
 */
export function openSheet(state, { tab = 'person', portrait = null, onClose = () => {} } = {}) {
  document.querySelector('.sheet')?.remove();
  const P = state.player;
  let reveal = false, which = null;
  const el = h(`<div class="sheet" role="dialog" aria-label="Character sheet"><div class="frame">
    <aside class="wing">
      <div class="niche">${landscapeSVG()}${portrait ? `<img class="portrait" alt="${esc(P.name)}" src="${portrait}">` : `<div class="portrait none"></div>`}</div>
      <div class="ermine"></div>
      <h2>${esc(P.name)}</h2>
      <p class="who">${esc(P.who)}</p>
      <div class="quick">${['fatigue', 'pain'].map((k) => `<div><span>${k}</span>${bar(P.body?.[k])}</div>`).join('')}${P.means?.money ? `<div><span>purse</span><em>${esc(P.means.money)}</em></div>` : ''}${P.emotion?.primary ? `<div><span>feeling</span><em>${esc(P.emotion.primary)}</em></div>` : ''}</div>
    </aside>
    <main class="leaf"><nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</nav><div class="page"></div></main>
    <button class="shut" aria-label="Close">✕</button>
  </div></div>`);
  const page = el.querySelector('.page');
  const show = (k) => {
    tab = k;
    el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    page.innerHTML = k === 'person' ? personTab(P) : k === 'body' ? bodyTab(P) : k === 'means' ? meansTab(P) : k === 'people' ? peopleTab(state) : k === 'world' ? worldTab(state, reveal)
      : k === 'book' ? bookTab(state) : k === 'reckoning' ? reckoningTab(state, which) : k === 'codex' ? codexTab(state) : ledgerTab(state);
    page.scrollTop = 0;
  };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (e.target === el || t?.classList.contains('shut')) { el.remove(); onClose(); return; }
    if (!t) return;
    if (t.dataset.tab) show(t.dataset.tab);
    if (t.dataset.reveal) { reveal = true; show('world'); }
    if (t.dataset.report) { which = +t.dataset.report; show('reckoning'); }
    if (t.classList.contains('copy')) {
      const text = continuityLedger(state);
      navigator.clipboard?.writeText(text).then(() => { t.textContent = 'Copied'; }, () => { const r = document.createRange(); r.selectNodeContents(page.querySelector('pre')); getSelection().removeAllRanges(); getSelection().addRange(r); t.textContent = 'Selected: copy it with your keyboard'; });
    }
  });
  addEventListener('keydown', function k(e) { if (e.key === 'Escape' && el.isConnected) { el.remove(); onClose(); removeEventListener('keydown', k); } });
  show(tab);
  document.getElementById('ui').append(el);
  return el;
}

/** The full status update arriving at its cadence: shown after the scene lands and before the choices. */
export function showReckoning(state, report) {
  return new Promise((resolve) => {
    document.querySelector('.reckoning')?.remove();
    const el = h(`<div class="reckoning sheet"><div class="frame single"><main class="leaf"><h2 class="title">Full Status Update</h2><div class="page">${reportHTML(report, state)}</div><div class="go"><button class="primary">Return to the story</button></div></main></div></div>`);
    el.querySelector('button.primary').addEventListener('click', () => { el.remove(); resolve(); });
    document.getElementById('ui').append(el);
  });
}
