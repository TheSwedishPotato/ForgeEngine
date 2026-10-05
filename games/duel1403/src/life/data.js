/**
 * Life in Skalice, autumn 1403: money, prices, wages, laws, military ranks,
 * the hours of the day, and who you can start as.
 *
 * Every figure says how sure it is:
 *   'attested'  from a source of the period or a historian's figure for Bohemia
 *   'general'   common to Central European towns of the time
 *   'estimate'  the game's own reasoned figure, where no source gives one
 */

export const LIFE_SOURCES = {
  coins: { short: 'Bohemian money c. 1400', text: '1 Prague groschen = 12 parvi (small pennies); 60 groschen = 1 kopa (a "threescore", the unit of account); a gold ducat was about 16 groschen. A half-pound loaf cost 4 parvi; a bricklayer earned about 1 groschen a day and a master mason 2–3. Under Wenceslas IV the groschen was debased four times: by 1403 it held about 1.75 g of silver, under half its first weight.', url: 'https://www.lovecpokladu.cz/en/home/prices-from-the-14th-century-681' },
  groschen: { short: 'Prague groschen', text: 'Struck at Kutná Hora from 1300, the common silver coin of Central Europe.', url: 'https://en.wikipedia.org/wiki/Prague_groschen' },
  hours: { short: 'Bells and hours', text: 'The day ran by church bells: a morning bell before dawn, the canonical hours (prime about 6, terce 9, sext noon, none 3, vespers at sunset), and an evening curfew bell at about 8 or 9 after which smiths, brewers and taverns stopped. Shops opened about 6; markets were busiest in the morning.', url: 'https://www.medievalists.net/2026/06/bell-tower-medieval/' },
  meals: { short: 'Meals', text: 'Working people ate two meals a day, dinner at midday and supper in the evening, perhaps with a snack: bread, pottage of peas, beans, cabbage and grain, and weak ale or beer for all ages.', url: 'https://brewminate.com/medieval-peasant-serf-food-diet/' },
  privies: { short: 'Privies and cesspits', text: 'In towns the well-off had privies in the yard or the house draining to a cesspit; peasants used a cesspit whose contents went onto the fields. Towns had ordinances on waste, cesspits and privies; Prague\'s Old Town has many excavated cesspits.', url: 'https://www.medievalists.net/2021/11/toilet-medieval/' },
  weapons: { short: 'Weapons in towns', text: 'Many towns restricted carrying swords and long knives, especially at night; Nuremberg forbade residents to carry swords at all on pain of a fine and loss of the weapon; German codes of the 14th–15th c. banned the baselard inside cities; fines doubled for weapons in taverns, which innkeepers had to enforce.', url: 'https://www.bookandsword.com/2023/09/16/bearing-swords-in-the-later-middle-ages/' },
  reconciliation: { short: 'Reconciliation crosses (smír)', text: 'Bohemian law allowed a killing to be settled by reconciliation (smír) with the victim\'s kin: payment to the family, Masses, pilgrimage, and often a stone cross set up where the deed was done. Hundreds of such crosses survive.', url: 'https://cs.wikipedia.org/wiki/Sm%C3%ADr%C4%8D%C3%AD_k%C5%99%C3%AD%C5%BE' },
  warfare: { short: 'Warfare around 1400', text: 'A "lance" was a heavy horseman (usually noble), a lighter horseman (often a squire) and a servant. Infantry came from town and rural levies, the lower members of noble retinues and castle garrisons, and mercenary bands; crossbowmen behind pavises were the strength of the foot. Royal captains (hejtman) such as Racek Kobyla of Dvorce held castles for Wenceslas IV.', url: 'https://www.wulflund.com/tema/kingdom-come-deliverance/warfare-around-1400' },
  infantry: { short: 'Bohemian infantry c. 1400 (Heath)', text: 'After the Wenceslas Bible: thick quilted coats, kettle hats with brow ridges, bascinets, pavises, crossbows, flails and polearms. Prague called out its citizens two town quarters at a time (1371).', url: 'https://warfare.x10host.com/WRG/Middle_Ages_2-121-Bohemian_Infantry-c1400.htm' },
  names: { short: 'Czech names', text: 'In the 14th century saints\' names spread: Jan was by far the commonest man\'s name (15–27 %), with Petr, Mikuláš, Tomáš, Matěj, Marek; women were most often Kateřina, Anna, Dorota, Markéta, Alžběta, Klára, Ludmila, Magdaléna, Barbora.', url: 'https://heraldry.sca.org/names/lateczech.html' },
  year1403: { short: 'The year 1403', text: 'King Wenceslas IV was a prisoner of his brother Sigismund in Vienna from 1402 until he escaped in November 1403; Sigismund\'s Hungarians, with Cumans, raided Bohemia; the lords\' leagues and robber bands made the roads unsafe.', url: 'https://www.wulflund.com/tema/kingdom-come-deliverance/bohemian-kingdom-around-1400-amidst-disorder-tricks-insecurity-and-war' },
};

