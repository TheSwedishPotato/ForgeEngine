/**
 * The crew at work. Every man has his station for each condition of readiness (roster.js); when
 * the condition changes (the diving alarm sends the boat to diving stations) each man walks to
 * his, through the boat. Nothing in the plant moves except under a man's hand (person.js).
 *
 * The continuous work is done the way men did it:
 *  - the bow planesman keeps the depth the diving officer orders, from the depth gauge and how
 *    fast its needle moves; the stern planesman keeps the angle on the boat (the bubble), the
 *    angle being what takes her up or down; each puts his wheel where he judges, every half
 *    second or so, at the speed a man turns a wheel;
 *  - the helmsman steers by the gyro repeater toward the ordered course;
 *  - the controllermen answer the telegraph: the answering pointer, then the starters, the
 *    reverse levers and the field rheostats (on the battery), or the generators' fields (on the
 *    diesels), as the class's bell table has it.
 * The rest (diving, surfacing, starting engines, trimming) is in procedures.js, as the step by
 * step orders and reports of the Fleet Type Submarine's chapter 18.
 */
import { Person, LEVEL_Y } from './person.js';
import { STATIONS, CONDITIONS, roster, messSeats } from './roster.js';
import { CONTROL } from '../data/controls.js';
import { FT, LONG_TON } from '../data/boat.js';
import * as PROC from './procedures.js';

const BELLS = ['backEmergency', 'backFull', 'back2', 'back1', 'stop', 'ahead1', 'ahead2', 'standard', 'full', 'flank'];
/** On the battery: starter, motor field (rheostat 0..1), reverse. Submerged speeds 3.8 to 8.9 knots. */
const BATTERY_BELLS = {
  stop: { starter: 'stop' }, ahead1: { starter: 'ser3', field: 1 }, ahead2: { starter: 'ser3', field: 0.55 }, standard: { starter: 'par2', field: 1 },
  full: { starter: 'par2', field: 0.75 }, flank: { starter: 'par2', field: 0.5 },
  back1: { starter: 'ser3', field: 1, astern: true }, back2: { starter: 'ser3', field: 0.6, astern: true }, backFull: { starter: 'par2', field: 1, astern: true }, backEmergency: { starter: 'par2', field: 0.8, astern: true },
};
/** On the diesels: the generators' field (rheostat 0..1), the motors in parallel. */
const DIESEL_BELLS = { stop: 0, ahead1: 0.32, ahead2: 0.5, standard: 0.7, full: 0.88, flank: 1.0, back1: 0.3, back2: 0.45, backFull: 0.6, backEmergency: 0.75 };
/** In diving stations the lookouts and the officer of the deck come below to their diving stations. */
const DIVE_SWAP = { lookoutP: 'bowPlanes', lookoutS: 'sternPlanes', oodBridge: 'ctOfficer' };

export class Crew {
  constructor(sim, { condition = 'surfaced', seed = 1942 } = {}) {
    this.sim = sim;
    this.plant = sim.plant;
    let s = seed;
    this.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.men = roster(seed).map((d) => new Person(d, this.rand));
    this.byStation = new Map();
    const hd = (this.plant.dyn.attitude.heading * 180) / Math.PI;
    this.orders = { depth: Math.max(60 * FT, this.plant.dyn.out?.keelDepth ?? 0), heading: hd, bell: this.plant.ctl['ct.telegraph.port'] ?? 'stop', rudderLimit: 15, planes: 'hold', diveAngle: 7 };
    this.scripts = [];
    this.charge = {};                    // generators charging the battery: the controllerman holds the current
    this.fieldCap = [1, 1, 1, 1, 1];     // each generator's field, held down when its ammeter reaches the rating
    this.log = [];
    this.t = 0;
    this._tick = 0;
    this.seats = messSeats();
    this.setCondition(condition, { now: true });
  }

