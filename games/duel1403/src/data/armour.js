/**
 * Armour, head to toe, as it could be worn in Bohemia in 1403.
 *
 * Every item lists:
 *   slot     where it is worn (one item per slot; layers stack across slots)
 *   mass     kg, and massBy: how it loads each body segment (limbs per side)
 *   layers   what protects which zone: plate (t = thickness, mm),
 *            mail (riveted), pad (quilted linen, n = layers), leather, cloth
 *            cover < 1 means only part of the zone is covered (splints,
 *            hems, open-backed defences)
 *   vision   field of view left to the wearer (1 = unrestricted)
 *   breath   how much it restricts breathing (0 = not at all)
 *
 * Zones: skull face eyes nape throat | chest back armpit belly loins groin hips |
 *        shoulder upperArm innerArm elbow elbowInner forearm hand palm |
 *        thigh thighBack knee kneeBack shin calf foot
 * Anything not listed is a gap. The gaps are where the period fight books
 * say to thrust: the face, under the arms, the palms, the hollows of the
 * knees and between the legs (Ringeck, Kampffechten).
 */
export const SLOTS = [
  { id: 'head', name: 'Head', native: 'Hlava · Haupt' },
  { id: 'neck', name: 'Neck', native: 'Krk · Hals' },
  { id: 'under', name: 'Body: padding', native: 'Prošívanice · Wams' },
  { id: 'mail', name: 'Body: mail', native: 'Kroužková zbroj · Panzer' },
  { id: 'plate', name: 'Body: plate', native: 'Plát · Platte' },
  { id: 'cover', name: 'Over all', native: 'Kabátec · Lentner' },
  { id: 'arms', name: 'Arms', native: 'Paže · Armzeug' },
  { id: 'hands', name: 'Hands', native: 'Ruce · Hentzen' },
  { id: 'legs', name: 'Legs', native: 'Nohy · Beinzeug' },
  { id: 'feet', name: 'Feet', native: 'Chodidla · Füße' },
];

const TORSO = ['chest', 'back', 'belly', 'loins'];
const ARM_PAD = ['shoulder', 'upperArm', 'innerArm', 'elbow', 'elbowInner', 'forearm'];

