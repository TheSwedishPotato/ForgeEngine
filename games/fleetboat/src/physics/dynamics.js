/**
 * The boat as a rigid body in the sea: six degrees of freedom.
 *
 * Kirchhoff's equations in the boat's own axes (x forward, y up, z starboard, origin on the
 * pressure hull's axis at frame 66 1/2):
 *     M dnu/dt + C(nu) nu = tau
 * M is the rigid body's mass matrix (its centre of gravity wherever the ballast, the fuel and the
 * crew put it) plus the added mass of the water the hull must push aside to accelerate (strip
 * theory: rho pi b^2 a metre for a section moving across its breadth b). C(nu) nu holds the
 * Coriolis and centripetal terms; with the added mass in M it also gives the Munk moment, the
 * potential-flow moment that turns a hull broadside to the flow.
 *
 * tau, the forces and moments:
 *  - gravity at the centre of gravity;
 *  - buoyancy: Archimedes, integrated slice by slice over the part of each cross-section below
 *    the actual water surface there (the wave), with the sea's density at that depth;
 *  - viscous cross-flow drag on each slice (sway, heave and the turning of the body), the
 *    superstructure and the bridge fairwater included when they are in the water;
 *  - resistance along the hull: skin friction by the ITTC 1957 line from the Reynolds number
 *    (Re = V L / nu), a form factor, wave-making as the Froude number rises on the surface, and
 *    the flow through the free-flooding superstructure's limber holes when submerged (fitted to
 *    the class's speeds: 20 1/4 knots surfaced on 5,400 shp, 8 3/4 submerged on 2,740);
 *  - the bow and stern planes and the rudder: lifting surfaces (L = 1/2 rho V^2 S C_L; a
 *    finite wing's lift slope 2 pi AR / (AR + 2) and induced drag; stall); the stern planes and
 *    the rudder sit in the screws' race and see its faster water;
 *  - the screws' thrust along the shafts, off the centreline (one screw turns the boat);
 *  - the seabed, if she touches it.
 */
import { HULL, BOW_PLANES, STERN_PLANES, RUDDER, PROPELLER, FT } from '../data/boat.js';
import { ENVELOPE, buildSlices, clipBelow, breadthAt } from './hull.js';
import { qrot, qrotInv, qmul, qnorm, cross, solve, attitude } from './vec.js';
import { G } from './units.js';

const YA = HULL.axisY;                 // the origin's height above the keel

/** A lifting surface (plane or rudder). */
class Surface {
  constructor({ name, pos, normal, area, AR, stall = 22, cd0 = 0.012, race = 0, straighten = 1, sign = 1, prop = null, needsAwash = false }) {
    Object.assign(this, { name, pos, normal, area, AR, stall: stall * Math.PI / 180, cd0, race, straighten, sign, prop, needsAwash });
    this.slope = 2 * Math.PI * AR / (AR + 2);
    this.angle = 0;                    // radians, as the gear has it (rise / right positive)
    this.out = 1;                      // bow planes: rigged out (1) or in (0)
    this.force = [0, 0, 0];
    this.alpha = 0;
  }
  cl(a) {
    const s = this.stall;
    if (Math.abs(a) <= s) return this.slope * a;
    // past the stall the lift falls to the flat plate's normal force
    const flat = 1.2 * Math.sin(a) * Math.cos(a);
    const at = this.slope * s * Math.sign(a);
    const k = Math.min(1, (Math.abs(a) - s) / (10 * Math.PI / 180));
    return at + (flat - at) * k;
  }
}

