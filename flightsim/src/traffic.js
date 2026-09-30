// The other aircraft. Each one is a flight from the real 2026 timetables around SK1415 (Arlanda's
// first-wave departures and arrivals, Kastrup's arrivals and departures around 07:00, an opposite-
// direction flight on the airway), leaving and arriving by its schedule with a realistic spread of
// delays. From then on nothing is timed: every aircraft is a point mass flown along its route by its
// own crew - thrust against drag and rolling friction on the take-off run, climb gradient from excess
// thrust, a speed schedule and a 3° path on arrival - and it moves only when ATC has cleared it, keeps
// its distance behind whoever is ahead on the taxiway, and goes around if the runway is not free.
import { Path, runwayInfo, pushbackPath } from './flight.js';
import { ARN, CPH, ARN_LAYOUT as L, CPH_LAYOUT as C, ROUTE_AIR } from './places.js';
import { project, clamp, lerp, DEG, KT, FT } from './core.js';

const G = 9.80665;
// Performance: masses at a typical short-haul take-off weight, wing area, drag polar (OpenAP-style
// CD0 and induced factor), static thrust of both engines, rotation and approach speeds.
export const TYPES = {
  A20N: { name: 'Airbus A320neo', len: 37.6, span: 35.8, mass: 66000, S: 122.6, cd0: 0.018, k: 0.037, T0: 241e3, vr: 140, vapp: 135, wake: 'M' },
  A21N: { name: 'Airbus A321neo', len: 44.5, span: 35.8, mass: 80000, S: 122.6, cd0: 0.018, k: 0.037, T0: 290e3, vr: 150, vapp: 142, wake: 'M' },
  A320: { name: 'Airbus A320', len: 37.6, span: 34.1, mass: 68000, S: 122.6, cd0: 0.019, k: 0.038, T0: 225e3, vr: 142, vapp: 137, wake: 'M' },
  A319: { name: 'Airbus A319', len: 33.8, span: 34.1, mass: 60000, S: 122.6, cd0: 0.019, k: 0.038, T0: 200e3, vr: 135, vapp: 131, wake: 'M' },
  B738: { name: 'Boeing 737-800', len: 39.5, span: 35.8, mass: 67000, S: 124.6, cd0: 0.019, k: 0.036, T0: 242e3, vr: 145, vapp: 143, wake: 'M' },
  B38M: { name: 'Boeing 737 MAX 8', len: 39.5, span: 35.9, mass: 68000, S: 127.0, cd0: 0.018, k: 0.036, T0: 260e3, vr: 145, vapp: 142, wake: 'M' },
  BCS3: { name: 'Airbus A220-300', len: 38.7, span: 35.1, mass: 58000, S: 112.3, cd0: 0.019, k: 0.036, T0: 208e3, vr: 135, vapp: 130, wake: 'M' },
  CRJ9: { name: 'Bombardier CRJ900', len: 36.2, span: 24.9, mass: 34000, S: 71.0, cd0: 0.022, k: 0.040, T0: 128e3, vr: 140, vapp: 140, wake: 'M' },
};