  say(who, text) {
    const p = typeof who === 'string' ? this.man(who) : who;
    const name = p ? `${p.rate.replace(/ 1st Class| 2nd Class| 3rd Class/, '')} ${p.name.split(' ')[1]}` : who;
    this.sim.say(text, name);
    if (p) p.said = { text, t: this.t };
  }

  /** The man at (or assigned to) a station. */
  man(station) { return this.byStation.get(station) ?? null; }

  /** The station each man stands in a condition. */
  stationFor(m, condition) {
    const st = m.station;
    if (!st) return null;
    const list = CONDITIONS[condition] ?? [];
    if (condition !== 'surfaced' && DIVE_SWAP[st]) return DIVE_SWAP[st];
    if (condition === 'surfaced' && Object.values(DIVE_SWAP).includes(st) && st !== 'ctOfficer') return null;   // the planesmen's own men are off watch on the surface
    return list.includes(st) ? st : null;
  }

  /** Sends every man to his station for a condition (now: put him there at once, for a start). */
  setCondition(condition, { now = false, hurry = false } = {}) {
    this.condition = condition;
    this.byStation.clear();
    this._seat = 0;
    for (const m of this.men) {
      // a man with his hands on something finishes it first
      if (!now && m.busy) { m.reassign = { hurry }; const st = m.goal; if (st) this.byStation.set(st, m); continue; }
      this._assign(m, condition, { now, hurry });
    }
  }

  /** Sends one man to his station for the condition (or to his bunk or the mess). */
  _assign(m, condition, { now = false, hurry = false } = {}) {
    m.reassign = null;
    {
      const id = this.stationFor(m, condition);
      // the engines' men stand by their engines only when they run (or in diving stations)
      const eng = id && /^eng\d|auxEngine/.test(id);
      const engineRuns = eng && (condition === 'diving' || this._engineRunning(id));
      const st = id && (!eng || engineRuns) ? STATIONS[id] : null;
      if (st) this.byStation.set(id, m);
      m.goal = st ? id : null;
      m.hurry = hurry;
      if (st) {
        if (now) { Object.assign(m, { level: st.level, x: st.x, z: st.z, yaw: st.yaw }); m.path = []; m.at = id; }
        else if (m.at !== id) { m.at = null; m.goTo(st.level, st.x, st.z, st.yaw); }
        m.rest = null;
      } else {
        // off watch: a third at the mess tables, the rest in their bunks
        const mess = !m.officer && this.rand() < 0.3 && this._seat < this.seats.length;
        const r = mess ? { ...this.seats[this._seat++], posture: 'sit' } : { ...m.bunk, posture: 'lie' };
        m.rest = r;
        if (now) { Object.assign(m, { level: r.level, x: r.x, z: r.z, yaw: r.yaw }); m.path = []; m.at = 'rest'; }
        else if (!m.at || m.at !== 'rest') { m.at = null; m.goTo(r.level, r.x, r.z, r.yaw); }
      }
    }
  }

  _engineRunning(id) {
    const n = id === 'auxEngine' ? 0 : Number(id.slice(3));
    const e = n ? this.plant.engines[n - 1] : this.plant.auxEngine;
    const pre = n ? `eng${n}` : 'aux', ctl = this.plant.ctl;
    // running, being started, or still lined up (its sea suction or standby pump on)
    return e.state === 'running' || e.state === 'cranking' || ctl[`${pre}.lever`] !== 'stop' || (+ctl[`${pre}.seaSuction`] || 0) > 0.5
      || (+ctl[`${pre}.standbyLube`] || 0) > 0.5 || this.scripts.some((s) => s.name.startsWith(`startEngine${n}`) || s.name === `stopEngine${n}`);
  }

  /** Starts a procedure (procedures.js) by name. */
  order(name, args = {}) {
    const fn = PROC[name];
    if (!fn) throw new Error(`no procedure ${name}`);
    // a new order of the same kind replaces the old
    this.scripts = this.scripts.filter((s) => s.name !== name && !(PROC.EXCLUSIVE[name] ?? []).includes(s.name));
    const gen = fn(this, args);
    this.scripts.push({ name, gen, wait: null });
    return true;
  }
  running(name) { return this.scripts.some((s) => s.name === name); }

