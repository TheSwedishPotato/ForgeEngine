/**
 * Your own past: where you come from, your kin, what marks you, your faith,
 * and your story in your own words. Chosen at the start; it changes what you
 * can do, who likes you, what people know of you, and the matters the
 * storyteller opens.
 *
 * True to the year: the Hungarian invasion of early 1403 (Sigismund's army,
 * many of them Cumans, took Kutná Hora in the winter of 1402–03, plundered
 * and taxed, and withdrew after the truce ran out in May); the war of the
 * Moravian margraves Jobst and Prokop; the university of Prague condemning
 * forty-five articles of Wyclif on 28 May 1403 while Master Hus preached in
 * Czech at the Bethlehem Chapel; pilgrimages to Stará Boleslav (where St
 * Wenceslas was murdered) and to Aachen; reconciliation for a killing
 * (smír) with the dead man's kin, sometimes marked by a stone cross; rents
 * paid on St George's day and St Gall's day.
 */

export const LORE_SOURCES = {
  invasion: { short: 'The second captivity of Wenceslas IV', url: 'https://www.e-stredovek.cz/en/post/second-captivity-wenceslaus-iv', text: 'Wenceslas captured by Sigismund on 29 June 1402, held in Vienna from August; Sigismund\'s invasion of Bohemia in early 1403; his retreat after the truce of 14 April–20 May; the pope\'s recognition of the deposition on 1 October 1403; the king\'s escape on 11 November 1403.' },
  kutna: { short: 'Conquest of Kutná Hora (1402–03)', url: 'https://en.wikipedia.org/wiki/Conquest_of_Kutn%C3%A1_Hora', text: 'Sigismund\'s forces took Kutná Hora and the country round it between December 1402 and January 1403; his army was in no small part Cuman, and plundered.' },
  rent: { short: 'Rents at St George and St Gall', url: 'https://edicee.ucl.cas.cz/data/sborniky/strojopisne/RH1/61.pdf', text: 'In the Czech lands it was the custom from old times to pay half-yearly rents (úroky) on St George\'s day (24 April) and St Gall\'s day (16 October).' },
  emphyteusis: { short: 'Purkrecht (emphyteusis)', url: 'https://ruj.uj.edu.pl/server/api/core/bitstreams/2e3b7ec6-d589-4a9d-ac0e-3026cb7372e6/content', text: 'Hereditary peasant tenure under purkrecht (zákupní právo): the holding passes in the family against a fixed rent to the lord.' },
};

/** Where a newcomer comes from (natives are of Skalice). */
export const ORIGINS = {
  skalice: { name: 'Skalice, this town', native: true, text: 'Born here. Everyone knows your family, and your family knows everything.' },
  kutna: { name: 'Kutná Hora', text: 'The silver town, where the king\'s mint strikes the groschen. Sigismund\'s men took it last winter; your family lost what they had, and you came away with nothing but your hands.', skills: { trade: 5 }, cares: 'what you saw when Sigismund\'s men took Kutná Hora last winter' },
  village: { name: 'a burned village on the Sázava', text: 'Your village was burned in the spring raid, when Sigismund\'s Cumans rode through. You do not talk of what happened to your people.', skills: { labour: 8 }, cares: 'the burning of your village in the spring; hatred of Hungarians and Cumans', money: -10 },
  prague: { name: 'Prague, the Old Town', text: 'You grew up in the Old Town among the stalls and churches; you have heard Master Hus preach in Czech at the Bethlehem Chapel, and you think yourself cleverer than country people.', skills: { speech: 8, letters: 5 }, cares: 'Prague news; the quarrel of Czech and German masters at the university' },
  moravia: { name: 'Moravia', text: 'From the lands of the margraves, where Jobst and Prokop have warred on each other for years. You know what masterless soldiers do.', skills: { sword: 5 }, cares: 'the margraves\' war at home' },
  german: { name: 'Jihlava (Iglau)', text: 'From the German-speaking mining town on the Moravian border. Your Czech is good but your speech marks you, and some here distrust Germans.', skills: { trade: 8 }, cares: 'being taken for a German', accent: true },
};

