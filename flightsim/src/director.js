// The flight timeline: signs, lights, announcements, crew routines, service and arrival.
import * as THREE from 'three';
import { SCRIPTS, SPEAKERS, context } from './speech.js';
import { rowZ, ROWS, BUSINESS_ROWS } from './cabin.js';
import { clamp, fmtClock, rng, KT, project } from './core.js';
import { LANDMARKS } from './places.js';

export const MENU = [
  { id: 'focaccia', name: 'Chicken & pesto focaccia', price: 95 },
  { id: 'sandwich', name: 'Cheese & tomato sandwich (veg)', price: 79 },
  { id: 'bun', name: 'Kanelbulle (cinnamon bun)', price: 39 },
  { id: 'chocolate', name: 'Chocolate bar', price: 35 },
  { id: 'crisps', name: 'Crisps', price: 35 },
  { id: 'soda', name: 'Soft drink', price: 39 },
  { id: 'juice', name: 'Orange juice', price: 39 },
  { id: 'sparkling', name: 'Sparkling water', price: 35 },
  { id: 'beer', name: 'Mikkeller Celebration IPA 33 cl', price: 76 },
  { id: 'wine', name: 'Red or white wine 18.7 cl', price: 89 },
];

export class Director {
  constructor(sim) {
    this.sim = sim; // { fm, people, cabin, voice, audio, ui, player, dialogue, scenery, opts }
    this.t = 0; this.times = {}; this.flags = {};
    this.r = rng(99);
    this.seatbelt = true; this.lightLevel = 1; this.mood = '#fff4e6';
    this.crewSeated = false; this.demoDone = false; this.checkDone = false;
    this.nextLav = 400;
    this.playerOrders = [];
    this.stats = { coffee: 0, spent: 0, talked: 0, belt: 0 };
    const o = sim.opts;
    this.ctx = context(o, o.depTime, o.depTime + 1.2);
  }

  get clockH() { return this.sim.opts.startClock + this.t / 3600; }
  flag(name) { if (this.flags[name]) return false; this.flags[name] = true; return true; }
  after(name, delay) { const t0 = this.times[name]; return t0 != null && this.t >= t0 + delay; }
  mark(name) { if (this.times[name] == null) this.times[name] = this.t; }

  say(script, opts = {}) {
    const S = this.sim;
    if (S.fast) { if (opts.onDone) opts.onDone(); return; }
    const items = typeof script === 'function' ? script(this._ctx()) : script;
    S.audio.chime(opts.chime || 'hilo');
    setTimeout(() => S.audio.paClick(true), 600);
    const first = items[0]; if (first) first.gap = 250;
    const pad = { text: '', lang: 'en', speaker: items[0]?.speaker, pa: true, gap: 900 };
    S.voice.clearChannel('chat');
    S.voice.say([{ ...pad, text: '…', gap: 1100 }, ...items], { priority: opts.priority ?? 2, channel: 'pa', onDone: () => { S.audio.paClick(false); if (opts.onDone) opts.onDone(); } });
  }
  _ctx() {
    const fm = this.sim.fm;
    const c = { ...this.ctx };
    c.hour = this.clockH; c.timeSv = fmtClock(this.clockH).replace(':', '.'); c.timeEn = fmtClock(this.clockH);
    const eta = this.eta(); c.etaEn = fmtClock(eta); c.etaSv = fmtClock(eta).replace(':', '.');
    c.mins = Math.max(8, Math.round((fm.m.touchdown - fm.s) / Math.max(fm.v, 120) / 60 / 5) * 5 + 5);
    return c;
  }
  eta() {
    const fm = this.sim.fm;
    const remaining = Math.max(0, fm.m.touchdown - fm.s);
    const tFlight = this.times.liftoff != null ? remaining / 205 : 3300;
    return this.clockH + (tFlight + (this.times.liftoff == null ? 300 : 0)) / 3600;
  }

  setSeatbelt(on, chime = true) {
    if (this.seatbelt === on) return;
    this.seatbelt = on; this.sim.cabin.setSigns(on);
    if (chime && !this.sim.fast) this.sim.audio.chime('single');
    this.sim.ui.toast(on ? 'Fasten seatbelt sign ON' : 'Fasten seatbelt sign OFF');
    if (!on) this.sim.dialogue?.event('seatbelt-off', {});
  }

