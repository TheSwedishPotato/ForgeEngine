/**
 * The lie of Hill Valley (world metres: X east, Z south; the ground at y = 0).
 *
 * The town is the films' own geography put on a California valley floor:
 *  - the courthouse on the north side of the square, its clock tower over the entrance,
 *    facing south over the lawn to Main Street;
 *  - Main Street, straight for a mile and a half east-west in front of it (the 1955
 *    lightning run: from far down the street, toward the tower, under the cable);
 *  - the county road on east of town to Old Man Peabody's farm, which in 1979 became the
 *    Twin Pines Mall and its parking lot (Doc's experiment, 1:20 AM, 26 October 1985);
 *  - the brick downtown round the square; the hills round the valley.
 */

export const MAIN_Z = 40;                   // Main Street's centre line
export const MAIN_W = 16;                   // its width, kerb to kerb
export const MAIN_X0 = -950, MAIN_X1 = 620;
export const ROAD_W = 9;                    // the county road
export const COUNTY_X1 = 1080;

export const SQUARE = { x0: -72, x1: 72, z0: -58, z1: 26 };       // the lawn in front of the courthouse
export const COURTHOUSE = { x: 0, z: -84, w: 64, d: 30, h: 15, towerH: 34 };
export const SIDE_STREETS = [{ x: -86, z0: -150, z1: 160 }, { x: 86, z0: -150, z1: 160 }];
export const NORTH_STREET = { z: -128, x0: -86, x1: 86 };

// the mall's ground (1979 on) and Peabody's farm before it
export const LOT = { x0: 1080, x1: 1680, z0: -140, z1: 360 };
export const MALL = { x0: 1150, x1: 1500, z0: -230, z1: -150 };
export const PINES = [{ x: 1094, z: 58 }, { x: 1094, z: 22 }];      // by the gate, either side of the lane
export const FARM = {
  house: { x: 1210, z: -60, w: 12, d: 10, h: 7.5, rot: 0.05 },
  barn: { x: 1622, z: 324, w: 18, d: 13, h: 10, rot: 0.0 },      // at the end of the lot's south lane: where a car that left the lot at 88 ends up
  scarecrow: { x: 1572, z: 326 },
  lane: { x0: 1080, z: 40, x1: 1300 },
};

// Marty's run in the lot: east down the south lane, between the rows of light poles
export const START = { x: 1096, z: 325, heading: 0 };

/** Kinds of ground, for the tyres: asphalt, concrete, dirt, grass, field. */
export const SURFACE = {
  asphalt: { mu: 0.95, crr: 0.014 }, concrete: { mu: 0.9, crr: 0.014 }, dirt: { mu: 0.62, crr: 0.03 },
  grass: { mu: 0.5, crr: 0.045 }, field: { mu: 0.42, crr: 0.07 }, wet: { mu: 0.65, crr: 0.016 },
};