export class Dynamics {
  constructor() {
    // the hull in slices: section polygons relative to the origin (z, y - YA)
    this.slices = buildSlices(64).map((s) => {
      const polys = s.polys.map((p) => p.map(([z, y]) => [z, y - YA]));
      const ymin = Math.min(...polys.flat().map((q) => q[1])), ymax = Math.max(...polys.flat().map((q) => q[1]));
      const per = polys.reduce((a, p) => a + perimeter(p), 0);
      const zs = polys.flat().map((q) => q[0]);
      return { x: s.x, dx: s.dx, polys, area: s.area, ymin, ymax, breadth: Math.max(...zs) - Math.min(...zs), per, sub: 0 };
    });
    // the free-flooding superstructure and fairwater: lateral area (for cross-flow) by slice
    for (const s of this.slices) {
      const xf = s.x / FT;
      const deck = deckHeight(xf) * FT - YA;
      s.ssTop = deck; s.ssBot = s.ymax;
      s.ssH = Math.max(0, deck - s.ymax);
      // the fairwater over the conning tower and the bridge (frames ~46 to 60): up to the bridge rail
      if (xf > 16 && xf < 50) { s.ssTop = (HULL.bridgeDeck / FT + 4) * FT - YA; s.ssH = Math.max(s.ssH, s.ssTop - s.ymax); }
      s.ssW = Math.min(16, 2 * ENVELOPE.B) * FT * 0.55;     // its breadth for heave cross-flow (estimate)
    }
    this.L = HULL.lbp;
    // where the flow leaves the tapering stern: slender-body lift comes only from the hull ahead of it
    const amax = Math.max(...this.slices.map((q) => q.area));
    const iMax = this.slices.findIndex((q) => q.area === amax);
    let iSep = iMax;
    while (iSep > 0 && this.slices[iSep - 1].area > 0.9 * amax) iSep--;
    this.xSep = this.slices[iSep].x;
    // a fixed fin at the stern: the deadwood and stern post casting between the shafts, where the
    // rudder hangs (lateral area an estimate), and the bridge fairwater (sail) when submerged
    this.skeg = new Surface({ name: 'skeg', pos: [-(150) * FT, 5.5 * FT - YA, 0], normal: 2, area: 120 * FT * FT, AR: 1.2, stall: 25, straighten: 0.7, sign: 1 });
    this.sail = new Surface({ name: 'fairwater', pos: [30 * FT, 25.5 * FT - YA, 0], normal: 2, area: 300 * FT * FT, AR: 0.9, stall: 28, cd0: 0.03, straighten: 1.0, sign: 1, needsAwash: true });
    // state
    this.pos = [0, 0, 0];               // world position of the origin
    this.q = [0, 0, 0, 1];
    this.v = [0, 0, 0];                 // body velocity of the origin
    this.w = [0, 0, 0];                 // body angular velocity (roll x, yaw y, pitch z)
    // the control surfaces
    this.bowPlanes = new Surface({ name: 'bow planes', pos: [BOW_PLANES.stockX - 1.0, BOW_PLANES.hingeY - YA, 0], normal: 1, area: 2 * BOW_PLANES.area, AR: 2.1, stall: 22, race: 0, straighten: 1.0, sign: 1 });
    this.sternPlanes = new Surface({ name: 'stern planes', pos: [STERN_PLANES.stockX - 0.9, STERN_PLANES.axisY - YA, 0], normal: 1, area: 2 * STERN_PLANES.area, AR: 1.9, stall: 22, race: 0.55, straighten: 0.55, sign: -1 });
    this.rudder = new Surface({ name: 'rudder', pos: [-(159.5 - 3.5) * FT, (RUDDER.height / 2 + 2.5 * FT) - YA, 0], normal: 2, area: RUDDER.area, AR: 1.6, stall: 24, race: 0.25, straighten: 0.55, sign: -1 });
    this.surfaces = [this.bowPlanes, this.sternPlanes, this.rudder, this.skeg, this.sail];
    // the screws: positions and shaft directions (1 1/2 deg down aft, diverging 1 deg 39')
    const px = -(140) * FT, py = PROPELLER.shaftHeight - YA, pz = PROPELLER.shaftOffset;
    const inc = PROPELLER.shaftInclination * Math.PI / 180, div = PROPELLER.shaftDivergence * Math.PI / 180;
    this.screws = [
      { side: 'port', pos: [px, py, -pz], dir: [Math.cos(inc) * Math.cos(div), Math.sin(inc), Math.sin(div) * 0], T: 0 },
      { side: 'stbd', pos: [px, py, pz], dir: [Math.cos(inc) * Math.cos(div), Math.sin(inc), 0], T: 0 },
    ];
    // resistance constants (calibrated, tests/physics.test.js)
    this.formFactor = 0.18;               // 1 + k: the hull's form drag over flat-plate friction
    this.CA = 0.0004;                     // roughness and correlation allowance
    this.waveCoef = 0.0104;               // wave-making: C_W = waveCoef exp(-0.22 / Fn^2), surfaced
    this.subCDA = 13.3;                   // m^2: flow through the superstructure's limber holes, the bridge, guns, shears (submerged)
    this.crossCD = 1.05;                  // cross-flow drag coefficient of the sections
    this.rollDamp = 3.5e7;                // N m s (roll, linear) estimate
    // outputs
    this.out = { buoyancy: 0, Vsub: 0, cb: [0, 0, 0], depthKeel: 0, keelDepth: 0, R: 0, Re: 0, Fn: 0, wetted: 0, awash: 0, subFrac: 0, touching: false };
    this._M = Array.from({ length: 6 }, () => new Array(6).fill(0));
  }

