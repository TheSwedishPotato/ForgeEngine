// Air traffic control and the other traffic. The controllers pick the runways from the wind you set
// (the runway with the most headwind; at Arlanda 19R/01L with arrivals on the parallel, at Kastrup
// 22L/04L for landing and the parallel for departures) and work every flight on their frequency,
// ours and the others alike. Nothing is timed: a pushback is approved when the taxilane behind the
// stand is clear and the departure queue is short enough (A-CDM), take-off when the aircraft ahead is
// airborne and far enough away, a landing when the runway is free; otherwise it is "stand by", "hold
// position" or "go around". Each frequency carries one voice at a time, so a busy controller answers
// later, and the radio log only has what is said on the frequency the crew is listening to.
//
// Units and frequencies (MHz): Arlanda Ground 121.705 (push-back and taxi), Arlanda Tower 118.500
// (runway 01L/19R), Stockholm Control 123.750, Sweden Control 134.980 (sector L, Malmö), Copenhagen
// Approach 119.805, Kastrup Tower 118.105, Kastrup Apron 121.630. Transition altitude 5000 ft.
import { DEG, KT, FT, clamp, lerp, rng } from './core.js';
import { windComponents } from './weather.js';
import { runwayInfo } from './flight.js';
import { ARN, ARN_LAYOUT } from './places.js';
import { Traffic } from './traffic.js';

const NATO = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'niner' };
export const spellNum = (n) => String(n).split('').map((c) => (c === '.' ? 'decimal' : NATO[c] ?? c)).join(' ');
const spellStand = (s) => `${{ F: 'Foxtrot', B: 'Bravo', E: 'Echo' }[s[0]] || s[0]} ${spellNum(s.slice(1))}`;
export const spellRwy = (id) => `${spellNum(id.replace(/[LRC]/, ''))}${id.endsWith('L') ? ' left' : id.endsWith('R') ? ' right' : id.endsWith('C') ? ' centre' : ''}`;
const CALL = 'Scandinavian one four one five';
const CALL_SHORT = 'Scandinavian one five';

export const UNITS = {
  'Arlanda Ground': '121.705', 'Arlanda Tower': '118.500', 'Stockholm Control': '123.750', 'Sweden Control': '134.980',
  'Copenhagen Approach': '119.805', 'Kastrup Tower': '118.105', 'Kastrup Apron': '121.630',
};
// how a frequency is spoken: trailing zeros dropped after the decimal
const spellFreq = (f) => spellNum(f.replace(/0+$/, '').replace(/\.$/, ''));
export const FREQ = { arnGround: UNITS['Arlanda Ground'], arnTower: UNITS['Arlanda Tower'], cphApproach: UNITS['Copenhagen Approach'], cphTower: UNITS['Kastrup Tower'] };

export class ATC {
  constructor(wx, opts = {}) {
    this.wx = wx; this.r = rng(opts.seed ?? Math.floor(Math.random() * 1e9)); this.t = 0;
    this.mode = opts.events || 'realistic';
    this.msgs = []; this.queue = []; this.listeners = []; this.chan = {};
    this.unit = 'Arlanda Ground';
    this.depRwy = this.selectRunway('ARN');
    this.arrRwy = this.selectRunway('CPH');
    this.arrApt = 'CPH';
    this.cl = { push: false, taxi: false, lineup: false, takeoff: false, altFt: 0, approach: false, landing: false, vacated: false, taxiIn: false, spd: null, descent: false };
    this.traffic = [];
    // a transponder code from the departure clearance (never 2000, 7500, 7600 or 7700)
    this.squawk = String(1000 + Math.floor(this.r() * 4000)).split('').map((c) => String(Math.min(7, +c))).join('');
    this.pushQ = []; this.taxiQ = []; this.depQ = []; this.ldgQ = [];
    this._tick = 0;
  }

  // The flights around us, from the timetable, once the route (runways, stands) is known
  initTraffic(route, startClock, depTime = 6) { this.tf = new Traffic(this, route, startClock, this.r, depTime); this.traffic = this.tf.list; this.startClock = startClock; this.tobt = depTime; this.tsat = depTime; }
  // local time (hours) and the A-CDM start-up window: start-up and push-back are requested within TSAT ±5 min
  // (Swedavia Arlanda A-CDM); TOBT is the scheduled off-block time, or later if the aircraft is not ready
  clockH() { return (this.startClock ?? 0) + this.t / 3600; }
  inTsatWindow() { return this.tsat == null || Math.abs(this.clockH() - this.tsat) <= 5 / 60; }

  on(fn) { this.listeners.push(fn); }
  // A transmission: who, text, the earliest time from now, what happens when it has been said, and
  // on which frequency. Transmissions on one frequency never overlap.
  say(who, text, delay = 0, fn = null, unit = this.unit) {
    if (!text) { this.queue.push({ at: this.t + delay, fn, silent: true }); return; }
    const words = text.split(/\s+/).length;
    this.queue.push({ at: this.t + delay, who, text, fn, unit, dur: words / 2.7 + 0.5 });
  }
  _emit(m) { this.msgs.push(m); if (this.msgs.length > 200) this.msgs.shift(); for (const f of this.listeners) f(m); }
  // a controller's or a pilot's reaction time before they key the microphone
  resp(mean = 2.5) { return this.r.human(mean, 0.45); }

