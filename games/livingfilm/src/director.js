/**
 * The director: Claude, writing the film as it is lived.
 *
 * Each turn sends the story so far (the premise, the cast with what they
 * feel and want, the running summary, the last moments) and what the
 * player says or does. Claude answers with the next moments as film beats
 * (a shot, a line, a piece of narration), the scene they play in, any
 * change in the cast, and four things the player might do next. Nothing is
 * scripted: no line, beat or suggestion exists until Claude writes it.
 *
 * Everything that comes back is checked here (known places, sane values,
 * bounded lengths) so the renderer can trust it.
 */

export const PLACES = ['tavern', 'hall', 'chamber', 'cottage', 'church', 'workshop', 'cellar', 'dungeon', 'kitchen', 'stable',
  'street', 'market', 'square', 'forest', 'field', 'road', 'river', 'bridge', 'castle', 'camp', 'hilltop', 'garden', 'shore', 'ship', 'cave', 'graveyard', 'gate', 'courtyard'];
export const TIMES = ['dawn', 'day', 'dusk', 'night'];
export const WEATHERS = ['clear', 'rain', 'snow', 'fog', 'storm', 'wind'];
export const LIGHTS = ['daylight', 'overcast', 'firelight', 'candle', 'moonlight', 'golden', 'torchlight'];
export const MOODS = ['warm', 'tense', 'melancholy', 'eerie', 'joyful', 'grim', 'tender', 'quiet'];
export const SHOTS = ['establishing', 'wide', 'medium', 'close', 'two-shot', 'over-shoulder', 'insert'];
export const MOVES = ['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'tilt-up', 'drift'];
export const EMOTIONS = ['neutral', 'warm', 'amused', 'tender', 'sad', 'angry', 'afraid', 'surprised', 'suspicious', 'proud', 'tired'];
export const HAIR = ['short', 'long', 'braid', 'veil', 'hood', 'cap', 'hat', 'bald', 'curly', 'tied'];

const pick = (v, list, d) => (list.includes(v) ? v : d);
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v, a, b, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(a, Math.min(b, x)) : d; };
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const id = (v) => str(v, 24).toLowerCase().replace(/[^a-z0-9_-]/g, '');

/** A place word Claude used that we do not paint maps to the nearest we do. */
export function placeOf(v) {
  const s = String(v ?? '').toLowerCase();
  if (PLACES.includes(s)) return s;
  const map = [[/inn|alehouse|pub|krčma|tavern/, 'tavern'], [/throne|great hall|hall|palace/, 'hall'], [/bed|room|chamber|solar|study|cell/, 'chamber'], [/hut|house|home|cottage|hovel/, 'cottage'],
    [/chapel|church|cathedral|abbey|monastery|temple/, 'church'], [/forge|smithy|shop|workshop|mill/, 'workshop'], [/vault|cellar|crypt/, 'cellar'], [/prison|jail|dungeon|tower/, 'dungeon'],
    [/kitchen|bakery/, 'kitchen'], [/stable|barn/, 'stable'], [/lane|alley|street|town/, 'street'], [/market|fair|stall/, 'market'], [/square|plaza/, 'square'], [/wood|forest|grove/, 'forest'],
    [/field|meadow|farm|pasture/, 'field'], [/road|path|track|highway/, 'road'], [/river|stream|brook|ford/, 'river'], [/bridge/, 'bridge'], [/castle|keep|fortress|wall/, 'castle'],
    [/camp|tent/, 'camp'], [/hill|mountain|ridge|cliff/, 'hilltop'], [/garden|orchard|cloister/, 'garden'], [/shore|beach|harbour|harbor|port|quay|dock/, 'shore'], [/ship|boat|deck/, 'ship'],
    [/cave|grotto|mine/, 'cave'], [/grave|cemetery|churchyard/, 'graveyard'], [/gate/, 'gate'], [/yard|courtyard|bailey/, 'courtyard']];
  for (const [re, p] of map) if (re.test(s)) return p;
  return 'street';
}