  // ---- what procedures use -------------------------------------------------------------------

  /** The man at a station works a control (he walks there first if he is not at it). */
  do(station, id, to, opts = {}) {
    const m = this.man(station);
    if (!m) return null;
    return m.job(id, to, opts);
  }
  /** A condition to wait for: the jobs done. */
  done(...jobs) { return () => jobs.flat().every((j) => !j || j.done); }
  /** The men at their stations. */
  manned(...stations) { return () => stations.flat().every((s) => { const m = this.man(s); return !m || m.at === s; }); }

  // ---- the step --------------------------------------------------------------------------------

  step(dt) {
    this.t += dt;
    const ctl = this.plant.ctl, P = this.plant;
    // the men: walking, climbing, their hands
    for (const m of this.men) {
      if (m.reassign && !m.busy) { this._assign(m, this.condition, m.reassign); }
      // a job on a control out of his reach: he steps over to it (and back to his station after)
      const j = m.hands.R.queue[0] ?? m.hands.L.queue[0];
      if (j && !m.moving && !m.canReach(CONTROL[j.id])) {
        const c = CONTROL[j.id], [sx, sz] = standAt(c);
        if (m.at && m.at !== 'rest') m.returnTo = m.at;
        m.at = null;
        m.goTo(c.level ?? 'main', sx, sz, Math.atan2(c.pos[0] - sx, c.pos[2] - sz));
      }
      const block = m.stepWalk(dt, ctl);
      if (block?.door != null && !m.pending(`door.${block.door}`)) m.job(`door.${block.door}`, 1);
      if (block?.hatch && !m.pending(`hatch.${block.hatch}`)) m.job(`hatch.${block.hatch}`, 1);
      if (!m.moving && m.at == null) {
        if (m.returnTo && STATIONS[m.returnTo] && m.hands.L.free && m.hands.R.free) { const st = STATIONS[m.returnTo]; m.goTo(st.level, st.x, st.z, st.yaw); m.returnTo = null; }
        else if (!m.returnTo) {
          if (m.goal && STATIONS[m.goal] && Math.hypot(m.x - STATIONS[m.goal].x, m.z - STATIONS[m.goal].z) < 0.2 && m.level === STATIONS[m.goal].level) m.at = m.goal;
          else if (!m.goal && m.rest && Math.hypot(m.x - m.rest.x, m.z - m.rest.z) < 0.2) m.at = 'rest';
        }
      }
      m.posture = m.moving ? 'walk' : m.at === 'rest' ? m.rest.posture : (m.at && STATIONS[m.at]?.posture) || 'stand';
      m.stepHands(dt, ctl);
      m.work = m.moving ? (m.hurry ? 0.8 : 0.4) : m.busy ? 0.35 : m.at === 'rest' && m.rest?.posture === 'lie' ? 0.0 : 0.12;
    }
    // the procedures
    for (const s of [...this.scripts]) {
      if (s.wait && !s.wait()) continue;
      const r = s.gen.next();
      if (r.done) { this.scripts.splice(this.scripts.indexOf(s), 1); continue; }
      const w = r.value;
      s.wait = typeof w === 'number' ? ((t0) => () => this.t >= t0 + w)(this.t) : typeof w === 'function' ? w : null;
    }
    // the continuous watchstanders, twice a second
    this._tick += dt;
    if (this._tick >= 0.5) { const T = this._tick; this._tick = 0; this._planesmen(T); this._helmsman(T); this._controllermen(T); }
    this._navTick = (this._navTick ?? 0) + dt;
    if (this._navTick >= 3) { this._navTick = 0; this._navigator(); }
    // their weight where they are (the trim feels a crowd going forward)
    P.people = this.men.map((m) => ({ kg: (m.female ? 68 : 82) + 8, x: m.x, y: LEVEL_Y[m.level] + (m.posture === 'lie' ? 0.2 : 0.9), z: m.z, work: m.work }));
  }

