const deg = Math.PI / 180;

/**
 * Punch library. Timings are for an elite fighter at full stamina and match
 * measured values (jab ~0.3 s round trip, power shots 0.4-0.5 s).
 *
 * All angles are for an orthodox fighter (lead = left) and get mirrored for
 * southpaws. Positive yaw turns the torso counter-clockwise seen from above,
 * i.e. brings the right (rear) shoulder forward.
 *
 * kind     : trajectory family (straight line, horizontal arc, rising arc)
 * extend   : fraction of the duration spent travelling to the target
 * hold     : fraction held at full extension
 * pelvisYaw/chestYaw : change of hip and shoulder-line yaw at impact (the
 *            shoulders travel further than the hips: the kinetic chain)
 * shift    : weight transfer of the pelvis towards the target (m)
 * dip      : pelvis height change at impact (negative = sit down on it)
 * windup   : fraction of the torso rotation first loaded the other way
 * cost     : stamina cost (of 100)
 * drive    : joint-drive stiffness multiplier while extending
 * force    : peak coordinated arm force (N) accelerating the glove
 * armDelay : fraction of the extension before the arm fires (kinetic chain)
 * reach    : comfortable horizontal reach (m) before the fighter steps in
 */
export const PUNCHES = {
  jab: {
    label: 'Jab', hand: 'lead', kind: 'straight', duration: 0.3, extend: 0.38, hold: 0.07,
    pelvisYaw: -4 * deg, chestYaw: -12 * deg, shift: 0.06, dip: -0.01, lean: 4 * deg, windup: 0,
    reach: 0.97, armDelay: 0.05, cost: 2.5, drive: 0.35, force: 200, follow: 0.02,
  },
  cross: {
    label: 'Cross', hand: 'rear', kind: 'straight', duration: 0.4, extend: 0.42, hold: 0.07,
    pelvisYaw: 34 * deg, chestYaw: 70 * deg, shift: 0.14, dip: -0.03, lean: 12 * deg, windup: 0.05,
    reach: 0.86, armDelay: 0.25, cost: 5.5, drive: 0.35, force: 380, follow: 0.04, pivotRear: 40 * deg,
  },
  leadHook: {
    label: 'Lead Hook', hand: 'lead', kind: 'hook', duration: 0.46, extend: 0.46, hold: 0.06,
    pelvisYaw: -15 * deg, chestYaw: -28 * deg, shift: 0.02, dip: -0.03, lean: 4 * deg, windup: 0.8,
    reach: 0.9, armDelay: 0.2, cost: 6.5, drive: 1.3, force: 250, follow: 0.06, pivotLead: -35 * deg,
  },
  rearHook: {
    label: 'Rear Hook', hand: 'rear', kind: 'hook', duration: 0.5, extend: 0.46, hold: 0.06,
    pelvisYaw: 38 * deg, chestYaw: 60 * deg, shift: 0.09, dip: -0.03, lean: 8 * deg, windup: 0.15,
    reach: 0.84, armDelay: 0.25, cost: 7, drive: 1.3, force: 265, follow: 0.06, pivotRear: 45 * deg,
  },
  leadUppercut: {
    label: 'Lead Uppercut', hand: 'lead', kind: 'uppercut', duration: 0.46, extend: 0.48, hold: 0.06,
    pelvisYaw: -10 * deg, chestYaw: -16 * deg, shift: 0.03, dip: 0.02, lean: -2 * deg, windup: 0.5,
    reach: 0.82, armDelay: 0.15, cost: 6.5, drive: 1.0, force: 240, follow: 0.08, preDip: -0.08,
  },
  rearUppercut: {
    label: 'Rear Uppercut', hand: 'rear', kind: 'uppercut', duration: 0.48, extend: 0.48, hold: 0.06,
    pelvisYaw: 28 * deg, chestYaw: 45 * deg, shift: 0.1, dip: 0.02, lean: 2 * deg, windup: 0.2,
    reach: 0.8, armDelay: 0.2, cost: 7, drive: 1.0, force: 255, follow: 0.08, preDip: -0.09, pivotRear: 30 * deg,
  },
};

export const PUNCH_ORDER = ['jab', 'cross', 'leadHook', 'rearHook', 'leadUppercut', 'rearUppercut'];

/**
 * Head movement. `amount` is the envelope peak; the move eases in, holds and
 * eases out over `duration`.
 */
export const DEFENSES = {
  slipLeft:  { duration: 0.42, lat: 0.07, roll: 16 * deg, flex: 10 * deg, twist: -8 * deg, height: -0.03, cost: 1.5 },
  slipRight: { duration: 0.42, lat: -0.07, roll: -16 * deg, flex: 10 * deg, twist: 8 * deg, height: -0.03, cost: 1.5 },
  duck:      { duration: 0.52, lat: 0, roll: 0, flex: 26 * deg, twist: 0, height: -0.15, cost: 2.5 },
  pull:      { duration: 0.42, lat: 0, roll: 0, flex: -16 * deg, twist: 0, height: -0.01, back: 0.08, cost: 1.5 },
};

export function punchIsPower(type) {
  return type !== 'jab';
}