  get attitude() { return attitude(this.q); }

  /** World position of a body point (relative to the origin). */
  toWorld(p, o = [0, 0, 0]) { qrot(this.q, p, o); o[0] += this.pos[0]; o[1] += this.pos[1]; o[2] += this.pos[2]; return o; }
  /** A world vector in the body's axes. */
  toBody(v, o = [0, 0, 0]) { return qrotInv(this.q, v, o); }
  /** Body velocity of a body point. */
  velAt(p, o = [0, 0, 0]) { cross(this.w, p, o); o[0] += this.v[0]; o[1] += this.v[1]; o[2] += this.v[2]; return o; }

  /**
   * One step. ctx: {
   *   mass: { m, rg [3], I [[3x3] about the origin] },
   *   sea: { column (WaterColumn), eta(X, Z) wave height, orbital(X, Y, Z) -> [vx, vy, vz] world, floor(X, Z) depth },
   *   screws: [{ T (N) }, ...]
   * }
   */
  step(dt, ctx) {
    const { mass, sea } = ctx;
    const f = [0, 0, 0], mo = [0, 0, 0];               // body force and moment about the origin
    const R1 = qrotInv(this.q, [0, 1, 0]);             // world up in body axes
    const up = R1;
    // ---- gravity
    const W = mass.m * G;
    const fg = [-up[0] * W, -up[1] * W, -up[2] * W];
    addF(f, mo, fg, mass.rg);
    // ---- buoyancy, the water plane and the cross-flow, slice by slice
    let Vsub = 0, B = 0, cbx = 0, cby = 0, cbz = 0, wet = 0, subAll = 0;
    const tmpW = [0, 0, 0], tmpB = [0, 0, 0], vl = [0, 0, 0];
    const rowY = qrot(this.q, [1, 0, 0]);   // world components of body axes (for heights)
    const rowYy = qrot(this.q, [0, 1, 0]), rowYz = qrot(this.q, [0, 0, 1]);
    const col = sea.column;
    let awashDeck = 0, deckN = 0;
    for (const s of this.slices) {
      // the slice's centre in the world, and the wave height there
      const cx = this.pos[0] + rowY[0] * s.x, cz = this.pos[2] + rowY[2] * s.x;
      const eta = sea.eta(cx, cz);
      // the cut: world height of body point (x, y, z) = pos.y + rowY.y x + rowYy.y y + rowYz.y z <= eta
      const a = rowYz[1], b = rowYy[1], c = eta - this.pos[1] - rowY[1] * s.x;
      let A = 0, zc = 0, yc = 0, girth = 0;
      for (const p of s.polys) {
        const r = clipBelow(p, a, b, c);
        if (r.A > 0) { zc = (zc * A + r.z * r.A) / (A + r.A); yc = (yc * A + r.y * r.A) / (A + r.A); A += r.A; girth += r.wet; }
      }
      const frac = s.area > 0 ? A / s.area : 0;
      s.sub = frac;
      subAll += frac * s.area * s.dx;
      if (A > 0) {
        const worldY = this.pos[1] + rowY[1] * s.x + rowYy[1] * yc + rowYz[1] * zc;
        const depth = Math.max(0, -worldY);
        const rho = col.densityAt(depth);
        const Fb = rho * G * A * s.dx;
        const fb = [up[0] * Fb, up[1] * Fb, up[2] * Fb];
        addF(f, mo, fb, [s.x, yc, zc]);
        Vsub += A * s.dx; B += Fb; cbx += s.x * A * s.dx; cby += yc * A * s.dx; cbz += zc * A * s.dx;
        wet += girth * s.dx;
      }
      // the deck there: is it awash? (the superstructure floods, drags, and has the flow through it)
      const deckY = this.pos[1] + rowY[1] * s.x + rowYy[1] * s.ssTop;
      awashDeck += Math.max(0, Math.min(1, (eta - deckY) / (1.5) + 0.5)); deckN++;
      // ---- the slice's cross flow: its velocity through the water (waves' orbital motion removed)
      const ssWet = Math.max(0, Math.min(1, (eta - (this.pos[1] + rowY[1] * s.x + rowYy[1] * s.ssBot)) / Math.max(0.3, s.ssH)));
      s.ssWet = ssWet;
      if (frac > 0 || ssWet > 0) {
        this.velAt([s.x, 0, 0], vl);
        const wy = Math.min(0, this.pos[1] + rowY[1] * s.x);
        const orb = sea.orbital(cx, wy, cz);
        this.toBody(orb, tmpW);
        s.uy = vl[1] - tmpW[1]; s.uz = vl[2] - tmpW[2];
        const uc = Math.hypot(s.uy, s.uz);
        const rho = 1025;
        const hull = s.ymax - s.ymin;
        // viscous cross-flow drag: heave sees the section's breadth, sway its height (and the
        // superstructure's, when wet); a finite body carries ~70 % of the 2D drag (Allen & Perkins)
        const projY = s.breadth * frac + s.ssW * ssWet * 0.5;
        const projZ = hull * frac + s.ssH * ssWet;
        const fy = -0.5 * rho * this.crossCD * 0.7 * projY * uc * s.uy * s.dx;
        const fz = -0.5 * rho * this.crossCD * 0.7 * projZ * uc * s.uz * s.dx;
        // the side force acts between the hull's centre and the superstructure's, by their wetted heights
        const ycz = (hull * frac * 0.5 * (s.ymin + s.ymax) + s.ssH * ssWet * (s.ssBot + s.ssH / 2)) / Math.max(1e-6, projZ);
        s.ycz = ycz;
        tmpB[0] = 0; tmpB[1] = fy; tmpB[2] = fz;
        addF(f, mo, tmpB, [s.x, ycz, 0]);
        // added mass per metre for the slender-body lift (and the inertia): pi rho b^2 across the breadth
        s.my = rho * Math.PI * (s.breadth / 2) ** 2 * frac;
        s.mz = rho * Math.PI * (hull / 2) ** 2 * frac + rho * Math.PI * (s.ssH / 2) ** 2 * ssWet * 0.5;
      } else { s.uy = s.uz = 0; s.my = s.mz = 0; s.ycz = 0; }
    }
    // ---- slender-body lift (potential flow, Munk), with the flow separating off the tapering stern:
    // f(x) = -U d(m_a v)/dx over the hull ahead of the separation, nothing behind it.
    {
      const U = this.v[0];
      let py = 0, pz = 0;
      for (let i = this.slices.length - 1; i >= 0; i--) {
        const s = this.slices[i];
        if (s.x < this.xSep) break;
        const fy = s.my * s.uy, fz = s.mz * s.uz;
        tmpB[0] = 0; tmpB[1] = -U * (fy - py); tmpB[2] = -U * (fz - pz);
        addF(f, mo, tmpB, [s.x, s.ycz ?? 0, 0]);
        py = fy; pz = fz;
      }
    }
    this.out.awash = deckN ? awashDeck / deckN : 0;
    const subFrac = subAll / this.totalVolume();
    this.out.subFrac = subFrac;
    // ---- resistance along the hull
    const u = this.v[0];
    const V = Math.abs(u);
    const keelDepth = -this.toWorld([0, -YA, 0])[1];
    const nuW = col.kinematicViscosityAt(Math.max(1, keelDepth));
    const Re = Math.max(1e5, V * this.L / nuW);
    const CF = 0.075 / (Math.log10(Re) - 2) ** 2;
    const S = Math.max(wet, 1);
    const Fn = V / Math.sqrt(G * this.L);
    // wave-making: full on the surface, dying away as the hull goes deeper than its own diameter
    const topDepth = -this.toWorld([0, HULL.innerHullTop - YA, 0])[1];
    const waveFade = Math.exp(-Math.max(0, topDepth) / 4.0);
    const CW = this.waveCoef * Math.exp(-0.22 / Math.max(0.05, Fn * Fn)) * waveFade;
    // the flow through the superstructure: only once it is under water
    const subDrag = this.subCDA * this.out.awash;
    const Rv = 0.5 * 1025 * V * V * (S * (CF * (1 + this.formFactor) + this.CA + CW) + subDrag);
    const R = Rv * Math.sign(u);
    f[0] -= R;
    this.out.R = Rv; this.out.Re = Re; this.out.Fn = Fn; this.out.CF = CF; this.out.CW = CW; this.out.wetted = S;
    // ---- the screws
    for (let i = 0; i < this.screws.length; i++) {
      const sc = this.screws[i], T = ctx.screws?.[i]?.T ?? 0;
      sc.T = T;
      const ft = [sc.dir[0] * T, sc.dir[1] * T, sc.dir[2] * T];
      addF(f, mo, ft, sc.pos);
    }
    // ---- the planes and the rudder
    for (const sf of this.surfaces) this._surface(sf, f, mo, ctx);
    // ---- roll damping (the hull's sections, the keel, the superstructure): linear, an estimate
    mo[0] -= this.rollDamp * this.w[0] * (0.4 + 0.6 * subFrac);
    // ---- the seabed
    this._ground(f, mo, sea, mass);
    // ---- solve M dnu/dt = tau - C nu (the added mass in M's inertia; C from the rigid body alone,
    // the added mass's share of it, the Munk moment, being the slender-body lift above)
    const M = this._massMatrix(mass, subFrac);
    const nu = [...this.v, ...this.w];
    const Mv = mul6(this._MRB, nu);
    const pl = [Mv[0], Mv[1], Mv[2]], pa = [Mv[3], Mv[4], Mv[5]];
    const c1 = cross(this.w, pl), c2 = cross(this.w, pa), c3 = cross(this.v, pl);
    const rhs = [f[0] - c1[0], f[1] - c1[1], f[2] - c1[2], mo[0] - c2[0] - c3[0], mo[1] - c2[1] - c3[1], mo[2] - c2[2] - c3[2]];
    const acc = solve(M.map((r) => r.slice()), rhs);
    for (let i = 0; i < 3; i++) { this.v[i] += acc[i] * dt; this.w[i] += acc[i + 3] * dt; }
    // ---- move
    const vw = qrot(this.q, this.v);
    for (let i = 0; i < 3; i++) this.pos[i] += vw[i] * dt;
    const dq = qmul(this.q, [this.w[0] * dt * 0.5, this.w[1] * dt * 0.5, this.w[2] * dt * 0.5, 0]);
    for (let i = 0; i < 4; i++) this.q[i] += dq[i];
    qnorm(this.q);
    // ---- outputs
    this.out.Vsub = Vsub; this.out.buoyancy = B;
    this.out.cb = Vsub > 0 ? [cbx / Vsub, cby / Vsub, cbz / Vsub] : [0, 0, 0];
    this.out.keelDepth = keelDepth;
    this.out.acc = acc;
    this.out.force = f; this.out.moment = mo;
    return this.out;
  }