// Timetable (local time, hours). Sources: flight-information boards for ARN and CPH (2026 schedules);
// types are the ones the airlines normally operate on the route.
export const SCHEDULE = [
  // Arlanda departures in the first wave
  { flt: 'AF1463', tel: 'Airfrans one four six three', al: 'airfrance', type: 'A320', kind: 'dep', apt: 'ARN', time: 5 + 55 / 60, to: 'CDG', ll: [49.01, 2.55] },
  { flt: 'LX1255', tel: 'Swiss one two five five', al: 'swiss', type: 'BCS3', kind: 'dep', apt: 'ARN', time: 6 + 5 / 60, to: 'ZRH', ll: [47.46, 8.55] },
  { flt: 'LH811', tel: 'Lufthansa eight one one', al: 'lufthansa', type: 'A20N', kind: 'dep', apt: 'ARN', time: 6 + 10 / 60, to: 'FRA', ll: [50.03, 8.57] },
  { flt: 'AY826', tel: 'Finnair eight two six', al: 'finnair', type: 'A320', kind: 'dep', apt: 'ARN', time: 6 + 20 / 60, to: 'HEL', ll: [60.32, 24.96] },
  { flt: 'FR1400', tel: 'Ryanair one four zero zero', al: 'ryanair', type: 'B738', kind: 'dep', apt: 'ARN', time: 6 + 20 / 60, to: 'STN', ll: [51.88, 0.24] },
  { flt: 'SK485', tel: 'Scandinavian four eight five', al: 'sas', type: 'A20N', kind: 'dep', apt: 'ARN', time: 6 + 25 / 60, to: 'OSL', ll: [60.19, 11.10] },
  // Arlanda arrivals (on the other parallel runway)
  { flt: 'SK25', tel: 'Scandinavian two five', al: 'sas', type: 'A20N', kind: 'arr', apt: 'ARN', time: 6 + 20 / 60, from: 'UME', ll: [63.79, 20.28] },
  { flt: 'JU380', tel: 'Air Serbia three eight zero', al: 'airserbia', type: 'A319', kind: 'arr', apt: 'ARN', time: 6 + 30 / 60, from: 'BEG', ll: [44.82, 20.31] },
  { flt: 'SK86', tel: 'Scandinavian eight six', al: 'sas', type: 'CRJ9', kind: 'arr', apt: 'ARN', time: 6 + 40 / 60, from: 'VBY', ll: [57.66, 18.35] },
  { flt: 'FR4617', tel: 'Ryanair four six one seven', al: 'ryanair', type: 'B738', kind: 'arr', apt: 'ARN', time: 6 + 40 / 60, from: 'GDN', ll: [54.38, 18.47] },
  { flt: 'AY801', tel: 'Finnair eight zero one', al: 'finnair', type: 'A320', kind: 'arr', apt: 'ARN', time: 6 + 45 / 60, from: 'HEL', ll: [60.32, 24.96] },
  // Kastrup around our arrival: landings on our runway, departures from the parallel one
  { flt: 'SK1202', tel: 'Scandinavian one two zero two', al: 'sas', type: 'CRJ9', kind: 'arr', apt: 'CPH', time: 7 + 0 / 60, from: 'AAL', ll: [57.09, 9.85] },
  { flt: 'BT131', tel: 'airBaltic one three one', al: 'airbaltic', type: 'BCS3', kind: 'arr', apt: 'CPH', time: 7 + 5 / 60, from: 'RIX', ll: [56.92, 23.97] },
  { flt: 'SK454', tel: 'Scandinavian four five four', al: 'sas', type: 'A20N', kind: 'dep', apt: 'CPH', time: 7 + 0 / 60, to: 'OSL', ll: [60.19, 11.10] },
  { flt: 'D83220', tel: 'Rednose three two two zero', al: 'norwegian', type: 'B38M', kind: 'dep', apt: 'CPH', time: 7 + 10 / 60, to: 'OSL', ll: [60.19, 11.10] },
  // on the airway, the other way: Copenhagen to Arlanda at an eastbound (odd) level
  { flt: 'SK400', tel: 'Scandinavian four hundred', al: 'sas', type: 'A20N', kind: 'enroute', apt: 'CPH', time: 6 + 0 / 60, to: 'ARN', fl: 370 },
];
// Pier F stands (west side) used by the departures; ours is the one at v = -565
export const TRAFFIC_STANDS_F = [-510, -620, -675, -730, -785, -840];

// ISA density ratio
const sigmaAt = (h) => Math.pow(Math.max(0.2, 1 - 2.2558e-5 * h), 4.2559);

export class TrafficAircraft {
  constructor(spec, env, r) {
    Object.assign(this, spec);
    this.T = TYPES[spec.type]; this.r = r; this.env = env;
    this.state = 'scheduled'; this.v = 0; this.h = 0; this.vs = 0; this.hdg = 0; this.pitch = 0; this.bank = 0; this.s = 0;
    this.x = null; this.z = null; this.y = 0; this.airborne = false; this.vis = false;
    this.cleared = {}; this.freq = null;
    // how late the flight is today: most within a few minutes, a long tail of later ones
    this.delay = r() < 0.7 ? r.human(90, 1.2) : r.human(600, 0.8);
  }
  get callsign() { return this.tel; }
  pos() { return { x: this.x, z: this.z }; }

