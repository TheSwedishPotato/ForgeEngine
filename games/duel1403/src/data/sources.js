/**
 * Bibliography. Every guard, technique, weapon and piece of armour in the
 * game points at one or more of these, and the in-game codex prints them.
 * Dates matter: where a source is later than 1403 the game says so.
 */
export const SOURCES = {
  hs3227a: {
    short: 'Hs. 3227a (1389)',
    text: 'Nuremberg, Germanisches Nationalmuseum, Hs. 3227a (the "Döbringer" Hausbuch), dated by its calendar to c. 1389. Earliest record of Johannes Liechtenauer\'s verses (Zettel) and their gloss: the four guards, the five master strikes, the bind and winding.',
  },
  ringeck: {
    short: 'Ringeck gloss (mid-15th c.)',
    text: 'Sigmund ain Ringeck, gloss on Liechtenauer, Dresden Mscr. C 487 (copy c. 1504–19 of a mid-15th-century text). Describes the guards, the Kampffechten in armour and the targets in harness: face, armpits, palms, hollows of the knees, between the legs. Later than 1403, but it explains the 1389 verses.',
  },
  danzig: {
    short: 'Peter von Danzig (1452)',
    text: 'Cod. 44 A 8, Rome (Peter von Danzig), 1452: Liechtenauer\'s Kampffechten glossed, and the half-sword guards of Martin Hundfeld, including the guard with the grip under the right arm and the point at the opponent.',
  },
  fiore: {
    short: 'Fiore dei Liberi (1409)',
    text: 'Fiore dei Liberi, Flos Duellatorum (Pisani Dossi MS, dated 10 February 1409) and Il Fior di Battaglia (Getty MS Ludwig XV 13, c. 1400s): wrestling, dagger, sword in one and two hands, sword in armour, poleaxe (azza), spear. A contemporary of our duel.',
  },
  i33: {
    short: 'Ms. I.33 (c. 1300)',
    text: 'Royal Armouries Ms. I.33 ("Walpurgis" Fechtbuch), Franconia, c. 1300. The oldest surviving European fight book: sword and buckler from seven wards (custodiae) — under the arm, right shoulder, left shoulder, head, right side, breast, and langort.',
  },
  leckuchner: {
    short: 'Lecküchner (1478/82)',
    text: 'Johannes Lecküchner, Kunst des Messerfechtens (Heidelberg Cpg 430, 1478; Munich Cgm 582, 1482). The Liechtenauer guards renamed for the messer: Stier (Ochs), Eber (Pflug), Bastei (Alber), Luginsland (vom Tag). The weapon was in use in 1403; the treatise is later.',
  },
  wenzelBible: {
    short: 'Wenceslas Bible (1390s)',
    text: 'The Wenceslas Bible, Prague, 1390s, made for King Wenceslas IV (Vienna, ÖNB Cod. 2759–2764): Bohemian bascinets, kettle hats with brow ridges, quilted gambesons laced down the front, mail and plate.',
  },
  heath: {
    short: 'Heath, Armies of the Middle Ages II',
    text: 'Ian Heath, Armies of the Middle Ages vol. 2 (WRG): Bohemian infantry c. 1400 after the Wenceslas Bible — thick quilted gambesons, Central European kettle hats with eyebrow ridges, bascinets.',
  },
  wallace: {
    short: 'Wallace Collection bascinet',
    text: 'Northern Italian bascinet c. 1390–1410, Wallace Collection, London: skull 2.005 kg, visor 0.820 kg, mail aventail 1.24 kg, total 4.065 kg. A Churburg bascinet with visor and aventail weighs about 5.7 kg.',
  },
  williams: {
    short: 'Williams, Knight & Blast Furnace (2003)',
    text: 'Alan Williams, The Knight and the Blast Furnace (Brill, 2003): metallurgy of ~600 armours and impact tests. Sword or axe blows deliver roughly 60–130 J; a 16-layer linen padding stops ≈80 J and a 26-layer jack ≈200 J of a cut, but only ≈50 J behind a spear point.',
  },
  askew: {
    short: 'Askew et al. (2012)',
    text: 'G. N. Askew, F. Formenti, A. E. Minetti, "Limitations imposed by wearing armour on Medieval soldiers\' locomotor performance", Proc. R. Soc. B 279 (2012) 640–644: metabolic cost 2.1–2.3× when walking and 1.9× when running in armour, mostly from swinging armoured limbs and restricted breathing.',
  },
  jaquet: {
    short: 'Jaquet et al. (2016)',
    text: 'D. Jaquet et al., "Range of motion and energy cost of locomotion of the late medieval armoured fighter", Historical Methods 49:3 (2016) 169–186: 39.8 kg of armour raised the energy cost of walking and running by 66%, while pelvis, trunk, hip and knee range of motion stayed similar.',
  },
  oakeshott: {
    short: 'Oakeshott typology',
    text: 'Ewart Oakeshott, The Sword in the Age of Chivalry (1964): Type XV/XVa stiff, acutely pointed blades of the 14th–15th c.; surviving longswords of the period weigh about 1.25–1.5 kg.',
  },
  hohenaschau: {
    short: 'Hohenaschau brigandine',
    text: 'The Hohenaschau brigandine (Bavarian National Museum), probably Milanese, c. 1380–1400: small plates riveted inside a textile cover.',
  },
  gauntlets: {
    short: 'Hourglass gauntlets',
    text: 'Plate "hourglass" gauntlets — a single plate over the back of the hand flaring at the cuff, fingers in small scales over a leather glove — dominate from c. 1350 to c. 1410.',
  },
  bascinetHistory: {
    short: 'Bascinet visors',
    text: 'The hinged-at-the-brow klappvisier appears c. 1330–40 and stays in German use into the 15th c.; the conical "pig-faced" hounskull (Hundsgugel) visor is the knightly helmet across Europe c. 1380–1420; the great bascinet with a plate gorget replacing the mail aventail appears around 1400.',
  },
  sigismund: {
    short: 'Bohemia 1402–03',
    text: 'King Wenceslas IV was taken prisoner by his half-brother Sigismund of Luxembourg in March 1402 and held in Vienna. From December 1402 Sigismund\'s Hungarian army, with Cuman auxiliaries, campaigned in Bohemia (Kutná Hora, Dec 1402 – Jan 1403).',
  },
  sudlice: {
    short: 'Sudlice',
    text: 'The sudlice, a Bohemian thrusting-and-cutting polearm, developed in the 14th century; its "eared" form (Bohemian earspoon) was most popular in the 15th. The war flail of the Hussites belongs to 1420 and later, so it is not in this armoury.',
  },
  messer: {
    short: 'Langes Messer',
    text: 'The long knife (langes Messer): single-edged, knife-hilted, usually with a nail (Nagel) projecting from the cross to guard the hand; a burgher\'s and soldier\'s sidearm of Central Europe from the 14th to the 16th c.',
  },
  dagger: {
    short: 'Rondel & baselard',
    text: 'The rondel dagger (discs at guard and pommel) in general use from the mid-14th c. and the knight\'s sidearm in harness; the baselard (H-shaped hilt) from the first half of the 14th c., popular with townsmen and militia.',
  },
  hammer: {
    short: 'War hammer',
    text: 'The true war hammer — a hammer face backed by a beak or spike — appears in manuscript illustrations and accounts from the late 14th century; flanged maces were the established anti-armour club.',
  },
  poleaxe: {
    short: 'Poleaxe',
    text: 'The poleaxe appears in illustrations from the mid-14th century, is commonplace by 1400, and is the preferred weapon of foot combat in armour and judicial duels in the 15th. Fiore dei Liberi (1409) teaches the azza in harness.',
  },
  cumans: {
    short: 'Cuman equipment',
    text: 'Cumans settled in Hungary from 1239 and served its kings as light horse: sabres, maces, recurve bows; mail (often short-sleeved), lamellar, conical helmets.',
  },
};

export function cite(ids) {
  return (Array.isArray(ids) ? ids : [ids]).map((id) => SOURCES[id]?.short ?? id).join('; ');
}