// ---- money ------------------------------------------------------------------------------
/** All money is counted in parvi (small pennies); 12 make a groschen. */
export const PARVI_PER_GROSCHEN = 12;
export function fmtMoney(parvi) {
  const g = Math.floor(parvi / 12), p = parvi % 12;
  if (g >= 60) return `${Math.floor(g / 60)} kopa ${g % 60} gr`;
  return g ? `${g} gr${p ? ` ${p} p` : ''}` : `${p} p`;
}

/** Goods and services, in parvi. */
export const GOODS = {
  bread: { name: 'Half-pound loaf of rye bread', price: 4, sureness: 'attested', food: 22, kind: 'food' },
  pottage: { name: 'Bowl of pottage (peas, cabbage, grain)', price: 3, sureness: 'estimate', food: 30, water: 5, kind: 'food' },
  meat: { name: 'Piece of boiled pork', price: 8, sureness: 'estimate', food: 35, kind: 'food', fastBreak: true },
  beer: { name: 'Mug of beer', price: 1, sureness: 'estimate', water: 30, food: 4, kind: 'drink', drunk: 8 },
  wine: { name: 'Cup of wine', price: 4, sureness: 'estimate', water: 18, kind: 'drink', drunk: 14 },
  bed: { name: 'A place to sleep in the tavern\'s loft', price: 3, sureness: 'estimate', kind: 'service' },
  bath: { name: 'A bath, with soap and a scrub', price: 2, sureness: 'estimate', kind: 'service' },
  shoes: { name: 'Pair of turnshoes', price: 36, sureness: 'estimate', kind: 'item' },
  knife: { name: 'Knife', price: 18, sureness: 'estimate', kind: 'item' },
  hood: { name: 'Wool hood', price: 30, sureness: 'estimate', kind: 'item' },
};
/** Who sells what, by building. */
export const SHOPS = {
  tavern: ['beer', 'wine', 'pottage', 'meat', 'bread', 'bed'],
  bakery: ['bread'],
  butcher: ['meat'],
  bath: ['bath'],
  cobbler: ['shoes'],
  smithy: ['knife'],
  weaver: ['hood'],
};
/** Day wages, parvi. */
export const WAGES = {
  labourer: { pay: 12, sureness: 'attested', text: 'unskilled labour, about 1 groschen a day' },
  journeyman: { pay: 20, sureness: 'attested', text: 'a skilled man, about 2 groschen' },
  master: { pay: 30, sureness: 'attested', text: 'a master mason, 2–3 groschen' },
};

