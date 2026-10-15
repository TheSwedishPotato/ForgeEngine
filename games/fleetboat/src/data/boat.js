/**
 * The boat as built: a Balao-class fleet submarine of the Portsmouth group SS 381-404, from the
 * yard's General Information Book (U.S. Navy Yard, Portsmouth N.H., August-October 1943; the copy
 * kept with USS Pampanito, SS 383) and the Navy's "The Fleet Type Submarine" (NavPers 16160,
 * 1946). Every figure below is from those two books unless it says "estimate".
 *
 * The boat's frame of reference (metres): x forward of frame 66 1/2 (the yard's moment reference),
 * y up from the bottom of the keel, z to starboard. The yard's base line is 1 inch above the bottom
 * of the keel; the difference is ignored.
 */
import { FT, IN, LB, LONG_TON, GAL, FT3, PSI, HP, ftin, RHO_NAVY } from '../physics/units.js';

// ---------------------------------------------------------------------------------------------
// Frames. 139 frames; spacing 24" from frame 0 to 35, 30" to 62, 24" to 69, 30" to 103, 24" to
// 104, 30" to 106, 24" to 138. Forward perpendicular 12" forward of frame 0, after perpendicular
// 6" aft of frame 137 (307'-0" between them), midships 12" aft of frame 69.

const SPACING = [[35, 24], [62, 30], [69, 24], [103, 30], [104, 24], [106, 30], [139, 24]];

/** Distance of frame f (may be fractional) aft of frame 0, in inches. */
export function frameInches(f) {
  let x = 0, prev = 0;
  for (const [to, s] of SPACING) {
    const n = Math.min(f, to) - prev;
    if (n > 0) x += n * s;
    if (f <= to) break;
    prev = to;
  }
  return x;
}
const F665 = frameInches(66.5);
/** x (m, forward positive) of frame f, plus an offset in inches (+ aft). */
export const frameX = (f, inchesAft = 0) => -(frameInches(f) + inchesAft - F665) * IN;
/** x (m) of a point given as feet forward (+) or aft (-) of frame 66 1/2. */
export const fwd = (feet) => feet * FT;

export const HULL = {
  loa: ftin(311, 8),
  lbp: ftin(307, 0),
  xFP: frameX(0, -12),                 // forward perpendicular
  xAP: frameX(137, 6),                 // after perpendicular
  xStem: frameX(0, -12 - 56),          // the stem, 4'-8" beyond the F.P.
  xMid: frameX(69, 12),
  beamExtreme: ftin(27, 3.5),          // at 12 ft above base
  beamMolded: ftin(27, 1.5),
  beamWL: ftin(26, 0),                 // moulded breadth at the designer's waterline
  beamHeight: ftin(12, 0),
  depthMoulded: ftin(22, 11 + 3 / 8),  // amidships, frame 53
  pressureHullDia: ftin(16, 0.375),    // maximum (Fleet Type Submarine, 1D2)
  innerHullTop: ftin(19, 10),          // lowest point of keel to top of inner hull amidships
  innerBottom: ftin(3, 9),             // depth of inner bottom, frame 53
  // the pressure hull's axis: its top less its radius
  get axisY() { return this.innerHullTop - this.pressureHullDia / 2; },
  platformDeck: ftin(11, 5 + 13 / 16), // control room platform deck above base
  ctDeck: ftin(24, 3.75),              // conning tower deck (centreline of the conning tower)
  ctTop: ftin(28, 4.5),                // top of conning tower plating, frame 53
  bridgeDeck: ftin(29, 3.5),
  pilotHouseTop: ftin(33, 8.75),
  periscopeSupports: ftin(47, 3.5),
  periscopeUpTop: ftin(66, 8 + 1 / 16),
  periscopeUpOptical: ftin(66, 5.5),
  periscopeDownTop: ftin(47, 2.5),
  mastUp: ftin(56, 7.875),
  gun4inAxis: ftin(27, 11 + 7 / 8),
  deckBow: ftin(27, 6),                // main deck at the bow, above base
  deckStern: ftin(22, 3 + 5 / 8),      // main deck at the stern, above base
  freeboardBow: ftin(12, 6),
  freeboardStern: ftin(6, 8 + 5 / 8),
  wettedSurface: 11543 * FT * FT,      // normal diving trim, surfaced
  midshipArea: 340 * FT * FT,          // immersed, normal diving trim
};

