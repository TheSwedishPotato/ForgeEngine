import { GOODS, SHOPS, LAWS, RUMOURS, fmtMoney, ARMY_RANK, WAGES } from './data.js';
import { allRanks } from '../data/society.js';
import { BUILDING, PLACES, TOWN_NAME } from '../world/town.js';

const RANK = Object.fromEntries(allRanks().map((r) => [r.id, r]));

/**
 * Talking to people. Every person answers as themselves, through Claude
 * (the artifact's `sample` capability, on the viewer's own Claude
 * account) when it is available, and through a small scripted fallback
 * when it is not. Either way the answer is the same shape:
 *   { say, attitude, mood, action: {type, ...}, remember }
 * and the game checks every action before it happens (nobody can sell what
 * they do not have or enlist you if they are not the captain).
 */
export class Dialogue {
  constructor(sim) {
    this.sim = sim;
    this.sample = null;
    this.mode = 'scripted';
    this.turns = new Map();     // person id -> [{role, content}]
    this.ready = (async () => {
      try {
        if (typeof window !== 'undefined' && window.claude?.use) {
          this.sample = await window.claude.use('sample');
          if (this.sample) this.mode = 'claude';
        }
      } catch { this.sample = null; }
    })();
  }

  /** Who the player looks like to this person. */
  _player(p) {
    const P = this.sim.player;
    const dressWords = P.army ? `the kettle hat and padded coat of the castle garrison` : P.noble ? 'the good red cloth of a squire, a sword at the hip' : P.estate === 'towns' && P.money > 200 ? 'a burgher\'s blue coat' : 'plain wool, like a peasant or labourer';
    const bits = [`a ${P.sex === 'f' ? 'woman' : 'man'} of about twenty, dressed in ${dressWords}`];
    if (P.needs.dirt > 70) bits.push('filthy and smelling of the midden');
    else if (P.needs.dirt > 45) bits.push('none too clean');
    if (P.drunk > 25) bits.push('plainly drunk');
    if (P.weapon && P.weaponDrawn) bits.push('with a drawn weapon in hand');
    else if (P.weapon) bits.push(`carrying a ${P.weapon === 'longsword' ? 'sword' : P.weapon}`);
    const known = P.knownNames.has(p.id) ? `You know this person as ${P.name}, ${P.startName.toLowerCase()}.` : 'You do not know this person\'s name unless they tell you.';
    const crimes = P.crimes.filter((c) => c.seen.includes(p.id)).map((c) => LAWS.find((l) => l.id === c.law)?.name).filter(Boolean);
    return `${bits.join(', ')}. ${known}${crimes.length ? ` You saw them commit: ${crimes.join(', ')}.` : ''}${P.army ? ` They serve in the castle garrison as ${ARMY_RANK[P.army.rank].name.toLowerCase()}.` : ''} Town reputation: ${P.reputation > 15 ? 'well thought of' : P.reputation < -15 ? 'a known troublemaker' : P.reputation < -5 ? 'talked about' : 'a newcomer nobody knows much about'}.`;
  }

