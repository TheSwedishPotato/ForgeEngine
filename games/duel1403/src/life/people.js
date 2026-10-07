/**
 * The people of Skalice: who they are, what they do all day, what they are
 * like. Generated from a fixed seed so the town is the same every time,
 * with names, ranks and trades drawn from the society of 1403
 * (src/data/society.js) and Czech naming of the period (src/life/data.js).
 */

import { SHOPS as SHOP_STOCK } from './data.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Men's names weighted toward Jan, as in the records; women's after the same counts.
const MEN = ['Jan', 'Jan', 'Jan', 'Petr', 'Mikuláš', 'Tomáš', 'Matěj', 'Marek', 'Václav', 'Ondřej', 'Jakub', 'Martin', 'Pavel', 'Jiří', 'Šimon', 'Prokop', 'Bartoloměj', 'Havel', 'Vít', 'Mareš', 'Ješek', 'Bušek', 'Hereš', 'Zdeněk', 'Bohuslav', 'Štěpán', 'Kuneš', 'Jíra'];
const WOMEN = ['Kateřina', 'Anna', 'Dorota', 'Markéta', 'Alžběta', 'Klára', 'Ludmila', 'Magdaléna', 'Barbora', 'Marta', 'Johanka', 'Ofka', 'Kunka', 'Běta'];
// Bynames by trade or look, as in town books (not yet fixed surnames).
const BYNAME = { smith: 'Kovář', baker: 'Pekař', butcher: 'Řezník', cobbler: 'Švec', weaver: 'Tkadlec', innkeeper: 'Krčmář', bathkeeper: 'Lazebník', farmer: ['Novák', 'Dvořák', 'Sedlák', 'z Polí', 'Černý', 'Malý', 'Dlouhý', 'Bílý'], labourer: ['Holý', 'Kus', 'Vrána', 'Liška', 'Hrubý'] };

/** Personality: Big Five plus the things a medieval town notices. 0..1. */
function traits(R) {
  const t = () => Math.round((R() * 0.7 + R() * 0.3) * 100) / 100;
  return { openness: t(), conscientiousness: t(), extraversion: t(), agreeableness: t(), neuroticism: t(), piety: t(), honesty: t(), temper: t(), greed: t(), courage: t() };
}

function describe(tr) {
  const w = [];
  if (tr.extraversion > 0.7) w.push('talkative'); else if (tr.extraversion < 0.3) w.push('taciturn');
  if (tr.agreeableness > 0.7) w.push('kindly'); else if (tr.agreeableness < 0.3) w.push('surly');
  if (tr.conscientiousness > 0.7) w.push('hard-working'); else if (tr.conscientiousness < 0.3) w.push('idle');
  if (tr.temper > 0.72) w.push('quick to anger');
  if (tr.piety > 0.75) w.push('devout'); else if (tr.piety < 0.2) w.push('irreverent');
  if (tr.honesty < 0.3) w.push('sly'); else if (tr.honesty > 0.8) w.push('honest to a fault');
  if (tr.greed > 0.75) w.push('grasping'); else if (tr.greed < 0.2) w.push('open-handed');
  if (tr.neuroticism > 0.75) w.push('anxious');
  if (tr.courage > 0.8) w.push('bold'); else if (tr.courage < 0.2) w.push('timid');
  return w.length ? w : ['ordinary'];
}

/**
 * Routines: [hour, place, activity] in order; the entry in force is the
 * last whose hour has passed. Places: building ids, 'home', 'work', or open
 * places (well, market, fields, gate, yard, joust, privy, pillory).
 */