  totalVolume() {
    if (this._vol) return this._vol;
    let V = 0;
    for (const s of this.slices) V += s.area * s.dx;
    return (this._vol = V);
  }

  _surface(sf, f, mo, ctx) {
    sf.force[0] = sf.force[1] = sf.force[2] = 0;
    // in the water at all? (the bow planes come out on the surface)
    const w = this.toWorld(sf.pos);
    const eta = ctx.sea.eta(w[0], w[2]);
    const imm = Math.max(0, Math.min(1, (eta - w[1]) / 1.0 + 0.3));
    if (imm <= 0 || sf.out <= 0) { sf.alpha = 0; return; }
    const vl = this.velAt(sf.pos);
    const n = sf.normal;                                  // 1: horizontal plane (lift along y), 2: rudder (along z)
    // the surface's motion through the water in the plane of the chord and the normal; the hull
    // straightens the cross flow at the stern
    let mx = vl[0], mn = vl[n] * sf.straighten;
    let V2 = mx * mx + mn * mn;
    // the screws' race over the stern surfaces (ahead only): momentum theory's far-wake velocity
    if (sf.race > 0 && mx > 0) {
      const T = Math.max(0, (this.screws[0].T + this.screws[1].T) / 2);
      const Va = mx * 0.9;
      const D = PROPELLER.dia;
      const slip2 = Va * Va + 8 * T / (1025 * Math.PI * D * D);
      const ax2 = (1 - sf.race) * mx * mx + sf.race * slip2;
      mx = Math.sqrt(ax2);
      V2 = ax2 + mn * mn;
    }
    if (V2 < 1e-6) { sf.alpha = 0; return; }
    const V = Math.sqrt(V2);
    const ux = mx / V, un = mn / V;                       // unit direction of motion through the water
    // the chord, leading edge forward, turned by the gear (rise or right rudder per the sign);
    // a symmetric section: take the chord's end that leads in the direction of motion
    const th = sf.angle * sf.sign;
    let cx = Math.cos(th), cn = Math.sin(th);
    if (cx * ux + cn * un < 0) { cx = -cx; cn = -cn; }
    const alpha = Math.atan2(ux * cn - un * cx, ux * cx + un * cn);
    sf.alpha = alpha;
    const q = 0.5 * 1025 * V2 * sf.area * imm * sf.out;
    const CL = sf.cl(alpha);
    const CD = sf.cd0 + (Math.abs(alpha) < sf.stall ? CL * CL / (Math.PI * sf.AR * 0.85) : 1.2 * Math.sin(alpha) ** 2);
    // lift at right angles to the motion (turned +90 degrees), drag against it
    const fx = q * (CL * -un - CD * ux);
    const fn = q * (CL * ux - CD * un);
    const out = [fx, 0, 0];
    out[n] = fn;
    sf.force[0] = out[0]; sf.force[1] = out[1]; sf.force[2] = out[2];
    addF(f, mo, out, sf.pos);
  }

