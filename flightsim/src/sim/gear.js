/**
 * The undercarriage and everything else that can touch the ground. Each wheel is a spring and damper (spring-steel legs on the
 * mains, an oleo on the nose) on a tyre whose grip is a brush model: the contact patch is held by bristles that stretch as the
 * tyre is pushed sideways or braked and let go when the load they can carry is used up. That gives real static friction (the
 * aeroplane stands still on a slope or in a crosswind without creeping), cornering force that builds with slip angle, skids, and
 * brakes that can lock a wheel. The nose wheel steers through the rudder pedals' bungees and yields under side load.
 *
 * Wing tips, the tail, the belly, the propeller: stiff contact points, and hitting any of them is recorded as damage.
 */
import { clamp, sat, lag, qrot, DEG } from './util.js';

export class Gear {
  constructor(cfg) {
    this.wheels = cfg.wheels.map((w) => ({ ...w, comp: 0, load: 0, dLon: 0, dLat: 0, steer: 0, spin: 0, slip: 0, onGround: false, collapsed: false, surface: 0, roll: 0 }));
    this.points = cfg.points.map((p) => ({ ...p, depth: 0 }));
    this.F = { x: 0, y: 0, z: 0 }; this.M = { x: 0, y: 0, z: 0 };       // world force, world moment about the CG
    this.brakeL = 0; this.brakeR = 0; this.pedal = 0;
    this.chocks = false; this.tiedown = false;
    this.onGround = false; this.damage = null; this.touchdown = null; this.hardest = 0;
    this._a = { x: 0, y: 0, z: 0 }; this._b = { x: 0, y: 0, z: 0 };
  }
  get weightOnWheels() { return this.wheels.some((w) => w.onGround); }

