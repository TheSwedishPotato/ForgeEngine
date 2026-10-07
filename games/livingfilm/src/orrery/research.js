/**
 * The research: what the director must hold true about a time and place.
 *
 * The Claude inside the page cannot browse the web. So the four stories
 * that come with the film carry period notes researched on the web when
 * the film was made (sources listed with each), and every story, your own
 * included, gets a dossier that Claude writes at the start from what it
 * knows: coin and prices, law, faith, speech, dress, food, work, the
 * powers of the day and what everyone is talking about. New places add
 * their own entries as the story reaches them. All of it is kept in the
 * Codex and read before every scene.
 */

export const PACKS = {
  kutna: {
    title: 'Kutná Hora, winter 1402–1403',
    facts: [
      'In March 1402 Sigismund of Luxembourg, King of Hungary, took his half-brother King Wenceslas IV of Bohemia prisoner; from August Wenceslas was held in Vienna. In December Sigismund marched against the towns still loyal to Wenceslas, with Hungarian troops, Cumans and Czech allies, gathering near Kolín.',
      'Between December 1402 and January 1403 he took Kutná Hora after bloody fighting; the townsmen had defended it hard. The defenders were made to march to Kolín and kneel in submission. Soldiers are quartered on the burghers; property and kin have been lost; loyalties are dangerous to speak aloud.',
      'Kutná Hora is the silver town of the Bohemian crown, after Prague the richest and most important town in the kingdom. Its mines once gave a large share of Europe\'s silver. The royal mint sits in the Italian Court (Vlašský dvůr), named for the Florentine experts Wenceslas II brought in for his coin reform of 1300; the same king\'s mining code, the Ius Regale Montanorum, made silver a royal monopoly and set all minting here.',
      'The town is German-speaking in its government and its rich mining families, Czech in much of its labour; German miners came already at the end of the thirteenth century.',
      'Money: the Prague groschen (pražský groš), silver, struck here since 1300, is the coin of all Central Europe; small change is in heller (haléř) and parvus. A skilled craftsman or a hired soldier earns about a groschen a day; a day labourer about nine groschen a week with his food, sixteen without.',
      'Prices for scale (Saxony, later fifteenth century; Bohemia a little different): good working shoes 3 groschen, a whole sheep 4, a fat hen half a groschen, an ell of good homespun cloth 5, a bushel of rye 6 or 7, a wagon of firewood delivered 5.',
      'Winter: frozen ruts, short days, the bells of the hours, smoke from every chimney, wood dear, the mines worked by lamp. February is Lent coming: no meat on fast days, fish and peas and beer.',
    ],
    speech: 'Address by estate: a lord is "milostivý pane", a burgher "pane", a craftsman by trade or name, a priest "otče". Oaths by God, the Virgin, St Wenceslas, St Barbara (patron of miners). Plain, earthy, careful about whose side you are on.',
    sources: ['https://en.wikipedia.org/wiki/Conquest_of_Kutn%C3%A1_Hora', 'https://www.e-stredovek.cz/en/post/second-captivity-wenceslaus-iv', 'https://en.wikipedia.org/wiki/Italian_Court', 'https://en.wikipedia.org/wiki/Kutn%C3%A1_Hora', 'https://en.wikipedia.org/wiki/Prague_groschen'],
  },
  venice: {
    title: 'Murano and Venice, 1499',
    facts: [
      'The glassmakers were moved to Murano and their secrets are the Republic\'s property. A glassworker may not leave Venetian lands; one who leaves is ordered home, his family can be imprisoned if he does not come, and in the end an assassin may be sent. Selling the secrets abroad can be punished by death.',
      'The guild\'s rules: the old capitulary of 1271 was replaced by a new mariegola approved in October 1441; since 1490 the glassmakers\' guild has been under the Council of Ten.',
      'Cristallo, the clear colourless glass, was developed by Angelo Barovier around 1450–1455 (he died in 1460); the Barovier have worked on Murano since at least 1324. Cristallo is the pride and the jealously kept secret of the island.',
      'War with the Ottomans (1499–1503): in August 1499 the fleets met off Zonchio (Navarino) on the 12th, 20th, 22nd and 25th, the first sea battle fought with guns on ships, and it went badly for Venice. News comes by galley and is argued over on every quay.',
      'Money: the gold ducat is worth about 6 lire 4 soldi (124 soldi) since about 1470; a lira is 20 soldi, a soldo 12 denari (piccoli). Wages and prices are reckoned in lire and soldi, great sums in ducats.',
      'Furnaces burn day and night in the working season and stop in the summer heat; fire is the great danger, which is why the furnaces were sent across the water. The island has its own podestà, its own Libro d\'Oro of glassmaking families, and masters may marry their daughters into the nobility.',
    ],
    speech: 'Venetian, not Tuscan: sior and siora for respectable people, "Messer" for a gentleman, "Vostra Signoria" to a patrician, "Serenissima" for the Republic; oaths by San Marco, the Madonna, San Donato of Murano. Master and apprentice, the furnace crew by rank (maestro, servente, serventin).',
    sources: ['https://en.wikipedia.org/wiki/Venetian_glass', 'https://en.wikipedia.org/wiki/Angelo_Barovier', 'https://www.newworldencyclopedia.org/entry/Turkish%E2%80%93Venetian_War_(1499%E2%80%931503)', 'https://en.wikipedia.org/wiki/Venetian_lira', 'https://en.wikipedia.org/wiki/Ducat'],
  },
  york: {
    title: 'The North Riding of Yorkshire, December 1348',
    facts: [
      'The pestilence was first reported in Dorset in the summer of 1348 and is moving north. In July 1348 Archbishop William Zouche of York warned his whole diocese of "great mortalities, pestilences and infections of the air", caused, he wrote, by the sins of men, and ordered processions every Wednesday and Friday in every parish church with the litany chanted, and a daily prayer at Mass against the plague.',
      'It reaches Yorkshire in 1349; in 1349–1350 it will carry off nearly half the people of the north. Nobody yet knows what it is or how it spreads. In December 1348 the village has only rumour, the archbishop\'s orders and the roads from the south.',
      'Money: pounds, shillings and pence (12d a shilling, 20s a pound); the silver penny is the coin, halfpennies and farthings for small change. A labourer earns about 1–2d a day (about £2 a year); good ale 1½d a gallon, middling 1d, poor ¾d; a fat ox 6s 8d, a sheep about 17d, a pig about 2s, a cow 6–9s; wheat about 2s a quarter in a good year.',
      'The manor: the lord\'s steward and bailiff above, the reeve chosen from the villeins to run the work and keep the account, tallies of notched hazel for what is owed and paid. Villeins owe week-work and boon-work, heriot at death, merchet to marry a daughter. The parish priest, the manor court, the open fields in strips, the common.',
      'December: Advent fasting, then the twelve days of Christmas with the lord\'s feast for his tenants; ploughing done, pigs killed at Martinmas and salted, short grey days, mud and frost, fuel the great worry.',
    ],
    speech: 'Northern English of the time rendered in plain modern words with northern shape: "aye", "nay", thou and thee among equals and to inferiors, "you" to betters; my lord, master, goodman and goodwife, sir for a priest. Oaths by God\'s bones, by the rood, by St Cuthbert and St William of York.',
    sources: ['https://medievalhollywood.ace.fordham.edu/items/show/73', 'https://en.wikipedia.org/wiki/William_Zouche', 'https://englishlocalhistory.org/wp/2024/09/28/york-and-the-north-the-black-death-1349-1373', 'https://en.wikipedia.org/wiki/Statute_of_Labourers_1351', 'https://www.historyhit.com/money-in-medieval-england/'],
  },
  florence: {
    title: 'Florence, 1478',
    facts: [
      'On Sunday 26 April 1478, at High Mass in the cathedral, the Pazzi and their allies tried to murder Lorenzo de\' Medici and his brother Giuliano. Giuliano was killed; Lorenzo, wounded, escaped into the sacristy. The city rose for the Medici: up to seventy conspirators and suspects were killed, some hanged from the windows of the Palazzo della Signoria, among them Archbishop Francesco Salviati of Pisa.',
      'The Pazzi were banished and their goods confiscated; their name and arms were suppressed for ever by the Signoria. The Pope, Sixtus IV, whose nephew stood behind the plot, excommunicated Lorenzo and laid Florence under interdict; Naples and the Papacy made war on the city.',
      'Later that year plague returned; by Christmas, with war, plague and excommunication, a diarist wrote that people lived in dread, no one had the heart to work, and the poor could get little silk or wool to work, so that all classes suffered.',
      'Money: the gold florin for great sums, worth some 5 to 6 lire in these years (seven by 1500); daily life in lire, soldi and denari di piccioli (20 soldi a lira, 12 denari a soldo). An unskilled labourer earned around 4½ soldi a day in the fifteenth century, a skilled man around 10. Bread follows the price of grain, which follows the harvest.',
      'The city of the wool and silk guilds (Arte della Lana, Por Santa Maria), the bankers, the workshops of painters and sculptors; the poorest are the wool carders and combers, the ciompi, without a guild of their own since their revolt of 1378 failed.',
    ],
    speech: 'Tuscan: Messer for a knight or a lawyer, Ser for a notary, Monna for a married woman, maestro for a master craftsman; "Magnifico" for Lorenzo. Oaths by God, the Virgin, St John the Baptist, the city\'s patron. Quick, ironic, proud of the city, careful now about who is listening.',
    sources: ['https://en.wikipedia.org/wiki/Pazzi_conspiracy', 'https://en.wikipedia.org/wiki/Pazzi', 'https://www.italianartsociety.org/2018/12/the-nightmare-before-christmas-florence-december-1478/', 'https://en.wikipedia.org/wiki/Ciompi_Revolt', 'https://numismatics.org/pocketchange/florin'],
  },
};

