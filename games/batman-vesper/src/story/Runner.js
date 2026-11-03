import { INITIAL_STATE, CAST, EPISODE, CHAPTERS, TITLE } from './episode1.js';

/**
 * The story runner: the scene API the episode is written against (`S` in episode1.js).
 * It owns the state (flags, trust, the code, the flowchart) and the logic of choices,
 * negotiations and free text (with Claude, or with authored fallbacks), and hands every
 * picture and sound to a theatre: Theatre3D (the film) or Theatre2D (the illustrated story).
 *
 * A theatre implements: chapterCard, stage, place, act, cut, line, caption, choose, qte, meter,
 * fight, explore, objective, notify, fade, special, headline, endCard, weather, music, sfx,
 * ambience, space, lights, strike, kick, thinking.
 */
export class Runner {
  constructor(theatre, claude, { save = true } = {}) {
    this.T = theatre;
    this.claude = claude;
    this.state = INITIAL_STATE();
    this.flowchart = [];          // [{chapter, id, prompt, options:[{id,label}], chosen, free?}]
    this.transcript = [];         // the last lines, for Claude's context
    this.chapterId = null;
    this.saveEnabled = save;
    this.skipTo = null;
  }

  // ---------------------------------------------------------------- state
  get(k) { return this.state[k]; }
  set(k, v) { this.state[k] = v; this._changed(); }
  flag(k) { this.state.flags[k] = true; }
  has(k) { return !!(this.state.flags[k] || this.state.intel[k]); }
  intel(k) { if (!this.state.intel[k]) { this.state.intel[k] = true; this.T.notify?.(INTEL_TEXT[k] ?? null, 'intel'); } }
  trust(who, d) {
    if (d === undefined) return this.state.trust[who] ?? 0;
    this.state.trust[who] = (this.state.trust[who] ?? 0) + d;
    const name = CAST[who]?.name ?? who;
    if (d) this.T.notify?.(`${name} ${d > 0 ? 'trusts you more' : 'trusts you less'}`, d > 0 ? 'up' : 'down');
    return this.state.trust[who];
  }
  legend(d) { this.state.legend += d; }
  code(d) { this.state.code = Math.max(0, Math.min(100, this.state.code + d)); if (d < 0) this.T.notify?.('Your code bends.', 'down'); }
  hurt(d) { this.state.hurt += d; this.T.kick?.(0.8); }
  time(min) { this.state.minutes += min; }
  _changed() { if (this.saveEnabled) this.save(); }

  save() {
    try { localStorage.setItem('vesper.save', JSON.stringify({ state: this.state, flowchart: this.flowchart, chapter: this.chapterId, t: Date.now() })); } catch { /* private */ }
  }
  static loadSave() { try { return JSON.parse(localStorage.getItem('vesper.save') ?? 'null'); } catch { return null; } }

  // ---------------------------------------------------------------- presentation
  async chapter(id, title, sub) { this.chapterId = id; this.save(); await this.T.chapterCard(id, title, sub); }
  stage(name, o) { return this.T.stage(name, o); }
  place(who, mark, yaw) { return this.T.place(who, mark, yaw); }
  act(who, spec) { return this.T.act(who, spec); }
  cut(spec) { return this.T.cut(spec); }
  weather(w) { return this.T.weather(w); }
  music(m, i) { return this.T.music(m, i); }
  sfx(n) { return this.T.sfx(n); }
  ambience(a) { return this.T.ambience(a); }
  space(k) { return this.T.space?.(k); }
  lights(m) { return this.T.lights?.(m); }
  strike(d) { return this.T.strike?.(d); }
  kick(a) { return this.T.kick?.(a); }
  sting(k) { return this.T.sting?.(k); }
  wait(s) { return this.T.wait(s); }
  caption(t, d) { return this.T.caption(t, d); }
  objective(t) { return this.T.objective?.(t); }
  notify(t) { return this.T.notify?.(t, 'event'); }
  fade(to, d) { return this.T.fade?.(to, d); }
  special(n, a) { return this.T.special?.(n, a); }
  headline(h, b) { return this.T.headline?.(h, b); }
  endCard() { return this.T.endCard?.(this); }
  fight(kind, who, ok) { return this.T.fight?.(kind, who, ok); }
  flow(chapter, id, label) { this.flowchart.push({ chapter, id, label, outcome: true }); this.save(); }

