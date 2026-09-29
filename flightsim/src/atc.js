// Air traffic control and the other traffic. The controllers pick the runways from the wind you
// set (the runway with the most headwind; at Arlanda 19R/01L, at Kastrup 22L/04L as the landing
// runway, with the parallel for departures), give the taxi, take-off, climb, descent, approach
// and landing clearances, keep the spacing to the traffic ahead and send a go-around when the
// runway is still occupied. Nothing is timed: a clearance comes when the situation allows it.
//
// Frequencies used: Arlanda Ground 121.705, Arlanda Tower 118.500, Copenhagen Approach 119.800,
// Kastrup Tower 118.100. Transition altitude 5000 ft in Sweden and Denmark.
import { DEG, KT, FT, clamp, lerp, rng } from './core.js';
import { windComponents, STATIONS } from './weather.js';
import { runwayInfo } from './flight.js';

const NATO = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'niner' };
export const spellNum = (n) => String(n).split('').map((c) => NATO[c] ?? c).join(' ');
const spellStand = (s) => `${{ F: 'Foxtrot', B: 'Bravo', E: 'Echo' }[s[0]] || s[0]} ${spellNum(s.slice(1))}`;
export const spellRwy = (id) => `${spellNum(id.replace(/[LRC]/, ''))}${id.endsWith('L') ? ' left' : id.endsWith('R') ? ' right' : id.endsWith('C') ? ' centre' : ''}`;
const CALL = 'Scandinavian one four one five';
const CALL_SHORT = 'Scandinavian one five';

export const FREQ = { arnGround: '121.705', arnTower: '118.500', cphApproach: '119.800', cphTower: '118.100' };

export class ATC {
  constructor(wx, opts = {}) {
    this.wx = wx; this.r = rng(opts.seed ?? 77); this.t = 0;
    this.mode = opts.events || 'realistic';
    this.msgs = []; this.queue = []; this.listeners = [];
    this.unit = 'Arlanda Ground';
    this.depRwy = this.selectRunway('ARN');
    this.arrRwy = this.selectRunway('CPH');
    this.cl = { push: false, taxi: false, lineup: false, takeoff: false, altFt: 0, approach: false, landing: false, vacated: false, taxiIn: false, spd: null, descent: false };
    this.traffic = [];
    this._makeTraffic();
  }

  on(fn) { this.listeners.push(fn); }
  // a radio call: who is speaking, text; `fn` runs when it has been said (the clearance takes effect)
  say(who, text, delay = 0, fn = null, unit = this.unit) { this.queue.push({ at: this.t + delay, who, text, fn, unit }); }
  _emit(m) { this.msgs.push(m); if (this.msgs.length > 200) this.msgs.shift(); for (const f of this.listeners) f(m); }

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
  // Runway change at the destination while we are still far out
  reviewArrivalRunway(distToGo) {
    if (distToGo < 90000 || this.cl.approach) return null;
    const r = this.selectRunway('CPH');
    if (r !== this.arrRwy) { this.arrRwy = r; return r; }
    return null;
  }
  windReport(apt, rwy) {
    const st = apt === 'ARN' ? this.wx.s.arn : this.wx.s.cph;
    if (st.wspd < 1) return 'wind calm';
    const dir = Math.round(st.wdir / 10) * 10 || 360, spd = Math.round(st.wspd), g = Math.round(st.gust);
    return `wind ${spellNum(String(dir).padStart(3, '0'))} degrees ${spellNum(spd)} knots${g >= spd + 10 ? ` gusting ${spellNum(g)}` : ''}`;
  }

  // ---------- traffic ----------
  _makeTraffic() {
    const r = this.r;
    const eventful = this.mode === 'eventful' ? 1 : this.mode === 'chaos' ? 2 : 0;
    // the departure ahead of us at Arlanda
    this.traffic.push({ id: 'arn-dep', kind: 'dep', apt: 'ARN', rwy: this.depRwy, state: 'waiting', t0: null, livery: 'norwegian', vis: false });
    // an arrival on the parallel runway at Arlanda
    this.traffic.push({ id: 'arn-arr', kind: 'arr-parallel', apt: 'ARN', rwy: this.depRwy === '19R' ? '19L' : '01R', state: 'far', t0: 150 + r() * 120, livery: 'sas', vis: false });
    // the arrival ahead of us at Kastrup: spacing 5-8 km, runway occupancy about 50 s with a long tail
    // spacing on final ~3.7-5 NM; runway occupancy ~50 s with a long tail (a slow exit now and then)
    const sep = lerp(6800, 9300, r()) - eventful * 1400;
    const rotMed = 46 + r() * 8, rot = rotMed * Math.exp(0.13 * (eventful ? 2.4 : 1) * gaussish(r));
    this.traffic.push({ id: 'cph-arr', kind: 'arr-ahead', apt: 'CPH', sep, rot, state: 'far', livery: 'lufthansa', vis: false });
    // departures from the other runway at Kastrup
    this.traffic.push({ id: 'cph-dep', kind: 'dep-other', apt: 'CPH', state: 'waiting', t0: null, livery: 'klm', vis: false });
    // opposite-direction traffic 1000 ft above in cruise
    this.traffic.push({ id: 'cruise', kind: 'crossing', state: 'far', t0: null, livery: 'finnair', vis: false });
  }
  tr(id) { return this.traffic.find((x) => x.id === id); }