  // ---------- runway selection from the wind ----------
  selectRunway(apt) {
    const st = apt === 'ARN' ? this.wx.s.arn : this.wx.s.cph;
    const pairs = apt === 'ARN' ? [['19R', 188.2], ['01L', 8.2]] : [['22L', 223.4], ['04L', 43.4]];
    const pref = pairs[0][0];
    let best = null;
    for (const [id, hdg] of pairs) {
      const c = windComponents(st.wdir, st.wspd, hdg);
      const gustTail = windComponents(st.wdir, Math.max(st.gust, st.wspd), hdg).head;
      const score = c.head + (id === pref ? 1.5 : 0) + Math.min(0, gustTail + 5) * 0.2;
      if (!best || score > best.score) best = { id, score, head: c.head, cross: c.cross };
    }
    return best.id;
  }
  reviewArrivalRunway(distToGo) {
    if (distToGo < 90000 || this.cl.approach) return null;
    const r = this.selectRunway('CPH');
    if (r !== this.arrRwy) { this.arrRwy = r; return r; }
    return null;
  }
  windReport(apt) {
    const st = apt === 'ARN' ? this.wx.s.arn : this.wx.s.cph;
    if (st.wspd < 1) return 'wind calm';
    const dir = Math.round(st.wdir / 10) * 10 || 360, spd = Math.round(st.wspd), g = Math.round(st.gust);
    return `wind ${spellNum(String(dir).padStart(3, '0'))} degrees ${spellNum(spd)} knots${g >= spd + 10 ? ` gusting ${spellNum(g)}` : ''}`;
  }
  qnh(apt) { return Math.round(apt === 'ARN' ? this.wx.s.arn.qnh : this.wx.s.cph.qnh); }

  // ---------- per step ----------
  update(dt, fm, crew) {
    this.t += dt; this.fm = fm; this.crew = crew;
    if (this.tf) this.tf.update(dt, fm, this.t);
    // one voice at a time on each frequency
    for (let i = 0; i < this.queue.length; i++) {
      const m = this.queue[i];
      if (m.at > this.t) continue;
      if (m.silent) { this.queue.splice(i--, 1); if (m.fn) m.fn(); continue; }
      const ch = this.chan[m.unit] || (this.chan[m.unit] = { busy: 0 });
      if (this.t < ch.busy) continue;
      this.queue.splice(i--, 1);
      ch.busy = this.t + m.dur + 0.4 + this.r() * 0.9;
      if (m.unit === this.unit || m.who === 'SK1415') this._emit({ t: this.t, who: m.who, text: m.text, unit: m.unit });
      if (m.fn) this.queue.push({ at: this.t + m.dur, fn: m.fn, silent: true });
    }
    this._tick -= dt;
    if (this._tick <= 0) { this._tick = 1; this._controllers(fm, crew); }
  }