  _persona(p) {
    const s = this.sim, a = p.agent;
    const r = RANK[p.rank];
    const where = a.inside ? BUILDING[a.inside]?.name : PLACES[a.place]?.name ?? 'in the street';
    const spouse = p.spouse ? s.byId[p.spouse] : null;
    const sells = p.sells ? SHOPS[p.sells].map((k) => `${GOODS[k].name} at ${fmtMoney(GOODS[k].price)}`).join('; ') : null;
    const T = p.traits;
    const lines = [
      `You are ${p.fullName}, ${p.sex === 'f' ? 'a woman' : 'a man'} of ${p.age}, ${p.title} in ${TOWN_NAME}, a small subject town (poddanské městečko) of the lord of Skalice castle, in the Kingdom of Bohemia.`,
      `Estate: ${r?.estateName ?? p.estate}; rank: ${r?.name ?? p.rank} (precedence ${r?.rank ?? '?'} of 100: lower numbers defer to higher ones).`,
      `Character: ${p.words.join(', ')}. (Openness ${T.openness}, conscientiousness ${T.conscientiousness}, extraversion ${T.extraversion}, agreeableness ${T.agreeableness}, neuroticism ${T.neuroticism}, piety ${T.piety}, honesty ${T.honesty}, temper ${T.temper}, greed ${T.greed}, courage ${T.courage}; 0–1.)`,
      spouse ? `Married to ${spouse.fullName}, ${spouse.title}.` : '',
      `Right now: ${a.act}, at ${where}. Mood: ${p.mood}. Money in your purse: about ${fmtMoney(p.money)}.`,
      sells ? `You sell: ${sells}. You may haggle a little according to your greed, never below cost.` : '',
      p.recruiter ? `You are the captain (hejtman) of the castle garrison and are taking on men for the lord in these troubled times: foot servants (pacholci) at ${fmtMoney(ARMY_RANK.pacholek.pay)} a day with bread, beer and a padded coat and kettle hat; you want sound, sober men who will obey, not women, not drunkards, not known thieves.` : '',
      p.watch ? 'You are a soldier of the garrison and keep the watch: you arrest lawbreakers and stop people in the street after the curfew bell.' : '',
      p.jousts ? 'You are the herald of the St Wenceslas joust in the field south of the town, and you know the rules: coronel lances, four courses, a broken lance scores.' : '',
      p.role === 'farmer' || p.role === 'headman' ? `You sometimes take on day labourers for threshing and carting at about ${fmtMoney(WAGES.labourer.pay)} a day.` : '',
      `Your attitude to the person talking to you: ${p.attitude} (−100 hatred … +100 love).${p.memory.length ? ` What you remember of them: ${p.memory.slice(-6).join('; ')}.` : ' You have not met them before.'}`,
    ];
    return lines.filter(Boolean).join('\n');
  }

  _world() {
    const s = this.sim;
    return [
      `Date and time: ${s.situation()}.`,
      'The world in 1403: King Wenceslas IV is held prisoner in Vienna by his brother Sigismund of Hungary; Sigismund\'s Hungarians and Cumans have raided the land; lords quarrel and robbers haunt the roads; the Prague groschen (12 parvi; 60 groschen make a kopa) has been debased. Master Jan Hus preaches in Prague. Nothing that happens after September 1403 is known to you.',
      `The law here (the town's ordinances): ${LAWS.slice(0, 9).map((l) => `${l.name}: ${l.text}`).join(' ')}`,
      `Gossip you might pass on if asked: ${RUMOURS.join(' ')}`,
    ].join('\n');
  }

  _instructions(p) {
    return `You are playing one person in a historically and socially accurate simulation of Bohemian town life in 1403. Stay in character as that person at all times.

${this._world()}

WHO YOU ARE
${this._persona(p)}

WHO IS TALKING TO YOU
${this._player(p)}

HOW TO ANSWER
- Speak as this person would in 1403: plain words, their own concerns, the manners of their rank toward the speaker's apparent rank (deference upward, condescension or familiarity downward), their mood and temper. English, with an occasional Czech word they would naturally use (pane, paní, groš, rychta, krčma, hejtman). One to three sentences, never more than 60 words.
- You know only what this person could know. If asked about things outside it, say you don't know, or answer from rumour.
- You are a real person, not a guide: you may refuse, haggle, lie (if dishonest), take offence, call the watch, or end the talk.
- Reply with ONLY a JSON object, no other text:
{"say": "your words", "attitude": <integer change to your attitude, -20 to 20>, "mood": "<one word>", "action": {"type": "none" | "sell" | "enlist" | "hire_day" | "directions" | "learn_name" | "call_watch" | "leave", "item": "<goods id when selling: ${Object.keys(GOODS).join(', ')}>", "price": <parvi when selling>, "place": "<place id when giving directions: ${[...Object.keys(PLACES), ...Object.keys(BUILDING).filter((k) => !/^h\d/.test(k))].join(', ')}>"}, "remember": "<a few words worth remembering about this meeting, or empty>"}
- Use "sell" only for goods you actually sell and only when the deal is agreed; "enlist" only if you are the captain and you accept them; "hire_day" if you agree to hire them for a day's labour now; "learn_name" when they tell you their name; "call_watch" if they threaten you or break the law before you; "leave" when you end the conversation.`;
  }

