/**
 * Who was who in the Kingdom of Bohemia in 1403: the estates, their ranks,
 * what each could do, wore and carried. The data that the town, its people
 * and their AI will be built on, and that the codex prints.
 *
 * Every entry says how sure we are: 'attested' (named in sources of the
 * period), 'later' (the term or rule is documented later and projected
 * back, said so), or 'general' (common to Central Europe, not specific to
 * Bohemia). Ranks are ordered from the top; `rank` is a coarse precedence
 * used for seating, greeting and who gives way in the street.
 */

export const SOCIETY_SOURCES = {
  kingdom: { short: 'Kingdom of Bohemia', text: 'An overview of the kingdom under the Luxembourgs: the king, the great offices, Prague as an imperial capital under Charles IV (r. 1346–78) and Wenceslas IV (r. 1378–1419).', url: 'https://en.wikipedia.org/wiki/Kingdom_of_Bohemia' },
  diet: { short: 'The Bohemian Diet', text: 'The estates of the realm met in the land diet. By the end of the Hussite wars three estates sat there: lords, knights and the royal towns. In 1403 the clergy, under the archbishop of Prague, were still a power in the land as well.', url: 'https://en.wikipedia.org/wiki/Bohemian_Diet' },
  zeman: { short: 'Zeman and vladyka', text: 'Zeman (also vladyka): a member of the lower nobility who lived on a rural estate and lived from managing it, or from service in estate administration, rather than primarily as a warrior. Both ranked below a knight. In Bohemia "vladyka" became the more common name for the estate.', url: 'https://kingdom-come-deliverance.fandom.com/wiki/Zeman' },
  oldTown: { short: 'Prague Old Town', text: 'From 1287 the Old Town of Prague was ruled by a burgomaster and twelve aldermen, with its own court. Craftsmen entered the council in 1350–52 with the support of Charles IV. The councillors bought a patrician house for their town hall in 1338.', url: 'https://en.wikipedia.org/wiki/Old_Town_(Prague)' },
  serfdom: { short: 'Village strata (Klein et al.)', text: 'Under serfdom the village had three official strata: the peasant with a full holding (sedlák), the smallholder (zahradník) and the cottager (chalupník). Lodgers (podruh) lived in their households. The detailed lists are early modern; the strata themselves are older.', url: 'https://inlist.cz/wp-content/uploads/2019/07/BARTON-Czech-Lands.pdf' },
  wenzelBible: { short: 'Wenceslas Bible (1390s)', text: 'The Wenceslas Bible (Vienna, ÖNB Cod. 2759–64), Prague 1390s: the best pictures of Bohemian dress, from the king and his bath-maids to craftsmen and peasants.', url: 'https://en.wikipedia.org/wiki/Wenceslas_Bible' },
  defenestration: { short: 'The New Town council, 1419', text: 'In 1419 Hussites threw a judge, the burgomaster and members of the council of Prague\'s New Town from the town hall windows. The town council is a well-recorded office.', url: 'https://en.wikipedia.org/wiki/First_Defenestration_of_Prague' },
};

/**
 * The estates. Each: name (English, Czech, German), rank (precedence),
 * members (ranks within), rights, duties, dress, arms, sureness, sources.
 */
