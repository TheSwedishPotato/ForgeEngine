/**
 * The story as ORRERY keeps it: everything tracked, carried from turn to
 * turn (the Claude in the page remembers nothing between calls, so this
 * IS its memory), and saved in this browser.
 *
 *  - the player's character in three layers (public, private; the buried
 *    layer is held in the silent layer), standing in the world, the body
 *    state, capabilities, means, reputation, moral position and drift,
 *    routine and arc, speech profile, what they know, believe and suspect;
 *  - every named person with their tier (core, standing, ambient), the
 *    five standing axes toward the player (trust, respect, fear, affection,
 *    suspicion, 0–10, never reset) and a hidden model of who they are;
 *  - the world state and its clock, the consequence ledger over the five
 *    horizons, the promise ledger, the threads (A, B, C), the silent layer
 *    (hidden plots, what the player is wrong about), the cadence counters,
 *    the status reports, the chapters of the book, the places already
 *    built, and the Codex of period notes.
 */

export const AXES = ['trust', 'respect', 'fear', 'affection', 'suspicion'];
export const BANDS = ['Clean Success', 'Success at Cost', 'Partial', 'Failure with Foothold', 'Hard Failure', 'Catastrophe'];
export const HORIZONS = ['immediate', 'ripple', 'wave', 'tide', 'earthquake', 'butterfly'];

export function newStory({ premise, opening = 'own', player, settings = {} }) {
  return {
    v: 2, premise, opening,
    settings: { intensity: 2, period: 'heavy', difficulty: 'standard', louder: 0, pace: 'normal', ...settings },
    clock: { date: '', time: 'day', season: '' },
    player: {
      name: player.name || 'You', sex: player.sex ?? 'm', who: player.who ?? '',
      look: { skin: '#d6a882', hair: '#4a3020', clothes: '#5a4a34', accent: '#a08040', hairStyle: 'short', beard: 0, build: 'slim', ...(player.look ?? {}) },
      sheet: {}, body: { fatigue: 2, hunger: 3, thirst: 1, sleep: 4, pain: 0, injuries: [], illness: '', substance: 'sober', cleanliness: '' },
      skills: {}, means: {}, reputation: {}, moral: { order: 5, regard: 4, drift: [] }, emotion: {}, knowledge: { knows: [], believes: [], suspects: [] },
    },
    cast: {}, extras: {}, scene: null, places: {},
    world: { macro: '', regional: '', economy: '', mood: '', rumours: [], scapegoats: '', last7: '', approaching: '' },
    ledger: [], promises: [], threads: { A: null, B: null, C: [] },
    silent: { plots: [], antagonist: '', wrongAbout: [], withheld: [], notes: '' },
    counters: { scenes: 0, sinceReport: 0, turns: 0 },
    reports: [], chapters: [], codex: { title: '', entries: [], sources: [] },
    summary: '', chronicle: [], log: [], suggestions: [], lastResolution: null, started: Date.now(),
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Merge a partial object into a target (objects deep, arrays and values replaced). */
export function merge(t, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return t;
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'object' && !Array.isArray(v) && typeof t[k] === 'object' && t[k] && !Array.isArray(t[k])) merge(t[k], v);
    else t[k] = v;
  }
  return t;
}

/** The scene's beats, kept in the book. */
function bookScene(state, r) {
  if (!state.chapters.length || r.chapter) state.chapters.push({ title: r.chapter?.title || (state.chapters.length ? `Chapter ${state.chapters.length + 1}` : 'The Beginning'), scenes: [] });
  const ch = state.chapters[state.chapters.length - 1];
  if (r.scene.cut || !ch.scenes.length) ch.scenes.push({ name: r.scene.name || r.scene.place, place: r.scene.place, date: state.clock.date, time: r.scene.time, beats: [], lines: [] });
  return ch.scenes[ch.scenes.length - 1];
}

