// The flight crew: a captain and a first officer who fly the A320 the way an airline crew does,
// through the same controls, the flight control unit and the radio. One is pilot flying (PF),
// the other pilot monitoring (PM); they alternate legs.
//
// Their hands are modelled as human operators (McRuer's crossover model): they see the aircraft
// and the flight director, react after a perception-action delay of about 0.2 s, move the
// sidestick through a neuromuscular lag of about 0.1 s and are never perfectly smooth. They follow
// standard operating procedures (Airbus FCOM/FCTM style) and decide from what they see:
//   * take-off: 50 % N1 then FLX/TOGA, half forward stick to 80 kt, rotation at about 3 degrees/s,
//     positive climb - gear up, autopilot when they choose (>= 100 ft), LVR CLB at the thrust
//     reduction altitude, flaps retracted at F and S speed;
//   * a stabilised approach by 1000 ft in cloud or 500 ft in visual conditions, else go around;
//     at the minimums: runway in sight or go around; autoland in low visibility;
//   * a manual landing: flare at about 30 ft (the flare law makes them pull), RETARD at 20 ft,
//     reversers, autobrake, 70 kt, vacate, single-engine taxi;
//   * rejected take-off below V1 only, windshear escape, engine failure and fire drills,
//     emergency descent, return to Arlanda, forced landing, storms avoided by 20 NM on the radar.
import { DEG, KT, FT, G, clamp, lerp, smoothstep, rng } from './core.js';
import { angleDiff } from './atmosphere.js';
import { DETENT } from './autoflight.js';
import { Path, buildRoute, buildReturnRoute, runwayInfo } from './flight.js';
import { WHEELBASE } from './physics.js';
import { spellRwy, spellNum, CALL_SHORT } from './atc.js';
import { STATIONS } from './weather.js';
import { CONTROLS, reachTime, handFor } from './hands.js';
import * as THREE from 'three';

const NAMES = { capt: ['Captain Lars Holmberg', 'Captain Karin Ek', 'Captain Anders Nygaard', 'Captain Maria Lindqvist'], fo: ['First Officer Johan Berg', 'First Officer Sofie Dahl', 'First Officer Mikkel Sørensen', 'First Officer Emma Strand'] };

class Pilot {
  constructor(role, r) {
    this.role = role;
    this.name = r.pick(NAMES[role]);
    this.tau = 0.16 + r() * 0.1;          // perception-action delay (s)
    this.tnm = 0.07 + r() * 0.05;         // neuromuscular lag (s)
    this.gain = 0.85 + r() * 0.3;         // how firmly they track
    this.noise = 0.01 + r() * 0.015;      // remnant (never perfectly smooth)
    this.react = 0.5 + r() * 0.7;         // reaction to an expected cue (s)
    this.x = role === 'capt' ? -0.54 : 0.54; // seat: captain left, first officer right
    this.handQ = []; this.hand = null; this.handAt = null; // one free hand, working through its jobs
    this.flareH = (30 + r() * 9) * FT;    // where they start the flare
    this.flareTau = 3.2 + r() * 1.3;      // how firmly they flare
    this.apAgl = r() < 0.6 ? (400 + r() * 1400) * FT : r() < 0.75 ? (2000 + r() * 3000) * FT : 9000 * FT;
    this.apOffAgl = (500 + r() * 900) * FT;
  }
}

export class Crew {
  constructor(fm, atc, opts = {}) {
    this.fm = fm; this.afs = fm.afs; this.atc = atc;
    this.r = rng(opts.seed ?? 1415);
    this.capt = new Pilot('capt', this.r); this.fo = new Pilot('fo', this.r);
    this.pf = this.r() < 0.5 ? this.capt : this.fo; this.pm = this.pf === this.capt ? this.fo : this.capt;
    this.hooks = { log: () => {}, seatbelt: () => {}, cabinReady: () => true, emergency: () => {}, ...(opts.hooks || {}) };
    this.t = 0; this._think = 0;
    this.tasks = [];
    this.mode = 'none';               // what the hands are doing: none, taxi, takeoff, air, landing, rollout
    this.st = {};                     // procedure memory
    this.belt = true;
    // switches the pilots operate that the physics does not need: APU, anti-ice
    const cold = fm.phase === 'boarding';
    this.sys = { apuMaster: cold, apuAvail: cold, apuBleed: cold, engAI: false, wingAI: false, beacon: !cold };
    this.goArounds = 0; this.diverting = null;
    this.dl = new Float32Array(4 * 128); this.dlI = 0; this.hand = { sx: 0, sy: 0, ped: 0, til: 0 };
    this.lev = [0, 0];                // where the pilot's hand puts the thrust levers
    this.brk = 0;                     // toe brakes
    this._nz = 0; this._nzT = 0;
    this.xfeed = 0;
    fm.crew = this;
    atc.on((m) => this.hooks.log({ kind: 'atc', who: m.who === 'ATC' ? m.unit : m.who, text: m.text }));
    const f = fm.afs;
    f.takeoffData(fm.mass);
    f.crzFt = opts.cruiseFt ?? 36000;
    f.thrRedAgl = 1500 * FT; f.accAgl = 3000 * FT;
    fm.baro = atc.wx.s.arn.qnh;
    this._planApproach();
  }

