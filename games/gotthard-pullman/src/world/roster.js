/**
 * The other trains on the Gotthard mountain line: real types, to their makers' and operators'
 * data (lengths, masses, power, top speeds; the liveries as they run today).
 *
 *  - traverso  SOB RABe 526 "Traverso" (Stadler FLIRT 3): the hourly Treno Gottardo. 8 cars,
 *              150.2 m, 160 km/h, copper.
 *  - giruno    SBB RABe 501 "Giruno" (Stadler SMILE): Switzerland's high-speed train, built for
 *              the Gotthard base tunnel. 11 cars, 202 m, 380 t, 6 MW, 250 km/h. It comes over
 *              the mountain line when the base tunnel is shut (as in 2023-24).
 *  - astoro    SBB RABe 503 "Astoro" (Alstom ETR 610): the tilting train that worked the
 *              Milan trains over the mountain before 2016. 7 cars, 187.4 m, 250 km/h.
 *  - ir        an SBB Re 420 (Re 4/4 II: 15.41 m, 80 t, 4.7 MW, 140 km/h) with five EW IV
 *              coaches (26.4 m each): the classic Gotthard InterRegio, today an extra train.
 *  - bls, db    BLS Cargo's Re 475 and DB Cargo's class 193, both Siemens Vectrons (18.98 m, 90 t,
 *              6.4 MW), with container and tank trains: the international goods traffic.
 *  - ec        an SBB Re 460 (18.5 m, 84 t, 6.1 MW) with seven EW IV coaches.
 *  - freight   two SBB Cargo engines, an Re 620 (Re 6/6: 19.31 m, 120 t, 7.85 MW) leading an
 *              Re 420 (the "Re 10/10" of the Gotthard), with container and tank wagons.
 *
 * Each: its vehicles in order from the front [kind, length (m)], the livery, and what its
 * running needs (mass kg, power W, starting effort N, top speed here m/s). On this line every
 * one of them is held to the curves' 75-80 km/h; the tilting Astoro may take them a little faster.
 */
const rep = (n, x) => Array.from({ length: n }, () => x);

export const ROSTER = {
  traverso: {
    name: 'Treno Gottardo', what: 'SOB Traverso',
    cars: [['cab', 18.775], ...rep(6, ['car', 18.775]), ['cabR', 18.775]], jacobs: true,
    livery: { body: '#8e3f2b', band: '#0b0f12', skirt: '#26272a', roof: '#8d9093', door: '#8e3f2b', metal: true }, nose: 'flirt',
    mass: 330e3, power: 5.2e6, fmax: 300e3, vmax: 80 / 3.6,
  },
  giruno: {
    name: 'Giruno', what: 'SBB RABe 501 Giruno, the high-speed train',
    cars: [['cab', 21.0], ...rep(9, ['car', 17.8]), ['cabR', 21.0]], jacobs: true,
    livery: { body: '#eeeeec', band: '#15171a', skirt: '#3a3d42', roof: '#a9adb1', door: '#c8102e', accent: '#c8102e' }, nose: 'sleek',
    mass: 380e3, power: 6.0e6, fmax: 300e3, vmax: 80 / 3.6,
  },
  astoro: {
    name: 'Astoro', what: 'SBB RABe 503 Astoro (ETR 610), the tilting train',
    cars: [['cab', 28.2], ...rep(5, ['car', 26.2]), ['cabR', 28.2]],
    livery: { body: '#e9e9e6', band: '#1a1c20', skirt: '#55585d', roof: '#9a9ea3', door: '#c8102e', accent: '#c8102e' }, nose: 'sleek',
    mass: 453e3, power: 5.5e6, fmax: 270e3, vmax: 90 / 3.6,
  },
  ir: {
    name: 'InterRegio', what: 'SBB Re 420 with EW IV coaches',
    cars: [['loco', 15.41], ...rep(5, ['coach', 26.4])],
    livery: { body: '#f0f0ee', band: '#17191c', skirt: '#2a2c30', roof: '#8f9397', door: '#c8102e', loco: '#c1121f' },
    mass: 80e3 + 5 * 43e3, power: 4.7e6, fmax: 255e3, vmax: 80 / 3.6,
  },
  freight: {
    name: 'goods train', what: 'SBB Cargo Re 620 and Re 420 with a goods train',
    cars: [['loco6', 19.31], ['loco', 15.41], ...rep(4, ['container', 19.6]), ...rep(4, ['tank', 16.4]), ...rep(4, ['container', 19.6])],
    livery: { body: '#c1121f', band: '#17191c', skirt: '#2a2c30', roof: '#8f9397', loco: '#c1121f', cargo: '#1f4e9a' },
    mass: 200e3 + 12 * 70e3, power: 12.5e6, fmax: 650e3, vmax: 70 / 3.6,
  },
  bls: {
    name: 'BLS Cargo goods train', what: 'BLS Cargo Re 475 (Siemens Vectron) with a container train',
    cars: [['loco', 18.98], ...rep(14, ['container', 19.6])],
    livery: { body: '#3f8a2f', band: '#17191c', skirt: '#2a2c30', roof: '#8f9397', loco: '#3f8a2f', cargo: '#d8d9d4' },
    mass: 90e3 + 14 * 62e3, power: 6.4e6, fmax: 300e3, vmax: 70 / 3.6,
  },
  db: {
    name: 'DB Cargo goods train', what: 'DB Cargo class 193 (Siemens Vectron) with tank wagons',
    cars: [['loco', 18.98], ...rep(16, ['tank', 16.4])],
    livery: { body: '#c4161c', band: '#17191c', skirt: '#2a2c30', roof: '#8f9397', loco: '#c4161c', cargo: '#c4161c' },
    mass: 90e3 + 16 * 70e3, power: 6.4e6, fmax: 300e3, vmax: 70 / 3.6,
  },
  ec: {
    name: 'EuroCity', what: 'SBB Re 460 with seven EW IV coaches',
    cars: [['loco', 18.5], ...rep(7, ['coach', 26.4])],
    livery: { body: '#f0f0ee', band: '#17191c', skirt: '#2a2c30', roof: '#8f9397', door: '#c8102e', loco: '#c1121f' },
    mass: 84e3 + 7 * 43e3, power: 6.1e6, fmax: 275e3, vmax: 80 / 3.6,
  },
};

for (const t of Object.values(ROSTER)) t.length = t.cars.reduce((a, c) => a + c[1], 0);
