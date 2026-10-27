/**
 * The building and its elevator, in numbers. One panoramic traction elevator runs up the
 * south face of a 30-storey tower on the Stockholm waterfront, outside the curtain wall in an
 * open steel-and-glass hoistway. Its machine room sits on the roof; its pit is at the foot of
 * the tower, below the plaza.
 *
 * World axes as in the Med Engine: X east, Y up (0 at the lobby floor), Z south. The tower's
 * south face (where the landing doors are) is the plane z = FACADE.
 *
 * The elevator is a 1600 kg, 4.0 m/s gearless machine-room elevator with 1:1 roping over a
 * deflector, compensating ropes on a tied-down tension sheave, a bidirectional overspeed governor,
 * progressive safety gear, oil buffers and a centre-opening door. The numbers are chosen the way an
 * elevator engineer would choose them, and the rules they must satisfy (EN 81-20 and EN 81-50
 * mostly, ASME A17.1 where noted) are checked in tests/physics.test.js:
 *
 *  - governor tripping speed at least 115 % of rated speed and below 1.25 v + 0.25 / v (EN 81-20,
 *    progressive safety gear, v > 1 m/s): 4.6 .. 5.06 m/s here, set at 4.80;
 *  - buffer stroke at least 0.0674 v² (a uniform 1 gn stop from 115 % of rated speed): 1.08 m,
 *    and the oil buffers here have 1.10 m;
 *  - traction by Euler-Eytelwein, T1 / T2 <= e^(f alpha), with the friction factor of an undercut
 *    U-groove from EN 81-50 (mu = 0.1 loading, 0.1 / (1 + v / 10) braking, 0.2 stalled): the car
 *    must hold 125 % load at the bottom landing, and the ropes must slip when the counterweight
 *    sits on its buffer;
 *  - rope safety factor at least 12 with three ropes or more, sheave at least 40 rope diameters;
 *  - each of the two brake sets alone stops the car with rated load descending at rated speed;
 *  - door closing kinetic energy at most 10 J at the average closing speed, force at most 150 N;
 *  - re-levelling with the doors open at most 0.3 m/s, inspection at most 0.63 m/s;
 *  - above 3.5 m/s, the compensation's tension sheave has an anti-rebound (tie-down) device.
 */

export const G = 9.80665;

// ---------------------------------------------------------------------------------------------
// The tower

export const FLOORS = 30;
export const LOBBY_H = 6.0;             // the lobby storey (floor 1)
export const STOREY = 3.9;              // floor to floor above it
/** Finished floor level of floor n (1 = lobby .. 30). */
export const floorY = (n) => (n <= 1 ? 0 : LOBBY_H + (n - 2) * STOREY);
export const TOP_Y = floorY(FLOORS);              // 115.2 m
export const ROOF_Y = TOP_Y + STOREY;              // 119.1 m
export const TOWER = { x0: -18, x1: 18, z0: -15, z1: 15, top: ROOF_Y + 1.2 };
export const FACADE = TOWER.z1;                    // the south face, where the landing doors are

// ---------------------------------------------------------------------------------------------
// The hoistway, outside the south face

export const CAR = {
  w: 2.1, d: 1.6, h: 2.5,             // inside the car (m): 3.36 m², under EN 81-20's 3.56 m² for 1600 kg
  z0: FACADE + 0.12,                  // the car's front (door side) inner face
  sillZ: FACADE + 0.065,              // the car sill's edge (30 mm from the landing sill's, at FACADE + 0.035)
  doorZ: FACADE + 0.09,               // the car door panels' plane; the landing doors' is FACADE + 0.02
  sillGap: 0.03,                      // running clearance between the car and landing sills
  doorW: 1.1, doorH: 2.1,             // centre-opening door: clear opening
  crosshead: 3.15,                    // rope hitch above the car floor
  plank: -0.55,                       // the safety plank (bottom of the sling) below the car floor
  striker: -0.65,                     // the buffer striker plate
  compHitch: -0.6,
};
CAR.z1 = CAR.z0 + CAR.d;
CAR.zc = (CAR.z0 + CAR.z1) / 2;       // 15.92: the car's centre, its rails and its ropes
export const RAILS = { car: 1.32, cwX: -2.05, cwHalfZ: 0.5 };   // car rails at x = ±1.32, the counterweight between rails at z = zc ± 0.5
export const PIT_Y = -3.6;
export const MR = { floor: TOP_Y + 6.4, h: 3.0, x0: -3.6, x1: 3.0, z0: FACADE - 2.0, z1: FACADE + 3.2 };   // the machine room, on the roof over the hoistway
export const SHEAVE = { x: -0.32, y: MR.floor + 0.95, z: CAR.zc, r: 0.32 };   // traction sheave (D = 640 mm)
export const DEFLECTOR = { x: RAILS.cwX + 0.26, y: MR.floor - 0.55, z: CAR.zc, r: 0.26 };
export const GOVERNOR = { x: 1.02, y: MR.floor + 0.55, z: CAR.zc + 0.55, r: 0.15, tensionY: PIT_Y + 0.5 };

// ---------------------------------------------------------------------------------------------
// The elevator

