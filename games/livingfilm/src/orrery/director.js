/**
 * The director: Claude, running ORRERY (docs/ORRERY.md), writing the film
 * as it is lived.
 *
 * Every turn Claude is handed the whole tracked world (it remembers
 * nothing between calls; the story state is its memory), the period notes
 * from the Codex, the laws it must keep, and what the player said or did.
 * It answers with one JSON object whose keys come in playing order: the
 * scene (with the place to build), the people, the bystanders and what
 * they say in passing, the beats of film, the five choices, and then the
 * bookkeeping: the resolution of anything uncertain, the body, means and
 * skills, the standings, the world, the consequence and promise ledgers,
 * the threads, the silent layer, the chapter, and the full status report
 * when the cadence calls for it. The film starts on the first beat while
 * the rest is still being written (stream.js).
 *
 * Everything that comes back is checked here (known values, sane ranges,
 * bounded lengths) so the stage and the sheet can trust it.
 */
import { PLACE_TYPES, STYLES, WALLS, FLOORS, GESTURES, TASKS } from '../stage3d/vocab.js';
import { AXES, BANDS, HORIZONS, reportDue } from './state.js';
import { StreamReader } from './stream.js';

export const TIMES = ['dawn', 'day', 'dusk', 'night'];
export const WEATHERS = ['clear', 'rain', 'snow', 'fog', 'storm', 'wind'];
export const MOODS = ['warm', 'tense', 'melancholy', 'eerie', 'joyful', 'grim', 'tender', 'quiet', 'sacred', 'bustling'];
export const SHOTS = ['establishing', 'wide', 'medium', 'close', 'two-shot', 'over-shoulder', 'insert'];
export const MOVES = ['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'tilt-up', 'drift'];
export const EMOTIONS = ['neutral', 'warm', 'amused', 'tender', 'sad', 'angry', 'afraid', 'surprised', 'suspicious', 'proud', 'tired'];
export const HAIR = ['short', 'long', 'braid', 'veil', 'hood', 'cap', 'hat', 'bald', 'curly', 'tied'];
export const SIZES = ['small', 'medium', 'large'];

const pick = (v, list, d) => (list.includes(v) ? v : d);
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '');
const num = (v, a, b, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(a, Math.min(b, x)) : d; };
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const id = (v) => str(v, 32).toLowerCase().replace(/[^a-z0-9_-]/g, '');
const arr = (v, n = 12, len = 300) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []);
/** A small object of short strings (a sheet section): keys kept, values bounded. */
function strs(o, n = 40, len = 400) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(o).slice(0, n)) {
    const key = str(k, 40); if (!key) continue;
    if (Array.isArray(v)) out[key] = arr(v, 16, len);
    else if (v && typeof v === 'object') out[key] = strs(v, n, len);
    else if (typeof v === 'number') out[key] = v;
    else if (str(v, len)) out[key] = str(v, len);
  }
  return out;
}

/** A place Claude described, made buildable. Words it used that we do not build map to the nearest we do. */
export function typeOf(v) {
  const s = String(v ?? '').toLowerCase();
  if (PLACE_TYPES.includes(s)) return s;
  const map = [[/inn|alehouse|pub|krčma|tavern|osteria|taproom/, 'tavern'], [/throne|great hall|hall|palace|council/, 'hall'], [/bed|room|chamber|solar|study|cell|office/, 'chamber'], [/hut|house|home|cottage|hovel|lodging/, 'cottage'],
    [/chapel|church|cathedral|abbey|monastery|minster|sacristy/, 'church'], [/forge|smithy|workshop|mill|glass|furnace|bottega/, 'workshop'], [/shop|counter|apothec|bank/, 'shop'], [/vault|cellar|crypt|mine|shaft/, 'cellar'],
    [/prison|jail|dungeon|gaol/, 'dungeon'], [/kitchen|bakery/, 'kitchen'], [/stable|barn|byre/, 'stable'], [/lane|alley|street|town|quarter/, 'street'], [/market|fair|stall/, 'market'], [/square|plaza|piazza|campo/, 'square'],
    [/wood|forest|grove/, 'forest'], [/field|meadow|farm|pasture|strip/, 'field'], [/road|path|track|highway/, 'road'], [/river|stream|brook|ford|canal/, 'river'], [/bridge/, 'bridge'], [/castle|keep|fortress|tower|wall/, 'castle'],
    [/camp|tent/, 'camp'], [/hill|mountain|ridge|cliff/, 'hilltop'], [/garden|orchard|cloister/, 'garden'], [/shore|beach|harbour|harbor|port|quay|dock|lagoon/, 'shore'], [/ship|boat|deck|galley/, 'ship'],
    [/cave|grotto/, 'cave'], [/grave|cemetery|churchyard/, 'graveyard'], [/gate/, 'gate'], [/yard|courtyard|bailey|cortile/, 'courtyard']];
  for (const [re, p] of map) if (re.test(s)) return p;
  return 'street';
}

export function cleanPlace(p, fallbackName = '') {
  const name = str(p?.name, 80) || fallbackName || 'Somewhere';
  return {
    id: id(p?.id) || id(name.replace(/\s+/g, '-')).slice(0, 32) || 'place',
    name, type: typeOf(p?.type ?? p?.place ?? name), style: pick(p?.style, STYLES, 'generic'),
    size: pick(p?.size, SIZES, 'medium'), walls: pick(p?.walls, WALLS, undefined), floor: pick(p?.floor, FLOORS, undefined),
    features: arr(p?.features, 14, 40),
  };
}

export function cleanScene(sc, prev, cast) {
  const spec = cleanPlace(sc?.spec ?? sc, sc?.name);
  const prevId = prev?.spec?.id;
  const scene = {
    spec, place: spec.type, name: spec.name,
    time: pick(sc?.time, TIMES, prev?.time ?? 'day'), weather: pick(sc?.weather, WEATHERS, prev?.weather ?? 'clear'), mood: pick(sc?.mood, MOODS, prev?.mood ?? 'quiet'),
    present: (Array.isArray(sc?.present) ? sc.present.map(id).filter((x) => cast[x]) : prev?.present ?? []).slice(0, 6),
    conditions: strs(sc?.conditions, 8, 160) ?? {}, kind: str(sc?.kind, 20),
  };
  scene.cut = !!sc?.new || spec.id !== prevId;
  return scene;
}

