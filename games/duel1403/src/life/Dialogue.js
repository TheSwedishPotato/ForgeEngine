import { etiquette, addressOf, personWho, playerWho } from './address.js';
import { worldText } from './history.js';
import { loreKnownBy } from './lore.js';
import { GOODS, SHOPS, LAWS, RUMOURS, fmtMoney, ARMY_RANK, WAGES } from './data.js';
import { allRanks } from '../data/society.js';
import { BUILDING, PLACES, TOWN_NAME } from '../world/town.js';
import { memoryLines } from './Memory.js';

const RANK = Object.fromEntries(allRanks().map((r) => [r.id, r]));

/**
 * Talking to people. Every person answers as themselves, through Claude
 * (the artifact's `sample` capability, on the viewer's own Claude
 * account) when it is available, and through a small scripted fallback
 * when it is not. Either way the answer is the same shape:
 *   { say, attitude, mood, actions: [{type, ...}], remember }
 * and the game checks every action before it happens and then carries it
 * out: money and things change hands, people come along with you, go
 * where they said, teach, forgive, raise the hue and cry, or attack.
 * Nobody can give what they do not have or enlist you if they are not the
 * captain.
 */
export class Dialogue {
  constructor(sim) {
    this.sim = sim;
    this.sample = null;
    this.mode = 'scripted';
    this.turns = new Map();     // person id -> [{role, content}]
    // which Claude answers: 'default' (quick enough to talk to), or ?claude=complex for the deepest
    this.tier = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('claude')) || 'default';
    if (!['quick', 'default', 'complex'].includes(this.tier)) this.tier = 'default';
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
    const known = P.native
      ? `You have known them all their life: ${P.name}, born and raised here in ${TOWN_NAME}, ${P.startName.toLowerCase()}.${p.kin ? ` They are your own: ${p.kin}. Speak to them as family or household, with the ease, fondness, worries and old quarrels that go with it.` : ''}`
      : P.knownNames.has(p.id) ? `You know this person as ${P.name}, ${P.startName.toLowerCase()}, a newcomer to the town.` : 'A stranger, new to the town: you have never seen them before today unless your memories below say otherwise, and you do not know their name unless they tell you.';
    const crimes = P.crimes.filter((c) => c.seen.includes(p.id)).map((c) => LAWS.find((l) => l.id === c.law)?.name).filter(Boolean);
    return `${bits.join(', ')}. ${known}${crimes.length ? ` You saw them commit: ${crimes.join(', ')}.` : ''}${P.army ? ` They serve in the castle garrison as ${ARMY_RANK[P.army.rank].name.toLowerCase()}.` : ''} Town reputation: ${P.reputation > 15 ? 'well thought of' : P.reputation < -15 ? 'a known troublemaker' : P.reputation < -5 ? 'talked about' : P.native ? 'one of the town\'s own, nothing much said either way' : 'a newcomer nobody knows much about'}. ${loreKnownBy(this.sim, p)}`;
  }

  _persona(p) {
    const s = this.sim, a = p.agent;
    const r = RANK[p.rank];
    const where = a.inside ? BUILDING[a.inside]?.name : PLACES[a.place]?.name ?? 'in the street';
    const spouse = p.spouse ? s.byId[p.spouse] : null;
    const sells = p.sells ? SHOPS[p.sells].map((k) => `${GOODS[k].name} at ${fmtMoney(GOODS[k].price)}`).join('; ') : null;
    const own = Object.entries(p.inventory ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${n}× ${k}`).join(', ');
    const T = p.traits;
    const mem = memoryLines(s, p, 10);
    const lines = [
      `You are ${p.fullName}, ${p.sex === 'f' ? 'a woman' : 'a man'} of ${p.age}, ${p.title} in ${TOWN_NAME}, a small subject town (poddanské městečko) of the lord of Skalice castle, in the Kingdom of Bohemia.`,
      `Estate: ${r?.estateName ?? p.estate}; rank: ${r?.name ?? p.rank} (precedence ${r?.rank ?? '?'} of 100: lower numbers defer to higher ones).`,
      `Character: ${p.words.join(', ')}. (Openness ${T.openness}, conscientiousness ${T.conscientiousness}, extraversion ${T.extraversion}, agreeableness ${T.agreeableness}, neuroticism ${T.neuroticism}, piety ${T.piety}, honesty ${T.honesty}, temper ${T.temper}, greed ${T.greed}, courage ${T.courage}; 0–1.)`,
      spouse ? `Married to ${spouse.fullName}, ${spouse.title}.` : '',
      `Right now: ${a.act}, at ${where}. Mood: ${p.mood}.${p.hurt > 0.3 ? ' You are hurt and sore.' : ''}`,
      CARES[p.role] ? `What weighs on you these days: ${CARES[p.role]}. Let it colour what you want from people and what you ask of them.` : '',
      `Your purse: exactly ${p.money} parvi (${fmtMoney(p.money)}). Things you have: ${own || 'nothing to speak of'}.`,
      sells ? `You sell: ${sells}. You may haggle a little according to your greed, never below cost.` : '',
      p.recruiter ? `You are the captain (hejtman) of the castle garrison and are taking on men for the lord in these troubled times: foot servants (pacholci) at ${fmtMoney(ARMY_RANK.pacholek.pay)} a day with bread, beer and a padded coat and kettle hat; you want sound, sober men who will obey, not women, not drunkards, not known thieves.` : '',
      p.watch ? 'You are a soldier of the garrison and keep the watch: you arrest lawbreakers and stop people in the street after the curfew bell.' : '',
      p.role === 'headman' ? 'You are the lord\'s headman (rychtář): you keep the peace, collect fines, and sit in judgement with two aldermen. You know the town\'s law well.' : '',
      p.jousts ? 'You are the herald of the St Wenceslas joust in the field south of the town, and you know the rules: coronel lances, four courses, a broken lance scores.' : '',
      p.role === 'farmer' || p.role === 'headman' ? `You sometimes take on day labourers for threshing and carting at about ${fmtMoney(WAGES.labourer.pay)} a day.` : '',
      TEACH[p.role] ? `You could teach someone a little ${TEACH[p.role]} if it suited you (usually for money or as a favour to a friend).` : '',
      p.follow ? `You are with the stranger now, walking with them${p.follow.wage ? ` in their hire at ${fmtMoney(p.follow.wage)} a day` : ' as company'}.` : '',
      `Your attitude to the person talking to you: ${p.attitude} (−100 hatred … +100 love).`,
      ...(s.story?.personaLines(p) ?? []),
      mem.length ? `What you remember about them (true memories; use them, and say where you heard things):\n  - ${mem.join('\n  - ')}` : 'You have never met them and have heard nothing about them.',
    ];
    return lines.filter(Boolean).join('\n');
  }

  _world() {
    const s = this.sim;
    const news = s.justice.news.filter((n) => s.t - n.t < 72).slice(-5).map((n) => n.text);
    return [
      `Date and time: ${s.situation()}.`,
      `The world as you know it: ${worldText(s.t)}`,
      `The law here (the town's ordinances): ${LAWS.slice(0, 9).map((l) => `${l.name}: ${l.text}`).join(' ')} A thief caught in the act is brought before the headman and two aldermen; two sworn witnesses prove a deed; otherwise the accused may clear himself on oath with oath-helpers. A killing may be settled with the kin by reconciliation (smír).`,
      `Gossip you might pass on if asked: ${RUMOURS.join(' ')}`,
      news.length ? `What has happened in the town lately (you may have heard): ${news.join(' ')}` : '',
    ].filter(Boolean).join('\n');
  }

  _instructions(p) {
    const P = this.sim.player;
    const inv = Object.entries(P.inventory).filter(([, n]) => n > 0).map(([k, n]) => `${n}× ${k}`).join(', ');
    return `You are playing one person in a historically and socially accurate simulation of Bohemian town life in 1403. Stay in character as that person at all times.

${this._world()}

WHO YOU ARE
${this._persona(p)}

WHO IS TALKING TO YOU
${this._player(p)}

RANK AND MANNERS (keep to these exactly)
${etiquette(p, P)}
(What the game knows, not what you can see: their purse holds exactly ${P.money} parvi; they carry ${inv || 'nothing'}.)

BE A REAL PERSON
- You are a whole human being with an inner life, not a quest-giver. You have warmth and moods, humour and pride, fears, hopes, little vanities and kindnesses; you are tired, or cheerful, or worried about your own things. Let it show: a joke, a sigh, an aside about your aching back or your daughter, curiosity about the stranger, a flash of temper, real tenderness toward those you love. Be specific and concrete (the smell of the forge, the price of rye, last night's rain), never generic. Surprise sometimes.
- Show what you do as well as what you say: put small deeds and gestures in the speech between asterisks, briefly (*wipes his hands on his apron*, *laughs*, *lowers her voice*).
- Feelings carry on: if they were kind to you, warm to them; if they hurt or shamed you, it stays with you; love, grief, fear and anger show in how you speak.

HOW TO ANSWER
- Speak as this person would in 1403: plain words, their own concerns, the manners of their rank toward the speaker's apparent rank (deference upward, condescension or familiarity downward), their mood and temper. English, with an occasional Czech word they would naturally use (groš, rychta, krčma, hejtman, and the form of address given above). One to four sentences, never more than 80 words.
- Think as this person: what do they want from this stranger, what do they fear, what would they gain or risk? Answer the point of what was said, remember what was said before in this talk, and do not repeat yourself.
- Keep to your station: a superior may be curt, give orders, or ignore; an inferior defers, but may grumble behind politeness. Use the form of address given above every time you address them.
- Words between asterisks (*kneels*, *hands you a coin*) are what the stranger does, not says: react to the deed.
- You know only what this person could know. If asked about things outside it, say you don't know, or answer from rumour.
- You are a real person, not a guide: you may refuse, haggle, lie (if dishonest), take offence, call the watch, attack, or end the talk.
- WORDS ARE DEEDS. If the stranger hands you something, offers payment, asks you to come along, to take them with you, to teach them, to give or lend them something, and you agree, you MUST put the matching action in "actions" — that is what makes it happen in the world. If you refuse, put no action. Never claim to give what you do not have.
- Reply with ONLY a JSON object, no other text:
{"say": "your words", "attitude": <integer change to your attitude, -20 to 20>, "mood": "<one word>", "actions": [<zero or more actions>], "remember": "<what is worth remembering about this exchange, from your point of view, or empty>", "suggest": ["<3 or 4 things the stranger might naturally say or do next, in their voice, each under 12 words; mix speech with a deed in asterisks; varied: warm, curious, practical, bold>"]}
Actions (amounts in parvi; 12 parvi = 1 groschen):
  {"type":"accept","money":<n>,"item":"<id or empty>"}  you take money or a thing the stranger hands or pays you (a gift, a payment, a fee, a bribe, a debt repaid)
  {"type":"give","money":<n>,"item":"<id or empty>"}  you hand the stranger money or a thing you have (a loan, charity, change, a gift)
  {"type":"sell","item":"<goods id>","price":<n>}  you sell one of your goods and they pay (the game moves the money)
  {"type":"buy","item":"<goods id>","price":<n>}  you buy a thing the stranger has, and pay for it
  {"type":"follow","wage":<n per day, 0 if out of friendship>}  you come along with the stranger now (as a hired man or for company)
  {"type":"stop_follow"}  you stop going with them
  {"type":"lead","place":"<place id>"}  you go to a place now and the stranger may come with you (they asked to join you, or you show them the way)
  {"type":"go_to","place":"<place id>","hours":<n>}  you agree to meet them at a place and go there to wait
  {"type":"teach","skill":"<${Object.keys(P.skills).join('|')}>"}  you spend an hour teaching them
  {"type":"hire_day"}  you hire them for a day's labour now (farmers and the headman only)
  {"type":"enlist"}  you take them into the garrison (the captain only)
  {"type":"drop_charges"}  you forgive a wrong they did you and will not accuse them before the court
  {"type":"call_watch"}  you raise the hue and cry against them (they threatened you, struck you, stole, or broke the law before you)
  {"type":"attack"}  you strike them or draw on them (only if your temper and the insult or threat truly call for it)
  {"type":"directions","place":"<place id>"}  you point the way
  {"type":"learn_name"}  they told you their name
  {"type":"thread","id":<n>,"outcome":"done|failed|progress","note":"<what happened>"}  a matter between you and the stranger (listed above, if any) is settled or moves on in this talk
  {"type":"leave"}  you end the conversation and go
Goods ids: ${Object.keys(GOODS).join(', ')}. Place ids: ${[...Object.keys(PLACES), ...Object.keys(BUILDING).filter((k) => !/^h\d/.test(k))].join(', ')}.`;
  }

  /**
   * Something a person says unprompted: as you walk into their house or the
   * tavern, or pass them in the street. One short line (or nothing), in
   * character, from what they know and feel about you. Resolves with the
   * words, or '' for silence.
   */
  async remark(p, situation, { signal } = {}) {
    await this.ready;
    const P = this.sim.player;
    if (this.sample) {
      const prompt = `You are playing one person in a historically true, living simulation of a Bohemian town in 1403. Stay in character.

${this._world()}

WHO YOU ARE
${this._persona(p)}

THE PERSON IN FRONT OF YOU
${this._player(p)}

RANK AND MANNERS
${etiquette(p, P)}

RIGHT NOW: ${situation}

Say one short thing aloud, as a real person would at this moment: to them, about them to someone beside you, or to yourself. Let your character, mood and feelings about them show: warmth, teasing, worry, suspicion, a joke, gossip, a complaint about your day. Specific and natural, under 20 words; a small gesture in asterisks if it fits. If you would not speak at all, give an empty string.
Reply with ONLY JSON: {"say": "<words or empty>"}`;
      try {
        const r = await this.sample.json(prompt, { modelTier: 'default', cache: false, signal });
        return typeof r?.say === 'string' ? r.say.trim().slice(0, 200) : '';
      } catch (e) { if (e?.code === 'cancelled') throw e; }
    }
    // without Claude: only those who know and like you greet you
    if (p.attitude < 15 && !p.kin) return '';
    const sir = addressOf(personWho(p), playerWho(P)).cz;
    return p.kin ? `There you are, ${P.name}.` : p.attitude > 40 ? `God give you good day, ${sir}!` : `Good day, ${sir}.`;
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
        r = await this.sample.json(turns, { modelTier: this.tier ?? 'default', cache: false, signal, onText });
        this.mode = 'claude';
      } catch (e) {
        if (e?.code === 'cancelled') throw e;
        if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e?.code)) { this.sample = null; }
        this.mode = 'scripted';
        this.lastError = e?.code ?? String(e);
      }
    }
    if (!r || typeof r !== 'object' || typeof r.say !== 'string') r = scripted(this.sim, p, text);
    const checked = this.apply(p, r, text);
    this.sim.story?.afterTalk(p, checked.actions, text);
    hist.push({ role: 'user', content: msg }, { role: 'assistant', content: JSON.stringify({ say: checked.say, actions: checked.actions.map(({ type, money, item, place }) => ({ type, money, item, place })) }) });
    this.turns.set(p.id, hist.slice(-16));
    return checked;
  }

  /** Validate and carry out what the person decided. Every action is checked against the world. */
  apply(p, r, heard = '') {
    const s = this.sim, P = s.player;
    const suggest = (Array.isArray(r.suggest) ? r.suggest : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 90)).slice(0, 4);
    const out = { suggest, say: String(r.say).slice(0, 500), mood: String(r.mood ?? p.mood).slice(0, 20), action: { type: 'none' }, actions: [], notes: [], note: null };
    const dAtt = Math.max(-20, Math.min(20, Math.round(Number(r.attitude) || 0)));
    p.attitude = Math.max(-100, Math.min(100, p.attitude + dAtt));
    p.mood = out.mood;
    if (r.remember) s.remember(p, { kind: 'said', text: String(r.remember).slice(0, 140), weight: 3 + Math.round(Math.abs(dAtt) / 6), att: dAtt });
    // what the player said is remembered too, briefly, when it matters
    if (heard && heard.length > 12 && Math.abs(dAtt) >= 6) s.remember(p, { kind: 'said', text: `said: "${heard.slice(0, 90)}"`, weight: 2 + Math.round(Math.abs(dAtt) / 5), att: dAtt });
    let list = Array.isArray(r.actions) ? r.actions : r.action ? [r.action] : [];
    list = list.filter((a) => a && typeof a === 'object' && a.type && a.type !== 'none').slice(0, 4);
    const note = (t) => { if (t) out.notes.push(t); };
    const num = (v) => Math.max(0, Math.round(Number(v) || 0));
    const goods = (v) => (GOODS[String(v ?? '')] ? String(v) : null);
    for (const a of list) {
      const done = { type: a.type };
      switch (a.type) {
        case 'accept': {
          const res = s.giveTo(p, { money: num(a.money), item: goods(a.item) });
          done.ok = res.ok; done.money = num(a.money); done.item = goods(a.item);
          note(res.ok ? `You hand over ${res.what}.` : res.why);
          break;
        }
        case 'give': {
          const res = s.takeFrom(p, { money: Math.min(num(a.money), 1200), item: goods(a.item) });
          done.ok = res.ok; done.money = num(a.money); done.item = goods(a.item);
          note(res.ok ? `${p.name} gives you ${res.what}.` : res.why);
          break;
        }
        case 'sell': {
          const item = goods(a.item);
          const list2 = p.sells ? SHOPS[p.sells] : [];
          if (!item || !list2.includes(item)) { note(`${p.name} has no ${GOODS[item]?.name.toLowerCase() ?? a.item} to sell.`); break; }
          const base = GOODS[item].price, price = Math.max(Math.ceil(base * 0.7), Math.min(base * 3, num(a.price) || base));
          const res = s.buy(item, p, price);
          Object.assign(done, { item, price, ok: res.ok });
          note(res.ok ? `You buy ${GOODS[item].name.toLowerCase()} for ${fmtMoney(price)}.` : res.why);
          break;
        }
        case 'buy': {
          const item = goods(a.item);
          if (!item || !(P.inventory[item] > 0)) { note(`You have no ${GOODS[item]?.name.toLowerCase() ?? a.item} to sell.`); break; }
          const price = Math.min(num(a.price) || GOODS[item].price, p.money, GOODS[item].price * 2);
          P.inventory[item]--; p.inventory[item] = (p.inventory[item] ?? 0) + 1; p.money -= price; P.money += price;
          s.remember(p, { kind: 'got', text: `sold me ${GOODS[item].name.toLowerCase()} for ${fmtMoney(price)}`, weight: 2 });
          Object.assign(done, { item, price, ok: true });
          note(`You sell ${GOODS[item].name.toLowerCase()} to ${p.name} for ${fmtMoney(price)}.`);
          break;
        }
        case 'follow': {
          const res = s.join(p, Math.min(num(a.wage), 120));
          done.ok = res.ok; done.wage = num(a.wage);
          note(res.ok ? `${p.name} comes with you${num(a.wage) ? ` for ${fmtMoney(num(a.wage))} a day (paid now, then each morning)` : ''}.` : res.why);
          break;
        }
        case 'stop_follow': s.dismiss(p); done.ok = true; note(`${p.name} goes ${p.sex === 'f' ? 'her' : 'his'} own way.`); break;
        case 'lead': case 'go_to': {
          const pl = String(a.place ?? '');
          if (!(PLACES[pl] || BUILDING[pl])) break;
          s.sendTo(p, pl, Math.min(6, Number(a.hours) || 1.5));
          if (a.type === 'lead') p.override.act = 'going there with you';
          Object.assign(done, { place: pl, ok: true });
          note(a.type === 'lead' ? `${p.name} sets off for ${(PLACES[pl] ?? BUILDING[pl]).name}. Go along.` : `${p.name} will wait for you at ${(PLACES[pl] ?? BUILDING[pl]).name}.`);
          break;
        }
        case 'teach': {
          const skill = String(a.skill ?? '');
          if (!(skill in P.skills) || (TEACH[p.role] && !TEACH_SKILL[p.role]?.includes(skill)) || !TEACH[p.role]) { note(`${p.name} cannot teach that.`); break; }
          if ((p.taught ?? -99) > s.t - 6) { note(`${p.name} has taught you enough for one day.`); break; }
          p.taught = s.t;
          s.advance(1);
          P.skills[skill] = Math.min(100, P.skills[skill] + 3 + 2 * p.traits.conscientiousness);
          s.remember(p, { kind: 'gave', text: `I taught them some ${skill}`, weight: 3, att: 2 });
          Object.assign(done, { skill, ok: true });
          note(`An hour with ${p.name}: your ${skill} improves.`);
          break;
        }
        case 'enlist': {
          if (!p.recruiter) break;
          const res = s.enlist('pacholek');
          done.ok = res.ok; note(res.ok ? null : res.why);
          break;
        }
        case 'hire_day': {
          if (!['farmer', 'headman'].includes(p.role)) break;
          const res = s.work('fields');
          done.ok = res.ok; note(res.ok ? null : res.why);
          break;
        }
        case 'drop_charges': {
          let n = 0;
          for (const c of P.crimes) if (!c.settled && (c.victim === p.id || (p.watch && c.severity < 4 && c.seen.includes(p.id)))) {
            c.seen = c.seen.filter((id) => id !== p.id);
            if (c.victim === p.id) { c.seen = []; c.settled = true; }
            n++;
          }
          if (!P.crimes.some((c) => !c.settled && c.seen.length)) P.wanted = 0;
          if (n) { s.remember(p, { kind: 'met', text: 'forgave them the wrong they did me', weight: 5, att: 5 }); note(`${p.name} lets the matter rest and will not accuse you.`); }
          done.ok = n > 0;
          break;
        }
        case 'learn_name': P.knownNames.add(p.id); done.ok = true; break;
        case 'directions': { const pl = String(a.place ?? ''); if (PLACES[pl] || BUILDING[pl]) Object.assign(done, { place: pl, ok: true }); break; }
        case 'call_watch': {
          const open = P.crimes.find((c) => !c.settled && c.seen.includes(p.id));
          if (!open) s.crime('insult', { victim: p, seen: [p] });
          P.wanted = Math.max(P.wanted, 1);
          s.dismiss(p);
          if (open && open.severity >= 2 && !s.justice.hue) s.justice.raiseHue(p, open);
          done.ok = true;
          break;
        }
        case 'attack': s.dismiss(p); done.ok = true; s.remember(p, { kind: 'met', text: 'I went for them', weight: 6, att: -10 }); break;
        case 'leave': done.ok = true; break;
        case 'thread': {
          const x = s.story?.involving(p).find((t) => t.id === Number(a.id));
          if (!x) break;
          const outcome = ['done', 'failed', 'progress'].includes(a.outcome) ? a.outcome : 'progress';
          s.story.resolve(x.id, outcome, String(a.note ?? '').slice(0, 160));
          done.ok = true; done.id = x.id; done.outcome = outcome;
          note(outcome === 'done' ? `Settled: ${x.title}.` : outcome === 'failed' ? `It has gone badly: ${x.title}.` : `${x.title}: it moves on.`);
          break;
        }
        default: continue;
      }
      out.actions.push(done);
    }
    out.action = out.actions[0] ?? { type: 'none' };
    out.note = out.notes.join(' ') || null;
    return out;
  }
}