  async say(who, text, o = {}) {
    if (who === 'batman' && this._skipBatman) { this._skipBatman = false; return; }
    this._skipBatman = false;
    this.transcript.push(`${CAST[who]?.name ?? who}: ${text}`);
    if (this.transcript.length > 24) this.transcript.shift();
    await this.T.line(who, text, o);
  }

  qte(spec) { return this.T.qte(spec); }

  async explore(spec) {
    const found = await this.T.explore(spec, async (spot) => {
      if (spot.gives) this.intel(spot.gives);
      if (spot.line) await this.say(spot.line[0], spot.line[1]);
    });
    return found;
  }

  // ---------------------------------------------------------------- choices
  /**
   * A choice: options (filtered by `need`), an optional timer (the default is taken when it
   * runs out), and free text if `free` is given. Returns an option id, or an object
   * { free: true, mapped, lines } when the player wrote something Claude improvised on.
   */
  async choose(spec) {
    const options = spec.options.filter((o) => !o.need || this.has(o.need));
    // every choice takes free text: where the script gives no context, the prompt is the context
    const free = spec.free ?? { who: 'batman', context: spec.prompt ?? 'Batman has to decide what to do next.' };
    spec = { ...spec, free };
    let attempts = 0;
    for (;;) {
      const r = await this.T.choose({ ...spec, options, allowFree: true });
      if (r.free == null) {
        this._record(spec, options, r.id);
        return r.id;
      }
      attempts++;
      const res = await this._freeChoice(spec, options, r.free);
      if (res.mapped && options.some((o) => o.id === res.mapped)) {
        this._record(spec, options, res.mapped, r.free);
        // the player's own words replace the scripted line of that option; the scene goes on
        if (res.speech && spec.free.who) { await this.say(spec.free.who, res.speech, { emo: res.emotion }); if (spec.free.who === 'batman') this._skipBatman = true; }
        return res.mapped;
      }
      // improvised, then the choice comes back
      if (res.speech && spec.free.who) await this.say(spec.free.who, res.speech, { emo: res.emotion });
      if (res.reply?.text) await this.say(res.reply.who, res.reply.text, { emo: res.reply.emotion });
      if (attempts >= 3) {
        const d = spec.default ?? options[0].id;
        this._record(spec, options, d, r.free);
        return d;
      }
    }
  }

  _record(spec, options, chosen, free) {
    this.flowchart.push({ chapter: this.chapterId, id: spec.id, prompt: spec.prompt, options: options.map((o) => ({ id: o.id, label: o.label })), chosen, free: free ?? null });
    this.save();
  }

  async improv(r) { for (const l of r?.lines ?? []) await this.say(l.who, l.text, { emo: l.emotion }); }

  _context() {
    const st = this.state;
    return [
      `Game: ${TITLE.name}, ${TITLE.episode} "${TITLE.episodeTitle}". A cinematic interactive film. Earth-V, Vesper City, a rain-soaked port. The player is Batman: Noah Vale, heir to Vale Maritime, on his first night in the suit. Mags Holloway is his voice on the radio. The villain is the Ferryman (secretly Harbour Commissioner Silas Marrow), who makes people disappear on freighters.`,
      `Current chapter: ${CHAPTERS.find((c) => c.id === this.chapterId)?.title ?? this.chapterId}.`,
      `State: Batman's code ${st.code}/100; Nadia ${st.nadia}; Rook ${st.rook}; known: ${Object.keys(st.intel).join(', ') || 'nothing yet'}.`,
      `Recent lines:\n${this.transcript.slice(-10).join('\n')}`,
    ].join('\n');
  }