  // ---------- the controllers' decisions, once a second ----------
  _controllers(fm, crew) {
    this._ground(fm, crew); this._tower(fm, crew); this._radar(fm, crew); this._kastrup(fm, crew);
  }
  _arnUV(x, z) { const f = ARN.frame, dx = x - f.o.x, dz = z - f.o.y; return [dx * f.u.x + dz * f.u.y, dx * f.v.x + dz * f.v.y]; }
  _departing() { // departures already moving towards the runway (the A-CDM queue)
    let n = 0; for (const a of this.traffic) if (a.apt === 'ARN' && ['pushback', 'starting', 'wait-taxi', 'taxi', 'holding', 'lineup'].includes(a.state)) n++;
    return n;
  }
  // Arlanda Ground: pushbacks one at a time on the pier F taxilane, not while someone taxis past
  // behind the stand, and only when the runway queue can take another departure
  _ground(fm, crew) {
    const q = this.pushQ;
    if (q.length && !this._pushBusy) {
      const req = q[0];
      const standV = req.own ? ARN_LAYOUT.gateStand.v : req.a.standV;
      // the taxilane behind the stand must be free: nobody pushing, or out there starting engines or
      // waiting to taxi, within a couple of stands either side (A-CDM: one push at a time per lane)
      const onLane = (v) => Math.abs(v - standV) < 130;
      const pushing = this.traffic.some((a) => a !== req.a && a.apt === 'ARN' && (['pushback', 'starting', 'wait-taxi'].includes(a.state) || (a.pushCleared && a.state === 'ready-push')) && a.standV != null && onLane(a.standV))
        || (!req.own && !fm.airport && (['pushback', 'parked'].includes(fm.phase) || ((this.cl.push || this.cl.pushPending) && fm.phase === 'boarding')) && onLane(ARN_LAYOUT.gateStand.v))
        || (!req.own && fm.tug && fm.tug.state === 'push');
      let passing = false;
      for (const a of this.traffic) { if (a === req.a || a.x == null || a.state !== 'taxi') continue; const [u, v] = this._arnUV(a.x, a.z); if (u > 1540 && u < 1640 && Math.abs(v - standV) < 160) passing = true; }
      if (!req.own && fm.onGround && !fm.airport && ['taxi-out'].includes(fm.phase)) { const [u, v] = this._arnUV(fm.pos.x, fm.pos.z); if (u > 1540 && u < 1640 && Math.abs(v - standV) < 160) passing = true; }
      const queueOk = this._departing() < 5;
      if (!pushing && !passing && queueOk) {
        q.shift(); this._pushBusy = true;
        if (!req.own) req.a.pushCleared = true; else this.cl.pushPending = true;
        const tel = req.own ? CALL : req.a.tel;
        this.say('ATC', `${tel}, push-back and start-up approved, facing west${req.own ? `, QNH ${spellNum(this.qnh('ARN'))}` : ''}.`, this.resp(), () => {
          this._pushBusy = false;
          if (req.own) crew.readback(`Push-back and start-up approved, facing west${`, QNH ${spellNum(this.qnh('ARN'))}`}, ${CALL_SHORT}.`, () => { this.cl.push = true; });
          else { this.say(req.a.flt, `Push and start approved, ${req.a.tel}.`, this.resp(1.5), () => { req.a.state = req.a.push ? 'pushback' : 'starting'; req.a.startT = req.a.startT ?? this.r.human(60, 0.3); }, 'Arlanda Ground'); }
        }, 'Arlanda Ground');
      } else if (!req.standbySaid) {
        req.standbySaid = true;
        const why = passing ? 'traffic passing behind' : pushing ? 'traffic on the taxilane behind you' : 'the departure queue is full';
        this.say('ATC', `${req.own ? CALL : req.a.tel}, stand by, ${why}.`, this.resp(), null, 'Arlanda Ground');
      }
    }
    const tq = this.taxiQ;
    if (tq.length && !this._taxiBusy) {
      const req = tq.shift(); this._taxiBusy = true;
      const rw = spellRwy(this.depRwy);
      // name the aircraft to follow if someone is already taxiing out ahead
      const ahead = this.traffic.filter((a) => a.apt === 'ARN' && a.kind === 'dep' && ['taxi', 'holding', 'lineup'].includes(a.state) && a !== req.a);
      const follow = ahead.length ? `, follow the ${ahead[ahead.length - 1].al === 'sas' ? 'SAS' : ahead[ahead.length - 1].T.name.split(' ')[0]}` : '';
      const tel = req.own ? CALL : req.a.tel;
      this.say('ATC', `${tel}, taxi to holding point runway ${rw}${follow}.`, this.resp(), () => {
        this._taxiBusy = false;
        if (req.own) crew.readback(`Taxi to holding point runway ${rw}${follow}, ${CALL_SHORT}.`, () => { this.cl.taxi = true; });
        else this.say(req.a.flt, `Holding point ${rw}, ${req.a.tel}.`, this.resp(1.5), () => { req.a.state = 'taxi'; req.a.s = 0; req.a._place(); }, 'Arlanda Ground');
      }, 'Arlanda Ground');
    }
  }
  // Arlanda Tower: departures in the order they reported ready; line up when the runway is free of
  // everything but the one rolling ahead, take off when that one is airborne and 3 NM away (or two
  // minutes on the same route); arrivals on the parallel land when their runway is free
  _tower(fm, crew) {
    const rw = this.depRwy, R = runwayInfo('ESSA', rw);
    const occ = this.tf ? this.tf.runwayOccupants('ARN', rw) : [];
    const ownOnRwy = !fm.airport && ['lineup', 'takeoff'].includes(fm.phase) || (fm.phase === 'climb' && fm.agl < 150);
    const dq = this.depQ;
    if (dq.length) {
      const req = dq[0];
      const prev = this._lastDep;
      const prevRolling = prev && !prev.airborneFar && (prev.own ? fm.phase === 'takeoff' : prev.a.state === 'takeoff');
      const others = occ.filter((a) => a !== req.a && !a.cleared.takeoff).length + (ownOnRwy && !req.own && !(prev && prev.own) ? 1 : 0);
      // separation from the departure ahead
      let sepOk = true;
      if (prev) {
        const p = prev.own ? { airborne: !fm.onGround, x: fm.pos.x, z: fm.pos.z } : prev.a;
        const dist = p.x != null ? Math.hypot(p.x - R.thr.x, p.z - R.thr.y) : 1e9;
        sepOk = (p.airborne && dist > 3 * 1852 + R.len) || (this.t - prev.rollT > 120) || p.state === 'gone';
      }
      if (!req.lineup && others === 0 && (!prev || prevRolling || sepOk)) {
        req.lineup = true;
        const tel = req.own ? CALL : req.a.tel;
        this.say('ATC', `${tel}, line up and wait runway ${spellRwy(rw)}.`, this.resp(), () => {
          if (req.own) crew.readback(`Line up and wait runway ${spellRwy(rw)}, ${CALL_SHORT}.`, () => { this.cl.lineup = true; });
          else this.say(req.a.flt, `Lining up ${spellRwy(rw)}, ${req.a.tel}.`, this.resp(1.5), () => { req.a.state = 'lineup'; req.a.cleared.lineup = true; }, 'Arlanda Tower');
        }, 'Arlanda Tower');
      } else if (!req.lineup && !req.holdSaid && dq.length > 0) {
        req.holdSaid = true;
        const tel = req.own ? CALL : req.a.tel;
        const pos = dq.indexOf(req) + 1 + (prev && prevRolling ? 1 : 0);
        this.say('ATC', `${tel}, hold position, ${pos > 1 ? `number ${spellNum(pos)} for departure` : 'traffic on the runway'}.`, this.resp(), () => { if (req.own) crew.readback(`Holding position, ${CALL_SHORT}.`); }, 'Arlanda Tower');
      }
      const ready = req.own ? crew.readyForTakeoff() && this.cl.lineup : req.a.state === 'lineup' && req.a.s > req.a.lineS - 30;
      if (req.lineup && ready && sepOk && !req.toSaid && occ.filter((a) => a !== req.a).length === 0) {
        req.toSaid = true;
        const tel = req.own ? CALL : req.a.tel;
        this.say('ATC', `${tel}, ${this.windReport('ARN')}, runway ${spellRwy(rw)}, cleared for take-off.`, this.resp(2), () => {
          dq.shift(); req.rollT = this.t; this._lastDep = req;
          if (req.own) crew.readback(`Cleared for take-off runway ${spellRwy(rw)}, ${CALL_SHORT}.`, () => { this.cl.takeoff = true; });
          else this.say(req.a.flt, `Cleared for take-off ${spellRwy(rw)}, ${req.a.tel}.`, this.resp(1.5), () => { req.a.cleared.takeoff = true; }, 'Arlanda Tower');
        }, 'Arlanda Tower');
      }
    }
    // the parallel runway's arrivals
    for (const a of this.traffic) {
      if (a.apt !== 'ARN' || a.kind !== 'arr' || a.unit !== 'Arlanda Tower' || a.cleared.landing || !a.towerCalled) continue;
      const busy = this.tf.runwayOccupants('ARN', a.rwy).filter((o) => o !== a).length;
      if (!busy && !a.ldgSaid) { a.ldgSaid = true; this.say('ATC', `${a.tel}, runway ${spellRwy(a.rwy)}, cleared to land, ${this.windReport('ARN')}.`, this.resp(), () => this.say(a.flt, `Cleared to land ${spellRwy(a.rwy)}, ${a.tel}.`, this.resp(1.5), () => { a.cleared.landing = true; }, 'Arlanda Tower'), 'Arlanda Tower'); }
    }
    // our own hand-off to departure control once airborne
    if (!fm.onGround && !fm.airport && this.unit === 'Arlanda Tower' && fm.agl > 200 && !this._toStockholm) {
      this._toStockholm = true;
      this.say('ATC', `${CALL}, contact Stockholm Control ${spellFreq(UNITS['Stockholm Control'])}, good bye.`, this.resp(3), () => crew.readback(`Stockholm Control ${spellFreq(UNITS['Stockholm Control'])}, ${CALL_SHORT}, good bye.`), 'Arlanda Tower');
      this.say(null, null, 8, () => { this.unit = 'Stockholm Control'; });
    }
  }
  // Stockholm, Sweden and Copenhagen radar: hand-offs as we climb out, cross Sweden and near Kastrup;
  // on the Kastrup arrival the aircraft behind are slowed to keep at least 4 NM
  _radar(fm, crew) {
    const altFt = fm.altInd / FT;
    if (this.unit === 'Stockholm Control' && !fm.onGround && (altFt > 14500 || (this.cl.altFt >= 20000 && altFt > 11000)) && !this._toSweden) {
      this._toSweden = true;
      this.say('ATC', `${CALL}, contact Sweden Control ${spellFreq(UNITS['Sweden Control'])}.`, this.resp(), () => {
        crew.readback(`Sweden Control ${spellFreq(UNITS['Sweden Control'])}, ${CALL_SHORT}.`);
        this.say(null, null, 6, () => { this.unit = 'Sweden Control'; this.say('SK1415', `Sweden Control, ${CALL}, passing flight level ${spellNum(Math.round(fm.altInd / FT / 1000) * 10)}, climbing flight level ${spellNum(Math.round((this.cl.altFt || 36000) / 100))}.`, this.resp(2), () => this.say('ATC', `${CALL}, Sweden Control, radar contact.`, this.resp(), null, 'Sweden Control'), 'Sweden Control'); });
      }, 'Stockholm Control');
    }
    const d2td = fm.m.touchdown - fm.s;
    if (this.unit === 'Sweden Control' && !fm.onGround && !fm.airport && d2td < 110000 && this.cl.descent && !this._toCph) {
      this._toCph = true;
      this.say('ATC', `${CALL}, contact Copenhagen Approach ${spellFreq(UNITS['Copenhagen Approach'])}.`, this.resp(), () => {
        crew.readback(`Copenhagen Approach ${spellFreq(UNITS['Copenhagen Approach'])}, ${CALL_SHORT}.`);
        this.say(null, null, 6, () => { this.unit = 'Copenhagen Approach'; this.say('SK1415', `Copenhagen Approach, ${CALL}, descending flight level ${spellNum(Math.max(50, Math.round((this.cl.altFt || 10000) / 1000) * 10))}.`, this.resp(2), () => this.say('ATC', `${CALL}, Copenhagen Approach, radar contact, expect ILS runway ${spellRwy(this.arrRwy)}.`, this.resp(), null, 'Copenhagen Approach'), 'Copenhagen Approach'); });
      }, 'Sweden Control');
    }
    // sequencing on the Kastrup arrival: aircraft in distance order to the threshold
    if (!this.tf) return;
    const seq = [];
    for (const a of this.traffic) if (a.apt === 'CPH' && a.kind === 'arr' && ['arrival', 'final'].includes(a.state)) seq.push({ a, d: a.thrS - a.s, v: a.v });
    if (!fm.onGround && !fm.airport && d2td < 90000) seq.push({ own: true, d: d2td, v: fm.gs });
    seq.sort((p, q) => p.d - q.d);
    for (let i = 1; i < seq.length; i++) {
      const lead = seq[i - 1], f = seq[i], gap = f.d - lead.d;
      if (gap < 4.5 * 1852) {
        if (f.own) { if (!this._slowSaid && d2td > 12000) { this._slowSaid = true; this.call('speed', crew, { kt: 160, until: 'four miles' }); } }
        else if (!f.a.spdPending) {
          // the next standard speed at least 10 kt below the one ahead (controllers use round figures)
          const leadIas = lead.own ? fm.ias : lead.a.v / KT * Math.sqrt(Math.pow(Math.max(0.2, 1 - 2.2558e-5 * lead.a.h), 4.2559));
          const want = [250, 220, 210, 200, 190, 180, 170, 160].find((k) => k <= leadIas - 10) ?? 160;
          const kt = Math.max(want, Math.ceil((f.a.T.vapp + 20) / 10) * 10);
          if (kt <= (f.a.spdLimit ?? 999) - 10) {
            const a = f.a; a.spdPending = true;
            this.say('ATC', `${a.tel}, reduce speed ${spellNum(kt)} knots.`, this.resp(), () => this.say(a.flt, `Speed ${spellNum(kt)}, ${a.tel}.`, this.resp(1.5), () => { a.spdLimit = kt; a.spdPending = false; }, 'Copenhagen Approach'), 'Copenhagen Approach');
          }
        }
      }
    }
  }
  // Kastrup Tower: landing clearances on 22L when the runway is free; departures from the parallel
  _kastrup(fm, crew) {
    if (!this.tf) return;
    for (const a of this.traffic) {
      if (a.apt !== 'CPH' || a.kind !== 'arr' || a.unit !== 'Kastrup Tower' || a.cleared.landing || !a.towerCalled) continue;
      const busy = this.tf.runwayOccupants('CPH', a.rwy).filter((o) => o !== a).length + (this._ownOnRunway(fm) ? 1 : 0);
      if (!busy && !a.ldgSaid) { a.ldgSaid = true; this.say('ATC', `${a.tel}, runway ${spellRwy(a.rwy)}, cleared to land, ${this.windReport('CPH')}.`, this.resp(), () => this.say(a.flt, `Cleared to land ${spellRwy(a.rwy)}, ${a.tel}.`, this.resp(1.5), () => { a.cleared.landing = true; }, 'Kastrup Tower'), 'Kastrup Tower'); }
      if (busy && a.ldgSaid && !a.cleared.landing) a.ldgSaid = false;
    }
    // Kastrup departures: taxi requests go straight to a taxi clearance; line-up and take-off like Arlanda's
    for (const a of this.traffic) {
      if (a.apt !== 'CPH' || a.kind !== 'dep') continue;
      if (a.state === 'holding' && !a.cleared.lineup && !a.luSaid) {
        const occ = this.tf.runwayOccupants('CPH', a.rwy).filter((o) => o !== a).length;
        const prevOk = !this._cphLastDep || this._cphLastDep.airborne && Math.hypot(this._cphLastDep.x - a.rwyInfo.thr.x, this._cphLastDep.z - a.rwyInfo.thr.y) > a.rwyInfo.len + 3 * 1852 || this._cphLastDep.state === 'gone';
        if (!occ && prevOk) { a.luSaid = true; this.say('ATC', `${a.tel}, ${this.windReport('CPH')}, runway ${spellRwy(a.rwy)}, cleared for take-off.`, this.resp(), () => this.say(a.flt, `Cleared for take-off ${spellRwy(a.rwy)}, ${a.tel}.`, this.resp(1.5), () => { a.cleared.lineup = true; a.cleared.takeoff = true; a.state = 'lineup'; this._cphLastDep = a; }, 'Kastrup Tower'), 'Kastrup Tower'); }
      }
    }
  }
  _ownOnRunway(fm) { return fm.airport !== 'ARN' && (['flare', 'rollout'].includes(fm.phase) || (fm.phase === 'taxi-in' && !this.cl.vacated)); }