  // ---------- per frame ----------
  update(dt, fm, crew) {
    this.t += dt;
    for (let i = 0; i < this.queue.length; i++) {
      const m = this.queue[i];
      if (m.at <= this.t) { this.queue.splice(i--, 1); if (m.text) this._emit({ t: this.t, who: m.who, text: m.text, unit: m.unit }); if (m.fn) m.fn(); }
    }
    this._trafficUpdate(dt, fm);
  }

  // Positions of the other aircraft (world x, y, z, heading) for the renderer and for the rules.
  _trafficUpdate(dt, fm) {
    const t = this.t;
    const dep = this.tr('arn-dep');
    const R = runwayInfo('ESSA', this.depRwy);
    if (dep.state === 'waiting') { const p = R.frame.to(40, 0); Object.assign(dep, { x: p.x, y: 0, z: p.y, hdg: R.hdg, pitch: 0, vis: fm.phase === 'taxi-out' || fm.phase === 'hold' || fm.phase === 'parked' }); }
    if (dep.state === 'rolling') {
      const tt = t - dep.t0;
      const s = 0.5 * 2.0 * Math.min(tt, 36) ** 2 + (tt > 36 ? 72 * (tt - 36) : 0);
      const air = Math.max(0, s - 1500);
      const p = R.frame.to(40 + s, 0);
      Object.assign(dep, { x: p.x, y: air > 0 ? Math.min(air * 0.14, 2000) : 0, z: p.y, hdg: R.hdg, pitch: air > 0 ? Math.min(0.26, air / 700) : 0, vis: tt < 150 });
      dep.airborne = air > 0; dep.dist = s;
      if (tt > 150) dep.state = 'gone';
    }
    const arr = this.tr('arn-arr');
    { const Rp = runwayInfo('ESSA', arr.rwy); const tt = t - arr.t0;
      if (tt < -60 || tt > 60) arr.vis = false;
      else { const s = tt < 0 ? tt * 72 : 72 * tt - 1.1 * tt * tt; const p = Rp.frame.to(Math.max(s, -9000) + 350, 0); Object.assign(arr, { x: p.x, y: tt < 0 ? -s * Math.tan(3 * DEG) : 0, z: p.y, hdg: Rp.hdg, pitch: tt < 0 ? 0.04 : 0, vis: true }); } }
    // the arrival ahead of us: it flies the same final, touches down, rolls out and vacates
    const a = this.tr('cph-arr');
    const A = runwayInfo('EKCH', this.arrRwy);
    if (!fm.airport && !fm.onGround) {
      const d2 = fm.m.touchdown - fm.s; // our distance to touchdown
      if (a.state === 'far' && d2 < 30000) { a.state = 'final'; a.d = d2 - a.sep; }
      if (a.state === 'final') {
        // it stays its spacing ahead of us down the final and touches down as we pass that distance
        a.d = d2 - a.sep;
        if (a.d <= 0) { a.state = 'landed'; a.tdT = t; a.roll = 0; a.v = 68; }
        const p = A.frame.to(300 - a.d, 0);
        Object.assign(a, { x: p.x, y: Math.max(0, a.d) * Math.tan(3 * DEG) + 15, z: p.y, hdg: A.hdg, pitch: 0.05, vis: a.d < 25000 });
      }
    }
    if (a.state === 'landed') {
      const tt = t - a.tdT;
      a.v = Math.max(9, a.v - 2.0 * dt); a.roll += a.v * dt;
      const p = A.frame.to(300 + Math.min(a.roll, 1500), 0);
      Object.assign(a, { x: p.x, y: 0, z: p.y, hdg: A.hdg, pitch: 0, vis: true });
      if (tt > a.rot) { a.state = 'vacated'; a.vacT = t; }
    }
    if (a.state === 'vacated') { a.vis = t - a.vacT < 30; if (a.vis) { const p = A.frame.to(300 + Math.min(a.roll, 1500) + (t - a.vacT) * 6, 180); Object.assign(a, { x: p.x, y: 0, z: p.y }); } }
    const cd = this.tr('cph-dep');
    if (cd.t0 != null) {
      const other = runwayInfo('EKCH', this.arrRwy === '22L' ? '22R' : '04R');
      const tt = t - cd.t0;
      if (tt < 0 || tt > 110) cd.vis = false;
      else { const s = tt * tt * 1.0; const air = Math.max(0, s - 1600); const p = other.frame.to(100 + s, 0); Object.assign(cd, { x: p.x, y: Math.min(air * 0.13, 1500), z: p.y, hdg: other.hdg, pitch: air > 0 ? 0.25 : 0, vis: true }); }
    }
  }

