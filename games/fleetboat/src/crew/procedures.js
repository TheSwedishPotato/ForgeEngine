/**
 * The procedures, step by step as Fleet Type Submarine (NavPers 16160) chapter 18 gives them,
 * each a script the crew runs: every step is an order to the man at a station, carried out by
 * his hands on the controls, and the next step waits on what the men can see (a gauge, the
 * Christmas tree, a report), never on anything the boat alone knows.
 *
 * Written as generators: `yield` a number to wait that many seconds, or a function to wait
 * until it is true.
 */
import { FT, GAL } from '../data/boat.js';
import { STATIONS } from './roster.js';

const VENTS = ['hm.vent.bb', 'hm.vent.1', 'hm.vent.2', 'hm.vent.3', 'hm.vent.4', 'hm.vent.5', 'hm.vent.6', 'hm.vent.7'];
const GROUPS = ['1', '2', '3', '4', '5', '6', '7'];
const ft = (m) => Math.round(m / FT);

/** Orders that cancel each other. */
export const EXCLUSIVE = { dive: ['surface', 'trim'], surface: ['dive', 'trim', 'changeDepth'], changeDepth: ['trim'] };

function* press(C, station, id, times = 1, hold = 0.8) {
  for (let i = 0; i < times; i++) {
    const j = C.do(station, id, 1, { hold });
    if (!j) return;
    yield C.done(j);
    yield 0.35;
  }
}

/** A time limit on a wait: true when the condition is, or after s seconds. */
const within = (C, s, fn) => { const t0 = C.t; return () => fn() || C.t > t0 + s; };

// ---------------------------------------------------------------------------------------------

/** Diving (18A5): from the surface to the ordered depth, on the battery. */
export function* dive(C, { depth = 60 * FT } = {}) {
  const P = C.plant, ctl = P.ctl, g = P.g;
  C.orders.depth = depth;
  const fromBridge = (+ctl['hatch.ctUpper'] || 0) > 0.5 && C.man('oodBridge')?.level === 'bridge';
  // the officer of the deck: "Clear the bridge!" and two blasts on the diving alarm
  C.say(fromBridge ? 'oodBridge' : 'ctOfficer', 'Clear the bridge! Dive! Dive!');
  yield* press(C, fromBridge ? 'oodBridge' : 'quartermaster', fromBridge ? 'br.divingAlarm' : 'ct.divingAlarm', 2);
  // everyone to his diving station: the lookouts drop down to the planes, the OOD to the conning tower
  C.setCondition('diving', { hurry: true });
  // the engines (if running) are stopped and the propulsion shifted to the battery
  if ([1, 2, 3, 4].some((n) => P.engines[n - 1].state !== 'stopped')) C.order('shiftToBattery');
  // the hydraulic manifold: the main induction and the hull ventilation shut, the main vents open
  const shut = [C.do('hydraulic', 'hm.induction', 'shut'), C.do('hydraulic', 'hm.hullVent', 'shut')];
  const vents = VENTS.map((id) => C.do('hydraulic', id, 'open'));
  // the bow planes rigged out; the planesmen put a down angle on her
  C.do('bowPlanes', 'cr.bowPlanesRig', 'out');
  C.orders.planes = 'dive';
  if (ctl['ct.telegraph.port'] === 'stop') { C.do('ctHelm', 'ct.telegraph.port', 'ahead2'); C.do('ctHelm', 'ct.telegraph.stbd', 'ahead2'); }
  // the last man down: the quartermaster shuts and dogs the upper hatch
  yield within(C, 60, () => !C.men.some((m) => m.level === 'bridge' || m.climb?.to === 'bridge' || m.climb?.from === 'bridge'));
  if ((+ctl['hatch.ctUpper'] || 0) > 0) {
    const h = C.do('quartermaster', 'hatch.ctUpper', 0);
    yield C.done(h);
    C.say('quartermaster', 'Hatch secured!');
  }
  yield C.done(shut, vents);
  // the Christmas tree: every hull opening's light green (the vents are meant to be open)
  yield within(C, 30, () => (g.board ?? []).every((l) => !l.open || l.vent));
  C.say('divingOfficer', (g.board ?? []).every((l) => !l.open || l.vent) ? 'Straight board.' : 'No straight board!');
  // pressure in the boat: bleed air in from the banks and watch the barometer hold
  const b0 = g.barometer;
  const bleed = C.do('airManifold', 'hp.bleed', 0.7);
  if (bleed) {
    yield C.done(bleed);
    yield within(C, 30, () => g.barometer > b0 + 0.25);
    C.do('airManifold', 'hp.bleed', 0);
    yield 6;
    C.say('airManifold', g.barometer > b0 + 0.15 ? 'Pressure in the boat, holding.' : 'Pressure in the boat… not holding!');
  }
  // at forty feet: blow negative to the mark
  yield () => g.depth > 38;
  C.say('divingOfficer', 'Blow negative to the mark.');
  const bn = C.do('airManifold', 'hp.blow.negative', 1);
  yield C.done(bn);
  yield within(C, 40, () => (g.tanks?.negative ?? 0) < 60);
  C.do('airManifold', 'hp.blow.negative', 0);
  const fl = C.do('hydraulic', 'hm.flood.negative', 'shut');
  yield C.done(fl);
  C.say('hydraulic', 'Negative flood shut.');
  const vn = C.do('hydraulic', 'cr.negVentInboard', 1);
  yield C.done(vn);
  yield 8;
  C.do('hydraulic', 'cr.negVentInboard', 0);
  // level off at the ordered depth
  yield () => g.depth > depth / FT - 18;
  C.orders.planes = 'hold';
  yield within(C, 120, () => Math.abs(g.depth - depth / FT) < 4 && Math.abs(g.pitch) < 2);
  C.say('divingOfficer', `${ft(depth)} feet, sir.`);
  yield 25;
  C.say('divingOfficer', 'Shut the main vents.');
  const sv = VENTS.map((id) => C.do('hydraulic', id, 'shut'));
  yield C.done(sv);
  C.say('hydraulic', 'Main vents shut.');
  C.setCondition('submerged');
  C.order('trim');
}