/**
 * What weighs on each kind of person this autumn of 1403: the cares that
 * drive what they want from a stranger. From the situation of the year
 * (the king a prisoner, the spring's Hungarian invasion and the masterless
 * soldiers it left, debased coin) and the round of a subject town's year
 * (rent on St Gall's day, 16 October; the harvest in; guild rules).
 */
export const CARES = {
  burgrave: 'holding the castle and its lands for an absent lord while bands roam; getting the St Gall rents in (16 October); keeping the townsmen obedient and the garrison paid',
  captain: 'too few men and too little pay for them; masterless soldiers and robber bands left on the roads by the spring\'s invasion, and whether Sigismund\'s men will come back; drunkenness and desertion among his pacholci',
  soldier: 'pay in arrears; the cold watch; dice and beer; whether Sigismund\'s Hungarians will come back next year',
  herald: 'a good field for the St Wenceslas joust, proper arms and lineage of every rider, and being paid by the lord for it',
  priest: 'the tithe and the parish dues, sinners who skip confession, talk from Prague of Master Hus preaching against the clergy\'s wealth',
  sexton: 'the bells at the right hours, the graves, his aching back',
  beggar: 'bread for today, a place out of the wind, alms at the church door',
  headman: 'collecting the lord\'s rent and fines, keeping the peace on market day, quarrels over boundaries and debts, the lord\'s displeasure if the money falls short',
  innkeeper: 'the price of malt, the lord\'s excise on beer, guests who drink and do not pay, brawls',
  innwife: 'the kitchen and the beds, the maid, drunk guests who paw at her',
  maid: 'her wages and keep, saving for a dowry, rough guests, a lad she likes',
  smith: 'iron and charcoal dear, horses to shoe and tools to mend after harvest, the garrison\'s orders, his apprentice\'s laziness',
  apprentice: 'his master\'s temper and the long hours; years still to serve before he is a journeyman',
  baker: 'the price of grain, the bread assize that fixes weight and price, his seat on the council, rivals who sell short weight',
  bakerwife: 'the household and the shop, the girls\' marriages, what the neighbours say',
  butcher: 'beasts for slaughter before winter, the meat benches, his seat on the council',
  cobbler: 'leather prices, customers who pay late, the guild\'s rules',
  weaver: 'yarn, the merchant who buys his cloth too cheap, debts',
  weaverwife: 'spinning enough yarn, a child that is sickly, the price of bread',
  bathkeeper: 'firewood for the bath, being looked down on as a dishonourable trade, cupping and shaving customers, gossip he hears',
  merchant: 'getting his cloth safely back to Prague past robbers and masterless soldiers, debased groschen, collecting what is owed',
  farmer: 'the harvest in, the half-year rent due on St Gall\'s day (16 October) and the tithe, the plough team, the weather for winter sowing, soldiers taking his beasts',
  farmwife: 'the house, the children, geese and hens, spinning, whether there is enough grain to last till spring',
  cottager: 'finding day work, feeding his family on almost nothing, debts to the farmer he works for',
};