  /**
   * The quartermaster keeps an eye on the fathometer: shoaling water is reported, and the captain
   * slows her and comes round toward the deepest water; an ordered depth the bottom will not allow
   * (less than 20 ft under the keel) is cut short.
   */
  _navigator() {
    const P = this.plant, g = P.g, ctl = P.ctl, O = this.orders;
    const fath = g.fathometer;
    if (fath == null || !Number.isFinite(fath)) return;
    const bell = ctl['ct.telegraph.port'] ?? 'stop';
    const ahead = !['stop', 'back1', 'back2', 'backFull', 'backEmergency'].includes(bell);
    if (fath < 35 && ahead && !this._shoal) {
      this._shoal = true;
      this.say('quartermaster', `Fathometer shows ${Math.round(fath)} feet under the keel and shoaling!`);
      // the deepest water a couple of hundred metres round her
      const d = P.dyn, bed = this.sim.bed;
      let best = O.heading, bd = -1;
      for (let k = 0; k < 16; k++) {
        const h = (k / 16) * Math.PI * 2;
        const depth = bed.depth(d.pos[0] + Math.sin(h) * 300, d.pos[2] - Math.cos(h) * 300);
        if (depth > bd) { bd = depth; best = (h * 180) / Math.PI; }
      }
      this.say('captain', fath < 18 ? 'All back full! Right full rudder!' : 'All ahead one third. Come about to seaward.');
      this.order('speed', { bell: fath < 18 ? 'backFull' : 'ahead1' });
      this.order('course', { heading: best, rudder: 30 });
    }
    if (fath > 70) this._shoal = false;
    // the bilges, and flooding
    const F = P.flood;
    if (F.total > 0.3 && !this.running('pumpBilges') && !(P.trim.drainPump)) this.order('pumpBilges');
    const inflow = Object.values(F.inflow ?? {}).reduce((a, q) => a + q, 0) + (F.leak ?? 0);
    if (inflow > 0.05 && !this._flooding) {
      this._flooding = true;
      const wet = F.comps.reduce((a, q) => (q.water > a.water ? q : a), F.comps[0]);
      this.order('flooding', { where: wet.name.toLowerCase().replace(/ \(.*\)/, '') });
    }
    if (inflow < 0.005) this._flooding = false;
    if (g.depth > 30) {
      const room = g.depth + fath - 20;
      if (O.depth / FT > room) {
        O.depth = Math.max(60, room) * FT;
        this.say('divingOfficer', `Not enough water, sir: the bottom is ${Math.round(g.depth + fath)} feet. Holding ${Math.round(O.depth / FT)} feet.`);
      }
    }
  }

  /** Keeps a hand on a wheel (or rheostat) and puts it at `to`. */
  tend(m, id, to) {
    for (const h of Object.values(m.hands)) {
      const j = h.queue.find((q) => q.id === id);
      if (j) { j.to = to; if (j.phase === 'hold') { j.phase = 'work'; j.t = 0; } return j; }
    }
    return m.job(id, to, { hold: Infinity, pref: 'R' });
  }
  release(m, id) {
    for (const h of Object.values(m.hands)) {
      const i = h.queue.findIndex((q) => q.id === id);
      if (i >= 0 && h.queue[i].hold === Infinity) h.queue[i].hold = 0;
    }
  }