  /**
   * @param {number} dt
   * @param {object} s       { pos, vel, q, om (body), cg }
   * @param {function} ground (x, z) => { h, mu, rr, rough }
   * @param {number} mass
   */
  step(dt, s, ground, mass) {
    const F = this.F, M = this.M, r = this._a, t = this._b;
    F.x = F.y = F.z = M.x = M.y = M.z = 0;
    let any = false;
    const addForce = (rx, ry, rz, fx, fy, fz) => {
      F.x += fx; F.y += fy; F.z += fz;
      M.x += ry * fz - rz * fy; M.y += rz * fx - rx * fz; M.z += rx * fy - ry * fx;
    };
    // velocity of a point of the airframe (r = world offset from the CG)
    const omw = qrot({ x: 0, y: 0, z: 0 }, s.q, s.om);
    for (const w of this.wheels) {
      w.onGround = false;
      if (w.collapsed) continue;
      // the bottom of the tyre with the leg fully extended
      qrot(r, s.q, { x: w.p.x - s.cg.x, y: w.p.y - s.cg.y, z: w.p.z - s.cg.z });
      const px = s.pos.x + r.x, py = s.pos.y + r.y, pz = s.pos.z + r.z;
      const g = ground(px, pz);
      let h = g.h;
      if (g.rough) h += g.rough * Math.sin(px * 1.31 + pz * 0.37) * Math.sin(pz * 1.77 - px * 0.53);
      const comp = h - py;
      if (comp <= 0) { w.comp = 0; w.load = 0; w.dLon = w.dLat = 0; w.slip = 0; w.steer += (0 - w.steer) * lag(dt, 0.2); continue; }
      const vx = s.vel.x + omw.y * r.z - omw.z * r.y, vy = s.vel.y + omw.z * r.x - omw.x * r.z, vz = s.vel.z + omw.x * r.y - omw.y * r.x;
      let N = w.k * comp - w.c * vy;
      if (comp > w.travel) N += 6 * w.k * (comp - w.travel);
      if (N <= 0) { w.comp = comp; w.load = 0; continue; }
      if (!w.onGround && w.load === 0 && w.comp === 0) {                        // first contact: remember how hard
        const sink = -vy;
        if (!this.touchdown || sink > this.touchdown.sink) this.touchdown = { sink, t: 0 };
        this.hardest = Math.max(this.hardest, sink);
        w.chirp = Math.hypot(vx, vz);
      }
      if (N > w.limit) { w.collapsed = true; this.damage ??= `${w.name} gear collapsed`; continue; }
      w.onGround = true; any = true; w.comp = comp; w.load = N; w.surface = g.mu > 0.6 ? 0 : 1;

      // nose-wheel steering: pedals through bungees, and the fork castors under side load
      if (w.steerable) {
        const side = w.cs * w.dLat / 0.3;                                         // side force as a fraction of the load
        const castor = clamp(Math.sign(side) * Math.max(0, Math.abs(side) - 0.35) * 0.9, -0.35, 0.35);
        w.steer += (this.pedal * 10 * DEG + castor - w.steer) * lag(dt, 0.12);
      }
      // wheel heading on the ground plane, and the direction to its right
      qrot(t, s.q, { x: Math.sin(w.steer), y: 0, z: -Math.cos(w.steer) });   // + steers right
      let fl = Math.hypot(t.x, t.z) || 1;
      const fwx = t.x / fl, fwz = t.z / fl, sdx = -fwz, sdz = fwx;                 // side = fwd x up
      const vLon = vx * fwx + vz * fwz, vLat = vx * sdx + vz * sdz;
      const mu = g.mu, brake = w.side < 0 ? this.brakeL : w.side > 0 ? this.brakeR : 0;
      // along the wheel: rolling resistance always, the brake if applied, chocks
      const holdMax = Math.min(mu * N, g.rr * N + brake * w.brakeForce + (this.chocks && w.side ? 4000 : 0));
      w.dLon += vLon * dt;
      let fLon = -(2.0e5 * w.dLon + 900 * vLon);
      if (Math.abs(fLon) > holdMax) { fLon = Math.sign(fLon) * holdMax; w.dLon = -fLon / 2.0e5; }
      // across it: bristles that relax as the tyre rolls onto fresh ground
      const kLat = Math.max(8000, w.cs * N / 0.3);
      w.dLat += (vLat - Math.abs(vLon) / 0.3 * w.dLat) * dt;
      let fLat = -(kLat * w.dLat + 3000 * vLat * sat(1 - Math.abs(vLon) / 3));
      const tot = Math.hypot(fLon, fLat), lim = mu * N;
      w.slip = sat((tot - 0.85 * lim) / (0.15 * lim + 1));
      if (tot > lim) { const k = lim / tot; fLon *= k; fLat *= k; w.dLat = clamp(w.dLat, -lim / kLat, lim / kLat); }
      // apply at the contact patch
      addForce(r.x, r.y + comp, r.z, fLon * fwx + fLat * sdx, N, fLon * fwz + fLat * sdz);
      w.roll = vLon; w.spin += vLon / w.radius * dt;
    }
    // the rest of the airframe
    for (const p of this.points) {
      qrot(r, s.q, { x: p.p.x - s.cg.x, y: p.p.y - s.cg.y, z: p.p.z - s.cg.z });
      const px = s.pos.x + r.x, py = s.pos.y + r.y, pz = s.pos.z + r.z;
      const depth = ground(px, pz).h - py;
      p.depth = depth;
      if (depth <= 0) continue;
      const vx = s.vel.x + omw.y * r.z - omw.z * r.y, vy = s.vel.y + omw.z * r.x - omw.x * r.z, vz = s.vel.z + omw.x * r.y - omw.y * r.x;
      const N = Math.max(0, 1.6e5 * depth - 9000 * vy);
      const sp = Math.hypot(vx, vz), k = sp > 1e-3 ? -Math.min(0.5 * N, 4000 * sp) / sp : 0;
      addForce(r.x, r.y + depth, r.z, k * vx, N, k * vz);
      if (N > 0) { any = true; if (-vy > 1.2 || sp > 4 || p.fragile) this.damage ??= p.name; }
    }
    // tie-down ropes at the wing struts and the tail: slack until pulled, then firm
    if (this.tiedown && this.tiePoints) {
      for (const a of this.tiePoints) {
        qrot(r, s.q, { x: a.p.x - s.cg.x, y: a.p.y - s.cg.y, z: a.p.z - s.cg.z });
        const dx = s.pos.x + r.x - a.anchor.x, dy = s.pos.y + r.y, dz = s.pos.z + r.z - a.anchor.z;
        const L = Math.hypot(dx, dy, dz), ext = L - a.length;
        if (ext > 0) { const f = -Math.min(3.0e4 * ext, 12000) / L; addForce(r.x, r.y, r.z, f * dx, f * dy, f * dz); }
      }
    }
    if (this.touchdown) this.touchdown.t += dt;
    this.onGround = any;
  }

  /** Fix the tie-down anchors in the ground under the aeroplane as it stands. */
  setTiePoints(s, pts) {
    const r = { x: 0, y: 0, z: 0 };
    this.tiePoints = pts.map((p) => {
      qrot(r, s.q, { x: p.x - s.cg.x, y: p.y - s.cg.y, z: p.z - s.cg.z });
      return { p, anchor: { x: s.pos.x + r.x, z: s.pos.z + r.z }, length: s.pos.y + r.y + 0.05 };
    });
  }
}