/** Who can teach what. */
const TEACH = { smith: 'smithing', apprentice: 'smithing', captain: 'swordsmanship and the crossbow', soldier: 'the crossbow and the spear', priest: 'reading and writing', merchant: 'trade and reckoning', herald: 'riding and heraldry', farmer: 'farm work', burgrave: 'riding and the sword', bathkeeper: 'barbering' };
const TEACH_SKILL = { smith: ['smithing'], apprentice: ['smithing'], captain: ['sword', 'crossbow', 'riding'], soldier: ['crossbow', 'sword'], priest: ['letters'], merchant: ['trade', 'letters'], herald: ['riding', 'letters'], farmer: ['labour'], burgrave: ['riding', 'sword'], bathkeeper: ['labour'] };

// ---- the scripted fallback ---------------------------------------------------------------------

const has = (t, ...w) => w.some((x) => t.includes(x));

/** A plain rule-based answer in character, when Claude is not available. */
export function scripted(sim, p, text) {
  const t = text.toLowerCase();
  const P = sim.player;
  const sir = addressOf(personWho(p), playerWho(P)).cz;
  const cold = p.attitude < -25, warm = p.attitude > 25;
  const R = (a) => a[Math.floor(Math.random() * a.length)];
  if (has(t, 'bye', 'farewell', 'god be with', 'go now')) return { say: R([`God be with you, ${sir}.`, 'Go with God.', 'Mind how you go.']), attitude: 1, mood: p.mood, action: { type: 'leave' } };
  // giving: "here, take two groschen", "I give you a loaf"
  const amt = parseMoney(t);
  const item = Object.keys(GOODS).find((k) => t.includes(k) || t.includes(GOODS[k].name.toLowerCase().split(' ').pop()));
  if (has(t, 'here', 'take this', 'take these', 'for you', 'i give', 'i hand', 'have this', 'gift', 'i pay', 'i\'ll pay you now') && (amt || (item && P.inventory[item] > 0)) && !has(t, 'a day', 'per day', 'daily')) {
    const ok = amt ? amt <= P.money : P.inventory[item] > 0;
    if (!ok) return { say: 'You haven\'t got it to give.', attitude: -1, mood: p.mood, actions: [] };
    const proud = p.estate === 'knights' && amt && amt < 120;
    if (proud) return { say: 'Keep your pennies. Do I look like a beggar?', attitude: -4, mood: 'offended', actions: [] };
    const open = P.crimes.find((c) => !c.settled && c.victim === p.id);
    const settles = open && amt >= (open.value || 12) * 2 && p.traits.temper < 0.8;
    return { say: open ? (settles ? 'Well. That makes it good, I suppose. We\'ll say no more about it.' : 'That doesn\'t mend what you did.') : R([`God reward you, ${sir}.`, 'My thanks.', p.traits.greed > 0.6 ? 'Is that all?' : 'That\'s kind of you.']), attitude: settles ? 10 : 4, mood: p.mood, actions: [{ type: 'accept', money: amt, item: amt ? null : item }, ...(settles ? [{ type: 'drop_charges' }] : [])], remember: amt ? `the stranger gave me ${fmtMoney(amt)}` : `the stranger gave me ${item}` };
  }
  if (has(t, 'stop following', 'go home', 'leave me', 'you can go', 'dismiss')) return { say: p.follow ? 'As you like.' : 'I wasn\'t following you.', attitude: 0, mood: p.mood, actions: [{ type: 'stop_follow' }] };
  if (has(t, 'follow me', 'come with me', 'come along', 'join me', 'walk with me', 'serve me', 'work for me', 'be my man', 'guard me')) {
    const wage = has(t, 'a day', 'per day', 'daily', 'pay you', 'wage') ? (amt || 12) : 0;
    if (p.watch || p.role === 'burgrave' || p.role === 'captain') return { say: 'I have my duty. I go nowhere with you.', attitude: -1, mood: p.mood, actions: [] };
    if (wage && wage >= 10 && (p.money < 400 || p.traits.greed > 0.6)) return { say: `For ${fmtMoney(wage)} a day? Done. Lead on.`, attitude: 4, mood: 'willing', actions: [{ type: 'follow', wage }], remember: `took service with the stranger at ${fmtMoney(wage)} a day` };
    if (!wage && (p.attitude > 25 || (p.traits.extraversion > 0.7 && p.attitude > 5)) && !/sleep|working|baking|serving|selling/.test(p.agent.act)) return { say: 'Why not? I\'ll come for a while.', attitude: 2, mood: p.mood, actions: [{ type: 'follow', wage: 0 }] };
    return { say: wage ? 'Not for that money.' : 'I have my own work to do.', attitude: 0, mood: p.mood, actions: [] };
  }
  if (has(t, 'can i come', 'may i come', 'can i join', 'may i join', 'take me with', 'where are you going')) {
    const next = p.agent.place && (PLACES[p.agent.place] || BUILDING[p.agent.place]) ? p.agent.place : 'tavern';
    if (p.attitude < -10) return { say: 'No. Go your own way.', attitude: -1, mood: p.mood, actions: [] };
    return { say: `I'm for ${(PLACES[next] ?? BUILDING[next]).name}. Come along if you like.`, attitude: 2, mood: p.mood, actions: [{ type: 'lead', place: next }] };
  }
  if (has(t, 'teach me', 'show me how', 'learn from you')) {
    if (!TEACH[p.role]) return { say: 'What would I teach you? I know nothing worth the knowing.', attitude: 0, mood: p.mood, actions: [] };
    const skill = TEACH_SKILL[p.role][0];
    if (p.attitude < 15 && !amt) return { say: `My ${TEACH[p.role]} isn't given away. A groschen for an hour.`, attitude: 0, mood: p.mood, actions: [] };
    return { say: 'Come then, watch closely.', attitude: 2, mood: p.mood, actions: [...(amt ? [{ type: 'accept', money: amt }] : []), { type: 'teach', skill }] };
  }
  if (has(t, 'lend me', 'give me money', 'spare a', 'alms', 'charity')) {
    if (p.attitude > 40 && p.money > 60) return { say: 'Here. See you pay it back.', attitude: -2, mood: p.mood, actions: [{ type: 'give', money: 12 }], remember: 'lent the stranger a groschen' };
    if (p.traits.piety > 0.7 && p.money > 12) return { say: 'For the love of God, then.', attitude: 0, mood: p.mood, actions: [{ type: 'give', money: 1 }] };
    return { say: 'I\'ve nothing to spare.', attitude: -2, mood: p.mood, actions: [] };
  }
  if (has(t, 'sorry', 'forgive', 'make amends', 'make it right')) {
    const open = P.crimes.find((c) => !c.settled && c.victim === p.id);
    if (!open) return { say: 'For what?', attitude: 0, mood: p.mood, actions: [] };
    return { say: p.traits.agreeableness > 0.6 ? 'Words are cheap. Make it good with money and I\'ll let it rest.' : 'Sorry won\'t do. You\'ll answer to the rychtář.', attitude: 1, mood: p.mood, actions: [] };
  }
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

const NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, half: 0.5 };
/** "two groschen", "5 gr", "a groschen", "6 parvi", "half a kopa" -> parvi. */
export function parseMoney(t) {
  const m = /(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|half)\s*(?:a\s+)?(kopa|groschen|grosch|groš|gr\b|parvi|pennies|penny|pence|p\b|coins?)/.exec(t);
  if (!m) return 0;
  const n = Number(m[1]) || NUMS[m[1]] || 1;
  const unit = /kopa/.test(m[2]) ? 720 : /gro|gr/.test(m[2]) || /coin/.test(m[2]) ? 12 : 1;
  return Math.round(n * unit);
}
