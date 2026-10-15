/**
 * The inside of the boat as people use it: the decks they walk, the doors and hatches they pass,
 * the ladders they climb. Boat coordinates in metres: x forward of frame 66 1/2, y above the
 * keel, z to starboard.
 *
 * The platform deck (the walking deck) is 11'-5 13/16" above the keel in the control room
 * (General Information Book A-1), about 0.1 m below the pressure hull's axis, so a man stands
 * with some 2.2 m of hull above his feet on the centreline, less under the pipes and cable runs.
 * Below it: the batteries, the pump room, the lower engine spaces, the magazines and stores.
 * The conning tower (frames 49 to 56) is a cylinder on its side above the control room, reached
 * by a ladder through the lower conning tower hatch (frame 50 1/2); the bridge above it through
 * the upper hatch. The pump room is below the control room. The owner's observation deck, on
 * the main deck amidships where the 4-inch gun stood, is reached up a short trunk from the
 * crew's mess through the old galley hatch (frame 64 1/2).
 */
import { HULL, COMPARTMENTS, CONNING_TOWER, DOORS, HATCHES, frameX, FT } from './boat.js';
import { OBS_DECK } from '../physics/mass.js';

export const DECK = HULL.platformDeck;                 // 3.50 m above the keel
export const R_HULL = HULL.pressureHullDia / 2;
export const AXIS = HULL.axisY;

/** The pressure hull's inner radius along the length (the ends narrow into the torpedo rooms). */
export function hullRadiusAt(x) {
  const fwd = COMPARTMENTS[0].x0, aft = COMPARTMENTS[COMPARTMENTS.length - 1].x1;
  const r = R_HULL - 0.2;                               // inside the frames
  if (x > fwd - 9) return r * (1 - 0.28 * Math.min(1, (x - (fwd - 9)) / 9));
  if (x < aft + 11) return r * (1 - 0.3 * Math.min(1, ((aft + 11) - x) / 11));
  return r;
}

/** Levels people stand on. */
export const LEVELS = {
  main: { y: DECK, x0: COMPARTMENTS[COMPARTMENTS.length - 1].x1 + 0.4, x1: COMPARTMENTS[0].x0 - 0.5 },
  pump: { y: 1.30, x0: frameX(58) + 0.4, x1: frameX(48) - 0.3 },
  ct: { y: CONNING_TOWER.kg * FT - 1.15, x0: CONNING_TOWER.x1 + 0.4, x1: CONNING_TOWER.x0 - 0.4 },
  bridge: { y: HULL.bridgeDeck, x0: frameX(60), x1: frameX(46) },
  obs: { y: OBS_DECK.axisY - 0.78, x0: OBS_DECK.x - OBS_DECK.length / 2 - 0.5, x1: OBS_DECK.x + OBS_DECK.length / 2 + 0.5 },
};

/** Ladders between levels: x, z of the foot and the two levels. */
export const LADDERS = [
  { id: 'ctLadder', from: 'main', to: 'ct', x: HATCHES.find((h) => h.id === 'ctLower').x, z: 0.0, hatch: 'ctLower' },
  { id: 'bridgeLadder', from: 'ct', to: 'bridge', x: HATCHES.find((h) => h.id === 'ctUpper').x, z: 0.0, hatch: 'ctUpper' },
  { id: 'pumpLadder', from: 'main', to: 'pump', x: frameX(55), z: 0.55, hatch: null },
  { id: 'obsLadder', from: 'main', to: 'obs', x: HATCHES.find((h) => h.id === 'galley').x, z: 0.0, hatch: 'galley' },
];

/** Watertight doors in the main bulkheads, on the centreline at the walking deck. */
export const DOOR_LIST = DOORS.map((d, i) => ({ ...d, i, y: DECK + 0.33, z: 0 }));

/** The walking corridor's half-width along the length (equipment and bunks either side). */
export function corridorAt(x, level = 'main') {
  if (level === 'ct') return 0.9;
  if (level === 'bridge') return 1.1;
  if (level === 'obs') return 0.8;
  if (level === 'pump') return 0.6;
  const c = compartmentAt(x);
  switch (c?.id) {
    case 'ftr': case 'atr': return 0.55;       // between the torpedo racks
    case 'fer': case 'aer': return 0.45;       // between the engines
    case 'man': return 0.5;
    case 'cr': return 0.95;
    case 'abr': return 0.6;
    case 'fbr': return 0.45;                    // the officers' passageway
    default: return 0.5;
  }
}

export function compartmentAt(x) {
  for (const c of COMPARTMENTS) if (x <= c.x0 && x >= c.x1) return c;
  return null;
}

export { COMPARTMENTS, CONNING_TOWER, HATCHES, OBS_DECK, frameX, FT };
