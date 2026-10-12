/**
 * The train: SBB Historic's C 5/6 2978 and its tender, and four heavyweight
 * steel cars in the 1920s–30s Pullman manner (riveted steel bodies, steel
 * clerestory roofs, six-wheel trucks, dark blue-teal paint). The cars are this
 * game's invention, built to European draw gear (screw couplings and side
 * buffers) so they can run on the Swiss network; their size and weight follow
 * preserved American heavyweights such as Pullman "Glen Alta" (1925): 84 ft long,
 * 10 ft 1 in wide, 14 ft high, 180,600 lb, six-wheel 242A trucks.
 */

export const ENGINE = {
  id: 'engine', kind: 'engine', name: 'C 5/6 2978', length: 12.685, mass: 86600, axles: 6,
  frontalArea: 9.5, davisC: 0.0024, brakeForce: 300e3, blocks: 10, direct: true, heatCapacity: 4e5,
};
export const TENDER = {
  id: 'tender', kind: 'tender', name: 'Tender', length: 6.51, mass: 41800, axles: 3,
  frontalArea: 9.0, davisC: 0.0005, brakeForce: 180e3, blocks: 6, direct: true, heatCapacity: 2.5e5,
};

/** The cars, in train order behind the tender. */
export const CARS = {
  sleeper: {
    id: 'windgaellen', kind: 'sleeper', name: 'Windgällen', length: 25.6, mass: 81900, axles: 6,
    frontalArea: 11.2, davisC: 0.00034, blocks: 24, heatCapacity: 3e5,
    layout: '6 compartments, 3 drawing rooms',
  },
  diner: {
    id: 'reuss', kind: 'diner', name: 'Reuss', length: 25.3, mass: 84500, axles: 6,
    frontalArea: 11.2, davisC: 0.00034, blocks: 24, heatCapacity: 3e5,
    layout: 'kitchen, pantry, 36-seat dining room',
  },
  parlor: {
    id: 'bristen', kind: 'parlor', name: 'Bristen', length: 25.3, mass: 74200, axles: 6,
    frontalArea: 11.2, davisC: 0.00034, blocks: 24, heatCapacity: 3e5,
    layout: '28 revolving armchairs, one drawing room',
  },
  observation: {
    id: 'sankt-gotthard', kind: 'observation', name: 'Sankt Gotthard', length: 25.3, mass: 78300, axles: 6,
    frontalArea: 11.2, davisC: 0.00034, blocks: 24, heatCapacity: 3e5,
    layout: 'lounge, 3 compartments, open rear platform',
  },
};

/** Coaches brake to ~0.75 m/s² from 40 km/h with clean iron blocks (about 85 % braked weight). */
for (const c of Object.values(CARS)) c.brakeForce = 5.2 * c.mass;

export function makeConsist(order = ['sleeper', 'diner', 'parlor', 'observation']) {
  return [ENGINE, TENDER, ...order.map((k) => ({ ...CARS[k] }))];
}

/**
 * A banking engine sent up from Erstfeld when the train cannot hold the bank: an SBB
 * Re 420 (Re 4/4 II), 80 t, 4 axles, 4,700 kW, about 255 kN starting tractive effort,
 * 15.41 m long (SBB data). It buffers up behind the observation car and pushes.
 */
export const HELPER = {
  id: 'helper', kind: 'helper', name: 'Re 420 (banking)', length: 15.41, mass: 80000, axles: 4,
  frontalArea: 9.5, davisC: 0.0005, brakeForce: 360e3, blocks: 16, heatCapacity: 3e5,
  maxTE: 255e3, power: 4.7e6,
};