  setLights(level, mood, instant = false) { this.lightTarget = level; this.moodTarget = mood; if (instant) { this.lightLevel = level; this.mood = mood; } }

  // Cabin-check predicate for a row. Returns true when the crew can move on.
  checkRow(actor, row) {
    const S = this.sim, P = S.player;
    const key = `chk-${this.phaseTag}-${row}`;
    if (row === P.seat.row) {
      const issues = this.playerIssues();
      if (!issues.length) { if (this.flags[key + '-asked']) { this.crewLine(actor, 'Tack! Thank you.'); } return true; }
      if (!this.flags[key + '-asked'] || this.t - (this.times[key] || 0) > 14) {
        this.flags[key + '-asked'] = true; this.times[key] = this.t;
        this.crewLine(actor, issues[0].say);
        S.ui.toast(issues[0].hint, 5);
      }
      return false;
    }
    // occasional NPC issue: a reclined seat or a tray table
    if (!this.flags[key] && this.r() < 0.07) {
      this.flags[key] = true;
      const occ = S.cabin.seats.filter((s) => s.row === row && s.occupant && !s.occupant.neighbor);
      if (occ.length) {
        const s = occ[Math.floor(this.r() * occ.length)];
        const lines = [['Kan du fälla upp ryggstödet, tack?', 'Could you put your seat upright, please?'], ['Bordet behöver vara uppfällt.', 'Your tray table needs to be stowed, thanks.'], ['Kan du lägga väskan under stolen framför?', 'Could you put your bag under the seat in front?']];
        const l = lines[Math.floor(this.r() * lines.length)];
        if (Math.abs(row - P.seat.row) <= 3) this.crewLine(actor, l[1]);
        actor.headTarget = { x: s.x, y: 0.9, z: s.z };
        this.times[key + '-npc'] = this.t;
        if (s.occupant) { s.recline = 0; S.cabin.updateSeat(s); if (s.occupant.tray && s.occupant.act !== 'laptop') { s.occupant.tray = false; S.people.refreshTrays(); } }
      }
      return false;
    }
    if (this.times[key + '-npc'] != null && this.t - this.times[key + '-npc'] < 2.5) return false;
    return true;
  }
  playerIssues() {
    const P = this.sim.player; const out = [];
    if (P.state !== 'seated') out.push({ say: 'Please take your seat now, we are about to depart.', hint: 'Walk back to your seat and press Space to sit down' });
    else if (!P.belt) out.push({ say: 'Could you fasten your seatbelt, please?', hint: 'Press B to fasten your seatbelt' });
    if (P.tray) out.push({ say: 'Could you fold up your tray table, please?', hint: 'Press F to fold the tray table' });
    if (P.recline) out.push({ say: 'Your seat back needs to be upright, thank you.', hint: 'Press R to bring your seat upright' });
    const win = this.sim.cabin.windows.filter((w) => Math.sign(w.side) === Math.sign(P.seat.x) && Math.abs(w.z - (P.seat.z - 0.25)) < 0.5);
    if ((P.seat.letter === 'A' || P.seat.letter === 'F') && win.some((w) => w.shadeTarget > 0.5)) out.push({ say: 'Could you open the window blind, please? It needs to be open for take-off and landing.', hint: 'Look at the window shade and press E to open it' });
    return out;
  }

  crewLine(actor, text) {
    const S = this.sim;
    const d = Math.hypot(actor.x - S.player.eye.x, actor.z - S.player.eye.z);
    if (d > 5 || S.fast) return;
    const sp = actor.app.female ? SPEAKERS.crewF : SPEAKERS.crewM;
    S.voice.say([{ text, lang: /[åäö]/i.test(text) ? 'sv' : 'en', speaker: { ...sp, name: actor.name }, volume: 0.85, gap: 150 }], { priority: 1, channel: 'crew' });
  }