  _planesmen(T) {
    const P = this.plant, g = P.g, ctl = P.ctl, O = this.orders;
    const bow = this.man('bowPlanes'), stern = this.man('sternPlanes');
    const depth = g.depth ?? 0;
    this._lastDepth ??= depth;
    const rate = (depth - this._lastDepth) / T;              // ft/s, + going deeper
    this._lastDepth = depth;
    const pitch = g.pitch ?? 0;
    this._lastPitch ??= pitch;
    const prate = (pitch - this._lastPitch) / T;
    this._lastPitch = pitch;
    const want = O.depth / FT;                                // the ordered depth, in the gauges' feet
    const submerged = depth > 30 || O.planes === 'dive';
    const kn = Math.max(1.5, g.speed ?? 0);
    const gain = Math.min(2.5, Math.max(0.5, (5 / kn) ** 2));
    if (bow && bow.at === 'bowPlanes' && P.rig >= 1) {
      let cmd;
      if (O.planes === 'dive') cmd = depth < want - 25 ? -25 : -10;
      else if (O.planes === 'rise') cmd = 20;
      else cmd = (1.0 * (depth - want) + 6 * rate) * gain;
      cmd = Math.max(-25, Math.min(25, cmd + (this.rand() - 0.5) * 0.6));
      this.tend(bow, 'cr.bowPlanes', Math.round(cmd * 2) / 2);
    }
    if (stern && stern.at === 'sternPlanes' && submerged) {
      const maxA = O.planes === 'dive' || O.planes === 'rise' ? O.diveAngle : 4;
      let ang = Math.max(-maxA, Math.min(maxA, -(want - depth) * 0.12));
      if (O.planes === 'rise') ang = Math.min(maxA, Math.max(3, (depth - want) * 0.1));
      let cmd = 4 * (ang - pitch) - 10 * prate;
      cmd = Math.max(-20, Math.min(20, cmd * Math.min(2, gain) + (this.rand() - 0.5) * 0.6));
      this.tend(stern, 'cr.sternPlanes', Math.round(cmd * 2) / 2);
    } else if (stern && stern.at === 'sternPlanes' && Math.abs(+ctl['cr.sternPlanes'] || 0) > 0.5) this.tend(stern, 'cr.sternPlanes', 0);
  }

  _helmsman(T) {
    const P = this.plant, g = P.g, O = this.orders, ctl = P.ctl;
    const st = ctl['cr.steerSel'] === 'cr' ? 'crHelm' : 'ctHelm';
    const m = this.man(st);
    if (!m || m.at !== st) return;
    const id = st === 'crHelm' ? 'cr.helm' : 'ct.helm';
    const h = g.heading ?? 0;
    this._lastH ??= h;
    let r = ((h - this._lastH + 540) % 360) - 180;
    this._lastH = h;
    r /= T;
    const err = ((O.heading - h + 540) % 360) - 180;
    let cmd = 1.4 * err - 9 * r;
    cmd = Math.max(-O.rudderLimit, Math.min(O.rudderLimit, cmd));
    if (Math.abs(err) < 0.6 && Math.abs(r) < 0.1) cmd = 0;
    this.tend(m, id, Math.round(cmd));
  }

