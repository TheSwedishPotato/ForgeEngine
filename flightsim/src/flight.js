// Route geometry, plus a fast kinematic reference model of the same flight. The aircraft
// itself is flown by the rigid-body physics in physics.js; this reference only gives the
// director a quick time-to-go table for the ETA.
import * as THREE from 'three';
import { DEG, KT, FT, G, clamp, lerp, damp, smoothstep, isa, vnoise1, project } from './core.js';
import { ARN, CPH, ARN_LAYOUT, CPH_LAYOUT, ROUTE_AIR, RUNWAYS, runwayGeom, RunwayFrame } from './places.js';

// ---------------- Path with filleted corners ----------------
export class Path {
  constructor(points, radii) {
    this.segs = [];
    const n = points.length;
    const pts = points.map((p) => p.clone());
    let cur = pts[0].clone();
    let s = 0;
    for (let i = 1; i < n; i++) {
      const B = pts[i];
      if (i < n - 1 && radii[i] > 0) {
        const A = cur, C = pts[i + 1];
        const d1 = B.clone().sub(A).normalize(), d2 = C.clone().sub(B).normalize();
        const cross = d1.x * d2.y - d1.y * d2.x, dot = clamp(d1.dot(d2), -1, 1);
        const theta = Math.acos(dot);
        if (theta < 1e-4) { this._line(cur, B, s); s += cur.distanceTo(B); cur = B.clone(); continue; }
        let R = radii[i];
        let t = R * Math.tan(theta / 2);
        const maxT = Math.min(A.distanceTo(B), B.distanceTo(C) * 0.5) * 0.98;
        if (t > maxT) { t = maxT; R = t / Math.tan(theta / 2); }
        const T1 = B.clone().addScaledVector(d1, -t), T2 = B.clone().addScaledVector(d2, t);
        this._line(cur, T1, s); s += cur.distanceTo(T1);
        const sign = cross > 0 ? 1 : -1; // +1: clockwise in x/z (right turn)
        const nrm = new THREE.Vector2(-d1.y, d1.x).multiplyScalar(sign); // towards centre
        const centre = T1.clone().addScaledVector(nrm, R);
        const a0 = Math.atan2(T1.y - centre.y, T1.x - centre.x);
        const len = R * theta;
        this.segs.push({ type: 'arc', s0: s, len, centre, R, a0, sign, theta });
        s += len; cur = T2;
      } else {
        this._line(cur, B, s); s += cur.distanceTo(B); cur = B.clone();
      }
    }
    this.length = s;
  }
  _line(A, B, s0) {
    const len = A.distanceTo(B);
    if (len < 1e-6) return;
    this.segs.push({ type: 'line', s0, len, A: A.clone(), d: B.clone().sub(A).normalize() });
  }
  _seg(s) {
    let lo = 0, hi = this.segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.segs[m].s0 <= s) lo = m; else hi = m - 1; }
    return this.segs[lo];
  }
  sample(s, out = {}) {
    s = clamp(s, 0, this.length);
    const g = this._seg(s);
    const ds = clamp(s - g.s0, 0, g.len);
    if (g.type === 'line') {
      out.x = g.A.x + g.d.x * ds; out.z = g.A.y + g.d.y * ds;
      out.dx = g.d.x; out.dz = g.d.y; out.k = 0;
    } else {
      const a = g.a0 + g.sign * ds / g.R;
      out.x = g.centre.x + Math.cos(a) * g.R; out.z = g.centre.y + Math.sin(a) * g.R;
      out.dx = -Math.sin(a) * g.sign; out.dz = Math.cos(a) * g.sign; out.k = g.sign / g.R;
    }
    out.heading = Math.atan2(out.dx, -out.dz); // radians clockwise from north
    return out;
  }
  // arc-length of the closest point to p (coarse + refine), searching from s0 on
  locate(p, s0 = 0) {
    let best = s0, bd = Infinity; const tmp = {};
    const step = Math.max(5, this.length / 20000);
    for (let s = s0; s <= this.length; s += step) {
      this.sample(s, tmp); const d = (tmp.x - p.x) ** 2 + (tmp.z - p.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    for (let h = step; h > 0.05; h *= 0.5) {
      for (const c of [best - h, best + h]) {
        this.sample(c, tmp); const d = (tmp.x - p.x) ** 2 + (tmp.z - p.y) ** 2;
        if (d < bd) { bd = d; best = clamp(c, 0, this.length); }
      }
    }
    return best;
  }
  maxCurvatureAhead(s, dist) {
    let k = 0; const t = {};
    for (let d = 0; d <= dist; d += Math.max(2, dist / 12)) { this.sample(s + d, t); k = Math.max(k, Math.abs(t.k)); }
    return k;
  }
}

// ---------------- Routes ----------------
// A runway as the pilots and the ILS see it: threshold, landing/take-off direction, length.
export function runwayInfo(icao, id) {
  const list = icao === 'ESSA' ? RUNWAYS.ESSA : RUNWAYS.EKCH;
  for (const r of list) {
    const g = runwayGeom(r);
    const k = r.ids.indexOf(id); if (k < 0) continue;
    // ids[0] is the 'a' end; that runway's threshold is 'a' and it points to 'b'
    const thr = k === 0 ? g.a : g.b, end = k === 0 ? g.b : g.a;
    const dir = end.clone().sub(thr).normalize();
    const frame = new RunwayFrame(thr, dir);
    return { icao, id, thr, end, dir, len: g.len, width: g.width, hdg: frame.heading, frame, elev: icao === 'ESSA' ? 42 : 5, gs: 3.0 * DEG, tdz: 300 };
  }
  return null;
}

// The complete ground and air route for a departure runway at Arlanda and an arrival runway at
// Kastrup: taxi-out from pier F, the runway, a departure that joins the airway, the airway over
// Sweden, the arrival and final approach, the landing roll, the exit and taxi-in to pier B.
export function buildRoute(dep = '19R', arr = '22L') {
  const fa = ARN.frame, fc = CPH.frame, L = ARN_LAYOUT, C = CPH_LAYOUT;
  const pts = [], rad = [];
  const add = (p, r = 0) => { pts.push(p); rad.push(r); };
  // ---- Arlanda: taxi from the stand at pier F to the runway, then the departure ----
  add(fa.to(1580, L.startStandV));
  add(fa.to(1580, L.taxiwayZ), 45);
  let holdPt, lineupPt, rwyEnd;
  if (dep === '01L') {
    const Lr = ARN.rwy.len;
    add(fa.to(Lr + 45, L.taxiwayZ), 45);
    add(fa.to(Lr + 45, 0), 38);
    add(fa.to(-6500, 0), 3200);                  // runway heading north
    add(fa.to(-9000, 7000), 3500);               // left turn to the west
    holdPt = fa.to(Lr + 45, -88); lineupPt = fa.to(Lr - 30, 0); rwyEnd = fa.to(0, 0);
    for (const [lat, lon, r] of ROUTE_AIR.slice(1)) { const p = project(lat, lon); add(new THREE.Vector2(p.x, p.z), r); }
  } else {
    add(fa.to(L.holdU, L.taxiwayZ), 45);
    add(fa.to(L.holdU, 0), 38);
    add(fa.to(9300, 0));
    holdPt = fa.to(L.holdU, -88); lineupPt = fa.to(30, 0); rwyEnd = fa.to(3300, 0);
    for (const [lat, lon, r] of ROUTE_AIR.slice(1)) { const p = project(lat, lon); add(new THREE.Vector2(p.x, p.z), r); }
  }
  // ---- Kastrup: arrival, final, landing roll, exit and taxi to pier B ----
  let thrPt, exitPt;
  const a = runwayInfo('EKCH', arr) || runwayInfo('EKCH', '22L'), f4 = a.frame;
  if (arr === '04L') {
    // downwind to the south-east of the airport over the Øresund, base, a 12 NM final from the south-west
    add(f4.to(9000, 8500), 6000);
    add(f4.to(-22500, 8500), 3200);
    add(f4.to(-22500, 0), 3200);
    add(f4.to(1800, 0), 220);                    // landing roll, then a rapid exit to the right
    add(f4.to(1800 + 295 / Math.tan(33 * DEG), 295), 50);
    add(fc.to(330, C.parallelV), 45);
    thrPt = f4.to(0, 0); exitPt = f4.to(1800, 0);
  } else {
    add(fc.to(-26000, 0), 6000);
    add(fc.to(1700, 0), 220);
    add(fc.to(1700 + 300 / Math.tan(33 * DEG), C.parallelV), 50);
    add(fc.to(330, C.parallelV), 45);
    thrPt = fc.to(0, 0); exitPt = fc.to(1700, 0);
  }
  add(fc.to(330, C.standV), 32);
  add(fc.to(C.standU, C.standV));
  const path = new Path(pts, rad);
  const m = {
    hold: path.locate(holdPt),
    lineup: path.locate(lineupPt),
    arnRwyEnd: path.locate(rwyEnd),
    thr: path.locate(thrPt),
    exit: path.locate(exitPt),
    stand: path.length,
  };
  m.crossing = m.exit;
  m.touchdown = m.thr + 300;
  const d = runwayInfo('ESSA', dep) || runwayInfo('ESSA', '19R');
  return { path, m, dep: d, arr: a, depRwy: d.id, arrRwy: a.id, airport: null, keys: { pts, rad, thrIdx: keyIdx(pts, exitPt, 0), exitPt } };
}

// index of the key point just before `p` (the landing roll starts there) minus `back`
function keyIdx(pts, p, back = 0) { let best = 0, bd = Infinity; pts.forEach((q, i) => { const d = q.distanceTo(p); if (d < bd) { bd = d; best = i; } }); return Math.max(0, best - back); }

// Air return to Arlanda after a problem on departure: a teardrop or a circuit onto the runway into
// the wind (01L landing north or 19R landing south), vacate onto the parallel taxiway, stand at pier F.
// p: the aircraft's main-gear point {x, z}; dir: track {x, z}.
export function buildReturnRoute(p, dir, rwy = '01L') {
  const fa = ARN.frame, L = ARN.rwy.len;
  const cur = new THREE.Vector2(p.x, p.z);
  const rel = cur.clone().sub(fa.o);
  const uCur = rel.dot(fa.u), vCur = rel.dot(fa.v);
  const pts = [], rad = [];
  const add = (q, r = 0) => { pts.push(q); rad.push(r); };
  add(cur);
  add(cur.clone().add(new THREE.Vector2(dir.x, dir.z).normalize().multiplyScalar(2500)), 0);
  let thr, exit;
  if (rwy === '19R') {
    // final from the north, landing south on 19R
    add(fa.to(Math.max(uCur, 4000) + 6000, 7500), 3200);
    add(fa.to(-20000, 7500), 3200);
    add(fa.to(-20000, 0), 3000);
    add(fa.to(60, 0));
    add(fa.to(1850, 0), 60);
    add(fa.to(2040, ARN_LAYOUT.taxiwayZ), 45);
    add(fa.to(1580, ARN_LAYOUT.taxiwayZ), 40);
    add(fa.to(1580, -480));
    thr = fa.to(0, 0); exit = fa.to(1850, 0);
  } else {
    const base = Math.max(uCur + 14000, L + 30000); // time for the checklists on the way out
    add(fa.to(base, vCur), 3200);
    add(fa.to(base, 7500), 3200);
    add(fa.to(L + 20000, 7500), 3200);
    add(fa.to(L + 20000, 0), 3000);
    add(fa.to(L - 60, 0));          // runway 01L threshold (south end), landing northbound
    add(fa.to(1250, 0), 60);        // end of the landing roll
    add(fa.to(1080, -190), 45);     // exit onto the parallel taxiway, then back south along it
    add(fa.to(1580, -190), 40);
    add(fa.to(1580, -480));         // stand by pier F
    thr = fa.to(L, 0); exit = fa.to(1250, 0);
  }
  const path = new Path(pts, rad);
  const m = { hold: 0, lineup: 0, arnRwyEnd: 0 };
  m.thr = path.locate(thr); m.touchdown = m.thr + 300;
  m.exit = path.locate(exit); m.crossing = m.exit; m.stand = path.length;
  return { path, m, airport: 'ARN', arr: runwayInfo('ESSA', rwy), arrRwy: rwy, dep: runwayInfo('ESSA', rwy === '01L' ? '19R' : '01L'), depRwy: rwy === '01L' ? '19R' : '01L', keys: { pts, rad, thrIdx: keyIdx(pts, exit, 0), exitPt: exit } };
}

// A320neo configuration table: slat/flap degrees, CL0 increment, max speed (kt)
export const CONFIGS = [
  { name: '0', slat: 0, flap: 0, cl0: 0.22 },
  { name: '1', slat: 18, flap: 0, cl0: 0.55 },
  { name: '1+F', slat: 18, flap: 10, cl0: 0.72 },
  { name: '2', slat: 22, flap: 15, cl0: 0.9 },
  { name: '3', slat: 22, flap: 20, cl0: 1.05 },
  { name: 'FULL', slat: 27, flap: 35, cl0: 1.22 },
];

const CRUISE_ALT = 36000 * FT;
const MASS = 64500; // kg, typical short sector take-off mass
const WING_AREA = 122.6;

function iasToTas(ias, h) { return ias / Math.sqrt(isa(h).sigma); }

export class ReferenceFlight {
  constructor(route, opts = {}) {
    this.path = route.path; this.m = route.m;
    this.turbulence = opts.turbulence ?? 0.3;
    this.windKt = opts.windKt ?? 10;
    this.cloudBase = opts.cloudBase ?? 1e9; this.cloudTop = opts.cloudTop ?? -1;
    this.t = 0;
    this.s = 0; this.v = 0; this.h = 0; this.vs = 0;
    this.pitch = -0.4 * DEG; this.bank = 0; this.heading = 0;
    this.ias = 0; this.tas = 0; this.mach = 0;
    this.onGround = true;
    this.phase = 'parked'; // parked, taxi-out, hold, lineup, takeoff, climb, cruise, descent, approach, flare, rollout, taxi-in, arrived
    this.n1 = [0.21, 0.21]; this.n1Cmd = [0.21, 0.21]; this.engineRunning = [true, true];
    this.cfg = 0; this.cfgTarget = 0; this.slat = 0; this.flap = 0; // degrees (animated)
    this.gear = 1; this.gearCmd = 1; this.spoiler = 0; this.spoilerCmd = 0; this.reverse = 0; this.reverseCmd = 0;
    this.brakeDecel = 0;
    this.clearTaxi = false; this.clearLineup = false; this.clearTakeoff = false;
    this.holdTimer = 0;
    this.rotating = false; this.liftoffT = -1; this.touchdownT = -1; this.noseDown = true;
    this.events = []; // queued string events for the director
    this._flags = {};
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.accel = new THREE.Vector3(); // body-frame specific force delta for camera cues
    this.bump = 0; this.shake = 0; this.rollRumble = 0; this.thump = 0;
    this.distToGo = 0;
    this._prevV = 0; this._prevVs = 0; this._tmp = {};
    this.flareStarted = false;
    this.agl = 0;
    this.update(0);
  }

  emit(e) { this.events.push(e); }
  once(name, cond) { if (cond && !this._flags[name]) { this._flags[name] = true; this.emit(name); return true; } return false; }

  setConfig(i) { this.cfgTarget = i; }
  shutdown() { this._flags.shutdown = true; }

  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.1));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h);
  }

  _speedLimitTaxi() {
    const k = this.path.maxCurvatureAhead(this.s, 70);
    const vTurn = k > 0 ? Math.sqrt(0.9 / k) : 99;
    return Math.min(8.8, Math.max(3.2, vTurn));
  }

  _stopAt(sStop, vMax, decel = 0.6) {
    const d = Math.max(0, sStop - this.s);
    return Math.min(vMax, Math.sqrt(2 * decel * d));
  }

  _step(dt) {
    if (dt <= 0) { this._pose(0); return; }
    this.t += dt;
    const m = this.m, path = this.path;
    const prevV = this.v;
    let targetV = this.v, accel = 1.0, decel = 1.0;
    const d2td = m.touchdown - this.s;
    this.distToGo = m.stand - this.s;

    switch (this.phase) {
      case 'parked':
        targetV = 0; this.n1Cmd = [0.205, 0.205];
        if (this.clearTaxi) { this.phase = 'taxi-out'; this.emit('taxi-start'); }
        break;
      case 'taxi-out': {
        targetV = Math.min(this._speedLimitTaxi(), this._stopAt(m.hold, 9, 0.55));
        accel = 0.45; decel = 0.8;
        const breakaway = this.v < 1.5 && targetV > 2;
        this.n1Cmd = breakaway ? [0.31, 0.31] : [0.215, 0.215];
        if (this.s > m.hold - 0.8 && this.v < 0.3) { this.phase = 'hold'; this.v = 0; this.emit('holding-point'); }
        break;
      }
      case 'hold':
        targetV = 0; this.n1Cmd = [0.205, 0.205];
        if (this.clearLineup) { this.phase = 'lineup'; this.emit('lineup-start'); }
        break;
      case 'lineup':
        targetV = Math.min(this._speedLimitTaxi() * 0.85, this._stopAt(m.lineup, 7, 0.5));
        accel = 0.4; decel = 0.7;
        this.n1Cmd = this.v < 1 && targetV > 1.5 ? [0.3, 0.3] : [0.215, 0.215];
        if (this.s > m.lineup - 0.5 && this.v < 0.2) {
          this.v = 0;
          if (this.clearTakeoff) { this.phase = 'takeoff'; this.emit('takeoff-roll'); this.holdTimer = 0; }
        }
        break;
      case 'takeoff': {
        this.holdTimer += dt;
        // brakes released, thrust to 50% then FLEX
        this.n1Cmd = this.holdTimer < 4 ? [0.5, 0.5] : [0.855, 0.855];
        const thrust = (this.n1[0] + this.n1[1]) * 0.5;
        const a = Math.max(0, (thrust - 0.3) * 3.4 - this.v * 0.0065 * (this.v / 40));
        this.v += a * dt; targetV = this.v; accel = 99;
        this.ias = this.v / KT;
        if (this.ias > 80) this.once('80kt', true);
        if (this.ias >= 144 && !this.rotating) { this.rotating = true; this.emit('rotate'); }
        if (this.rotating) {
          this.pitchCmd = Math.min(15 * DEG, (this.pitchCmd ?? 0) + 2.9 * DEG * dt);
          if (this.pitchCmd > 7.2 * DEG && this.ias > 148) {
            this.phase = 'climb'; this.onGround = false; this.liftoffT = this.t; this.emit('liftoff'); this.vs = 0.5;
          }
        }
        break;
      }
      default: break;
    }

    // ---------------- airborne vertical profile & speeds ----------------
    if (!this.onGround) {
      const agl = this.h;
      let vsCmd = 0, iasCmd = 250;
      if (this.phase === 'climb' || this.phase === 'cruise') {
        const tAir = this.t - this.liftoffT;
        if (agl < 460) { vsCmd = lerp(3, 11.5, smoothstep(0, 3, tAir)); iasCmd = 158; }
        else if (agl < 950) { vsCmd = 8.5; iasCmd = 215; }
        else if (agl < 3048) { vsCmd = 10.5; iasCmd = 250; }
        else if (agl < 3400) { vsCmd = 5; iasCmd = 290; }
        else if (agl < 8200) { vsCmd = lerp(11.5, 9, (agl - 3400) / 4800); iasCmd = 290; }
        else { vsCmd = lerp(8.5, 4.5, clamp((agl - 8200) / 2700, 0, 1)); iasCmd = 280; }
        // capture cruise altitude
        const toCruise = CRUISE_ALT - agl;
        vsCmd = Math.min(vsCmd, Math.max(0, toCruise * 0.02));
        if (toCruise < 15 && this.phase === 'climb') { this.phase = 'cruise'; this.emit('top-of-climb'); }
        // descent profile check
        const hDesc = this.descentProfile(d2td);
        if (hDesc < agl - 20 && this.t - this.liftoffT > 120) { this.phase = 'descent'; this.emit('top-of-descent'); }
      }
      if (this.phase === 'descent' || this.phase === 'approach') {
        const hDesc = this.descentProfile(d2td);
        const err = hDesc - agl;
        const vsIdeal = -(this.tas * this.descentSlope(d2td));
        vsCmd = clamp(vsIdeal + err * 0.03, -25, 2);
        if (agl > 3100) iasCmd = 290; else iasCmd = 250;
        if (d2td < 42000) iasCmd = 220;
        if (d2td < 30000) iasCmd = 200;
        if (d2td < 22000) iasCmd = 180;
        if (d2td < 16500) iasCmd = 160;
        if (d2td < 12000) iasCmd = 145;
        if (d2td < 9000) iasCmd = 137;
        if (d2td < 30000 && this.phase === 'descent') { this.phase = 'approach'; this.emit('approach'); }
        // configuration schedule
        if (d2td < 28000 && this.cfgTarget < 1) { this.setConfig(1); this.emit('flaps'); }
        if (d2td < 19000 && this.cfgTarget < 3) { this.setConfig(3); this.emit('flaps'); }
        if (d2td < 14500) { this.gearCmd = 1; this.once('gear-down', true); }
        if (d2td < 12500 && this.cfgTarget < 4) { this.setConfig(4); this.emit('flaps'); }
        if (d2td < 10000 && this.cfgTarget < 5) { this.setConfig(5); this.emit('flaps'); }
        // speedbrakes when high & fast in descent
        this.spoilerCmd = (this.phase === 'descent' && err < -250 && agl > 3000) ? 0.45 : 0;
        if (agl < 16 && this.phase === 'approach') { this.phase = 'flare'; this.emit('flare'); }
      }
      if (this.phase === 'flare') {
        iasCmd = 132;
        vsCmd = lerp(-1.0, -3.6, clamp(this.h / 16, 0, 1));
        if (this.h <= 0.05) {
          this.h = 0; this.onGround = true; this.touchdownT = this.t; this.phase = 'rollout';
          this.emit('touchdown'); this.thump = Math.min(1, Math.abs(this.vs) / 1.6 + 0.35); this.vs = 0;
          this.noseDown = false;
        }
      }
      // vertical speed dynamics
      this.vs = damp(this.vs, vsCmd, this.phase === 'flare' ? 1.8 : 0.9, dt);
      this.h = Math.max(0, this.h + this.vs * dt);
      // speed dynamics (IAS)
      const accLim = this.phase === 'climb' ? 0.9 : 0.7;
      this.ias += clamp(iasCmd - this.ias, -accLim * dt / KT * 1.4, accLim * dt / KT * 1.9);
      this.tas = iasToTas(this.ias * KT, this.h);
      const a = isa(this.h);
      if (this.h > 7900) this.tas = Math.min(this.tas, 0.78 * a.a);
      this.mach = this.tas / a.a;
      this.v = this.tas;
      // flap retraction on climb
      if (this.phase === 'climb') {
        if (this.t - this.liftoffT > 3.5) { this.gearCmd = 0; this.once('gear-up', true); }
        if (agl > 460) this.once('thrust-reduction', true);
        if (this.ias > 190 && this.cfgTarget > 1) { this.setConfig(1); this.emit('flaps'); }
        if (this.ias > 208 && this.cfgTarget > 0) { this.setConfig(0); this.emit('flaps'); }
      }
      this.once('passing-10000-climb', this.phase === 'climb' && this.h > 3048);
      this.once('passing-10000-descent', (this.phase === 'descent' || this.phase === 'approach') && this.h < 3048);
      // engine thrust command in the air
      let n1 = 0.8;
      if (this.phase === 'climb') n1 = this.h < 460 ? 0.855 : 0.83 + 0.02 * Math.sin(this.t * 0.01);
      else if (this.phase === 'cruise') n1 = 0.815;
      else if (this.phase === 'descent') n1 = 0.255;
      else if (this.phase === 'approach') {
        const drag = this.cfg * 0.035 + this.gear * 0.08;
        n1 = d2td > 22000 ? 0.26 : clamp(0.36 + drag + (this.ias - iasCmd) * -0.012 + 0.02 * Math.sin(this.t * 0.7), 0.26, 0.7);
      } else if (this.phase === 'flare') n1 = this.h < 7 ? 0.22 : 0.42;
      this.n1Cmd = [n1, n1];
    }

    // ---------------- rollout & taxi-in ----------------
    if (this.phase === 'rollout') {
      const tt = this.t - this.touchdownT;
      this.spoilerCmd = 1;
      if (tt > 1.8) this.noseDown = true;
      if (tt > 1.2 && this.v > 36) this.reverseCmd = 1; else if (this.v < 16) this.reverseCmd = 0;
      this.n1Cmd = this.reverseCmd ? (this.v > 40 ? [0.72, 0.72] : [0.3, 0.3]) : [0.21, 0.21];
      const exitV = 12;
      const vStop = this._stopAt(m.exit + 40, 80, 1.9);
      targetV = Math.max(exitV, Math.min(vStop, this.v));
      decel = tt > 2 ? 2.1 : 0.4;
      if (this.v <= exitV + 0.3) { this.spoilerCmd = 0; this.reverseCmd = 0; }
      if (this.s > m.exit - 10) { this.phase = 'taxi-in'; this.emit('vacated'); this.setConfig(0); }
    }
    if (this.phase === 'taxi-in') {
      this.spoilerCmd = 0; this.reverseCmd = 0;
      targetV = Math.min(this._speedLimitTaxi(), this._stopAt(m.stand, 9, 0.45));
      accel = 0.4; decel = 0.8;
      const run1 = this.engineRunning[1];
      const base = run1 ? 0.215 : 0.26;
      this.n1Cmd = [base, run1 ? base : 0];
      if (this.t - this.touchdownT > 150 && this.engineRunning[1]) { this.engineRunning[1] = false; this.emit('engine2-shutdown'); }
      if (this.s >= m.stand - 0.3 && this.v < 0.15) {
        this.v = 0; this.phase = 'arrived'; this.emit('parked');
      }
    }
    if (this.phase === 'arrived') {
      targetV = 0;
      if (this.engineRunning[0] && this._flags.shutdown) this.engineRunning[0] = false;
      this.n1Cmd = [this.engineRunning[0] ? 0.205 : 0, 0];
    }

    // ground longitudinal dynamics
    if (this.onGround && this.phase !== 'takeoff') {
      if (targetV > this.v) this.v = Math.min(targetV, this.v + accel * dt);
      else this.v = Math.max(targetV, this.v - decel * dt);
      this.ias = this.v / KT; this.tas = this.v; this.vs = 0;
    }
    this.brakeDecel = this.onGround ? Math.max(0, (prevV - this.v) / Math.max(dt, 1e-3)) : 0;

    // advance along path
    this.s = Math.min(path.length, this.s + this.v * dt);

    // engines spool
    for (let i = 0; i < 2; i++) {
      const cmd = this.engineRunning[i] ? this.n1Cmd[i] : 0;
      const up = cmd > this.n1[i];
      const rate = up ? (this.n1[i] < 0.5 ? 0.35 : 0.6) : (this.engineRunning[i] ? 0.45 : 0.12);
      this.n1[i] = damp(this.n1[i], cmd, rate * 1.6, dt);
    }
    // configuration & gear animation
    const cfgT = CONFIGS[this.cfgTarget];
    this.slat += clamp(cfgT.slat - this.slat, -1.6 * dt, 1.6 * dt);
    this.flap += clamp(cfgT.flap - this.flap, -1.5 * dt, 1.5 * dt);
    this.flapsMoving = Math.abs(cfgT.flap - this.flap) > 0.05 || Math.abs(cfgT.slat - this.slat) > 0.05;
    if (!this.flapsMoving) this.cfg = this.cfgTarget;
    const gPrev = this.gear;
    this.gear += clamp(this.gearCmd - this.gear, -dt / 9, dt / 9);
    this.gearMoving = Math.abs(this.gear - gPrev) > 1e-6;
    this.spoiler = damp(this.spoiler, this.spoilerCmd, this.spoilerCmd > this.spoiler ? 4 : 1.5, dt);
    this.reverse += clamp(this.reverseCmd - this.reverse, -dt / 2, dt / 1.8);

    this._pose(dt);
    this._prevV = prevV;
  }

  // Altitude (m) of the descent path as a function of distance to touchdown.
  // d is measured to the aiming point, 300 m past the threshold (50 ft over the threshold).
  descentProfile(d) {
    const tan3 = Math.tan(3 * DEG);
    const d10 = 3048 / tan3; // where the 3° path reaches FL100
    if (d < d10) return Math.max(0, d * tan3);
    if (d < d10 + 9000) return 3048;
    return 3048 + (d - d10 - 9000) * Math.tan(3.1 * DEG);
  }
  descentSlope(d) {
    const d10 = 3048 / Math.tan(3 * DEG);
    if (d < d10) return Math.tan(3 * DEG);
    if (d < d10 + 9000) return 0;
    return Math.tan(3.1 * DEG);
  }

  _pose(dt) {
    const tp = this.path.sample(this.s, this._tmp);
    this.heading = tp.heading;
    this.pos.set(tp.x, this.h, tp.z);
    // bank from curvature
    let bankCmd = 0;
    if (!this.onGround) bankCmd = clamp(Math.atan(this.v * this.v * tp.k / G), -27 * DEG, 27 * DEG);
    else bankCmd = clamp(this.v * this.v * tp.k * 0.012, -1.2 * DEG, 1.2 * DEG);
    const maxRate = 4.5 * DEG * dt;
    if (dt > 0) this.bank += clamp(bankCmd - this.bank, -maxRate, maxRate);

    // pitch = flight path angle + angle of attack
    let pitchCmd;
    if (this.onGround) {
      if (this.phase === 'takeoff' && this.rotating) pitchCmd = this.pitchCmd;
      else if (this.phase === 'rollout' && !this.noseDown) pitchCmd = Math.max(0, 5.5 * DEG * (1 - (this.t - this.touchdownT) / 1.8));
      else pitchCmd = -0.25 * DEG + clamp(-this.brakeDecel * 0.35 * DEG, -1.2 * DEG, 0) + (this.phase === 'takeoff' ? 0.2 * DEG : 0);
    } else {
      const gamma = Math.atan2(this.vs, Math.max(this.v, 1));
      const q = 0.5 * 1.225 * (this.ias * KT) ** 2;
      const cl = MASS * G / Math.max(q * WING_AREA, 1) / Math.cos(this.bank);
      const cl0 = lerp(CONFIGS[Math.floor(this._cfgf())].cl0, CONFIGS[Math.min(5, Math.ceil(this._cfgf()))].cl0, this._cfgf() % 1);
      let alpha = clamp((cl - cl0) / 0.105 * DEG, 0.5 * DEG, 12 * DEG);
      pitchCmd = gamma + alpha;
      if (this.phase === 'climb' && this.t - this.liftoffT < 6) pitchCmd = Math.max(pitchCmd, 14 * DEG);
      if (this.phase === 'climb' && this.h < 460) pitchCmd = Math.min(pitchCmd, 16 * DEG);
      if (this.phase === 'flare') pitchCmd = Math.max(pitchCmd, 4.6 * DEG);
    }
    this.pitch = dt > 0 ? damp(this.pitch, pitchCmd, this.onGround ? 3 : 1.2, dt) : pitchCmd;

    // turbulence
    let turb = 0;
    if (!this.onGround) {
      const inCloud = this.h > this.cloudBase && this.h < this.cloudTop;
      turb = this.turbulence * (this.h < 1500 ? 1 : this.h < 5000 ? 0.55 : 0.28) + (inCloud ? 0.45 : 0);
      if (this.phase === 'approach' || this.phase === 'flare') turb += 0.15 * this.turbulence;
      turb *= this.turbBoost || 1;
    }
    this.turbLevel = turb;
    const tt = this.t;
    const tp1 = (vnoise1(tt * 0.9) - 0.5) + 0.5 * (vnoise1(tt * 2.3 + 40) - 0.5);
    const tp2 = (vnoise1(tt * 0.7 + 100) - 0.5) + 0.5 * (vnoise1(tt * 2.1 + 70) - 0.5);
    const tp3 = (vnoise1(tt * 1.3 + 300) - 0.5) + 0.6 * (vnoise1(tt * 4.1 + 20) - 0.5);
    this.turbPitch = tp1 * 0.9 * DEG * turb;
    this.turbBank = tp2 * 1.8 * DEG * turb;
    this.bump = tp3 * turb; // vertical jolt signal, used for cabin shake

    // runway / taxiway rumble
    this.rollRumble = this.onGround ? clamp(this.v / 75, 0, 1) : 0;
    this.thump = Math.max(0, this.thump - dt * 3);

    const e = new THREE.Euler(this.pitch + this.turbPitch, -this.heading, -(this.bank + this.turbBank), 'YXZ');
    this.quat.setFromEuler(e);

    // longitudinal/vertical accelerations (for head motion cues)
    if (dt > 0) {
      const ax = (this.v - (this._lastV ?? this.v)) / dt;
      const az = (this.vs - (this._lastVs ?? this.vs)) / dt;
      this.accel.set(this.v * this.v * (this._tmp.k || 0), az, ax);
      this._lastV = this.v; this._lastVs = this.vs;
    }
    this.agl = this.h;
  }
  _cfgf() {
    // fractional config index from actual flap/slat positions
    const f = this.flap, s = this.slat;
    if (f <= 0) return clamp(s / 18, 0, 1);
    if (f <= 10) return 1 + f / 10;
    if (f <= 15) return 2 + (f - 10) / 5;
    if (f <= 20) return 3 + (f - 15) / 5;
    return 4 + clamp((f - 20) / 15, 0, 1);
  }
}