  // ---------------- service ----------------
  serve(actor, seat, run, business) {
    const S = this.sim, P = S.player;
    const nearPlayer = Math.abs(seat.row - P.seat.row) <= 1;
    if (seat.id === P.seat.id || (seat.occupant && seat.occupant.neighbor)) {
      if (seat.occupant && seat.occupant.neighbor) {
        // neighbour orders coffee
        const n = S.people.neighbor; n.tray = true; n.cup = true; S.people.refreshTrays();
        return { dur: 3, gesture: 'pour', after: () => { S.audio.pour(); } };
      }
      // the player: interactive
      this.serviceAtPlayer = { actor, t: this.t, business };
      actor.queue({ type: 'call', fn: (a) => { a.headTarget = { x: seat.x, y: 1.1, z: seat.z }; this.crewLine(a, business ? 'Hej! Would you like something to drink with your meal?' : 'Hej! Something to drink? Kaffe eller te? Coffee or tea?'); S.ui.serviceMenu(true, business); } },
        { type: 'until', cond: () => !this.serviceAtPlayer || this.t - this.serviceAtPlayer.t > (S.fast ? 0 : 25) }, { type: 'call', fn: (a) => { a.headTarget = null; S.ui.serviceMenu(false); this.serviceAtPlayer = null; } });
      return { dur: 0 };
    }
    const p = seat.occupant; if (!p || p.away) return { dur: 0 };
    const r = this.r();
    const choice = p.sleep ? 'none' : r < 0.45 ? 'coffee' : r < 0.6 ? 'tea' : r < 0.72 ? 'water' : r < 0.82 ? 'buy' : 'none';
    p.choice = choice; p.served = true;
    if (choice === 'none') { if (nearPlayer && this.r() < 0.5) this.crewLine(actor, 'Något att dricka? — Nej tack.'); return { dur: 1.2, gesture: 'offer' }; }
    if (nearPlayer) this.crewLine(actor, choice === 'coffee' ? 'Kaffe? Mjölk?' : choice === 'tea' ? 'Here is your tea.' : choice === 'buy' ? 'That will be ninety-five kronor, card only please.' : 'Here you go.');
    return { dur: choice === 'buy' ? 6 : 3.5, gesture: choice === 'buy' ? 'offer' : 'pour', after: () => { if (!business) { p.tray = true; p.cup = true; S.people.refreshTrays(); } if (nearPlayer && (choice === 'coffee' || choice === 'tea')) S.audio.pour(); if (choice === 'buy' && nearPlayer) S.audio.beep(); } };
  }

  // Called by UI with the player's decision at the trolley
  playerOrder(choice, item) {
    const S = this.sim, sa = this.serviceAtPlayer; if (!sa) return;
    const a = sa.actor;
    if (choice === 'none') { this.crewLine(a, 'No problem. Tack!'); this.serviceAtPlayer = null; return; }
    if (!S.player.tray) S.player.setTray(true);
    if (choice === 'buy') {
      this.crewLine(a, `${item.name}? That is ${item.price} kronor. Please tap your card on the terminal.`);
      a.setProp('l', 'terminal');
      S.ui.payPrompt(item, () => {
        S.audio.beep(); this.crewLine(a, 'Approved. Varsågod, enjoy!'); a.setProp('l', null);
        this.stats.spent += item.price; this.playerOrders.push(item.id); S.ui.addTrayItem(item.id); S.player.addItem?.(item.id);
        this.serviceAtPlayer = null;
      });
      return;
    }
    const lines = { coffee: 'Coffee, here you go. Milk or sugar is on the tray.', tea: 'Here is your tea. Careful, it\'s hot.', water: 'Still water for you.' };
    a.playGesture('pour'); S.audio.pour();
    this.crewLine(a, lines[choice] || 'Here you go.');
    this.stats.coffee += choice === 'coffee' ? 1 : 0;
    S.player.addItem?.(choice);
    setTimeout(() => { this.serviceAtPlayer = null; }, 2500);
  }