  // ---------- the other flights' calls ----------
  trafficCall(a, kind) {
    const r = this.resp.bind(this);
    switch (kind) {
      case 'startup': {
        a.unit = a.apt === 'ARN' ? 'Arlanda Ground' : 'Kastrup Apron';
        const stand = a.apt === 'ARN' ? `stand Foxtrot ${spellNum(30 + TRAFFIC_STAND_NO(a.standV))}` : 'stand Charlie two';
        this.say(a.flt, `${a.unit}, ${a.tel}, ${stand}, request push and start.`, r(3), () => { if (a.apt === 'ARN') this.pushQ.push({ a }); else this.say('ATC', `${a.tel}, start-up approved.`, r(), () => { a.state = 'starting'; a.startT = this.r.human(90, 0.3); }, a.unit); }, a.unit);
        break;
      }
      case 'taxi':
        this.say(a.flt, `${a.unit}, ${a.tel}, request taxi.`, r(3), () => {
          if (a.apt === 'ARN') this.taxiQ.push({ a });
          else this.say('ATC', `${a.tel}, taxi to holding point runway ${spellRwy(a.rwy)}.`, r(), () => this.say(a.flt, `Holding point ${spellRwy(a.rwy)}, ${a.tel}.`, r(1.5), () => { a.state = 'taxi'; a.s = 0; a._place(); }, a.unit), a.unit);
        }, a.unit);
        break;
      case 'ready':
        if (a.apt === 'ARN') { a.unit = 'Arlanda Tower'; this.say(a.flt, `Arlanda Tower, ${a.tel}, holding point runway ${spellRwy(a.rwy)}, ready.`, r(4), () => this.depQ.push({ a }), a.unit); }
        else { a.unit = 'Kastrup Tower'; this.say(a.flt, `Kastrup Tower, ${a.tel}, holding point ${spellRwy(a.rwy)}, ready.`, r(4), null, a.unit); }
        break;
      case 'airborne': {
        const from = a.unit, next = a.apt === 'ARN' ? 'Stockholm Control' : 'Copenhagen Approach';
        this.say('ATC', `${a.tel}, contact ${next === 'Stockholm Control' ? 'Stockholm Control' : 'Copenhagen Departure'} ${spellFreq(UNITS[next])}, good bye.`, r(4), () => this.say(a.flt, `${spellFreq(UNITS[next])}, ${a.tel}, good bye.`, r(1.5), () => {
          a.unit = next;
          this.say(a.flt, `${next}, ${a.tel}, passing ${spellNum(Math.round(a.h / FT / 100) * 100)} feet, climbing altitude five thousand feet.`, r(5), () => this.say('ATC', `${a.tel}, radar contact, climb flight level one hundred.`, r(), () => this.say(a.flt, `Climb flight level one hundred, ${a.tel}.`, r(1.5), null, next), next), next);
        }, from), from);
        break;
      }
      case 'checkin': {
        a.unit = a.kind === 'enroute' ? 'Sweden Control' : a.apt === 'ARN' ? 'Stockholm Control' : 'Copenhagen Approach';
        const lvl = a.h / FT > 5500 ? `flight level ${spellNum(Math.round(a.h / FT / 1000) * 10)}` : `${spellNum(Math.round(a.h / FT / 100) * 100)} feet`;
        const what = a.kind === 'enroute' ? `climbing flight level ${spellNum(a.fl)}` : `descending, ${lvl}`;
        this.say(a.flt, `${a.unit}, ${a.tel}, ${a.kind === 'enroute' ? lvl + ', ' : ''}${what}.`, r(4), () => {
          const apt = a.apt, rw = a.rwy;
          const reply = a.kind === 'enroute' ? `${a.tel}, radar contact, climb flight level ${spellNum(a.fl)}.` : `${a.tel}, radar contact, descend altitude four thousand feet, QNH ${spellNum(this.qnh(apt))}, expect ILS runway ${spellRwy(rw)}.`;
          this.say('ATC', reply, r(), () => this.say(a.flt, a.kind === 'enroute' ? `Flight level ${spellNum(a.fl)}, ${a.tel}.` : `Four thousand feet, QNH ${spellNum(this.qnh(apt))}, ${a.tel}.`, r(1.5), null, a.unit), a.unit);
        }, a.unit);
        break;
      }
      case 'tower': {
        const from = a.unit, twr = a.apt === 'ARN' ? 'Arlanda Tower' : 'Kastrup Tower';
        this.say('ATC', `${a.tel}, cleared ILS runway ${spellRwy(a.rwy)}, contact ${twr} ${spellFreq(twr === 'Arlanda Tower' ? '118.500' : UNITS[twr])}.`, r(), () => this.say(a.flt, `Cleared ILS ${spellRwy(a.rwy)}, ${twr}, ${a.tel}.`, r(1.5), () => {
          a.unit = twr;
          this.say(a.flt, `${twr}, ${a.tel}, established ILS ${spellRwy(a.rwy)}.`, r(5), () => { a.towerCalled = true; }, twr);
        }, from), from);
        break;
      }
      case 'going-around':
        this.say(a.flt, `${a.tel}, going around.`, r(1), () => this.say('ATC', `${a.tel}, roger, climb altitude three thousand feet, contact ${a.apt === 'ARN' ? 'Stockholm Control' : 'Copenhagen Approach'}.`, r(), () => { a.unit = a.apt === 'ARN' ? 'Stockholm Control' : 'Copenhagen Approach'; a.towerCalled = false; a.ldgSaid = false; }, a.unit), a.unit);
        break;
      case 'vacated': {
        const gnd = a.apt === 'ARN' ? 'Arlanda Ground' : 'Kastrup Apron';
        this.say('ATC', `${a.tel}, contact ${gnd === 'Arlanda Ground' ? 'Ground' : 'Apron'} ${spellFreq(UNITS[gnd])}.`, r(3), () => this.say(a.flt, `${spellFreq(UNITS[gnd])}, ${a.tel}.`, r(1.5), () => { a.unit = gnd; }, a.unit), a.unit);
        break;
      }
      default: break;
    }
  }

