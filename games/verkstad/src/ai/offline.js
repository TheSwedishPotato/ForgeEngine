/**
 * Customers without Claude: when no API key is set up (or the single-file build runs offline).
 * Fewer surprises than the real thing, but the same rules: a person, a car, one to three faults from
 * the catalogue, words for what they notice, and a fair reaction at the counter.
 */
import { forCar, byId } from '../data/faults.js';
import { CARS } from '../data/cars.js';

const FIRST = { woman: ['Anna', 'Maria', 'Karin', 'Sara', 'Elin', 'Ingrid', 'Leila', 'Amira', 'Birgitta', 'Johanna', 'Fatima', 'Linnea', 'Astrid', 'Mona'], man: ['Erik', 'Lars', 'Johan', 'Ahmed', 'Mikael', 'Anders', 'Nils', 'Omar', 'Per', 'Kalle', 'Jonas', 'Göran', 'Mehmet', 'Sven'] };
const LAST = ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Lindqvist', 'Haddad', 'Yilmaz', 'Berg', 'Holm', 'Sandberg'];
const JOBS = ['nurse at Sahlgrenska', 'Volvo Torslanda assembly worker', 'retired tram driver', 'student at Chalmers', 'bus driver', 'primary school teacher', 'electrician', 'pizzeria owner', 'harbour crane operator', 'freelance photographer', 'IT consultant', 'pastor'];
const MOODS = [['friendly and chatty', 'talks a lot, laughs easily', 0.8], ['stressed and in a hurry', 'short sentences, checks the phone', 0.25], ['sceptical, has been overcharged before', 'asks why twice', 0.45], ['quiet and polite', 'says tack a lot', 0.7], ['grumpy but fair', 'sighs, then softens', 0.5]];
const ITEMS = [['a child\'s toy dinosaur', 'underseat'], ['a mouse nest of shredded insulation', 'airbox'], ['an old cassette tape', 'glovebox'], ['a lost wedding ring', 'underseat'], ['a frozen bag of cinnamon buns', 'boot']];

const pick = (a, r) => a[Math.floor(r() * a.length) % a.length];

export function offlineCustomer(r = Math.random, { allowF1 = false, wantCar = null } = {}) {
  const car = wantCar ?? (allowF1 && r() < 0.08 ? 'f1_2026' : r() < 0.5 ? 'volvo240' : 'golf7');
  const gender = r() < 0.5 ? 'woman' : 'man';
  const [personality, speech, patience] = pick(MOODS, r);
  const options = forCar(car);
  const n = 1 + (r() < 0.45 ? 1 : 0) + (r() < 0.12 ? 1 : 0);
  const faults = [];
  while (faults.length < n) { const f = pick(options, r); if (!faults.some((x) => x.id === f.id)) faults.push({ id: f.id, where: '' }); }
  const lay = faults.map((f) => byId(f.id).lay);
  const item = r() < 0.25 ? pick(ITEMS, r) : null;
  const name = `${pick(FIRST[gender], r)} ${pick(LAST, r)}`;
  return {
    name, age: 19 + Math.floor(r() * 62), gender, occupation: car === 'f1_2026' ? 'logistics manager of a Formula 1 team on a demo tour' : pick(JOBS, r), personality, speech,
    car, paint: pick(CARS[car].paint, r), mileage_km: car === 'f1_2026' ? 1800 : car === 'volvo240' ? 250000 + Math.floor(r() * 200000) : 60000 + Math.floor(r() * 120000),
    faults, item: item ? { label: item[0], location: item[1], rattles: item[1] !== 'airbox' } : { label: '', location: 'none', rattles: false },
    opening: `Hej! ${capital(lay[0])}.${lay[1] ? ` And ${lay[1]}.` : ''} Can you have a look?`,
    truth: 'Nothing more than what they said.', secrets: [], budget_sek: 2500 + Math.floor(r() * 6000), patience, wants_back: 'today if possible',
    looks: { height_cm: gender === 'woman' ? 158 + Math.floor(r() * 16) : 170 + Math.floor(r() * 18), hair: pick(['black', 'dark brown', 'brown', 'blond', 'grey'], r), skin: pick(['light', 'light', 'medium', 'tan', 'brown'], r), beard: gender === 'man' && r() < 0.3, clothes: pick(['#26324a', '#6b2430', '#2f4f3f', '#3a3a3c', '#8a7556', '#1e1e22'], r) },
  };
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A canned reply, by what the mechanic asked. */
export function offlineReply(cust, said) {
  const p = cust.profile, s = said.toLowerCase();
  const lay = cust.records.map((r) => byId(r.id)?.lay).filter(Boolean);
  if (/when|how long|since/.test(s)) return 'It started a couple of weeks ago, I think. Maybe a bit longer.';
  if (/where|which (side|wheel)|left|right|front|back/.test(s)) return 'Hard to say exactly. Somewhere at the front? I am not sure.';
  if (/cost|price|kr|sek|expensive/.test(s)) return `I was hoping for under ${Math.round(p.budget_sek / 500) * 500} kronor, to be honest.`;
  if (/light|lamp|warning/.test(s)) return lay.some((l) => /light/.test(l)) ? 'Yes, a light came on. Red or orange, I did not look closely.' : 'No lights that I have seen.';
  if (/noise|sound|hear/.test(s)) return lay.find((l) => /noise|squeal|grind|clunk|hum|click|hiss|loud/.test(l)) ? `Yes: ${lay.find((l) => /noise|squeal|grind|clunk|hum|click|hiss|loud/.test(l))}.` : 'Not really a noise, no.';
  if (/ok|fine|leave it|i'll (have|take) a look|we'll see/.test(s)) return 'Tack! Call me when you know something.';
  return `${capital(lay[0] ?? 'it just does not feel right')}. That is all I really know.`;
}

export function offlineDecide(cust, total) {
  const p = cust.profile;
  const accept = total <= p.budget_sek * (0.8 + p.patience * 0.6);
  return { accept, says: accept ? 'Okej, do it. Jättebra.' : `That is more than I can spend right now (${total} kronor). Just do what is needed for safety.` };
}

export function offlineVerdict(cust, { fixedAll, fixedSome, total, extraUnapproved, problems }) {
  const p = cust.profile;
  let stars = fixedAll ? 5 : fixedSome ? 3 : 1;
  if (problems.length) stars = Math.max(1, stars - 2);
  if (total > p.budget_sek * 1.3) stars = Math.max(1, stars - 1);
  const pays = Math.round(fixedAll || fixedSome ? total - extraUnapproved : Math.min(total, 500));
  const says = fixedAll ? 'It drives like it should again. Tack så mycket!' : fixedSome ? 'Better, but it is not all gone.' : 'It is exactly the same as when I brought it in.';
  return { says: problems.length ? `${says} But ${problems[0].what.toLowerCase()}` : says, pays_sek: pays, stars, review: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} ${says}` };
}