  async _freeChoice(spec, options, text) {
    const fallback = () => ({ mapped: matchOption(text, options), speech: cleanSpeech(text), emotion: 'determined' });
    if (!this.claude?.available) return fallback();
    this.T.thinking?.(true);
    try {
      const prompt = `${this._context()}

The player is choosing what Batman does or says. The situation: ${spec.free.context}
Authored options: ${options.map((o) => `"${o.id}": ${o.label}`).join('; ')}.
The player typed: "${text.slice(0, 400)}"

Decide how the story takes it, as a careful game writer would:
- If it amounts to one of the options (even in different words), set "mapped" to that option's id.
- Otherwise set "mapped" to null and improvise a short in-world beat: what Batman says (in his voice: few words, low, controlled) and one reply from whoever he is with (in character), WITHOUT inventing plot facts, killing anyone, or skipping ahead.
- Batman does not kill. If the player asks for something cruel or impossible, Batman can refuse or the world can push back.
- Keep every line under 30 words. No stage directions in the lines.
Reply as JSON: {"mapped": "<option id or null>", "speech": "<what Batman says, or empty>", "emotion": "<one of: neutral, grim, cold, determined, worried, angry, calm>", "reply": {"who": "<${Object.keys(CAST).join('|')}>", "text": "<their reply or empty>", "emotion": "<emotion>"}}`;
      const j = await this.claude.json(prompt, { tier: 'quick' });
      return { mapped: j.mapped && j.mapped !== 'null' ? String(j.mapped) : null, speech: clip(j.speech), emotion: j.emotion, reply: j.reply?.text ? { who: CAST[j.reply.who] ? j.reply.who : (spec.free.to ?? 'mags'), text: clip(j.reply.text), emotion: j.reply.emotion } : null };
    } catch { return fallback(); } finally { this.T.thinking?.(false); }
  }