// ---- the day -----------------------------------------------------------------------------
/** The game starts on the eve of St Wenceslas, 27 September 1403, at the morning bell. */
export const START_DATE = { y: 1403, m: 9, d: 27, h: 5.5 };
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Julian calendar weekday (Zeller), as in use in 1403. */
export function weekday(y, m, d) {
  if (m < 3) { m += 12; y -= 1; }
  const K = y % 100, J = Math.floor(y / 100);
  const h = (d + Math.floor(13 * (m + 1) / 5) + K + Math.floor(K / 4) + 5 + 6 * J) % 7;   // Julian
  return (h + 6) % 7;   // 0 = Sunday
}
export function dateText(t) {
  const day = Math.floor(t / 24), h = t - day * 24;
  const date = new Date(Date.UTC(START_DATE.y, START_DATE.m - 1, START_DATE.d + day));
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return { y, m, d, h, wd: weekday(y, m, d), text: `${DAY_NAMES[weekday(y, m, d)]} ${d} ${MONTHS[m]} ${y}`, clock: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
}
/** Bells: what rings when (hour of day). Sunrise in late September at 50°N is about 5:50, sunset about 17:45. */
export const BELLS = [
  { h: 5.0, name: 'the morning bell (Ave)', text: 'The night watch ends; the gates open.' },
  { h: 6.0, name: 'prime', text: 'Shops open.' },
  { h: 12.0, name: 'sext, the midday bell', text: 'Dinner.' },
  { h: 17.75, name: 'vespers', text: 'Sunset; work ends.' },
  { h: 20.5, name: 'the curfew bell', text: 'Fires covered, taverns close, the gates are shut; whoever walks the streets now needs a light and a reason.' },
];
export const CURFEW = 20.5, DAWN = 5.0;

// ---- laws ----------------------------------------------------------------------------------
/**
 * The laws a man in Skalice in 1403 could fall foul of. A subject town took
 * its law from a mother town (in Bohemia, Old Town Prague's law or Magdeburg
 * law) and from its lord; the details below are the common pattern, marked
 * by sureness. Fines in parvi.
 */
export const LAWS = [
  { id: 'weapons', name: 'Bearing arms in town', text: 'No swords, long knives or baselards to be carried in town except by the lord\'s men, nobles and travellers on the road; double fine in the tavern, and the weapon forfeit.', fine: 60, forfeit: true, sureness: 'general', source: 'weapons' },
  { id: 'curfew', name: 'After the curfew bell', text: 'Whoever is in the street after the curfew bell without a light and an honest errand may be taken up by the watch and held until morning.', fine: 12, jail: 8, sureness: 'general', source: 'hours' },
  { id: 'brawl', name: 'Brawling and striking', text: 'A blow with the fist: a fine to the rychta and amends to the man struck. Drawing blood: a heavier fine, the wound money (smart money) and the barber\'s fee.', fine: 24, bloodFine: 120, sureness: 'general' },
  { id: 'theft', name: 'Theft', text: 'Petty theft: restoration twofold, the pillory and a whipping, or banishment from the town. Great theft (above about half a kopa) or theft by night: the gallows.', fine: 0, pillory: 6, hang: 360, sureness: 'general' },
  { id: 'killing', name: 'Killing a man', text: 'Unless settled by reconciliation with the dead man\'s kin (payment, Masses, pilgrimage and a stone cross where he fell), the sword.', sureness: 'attested', source: 'reconciliation' },
  { id: 'housebreaking', name: 'Entering a house uninvited', text: 'Going into a man\'s house against his will, above all at night, is a breach of the house peace, punished hard: whoever is found in a house by night may be struck down.', fine: 60, sureness: 'general' },
  { id: 'market', name: 'The market', text: 'Goods are sold at the market and in the shops of the guild masters, by the town\'s weights and measures. Buying up goods before they reach the market (forestalling), short measure and bad bread are fined, the bread forfeit.', fine: 24, sureness: 'general' },
  { id: 'sunday', name: 'Sundays and feasts', text: 'No servile work and no market on Sundays and feasts; all go to Mass. 28 September is the feast of St Wenceslas, patron of the land.', fine: 6, sureness: 'general' },
  { id: 'fasting', name: 'Fast days', text: 'No meat on Fridays, Saturdays (in many places), in Lent and on vigils; fish, peas and bread instead. The church, not the town, punishes this, with penance.', sureness: 'general' },
  { id: 'privy', name: 'Filth in the street', text: 'Emptying privies or relieving oneself in the street or square is against the town\'s ordinance; use a privy, or go out to the fields.', fine: 2, sureness: 'general', source: 'privies' },
  { id: 'gambling', name: 'Dice', text: 'Playing at dice for money is forbidden and the stakes forfeit, though it is done in every tavern.', fine: 12, sureness: 'general' },
  { id: 'insult', name: 'Insult and slander', text: 'Calling an honest man a thief or a woman a whore before witnesses: a fine and public apology, or the stocks.', fine: 12, sureness: 'general' },
];
export const LAW = Object.fromEntries(LAWS.map((l) => [l.id, l]));

// ---- the army --------------------------------------------------------------------------------
/**
 * The garrison of Skalice castle and the company its captain raises in the
 * troubles of 1403. Ranks are those of a castle garrison and retinue; the
 * pay is about a labourer's or craftsman's wage, as surviving figures
 * suggest (marked as estimates where no Bohemian figure survives).
 */
export const ARMY_RANKS = [
  { id: 'pacholek', name: 'Foot servant (pacholek)', pay: 12, text: 'You carry, dig, stand watch at the gate and fight on foot with a spear or flail, in a padded coat and kettle hat.', kit: { head: 'kettleHat', under: 'gambeson', legs: 'hose', feet: 'shoes' }, weapon: 'spear', sureness: 'estimate' },
  { id: 'strelec', name: 'Crossbowman (střelec)', pay: 18, need: { crossbow: 20, service: 4 }, text: 'Behind the pavise with a crossbow: the strength of Bohemian foot.', kit: { head: 'kettleHat', under: 'gambeson', mail: 'haubergeon', feet: 'shoes' }, weapon: 'messer', sureness: 'estimate' },
  { id: 'zbrojnos', name: 'Man-at-arms (zbrojnoš)', pay: 30, need: { sword: 35, service: 12 }, text: 'In mail and plate, with sword and buckler or a poleaxe, mounted when there are horses.', kit: { head: 'openBascinet', under: 'gambeson', mail: 'haubergeon', plate: 'brigandine', arms: 'splints', hands: 'gauntlets', feet: 'shoes' }, weapon: 'longsword', sureness: 'estimate' },
  { id: 'desetnik', name: 'Leader of ten', pay: 42, need: { sword: 45, service: 30, renown: 20 }, text: 'You answer for ten men to the captain (a game rank: the period words for small leaders vary).', sureness: 'estimate' },
  { id: 'panos', name: 'Squire (panoš)', pay: 60, need: { noble: true, sword: 50, service: 40 }, text: 'Of knightly birth and not yet dubbed: you ride in the captain\'s lance.', sureness: 'attested' },
];
export const ARMY_RANK = Object.fromEntries(ARMY_RANKS.map((r) => [r.id, r]));

// ---- who you can be -----------------------------------------------------------------------------
/** Starts. Money in parvi; skills 0–100; dress as armour items. */
export const STARTS = [
  { id: 'podruh', name: 'A lodger (podruh)', rank: 'podruh', estate: 'peasants', sex: 'any', money: 30, home: 'h9', skills: { labour: 30, sword: 5, crossbow: 5, speech: 15, trade: 5 }, dress: { head: 'hood', under: 'shirt', legs: 'hose', feet: 'shoes' }, colors: { cloth: '#6a5a40', hose: '#4a3a2a' }, text: 'You have no land and no trade, only your hands, a bed in a cottager\'s house and 2 groschen. Anything is better than this.' },
  { id: 'sedlak', name: 'A farmer\'s son', rank: 'sedlak', estate: 'peasants', sex: 'any', money: 80, home: 'h3', skills: { labour: 45, sword: 8, crossbow: 10, speech: 20, trade: 15 }, dress: { head: 'hood', under: 'shirt', legs: 'hose', feet: 'shoes' }, colors: { cloth: '#7a6a44', hose: '#5a4a32' }, text: 'Your father holds a full lán and two oxen. You are the second son: the farm goes to your brother.' },
  { id: 'tovarys', name: 'A journeyman smith', rank: 'journeyman', estate: 'towns', sex: 'male', money: 140, home: 'smithy', work: 'smithy', skills: { labour: 40, sword: 15, crossbow: 10, speech: 25, trade: 40, smithing: 45 }, dress: { head: 'armingCap', under: 'armingDoublet', legs: 'hose', feet: 'shoes' }, colors: { cloth: '#4a3a2a', hose: '#2a2a3a' }, text: 'You serve master Ondřej at the forge for wages. One day you may make your masterpiece, if the guild lets you.' },
  { id: 'burgher', name: 'A burgher\'s son', rank: 'patrician', estate: 'towns', sex: 'any', money: 480, home: 'h13', skills: { labour: 15, sword: 20, crossbow: 15, speech: 40, trade: 45, letters: 40 }, dress: { head: 'hood', under: 'armingDoublet', legs: 'hose', feet: 'shoes' }, colors: { cloth: '#1c3a6a', hose: '#7a1c1c' }, text: 'Your father trades cloth to Prague. You can read a little and reckon well, and you have never done a day\'s hard work.' },
  { id: 'panos', name: 'A squire (panoš)', rank: 'squire', estate: 'knights', sex: 'male', noble: true, money: 720, home: 'hall', skills: { labour: 15, sword: 40, crossbow: 25, speech: 35, trade: 15, riding: 45, letters: 20 }, dress: { head: 'armingCap', under: 'armingDoublet', legs: 'hose', feet: 'shoes' }, colors: { cloth: '#b0161c', hose: '#e8e2d4' }, weapon: 'longsword', text: 'Of a knightly family with more name than land, you serve in the burgrave\'s household and may wear a sword.' },
];

/** Needs: units per game hour, and what happens at the limits. 0 good, 100 bad (except health). */
export const NEEDS = {
  hunger: { rate: 3.2, name: 'Hunger' },      // empty in about 30 hours; weeks to starve
  thirst: { rate: 4.5, name: 'Thirst' },      // parched in about a day; about three days to die of it
  bladder: { rate: 11, name: 'Bladder' },
  bowels: { rate: 4, name: 'Bowels' },
  fatigue: { rate: 5.5, name: 'Tiredness' },
  dirt: { rate: 1.2, name: 'Dirt' },
};

/** Rumours people tell in autumn 1403 (true to the year). */
export const RUMOURS = [
  'The king is still Sigismund\'s prisoner in Vienna, they say, and the Hungarians do as they please on our roads.',
  'Cumans with the Hungarian army burned villages near Kutná Hora; they ride little horses and shoot from the saddle.',
  'There are robbers in the woods towards the river: a band of masterless men who were soldiers once.',
  'Master Hus preaches at the Bethlehem Chapel in Prague, in Czech, and the Germans at the university don\'t like it.',
  'Tomorrow is St Wenceslas: there will be Mass, and a fair, and the burgrave\'s men have set up the lists for a joust.',
  'The groschen isn\'t what it was. My father\'s groschen weighed twice what these do.',
  'The captain at the castle is hiring men. A groschen a day, bread and beer, and a coat to wear.',
];