const R_ = {
  craft: [[0, 'home', 'sleeping'], [5, 'home', 'rising'], [5.75, 'work', 'working'], [11.75, 'home', 'eating dinner'], [12.75, 'work', 'working'], [17.75, 'home', 'eating supper'], [19, 'home', 'resting'], [20.75, 'home', 'sleeping']],
  craftTavern: [[0, 'home', 'sleeping'], [5, 'home', 'rising'], [5.75, 'work', 'working'], [11.75, 'home', 'eating dinner'], [12.75, 'work', 'working'], [17.75, 'home', 'eating supper'], [18.75, 'tavern', 'drinking'], [20.5, 'home', 'sleeping']],
  baker: [[0, 'home', 'sleeping'], [2.5, 'work', 'baking'], [10, 'work', 'selling bread'], [12, 'home', 'eating dinner'], [13, 'work', 'selling bread'], [16, 'home', 'resting'], [19, 'home', 'sleeping']],
  innkeeper: [[0, 'tavern', 'sleeping'], [5.5, 'tavern', 'serving'], [22, 'tavern', 'sleeping']],
  maid: [[0, 'tavern', 'sleeping'], [5, 'well', 'fetching water'], [5.6, 'tavern', 'serving'], [21.5, 'tavern', 'sleeping']],
  farmer: [[0, 'home', 'sleeping'], [4.75, 'home', 'feeding the beasts'], [5.75, 'fields', 'ploughing for the winter rye'], [11.5, 'home', 'eating dinner'], [12.5, 'fields', 'working in the fields'], [17.5, 'home', 'eating supper'], [19, 'home', 'resting'], [20.5, 'home', 'sleeping']],
  farmerTavern: [[0, 'home', 'sleeping'], [4.75, 'home', 'feeding the beasts'], [5.75, 'fields', 'ploughing'], [11.5, 'home', 'eating dinner'], [12.5, 'fields', 'working in the fields'], [17.5, 'home', 'eating supper'], [18.5, 'tavern', 'drinking'], [20.4, 'home', 'sleeping']],
  wife: [[0, 'home', 'sleeping'], [4.75, 'home', 'lighting the fire'], [6, 'well', 'drawing water'], [6.5, 'home', 'cooking'], [8, 'market', 'buying at the market'], [9.25, 'home', 'spinning and cooking'], [14, 'fields', 'gleaning and weeding'], [16.5, 'home', 'cooking supper'], [20.5, 'home', 'sleeping']],
  townwife: [[0, 'home', 'sleeping'], [5, 'home', 'lighting the fire'], [6.25, 'well', 'drawing water'], [6.75, 'home', 'cooking'], [8, 'market', 'buying at the market'], [9.5, 'home', 'keeping house'], [15, 'market', 'gossiping in the square'], [16, 'home', 'cooking supper'], [20.5, 'home', 'sleeping']],
  priest: [[0, 'home', 'sleeping'], [5, 'church', 'saying Mass'], [7, 'home', 'reading his breviary'], [10, 'market', 'visiting his flock'], [11.75, 'home', 'eating dinner'], [13, 'church', 'hearing confessions'], [15, 'home', 'saying the hours'], [17.5, 'church', 'vespers'], [18.5, 'home', 'sleeping']],
  sexton: [[0, 'home', 'sleeping'], [4.75, 'church', 'ringing the morning bell'], [6, 'church', 'sweeping the church'], [11.5, 'home', 'eating'], [12.5, 'church', 'digging a grave in the churchyard'], [17.5, 'church', 'ringing vespers'], [18.5, 'home', 'resting'], [20.3, 'church', 'ringing the curfew bell'], [20.8, 'home', 'sleeping']],
  headman: [[0, 'home', 'sleeping'], [5.5, 'rychta', 'hearing complaints'], [9, 'market', 'watching the market'], [11.75, 'rychta', 'eating dinner'], [13, 'rychta', 'keeping the town book'], [16, 'market', 'talking with the aldermen'], [18, 'tavern', 'drinking'], [20.5, 'rychta', 'sleeping']],
  soldierDay: [[0, 'barracks', 'sleeping'], [5, 'yard', 'drilling'], [8, 'gate', 'standing watch at the gate'], [12, 'barracks', 'eating'], [13, 'patrol', 'walking the town'], [17, 'yard', 'cleaning his gear'], [19, 'tavern', 'drinking'], [21, 'barracks', 'sleeping']],
  soldierNight: [[0, 'patrol', 'walking the night watch'], [5, 'barracks', 'sleeping'], [12, 'barracks', 'eating'], [13, 'yard', 'drilling'], [16, 'gate', 'standing watch at the gate'], [20, 'patrol', 'walking the night watch']],
  captain: [[0, 'barracks', 'sleeping'], [5.5, 'yard', 'drilling the men'], [9, 'hall', 'with the burgrave'], [11.5, 'hall', 'eating dinner'], [13, 'yard', 'taking on men'], [17.5, 'hall', 'eating supper'], [19, 'tavern', 'drinking and hiring'], [21, 'barracks', 'sleeping']],
  burgrave: [[0, 'hall', 'sleeping'], [6, 'hall', 'hearing the reeve'], [9, 'yard', 'inspecting the walls'], [11, 'hall', 'eating dinner'], [13, 'hall', 'judging disputes'], [17.5, 'hall', 'supper'], [21, 'hall', 'sleeping']],
  herald: [[0, 'tavern', 'sleeping'], [7, 'joust', 'readying the lists'], [12, 'tavern', 'eating'], [13, 'joust', 'calling the jousters'], [17.5, 'tavern', 'telling stories'], [22, 'tavern', 'sleeping']],
  labourer: [[0, 'home', 'sleeping'], [5, 'fields', 'threshing for day wages'], [11.75, 'home', 'eating bread'], [12.5, 'fields', 'carting dung to the fields'], [17.5, 'tavern', 'drinking'], [20.4, 'home', 'sleeping']],
  beggar: [[0, 'church', 'sleeping in the porch'], [6, 'church', 'begging at the church door'], [10, 'market', 'begging in the square'], [14, 'tavern', 'begging at the tavern door'], [19, 'church', 'sleeping in the porch']],
  bathkeeper: [[0, 'home', 'sleeping'], [5, 'bath', 'heating the bath'], [11.75, 'bath', 'eating'], [12.5, 'bath', 'bleeding and shaving'], [19, 'home', 'resting'], [20.5, 'home', 'sleeping']],
  merchant: [[0, 'tavern', 'sleeping'], [6.5, 'market', 'selling cloth'], [12, 'tavern', 'eating'], [13, 'market', 'selling cloth'], [17, 'tavern', 'reckoning his accounts'], [21, 'tavern', 'sleeping']],
};
/** Sunday and feasts: everyone goes to Mass, then rests or drinks. */
const SUNDAY = [[0, 'home', 'sleeping'], [6, 'home', 'rising'], [8, 'church', 'at Mass'], [10, 'market', 'talking after Mass'], [11.5, 'home', 'eating dinner'], [13, 'home', 'resting'], [16, 'tavern', 'drinking'], [20.5, 'home', 'sleeping']];