  _controllermen() {
    const P = this.plant, ctl = P.ctl, g = P.g;
    for (const side of ['port', 'stbd']) {
      const station = side === 'port' ? 'maneuveringP' : 'maneuveringS';
      const m = this.man(station);
      if (!m || m.at !== station) continue;
      const gens = side === 'port' ? [2, 4] : [1, 3];
      if (m.busy) continue;
      // the generators charging the battery, when the bells leave him a moment (below)
      const nudgeCharge = () => {
        for (const n of gens) {
          if (ctl[`man.gen.${n}`] !== 'batBus' || !this.charge[n]) continue;
          // the field nudged to hold the charging rate: 1,600 A a generator at the start, tapering
          // to the finishing rate as the battery's voltage reaches its gassing point (2.35 V a cell)
          const I = g.amps?.gen?.[n - 1] ?? 0, V = g.volts?.bus ?? 250;
          const target = V > 2.35 * 126 ? 500 : 1600;
          const f = +ctl[`man.genField.${n}`] || 0;
          const df = Math.max(-0.01, Math.min(0.006, (target - I) * 4e-6));
          if (Math.abs(target - I) > 150) { m.job(`man.genField.${n}`, Math.max(0, Math.min(1, f + df))); return; }
        }
      };
      const bell = ctl[`ct.telegraph.${side}`];
      // answer the bell first
      if (ctl[`man.answer.${side}`] !== bell) { m.job(`man.answer.${side}`, bell); continue; }
      const diesel = [1, 2, 3, 4].some((n) => ctl[`man.gen.${n}`] === 'motorBus');
      if (diesel) {
        const f = DIESEL_BELLS[bell] ?? 0, astern = bell.startsWith('back');
        const rev = bell === 'stop' ? ctl[`man.reverse.${side}`] : astern ? 'astern' : 'ahead';
        if (ctl[`man.reverse.${side}`] !== rev) {
          // the reverse lever only moves with the field down
          for (const n of gens) if ((+ctl[`man.genField.${n}`] || 0) > 0.02 && ctl[`man.gen.${n}`] === 'motorBus') m.job(`man.genField.${n}`, 0);
          m.job(`man.reverse.${side}`, rev);
          continue;
        }
        if (ctl[`man.starter.${side}`] !== 'par2' && bell !== 'stop') { m.job(`man.starter.${side}`, 'par2'); continue; }
        for (const n of gens) {
          if (ctl[`man.gen.${n}`] !== 'motorBus') continue;
          // never past the generator's rating (2,650 amperes): he watches its ammeter and holds the field down
          const I = g.amps?.gen?.[n - 1] ?? 0, cur = +ctl[`man.genField.${n}`] || 0;
          if (I > 2700) this.fieldCap[n] = Math.max(0, cur - 0.025);
          else if (I < 2300) this.fieldCap[n] = Math.min(1, this.fieldCap[n] + 0.004);
          const want = Math.min(f, this.fieldCap[n]);
          if (Math.abs(cur - want) > 0.012) m.job(`man.genField.${n}`, want);
        }
        if (!m.busy) nudgeCharge();
        continue;
      }
      if (!m.busy) nudgeCharge();
      // on the battery
      const B = BATTERY_BELLS[bell] ?? BATTERY_BELLS.stop;
      const rev = B.starter === 'stop' ? ctl[`man.reverse.${side}`] : B.astern ? 'astern' : 'ahead';
      const starter = ctl[`man.starter.${side}`];
      if (ctl[`man.reverse.${side}`] !== rev) {
        // interlock: the reverse lever moves only with the starter at STOP
        if (starter !== 'stop') { m.job(`man.starter.${side}`, 'stop'); continue; }
        m.job(`man.reverse.${side}`, rev);
        continue;
      }
      if (starter !== B.starter) {
        // series before parallel: through SER 1, 2, 3, then PAR 1, PAR 2, a notch at a time
        const order = ['stop', 'ser1', 'ser2', 'ser3', 'par1', 'par2'];
        const i = order.indexOf(starter), k = order.indexOf(B.starter);
        // into parallel from series: back to STOP and up through PAR (the transition)
        const next = k > i ? order[i + 1] : order[i - 1];
        m.job(`man.starter.${side}`, next, { after: 0.6 });
        continue;
      }
      if (B.field != null && Math.abs((+ctl[`man.motorField.${side}`] || 0) - B.field) > 0.02) m.job(`man.motorField.${side}`, B.field);
    }
  }
}

/** Where a man stands to work a control: in front of it, on the deck (the passage's breadth). */
function standAt(c) {
  if (c.kind === 'hatch') return [c.pos[0] + 0.35, c.pos[2]];
  if (c.normal) {
    const n = Math.hypot(c.normal[0], c.normal[2]) || 1;
    return [c.pos[0] + (c.normal[0] / n) * 0.5, Math.max(-1.0, Math.min(1.0, c.pos[2] + (c.normal[2] / n) * 0.55))];
  }
  const off = { port: [0, 0.5], stbd: [0, -0.5], fwd: [-0.5, 0], aft: [0.5, 0] }[c.face] ?? [0, 0];
  return [c.pos[0] + off[0], Math.max(-1.0, Math.min(1.0, c.pos[2] + off[1]))];
}

export { BELLS, BATTERY_BELLS, DIESEL_BELLS };
void LONG_TON;
