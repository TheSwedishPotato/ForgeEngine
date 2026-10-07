/**
 * Deeds in your own words: "I kneel at the altar and pray for my father",
 * "I help the farmer's wife carry water", "I spit at the baker's door".
 *
 * Claude, as the narrator, judges what happens given who and where you are,
 * what you have, what you can do and who is watching, and answers with a
 * few lines of narration and the effects. Every effect is checked against
 * the world here: time passes as long as the deed takes, needs and skills
 * move a little, money and goods only within what you have, the people who
 * saw remember and think better or worse of you, a crime goes to the law,
 * and what matters goes into your chronicle. Without Claude, a plain
 * narration and the time it takes.
 */
import { GOODS, LAWS } from './data.js';
import { BUILDING, PLACES } from '../world/town.js';
import { worldText } from './history.js';
import { loreFull } from './lore.js';

const CRIMES = ['theft', 'brawl', 'insult', 'market', 'sunday', 'fasting', 'privy', 'gambling', 'housebreaking'];

export class Deeds {
  constructor(sim) { this.sim = sim; this.sample = null; }

  _where() {
    const s = this.sim, P = s.player;
    if (P.inside) return `inside ${BUILDING[P.inside]?.name ?? 'a house'}`;
    let best = null, bd = 1e9;
    for (const [id, pl] of Object.entries(PLACES)) { const d = Math.hypot(P.x - pl.x, P.z - pl.z); if (d < bd) { bd = d; best = pl.name ?? id; } }
    return bd < 25 ? `out of doors, by ${best}` : 'out of doors, in the town';
  }

  _near() {
    const s = this.sim, P = s.player;
    return s.people.filter((p) => p.alive && (P.inside ? p.agent.inside === P.inside : !p.agent.inside && Math.hypot(p.agent.x - P.x, p.agent.z - P.z) < 12));
  }

  _prompt(text, near) {
    const s = this.sim, P = s.player;
    const inv = Object.entries(P.inventory).filter(([, n]) => n > 0).map(([k, n]) => `${n}× ${k}`).join(', ') || 'nothing';
    const people = near.map((p) => `${p.id} | ${p.fullName} | ${p.title} | ${p.agent.act} | attitude ${p.attitude}${p.kin ? ` | ${p.kin}` : ''}`).join('\n') || '(nobody)';
    const threads = s.story?.open().map((x) => `#${x.id} ${x.title} (with ${s.byId[x.giver]?.fullName}): ${x.want}`).join('\n') || '(none)';
    return `You are the narrator of an open-world role play, true to a small Bohemian subject town (Skalice) in autumn 1403. ${worldText(s.t)}

Now: ${s.situation()}. Where: ${this._where()}.
THE PLAYER: ${P.name}, ${P.sex === 'f' ? 'a woman' : 'a man'} of about twenty, ${P.startName}.
${loreFull(P)}
Purse ${P.money} parvi; carrying ${inv}; skills ${Object.entries(P.skills).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')}; health ${Math.round(P.health)}; hunger ${Math.round(P.needs.hunger)}, thirst ${Math.round(P.needs.thirst)}, tiredness ${Math.round(P.needs.fatigue)}, dirt ${Math.round(P.needs.dirt)} (0 good, 100 bad).
PEOPLE WHO CAN SEE (id | name | station | doing | attitude to the player):
${people}
OPEN MATTERS: ${threads}

THE PLAYER DOES: "${text.slice(0, 400)}"

Narrate what happens, in the second person, plainly and concretely, 2 to 4 sentences, true to the time, the place, the player's station and skill (a deed beyond them fails or goes awry; one that offends custom, rank or the Church draws reactions). You decide only what the world does; do not put words or choices in the player's mouth beyond the deed. People present may react in a short line of speech. If the deed is impossible here (a thing they do not have, a person not present), say what happens instead.
Reply with ONLY JSON:
{"narration":"...","hours":<0 to 4, how long it takes>,"needs":{"hunger":<-30..30>,"thirst":<-30..30>,"fatigue":<-20..30>,"dirt":<-40..30>},"skill":{"name":"<${Object.keys(P.skills).join('|')} or empty>","gain":<0..3>},"money":<parvi gained (max 12, only if truly earned or found) or spent (negative)>,"item_used":"<goods id the player used up, or empty>","witnesses":[{"id":"<person id present>","remember":"<what they will remember, from their view>","attitude":<-15..15>}],"crime":"<one of ${CRIMES.join(', ')} if the deed broke the town's law in front of witnesses or against someone, else empty>","victim":"<person id or empty>","chronicle":"<one line for the player's chronicle if this matters to their story, else empty>","thread":{"id":<open matter id or 0>,"outcome":"progress|done|failed","note":"..."}}`;
  }