/** The population. role picks the routine; rank is a society.js member id. */
const CAST = [
  // castle
  { role: 'burgrave', routine: 'burgrave', rank: 'burgraveCastle', sex: 'm', age: 46, home: 'hall', work: 'hall', title: 'burgrave of Skalice castle', name: 'Mikuláš', byname: 'of Lipka', estate: 'knights', dress: 'noble', armed: true },
  { role: 'captain', routine: 'captain', rank: 'knight', sex: 'm', age: 39, home: 'barracks', work: 'yard', title: 'captain (hejtman) of the garrison', name: 'Hereš', byname: 'of Vrchy', estate: 'knights', dress: 'soldierRich', armed: true, recruiter: true },
  { role: 'soldier', routine: 'soldierDay', rank: 'mercenary', sex: 'm', age: 28, home: 'barracks', work: 'gate', title: 'crossbowman of the garrison', estate: 'margins', dress: 'soldier', armed: true, watch: true },
  { role: 'soldier', routine: 'soldierDay', rank: 'mercenary', sex: 'm', age: 24, home: 'barracks', work: 'gate', title: 'foot soldier of the garrison', estate: 'margins', dress: 'soldier', armed: true, watch: true },
  { role: 'soldier', routine: 'soldierNight', rank: 'mercenary', sex: 'm', age: 33, home: 'barracks', work: 'gate', title: 'watchman', estate: 'margins', dress: 'soldier', armed: true, watch: true },
  { role: 'soldier', routine: 'soldierNight', rank: 'mercenary', sex: 'm', age: 21, home: 'barracks', work: 'gate', title: 'watchman', estate: 'margins', dress: 'soldier', armed: true, watch: true },
  { role: 'herald', routine: 'herald', rank: 'courtier', sex: 'm', age: 35, home: 'tavern', work: 'joust', title: 'herald of the tournament', estate: 'crown', dress: 'herald', jousts: true },
  // church
  { role: 'priest', routine: 'priest', rank: 'priest', sex: 'm', age: 52, home: 'h16', work: 'church', title: 'parish priest (farář)', estate: 'clergy', dress: 'priest' },
  { role: 'sexton', routine: 'sexton', rank: 'servant', sex: 'm', age: 60, home: 'h16', work: 'church', title: 'sexton and bell-ringer', estate: 'towns', dress: 'poor' },
  { role: 'beggar', routine: 'beggar', rank: 'beggar', sex: 'm', age: 55, home: 'church', work: 'church', title: 'beggar', estate: 'margins', dress: 'rags' },
  // town
  { role: 'headman', routine: 'headman', rank: 'rychtar', sex: 'm', age: 50, home: 'rychta', work: 'rychta', title: 'headman (rychtář) of Skalice', estate: 'peasants', dress: 'burgher' },
  { role: 'innkeeper', routine: 'innkeeper', rank: 'innkeeper', sex: 'm', age: 44, home: 'tavern', work: 'tavern', trade: 'innkeeper', title: 'innkeeper (krčmář)', estate: 'peasants', dress: 'apron', sells: 'tavern' },
  { role: 'innwife', routine: 'innkeeper', rank: 'innkeeper', sex: 'f', age: 40, home: 'tavern', work: 'tavern', title: 'the innkeeper\'s wife', estate: 'peasants', dress: 'woman', sells: 'tavern', spouseOf: 'innkeeper' },
  { role: 'maid', routine: 'maid', rank: 'servant', sex: 'f', age: 17, home: 'tavern', work: 'tavern', title: 'serving maid', estate: 'towns', dress: 'womanPoor' },
  { role: 'smith', routine: 'craftTavern', rank: 'mastercraft', sex: 'm', age: 41, home: 'smithy', work: 'smithy', trade: 'smith', title: 'master smith', estate: 'towns', dress: 'apron', sells: 'smithy', name: 'Ondřej' },
  { role: 'apprentice', routine: 'craft', rank: 'apprentice', sex: 'm', age: 14, home: 'smithy', work: 'smithy', trade: 'smith', title: 'smith\'s apprentice', estate: 'towns', dress: 'poor' },
  { role: 'baker', routine: 'baker', rank: 'alderman', sex: 'm', age: 48, home: 'bakery', work: 'bakery', trade: 'baker', title: 'baker and alderman (konšel)', estate: 'towns', dress: 'apron', sells: 'bakery' },
  { role: 'bakerwife', routine: 'townwife', rank: 'mastercraft', sex: 'f', age: 43, home: 'bakery', work: 'bakery', title: 'the baker\'s wife', estate: 'towns', dress: 'woman', spouseOf: 'baker' },
  { role: 'butcher', routine: 'craftTavern', rank: 'alderman', sex: 'm', age: 45, home: 'butcher', work: 'butcher', trade: 'butcher', title: 'butcher and alderman (konšel)', estate: 'towns', dress: 'apron', sells: 'butcher' },
  { role: 'cobbler', routine: 'craft', rank: 'mastercraft', sex: 'm', age: 37, home: 'cobbler', work: 'cobbler', trade: 'cobbler', title: 'shoemaker', estate: 'towns', dress: 'apron', sells: 'cobbler' },
  { role: 'weaver', routine: 'craft', rank: 'mastercraft', sex: 'm', age: 30, home: 'weaver', work: 'weaver', trade: 'weaver', title: 'weaver', estate: 'towns', dress: 'townsman', sells: 'weaver' },
  { role: 'weaverwife', routine: 'townwife', rank: 'mastercraft', sex: 'f', age: 26, home: 'weaver', work: 'weaver', title: 'the weaver\'s wife, who spins', estate: 'towns', dress: 'woman', spouseOf: 'weaver' },
  { role: 'bathkeeper', routine: 'bathkeeper', rank: 'bathkeeper', sex: 'm', age: 38, home: 'bath', work: 'bath', trade: 'bathkeeper', title: 'bath-keeper and barber (lazebník)', estate: 'margins', dress: 'apron', sells: 'bath' },
  { role: 'merchant', routine: 'merchant', rank: 'patrician', sex: 'm', age: 42, home: 'h13', work: 'market', title: 'cloth merchant from Prague', estate: 'towns', dress: 'burgher', sells: 'market' },
  // village
  ...[1, 2, 3, 4, 5, 7, 8, 11, 12].flatMap((n, i) => [
    { role: 'farmer', routine: i % 3 === 0 ? 'farmerTavern' : 'farmer', rank: 'sedlak', sex: 'm', age: 30 + ((i * 7) % 25), home: 'h' + n, work: 'fields', trade: 'farmer', title: 'farmer (sedlák)', estate: 'peasants', dress: 'peasant' },
    ...(i % 2 === 0 || i < 4 ? [{ role: 'farmwife', routine: i < 6 ? 'wife' : 'townwife', rank: 'sedlak', sex: 'f', age: 26 + ((i * 5) % 22), home: 'h' + n, work: 'home', title: 'farmer\'s wife', estate: 'peasants', dress: 'woman', spouseOfHome: true }] : []),
  ]),
  ...[6, 9, 10, 14, 15].map((n, i) => ({ role: 'cottager', routine: 'labourer', rank: i < 3 ? 'chalupnik' : 'podruh', sex: 'm', age: 22 + i * 9, home: 'h' + n, work: 'fields', trade: 'labourer', title: i < 3 ? 'cottager (chalupník)' : 'lodger and day labourer (podruh)', estate: 'peasants', dress: 'poor' })),
];

