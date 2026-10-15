/**
 * A man of the crew: where he is (level, x, z in the boat's frame), where he is going (a path
 * along the decks, through the doors, up and down the ladders), and his two hands.
 *
 * Nothing he does is instant. To work a control he must first be at it: he walks there (1.1 m/s,
 * 1.8 hurrying, slower on a ladder: 0.3 m a second up the rungs), a hand travels to it (Fitts'
 * law: a + b log2(D/W + 1)), then works it at the rate a hand can: a handwheel at a turn or two a
 * second, a lever thrown in half a second, a big wheel at 12 degrees a second. One hand, one job.
 * A watertight door in his way he opens (and dogs it again behind him if it was shut).
 */
import { CONTROL } from '../data/controls.js';
import { LADDERS, DOOR_LIST, DECK, LEVELS } from '../data/layout.js';
import { HULL } from '../data/boat.js';

export const LEVEL_Y = { main: DECK, ct: LEVELS.ct.y, bridge: HULL.bridgeDeck, pump: LEVELS.pump.y, obs: LEVELS.obs.y };

/** Fitts' law for reaching a control (Card, Moran and Newell's constants for an arm). */
export function reachTime(dist, size) { return 0.18 + 0.12 * Math.log2(dist / Math.max(0.02, size * 2) + 1); }

/** How long one unit of a control's travel takes a hand (s per unit of value). */
function workRate(c) {
  switch (c.kind) {
    case 'valve': return (c.rate ?? 1) / Math.max(0.1, c.turns ?? 1);   // value per second
    case 'wheel': return c.rate ?? 12;                                 // degrees per second
    case 'rheostat': return c.rate ?? 0.25;
    case 'door': return 1 / 3.5;                                        // open (or shut and dog) in ~3.5 s
    case 'hatch': return 1 / 3.0;
    default: return 1;
  }
}

class Hand {
  constructor(person, side) {
    this.person = person; this.side = side;
    this.queue = [];             // { id, to, phase, t, hold }
    this.pos = null;             // boat coordinates of the hand while on a control (for the figure's IK)
    this.on = null;
  }
  get free() { return this.queue.length === 0; }
}

export class Person {
  constructor(def, rand) {
    Object.assign(this, def);            // name, rate, role, bunk, looks...
    this.rand = rand;
    this.level = def.level ?? 'main';
    this.x = def.x ?? 0; this.z = def.z ?? 0;
    this.yaw = def.yaw ?? 0;
    this.posture = 'stand';
    this.speed = 0;
    this.path = [];                      // waypoints { level, x, z } or { climb: ladder, to }
    this.climb = null;                   // { L, from, to, t, T }
    this.hands = { L: new Hand(this, 'L'), R: new Hand(this, 'R') };
    this.reaction = 0.3 + 0.3 * rand();  // s
    this.hurry = false;
    this.at = null;                      // the station he is at (when there)
    this.goal = null;                    // the station he is going to
    this.face = null;                    // the yaw to face when arrived
    this.work = 0.15;                    // 0..1 for his breathing (atmosphere.js)
    this.wait = 0;
    this.doorJob = null;
    this.said = null;
  }

  get busy() { return !this.hands.L.free || !this.hands.R.free; }
  get moving() { return this.path.length > 0 || !!this.climb; }
  get y() { return LEVEL_Y[this.level]; }

  /** Queues a job on a control: reach it, work it to `to`; hold: keep the hand there after (s). */
  job(id, to, { hold = 0, pref = null, after = 0 } = {}) {
    const c = CONTROL[id];
    if (!c) throw new Error(`no control ${id}`);
    // a free hand; else the one not kept on a wheel, with the shorter list
    const tending = (h) => h.queue.some((q) => q.hold === Infinity);
    const R = this.hands.R, L = this.hands.L;
    const side = pref && !(tending(this.hands[pref]) && hold !== Infinity) ? pref
      : R.free ? 'R' : L.free ? 'L' : tending(R) && !tending(L) ? 'L' : tending(L) && !tending(R) ? 'R' : L.queue.length < R.queue.length ? 'L' : 'R';
    const h = this.hands[side];
    const j = { id, to, phase: 'wait', t: -after, hold, done: false };
    h.queue.push(j);
    return j;
  }

  /** The hand jobs still to do (or doing) on a control. */
  pending(id) { return [...this.hands.L.queue, ...this.hands.R.queue].some((j) => j.id === id); }

  /** Is he within arm's reach of a control? */
  canReach(c) {
    if ((c.level ?? 'main') !== this.level || this.moving) return false;
    const dy = c.pos[1] - (this.y + 1.2);
    return Math.hypot(c.pos[0] - this.x, c.pos[2] - this.z, dy * 0.6) < 1.05;
  }