export const ARMOUR = {
  // ---- head ---------------------------------------------------------------
  bareHead: {
    slot: 'head', name: 'Bare head', native: '', date: '', mass: 0, massBy: {},
    layers: [], vision: 1, breath: 0,
    description: 'Nothing on the head.',
  },
  hood: {
    slot: 'head', name: 'Wool hood', native: 'kápě · Gugel', date: '14th c.', mass: 0.35, massBy: { head: 0.35 },
    layers: [{ mat: 'cloth', zones: ['skull', 'nape', 'throat'] }], vision: 1, breath: 0,
    description: 'A woollen hood with a shoulder cape — everyday wear, no protection to speak of.',
    sources: ['wenzelBible'],
  },
  armingCap: {
    slot: 'head', name: 'Padded arming cap', native: 'vycpaná čepice', date: '14th–15th c.', mass: 0.3, massBy: { head: 0.3 },
    layers: [{ mat: 'pad', n: 8, zones: ['skull', 'nape'] }], vision: 1, breath: 0,
    description: 'A quilted linen cap, worn under every helmet and sometimes on its own. Softens a blow; stops little.',
    sources: ['williams'],
  },
  mailCoif: {
    slot: 'head', name: 'Mail coif', native: 'kroužková kukla', date: '12th–14th c.', mass: 2.3, massBy: { head: 1.6, chest: 0.7 },
    layers: [{ mat: 'mail', zones: ['skull', 'nape', 'throat'] }, { mat: 'pad', n: 6, zones: ['skull'] }], vision: 0.95, breath: 0,
    description: 'A hood of riveted mail over a padded cap. Old-fashioned for a knight by 1400, still common among footmen and in the east.',
    sources: ['heath', 'cumans'],
  },
  kettleHat: {
    slot: 'head', name: 'Kettle hat', native: 'železný klobouk · Eisenhut', date: '13th–15th c.', mass: 2.1, massBy: { head: 2.1 },
    layers: [{ mat: 'plate', t: 1.8, zones: ['skull'] }, { mat: 'plate', t: 1.5, cover: 0.5, zones: ['nape'] }, { mat: 'pad', n: 6, zones: ['skull'] }],
    vision: 0.96, breath: 0,
    description: 'The broad-brimmed iron hat of the infantry. The Central European form, with the brim drawn into brow ridges over the eyes, is drawn again and again in the Wenceslas Bible. The face is open.',
    sources: ['wenzelBible', 'heath'],
  },
  openBascinet: {
    slot: 'head', name: 'Bascinet, visor off', native: 'bascinet · Beckenhaube', date: 'c. 1330–1420', mass: 3.3, massBy: { head: 2.6, chest: 0.7 },
    layers: [{ mat: 'plate', t: 2.0, zones: ['skull', 'nape'] }, { mat: 'mail', zones: ['throat'] }, { mat: 'pad', n: 8, zones: ['skull', 'nape'] }],
    vision: 0.97, breath: 0,
    description: 'A pointed bascinet with its mail aventail laced to the rim, worn without its visor — as many men-at-arms preferred when they could.',
    sources: ['wallace', 'bascinetHistory'],
  },
  klappvisier: {
    slot: 'head', name: 'Bascinet with Klappvisier', native: 'Beckenhaube mit Klappvisier', date: 'c. 1330 – early 15th c. (German lands)', mass: 4.0, massBy: { head: 3.3, chest: 0.7 },
    layers: [
      { mat: 'plate', t: 2.0, zones: ['skull', 'nape'] },
      { mat: 'plate', t: 1.5, zones: ['face'], visor: true },
      { mat: 'mail', zones: ['throat'] },
      { mat: 'pad', n: 8, zones: ['skull', 'nape'] },
    ],
    visor: true, vision: 0.42, breath: 0.22,
    description: 'A bascinet whose visor hangs from a single hinge at the brow, the German fashion that outlived the Italian one. Eye-slits only; lift it to see and breathe.',
    sources: ['bascinetHistory', 'wenzelBible'],
  },
  hounskull: {
    slot: 'head', name: 'Hounskull bascinet', native: 'Hundsgugel · psí kukla', date: 'c. 1380–1420', mass: 4.1, massBy: { head: 3.5, chest: 0.6 },
    layers: [
      { mat: 'plate', t: 2.0, zones: ['skull', 'nape'] },
      { mat: 'plate', t: 1.6, zones: ['face'], visor: true },
      { mat: 'mail', zones: ['throat'] },
      { mat: 'pad', n: 8, zones: ['skull', 'nape'] },
    ],
    visor: true, vision: 0.4, breath: 0.12,
    description: 'The "pig-faced" bascinet: a conical visor pivoting at the temples, its snout glancing blows aside and leaving room to breathe. The knight\'s helmet of Europe c. 1380–1420. 4.07 kg with aventail (Wallace Collection example).',
    sources: ['wallace', 'bascinetHistory'],
  },
  greatBascinet: {
    slot: 'head', name: 'Great bascinet', native: 'velký bascinet', date: 'c. 1400 onward (new in 1403)', mass: 5.6, massBy: { head: 3.1, chest: 2.5 },
    layers: [
      { mat: 'plate', t: 2.0, zones: ['skull', 'nape', 'throat'] },
      { mat: 'plate', t: 1.6, zones: ['face'], visor: true },
      { mat: 'pad', n: 8, zones: ['skull', 'nape'] },
    ],
    visor: true, vision: 0.36, breath: 0.2,
    description: 'The newest thing in 1403: the mail aventail replaced by plates, the helmet resting on the shoulders and strapped to the breastplate. Excellent protection, but the head can no longer turn.',
    sources: ['bascinetHistory'],
    stiffNeck: true,
  },
  greatHelm: {
    slot: 'head', name: 'Great helm', native: 'Topfhelm · hrncová přilba', date: '13th–14th c. (tournament by 1403)', mass: 4.6, massBy: { head: 4.0, chest: 0.6 },
    layers: [
      { mat: 'plate', t: 2.0, zones: ['skull', 'face', 'nape'] },
      { mat: 'mail', zones: ['throat'] },
      { mat: 'pad', n: 8, zones: ['skull'] },
    ],
    vision: 0.28, breath: 0.32,
    description: 'The flat-topped pot helm of the crusading era, worn over a coif. By 1403 a jousting and parade helm, not a war helm — here for comparison. You see through two slits and breathe through holes.',
    sources: ['bascinetHistory'],
    anachronism: 'Outdated for war in 1403.',
  },

  // ---- neck ----------------------------------------------------------------
  bareNeck: { slot: 'neck', name: 'Nothing', native: '', mass: 0, massBy: {}, layers: [], vision: 1, breath: 0, description: 'Nothing extra at the neck.' },
  mailStandard: {
    slot: 'neck', name: 'Mail standard', native: 'kroužkový límec · Kragen', date: '14th–16th c.', mass: 0.9, massBy: { chest: 0.6, head: 0.3 },
    layers: [{ mat: 'mail', zones: ['throat', 'nape'] }], vision: 1, breath: 0,
    description: 'A high collar of riveted mail, worn with an open helmet such as the kettle hat.',
    sources: ['heath'],
  },

  // ---- body: padding ------------------------------------------------------
  shirt: {
    slot: 'under', name: 'Shirt and doublet', native: 'košile a kabátec', date: '', mass: 0.6,
    massBy: { chest: 0.25, abdomen: 0.15, pelvis: 0.1, upperArm: 0.03, forearm: 0.02 },
    layers: [{ mat: 'cloth', zones: [...TORSO, 'armpit', 'groin', 'hips', ...ARM_PAD] }], vision: 1, breath: 0,
    description: 'A linen shirt under a woollen doublet: what a fencer wears for Blossfechten, the unarmoured fight.',
  },
  armingDoublet: {
    slot: 'under', name: 'Arming doublet', native: 'vycpaný kabátec · Wams', date: '14th–15th c.', mass: 1.75,
    massBy: { chest: 0.8, abdomen: 0.45, upperArm: 0.15, forearm: 0.1 },
    layers: [{ mat: 'pad', n: 8, zones: [...TORSO, 'armpit', ...ARM_PAD] }], vision: 1, breath: 0,
    description: 'A fitted, lightly quilted doublet worn under armour, with points (laces) to hang the mail and plate from.',
    sources: ['williams'],
  },
  gambeson: {
    slot: 'under', name: 'Gambeson', native: 'prošívanice · Gambeson', date: '12th–15th c.', mass: 3.7,
    massBy: { chest: 1.4, abdomen: 0.8, pelvis: 0.5, upperArm: 0.25, forearm: 0.15, thigh: 0.1 },
    layers: [
      { mat: 'pad', n: 26, zones: [...TORSO, 'armpit', ...ARM_PAD] },
      { mat: 'pad', n: 26, cover: 0.8, zones: ['hips', 'groin'] },
      { mat: 'pad', n: 26, cover: 0.45, zones: ['thigh', 'thighBack'] },
    ],
    vision: 1, breath: 0.05,
    description: 'A thick quilted linen coat, laced down the front, reaching the thighs — the armour of the Prague militia in the Wenceslas Bible. Williams\' tests: a 26-layer jack stops a ~200 J sword cut but only ~50 J behind a point.',
    sources: ['heath', 'wenzelBible', 'williams'],
  },

  // ---- body: mail -----------------------------------------------------------
  noMail: { slot: 'mail', name: 'No mail', native: '', mass: 0, massBy: {}, layers: [], vision: 1, breath: 0, description: 'No mail shirt.' },
  haubergeon: {
    slot: 'mail', name: 'Haubergeon', native: 'krátká kroužková košile · Panzer', date: '13th–15th c.', mass: 8.5,
    massBy: { chest: 3.4, abdomen: 2.0, pelvis: 1.6, upperArm: 0.5, thigh: 0.25 },
    layers: [
      { mat: 'mail', zones: [...TORSO, 'armpit', 'groin', 'hips', 'shoulder', 'upperArm', 'innerArm'] },
      { mat: 'mail', cover: 0.5, zones: ['thigh', 'thighBack'] },
    ],
    vision: 1, breath: 0.03,
    description: 'A riveted mail shirt with sleeves to the elbow and a hem at mid-thigh, worn under the plate. Mail is what covers the gaps: the armpits and the groin.',
    sources: ['williams'],
  },
  hauberk: {
    slot: 'mail', name: 'Long-sleeved hauberk', native: 'kroužková košile', date: '12th–15th c.', mass: 10.3,
    massBy: { chest: 3.8, abdomen: 2.2, pelvis: 1.6, upperArm: 0.6, forearm: 0.45, thigh: 0.3 },
    layers: [
      { mat: 'mail', zones: [...TORSO, 'armpit', 'groin', 'hips', ...ARM_PAD] },
      { mat: 'mail', cover: 0.6, zones: ['thigh', 'thighBack'] },
    ],
    vision: 1, breath: 0.03,
    description: 'Riveted mail to the wrists and the thighs. Heavy, and the whole weight hangs from the shoulders unless belted.',
    sources: ['williams', 'cumans'],
  },

  // ---- body: plate -----------------------------------------------------------
  noPlate: { slot: 'plate', name: 'No plate', native: '', mass: 0, massBy: {}, layers: [], vision: 1, breath: 0, description: 'No plate on the body.' },
  coatOfPlates: {
    slot: 'plate', name: 'Coat of plates', native: 'Plattenrock', date: 'c. 1250–1400 (going out by 1403)', mass: 7.0,
    massBy: { chest: 4.2, abdomen: 2.8 },
    layers: [{ mat: 'plate', t: 1.3, cover: 0.92, zones: TORSO }],
    vision: 1, breath: 0.06,
    description: 'Large plates riveted inside a cloth or leather coat. The 14th-century defence for the body, being replaced by breastplates and brigandines around 1400.',
    sources: ['hohenaschau'],
  },
  brigandine: {
    slot: 'plate', name: 'Brigandine', native: 'brigantina', date: 'c. 1380 onward', mass: 6.5,
    massBy: { chest: 3.6, abdomen: 2.2, pelvis: 0.7 },
    layers: [{ mat: 'plate', t: 1.1, cover: 0.95, zones: TORSO }, { mat: 'plate', t: 1.0, cover: 0.6, zones: ['hips'] }],
    vision: 1, breath: 0.05,
    description: 'Hundreds of small overlapping plates riveted inside a velvet-covered coat — flexible, and refittable by any armourer. The Hohenaschau brigandine (Milan, c. 1380–1400) is one.',
    sources: ['hohenaschau'],
  },
  breastplate: {
    slot: 'plate', name: 'Breastplate and fauld', native: 'kyrys · Brust (Lentner)', date: 'c. 1370 onward', mass: 10.0,
    massBy: { chest: 5.2, abdomen: 3.0, pelvis: 1.8 },
    layers: [
      { mat: 'plate', t: 2.2, zones: ['chest'] },
      { mat: 'plate', t: 1.6, zones: ['back', 'belly', 'loins'] },
      { mat: 'plate', t: 1.2, cover: 0.75, zones: ['hips'] },
    ],
    vision: 1, breath: 0.1,
    description: 'A rounded (globose) breastplate with backplate and a skirt of lames (fauld), usually worn under a fitted textile cover — the German Lentner. From about 1370 the breastplate covers the whole front of the torso.',
    sources: ['hohenaschau', 'williams'],
  },

  // ---- over all ------------------------------------------------------------------
  noCover: { slot: 'cover', name: 'Nothing', native: '', mass: 0, massBy: {}, layers: [], vision: 1, breath: 0, description: 'Armour shown bare.' },
  jupon: {
    slot: 'cover', name: 'Jupon with arms', native: 'erbovní kabátec · Lentner', date: 'c. 1360–1420', mass: 1.2,
    massBy: { chest: 0.6, abdomen: 0.3, pelvis: 0.2, upperArm: 0.05 },
    layers: [{ mat: 'pad', n: 4, zones: [...TORSO, 'hips', 'shoulder', 'upperArm'] }],
    vision: 1, breath: 0.02,
    description: 'A tight, lightly padded coat over the armour, bearing the wearer\'s arms.',
    sources: ['wenzelBible'],
    heraldic: true,
  },

  // ---- arms ----------------------------------------------------------------------
  bareArms: { slot: 'arms', name: 'No arm defences', native: '', mass: 0, massBy: {}, layers: [], vision: 1, breath: 0, description: 'Sleeves only.' },
  splints: {
    slot: 'arms', name: 'Splinted arm defences', native: 'Schienen', date: '14th c.', mass: 2.6,
    massBy: { upperArm: 0.65, forearm: 0.65 },
    layers: [
      { mat: 'plate', t: 1.0, cover: 0.65, zones: ['shoulder', 'upperArm', 'forearm'] },
      { mat: 'plate', t: 1.3, zones: ['elbow'] },
    ],
    vision: 1, breath: 0,
    description: 'Steel splints riveted to leather, strapped over the sleeves, with a cup (couter) at the elbow. Cheap, and leaves gaps between the splints.',
    sources: ['williams'],
  },
  plateArms: {
    slot: 'arms', name: 'Plate arm harness', native: 'Armzeug', date: 'c. 1380 onward', mass: 4.2,
    massBy: { upperArm: 1.1, forearm: 1.0 },
    layers: [
      { mat: 'plate', t: 1.4, zones: ['shoulder', 'upperArm'] },
      { mat: 'plate', t: 1.5, zones: ['elbow'] },
      { mat: 'plate', t: 1.2, zones: ['forearm'] },
    ],
    vision: 1, breath: 0,
    description: 'Spaulder, rerebrace, couter and tubular vambrace. The inside of the upper arm and the bend of the elbow stay open so the arm can move; mail beneath is what guards them.',
    sources: ['williams', 'jaquet'],
  },

  // ---- hands ---------------------------------------------------------------------
  bareHands: { slot: 'hands', name: 'Bare hands', native: '', mass: 0, massBy: {}, layers: [], vision: 1, breath: 0, description: 'Nothing on the hands.' },
  gloves: {
    slot: 'hands', name: 'Leather gloves', native: 'rukavice', date: '', mass: 0.2, massBy: { forearm: 0.1 },
    layers: [{ mat: 'leather', zones: ['hand', 'palm'] }], vision: 1, breath: 0,
    description: 'Riding gloves of stout leather.',
  },
  mailMittens: {
    slot: 'hands', name: 'Mail mittens', native: 'kroužkové rukavice', date: '12th–14th c.', mass: 0.5, massBy: { forearm: 0.25 },
    layers: [{ mat: 'mail', zones: ['hand'] }, { mat: 'leather', zones: ['palm'] }], vision: 1, breath: 0,
    description: 'Mail mufflers over the hands with leather palms — older than plate gauntlets.',
  },
  gauntlets: {
    slot: 'hands', name: 'Hourglass gauntlets', native: 'Hentzen · plechové rukavice', date: 'c. 1350–1410', mass: 1.3, massBy: { forearm: 0.65 },
    layers: [{ mat: 'plate', t: 1.0, zones: ['hand'] }, { mat: 'leather', zones: ['palm'] }], vision: 1, breath: 0,
    description: 'A single plate over the back of the hand, narrowing at the wrist and flaring at the cuff, with scaled fingers over a leather glove. The palm stays bare leather — a target in the fight books.',
    sources: ['gauntlets', 'ringeck'],
  },

  // ---- legs ------------------------------------------------------------------------
  hose: {
    slot: 'legs', name: 'Wool hose', native: 'nohavice · Hosen', date: '', mass: 0.4, massBy: { thigh: 0.12, shin: 0.08 },
    layers: [{ mat: 'cloth', zones: ['thigh', 'thighBack', 'knee', 'kneeBack', 'shin', 'calf'] }], vision: 1, breath: 0,
    description: 'Tight woollen hose, pointed to the doublet.',
  },
  gamboised: {
    slot: 'legs', name: 'Gamboised cuisses, poleyns', native: 'prošívané stehenice', date: '14th c.', mass: 2.2, massBy: { thigh: 0.8, shin: 0.3 },
    layers: [
      { mat: 'pad', n: 16, zones: ['thigh'] },
      { mat: 'pad', n: 16, cover: 0.5, zones: ['thighBack'] },
      { mat: 'plate', t: 1.5, zones: ['knee'] },
    ],
    vision: 1, breath: 0,
    description: 'Quilted thigh defences with steel knee cops (poleyns) — the cheaper 14th-century leg harness.',
    sources: ['williams'],
  },
  mailChausses: {
    slot: 'legs', name: 'Mail chausses', native: 'kroužkové nohavice', date: '12th–14th c.', mass: 6.0, massBy: { thigh: 1.4, shin: 1.2, foot: 0.4 },
    layers: [{ mat: 'mail', zones: ['thigh', 'thighBack', 'knee', 'kneeBack', 'shin', 'calf', 'foot'] }], vision: 1, breath: 0,
    description: 'Mail stockings laced to the belt. Heavy and old-fashioned by 1400, but they close every gap on the leg.',
  },
  plateLegs: {
    slot: 'legs', name: 'Plate leg harness', native: 'Beinzeug', date: 'c. 1370 onward', mass: 7.5, massBy: { thigh: 2.1, shin: 1.65 },
    layers: [
      { mat: 'plate', t: 1.4, zones: ['thigh'] },
      { mat: 'plate', t: 1.5, zones: ['knee'] },
      { mat: 'plate', t: 1.2, zones: ['shin', 'calf'] },
      { mat: 'pad', n: 6, zones: ['thigh', 'knee'] },
    ],
    vision: 1, breath: 0,
    description: 'Cuisses strapped over the front of the thigh, poleyns with side wings, closed greaves. The back of the thigh and the hollow of the knee stay open.',
    sources: ['williams', 'ringeck'],
  },

  // ---- feet ------------------------------------------------------------------------------
  shoes: {
    slot: 'feet', name: 'Turnshoes', native: 'boty · Schuhe', date: '', mass: 0.4, massBy: { foot: 0.2 },
    layers: [{ mat: 'leather', zones: ['foot'] }], vision: 1, breath: 0,
    description: 'Soft leather shoes, sewn inside out and turned.',
  },
  sabatons: {
    slot: 'feet', name: 'Sabatons', native: 'Eisenschuhe', date: 'c. 1350 onward', mass: 1.1, massBy: { foot: 0.55 },
    layers: [{ mat: 'plate', t: 1.0, zones: ['foot'] }], vision: 1, breath: 0,
    description: 'Laminated steel shoes, pointed in the fashion of the day.',
  },
};