/** Dress palettes and armour-mesh items per kind of dress. */
export const DRESS = {
  noble: { colors: { cloth: '#7a1018', hose: '#1c2a5a', accent: '#d8c060' }, items: { head: 'hood', under: 'armingDoublet', legs: 'hose', feet: 'shoes' }, hat: 1 },
  soldierRich: { colors: { cloth: '#3a4a2a', hose: '#2a2a2a', accent: '#c8a040' }, items: { head: 'openBascinet', under: 'gambeson', mail: 'haubergeon', plate: 'brigandine', feet: 'shoes' } },
  soldier: { colors: { cloth: '#8a7a5a', hose: '#4a3a2a' }, items: { head: 'kettleHat', under: 'gambeson', legs: 'hose', feet: 'shoes' } },
  herald: { colors: { cloth: '#b0161c', hose: '#e8e2d4' }, items: { head: 'hood', under: 'armingDoublet', cover: 'jupon', legs: 'hose', feet: 'shoes' }, heraldry: 'bohemia' },
  priest: { colors: { cloth: '#1a1a1a', hose: '#1a1a1a' }, items: { head: 'bareHead', under: 'shirt', legs: 'hose', feet: 'shoes' } },
  burgher: { colors: { cloth: '#1c3a6a', hose: '#7a1c1c' }, items: { head: 'hood', under: 'armingDoublet', legs: 'hose', feet: 'shoes' }, hat: 1 },
  townsman: { colors: { cloth: '#5a2a3a', hose: '#3a2e22' }, items: { head: 'hood', under: 'shirt', legs: 'hose', feet: 'shoes' } },
  apron: { colors: { cloth: '#6a4a2a', hose: '#3a2e22' }, items: { head: 'bareHead', under: 'shirt', legs: 'hose', feet: 'shoes' } },
  peasant: { colors: { cloth: '#7a6a44', hose: '#5a4a32' }, items: { head: 'hood', under: 'shirt', legs: 'hose', feet: 'shoes' } },
  poor: { colors: { cloth: '#6a5a40', hose: '#4a3a2a' }, items: { head: 'hood', under: 'shirt', legs: 'hose', feet: 'shoes' } },
  rags: { colors: { cloth: '#5a5040', hose: '#3a3428' }, items: { head: 'hood', under: 'shirt', legs: 'hose', feet: 'shoes' } },
  woman: { colors: { cloth: '#7a2a2a', hose: '#4a3a2a' }, items: { head: 'bareHead', under: 'shirt', legs: 'hose', feet: 'shoes' }, female: true },
  womanPoor: { colors: { cloth: '#8a7a5a', hose: '#4a3a2a' }, items: { head: 'bareHead', under: 'shirt', legs: 'hose', feet: 'shoes' }, female: true },
};