  /** The seabed: a stiff, damped contact at points along the keel. */
  _ground(f, mo, sea, mass) {
    this.out.touching = false;
    if (!sea.floor) return;
    for (const xf of [140, 100, 50, 0, -50, -100, -150]) {
      const pb = [xf * FT, -YA + (xf > 120 || xf < -120 ? 2 : 0), 0];
      const pw = this.toWorld(pb);
      const fl = -sea.floor(pw[0], pw[2]);              // world height of the bottom
      const pen = fl - pw[1];
      if (pen <= 0) continue;
      this.out.touching = true;
      const vb = this.velAt(pb);
      const vw = qrot(this.q, vb);
      const k = mass.m * 2.0, c = mass.m * 1.2;         // a soft mud bottom (estimate)
      const Fn = Math.max(0, k * pen - c * vw[1]);
      // friction against the bottom's sliding
      const vh = Math.hypot(vw[0], vw[2]);
      const mu = 0.35;
      const fwx = vh > 1e-4 ? -mu * Fn * vw[0] / Math.max(vh, 0.05) : 0, fwz = vh > 1e-4 ? -mu * Fn * vw[2] / Math.max(vh, 0.05) : 0;
      const fb = this.toBody([fwx, Fn, fwz]);
      addF(f, mo, fb, pb);
    }
  }

