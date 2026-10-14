/**
 * Doc's rig for the night of the storm (12 November 1955): a cable from the lightning rod on
 * the courthouse tower, clamped at the clock's ledge, down across the square to a lamp post on
 * the north side of Main Street, and across the street to a post on the south side, sagging
 * to the height of the hook on the time machine's pole as it passes.
 */
import { Vector3 } from 'three';
import { COURTHOUSE, MAIN_Z, MAIN_W } from './map.js';
import { tube } from '../car/timemachine.js';
import { streetLamp } from './props.js';

const V = (x, y, z) => new Vector3(x, y, z);
const C = COURTHOUSE;
const STREET_X = -1.0;
const HOOK_Y = 3.95;           // the cable's height over the eastbound lane

function sag(a, b, depth, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(a.clone().lerp(b, t).add(V(0, -4 * depth * t * (1 - t), 0))); }
  return out;
}

const rod = V(C.x, 38.0, C.z), ledge = V(C.x, 26.6, C.z + 4.3 + 1.0);
const north = V(STREET_X, 5.6, MAIN_Z - MAIN_W / 2 - 0.9), south = V(STREET_X, 4.6, MAIN_Z + MAIN_W / 2 + 0.9);

/** The cable as points, from the rod to the far post. */
const cable = [...sag(rod, ledge, 0.0, 6), ...sag(ledge, north, 3.5, 40).slice(1), ...sag(north, south, 0.95, 24).slice(1)];

export const RIG = {
  rod, ledge, north, south, cable,
  cloud: V(C.x + 30, 420, C.z - 200),
  clock: V(C.x, 28, C.z + 4.6),
  street: { x: STREET_X },
  hookY: HOOK_Y,
  /** The cable's height over the street at z (the span between the two posts), or null. */
  cableAt(z) {
    if (z < north.z || z > south.z) return null;
    const t = (z - north.z) / (south.z - north.z);
    return { y: north.y + (south.y - north.y) * t - 4 * 0.95 * t * (1 - t) };
  },
};

/** Builds the cable and the two posts into a Builder. */
export function buildRig(b) {
  tube(b, 'ironBlack', cable, 0.025, { segs: 6, steps: 220 });
  b.cylinder('ironBlack', V(rod.x, rod.y - 4, rod.z), V(rod.x, rod.y + 1.2, rod.z), 0.03, 0.01, { segs: 6 });
  const lights = [];
  for (const p of [north, south]) {
    lights.push(streetLamp(b, 'incandescent', p.x, p.z, 0));
    b.cylinder('ironBlack', V(p.x, 0, p.z), V(p.x, p.y + 0.2, p.z), 0.06, 0.05, { segs: 8 });
  }
  return lights;
}
