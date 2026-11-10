/**
 * Aerodynamics from the airflow up. Nothing here knows about "stall speed" or "roll rate": the wing, tailplane and fin are cut
 * into strips, every strip meets its own local air (the aeroplane's motion and rotation, wind and gusts at that spot, the
 * propeller's slipstream, the downwash of every other strip), and looks its lift, drag and moment up from wind-tunnel-style
 * section data that covers the whole circle, stalled and backwards included.
 *
 * The strips are tied together by a lifting-line vortex model: each one carries a bound vortex and sheds two trailing vortices,
 * and Biot-Savart gives the velocity they induce on each other. From that come, unscripted: induced drag, the lift-curve slope of
 * a finite wing, downwash on the tail (and its change with flaps), roll damping, adverse yaw, tip or root stall, spins, and
 * ground effect (the vortex system is mirrored in the ground).
 */
import { DEG, sat, smooth, lag, table } from './util.js';

const FOUR_PI = 4 * Math.PI;

/** An aerofoil section at any angle of attack, with the effect of a hinged trailing-edge surface. */
export class Section {
  constructor(o = {}) {
    this.a0 = o.a0 ?? 6.05;                 // lift-curve slope, per rad (2D)
    this.aL0 = o.aL0 ?? 0;                  // zero-lift angle
    this.clmax = o.clmax ?? 1.5; this.clmin = o.clmin ?? -this.clmax;
    this.cd0 = o.cd0 ?? 0.007; this.cd2 = o.cd2 ?? 0.008; this.clMinD = o.clMinD ?? 0;
    this.cm0 = o.cm0 ?? 0;
    this.w = o.w ?? 1.8 * DEG;              // how sharp the stall is
    this.cdmax = o.cdmax ?? 1.8;            // flat-plate drag broadside on
    // where the stall has to sit for the peak of the blended curve to be clmax
    this.kappa = 1;
    for (let it = 0; it < 4; it++) {
      const xs = this.clmax / (this.a0 * this.kappa);
      let peak = 0;
      for (let x = 0; x < xs + 0.3; x += 0.002) {
        const s = 1 / (1 + Math.exp(-(x - xs) / this.w)), al = x + this.aL0;
        peak = Math.max(peak, (1 - s) * this.a0 * x + s * this.cdmax * Math.sin(al) * Math.cos(al));
      }
      this.kappa *= peak / this.clmax;
    }
    this.cl = 0; this.cd = 0; this.cm = 0; this.sep = 0;
  }

  /** Sets cl, cd, cm (about the quarter chord) and sep (0 attached .. 1 fully separated). */
  eval(alpha, dAL0 = 0, dClmax = 0, dCd = 0, dCm = 0) {
    const a0 = this.a0, x = alpha - this.aL0 - dAL0, k = a0 * this.kappa;
    const sep = x >= 0 ? 1 / (1 + Math.exp(-(x - (this.clmax + dClmax) / k) / this.w))
      : 1 / (1 + Math.exp((x - (this.clmin + 0.5 * dClmax) / k) / this.w));
    const s = Math.sin(alpha), c = Math.cos(alpha);
    const clSep = this.cdmax * s * c, cdSep = this.cd0 + dCd + this.cdmax * s * s;
    const clLin = a0 * x, cc = Math.max(-2.6, Math.min(2.6, clLin)) - this.clMinD;
    this.cl = (1 - sep) * clLin + sep * clSep;
    this.cd = (1 - sep) * (this.cd0 + dCd + this.cd2 * cc * cc) + sep * cdSep;
    // separated flow moves the centre of pressure back toward mid-chord
    this.cm = (1 - sep) * (this.cm0 + dCm) - sep * 0.2 * (clSep * c + cdSep * s);
    this.sep = sep;
    return this;
  }
}

const ETA_PLAIN = [[0, 10, 20, 30, 45], [0.85, 0.82, 0.62, 0.5, 0.4]];
const ETA_SLOT = [[0, 10, 20, 30, 40], [0.88, 0.82, 0.64, 0.50, 0.40]];   // slotted flaps that also run aft on their tracks
/** Thin-aerofoil flap effectiveness for a flap of chord fraction cf. */
const flapTau = (cf) => { const th = Math.acos(2 * cf - 1); return 1 - (th - Math.sin(th)) / Math.PI; };