/** Fold a cleaned reply (clean.js) and what the player did into the story. */
export function applyReply(state, input, r) {
  if (input && input.kind !== 'director') state.log.push({ who: 'you', kind: input.kind, text: input.text });
  for (const c of Object.values(r.cast)) {
    const old = state.cast[c.id];
    state.cast[c.id] = old ? merge(old, c) : c;
  }
  if (r.extras) state.extras = r.extras;
  if (r.scene) {
    if (r.scene.cut) { state.counters.scenes++; state.counters.sinceReport++; }
    state.scene = r.scene;
    state.places[r.scene.spec.id] = r.scene.spec;
  }
  for (const p of r.places ?? []) if (!state.places[p.id]) state.places[p.id] = p;
  if (r.clock) merge(state.clock, r.clock);
  const sc = r.scene ? bookScene(state, r) : null;
  for (const b of r.beats) {
    if (b.narration) state.log.push({ who: null, text: b.narration });
    if (b.line) state.log.push({ who: b.who, text: b.line, act: b.action });
    if (sc) { sc.beats.push({ who: b.who, line: b.line, action: b.action, narration: b.narration }); if (sc.beats.length > 80) sc.beats.shift(); }
  }
  if (sc && r.turn?.line) sc.lines.push(r.turn.line);
  if (state.log.length > 160) state.log.splice(0, state.log.length - 160);
  if (r.sheet) {
    const P = state.player, s = r.sheet;
    if (s.body) { merge(P.body, s.body); for (const k of ['fatigue', 'pain']) P.body[k] = clamp(Number(P.body[k]) || 0, 0, 10); }
    if (s.skills) for (const [k, v] of Object.entries(s.skills)) P.skills[k] = { ...(P.skills[k] ?? {}), ...v };
    for (const k of ['means', 'reputation', 'emotion', 'knowledge', 'sheet']) if (s[k]) merge(P[k], s[k]);
    if (s.moral) { const m = P.moral; if (s.moral.order != null) m.order = clamp(+s.moral.order, 1, 10); if (s.moral.regard != null) m.regard = clamp(+s.moral.regard, 1, 10); if (s.moral.drift) m.drift.push(s.moral.drift); }
  }
  if (r.world) merge(state.world, r.world);
  for (const e of r.ledger ?? []) state.ledger.push({ ...e, at: state.clock.date || `scene ${state.counters.scenes}` });
  for (const u of r.ledgerUpdates ?? []) if (state.ledger[u.i]) state.ledger[u.i].status = u.status;
  if (state.ledger.length > 60) state.ledger.splice(0, state.ledger.length - 60);
  for (const p of r.promises ?? []) {
    const old = state.promises.find((x) => x.id === p.id);
    if (old) merge(old, p); else state.promises.push({ ...p, scene: state.counters.scenes });
  }
  if (r.threads) merge(state.threads, r.threads);
  if (r.silent) state.silent = merge(state.silent, r.silent);
  if (r.codex?.length) for (const e of r.codex) if (!state.codex.entries.some((x) => x.topic === e.topic)) state.codex.entries.push({ ...e, source: 'scene' });
  if (r.report) { state.reports.push({ scene: state.counters.scenes, date: state.clock.date, report: r.report }); if (state.reports.length > 8) state.reports.shift(); state.counters.sinceReport = 0; }
  if (r.summary) state.summary = r.summary;
  if (r.memory) { state.chronicle.push(r.memory); if (state.chronicle.length > 40) state.chronicle.shift(); }
  if (r.turn?.resolution) state.lastResolution = r.turn.resolution;
  if (r.choices.length) state.suggestions = r.choices;
  if (r.settings) merge(state.settings, r.settings);
  state.counters.turns++;
  return state;
}

/** The report due: ORRERY's cadence (every 3–5 scenes, at 5 without fail). */
export function reportDue(state) { return state.counters.sinceReport >= 3 || (state.counters.scenes >= 1 && !state.reports.length && state.counters.turns >= 4); }

const KEY = 'living-film-story';
export function saveStory(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; } }
export function loadStory() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s?.v === 2) return s;
    return null;     // the first edition's saves are not carried over: the engine underneath changed
  } catch { return null; }
}
export function clearStory() { try { localStorage.removeItem(KEY); } catch { /* blocked */ } }

const line = (k, v) => (v ? `${k.padEnd(14)}${v}\n` : '');
const list = (a) => (Array.isArray(a) ? a.filter(Boolean).join(' · ') : a ?? '');