  // ---------- motion along the path ----------
  _place() {
    const tp = this.path.sample(this.s, this._tp || (this._tp = {}));
    this.x = tp.x; this.z = tp.z;
    const hd = Math.atan2(tp.dx, -tp.dz);
    this.hdg = this.back ? hd + Math.PI : hd; this.k = tp.k || 0;
    this.y = this.h;
  }
  // speed towards a target with the aircraft's own acceleration limits
  _speedTo(vT, dt, acc = 1.0, dec = 1.6) { const dv = vT - this.v; this.v += clamp(dv, -dec * dt, acc * dt); }
  // distance to the nearest aircraft ahead on the ground (other traffic and us), metres
  _gapAhead(others) {
    let best = 1e9;
    const fx = Math.sin(this.hdg), fz = -Math.cos(this.hdg);
    for (const o of others) {
      if (o === this || o.x == null || o.airborne || !o.onGroundNow) continue;
      const dx = o.x - this.x, dz = o.z - this.z, ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 400 && lat < 25) best = Math.min(best, ahead);
    }
    return best;
  }
  thrustDrag(sig) {
    const T = this.T, V = Math.max(this.v, 1), q = 0.5 * 1.225 * sig * V * V;
    const CL = this.onGroundNow ? 0.35 : clamp(this.T.mass * G / Math.max(q * T.S, 1), 0, 1.4);
    const D = q * T.S * (T.cd0 + (this.flaps || 0) * 0.02 + (this.gearDown ? 0.017 : 0) + T.k * CL * CL);
    return { D, CL };
  }
}

export class Traffic {
  constructor(atc, route, startClock, r, depTime = 6) {
    this.atc = atc; this.r = r; this.route = route; this.startClock = startClock;
    // the timetable is the one around SK1415 at 06:00; later departures meet the same bank of flights
    // at their own hour (the traffic pattern of an Arlanda bank repeats through the day)
    const shift = depTime - 6;
    this.list = SCHEDULE.map((s) => new TrafficAircraft({ ...s, time: s.time + shift }, this, r));
    let standI = 0;
    const dep = atc.depRwy;
    for (const a of this.list) {
      if (a.apt === 'ARN' && a.kind === 'dep') a.standV = TRAFFIC_STANDS_F[standI++ % TRAFFIC_STANDS_F.length];
      this._build(a, dep);
    }
  }
  clock(t) { return this.startClock + t / 3600; }