  /**
   * Advances his hands: each works its first job when he can reach it. ctl: the plant's controls.
   * Returns true while any hand is working.
   */
  stepHands(dt, ctl) {
    let working = false;
    for (const h of Object.values(this.hands)) {
      const j = h.queue[0];
      if (!j) { h.on = null; h.pos = null; continue; }
      const c = CONTROL[j.id];
      if (!this.canReach(c)) { h.on = null; h.pos = null; continue; }
      working = true;
      j.t += dt;
      if (j.phase === 'wait') {
        if (j.t >= 0) { j.phase = 'reach'; j.t = 0; j.T = this.reaction * 0.5 + reachTime(0.5, c.size ?? 0.05); }
        continue;
      }
      if (j.phase === 'reach') {
        h.pos = c.pos; h.on = j.id;
        if (j.t >= j.T) { j.phase = 'work'; j.t = 0; }
        continue;
      }
      if (j.phase === 'work') {
        h.pos = c.pos; h.on = j.id;
        const cur = ctl[j.id];
        if (c.kind === 'lever' || c.kind === 'telegraph') {
          // thrown position by position, half a second each
          const st = c.states, i = st.indexOf(cur), k = st.indexOf(j.to);
          if (i === k || k < 0) { j.phase = 'hold'; j.t = 0; continue; }
          if (j.t >= 0.5) { ctl[j.id] = st[i + Math.sign(k - i)]; j.t = 0; }
          continue;
        }
        if (c.kind === 'switch' || c.kind === 'button') {
          if (j.t >= 0.3) { ctl[j.id] = j.to; j.phase = 'hold'; j.t = 0; }
          continue;
        }
        // continuous: valves, wheels, rheostats, doors, hatches
        const target = typeof j.to === 'number' ? j.to : (j.to === 'open' ? 1 : 0);
        const r = workRate(c) * dt;
        const v = +cur || 0;
        const nv = Math.abs(target - v) <= r ? target : v + Math.sign(target - v) * r;
        ctl[j.id] = nv;
        if (nv === target) { j.phase = 'hold'; j.t = 0; }
        continue;
      }
      if (j.phase === 'hold') {
        h.pos = c.pos; h.on = j.id;
        if (c.kind === 'button' && j.t >= j.hold) ctl[j.id] = 0;
        if (j.t >= j.hold) { j.done = true; h.queue.shift(); h.on = null; h.pos = null; }
      }
    }
    return working;
  }

  /** Plans a path to (level, x, z): along the level, through the ladders between levels. */
  goTo(level, x, z, yaw = null) {
    this.path = [];
    this.face = yaw;
    const route = levelRoute(this.level, level);
    let cl = this.level;
    for (const L of route) {
      this.path.push({ level: cl, x: L.x + 0.35, z: L.z });
      const to = L.from === cl ? L.to : L.from;
      this.path.push({ climb: L, from: cl, to });
      cl = to;
    }
    this.path.push({ level, x, z });
  }

  /** Walks the path. doorOpen(i) -> 0..1; returns a door he is waiting on (index) or null. */
  stepWalk(dt, ctl) {
    if (this.climb) {
      const c = this.climb;
      c.t += dt;
      this.speed = 0.3;
      if (c.t >= c.T) { this.level = c.to; this.x = c.L.x + 0.35; this.z = c.L.z; this.climb = null; }
      return null;
    }
    const wp = this.path[0];
    if (!wp) { this.speed = 0; return null; }
    if (wp.climb) {
      const L = wp.climb;
      if (L.hatch && (+ctl[`hatch.${L.hatch}`] || 0) < 0.6) {
        // the hatch above is shut: open it if he can reach it (from below), else wait
        this.speed = 0;
        return { hatch: L.hatch };
      }
      this.climb = { L, from: wp.from, to: wp.to, t: 0, T: 0.6 + Math.abs(LEVEL_Y[wp.to] - LEVEL_Y[wp.from]) / 0.32 };
      this.path.shift();
      return null;
    }
    const v = (this.hurry ? 1.8 : 1.1) * (0.92 + 0.16 * this.rand());
    // on the main deck he keeps to the passage's middle until he is near where he is going
    const lane = this.level === 'main' && Math.abs(wp.x - this.x) > 0.6;
    const tx = wp.x, tz = lane ? 0 : wp.z;
    if (this.level === 'main') {
      for (const d of DOOR_LIST) {
        if ((this.x - d.x) * (tx - d.x) < 0 && Math.abs(this.x - d.x) < 0.7 && (+ctl[`door.${d.i}`] || 0) < 0.55) { this.speed = 0; return { door: d.i }; }
      }
    }
    const dx = tx - this.x, dz = tz - this.z, dist = Math.hypot(dx, dz), step = v * dt;
    if (dist <= step) {
      this.x = tx; this.z = tz;
      if (!lane) { this.path.shift(); if (!this.path.length && this.face != null) this.yaw = this.face; }
      this.speed = 0;
      return null;
    }
    this.x += (dx / dist) * step; this.z += (dz / dist) * step;
    this.yaw = Math.atan2(dx, dz);
    this.speed = v;
    return null;
  }
}

/** The ladders to climb from one level to another (the levels form a small tree round the main deck). */
export function levelRoute(from, to) {
  if (from === to) return [];
  const up = { ct: 'main', bridge: 'ct', pump: 'main', obs: 'main', main: null };
  const chain = (l) => { const c = [l]; while (up[c[c.length - 1]]) c.push(up[c[c.length - 1]]); return c; };
  const a = chain(from), b = chain(to);
  const common = a.find((l) => b.includes(l));
  const seq = [...a.slice(0, a.indexOf(common) + 1), ...b.slice(0, b.indexOf(common)).reverse()];
  const out = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const L = LADDERS.find((q) => (q.from === seq[i] && q.to === seq[i + 1]) || (q.to === seq[i] && q.from === seq[i + 1]));
    out.push(L);
  }
  return out;
}
