/**
 * The other trains on the line: the hourly Treno Gottardo, run by the Südostbahn with its
 * "Traverso" (RABe 526, Stadler, a FLIRT derivative: eight cars in two permanently coupled
 * halves, 150.2 m, 160 km/h, 5.2 MW, copper-red), over the mountain line every hour since
 * December 2020 (en.wikipedia "SOB Traverso"; railpictures.net captions).
 *
 * The southbound one catches the special up and overtakes it at Gurtnellen, crossing over to the
 * right-hand main line before the station and back after (the Gotthard's double track is
 * signalled for running in either direction on both tracks). The northbound one comes down the
 * right-hand line past the photo stop at Wassen. Their times are estimates (the 2026 working
 * timetable was not to hand); their running follows the line: speed in the curves from the cant
 * and its deficiency, at most 80 km/h on the ramps, power-limited acceleration against the grade,
 * service braking for the stops.
 */
const G = 9.81;
const STEP = 2;                   // m between samples of a path

/** A path along the main lines, with the crossovers blended: it answers like a Track. */
export class PathLine {
  /** legs: [{ track, s0, s1 }] in the order travelled; blend: crossover length (m). */
  constructor(route, legs, { blend = 140, name = 'path' } = {}) {
    this.name = name;
    const pts = [];
    for (const [k, leg] of legs.entries()) {
      const T = route[leg.track], dir = Math.sign(leg.s1 - leg.s0);
      const n = Math.max(1, Math.round(Math.abs(leg.s1 - leg.s0) / STEP));
      for (let i = k === 0 ? 0 : 1; i <= n; i++) {
        const s = leg.s0 + ((leg.s1 - leg.s0) * i) / n;
        const p = T.pos(s);
        pts.push({ x: p.x, y: p.y, z: p.z, cant: T.cantAt(s) * dir, v: T.curveSpeedAt(s), grade: T.gradeAt(s) * dir, leg: k });
      }
    }
    // the crossovers: the jump from one track to the next (its sideways part) eased out over
    // `blend` metres, half before the switch and half after
    for (let i = 2; i < pts.length; i++) {
      if (pts[i].leg === pts[i - 1].leg) continue;
      const off = { x: (pts[i].x - pts[i - 1].x) - (pts[i - 1].x - pts[i - 2].x), y: (pts[i].y - pts[i - 1].y) - (pts[i - 1].y - pts[i - 2].y) };
      const half = Math.round(blend / 2 / STEP);
      for (let j = Math.max(0, i - half); j <= Math.min(pts.length - 1, i + half); j++) {
        const t = (j - (i - half)) / (2 * half), w = t * t * (3 - 2 * t);
        const k = j < i ? w : -(1 - w);
        pts[j].x += off.x * k; pts[j].y += off.y * k;
        pts[j].v = Math.min(pts[j].v, 40 / 3.6);   // a crossover is taken at 40 km/h
      }
    }
    this.n = pts.length;
    this.length = (this.n - 1) * STEP;
    this.xyz = new Float64Array(this.n * 3);
    this.cant = new Float64Array(this.n); this.vlim = new Float64Array(this.n); this.grade = new Float64Array(this.n);
    pts.forEach((p, i) => { this.xyz.set([p.x, p.y, p.z], i * 3); this.cant[i] = p.cant; this.vlim[i] = p.v; this.grade[i] = p.grade; });
    this.heading = new Float64Array(this.n); this.curv = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1);
      this.heading[i] = Math.atan2(this.xyz[b * 3] - this.xyz[a * 3], this.xyz[b * 3 + 1] - this.xyz[a * 3 + 1]);
    }
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 3), b = Math.min(this.n - 1, i + 3);
      let dh = this.heading[b] - this.heading[a]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.curv[i] = dh / Math.max(STEP, (b - a) * STEP);
    }
  }
  _lerp(arr, s, k = 1, o = 0) {
    const f = Math.max(0, Math.min(this.n - 1.0001, s / STEP)), i = Math.floor(f), t = f - i;
    return arr[i * k + o] * (1 - t) + arr[(i + 1) * k + o] * t;
  }
  pos(s, out = {}) { out.x = this._lerp(this.xyz, s, 3, 0); out.y = this._lerp(this.xyz, s, 3, 1); out.z = this._lerp(this.xyz, s, 3, 2); return out; }
  headingAt(s) { const f = Math.max(0, Math.min(this.n - 1, Math.round(s / STEP))); return this.heading[f]; }
  curvatureAt(s) { return this._lerp(this.curv, s); }
  cantAt(s) { return this._lerp(this.cant, s); }
  gradeAt(s) { return this._lerp(this.grade, s); }
}