  // ---------- routes ----------
  _build(a, depRwy) {
    const fa = ARN.frame;
    if (a.apt === 'ARN' && a.kind === 'dep') {
      // push back from a pier F stand onto the taxilane, then the same taxi route and runway as ours
      const hU = Math.atan2(fa.u.x, -fa.u.y), hV = Math.atan2(fa.v.x, -fa.v.y);
      const g = fa.to(L.gateStand.u, a.standV), R = 24;
      a.push = pushbackPath(g.x, g.y, hU, hV, L.gateStand.u - L.pushEndU - R, R);
      a.standPos = { x: g.x, z: g.y, hdg: hU };
      const k = this.route.keys; const pe = a.push[a.push.length - 1];
      const pts = [new (k.pts[0].constructor)(pe.x, pe.z)], rad = [0];
      const runwayEnd = depRwy === '01L' ? 4 : 4;
      for (let i = 1; i <= runwayEnd; i++) { pts.push(k.pts[i].clone()); rad.push(k.rad[i]); }
      // straight ahead to 5 NM, then a turn towards the destination
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const dir = last.clone().sub(prev).normalize();
      const out = last.clone().addScaledVector(dir, 6000); pts.push(out); rad.push(4000);
      const d = project(a.ll[0], a.ll[1]); const toD = new (last.constructor)(d.x - out.x, d.z - out.y).normalize();
      pts.push(out.clone().addScaledVector(toD, 120000)); rad.push(0);
      a.path = new Path(pts, rad);
      const holdPt = depRwy === '01L' ? fa.to(ARN.rwy.len + 45, -88) : fa.to(L.holdU, -88);
      const linePt = depRwy === '01L' ? fa.to(ARN.rwy.len - 30, 0) : fa.to(30, 0);
      a.holdS = a.path.locate(holdPt); a.lineS = a.path.locate(linePt); a.rwy = depRwy; a.rwyInfo = runwayInfo('ESSA', depRwy);
      a.unit = 'Arlanda Ground'; a.elev = 42;
    } else if (a.apt === 'ARN' && a.kind === 'arr') {
      // the parallel runway: 19L or 01R, joining a 15 km final from the direction of the origin
      const id = depRwy === '19R' ? '19L' : '01R', R = runwayInfo('ESSA', id), f = R.frame;
      const o = project(a.ll[0], a.ll[1]);
      const fin = f.to(-16000, 0), thr = f.to(0, 0);
      const toO = new (fin.constructor)(o.x - fin.x, o.z - fin.y).normalize();
      const entry = fin.clone().addScaledVector(toO, 60000);
      const side = id === '19L' ? 1 : -1;
      a.path = new Path([entry, fin, f.to(-6000, 0), thr, f.to(1500, 0), f.to(1500 + 300, side * 200), f.to(1300, side * 700)], [0, 5000, 0, 0, 40, 60, 0]);
      a.thrS = a.path.locate(thr); a.exitS = a.path.locate(f.to(1500, 0)); a.rwy = id; a.rwyInfo = R; a.unit = 'Stockholm Control'; a.elev = 42;
    } else if (a.apt === 'CPH' && a.kind === 'arr') {
      const id = this.atc.arrRwy, R = runwayInfo('EKCH', id), f = R.frame;
      const o = project(a.ll[0], a.ll[1]);
      const fin = f.to(-20000, 0), thr = f.to(0, 0);
      const toO = new (fin.constructor)(o.x - fin.x, o.z - fin.y).normalize();
      const entry = fin.clone().addScaledVector(toO, 60000);
      a.path = new Path([entry, fin, f.to(-6000, 0), thr, f.to(1700, 0), f.to(1700 + 300 / Math.tan(33 * DEG), 300), f.to(1500, 700)], [0, 6000, 0, 0, 50, 60, 0]);
      a.thrS = a.path.locate(thr); a.exitS = a.path.locate(f.to(1700, 0)); a.rwy = id; a.rwyInfo = R; a.unit = 'Copenhagen Approach'; a.elev = 5;
    } else if (a.apt === 'CPH' && a.kind === 'dep') {
      // from pier C across to the 22R (or 04R) holding point
      const id = this.atc.arrRwy === '22L' ? '22R' : '04R', R = runwayInfo('EKCH', id), f = R.frame, fc = CPH.frame;
      const p0 = fc.to(760, C.terminalV - 200), p1 = fc.to(760, 700);
      const hold = f.to(-60, 0).clone(); const hp = f.to(-60, id === '22R' ? -120 : 120);
      const line = f.to(40, 0), end = f.to(R.len + 200, 0), out = f.to(R.len + 6000, 0);
      const d = project(a.ll[0], a.ll[1]); const toD = new (out.constructor)(d.x - out.x, d.z - out.y).normalize();
      a.path = new Path([p0, p1, hp, hold, line, end, out, out.clone().addScaledVector(toD, 120000)], [0, 40, 40, 30, 0, 0, 4000, 0]);
      a.holdS = a.path.locate(hp); a.lineS = a.path.locate(line); a.rwy = id; a.rwyInfo = R; a.unit = 'Kastrup Apron'; a.elev = 5;
      a.standPos = null;
    } else if (a.kind === 'enroute') {
      // our airway the other way round, from the Kastrup departure to the Arlanda arrival
      const V = this.route.keys.pts[0].constructor, fc = CPH.frame, fa = ARN.frame;
      const pts = [fc.to(-3000, 0), fc.to(-12000, 0)], rad = [0, 5000];
      for (const [lat, lon, r] of ROUTE_AIR.slice().reverse()) { const p = project(lat, lon); pts.push(new V(p.x, p.z)); rad.push(r); }
      pts.push(fa.to(-20000, 0)); rad.push(0);
      a.path = new Path(pts, rad); a.unit = 'Sweden Control'; a.elev = 5;
    }
  }