/** Surfacing (18C1): three blasts, blow main ballast, crack the hatch, the low-pressure blower. */
export function* surface(C) {
  const P = C.plant, ctl = P.ctl, g = P.g;
  C.setCondition('diving', { hurry: true });
  C.say('captain', 'Surface! Surface! Surface!');
  yield* press(C, 'quartermaster', 'ct.divingAlarm', 3, 0.5);
  C.orders.planes = 'rise';
  C.orders.depth = 0;
  // the vents shut, then the main ballast blown from the 600-lb manifold
  yield C.done(VENTS.filter((id) => ctl[id] !== 'shut').map((id) => C.do('hydraulic', id, 'shut')));
  // a short blow: enough to start her up; the air left in the tanks expands as she rises (Boyle)
  // and drives out the rest of the water, so the banks are spared for the next time
  const blowOpen = () => [...GROUPS.map((n) => C.do('airManifold', `mbt.blow.${n}`, 1)), C.do('airManifold', 'hp.blow.bb', 1)];
  const blowShut = () => [...GROUPS.map((n) => C.do('airManifold', `mbt.blow.${n}`, 0)), C.do('airManifold', 'hp.blow.bb', 0)];
  yield C.done(C.do('airManifold', 'hp.hammer1', 1), C.do('airManifold', 'hp.hammer2', 1));
  for (let tries = 0; tries < 4 && g.depth > 24; tries++) {
    const d0 = g.depth;
    yield C.done(blowOpen());
    C.say('airManifold', tries ? 'Blowing again.' : 'Blowing main ballast.');
    yield within(C, 25, () => g.depth < d0 - 12 || g.depth < 24);
    yield C.done(blowShut());
    yield within(C, 45, () => g.depth < 24);
  }
  yield C.done(C.do('airManifold', 'hp.hammer1', 0), C.do('airManifold', 'hp.hammer2', 0));
  C.orders.planes = 'hold';
  C.orders.depth = 15 * FT;
  // the quartermaster cracks the upper hatch (the boat's pressure goes with a whoosh), the bridge is manned
  const h = C.do('quartermaster', 'hatch.ctUpper', 1);
  yield C.done(h);
  C.say('quartermaster', 'Upper hatch open.');
  // the bow planes rigged in; the low-pressure blower finishes the job and saves the air
  C.do('bowPlanes', 'cr.bowPlanesRig', 'in');
  const lp = [...GROUPS.map((n) => C.do('airManifold', `lp.blow.${n}`, 1)), C.do('airManifold', 'lp.blower', 1)];
  yield C.done(lp);
  C.say('airManifold', 'Low-pressure blower on the line.');
  // the main induction and the hull ventilation open (the blower draws through them)
  C.do('hydraulic', 'hm.induction', 'open');
  C.do('hydraulic', 'hm.hullVent', 'open');
  // the lookouts watch for the air bubbling out of the flood ports alongside: the tanks are dry
  const mbts = P.boat.tanks.filter((t) => t.kind === 'mbt' || t.kind === 'fbt');
  yield within(C, 720, () => mbts.filter((t) => t.bubbling > 0 || t.fill < 0.02).length >= mbts.length * 0.8);
  C.say('lookoutS', 'Air bubbling alongside!');
  const lpOff = [C.do('airManifold', 'lp.blower', 0), ...GROUPS.map((n) => C.do('airManifold', `lp.blow.${n}`, 0))];
  yield C.done(lpOff);
  C.say('airManifold', 'Main ballast tanks dry. Secured the low-pressure blower.');
  C.setCondition('surfaced');
}