/** The prompt for a story's dossier: what the director must know before the first scene. */
export function dossierPrompt(premise, pack) {
  return `You are a careful historian preparing the period notes a film director keeps on the desk. The film: ${premise}

${pack ? `Notes already researched (keep them, correct nothing unless you are sure):\n${pack.facts.map((f) => '- ' + f).join('\n')}\n` : ''}
Write what a director must hold TRUE about this exact time and place, concretely, with numbers and names where you are confident, and saying "uncertain" where you are not (never invent a date, a name or a price you do not know). If the story is not historical, write the same notes for its world from the premise.

Reply with ONLY JSON:
{"title": "<place, date>", "entries": [{"topic": "<one of: power, law, money, prices, work, faith, speech, dress, food, homes, health, travel, news, calendar, dangers>", "text": "<2 to 4 sentences of fact>"}] (12 to 16 entries, every topic covered once)}`;
}

/** The prompt for one new place the story reaches: its notes for the Codex. */
export function placeNotePrompt(state, place) {
  return `A film set in: ${state.premise}
The story has just reached: ${place.name} (${place.type}${place.style ? ', ' + place.style : ''}).
In 3 to 5 sentences, what would really be in such a place at that time: who is there and doing what, what it looks, sounds and smells like, what it costs, what is forbidden or customary there. Facts only, "uncertain" where unsure.
Reply with ONLY JSON: {"topic": "${place.name}", "text": "..."}`;
}