/** Kin. For the born-here, those you live with are your parents (or the kin who raised you). */
export const PARENTS = {
  both: { name: 'Both parents living', text: 'Your father and mother are living.' },
  orphan: { name: 'Orphaned young', text: 'Your parents died when you were small; kin took you in.', kinWord: 'uncle' },
  widowed: { name: 'Your mother is a widow', text: 'Your father died some years ago; your mother keeps the house.' },
};

export const SIBLINGS = {
  none: { name: 'No brothers or sisters living', list: [] },
  brother: { name: 'An elder brother', list: [{ sex: 'm', age: 24, rel: 'elder brother' }] },
  sister: { name: 'A younger sister', list: [{ sex: 'f', age: 16, rel: 'younger sister' }] },
  both: { name: 'An elder brother and a younger sister', list: [{ sex: 'm', age: 24, rel: 'elder brother' }, { sex: 'f', age: 16, rel: 'younger sister' }] },
};

/**
 * What marks you. known: who would know of it — 'kin' (your household),
 * 'town' (every native), 'one' (one person: who), 'none' (a secret).
 */
export const PASTS = {
  none: { name: 'Nothing yet worth telling', text: 'An ordinary life so far. Everything is ahead of you.', known: 'none' },
  raid: { name: 'You lived through the spring raid', text: 'When Sigismund\'s army was in the land you hid in the woods while the Cumans burned and took. You have not slept well since; you know how to keep your head down and run.', known: 'town', skills: { stealth: 10 } },
  debt: { name: 'You owe money', text: 'You borrowed 10 groschen from the cloth merchant against your word and have not paid it back. He means to have it.', known: 'one', who: 'merchant', seed: { title: 'The merchant\'s money', kind: 'pay', amount: 120, want: 'Repay the 10 groschen (120 parvi) you borrowed, before St Gall.', stakes: 'Paid, your word is good in the market; unpaid, he will take you before the headman and every trader will hear of it.', hours: 96 } },
  vow: { name: 'You made a vow', text: 'When you lay sick with fever last winter you vowed to St Wenceslas that you would go on pilgrimage to Stará Boleslav, where he was murdered. You have not gone.', known: 'kin', who: 'priest', seed: { title: 'The vow to St Wenceslas', kind: 'talk', want: 'Speak with the priest about keeping your vow before the feast.', stakes: 'A vow kept is grace; a vow broken weighs on the soul, and the priest will say so.', hours: 48 } },
  sweetheart: { name: 'A sweetheart', text: 'There is someone in the town you have been meeting by the well. Nothing is promised, but people have noticed, and their family has other ideas.', known: 'town', who: 'sweetheart', seed: { title: 'Meeting at the well', kind: 'talk', want: 'Come and speak with them, before their family settles a match elsewhere.', stakes: 'A betrothal, if you can win the family; or someone else\'s bride.', hours: 72 } },
  apprentice: { name: 'You broke your apprenticeship', text: 'You were bound apprentice to a shoemaker and ran off before your years were out. A master who loses an apprentice can complain to the guild; you are not a craftsman, and not free of it either.', known: 'one', who: 'cobbler', skills: { trade: 6 } },
  letters: { name: 'A priest taught you letters', text: 'The old parish priest taught you to read and write a little, and some Latin from the psalter. It sets you apart, and the clergy like it.', known: 'town', who: 'priest', skills: { letters: 30 } },
  smir: { name: 'Blood on your hands', text: 'Two years ago, in another place, a quarrel at a fair ended with a man dead by your knife. It was settled by reconciliation (smír) with his kin: you paid, did penance, and set up a stone cross. Settled is not forgotten.', known: 'none', skills: { sword: 10 } },
  thief: { name: 'Light fingers', text: 'Hunger taught you to take what is not watched. Nobody here knows. Yet.', known: 'none', skills: { stealth: 15 } },
};

export const FAITHS = {
  devout: { name: 'Devout', text: 'You keep the fasts, go to confession and fear for your soul.', priest: 15 },
  ordinary: { name: 'As everyone is', text: 'You go to Mass on Sundays and feasts, and do not think much more about it.', priest: 0 },
  questioning: { name: 'Questioning', text: 'You have heard talk of Master Hus and of Wyclif, whose articles the university condemned this May: of priests who live like lords and sell grace for money. You keep it to yourself, mostly.', priest: -10 },
};