/** Changes depth: the diving officer's order to the planesmen. */
export function* changeDepth(C, { depth }) {
  const g = C.plant.g;
  C.orders.depth = depth;
  C.orders.planes = 'hold';
  C.say('captain', `Make your depth ${ft(depth)} feet.`);
  yield within(C, 300, () => Math.abs(g.depth - depth / FT) < 3 && Math.abs(g.pitch) < 1.5);
  C.say('divingOfficer', `${ft(depth)} feet.`);
}

/** Course: the helmsman steers to it. */
export function* course(C, { heading, rudder = 15 }) {
  C.orders.heading = ((heading % 360) + 360) % 360;
  C.orders.rudderLimit = rudder;
  C.say('captain', `Come ${rudder > 20 ? 'hard ' : ''}to course ${String(Math.round(C.orders.heading)).padStart(3, '0')}.`);
  yield within(C, 400, () => Math.abs(((C.plant.g.heading - C.orders.heading + 540) % 360) - 180) < 2);
  C.say('ctHelm', `Steady on ${String(Math.round(C.orders.heading)).padStart(3, '0')}.`);
  C.orders.rudderLimit = 15;
}

/** Speed: the helmsman rings it up on both telegraphs. */
export function* speed(C, { bell }) {
  C.say('captain', `All ahead ${bell}.`.replace('ahead ahead', 'ahead').replace('ahead back', 'back'));
  const a = C.do('ctHelm', 'ct.telegraph.port', bell), b = C.do('ctHelm', 'ct.telegraph.stbd', bell);
  yield C.done(a, b);
  yield within(C, 30, () => C.plant.ctl['man.answer.port'] === bell && C.plant.ctl['man.answer.stbd'] === bell);
  C.say('ctHelm', `Maneuvering answers ${bell}.`);
}

