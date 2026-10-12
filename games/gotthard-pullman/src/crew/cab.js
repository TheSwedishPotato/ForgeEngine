/**
 * The C 5/6's footplate: where each control is, for the crew's hands.
 * Cab frame: x to the right (looking forward), y up from the cab floor, z forward (toward the boiler), metres.
 *
 * The layout follows a description of 2978's cab: the fittings manifold on top of the
 * backhead, the fire door below it, to its right the direct ("shunting") brake valve and
 * beside that the big handwheel of the reversing screw, so the driver works on the right
 * and the fireman on the left. Lined with light wood. Exact positions are estimates.
 */
export const CONTROLS = {
  // driver (right side)
  regulator: { pos: [0.28, 1.95, 1.05], size: 0.12, side: 'driver', kind: 'lever', label: 'regulator' },
  reverser: { pos: [0.62, 1.15, 0.80], size: 0.30, side: 'driver', kind: 'wheel', label: 'reversing screw' },
  directBrake: { pos: [0.40, 1.20, 0.92], size: 0.06, side: 'driver', kind: 'handle', label: 'direct brake' },
  trainBrake: { pos: [0.95, 1.25, 0.55], size: 0.07, side: 'driver', kind: 'handle', label: 'driver\'s brake valve' },
  sander: { pos: [0.85, 1.05, 0.70], size: 0.05, side: 'driver', kind: 'valve', label: 'sanders' },
  whistle: { pos: [0.55, 2.15, 0.85], size: 0.05, side: 'driver', kind: 'pull', label: 'whistle' },
  drainCocks: { pos: [0.75, 0.55, 0.85], size: 0.06, side: 'driver', kind: 'lever', label: 'cylinder cocks' },
  startingValve: { pos: [0.48, 1.62, 1.00], size: 0.05, side: 'driver', kind: 'valve', label: 'starting valve' },
  injectorR: { pos: [0.55, 1.60, 1.00], size: 0.05, side: 'driver', kind: 'valve', label: 'right injector' },
  steamHeat: { pos: [0.18, 1.70, 1.05], size: 0.05, side: 'driver', kind: 'valve', label: 'train heating valve' },
  // fireman (left side)
  firedoor: { pos: [0.0, 0.95, 1.12], size: 0.25, side: 'fireman', kind: 'door', label: 'fire door' },
  shovelPlate: { pos: [-0.25, 0.75, -0.95], size: 0.30, side: 'fireman', kind: 'coal', label: 'coal' },
  blower: { pos: [-0.30, 1.75, 1.03], size: 0.05, side: 'fireman', kind: 'valve', label: 'blower' },
  injectorL: { pos: [-0.55, 1.60, 1.00], size: 0.05, side: 'fireman', kind: 'valve', label: 'left injector' },
  dampers: { pos: [-0.60, 0.45, 0.95], size: 0.08, side: 'fireman', kind: 'lever', label: 'damper' },
  waterGauge: { pos: [-0.22, 1.55, 1.08], size: 0.03, side: 'fireman', kind: 'gauge', label: 'gauge glass' },
  pressureGauge: { pos: [0.0, 2.05, 1.06], size: 0.10, side: 'both', kind: 'gauge', label: 'boiler pressure' },
};

/** Where each crew member stands and rests the hands. */
export const STATIONS = {
  driver: { stand: [0.70, 0, 0.30], restL: [0.50, 1.25, 0.70], restR: [0.95, 1.30, 0.50], look: [0.9, 2.0, 6.0] },
  fireman: { stand: [-0.55, 0, 0.20], restL: [-0.70, 1.20, 0.40], restR: [-0.40, 1.15, 0.50], look: [-0.9, 2.0, 6.0] },
};

/**
 * Time for a hand to reach a control: Fitts' law, T = a + b log2(D/W + 1)
 * (Fitts 1954; constants for reaching in a cab after MacKenzie 1992),
 * with a little human spread.
 */
export function reachTime(from, ctl, rand = Math.random) {
  const d = Math.hypot(from[0] - ctl.pos[0], from[1] - ctl.pos[1], from[2] - ctl.pos[2]);
  const t = 0.25 + 0.16 * Math.log2(d / ctl.size + 1);
  return t * (0.85 + 0.3 * rand());
}
