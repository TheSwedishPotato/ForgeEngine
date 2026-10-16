/**
 * The railway wheel's tyre, to the standard wheelset dimensions: back-to-back 1360 mm, flange
 * 32 mm thick and 28 mm deep, tyre 135 mm wide, the tread coned 1 in 40 (falling outward), so
 * the rolling circle of radius R sits on the rail centre 750 mm from the track centre, the
 * flange inside the rail head and below its top, a few millimetres off the gauge face.
 * (Profile simplified from the UIC/EN 13715 S1002 shape.)
 */
import { Vector3 } from 'three';

export const BACK = 0.680;          // m, the tyre's back face from the track centre (half the back-to-back)
export const WIDTH = 0.135;         // m, the tyre's width
export const CONTACT = 0.750;       // m, the rolling circle from the track centre (the rail's centre line)
export const CONICITY = 1 / 40;     // the tread's taper
export const CLEARANCE = 0.0055;    // m, play each way before a flange meets the rail (gauge 1435 - 1360 - 2 x 32)

/** The tyre's section [r, u]: radius against the distance u out from the back face. */
export function tyreProfile(R) {
  const u0 = CONTACT - BACK, cone = (u) => R - (u - u0) * CONICITY;
  return [
    [R - 0.06, 0], [R + 0.018, 0], [R + 0.025, 0.005], [R + 0.028, 0.012],   // back face, flange tip
    [R + 0.025, 0.021], [R + 0.014, 0.030], [R + 0.006, 0.036], [cone(0.046) + 0.0008, 0.042],   // flange face and root
    [cone(0.046), 0.046], [R, u0], [cone(0.12), 0.12],                          // the coned tread
    [R - 0.006, WIDTH], [R - 0.06, WIDTH],                                      // chamfer, outer face
  ];
}

/**
 * Adds a tyre to a Builder: side +1 the right wheel (z > 0), -1 the left, the flange always on
 * the inside. zBack is where the back face lies in the builder's frame (default: on the track).
 */
export function tyre(b, name, R, side, { zBack = side * BACK, segs = 36 } = {}) {
  b.lathe(name, new Vector3(0, 0, zBack), new Vector3(0, 0, side), tyreProfile(R), { segs });
}

/**
 * The lateral place of a wheelset on the track (m, + to the right), as the coned treads steer it:
 * on the straight it hunts in Klingel's sinusoid (wavelength 2 pi sqrt(r s / conicity)), its
 * amplitude growing with speed; in a curve it runs out until the bigger rolling radius of the
 * outer wheel makes up the outer rail's longer way, which in the line's tight curves is more than
 * the play: the outer flange runs against the outer rail.
 */
export function wheelsetShift(R, s, v, curvature, phase = 0) {
  const lambda = 2 * Math.PI * Math.sqrt((R * CONTACT) / CONICITY);
  const hunt = 0.0025 * Math.min(1, Math.abs(v) / 20) * Math.sin((2 * Math.PI * s) / lambda + phase);
  const curve = -Math.sign(curvature) * Math.min(CLEARANCE, (R * CONTACT * Math.abs(curvature)) / CONICITY);
  return Math.max(-CLEARANCE, Math.min(CLEARANCE, curve + hunt));
}