export const PRESETS = {
  blossfechten: {
    name: 'Fencer (unarmoured)',
    description: 'Blossfechten: shirt and doublet, as fencing was taught.',
    items: { head: 'bareHead', neck: 'bareNeck', under: 'shirt', mail: 'noMail', plate: 'noPlate', cover: 'noCover', arms: 'bareArms', hands: 'gloves', legs: 'hose', feet: 'shoes' },
  },
  militia: {
    name: 'Prague militiaman',
    description: 'Kettle hat, mail standard and a thick gambeson — the levy of the Wenceslas Bible.',
    items: { head: 'kettleHat', neck: 'mailStandard', under: 'gambeson', mail: 'noMail', plate: 'noPlate', cover: 'noCover', arms: 'bareArms', hands: 'gloves', legs: 'hose', feet: 'shoes' },
  },
  squire: {
    name: 'Squire',
    description: 'Open bascinet, haubergeon and brigandine, splinted arms, gamboised legs.',
    items: { head: 'openBascinet', neck: 'bareNeck', under: 'armingDoublet', mail: 'haubergeon', plate: 'brigandine', cover: 'noCover', arms: 'splints', hands: 'gauntlets', legs: 'gamboised', feet: 'shoes' },
  },
  knight: {
    name: 'Knight, full harness',
    description: 'Hounskull, mail and breastplate under a jupon, plate arms and legs: c. 39 kg.',
    items: { head: 'hounskull', neck: 'bareNeck', under: 'armingDoublet', mail: 'haubergeon', plate: 'breastplate', cover: 'jupon', arms: 'plateArms', hands: 'gauntlets', legs: 'plateLegs', feet: 'sabatons' },
  },
};

export const ARMOUR_BY_SLOT = Object.fromEntries(SLOTS.map((s) => [s.id, Object.keys(ARMOUR).filter((k) => ARMOUR[k].slot === s.id)]));

/** Total mass of a loadout (kg). */
export function loadoutMass(items) {
  let m = 0;
  for (const id of Object.values(items)) m += ARMOUR[id]?.mass ?? 0;
  return m;
}