/** Hydrostatics in normal diving trim (General Information Book A-1, "Calculated data"). */
export const HYDROSTATICS = {
  draftMean: ftin(15, 3),
  draftFwd: ftin(14, 10.5),
  draftAft: ftin(15, 7.5),
  trimByStern: 9.5 * IN,
  tonsPerInch: 12.45,
  waterplaneArea: 5250 * FT * FT,
  mt1in: 210,                          // ft-tons to alter trim 1"
  kbSurface: ftin(9, 2.2),             // 9.18 ft
  lcbSurface: frameX(69) - 1.12 * FT,  // 1.12 ft aft of frame 69
  lcfSurface: frameX(69) - 5.90 * FT,  // water plane C.G. 5.90 ft aft of frame 69
  displacementSurface: 1806.2 * LONG_TON,
  displacementSubmerged: 2419 * LONG_TON,
  mbtSafety: 612.8 * LONG_TON,         // main ballast and safety tanks, corrected for lead and residual water
  mbtSafetyLcg: frameX(69) - 1.38 * FT,
  lcgSurface: frameX(69) - 2.22 * FT,
  gmSurface: 1.49 * FT,
  gmSubmerged: 0.94 * FT,
  gmMin: 0.87 * FT,                    // submerging and emerging
  bmT: 3.22 * FT,                      // transverse metacentre above C.B. (surfaced)
  bmL: 271.0 * FT,
};

// ---------------------------------------------------------------------------------------------
// Compartments: between the bulkheads with their doors (frame, inches aft of it), floodable
// volume (cubic feet; the yard's "permeability" already applied) and its centre above the keel.

export const COMPARTMENTS = [
  { id: 'ftr', name: 'Forward torpedo room', from: [16, 0], to: [35, 0], volume: 4460, kg: 13.00 },
  { id: 'fbr', name: 'Forward battery (officers\' country)', from: [35, 0], to: [47, 9], volume: 4150, kg: 13.60 },
  { id: 'cr', name: 'Control room', from: [47, 9], to: [58, 3], volume: 3950, kg: 12.19, includes: 'pump room and radio room' },
  { id: 'abr', name: 'After battery (galley, mess, crew\'s quarters)', from: [58, 3], to: [77, 7.25], volume: 6290, kg: 13.19 },
  { id: 'fer', name: 'Forward engine room', from: [77, 7.25], to: [88, -6.25], volume: 3781, kg: 12.37 },
  { id: 'aer', name: 'After engine room', from: [88, -6.25], to: [99, -13.5], volume: 4306, kg: 12.29 },
  { id: 'man', name: 'Maneuvering and motor room', from: [99, -13.5], to: [107, 0], volume: 3140, kg: 12.15 },
  { id: 'atr', name: 'After torpedo room', from: [107, 0], to: [125, 0], volume: 3590, kg: 15.30 },
].map((c) => ({ ...c, x0: frameX(c.from[0], c.from[1]), x1: frameX(c.to[0], c.to[1]), volumeM3: c.volume * FT3, kgM: c.kg * FT }));

/** The conning tower: a cylinder on its side above the control room, frames 49 to 56. */
export const CONNING_TOWER = { id: 'ct', name: 'Conning tower', from: 49, to: 56, x0: frameX(49), x1: frameX(56), volume: 670, volumeM3: 670 * FT3, kg: 24.38, innerDia: 8 * FT /* estimate */ };

/** Watertight doors: 20" x 38", flat, 8 dogs, in every main bulkhead (side as the yard lists it). */
export const DOORS = [
  { at: [35, 0], hand: 'R', between: ['ftr', 'fbr'] },
  { at: [47, 9], hand: 'L', between: ['fbr', 'cr'] },
  { at: [58, 3], hand: 'R', between: ['cr', 'abr'] },
  { at: [77, 7.25], hand: 'R', between: ['abr', 'fer'] },
  { at: [88, -6.25], hand: 'L', between: ['fer', 'aer'] },
  { at: [99, -13.5], hand: 'L', between: ['aer', 'man'] },
  { at: [107, 0], hand: 'R', between: ['man', 'atr'] },
].map((d) => ({ ...d, x: frameX(d.at[0], d.at[1]), w: 20 * IN, h: 38 * IN, dogs: 8, turnsToUnlock: 4, testPsi: 198 }));