export function makePeople(seed = 1403) {
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const used = new Set();
  const people = CAST.map((c, i) => {
    let name = c.name;
    if (!name) {
      for (let k = 0; k < 10; k++) { name = pick(c.sex === 'f' ? WOMEN : MEN); if (!used.has(name + c.role) || k > 6) break; }
    }
    used.add(name + c.role);
    let byname = c.byname;
    if (!byname) {
      const b = BYNAME[c.trade] ?? BYNAME[c.role];
      byname = Array.isArray(b) ? pick(b) : b ?? (c.role === 'soldier' ? pick(['z Moravy', 'Dlouhý', 'Šilhavý', 'Kos', 'Medvěd']) : pick(['Malý', 'Starý', 'Vrba', 'Kříž']));
    }
    const tr = traits(R);
    if (c.role === 'priest') tr.piety = Math.max(tr.piety, 0.75);
    if (c.role === 'captain' || c.role === 'soldier') tr.courage = Math.max(tr.courage, 0.6);
    if (c.role === 'beggar') tr.extraversion = Math.max(tr.extraversion, 0.6);
    let routine = c.routine;
    // the sociable go to the tavern of an evening
    if (routine === 'craft' && tr.extraversion > 0.6 && c.sex === 'm') routine = 'craftTavern';
    const d = DRESS[c.dress];
    return {
      id: 'p' + i, idx: i, role: c.role, name, byname, fullName: `${name} ${byname}`.trim(), sex: c.sex, age: c.age,
      rank: c.rank, estate: c.estate, trade: c.trade ?? null, title: c.title, home: c.home, work: c.work,
      routine, traits: tr, words: describe(tr), dress: c.dress, colors: { ...d.colors }, items: { ...d.items }, hat: d.hat ?? (R() < 0.35 ? 1 : 0),
      armed: !!c.armed, watch: !!c.watch, recruiter: !!c.recruiter, jousts: !!c.jousts, sells: c.sells ?? null,
      money: Math.round(({ burgrave: 4000, captain: 2400, merchant: 3000, headman: 900, innkeeper: 700, baker: 600, butcher: 600, smith: 500 }[c.role] ?? 80) * (0.6 + 0.8 * R())),
      spouseOf: c.spouseOf, spouseOfHome: c.spouseOfHome,
      // live state
      attitude: Math.round((tr.agreeableness - 0.5) * 30), memories: [], mood: 'calm', alive: true, hurt: 0, follow: null,
      inventory: c.sells ? Object.fromEntries((SHOP_STOCK[c.sells] ?? []).map((k) => [k, 6])) : { bread: R() < 0.5 ? 1 : 0 },
      height: c.sex === 'f' ? 1.58 + R() * 0.1 : 1.66 + R() * 0.14,
    };
  });
  // families: a wife is called by her husband's byname in its feminine form
  const fem = (b) => !b || /^(z |of )/.test(b) ? b : b.endsWith('ý') ? b.slice(0, -1) + 'á' : b.endsWith('í') ? b : b.endsWith('a') ? b.slice(0, -1) + 'ová' : b + 'ová';
  for (const p of people) {
    let h = null;
    if (p.spouseOf) h = people.find((q) => q.role === p.spouseOf);
    if (p.spouseOfHome) h = people.find((q) => q.home === p.home && q.role === 'farmer');
    if (h) { p.spouse = h.id; h.spouse = p.id; p.byname = fem(h.byname); p.fullName = `${p.name} ${p.byname}`; }
    else if (p.sex === 'f') { p.byname = fem(p.byname); p.fullName = `${p.name} ${p.byname}`; }
  }
  for (const p of people) if (p.spouse) { const s = people.find((q) => q.id === p.spouse); if (s && !s.spouse) s.spouse = p.id; }
  // how each one looks: skin, hair (greying with age), beards, women's headwear
  const SKIN = ['#e8c4a4', '#e0b896', '#d6a882', '#d2a07c', '#c48e6a', '#b98462'];
  const HAIR = ['#3a2818', '#5a3c22', '#2a1e14', '#7a5a32', '#a0784a', '#1a1410', '#6a4020'];
  const dresses = { woman: 1, womanPoor: 1 };
  for (const p of people) {
    const R2 = rng(seed * 31 + p.idx);
    const grey = p.age > 48 ? Math.min(1, (p.age - 48) / 15) : 0;
    const base = HAIR[Math.floor(R2() * HAIR.length)];
    p.look = {
      skin: SKIN[Math.floor(R2() * SKIN.length)],
      hair: grey > 0.5 ? '#8a8478' : base,
      // beards: older men, soldiers and the rough mostly; priests shaven; boys none
      beard: p.sex === 'f' || p.role === 'priest' || p.age < 20 ? 0 : Math.min(1, Math.max(0, (p.age - 22) / 25 + (p.role === 'soldier' || p.role === 'farmer' ? 0.25 : 0) + (R2() - 0.5) * 0.6)),
      // married women cover their hair (a linen veil and wimple in town, a kerchief at farm work); girls braid it
      headwear: p.sex !== 'f' ? null : p.spouse ? (p.dress === 'woman' && p.estate === 'peasants' ? 'kerchief' : 'veil') : 'braid',
    };
    if (dresses[p.dress]) p.items.head = 'bareHead';
  }
  return people;
}