  // ---------- our flight's calls (the crew call these) ----------
  call(kind, crew, data = {}) {
    const c = this.cl, us = CALL, d = this.resp();
    switch (kind) {
      case 'startup': {
        this.unit = 'Arlanda Ground';
        const f = crew.fm.route.gate;
        this.say('SK1415', `Arlanda Ground, ${us}, stand ${spellStand(f.name)}, request push-back and start-up.`, 0, () => this.pushQ.push({ own: true }));
        break;
      }
      case 'taxi':
        this.unit = 'Arlanda Ground';
        this.say('SK1415', `Arlanda Ground, ${us}, request taxi.`, 0, () => this.taxiQ.push({ own: true }));
        break;
      case 'ready':
        this.unit = 'Arlanda Tower';
        this.say('SK1415', `Arlanda Tower, ${us}, holding point runway ${spellRwy(this.depRwy)}, ready for departure.`, 0, () => this.depQ.push({ own: true }));
        break;
      case 'airborne':
        this.unit = 'Stockholm Control';
        this.say('SK1415', `Stockholm Control, ${us}, passing ${data.alt} feet climbing ${data.cleared}.`, 0);
        this.say('ATC', `${us}, radar contact, climb flight level one hundred.`, d + 3, () => { c.altFt = 10000; crew.onClearance('alt', 10000); crew.readback(`Climb flight level one hundred, ${CALL_SHORT}.`); });
        break;
      case 'climb-high':
        this.say('ATC', `${us}, climb flight level ${spellNum(data.fl)}.`, d, () => { c.altFt = data.fl * 100; crew.onClearance('alt', data.fl * 100); crew.readback(`Climb flight level ${spellNum(data.fl)}, ${CALL_SHORT}.`); });
        break;
      case 'handoff':
        this.say('ATC', `${us}, contact ${data.unit}${data.freq ? ' ' + data.freq : ''}.`, d, () => { crew.readback(`${data.unit}${data.freq ? ' ' + data.freq : ''}, ${CALL_SHORT}.`); this.unit = data.unit; });
        break;
      case 'descent':
        this.say('SK1415', `${this.unit}, ${us}, request descent.`, 0);
        this.say('ATC', `${us}, descend flight level ${spellNum(data.fl)}${data.rwy ? `, expect ILS runway ${spellRwy(data.rwy)}` : ''}.`, d + 3, () => { c.altFt = data.fl * 100; c.descent = true; crew.onClearance('alt', data.fl * 100); crew.readback(`Descend flight level ${spellNum(data.fl)}, ${CALL_SHORT}.`); });
        break;
      case 'descend-alt': {
        const q = this.qnh(this.arrApt);
        this.say('ATC', `${us}, descend altitude ${spellNum(data.ft / 1000)} thousand feet, QNH ${spellNum(q)}.`, d, () => { c.altFt = data.ft; crew.onClearance('alt', data.ft, q); crew.readback(`Descend altitude ${spellNum(data.ft / 1000)} thousand feet, QNH ${spellNum(q)}, ${CALL_SHORT}.`); });
        break;
      }
      case 'speed':
        if (c.spd != null && c.spd <= data.kt) break;
        this.say('ATC', `${us}, reduce speed ${spellNum(data.kt)} knots${data.until ? ` until ${data.until}` : ''}.`, d, () => { c.spd = data.kt; crew.onClearance('spd', data.kt); crew.readback(`Speed ${spellNum(data.kt)}, ${CALL_SHORT}.`); });
        break;
      case 'approach':
        this.say('ATC', `${us}, cleared ILS approach runway ${spellRwy(this.arrRwy)}.`, d, () => { c.approach = true; crew.onClearance('approach', this.arrRwy); crew.readback(`Cleared ILS approach runway ${spellRwy(this.arrRwy)}, ${CALL_SHORT}.`); });
        break;
      case 'tower': {
        const arn = this.arrApt === 'ARN', twr = arn ? 'Arlanda Tower' : 'Kastrup Tower';
        this.say('ATC', `${us}, contact ${twr} ${spellFreq(arn ? '118.500' : UNITS['Kastrup Tower'])}.`, d, () => {
          crew.readback(`Tower ${spellFreq(arn ? '118.500' : UNITS['Kastrup Tower'])}, ${CALL_SHORT}.`);
          this.say(null, null, 3, () => {
            this.unit = twr;
            this.say('SK1415', `${twr}, ${us}, established ILS ${spellRwy(this.arrRwy)}.`, this.resp(2), () => {
              if (arn) this.say('ATC', `${us}, runway ${spellRwy(this.arrRwy)}, cleared to land, ${this.windReport('ARN')}, emergency services are standing by.`, this.resp(), () => { this.cl.landing = true; });
              else if (this.runwayFreeForLanding() && !this._ldgSaid) { this._landingPending = true; this._ldgSaid = true; this.say('ATC', `${us}, Kastrup Tower, runway ${spellRwy(this.arrRwy)}, cleared to land, ${this.windReport('CPH')}.`, this.resp(), () => { this.cl.landing = true; crew.readback(`Cleared to land runway ${spellRwy(this.arrRwy)}, ${CALL_SHORT}.`); }); }
              else { const ahead = this.tf ? this.tf.list.filter((a) => a.apt === this.arrApt && a.rwy === this.arrRwy && ['final', 'flare', 'rollout', 'arrival'].includes(a.state)).length : 0; this.say('ATC', `${us}, Kastrup Tower, continue approach${ahead ? `, number ${spellNum(ahead + 1)}` : ''}, ${this.windReport('CPH')}.`, this.resp(), () => { this._landingPending = true; }); }
            });
          });
        });
        break;
      }
      case 'going-around':
        this.say('SK1415', `${us}, going around.`, 0);
        this.say('ATC', `${us}, roger, climb three thousand feet, fly runway heading, I will vector you back.`, d + 2, () => { crew.onClearance('alt', 3000); crew.readback(`Three thousand feet, runway heading, ${CALL_SHORT}.`); this.cl.landing = false; this._landingPending = false; });
        break;
      case 'mayday': case 'pan':
        this.say('SK1415', `${kind === 'mayday' ? 'Mayday, mayday, mayday' : 'Pan-pan, pan-pan, pan-pan'}, ${us}, ${data.what}, ${data.intent}.`, 0);
        this.say('ATC', `${us}, roger ${kind === 'mayday' ? 'mayday' : 'pan-pan'}, ${data.reply || 'cleared as requested, advise intentions'}.`, d + 4, () => { if (data.onAck) data.onAck(); });
        break;
      case 'vacated': {
        const gnd = this.arrApt === 'ARN' ? 'Arlanda Ground' : 'Kastrup Apron';
        this.say('ATC', `${us}, vacate when able, contact ${gnd === 'Arlanda Ground' ? 'Ground' : 'Apron'} ${spellFreq(UNITS[gnd])}.`, this.resp(1.5), () => { c.vacated = true; crew.readback(`${spellFreq(UNITS[gnd])}, ${CALL_SHORT}.`); this.say(null, null, 4, () => {
          this.unit = gnd;
          this.say('SK1415', `${gnd}, ${us}, runway vacated.`, this.resp(2), () => this.say('ATC', `${us}, taxi to your stand${this.arrApt === 'ARN' ? ' at pier F' : ' at pier B'}.`, this.resp(), () => { c.taxiIn = true; crew.readback(`Taxi to the stand, ${CALL_SHORT}.`); }));
        }); });
        break;
      }
      case 'deviate':
        this.say('SK1415', `${this.unit}, ${us}, request ${data.nm} miles ${data.side} of track due weather.`, 0);
        this.say('ATC', `${us}, ${data.nm > 20 ? 'approved' : 'deviation approved'}, ${data.nm} miles ${data.side} of track, report back on track.`, d + 3, () => { crew.onClearance('offset', data.offsetM); crew.readback(`Approved, ${data.nm} miles ${data.side}, ${CALL_SHORT}.`); });
        break;
      case 'level-change':
        this.say('SK1415', `${this.unit}, ${us}, experiencing ${data.what} turbulence, request flight level ${spellNum(data.fl)}.`, 0);
        this.say('ATC', `${us}, ${data.fl * 100 > (this.cl.altFt || 0) ? 'climb' : 'descend'} flight level ${spellNum(data.fl)}.`, d + 3, () => { c.altFt = data.fl * 100; crew.onClearance('alt', data.fl * 100); crew.readback(`Flight level ${spellNum(data.fl)}, ${CALL_SHORT}.`); });
        break;
      default: break;
    }
  }