  // ---------------- attendant call ----------------
  handleCall() {
    const S = this.sim, P = S.player;
    if (!P.callOn || this.callResponder) return;
    if (this.seatbelt && S.fm.phase !== 'cruise' && S.fm.phase !== 'climb') return; // crew seated/busy
    const free = S.people.crew.filter((c) => !c.seated && !c.busy() && !c.carrying);
    if (!free.length) return;
    const c = free.sort((a, b) => Math.abs(a.z - P.seat.z) - Math.abs(b.z - P.seat.z))[0];
    this.callResponder = c;
    c.queue({ type: 'walk', x: 0, z: P.seat.z - 0.45, speed: 0.9 }, { type: 'call', fn: (a) => { a.headTarget = { x: P.seat.x, y: 1.1, z: P.seat.z }; this.crewLine(a, 'Hi, did you call? How can I help?'); P.setCall(false); S.ui.callMenu(true); } },
      { type: 'until', cond: () => !this.callResponder || this.t - (this.times.callAsk ?? this.t) > 25 },
      { type: 'call', fn: (a) => { a.headTarget = null; S.ui.callMenu(false); this.callResponder = null; } });
    this.times.callAsk = this.t;
  }
  callAnswer(id) {
    const c = this.callResponder; if (!c) return;
    const S = this.sim;
    const lines = {
      water: 'Of course, I\'ll bring you a glass of water.',
      when: `We're due to land at around ${fmtClock(this.eta())}. About ${Math.max(5, Math.round((this.eta() - this.clockH) * 60))} minutes from now.`,
      connect: 'Transfers in Copenhagen are signposted as soon as you enter the terminal — no passport control from Stockholm, it\'s all Schengen.',
      blanket: 'I\'m afraid we don\'t carry blankets on short flights, but I can turn the air vent down for you.',
      sorry: 'No problem at all!',
    };
    this.crewLine(c, lines[id] || lines.sorry);
    if (id === 'water') setTimeout(() => { S.player.addItem?.('water'); S.audio.pour(); }, 9000);
    setTimeout(() => { this.callResponder = null; }, 3500);
  }