/** Clean a character Claude described. */
export function cleanCast(c, old = {}) {
  const L = c.look ?? {};
  const o = old.look ?? {};
  return {
    id: id(c.id) || old.id,
    name: str(c.name, 40) || old.name || 'Someone',
    sex: c.sex === 'f' || c.sex === 'm' ? c.sex : old.sex ?? 'm',
    age: num(c.age, 4, 95, old.age ?? 35),
    role: str(c.role, 120) || old.role || '',
    look: {
      skin: color(L.skin, o.skin ?? '#d2a07c'), hair: color(L.hair, o.hair ?? '#4a3020'), clothes: color(L.clothes, o.clothes ?? '#6a4a30'), accent: color(L.accent, o.accent ?? '#c8a050'),
      hairStyle: pick(L.hairStyle, HAIR, o.hairStyle ?? 'short'), beard: num(L.beard, 0, 1, o.beard ?? 0), build: pick(L.build, ['slim', 'stout', 'broad'], o.build ?? 'slim'),
    },
    voice: { pitch: num(c.voice?.pitch, 0.5, 1.6, old.voice?.pitch ?? 1), rate: num(c.voice?.rate, 0.75, 1.25, old.voice?.rate ?? 1) },
    feeling: num(c.feeling, -100, 100, old.feeling ?? 0),
    note: str(c.note, 300) || old.note || '',
    secret: str(c.secret, 300) || old.secret || '',
  };
}

/** Clean one beat. */
export function cleanBeat(b, cast) {
  const on = (Array.isArray(b.on) ? b.on : []).map(id).filter((x) => x === 'you' || cast[x]).slice(0, 4);
  const who = b.who === 'you' ? 'you' : cast[id(b.who)] ? id(b.who) : null;
  return {
    shot: pick(b.shot, SHOTS, who ? 'medium' : 'wide'),
    on: who && !on.includes(who) ? [who, ...on].slice(0, 4) : on,
    move: pick(b.move, MOVES, 'drift'),
    narration: str(b.narration, 600),
    who,
    line: who ? str(b.line, 500) : '',
    emotion: pick(b.emotion, EMOTIONS, 'neutral'),
    action: str(b.action, 160),
  };
}

/** Clean a whole reply into what the film can play. */
export function cleanReply(r, state) {
  const cast = { ...state.cast };
  for (const c of (Array.isArray(r?.cast) ? r.cast : []).slice(0, 8)) {
    const cid = id(c?.id);
    if (!cid || cid === 'you') continue;
    cast[cid] = cleanCast(c, cast[cid] ?? {});
  }
  const sc = r?.scene ?? {};
  const prev = state.scene ?? {};
  const scene = {
    place: sc.place ? placeOf(sc.place) : prev.place ?? 'street',
    name: str(sc.name, 80) || prev.name || '',
    time: pick(sc.time, TIMES, prev.time ?? 'day'),
    weather: pick(sc.weather, WEATHERS, prev.weather ?? 'clear'),
    light: pick(sc.light, LIGHTS, prev.light ?? 'daylight'),
    mood: pick(sc.mood, MOODS, prev.mood ?? 'quiet'),
    present: (Array.isArray(sc.present) ? sc.present.map(id).filter((x) => cast[x]) : prev.present ?? []).slice(0, 6),
  };
  scene.cut = !!sc.new || scene.place !== prev.place || scene.name !== prev.name;
  const beats = (Array.isArray(r?.beats) ? r.beats : []).slice(0, 10).map((b) => cleanBeat(b ?? {}, cast)).filter((b) => b.narration || b.line);
  for (const b of beats) for (const x of b.on) if (x !== 'you' && !scene.present.includes(x)) scene.present.push(x);
  const suggestions = (Array.isArray(r?.suggestions) ? r.suggestions : []).map((s) => ({ kind: s?.kind === 'do' ? 'do' : 'say', text: str(s?.text, 120) })).filter((s) => s.text).slice(0, 4);
  return { cast, scene, beats, suggestions, summary: str(r?.summary, 1400), memory: str(r?.memory, 240), end: !!r?.end };
}