/**
 * The hatches that seal the pressure hull: 25" circular (spring balanced, 3 dogs) or 21" x 27"
 * oval (2 dogs). Frames from the General Information Book where given, else estimates.
 */
export const HATCHES = [
  { id: 'escFwd', name: 'Escape trunk (forward torpedo room)', frame: 27.5, dia: 25 * IN, kind: 'circ' },
  { id: 'torpLoadFwd', name: 'Torpedo loading hatch, forward', frame: 31, dia: 25 * IN, kind: 'circ', est: true },
  { id: 'ctUpper', name: 'Conning tower upper hatch', frame: 54, dia: 25 * IN, kind: 'circ', est: true },
  { id: 'ctLower', name: 'Conning tower lower hatch', frame: 50.5, w: 21 * IN, h: 27 * IN, kind: 'oval' },
  { id: 'galley', name: 'Galley and mess room hatch', frame: 64.5, dia: 25 * IN, kind: 'circ' },
  { id: 'aerHatch', name: 'After engine room hatch', frame: 94.5, dia: 25 * IN, kind: 'circ' },
  { id: 'torpLoadAft', name: 'Torpedo loading hatch, aft', frame: 110, dia: 25 * IN, kind: 'circ', est: true },
  { id: 'escAft', name: 'After torpedo room hatch (escape)', frame: 115.5, dia: 25 * IN, kind: 'circ' },
].map((h) => ({ ...h, x: frameX(h.frame) }));

// ---------------------------------------------------------------------------------------------
// Tanks (General Information Book A-1, "Moment diagram", pages 28-29). cap: cubic feet; tons:
// sea water at 35 ft^3/ton; kg: centre above the keel (ft); lcg: feet forward (+) or aft (-)
// of frame 66 1/2. side: s(tarboard), p(ort) or c(entre). group: the blow/vent group.
//
// kind: 'mbt' free flooding with vent valves (no flood valves);
//       'fbt' fuel ballast, hand flood valves (used as main ballast in normal diving trim);
//       'safety' flood valves and vents, inboard vent, blown from the 3000-lb manifold;
//       'negative' flood valve, quick-opening inboard vent;
//       'bowBuoyancy' free flooding through ports in the superstructure;
//       'variable' no sea connection: trim pump and manifold only, vented inboard.