/** A person Claude described. */
export function cleanCast(c, old = {}) {
  const L = c.look ?? {}, o = old.look ?? {};
  const axes = {};
  for (const a of AXES) axes[a] = num(c.axes?.[a], 0, 10, old.axes?.[a] ?? (a === 'trust' || a === 'respect' ? 4 : a === 'affection' ? 3 : a === 'suspicion' ? 3 : 1));
  return {
    id: id(c.id) || old.id,
    name: str(c.name, 40) || old.name || 'Someone',
    sex: c.sex === 'f' || c.sex === 'm' ? c.sex : old.sex ?? 'm',
    age: num(c.age, 4, 95, old.age ?? 35),
    role: str(c.role, 140) || old.role || '',
    tier: pick(c.tier, ['core', 'standing', 'ambient'], old.tier ?? 'standing'),
    look: {
      skin: color(L.skin, o.skin ?? '#d2a07c'), hair: color(L.hair, o.hair ?? '#4a3020'), clothes: color(L.clothes, o.clothes ?? '#6a4a30'), accent: color(L.accent, o.accent ?? '#c8a050'),
      hose: color(L.hose, o.hose ?? undefined), hairStyle: pick(L.hairStyle, HAIR, o.hairStyle ?? 'short'), beard: num(L.beard, 0, 1, o.beard ?? 0), build: pick(L.build, ['slim', 'stout', 'broad'], o.build ?? 'slim'),
      rich: typeof L.rich === 'boolean' ? L.rich : o.rich ?? false,
    },
    voice: { pitch: num(c.voice?.pitch, 0.5, 1.6, old.voice?.pitch ?? 1), rate: num(c.voice?.rate, 0.75, 1.25, old.voice?.rate ?? 1) },
    axes,
    state: str(c.state, 240) || old.state || '', intent: str(c.intent, 200) || old.intent || '',
    model: { ...(old.model ?? {}), ...(strs(c.model, 16, 300) ?? {}) },
    alive: c.alive === false ? false : old.alive ?? true,
    note: str(c.note, 240) || old.note || '',
  };
}

const MOVE_TO = /^(near:[a-z0-9_-]+|leave|door|sit|stand|center|[a-z][a-z0-9 _-]{0,24})$/;

/** One beat of film. */
export function cleanBeat(b, cast, extras = {}) {
  const known = (x) => x === 'you' || cast[x] || extras[x];
  const on = (Array.isArray(b?.on) ? b.on : []).map(id).filter(known).slice(0, 4);
  const who = b?.who === 'you' ? 'you' : known(id(b?.who)) ? id(b?.who) : null;
  const moves = (Array.isArray(b?.moves) ? b.moves : []).map((m) => ({ who: id(m?.who), to: str(m?.to, 32).toLowerCase() })).filter((m) => known(m.who) && MOVE_TO.test(m.to)).slice(0, 4);
  const acts = (Array.isArray(b?.acts) ? b.acts : []).map((a) => ({ who: id(a?.who), gesture: pick(a?.gesture, GESTURES, undefined), task: pick(a?.task, TASKS, undefined), emotion: pick(a?.emotion, EMOTIONS, undefined) })).filter((a) => known(a.who)).slice(0, 5);
  return {
    shot: pick(b?.shot, SHOTS, who ? 'medium' : 'wide'),
    on: who && !on.includes(who) ? [who, ...on].slice(0, 4) : on,
    move: pick(b?.move, MOVES, 'drift'),
    narration: str(b?.narration, 900),
    who, line: who ? str(b?.line, 700) : '',
    emotion: pick(b?.emotion, EMOTIONS, 'neutral'),
    gesture: pick(b?.gesture, GESTURES, 'none'),
    task: pick(b?.task, TASKS, undefined),
    action: str(b?.action, 200),
    moves, acts,
  };
}

export function cleanExtras(list) {
  const out = {};
  for (const e of (Array.isArray(list) ? list : []).slice(0, 5)) {
    const x = cleanCast({ ...e, tier: 'ambient' });
    if (!x.id) continue;
    x.label = str(e.label, 60) || x.role || 'a bystander'; x.task = pick(e.task, TASKS, undefined); x.extra = true;
    out[x.id] = x;
  }
  return out;
}

const cleanChoice = (s) => ({ kind: s?.kind === 'do' ? 'do' : 'say', text: str(s?.text, 160), risk: str(s?.risk, 60) });

/** The full status update (ORRERY Part Four), kept as labelled sections of short text. */
export function cleanReport(r) {
  if (!r || typeof r !== 'object') return null;
  const out = strs(r, 24, 700) ?? {};
  if (Array.isArray(r.npcs)) out.npcs = r.npcs.slice(0, 14).map((n) => ({ name: str(n?.name, 40), ...Object.fromEntries(AXES.map((a) => [a, num(n?.[a], 0, 10, null)])), state: str(n?.state, 240), intent: str(n?.intent, 200) })).filter((n) => n.name);
  if (Array.isArray(r.skills)) out.skills = r.skills.slice(0, 16).map((s) => ({ name: str(s?.name, 40), v: num(s?.v, 0, 10, 0), why: str(s?.why, 160) })).filter((s) => s.name);
  if (Array.isArray(r.fame)) out.fame = r.fame.slice(0, 8).map((f) => ({ group: str(f?.group, 40), score: num(f?.score, 0, 10, 0), trend: str(f?.trend, 20), note: str(f?.note, 160) })).filter((f) => f.group);
  if (Array.isArray(r.inMotion)) out.inMotion = arr(r.inMotion, 6, 240);
  return out;
}