export const ESTATES = [
  {
    id: 'crown', name: 'The king and his court', cz: 'král a dvůr', de: 'König und Hof', rank: 100, sureness: 'attested', sources: ['kingdom'],
    text: 'Wenceslas IV, King of the Romans until his deposition in 1400 and King of Bohemia. In 1403 he was a prisoner of his brother Sigismund, held in Vienna; the kingdom was torn between the king\'s party, the league of lords and Sigismund\'s Hungarians.',
    members: [
      { id: 'king', name: 'King', cz: 'král', rank: 100, note: 'Wenceslas IV (Václav IV.), r. 1378–1419.' },
      { id: 'queen', name: 'Queen', cz: 'královna', rank: 98, note: 'Sophia of Bavaria, queen from 1389.' },
      { id: 'burgrave', name: 'Supreme Burgrave of Prague', cz: 'nejvyšší purkrabí', rank: 92, note: 'The first officer of the land: Prague Castle and the land\'s peace.' },
      { id: 'subchamberlain', name: 'Sub-chamberlain', cz: 'podkomoří', rank: 80, note: 'The royal officer over the royal towns and what they owe the king.' },
      { id: 'courtier', name: 'Courtier, familiaris', cz: 'dvořan', rank: 70, note: 'Men of the king\'s household, often of low birth, raised by favour, a grievance of the great lords.' },
    ],
  },
  {
    id: 'lords', name: 'The lords', cz: 'páni (panský stav)', de: 'Herren', rank: 90, sureness: 'attested', sources: ['diet', 'kingdom'],
    text: 'The great families (Rožmberk, Hradec, Lichtenburk, Šternberk, Michalovice, Kolovrat...), with castles, towns and many villages. They sat in the land court and the diet and filled the great offices. In 1394 and again in 1400–02 many of them leagued against the king.',
    rights: ['seat in the land court and diet', 'hold the great offices of the land', 'private castles and retinues', 'high justice over their subjects'],
    duties: ['military service to the king with their retinues', 'keeping the land\'s peace'],
    dress: 'Long houppelande or short tight jacket (jaque) in silk and wool of strong colours, dagged sleeves, hoods and chaperons, gold belts and collars, pointed shoes. Harness for war and the lists: plate and mail of the latest Italian and German fashion.',
    arms: ['longsword and riding sword', 'lance', 'dagger (rondel, baselard)', 'war hammer or mace on horseback'],
    members: [
      { id: 'magnate', name: 'Great lord', cz: 'velmož', rank: 90, note: 'Head of a great house, e.g. Jindřich III of Rožmberk (d. 1412).' },
      { id: 'lord', name: 'Lord', cz: 'pán', rank: 85, note: 'A member of a lordly house.' },
    ],
  },
  {
    id: 'knights', name: 'Knights and lower nobility', cz: 'rytířstvo, vladykové, zemané', de: 'Ritter und Knappen', rank: 70, sureness: 'attested', sources: ['diet', 'zeman'],
    text: 'Knights (rytíři) and the far larger number of lower nobles, the vladykové or zemané, who held a manor (tvrz, a fortified house) and a village or two. Many served the lords or the king as captains, burgraves and officials, or sold their swords. Squires (panoši) were the young or unknighted of this estate.',
    rights: ['free status and own land (zboží)', 'seat in the land court (the lesser bench)', 'bear arms and coats of arms'],
    duties: ['ride to war when the land is summoned', 'serve their lords'],
    dress: 'Like the lords but plainer: short padded jackets, hose, hoods; harness of plate and mail for war, often older pieces handed down.',
    arms: ['sword', 'lance', 'dagger', 'crossbow at home'],
    members: [
      { id: 'knight', name: 'Knight', cz: 'rytíř', rank: 72, note: 'Dubbed: the belt and spurs.' },
      { id: 'squire', name: 'Squire', cz: 'panoš', rank: 66, note: 'Of knightly family, not (yet) dubbed.' },
      { id: 'zeman', name: 'Yeoman-noble', cz: 'zeman, vladyka', rank: 64, note: 'Lives off his land; ranks below a knight.' },
      { id: 'burgraveCastle', name: 'Castellan', cz: 'purkrabí', rank: 62, note: 'Holds a castle for its lord.' },
    ],
  },
  {
    id: 'clergy', name: 'The clergy', cz: 'duchovenstvo', de: 'Geistlichkeit', rank: 80, sureness: 'attested', sources: ['kingdom'],
    text: 'The archbishop of Prague (since 1344) and the bishop of Olomouc, the chapters, the rich monasteries (Zbraslav, Břevnov, Sedlec, Vyšší Brod), the friars, the university masters (Prague university, 1348), and the parish priests. In 1403 the university masters debated Wyclif; Jan Hus was preaching at the Bethlehem Chapel.',
    rights: ['own courts for clerics', 'tithes and church lands', 'exemption from lay taxes (contested)'],
    duties: ['the sacraments, the hours, schooling and charity'],
    dress: 'Cassock and surplice for priests, the habits of the orders (Benedictine black, Cistercian white, Franciscan grey-brown), the doctors\' gowns and caps of the university.',
    arms: ['none by right; travelling priests carried a knife or staff'],
    members: [
      { id: 'archbishop', name: 'Archbishop of Prague', cz: 'arcibiskup pražský', rank: 95, note: 'Zbyněk Zajíc of Hazmburk from 1403.' },
      { id: 'abbot', name: 'Abbot', cz: 'opat', rank: 78, note: 'Head of a monastery and often its lands.' },
      { id: 'canon', name: 'Canon', cz: 'kanovník', rank: 70, note: 'Member of a cathedral chapter.' },
      { id: 'master', name: 'University master', cz: 'mistr', rank: 60, note: 'Master of arts or doctor of the university.' },
      { id: 'priest', name: 'Parish priest', cz: 'farář, kněz', rank: 50, note: 'The village or town parish.' },
      { id: 'friar', name: 'Friar', cz: 'mnich, bratr', rank: 40, note: 'Franciscans, Dominicans, preaching in the towns.' },
    ],
  },
  {
    id: 'towns', name: 'Burghers of the royal towns', cz: 'měšťané', de: 'Bürger', rank: 55, sureness: 'attested', sources: ['oldTown', 'defenestration'],
    text: 'The royal towns (Prague\'s Old and New Towns, Kutná Hora, Plzeň, České Budějovice...) were the king\'s, ruled by their councils under royal oversight. Prague had well over 40,000 souls in 1378. The richest burghers were merchants and patricians, often German-speaking; Czech craftsmen were rising.',
    rights: ['town law (Magdeburg or Nuremberg law)', 'markets and staple', 'guild monopolies', 'own courts'],
    duties: ['royal taxes and loans', 'walls and watch', 'militia service'],
    dress: 'Patricians as rich as lords but without their arms; craftsmen in wool tunics, hoods and aprons. Sumptuary rules were tried, rarely kept.',
    arms: ['town militia: crossbow, pavise, halberd and flail, kettle hat and gambeson', 'a knife or messer for every man'],
    members: [
      { id: 'reeve', name: 'Royal reeve', cz: 'královský rychtář', rank: 62, note: 'The king\'s judge in the town.' },
      { id: 'burgomaster', name: 'Burgomaster', cz: 'purkmistr', rank: 60, note: 'Head of the council, chosen from the aldermen in turn.' },
      { id: 'alderman', name: 'Alderman', cz: 'konšel', rank: 58, note: 'One of twelve councillors in Prague\'s Old Town (from 1287).' },
      { id: 'patrician', name: 'Patrician merchant', cz: 'patricij, kupec', rank: 55, note: 'Long-distance trade: cloth, wine, salt, silver.' },
      { id: 'guildmaster', name: 'Guild master', cz: 'cechmistr', rank: 50, note: 'Elder of a craft guild (cech).' },
      { id: 'mastercraft', name: 'Master craftsman', cz: 'mistr řemesla', rank: 46, note: 'Owns the workshop; armourers, swordsmiths, bakers, butchers, brewers.' },
      { id: 'journeyman', name: 'Journeyman', cz: 'tovaryš', rank: 36, note: 'Trained, works for wages, may wander between towns.' },
      { id: 'apprentice', name: 'Apprentice', cz: 'učedník', rank: 28, note: 'Learns the craft in the master\'s house.' },
      { id: 'servant', name: 'Servant, day labourer', cz: 'čeledín, nádeník', rank: 22, note: 'No citizenship; carriers, maids, labourers.' },
    ],
  },
  {
    id: 'jews', name: 'The Jews of Prague', cz: 'Židé', de: 'Juden', rank: 30, sureness: 'attested', sources: ['kingdom'],
    text: 'The Jewish Town of Prague lived under the king\'s protection as "servants of the royal chamber" (servi camerae), paying heavily for it, under its own elders and law. It had suffered the massacre of Easter 1389.',
    rights: ['royal protection', 'own community, synagogue (the Old-New Synagogue), courts'],
    duties: ['special taxes to the king'],
    dress: 'Distinguishing dress was required by church councils (the pointed hat, a badge); how strictly in Prague in 1403 is uncertain.',
    arms: ['restricted'],
    members: [
      { id: 'elder', name: 'Elder of the community', cz: 'starší', rank: 34, note: '' },
      { id: 'merchant', name: 'Merchant, moneylender', cz: 'kupec', rank: 30, note: '' },
    ],
  },
  {
    id: 'peasants', name: 'Peasants and villagers', cz: 'sedláci, poddaní', de: 'Bauern', rank: 20, sureness: 'later', sources: ['serfdom', 'wenzelBible'],
    text: 'Most people in the kingdom. Subjects (poddaní) of a lord, a church or the king, owing rent in coin and kind, some labour, and obedience to the lord\'s court. Villages founded under German law had hereditary tenures and a rychtář with a free farm. The finer strata below are recorded in detail later, but the distinction of full farms, smallholdings and cottages is medieval.',
    rights: ['hereditary tenure on emphyteutic land', 'village court under the rychtář', 'leave the land with the lord\'s consent (narrowing after 1400)'],
    duties: ['rent (úrok), tithes, labour (robota), carting, gifts at feasts'],
    dress: 'Undyed or earth-coloured wool: short tunic, hose, hood, a straw hat in summer, women\'s linen headcloths; leather shoes or bast.',
    arms: ['knife, axe, flail; a spear or crossbow in the land\'s defence', 'war flails and wagons, made famous by the Hussites after 1419'],
    members: [
      { id: 'rychtar', name: 'Village headman', cz: 'rychtář', rank: 30, note: 'Heads the village court, collects the rent; often a free hereditary farm.' },
      { id: 'sedlak', name: 'Farmer with a full holding', cz: 'sedlák', rank: 24, note: 'A lán (hide) of land, a team of horses or oxen.' },
      { id: 'zahradnik', name: 'Smallholder', cz: 'zahradník', rank: 18, note: 'Some land, not enough to live from; works for others.' },
      { id: 'chalupnik', name: 'Cottager', cz: 'chalupník', rank: 14, note: 'A cottage and garden.' },
      { id: 'podruh', name: 'Lodger', cz: 'podruh', rank: 10, note: 'Lives in another\'s household, works for keep.' },
      { id: 'miller', name: 'Miller', cz: 'mlynář', rank: 26, note: 'Rich, distrusted, central to every village.' },
      { id: 'innkeeper', name: 'Innkeeper', cz: 'krčmář', rank: 22, note: '' },
      { id: 'smith', name: 'Village smith', cz: 'kovář', rank: 22, note: '' },
    ],
  },
  {
    id: 'margins', name: 'Outside the estates', cz: 'lidé na okraji', de: 'Randgruppen', rank: 5, sureness: 'general', sources: ['kingdom'],
    text: 'Those whom the orders had no place for: soldiers between wars, robbers in the woods (the troubles of 1400–03 bred many), wandering players, beggars, the executioner and his men, bath-house keepers (despised, yet the king favoured them), prostitutes in the towns\' licensed houses.',
    members: [
      { id: 'mercenary', name: 'Mercenary', cz: 'žoldnéř', rank: 20, note: '' },
      { id: 'robber', name: 'Robber knight or highwayman', cz: 'loupežník', rank: 4, note: '' },
      { id: 'bathkeeper', name: 'Bath-house keeper', cz: 'lazebník', rank: 12, note: 'A trade made honourable by Wenceslas IV, the story goes.' },
      { id: 'executioner', name: 'Executioner', cz: 'kat', rank: 3, note: '' },
      { id: 'beggar', name: 'Beggar', cz: 'žebrák', rank: 2, note: '' },
    ],
  },
];

/** Who gives way to whom: + if a outranks b. */
export function precedence(a, b) {
  const r = (id) => ESTATES.flatMap((e) => e.members.map((m) => ({ ...m, estate: e.id }))).find((m) => m.id === id)?.rank ?? 0;
  return r(a) - r(b);
}

/** All ranks, flat, top first. */
export function allRanks() {
  return ESTATES.flatMap((e) => e.members.map((m) => ({ ...m, estate: e.id, estateName: e.name }))).sort((x, y) => y.rank - x.rank);
}
