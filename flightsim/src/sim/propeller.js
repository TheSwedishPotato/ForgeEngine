/**
 * A fixed-pitch propeller by blade-element theory. Each blade is cut into elements; each element sees the air its own rotation
 * and the aeroplane's motion give it (so the down-going blade works harder when the nose is high: P-factor comes out by itself),
 * plus the inflow the propeller itself draws, found from momentum theory ring by ring. The result is thrust, the torque the
 * engine has to supply, the sideways force and the off-centre moments, and the slipstream that blows over the tail.
 *
 * It turns clockwise seen from the cockpit, like the real one.
 */
import { DEG, clamp } from './util.js';

const NA = 8;                                   // azimuth samples per revolution

export class Propeller {
  constructor(o = {}) {
    this.R = (o.diameter ?? 1.905) / 2;         // 75 in
    this.blades = o.blades ?? 2;
    this.pitch = o.pitch ?? 1.448;              // 57 in of geometric pitch
    this.inertia = o.inertia ?? 2.3;            // kg m2, with the crankshaft
    this.hub = o.hub ?? { x: 0, y: 1.25, z: -0.97 };
    const rs = [0.22, 0.34, 0.46, 0.58, 0.70, 0.80, 0.89, 0.96];
    const cs = [0.100, 0.118, 0.126, 0.125, 0.117, 0.105, 0.088, 0.066];
    const edges = [0.16, 0.28, 0.40, 0.52, 0.64, 0.75, 0.845, 0.93, 1.0];
    this.el = rs.map((r, i) => ({
      r: r * this.R, dr: (edges[i + 1] - edges[i]) * this.R, chord: cs[i] * (o.chordScale ?? 1.4),
      beta: Math.atan(this.pitch / (2 * Math.PI * r * this.R)) + (o.twistOffset ?? 0.75 * DEG), vi: 0,
    }));
    this.aL0 = o.aL0 ?? -4.2 * DEG;             // the blade sections are cambered (flat-bottomed)
    this.stallX = o.stallX ?? 0.195;             // stall, radians above zero lift
    this.cdSep = o.cdSep ?? 2.36; this.stallW = o.stallW ?? 0.034; this.slope = o.slope ?? 4.0;   // fitted to the handbook's static, climb and top-speed rpm
    this.thrust = 0; this.torque = 0;
    this.F = { x: 0, y: 0, z: 0 }; this.M = { x: 0, y: 0, z: 0 };      // on the airframe, at the hub (torque about the shaft excluded)
    this.slip = { hub: this.hub, R: this.R, Va: 0, vi: 0, swirl: 0, ux: 0, uy: 0 };
    this.angle = 0;
  }

  /**
   * @param {number} dt
   * @param {number} rho     air density
   * @param {number} a       speed of sound
   * @param {number} omega   shaft speed, rad/s (positive is the normal direction)
   * @param {{x,y,z}} air    velocity of the air relative to the hub, body axes (in cruise: mostly +z, toward the tail)
   */
  step(dt, rho, a, omega, air) {
    const B = this.blades, R = this.R, Va = air.z;
    let T = 0, Q = 0, Fx = 0, Fy = 0, Mx = 0, My = 0;
    for (const e of this.el) {
      let dT = 0;
      for (let k = 0; k < NA; k++) {
        const psi = (k + 0.5) * (2 * Math.PI / NA), sp = Math.sin(psi), cp = Math.cos(psi);
        // the blade moves along et = (cos psi, -sin psi); air moving the same way takes speed off it
        const UT = omega * e.r - (air.x * cp - air.y * sp), UP = Va + e.vi;
        const W2 = UT * UT + UP * UP;
        if (W2 < 1e-4) continue;
        const W = Math.sqrt(W2), phi = Math.atan2(UP, UT);
        let al = e.beta - phi;
        al = Math.atan2(Math.sin(al), Math.cos(al));
        const mach = Math.min(W / a, 0.92), pg = 1 / Math.sqrt(1 - Math.min(mach, 0.8) ** 2);
        // blade section: lift slope with compressibility, a stall each way, flat-plate behaviour beyond
        const x = al - this.aL0, lin = this.slope * pg * x;
        const sep = x >= 0 ? 1 / (1 + Math.exp(-(x - this.stallX) / this.stallW)) : 1 / (1 + Math.exp((x + 0.2) / 0.035));
        const sa = Math.sin(al), ca = Math.cos(al);
        const cl = (1 - sep) * lin + sep * this.cdSep * sa * ca;
        let cd = (1 - sep) * (0.013 + 0.011 * (lin - 0.35) ** 2) + sep * (0.02 + this.cdSep * sa * sa);
        if (mach > 0.70) cd += 2.2 * (mach - 0.70) ** 2;                                 // thin tips near the speed of sound
        const qc = 0.5 * rho * W2 * e.chord * e.dr * (B / NA);
        const sphi = UP / W, cphi = UT / W;
        const fT = qc * (cl * cphi - cd * sphi), fQ = qc * (cl * sphi + cd * cphi);     // thrust, and force against the rotation
        dT += fT; T += fT; Q += fQ * e.r;
        Fx -= fQ * cp; Fy += fQ * sp;                                                   // -et * fQ
        Mx -= e.r * fT * cp; My += e.r * fT * sp;                                       // r x thrust: more thrust on the right yaws left
      }
      // momentum theory for this ring, with Prandtl's tip loss
      const sphiAvg = Math.abs(Va + e.vi) / (Math.hypot(Va + e.vi, omega * e.r) + 1e-6) + 0.03;
      const f = (B / 2) * (R - e.r) / (e.r * sphiAvg);
      const tip = Math.max(0.1, (2 / Math.PI) * Math.acos(Math.exp(-Math.min(f, 20))));
      const k = dT / (4 * Math.PI * rho * e.r * e.dr * tip);
      const viNew = -Va / 2 + Math.sqrt(Math.max(0, Va * Va / 4 + k)) * (Va >= 0 || k > 0 ? 1 : -1);
      e.vi += (clamp(viNew, -0.9 * Math.abs(Va), 60) - e.vi) * Math.min(1, dt * 40);
    }
    this.thrust = T; this.torque = Q;
    this.F.x = Fx; this.F.y = Fy; this.F.z = -T;
    this.M.x = Mx; this.M.y = My; this.M.z = 0;
    // the slipstream, from the disc's momentum: what the tail and the fuselage feel
    const A = Math.PI * R * R, s = this.slip;
    const rad = Va * Va / 4 + T / (2 * rho * A);
    const vi = rad > 0 ? -Va / 2 + Math.sqrt(rad) : -Va / 2;
    s.Va = Va; s.vi = vi; s.ux = air.x; s.uy = air.y;
    const vw = Math.max(Va + 2 * vi, 2), Rs = R * Math.sqrt(clamp((Va + vi) / vw, 0.25, 1));
    s.swirl = clamp((2 * Q) / (rho * vw * Math.PI * Rs ** 4), -40, 40);                 // rad/s of solid-body rotation
    this.angle = (this.angle + omega * dt) % (2 * Math.PI);
  }
}