  // ---------- speaking ----------
  say(who, text) { const p = who === 'pf' ? this.pf : who === 'pm' ? this.pm : who === 'capt' ? this.capt : this.fo; this.hooks.log({ kind: 'cockpit', who: p.role === 'capt' ? 'Captain' : 'First officer', text }); }
  // APU and anti-ice, as the SOPs have them: APU bleed off after start, APU off once taxiing; APU
  // started again after landing; engine anti-ice on in icing conditions (OAT 10 °C or below with
  // visible moisture), wing anti-ice in flight.
  _systemsFlow(dt) {
    const fm = this.fm, st = this.st, y = this.sys;
    if (fm.phase === 'parked' && y.apuBleed && !st.apuBleedOff) { st.apuBleedOff = true; this.later(3, () => this.press('pm', 'ovhBleed', () => { y.apuBleed = false; })); }
    if (fm.phase === 'taxi-out' && y.apuMaster && !st.apuOffT) { st.apuOffT = true; this.later(90, () => this.press('pm', 'ovhApu', () => { y.apuMaster = false; y.apuAvail = false; this.say('pm', 'APU off.'); })); }
    if (fm.phase === 'taxi-in' && !y.apuMaster && !st.apuOn) { st.apuOn = true; this.later(10, () => this.press('pm', 'ovhApu', () => { y.apuMaster = true; this.say('pm', 'APU start.'); this.press('pm', 'ovhApu', () => { this.later(55, () => { y.apuAvail = true; }); }); })); }
    const a = this.fm.atmo, oat = a ? a.oat : 15, wet = a && (a.inCloud || a.rain > 0.5);
    const icing = oat <= 10 && oat > -40 && wet && fm.h < 7000;
    if (icing && !y.engAI) { this._aiT = (this._aiT || 0) + dt; if (this._aiT > 4 && !this._aiPress) { this._aiPress = true; this.press('pm', 'ovhAntiIce', () => { this._aiPress = false; y.engAI = true; if (!fm.onGround) y.wingAI = true; this.say('pm', `Icing conditions, engine anti-ice on${y.wingAI ? ', wing anti-ice on' : ''}.`); }, 0.8); } }
    else if (icing && y.engAI) this._aiT = 0;
    else if (!icing && y.engAI) { this._aiT = (this._aiT || 0) - dt; if (this._aiT < -60 && !this._aiPress) { this._aiPress = true; this.press('pm', 'ovhAntiIce', () => { this._aiPress = false; y.engAI = false; y.wingAI = false; this._aiT = 0; this.say('pm', 'Anti-ice off.'); }, 0.8); } }
    else if (icing) this._aiT = 4; else this._aiT = 0;
    if (fm.onGround && y.wingAI && !this._aiPress) { this._aiPress = true; this.press('pm', 'ovhAntiIce', () => { this._aiPress = false; y.wingAI = false; }); }
  }
  ground(text) { this.hooks.log({ kind: 'cockpit', who: 'Ground crew (headset)', text }); }
  // the read-back; `then` runs once it has been said (on the ground the crew acts only after reading back)
  readback(text, then = null) { this.later(0.8 + this.r() * 1.5, () => this.atc.say('SK1415', text, 0, then)); }
  // everything a pilot does takes a human, variable amount of time
  later(sec, fn) { this.tasks.push({ at: this.t + (sec < 0.6 ? sec * (0.8 + this.r() * 0.4) : this.r.human(sec, 0.3)), fn }); }
  // ---------- hands: a switch moves only when a pilot's hand gets to it ----------
  _who(role) { return role === 'pf' ? this.pf : role === 'pm' ? this.pm : role === 'capt' ? this.capt : role === 'fo' ? this.fo : role; }
  press(role, ctrl, fn, hold = 0.3) {
    // flying by hand, the pilot flying keeps both hands on stick and levers: the FCU is the other pilot's (FCTM golden rules)
    if (role === 'pf' && ctrl.startsWith('fcu') && ctrl !== 'fcuAp' && !this.afs.ap && !this.fm.onGround) role = 'pm';
    const p = this._who(role);
    const side = p.role === 'capt' ? 'C' : 'F';
    const id = ['mcdu', 'efis', 'rmp'].includes(ctrl) ? ctrl + side : ctrl;
    p.handQ.push({ ctrl: id, fn, hold: this.r.human(hold, 0.3) });
  }
  // set a control to a value by hand, once (nothing if it is already there or a hand is on its way)
  setCtl(role, key, val, idx = null, ctrl = null) {
    const c = this.fm.ctl, cur = idx == null ? c[key] : c[key][idx];
    const id = key + (idx ?? '');
    this._pend = this._pend || new Map();
    if (this._pend.has(id)) { if (this._pend.get(id) === val) return; }
    else if (cur === val) return;
    this._pend.set(id, val);
    const where = ctrl || { parkBrake: 'parkBrake', engMaster: 'engMaster' + (idx ?? 0), engMode: 'engMode', flapLever: 'flaps', speedbrake: 'speedbrake', spoilersArmed: 'speedbrake', gearLever: 'gear', autobrake: 'autobrake' }[key] || key;
    this.press(role, where, () => { this._pend.delete(id); if (idx == null) c[key] = val; else c[key][idx] = val; });
  }
  _hands(dt) {
    for (const p of [this.capt, this.fo]) {
      const h = p.hand;
      if (!h) {
        if (!p.handQ.length) continue;
        const job = p.handQ.shift(), to = CONTROLS[job.ctrl];
        const from = p.handAt || [p.x + (p.x < 0 ? 0.2 : -0.2), 0.62, -4.8];
        const d = to ? Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) : 0.03;
        p.hand = { ...job, to, ph: 'reach', t: 0, dur: reachTime(d, this.r), side: handFor(p.x, to) };
        continue;
      }
      h.t += dt;
      if (h.ph === 'reach' && h.t >= h.dur) { h.ph = 'hold'; h.t = 0; if (h.fn) h.fn(); }
      else if (h.ph === 'hold' && h.t >= h.hold) {
        if (p.handQ.length) { p.handAt = h.to; p.hand = null; }     // straight on to the next switch
        else { h.ph = 'return'; h.t = 0; h.dur = reachTime(0.35, this.r) * 0.9; }
      } else if (h.ph === 'return' && h.t >= h.dur) { p.hand = null; p.handAt = null; }
    }
  }
  handsBusy(role) { const p = this._who(role); return !!p.hand || p.handQ.length > 0; }

  onClearance(kind, v, qnh) {
    const a = this.afs;
    if (kind === 'alt') {
      this.later(this.pf.react + 0.5, () => this.press('pf', 'fcuAlt', () => {
        a.setAlt(v);
        if (qnh) this.st.qnhPending = qnh;
        if (this.fm.phase === 'go-around' || this.st.emerDes) return;
        const cur = this.fm.altInd / FT;
        if (v > cur + 100 && !['SRS'].includes(a.vert)) a.pushAlt();
        else if (v < cur - 100) { if (this.fm.phase === 'descent' || this.fm.phase === 'approach' || this.fm.phase === 'cruise') a.pushAlt(); }
      }, 0.8));
    }
    if (kind === 'spd') { this.later(this.pf.react, () => this.press('pf', 'fcuSpd', () => { a.atcSpd = v; }, 0.6)); }
    if (kind === 'approach') { this.st.cleared = true; this.later(this.pm.react, () => this.press('pf', 'fcuAppr', () => { a.armAppr(this.approachRwy); this.say('pf', 'Approach mode armed.'); })); }
    if (kind === 'offset') { this.press('pm', 'mcdu', () => { a.offset = v; }, 3); }
  }
  readyForTakeoff() { return this.fm.phase === 'lineup' && this.fm.gs < 3 && this.st.lineupDone && this.hooks.cabinReady(); }

  // ---------- approach planning: runway, minima, speeds, autoland ----------
  _planApproach() {
    const fm = this.fm, wx = this.atc.wx;
    const apt = this.diverting ? 'ARN' : 'CPH';
    const rwyId = this.diverting ? this.diverting.rwy : this.atc.arrRwy;
    this.approachRwy = runwayInfo(apt === 'ARN' ? 'ESSA' : 'EKCH', rwyId);
    const st = apt === 'ARN' ? wx.s.arn : wx.s.cph;
    const comp = (() => { const d = (st.wdir - this.approachRwy.hdg) * DEG; return { head: st.wspd * Math.cos(d), cross: Math.abs(st.wspd * Math.sin(d)) }; })();
    const ceil = wx.ceilingFt(apt);
    const rvr = st.vis * (st.vis < 1500 ? 1.4 : 1);
    // approach category: CAT I (DA 200 ft, RVR 550 m), CAT II (DH 100 ft, RVR 300 m), CAT III (DH 50 ft or none, RVR 75-200 m)
    let cat = 'CAT I', dh = 200, rvrMin = 550;
    if (rvr < 550 || ceil < 200) { cat = 'CAT II'; dh = 100; rvrMin = 300; }
    if (rvr < 300 || ceil < 100) { cat = 'CAT III'; dh = rvr < 175 ? 0 : 50; rvrMin = dh ? 175 : 75; }
    const autolandOk = comp.cross <= 20 && comp.head >= -10 && comp.head <= 30 && !fm.engFail.some(Boolean) && fm.hyd.green && fm.hyd.yellow;
    if (cat !== 'CAT I' && !autolandOk) { cat = 'CAT I'; dh = 200; rvrMin = 550; }
    this.appr = { apt, rwy: rwyId, cat, dh: dh * FT, rvrMin, autoland: cat !== 'CAT I', ceil: ceil * FT, head: comp.head, cross: comp.cross, belowMinima: rvr < rvrMin && !(cat === 'CAT III' && rvr >= 75) };
    // landing configuration and speed: CONF FULL (CONF 3 with a flap problem), VLS + max(5, headwind/3) up to +15
    this.ldgLever = fm.flapJam || !(fm.hyd.green || fm.hyd.yellow) ? 3 : 4;
    const vls = this.afs.vls(this.ldgLever === 4 ? 5 : 4, fm.mass - 2000);
    const gustInc = Math.max(0, (st.gust - st.wspd) / 3);
    this.vappBase = vls + clamp(Math.max(5, comp.head / 3 + gustInc), 5, 15);
    this.towerHead = comp.head;
    fm.vappTarget = this.vappBase;
    // autobrake: LO normally, MED on a wet runway, with a tailwind or after a failure
    this.abSetting = (st.precip > 0.3 || comp.head < -3 || fm.engFail.some(Boolean) || !fm.hyd.green) ? 'MED' : 'LO';
    this.revMax = st.precip > 0.3 || comp.head < 0 || fm.engFail.some(Boolean) || this.r() < 0.3;
    this.afs.approachRwy = this.approachRwy;
  }

  // ---------- the hands: called every physics step ----------
  control(dt) {
    this.t += dt;
    this._hands(dt);
    const fm = this.fm, c = fm.ctl, p = this.pf;
    // high-level procedures ten times a second
    this._think += dt;
    if (this._think >= 0.1) { const d = this._think; this._think = 0; this.think(d); }
    // desired control positions for this instant
    const want = this._wantControls(dt);
    // perception-action delay (ring buffer at the physics rate)
    const N = 128, n = clamp(Math.round(p.tau / dt), 1, N - 1);
    const i = this.dlI; this.dl[i * 4] = want.sx; this.dl[i * 4 + 1] = want.sy; this.dl[i * 4 + 2] = want.ped; this.dl[i * 4 + 3] = want.til;
    const j = (i - n + N) % N; this.dlI = (i + 1) % N;
    const k = 1 - Math.exp(-dt / p.tnm);
    const h = this.hand;
    // remnant: slow, correlated imprecision
    this._nzT -= dt; if (this._nzT <= 0) { this._nzT = 0.35; this._nzA = (this.r() - 0.5) * 2 * p.noise; this._nzB = (this.r() - 0.5) * 2 * p.noise; }
    const act = this.mode !== 'none';
    const rl = 2.2 * dt; // a hand moves the sidestick at a finite rate
    h.sx += clamp(((act ? this.dl[j * 4] + (this.mode === 'air' || this.mode === 'landing' ? this._nzA : 0) : 0) - h.sx) * k, -rl, rl);
    h.sy += clamp(((act ? this.dl[j * 4 + 1] + (this.mode === 'air' || this.mode === 'landing' ? this._nzB : 0) : 0) - h.sy) * k, -rl, rl);
    h.ped += ((act ? this.dl[j * 4 + 2] : 0) - h.ped) * k;
    h.til += ((act ? this.dl[j * 4 + 3] : 0) - h.til) * k;
    c.stickX = clamp(h.sx, -1, 1); c.stickY = clamp(h.sy, -1, 1); c.pedal = clamp(h.ped, -1, 1); c.tiller = clamp(h.til, -1, 1);
    // thrust levers and toe brakes move at the speed of a hand
    for (let e = 0; e < 2; e++) c.thr[e] += clamp(this.lev[e] - c.thr[e], -1.6 * dt, 1.6 * dt);
    c.brakeL += clamp((this.brkL ?? this.brk) - c.brakeL, -3 * dt, 3 * dt); c.brakeR += clamp((this.brkR ?? this.brk) - c.brakeR, -3 * dt, 3 * dt);
  }

  // What the pilot flying wants the controls to be right now (before the human delays).
  _wantControls(dt) {
    const fm = this.fm, afs = this.afs, p = this.pf;
    const out = this._w || (this._w = { sx: 0, sy: 0, ped: 0, til: 0 });
    out.sx = 0; out.sy = 0; out.ped = 0; out.til = 0;
    const Va = Math.max(fm.tas, 40);
    const gsKt = fm.gs / KT;
    switch (this.mode) {
      case 'taxi': {
        this._taxi(out, dt);
        break;
      }
      case 'takeoff': case 'rollout': {
        // keep the centreline with the rudder pedals (and the nose wheel through them)
        const R = this.mode === 'takeoff' || this.st.rtoWatch ? fm.route.dep : this.approachRwy;
        // off-airport (a forced landing): keep straight along the touchdown heading
        const offField = this.mode === 'rollout' && this.st.forcedStop && this.st.tdHdg != null && Math.abs(this._latDev(R)) > 150;
        const lat = offField ? 0 : this._latDev(R);
        const hdgErr = angleDiff(offField ? this.st.tdHdg : R.hdg * DEG, fm.heading);
        const rudK = clamp(80 / Math.max(gsKt, 20), 0.5, 3);
        out.ped = clamp((hdgErr * 3.2 - lat * 0.012 - fm.r * 1.4) * rudK * p.gain, -1, 1);
        // on the runway the stick stays near neutral: a little into-wind aileron at speed, no wing-levelling
        const xw = this.mode === 'takeoff' ? this._xwind(fm.route.dep) : this._xwind(this.approachRwy);
        out.sx = clamp(-xw / 40, -0.2, 0.2) * clamp(gsKt / 100, 0, 1);
        // a main leg missing: full aileron to hold that wing up for as long as the ailerons can
        if (this.st.gearUnsafe && this.mode === 'rollout') { const up = fm.gearFailLeg === 2 ? -1 : 1; out.sx = clamp(up * 0.7 - fm.bank * 12 - fm.p * 2, -1, 1); }
        if (this.mode === 'takeoff') {
          if (!this.st.rotate) out.sy = gsKt < 80 ? -0.5 : lerp(-0.5, 0, clamp((fm.ias - 80) / 20, 0, 1));
          else {
            // rotation: about 3 degrees per second towards the flight director, holding 10 degrees until airborne
            const airborne = !fm.wow[1] && !fm.wow[2] && fm.agl > 0.5;
            if (!airborne) {
              // about 3 degrees per second, easing off to hold about 10 degrees until the wheels leave the ground
              const thT = 10 * DEG;
              const qT = clamp(0.8 * (thT - fm.pitch), -1.5 * DEG, 3 * DEG);
              this._rotI = clamp((this._rotI ?? 0.15) + (qT - fm.q) * dt * 1.5, -0.4, 0.6);
              out.sy = clamp(this._rotI + (qT - fm.q) * 4.5, -0.5, 0.8);
            } else { this.mode = 'air'; this._fdFollow(out, Va); }
          }
          // the tiller is not used above taxi speed
        } else {
          // rollout: the back pressure is relaxed over a few seconds so the nose wheel comes down gently
          const since = this.t - (this.st.tdT ?? this.t);
          out.sy = fm.wow[0] ? 0 : Math.max(0, (this._flareEndSy ?? 0.2) - 0.12 * since);
          // a gear leg missing: hold the attitude (and the lift) while the ailerons still work
          if (this.st.gearUnsafe && gsKt > 75) out.sy = Math.max(0.35, this._flareEndSy ?? 0.35);
          if (gsKt < 30) { out.til = clamp(-lat * 0.04 + hdgErr * 2, -0.5, 0.5); }
        }
        break;
      }
      case 'air': this._fdFollow(out, Va); break;
      case 'landing': this._landing(out, Va, dt); break;
      default: break;
    }
    return out;
  }

  // Follow the flight director: pitch bar -> load factor with the sidestick, roll bar -> roll rate.
  _fdFollow(out, Va) {
    const fm = this.fm, afs = this.afs, p = this.pf;
    const qfd = afs.qCmd - (afs.qTurn ?? 0);
    const dnz = qfd * Va / G;
    const clean = fm.cfgTarget === 0;
    out.sy = clamp(p.gain * (dnz >= 0 ? dnz / (clean ? 1.5 : 1.0) : dnz / (clean ? 2.0 : 1.0)), -1, 1);
    const pWant = clamp(0.9 * (afs.bankCmd - fm.bank), -6 * DEG, 6 * DEG);
    out.sx = clamp(p.gain * (pWant - fm.p * 0.3) / (15 * DEG), -1, 1);
  }

  // The last part of a manual landing: follow the ILS down, de-crab, flare, retard.
  _landing(out, Va, dt) {
    const fm = this.fm, afs = this.afs, p = this.pf;
    const agl = fm.agl;
    const R = this.approachRwy;
    if (agl > p.flareH || !this.st.flare) {
      this._fdFollow(out, Va);
      if (agl < p.flareH && fm.vs < 0) { this.st.flare = true; this.st.flareT = this.t; }
    }
    if (this.st.flare) {
      // the flare law lowers the nose from 30 ft, so the pilot pulls to bring the sink rate down smoothly
      const tau = p.flareTau;
      const vsWant = -Math.max(0.35 + 0.25 * p.gain, Math.max(0, agl) / tau);
      const thRef = fm.flareRef ?? fm.pitch;
      // attitude for the sink rate they want, with lead from how fast the sink rate is already changing
      const az = (fm.vs - (this._vsP ?? fm.vs)) / Math.max(dt, 1e-3); this._vsP = fm.vs;
      this._azF = lerp(this._azF ?? 0, az, 1 - Math.exp(-dt / 0.3));
      let thWant = fm.pitch + (vsWant - fm.vs) * 0.045 * p.gain - this._azF * 0.03;
      // never push the nose down in the flare: floating, they hold the attitude and let it settle
      thWant = Math.max(thWant, fm.pitch - 0.4 * DEG);
      // but never above about 8 degrees: the A320 calls PITCH PITCH at 10 degrees predicted (tail strike ~11.7)
      thWant = Math.min(thWant, 8 * DEG);
      if (fm.pitch + fm.q * 1 > 10 * DEG && !this.st.pitchCall) { this.st.pitchCall = true; this.hooks.log({ kind: 'auto', who: 'Aircraft', text: 'PITCH, PITCH' }); }
      out.sy = clamp((thWant - thRef) / (20 * DEG), -0.1, 0.9);
      // wings level (a touch into the wind)
      out.sx = clamp((-fm.bank * 2.5 - fm.p * 0.4) + clamp(-afs.locDevM * 0.002, -0.05, 0.05), -0.5, 0.5);
      // a main leg missing: touch down on the good leg with the wing on the bad side held a little high
      if (this.st.gearUnsafe) { const up = fm.gearFailLeg === 2 ? -1 : 1; out.sx = clamp((up * 2 * DEG - fm.bank) * 2.5 - fm.p * 0.4, -0.6, 0.6); }
    }
    // de-crab: from about 40 ft the rudder lines the nose up with the runway
    if (agl < 45 * FT) {
      const crab = angleDiff(R.hdg * DEG, fm.heading);
      out.ped = clamp(crab * 4.5 * p.gain - fm.r * 1.2, -1, 1);
    }
  }

  // crosswind component on a runway (kt, + from the right)
  _xwind(R) { const w = this.fm.atmo.runwayWind(R.hdg * DEG, 10); return w.cross / KT; }
  _latDev(R) { const g = this.fm.gearPoint; return (g.x - R.thr.x) * -R.dir.y + (g.z - R.thr.y) * R.dir.x; }

  // Taxi along the route: tiller to the yellow line (pure pursuit), thrust and brakes for speed.
  _taxi(out, dt) {
    const fm = this.fm;
    const gs = fm.gs;
    const Ld = clamp(6 + gs * 2.2, 12, 34);
    const G2 = fm.gearPoint;
    const tp = fm.path.sample(fm.s + Ld, this._tp || (this._tp = {}));
    const dx = tp.x - G2.x, dz = tp.z - G2.z;
    const eta = angleDiff(Math.atan2(dx, -dz), fm.heading);
    const dist = Math.max(4, Math.hypot(dx, dz));
    const nws = Math.atan(2 * WHEELBASE * Math.sin(eta) / dist);
    const tillerK = 1 - smoothstep(20, 70, gs / KT);
    out.til = clamp(nws / (75 * DEG) / Math.max(0.2, tillerK), -1, 1);
    // speed: slower in turns, stop at the next point we are not cleared past
    const k = fm.path.maxCurvatureAhead(fm.s, 70);
    const vTurn = k > 0 ? Math.sqrt(0.9 / k) : 99;
    let vT = Math.min(this.st.taxiMax ?? 9.5, Math.max(3.2, vTurn));
    const stopS = this.st.stopS;
    if (stopS != null) { const d = Math.max(0, stopS - fm.s); vT = Math.min(vT, Math.sqrt(2 * 0.5 * d)); if (d < 0.8) vT = 0; }
    // the captain keeps a safe distance behind aircraft taxiing or holding ahead (look out, not a script)
    const gap = this._trafficAhead();
    if (gap < 400) { const d = Math.max(0, gap - 62); vT = Math.min(vT, Math.sqrt(2 * 0.45 * d)); if (d < 1) vT = 0; }
    const dv = vT - gs;
    this._taxiI = clamp((this._taxiI || 0) + (dv > 0 ? dv : dv * 3) * dt * 0.02, 0, 0.12);
    const need = vT < 0.05 ? 0 : clamp(0.02 + 0.06 * dv + this._taxiI + (gs < 0.6 && vT > 1.5 ? 0.18 : 0), 0, 0.3);
    const lev = this.singleEngine ? [need * 1.6, 0] : [need, need];
    this.lev[0] = lev[0]; this.lev[1] = lev[1];
    this.brk = dv < -0.4 ? clamp(-(dv + 0.4) * 0.35, 0, 1) : 0;
    if (vT < 0.05 && gs < 0.5) this.brk = 1;
    this.brkL = this.brkR = null;
  }

  // distance (m) to the nearest aircraft on the ground ahead of our nose within the taxiway width
  _trafficAhead() {
    const fm = this.fm, tf = this.atc.tf; if (!tf || !fm.onGround) return 1e9;
    const h = fm.heading, fx = Math.sin(h), fz = -Math.cos(h);
    let best = 1e9;
    for (const a of tf.list) {
      if (a.x == null || a.airborne || ['scheduled', 'ready-push', 'parked', 'gone'].includes(a.state)) continue;
      const dx = a.x - fm.pos.x, dz = a.z - fm.pos.z, ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 400 && lat < 30) best = Math.min(best, ahead);
    }
    return best;
  }

  // ---------- procedures: ten times a second ----------
  think(dt) {
    const fm = this.fm, afs = this.afs, atc = this.atc, st = this.st;
    for (let i = 0; i < this.tasks.length; i++) { const tk = this.tasks[i]; if (tk.at <= this.t) { this.tasks.splice(i--, 1); tk.fn(); } }
    atc.update(dt, fm, this);
    atc.poll(fm, this);
    this._systemsFlow(dt);
    if (fm.crashed) { this.mode = 'none'; this.lev = [0, 0]; this.brk = 1; if (!st.crashDone) { st.crashDone = true; this.setCtl('capt', 'engMaster', false, 0); this.setCtl('capt', 'engMaster', false, 1); } return; }
    this._monitor(dt);
    if (!fm.onGround && !afs.ap && this.mode === 'none' && fm.phase !== 'forced') this.mode = fm.phase === 'approach' || fm.phase === 'flare' ? 'landing' : 'air';
    const agl = fm.agl, ias = fm.ias, altFt = fm.altInd / FT;
    switch (fm.phase) {
      case 'boarding': {
        // at the gate: the pilots wait for the load sheet and the purser's "boarding complete"
        if (!st.pushGo) this.setCtl('capt', 'parkBrake', true); this.brk = 0; this.lev = [0, 0]; this.mode = 'none';
        if (this.boardingDone && !st.pushReq && atc.tsat != null && !st.tsatSet) {
          // ready: TOBT is the scheduled time unless the doors closed later; the crew calls inside the TSAT window
          st.tsatSet = true; atc.tobt = Math.max(atc.tobt ?? 0, atc.clockH() + 2 / 60); atc.tsat = atc.tobt; st.callAhead = clamp(this.r.human(3, 0.4), 0.5, 4.5) / 60;
        }
        if (this.boardingDone && !st.pushReq && (atc.tsat == null || atc.clockH() >= atc.tsat - (st.callAhead ?? 0))) { st.pushReq = true; this.later(8, () => this.press('capt', 'ovhExtLt', () => { this.sys.beacon = true; this.say('capt', 'Doors closed, beacon on. Before start checklist complete.'); this.later(2, () => atc.call('startup', this)); })); }
        if (atc.cl.push && !st.pushGo) {
          st.pushGo = true;
          // parking brake off by hand, then the report to the headset man, who starts the push
          this.later(3, () => this.press('capt', 'parkBrake', () => {
            fm.ctl.parkBrake = false;
            this.later(1.5, () => this.say('capt', `Ground from cockpit, cleared for pushback facing ${fm.route.gate.facing}. Brakes released.`));
            this.later(6, () => { this.ground('Brakes released, pushback commencing. Cleared to start the engines.'); fm.startPushback(fm.route.pushPts); fm.phase = 'pushback'; st.pushT = this.t; });
          }));
        }
        break;
      }
      case 'pushback': {
        this.brk = 0; this.lev = [0, 0]; this.mode = 'none';
        // engine 2 first (it drives the yellow hydraulics for the brakes and steering), then engine 1
        if (!st.start2 && this.t - st.pushT > 15) { st.start2 = true; this.setCtl('capt', 'engMode', 'IGN/START'); this.press('capt', 'engMode', () => this.say('capt', 'Starting engine two.')); this.later(3, () => this.setCtl('capt', 'engMaster', true, 1)); }
        if (st.start2 && fm.engineRunning[1] && !st.start1) { st.start1 = true; this.later(8, () => { this.say('capt', 'Starting engine one.'); this.setCtl('capt', 'engMaster', true, 0); }); }
        if (fm.tug?.state === 'stopped' && !st.pushStop) {
          st.pushStop = true;
          this.ground('Pushback complete, set parking brake.');
          this.later(1.5, () => this.press('capt', 'parkBrake', () => { fm.ctl.parkBrake = true; this.say('capt', 'Parking brake set.'); }));
          this.later(9, () => this.ground('Parking brake set. Disconnecting, bypass pin removed. Stand by for visual signals on the left.'));
          this.later(16, () => { fm.tug.state = 'off'; fm.emit('tug-disconnected'); });
        }
        if (st.pushStop && fm.tug?.state === 'off' && fm.engineRunning[0] && fm.engineRunning[1] && !st.afterStart) {
          st.afterStart = true;
          this.later(4, () => this.press('capt', 'engMode', () => { fm.ctl.engMode = 'NORM'; this.say('pf', 'After start checklist: APU bleed off, engine mode normal, ground spoilers armed, rudder trim zero.'); fm.phase = 'parked'; fm.emit('pushback-complete'); }, 0.5));
        }
        break;
      }
      case 'parked': {
        this.brk = 0; this.lev = [0, 0]; this.mode = 'none';
        if (!st.clr) { st.clr = true; this.later(6, () => { atc.call('taxi', this); }); }
        if (atc.cl.taxi && !st.taxiGo) {
          st.taxiGo = true;
          this.later(this.capt.react + 2, () => this.press('capt', 'parkBrake', () => {
            fm.ctl.parkBrake = false; this.brk = 0; this.st.stopS = fm.m.hold; this.mode = 'taxi'; fm.phase = 'taxi-out'; fm.emit('taxi-start');
            this.say('capt', 'Clear left? — Clear right. Taxiing.');
          }));
          // before-taxi items: flaps for take-off, spoilers armed, autobrake MAX, trim
          this.later(14, () => { this.say('pf', 'Flaps one.'); this.setCtl('pm', 'flapLever', 1); this.setCtl('pm', 'spoilersArmed', true); this.setCtl('pm', 'autobrake', 'MAX'); this.press('pm', 'ecp', () => this.say('pm', 'Before take-off checklist down to the line.'), 1.5); });
        }
        break;
      }
      case 'taxi-out': {
        if (fm.s > fm.m.hold - 1.2 && fm.gs < 0.3) { fm.phase = 'hold'; fm.emit('holding-point'); }
        if (fm.s > fm.m.hold - 700 && !st.seatsTO) { st.seatsTO = true; fm.emit('seats-takeoff'); }
        break;
      }
      case 'hold': {
        this.brk = 1;
        // "ready for departure" only once the cabin crew report the cabin secure
        if (!st.ready && this.t - (st.holdT ?? (st.holdT = this.t)) > 4 && this.hooks.cabinReady()) { st.ready = true; atc.call('ready', this); }
        if (atc.cl.lineup && !st.lineupGo) {
          st.lineupGo = true;
          this.later(this.capt.react + 1.5, () => { this.brk = 0; this.st.stopS = fm.m.lineup; this.st.taxiMax = 6; this.mode = 'taxi'; fm.phase = 'lineup'; fm.emit('lineup-start'); this.say('pf', 'Lining up. Before take-off checklist below the line.'); });
        }
        break;
      }
      case 'lineup': {
        if (fm.s > fm.m.lineup - 1.5 && fm.gs < 0.3 && !st.lineupDone) { st.lineupDone = true; this.brk = 1; this.lev = [0, 0]; }
        if (atc.cl.takeoff && st.lineupDone && !st.toGo) {
          st.toGo = true;
          this.later(this.pf.react + 1, () => this._takeoffRoll());
        }
        break;
      }
      case 'takeoff': this._takeoffThink(); break;
      case 'climb': case 'cruise': case 'descent': case 'approach': case 'go-around': case 'emergency':
        this._airThink(dt); break;
      case 'flare': this._airThink(dt); break;
      case 'forced': this._forcedThink(); break;
      case 'rollout': this._rolloutThink(); break;
      case 'rto-stop': case 'runway-stop': this.mode = 'none'; this.lev = [0, 0]; this.brk = 1; if (fm.gs < 0.3) this.setCtl('capt', 'parkBrake', true); break;
      case 'taxi-in': {
        this.st.stopS = fm.m.stand - 0.3; this.st.taxiMax = 9;
        if (atc.cl.taxiIn || fm.airport) this.mode = 'taxi';
        else { this.mode = 'taxi'; this.st.stopS = Math.min(this.st.stopS, fm.m.exit + 180); }
        if (!st.eng2Off && this.t - (st.tdT ?? this.t) > 170 && !fm.engFail.some(Boolean) && fm.m.stand - fm.s > 400) { st.eng2Off = true; this.press('capt', 'engMaster1', () => { fm.ctl.engMaster[1] = false; this.singleEngine = true; fm.emit('engine2-shutdown'); this.say('capt', 'Engine two shut down, single-engine taxi.'); }); }
        if (fm.s >= fm.m.stand - 0.8 && fm.gs < 0.15) { fm.phase = 'arrived'; this.brk = 1; this.mode = 'none'; this.lev = [0, 0]; fm.emit('parked'); this.press('capt', 'parkBrake', () => { fm.ctl.parkBrake = true; this.say('capt', 'Parking brake set.'); }); }
        break;
      }
      case 'arrived': {
        this.mode = 'none'; this.lev = [0, 0]; if (!fm.ctl.parkBrake) this.brk = 1;
        // at the stand: engines off once the ground crew have the chocks in, then the seatbelt sign off
        if (!st.engOff) {
          st.engOff = true;
          this.later(12, () => { this.setCtl('capt', 'engMaster', false, 0); this.press('capt', 'engMaster1', () => { fm.ctl.engMaster[1] = false; this.say('capt', 'Engines off. Beacon off when they have spooled down.'); fm.emit('engines-off'); }); });
          this.later(22, () => { this._belt(false); this.say('pm', 'Seatbelt sign off.'); });
        }
        // beacon off once the engines have spooled down (the ground crew wait for it before approaching)
        if (st.engOff && Math.max(...fm.n1) < 0.08 && this.sys.beacon && !st.beaconOffP) { st.beaconOffP = true; this.later(3, () => this.press('capt', 'ovhExtLt', () => { this.sys.beacon = false; fm.emit('beacon-off'); })); }
        if (fm._flags.shutdown) { this.setCtl('capt', 'engMaster', false, 0); this.setCtl('capt', 'engMaster', false, 1); }
        break;
      }
      default: break;
    }
  }

  // ---------- take-off ----------
  _takeoffRoll() {
    const fm = this.fm;
    fm.phase = 'takeoff'; this.mode = 'takeoff'; this.brk = 0; this.brkL = this.brkR = null;
    const wx = this.atc.wx.s.arn;
    // TOGA on a wet runway, in gusts or with windshear about; otherwise the reduced FLX thrust
    this.toga = wx.precip > 0.5 || wx.gust > wx.wspd + 12 || this.atc.wx.stormNear('ARN', 1);
    this.lev = [0.23, 0.23];
    this.say('pf', 'Take-off.');
    this.st.toT = this.t;
  }
  _takeoffThink() {
    const fm = this.fm, st = this.st, afs = this.afs;
    const ias = fm.ias;
    if (!st.thrSet && fm.n1[0] > 0.45 && fm.n1[1] > 0.45 && this.t - st.toT > 2) { st.thrSet = true; const l = this.toga ? 1 : DETENT.FLX; this.lev = [l, l]; fm.emit('takeoff-roll'); }
    if (st.thrSet && !st.thrCalled && fm.n1[0] > 0.8) { st.thrCalled = true; this.say('pm', this.toga ? 'TOGA set.' : 'FLX set.'); }
    if (ias > 100 && !st.c100) { st.c100 = true; this.say('pm', 'One hundred knots.'); this.later(0.6, () => this.say('pf', 'Checked.')); }
    if (ias > afs.v1 && !st.v1) { st.v1 = true; this.say('pm', 'V1.'); }
    if (ias > afs.vr && !st.rotate) { st.rotate = true; this.say('pm', 'Rotate.'); this._rotI = 0.12; }
    if (st.rotate && !fm.wow[1] && !fm.wow[2] && fm.agl > 1) { fm.phase = 'climb'; this.mode = 'air'; st.liftT = this.t; }
    // a failure or fire before V1: reject
    if (!st.v1 && (fm.engFail[0] || fm.engFail[1] || fm.engFire[0] || fm.engFire[1] || st.rtoCue) && !st.rto) this.rejectTakeoff('failure');
  }
  rejectTakeoff(why) {
    const fm = this.fm, st = this.st;
    if (fm.phase !== 'takeoff' || st.v1 || st.rto) { if (why === 'event' && fm.phase === 'takeoff' && !st.v1) st.rtoCue = true; return false; }
    st.rto = true;
    this.later(this.capt.react * 0.8, () => {
      this.say('capt', 'Stop!');
      this.lev = [0, 0];
      this.later(0.8, () => { this.lev = [this.revMaxOK() ? -1 : 0, this.revMaxOK() ? -1 : 0]; });
      this.later(1.2, () => { if (!fm.abActive) this.brk = 1; });
      fm.emit('rto'); fm._rtoV = fm.ias;
      this.mode = 'rollout'; fm.phase = 'rollout';
      this.st.rtoWatch = true;
    });
    return true;
  }
  revMaxOK() { return true; }

  // ---------- in the air ----------
  _airThink(dt) {
    const fm = this.fm, afs = this.afs, atc = this.atc, st = this.st, pf = this.pf, pm = this.pm;
    const agl = fm.agl, ias = fm.ias, altFt = fm.altInd / FT, tAir = this.t - (st.liftT ?? this.t);
    const phase = fm.phase;
    // --- after take-off ---
    if (phase === 'climb' || phase === 'go-around') {
      if (!st.posClimb && fm.vs > 1.2 && agl > 8 * FT && tAir > 1.5) { st.posClimb = true; this.say('pm', 'Positive climb.'); this.later(0.5, () => this.say('pf', 'Gear up.')); this.later(0.6 + pm.react * 0.4, () => this.press('pm', 'gear', () => { fm.ctl.gearLever = 0; fm.emit(phase === 'go-around' ? 'ga-gear-up' : 'gear-up'); }, 0.4)); }
      if (!afs.ap && !st.apOn && agl > Math.max(100 * FT, pf.apAgl) && tAir > 5 && !this._handFlyWanted()) { st.apOn = true; this._apOn(); }
      if (!st.lvrClb && agl > afs.thrRedAgl && (phase === 'climb' ? tAir > 10 : true)) {
        st.lvrClb = true;
        // with an engine out the live engine stays at MCT (the FLX/MCT detent), never climb thrust
        this.later(pf.react, () => { const eo = fm.engFail.some(Boolean); this.lev = eo ? fm.engFail.map((f) => (f ? 0 : DETENT.FLX)) : [DETENT.CL, DETENT.CL]; this.say('pf', eo ? 'Maximum continuous thrust.' : 'Climb thrust.'); fm.emit(phase === 'go-around' ? 'ga-thrust-reduction' : 'thrust-reduction'); });
      }
      // clean up: flaps 1 at F speed, flaps up at S speed
      const eo = fm.engFail[0] || fm.engFail[1];
      const accel = agl > (eo ? 1500 * FT : afs.accAgl * 0.33);
      if (accel && fm.ctl.flapLever >= 2 && ias > afs.fSpeed() - 5 && !st.fl1) { st.fl1 = true; this._flaps(1, 'Flaps one.'); }
      if (accel && fm.ctl.flapLever === 1 && ias > afs.sSpeed() && !st.fl0 && (phase !== 'go-around' || agl > 1500 * FT)) { st.fl0 = true; this._flaps(0, 'Flaps up.'); this.later(3, () => { this.say('pf', 'Disarm spoilers. After take-off checklist.'); this.setCtl('pm', 'spoilersArmed', false); }); }
      if (phase === 'climb' && !st.atcAir && agl > 1500 * FT) { st.atcAir = true; atc.call('airborne', this, { alt: spellNum(Math.round(altFt / 100) * 100), cleared: 'five thousand feet' }); this.press('pf', 'fcuAlt', () => { afs.setAlt(5000); afs.pushAlt(); }); }
      if (phase === 'climb' && !st.std && altFt > 5000 - 50 && afs.fcu.alt > 5000) { st.std = true; fm.baro = null; this.say('pm', 'Transition altitude, standard.'); }
      if (phase === 'climb' && !st.fl360 && altFt > 7500) { st.fl360 = true; atc.call('climb-high', this, { fl: afs.crzFt / 100 }); }
      if (phase === 'climb' && altFt > 10000 && !st.p10k) { st.p10k = true; fm.emit('passing-10000-climb'); }
      if (phase === 'climb' && (afs.vert === 'ALT CRZ' || (afs.vert === 'ALT' && Math.abs(afs.fcu.alt - afs.crzFt) < 60)) && !st.toc) { st.toc = true; fm.phase = 'cruise'; afs.phase = 'CRUISE'; fm.emit('top-of-climb'); }
      // hand-flying pilots engage the autopilot passing FL100 at the latest
      if (!afs.ap && altFt > 10000 && !st.apLate && phase === 'climb') { st.apLate = true; this._apOn(); }
    }
    if (phase === 'go-around') this._goAroundThink();
    // --- cruise: weather, turbulence, top of descent ---
    if ((phase === 'climb' || phase === 'cruise' || phase === 'descent') && !this.diverting) this._weatherAvoid(dt);
    if (phase === 'cruise' || (phase === 'climb' && altFt > 20000)) {
      const d2td = fm.m.touchdown - fm.s;
      const prof = fm.descentProfile(Math.max(0, d2td - fm.gs * 90));
      if (!st.desReq && prof < fm.altInd - 30 && phase === 'cruise') { st.desReq = true; atc.call('descent', this, { fl: 100, rwy: this.diverting ? this.diverting.rwy : atc.arrRwy }); }
      const rc = !this.diverting && atc.reviewArrivalRunway(d2td);
      if (rc) { this._planApproach(); this._rebuildArrival(rc); this.later(3, () => this.say('pm', `ATIS changed, runway ${spellRwy(rc)} for landing. I'll set it up.`)); }
    }
    if (phase === 'cruise' && st.desReq && afs.fcu.alt < afs.crzFt - 500 && !st.tod) {
      st.tod = true; fm.phase = 'descent'; afs.phase = 'DESCENT'; fm.emit('top-of-descent'); this.press('pf', 'fcuAlt', () => afs.pushAlt());
    }
    // --- descent & approach ---
    if (phase === 'descent' || phase === 'approach') this._descentThink(dt);
    if (phase === 'approach' || phase === 'flare') this._approachThink(dt);
    // FMS vertical profile for the managed descent
    const d2td = fm.m.touchdown - fm.s;
    afs.profileAlt = (phase === 'descent' || phase === 'approach') ? fm.descentProfile(d2td) + (this.approachRwy?.elev ?? 0) : null;
    afs.profileSlope = fm.descentSlope(d2td);
    if (phase === 'emergency') this._emergencyThink();
  }

  _handFlyWanted() {
    const fm = this.fm, wx = this.atc.wx;
    if (this.pf.apAgl < 8000 * FT) return false;
    // only on a nice day
    return !fm.atmo.inCloud && fm.atmo.sigma < 1.2 && !fm.engFail.some(Boolean);
  }
  _flaps(lever, call) {
    const fm = this.fm;
    this.say('pf', call === 'Flaps up.' ? 'Flaps up.' : call);
    this.later(0.3 + this.pm.react * 0.3, () => this.press('pm', 'flaps', () => { fm.ctl.flapLever = lever; this.say('pm', lever === 0 ? 'Flaps zero.' : `Flaps ${['zero', 'one', 'two', 'three', 'full'][lever]}.`); }, 0.5));
  }

  // cruise monitoring: turbulence -> seatbelt sign, level change; storms -> deviation
  _monitor(dt) {
    const fm = this.fm, st = this.st, atc = this.atc;
    const sig = fm.atmo.sigma;
    // what they feel: the load factor with the slow manoeuvring part taken out (a 3 s high-pass), as an rms over ~8 s
    // (and the steady load of a turn taken out too), as an rms over ~8 s, and it has to last a few seconds
    // (a pull-up or push-over changes the flight path angle: V * d(gamma)/dt / g is manoeuvre, not turbulence)
    const gam = fm.gamma || 0, gd = (gam - (this._gamP ?? gam)) / Math.max(dt, 1e-3); this._gamP = gam;
    this._gd = lerp(this._gd ?? 0, gd, 1 - Math.exp(-dt / 1.5));
    const nzMan = Math.cos(gam) / Math.max(0.5, Math.cos(fm.bank)) + fm.tas * this._gd / G;
    this._nzLP = lerp(this._nzLP ?? 0, fm.nz - nzMan, 1 - Math.exp(-dt / 2));
    const hp = fm.nz - nzMan - this._nzLP;
    this._nzMS = lerp(this._nzMS ?? 0, hp * hp, 1 - Math.exp(-dt / 8));
    this._nzAcc = Math.sqrt(this._nzMS);
    st.roughT = !fm.onGround && this._nzAcc > 0.045 ? (st.roughT ?? 0) + dt : 0;
    const rough = st.roughT > 3;
    const bad = !fm.onGround && this._nzAcc > 0.11 && st.roughT > 1;
    st.smoothT = rough ? 0 : (st.smoothT ?? 0) + dt;
    // seatbelt sign: on for turbulence; off only above 10,000 ft after a smooth spell, not near storms
    if (rough && !this.belt && fm.phase !== 'parked') { this._belt(true); fm.emit(bad ? 'turbulence-severe' : 'turbulence'); }
    if (bad && !st.seatedCall && !fm.onGround && fm.agl > 1000 * FT) { st.seatedCall = true; fm.emit('crew-seated'); this.later(120, () => { st.seatedCall = false; }); }
    const quiet = st.smoothT > 90 && this.t - (st.beltT ?? -999) > 240 && this.t - (st.stormSeenT ?? -999) > 300 && fm.altInd > 10000 * FT && (fm.phase === 'climb' || fm.phase === 'cruise') && !fm.atmo.inCloud && !this._stormAhead && !fm.engFail.some(Boolean) && fm.phase !== 'emergency' && !this.diverting;
    if (this.belt && quiet && st.p10k && !st.descentBelt) this._belt(false);
    // a patch of moderate or worse turbulence that does not stop: ask for another level
    if (fm.phase === 'cruise' && bad) { st.badT = (st.badT ?? 0) + dt; if (st.badT > 40 && !st.lvlReq) { st.lvlReq = true; const cur = Math.round(this.afs.fcu.alt / 1000) * 10; const fl = cur >= 360 ? cur - 20 : cur + 20; atc.call('level-change', this, { what: this._nzAcc > 0.3 ? 'severe' : 'moderate', fl }); this.later(300, () => { st.lvlReq = false; st.badT = 0; }); } }
    else st.badT = Math.max(0, (st.badT ?? 0) - dt);
    // lightning strike: noted, a word to the passengers later
    if (fm.lightningT && fm.lightningT > (st.ltSeen ?? -1)) { st.ltSeen = fm.lightningT; this.later(1, () => this.say('pm', 'Lightning strike. All systems normal.')); this.hooks.emergency('lightning', {}); }
    // windshear: the reactive warning, then the escape manoeuvre
    this._windshearWatch(dt);
    // failures the crew has not handled yet
    for (let i = 0; i < 2; i++) if ((fm.engFail[i] || fm.engFire[i]) && !st[`engFailSeen${i}`]) { st[`engFailSeen${i}`] = true; this._engineFailure(i); }
    this._gearWatch();
    if (!fm.pressurised && !st.depress) { st.depress = true; this._depressurised(); }
    if (!fm.hyd.green && !st.hydG) { st.hydG = true; this.later(this.pm.react + 2, () => { this.say('pm', 'ECAM: hydraulic green system low pressure.'); this.hooks.emergency('hydraulic', {}); this._planApproach(); }); }
  }
  _belt(on) { if ((this._beltWant ?? this.belt) === on) return; this._beltWant = on; this.press('pm', 'ovhSigns', () => { this.belt = on; this.st.beltT = this.t; this.hooks.seatbelt(on); }); }
  _apOn(quiet = false) { this.press('pf', 'fcuAp', () => { if (!this.afs.ap) this.afs.engageAP(); this.mode = 'none'; if (!quiet) this.say('pf', 'Autopilot one.'); }, 0.3); }

  // Thunderstorm cells seen on the weather radar: keep 20 NM from the strong echoes (FAA AC 00-24C)
  _weatherAvoid(dt) {
    const fm = this.fm, wx = this.atc.wx, afs = this.afs, st = this.st;
    this._radarT = (this._radarT ?? 0) - dt; if (this._radarT > 0) return; this._radarT = 5;
    const hdg = fm.track, fx = Math.sin(hdg), fz = -Math.cos(hdg);
    const t = fm.atmo.t;
    let need = 0; this._stormAhead = false;
    const clear = 37000; // 20 NM
    for (const c of wx.cells) {
      const s = wx.stage(c, t); if (!s.alive || s.a < 0.18) continue;
      const dbz = 15 + 45 * (0.35 + 0.65 * s.rain) * (0.6 + 0.4 * c.k);
      if (dbz < 40) continue;
      const dx = c.x - fm.pos.x, dz = c.z - fm.pos.z;
      const along = dx * fx + dz * fz, cross = dx * -fz + dz * fx; // cross + = cell to the right
      if (along < -15000 || along > 180000) continue;
      // judged against the route itself, so the cell still counts while we are going round it
      if (Math.abs(cross) < clear + c.R) {
        this._stormAhead = true;
        // go round the side that needs the smaller deviation
        const right = cross - (clear + c.R), left = cross + clear + c.R; // offsets that clear it
        const want = Math.abs(right) < Math.abs(left) ? right : left;
        if (Math.abs(want) > Math.abs(need)) need = want;
      }
    }
    need = clamp(need, -74000, 74000);
    if (Math.abs(need - afs.offset) > 9000 && Math.abs(need) > Math.abs(afs.offset) - 2000 && !st.devPending && fm.phase !== 'approach') {
      st.devPending = true;
      const nm = Math.max(5, Math.round(Math.abs(need) / 1852 / 5) * 5);
      if (Math.abs(need) < 3000) { afs.offset = 0; st.devPending = false; this.say('pm', 'Clear of weather, back on track.'); }
      else {
        this.say('pf', `Weather ahead on the radar. Let's go ${need > 0 ? 'right' : 'left'}, about ${nm} miles.`);
        this.atc.call('deviate', this, { nm, side: need > 0 ? 'right' : 'left', offsetM: Math.sign(need) * nm * 1852 });
        this.later(60, () => { st.devPending = false; });
      }
      if (!this.belt) this._belt(true);
    }
    if (this._stormAhead) st.stormSeenT = this.t;
    if (!this._stormAhead && Math.abs(afs.offset) > 0 && !st.devPending && this.t - (st.stormSeenT ?? 0) > 150) { st.devPending = true; this.say('pm', 'Clear of the weather. Back on track.'); this.atc.say('SK1415', `${this.atc.unit}, Scandinavian one four one five, clear of weather, proceeding back on track.`, 1); afs.offset = 0; this.later(60, () => { st.devPending = false; }); }
  }

  _descentThink(dt) {
    const fm = this.fm, afs = this.afs, atc = this.atc, st = this.st;
    const d2td = fm.m.touchdown - fm.s, altFt = fm.altInd / FT, ias = fm.ias;
    if (!st.prepLdg && (d2td < 95000 || altFt < 20000)) { st.prepLdg = true; st.descentBelt = true; this._belt(true); fm.emit('prepare-landing'); }
    if (altFt < 10000 && !st.p10kD) { st.p10kD = true; fm.emit('passing-10000-descent'); }
    if (!st.altClr && d2td < 62000 && altFt < 16000) {
      st.altClr = true;
      // an altitude that meets the glide slope from below where the final begins
      const keys = fm.route.keys; const R = this.approachRwy;
      const fin = keys ? Math.hypot(keys.pts[keys.thrIdx - 1].x - R.thr.x, keys.pts[keys.thrIdx - 1].y - R.thr.y) : 20000;
      const gsFt = Math.tan(3 * DEG) * Math.min(fin, 26000) / FT;
      atc.call('descend-alt', this, { ft: clamp(Math.floor(gsFt / 1000 - 0.25) * 1000, 2000, 5000) });
    }
    if (st.qnhPending && altFt < 7500 && !st.qnhSet) { st.qnhSet = true; fm.baro = st.qnhPending; this.say('pm', `QNH ${Math.round(st.qnhPending)} set.`); }
    if (!st.spdClr && d2td < 34000) { st.spdClr = true; atc.call('speed', this, { kt: 180 }); }
    if (!st.appClr && d2td < 30000 && altFt < 6000) { st.appClr = true; atc.call('approach', this); }
    if (!st.twr && d2td < 17000 && st.cleared) { st.twr = true; atc.call('tower', this); }
    // approach phase and the configuration schedule, respecting the flap limits
    if (fm.phase === 'descent' && d2td < 40000) { fm.phase = 'approach'; fm.emit('approach'); this.press('pm', 'mcdu', () => { afs.phase = 'APPROACH'; afs.managedSpd(); }, 2); }
    if (fm.phase === 'approach') {
      const lev = fm.ctl.flapLever;
      if (lev < 1 && d2td < 32000 && ias < 226 && !st.a1) { st.a1 = true; this._flaps(1, 'Speed checked. Flaps one.'); }
      if (lev === 1 && d2td < 22000 && ias < 196 && !st.a2) { st.a2 = true; this._flaps(2, 'Flaps two.'); }
      const fast = ias > afs.spdTarget + 10;
      if (!st.gearDn && ((d2td < 13500 || fm.agl < 2100 * FT) && lev >= 2 || fast && d2td < 19000) && ias < 250) {
        st.gearDn = true; this.say('pf', 'Gear down.');
        // with a gear leg unsafe (Airbus LDG WITH ABNORMAL L/G): ground spoilers and autobrake not armed,
        // so the wing keeps its lift and can be held up with aileron after touchdown
        this.later(0.5, () => this.press('pm', 'gear', () => { const abn = !!st.gearUnsafe; fm.ctl.gearLever = 1; this.setCtl('pm', 'spoilersArmed', !abn); this.setCtl('pm', 'autobrake', abn ? 'OFF' : this.abSetting); fm.emit('gear-down'); this.say('pm', abn ? 'Gear down. Spoilers not armed. Autobrake off.' : `Gear down. Spoilers armed. Autobrake ${this.abSetting}.`); }, 0.4));
        this.later(8, () => { fm.emit('seats-landing'); });
      }
      if (lev === 2 && st.gearDn && fm.gear > 0.9 && ias < 181 && d2td < 12500 && !st.a3) { st.a3 = true; this._flaps(3, 'Flaps three.'); }
      if (lev === 3 && this.ldgLever === 4 && ias < 173 && d2td < 11000 && !st.a4) { st.a4 = true; this._flaps(4, 'Flaps full.'); this.later(4, () => this.say('pm', 'Landing checklist completed.')); }
      afs.atcSpd = d2td < 9000 ? null : afs.atcSpd;
    }
    // speed brakes when high on the profile or too fast, retracted when back on it (not in CONF FULL, not below 1000 ft)
    const high = afs.profileAlt != null && fm.altInd > afs.profileAlt + 250;
    const tooFast = ias > afs.spdTarget + 12;
    const sbOk = fm.cfgTarget < 5 && fm.agl > 1000 * FT;
    const sbWant = st.emerDes ? 1 : sbOk && (high || tooFast) ? (tooFast && ias > afs.spdTarget + 25 ? 1 : 0.5) : 0;
    // (with some hysteresis, and said once)
    const cur = fm.ctl.speedbrake;
    const next = sbWant > 0 ? sbWant : (cur > 0 && sbOk && (fm.altInd > (afs.profileAlt ?? 0) + 120 || ias > afs.spdTarget + 5) ? cur : 0);
    if (next > 0 && !(cur > 0) && !st.emerDes && this.t - (st.sbSaid ?? -99) > 60) { st.sbSaid = this.t; this.say('pf', 'Speed brakes.'); }
    if (Math.abs(next - (cur || 0)) > 0.01) this.setCtl('pf', 'speedbrake', next);
  }

  _approachThink(dt) {
    const fm = this.fm, afs = this.afs, atc = this.atc, st = this.st, pf = this.pf;
    const agl = fm.agl, R = this.approachRwy, ias = fm.ias;
    this._iasS = lerp(this._iasS ?? ias, ias, 1 - Math.exp(-dt / 2.5));
    // ground speed mini: the target rises with a gust in the headwind
    const headNow = ias - fm.gs / KT;
    fm.vappTarget = clamp(Math.max(this.vappBase, this.vappBase - Math.max(0, this.towerHead) + headNow), this.vappBase, this.vappBase + 15);
    const visual = this._visual();
    const imc = !visual || this.appr.ceil < 1000 * FT;
    // stabilised: 1000 ft in instrument conditions, 500 ft in visual
    const gate = (imc ? 1000 : 500) * FT;
    if (agl < gate && !st.gate) {
      st.gate = true;
      const cfgOk = fm.ctl.flapLever === this.ldgLever && fm.gear > 0.98;
      const spdOk = this._iasS > fm.vappTarget - 5 && this._iasS < fm.vappTarget + 12;
      const pathOk = Math.abs(afs.locDots ?? 0) < 1 && Math.abs(afs.gsDots ?? 0) < 1 && fm.vs > -1000 * FT / 60 * 1.2;
      if (cfgOk && spdOk && pathOk) this.say('pm', 'Stabilised.');
      else { this.say('pm', !cfgOk ? 'Not configured.' : !spdOk ? 'Speed.' : 'Not stabilised.'); this.goAround('unstable'); return; }
    }
    // autopilot off for a manual landing when visual (autoland stays on)
    if (afs.ap && !this.appr.autoland && (agl < pf.apOffAgl && visual || agl < this.appr.dh + 80 * FT && agl < 400 * FT) && !st.apOff) {
      st.apOff = true; this.press('pf', 'stick', () => { afs.disconnectAP('pilot'); this.mode = 'landing'; this.say('pf', 'Autopilot off.'); }, 0.2);
    }
    if (!afs.ap && fm.phase === 'approach' && this.mode !== 'landing' && agl < 3000 * FT) this.mode = 'landing';
    // minimums: runway in sight or go around
    const dh = this.appr.cat === 'CAT I' ? this.appr.dh : this.appr.dh;
    if (agl < dh + 100 * FT && !st.min100) { st.min100 = true; this.say('pm', 'One hundred above.'); }
    if (agl < Math.max(dh, 15 * FT) && !st.mins) {
      st.mins = true;
      if (dh > 0) this.say('pm', 'Minimum.');
      if (!visual && dh > 0) { this.say('pf', 'Go around, flaps!'); this.goAround('minima'); return; }
      if (dh > 0) this.say('pf', 'Continue.');
    }
    // above the glide slope with LOC captured: V/S down to capture it from above; still not captured by 1500 ft: go around
    if (afs.vertArmed === 'G/S' && afs.lat.startsWith('LOC') && afs.gsValid && afs.gsErrM > 60 && !st.gsAbove) { st.gsAbove = true; this.say('pf', 'Above the glide slope. V/S minus one thousand five hundred.'); this.press('pf', 'fcuAlt', () => afs.setAlt(0)); this.press('pf', 'fcuVs', () => afs.setVS(-1500), 0.6); }
    if (st.gsAbove && afs.vert === 'V/S' && afs.gsErrM < 25) { afs.vert = 'G/S*'; afs.vertArmed = ''; }
    if (afs.vertArmed === 'G/S' && agl < 1500 * FT && !st.noGS) { st.noGS = true; this.say('pm', 'Glide slope not captured.'); this.goAround('unstable'); return; }
    // no landing clearance close in: go around
    if (agl < 60 * FT && !atc.cl.landing && !fm.airport && !st.noClr && fm.phase === 'approach') { st.noClr = true; this.goAround('no-clearance'); return; }
    // flare: the flare law takes over at 50 ft; RETARD at 20 ft
    if (agl < 50 * FT && fm.phase === 'approach') { fm.phase = 'flare'; fm.emit('flare'); }
    for (const h of [50, 40, 30, 20, 10]) if (agl < h * FT && !st[`rc${h}`] && fm.phase === 'flare') { st[`rc${h}`] = true; if (h === 20 && !this.appr.autoland) { this.hooks.log({ kind: 'auto', who: 'Aircraft', text: 'RETARD' }); this.later(this.pf.react * 0.6, () => { this.lev = [0, 0]; fm.emit('retard'); }); } }
    if (this.appr.autoland && agl < 10 * FT && !st.autoRet) { st.autoRet = true; this.lev = [0, 0]; }
  }

  // can the pilots see the runway? below the cloud base and within the visibility
  _visual() {
    const fm = this.fm, R = this.approachRwy;
    const ceil = this.appr.ceil;
    const vis = fm.atmo.visM;
    // the pilot needs to see approach or runway lights ahead of the nose (over the cockpit cut-off of ~20 degrees)
    const d = fm.agl / Math.tan(20 * DEG) + 60;
    const slant = Math.hypot(d, fm.agl);
    return fm.agl < ceil && slant < vis * 1.2 && !fm.atmo.inCloud;
  }
  _along(R) { const g = this.fm.gearPoint; return (g.x - R.thr.x) * R.dir.x + (g.z - R.thr.y) * R.dir.y; }

  // ---------- touchdown, rollout, vacate ----------
  onEvent(e) {
    const fm = this.fm, st = this.st;
    if (e === 'touchdown' && (fm.phase === 'flare' || fm.phase === 'approach' || fm.phase === 'forced')) {
      if (fm.phase === 'forced') { fm.phase = 'rollout'; this.mode = 'rollout'; this.lev = [0, 0]; this.brk = 0; st.tdT = this.t; st.tdHdg = fm.track; this.stopOnRunway = true; this.st.forcedStop = true; return; }
      fm.phase = 'rollout'; this._flareEndSy = fm.ctl.stickY; this.mode = 'rollout'; st.tdT = this.t;
      this.lev = [0, 0];
      if (!st.gearUnsafe) this.later(0.4 + this.pf.react * 0.5, () => { const r = this.revMax ? DETENT.REV_MAX : DETENT.REV_IDLE; this.lev = [r, r]; });
      else { this.brk = 0.3; this.later(3, () => { this.setCtl('capt', 'engMaster', false, 0); this.press('capt', 'engMaster1', () => { fm.ctl.engMaster[1] = false; this.say('pf', 'Engine masters off.'); }); }); }
      this.later(1.5, () => this.say('pm', `Spoilers. Reverse green.${fm.abActive ? ' Decel.' : ''}`));
      if (this.afs.ap && !this.appr.autoland) this.press('pf', 'stick', () => this.afs.disconnectAP('pilot'), 0.2);
    }
    if (e === 'bounce' && fm.phase === 'rollout' && fm.agl > 1.5) { this.say('pf', 'Go around!'); fm.phase = 'flare'; this.goAround('bounce'); }
    if (e === 'windshear') this._windshearEscape();
    // the autopilot dropped out: the pilot flying takes over at once and re-engages it when things settle
    if (e === 'ap-off-auto' && !fm.onGround) {
      this.mode = fm.phase === 'approach' && fm.agl < 1000 * FT ? 'landing' : 'air';
      this.say('pf', 'I have control.');
      this.later(8, () => { if (!this.afs.ap && !fm.onGround && fm.agl > 700 * FT && fm.phase !== 'forced' && this.mode === 'air') this._apOn(); });
    }
  }
  _rolloutThink() {
    const fm = this.fm, st = this.st, afs = this.afs;
    const kt = fm.gs / KT;
    if (st.rtoWatch) {
      if (kt < 1) { fm.phase = 'rto-stop'; this.lev = [0, 0]; this.brk = 1; this.setCtl('capt', 'parkBrake', true); fm.emit('rto-stopped'); this.say('capt', 'Attention, crew at stations. Attention, crew at stations.'); this.hooks.emergency('rto', {}); }
      else if (kt < 30 && this.lev[0] < 0) this.lev = [0, 0];
      return;
    }
    if (kt < 72 && !st.c70) { st.c70 = true; this.say('pm', 'Seventy knots.'); if (!st.gearUnsafe) this.later(this.pf.react, () => { this.lev = [DETENT.REV_IDLE, DETENT.REV_IDLE]; }); }
    if (kt < 30 && this.lev[0] < 0) { this.lev = [0, 0]; }
    // stop straight ahead for the fire services after an engine fire or an evacuation-type event
    if (this.stopOnRunway || fm.stopOnRunway) {
      // lower the nose first, then brake hard (braking with the nose up slams the nose gear down)
      const noseDown = fm.wow[0] && this.t - (st.tdT ?? 0) > 1.5;
      if (noseDown && st.brkOnT == null) st.brkOnT = this.t;
      this.brk = !noseDown ? 0 : kt > 2 ? clamp((kt - 5) / 30, 0.4, 1) * clamp((this.t - st.brkOnT) / 2, 0.2, 1) : 1;
      if (kt < 0.5) { fm.phase = 'runway-stop'; this.setCtl('capt', 'parkBrake', true); fm.emit('stopped-on-runway'); this.hooks.emergency('stopped', { forced: !!this.st.forcedStop, fire: fm.engFire.some(Boolean) }); if (this.st.forcedStop) { this.say('capt', 'Evacuate, evacuate, evacuate!'); fm.evacuating = true; } }
      return;
    }
    // take over from the autobrake around 40 kt and slow down for the exit
    const dExit = fm.m.exit - fm.s;
    const vExit = 12, need = Math.sqrt(Math.max(0, vExit * vExit + 2 * 1.6 * Math.max(0, dExit - 60)));
    if (kt < 45 && fm.abActive) { this.brk = 0.4; }
    if (!fm.abActive) this.brk = fm.gs > need + 0.5 ? clamp((fm.gs - need) * 0.25, 0.15, 0.8) : 0;
    if (this.afs.ap && kt < 40 && !st.apRoll) { st.apRoll = true; this.press('pf', 'stick', () => this.afs.disconnectAP('pilot'), 0.2); }
    if (fm.s > fm.m.exit - 25 || (kt < 25 && dExit < 200)) {
      // vacate: the hands go to the tiller and taxi along the exit
      this.mode = 'taxi'; this.st.stopS = fm.m.exit + 150; this.st.taxiMax = 10;
      if (fm.s > fm.m.exit + 40 && !st.vac) {
        st.vac = true; fm.phase = 'taxi-in'; fm.emit('vacated');
        this.setCtl('pm', 'speedbrake', 0); this.setCtl('pm', 'spoilersArmed', false); this.setCtl('pm', 'flapLever', 0); this.setCtl('pm', 'autobrake', 'OFF');
        this.say('pf', 'After landing checklist.');
        if (!fm.airport) this.atc.call('vacated', this); else this.atc.cl.taxiIn = true;
      }
    }
  }

  // ---------- go-around ----------
  goAround(reason = 'unstable') {
    const fm = this.fm, afs = this.afs, st = this.st;
    if (fm.onGround && fm.phase !== 'rollout') return false;
    if (fm.phase === 'go-around' || fm.crashed || fm.phase === 'forced') return false;
    if (fm.phase === 'rollout' && reason !== 'bounce') return false;
    this.goArounds++;
    fm.phase = 'go-around'; st.gaT = this.t; st.liftT = this.t;
    this.say('pf', 'Go around, flaps!');
    this.lev = [DETENT.TOGA, DETENT.TOGA];
    afs.toga(true); afs.setAlt(3000); afs.atcSpd = null;
    this.mode = afs.ap ? 'none' : 'air';
    // one step of flaps up; positive climb gear up; LVR CLB at the thrust reduction altitude
    this.later(0.3 + this.pm.react * 0.4, () => this.press('pm', 'flaps', () => { fm.ctl.flapLever = Math.max(0, fm.ctl.flapLever - 1); this.say('pm', `Flaps ${['zero', 'one', 'two', 'three', 'full'][fm.ctl.flapLever]}.`); }, 0.4));
    Object.assign(st, { gsAbove: false, noGS: false, a1: false, a2: false, a3: false, a4: false, posClimb: false, lvrClb: false, fl1: false, fl0: false, gate: false, apOff: false, mins: false, min100: false, flare: false, noClr: false, twr: false, appClr: false, cleared: false, spdClr: false, gaLevel: false, gearDn: false, rc50: false, rc40: false, rc30: false, rc20: false, rc10: false, autoRet: false });
    if (!afs.ap) this.later(8, () => { if (fm.phase === 'go-around' && !afs.ap) this._apOn(); });
    fm.emit('go-around'); fm.emit(`go-around-${reason}`);
    this.atc.resetLanding();
    this.later(3, () => this.atc.call('going-around', this));
    this.gaReason = reason;
    this._buildCircuit();
    return true;
  }
  _goAroundThink() {
    const fm = this.fm, afs = this.afs, st = this.st;
    const altFt = fm.altInd / FT;
    if (!st.gaLevel && (afs.vert === 'ALT' || afs.vert === 'ALT*') && altFt > 2500) { st.gaLevel = true; fm.emit('ga-level'); afs.phase = 'APPROACH'; afs.lat = 'NAV'; afs.latArmed = ''; }
    // weather below minima twice, or a windshear: divert to Arlanda
    if (st.gaLevel && !st.gaDecided) {
      st.gaDecided = true;
      if (!this.diverting && ((this.gaReason === 'minima' && this.goArounds >= 2) || (this.gaReason === 'windshear' && this.goArounds >= 2))) this._divertArlanda('weather at Copenhagen');
    }
    const d2td = fm.m.touchdown - fm.s;
    // back on the circuit to final (also when it is the return to Arlanda)
    if (st.gaLevel && d2td < 26000) {
      fm.phase = 'approach'; afs.phase = 'APPROACH'; fm.emit('ga-rejoin'); st.appClr = true;
      this._planApproach();
      this.later(2, () => { this.atc.call('approach', this); });
    }
  }
  // radar vectors back to final: runway heading, a downwind, base, a 9 NM final
  _buildCircuit() {
    const fm = this.fm, R = this.approachRwy, keys = fm.route.keys;
    if (!keys) return;
    const ux = R.dir.x, uz = R.dir.y, lx = uz, lz = -ux; // left of the landing direction
    const P0 = fm.gearPoint;
    const pt = (a, b) => new THREE.Vector2(R.thr.x + ux * a + lx * b, R.thr.y + uz * a + lz * b);
    const pts = [new THREE.Vector2(P0.x, P0.z), pt(R.len + 5500, 0), pt(R.len + 9000, 7500), pt(-12000, 7500), pt(-19000, 3500), pt(-20000, 0)];
    const rad = [0, 3200, 3200, 3200, 3000, 0];
    const rest = keys.pts.slice(keys.thrIdx), restR = keys.rad.slice(keys.thrIdx);
    const path = new Path([...pts, ...rest], [...rad.slice(0, -1), 3000, ...restR]);
    const m = { ...fm.m };
    const sFinal = path.locate(pt(-20000, 0));
    m.thr = path.locate(R.thr, sFinal); m.touchdown = m.thr + 300; m.exit = path.locate(keys.exitPt, sFinal); m.stand = path.length; m.crossing = m.exit;
    fm.divert({ ...fm.route, path, m, keys: { ...keys, pts: [...pts, ...rest], rad: [...rad.slice(0, -1), 3000, ...restR], thrIdx: pts.length } });
  }

  // ---------- windshear ----------
  _windshearWatch(dt) {
    const fm = this.fm, st = this.st;
    if (fm.onGround || fm.agl > 1300 * FT || !['climb', 'approach', 'go-around', 'flare'].includes(fm.phase)) { this._fF = 0; return; }
    // F-factor = (rate of tailwind increase)/g - (vertical wind)/airspeed; the FAA alert threshold is 0.103
    const w = fm.wind;
    const tail = w.wx * Math.sin(fm.track) - w.wz * Math.cos(fm.track);
    const dWx = (tail - (this._tailP ?? tail)) / Math.max(dt, 1e-3); this._tailP = tail;
    const F = dWx / G - w.wy / Math.max(fm.tas, 50);
    // averaged over 1 km of flight path, as TSO-C117a / ETSO-C117a specify for the alert (about 14 s on the approach)
    this._fF = lerp(this._fF ?? 0, clamp(F, -1, 1), 1 - Math.exp(-dt * Math.max(fm.tas, 50) / 1000));
    if (this._fF > 0.103 && !st.wsWarn && fm.agl > 50 * FT) { st.wsWarn = true; this.hooks.log({ kind: 'auto', who: 'Aircraft', text: 'WINDSHEAR, WINDSHEAR, WINDSHEAR' }); fm.emit('windshear'); this.later(60, () => { st.wsWarn = false; }); }
    // predictive windshear: a microburst ahead on the final approach below 1500 ft
    if (fm.phase === 'approach' && fm.agl < 1500 * FT && !st.pws) {
      for (const c of this.atc.wx.cells) if (c.mb && !c.mb.done) {
        const dx = c.mb.x - fm.pos.x, dz = c.mb.z - fm.pos.z, d = Math.hypot(dx, dz);
        const ahead = (dx * Math.sin(fm.track) - dz * Math.cos(fm.track)) / Math.max(d, 1);
        if (d < 5500 && ahead > 0.7) { st.pws = true; this.hooks.log({ kind: 'auto', who: 'Aircraft', text: 'GO AROUND, WINDSHEAR AHEAD' }); this.goAround('windshear'); break; }
      }
      for (const z of this.fm.atmo.hazards) if (z.kind === 'microburst') {
        const d = Math.hypot(z.x - fm.pos.x, z.z - fm.pos.z);
        if (d < 5000 && !st.pws) { st.pws = true; this.hooks.log({ kind: 'auto', who: 'Aircraft', text: 'GO AROUND, WINDSHEAR AHEAD' }); this.goAround('windshear'); }
      }
    }
  }
  _windshearEscape() {
    const fm = this.fm, afs = this.afs;
    if (fm.phase === 'approach' || fm.phase === 'flare') { this.goAround('windshear'); }
    this.lev = [DETENT.TOGA, DETENT.TOGA]; afs.vert = 'SRS'; this.say('pf', 'Windshear, TOGA.');
  }

  // ---------- abnormal procedures ----------
  _engineFailure(i) {
    const fm = this.fm, afs = this.afs;
    const fire = fm.engFire[i];
    if (!this.st[`ecam${i}`]) { this.st[`ecam${i}`] = true; this.later(this.pm.react + 0.8, () => this.say('pm', `ECAM: engine ${i + 1} ${fire ? 'fire' : 'failure'}.`)); }
    if (fm.phase === 'takeoff' || (fm.phase === 'climb' && fm.agl < 400 * FT)) {
      // below V1 it is a rejected take-off; after V1 they fly on and start the drill at 400 ft
      if (fm.phase !== 'rollout' && !this.st.rto) this.later(3, () => { if (fm.phase !== 'rollout' && fm.phase !== 'rto-stop') this._engineFailure(i); });
      return;
    }
    const twoOut = fm.engFail[0] && fm.engFail[1];
    if (twoOut) { this._dualEngineFailure(); return; }
    // above 400 ft: ECAM actions; keep climbing to a safe altitude, then decide where to land
    this.later(8 + this.pm.react, () => {
      this.say('pf', 'I have control, ECAM actions.');
      this.say('pm', `Thrust lever ${i + 1}, idle. Engine master ${i + 1}, off.${fire ? ` Engine ${i + 1} fire pushbutton, push. Agent one, discharge.` : ''}`);
      this.lev[i] = 0; this.press('pm', 'engMaster' + i, () => { fm.ctl.engMaster[i] = false; });
      if (!fm.engFail[i]) fm.engFail[i] = 1; // shut down: from here on it is an engine-out
      this.hooks.emergency('engine-drill', { i, fire });
    });
    this.later(15, () => {
      this.lev[1 - i] = DETENT.FLX; // MCT on the remaining engine
      const low = fm.altInd < 12000 * FT && (fm.phase === 'climb' || fm.phase === 'go-around');
      if (low) this.press('pf', 'fcuAlt', () => { afs.setAlt(4000); afs.pullAlt(); }, 0.8);
      else { this.press('pf', 'fcuAlt', () => { afs.setAlt(Math.min(afs.fcu.alt, 22000)); afs.pullAlt(); }, 0.8); this.press('pf', 'fcuSpd', () => afs.setSpd(Math.round(afs.greenDot())), 0.6); }
      this._decideDiversion(fire ? 'engine fire' : 'engine failure', fire);
    });
  }
  // A passenger taken ill (the purser calls the flight deck): priority, or the nearest airport if serious
  medical(serious) {
    this.later(2, () => this.say('capt', serious ? 'Purser says the passenger is in a bad way, the doctor wants a hospital. We divert to the nearest airport.' : 'Passenger is stable, a doctor on board is looking after them. We continue and ask for priority.'));
    if (serious) this.later(8, () => this._decideDiversion('medical emergency', false));
    else this.later(8, () => { this.atc.call('pan', this, { what: 'medical emergency on board', intent: 'continuing to Copenhagen, request priority and an ambulance on arrival' }); this.hooks.emergency('decision', { what: 'medical emergency', back: false, urgent: false }); });
  }
  // A main gear leg that has not locked down: ECAM, gravity extension, then a planned emergency landing
  _gearWatch() {
    const fm = this.fm, st = this.st;
    if (fm.gearFailLeg && fm.ctl.gearLever === 1 && fm.gear > 0.95 && !fm.onGround && !st.gearUnsafe) {
      st.gearUnsafe = true;
      const side = fm.gearFailLeg === 1 ? 'left' : 'right';
      this.later(this.pm.react + 2, () => this.say('pm', `ECAM: landing gear not down-locked, ${side} main.`));
      // on the approach they go around to get time for the checklists and to prepare the cabin
      if ((fm.phase === 'approach' || fm.phase === 'flare') && fm.agl > 100 * FT) this.later(this.pf.react + 1.5, () => { if (fm.phase === 'approach') this.goAround('gear'); });
      this.later(12, () => this.say('pf', 'Landing gear gravity extension.'));
      this.later(40, () => {
        this.say('capt', `Still not locked. We'll land on the good legs, keep the wing up as long as we can, stop on the runway and evacuate if needed.`);
        this.atc.call('mayday', this, { what: `${side} main landing gear not locked down`, intent: 'request a long final and the emergency services' });
        this.hooks.emergency('gear-unsafe', { side });
        this.stopOnRunway = true; st.forcedStop = true; st.braceGear = true;
      });
    }
    if (st.braceGear && !fm.onGround && fm.agl < 500 * FT && (fm.phase === 'approach' || fm.phase === 'flare') && !st.brace) { st.brace = true; this.hooks.emergency('brace', {}); }
  }
  _decideDiversion(what, urgent) {
    const fm = this.fm;
    // land at the nearest suitable airport: compare Arlanda with the remaining way to Copenhagen
    const A = STATIONS.ARN;
    const dA = Math.hypot(A.x - fm.pos.x, A.z - fm.pos.z) * 1.15, dC = fm.m.touchdown - fm.s;
    const back = dA < dC && !fm.airport;
    this.hooks.emergency('decision', { what, back, urgent });
    this.atc.call(urgent ? 'mayday' : 'pan', this, { what, intent: back ? 'request immediate return to Arlanda' : 'continuing to Copenhagen, request priority' });
    if (back) this._divertArlanda(what, urgent);
    else { this.stopOnRunway = this.stopOnRunway || urgent; this._planApproach(); }
  }
  _divertArlanda(why, urgent = false) {
    const fm = this.fm, afs = this.afs;
    const s = this.atc.wx.s.arn;
    const rwy = (Math.cos((s.wdir - 8.2) * DEG) * s.wspd) > (Math.cos((s.wdir - 188.2) * DEG) * s.wspd) ? '01L' : '19R';
    this.diverting = { apt: 'ARN', rwy, why };
    afs.offset = 0; this.st.devPending = false; // ATC vectors us from here, the offset for weather no longer applies
    this.atc.divert('ARN', rwy);
    const route = buildReturnRoute({ x: fm.gearPoint.x, z: fm.gearPoint.z }, { x: fm.V.x, z: fm.V.z }, rwy);
    fm.divert(route);
    this._planApproach();
    this.stopOnRunway = this.stopOnRunway || urgent;
    const alt = Math.min(afs.fcu.alt, fm.altInd / FT > 12000 ? 10000 : 4000);
    afs.setAlt(alt);
    if (fm.phase === 'cruise' || fm.phase === 'climb') { fm.phase = 'descent'; afs.phase = 'DESCENT'; }
    if (fm.phase === 'go-around') { fm.phase = 'descent'; afs.phase = 'DESCENT'; }
    afs.pullAlt(); afs.nav();
    Object.assign(this.st, { desReq: true, tod: true, altClr: false, appClr: false, twr: false, spdClr: false, cleared: false, prepLdg: false, gate: false, apOff: false, mins: false, flare: false, gearDn: false, a1: false, a2: false, a3: false, a4: false, gaLevel: false, posClimb: true, lvrClb: true });
    this.atc.cl.landing = true; // an emergency has the runway
    this.say('capt', `We'll return to Arlanda, runway ${spellRwy(rwy)}.`);
    fm.emit('diverting');
  }
  _depressurised() {
    const fm = this.fm, afs = this.afs;
    this.later(this.pm.react + 1, () => { this.say('pm', 'Cabin altitude!'); this.say('pf', 'Oxygen masks on, one hundred percent. Emergency descent.'); });
    this.later(6, () => this.emergencyDescent());
  }
  emergencyDescent() {
    const fm = this.fm, afs = this.afs, st = this.st;
    if (fm.onGround || st.emerDes) return false;
    st.emerDes = true; fm.phase = 'emergency';
    if (afs.ap === false) this._apOn(true);
    this.press('pf', 'fcuAlt', () => { afs.setAlt(10000); afs.pullAlt(); }, 0.8);
    this.press('pf', 'fcuSpd', () => afs.setSpd(Math.round(Math.min(330, afs._iasForMach(0.8, fm.air)))), 0.6);
    this.setCtl('pf', 'speedbrake', 1); this._belt(true);
    fm.emit('emergency-descent');
    this.atc.call('mayday', this, { what: 'emergency descent due to loss of cabin pressure', intent: 'descending to flight level one hundred' });
    return true;
  }
  _emergencyThink() {
    const fm = this.fm, afs = this.afs, st = this.st;
    if (fm.altInd < 10600 * FT && st.emerDes && !st.emerLevel) {
      st.emerLevel = true; this.setCtl('pf', 'speedbrake', 0); this.press('pf', 'fcuSpd', () => afs.managedSpd()); fm.emit('emergency-level');
      this.later(20, () => { st.emerDes = false; fm.phase = 'descent'; afs.phase = 'DESCENT'; this._decideDiversion('loss of cabin pressure', false); });
    }
  }
  _dualEngineFailure() {
    const fm = this.fm, afs = this.afs;
    if (fm.phase === 'forced') return;
    fm.phase = 'forced'; fm.emit('forced-landing');
    this.setCtl('pm', 'autobrake', 'OFF'); // the take-off MAX setting must not fire at touchdown: the pilots brake by hand once the nose is down
    this.say('capt', 'I have control. Engine dual failure. Mayday.');
    this.mode = 'air'; if (afs.ap) this.press('pf', 'stick', () => afs.disconnectAP('pilot'), 0.2);
    this.atc.call('mayday', this, { what: 'both engines failed', intent: 'forced landing' });
    this.hooks.emergency('dual-engine', {});
    this.st.brace = false;
  }
  _forcedThink() {
    const fm = this.fm, afs = this.afs, st = this.st;
    this.mode = 'air';
    // glide at green dot, flaps late, gear down over land, a flare at the end
    afs.lat = 'HDG'; afs.fcu.hdg = afs.fcu.hdg ?? (fm.heading / DEG); afs.vert = 'OP DES'; afs.setSpd(fm.agl > 600 ? Math.round(afs.greenDot()) : Math.round(afs.vls(3) + 10));
    if (fm.agl < 600 && fm.ctl.flapLever < 2 && fm.ias < 195) this.setCtl('pm', 'flapLever', Math.min(3, fm.ctl.flapLever + 1));
    this.setCtl('pm', 'gearLever', fm.ditch ? 0 : 1);
    if (fm.agl < 500 * FT && !st.brace) { st.brace = true; this.hooks.emergency('brace', {}); }
    if (fm.agl < Math.max(16, -fm.vs * 5)) { this.mode = 'landing'; this.st.flare = true; }
  }

  // ---------- the arrival changes (runway change, diversion) ----------
  _rebuildArrival(rwy) {
    const fm = this.fm;
    const r = buildRoute(fm.route.depRwy, rwy);
    fm.divert(r); fm.airport = null; this._planApproach();
  }
}