export const TANKS = [
  { id: 'mbt1', name: 'M.B.T. No. 1', kind: 'mbt', cap: 1700, kg: 6.85, lcg: 85.84, side: 'c', group: '1' },
  { id: 'mbt2a', name: 'M.B.T. No. 2A', kind: 'mbt', cap: 1128, kg: 9.92, lcg: 41.26, side: 's', group: '2' },
  { id: 'mbt2b', name: 'M.B.T. No. 2B', kind: 'mbt', cap: 1128, kg: 9.92, lcg: 41.26, side: 'p', group: '2' },
  { id: 'mbt2c', name: 'M.B.T. No. 2C', kind: 'mbt', cap: 1166, kg: 9.24, lcg: 27.61, side: 's', group: '2' },
  { id: 'mbt2d', name: 'M.B.T. No. 2D', kind: 'mbt', cap: 1166, kg: 9.24, lcg: 27.61, side: 'p', group: '2' },
  { id: 'fbt3a', name: 'F.B.T. No. 3A', kind: 'fbt', cap: 1310, kg: 9.14, lcg: 15.19, side: 's', group: '3' },
  { id: 'fbt3b', name: 'F.B.T. No. 3B', kind: 'fbt', cap: 1310, kg: 9.14, lcg: 15.19, side: 'p', group: '3' },
  { id: 'mbt4a', name: 'M.B.T. No. 4A', kind: 'mbt', cap: 1586, kg: 9.17, lcg: -12.48, side: 's', group: '4' },
  { id: 'mbt4b', name: 'M.B.T. No. 4B', kind: 'mbt', cap: 1586, kg: 9.17, lcg: -12.48, side: 'p', group: '4' },
  { id: 'fbt5a', name: 'F.B.T. No. 5A', kind: 'fbt', cap: 1319, kg: 9.13, lcg: -26.20, side: 's', group: '5' },
  { id: 'fbt5b', name: 'F.B.T. No. 5B', kind: 'fbt', cap: 1319, kg: 9.13, lcg: -26.20, side: 'p', group: '5' },
  { id: 'mbt6a', name: 'M.B.T. No. 6A', kind: 'mbt', cap: 1197, kg: 9.21, lcg: -38.69, side: 's', group: '6' },
  { id: 'mbt6b', name: 'M.B.T. No. 6B', kind: 'mbt', cap: 1197, kg: 9.21, lcg: -38.69, side: 'p', group: '6' },
  { id: 'mbt6c', name: 'M.B.T. No. 6C', kind: 'mbt', cap: 1260, kg: 9.05, lcg: -52.31, side: 's', group: '6' },
  { id: 'mbt6d', name: 'M.B.T. No. 6D', kind: 'mbt', cap: 1260, kg: 9.05, lcg: -52.31, side: 'p', group: '6' },
  { id: 'mbt7', name: 'M.B.T. No. 7', kind: 'mbt', cap: 1430, kg: 8.80, lcg: -108.90, side: 'c', group: '7' },
  { id: 'safety', name: 'Safety tank', kind: 'safety', cap: 847, kg: 9.34, lcg: 7.00, side: 'c', group: 'safety' },
  { id: 'negative', name: 'Negative tank', kind: 'negative', cap: 282, kg: 3.08, lcg: 36.50, side: 'c', group: 'negative' },
  // the bow buoyancy tank: 31.69 tons (Fleet Type Submarine 4A4); its centre is an estimate, in the bow superstructure
  { id: 'bowBuoyancy', name: 'Bow buoyancy tank', kind: 'bowBuoyancy', cap: 31.69 * 35, kg: 21.0, lcg: 136.0, side: 'c', group: 'bb', est: true },
  // variable ballast
  { id: 'fwdTrim', name: 'Forward trim tank', kind: 'variable', cap: 860, kg: 9.58, lcg: 113.18, side: 'c', inside: true },
  { id: 'fwdWRT', name: 'Forward W.R.T. tank', kind: 'variable', cap: 175, kg: 5.63, lcg: 98.35, side: 'c', inside: true },
  { id: 'aux1', name: 'Auxiliary tank No. 1', kind: 'variable', cap: 1094, kg: 9.12, lcg: 0, side: 'p' },
  { id: 'aux2', name: 'Auxiliary tank No. 2', kind: 'variable', cap: 1094, kg: 9.12, lcg: 0, side: 's' },
  { id: 'aftWRT', name: 'After W.R.T. tank', kind: 'variable', cap: 185, kg: 9.75, lcg: -120.75, side: 'c', inside: true },
  { id: 'aftTrim', name: 'After trim tank', kind: 'variable', cap: 724, kg: 15.48, lcg: -139.11, side: 'c', inside: true },
].map((t) => ({ ...t, volume: t.cap * FT3, x: t.lcg * FT, y: t.kg * FT, z: t.side === 's' ? 1 : t.side === 'p' ? -1 : 0 }));

/** Normal fuel oil tanks (compensated: sea water fills what the engines burn). gallons, ft, ft. */
export const FUEL_TANKS = [
  { id: 'nfo1', name: 'N.F.O. No. 1', gal: 11400, kg: 8.71, lcg: 68.43 },
  { id: 'nfo2', name: 'N.F.O. No. 2', gal: 13050, kg: 8.92, lcg: 55.00 },
  { id: 'nfo6', name: 'N.F.O. No. 6', gal: 14900, kg: 8.98, lcg: -72.08 },
  { id: 'nfo7', name: 'N.F.O. No. 7', gal: 9320, kg: 9.85, lcg: -87.48 },
  { id: 'collecting', name: 'Collecting tank', gal: 2980, kg: 8.98, lcg: -62.40 },
  { id: 'expansion', name: 'Expansion tank', gal: 2980, kg: 8.98, lcg: -62.40 },
  { id: 'cfo1', name: 'Clean fuel oil No. 1', gal: 475, kg: 5.27, lcg: -30.32, inside: true },
  { id: 'cfo2', name: 'Clean fuel oil No. 2', gal: 475, kg: 5.27, lcg: -74.19, inside: true },
].map((t) => ({ ...t, volume: t.gal * GAL, x: t.lcg * FT, y: t.kg * FT }));

