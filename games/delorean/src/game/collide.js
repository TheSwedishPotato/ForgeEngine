/**
 * The car against the world, in plan: the DMC-12's footprint (4.27 x 1.86 m) as an oriented
 * rectangle about its CG, against circles (posts, trunks, the pines) and oriented boxes
 * (buildings, the barn, the van). A contact pushes the car out and exchanges an impulse at
 * the contact point (restitution 0.15, some friction), changing its speed and its spin; soft
 * things (a sapling, a scarecrow, a lamp post) give way and are knocked down instead.
 */

const HALF_L = 2.135, HALF_W = 0.93;

function obbCorners(cx, cz, hl, hw, rot) {
  // rot: the box's x axis angle, forward = (cos, -sin) as the vehicle's heading
  const c = Math.cos(rot), s = Math.sin(rot);
  const fx = c, fz = -s, rx = s, rz = c;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [cx + fx * hl * a + rx * hw * b, cz + fz * hl * a + rz * hw * b]);
}

/** Separating axis test of two oriented rectangles; returns { depth, nx, nz } (push for A) or null. */
function obbObb(A, B) {
  const axes = [];
  for (const P of [A, B]) for (let i = 0; i < 2; i++) { const [x0, z0] = P[i], [x1, z1] = P[i + 1]; const l = Math.hypot(x1 - x0, z1 - z0); axes.push([-(z1 - z0) / l, (x1 - x0) / l]); }
  let best = null;
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of A) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of B) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return null;
    if (!best || o < best.depth) {
      // push A away from B along the axis
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      const sgn = ca < cb ? -1 : 1;
      best = { depth: o, nx: ax * sgn, nz: az * sgn };
    }
  }
  return best;
}

/**
 * Resolves the vehicle (physics/vehicle.js) against colliders. Returns the contacts:
 * [{ collider, speed (closing, m/s), x, z }].
 */
export function collide(veh, colliders) {
  const hits = [];
  const o = veh.origin();
  const cx = o.x, cz = o.z;
  for (const c of colliders) {
    if (c.down) continue;
    const reach = c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
    if (Math.abs(c.x - cx) > reach + 2.5 || Math.abs(c.z - cz) > reach + 2.5) continue;
    const A = obbCorners(cx, cz, HALF_L, HALF_W, veh.heading);
    let res = null, px = 0, pz = 0;
    if (c.type === 'circle') {
      // the circle's centre in the car's frame, the nearest point of the rectangle to it
      const dx = c.x - cx, dz = c.z - cz, co = Math.cos(veh.heading), si = Math.sin(veh.heading);
      const lx = dx * co - dz * si, lz = dx * si + dz * co;
      const qx = Math.max(-HALF_L, Math.min(HALF_L, lx)), qz = Math.max(-HALF_W, Math.min(HALF_W, lz));
      let ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
      if (d >= c.r) continue;
      if (d < 1e-6) { ex = lx >= 0 ? 1 : -1; ez = 0; d = 0; }
      const nlx = d > 1e-6 ? -ex / d : -ex, nlz = d > 1e-6 ? -ez / d : -ez;      // from the circle toward the car
      // back to world (forward (co, -si), right (si, co))
      res = { depth: c.r - d, nx: nlx * co + nlz * si, nz: -nlx * si + nlz * co };
      px = cx + qx * co + qz * si; pz = cz - qx * si + qz * co;
    } else {
      const B = obbCorners(c.x, c.z, c.hw, c.hd, -(c.rot ?? 0) + Math.PI / 2 * 0);
      // boxes are given as half width (x) and half depth (z) rotated by rot about y
      const Bc = boxCorners(c);
      res = obbObb(A, Bc);
      void B;
      if (!res) continue;
      // the contact point: the car corner deepest into the box
      let best = -Infinity;
      for (const [x, z] of A) { const p = -(x * res.nx + z * res.nz); if (p > best) { best = p; px = x; pz = z; } }
    }
    const v = veh.velocity();
    // velocity of the contact point: v + w x r (yaw rate r turns +X toward -Z)
    const rx = px - veh.x, rz = pz - veh.z;
    const vpx = v.x + veh.r * rz, vpz = v.z - veh.r * rx;
    const vn = vpx * res.nx + vpz * res.nz;
    if (c.soft) {
      // it gives way: knocked down, a jolt, a little speed lost
      c.down = true;
      if (vn < 0) { const k = Math.min(1, 300 / veh.p.mass); veh.u *= 1 - 0.05 * k; }
      hits.push({ collider: c, speed: Math.max(0, -vn), x: px, z: pz, soft: true });
      continue;
    }
    // push out
    const sh = res.depth + 0.002;
    veh.x += res.nx * sh; veh.z += res.nz * sh;
    if (vn < 0) {
      const e = 0.15, m = veh.p.mass, I = veh.p.Iz;
      const rn = rx * res.nz - rz * res.nx;
      const j = -(1 + e) * vn / (1 / m + rn * rn / I);
      // apply: world impulse to the body frame (forward (c, -s), right (s, c))
      const co = Math.cos(veh.heading), si = Math.sin(veh.heading);
      const jx = j * res.nx, jz = j * res.nz;
      veh.u += (jx * co - jz * si) / m;
      veh.w += (jx * si + jz * co) / m;
      veh.r += -rn * j / I * 1.0;
      // friction along the surface
      const tx = -res.nz, tz = res.nx, vt = vpx * tx + vpz * tz;
      const jt = Math.max(-0.5 * j, Math.min(0.5 * j, -vt * m * 0.3));
      veh.u += (jt * tx * co - jt * tz * si) / m;
      veh.w += (jt * tx * si + jt * tz * co) / m;
      hits.push({ collider: c, speed: -vn, x: px, z: pz });
    }
  }
  return hits;
}

function boxCorners(c) {
  // half width along x, half depth along z, then rotated by rot about y (three's rotation.y)
  const co = Math.cos(c.rot ?? 0), si = Math.sin(c.rot ?? 0);
  return [[c.hw, c.hd], [c.hw, -c.hd], [-c.hw, -c.hd], [-c.hw, c.hd]].map(([x, z]) => [c.x + x * co + z * si, c.z - x * si + z * co]);
}

export { HALF_L, HALF_W };