  /** The 6x6 mass matrix: the rigid body (about the origin, CG at rg) plus the added mass. */
  _massMatrix(mass, subFrac) {
    const M = this._M;
    for (const r of M) r.fill(0);
    const m = mass.m, g = mass.rg, I = mass.I;
    M[0][0] = M[1][1] = M[2][2] = m;
    // -m S(rg) and m S(rg)
    const S = [[0, -g[2], g[1]], [g[2], 0, -g[0]], [-g[1], g[0], 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { M[i][3 + j] = -m * S[i][j]; M[3 + i][j] = m * S[i][j]; M[3 + i][3 + j] = I[i][j]; }
    this._MRB = M.map((r) => r.slice());
    // added mass by strips, the submerged part of each section
    let ax = 0, ay = 0, az = 0, ayx = 0, azx = 0, ayxx = 0, azxx = 0;
    for (const s of this.slices) {
      const b = s.breadth / 2, h = (s.ymax - s.ymin) / 2;
      const my = 1025 * Math.PI * b * b * s.sub, mz = 1025 * Math.PI * h * h * s.sub;
      ay += my * s.dx; az += mz * s.dx;
      ayx += my * s.x * s.dx; azx += mz * s.x * s.dx;
      ayxx += my * s.x * s.x * s.dx; azxx += mz * s.x * s.x * s.dx;
    }
    // the water inside the free-flooding superstructure goes along when she is under (estimate: 6,500 cu ft)
    const ss = 1025 * 6500 * FT ** 3 * this.out.awash;
    ax = 0.025 * 1025 * this.totalVolume() * subFrac + ss;
    M[0][0] += ax;
    M[1][1] += ay + ss; M[2][2] += az + ss;
    // heave-pitch (y, about z) and sway-yaw (z, about y) couplings, and the rotational terms
    M[1][5] += ayx; M[5][1] += ayx;
    M[2][4] += -azx; M[4][2] += -azx;
    M[5][5] += ayxx; M[4][4] += azxx;
    M[3][3] += 0.12 * I[0][0] * subFrac;           // roll: the water the superstructure and keel carry round (estimate)
    return M;
  }
}

function addF(f, mo, F, r) {
  f[0] += F[0]; f[1] += F[1]; f[2] += F[2];
  mo[0] += r[1] * F[2] - r[2] * F[1];
  mo[1] += r[2] * F[0] - r[0] * F[2];
  mo[2] += r[0] * F[1] - r[1] * F[0];
}

function mul6(M, v) { const o = new Array(6).fill(0); for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) o[i] += M[i][j] * v[j]; return o; }

function perimeter(p) { let L = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }

/** The main deck's height above the keel along the length (ft): 27'-6" at the bow to 22'-3 5/8" aft. */
export function deckHeight(xf) {
  const bow = HULL.deckBow / FT, mid = HULL.depthMoulded / FT + 0.4, stern = HULL.deckStern / FT;
  if (xf > 20) return mid + (bow - mid) * Math.min(1, Math.pow((xf - 20) / (152 - 20), 1.6));
  if (xf < -40) return mid + (stern - mid) * Math.min(1, (-40 - xf) / (159.5 - 40));
  return mid;
}

export { YA };