/** Clean a whole reply into what the film and the sheet can use. */
export function cleanReply(r, state) {
  const cast = {};
  const all = { ...state.cast };
  for (const c of (Array.isArray(r?.cast) ? r.cast : []).slice(0, 10)) {
    const cid = id(c?.id); if (!cid || cid === 'you') continue;
    all[cid] = cast[cid] = cleanCast(c, all[cid] ?? {});
  }
  const extras = r?.extras ? cleanExtras(r.extras) : null;
  const ex = extras ?? state.extras ?? {};
  const scene = r?.scene ? cleanScene(r.scene, state.scene, all) : null;
  const beats = (Array.isArray(r?.beats) ? r.beats : []).slice(0, 14).map((b) => cleanBeat(b ?? {}, all, ex)).filter((b) => b.narration || b.line);
  if (scene) for (const b of beats) for (const x of b.on) if (x !== 'you' && all[x] && !scene.present.includes(x)) scene.present.push(x);
  const remarks = (Array.isArray(r?.remarks) ? r.remarks : []).map((m) => ({ who: id(m?.who), text: str(m?.text, 140) })).filter((m) => m.text && (all[m.who] || ex[m.who])).slice(0, 6);
  const sheet = r?.sheet && typeof r.sheet === 'object' ? {
    body: r.sheet.body ? { ...strs(r.sheet.body, 16, 200), injuries: arr(r.sheet.body.injuries, 10, 200), fatigue: num(r.sheet.body.fatigue, 0, 10, undefined), pain: num(r.sheet.body.pain, 0, 10, undefined), hunger: num(r.sheet.body.hunger, 0, 200, undefined), thirst: num(r.sheet.body.thirst, 0, 200, undefined), sleep: num(r.sheet.body.sleep, 0, 200, undefined) } : undefined,
    skills: r.sheet.skills && typeof r.sheet.skills === 'object' ? Object.fromEntries(Object.entries(r.sheet.skills).slice(0, 30).map(([k, v]) => [str(k, 40), { v: num(v?.v ?? v, 0, 10, 0), why: str(v?.why, 160) }]).filter(([k]) => k)) : undefined,
    means: strs(r.sheet.means, 20, 300), reputation: strs(r.sheet.reputation, 12, 200), emotion: strs(r.sheet.emotion, 6, 300),
    knowledge: r.sheet.knowledge ? { knows: arr(r.sheet.knowledge.knows, 20, 200), believes: arr(r.sheet.knowledge.believes, 16, 200), suspects: arr(r.sheet.knowledge.suspects, 12, 200) } : undefined,
    moral: r.sheet.moral ? { order: num(r.sheet.moral.order, 1, 10, null), regard: num(r.sheet.moral.regard, 1, 10, null), drift: str(r.sheet.moral.drift, 200) || undefined } : undefined,
    sheet: strs(r.sheet.sheet, 12, 500),
  } : null;
  if (sheet?.body) for (const k of Object.keys(sheet.body)) if (sheet.body[k] === undefined) delete sheet.body[k];
  if (sheet?.knowledge) for (const k of ['knows', 'believes', 'suspects']) if (!sheet.knowledge[k].length) delete sheet.knowledge[k];
  const res = r?.turn?.resolution;
  return {
    scene, cast, extras, beats, remarks,
    choices: (Array.isArray(r?.choices) ? r.choices : Array.isArray(r?.suggestions) ? r.suggestions : []).map(cleanChoice).filter((s) => s.text).slice(0, 5),
    turn: { line: str(r?.turn?.line, 300), resolution: res && str(res.action, 200) ? { action: str(res.action, 200), band: pick(res.band, BANDS, 'Partial'), difficulty: str(res.difficulty, 30), odds: str(res.odds, 40), why: str(res.why, 400) } : null },
    sheet,
    clock: strs(r?.clock, 4, 80),
    world: r?.world ? { ...strs(r.world, 12, 500), rumours: r.world.rumours ? arr(r.world.rumours, 8, 200) : undefined } : null,
    ledger: (Array.isArray(r?.ledger) ? r.ledger : []).slice(0, 4).map((e) => ({ action: str(e?.action, 200), witnesses: str(e?.witnesses, 200), immediate: str(e?.immediate, 200), pending: (Array.isArray(e?.pending) ? e.pending : []).slice(0, 5).map((p) => ({ horizon: pick(p?.horizon, HORIZONS, 'ripple'), what: str(p?.what, 200), trigger: str(p?.trigger, 160) })).filter((p) => p.what), butterfly: str(e?.butterfly, 200), status: 'armed' })).filter((e) => e.action),
    ledgerUpdates: (Array.isArray(r?.ledgerUpdates) ? r.ledgerUpdates : []).map((u) => ({ i: num(u?.i, 0, 999, -1), status: pick(u?.status, ['armed', 'triggered', 'expired', 'absorbed'], 'armed') })).filter((u) => u.i >= 0),
    promises: (Array.isArray(r?.promises) ? r.promises : []).slice(0, 4).map((p) => ({ id: id(p?.id) || id(str(p?.planted, 30).replace(/\s+/g, '-')), planted: str(p?.planted, 200), payoff: str(p?.payoff, 200), status: pick(p?.status, ['OPEN', 'RIPENING', 'PAID', 'DELIBERATELY ABANDONED'], 'OPEN') })).filter((p) => p.id),
    threads: r?.threads && typeof r.threads === 'object' ? {
      A: r.threads.A ? strs(r.threads.A, 4, 240) : undefined, B: r.threads.B ? strs(r.threads.B, 4, 240) : undefined,
      C: Array.isArray(r.threads.C) ? r.threads.C.slice(0, 5).map((t) => strs(t, 4, 240)).filter((t) => t?.name) : undefined,
    } : null,
    silent: r?.silent && typeof r.silent === 'object' ? {
      plots: Array.isArray(r.silent.plots) ? r.silent.plots.slice(0, 5).map((p) => strs(p, 6, 300)) : undefined,
      antagonist: str(r.silent.antagonist, 600) || undefined, wrongAbout: r.silent.wrongAbout ? arr(r.silent.wrongAbout, 6, 240) : undefined,
      withheld: r.silent.withheld ? arr(r.silent.withheld, 6, 240) : undefined, notes: str(r.silent.notes, 800) || undefined,
    } : null,
    places: (Array.isArray(r?.places) ? r.places : []).slice(0, 4).map((p) => cleanPlace(p)),
    chapter: r?.chapter && str(r.chapter.title, 80) ? { title: str(r.chapter.title, 80) } : null,
    codex: (Array.isArray(r?.codex) ? r.codex : []).slice(0, 3).map((e) => ({ topic: str(e?.topic, 60), text: str(e?.text, 700) })).filter((e) => e.topic && e.text),
    report: cleanReport(r?.report),
    director: str(r?.director, 2000),
    summary: str(r?.summary, 1600), memory: str(r?.memory, 240),
  };
}