  // ---------- per step ----------
  update(dt, fm, t) {
    const now = this.clock(t);
    const others = [...this.list, this.ownship(fm)];
    for (const a of this.list) {
      a.onGroundNow = a.x != null && !a.airborne;
      this._step(a, dt, now, fm, others);
    }
  }
  ownship(fm) {
    const o = this._own || (this._own = { own: true });
    o.x = fm.pos.x; o.z = fm.pos.z; o.y = fm.h; o.airborne = !fm.onGround; o.onGroundNow = fm.onGround; o.s = fm.s; o.v = fm.gs;
    return o;
  }

  _step(a, dt, now, fm, others) {
    const atc = this.atc, T = a.T;
    switch (a.state) {
      case 'scheduled': {
        if (a.kind === 'dep') {
          if (a.apt === 'ARN') { a.x = a.standPos.x; a.z = a.standPos.z; a.hdg = a.standPos.hdg; a.h = 0; a.y = 0; a.vis = true; }
          // ready for pushback when boarding is done: scheduled off-block time plus today's delay
          if (now * 3600 >= a.time * 3600 - 240 + a.delay) { a.state = 'ready-push'; atc.trafficCall(a, 'startup'); }
        } else if (a.kind === 'arr') {
          // in the air already: where along its arrival it is now follows from its expected landing time
          const tLand = a.time * 3600 - 300 + a.delay; // on-block minus ~5 min taxi-in
          const tGo = tLand - now * 3600;
          const toThr = a.thrS;
          const dist = tGo * 105; // average ground speed on the arrival, m/s
          if (dist < toThr && dist > -60) {
            a.s = Math.max(0, toThr - dist); a.state = 'arrival'; a.airborne = true;
            const d = toThr - a.s; a.h = Math.min(3048 + Math.max(0, d - 70000) * 0.06, Math.max(0, d * Math.tan(3 * DEG))); a.v = d > 30000 ? 128 : d > 12000 ? 95 : T.vapp * KT;
            a.flaps = d < 15000 ? 1 : 0; a.gearDown = d < 11000;
            atc.trafficCall(a, 'checkin');
          }
        } else if (a.kind === 'enroute') {
          const tDep = a.time * 3600 + a.delay + 600; // airborne about ten minutes after off-block
          if (now * 3600 >= tDep) { a.state = 'cruise-climb'; a.airborne = true; a.s = 0; a.h = 1500; a.v = 140; atc.trafficCall(a, 'checkin'); }
        }
        break;
      }
      case 'ready-push': case 'wait-taxi': break; // waiting for Ground
      case 'pushback': {
        a.pushS = (a.pushS || 0) + 1.2 * dt;
        const P = a.push; let s = a.pushS, i = 1;
        for (; i < P.length; i++) { const L2 = Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); if (s <= L2) break; s -= L2; }
        if (i >= P.length) { a.state = 'starting'; a.startT = a.r.human(100, 0.3); a.v = 0; const e = P[P.length - 1]; a.x = e.x; a.z = e.z; break; }
        const A = P[i - 1], B = P[i], L2 = Math.hypot(B.x - A.x, B.z - A.z), u = s / Math.max(L2, 1e-6);
        a.x = A.x + (B.x - A.x) * u; a.z = A.z + (B.z - A.z) * u; a.hdg = Math.atan2(-(B.x - A.x), (B.z - A.z)); a.v = 1.2;
        break;
      }
      case 'starting': a.startT -= dt; if (a.startT <= 0) { a.state = 'wait-taxi'; atc.trafficCall(a, 'taxi'); } break;
      case 'taxi': case 'holding': case 'lineup': {
        // taxi: speed from the curvature ahead, stop behind traffic and at the limit of the clearance
        const kAhead = a.path.maxCurvatureAhead ? a.path.maxCurvatureAhead(a.s, 60) : 0;
        let vT = Math.min(9, kAhead > 0 ? Math.sqrt(0.9 / kAhead) : 9);
        const limit = a.state === 'lineup' ? a.lineS : a.cleared.lineup ? a.lineS : a.holdS;
        const toLimit = limit - a.s; vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * 0.6 * (toLimit - 2))));
        const gap = this._gapAhead(a, others); if (gap < 400) vT = Math.min(vT, Math.max(0, (gap - 55) * 0.25));
        a._speedTo(vT, dt, 0.6, 1.2);
        a.s += a.v * dt; a._place();
        if (a.state === 'taxi' && a.s >= a.holdS - 3 && a.v < 0.3) { a.state = 'holding'; atc.trafficCall(a, 'ready'); }
        if (a.state === 'lineup' && a.s >= a.lineS - 2 && a.v < 0.3 && a.cleared.takeoff) { a.state = 'takeoff'; a.rollT = 0; }
        break;
      }
      case 'takeoff': {
        // take-off run: thrust minus drag and rolling friction; rotation at VR
        const sig = sigmaAt(a.elev), { D } = a.thrustDrag(sig);
        const acc = (T.T0 * 0.9 * (1 - 0.25 * a.v / 340) - D - 0.02 * T.mass * G) / T.mass;
        a.v += acc * dt; a.s += a.v * dt; a.flaps = 1;
        if (a.v > T.vr * KT) { a.pitch = Math.min(a.pitch + 3 * DEG * dt, 15 * DEG); }
        if (a.v > (T.vr + 8) * KT) { a.airborne = true; a.state = 'climb'; a.climbT = 0; atc.trafficCall(a, 'airborne'); }
        a._place();
        break;
      }
      case 'climb': case 'cruise-climb': {
        // climb gradient from excess thrust; accelerate to 250 kt, then 290 kt above FL100
        const sig = sigmaAt(a.h), vIas = a.v * Math.sqrt(sig);
        const vTgt = (a.h < 3048 ? (a.h < 300 ? T.vr + 20 : 250) : 290) * KT;
        const { D } = a.thrustDrag(sig);
        const Tc = T.T0 * 0.78 * Math.pow(sig, 0.75);
        const excess = (Tc - D) / (T.mass * G);
        const accShare = vIas < vTgt - 3 ? 0.5 : 0;
        a.v += (excess * G * accShare) * dt;
        const gam = Math.max(0, excess * (1 - accShare));
        const hTop = (a.kind === 'enroute' ? a.fl : 340) * 100 * FT;
        a.vs = a.h < hTop ? a.v * gam : 0; a.h = Math.min(hTop, a.h + a.vs * dt);
        if (a.h > 900) a.flaps = 0;
        a.pitch = Math.max(2 * DEG, gam + 3 * DEG);
        a.s += a.v * Math.cos(gam) * dt; a._place();
        a.bank = clamp(Math.atan(a.v * a.v * (a.k || 0) / G), -25 * DEG, 25 * DEG);
        if (a.kind === 'enroute' && a.h >= hTop - 1) a.state = 'cruise';
        if (a.s >= a.path.length - 1) { a.state = 'gone'; a.vis = false; a.x = null; }
        break;
      }
      case 'cruise': {
        a.v = 0.78 * 295; a.vs = 0; a.pitch = 2 * DEG; a.s += a.v * dt; a._place();
        if (a.s >= a.path.length * 0.85) { a.state = 'gone'; a.x = null; }
        break;
      }
      case 'arrival': case 'final': {
        const d = a.thrS - a.s;
        // speed schedule, slowed by Approach to keep the spacing
        let vIas = d > 40000 ? 250 : d > 15000 ? lerp(180, 250, (d - 15000) / 25000) : d > 8000 ? lerp(T.vapp + 5, 180, (d - 8000) / 7000) : T.vapp;
        if (a.spdLimit) vIas = Math.min(vIas, a.spdLimit);
        const sig = sigmaAt(a.h), vT = vIas * KT / Math.sqrt(sig);
        a._speedTo(vT, dt, 0.5, 0.7);
        a.flaps = d < 15000 ? (d < 8000 ? 3 : 1) : 0; a.gearDown = d < 11000;
        // on the 3° path, never above it
        const hT = Math.min(a.h, d * Math.tan(3 * DEG) + 15);
        const vsT = clamp((hT - a.h) * 0.15 - a.v * Math.tan(3 * DEG) * (d < 30000 ? 1 : 0.6), -12, 2);
        a.vs += clamp(vsT - a.vs, -1.5 * dt, 1.5 * dt); a.h = Math.max(0, a.h + a.vs * dt);
        a.pitch = d < 8000 ? 3 * DEG : 1 * DEG; a.s += a.v * dt; a._place();
        a.bank = clamp(Math.atan(a.v * a.v * (a.k || 0) / G), -25 * DEG, 25 * DEG);
        if (a.state === 'arrival' && d < 22000) { a.state = 'final'; atc.trafficCall(a, 'tower'); }
        // not cleared to land by half a mile: go around
        if (d < 900 && !a.cleared.landing && !a.ga) { a.ga = true; atc.trafficCall(a, 'going-around'); a.state = 'go-around'; a.gaT = 0; }
        if (a.h < 12 && d < 400) { a.state = 'flare'; }
        break;
      }
      case 'flare': {
        a.vs += (-0.7 - a.vs) * Math.min(1, dt * 1.5); a.h = Math.max(0, a.h + a.vs * dt); a.pitch = 4 * DEG; a._speedTo(T.vapp * KT - 4, dt, 0.5, 0.8);
        a.s += a.v * dt; a._place();
        if (a.h <= 0.05) { a.h = 0; a.vs = 0; a.airborne = false; a.state = 'rollout'; a.tdT = 0; }
        break;
      }
      case 'rollout': {
        a.pitch = Math.max(0, a.pitch - 2 * DEG * dt);
        const toExit = a.exitS - a.s; const vT = Math.max(12, Math.sqrt(Math.max(0, 12 * 12 + 2 * 1.8 * Math.max(0, toExit))));
        a._speedTo(Math.min(vT, a.v), dt, 0, 2.2);
        a.s += a.v * dt; a._place();
        if (a.s > a.exitS + 20) { a.state = 'vacating'; }
        break;
      }
      case 'vacating': {
        a._speedTo(8, dt, 0.5, 1.5); a.s += a.v * dt; a._place();
        if (a.s > a.exitS + 200 && !a.vacated) { a.vacated = true; atc.trafficCall(a, 'vacated'); }
        if (a.s >= a.path.length - 1) { a.state = 'parked'; a.vis = false; a.x = null; }
        break;
      }
      case 'go-around': {
        a.gaT += dt; const sig = sigmaAt(a.h); const { D } = a.thrustDrag(sig);
        a.v = Math.max(a.v, T.vapp * KT); a.vs = clamp((T.T0 * 0.9 * sig - D) / (T.mass * G) * a.v, 0, 12); a.h += a.vs * dt; a.pitch = 12 * DEG; a.gearDown = false;
        a.s += a.v * dt; a._place();
        // vectored round for another approach: back out to 25 km at 3,000 ft
        if (a.h > 900 || a.gaT > 60) { a.s = Math.max(0, a.thrS - 25000); a.h = 914; a.vs = 0; a.state = 'arrival'; a.ga = false; a.cleared.landing = false; a.v = 95; }
        break;
      }
      default: break;
    }
    // visible to the renderer where the camera could see it
    a.vis = a.x != null && (a.state !== 'gone' && a.state !== 'parked');
  }

  _gapAhead(a, others) {
    let best = 1e9;
    const fx = Math.sin(a.hdg), fz = -Math.cos(a.hdg);
    for (const o of others) {
      if (o === a || o.x == null || !o.onGroundNow) continue;
      if (o.state === 'scheduled' || o.state === 'ready-push' || o.state === 'parked') continue; // at their stands
      const dx = o.x - a.x, dz = o.z - a.z, ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 400 && lat < 30) best = Math.min(best, ahead);
    }
    return best;
  }

  // Aircraft on a runway (lined up, rolling, landing roll, or on short final inside 2 NM)
  runwayOccupants(apt, rwy) {
    const out = [];
    for (const a of this.list) {
      if (a.apt !== apt || a.rwy !== rwy && !(a.rwyInfo && a.rwyInfo.id === rwy)) continue;
      if (['lineup', 'takeoff', 'flare', 'rollout'].includes(a.state)) out.push(a);
      else if (a.state === 'climb' && a.h < 150) out.push(a);
      else if (a.state === 'vacating' && a.s < a.exitS + 150) out.push(a);
    }
    return out;
  }
}
