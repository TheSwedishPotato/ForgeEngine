/**
 * Guards (Huten, Leger, poste, custodiae) of the period fighting systems.
 *
 * Positions are for a right-handed fighter of 1.80 m, in the fight frame:
 *   [forward (towards the opponent), left, height above ground] in metres.
 *   hand  where the main (right) hand holds the grip
 *   dir   where the blade / head points (unit vector, normalised at load)
 *   edge  roughly which way the true edge faces
 *   lead  which foot is forward
 *   off   (one-handed weapons) where the off hand or buckler is held
 *   twist chest rotation towards the left (deg); crouch: extra knee bend (m)
 *   covers the lines the guard closes; brokenBy: the technique that breaks it
 *
 * Coordinates are this game's reading of the sources' text and pictures;
 * where the sources leave a detail open (which foot, exact height), the
 * common modern interpretation is used.
 */
export const SYSTEMS = {
  liechtenauer: {
    name: 'Liechtenauer — Blossfechten',
    short: 'Liechtenauer',
    description: 'Johannes Liechtenauer\'s art of the long sword as recorded in Hs. 3227a (1389): four guards, five master strikes, and the fight in the bind. "Vier leger allein — davon halt und fleuch die gemein: Ochs, Pflug, Alber, vom Tag."',
    sources: ['hs3227a', 'ringeck'],
    naming: 'liechtenauer',
  },
  fiore: {
    name: 'Fiore dei Liberi — spada a due mani',
    short: 'Fiore (1409)',
    description: 'The guards (poste) of the two-handed sword in Fiore\'s Flos Duellatorum, written in 1409 — six years after our duel. Blows are named by direction: fendente (falling), mezzano (middle), sottano (rising), from the right (mandritto) or the left (roverso), and the punta (thrust).',
    sources: ['fiore'],
    naming: 'fiore',
  },
  halfsword: {
    name: 'Kampffechten — the half-sword in harness',
    short: 'Halbschwert',
    description: 'Fighting in armour: the left hand grips the middle of the blade so the point can be placed into the gaps — face, armpits, palms, hollows of the knees, between the legs. Swing from here and you strike with the cross and pommel: the Mordschlag.',
    sources: ['hs3227a', 'ringeck', 'danzig'],
    naming: 'halfsword',
  },
  i33: {
    name: 'Ms. I.33 — sword and buckler',
    short: 'I.33',
    description: 'The seven wards of the oldest fight book (c. 1300). The buckler stays with the sword hand and covers it.',
    sources: ['i33'],
    naming: 'i33',
  },
  messer: {
    name: 'Messer — Lecküchner',
    short: 'Messer',
    description: 'Johannes Lecküchner (1478/82) taught the messer on Liechtenauer\'s model, renaming the guards: Stier, Eber, Bastei, Luginsland. The weapon was common in 1403; the book that names these guards is later.',
    sources: ['leckuchner', 'messer'],
    naming: 'liechtenauer',
  },
  onehand: {
    name: 'One-handed weapon (after Ms. I.33)',
    short: 'One hand',
    description: 'No fight book of 1403 teaches the sabre, war hammer or mace on foot. These positions follow the one-handed sword wards of Ms. I.33.',
    sources: ['i33'],
    naming: 'onehand',
  },
  azza: {
    name: 'Fiore — the poleaxe (azza) in armour',
    short: 'Azza',
    description: 'Fiore\'s poleaxe plays in harness (1409): great blows with the hammer or axe, thrusts with the top spike, and the butt.',
    sources: ['fiore', 'poleaxe'],
    naming: 'azza',
  },
  spear: {
    name: 'Fiore — the spear',
    short: 'Spear',
    description: 'Positions from Fiore\'s spear plays (1409). The spear thrusts; a beat with the haft clears the way.',
    sources: ['fiore'],
    naming: 'spear',
  },
  dagger: {
    name: 'Fiore — the dagger',
    short: 'Dagger',
    description: 'Fiore teaches the dagger as the weapon that ends fights in armour: the overhand fendente, the rising sottano, the thrust. The left hand guards and seizes.',
    sources: ['fiore', 'dagger'],
    naming: 'dagger',
  },
};