// --- the prompt ----------------------------------------------------------------------------------------

/** ORRERY, condensed to what must ride along with every call (the full text is docs/ORRERY.md). */
export const LAWS = `ORRERY GOVERNS. You run the persistent narrative engine ORRERY. Its Prime Law: every action generates consequence across five horizons (immediate, ripple, wave, tide, earthquake); nothing is forgiven or forgotten unless a real person would forgive or forget it.

THE TWELVE LAWS. I Consequence is absolute and arrives when it realistically would, never when dramatic. II No plot armour either way: realistic failure fails, realistic success succeeds without invented punishment. III Every named person is a full human being acting from their own history, fear, desire, secret and mood, never from plot convenience. IV The world runs on its own clock (wars, harvests, prices, deaths). V The player only knows what the character perceives, misperceptions included. VI Lore is law: the time and place at full fidelity. VII Human imperfection is mandatory, for everyone. VIII Social reality precedes speech: appearance, smell, accent, rank, company set the start of every exchange. IX Violence is fast, chaotic, lethal and costs: witnesses, rumour, law, residue. X The body is real: food, water, sleep, warmth, pain degrade judgement. XI The player owns the character's interior. XII Failure must open a door: it changes the board, never returns the same choice.

RESOLUTION (before any uncertain outcome, privately): 1 state the difficulty honestly (Routine, Demanding, Hard, Severe, Near-Impossible); 2 tally the real edges (skill, body state, preparation, terrain, standing in this room, allies, the opposition's own state, who knows what); 3 ask "if I ran this a hundred times, how many succeed?" and decide genuinely, the uncommon outcome sometimes; 4 resolve into a band: Clean Success, Success at Cost, Partial, Failure with Foothold, Hard Failure, Catastrophe. Success at Cost and Partial are the most common. Preparation is the strongest edge; repeated attempts get harder; the sheet's numbers must shape the result; enemies fail at realistic rates too. Never decide an outcome because of where it takes the story.

THE AGENCY LINE (the most important craft rule). You write the world, the body (sensation, involuntary reaction, trained reflex) and every other mind. You NEVER write the player character's decisions, convictions, conclusions, resolve or reasons, and never what they say beyond what the player gave. The player's words are sacred: anything the player says appears on screen as spoken, verbatim, rough grammar kept. If they chose an option or described speech loosely, write the actual line in their character's own register and nothing more.

PEOPLE. Every named person has a hidden model (want, fear, wound, contradiction, habit, speech signature, what they never say, blind spot, betrayal threshold, what they did today, what they withhold, what they do off-screen) and five independent standings toward the player, 0–10, never reset: trust, respect, fear, affection, suspicion. They lie in character, misread through their bias, hold grudges, have bad days, change, talk to each other, and are not waiting for the player. Tiers: core (max 7, full model), standing (max 12, compressed), ambient (one detail; promoted if the player returns to them). Between scenes run the off-screen tick for those who matter: what they wanted, did, whether it worked, what they learned, how their standing moved; let it surface as a changed greeting or a closed door.

THE WORLD. It changes without the player. At least one Ring 1 (within 100 m) or Ring 2 (this town, today) event per scene, unrelated to the player. Weather has practical effects. News travels at the speed of its carrier and degrades with each telling. Power has a formal map and an actual map; intrigue lives in the gap.

THE LEDGERS. Log every significant action with witnesses, immediate effect and pending consequences per horizon with trigger conditions. Success has consequences too (envy, obligation); kindness returns later from unexpected directions. Every planted detail goes in the promise ledger and is paid or deliberately, plausibly retired. Failures come in kinds: task, relationship, moral, catastrophic, invisible (not yet known).

THE STORY ENGINE. At least three plots the player has not found are always moving (who arranged it, what they really want, what happens if the player never interferes: that default trajectory completes off-screen). Antagonists campaign and adapt. Braid threads: A (the main pressure), B (the personal), C (slow burns, one of them the next A); every 2–3 scenes at least two advance; none starves past 5 scenes; threads interfere. Mysteries are fair. Theme is a question, never announced.

CRAFT. The intensity dial: 1 still, 2 working (default), 3 pressured, 4 crisis, 5 rupture (two or three times a campaign); escalation needs a floor. Scene arc: establish (in motion, never a recap), inhabit, develop, turn, land. Anti-patterns to avoid: the shouting page, the inventory paragraph, the puppet (narrating the player's resolve), the announced theme, the courteous world, the flat difficulty, the static body, the eternal present (cut, skip, compress time), the punishment engine. Never open two replies the same way; retire a phrase after three uses. Warmth: the world is indifferent, the narrator is not; losses written with care, never a smirk.

PROSE AND SPEECH. Narration flows: connected clauses, beats woven in, at most two standalone fragments a scene outside crisis, no capitals for emphasis. Every line of dialogue is anchored to a body or a piece of business (the "action" of the beat); never two bare lines in a row. Every mouth has its trade, class rung, rhythm, tic and things it never says; people answer a different question than the one asked, hedge, deflect, and say where their knowledge comes from ("only what the chamberlain told me", "so they say"). The house voice: plain words, slightly elevated verbs, of-constructions, sentences opening on Well, But, And, So, Now, Look here; the address landing mid-sentence; a proverb carrying the point; a long build then four flat words. The period dial: modern words a reader never trips on, in the era's sentence shapes, furnished with the era's coin, oaths, trades, distances and ranks; strip modern abstraction (no issues, options, process, relationship, space, support, comfortable); no costume archaism (no forsooth); period speech is earthier than costume drama. Long conversations are staged over work: hands stay busy (the occupation rule), every few exchanges a physical beat that changes something, the body answering what the words refuse. The see-saw: talk produces a theory, action tests it, talk interprets; neither three scenes running.

CADENCE. Every scene: the body state visible in behaviour; one world event unrelated to the player; every present person acting from their own model. Every 3–5 scenes and after any major event: the FULL STATUS UPDATE. Every 8–10 scenes: promise audit, one core person changed off-screen, thread check. Six things hold even if all else is lost: the player's words on the page as spoken; never the player's decisions; honest resolution; every named person wants something unrelated to the player; the full report every 3–5 scenes; a hidden plot always moving.`;