/** Fuel oil: 177.04 tons in 55,580 gallons, i.e. 7.135 lb/gal, 855 kg/m^3. */
export const RHO_FUEL = 177.04 * LONG_TON / (55580 * GAL);

/** Fresh and battery water, sanitary tanks (inside the pressure hull). */
export const STORES_TANKS = [
  { id: 'fw1', name: 'Fresh water No. 1', cap: 132, kg: 8.45, lcg: 75.05 },
  { id: 'fw2', name: 'Fresh water No. 2', cap: 132, kg: 8.45, lcg: 75.05 },
  { id: 'fw3', name: 'Fresh water No. 3', cap: 132, kg: 8.45, lcg: 20.22 },
  { id: 'fw4', name: 'Fresh water No. 4', cap: 132, kg: 8.45, lcg: 20.22 },
  { id: 'bwFwd', name: 'Battery water, forward', cap: 80, kg: 10.56, lcg: 60.80 },
  { id: 'bwAft', name: 'Battery water, after', cap: 80, kg: 10.56, lcg: -8.17 },
  { id: 'san1', name: 'Sanitary No. 1', cap: 43, kg: 7.92, lcg: 77.50 },
  { id: 'san2', name: 'Sanitary No. 2', cap: 147, kg: 7.90, lcg: -24.41 },
].map((t) => ({ ...t, volume: t.cap * FT3, x: t.lcg * FT, y: t.kg * FT }));

/** Weights in the ship, normal diving trim, surfaced (General Information Book A-1-a), long tons. */
export const WEIGHTS = {
  airOilWaterInSystem: 22.4, officersMenEffects: 7.8, ammunition: 7.5, torpedoes: 34.0,
  provisions: 9.3, generalStores: 4.0, potableWater: 16.6, batteryWater: 4.4,
  fuelOil: 175.5, lubeOil: 16.2, emergencyProvisions: 1.2,
  variable: { fwdWRT: 2.5, aftWRT: 2.2, fwdTrim: 3.7, aux: 18.4, aftTrim: 11.1 },
  variableDesigned: 41.0,
};

// ---------------------------------------------------------------------------------------------
// Machinery (General Information Book A-1, "Propelling machinery"; engine data from the
// Fairbanks-Morse instruction book bound into it).

export const MAIN_ENGINE = {
  maker: 'Fairbanks, Morse & Co.', model: '38D 8-1/8', type: 'opposed piston, two-stroke', cylinders: 10,
  bore: 8.125 * IN, stroke: 10 * IN,                // each of the two pistons
  bhp: 1600, power: 1600 * HP, rpm: 720, overspeedTrip: 800,
  compression: 14.23, bmepRated: 84.9 * PSI,
  displacementPerMin: 4321 * FT3,
  blower: { cfm: 6000, rpm: 1450, hp: 127, scavenge: [3.6 * PSI, 6 * PSI] },
  fuelPump: { gpm: 6, psi: 25 }, injection: 3000 * PSI,
  jacketWaterPump: { gpm: 525 }, seaWaterPump: { gpm: 525 }, lubeOilPump: { gpm: 280, relief: 60 * PSI },
  airFuelRatio: 47, exhaustCfm570F: 12100, exhaustBackPressure: 40 /* inches of water */,
  dryWeight: 33200 * LB, wetWeight: 33600 * LB,
  // operating figures at full load and speed
  lubeOilHeader: [17 * PSI, 32 * PSI], jacketOutletF: [140, 170], seaWaterDischarge: [28 * PSI, 35 * PSI],
  startingAirFlask: 3000 * PSI, startingAirReduced: 250 * PSI, exhaustF: [430, 770],
  // fuel per brake horsepower-hour (lb), 10-cylinder engine, at bhp and rpm
  fuelTable: [
    [1600, 720, 0.375], [1200, 720, 0.381], [800, 720, 0.419], [400, 720, 0.555],
    [1280, 648, 0.364], [960, 648, 0.368], [720, 648, 0.405], [360, 648, 0.529], [800, 576, 0.371],
  ],
};