export const GUARDS = {
  // ---- Liechtenauer (Hs. 3227a) ---------------------------------------------
  liechtenauer: [
    {
      id: 'vomTag', name: 'Vom Tag', translation: 'from the roof',
      hand: [0.12, -0.14, 1.36], dir: [-0.2, 0.05, 0.98], edge: [1, 0, 0], lead: 'L',
      covers: ['high'], brokenBy: 'zwerchhau',
      text: 'The sword held at the right shoulder (or above the head), point up. Every Oberhau starts here; the Zornhau falls from it.',
    },
    {
      id: 'ochsR', name: 'Ochs (right)', translation: 'the ox',
      hand: [0.15, -0.17, 1.6], dir: [0.9, 0.18, -0.26], edge: [0.3, 0, 1], lead: 'L', twist: 8,
      covers: ['high', 'right'], brokenBy: 'krumphau',
      text: 'The hilt beside the right side of the head, the point at the opponent\'s face like a horn. Covers the upper right; threatens a thrust.',
    },
    {
      id: 'ochsL', name: 'Ochs (left)', translation: 'the ox',
      hand: [0.15, 0.13, 1.6], dir: [0.9, -0.2, -0.26], edge: [0.3, 0, 1], lead: 'R', twist: -10,
      covers: ['high', 'left'], brokenBy: 'krumphau',
      text: 'The same horn held at the left side of the head.',
    },
    {
      id: 'pflugR', name: 'Pflug (right)', translation: 'the plough',
      hand: [0.25, -0.13, 1.0], dir: [0.85, 0.15, 0.5], edge: [0, 0, -1], lead: 'L',
      covers: ['mid', 'low', 'right'], brokenBy: 'schielhau',
      text: 'The pommel at the right hip, the point rising at the opponent\'s face or chest, like the handle of a plough.',
    },
    {
      id: 'pflugL', name: 'Pflug (left)', translation: 'the plough',
      hand: [0.25, 0.12, 1.0], dir: [0.85, -0.15, 0.5], edge: [0, 0, -1], lead: 'R',
      covers: ['mid', 'low', 'left'], brokenBy: 'schielhau',
      text: 'The plough from the left hip.',
    },
    {
      id: 'alber', name: 'Alber', translation: 'the fool',
      hand: [0.38, -0.03, 1.0], dir: [0.55, 0.05, -0.83], edge: [0.6, 0, 0.4], lead: 'R',
      covers: ['low'], brokenBy: 'scheitelhau',
      text: 'The arms hang forward, the point at the ground: it looks open and invites a blow — to be met from below.',
    },
    {
      id: 'langort', name: 'Langort', translation: 'the long point',
      hand: [0.5, -0.03, 1.33], dir: [0.99, 0.03, 0.08], edge: [0, 0, -1], lead: 'L',
      covers: ['mid', 'high'],
      text: 'Arms extended, the point at the face. The end of every cut and thrust, and a barrier in itself.',
    },
  ],

  // ---- Fiore dei Liberi (1409) --------------------------------------------------
  fiore: [
    {
      id: 'donna', name: 'Posta di Donna', translation: 'the woman\'s guard',
      hand: [0.08, -0.17, 1.47], dir: [-0.8, -0.1, 0.55], edge: [0, 0, 1], lead: 'L', twist: -12,
      covers: ['high'],
      text: 'Sword on the right shoulder, point behind. Fiore: she can make all seven blows of the sword and cover against them.',
    },
    {
      id: 'finestra', name: 'Posta di Finestra', translation: 'the window',
      hand: [0.12, -0.18, 1.62], dir: [0.92, 0.2, -0.2], edge: [0.3, 0, 1], lead: 'L', twist: 8,
      covers: ['high', 'right'],
      text: 'The hilt high at the right temple, the point at the face: a high, cunning guard that covers and strikes in one motion.',
    },
    {
      id: 'longa', name: 'Posta Longa', translation: 'the long guard',
      hand: [0.5, -0.02, 1.35], dir: [0.98, 0.02, 0.12], edge: [0, 0, -1], lead: 'L',
      covers: ['mid', 'high'],
      text: 'Arms and sword stretched out at the opponent: it searches with the point.',
    },
    {
      id: 'breve', name: 'Posta Breve', translation: 'the short guard',
      hand: [0.22, -0.04, 1.2], dir: [0.96, 0.03, 0.2], edge: [0, 0, -1], lead: 'L',
      covers: ['mid'],
      text: 'The sword drawn back to the chest, point forward, ready to thrust.',
    },
    {
      id: 'dente', name: 'Dente di Zenghiaro', translation: 'the boar\'s tusk',
      hand: [0.22, 0.06, 0.95], dir: [0.72, -0.08, 0.68], edge: [0, 0, -1], lead: 'R',
      covers: ['low', 'mid'],
      text: 'Hands low, the point rising — it strikes upward like the boar\'s tusk.',
    },
    {
      id: 'tuttaPorta', name: 'Tutta Porta di Ferro', translation: 'the whole iron door',
      hand: [0.2, -0.12, 0.92], dir: [0.45, 0.55, -0.7], edge: [0.5, 0, 0.5], lead: 'R',
      covers: ['low', 'mid'],
      text: 'A strong, stable guard low across the body, point to the ground: it waits for the blow and closes the door.',
    },
    {
      id: 'mezzaPorta', name: 'Mezza Porta di Ferro', translation: 'the middle iron door',
      hand: [0.3, -0.02, 0.93], dir: [0.62, 0.02, -0.78], edge: [0.6, 0, 0.4], lead: 'R',
      covers: ['low', 'mid'],
      text: 'The sword low in the middle, point down in front: from here every blow is beaten aside.',
    },
  ],

  // ---- Kampffechten: half-sword --------------------------------------------------
  halfsword: [
    {
      id: 'halbOben', name: 'Upper half-sword guard', translation: 'obere Hut',
      hand: [0.08, -0.2, 1.62], dir: [0.82, 0.22, -0.52], edge: [0, 0, 1], lead: 'L',
      covers: ['high'],
      text: 'Right hand on the grip high beside the head, left hand on the middle of the blade, the point down at his face — thrust from above into the visor or the throat.',
    },
    {
      id: 'halbAchsel', name: 'Grip under the arm', translation: 'unter der rechten Achsel',
      hand: [0.02, -0.17, 1.25], dir: [0.95, 0.15, 0.25], edge: [0, 0, 1], lead: 'L',
      covers: ['mid'],
      text: 'Hundfeld\'s guard: the grip under the right armpit, the hilt at the right breast, the point out at the opponent (Peter von Danzig, 1452).',
    },
    {
      id: 'halbUnten', name: 'Lower half-sword guard', translation: 'untere Hut',
      hand: [0.1, -0.14, 1.0], dir: [0.8, 0.12, 0.58], edge: [0, 0, 1], lead: 'L',
      covers: ['low', 'mid'],
      text: 'The hilt low at the right hip, the point rising at the face: thrust upward under the arms or into the face.',
    },
  ],

  // ---- Ms. I.33 -------------------------------------------------------------------
  i33: [
    {
      id: 'prima', name: 'Prima custodia', translation: 'under the arm (sub brachio)',
      hand: [0.1, 0.12, 1.12], dir: [-0.75, 0.45, -0.48], edge: [0, 1, 0], lead: 'R', off: [0.3, 0.08, 1.22], twist: 22,
      covers: ['mid', 'left'],
      text: 'The first ward: the sword drawn under the left arm, the buckler over the hand. The priest\'s favourite opening.',
    },
    {
      id: 'secunda', name: 'Secunda custodia', translation: 'right shoulder',
      hand: [0.05, -0.2, 1.5], dir: [-0.35, -0.1, 0.93], edge: [1, 0, 0], lead: 'L', off: [0.3, 0.02, 1.28],
      covers: ['high'],
      text: 'The second ward: sword over the right shoulder.',
    },
    {
      id: 'tertia', name: 'Tertia custodia', translation: 'left shoulder',
      hand: [0.08, 0.14, 1.48], dir: [-0.4, 0.25, 0.88], edge: [1, 0, 0], lead: 'L', off: [0.32, 0.02, 1.25], twist: 15,
      covers: ['high', 'left'],
      text: 'The third ward: sword over the left shoulder.',
    },
    {
      id: 'quarta', name: 'Quarta custodia', translation: 'over the head',
      hand: [0.08, -0.08, 1.86], dir: [-0.55, -0.1, 0.83], edge: [1, 0, 0], lead: 'L', off: [0.3, 0.05, 1.42],
      covers: ['high'],
      text: 'The fourth ward: sword raised above the head.',
    },
    {
      id: 'quinta', name: 'Quinta custodia', translation: 'right side',
      hand: [0.05, -0.26, 1.05], dir: [-0.55, -0.35, -0.75], edge: [0, -1, 0], lead: 'L', off: [0.32, 0.0, 1.2], twist: -15,
      covers: ['low', 'right'],
      text: 'The fifth ward: sword at the right side, point back.',
    },
    {
      id: 'sexta', name: 'Sexta custodia', translation: 'breast',
      hand: [0.22, -0.05, 1.28], dir: [0.95, 0.05, 0.15], edge: [0, 0, -1], lead: 'L', off: [0.28, 0.06, 1.3],
      covers: ['mid'],
      text: 'The sixth ward: sword at the breast, point forward.',
    },
    {
      id: 'langortI33', name: 'Septima — langort', translation: 'the long point',
      hand: [0.48, -0.03, 1.15], dir: [0.95, 0.02, -0.25], edge: [0, 0, -1], lead: 'L', off: [0.42, 0.04, 1.18],
      covers: ['mid', 'low'],
      text: 'The last ward: sword and buckler stretched out together.',
    },
  ],

  // ---- Messer (Lecküchner) -------------------------------------------------------
  messer: [
    {
      id: 'stier', name: 'Stier', translation: 'the steer (= Ochs)',
      hand: [0.12, -0.18, 1.62], dir: [0.9, 0.2, -0.35], edge: [0.3, 0, 1], lead: 'L', off: [0.12, 0.2, 1.05],
      covers: ['high', 'right'], brokenBy: 'krumphau',
      text: 'The hilt at the head, the point at the face.',
    },
    {
      id: 'eber', name: 'Eber', translation: 'the boar (= Pflug)',
      hand: [0.25, -0.12, 1.02], dir: [0.85, 0.15, 0.48], edge: [0, 0, -1], lead: 'L', off: [0.12, 0.2, 1.05],
      covers: ['mid', 'low'], brokenBy: 'schielhau',
      text: 'The hilt at the hip, the point rising.',
    },
    {
      id: 'bastei', name: 'Bastei', translation: 'the bastion (= Alber)',
      hand: [0.32, -0.04, 0.98], dir: [0.5, 0.1, -0.86], edge: [0.6, 0, 0.4], lead: 'R', off: [0.12, 0.2, 1.05],
      covers: ['low'], brokenBy: 'scheitelhau',
      text: 'Low, the point to the ground.',
    },
    {
      id: 'luginsland', name: 'Luginsland', translation: 'the watchtower (= vom Tag)',
      hand: [0.0, -0.18, 1.85], dir: [-0.4, 0.05, 0.92], edge: [1, 0, 0], lead: 'L', off: [0.15, 0.18, 1.1],
      covers: ['high'], brokenBy: 'zwerchhau',
      text: 'The messer raised one-armed above the head.',
    },
    {
      id: 'zornhut', name: 'Zornhut', translation: 'the wrath guard',
      hand: [0.0, -0.2, 1.52], dir: [-0.75, -0.05, -0.65], edge: [0, 0, 1], lead: 'L', off: [0.15, 0.18, 1.1], twist: -18,
      covers: [],
      text: 'The blade hung behind the right shoulder, ready for the Zornhau.',
    },
  ],

  // ---- one-handed weapons (after I.33) --------------------------------------
  onehand: [
    {
      id: 'ohShoulder', name: 'Right shoulder', translation: 'after secunda custodia',
      hand: [0.05, -0.2, 1.5], dir: [-0.35, -0.1, 0.93], edge: [1, 0, 0], lead: 'L', off: [0.22, 0.16, 1.22],
      covers: ['high'],
      text: 'Weapon cocked over the right shoulder.',
    },
    {
      id: 'ohHigh', name: 'Over the head', translation: 'after quarta custodia',
      hand: [0.08, -0.08, 1.86], dir: [-0.55, -0.1, 0.83], edge: [1, 0, 0], lead: 'L', off: [0.25, 0.14, 1.3],
      covers: ['high'],
      text: 'Weapon raised over the head for the heaviest blow.',
    },
    {
      id: 'ohSide', name: 'Right side', translation: 'after quinta custodia',
      hand: [0.05, -0.26, 1.05], dir: [-0.55, -0.35, -0.75], edge: [0, -1, 0], lead: 'L', off: [0.25, 0.14, 1.25], twist: -15,
      covers: ['low', 'right'],
      text: 'Weapon at the right side, hidden behind the body.',
    },
    {
      id: 'ohBreast', name: 'At the breast', translation: 'after sexta custodia',
      hand: [0.22, -0.05, 1.28], dir: [0.95, 0.05, 0.15], edge: [0, 0, 1], lead: 'L', off: [0.22, 0.16, 1.25],
      covers: ['mid'],
      text: 'Weapon held short at the chest, pointing forward.',
    },
    {
      id: 'ohLong', name: 'Long point', translation: 'after langort',
      hand: [0.48, -0.03, 1.2], dir: [0.95, 0.02, -0.1], edge: [0, 0, 1], lead: 'L', off: [0.2, 0.16, 1.2],
      covers: ['mid', 'low'],
      text: 'Weapon stretched out at the opponent.',
    },
  ],

  // ---- poleaxe (Fiore's azza) --------------------------------------------------
  azza: [
    {
      id: 'azzaDonna', name: 'Posta di Donna (azza)', translation: 'the woman\'s guard',
      hand: [0.05, -0.15, 1.15], dir: [-0.35, -0.05, 0.94], edge: [-1, 0, 0], lead: 'L', twist: -10,
      covers: ['high'],
      text: 'The head raised over the right shoulder for the great blow.',
    },
    {
      id: 'azzaFinestra', name: 'Posta di Finestra (azza)', translation: 'the window',
      hand: [-0.05, -0.2, 1.55], dir: [0.85, 0.2, -0.1], edge: [0, 0, 1], lead: 'L',
      covers: ['high', 'mid'],
      text: 'The axe held high and forward, the spike at the face.',
    },
    {
      id: 'azzaBreve', name: 'Posta Breve (azza)', translation: 'the short guard',
      hand: [-0.08, -0.15, 1.0], dir: [0.9, 0.12, 0.42], edge: [0, 0, 1], lead: 'L',
      covers: ['mid'],
      text: 'The haft held at the hip, the spike forward at the chest.',
    },
    {
      id: 'azzaDente', name: 'Dente di Zenghiaro (azza)', translation: 'the boar\'s tusk',
      hand: [-0.15, -0.14, 1.2], dir: [0.82, 0.06, -0.15], edge: [0, 0, 1], lead: 'R',
      covers: ['low', 'mid'],
      text: 'The head low and forward, ready to rise into the opponent.',
    },
  ],

  // ---- spear and sudlice (Fiore) -------------------------------------------------
  spear: [
    {
      id: 'spearFinestra', name: 'Posta di Finestra (spear)', translation: 'the window',
      hand: [-0.1, -0.18, 1.6], dir: [0.93, 0.15, -0.3], edge: [0, 0, 1], lead: 'L',
      covers: ['high', 'mid'],
      text: 'The rear hand high at the right temple, the point down at the face.',
    },
    {
      id: 'spearBreve', name: 'Posta Breve (spear)', translation: 'the short guard',
      hand: [-0.22, -0.14, 1.02], dir: [0.97, 0.08, 0.2], edge: [0, 0, 1], lead: 'L',
      covers: ['mid'],
      text: 'The spear at the hip, the point at the chest.',
    },
    {
      id: 'spearDente', name: 'Dente di Zenghiaro (spear)', translation: 'the boar\'s tusk',
      hand: [-0.2, -0.12, 0.95], dir: [0.9, 0.05, 0.42], edge: [0, 0, 1], lead: 'R',
      covers: ['low', 'mid'],
      text: 'Hands low, the point rising at the face.',
    },
  ],

  // ---- dagger (Fiore) ----------------------------------------------------------
  dagger: [
    {
      id: 'dagFendente', name: 'Raised for the fendente', translation: 'overhand',
      hand: [0.05, -0.2, 1.7], dir: [0.35, 0.1, -0.93], edge: [1, 0, 0], lead: 'L', off: [0.3, 0.12, 1.32],
      covers: ['high'],
      text: 'The dagger held point-down above the shoulder for the falling stab.',
    },
    {
      id: 'dagSottano', name: 'Low for the sottano', translation: 'underhand',
      hand: [0.18, -0.15, 1.0], dir: [0.8, 0.1, 0.58], edge: [0, 0, 1], lead: 'L', off: [0.3, 0.12, 1.32],
      covers: ['low', 'mid'],
      text: 'The dagger low, point up, for the rising stab.',
    },
    {
      id: 'dagPunta', name: 'Point forward', translation: 'punta',
      hand: [0.25, -0.1, 1.25], dir: [0.97, 0.05, 0.2], edge: [0, 0, 1], lead: 'L', off: [0.32, 0.12, 1.35],
      covers: ['mid'],
      text: 'The dagger at the chest, point at the opponent; the left hand forward to guard and seize.',
    },
  ],
};