const one = (s, n = 220) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const kv = (o) => Object.entries(o ?? {}).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? kv(v) : v}`).join(' | ');
const axesOf = (c) => AXES.map((a) => `${a} ${c.axes?.[a] ?? '?'}`).join(', ');

function castBlock(state) {
  const all = Object.values(state.cast);
  if (!all.length) return '(nobody yet: introduce people as the story needs them, each with a life of their own)';
  return all.map((c) => {
    const head = `- ${c.id}: ${c.name} (${c.sex === 'f' ? 'woman' : 'man'}, ${c.age}), ${c.role}. ${c.alive === false ? 'DEAD. ' : ''}Tier ${c.tier}. Toward the player: ${axesOf(c)}.`;
    const now = c.state || c.intent ? ` Now: ${one(c.state, 160)}${c.intent ? ` Intent: ${one(c.intent, 120)}` : ''}` : '';
    const model = c.tier === 'ambient' ? '' : ` HIDDEN MODEL: ${one(kv(c.model), c.tier === 'core' ? 900 : 300)}`;
    return head + now + model;
  }).join('\n');
}

function playerBlock(state) {
  const P = state.player;
  return `${P.name}, ${P.sex === 'f' ? 'a woman' : P.sex === 'm' ? 'a man' : 'a person'}. ${P.who}
SHEET: ${one(kv(P.sheet), 2200)}
BODY: fatigue ${P.body.fatigue}/10, pain ${P.body.pain}/10, hunger ${P.body.hunger}h since food, thirst ${P.body.thirst}h, ${P.body.sleep}h since sleep, ${P.body.substance ?? 'sober'}${P.body.injuries?.length ? ', injuries: ' + P.body.injuries.join('; ') : ''}${P.body.illness ? ', illness: ' + P.body.illness : ''}${P.body.cleanliness ? ', ' + P.body.cleanliness : ''}
SKILLS: ${Object.entries(P.skills).map(([k, v]) => `${k} ${v.v ?? v}`).join(', ') || '(to be found in play)'}
MEANS: ${one(kv(P.means), 600) || '(unknown yet)'}
REPUTATION: ${one(kv(P.reputation), 400) || '(none yet)'}
MORAL: order ${P.moral.order}/10 (1 lawful), regard ${P.moral.regard}/10 (1 selfless)${P.moral.drift?.length ? '; drift: ' + P.moral.drift.slice(-3).join('; ') : ''}
EMOTION: ${one(kv(P.emotion), 300)}
KNOWS: ${(P.knowledge.knows ?? []).slice(-10).join('; ')} | BELIEVES: ${(P.knowledge.believes ?? []).slice(-8).join('; ')} | SUSPECTS: ${(P.knowledge.suspects ?? []).slice(-6).join('; ')}`;
}

const DIRECTOR_HELP = `[[faster]] compress, cut to consequence · [[slower]] expand · [[zoom]] stay in this moment · [[skip to X]] jump forward, summarise the interval honestly including what happened without the player · [[montage: X]] compress days or weeks then resume live · [[intensity N]] · [[camera: NAME]] one scene from another person's view · [[odds]] what you judged for the last action and why · [[why]] the causal chain of a consequence, out of fiction · [[retcon: X]] fix a misunderstanding of the player's intent, never undo an outcome they disliked · [[louder/quieter]] more or less description · [[harder/gentler]] world difficulty from now on · [[out]] talk normally, out of fiction`;

/** The prompt for one turn. input: {kind: 'say'|'do'|'director', text} or null to open the film. */
export function directorPrompt(state, input, { codexText = '', forceReport = false } = {}) {
  const sc = state.scene;
  const recent = state.log.slice(-22).map((l) => (l.who === 'you' ? `PLAYER ${l.kind === 'do' ? 'does' : 'says'}: ${l.text}` : l.who ? `${state.cast[l.who]?.name ?? l.who}${l.act ? ` (${l.act})` : ''}: "${l.text}"` : `(${l.text})`)).join('\n') || '(the film has not begun)';
  const due = forceReport || reportDue(state);
  const scenes = state.counters.scenes;
  const S = state.settings;
  const armed = state.ledger.map((e, i) => ({ e, i })).filter(({ e }) => e.status === 'armed' || e.status === 'triggered').slice(-12);
  const open = state.promises.filter((p) => p.status === 'OPEN' || p.status === 'RIPENING');
  const built = Object.values(state.places).map((p) => `${p.id} (${p.name}, ${p.type})`).join('; ');
  const dir = input?.kind === 'director';
  return `${LAWS}

THIS STORY IS A FILM the player lives from the inside. Your words become shots, subtitles and voices on a 3D stage, so narration is what the camera sees and hears and what the body feels, in flowing present tense, second person for the player.

SETTINGS: intensity ${S.intensity} (default for this stretch) · period dial ${S.period} · world difficulty ${S.difficulty} · pace ${S.pace}${S.louder ? ` · description ${S.louder > 0 ? 'fuller' : 'leaner'}` : ''}.

THE STORY
${state.premise}

THE CODEX (period notes; keep to them; never contradict them; where silent, be careful and plausible, and add to the codex what you rely on)
${codexText || '(none)'}

WORLD STATE (${state.clock.date || 'date not yet set'}, ${state.clock.time}${state.clock.season ? ', ' + state.clock.season : ''})
${one(kv(state.world), 1400) || '(set it as the story opens)'}

THE PLAYER'S CHARACTER ("you")
${playerBlock(state)}