  /**
   * Say something to a person. Resolves with the checked reply.
   * onText streams the raw text while Claude writes (optional).
   */
  async say(p, text, { onText, signal } = {}) {
    await this.ready;
    const hist = this.turns.get(p.id) ?? [];
    const msg = `The stranger says: "${text}"`;
    let r = null;
    if (this.sample) {
      const turns = [{ role: 'user', content: this._instructions(p) + `\n\n${msg}` }];
      // keep the last exchanges (each a user line and the JSON reply)
      const recent = hist.slice(-10);
      if (recent.length) turns.splice(0, 1, { role: 'user', content: this._instructions(p) + '\n\n(The conversation so far follows.)' }, ...recent, { role: 'user', content: msg });
      try {
        r = await this.sample.json(turns, { modelTier: 'quick', cache: false, signal, onText });
        this.mode = 'claude';
      } catch (e) {
        if (e?.code === 'cancelled') throw e;
        if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e?.code)) { this.sample = null; }
        this.mode = 'scripted';
        this.lastError = e?.code ?? String(e);
      }
    }
    if (!r || typeof r !== 'object' || typeof r.say !== 'string') r = scripted(this.sim, p, text);
    const checked = this.apply(p, r);
    hist.push({ role: 'user', content: msg }, { role: 'assistant', content: JSON.stringify({ say: checked.say, action: checked.action }) });
    this.turns.set(p.id, hist.slice(-16));
    return checked;
  }

  /** Validate and carry out what the person decided. */
  apply(p, r) {
    const s = this.sim, P = s.player;
    const out = { say: String(r.say).slice(0, 400), mood: String(r.mood ?? p.mood).slice(0, 20), action: { type: 'none' }, note: null };
    const dAtt = Math.max(-20, Math.min(20, Math.round(Number(r.attitude) || 0)));
    p.attitude = Math.max(-100, Math.min(100, p.attitude + dAtt));
    p.mood = out.mood;
    if (r.remember) p.memory.push(String(r.remember).slice(0, 120));
    if (p.memory.length > 12) p.memory.shift();
    const a = r.action ?? {};
    switch (a.type) {
      case 'sell': {
        const item = String(a.item ?? '');
        const list = p.sells ? SHOPS[p.sells] : [];
        if (!list.includes(item)) { out.note = `${p.name} has no ${GOODS[item]?.name.toLowerCase() ?? item} to sell.`; break; }
        const base = GOODS[item].price, price = Math.max(Math.ceil(base * 0.7), Math.min(base * 3, Math.round(Number(a.price) || base)));
        const res = s.buy(item, p, price);
        out.action = { type: 'sell', item, price, ok: res.ok };
        out.note = res.ok ? `You buy ${GOODS[item].name.toLowerCase()} for ${fmtMoney(price)}.` : res.why;
        break;
      }
      case 'enlist': {
        if (!p.recruiter) break;
        const res = s.enlist('pacholek');
        out.action = { type: 'enlist', ok: res.ok };
        out.note = res.ok ? null : res.why;
        break;
      }
      case 'hire_day': {
        if (!['farmer', 'headman'].includes(p.role)) break;
        const res = s.work('fields');
        out.action = { type: 'hire_day', ok: res.ok };
        out.note = res.ok ? null : res.why;
        break;
      }
      case 'learn_name': P.knownNames.add(p.id); out.action = { type: 'learn_name' }; break;
      case 'directions': { const pl = String(a.place ?? ''); if (PLACES[pl] || BUILDING[pl]) out.action = { type: 'directions', place: pl }; break; }
      case 'call_watch': P.wanted = Math.max(P.wanted, 1); P.crimes.push({ law: 'insult', t: s.t, seen: [p.id], victim: p.id, where: P.inside ?? 'street', settled: false }); out.action = { type: 'call_watch' }; break;
      case 'leave': out.action = { type: 'leave' }; break;
      default: break;
    }
    return out;
  }
}