/** Starting a main engine (Fleet Type Submarine, the engines' starting procedure). */
export function* startEngine(C, { n, mode = 'propulsion' }) {
  const P = C.plant, ctl = P.ctl, e = P.engines[n - 1];
  const st = `eng${n}`;
  if (!surfaced(C)) return;
  const m = C.men.find((q) => q.station === st);
  if (!m) return;
  // the engine's man to his engine
  C.byStation.set(st, m);
  m.goal = st;
  if (m.at !== st) { const S = STATIONS[st]; m.at = null; m.goTo(S.level, S.x, S.z, S.yaw); }
  yield () => m.at === st;
  // the main induction must be open
  if (ctl['hm.induction'] !== 'open') C.do('hydraulic', 'hm.induction', 'open');
  // prime the lube oil with the standby pump; the sea water; the exhaust valves; the room's induction
  yield C.done(C.do(st, `${st}.standbyLube`, 1));
  const valves = [C.do(st, `${st}.seaSuction`, 1), C.do(st, `${st}.exhaustIn`, 1), C.do(st, `${st}.exhaustOut`, 1)];
  const room = n <= 2 ? 'fer.induction' : 'aer.induction';
  if ((+ctl[room] || 0) < 1) valves.push(C.do(st, room, 1));
  yield C.done(valves);
  yield within(C, 60, () => e.primed > 0.8);
  // air to the cylinders: the lever to START, and to RUN when she fires
  C.say(st, `Starting No. ${n} main engine.`);
  yield C.done(C.do(st, `${st}.lever`, 'start'));
  yield within(C, 10, () => e.rpm > 160);
  yield C.done(C.do(st, `${st}.lever`, 'run'));
  yield within(C, 15, () => e.state === 'running');
  if (e.state !== 'running') { C.say(st, `No. ${n} engine won't catch!`); C.do(st, `${st}.lever`, 'stop'); return; }
  C.do(st, `${st}.standbyLube`, 0);
  C.say(st, `No. ${n} engine running.`);
  // the controllerman puts its generator on the line
  const side = n % 2 === 0 ? 'maneuveringP' : 'maneuveringS';
  C.do(side, `man.engSpeed.${n}`, 1);
  if (mode === 'charge') {
    if (ctl['man.busSel'] === 'off') C.do(side, 'man.busSel', 'tieOpen');
    // the generator's voltage brought up to the battery's before its breaker is closed (else the
    // battery motors it and runs the engine away): E = V_bus, field = V / (E at full field)
    const match = Math.min(0.95, (P.g.volts.bus || 250) / (1.12 * 425.6 * (e.rpm / 720)) + 0.004);
    yield C.done(C.do(side, `man.genField.${n}`, match));
    yield C.done(C.do(side, `man.gen.${n}`, 'batBus'));
    // then the controllerman holds the charging current with the field (crew.js)
    C.charge[n] = true;
    yield 20;
    C.say(side, `No. ${n} generator charging the battery, ${Math.round(P.g.amps.gen[n - 1])} amperes.`);
  } else {
    // propulsion: the bus selector to BUS TIE OPEN (each side's generators to its own motors)
    if (ctl['man.busSel'] !== 'tieOpen') {
      yield C.done(C.do(side, 'man.starter.port', 'stop'), C.do(side, 'man.starter.stbd', 'stop'));
      yield C.done(C.do(side, 'man.busSel', 'tieOpen'));
    }
    yield C.done(C.do(side, `man.gen.${n}`, 'motorBus'));
    C.say(side, `No. ${n} generator on the motor bus.`);
  }
}

/** Stops a main engine: its generator off the line first, then the engine, then its valves. */
export function* stopEngine(C, { n }) {
  const P = C.plant, ctl = P.ctl, e = P.engines[n - 1], st = `eng${n}`;
  const side = n % 2 === 0 ? 'maneuveringP' : 'maneuveringS';
  if ((+ctl[`man.genField.${n}`] || 0) > 0) yield C.done(C.do(side, `man.genField.${n}`, 0));
  if (ctl[`man.gen.${n}`] !== 'off') yield C.done(C.do(side, `man.gen.${n}`, 'off'));
  const m = C.men.find((q) => q.station === st);
  if (!m) return;
  C.byStation.set(st, m);
  if (m.at !== st) { const S = STATIONS[st]; m.at = null; m.goTo(S.level, S.x, S.z, S.yaw); }
  yield () => m.at === st;
  yield C.done(C.do(st, `${st}.lever`, 'stop'));
  yield within(C, 40, () => e.rpm < 5);
  yield C.done(C.do(st, `${st}.exhaustOut`, 0), C.do(st, `${st}.exhaustIn`, 0), C.do(st, `${st}.seaSuction`, 0));
  const other = n <= 2 ? P.engines[(n === 1 ? 2 : 1) - 1] : P.engines[(n === 3 ? 4 : 3) - 1];
  if (other.state === 'stopped') C.do(st, n <= 2 ? 'fer.induction' : 'aer.induction', 0);
  C.say(st, `No. ${n} engine secured.`);
}