/**
 * Names of the blows by fighting system. The swipe direction picks the line:
 *   fromRight / fromLeft: which side the blow comes from (attacker's view)
 *   kind: 'high' (falling), 'vertical', 'mid' (horizontal), 'low' (rising), 'thrust'
 */
export const BLOW_NAMES = {
  liechtenauer: {
    zornhau: { name: 'Zornhau', translation: 'wrath strike', text: 'A strong diagonal Oberhau from the right with the long edge. "Wer dir oberhauet, Zornhau ort ihm dräuet."' },
    schielhau: { name: 'Schielhau', translation: 'squinting strike', text: 'A steep blow from the right with the short edge onto the shoulder or head. Breaks the Pflug.' },
    scheitelhau: { name: 'Scheitelhau', translation: 'parting strike', text: 'Straight down onto the crown, with long reach. Breaks the Alber.' },
    zwerchhau: { name: 'Zwerchhau', translation: 'thwart strike', text: 'Horizontal, the hilt held high over the head so it covers as it strikes. Breaks vom Tag.' },
    krumphau: { name: 'Krumphau', translation: 'crooked strike', text: 'From the right, crossing over, onto the hands, arms or blade. Breaks the Ochs.' },
    oberhauL: { name: 'Oberhau (left)', translation: 'high strike', text: 'A diagonal falling blow from the left.' },
    unterhauR: { name: 'Unterhau (right)', translation: 'low strike', text: 'A rising blow from below on the right.' },
    unterhauL: { name: 'Unterhau (left)', translation: 'low strike', text: 'A rising blow from below on the left.' },
    stich: { name: 'Stich', translation: 'thrust', text: 'The thrust with the long point.' },
  },
  fiore: {
    fendenteR: { name: 'Mandritto fendente', translation: 'forehand falling blow', text: 'A falling blow from the right, cutting through the teeth to the knee.' },
    fendenteV: { name: 'Fendente', translation: 'falling blow', text: 'Straight down.' },
    fendenteL: { name: 'Roverso fendente', translation: 'backhand falling blow', text: 'A falling blow from the left.' },
    mezzanoR: { name: 'Mandritto mezzano', translation: 'forehand middle blow', text: 'Horizontal from the right at the middle of the man.' },
    mezzanoL: { name: 'Roverso mezzano', translation: 'backhand middle blow', text: 'Horizontal from the left.' },
    sottanoR: { name: 'Mandritto sottano', translation: 'forehand rising blow', text: 'Rising from the right.' },
    sottanoL: { name: 'Roverso sottano', translation: 'backhand rising blow', text: 'Rising from the left.' },
    punta: { name: 'Punta', translation: 'thrust', text: 'The thrust, the most deadly blow.' },
  },
  halfsword: {
    halfThrust: { name: 'Half-sword thrust', translation: 'Stich am halben Schwert', text: 'A guided, powerful thrust aimed into a gap of the harness.' },
    mordschlag: { name: 'Mordschlag', translation: 'murder stroke', text: 'The sword reversed, gripped by the blade: the cross and pommel swung like a hammer at the helmet.' },
  },
  i33: {
    oberR: { name: 'Oberhau', translation: 'high blow', text: 'A falling blow from the right.' },
    oberL: { name: 'Oberhau (left)', translation: 'high blow', text: 'A falling blow from the left.' },
    scheitel: { name: 'Scheitelhau', translation: 'vertical blow', text: 'Straight down.' },
    mittelR: { name: 'Mittelhau', translation: 'middle blow', text: 'Horizontal from the right.' },
    mittelL: { name: 'Mittelhau (left)', translation: 'middle blow', text: 'Horizontal from the left.' },
    unterR: { name: 'Unterhau', translation: 'low blow', text: 'Rising from the right.' },
    unterL: { name: 'Unterhau (left)', translation: 'low blow', text: 'Rising from the left.' },
    stich: { name: 'Stich', translation: 'thrust', text: 'The thrust.' },
  },
  onehand: {
    oberR: { name: 'Overhead blow', translation: 'from the right', text: 'A falling blow from the right.' },
    oberL: { name: 'Backhand blow', translation: 'from the left', text: 'A falling blow from the left.' },
    scheitel: { name: 'Straight blow', translation: 'from above', text: 'Straight down onto the helmet.' },
    mittelR: { name: 'Side blow', translation: 'from the right', text: 'Horizontal from the right.' },
    mittelL: { name: 'Side blow (left)', translation: 'from the left', text: 'Horizontal from the left.' },
    unterR: { name: 'Rising blow', translation: 'from the right', text: 'Rising from the right.' },
    unterL: { name: 'Rising blow (left)', translation: 'from the left', text: 'Rising from the left.' },
    stich: { name: 'Thrust', translation: '', text: 'A thrust with the point.' },
    beak: { name: 'Beak blow', translation: 'with the spike', text: 'The beak driven at one point, to punch through plate or mail.' },
  },
  azza: {
    hammer: { name: 'Hammer blow', translation: 'colpo di martello', text: 'The great falling blow with the hammer face.' },
    axe: { name: 'Axe blow', translation: 'colpo di taglio', text: 'A blow with the axe blade.' },
    punta: { name: 'Punta', translation: 'thrust with the top spike', text: 'The top spike driven at the face, armpit or groin.' },
    butt: { name: 'Butt thrust', translation: 'with the queue', text: 'A short thrust with the spiked butt.' },
  },
  spear: {
    punta: { name: 'Punta', translation: 'thrust', text: 'The thrust with the spear.' },
    beat: { name: 'Beat with the haft', translation: 'colpo', text: 'A swinging blow with the haft to strike or clear.' },
  },
  dagger: {
    fendente: { name: 'Fendente', translation: 'overhand stab', text: 'The dagger driven down from above — into the visor, the throat, the armpit.' },
    sottano: { name: 'Sottano', translation: 'underhand stab', text: 'The rising stab from below.' },
    punta: { name: 'Punta', translation: 'thrust', text: 'The straight thrust.' },
  },
};

for (const list of Object.values(GUARDS)) {
  for (const g of list) {
    const n = Math.hypot(...g.dir);
    g.dir = g.dir.map((v) => v / n);
  }
}
