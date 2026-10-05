/**
 * The joust of peace as it could have been run in Bohemia in 1403.
 *
 * What is certain, and what the game does with it:
 *  - No tilt. The barrier between the riders is first recorded in 1429/30
 *    (Portugal/Burgundy); before that, jousts were run "at large" in the
 *    open field. The riders pass left side to left side, each lance crossing
 *    over his own horse's neck to the left.
 *  - The German joust of peace (Gestech) was ridden with blunted lances
 *    carrying a coronel, a crown of three or four points that bites into the
 *    wood of the shield instead of glancing. Breaking the lance was the aim.
 *  - From the second half of the 14th century the Empire, Bohemia included,
 *    jousted in the high saddle (Hohenzeug, "Gestech im hohen Zeug"). Its
 *    seat lifted the rider up to a foot above the horse's back, and a high
 *    pommel with wings covered his belly and legs. He sat so firmly that
 *    unhorsing was rare.
 *  - The lance rest bolted to the right breast is late 14th century. It stops
 *    the lance sliding back on impact, so the rider's body and seat take the
 *    shock instead of his arm.
 *  - The ecranche, a small shield hung on the left breast, was in use from the
 *    late 14th to the early 16th century.
 *  - The helm is the great helm (Topfhelm). The frog-mouthed Stechhelm grows
 *    out of it "from about 1400"; the surviving examples are later.
 *
 * What is not known: no herald's rules from Bohemia survive for 1403. The
 * scoring uses the oldest written rules we have, those of the Order of the
 * Band (Castile, c. 1330): a broken lance beats an unbroken one, a lance
 * broken on the helm counts double, and unhelming or unhorsing beats
 * everything. Fouls follow John Tiptoft's ordinances (England, 1466): no
 * prize for striking the horse or below the girdle. Both are noted as
 * borrowed.
 */

export const JOUST_SOURCES = {
  tilt: {
    short: 'The tilt, after 1429',
    text: 'The barrier (tilt, toile) between jousters is first mentioned in 1429/30, at Arras and in Portugal. Earlier jousts, the joust of 1403 among them, were run "at large".',
    url: 'https://en.wikipedia.org/wiki/Jousting',
  },
  hohenzeug: {
    short: 'The high saddle (Hohenzeug)',
    text: 'From the late 14th century a very high saddle was used in the Holy Roman Empire. Its seat stood several centimetres above the horse\'s back, up to a foot, and its pommel and wings covered the rider\'s belly and legs. He held so firmly that splintering the lance was the main objective. It was used from the second half of the 14th to the late 15th century.',
    url: 'https://en.wikipedia.org/wiki/Jousting',
  },
  gestech: {
    short: 'Gestech and Rennen',
    text: 'In German lands the joust of peace with coronel-tipped lances was the Gestech; the joust of war with sharp lances was the Rennen. Both are named in an inventory of 1436, and Maximilian\'s Triumph (c. 1512–19) shows four styles of Gestech.',
    url: 'https://nightbringer.se/nightbringer/knight_courses.html',
  },
  lanceRest: {
    short: 'The lance rest',
    text: 'The lance rest (arrêt de cuirasse) appears in the late 14th century. Bolted to the right side of the breastplate, it stops the lance moving back on impact.',
    url: 'https://en.wikipedia.org/wiki/Lance_rest',
  },
  saddleRA: {
    short: 'Royal Armouries jousting saddle VI.94',
    text: 'A jousting saddle with a high bow that wraps the rider\'s thighs (Royal Armouries, Leeds, VI.94). Later than 1403, but it shows how the high saddle held the rider.',
    url: 'https://royalarmouries.org/objects-and-stories/up-close-online-exhibition/jousting-saddle',
  },
  saddleMet: {
    short: 'Met tournament saddle 34059',
    text: 'A German tournament saddle (Metropolitan Museum of Art, 34059): a high war saddle with a tall front bow.',
    url: 'https://www.metmuseum.org/art/collection/search/34059',
  },
  banda: {
    short: 'Order of the Band (c. 1330)',
    text: 'The statutes of the Castilian Order of the Band (c. 1330) give the oldest surviving joust scoring: four courses; whoever breaks a lance beats whoever breaks none; a lance broken on the helm counts for two; and unhelming or unhorsing beats everything.',
    url: 'https://www.worldhistory.org/Jousting/',
  },
  tiptoft: {
    short: 'Tiptoft\'s ordinances (1466)',
    text: 'John Tiptoft, Earl of Worcester, Ordinances for jousts of peace (1466). A man who strikes a horse, or strikes below the girdle, has no prize, and a lance broken that way counts against him. They are later than 1403, but they are the first full scoring rules written down.',
    url: 'https://en.wikipedia.org/wiki/Jousting',
  },
  horse: {
    short: 'The jousting horse',
    text: 'Destriers and coursers were c. 14–16 hands (1.42–1.63 m at the withers) and about 1,200–1,400 lb (545–635 kg): strong, short-coupled horses, not giants. A joust was run at a canter or controlled gallop, each horse at roughly 20–30 km/h.',
    url: 'https://en.wikipedia.org/wiki/Destrier',
  },
  lance: {
    short: 'The lance',
    text: 'Jousting lances were made of softwood (fir, pine) or ash: about 3.5–4 m long, thick at the grip, tapering to the head, often painted. A vamplate covered the hand and a coronel crowned the tip. The softwood was chosen so that the lance would break.',
    url: 'https://en.wikipedia.org/wiki/Lance',
  },
  williams: {
    short: 'Williams on impact energy',
    text: 'Alan Williams, The Knight and the Blast Furnace (2003), on the energy of a couched lance. Horse and rider at full speed carry tens of kilojoules, but the lance delivers only what it can transmit before it breaks or the target gives way. A lance braced on a rest transmits far more than one held in the arm alone.',
    url: 'https://en.wikipedia.org/wiki/Lance',
  },
  bohemia: {
    short: 'Tournaments in Luxembourg Bohemia',
    text: 'King John of Bohemia (r. 1310–46) was famous across Europe as a tourneyer. Prague saw jousts in the Old Town square in the 14th century, and the Bohemian lords of 1403 rode in the Imperial style.',
    url: 'https://en.wikipedia.org/wiki/John_of_Bohemia',
  },
};

