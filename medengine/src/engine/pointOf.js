import { Vector3 } from '../math/core.js';

/**
 * A world position from whatever a game has at hand: a Vector3, `[x, y, z]`, `{x, y, z}`, an Object3D (its world position), an
 * Actor (between its eyes) or a function returning any of these (called each time, so it can follow something). Returns `out`,
 * or null for nothing.
 */
export function pointOf(x, out = new Vector3()) {
  if (!x) return null;
  if (typeof x === 'function') return pointOf(x(), out);
  if (x.isVector3) return out.copy(x);
  if (Array.isArray(x)) return out.set(x[0], x[1] ?? 0, x[2] ?? 0);
  if (typeof x.eyes === 'function') return x.eyes(out);
  if (typeof x.getWorldPosition === 'function') return x.getWorldPosition(out);
  if (typeof x.x === 'number') return out.set(x.x, x.y ?? 0, x.z ?? 0);
  return null;
}