/** The prompt for one turn. */
export function directorPrompt(state, input) {
  const P = state.player;
  const cast = Object.values(state.cast).map((c) => `- ${c.id}: ${c.name} (${c.sex === 'f' ? 'woman' : 'man'}, ${c.age}), ${c.role}. Feeling toward the player: ${c.feeling} (-100 hate … 100 love). ${c.note ? `Now: ${c.note}` : ''}${c.secret ? ` SECRET (theirs, never told unless they choose): ${c.secret}` : ''}`).join('\n') || '(nobody yet: introduce people as the story needs them)';
  const recent = state.log.slice(-24).map((l) => (l.who === 'you' ? `PLAYER ${l.kind === 'do' ? 'does' : 'says'}: ${l.text}` : l.who ? `${state.cast[l.who]?.name ?? l.who}: "${l.text}"` : `(${l.text})`)).join('\n') || '(the film has not begun)';
  const sc = state.scene;
  return `You are the director, the writer and every actor of a film that the player lives from the inside. Nothing is scripted: you write each moment now, in answer to what the player says and does.

THE STORY
${state.premise}
${state.world ? `World notes: ${state.world}` : ''}

THE PLAYER'S CHARACTER ("you")
${P.name}, ${P.sex === 'f' ? 'a woman' : P.sex === 'm' ? 'a man' : 'a person'}. ${P.who}

THE CAST
${cast}

THE STORY SO FAR
${state.summary || '(beginning)'}
${state.chronicle.length ? `Things that matter: ${state.chronicle.slice(-12).join(' | ')}` : ''}

THE LAST MOMENTS
${recent}

THE SCENE NOW
${sc ? `${sc.name || sc.place}, ${sc.time}, ${sc.weather}, ${sc.light}; mood ${sc.mood}; present: ${sc.present.map((x) => state.cast[x]?.name ?? x).join(', ') || 'nobody but the player'}` : '(none yet: open the film)'}

${input ? `THE PLAYER NOW ${input.kind === 'do' ? 'DOES' : 'SAYS'}: ${input.text}` : 'OPEN THE FILM: set the first scene and let the story come to the player.'}

HOW TO WRITE IT
- People are real human beings: warmth, humour, moods, pride, fear, tenderness, little habits and vanities, wants of their own. They remember what the player did and said, and their feelings carry on and change. Let them surprise. Let them be kind, and let them be cruel when it is in them.
- Be true to the time and place of the story: how people speak, believe, eat, work, what they fear and what is unthinkable to them. No anachronisms.
- Be creative and concrete: the smell of the room, the weather on the skin, the object in a hand. Show rather than tell.
- The player alone decides what "you" say, think and do. Never write the player's words or choices; write only what the world does in answer, and what the player sees and hears. If what they try is impossible or fails, show it.
- Write it as film: 3 to 7 beats. Each beat is one shot: an establishing shot when the place changes, wide for action, medium for talk, close on a face at a moment of feeling, an insert on a telling object. Narration is short and visual (what the camera sees), present tense, second person for the player. A line of dialogue is one character speaking (a sentence or three). End on something for the player to answer.
- Keep the story moving: consequences, surprises, people with their own business. Let scenes change when it makes sense (to another place or time); time can pass between scenes.

Reply with ONLY JSON:
{
 "scene": {"place": "<one of ${PLACES.join(', ')}>", "name": "<the place as people call it>", "time": "<${TIMES.join('|')}>", "weather": "<${WEATHERS.join('|')}>", "light": "<${LIGHTS.join('|')}>", "mood": "<${MOODS.join('|')}>", "present": ["<cast ids in the scene>"], "new": <true if this is a new scene>},
 "cast": [ {"id": "<short lowercase id>", "name": "...", "sex": "m|f", "age": <n>, "role": "<who they are, in a phrase>", "look": {"skin": "#rrggbb", "hair": "#rrggbb", "hairStyle": "<${HAIR.join('|')}>", "clothes": "#rrggbb", "accent": "#rrggbb", "beard": <0..1>, "build": "slim|stout|broad"}, "voice": {"pitch": <0.6..1.5>, "rate": <0.8..1.2>}, "feeling": <-100..100 toward the player>, "note": "<what they feel and want right now>", "secret": "<a secret, if they have one>"} ],
 "beats": [ {"shot": "<${SHOTS.join('|')}>", "on": ["<cast ids or 'you' in the shot>"], "move": "<${MOVES.join('|')}>", "narration": "<what the camera sees, or empty>", "who": "<cast id speaking, or null>", "line": "<their words, or empty>", "emotion": "<${EMOTIONS.join('|')}>", "action": "<a small visible action, or empty>"} ],
 "suggestions": [ {"kind": "say|do", "text": "<a natural thing the player might say or do next, under 14 words>"} x4, varied in feeling ],
 "summary": "<the whole story so far, rewritten, under 180 words>",
 "memory": "<one line if something happened that should never be forgotten, else empty>"
}
Include in "cast" every character who appears or speaks for the first time, and anyone whose feeling or wishes changed (with the new values). Colours should suit the period and person (undyed wool, madder red, woad blue, black for the rich and the clergy).`;
}

/**
 * The director, asking Claude. sample is the artifact's Claude capability.
 */
export class Director {
  constructor(sample) { this.sample = sample; this.tier = 'default'; }

  async turn(state, input, { signal, onText } = {}) {
    if (!this.sample) throw Object.assign(new Error('Claude is not available here'), { code: 'no_claude' });
    const r = await this.sample.json(directorPrompt(state, input), { modelTier: this.tier, cache: false, signal, onText });
    const c = cleanReply(r, state);
    if (!c.beats.length) throw Object.assign(new Error('The director wrote nothing'), { code: 'empty' });
    return c;
  }
}