/** The horse: a courser of about 15 hands. Speeds are the horse's own, in m/s. */
export const HORSE = {
  withers: 1.52,            // 15 hands
  mass: 600,                // kg
  barrelY: 1.08,            // centre of the barrel above the ground
  gaits: { halt: 0, walk: 1.6, trot: 3.6, canter: 6.2, gallop: 8.4 },
  accel: 2.6,               // m/s^2 from the spur (about 0.27 g)
  brake: 3.2,
  // stride frequency (Hz) by speed; the leg cycle follows it
  strideHz: (v) => (v < 0.1 ? 0 : v < 2.4 ? 0.95 : v < 5 ? 1.45 : v < 7.4 ? 1.75 : 2.05),
  coats: {
    bay: { coat: '#6a3a1e', mane: '#1a1210', points: '#1a1210' },
    grey: { coat: '#b9b4aa', mane: '#e4e0d8', points: '#5c5852' },
    black: { coat: '#1e1a18', mane: '#0c0a0a', points: '#0c0a0a' },
    chestnut: { coat: '#8a4a22', mane: '#6a3418', points: '#8a4a22' },
  },
};

/**
 * The lance. The breaking load is Euler buckling of the fore-lance, held at
 * the rest and pinned at the coronel: P = pi^2 E I / (K L)^2.
 * E for fir and spruce is about 11 GPa; d is the mid-shaft diameter.
 */
export const LANCE = {
  length: 3.8,              // m
  mass: 7.5,                // kg, a painted fir lance with vamplate and coronel
  rest: 0.95,               // m from the butt to where it lies in the rest
  grip: 1.08,               // m from the butt to the hand (in front of the rest)
  com: 1.25,                // m from the butt
  diameter: 0.055,          // m, mid-shaft
  E: 11e9,                  // Pa, fir along the grain
  K: 0.7,                   // effective-length factor: clamped at the rest, pinned at the head
  defect: [0.55, 1.0],      // knots, grain run-out, old wood: a factor on the ideal load
  modulusOfRupture: 60e6,   // Pa, fir in bending
  gripDiameter: 0.075,
  breakAt: 0.42,            // fraction of the length behind the head where it usually snaps
  bowTime: [0.003, 0.012],  // s a lance can stay bowed at its buckling load before it snaps
};

/**
 * Saddles. The Hohenzeug wraps the rider so that he stays up; the war
 * saddle has a cantle and a pommel but a normal seat, and a man struck
 * hard and unready goes over the cantle. Bounds in N and N m on the seat
 * constraints, and how far he can be displaced before he is out.
 */
