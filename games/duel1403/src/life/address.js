/**
 * How one person addresses another in a Bohemian town of 1403.
 *
 * Old Czech had a vocative case, and people were addressed by what they
 * were: a lord as pane (with milostivý, "gracious", for the great), a
 * priest as kněže, a friar as bratře, a master of a craft as mistře, a
 * fellow townsman or villager as sousede ("neighbour"), a familiar as
 * kmotře ("gossip", co-godparent), a priest his flock as synu / dcero,
 * a beggar his giver as dobrý člověče, a lad or servant as pacholče / pacholku,
 * a farmer as sedláku (selko), a girl as děvečko, a married woman of standing as paní, an unmarried girl
 * of good family as panno. Superiors spoke down with ty and the bare name or
 * a plain word: člověče ("man"), chlape ("fellow"). The honorific plural
 * (vy) to the great was spreading in this period; between commoners ty was
 * normal. These forms are attested in Old Czech texts; who used which to
 * whom is our reconstruction from precedence, said so in the codex.
 *
 * who: { rank (society.js id), estate, sex, age, role } for both sides.
 * Returns { cz, en, tv, bow } — the vocative, an English gloss, ty or vy,
 * and the outward deference expected (none, nod, bare head, bow, kneel).
 */
import { allRanks } from '../data/society.js';

const RANK = Object.fromEntries(allRanks().map((r) => [r.id, r]));
const prec = (who) => RANK[who.rank]?.rank ?? 20;

export function addressOf(from, to) {
  const pf = prec(from), pt = prec(to), up = pt - pf;   // > 0: speaking upward
  const f = to.sex === 'f';
  const young = (to.age ?? 30) < 19;
  const est = to.estate;
  const kneel = pt >= 85 && pf < 60, bow = up >= 25, bare = up >= 12;
  const bowWord = kneel ? 'kneel' : bow ? 'bow' : bare ? 'bare head' : up >= -5 ? 'nod' : 'none';
  const tv = up >= 25 && pt >= 62 ? 'vy' : 'ty';
  const out = (cz, en) => ({ cz, en, tv, bow: bowWord });

  // the great
  if (pt >= 85) return f ? out('milostivá paní', 'gracious lady') : out('milostivý pane', 'gracious lord');
  // the priest speaks down to his flock as a father; the beggar pleads
  if (from.estate === 'clergy' && pf > pt + 5) return f ? out('dcero', 'daughter') : out('synu', 'my son');
  if (from.rank === 'beggar' && up > 0 && pt < 62) return f ? out('dobrá ženo', 'good woman') : out('dobrý člověče', 'good man');
  // clergy
  if (est === 'clergy') {
    if (to.rank === 'friar') return out('bratře', 'brother');
    if (to.rank === 'priest' || to.rank === 'canon') return out('kněže', 'father (priest)');
    return out('otče', 'father');
  }
  // the lower nobility and the castle's officers
  if (est === 'knights' || est === 'crown') {
    if (up > 0 || pf < 55) return f ? out('paní', 'lady') : out(to.rank === 'burgraveCastle' ? 'pane purkrabí' : to.role === 'captain' ? 'pane hejtmane' : 'pane', 'sir, my lord');
    return f ? out('paní', 'lady') : out('pane bratře', 'brother (between nobles)');
  }
  // townsmen and village officers
  if (to.rank === 'alderman' || to.rank === 'burgomaster' || to.rank === 'reeve') return f ? out('paní', 'mistress') : out('pane konšele', 'master alderman');
  if (to.rank === 'rychtar') return out('pane rychtáři', 'master headman');
  if (to.rank === 'patrician') return f ? out('paní', 'mistress') : out(pf >= 55 ? 'pane sousede' : 'pane', 'sir (a rich burgher)');
  if (to.rank === 'mastercraft' || to.rank === 'guildmaster') return f ? (pf < pt ? out('paní mistrová', 'mistress (a master\'s wife)') : out('sousedko', 'neighbour')) : out('mistře', 'master');
  // soldiers: by what they are
  if (to.rank === 'mercenary') return out('pacholku', 'soldier (a common foot soldier)');
  // the young and the servants
  if (young || to.rank === 'apprentice' || to.rank === 'servant') return f ? out('děvečko', 'girl') : out('pacholče', 'lad');
  // a farmer, to anyone not of the village
  if (to.rank === 'sedlak' && from.estate !== 'peasants') return f ? out('selko', 'farmwife') : out('sedláku', 'farmer');
  // from on high, down to commoners
  if (pf >= 60 && pt < 40) return f ? out('ženo', 'woman') : out('člověče', 'fellow');
  // between commoners: neighbours, and gossips among friends
  if (est === 'peasants' || est === 'towns') return f ? (to.age > 45 ? out('matko', 'mother') : out('sousedko', 'neighbour')) : out(Math.abs(up) <= 12 ? 'sousede' : 'člověče', Math.abs(up) <= 12 ? 'neighbour' : 'fellow');
  if (to.rank === 'beggar') return out('chudáku', 'poor fellow');
  return f ? out('ženo', 'woman') : out('člověče', 'fellow');
}

/** The player as others see him: rank from dress and station. */
export function playerWho(P) {
  if (P.army) return { rank: 'mercenary', estate: 'margins', sex: P.sex, age: 20, role: 'soldier' };
  const estate = P.noble ? 'knights' : P.estate ?? (P.rank === 'patrician' || P.rank === 'journeyman' ? 'towns' : 'peasants');
  return { rank: P.rank ?? 'podruh', estate, sex: P.sex, age: 20, role: 'player' };
}

/** One person as data for addressOf. */
export function personWho(p) { return { rank: p.rank, estate: p.estate, sex: p.sex, age: p.age, role: p.role }; }

/** A line for the prompt: how to speak to the other, and what they owe you. */
export function etiquette(p, P) {
  const me = personWho(p), them = playerWho(P);
  const to = addressOf(me, them), from = addressOf(them, me);
  const RK = (w) => RANK[w.rank];
  const deed = { kneel: 'kneels', bow: 'bows and bares the head', 'bare head': 'takes off the hat', nod: 'nods', none: 'needs show no sign' };
  return [
    `Their apparent station: ${RK(them)?.name ?? them.rank} (${RK(them)?.cz ?? ''}), precedence ${RK(them)?.rank ?? '?'}. Yours: ${RK(me)?.name ?? me.rank}, precedence ${RK(me)?.rank ?? '?'}.`,
    `Address them as "${to.cz}" (${to.en}), with ${to.tv}${to.tv === 'vy' ? ' (the respectful plural)' : ''}. Never call them "pane" or "paní" unless that is the form given here: pane is for lords, knights and men of standing, not for a peasant, labourer or common soldier.`,
    `Proper for them toward you: to call you "${from.cz}" (${from.en}) and, on meeting, ${deed[from.bow]}. If they are insolent above their station, or grovel below it, react as your rank and temper would.`,
  ].join('\n');
}