/** ORRERY's Continuity Ledger (XIV.4): the whole state, copy-forward, as text. */
export function continuityLedger(state) {
  const P = state.player, S = P.sheet ?? {};
  const core = Object.values(state.cast).filter((c) => c.alive !== false && c.tier === 'core');
  const standing = Object.values(state.cast).filter((c) => c.alive !== false && c.tier !== 'core');
  const dead = Object.values(state.cast).filter((c) => c.alive === false);
  const ax = (c) => AXES.map((a) => `${a[0].toUpperCase() + a.slice(1)} ${c.axes?.[a] ?? '?'}`).join(' · ');
  const bar = '═'.repeat(51);
  return `${bar}
CONTINUITY LEDGER — ${state.codex.title || 'the story'} — ${state.clock.date || 'date unknown'} — scene ${state.counters.scenes}
${bar}

${line('SETTING', `${state.premise.slice(0, 300)} · intensity ${state.settings.intensity} · period dial ${state.settings.period}`)}${line('CHARACTER', `${P.name}${S.age ? ', ' + S.age : ''}. ${P.who}`)}${line('', S.origin)}${line('BODY', `Fatigue ${P.body.fatigue}/10 · Pain ${P.body.pain}/10 · Hunger ${P.body.hunger}h · Thirst ${P.body.thirst}h · Sleep ${P.body.sleep}h since · ${P.body.substance}${P.body.injuries?.length ? ' · Injuries: ' + list(P.body.injuries) : ''}`)}${line('SKILLS', Object.entries(P.skills).map(([k, v]) => `${k} ${v.v ?? v}`).join(' · '))}${line('POSITION', state.scene ? `${state.scene.name}, ${state.scene.time}, ${state.scene.weather}` : '')}${line('MEANS', [P.means.money, P.means.runway && 'runway ' + P.means.runway, list(P.means.carried)].filter(Boolean).join(' · '))}
CAST
${core.map((c) => `  CORE: ${c.name} — ${c.role} — ${ax(c)} — ${c.intent ?? ''}`).join('\n')}
${standing.map((c) => `  STANDING: ${c.name} — ${c.role} — ${ax(c)}`).join('\n')}
${dead.map((c) => `  DEAD: ${c.name} — ${c.note ?? ''}`).join('\n')}

ARCS
${['A', 'B'].map((k) => state.threads[k] ? `  ${k}: ${state.threads[k].name} — ${state.threads[k].status ?? ''}` : '').filter(Boolean).join('\n')}
${(state.threads.C ?? []).map((t) => `  C: ${t.name} — ${t.status ?? ''}`).join('\n')}

CONSEQUENCES
${state.ledger.filter((e) => e.status !== 'absorbed' && e.status !== 'expired').slice(-12).map((e) => `  ARMED: ${e.action} — ${(e.pending ?? []).map((p) => `${p.horizon}: ${p.what}${p.trigger ? ' (when ' + p.trigger + ')' : ''}`).join('; ')}`).join('\n')}
${state.promises.filter((p) => p.status !== 'PAID' && p.status !== 'DELIBERATELY ABANDONED').map((p) => `  PROMISE OPEN: ${p.planted} — scene ${p.scene} — ${p.payoff ?? ''}`).join('\n')}

WORLD
${line('  Macro', state.world.macro)}${line('  Regional', state.world.regional)}${line('  Economy', state.world.economy)}${line('  Mood', state.world.mood)}${line('  Rumours', list(state.world.rumours))}
THE PLAYER IS WRONG ABOUT
${(state.silent.wrongAbout ?? []).map((w) => '  ' + w).join('\n')}

RESUME AT     ${state.summary.slice(-400)}
${bar}`;
}

/** [[recap]]: where am I, who is here, what is unresolved. */
export function recap(state) {
  const sc = state.scene;
  const here = (sc?.present ?? []).map((id) => state.cast[id]?.name).filter(Boolean);
  const open = [state.threads.A, state.threads.B, ...(state.threads.C ?? [])].filter(Boolean).map((t) => `${t.name}${t.status ? ': ' + t.status : ''}`);
  return { where: sc ? `${sc.name || sc.place}, ${sc.time}${state.clock.date ? ', ' + state.clock.date : ''}` : 'Nowhere yet', who: here.length ? here.join(', ') : 'nobody but you', open, summary: state.summary };
}