THE PEOPLE
${castBlock(state)}

LEDGERS
Armed consequences: ${armed.map(({ e, i }) => `#${i} ${e.action} → ${(e.pending ?? []).map((p) => `${p.horizon}: ${p.what}${p.trigger ? ` (when ${p.trigger})` : ''}`).join('; ')}`).join(' || ') || '(none)'}
Open promises: ${open.map((p) => `${p.id}: ${p.planted} → ${p.payoff} [${p.status}, scene ${p.scene}]`).join(' || ') || '(none)'}
Threads: A ${state.threads.A ? kv(state.threads.A) : '(not yet)'} | B ${state.threads.B ? kv(state.threads.B) : '(not yet)'} | C ${(state.threads.C ?? []).map(kv).join(' / ') || '(none)'}
SILENT LAYER (yours alone, never narrated): ${one(kv(state.silent), 1600) || '(build it now: three hidden plots with owners and default trajectories, an antagonist campaign, what the player is wrong about)'}

THE STORY SO FAR
${state.summary || '(beginning)'}
${state.chronicle.length ? `Never forgotten: ${state.chronicle.slice(-12).join(' | ')}` : ''}

THE LAST MOMENTS
${recent}

THE SCENE NOW
${sc ? `${sc.name} [place id ${sc.spec.id}, ${sc.place}], ${sc.time}, ${sc.weather}, mood ${sc.mood}; present: ${sc.present.map((x) => state.cast[x]?.name ?? x).join(', ') || 'nobody but the player'}; bystanders: ${Object.values(state.extras ?? {}).map((e) => e.label).join(', ') || 'none'}` : '(none yet: open the film)'}
Places already built (reuse the same id whenever the story returns to one): ${built || '(none)'}
CADENCE: scene ${scenes}; scenes since the last full status update: ${state.counters.sinceReport}.${due ? ' THE FULL STATUS UPDATE IS DUE: include "report" in this reply.' : ''}${scenes > 0 && scenes % 9 === 0 ? ' Promise audit and thread check due now.' : ''}

${dir ? `THE PLAYER GIVES A DIRECTOR COMMAND (out of fiction, never acknowledged in the fiction; effective from now): ${input.text}
Director commands: ${DIRECTOR_HELP}
If the command asks a question ([[odds]], [[why]], [[out]] or anything conversational), answer it in "director" and send no beats unless the story should move. If it changes how the story is told, apply it and continue the scene in "beats".` : input ? `THE PLAYER NOW ${input.kind === 'do' ? 'DOES' : 'SAYS'}: ${input.text}
${input.kind === 'say' ? 'Their first beat is them saying exactly this: {"who": "you", "line": <their words, verbatim>}.' : 'Show their body doing it (not their decision or feelings), then resolve it honestly.'}` : 'OPEN THE FILM. The scene leads, not the profile: render the place, establish the character through action, put at least two named people there with their own business, and end on the first choice.'}

WRITE IT AS FILM: 4 to 9 beats (more at intensity 1–2, fewer and harder at 3–4). Each beat is one shot: establishing when the place changes, wide for action and arrivals, medium for talk, close at a moment of feeling, over-shoulder for a conversation, two-shot for two people at once, insert on a telling object. Narration 1 to 3 flowing sentences. A line of dialogue is one person speaking (one to four sentences), anchored by its "action" (what their body or hands are doing). Use gestures and tasks so people move like people: hands busy with work during long talk, someone crossing the room, a bystander leaving. End on something the player must answer.