export const SADDLES = {
  hohenzeug: {
    name: 'High saddle (Hohenzeug)', native: 'Gestech im hohen Zeug',
    text: 'The Imperial joust of peace: a seat raised up to a foot above the horse, the legs boxed in by the saddle\'s wings. Breaking lances is the game; unhorsing is very rare.',
    seatY: 0.62, scale: { pelvis: 1, torso: 1, legs: 1 }, unseat: { seat: 0.2, back: 0.95, twist: 0.7 }, wood: 'fir',
  },
  war: {
    name: 'War saddle', native: 'válečné sedlo',
    text: 'The knight\'s ordinary war saddle with a raised cantle and pommel, as in jousts at large across the 14th century. A square blow on a man who is not braced can lay him over the cantle.',
    seatY: 0.5, scale: { pelvis: 0.42, torso: 0.55, legs: 0.6 }, unseat: { seat: 0.2, back: 0.5, twist: 0.5 }, wood: 'ash',
  },
};

/** Lance woods: fir for the joust of peace, stouter ash where men meant to unhorse. */
export const LANCE_WOODS = {
  fir: { name: 'Fir', diameter: 0.055, E: 11e9, modulusOfRupture: 60e6, mass: 7.5, text: 'Light, straight-grained, made to break.' },
  ash: { name: 'Ash', diameter: 0.064, E: 12.5e9, modulusOfRupture: 105e6, mass: 10, text: 'The war lance\'s wood: tough and springy; it bows and holds where fir snaps.' },
};

export function lanceBucklingLoad(L = LANCE) {
  const I = Math.PI * L.diameter ** 4 / 64;
  const free = (L.length - L.rest) * L.K;
  return Math.PI * Math.PI * L.E * I / (free * free);
}

/**
 * Sideways load at the head that snaps the shaft. The lance is not clamped:
 * the arm lets it swing, so a sideways blow mostly turns it, and the bending
 * moment inside the shaft is a fraction of F * L (about a quarter for a rod
 * struck at its end and free to rotate about the rest).
 */
export function lanceBendingLimit(L = LANCE) {
  const W = Math.PI * L.gripDiameter ** 3 / 32;
  return L.modulusOfRupture * W / (0.25 * (L.length - L.rest));   // N at the head
}

/** The joust kit of 1403: great helm, plate and mail, the ecranche on the left breast. */
export const JOUST_KIT = {
  head: 'greatHelm', neck: 'mailStandard', under: 'gambeson', mail: 'haubergeon', plate: 'breastplate', cover: 'jupon',
  arms: 'plateArms', hands: 'gauntlets', legs: 'plateLegs', feet: 'sabatons',
};

/** How the courses are scored. Borrowed rules, as noted above. */
export const RULES = {
  courses: 4,
  extraCourses: 2,
  points: { body: 1, helm: 2, unhelm: 2 },
  foulPenalty: 1,
  zones: {
    ecranche: 'body', chest: 'body', abdomen: 'body', upperArm: 'body', forearm: 'body',
    head: 'helm', pelvis: 'foul', thigh: 'foul', shin: 'foul', foot: 'foul', horse: 'foul',
  },
};

/** Opponents in the lists: lords and knights of 1403, with their arms. */
export const JOUSTERS = [
  { id: 'squire', name: 'Mikuláš Kotva', title: 'a squire riding his first joust (invented)', heraldry: 'chequy', coat: 'chestnut', skill: 0.5, aim: 'body', colors: { cloth: '#1c3a6a', accent: '#d8c060' } },
  { id: 'hungarian', name: 'Miklós Garai', title: 'a Hungarian baron in Sigismund\'s train', heraldry: 'hungary', coat: 'black', skill: 0.72, aim: 'helm', colors: { cloth: '#b0161c', accent: '#f0eee8' } },
  { id: 'rozmberk', name: 'Jindřich of Rožmberk', title: 'lord of the Rose, head of the house of Rožmberk', heraldry: 'rozmberk', coat: 'grey', skill: 0.8, aim: 'mixed', colors: { cloth: '#ece8e0', accent: '#b0161c' } },
  { id: 'michalovice', name: 'Jan of Michalovice', title: 'a Bohemian lord famed in the lists abroad', heraldry: 'bohemia', coat: 'bay', skill: 0.9, aim: 'mixed', colors: { cloth: '#b0161c', accent: '#f0eee8' } },
];