/** Apply a past at the start: skills, money, attitudes, and the people who know. */
export function applyLore(sim, lore) {
  const P = sim.player, L = { origin: 'skalice', parents: 'both', siblings: 'none', past: 'none', faith: 'ordinary', own: '', ...lore };
  if (!P.native && L.origin === 'skalice') L.origin = 'village';
  if (P.native) L.origin = 'skalice';
  P.lore = L;
  const add = (sk) => { for (const [k, v] of Object.entries(sk ?? {})) P.skills[k] = (P.skills[k] ?? 0) + v; };
  const o = ORIGINS[L.origin], past = PASTS[L.past], faith = FAITHS[L.faith];
  add(o?.skills); add(past?.skills);
  P.money = Math.max(0, P.money + (o?.money ?? 0));
  for (const p of sim.people) {
    if (p.role === 'priest') p.attitude += faith?.priest ?? 0;
    if (past?.who === p.role && L.past === 'apprentice') p.attitude -= 20;
    if (past?.who === p.role && L.past === 'letters') p.attitude += 12;
  }
  // the sweetheart: someone unmarried of an age, the other sex
  if (L.past === 'sweetheart') {
    const want = P.sex === 'f' ? 'm' : 'f';
    const s = sim.people.filter((p) => p.sex === want && !p.spouse && p.age >= 16 && p.age <= 30 && !p.kin && p.alive).sort((a, b) => a.age - b.age)[0];
    if (s) { L.sweetheart = s.id; s.attitude += 45; s.sweetheart = true; }
  }
  return L;
}

/** What this person knows of your past, for their prompt. */
export function loreKnownBy(sim, p) {
  const P = sim.player, L = P.lore;
  if (!L) return '';
  const past = PASTS[L.past], o = ORIGINS[L.origin], bits = [];
  const kin = !!p.kin, native = P.native;
  if (!native && o && (kin || p.lore_told)) bits.push(`They come from ${o.name}: ${o.text}`);
  if (!native && o?.accent) bits.push('Their speech has a German accent.');
  if (native) bits.push(`${P.name} is ${PARENTS[L.parents]?.text.replace(/^Your/, 'their').replace(/^You/, 'they')}`);
  const knows = past && L.past !== 'none' && (
    past.known === 'town' && (native || p.id === L.sweetheart) ||
    past.known === 'kin' && (kin || p.role === past.who) ||
    past.known === 'one' && (p.role === past.who || kin));
  if (knows) bits.push(`You know this of them: ${past.text.replace(/\byou\b/gi, 'they').replace(/\byour\b/gi, 'their')}`);
  if (p.id === L.sweetheart) bits.push('You and they have been meeting secretly by the well; you are sweet on them. Your family would want a better match, or at least a proper asking.');
  if (L.past === 'debt' && p.role === 'merchant') bits.push('They owe you 10 groschen (120 parvi), borrowed on their word and not repaid. You mean to have it before St Gall.');
  if (kin && L.own) bits.push(`What their family knows of their life (in their own words): ${L.own.slice(0, 300)}`);
  if (kin && FAITHS[L.faith]) bits.push(`Their faith: ${FAITHS[L.faith].name.toLowerCase()}.`);
  return bits.join(' ');
}

/** The whole past, for the storyteller (it knows everything, secrets included). */
export function loreFull(P) {
  const L = P.lore;
  if (!L) return 'No past recorded.';
  const sib = SIBLINGS[L.siblings]?.list.map((x) => x.rel).join(' and ');
  return [
    `From: ${ORIGINS[L.origin]?.name} — ${ORIGINS[L.origin]?.text}`,
    `Parents: ${PARENTS[L.parents]?.text}${sib ? ` Siblings in the household: ${sib}.` : ''}`,
    `What marks them: ${PASTS[L.past]?.name}. ${PASTS[L.past]?.text}${PASTS[L.past]?.known === 'none' ? ' (A SECRET: nobody in the town knows.)' : ''}`,
    `Faith: ${FAITHS[L.faith]?.name}. ${FAITHS[L.faith]?.text}`,
    L.own ? `In their own words: ${L.own.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');
}