/** A train running to a schedule on a path: stops (u, dwell) and a start time. */
class Scheduled {
  constructor(path, { name, start, stops = [], vEnter = 0, length = 150.2, mass = 330e3, power = 5.2e6, fmax = 300e3, vmax = 80 / 3.6 }) {
    this.name = name; this.path = path; this.length = length;
    const n = path.n;
    const u = (i) => i * STEP;
    // the speed limit along the path: the line, the curves, a stop at each station
    const lim = new Float64Array(n);
    for (let i = 0; i < n; i++) lim[i] = Math.min(vmax, path.vlim[i]);
    const stopAt = new Map(stops.map((st) => [Math.round(st.u / STEP), st]));
    for (const i of stopAt.keys()) lim[i] = 0;
    // forward: as fast as the power and the grade allow; backward: brake in time (0.6 m/s²)
    const v = new Float64Array(n);
    v[0] = Math.min(vEnter, lim[0]);
    for (let i = 0; i + 1 < n; i++) {
      const vi = Math.max(0.5, v[i]);
      const a = Math.min(fmax, power / vi) / mass - G * path.grade[i] - (2000 + 30 * vi * vi) / mass;
      v[i + 1] = Math.min(lim[i + 1], Math.sqrt(Math.max(0, v[i] * v[i] + 2 * Math.max(0.05, a) * STEP)));
    }
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * 0.6 * STEP));
    // time along the path, with the dwell at each stop
    this.t = new Float64Array(n);
    let t = start;
    for (let i = 0; i < n; i++) {
      if (i > 0) t += (2 * STEP) / Math.max(0.3, v[i - 1] + v[i]);
      const st = stopAt.get(i);
      this.t[i] = t;
      if (st) { t = Math.max(t + (st.dwell ?? 60), st.dep ?? 0); this.depart ??= []; this.depart.push({ i, t }); }
    }
    this.v = v;
    this.end = t;
  }

  /** Where the front is at clock time (s of the path), and the speed; null before it comes or after it goes. */
  at(clock) {
    const T = this.t, n = T.length;
    if (clock < T[0] || clock > T[n - 1]) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= clock) lo = m; else hi = m; }
    // standing at a stop (the clock between arriving and leaving)
    const dt = T[hi] - T[lo];
    const f = dt > 0 ? Math.min(1, Math.max(0, (clock - T[lo]) / dt)) : 0;
    const vv = this.v[lo] + (this.v[hi] - this.v[lo]) * f;
    return { s: (lo + f) * STEP, v: dt > 120 ? 0 : vv };
  }
}

/** The trains other than the special, built for the day's route. */
export class Traffic {
  constructor(route) {
    this.route = route;
    const L = route.left, R = route.right;
    const on = (track, name) => { const st = route.stations.find((x) => x.name === name); const p = route.run.pos(st.s); return route[track].locate(p.x, p.y, null, 1e9).s; };
    const hm = (h, m, s = 0) => h * 3600 + m * 60 + s;
    // southbound: up the left-hand line, over to the right through Gurtnellen and back
    const gS = on('left', 'Gurtnellen');
    const xA = this._openTrack('left', gS - 1100), xB = this._openTrack('left', gS + 700);
    const rA = R.locate(L.pos(xA).x, L.pos(xA).y, null, 1e9).s, rB = R.locate(L.pos(xB).x, L.pos(xB).y, null, 1e9).s;
    const south = new PathLine(route, [{ track: 'left', s0: 0, s1: xA }, { track: 'right', s0: rA, s1: rB }, { track: 'left', s0: xB, s1: L.length }], { name: 'IR 26 south' });
    const uOf = (path, track, s) => { const p = route[track].pos(s); let best = 0, bd = 1e18; for (let u = 0; u <= path.length; u += 10) { const q = path.pos(u); const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; best = u; } } return best; };
    const uErst = uOf(south, 'left', on('left', 'Erstfeld')), uGoe = uOf(south, 'left', on('left', 'Göschenen'));
    // (estimated times) at Erstfeld 10:32-10:33, at Göschenen a minute, then into the summit tunnel
    this.trains = [
      new Scheduled(south, { name: 'Treno Gottardo (southbound)', start: hm(10, 31, 20), vEnter: 14, stops: [{ u: uErst, dwell: 50, dep: hm(10, 33) }, { u: uGoe, dwell: 60 }] }),
    ];
    // northbound: out of the summit tunnel at Göschenen, down the right-hand line
    const north = new PathLine(route, [{ track: 'right', s0: R.length, s1: 0 }], { name: 'IR 26 north' });
    const nGoe = uOf(north, 'right', on('right', 'Göschenen')), nErst = uOf(north, 'right', on('right', 'Erstfeld'));
    this.trains.push(new Scheduled(north, { name: 'Treno Gottardo (northbound)', start: hm(11, 2, 40), vEnter: 12, stops: [{ u: nGoe, dwell: 50, dep: hm(11, 4) }, { u: nErst, dwell: 60 }] }));
  }

  /** A chainage near s on a track that is not in a tunnel (crossovers are in the open). */
  _openTrack(track, s) {
    const tun = this.route.leftTunnels;
    for (let d = 0; d < 2000; d += 20) {
      for (const x of [s - d, s + d]) if (!tun.some((t) => x > t.s0 - 80 && x < t.s1 + 80)) return x;
    }
    return s;
  }

  /** Each train's state now: { train, s (path chainage of the front), v } for those on the map. */
  at(clock) {
    const out = [];
    for (const tr of this.trains) { const a = tr.at(clock); if (a) out.push({ train: tr, ...a }); }
    return out;
  }
}