export const AUX_ENGINE = { maker: 'Fairbanks, Morse & Co.', model: '38E 5-1/4', cylinders: 7, bhp: 440, rpm: 1200, kw: 300, volts: 260, amps: 1154 };

export const MAIN_GENERATOR = { kw: 1100, volts: 415, amps: 2650, rpm: 720, maker: 'General Electric (10-cylinder engines)' };

export const MAIN_MOTOR = { hp: 1375, amps: 2600, volts: 415, rpm: 1200, propRpm: 280, type: 'compound wound, continuous duty, sea water cooled', makers: 'Elliott Co. & General Electric Co.' };

export const REDUCTION_GEAR = { ratio: 4.2790, gearTeeth: 184, pinionTeeth: 43, shpPerShaft: 2700, propRpm: 280, pinionRpm: 1189.1 };

export const PROPELLER = { blades: 4, dia: 7.791 * FT, pitch: 8.812 * FT, pitchRadius: 33.5 * IN, rpm: 280, material: 'manganese bronze', hubImmersion: ftin(8, 10.5), tipAboveKeel: ftin(2, 11.25), shaftInclination: 1.5, shaftDivergence: 1 + 39 / 60, shaftOffset: ftin(5, 8) /* off C.L. at frame 128 */, shaftHeight: ftin(6, 9) /* above base at frame 128 */ };

/**
 * The main storage batteries: two of 126 cells (Gould or Exide), 1660 lb a cell; open-circuit
 * maximum 262.5 V at specific gravity 1.250 (120 F); the yard's discharge rates (amperes that
 * run the battery down in the given hours).
 */
export const BATTERY = {
  cells: 126, batteries: 2, cellMass: 1660 * LB, vMax: 262.5, sgFull: 1.250,
  rates: [[0.5, 8050], [1, 5320], [3, 2420], [5, 1410], [10, 930], [20, 512], [36, 305], [48, 235]],
  ventFans: { perBattery: 2, cfm: 500 },
};

/** Air: five banks, 560 cubic feet at 3000 psi; two compressors of 20 cubic feet an hour each. */
export const AIR = {
  banks: 5, bankVolume: 560 * FT3, pMax: 3000 * PSI, compressorFt3PerHourAt3000: 20, compressors: 2,
  mbtManifold: 600 * PSI, mbtManifoldRelief: 750 * PSI, serviceAir: 225 * PSI, lpBlow: 10 * PSI,
  hydraulicAccumulatorAir: 1950 * PSI, minForDive: 0.45,   // at least 45 % of capacity cut into the manifold to dive
};

/** Main hydraulic system: 1,500 cubic inch air-loaded accumulator, 750 psi oil at most. */
export const HYDRAULIC = { accumulator: 1500 * IN * IN * IN, pMax: 750 * PSI, supplyTank: 50 * GAL };

/** Control surfaces (General Information Book M-3, M-4). */
export const RUDDER = { area: 100 * FT * FT, height: ftin(10, 8), aft: ftin(7, 6), fwd: ftin(5, 11), stop: 38, weight: 11000 * LB };
export const BOW_PLANES = { area: 62 * FT * FT, length: ftin(10, 4.5), width: ftin(8, 1), stockX: frameX(18, -11), hingeY: ftin(17, 0), maxAngle: 25 };
export const STERN_PLANES = { area: 52 * FT * FT, length: ftin(8, 3), width: ftin(7, 1), stockX: frameX(131, -6), axisY: ftin(6, 9), span: ftin(8, 0), maxAngle: 25 };

