/**
 * The signals on the north ramp, in the Swiss "System L" (SBB light signals; R 300.2):
 *
 *  - a main signal (Hauptsignal) shows red "Halt" while the block section beyond it is occupied
 *    or no route is set for the train, otherwise green "Fahrt";
 *  - a distant signal (Vorsignal) stands a braking distance before each main signal and shows
 *    what to expect: two orange lights "Warnung" (the main signal is at Halt), two green lights
 *    "Fahrt";
 *  - every station has an entry signal before its first points and an exit signal after its
 *    platforms; between the stations, block signals divide the line into sections.
 *
 * Positions are by those rules (entry ~500 m before the station, exit ~400 m past it or past the
 * special's stopping mark, distant signals 900 m before; blocks of at most ~3.5 km) - estimates,
 * as the line's signal plans were not to hand. Two tracks are signalled: the special's (the left
 * main line, chainage of route.run, running south) and the right main line northward.
 *
 * Train protection: Integra-Signum, as fitted to 2978 (ETM-S21). Passing a distant signal at
 * Warnung, the driver must acknowledge within 4 s or the train is braked; passing a main signal
 * at Halt brakes the train at once.
 */

const DISTANT = 900, BLOCK = 3500;

export class Signals {
  constructor(sim) {
    this.sim = sim;
    const R = sim.route;
    this.list = [];
    const stations = R.stations.map((st) => ({ ...st, sR: R.right.locate(R.run.pos(st.s).x, R.run.pos(st.s).y, null, 1e9).s }));
    // ---- the special's track (L), southward (chainage rising)
    this._lay('L', +1, stations.map((st, i) => ({
      name: st.name,
      entry: i === 0 ? null : st.s - 500,
      exit: i === stations.length - 1 ? null : Math.max(st.s + 400, (st.stopFront ?? (st.stopCentre ?? st.s) + 80) + 60),
    })), R.run.length);
    // ---- the right main line, northward (chainage falling)
    this._lay('R', -1, [...stations].reverse().map((st, i, a) => ({
      name: st.name,
      entry: i === 0 ? null : st.sR + 500,
      exit: i === a.length - 1 ? null : st.sR - 400,
    })), R.right.length);
    this.mains = this.list.filter((x) => x.kind === 'main');
    this.signum = { pending: null, deadline: 0, tripped: null };
    this._passed = new Map();
    this.update();
  }

  /** Main signals for one track and direction from its stations (in travel order), plus blocks and distants. */
  _lay(track, dir, stations, length) {
    const mains = [];
    stations.forEach((st, i) => {
      if (st.entry != null) mains.push({ s: st.entry, name: `${st.name} entry`, station: st.name, role: 'entry' });
      if (st.exit != null) mains.push({ s: st.exit, name: `${st.name} exit`, station: st.name, role: 'exit' });
      const next = stations[i + 1];
      if (st.exit != null && next?.entry != null) {
        const gap = (next.entry - st.exit) * dir, n = Math.floor(gap / BLOCK);
        for (let k = 1; k <= n; k++) mains.push({ s: st.exit + (dir * gap * k) / (n + 1), name: `Block ${st.name}–${next.name} ${k}`, role: 'block' });
      }
    });
    mains.sort((a, b) => (a.s - b.s) * dir);
    mains.forEach((m, i) => {
      const end = mains[i + 1]?.s ?? (dir > 0 ? length : 0);
      const sig = { id: `${track}${i}`, track, dir, kind: 'main', ...m, end, aspect: 'stop' };
      this.list.push(sig);
      const ds = m.s - dir * DISTANT;
      const prev = mains[i - 1]?.s;
      // (where the previous main signal is nearer than that, the warning is shown on its mast: not modelled apart)
      if ((prev == null || (ds - prev) * dir > 30) && ds > 0 && ds < length) this.list.push({ id: `${track}${i}v`, track, dir, kind: 'distant', s: ds, name: `distant of ${m.name}`, main: sig, aspect: 'warning' });
    });
  }

  /** The occupied stretches of each track: the special and the other trains. */
  _occupancy() {
    const T = this.sim.train, occ = { L: [[T.rear, T.front]], R: [] };
    for (const r of this.sim.traffic?.runs ?? []) {
      if (!r.onMap) continue;
      for (const [track, a, b] of r.occupies()) if (track !== 'X') occ[track]?.push([Math.min(a, b), Math.max(a, b)]);
    }
    return occ;
  }

