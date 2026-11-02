/**
 * The cars that come into the workshop, from their makers' and their parts suppliers' numbers.
 * Lengths in metres, masses in kg, torques in N·m, pressures in bar, fluids in litres.
 *
 * Car frame: origin on the ground midway between the axles, +Z forward, +X the car's left, +Y up.
 *
 * Where a number was found in a source it is noted in docs/references.md; the rest are the values
 * commonly quoted for these cars (marked "~" there) and are the first thing to correct.
 */

export const CARS = {
  volvo240: {
    id: 'volvo240', make: 'Volvo', model: '240 GL', year: 1990, body: 'sedan', doors: 4, drive: 'RWD',
    summary: '1990 Volvo 240 GL saloon, 2.3 litre B230F, M47 five-speed manual, rear-wheel drive',
    dims: { length: 4.785, width: 1.715, height: 1.435, wheelbase: 2.64, trackF: 1.43, trackR: 1.46, mass: 1300, groundClear: 0.16, overhangF: 0.98 },
    paint: ['#7d1e22', '#e8e4d8', '#1d2b3a', '#4a5a4a', '#b9b9b4', '#16181a', '#2e4a6e'],
    engine: {
      code: 'B230F', layout: 'I4', longitudinal: true, cyl: 4, bore: 0.096, stroke: 0.080, cr: 9.8, firing: [1, 3, 4, 2],
      idle: 900, redline: 6000, peakPower: 85e3, peakTorque: 185, torqueRpm: 2750, inertia: 0.16,
      ignition: 'distributor', injection: 'LH-Jetronic 2.4', diag: 'LH2.4',
      plug: { type: 'Bosch W7DC', gap: 0.7, socket: 21, torque: 25 },
      oil: { capacity: 3.85, grade: '10W-40', drainPlug: { size: 19, torque: 60 }, filter: 'spin-on', filterTorque: 0 },
      coolant: { capacity: 9.5, thermostat: 87 },
      block: '#a8241c',
    },
    wheels: { pcd: '5x108', fastener: 'nut', size: 19, torque: 115, thread: 'M12x1.5', n: 5, tyre: '185/65 R15', rim: 15, tyreR: 0.311, tyreW: 0.185, pressure: { F: 2.1, R: 2.3 } },
    brakes: {
      F: { disc: { d: 0.263, t: 0.024, min: 0.0228, vent: true }, caliper: 'fixed', pistons: 4, padMM: 15, caliperBolt: { size: 17, torque: 100 }, padPins: true },
      R: { disc: { d: 0.281, t: 0.0096, min: 0.0084, vent: false }, caliper: 'fixed', pistons: 2, padMM: 13, caliperBolt: { size: 17, torque: 58 }, padPins: true },
      fluid: 'DOT 4', epb: false,
    },
    suspension: { F: 'macpherson', R: 'live-axle' },
    battery: { ah: 60, cca: 520 },
    bulbs: { head: 'H4', tail: 'P21/5W' },
    gearbox: 'M47 5-speed',
    labour: 1.0,
  },

  golf7: {
    id: 'golf7', make: 'Volkswagen', model: 'Golf VII 1.4 TSI', year: 2016, body: 'hatch', doors: 5, drive: 'FWD',
    summary: '2016 Volkswagen Golf VII 1.4 TSI (EA211, 92 kW), six-speed manual, front-wheel drive',
    dims: { length: 4.255, width: 1.799, height: 1.452, wheelbase: 2.637, trackF: 1.549, trackR: 1.52, mass: 1270, groundClear: 0.14, overhangF: 0.88 },
    paint: ['#c8cbcc', '#101114', '#f2f2ee', '#1f3f78', '#5b5f63', '#8a0f16', '#3d6e8f'],
    engine: {
      code: 'CZCA', layout: 'I4', longitudinal: false, cyl: 4, bore: 0.0745, stroke: 0.080, cr: 10.0, firing: [1, 3, 4, 2],
      idle: 720, redline: 6250, peakPower: 92e3, peakTorque: 200, torqueRpm: 1400, inertia: 0.11, turbo: true,
      ignition: 'coil-on-plug', injection: 'direct', diag: 'OBD2',
      plug: { type: 'NGK ZKR7AI-8', gap: 0.8, socket: 16, torque: 25 },
      oil: { capacity: 4.0, grade: '5W-30 VW 504 00', drainPlug: { size: 19, torque: 30 }, filter: 'spin-on', filterTorque: 20 },
      coolant: { capacity: 5.1, thermostat: 87 },
      block: '#6f7274',
    },
    wheels: { pcd: '5x112', fastener: 'bolt', size: 17, torque: 120, thread: 'M14x1.5', n: 5, tyre: '205/55 R16', rim: 16, tyreR: 0.316, tyreW: 0.205, pressure: { F: 2.3, R: 2.2 } },
    brakes: {
      F: { disc: { d: 0.276, t: 0.024, min: 0.022, vent: true }, caliper: 'floating', pistons: 1, padMM: 12, guideBolt: { size: 13, torque: 28 }, carrierBolt: { size: 18, torque: 200 } },
      R: { disc: { d: 0.253, t: 0.010, min: 0.008, vent: false }, caliper: 'floating', pistons: 1, padMM: 11, guideBolt: { size: 13, torque: 35 }, carrierBolt: { size: 18, torque: 90 } },
      fluid: 'DOT 4 class 6', epb: true,
    },
    suspension: { F: 'macpherson', R: 'torsion-beam' },
    battery: { ah: 61, cca: 330 },
    bulbs: { head: 'H7', tail: 'P21W' },
    gearbox: 'MQ200 6-speed',
    labour: 1.0,
  },

  f1_2026: {
    id: 'f1_2026', make: 'Formula 1', model: '2026-regulation car', year: 2026, body: 'f1', doors: 0, drive: 'RWD',
    summary: 'A 2026-regulation Formula 1 car: 1.6 litre V6 turbo hybrid, 350 kW MGU-K, active aero, 768 kg with driver',
    dims: { length: 5.15, width: 1.9, height: 0.95, wheelbase: 3.4, trackF: 1.6, trackR: 1.55, mass: 768, groundClear: 0.03, overhangF: 1.0 },
    paint: ['#0d0f12', '#c40f1c', '#e8e9ea', '#0a2a5c', '#f2a20c', '#0e5c3a'],
    engine: {
      code: 'PU-2026', layout: 'V6', longitudinal: true, cyl: 6, bore: 0.080, stroke: 0.053, cr: 18, firing: [1, 4, 2, 5, 3, 6],
      idle: 4000, redline: 15000, peakPower: 400e3, peakTorque: 280, torqueRpm: 11000, inertia: 0.02, turbo: true, mguk: 350e3,
      ignition: 'coil-on-plug', injection: 'direct', diag: 'F1',
      plug: { type: 'racing M10', gap: 0.4, socket: 14, torque: 12 },
      oil: { capacity: 8.5, grade: 'race 0W-30', drainPlug: { size: 14, torque: 15 }, filter: 'cartridge', filterTorque: 0 },
      coolant: { capacity: 7, thermostat: 105 },
      block: '#2a2c30',
    },
    wheels: { pcd: 'centre-lock', fastener: 'centrelock', size: 41, torque: 500, thread: 'M70x1.5', n: 1, tyre: 'slick 280/705 R18 F, 375/710 R18 R', rim: 18, tyreR: 0.3525, tyreRR: 0.355, tyreW: 0.28, tyreWR: 0.375, pressure: { F: 1.65, R: 1.5 } },
    brakes: {
      F: { disc: { d: 0.328, t: 0.032, min: 0.026, vent: true, carbon: true }, caliper: 'fixed', pistons: 6, padMM: 30, caliperBolt: { size: 12, torque: 40 } },
      R: { disc: { d: 0.28, t: 0.032, min: 0.026, vent: true, carbon: true }, caliper: 'fixed', pistons: 4, padMM: 30, caliperBolt: { size: 12, torque: 40 } },
      fluid: 'racing DOT 5.1', epb: false,
    },
    suspension: { F: 'pushrod', R: 'pullrod' },
    battery: { ah: 4, cca: 0 },
    gearbox: '8-speed seamless',
    labour: 2.5,
  },
};

/** The car each spec's driving position, OBD socket etc. are found on (car frame). */
export const CAR_IDS = Object.keys(CARS);

/** Mixed-up Swedish registration: three letters, two digits, a letter or digit (as issued since 2019). */
export function plate(rand = Math.random) {
  const L = 'ABCDEFGHJKLMNOPRSTUWXYZ';   // no I, Q, V, Å, Ä, Ö
  const l = () => L[Math.floor(rand() * L.length)];
  const d = () => Math.floor(rand() * 10);
  return `${l()}${l()}${l()} ${d()}${d()}${rand() < 0.5 ? l() : d()}`;
}