export class Aero {
  /**
   * @param {object} cfg  surfaces: [{ name, section, stations: [{ p: [x,y,z], chord, inc }], controls(strip) }],
   *                      bodies: [{ p, f, slip }], fuselage: { volume, kYaw, kPitch, side, stations: [{ z, y, side, plan }] }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.strips = [];
    cfg.surfaces.forEach((sf, si) => {
      const st = sf.stations;
      for (let i = 0; i + 1 < st.length; i++) {
        const A = st[i].p, B = st[i + 1].p;
        const pos = { x: (A[0] + B[0]) / 2, y: (A[1] + B[1]) / 2, z: (A[2] + B[2]) / 2 };
        const span = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
        // the span axis is taken square to the flight direction (sweep only moves the strip)
        let sx = B[0] - A[0], sy = B[1] - A[1];
        const sn = Math.hypot(sx, sy); sx /= sn; sy /= sn;
        const width = sn;
        const n0 = { x: -sy, y: sx, z: 0 };          // s x fwd0, with fwd0 = (0,0,-1)
        const inc = (st[i].inc + st[i + 1].inc) / 2, ci = Math.cos(inc), sI = Math.sin(inc);
        const chord = (st[i].chord + st[i + 1].chord) / 2;
        const strip = {
          surf: si, name: sf.name, pos, a: { x: A[0], y: A[1], z: A[2] }, b: { x: B[0], y: B[1], z: B[2] },
          fwd: { x: n0.x * sI, y: n0.y * sI, z: -ci }, nrm: { x: n0.x * ci, y: n0.y * ci, z: sI }, axis: { x: sx, y: sy, z: 0 },
          chord, width, span, area: chord * width, section: sf.section, ctrl: 0, cf: 0, tau: 0, slot: false,
          gamma: 0, alpha: 0, V: 0, cl: 0, sep: 0, w0: { x: 0, y: 0, z: 0 }, upwashK: 0, slipHalf: width / 2,
        };
        sf.controls?.(strip);
        if (strip.ctrl) strip.tau = flapTau(strip.cf);
        if (sf.fuselageUpwash) {                  // crossflow round the cabin lifts the windward root of a high wing
          const a = sf.fuselageUpwash.radius, h = sf.fuselageUpwash.height, x = pos.x;
          strip.upwashK = (a * a * 2 * x * h) / ((x * x + h * h) ** 2);
        }
        this.strips.push(strip);
      }
    });
    const n = this.n = this.strips.length;
    this.W = new Float64Array(n * n * 3);        // velocity induced at strip i by unit circulation on strip j
    this.F = { x: 0, y: 0, z: 0 }; this.M = { x: 0, y: 0, z: 0 };
    this.tail = { alpha: 0, q: 0 }; this.buffet = 0; this.hornAlpha = 0; this.hornQ = 0; this.fade = 0;
    this.wingCL = 0;
  }

  /**
   * Rebuilds the influence of every horseshoe vortex on every strip. `d`: unit vector the wake trails along (body axes).
   * `ground`: null, or the ground plane in structural coordinates as { nx, ny, nz, px, py, pz } (unit normal and a point on it).
   */
  influence(d, ground) {
    const S = this.strips, n = this.n, W = this.W, RC2 = 0.0036;
    let ox, oy, oz;
    const semi = (p1, dx, dy, dz, P, g) => {       // a vortex from p1 to infinity along d
      const rx = P.x - p1.x, ry = P.y - p1.y, rz = P.z - p1.z;
      const cx = dy * rz - dz * ry, cy = dz * rx - dx * rz, cz = dx * ry - dy * rx;
      const f = g * (1 + (rx * dx + ry * dy + rz * dz) / (Math.hypot(rx, ry, rz) + 1e-9)) / (FOUR_PI * (cx * cx + cy * cy + cz * cz + RC2));
      ox += cx * f; oy += cy * f; oz += cz * f;
    };
    const seg = (p1, p2, P, g) => {                // a straight vortex from p1 to p2
      const r1x = P.x - p1.x, r1y = P.y - p1.y, r1z = P.z - p1.z, r2x = P.x - p2.x, r2y = P.y - p2.y, r2z = P.z - p2.z;
      const cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x;
      const r0x = p2.x - p1.x, r0y = p2.y - p1.y, r0z = p2.z - p1.z;
      const l1 = Math.hypot(r1x, r1y, r1z) + 1e-9, l2 = Math.hypot(r2x, r2y, r2z) + 1e-9;
      const f = g * ((r0x * r1x + r0y * r1y + r0z * r1z) / l1 - (r0x * r2x + r0y * r2y + r0z * r2z) / l2)
        / (FOUR_PI * (cx * cx + cy * cy + cz * cz + RC2 * (r0x * r0x + r0y * r0y + r0z * r0z)));
      ox += cx * f; oy += cy * f; oz += cz * f;
    };
    const mirror = (p, o) => {
      const t = 2 * ((p.x - ground.px) * ground.nx + (p.y - ground.py) * ground.ny + (p.z - ground.pz) * ground.nz);
      o.x = p.x - t * ground.nx; o.y = p.y - t * ground.ny; o.z = p.z - t * ground.nz; return o;
    };
    let mdx = 0, mdy = 0, mdz = 0;
    if (ground) { const t = 2 * (d.x * ground.nx + d.y * ground.ny + d.z * ground.nz); mdx = d.x - t * ground.nx; mdy = d.y - t * ground.ny; mdz = d.z - t * ground.nz; }
    const ma = { x: 0, y: 0, z: 0 }, mb = { x: 0, y: 0, z: 0 };
    for (let j = 0; j < n; j++) {
      const sj = S[j];
      if (ground) { mirror(sj.a, ma); mirror(sj.b, mb); }
      for (let i = 0; i < n; i++) {
        const si = S[i], P = si.pos;
        ox = oy = oz = 0;
        semi(sj.b, d.x, d.y, d.z, P, 1); semi(sj.a, d.x, d.y, d.z, P, -1);
        if (si.surf !== sj.surf) seg(sj.a, sj.b, P, 1);
        if (ground && sj.surf !== 2) {            // the image has the opposite circulation
          semi(mb, mdx, mdy, mdz, P, -1); semi(ma, mdx, mdy, mdz, P, 1); seg(ma, mb, P, -1);
        }
        const k = (i * n + j) * 3;
        W[k] = ox; W[k + 1] = oy; W[k + 2] = oz;
      }
    }
  }