  // called every step by the crew while waiting for the next clearance
  poll(fm, crew) {
    const us = CALL;
    // landing clearance at Kastrup once the runway is free; a go-around if it is still occupied close in
    if (this._landingPending && !this.cl.landing && this.runwayFreeForLanding() && !this._ldgSaid) {
      this._ldgSaid = true;
      this.say('ATC', `${us}, runway ${spellRwy(this.arrRwy)}, cleared to land, ${this.windReport('CPH')}.`, this.resp(1.2), () => { this.cl.landing = true; crew.readback(`Cleared to land runway ${spellRwy(this.arrRwy)}, ${CALL_SHORT}.`); });
    }
    const blockedNow = this.t < (this._blockedUntil ?? -1) && this.cl.landing && !fm.airport;
    if ((this._landingPending && !this.cl.landing || blockedNow) && !this.runwayFreeForLanding() && fm.agl < 70 && !fm.onGround && !this._gaSaid) {
      this._gaSaid = true;
      this.say('ATC', `${us}, go around, I say again, go around, runway occupied.`, 0.5, () => crew.goAround('atc'));
    }
  }
  // Something is on the runway (a slow vacating aircraft, a vehicle): no landing clearance, or a
  // go-around if one was already given, until it is clear.
  blockRunway(sec) { this._blockedUntil = this.t + sec; }
  resetLanding() { this._landingPending = false; this._ldgSaid = false; this._gaSaid = false; this.cl.landing = false; }
  divert(apt, rwy) { this.arrApt = apt; this.arrRwy = rwy; this.cl.approach = false; this.cl.landing = true; this._landingPending = false; }
  // Is the runway free for us? Nothing landing, rolling or lined up on it
  runwayFreeForLanding() {
    if (this.t < (this._blockedUntil ?? -1)) return false;
    if (!this.tf) return true;
    return this.tf.runwayOccupants(this.arrApt, this.arrRwy).length === 0;
  }
}

// stand numbers along pier F's west side, from the north
const TRAFFIC_STAND_NO = (v) => 6 + Math.round((-v - 565) / 55) * 2; // our F36 is at v = -565
export { CALL, CALL_SHORT };