/** Shifts the propulsion to the battery: the generators off, the bus selector to BAT BUS, the engines stopped. */
export function* shiftToBattery(C) {
  const P = C.plant, ctl = P.ctl;
  const run = [1, 2, 3, 4].filter((n) => P.engines[n - 1].state !== 'stopped' || ctl[`man.gen.${n}`] !== 'off');
  for (const n of run) {
    const side = n % 2 === 0 ? 'maneuveringP' : 'maneuveringS';
    C.do(side, `man.genField.${n}`, 0);
    C.do(side, `man.gen.${n}`, 'off');
  }
  yield within(C, 20, () => run.every((n) => ctl[`man.gen.${n}`] === 'off'));
  yield C.done(C.do('maneuveringP', 'man.starter.port', 'stop'), C.do('maneuveringS', 'man.starter.stbd', 'stop'));
  yield C.done(C.do('maneuveringP', 'man.busSel', 'batBus'));
  C.say('maneuveringP', 'Shifted to the battery.');
  for (const n of run) C.order(`stopEngine${n}`);
}
export function* stopEngine1(C) { yield* stopEngine(C, { n: 1 }); }
export function* stopEngine2(C) { yield* stopEngine(C, { n: 2 }); }
export function* stopEngine3(C) { yield* stopEngine(C, { n: 3 }); }
export function* stopEngine4(C) { yield* stopEngine(C, { n: 4 }); }

/** Answers bells on the diesels: two engines on propulsion, the other two charging (or all four on propulsion). */
/** On the surface, with the bridge hatch open? (The diesels breathe the open air: never submerged.) */
const surfaced = (C) => C.plant.g.depth < 25 && (+C.plant.ctl['hatch.ctUpper'] || 0) > 0.5;

export function* dieselPropulsion(C, { charge = true } = {}) {
  const P = C.plant;
  if (!surfaced(C)) { C.say('captain', 'The engines can only run on the surface, sir: they breathe through the main induction.'); return; }
  if (P.ctl['hm.induction'] !== 'open') yield C.done(C.do('hydraulic', 'hm.induction', 'open'));
  C.order('startEngine1Prop'); C.order('startEngine2Prop');
  if (charge) { C.order('startEngine3Charge'); C.order('startEngine4Charge'); }
  yield 1;
}
export function* startEngine1Prop(C) { yield* startEngine(C, { n: 1 }); }
export function* startEngine2Prop(C) { yield* startEngine(C, { n: 2 }); }
export function* startEngine3Prop(C) { yield* startEngine(C, { n: 3 }); }
export function* startEngine4Prop(C) { yield* startEngine(C, { n: 4 }); }
export function* startEngine3Charge(C) { yield* startEngine(C, { n: 3, mode: 'charge' }); }
export function* startEngine4Charge(C) { yield* startEngine(C, { n: 4, mode: 'charge' }); }

/**
 * The diving officer's trim (18B): with the boat at her depth, he watches what the planes must do
 * to hold her there. Rise on the planes and an up angle: she is heavy, pump from auxiliary to sea;
 * dive on the planes: light, flood auxiliary from the sea; the stern planes holding her bow up:
 * heavy forward, pump forward trim to after trim (and the other way). A few hundred gallons at a
 * time, then he watches again.
 */
