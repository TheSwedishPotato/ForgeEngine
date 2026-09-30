// Route geometry: the ground and air track for the runways in use, the return-to-Arlanda pattern
// and runway frames. The aircraft itself is flown along it by the crew through the physics.
import * as THREE from 'three';
import { DEG, clamp, project } from './core.js';
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

// Main-gear track of a pushback: `straight` metres tail-first from the stand, then an arc of radius
// R that ends with the nose pointing along `hdg1` (radians).
export function pushbackPath(x, z, hdg0, hdg1, straight = 15, R = 24) {
  const pts = [{ x, z }];
  const bx = -Math.sin(hdg0), bz = Math.cos(hdg0);           // tail-first direction
  for (let d = 2; d <= straight; d += 2) pts.push({ x: x + bx * d, z: z + bz * d });
  const p0 = pts[pts.length - 1];
  let turn = hdg1 - hdg0; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  // moving backwards, the heading turns by `turn` while the direction of motion turns the same way
  const sgn = Math.sign(turn) || 1, rx = -bz * sgn, rz = bx * sgn;   // unit vector to the centre
  const cx = p0.x + rx * R, cz = p0.z + rz * R, a0 = Math.atan2(p0.x - cx, p0.z - cz);
  const n = Math.max(4, Math.ceil(Math.abs(turn) * R / 2));
  for (let k = 1; k <= n; k++) { const a = a0 - turn * k / n; pts.push({ x: cx + Math.sin(a) * R, z: cz + Math.cos(a) * R }); }
  return pts;
}

// The complete ground and air route for a departure runway at Arlanda and an arrival runway at
// Kastrup: taxi-out from pier F, the runway, a departure that joins the airway, the airway over
// Sweden, the arrival and final approach, the landing roll, the exit and taxi-in to pier B.
export function buildRoute(dep = '19R', arr = '22L') {
  const fa = ARN.frame, fc = CPH.frame, L = ARN_LAYOUT, C = CPH_LAYOUT;
  const pts = [], rad = [];
  const add = (p, r = 0) => { pts.push(p); rad.push(r); };
  // ---- Arlanda: taxi from the stand at pier F to the runway, then the departure ----
  add(fa.to(L.pushEndU, L.startStandV));
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
  // the gate at pier F, nose in, and the pushback that brings the aircraft to the start of the taxi route
  const G = L.gateStand, gp = fa.to(G.u, G.v), hU = Math.atan2(fa.u.x, -fa.u.y), hV = Math.atan2(fa.v.x, -fa.v.y);
  const gate = { x: gp.x, z: gp.y, heading: hU, name: G.name, facing: 'west' };
  const pushR = G.v - L.startStandV, pushPts = pushbackPath(gp.x, gp.y, hU, hV, G.u - L.pushEndU - pushR, pushR);
  return { gate, pushPts, path, m, dep: d, arr: a, depRwy: d.id, arrRwy: a.id, airport: null, keys: { pts, rad, thrIdx: keyIdx(pts, exitPt, 0), exitPt } };
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
  // landing coordinates: a along the landing direction from the threshold, c to the right of it
  const land19 = rwy === '19R';
  const toW = (a, c) => (land19 ? fa.to(a, c) : fa.to(L - a, -c));
  const aC = land19 ? uCur : L - uCur, cC = land19 ? vCur : -vCur;
  const side = cC >= 0 ? 1 : -1;       // the pattern is flown on the side we are already on
  const FIN = 20000;                   // final approach about 11 NM, as ATC vectors a return
  add(cur);
  add(cur.clone().add(new THREE.Vector2(dir.x, dir.z).normalize().multiplyScalar(3000)), 3500);
  if (aC < -FIN - 5000) {
    // already out on the approach side: across to a base leg, then the final
    add(toW(Math.max(aC * 0.5, -FIN - 16000), side * 7500), 3500);
  } else {
    // beside or beyond the airport: a downwind leg on our side (time for the checklists)
    add(toW(Math.max(aC, 3000), side * 7500), 3500);
  }
  add(toW(-FIN, side * 7500), 3200);   // base turn
  add(toW(-FIN, 0), 3000);             // onto the final, about 9 NM out
  let thr, exit;
  if (land19) {
    add(fa.to(60, 0));
    add(fa.to(1850, 0), 60);
    add(fa.to(2040, ARN_LAYOUT.taxiwayZ), 45);
    add(fa.to(1580, ARN_LAYOUT.taxiwayZ), 40);
    add(fa.to(1580, -480));
    thr = fa.to(0, 0); exit = fa.to(1850, 0);
  } else {
    add(fa.to(L - 60, 0));          // runway 01L threshold (south end), landing northbound
    add(fa.to(1250, 0), 60);        // end of the landing roll
    add(fa.to(1080, -190), 45);     // exit onto the parallel taxiway, then back south along it
    add(fa.to(1580, -190), 40);
    add(fa.to(1580, -480));         // stand by pier F
    thr = fa.to(L, 0); exit = fa.to(1250, 0);
  }
  splitSharpTurns(pts, rad, 3);
  const path = new Path(pts, rad);
  const m = { hold: 0, lineup: 0, arnRwyEnd: 0 };
  m.thr = path.locate(thr); m.touchdown = m.thr + 300;
  m.exit = path.locate(exit, m.thr - 100); m.crossing = m.exit; m.stand = path.length;
  return { path, m, airport: 'ARN', arr: runwayInfo('ESSA', rwy), arrRwy: rwy, dep: runwayInfo('ESSA', rwy === '01L' ? '19R' : '01L'), depRwy: rwy === '01L' ? '19R' : '01L', keys: { pts, rad, thrIdx: keyIdx(pts, exit, 0), exitPt: exit } };
}

// An airliner cannot fly a hairpin: where the route turns by more than about 100 degrees, add a
// point that splits the turn (a teardrop), so every corner is one the aircraft can fly at 250 kt.
function splitSharpTurns(pts, rad, lastAir, R = 5000) {
  for (let iter = 0; iter < 6; iter++) {
    let changed = false;
    for (let i = 1; i <= Math.min(lastAir, pts.length - 2); i++) {
      const a = pts[i].clone().sub(pts[i - 1]).normalize(), b = pts[i + 1].clone().sub(pts[i]).normalize();
      const turn = Math.acos(clamp(a.dot(b), -1, 1));
      if (turn < 100 * DEG) continue;
      const sgn = a.x * b.y - a.y * b.x >= 0 ? 1 : -1;
      const perp = sgn > 0 ? new THREE.Vector2(-a.y, a.x) : new THREE.Vector2(a.y, -a.x);
      const w = pts[i].clone().addScaledVector(a, R).addScaledVector(perp, R * 1.2);
      pts.splice(i + 1, 0, w); rad.splice(i + 1, 0, 3500); rad[i] = Math.max(rad[i], 3500);
      lastAir++; changed = true; break;
    }
    if (!changed) break;
  }
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