  // ---------------- per-frame timeline ----------------
  update(dt) {
    const S = this.sim, fm = S.fm, P = S.player, people = S.people;
    this.t += dt;
    const t = this.t;
    // events from the flight model
    while (fm.events.length) this.onFlightEvent(fm.events.shift());
    // --- pre-departure sequence ---
    if (this.flag('start')) {
      S.cabin.setSigns(true); this.setLights(this.nightish() ? 0.45 : 0.9, this.nightish() ? '#dfe6ff' : '#fff4e6', true);
      people.crewNamed('purser').queue({ type: 'walk', x: 0.4, z: -2.8 });
    }
    if (t > 4 && this.flag('welcome')) this.say(SCRIPTS.welcome, { onDone: () => this.mark('welcomeDone') });
    if (t > 12 && this.flag('taxi')) { fm.clearTaxi = true; }
    if (t > 26 && this.flag('flaps')) { fm.setConfig(2); }
    if (this.after('welcomeDone', 1) && this.flag('demoPos')) { people.safetyDemoPositions(); this.mark('demoPos'); }
    if (this.after('demoPos', 7) && this.flag('demo')) this._runDemo();
    if (this.demoDone && this.flag('check')) { this.phaseTag = 'to'; people.cabinCheck((a, row) => this.checkRow(a, row), () => { this.checkDone = true; this.mark('checkDone'); }); }
    // captain: seats for take-off when the cabin is secure and we approach the runway
    if (this.checkDone && (fm.phase === 'hold' || fm.s > fm.m.hold - 600) && this.flag('seatsTO')) {
      this.say(SCRIPTS.seatsTakeoff, { onDone: () => people.crewToJumpSeats(() => { this.crewSeated = true; this.mark('crewSeated'); }) });
      if (this.nightish()) this.setLights(0.18, '#c8d4ff');
    }
    if (fm.phase === 'hold' && this.times.arnTrafficRoll == null) this.times.arnTrafficRoll = t + 6;
    if (fm.phase === 'hold' && this.crewSeated && this.times.arnTrafficRoll != null && t > this.times.arnTrafficRoll + 45 && this.playerReady()) fm.clearLineup = true;
    if (fm.phase === 'lineup' && fm.v < 0.2 && fm.s > fm.m.lineup - 1) { this.mark('linedUp'); if (this.after('linedUp', 14) && this.playerReady()) fm.clearTakeoff = true; }
    // --- climb ---
    if (this.after('passing10k', 25) && this.seatbelt && this.flag('beltOff') && !(S.env?.inCloud > 0.3)) {
      this.setSeatbelt(false); this.mark('beltOff'); people.crewStand(); this.setLights(this.nightish() ? 0.55 : 1.0, this.nightish() ? '#ffe7cc' : '#fff4e6');
    }
    if (this.after('beltOff', 20) && this.flag('capPA')) this.say(SCRIPTS.captainClimb, { onDone: () => this.mark('capDone') });
    if (this.after('capDone', 8) && this.flag('svcPA')) this.say(SCRIPTS.service, { onDone: () => this.mark('svcPA') });
    if (this.after('svcPA', 25) && this.flag('service')) {
      S.cabin.setCurtain(true);
      people.startService((a, s, run, business) => this.serve(a, s, run, business), () => { this.mark('serviceDone'); S.cabin.setCurtain(false); });
      this.mark('serviceStart');
    }
    if (this.after('serviceDone', 150) && this.flag('trash')) people.collectTrash(() => this.mark('trashDone'));
    if (this.times.topOfClimb != null && this.times.crossing == null) this.times.crossing = this.times.topOfClimb + 150;
    // lavatory visits while the belt sign is off
    if (!this.seatbelt && fm.phase !== 'descent' && t > this.nextLav && people.walkers.length < 2 && !people.servicing()) {
      this.nextLav = t + 70 + this.r() * 120;
      const cand = people.pax.filter((p) => !p.away && !p.sleep && (p.seat.letter === 'C' || p.seat.letter === 'D' || this.r() < 0.3));
      if (cand.length) { const p = cand[Math.floor(this.r() * cand.length)]; const lav = p.seat.row <= 10 ? S.cabin.lavs[0] : S.cabin.lavs[1 + Math.floor(this.r() * 2)]; people.lavVisit(p, lav); }
    }
    // --- descent & approach ---
    const d2td = fm.m.touchdown - fm.s;
    if (!fm.onGround && fm.phase !== 'climb' && d2td < 78000 && this.flag('landingPrep')) {
      this.setSeatbelt(true);
      this.say(SCRIPTS.prepareLanding, { onDone: () => {
        this.phaseTag = 'ldg'; people.stowAllTrays(); S.cabin.setCurtain(false);
        for (const b of S.cabin.bins) b.target = 0;
        people.cabinCheck((a, row) => this.checkRow(a, row), () => { this.mark('ldgCheck'); people.crewToJumpSeats(() => this.mark('crewSeatedLdg')); });
      } });
      if (this.nightish()) this.setLights(0.18, '#c8d4ff');
    }
    if (!fm.onGround && d2td < 16000 && this.flag('seatsLdg')) this.say(SCRIPTS.seatsLanding, { priority: 3 });
    // traffic departing 22R during our approach
    if (!fm.onGround && d2td < 14000 && this.times.cphTraffic == null) this.times.cphTraffic = t + 5;
    // the bridge remark
    if (!fm.onGround && fm.h < 1500 && fm.phase === 'approach') {
      const b = project(...LANDMARKS.oresundBridgeW); const d = Math.hypot(b.x - fm.pos.x, b.z - fm.pos.z);
      if (d < 16000) S.dialogue?.event('bridge', {});
    }
    // --- after landing ---
    if (this.after('vacated', 6) && this.flag('arrPA')) {
      this.say(SCRIPTS.arrival);
      this.setLights(this.nightish() ? 0.6 : 1.0, '#fff4e6');
      if (!S.fast) setTimeout(() => S.audio.clicks(14, 25), 3000); // impatient passengers unbuckling early
    }
    if (this.after('parked', 12) && this.flag('shutdown')) { fm.shutdown(); }
    if (this.after('parked', 20) && this.flag('arrBelt')) {
      this.setSeatbelt(false); S.audio.clicks(40, 4);
      people.crewStand(); people.standUpAtGate(); S.ext.beaconOff = true;
      this.say(SCRIPTS.disarm, { chime: 'hilo' });
      this.flickerLights();
    }
    if (this.after('parked', 55) && this.flag('doorOpen')) {
      S.cabin.doors.L1.target = 1; S.audio.doorThud();
      const pur = people.crewNamed('purser'); pur.clear(); pur.queue({ type: 'walk', x: 0, z: -1.2 }, { type: 'walk', x: -1.05, z: -1.2 }, { type: 'face', h: Math.PI * 0.85 }, { type: 'gesture', name: 'wave' });
      const fw = people.crewNamed('fwd'); fw.clear(); fw.queue({ type: 'walk', x: 0, z: -1.6 }, { type: 'walk', x: 0.85, z: -2.9 }, { type: 'face', h: -Math.PI / 2 - 0.4 });
      people.startDeplaning(); this.mark('doorOpen');
    }
    // attendant call
    if (P.callOn) this.handleCall();
    // crew nag if the player walks around with the belt sign on in critical phases
    if (P.state === 'standing' && this.seatbelt && !fm.onGround === false && fm.phase !== 'arrived' && fm.v > 0.5) this._nag('Please return to your seat, the fasten seatbelt sign is on.');
    if (P.state === 'standing' && this.seatbelt && !fm.onGround) this._nag('The seatbelt sign is on — please go back to your seat and fasten your seatbelt.');
    // light transitions
    this.lightLevel += clamp((this.lightTarget ?? this.lightLevel) - this.lightLevel, -dt * 0.35, dt * 0.35);
    if (this.moodTarget) this.mood = this.moodTarget;
    if (this.flicker && this.flicker > 0) this.flicker -= dt;
  }