  /** Is a main signal's block occupied (by any train)? */
  blockOccupied(m) {
    const a = Math.min(m.s, m.end), b = Math.max(m.s, m.end);
    return (this._occ?.[m.track] ?? []).some(([x, y]) => y > a + 1 && x < b - 1);
  }

  /** Sets every aspect from the occupancy and the special's departures. */
  update() {
    const occ = (this._occ = this._occupancy()), sim = this.sim;
    const crew = sim.crew, stop = sim.timetable?.stops?.[crew?.next];
    for (const m of this.mains) {
      const a = Math.min(m.s, m.end), b = Math.max(m.s, m.end);
      let free = !occ[m.track].some(([x, y]) => y > a + 1 && x < b - 1);
      // the exit at a station where the special stands: cleared at the booked time, everyone aboard
      if (free && m.track === 'L' && m.role === 'exit' && m.station === stop?.name && crew && ['prep', 'stopped'].includes(crew.phase)) {
        free = !!(sim.departureDue?.() && sim.readyToStart?.()) || !stop.dep;
      }
      m.aspect = free ? 'clear' : 'stop';
    }
    for (const d of this.list) if (d.kind === 'distant') d.aspect = d.main.aspect === 'stop' ? 'warning' : 'clear';
  }

  /** The next signal ahead of chainage s on a track in its direction: { sig, dist }; kind 'main' or any. */
  ahead(s, { track = 'L', kind = null } = {}) {
    let best = null;
    for (const g of this.list) {
      if (g.track !== track || (kind && g.kind !== kind)) continue;
      const d = (g.s - s) * g.dir;
      if (d > -2 && (!best || d < best.dist)) best = { sig: g, dist: d };
    }
    if (best) Object.assign(best, { name: best.sig.name, aspect: best.sig.aspect, aspectText: ASPECT[best.sig.kind][best.sig.aspect] });
    return best;
  }

  /** Distance to the next main signal at stop (the end of the movement authority), or Infinity. */
  authority(s, track = 'L') {
    let d = Infinity;
    for (const m of this.mains) {
      if (m.track !== track || m.aspect !== 'stop') continue;
      const x = (m.s - s) * m.dir;
      if (x > 0.5 && x < d) d = x;            // (one just passed is red behind the train: not its business)
    }
    return d;
  }

  /** Each step: aspects, and Signum on the special's engine as it passes signals. */
  step(dt) {
    // what each signal showed before this step: a signal turns to Halt as the front passes it (the
    // train is now in its section), and Signum reads it as the engine reached it
    for (const g of this.list) g.before = g.aspect;
    this.update();
    const T = this.sim.train, sg = this.signum, t = T.time;
    for (const g of this.list) {
      if (g.track !== 'L') continue;
      const was = this._passed.get(g.id) ?? (T.front > g.s);
      const now = T.front > g.s;
      this._passed.set(g.id, now);
      if (!was && now) {
        if (g.kind === 'distant' && g.before === 'warning') {
          sg.pending = g; sg.deadline = t + 4;
          if (!this.sim.crew?.manual) sg.pending = null;          // the driver acknowledges at once
          else this.sim.log?.(`Signum: warning at ${g.name.replace('distant of ', '')} - acknowledge (K)!`);
        }
        if (g.kind === 'main' && g.before === 'stop') this._trip(`passed ${g.name} at danger`);
      }
    }
    if (sg.pending && t > sg.deadline) { sg.pending = null; this._trip('warning not acknowledged'); }
  }

  acknowledge() { if (this.signum.pending) { this.signum.pending = null; this.sim.log?.('Signum acknowledged.'); } }

  _trip(why) {
    const B = this.sim.train.brake, L = this.sim.train.loco;
    B.handle = 'emergency'; L.c.regulator = 0;
    this.signum.tripped = { why, t: this.sim.train.time };
    this.sim.log?.(`Signum: ${why} - emergency brake!`);
  }
}

export const ASPECT = {
  main: { stop: 'Halt (red)', clear: 'Fahrt (green)' },
  distant: { warning: 'Warnung (two orange)', clear: 'Fahrt (two green)' },
};