  /**
   * One step of the airflow. Sets this.F and this.M (N and N m in body axes, moments about `cg`).
   * @param {number} dt
   * @param {number} rho
   * @param {{x,y,z}} vb   velocity of the centre of gravity, body axes
   * @param {{x,y,z}} om   rotation rate, body axes
   * @param {object} air   air velocity in body axes as a linear field: { c, gx, gz } = value at the reference point and its change per metre of x and z
   * @param {object} slip  the propeller's slipstream (see Propeller.slip), or null
   * @param {object} ctl   surface angles in rad: flap, ailL, ailR, elev (trailing edge down is positive), rudder (right pedal positive)
   * @param {{x,y,z}} cg   centre of gravity, structural coordinates
   */
  step(dt, rho, vb, om, air, slip, ctl, cg) {
    const S = this.strips, n = this.n, W = this.W, F = this.F, M = this.M;
    let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0;
    const ref = air.ref;
    const airAt = (p, o) => {
      const dx = p.x - ref.x, dz = p.z - ref.z;
      o.x = air.c.x + air.gx.x * dx + air.gz.x * dz; o.y = air.c.y + air.gx.y * dx + air.gz.y * dz; o.z = air.c.z + air.gx.z * dx + air.gz.z * dz;
      return o;
    };
    const slipAt = (p, half, o, swirlK = 1) => {
      if (!slip) return 0;
      const dz = p.z - slip.hub.z;
      if (dz <= 0) return 0;
      const kd = 1 + dz / Math.hypot(dz, slip.R), vax = slip.Va + slip.vi * kd;
      if (vax < 0.5) return 0;
      const Rs = slip.R * Math.sqrt(Math.max(0.15, (slip.Va + slip.vi) / vax));
      const ex = p.x - (slip.hub.x + dz * slip.ux / vax), ey = p.y - (slip.hub.y + dz * slip.uy / vax);
      const wgt = smooth(Rs + half + 0.05, Rs - half - 0.05, Math.hypot(ex, ey));
      if (wgt <= 0) return 0;
      const sw = slip.swirl * swirlK * wgt;
      o.x += sw * ey; o.y -= sw * ex; o.z += slip.vi * kd * wgt;
      return wgt;
    };
    const a = { x: 0, y: 0, z: 0 };
    const relVel = (p, half, o, swirlK) => {       // velocity of a point of the airframe through its local air
      const rx = p.x - cg.x, ry = p.y - cg.y, rz = p.z - cg.z;
      airAt(p, a); slipAt(p, half, a, swirlK);
      o.x = vb.x + om.y * rz - om.z * ry - a.x; o.y = vb.y + om.z * rx - om.x * rz - a.y; o.z = vb.z + om.x * ry - om.y * rx - a.z;
    };

    const vinf = Math.hypot(vb.x - air.c.x, vb.y - air.c.y, vb.z - air.c.z);
    const fade = this.fade = smooth(3, 9, vinf);
    for (let i = 0; i < n; i++) relVel(S[i].pos, S[i].slipHalf, S[i].w0, 0.75);

    let tailA = 0, tailQ = 0, tailN = 0, buffet = 0, wingL = 0;
    for (let i = 0; i < n; i++) {
      const s = S[i], w0 = s.w0;
      let ux = 0, uy = 0, uz = 0;
      if (fade > 0) {
        for (let j = 0, k = i * n * 3; j < n; j++, k += 3) { const g = S[j].gamma; ux += W[k] * g; uy += W[k + 1] * g; uz += W[k + 2] * g; }
        ux *= fade; uy *= fade; uz *= fade;
      }
      const wx = w0.x - ux, wy = w0.y - uy - w0.x * s.upwashK, wz = w0.z - uz;
      const Vf = wx * s.fwd.x + wy * s.fwd.y + wz * s.fwd.z, Vn = wx * s.nrm.x + wy * s.nrm.y + wz * s.nrm.z;
      const V2 = Vf * Vf + Vn * Vn, V = Math.sqrt(V2);
      if (V < 0.05) { s.gamma *= 0.9; s.alpha = 0; s.V = 0; s.sep = 0; s.q = 0; s.cl = 0; continue; }
      const alpha = Math.atan2(-Vn, Vf);
      // the hinged surface on this strip
      let dAL0 = 0, dClmax = 0, dCd = 0, dCm = 0;
      if (s.ctrl) {
        const dl = s.ctrl === 1 ? ctl.flap : s.ctrl === 2 ? ctl.ailL : s.ctrl === 3 ? ctl.ailR : s.ctrl === 4 ? ctl.elev : -ctl.rudder;
        if (dl !== 0) {
          const ad = Math.abs(dl) / DEG, eta = s.slot ? table(ETA_SLOT[0], ETA_SLOT[1], ad) : table(ETA_PLAIN[0], ETA_PLAIN[1], ad);
          const dcl = s.section.a0 * s.tau * eta * dl, sd = Math.sin(dl);
          dAL0 = -s.tau * eta * dl;
          dClmax = dcl * (s.slot ? 1.0 : 0.5);
          dCd = (s.slot ? 0.171 : 0.06) * sd * sd;
          dCm = -dcl * (s.slot ? 0.22 : 0.14);
        }
      }
      const sec = s.section.eval(alpha, dAL0, dClmax, dCd, dCm);
      s.margin = (s.section.clmax + dClmax) / (s.section.a0 * s.section.kappa) - (alpha - s.section.aL0 - dAL0);      // radians short of the stall
      // circulation follows the section's lift with the lag of a few chords of travel (and that keeps the vortex system stable)
      s.gamma += (0.5 * V * s.chord * sec.cl - s.gamma) * Math.min(0.22, lag(dt, Math.max(0.012, Math.min(0.09, 1.2 * s.chord / V))));
      const q = 0.5 * rho * V2;
      const L = rho * V * s.gamma * s.width, D = q * s.area * sec.cd, Mo = q * s.area * s.chord * sec.cm;
      const iv = 1 / V;
      const fx = (L * (Vf * s.nrm.x - Vn * s.fwd.x) - D * (Vf * s.fwd.x + Vn * s.nrm.x)) * iv;
      const fy = (L * (Vf * s.nrm.y - Vn * s.fwd.y) - D * (Vf * s.fwd.y + Vn * s.nrm.y)) * iv;
      const fz = (L * (Vf * s.nrm.z - Vn * s.fwd.z) - D * (Vf * s.fwd.z + Vn * s.nrm.z)) * iv;
      const rx = s.pos.x - cg.x, ry = s.pos.y - cg.y, rz = s.pos.z - cg.z;
      Fx += fx; Fy += fy; Fz += fz;
      Mx += ry * fz - rz * fy + Mo * s.axis.x; My += rz * fx - rx * fz + Mo * s.axis.y; Mz += rx * fy - ry * fx + Mo * s.axis.z;
      s.alpha = alpha; s.V = V; s.cl = sec.cl; s.sep = sec.sep; s.q = q;
      if (s.surf === 0) { buffet += sec.sep * q * s.area * (Math.abs(s.pos.x) < 2.7 ? 1 : 0.3); wingL += L; }
      else if (s.surf === 1) { tailA += alpha; tailQ += q; tailN++; }
    }
    this.tail.alpha = tailN ? tailA / tailN : 0; this.tail.q = tailN ? tailQ / tailN : 0; this.buffet = buffet;
    this.wingCL = wingL / (0.5 * rho * Math.max(vinf * vinf, 1) * this.cfg.refArea);
    const h = this.cfg.hornStrip; this.hornAlpha = S[h].alpha; this.hornQ = S[h].q ?? 0; this.hornSep = S[h].sep;

    // everything that is not a wing: undercarriage, struts, the cowl's cooling air - each a drag area in its own local flow
    const w = { x: 0, y: 0, z: 0 };
    for (const b of this.cfg.bodies) {
      relVel(b.p, 0.25, w, 0.5);
      const k = -0.5 * rho * Math.hypot(w.x, w.y, w.z) * b.f;
      const fx = k * w.x, fy = k * w.y, fz = k * w.z, rx = b.p.x - cg.x, ry = b.p.y - cg.y, rz = b.p.z - cg.z;
      Fx += fx; Fy += fy; Fz += fz; Mx += ry * fz - rz * fy; My += rz * fx - rx * fz; Mz += rx * fy - ry * fx;
    }
    // the fuselage: cross-flow drag along its length, a side force in a slip, and the unstable (Munk) moments of a slender body
    const fu = this.cfg.fuselage;
    for (const st of fu.stations) {
      relVel(st.p, 0.3, w, 0.5);
      const fx = -0.5 * rho * Math.abs(w.x) * w.x * fu.cdc * st.side, fy = -0.5 * rho * Math.abs(w.y) * w.y * fu.cdc * st.plan;
      const ry = st.p.y - cg.y, rz = st.p.z - cg.z;
      Fx += fx; Fy += fy; Mx += -rz * fy; My += rz * fx; Mz += -ry * fx;
    }
    relVel(fu.centre, 0.3, w, 0);
    const u = Math.max(0, -w.z);
    const sf = -fu.side * rho * u * w.x;
    Fx += sf; My += (fu.centre.z - cg.z) * sf; Mz += -(fu.centre.y - cg.y) * sf;
    My += fu.kYaw * rho * fu.volume * u * w.x;
    Mx -= fu.kPitch * rho * fu.volume * u * w.y;

    F.x = Fx; F.y = Fy; F.z = Fz; M.x = Mx; M.y = My; M.z = Mz;
  }
}