  _nag(text) {
    if (this.t - (this.times.nag ?? -99) < 20) return;
    this.times.nag = this.t;
    const S = this.sim; const c = S.people.crew.filter((x) => !x.busy() || x.seated).sort((a, b) => Math.abs(a.z - S.player.pos.z) - Math.abs(b.z - S.player.pos.z))[0];
    if (c) { const sp = c.app.female ? SPEAKERS.crewF : SPEAKERS.crewM; S.voice.say([{ text, lang: 'en', speaker: { ...sp, name: c.name } }], { priority: 2, channel: 'crew' }); }
    S.ui.toast('Seatbelt sign is on — go back to your seat (Space to sit, B to fasten)', 5);
  }

  flickerLights() { this.flicker = 1.2; }

  playerReady() { return !this.playerIssues().length || this.sim.fast; }

  nightish() { return this.sim.env ? this.sim.env.nightK > 0.35 : false; }

  _runDemo() {
    const S = this.sim, people = S.people;
    const segs = SCRIPTS.demo;
    const items = [];
    segs.forEach((sg, i) => {
      items.push({ text: sg.sv, lang: 'sv', speaker: SPEAKERS.purser, pa: true, onStart: () => people.demoGesture(sg.g) });
      items.push({ text: sg.en, lang: 'en', speaker: SPEAKERS.purser, pa: true, onStart: () => { if (S.voice.langs === 'en') people.demoGesture(sg.g); } });
    });
    S.audio.chime('hilo');
    if (S.fast) { this.demoDone = true; people.endDemo(); return; }
    S.voice.say(items, { priority: 2, channel: 'pa', onDone: () => { this.demoDone = true; people.endDemo(); } });
  }

  onFlightEvent(e) {
    const S = this.sim, fm = S.fm;
    this.mark(e.replace(/-/g, ''));
    switch (e) {
      case 'taxi-start': S.ui.toast('Taxiing to runway 19R'); break;
      case 'holding-point': S.ui.toast('Holding short of runway 19R'); break;
      case 'lineup-start': S.ui.toast('Lining up on runway 19R'); break;
      case 'takeoff-roll': S.ui.toast('Take-off roll — runway 19R, Stockholm Arlanda'); S.dialogue?.event('takeoff-roll', {}); break;
      case 'liftoff': this.mark('liftoff'); break;
      case 'gear-up': if (!S.fast) { setTimeout(() => S.audio.clunk(0.7), 300); setTimeout(() => S.audio.clunk(0.9), 8500); } S.dialogue?.event('gear-up', {}); break;
      case 'passing-10000-climb': this.mark('passing10k'); if (!S.fast) S.audio.chime('single'); break;
      case 'top-of-climb': this.mark('topOfClimb'); break;
      case 'top-of-descent': this.mark('topOfDescent'); this.say(SCRIPTS.descent); S.dialogue?.event('descent', {}); break;
      case 'gear-down': if (!S.fast) { S.audio.clunk(0.8); setTimeout(() => S.audio.clunk(1.0), 7000); } break;
      case 'touchdown': if (!S.fast) S.audio.touchdown(fm.thump); S.dialogue?.event('touchdown', {}); S.ui.toast('Touchdown, runway 22L, Copenhagen Kastrup'); break;
      case 'vacated': this.mark('vacated'); break;
      case 'parked': this.mark('parked'); S.dialogue?.event('parked', {}); S.ui.toast('Arrived at the gate'); break;
      default: break;
    }
  }
}