export function* trim(C) {
  const P = C.plant, g = P.g, ctl = P.ctl;
  for (let round = 0; round < 8; round++) {
    // watch for a minute
    let nb = 0, sb = 0, sp = 0, k = 0;
    const t0 = C.t;
    yield () => { nb += g.planes.bow; sb += g.planes.stern; sp += g.pitch; k++; return C.t > t0 + 60; };
    const bow = nb / k, stern = sb / k, pitch = sp / k;
    const heavy = bow * 0.6 + pitch * 1.5, bowHeavy = stern * 0.8;
    if (Math.abs(heavy) < 2.5 && Math.abs(bowHeavy) < 2.5) { C.say('divingOfficer', 'The boat is in trim.'); return; }
    if (Math.abs(heavy) >= 2.5) {
      const gal = Math.min(1500, Math.round(Math.abs(heavy) * 120 / 50) * 50);
      if (heavy > 0) { C.say('divingOfficer', `Pump from auxiliary to sea, ${gal} gallons.`); yield* moveWater(C, 'aux1', 'sea', gal); }
      else { C.say('divingOfficer', `Flood auxiliary from sea, ${gal} gallons.`); yield* moveWater(C, 'sea', 'aux1', gal); }
    }
    if (Math.abs(bowHeavy) >= 2.5) {
      const gal = Math.min(800, Math.round(Math.abs(bowHeavy) * 60 / 50) * 50);
      if (bowHeavy > 0) { C.say('divingOfficer', `Pump from forward trim to after trim, ${gal} gallons.`); yield* moveWater(C, 'fwdTrim', 'aftTrim', gal); }
      else { C.say('divingOfficer', `Pump from after trim to forward trim, ${gal} gallons.`); yield* moveWater(C, 'aftTrim', 'fwdTrim', gal); }
    }
    void ctl;
  }
}

/** The trim manifoldman lines up the manifold and runs the pump (or lets the sea flood), watching the tank gauge. */
function* moveWater(C, from, to, gallons) {
  const P = C.plant, g = P.g, ctl = P.ctl;
  const tank = from === 'sea' ? to : from;
  const g0 = g.tanks?.[tank] ?? 0;
  const lineup = [C.do('trimManifold', `tm.suction.${from}`, 1), C.do('trimManifold', `tm.discharge.${to}`, 1)];
  yield C.done(lineup);
  const flood = from === 'sea' && g.depth < 250;
  if (!flood) {
    // prime the pump, then start it
    yield C.done(C.do('trimManifold', 'tm.priming', 1));
    yield 25;
    yield C.done(C.do('trimManifold', 'tm.priming', 0), C.do('trimManifold', 'tm.pump', 1));
  }
  yield within(C, 600, () => Math.abs((g.tanks?.[tank] ?? 0) - g0) >= gallons);
  if (!flood) yield C.done(C.do('trimManifold', 'tm.pump', 0));
  yield C.done(C.do('trimManifold', `tm.suction.${from}`, 0), C.do('trimManifold', `tm.discharge.${to}`, 0));
  C.say('trimManifold', `${from === 'sea' ? 'Flooded' : 'Pumped'} ${gallons} gallons.`);
  void ctl; void GAL;
}

/** Rig for red (at night, so eyes are dark-adapted for the periscope and the bridge) or white. */
export function* rigForRed(C) { yield C.done(C.do('crWatch', 'cr.lights', 'red') ?? C.do('divingOfficer', 'cr.lights', 'red')); C.say('crWatch', 'Rigged for red.'); }
export function* rigForWhite(C) { yield C.done(C.do('crWatch', 'cr.lights', 'white') ?? C.do('divingOfficer', 'cr.lights', 'white')); C.say('crWatch', 'Rigged for white.'); }

/** Water in the bilges: the drain pump in the pump room, till they are dry. */
export function* pumpBilges(C) {
  const P = C.plant, F = P.flood;
  const who = C.man('pumpRoom') ? 'pumpRoom' : 'crWatch';
  const wet = F.comps.reduce((a, q) => (q.water > a.water ? q : a), F.comps[0]);
  C.say(who, `Water in the ${wet.name.toLowerCase().replace(/ \(.*\)/, '')} bilges, about ${Math.round(wet.water / GAL / 10) * 10} gallons. Starting the drain pump.`);
  yield C.done(C.do(who, 'pr.drain', 1));
  yield within(C, 3600, () => F.total < 0.05);
  yield C.done(C.do(who, 'pr.drain', 0));
  C.say(who, 'Bilges pumped dry.');
}

/** Flooding: report it, and if she is submerged, blow everything and get her up. */
export function* flooding(C, { where }) {
  C.say('divingOfficer', `Flooding in the ${where}!`);
  if (C.plant.g.depth > 30) {
    C.say('captain', 'Emergency surface! Blow all main ballast!');
    C.order('surface');
  }
  yield 1;
}
