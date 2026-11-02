/**
 * The cast, as recipes for the Med Engine Human builder (medengine/tools/human/build.mjs).
 * Macro values are 0..1: age 0.5 = 25 years, 1 = 90 (so 30 ≈ 0.54, 45 ≈ 0.65, 64 ≈ 0.8).
 * Garments come from the MakeHuman community asset packs (CC0, a few CC-BY: see CREDITS.md);
 * `material` re-dresses a garment in one of the engine's own materials (leather, wool, the
 * suit...), keeping the original's folds and seams as shading. The cowl, cape, belt and emblem
 * are built by the engine at load (src/human/Garments.js).
 */
const leather = (c = [0.035, 0.032, 0.03], extra = {}) => ({ kind: 'leather', color: c, ...extra });
const wool = (c) => ({ kind: 'wool', color: c });

export const RECIPES = [
  {
    id: 'batman', name: 'Noah Vale',
    macro: { gender: 1, age: 0.54, muscle: 0.9, weight: 0.62, heightM: 1.88, proportions: 0.95, race: { caucasian: 0.85, asian: 0.15 } },
    details: { 'chin/chin-width-incr': 0.6, 'chin/chin-prominent-incr': 0.4, 'neck/neck-scale-horiz-incr': 0.6, 'mouth/mouth-scale-horiz-incr': 0.15 },
    skin: 'young_caucasian_male2', brows: 'eyebrow006', lashes: 'eyelashes02', eyes: { material: 'grey' },
    clothes: [
      { name: 'culturalibre_hero_suit_1', material: { kind: 'batsuit' } },
      { name: 'toigo_gloves_long', material: leather([0.025, 0.025, 0.028], { gauntlet: true }) },
      { name: 'punkduck_riding_boots', material: leather([0.025, 0.025, 0.027]) },
    ],
    meta: { garments: ['cowl', 'cape', 'belt', 'emblem'], voice: { pitch: 0.82, rate: 0.92 } },
  },
  {
    id: 'rook', name: 'Victor "Rook" Salas',
    macro: { gender: 1, age: 0.55, muscle: 0.72, weight: 0.55, heightM: 1.8, proportions: 0.7, race: { caucasian: 0.9, african: 0.1 } },
    details: { 'nose/nose-scale-horiz-incr': 0.3, 'chin/chin-width-incr': 0.35, 'head/head-square': 0.4, 'ears/r-ear-scale-decr': 0.2, 'ears/l-ear-scale-decr': 0.2 },
    skin: 'middleage_caucasian_male', brows: 'eyebrow003', lashes: 'eyelashes01', eyes: { material: 'lightblue' },
    clothes: ['male_casualsuit06', { name: 'elvs_emt_uniform_jacket_male', material: leather([0.03, 0.028, 0.026]) }, 'mindfront_shoes_biker_boots_male'],
    meta: { garments: ['buzzcut'], voice: { pitch: 0.9, rate: 1.0 } },
  },
  {
    id: 'nadia', name: 'Nadia Okafor',
    macro: { gender: 0, age: 0.53, muscle: 0.45, weight: 0.42, heightM: 1.67, proportions: 0.85, race: { african: 0.9, caucasian: 0.1 } },
    skin: 'young_african_female', brows: 'eyebrow011', lashes: 'eyelashes04', eyes: { material: 'brown' }, hair: 'toigo_curled_under_bob',
    clothes: ['female_elegantsuit01', 'mindfront_shoes_oxford_female'],
    meta: { hairColor: [0.05, 0.035, 0.025], voice: { pitch: 1.08, rate: 1.04 } },
  },
  {
    id: 'cruz', name: 'Det. Renata Cruz',
    macro: { gender: 0, age: 0.66, muscle: 0.55, weight: 0.5, heightM: 1.69, proportions: 0.7, race: { caucasian: 0.55, african: 0.2, asian: 0.25 } },
    details: { 'nose/nose-hump-incr': 0.3 },
    skin: 'middleage_caucasian_female', brows: 'eyebrow009', lashes: 'eyelashes03', eyes: { material: 'brownlight' }, hair: 'rehmanpolanski_hair_bun_brown',
    clothes: ['toigo_female_suit', { name: 'mindfront_cardigan_long_open_front', material: wool([0.42, 0.33, 0.22]) }, 'mindfront_shoes_biker_boots_female'],
    meta: { skinTint: [0.93, 0.85, 0.76], voice: { pitch: 0.98, rate: 1.0 } },
  },
  {
    id: 'marrow', name: 'Silas Marrow',
    macro: { gender: 1, age: 0.8, muscle: 0.35, weight: 0.22, heightM: 1.87, proportions: 0.6, race: { caucasian: 1 } },
    details: { 'cheek/l-cheek-inner-decr': 0.6, 'cheek/r-cheek-inner-decr': 0.6, 'nose/nose-scale-vert-incr': 0.4, 'chin/chin-prominent-incr': 0.3 },
    skin: 'old_caucasian_male', brows: 'eyebrow002', lashes: 'eyelashes01', eyes: { material: 'ice' }, hair: 'short02',
    clothes: ['toigo_male_double-breasted_suit', { name: 'mindfront_cardigan_long_open_front', material: wool([0.03, 0.03, 0.035]) }, { name: 'fedora01', material: wool([0.05, 0.05, 0.055]) }, 'mindfront_shoes_oxford_male'],
    meta: { voice: { pitch: 0.75, rate: 0.86 } },
  },
  {
    id: 'kow', name: 'Kowalski',
    macro: { gender: 1, age: 0.6, muscle: 0.78, weight: 0.85, heightM: 1.91, proportions: 0.4, race: { caucasian: 1 } },
    details: { 'neck/neck-scale-horiz-incr': 0.8 },
    skin: 'skins02_cc0/skins/jartur69_middleage_slavic_male_with_genitals_and_beard/jartur69_middleage_slavic_male_with_genitals_and_beard.mhmat',
    brows: 'eyebrow001', lashes: 'eyelashes01', eyes: { material: 'grey' }, hair: 'short04',
    clothes: ['male_casualsuit03', 'shoes02'],
    meta: { voice: { pitch: 0.7, rate: 0.95 } },
  },
  {
    id: 'dez', name: 'Dez',
    macro: { gender: 1, age: 0.51, muscle: 0.42, weight: 0.35, heightM: 1.76, proportions: 0.6, race: { african: 0.75, caucasian: 0.25 } },
    skin: 'young_african_male', brows: 'eyebrow004', lashes: 'eyelashes01', eyes: { material: 'brown' }, hair: 'short01',
    clothes: ['elvs_hooded_sweat_jacket1', 'cortu_cargo_pants', 'culturalibre_sneakers'],
    meta: { voice: { pitch: 1.05, rate: 1.12 } },
  },
  {
    id: 'deckhand', name: 'Deckhand',
    macro: { gender: 1, age: 0.62, muscle: 0.6, weight: 0.6, heightM: 1.74, proportions: 0.5, race: { asian: 0.7, caucasian: 0.3 } },
    skin: 'middleage_asian_male', brows: 'eyebrow007', lashes: 'eyelashes01', eyes: { material: 'brown' }, hair: 'short03',
    clothes: ['elvs_male_coveralls_1', 'punkduck_winter_boots'],
    meta: { voice: { pitch: 0.85, rate: 0.95 } },
  },
];