Reply with ONLY one JSON object, keys IN THIS ORDER (the film plays the first keys while you write the rest):
{
 "scene": {"id": "<stable place id, reuse ids of built places>", "name": "<the place as people there call it>", "type": "<${PLACE_TYPES.join('|')}>", "style": "<${STYLES.join('|')}> (architecture tradition)", "size": "small|medium|large", "walls": "<${WALLS.join('|')}>", "floor": "<${FLOORS.join('|')}>", "features": ["<concrete things in it: hearth, long table, benches, barrels, counter, candles, bed, altar, anvil, furnace, loom, desk, shelves, tapestry, hay, well, cart, stalls, fountain, trees, boats, graves, pillory...>"], "time": "<${TIMES.join('|')}>", "weather": "<${WEATHERS.join('|')}>", "mood": "<${MOODS.join('|')}>", "present": ["<cast ids here>"], "new": <true if a new scene begins>, "kind": "establishing|conversation|action|transit|quiet|revelation", "conditions": {"temperature": "<°C and what it does to skin>", "sky": "...", "wind": "...", "underfoot": "...", "light": "..."}},
 "cast": [ {"id": "<short lowercase id>", "name": "...", "sex": "m|f", "age": <n>, "role": "<who they are, in a phrase>", "tier": "core|standing|ambient", "look": {"skin": "#rrggbb", "hair": "#rrggbb", "hairStyle": "<${HAIR.join('|')}>", "clothes": "#rrggbb", "accent": "#rrggbb", "hose": "#rrggbb", "beard": <0..1>, "build": "slim|stout|broad", "rich": <bool>}, "voice": {"pitch": <0.6..1.5>, "rate": <0.8..1.2>}, "axes": {"trust": <0-10>, "respect": <0-10>, "fear": <0-10>, "affection": <0-10>, "suspicion": <0-10>}, "state": "<what they are doing and feeling right now>", "intent": "<their immediate intent>", "model": {"want": "", "fear": "", "wound": "", "contradiction": "", "habit": "", "speech": "<signature: rung, rhythm, tic, oaths>", "neverSays": "", "blindSpot": "", "betrayal": "", "today": "", "withheld": "", "offscreen": ""}, "alive": true} ] (only people new to the story or changed this turn; the full model for core and standing people when first met),
 "extras": [ {"id": "x1", "label": "<a carter, a girl with a goose...>", "sex": "m|f", "age": <n>, "look": {...as above}, "task": "<${TASKS.join('|')}>"} ] (0 to 4 nameless bystanders in this place with their own business; omit the key to keep the same ones),
 "remarks": [ {"who": "<cast or extra id>", "text": "<under 12 words, said aloud in passing as the player arrives or passes: a greeting, a jibe, a mutter, gossip; in their own voice>"} ] (0 to 4; on arriving somewhere or passing people),
 "beats": [ {"shot": "<${SHOTS.join('|')}>", "on": ["<ids in shot, or 'you'>"], "move": "<${MOVES.join('|')}>", "narration": "<or empty>", "who": "<id speaking, 'you' only for the player's own words, or null>", "line": "<their words, or empty>", "action": "<the anchor: what the speaker's body or hands do>", "emotion": "<${EMOTIONS.join('|')}>", "gesture": "<${GESTURES.join('|')}>", "task": "<the speaker's work, if any: ${TASKS.join('|')}>", "acts": [{"who": "<id>", "gesture": "...", "task": "...", "emotion": "..."}], "moves": [{"who": "<id>", "to": "<a feature or mark (hearth, table, counter, door, window, bed, altar, well, center), near:<id>, sit, stand, or leave>"}]} ],
 "choices": [ {"kind": "say|do", "text": "<specific, under 18 words>", "risk": "<the readable risk, in a few words>"} x5 ] (1 the obvious move with its cost visible, 2 a different strategy or values, 3 a social or verbal angle with roughly what is said, 4 observe, wait or withdraw, 5 high risk high reward; never signal which is best; the player may always write their own),
 "turn": {"line": "<one sentence for the book: what happened this turn>", "resolution": {"action": "<the uncertain thing attempted>", "difficulty": "<band>", "odds": "<about n in 100>", "band": "<${BANDS.join('|')}>", "why": "<the edges, briefly>"} or null},
 "clock": {"date": "<in-world date>", "time": "<hour or part of day>", "season": "<and what it means practically>"},
 "sheet": {"body": {"fatigue": <0-10>, "hunger": <hours>, "thirst": <hours>, "sleep": <hours since>, "pain": <0-10>, "injuries": ["..."], "illness": "", "substance": "", "cleanliness": ""}, "means": {"money": "<exact, in period coin>", "standing": "", "burn": "", "runway": "", "income": "", "debtsOwed": ["..."], "debtsHeld": ["..."], "worn": ["..."], "carried": ["..."], "stored": ["..."], "property": ["..."], "sentimental": ["..."]}, "skills": {"<Skill>": {"v": <0-10>, "why": "<what moved it>"}}, "reputation": {"<group>": "<score 0-10, trend, what they say>"}, "moral": {"order": <1-10>, "regard": <1-10>, "drift": "<movement and cause, if any>"}, "emotion": {"primary": "<named precisely>", "undercurrent": ""}, "knowledge": {"knows": ["..."], "believes": ["..."], "suspects": ["..."]}} (only what changed; arrays you send replace the old),
 "world": {"macro": "", "regional": "", "economy": "", "mood": "", "rumours": ["..."], "scapegoats": "", "last7": "", "approaching": "<signal only>"} (only what changed),
 "ledger": [ {"action": "", "witnesses": "", "immediate": "", "pending": [{"horizon": "<${HORIZONS.join('|')}>", "what": "", "trigger": ""}], "butterfly": ""} ] (significant actions this turn),
 "ledgerUpdates": [ {"i": <ledger #>, "status": "triggered|expired|absorbed"} ],
 "promises": [ {"id": "", "planted": "", "payoff": "<intended shape>", "status": "OPEN|RIPENING|PAID|DELIBERATELY ABANDONED"} ],
 "threads": {"A": {"name": "", "status": ""}, "B": {"name": "", "status": ""}, "C": [{"name": "", "status": ""}]},
 "silent": {"plots": [{"owner": "", "want": "", "ifIgnored": "", "stage": ""}], "antagonist": "<their campaign and last move>", "wrongAbout": ["<what the player is wrong about>"], "withheld": ["..."], "notes": "<true versions of events, standing changes and their causes>"} (the whole silent layer, rewritten),
 "places": [ {"id": "", "name": "", "type": "", "style": "", "size": "", "walls": "", "floor": "", "features": []} ] (places the story may go to next, so they are built before anyone walks in),
 "chapter": {"title": "<only when a new chapter of the story begins with this scene>"},
 "codex": [ {"topic": "", "text": "<a period fact you relied on that is not yet in the codex>"} ],
 ${due ? `"report": {"profile": "<name · age in years and months · background, two or three lines>", "psychology": "<motivations · flaws · fears now · moral alignment with drift>", "appearance": "<face · body with injuries · clothing and its condition · marks · bearing right now>", "belief": "<what they hold and in what order · who they would lose most · vice, comfort or craving in play>", "speech": "<class rung today · rhythm · tic · what shifts it under pressure>", "skills": [{"name": "", "v": <0-10>, "why": ""}], "standing": "<position · patron · live enemies · obligations · who would notice tonight>", "routine": "<the ordinary day now · what has hardened or softened · the cost not yet felt>", "emotion": "<named precisely, one or two sentences>", "wealth": "<money · key items and where · health % · energy %, with what each means>", "fame": [{"group": "", "score": <0-10>, "trend": "", "note": ""}], "environment": "<location · date, time, season · weather in °C and what it does to people>", "senses": "<sight, sound, smell, touch, taste, and the feel of the place>", "concurrent": "<in this room · in the town · in the wider world, each tied to the story>", "npcs": [{"name": "", "trust": <n>, "respect": <n>, "fear": <n>, "affection": <n>, "suspicion": <n>, "state": "<what they are doing and feeling>", "intent": ""}], "inMotion": ["<2 to 5 things armed and not yet arrived, worded to unsettle, never to spoil>"]},` : ''}
 "director": "<only for a director command that asks something: your out-of-fiction answer>",
 "summary": "<the whole story so far, rewritten, under 220 words>",
 "memory": "<one line if something happened that must never be forgotten, else empty>"
}
Colours suit the period and the person (undyed wool, madder red, woad blue, weld yellow, black for the rich and the clergy). Write every word of the story in English.`;
}

/** The prompt that builds the player's full character sheet (ORRERY Book III) from a few words. */
export function sheetPrompt(state, codexText) {
  const P = state.player;
  return `${LAWS.split('\n\n')[0]}

Build the full character sheet (ORRERY Book III) for the player's character in this story. Invent concretely and truthfully to the period, from the player's own words; keep everything they said. The player owns the interior: write it as a starting point they can play against, never as decisions.

STORY: ${state.premise}
CODEX: ${codexText.slice(0, 5000)}
THE PLAYER: ${P.name}, ${P.sex === 'f' ? 'a woman' : 'a man'}. In their own words: ${P.who || '(nothing more: invent a fitting life)'}

Reply with ONLY JSON:
{"sheet": {
  "age": "<years and months>", "origin": "<birthplace, class of birth vs now>", "languages": "<each with fluency>",
  "face": "", "body": "<height in cm, build, posture>", "hands": "<calluses, scars, ink: hands never lie>", "voice": "", "gait": "",
  "clothing": "<every garment: quality, condition, social signal>", "accessories": "", "grooming": "", "smell": "",
  "perception": "<how elites, working people, enforcers and strangers each read them, one line each>",
  "bearing": "<resting posture · hands at rest · tell under stress · eye habit · tics · table manners>", "marks": "<trade marks, old injuries, wear, weather>", "firstWord": "<greeting habit · address default · opening move>",
  "coreWant": "", "coreFear": "", "coreWound": "", "selfImage": "", "gap": "", "selfDeception": "", "defence": "", "moralFloor": "", "alreadyCrossed": "",
  "personality": "<three mandatory contradictions: trait, but only when…>", "goals": "<right now · this season · the quiet one>", "secrets": "<each with who could expose it and the cost>",
  "faith": "", "superstitions": "", "loyalty": "<ranked>", "prejudices": "", "attachments": "<people, places, the object they would carry from a fire, obligations>",
  "appetites": "<pleasures · vices · comfort · what they miss · humour>", "competence": "<believes they are · actually are · overconfident in · underrate>",
  "speech": "<class rung · vocabulary reach · rhythm · verbal tic · oaths · vulgarity · under pressure · never says>",
  "kin": "", "position": "", "patron": "", "enemies": "", "obligations": "", "legal": "", "mobility": "", "whoWouldNotice": "",
  "day": "<wakes · works · eats · evening · sleeps>", "arcStart": "<where they start, stated plainly>"
 },
 "body": {"fatigue": <0-10>, "hunger": <h>, "thirst": <h>, "sleep": <h>, "pain": <0-10>, "injuries": [], "illness": "", "substance": "sober", "cleanliness": ""},
 "skills": {"<Skill>": {"v": <0-10>, "why": "<where it came from>"}} (8 to 14, physical, social, cognitive, trade),
 "means": {"money": "<exact, period coin>", "standing": "", "burn": "", "runway": "", "income": "", "debtsOwed": [], "debtsHeld": [], "worn": [], "carried": [], "stored": [], "property": [], "sentimental": []},
 "reputation": {"<group>": "<score 0-10, what they say>"},
 "moral": {"order": <1-10>, "regard": <1-10>},
 "emotion": {"primary": "", "undercurrent": ""},
 "look": {"skin": "#rrggbb", "hair": "#rrggbb", "hairStyle": "<${HAIR.join('|')}>", "clothes": "#rrggbb", "accent": "#rrggbb", "hose": "#rrggbb", "beard": <0..1>, "build": "slim|stout|broad"}
}`;
}

/** The report alone ([[stats]]): the full status update, now, without moving the story. */
export function reportPrompt(state, codexText) {
  return directorPrompt(state, { kind: 'director', text: '[[stats]] Produce the FULL STATUS UPDATE now in "report". Send no beats and change nothing else: no scene, no cast, no ledgers.' }, { codexText, forceReport: true });
}

/**
 * The director: asks Claude, streaming. sample is the page's Claude capability.
 * hooks: onScene(scene, raw), onCast(cast), onExtras(extras), onRemarks(remarks), onBeat(beat) as each arrives.
 */
export class Director {
  constructor(sample) { this.sample = sample; this.tier = 'default'; }

  _need() { if (!this.sample) throw Object.assign(new Error('Claude is not available here'), { code: 'no_claude' }); }

  async turn(state, input, { signal, codexText = '', hooks = {}, prompt = null } = {}) {
    this._need();
    const cast = { ...state.cast };
    let extras = state.extras ?? {};
    let scene = null;
    let n = 0;
    const reader = new StreamReader({
      onValue: (k, v) => {
        if (k === 'scene') { scene = cleanScene(v, state.scene, cast); hooks.onScene?.(scene); }
        else if (k === 'cast' && Array.isArray(v)) { const out = {}; for (const c of v) { const cid = id(c?.id); if (cid && cid !== 'you') out[cid] = cast[cid] = cleanCast(c, cast[cid] ?? {}); } if (scene) for (const x of Object.keys(out)) if (!scene.present.includes(x)) scene.present.push(x); hooks.onCast?.(out); }
        else if (k === 'extras') { extras = cleanExtras(v); hooks.onExtras?.(extras); }
        else if (k === 'remarks' && Array.isArray(v)) hooks.onRemarks?.(v.map((m) => ({ who: id(m?.who), text: str(m?.text, 140) })).filter((m) => m.text && (cast[m.who] || extras[m.who])));
      },
      onElement: (k, v) => {
        if (k !== 'beats') return;
        const b = cleanBeat(v ?? {}, cast, extras);
        if (b.narration || b.line) { n++; hooks.onBeat?.(b); }
      },
    });
    const r = await this.sample.json(prompt ?? directorPrompt(state, input, { codexText }), { modelTier: this.tier, cache: false, signal, onText: ({ text }) => reader.feed(text) });
    const c = cleanReply(r, state);
    c.streamed = n;
    if (!c.beats.length && !c.director && !c.report) throw Object.assign(new Error('The director wrote nothing'), { code: 'empty' });
    return c;
  }

  async json(prompt, { tier = 'quick', signal } = {}) {
    this._need();
    return this.sample.json(prompt, { modelTier: tier, cache: false, signal });
  }
}