  // ---------- dialogues with our flight (the crew calls these; replies come after a realistic delay) ----------
  // Each reply sets a clearance in `cl` when it is transmitted and tells the crew.
  call(kind, crew, data = {}) {
    const r = this.r, d = 2.5 + r() * 3.5, c = this.cl;
    const us = CALL;
    switch (kind) {
      case 'startup': {
        // A-CDM at Arlanda: the ground controller approves start-up and pushback at the TSAT
        this.unit = 'Arlanda Ground';
        const f = crew.fm.route.gate;
        this.say('SK1415', `Arlanda Ground, ${us}, stand ${spellStand(f.name)}, request pushback and start-up.`, 0);
        this.say('ATC', `${us}, pushback and start-up approved, facing ${f.facing}, QNH ${spellNum(Math.round(this.wx.s.arn.qnh))}.`, d, () => { c.push = true; crew.readback(`Pushback and start-up approved, facing ${f.facing}, QNH ${spellNum(Math.round(this.wx.s.arn.qnh))}, ${CALL_SHORT}.`); });
        break;
      }
      case 'taxi':
        this.unit = 'Arlanda Ground';
        this.say('SK1415', `Arlanda Ground, ${us}, request taxi.`, 0);
        this.say('ATC', `${us}, taxi to holding point runway ${spellRwy(this.depRwy)}.`, d, () => { c.taxi = true; crew.readback(`Taxi to holding point runway ${spellRwy(this.depRwy)}, ${CALL_SHORT}.`); });
        break;
      case 'ready': {
        // at the holding point: the departure ahead goes first; we line up behind it
        this.unit = 'Arlanda Tower';
        this.say('SK1415', `Arlanda Tower, ${us}, holding point runway ${spellRwy(this.depRwy)}, ready for departure.`, 0);
        const dep = this.tr('arn-dep');
        if (dep.state === 'waiting') {
          this.say('ATC', `${us}, hold position, traffic departing.`, d, () => { crew.readback(`Holding position, ${CALL_SHORT}.`); });
          this.say('ATC', null, d + 2, () => { dep.state = 'rolling'; dep.t0 = this.t; });
          this._lineupAfter = true;
        } else this._clearLineup(crew, d);
        break;
      }
      case 'airborne':
        this.unit = 'Stockholm Control';
        this.say('SK1415', `Stockholm Control, ${us}, passing ${data.alt} feet climbing ${data.cleared}.`, 0);
        this.say('ATC', `${us}, radar contact, climb flight level one hundred.`, d, () => { c.altFt = 10000; crew.onClearance('alt', 10000); crew.readback(`Climb flight level one hundred, ${CALL_SHORT}.`); });
        break;
      case 'climb-high':
        this.say('ATC', `${us}, climb flight level ${spellNum(data.fl)}.`, 0, () => { c.altFt = data.fl * 100; crew.onClearance('alt', data.fl * 100); crew.readback(`Climb flight level ${spellNum(data.fl)}, ${CALL_SHORT}.`); });
        break;
      case 'handoff':
        this.unit = data.unit;
        this.say('ATC', `${us}, contact ${data.unit}${data.freq ? ' ' + data.freq : ''}.`, d, () => crew.readback(`${data.unit}${data.freq ? ' ' + data.freq : ''}, ${CALL_SHORT}.`));
        this.say('SK1415', `${data.unit}, ${us}, ${data.report || 'good morning'}.`, d + 5);
        break;
      case 'descent':
        this.say('SK1415', `${this.unit}, ${us}, request descent.`, 0);
        this.say('ATC', `${us}, descend flight level ${spellNum(data.fl)}${data.rwy ? `, expect ILS runway ${spellRwy(data.rwy)}` : ''}.`, d, () => { c.altFt = data.fl * 100; c.descent = true; crew.onClearance('alt', data.fl * 100); crew.readback(`Descend flight level ${spellNum(data.fl)}, ${CALL_SHORT}.`); });
        break;
      case 'descend-alt': {
        const q = Math.round(this.arrApt === 'ARN' ? this.wx.s.arn.qnh : this.wx.s.cph.qnh);
        this.say('ATC', `${us}, descend altitude ${spellNum(data.ft / 1000)} thousand feet, QNH ${spellNum(q)}.`, 0, () => { c.altFt = data.ft; crew.onClearance('alt', data.ft, q); crew.readback(`Descend altitude ${spellNum(data.ft / 1000)} thousand feet, QNH ${spellNum(q)}, ${CALL_SHORT}.`); });
        break;
      }
      case 'speed':
        this.say('ATC', `${us}, reduce speed ${spellNum(data.kt)} knots${data.until ? ` until ${data.until}` : ''}.`, 0, () => { c.spd = data.kt; crew.onClearance('spd', data.kt); crew.readback(`Speed ${spellNum(data.kt)}, ${CALL_SHORT}.`); });
        break;
      case 'approach':
        this.say('ATC', `${us}, cleared ILS approach runway ${spellRwy(this.arrRwy)}.`, 0, () => { c.approach = true; crew.onClearance('approach', this.arrRwy); crew.readback(`Cleared ILS approach runway ${spellRwy(this.arrRwy)}, ${CALL_SHORT}.`); });
        break;
      case 'tower': {
        const arn = this.arrApt === 'ARN';
        this.unit = arn ? 'Arlanda Tower' : 'Kastrup Tower';
        this.say('ATC', `${us}, contact ${this.unit} ${arn ? 'one one eight decimal five' : 'one one eight decimal one'}.`, 0, () => crew.readback(`Tower ${arn ? 'one one eight five' : 'one one eight one'}, ${CALL_SHORT}.`));
        this.say('SK1415', `${this.unit}, ${us}, established ILS ${spellRwy(this.arrRwy)}.`, 4);
        if (arn) this.say('ATC', `${us}, runway ${spellRwy(this.arrRwy)}, cleared to land, ${this.windReport('ARN', this.arrRwy)}, emergency services are standing by.`, 7 + r() * 2, () => { this.cl.landing = true; });
        else { this.say('ATC', `${us}, Kastrup Tower, ${this.runwayFreeForLanding() ? 'continue approach' : 'continue approach, one ahead'}, ${this.windReport('CPH', this.arrRwy)}.`, 7 + r() * 2); this._landingPending = true; }
        break;
      }
      case 'going-around':
        this.say('SK1415', `${us}, going around.`, 0);
        this.say('ATC', `${us}, roger, climb three thousand feet, fly runway heading, I will vector you back.`, d, () => { crew.onClearance('alt', 3000); crew.readback(`Three thousand feet, runway heading, ${CALL_SHORT}.`); this.cl.landing = false; this._landingPending = false; });
        break;
      case 'mayday': case 'pan':
        this.say('SK1415', `${kind === 'mayday' ? 'Mayday, mayday, mayday' : 'Pan-pan, pan-pan, pan-pan'}, ${us}, ${data.what}, ${data.intent}.`, 0);
        this.say('ATC', `${us}, roger ${kind === 'mayday' ? 'mayday' : 'pan-pan'}, ${data.reply || 'cleared as requested, advise intentions'}.`, d, () => { if (data.onAck) data.onAck(); });
        break;
      case 'vacated':
        this.say('ATC', `${us}, vacate when able, contact ${this.arrApt === 'ARN' ? 'Arlanda Ground' : 'Apron'}.`, 1.5 + r(), () => { c.vacated = true; });
        this.say('SK1415', `${this.arrApt === 'ARN' ? 'Arlanda Ground' : 'Kastrup Apron'}, ${us}, runway vacated.`, 8);
        this.say('ATC', `${us}, taxi to your stand${this.arrApt === 'ARN' ? ' at pier F' : ' at pier B'}.`, 11, () => { c.taxiIn = true; crew.readback(`Taxi to the stand, ${CALL_SHORT}.`); });
        break;
      case 'deviate':
        this.say('SK1415', `${this.unit}, ${us}, request ${data.nm} miles ${data.side} of track due weather.`, 0);
        this.say('ATC', `${us}, ${data.nm > 20 ? 'approved' : 'deviation approved'}, ${data.nm} miles ${data.side} of track, report back on track.`, d, () => { crew.onClearance('offset', data.offsetM); crew.readback(`Approved, ${data.nm} miles ${data.side}, ${CALL_SHORT}.`); });
        break;
      case 'level-change':
        this.say('SK1415', `${this.unit}, ${us}, experiencing ${data.what} turbulence, request flight level ${spellNum(data.fl)}.`, 0);
        this.say('ATC', `${us}, ${data.fl * 100 > (this.cl.altFt || 0) ? 'climb' : 'descend'} flight level ${spellNum(data.fl)}.`, d, () => { c.altFt = data.fl * 100; crew.onClearance('alt', data.fl * 100); crew.readback(`Flight level ${spellNum(data.fl)}, ${CALL_SHORT}.`); });
        break;
      default: break;
    }
  }
  _clearLineup(crew, d = 3) {
    const us = CALL;
    this.say('ATC', `${us}, line up and wait runway ${spellRwy(this.depRwy)}.`, d, () => { this.cl.lineup = true; crew.readback(`Line up and wait runway ${spellRwy(this.depRwy)}, ${CALL_SHORT}.`); });
  }
  // called every frame by the crew while waiting for the next clearance
  poll(fm, crew) {
    const dep = this.tr('arn-dep'), us = CALL;
    if (this._lineupAfter && dep.state === 'rolling' && this.t - dep.t0 > 12 && !this.cl.lineup) { this._lineupAfter = false; this._clearLineup(crew, 1); }
    // take-off clearance: preceding departure airborne and a minute ahead, our crew ready
    if (this.cl.lineup && !this.cl.takeoff && crew.readyForTakeoff() && !this._toPending && (dep.state !== 'rolling' || (dep.airborne && this.t - dep.t0 > 60) || dep.state === 'gone')) {
      this._toPending = true;
      this.say('ATC', `${us}, ${this.windReport('ARN', this.depRwy)}, runway ${spellRwy(this.depRwy)}, cleared for take-off.`, 2 + this.r() * 2, () => { this.cl.takeoff = true; crew.readback(`Cleared for take-off runway ${spellRwy(this.depRwy)}, ${CALL_SHORT}.`); });
    }
    // landing clearance at Kastrup once the runway is free; a go-around if it is still occupied close in
    if (this._landingPending && !this.cl.landing && this.runwayFreeForLanding() && !this._ldgSaid) {
      this._ldgSaid = true;
      this.say('ATC', `${us}, runway ${spellRwy(this.arrRwy)}, cleared to land, ${this.windReport('CPH', this.arrRwy)}.`, 1.5, () => { this.cl.landing = true; crew.readback(`Cleared to land runway ${spellRwy(this.arrRwy)}, ${CALL_SHORT}.`); });
      const cd = this.tr('cph-dep'); if (cd.t0 == null) cd.t0 = this.t + 8;
    }
    const blockedNow = this.t < (this._blockedUntil ?? -1) && this.cl.landing && !fm.airport;
    if ((this._landingPending && !this.cl.landing || blockedNow) && !this.runwayFreeForLanding() && fm.agl < 70 && !fm.onGround && !this._gaSaid) {
      this._gaSaid = true;
      this.say('ATC', `${us}, go around, I say again, go around, runway occupied.`, 0.5, () => crew.goAround('atc'));
    }
  }
  // Something is on the runway (a slow vacating aircraft, a vehicle): no landing clearance, or a
  // go-around if one was already given, until it is clear.
  blockRunway(sec) { this._blockedUntil = this.t + sec; const a = this.tr('cph-arr'); if (a.state === 'landed') a.rot = Math.max(a.rot, this.t - a.tdT + sec); }
  resetLanding() { this._landingPending = false; this._ldgSaid = false; this._gaSaid = false; this.cl.landing = false; const a = this.tr('cph-arr'); if (a.state !== 'vacated') { a.state = 'vacated'; a.vacT = this.t - 100; } }

  // We are going somewhere else now (a return to Arlanda): the approach and tower calls follow
  divert(apt, rwy) { this.arrApt = apt; this.arrRwy = rwy; this.cl.approach = false; this.cl.landing = true; this._landingPending = false; }
  // Is the runway free for us? (at Kastrup: the arrival ahead has vacated)
  runwayFreeForLanding() {
    const a = this.tr('cph-arr');
    if (this.t < (this._blockedUntil ?? -1)) return false;
    return a.state === 'vacated' || a.state === 'far';
  }
}

function gaussish(r) { let s = 0; for (let i = 0; i < 4; i++) s += r(); return (s - 2) * 1.73; }
export { CALL, CALL_SHORT };