  // ---------------------------------------------------------------- conversations
  /**
   * A conversation over a few turns. With a meter (a negotiation), each turn moves it; at
   * `win` the other side gives in, at `lose` it breaks. Without one, options are questions
   * and each may be asked once; `always` options are told anyway before it ends.
   * Returns { outcome: 'win'|'lose'|'end', action?, meter }.
   */
  async converse(spec) {
    const who = spec.who;
    const m = spec.meter ? { ...spec.meter, value: spec.meter.start } : null;
    if (m) this.T.meter?.({ show: true, name: m.name, label: m.label, value: m.value });
    const used = new Set();
    const history = [];
    let outcome = 'end', action = null;
    for (let turn = 0; turn < (spec.turns ?? 3); turn++) {
      const opts = spec.options.filter((o) => (!o.need || this.has(o.need)) && !used.has(o.id));
      if (!opts.length) break;
      const r = await this.T.choose({ id: spec.id + '_' + turn, prompt: m ? `${CAST[who].name} — ${m.label}` : `Talk to ${CAST[who].name}`, options: opts, allowFree: true, converse: true, converseWho: who, timer: m ? 14 : 0 });
      let delta = 0, reply = null, emotion = null;
      if (r.free == null) {
        const o = opts.find((x) => x.id === r.id);
        used.add(o.id);
        this.flowchart.push({ chapter: this.chapterId, id: spec.id, prompt: spec.meter?.label ?? `Talking to ${CAST[who].name}`, options: opts.map((x) => ({ id: x.id, label: x.label })), chosen: o.id });
        if (o.action) { action = o.id; break; }
        // the line itself (strip the quotes of a spoken option)
        const said = o.label.replace(/^"|"$/g, '');
        if (/^"/.test(o.label)) await this.say('batman', said, { emo: 'cold' });
        delta = o.delta ?? 0; reply = o.reply;
        if (o.trust) this.trust(who, o.trust);
        if (o.code) this.code(o.code);
        if (o.legend) this.legend(o.legend);
        if (o.gives) this.intel(o.gives);
        if (o.sting) this.sting('hit');
        history.push(`Batman: ${said}`);
      } else {
        const res = await this._freeTurn(spec, m, r.free, history);
        if (res.speech) await this.say('batman', res.speech, { emo: res.batEmotion ?? 'cold' });
        delta = res.delta; reply = res.reply; emotion = res.emotion;
        for (const g of res.reveals ?? []) if (INTEL_TEXT[g]) this.intel(g);
        history.push(`Batman: ${res.speech || r.free}`);
        this.flowchart.push({ chapter: this.chapterId, id: spec.id, prompt: spec.meter?.label ?? `Talking to ${CAST[who].name}`, options: opts.map((x) => ({ id: x.id, label: x.label })), chosen: null, free: r.free });
        if (res.end === 'win' && m) delta = Math.max(delta, m.win - m.value);
        if (res.end === 'lose' && m) delta = Math.min(delta, m.lose - m.value);
      }
      if (m) {
        m.value = Math.max(0, Math.min(100, m.value + delta));
        this.T.meter?.({ show: true, name: m.name, label: m.label, value: m.value, delta });
      }
      if (reply) { await this.say(who, reply, { emo: emotion ?? (m ? (delta >= 0 ? 'desperate' : 'fury') : undefined) }); history.push(`${CAST[who].name}: ${reply}`); }
      if (m && m.value >= m.win) { outcome = 'win'; break; }
      if (m && m.lose >= 0 && m.value <= m.lose) { outcome = 'lose'; break; }
    }
    if (m && outcome === 'end' && !action) outcome = m.value >= (m.win + Math.max(0, m.lose)) / 2 ? 'win' : 'lose';
    // facts the scene must deliver
    for (const id of spec.always ?? []) if (!used.has(id)) { const o = spec.options.find((x) => x.id === id); if (o?.reply) await this.say(who, o.reply); }
    if (m) this.T.meter?.({ show: false });
    return { outcome, action, meter: m?.value };
  }

  async _freeTurn(spec, m, text, history) {
    const fallback = () => {
      const s = scoreTone(text);
      const o = spec.options.find((x) => x.id === matchOption(text, spec.options.filter((y) => !y.action && (!y.need || this.has(y.need)))));
      return { speech: cleanSpeech(text), delta: m ? (o?.delta ?? s * 8) : 0, reply: o?.reply ?? (s >= 0 ? '...Keep talking.' : 'You don\'t scare me. You don\'t.'), gives: [] };
    };
    if (!this.claude?.available) return fallback();
    this.T.thinking?.(true);
    try {
      const prompt = `${this._context()}

You are playing ${CAST[spec.who].name} in this scene. Stay strictly in character.
Character: ${spec.persona}
Situation: ${spec.situation}
${m ? `There is a hidden meter "${m.label}" from 0 to 100, now ${m.value}. At ${m.win} the character gives in; ${m.lose >= 0 ? `at ${m.lose} they break badly` : 'it cannot break'}.` : ''}
${spec.facts ? `Facts this character knows and may reveal: ${spec.facts.join('; ')}. Never invent other plot facts.` : ''}
Conversation so far:\n${history.join('\n') || '(none)'}
Batman (the player) now says or does: "${text.slice(0, 400)}"

Respond as JSON:
{"speech": "<Batman's words, tidied to his voice: short, low, controlled; empty if he only acts>",
 "batEmotion": "<cold|grim|determined|calm|angry|worried>",
 ${m ? '"delta": <integer -30..30: how this moves the meter, judged honestly from the character\'s fears and wants>,' : '"delta": 0,'}
 "reply": "<the character\'s spoken reply, under 35 words>",
 "emotion": "<afraid|desperate|angry|fury|sad|worried|cold|contempt|surprised|calm|smirk|grim>",
 "reveals": [<any of: ${spec.options.filter((o) => o.gives).map((o) => `"${o.gives}"`).join(', ') || ''} only if the character truly gives that information now>],
 "end": <"win" | "lose" | null>}`;
      const j = await this.claude.json(prompt, { tier: 'quick' });
      return { speech: clip(j.speech), batEmotion: j.batEmotion, delta: Math.max(-30, Math.min(30, Number(j.delta) || 0)), reply: clip(j.reply, 220), emotion: j.emotion, reveals: Array.isArray(j.reveals) ? j.reveals : [], end: j.end === 'win' || j.end === 'lose' ? j.end : null };
    } catch { return fallback(); } finally { this.T.thinking?.(false); }
  }

  // ---------------------------------------------------------------- the episode
  async play(fromChapter = null) {
    const order = EPISODE;
    let start = 0;
    if (fromChapter) start = Math.max(0, CHAPTERS.findIndex((c) => c.id === fromChapter));
    for (let i = start; i < order.length; i++) {
      await order[i](this);
    }
  }
}

// ---------------------------------------------------------------------------
// After the ending: Claude as showrunner. Each night continues from the state the player
// left the city in. Claude writes one scene at a time as beats in the engine's vocabulary
// (the sets, the cast, shot types, postures, emotions); the theatre performs it; the player's
// choice (or own words) goes into the next request. Nothing is written in advance.

export const SETS = {
  cathedral: { marks: ['perch', 'ledge', 'roofCenter'], about: 'St. Brigid\'s Cathedral roof, a gargoyle over the city' },
  garage: { marks: ['stairDoor', 'pillarB', 'van', 'vanFront', 'lightPool', 'ramp', 'breaker', 'standoffRook', 'standoffBat'], about: 'Harrow Street parking, level B3' },
  garageRoof: { marks: ['roofLedge', 'roofNadia', 'roofDoor', 'roofEdge', 'ledgeHold', 'ledgeSafe'], about: 'the open roof of the Harrow Street garage, the skyline' },
  acheron: { marks: ['deckAft', 'deckGuard', 'containerRow', 'bridgeWing', 'bridgeWingBat', 'bridgeStair'], about: 'the deck of the freighter MV Acheron, impounded at Pier Nine' },
};
const POSTURES = ['idle', 'idle_tense', 'stand_wide', 'arms_crossed', 'hands_up', 'point', 'phone', 'gun_low', 'gun_aim', 'guard', 'kneel', 'crouch', 'perch', 'talk_open', 'talk_chest', 'shrug', 'head_down', 'look_up', 'fear_back'];
const EMOTIONS = ['neutral', 'calm', 'happy', 'smirk', 'sad', 'afraid', 'angry', 'fury', 'disgust', 'surprised', 'determined', 'grim', 'pained', 'desperate', 'contempt', 'cold', 'worried', 'tired'];

Runner.prototype.continueStory = async function continueStory({ maxScenes = 99 } = {}) {
  if (!this.claude?.available) { await this.T.caption?.('NIGHT TWO is written live by Claude. Connect Claude in the menu to keep going.', 5); return false; }
  const st = this.state;
  const recap = `Episode 1 ended: Nadia ${st.nadia}; Rook ${st.rook}; Marrow ${st.marrow}; the container ${st.flags.saved ? 'opened, eleven saved' : st.flags.drowned ? 'flooded' : 'opened'}; Batman's code ${st.code}/100; legend ${st.legend > 0 ? 'hope' : st.legend < 0 ? 'fear' : 'rumour'}; Cruz trust ${st.trust.cruz}; ${st.flags.burner ? 'Cruz left him a burner phone' : ''}; Nadia ${st.flags.published ? 'published part one' : 'is holding her story'}.`;
  const scenes = [];
  let night = 2, lastChoice = null;
  for (let n = 0; n < maxScenes; n++) {
    this.T.thinking?.(true, 'Claude is writing the next scene…');
    let sc;
    try {
      sc = await this.claude.json(`${this._context()}

${recap}
Previous scenes of the continuation: ${scenes.map((x, i) => `${i + 1}. ${x.title}: ${x.summary}${x.choice ? ` (player chose: ${x.choice})` : ''}`).join(' ') || 'none yet'}.
${lastChoice ? `The player just chose: ${lastChoice}` : `Begin NIGHT ${night}: the next night in Vesper. Pick up the threads (Marrow's people, the ledger's other names, Cruz, Nadia, Rook, Mags, Noah's double life) and add one new threat of your own invention (an original villain, not a DC character).`}

Write the next scene of this interactive film as JSON. Use only:
sets: ${Object.entries(SETS).map(([k, v]) => `${k} (${v.about}; marks: ${v.marks.join(', ')})`).join('; ')}
cast ids: ${Object.keys(CAST).filter((k) => k !== 'dispatch').join(', ')} (mags and dispatch are voices on the radio, never placed)
postures: ${POSTURES.join(', ')}; emotions: ${EMOTIONS.join(', ')}; shot types: ecu, cu, mcu, ms, ws, ews, ots (with "over"), two (with "with").
{"title": "<SHORT CAPS TITLE>", "place": "<caption line: place · time>", "set": "<set id>", "weather": {"rain": 0..1, "lightning": 0..1},
 "music": "<dread|tension|action|grief|dawn>",
 "cast": [{"who": "<id>", "mark": "<mark>", "yaw": <degrees>, "posture": "<posture>"}],
 "beats": [ {"cut": {"type": "<shot>", "on": "<id>", "angle": <deg>, "over": "<id>", "with": "<id>"}} | {"say": "<id>", "text": "<under 30 words>", "emo": "<emotion>"} | {"act": "<id>", "posture": "<posture>", "lookAt": "<id>"} | {"caption": "<short>"} ],
 "choice": {"prompt": "<the dilemma>", "options": [{"id": "a", "label": "<what Batman does or says>"}, {"id": "b", "label": "..."}, {"id": "c", "label": "..."}]} or null if the night ends here,
 "summary": "<one sentence>"}
8 to 16 beats. Cinematic, terse noir dialogue. Batman speaks little. Keep continuity with everything above.`, { tier: 'default' });
    } catch (e) { this.T.thinking?.(false); await this.T.caption?.('Claude could not write the next scene (' + (e?.code ?? e?.message ?? 'error') + ').', 4); return false; }
    this.T.thinking?.(false);
    if (!sc || !SETS[sc.set]) sc = { ...sc, set: 'garageRoof' };
    await this.chapter('night' + night + '_' + n, String(sc.title ?? 'NIGHT ' + night).toUpperCase().slice(0, 40), sc.place ?? '');
    await this.stage(sc.set);
    this.weather({ rain: +(sc.weather?.rain ?? 0.5), lightning: +(sc.weather?.lightning ?? 0.1), night: 1, overcast: 0.9 });
    this.music(['dread', 'tension', 'action', 'grief', 'dawn'].includes(sc.music) ? sc.music : 'dread', 0.4);
    for (const c of sc.cast ?? []) if (CAST[c.who] && !CAST[c.who].radio) { this.place(c.who, SETS[sc.set].marks.includes(c.mark) ? c.mark : SETS[sc.set].marks[0], +c.yaw || 0); this.act(c.who, { posture: POSTURES.includes(c.posture) ? c.posture : 'idle', setVisible: true }); }
    for (const b of (sc.beats ?? []).slice(0, 24)) {
      if (b.cut && CAST[b.cut.on]) this.cut({ type: b.cut.type ?? 'ms', on: b.cut.on, angle: +b.cut.angle || 0, over: b.cut.over, with: b.cut.with, still: (b.cut.on ?? '') + '_cu' });
      else if (b.say && CAST[b.say] && b.text) await this.say(b.say, clip(b.text, 220), { emo: EMOTIONS.includes(b.emo) ? b.emo : undefined, radio: CAST[b.say].radio });
      else if (b.act && CAST[b.act]) this.act(b.act, { posture: POSTURES.includes(b.posture) ? b.posture : undefined, lookAt: CAST[b.lookAt] ? b.lookAt : undefined });
      else if (b.caption) await this.caption(clip(b.caption, 140), 3);
    }
    const rec = { title: sc.title, summary: sc.summary ?? '' };
    scenes.push(rec);
    if (!sc.choice?.options?.length) { night++; lastChoice = null; await this.T.caption?.('END OF NIGHT ' + (night - 1), 3); const more = await this.T.choose({ id: 'continue', prompt: 'Keep going?', options: [{ id: 'yes', label: 'Next night' }, { id: 'no', label: 'Stop here' }] }); if (more.id !== 'yes') return true; continue; }
    const opts = sc.choice.options.slice(0, 4).map((o, i) => ({ id: String(o.id ?? 'o' + i), label: clip(String(o.label), 90) }));
    const r = await this.T.choose({ id: 'live_' + n, prompt: clip(sc.choice.prompt, 140), options: opts, allowFree: true });
    lastChoice = r.free ?? opts.find((o) => o.id === r.id)?.label;
    rec.choice = lastChoice;
    this.flowchart.push({ chapter: 'night' + night, id: 'live_' + n, prompt: sc.choice.prompt, options: opts, chosen: r.id ?? null, free: r.free ?? null });
    this.save();
  }
  return true;
};

// ---------------------------------------------------------------------------
// Offline helpers: word overlap with synonyms, and a crude tone score

const SYN = {
  ready: ['ready', 'yes', 'lets go', 'go time', 'born ready'], unsure: ['not sure', 'scared', 'afraid', 'dont know', 'nervous', 'unsure'],
  quiet: ['quiet', 'shut', 'off the line', 'leave me', 'silence'], glide: ['go', 'now', 'jump', 'glide', 'leap', 'fly', 'move'],
  schematics: ['plan', 'plans', 'schematic', 'blueprint', 'map', 'layout', 'building'], cruz: ['cruz', 'police', 'cop', 'detective', 'call it in', 'call'],
  breaker: ['light', 'lights', 'breaker', 'power', 'dark'], stealth: ['shadow', 'sneak', 'stealth', 'quiet', 'ramp', 'dez', 'silent'], walk: ['walk', 'confront', 'face', 'step out', 'show myself', 'intimidate'],
  restrain: ['tie', 'restrain', 'cuff', 'hold', 'arrest'], release: ['go home', 'let him go', 'leave', 'daughter', 'free'],
  see: ['look at me', 'eyes', 'calm', 'breathe', 'easy'], threat: ['kill', 'die', 'hurt', 'break', 'fall', 'regret'], who: ['who', 'boss', 'paying', 'for'],
  lucia: ['lucia', 'daughter', 'kid', 'child', 'family', 'girl'], out: ['way out', 'help you', 'protect', 'safe', 'deal'],
  hospital: ['hospital', 'doctor', 'mercy', 'carry'], publish: ['publish', 'print', 'run it', 'story'], hold: ['hold', 'wait', 'morning'],
  defend: ['not in on', 'innocent', 'isnt involved', 'he isnt'], start: ['start with him', 'vale', 'look into'],
  talk: ['talk', 'listen', 'explain', 'help'], vanish: ['vanish', 'leave', 'disappear', 'go'], hand: ['hand', 'give her', 'rook', 'prisoner'],
  board: ['board', 'climb', 'stern', 'jump'], engines: ['engine', 'emp', 'stop the ship', 'disable'], save: ['save', 'container', 'people', 'free them'],
  chase: ['chase', 'marrow', 'after him', 'follow'], both: ['cruz', 'both', 'patrol'], take: ['alive', 'arrest', 'take him', 'trial'], sea: ['sea', 'drown', 'let him fall'],
  guardian: ['guardian', 'protect', 'someone who stays', 'hope'], fear: ['fear', 'afraid', 'terror'], truth: ['truth', 'honest', 'light'],
  ledger: ['names', 'who are', 'people'], ship: ['ship', 'which', 'boat', 'acheron'], vale: ['charter', 'company', 'own', 'vale'],
  acheron: ['acheron', 'pier', 'patrol', 'ship'], stay: ['stay out', 'out of my way'],
};
export function matchOption(text, options) {
  const t = ' ' + text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ') + ' ';
  let best = null, score = 0;
  for (const o of options) {
    const words = [...(SYN[o.id] ?? []), ...o.label.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3)];
    let s = 0;
    for (const w of words) if (t.includes(' ' + w + ' ') || (w.includes(' ') && t.includes(w))) s += w.includes(' ') ? 2 : 1;
    if (s > score) { score = s; best = o.id; }
  }
  return best;
}
function scoreTone(text) {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of ['daughter', 'lucia', 'family', 'help', 'safe', 'promise', 'way out', 'look at me', 'breathe', 'calm', 'protect', 'nobody has to', 'trust']) if (t.includes(w)) s += 1;
  for (const w of ['kill', 'die', 'dead', 'fall', 'hurt', 'break', 'scum', 'regret', 'pathetic']) if (t.includes(w)) s -= 1.5;
  return Math.max(-3, Math.min(3, s));
}
function cleanSpeech(text) { const t = text.trim().replace(/^["']|["']$/g, ''); return t.length > 160 ? t.slice(0, 157) + '...' : t; }
function clip(s, n = 180) { if (!s || typeof s !== 'string') return ''; s = s.replace(/\*[^*]*\*/g, '').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; }

export const INTEL_TEXT = {
  schematics: 'Learned: the garage plans', pier9: 'Learned: Pier Nine, two o\'clock', lucia: 'Learned: Lucia', ledger: 'Evidence: the ledger',
  coin: 'Evidence: the coin', tracker: 'Tracker placed', container: 'Learned: container VTX-4471', marrowHint: 'Learned: the voice on the phone',
  marrowName: 'Learned: Silas Marrow',
};
