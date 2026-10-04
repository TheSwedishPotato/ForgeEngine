/**
 * Who you can fight. The people are invented; their kit, weapons and ways of
 * fighting are those of their kind in Bohemia in 1403, the year King
 * Sigismund's Hungarian army and its Cumans were in the country while King
 * Wenceslas IV sat in captivity in Vienna.
 *
 * style: which AI doctrine drives them (see game/AI.js)
 * skill: 0..1 reading and timing; aggression: 0..1 how readily they attack
 */
export const OPPONENTS = {
  militia: {
    name: 'Ondřej Kalous',
    title: 'Prague militiaman',
    blurb: 'A cooper from the New Town, called out with the city levy. Thick gambeson, kettle hat, a sudlice he knows how to thrust with — and no wish to die for either king.',
    weapon: 'sudlice', offhand: 'none', style: 'militia',
    items: { head: 'kettleHat', neck: 'mailStandard', under: 'gambeson', mail: 'noMail', plate: 'noPlate', cover: 'noCover', arms: 'bareArms', hands: 'gloves', legs: 'hose', feet: 'shoes' },
    body: { height: 1.7, mass: 72 }, skill: 0.4, aggression: 0.45, strength: 0.95,
    colors: { cloth: '#7a6a4a', hose: '#4b4236', accent: '#a08a5a' },
    sources: ['heath', 'wenzelBible', 'sudlice'],
  },
  cuman: {
    name: 'Arslan',
    title: 'Cuman horseman in Sigismund\'s pay',
    blurb: 'One of the Cuman light horsemen King Sigismund brought into Bohemia in the winter of 1402. Dismounted, he is still quick: mail, a quilted coat and a curved sabre.',
    weapon: 'sabre', offhand: 'none', style: 'cuman',
    items: { head: 'mailCoif', neck: 'bareNeck', under: 'gambeson', mail: 'haubergeon', plate: 'noPlate', cover: 'noCover', arms: 'bareArms', hands: 'gloves', legs: 'hose', feet: 'shoes' },
    body: { height: 1.68, mass: 66 }, skill: 0.6, aggression: 0.8, strength: 0.9,
    colors: { cloth: '#6b2a1e', hose: '#3a2a22', accent: '#c49a3a' },
    sources: ['cumans', 'sigismund'],
  },
  priest: {
    name: 'Brother Lutger',
    title: 'A priest who fences',
    blurb: 'He learned the sword and buckler the way the old Franconian book teaches it, from the seven wards, and he never lets the buckler leave his sword hand.',
    weapon: 'armingSword', offhand: 'buckler', style: 'i33',
    items: { head: 'hood', neck: 'bareNeck', under: 'shirt', mail: 'noMail', plate: 'noPlate', cover: 'noCover', arms: 'bareArms', hands: 'bareHands', legs: 'hose', feet: 'shoes' },
    body: { height: 1.74, mass: 74 }, skill: 0.75, aggression: 0.5, strength: 0.95,
    colors: { cloth: '#2b2622', hose: '#1f1b18', accent: '#5a4e40' },
    sources: ['i33'],
  },
  mercenary: {
    name: 'Konrad Messerer',
    title: 'German mercenary',
    blurb: 'A Franconian Söldner who has sold his messer to whoever pays, this year to the lords\' league. Kettle hat, brigandine over his doublet, splinted arms.',
    weapon: 'messer', offhand: 'none', style: 'liechtenauer',
    items: { head: 'kettleHat', neck: 'mailStandard', under: 'armingDoublet', mail: 'noMail', plate: 'brigandine', cover: 'noCover', arms: 'splints', hands: 'gloves', legs: 'hose', feet: 'shoes' },
    body: { height: 1.78, mass: 80 }, skill: 0.62, aggression: 0.65, strength: 1.0,
    colors: { cloth: '#2e4a2a', hose: '#5a2a22', accent: '#b88b4a' },
    sources: ['messer', 'leckuchner', 'hohenaschau'],
  },
  squire: {
    name: 'Ješek of Lomnice',
    title: 'Squire of the royal party',
    blurb: 'A young Bohemian squire loyal to the captive King Wenceslas, trained in the long sword by a pupil of the Liechtenauer school.',
    weapon: 'longsword', offhand: 'none', style: 'liechtenauer',
    items: { head: 'openBascinet', neck: 'bareNeck', under: 'armingDoublet', mail: 'haubergeon', plate: 'brigandine', cover: 'noCover', arms: 'splints', hands: 'gauntlets', legs: 'gamboised', feet: 'shoes' },
    body: { height: 1.76, mass: 72 }, skill: 0.62, aggression: 0.55, strength: 0.95,
    colors: { cloth: '#8a1c1c', hose: '#e8e2d4', accent: '#e8e2d4' },
    heraldry: 'bohemia',
    sources: ['hs3227a', 'hohenaschau'],
  },
  hungarian: {
    name: 'Lőrinc of Buda',
    title: 'Hungarian man-at-arms',
    blurb: 'A man-at-arms of King Sigismund\'s army, at Kutná Hora this winter. Open bascinet, mail, an old coat of plates and a flanged mace for knocking on helmets.',
    weapon: 'mace', offhand: 'none', style: 'brawler',
    items: { head: 'openBascinet', neck: 'bareNeck', under: 'armingDoublet', mail: 'hauberk', plate: 'coatOfPlates', cover: 'noCover', arms: 'splints', hands: 'gauntlets', legs: 'mailChausses', feet: 'shoes' },
    body: { height: 1.75, mass: 82 }, skill: 0.55, aggression: 0.7, strength: 1.08,
    colors: { cloth: '#7a1420', hose: '#e8e2d4', accent: '#2e5a2a' },
    heraldry: 'hungary',
    sources: ['sigismund', 'hammer'],
  },
  robber: {
    name: 'Heinz Pfaffenfeind',
    title: 'Robber knight',
    blurb: 'A landless knight who lives off the roads while the kingdom is at odds with itself. Klappvisier bascinet, a long hauberk, and a war hammer for men in better armour than his.',
    weapon: 'warHammer', offhand: 'none', style: 'brawler',
    items: { head: 'klappvisier', neck: 'bareNeck', under: 'armingDoublet', mail: 'hauberk', plate: 'noPlate', cover: 'noCover', arms: 'splints', hands: 'mailMittens', legs: 'gamboised', feet: 'shoes' },
    body: { height: 1.82, mass: 88 }, skill: 0.55, aggression: 0.75, strength: 1.12,
    colors: { cloth: '#3a3a3a', hose: '#2a2420', accent: '#6a5a3a' },
    sources: ['hammer', 'bascinetHistory'],
  },
  fencer: {
    name: 'Mistr Hanuš',
    title: 'Fencing master',
    blurb: 'A master of the long sword in the line of Johannes Liechtenauer, who fights unarmoured, bloss, as the art is taught: always in the Vor, always seeking the bind.',
    weapon: 'longsword', offhand: 'none', style: 'liechtenauer',
    items: { head: 'bareHead', neck: 'bareNeck', under: 'shirt', mail: 'noMail', plate: 'noPlate', cover: 'noCover', arms: 'bareArms', hands: 'gloves', legs: 'hose', feet: 'shoes' },
    body: { height: 1.78, mass: 76 }, skill: 0.9, aggression: 0.6, strength: 1.0,
    colors: { cloth: '#1e2a44', hose: '#a8823a', accent: '#d8c8a0' },
    sources: ['hs3227a', 'ringeck'],
  },
  condottiere: {
    name: 'Giacomo da Cividale',
    title: 'Italian condottiere, schooled by Fiore',
    blurb: 'A Friulian captain, of the country of Master Fiore dei Liberi, in full Italian harness with the poleaxe, the weapon of the lists.',
    weapon: 'poleaxe', offhand: 'none', style: 'fiore',
    items: { head: 'hounskull', neck: 'bareNeck', under: 'armingDoublet', mail: 'haubergeon', plate: 'breastplate', cover: 'noCover', arms: 'plateArms', hands: 'gauntlets', legs: 'plateLegs', feet: 'sabatons' },
    body: { height: 1.77, mass: 78 }, skill: 0.82, aggression: 0.55, strength: 1.05,
    colors: { cloth: '#3a2a5a', hose: '#c8b070', accent: '#c8b070' },
    sources: ['fiore', 'poleaxe', 'wallace'],
  },
  knight: {
    name: 'Sir Ulrich vom Stein',
    title: 'Knight in full harness',
    blurb: 'A German knight of the lords\' league in a full harness of 1400: hounskull, haubergeon, breastplate under his jupon, plate arms and legs. He fights the Kampffechten — half-sword, Mordschlag, and wrestling.',
    weapon: 'longsword', offhand: 'none', style: 'halfsword',
    items: { head: 'hounskull', neck: 'bareNeck', under: 'armingDoublet', mail: 'haubergeon', plate: 'breastplate', cover: 'jupon', arms: 'plateArms', hands: 'gauntlets', legs: 'plateLegs', feet: 'sabatons' },
    body: { height: 1.8, mass: 82 }, skill: 0.92, aggression: 0.55, strength: 1.1,
    colors: { cloth: '#1c3a6a', hose: '#d8c060', accent: '#d8c060' },
    heraldry: 'chequy',
    sources: ['hs3227a', 'ringeck', 'danzig', 'jaquet'],
  },
};

export const OPPONENT_ORDER = ['militia', 'cuman', 'priest', 'mercenary', 'squire', 'hungarian', 'robber', 'fencer', 'condottiere', 'knight'];

export const HERALDRY = {
  none: { name: 'Plain', field: null },
  bohemia: { name: 'Kingdom of Bohemia', text: 'A white (argent) double-tailed lion, crowned gold, on red (gules).', field: '#b0161c', charge: 'lion', chargeColor: '#f0eee8' },
  hungary: { name: 'Kingdom of Hungary', text: 'Barry of eight red and silver (the Árpád stripes), with the double cross on the other half.', field: '#b0161c', charge: 'barry', chargeColor: '#f0eee8' },
  rozmberk: { name: 'Rožmberk', text: 'A red five-petalled rose on silver — the lords of Rosenberg.', field: '#ece8e0', charge: 'rose', chargeColor: '#b0161c' },
  chequy: { name: 'Chequy (fictional)', text: 'Chequy blue and gold — invented arms for an invented knight.', field: '#1c3a6a', charge: 'chequy', chargeColor: '#d8c060' },
};