  async act(text, { signal } = {}) {
    const s = this.sim, P = s.player;
    const near = this._near();
    let r = null;
    if (this.sample) {
      try { r = await this.sample.json([{ role: 'user', content: this._prompt(text, near) }], { modelTier: 'default', cache: false, signal }); } catch (e) { if (e?.code === 'cancelled') throw e; r = null; }
    }
    if (!r || typeof r.narration !== 'string') r = { narration: `You ${text.replace(/^i\s+/i, '').replace(/[.!]+$/, '').replace(/\bmy\b/gi, 'your').replace(/\bme\b/gi, 'you').replace(/\bI\b/g, 'you').replace(/\bmyself\b/gi, 'yourself')}.`, hours: 0.25 };
    return this.apply(r, near);
  }

  /** Check every effect against the world, then make it so. */
  apply(r, near) {
    const s = this.sim, P = s.player, notes = [];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));
    const hours = Math.max(0, Math.min(4, Number(r.hours) || 0));
    if (hours >= 0.05) s.advance(hours);
    for (const [k, lim] of Object.entries({ hunger: 30, thirst: 30, fatigue: 30, dirt: 40 })) {
      if (r.needs?.[k] != null && P.needs[k] != null) P.needs[k] = Math.max(0, Math.min(100, P.needs[k] + clamp(r.needs[k], -lim, lim)));
    }
    if (r.skill?.name && P.skills[r.skill.name] != null) P.skills[r.skill.name] = Math.min(100, P.skills[r.skill.name] + clamp(r.skill.gain, 0, 3));
    const m = clamp(r.money, -P.money, 12);
    if (m) { P.money += m; notes.push(m > 0 ? `+${m} parvi` : `${m} parvi`); }
    if (r.item_used && GOODS[r.item_used] && P.inventory[r.item_used] > 0) { P.inventory[r.item_used]--; notes.push(`used: ${GOODS[r.item_used].name.toLowerCase()}`); }
    const ids = new Set(near.map((p) => p.id));
    for (const w of (Array.isArray(r.witnesses) ? r.witnesses : []).slice(0, 6)) {
      const p = s.byId[w?.id];
      if (!p || !ids.has(p.id)) continue;
      const att = clamp(w.attitude, -15, 15);
      p.attitude = Math.max(-100, Math.min(100, p.attitude + att));
      if (w.remember) s.remember(p, { kind: 'saw', text: String(w.remember).slice(0, 140), weight: 2 + Math.round(Math.abs(att) / 4), att });
    }
    if (r.crime && CRIMES.includes(r.crime) && LAWS.some((l) => l.id === r.crime)) {
      const victim = s.byId[r.victim] && ids.has(r.victim) ? s.byId[r.victim] : null;
      s.justice.offence(r.crime, { victim });
      notes.push(`against the law: ${LAWS.find((l) => l.id === r.crime).name.toLowerCase()}`);
    }
    if (r.chronicle) s.story?.note(String(r.chronicle).slice(0, 160), 4);
    if (r.thread?.id && s.story?.open().some((x) => x.id === Number(r.thread.id))) s.story.resolve(r.thread.id, ['done', 'failed', 'progress'].includes(r.thread.outcome) ? r.thread.outcome : 'progress', r.thread.note ?? '');
    return { narration: String(r.narration).slice(0, 900), notes, hours };
  }
}