// ---- the scripted fallback ---------------------------------------------------------------------

const has = (t, ...w) => w.some((x) => t.includes(x));

/** A plain rule-based answer in character, when Claude is not available. */
export function scripted(sim, p, text) {
  const t = text.toLowerCase();
  const P = sim.player;
  const pr = RANK[p.rank]?.rank ?? 20, myRank = { podruh: 10, sedlak: 24, journeyman: 36, patrician: 55, squire: 66 }[P.rank] ?? 20;
  const sir = myRank > pr + 15 ? (P.sex === 'f' ? 'paní' : 'pane') : myRank + 15 < pr ? 'fellow' : 'friend';
  const cold = p.attitude < -25, warm = p.attitude > 25;
  const R = (a) => a[Math.floor(Math.random() * a.length)];
  if (has(t, 'bye', 'farewell', 'god be with', 'go now')) return { say: R([`God be with you, ${sir}.`, 'Go with God.', 'Mind how you go.']), attitude: 1, mood: p.mood, action: { type: 'leave' } };
  if (has(t, 'my name is', "i'm ", 'i am ', 'call me')) return { say: `${p.name}. ${p.title[0].toUpperCase() + p.title.slice(1)}. ${warm ? 'Glad to know you.' : 'What do you want?'}`, attitude: 3, mood: p.mood, action: { type: 'learn_name' }, remember: 'told me their name' };
  if (has(t, 'thief', 'whore', 'bastard', 'fool', 'idiot', 'pig', 'dog')) return { say: p.traits.temper > 0.6 ? 'Say that again and I\'ll break your teeth!' : 'You\'ll answer for that to the rychtář.', attitude: -20, mood: 'angry', action: { type: p.traits.courage < 0.4 || p.watch ? 'call_watch' : 'none' }, remember: 'insulted me' };
  if (p.sells && has(t, 'buy', 'sell', 'beer', 'ale', 'bread', 'food', 'eat', 'drink', 'wine', 'meat', 'bath', 'bed', 'shoes', 'knife', 'hood', 'how much')) {
    const list = SHOPS[p.sells];
    const want = list.find((k) => t.includes(k) || t.includes(GOODS[k].name.toLowerCase().split(' ').pop())) ?? (has(t, 'drink', 'ale') && list.includes('beer') ? 'beer' : has(t, 'eat', 'food') ? list.find((k) => GOODS[k].kind === 'food') : null);
    if (!want) return { say: `I have ${list.map((k) => GOODS[k].name.toLowerCase() + ' for ' + fmtMoney(GOODS[k].price)).join(', ')}.`, attitude: 0, mood: p.mood, action: { type: 'none' } };
    const price = Math.round(GOODS[want].price * (cold ? 1.5 : 1));
    if (P.money < price) return { say: `${fmtMoney(price)}. Come back when you have it.`, attitude: -1, mood: p.mood, action: { type: 'none' } };
    return { say: R([`${fmtMoney(price)}. Here.`, `That's ${fmtMoney(price)}, ${sir}.`, `${GOODS[want].name}: ${fmtMoney(price)}.`]), attitude: 2, mood: p.mood, action: { type: 'sell', item: want, price } };
  }
  if (has(t, 'serve', 'enlist', 'join', 'soldier', 'army', 'garrison', 'fight for')) {
    if (!p.recruiter) return { say: p.watch ? 'Talk to the captain, Hereš. He takes on men in the castle yard after noon, or in the tavern of an evening.' : 'The captain up at the castle is hiring, they say. Ask him.', attitude: 0, mood: p.mood, action: { type: 'directions', place: 'yard' } };
    if (P.sex === 'f') return { say: 'This is no work for a woman. The company needs cooks and washerwomen, if you must follow it — not soldiers.', attitude: 0, mood: p.mood, action: { type: 'none' } };
    if (P.drunk > 25) return { say: 'Come back sober and I may look at you.', attitude: -3, mood: p.mood, action: { type: 'none' } };
    if (P.reputation < -15) return { say: 'I know your name, and it\'s not a good one. No.', attitude: -2, mood: p.mood, action: { type: 'none' } };
    return { say: `A groschen a day, bread and beer, a coat and a hat. You obey, you stand your watch, you drill. Swear it and you're mine.`, attitude: 5, mood: 'brisk', action: { type: 'enlist' }, remember: 'took this one into the company' };
  }
  if (has(t, 'work', 'job', 'labour', 'hire', 'wage')) {
    if (['farmer', 'headman'].includes(p.role)) return { say: `I can use a pair of hands for threshing. A groschen for the day, and you work till vespers.`, attitude: 2, mood: p.mood, action: { type: 'hire_day' } };
    return { say: 'I\'ve no work for you. The farmers hire day labourers at dawn, and the captain at the castle is taking on men.', attitude: 0, mood: p.mood, action: { type: 'none' } };
  }
  if (has(t, 'where', 'way to', 'find', 'tavern', 'castle', 'church', 'well', 'privy', 'bath', 'smith', 'baker', 'joust', 'lists')) {
    const place = ['tavern', 'church', 'well', 'privy', 'bath', 'smithy', 'bakery', 'joust', 'lists', 'gate', 'yard', 'rychta'].find((k) => t.includes(k === 'smithy' ? 'smith' : k === 'bakery' ? 'baker' : k === 'gate' || k === 'yard' ? 'castle' : k));
    return { say: place ? `${place === 'privy' ? 'Behind the tavern, on the square.' : place === 'gate' || place === 'yard' ? 'Up the hill road past the last houses; the gate faces the town.' : place === 'joust' || place === 'lists' ? 'Out past the lists, south of the town. The herald is there.' : 'On the square, you can\'t miss it.'}` : 'Everything is on the square or the street. Ask for what you want.', attitude: 1, mood: p.mood, action: { type: place ? 'directions' : 'none', place } };
  }
  if (has(t, 'news', 'rumour', 'rumor', 'what is happening', "what's happening", 'gossip', 'king')) return { say: R(RUMOURS), attitude: 2, mood: p.mood, action: { type: 'none' } };
  if (has(t, 'who are you', 'what do you do', 'your name')) return { say: `${p.fullName}, ${p.title}. ${p.agent.act[0].toUpperCase() + p.agent.act.slice(1)}, as you see.`, attitude: 1, mood: p.mood, action: { type: 'none' } };
  if (has(t, 'hello', 'good day', 'greetings', 'god give', 'hi')) return { say: cold ? 'What do you want?' : warm ? `God give you good day, ${sir}! What brings you?` : R([`God give you good day, ${sir}.`, 'Good day.', `${sir[0].toUpperCase() + sir.slice(1)}.`]), attitude: 2, mood: p.mood, action: { type: 'none' } };
  return { say: p.traits.extraversion > 0.6 ? R(['Eh? Say it plainly.', 'I don\'t follow you. Are you from these parts?', 'Hm. ' + R(RUMOURS)]) : R(['Hm.', 'I have work to do.', 'If you say so.']), attitude: 0, mood: p.mood, action: { type: 'none' } };
}