/** What someone should be doing at hour h on a given weekday (0 = Sunday). Feast days count as Sunday. */
export function scheduled(p, h, wd, feast = false) {
  let table = R_[p.routine] ?? R_.craft;
  if ((wd === 0 || feast) && !['soldierDay', 'soldierNight', 'innkeeper', 'maid', 'herald', 'beggar', 'burgrave'].includes(p.routine)) table = SUNDAY;
  let cur = table[0];
  for (const e of table) if (h >= e[0]) cur = e;
  let place = cur[1];
  if (place === 'home') place = p.home;
  if (place === 'work') place = p.work;
  return { place, act: cur[2] };
}

export { R_ as ROUTINES, describe };

/**
 * One of the player's own kin, living in the household: an elder brother
 * who will take over the holding or the trade, a younger sister at home.
 * Same shape as the townsfolk, so they live their days like everyone else.
 */
export function makeKin(head, { sex, age, rel }, idx, seed = 1403, givenName = null) {
  const R = rng(seed * 7 + idx * 13);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const tr = traits(R);
  const dress = sex === 'f' ? (head?.estate === 'peasants' ? 'womanPoor' : 'woman') : head?.dress === 'burgher' ? 'townsman' : head?.dress === 'noble' ? 'townsman' : head?.estate === 'towns' ? 'townsman' : 'peasant';
  const d = DRESS[dress];
  const routine = sex === 'f' ? (head?.estate === 'peasants' ? 'wife' : 'townwife') : head?.routine === 'farmer' || head?.routine === 'farmerTavern' ? 'farmer' : head?.routine === 'merchant' ? 'labourer' : 'craft';
  const byname = head?.byname ?? '';
  const fem = (b) => !b || /^(z |of )/.test(b) ? b : b.endsWith('ý') ? b.slice(0, -1) + 'á' : b.endsWith('í') ? b : b.endsWith('a') ? b.slice(0, -1) + 'ová' : b + 'ová';
  const name = givenName ?? pick(sex === 'f' ? WOMEN : MEN);
  const nb = sex === 'f' ? fem(byname) : byname;
  const what = head ? `${{ farmer: 'farmer', merchant: 'cloth merchant' }[head.role] ?? head.role}'s ${sex === 'f' ? 'daughter' : 'son'}` : sex === 'f' ? 'a young woman' : 'a young man';
  const p = {
    id: 'k' + idx, idx, role: sex === 'f' ? 'daughter' : 'son', name, byname: nb, fullName: `${name} ${nb}`.trim(), sex, age,
    rank: head?.rank ?? 'podruh', estate: head?.estate ?? 'peasants', trade: head?.trade ?? null, title: `${what} (your ${rel})`, home: head?.home, work: sex === 'f' ? 'home' : head?.work ?? 'fields',
    routine, traits: tr, words: describe(tr), dress, colors: { ...d.colors }, items: { ...d.items }, hat: 0,
    armed: false, watch: false, recruiter: false, jousts: false, sells: null, money: Math.round(20 + 60 * R()),
    attitude: 30 + Math.round((tr.agreeableness - 0.5) * 40), memories: [], mood: 'calm', alive: true, hurt: 0, follow: null,
    inventory: { bread: 1 }, height: sex === 'f' ? 1.56 + R() * 0.08 : 1.68 + R() * 0.12, kin: `your ${rel}`, rel,
    look: { skin: head?.look?.skin ?? '#d6a882', hair: head?.look?.hair ?? '#5a3c22', beard: sex === 'f' ? 0 : Math.max(0, (age - 22) / 25), headwear: sex === 'f' ? 'braid' : null },
  };
  if (sex === 'f') p.items.head = 'bareHead';
  return p;
}
