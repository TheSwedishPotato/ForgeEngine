/**
 * The armoury of 1403: weapons a Bohemian, German, Hungarian or Cuman
 * fighter could have carried that year.
 *
 * Geometry is given in the weapon's "hilt frame": origin where the blade (or
 * head) meets the hilt/haft, +Y towards the point or head, +X the direction
 * the true (long) edge faces, +Z the flat. The physics body is built from
 * these parts (mass, centre of mass, inertia, collision shapes), so a
 * heavier or longer weapon really is slower to move and hits harder.
 *
 * Part kinds:
 *   blade  y0..y1, width at base/tip, edges: 2 | 1 (back is blunt), point
 *   cross  quillons along X, half-width
 *   grip   y0..y1
 *   pommel sphere at y
 *   haft   y0..y1 (wood)
 *   head   striking heads: axe (+X edge), hammer (-X or +X face), spike, beak, flanges
 *   rondel disc at y
 *
 * damage:
 *   edge   0..1 sharpness of the cutting edge (0 = none)
 *   point  0..1 how acute/stiff the point is (armour-piercing thrusts)
 *   blunt  0..1 how much of a blow arrives as concentrated blunt force
 */
export const WEAPONS = {
  longsword: {
    name: 'Longsword',
    native: 'langes Schwert · dlouhý meč',
    type: 'Oakeshott type XVa',
    date: 'c. 1350–1450',
    hands: 2,
    description: 'A hand-and-a-half sword with a stiff, acutely pointed blade of flattened-diamond section, made to thrust into the gaps of plate and still cut well. 1.20 m overall, about 1.4 kg, balance about 12 cm in front of the cross. Used unarmoured (Blossfechten) and, gripped at the half-sword, in armour (Kampffechten).',
    sources: ['oakeshott', 'hs3227a', 'fiore'],
    parts: [
      { kind: 'blade', y0: 0.0, y1: 0.92, w0: 0.05, w1: 0.012, t0: 0.0085, t1: 0.004, edges: 2, mass: 0.84, com: 0.32, r: 0.015 },
      { kind: 'cross', half: 0.13, y: -0.005, r: 0.011, mass: 0.17 },
      { kind: 'grip', y0: -0.245, y1: -0.012, r: 0.016, mass: 0.1 },
      { kind: 'pommel', y: -0.27, r: 0.03, mass: 0.26, shape: 'wheel' },
    ],
    grips: { main: -0.045, off: -0.2, half: 0.46, mord: [0.78, 0.5] },
    damage: { edge: 1, point: 0.85, blunt: 0.25 },
    systems: ['liechtenauer', 'fiore', 'halfsword'],
    look: { steel: '#c9ccd0', grip: '#3a2618', guard: '#9aa0a8' },
  },
  armingSword: {
    name: 'Arming sword',
    native: 'Schwert · meč',
    type: 'Oakeshott type XV, one-handed',
    date: 'c. 1290–1450',
    hands: 1,
    description: 'The single-handed knightly sword, tapering to a strong point. Carried with the buckler by townsmen and fencers, and at the side of every man-at-arms. 0.95 m, about 1.1 kg.',
    sources: ['oakeshott', 'i33'],
    parts: [
      { kind: 'blade', y0: 0.0, y1: 0.78, w0: 0.048, w1: 0.012, t0: 0.008, t1: 0.004, edges: 2, mass: 0.7, com: 0.31, r: 0.015 },
      { kind: 'cross', half: 0.1, y: -0.005, r: 0.01, mass: 0.12 },
      { kind: 'grip', y0: -0.105, y1: -0.012, r: 0.015, mass: 0.06 },
      { kind: 'pommel', y: -0.128, r: 0.026, mass: 0.2, shape: 'wheel' },
    ],
    grips: { main: -0.055 },
    damage: { edge: 1, point: 0.75, blunt: 0.2 },
    systems: ['i33'],
    look: { steel: '#c4c8cc', grip: '#5a3a22', guard: '#a3a8ae' },
  },
  messer: {
    name: 'Long knife (Messer)',
    native: 'langes Messer · tesák',
    type: 'Knife-hilted, single-edged, with Nagel',
    date: '14th–16th c.',
    hands: 1,
    description: 'A single-edged "long knife" with a knife-maker\'s slab grip and a nail (Nagel) jutting from the cross to cover the hand. Legally a knife, not a sword, so burghers and peasants could carry it. 0.95 m, about 1.1 kg, the weight well forward for cutting.',
    sources: ['messer', 'leckuchner'],
    parts: [
      { kind: 'blade', y0: 0.0, y1: 0.74, w0: 0.038, w1: 0.03, t0: 0.006, t1: 0.003, edges: 1, curve: 0.025, clip: 0.14, mass: 0.72, com: 0.36, r: 0.016 },
      { kind: 'cross', half: 0.085, y: -0.005, r: 0.009, mass: 0.09, nagel: true },
      { kind: 'grip', y0: -0.13, y1: -0.012, r: 0.015, mass: 0.12, slab: true },
      { kind: 'pommel', y: -0.145, r: 0.02, mass: 0.12, shape: 'cap' },
    ],
    grips: { main: -0.065 },
    damage: { edge: 1, point: 0.45, blunt: 0.25 },
    systems: ['messer', 'i33'],
    look: { steel: '#bfc3c7', grip: '#6b4426', guard: '#8f959c' },
  },
  sabre: {
    name: 'Hungarian sabre',
    native: 'szablya · šavle',
    type: 'Curved, single-edged, with back edge at the point',
    date: '13th–15th c. (Hungary)',
    hands: 1,
    description: 'The curved cavalry sabre of the Hungarian kingdom and its Cuman horsemen, rooted in steppe tradition: light, quick, made for drawing cuts. Sigismund\'s army brought it into Bohemia in 1402–03. 0.92 m, about 1.0 kg.',
    sources: ['cumans', 'sigismund'],
    parts: [
      { kind: 'blade', y0: 0.0, y1: 0.8, w0: 0.034, w1: 0.022, t0: 0.006, t1: 0.003, edges: 1, curve: 0.06, clip: 0.2, mass: 0.62, com: 0.36, r: 0.015 },
      { kind: 'cross', half: 0.06, y: -0.005, r: 0.009, mass: 0.08 },
      { kind: 'grip', y0: -0.105, y1: -0.012, r: 0.015, mass: 0.1 },
      { kind: 'pommel', y: -0.118, r: 0.018, mass: 0.1, shape: 'cap' },
    ],
    grips: { main: -0.055 },
    damage: { edge: 1, point: 0.35, blunt: 0.2 },
    systems: ['onehand'],
    look: { steel: '#c7c9cc', grip: '#2d2016', guard: '#8b6b3a' },
  },
  poleaxe: {
    name: 'Poleaxe',
    native: 'Mordaxt · azza · sekera',
    type: 'Axe blade, hammer, top spike and butt spike',
    date: 'mid-14th c. onward',
    hands: 2,
    description: 'The knight\'s weapon for foot combat in armour: an axe blade backed by a hammer, a long top spike and a spiked butt, on a 1.75 m haft guarded by steel langets. About 2.3 kg. The hammer stuns through a helmet, the spikes seek the gaps.',
    sources: ['poleaxe', 'fiore'],
    parts: [
      { kind: 'haft', y0: -1.55, y1: 0.06, r: 0.017, mass: 1.0 },
      { kind: 'head', sub: 'spike', y0: 0.06, y1: 0.24, r: 0.012, mass: 0.22 },
      { kind: 'head', sub: 'axe', y0: -0.06, y1: 0.08, x: 0.11, r: 0.03, mass: 0.6 },
      { kind: 'head', sub: 'hammer', y0: -0.03, y1: 0.03, x: -0.07, r: 0.024, mass: 0.38 },
      { kind: 'head', sub: 'butt', y0: -1.66, y1: -1.55, r: 0.012, mass: 0.1 },
    ],
    grips: { main: -1.12, off: -0.5 },
    damage: { edge: 0.8, point: 1, blunt: 1 },
    systems: ['azza'],
    look: { steel: '#b7bbbf', haft: '#5b3d24', grip: '#5b3d24' },
  },
  spear: {
    name: 'Spear',
    native: 'Spieß · kopí',
    type: 'Leaf-bladed infantry spear',
    date: 'all periods',
    hands: 2,
    description: 'An ash-hafted spear of about 2.2 m with a leaf-shaped head and an iron butt. The cheapest and most common weapon of the Bohemian levy, and in Fiore\'s hands a duelling weapon. About 2.0 kg.',
    sources: ['heath', 'fiore'],
    parts: [
      { kind: 'haft', y0: -1.92, y1: 0.0, r: 0.016, mass: 1.45 },
      { kind: 'blade', y0: 0.0, y1: 0.3, w0: 0.045, w1: 0.008, t0: 0.012, t1: 0.004, edges: 2, mass: 0.42, com: 0.1, r: 0.014, leaf: true },
      { kind: 'head', sub: 'butt', y0: -2.0, y1: -1.92, r: 0.014, mass: 0.12 },
    ],
    grips: { main: -1.45, off: -0.78 },
    damage: { edge: 0.7, point: 0.9, blunt: 0.4 },
    systems: ['spear'],
    look: { steel: '#b5b9bd', haft: '#7a5634', grip: '#7a5634' },
  },
  sudlice: {
    name: 'Sudlice',
    native: 'sudlice (kůsa)',
    type: 'Bohemian thrusting-and-cutting polearm, early form',
    date: '14th c. (Bohemia)',
    hands: 2,
    description: 'A Bohemian polearm: a long, narrow, single-edged blade on a 2 m haft, good for thrusting and for drawing cuts, the forerunner of the eared "Bohemian earspoon". About 2.3 kg.',
    sources: ['sudlice', 'heath'],
    parts: [
      { kind: 'haft', y0: -1.6, y1: 0.0, r: 0.017, mass: 1.35 },
      { kind: 'blade', y0: 0.0, y1: 0.48, w0: 0.05, w1: 0.012, t0: 0.008, t1: 0.004, edges: 1, mass: 0.82, com: 0.18, r: 0.016 },
      { kind: 'head', sub: 'butt', y0: -1.68, y1: -1.6, r: 0.014, mass: 0.12 },
    ],
    grips: { main: -1.2, off: -0.58 },
    damage: { edge: 0.85, point: 0.85, blunt: 0.4 },
    systems: ['spear'],
    look: { steel: '#b0b4b8', haft: '#6a4a2c', grip: '#6a4a2c' },
  },
  warHammer: {
    name: 'War hammer',
    native: 'Streithammer · válečné kladivo',
    type: 'Hammer face with a back beak',
    date: 'late 14th c. onward',
    hands: 1,
    description: 'A short hammer with a faceted face backed by a curved beak, on a haft strengthened with steel langets. The face dents and stuns through plate; the beak concentrates a blow on a point small enough to punch through thin plate or mail. About 1.0 kg.',
    sources: ['hammer'],
    parts: [
      { kind: 'haft', y0: -0.56, y1: 0.03, r: 0.015, mass: 0.42 },
      { kind: 'head', sub: 'hammer', y0: -0.025, y1: 0.025, x: -0.05, r: 0.022, mass: 0.26 },
      { kind: 'head', sub: 'beak', y0: -0.02, y1: 0.02, x: 0.1, r: 0.012, mass: 0.2 },
      { kind: 'head', sub: 'spike', y0: 0.03, y1: 0.09, r: 0.01, mass: 0.06 },
    ],
    grips: { main: -0.45 },
    damage: { edge: 0, point: 1, blunt: 1 },
    systems: ['onehand'],
    look: { steel: '#a9adb2', haft: '#4a3220', grip: '#3a2618' },
  },
  mace: {
    name: 'Flanged mace',
    native: 'Streitkolben · palcát',
    type: 'Steel head with six flanges',
    date: '12th–16th c.',
    hands: 1,
    description: 'An all-steel mace whose six flanges bite into plate instead of skidding off it. The palcát was the commander\'s and horseman\'s club of Bohemia and Hungary. About 1.4 kg.',
    sources: ['hammer', 'cumans'],
    parts: [
      { kind: 'haft', y0: -0.5, y1: 0.0, r: 0.014, mass: 0.6 },
      { kind: 'head', sub: 'flanges', y0: 0.0, y1: 0.12, r: 0.045, mass: 0.8 },
    ],
    grips: { main: -0.41 },
    damage: { edge: 0, point: 0, blunt: 1 },
    systems: ['onehand'],
    look: { steel: '#9ea3a8', haft: '#8d9196', grip: '#3a2618' },
  },
  dagger: {
    name: 'Rondel dagger',
    native: 'Scheibendolch · dýka',
    type: 'Stiff triangular blade between two discs',
    date: 'mid-14th – mid-16th c.',
    hands: 1,
    description: 'The knight\'s dagger: a stiff, triangular-section spike between two discs that stop the hand slipping. Held point-down for a hammering overhand stab into the gaps of a harness. 0.38 m, 0.35 kg.',
    sources: ['dagger', 'fiore'],
    parts: [
      { kind: 'blade', y0: 0.0, y1: 0.26, w0: 0.022, w1: 0.006, t0: 0.012, t1: 0.004, edges: 2, mass: 0.17, com: 0.09, r: 0.011, triangular: true },
      { kind: 'rondel', y: -0.006, r: 0.032, mass: 0.06 },
      { kind: 'grip', y0: -0.105, y1: -0.012, r: 0.014, mass: 0.05 },
      { kind: 'rondel', y: -0.112, r: 0.03, mass: 0.07 },
    ],
    grips: { main: -0.058 },
    damage: { edge: 0.2, point: 1, blunt: 0.1 },
    systems: ['dagger'],
    look: { steel: '#c2c6ca', grip: '#3a2618', guard: '#9aa0a8' },
  },
};

export const OFFHAND = {
  none: { name: 'Nothing', native: '', description: 'The off hand stays free (or on the weapon).' },
  buckler: {
    name: 'Buckler',
    native: 'Buckler · puklíř',
    date: '13th–16th c.',
    description: 'A small round fist-shield, about 30 cm across, held at arm\'s length. In Ms. I.33 it never leaves the sword hand: it covers the hand while the sword works. About 0.8 kg.',
    sources: ['i33'],
    mass: 0.8,
    radius: 0.15,
    oneHandOnly: true,
  },
};

export const WEAPON_ORDER = ['longsword', 'armingSword', 'messer', 'sabre', 'poleaxe', 'spear', 'sudlice', 'warHammer', 'mace', 'dagger'];