const ropeN = 8, ropeD = 0.013;
export const SPEC = {
  ratedLoad: 1600,          // Q (kg): 21 persons
  persons: 21,
  ratedSpeed: 4.0,          // m/s
  accel: 1.0,               // m/s²
  jerk: 1.2,                // m/s³
  carMass: 2100,            // P (kg): car, sling, laminated glass walls, doors, operator, travelling cable share
  balance: 0.45,            // counterweight = P + 0.45 Q
  // hoist ropes: 8 x 13 mm, 8x19 Seale with fibre core, dual tensile 1370/1770 (EN 12385-5)
  ropes: { n: ropeN, d: ropeD, kgPerM: 0.59 * ropeN, mbf: 87e3, EA: 90e9 * 0.384 * ropeD * ropeD * ropeN, damping: 0.02 },
  // compensating ropes: 4 x 18 mm, the same weight a metre as the hoist ropes (full compensation)
  comp: { n: 4, d: 0.018, kgPerM: 0.59 * ropeN, EA: 90e9 * 0.384 * 0.018 * 0.018 * 4, sheaveMass: 1000, sheaveR: 0.8, tieDown: true },
  machine: {
    // gearless permanent-magnet synchronous machine, 20 poles, sheave on the rotor
    J: 32,                  // kg·m², rotor, sheave and brake drums
    ratedTorque: 3800, maxTorque: 6800, ratedRpm: 119.4, poles: 20, ratedPower: 48e3,
    torqueLag: 0.004,       // the current loop (s)
    efficiency: 0.93,
  },
  brakes: { n: 2, torque: 4300, lift: 0.25, drop: 0.15 },   // each set (N·m)
  traction: { wrapDeg: 160, grooveDeg: 30, undercutDeg: 95 },
  governor: { trip: 4.80, overspeedSwitch: 4.40, ropeD: 0.008, tension: 60 * G, linkTravel: 0.03 },
  safetyGear: { force: 3700 * G * 1.5, engageTime: 0.05 },     // progressive: ~0.5 gn on P + Q in free fall
  buffers: { stroke: 1.10, runby: 0.30, designSpeed: 1.15 * 4.0, decel: G },
  doors: {
    panelTravel: 0.55,      // each panel of the centre-opening door
    carPanel: 52, landingPanel: 42,         // kg each
    openSpeed: 0.75, closeSpeed: 0.35,      // peak (m/s, each panel)
    maxForce: 150, dwellCar: 3.0, dwellHall: 4.0, nudgeAfter: 20,
    curtainBeams: 32, curtainTop: 1.82, curtainBottom: 0.02,
  },
  zones: { door: 0.20, preopen: 0.12, relevel: 0.010, stopTol: 0.003 },
  speeds: { inspection: 0.30, relevel: 0.10, ard: 0.15, eeo: 0.30 },
  overload: 1.10, fullLoad: 0.80,
};
SPEC.cwMass = SPEC.carMass + SPEC.balance * SPEC.ratedLoad;   // 2820 kg

/** Friction factor of an undercut U-groove (EN 81-50 5.12.2): f = mu * 4 (cos g/2 - sin b/2) / (pi - b - g - sin b + sin g). */
export function grooveFactor(mu, gammaDeg = SPEC.traction.grooveDeg, betaDeg = SPEC.traction.undercutDeg) {
  const g = (gammaDeg * Math.PI) / 180, b = (betaDeg * Math.PI) / 180;
  return (mu * 4 * (Math.cos(g / 2) - Math.sin(b / 2))) / (Math.PI - b - g - Math.sin(b) + Math.sin(g));
}
export const WRAP = (SPEC.traction.wrapDeg * Math.PI) / 180;
/** e^(f alpha) for a friction coefficient mu. */
export const tractionLimit = (mu) => Math.exp(grooveFactor(mu) * WRAP);
export const MU = { loading: 0.1, braking: (v) => 0.1 / (1 + v / 10), stalled: 0.2 };

// rope geometry (rigid, unstretched): heights of the hitches and where the ropes leave the sheaves
export const ROPE = {
  carTop: SHEAVE.y,                          // car-side ropes leave the traction sheave level with its axis
  cwTop: DEFLECTOR.y,                        // counterweight-side ropes leave the deflector level with its axis
  cwHitch: 3.4,                              // counterweight: rope hitch above its striker
  cwHeight: 3.5,
};
export const BUFFER = {
  carTop: floorY(1) + CAR.striker - SPEC.buffers.runby,   // the car buffer's plunger top (-0.95)
  cwTop: -1.0,
};
/** Counterweight striker height when the car (floor level) is at y, ropes unstretched. */
export function cwYForCar(y) {
  // rope length car-side + counterweight-side is constant; fixed so that with the car at the top
  // landing the counterweight stands its runby above its buffer
  const C = (ROPE.carTop - (TOP_Y + CAR.crosshead)) + (ROPE.cwTop - (BUFFER.cwTop + SPEC.buffers.runby + ROPE.cwHitch));
  return ROPE.cwTop - ROPE.cwHitch - (C - (ROPE.carTop - (y + CAR.crosshead)));
}
export const LIMITS = { top: TOP_Y + 0.20, bottom: floorY(1) - 0.20 };   // final limit switches (car floor level)

/** The floor whose level is nearest y. */
export function nearestFloor(y) {
  let best = 1, bd = 1e9;
  for (let n = 1; n <= FLOORS; n++) { const d = Math.abs(floorY(n) - y); if (d < bd) { bd = d; best = n; } }
  return best;
}
/** Stopping distance from speed v (a = 0) with deceleration A and jerk J: v²/2A + vA/2J. */
export const stopDistance = (v, A = SPEC.accel, J = SPEC.jerk) => (v * v) / (2 * A) + (v * A) / (2 * J);

export const PLACE = { lat: 59.3165, lon: 18.0880, name: 'Stockholm waterfront' };
export const DATE = { year: 2026, month: 10, day: 27, utcOffset: 1 };     // Tuesday 27 October 2026, CET