/** Depth gauges (General Information Book A-1). */
export const DEPTH_GAUGES = [
  { id: 'dg1', dia: 16 * IN, range: 150, place: 'control room, forward' },
  { id: 'dg2', dia: 16 * IN, range: 150, place: 'control room, aft' },
  { id: 'dg3', dia: 8 * IN, range: 600, place: 'control room' },
  { id: 'dg4', dia: 8 * IN, range: 150, place: 'conning tower' },
  { id: 'dg5', dia: 8 * IN, range: 600, place: 'commanding officer\'s stateroom' },
];

/** Tests (General Information Book D-1). */
export const STRENGTH = {
  testDepth: 400 * FT,               // "the deep dive 400 feet, at which time a pressure of 176 pounds is imposed"
  testPressure: 176 * PSI,
  bulkheadDesign: 194 * PSI, bulkheadStress: 27000 * PSI,
  doorTest: 198 * PSI,
  hatchTest: 300 * PSI,
  // design collapse depth (BuShips, 1941, for the 7/8" high-tensile hull)
  collapseDepth: 900 * FT,
  plate: 0.875 * IN,
};

/** Atmosphere (General Information Book O-3). */
export const ATMOSPHERE = {
  netAirSpace: 35000 * FT3,
  co2LimitPct: 3, o2MinPct: 17, o2MaxPct: 20,
  airFromBanksPerManHour: 31 * FT3, o2FromBottlesPerManHour: 0.9 * FT3,
  absorbentPerManHour: 0.10 * LB, absorbentContainer: 15 * LB,
  // 35,000 cu ft and 77 men: 3 per cent CO2 in 18.2 hours
  hoursTo3PctFor77: 18.2,
};

/** Trial results (General Information Book A-1): tactical diameters of USS Batfish, SS 310, 27 September 1943. */
export const TRIALS = {
  surfaceBothScrews35Left: { knots: 17.3, diameterFt: 1290, minutes: 3 + 13 / 60 },
  surfaceOneScrew35Right: { knots: 8.7, diameterFt: 1110, minutes: 6 },
  submerged35Right: { knots: 3.8, rpm: 60 },
};

/** Speeds (Fleet Type Submarine 1D4; widely quoted class figures). */
export const SPEEDS = { surfaceKnots: 20.25, submergedKnots: 8.75, surfaceShp: 5400, submergedShp: 2740 };

/** Ship's complement (General Information Book A-1): 7 officers, 69 men. */
export const COMPLEMENT = [
  ['Commanding Officer', 1], ['Wardroom Officers', 6],
  ['Gunner\'s Mate 1st Class', 1], ['Chief Torpedoman\'s Mate', 1], ['Torpedoman\'s Mate 1st Class', 2], ['Torpedoman\'s Mate 2nd Class', 3], ['Torpedoman\'s Mate 3rd Class', 4],
  ['Quartermaster 1st Class', 1], ['Quartermaster 2nd Class', 1], ['Quartermaster 3rd Class', 1], ['Signalman 1st Class', 1], ['Fire Controlman 1st Class', 1], ['Seaman 1st Class', 10],
  ['Chief Electrician\'s Mate', 2], ['Electrician\'s Mate 1st Class', 2], ['Electrician\'s Mate 2nd Class', 3], ['Electrician\'s Mate 3rd Class', 3],
  ['Chief Radioman', 1], ['Radioman 1st Class', 1], ['Radioman 2nd Class', 1], ['Radioman 3rd Class', 1], ['Radio Technician 1st Class', 1], ['Radio Technician 2nd Class', 1],
  ['Chief Motor Machinist\'s Mate', 2], ['Motor Machinist\'s Mate 1st Class', 6], ['Motor Machinist\'s Mate 2nd Class', 5], ['Fireman 1st Class', 7],
  ['Yeoman 1st Class', 1], ['Pharmacist\'s Mate 1st Class', 1], ['Baker 1st Class', 1], ['Ship\'s Cook 1st Class', 1], ['Ship\'s Cook 3rd Class', 1],
  ['Steward\'s Mate 1st Class', 1], ['Steward\'s Mate 2nd Class', 1],
];

export { RHO_NAVY, FT, IN, LB, LONG_TON, GAL, FT3, PSI };
